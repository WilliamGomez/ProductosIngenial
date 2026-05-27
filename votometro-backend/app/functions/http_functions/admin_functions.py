"""Endpoints administrativos (RBAC).

Toda función aquí pasa por `_require_admin`, que:
  · Verifica el JWT (firma + audiencia + exp) vía `decode_token`.
  · Resuelve el `oid` del caller y consulta SQL para confirmar que su rol
    es `Admin`. Sin esto, devuelve 401/403.

Hallazgos de seguridad mitigados (C-01, C-04, C-06):
  · Verificación JWT obligatoria antes de cualquier cambio de estado.
  · Cuerpos sensibles (passwords) no se loggean — los handlers loguean
    solo IDs y mensajes de error.
  · Las transacciones críticas (matriz de permisos) están en el adapter.
"""
import json
import logging
from http import HTTPStatus
from typing import Optional, Tuple
from uuid import UUID

import azure.functions as func

from app.sql.rbac_sql_adapter import RbacSqlAdapter
from app.sql.product_catalog_sql_adapter import ProductCatalogSqlAdapter
from app.sql.user_sql_adapter import UserSqlAdapter
from domain.exceptions import (
    InvalidPermissionException,
    RoleAlreadyExistsException,
    RoleNotFoundException,
    SystemRoleProtectedException,
)
from shared.utils import MIMETYPE, decode_token
from use_cases.create_role import CreateRoleUseCase
from use_cases.delete_role import DeleteRoleUseCase
from use_cases.get_role import GetRoleUseCase
from use_cases.list_permissions import ListPermissionsUseCase
from use_cases.list_roles import ListRolesUseCase
from use_cases.update_role import UpdateRoleUseCase
from use_cases.update_role_permissions import UpdateRolePermissionsUseCase


admin_bp = func.Blueprint()


# =============================================================================
# Barrera de seguridad: solo Admin
# =============================================================================
def _require_admin(
    req: func.HttpRequest,
) -> Tuple[Optional[dict], Optional[func.HttpResponse]]:
    """Valida `Authorization: Bearer <jwt>` y rol Admin en SQL.

    Devuelve `(decoded_token, None)` si el caller es Admin, o
    `(None, HttpResponse)` con la respuesta de error correspondiente.
    """
    auth_header = req.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None, func.HttpResponse(
            json.dumps({"error": "Authorization header is required"}),
            status_code=HTTPStatus.UNAUTHORIZED,
            mimetype=MIMETYPE,
        )

    access_token = auth_header.replace("Bearer ", "")
    try:
        decoded = decode_token(access_token)
    except ValueError as verr:
        return None, func.HttpResponse(
            json.dumps({"error": str(verr)}),
            status_code=HTTPStatus.UNAUTHORIZED,
            mimetype=MIMETYPE,
        )

    caller_oid = decoded.get("oid")
    if not caller_oid:
        return None, func.HttpResponse(
            json.dumps({"error": "Token missing oid claim"}),
            status_code=HTTPStatus.UNAUTHORIZED,
            mimetype=MIMETYPE,
        )

    sql_repo = UserSqlAdapter()
    caller_user = sql_repo.get_user(caller_oid)
    if not caller_user or caller_user.get("role") != "Admin":
        return None, func.HttpResponse(
            json.dumps({"error": "Forbidden: admin role required"}),
            status_code=HTTPStatus.FORBIDDEN,
            mimetype=MIMETYPE,
        )

    return decoded, None


# =============================================================================
# Serialización compartida
# =============================================================================
def _serialize_role(role) -> dict:
    return {
        "id": role.id,
        "name": role.name,
        "description": role.description,
        "is_active": role.is_active,
        "is_system": role.is_system,
        "created_at": role.created_at.isoformat() if role.created_at else None,
        "permissions": [
            {
                "id": p.id,
                "name": p.name,
                "resource": p.resource,
                "action": p.action,
                "module": p.module,
            }
            for p in role.permissions
        ],
    }


def _json_response(payload, status=HTTPStatus.OK) -> func.HttpResponse:
    body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
    return func.HttpResponse(body=body, status_code=int(status), mimetype=MIMETYPE)


