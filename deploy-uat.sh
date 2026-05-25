#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT_DIR/.env"
LOCAL_SETTINGS="$ROOT_DIR/secrets/local.settings.json"
LOCATION="${AZURE_LOCATION:-eastus2}"
ENVIRONMENT="uat"
APP="votometro"
SQL_ADMIN_LOGIN="sqluatadmin"
SQL_DB="sqldb-votometro-uat"
EXPECTED_TENANT_ID="c2d119db-046d-490b-b428-ddef4bbd279a"

RG="rg-votometro-uat"
ACR="acrvtmingenialuat"
KV="kvvtmingenialuat"
SQL_SERVER="sql-votometro-uat"
STORAGE="stvtmingenialuat"
LAW="law-votometro-uat"
APPINS="appi-votometro-uat"
CAE="cae-votometro-uat"
MI="id-votometro-uat"
API_APP="ca-votometro-api-uat"
WEB_APP="ca-votometro-web-uat"

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[deploy-uat] ERROR: requerido '$1' no esta instalado o no esta en PATH." >&2
    exit 1
  }
}

env_get() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || return 0
  awk -v k="$key" '
    BEGIN { FS="=" }
    $0 ~ "^[[:space:]]*#" { next }
    $1 == k {
      sub(/^[^=]*=/, "")
      gsub(/^"|"$/, "")
      gsub(/^'\''|'\''$/, "")
      print
      exit
    }
  ' "$ENV_FILE"
}

json_get() {
  local key="$1"
  [[ -f "$LOCAL_SETTINGS" ]] || return 0
  python3 - "$LOCAL_SETTINGS" "$key" <<'PY'
import json, sys
path, key = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8-sig") as fh:
    data = json.load(fh)
value = (data.get("Values") or {}).get(key, "")
print(value if value is not None else "")
PY
}

get_config_value() {
  local key="$1"
  local value
  value="$(env_get "$key")"
  if [[ -z "$value" ]]; then
    value="$(json_get "$key")"
  fi
  printf '%s' "$value"
}

secret_name() {
  echo "$1" | tr '[:upper:]_' '[:lower:]-'
}

kv_secret_uri() {
  local name="$1"
  az keyvault secret show --vault-name "$KV" --name "$name" --query id -o tsv
}

set_kv_secret() {
  local source_key="$1"
  local target_name="${2:-$(secret_name "$source_key")}"
  local value
  value="$(get_config_value "$source_key")"
  if [[ -n "$value" ]]; then
    az keyvault secret set --vault-name "$KV" --name "$target_name" --value "$value" --only-show-errors >/dev/null
    echo "[deploy-uat] secret cargado: $target_name"
  fi
}

run_sql() {
  local file="$1"
  docker run --rm \
    -v "$SQL_TMP:/work:ro" \
    mcr.microsoft.com/mssql/server:2022-latest \
    /opt/mssql-tools18/bin/sqlcmd \
      -C \
      -S "${SQL_SERVER}.database.windows.net" \
      -d "$SQL_DB" \
      -U "$SQL_ADMIN_LOGIN" \
      -P "$SQL_ADMIN_PASSWORD" \
      -b \
      -i "/work/$(basename "$file")"
}

ensure_provider() {
  local namespace="$1"
  local state
  state="$(az provider show --namespace "$namespace" --query registrationState -o tsv 2>/dev/null || true)"
  if [[ "$state" != "Registered" ]]; then
    echo "[deploy-uat][fase 1] registrando provider: $namespace"
    az provider register --namespace "$namespace" --only-show-errors >/dev/null
  else
    echo "[deploy-uat][fase 1] provider OK: $namespace"
  fi
  while true; do
    state="$(az provider show --namespace "$namespace" --query registrationState -o tsv)"
    [[ "$state" == "Registered" ]] && break
    sleep 10
  done
}

echo "[deploy-uat] validando herramientas..."
require az
require docker
require python3
az account show >/dev/null
docker info >/dev/null
az extension add --name containerapp --upgrade --only-show-errors >/dev/null

SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
TENANT_ID_CURRENT="$(az account show --query tenantId -o tsv)"

if [[ "$TENANT_ID_CURRENT" != "$EXPECTED_TENANT_ID" ]]; then
  echo "[deploy-uat] ERROR: tenant activo '$TENANT_ID_CURRENT' no coincide con Ingenial IA SAS '$EXPECTED_TENANT_ID'." >&2
  exit 1
fi

