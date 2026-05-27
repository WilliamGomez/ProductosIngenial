import json
import os
from typing import List

import pandas as pd
import pyodbc

from domain.models.product import Product
from domain.models.user import User
from domain.repositories.user_sql_repository import IUserSqlRepository


class UserSqlAdapter(IUserSqlRepository):
    def __init__(self):
        self.connection = pyodbc.connect(os.getenv("SQL_CONNECTION_STRING"))

    def save_user_metadata(self, user: User):
        cursor = self.connection.cursor()
        cursor.execute(
            "EXEC InsertUser ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?",
            (
                user.id,
                user.email,
                user.display_name,
                user.enable,
                user.department,
                user.phone,
                user.role,
                user.created_at,
                user.type_person,
                user.type_dni,
                user.identity_document,
                user.reference,
                user.reference2,
                user.personal_email,
            ),
        )

        for product in user.products:
            self._upsert_user_product_contract(cursor, user.id, product)

        self.connection.commit()

    def list_users(self) -> List[User]:
        cursor = self.connection.cursor()
        self._expire_elapsed_products(cursor)
        cursor.execute(self._users_with_products_query())
        columns = [column[0] for column in cursor.description]
        rows = cursor.fetchall()

        if not rows:
            return []

        df = pd.DataFrame.from_records(rows, columns=columns)
        users = []

        for user_id, group in df.groupby("user_id", sort=False):
            row = group.iloc[0]
            user = self._user_from_row(row, user_id)

            for _, prod_row in group.iterrows():
                product = self._product_payload(prod_row)
                if product:
                    user.products.append(product)

            users.append(user.__dict__)

        return users

    def get_user(self, user_id: str) -> User:
        cursor = self.connection.cursor()
        self._expire_elapsed_products(cursor)
        cursor.execute(
            f"{self._users_with_products_query()} WHERE u.user_id = ? ORDER BY up.id DESC;",
            user_id,
        )
        columns = [col[0] for col in cursor.description]
        rows = cursor.fetchall()

        if not rows:
            return None

        df = pd.DataFrame.from_records(rows, columns=columns)
        row = df.iloc[0]
        user = self._user_from_row(row, user_id)

        for _, prod_row in df.iterrows():
            product = self._product_payload(prod_row)
            if product:
                user.products.append(product)

        return user.__dict__

    def _users_with_products_query(self) -> str:
        return """
            SELECT
                u.user_id,
                u.email,
                u.display_name,
                u.enable,
                u.department,
                u.phone,
                u.role,
                u.created_at,
                u.type_person,
                u.type_dni,
                u.identity_document,
                u.reference,
                u.reference2,
                u.personal_email,
                COALESCE(u.mfa_enabled, 0) AS mfa_enabled,
                u.mfa_enrolled_at,
                up.id,
                p.name AS product_name,
                up.contract_duration,
                up.duration_unit,
                up.expiration,
                up.amount_cop,
                up.enable AS product_enable,
                p.display_name AS product_display_name,
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
                    ORDER BY uz.cod_dep, uz.cod_mun
                    FOR JSON PATH
                ) AS zones_json
            FROM dbo.Users u
            LEFT JOIN dbo.User_Products up ON up.user_id = u.user_id
            LEFT JOIN dbo.Products p ON p.id = up.product_id
        """

    def _expire_elapsed_products(self, cursor) -> None:
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

    def _user_from_row(self, row, user_id: str) -> User:
        identity_document_value = row.get("identity_document")
        created_at = row.get("created_at")

        user = User(
            id=user_id,
            email=row["email"],
            department=row["department"],
            phone=row["phone"],
            enable=bool(row["enable"]),
            display_name=row["display_name"],
            created_at=self._format_datetime(created_at),
            role=row["role"],
            type_person=row["type_person"],
            type_dni=row["type_dni"],
            identity_document=(
                str(identity_document_value)
                if pd.notnull(identity_document_value)
                else None
            ),
            reference=row["reference"],
            reference2=row.get("reference2"),
            personal_email=row.get("personal_email"),
            products=[],
        )
        user.mfa_enabled = bool(row.get("mfa_enabled"))
        user.mfa_enrolled_at = self._format_datetime(row.get("mfa_enrolled_at"))
        return user

    def _product_payload(self, prod_row) -> dict | None:
        if pd.isnull(prod_row["product_name"]):
            return None

        product_enable_value = prod_row.get("product_enable")
        product_enabled = (
            bool(product_enable_value)
            if pd.notnull(product_enable_value)
            else True
        )

        return {
            "id": int(prod_row["id"]),
            "name": prod_row["product_name"],
            "duration_unit": prod_row["duration_unit"],
            "enable": product_enabled,
            "contract_duration": int(prod_row["contract_duration"] or 0),
            "expiration": self._format_datetime(prod_row.get("expiration")),
            "amount_cop": float(prod_row["amount_cop"] or 0),
            "zones": self._zones_from_json(prod_row.get("zones_json")),
            "display_name": prod_row.get("product_display_name"),
            "route_path": prod_row.get("route_path"),
            "powerbi_report_id": prod_row.get("powerbi_report_id"),
            "powerbi_workspace_id": prod_row.get("powerbi_workspace_id"),
            "powerbi_tenant_id": prod_row.get("powerbi_tenant_id"),
            "icon": prod_row.get("icon"),
            "display_order": int(prod_row.get("display_order") or 100),
            "is_report_enabled": bool(prod_row.get("is_report_enabled", True)),
            "description": prod_row.get("description"),
        }

    def _zones_from_json(self, zones_json) -> list[dict]:
        if pd.isnull(zones_json) or not zones_json:
            return []

        try:
            return [
                {
                    "cod_dep": zone.get("cod_dep"),
                    "cod_mun": zone.get("cod_mun"),
                    "enable": bool(zone.get("enable", True)),
                }
                for zone in json.loads(zones_json)
            ]
        except (TypeError, ValueError, json.JSONDecodeError):
            return []

    def _format_datetime(self, value):
        if pd.isnull(value):
            return None
        if hasattr(value, "strftime"):
            return value.strftime("%Y-%m-%d %H:%M:%S")
        return value

    def update_user(self, user: User):
        cursor = self.connection.cursor()
        cursor.execute(
            "EXEC UpdateUser ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?",
            (
                user.id,
                user.email,
                user.display_name,
                user.enable,
                user.department,
                user.phone,
                user.role,
                user.type_person,
                user.type_dni,
                user.identity_document,
                user.reference,
                user.reference2,
                user.personal_email,
            ),
        )
        self.connection.commit()

    def delete_user(self, user_id: str) -> None:
        cursor = self.connection.cursor()
        previous_autocommit = self.connection.autocommit
        self.connection.autocommit = False
        try:
            cursor.execute(
                """
                SET NOCOUNT ON;
                DECLARE @UserId NVARCHAR(100) = ?;

                DELETE l
                FROM dbo.Session_Navigation_Logs l
                INNER JOIN dbo.UserSessions s ON s.session_id = l.session_id
                WHERE s.user_id = @UserId;

                DELETE FROM dbo.UserSessions
                WHERE user_id = @UserId;

                DELETE z
                FROM dbo.User_Zones z
                INNER JOIN dbo.User_Products up ON up.id = z.user_product_id
                WHERE up.user_id = @UserId;

                DELETE FROM dbo.User_Products
                WHERE user_id = @UserId;

                DELETE FROM dbo.Users
                WHERE user_id = @UserId;

                SELECT @@ROWCOUNT AS deleted_users;
                """,
                user_id,
            )
            row = cursor.fetchone()
            if not row or int(row[0] or 0) == 0:
                raise LookupError("User not found")
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise
        finally:
            self.connection.autocommit = previous_autocommit
            cursor.close()

    def upsert_user_products(self, user_id: str, products: List[Product]):
        cursor = self.connection.cursor()

        for product in products:
            self._upsert_user_product_contract(cursor, user_id, product)
        self.connection.commit()

    def _upsert_user_product_contract(self, cursor, user_id: str, product: Product) -> int:
        effective_enable = bool(product.enable) and not self._is_expired_product(product)
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

            MERGE dbo.User_Products AS target
            USING (SELECT ? AS user_id, @ProductId AS product_id) AS source
            ON target.user_id = source.user_id
               AND target.product_id = source.product_id
            WHEN MATCHED THEN
                UPDATE SET
                    contract_duration = ?,
                    duration_unit = ?,
                    expiration = ?,
                    amount_cop = ?,
                    enable = ?,
                    updated_at = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN
                INSERT (
                    user_id,
                    product_id,
                    contract_duration,
                    duration_unit,
                    expiration,
                    amount_cop,
                    enable,
                    updated_at
                )
                VALUES (
                    source.user_id,
                    source.product_id,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    SYSUTCDATETIME()
                );

            SELECT id
            FROM dbo.User_Products
            WHERE user_id = ? AND product_id = @ProductId;
            """,
            product.name,
            product.name,
            user_id,
            product.contract_duration,
            product.duration_unit,
            product.expiration,
            product.amount_cop or 0,
            effective_enable,
            product.contract_duration,
            product.duration_unit,
            product.expiration,
            product.amount_cop or 0,
            effective_enable,
            user_id,
        )
        row = cursor.fetchone()
        if not row:
            raise RuntimeError("SQL Server no retorno User_Products.id")
        return int(row[0])

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

    def _get_product_id(self, user_id: str, product_name: str) -> int | None:
        """Get the ID of an existing product for a user by product name."""
        cursor = self.connection.cursor()
        cursor.execute(
            """
            SELECT up.id
            FROM dbo.User_Products up
            INNER JOIN dbo.Products p ON p.id = up.product_id
            WHERE up.user_id = ? AND p.name = ?
            """,
            (user_id, product_name),
        )
        row = cursor.fetchone()
        return row[0] if row else None

    def disable_products_not_in_list(self, user_id: str, product_names: List[str]):
        """Disable (soft delete) products that are not in the provided list."""
        cursor = self.connection.cursor()
        if not product_names:
            cursor.execute(
                "UPDATE dbo.User_Products SET enable = 0 WHERE user_id = ?",
                (user_id,),
            )
        else:
            placeholders = ",".join(["?" for _ in product_names])
            query = f"""
                UPDATE up
                SET enable = 0
                FROM dbo.User_Products up
                INNER JOIN dbo.Products p ON p.id = up.product_id
                WHERE up.user_id = ? AND p.name NOT IN ({placeholders})
            """
            cursor.execute(query, (user_id, *product_names))
        self.connection.commit()

    def enable_products_in_list(self, user_id: str, product_names: List[str]):
        """Enable products that are in the provided list."""
        if not product_names:
            return

        cursor = self.connection.cursor()
        placeholders = ",".join(["?" for _ in product_names])
        query = f"""
            UPDATE up
            SET enable = 1
            FROM dbo.User_Products up
            INNER JOIN dbo.Products p ON p.id = up.product_id
            WHERE up.user_id = ? AND p.name IN ({placeholders})
        """
        cursor.execute(query, (user_id, *product_names))
        self.connection.commit()

    def get_enabled_product_names(self, user_id: str) -> List[str]:
        """Get list of enabled product names for a user."""
        cursor = self.connection.cursor()
        self._expire_elapsed_products(cursor)
        cursor.execute(
            """
            SELECT p.name
            FROM dbo.User_Products up
            INNER JOIN dbo.Products p ON p.id = up.product_id
            WHERE up.user_id = ?
              AND up.enable = 1
              AND (up.expiration IS NULL OR up.expiration > SYSUTCDATETIME())
            """,
            (user_id,),
        )
        rows = cursor.fetchall()
        return [row[0] for row in rows]
