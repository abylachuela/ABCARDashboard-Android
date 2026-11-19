# EduCentro · contrato para añadir módulos

App estática: abre `index.html` por `file://`. **Sin ES modules, sin build.** Todo cuelga del namespace global `window.EDU`; cada archivo es una IIFE `(function(){ 'use strict'; var EDU = (window.EDU = window.EDU || {}); ... })();`.
Alineada al sistema educativo dominicano (MINERD): niveles Inicial / Primario (1.º–6.º) / Secundario (1.º–6.º; 2.º ciclo: General, Técnico-Profesional, Artes), escala 0–100 con nota mínima configurable (defecto **70**), textos/fechas es-DO (`RD$ 1,250.00`, `19 nov 2026`).
Referencia curricular: `docs/CURRICULO-MINERD.md` (la redacta otro agente).

## 1. Orden de `<script>` (index.html)
`core/almacen → core/formato → core/escala → core/calculo → core/validacion → core/permisos → data/repo-local → data/repo → data/semilla → data/consultas → estado → ui/componentes → router → vistas/login, dashboard → vistas/<modulos> → app.js`.
Las vistas se cargan **después** de router/ui y **antes** de `app.js`. Un módulo nuevo: crea `js/vistas/<ruta>.js`, añade su `<script>` en index.html y su entrada en `EDU.permisos.NAV` y `MATRIZ`.

## 2. Convenciones de archivos
- Un archivo por vista: `js/vistas/<ruta>.js` (ruta = id del módulo: `centros config curriculo personas matricula libro-notas planificacion agente boletin reportes asistencia comunicados respaldo`). **Ya existen como stubs "En construcción": reemplaza solo TU archivo.** Si necesitas helpers privados, quédate en tu IIFE (o crea `js/vistas/<ruta>-x.js` y lístalo antes).
- No toques `core/`, `data/`, `ui/` ni `router.js` salvo para bugs; si falta algo, documenta/pide.
- **Seguridad XSS: TODO dato de usuario insertado en HTML pasa por `EDU.esc(...)`** (o `EDU.html` con plantillas). `textContent` no necesita escape. Nunca `innerHTML = dato`.
- Notas: se guardan y calculan **sin redondear**; solo se redondea al mostrar (`EDU.fmt.nota`).

## 3. Registrar una vista
```js
EDU.router.register('libro-notas', {
  titulo: 'Calificaciones',
  // roles: ['docente']   // opcional; si se omite se usa EDU.permisos.puedeModulo(rol, modulo)
  // publica: true        // solo login
  render: async function (container, params) {   // params = {...:param de ruta, ...query}
    container.innerHTML = EDU.ui.cabecera({ eyebrow: 'Registro', titulo: 'Calificaciones' }); // un solo <h1>
    // ... pintar. Puede devolver una funcion de limpieza (se llama al salir de la vista).
  }
});
```
Rutas con parametros: `'personas/:id'` (hash `#/personas/est_1_01`, query `#/libro-notas?cargaId=x`). El modulo de una ruta es su primer segmento (`personas`). Si el render lanza error, el router muestra una tarjeta de error. 403/404 los resuelve el router.
`EDU.router`: `register(ruta, def)`, `ir(ruta, query?)`, `recargar()` (re-renderiza la vista actual; se llama solo al cambiar de centro), `actual()` → `{ruta, modulo, titulo, params}`, `onNavegar(fn)`, `rutas()`.

## 4. Sesion y centro activo — `EDU.estado`
`sesion()` → `{usuarioId, nombre, email, rol, refId, centroUsuario, centroActivo}` o `null`; `autenticado()`, `rol()`, `centroActivo()` (id, o `null` = "Todos" solo `admin_red`), `iniciarSesion(usuario)`, `cerrarSesion()`, `cambiarCentro(id)`, `onCambio(fn({tipo:'login'|'logout'|'centro'}))` → función para desuscribir. `refId` = id de docente/estudiante/tutor según el rol. Persistida en `localStorage['edu:sesion']`.

