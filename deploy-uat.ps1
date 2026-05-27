[Diagnostics.CodeAnalysis.SuppressMessageAttribute(
    "PSAvoidUsingWriteHost",
    "",
    Justification = "El requisito operativo UAT solicita mostrar explicitamente el SKU de ACR con Write-Host."
)]
param(
    [string]$Location = $(if ($env:AZURE_LOCATION) { $env:AZURE_LOCATION } else { "eastus2" }),

    [ValidateSet("DbInitData", "Clean")]
    [string]$SqlInitMode = $(if ($env:UAT_SQL_INIT_MODE) { $env:UAT_SQL_INIT_MODE } else { "DbInitData" }),

    [switch]$ForceSqlDataReload
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $Root ".env"
$LocalSettings = Join-Path $Root "secrets\local.settings.json"
$App = "votometro"
$Environment = "uat"
$SqlAdminLogin = "sqluatadmin"
$SqlDb = "sqldb-votometro-uat"
$ExpectedTenantId = "c2d119db-046d-490b-b428-ddef4bbd279a"
$AcrSku = "Standard"

$Rg = "rg-votometro-uat"
$ResourceGroupName = $Rg
$Acr = "acrvtmingenialuat"
$Kv = "kvvtmingenialuat"
$SqlServer = "sql-votometro-uat"
$Storage = "stvtmingenialuat"
$Law = "law-votometro-uat"
$AppIns = "appi-votometro-uat"
$Cae = "cae-votometro-uat"
$Mi = "id-votometro-uat"
$ApiApp = "ca-votometro-api-uat"
$WebApp = "ca-votometro-web-uat"
$FrontDoorId = "8871aa16-7b26-4221-aa83-011466dc3e65"
$PublicWebUrl = "https://plataformas.ingenial-ia.com"
$SqlCmdOid = "__NONE__"
$SqlCmdEmail = "__NONE__"
$script:LastSqlConnectivityError = ""

function Test-RequiredCommand($Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "[deploy-uat] Requerido '$Name' no esta instalado o no esta en PATH."
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
    if ([string]::IsNullOrWhiteSpace($value)) { $value = Get-LocalSettingsValue $Key }
    return $value
}

function ConvertTo-SecretName($Key) {
    return $Key.ToLowerInvariant().Replace("_", "-")
}

function Set-KeyVaultSecretFromConfig {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceKey,
        [string]$TargetName = $null
    )
    if (-not $TargetName) { $TargetName = ConvertTo-SecretName $SourceKey }
    $value = Get-ConfigValue $SourceKey
    if (-not [string]::IsNullOrWhiteSpace($value)) {
        if ($PSCmdlet.ShouldProcess($TargetName, "Set Key Vault secret from local configuration")) {
            az keyvault secret set --vault-name $Kv --name $TargetName --value $value --only-show-errors | Out-Null
            Write-Output "[deploy-uat] secret cargado: $TargetName"
        }
    }
}

function Get-KvSecretUri($Name) {
    return az keyvault secret show --vault-name $Kv --name $Name --query id -o tsv
}

function Get-StrongPassword {
    $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%*-_=+?"
    do {
        $bytes = New-Object byte[] 32
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try {
            $rng.GetBytes($bytes)
        } finally {
            $rng.Dispose()
        }
        $generatedPassword = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
    } until ($generatedPassword -cmatch "[a-z]" -and $generatedPassword -cmatch "[A-Z]" -and $generatedPassword -match "\d" -and $generatedPassword -match "[!@#\$%*\-_=+?]")
    return $generatedPassword
}

