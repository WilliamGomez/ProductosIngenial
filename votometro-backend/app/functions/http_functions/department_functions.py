import azure.functions as func
import logging
import json

from http import HTTPStatus
from shared.utils import MIMETYPE


from app.sql.department_sql_adapter import DepartmentSqlAdapter
from use_cases.list_departments import ListDepartmentsUseCase


department_bp = func.Blueprint()


@department_bp.function_name(name="ListDepartments")
@department_bp.route(
    route="departments", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS
)
def list_departments(req: func.HttpRequest) -> func.HttpResponse:
    try:
        sql_repo = DepartmentSqlAdapter()
        use_case = ListDepartmentsUseCase(sql_repo)
        departments = use_case.execute()

        return func.HttpResponse(
            json.dumps(departments),
            status_code=HTTPStatus.OK,
            mimetype=MIMETYPE,
        )
    except Exception as error:
        logging.error(f"ListDepartments: {error}")
        return func.HttpResponse(
            json.dumps(dict(error=str(error))),
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            mimetype=MIMETYPE,
        )
