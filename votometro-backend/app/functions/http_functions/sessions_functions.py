import azure.functions as func
import logging
import json

from http import HTTPStatus
from app.sql.session_sql_adapter import SessionSqlAdapter
from app.sql.user_sql_adapter import UserSqlAdapter
from shared.utils import MIMETYPE, decode_token, json_response
from use_cases.get_users_sessions_info import GetUsersSessionsInfoUseCase
from use_cases.invalidate_session import InvalidateSessionUseCase
from use_cases.validate_session import ValidateSessionUseCase
from use_cases.force_logout_all_devices import ForceLogoutAllDevicesUseCase


sessions_bp = func.Blueprint()


def _json_response(payload, status=HTTPStatus.OK):
    """Wrapper local: delega al helper central (bytes UTF-8 garantizados)."""
    return json_response(payload, status_code=int(status))


# ---------------------------------------------------------------------------
# POST /api/session
# ---------------------------------------------------------------------------
@sessions_bp.function_name(name="ValidateSession")
@sessions_bp.route(route="session", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def validate_session(req: func.HttpRequest) -> func.HttpResponse:
    logging.error("STEP 1: endpoint hit")
    try:
        data = req.get_json()
        logging.error("STEP 2: json parsed")
        access_token = data.get("access_token")
        device_id = data.get("device_id")
        logging.error("STEP 3: token=%s device=%s", bool(access_token), device_id)

        decoded_token = decode_token(access_token)
        logging.error("STEP 4: oid=%s", decoded_token.get("oid"))

        ipaddr = (
            decoded_token.get("ipaddr")
            or (req.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
            or req.headers.get("X-Real-IP")
            or "0.0.0.0"
        )
        logging.error("STEP 5: ip=%s", ipaddr)

        session_repo = SessionSqlAdapter()
        logging.error("STEP 6: repo ok")
        session_case = ValidateSessionUseCase(session_repo)
        logging.error("STEP 7: use case ok")
        session_token = session_case.execute(decoded_token.get("oid"), ipaddr, device_id)
        logging.error("STEP 8: session created")

        return _json_response({"session_token": session_token}, HTTPStatus.OK)
    except Exception as e:
        import traceback
        logging.error("=== CRASH ===")
        logging.error(traceback.format_exc())
        return _json_response({"error": str(e)}, HTTPStatus.INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# POST /api/invalidate-session
# ---------------------------------------------------------------------------
@sessions_bp.function_name(name="InvalidateSession")
@sessions_bp.route(route="invalidate-session", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def invalidate_session(req: func.HttpRequest) -> func.HttpResponse:
    try:
        data = req.get_json()
    except ValueError:
        return _json_response({"error": "Request body is not valid JSON."}, HTTPStatus.BAD_REQUEST)
    try:
        session_repo = SessionSqlAdapter()
        session_identifier = data.get("session_id") or data.get("session_token")
        if session_identifier:
            auth_header = req.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                return _json_response({"error": "Authorization header is required"}, HTTPStatus.UNAUTHORIZED)
            decode_token(auth_header.replace("Bearer ", ""))
            session_repo.invalidate_session_identifier(session_identifier)
        else:
            access_token = data.get("access_token")
            device_id = data.get("device_id")
            decoded_token = decode_token(access_token)
            session_case = InvalidateSessionUseCase(session_repo)
            session_case.execute(decoded_token.get("oid"), device_id)

        return func.HttpResponse(status_code=HTTPStatus.NO_CONTENT, mimetype=MIMETYPE)
    except ValueError as verror:
        return _json_response({"error": str(verror)}, HTTPStatus.CONFLICT)
    except Exception as error:
        logging.error("InvalidateSession: %s", error)
        return _json_response({"error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# POST /api/admin/sessions/revoke
# ---------------------------------------------------------------------------
@sessions_bp.function_name(name="AdminRevokeSession")
@sessions_bp.route(route="manage/sessions/revoke", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def admin_revoke_session(req: func.HttpRequest) -> func.HttpResponse:
    try:
        auth_header = req.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return _json_response({"error": "Authorization header is required"}, HTTPStatus.UNAUTHORIZED)
        try:
            data = req.get_json()
        except ValueError:
            return _json_response({"error": "Request body is not valid JSON."}, HTTPStatus.BAD_REQUEST)

        claims = decode_token(auth_header.replace("Bearer ", ""))
        admin_id = claims.get("oid")
        if not admin_id:
            return _json_response({"error": "Invalid token: user ID not found"}, HTTPStatus.UNAUTHORIZED)

        admin = UserSqlAdapter().get_user(admin_id)
        if not admin or admin.get("role") != "Admin":
            return _json_response({"error": "Admin role required"}, HTTPStatus.FORBIDDEN)

        session_id = data.get("session_id") or data.get("sessionId")
        if not session_id:
            return _json_response({"error": "session_id is required"}, HTTPStatus.BAD_REQUEST)

        SessionSqlAdapter().revoke_session(session_id)
        return _json_response({"status": "Revoked_by_Admin"}, HTTPStatus.OK)
    except LookupError as error:
        return _json_response({"error": str(error)}, HTTPStatus.NOT_FOUND)
    except Exception as error:
        logging.exception("Error en revoke")
        return _json_response({"error": "Session revoke failed", "detail": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# PUT /api/sessions/heartbeat
# ---------------------------------------------------------------------------
@sessions_bp.function_name(name="SessionHeartbeat")
@sessions_bp.route(route="sessions/heartbeat", methods=["PUT"], auth_level=func.AuthLevel.ANONYMOUS)
def session_heartbeat(req: func.HttpRequest) -> func.HttpResponse:
    try:
        auth_header = req.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return _json_response({"error": "Authorization header is required"}, HTTPStatus.UNAUTHORIZED)
        try:
            data = req.get_json()
        except ValueError:
            return _json_response({"error": "Request body is not valid JSON."}, HTTPStatus.BAD_REQUEST)

        access_token = auth_header.replace("Bearer ", "")
        decoded_token = decode_token(access_token)
        user_id = decoded_token.get("oid")
        session_token = data.get("session_token")
        pages = data.get("pages", [])

        if not user_id:
            return _json_response({"error": "Invalid token: user ID not found"}, HTTPStatus.UNAUTHORIZED)
        if not session_token:
            return _json_response({"error": "session_token is required"}, HTTPStatus.BAD_REQUEST)
        if not isinstance(pages, list):
            return _json_response({"error": "pages must be an array"}, HTTPStatus.BAD_REQUEST)

        result = SessionSqlAdapter().record_heartbeat(
            user_id=user_id,
            session_token=session_token,
            pages=pages,
            idle_timeout_seconds=7200,
        )
        return _json_response(result, HTTPStatus.OK)
    except PermissionError as error:
        logging.warning("Session heartbeat rejected: %s", error)
        payload = (
            {"code": "SESSION_REVOKED", "error": "Session revoked by administrator"}
            if str(error) == "SESSION_REVOKED"
            else {"error": str(error)}
        )
        return _json_response(payload, HTTPStatus.UNAUTHORIZED)
    except Exception as error:
        logging.exception("Error in sessions heartbeat endpoint")
        return _json_response({"error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# GET /api/users-sessions
# ---------------------------------------------------------------------------
@sessions_bp.function_name(name="GetUsersSessionsInfo")
@sessions_bp.route(route="users-sessions", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def get_users_sessions_info(req: func.HttpRequest) -> func.HttpResponse:
    try:
        auth_header = req.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return _json_response({"error": "Authorization header is required"}, HTTPStatus.UNAUTHORIZED)

        access_token = auth_header.replace("Bearer ", "")
        decoded_token = decode_token(access_token)
        user_id = decoded_token.get("oid")
        if not user_id:
            return _json_response({"error": "Invalid token: user ID not found"}, HTTPStatus.UNAUTHORIZED)

        user_repo = UserSqlAdapter()
        user_data = user_repo.get_user(user_id)
        is_admin = user_data.get("role") == "Admin" if user_data else False

        session_repo = SessionSqlAdapter()
        if is_admin:
            session_case = GetUsersSessionsInfoUseCase(session_repo)
            result = session_case.execute()
        else:
            device_id = req.params.get("device_id")
            if not device_id:
                return _json_response({"error": "device_id query parameter is required"}, HTTPStatus.BAD_REQUEST)
            active_session = session_repo.get_active_session(user_id, device_id)
            result = [active_session] if active_session else []

        return _json_response(result, HTTPStatus.OK)
    except ValueError as verror:
        logging.exception("Error in users-sessions endpoint")
        return _json_response({"error": str(verror)}, HTTPStatus.UNAUTHORIZED)
    except Exception as error:
        logging.exception("Error in users-sessions endpoint")
        return _json_response({"error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)


# ---------------------------------------------------------------------------
# GET /api/admin/sessions/{session_id}/detail
# ---------------------------------------------------------------------------
@sessions_bp.function_name(name="GetSessionActivityDetail")
@sessions_bp.route(
    route="manage/sessions/{session_id}/detail",
    methods=["GET"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def get_session_activity_detail(req: func.HttpRequest) -> func.HttpResponse:
    """Devuelve datos de sesion + logs de navegacion. Requiere rol Admin."""
    session_id = None
    try:
        # Auth
        auth_header = req.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return _json_response({"error": "Authorization header is required"}, HTTPStatus.UNAUTHORIZED)

        decoded_token = decode_token(auth_header.replace("Bearer ", ""))
        user_id = decoded_token.get("oid")
        if not user_id:
            return _json_response({"error": "Invalid token: user ID not found"}, HTTPStatus.UNAUTHORIZED)

        user_data = UserSqlAdapter().get_user(user_id)
        if not user_data or user_data.get("role") != "Admin":
            return _json_response({"error": "Admin role required"}, HTTPStatus.FORBIDDEN)

        # Parametro
        session_id = req.route_params.get("session_id", "").strip()
        if not session_id:
            return _json_response({"error": "session_id es requerido"}, HTTPStatus.BAD_REQUEST)

        logging.info("[GetSessionActivityDetail] session_id=%s caller=%s", session_id, user_id)

        # Consulta
        detail = SessionSqlAdapter().get_session_activity_detail(session_id)
        logging.info(
            "[GetSessionActivityDetail] OK session_id=%s pages=%d",
            session_id, len(detail.get("pages", [])),
        )
        return _json_response(detail, HTTPStatus.OK)

    except LookupError as error:
        logging.warning("[GetSessionActivityDetail] Not found session_id=%s: %s", session_id, error)
        return _json_response({"error": str(error)}, HTTPStatus.NOT_FOUND)
    except Exception as error:
        logging.exception(
            "[GetSessionActivityDetail] FALLO session_id=%s | %s: %s",
            session_id, type(error).__name__, error,
        )
        return _json_response(
            {"error": "Fallo al obtener detalle de sesion", "type": type(error).__name__, "detail": str(error)},
            HTTPStatus.INTERNAL_SERVER_ERROR,
        )


# ---------------------------------------------------------------------------
# POST /api/session/force-logout-all
# ---------------------------------------------------------------------------
@sessions_bp.function_name(name="ForceLogoutAllDevices")
@sessions_bp.route(route="session/force-logout-all", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def force_logout_all_devices(req: func.HttpRequest) -> func.HttpResponse:
    try:
        data = req.get_json()
    except ValueError:
        return _json_response({"error": "Request body is not valid JSON."}, HTTPStatus.BAD_REQUEST)
    try:
        access_token = data.get("access_token")
        decoded_token = decode_token(access_token)
        session_repo = SessionSqlAdapter()
        session_case = ForceLogoutAllDevicesUseCase(session_repo)
        session_case.execute(decoded_token.get("oid"))
        return func.HttpResponse(status_code=HTTPStatus.NO_CONTENT, mimetype=MIMETYPE)
    except Exception as error:
        logging.error("ForceLogoutAllDevices: %s", error)
        return _json_response({"error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)