function Invoke-SqlFile($FilePath) {
    docker run --rm `
        -v "$($SqlTmp):/work:ro" `
        mcr.microsoft.com/mssql/server:2022-latest `
        /opt/mssql-tools18/bin/sqlcmd `
        -C `
        -S "$SqlServer.database.windows.net" `
        -d $SqlDb `
        -U $SqlAdminLogin `
        -P $SqlAdminPassword `
        -b `
        -v `
        "OID=$SqlCmdOid" `
        "EMAIL=$SqlCmdEmail" `
        -i "/work/$([IO.Path]::GetFileName($FilePath))"
}

function Invoke-SqlScalar($Query) {
    $outputName = "sql-scalar-$([guid]::NewGuid().ToString("N")).txt"
    docker run --rm `
        -v "$($SqlTmp):/work" `
        mcr.microsoft.com/mssql/server:2022-latest `
        /opt/mssql-tools18/bin/sqlcmd `
        -C `
        -S "$SqlServer.database.windows.net" `
        -d $SqlDb `
        -U $SqlAdminLogin `
        -P $SqlAdminPassword `
        -b `
        -Q $Query `
        -h -1 `
        -W `
        -o "/work/$outputName" `
        *> $null

    if ($LASTEXITCODE -ne 0) {
        return ""
    }

    $outputPath = Join-Path $SqlTmp $outputName
    if (-not (Test-Path $outputPath)) {
        return ""
    }

    return ((Get-Content $outputPath -Raw).Trim())
}

function Test-DbInitDataLoaded {
    $query = @"
SET NOCOUNT ON;
IF OBJECT_ID(N'dbo.Uat_Seed_History', N'U') IS NOT NULL
   AND EXISTS (SELECT 1 FROM dbo.Uat_Seed_History WHERE seed_name = N'db-init-data')
    SELECT 1;
ELSE
    SELECT 0;
"@
    return ((Invoke-SqlScalar $query) -eq "1")
}

function Test-SqlCoreObjectsExist {
    $query = @"
SET NOCOUNT ON;
IF OBJECT_ID(N'dbo.Users', N'U') IS NOT NULL OR OBJECT_ID(N'dbo.Products', N'U') IS NOT NULL
    SELECT 1;
ELSE
    SELECT 0;
"@
    return ((Invoke-SqlScalar $query) -eq "1")
}

function Reset-UatSqlDatabaseForDbInit {
    Write-Output "[deploy-uat] reinicializando $SqlDb para cargar datos desde db/init..."

    az sql db delete `
        --resource-group $Rg `
        --server $SqlServer `
        --name $SqlDb `
        --yes `
        --only-show-errors | Out-Null
    Assert-LastExitCode "[deploy-uat] No se pudo eliminar la base UAT para recarga desde db/init."

    az sql db create `
        --resource-group $Rg `
        --server $SqlServer `
        --name $SqlDb `
        --service-objective S0 `
        --max-size 2GB `
        --collation SQL_Latin1_General_CP1_CI_AS `
        --only-show-errors | Out-Null
    Assert-LastExitCode "[deploy-uat] No se pudo recrear la base UAT para recarga desde db/init."
}

function Write-DbInitSeedMarker {
    $markerPath = Join-Path $SqlTmp "99_uat_seed_marker.sql"
    @"
SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.Uat_Seed_History', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Uat_Seed_History (
        seed_name NVARCHAR(100) NOT NULL CONSTRAINT PK_Uat_Seed_History PRIMARY KEY,
        applied_at DATETIME2(0) NOT NULL CONSTRAINT DF_Uat_Seed_History_applied DEFAULT SYSUTCDATETIME()
    );
END;

MERGE dbo.Uat_Seed_History AS target
USING (SELECT N'db-init-data' AS seed_name) AS source
ON target.seed_name = source.seed_name
WHEN MATCHED THEN UPDATE SET applied_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT (seed_name) VALUES (source.seed_name);
"@ | Set-Content -Path $markerPath -Encoding UTF8

    Invoke-SqlFile $markerPath
    Assert-LastExitCode "[deploy-uat] No se pudo registrar marcador de carga db/init."
}

function Get-SqlRequiredSetOptionsPreamble {
    return @"
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO

"@
}

function ConvertTo-SqlUnicodeLiteral($Value) {
    if ([string]::IsNullOrEmpty($Value)) {
        return "NULL"
    }

    return "N'$($Value.Replace("'", "''"))'"
}

function Invoke-UatAdminSeed($UserId, $Email, $DisplayName) {
    if ([string]::IsNullOrWhiteSpace($UserId)) {
        Write-Output "[deploy-uat] usuario Azure CLI no disponible; se omite seed admin UAT."
        return
    }

    if ([string]::IsNullOrWhiteSpace($Email)) { $Email = $UserId }
    if ([string]::IsNullOrWhiteSpace($DisplayName)) { $DisplayName = $Email }

    $userIdLiteral = ConvertTo-SqlUnicodeLiteral $UserId
    $emailLiteral = ConvertTo-SqlUnicodeLiteral $Email
    $displayNameLiteral = ConvertTo-SqlUnicodeLiteral $DisplayName
    $adminSeedPath = Join-Path $SqlTmp "98_uat_admin_seed.sql"

@"
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;

DECLARE @user_id NVARCHAR(100) = $userIdLiteral;
DECLARE @email NVARCHAR(100) = $emailLiteral;
DECLARE @display_name NVARCHAR(100) = $displayNameLiteral;

IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
    THROW 51000, 'dbo.Users not found; cannot seed UAT admin user.', 1;

IF EXISTS (SELECT 1 FROM dbo.Users WHERE user_id = @user_id)
BEGIN
    UPDATE dbo.Users
       SET email = @email,
           display_name = @display_name,
           enable = 1,
           role = N'Admin'
     WHERE user_id = @user_id;
END
ELSE
BEGIN
    INSERT INTO dbo.Users (
        user_id,
        email,
        display_name,
        enable,
        department,
        phone,
        role,
        created_at,
        type_person,
        type_dni,
        identity_document,
        reference,
        reference2,
        personal_email
    )
    VALUES (
        @user_id,
        @email,
        @display_name,
        1,
        N'UAT',
        NULL,
        N'Admin',
        SYSUTCDATETIME(),
        N'UAT',
        NULL,
        NULL,
        N'UAT deploy seed',
        NULL,
        @email
    );
END;

IF OBJECT_ID(N'dbo.UpsertUserProducts', N'P') IS NOT NULL
BEGIN
    DECLARE @products NVARCHAR(MAX) = N'[{"name":"Votometro","contract_duration":1,"duration_unit":"months","expiration":null,"amount_cop":0,"enable":true,"zones":[{"cod_dep":"05","cod_mun":null,"enable":true}]},{"name":"Audivoto","contract_duration":1,"duration_unit":"months","expiration":null,"amount_cop":0,"enable":true,"zones":[{"cod_dep":"05","cod_mun":null,"enable":true}]}]';

    EXEC dbo.UpsertUserProducts @user_id = @user_id, @products_json = @products;
END;

PRINT '[deploy-uat] Admin UAT seeded.';
"@ | Set-Content -Path $adminSeedPath -Encoding UTF8

    Invoke-SqlFile $adminSeedPath
    Assert-LastExitCode "[deploy-uat] Fallo seed del usuario admin UAT."
}

function Test-SqlConnectivity {
    $output = docker run --rm `
        mcr.microsoft.com/mssql/server:2022-latest `
        /opt/mssql-tools18/bin/sqlcmd `
        -C `
        -S "$SqlServer.database.windows.net" `
        -d $SqlDb `
        -U $SqlAdminLogin `
        -P $SqlAdminPassword `
        -b `
        -Q "SET NOCOUNT ON; SELECT 1;" `
        -h -1 `
        -W `
        -o /dev/null 2>&1

    $script:LastSqlConnectivityError = (($output | Out-String).Trim())
    return ($LASTEXITCODE -eq 0)
}

function Set-SqlFirewallRule($RuleName, $IpAddress) {
    az sql server firewall-rule show `
        --resource-group $Rg `
        --server $SqlServer `
        --name $RuleName `
        --only-show-errors `
        --output none

    if ($LASTEXITCODE -eq 0) {
        Write-Host "[deploy-uat] updating SQL firewall rule $RuleName=$IpAddress..."
        az sql server firewall-rule update `
            --resource-group $Rg `
            --server $SqlServer `
            --name $RuleName `
            --start-ip-address $IpAddress `
            --end-ip-address $IpAddress `
            --only-show-errors `
            --output none
        Assert-LastExitCode "[deploy-uat] No se pudo actualizar la regla SQL $RuleName."
    } else {
        Write-Host "[deploy-uat] creating SQL firewall rule $RuleName=$IpAddress..."
        az sql server firewall-rule create `
            --resource-group $Rg `
            --server $SqlServer `
            --name $RuleName `
            --start-ip-address $IpAddress `
            --end-ip-address $IpAddress `
            --only-show-errors `
            --output none
        Assert-LastExitCode "[deploy-uat] No se pudo crear la regla SQL $RuleName."
    }
}

