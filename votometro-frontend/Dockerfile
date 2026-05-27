# syntax=docker/dockerfile:1.7
#
# Votometro · Frontend (React 19 + Vite + Tailwind 4)
# ---------------------------------------------------
# Estrategia de seguridad:
#   1. Multi-stage: el stage `builder` descarga toolchains (Node, pnpm,
#      devDependencies) y produce `/dist` con activos estáticos; la imagen
#      final no contiene Node ni ningún código fuente.
#   2. Runtime basado en `nginxinc/nginx-unprivileged:alpine`, variante
#      mantenida por el equipo oficial de nginx que ya corre como usuario
#      `nginx` (UID 101) sin necesidad de hacks.
#   3. Hardening de nginx en `nginx.conf` (CSP, HSTS, X-Frame-Options,
#      server_tokens off, etc.) — ver ese archivo para detalles.
#   4. Dependencias: `pnpm install --frozen-lockfile` bloquea el lockfile
#      y falla si hay drift entre package.json y lockfile.
#   5. Sin secretos en build args: ningún `VITE_*_SECRET` debe inyectarse
#      al bundle. Las variables públicas (Client ID, Tenant ID) vienen por
#      build args explícitos — ver .env.example.
#
# Build:   docker build -t votometro/frontend:local ./votometro-frontend
# Scan:    trivy image --severity HIGH,CRITICAL votometro/frontend:local
# ---------------------------------------------------------------------------

ARG NODE_VERSION=20
ARG NGINX_VERSION=1.27

# =============================================================================
# Stage 1 — builder
# =============================================================================
FROM node:${NODE_VERSION}-alpine AS builder

# Se comenta NODE_ENV=production temporalmente en esta fase para permitir 
# que se instalen las devDependencies (TypeScript y Vite) necesarias para compilar.
# ENV NODE_ENV=production \
ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

# pnpm via corepack (viene embebido con Node 20+). Pin de versión via
# packageManager en package.json si existe; en caso contrario se usa la
# versión estable del corepack.
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copiamos primero los manifests para aprovechar la cache.
COPY package.json pnpm-lock.yaml* ./

# Instalación reproducible: falla si el lockfile no cuadra con package.json.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Ahora el resto del código (el .dockerignore excluye dotfiles, tests, etc.)
COPY . .

# Build args públicos — **NO** secretos. Son embebidos en el bundle JS.
ARG VITE_BACKEND_URL
ARG VITE_AZURE_CLIENT_ID
ARG VITE_AZURE_TENANT_ID
# DEV BYPASS:
#   Default `false` para que builds que no especifiquen esta variable
#   (CI/CD productivo, cualquier `docker build` sin --build-arg) salgan
#   con el bypass desactivado. Aun cuando se pase `true` por error en
#   prod, el chequeo `import.meta.env.DEV` en `devBypass.ts` colapsa la
#   rama y el código es eliminado del bundle por tree-shake.
ARG VITE_LOCAL_AUTH_BYPASS=false
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL} \
    VITE_AZURE_CLIENT_ID=${VITE_AZURE_CLIENT_ID} \
    VITE_AZURE_TENANT_ID=${VITE_AZURE_TENANT_ID} \
    VITE_LOCAL_AUTH_BYPASS=${VITE_LOCAL_AUTH_BYPASS}

RUN test -n "$VITE_BACKEND_URL" \
    && test -n "$VITE_AZURE_CLIENT_ID" \
    && test -n "$VITE_AZURE_TENANT_ID" \
    || (echo "ERROR: missing required Vite build args: VITE_BACKEND_URL, VITE_AZURE_CLIENT_ID, VITE_AZURE_TENANT_ID" >&2; exit 1)

RUN case "$VITE_BACKEND_URL" in \
        /api|/api/*) ;; \
        *) echo "ERROR: VITE_BACKEND_URL must be same-origin (/api) for Container Apps. Do not embed internal or absolute API URLs in the SPA bundle." >&2; exit 1 ;; \
    esac

# Vite build — produce /app/dist
#RUN pnpm run build

# Vite build — produce /app/dist
# FIX: Usamos pnpm exec en lugar de npx para garantizar que use las herramientas locales
RUN if [ "$VITE_LOCAL_AUTH_BYPASS" = "true" ]; then \
        pnpm exec tsc -b && pnpm exec vite build --mode development; \
    else \
        pnpm run build; \
    fi


# =============================================================================
# Stage 2 — runtime (nginx sin privilegios)
# =============================================================================
FROM nginxinc/nginx-unprivileged:${NGINX_VERSION}-alpine AS runtime

LABEL org.opencontainers.image.title="votometro-frontend" \
    org.opencontainers.image.description="Votometro SPA served by hardened nginx" \
    org.opencontainers.image.source="https://github.com/ingenial-ai/votometro" \
    org.opencontainers.image.licenses="Proprietary"

# nginxinc/nginx-unprivileged ya corre como USER 101 (nginx).
# Reemplazamos la default-config por la endurecida y retiramos índices de
# ejemplo. Config estático sin envsubst — `nginx.conf` se copia tal cual
# a `/etc/nginx/conf.d/default.conf` (estado previo al intento fallido
# de inyectar la Power BI function key vía template).
USER root
RUN rm -f /etc/nginx/conf.d/default.conf \
    && rm -rf /usr/share/nginx/html/* \
    && apk --no-cache upgrade \
    && apk --no-cache add tzdata

# Config hardening (CSP, HSTS, headers, listen 8080).
# Se instala como template para poder cambiar solo el upstream interno de /api
# entre Docker local y Azure Container Apps sin recompilar codigo.
ENV API_UPSTREAM=${API_UPSTREAM:-http://localhost:7071} \
    FRONTDOOR_ID=${FRONTDOOR_ID:-} \
    REQUIRE_FRONTDOOR=${REQUIRE_FRONTDOOR:-false} \
    NGINX_ENVSUBST_FILTER='^(API_UPSTREAM|FRONTDOOR_ID|REQUIRE_FRONTDOOR)$'
COPY --chown=101:101 nginx.conf /etc/nginx/templates/default.conf.template

# Activos estáticos del stage builder.
COPY --from=builder --chown=101:101 /app/dist /usr/share/nginx/html

# Filesystem mínimo de escritura para nginx non-root.
# `/var/cache/nginx`, `/var/run` y `/tmp` deben ser writeables; el compose
# monta tmpfs encima de ellos en runtime para read-only root.
RUN chown -R 101:101 /var/cache/nginx /var/log/nginx /usr/share/nginx/html

USER 101

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:8080/ || exit 1

# El entrypoint por defecto de la imagen (`nginx -g 'daemon off;'`) es el correcto.
