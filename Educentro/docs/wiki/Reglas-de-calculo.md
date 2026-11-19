# Reglas de cálculo

Implementadas en `js/core/calculo.js` (funciones puras). **Todo se guarda y calcula sin redondear; solo se redondea al mostrar** (`EDU.fmt.nota`, half-up). Una nota **ausente se excluye** (no cuenta como 0). Aprobado = nota ≥ `notaMinAprobar` comparada sin redondear (con tolerancia de 1e-9).

## Modelo ponderado (por defecto)
1. Nota de actividad = puntos / puntosMax × máximo de la escala.
2. Categoría = Σpuntos / ΣpuntosMax de las actividades **con nota** (pondera por puntosMax, no promedia notas).
3. Asignatura en un periodo = Σ(categoría × peso) / Σ(pesos de categorías con nota).
4. Final = media ponderada por peso de los periodos con nota. Un periodo sin notas no penaliza.

Ejemplo: categorías Tareas 20 %, Parcial 30 %, Examen 50 %. Tareas 10/20 y 20/20 → 30/40 = 75. Parcial 50/100 → 50. Examen sin nota → se excluye. Periodo = (75×20 + 50×30) / 50 = **60.0**. Si los periodos P1 (peso 60) y P2 (peso 40) valen 100 y 50, el final es (100×60 + 50×40)/100 = **80**.

Escalas: 0–100 (mínimo 70) y 0–10 (mínimo 7); misma lógica. Tramos por defecto: A ≥ 90 Sobresaliente, B ≥ 80 Muy bueno, C ≥ 70 Satisfactorio, D < 70 Insuficiente.

## Modelo por competencias (planilla MINERD)
Se activa por centro (`escalas.modelo = 'competencias'`, Configuración → Escala). Estructura: 4 competencias × 4 periodos (P1–P4), cada periodo con recuperación pedagógica (RP). Regla **única** para todas las filas:
1. **Efectivo del periodo** = RP si P < mínimo y hay RP (regla `reemplaza`) o máximo(P, RP) (regla `maximo`). Si no hay P pero sí RP, vale RP.
2. **Promedio de competencia** = media de los efectivos con nota.
3. **CF** (calificación final) = media de los promedios de las 4 competencias.
4. **Completiva**: CFC = 50 % CF + 50 % CEC.
5. **Extraordinaria**: CEXF = 30 % CF + 70 % CEX.
6. **Especial**: la nota CE.
7. Estado: Aprobado, Reprobado, Completiva (pendiente de nota), Extraordinaria (pendiente) o Pendiente (año incompleto). Las instancias posteriores solo cuentan con el año completo (todos los periodos de todas las competencias con nota). Pesos 50/50, 30/70 y la nota mínima son configurables por centro.

Ejemplo (valores calculados con `EDU.calculo.calcularCompetencias`, escala 0–100, mínimo 70):

| Competencia | P1 | P2 (RP) | P3 | P4 | Efectivos | Promedio |
|---|---|---|---|---|---|---|
| C1 | 80 | 65 (RP 72) | 90 | 70 | 80, **72**, 90, 70 | 78 |
| C2 | 75 | 75 | 75 | 75 | 75 ×4 | 75 |
| C3 | 60 | 60 | 60 | 60 | 60 ×4 | 60 |
| C4 | 90 | 90 | 90 | 90 | 90 ×4 | 90 |

CF = (78 + 75 + 60 + 90) / 4 = **75.75** → Aprobado. En C1 el P2 = 65 < 70 se sustituye por su RP = 72. Si el CF hubiera sido 60 con año completo, el estado sería "Completiva": con CEC = 80, CFC = 0.5×60 + 0.5×80 = 70 → Aprobado.

## Otras reglas
- **Asistencia**: % = días sin ausencia injustificada (la `J` no penaliza). Alerta si < 85 %, ≥ 3 ausencias o ≥ 3 seguidas.
- **Riesgo de reprobación** (reportes): alto = 2 o más asignaturas reprobadas o promedio bajo el mínimo; medio = 1 reprobada; bajo = aprobada por poco margen sobre el mínimo.
- **Meritorios**: promedio simple de las notas finales de la sección con ranking (como la hoja "Meritorios" de la planilla).
- `validarPesos`: los pesos de categorías y periodos deben sumar 100.

Pruebas de estas reglas: [Pruebas](Pruebas). Origen de la regla de competencias: `docs/PLANTILLAS-CALIFICACION.md`; la base normativa oficial (ordenanza de evaluación) sigue sin verificarse contra el PDF ([Decisiones y limitaciones](Decisiones-y-limitaciones)).
