from domain.exceptions import RoleNotFoundException
from domain.models.role import Role
from domain.repositories.rbac_sql_repository import IRbacSqlRepository


class GetRoleUseCase:
    def __init__(self, rbac: IRbacSqlRepository):
        self._rbac = rbac

    def execute(self, role_id: str) -> Role:
        role = self._rbac.get_role(role_id)
        if not role:
            raise RoleNotFoundException(role_id)
        return role
