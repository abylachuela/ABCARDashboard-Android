# Plantillas de calificación observadas (Plantilla_Calificaciones_2026-27.xlsx)

Fuente: Excel aportado por el usuario (6.º de Secundaria, año 2026-27). **No se versiona el archivo ni sus nombres de estudiantes** (datos personales). Aquí solo la estructura y las fórmulas, por inspección directa (confianza alta en lo observado; la base normativa oficial sigue pendiente de verificar en las ordenanzas del MINERD).

## Hojas
- Una hoja de calificaciones por asignatura/sección (`A26`, `B26`, `C26`, `OPB26`: secciones A, B, C y Optativa).
- `Meritorios A/B/C`: cuadro de honor por sección; columnas por asignatura (LE, Ing, FR, Mat, Soc, Nat, Art, EDF, FHI, OP) y **Promedio = media simple** de las asignaturas.
- `Completivo`: lista de estudiantes que van a evaluación completiva, por sección.

## Estructura de la hoja de calificaciones (por asignatura)
- 4 **competencias** (Competencia 1–4). Cada una con 4 periodos **P1–P4**, cada periodo con su **RP** (recuperación pedagógica) y una columna **Prom**.
- Promedio de competencia = media de los 4 periodos, donde **si P < 70, se usa el valor de RP** en su lugar (`IF(P<70, RP, P)`).
- **CF** (calificación final) = media de los 4 promedios de competencia.
- **Completiva**: CEC = nota de la completiva; **CFC = 50 % CF + 50 % CEC**.
- **Extraordinaria**: **CEXF = 30 % CF + 70 % CEX**.
- **Especial**: columna de calificación especial (CF / CE).
- Resultado final **A / R** (aprobado / reprobado). Nota mínima observada: **70**, escala 0–100.

## Hallazgos y errores de la plantilla (a no replicar)
- Fórmulas **inconsistentes por fila**: unas filas promedian P1–P4 y otras mezclan RP (`(D+E+H+J)/4`); riesgo de errores. Educentro debe usar una sola regla.
- Un `#REF!` en la hoja de optativa (`OPB26`).
- Textos con erratas ("COMPENTENCIA").
- Sin validación de datos ni formato condicional.

## Implicaciones para Educentro
1. Modelo "por competencias": categorías = competencias fundamentales; periodos P1–P4 con RP por periodo.
2. Regla de recuperación: si el periodo < nota mínima y existe RP, vale el RP (configurable: reemplaza vs. máximo).
3. Evaluación completiva (50/50), extraordinaria (30/70) y especial como instancias posteriores, con pesos configurables por centro.
4. Cuadro de honor/meritorios por sección y listado de completivos generados automáticamente.
5. Importar/exportar a este formato Excel (sin datos reales en el repositorio).

## Implementado (ver docs/API.md §13)
- Modelo `competencias` por centro (`escalas.modelo`), núcleo `EDU.calculo.calcularCompetencias` con una única regla: efectivo = RP si P < mínimo y hay RP (o máximo, configurable); competencia = media de periodos; CF = media de las 4; CFC 50/50, CEXF 30/70, especial y resultado Aprobado/Reprobado (+ Completiva/Extraordinaria pendiente, Pendiente si el año está incompleto). Pesos y nota mínima por centro.
- Libro por competencias (C1–C4 × P1–P4/RP), Meritorios (promedio simple + ranking) y Completivos (automático), imprimibles; boletín y reportes leen ambos modelos.
- Importador `.xlsx` local (hojas de calificaciones con diseños distintos: columnas Apellidos+Nombres o nombre único; Meritorios y Completivo detectados por contenido), mapeo hoja→sección/asignatura, emparejado por nombre normalizado, creación opcional de estudiantes, recálculo e informe de discrepancias (fórmulas solo-P, mezcla P/RP, `#REF!`, valores y A/R distintos, listas de completivo). Exportador con el mismo diseño y fórmulas consistentes.
- Observado en el archivo real: las hojas no comparten posición de columnas (una hoja tiene una sola columna de nombre y datos desde C; las demás Apellidos/Nombres y datos desde D), las fórmulas de Prom varían por fila (suma de P, mezcla P/RP, IF estándar), hay celdas con errores en caché y listas de completivo sin etiqueta de sección; el importador lo tolera y lo informa sin bloquear.
