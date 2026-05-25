"""Caso de uso: crear un usuario.

Historial de cambios:
  2026-05-09 (geo):
    · Acepta opcionalmente `IUserZonesRepository`. Si se inyecta y `user_data`
      incluye la clave `zones`, después de persistir el usuario en Graph + SQL
      se hace el upsert de las asignaciones geográficas en `dbo.User_Zones`.
    · `zones` espera: [{"cod_dep": "05"}, {"cod_dep": "76", "cod_mun": "001"}]

  2026-05-15 (HAL-18 — seguridad + notificación):
    · ELIMINADA la lectura de `password` desde el payload del frontend.
      La contraseña ya NO se acepta del exterior — se genera aquí con
      `secrets.token_urlsafe` para garantizar aleatoriedad criptográfica.
    · El resultado de vuelta al caller ya NO incluye el campo `password`.
    · Integrado `send_welcome_email`: tras crear el usuario en Graph + SQL,
      se envía un correo con las credenciales al `personal_email`. El fallo
      de envío es NOT FATAL — se loguea como warning y el flujo continúa.
"""
import logging
import secrets
import string
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
from shared.email_service import send_welcome_email


# ──────────────────────────────────────────────────────────────────────────
# Generación segura de contraseña temporal
# ──────────────────────────────────────────────────────────────────────────

# Política de complejidad compatible con Azure AD:
#   · Mínimo 8 caracteres
#   · Al menos 1 mayúscula, 1 minúscula, 1 dígito, 1 símbolo
#   · Sin ambigüedades visuales (0/O, 1/l/I)
_LOWER   = "abcdefghjkmnpqrstuvwxyz"          # sin 'i', 'l', 'o'
_UPPER   = "ABCDEFGHJKLMNPQRSTUVWXYZ"         # sin 'I', 'O'
_DIGITS  = "23456789"                          # sin '0', '1'
_SYMBOLS = "!@#$%&*+-=?"                       # seguros para SMTP / JSON

def _generate_temp_password(length: int = 14) -> str:
    """Genera una contraseña temporal que cumple la política de Azure AD.

    Garantía de complejidad:
      · 1 mayúscula  + 1 minúscula + 1 dígito + 1 símbolo obligatorios.
      · El resto se rellena con el alfabeto completo mezclado de forma segura.
      · Se baraja con `secrets.SystemRandom` para evitar posiciones predecibles.

    Args:
        length: Longitud total (mínimo 8). Por defecto 14 caracteres.

    Returns:
        Contraseña temporal como string.
    """
    if length < 8:
        length = 8

    alphabet = _LOWER + _UPPER + _DIGITS + _SYMBOLS
    rng      = secrets.SystemRandom()

    # Garantizar al menos un carácter de cada clase
    mandatory = [
        rng.choice(_UPPER),
        rng.choice(_LOWER),
        rng.choice(_DIGITS),
        rng.choice(_SYMBOLS),
    ]
    filler = [rng.choice(alphabet) for _ in range(length - len(mandatory))]

    password_chars = mandatory + filler
    rng.shuffle(password_chars)
    return "".join(password_chars)


# ──────────────────────────────────────────────────────────────────────────
# Use case
# ──────────────────────────────────────────────────────────────────────────

