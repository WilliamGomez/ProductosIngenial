# Feature Design — Filtros Geográficos Dinámicos para Power BI Embedded

> **⚠️ CORRECCIONES POST-BASELINE (2026-05-15)**
> Este documento es el diseño arquitectónico. La implementación real difiere en:
>
> **C1 · No existe `GeoPermissions` ni `Zones` como tablas separadas.**
> El esquema implementado usa `dbo.User_Zones` vinculada a `dbo.User_Products` (no a `dbo.Users`).
> No existe tabla `GeoPermissions`. Los permisos geográficos son las propias `User_Zones`.
>
> **C2 · `User_Zones` real:** `(id, user_product_id FK, cod_dep 2-dig, cod_mun 3-dig, enable)`.
> No tiene `scope_level`, `cod_zona` ni `user_id` directo.
>
> **C3 · Formato `customData` implementado:** `"DD:MMM:|DD:MMM:"` (2 dígitos depto, 3 dígitos mun).
> El rol DAX `GeoScope` debe parsear `CUSTOMDATA()` con este formato.
> El filtro DAX compara con `cod_dep` (2 chars) y `cod_mun` (3 chars) en las tablas maestras.
>
> **C4 · Kill switch activo (HAL-11 CRÍTICO):** `POWER_BI_DISABLE_RLS=1` en `.env`.
> Cambiar a `0` antes de producción.
>
> **C5 · La sección §1.1 (tablas `Zones` y `GeoPermissions`) NO está implementada.**
> Implementado: solo `cod_dep` + `cod_mun` por contrato. La granularidad de zona/puesto es trabajo futuro.

> **Objetivo:** Permitir a un administrador configurar, por usuario, el subconjunto de **Departamentos · Municipios · Zonas** visible en los reportes Power BI, y garantizar que esos filtros se apliquen como **Row-Level Security (RLS)** en el `EmbedToken` emitido por el backend.
>
> **Problemas que resuelve:**
>
> - **A-08** (Alto): Bypass de autorización en `GET /power-bi/{reportId}` — un reporte sin entrada en `REPORT_TO_PRODUCT_MAP` queda sin control de acceso.
> - **C-05** (Crítico): `GET /power-bi` devuelve embed tokens sin autenticación. El nuevo flujo obliga a que el backend inyecte identidades RLS **por usuario autenticado**, lo que es imposible sin JWT.
> - Filtros hoy aplicados exclusivamente en el cliente (`src/utils/GetFilters.ts`) — **inseguro**: un usuario puede alterarlos en el navegador. La solución los mueve al servidor Power BI vía RLS.
>
> **Capas tocadas:** SQL (esquema + SPs) · `domain/` · `app/sql/` · `app/power_bi/` · `use_cases/` · `app/functions/http_functions/` · frontend (`SessionContext`, `GetFilters.ts`, `Votometro.tsx`).

---

## 0. Diagrama end-to-end del flujo

```
┌────────────┐      JWT      ┌─────────────────────┐
│ Frontend   │──────────────▶│ GET /api/power-bi/  │
│ (Votometro)│  Bearer <tok> │   {reportId}        │
└────────────┘               └─────────┬───────────┘
       ▲                               │ decode_token → user_id
       │                               ▼
       │                  ┌────────────────────────────┐
       │                  │ UserSqlAdapter             │
       │                  │  .get_user(user_id)        │
       │                  │  .get_geo_permissions(     │
       │                  │       user_id, product)    │  ← NUEVO
       │                  └────────────┬───────────────┘
       │                               ▼
       │                  ┌────────────────────────────┐
       │                  │ PowerBIUseCase             │
       │                  │  .get_report_for_user(     │
       │                  │       user, report_id)     │  ← NUEVO
       │                  │   └─ build RLS identity    │
       │                  │   └─ GenerateToken(        │
       │                  │        identities=[…])     │
       │                  └────────────┬───────────────┘
       │                               ▼
       │                  ┌────────────────────────────┐
       │                  │ PowerBIAdapter             │
       │                  │  .get_embed_params_for_    │
       │                  │   single_report_with_rls() │  ← NUEVO
       │                  └────────────┬───────────────┘
       │  IEmbedConfig + scopedFilters │
       └───────────────────────────────┘
```

