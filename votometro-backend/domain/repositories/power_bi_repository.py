from abc import ABC, abstractmethod
from domain.models.power_bi import PowerBI


class IPowerBIRepository(ABC):

    @abstractmethod
    def get_power_bi(self) -> PowerBI:
        pass

    @abstractmethod
    def get_embed_params_for_single_report(
        self, workspace_id, report_id, additional_dataset_id=None
    ):
        pass

    @abstractmethod
    def get_embed_params_for_multiple_reports(
        self, workspace_id, report_ids, additional_dataset_ids=None
    ):
        pass

    @abstractmethod
    def get_embed_token_for_single_report_single_workspace(
        self, report_id, dataset_ids, target_workspace_id=None
    ):
        pass

    @abstractmethod
    def get_embed_token_for_multiple_reports_single_workspace(
        self, report_ids, dataset_ids, target_workspace_id=None
    ):
        pass

    @abstractmethod
    def get_embed_token_for_multiple_reports_multiple_workspaces(
        self, report_ids, dataset_ids, target_workspace_ids=None
    ):
        pass

    # ------------------------------------------------------------------ #
    #  Row-Level Security (2026-04-23 · cierra C-05 / A-08)
    # ------------------------------------------------------------------ #
    @abstractmethod
    def generate_embed_token_with_rls(
        self,
        workspace_id: str,
        report_id: str,
        identity: dict | None,
    ) -> dict:
        """Emite un embed token con ``EffectiveIdentity``.

        Args:
            workspace_id: Power BI workspace / group id.
            report_id:    Reporte solicitado (debe existir en el workspace).
            identity:     Identidad RLS. Esquema esperado::

                {"username": "<oid>",
                 "roles":    ["GeoScope" | "Admin"],
                 "reports":  [report_id],
                 "datasets": [dataset_id],
                 "customData": "<optional cod_dep:cod_mun:cod_zona csv>"}

        Returns:
            Dict con ``reportId``, ``embedUrl``, ``accessToken`` y ``tokenExpiry``.
        """
        raise NotImplementedError
