"""Caso de uso: crear un usuario.

Refactor 2026-05-09:
  · Acepta opcionalmente `IUserZonesRepository`. Si se inyecta y `user_data`
    incluye la clave `zones`, después de persistir el usuario en Graph + SQL
    se hace el upsert de las asignaciones geográficas en `dbo.User_Zones`.
  · `zones` espera el mismo formato que update_user:
        [{"cod_dep": "05"}, {"cod_dep": "76", "cod_mun": "001"}]
"""
import logging
from datetime import datetime
from typing import List, Optional
from pytz import timezone

from domain.models.product import Product, UserZone
from domain.models.user import User
from domain.repositories.user_repository import IUserRepository
from domain.exceptions import UserAlreadyExistsException
from domain.repositories.user_sql_repository import IUserSqlRepository
from domain.repositories.user_zones_repository import IUserZonesRepository
from shared.utils import calculate_expiration


class CreateUserUseCase:
    def __init__(
        self,
        user_repository: IUserRepository,
        sql_repository: IUserSqlRepository,
        zones_repository: Optional[IUserZonesRepository] = None,
    ):
        self.user_repository = user_repository
        self.sql_repository = sql_repository
        self.zones_repository = zones_repository

    def execute(self, user_data: dict) -> dict:
        display_name = user_data.get("display_name")
        phone = user_data.get("phone")
        email = user_data.get("email")
        password = user_data.get("password")
        role = user_data.get("role")
        type_person = user_data.get("type_person")
        type_dni = user_data.get("type_dni")
        identity_document = user_data.get("identity_document")
        reference = user_data.get("reference")
        reference2 = user_data.get("reference2")
        personal_email = user_data.get("personal_email")
        zones = user_data.get("zones")  # opcional

        user = User(
            display_name=display_name, email=email, password=password, phone=phone
        )
        created_user = self.user_repository.create_user(user)
        self.user_repository.assign_user_to_service_principal(
            created_user.id, role)
        created_user.created_at = datetime.now(timezone("America/Bogota"))
        created_user.type_person = type_person
        created_user.type_dni = type_dni
        created_user.identity_document = identity_document
        created_user.reference = reference
        created_user.reference2 = reference2
        created_user.personal_email = personal_email
        created_user.role = role

        product_items: List[Product] = []
        seen_product_names = set()
        for product_data in user_data.get("products", []):
            name = product_data["name"]
            if name in seen_product_names:
                continue
            seen_product_names.add(name)

            product_zones = [
                UserZone(
                    cod_dep=str(zone.get("cod_dep", "")).zfill(2),
                    cod_mun=(
                        str(zone.get("cod_mun"))[-3:].zfill(3)
                        if zone.get("cod_mun")
                        else None
                    ),
                    enable=zone.get("enable", True),
                )
                for zone in product_data.get("zones", [])
                if isinstance(zone, dict) and zone.get("cod_dep")
            ]

            product = Product(
                name=name,
                contract_duration=product_data["contract_duration"],
                duration_unit=product_data["duration_unit"],
                expiration=calculate_expiration(
                    product_data, created_user.created_at),
                amount_cop=float(product_data.get("amount_cop", 0)),
                enable=product_data.get("enable", True),
                zones=product_zones,
            )
            product_items.append(product)

        created_user.created_at = created_user.created_at.strftime(
            "%Y-%m-%d %H:%M:%S")
        created_user.products = product_items
        self.sql_repository.save_user_metadata(created_user)

        # Persistir zonas geográficas si se enviaron Y hay repo inyectado.
        # Si zones=[], igual se hace upsert (limpia cualquier asignación
        # previa si por alguna razón el user_id ya existía).
        if zones is not None and self.zones_repository is not None:
            try:
                self.zones_repository.upsert_user_zones(created_user.id, zones)
            except Exception:
                # NO tumbamos la creación del usuario por un fallo en zonas.
                # El admin puede re-asignar zonas desde la edición.
                logging.exception(
                    "[CreateUser] upsert_user_zones failed for user=%s",
                    created_user.id,
                )

        created_user.products = [
            {
                **p.__dict__,
                "zones": [
                    {
                        "cod_dep": z.cod_dep,
                        "cod_mun": z.cod_mun,
                        "enable": z.enable,
                    }
                    for z in p.zones
                ],
            }
            for p in created_user.products
        ]
        result = created_user.__dict__.copy() if hasattr(created_user, "__dict__") else dict(created_user)
        # Hacer eco del set declarado para que el frontend pinte el form sin re-fetch
        result["zones"] = zones if zones is not None else []
        return result
