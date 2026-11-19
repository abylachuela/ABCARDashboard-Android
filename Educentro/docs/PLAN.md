# Plan: Educentro (gestión de notas y centros educativos)

Vanilla HTML/CSS/JS (ES modules, sin build), datos en localStorage con capa de repositorio aislada para migrar a API.

## Roles
- Admin de red: centros, directores, reportes consolidados.
- Director: config del centro, años/periodos, escala, cierre de periodo.
- Docente: solo sus secciones; notas y asistencia.
- Secretaría: estudiantes, matrícula, boletines (notas solo lectura).
- Estudiante/Tutor: solo lectura de lo propio.
- Todo dato lleva `centroId`; la sesión fija el centro activo.

## MVP
Centros, años/periodos, cursos/secciones, asignaturas, cargas docentes, estudiantes/tutores, matrícula, calificaciones ponderadas por periodo, boletín imprimible, reporte básico, respaldo JSON.

## Fase 2
Asistencia, comunicados, reportes avanzados, portal tutor, auditoría de notas, adaptador API, PWA.

## Modelo de datos
Centro, Usuario, AnioLectivo, Periodo(peso), Curso, Seccion, Asignatura, Carga(seccion+asignatura+docente), Docente, Estudiante, Tutor, Matricula, Escala(min,max,notaMinAprobar,tramos), Categoria(peso), Actividad(puntosMax), Calificacion, Asistencia, Comunicado, Auditoría.

## Reglas de cálculo
- Nota actividad = puntos/puntosMax × max de escala.
- Categoría = Σpuntos/ΣpuntosMax (sin nota se excluye).
- Asignatura/periodo = Σ(cat×peso)/Σ(pesos con notas); pesos suman 100%.
- Final = ponderado por peso de periodos con nota.
- Redondeo solo al mostrar. Aprobado si final ≥ notaMinAprobar.

## Estructura
index.html, css/, js/{app,router,estado,core,data,ui,vistas}, tests/calculo.test.html

## Fases
0 Base y semilla · 1 Estructura académica y permisos · 2 Personas y matrícula · 3 Calificaciones y cierre · 4 Boletín y reportes · 5 Asistencia/comunicados · 6 API y PWA.

## Módulo: Planificación de clases + Agente IA (añadido)

### Planificación
- Entidades: `PlanClase` (cargaId, fecha, tema, objetivos, competencias, actividades[{fase: inicio|desarrollo|cierre, minutos, descripcion}], recursos, evaluacion/rubrica, tarea, estado: borrador|listo|impartido), `Horario` (cargaId, dia, hora).
- Pantallas: calendario semanal, lista de planes, editor de plan, duplicar a otra semana, cobertura curricular.
- Permisos: docente edita sus planes; director/secretaría lectura; el plan impartido queda bloqueado salvo director.

### Agente IA (configuración)
- `AgenteConfig` por centro y por docente: activo, nombre, proveedor/modelo, modo de autonomía (`sugiere` | `sugiere_y_aprueba` | `ejecuta_con_registro`), tareas habilitadas, tono/nivel, instrucciones, límites.
- Tareas: generar plan, proponer actividades, crear rúbricas, redactar comunicados, resumir rendimiento, borrador de notas.
- Reglas de seguridad:
  - La API key vive solo en el servidor (proxy backend); el navegador nunca la recibe ni la guarda.
  - Cambiar notas siempre exige aprobación humana, aunque el modo sea `ejecuta_con_registro`; no toca periodos cerrados.
  - Todo lo que hace el agente queda en `AgenteLog` {quién, cuándo, tarea, entrada, salida, aprobado_por}.
  - Datos personales de estudiantes: minimizar y anonimizar en los prompts; requiere consentimiento del centro.
- Fase: planificación manual en Fase 3; agente simulado en prototipo; integración real (backend + API) en Fase 6.

## Módulo: Currículo MINERD y Secuencias didácticas (añadido)

### Currículo (versionado)
- Catálogo por nivel (Inicial/Primario/Secundario), ciclo, grado, modalidad, área/asignatura: competencias fundamentales y específicas, contenidos (conceptos, procedimientos, actitudes/valores), indicadores de logro, ejes transversales.
- `CurriculoVersion` {id, nombre, fuente(url), fechaPublicacion, vigenteDesde, estado: vigente|anterior|borrador, hash}. Importar nueva versión desde JSON, comparar (diff por id) y marcar vigente. Cada dato lleva fuente y estado de verificación (verificado|pendiente).
- Actualización: el navegador no puede leer el sitio oficial; se importa un archivo y se avisa para revisión periódica (opcional: tarea programada con agente que proponga cambios, aprobación humana siempre).
- Detalle de lo verificado y las lagunas: docs/CURRICULO-MINERD.md.

### Secuencia didáctica (por unidad/situación de aprendizaje)
- `SecuenciaDidactica`: cargaId, titulo, curriculoVersionId, area, grado, competenciasFundamentales[], competenciasEspecificas[], contenidos[], indicadoresLogro[], situacionAprendizaje/problematica, fases[{nombre: inicio|desarrollo|cierre, actividades[], estrategias, recursos, tiempo}], sesiones[] (planes de clase vinculados), evaluacion {tecnicas, instrumentos, criterios}, adecuaciones/inclusión, estado.
- Vínculos: secuencia → planes de clase (`PlanClase.secuenciaId`) → actividades evaluables del libro de notas; cobertura de indicadores por periodo.
- Editor guiado: elegir grado/área → seleccionar competencias/indicadores del currículo vigente → el agente IA sugiere actividades y evaluación (siempre con aprobación) → exportar/imprimir en formato de centro.
- Pendiente de verificar con fuente oficial: formato exacto de la secuencia didáctica MINERD (campos y nombres de fases) antes de darlo por definitivo.