if [[ "$LOCATION" != "eastus2" ]]; then
  echo "[deploy-uat] ERROR: UAT debe desplegarse en eastus2, no en '$LOCATION'." >&2
  exit 1
fi

echo "[deploy-uat] subscription=$SUBSCRIPTION_ID tenant=$TENANT_ID_CURRENT location=$LOCATION"
echo "[deploy-uat] rg=$RG acr=$ACR kv=$KV sql=$SQL_SERVER db=$SQL_DB"

echo "[deploy-uat][fase 1] providers"
for provider in Microsoft.App Microsoft.ContainerRegistry Microsoft.KeyVault Microsoft.OperationalInsights Microsoft.Insights Microsoft.Sql Microsoft.Storage Microsoft.ManagedIdentity; do
  ensure_provider "$provider"
done

if ! az group show --name "$RG" >/dev/null 2>&1; then
  az group create --name "$RG" --location "$LOCATION" --only-show-errors >/dev/null
fi

SQL_ADMIN_PASSWORD="$(az keyvault secret show --vault-name "$KV" --name sql-admin-password --query value -o tsv 2>/dev/null || true)"
if [[ -z "$SQL_ADMIN_PASSWORD" ]]; then
  SQL_ADMIN_PASSWORD="$(python3 - <<'PY'
import secrets, string
alphabet = string.ascii_letters + string.digits + "!@#$%*-_=+?"
while True:
    pwd = "".join(secrets.choice(alphabet) for _ in range(32))
    if any(c.islower() for c in pwd) and any(c.isupper() for c in pwd) and any(c.isdigit() for c in pwd) and any(c in "!@#$%*-_=+?" for c in pwd):
        print(pwd)
        break
PY
)"
fi

echo "[deploy-uat][fase 2] infra-only"
az deployment group create \
  --resource-group "$RG" \
  --template-file "$ROOT_DIR/infra/uat/main.bicep" \
  --parameters \
    location="$LOCATION" \
    acrName="$ACR" \
    keyVaultName="$KV" \
    sqlServerName="$SQL_SERVER" \
    sqlDatabaseName="$SQL_DB" \
    sqlAdminLogin="$SQL_ADMIN_LOGIN" \
    sqlAdminPassword="$SQL_ADMIN_PASSWORD" \
    logAnalyticsName="$LAW" \
    appInsightsName="$APPINS" \
    containerAppsEnvironmentName="$CAE" \
    managedIdentityName="$MI" \
    storageAccountName="$STORAGE" \
  --only-show-errors >/dev/null

KV_ID="$(az keyvault show -g "$RG" -n "$KV" --query id -o tsv)"
ACR_ID="$(az acr show -g "$RG" -n "$ACR" --query id -o tsv)"
MI_ID="$(az identity show -g "$RG" -n "$MI" --query id -o tsv)"
MI_PRINCIPAL_ID="$(az identity show -g "$RG" -n "$MI" --query principalId -o tsv)"
CURRENT_USER_ID="$(az ad signed-in-user show --query id -o tsv 2>/dev/null || true)"

if [[ -n "$CURRENT_USER_ID" ]]; then
  az role assignment create --assignee "$CURRENT_USER_ID" --role "Key Vault Secrets Officer" --scope "$KV_ID" --only-show-errors >/dev/null 2>&1 || true
fi
az role assignment create --assignee "$MI_PRINCIPAL_ID" --role "Key Vault Secrets User" --scope "$KV_ID" --only-show-errors >/dev/null 2>&1 || true
az role assignment create --assignee "$MI_PRINCIPAL_ID" --role "AcrPull" --scope "$ACR_ID" --only-show-errors >/dev/null 2>&1 || true
sleep 20

echo "[deploy-uat][fase 3] secretos"
az keyvault secret set --vault-name "$KV" --name sql-admin-password --value "$SQL_ADMIN_PASSWORD" --only-show-errors >/dev/null

STORAGE_KEY="$(az storage account keys list -g "$RG" -n "$STORAGE" --query '[0].value' -o tsv)"
AZURE_WEBJOBS_STORAGE="DefaultEndpointsProtocol=https;AccountName=${STORAGE};AccountKey=${STORAGE_KEY};EndpointSuffix=core.windows.net"
az keyvault secret set --vault-name "$KV" --name azurewebjobsstorage --value "$AZURE_WEBJOBS_STORAGE" --only-show-errors >/dev/null