function Wait-SqlConnectivity {
    $maxAttempts = 18
    $delaySeconds = 20
    $dynamicFirewallIp = ""

    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        Write-Output "[deploy-uat] validando acceso SQL ($attempt/$maxAttempts)..."
        if (Test-SqlConnectivity) {
            Write-Output "[deploy-uat] SQL firewall OK."
            return
        }

        if ($script:LastSqlConnectivityError -match "Client with IP address '([^']+)' is not allowed") {
            $blockedIp = $Matches[1]
            if ($blockedIp -ne $dynamicFirewallIp) {
                $dynamicFirewallIp = $blockedIp
                Set-SqlFirewallRule "ClientIpSqlcmd" $blockedIp
                Write-Output "[deploy-uat] SQL detecto IP cliente $blockedIp; esperando propagacion..."
            }
        }

        if ($attempt -lt $maxAttempts) {
            Start-Sleep -Seconds $delaySeconds
        }
    }

    throw "[deploy-uat] SQL no permitio la conexion despues de $($maxAttempts * $delaySeconds) segundos. Ultimo error: $script:LastSqlConnectivityError"
}

function Register-RequiredProvider($Namespace) {
    $state = ""
    try {
        $state = az provider show --namespace $Namespace --query registrationState -o tsv
    } catch {
        Write-Verbose "Provider $Namespace no se pudo consultar antes del registro."
    }
    if ($state -ne "Registered") {
        Write-Output "[deploy-uat][fase 1/8] registrando provider: $Namespace"
        az provider register --namespace $Namespace --only-show-errors | Out-Null
    } else {
        Write-Output "[deploy-uat][fase 1/8] provider OK: $Namespace"
    }
    do {
        Start-Sleep -Seconds 10
        $state = az provider show --namespace $Namespace --query registrationState -o tsv
    } until ($state -eq "Registered")
}

function Assert-LastExitCode($Message) {
    if ($LASTEXITCODE -ne 0) {
        throw "$Message ExitCode=$LASTEXITCODE"
    }
}

function Ensure-AcrPullRole($PrincipalId, $RegistryId) {
    Write-Output "[deploy-uat] verificando AcrPull para managed identity..."
    $assignmentId = az role assignment list `
        --assignee $PrincipalId `
        --scope $RegistryId `
        --query "[?roleDefinitionName=='AcrPull'].id | [0]" `
        -o tsv

    if ([string]::IsNullOrWhiteSpace($assignmentId)) {
        az role assignment create `
            --assignee $PrincipalId `
            --role "AcrPull" `
            --scope $RegistryId `
            --only-show-errors | Out-Null
        Assert-LastExitCode "[deploy-uat] No se pudo asignar AcrPull al managed identity."
    }

    for ($i = 1; $i -le 18; $i++) {
        $assignmentId = az role assignment list `
            --assignee $PrincipalId `
            --scope $RegistryId `
            --query "[?roleDefinitionName=='AcrPull'].id | [0]" `
            -o tsv
        if (-not [string]::IsNullOrWhiteSpace($assignmentId)) {
            Write-Output "[deploy-uat] AcrPull OK."
            return
        }
        Start-Sleep -Seconds 10
    }

    throw "[deploy-uat] AcrPull no aparece propagado despues de esperar."
}

function Assert-AcrImageTag($Repository, $Tag) {
    $tagFound = az acr repository show-tags `
        --name $Acr `
        --repository $Repository `
        --query "[?@=='$Tag'] | [0]" `
        -o tsv

    if ($tagFound -ne $Tag) {
        throw "[deploy-uat] La imagen $Acr.azurecr.io/$Repository`:$Tag no esta publicada en ACR."
    }
}

