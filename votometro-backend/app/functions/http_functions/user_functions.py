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
from shared.utils import MIMETYPE

from app.sql.user_sql_adapter import UserSqlAdapter
from app.sql.user_zones_sql_adapter import UserZonesSqlAdapter
from app.sql.user_products_sql_adapter import UserProductsSqlAdapter
from app.ms_graph.user_graph_adapter import UserGraphAdapter
from use_cases.create_user import CreateUserUseCase
from use_cases.get_user import GetUserUseCase
from use_cases.list_users import ListUsersUseCase
from use_cases.update_user import UpdateUserUseCase
from use_cases.upsert_user_products import UpdateUserProductsUseCase


users_bp = func.Blueprint()


# ---------------------------------------------------------------------------
# POST /api/user — crear usuario (acepta `zones` opcional)
# ---------------------------------------------------------------------------
@users_bp.function_name(name="CreateUser")
@users_bp.route(route="user", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def create_user(req: func.HttpRequest) -> func.HttpResponse:
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
        logging.error(f"CreateUser: {error}")
        return func.HttpResponse(
            json.dumps(dict(error=str(error))),
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            mimetype=MIMETYPE,
        )


# ---------------------------------------------------------------------------
# GET /api/user — listar usuarios (no incluye zones, sería N+1)
# ---------------------------------------------------------------------------
@users_bp.function_name(name="ListUsers")
@users_bp.route(route="user", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def list_users(req: func.HttpRequest) -> func.HttpResponse:
    try:
        sql_repo = UserSqlAdapter()
        use_case = ListUsersUseCase(sql_repo)
        users = use_case.execute()

        return func.HttpResponse(
            json.dumps(users),
            status_code=HTTPStatus.OK,
            mimetype=MIMETYPE,
        )
    except Exception as error:
        logging.error(f"ListUsers: {error}")
        return func.HttpResponse(
            json.dumps(dict(error=str(error))),
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            mimetype=MIMETYPE,
        )


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
    except Exception as error:
        logging.error(f"GetUser: {error}")
        return func.HttpResponse(
            json.dumps(dict(error=str(error))),
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            mimetype=MIMETYPE,
        )


# ---------------------------------------------------------------------------
# PUT /api/user/{user_id} — editar usuario; si trae `zones` hace upsert
# ---------------------------------------------------------------------------
@users_bp.function_name(name="UpdateUser")
@users_bp.route(
    route="user/{user_id}", methods=["PUT"], auth_level=func.AuthLevel.ANONYMOUS
)
def update_user(req: func.HttpRequest) -> func.HttpResponse:
    try:
        data = req.get_json()
    except ValueError:
        return func.HttpResponse(
            json.dumps({"error": "Invalid JSON"}),
            status_code=HTTPStatus.BAD_REQUEST,
            mimetype=MIMETYPE,
        )
    try:
        user_id = req.route_params.get("user_id")
        user = User(
            id=user_id,
            email=data.get("email"),
            display_name=data.get("display_name"),
            type_person=data.get("type_person"),
            type_dni=data.get("type_dni"),
            identity_document=data.get("identity_document"),
            reference=data.get("reference"),
            reference2=data.get("reference2"),
            personal_email=data.get("personal_email"),
            enable=data.get("enable"),
            phone=data.get("phone"),
            role=data.get("role"),
        )

        # `zones` puede no venir → None (no se tocan asignaciones existentes)
        # o venir como lista (incluso vacía) → se hace upsert transaccional.
        zones = data.get("zones") if "zones" in data else None

        use_case = UpdateUserUseCase(
            UserGraphAdapter(), UserSqlAdapter(), UserZonesSqlAdapter()
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
        logging.error(f"UpdateUser: {error}")
        return func.HttpResponse(
            json.dumps(dict(error=str(error))),
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            mimetype=MIMETYPE,
        )


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
    try:
        data = req.get_json()
    except ValueError:
        return func.HttpResponse(
            json.dumps({"error": "Invalid JSON"}),
            status_code=HTTPStatus.BAD_REQUEST,
            mimetype=MIMETYPE,
        )
    try:
        user_id = req.route_params.get("user_id")
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
        logging.error(f"UpsertUserZones: {error}")
        return func.HttpResponse(
            json.dumps(dict(error=str(error))),
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            mimetype=MIMETYPE,
        )


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
    try:
        data = req.get_json()
    except ValueError:
        return func.HttpResponse(
            json.dumps({"error": "Invalid JSON"}),
            status_code=HTTPStatus.BAD_REQUEST,
            mimetype=MIMETYPE,
        )
    try:
        user_id = req.route_params.get("user_id")

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
        logging.exception(f"UpsertUserProducts: {error}")
        return func.HttpResponse(
            json.dumps(dict(error=str(error))),
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            mimetype=MIMETYPE,
        )
