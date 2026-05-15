"""Adaptador SQL para zonas geograficas (esquema 3NF post-hard-reset).

dbo.User_Zones NO tiene columna user_id ni product_id legacy.
El user_id se obtiene siempre via JOIN con dbo.User_Products.

Schema:
  User_Zones(id PK, user_product_id FK->User_Products, cod_dep, cod_mun, enable, ...)
"""
import logging
import os
from typing import Dict, List, Optional

import pyodbc

from domain.models.user_zone import UserZone, UserZoneSet
from domain.repositories.user_zones_repository import IUserZonesRepository


class UserZonesSqlAdapter(IUserZonesRepository):
    def __init__(self, connection_string: Optional[str] = None):
        self._connection_string = (
            connection_string or os.getenv("SQL_CONNECTION_STRING")
        )

    # ------------------------------------------------------------------ Read

    def list_user_zones(self, user_id: str) -> UserZoneSet:
        """Zonas declaradas del usuario (todos sus contratos, sin duplicados)."""
        if not user_id:
            return UserZoneSet(user_id=user_id or "", zones=[])

        try:
            with pyodbc.connect(self._connection_string) as cnxn:
                with cnxn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT DISTINCT uz.cod_dep, uz.cod_mun
                          FROM dbo.User_Zones    uz
                          JOIN dbo.User_Products up
                            ON up.id = uz.user_product_id
                         WHERE up.user_id = ?
                           AND uz.enable  = 1
                         ORDER BY uz.cod_dep, uz.cod_mun;
                        """,
                        user_id,
                    )
                    rows = cur.fetchall()
        except Exception as exc:
            logging.exception(
                "[UserZonesSqlAdapter] list_user_zones failed user=%s", user_id
            )
            raise RuntimeError("Error leyendo zonas del usuario") from exc

        zones = []
        for row in rows:
            cod_dep = str(row[0]).strip().zfill(2) if row[0] else ""
            cod_mun = (
                str(row[1]).strip()[-3:].zfill(3) if row[1] else None
            )
            if cod_dep:
                zones.append(UserZone(cod_dep=cod_dep, cod_mun=cod_mun))
        return UserZoneSet(user_id=user_id, zones=zones)

    def list_user_product_zones(
        self, user_id: str, product_name: str
    ) -> UserZoneSet:
        """Zonas activas del usuario para un producto (Power BI RLS)."""
        if not user_id or not product_name:
            return UserZoneSet(user_id=user_id or "", zones=[])

        try:
            with pyodbc.connect(self._connection_string) as cnxn:
                with cnxn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT
                            NULLIF(LTRIM(RTRIM(uz.cod_dep)), '') AS cod_dep,
                            NULLIF(LTRIM(RTRIM(uz.cod_mun)), '') AS cod_mun
                          FROM dbo.User_Products up
                          JOIN dbo.Products      p
                            ON p.id = up.product_id
                          JOIN dbo.User_Zones    uz
                            ON uz.user_product_id = up.id
                         WHERE up.user_id = ?
                           AND p.name     = ?
                           AND up.enable  = 1
                           AND uz.enable  = 1
                         ORDER BY uz.cod_dep, uz.cod_mun;
                        """,
                        user_id,
                        product_name,
                    )
                    rows = cur.fetchall()
        except Exception as exc:
            logging.exception(
                "[UserZonesSqlAdapter] list_user_product_zones failed "
                "user=%s product=%s",
                user_id,
                product_name,
            )
            raise RuntimeError("Error leyendo zonas del producto") from exc

        zones = []
        for row in rows:
            cod_dep = str(row[0]).strip().zfill(2) if row[0] else ""
            cod_mun = (
                str(row[1]).strip()[-3:].zfill(3) if row[1] else None
            )
            if cod_dep:
                zones.append(UserZone(cod_dep=cod_dep, cod_mun=cod_mun))
        return UserZoneSet(user_id=user_id, zones=zones)

    # ----------------------------------------------------------------- Write

    def upsert_user_zones(
        self, user_id: str, assignments: List[Dict[str, str]]
    ) -> None:
        """NO-OP — zonas migradas al flujo de productos (3NF).

        User_Zones ya no tiene columna user_id; las zonas viven vinculadas
        a User_Products.id. Usa PUT /api/user-products/{user_id} para
        gestionar zonas. Se conserva para compatibilidad sin lanzar error.
        """
        logging.warning(
            "[UserZonesSqlAdapter] upsert_user_zones user=%s (%d items) "
            "IGNORADO — usa PUT /api/user-products/{user_id}.",
            user_id,
            len(assignments or []),
        )
