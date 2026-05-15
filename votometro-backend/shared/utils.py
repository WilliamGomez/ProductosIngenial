from dateutil.relativedelta import relativedelta
from datetime import timedelta
import mimetypes
import json as _json
import jwt
import logging
import os
import requests
from typing import Any, Dict

import azure.functions as func

MIMETYPE = "application/json; charset=utf-8"

# ---------------------------------------------------------------------------
# Monkey-patch global de json.dumps
#   · ensure_ascii=False  → caracteres especiales sin escape \uXXXX
#   · default=str         → datetime / Decimal / UUID serializan como string
#                           (previene TypeError en cualquier endpoint)
# ---------------------------------------------------------------------------
_original_json_dumps = getattr(_json, "_votometro_original_dumps", _json.dumps)


def _json_dumps_utf8(*args, **kwargs):
    kwargs.setdefault("ensure_ascii", False)
    kwargs.setdefault("default", str)
    return _original_json_dumps(*args, **kwargs)


_json.dumps = _json_dumps_utf8
_json._votometro_original_dumps = _original_json_dumps


# ---------------------------------------------------------------------------
# Helper central de respuestas JSON
#   Siempre devuelve BYTES explícitos para que Azure Functions no re-codifique
#   la cadena con la locale del host (causa de "ContraseÃ±a" / doble-encoding).
# ---------------------------------------------------------------------------
def json_response(data: Any, status_code: int = 200) -> func.HttpResponse:
    """Construye una HttpResponse JSON con encoding UTF-8 garantizado.

    Args:
        data:        Objeto serializable (dict, list, etc.)
        status_code: HTTP status code (int o HTTPStatus).

    Returns:
        func.HttpResponse con body=bytes utf-8 y Content-Type correcto.
    """
    body: bytes = _json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
    return func.HttpResponse(
        body=body,
        status_code=int(status_code),
        mimetype=MIMETYPE,
    )

# Cache para las claves públicas de Azure AD
_jwks_cache = None


def calculate_expiration(product, created_at):
    contract_duration = product["contract_duration"]
    duration_unit = product["duration_unit"]

    if duration_unit == "months":
        expiration = created_at + relativedelta(months=contract_duration)
    elif duration_unit == "days":
        expiration = created_at + timedelta(days=contract_duration)
    elif duration_unit == "years":
        expiration = created_at + relativedelta(years=contract_duration)
    else:
        raise ValueError(f"Unsupported duration unit: {duration_unit}")

    return expiration.strftime("%Y-%m-%d %H:%M:%S")


def get_azure_ad_public_keys() -> Dict:
    """Obtiene las claves públicas de Azure AD para verificar JWTs"""
    global _jwks_cache

    if _jwks_cache is not None:
        return _jwks_cache

    tenant_id = os.getenv("TENANT_ID")
    jwks_url = f"https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys"

    try:
        response = requests.get(jwks_url, timeout=10)
        response.raise_for_status()
        _jwks_cache = response.json()
        return _jwks_cache
    except Exception as e:
        logging.error(f"Error fetching Azure AD public keys: {e}")
        raise ValueError("Unable to fetch Azure AD public keys")


