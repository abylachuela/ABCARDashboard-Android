# Fase 3 del backend: inventario de reglas que hoy solo aplica el navegador

Inventario de solo lectura hecho antes de empezar la Fase 3. Rutas relativas a `Educentro/js/`. Las líneas son aproximadas y pueden haberse movido.

## Contexto clave
- El servidor actual (`server/src/repo/generico.ts`, migración 0006) es un CRUD genérico sobre JSONB con RLS por centro. Restricciones SQL existentes: `usuarios.email`, `centros.codigo`, `calificaciones` (actividad+estudiante) y `asistencia` (sección+estudiante+fecha) únicos. **Todo lo demás de abajo no está protegido**: cualquier regla "del cliente" se salta con un PUT/POST a `/api/v1/c/:col`.
- Lecturas: `EDU.consultas.cargar` lee colecciones enteras; `repo-api` pagina de 500 en 500 y filtra/ordena en el cliente (el `filtro` y el `limite` no llegan al servidor).
- Varios módulos hacen leer-modificar-escribir sin transacción (carreras).

## Personas (`vistas/personas.js`)
| Regla | Riesgo | Propuesta en servidor |
|---|---|---|
| Cédula única por colección (solo se comprueba contra la lista cargada) | Alto | UNIQUE parcial (centro, documento normalizado) por colección; 409. Decidir si es única entre estudiantes/docentes/tutores |
| Formato de cédula 000-0000000-0, fecha pasada, email | Medio | Validador previo (zod) |
| Código de matrícula `MAT-n-####` autogenerado como max+1 | Alto (colisión) | Secuencia por centro en servidor + UNIQUE |
| Baja de docente bloqueada si tiene cargas | Alto | Validador o `POST /docentes/:id/baja` |
| Baja de estudiante retira su matrícula activa (dos escrituras) | Medio | `POST /estudiantes/:id/baja` transaccional |
| Vincular tutor↔estudiante | Bajo | Endpoint de vincular |
| Carga 8 colecciones enteras para listar | Medio | Endpoints paginados con conteos en SQL |

## Matrícula (`vistas/matricula.js`)
| Regla | Riesgo | Propuesta |
|---|---|---|
| Una matrícula por estudiante y año (cualquier estado) | Alto | UNIQUE (centro, estudianteId, anioId); al reactivar, que no haya otra activa |
| Capacidad de sección (activas ≤ capacidad), también al reactivar y en lote | Alto | `POST /matriculas` (lote) transaccional con `FOR UPDATE` de la sección; 409 «sección completa» |
| Estudiante activo; sección y año del mismo centro; `anioId` coherente con la sección | Alto | Validar coherencia en el endpoint |
| Transición activa⇄retirada (motivo y fecha obligatorios al retirar) | Medio | Endpoints `/retirar` y `/reactivar`; el PUT genérico no cambia `estado` |
| Candidatos pendientes calculados en el cliente | Medio | `GET /matriculas/pendientes` |

## Cursos y talleres (`vistas/cursos.js`, `cursos-logica.js`)
| Regla | Riesgo | Propuesta |
|---|---|---|
| Inscripción duplicada / ya completado | Alto | Validar en servidor (forzar id determinista) |
| Cupo y lista de espera (el turno hoy es `Date.now()` del cliente) | Alto | `POST /cursos/:id/inscripciones` transaccional con `FOR UPDATE`; turno por secuencia del servidor |
| Promoción automática al liberar plaza | Alto | En la misma transacción del retiro |
| Choque de horario/fechas entre cursos del estudiante | Alto | Validador en inscribir, reinscribir y promover |
| Grado permitido según matrícula activa | Medio | Validador |
| Curso cerrado no admite inscripción; cerrar pasa espera→retirado | Medio | Máquina de estados abierto→en_curso→cerrado |
| Cupo 1–500 y no menor que los inscritos | Medio | Validador / CHECK |
| Asistencia y notas dentro de un array JSON reescrito entero | Medio | PATCH de asistencia por fecha |

