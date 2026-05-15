"""Caso de uso: obtener un usuario con sus zonas geográficas asignadas.

Cambio 2026-05-09: el payload de usuario ahora incluye `zones`, una lista
con las asignaciones declaradas en `dbo.User_Zones`. Cada entrada tiene:
    {"cod_dep": "05", "cod_mun": null}        → depto completo
    {"cod_dep": "11", "cod_mun": "001"}       → municipio específico

Esto permite que el formulario del admin pinte de vuelta lo que el usuario
ya tiene asignado al editarlo.
"""
from typing import Optional

from domain.models.user import User
from domain.repositories.user_sql_repository import IUserSqlRepository
from domain.repositories.user_zones_repository import IUserZonesRepository


class GetUserUseCase:
    def __init__(
        self,
        sql_repository: IUserSqlRepository,
        zones_repository: Optional[IUserZonesRepository] = None,
    ):
        # `zones_repository` es opcional para compatibilidad con call sites
        # que aún no fueron actualizados — si no se inyecta, simplemente no
        # se adjunta el campo `zones` al payload.
        self.sql_repository = sql_repository
        self.zones_repository = zones_repository

    def execute(self, user_id: str):
        user = self.sql_repository.get_user(user_id)
        if not user:
            return None

        if self.zones_repository:
            try:
                zset = self.zones_repository.list_user_zones(user_id)
                # Convertimos cada UserZone a dict serializable
                zones_payload = [
                    {"cod_dep": z.cod_dep, "cod_mun": z.cod_mun}
                    for z in zset.zones
                ]
            except Exception as err:
                # No queremos que un fallo del catálogo geo tumbe la consulta
                # del usuario; loggeamos y devolvemos zones vacío.
                import logging
                logging.warning("[GetUser] zones lookup failed: %s", err)
                zones_payload = []
        else:
            zones_payload = []

        # `user` puede ser dict (UserSqlAdapter actual) o dataclass User.
        if isinstance(user, dict):
            user["zones"] = zones_payload
            return user
        # Si es dataclass, convertimos a dict para añadir el campo nuevo
        if isinstance(user, User):
            payload = user.__dict__.copy()
            payload["zones"] = zones_payload
            return payload
        # Fallback: best effort
        try:
            user.zones = zones_payload  # type: ignore[attr-defined]
        except Exception:
            pass
        return user
