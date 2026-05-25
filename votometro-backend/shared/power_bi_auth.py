import os
import threading
import time

import msal


_TOKEN_LOCK = threading.Lock()
_TOKEN_CACHE = {
    "access_token": None,
    "expires_at": 0,
}


def get_access_token():
    client_id = os.getenv("POWER_BI_CLIENT_ID")
    client_secret = os.getenv("POWER_BI_CLIENT_SECRET")
    tenant_id = os.getenv("POWER_BI_TENANT_ID") or os.getenv("TENANT_ID")

    if not client_id or not client_secret or not tenant_id:
        raise RuntimeError("Power BI service principal configuration is incomplete")

    now = int(time.time())
    with _TOKEN_LOCK:
        cached_token = _TOKEN_CACHE.get("access_token")
        if cached_token and int(_TOKEN_CACHE.get("expires_at") or 0) - now > 300:
            return cached_token

    authority = f"https://login.microsoftonline.com/{tenant_id}"
    scope = ["https://analysis.windows.net/powerbi/api/.default"]

    app = msal.ConfidentialClientApplication(
        client_id=client_id, authority=authority, client_credential=client_secret
    )

    result = app.acquire_token_silent(scope, account=None)

    if not result:
        result = app.acquire_token_for_client(scopes=scope)

    if "access_token" not in result:
        raise Exception(f"No se pudo obtener token: {result.get('error_description')}")

    with _TOKEN_LOCK:
        _TOKEN_CACHE["access_token"] = result["access_token"]
        _TOKEN_CACHE["expires_at"] = now + int(result.get("expires_in") or 3600)

    return result["access_token"]