Nota importante: RLS requiere un **rol definido en el modelo semántico** (.pbix) — los filtros del cliente (API `filters: []`) siguen siendo útiles para **UX** (prefijar la vista, evitar selectores vacíos) pero **no son el mecanismo de seguridad**.

---

## 1. DB · Extensión del modelo SQL (User → GeoPermissions)

### 1.1. Nuevas tablas

```sql
-- Catálogo: Zonas (nivel más fino que municipio — puestos de votación, veredas, etc.)
CREATE TABLE Zones (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    code          NVARCHAR(32)  NOT NULL,
    name          NVARCHAR(128) NOT NULL,
    municipality  NVARCHAR(32)  NOT NULL,           -- FK lógica a Municipalities.code
    department    NVARCHAR(32)  NOT NULL,           -- denormalizado para filtros rápidos
    CONSTRAINT UQ_Zones_code_mun UNIQUE (code, municipality)
);
CREATE INDEX IX_Zones_mun ON Zones(municipality);

-- Permisos geográficos por usuario × producto × nivel.
-- Un usuario SIN filas aquí para un producto = acceso completo a ese producto.
CREATE TABLE GeoPermissions (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    user_id       NVARCHAR(64)  NOT NULL,           -- Azure AD oid
    product_name  NVARCHAR(64)  NOT NULL,           -- "Votometro" | "Audivoto" | …
    scope_level   NVARCHAR(16)  NOT NULL,           -- 'department' | 'municipality' | 'zone'
    scope_code    NVARCHAR(32)  NOT NULL,           -- FK lógica al catálogo correspondiente
    enable        BIT           NOT NULL DEFAULT 1,
    created_at    DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_GeoPerm_level CHECK (scope_level IN ('department','municipality','zone')),
    CONSTRAINT UQ_GeoPerm UNIQUE (user_id, product_name, scope_level, scope_code)
);
CREATE INDEX IX_GeoPerm_user_prod ON GeoPermissions(user_id, product_name) WHERE enable = 1;
```

**Decisiones de diseño:**

- **Una fila = un (nivel, código)**. Un usuario con 3 departamentos = 3 filas. Esto permite mezclar niveles: un auditor puede tener 1 departamento completo + 2 municipios de otro departamento.
- **`scope_code` no es FK dura** — respeta el patrón actual (los catálogos `Departments/Municipalities/Zones` pueden regenerarse desde Power BI sin romper integridad referencial). Validación por SP.
- **Ausencia de filas = sin restricción** para ese producto. Evita bloquear administradores sin tocar nada.

### 1.2. Stored procedures

```sql
CREATE OR ALTER PROCEDURE GetGeoPermissions
    @user_id      NVARCHAR(64),
    @product_name NVARCHAR(64)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT scope_level, scope_code
      FROM GeoPermissions
     WHERE user_id = @user_id
       AND product_name = @product_name
       AND enable = 1;
END;
GO

CREATE OR ALTER PROCEDURE UpsertGeoPermissions
    @user_id      NVARCHAR(64),
    @product_name NVARCHAR(64),
    @permissions  NVARCHAR(MAX)            -- JSON: [{"level":"department","code":"05"}, …]
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRAN;

    -- Soft delete de permisos previos
    UPDATE GeoPermissions
       SET enable = 0
     WHERE user_id = @user_id AND product_name = @product_name;

    -- Insert / re-enable
    MERGE GeoPermissions AS tgt
    USING (
        SELECT  JSON_VALUE(value, '$.level') AS scope_level,
                JSON_VALUE(value, '$.code')  AS scope_code
          FROM OPENJSON(@permissions)
    ) AS src
       ON  tgt.user_id      = @user_id
       AND tgt.product_name = @product_name
       AND tgt.scope_level  = src.scope_level
       AND tgt.scope_code   = src.scope_code
    WHEN MATCHED THEN UPDATE SET enable = 1
    WHEN NOT MATCHED THEN
        INSERT (user_id, product_name, scope_level, scope_code, enable)
        VALUES (@user_id, @product_name, src.scope_level, src.scope_code, 1);

    COMMIT;
END;
GO
```

