# Votometro — Monorepo

> Plataforma de monitoreo y auditoría electoral de **Ingenial IA**.
> Stack: **Azure Functions (Python v2)** · **React 19 + Vite + TypeScript** · **Azure AD** · **Azure SQL** · **Power BI Embedded**.
> **Estado:** ✅ Baseline Pre-Azure estabilizado (2026-05-15) — listo para despliegue bajo condiciones de remediación HAL-01..HAL-13.

---

## Tabla de Contenido

1. [Estado de Seguridad (leer ANTES de desplegar)](#estado-de-seguridad)
2. [Arquitectura](#arquitectura)
3. [Esquema de Base de Datos](#esquema-de-base-de-datos)
4. [Setup Local](#setup-local)
5. [Docker (modo primario)](#docker-modo-primario)
6. [Variables de Entorno](#variables-de-entorno)
7. [Estructura del Repositorio](#estructura-del-repositorio)
8. [Referencias de Contexto](#referencias-de-contexto)

---

## Estado de Seguridad

> **Auditoría OWASP Top 10 completada — 2026-05-14 · `AUDITORIA_OWASP_TOP10.md`**
>
> Se identificaron **19 hallazgos** (4 Críticos, 5 Altos, 6 Medios, 3 Bajos, 3 Informativos).
> Los 4 hallazgos Críticos son bloqueantes para producción.

| ID | Capa | Descripción resumida | Estado |
|----|------|----------------------|--------|
| HAL-01 | Backend HTTP | `GET/POST/PUT /api/user` sin autenticación JWT — acceso abierto | ⏳ Pendiente |
| HAL-02 | Backend HTTP | IDOR: cualquier usuario puede ver/modificar datos de otro usuario | ⏳ Pendiente |
| HAL-11 | Power BI | `POWER_BI_DISABLE_RLS=1` activo → todos los usuarios ven todos los datos | ⏳ Pendiente |
| HAL-13 | Infra Docker | Puerto 7071 expuesto directamente — bypasea nginx y sus controles | ⏳ Pendiente |
| HAL-03 | Backend HTTP | Upload DIVIPOLA sin autenticación | ⏳ Pendiente |
| HAL-14 | Infra Docker | Puerto 1433 SQL Server expuesto directamente | ⏳ Pendiente |

**Reglas de desarrollo durante la remediación:**

1. No añadir funcionalidades nuevas a `user_functions.py` hasta resolver HAL-01.
2. No modificar `shared/utils.py` sin leer primero la sección Auth de `AUDITORIA_OWASP_TOP10.md`.
3. Nunca guardar tokens en `localStorage` del frontend — usar `sessionStorage` o estado en memoria.
4. La fuente de verdad para el rol del usuario es `user.role` devuelto por el backend (no `idTokenClaims`).
5. `POWER_BI_DISABLE_RLS` debe ser `0` antes de cualquier despliegue en producción.
6. Tras cada cambio, actualizar la memoria correspondiente (`BACKEND_MEM.md` / `FRONTEND_MEM.md`).

---

## Arquitectura

El backend sigue **Clean Architecture** con separación estricta en capas. El flujo de un request es siempre:

```
HTTP Trigger → decode_token (JWT) → Use Case → Repositorio (SQL/Graph/Power BI) → Respuesta
```

### Capa de Dominio (`domain/`)

Reglas y contratos independientes de cualquier framework.

- `domain/models/` — entidades: `User`, `Product`, `UserZone`, `PowerBI`, `Report`, `EmbedConfig`.
- `domain/repositories/` — interfaces abstractas (contratos que los use cases conocen).
- `domain/exceptions.py` — `UserAlreadyExistsException`, `UserNotFoundException`.

### Capa de Aplicación (`app/`)

Implementaciones concretas de los contratos de dominio.

- `app/functions/http_functions/` — HTTP triggers (controladores). Blueprints registrados en `function_app.py`.
- `app/sql/` — adaptadores `pyodbc` que invocan stored procedures.
- `app/ms_graph/` — adaptador de Microsoft Graph para CRUD de usuarios en Azure AD.
- `app/power_bi/power_bi_adapter.py` — adaptador REST para Power BI (embed tokens + RLS).

### Capa de Casos de Uso (`use_cases/`)

Orquesta la lógica de negocio usando únicamente interfaces de `domain/repositories`.

Casos de uso principales:
- `CreateUserUseCase`, `UpdateUserUseCase`, `UpsertUserProductsUseCase`, `GetUserUseCase`, `ListUsersUseCase`.
- `ValidateSessionUseCase`, `InvalidateSessionUseCase`, `ForceLogoutAllDevicesUseCase`.
- `PowerBIUseCase` — genera embed token con `EffectiveIdentity` (RLS) por usuario.
- `BulkUpsertDivipolaUseCase` — importa catálogo DANE geográfico desde CSV.

### Capa Compartida (`shared/`)

- `shared/utils.py` — `decode_token`, `json_response` (UTF-8 garantizado, `ensure_ascii=False`).
- `shared/msal_auth.py` — `client_credentials` para Microsoft Graph.
- `shared/power_bi_auth.py` — `client_credentials` para Power BI REST API.

### Frontend (`votometro-frontend/`)

- `src/context/SessionContext.tsx` — estado global (usuario, productos, heartbeat cada 15 s).
- `src/hooks/useAuth.ts`, `src/hooks/useAccessToken.ts` — acceso a rol y token MSAL.
- `src/router/AppRouter.tsx` — rutas dinámicas según `userRole` + productos habilitados.
- `src/pages/Votometro.tsx`, `src/pages/Audivoto.tsx` — dashboards Power BI Embedded.
- `src/services/api.ts` — cliente Axios, `baseURL = VITE_BACKEND_URL`.

---

## Esquema de Base de Datos

Modelo 3NF implementado en `db/init/11_hard_reset_schema.sql`:

```
dbo.Products          → Catálogo maestro: id, name ("Votometro" | "Audivoto")
dbo.User_Products     → Contratos: user_id FK, product_id FK, duración, monto, enable
dbo.User_Zones        → Zonas: user_product_id FK, cod_dep (2 dig), cod_mun (3 dig)
dbo.UserSessions      → Sesiones: session_id, user_id, device_id, status, timestamps
dbo.Session_Navigation_Logs → Telemetría: session_id FK, page_route, time_spent_seconds
dbo.DIVIPOLA          → Catálogo geográfico DANE: cod_dep (2 dig), cod_mun (3 dig)
```

**Regla DIVIPOLA:** `cod_dep` = siempre 2 dígitos (`zfill(2)`), `cod_mun` = siempre 3 dígitos (`zfill(3)`) o `NULL` para departamento completo.

---

## Setup Local

### 1. Requisitos

| Herramienta | Versión | Notas |
|-------------|---------|-------|
| Python | 3.11 | Ver `.python-version` |
| Node.js | 22 LTS | Ver `.node-version` |
| pnpm | 9+ | `pnpm-lock.yaml` |
| Azure Functions Core Tools | v4 | `func start` |
| ODBC Driver for SQL Server | 17 o 18 | Para `pyodbc` |
| Docker Desktop | 4+ | Para despliegue en contenedores |

### 2. Backend (`votometro-backend/`)

```bash
cd votometro-backend
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

`local.settings.json` en la raíz del backend (ver `secrets/local.settings.json` como plantilla — **NO commitear**):

```jsonc
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "python",
    "TENANT_ID": "<azure-ad-tenant-id>",
    "MS_CLIENT_ID": "<backend-app-registration-id>",
    "MS_CLIENT_SECRET": "<backend-app-secret>",
    "SQL_CONNECTION_STRING": "Driver={ODBC Driver 18 for SQL Server};...",
    "POWER_BI_CLIENT_ID": "<powerbi-app-id>",
    "POWER_BI_CLIENT_SECRET": "<powerbi-app-secret>",
    "POWER_BI_TENANT_ID": "<tenant-id>",
    "POWER_BI_GROUP_ID": "<workspace-id>",
    "POWER_BI_DISABLE_RLS": "1"
  }
}
```

### 3. Frontend (`votometro-frontend/`)

```bash
cd votometro-frontend
pnpm install
```

`.env.local` en la raíz del frontend (**NO commitear**):

```ini
VITE_BACKEND_URL=http://localhost:7071/api
VITE_MSAL_CLIENT_ID=<frontend-app-registration-id>
VITE_MSAL_TENANT_ID=<azure-ad-tenant-id>
VITE_MSAL_REDIRECT_URI=http://localhost:5173
VITE_API_SCOPE=api://<backend-app-registration-id>/access_as_user
```

---

## Docker (modo primario)

La forma recomendada de ejecutar el proyecto es con Docker Compose. Incluye:
- **nginx** (frontend en puerto 8080, reverse proxy `/api/` → backend)
- **backend** (Azure Functions en puerto 7071 — solo accesible internamente)
- **mssql** (SQL Server 2022 en puerto 1433)
- **db-init** (ejecuta scripts SQL de `db/init/` automáticamente)

```powershell
# Variables de entorno en .env (raíz del proyecto)
# Ver .env.example como referencia

# Levantar toda la plataforma
docker compose up -d

# Ver logs
docker compose logs backend -f
docker compose logs frontend -f

# Rebuild tras cambios de código
docker compose build backend frontend --no-cache
docker compose up -d backend frontend

# Detener
docker compose down
```

La aplicación queda disponible en `http://localhost:8080`. MSAL hará login popup contra Azure AD.

> Detalle completo: ver `DOCKER.md`.

---

## Variables de Entorno

### Backend (`local.settings.json` / Application Settings en Azure)

| Clave | Propósito |
|-------|-----------|
| `TENANT_ID` | Azure AD tenant — validación de `iss` en JWT |
| `MS_CLIENT_ID` | App registration del backend — validación de `aud` en JWT |
| `MS_CLIENT_SECRET` | Secreto para `ConfidentialClientApplication` → Graph |
| `SQL_CONNECTION_STRING` | ODBC string para Azure SQL |
| `POWER_BI_CLIENT_ID` | App registration con permisos sobre Power BI Service |
| `POWER_BI_CLIENT_SECRET` | Secreto del Power BI client |
| `POWER_BI_TENANT_ID` | Tenant de Power BI |
| `POWER_BI_GROUP_ID` | Workspace ID de Power BI Embedded |
| `POWER_BI_DISABLE_RLS` | `0` = RLS activo (producción), `1` = RLS desactivado (desarrollo) |

### Frontend (`.env.local` / Application Settings en SWA)

| Clave | Propósito |
|-------|-----------|
| `VITE_BACKEND_URL` | URL base del backend (e.g. `/api` en Docker, URL completa en Azure) |
| `VITE_MSAL_CLIENT_ID` | App registration del frontend |
| `VITE_MSAL_TENANT_ID` | Tenant Azure AD |
| `VITE_MSAL_REDIRECT_URI` | URI de redirección registrada en Azure AD |
| `VITE_API_SCOPE` | Scope que el frontend solicita al backend |

---

## Estructura del Repositorio

```
Votometro/
├── .env.example                 ← plantilla de variables de entorno
├── .gitignore                   ← raíz del monorepo
├── docker-compose.yml           ← despliegue local completo
├── DOCKER.md                    ← guía Docker
├── ROOT_MEMORY.md               ← reglas globales, esquema DB y mapa de riesgo
├── AUDITORIA_OWASP_TOP10.md     ← auditoría de seguridad (2026-05-14)
├── REFACTORING_SUMMARY.md       ← historial de cambios y baseline
├── GEO_FILTERS_DESIGN.md        ← diseño RLS Power BI
├── GEO_RLS_DATA_PATH.md         ← ruta de datos end-to-end DB → DAX
├── divipole.csv                 ← catálogo DIVIPOLA (fuente DANE)
│
├── db/
│   └── init/                   ← scripts SQL (se ejecutan en orden)
│       ├── 01_base_schema.sql
│       ├── 08_session_audit.sql
│       ├── 11_hard_reset_schema.sql  ← Hard Reset 3NF (catálogo + contratos + zonas)
│       └── ...
│
├── votometro-backend/
│   ├── BACKEND_MEM.md
│   ├── function_app.py          ← entry point, registra blueprints
│   ├── domain/                  ← entidades + interfaces
│   ├── app/
│   │   ├── functions/http_functions/  ← HTTP triggers
│   │   ├── sql/                 ← adaptadores pyodbc
│   │   └── power_bi/            ← adaptador Power BI
│   ├── use_cases/               ← lógica de negocio
│   └── shared/                  ← utils.py (json_response UTF-8), msal_auth, power_bi_auth
│
└── votometro-frontend/
    ├── FRONTEND_MEM.md
    ├── nginx.conf               ← reverse proxy + cabeceras de seguridad
    ├── src/
    │   ├── authConfig.ts
    │   ├── context/SessionContext.tsx
    │   ├── services/api.ts      ← cliente Axios (baseURL = VITE_BACKEND_URL)
    │   └── ...
    └── vite.config.ts
```

---

## Referencias de Contexto

| Archivo | Usar cuando… |
|---------|-------------|
| `ROOT_MEMORY.md` | Esquema DB, reglas globales, mapa de riesgos |
| `AUDITORIA_OWASP_TOP10.md` | Antes de modificar cualquier capa con hallazgos abiertos |
| `EXECUTION_README.md` | Levantar el proyecto, comandos Docker, checklist pre-producción |
| `BACKEND_MEM.md` | Endpoints, adaptadores SQL/Graph/Power BI, zonas de riesgo |
| `FRONTEND_MEM.md` | SessionContext, hooks de auth, AppRouter |
| `GEO_FILTERS_DESIGN.md` | Diseño del feature de filtros geográficos (RLS) |
| `GEO_RLS_DATA_PATH.md` | Flujo de datos DB → Python → `customData` → DAX |
| `REFACTORING_SUMMARY.md` | Historial completo de cambios incluyendo baseline 3NF |
