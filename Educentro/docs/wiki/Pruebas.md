# Pruebas

## Pruebas unitarias en el navegador
Se abren por `file://`; el título de la pestaña es `PASS` o `FAIL`, el resultado está en `#res` y `window.__resultado`.
- `tests/calculo.test.html`: **28/28** — redondeo half-up, nota de actividad (0–100 y 0–10), categoría (suma de puntos, exclusión de notas ausentes, ponderación por puntosMax), ponderación de asignatura y periodos, borde de aprobación exacto sin redondear, validarPesos, escala y tramos, `EDU.fmt.nota`, `EDU.esc`, y el modelo por competencias (regla RP, CF, completiva 50/50, extraordinaria 30/70, estados).
- `tests/planilla.test.html`: **10/10** con datos ficticios — lectura de libros, validaciones de tamaño/firma/componentes, aborto por contaminación de prototipos, rechazo de macros y enlaces externos, exportación e ida y vuelta.

## Cómo se probó con Playwright (Chromium, `file://`)
Los resultados de abajo vienen de `docs/SEGURIDAD.md`; los scripts de Playwright no están versionados en `tests/`.
- Abrir las páginas de `tests/` y leer `#res`.
- **Smoke:** 6 roles × 30 rutas (incluye rutas con parámetros y una inexistente) = 180 visitas, a 1280 px y 375 px, con ambos modelos de calificación: 0 errores de consola (incluidas violaciones de CSP), 0 tarjetas de error, 0 desbordamientos horizontales.
- **XSS:** campos envenenados en todas las colecciones y fixtures del aula, secuencias, planes, comunicados, agente y auditoría; clic en hasta 25 botones por ruta: 0 ejecuciones.
- **Aislamiento por centro y por estudiante:** URL/hash con IDs ajenos y llamadas directas a `EDU.repo`: sin fugas.
- Las capturas de esta wiki se generaron con Playwright sobre la semilla ficticia.

## Versionadas (Fase 1 cliente)
- `node --test Educentro/tests/repo-api.test.mjs`: 18 pruebas del adaptador API con `fetch` simulado.
- `tests/e2e/api.e2e.mjs`: 6 roles contra el servidor real o el mock; `tests/e2e/local.e2e.mjs`: regresión del modo local. Comandos en `tests/e2e/README.md`.

## Pendiente
Versionar los scripts de smoke/XSS/aislamiento y ejecutarlos en CI ([Hoja de ruta](Hoja-de-ruta)). No hay pruebas automáticas de los módulos de aula, horarios y cursos más allá del smoke.

## Fase 2 (servidor)
506 pruebas Vitest con PostgreSQL real: paridad de cálculo (28 casos portados contra servidor y cliente + 6000 generados contra un oráculo), periodo cerrado por rol, rangos, mass-assignment, pesos y cierre, lotes, UNIQUE bajo concurrencia, EXPLAIN con índices, cadena de hashes (concurrencia, manipulación como propietario, ancla) y `/notas/resumen` == cliente con la semilla. e2e de 6 roles con flujo de notas contra el servidor real (`tests/e2e/api.e2e.mjs`).

## Fase 3A (servidor)
741 pruebas Vitest con PostgreSQL real: matrículas, cursos e inscripciones (cupo, lista de espera, promoción), integridad genérica, centros, usuarios, asistencia, planes y secuencias, currículo, horarios (guardado atómico, franjas, paridad servidor↔cliente con semilla fija), visibilidad de comunicados por rol (matriz completa), matriz 6 roles × endpoints nuevos, migración 0010 con datos previos y concurrencia real (20 simultáneas en la última plaza → 1 gana). `tests/e2e/api.e2e.mjs` añade cupo lleno, lista de espera, horario con conflicto rechazado, comunicado no visible y plan impartido bloqueado (139 comprobaciones, 6/6 roles); `tests/repo-api.test.mjs`: 20 pruebas.