function Set-ContainerAppAcrRegistry($AppName) {
    az containerapp registry set `
        --resource-group $Rg `
        --name $AppName `
        --server "$Acr.azurecr.io" `
        --identity $MiId `
        --only-show-errors | Out-Null
    Assert-LastExitCode "[deploy-uat] No se pudo configurar ACR/managed identity en $AppName."
}

function Assert-ContainerAppImage($AppName, $ExpectedImage) {
    $currentImage = ""
    for ($attempt = 1; $attempt -le 12; $attempt++) {
        $currentImage = az containerapp show `
            --resource-group $Rg `
            --name $AppName `
            --query "properties.template.containers[0].image" `
            -o tsv

        if ($currentImage -eq $ExpectedImage) {
            Write-Output "[deploy-uat] $AppName imagen OK: $ExpectedImage"
            return
        }

        if ($currentImage -like "*containerapps-helloworld*" -or $currentImage -like "mcr.microsoft.com/azuredocs/*") {
            throw "[deploy-uat] $AppName sigue usando una imagen demo: $currentImage"
        }

        if ($attempt -lt 12) {
            Write-Output "[deploy-uat] esperando imagen $AppName ($attempt/12). Actual=$currentImage"
            Start-Sleep -Seconds 10
        }
    }

    if ($currentImage -like "*containerapps-helloworld*" -or $currentImage -like "mcr.microsoft.com/azuredocs/*") {
        throw "[deploy-uat] $AppName sigue usando una imagen demo: $currentImage"
    }

    if ($currentImage -ne $ExpectedImage) {
        throw "[deploy-uat] $AppName no quedo con la imagen esperada. Actual=$currentImage Esperada=$ExpectedImage"
    }

    Write-Output "[deploy-uat] $AppName imagen OK: $ExpectedImage"
}

function Set-ContainerAppImage($AppName, $Image) {
    az containerapp update `
        --resource-group $Rg `
        --name $AppName `
        --image $Image `
        --only-show-errors | Out-Null
    Assert-LastExitCode "[deploy-uat] No se pudo fijar la imagen $Image en $AppName."
}

function Invoke-UatSmoke($Url, $Name) {
    $response = Invoke-WebRequest -UseBasicParsing $Url
    if ($response.Content -match "Your Azure Container Apps app is live") {
        throw "[deploy-uat] Smoke $Name recibio el contenedor demo de Microsoft: $Url"
    }
    if ($Url -match "/api/" -and ($response.Content -match "^\s*<!doctype html" -or $response.Content -match "^\s*<html")) {
        throw "[deploy-uat] Smoke $Name recibio HTML SPA en una ruta que debe ser API: $Url"
    }
    return $response
}

function Assert-JsonSmoke($Response, $Name) {
    $contentType = [string]$Response.Headers["Content-Type"]
    if ($contentType -notmatch "^application/json\b") {
        throw "[deploy-uat] Smoke $Name esperaba Content-Type application/json y recibio '$contentType'."
    }
}

Write-Output "[deploy-uat] validando herramientas..."
Test-RequiredCommand az
Test-RequiredCommand docker
az account show | Out-Null
docker info | Out-Null
az config set extension.use_dynamic_install=yes_without_prompt --only-show-errors | Out-Null
az config set extension.dynamic_install_allow_preview=true --only-show-errors | Out-Null
az extension add --name containerapp --upgrade --only-show-errors | Out-Null

$TenantIdCurrent = az account show --query tenantId -o tsv

if ($TenantIdCurrent -ne $ExpectedTenantId) {
    throw "[deploy-uat] Tenant activo '$TenantIdCurrent' no coincide con Ingenial IA SAS '$ExpectedTenantId'."
}
if ($Location -ne "eastus2") {
    throw "[deploy-uat] UAT debe desplegarse en eastus2, no en '$Location'."
}

Write-Output "[deploy-uat] rg=$Rg acr=$Acr kv=$Kv sql=$SqlServer db=$SqlDb location=$Location sqlInitMode=$SqlInitMode"
Write-Host "[deploy-uat] ACR SKU: $AcrSku"
Write-Output "[deploy-uat][fase 1/8] providers"
@(
    "Microsoft.App",
    "Microsoft.ContainerRegistry",
    "Microsoft.KeyVault",
    "Microsoft.OperationalInsights",
    "Microsoft.Insights",
    "Microsoft.Sql",
    "Microsoft.Storage",
    "Microsoft.ManagedIdentity"
) | ForEach-Object { Register-RequiredProvider $_ }

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

$SqlAdminPassword = ""
try { $SqlAdminPassword = az keyvault secret show --vault-name $Kv --name sql-admin-password --query value -o tsv 2>$null } catch { Write-Verbose "sql-admin-password aun no existe en Key Vault." }
if ([string]::IsNullOrWhiteSpace($SqlAdminPassword)) { $SqlAdminPassword = Get-StrongPassword }

Write-Output "[deploy-uat][fase 2/8] infra-only"
try {
    az deployment group create `
        --resource-group $Rg `
        --template-file (Join-Path $Root "infra\uat\main.bicep") `
        --parameters `
            location=$Location `
            acrName=$Acr `
            acrSku=$AcrSku `
            keyVaultName=$Kv `
            sqlServerName=$SqlServer `
            sqlDatabaseName=$SqlDb `
            sqlAdminLogin=$SqlAdminLogin `
            sqlAdminPassword=$SqlAdminPassword `
            logAnalyticsName=$Law `
            appInsightsName=$AppIns `
            containerAppsEnvironmentName=$Cae `
            managedIdentityName=$Mi `
            storageAccountName=$Storage `
        --only-show-errors | Out-Null

    if ($LASTEXITCODE -ne 0) {
        throw "az deployment group create exited with code $LASTEXITCODE."
    }
} catch {
    Write-Error "[deploy-uat] Infra deployment failed before docker build/push, Container Apps deploy or SQL init. $($_.Exception.Message)"
    throw "Infra deployment failed."
}

