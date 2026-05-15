"""RBAC SQL adapter — implementa `IRbacSqlRepository` sobre Azure SQL.

Las tablas son creadas y sembradas por `db/init/03_rbac.sql` durante el
arranque del servicio `votometro-db-init`. Aquí solo se hacen consultas y
mutaciones — el adapter NO hace DDL.

Convención de conexión: se sigue el patrón existente en `UserSqlAdapter`
(una `pyodbc.Connection` por instancia). El uso de `with` sobre el cursor
es la única abstracción transaccional aquí salvo `update_role_permissions`,
que sí abre una transacción explícita.
"""
import logging
import os
from typing import List, Optional

import pyodbc

from domain.models.permission import Permission
from domain.models.role import Role
from domain.repositories.rbac_sql_repository import IRbacSqlRepository


class RbacSqlAdapter(IRbacSqlRepository):
    def __init__(self):
        self.connection = pyodbc.connect(os.getenv("SQL_CONNECTION_STRING"))

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _row_to_permission(row) -> Permission:
        return Permission(
            id=str(row.id),
            name=row.name,
            resource=row.resource,
            action=row.action,
            module=row.module,
            description=row.description,
        )

    @staticmethod
    def _row_to_role(row, permissions: Optional[List[Permission]] = None) -> Role:
        return Role(
            id=str(row.id),
            name=row.name,
            description=row.description,
            is_active=bool(row.is_active),
            is_system=bool(row.is_system),
            created_at=row.created_at,
            permissions=permissions or [],
        )

    # ------------------------------------------------------------- Permissions
    def list_permissions(self) -> List[Permission]:
        cursor = self.connection.cursor()
        cursor.execute(
            """
            SELECT id, name, resource, [action], module, description
              FROM dbo.Permissions
             ORDER BY module, name;
            """
        )
        return [self._row_to_permission(r) for r in cursor.fetchall()]

    # ------------------------------------------------------------------- Roles
    def list_roles(self) -> List[Role]:
        cursor = self.connection.cursor()
        cursor.execute(
            """
            SELECT id, name, description, is_active, is_system, created_at
              FROM dbo.Roles
             ORDER BY is_system DESC, name ASC;
            """
        )
        return [self._row_to_role(r) for r in cursor.fetchall()]

    def get_role(self, role_id: str) -> Optional[Role]:
        # LEFT JOIN para hidratar permisos en una sola query
        cursor = self.connection.cursor()
        cursor.execute(
            """
            SELECT
                r.id, r.name, r.description, r.is_active, r.is_system, r.created_at,
                p.id           AS perm_id,
                p.name         AS perm_name,
                p.resource     AS perm_resource,
                p.[action]     AS perm_action,
                p.module       AS perm_module,
                p.description  AS perm_description
              FROM dbo.Roles r
              LEFT JOIN dbo.RolePermissions rp ON rp.role_id = r.id
              LEFT JOIN dbo.Permissions p      ON p.id       = rp.permission_id
             WHERE r.id = ?;
            """,
            role_id,
        )
        rows = cursor.fetchall()
        if not rows:
            return None

        first = rows[0]
        permissions: List[Permission] = []
        for r in rows:
            if r.perm_id is not None:
                permissions.append(
                    Permission(
                        id=str(r.perm_id),
                        name=r.perm_name,
                        resource=r.perm_resource,
                        action=r.perm_action,
                        module=r.perm_module,
                        description=r.perm_description,
                    )
                )
        return self._row_to_role(first, permissions=permissions)

    def get_role_by_name(self, name: str) -> Optional[Role]:
        cursor = self.connection.cursor()
        cursor.execute(
            """
            SELECT id, name, description, is_active, is_system, created_at
              FROM dbo.Roles
             WHERE name = ?;
            """,
            name,
        )
        row = cursor.fetchone()
        return self._row_to_role(row) if row else None

    def create_role(self, role: Role) -> Role:
        cursor = self.connection.cursor()
        cursor.execute(
            """
            INSERT INTO dbo.Roles (id, name, description, is_active, is_system, created_at)
            VALUES (?, ?, ?, ?, ?, ?);
            """,
            role.id,
            role.name,
            role.description,
            int(role.is_active),
            int(role.is_system),
            role.created_at,
        )
        self.connection.commit()
        return role

    def update_role(self, role: Role) -> None:
        cursor = self.connection.cursor()
        cursor.execute(
            """
            UPDATE dbo.Roles
               SET name = ?, description = ?, is_active = ?
             WHERE id = ?;
            """,
            role.name,
            role.description,
            int(role.is_active),
            role.id,
        )
        self.connection.commit()

    def delete_role(self, role_id: str) -> None:
        # ON DELETE CASCADE en dbo.RolePermissions limpia la matriz.
        # Defensa en profundidad: la cláusula `is_system = 0` evita borrar
        # roles de sistema incluso si el Use Case fuese saltado.
        cursor = self.connection.cursor()
        cursor.execute(
            "DELETE FROM dbo.Roles WHERE id = ? AND is_system = 0;",
            role_id,
        )
        self.connection.commit()

    # --------------------------------------------------------- Matriz permisos
    def update_role_permissions(
        self, role_id: str, permission_ids: List[str]
    ) -> None:
        """Estrategia full-replace dentro de una transacción explícita."""
        try:
            self.connection.autocommit = False
            cursor = self.connection.cursor()
            cursor.execute(
                "DELETE FROM dbo.RolePermissions WHERE role_id = ?;",
                role_id,
            )
            if permission_ids:
                cursor.executemany(
                    "INSERT INTO dbo.RolePermissions (role_id, permission_id) VALUES (?, ?);",
                    [(role_id, pid) for pid in permission_ids],
                )
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            logging.exception("[RbacSqlAdapter] update_role_permissions failed")
            raise
        finally:
            self.connection.autocommit = True
