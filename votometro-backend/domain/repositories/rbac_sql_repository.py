from abc import ABC, abstractmethod
from typing import List, Optional

from domain.models.permission import Permission
from domain.models.role import Role


class IRbacSqlRepository(ABC):
    """Contrato para el módulo RBAC dinámico (SQL Server).

    Toda la lógica de Autorización vive en SQL — Entra ID solo aporta
    Autenticación. Los Use Cases dependen de esta abstracción y no tocan
    pyodbc directamente.
    """

    # ---- Permissions (catálogo, lectura solamente) -------------------------
    @abstractmethod
    def list_permissions(self) -> List[Permission]:
        ...

    # ---- Roles --------------------------------------------------------------
    @abstractmethod
    def list_roles(self) -> List[Role]:
        ...

    @abstractmethod
    def get_role(self, role_id: str) -> Optional[Role]:
        """Devuelve el rol con su lista de permisos hidratada (LEFT JOIN)."""

    @abstractmethod
    def get_role_by_name(self, name: str) -> Optional[Role]:
        ...

    @abstractmethod
    def create_role(self, role: Role) -> Role:
        ...

    @abstractmethod
    def update_role(self, role: Role) -> None:
        """Actualiza name/description/is_active. NO toca permisos."""

    @abstractmethod
    def delete_role(self, role_id: str) -> None:
        ...

    # ---- Matriz de permisos -------------------------------------------------
    @abstractmethod
    def update_role_permissions(self, role_id: str, permission_ids: List[str]) -> None:
        """Reemplaza por completo la matriz del rol (DELETE + INSERT en
        transacción). Estrategia full-replace para auditoría simple."""
