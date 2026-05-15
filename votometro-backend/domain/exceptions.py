class DomainException(Exception):
    """Excepción base para errores del dominio."""

    pass


class UserAlreadyExistsException(DomainException):
    """Se lanza si se intenta crear un usuario ya existente."""

    def __init__(self, email: str):
        super().__init__(f"El usuario con el correo '{email}' ya existe.")


class UserNotFoundException(DomainException):
    """Se lanza si no se encuentra un usuario."""

    def __init__(self, user_id: str):
        super().__init__(f"Usuario con ID '{user_id}' no encontrado.")


# =============================================================================
# RBAC · excepciones del módulo de roles y permisos dinámicos
# =============================================================================

class RoleAlreadyExistsException(DomainException):
    """Se lanza al intentar crear un rol con un nombre ya tomado o reservado."""

    def __init__(self, name: str):
        super().__init__(f"Ya existe un rol con el nombre '{name}'.")


class RoleNotFoundException(DomainException):
    """Se lanza cuando el rol referenciado no existe en SQL."""

    def __init__(self, role_id: str):
        super().__init__(f"Rol con ID '{role_id}' no encontrado.")


class SystemRoleProtectedException(DomainException):
    """Se lanza al intentar modificar/borrar un rol con `is_system=True`."""

    def __init__(self, action: str, role_name: str):
        super().__init__(
            f"No se puede {action} el rol de sistema '{role_name}'."
        )


class InvalidPermissionException(DomainException):
    """Se lanza cuando se intenta asignar un permiso inexistente."""

    def __init__(self, permission_id: str):
        super().__init__(f"El permiso '{permission_id}' no existe.")