> Nota anti-`M-04`: el SP usa `OPENJSON` + `MERGE`, no construye SQL dinámico. Cualquier adaptador que lo consuma debe pasar `@permissions` como parámetro `?`, no interpolarlo.

### 1.3. Migración Power BI / RLS

En el modelo semántico (`.pbix`) se define **un rol `GeoScopeRole`** con filtros DAX sobre la tabla de hechos electoral:

```
[nom_dep]      IN VALUES('UserDepartments'[code])
|| [nom_mun]   IN VALUES('UserMunicipalities'[code])
|| [id_zona]   IN VALUES('UserZones'[code])
```

Las tres tablas (`UserDepartments`, `UserMunicipalities`, `UserZones`) se alimentan desde el `EffectiveIdentity` del embed token (ver §2.3). Un usuario con identidades vacías no ve datos.

---

## 2. Backend · RLS en `PowerBIUseCase`

### 2.1. Capa Domain (contratos nuevos)

`domain/models/geo_permissions.py`:

```python
from dataclasses import dataclass
from typing import List, Literal

ScopeLevel = Literal["department", "municipality", "zone"]

@dataclass(frozen=True)
class GeoScope:
    level: ScopeLevel
    code: str

@dataclass
class GeoPermissions:
    user_id: str
    product: str
    scopes: List[GeoScope]

    @property
    def department_codes(self) -> List[str]:
        return [s.code for s in self.scopes if s.level == "department"]

    @property
    def municipality_codes(self) -> List[str]:
        return [s.code for s in self.scopes if s.level == "municipality"]

    @property
    def zone_codes(self) -> List[str]:
        return [s.code for s in self.scopes if s.level == "zone"]

    @property
    def is_unrestricted(self) -> bool:
        return len(self.scopes) == 0
```

`domain/repositories/geo_permissions_repository.py`:

```python
from abc import ABC, abstractmethod
from domain.models.geo_permissions import GeoPermissions

class IGeoPermissionsRepository(ABC):
    @abstractmethod
    def get_geo_permissions(self, user_id: str, product: str) -> GeoPermissions: ...

    @abstractmethod
    def upsert_geo_permissions(self, perms: GeoPermissions) -> None: ...
```

Ampliar `IPowerBIRepository` con:

```python
@abstractmethod
def get_embed_params_for_single_report_with_rls(
    self, workspace_id: str, report_id: str, identities: list[dict]
) -> dict: ...
```

### 2.2. Capa App · `UserSqlAdapter` (o nuevo `GeoPermissionsSqlAdapter`)

Implementa la interfaz llamando a los SPs. Para minimizar impacto usamos el adaptador existente de usuarios — es `pyodbc` + SP igual que el resto:

```python
# app/sql/user_sql_adapter.py  (extracto — solo métodos nuevos)

def get_geo_permissions(self, user_id: str, product: str) -> GeoPermissions:
    with self.connection.cursor() as cur:         # A-05: context manager
        cur.execute("EXEC GetGeoPermissions ?, ?", (user_id, product))
        rows = cur.fetchall()
    return GeoPermissions(
        user_id=user_id,
        product=product,
        scopes=[GeoScope(level=r[0], code=r[1]) for r in rows],
    )

def upsert_geo_permissions(self, perms: GeoPermissions) -> None:
    payload = json.dumps([{"level": s.level, "code": s.code} for s in perms.scopes])
    with self.connection.cursor() as cur:
        cur.execute("EXEC UpsertGeoPermissions ?, ?, ?",
                    (perms.user_id, perms.product, payload))
    self.connection.commit()
```

> **Regla:** estos métodos nacen con `with ... cursor` para no arrastrar `A-05`. Se recomienda propagar el patrón al resto del adaptador en un PR de hardening.

### 2.3. Capa App · `PowerBIAdapter` — RLS en `GenerateToken`

Se añade un método nuevo que construye el cuerpo con `effectiveIdentity`:

