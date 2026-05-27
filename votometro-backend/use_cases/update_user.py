"""Caso de uso: actualizar un usuario existente.

Refactor 2026-05-09:
  · Acepta opcionalmente `IUserZonesRepository`. Cuando se inyecta, después
    de actualizar el usuario en Graph + SQL, el caso de uso persiste las
    `zones` declaradas (lista de dicts con cod_dep/cod_mun) en `dbo.User_Zones`
    mediante upsert transaccional (DELETE + INSERT).
  · El parámetro `zones` se pasa por separado al método `execute`, no se
    embebe en el modelo `User` para mantener la entidad limpia.
"""
import logging
from typing import Dict, List, Optional

from domain.models.user import User
from domain.repositories.user_repository import IUserRepository
from domain.repositories.user_sql_repository import IUserSqlRepository
from domain.repositories.user_zones_repository import IUserZonesRepository


class UpdateUserUseCase:
    def __init__(
        self,
        graph_repo: IUserRepository,
        sql_repo: IUserSqlRepository,
        zones_repo: Optional[IUserZonesRepository] = None,
    ):
        self.graph_repo = graph_repo
        self.sql_repo = sql_repo
        self.zones_repo = zones_repo

    def execute(
        self,
        user: User,
        zones: Optional[List[Dict[str, Optional[str]]]] = None,
    ) -> None:
        current_user = self.sql_repo.get_user(user.id)

        if current_user["role"] != user.role:
            try:
                assignments = self.graph_repo.get_user_app_role_assignments(user.id)
                for assignment in assignments:
                    self.graph_repo.remove_user_from_app_role(user.id, assignment["id"])
                self.graph_repo.assign_user_to_service_principal(user.id, user.role)
            except Exception:
                logging.warning(
                    "UpdateUserUseCase: Graph role update failed for user_id=%s; SQL update will continue",
                    user.id,
                    exc_info=True,
                )

        try:
            self.graph_repo.update_user(user)
        except Exception:
            logging.warning(
                "UpdateUserUseCase: Graph profile update failed for user_id=%s; SQL update will continue",
                user.id,
                exc_info=True,
            )
        self.sql_repo.update_user(user)

        # Persistir zonas geográficas si vienen Y hay repo inyectado.
        # `zones=None` significa "no tocar las asignaciones existentes".
        # `zones=[]` significa "limpiar todas las asignaciones".
        if zones is not None and self.zones_repo is not None:
            self.zones_repo.upsert_user_zones(user.id, zones)
