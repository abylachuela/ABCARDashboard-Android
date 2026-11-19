# Plan del backend de Educentro

Estado: **Fase 0 implementada y Fase 1 (tramo servidor) implementada** (ver «Estado de la Fase 0» abajo); las Fases 1–6 siguen siendo plan. Sustituye el almacenamiento en `localStorage` por un servidor real con control de acceso en el servidor (el punto crítico de `SEGURIDAD.md`). Repositorio privado de GitHub; una sola VM Linux; datos de menores.

## Estado de la Fase 0 (implementada en `Educentro/server/`)
Hecho y probado con PostgreSQL 16 real (86 pruebas, lint y typecheck limpios, `npm audit --omit=dev` sin vulnerabilidades): configuración validada (`src/config.ts`), migraciones SQL con ejecutor transaccional, `centros`/`usuarios`/`sesiones`/`tokens_recuperacion`/`auditoria_accesos` (append-only), autenticación bajo `/api/v1/auth` (login, logout, me, cambiar-clave, recuperar, restablecer), `/api/health`, `/api/v1/ping`, CLI `crear-admin` y `semilla-dev`, Dockerfile, `compose.yml` (api, db, migrar, backup), `deploy.mjs` con `WITH_API=1` (probado con nginx real) y CI (`.github/workflows/educentro-server.yml`). Guía de uso: `server/README.md`.

**Lo que difiere del plan**
- **Sin ORM**: SQL plano con `pg` y un ejecutor de migraciones propio (en lugar de Drizzle/Kysely); validación con Zod (no TypeBox).
- **Cookie `Path=/`**, no `Path=/api`: el prefijo `__Host-` lo exige. Nombre `__Host-edu_sid` (en desarrollo `edu_sid`, sin `Secure`).
- **CSRF**: el token es un HMAC (de `SESSION_SECRET`) ligado a la sesión, devuelto en el cuerpo de login/me y enviado en `X-EDU-CSRF`; no hay cookie de doble envío. Además se comprueba `Origin` en todo método no seguro.
- **Bloqueo por usuario** con retroceso (5 fallos → 15 min, luego 30, 60…); la IP se limita con rate limit (en la API y en nginx), no se bloquea «usuario+IP».
- **Migraciones**: no se aplican al arrancar `api`; las ejecuta el servicio `migrar` de Compose (rol propietario) antes de `api`. El respaldo previo sigue siendo manual.
- **`TRUST_PROXY`** exige lista de IP/CIDR (Fastify 5 no admite «nº de saltos» de forma segura).
- **Cuerpo máx. 1 MB** también en nginx (`/api/`); el límite de 12 MB para subidas llega con la Fase 4.
- **Auditoría**: la Fase 0 solo crea `auditoria_accesos` (accesos); la tabla `auditoria` de calificaciones con `antes/despues` es de la Fase 2.
- **`cambiar-clave`** revoca todas las sesiones y emite una nueva para el dispositivo actual.
- **Pruebas** contra un PostgreSQL local (no Testcontainers/Docker); en CI, servicio `postgres`.
- **Copias**: `pg_dump` + gzip + GPG AES-256 diario con retención de 30 días; **la copia fuera de la VM y la prueba de restauración trimestral siguen pendientes**. WAL/PITR no está implementado.
- **No hecho aún** (según el plan): altas por invitación desde la API, 2FA, autorización por rol/centro/alcance, RLS por colección, repositorio genérico y `repo-api.js` (Fase 1).
- **No probado aquí**: `docker build`/`docker compose up` (sin daemon de Docker en el entorno; solo se validó `docker compose config`, y se ejecutaron por separado `backup.sh`, `db/roles.sql`, el build de producción con `npm ci --omit=dev` y la API detrás de nginx real), SMTP real, Let's Encrypt.

## Estado de la Fase 1, tramo servidor (implementado en `Educentro/server/`)
Hecho y probado con PostgreSQL 16 real (362 pruebas: las 86 de la Fase 0 + paridad de permisos, RLS directa en SQL, matriz de 6 roles × 39 colecciones × 5 acciones, aislamiento entre centros, alcance docente/tutor/estudiante, escalada, mass-assignment, inyección en filtros/orden, límites, 409 optimista, CSRF/Origin, auditoría inmutable y ausencia de hashes). Contrato: `docs/API-REST.md`. **El frontend aún no usa la API** (`repo-api.js` es el tramo cliente).