def _validate_product_report_payload(data: dict) -> dict:
    name = str(data.get("name") or "").strip()
    display_name = str(data.get("display_name") or name).strip()
    route_path = str(data.get("route_path") or "").strip().lower()
    report_id = str(data.get("powerbi_report_id") or "").strip()
    workspace_id = str(data.get("powerbi_workspace_id") or "").strip() or None
    tenant_id = str(data.get("powerbi_tenant_id") or "").strip() or None

    if not name:
        raise ValueError("name is required")
    if not route_path.startswith("/"):
        raise ValueError("route_path must start with /")
    if not report_id:
        raise ValueError("powerbi_report_id is required")
    try:
        report_id = str(UUID(report_id))
    except ValueError as exc:
        if "app.powerbi.com/view" in report_id.lower():
            raise ValueError(
                "powerbi_report_id must be the secure Power BI report GUID, not a publish-to-web /view?r= URL."
            ) from exc
        raise ValueError("powerbi_report_id must be a valid GUID") from exc
    if workspace_id:
        try:
            workspace_id = str(UUID(workspace_id))
        except ValueError as exc:
            raise ValueError("powerbi_workspace_id must be a valid GUID or empty") from exc
    if tenant_id:
        try:
            tenant_id = str(UUID(tenant_id))
        except ValueError as exc:
            raise ValueError("powerbi_tenant_id must be a valid GUID or empty") from exc

    return {
        "id": data.get("id"),
        "name": name,
        "display_name": display_name,
        "route_path": route_path,
        "powerbi_report_id": report_id,
        "powerbi_workspace_id": workspace_id,
        "powerbi_tenant_id": tenant_id,
        "icon": str(data.get("icon") or "BarChart3").strip(),
        "display_order": int(data.get("display_order") or 100),
        "is_report_enabled": bool(data.get("is_report_enabled", True)),
        "description": str(data.get("description") or "").strip() or None,
    }


# =============================================================================
# GET/POST /admin/products   -> catalogo de productos embebibles Power BI
# =============================================================================
def _list_product_report_catalog(req: func.HttpRequest) -> func.HttpResponse:
    _, deny = _require_admin(req)
    if deny:
        return deny
    try:
        include_disabled = str(req.params.get("include_disabled", "1")).lower() in {
            "1",
            "true",
            "yes",
        }
        rows = ProductCatalogSqlAdapter().list_products(include_disabled=include_disabled)
        return _json_response(rows, HTTPStatus.OK)
    except Exception as e:
        logging.exception("ListProductReportCatalog failed: %s", e)
        return _json_response({"error": "Internal error"}, HTTPStatus.INTERNAL_SERVER_ERROR)


def _upsert_product_report_catalog(req: func.HttpRequest) -> func.HttpResponse:
    _, deny = _require_admin(req)
    if deny:
        return deny
    try:
        data = req.get_json() or {}
        payload = _validate_product_report_payload(data)
        row = ProductCatalogSqlAdapter().upsert_product(payload)
        return _json_response(row, HTTPStatus.OK)
    except ValueError as err:
        return _json_response({"error": str(err)}, HTTPStatus.BAD_REQUEST)
    except Exception as e:
        logging.exception("UpsertProductReportCatalog failed: %s", e)
        return _json_response({"error": "Internal error"}, HTTPStatus.INTERNAL_SERVER_ERROR)


@admin_bp.function_name(name="ListProductReportCatalog")
@admin_bp.route(
    route="products/catalog", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS
)
def list_product_report_catalog(req: func.HttpRequest) -> func.HttpResponse:
    return _list_product_report_catalog(req)


@admin_bp.function_name(name="ListProductReportCatalogLegacy")
@admin_bp.route(
    route="admin/products", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS
)
def list_product_report_catalog_legacy(req: func.HttpRequest) -> func.HttpResponse:
    return _list_product_report_catalog(req)


@admin_bp.function_name(name="UpsertProductReportCatalog")
@admin_bp.route(
    route="products/catalog", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS
)
def upsert_product_report_catalog(req: func.HttpRequest) -> func.HttpResponse:
    return _upsert_product_report_catalog(req)


@admin_bp.function_name(name="UpsertProductReportCatalogLegacy")
@admin_bp.route(
    route="admin/products", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS
)
def upsert_product_report_catalog_legacy(req: func.HttpRequest) -> func.HttpResponse:
    return _upsert_product_report_catalog(req)


