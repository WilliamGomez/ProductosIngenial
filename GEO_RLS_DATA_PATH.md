# Ruta de Datos para Aislamiento Geográfico — Power BI Embedded (RLS)

> **⚠️ CORRECCIONES POST-BASELINE (2026-05-15)**
> El código implementado difiere del diseño original en estos puntos clave:
>
> **C1 · Esquema real de `User_Zones` (post Hard Reset 3NF `11_hard_reset_schema.sql`):**
> La tabla NO tiene `user_id`, `scope_level` ni `cod_zona`. El esquema real es:
> ```sql
> dbo.User_Zones (
>     id              INT IDENTITY PK,
>     user_product_id INT FK → dbo.User_Products.id  ON DELETE CASCADE,
>     cod_dep         NVARCHAR(10),   -- SIEMPRE 2 dígitos → zfill(2)
>     cod_mun         NVARCHAR(10),   -- SIEMPRE 3 dígitos → zfill(3) — NULL = depto completo
>     enable          BIT DEFAULT 1,
>     created_at      DATETIME2
> )
> ```
> Las zonas se recuperan siempre via JOIN con `User_Products`. Ver `user_zones_sql_adapter.py`.
>
> **C2 · Formato `customData` (implementado en `power_bi_data.py → _build_identity()`):**
> ```
> "DD:MMM:|DD:MMM:|DD::"
>  └─ cod_dep 2 dígitos (zfill)  └─ cod_mun 3 dígitos (zfill), vacío si depto completo
> ```
> Ejemplo: `"05:001:|81::"` = Medellín + todo Arauca. Separador pipe `|`.
>
> **C3 · Kill switch activo (HAL-11 CRÍTICO):** `POWER_BI_DISABLE_RLS=1` en `.env` desactiva RLS globalmente.
> Establecer en `0` antes de producción.
>
> **C4 · Granularidad implementada:** Solo departamento (`cod_dep`) y municipio (`cod_mun`).
> La granularidad de zona/puesto (`cod_zona`) está diseñada pero NO implementada en el código actual.

> **Objetivo:** restringir los datos visibles en los dashboards a las zonas (departamento · municipio · puesto) asignadas a cada usuario, con el control aplicado **en el servidor de Power BI**, no en el cliente.
>
> **Principio:** el frontend no decide qué ve. El backend firma el `EmbedToken` con una **EffectiveIdentity** (o `CustomData`) que el **modelo semántico** traduce en filtros DAX sobre las tablas maestras.
>
> **Ámbito:** cierra A-08 (bypass de autorización por reporte no mapeado) y habilita el fix de **C-05** (`GET /power-bi` sin autenticación).

---

## 0. Diagrama de la ruta de datos

```
┌──────────────┐  JWT Bearer  ┌──────────────────────────────┐
│  Frontend    │─────────────▶│  GET /api/power-bi/{reportId}│
│  (React)     │              │  AuthLevel = FUNCTION        │ ← Fix C-05
└──────┬───────┘              └──────────────┬───────────────┘
       │                                     │  decode_token → oid
       │                                     ▼
       │                    ┌────────────────────────────────┐
       │                    │ UserSqlAdapter                 │
       │                    │   .list_user_zones(user_id)    │  ← lee User_Zones
       │                    └──────────────┬─────────────────┘
       │                                   ▼
       │                    ┌────────────────────────────────┐
       │                    │ PowerBIUseCase                 │
       │                    │   .execute_for_user(user,      │
       │                    │     report_id)                 │
       │                    │   └─ arma EffectiveIdentity    │
       │                    │   └─ (opcional) customData     │
       │                    └──────────────┬─────────────────┘
       │                                   ▼
       │                    ┌────────────────────────────────┐
       │                    │ Power BI REST                  │
       │                    │   POST /GenerateToken          │
       │                    │   body.identities = [ … ]      │
       │                    └──────────────┬─────────────────┘
       │  IEmbedConfig                     │
       │◀──────────────────────────────────┘
       ▼
┌─────────────────┐        DAX role: GeoScope
│  PowerBIEmbed   │   [cod_dep] IN VALUES(User_Zones[cod_dep])
│  renderiza .pbix│── ↳ filtra tablas maestras data_votacion,
└─────────────────┘        data_puestos, data_zonas
```

