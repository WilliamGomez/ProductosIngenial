import azure.functions as func
import logging
import json

from http import HTTPStatus
from shared.utils import MIMETYPE


from app.sql.municipality_sql_adapter import MunicipalitySqlAdapter
from use_cases.list_municipalities import ListMunicipalitiesUseCase


municipality_bp = func.Blueprint()


@municipality_bp.function_name(name="ListMunicipalities")
@municipality_bp.route(
    route="municipality", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS
)
def list_municipalities(req: func.HttpRequest) -> func.HttpResponse:
    try:
        sql_repo = MunicipalitySqlAdapter()
        use_case = ListMunicipalitiesUseCase(sql_repo)
        municipalities = use_case.execute()

        return func.HttpResponse(
            json.dumps(municipalities),
            status_code=HTTPStatus.OK,
            mimetype=MIMETYPE,
        )
    except Exception as error:
        logging.error(f"ListMunicipalities: {error}")
        return func.HttpResponse(
            json.dumps(dict(error=str(error))),
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            mimetype=MIMETYPE,
        )
