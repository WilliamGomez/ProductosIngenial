from typing import Optional

from domain.exceptions import RoleNotFoundException, SystemRoleProtectedException
from domain.models.role import Role
from domain.repositories.rbac_sql_repository import IRbacSqlRepository


class UpdateRoleUseCase:
    """Edita la metadata de un rol (name/description/is_active).

    No toca permisos — para eso existe `UpdateRolePermissionsUseCase`.
    Bloquea cualquier intento de renombrar un rol con `is_system=True`.
    """

    def __init__(self, rbac: IRbacSqlRepository):
        self._rbac = rbac

    def execute(
        self,
        role_id: str,
        name: Optional[str],
        description: Optional[str],
        is_active: Optional[bool],
    ) -> Role:
        role = self._rbac.get_role(role_id)
        if not role:
            raise RoleNotFoundException(role_id)

        if role.is_system and name and name.strip() != role.name:
            raise SystemRoleProtectedException("renombrar", role.name)

        role.name = (name or role.name).strip()
        if description is not None:
            role.description = description.strip() or None
        if is_active is not None:
            role.is_active = bool(is_active)

        self._rbac.update_role(role)
        return role
