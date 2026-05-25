from abc import ABC, abstractmethod
from typing import Dict, List
from pyodbc import Row


class ISessionSqlRepository(ABC):
    @abstractmethod
    def create_session(
        self,
        user_id: str,
        device_id: str,
        session_token: str,
        ipaddr: str,
        is_active: bool,
        is_blocked: bool,
        user_agent: str | None = None,
    ) -> None:
        pass

    @abstractmethod
    def invalidate_sessions(self, user_id: str, device_id: str) -> None:
        pass

    @abstractmethod
    def invalidate_session_identifier(self, session_identifier: str) -> None:
        pass

    @abstractmethod
    def revoke_session(self, session_id: str) -> None:
        pass

    @abstractmethod
    def get_session_status(self, user_id: str, session_token: str) -> Dict | None:
        pass

    @abstractmethod
    def record_heartbeat(
        self,
        user_id: str,
        session_token: str,
        pages: List[Dict],
        idle_timeout_seconds: int = 7200,
    ) -> Dict:
        pass

    @abstractmethod
    def get_active_session(self, user_id: str) -> Row:
        pass

    @abstractmethod
    def get_device_from_session(self, session_id) -> Row:
        pass

    @abstractmethod
    def get_users_sessions_info(self) -> List[Dict]:
        pass

    @abstractmethod
    def get_session_activity_detail(self, session_id: str) -> Dict:
        pass

    @abstractmethod
    def get_session_analytics(self, days: int = 30) -> Dict:
        pass

    @abstractmethod
    def invalidate_all_sessions(self, user_id: str) -> None:
        pass