$KvId = az keyvault show -g $Rg -n $Kv --query id -o tsv
$AcrId = az acr show -g $Rg -n $Acr --query id -o tsv
$MiId = az identity show -g $Rg -n $Mi --query id -o tsv
$MiPrincipalId = az identity show -g $Rg -n $Mi --query principalId -o tsv
try {
    $CurrentUserId = az ad signed-in-user show --query id -o tsv
    az role assignment create --assignee $CurrentUserId --role "Key Vault Secrets Officer" --scope $KvId --only-show-errors 2>$null | Out-Null
} catch { Write-Verbose "No se pudo asignar Key Vault Secrets Officer al usuario actual o ya existia." }
try { az role assignment create --assignee $MiPrincipalId --role "Key Vault Secrets User" --scope $KvId --only-show-errors 2>$null | Out-Null } catch { Write-Verbose "Key Vault Secrets User ya existia o no se pudo crear en este momento." }
Ensure-AcrPullRole $MiPrincipalId $AcrId
Start-Sleep -Seconds 20

az keyvault secret set --vault-name $Kv --name sql-admin-password --value $SqlAdminPassword --only-show-errors | Out-Null
$StorageKey = az storage account keys list -g $Rg -n $Storage --query "[0].value" -o tsv
$AzureWebJobsStorage = "DefaultEndpointsProtocol=https;AccountName=$Storage;AccountKey=$StorageKey;EndpointSuffix=core.windows.net"
az keyvault secret set --vault-name $Kv --name azurewebjobsstorage --value $AzureWebJobsStorage --only-show-errors | Out-Null
$SqlConnectionString = "Driver={ODBC Driver 18 for SQL Server};Server=tcp:$SqlServer.database.windows.net,1433;Database=$SqlDb;Uid=$SqlAdminLogin;Pwd=$SqlAdminPassword;Encrypt=yes;TrustServerCertificate=no;Connection Timeout=30;"
az keyvault secret set --vault-name $Kv --name sql-connection-string --value $SqlConnectionString --only-show-errors | Out-Null
$AppInsightsConn = az monitor app-insights component show -g $Rg -a $AppIns --query connectionString -o tsv
az keyvault secret set --vault-name $Kv --name applicationinsights-connection-string --value $AppInsightsConn --only-show-errors | Out-Null

Write-Output "[deploy-uat][fase 3/8] secretos"
@("TENANT_ID","MS_CLIENT_ID","MS_CLIENT_SECRET","POWER_BI_GROUP_ID","POWER_BI_CLIENT_ID","POWER_BI_CLIENT_SECRET","POWER_BI_TENANT_ID","SMTP_HOST","SMTP_PORT","SMTP_USER","SMTP_PASS","SMTP_FROM_NAME","FRONTEND_URL") |
    ForEach-Object { Set-KeyVaultSecretFromConfig $_ }
az keyvault secret set --vault-name $Kv --name tenant-id --value $ExpectedTenantId --only-show-errors | Out-Null

$PbiDisableRls = "0"
$PbiRole = "GeoScope"
$PbiTenantId = Get-ConfigValue "POWER_BI_TENANT_ID"; if ([string]::IsNullOrWhiteSpace($PbiTenantId)) { $PbiTenantId = $ExpectedTenantId }
$PbiUserField = Get-ConfigValue "POWER_BI_RLS_USERNAME_FIELD"; if ([string]::IsNullOrWhiteSpace($PbiUserField)) { $PbiUserField = "id" }
az keyvault secret set --vault-name $Kv --name power-bi-tenant-id --value $PbiTenantId --only-show-errors | Out-Null
az keyvault secret set --vault-name $Kv --name power-bi-disable-rls --value $PbiDisableRls --only-show-errors | Out-Null
az keyvault secret set --vault-name $Kv --name power-bi-rls-role --value $PbiRole --only-show-errors | Out-Null
az keyvault secret set --vault-name $Kv --name power-bi-rls-username-field --value $PbiUserField --only-show-errors | Out-Null
az keyvault secret set --vault-name $Kv --name local-auth-bypass --value "0" --only-show-errors | Out-Null