---

## 1. SQL — Esquema de la tabla intermedia `User_Zones`

**Granularidad:** una fila por (usuario, zona). Un usuario con 3 departamentos + 2 municipios = 5 filas. Esto permite mezclar niveles sin inflar columnas nulas.

```sql
-- 1.1. Catálogo adicional: puestos de votación / zonas finas
CREATE TABLE Zones (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    cod_zona     NVARCHAR(32)  NOT NULL,
    cod_mun      NVARCHAR(32)  NOT NULL,     -- FK lógica a Municipalities.code
    cod_dep      NVARCHAR(32)  NOT NULL,     -- denormalizado
    name         NVARCHAR(128) NOT NULL,
    CONSTRAINT UQ_Zones UNIQUE (cod_zona, cod_mun)
);
CREATE INDEX IX_Zones_mun ON Zones(cod_mun);


-- 1.2. Tabla intermedia: asignación usuario ↔ zona
CREATE TABLE User_Zones (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    user_id      NVARCHAR(64)  NOT NULL,          -- Azure AD oid
    scope_level  NVARCHAR(16)  NOT NULL,          -- 'department' | 'municipality' | 'zone'
    cod_dep      NVARCHAR(32)  NULL,              -- obligatorio si scope_level = 'department'
    cod_mun      NVARCHAR(32)  NULL,              -- obligatorio si scope_level = 'municipality'
    cod_zona     NVARCHAR(32)  NULL,              -- obligatorio si scope_level = 'zone'
    enable       BIT           NOT NULL DEFAULT 1,
    created_at   DATETIME2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT CK_UZ_level CHECK (scope_level IN ('department','municipality','zone')),
    CONSTRAINT CK_UZ_codes CHECK (
        (scope_level = 'department'   AND cod_dep  IS NOT NULL AND cod_mun  IS NULL AND cod_zona IS NULL) OR
        (scope_level = 'municipality' AND cod_mun  IS NOT NULL AND cod_zona IS NULL)                       OR
        (scope_level = 'zone'         AND cod_zona IS NOT NULL)
    )
);
CREATE INDEX IX_UZ_user_enabled ON User_Zones(user_id) WHERE enable = 1;
GO


-- 1.3. Stored procedure que resuelve zonas efectivas (expande jerarquía)
CREATE OR ALTER PROCEDURE GetUserZones
    @user_id NVARCHAR(64)
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH effective AS (
        -- Filas 'zone' tal cual
        SELECT uz.cod_dep, uz.cod_mun, uz.cod_zona
          FROM User_Zones uz
         WHERE uz.user_id = @user_id AND uz.enable = 1 AND uz.scope_level = 'zone'

        UNION

        -- Filas 'municipality' → expandir todas las zonas del municipio
        SELECT z.cod_dep, z.cod_mun, z.cod_zona
          FROM User_Zones uz
          JOIN Zones z ON z.cod_mun = uz.cod_mun
         WHERE uz.user_id = @user_id AND uz.enable = 1 AND uz.scope_level = 'municipality'

        UNION

        -- Filas 'department' → expandir todas las zonas del departamento
        SELECT z.cod_dep, z.cod_mun, z.cod_zona
          FROM User_Zones uz
          JOIN Zones z ON z.cod_dep = uz.cod_dep
         WHERE uz.user_id = @user_id AND uz.enable = 1 AND uz.scope_level = 'department'
    )
    SELECT cod_dep, cod_mun, cod_zona FROM effective;
END;
GO


-- 1.4. SP para asignación masiva (idempotente)
CREATE OR ALTER PROCEDURE UpsertUserZones
    @user_id      NVARCHAR(64),
    @assignments  NVARCHAR(MAX)      -- JSON: [{level,cod_dep?,cod_mun?,cod_zona?}, …]
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRAN;

    UPDATE User_Zones SET enable = 0 WHERE user_id = @user_id;

    INSERT INTO User_Zones (user_id, scope_level, cod_dep, cod_mun, cod_zona, enable)
    SELECT @user_id,
           JSON_VALUE(j.value, '$.level'),
           JSON_VALUE(j.value, '$.cod_dep'),
           JSON_VALUE(j.value, '$.cod_mun'),
           JSON_VALUE(j.value, '$.cod_zona'),
           1
      FROM OPENJSON(@assignments) AS j;

    COMMIT;
END;
GO
```

