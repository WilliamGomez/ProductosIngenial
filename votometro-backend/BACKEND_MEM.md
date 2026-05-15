# BACKEND_MEM — Votometro Backend
> Memoria de contexto para desarrollo continuo. Actualizar tras cada cambio significativo.

---

## Arquitectura (Clean Architecture — Azure Functions / Python)

```
function_app.py          ← Entry point, registra blueprints
domain/
  models/                ← Entidades puras: User, Product, Department, Municipality, PowerBI
  repositories/          ← Interfaces abstractas (contratos)
  exceptions.py          ← DomainException, UserAlreadyExistsException, UserNotFoundException
app/
  functions/http_functions/  ← HTTP triggers (controladores)
  sql/                   ← Adaptadores pyodbc → stored procedures
  ms_graph/              ← Integración Azure AD / MS Graph
  power_bi/              ← Integración Power BI API
use_cases/               ← Orquestación de lógica de aplicación
shared/
  utils.py               ← decode_token / verify_and_decode_token / calculate_expiration
  msal_auth.py           ← Token para MS Graph (client_credentials)
  power_bi_auth.py       ← Token para Power BI (client_credentials)
```

**Flujo de request:** HTTP Function → `decode_token` (JWT) → Use Case → Adaptador SQL/Graph/PowerBI → DB/API

---

## Endpoints Principales

| Método | Ruta | Auth JWT | Notas |
|--------|------|----------|-------|
| POST | `/api/user` | ❌ NINGUNA | **C-01** — abierto |
| GET | `/api/user` | ❌ NINGUNA | **C-01** — abierto |
| GET | `/api/user/{user_id}` | ❌ NINGUNA | **C-01** — abierto |
| PUT | `/api/user/{user_id}` | ❌ NINGUNA | **C-01** — abierto |
| PUT | `/api/user-products/{user_id}` | ❌ NINGUNA | **C-01** — abierto |
| POST | `/api/session` | Sí (body) | Token en body, no en header |
| POST | `/api/invalidate-session` | Sí (body) | Token en body |
| POST | `/api/session/force-logout-all` | Sí (body) | Token en body |
| GET | `/api/users-sessions` | Sí (header) | Solo Admin en lógica |
| ~~GET~~ | ~~`/api/power-bi`~~ | — | **Retirado 2026-04-23** (cierra C-05). El use case `execute()` queda solo para scripts internos. |
| GET | `/api/power-bi/{reportId}` | Function Key + Bearer | RLS server-side via `execute_for_user`; deny-by-default si `reportId ∉ REPORT_TO_PRODUCT_MAP` (cierra A-08) |
| GET | `/api/countries` | ❌ NINGUNA | Datos de catálogo |
| GET | `/api/departments` | ❌ NINGUNA | Datos de catálogo |
| GET | `/api/municipality` | ❌ NINGUNA | Datos de catálogo |

---

## Stack de Dependencias Clave

- `azure-functions` — framework Azure Functions
- `msal 1.32.3` — adquisición client_credentials (MS Graph + Power BI)
- `PyJWT + cryptography` — verificación RS256 con JWKS de Azure AD
- `pyodbc 5.2.0` — conexión SQL Server (stored procedures exclusivamente)
- `pandas 2.2.3` — agrupación de resultados SQL (list_users / get_user)

---

## ⚠️ ZONAS DE RIESGO — No Romper

> Leer antes de modificar cualquier endpoint, use case o adaptador SQL.

### 🔴 C-01 · Endpoints de usuarios SIN autenticación
- **Archivos:** `app/functions/http_functions/user_functions.py` — todos los endpoints
- **Riesgo:** Cualquiera puede crear/listar/modificar usuarios sin presentar credenciales.
- **Acción pendiente:** Añadir `decode_token` + verificación de rol Admin antes de cada handler.

### 🔴 C-02 · Bypass de audiencia JWT (`verify_aud: False` + IDs hardcodeados)
- **Archivo:** `shared/utils.py:114–133`
- **Riesgo:** Token de MS Graph o de la app frontend aceptado como válido para el backend. El comentario `# temporal` lleva en producción.
- **Acción pendiente:** Activar `verify_aud: True`, eliminar `"00000003-..."` de `valid_audiences`, mover IDs a env vars.

### 🔴 C-03 · Todos los endpoints `auth_level=ANONYMOUS`
- **Riesgo:** Sin function key de Azure como segunda barrera. La única defensa es la lógica JWT manual.
- **Acción pendiente:** Evaluar migrar a `AuthLevel.FUNCTION` o `AuthLevel.ADMIN` en producción.

### 🔴 C-04 · Password devuelta en texto plano en respuesta HTTP
- **Archivos:** `domain/models/user.py:16`, `use_cases/create_user.py:77`, `user_functions.py:39`
- **Riesgo:** `created_user.__dict__` incluye el campo `password` y se serializa en la respuesta `201`.
- **Acción pendiente:** Eliminar `password` del `__dict__` antes de retornar, o eliminar el campo del modelo.

