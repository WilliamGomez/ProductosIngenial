from typing import List

from domain.models.user import User
from domain.repositories.user_sql_repository import IUserSqlRepository


class ListUsersUseCase:
    def __init__(self, sql_repository: IUserSqlRepository):
        self.sql_repository = sql_repository

    def execute(self) -> List[User]:
        return self.sql_repository.list_users()
