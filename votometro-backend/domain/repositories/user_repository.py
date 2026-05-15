from abc import ABC, abstractmethod
from typing import Dict, List
from domain.models.user import User


class IUserRepository(ABC):

    @abstractmethod
    def create_user(self, user: User) -> User:
        pass

    @abstractmethod
    def get_user(self, user_id: str) -> User:
        pass

    @abstractmethod
    def update_user(self, user: User) -> User:
        pass

    @abstractmethod
    def delete_user(self, user_id: str) -> None:
        pass

    @abstractmethod
    def list_users(self) -> List[User]:
        pass

    @abstractmethod
    def assign_user_to_service_principal(self, user_id: str, role_name: str) -> Dict:
        pass
