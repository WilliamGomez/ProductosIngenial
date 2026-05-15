from abc import ABC, abstractmethod
from typing import List


from domain.models.municipality import Municipality


class IMunicipalitySqlRepository(ABC):

    @abstractmethod
    def list_municipalities(self) -> List[Municipality]:
        pass
