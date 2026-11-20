# Currículo MINERD

El módulo `curriculo` guarda un catálogo versionado, pero **el contenido oficial NO está verificado**: no se pudo leer ningún PDF oficial (los hosts del MINERD estaban bloqueados en la sesión de investigación). Todo viene de resúmenes de búsqueda; ver `docs/CURRICULO-MINERD.md` (informe del 2026-11-19).

## Qué hay sembrado (`js/data/curriculo-semilla.js`)
Versión `minerd-bases-2016-adecuacion-2023` («2023-parcial»). Cada nodo lleva `estado` (`verificado` | `pendiente`), `fuente` (URL) y fecha.

| Dato | Estado en la app | Confianza del informe |
|---|---|---|
| Siete competencias fundamentales (Ética y Ciudadana; Comunicativa; Pensamiento Lógico, Creativo y Crítico; Resolución de Problemas; Científica y Tecnológica; Ambiental y de la Salud; Desarrollo Personal y Espiritual) | verificado | media |
| Estructura: Primario 1.º–3.º y 4.º–6.º; Secundaria 1.º–3.º y 4.º–6.º | verificado | media |
| Modalidades del 2.º ciclo de Secundaria: Académica (General), Técnico Profesional, Artes | verificado | media |
| Nivel Inicial: dos ciclos, grados y edades | **pendiente** | baja |
| Áreas y asignaturas por grado, competencias específicas, contenidos (conceptos/procedimientos/actitudes), indicadores de logro | **pendiente de validar** (placeholder editable) | no obtenido |
| Ejes transversales | **pendiente** (la adecuación 2023 los incorpora; no se obtuvo la lista) | — |

Las áreas usadas por la semilla (Lengua Española, Matemática, Ciencias Sociales, Ciencias de la Naturaleza, Lenguas Extranjeras, Educación Física, Educación Artística, Formación Integral Humana y Religiosa) son conocimiento previo de confianza **baja**.

## Versiones
`curriculoVersiones`: id, nombre, versión, fuente, fechaPublicacion, vigenteDesde, estado (`vigente|anterior|borrador`), `hash` (cyrb53 de los ítems), instrumentoLegal, schemaVersion. `curriculoContenidos`: `clave` estable entre versiones (el diff compara por clave), tipo (`competencia_fundamental|competencia_especifica|contenido|indicador|eje_transversal|area|estructura`), nivel, ciclo, grado, modalidad, areaId, descripcion, estado, fuente.

## Cómo actualizar
1. Preparar un JSON con el esquema propuesto (`schemaVersion: '1.0.0'`, `curriculum{id, version, source, validity, levels[]…}`) o usar el que exporta la vista (`items` planos).
2. **Currículo → Versiones → Importar**: se valida (`EDU.curriculoSemilla.validarDoc`) y se crea como versión nueva sin sobrescribir.
3. **Comparar** contra la vigente (añadidos, quitados, modificados).
4. **Marcar vigente** si procede. Los datos de baja confianza deberían bloquear la publicación hasta verificarlos.
5. **Revisión periódica**: la pestaña guarda el intervalo y la última revisión y avisa; el navegador **no** puede leer el sitio oficial.

## Pendiente
Leer los PDF oficiales (Bases 2016, diseños curriculares de Primaria y Secundaria, adecuación 2023, Ordenanza 04-2023) y transcribir áreas, competencias específicas, contenidos e indicadores. Ver [Hoja de ruta](Hoja-de-ruta) y [Decisiones y limitaciones](Decisiones-y-limitaciones).
