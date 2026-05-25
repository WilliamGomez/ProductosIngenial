# Votometro UAT Deployment

## Auditoria tecnica previa

El backend real del repositorio no es FastAPI: es Azure Functions Python 3.11 ejecutado en contenedor desde `votometro-backend/Dockerfile`.

La imagen base verificada es:

- `mcr.microsoft.com/azure-functions/python:4-python3.11-slim`
- `Cmd=["/opt/startup/start_nonappservice.sh"]`
- `Entrypoint=null`
- `HOST_VERSION=4.1036.2`
- `FUNCTIONS_WORKER_RUNTIME_VERSION=3.11`
- puerto base por defecto: `ASPNETCORE_URLS=http://+:80`

El Dockerfile del proyecto expone `7071`, y Docker Compose fuerza `ASPNETCORE_URLS=http://+:7071`. Por eso el despliegue UAT fija explícitamente `ASPNETCORE_URLS=http://+:7071` y configura el target port de la API en `7071`.

No existia un endpoint de health dedicado. Se agregaron:

- `GET /api/health`: liveness sin dependencia externa.
- `GET /api/health/ready`: readiness con `SELECT 1` contra Azure SQL.

La integracion Power BI usa `msal.ConfidentialClientApplication` por llamada. Esto activa cache en memoria solo dentro del proceso actual; bajo escalamiento horizontal cada replica tiene su propio cache y puede pedir tokens de service principal independientemente. Es compatible con UAT, pero puede aumentar llamadas a Entra ID durante cold starts o scale out. No hay cache distribuido.

## Arquitectura UAT

Todos los recursos UAT son nuevos y aislados. No se toca ningun Resource Group, ACR, SQL, Key Vault, Container App, App Service, networking ni configuracion Power BI existente.

Naming deterministico:

- Resource Group: `rg-votometro-uat`
- ACR: `acrvotuat` + hash de subscription
- Key Vault: `kv-vot-uat-` + hash de subscription
- SQL Server: `sql-vot-uat-` + hash de subscription
- SQL DB: `sqldb-votometro-uat`
- Storage Account: `stvotuat` + hash de subscription
- Log Analytics: `log-votometro-uat`
- Application Insights: `appi-votometro-uat`
- Container Apps Environment: `cae-votometro-uat`
- Managed Identity: `id-votometro-uat`
- API Container App: `ca-votometro-api-uat`
- Web Container App: `ca-votometro-web-uat`

El hash de subscription son los primeros 8 caracteres SHA-256 de la subscription id. Esto evita colisiones globales en ACR, Key Vault, SQL Server y Storage Account sin perder determinismo.

## Flujo de red

El frontend es el unico Container App con ingress publico.

El backend queda con ingress interno. El nginx del frontend mantiene el patron same-origin:

```text
Browser -> https://ca-votometro-web-uat.../
Browser -> https://ca-votometro-web-uat.../api/*
nginx   -> https://ca-votometro-api-uat.internal.../api/*
```

Esto evita CORS y evita exponer directamente la API al navegador.

## Secretos

Los scripts leen secretos desde:

- `.env`
- `secrets/local.settings.json`

Luego cargan los valores en Key Vault UAT y configuran los Container Apps con secret references via Managed Identity.

Secretos cargados:

- `sql-connection-string`
- `sql-admin-password`
- `azurewebjobsstorage`
- `applicationinsights-connection-string`
- `tenant-id`
- `ms-client-id`
- `ms-client-secret`
- `power-bi-group-id`
- `power-bi-client-id`
- `power-bi-client-secret`
- `power-bi-disable-rls`
- `power-bi-rls-role`
- `power-bi-rls-username-field`
- SMTP si existe en `.env` o `local.settings.json`

Los valores `VITE_*` no son secretos. Se embeben en el bundle del frontend.

## SQL UAT

La inicializacion UAT no ejecuta hard reset y no carga datos historicos.

El script genera una copia temporal de `db/init/01_base_schema.sql`:

- Reemplaza el nombre de base por `sqldb-votometro-uat`.
- Elimina las lineas `INSERT [dbo]...` para evitar cargar usuarios, sesiones, IPs, tokens o PII del dump.
- Aplica el DDL base solo si `dbo.Users` no existe.

