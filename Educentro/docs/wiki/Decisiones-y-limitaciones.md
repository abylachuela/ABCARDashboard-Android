# Decisiones y limitaciones

## Decisiones de diseño
- **Sin build ni ES modules** para abrir por `file://` y empaquetar sin herramientas: namespace global `EDU` y orden de `<script>` explícito.
- **Repositorio con adaptador**: hoy `localStorage`; un backend se enchufa con `EDU.repo.usar(adaptador)`.
- **Notas sin redondear**; redondeo solo al presentar; aprobación comparada sin redondear.
- **Nota ausente = excluida**, no 0.
- **Una sola regla por competencias** en lugar de replicar las fórmulas inconsistentes de la planilla.
- **Aprobación humana siempre** para el agente (notas, comunicados, horarios propuestos).
- **Propuesta visual 1** elegida entre tres ([Historial](Historial)).

## Lo que NO está verificado
| Tema | Situación |
|---|---|
| Currículo (áreas, competencias específicas, contenidos, indicadores, ejes transversales, Inicial) | Sin leer PDFs oficiales; datos "pendiente de validar" ([Currículo MINERD](Curriculo-MINERD)) |
| **Formato de la secuencia didáctica** | Campos y nombres de fases sin verificar con el modelo oficial MINERD |
| **Edades de referencia** (3–5, 6–11, 12–17) y división del Nivel Inicial | Sin fuente; conocimiento general |
| **Periodos** (cantidad y pesos de periodos/bloques), reglas de promoción, completivos | Sin verificar con la Ordenanza 04-2023; la semilla ponderada usa 3 periodos (30/30/40) como ejemplo y la planilla observada, 4 |
| **Escala 0–100 con mínimo 70** | Respaldada por una fuente secundaria (blog, confianza baja-media) y por la planilla aportada; configurable por centro |
| Calendario escolar 2026-2027 | Datos por resúmenes de prensa; receso navideño y periodos no obtenidos |
| Tope de 25 horas por docente en horarios, plantillas de franjas | Ejemplos editables, no normas oficiales |

## Limitaciones técnicas
- **Sin backend**: sin autenticación real, sin sincronización entre usuarios, sin notificaciones push. Control de acceso solo en cliente ([Seguridad y privacidad](Seguridad-y-privacidad)).
- **Almacenamiento**: `localStorage` (~5 MB; archivos del aula en base64).
- **SheetJS 0.18.5** con CVE conocidos y mitigaciones.
- **Cursos virtuales** sin integración propia con el aula; choque de horarios de cursos solo entre cursos.
- **Agente IA**: proveedor simulado; sin tarea de horarios.
- **Excel**: la exportación no conserva el formato visual del original.
- **Android**: APK sin construir ni probar en dispositivo; iconos por defecto.
- Fuentes de Google en la CSP; `'unsafe-inline'` en estilos.
