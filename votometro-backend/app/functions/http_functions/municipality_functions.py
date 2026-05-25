import azure.functions as func
import logging
import json

from http import HTTPStatus
from shared.utils import MIMETYPE, decode_token, json_response


from app.sql.municipality_sql_adapter import MunicipalitySqlAdapter
from use_cases.list_municipalities import ListMunicipalitiesUseCase


municipality_bp = func.Blueprint()


def _require_authenticated(req: func.HttpRequest) -> func.HttpResponse | None:
    auth_header = req.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return json_response({"error": "Authorization header is required"}, status_code=HTTPStatus.UNAUTHORIZED)
    try:
        decode_token(auth_header.split(" ", 1)[1].strip())
    except ValueError:
        return json_response({"error": "Invalid token"}, status_code=HTTPStatus.UNAUTHORIZED)
    return None


@municipality_bp.function_name(name="ListMunicipalities")
@municipality_bp.route(
    route="municipality", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS
)
def list_municipalities(req: func.HttpRequest) -> func.HttpResponse:
    deny = _require_authenticated(req)
    if deny:
        return deny

    try:
        sql_repo = MunicipalitySqlAdapter()
        use_case = ListMunicipalitiesUseCase(sql_repo)
        municipalities = use_case.execute()

        return func.HttpResponse(
            json.dumps(municipalities),
            status_code=HTTPStatus.OK,
            mimetype=MIMETYPE,
        )
    except Exception:
        logging.exception("ListMunicipalities failed")
        return json_response({"error": "List municipalities failed"}, status_code=HTTPStatus.INTERNAL_SERVER_ERROR)
