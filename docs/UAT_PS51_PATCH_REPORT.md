# UAT PowerShell 5.1 Patch Report

Fecha: 2026-05-15  
Repositorio: `E:\AppsIngenial\Votometro`  
Archivo corregido: `deploy-uat.ps1`

## Alcance

Se corrigio el script de despliegue UAT para ejecutarse desde Windows PowerShell 5.1 sin depender de APIs de PowerShell 7/.NET moderno.

No se ejecuto despliegue real.  
No se ejecuto `az deployment`.  
No se ejecuto `az group create` fuera del script.  
No se modifico ningun recurso Azure.

## Cambios Aplicados

### 1. Compatibilidad Windows PowerShell 5.1

Lineas modificadas: `84-94`.

Se reemplazo:

```powershell
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
```

por una implementacion compatible con .NET Framework:

```powershell
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $rng.GetBytes($bytes)
} finally {
    $rng.Dispose()
}
```

Motivo: `RandomNumberGenerator::Fill()` no existe en Windows PowerShell 5.1 y producia el error:

```text
System.Security.Cryptography.RandomNumberGenerator::Fill not found
```

### 2. Resource Group Idempotente Antes de Infraestructura

Lineas modificadas: `16`, `161-170`.

Se agrego alias explicito:

```powershell
$ResourceGroupName = $Rg
```

Y se reemplazo la consulta fallible con `az group show` por:

```powershell
$rgExists = az group exists --name $ResourceGroupName | ConvertFrom-Json
if (-not $rgExists) {
    Write-Output "[deploy-uat] creando resource group UAT..."
    az group create `
        --name $ResourceGroupName `
        --location $Location `
        --output none
} else {
    Write-Output "[deploy-uat] resource group UAT existente: $ResourceGroupName"
}
```

Motivo: `az group show` falla con `ResourceGroupNotFound` cuando `rg-votometro-uat` aun no existe. `az group exists` devuelve booleano y permite crear el RG antes de cualquier `az deployment group create`.

### 3. Logging De Fases 1/8 a 8/8

Lineas relevantes:

- `121`: provider en registro.
- `124`: provider ya registrado.
- `149`: fase 1/8 providers.
- `176`: fase 2/8 infra-only.
- `216`: fase 3/8 secretos.
- `246`: fase 4/8 docker build + push.
- `367`: fase 5/8 backend deploy.
- `383`: fase 6/8 SQL init.
- `440`: fase 7/8 frontend deploy.
- `455`: fase 8/8 smoke tests.

Tambien se agrego un log no mutable en linea `236` para preparar artefactos SQL temporales antes del build.

### 4. Orden Real Del Flujo UAT

Se ajusto el orden para que la ejecucion coincida con las fases esperadas:

1. Providers.
2. Infra-only.
3. Secrets.
4. Docker build + push.
5. Backend deploy.
6. SQL init.
7. Frontend deploy.
8. Smoke tests.

Antes, la inicializacion SQL estaba ubicada antes del build y producia logs fuera de orden.

## Compatibilidad PS5.1 Confirmada

Validacion ejecutada en Windows PowerShell real del host:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "`$tokens=`$null; `$errors=`$null; [System.Management.Automation.Language.Parser]::ParseFile('deploy-uat.ps1',[ref]`$tokens,[ref]`$errors) | Out-Null; if (`$errors.Count -gt 0) { `$errors | Format-List *; exit 1 }; `$PSVersionTable.PSVersion.ToString(); 'parse-ok'"
```

Resultado:

```text
5.1.26100.7920
parse-ok
```

## ScriptAnalyzer

El host no tiene `Invoke-ScriptAnalyzer` instalado. Para evitar instalar modulos en el perfil local, se ejecuto ScriptAnalyzer en contenedor Docker:

```powershell
docker run --rm -v "${PWD}:/work" -w /work mcr.microsoft.com/powershell:latest pwsh -NoProfile -Command "Set-PSRepository -Name PSGallery -InstallationPolicy Trusted; Install-Module PSScriptAnalyzer -RequiredVersion 1.22.0 -Scope CurrentUser -Force; Import-Module PSScriptAnalyzer -RequiredVersion 1.22.0; Invoke-ScriptAnalyzer -Path /work/deploy-uat.ps1 -Severity Error,Warning | ConvertTo-Json -Depth 5"
```

Resultado: sin errores y sin warnings.

## Validaciones Locales Sin Azure Mutations

Ejecutado:

```powershell
Select-String -Path deploy-uat.ps1 -Pattern "RandomNumberGenerator\]::Fill|az group show|az resource list|az deployment group validate|az group exists|fase [1-8]/8"
```

Resultado:

- No existe `RandomNumberGenerator]::Fill`.
- No existe `az group show`.
- No existe `az resource list`.
- No existe `az deployment group validate`.
- Existe `az group exists` antes de `az deployment group create`.
- Logs de fase presentes.

## Comandos Recomendados Para Reintento

Desde Windows PowerShell 5.1:

```powershell
cd E:\AppsIngenial\Votometro
$PSVersionTable.PSVersion
az account show
docker version
.\deploy-uat.ps1
```

Si la politica de ejecucion bloquea el script:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-uat.ps1
```

## Resultado

`deploy-uat.ps1` queda listo para reintentar UAT desde Windows PowerShell 5.1, creando primero `rg-votometro-uat` si no existe y evitando el fallo de `RandomNumberGenerator::Fill`.
