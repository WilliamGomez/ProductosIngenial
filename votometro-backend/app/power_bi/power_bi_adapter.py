import requests
import os
import json
from domain.models.power_bi import PowerBI, Report
from domain.models.report_config import ReportConfig
from domain.models.embed_token import EmbedToken
from domain.models.embed_config import EmbedConfig
from domain.models.embed_token_request_body import EmbedTokenRequestBody

from domain.repositories.power_bi_repository import IPowerBIRepository
from shared.power_bi_auth import get_access_token

POWER_BI_URL = "https://api.powerbi.com/v1.0"


class PowerBIAdapter(IPowerBIRepository):
    def __init__(self, tenant_id: str | None = None):
        self.tenant_id = tenant_id
        self.token = get_access_token(tenant_id)
        self.group = os.getenv("POWER_BI_GROUP_ID")

    def set_tenant_id(self, tenant_id: str | None) -> None:
        if not tenant_id or tenant_id == self.tenant_id:
            return
        self.tenant_id = tenant_id
        self.token = get_access_token(tenant_id)

    def _headers(self):
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    def get_power_bi(self):
        url = f"{POWER_BI_URL}/myorg/groups/{self.group}/reports"
        response = requests.get(url, headers=self._headers())
        data = response.json()

        power_bi = PowerBI(token=self.token)

        reports = []
        for report in data.get("value", []):
            report = Report(
                report_id=report.get("id"),
                embed_url=report.get("embedUrl"),
                name=report.get("name"),
            )
            reports.append(report)

        power_bi.reports = reports

        return power_bi

    def get_embed_params_for_single_report(
        self, workspace_id, report_id, additional_dataset_id=None
    ):
        """Get embed params for a report and a workspace

        Args:
            workspace_id (str): Workspace Id
            report_id (str): Report Id
            additional_dataset_id (str, optional): Dataset Id different than the one bound to the report. Defaults to None.

        Returns:
            EmbedConfig: Embed token and Embed URL
        """

        report_url = f"{POWER_BI_URL}/myorg/groups/{workspace_id}/reports/{report_id}"
        api_response = requests.get(report_url, headers=self._headers())

        if api_response.status_code != 200:
            raise Exception(
                api_response.status_code,
                description=f'Error while retrieving Embed URL\n{api_response.reason}:\t{api_response.text}\nRequestId:\t{api_response.headers.get("RequestId")}',
            )

        api_response = api_response.json()
        report = ReportConfig(
            api_response["id"], api_response["name"], api_response["embedUrl"]
        )
        dataset_ids = [api_response["datasetId"]]

        if additional_dataset_id is not None:
            dataset_ids.append(additional_dataset_id)

        embed_token = self.get_embed_token_for_single_report_single_workspace(
            report_id, dataset_ids, workspace_id
        )
        embed_config = EmbedConfig(
            embed_token.tokenId,
            embed_token.token,
            embed_token.tokenExpiry,
            report.__dict__,
        )
        return embed_config.__dict__

    def get_embed_params_for_multiple_reports(
        self, workspace_id, report_ids, additional_dataset_ids=None
    ):
        """Get embed params for multiple reports for a single workspace

        Args:
            workspace_id (str): Workspace Id
            report_ids (list): Report Ids
            additional_dataset_ids (list, optional): Dataset Ids which are different than the ones bound to the reports. Defaults to None.

        Returns:
            EmbedConfig: Embed token and Embed URLs
        """

        # Note: This method is an example and is not consumed in this sample app

        dataset_ids = []

        # To store multiple report info
        reports = []

        for report_id in report_ids:
            report_url = (
                f"{POWER_BI_URL}/myorg/groups/{workspace_id}/reports/{report_id}"
            )
            api_response = requests.get(report_url, headers=self._headers())

            if api_response.status_code != 200:
                raise Exception(
                    api_response.status_code,
                    description=f'Error while retrieving Embed URL\n{api_response.reason}:\t{api_response.text}\nRequestId:\t{api_response.headers.get("RequestId")}',
                )

            api_response = api_response.json()
            report_config = ReportConfig(
                api_response["id"], api_response["name"], api_response["embedUrl"]
            )
            reports.append(report_config.__dict__)
            dataset_ids.append(api_response["datasetId"])

        if additional_dataset_ids is not None:
            dataset_ids.extend(additional_dataset_ids)

        embed_token = self.get_embed_token_for_multiple_reports_single_workspace(
            report_ids, dataset_ids, workspace_id
        )
        embed_config = EmbedConfig(
            embed_token.tokenId, embed_token.token, embed_token.tokenExpiry, reports
        )
        return json.dumps(embed_config.__dict__)

    def get_embed_token_for_single_report_single_workspace(
        self, report_id, dataset_ids, target_workspace_id=None
    ):
        """Get Embed token for single report, multiple datasets, and an optional target workspace

        Args:
            report_id (str): Report Id
            dataset_ids (list): Dataset Ids
            target_workspace_id (str, optional): Workspace Id. Defaults to None.

        Returns:
            EmbedToken: Embed token
        """

        request_body = EmbedTokenRequestBody()

        for dataset_id in dataset_ids:
            request_body.datasets.append({"id": dataset_id})

        request_body.reports.append({"id": report_id})

        if target_workspace_id is not None:
            request_body.targetWorkspaces.append({"id": target_workspace_id})

        embed_token_api = f"{POWER_BI_URL}/myorg/GenerateToken"
        api_response = requests.post(
            embed_token_api,
            data=json.dumps(request_body.__dict__),
            headers=self._headers(),
        )

        if api_response.status_code != 200:
            raise Exception(
                api_response.status_code,
                description=f'Error while retrieving Embed token\n{api_response.reason}:\t{api_response.text}\nRequestId:\t{api_response.headers.get("RequestId")}',
            )

        api_response = json.loads(api_response.text)
        embed_token = EmbedToken(
            api_response["tokenId"], api_response["token"], api_response["expiration"]
        )
        return embed_token

    def get_embed_token_for_multiple_reports_single_workspace(
        self, report_ids, dataset_ids, target_workspace_id=None
    ):
        """Get Embed token for multiple reports, multiple dataset, and an optional target workspace

        Args:
            report_ids (list): Report Ids
            dataset_ids (list): Dataset Ids
            target_workspace_id (str, optional): Workspace Id. Defaults to None.

        Returns:
            EmbedToken: Embed token
        """

        # Note: This method is an example and is not consumed in this sample app

        request_body = EmbedTokenRequestBody()

        for dataset_id in dataset_ids:
            request_body.datasets.append({"id": dataset_id})

        for report_id in report_ids:
            request_body.reports.append({"id": report_id})

        if target_workspace_id is not None:
            request_body.targetWorkspaces.append({"id": target_workspace_id})

        embed_token_api = f"{POWER_BI_URL}/myorg/GenerateToken"
        api_response = requests.post(
            embed_token_api,
            data=json.dumps(request_body.__dict__),
            headers=self._headers(),
        )

        if api_response.status_code != 200:
            raise Exception(
                api_response.status_code,
                description=f'Error while retrieving Embed token\n{api_response.reason}:\t{api_response.text}\nRequestId:\t{api_response.headers.get("RequestId")}',
            )

        api_response = api_response.json()
        embed_token = EmbedToken(
            api_response["tokenId"], api_response["token"], api_response["expiration"]
        )
        return embed_token

    # ------------------------------------------------------------------ #
    #  Row-Level Security (2026-04-23 · cierra C-05 / A-08)
    # ------------------------------------------------------------------ #
    def generate_embed_token_with_rls(
        self,
        workspace_id: str,
        report_id: str,
        identity: dict | None,
    ) -> dict:
        """Emite un embed token con ``EffectiveIdentity`` inyectada.

        La identidad es construida por ``PowerBIUseCase`` a partir de
        ``User_Zones``; el adaptador solo la propaga a la API de Power BI.

        Raises:
            PermissionError: si el reporte no es accesible con el SP actual.
            RuntimeError:    si ``GenerateToken`` responde con código != 200.
        """
        # 1. Metadata del reporte (dataset + embedUrl). Si Power BI retorna
        #    401/404, el service principal no tiene visibilidad → 403 para el
        #    llamante HTTP, traducido en la capa superior.
        try:
            report_url = f"{POWER_BI_URL}/myorg/groups/{workspace_id}/reports/{report_id}"
            meta_response = requests.get(
                report_url,
                headers=self._headers(),
                timeout=30,
            )
            if meta_response.status_code not in (200, 201):
                raise RuntimeError(
                    f"Power BI report metadata failed: status={meta_response.status_code}, "
                    f"requestId={meta_response.headers.get('RequestId')}, "
                    f"body={meta_response.text}"
                )
            meta = meta_response.json()

            # 2. GenerateToken. Si identity=None, RLS queda realmente
            # desactivado: NO se envia la propiedad `identities`.
            body = {
                "datasets": [{"id": meta["datasetId"]}],
                "reports": [{"id": report_id}],
                "targetWorkspaces": [{"id": workspace_id}],
            }
            if identity is not None:
                allowed_identity_keys = {
                    "username",
                    "roles",
                    "datasets",
                    "customData",
                    "auditableContext",
                    "identityBlob",
                }
                effective_identity = {
                    key: value
                    for key, value in dict(identity).items()
                    if key in allowed_identity_keys and value is not None
                }
                effective_identity["datasets"] = [meta["datasetId"]]
                body["identities"] = [effective_identity]

            token_response = requests.post(
                f"{POWER_BI_URL}/myorg/GenerateToken",
                json=body,
                headers=self._headers(),
                timeout=30,
            )
            if token_response.status_code not in (200, 201):
                raise RuntimeError(
                    f"PBI API Error: GenerateToken failed: status={token_response.status_code}, "
                    f"requestId={token_response.headers.get('RequestId')}, "
                    f"body={token_response.text}"
                )

            data = token_response.json()
            return {
                "reportId": meta["id"],
                "reportName": meta["name"],
                "embedUrl": meta["embedUrl"],
                "accessToken": data["token"],
                "tokenId": data["tokenId"],
                "tokenExpiry": data["expiration"],
            }
        except RuntimeError:
            raise
        except Exception as exc:
            raise RuntimeError(f"Power BI embed token request failed: {exc}") from exc

    def get_embed_token_for_multiple_reports_multiple_workspaces(
        self, report_ids, dataset_ids, target_workspace_ids=None
    ):
        """Get Embed token for multiple reports, multiple datasets, and optional target workspaces

        Args:
            report_ids (list): Report Ids
            dataset_ids (list): Dataset Ids
            target_workspace_ids (list, optional): Workspace Ids. Defaults to None.

        Returns:
            EmbedToken: Embed token
        """

        # Note: This method is an example and is not consumed in this sample app

        request_body = EmbedTokenRequestBody()

        for dataset_id in dataset_ids:
            request_body.datasets.append({"id": dataset_id})

        for report_id in report_ids:
            request_body.reports.append({"id": report_id})

        if target_workspace_ids is not None:
            for target_workspace_id in target_workspace_ids:
                request_body.targetWorkspaces.append({"id": target_workspace_id})

        # Generate Embed token for multiple workspaces, datasets, and reports. Refer https://aka.ms/MultiResourceEmbedToken
        embed_token_api = f"{POWER_BI_URL}/myorg/GenerateToken"
        api_response = requests.post(
            embed_token_api,
            data=json.dumps(request_body.__dict__),
            headers=self.get_request_header(),
        )

        if api_response.status_code != 200:
            raise Exception(
                api_response.status_code,
                description=f'Error while retrieving Embed token\n{api_response.reason}:\t{api_response.text}\nRequestId:\t{api_response.headers.get("RequestId")}',
            )

        api_response = json.loads(api_response.text)
        embed_token = EmbedToken(
            api_response["tokenId"], api_response["token"], api_response["expiration"]
        )
        return embed_token
