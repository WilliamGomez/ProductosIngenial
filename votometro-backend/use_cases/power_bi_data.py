"""Power BI use cases.

The public path is execute_for_user(), which issues an embed token with an
EffectiveIdentity. Reports are denied by default unless they are mapped to a
contracted product in REPORT_TO_PRODUCT_MAP.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from domain.models.power_bi import PowerBI
from domain.repositories.power_bi_repository import IPowerBIRepository
from domain.repositories.user_zones_repository import IUserZonesRepository


REPORT_TO_PRODUCT_MAP: Dict[str, str] = {
    "9db4c8ee-d117-4a2e-9a72-9284c6208fa0": "Votometro",
    "f88c2708-aa49-449a-974a-8e7f7ee972fb": "Audivoto",
}

DAX_ROLE_ADMIN = "Admin"
DAX_ROLE_GEO_SCOPE = os.getenv("POWER_BI_RLS_ROLE", "GeoScope")
POWER_BI_RLS_USERNAME_FIELD = os.getenv("POWER_BI_RLS_USERNAME_FIELD", "id")
POWER_BI_DISABLE_RLS = os.getenv("POWER_BI_DISABLE_RLS", "1").lower() in {"1", "true", "yes"}


class PowerBIUseCase:
    def __init__(
        self,
        power_bi_repository: IPowerBIRepository,
        user_zones_repository: Optional[IUserZonesRepository] = None,
    ):
        self.power_bi_repository = power_bi_repository
        self.user_zones_repository = user_zones_repository

    def execute_for_user(self, user: Dict[str, Any], report_id: str) -> Dict[str, Any]:
        """Issue an embed token with RLS for the requested report."""
        if not user or not user.get("id") or not user.get("role"):
            raise ValueError("Invalid user payload")

        product = REPORT_TO_PRODUCT_MAP.get(report_id)
        if product is None:
            raise PermissionError(f"Report {report_id} is not registered")

        role = user.get("role")
        if role != "Admin":
            enabled = {
                p["name"]
                for p in user.get("products", [])
                if p.get("enable")
            }
            if product not in enabled:
                raise PermissionError("Access denied: product not enabled")

        identity = None
        zone_count = 0

        if not POWER_BI_DISABLE_RLS:
            identity, zone_count = self._build_identity(user, product)
        
        logging.info(
            "PowerBI embed token request: user=%s role=%s report=%s product=%s rls_enabled=%s zones=%d",
            user["id"],
            role,
            report_id,
            product,
            not POWER_BI_DISABLE_RLS,
            zone_count,
        )

        raw_response = self.power_bi_repository.generate_embed_token_with_rls(
            workspace_id=self.power_bi_repository.group,
            report_id=report_id,
            identity=identity,
        )

        return {
            "accessToken": raw_response.get("accessToken"),
            "token": raw_response.get("accessToken"),
            "embedUrl": raw_response.get("embedUrl", ""),
            "reportId": raw_response.get("reportId", report_id),
            "id": raw_response.get("reportId", report_id),
            "tokenId": raw_response.get("tokenId"),
            "tokenExpiry": raw_response.get("tokenExpiry"),
        }

    def _build_identity(self, user: Dict[str, Any], product_name: str) -> tuple[Dict[str, Any], int]:
        user_id = user["id"]
        username = user.get(POWER_BI_RLS_USERNAME_FIELD) or user_id

        # =================================================================
        # KILL SWITCH TEMPORAL: DESACTIVACIÓN DE RLS GEOGRÁFICO
        # Todo usuario recibe el rol de Admin en Power BI para ver todo el país.
        # Para reactivar la seguridad, solo comenta o borra este bloque.
        return {
            "username": username,
            #"roles": [DAX_ROLE_ADMIN],
            "customData": "admin",
            "auditableContext": user_id,
        }, 0
        # =================================================================

        # Si el usuario es Admin, no aplicamos filtro geográfico
        if user["role"] == "Admin":
            return {
                "username": username,
                #"roles": [DAX_ROLE_ADMIN],
                "customData": "admin",
                "auditableContext": user_id,
            }, 0

        # En lugar de ir a SQL, leemos los productos y zonas que ya vinieron en el objeto user
        products = user.get("products", [])
        target_product = next((p for p in products if p.get("name") == product_name and p.get("enable")), None)
        
        if not target_product:
            raise PermissionError(f"Access denied: product {product_name} not enabled")

        zones = target_product.get("zones", [])
        
        parts: List[str] = []
        seen = set()
        
        for zone in zones:
            cod_dep = str(zone.get("cod_dep") or "").strip()
            cod_mun = str(zone.get("cod_mun") or "").strip() if zone.get("cod_mun") is not None else ""
            
            if not cod_dep:
                continue
                
            # Formateo estricto a 2 y 3 digitos para Power BI
            cod_dep = cod_dep.zfill(2)
            if cod_mun:
                cod_mun = cod_mun[-3:].zfill(3)
                
            # Formato requerido por DAX fallback: cod_dep:cod_mun:cod_zona|
            item = f"{cod_dep}:{cod_mun}:"
            
            if item not in seen:
                seen.add(item)
                parts.append(item)

        # Si no hay zonas, custom_data queda vacío.
        custom_data = "|".join(parts) if parts else ""

        return {
            "username": username,
            "roles": [DAX_ROLE_GEO_SCOPE],
            # Si Microsoft acepta esto, el problema era el formato de la cadena.
            # Si sigue fallando, el problema es que el rol DAX_ROLE_GEO_SCOPE no existe en tu reporte.
            "customData": custom_data, 
            "auditableContext": user_id,
        }, len(zones)

    def execute(self) -> PowerBI:
        """Return embed tokens for all reports. Do not expose via HTTP."""
        report_data = self.power_bi_repository.get_power_bi()

        reports = list(
            map(
                lambda x: self.power_bi_repository.get_embed_params_for_single_report(
                    self.power_bi_repository.group, x.report_id
                ),
                report_data.reports,
            )
        )
        return reports
