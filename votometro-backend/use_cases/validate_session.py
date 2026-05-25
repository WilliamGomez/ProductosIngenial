from domain.repositories.session_sql_repository import ISessionSqlRepository
import uuid


class ValidateSessionUseCase:
    def __init__(self, sql_repository: ISessionSqlRepository):
        self.sql_repository = sql_repository

    def execute(self, user_id: str, ipaddr: str, device_id: str, user_agent: str | None = None) -> str:
        # Always allow login, invalidate ALL previous sessions for this user
        # This ensures only one active session per user at any time
        self.sql_repository.invalidate_all_sessions(user_id)

        session_token = str(uuid.uuid4())
        self.sql_repository.create_session(
            user_id, device_id, session_token, ipaddr, 1, 0, user_agent
        )
        return session_token
