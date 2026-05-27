"""HTTP endpoints de gestión de usuarios.

Cambios 2026-05-09 (módulo geo):
  · GET  /api/user/{id} → ahora devuelve `zones: [{cod_dep, cod_mun}, ...]`.
  · POST /api/user      → acepta `zones` en el body y las persiste tras
                          crear el usuario.
  · PUT  /api/user/{id} → acepta `zones` y hace upsert transaccional
                          (DELETE + INSERT) en `dbo.User_Zones`.
  · El blueprint nuevo /api/user/{id}/zones es un endpoint focalizado para
    el caso "solo quiero re-asignar zonas sin tocar el perfil".

Cambios 2026-05-10 (refactor productos + zonas):
  · PUT /api/user-products/{user_id} → Ahora recibe productos CON zonas anidadas
  · El payload es: [{ name, contract_duration, duration_unit, enable, zones: [...] }]
  · Usa UserProductsSqlAdapter.upsert_user_products_with_zones()
"""
import azure.functions as func
import logging
import json

from http import HTTPStatus
from domain.models.user import User
from shared.utils import MIMETYPE, decode_token, json_response

from app.sql.user_sql_adapter import UserSqlAdapter
from app.sql.user_zones_sql_adapter import UserZonesSqlAdapter
from app.sql.user_products_sql_adapter import UserProductsSqlAdapter
from app.ms_graph.user_graph_adapter import UserGraphAdapter
from use_cases.create_user import CreateUserUseCase
from use_cases.get_user import GetUserUseCase
from use_cases.list_users import ListUsersUseCase
from use_cases.update_user import UpdateUserUseCase
from use_cases.upsert_user_products import UpdateUserProductsUseCase
from use_cases.reset_password import ResetPasswordUseCase


users_bp = func.Blueprint()


def _json_response(payload, status=HTTPStatus.OK):
    return json_response(payload, status_code=int(status))


def _caller_from_request(req: func.HttpRequest) -> dict:
    auth_header = req.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise PermissionError("Authorization header is required")

    claims = decode_token(auth_header.split(" ", 1)[1].strip())
    caller_id = claims.get("oid")
    if not caller_id:
        raise PermissionError("Invalid token: user ID not found")

    caller = UserSqlAdapter().get_user(caller_id)
    if not caller:
        raise PermissionError("Caller user not found")
    return caller


def _require_admin(req: func.HttpRequest) -> dict:
    caller = _caller_from_request(req)
    if caller.get("role") != "Admin":
        raise PermissionError("Admin role required")
    return caller


def _require_self_or_admin(req: func.HttpRequest, target_user_id: str | None) -> dict:
    caller = _caller_from_request(req)
    if not target_user_id:
        raise ValueError("user_id is required")
    if caller.get("role") == "Admin" or caller.get("id") == target_user_id:
        return caller
    raise PermissionError("Access denied")


def _auth_error(error: PermissionError) -> func.HttpResponse:
    message = str(error)
    status = HTTPStatus.UNAUTHORIZED if "Authorization" in message or "token" in message.lower() else HTTPStatus.FORBIDDEN
    return _json_response({"error": message}, status)