## 5. Repositorio — `EDU.repo` (todo asincrono: `await`)
Colecciones: `centros usuarios anios periodos cursos secciones asignaturas cargas docentes estudiantes tutores matriculas escalas categorias actividades calificaciones asistencia comunicados planes horarios agenteConfig agenteLog auditoria curriculoVersiones curriculoContenidos secuencias`.
Todo registro (salvo `centros`) lleva `centroId`. **El repo filtra solo por el centro activo** (o el del usuario); un no-admin que pida otro centro recibe `Error('Centro no permitido')`. Sin sesión solo se leen `usuarios`/`centros` (login).

| Método | Descripción |
|---|---|
| `listar(col, {centroId?, filtro?, orden?, desc?, limite?, offset?})` | Lista (copias). `filtro`: objeto `{campo: valor \| [valores] \| fn(valor,reg)}` o `fn(reg)`. `orden`: nombre de campo o fn. |
| `consultar(col, filtro, opts?)` / `contar(col, filtro?, opts?)` | Atajos de `listar`. |
| `obtener(col, id)` | Registro o `null` (también `null` si es de otro centro). |
| `guardar(col, reg)` | Crea (genera `id`, `creadoEn`) o actualiza (`actualizadoEn`). Si falta, asigna `centroId` = centro activo (en "Todos" debes poner `centroId`). Lanza `Error('Sin permiso…')` si el rol no puede escribir la colección. Guardar `calificaciones` escribe automáticamente en `auditoria` {usuarioId, accion, antes, despues, fecha}. |
| `guardarMuchos(col, regs)` · `borrar(col, id)` | |
| `exportarTodo()` / `importarTodo(obj)` | Respaldo; requiere permiso `respaldo` exportar/importar. |
| `usar(adaptador)` | Cambia el backend (API HTTP) con la misma interfaz que `EDU.repoLocal`. |

Adaptador por defecto `EDU.repoLocal` (`localStorage`, claves `edu:v1:col:<coleccion>`; fallback en memoria si no hay storage o se llena; `EDU.repoLocal.advertencia` informa). `EDU.almacen` = `get/set/remove/keys/getJSON/setJSON/modo()` seguro.
Para operaciones compuestas (cargar varias colecciones, resumen de notas): `EDU.consultas`
- `cargar(['cargas','estudiantes',...])` → `{cargas:[], estudiantes:[]}`
- `escalaDe(escalas, centroId)`, `periodoAbierto(periodos, centroId)`, `agrupar(lista, clave)`
- `resumenNotas({matriculas,cargas,categorias,actividades,calificaciones,periodos,escalas})` → filas `{centroId, estudianteId, seccionId, cargaId, asignaturaId, docenteId, final, pct, aprobado, periodos, escala}` (`pct` = 0–100 comparable entre centros).

