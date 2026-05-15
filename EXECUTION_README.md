# Votometro · README de Ejecución

> Guía técnica directa para levantar backend y frontend. Sin arquitectura extendida — para eso ver `README.md` y `BACKEND_MEM.md`.
> **Estado del proyecto:** ✅ Baseline Pre-Azure estabilizado (2026-05-15).

---

## ⚠️ Aviso de Seguridad — Revisar antes de desplegar a producción

> **Auditoría OWASP Top 10 completada (2026-05-14) — `AUDITORIA_OWASP_TOP10.md`.**
> Los siguientes hallazgos **bloquean** cualquier despliegue en entorno público.

| ID | Vector | Mitigación temporal (dev local) |
|----|--------|---------------------------------|
| HAL-01 | `GET/POST/PUT /api/user` sin JWT | No exponer la Function App a Internet |
| HAL-02 | IDOR: usuarios pueden leer/modificar otros usuarios | Ídem |
| HAL-11 | `POWER_BI_DISABLE_RLS=1` → RLS desactivado globalmente | Solo usar con datos de prueba |
| HAL-13 | Puerto 7071 expuesto — bypasea nginx | Usar solo en red local aislada |
| HAL-14 | Puerto 1433 expuesto directamente | Usar solo en red local aislada |

**Sin resolver los 4 hallazgos Críticos, no promover a producción.**

---

## 1. Prerrequisitos

| Herramienta | Versión | Verificar con |
|-------------|---------|---------------|
| Docker Desktop | 4+ | `docker --version` |
| Python | 3.11 | `python --version` |
| Node.js | 22 LTS | `node --version` |
| pnpm | 9+ | `pnpm --version` |
| Azure Functions Core Tools | v4 | `func --version` |
| ODBC Driver SQL Server | 17 / 18 | (solo para ejecución sin Docker) |

---

## 2. Ejecución con Docker (MODO PRIMARIO)

Docker Compose levanta el stack completo: nginx + Azure Functions + SQL Server + inicialización de BD.

### 2.1. Configurar variables de entorno

Crear `.env` en la raíz del proyecto (ver `.env.example`):

```ini
# Azure AD
TENANT_ID=<azure-ad-tenant-id>
MS_CLIENT_ID=<backend-app-registration-id>
MS_CLIENT_SECRET=<backend-app-secret>

# SQL Server (Docker — valores del docker-compose)
SA_PASSWORD=<sa-password-minimo-8chars-mayuscula-numero-especial>
SQL_CONNECTION_STRING=Driver={ODBC Driver 18 for SQL Server};Server=tcp:db,1433;Database=sqldb-ingenial-ia;Uid=sa;Pwd=<SA_PASSWORD>;Encrypt=no;TrustServerCertificate=yes;

# Power BI
POWER_BI_CLIENT_ID=<powerbi-app-id>
POWER_BI_CLIENT_SECRET=<powerbi-app-secret>
POWER_BI_TENANT_ID=<tenant-id>
POWER_BI_GROUP_ID=<workspace-id>
POWER_BI_DISABLE_RLS=1        # Cambiar a 0 en producción (HAL-11)

# Frontend (consumido en build Vite)
VITE_BACKEND_URL=/api
VITE_MSAL_CLIENT_ID=<frontend-app-registration-id>
VITE_MSAL_TENANT_ID=<azure-ad-tenant-id>
VITE_MSAL_REDIRECT_URI=http://localhost:8080
VITE_API_SCOPE=api://<backend-app-registration-id>/access_as_user
```

### 2.2. Comandos Docker (PowerShell)

```powershell
# Levantar todo
docker compose up -d

# Verificar que los servicios están sanos
docker compose ps

# Ver logs en tiempo real
docker compose logs backend -f
docker compose logs frontend -f

# Rebuild tras cambios de código fuente
docker compose build backend frontend --no-cache
docker compose up -d backend frontend

# Verificar que las funciones se registraron sin error
Start-Sleep -Seconds 10
docker compose logs backend | Select-String -Pattern "Host initialized|in error|Function"

# Detener todo (conserva volúmenes de BD)
docker compose down

# Detener y eliminar datos de BD
docker compose down -v
```

