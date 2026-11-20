# Pruebas e2e del cliente (Playwright + Chromium)

Necesitan Node >= 18 y Playwright con Chromium (`npm i -D playwright && npx playwright install chromium`; si ya está instalado en otra carpeta: `PLAYWRIGHT_DIR=<carpeta de playwright>`; navegador alternativo: `CHROME_PATH`). No hay dependencias del proyecto.

| Archivo | Para qué |
|---|---|
| `servidor-dev.mjs` | Sirve `index.html`, `css/` y `js/` y hace proxy de `/api/` al backend **en el mismo origen** (cabeceras como nginx). Con `--modo=api` sirve `js/config.js` con modo `api` sin tocar el del repo. |
| `mock-api.mjs` | Mock en memoria de la API (cookie, CSRF, errores, paginación, If-Match, lote), con la semilla demo. Solo para probar el cliente sin servidor. **No es el backend.** |
| `api.e2e.mjs` | 6 roles: login por formulario, recorrido de todas las rutas de su menú (0 errores de consola y 0 respuestas >= 400 inesperadas), CRUD permitido, 403/404, CSRF, persistencia por cookie tras recargar, logout, recuperar/restablecer y cambio obligatorio (mock). |
| `local.e2e.mjs` | Regresión del modo local por `file://` (pruebas HTML + 6 roles x rutas x 1280/375 px). |
| `../repo-api.test.mjs` | Unitarias del adaptador con `fetch` simulado: `node --test Educentro/tests/repo-api.test.mjs`. |

## Contra el backend real
```bash
# 1) PostgreSQL 16 en marcha y roles/BD creados (server/README.md, db/roles.sql)
cd Educentro/server && npm ci
# 2) .env con DATABASE_URL (rol educentro_app) y MIGRATION_DATABASE_URL (rol propietario); ALLOWED_ORIGINS=http://127.0.0.1:8099
npm run migrar
npm run semilla-dev | tee /tmp/semilla.txt     # carga la semilla ficticia y un usuario por rol; las contraseñas se imprimen UNA vez (no las versiones)
npm run dev                                    # API en 127.0.0.1:3000
# 3) Servidor de desarrollo web (otra terminal; mismo origen que el proxy)
cd Educentro && node tests/e2e/servidor-dev.mjs --puerto=8099 --api=127.0.0.1:3000
# 4) e2e
BASE_URL=http://127.0.0.1:8099 E2E_CLAVES_FILE=/tmp/semilla.txt node tests/e2e/api.e2e.mjs
```
Credenciales alternativas: `E2E_CLAVE` (la misma para todos) o `E2E_CLAVES_JSON='{"director":"..."}'`; correos distintos con `E2E_EMAIL_<ROL>`. Borra el archivo de contraseñas al terminar.

## Sin backend (mock)
```bash
node tests/e2e/api.e2e.mjs --mock        # arranca mock + servidor-dev en puertos libres; incluye el cambio de contraseña obligatorio
node tests/e2e/mock-api.mjs --puerto=3000   # o solo el mock, para usarlo con servidor-dev a mano
```

## Modo local
```bash
node tests/e2e/local.e2e.mjs
```
Salida: `PASS`/`FAIL` y código de salida 0/1.