### Modelo (campos principales)
- `centros`: id, nombre, codigo, ciudad, regional, distrito, nivel, color, director. `usuarios`: id, centroId (null = admin_red), nombre, email, rol, refId.
- `anios`: id, centroId, nombre, inicio, fin, activo. `periodos`: id, centroId, anioId, orden, nombre, **peso** (suman 100), inicio, fin, cerrado.
- `cursos`: id, centroId, nombre, **nivel** (`Inicial|Primario|Secundario`), grado, ciclo (`Primer ciclo|Segundo ciclo`), modalidad (`General|Técnico-Profesional|Artes|null`), orden. `secciones`: id, cursoId, anioId, nombre, tanda, capacidad.
- `asignaturas`: id, codigo, nombre (áreas MINERD), color. `cargas`: id, anioId, seccionId, asignaturaId, docenteId. `docentes`/`estudiantes`: nombres, apellidos, … ; `tutores`: …, `estudianteIds[]`. `matriculas`: estudianteId, seccionId, anioId, estado (`activa`…).
- `escalas`: min, max, notaMinAprobar (defecto 70), decimales, tramos `[{desde, etiqueta, letra}]`, activa.
- `categorias`: cargaId, nombre, **peso** (suman 100 por carga). `actividades`: cargaId, categoriaId, periodoId, nombre, puntosMax, fecha. `calificaciones`: id=`cal_<act>_<est>`, actividadId, estudianteId, `puntos` (null = sin nota), comentario.
- `asistencia`: seccionId, estudianteId, fecha, estado `P|A|T|J`. `comunicados`, `planes` (PlanClase del PLAN.md, + docenteId), `horarios` (cargaId, dia 1-5, hora, duracion), `agenteConfig`, `agenteLog`, `auditoria`.
- **`curriculoVersiones`** (vacía en la semilla): una versión de un currículo/diseño curricular (p. ej. {id, centroId, nombre, nivel, año de vigencia, fuente, estado}). **`curriculoContenidos`** (vacía): contenidos/competencias/indicadores ligados a una versión ({id, centroId, versionId, areaId/asignaturaId, grado, tipo, descripcion, orden}). La estructura final la define el módulo `curriculo` (otro agente, `js/vistas/curriculo.js`); el repo ya acepta cualquier objeto con `id`/`centroId`. Escriben admin_red y director; lectura para todos los roles.
- IDs estables de la semilla: `cen_1`, `ani_1_2026`, `per_1_1`, `cur_1_1`, `sec_1_1A`, `asg_1_mat`, `car_<sec>_<area>`, `doc_1_01`, `est_1_01`, `tut_1_01`, `mtr_est_1_01`, `cat_<carga>_tar`, `act_<carga>_<p>_<k>`, `cal_<act>_<est>`, usuarios `usr_admin`, `usr_dir_1`, `usr_doc_1_01`, `usr_sec_1`, `usr_tut_1`, `usr_est_1` (y `_2` para el centro 2).
- Semilla: `EDU.semilla.asegurar()` (arranque), `EDU.semilla.restablecer()` (borra todo y resiembra; botón en login y sidebar), `EDU.semilla.generar()` (datos sin escribir).

## 6. Permisos — `EDU.permisos`
Roles: `admin_red director docente secretaria tutor estudiante`. `puedeModulo(rol, mod)`, `puede(rol, mod, accion)` (acciones: `ver crear editar borrar exportar importar imprimir cerrar aprobar`), `modulosDe(rol)`, `rolesDeModulo(mod)`, `etiquetaRol(rol)`, `puedeEscribirColeccion(rol, col)`, `centroPermitido(sesion, centroId)`.
Alcance dentro del centro (docente: sus cargas; tutor/estudiante: lo propio):
```js
var al = EDU.permisos.alcance(EDU.estado.sesion(), {cargas, matriculas, tutores}); // Sets o null (=sin restriccion)
EDU.permisos.filtrar(al, 'cargas'|'secciones'|'estudiantes', lista);
EDU.permisos.filtrarPorEstudiante(al, calificaciones); EDU.permisos.filtrarPorCarga(al, actividades);
```
Usa `puede(...)` para mostrar/ocultar botones de edición. Es control de cliente (demo): el backend real debe repetirlo.
Módulos: `curriculo` lectura todos, edición `admin_red`/`director`; `libro-notas` edita docente (director/secretaría lectura, director `cerrar`).

