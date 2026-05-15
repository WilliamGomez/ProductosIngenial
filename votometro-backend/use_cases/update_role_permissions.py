import logging
from typing import List, Set

from domain.exceptions import (
    InvalidPermissionException,
    RoleNotFoundException,
)
from domain.repositories.rbac_sql_repository import IRbacSqlRepository


# SuperAdmin SIEMPRE tiene TODOS los permisos. Si alguien intenta dejarle
# una matriz vacía o reducida, se ignora el payload y se re-asigna el
# catálogo completo (idempotente).
_SUPERADMIN_NAME = "SuperAdmin"


class UpdateRolePermissionsUseCase:
    """Reemplaza la matriz de permisos de un rol existente.

    Reglas:
      · El rol debe existir (`RoleNotFoundException`).
      · Todos los `permission_ids` deben existir en el catálogo
        (`InvalidPermissionException`).
      · El rol `SuperAdmin` no acepta reducir permisos: siempre se
        re-asigna la lista completa.
    """

    def __init__(self, rbac: IRbacSqlRepository):
        self._rbac = rbac

    def execute(self, role_id: str, permission_ids: List[str]) -> None:
        role = self._rbac.get_role(role_id)
        if not role:
            raise RoleNotFoundException(role_id)

        catalog: Set[str] = {p.id for p in self._rbac.list_permissions()}
        unknown = [pid for pid in permission_ids if pid not in catalog]
        if unknown:
            raise InvalidPermissionException(unknown[0])

        if role.name == _SUPERADMIN_NAME:
            if set(permission_ids) != catalog:
                logging.warning(
                    "[UpdateRolePermissions] Intento de reducir permisos de "
                    "SuperAdmin bloqueado. Re-asignando catálogo completo."
                )
            self._rbac.update_role_permissions(role.id, list(catalog))
            return

        normalized = list(set(permission_ids))
        self._rbac.update_role_permissions(role.id, normalized)
        logging.info(
            "[UpdateRolePermissions] role=%s perms=%d",
            role.name, len(normalized),
        )
