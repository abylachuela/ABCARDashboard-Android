# Modelo de datos

Colecciones (`EDU.repoLocal.COLECCIONES`): `centros usuarios anios periodos cursos secciones asignaturas cargas docentes estudiantes tutores matriculas escalas categorias actividades calificaciones asistencia comunicados planes horarios agenteConfig agenteLog auditoria notasCompetencia curriculoVersiones curriculoContenidos secuencias franjas disponibilidad cursosExtra inscripciones aulaContenidos tareas entregas cuestionarios intentos foros foroMensajes anuncios`. Todo registro (salvo `centros`) lleva `centroId`, `id`, `creadoEn`, `actualizadoEn`.

## Estructura académica
- `centros`: nombre, código, ciudad, regional, distrito, nivel, color, director.
- `usuarios`: centroId (null = admin_red), nombre, email, rol, `refId` (docente/estudiante/tutor).
- `anios`: nombre, inicio, fin, activo. `periodos`: anioId, orden, nombre, **peso** (suman 100), inicio, fin, `cerrado`.
- `cursos` (grados escolares): nombre, nivel (`Inicial|Primario|Secundario`), grado, ciclo, modalidad (`General|Técnico-Profesional|Artes|null`). **No confundir** con `cursosExtra`.
- `secciones`: cursoId, anioId, nombre, tanda, capacidad. `asignaturas`: codigo, nombre, color.
- `cargas`: anioId, seccionId, asignaturaId, docenteId, `horasSemana`.
- `docentes`, `estudiantes`, `tutores` (`estudianteIds[]`), `matriculas` (estudianteId, seccionId, anioId, estado `activa|…`).
- `escalas`: min, max, `notaMinAprobar` (70), decimales, tramos `[{desde, etiqueta, letra}]`, activa, **`modelo`** (`ponderado` | `competencias`) y `competencias` (configuración del modelo por competencias).

## Calificaciones
- Modelo ponderado: `categorias` (cargaId, nombre, peso; suman 100 por carga), `actividades` (cargaId, categoriaId, periodoId, nombre, puntosMax, fecha), `calificaciones` (`cal_<act>_<est>`: actividadId, estudianteId, `puntos` o `null`, comentario). Las actividades creadas desde el aula llevan `origen:'aula'`.
- Modelo por competencias: `notasCompetencia` (`nc_<cargaId>_<estudianteId>`): `c:[{p:[P1..P4], rp:[RP1..RP4]} × 4]`, `cec`, `cex`, `esp`. Null = sin nota; nunca se redondea al guardar.
- `auditoria`: usuarioId, rol, accion, coleccion, registroId, antes, despues, fecha. Solo se escribe con `EDU.repo.auditar` o automáticamente por el repo.

## Asistencia y comunicación
- `asistencia` (`ast_<est>_<fecha>`): seccionId, estudianteId, fecha, estado `P|A|T|J`, justificación.
- `comunicados`: titulo, cuerpo, destinatarios (`todos|docentes|tutores|estudiantes`), segmento (`centro|curso|seccion|tutor`), estado `borrador|publicado`, `lecturas[]`, origen/agenteLogId.

## Planificación y currículo
- `planes`: cargaId, docenteId, fecha, tema, objetivos, competencias, actividades por fase, recursos, evaluación, estado `borrador|listo|impartido`, `secuenciaId`, `indicadorIds`.
- `secuencias`: ver [Módulos](Modulos#secuencias-didácticas). `curriculoVersiones` y `curriculoContenidos`: ver [Currículo MINERD](Curriculo-MINERD).

## Horarios, cursos, aula
- `franjas` (también guarda un registro `tipo:'config'`), `horarios`, `disponibilidad`: ver [Horarios](Horarios).
- `cursosExtra`, `inscripciones`: ver [Cursos y talleres](Cursos-y-talleres).
- `aulaContenidos`, `tareas`, `entregas`, `cuestionarios`, `intentos`, `foros`, `foroMensajes`, `anuncios`: ver [Aula virtual](Aula-virtual).

## Agente
`agenteConfig` y `agenteLog`: ver [Agente IA](Agente-IA).

## IDs estables de la semilla
`cen_1`, `ani_1_2026`, `per_1_1`, `cur_1_1`, `sec_1_1A`, `asg_1_mat`, `car_<sec>_<area>`, `doc_1_01`, `est_1_01`, `tut_1_01`, `mtr_est_1_01`, `cat_<carga>_tar`, `act_<carga>_<p>_<k>`, `cal_<act>_<est>`, usuarios `usr_*`.
