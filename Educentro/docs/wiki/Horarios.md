# Horarios

Ruta `#/horarios`; archivos `horarios-estilos.js`, `horarios-motor.js` (lógica pura y API `EDU.horarios`) y `horarios.js` (vista). Edición: director, secretaría y admin_red (por centro); docente, tutor y estudiante ven su parte.

## Pestañas
**Horario** (grilla L–V por franja; vistas por sección, docente y aula; asignación por arrastre o selección; impresión y CSV), **Cobertura de horas** (horas asignadas vs. `cargas.horasSemana`), **Carga docente** (tope por centro, defecto 25 h, no es regla oficial), **Disponibilidad** y **Franjas y tandas** (matutina, vespertina, extendida; tipos clase, recreo, almuerzo; plantillas de ejemplo editables).

Un centro nuevo no tiene franjas: la vista pide configurarlas primero. Si existen bloques del modelo anterior sin franja, avisa y permite descartarlos.

## Validaciones
Bloquean guardar: docente en dos secciones a la vez, sección con dos asignaturas a la vez, aula duplicada, docente no disponible, franja no válida (recreo o inexistente); chocan por solape de horas el mismo día, incluso entre tandas. Avisos: horas incompletas, exceso, sobrecarga, tanda.

## Propuesta automática
`motor.proponerLocal` (voraz con MRV y retroceso limitado). Se muestra en vista previa; **guardar exige aprobación humana y cero conflictos**.

## API para otros módulos
`EDU.horarios.deHoy(sesion, fecha?)` y `deSemana(sesion, fecha?)` devuelven las clases con alcance por rol (los usa Planificación). Punto de extensión: `EDU.horarios.registrarProponedor(id, {etiqueta, proponer(ctx, opts, contextoMinimo), disponible?, admiteTexto?})`; el contexto mínimo lleva solo ids, horas, franjas, fijos y no disponibilidades (sin nombres) y el resultado se re-valida. Lo usa el proponedor **Agente IA** (`horarios-agente.js`): aparece en el selector del diálogo «Proponer horario» solo si el agente está activo y la tarea habilitada (si no, el diálogo explica por qué), admite una restricción opcional de texto libre (≤ 300 caracteres), muestra la propuesta en la misma vista previa (conflictos, asignaciones descartadas por el esquema, horas sin colocar) y nunca guarda sin aprobación; la resolución queda en el registro del agente.

## Notas
- La colección `franjas` guarda además un registro `{tipo:'config'}` (`cfg_<centroId>`); otros módulos deben ignorarlo (ya corregido en Cursos).
- El choque de horarios de **Cursos y talleres** no se compara con este horario ([Cursos y talleres](Cursos-y-talleres)).
- La tarea `proponer_horario` del [Agente IA](Agente-IA) está conectada como proponedor `agente`.
