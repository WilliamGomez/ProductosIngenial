# UAT Container Apps Root Cause

Fecha: 2026-05-16  
Repositorio: `E:\AppsIngenial\Votometro`

## Alcance

Patch local solamente.  
No se ejecuto deploy.  
No se ejecutaron comandos mutables contra Azure.  
No se modifico backend, frontend ni schema SQL.

Archivos modificados:

- `infra/uat/main.bicep`
- `deploy-uat.ps1`

## Causa Raiz Exacta

### Bug 1: Container Apps inexistentes

La fase 2 de infraestructura creaba recursos base, pero `infra/uat/main.bicep` no declaraba los recursos:

- `ca-votometro-api-uat`
- `ca-votometro-web-uat`

Luego `deploy-uat.ps1` llegaba a:

- linea `367`: `[fase 5/8] backend deploy`
- linea `370`: `az containerapp show -g $Rg -n $ApiApp`
- linea `376`: `az containerapp update -g $Rg -n $ApiApp`
- linea `440`: `[fase 7/8] frontend deploy`
- linea `443`: `az containerapp show -g $Rg -n $WebApp`
- linea `449`: `az containerapp update -g $Rg -n $WebApp`

Si el recurso no existia, Azure respondia `ResourceNotFound`. La solucion correcta es que los Container Apps existan desde IaC.

### Bug 2: SQL init bloqueado por firewall

`sqlcmd` se ejecuta en la funcion `Invoke-SqlFile`:

- linea `105`: `function Invoke-SqlFile($FilePath)`
- linea `421`: `Invoke-SqlFile (Join-Path $SqlTmp "12_uat_schema_seed.sql")`

El servidor SQL no tenia una regla firewall idempotente para la IP publica actual del operador, por eso SQL devolvia:

```text
Client IP ... not allowed
```

### Bug 3: Smoke test con FQDN vacio

El script consultaba:

- linea `491`: `$WebFqdn = az containerapp show ... --query properties.configuration.ingress.fqdn -o tsv`

Pero no validaba si `$WebFqdn` venia vacio antes de ejecutar:

- linea `496`: `Invoke-WebRequest -UseBasicParsing "https://$WebFqdn/"`

Eso podia construir `https:///`.

## Fixes Aplicados

### Fix 1: Container Apps desde Bicep

Se agregaron recursos placeholder en `infra/uat/main.bicep`.

Lineas exactas:

- `143`: `resource api 'Microsoft.App/containerApps@2024-03-01' = {`
- `153`: `managedEnvironmentId: containerAppsEnvironment.id`
- `157`: `external: false`
- `158`: `targetPort: 80`
- `166`: placeholder image `mcr.microsoft.com/azuredocs/containerapps-helloworld:latest`
- `181`: `resource web 'Microsoft.App/containerApps@2024-03-01' = {`
- `191`: `managedEnvironmentId: containerAppsEnvironment.id`
- `195`: `external: true`
- `196`: `targetPort: 80`
- `204`: placeholder image `mcr.microsoft.com/azuredocs/containerapps-helloworld:latest`

Ambos recursos usan la managed identity `id-votometro-uat` y el managed environment `cae-votometro-uat`. El script puede reemplazar despues imagen, secrets, ingress y probes con `az containerapp update --yaml`.

Diff relevante:

```diff
+resource api 'Microsoft.App/containerApps@2024-03-01' = {
+  name: 'ca-votometro-api-uat'
+  location: location
+  identity: {
+    type: 'UserAssigned'
+    userAssignedIdentities: {
+      '${identity.id}': {}
+    }
+  }
+  properties: {
+    managedEnvironmentId: containerAppsEnvironment.id
+    configuration: {
+      activeRevisionsMode: 'Single'
+      ingress: {
+        external: false
+        targetPort: 80
+        transport: 'auto'
+      }
+    }
+    template: {
+      containers: [
+        {
+          name: 'api'
+          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
+          resources: {
+            cpu: json('0.25')
+            memory: '0.5Gi'
+          }
+        }
+      ]
+      scale: {
+        minReplicas: 0
+        maxReplicas: 1
+      }
+    }
+  }
+}
+
+resource web 'Microsoft.App/containerApps@2024-03-01' = {
+  name: 'ca-votometro-web-uat'
+  location: location
+  identity: {
+    type: 'UserAssigned'
+    userAssignedIdentities: {
+      '${identity.id}': {}
+    }
+  }
+  properties: {
+    managedEnvironmentId: containerAppsEnvironment.id
+    configuration: {
+      activeRevisionsMode: 'Single'
+      ingress: {
+        external: true
+        targetPort: 80
+        transport: 'auto'
+      }
+    }
+    template: {
+      containers: [
+        {
+          name: 'web'
+          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
+          resources: {
+            cpu: json('0.25')
+            memory: '0.5Gi'
+          }
+        }
+      ]
+      scale: {
+        minReplicas: 0
+        maxReplicas: 1
+      }
+    }
+  }
+}
```