La aplicación queda disponible en **`http://localhost:8080`**.

### 2.3. Inicialización de base de datos

Los scripts de `db/init/` se ejecutan automáticamente en orden numérico por el servicio `db-init`.
Si necesitas re-ejecutarlos manualmente:

```powershell
# Conectar a SQL Server dentro del contenedor
docker compose exec db /opt/mssql-tools/bin/sqlcmd `
    -S localhost -U sa -P $env:SA_PASSWORD `
    -i /docker-entrypoint-initdb.d/11_hard_reset_schema.sql
```

---

## 3. Ejecución Local sin Docker

Útil para desarrollo rápido con cambios de código frecuentes.

### 3.1. Backend (`votometro-backend/`)

```bash
cd votometro-backend
python -m venv .venv
source .venv/bin/activate              # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Crear `local.settings.json` (usar `secrets/local.settings.json` como base):

```jsonc
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "python",
    "TENANT_ID": "<azure-ad-tenant-id>",
    "MS_CLIENT_ID": "<backend-app-registration-id>",
    "MS_CLIENT_SECRET": "<backend-app-secret>",
    "SQL_CONNECTION_STRING": "Driver={ODBC Driver 18 for SQL Server};Server=tcp:<server>,1433;Database=<db>;Uid=<user>;Pwd=<pass>;Encrypt=yes;",
    "POWER_BI_CLIENT_ID": "<powerbi-app-id>",
    "POWER_BI_CLIENT_SECRET": "<powerbi-app-secret>",
    "POWER_BI_TENANT_ID": "<tenant-id>",
    "POWER_BI_GROUP_ID": "<workspace-id>",
    "POWER_BI_DISABLE_RLS": "1"
  },
  "Host": {
    "CORS": "http://localhost:5173",
    "CORSCredentials": true
  }
}
```

```bash
func start    # → http://localhost:7071/api
```

### 3.2. Frontend (`votometro-frontend/`)

```bash
cd votometro-frontend
pnpm install
```

Crear `votometro-frontend/.env.local`:

```ini
VITE_BACKEND_URL=http://localhost:7071/api
VITE_MSAL_CLIENT_ID=<frontend-app-registration-id>
VITE_MSAL_TENANT_ID=<azure-ad-tenant-id>
VITE_MSAL_REDIRECT_URI=http://localhost:5173
VITE_API_SCOPE=api://<backend-app-registration-id>/access_as_user
```

```bash
pnpm dev        # → http://localhost:5173  (con proxy /api/ a localhost:7071)
pnpm build      # Build de producción
pnpm preview    # Servir build compilado (puerto 8080)
pnpm lint       # ESLint
```

### 3.3. Arranque en paralelo (dos terminales)

```powershell
# Terminal A — Backend
cd votometro-backend; .venv\Scripts\activate; func start

# Terminal B — Frontend
cd votometro-frontend; pnpm dev
```

Abrir `http://localhost:5173`. El proxy Vite redirige automáticamente `/api/*` al backend.

---

## 4. Despliegue en Azure

### 4.1. Backend · Azure Function App

```bash
cd votometro-backend
func azure functionapp publish <FUNCTION_APP_NAME> --python
```

Replicar **todas** las claves de `local.settings.json → Values` en **Configuration → Application settings** del Function App.

### 4.2. Frontend · Azure Static Web Apps

```bash
cd votometro-frontend
pnpm build
swa deploy ./dist --deployment-token <SWA_DEPLOYMENT_TOKEN>
```

Las variables `VITE_*` van en **Configuration → Application settings** de la SWA y en los `secrets` del workflow de GitHub Actions.