## 7. Cálculo, escala, validación, formato
- `EDU.calculo` (puro): `notaActividad`, `detalleCategoria`/`notaCategoria`, `ponderar`, `notaAsignaturaPeriodo`, `notaFinal`, `calcularPeriodo({categorias, actividades, calificaciones, estudianteId?, periodoId?, escala})`, `calcularFinal({..., periodos:[{id,peso}]})` → `{final, aprobado, periodos}`, `aprobado(nota, escala)` (≥ min sin redondear), `promedioGeneral`, `validarPesos(pesos, 100)`, `redondear(n, dec)` (half-up). Notas sin registrar se excluyen (no cuentan como 0).
- `EDU.escala`: `porDefecto()`, `PRESETS`, `crear`, `validar`, `tramo(nota, escala)`, `porcentaje`, `desdePorcentaje`, `convertir`, `minAprobarPct`.
- `EDU.validacion.validar(valores, esquema)` → `{ok, errores, valores}`; esquema `{campo:{label, requerido, tipo:'texto|numero|entero|email|fecha|select|booleano', min,max,minLen,maxLen,patron,custom}}`; `puntos(valor, max)`.
- `EDU.esc(txt)`; `EDU.html\`...${dato}...\`` (escapa interpolaciones; `EDU.raw(html)` marca HTML seguro; `EDU.Safe`); `EDU.fmt`: `nota(n, escala)`, `num`, `pct`, `moneda`, `fecha(iso, largo?)`, `fechaHora`, `hoy()`, `nombreCompleto`, `iniciales`, `plural`, `norm`.

## 8. Componentes — `EDU.ui`
Estáticos devuelven `EDU.Safe` (HTML seguro, concatenable; úsalo con `innerHTML`): `icono(nombre)`, `badge(texto, 'ok|bad|warn|info|neu')`, `chip`, `kpi({etiqueta, valor, detalle, tono})`, `kpis([..])`, `vacio({titulo, texto, accion:{texto,href}})`, `cabecera({eyebrow,titulo,descripcion,acciones})`, `barras([{etiqueta,valor,texto,destacado}])`, `progreso({etiqueta,valor,minimo,texto})`, `opciones(lista, sel)`.
Interactivos devuelven objetos con `.el`:
- `tabla({columnas:[{clave,titulo,orden,buscable,align:'c|r',valor(f),formato(v,f),render(f)}], filas, buscar, ordenInicial, desc, porPagina:10|false, caption, vacio, acciones:[{texto,tipo,alClic(f),visible(f)}]})` → `{el, actualizar(filas), filas()}`. Las celdas por defecto se escapan; `render` devuelve HTML (escápalo).
- `modal({titulo, contenido:Node|html, botones:[{texto,valor,tipo,alClic(cerrar)}], tamano:'sm|lg'})` → `{el, cuerpo, cerrar(v), resultado:Promise}`; `<dialog>`, foco inicial y retorno, Esc/fondo/X → `null`.
- `confirmar({titulo, mensaje, textoOk, peligro})` → `Promise<boolean>`.
- `formulario({campos:[{nombre,label,tipo:'text|number|email|date|select|textarea|checkbox',requerido,opciones,ayuda,min,max,minLen,maxLen,patron,custom,ancho:'full',valor}], valores, alEnviar(vals), alCancelar, textoEnviar, sinBotones})` → `{el, valores(), validar(), enviar(), setErrores({campo|_general:msg}), enfocar()}`; errores con `aria-invalid` + `aria-describedby`; si `alEnviar` lanza, el mensaje se muestra en el formulario. `formularioModal({titulo, campos, valores})` → `Promise<valores|null>`.
- `tabs({tabs:[{id,titulo,render(panel)}], activa, alCambiar, siempre})` → `{el, seleccionar(id)}` (flechas/Home/End). `paginacion({total, porPagina, pagina, alCambiar})` → `{el, actualizar({total,pagina})}`.
- `toast(msg, 'info|ok|error|warn', ms)` (región `aria-live`), `montar(contenedor, nodoOHtml)`, `el(html)`.
- CSS reutilizable (`css/componentes.css`): `.card .grid .two .kpis .btn(.sec .amb .dng .sm) .badge .chip .alert(.red .ok) .tabs .fgrid .fld .note .tw table.t`. Impresión: `css/print.css` (`.no-print`, `.print-only`, `.salto-pagina`).

## 9. Pruebas
`tests/calculo.test.html` (abrir en el navegador; título `PASS`/`FAIL`, `window.__resultado`). Ejecución con Playwright: abrir por `file://` y leer `#res`.