SQL_CONNECTION_STRING="Driver={ODBC Driver 18 for SQL Server};Server=tcp:${SQL_SERVER}.database.windows.net,1433;Database=${SQL_DB};Uid=${SQL_ADMIN_LOGIN};Pwd=${SQL_ADMIN_PASSWORD};Encrypt=yes;TrustServerCertificate=no;Connection Timeout=30;"
az keyvault secret set --vault-name "$KV" --name sql-connection-string --value "$SQL_CONNECTION_STRING" --only-show-errors >/dev/null

APPINS_CONN="$(az monitor app-insights component show -g "$RG" -a "$APPINS" --query connectionString -o tsv)"
az keyvault secret set --vault-name "$KV" --name applicationinsights-connection-string --value "$APPINS_CONN" --only-show-errors >/dev/null

for key in TENANT_ID MS_CLIENT_ID MS_CLIENT_SECRET POWER_BI_GROUP_ID POWER_BI_CLIENT_ID POWER_BI_CLIENT_SECRET POWER_BI_TENANT_ID SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_FROM_NAME FRONTEND_URL; do
  set_kv_secret "$key"
done
az keyvault secret set --vault-name "$KV" --name tenant-id --value "$EXPECTED_TENANT_ID" --only-show-errors >/dev/null

PBI_DISABLE_RLS="0"
PBI_RLS_ROLE="GeoScope"
PBI_TENANT_ID="$(get_config_value POWER_BI_TENANT_ID)"; [[ -z "$PBI_TENANT_ID" ]] && PBI_TENANT_ID="$EXPECTED_TENANT_ID"
PBI_RLS_USER_FIELD="$(get_config_value POWER_BI_RLS_USERNAME_FIELD)"; [[ -z "$PBI_RLS_USER_FIELD" ]] && PBI_RLS_USER_FIELD="id"
az keyvault secret set --vault-name "$KV" --name power-bi-tenant-id --value "$PBI_TENANT_ID" --only-show-errors >/dev/null
az keyvault secret set --vault-name "$KV" --name power-bi-disable-rls --value "$PBI_DISABLE_RLS" --only-show-errors >/dev/null
az keyvault secret set --vault-name "$KV" --name power-bi-rls-role --value "$PBI_RLS_ROLE" --only-show-errors >/dev/null
az keyvault secret set --vault-name "$KV" --name power-bi-rls-username-field --value "$PBI_RLS_USER_FIELD" --only-show-errors >/dev/null
az keyvault secret set --vault-name "$KV" --name local-auth-bypass --value "0" --only-show-errors >/dev/null

CLIENT_IP="$(python3 - <<'PY'
from urllib.request import urlopen
print(urlopen("https://api.ipify.org", timeout=10).read().decode().strip())
PY
)"
az sql server firewall-rule create -g "$RG" -s "$SQL_SERVER" -n "deploy-client-${CLIENT_IP//./-}" --start-ip-address "$CLIENT_IP" --end-ip-address "$CLIENT_IP" --only-show-errors >/dev/null || true

echo "[deploy-uat][fase 6] sql init UAT limpio"
SQL_TMP="$(mktemp -d)"
python3 - "$ROOT_DIR" "$SQL_TMP" "$SQL_DB" <<'PY'
from pathlib import Path
import sys
root = Path(sys.argv[1])
out = Path(sys.argv[2])
db = sys.argv[3]
scripts = ["12_uat_schema_seed.sql"]
for name in scripts:
    text = (root / "db" / "init" / name).read_text(encoding="utf-8", errors="replace")
    text = text.replace("[sqldb-ingenial-ia]", f"[{db}]").replace("N'sqldb-ingenial-ia'", f"N'{db}'")
    (out / name).write_text(text, encoding="utf-8")
PY

run_sql "$SQL_TMP/12_uat_schema_seed.sql"

SIGNED_USER_ID="$(az ad signed-in-user show --query id -o tsv 2>/dev/null || true)"
SIGNED_USER_EMAIL="$(az ad signed-in-user show --query userPrincipalName -o tsv 2>/dev/null || true)"
SIGNED_USER_NAME="$(az ad signed-in-user show --query displayName -o tsv 2>/dev/null || true)"
if [[ -n "$SIGNED_USER_ID" ]]; then
  docker run --rm mcr.microsoft.com/mssql/server:2022-latest /opt/mssql-tools18/bin/sqlcmd \
    -C -S "${SQL_SERVER}.database.windows.net" -d "$SQL_DB" -U "$SQL_ADMIN_LOGIN" -P "$SQL_ADMIN_PASSWORD" -b \
    -Q "EXEC dbo.UpsertUatAdminUser @user_id=N'${SIGNED_USER_ID}', @email=N'${SIGNED_USER_EMAIL:-uat-admin@ingenial-ia.com}', @display_name=N'${SIGNED_USER_NAME:-UAT Admin}';"
