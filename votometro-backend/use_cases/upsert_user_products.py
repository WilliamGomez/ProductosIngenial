"""
Use case para UPSERT de productos de usuario CON zonas geográficas.

Cambios 2026-05-10:
  · Recibe productos con array de UserZone (NO CSV strings)
  · Usa UserProductsSqlAdapter.upsert_user_products_with_zones()
  · Valida consistencia de zonas antes de persistir
"""
from typing import Dict, List, Optional
import logging
from datetime import datetime
from pytz import timezone

from domain.models.product import Product, UserZone
from app.sql.user_products_sql_adapter import UserProductsSqlAdapter
from shared.utils import calculate_expiration


logger = logging.getLogger(__name__)


class UpdateUserProductsUseCase:
    """Use case para actualizar productos de un usuario."""

    def __init__(self, sql_adapter: UserProductsSqlAdapter):
        self.sql_adapter = sql_adapter

    def execute(self, user_id: str, products_data: List[Dict]) -> None:
        """
        Procesa el upsert de productos para un usuario.

        Args:
            user_id: UUID del usuario
            products_data: Lista de diccionarios con estructura:
                [
                  {
                    "id": null,  (opcional)
                    "name": "Votometro",
                    "contract_duration": 1,
                    "duration_unit": "years",
                    "enable": true,
                    "amount_cop": 150000,
                    "zones": [
                      {"cod_dep": "05", "cod_mun": null},
                      {"cod_dep": "81", "cod_mun": "001"}
                    ]
                  }
                ]

        Raises:
            ValueError: Si hay errores de validación
            RuntimeError: Si hay error en la persistencia
        """
        products = []

        # Procesar cada producto en el payload
        for product_dict in products_data:
            # Validar campos requeridos
            if not product_dict.get("name"):
                raise ValueError("El campo 'name' es requerido en cada producto")

            if "contract_duration" not in product_dict:
                raise ValueError(
                    "El campo 'contract_duration' es requerido en cada producto"
                )

            if not product_dict.get("duration_unit"):
                raise ValueError("El campo 'duration_unit' es requerido en cada producto")

            # Parsear zonas
            zones = []
            if "zones" in product_dict:
                zones_data = product_dict.get("zones", [])
                if not isinstance(zones_data, list):
                    raise ValueError(
                        f"Producto '{product_dict['name']}': 'zones' debe ser un array"
                    )

                for zone_dict in zones_data:
                    try:
                        zone = UserZone(
                            cod_dep=zone_dict.get("cod_dep"),
                            cod_mun=zone_dict.get("cod_mun"),
                            enable=zone_dict.get("enable", True),
                        )
                        zones.append(zone)
                    except (KeyError, TypeError) as e:
                        raise ValueError(
                            f"Producto '{product_dict['name']}': error al parsear zona: {str(e)}"
                        ) from e

            # Crear objeto Product
            product = Product(
                id=product_dict.get("id"),
                name=product_dict["name"],
                contract_duration=int(product_dict["contract_duration"]),
                duration_unit=product_dict["duration_unit"],
                expiration=product_dict.get("expiration")
                or calculate_expiration(product_dict, datetime.now(timezone("America/Bogota"))),
                enable=product_dict.get("enable", True),
                amount_cop=float(product_dict.get("amount_cop", 0)),
                zones=zones,
            )

            products.append(product)
            logger.info(
                f"Producto procesado: {product.name} - {len(product.zones)} zonas"
            )

        # Persistir usando el adaptador SQL
        logger.info(f"Guardando {len(products)} productos para usuario {user_id}")
        self.sql_adapter.upsert_user_products_with_zones(user_id, products)
        logger.info("Productos guardados exitosamente")
