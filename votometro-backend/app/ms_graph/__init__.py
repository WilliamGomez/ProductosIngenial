from domain.models.user import User
from domain.repositories.user_repository import IUserRepository
from domain.exceptions import UserAlreadyExistsException


class CreateUserUseCase:
    def __init__(self, user_repository: IUserRepository):
        self.user_repository = user_repository

    def execute(self, user_data: dict) -> User:
        email = user_data.get("email")
        display_name = user_data.get("display_name")

        # Validaciones mínimas de entrada (puedes moverlas a validadores si lo prefieres)
        if not email or not display_name:
            raise ValueError("El campo 'email' y 'display_name' son obligatorios.")

        # Opcional: Verificar si el usuario ya existe (según implementación)
        # existing_user = self.user_repository.find_by_email(email)
        # if existing_user:
        #     raise UserAlreadyExistsException(email)

        user = User(display_name=display_name, email=email)
        return self.user_repository.create_user(user)
