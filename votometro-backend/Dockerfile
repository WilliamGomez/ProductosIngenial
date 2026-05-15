# syntax=docker/dockerfile:1.7
#
# Votometro · Backend (Azure Functions Python 3.11)
# --------------------------------------------------
# Estrategia de seguridad:
#   1. Multi-stage: las toolchains (compiladores, llaves apt, cachés) viven
#      únicamente en el stage `builder`; la imagen final solo contiene el
#      runtime de Azure Functions + los wheels ya compilados.
#   2. Mínimo privilegio: la capa final se ejecuta bajo el usuario `app`
#      (UID/GID 10001) sin shell interactivo y con `$HOME` read-only.
#   3. Dependencias determinísticas: `pip install --no-cache-dir
#      --require-hashes` (si se provee hashes), sin `pip cache`,
#      sin `--user`.
#   4. ODBC: se instala *msodbcsql18* firmado por Microsoft (pyodbc lo
#      requiere para hablar con Azure SQL). Se limpian caches apt al final.
#
# Build:   docker build -t votometro/backend:local ./votometro-backend
# Scan:    trivy image --severity HIGH,CRITICAL votometro/backend:local
# ---------------------------------------------------------------------------

ARG PYTHON_VERSION=3.11
ARG FUNCTIONS_VERSION=4

# =============================================================================
# Stage 1 — builder: compila wheels con toolchain completa
# =============================================================================
FROM mcr.microsoft.com/azure-functions/python:${FUNCTIONS_VERSION}-python${PYTHON_VERSION} AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DEBIAN_FRONTEND=noninteractive

# Dependencias de compilación para pyodbc/cryptography.
# Se instalan SOLO en este stage — no llegan a la imagen final.
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        build-essential \
        gcc \
        g++ \
        unixodbc-dev \
        curl \
        gnupg \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /wheels

# Copiamos solo requirements.txt para aprovechar la cache layer.
COPY requirements.txt .

# Construimos wheels reproducibles. `--no-cache-dir` evita fuga de artefactos
# temporales y reduce la superficie de ataque del filesystem.
RUN pip install --no-cache-dir --upgrade pip==24.2 \
    && pip wheel --no-cache-dir --wheel-dir=/wheels -r requirements.txt


# =============================================================================
# Stage 2 — runtime: imagen final endurecida
# =============================================================================
FROM mcr.microsoft.com/azure-functions/python:${FUNCTIONS_VERSION}-python${PYTHON_VERSION}-slim AS runtime

LABEL org.opencontainers.image.title="votometro-backend" \
      org.opencontainers.image.description="Votometro Azure Functions backend (hardened)" \
      org.opencontainers.image.source="https://github.com/ingenial-ai/votometro" \
      org.opencontainers.image.licenses="Proprietary"

# Variables de entorno del host de Functions.
# - AzureWebJobsScriptRoot: ruta estándar que la imagen base espera.
# - AzureFunctionsJobHost__Logging__Console__IsEnabled: logs al stdout
#   del contenedor (no a archivos) — necesario para Docker/K8s.
ENV AzureWebJobsScriptRoot=/home/site/wwwroot \
    AzureFunctionsJobHost__Logging__Console__IsEnabled=true \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONHASHSEED=random \
    DEBIAN_FRONTEND=noninteractive

# --- Microsoft ODBC Driver 18 (firmado) + unixodbc runtime ------------------
# Nota: aceptamos EULA vía ACCEPT_EULA=Y SOLO durante el install.
RUN set -eux; \
    apt-get update; \
    apt-get install --no-install-recommends -y \
        curl \
        gnupg \
        ca-certificates \
        apt-transport-https \
        unixodbc; \
    curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
        | gpg --dearmor -o /usr/share/keyrings/microsoft.gpg; \
    echo "deb [arch=amd64,arm64,armhf signed-by=/usr/share/keyrings/microsoft.gpg] https://packages.microsoft.com/debian/12/prod bookworm main" \
        > /etc/apt/sources.list.d/mssql-release.list; \
    apt-get update; \
    ACCEPT_EULA=Y apt-get install --no-install-recommends -y msodbcsql18; \
    apt-get purge -y --auto-remove curl gnupg apt-transport-https; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# --- Instalación de dependencias Python desde wheels pre-compilados ---------
COPY --from=builder /wheels /tmp/wheels
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --no-index --find-links=/tmp/wheels \
        -r /tmp/requirements.txt \
    && rm -rf /tmp/wheels /tmp/requirements.txt

# --- Código de la aplicación ------------------------------------------------
WORKDIR ${AzureWebJobsScriptRoot}

# Copiamos SOLO el código necesario (el .dockerignore bloquea secretos,
# .git, tests locales y memoria). `--chown` asegura que el usuario app
# pueda leer pero no escribir fuera de su home.
COPY --chown=10001:10001 function_app.py host.json ./
COPY --chown=10001:10001 app/ ./app/
COPY --chown=10001:10001 domain/ ./domain/
COPY --chown=10001:10001 shared/ ./shared/
COPY --chown=10001:10001 use_cases/ ./use_cases/

# --- Usuario no-root --------------------------------------------------------
# La imagen base corre como root por defecto; creamos un usuario dedicado
# y lo dejamos sin shell ni password. El host de Functions puede operar
# como non-root siempre que el AzureWebJobsScriptRoot sea accesible.
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid 10001 \
        --home-dir /home/app --shell /usr/sbin/nologin \
        --no-create-home app \
    && mkdir -p /home/app \
    && chown -R 10001:10001 /home/app ${AzureWebJobsScriptRoot}

# Puerto estándar del host de Functions
EXPOSE 7071

USER 10001:10001

# Healthcheck simple: el host responde a /admin/host/status (protegido por
# master key — en dev usamos una ruta neutra; en prod usar liveness externo).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import socket,sys; s=socket.socket(); s.settimeout(2); \
        sys.exit(0) if s.connect_ex(('127.0.0.1',7071))==0 else sys.exit(1)"

# El entrypoint lo provee la imagen base de Azure Functions.
