"""HTTP entrypoints del catálogo geográfico DIVIPOLA.

Endpoints:
  · `POST /api/divipola/upload`  — sube un CSV (multipart/form-data) y
                                   hace upsert sobre `dbo.DIVIPOLA`.
  · `GET  /api/divipola/status`  — devuelve el conteo actual del catálogo.

Auth:
  Por ahora ambos endpoints están en `AuthLevel.ANONYMOUS`. **Antes** de
  promover esto a producción hay que envolverlo con la barrera Bearer
  (`_require_admin` del módulo `admin_functions.py`). Está marcado con TODO.
"""
import cgi
import io
import json
import logging
import re
from http import HTTPStatus

import azure.functions as func

from app.sql.divipola_sql_adapter import DivipolaSqlAdapter
from app.sql.user_sql_adapter import UserSqlAdapter
from shared.utils import MIMETYPE, decode_token, json_response
from use_cases.bulk_upsert_divipola import BulkUpsertDivipolaUseCase


divipola_bp = func.Blueprint()


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def _err(message: str, status: int) -> func.HttpResponse:
    return json_response({"error": message}, status_code=status)


def _require_admin(req: func.HttpRequest) -> func.HttpResponse | None:
    auth_header = req.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return _err("Authorization header is required", HTTPStatus.UNAUTHORIZED)

    try:
        claims = decode_token(auth_header.split(" ", 1)[1].strip())
        caller_id = claims.get("oid")
        if not caller_id:
            return _err("Invalid token: user ID not found", HTTPStatus.UNAUTHORIZED)
        caller = UserSqlAdapter().get_user(caller_id)
        if not caller or caller.get("role") != "Admin":
            return _err("Admin role required", HTTPStatus.FORBIDDEN)
    except ValueError as error:
        return _err(str(error), HTTPStatus.UNAUTHORIZED)
    return None


def _parse_multipart_csv(req: func.HttpRequest) -> bytes:
    """Extrae el primer archivo CSV del body `multipart/form-data`.

    Usamos `cgi.FieldStorage` porque está en stdlib y no requiere agregar
    dependencias (python-multipart, werkzeug). `cgi` está deprecated en
    Python 3.13+, pero el image base es 3.11 — vigente hasta que migremos.
    """
    content_type = req.headers.get("Content-Type", "")
    if "multipart/form-data" not in content_type.lower():
        raise ValueError(
            "Content-Type debe ser multipart/form-data con un campo `file`."
        )

    body = req.get_body() or b""
    if not body:
        raise ValueError("Body vacío.")

    # cgi.FieldStorage requiere un environ con keys CGI.
    environ = {
        "REQUEST_METHOD": "POST",
        "CONTENT_TYPE":   content_type,
        "CONTENT_LENGTH": str(len(body)),
    }
    fs = cgi.FieldStorage(
        fp=io.BytesIO(body),
        environ=environ,
        keep_blank_values=True,
    )

    # Buscamos el primer field que SEA un archivo. Aceptamos cualquier
    # nombre — el más común es `file` pero algunos clients usan `csv` o
    # `divipola`.
    if not fs.list:
        raise ValueError("No se encontraron campos en el form-data.")

    file_field = None
    for field in fs.list:
        if getattr(field, "filename", None):
            file_field = field
            break
    if file_field is None:
        raise ValueError("No se encontró un campo de tipo archivo.")

    filename = file_field.filename or ""
    if not re.search(r"\.csv$", filename, flags=re.IGNORECASE):
        raise ValueError(
            f"El archivo debe tener extensión .csv (recibido: {filename!r})."
        )

    payload = file_field.file.read()
    return payload if isinstance(payload, (bytes, bytearray)) else payload.encode("utf-8")


# -----------------------------------------------------------------------------
# POST /api/divipola/upload
# -----------------------------------------------------------------------------
@divipola_bp.function_name(name="UploadDivipola")
@divipola_bp.route(
    route="divipola/upload",
    methods=["POST"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def upload_divipola(req: func.HttpRequest) -> func.HttpResponse:
    """Recibe un CSV y aplica upsert al catálogo `dbo.DIVIPOLA`.

    Query params:
      · `?mode=replace` → trunca la tabla antes de insertar.

    Respuesta:
      `{ "inserted": N, "updated": M, "total": N+M }`
    """
    deny = _require_admin(req)
    if deny:
        return deny

    try:
        csv_bytes = _parse_multipart_csv(req)
    except ValueError as ve:
        logging.warning("[UploadDivipola] BAD_REQUEST: %s", ve)
        return _err(str(ve), HTTPStatus.BAD_REQUEST)

    mode = (req.params.get("mode") or "").strip().lower()
    replace = mode == "replace"

    try:
        repo = DivipolaSqlAdapter()
        use_case = BulkUpsertDivipolaUseCase(repo)
        result = use_case.execute(csv_bytes=csv_bytes, replace=replace)
        return func.HttpResponse(
            json.dumps(result),
            status_code=HTTPStatus.OK,
            mimetype=MIMETYPE,
        )
    except ValueError as ve:
        # Errores de parseo / validación del CSV
        logging.warning("[UploadDivipola] BAD_REQUEST (parse): %s", ve)
        return _err(str(ve), HTTPStatus.BAD_REQUEST)
    except Exception as e:
        logging.exception("[UploadDivipola] 500")
        return _err("Internal error", HTTPStatus.INTERNAL_SERVER_ERROR)


# -----------------------------------------------------------------------------
# GET /api/divipola/status
# -----------------------------------------------------------------------------
@divipola_bp.function_name(name="DivipolaStatus")
@divipola_bp.route(
    route="divipola/status",
    methods=["GET"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def divipola_status(req: func.HttpRequest) -> func.HttpResponse:
    deny = _require_admin(req)
    if deny:
        return deny

    try:
        count = DivipolaSqlAdapter().count()
        return func.HttpResponse(
            json.dumps({"rows": count}),
            status_code=HTTPStatus.OK,
            mimetype=MIMETYPE,
        )
    except Exception as e:
        logging.exception("[DivipolaStatus] 500")
        return _err("Internal error", HTTPStatus.INTERNAL_SERVER_ERROR)
