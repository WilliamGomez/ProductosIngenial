#!/usr/bin/env bash
# =============================================================================
# Votometro · bootstrap.sh
# -----------------------------------------------------------------------------
# Script idempotente que deja el proyecto corriendo desde cero:
#   1. Valida prereqs (docker, compose v2, arch).
#   2. Crea `.env` desde `.env.example` si no existe (warn si tiene CHANGEME).
#   3. Prepara `./secrets/local.settings.json` (template si no existe).
#   4. Permisos 600 en todo lo sensible.
#   5. `docker compose build --pull`.
#   6. `docker compose up -d`.
#   7. Espera hasta ver backend, frontend y db en healthy.
#   8. Imprime URLs y comandos útiles.
#
# Uso:
#   ./bootstrap.sh              # arranque normal
#   ./bootstrap.sh --fresh      # down -v + rebuild (elimina volumen de DB)
#   ./bootstrap.sh --no-build   # solo `up -d` (si ya construiste)
# =============================================================================

set -euo pipefail

# ── colores ──────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; RST=$'\033[0m'
else
  BOLD=''; RED=''; GRN=''; YEL=''; RST=''
fi
say()  { printf "%s==>%s %s\n" "$BOLD" "$RST" "$*"; }
warn() { printf "%s[warn]%s %s\n" "$YEL" "$RST" "$*"; }
err()  { printf "%s[err]%s  %s\n" "$RED" "$RST" "$*" >&2; }
ok()   { printf "%s[ok]%s   %s\n" "$GRN" "$RST" "$*"; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

FRESH=0
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --fresh)    FRESH=1 ;;
    --no-build) SKIP_BUILD=1 ;;
    -h|--help)
      sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) err "argumento desconocido: $arg"; exit 2 ;;
  esac
done

# ─────────────────────────────────────────────────────────────────────────────
# 1. Prereqs
# ─────────────────────────────────────────────────────────────────────────────
say "Validando prereqs"

if ! command -v docker >/dev/null 2>&1; then
  err "docker no está instalado — instálalo desde https://docs.docker.com/engine/"
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  err "docker compose v2 no está disponible. Usa Docker Desktop >= 4.x o el plugin compose."
  exit 1
fi
ok "docker $(docker --version | awk '{print $3}' | tr -d ,) · compose $(docker compose version --short)"

ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" || "$ARCH" == "aarch64" ]]; then
  warn "Arquitectura ARM detectada — la imagen de SQL Server se emulará via linux/amd64 (~30% más lento)."
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2. .env
# ─────────────────────────────────────────────────────────────────────────────
say "Preparando .env"
if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  warn ".env creado desde plantilla — REVISA y reemplaza los valores CHANGEME_ antes de continuar."
  warn "Edítalo ahora:  \$EDITOR $ROOT_DIR/.env"
  warn "Luego re-ejecuta: ./bootstrap.sh"
  exit 1
fi

if grep -q "CHANGEME_" .env; then
  err ".env contiene placeholders CHANGEME_. Completa los valores reales antes de continuar."
  grep -n "CHANGEME_" .env | sed 's/^/    /'
  exit 1
fi
ok ".env presente y sin placeholders"

# ─────────────────────────────────────────────────────────────────────────────
# 3. secrets/local.settings.json
# ─────────────────────────────────────────────────────────────────────────────
say "Preparando ./secrets/"
mkdir -p ./secrets
if [[ ! -f ./secrets/local.settings.json ]]; then
  # Template mínimo — el backend va a leer env vars del compose, pero el host
  # de Functions requiere que el archivo exista.
  cat > ./secrets/local.settings.json <<'JSON'
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "python"
  }
}
JSON
  ok "secrets/local.settings.json creado (template)"
else
  ok "secrets/local.settings.json ya existe"
fi

chmod 600 .env
chmod 600 ./secrets/*
ok "perms 600 aplicados a .env y ./secrets/*"

# ─────────────────────────────────────────────────────────────────────────────
# 4. db/init
# ─────────────────────────────────────────────────────────────────────────────
say "Verificando scripts SQL de inicialización"
if [[ ! -f ./db/init/01_base_schema.sql ]]; then
  err "Falta ./db/init/01_base_schema.sql — genera el esquema con:"
  err "    python3 db/sanitize.py <dump_azure.sql> db/init/01_base_schema.sql"
  exit 1
fi
scripts=$(ls ./db/init/[0-9][0-9]_*.sql 2>/dev/null | wc -l)
ok "$scripts script(s) SQL listos en ./db/init/"

# ─────────────────────────────────────────────────────────────────────────────
# 5. Fresh reset (opcional)
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$FRESH" == "1" ]]; then
  warn "--fresh: bajando stack y eliminando volumen de DB"
  docker compose down -v --remove-orphans || true
fi

# ─────────────────────────────────────────────────────────────────────────────
# 6. Build
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$SKIP_BUILD" == "0" ]]; then
  say "Build (docker compose build --pull)"
  docker compose build --pull
  ok "imágenes construidas"
else
  warn "--no-build: saltando compose build"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 7. Up
# ─────────────────────────────────────────────────────────────────────────────
say "Levantando stack (docker compose up -d)"
docker compose up -d

# ─────────────────────────────────────────────────────────────────────────────
# 8. Wait for healthy
# ─────────────────────────────────────────────────────────────────────────────
say "Esperando healthchecks (timeout ~3 min)…"
deadline=$(( $(date +%s) + 180 ))
wait_service() {
  local svc="$1" want="$2"
  while :; do
    local state
    state=$(docker compose ps --format '{{.Service}} {{.Status}}' | awk -v s="$svc" '$1==s {for(i=2;i<=NF;i++) printf "%s ", $i; print ""}')
    if echo "$state" | grep -qE "$want"; then
      ok "$svc → $want"
      return 0
    fi
    if (( $(date +%s) > deadline )); then
      err "$svc no alcanzó estado $want a tiempo"
      docker compose ps
      docker compose logs --tail=40 "$svc" || true
      return 1
    fi
    sleep 3
  done
}

wait_service database "healthy"
# db-init es one-shot → termina con "Exited (0)"
wait_service db-init  "Exited \(0\)"
wait_service backend  "Up"
wait_service frontend "Up"

# ─────────────────────────────────────────────────────────────────────────────
# 9. Resumen
# ─────────────────────────────────────────────────────────────────────────────
cat <<EOF

${BOLD}Votometro corriendo${RST}
─────────────────────────────────────────────────────────────
  Frontend:    http://localhost:8080
  Backend:     http://localhost:7071/api/
  SQL Server:  localhost:1433  (SA / \$MSSQL_SA_PASSWORD)

Comandos útiles:
  docker compose ps                  # estado de los servicios
  docker compose logs -f backend     # logs del backend
  docker compose logs -f frontend    # logs del frontend
  docker compose logs -f database    # logs de SQL Server
  docker compose exec database /opt/mssql-tools18/bin/sqlcmd \\
      -C -S localhost -U SA -P "\$MSSQL_SA_PASSWORD" \\
      -d sqldb-ingenial-ia -Q "SELECT COUNT(*) FROM Users"

Apagar:    docker compose down
Reset DB:  ./bootstrap.sh --fresh
EOF