Write-Output "[deploy-uat] preparando artefactos SQL UAT ($SqlInitMode)..."
$SqlTmp = Join-Path ([IO.Path]::GetTempPath()) ("votometro-uat-sql-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $SqlTmp | Out-Null

$CleanSqlScripts = @(
    "12_uat_schema_seed.sql",
    "14_mfa_totp.sql",
    "15_product_report_catalog.sql"
)
$DbInitDataScripts = @(
    "01_base_schema.sql",
    "02_geo_rls.sql",
    "03_rbac.sql",
    "04_bootstrap_admin.sql",
    "05_fix_session_sp.sql",
    "06_divipola_migrate.sql",
    "07_divipola_single_master.sql",
    "08_session_audit.sql",
    "09_revoke_session.sql",
    "10_session_detail.sql",
    "11_product_catalog_contracts.sql",
    "13_session_analytics.sql",
    "14_mfa_totp.sql",
    "15_product_report_catalog.sql"
)
$AlwaysSqlPatchScripts = @(
    "14_mfa_totp.sql",
    "15_product_report_catalog.sql"
)

if ($SqlInitMode -eq "DbInitData") {
    $Scripts = $DbInitDataScripts
} else {
    $Scripts = $CleanSqlScripts
}

foreach ($name in $Scripts) {
    $text = Get-Content (Join-Path $Root "db\init\$name") -Raw -Encoding UTF8
    $text = $text.Replace("[sqldb-ingenial-ia]", "[$SqlDb]").Replace("N'sqldb-ingenial-ia'", "N'$SqlDb'")
    if ($name -ne "01_base_schema.sql") {
        $text = (Get-SqlRequiredSetOptionsPreamble) + $text
    }
    Set-Content -Path (Join-Path $SqlTmp $name) -Value $text -Encoding UTF8
}

Write-Output "[deploy-uat][fase 4/8] construyendo y publicando imagenes..."
az acr login -n $Acr --only-show-errors | Out-Null
try { $GitSha = git -C $Root rev-parse --short HEAD } catch { $GitSha = Get-Date -Format "yyyyMMddHHmmss" }
$ApiImage = "$Acr.azurecr.io/$App-api:$Environment-$GitSha"
$WebImage = "$Acr.azurecr.io/$App-web:$Environment-$GitSha"
$ViteClient = Get-ConfigValue "VITE_AZURE_CLIENT_ID"
$ViteTenant = Get-ConfigValue "VITE_AZURE_TENANT_ID"
docker build -t $ApiImage (Join-Path $Root "votometro-backend")
Assert-LastExitCode "[deploy-uat] Fallo docker build backend."
docker build --build-arg VITE_BACKEND_URL=/api --build-arg VITE_AZURE_CLIENT_ID=$ViteClient --build-arg VITE_AZURE_TENANT_ID=$ViteTenant --build-arg VITE_LOCAL_AUTH_BYPASS=false -t $WebImage (Join-Path $Root "votometro-frontend")
Assert-LastExitCode "[deploy-uat] Fallo docker build frontend."
docker push $ApiImage
Assert-LastExitCode "[deploy-uat] Fallo docker push backend."
docker push $WebImage
Assert-LastExitCode "[deploy-uat] Fallo docker push frontend."

Assert-AcrImageTag "$App-api" "$Environment-$GitSha"
Assert-AcrImageTag "$App-web" "$Environment-$GitSha"

$ApiYaml = Join-Path $SqlTmp "api.yaml"
@"
properties:
  configuration:
    activeRevisionsMode: Single
    ingress:
      external: false
      targetPort: 7071
      transport: auto
    registries:
      - server: $Acr.azurecr.io
        identity: $MiId
    secrets:
      - name: azurewebjobsstorage
        keyVaultUrl: $(Get-KvSecretUri "azurewebjobsstorage")
        identity: $MiId
      - name: sql-connection-string
        keyVaultUrl: $(Get-KvSecretUri "sql-connection-string")
        identity: $MiId
      - name: tenant-id
        keyVaultUrl: $(Get-KvSecretUri "tenant-id")
        identity: $MiId
      - name: ms-client-id
        keyVaultUrl: $(Get-KvSecretUri "ms-client-id")
        identity: $MiId
      - name: ms-client-secret
        keyVaultUrl: $(Get-KvSecretUri "ms-client-secret")
        identity: $MiId
      - name: power-bi-group-id
        keyVaultUrl: $(Get-KvSecretUri "power-bi-group-id")
        identity: $MiId
      - name: power-bi-client-id
        keyVaultUrl: $(Get-KvSecretUri "power-bi-client-id")
        identity: $MiId
      - name: power-bi-client-secret
        keyVaultUrl: $(Get-KvSecretUri "power-bi-client-secret")
        identity: $MiId
      - name: power-bi-tenant-id
        keyVaultUrl: $(Get-KvSecretUri "power-bi-tenant-id")
        identity: $MiId
      - name: power-bi-disable-rls
        keyVaultUrl: $(Get-KvSecretUri "power-bi-disable-rls")
        identity: $MiId
      - name: power-bi-rls-role
        keyVaultUrl: $(Get-KvSecretUri "power-bi-rls-role")
        identity: $MiId
      - name: power-bi-rls-username-field
        keyVaultUrl: $(Get-KvSecretUri "power-bi-rls-username-field")
        identity: $MiId
      - name: local-auth-bypass
        keyVaultUrl: $(Get-KvSecretUri "local-auth-bypass")
        identity: $MiId
      - name: appinsights-connection-string
        keyVaultUrl: $(Get-KvSecretUri "applicationinsights-connection-string")
        identity: $MiId
  template:
    containers:
      - name: api
        image: $ApiImage
        env:
          - name: AzureWebJobsStorage
            secretRef: azurewebjobsstorage
          - name: FUNCTIONS_WORKER_RUNTIME
            value: python
          - name: FUNCTIONS_EXTENSION_VERSION
            value: '~4'
          - name: AzureWebJobsFeatureFlags
            value: EnableWorkerIndexing
          - name: ASPNETCORE_URLS
            value: http://+:7071
          - name: WEBSITES_PORT
            value: '7071'
          - name: AzureFunctionsJobHost__Logging__Console__IsEnabled
            value: 'true'
          - name: PYTHONUNBUFFERED
            value: '1'
          - name: SQL_CONNECTION_STRING
            secretRef: sql-connection-string
          - name: APPLICATIONINSIGHTS_CONNECTION_STRING
            secretRef: appinsights-connection-string
          - name: TENANT_ID
            secretRef: tenant-id
          - name: MS_CLIENT_ID
            secretRef: ms-client-id
          - name: MS_CLIENT_SECRET
            secretRef: ms-client-secret
          - name: POWER_BI_GROUP_ID
            secretRef: power-bi-group-id
          - name: POWER_BI_CLIENT_ID
            secretRef: power-bi-client-id
          - name: POWER_BI_CLIENT_SECRET
            secretRef: power-bi-client-secret
          - name: POWER_BI_TENANT_ID
            secretRef: power-bi-tenant-id
          - name: POWER_BI_DISABLE_RLS
            secretRef: power-bi-disable-rls
          - name: POWER_BI_RLS_ROLE
            secretRef: power-bi-rls-role
          - name: POWER_BI_RLS_USERNAME_FIELD
            secretRef: power-bi-rls-username-field
          - name: LOCAL_AUTH_BYPASS
            secretRef: local-auth-bypass
          - name: SMTP_HOST
            value: smtp.office365.com
          - name: SMTP_PORT
            value: '587'
          - name: SMTP_FROM_NAME
            value: Ingenial AI - Votometro
          - name: FRONTEND_URL
            value: https://ca-votometro-web-uat.whitesea-d6c244aa.eastus2.azurecontainerapps.io
        probes:
          - type: Liveness
            httpGet:
              path: /api/health
              port: 7071
          - type: Readiness
            httpGet:
              path: /api/health
              port: 7071
        resources:
          cpu: 1.0
          memory: 2Gi
    scale:
      minReplicas: 1
      maxReplicas: 3
"@ | Set-Content -Path $ApiYaml -Encoding UTF8

Write-Output "[deploy-uat][fase 5/8] backend deploy"
$ApiExists = $false
try {
    az containerapp show -g $Rg -n $ApiApp --only-show-errors | Out-Null
    $ApiExists = $true
} catch {
    $ApiExists = $false
}
if ($ApiExists) {
    Set-ContainerAppAcrRegistry $ApiApp
    az containerapp update -g $Rg -n $ApiApp --yaml $ApiYaml --only-show-errors | Out-Null
    Assert-LastExitCode "[deploy-uat] Fallo update del backend Container App."
    Set-ContainerAppImage $ApiApp $ApiImage
} else {
    az containerapp create -g $Rg -n $ApiApp --environment $Cae --user-assigned $MiId --yaml $ApiYaml --only-show-errors | Out-Null
    Assert-LastExitCode "[deploy-uat] Fallo create del backend Container App."
}
Assert-ContainerAppImage $ApiApp $ApiImage
$ApiFqdn = az containerapp show -g $Rg -n $ApiApp --query properties.configuration.ingress.fqdn -o tsv
if ([string]::IsNullOrWhiteSpace($ApiFqdn)) {
    throw "[deploy-uat] Backend internal FQDN not found."
}
$ApiUpstream = "https://$ApiFqdn"

Write-Output "[deploy-uat][fase 6/8] inicializando SQL UAT limpio..."
$MyIp = (Invoke-RestMethod -Uri "https://api.ipify.org").Trim()

Set-SqlFirewallRule "ClientIp" $MyIp

Wait-SqlConnectivity

$SqlCmdOid = Get-ConfigValue "BOOTSTRAP_ADMIN_OID"
$SqlCmdEmail = Get-ConfigValue "BOOTSTRAP_ADMIN_EMAIL"
if ([string]::IsNullOrWhiteSpace($SqlCmdOid) -or [string]::IsNullOrWhiteSpace($SqlCmdEmail)) {
    try {
        $SqlCmdOid = az ad signed-in-user show --query id -o tsv
        $SqlCmdEmail = az ad signed-in-user show --query userPrincipalName -o tsv
    } catch {
        $SqlCmdOid = "__NONE__"
        $SqlCmdEmail = "__NONE__"
    }
}
if ([string]::IsNullOrWhiteSpace($SqlCmdOid)) { $SqlCmdOid = "__NONE__" }
if ([string]::IsNullOrWhiteSpace($SqlCmdEmail)) { $SqlCmdEmail = "__NONE__" }

if ($SqlInitMode -eq "DbInitData") {
    if ((Test-DbInitDataLoaded) -and -not $ForceSqlDataReload) {
        Write-Output "[deploy-uat] datos db/init ya cargados; se omite recarga. Use -ForceSqlDataReload para recargar."
    } else {
        if ((Test-SqlCoreObjectsExist) -or $ForceSqlDataReload) {
            Write-Output "[deploy-uat] la base UAT tiene schema/datos previos; se recreara para cargar db/init."
            Reset-UatSqlDatabaseForDbInit
            Wait-SqlConnectivity
        }

        foreach ($scriptName in $Scripts) {
            Write-Output "[deploy-uat] ejecutando SQL: $scriptName"
            Invoke-SqlFile (Join-Path $SqlTmp $scriptName)
            Assert-LastExitCode "[deploy-uat] Fallo SQL init UAT en $scriptName."
        }

        Write-DbInitSeedMarker
        Write-Output "[deploy-uat] carga db/init completada."
    }
} else {
    Invoke-SqlFile (Join-Path $SqlTmp "12_uat_schema_seed.sql")
    Assert-LastExitCode "[deploy-uat] Fallo SQL init UAT."
}

foreach ($scriptName in $AlwaysSqlPatchScripts) {
    Write-Output "[deploy-uat] aplicando patch SQL idempotente: $scriptName"
    Invoke-SqlFile (Join-Path $SqlTmp $scriptName)
    Assert-LastExitCode "[deploy-uat] Fallo patch SQL UAT en $scriptName."
}

$SignedUserId = ""
$SignedUserEmail = ""
$SignedUserName = ""
try {
    $SignedUserId = az ad signed-in-user show --query id -o tsv
    $SignedUserEmail = az ad signed-in-user show --query userPrincipalName -o tsv
    $SignedUserName = az ad signed-in-user show --query displayName -o tsv
} catch {
    Write-Verbose "No se pudo resolver usuario Azure CLI para seed UAT."
}
if (-not [string]::IsNullOrWhiteSpace($SignedUserId)) {
    Invoke-UatAdminSeed $SignedUserId $SignedUserEmail $SignedUserName
}

$WebYaml = Join-Path $SqlTmp "web.yaml"
@"
properties:
  configuration:
    activeRevisionsMode: Single
    ingress:
      external: true
      targetPort: 8080
      transport: auto
    registries:
      - server: $Acr.azurecr.io
        identity: $MiId
  template:
    containers:
      - name: web
        image: $WebImage
        env:
          - name: API_UPSTREAM
            value: $ApiUpstream
          - name: FRONTDOOR_ID
            value: $FrontDoorId
          - name: REQUIRE_FRONTDOOR
            value: "true"
        probes:
          - type: Liveness
            httpGet:
              path: /origin-health
              port: 8080
          - type: Readiness
            httpGet:
              path: /origin-health
              port: 8080
        resources:
          cpu: 0.5
          memory: 1Gi
    scale:
      minReplicas: 1
      maxReplicas: 3
"@ | Set-Content -Path $WebYaml -Encoding UTF8

Write-Output "[deploy-uat][fase 7/8] frontend deploy"
$WebExists = $false
try {
    az containerapp show -g $Rg -n $WebApp --only-show-errors | Out-Null
    $WebExists = $true
} catch {
    $WebExists = $false
}
if ($WebExists) {
    Set-ContainerAppAcrRegistry $WebApp
    az containerapp update -g $Rg -n $WebApp --yaml $WebYaml --only-show-errors | Out-Null
    Assert-LastExitCode "[deploy-uat] Fallo update del frontend Container App."
    Set-ContainerAppImage $WebApp $WebImage
} else {
    az containerapp create -g $Rg -n $WebApp --environment $Cae --user-assigned $MiId --yaml $WebYaml --only-show-errors | Out-Null
    Assert-LastExitCode "[deploy-uat] Fallo create del frontend Container App."
}
Assert-ContainerAppImage $WebApp $WebImage

$WebFqdn = az containerapp show -g $Rg -n $WebApp --query properties.configuration.ingress.fqdn -o tsv
if ([string]::IsNullOrWhiteSpace($WebFqdn)) {
    throw "Web FQDN not found."
}
Write-Output "[deploy-uat][fase 8/8] smoke tests..."
$null = Invoke-UatSmoke "$PublicWebUrl/" "frontend-home-frontdoor"
$HealthSmoke = Invoke-UatSmoke "$PublicWebUrl/api/health" "backend-health-frontdoor"
Assert-JsonSmoke $HealthSmoke "backend-health"
if ($HealthSmoke.Content -notmatch "votometro-backend") {
    throw "[deploy-uat] /api/health no parece provenir del backend real. Body=$($HealthSmoke.Content)"
}
$ReadySmoke = Invoke-UatSmoke "$PublicWebUrl/api/health/ready" "backend-ready-frontdoor"
Assert-JsonSmoke $ReadySmoke "backend-ready"
if ($ReadySmoke.Content -notmatch '"status"\s*:\s*"ready"') {
    throw "[deploy-uat] /api/health/ready no reporto estado ready. Body=$($ReadySmoke.Content)"
}

if ($env:UAT_SMOKE_ACCESS_TOKEN -and $env:UAT_SMOKE_SESSION_TOKEN) {
    Invoke-WebRequest `
        -UseBasicParsing `
        -Uri "$PublicWebUrl/api/power-bi/9db4c8ee-d117-4a2e-9a72-9284c6208fa0" `
        -Headers @{
            Authorization = "Bearer $($env:UAT_SMOKE_ACCESS_TOKEN)"
            "X-Session-Token" = $env:UAT_SMOKE_SESSION_TOKEN
        } | Out-Null
} else {
    Write-Output "[deploy-uat] smoke Power BI omitido: define UAT_SMOKE_ACCESS_TOKEN y UAT_SMOKE_SESSION_TOKEN para validacion real end-to-end."
}

Write-Output "[deploy-uat] OK"
Write-Output "Frontend UAT: https://$WebFqdn"
Write-Output "Backend interno: $ApiUpstream"
Write-Output "Resource Group: $Rg"
