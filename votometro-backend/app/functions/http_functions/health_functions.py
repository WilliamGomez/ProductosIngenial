import logging
import os
from http import HTTPStatus

import azure.functions as func
import pyodbc

from shared.utils import json_response


health_bp = func.Blueprint()


@health_bp.function_name(name="HealthLive")
@health_bp.route(route="health", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def health_live(req: func.HttpRequest) -> func.HttpResponse:
    return json_response(
        {
            "status": "ok",
            "service": "votometro-backend",
            "runtime": "azure-functions-python",
        },
        HTTPStatus.OK,
    )


@health_bp.function_name(name="HealthReady")
@health_bp.route(route="health/ready", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def health_ready(req: func.HttpRequest) -> func.HttpResponse:
    connection_string = os.getenv("SQL_CONNECTION_STRING")
    if not connection_string:
        return json_response(
            {"status": "not_ready", "checks": {"sql": "SQL_CONNECTION_STRING missing"}},
            HTTPStatus.SERVICE_UNAVAILABLE,
        )

    try:
        with pyodbc.connect(connection_string, timeout=5) as connection:
            cursor = connection.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
        return json_response({"status": "ready", "checks": {"sql": "ok"}}, HTTPStatus.OK)
    except Exception as exc:
        logging.exception("[HealthReady] SQL readiness check failed")
        return json_response(
            {"status": "not_ready", "checks": {"sql": str(exc)}},
            HTTPStatus.SERVICE_UNAVAILABLE,
        )
