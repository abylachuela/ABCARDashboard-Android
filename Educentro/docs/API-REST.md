# EduCentro · contrato de la API REST (Fase 1, servidor)

Base: `/api/v1`. JSON UTF-8. Implementación: `server/src/routes/api.ts`; pruebas: `server/test/api-*.test.ts`. El cliente (`repo-api.js`) se escribe contra este documento. **El servidor es la autoridad**: los permisos del cliente son solo comodidad de uso.

## 1. Convenciones
- **Sesión**: cookie de `POST /auth/login` (ver `server/README.md`). Sin sesión válida: `401`. En métodos no seguros (POST/PUT/DELETE) se exige además `X-EDU-CSRF: <csrfToken>` (devuelto por login/me) y `Origin` permitido; si no, `403 csrf_invalido` / `403 origen_no_permitido`. Si el usuario tiene `debeCambiarClave`, todo lo que no sea `/auth/*` responde `403 cambio_clave_obligatorio`.
- **Errores**: `{"error":{"codigo":"…","mensaje":"… (español)","campos":["…"]?}}`.
- **Registro** (objeto plano): `{id, centroId, ...campos, creadoEn, actualizadoEn}`. Fechas ISO-8601 UTC con milisegundos (`2026-11-19T18:00:00.123Z`). `centros` no lleva `centroId`. Los ids actuales se conservan (`^[A-Za-z0-9_.:-]{1,100}$`).
- **Campos que fija el servidor**: `id` (si falta, `<3 letras>_<20 hex>`), `centroId`, `creadoEn`, `actualizadoEn`. Si el cliente los envía se ignoran (excepto `id`, que se respeta al crear, y `centroId`, ver §3). `datos` (todo lo que no es campo de sistema) ≤ **256 KB** (`413 registro_demasiado_grande`). El cuerpo total de la petición ≤ 1 MB (`413 cuerpo_demasiado_grande`).
- **Colecciones** (39, las de `repo-local.js`): `centros usuarios anios periodos cursos secciones asignaturas cargas docentes estudiantes tutores matriculas escalas categorias actividades calificaciones asistencia comunicados planes horarios agenteConfig agenteLog auditoria notasCompetencia curriculoVersiones curriculoContenidos secuencias franjas disponibilidad cursosExtra inscripciones aulaContenidos tareas entregas cuestionarios intentos foros foroMensajes anuncios`. Desconocida → `404 coleccion_desconocida`.
- **Borrado**: lógico (`borrado_en`). Un id borrado puede reutilizarse con POST (p. ej. `cal_<actividad>_<estudiante>`).

## 2. Repositorio genérico

### GET `/c/:col` — listar
Query: `f.<campo>=<valor>` (filtros por igualdad; repetir el mismo `f.campo` = OR; máx. 10 filtros, 50 valores, 200 caracteres; nombre de campo `^[A-Za-z][A-Za-z0-9_]{0,39}$`, si no `422 filtro_no_permitido`), `orden=<campo>` (numérico si el valor parece número, si no texto; desempate por id), `desc=true|false`, `limite` (1–500, **por defecto 100**; fuera de rango → `422`), `offset` (≥ 0), `centroId` (admin_red filtra; el resto solo puede pedir el suyo, si no `403 centro_no_permitido`).
Respuesta `200`: `{"datos":[registro…],"total":N,"siguiente":offsetSiguiente|null}`. `total` cuenta los que el usuario puede ver (centro + alcance).
`usuarios` solo admite filtros/orden por `id centroId nombre email rol refId activo creadoEn actualizadoEn`.

### GET `/c/:col/:id` → `200` registro · `404 no_encontrado` (también si existe en otro centro o fuera de tu alcance).
### POST `/c/:col` → `201` registro. `409 ya_existe` si el id está en uso (vivo).
### PUT `/c/:col/:id` → `200` registro. **Reemplaza** los campos del registro (como `guardar`). Cabecera opcional `If-Match: <actualizadoEn>` (admite comillas y `W/`): si no coincide con la versión actual → `409 conflicto_version`; valor no fecha → `422 if_match_invalido`. `id` en cuerpo ≠ URL → `422 id_inconsistente`. No se puede cambiar `centroId` (`422 centro_inmutable`).
### DELETE `/c/:col/:id` → `204`. Admite `If-Match`. `404` si no existe o no es visible.
### POST `/c/:col/lote` — cuerpo `{"registros":[…]}` (1–500, cada uno con `id`) → `200 {"datos":[registro…]}`. **Upsert** por id (como `guardarMuchos`), todo en una transacción: si un registro falla, no se guarda ninguno y el mensaje empieza por `Registro N:`. El límite de 1 MB de cuerpo también aplica. No disponible para `usuarios`.

