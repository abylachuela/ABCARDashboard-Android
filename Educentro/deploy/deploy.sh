#!/usr/bin/env bash
# Despliegue de Educentro (sitio estático) en una VM Linux con nginx.
# Ejecutar COMO ROOT en la VM, desde una copia del repositorio:
#   git clone <repo> && cd <repo> && git checkout <rama>
#   sudo bash Educentro/deploy/deploy.sh                 # HTTPS con certificado autofirmado
#   sudo SERVER_NAME=notas.midominio.edu EMAIL=yo@x.edu HTTPS_MODE=letsencrypt bash Educentro/deploy/deploy.sh
# Variables: SERVER_NAME (def. IP/hostname de la VM), HTTPS_MODE=selfsigned|letsencrypt|none (def. selfsigned),
#            EMAIL (solo letsencrypt), APP_DIR (def. /var/www/educentro), KEEP (versiones a conservar, def. 5).
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root (sudo)." >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"                 # carpeta Educentro/
APP_DIR="${APP_DIR:-/var/www/educentro}"
HTTPS_MODE="${HTTPS_MODE:-selfsigned}"
KEEP="${KEEP:-5}"
SERVER_NAME="${SERVER_NAME:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
SERVER_NAME="${SERVER_NAME:-localhost}"
EMAIL="${EMAIL:-}"
STAMP="$(date +%Y%m%d-%H%M%S)"
REL="$APP_DIR/releases/$STAMP"

