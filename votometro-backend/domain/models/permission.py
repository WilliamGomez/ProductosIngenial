from dataclasses import dataclass
from typing import Optional


@dataclass
class Permission:
    """Permiso atómico del sistema.

    Las filas se siembran desde `db/init/03_rbac.sql` y NO se editan vía API;
    los Use Cases solo asocian/desasocian permisos a roles, nunca crean filas
    nuevas en `Permissions`.
    """

    id: str                    # UNIQUEIDENTIFIER en SQL
    name: str                  # ej. "users.read", "powerbi.view"
    resource: str              # ej. "users", "powerbi"
    action: str                # ej. "read", "write", "delete", "view"
    module: str                # agrupador UI: "Usuarios", "PowerBI", "Sesiones"
    description: Optional[str] = None
