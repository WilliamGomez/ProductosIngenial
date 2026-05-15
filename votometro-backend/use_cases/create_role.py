import re
import uuid
from datetime import datetime
from pytz import timezone
from typing import Optional

from domain.exceptions import RoleAlreadyExistsException
from domain.models.role import Role
from domain.repositories.rbac_sql_repository import IRbacSqlRepository


# Naming: 3-40 chars, alfanumérico + espacios + guiones bajos.
_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_ ]{3,40}$")
# Nombres reservados — los roles de sistema viven en SQL con `is_system=1`,
# pero igual blindamos a nivel app contra duplicados case-insensitive.
_RESERVED_NAMES = {"superadmin", "admin", "user"}


class CreateRoleUseCase:
    def __init__(self, rbac: IRbacSqlRepository):
        self._rbac = rbac

    def execute(self, name: str, description: Optional[str]) -> Role:
        name = (name or "").strip()
        if not _NAME_PATTERN.match(name):
            raise ValueError(
                "El nombre debe tener 3-40 caracteres alfanuméricos."
            )
        if name.lower() in _RESERVED_NAMES:
            raise RoleAlreadyExistsException(name)
        if self._rbac.get_role_by_name(name):
            raise RoleAlreadyExistsException(name)

        role = Role(
            id=str(uuid.uuid4()),
            name=name,
            description=(description or "").strip() or None,
            is_active=True,
            is_system=False,
            created_at=datetime.now(timezone("America/Bogota")),
        )
        return self._rbac.create_role(role)
