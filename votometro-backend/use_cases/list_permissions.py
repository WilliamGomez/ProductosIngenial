from typing import Dict, List

from domain.models.permission import Permission
from domain.repositories.rbac_sql_repository import IRbacSqlRepository


class ListPermissionsUseCase:
    """Devuelve los permisos AGRUPADOS por módulo.

    El frontend (`RolesMatrix.tsx`) consume el dict directamente para
    renderizar las secciones de checkboxes — agrupar en backend evita
    lógica de UI duplicada.
    """

    def __init__(self, rbac: IRbacSqlRepository):
        self._rbac = rbac

    def execute(self) -> Dict[str, List[Permission]]:
        permissions = self._rbac.list_permissions()
        grouped: Dict[str, List[Permission]] = {}
        for p in permissions:
            grouped.setdefault(p.module, []).append(p)
        return {
            module: sorted(items, key=lambda x: x.name)
            for module, items in sorted(grouped.items())
        }