class CreateUserUseCase:
    def __init__(
        self,
        user_repository: IUserRepository,
        sql_repository: IUserSqlRepository,
        zones_repository: Optional[IUserZonesRepository] = None,
    ):
        self.user_repository  = user_repository
        self.sql_repository   = sql_repository
        self.zones_repository = zones_repository

    def execute(self, user_data: dict) -> dict:
        display_name      = user_data.get("display_name")
        phone             = user_data.get("phone")
        email             = user_data.get("email")
        role              = user_data.get("role")
        type_person       = user_data.get("type_person")
        type_dni          = user_data.get("type_dni")
        identity_document = user_data.get("identity_document")
        reference         = user_data.get("reference")
        reference2        = user_data.get("reference2")
        personal_email    = user_data.get("personal_email")
        zones             = user_data.get("zones")  # opcional

        # ── HAL-18 FIX: Generar contraseña en el servidor ────────────────
        # La contraseña NO se lee del payload. Si el frontend la envía,
        # se ignora deliberadamente.
        temp_password = _generate_temp_password(length=14)
        logging.info(
            "[CreateUser] Contraseña temporal generada en servidor para email=%s "
            "(nunca se loguea el valor — solo la confirmación).",
            email,
        )
        # ── /HAL-18 ───────────────────────────────────────────────────────

        # ── 1. Crear usuario en Azure AD (MS Graph) ───────────────────────
        user = User(
            display_name=display_name,
            email=email,
            password=temp_password,     # Contraseña generada localmente
            phone=phone,
        )
        created_user = self.user_repository.create_user(user)
        self.user_repository.assign_user_to_service_principal(
            created_user.id, role
        )

        # ── 2. Enriquecer el modelo con metadatos del perfil ──────────────
        created_user.created_at       = datetime.now(timezone("America/Bogota"))
        created_user.type_person      = type_person
        created_user.type_dni         = type_dni
        created_user.identity_document = identity_document
        created_user.reference        = reference
        created_user.reference2       = reference2
        created_user.personal_email   = personal_email
        created_user.role             = role

        # ── 3. Construir productos con zonas DIVIPOLA (2/3 dígitos) ───────
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
                    product_data, created_user.created_at
                ),
                amount_cop=float(product_data.get("amount_cop", 0)),
                enable=product_data.get("enable", True),
                zones=product_zones,
            )
            product_items.append(product)

        # ── 4. Persistir en SQL ───────────────────────────────────────────
        created_user.created_at = created_user.created_at.strftime(
            "%Y-%m-%d %H:%M:%S"
        )
        created_user.products = product_items
        self.sql_repository.save_user_metadata(created_user)

        # ── 5. Persistir zonas (fallo no fatal) ───────────────────────────
        if zones is not None and self.zones_repository is not None:
            try:
                self.zones_repository.upsert_user_zones(created_user.id, zones)
            except Exception:
                logging.exception(
                    "[CreateUser] upsert_user_zones failed for user=%s",
                    created_user.id,
                )

        # ── 6. Enviar correo de bienvenida con credenciales ───────────────
        #    · Si `personal_email` está vacío → warning + continúa.
        #    · Si el SMTP falla → warning + continúa (fallo NOT FATAL).
        email_context = {
            "display_name":        display_name or "Usuario",
            "institutional_email": email or "",
            "password":            temp_password,
            "datetime":            f"{created_user.created_at} (COT)",
        }
        if personal_email:
            sent = send_welcome_email(personal_email, email_context)
            if not sent:
                logging.warning(
                    "[CreateUser] No se pudo enviar el correo de bienvenida "
                    "a '%s' (user_id=%s). El usuario fue creado correctamente. "
                    "Verificar configuración SMTP.",
                    personal_email,
                    created_user.id,
                )
        else:
            logging.warning(
                "[CreateUser] El usuario '%s' (user_id=%s) no tiene correo "
                "personal registrado. Se omite el envío del welcome email.",
                email,
                created_user.id,
            )

        # ── 7. Construir respuesta ────────────────────────────────────────
        #    NOTA DE SEGURIDAD: `password` NO se incluye en la respuesta.
        #    El admin no necesita verla — el usuario la recibe por email.
        created_user.products = [
            {
                **p.__dict__,
                "zones": [
                    {
                        "cod_dep": z.cod_dep,
                        "cod_mun": z.cod_mun,
                        "enable":  z.enable,
                    }
                    for z in p.zones
                ],
            }
            for p in created_user.products
        ]

        result = (
            created_user.__dict__.copy()
            if hasattr(created_user, "__dict__")
            else dict(created_user)
        )

        # Limpiar datos sensibles de la respuesta (HAL-18 + C-04)
        result.pop("password", None)

        # Eco de zonas declaradas para que el frontend no requiera re-fetch
        result["zones"] = zones if zones is not None else []

        return result
