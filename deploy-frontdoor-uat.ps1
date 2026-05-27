[Diagnostics.CodeAnalysis.SuppressMessageAttribute(
    "PSAvoidUsingWriteHost",
    "",
    Justification = "Script operativo de borde Azure Front Door UAT con fases visibles."
)]
param(
    [switch]$UpdateEntraRedirectUris,
    [switch]$UpdateBackendFrontendUrl,
    [switch]$SkipDnsValidationWait
)

$ErrorActionPreference = "Stop"

$SubscriptionId = "2c956f90-7b98-4d3d-9af9-5c28158644a8"
$TenantId = "c2d119db-046d-490b-b428-ddef4bbd279a"
$Rg = "rg-votometro-uat"
$Location = "global"

$FrontendContainerApp = "ca-votometro-web-uat"
$BackendContainerApp = "ca-votometro-api-uat"
$FrontendAppRegistrationClientId = "51ddd54e-2de6-4faf-8181-9dbddbbe72fa"
$PublicHostName = "plataformas.ingenial-ia.com"
$PublicUrl = "https://$PublicHostName"

$AfdProfile = "afd-votometro-uat"
$AfdEndpoint = "afd-votometro-uat"
$OriginGroup = "og-votometro-web-uat"
$Origin = "origin-aca-web-uat"
$Route = "route-votometro-web-uat"
$CustomDomain = "plataformas-ingenial-ia-com"
$WafPolicy = "wafvotometrouat"
$SecurityPolicy = "sp-votometro-uat"

function Assert-LastExitCode($Message) {
    if ($LASTEXITCODE -ne 0) {
        throw "$Message ExitCode=$LASTEXITCODE"
    }
}

function Test-RequiredCommand($Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "[frontdoor-uat] Requerido '$Name' no esta instalado o no esta en PATH."
    }
}

function Invoke-AzJson($Arguments) {
    $output = & az @Arguments --output json
    Assert-LastExitCode "[frontdoor-uat] Fallo comando az $($Arguments -join ' ')"
    if ([string]::IsNullOrWhiteSpace($output)) {
        return $null
    }
    return $output | ConvertFrom-Json
}

function Test-AzResourceExists($Arguments) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & az @Arguments --only-show-errors --output none 2>&1 | Out-Null
        return ($LASTEXITCODE -eq 0)
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
}

function Register-Provider($Namespace) {
    $state = (& az provider show --namespace $Namespace --query registrationState -o tsv 2>$null)
    if ($LASTEXITCODE -ne 0 -or $state -ne "Registered") {
        Write-Host "[frontdoor-uat] registrando provider $Namespace..."
        az provider register --namespace $Namespace --only-show-errors --output none
        Assert-LastExitCode "[frontdoor-uat] No se pudo registrar provider $Namespace."
    }

    for ($i = 1; $i -le 30; $i++) {
        $state = az provider show --namespace $Namespace --query registrationState -o tsv
        if ($state -eq "Registered") {
            Write-Host "[frontdoor-uat] provider OK: $Namespace"
            return
        }
        Write-Host "[frontdoor-uat] esperando provider $Namespace ($i/30)..."
        Start-Sleep -Seconds 10
    }

    throw "[frontdoor-uat] Provider $Namespace no llego a Registered."
}

function Get-ContainerApp($Name) {
    $url = "https://management.azure.com/subscriptions/$SubscriptionId/resourceGroups/$Rg/providers/Microsoft.App/containerApps/$($Name)?api-version=2024-03-01"
    return Invoke-AzJson @("rest", "--method", "get", "--url", $url)
}