**Lo que difiere del plan**
- **Tablas genéricas** (`id, centro_id NOT NULL FK, datos jsonb, creado_en, actualizado_en, borrado_en`) en lugar de columnas por campo; las columnas «calientes» se normalizan después. Índices por `centro_id` y expresiones sobre `datos` (calificaciones, actividades, cargas, matrículas, asistencia…); sin GIN (no se justifica aún). Únicos de negocio: calificaciones y asistencia. `centro_id` es `NOT NULL` (el plan decía nulo): todo registro pertenece a un centro.
- **Colecciones**: son 39 (no 37) en `repo-local.js`; 36 con tabla genérica, `centros` con tabla propia (+`datos`), `usuarios` proyectada sobre la tabla de autenticación y `auditoria` en tabla append-only.
- **RLS**: ENABLE+FORCE en las 36 tablas y `auditoria`; `centros` solo ENABLE; **`usuarios`/`sesiones`/`tokens_recuperacion` sin RLS** (login previo al contexto), protegidas por la capa de aplicación y pruebas.
- **Borrado lógico** para todas las colecciones (la API no tiene `DELETE`); `usuarios` se desactiva.
- **Lectura por colección**: `agenteConfig`, `agenteLog`, `planes`, `secuencias` y `auditoria` no las lee cualquier rol (ver API-REST §3). Alcance de lectura aplicado en SQL también en listados; edición/borrado de un registro fuera de alcance responde `404`.
- **Auditoría automática** de calificaciones y notasCompetencia en la misma transacción; `exportar_respaldo` también se audita. La auditoría con periodos cerrados/recalculo de notas sigue siendo Fase 2.
- **Alta de usuarios**: contraseña temporal aleatoria devuelta una vez (no hay invitación por correo todavía; el mailer solo envía recuperación).
- **Lote**: 500 registros máx., pero el cuerpo sigue limitado a 1 MB. `cuestionarios.correcta` aún viaja al estudiante (rediseño en Fase 4). `respaldo/importar` → 501 (Fase 5).
- **No probado aquí**: despliegue con Docker, CI real en GitHub (se ejecutó el mismo flujo localmente), rendimiento con volúmenes grandes, y el cliente (`repo-api.js`).

## Lo que condiciona el diseño (hallazgos del código actual)
- `EDU.repo` (`js/data/repo.js`) ya actúa de controlador: centro activo, escritura por colección (`ESCRIBE`), propiedad (docente→sus cargas, estudiante→lo propio), auditoría de calificaciones, `auditar`, `registrarLectura`, `exportarTodo/importarTodo`. Casi todo se traslada 1:1 al servidor.
- Un adaptador nuevo debe cumplir la interfaz de `repo-local.js`: `listar`, `obtener`, `guardar`, `guardarMuchos`, `borrar`, `exportarTodo`, `importarTodo`. Hay 37 colecciones; filtro/orden/límite se aplican hoy en el cliente.
- `calculo.js`, `escala.js` y `planilla.js` son IIFE sobre `window.EDU` sin `module.exports`: se reutilizan en Node con un shim, sin reescribirlas. Hoy los tests son HTML.
- El agente ya define el contrato HTTP: `POST /api/agente/solicitar {version:1, tarea, contexto, modelo, tono}`.
- CSP actual `connect-src 'self'`: si nginx sirve web y `/api` en el mismo origen **no cambia**. Solo la app Android añade el dominio.
- `deploy.mjs` ya genera la configuración de nginx y hace versiones atómicas. La app móvil usa el origen `https://localhost` (Capacitor).

## 1. Stack recomendado
**Node.js 22 LTS + Fastify + PostgreSQL 16 + Drizzle ORM (o Kysely), TypeScript**, validación con Zod/TypeBox, migraciones SQL versionadas en el repo.

Por qué PostgreSQL y no SQLite: Row Level Security para el aislamiento multi-centro (requisito crítico con datos de menores), concurrencia de escritura (varios docentes cerrando notas), `pg_dump` + WAL para copias y recuperación a un punto en el tiempo, JSONB para registros flexibles (`tramos`, `competencias`, `contexto`). SQLite solo valdría con un único centro, y migrar luego duele.
Escalar cuando la VM sea cuello de botella (orden de >50 centros activos o >500 usuarios concurrentes): PostgreSQL gestionado y réplica de lectura.