## 3. Centro, alcance y permisos (resumen; detalle en `docs/SEGURIDAD.md`)
1. **Rol → colección**: lectura según colección (todas salvo: `agenteConfig` solo admin_red/director/docente; `agenteLog` + secretaría; `planes` y `secuencias` no para tutor/estudiante; `auditoria` solo admin_red/director). Escritura: `ESCRIBE` de `permisos.json` (fuente: `js/core/permisos.js`); si no, `403 sin_permiso`.
2. **Centro**: admin_red cualquiera; el resto el suyo. **El cliente no decide `centroId`**: si un no-admin envía otro → `403 centro_no_permitido`; si no lo envía, se usa el de la sesión. admin_red **debe** indicarlo al crear (`422` si falta o no existe). Un registro de otro centro responde `404` (no revela su existencia).
3. **Alcance de lectura** (también en listados y `total`): *docente* sus cargas, secciones y estudiantes (+ colegas, horarios y catálogos del centro); *tutor* sus hijos (y sus cargas/secciones/docentes); *estudiante* él mismo. Comunicados: solo `publicado`, de su audiencia y segmento; quien no gestiona comunicados solo ve sus propias `lecturas`.
4. **Propiedad de escritura**: docente solo `calificaciones` (por la carga de la actividad), `actividades`, `categorias`, `notasCompetencia`, `planes`, `horarios`, aula (`aulaContenidos tareas cuestionarios foros anuncios entregas intentos foroMensajes`) de SUS cargas, y `asistencia` de SUS secciones; `agenteConfig` propio; `agenteLog` queda a su nombre. Estudiante solo `entregas`/`intentos` propios (de sus cargas) y `foroMensajes` con `autorId` = su usuario. Para editar/borrar, el registro debe estar en tu alcance (si no, `404`).
5. `comunicados.lecturas` lo gestiona el servidor (el cliente no puede fijarlo).
6. Únicos de negocio (entre vivos): `calificaciones` (actividadId+estudianteId) y `asistencia` (seccionId+estudianteId+fecha) → `409 conflicto`.

## 4. `usuarios` (proyección sobre la tabla de autenticación)
Registro: `{id, centroId (null=admin_red), nombre, email, rol, refId, activo, debeCambiarClave, creadoEn, actualizadoEn}`. **Nunca** hash, tokens, intentos ni bloqueos.
- Lectura: admin_red todos; director su centro; el resto solo a sí mismo.
- `POST /c/usuarios` `{nombre, email, rol, refId?, centroId?, id?}` (admin_red; director solo en su centro). `201` + el registro y **`claveTemporal`** (aleatoria, se devuelve UNA vez; `debeCambiarClave=true`). `409 email_en_uso`, `422` rol/correo inválido. El cliente no puede fijar la contraseña.
- `PUT /c/usuarios/:id` (campos opcionales: `nombre email rol refId activo`). Desactivar o cambiar el rol revoca sus sesiones.
- `DELETE /c/usuarios/:id` = **desactivar** (`activo=false`), `204`.
- **Sin escalada**: solo admin_red crea/edita admin_red o asigna roles superiores; nadie cambia su propio rol/refId/centro ni se desactiva a sí mismo (`403`); no se pasa un usuario desde/hacia admin_red.

## 5. `centros`
`{id, nombre, codigo, activo, …campos libres, creadoEn, actualizadoEn}`. Lectura: admin_red todos, el resto el suyo. Escritura solo admin_red; `DELETE` = baja lógica (`activo=false`).