```python
# app/power_bi/power_bi_adapter.py  (método nuevo)

def get_embed_params_for_single_report_with_rls(
    self,
    workspace_id: str,
    report_id: str,
    identities: list[dict],             # ver formato en §2.4
) -> dict:
    # 1. Obtener metadata del reporte
    report_url = f"{POWER_BI_URL}/myorg/groups/{workspace_id}/reports/{report_id}"
    meta = requests.get(report_url, headers=self._headers())
    if meta.status_code != 200:
        raise PermissionError(f"Report {report_id} not accessible")
    meta = meta.json()
    dataset_id = meta["datasetId"]

    # 2. Generar embed token CON identidades (RLS server-side)
    body = {
        "datasets": [{"id": dataset_id}],
        "reports":  [{"id": report_id}],
        "targetWorkspaces": [{"id": workspace_id}],
        "identities": identities,
    }
    resp = requests.post(
        f"{POWER_BI_URL}/myorg/GenerateToken",
        json=body,
        headers=self._headers(),
    )
    if resp.status_code != 200:
        raise RuntimeError("Embed token generation failed")

    data = resp.json()
    return {
        "reportId":    meta["id"],
        "reportName":  meta["name"],
        "embedUrl":    meta["embedUrl"],
        "accessToken": data["token"],
        "tokenId":     data["tokenId"],
        "tokenExpiry": data["expiration"],
    }
```

### 2.4. Capa Use Case · `PowerBIUseCase.get_report_for_user`

El caso de uso es el único autorizado a decidir **qué identidad RLS** se envía a Power BI. Se construye a partir de los permisos del usuario:

```python
# use_cases/power_bi_data.py

from domain.models.geo_permissions import GeoPermissions
from domain.repositories.geo_permissions_repository import IGeoPermissionsRepository
from domain.repositories.power_bi_repository import IPowerBIRepository
from domain.exceptions import UserNotFoundException

# Mantener este mapa como única fuente de verdad reporte → producto
REPORT_TO_PRODUCT_MAP = {
    "9db4c8ee-d117-4a2e-9a72-9284c6208fa0": "Votometro",
    "f88c2708-aa49-449a-974a-8e7f7ee972fb": "Audivoto",
}

class PowerBIUseCase:
    def __init__(
        self,
        power_bi_repository: IPowerBIRepository,
        geo_repository: IGeoPermissionsRepository,
    ):
        self.power_bi_repository = power_bi_repository
        self.geo_repository = geo_repository

    def get_report_for_user(self, user: dict, report_id: str) -> dict:
        # Fix A-08: bloquear reportes no mapeados por defecto.
        product = REPORT_TO_PRODUCT_MAP.get(report_id)
        if product is None:
            raise PermissionError(
                f"Report {report_id} is not registered for authorization."
            )

        if user["role"] != "Admin":
            enabled = {p["name"] for p in user.get("products", []) if p.get("enable")}
            if product not in enabled:
                raise PermissionError("Access denied: product not enabled.")

        # RLS — Admin sin restricciones; usuarios con scopes limitados.
        if user["role"] == "Admin":
            identity = self._build_identity(user["id"], report_id, perms=None)
        else:
            perms = self.geo_repository.get_geo_permissions(user["id"], product)
            identity = self._build_identity(user["id"], report_id, perms=perms)

        return self.power_bi_repository.get_embed_params_for_single_report_with_rls(
            workspace_id=self.power_bi_repository.group,
            report_id=report_id,
            identities=[identity],
        )

    @staticmethod
    def _build_identity(user_id: str, report_id: str, perms: GeoPermissions | None):
        roles = ["GeoScopeRole"]
        if perms is None or perms.is_unrestricted:
            # Sin filtros → dataset abierto bajo el rol (ver RLS DAX en §1.3).
            return {
                "username": user_id,
                "roles": roles,
                "datasets": [],          # se completa en el adaptador
                "reports":  [report_id],
            }
        return {
            "username": user_id,
            "roles": roles,
            "reports": [report_id],
            "customData": None,
            "identityBlob": None,
            "datasets": [],
            # Power BI lee estos arrays vía bind tables del modelo semántico:
            "claims": {
                "UserDepartments":    perms.department_codes,
                "UserMunicipalities": perms.municipality_codes,
                "UserZones":          perms.zone_codes,
            },
        }
```

> **Notas sobre la API de Power BI:**
>
> - El objeto `identity` sigue el esquema `EffectiveIdentity`. Si el modelo usa tablas bind (`UserDepartments`, etc.), deben declararse en el `.pbix` y poblarse desde el backend con filas vacías cuando el usuario no tenga scopes (para forzar resultados nulos en el rol RLS).
> - `username` = `oid` de Azure AD — asegura trazabilidad en los logs de Power BI.

