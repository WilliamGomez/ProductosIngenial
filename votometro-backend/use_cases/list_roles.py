from typing import List

from domain.models.role import Role
from domain.repositories.rbac_sql_repository import IRbacSqlRepository


class ListRolesUseCase:
    def __init__(self, rbac: IRbacSqlRepository):
        self._rbac = rbac

    def execute(self) -> List[Role]:
        return self._rbac.list_roles()