**Nota importante:** En Azure, `VITE_BACKEND_URL` debe apuntar a la URL completa del Function App (o al API Management si se usa ese patrón), no a `/api`.

---

## 5. Referencia de Variables de Entorno

### Backend

| Clave | Propósito |
|-------|-----------|
| `TENANT_ID` | Azure AD tenant — validación `iss` JWT |
| `MS_CLIENT_ID` | App registration backend — validación `aud` JWT |
| `MS_CLIENT_SECRET` | Secreto MSAL para Microsoft Graph |
| `SQL_CONNECTION_STRING` | ODBC string Azure SQL |
| `POWER_BI_CLIENT_ID` | App registration Power BI |
| `POWER_BI_CLIENT_SECRET` | Secreto Power BI |
| `POWER_BI_TENANT_ID` | Tenant Power BI |
| `POWER_BI_GROUP_ID` | Workspace ID |
| `POWER_BI_DISABLE_RLS` | `0` = RLS activo · `1` = RLS desactivado (solo dev) |

### Frontend

| Clave | Propósito |
|-------|-----------|
| `VITE_BACKEND_URL` | URL base del backend (sufijo `/api`) |
| `VITE_MSAL_CLIENT_ID` | App registration frontend |
| `VITE_MSAL_TENANT_ID` | Tenant Azure AD |
| `VITE_MSAL_REDIRECT_URI` | URI de redirección |
| `VITE_API_SCOPE` | Scope que el frontend solicita al backend |

---

## 6. Checklist Pre-Producción

```
Seguridad — BLOQUEANTES
[ ] HAL-01: Añadir decode_token + role=="Admin" en user_functions.py
[ ] HAL-02: Validar que user_id del token == userId del path (anti-IDOR)
[ ] HAL-11: Cambiar POWER_BI_DISABLE_RLS=0 y verificar DAX role GeoScope
[ ] HAL-13: Eliminar exposición del puerto 7071 en docker-compose.yml
[ ] HAL-03: Añadir auth JWT a PUT /api/divipola/upload
[ ] HAL-14: Eliminar exposición del puerto 1433 en docker-compose.yml

Configuración
[ ] VITE_BACKEND_URL apunta a la URL del Function App productivo (no localhost)
[ ] local.settings.json NOT incluido en el zip de deploy
[ ] Todos los secretos rotados (no usar los de desarrollo)
[ ] POWER_BI_DISABLE_RLS=0

Funcionalidad
[ ] Scripts db/init/ ejecutados en orden en Azure SQL
[ ] divipole.csv importado via PUT /api/divipola/upload
[ ] Catálogo Products con seed (Votometro, Audivoto)
[ ] Admin bootstrap ejecutado (04_bootstrap_admin.sql)
[ ] Power BI workspace con rol GeoScope definido en el .pbix
[ ] Service Principal (POWER_BI_CLIENT_ID) asignado a los roles GeoScope y Admin en Power BI

Verificación
[ ] docker compose logs backend | Select-String "Host initialized" (sin "in error")
[ ] GET /api/users-sessions responde 401 sin token
[ ] GET /api/power-bi/<reportId> responde 401 sin token
[ ] Panel de auditoría carga historial de sesiones correctamente
```

---

## 7. Referencias

| Archivo | Usar cuando… |
|---------|-------------|
| `README.md` | Arquitectura completa, esquema DB |
| `ROOT_MEMORY.md` | Reglas de desarrollo, mapa de riesgo activo |
| `AUDITORIA_OWASP_TOP10.md` | Detalle completo de los 19 hallazgos de seguridad |
| `DOCKER.md` | Configuración avanzada de Docker Compose |
| `BACKEND_MEM.md` | Endpoints, use cases y zonas de riesgo |
| `FRONTEND_MEM.md` | SessionContext, hooks, AppRouter |
| `GEO_RLS_DATA_PATH.md` | Flujo de datos para RLS de Power BI |
