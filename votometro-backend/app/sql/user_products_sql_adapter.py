"""SQL adapter for user products and per-product geographic zones."""

from __future__ import annotations

import json
import os
from typing import List, Optional

import pyodbc

from domain.models.product import Product, UserZone


class UserProductsSqlAdapter:
    """Adapter for transactional UPSERT of products + zones."""

    def __init__(self):
        self.connection = pyodbc.connect(os.getenv("SQL_CONNECTION_STRING"))

    def upsert_user_products_with_zones(
        self, user_id: str, products: List[Product]
    ) -> None:
        """Persist products and replace each product's zones atomically."""
        self._validate_products(products)

        user_id_str = str(user_id)
        previous_autocommit = self.connection.autocommit
        self.connection.autocommit = False
        cursor = self.connection.cursor()

        try:
            submitted_names = [product.name for product in products]
            for product in products:
                user_product_id = self._upsert_product(cursor, user_id_str, product)

                cursor.execute(
                    """
                    DELETE FROM dbo.User_Zones
                    WHERE user_product_id = ?;
                    """,
                    user_product_id,
                )

                if product.zones:
                    rows = [
                        (
                            user_product_id,
                            zone.cod_dep,
                            zone.cod_mun,
                            bool(product.enable and zone.enable),
                        )
                        for zone in product.zones
                    ]
                    cursor.fast_executemany = True
                    cursor.executemany(
                        """
                        INSERT INTO dbo.User_Zones
                            (user_product_id, cod_dep, cod_mun, enable)
                        VALUES (?, ?, ?, ?);
                        """,
                        rows,
                    )

            self._disable_omitted_products(cursor, user_id_str, submitted_names)
            self.connection.commit()

        except Exception as exc:
            self.connection.rollback()
            raise RuntimeError(f"Error al guardar productos: {exc}") from exc

        finally:
            cursor.close()
            self.connection.autocommit = previous_autocommit

    def _validate_products(self, products: List[Product]) -> None:
        for product in products:
            effective_enable = bool(product.enable) and not self._is_expired_product(product)
            if effective_enable and not product.zones:
                raise ValueError(
                    f"Producto '{product.name}' esta habilitado pero no tiene zonas asignadas."
                )

            for zone in product.zones:
                if not zone.cod_dep:
                    raise ValueError(
                        f"Zona del producto '{product.name}': cod_dep es requerido"
                    )
                if len(zone.cod_dep) != 2:
                    raise ValueError(
                        f"Zona del producto '{product.name}': cod_dep debe tener 2 digitos"
                    )
                if zone.cod_mun and len(zone.cod_mun) != 3:
                    raise ValueError(
                        f"Zona del producto '{product.name}': cod_mun debe tener 3 digitos"
                    )

    def _is_expired_product(self, product: Product) -> bool:
        if product.expiration is None:
            return False
        cursor = self.connection.cursor()
        try:
            cursor.execute("SELECT IIF(TRY_CONVERT(DATETIME, ?) <= SYSUTCDATETIME(), 1, 0);", product.expiration)
            row = cursor.fetchone()
            return bool(row and row[0])
        finally:
            cursor.close()

    def _disable_omitted_products(
        self, cursor: pyodbc.Cursor, user_id: str, submitted_names: List[str]
    ) -> None:
        """Disable user-product relations not present in the desired payload."""
        if not submitted_names:
            cursor.execute(
                """
                UPDATE dbo.User_Products
                SET enable = 0,
                    updated_at = SYSUTCDATETIME()
                WHERE user_id = ? AND enable = 1;
                """,
                user_id,
            )
            return

        placeholders = ",".join("?" for _ in submitted_names)
        cursor.execute(
            f"""
            UPDATE up
            SET enable = 0,
                updated_at = SYSUTCDATETIME()
            FROM dbo.User_Products up
            INNER JOIN dbo.Products p ON p.id = up.product_id
            WHERE up.user_id = ?
              AND up.enable = 1
              AND p.name NOT IN ({placeholders});
            """,
            user_id,
            *submitted_names,
        )

    def _expire_elapsed_products(self, cursor: pyodbc.Cursor) -> None:
        cursor.execute(
            """
            UPDATE dbo.User_Products
            SET enable = 0,
                updated_at = SYSUTCDATETIME()
            WHERE enable = 1
              AND expiration IS NOT NULL
              AND expiration <= SYSUTCDATETIME();
            """
        )
        self.connection.commit()

    def _upsert_product(
        self, cursor: pyodbc.Cursor, user_id: str, product: Product
    ) -> int:
        """Insert/update dbo.User_Products and return the contractual id."""
        effective_enable = bool(product.enable) and not self._is_expired_product(product)
        if product.id is not None:
            cursor.execute(
                """
                UPDATE up
                SET
                    contract_duration = ?,
                    duration_unit = ?,
                    expiration = ?,
                    amount_cop = ?,
                    enable = ?
                OUTPUT inserted.id
                FROM dbo.User_Products up
                WHERE up.id = ? AND up.user_id = ?;
                """,
                product.contract_duration,
                product.duration_unit,
                product.expiration,
                product.amount_cop or 0,
                effective_enable,
                product.id,
                user_id,
            )
            row = cursor.fetchone()
            if row is None:
                raise ValueError(
                    f"Producto id={product.id} no existe para user_id={user_id}"
                )
            return int(row[0])

        # Frontend can send id=null for an already assigned product. Update by
        # the natural key first to avoid violating UQ_UserProducts_User_Product.
        cursor.execute(
            """
            UPDATE up
            SET
                contract_duration = ?,
                duration_unit = ?,
                expiration = ?,
                amount_cop = ?,
                enable = ?
            OUTPUT inserted.id
            FROM dbo.User_Products up
            INNER JOIN dbo.Products p ON p.id = up.product_id
            WHERE up.user_id = ? AND p.name = ?;
            """,
            product.contract_duration,
            product.duration_unit,
            product.expiration,
            product.amount_cop or 0,
            effective_enable,
            user_id,
            product.name,
        )
        row = cursor.fetchone()
        if row is not None:
            return int(row[0])

        cursor.execute(
            """
            DECLARE @ProductId INT;

            SELECT @ProductId = id
            FROM dbo.Products
            WHERE name = ?;

            IF @ProductId IS NULL
            BEGIN
                INSERT INTO dbo.Products (name) VALUES (?);
                SET @ProductId = SCOPE_IDENTITY();
            END;

            INSERT INTO dbo.User_Products
                (user_id, product_id, contract_duration, duration_unit, expiration, amount_cop, enable, updated_at)
            OUTPUT inserted.id
            VALUES (?, @ProductId, ?, ?, ?, ?, ?, SYSUTCDATETIME());
            """,
            product.name,
            product.name,
            user_id,
            product.contract_duration,
            product.duration_unit,
            product.expiration,
            product.amount_cop or 0,
            effective_enable,
        )
        row = cursor.fetchone()
        if row is None:
            raise RuntimeError("SQL Server no retorno inserted.id para dbo.User_Products")
        return int(row[0])

    def get_user_products_with_zones(self, user_id: str) -> List[Product]:
        """Return enabled products for a user with their enabled zones."""
        try:
            cursor = self.connection.cursor()
            self._expire_elapsed_products(cursor)
            cursor.execute(
                """
                SELECT
                    up.id,
                    p.name,
                    up.contract_duration,
                    up.duration_unit,
                    up.expiration,
                    up.amount_cop,
                    up.enable,
                    p.display_name,
                    p.route_path,
                    CONVERT(NVARCHAR(36), p.powerbi_report_id) AS powerbi_report_id,
                    CONVERT(NVARCHAR(36), p.powerbi_workspace_id) AS powerbi_workspace_id,
                    CONVERT(NVARCHAR(36), p.powerbi_tenant_id) AS powerbi_tenant_id,
                    p.icon,
                    p.display_order,
                    COALESCE(p.is_report_enabled, 1) AS is_report_enabled,
                    p.description,
                    (
                        SELECT uz.cod_dep, uz.cod_mun, uz.enable
                        FROM dbo.User_Zones uz
                        WHERE uz.user_product_id = up.id AND uz.enable = 1
                        FOR JSON PATH
                    ) AS zones_json
                FROM dbo.User_Products up
                INNER JOIN dbo.Products p ON p.id = up.product_id
                WHERE up.user_id = ?
                  AND up.enable = 1
                  AND (up.expiration IS NULL OR up.expiration > SYSUTCDATETIME())
                ORDER BY up.id DESC;
                """,
                str(user_id),
            )

            products: List[Product] = []
            for row in cursor.fetchall():
                (
                    user_product_id,
                    product_name,
                    contract_duration,
                    duration_unit,
                    expiration,
                    amount_cop,
                    enable,
                    display_name,
                    route_path,
                    powerbi_report_id,
                    powerbi_workspace_id,
                    powerbi_tenant_id,
                    icon,
                    display_order,
                    is_report_enabled,
                    description,
                    zones_json,
                ) = row

                zones: List[UserZone] = []
                if zones_json:
                    try:
                        zones = [
                            UserZone(
                                cod_dep=zone["cod_dep"],
                                cod_mun=zone.get("cod_mun"),
                                enable=zone.get("enable", True),
                            )
                            for zone in json.loads(zones_json)
                        ]
                    except (json.JSONDecodeError, KeyError, TypeError) as exc:
                        raise ValueError(
                            f"Error al parsear zonas del producto {user_product_id}: {exc}"
                        ) from exc

                products.append(
                    Product(
                        id=int(user_product_id),
                        name=product_name,
                        contract_duration=int(contract_duration),
                        duration_unit=duration_unit,
                        expiration=expiration,
                        amount_cop=float(amount_cop) if amount_cop else 0,
                        enable=bool(enable),
                        zones=zones,
                        display_name=display_name,
                        route_path=route_path,
                        powerbi_report_id=powerbi_report_id,
                        powerbi_workspace_id=powerbi_workspace_id,
                        powerbi_tenant_id=powerbi_tenant_id,
                        icon=icon,
                        display_order=int(display_order or 100),
                        is_report_enabled=bool(is_report_enabled),
                        description=description,
                    )
                )

            return products

        except Exception as exc:
            raise RuntimeError(f"Error al recuperar productos: {exc}") from exc

        finally:
            try:
                cursor.close()
            except UnboundLocalError:
                pass

    def delete_user_products(self, user_id: str) -> None:
        """Soft-disable all products for a user."""
        cursor = self.connection.cursor()
        try:
            self._expire_elapsed_products(cursor)
            cursor.execute(
                "UPDATE dbo.User_Products SET enable = 0 WHERE user_id = ?",
                str(user_id),
            )
            self.connection.commit()
        except Exception as exc:
            self.connection.rollback()
            raise RuntimeError(f"Error al desactivar productos: {exc}") from exc
        finally:
            cursor.close()

    def get_product_by_id(self, product_id: int) -> Optional[Product]:
        """Return one product with its enabled zones."""
        cursor = self.connection.cursor()
        try:
            self._expire_elapsed_products(cursor)
            cursor.execute(
                """
                SELECT
                    up.id,
                    p.name,
                    up.contract_duration,
                    up.duration_unit,
                    up.expiration,
                    up.amount_cop,
                    up.enable
                FROM dbo.User_Products up
                INNER JOIN dbo.Products p ON p.id = up.product_id
                WHERE up.id = ?
                  AND (up.expiration IS NULL OR up.expiration > SYSUTCDATETIME());
                """,
                product_id,
            )

            row = cursor.fetchone()
            if not row:
                return None

            product_id_val, name, duration, unit, expiration, amount, enable = row

            cursor.execute(
                """
                SELECT cod_dep, cod_mun, enable
                FROM dbo.User_Zones
                WHERE user_product_id = ? AND enable = 1;
                """,
                product_id_val,
            )

            zones = [
                UserZone(cod_dep=z[0], cod_mun=z[1], enable=bool(z[2]))
                for z in cursor.fetchall()
            ]

            return Product(
                id=int(product_id_val),
                name=name,
                contract_duration=int(duration),
                duration_unit=unit,
                expiration=expiration,
                amount_cop=float(amount) if amount else 0,
                enable=bool(enable),
                zones=zones,
            )
        except Exception as exc:
            raise RuntimeError(
                f"Error al recuperar producto {product_id}: {exc}"
            ) from exc
        finally:
            cursor.close()