function Ensure-WafPolicy {
    Write-Host "[frontdoor-uat] creando/actualizando WAF policy $WafPolicy via ARM REST..."

    $policyId = "/subscriptions/$SubscriptionId/resourceGroups/$Rg/providers/Microsoft.Network/frontdoorWebApplicationFirewallPolicies/$WafPolicy"
    $wafPayload = @{
        location = "Global"
        sku = @{
            name = "Premium_AzureFrontDoor"
        }
        properties = @{
            policySettings = @{
                enabledState = "Enabled"
                mode = "Prevention"
                requestBodyCheck = "Enabled"
                customBlockResponseStatusCode = 429
            }
            customRules = @{
                rules = @(
                    @{
                        name = "RateLimitPerIp"
                        enabledState = "Enabled"
                        priority = 100
                        ruleType = "RateLimitRule"
                        rateLimitDurationInMinutes = 1
                        rateLimitThreshold = 300
                        matchConditions = @(
                            @{
                                matchVariable = "RequestUri"
                                operator = "BeginsWith"
                                negateCondition = $false
                                matchValue = @("/")
                                transforms = @()
                            }
                        )
                        action = "Block"
                    },
                    @{
                        name = "RateLimitSessionApi"
                        enabledState = "Enabled"
                        priority = 110
                        ruleType = "RateLimitRule"
                        rateLimitDurationInMinutes = 1
                        rateLimitThreshold = 30
                        matchConditions = @(
                            @{
                                matchVariable = "RequestUri"
                                operator = "Contains"
                                negateCondition = $false
                                matchValue = @("/api/session")
                                transforms = @("Lowercase")
                            }
                        )
                        action = "Block"
                    },
                    @{
                        name = "BlockScannerUserAgents"
                        enabledState = "Enabled"
                        priority = 120
                        ruleType = "MatchRule"
                        matchConditions = @(
                            @{
                                matchVariable = "RequestHeader"
                                selector = "User-Agent"
                                operator = "RegEx"
                                negateCondition = $false
                                matchValue = @(".*(sqlmap|nikto|nmap|acunetix|nessus|dirbuster|gobuster|wpscan).*")
                                transforms = @("Lowercase")
                            }
                        )
                        action = "Block"
                    }
                )
            }
            managedRules = @{
                managedRuleSets = @(
                    @{
                        ruleSetType = "Microsoft_DefaultRuleSet"
                        ruleSetVersion = "2.1"
                        ruleSetAction = "Block"
                    },
                    @{
                        ruleSetType = "Microsoft_BotManagerRuleSet"
                        ruleSetVersion = "1.0"
                        ruleSetAction = "Block"
                    }
                )
            }
        }
    }

    $payloadPath = Join-Path $env:TEMP "votometro-waf-policy-$([guid]::NewGuid().ToString('N')).json"
    $wafPayload | ConvertTo-Json -Depth 20 | Set-Content -Path $payloadPath -Encoding UTF8

    try {
        az rest `
            --method put `
            --url "https://management.azure.com$($policyId)?api-version=2022-05-01" `
            --body "@$payloadPath" `
            --only-show-errors `
            --output none
        Assert-LastExitCode "[frontdoor-uat] No se pudo crear/actualizar WAF policy via ARM REST."
    } finally {
        Remove-Item -LiteralPath $payloadPath -Force -ErrorAction SilentlyContinue
    }

    return $policyId
}

function Ensure-EntraRedirectUris {
    $app = Invoke-AzJson @("ad", "app", "show", "--id", $FrontendAppRegistrationClientId)
    $current = @()
    if ($app.spa -and $app.spa.redirectUris) {
        $current = @($app.spa.redirectUris)
    }

    $required = @(
        $PublicUrl,
        "$PublicUrl/login"
    )

    $merged = @($current + $required | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
    $changed = ($merged.Count -ne $current.Count)
    if (-not $changed) {
        foreach ($uri in $required) {
            if ($current -notcontains $uri) { $changed = $true }
        }
    }

    if ($changed) {
        Write-Host "[frontdoor-uat] actualizando redirect URIs SPA de Entra ID..."
        $appObjectId = $app.id
        $tempJson = [System.IO.Path]::GetTempFileName() + ".json"
        @{ spa = @{ redirectUris = $merged } } | ConvertTo-Json -Compress | Set-Content -Path $tempJson -Encoding UTF8
        try {
            az rest --method PATCH `
                --url "https://graph.microsoft.com/v1.0/applications/$appObjectId" `
                --body "@$tempJson" `
                --headers "Content-Type=application/json" `
                --only-show-errors `
                --output none
        } finally {
            Remove-Item -Path $tempJson -Force -ErrorAction SilentlyContinue
        }
        Assert-LastExitCode "[frontdoor-uat] No se pudieron actualizar redirect URIs SPA."
    } else {
        Write-Host "[frontdoor-uat] redirect URIs SPA ya contienen $PublicUrl"
    }
}

