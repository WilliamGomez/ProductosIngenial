from domain.repositories.session_sql_repository import ISessionSqlRepository


class ForceLogoutAllDevicesUseCase:
    def __init__(self, sql_repository: ISessionSqlRepository):
        self.sql_repository = sql_repository

    def execute(self, user_id: str) -> None:
        self.sql_repository.invalidate_all_sessions(user_id)