**Semántica clave:**

- **Ausencia de filas activas ≠ acceso total.** Un usuario sin filas en `User_Zones` se considera **sin acceso** en el modelo semántico (el `IN VALUES()` sobre un set vacío devuelve `FALSE`). Para administradores se usa un rol DAX diferente (`Admin`) o `customData = "admin"` — ver §3.
- **Soft delete** (`enable = 0`) conserva auditoría de cambios.

---

## 2. Backend (Python) — `PowerBIUseCase` con EffectiveIdentity + CustomData

Clean Architecture: el use case solo toca interfaces del dominio; todo lo específico de Power BI vive en el adaptador.

### 2.1. Nuevo modelo de dominio

```python
# domain/models/user_zone.py
from dataclasses import dataclass
from typing import Optional, List

@dataclass(frozen=True)
class UserZone:
    cod_dep:  Optional[str]
    cod_mun:  Optional[str]
    cod_zona: Optional[str]

@dataclass
class UserZoneSet:
    user_id: str
    zones:   List[UserZone]

    @property
    def is_empty(self) -> bool:
        return len(self.zones) == 0

    @property
    def departments(self) -> list[str]:
        return sorted({z.cod_dep for z in self.zones if z.cod_dep})

    @property
    def municipalities(self) -> list[str]:
        return sorted({z.cod_mun for z in self.zones if z.cod_mun})

    @property
    def zones_codes(self) -> list[str]:
        return sorted({z.cod_zona for z in self.zones if z.cod_zona})
```

### 2.2. Nueva interfaz de repositorio

```python
# domain/repositories/user_zones_repository.py
from abc import ABC, abstractmethod
from domain.models.user_zone import UserZoneSet

class IUserZonesRepository(ABC):
    @abstractmethod
    def list_user_zones(self, user_id: str) -> UserZoneSet: ...

    @abstractmethod
    def upsert_user_zones(self, user_id: str, assignments: list[dict]) -> None: ...
```

### 2.3. Adaptador SQL

```python
# app/sql/user_zones_sql_adapter.py
import os, json, pyodbc
from domain.models.user_zone import UserZone, UserZoneSet
from domain.repositories.user_zones_repository import IUserZonesRepository

class UserZonesSqlAdapter(IUserZonesRepository):
    def __init__(self):
        # A-05 hardening: usar context managers en la conexión.
        self._cnxn_str = os.getenv("SQL_CONNECTION_STRING")

    def list_user_zones(self, user_id: str) -> UserZoneSet:
        with pyodbc.connect(self._cnxn_str) as cnxn:
            with cnxn.cursor() as cur:
                cur.execute("EXEC GetUserZones ?", (user_id,))
                rows = cur.fetchall()
        zones = [UserZone(r[0], r[1], r[2]) for r in rows]
        return UserZoneSet(user_id=user_id, zones=zones)

    def upsert_user_zones(self, user_id: str, assignments: list[dict]) -> None:
        payload = json.dumps(assignments)
        with pyodbc.connect(self._cnxn_str) as cnxn:
            with cnxn.cursor() as cur:
                cur.execute("EXEC UpsertUserZones ?, ?", (user_id, payload))
            cnxn.commit()
```

### 2.4. Ampliación del `IPowerBIRepository` / adaptador

