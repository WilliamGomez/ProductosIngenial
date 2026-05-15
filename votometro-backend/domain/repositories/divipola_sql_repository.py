from abc import ABC, abstractmethod
from typing import List

from domain.models.divipola import DivipolaEntry


class IDivipolaSqlRepository(ABC):
    """Contrato del catálogo geográfico DIVIPOLA en SQL Server."""

    @abstractmethod
    def bulk_upsert(self, entries: List[DivipolaEntry]) -> dict:
        """Inserta o actualiza en bloque vía MERGE.

        Returns:
            dict con claves `inserted`, `updated`, `total` para que el
            handler pueda devolver un resumen al frontend.
        """

    @abstractmethod
    def truncate(self) -> None:
        """Vacía la tabla. Lo usa el endpoint cuando el caller pasa
        ?mode=replace en la query string."""

    @abstractmethod
    def count(self) -> int:
        """Devuelve el número total de filas — útil para healthchecks
        y para mostrar el estado actual del catálogo en la UI."""
