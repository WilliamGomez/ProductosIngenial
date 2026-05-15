# Votometro · Guía de ejecución con Docker (local + CI/CD)

Fecha: 2026-04-23
Autor: DevSecOps / Arquitectura

Este documento describe cómo construir y ejecutar la suite Votometro
(backend Azure Functions + frontend React) en contenedores, aplicando
hardening OWASP y manteniendo los secretos **fuera de la imagen**.

---

## 1. Requisitos

| Herramienta        | Versión mínima | Notas                                                  |
| ------------------ | -------------- | ------------------------------------------------------ |
| Docker Engine      | 24.0           | BuildKit habilitado por defecto.                       |
| Docker Compose V2  | 2.20           | Usar `docker compose` (no `docker-compose`).           |
| Hadolint (opcional)| 2.12           | Linter de Dockerfile — recomendado en pre-commit.      |
| Trivy (opcional)   | 0.50           | Escaneo CVE de imágenes antes de tag + push.           |

---

## 2. Estructura del repo (post-dockerización)

```
Votometro/
├── docker-compose.yml          ← orquesta ambos servicios
├── .env.example                ← plantilla de variables (versionada)
├── .env                        ← valores reales (NO versionado)
├── secrets/                    ← montaje de secretos (NO versionado)
│   ├── local.settings.json     ← runtime del backend
│   └── sql_connection_string   ← secreto Docker (compose secret)
├── DOCKER.md                   ← esta guía
│
├── votometro-backend/
│   ├── Dockerfile              ← multi-stage, non-root, ODBC 18
│   ├── .dockerignore
│   └── ...código Python
│
└── votometro-frontend/
    ├── Dockerfile              ← multi-stage, nginx-unprivileged
    ├── .dockerignore
    ├── nginx.conf              ← CSP + HSTS + X-Frame-Options
    └── ...código React
```

---

## 3. Bootstrap en 3 pasos

```bash
# 1. Clonar + entrar
git clone git@github.com:ingenial-ai/votometro.git
cd votometro

# 2. Preparar secretos LOCALES (no versionados)
cp .env.example .env
mkdir -p secrets
cp /ruta/a/tu/local.settings.json secrets/local.settings.json
printf '%s' "$SQL_CONN_FROM_KEYVAULT" > secrets/sql_connection_string
chmod 600 .env secrets/*

# 3. Build + up
docker compose build --pull
docker compose up -d
docker compose ps   # ambos servicios en "healthy"
```

URLs:

- Frontend SPA: <http://localhost:8080>
- Backend Functions host: <http://localhost:7071>

---

## 4. Inyección segura de `local.settings.json`

> **Nunca** copiar `local.settings.json` con `COPY local.settings.json`
> en un Dockerfile — queda horneado en una capa firmada del registry
> y aparece en `docker history` incluso si se borra después.

Patrón usado en este repo:

### 4.1 Vía bind mount (recomendado en local)

`docker-compose.yml` ya define el volumen:

```yaml
volumes:
  - type: bind
    source: ./secrets/local.settings.json
    target: /home/site/wwwroot/local.settings.json
    read_only: true
```

Flujo:

1. El archivo vive en `./secrets/` que está en `.gitignore` + `.dockerignore`.
2. Se monta **read-only** dentro del contenedor; el Functions host lo
   lee al arrancar.
3. Al destruir el contenedor, el archivo NO queda en ninguna capa.

Verificación:

```bash
docker image inspect votometro/backend:local --format '{{.RootFS.Layers}}' | wc -w
docker history votometro/backend:local | grep -i settings  # → vacío
```

### 4.2 Vía Docker Secret (producción / swarm)

Para Docker Swarm o entornos CI/CD:

```yaml
# docker-compose.prod.yml (override)
secrets:
  local_settings_json:
    external: true   # creado con `docker secret create`

services:
  backend:
    secrets:
      - source: local_settings_json
        target: /home/site/wwwroot/local.settings.json
        mode: 0400
```

Creación fuera del repo:

```bash
az keyvault secret show --vault-name votometro-kv --name local-settings \
  --query value -o tsv | docker secret create local_settings_json -
```

### 4.3 Vía variable de entorno parcial

Si un secreto individual basta (ej. `SQL_CONNECTION_STRING`), no se
monta archivo: se pasa como `${VAR}` desde `.env` → `environment:`
del servicio. El código lo lee con `os.getenv(...)`. **Ningún secreto
debe aparecer literalmente en el Dockerfile ni en `docker-compose.yml`.**

---

## 5. Hardening aplicado

### 5.1 Backend

- **Base:** `mcr.microsoft.com/azure-functions/python:4-python3.11-slim`.
- **Multi-stage:** toolchains (`build-essential`, `gcc`) quedan fuera del
  runtime.
- **Non-root:** `USER 10001:10001`, sin shell, sin password.
- **FS read-only** (compose `read_only: true` + tmpfs para `/tmp` y
  `/home/app`).
- **Capabilities:** `cap_drop: ALL`; `no-new-privileges:true`.
- **Pip sin cache:** `--no-cache-dir` + `--no-index` en runtime.
- **Dependencias ODBC:** `msodbcsql18` firmado por Microsoft vía
  repo oficial + llave en `/usr/share/keyrings/`.

### 5.2 Frontend

- **Base runtime:** `nginxinc/nginx-unprivileged:1.27-alpine` (UID 101,
  listen en 8080).
- **Bundle:** solo `/dist` viaja al runtime — sin Node, sin pnpm,
  sin código fuente.