Se añade un método que acepta **`identities`** (EffectiveIdentity).

```python
# app/power_bi/power_bi_adapter.py  (método nuevo — no reemplaza los existentes)

def generate_embed_token_with_rls(
    self,
    workspace_id: str,
    report_id: str,
    identity: dict,                          # formato EffectiveIdentity
) -> dict:
    # 1. Metadata del reporte (para dataset_id + embedUrl)
    report_url = f"{POWER_BI_URL}/myorg/groups/{workspace_id}/reports/{report_id}"
    meta = requests.get(report_url, headers=self._headers())
    if meta.status_code != 200:
        raise PermissionError("Report not accessible")
    meta = meta.json()

    # 2. GenerateToken con identities (RLS server-side)
    body = {
        "datasets":         [{"id": meta["datasetId"]}],
        "reports":          [{"id": report_id}],
        "targetWorkspaces": [{"id": workspace_id}],
        "identities":       [identity],
    }
    resp = requests.post(
        f"{POWER_BI_URL}/myorg/GenerateToken",
        json=body,
        headers=self._headers(),
    )
    if resp.status_code != 200:
        raise RuntimeError(f"GenerateToken failed: {resp.status_code}")

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

### 2.5. `PowerBIUseCase` — ejecución por usuario

Dos vías soportadas — elegir **una** según el dataset:

- **Vía A · Bind tables** (recomendada): el `.pbix` contiene las tablas `User_Zones_RLS` y las filas se envían en `identities[].claims`. Escala mejor (pueden ser miles de zonas).
- **Vía B · `customData`**: una sola string CSV dentro del token. Útil cuando el set es pequeño (≤ 100 zonas) o si el modelo semántico ya usa `CUSTOMDATA()`.

```python
# use_cases/power_bi_data.py

from domain.repositories.power_bi_repository import IPowerBIRepository
from domain.repositories.user_zones_repository import IUserZonesRepository

# Mapa reporte → producto (fix A-08: reportes no listados se bloquean por defecto)
REPORT_TO_PRODUCT_MAP = {
    "9db4c8ee-d117-4a2e-9a72-9284c6208fa0": "Votometro",
    "f88c2708-aa49-449a-974a-8e7f7ee972fb": "Audivoto",
}


class PowerBIUseCase:
    def __init__(
        self,
        power_bi_repository: IPowerBIRepository,
        user_zones_repository: IUserZonesRepository,
    ):
        self.power_bi = power_bi_repository
        self.user_zones = user_zones_repository

    def execute_for_user(self, user: dict, report_id: str) -> dict:
        # A-08: rechazar reportes sin mapeo
        product = REPORT_TO_PRODUCT_MAP.get(report_id)
        if not product:
            raise PermissionError("Report not registered")

        # Autorización por producto habilitado (o rol Admin)
        if user["role"] != "Admin":
            enabled = {p["name"] for p in user.get("products", []) if p.get("enable")}
            if product not in enabled:
                raise PermissionError("Product not enabled for user")

        identity = self._build_identity(user, report_id)

        return self.power_bi.generate_embed_token_with_rls(
            workspace_id=self.power_bi.group,
            report_id=report_id,
            identity=identity,
        )

    # -----------------------------------------------------------------
    # EffectiveIdentity builder
    # -----------------------------------------------------------------
    def _build_identity(self, user: dict, report_id: str) -> dict:
        user_id = user["id"]

        # Admin → rol DAX sin restricción
        if user["role"] == "Admin":
            return {
                "username":   user_id,
                "roles":      ["Admin"],
                "reports":    [report_id],
                "customData": "admin",
            }

        # Usuario estándar: cargar zonas desde SQL
        zone_set = self.user_zones.list_user_zones(user_id)

        # customData = cadena corta con códigos (<=1024 chars recomendados)
        # Para sets muy grandes, preferir Vía A (bind tables) y dejar customData vacío.
        custom_data = "|".join(
            f"{z.cod_dep or ''}:{z.cod_mun or ''}:{z.cod_zona or ''}"
            for z in zone_set.zones
        )[:1024]

        return {
            "username":   user_id,
            "roles":      ["GeoScope"],
            "reports":    [report_id],
            "customData": custom_data,
            # Vía A — bind tables (equivalente a DirectQuery de "User_Zones_RLS")
            "claims": {
                "User_Zones_RLS": [
                    {"cod_dep":  z.cod_dep or "",
                     "cod_mun":  z.cod_mun or "",
                     "cod_zona": z.cod_zona or ""}
                    for z in zone_set.zones
                ]
            },
        }