## 10. Agente IA — `EDU.agente` (js/vistas/agente.js)
Capa intercambiable; la vista `agente` (config, consola, registro) y `comunicados` la usan. **Reglas fijas:** la API key vive solo en el servidor (el navegador no la guarda ni la envía; el campo de la UI es informativo); el contexto se minimiza y anonimiza; `borrador_notas` SIEMPRE exige aprobación humana, solo llena celdas vacías y nunca toca periodos cerrados (se revalida al aprobar); todo queda en `agenteLog`.
- **Colecciones.** `agenteConfig`: `{centroId, docenteId|null, activo, nombre, proveedor:'simulado'|'backend', modelo, autonomia:'sugiere'|'sugiere_y_aprueba'|'ejecuta_con_registro', tareas[], tono, nivel, instrucciones, limites:{maxSolicitudesDia}, consentimientoDatos}`. Una del centro (`docenteId:null`, techo) y opcionalmente una por docente, que solo puede restringir (`configEfectiva()` las combina). Tareas: `generar_plan proponer_actividades crear_rubricas redactar_comunicado resumir_rendimiento borrador_notas`.
  `agenteLog`: `{usuarioId (quién), fecha (cuándo), tarea, entrada (anonimizada), salida (resumen), aprobadoPor, estado:'pendiente|sugerida|aprobada|ejecutada|rechazada', propuesta, contexto (lo enviado, anonimizado), mapaLocal (alias→estudianteId, nunca se envía), proveedor, modelo, simulado, efecto}`.
- **Proveedor.** `EDU.agente.proveedor.solicitar(tarea, contexto, {proveedor, modelo, tono}) → Promise<propuesta>`. Propuesta: `{tarea, tipo:'plan|actividades|rubrica|comunicado|resumen|notas', resumen, simulado?, proveedor, modelo, generadoEn, ...}` más `plan{tema,objetivos,competencias,actividades[{fase,minutos,descripcion}],recursos,evaluacion,tarea}` | `items[]` | `criterios[]` | `{asunto,cuerpo}` | `{texto,hallazgos,recomendaciones}` | `{actividadId,puntosMax,items:[{ref,puntos}],advertencias}` (`ref` = alias `E01`, sin nombres). Se valida con `validarPropuesta`.
- **Simulado** (`proveedores.simulado`): plantillas deterministas locales, sin red. **Backend real:** `EDU.agente.registrarProveedor('backend', EDU.agente.crearProveedorHttp({url:'/api/agente/solicitar'}))` y elegir `proveedor:'backend'` en la configuración (exige `consentimientoDatos`). El adaptador hace `POST {version:1, tarea, contexto, modelo, tono}` con `credentials:'same-origin'`, **sin Authorization**; el servidor autentica la sesión, añade la API key, llama al modelo, aplica límites y responde la propuesta JSON. Cualquier objeto con `solicitar(tarea, contexto)` sirve. El backend debe volver a anonimizar/validar y registrar.
- **Orquestación.** `solicitar(tarea, {cargaId, texto, actividadId, fecha, audiencia}, {sinAuto}) → log` (comprueba activo/tarea/límite diario/alcance docente, construye el contexto, llama al proveedor, registra). `aprobar(logId, {aplicar:false?}) → log` (requiere `agente.aprobar`; docente solo lo suyo; plan aprobado → borrador en `planes` con `origen:'agente'`; notas → `calificaciones` auditadas; comunicado → borrador en `comunicados`). `rechazar(logId)`. `disponible(tarea) → {ok, motivo}`. `autonomia`: `sugiere` = sin aplicar; `sugiere_y_aprueba` = pendiente hasta aprobar; `ejecuta_con_registro` = aplica automático solo lo que no toca notas.
- **Anonimización.** `anonimizar(estudiantes)` → alias `E01…`; `limpiarTexto(texto, estudiantes, inverso)` reemplaza nombres, correos, teléfonos y cédulas; `verificarContexto` rechaza claves de datos personales.

