# EduCentro · servidor (Fases 0 y 1)

Backend de EduCentro: **Node.js 22 + Fastify 5 + PostgreSQL 16 (SQL plano, sin ORM) + TypeScript**. La Fase 0 entrega la base: configuración validada, migraciones, autenticación con sesiones en servidor, auditoría de accesos, `/api/health`, Docker y CI. La **Fase 1 (tramo servidor)** añade el repositorio genérico REST de las 39 colecciones, la autorización en el servidor (rol, centro, alcance, propiedad) y el aislamiento multi-centro con RLS de PostgreSQL; contrato exacto en [`../docs/API-REST.md`](../docs/API-REST.md). El cliente (`repo-api.js`) es el tramo siguiente. Plan completo: [`../docs/BACKEND.md`](../docs/BACKEND.md).

## Arranque local (sin Docker)
Requisitos: Node 22, PostgreSQL 16 y el cliente `psql`.
```bash
cd Educentro/server
npm ci

# 1) Roles y base de datos (una vez, como superusuario de PostgreSQL). Ver «Roles de base de datos».
psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 \
     -v owner_pw='CLAVE_PROPIETARIO' -v app_pw='CLAVE_APP' -v dbname=educentro -f db/roles.sql

# 2) Configuración (el .env NO se versiona)
cp .env.example .env      # pon las contraseñas del paso 1 en DATABASE_URL y MIGRATION_DATABASE_URL

# 3) Migraciones, primer administrador y servidor
npm run migrar
npm run crear-admin -- --email admin@tu-dominio --nombre "Nombre Apellido"   # pide la contraseña oculta
npm run dev               # http://127.0.0.1:3000/api/health
npm run semilla-dev       # opcional, SOLO desarrollo: carga la semilla demo del frontend (js/data/semilla.js, datos ficticios) + un usuario por rol (cen_1) con contraseñas aleatorias impresas una vez
npm run paridad           # comprueba que src/domain/permisos.json coincide con js/core/permisos.js (-- --generar lo regenera)
```
Los scripts cargan `.env` con `--env-file-if-exists` de Node. En desarrollo el correo de recuperación se imprime por consola (transporte `consola`); en producción es obligatorio SMTP.

## Variables de entorno
Todas se validan con zod al arrancar; si falta o es inválida una obligatoria, **el proceso no arranca** (el mensaje solo nombra variables, nunca valores). Las sensibles aceptan `NOMBRE_FILE=/ruta` (Docker secrets). Detalle y valores por defecto en `.env.example`.

| Variable | Notas |
|---|---|
| `NODE_ENV` | `development` (por defecto), `test` o `production` |
| `DATABASE_URL` | **Obligatoria siempre.** Rol `educentro_app` (no propietario) |
| `MIGRATION_DATABASE_URL` | Rol `educentro_owner`, para `migrar`. Por defecto `DATABASE_URL` (fallaría: el rol de la app no puede crear tablas) |
| `SESSION_SECRET` | ≥ 32 bytes; **obligatoria en producción**. Se usa para derivar el token CSRF (HMAC). Fuera de producción, si falta, se genera uno efímero por proceso |
| `PUBLIC_URL` | Obligatoria en producción y `https://`. Origen permitido y base del enlace de recuperación |
| `ALLOWED_ORIGINS` | Orígenes extra para métodos no seguros (p. ej. `https://localhost` de la app Capacitor) |
| `TRUST_PROXY` | `false` (def.), `true` o lista de IP/CIDR (`127.0.0.1`, `loopback,uniquelocal`). **No** admite «nº de saltos» (Fastify 5 lo trata como no confiable) |
| `SESSION_ABSOLUTE_HOURS` / `SESSION_IDLE_HOURS` | 12 / 2 |
| `LOGIN_MAX_INTENTOS` / `LOGIN_BLOQUEO_MIN` | 5 / 15 (el bloqueo se duplica en cada ronda: 15, 30, 60… máx. 24 h) |
| `RESET_TOKEN_MIN` | 30 |
| `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_RECUPERAR_MAX`, `RATE_LIMIT_WINDOW_S` | 20, 5 y 60 s por IP |
| `MAIL_TRANSPORT`, `MAIL_FROM`, `SMTP_*` | `consola` (solo dev) o `smtp` (obligatorio en producción) |

