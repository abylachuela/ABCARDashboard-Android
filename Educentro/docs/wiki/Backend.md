# Backend

El servidor vive en `Educentro/server/` (Node.js 22, Fastify 5, PostgreSQL 16, TypeScript, SQL plano sin ORM). Plan completo en `docs/BACKEND.md`; guía de uso en `server/README.md`.

> **Estado: Fase 0 implementada.** Hay autenticación real, pero el frontend todavía **no** la usa y los datos siguen en `localStorage`: sigue sin ser apto para datos reales de estudiantes hasta la Fase 1.

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

## Qué falta
Autorización por rol/centro/alcance y repositorio genérico (Fase 1), notas y auditoría inmutable de calificaciones (Fase 2), resto de módulos, aula, archivos y proxy del agente IA (Fases 3–4), migración de datos y producción (Fase 5), app móvil (Fase 6). También: 2FA, altas por invitación, copia de seguridad fuera de la VM y prueba de restauración.

## Arrancar en local
Ver `server/README.md`: crear roles con `db/roles.sql`, `npm run migrar`, `npm run crear-admin`, `npm run dev`.

Ver también [Seguridad y privacidad](Seguridad-y-privacidad) y [Hoja de ruta](Hoja-de-ruta).