# =============================================================================
# GET /permissions   →   catálogo agrupado por módulo
# =============================================================================
@admin_bp.function_name(name="ListPermissions")
@admin_bp.route(
    route="permissions", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS
)
def list_permissions(req: func.HttpRequest) -> func.HttpResponse:
    _, deny = _require_admin(req)
    if deny:
        return deny
    try:
        grouped = ListPermissionsUseCase(RbacSqlAdapter()).execute()
        body = {
            module: [
                {
                    "id": p.id,
                    "name": p.name,
                    "resource": p.resource,
                    "action": p.action,
                    "module": p.module,
                    "description": p.description,
                }
                for p in items
            ]
            for module, items in grouped.items()
        }
        return func.HttpResponse(
            json.dumps(body), status_code=HTTPStatus.OK, mimetype=MIMETYPE
        )
    except Exception as e:
        logging.error("ListPermissions: %s", e)
        return func.HttpResponse(
            json.dumps({"error": "Internal error"}),
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            mimetype=MIMETYPE,
        )


# =============================================================================
# GET /roles   →   listado plano (sin permisos hidratados)
# =============================================================================
@admin_bp.function_name(name="ListRoles")
@admin_bp.route(
    route="roles", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS
)
def list_roles(req: func.HttpRequest) -> func.HttpResponse:
    _, deny = _require_admin(req)
    if deny:
        return deny
    try:
        roles = ListRolesUseCase(RbacSqlAdapter()).execute()
        return func.HttpResponse(
            json.dumps([_serialize_role(r) for r in roles]),
            status_code=HTTPStatus.OK,
            mimetype=MIMETYPE,
        )
    except Exception as e:
        logging.error("ListRoles: %s", e)
        return func.HttpResponse(
            json.dumps({"error": "Internal error"}),
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            mimetype=MIMETYPE,
        )


# =============================================================================
# GET /roles/{role_id}   →   rol con permisos hidratados
# =============================================================================
@admin_bp.function_name(name="GetRole")
@admin_bp.route(
    route="roles/{role_id}", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS
)
def get_role(req: func.HttpRequest) -> func.HttpResponse:
    _, deny = _require_admin(req)
    if deny:
        return deny
    try:
        role = GetRoleUseCase(RbacSqlAdapter()).execute(
            req.route_params.get("role_id")
        )
        return func.HttpResponse(
            json.dumps(_serialize_role(role)),
            status_code=HTTPStatus.OK,
            mimetype=MIMETYPE,
        )
    except RoleNotFoundException as nfe:
        return func.HttpResponse(
            json.dumps({"error": str(nfe)}),
            status_code=HTTPStatus.NOT_FOUND,
            mimetype=MIMETYPE,
        )
    except Exception as e:
        logging.error("GetRole: %s", e)
        return func.HttpResponse(
            json.dumps({"error": "Internal error"}),
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            mimetype=MIMETYPE,
        )


# =============================================================================
# POST /roles   →   crear rol custom
# =============================================================================
@admin_bp.function_name(name="CreateRole")
@admin_bp.route(
    route="roles", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS
)
def create_role(req: func.HttpRequest) -> func.HttpResponse:
    _, deny = _require_admin(req)
    if deny:
        return deny
    try:
        data = req.get_json() or {}
        role = CreateRoleUseCase(RbacSqlAdapter()).execute(
            name=data.get("name"), description=data.get("description")
        )
        return func.HttpResponse(
            json.dumps(_serialize_role(role)),
            status_code=HTTPStatus.CREATED,
            mimetype=MIMETYPE,
        )
    except (ValueError, RoleAlreadyExistsException) as v:
        return func.HttpResponse(
            json.dumps({"error": str(v)}),
            status_code=HTTPStatus.BAD_REQUEST,
            mimetype=MIMETYPE,
        )
    except Exception as e:
        logging.error("CreateRole: %s", e)
        return func.HttpResponse(
            json.dumps({"error": "Internal error"}),
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            mimetype=MIMETYPE,
        )