## Roles de base de datos y RLS (Fase 1)
`db/roles.sql` crea, de forma idempotente:
- `educentro_owner`: dueño de la BD y de las tablas; solo lo usan las migraciones.
- `educentro_app`: el que usa la API. **No es propietario, ni superusuario, ni `BYPASSRLS`**, de modo que las políticas RLS le aplican (en CI y en pruebas se crea con `db/roles.sql`; si la API se conectara como propietario, la RLS FORCE seguiría aplicando, pero **no uses el propietario**). Cada migración concede explícitamente solo lo necesario (p. ej. `auditoria_accesos`: únicamente `SELECT, INSERT`).
Las migraciones fallan con un mensaje claro si el rol `educentro_app` no existe.

## Migraciones
Archivos `migrations/NNNN_descripcion.sql`, aplicados en orden por un ejecutor propio (`src/db/migrar.ts`): una transacción por archivo, bloqueo asesor (`pg_advisory_lock`, dos instancias no se pisan), tabla `migraciones_aplicadas` con checksum SHA-256 (si un archivo ya aplicado cambia, aborta: no se editan, se añade otro). `npm run migrar` (o `node dist/cli/migrar.js` en la imagen). No se ejecutan solas al arrancar la API: las lanza el servicio `migrar` de Compose antes de `api`. **Haz una copia antes de migrar en producción.**

## RLS y capa de acceso (Fase 1)
- Las 36 tablas de colecciones (`anios`, `cargas`, `calificaciones`…) y `auditoria` tienen `ENABLE` + `FORCE ROW LEVEL SECURITY`; la política mira `current_setting('app.centro_id')` y `app.rol`: `admin_red` ve todo, el resto solo su centro, **sin contexto = 0 filas** (y no se puede insertar). `centros` tiene RLS (sin FORCE, para que el propietario pueda migrar). `educentro_app` solo tiene `SELECT/INSERT/UPDATE` (borrado lógico) y en `auditoria` solo `SELECT/INSERT` más un trigger que aborta `UPDATE/DELETE/TRUNCATE`.
- `src/db/contexto.ts` (`conContexto`) abre una transacción por petición, hace `SET LOCAL app.centro_id/app.rol/app.usuario_id` y entrega un `Tx` que rechaza sentencias de control. Sin contexto válido no hay `Tx`: falla cerrado.
- **Excepción documentada**: `usuarios` (y `sesiones`, `tokens_recuperacion`) no tienen RLS porque el login consulta por correo antes de que exista contexto. `/c/usuarios` filtra por centro en SQL y las pruebas lo verifican.
- Autorización: `src/domain/autorizacion.ts` (`puede`), `alcance.ts` (alcance SQL), `permisos.json` (**fuente única**: se genera desde `js/core/permisos.js` y CI falla si divergen).

## API (Fase 0: auth) y Fase 1 (datos)
La API de datos (`/c/:col`, `/auditoria`, `/comunicados/:id/lectura`, `/respaldo/*`) está en [`../docs/API-REST.md`](../docs/API-REST.md).
Base `/api/v1`. Errores: `{"error":{"codigo","mensaje","campos?"}}`, en español y sin detalles internos. Cuerpo máx. 1 MB.

| Método y ruta | Descripción |
|---|---|
| `GET /api/health` | Comprueba la BD (`{"estado":"ok"}` o 503 `degradado`); sin datos sensibles |
| `POST /auth/login` `{email, clave}` | 200 `{usuario:{id,nombre,email,rol,centroId,refId}, csrfToken, debeCambiarClave}` + cookie. Fallo (usuario inexistente, inactivo, clave errónea o bloqueado): **401 idéntico** |
| `GET /auth/me` | Usuario y `csrfToken` de la sesión |
| `POST /auth/logout` | 204; revoca la sesión (exige CSRF) |
| `POST /auth/cambiar-clave` `{claveActual, claveNueva}` | Revoca **todas** las sesiones y emite una nueva |
| `POST /auth/recuperar` `{email}` | **Siempre 202**; el correo se envía en segundo plano solo si existe |
| `POST /auth/restablecer` `{token, clave}` | Token de un solo uso (30 min). Revoca todas las sesiones |
| `GET /ping` | Autenticado; prueba de la guardia de sesión |

