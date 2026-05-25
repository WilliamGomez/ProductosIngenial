# UAT Fast App Deploy

Este flujo existe para cambios de aplicacion ya sobre una infraestructura UAT creada y estable.

No ejecuta Bicep, no inicializa SQL, no carga `db/init`, no modifica Key Vault y no recrea recursos. Solo compila, publica y actualiza una Container App.

## Script

Archivo:

```powershell
.\deploy-uat-app.ps1
```

## Backend

Usalo cuando cambies codigo Python, Azure Functions, adaptadores, casos de uso o dependencias del backend.

```powershell
.\deploy-uat-app.ps1 -Component backend
```

El script:

- construye `votometro-backend`
- publica `acrvtmingenialuat.azurecr.io/votometro-api:<tag>`
- actualiza solo `ca-votometro-api-uat`
- valida revision activa
- valida `https://ca-votometro-web-uat.../api/health`

## Frontend

Usalo cuando cambies React, Vite, assets, `nginx.conf` o el Dockerfile del frontend.

```powershell
.\deploy-uat-app.ps1 -Component frontend
```

El script:

- construye `votometro-frontend`
- fuerza `VITE_BACKEND_URL=/api`
- toma `VITE_AZURE_CLIENT_ID` y `VITE_AZURE_TENANT_ID` desde `.env` o `secrets/local.settings.json`
- publica `acrvtmingenialuat.azurecr.io/votometro-web:<tag>`
- actualiza solo `ca-votometro-web-uat`
- valida `/` y `/api/health`

## Tag Manual

Para fijar un tag legible:

```powershell
.\deploy-uat-app.ps1 -Component backend -Tag uat-pbi-fix-001
.\deploy-uat-app.ps1 -Component frontend -Tag uat-menu-fix-001
```

Si no indicas `-Tag`, el script genera uno con componente, commit corto y timestamp para evitar cache de Container Apps.

## Reusar Imagen Existente

Si ya publicaste una imagen y solo quieres apuntar la Container App a ese tag:

```powershell
.\deploy-uat-app.ps1 -Component backend -Tag uat-pbi-fix-001 -SkipBuild
```

## Omitir Smoke Tests

Solo para diagnostico:

```powershell
.\deploy-uat-app.ps1 -Component frontend -SkipSmoke
```

## Cuando Usar El Deploy Completo

Usa `.\deploy-uat.ps1` cuando cambies:

- Bicep o infraestructura
- secretos base
- SQL, `db/init` o datos semilla
- Container Apps Environment, ACR, Key Vault, Storage, SQL Server
- configuracion estructural de ingress, escalado o probes

