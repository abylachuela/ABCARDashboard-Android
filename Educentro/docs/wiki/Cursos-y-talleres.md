# Cursos y talleres

Rutas `#/cursos` y `#/cursos/:id`; archivos `cursos.js`, `cursos-logica.js` (reglas sin DOM, `EDU.cursosLogica`) y `cursos-semilla.js`. Son cursos extra (talleres, electivas, refuerzos, módulos técnicos y virtuales) con **cupo propio**, distintos de la matrícula por sección y de la colección `cursos` (grados).

## Datos
- `cursosExtra`: nombre, código (único por centro), tipo (`taller|electiva|refuerzo|modulo_tecnico|virtual`), docenteId, `grados` (`['Secundario:2',…]`; vacío = todos), cupo (o null = sin límite), inicio, fin, horario `[{dia, franjaId|null, desde, hasta, texto}]`, estado (`abierto|en_curso|cerrado`).
- `inscripciones` (`ins_<curso>_<est>`): estado (`inscrito|en_lista_espera|retirado|completado`), `turno` FIFO, asistencia por fecha, nota 0–100, observación, motivo de retiro.

## Reglas
Estudiante activo; curso no cerrado; sin duplicados; grado permitido por matrícula activa; sin choque de horario con sus otros cursos (inscrito o en espera) en fechas solapadas. Cupo lleno → lista de espera; al retirar o subir el cupo se **promueve** por orden FIFO; cerrar un curso cancela la espera. La asignación masiva evalúa a cada estudiante por separado y devuelve el resultado.

## Permisos
Director y secretaría crean, editan, cierran y asignan. El docente solo ve **sus** cursos y registra asistencia y nota/«completado». Tutor y estudiante ven "Mis cursos". Constancia imprimible y CSV (celdas neutralizadas).

## Limitaciones
El choque solo compara cursos extra entre sí (no contra `horarios`). Los cursos `virtual` muestran un enlace general a `#/aula`; la integración real con el aula está pendiente ([Aula virtual](Aula-virtual), [Hoja de ruta](Hoja-de-ruta)).