## Horarios (`vistas/horarios.js`, `horarios-motor.js`)
| Regla | Riesgo | Propuesta |
|---|---|---|
| Choques bloqueantes: docente, sección, aula, disponibilidad, franja inexistente o no-clase, día 1–5 | Alto | Portar `validar()` a TS y ejecutarlo en `POST /horarios/guardar` (lote atómico: crear/actualizar/borrar); 409 con la lista de conflictos |
| Franjas: inicio<fin, sin solapes, no borrar franja con clases | Medio | Validador + bloqueo de borrado por dependencia |
| Avisos (tope de horas, incompletas, tanda) | Bajo | Devolverlos en la misma respuesta |
| Lee 10 colecciones enteras | Medio | `GET /horarios/contexto` por sección/docente |

## Asistencia (`vistas/asistencia.js`)
| Regla | Riesgo | Propuesta |
|---|---|---|
| Sin fechas futuras | Medio | Validador (fecha ≤ hoy del servidor) |
| Estudiante matriculado activo en la sección | Alto | Validar en `POST /asistencia/seccion-fecha` (lote) |
| Justificación obligatoria si estado J; `justificadoPor/En` y `registradoPor` los fija hoy el cliente | Medio | `/asistencia/:id/justificar`; el servidor fija esos campos |
| Unicidad (sección, estudiante, fecha) | — | Ya está en SQL |
| Lee toda la colección y calcula % y rachas en el cliente (crece 1 fila/estudiante/día) | Alto | `GET /asistencia/resumen` con GROUP BY y listados paginados |

## Comunicados (`vistas/comunicados.js`)
| Regla | Riesgo | Propuesta |
|---|---|---|
| Visibilidad por rol/segmento calculada en el cliente: un docente, tutor o estudiante puede leer borradores y comunicados ajenos vía `GET /c/comunicados` | Alto | `GET /comunicados` filtrado en servidor por alcance; ocultar borradores a quien no gestiona |
| Contadores destinatarios/leídos | Medio | Calcular en servidor |
| Borrador→publicado fija fecha y `autorId`; `lecturas` solo por ruta controlada | Medio | El servidor fija `autorId`/fecha y no deja sobrescribir `lecturas` por PUT |
| El segmento debe existir (curso/sección/tutor) | Medio | Validador |

## Currículo (`vistas/curriculo.js`, `curriculo-semilla.js`)
| Regla | Riesgo | Propuesta |
|---|---|---|
| Una sola versión vigente por centro (hoy se baja la anterior con un bucle de PUTs) | Alto | UNIQUE parcial (centro, estado='vigente') + `POST /curriculo/versiones/:id/vigente` transaccional |
| Versión «anterior» solo lectura; «vigente» no eliminable | Alto | Bloquear PUT/DELETE según estado |
| Dato «verificado» exige fuente http(s) y fecha válida | Medio | Validador |
| Importar: esquema, hash y total; hoy N+1 llamadas; borrado en cascada con N DELETE | Medio | Importación atómica con validación y hash en servidor; bloquear borrar versiones referenciadas por secuencias |

## Secuencias y planificación (`secuencias.js`, `plan-util.js`, `planificacion.js`)
| Regla | Riesgo | Propuesta |
|---|---|---|
| El docente solo gestiona sus cargas (la propiedad del repo solo cubre notas) | Alto | Autorización por propiedad en servidor |
| Plan «impartido» bloqueado salvo director | Alto | Impedir PUT/DELETE a no-directores; transiciones borrador→listo→impartido |
| Eliminar secuencia desvincula planes (N PUTs) | Medio | Cascada en servidor |
| `indicadorIds` solo si hay `secuenciaId`; la secuencia debe ser de la misma carga | Medio | Validador |
| Fecha válida, día L–V, copias de semana | Bajo | Validador / endpoint duplicar |
| Cobertura de indicadores agregada en el cliente | Medio | `GET /secuencias/:id/cobertura` |

## Reportes, panel y consultas (`reportes.js`, `dashboard.js`, `centros.js`, `data/consultas.js`)
| Regla | Riesgo | Propuesta |
|---|---|---|
| `resumenNotas` calculado en el cliente sobre colecciones completas | Alto (volumen) | `GET /reportes/resumen-notas` (en la Fase 2 ya hay un resumen en servidor), con paginación |
| Reportes leen 13 colecciones; panel ~17; la vista de red 16 **por centro** | Alto | Endpoints agregados `/dashboard`, `/centros/:id/metricas`, `/reportes/*` |
| Escala activa y periodo abierto elegidos en el cliente | Medio | El servidor devuelve escala/periodo vigentes |