function Ensure-BackendFrontendUrl {
    Write-Host "[frontdoor-uat] actualizando FRONTEND_URL del backend a $PublicUrl..."
    az containerapp update `
        --resource-group $Rg `
        --name $BackendContainerApp `
        --set-env-vars "FRONTEND_URL=$PublicUrl" `
        --only-show-errors `
        --output none
    Assert-LastExitCode "[frontdoor-uat] No se pudo actualizar FRONTEND_URL del backend."
}

Write-Host "[frontdoor-uat] validando herramientas..."
Test-RequiredCommand az

$env:AZURE_EXTENSION_DIR = Join-Path $env:TEMP "azext-votometro-frontdoor"
az config set extension.use_dynamic_install=yes_without_prompt --only-show-errors | Out-Null
az config set extension.dynamic_install_allow_preview=true --only-show-errors | Out-Null
az extension add --name front-door --upgrade --only-show-errors | Out-Null

$account = Invoke-AzJson @("account", "show")
if ($account.id -ne $SubscriptionId) {
    throw "[frontdoor-uat] Subscription activa '$($account.id)' no coincide con '$SubscriptionId'."
}
if ($account.tenantId -ne $TenantId) {
    throw "[frontdoor-uat] Tenant activo '$($account.tenantId)' no coincide con '$TenantId'."
}

Write-Host "[frontdoor-uat][fase 1/7] providers"
Register-Provider "Microsoft.Cdn"
Register-Provider "Microsoft.Network"

Write-Host "[frontdoor-uat][fase 2/7] auditoria ACA"
$web = Get-ContainerApp $FrontendContainerApp
$api = Get-ContainerApp $BackendContainerApp
$webFqdn = [string]$web.properties.configuration.ingress.fqdn
$apiExternal = [bool]$api.properties.configuration.ingress.external
$webExternal = [bool]$web.properties.configuration.ingress.external
$webTargetPort = [int]$web.properties.configuration.ingress.targetPort

if (-not $webExternal) { throw "[frontdoor-uat] El frontend ACA no tiene ingress publico; Front Door no podra usarlo como origin publico." }
if ($apiExternal) { throw "[frontdoor-uat] La API no esta privada. Esperado external=false." }
if ($webTargetPort -ne 8080) { throw "[frontdoor-uat] Frontend targetPort esperado 8080, actual $webTargetPort." }
if ([string]::IsNullOrWhiteSpace($webFqdn)) { throw "[frontdoor-uat] No se encontro FQDN del frontend ACA." }
Write-Host "[frontdoor-uat] origin ACA confirmado: $webFqdn"

Write-Host "[frontdoor-uat][fase 3/7] WAF"
$wafPolicyId = Ensure-WafPolicy

Write-Host "[frontdoor-uat][fase 4/7] Front Door Premium"
if (-not (Test-AzResourceExists @("afd", "profile", "show", "--resource-group", $Rg, "--profile-name", $AfdProfile))) {
    az afd profile create --resource-group $Rg --profile-name $AfdProfile --sku Premium_AzureFrontDoor --only-show-errors --output none
    Assert-LastExitCode "[frontdoor-uat] No se pudo crear AFD profile."
} else {
    Write-Host "[frontdoor-uat] AFD profile existente: $AfdProfile"
}

if (-not (Test-AzResourceExists @("afd", "endpoint", "show", "--resource-group", $Rg, "--profile-name", $AfdProfile, "--endpoint-name", $AfdEndpoint))) {
    az afd endpoint create --resource-group $Rg --profile-name $AfdProfile --endpoint-name $AfdEndpoint --enabled-state Enabled --only-show-errors --output none
    Assert-LastExitCode "[frontdoor-uat] No se pudo crear AFD endpoint."
} else {
    Write-Host "[frontdoor-uat] AFD endpoint existente: $AfdEndpoint"
}

if (-not (Test-AzResourceExists @("afd", "origin-group", "show", "--resource-group", $Rg, "--profile-name", $AfdProfile, "--origin-group-name", $OriginGroup))) {
    az afd origin-group create `
        --resource-group $Rg `
        --profile-name $AfdProfile `
        --origin-group-name $OriginGroup `
        --probe-request-type GET `
        --probe-protocol Https `
        --probe-path "/" `
        --probe-interval-in-seconds 60 `
        --sample-size 4 `
        --successful-samples-required 3 `
        --additional-latency-in-milliseconds 50 `
        --only-show-errors `
        --output none
    Assert-LastExitCode "[frontdoor-uat] No se pudo crear origin group."
} else {
    Write-Host "[frontdoor-uat] origin group existente: $OriginGroup"
}

if (-not (Test-AzResourceExists @("afd", "origin", "show", "--resource-group", $Rg, "--profile-name", $AfdProfile, "--origin-group-name", $OriginGroup, "--origin-name", $Origin))) {
    az afd origin create `
        --resource-group $Rg `
        --profile-name $AfdProfile `
        --origin-group-name $OriginGroup `
        --origin-name $Origin `
        --host-name $webFqdn `
        --origin-host-header $webFqdn `
        --http-port 80 `
        --https-port 443 `
        --priority 1 `
        --weight 1000 `
        --enabled-state Enabled `
        --only-show-errors `
        --output none
    Assert-LastExitCode "[frontdoor-uat] No se pudo crear origin."
} else {
    Write-Host "[frontdoor-uat] origin existente: $Origin"
}