## 11. Asistencia, comunicados y respaldo
- `asistencia`: `{id:'ast_<est>_<fecha>', seccionId, estudianteId, fecha, estado P|A|T|J, nota?, justificacion?, justificadoPor?}`. % = días sin ausencia injustificada (J no penaliza). Alerta: <85 %, ≥3 ausencias o ≥3 seguidas.
- `comunicados`: `{titulo, cuerpo, destinatarios:'todos|docentes|tutores|estudiantes', segmento:{tipo:'centro|curso|seccion|tutor', id}, estado:'borrador|publicado', fecha, autorId, lecturas:[{usuarioId,fecha}], origen?, agenteLogId?}`. **Limitación documentada:** docente/tutor/estudiante no tienen escritura en `comunicados` (matriz), por lo que la confirmación de lectura escribe `lecturas` con `EDU.repo.adaptador()`; un backend real debe exponer un endpoint propio.
- `respaldo`: formato `{_educentro:{formato:'educentro-respaldo',version:1,semilla,exportadoEn,exportadoPor,alcance}, datos:{<coleccion>:[...]}}` (también acepta el plano). `EDU.respaldo.validar(obj, sesion)`. Director exporta/importa solo su centro (importar fusiona; el resto de la red se conserva). Restablecer semilla solo `admin_red`.
- Nota: `repo.exportarTodo()` devuelve todos los centros sin filtrar (el adaptador no aplica centro); la vista filtra por centro para el director.

## 10. Currículo, secuencias y planificación (módulos `curriculo`, `secuencias`, `planificacion`)
- **Cambios en archivos compartidos (mínimos):** colección `secuencias` en `repo-local.js` (COLECCIONES), `permisos.js` (ruta `secuencias` en NAV/MATRIZ: docente CRUD, director ver/editar, secretaría ver; escritura: admin_red/director/docente), `index.html` (`data/curriculo-semilla.js` antes de `semilla.js`; `vistas/plan-util.js`, `vistas/secuencias.js` antes de `planificacion.js`), `semilla.js` (VERSION 3; llama a `EDU.curriculoSemilla.sembrar(D)`).
- `curriculoVersiones`: {id, centroId, nombre, idExterno, version, fuente, fechaPublicacion, vigenteDesde, estado `vigente|anterior|borrador`, hash (cyrb53 de los items), total, instrumentoLegal, schemaVersion}. Un registro `esConfig:true` (`cvcfg_<centro>`) guarda `intervaloDias`/`ultimaRevision` del aviso de revisión.
- `curriculoContenidos`: {id, centroId, versionId, **clave** (id estable entre versiones; el diff compara por clave), tipo `competencia_fundamental|competencia_especifica|contenido|indicador|eje_transversal|area|estructura`, subtipo, nivel, ciclo, grado (número|null), modalidad, areaId (= `asignaturas.codigo`), padreClave, descripcion, estado `verificado|pendiente`, fuente (url), fecha, orden}. Sembrado solo con lo respaldado por docs/CURRICULO-MINERD.md; el resto son entradas «pendiente de validar».
- Importación JSON: `{schemaVersion:'1.0.0', curriculum:{id, version|nombre, source:{url,retrievedAt,confidence}, validity, levels[]|items[]|fundamentalCompetencies[]...}}` (esquema del informe, con `estado`/`fuente` por nodo; también acepta `items` planos, que es lo que exporta la vista). `EDU.curriculoSemilla`: `validarDoc`, `aplanar`, `hashItems`, `registros`.
- `secuencias`: {id, centroId, cargaId, docenteId, titulo, curriculoVersionId, periodoId, fechaInicio/Fin, sesionesPrevistas, competenciasFundamentales[], competenciasEspecificas[], contenidos[], indicadoresLogro[] (items `{uid, ref, clave, texto, estado: verificado|pendiente|propio}`), ejesTransversales[], situacionAprendizaje, fases[{nombre inicio|desarrollo|cierre, actividades[], estrategias, recursos, tiempo}], evaluacion{tecnicas,instrumentos,criterios}, adecuaciones, estado `borrador|lista|en_ejecucion|finalizada`}. Las sesiones se derivan de `planes.secuenciaId`. Formato pendiente de validar con el modelo oficial MINERD.
- `planes` añade: `secuenciaId`, `indicadorIds[]` (uid de indicadores de la secuencia), `hora`, `duplicadoDe`. Plan `impartido` solo editable por director. Rutas: `#/secuencias`, `#/secuencias/:id` (`nueva`; `?modo=editar`), `#/planificacion?semana=YYYY-MM-DD&nuevo=1&cargaId=&secuenciaId=`. Helpers compartidos: `EDU.planUtil` (`js/vistas/plan-util.js`).

