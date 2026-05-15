from typing import List

from domain.models.municipality import Municipality
from domain.repositories.municipality_sql_repository import IMunicipalitySqlRepository


class ListMunicipalitiesUseCase:
    def __init__(self, sql_repository: IMunicipalitySqlRepository):
        self.sql_repository = sql_repository

    def execute(self) -> List[Municipality]:
        return self.sql_repository.list_municipalities()