```

### 2.6. HTTP Function — **Fix C-05**

Sustituye `power_bi_functions.py`. Tres cambios clave:

1. `auth_level=FUNCTION` en lugar de `ANONYMOUS` (defensa en profundidad · cierra C-03 parcial).
2. Bearer obligatorio → `decode_token` resuelve `oid` del usuario.
3. Se elimina `GET /api/power-bi` (plural). Un endpoint que devuelve tokens de todos los reportes es incompatible con RLS por usuario.

```python
# app/functions/http_functions/power_bi_functions.py
import azure.functions as func, json, logging
from http import HTTPStatus

from shared.utils import MIMETYPE, decode_token
from app.power_bi.power_bi_adapter import PowerBIAdapter
from app.sql.user_sql_adapter import UserSqlAdapter
from app.sql.user_zones_sql_adapter import UserZonesSqlAdapter
from use_cases.power_bi_data import PowerBIUseCase

power_bi_bp = func.Blueprint()


def _resolve_user(req: func.HttpRequest) -> dict:
    auth = req.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise ValueError("Missing bearer token")
    claims  = decode_token(auth[len("Bearer "):])
    oid     = claims.get("oid")
    if not oid:
        raise ValueError("Token without oid claim")
    user = UserSqlAdapter().get_user(oid)
    if not user:
        raise PermissionError("User not registered in SQL")
    return user


@power_bi_bp.function_name(name="GetPowerBIReportById")
@power_bi_bp.route(
    route="power-bi/{reportId}",
    methods=["GET"],
    auth_level=func.AuthLevel.FUNCTION,    # ← Fix C-05 (auth requerida + function key)
)
def get_power_bi_report(req: func.HttpRequest) -> func.HttpResponse:
    try:
        report_id = req.route_params["reportId"]
        user      = _resolve_user(req)

        use_case  = PowerBIUseCase(
            power_bi_repository=PowerBIAdapter(),
            user_zones_repository=UserZonesSqlAdapter(),
        )
        data = use_case.execute_for_user(user, report_id)
        return func.HttpResponse(json.dumps(data),
                                 status_code=HTTPStatus.OK,
                                 mimetype=MIMETYPE)

    except ValueError as v:                # token inválido / ausente
        return func.HttpResponse(json.dumps({"error": str(v)}),
                                 status_code=HTTPStatus.UNAUTHORIZED,
                                 mimetype=MIMETYPE)
    except PermissionError as p:           # producto no habilitado / reporte no mapeado
        return func.HttpResponse(json.dumps({"error": str(p)}),
                                 status_code=HTTPStatus.FORBIDDEN,
                                 mimetype=MIMETYPE)
    except Exception as e:
        logging.error(f"GetPowerBIReportById: {e}")
        return func.HttpResponse(json.dumps({"error": "Internal error"}),
                                 status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
                                 mimetype=MIMETYPE)