## 12. Cursos (cursos/talleres/electivas/refuerzos/módulos técnicos/virtuales)
Archivos: `js/vistas/cursos.js` (vistas `cursos` y `cursos/:id`), `js/vistas/cursos-logica.js` (`EDU.cursosLogica`, reglas sin DOM), `js/data/cursos-semilla.js` (`EDU.cursosSemilla.sembrar(D)`, invocado defensivamente desde `semilla.js`; para ver los datos en un navegador con semilla anterior usa "Restablecer datos demo"). No confundir con la colección `cursos` (grados escolares).
- **`cursosExtra`**: `{id, centroId, nombre, codigo (único por centro), tipo: taller|electiva|refuerzo|modulo_tecnico|virtual, docenteId, grados: ['Secundario:2', ...] (vacío = todos; clave `nivel:grado`), cupo (entero ≥1 | null = sin límite), inicio, fin, horario: [{dia 1-5, franjaId|null, desde 'HH:MM', hasta 'HH:MM', texto}], estado: abierto|en_curso|cerrado, descripcion}`. Si existe la colección `franjas` el editor usa sus franjas (se leen `desde|inicio`, `hasta|fin`, `nombre`) y copia las horas; si está vacía pide hora inicio/fin + nota de texto libre.
- **`inscripciones`**: `{id: 'ins_<cursoId>_<estudianteId>' (determinista: impide duplicados), centroId, cursoId, estudianteId, fecha, estado: inscrito|en_lista_espera|retirado|completado, turno (orden FIFO en espera), asistencia: [{fecha, estado P|A|T|J}], nota (0–100|null), observacion, motivoRetiro, fechaRetiro, fechaCierre}`. Ocupan cupo `inscrito` y `completado`. Asistencia % = sesiones sin `A`.
- **Reglas** (`EDU.cursosLogica`): `validarEstudiante(d, curso, est)` → mensaje|null (estudiante activo, curso no cerrado, sin inscripción activa duplicada, grado permitido vía matrícula activa, sin choque de horario —mismo día y franja u horas solapadas, con fechas de curso solapadas— con otros cursos suyos inscritos o en espera); `asignar(cursoId, estIds)` → `[{estudianteId, ok, estado|error}]` (cada estudiante se evalúa por separado; lleno el cupo pasa a `en_lista_espera`); `promover(cursoId)` (FIFO, se ejecuta al retirar, al subir el cupo y al editar); `retirar(insId, motivo)`; `reinscribir(insId)` (revalida; puede quedar en espera); `conteo`, `chocan`, `pctAsistencia`, `aCsv` (neutraliza celdas que empiezan por `= + - @`). Cerrar un curso cancela su lista de espera.
- **Permisos**: director/secretaría crean, editan, cierran y asignan; el docente solo ve la lista de **sus** cursos (`docenteId == refId`) y registra asistencia y nota/«completado» (escribe `inscripciones`, nunca `cursosExtra`); tutor/estudiante solo ven (vista «Mis cursos» y ficha) las inscripciones de su alcance. Constancia imprimible (`print.css`, bloque `.print-only` temporal) y CSV desde la ficha y el catálogo. Curso `virtual` enlaza a `#/aula`.
- **Limitaciones**: el choque de horario solo compara cursos entre sí (no contra el horario de secciones/`horarios`); el control de permisos es de cliente.
