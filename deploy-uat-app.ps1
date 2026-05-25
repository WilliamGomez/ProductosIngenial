[Diagnostics.CodeAnalysis.SuppressMessageAttribute(
    "PSAvoidUsingWriteHost",
    "",
    Justification = "Este script operativo muestra fases de deploy rapido UAT."
)]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("backend", "frontend")]
    [string]$Component,

    [string]$Tag = "",

    [switch]$SkipBuild,

    [switch]$SkipSmoke
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $Root ".env"
$LocalSettings = Join-Path $Root "secrets\local.settings.json"

$Rg = "rg-votometro-uat"
$Acr = "acrvtmingenialuat"
$ApiApp = "ca-votometro-api-uat"
$WebApp = "ca-votometro-web-uat"
$ApiRepository = "votometro-api"
$WebRepository = "votometro-web"
$ApiHealthPath = "/api/health"

function Test-RequiredCommand($Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "[deploy-uat-app] Requerido '$Name' no esta instalado o no esta en PATH."
    }
}

function Assert-LastExitCode($Message) {
    if ($LASTEXITCODE -ne 0) {
        throw "$Message ExitCode=$LASTEXITCODE"
    }
}

function Get-DotEnvValue($Key) {
    if (-not (Test-Path $EnvFile)) { return "" }
    foreach ($line in Get-Content $EnvFile) {
        if ($line -match "^\s*#") { continue }
        if ($line -match "^$([regex]::Escape($Key))=(.*)$") {
            return $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return ""
}

function Get-LocalSettingsValue($Key) {
    if (-not (Test-Path $LocalSettings)) { return "" }
    $json = Get-Content $LocalSettings -Raw | ConvertFrom-Json
    $prop = $json.Values.PSObject.Properties[$Key]
    if ($prop) { return [string]$prop.Value }
    return ""
}

function Get-ConfigValue($Key) {
    $value = Get-DotEnvValue $Key
    if ([string]::IsNullOrWhiteSpace($value)) {
        $value = Get-LocalSettingsValue $Key
    }
    return $value
}

function Get-GitSha {
    try {
        $sha = git -C $Root rev-parse --short HEAD 2>$null
        if (-not [string]::IsNullOrWhiteSpace($sha)) {
            return $sha.Trim()
        }
    } catch {
        Write-Verbose "No se pudo resolver git sha."
    }
    return "nogit"
}

function New-DefaultTag($ComponentName) {
    $timestamp = Get-Date -Format "yyyyMMddHHmmss"
    return "uat-$ComponentName-$(Get-GitSha)-$timestamp".ToLowerInvariant()
}

function Get-ContainerAppImage($AppName) {
    return az containerapp show `
        --resource-group $Rg `
        --name $AppName `
        --query "properties.template.containers[0].image" `
        -o tsv
}

function Wait-ContainerAppImage($AppName, $ExpectedImage) {
    for ($attempt = 1; $attempt -le 18; $attempt++) {
        $currentImage = Get-ContainerAppImage $AppName
        if ($currentImage -eq $ExpectedImage) {
            Write-Host "[deploy-uat-app] $AppName imagen OK: $ExpectedImage"
            return
        }
        Write-Host "[deploy-uat-app] esperando imagen $AppName ($attempt/18). Actual=$currentImage"
        Start-Sleep -Seconds 10
    }
    throw "[deploy-uat-app] $AppName no quedo con la imagen esperada: $ExpectedImage"
}

function Wait-ContainerAppHealthy($AppName) {
    for ($attempt = 1; $attempt -le 24; $attempt++) {
        $revisions = az containerapp revision list `
            --resource-group $Rg `
            --name $AppName `
            -o json | ConvertFrom-Json
        $candidate = $null

        foreach ($revision in @($revisions)) {
            $active = [string]$revision.active
            if ([string]::IsNullOrWhiteSpace($active) -and $revision.properties) {
                $active = [string]$revision.properties.active
            }

            $trafficWeight = [string]$revision.trafficWeight
            if ([string]::IsNullOrWhiteSpace($trafficWeight) -and $revision.properties) {
                $trafficWeight = [string]$revision.properties.trafficWeight
            }

            $provisioningState = [string]$revision.provisioningState
            if ([string]::IsNullOrWhiteSpace($provisioningState) -and $revision.properties) {
                $provisioningState = [string]$revision.properties.provisioningState
            }

            $runningState = [string]$revision.runningState
            if ([string]::IsNullOrWhiteSpace($runningState) -and $revision.properties) {
                $runningState = [string]$revision.properties.runningState
            }

            $healthState = [string]$revision.healthState
            if ([string]::IsNullOrWhiteSpace($healthState) -and $revision.properties) {
                $healthState = [string]$revision.properties.healthState
            }

            $replicasText = [string]$revision.replicas
            if ([string]::IsNullOrWhiteSpace($replicasText) -and $revision.properties) {
                $replicasText = [string]$revision.properties.replicas
            }

            $replicas = 0
            if (-not [string]::IsNullOrWhiteSpace($replicasText)) {
                $replicas = [int]$replicasText
            }

            $isRoutable = ($active -eq "True" -or $active -eq "true" -or $trafficWeight -eq "100")
            $isProvisioned = ($provisioningState -eq "Provisioned" -or [string]::IsNullOrWhiteSpace($provisioningState))
            $isRunning = ($runningState -eq "Running" -or [string]::IsNullOrWhiteSpace($runningState))
            $isHealthy = ($healthState -eq "Healthy" -or $healthState -eq "None" -or [string]::IsNullOrWhiteSpace($healthState))
            $hasReplica = ($replicas -ge 1 -or [string]::IsNullOrWhiteSpace($replicasText))

            if ($isRoutable -and $isProvisioned -and $isRunning -and $isHealthy -and $hasReplica) {
                $candidate = @{
                    Name = $revision.name
                    ProvisioningState = $provisioningState
                    RunningState = $runningState
                    HealthState = $healthState
                    Replicas = $replicas
                    TrafficWeight = $trafficWeight
                    Active = $active
                }
                break
            }
        }

        if ($candidate) {
            Write-Host "[deploy-uat-app] revision activa OK: $($candidate.Name) provisioning=$($candidate.ProvisioningState) running=$($candidate.RunningState) health=$($candidate.HealthState) replicas=$($candidate.Replicas) traffic=$($candidate.TrafficWeight) active=$($candidate.Active)"
            return
        }

        Write-Host "[deploy-uat-app] esperando revision saludable $AppName ($attempt/24)..."
        Start-Sleep -Seconds 10
    }

    az containerapp revision list --resource-group $Rg --name $AppName -o table
    throw "[deploy-uat-app] $AppName no llego a revision saludable."
}

function Invoke-Smoke($Url, $Name, [switch]$ExpectJson) {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 30
    if ($response.Content -match "Your Azure Container Apps app is live") {
        throw "[deploy-uat-app] Smoke $Name recibio contenedor demo de Microsoft."
    }
    if ($Url -match "/api/" -and ($response.Content -match "^\s*<!doctype html" -or $response.Content -match "^\s*<html")) {
        throw "[deploy-uat-app] Smoke $Name recibio HTML en una ruta API."
    }
    if ($ExpectJson) {
        $contentType = [string]$response.Headers["Content-Type"]
        if ($contentType -notmatch "^application/json\b") {
            throw "[deploy-uat-app] Smoke $Name esperaba JSON y recibio '$contentType'."
        }
    }
    Write-Host "[deploy-uat-app] smoke OK: $Name status=$($response.StatusCode)"
    return $response
}

Write-Host "[deploy-uat-app] validando herramientas..."
Test-RequiredCommand az
Test-RequiredCommand docker
az account show --only-show-errors | Out-Null
Assert-LastExitCode "[deploy-uat-app] Azure CLI no tiene sesion activa."
docker info | Out-Null
Assert-LastExitCode "[deploy-uat-app] Docker no esta disponible."

$env:AZURE_EXTENSION_DIR = Join-Path $env:TEMP "azext-votometro-aca"
az config set extension.use_dynamic_install=yes_without_prompt --only-show-errors | Out-Null
az config set extension.dynamic_install_allow_preview=true --only-show-errors | Out-Null
az extension add --name containerapp --upgrade --only-show-errors | Out-Null
Assert-LastExitCode "[deploy-uat-app] No se pudo validar/instalar extension containerapp."

$appName = if ($Component -eq "backend") { $ApiApp } else { $WebApp }
$repository = if ($Component -eq "backend") { $ApiRepository } else { $WebRepository }
$contextPath = if ($Component -eq "backend") { Join-Path $Root "votometro-backend" } else { Join-Path $Root "votometro-frontend" }

az group show --name $Rg --only-show-errors | Out-Null
Assert-LastExitCode "[deploy-uat-app] No existe el resource group UAT $Rg. Ejecuta primero .\deploy-uat.ps1."
az acr show --name $Acr --resource-group $Rg --only-show-errors | Out-Null
Assert-LastExitCode "[deploy-uat-app] No existe el ACR UAT $Acr. Ejecuta primero .\deploy-uat.ps1."
az containerapp show --resource-group $Rg --name $appName --only-show-errors | Out-Null
Assert-LastExitCode "[deploy-uat-app] No existe la Container App $appName. Ejecuta primero .\deploy-uat.ps1."

if ([string]::IsNullOrWhiteSpace($Tag)) {
    $Tag = New-DefaultTag $Component
}

$image = "$Acr.azurecr.io/$repository`:$Tag"
Write-Host "[deploy-uat-app] component=$Component app=$appName image=$image"

az acr login --name $Acr --only-show-errors | Out-Null
Assert-LastExitCode "[deploy-uat-app] No se pudo autenticar contra ACR $Acr."

if (-not $SkipBuild) {
    Write-Host "[deploy-uat-app] construyendo imagen $Component..."
    if ($Component -eq "backend") {
        docker build -t $image $contextPath
        Assert-LastExitCode "[deploy-uat-app] Fallo docker build backend."
    } else {
        $viteClient = Get-ConfigValue "VITE_AZURE_CLIENT_ID"
        $viteTenant = Get-ConfigValue "VITE_AZURE_TENANT_ID"
        if ([string]::IsNullOrWhiteSpace($viteClient) -or [string]::IsNullOrWhiteSpace($viteTenant)) {
            throw "[deploy-uat-app] Faltan VITE_AZURE_CLIENT_ID o VITE_AZURE_TENANT_ID en .env/secrets/local.settings.json."
        }
        docker build `
            --build-arg VITE_BACKEND_URL=/api `
            --build-arg VITE_AZURE_CLIENT_ID=$viteClient `
            --build-arg VITE_AZURE_TENANT_ID=$viteTenant `
            --build-arg VITE_LOCAL_AUTH_BYPASS=false `
            -t $image `
            $contextPath
        Assert-LastExitCode "[deploy-uat-app] Fallo docker build frontend."
    }

    Write-Host "[deploy-uat-app] publicando imagen en ACR..."
    docker push $image
    Assert-LastExitCode "[deploy-uat-app] Fallo docker push $Component."
} else {
    Write-Host "[deploy-uat-app] SkipBuild activo: se asume que la imagen ya existe en ACR."
}

Write-Host "[deploy-uat-app] actualizando solo $appName..."
az containerapp update `
    --resource-group $Rg `
    --name $appName `
    --image $image `
    --only-show-errors `
    --output none
Assert-LastExitCode "[deploy-uat-app] Fallo update de $appName."

Wait-ContainerAppImage $appName $image
Wait-ContainerAppHealthy $appName

if (-not $SkipSmoke) {
    $webFqdn = az containerapp show --resource-group $Rg --name $WebApp --query properties.configuration.ingress.fqdn -o tsv
    if ([string]::IsNullOrWhiteSpace($webFqdn)) {
        throw "[deploy-uat-app] No se encontro FQDN del frontend $WebApp."
    }

    if ($Component -eq "frontend") {
        Invoke-Smoke "https://$webFqdn/" "frontend-home" | Out-Null
    }

    $health = Invoke-Smoke "https://$webFqdn$ApiHealthPath" "backend-health-via-frontend" -ExpectJson
    if ($health.Content -notmatch "votometro-backend") {
        throw "[deploy-uat-app] /api/health no parece provenir del backend real. Body=$($health.Content)"
    }
}

Write-Host "[deploy-uat-app] deploy rapido completado."