Luego aplica en orden los scripts idempotentes:

- `02_geo_rls.sql`
- `03_rbac.sql`
- `03_refactor_products_zones.sql`
- `04_bootstrap_admin.sql`
- `05_fix_session_sp.sql`
- `06_divipola_migrate.sql`
- `07_divipola_single_master.sql`
- `08_session_audit.sql`
- `09_revoke_session.sql`
- `10_session_detail.sql`
- `11_product_catalog_contracts.sql`

Se excluye explicitamente `11_hard_reset_schema.sql`.

Si `divipole.csv` existe y `GET /api/divipola/status` devuelve `0`, el deploy carga el catalogo usando `POST /api/divipola/upload?mode=replace`.

## Power BI

La API mantiene los report ids actuales:

- Votometro: `9db4c8ee-d117-4a2e-9a72-9284c6208fa0`
- Audivoto: `f88c2708-aa49-449a-974a-8e7f7ee972fb`

El service principal, workspace y secretos Power BI se copian desde la configuracion local hacia Key Vault UAT.

`POWER_BI_DISABLE_RLS` queda en `1` si no existe valor explicito, respetando el estado actual del codigo: no se envia `EffectiveIdentity` cuando RLS esta desactivado.

## Deploy

Linux/macOS:

```bash
./deploy-uat.sh
```

Windows PowerShell:

```powershell
.\deploy-uat.ps1
```

Ambos scripts:

1. Validan Azure CLI, login y Docker.
2. Crean o reutilizan recursos UAT.
3. Crean Key Vault y cargan secretos detectados.
4. Generan password SQL fuerte y lo guardan en Key Vault.
5. Construyen imagenes backend/frontend.
6. Publican imagenes en ACR UAT.
7. Despliegan Container Apps con Managed Identity.
8. Configuran liveness/readiness probes.
9. Inicializan SQL sin datos historicos.
10. Ejecutan smoke tests.

## Smoke tests

Los scripts validan:

- `GET /`
- `GET /api/health`
- `GET /api/health/ready`

El smoke test de Power BI requiere un Bearer token real de Entra ID y una sesion activa, por lo que queda documentado para validacion funcional posterior:

La URL exacta del frontend UAT la imprimen los scripts al finalizar. La prueba debe llamar `GET /api/power-bi/9db4c8ee-d117-4a2e-9a72-9284c6208fa0` sobre esa URL, enviando `Authorization: Bearer` con un access token valido y `X-Session-Token` con una sesion activa.

## Costos estimados

Configuracion UAT de bajo costo:

- Azure SQL Basic
- ACR Basic
- Container Apps Consumption
- Log Analytics 30 dias
- Application Insights workspace-based
- Key Vault Standard
- Storage LRS

El costo real depende de trafico, logs y replicas. Para UAT con poco trafico, los componentes con mayor costo relativo seran Azure SQL y Log Analytics.

## Troubleshooting

Si la API no levanta:

- Revisar que `ASPNETCORE_URLS=http://+:7071` exista en el Container App.
- Revisar `AzureWebJobsStorage`.
- Revisar logs en Application Insights o Log Analytics.

Si readiness falla:

- Verificar `sql-connection-string` en Key Vault.
- Verificar firewall de Azure SQL.
- Verificar que `dbo.Users` exista.

Si el frontend carga pero las llamadas API fallan:

- Verificar `API_UPSTREAM` en el Container App web.
- Verificar que la API tenga ingress interno y FQDN asignado.
- Verificar que nginx haya renderizado `/etc/nginx/conf.d/default.conf`.

Si Power BI falla:

- Revisar `POWER_BI_GROUP_ID`.
- Revisar `POWER_BI_CLIENT_ID` y `POWER_BI_CLIENT_SECRET`.
- Revisar permisos del service principal en el workspace.
- Revisar el `detail` devuelto por `GET /api/power-bi/{report_id}`.

## Rollback

UAT esta aislado. El rollback no toca ningun ambiente existente:

```bash
az group delete --name rg-votometro-uat
```

Usar con cuidado: elimina todos los recursos UAT.
