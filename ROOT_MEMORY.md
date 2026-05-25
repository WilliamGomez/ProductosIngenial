# ROOT_MEMORY — Votometro Monorepo
> Contexto raíz del proyecto. Punto de entrada para cualquier sesión de desarrollo.
> **Última actualización:** 2026-05-15 · Baseline Pre-Azure estabilizado.

---

## Proyecto

**Votometro / Audivoto** — Plataforma de monitoreo y auditoría electoral de Ingenial IA.
- **Backend:** Azure Functions (Python v2) — Clean Architecture — `votometro-backend/`
- **Frontend:** React 19 + TypeScript + Vite — `votometro-frontend/`
- **Infra:** Azure AD (autenticación), Azure SQL (datos), Power BI Embedded (dashboards)
- **Despliegue local:** Docker Compose (`docker-compose.yml`) con nginx reverse proxy
- **CI/CD:** GitHub Actions → Azure Static Web Apps (frontend) + Azure Function App (backend)

---

## Esquema de Base de Datos (3NF — post Hard Reset 2026-05)

El esquema fue reestructurado a Tercera Forma Normal en `db/init/11_hard_reset_schema.sql`.
**Elimina** el anti-patrón de CSV en columnas (`country`, `state`, `city`) de `Products`.

```
dbo.Users
  └── id (Azure AD oid), email, name, role, ...

dbo.Products                        ← CATÁLOGO MAESTRO (solo id + name)
  └── id  PK IDENTITY
  └── name UNIQUE  ("Votometro" | "Audivoto")

dbo.User_Products                   ← CONTRATOS (usuario × producto)
  └── id  PK IDENTITY
  └── user_id           FK → Users.id
  └── product_id        FK → Products.id
  └── contract_duration INT
  └── duration_unit     ("years" | "months" | "days" | "hours")
  └── expiration        DATETIME2
  └── amount_cop        DECIMAL(10,2)
  └── enable            BIT  DEFAULT 1
  └── created_at, updated_at

dbo.User_Zones                      ← ZONAS POR CONTRATO (vinculadas al contrato)
  └── id  PK IDENTITY
  └── user_product_id   FK → User_Products.id  ON DELETE CASCADE
  └── cod_dep           NVARCHAR  ← SIEMPRE 2 dígitos (.zfill(2))
  └── cod_mun           NVARCHAR  ← 3 dígitos (.zfill(3)) o NULL = depto completo
  └── enable            BIT  DEFAULT 1
  └── created_at

dbo.UserSessions                    ← SESIONES ACTIVAS
  └── session_id (UUID), user_id, device_id, session_token
  └── ip_address, login_time, last_activity_time, logout_time
  └── status ("Active" | "Closed" | "Expired_Idle" | "Revoked")
  └── is_active BIT, is_revoked BIT

dbo.Session_Navigation_Logs         ← TELEMETRÍA DE NAVEGACIÓN
  └── log_id BIGINT, session_id FK → UserSessions
  └── page_route, time_spent_seconds, created_at

dbo.DIVIPOLA                        ← CATÁLOGO GEOGRÁFICO (fuente DANE)
  └── cod_dep (2 dígitos), nom_dep
  └── cod_mun (3 dígitos), nom_mun
```

### Regla de Estandarización DIVIPOLA (CRÍTICA)
> **Toda** capa del sistema (SQL, Python, React, DAX) debe respetar estrictamente:
> - `cod_dep`: siempre **2 dígitos** → `str(value).strip().zfill(2)`
> - `cod_mun`: siempre **3 dígitos** → `str(value).strip()[-3:].zfill(3)` (o `NULL` para depto completo)
>
> El `customData` del embed token Power BI usa el formato `"DD:MMM:"` por zona, separadas por `"|"`.
> Ejemplo: `"05:001:|05:002:|81::"` (Medellín, Bello, y todo el dep. Arauca).

---

## Reglas de Desarrollo

### Regla 1 · Sesión única — NUNCA romper
El sistema garantiza que cada usuario tenga **una sola sesión activa** en todo momento. Al crear una nueva sesión (`POST /api/session`), se invalidan **todas** las sesiones previas del usuario. El heartbeat del frontend (cada 15 s) fuerza el logout si detecta que la sesión fue invalidada o revocada.
- No alterar `ValidateSessionUseCase.execute()` sin entender este contrato.
- No omitir `invalidate_all_sessions(user_id)` al crear una sesión nueva.
- El timeout por inactividad es de **2 horas** (7200 segundos).

### Regla 2 · Autenticación faltante en endpoints de usuario — PRIORIDAD MÁXIMA (HAL-01)
Los endpoints `POST/GET/PUT /api/user` y `PUT /api/user-products/{user_id}` **carecen de verificación JWT**. Cualquier actor puede crear usuarios, listar el directorio completo y modificar roles sin autenticarse.
- **No añadir nuevas funcionalidades** a estos endpoints hasta que tengan `decode_token` + verificación `role == "Admin"`.
- Archivo a modificar: `app/functions/http_functions/user_functions.py`.

### Regla 3 · Actualizar la memoria de contexto tras modificaciones
- Si modificas cualquier archivo en `votometro-backend/` → actualiza `votometro-backend/BACKEND_MEM.md`.
- Si modificas cualquier archivo en `votometro-frontend/` → actualiza `votometro-frontend/FRONTEND_MEM.md`.

