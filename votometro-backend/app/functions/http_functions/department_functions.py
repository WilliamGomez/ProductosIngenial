import azure.functions as func
import logging
import json

from http import HTTPStatus
from shared.utils import MIMETYPE, decode_token, json_response


from app.sql.department_sql_adapter import DepartmentSqlAdapter
from use_cases.list_departments import ListDepartmentsUseCase


department_bp = func.Blueprint()


def _require_authenticated(req: func.HttpRequest) -> func.HttpResponse | None:
    auth_header = req.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return json_response({"error": "Authorization header is required"}, status_code=HTTPStatus.UNAUTHORIZED)
    try:
        decode_token(auth_header.split(" ", 1)[1].strip())
    except ValueError:
        return json_response({"error": "Invalid token"}, status_code=HTTPStatus.UNAUTHORIZED)
    return None


@department_bp.function_name(name="ListDepartments")
@department_bp.route(
    route="departments", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS
)
def list_departments(req: func.HttpRequest) -> func.HttpResponse:
    deny = _require_authenticated(req)
    if deny:
        return deny

    try:
        sql_repo = DepartmentSqlAdapter()
        use_case = ListDepartmentsUseCase(sql_repo)
        departments = use_case.execute()

        return func.HttpResponse(
            json.dumps(departments),
            status_code=HTTPStatus.OK,
            mimetype=MIMETYPE,
        )
    except Exception:
        logging.exception("ListDepartments failed")
        return json_response({"error": "List departments failed"}, status_code=HTTPStatus.INTERNAL_SERVER_ERROR)