## 2. Arquitectura
```
cliente → nginx :443 → /          estático (current/)
                     → /api/      proxy_pass http://127.0.0.1:3000 (Fastify) → PostgreSQL (solo local)
                     → /archivos/ descargas autorizadas (X-Accel-Redirect interno)
```
- **Procesos:** Docker Compose con `api`, `db` y `backup` (no se conoce la distro; Docker aísla). Alternativa: systemd + PostgreSQL del paquete. `deploy.mjs` gana un `location /api/` (proxy con `X-Forwarded-*`, `client_max_body_size 12m`, `limit_req`) y un `docker compose up -d`.
- **Estructura (monorepo):** `Educentro/server/{src/{app.ts,config.ts,plugins,routes,domain,db,storage}, test, Dockerfile, compose.yml, .env.example}`.
- **Permisos como fuente única:** extraer `MATRIZ` y `ESCRIBE` de `permisos.js` a `server/src/domain/permisos.json`, validado en CI contra `permisos.js`.
- **Secretos:** `.env` o Docker secrets en la VM (`/etc/educentro/`, modo 600, fuera del repo). Variables: `DATABASE_URL`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`, SMTP. El repo solo lleva `.env.example`. Activar secret scanning de GitHub y pre-commit con gitleaks.

## 3. Autenticación y sesiones
- Sesión con cookie opaca (256 bits, guardada en BD), `HttpOnly; Secure; SameSite=Lax; Path=/api`, prefijo `__Host-`. Mejor que JWT: revocable y sin CORS (mismo origen).
- App Android: tokens opacos de acceso+refresco en el almacén seguro del sistema (Keystore vía plugin de Capacitor), nunca en `localStorage`.
- Contraseñas con argon2id. Bloqueo por usuario+IP con backoff, respuestas genéricas (sin enumerar usuarios), rate limit en `/auth/*`.
- Recuperación: token de un solo uso con hash en BD, caduca en 30 min, por correo.
- Altas: las hace el director (su centro) o `admin_red`, por invitación con cambio de contraseña obligatorio. 2FA (TOTP) obligatorio para `admin_red` y director en una fase posterior.
- CSRF: SameSite=Lax + cabecera `X-EDU-CSRF` (doble envío) en métodos no seguros + comprobación de `Origin`. CORS desactivado en web; en Capacitor solo `https://localhost`.
- Cliente: el login deja de leer `usuarios` sin sesión; `POST /api/auth/login` devuelve `{usuario, centroUsuario, rol, refId}` y `GET /api/auth/me` sustituye la comprobación contra `localStorage['edu:sesion']`.

## 4. Autorización en el servidor
Capa única `puede(sesion, col, accion, registro)`, en este orden: (1) rol/colección (`ESCRIBE`, `MATRIZ`); (2) centro (admin_red cualquiera, el resto el suyo); (3) alcance (docente→sus cargas; tutor→sus hijos; estudiante→él mismo, resuelto con consultas); (4) propiedad (reglas de `propiedad()`).

**Aislamiento multi-centro en profundidad:** columna `centro_id` en todas las tablas y **RLS de PostgreSQL** (`SET LOCAL app.centro_id/app.rol` en cada transacción); el usuario de BD de la API no es dueño de las tablas (para que RLS aplique); la capa de acceso impide consultas sin contexto de centro.

**Reglas que viven solo en el servidor**
- Periodo cerrado: el docente no escribe; el director edita con motivo obligatorio y auditado.
- Cálculo de notas con `calculo.js` reutilizado; el servidor valida pesos (suman 100) y rangos y recalcula el final.
- Auditoría inmutable: tabla append-only (`REVOKE UPDATE, DELETE` + trigger); `usuarioId`, `rol` y fecha los fija el servidor.
- Cuestionarios: la respuesta `correcta` nunca sale al estudiante; el servidor califica los intentos, aplica límites y crea la calificación.
- Entregas: el estudiante solo las suyas. Comunicados: solo `lecturas` propias.
- Agente: `borrador_notas` solo celdas vacías y nunca periodos cerrados, revalidado al aprobar.

## 5. API REST (`/api/v1`, JSON, validado por esquema)
**Genérico (equivale a `EDU.repo`):** `GET /c/:col` (filtros simples, orden, límite/offset), `GET /c/:col/:id`, `POST /c/:col`, `PUT /c/:col/:id`, `POST /c/:col/lote` (transaccional), `DELETE /c/:col/:id`.
**Específico:** `/auth/{login,logout,recuperar,restablecer,cambiar-clave,me}`; `/notas/resumen`, `/notas/calificaciones/lote`, `/notas/competencias/...`; `POST /periodos/:id/{cerrar,reabrir}`; `/auditoria` (alta con lista blanca de campos; lectura); `POST /comunicados/:id/lectura`; `POST /importar/planilla` y `GET /exportar/planilla`; `/aula/cuestionarios/:id` (sin `correcta`) y `/aula/cuestionarios/:id/intentos`; `/archivos`; `POST /agente/solicitar` y `GET /agente/uso`; `/respaldo/{exportar,importar}` (director/admin_red, por centro).
- **Importar planilla en el servidor:** ExcelJS o SheetJS ≥0.20.3 (en servidor sí se puede instalar y auditar con `npm audit`), con los límites actuales (10 MB, 40 hojas, 1500 filas) en un `worker_thread` con timeout. Desaparece el riesgo de SheetJS del navegador. Se reutiliza la lógica de `planilla.js`; el cliente muestra la vista previa del servidor y confirma con un segundo POST.
- **Agente IA:** la API key solo en el servidor; se vuelve a anonimizar y validar el contexto; límite diario por usuario y centro; exige `consentimientoDatos`; valida la salida (incluido el esquema de horario); registra cada llamada en `agenteLog` sin contenido personal.
- **Límites:** cuerpo 12 MB solo en subida de archivos (1 MB en el resto); paginación obligatoria (máx. 500); rate limit por usuario.

## 6. Cliente
- `js/data/repo-api.js` con la misma interfaz que `repoLocal`, activado con `EDU.repo.usar(EDU.repoApi)`. Los permisos del cliente siguen para la experiencia de uso; **el servidor es la autoridad**.
- Errores: 401→login; 403→«Sin permiso»; 409→conflicto (control optimista con `actualizadoEn`); 422→errores de campo; 429→reintento. Mensajes en español sin detalles internos.
- Caché en memoria por sesión, invalidada tras escribir. Sin cifrar en disco solo datos no personales (`asignaturas`, `escalas`, `curriculo*`, `franjas`).
- Android sin conexión (MVP): lectura de lo cacheado y cola de escrituras **no sensibles** (asistencia, borradores de planes). Las notas requieren conexión. Datos personales en el dispositivo solo cifrados y borrados al cerrar sesión.
- Migración desde `localStorage`: el director sube su respaldo → `POST /respaldo/importar` valida esquema, `centroId` y referencias, remapea ids en choque y devuelve un informe (dry-run) antes de confirmar. Se rechazan usuarios `admin_red` y registros de otro centro. Las contraseñas no se migran: se envían invitaciones.

## 7. Modelo relacional
Una tabla por colección; `id text PK` (se conservan los ids actuales), `centro_id` FK, `creado_en`, `actualizado_en`, `borrado_en` (soft delete salvo auditoría).
- Núcleo: `centros`, `usuarios` (hash, rol, `centro_id` nulo para admin_red, `ref_id`, `bloqueado_hasta`, `intentos`), `sesiones`, `tokens_recuperacion`.
- Académico: `anios`, `periodos`, `cursos`, `secciones`, `asignaturas`, `cargas`, `docentes`, `estudiantes`, `tutores` + `tutor_estudiante`, `matriculas`, `escalas` (JSONB).
- Notas: `categorias`, `actividades`, `calificaciones` (único actividad+estudiante), `notas_competencia` (JSONB).
- Resto: `asistencia` (único sección+estudiante+fecha), `comunicados` + `comunicado_lecturas`, `planes`, `horarios`, `franjas`, `disponibilidad`, `cursos_extra`, `inscripciones`, `curriculo_*`, `secuencias`, `agente_config`, `agente_log`.
- Aula: `aula_contenidos`, `tareas`, `entregas`, `cuestionarios` (`correcta` en columna aparte, nunca serializada al estudiante), `intentos`, `foros`, `foro_mensajes`, `anuncios`.
- `auditoria` append-only, con `antes/despues` JSONB, particionable por mes.
- Índices `(centro_id, …)` en todas; `(carga_id)`, `(estudiante_id)`, `(seccion_id, fecha)`, `(actividad_id)`.
- Archivos: disco (`/var/lib/educentro/archivos/<centro>/<uuid>`, fuera del webroot) con metadatos (hash, MIME, tamaño, dueño); interfaz intercambiable a S3 compatible; ClamAV opcional. Los adjuntos `data:` actuales se migran a archivos.
- Migraciones SQL versionadas aplicadas al arrancar `api`, con respaldo previo; nunca destructivas sin copia.

## 8. Seguridad y cumplimiento
- Tránsito: TLS 1.2+ con Let's Encrypt (requiere dominio) y HSTS; API↔BD solo local. Reposo: disco cifrado y copias cifradas (`age`/`gpg`).
- Copias: `pg_dump` diario + WAL, retención 30 días, copia **fuera de la VM**, **prueba de restauración trimestral documentada**.
- Registro de accesos (login, acceso a datos de menores, exportaciones) sin contenido personal en los logs.
- Retención y borrado por tipo de dato (a decidir con los centros); anonimización de egresados.
- Minimización y consentimiento del centro (`consentimientoDatos`) y del tutor para datos de menores y para el agente IA, que solo recibe alias.
- **Ley 172-13 (República Dominicana, protección de datos personales):** es el marco a considerar. **Su alcance exacto (consentimiento, transferencias a terceros como el proveedor de IA, registro de bases de datos, plazos) debe validarse con asesoría legal; este documento no afirma detalles legales.**
- Dependencias: `npm audit` y Dependabot en CI, imágenes base con parches, actualizaciones automáticas del SO, lockfile.
- Endurecimiento: SSH solo con clave, cortafuegos 80/443, usuario no root en el contenedor, fail2ban, `limit_req` en nginx.

## 9. Calidad
- Unitarias: `calculo.js` y `escala.js` bajo Node con el shim (portar los 28 casos), validadores de esquema.
- **Permisos por rol:** batería parametrizada que recorre `MATRIZ × ESCRIBE × alcance` y ejecuta la misma matriz contra la API (6 roles × 37 colecciones × acciones), con intentos entre centros, docente fuera de su carga, tutor fuera de sus hijos y escalada de rol. Falla el build si `permisos.json` diverge de `permisos.js`.
- Integración: Vitest + Testcontainers con PostgreSQL real y RLS activa. E2E: Playwright contra el backend de pruebas (versionar los smoke por rol, el fuzz XSS y el aislamiento entre centros, hoy fuera del repo).
- CI en GitHub Actions: lint, tipos, tests, `npm audit`, build de imagen. **Repositorio privado: los minutos de Actions son limitados**; valorar un runner propio en la VM aislado.
- Despliegue: extender `deploy.mjs` (`docker compose pull/up`), migraciones con respaldo automático, health check `/api/health` y rollback (migraciones expandir/contraer para poder volver).

## 10. Fases
| Fase | Contenido | Criterios de aceptación | Esfuerzo |
|---|---|---|---|
| 0 | Base: Compose, Fastify, PostgreSQL, migraciones, nginx `/api`, CI, auth (login, sesiones, bloqueo, recuperación), `/health` | Login real, cookie segura, rate limit, CI verde, despliegue reproducible | M |
| 1 | Repositorio genérico + permisos + RLS + `repo-api.js` | La batería de permisos pasa contra la API; ningún acceso entre centros; la app corre con `EDU.repo.usar(repoApi)` | L |
| 2 | Notas, cálculo, periodos cerrados, auditoría inmutable | `resumenNotas` igual al cliente en los casos de prueba; periodo cerrado rechazado; auditoría no editable | M |
| 3 | Resto de módulos (personas, matrícula, horarios, asistencia, comunicados, currículo, reportes) | Todos los roles recorren su interfaz sin errores; E2E por rol | L |
| 4 | Aula, archivos, cuestionarios en servidor, proxy del agente IA, importar planilla | `correcta` nunca llega al estudiante; archivos autorizados; agente con límites y registro; la planilla importa como hoy | L |
| 5 | Migración y producción: importación validada, copias cifradas, prueba de restauración, endurecimiento, monitoreo | Un centro piloto migrado; restauración probada; informe de seguridad actualizado | M |
| 6 | Móvil: URL de API en Capacitor, tokens en Keystore, CSP `connect-src`, caché/offline limitado | APK firmado conecta por HTTPS; sin datos personales sin cifrar en disco | M |

## Riesgos principales
- Divergencia entre `permisos.js` y el servidor (mitigar con fuente única y test de paridad).
- Datos de menores en una sola VM sin redundancia (copias externas obligatorias).
- Cálculo duplicado cliente/servidor (el servidor es la autoridad; test de paridad).
- Latencia: el cliente carga colecciones enteras con `EDU.consultas.cargar`; hará falta filtrar y paginar en el servidor.
- Cuestionarios con respuestas hoy en el cliente: rediseño del flujo.
- Importar planilla es superficie de ataque: worker aislado y límites.
- Capacidad del equipo para operar y parchear la VM.

## Decisiones pendientes del usuario
1. **Hosting:** VM actual o proveedor gestionado; copias fuera de ella.
2. **Dominio** (necesario para Let's Encrypt y para la app móvil).
3. **Base de datos:** confirmar PostgreSQL (recomendado).
4. **Correo** (SMTP o servicio transaccional) para recuperación de contraseñas e invitaciones.
5. **Retención de datos** y política de borrado por tipo.
6. **Quién administra** (VM, copias, altas de usuarios, incidentes) y responsable de datos por centro.
7. **Proveedor de IA** y aceptación legal del envío de datos anonimizados (validar con asesoría).
8. Si se exigirá **2FA** a director y admin_red.
