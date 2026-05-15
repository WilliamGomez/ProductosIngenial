from abc import ABC, abstractmethod
from typing import List

from domain.models.department import Department


class IDepartmentSqlRepository(ABC):

    @abstractmethod
    def list_departments(self) -> List[Department]:
        pass
