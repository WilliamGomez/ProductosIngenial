from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional

from domain.models.permission import Permission


@dataclass
class Role:
    """Rol RBAC.

    Si `is_system=True`, el rol es de sistema (`SuperAdmin`, `Admin`, `User`)
    y no puede borrarse ni renombrarse. La regla se enforce en los Use Cases
    `UpdateRoleUseCase` y `DeleteRoleUseCase`.
    """

    id: str                                 # UNIQUEIDENTIFIER en SQL
    name: str                               # único; ver dbo.Roles UNIQUE
    description: Optional[str] = None
    is_active: bool = True
    is_system: bool = False
    created_at: Optional[datetime] = None
    permissions: List[Permission] = field(default_factory=list)
