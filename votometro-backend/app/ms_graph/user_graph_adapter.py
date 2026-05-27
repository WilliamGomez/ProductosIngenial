import requests
import os
import logging
from domain.models.user import User
from domain.repositories.user_repository import IUserRepository
from shared.msal_auth import get_access_token

GRAPH_URL = "https://graph.microsoft.com/v1.0"
logger = logging.getLogger(__name__)


class UserGraphAdapter(IUserRepository):
    def __init__(self):
        self.token = get_access_token()

    def _headers(self):
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    def create_user(self, user: User) -> User:
        body = {
            "accountEnabled": True,
            "department": user.department,
            "displayName": user.display_name,
            "mailNickname": user.email.split("@")[0],
            "userPrincipalName": user.email,
            "mobilePhone": user.phone,
            "passwordProfile": {
                "forceChangePasswordNextSignIn": True,
                "password": user.password,
            },
        }

        response = requests.post(
            f"{GRAPH_URL}/users", headers=self._headers(), json=body
        )

        if response.status_code == 400:
            message = response.json()["error"]["message"]
            raise ValueError(f"Error: {message}")

        response.raise_for_status()
        data = response.json()

        return User(
            id=data["id"],
            display_name=data["displayName"],
            email=data["userPrincipalName"],
            phone=data["mobilePhone"],
        )

    def get_user_app_role_assignments(self, user_id: str):
        url = f"{GRAPH_URL}/users/{user_id}/appRoleAssignments"
        response = requests.get(url, headers=self._headers())
        response.raise_for_status()
        return response.json()["value"]

    def remove_user_from_app_role(self, user_id: str, app_role_assignment_id: str):
        url = f"{GRAPH_URL}/users/{user_id}/appRoleAssignments/{app_role_assignment_id}"
        response = requests.delete(url, headers=self._headers())
        response.raise_for_status()

    def assign_user_to_service_principal(self, user_id: str, role_name: str):
        object_id = os.getenv("MS_OBJECT_ID")

        sp_res = requests.get(
            f"{GRAPH_URL}/servicePrincipals/{object_id}/appRoles",
            headers=self._headers(),
        )
        sp_res.raise_for_status()
        sp = sp_res.json()["value"]

        role = next(r for r in sp if r["displayName"] == role_name)

        body = {
            "principalId": user_id,
            "resourceId": object_id,
            "appRoleId": role["id"],
        }

        assign_url = f"{GRAPH_URL}/servicePrincipals/{object_id}/appRoleAssignments"
        response = requests.post(assign_url, headers=self._headers(), json=body)
        response.raise_for_status()
        return response.json()

    # Métodos no implementados aún
    def get_user(self, user_id: str) -> User:
        raise NotImplementedError()

    def update_user(self, user: User) -> User:
        body = {
            "displayName": user.display_name,
            "accountEnabled": user.enable,
            "mobilePhone": user.phone,
        }
        body = {key: value for key, value in body.items() if value is not None}

        graph_url = f"{GRAPH_URL}/users/{user.id}"
        res = requests.patch(graph_url, headers=self._headers(), json=body)
        if res.status_code == 400:
            message = res.json().get("error", {}).get("message", "Bad request")
            raise ValueError(f"Error: {message}")
        res.raise_for_status()

    def reset_password(self, user_id: str, new_password: str, force_change_next_signin: bool = True) -> None:
        body = {
            "passwordProfile": {
                "forceChangePasswordNextSignIn": force_change_next_signin,
                "password": new_password,
            }
        }
        graph_url = f"{GRAPH_URL}/users/{user_id}"
        res = requests.patch(graph_url, headers=self._headers(), json=body)
        if res.status_code >= 400:
            try:
                payload = res.json()
            except ValueError:
                payload = {}
            error = payload.get("error", {}) if isinstance(payload, dict) else {}
            message = error.get("message") or res.text or "Graph password reset failed"
            code = error.get("code") or str(res.status_code)
            logger.warning(
                "Graph reset_password failed user_id=%s status=%s code=%s message=%s",
                user_id,
                res.status_code,
                code,
                message,
            )
            if res.status_code in (400, 403, 404):
                raise ValueError(f"Microsoft Graph rechazo el cambio de contrasena ({code}): {message}")
        res.raise_for_status()

    def delete_user(self, user_id: str) -> None:
        response = requests.delete(f"{GRAPH_URL}/users/{user_id}", headers=self._headers())
        if response.status_code == 404:
            return
        response.raise_for_status()

    def list_users(self):
        url = f"{GRAPH_URL}/users?$select=id,displayName,userPrincipalName,accountEnabled,department&$filter=department eq 'IngenialAI'"

        response = requests.get(url, headers=self._headers())
        response.raise_for_status()

        data = response.json()

        return [
            User(
                id=item["id"],
                display_name=item["displayName"],
                enable=item["accountEnabled"],
                department=item["department"],
                email=item["userPrincipalName"],
            )
            for item in data.get("value", [])
        ]
