import logging
from http import HTTPStatus

import azure.functions as func

from app.sql.mfa_sql_adapter import MfaSqlAdapter
from app.sql.user_sql_adapter import UserSqlAdapter
from shared.utils import decode_token, json_response


mfa_bp = func.Blueprint()


def _json_response(payload, status=HTTPStatus.OK):
    return json_response(payload, status_code=int(status))


def _caller(req: func.HttpRequest) -> dict:
    auth_header = req.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise PermissionError("Authorization header is required")
    claims = decode_token(auth_header.split(" ", 1)[1].strip())
    user_id = claims.get("oid")
    if not user_id:
        raise PermissionError("Invalid token: user ID not found")
    return {"id": user_id, "claims": claims}


def _session_token(req: func.HttpRequest, data: dict | None = None) -> str:
    token = (
        req.headers.get("X-Session-Token")
        or req.headers.get("x-session-token")
        or (data or {}).get("session_token")
        or ""
    )
    if not token:
        raise ValueError("session_token is required")
    return token


def _require_admin(req: func.HttpRequest) -> dict:
    caller = _caller(req)
    user = UserSqlAdapter().get_user(caller["id"])
    if not user or user.get("role") != "Admin":
        raise PermissionError("Admin role required")
    return caller


@mfa_bp.function_name(name="MfaStatus")
@mfa_bp.route(route="mfa/status", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def mfa_status(req: func.HttpRequest) -> func.HttpResponse:
    try:
        caller = _caller(req)
        session_token = req.params.get("session_token") or req.headers.get("X-Session-Token")
        return _json_response(MfaSqlAdapter().get_status(caller["id"], session_token), HTTPStatus.OK)
    except PermissionError as error:
        return _json_response({"error": str(error)}, HTTPStatus.UNAUTHORIZED)
    except Exception:
        logging.exception("MfaStatus failed")
        return _json_response({"error": "MFA status failed"}, HTTPStatus.INTERNAL_SERVER_ERROR)


@mfa_bp.function_name(name="MfaSetupStart")
@mfa_bp.route(route="mfa/setup/start", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def mfa_setup_start(req: func.HttpRequest) -> func.HttpResponse:
    try:
        caller = _caller(req)
        return _json_response(MfaSqlAdapter().start_setup(caller["id"]), HTTPStatus.OK)
    except PermissionError as error:
        return _json_response({"error": str(error)}, HTTPStatus.UNAUTHORIZED)
    except Exception:
        logging.exception("MfaSetupStart failed")
        return _json_response({"error": "MFA setup failed"}, HTTPStatus.INTERNAL_SERVER_ERROR)


@mfa_bp.function_name(name="MfaSetupVerify")
@mfa_bp.route(route="mfa/setup/verify", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def mfa_setup_verify(req: func.HttpRequest) -> func.HttpResponse:
    try:
        caller = _caller(req)
        data = req.get_json()
        result = MfaSqlAdapter().verify_setup(
            caller["id"],
            _session_token(req, data),
            str(data.get("code") or ""),
        )
        return _json_response(result, HTTPStatus.OK)
    except (ValueError, PermissionError) as error:
        return _json_response({"error": str(error)}, HTTPStatus.UNAUTHORIZED)
    except Exception:
        logging.exception("MfaSetupVerify failed")
        return _json_response({"error": "MFA verification failed"}, HTTPStatus.INTERNAL_SERVER_ERROR)


@mfa_bp.function_name(name="MfaChallengeVerify")
@mfa_bp.route(route="mfa/challenge/verify", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def mfa_challenge_verify(req: func.HttpRequest) -> func.HttpResponse:
    try:
        caller = _caller(req)
        data = req.get_json()
        result = MfaSqlAdapter().verify_challenge(
            caller["id"],
            _session_token(req, data),
            str(data.get("code") or ""),
        )
        return _json_response(result, HTTPStatus.OK)
    except (ValueError, PermissionError) as error:
        return _json_response({"error": str(error)}, HTTPStatus.UNAUTHORIZED)
    except Exception:
        logging.exception("MfaChallengeVerify failed")
        return _json_response({"error": "MFA verification failed"}, HTTPStatus.INTERNAL_SERVER_ERROR)


@mfa_bp.function_name(name="AdminResetUserMfa")
@mfa_bp.route(route="admin/users/{user_id}/mfa/reset", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def admin_reset_user_mfa(req: func.HttpRequest) -> func.HttpResponse:
    try:
        _require_admin(req)
        user_id = req.route_params.get("user_id")
        if not user_id:
            return _json_response({"error": "user_id is required"}, HTTPStatus.BAD_REQUEST)
        MfaSqlAdapter().reset_user_mfa(user_id)
        return _json_response({"status": "MFA_RESET"}, HTTPStatus.OK)
    except PermissionError as error:
        return _json_response({"error": str(error)}, HTTPStatus.FORBIDDEN)
    except Exception:
        logging.exception("AdminResetUserMfa failed")
        return _json_response({"error": "MFA reset failed"}, HTTPStatus.INTERNAL_SERVER_ERROR)
