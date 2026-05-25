from abc import ABC, abstractmethod
from typing import List
from domain.models.product import Product
from domain.models.user import User


class IUserSqlRepository(ABC):
    @abstractmethod
    def save_user_metadata(self, user: User):
        pass

    @abstractmethod
    def list_users(self) -> List[User]:
        pass

    @abstractmethod
    def get_user(self, user_id: str) -> User:
        pass

    @abstractmethod
    def update_user(self, user: User):
        pass

    @abstractmethod
    def delete_user(self, user_id: str) -> None:
        pass

    @abstractmethod
    def upsert_user_products(self, user_id: str, products: List[Product]):
        pass

    @abstractmethod
    def disable_products_not_in_list(self, user_id: str, product_names: List[str]):
        pass

    @abstractmethod
    def enable_products_in_list(self, user_id: str, product_names: List[str]):
        pass

    @abstractmethod
    def get_enabled_product_names(self, user_id: str) -> List[str]:
        """Get list of enabled product names for a user"""
        pass