### Fix 2: Firewall SQL `ClientIp` antes de `sqlcmd`

Se movio la deteccion de IP y la regla firewall a justo antes de `Invoke-SqlFile`.

Lineas exactas:

- `396`: `$MyIp = (Invoke-RestMethod -Uri "https://api.ipify.org").Trim()`
- `401`: `--name ClientIp`
- `407`: `--name ClientIp`
- `415`: `--name ClientIp`
- `421`: `Invoke-SqlFile ...`

Diff relevante:

```diff
 Write-Output "[deploy-uat][fase 6/8] inicializando SQL UAT limpio..."
+$MyIp = (Invoke-RestMethod -Uri "https://api.ipify.org").Trim()
+try {
+    az sql server firewall-rule show `
+        --resource-group $Rg `
+        --server $SqlServer `
+        --name ClientIp `
+        --only-show-errors | Out-Null
+
+    az sql server firewall-rule update `
+        --resource-group $Rg `
+        --server $SqlServer `
+        --name ClientIp `
+        --start-ip-address $MyIp `
+        --end-ip-address $MyIp `
+        --only-show-errors | Out-Null
+} catch {
+    az sql server firewall-rule create `
+        --resource-group $Rg `
+        --server $SqlServer `
+        --name ClientIp `
+        --start-ip-address $MyIp `
+        --end-ip-address $MyIp `
+        --only-show-errors | Out-Null
+}
+
 Invoke-SqlFile (Join-Path $SqlTmp "12_uat_schema_seed.sql")
```

### Fix 3: Validacion de `$WebFqdn`

Lineas exactas:

- `491`: obtiene `$WebFqdn`
- `492-494`: valida vacio y aborta con mensaje claro
- `495`: inicia smoke tests solo con FQDN valido

Diff relevante:

```diff
 $WebFqdn = az containerapp show -g $Rg -n $WebApp --query properties.configuration.ingress.fqdn -o tsv
+if ([string]::IsNullOrWhiteSpace($WebFqdn)) {
+    throw "Web FQDN not found."
+}
 Write-Output "[deploy-uat][fase 8/8] smoke tests..."
```

## Validaciones Ejecutadas

### Bicep Build

```powershell
az bicep build --file .\infra\uat\main.bicep
```

Resultado: OK.

Nota: en esta sesion de Codex se ejecuto con Azure CLI containerizado porque `az` no esta visible en el PATH local de la sesion. No despliega ni toca Azure.

### Bicep Lint

```powershell
az bicep lint --file .\infra\uat\main.bicep
```

Resultado: OK.

### ScriptAnalyzer

```powershell
Invoke-ScriptAnalyzer .\deploy-uat.ps1
```

Resultado: OK, sin errores ni warnings.

Nota: se ejecuto containerizado para no instalar modulos en el host.

### PowerShell 5.1 Parse

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "`$tokens=`$null; `$errors=`$null; [System.Management.Automation.Language.Parser]::ParseFile('deploy-uat.ps1',[ref]`$tokens,[ref]`$errors) | Out-Null; if (`$errors.Count -gt 0) { `$errors | Format-List *; exit 1 }; `$PSVersionTable.PSVersion.ToString(); 'parse-ok'"
```

Resultado:

```text
5.1.26100.7920
parse-ok
```

## Resultado

El siguiente reintento UAT deberia encontrar `ca-votometro-api-uat` y `ca-votometro-web-uat` creados por IaC durante fase 2.  
La fase SQL debe permitir la IP publica actual mediante la regla `ClientIp` antes de ejecutar `sqlcmd`.  
El smoke test ya no construira `https:///`; si no hay FQDN, abortara con `Web FQDN not found.`
