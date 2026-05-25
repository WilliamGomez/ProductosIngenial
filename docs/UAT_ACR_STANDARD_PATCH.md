# UAT ACR Standard Patch

Fecha: 2026-05-16  
Repositorio: `E:\AppsIngenial\Votometro`

## Alcance

Se corrigio la dependencia de SKU `Basic` en Azure Container Registry para UAT.  
No se ejecuto despliegue.  
No se ejecuto `az deployment`.  
No se ejecutaron comandos mutables contra Azure.

## Archivos Modificados

- `infra/uat/main.bicep`
- `deploy-uat.ps1`

## Cambios Aplicados

### `infra/uat/main.bicep`

Lineas relevantes: `9-15`, `75`, `181-184`.

Se agrego el parametro permitido para ACR:

```bicep
@allowed([
  'Standard'
  'Premium'
])
@description('Azure Container Registry SKU for UAT. Basic is intentionally not allowed.')
param acrSku string = 'Standard'
```

Y el recurso ACR ahora usa:

```bicep
sku: {
  name: acrSku
}
```

Resultado: `Basic` ya no es una opcion valida para ACR. El valor default es `Standard`.

Despues del primer reintento real, Azure confirmo que un ACR `Standard` creado por CLI funciona en `eastus2`, pero el despliegue Bicep seguia fallando sobre `acrvtmingenialuat`. La causa probable estaba en las politicas avanzadas declaradas en el recurso ACR (`quarantinePolicy`, `trustPolicy`, `retentionPolicy`), no en el SKU base.

Se simplifico el recurso ACR a propiedades compatibles con `Standard`:

```bicep
resource acr 'Microsoft.ContainerRegistry/registries@2023-01-01-preview' = {
  name: acrName
  location: location
  sku: {
    name: acrSku
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}
```

Adicionalmente, para cumplir el objetivo de eliminar completamente la dependencia de `Basic`, la base de datos Azure SQL UAT se movio de `Basic` a `Standard/S0`:

```bicep
sku: {
  name: 'S0'
  tier: 'Standard'
  capacity: 10
}
```

### `deploy-uat.ps1`

Lineas relevantes: `1-6`, `19`, `155`, `184-209`.

Se definio SKU fijo:

```powershell
$AcrSku = "Standard"
```

Se agrego log operativo solicitado:

```powershell
Write-Host "[deploy-uat] ACR SKU: $AcrSku"
```

Se pasa el parametro al despliegue Bicep:

```powershell
acrSku=$AcrSku
```

Se agrego abort temprano si falla infraestructura:

```powershell
try {
    az deployment group create ...
    if ($LASTEXITCODE -ne 0) {
        throw "az deployment group create exited with code $LASTEXITCODE."
    }
} catch {
    Write-Error "[deploy-uat] Infra deployment failed before docker build/push, Container Apps deploy or SQL init. $($_.Exception.Message)"
    throw "Infra deployment failed."
}
```

Resultado: si `az deployment group create` falla, el script no continua con:

- `docker build`
- `docker push`
- Container Apps
- SQL init
- frontend deploy
- smoke tests

### ScriptAnalyzer y `Write-Host`

Como el requerimiento operativo pide explicitamente:

```powershell
Write-Host "[deploy-uat] ACR SKU: $AcrSku"
```

se agrego una supresion puntual de `PSAvoidUsingWriteHost` al inicio del script. No se suprimen otras reglas.

## Validaciones Ejecutadas

### Windows PowerShell 5.1 Parse

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "`$tokens=`$null; `$errors=`$null; [System.Management.Automation.Language.Parser]::ParseFile('deploy-uat.ps1',[ref]`$tokens,[ref]`$errors) | Out-Null; if (`$errors.Count -gt 0) { `$errors | Format-List *; exit 1 }; `$PSVersionTable.PSVersion.ToString(); 'parse-ok'"
```

Resultado:

```text
5.1.26100.7920
parse-ok
```

### ScriptAnalyzer

El comando nativo no esta disponible en esta sesion de Codex:

```text
Invoke-ScriptAnalyzer-not-installed
```

Para validar sin instalar modulos ni modificar el host, se ejecuto en contenedor:

```powershell
docker run --rm -v "${PWD}:/work" -w /work mcr.microsoft.com/powershell:latest pwsh -NoProfile -Command "Set-PSRepository -Name PSGallery -InstallationPolicy Trusted; Install-Module PSScriptAnalyzer -RequiredVersion 1.22.0 -Scope CurrentUser -Force; Import-Module PSScriptAnalyzer -RequiredVersion 1.22.0; Invoke-ScriptAnalyzer -Path /work/deploy-uat.ps1 -Severity Error,Warning | ConvertTo-Json -Depth 5"
```

Resultado: sin errores y sin warnings.

### Bicep Build

El comando nativo `az` no esta visible en el PATH de esta sesion de Codex, por lo que se valido con Azure CLI containerizado, sin desplegar:

```powershell
docker run --rm -v "${PWD}:/work" -w /work mcr.microsoft.com/azure-cli:latest az bicep build --file infra/uat/main.bicep
```

Resultado: OK.

## Verificaciones De Seguridad

Se confirmo que:

- No existe `az acr list-skus`.
- No existe logica de autodeteccion de SKU.
- `acrSku` queda fijo en `Standard`.
- Bicep no permite `Basic` para ACR.
- El fallo de infraestructura aborta antes de cualquier build, push, SQL init o Container Apps.

## Comandos Recomendados Para Reintento

Desde tu consola real de Windows PowerShell 5.1, donde Azure CLI si esta disponible:

```powershell
cd E:\AppsIngenial\Votometro
Invoke-ScriptAnalyzer .\deploy-uat.ps1
az bicep build --file .\infra\uat\main.bicep
.\deploy-uat.ps1
```

Si no tienes ScriptAnalyzer instalado localmente:

```powershell
Install-Module PSScriptAnalyzer -Scope CurrentUser
Invoke-ScriptAnalyzer .\deploy-uat.ps1
```

## Resultado

El deployment UAT queda preparado para reintento usando ACR `Standard`, sin depender de `Basic` ni de `az acr list-skus`.
