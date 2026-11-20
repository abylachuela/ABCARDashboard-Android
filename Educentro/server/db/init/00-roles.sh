#!/bin/sh
# Se ejecuta UNA vez, al crear el volumen de PostgreSQL (docker-entrypoint-initdb.d). Crea los roles y la BD
# con db/roles.sql. Las contraseñas llegan por Docker secrets (archivos), nunca por variables de entorno.
set -eu
OWNER_PW="$(cat /run/secrets/db_owner_password)"
APP_PW="$(cat /run/secrets/db_app_password)"
psql -X -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$OWNER_PW" -v app_pw="$APP_PW" -v dbname="${EDUCENTRO_DB:-educentro}" \
  -f /opt/educentro/roles.sql