- **Headers nginx:** `CSP`, `HSTS` (2 años), `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy` restrictiva.
- **Métodos HTTP:** solo `GET`/`HEAD`/`OPTIONS`; cualquier otro → 405.
- **Dotfiles:** `location ~ /\.` → 404 (bloquea `/.git`, `/.env`).
- **server_tokens off**: oculta versión.

### 5.3 Compose

- Red bridge dedicada `votometro-network` con subnet fija.
- Puertos expuestos solo a `127.0.0.1` (no a la LAN).
- Resource limits por servicio (mitiga DoS local).
- `pids_limit` y `ulimits nofile` (anti fork-bomb).
- Logging rotativo `10m × 3` para evitar llenar el disco.
- Healthchecks en ambos servicios.

---

## 6. Ejecución segura — checklist pre-`up`

```bash
# 1. Revisar que no hay secretos en el build context
cd votometro-backend
grep -rE '^(SQL_CONNECTION|MS_CLIENT_SECRET|PASSWORD)=' . | grep -v .dockerignore
# → sin resultados

# 2. Lint de Dockerfiles
hadolint votometro-backend/Dockerfile
hadolint votometro-frontend/Dockerfile

# 3. Escaneo CVE de imágenes
docker compose build --pull
trivy image --severity HIGH,CRITICAL --ignore-unfixed votometro/backend:local
trivy image --severity HIGH,CRITICAL --ignore-unfixed votometro/frontend:local

# 4. Confirmar que corren como non-root
docker run --rm --entrypoint id votometro/backend:local     # uid=10001
docker run --rm --entrypoint id votometro/frontend:local    # uid=101

# 5. Confirmar que .env / secrets/ NO están en las imágenes
docker run --rm --entrypoint ls votometro/backend:local \
    -la /home/site/wwwroot/local.settings.json 2>&1
# → archivo NO presente (solo aparece tras docker compose up con el mount)

# 6. Arrancar
docker compose up -d
docker compose logs --tail=50 -f
```

---

## 7. CI/CD recomendado (GitHub Actions sketch)

```yaml
name: build-and-scan
on: [push, pull_request]

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Lint
        run: |
          docker run --rm -i hadolint/hadolint < votometro-backend/Dockerfile
      - name: Build
        uses: docker/build-push-action@v5
        with:
          context: ./votometro-backend
          tags: votometro/backend:${{ github.sha }}
          load: true
          provenance: false
          sbom: true
      - name: Scan
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: votometro/backend:${{ github.sha }}
          severity: HIGH,CRITICAL
          exit-code: 1
          ignore-unfixed: true
  frontend:
    # Mismo patrón.
```

Reglas obligatorias en pipeline:

1. `hadolint` debe pasar.
2. `trivy` debe pasar con `--severity HIGH,CRITICAL --exit-code 1`.
3. SBOM (SPDX) adjunto al build artifact.
4. El push al registry requiere firma cosign (supply chain).

---

## 8. Troubleshooting rápido

| Síntoma                                              | Causa probable                                              | Fix                                                                               |
| ---------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `pyodbc.InterfaceError: ... Driver not found`        | `msodbcsql18` no instalado o arquitectura no soportada.     | Revisar stage runtime del backend Dockerfile; build en arch correcta (`--platform linux/amd64`). |
| `nginx: [emerg] bind() to 0.0.0.0:80 failed (Permission denied)` | Alguien cambió el `listen` a 80 sin darle `NET_BIND_SERVICE`. | Dejar `listen 8080`; esa es la convención del usuario non-root.               |
| `Container exits with code 139`                      | Faltan wheels pre-compilados por arch (ARM vs x86_64).      | Re-build con `--platform=linux/amd64` explícito.                                 |
| 401 al llamar `GET /power-bi/{reportId}`             | Function Key no configurada en `.env`.                       | Exportar `AZURE_FUNCTIONS_MASTER_KEY` y enviar `x-functions-key` en request.     |
| Frontend carga pero muestra `Blocked by CSP`         | Un nuevo origen (fuente, CDN) no está en la CSP.            | Ampliar la CSP en `nginx.conf` y rebuild.                                         |

---

## 9. ¿Qué NO hacer?

- ❌ `COPY local.settings.json` o `COPY .env`.
- ❌ `USER root` en el stage final.
- ❌ `--privileged` en compose.
- ❌ Montar el Docker socket (`/var/run/docker.sock`) en contenedores
  productivos — permite fuga trivial de privilegios.
- ❌ `publish: "0.0.0.0:7071:7071"` en local — usar `127.0.0.1:`.
- ❌ Construir sin `--pull` (puede quedarse con base image vulnerable).

---

## 10. Sources

- OWASP Container Security Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html>
- CIS Docker Benchmark v1.6
- Microsoft — Running Azure Functions in containers: <https://learn.microsoft.com/azure/azure-functions/functions-how-to-custom-container>
- nginxinc/nginx-unprivileged: <https://github.com/nginxinc/docker-nginx-unprivileged>

Relacionados en este repo:

- [README.md](computer:///sessions/optimistic-focused-franklin/mnt/Votometro/README.md)
- [EXECUTION_README.md](computer:///sessions/optimistic-focused-franklin/mnt/Votometro/EXECUTION_README.md)
- [DIAGNOSTIC_REPORT.md](computer:///sessions/optimistic-focused-franklin/mnt/Votometro/DIAGNOSTIC_REPORT.md)
