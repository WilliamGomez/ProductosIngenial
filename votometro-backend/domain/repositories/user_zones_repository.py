from abc import ABC, abstractmethod
from typing import List, Dict

from domain.models.user_zone import UserZoneSet


class IUserZonesRepository(ABC):
    """Contrato para leer/escribir asignaciones geográficas por usuario.

    Modelo DIVIPOLA:
      · cod_dep + cod_mun=NULL → todo el departamento
      · cod_dep + cod_mun      → solo ese municipio
    """

    @abstractmethod
    def list_user_zones(self, user_id: str) -> UserZoneSet:
        """Retorna las asignaciones declaradas del usuario (sin expandir).
        Cada elemento es una fila de `dbo.User_Zones` con `enable=1`."""

    @abstractmethod
    def list_user_product_zones(self, user_id: str, product_name: str) -> UserZoneSet:
        """Retorna las zonas activas de un usuario para un producto activo.

        Lee `dbo.Products` + `dbo.User_Zones` por `product_id`. Un producto sin
        filas activas retorna un set vacio, que el rol DAX debe interpretar
        como "sin acceso".
        """

    @abstractmethod
    def upsert_user_zones(
        self, user_id: str, assignments: List[Dict[str, str]]
    ) -> None:
        """Reemplaza las asignaciones del usuario por las recibidas.

        `assignments`: lista de dicts con la forma:
            {"cod_dep": "05"}                   → depto completo
            {"cod_dep": "11", "cod_mun": "001"} → municipio específico

        Estrategia transaccional: dentro de un BEGIN/COMMIT, primero
        DELETE de todas las filas del user, luego INSERT del nuevo set.
        """
