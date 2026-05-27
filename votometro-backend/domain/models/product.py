from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional


@dataclass
class UserZone:
    """Zona geografica asignada a un producto."""

    cod_dep: str
    cod_mun: Optional[str] = None
    enable: bool = True

    def __post_init__(self) -> None:
        self.cod_dep = str(self.cod_dep or "").strip().zfill(2)
        if len(self.cod_dep) != 2:
            raise ValueError("cod_dep debe tener 2 digitos")

        if self.cod_mun is not None and str(self.cod_mun).strip():
            self.cod_mun = str(self.cod_mun).strip().zfill(3)
            if len(self.cod_mun) != 3:
                raise ValueError("cod_mun debe tener 3 digitos")
        else:
            self.cod_mun = None


@dataclass
class Product:
    """Producto contratado por un usuario con sus zonas geograficas asociadas."""

    name: str
    contract_duration: int
    duration_unit: str
    enable: bool = True
    expiration: Optional[datetime] = None
    amount_cop: Optional[float] = None
    zones: List[UserZone] = field(default_factory=list)
    id: Optional[int] = None
    display_name: Optional[str] = None
    route_path: Optional[str] = None
    powerbi_report_id: Optional[str] = None
    powerbi_workspace_id: Optional[str] = None
    powerbi_tenant_id: Optional[str] = None
    icon: Optional[str] = None
    display_order: int = 100
    is_report_enabled: bool = True
    description: Optional[str] = None
