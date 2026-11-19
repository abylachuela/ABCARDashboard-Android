# Agente IA

Ruta `#/agente`; capa `EDU.agente` en `js/vistas/agente.js`. Hoy responde con un **proveedor simulado** (plantillas deterministas locales, sin red); el adaptador a un backend real está implementado pero necesita un servidor.

## Configuración (`agenteConfig`)
Una del centro (`docenteId:null`, techo) y opcionalmente una por docente, que solo puede **restringir** (`configEfectiva()` las combina). Campos: activo, nombre, proveedor (`simulado|backend`), modelo, autonomía, tareas habilitadas, tono, nivel, instrucciones, límite diario (`maxSolicitudesDia`, defecto 50) y `consentimientoDatos` (obligatorio para el proveedor `backend`). Viene **inactivo** en la semilla.

## Modos de autonomía
| Modo | Efecto |
|---|---|
| `sugiere` | Solo propone; no se aplica nada automático. |
| `sugiere_y_aprueba` | Cada propuesta queda pendiente hasta aprobar o rechazar. |
| `ejecuta_con_registro` | Aplica solo borradores que no tocan notas y lo registra. |

## Tareas
`generar_plan` (al aprobar crea un borrador en Planificación), `proponer_actividades`, `crear_rubricas`, `redactar_comunicado` (borrador, nunca se publica solo), `resumir_rendimiento`, `borrador_notas`. Esta última es **sensible**: siempre exige aprobación humana, solo llena celdas vacías, nunca toca periodos cerrados (se revalida al aprobar) y las notas aplicadas quedan auditadas. Pestañas: *Pídele al agente*, *Configuración*, *Registro de actividad*.

## Seguridad
- La API key **nunca** está en el navegador: el campo de la UI es informativo y está deshabilitado.
- El contexto se **minimiza y anonimiza**: alias `E01…`, `limpiarTexto` quita nombres, correos, teléfonos y cédulas; `verificarContexto` rechaza claves de datos personales. El mapa alias→estudiante (`mapaLocal`) nunca se envía.
- Todo queda en `agenteLog` (quién, cuándo, tarea, entrada anonimizada, salida, aprobadoPor, estado, proveedor/modelo, efecto).
- Límite diario, alcance docente y permiso `aprobar` (director y docente; docente solo lo suyo).

## Adaptador a backend real
```js
EDU.agente.registrarProveedor('backend', EDU.agente.crearProveedorHttp({ url: '/api/agente/solicitar' }));
```
Luego elegir `proveedor: 'backend'` en la configuración. El adaptador hace `POST {version:1, tarea, contexto, modelo, tono}` con `credentials:'same-origin'` y **sin Authorization**. El servidor debe autenticar la sesión, añadir la API key, llamar al modelo, aplicar límites, **re-anonimizar y validar** y responder la propuesta JSON. Cualquier objeto con `solicitar(tarea, contexto)` sirve como proveedor. La CSP actual (`connect-src 'self'`) obliga a servir el backend en el mismo origen o ampliarla.

## Horarios
Los horarios tienen un punto de extensión para proponedores (`EDU.horarios.registrarProponedor`), pero **la tarea `proponer_horario` del agente aún no existe** ([Horarios](Horarios), [Hoja de ruta](Hoja-de-ruta)).