# ---------------------------------------------------------------------------
# POST /api/user — crear usuario (acepta `zones` opcional)
# ---------------------------------------------------------------------------
@users_bp.function_name(name="CreateUser")
@users_bp.route(route="user", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def create_user(req: func.HttpRequest) -> func.HttpResponse:
    try:
        _require_admin(req)
    except PermissionError as error:
        return _auth_error(error)

    try:
        data = req.get_json()
    except ValueError:
        return func.HttpResponse(
            json.dumps({"error": "Request body is not valid JSON."}),
            status_code=HTTPStatus.BAD_REQUEST,
            mimetype=MIMETYPE,
        )
    try:
        graph_repo = UserGraphAdapter()
        sql_repo = UserSqlAdapter()
        zones_repo = UserZonesSqlAdapter()
        use_case = CreateUserUseCase(graph_repo, sql_repo, zones_repo)
        user = use_case.execute(data)

        return func.HttpResponse(
            json.dumps(user),
            status_code=HTTPStatus.CREATED,
            mimetype=MIMETYPE,
        )
    except ValueError as verror:
        return func.HttpResponse(
            json.dumps(dict(error=str(verror))),
            status_code=HTTPStatus.BAD_REQUEST,
            mimetype=MIMETYPE,
        )
    except Exception as error:
        logging.exception("CreateUser failed")
        return _json_response({"error": "Create user failed"}, HTTPStatus.INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# GET /api/user — listar usuarios (no incluye zones, sería N+1)
# ---------------------------------------------------------------------------
@users_bp.function_name(name="ListUsers")
@users_bp.route(route="user", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def list_users(req: func.HttpRequest) -> func.HttpResponse:
    try:
        _require_admin(req)
        sql_repo = UserSqlAdapter()
        use_case = ListUsersUseCase(sql_repo)
        users = use_case.execute()

        return func.HttpResponse(
            json.dumps(users),
            status_code=HTTPStatus.OK,
            mimetype=MIMETYPE,
        )
    except PermissionError as error:
        return _auth_error(error)
    except Exception as error:
        logging.exception("ListUsers failed")
        return _json_response({"error": "List users failed"}, HTTPStatus.INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# GET /api/user/{user_id} — detalle de usuario CON zonas asignadas
# ---------------------------------------------------------------------------
@users_bp.function_name(name="GetUser")
@users_bp.route(
    route="user/{user_id}", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS
)
def get_user(req: func.HttpRequest) -> func.HttpResponse:
    try:
        user_id = req.route_params.get("user_id")
        _require_self_or_admin(req, user_id)
        sql_repo = UserSqlAdapter()
        zones_repo = UserZonesSqlAdapter()
        use_case = GetUserUseCase(sql_repo, zones_repo)
        user = use_case.execute(user_id)

        if not user:
            return func.HttpResponse(
                json.dumps({"error": "User not found"}),
                status_code=HTTPStatus.NOT_FOUND,
                mimetype=MIMETYPE,
            )

        return func.HttpResponse(
            json.dumps(user),
            status_code=HTTPStatus.OK,
            mimetype=MIMETYPE,
        )
    except PermissionError as error:
        return _auth_error(error)
    except ValueError as error:
        return _json_response({"error": str(error)}, HTTPStatus.BAD_REQUEST)
    except Exception as error:
        logging.exception("GetUser failed")
        return _json_response({"error": "Get user failed"}, HTTPStatus.INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# PUT /api/user/{user_id} — editar usuario; si trae `zones` hace upsert
# ---------------------------------------------------------------------------
@users_bp.function_name(name="UpdateUser")
@users_bp.route(
    route="user/{user_id}", methods=["PUT"], auth_level=func.AuthLevel.ANONYMOUS
)
def update_user(req: func.HttpRequest) -> func.HttpResponse:
    user_id = req.route_params.get("user_id")
    try:
        _require_admin(req)
    except PermissionError as error:
        return _auth_error(error)

    try:
        data = req.get_json()
    except ValueError:
        return func.HttpResponse(
            json.dumps({"error": "Invalid JSON"}),
            status_code=HTTPStatus.BAD_REQUEST,
            mimetype=MIMETYPE,
        )
    try:
        if not user_id:
            return _json_response({"error": "user_id is required"}, HTTPStatus.BAD_REQUEST)

        sql_repo = UserSqlAdapter()
        current_user = sql_repo.get_user(user_id)
        if not current_user:
            return _json_response({"error": "User not found"}, HTTPStatus.NOT_FOUND)

        user = User(
            id=user_id,
            # Email/UPN is identity data. Preserve the stored value even if a
            # stale or manipulated client payload includes a different email.
            email=current_user.get("email"),
            department=current_user.get("department") or "IngenialAI",
            display_name=data.get("display_name", current_user.get("display_name")),
            type_person=data.get("type_person", current_user.get("type_person")),
            type_dni=data.get("type_dni", current_user.get("type_dni")),
            identity_document=data.get("identity_document", current_user.get("identity_document")),
            reference=data.get("reference", current_user.get("reference")),
            reference2=data.get("reference2", current_user.get("reference2")),
            personal_email=data.get("personal_email", current_user.get("personal_email")),
            enable=data.get("enable", current_user.get("enable")),
            phone=data.get("phone", current_user.get("phone")),
            role=data.get("role", current_user.get("role")),
        )

        # `zones` puede no venir → None (no se tocan asignaciones existentes)
        # o venir como lista (incluso vacía) → se hace upsert transaccional.
        zones = data.get("zones") if "zones" in data else None

        use_case = UpdateUserUseCase(
            UserGraphAdapter(), sql_repo, UserZonesSqlAdapter()
        )
        use_case.execute(user, zones=zones)

        return func.HttpResponse(
            status_code=HTTPStatus.NO_CONTENT,
            mimetype=MIMETYPE,
        )
    except ValueError as verror:
        # ValueError lo lanza el zones adapter cuando hay inconsistencias
        # (ej. cod_mun no pertenece al cod_dep declarado).
        return func.HttpResponse(
            json.dumps({"error": str(verror)}),
            status_code=HTTPStatus.BAD_REQUEST,
            mimetype=MIMETYPE,
        )
    except Exception as error:
        logging.exception("UpdateUser failed")
        return _json_response({"error": "Update user failed"}, HTTPStatus.INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# POST /api/user/{user_id}/reset-password — restablecer contrasena (Admin)
# ---------------------------------------------------------------------------
@users_bp.function_name(name="ResetUserPassword")
@users_bp.route(
    route="user/{user_id}/reset-password",
    methods=["POST"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def reset_user_password(req: func.HttpRequest) -> func.HttpResponse:
    """Solo Admin puede restablecer la contrasena de otro usuario.
    Body: { "new_password": "...", "force_change_next_signin": true }
    """
    user_id = req.route_params.get("user_id")
    try:
        caller = _require_admin(req)
    except PermissionError as error:
        return _auth_error(error)

    if not user_id:
        return _json_response({"error": "user_id is required"}, HTTPStatus.BAD_REQUEST)

    try:
        data = req.get_json()
    except ValueError:
        return _json_response({"error": "Invalid JSON body"}, HTTPStatus.BAD_REQUEST)

    new_password = (data or {}).get("new_password", "")
    force_change = (data or {}).get("force_change_next_signin", True)

    if not new_password:
        return _json_response({"error": "new_password is required"}, HTTPStatus.BAD_REQUEST)

    try:
        ResetPasswordUseCase(UserGraphAdapter()).execute(
            user_id=user_id,
            new_password=new_password,
            force_change_next_signin=bool(force_change),
        )
        logging.info("ResetUserPassword: user_id=%s reset by admin=%s", user_id, caller.get("id"))
        return func.HttpResponse(status_code=HTTPStatus.NO_CONTENT, mimetype=MIMETYPE)
    except ValueError as verr:
        return _json_response({"error": str(verr)}, HTTPStatus.BAD_REQUEST)
    except Exception:
        logging.exception("ResetUserPassword failed for user_id=%s", user_id)
        return _json_response({"error": "No se pudo restablecer la contrasena."}, HTTPStatus.INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# DELETE /api/user/{user_id} — eliminar usuario completo
# ---------------------------------------------------------------------------
@users_bp.function_name(name="DeleteUser")
@users_bp.route(
    route="user/{user_id}", methods=["DELETE"], auth_level=func.AuthLevel.ANONYMOUS
)
def delete_user(req: func.HttpRequest) -> func.HttpResponse:
    user_id = req.route_params.get("user_id")
    try:
        caller = _require_admin(req)
    except PermissionError as error:
        return _auth_error(error)

    if not user_id:
        return _json_response({"error": "user_id is required"}, HTTPStatus.BAD_REQUEST)
    if caller.get("id") == user_id:
        return _json_response(
            {"error": "No puedes eliminar tu propio usuario activo."},
            HTTPStatus.BAD_REQUEST,
        )

    try:
        try:
            UserGraphAdapter().delete_user(user_id)
        except Exception:
            logging.warning(
                "DeleteUser: Graph delete failed for user_id=%s; continuing with local deletion",
                user_id,
                exc_info=True,
            )
        UserSqlAdapter().delete_user(user_id)
        return func.HttpResponse(status_code=HTTPStatus.NO_CONTENT, mimetype=MIMETYPE)
    except LookupError:
        return _json_response({"error": "User not found"}, HTTPStatus.NOT_FOUND)
    except Exception:
        logging.exception("DeleteUser failed")
        return _json_response({"error": "Delete user failed"}, HTTPStatus.INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# PUT /api/user/{user_id}/zones — endpoint focalizado para re-asignar zonas
# ---------------------------------------------------------------------------
@users_bp.function_name(name="UpsertUserZones")
@users_bp.route(
    route="user/{user_id}/zones",
    methods=["PUT"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def upsert_user_zones(req: func.HttpRequest) -> func.HttpResponse:
    """Reemplaza las asignaciones geográficas del usuario sin tocar el resto
    de su perfil. Body: `{"zones": [{"cod_dep": "05"}, {"cod_dep": "11",
    "cod_mun": "001"}]}` o directamente la lista."""
    user_id = req.route_params.get("user_id")
    try:
        _require_admin(req)
    except PermissionError as error:
        return _auth_error(error)

    try:
        data = req.get_json()
    except ValueError:
        return func.HttpResponse(
            json.dumps({"error": "Invalid JSON"}),
            status_code=HTTPStatus.BAD_REQUEST,
            mimetype=MIMETYPE,
        )
    try:
        # Aceptamos dos formatos: {"zones": [...]} o [...] directo
        if isinstance(data, dict):
            zones = data.get("zones", [])
        elif isinstance(data, list):
            zones = data
        else:
            zones = []

        UserZonesSqlAdapter().upsert_user_zones(user_id, zones)

        return func.HttpResponse(
            status_code=HTTPStatus.NO_CONTENT,
            mimetype=MIMETYPE,
        )
    except ValueError as verror:
        return func.HttpResponse(
            json.dumps({"error": str(verror)}),
            status_code=HTTPStatus.BAD_REQUEST,
            mimetype=MIMETYPE,
        )
    except Exception as error:
        logging.exception("UpsertUserZones failed")
        return _json_response({"error": "Update zones failed"}, HTTPStatus.INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# PUT /api/user-products/{user_id} — ACTUALIZADO: Productos + Zonas
# ---------------------------------------------------------------------------
@users_bp.function_name(name="UpsertUserProducts")
@users_bp.route(
    route="user-products/{user_id}",
    methods=["PUT"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def upsert_user_products(req: func.HttpRequest) -> func.HttpResponse:
    """
    Upsert de productos con zonas geográficas anidadas.

    Body esperado:
    [
      {
        "id": null,
        "name": "Votometro",
        "contract_duration": 1,
        "duration_unit": "years",
        "enable": true,
        "amount_cop": 150000,
        "zones": [
          {"cod_dep": "05", "cod_mun": null},
          {"cod_dep": "81", "cod_mun": "001"}
        ]
      }
    ]
    """
    user_id = req.route_params.get("user_id")
    try:
        _require_admin(req)
    except PermissionError as error:
        return _auth_error(error)

    try:
        data = req.get_json()
    except ValueError:
        return func.HttpResponse(
            json.dumps({"error": "Invalid JSON"}),
            status_code=HTTPStatus.BAD_REQUEST,
            mimetype=MIMETYPE,
        )
    try:
        # Esperar array de productos o dict con key 'products'
        products = data if isinstance(data, list) else data.get("products", [])

        use_case = UpdateUserProductsUseCase(UserProductsSqlAdapter())
        use_case.execute(user_id, products)

        return func.HttpResponse(
            status_code=HTTPStatus.NO_CONTENT,
            mimetype=MIMETYPE,
        )
    except ValueError as verror:
        logging.exception(f"UpsertUserProducts validation error: {verror}")
        return func.HttpResponse(
            json.dumps({"error": str(verror)}),
            status_code=HTTPStatus.BAD_REQUEST,
            mimetype=MIMETYPE,
        )
    except Exception as error:
        logging.exception("UpsertUserProducts failed")
        return _json_response({"error": "Update products failed"}, HTTPStatus.INTERNAL_SERVER_ERROR)