## 6. Auditoría
- `GET /auditoria` (admin_red todo/`?centroId=`; director su centro; otros `403`). Filtros `coleccion usuarioId accion registroId desde hasta`, `f.accion=…`, `limite offset`. Orden: fecha descendente. Registro: `{id, centroId, usuarioId, rol, accion, coleccion, registroId, antes, despues, fecha, …extra}`. También `GET /c/auditoria[/:id]`. `POST/PUT/DELETE /c/auditoria` → `403 auditoria_inmutable`.
- `POST /auditoria` (admin_red, director, docente, secretaría; tutor/estudiante `403`) `201`. Lista blanca: `accion` (obligatoria, `^[A-Za-z][A-Za-z0-9_.:-]{0,59}$`), `centroId` (solo admin_red lo elige y es obligatorio para él), `coleccion` (conocida, ≠ `auditoria`), `registroId`, `motivo`, `archivo` (≤ 600), `hojas registros valores estudiantesCreados matriculasCreadas discrepancias antes despues`. Cualquier otro campo se descarta; `usuarioId`, `rol`, `fecha` e `id` los fija el servidor. `crear/editar/borrar` sobre `calificaciones`/`notasCompetencia` están reservadas (`403 accion_reservada`).
- **Automática**: toda escritura de `calificaciones` y `notasCompetencia` (crear, editar, borrar; también en lote) añade en la misma transacción `{accion:'crear'|'editar'|'borrar', coleccion, registroId, antes, despues}`. La tabla es append-only (sin UPDATE/DELETE para la API, trigger que los aborta).

## 7. Otros
- `POST /comunicados/:id/lectura` → `200 {"leido":true}`. Añade solo `{usuarioId, fecha}` del usuario (idempotente). `404 no_encontrado` si no es de tu centro, no está publicado o no es de tu audiencia/segmento (admin_red no registra lecturas, como en el cliente).
- `GET /respaldo/exportar?centroId=` — director (su centro; otro → `403`) y admin_red (`centroId` obligatorio). `200 {"formato":"educentro-respaldo","version":1,"generadoEn","centroId","colecciones":{<col>:[registro…]}}` con todas las colecciones del centro (usuarios sin hash). Queda auditado (`exportar_respaldo`). Otros roles `403`.
- `POST /respaldo/importar` → `501 no_implementado` («llega en la Fase 5»).

## 8. Códigos de error
| HTTP | `codigo` | Cuándo |
|---|---|---|
| 401 | `no_autenticado` | sin sesión |
| 403 | `sin_permiso`, `centro_no_permitido`, `csrf_invalido`, `origen_no_permitido`, `cambio_clave_obligatorio`, `auditoria_inmutable`, `accion_reservada` | autorización |
| 404 | `no_encontrado`, `coleccion_desconocida` | no existe / otro centro / fuera de alcance |
| 409 | `ya_existe`, `conflicto_version`, `email_en_uso`, `conflicto` | duplicado o versión obsoleta |
| 413 | `registro_demasiado_grande`, `cuerpo_demasiado_grande` | tamaño |
| 422 | `datos_invalidos` (con `campos`), `filtro_no_permitido`, `if_match_invalido`, `id_inconsistente`, `centro_inmutable`, `referencia_invalida`, `actividad_no_encontrada`, `no_soportado` | validación |
| 501 | `no_implementado` | importar respaldo |
| 500 | `error_interno` | genérico, sin detalles |

## 9. Ejemplos
```http
GET /api/v1/c/cargas?f.docenteId=doc_1_01&orden=id&limite=50
→ 200 {"datos":[{"id":"car_sec_1_1A_LE","centroId":"cen_1","anioId":"ani_1_2026","seccionId":"sec_1_1A","docenteId":"doc_1_01","creadoEn":"…","actualizadoEn":"…"}],"total":1,"siguiente":null}

PUT /api/v1/c/periodos/per_1_1        If-Match: 2026-11-19T18:00:00.123Z   X-EDU-CSRF: …
{"nombre":"Periodo 1","peso":25}
→ 200 {…"actualizadoEn":"2026-11-19T18:05:00.456Z"}   (409 conflicto_version si cambió)

POST /api/v1/c/usuarios {"nombre":"Ana","email":"ana@centro.test","rol":"docente","refId":"doc_1_02"}
→ 201 {"id":"usr_…","centroId":"cen_1","rol":"docente","activo":true,"debeCambiarClave":true,"claveTemporal":"…"}

GET /api/v1/c/estudiantes/est_2_01   (sesión de otro centro) → 404 {"error":{"codigo":"no_encontrado","mensaje":"Registro no encontrado."}}
```

