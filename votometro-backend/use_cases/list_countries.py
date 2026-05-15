from typing import List

from domain.models.department import Department
from domain.repositories.department_sql_repository import IDepartmentSqlRepository


class ListCountriesUseCase:
    def __init__(self, sql_repository: IDepartmentSqlRepository):
        self.sql_repository = sql_repository

    def execute(self) -> List[Department]:
        departments = self.sql_repository.list_departments()
        countries = list(filter(lambda d: d["code"] == 0, departments))
        return countries