```

**Matriz de estado C-05 (criterio de cierre):**

| Condición                                               | Antes del fix          | Después del fix        |
|---------------------------------------------------------|------------------------|------------------------|
| Request sin `Authorization`                             | **200 OK + tokens**    | 401 Unauthorized       |
| Bearer válido, reporte no mapeado                       | 200 OK                 | 403 Forbidden (A-08)   |
| Bearer válido, producto no habilitado                   | 200 OK                 | 403 Forbidden          |
| Bearer válido, admin                                    | 200 OK (sin RLS)       | 200 OK con rol `Admin` |
| Bearer válido, usuario con zonas asignadas              | 200 OK (sin RLS)       | 200 OK con RLS server  |
| Endpoint `GET /api/power-bi` (plural)                   | 200 OK + todos         | **Retirado (404)**     |

---

## 3. Power BI (DAX) — Rol y filtros sobre tablas maestras

El modelo semántico (`.pbix`) debe tener:

### 3.1. Tabla oculta `User_Zones_RLS`

Crear una tabla vacía (DirectQuery o en blanco) con las mismas tres columnas usadas en `claims`:

| Columna   | Tipo    | Notas                                        |
|-----------|---------|----------------------------------------------|
| `cod_dep` | Text    | Código del departamento.                     |
| `cod_mun` | Text    | Código del municipio.                        |
| `cod_zona`| Text    | Código de la zona / puesto.                  |

Power BI poblará esta tabla **en tiempo de consulta** con las filas enviadas en `identities[].claims.User_Zones_RLS` (vía A). Marcarla como oculta para el usuario final.

### 3.2. Relaciones con las tablas maestras

```
User_Zones_RLS[cod_dep]   ──── (1:*) ────▶ data_votacion[cod_dep]
User_Zones_RLS[cod_mun]   ──── (1:*) ────▶ data_votacion[cod_mun]
User_Zones_RLS[cod_zona]  ──── (1:*) ────▶ data_votacion[cod_zona]
```

Activar *cross-filter direction = Single* y *apply security filter in both directions = OFF*. El filtro fluye siempre desde la tabla RLS hacia las de hechos.

### 3.3. Roles DAX

Crear dos roles en **Modeling → Manage Roles**:

#### 3.3.1. Rol `GeoScope` (usuarios estándar)

Filtro DAX sobre `data_votacion` (replicar en cualquier otra tabla maestra):

```DAX
VAR u = USERNAME()                                       -- "oid" de Azure AD
VAR allowedDep =
    CALCULATETABLE (
        VALUES ( User_Zones_RLS[cod_dep] ),
        FILTER ( User_Zones_RLS, User_Zones_RLS[cod_dep] <> "" )
    )
VAR allowedMun =
    CALCULATETABLE (
        VALUES ( User_Zones_RLS[cod_mun] ),
        FILTER ( User_Zones_RLS, User_Zones_RLS[cod_mun] <> "" )
    )
VAR allowedZona =
    CALCULATETABLE (
        VALUES ( User_Zones_RLS[cod_zona] ),
        FILTER ( User_Zones_RLS, User_Zones_RLS[cod_zona] <> "" )
    )
RETURN
    data_votacion[cod_dep]  IN allowedDep
    || data_votacion[cod_mun]  IN allowedMun
    || data_votacion[cod_zona] IN allowedZona
```

**Con `CUSTOMDATA()` (alternativa vía B)** — usar si se optó por enviar el CSV en vez de claims:

```DAX
VAR raw        = CUSTOMDATA()
VAR tokenList  = SUBSTITUTE( raw, "|", "," )
VAR tokens     = PATHITEM ( tokenList, 1 )               -- primera fila
-- La lógica real requiere parsear el CSV "cod_dep:cod_mun:cod_zona" fila a fila.
-- Por eso se prefiere la vía A con bind tables cuando el set es > 10 entradas.
RETURN
    PATHCONTAINS ( raw, data_votacion[cod_dep] )
 || PATHCONTAINS ( raw, data_votacion[cod_mun] )
 || PATHCONTAINS ( raw, data_votacion[cod_zona] )