### 2.5. Capa HTTP · Fix de C-05 y A-08

Reemplazar `power_bi_functions.py`. El handler nuevo exige Bearer, resuelve el usuario y delega al use case. **`GET /api/power-bi` (plural) queda retirado**: exponer tokens de todos los reportes es incompatible con RLS por usuario.

```python
# app/functions/http_functions/power_bi_functions.py

import azure.functions as func
import json, logging
from http import HTTPStatus
from shared.utils import MIMETYPE, decode_token
from app.power_bi.power_bi_adapter import PowerBIAdapter
from app.sql.user_sql_adapter import UserSqlAdapter
from use_cases.power_bi_data import PowerBIUseCase

power_bi_bp = func.Blueprint()


def _require_user(req: func.HttpRequest) -> dict:
    auth = req.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise ValueError("Missing bearer token")
    claims = decode_token(auth[len("Bearer "):])
    user_id = claims.get("oid")
    if not user_id:
        raise ValueError("Token has no oid claim")
    user = UserSqlAdapter().get_user(user_id)
    if not user:
        raise PermissionError("User not registered")
    return user


@power_bi_bp.function_name(name="GetPowerBIReportById")
@power_bi_bp.route(route="power-bi/{reportId}", methods=["GET"],
                   auth_level=func.AuthLevel.FUNCTION)       # C-03 hardening
def get_power_bi_report(req: func.HttpRequest) -> func.HttpResponse:
    try:
        report_id = req.route_params["reportId"]
        user = _require_user(req)                             # ← Fix C-05

        use_case = PowerBIUseCase(
            power_bi_repository=PowerBIAdapter(),
            geo_repository=UserSqlAdapter(),                  # implementa IGeoPermissionsRepository
        )
        data = use_case.get_report_for_user(user, report_id)   # ← A-08 cerrado
        return func.HttpResponse(json.dumps(data),
                                 status_code=HTTPStatus.OK,
                                 mimetype=MIMETYPE)

    except ValueError as verror:
        return func.HttpResponse(json.dumps({"error": str(verror)}),
                                 status_code=HTTPStatus.UNAUTHORIZED,
                                 mimetype=MIMETYPE)
    except PermissionError as perror:
        return func.HttpResponse(json.dumps({"error": str(perror)}),
                                 status_code=HTTPStatus.FORBIDDEN,
                                 mimetype=MIMETYPE)
    except Exception as error:
        logging.error(f"GetPowerBIReportById: {error}")
        return func.HttpResponse(json.dumps({"error": "Internal error"}),
                                 status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
                                 mimetype=MIMETYPE)


# Opcional: endpoint administrativo para gestionar GeoPermissions
@power_bi_bp.function_name(name="UpsertGeoPermissions")
@power_bi_bp.route(route="geo-permissions/{user_id}/{product}",
                   methods=["PUT"],
                   auth_level=func.AuthLevel.FUNCTION)
def upsert_geo_permissions(req: func.HttpRequest) -> func.HttpResponse:
    try:
        actor = _require_user(req)
        if actor["role"] != "Admin":
            raise PermissionError("Admin role required")
        target_user = req.route_params["user_id"]
        product     = req.route_params["product"]
        scopes      = req.get_json().get("scopes", [])     # [{level, code}, …]
        UserSqlAdapter().upsert_geo_permissions(
            GeoPermissions(user_id=target_user, product=product,
                           scopes=[GeoScope(**s) for s in scopes]))
        return func.HttpResponse(status_code=HTTPStatus.NO_CONTENT)
    except PermissionError as e:
        return func.HttpResponse(json.dumps({"error": str(e)}),
                                 status_code=HTTPStatus.FORBIDDEN,
                                 mimetype=MIMETYPE)
    except ValueError as e:
        return func.HttpResponse(json.dumps({"error": str(e)}),
                                 status_code=HTTPStatus.UNAUTHORIZED,
                                 mimetype=MIMETYPE)
```

**Cambios de error semántico (cierran A-10 para este endpoint):**

- `401 Unauthorized` → token inválido / ausente.
- `403 Forbidden` → token OK pero producto no habilitado / reporte no mapeado.
- `500 Internal Server Error` → nunca expone `str(error)` del upstream.

