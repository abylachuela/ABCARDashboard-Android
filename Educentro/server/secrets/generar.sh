#!/bin/bash
# Genera los secretos que faltan en este directorio (no sobrescribe los existentes). Ejecutar en la VM.
set -euo pipefail
cd "$(dirname "$0")"
umask 077
gen() { [ -f "$1" ] || { openssl rand -hex 24 > "$1"; echo "creado: $1"; }; }
gen postgres_password; gen db_owner_password; gen db_app_password
[ -f session_secret ]     || { openssl rand -base64 48 | tr -d '\n' > session_secret; echo "creado: session_secret"; }
[ -f backup_passphrase ]  || { openssl rand -base64 48 | tr -d '\n' > backup_passphrase; echo "creado: backup_passphrase  (GUÁRDALA fuera de la VM)"; }
[ -f database_url ]           || { printf 'postgres://educentro_app:%s@db:5432/educentro' "$(cat db_app_password)" > database_url; echo "creado: database_url"; }
[ -f migration_database_url ] || { printf 'postgres://educentro_owner:%s@db:5432/educentro' "$(cat db_owner_password)" > migration_database_url; echo "creado: migration_database_url"; }
[ -f smtp_pass ] || { : > smtp_pass; echo "creado: smtp_pass (vacío)"; }
# El directorio es 700 (solo root del host lo recorre); los archivos 644 para que el usuario no root de cada
# contenedor (node, postgres) pueda leerlos una vez montados como Docker secrets.
chmod 700 .
for f in postgres_password db_owner_password db_app_password session_secret backup_passphrase database_url migration_database_url smtp_pass; do chmod 644 "$f"; done