```

> Recomendación: usar **vía A (bind tables + `USERNAME()`)**. La vía B con `CUSTOMDATA()` es útil como respaldo o para tokens con ≤ 5–10 zonas.

#### 3.3.2. Rol `Admin` (sin restricciones)

No añadir filtros DAX. Cualquier miembro con este rol ve el dataset completo. El backend emite `"roles": ["Admin"]` en `EffectiveIdentity` cuando `user.role == "Admin"`.

### 3.4. Publicación

1. Guardar el `.pbix` y publicar al workspace cuyo ID es `POWER_BI_GROUP_ID`.
2. En el portal de Power BI, ir al dataset → **Security** → asignar al *service principal* (`POWER_BI_CLIENT_ID`) **ambos** roles (`GeoScope`, `Admin`). El SP es quien genera los embed tokens.
3. Validar con **Test as Role** en Desktop: para `oid=<uuid>` con filas de test en `User_Zones_RLS`, confirmar que las visualizaciones filtran correctamente.

---

## 4. Validación (QA · criterios de aceptación)

| # | Caso                                                                  | Resultado esperado                                        |
|---|-----------------------------------------------------------------------|-----------------------------------------------------------|
| 1 | `curl` sin `Authorization` a `GET /api/power-bi/{id}`                 | 401 Unauthorized                                          |
| 2 | Bearer válido, `reportId` no está en `REPORT_TO_PRODUCT_MAP`          | 403 Forbidden (cierra A-08)                               |
| 3 | Bearer válido, producto no habilitado                                 | 403 Forbidden                                             |
| 4 | Bearer válido, usuario `role=Admin`                                   | 200 OK, dashboard completo                                |
| 5 | Bearer válido, usuario con `User_Zones` = [(dep=05)]                  | Dashboard muestra **solo** filas con `cod_dep = "05"`     |
| 6 | Se elimina la asignación en DB → nuevo `GET` tras refresh             | Usuario ve dashboard vacío (no tiene zonas ⇒ filtro falla)|
| 7 | Admin retira el rol `GeoScope` al service principal en Power BI       | `GenerateToken` retorna 400 → endpoint responde 500       |
| 8 | `GET /api/power-bi` (plural, retirado)                                | 404 Not Found                                             |

---

## 5. Rollout sugerido (orden seguro)

1. **DB** — crear `Zones` + `User_Zones` + SPs (`GetUserZones`, `UpsertUserZones`). Backfill manual de 2–3 usuarios piloto.
2. **Modelo Power BI** — añadir `User_Zones_RLS`, relaciones y rol `GeoScope`. Publicar al workspace. **No tocar el backend aún.**
3. **Backend dominio + adaptadores** — `UserZone` model + `UserZonesSqlAdapter` + método `generate_embed_token_with_rls`. Unit tests de `_build_identity`.
4. **Backend use case + endpoint** — sustituir `power_bi_functions.py`. Retirar `GET /api/power-bi` plural. Verificar QA 1–8.
5. **Frontend** — actualizar `src/services/api.ts` para que `Votometro.tsx` y `Audivoto.tsx` dejen de llamar al endpoint plural (ya lo hacen, solo queda quitar el helper muerto `getPowerBiReports`).
6. **Cierre de hallazgos** — marcar C-05 y A-08 como ✅ Cerrado en `DIAGNOSTIC_REPORT.md`; actualizar `ROOT_MEMORY.md` tabla ejecutiva; actualizar `BACKEND_MEM.md`.

---

## 6. Referencias

- `DIAGNOSTIC_REPORT.md` — C-05 (CAPA 3 & 5) y A-08.
- `ROOT_MEMORY.md` — Reglas 3 y 4.
- `BACKEND_MEM.md` — tabla de endpoints y zona de riesgo C-05.
- `GEO_FILTERS_DESIGN.md` — diseño amplio del feature (este documento es el subset *Data Path*).
- Microsoft Docs — [Row-level security (RLS) with Power BI Embedded](https://learn.microsoft.com/power-bi/developer/embedded/embedded-row-level-security).
- Microsoft Docs — [GenerateToken · EffectiveIdentity (REST)](https://learn.microsoft.com/rest/api/power-bi/embed-token/generate-token).
- Microsoft Docs — [USERNAME / CUSTOMDATA DAX functions](https://learn.microsoft.com/dax/customdata-function-dax).