if (-not (Test-AzResourceExists @("afd", "route", "show", "--resource-group", $Rg, "--profile-name", $AfdProfile, "--endpoint-name", $AfdEndpoint, "--route-name", $Route))) {
    az afd route create `
        --resource-group $Rg `
        --profile-name $AfdProfile `
        --endpoint-name $AfdEndpoint `
        --route-name $Route `
        --origin-group $OriginGroup `
        --supported-protocols Http Https `
        --patterns-to-match "/*" `
        --forwarding-protocol HttpsOnly `
        --https-redirect Enabled `
        --link-to-default-domain Enabled `
        --enabled-state Enabled `
        --only-show-errors `
        --output none
    Assert-LastExitCode "[frontdoor-uat] No se pudo crear route."
} else {
    Write-Host "[frontdoor-uat] route existente: $Route"
}

$endpointHostName = az afd endpoint show --resource-group $Rg --profile-name $AfdProfile --endpoint-name $AfdEndpoint --query hostName -o tsv
Assert-LastExitCode "[frontdoor-uat] No se pudo resolver hostName del endpoint AFD."

Write-Host "[frontdoor-uat][fase 5/7] dominio custom"
if (-not (Test-AzResourceExists @("afd", "custom-domain", "show", "--resource-group", $Rg, "--profile-name", $AfdProfile, "--custom-domain-name", $CustomDomain))) {
    az afd custom-domain create `
        --resource-group $Rg `
        --profile-name $AfdProfile `
        --custom-domain-name $CustomDomain `
        --host-name $PublicHostName `
        --minimum-tls-version TLS12 `
        --certificate-type ManagedCertificate `
        --only-show-errors `
        --output none
    Assert-LastExitCode "[frontdoor-uat] No se pudo crear custom domain."
} else {
    Write-Host "[frontdoor-uat] custom domain existente: $CustomDomain"
}

$customDomainInfo = Invoke-AzJson @("afd", "custom-domain", "show", "--resource-group", $Rg, "--profile-name", $AfdProfile, "--custom-domain-name", $CustomDomain)
$validationToken = [string]$customDomainInfo.validationProperties.validationToken
if ([string]::IsNullOrWhiteSpace($validationToken)) {
    $validationToken = [string]$customDomainInfo.properties.validationProperties.validationToken
}
$domainValidationState = [string]$customDomainInfo.domainValidationState
if ([string]::IsNullOrWhiteSpace($domainValidationState)) {
    $domainValidationState = [string]$customDomainInfo.properties.domainValidationState
}
$domainDeploymentStatus = [string]$customDomainInfo.deploymentStatus
if ([string]::IsNullOrWhiteSpace($domainDeploymentStatus)) {
    $domainDeploymentStatus = [string]$customDomainInfo.properties.deploymentStatus
}
$customDomainId = [string]$customDomainInfo.id
$endpointId = az afd endpoint show --resource-group $Rg --profile-name $AfdProfile --endpoint-name $AfdEndpoint --query id -o tsv

Write-Host ""
Write-Host "[frontdoor-uat] Estado dominio custom: validation=$domainValidationState deployment=$domainDeploymentStatus"
Write-Host "[frontdoor-uat] DNS requerido:"
Write-Host "  CNAME $PublicHostName -> $endpointHostName"
if (-not [string]::IsNullOrWhiteSpace($validationToken)) {
    Write-Host "  TXT   _dnsauth.plataformas.ingenial-ia.com -> $validationToken"
} else {
    Write-Host "  TXT   validacion no requerida o ya aprobada."
}
Write-Host ""

if (-not $SkipDnsValidationWait) {
    Write-Host "[frontdoor-uat] validando DNS CNAME..."
    $dnsOk = $false
    for ($i = 1; $i -le 30; $i++) {
        try {
            $cname = Resolve-DnsName $PublicHostName -Type CNAME -ErrorAction Stop | Select-Object -First 1
            if ($cname.NameHost -eq $endpointHostName) {
                $dnsOk = $true
                break
            }
        } catch {
            Write-Verbose "DNS CNAME aun no disponible."
        }
        Write-Host "[frontdoor-uat] esperando CNAME $PublicHostName ($i/30)..."
        Start-Sleep -Seconds 20
    }
    if (-not $dnsOk) {
        Write-Host "[frontdoor-uat] DNS no apunta aun a Front Door; se omite asociacion de custom domain hasta que propague."
    }
}

Write-Host "[frontdoor-uat][fase 6/7] WAF security policy"
az afd security-policy create `
    --resource-group $Rg `
    --profile-name $AfdProfile `
    --security-policy-name $SecurityPolicy `
    --domains $endpointId `
    --waf-policy $wafPolicyId `
    --only-show-errors `
    --output none 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[frontdoor-uat] security policy default domain ya existe o no pudo recrearse; continuando."
}