---

## 3. Frontend · Inyección de filtros desde `SessionContext`

### 3.1. Nueva superficie de `SessionContext`

`src/interfaces/IGeoPermissions.ts`:

```ts
export interface IGeoScope {
  level: "department" | "municipality" | "zone";
  code: string;
}

export interface IGeoPermissions {
  product: string;
  departments: string[];
  municipalities: string[];
  zones: string[];
  isUnrestricted: boolean;
}
```

Extender `IUser`:

```ts
// src/interfaces/IUser.ts
export interface IUser {
  // …campos existentes
  geo_permissions?: Record<string, IGeoPermissions>;   // clave: product_name
}
```

El backend incluye estos permisos en el payload de `GET /user/:id`. Un hook de ayuda los expone desde el contexto:

```ts
// src/hooks/useGeoPermissions.ts
import { useMemo } from "react";
import { useSession } from "../context/SessionContext";
import type { IGeoPermissions } from "../interfaces/IGeoPermissions";

export function useGeoPermissions(product: string): IGeoPermissions {
  const { user } = useSession();
  return useMemo(() => {
    const p = user?.geo_permissions?.[product];
    return p ?? {
      product,
      departments: [],
      municipalities: [],
      zones: [],
      isUnrestricted: true,
    };
  }, [user, product]);
}
```

### 3.2. Reescritura de `GetFilters.ts` (solo capa UX)

Los filtros del cliente ya **no son el control de seguridad**; ahora solo mejoran la experiencia prefijando la vista. El control real es el `EmbedToken` emitido por el backend (§2.4).

```ts
// src/utils/GetFilters.ts
import { models } from "powerbi-client";
import type { IGeoPermissions } from "../interfaces/IGeoPermissions";
import type { AppRole } from "../hooks/useAuth";

const TABLE = "public data_votacion";

export const getFilters = (
  perms: IGeoPermissions,
  role: AppRole,
): models.IBasicFilter[] => {
  if (role === "Admin" || perms.isUnrestricted) return [];

  const filters: models.IBasicFilter[] = [];
  if (perms.departments.length > 0) {
    filters.push({
      $schema: "http://powerbi.com/product/schema#basic",
      target: { table: TABLE, column: "cod_dep" },
      operator: "In",
      filterType: models.FilterType.Basic,
      values: perms.departments,
    });
  }
  if (perms.municipalities.length > 0) {
    filters.push({
      $schema: "http://powerbi.com/product/schema#basic",
      target: { table: TABLE, column: "cod_mun" },
      operator: "In",
      filterType: models.FilterType.Basic,
      values: perms.municipalities,
    });
  }
  if (perms.zones.length > 0) {
    filters.push({
      $schema: "http://powerbi.com/product/schema#basic",
      target: { table: TABLE, column: "id_zona" },
      operator: "In",
      filterType: models.FilterType.Basic,
      values: perms.zones,
    });
  }
  return filters;
};
```

### 3.3. Uso en `pages/Votometro.tsx`

```tsx
import { useGeoPermissions } from "../hooks/useGeoPermissions";
import { getFilters } from "../utils/GetFilters";
import { useAuth } from "../hooks/useAuth";
// …
const PRODUCT_NAME = "Votometro";
const { userRole } = useAuth();
const perms = useGeoPermissions(PRODUCT_NAME);

// en <PowerBIEmbed embedConfig={{ …, filters: getFilters(perms, userRole) }} />
```

`Audivoto.tsx` es idéntico con `PRODUCT_NAME = "Audivoto"`.

### 3.4. Defensa en profundidad

- El RLS del §2.4 es el **único** control que garantiza que el usuario no puede ver datos fuera de su scope (aunque altere el DOM).
- Los filtros del cliente se re-evalúan tras cada `refreshEmbedConfig` (ya se dispara en `Votometro.tsx` cuando el token está a ≤5 min de expirar), por lo que un cambio de permisos en backend se refleja como máximo tras el siguiente ciclo.

---

## 4. Auth Fix · `GET /power-bi` con validación JWT (Fix C-05)

Resumen operativo del fix aplicado en §2.5 (criterio de cierre del hallazgo):

