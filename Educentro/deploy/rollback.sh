#!/usr/bin/env bash
# Vuelve a la versión anterior desplegada por deploy.sh.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root (sudo)." >&2; exit 1; }
APP_DIR="${APP_DIR:-/var/www/educentro}"
cur="$(readlink -f "$APP_DIR/current")"
prev="$(ls -1dt "$APP_DIR"/releases/* | grep -vxF "$cur" | head -n1 || true)"
[ -n "$prev" ] || { echo "No hay versión anterior." >&2; exit 1; }
ln -sfn "$prev" "$APP_DIR/current.new" && mv -Tf "$APP_DIR/current.new" "$APP_DIR/current"
echo "Activa ahora: $(basename "$prev") (antes: $(basename "$cur"))"