## Respaldo (`vistas/respaldo.js`)
- Importar (esquema, centro propio, no admin_red, reemplazo por colección): hoy en modo API dice «Fase 5». Hacerlo en servidor con transacción, validadores por colección, tamaño máximo, auditoría y copia previa. Exportar ya existe.

## Configuración, centros y usuarios (`config.js`, `centros.js`)
| Regla | Riesgo | Propuesta |
|---|---|---|
| Un solo año activo (hoy desactiva otros con PUTs) | Alto | UNIQUE parcial (centro) WHERE activo + endpoint de activar |
| Periodos: peso 0.01–100, suma ≤100, orden único, no borrar con actividades | Alto | Validador de suma/orden + CHECK; bloqueo de borrado (el cierre ya valida la suma en la Fase 2) |
| Escala: min<max, nota mínima en rango, tramos cubren el mínimo, una escala activa por centro | Medio | Validador + UNIQUE parcial |
| Cursos: grado 1–6, no borrar con secciones | Medio | FK lógica/validador |
| Secciones: (curso, año, nombre) único; capacidad 1–60 y ≥ activas; no borrar con matrículas/cargas | Alto | UNIQUE + validadores |
| Cargas: (sección, asignatura) única; no borrar con categorías/actividades | Alto | UNIQUE + bloqueo |
| Asignaturas: no borrar con cargas | Alto | Bloqueo |
| Categorías: pesos suman 100 por carga | Alto | Ya cubierto en Fase 2 (lote y cierre) |
| Centros: no eliminar con datos; creación con escala inicial; borrado en cascada manual | Alto | DELETE con verificación y transacción; crear centro + escala en un endpoint |
| Usuarios: solo admin_red crea admin_red; no cambiar el propio rol/centro/refId; `refId` coherente con el rol y el centro | Alto | Comprobar que `repo/usuarios.ts` lo replica |

## Prioridad
1. Restricciones SQL baratas de alto valor (UNIQUE parciales: matrícula, cédula, código MAT, año activo, escala activa, versión vigente, sección, carga, inscripción).
2. Endpoints transaccionales con bloqueo: matricular/reactivar/retirar, inscribir/promover, bajas.
3. Validadores de integridad y dependencias de borrado.
4. Autorización por propiedad y estados: planes impartidos, secuencias del docente, asistencia, comunicados (visibilidad en servidor).
5. Horarios: portar `validar()` y guardado atómico.
6. Agregados y paginación: reportes, panel, métricas de centro, resumen de asistencia, filtros en servidor.
7. Respaldo e importación (Fase 5).

## Volumen con la semilla actual (3 centros)
Aprox. 4.500–5.000 filas, menos de 1 MB de JSON. Por pantalla se leen colecciones enteras: panel ~17 colecciones (~4.000 filas), reportes 13, vista de red 3×16, personas 8, matrícula 7, horarios 10.
Con un centro real (500 estudiantes, 10 asignaturas, 3 periodos) las calificaciones serían unas 75.000 filas y la asistencia unas 90.000 por año: el panel, los reportes y la asistencia dejan de ser viables sin agregación en el servidor y paginación.

## Estado tras la Fase 3A
**Cubierto en servidor (con pruebas y cliente en modo API adaptado):** prioridades 1 a 5 de arriba: restricciones SQL (migración 0010), endpoints transaccionales con bloqueo (matrícula, retirar/reactivar, inscripciones con lista de espera y promoción, cierre de curso, bajas, vincular tutor), validadores de integridad y dependencias de borrado (periodos, secciones, cursos, asignaturas, cargas, centros, escalas, año activo, currículo vigente/importar), autorización por propiedad y estados (secuencias, planes impartidos, asistencia con campos fijados por el servidor, comunicados con visibilidad en el servidor, `usuarios.refId`) y horarios (`POST /horarios/guardar`, `/franjas/tanda`).
**Pendiente (3B / Fase 5):** prioridad 6 (agregados y paginación: reportes, panel, métricas de centro, resumen de asistencia, `GET /matriculas/pendientes`, `GET /horarios/contexto`, cobertura de secuencias, filtros en servidor) y prioridad 7 (respaldo e importación).
