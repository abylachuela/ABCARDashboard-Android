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

## Pendiente
Versionar los scripts de smoke/XSS/aislamiento y ejecutarlos en CI ([Hoja de ruta](Hoja-de-ruta)). No hay pruebas automáticas de los módulos de aula, horarios y cursos más allá del smoke.