### Regla 4 · Consultar AUDITORIA_OWASP_TOP10.md antes de implementar en capas afectadas
Antes de implementar nuevas funciones en una capa con hallazgos Críticos o Altos, leer la sección correspondiente. Capas con mayor riesgo activo:
- **Backend — User endpoints** (HAL-01, HAL-02): No tocar `user_functions.py` sin añadir auth JWT.
- **Backend — Power BI** (HAL-11): `POWER_BI_DISABLE_RLS=1` activo en `.env` → todos ven datos de todos. Cambiar a `0` antes de producción.
- **Infra — Puertos expuestos** (HAL-13, HAL-14): Backend (`:7071`) y BD (`:1433`) expuestos. Solo aceptable en desarrollo local.

### Regla 5 · Formato DIVIPOLA en toda escritura
Al guardar, leer o transmitir códigos geográficos, aplicar siempre `.zfill(2)` a `cod_dep` y `.zfill(3)` a `cod_mun`. No aceptar ni persistir valores sin padding. Ver `app/sql/user_zones_sql_adapter.py` como referencia canónica.

---

## Mapa de Hallazgos — OWASP Top 10 Audit (2026-05-14)

> Fuente completa: `AUDITORIA_OWASP_TOP10.md`. Se listan solo los Críticos y Altos.

| ID | Severidad | Capa | Descripción resumida | Estado |
|----|-----------|------|----------------------|--------|
| HAL-01 | 🔴 Crítico | Backend HTTP | Endpoints `/api/user` sin autenticación JWT | ⏳ Pendiente |
| HAL-02 | 🔴 Crítico | Backend HTTP | IDOR: cualquier usuario puede leer/modificar otro usuario | ⏳ Pendiente |
| HAL-11 | 🔴 Crítico | Power BI | `POWER_BI_DISABLE_RLS=1` → RLS desactivado globalmente | ⏳ Pendiente |
| HAL-13 | 🔴 Crítico | Infra Docker | Puerto 7071 del backend expuesto — bypasea nginx | ⏳ Pendiente |
| HAL-03 | 🟠 Alto | Backend HTTP | Upload DIVIPOLA sin autenticación | ⏳ Pendiente |
| HAL-04 | 🟠 Alto | Backend HTTP | `/api/manage/sessions/revoke` no valida sesión activa del admin | ⏳ Pendiente |
| HAL-05 | 🟠 Alto | Backend Auth | MS Graph App ID aceptado como audiencia JWT válida | ⏳ Pendiente |
| HAL-10 | 🟠 Alto | Backend HTTP | Detalles internos de error expuestos en respuestas 500 | ⏳ Pendiente |
| HAL-14 | 🟠 Alto | Infra Docker | Puerto 1433 de SQL Server expuesto directamente | ⏳ Pendiente |
| HAL-17 | 🟠 Alto | Backend HTTP | Heartbeat no valida que la sesión pertenezca al usuario | ⏳ Pendiente |

---

## Arquitectura de Sesiones (implementada)

```
Frontend (heartbeat cada 15s)
  └─ PUT /api/sessions/heartbeat  { session_token, pages: [{route, seconds}] }
        └─ SessionSqlAdapter.record_heartbeat()
              └─ INSERT dbo.Session_Navigation_Logs (por ruta visitada)
              └─ UPDATE UserSessions.last_activity_time
              └─ Si idle > 7200s → status = "Expired_Idle", throws PermissionError
                    └─ Frontend recibe 401 con code SESSION_REVOKED → logout forzado
```

El Admin puede revocar sesiones activas via `POST /api/manage/sessions/revoke`.

---

## Archivos de Contexto

| Archivo | Propósito |
|---------|-----------|
| `ROOT_MEMORY.md` | Este archivo — reglas globales, esquema DB y mapa de riesgo |
| `README.md` | Documentación operativa (arquitectura, setup, Docker, env vars) |
| `EXECUTION_README.md` | Guía de ejecución (Docker, local, deploy, checklist pre-producción) |
| `votometro-backend/BACKEND_MEM.md` | Arquitectura backend, endpoints y zonas de riesgo detalladas |
| `votometro-frontend/FRONTEND_MEM.md` | Stack frontend, flujo de sesión y zonas de riesgo detalladas |
| `AUDITORIA_OWASP_TOP10.md` | Auditoría OWASP Top 10 completa (2026-05-14) — 19 hallazgos |
| `REFACTORING_SUMMARY.md` | Historial de refactorizaciones incluyendo baseline 3NF |
| `GEO_FILTERS_DESIGN.md` | Diseño del feature de filtros geográficos + RLS Power BI |
| `GEO_RLS_DATA_PATH.md` | Ruta de datos end-to-end: `User_Zones` → Python → DAX |
| `DOCKER.md` | Guía de despliegue Docker Compose |

---

## Comandos Rápidos

```powershell
# ── Docker (modo primario de ejecución) ──────────────────────────────
docker compose up -d                              # Levanta toda la plataforma
docker compose logs backend -f                    # Seguir logs del backend
docker compose build backend frontend --no-cache  # Rebuild tras cambios de código
docker compose down                               # Detener todo

# ── Desarrollo local sin Docker ───────────────────────────────────────
# Backend
cd votometro-backend; .venv\Scripts\activate; func start

# Frontend
cd votometro-frontend; pnpm dev
```

---

## Variables de Entorno Clave (`.env` raíz — consumido por docker-compose)

| Variable | Propósito |
|----------|-----------|
| `VITE_BACKEND_URL` | URL base del backend para el frontend (`/api` en Docker via nginx) |
| `TENANT_ID` | Azure AD tenant |
| `MS_CLIENT_ID` | App registration del backend |
| `SQL_CONNECTION_STRING` | ODBC string para Azure SQL |
| `POWER_BI_DISABLE_RLS` | **`0` en producción** — `1` desactiva RLS globalmente (HAL-11) |
| `POWER_BI_GROUP_ID` | Workspace ID de Power BI Embedded |