$canAssociateCustomDomain = $false
try {
    $cname = Resolve-DnsName $PublicHostName -Type CNAME -ErrorAction Stop | Select-Object -First 1
    $canAssociateCustomDomain = ($cname.NameHost -eq $endpointHostName)
} catch {
    $canAssociateCustomDomain = $false
}

if ($canAssociateCustomDomain) {
    Write-Host "[frontdoor-uat] asociando dominio custom a route y WAF..."
    az afd route update `
        --resource-group $Rg `
        --profile-name $AfdProfile `
        --endpoint-name $AfdEndpoint `
        --route-name $Route `
        --custom-domains $CustomDomain `
        --link-to-default-domain Enabled `
        --only-show-errors `
        --output none
    Assert-LastExitCode "[frontdoor-uat] No se pudo asociar custom domain a route."

    try {
        az afd security-policy create `
            --resource-group $Rg `
            --profile-name $AfdProfile `
            --security-policy-name "$SecurityPolicy-custom" `
            --domains $customDomainId `
            --waf-policy $wafPolicyId `
            --only-show-errors `
            --output none 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[frontdoor-uat] security policy custom domain ya existe o no pudo recrearse; continuando."
        }
    } catch {
        Write-Host "[frontdoor-uat] security policy custom domain ya existe o no pudo recrearse; continuando."
    }
}

$routeInfo = Invoke-AzJson @("afd", "route", "show", "--resource-group", $Rg, "--profile-name", $AfdProfile, "--endpoint-name", $AfdEndpoint, "--route-name", $Route)
$customDomainRouteState = "not-associated"
foreach ($domain in @($routeInfo.customDomains)) {
    if ($domain.id -eq $customDomainId) {
        $customDomainRouteState = "associated-isActive-$($domain.isActive)"
    }
}
Write-Host "[frontdoor-uat] Estado route custom domain: $customDomainRouteState"

$customDomainInfo = Invoke-AzJson @("afd", "custom-domain", "show", "--resource-group", $Rg, "--profile-name", $AfdProfile, "--custom-domain-name", $CustomDomain)
$domainValidationState = [string]$customDomainInfo.domainValidationState
if ([string]::IsNullOrWhiteSpace($domainValidationState)) {
    $domainValidationState = [string]$customDomainInfo.properties.domainValidationState
}
if ($domainValidationState -ne "Approved") {
    Write-Host "[frontdoor-uat] Dominio custom aun no aprobado por Azure Front Door. Mientras este en '$domainValidationState', $PublicUrl puede mostrar 'Page not found'."
    Write-Host "[frontdoor-uat] Espera propagacion/validacion y vuelve a ejecutar este script."
} else {
    $domainDeploymentStatus = [string]$customDomainInfo.deploymentStatus
    if ([string]::IsNullOrWhiteSpace($domainDeploymentStatus)) {
        $domainDeploymentStatus = [string]$customDomainInfo.properties.deploymentStatus
    }

    if ($domainDeploymentStatus -ne "Succeeded") {
        Write-Host "[frontdoor-uat] dominio aprobado; esperando publicacion del certificado/ruta en Front Door..."
        for ($i = 1; $i -le 30; $i++) {
            $customDomainInfo = Invoke-AzJson @("afd", "custom-domain", "show", "--resource-group", $Rg, "--profile-name", $AfdProfile, "--custom-domain-name", $CustomDomain)
            $domainDeploymentStatus = [string]$customDomainInfo.deploymentStatus
            if ([string]::IsNullOrWhiteSpace($domainDeploymentStatus)) {
                $domainDeploymentStatus = [string]$customDomainInfo.properties.deploymentStatus
            }

            Write-Host "[frontdoor-uat] esperando deployment custom domain ($i/30): $domainDeploymentStatus"
            if ($domainDeploymentStatus -eq "Succeeded") {
                break
            }
            Start-Sleep -Seconds 30
        }

        if ($domainDeploymentStatus -ne "Succeeded") {
            throw "[frontdoor-uat] El dominio custom esta aprobado, pero Front Door no termino de publicarlo. Estado=$domainDeploymentStatus"
        }
    }
}

if ($UpdateEntraRedirectUris) {
    Write-Host "[frontdoor-uat][fase 7/7] Entra redirect URIs"
    Ensure-EntraRedirectUris
}

if ($UpdateBackendFrontendUrl) {
    Ensure-BackendFrontendUrl
}

Write-Host ""
Write-Host "[frontdoor-uat] Smoke tests sugeridos despues de DNS/certificado:"
Write-Host "  Invoke-WebRequest -UseBasicParsing https://$PublicHostName/"
Write-Host "  Invoke-WebRequest -UseBasicParsing https://$PublicHostName/api/health"
Write-Host "  Invoke-WebRequest -UseBasicParsing https://$PublicHostName/votometro"
Write-Host ""
Write-Host "[frontdoor-uat] Front Door default endpoint: https://$endpointHostName"
Write-Host "[frontdoor-uat] Custom domain objetivo: $PublicUrl"
Write-Host "[frontdoor-uat] OK"