## 10. Notas, periodos y auditoría (Fase 2)
Las reglas valen también para el repositorio genérico (`/c/:col`): no se pueden esquivar. Cabecera **`X-EDU-Motivo`** (texto codificado con `encodeURIComponent`, 5–300 caracteres): la exige el servidor a **director y admin_red** para escribir notas, actividades, pesos de categorías, notas por competencia o el propio periodo cuando el periodo está **cerrado**; queda en la auditoría (`motivo`, `periodoId`, `periodoCerrado`). Docente/secretaría sobre periodo cerrado: `409 periodo_cerrado`; director sin motivo: `422 motivo_requerido`; motivo mal formado: `422 motivo_invalido`.
- **Reglas por registro**: `calificaciones` (`puntos` null o número 0..`puntosMax`, ≤ 6 decimales, sin redondear; `actividadId`/`estudianteId` inmutables); `actividades` (`puntosMax` 0–1000, categoría de la misma carga, periodo del centro/año, carga del centro; no bajar `puntosMax` por debajo de notas existentes); `categorias` (peso 0–100; cambiar pesos o quitar categorías con notas en un periodo cerrado = escribir en periodo cerrado); `notasCompetencia` (notas dentro de la escala, P_i/RP_i bloqueadas si el periodo i del año de la carga está cerrado; completiva/extraordinaria/especial solo cuando corresponden); `periodos` (`cerrado` y campos de cierre solo por cerrar/reabrir: `422 campo_protegido`). Los campos calculados (`final`, `cf`, `estado`, `aprobado`, `usuarioId`, `rol`…) se **ignoran**. Errores de valor: `422 fuera_de_rango`, `fase_no_valida`, `campo_inmutable`, `referencia_invalida`.
- `PUT /notas/calificaciones/lote` y `PUT /notas/competencias/lote`: `{registros:[…≤500], atomico?:bool}` → `200 {atomico,total,aplicadas:[{indice,id,registro}],rechazadas:[{indice,id,codigo,mensaje,campos?}]}`. Cada fila pasa por las mismas reglas que una escritura suelta (savepoint por fila); la celda (actividad+estudiante / carga+estudiante) existente se actualiza. Con `atomico:true` una fila inválida deshace todo: `422 lote_invalido` con `error.rechazadas`. Filas repetidas: `duplicado_en_lote`.
- `POST /notas/categorias/lote` `{cargaId, categorias:[{id?,nombre,peso}]}` (1–30): reemplazo transaccional de las categorías de la carga; `422 pesos_invalidos` (con `suma` y `diferencia`) si no suman 100; `422 categoria_con_actividades` al quitar una con actividades.
- `GET /periodos/:id/informe-cierre` (director/admin_red) → `{periodoId, modelo, pendientes, cargasSinActividades, pesosPeriodos, cargas[], bloqueos[], requiereConfirmacion}`. `POST /periodos/:id/cerrar` `{confirmar?:bool}` → `200 {periodo, informe}`; `409 confirmacion_requerida` (con `error.informe`) si hay pendientes/asignaturas sin actividades; `422 pesos_invalidos` si los pesos de categorías (modelo ponderado) o de los periodos del año ≠ 100; `409 periodo_ya_cerrado`. `POST /periodos/:id/reabrir` `{motivo}` (o cabecera) → `200 {periodo}`; `409 periodo_no_cerrado`. Ambos auditados (`cerrar_periodo`, `reabrir_periodo`). Otro centro: `404`.
- `GET /notas/resumen?seccionId=&cargaId=&estudianteId=&periodoId=&centroId=` → `{datos:[fila], total, periodoId}`: las mismas filas que `EDU.consultas.resumenNotas` del cliente (ambos modelos), calculadas con el mismo código sobre lo que el usuario ve (centro + alcance). admin_red debe indicar `centroId`. Con `periodoId` cada fila añade `notaPeriodo`. Parámetros desconocidos → 422.
- `GET /auditoria/verificar?centroId=[&anclaSeq=&anclaHash=]` (director su centro, otro → 404; admin_red cualquiera, `centroId` obligatorio) → `{centroId, ok, registros, ultimoSeq, ultimoHash, verificadoEn, errores:[{seq,id,tipo,mensaje}], truncado}`; `tipo`: `hash_alterado`, `enlace_roto`, `seq_discontinuo`, `cabeza_distinta`, `cabeza_ausente`, `ancla_distinta`. Las entradas de `GET /auditoria` añaden `seq`, `huella`, `huellaPrevia`, `ip`, `userAgent`.
- `actividades`, `categorias` y `periodos` se auditan como las notas (crear/editar/borrar), y esas acciones quedan reservadas (`403 accion_reservada` en `POST /auditoria`).