case "$HTTPS_MODE" in selfsigned|letsencrypt|none) ;; *) echo "HTTPS_MODE inválido: $HTTPS_MODE" >&2; exit 1;; esac
[[ "$SERVER_NAME" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "SERVER_NAME inválido." >&2; exit 1; }
[ -f "$SRC/index.html" ] || { echo "No encuentro $SRC/index.html" >&2; exit 1; }
if [ "$HTTPS_MODE" = letsencrypt ]; then
  [ -n "$EMAIL" ] || { echo "letsencrypt necesita EMAIL=..." >&2; exit 1; }
  [[ "$SERVER_NAME" =~ ^[0-9.]+$ ]] && { echo "letsencrypt necesita un dominio, no una IP." >&2; exit 1; }
fi

echo "==> Instalando nginx$([ "$HTTPS_MODE" = letsencrypt ] && echo ' y certbot') si hacen falta"
if ! command -v nginx >/dev/null; then
  if command -v apt-get >/dev/null; then apt-get update -y && apt-get install -y nginx
  elif command -v dnf >/dev/null; then dnf install -y nginx
  elif command -v yum >/dev/null; then yum install -y nginx
  else echo "Gestor de paquetes no soportado: instala nginx a mano." >&2; exit 1; fi
fi
command -v openssl >/dev/null || { command -v apt-get >/dev/null && apt-get install -y openssl; }
if [ "$HTTPS_MODE" = letsencrypt ] && ! command -v certbot >/dev/null; then
  if command -v apt-get >/dev/null; then apt-get install -y certbot python3-certbot-nginx
  else echo "Instala certbot y su plugin de nginx, y vuelve a ejecutar." >&2; exit 1; fi
fi

echo "==> Copiando la web a $REL (solo index.html, css, js)"
mkdir -p "$REL"
cp -a "$SRC/index.html" "$SRC/css" "$SRC/js" "$REL/"
[ -d "$SRC/assets" ] && cp -a "$SRC/assets" "$REL/"
# Defensa: jamás publicar datos privados ni hojas de cálculo.
find "$REL" \( -iname '*.xlsx' -o -iname '*.xls' -o -iname '*.csv' -o -name 'datos-privados' \) -prune -exec rm -rf {} + 2>/dev/null || true
chown -R root:root "$REL"; find "$REL" -type d -exec chmod 755 {} +; find "$REL" -type f -exec chmod 644 {} +
ln -sfn "$REL" "$APP_DIR/current.new" && mv -Tf "$APP_DIR/current.new" "$APP_DIR/current"

echo "==> Configurando nginx ($HTTPS_MODE)"
SNIP=/etc/nginx/snippets; mkdir -p "$SNIP" /etc/nginx/conf.d
CSP="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'; frame-ancestors 'none'"
cat > "$SNIP/educentro-headers.conf" <<HDR
add_header Content-Security-Policy "$CSP" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
HDR
cat > "$SNIP/educentro-app.conf" <<APP
root $APP_DIR/current;
index index.html;
charset utf-8;
server_tokens off;
gzip on;
gzip_types text/css application/javascript application/json image/svg+xml;
gzip_min_length 1024;
include $SNIP/educentro-headers.conf;
location / { try_files \$uri \$uri/ =404; }
location ~* \.(xlsx|xls|csv|md|map|sh|bak|log)\$ { return 404; }
location ~ /\. { return 404; }
location ^~ /datos-privados/ { return 404; }
location ^~ /docs/ { return 404; }
location ^~ /mobile/ { return 404; }
location ^~ /tests/ { return 404; }
location ^~ /propuestas/ { return 404; }
location = /index.html { include $SNIP/educentro-headers.conf; add_header Cache-Control "no-cache" always; }
location ~* \.(js|css)\$ { include $SNIP/educentro-headers.conf; add_header Cache-Control "no-cache" always; }
APP

SITE=/etc/nginx/conf.d/educentro.conf
# Escucha IPv6 solo si el sistema la soporta (si no, nginx no arrancaría).
L80_6=""; L443_6=""
if [ -s /proc/net/if_inet6 ] && ! sysctl -n net.ipv6.conf.all.disable_ipv6 2>/dev/null | grep -qx 1; then L80_6="listen [::]:80;"; L443_6="listen [::]:443 ssl http2;"; fi
if [ "$HTTPS_MODE" = none ]; then
  cat > "$SITE" <<CONF
server {
    listen 80; $L80_6
    server_name $SERVER_NAME;
    include $SNIP/educentro-app.conf;
}
CONF
else
  if [ "$HTTPS_MODE" = selfsigned ]; then
    CERT=/etc/ssl/educentro; mkdir -p "$CERT"
    if [ ! -f "$CERT/educentro.crt" ]; then
      if [[ "$SERVER_NAME" =~ ^[0-9.]+$ ]]; then SAN="IP:$SERVER_NAME"; else SAN="DNS:$SERVER_NAME"; fi
      openssl req -x509 -nodes -newkey rsa:3072 -days 825 -keyout "$CERT/educentro.key" -out "$CERT/educentro.crt" \
        -subj "/CN=$SERVER_NAME" -addext "subjectAltName=$SAN" 2>/dev/null
      chmod 600 "$CERT/educentro.key"
    fi
    CRT="$CERT/educentro.crt"; KEY="$CERT/educentro.key"; HSTS=""
  else
    CRT="/etc/letsencrypt/live/$SERVER_NAME/fullchain.pem"; KEY="/etc/letsencrypt/live/$SERVER_NAME/privkey.pem"
    HSTS='add_header Strict-Transport-Security "max-age=31536000" always;'
    if [ ! -f "$CRT" ]; then
      # Servidor HTTP temporal para el desafío de Let's Encrypt.
      printf 'server { listen 80; server_name %s; root /var/www/html; }\n' "$SERVER_NAME" > "$SITE"
      nginx -t && (systemctl reload nginx 2>/dev/null || systemctl restart nginx)
      certbot certonly --nginx -d "$SERVER_NAME" -m "$EMAIL" --agree-tos --non-interactive
    fi
  fi
  cat > "$SITE" <<CONF
server {
    listen 80; $L80_6
    server_name $SERVER_NAME;
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl http2; $L443_6   # 'http2' en listen: compatible con nginx <1.25 y >=1.25
    server_name $SERVER_NAME;
    ssl_certificate $CRT;
    ssl_certificate_key $KEY;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache shared:EDU:10m;
    ${HSTS:-}
    include $SNIP/educentro-app.conf;
}
CONF
fi
# Quitar el sitio por defecto si estorba en el puerto 80 (solo el enlace; no borra nada propio).
[ -L /etc/nginx/sites-enabled/default ] && rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
systemctl reload nginx 2>/dev/null || systemctl restart nginx

echo "==> Conservando las últimas $KEEP versiones"
ls -1dt "$APP_DIR"/releases/* 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -rf

echo "==> Comprobación"
BASE="http://127.0.0.1"; CURL="curl -fsS"
if [ "$HTTPS_MODE" != none ]; then BASE="https://127.0.0.1"; CURL="curl -fsSk"; fi
ok=0
for i in 1 2 3 4 5 6 7 8 9 10; do   # nginx recarga de forma asíncrona: reintentar unos segundos
  if $CURL -H "Host: $SERVER_NAME" "$BASE/" 2>/dev/null | grep -qi "educentro"; then ok=1; break; fi
  sleep 1
done
[ "$ok" = 1 ] && echo "OK  /: responde" || { echo "FALLO: / no responde (revisa: nginx -t y /var/log/nginx/error.log)" >&2; exit 1; }
for p in datos-privados/ docs/ mobile/ tests/ propuestas/ x.xlsx; do
  c=$(curl -sk -o /dev/null -w '%{http_code}' -H "Host: $SERVER_NAME" "$BASE/$p" || true)
  [ "$c" = 404 ] && echo "OK  /$p: 404 (no se publica)" || { echo "FALLO: /$p devolvió $c" >&2; exit 1; }
done
echo
PROTO=https; [ "$HTTPS_MODE" = none ] && PROTO=http
echo "Listo: $PROTO://$SERVER_NAME/   (versión $STAMP, en $REL)"
[ "$HTTPS_MODE" = selfsigned ] && echo "Certificado autofirmado: el navegador avisará; es normal en red interna. Para un certificado válido usa un dominio con HTTPS_MODE=letsencrypt."
echo "Volver a la versión anterior: sudo bash $SCRIPT_DIR/rollback.sh"
