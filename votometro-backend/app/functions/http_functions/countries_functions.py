import azure.functions as func
import logging
import json

from http import HTTPStatus
from shared.utils import MIMETYPE


from app.sql.department_sql_adapter import DepartmentSqlAdapter
from use_cases.list_countries import ListCountriesUseCase


countries_bp = func.Blueprint()


@countries_bp.function_name(name="ListCountries")
@countries_bp.route(
    route="countries", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS
)
def list_countries(req: func.HttpRequest) -> func.HttpResponse:
    try:
        sql_repo = DepartmentSqlAdapter()
        use_case = ListCountriesUseCase(sql_repo)
        departments = use_case.execute()

        return func.HttpResponse(
            json.dumps(departments),
            status_code=HTTPStatus.OK,
            mimetype=MIMETYPE,
        )
    except Exception as error:
        logging.error(f"ListCountries: {error}")
        return func.HttpResponse(
            json.dumps(dict(error=str(error))),
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            mimetype=MIMETYPE,
        )
