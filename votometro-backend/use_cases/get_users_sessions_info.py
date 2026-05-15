from typing import Dict, List
from domain.repositories.session_sql_repository import ISessionSqlRepository


class GetUsersSessionsInfoUseCase:
    def __init__(self, sql_repository: ISessionSqlRepository):
        self.sql_repository = sql_repository

    def execute(self) -> List[Dict]:
        response = self.sql_repository.get_users_sessions_info()
        return response