Sesión: cookie opaca de 256 bits `__Host-edu_sid` (`HttpOnly; Secure; SameSite=Lax; Path=/`; en desarrollo `edu_sid` sin `Secure`), guardada en BD solo como hash SHA-256; caducidad absoluta 12 h e inactividad 2 h; el id se rota al iniciar sesión. **CSRF:** en métodos no seguros con sesión es obligatoria la cabecera `X-EDU-CSRF` con el `csrfToken` recibido (HMAC ligado a la sesión), y todo método no seguro comprueba `Origin` (si falta, se rechaza solo si `Sec-Fetch-Site` indica otro sitio). Contraseñas: argon2id (m=19 MiB, t=2, p=1), ≥ 10 caracteres, lista de comunes y sin el correo. El enlace de recuperación usa fragmento: `PUBLIC_URL/#/restablecer/<token>` (lo leerá el frontend en la Fase 1).

## Pruebas
Vitest contra **PostgreSQL real** (sin Testcontainers). Necesitan un PostgreSQL 16 local con un superusuario y `psql` en el PATH; `TEST_PG_ADMIN_URL` (por defecto `postgres://postgres:postgres@127.0.0.1:5432/postgres`) apunta a él. `test/helpers/global-setup.ts` recrea la BD `educentro_test` con `db/roles.sql`.
```bash
sudo apt-get install -y postgresql postgresql-client && sudo pg_ctlcluster 16 main start
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres'"     # solo en una máquina de pruebas
npm test            # 362 pruebas (86 de la Fase 0 + paridad, RLS, matriz 6 roles × 39 colecciones, aislamiento y seguridad de la API)
npm run lint && npm run typecheck
```

## Docker
```bash
cd Educentro/server
bash secrets/generar.sh            # crea secrets/* (fuera de git) con valores aleatorios
cp .env.example .env               # edita PUBLIC_URL, MAIL_FROM, SMTP_HOST, SMTP_USER…
docker compose build && docker compose up -d
docker compose run --rm api node dist/cli/crear-admin.js --email admin@tu-dominio --nombre "Nombre Apellido"
```
- `db` (postgres:16): volumen `pgdata`, **sin puertos publicados**, healthcheck; crea los roles al inicializar (`db/init/00-roles.sh` + `db/roles.sql`).
- `migrar` (un solo uso) aplica las migraciones con el rol propietario; `api` arranca después. La API escucha en `127.0.0.1:3000` (`API_BIND`), imagen multi-etapa, usuario no root, sin devDependencies, `read_only`, `cap_drop: ALL` y healthcheck.
- `backup`: `pg_dump` diario → gzip → GPG simétrico AES-256 (frase de paso en `secrets/backup_passphrase`) en el volumen `backups`, retención 30 días (`backup/backup.sh`). **La copia fuera de la VM es manual y está pendiente**: p. ej. `docker run --rm -v educentro_backups:/b -v "$PWD":/o alpine cp -a /b/. /o/` y luego `rsync`/`scp` a otro equipo. Guarda la frase de paso fuera de la VM. Restaurar: ver cabecera de `backup/backup.sh`. La prueba de restauración trimestral (plan §8) sigue pendiente.
- Los archivos de `secrets/` se montan como Docker secrets; la API los lee con `*_FILE`.

## Despliegue con nginx
`sudo WITH_API=1 node Educentro/deploy/deploy.mjs` añade el proxy `/api/` a `127.0.0.1:3000` (ver `../deploy/README.md`). Con nginx en el host y la API en Docker, `TRUST_PROXY` debe incluir la IP desde la que nginx llega a la API (`loopback,uniquelocal` es el valor por defecto de `compose.yml`).

## Estructura
```
server/
  src/{app.ts,server.ts,config.ts,errores.ts,auth/,db/,routes/,cli/}
  migrations/  db/roles.sql  db/init/  backup/  secrets/
  test/  Dockerfile  compose.yml  .env.example
```