| Pre-fix                                        | Post-fix                                                   |
|------------------------------------------------|------------------------------------------------------------|
| `auth_level=ANONYMOUS`                         | `auth_level=FUNCTION` (requiere function key + JWT)        |
| Sin `Authorization` header                     | Bearer obligatorio → `401` si falta                        |
| Sin validación de `oid`                        | `_require_user(req)` extrae `oid` y carga el usuario       |
| Sin chequeo de producto                        | `PowerBIUseCase` verifica `REPORT_TO_PRODUCT_MAP` (cierra A-08) |
| Embed token sin identidad                      | `EffectiveIdentity` con scopes geográficos del usuario     |
| `GET /api/power-bi` devolvía **todos** los reportes | Ese endpoint **se elimina**; solo queda `/{reportId}` con auth |

### Criterios de aceptación (QA)

1. `curl` a `GET /api/power-bi/{reportId}` sin `Authorization` → **401**.
2. Con Bearer válido pero producto deshabilitado → **403**.
3. Con Bearer válido y producto habilitado, sin filas en `GeoPermissions` → `EmbedToken` válido, reporte sin restricciones (RLS abierto).
4. Con Bearer válido, producto habilitado y scopes = `[{dept:"05"}]` → el reporte muestra exclusivamente filas con `cod_dep = "05"`, independientemente del payload `filters` enviado por el cliente.
5. `reportId` no mapeado en `REPORT_TO_PRODUCT_MAP` → **403** (cierra A-08).
6. Rotar rol del usuario a `Admin` en SQL → siguiente refresh (≤ 55 min) ya le entrega un token sin identidad restringida.

### Reversibilidad

Si se necesita desactivar temporalmente el RLS (por ejemplo durante un hotfix del modelo semántico), el fallback seguro es:

- Mantener `auth_level=FUNCTION` y la validación JWT (no tocar C-05).
- En `PowerBIUseCase.get_report_for_user`, saltarse la construcción de `identity` y llamar al método clásico `get_embed_params_for_single_report`.
- Registrar un warning estructurado `rls.disabled=true` en Application Insights para alertar al equipo de DevSecOps.

---

## 5. Plan de rollout

1. **DB** · Crear tablas y SPs en un PR independiente; backfill del seed de `Zones`.
2. **Backend · dominio + adaptadores** · PR con `GeoPermissions`, `IGeoPermissionsRepository`, extensión de `IPowerBIRepository`, métodos SQL y método `...with_rls`.
3. **Backend · use case + endpoint** · PR que introduce `get_report_for_user`, el nuevo handler `GET /api/power-bi/{reportId}` con JWT y retira `GET /api/power-bi`. Cierra **C-05** y **A-08**.
4. **Power BI (.pbix)** · Definir `GeoScopeRole` y bind tables; publicar al workspace.
5. **Frontend** · Extender `IUser`, añadir `useGeoPermissions`, reescribir `GetFilters.ts`, actualizar `Votometro.tsx` y `Audivoto.tsx`. Remover el TODO `// TODO: Re-enable filters after temporary period`.
6. **QA** · Ejecutar los 6 criterios de aceptación (§4). Actualizar `DIAGNOSTIC_REPORT.md` marcando C-05/A-08 como ✅ Cerrado.
7. **Memoria** · Actualizar `ROOT_MEMORY.md`, `BACKEND_MEM.md`, `FRONTEND_MEM.md` con el nuevo flujo y tablas de endpoints.

---

## 6. Referencias

- `DIAGNOSTIC_REPORT.md` — hallazgos **C-05** (pp. sección CAPA 3 & 5) y **A-08**.
- `ROOT_MEMORY.md` — Reglas 3 y 4.
- `BACKEND_MEM.md` — tabla de endpoints y zona de riesgo *C-05*.
- `FRONTEND_MEM.md` — sección *Rutas y Control de Acceso* y zonas *A-11 / A-12*.
- Microsoft Docs · [Row-level security (RLS) with Power BI Embedded](https://learn.microsoft.com/power-bi/developer/embedded/embedded-row-level-security).
- Microsoft Docs · [GenerateToken — EffectiveIdentity](https://learn.microsoft.com/rest/api/power-bi/embed-token/generate-token).
