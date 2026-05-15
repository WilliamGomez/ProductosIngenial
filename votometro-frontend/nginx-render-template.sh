#!/bin/sh
# =============================================================================
# DEPRECATED — archivo conservado solo porque el entorno no permite borrarlo.
# -----------------------------------------------------------------------------
# Decisión 2026-05-09: revertir a `envsubst` con `NGINX_ENVSUBST_FILTER` de la
# imagen oficial `nginxinc/nginx-unprivileged`. Este script ya NO se copia al
# image (ver Dockerfile) y NO debe usarse.
#
# Bug original que sacó este script de circulación:
#   Línea con `${#FUNCTIONS_KEY:-0}` — sintaxis bash-only no soportada por
#   /bin/sh (ash) de Alpine. Crash loop con "bad substitution".
#
# Eliminar este archivo manualmente cuando sea posible (`git rm`).
# =============================================================================
exit 0
