"""SQL adapter for the embeddable product/report catalog."""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import pyodbc


def _to_bool(value: Any) -> bool:
    return bool(value) if value is not None else False


class ProductCatalogSqlAdapter:
    """Reads and writes safe Power BI report metadata stored in dbo.Products."""

    def __init__(self):
        self.connection = pyodbc.connect(os.getenv("SQL_CONNECTION_STRING"))

    def list_products(self, include_disabled: bool = False) -> List[Dict[str, Any]]:
        cursor = self.connection.cursor()
        try:
            cursor.execute("EXEC dbo.GetProductReportCatalog @include_disabled = ?;", int(include_disabled))
            columns = [column[0] for column in cursor.description]
            return [self._row_to_dict(columns, row) for row in cursor.fetchall()]
        finally:
            cursor.close()

    def get_report_config(self, report_id: str) -> Optional[Dict[str, Any]]:
        cursor = self.connection.cursor()
        try:
            cursor.execute("EXEC dbo.GetProductReportByReportId @report_id = ?;", report_id)
            columns = [column[0] for column in cursor.description]
            row = cursor.fetchone()
            return self._row_to_dict(columns, row) if row else None
        finally:
            cursor.close()

    def upsert_product(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        cursor = self.connection.cursor()
        try:
            cursor.execute(
                """
                EXEC dbo.UpsertProductReportCatalog
                    @product_id = ?,
                    @name = ?,
                    @display_name = ?,
                    @route_path = ?,
                    @powerbi_report_id = ?,
                    @powerbi_workspace_id = ?,
                    @powerbi_tenant_id = ?,
                    @icon = ?,
                    @display_order = ?,
                    @is_report_enabled = ?,
                    @description = ?;
                """,
                payload.get("id"),
                payload.get("name"),
                payload.get("display_name"),
                payload.get("route_path"),
                payload.get("powerbi_report_id"),
                payload.get("powerbi_workspace_id"),
                payload.get("powerbi_tenant_id"),
                payload.get("icon"),
                int(payload.get("display_order") or 100),
                int(bool(payload.get("is_report_enabled", True))),
                payload.get("description"),
            )
            columns = [column[0] for column in cursor.description]
            row = cursor.fetchone()
            self.connection.commit()
            if not row:
                raise RuntimeError("SQL Server did not return product catalog row")
            return self._row_to_dict(columns, row)
        except Exception:
            self.connection.rollback()
            raise
        finally:
            cursor.close()

    def _row_to_dict(self, columns: List[str], row: Any) -> Dict[str, Any]:
        data = dict(zip(columns, row))
        for key in ("powerbi_report_id", "powerbi_workspace_id", "powerbi_tenant_id"):
            if data.get(key) is not None:
                data[key] = str(data[key])
        data["id"] = int(data["id"])
        data["display_order"] = int(data.get("display_order") or 100)
        data["is_report_enabled"] = _to_bool(data.get("is_report_enabled"))
        return data
