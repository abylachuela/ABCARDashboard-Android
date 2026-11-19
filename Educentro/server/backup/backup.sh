#!/bin/bash
# Copia de seguridad de PostgreSQL: pg_dump -> gzip -> cifrado simétrico GPG (AES-256) -> /backups.
#   backup.sh             hace UNA copia y aplica la retención
#   backup.sh --bucle     una copia al arrancar y luego cada INTERVALO_HORAS (24 por defecto)
#
# Variables:
#   PGHOST PGPORT PGDATABASE PGUSER    conexión (el rol de copia, solo lectura recomendable)
#   PGPASSWORD_FILE                     archivo con la contraseña de PGUSER
#   BACKUP_PASSPHRASE_FILE              archivo con la frase de paso de cifrado (>= 32 caracteres aleatorios)
#   BACKUP_DIR (def. /backups)  RETENCION_DIAS (def. 30)  INTERVALO_HORAS (def. 24)
#
# Restaurar:  gpg --batch --pinentry-mode loopback --passphrase-file FRASE -d copia.sql.gz.gpg | gunzip | psql -d BD
# ATENCIÓN: la copia fuera de la VM es manual/pendiente. Sin ella, perder la VM es perder los datos.
set -euo pipefail
umask 077

DIR="${BACKUP_DIR:-/backups}"
RETENCION="${RETENCION_DIAS:-30}"
INTERVALO="${INTERVALO_HORAS:-24}"
: "${PGDATABASE:?falta PGDATABASE}" "${PGUSER:?falta PGUSER}"
FRASE="${BACKUP_PASSPHRASE_FILE:?falta BACKUP_PASSPHRASE_FILE}"
[ -r "$FRASE" ] || { echo "No se puede leer BACKUP_PASSPHRASE_FILE" >&2; exit 1; }
[ "$(wc -c < "$FRASE")" -ge 32 ] || { echo "La frase de paso debe tener al menos 32 caracteres" >&2; exit 1; }
if [ -n "${PGPASSWORD_FILE:-}" ]; then PGPASSWORD="$(cat "$PGPASSWORD_FILE")"; export PGPASSWORD; fi

una_copia() {
  local sello destino tmp
  sello="$(date -u +%Y%m%dT%H%M%SZ)"
  destino="$DIR/educentro-$sello.sql.gz.gpg"
  tmp="$destino.parcial"
  # pipefail: si pg_dump falla, no se deja una copia "buena" a medias.
  if pg_dump --no-owner --no-privileges --format=plain \
      | gzip -9 \
      | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$FRASE" \
            --symmetric --cipher-algo AES256 --compress-algo none -o "$tmp"; then
    mv "$tmp" "$destino"
    echo "$(date -u +%FT%TZ) copia creada: $(basename "$destino") ($(wc -c < "$destino") bytes)"
  else
    rm -f "$tmp"
    echo "$(date -u +%FT%TZ) ERROR: la copia falló" >&2
    return 1
  fi
  # Retención
  find "$DIR" -maxdepth 1 -name 'educentro-*.sql.gz.gpg' -mtime "+$RETENCION" -print -delete \
    | sed 's/^/retención: borrada /'
  find "$DIR" -maxdepth 1 -name '*.parcial' -mmin +120 -delete
}

if [ "${1:-}" = "--bucle" ]; then
  while true; do
    una_copia || true
    sleep "$((INTERVALO * 3600))"
  done
else
  una_copia
fi
