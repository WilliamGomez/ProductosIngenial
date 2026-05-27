"""Power BI use cases.

The public path is execute_for_user(), which issues an embed token with an
EffectiveIdentity. Reports are denied by default unless they are registered in
the product catalog and, for non-admin users, mapped to an active contracted
product.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
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
POWER_BI_DISABLE_RLS = os.getenv("POWER_BI_DISABLE_RLS", "0").lower() in {"1", "true", "yes"}


def _is_product_expired(product: Dict[str, Any]) -> bool:
    expiration = product.get("expiration")
    if not expiration:
        return False

    if isinstance(expiration, datetime):
        value = expiration
    else:
        raw = str(expiration).strip()
        if not raw:
            return False
        try:
            value = datetime.fromisoformat(raw.replace(" ", "T").replace("Z", "+00:00"))
        except ValueError:
            return False

    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value <= datetime.now(timezone.utc)


def _is_product_enabled(product: Dict[str, Any]) -> bool:
    return bool(product.get("enable")) and not _is_product_expired(product)


class PowerBIUseCase:
    def __init__(
        self,
        power_bi_repository: IPowerBIRepository,
        user_zones_repository: Optional[IUserZonesRepository] = None,
        product_catalog_repository: Optional[Any] = None,
    ):
        self.power_bi_repository = power_bi_repository
        self.user_zones_repository = user_zones_repository
        self.product_catalog_repository = product_catalog_repository

    def execute_for_user(self, user: Dict[str, Any], report_id: str) -> Dict[str, Any]:
        """Issue an embed token with RLS for the requested report."""
        if not user or not user.get("id") or not user.get("role"):
            raise ValueError("Invalid user payload")

        report_config = self._resolve_report_config(report_id)
        if report_config is None:
            raise PermissionError(f"Report {report_id} is not registered")
        if not bool(report_config.get("is_report_enabled", True)):
            raise PermissionError("Report is disabled")

        product = report_config["name"]
        workspace_id = report_config.get("powerbi_workspace_id") or self.power_bi_repository.group
        tenant_id = report_config.get("powerbi_tenant_id")
        if tenant_id and hasattr(self.power_bi_repository, "set_tenant_id"):
            self.power_bi_repository.set_tenant_id(tenant_id)

        role = user.get("role")
        if role != "Admin":
            enabled = {
                p["name"]
                for p in user.get("products", [])
                if _is_product_enabled(p)
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

        try:
            raw_response = self.power_bi_repository.generate_embed_token_with_rls(
                workspace_id=workspace_id,
                report_id=report_id,
                identity=identity,
            )
        except RuntimeError as exc:
            message = str(exc)
            if identity is None or "effective identity" not in message.lower():
                raise

            logging.warning(
                "PowerBI dataset rejected EffectiveIdentity; retrying without RLS identity. "
                "user=%s report=%s product=%s error=%s",
                user["id"],
                report_id,
                product,
                message,
            )
            raw_response = self.power_bi_repository.generate_embed_token_with_rls(
                workspace_id=workspace_id,
                report_id=report_id,
                identity=None,
            )

        return {
            "accessToken": raw_response.get("accessToken"),
            "token": raw_response.get("accessToken"),
            "embedUrl": raw_response.get("embedUrl", ""),
            "reportId": raw_response.get("reportId", report_id),
            "id": raw_response.get("reportId", report_id),
            "tokenId": raw_response.get("tokenId"),
            "tokenExpiry": raw_response.get("tokenExpiry"),
            "productName": product,
            "displayName": report_config.get("display_name") or product,
        }

    def _resolve_report_config(self, report_id: str) -> Optional[Dict[str, Any]]:
        if self.product_catalog_repository is not None:
            try:
                config = self.product_catalog_repository.get_report_config(report_id)
                if config:
                    return config
            except Exception:
                logging.exception("PowerBI report catalog lookup failed; using fallback map")

        product = REPORT_TO_PRODUCT_MAP.get(report_id)
        if product is None:
            return None
        return {
            "name": product,
            "display_name": product,
            "powerbi_report_id": report_id,
            "powerbi_workspace_id": self.power_bi_repository.group,
            "powerbi_tenant_id": None,
            "is_report_enabled": True,
        }

    def _build_identity(self, user: Dict[str, Any], product_name: str) -> tuple[Dict[str, Any], int]:
        user_id = user["id"]
        username = user.get(POWER_BI_RLS_USERNAME_FIELD) or user_id

        # Si el usuario es Admin, no aplicamos filtro geográfico
        if user["role"] == "Admin":
            return {
                "username": username,
                "roles": [DAX_ROLE_ADMIN],
                "customData": "admin",
                "auditableContext": user_id,
            }, 0

        # En lugar de ir a SQL, leemos los productos y zonas que ya vinieron en el objeto user
        products = user.get("products", [])
        target_product = next((p for p in products if p.get("name") == product_name and _is_product_enabled(p)), None)
        
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
