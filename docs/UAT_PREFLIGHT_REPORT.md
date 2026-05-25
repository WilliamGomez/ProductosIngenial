# UAT Pre-flight Validation Report

Fecha: 2026-05-15  
Repositorio: `E:\AppsIngenial\Votometro`  
Alcance: validacion local de artefactos UAT sin despliegue ni mutacion de recursos Azure.

## Resumen Ejecutivo

La pre-flight validation de los artefactos UAT fue completada correctamente. No se ejecuto `az deployment`, `az containerapp`, ni ningun comando que cree o modifique recursos en Azure.

Se validaron los artefactos de infraestructura, scripts de despliegue, Dockerfiles, runtime local de contenedores, endpoints de salud y passthrough nginx hacia `/api`.

Resultado final: no quedan blockers tecnicos pendientes antes de iniciar el despliegue UAT. Se corrigieron automaticamente tres problemas detectados durante la validacion.

## Validaciones Ejecutadas

| Area | Validacion | Resultado |
| --- | --- | --- |
| Bicep | `az bicep build --file infra/uat/main.bicep` usando Azure CLI containerizada | PASS |
| Bicep | `az bicep lint --file infra/uat/main.bicep` usando Azure CLI containerizada | PASS |
| Bash | `bash -n deploy-uat.sh` usando imagen `bash:5` | PASS |
| PowerShell | `Invoke-ScriptAnalyzer` sobre `deploy-uat.ps1` usando PowerShell containerizado | PASS |
| Backend Docker | Build local de `votometro-backend/Dockerfile` | PASS |
| Frontend Docker | Build local de `votometro-frontend/Dockerfile` | PASS |
| Backend runtime | Contenedor Azure Functions levantado localmente | PASS |
| Frontend runtime | Contenedor nginx levantado localmente | PASS |
| Backend health | `GET http://localhost:18071/api/health` | PASS, HTTP 200 |
| Nginx passthrough | `GET http://localhost:18080/api/health` | PASS, HTTP 200 |
| Key Vault refs | Validacion de referencias en scripts contra secretos detectados | PASS |

## Puertos Reales Detectados

### Backend

Imagen: `votometro-api:uat-preflight`

- Runtime: Azure Functions Python container.
- Puerto expuesto por imagen: `7071/tcp`.
- Comando de arranque detectado: `/opt/startup/start_nonappservice.sh`.
- Ruta de salud disponible: `/api/health`.
- Ruta de readiness disponible: `/api/health/ready`.

Mapeo usado en pre-flight:

```text
localhost:18071 -> container:7071
```

### Frontend

Imagen: `votometro-web:uat-preflight`

- Runtime: nginx.
- Puerto expuesto por imagen: `8080/tcp`.
- Entrypoint detectado: `/docker-entrypoint.sh`.
- Comando: `nginx -g 'daemon off;'`.
- Passthrough API configurado via `API_UPSTREAM`.

Mapeo usado en pre-flight:

```text
localhost:18080 -> container:8080
```

## Health Checks

### Backend `/api/health`

Resultado:

```json
{
  "status": "ok",
  "service": "votometro-backend",
  "runtime": "azure-functions-python"
}
```

HTTP status: `200`.

### Frontend nginx `/api/health`

Resultado: proxy nginx hacia backend funcionando correctamente.

HTTP status: `200`.

### Backend `/api/health/ready`

Resultado esperado en pre-flight local: `503`, porque no se levanto una instancia SQL Server real y se uso una cadena dummy de baja latencia.

Esto no bloquea el despliegue UAT. En Azure debe pasar cuando `SQL_CONNECTION_STRING` apunte a Azure SQL UAT y el esquema este inicializado.

## Key Vault References

Referencias detectadas en `deploy-uat.sh` y `deploy-uat.ps1`:

```text
applicationinsights-connection-string
azurewebjobsstorage
ms-client-id
ms-client-secret
power-bi-client-id
power-bi-client-secret
power-bi-disable-rls
power-bi-group-id
power-bi-rls-role
power-bi-rls-username-field
power-bi-tenant-id
sql-connection-string
tenant-id
```