### ✅ C-05 · `GET /api/power-bi` — **CERRADO (2026-04-23)**
- **Archivos (actuales):** `app/functions/http_functions/power_bi_functions.py`, `use_cases/power_bi_data.py`
- **Mitigación aplicada:**
  1. Endpoint plural `GET /api/power-bi` retirado del HTTP layer; `PowerBIUseCase.execute()` queda solo como método interno (no expuesto).
  2. `GET /api/power-bi/{reportId}` es ahora `auth_level=FUNCTION` (Function Key) + Bearer JWT obligatorio (`_resolve_user` decodifica + valida + resuelve `oid → user`).
  3. `PowerBIUseCase.execute_for_user` arma `EffectiveIdentity` (rol `Admin` o `GeoScope`) y emite embed tokens con RLS server-side (claims `User_Zones_RLS` + fallback `customData`).
- **Regresión a vigilar:** no reintroducir rutas anónimas; no exponer `execute()` sin Bearer.

### ✅ A-08 · Bypass autorización por reporte no mapeado — **CERRADO (2026-04-23)**
- **Archivo:** `use_cases/power_bi_data.py` (`REPORT_TO_PRODUCT_MAP`).
- **Mitigación aplicada:** Mapa movido al use case y convertido en **deny-by-default** — reporte no listado ⇒ `PermissionError` ⇒ HTTP 403. Regla 5 obliga a registrar el GUID junto con la publicación.

### 🔴 C-06 · Sin rollback transaccional en `CreateUserUseCase`
- **Archivo:** `use_cases/create_user.py:36–73`
- **Riesgo:** Si falla el INSERT en SQL, el usuario queda activo en Azure AD sin registro local (estado huérfano).
- **Acción pendiente:** Añadir bloque `except` que elimine el usuario de Azure AD si el paso SQL falla.

### 🟠 A-05 · Fuga de conexiones pyodbc en todos los adaptadores SQL
- **Archivos:** `app/sql/user_sql_adapter.py:12`, `session_sql_adapter.py:13`, `department_sql_adapter.py:10`, `municipality_sql_adapter.py:10`
- **Riesgo:** Conexiones nunca cerradas. En picos de tráfico se agotan las conexiones de Azure SQL.
- **Acción pendiente:** Implementar context manager (`with pyodbc.connect(...) as conn`) o cerrar en `finally`.

---

## Reglas de Desarrollo Backend

1. Todo nuevo endpoint **debe** llamar a `decode_token` y verificar el rol antes de ejecutar lógica.
2. Toda operación que toque Azure AD **y** SQL debe tener compensación (rollback/cleanup) en caso de fallo.
3. No usar f-strings para construir queries SQL. Solo `?` como placeholders parametrizados.
4. Los cursores y conexiones `pyodbc` deben cerrarse en bloques `finally` o context managers.
5. Antes de añadir un reporte nuevo a Power BI, actualizar `REPORT_TO_PRODUCT_MAP` en **`use_cases/power_bi_data.py`** (el mapa vive ahí desde 2026-04-23) y crear los roles DAX `GeoScope` + `Admin` según `docs/powerbi_dax_rules.md`. Reportes sin mapeo devuelven 403 (deny-by-default).
6. El diseño del feature *Filtros Geográficos Dinámicos* vive en `GEO_FILTERS_DESIGN.md` (raíz del monorepo). Cualquier cambio en `PowerBIUseCase`, `PowerBIAdapter` o `power_bi_functions.py` debe respetar ese contrato (EffectiveIdentity con `UserDepartments/UserMunicipalities/UserZones`).

---

## Feature Implementado — Filtros Geográficos (Power BI RLS) · 2026-04-23

Estado: **Backend entregado**. Pendiente: migración SQL contra la DB real,
roles DAX en los `.pbix` publicados, y frontend (filtros visuales, si se
requieren además del RLS server-side).

Artefactos entregados:

- **Migración SQL:** `migrations/2026-04-23_geo_rls.sql` — tablas `Zones`,
  `User_Zones` y SPs `GetUserZones` / `UpsertUserZones` con rollback.
- **Modelo:** `domain/models/user_zone.py` (`UserZone`, `UserZoneSet`).
- **Contrato:** `domain/repositories/user_zones_repository.py`
  (`IUserZonesRepository`).
- **Adapter:** `app/sql/user_zones_sql_adapter.py` — usa context managers
  (no regresión de A-05).
- **Contrato extendido:** `domain/repositories/power_bi_repository.py`
  (`generate_embed_token_with_rls`).
- **Adapter extendido:** `app/power_bi/power_bi_adapter.py` —
  `GenerateToken` con `identities` efectivas.
- **Use case:** `use_cases/power_bi_data.py` — `execute_for_user` +
  `_build_identity` + `REPORT_TO_PRODUCT_MAP` (deny-by-default).
- **HTTP:** `app/functions/http_functions/power_bi_functions.py` —
  `GET /power-bi/{reportId}` con `auth_level=FUNCTION` + Bearer y
  mapeo de errores (`ValueError → 401`, `PermissionError → 403`,
  `LookupError → 404`, `RuntimeError → 502`).
- **DAX:** `docs/powerbi_dax_rules.md` — reglas para `GeoScope` / `Admin`
  (vía A con bind table `User_Zones_RLS`, vía B con `CUSTOMDATA()`).

Documentos fuente (no tocar sin actualizar el código): `GEO_FILTERS_DESIGN.md`,
`GEO_RLS_DATA_PATH.md`.
