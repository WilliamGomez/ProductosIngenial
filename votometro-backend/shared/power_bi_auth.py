import msal
import os


def get_access_token():
    client_id = os.getenv("POWER_BI_CLIENT_ID")
    client_secret = os.getenv("POWER_BI_CLIENT_SECRET")
    tenant_id = os.getenv("TENANT_ID")

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

    return result["access_token"]