Resultado:

```text
missing_refs: []
```

Nota: las referencias Key Vault se generan en los manifiestos YAML de Container Apps dentro de los scripts de despliegue. `infra/uat/main.bicep` crea la infraestructura base y el Key Vault, pero no contiene las referencias runtime de Container Apps.

## Correcciones Aplicadas

### 1. Filtro de envsubst de nginx

Archivo: `votometro-frontend/Dockerfile`

Problema: `NGINX_ENVSUBST_FILTER` estaba definido con una expresion que hacia fallar el entrypoint oficial de nginx durante el reemplazo de variables.

Correccion aplicada:

```dockerfile
ENV API_UPSTREAM=http://backend:7071 \
    NGINX_ENVSUBST_FILTER=^API_UPSTREAM$
```

### 2. Header CSP multilinea invalido

Archivo: `votometro-frontend/nginx.conf`

Problema: el header `Content-Security-Policy` estaba definido en varias lineas dentro de una cadena. nginx lo servia con saltos de linea invalidos y clientes estrictos reportaban errores de cabecera.

Correccion aplicada: el CSP quedo en una sola linea valida.

### 3. Warnings de ScriptAnalyzer

Archivo: `deploy-uat.ps1`

Problemas corregidos:

- Bloques `catch` vacios.
- Uso de variable automatica `$pwd`.
- Uso de verbo no aprobado en funcion PowerShell.
- Uso de `Write-Host`.
- Advertencia de `ShouldProcess` en funcion que escribe secretos.
- Redireccion susceptible a interpretacion ambigua.

Resultado final: `Invoke-ScriptAnalyzer` no reporta errores ni warnings.

## Blockers Pendientes

No quedan blockers pendientes detectados por la pre-flight local.

## Riesgos Residuales Antes de Azure

1. La validacion de readiness completa requiere Azure SQL UAT real y `SQL_CONNECTION_STRING` valido.
2. No se ejecuto smoke test real de Power BI token porque requiere autenticacion, sesion activa, secretos cargados y conectividad con Microsoft Power BI.
3. No se ejecuto inicializacion SQL contra Azure SQL por restriccion explicita de no tocar Azure.
4. El build frontend emite una advertencia no bloqueante de Vite por chunk superior a 500 kB.
5. El host local no tiene instalados nativamente `az`, `bicep`, `pwsh` ni `git`; las validaciones se ejecutaron mediante contenedores Docker. Para ejecutar los scripts de despliegue desde esta maquina, Azure CLI y Docker deben estar instalados y autenticados.

## Comandos Relevantes Usados

```powershell
docker run --rm -v "${PWD}:/work" -w /work mcr.microsoft.com/azure-cli:latest az bicep build --file infra/uat/main.bicep
docker run --rm -v "${PWD}:/work" -w /work mcr.microsoft.com/azure-cli:latest az bicep lint --file infra/uat/main.bicep
docker run --rm -v "${PWD}:/work" -w /work bash:5 bash -n deploy-uat.sh
docker build -t votometro-api:uat-preflight votometro-backend
docker build --build-arg VITE_BACKEND_URL=/api --build-arg VITE_AZURE_CLIENT_ID=00000000-0000-0000-0000-000000000000 --build-arg VITE_AZURE_TENANT_ID=00000000-0000-0000-0000-000000000000 --build-arg VITE_LOCAL_AUTH_BYPASS=false -t votometro-web:uat-preflight votometro-frontend
```

## Veredicto

Los artefactos UAT estan listos para pasar a la fase de despliegue controlado en Azure.

Antes del despliegue real, confirmar:

- Azure CLI autenticado contra la subscription correcta.
- Permisos para crear Resource Group, ACR, Key Vault, Azure SQL, Container Apps, Log Analytics y Application Insights.
- Secretos reales disponibles para Power BI, SQL y autenticacion.
- Confirmacion explicita para ejecutar el despliegue UAT.