fi

echo "[deploy-uat][fase 4] docker build + push"
az acr login -n "$ACR" --only-show-errors >/dev/null
GIT_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
API_IMAGE="${ACR}.azurecr.io/${APP}-api:${ENVIRONMENT}-${GIT_SHA}"
WEB_IMAGE="${ACR}.azurecr.io/${APP}-web:${ENVIRONMENT}-${GIT_SHA}"

VITE_AZURE_CLIENT_ID="$(get_config_value VITE_AZURE_CLIENT_ID)"
VITE_AZURE_TENANT_ID="$(get_config_value VITE_AZURE_TENANT_ID)"
docker build -t "$API_IMAGE" "$ROOT_DIR/votometro-backend"
docker build \
  --build-arg VITE_BACKEND_URL=/api \
  --build-arg VITE_AZURE_CLIENT_ID="$VITE_AZURE_CLIENT_ID" \
  --build-arg VITE_AZURE_TENANT_ID="$VITE_AZURE_TENANT_ID" \
  --build-arg VITE_LOCAL_AUTH_BYPASS=false \
  -t "$WEB_IMAGE" "$ROOT_DIR/votometro-frontend"
docker push "$API_IMAGE"
docker push "$WEB_IMAGE"

cat > "$SQL_TMP/api.yaml" <<YAML
properties:
  configuration:
    activeRevisionsMode: Single
    ingress:
      external: false
      targetPort: 7071
      transport: auto
    registries:
      - server: ${ACR}.azurecr.io
        identity: ${MI_ID}
    secrets:
      - name: azurewebjobsstorage
        keyVaultUrl: $(kv_secret_uri azurewebjobsstorage)
        identity: ${MI_ID}
      - name: sql-connection-string
        keyVaultUrl: $(kv_secret_uri sql-connection-string)
        identity: ${MI_ID}
      - name: tenant-id
        keyVaultUrl: $(kv_secret_uri tenant-id)
        identity: ${MI_ID}
      - name: ms-client-id
        keyVaultUrl: $(kv_secret_uri ms-client-id)
        identity: ${MI_ID}
      - name: ms-client-secret
        keyVaultUrl: $(kv_secret_uri ms-client-secret)
        identity: ${MI_ID}
      - name: power-bi-group-id
        keyVaultUrl: $(kv_secret_uri power-bi-group-id)
        identity: ${MI_ID}
      - name: power-bi-client-id
        keyVaultUrl: $(kv_secret_uri power-bi-client-id)
        identity: ${MI_ID}
      - name: power-bi-client-secret
        keyVaultUrl: $(kv_secret_uri power-bi-client-secret)
        identity: ${MI_ID}
      - name: power-bi-tenant-id
        keyVaultUrl: $(kv_secret_uri power-bi-tenant-id)
        identity: ${MI_ID}
      - name: power-bi-disable-rls
        keyVaultUrl: $(kv_secret_uri power-bi-disable-rls)
        identity: ${MI_ID}
      - name: power-bi-rls-role
        keyVaultUrl: $(kv_secret_uri power-bi-rls-role)
        identity: ${MI_ID}
      - name: power-bi-rls-username-field
        keyVaultUrl: $(kv_secret_uri power-bi-rls-username-field)
        identity: ${MI_ID}
      - name: local-auth-bypass
        keyVaultUrl: $(kv_secret_uri local-auth-bypass)
        identity: ${MI_ID}
      - name: appinsights-connection-string
        keyVaultUrl: $(kv_secret_uri applicationinsights-connection-string)
        identity: ${MI_ID}
  template:
    containers:
      - name: api
        image: ${API_IMAGE}
        env:
          - name: AzureWebJobsStorage
            secretRef: azurewebjobsstorage
          - name: FUNCTIONS_WORKER_RUNTIME
            value: python
          - name: AzureFunctionsJobHost__Logging__Console__IsEnabled
            value: "true"
          - name: ASPNETCORE_URLS
            value: http://+:7071
          - name: APPLICATIONINSIGHTS_CONNECTION_STRING
            secretRef: appinsights-connection-string
          - name: SQL_CONNECTION_STRING
            secretRef: sql-connection-string
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
        probes:
          - type: Liveness
            httpGet:
              path: /api/health
              port: 7071
            initialDelaySeconds: 30
            periodSeconds: 30
          - type: Readiness
            httpGet:
              path: /api/health/ready
              port: 7071
            initialDelaySeconds: 30
            periodSeconds: 30
        resources:
          cpu: 1.0
          memory: 2Gi
    scale:
      minReplicas: 1
      maxReplicas: 3
