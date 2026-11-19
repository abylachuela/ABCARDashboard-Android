# Aula virtual

Rutas: `#/aula` (mis cursos; `?vista=calendario` = entregas pendientes) y `#/aula/:cargaId?tab=contenido|anuncios|tareas|cuestionarios|foros|progreso`. Código: `aula.js`, `aula-util.js`, `aula-quiz.js`, `css/aula.css`. Diseño móvil primero.

## Concepto
Un **curso virtual = una carga** (sección + asignatura). El docente lo activa con «Crear curso virtual». Hasta que lo active, estudiantes y tutores ven "Aún no hay cursos virtuales"; director, secretaría y admin_red tienen solo lectura. El tutor ve lo de su hijo.

## Pestañas
- **Contenido**: temas (con orden) y recursos de texto, enlace (solo http/https) o archivo (data URL ≤ 500 KB, MIME pasivo).
- **Anuncios**.
- **Tareas**: instrucciones, fecha/hora límite, puntos, entrega tardía opcional, entrega de texto/enlace/archivo, calificación y retroalimentación.
- **Cuestionarios**: banco de preguntas (opción múltiple y verdadero/falso), intentos máximos, tiempo opcional (autoenvío al vencer), regla `mejor|ultimo|promedio`, autocalificación y revisión.
- **Foros**: hilos y respuestas.
- **Progreso**: tareas entregadas y cuestionarios completados.

## Integración con calificaciones y currículo
Al calificar una tarea (o «Enviar notas al libro» en un cuestionario) se crea una actividad `act_aula_<id>` (`origen:'aula'`) y la calificación correspondiente, **sin redondear**, con auditoría. Un periodo cerrado bloquea la escritura. Tema, recurso, tarea y cuestionario pueden vincularse a una secuencia (`secuenciaId`) e indicadores (`indicadorIds`).

## Colecciones
`aulaContenidos` (`tipo`: `curso|tema|texto|enlace|archivo|banco`), `tareas`, `entregas` (`ent_<tarea>_<est>`), `cuestionarios`, `intentos` (`int_<quiz>_<est>_<n>`), `foros`, `foroMensajes`, `anuncios`. Campos completos en `docs/API.md` §12 (Aula virtual).

## Limitaciones
- Sin backend: sin sincronización entre usuarios ni notificaciones push.
- El cuestionario viaja con las respuestas correctas al navegador del estudiante; el estudiante podría alterar `puntos/estado` de su entrega desde la consola.
- Los estudiantes no pueden escribir `calificaciones`: las notas de cuestionario las envía el docente.
- Archivos en `localStorage` (cuota ~5 MB, con aviso).
- Un curso `cursosExtra` de tipo `virtual` solo enlaza a `#/aula` en general; **no abre un curso virtual propio con los inscritos como participantes** (pendiente, ver [Hoja de ruta](Hoja-de-ruta)).