def verify_and_decode_token(access_token: str) -> Dict:
    """
    Verifica y decodifica un JWT de Azure AD

    Args:
        access_token: JWT token de Azure AD

    Returns:
        Dict con los claims del token

    Raises:
        ValueError: Si el token es inválido, expirado o no puede ser verificado
    """
    
    # Validación prévia: el token debe ser string
    if not isinstance(access_token, str):
        logging.error(f"Invalid token type: {type(access_token)}. Token must be a string.")
        raise ValueError(f"Token must be a string, got {type(access_token).__name__}")
    
    if not access_token or not access_token.strip():
        logging.error("Empty or whitespace-only token received")
        raise ValueError("Token cannot be empty")
    
    # Convertir a string si es bytes (PyJWT a veces lo recibe así)
    if isinstance(access_token, bytes):
        try:
            access_token = access_token.decode('utf-8')
        except UnicodeDecodeError:
            logging.error("Token bytes could not be decoded as UTF-8")
            raise ValueError("Token encoding error")
    
    # =========================================================================
    # DEV BYPASS: Short-circuit para desarrollo local
    # =========================================================================
    is_bypass_enabled = os.getenv("LOCAL_AUTH_BYPASS", "false").lower() == "true"
    is_mock_token = access_token == "DEV_BYPASS_ACCESS_TOKEN_DO_NOT_USE_IN_PROD"

    if is_bypass_enabled and is_mock_token:
        logging.warning("[SECURITY] DEV_BYPASS_ACCESS_TOKEN detectado. Inyectando sesión mockeada de Admin.")
        return {
            "oid": "18b4d02e-7e7b-4ebd-bc82-f4615f90aaba",
            "name": "RAFAEL ENRIQUE SANDOVAL PIDIACHE",
            "preferred_username": "RSANDOVAL@ingenial-ia.com",
            "emails": ["RSANDOVAL@ingenial-ia.com"],
            "roles": ["Admin"],
            "extension_Department": "IngenialAI"
        }
    # =========================================================================

    tenant_id = os.getenv("TENANT_ID")
    client_id = os.getenv("MS_CLIENT_ID")

    try:
        # Primero decodificar sin verificar para debug
        unverified_payload = jwt.decode(access_token, options={"verify_signature": False})
        logging.info(f"Token claims (unverified): aud={unverified_payload.get('aud')}, iss={unverified_payload.get('iss')}, oid={unverified_payload.get('oid')}")

        # Obtener el header del token sin verificar para obtener el kid
        unverified_header = jwt.get_unverified_header(access_token)
        kid = unverified_header.get("kid")
        logging.info(f"Token kid: {kid}")

        if not kid:
            raise ValueError("Token does not contain 'kid' in header")

        # Obtener las claves públicas de Azure AD
        jwks = get_azure_ad_public_keys()
        logging.info(f"Retrieved {len(jwks.get('keys', []))} public keys from Azure AD")

        # Buscar la clave pública correspondiente al kid
        public_key = None
        for key in jwks.get("keys", []):
            if key.get("kid") == kid:
                public_key = jwt.algorithms.RSAAlgorithm.from_jwk(key)
                logging.info(f"Found matching public key for kid: {kid}")
                break

        if not public_key:
            available_kids = [k.get("kid") for k in jwks.get("keys", [])]
            logging.error(f"Public key with kid '{kid}' not found. Available kids: {available_kids}")
            raise ValueError(f"Public key with kid '{kid}' not found")

        # Determinar el issuer correcto (v1.0 o v2.0)
        token_issuer = unverified_payload.get("iss", "")
        if "/v2.0" in token_issuer:
            expected_issuer = f"https://login.microsoftonline.com/{tenant_id}/v2.0"
        else:
            expected_issuer = f"https://sts.windows.net/{tenant_id}//"

        logging.info(f"Token issuer: {token_issuer}, Expected: {expected_issuer}")

        # La audiencia puede ser el client_id o una URL de API
        # Para tokens de MSAL, la audiencia suele ser el client_id o un resource ID
        token_audience = unverified_payload.get("aud")
        logging.info(f"Token audience: {token_audience}, Expected client_id: {client_id}")

        # Validar audiencia manualmente (puede ser client_id o api://client_id)
        # NOTA: También aceptamos MS Graph temporalmente para tokens de frontend
        valid_audiences = [
            client_id,
            f"api://{client_id}",
            f"https://{client_id}",
            "00000003-0000-0000-c000-000000000000",  # MS Graph API (temporal)
            "51ddd54e-2de6-4faf-8181-9dbddbbe72fa",  # Frontend app ID
            f"api://d29a0628-b1a4-44de-a872-a801324d7506",
        ]

        # Verificar y decodificar el token
        payload = jwt.decode(
            access_token,
            public_key,
            algorithms=["RS256"],
            options={
                "verify_signature": True,
                "verify_exp": True,
                "verify_aud": False,  # Validación manual más flexible
                "verify_iss": False,  # Validación manual para soportar v1.0 y v2.0
            }
        )

        # Validación manual de audiencia
        if token_audience not in valid_audiences:
            logging.error(f"Invalid audience. Token has: {token_audience}, Expected one of: {valid_audiences}")
            raise ValueError(f"Invalid token audience: {token_audience}")

        # Validación manual de issuer
        if not token_issuer.startswith("https://login.microsoftonline.com/") and \
           not token_issuer.startswith("https://sts.windows.net/"):
            raise ValueError(f"Invalid token issuer: {token_issuer}")

        # Validación manual de tenant
        if tenant_id not in token_issuer:
            raise ValueError(f"Token tenant mismatch. Expected {tenant_id}, got {token_issuer}")

        logging.info("Token verified successfully")
        return payload

    except jwt.ExpiredSignatureError:
        logging.error("Token has expired")
        raise ValueError("Token has expired")
    except jwt.InvalidAudienceError as e:
        logging.error(f"Invalid token audience: {e}")
        raise ValueError(f"Invalid token audience: {str(e)}")
    except jwt.InvalidIssuerError as e:
        logging.error(f"Invalid token issuer: {e}")
        raise ValueError(f"Invalid token issuer: {str(e)}")
    except jwt.InvalidSignatureError as e:
        logging.error(f"Invalid token signature: {e}")
        raise ValueError("Invalid token signature")
    except jwt.DecodeError as e:
        logging.error(f"Token decode error: {e}")
        raise ValueError(f"Token decode error: {str(e)}")
    except Exception as e:
        logging.error(f"Token verification error: {type(e).__name__}: {e}")
        raise ValueError(f"Token verification failed: {str(e)}")


def decode_token(access_token: str) -> Dict:
    """
    Decodifica y verifica un JWT de Azure AD

    NOTA: Esta función ahora incluye verificación completa del token.
    Anteriormente decodificaba sin verificar (INSEGURO).

    Args:
        access_token: JWT token de Azure AD

    Returns:
        Dict con los claims del token
    """
    # Validación adicional de seguridad
    if access_token is None:
        logging.error("Token is None")
        raise ValueError("access_token cannot be None")
    
    if not isinstance(access_token, str):
        logging.error(f"Token is not a string: {type(access_token)}")
        raise ValueError(f"access_token must be a string, got {type(access_token).__name__}")
    
    return verify_and_decode_token(access_token)
