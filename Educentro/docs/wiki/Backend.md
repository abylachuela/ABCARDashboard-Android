# Backend

El servidor vive en `Educentro/server/` (Node.js 22, Fastify 5, PostgreSQL 16, TypeScript, SQL plano sin ORM). Plan completo en `docs/BACKEND.md`; guía de uso en `server/README.md`.

> **Estado: Fase 0 y Fase 1 (tramo servidor) implementadas.** La API REST de las colecciones, la autorización por rol/centro/alcance y la RLS de PostgreSQL ya existen y están probadas (362 pruebas); contrato en `docs/API-REST.md`. **El cliente ya la usa** con `js/config.js` en modo `api` (login real, datos en PostgreSQL, nada personal en el navegador); el modo `local` (demo) sigue igual. Importar respaldos es la Fase 5.

## Cliente (modo API)
`js/config.js` elige `local`/`api`; `js/data/repo-api.js` implementa la misma interfaz que `repoLocal`. Login con correo y contraseña, cambio obligatorio, `#/recuperar` y `#/restablecer/<token>`. Detalle en `docs/API.md` (Modo API); pruebas en `tests/e2e/README.md`.
>
> Estado de la Fase 0: Hay autenticación real, pero el frontend todavía **no** la usa y los datos siguen en `localStorage`: sigue sin ser apto para datos reales de estudiantes hasta la Fase 1.

## Qué hay hoy
- **Autenticación** en `/api/v1/auth`: `login`, `logout`, `me`, `cambiar-clave`, `recuperar`, `restablecer`. Más `GET /api/health` y `GET /api/v1/ping`.
- **Sesión** en cookie opaca `__Host-edu_sid` (HttpOnly, Secure, SameSite=Lax): caduca a las 12 h o tras 2 h sin actividad, se rota al entrar y se revoca por completo al cambiar o restablecer la contraseña. En la base de datos solo se guarda su hash.
- **Contraseñas** con argon2id, mínimo 10 caracteres, sin claves comunes ni el correo. **Bloqueo** por usuario tras 5 fallos (15 min, creciente) y límite de intentos por IP. Las respuestas no permiten saber si un correo existe.
- **CSRF**: cabecera `X-EDU-CSRF` y comprobación de `Origin`.
- **Auditoría de accesos** (`login_ok`, `login_fallo`, `logout`, `bloqueo`, `cambio_clave`, `recuperacion_solicitada`, `restablecida`) en una tabla de solo anexado, sin contraseñas ni contenido personal.
- **Roles de base de datos**: la API usa `educentro_app`, distinto del propietario de las tablas (`educentro_owner`), para que la seguridad por filas de la Fase 1 le aplique.
- **Docker Compose**: `api`, `db` (sin puerto publicado), `migrar` y `backup` (copia diaria cifrada, retención 30 días).
- **Despliegue**: `deploy.mjs` con `WITH_API=1` añade el proxy `/api/` en nginx (modo solo estático intacto). Opcional: lanzarlo desde GitHub Actions con un runner propio en la VM (`deploy/RUNNER.md`, workflow `deploy-vm.yml`, manual y con aprobación).
- **CI**: `educentro-server.yml` (lint, tipos, 86 pruebas contra PostgreSQL real, `npm audit`).

## Fase 1 (servidor)
- **API genérica** `/api/v1/c/:col` (listar con filtros/orden/paginación, obtener, crear, editar con `If-Match`, borrar lógico, lote de hasta 500), más `/auditoria`, `/comunicados/:id/lectura` y `/respaldo/exportar`.
- **Permisos en el servidor**: fuente única `permisos.json` generada desde `permisos.js` (CI falla si divergen), alcance de docente/tutor/estudiante resuelto en SQL y reglas de propiedad.
- **Aislamiento multi-centro** con RLS en PostgreSQL (rol no propietario; sin contexto no se ve nada) además de la capa de aplicación.
- **Usuarios** sin hash en ninguna respuesta; alta con contraseña temporal; «borrar» desactiva.
- **Auditoría** inmutable de calificaciones y notas por competencias.

## Qué falta
El cliente `repo-api.js` (siguiente tramo), notas y auditoría inmutable de calificaciones (Fase 2), resto de módulos, aula, archivos y proxy del agente IA (Fases 3–4), migración de datos y producción (Fase 5), app móvil (Fase 6). También: 2FA, altas por invitación, copia de seguridad fuera de la VM y prueba de restauración.

## Arrancar en local
Ver `server/README.md`: crear roles con `db/roles.sql`, `npm run migrar`, `npm run crear-admin`, `npm run dev`.

Ver también [Seguridad y privacidad](Seguridad-y-privacidad) y [Hoja de ruta](Hoja-de-ruta).

## Fase 2: notas, periodos y auditoría
El servidor aplica las reglas de notas (periodo cerrado con motivo del director, rangos, pesos = 100, propiedad), calcula con el mismo `calculo.js` del cliente (`calculo-shim`) y expone `GET /notas/resumen`, lotes por fila, `POST /periodos/:id/{cerrar,reabrir}` y `GET /auditoria/verificar` (cadena de hashes por centro; ancla externa con `npm run anclar-auditoria`). Detalle: `docs/API-REST.md` §10 y `docs/BACKEND.md`.

## Fase 3A: reglas de negocio en el servidor
Migración 0010 (UNIQUE parciales y secuencias por centro), validadores en la capa genérica y endpoints transaccionales para matrícula, bajas, vincular tutor, año activo, cursos e inscripciones (cupo, lista de espera con turno del servidor, promoción), currículo (vigente/importar), asistencia por lote, comunicados (visibilidad en el servidor) y horarios (`POST /horarios/guardar` con el motor del cliente cargado por `vm`). Ver [API REST §11](../API-REST.md). Pendiente: agregados y paginación (3B), importación de respaldos (Fase 5).
