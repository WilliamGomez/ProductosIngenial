from dataclasses import dataclass, field
from typing import List, Optional


@dataclass(frozen=True)
class UserZone:
    """Asignacion geografica de un usuario al modelo DIVIPOLA electoral.

    Reglas:
      - `cod_mun = None` -> acceso a todo el departamento.
      - `cod_mun != None` -> municipio local DIVIPOLA de 3 digitos.
    """

    cod_dep: str
    cod_mun: Optional[str] = None

    def __post_init__(self) -> None:
        cod_dep = str(self.cod_dep or "").strip().zfill(2)
        cod_mun = (
            str(self.cod_mun).strip().zfill(3)
            if self.cod_mun is not None and str(self.cod_mun).strip()
            else None
        )

        if len(cod_dep) != 2:
            raise ValueError("cod_dep debe tener 2 digitos")
        if cod_mun is not None and len(cod_mun) != 3:
            raise ValueError("cod_mun debe tener 3 digitos")

        object.__setattr__(self, "cod_dep", cod_dep)
        object.__setattr__(self, "cod_mun", cod_mun)


@dataclass
class UserZoneSet:
    """Agregado de las zonas asignadas a un usuario."""

    user_id: str
    zones: List[UserZone] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return len(self.zones) == 0

    @property
    def departments(self) -> List[str]:
        return sorted({z.cod_dep for z in self.zones if z.cod_dep})

    @property
    def municipalities(self) -> List[str]:
        return sorted({z.cod_mun for z in self.zones if z.cod_mun})
