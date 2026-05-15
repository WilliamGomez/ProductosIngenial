import azure.functions as func
import logging
import json

from http import HTTPStatus
from shared.utils import MIMETYPE, decode_token
from app.sql.user_sql_adapter import UserSqlAdapter
from app.sql.session_sql_adapter import SessionSqlAdapter


power_bi_bp = func.Blueprint()


def _resolve_user(req: func.HttpRequest) -> dict:
    auth_header = req.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise ValueError("Authorization header is required")
    access_token = auth_header.split(" ", 1)[1].strip()
    if not access_token:
        raise ValueError("Empty bearer token")
    claims = decode_token(access_token)
    user_id = claims.get("oid")
    if not user_id:
        raise ValueError("Invalid token: 'oid' claim missing")
    user = UserSqlAdapter().get_user(user_id)
    if not user:
        raise LookupError(f"User {user_id} not found")
    return user


def _json_response(payload: dict, status: int) -> func.HttpResponse:
    body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
    return func.HttpResponse(body=body, status_code=status, mimetype=MIMETYPE)


def _assert_active_session(req: func.HttpRequest, user: dict) -> None:
    session_token = req.headers.get("X-Session-Token") or req.headers.get("x-session-token")
    if not session_token:
        raise PermissionError("Active session token is required")
    session = SessionSqlAdapter().get_session_status(user["id"], session_token)
    if not session:
        raise PermissionError("Session not found")
    if session.get("status") != "Active" or not session.get("is_active") or session.get("is_blocked"):
        raise PermissionError("Session is not active")


@power_bi_bp.function_name(name="GetPowerBIReportById")
@power_bi_bp.route(
    route="power-bi/{report_id}",
    methods=["GET"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def get_power_bi_report_by_id(req: func.HttpRequest) -> func.HttpResponse:
    report_id = req.route_params.get("report_id") or req.route_params.get("reportId")
    if not report_id:
        return _json_response({"error": "Report ID is required"}, HTTPStatus.BAD_REQUEST)

    try:
        from app.power_bi.power_bi_adapter import PowerBIAdapter
        from app.sql.user_zones_sql_adapter import UserZonesSqlAdapter
        from use_cases.power_bi_data import PowerBIUseCase

        user = _resolve_user(req)
        _assert_active_session(req, user)

        use_case = PowerBIUseCase(
            power_bi_repository=PowerBIAdapter(),
            user_zones_repository=UserZonesSqlAdapter(),
        )
        payload = use_case.execute_for_user(user, report_id)
        return _json_response(payload, HTTPStatus.OK)

    except ValueError as err:
        logging.warning("GetPowerBIReportById 401: %s", err)
        return _json_response({"error": str(err)}, HTTPStatus.UNAUTHORIZED)

    except PermissionError as err:
        logging.warning(
            "GetPowerBIReportById 403 (user=%s report=%s): %s",
            req.headers.get("x-ms-client-principal-id", "?"),
            report_id, err,
        )
        return _json_response({"error": str(err)}, HTTPStatus.FORBIDDEN)

    except LookupError as err:
        logging.warning("GetPowerBIReportById 404: %s", err)
        return _json_response({"error": str(err)}, HTTPStatus.NOT_FOUND)

    except RuntimeError as err:
        logging.exception("PBI error (report=%s): %s", report_id, err)
        return _json_response(
            {"error": "Power BI token generation failed", "detail": str(err)},
            HTTPStatus.INTERNAL_SERVER_ERROR,
        )

    except Exception as err:
        logging.exception("PBI error (report=%s): %s", report_id, err)
        return _json_response({"error": "Internal server error"}, HTTPStatus.INTERNAL_SERVER_ERROR)
