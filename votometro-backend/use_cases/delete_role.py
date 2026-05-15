from domain.exceptions import RoleNotFoundException, SystemRoleProtectedException
from domain.repositories.rbac_sql_repository import IRbacSqlRepository


class DeleteRoleUseCase:
    """Elimina un rol custom. Los roles de sistema (`is_system=True`) están
    protegidos y devuelven `SystemRoleProtectedException`."""

    def __init__(self, rbac: IRbacSqlRepository):
        self._rbac = rbac

    def execute(self, role_id: str) -> None:
        role = self._rbac.get_role(role_id)
        if not role:
            raise RoleNotFoundException(role_id)
        if role.is_system:
            raise SystemRoleProtectedException("eliminar", role.name)
        self._rbac.delete_role(role_id)