# =============================================================================
# PUT /roles/{role_id}   →   editar metadata (no permisos)
# =============================================================================
@admin_bp.function_name(name="UpdateRole")
@admin_bp.route(
    route="roles/{role_id}", methods=["PUT"], auth_level=func.AuthLevel.ANONYMOUS
)
def update_role(req: func.HttpRequest) -> func.HttpResponse:
    _, deny = _require_admin(req)
    if deny:
        return deny
    try:
        data = req.get_json() or {}
        role = UpdateRoleUseCase(RbacSqlAdapter()).execute(
            role_id=req.route_params.get("role_id"),
            name=data.get("name"),
            description=data.get("description"),
            is_active=data.get("is_active"),
        )
        return func.HttpResponse(
            json.dumps(_serialize_role(role)),
            status_code=HTTPStatus.OK,
            mimetype=MIMETYPE,
        )
    except RoleNotFoundException as nfe:
        return func.HttpResponse(
            json.dumps({"error": str(nfe)}),
            status_code=HTTPStatus.NOT_FOUND,
            mimetype=MIMETYPE,
        )
    except SystemRoleProtectedException as srp:
        return func.HttpResponse(
            json.dumps({"error": str(srp)}),
            status_code=HTTPStatus.FORBIDDEN,
            mimetype=MIMETYPE,
        )
    except Exception as e:
        logging.error("UpdateRole: %s", e)
        return func.HttpResponse(
            json.dumps({"error": "Internal error"}),
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            mimetype=MIMETYPE,
        )


# =============================================================================
# PUT /roles/{role_id}/permissions   →   reemplazar matriz de permisos
# =============================================================================
@admin_bp.function_name(name="UpdateRolePermissions")
@admin_bp.route(
    route="roles/{role_id}/permissions",
    methods=["PUT"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def update_role_permissions(req: func.HttpRequest) -> func.HttpResponse:
    _, deny = _require_admin(req)
    if deny:
        return deny
    try:
        data = req.get_json() or {}
        permission_ids = data.get("permission_ids", [])
        if not isinstance(permission_ids, list):
            return func.HttpResponse(
                json.dumps({"error": "permission_ids must be a list"}),
                status_code=HTTPStatus.BAD_REQUEST,
                mimetype=MIMETYPE,
            )
        UpdateRolePermissionsUseCase(RbacSqlAdapter()).execute(
            role_id=req.route_params.get("role_id"),
            permission_ids=permission_ids,
        )
        return func.HttpResponse(
            status_code=HTTPStatus.NO_CONTENT, mimetype=MIMETYPE
        )
    except RoleNotFoundException as nfe:
        return func.HttpResponse(
            json.dumps({"error": str(nfe)}),
            status_code=HTTPStatus.NOT_FOUND,
            mimetype=MIMETYPE,
        )
    except InvalidPermissionException as ipe:
        return func.HttpResponse(
            json.dumps({"error": str(ipe)}),
            status_code=HTTPStatus.BAD_REQUEST,
            mimetype=MIMETYPE,
        )
    except Exception as e:
        logging.error("UpdateRolePermissions: %s", e)
        return func.HttpResponse(
            json.dumps({"error": "Internal error"}),
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            mimetype=MIMETYPE,
        )


# =============================================================================
# DELETE /roles/{role_id}   →   eliminar rol (no system)
# =============================================================================
@admin_bp.function_name(name="DeleteRole")
@admin_bp.route(
    route="roles/{role_id}",
    methods=["DELETE"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def delete_role(req: func.HttpRequest) -> func.HttpResponse:
    _, deny = _require_admin(req)
    if deny:
        return deny
    try:
        DeleteRoleUseCase(RbacSqlAdapter()).execute(
            req.route_params.get("role_id")
        )
        return func.HttpResponse(
            status_code=HTTPStatus.NO_CONTENT, mimetype=MIMETYPE
        )
    except RoleNotFoundException as nfe:
        return func.HttpResponse(
            json.dumps({"error": str(nfe)}),
            status_code=HTTPStatus.NOT_FOUND,
            mimetype=MIMETYPE,
        )
    except SystemRoleProtectedException as srp:
        return func.HttpResponse(
            json.dumps({"error": str(srp)}),
            status_code=HTTPStatus.FORBIDDEN,
            mimetype=MIMETYPE,
        )
    except Exception as e:
        logging.error("DeleteRole: %s", e)
        return func.HttpResponse(
            json.dumps({"error": "Internal error"}),
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            mimetype=MIMETYPE,
        )