YAML

echo "[deploy-uat][fase 5] backend deploy"
if az containerapp show -g "$RG" -n "$API_APP" >/dev/null 2>&1; then
  az containerapp update -g "$RG" -n "$API_APP" --yaml "$SQL_TMP/api.yaml" --only-show-errors >/dev/null
else
  az containerapp create -g "$RG" -n "$API_APP" --environment "$CAE" --user-assigned "$MI_ID" --yaml "$SQL_TMP/api.yaml" --only-show-errors >/dev/null
fi

API_FQDN="$(az containerapp show -g "$RG" -n "$API_APP" --query properties.configuration.ingress.fqdn -o tsv)"
API_UPSTREAM="https://${API_FQDN}"

cat > "$SQL_TMP/web.yaml" <<YAML
properties:
  configuration:
    activeRevisionsMode: Single
    ingress:
      external: true
      targetPort: 8080
      transport: auto
    registries:
      - server: ${ACR}.azurecr.io
        identity: ${MI_ID}
  template:
    containers:
      - name: web
        image: ${WEB_IMAGE}
        env:
          - name: API_UPSTREAM
            value: ${API_UPSTREAM}
        probes:
          - type: Liveness
            httpGet:
              path: /
              port: 8080
            initialDelaySeconds: 15
            periodSeconds: 30
          - type: Readiness
            httpGet:
              path: /
              port: 8080
            initialDelaySeconds: 15
            periodSeconds: 30
        resources:
          cpu: 0.5
          memory: 1Gi
    scale:
      minReplicas: 1
      maxReplicas: 3
YAML

echo "[deploy-uat][fase 7] frontend deploy"
if az containerapp show -g "$RG" -n "$WEB_APP" >/dev/null 2>&1; then
  az containerapp update -g "$RG" -n "$WEB_APP" --yaml "$SQL_TMP/web.yaml" --only-show-errors >/dev/null
else
  az containerapp create -g "$RG" -n "$WEB_APP" --environment "$CAE" --user-assigned "$MI_ID" --yaml "$SQL_TMP/web.yaml" --only-show-errors >/dev/null
fi

WEB_FQDN="$(az containerapp show -g "$RG" -n "$WEB_APP" --query properties.configuration.ingress.fqdn -o tsv)"

echo "[deploy-uat] cargando DIVIPOLA si el catalogo esta vacio..."
ROWS="$(curl -fsS "https://${WEB_FQDN}/api/divipola/status" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("rows",0))' || echo 0)"
if [[ "$ROWS" == "0" && -f "$ROOT_DIR/divipole.csv" ]]; then
  curl -fsS -X POST -F "file=@${ROOT_DIR}/divipole.csv" "https://${WEB_FQDN}/api/divipola/upload?mode=replace" >/dev/null
fi

echo "[deploy-uat][fase 8] smoke tests"
curl -fsS "https://${WEB_FQDN}/" >/dev/null
curl -fsS "https://${WEB_FQDN}/api/health" >/dev/null
curl -fsS "https://${WEB_FQDN}/api/health/ready" >/dev/null

if [[ -n "${UAT_SMOKE_ACCESS_TOKEN:-}" && -n "${UAT_SMOKE_SESSION_TOKEN:-}" ]]; then
  curl -fsS \
    -H "Authorization: Bearer ${UAT_SMOKE_ACCESS_TOKEN}" \
    -H "X-Session-Token: ${UAT_SMOKE_SESSION_TOKEN}" \
    "https://${WEB_FQDN}/api/power-bi/9db4c8ee-d117-4a2e-9a72-9284c6208fa0" >/dev/null
else
  echo "[deploy-uat] smoke Power BI omitido: define UAT_SMOKE_ACCESS_TOKEN y UAT_SMOKE_SESSION_TOKEN para validacion real end-to-end."
fi

echo "[deploy-uat] OK"
echo "Frontend UAT: https://${WEB_FQDN}"
echo "Backend interno: ${API_UPSTREAM}"
echo "Resource Group: ${RG}"
