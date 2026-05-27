"""Caso de uso: restablecer la contraseña de un usuario (acción de Admin).

El Admin proporciona la nueva contraseña en texto plano; este use case la
envía directamente a Azure AD via MS Graph usando el passwordProfile.
La política de complejidad la valida el frontend antes de enviar y Azure AD
la revalida en el momento del PATCH — cualquier rechazo sube como ValueError.
"""


class ResetPasswordUseCase:
    def __init__(self, graph_repo):
        self.graph_repo = graph_repo

    def execute(self, user_id: str, new_password: str, force_change_next_signin: bool = True) -> None:
        if not user_id:
            raise ValueError("user_id is required")
        if not new_password:
            raise ValueError("new_password is required")
        if len(new_password) < 12:
            raise ValueError("La contrasena debe tener al menos 12 caracteres.")

        self.graph_repo.reset_password(
            user_id=user_id,
            new_password=new_password,
            force_change_next_signin=force_change_next_signin,
        )
