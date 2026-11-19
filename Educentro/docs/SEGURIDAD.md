# EduCentro · Informe de seguridad y calidad (pasada final)

Alcance: `Educentro/` (scripts clásicos, namespace `EDU`, `file://`) y su empaquetado `mobile/` (Capacitor 6 / Android).
Método: revisión estática de `js/vistas`, `js/ui`, `js/core`, `js/data`; pruebas dinámicas con Playwright (Chromium) sobre `file://`; búsqueda de secretos y de datos personales en el árbol y en el historial reciente. Este informe no contiene nombres de personas.

## Resumen

| Severidad | Hallazgos | Estado |
|---|---|---|
| Crítico | 1 | Limitación estructural (control de acceso solo en cliente); mitigado parcialmente |
| Alto | 4 | 3 corregidos, 1 mitigado (SheetJS 0.18.5) |
| Medio | 8 | Corregidos |
| Bajo | 7 | 4 corregidos, 3 documentados |

XSS: **0 inyecciones** con cargas útiles en los 6 roles (ver «Pruebas»). Secretos: **ninguno**. Nombres reales de la planilla en archivos versionados: **0 archivos** (ni en `git log -p -n 40`).

## Hallazgos

### Crítico
- **C1 · Todo el control de acceso es del lado cliente.** Roles, centro activo y alcance (`EDU.permisos`, guardias de `EDU.repo`) se ejecutan en el navegador sobre `localStorage`. Quien tenga acceso al dispositivo/DevTools puede leer todas las colecciones (`edu:v1:col:*`), editar `edu:sesion` o llamar `EDU.repoLocal` directamente; el cuestionario con respuestas correctas viaja al navegador del estudiante. *No se puede corregir sin backend.* Mitigación aplicada (defensa en profundidad, no sustituye al servidor): al arrancar, `app.js` contrasta la sesión persistida con el registro de usuario (rol, centro, `refId`) y la descarta si no coincide; el repo exige coherencia de centro, propiedad y rol en cada escritura (ver A1–A3, M1). **No usar con datos reales de estudiantes en producción hasta tener backend.**

### Alto
- **A1 · Escrituras que se saltaban los permisos** (corregido). `EDU.repo.adaptador().guardar('auditoria', …)` en `libro-notas`, `libro-competencias` e `importar-planilla`, y `ad.guardar('comunicados', …)` para las lecturas de comunicados (cualquier rol, sin validar). Ahora: `EDU.repo.auditar(accion, datos)` (valida sesión, rol auditor y centro; fija `usuarioId`, `rol`, `fecha`; lista blanca de campos y recorte de texto) y `EDU.repo.registrarLectura(comunicadoId)` (valida centro, estado publicado, audiencia por rol y segmento de tutor; solo añade `{usuarioId, fecha}` del propio usuario). Ninguna vista usa ya `adaptador()`/`repoLocal` para escribir (`grep` limpio; `respaldo.js`, `aula-util.js` y `semilla.js` solo leen `COLECCIONES`/`advertencia` o siembran).
- **A2 · `exportarTodo()` devolvía todos los centros** a cualquier rol con permiso `respaldo` y `importarTodo()` aceptaba cualquier objeto (corregido). Ahora el repo filtra por centro para roles no `admin_red`; la importación aborta si trae registros de otro centro o usuarios `admin_red`, conserva los datos de otros centros y no permite reescribir `auditoria` (un director podía borrar su rastro importando un respaldo con `auditoria: []`).
- **A3 · Escalada de privilegios** (corregido en el repo): un director podía guardar su propio usuario con `rol:'admin_red'`. Ahora solo `admin_red` crea/modifica usuarios `admin_red` y nadie cambia su propio rol, centro o `refId`.
- **A4 · SheetJS 0.18.5 vendorizado** (CVE-2023-30533 contaminación de prototipos, corregido en 0.19.3; CVE-2024-22363 ReDoS, corregido en 0.20.2). **No se pudo actualizar**: `curl https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` → `CONNECT tunnel failed, response 403` (proxy del entorno); no se evadió. El paquete npm `xlsx` está congelado en 0.18.5. Mitigaciones reales (`js/core/planilla.js`, probadas):
  - solo `.xlsx` ≤ 10 MB, firma ZIP, ≤ 300 componentes, ≤ 60 MB descomprimidos (anti zip-bomb), rutas con `..` o absolutas rechazadas, sin `vbaProject`, `externalLinks`, `embeddings`, `activeX`, macrosheets;
  - lectura con `cellText:false` (nunca se invoca `SSF.format`, el vector del ReDoS), `cellStyles/cellNF/cellHTML/cellDates/bookVBA/bookProps:false`, `sheetRows` limitado, ≤ 40 hojas, ≤ 1500 filas y ≤ 120 columnas por hoja;
  - `EDU.planilla.prevalidarAsync`: descomprime solo `xl/styles.xml` (tope 2 MB) y rechaza > 400 formatos de número o formatos > 250 caracteres;
  - instantánea de `Object/Array/Function/String/Number.prototype` antes y después de `XLSX.read`: si aparece cualquier propiedad nueva, se **elimina** y se **aborta** con error (test en `tests/planilla.test.html`);
  - el contenido jamás se evalúa; las fórmulas se leen como texto; todo texto se muestra con `EDU.esc`; al exportar, `= + - @` se neutralizan;
  - aviso visible en la pantalla de importación: usar solo archivos propios y de confianza.
  - **Riesgo residual:** el parser sigue siendo vulnerable a variantes aún no conocidas y a un ReDoS en otros módulos de SheetJS (la UI puede congelarse unos segundos con un archivo hostil; no hay `Worker` aislado porque `file://` impide cargar el script). Mientras no se actualice, importar solo planillas propias. Para actualizar: extraer `package/dist/xlsx.full.min.js` de `xlsx-0.20.3.tgz` en `js/vendor/` y correr `tests/planilla.test.html` (instrucciones en `js/vendor/README.txt`).

### Medio
- **M1 · Propiedad a nivel de repo** (corregido): un docente podía escribir notas/actividades/categorías de cargas ajenas y un estudiante entregas, intentos o mensajes de foro de otros. Ahora `repo.guardar/borrar` valida `cargas.docenteId === refId` para docente y `estudianteId`/`autorId` propios para estudiante. Sigue pendiente a nivel servidor (el estudiante aún puede alterar los campos `puntos/estado` de su propia entrega con la consola).
- **M2 · Sin CSP** (corregido, ver «Cabeceras/CSP»).
- **M3 · Android:** `allowBackup="true"` (copia de datos de menores a la nube del usuario) y `FileProvider` con `external-path="."` (corregido: `allowBackup=false`, `fullBackupContent=false`, `usesCleartextTraffic=false`, `webContentsDebuggingEnabled=false`, `loggingBehavior:none`, `file_paths.xml` solo `cache-path`). `exported`: solo `MainActivity` (launcher, necesario) y el provider con `exported=false`.
- **M4 · Adjuntos `data:`** admitían cualquier MIME (HTML/SVG activos) (corregido: `dataUrlSegura` rechaza html/xml/svg/javascript; los enlaces siguen limitados a http/https y llevan `rel="noopener noreferrer"`).
- **M5 · Bug de lectura de `franjas`:** el registro `{tipo:'config'}` de horarios se mostraba como una franja inexistente en «Cursos y talleres» (corregido en `cursos-logica.js`; `horarios-motor.js` ya lo excluía). Ningún otro módulo lee `franjas`.
- **M6 · Permiso del director en Calificaciones:** reutilizaba `cerrar` para editar notas (corregido: acción propia `editar`; `cerrar` queda solo para cerrar/reabrir periodos).
- **M7 · Contraste (WCAG 1.4.11 / 2.4.11):** `--field-line` (#b9b3a4) 2.09:1 y foco ámbar 2.04:1 sobre blanco (corregido: `--field-line:#837d6e` 4.1:1; foco `--focus:#1d4580` 9.5:1 con halo blanco; el menú lateral oscuro conserva ámbar, 6.3:1).
- **M8 · Desbordamiento horizontal a 375 px** en el panel de docente/secretaría (las rejillas `.grid` no tenían `min-width:0`) (corregido).

### Bajo
- **B1 (corregido) · Áreas táctiles < 44 px:** radios de asistencia (23 px de alto), checkbox del boletín/importador y radio «correcta» del cuestionario. Ahora toda etiqueta con checkbox/radio mide ≥ 44 px.
- **B2 (corregido) · `.gitignore`:** añadidos `*.xls`, `*.xlsm`, `educentro-respaldo-*.json`, `planilla-*.csv` (ya estaban `datos-privados/` y `*.xlsx`).
- **B3 (corregido) · Región `aria-live` de toasts** creada en `index.html` (antes se creaba al primer aviso y a veces no se anuncia).
- **B4 (documentado) · Google Fonts** (tercero): cada carga envía la IP del dispositivo a Google. Hay fuentes de respaldo del sistema; recomendado autoalojar Fraunces/Inter (no fue posible descargarlas aquí) y retirar `fonts.googleapis.com`/`fonts.gstatic.com` de la CSP y del `<link>`.
- **B5 (documentado) · `'unsafe-inline'` en `style-src`:** existen cientos de atributos `style=""` en plantillas de las vistas y `<style>` inyectados por JS (`estilo()` en cada módulo). Eliminarlo exige migrarlos a hojas/clases externas. No afecta a `script-src`, que no admite inline ni eval.
- **B6 (documentado) · `localStorage` sin cifrar**, cuota ~5 MB, archivos del aula en base64 dentro de `localStorage`; los datos persisten si el dispositivo se comparte. Cerrar sesión no borra los datos.
- **B7 (documentado) · Release Android:** `minifyEnabled false`, sin configuración de firma versionada (correcto: `*.keystore` ignorado). Permiso único `INTERNET` (solo para las fuentes y un futuro API; sin él la app funciona offline).

## Qué se verificó y resultado

| Control | Resultado |
|---|---|
| XSS: `innerHTML`/`insertAdjacentHTML`/`outerHTML`/`document.write`/`eval`/`new Function`/`setAttribute('on…')`/`href` dinámicos en todo `js/` | Sin `eval`, `Function`, `document.write` ni `outerHTML`. Todos los `innerHTML`/`insertAdjacentHTML` con datos pasan por `EDU.esc`/`EDU.html`/`A.texto`/`A.htmlEnlace`; los `href` dinámicos son hash-rutas con `encodeURIComponent` o `urlSegura` (solo http/https) |
| XSS dinámico | Se envenenaron TODOS los campos de texto de todas las colecciones sembradas y se crearon fixtures (aula: temas, recursos, tareas, entregas, cuestionarios con banco, foros, anuncios; secuencias, planes, comunicados, agente, auditoría) con `"'><img onerror><svg onload></textarea>` y `javascript:`; 6 roles × ~49 rutas (incluye parámetros de hash hostiles: `aula/<payload>`, `?tab=`, `?est=`, `?cargaId=`…) + clic en hasta 25 botones/pestañas por ruta (modales y editores incluidos): **0 ejecuciones, 0 elementos inyectados, 0 `javascript:`**. Control positivo: el detector captura una inyección real. Importador: hoja, nombre de archivo y celdas con carga útil se muestran como texto |
| CSV/Excel de salida | Todas las exportaciones (`centros`, `cursos-logica`, `reportes`, `horarios-motor`, `planilla`) prefijan `'` a celdas que empiezan con `= + - @ \t \r` |
| Aislamiento por centro y por estudiante (Playwright, hash/URL con IDs ajenos y capa `EDU.repo`) | director/docente/secretaría/tutor/estudiante: sin fugas del centro 2 en ninguna vista (`personas/<id>`, `centros/<id>`, `aula/<carga>`, `libro-notas?cargaId=`, `cursos/<id>`…); tutor/estudiante no ven a otro estudiante del mismo centro (`personas/<id>`, `aula/…?est=<otro>`); `listar/guardar/borrar/importar/auditar/registrarLectura` con datos de otro centro → error o `null` |
| `franjas` con `tipo:'config'` | No rompe otras lecturas (único lector fuera de horarios corregido) |
| Secretos | Sin claves/tokens/credenciales/keystore en el árbol ni en `git log -p -n 40` (patrones: `sk-`, `AKIA`, `AIza`, `ghp_`, `xox*`, claves privadas, `password/secret/api_key =`); la clave de API del agente es un campo `disabled` y nunca se guarda (`localStorage` solo contiene `edu:sesion`, `edu:v1:*`, `edu:ultimo-respaldo`) |
| Datos personales | `datos-privados/` y `*.xlsx` ignorados por git (`git check-ignore`). Se extrajeron 214 frases de nombre de la planilla (apellidos/nombres por columna) y se compararon, sin imprimirlas, con todos los archivos versionados y no ignorados y con `git log -p -n 40`: **0 coincidencias** |
| Contraste AA (script) | Todos los pares de texto de la paleta ≥ 4.5:1 (mínimo: `muted` sobre `#ece8de` 4.81:1); las no conformidades eran de componentes no textuales (M7) |

## Cabeceras / CSP

`index.html` (y `mobile/www/index.html` generado por `sync-web.js`):

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; manifest-src 'self';
object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'
```
+ `<meta name="referrer" content="no-referrer">`. Verificado en Chromium por `file://`: la app completa funciona; `eval`, `new Function`, scripts inline y manejadores inline quedan **bloqueados**. Notas: (1) una `<meta>` CSP no puede fijar `frame-ancestors`; si se sirve por HTTP, enviar la cabecera real; (2) el script inline que `sync-web.js` inyectaba (botón atrás) pasó a `native.js`; (3) **verificar en un dispositivo** que el puente de Capacitor (que Android inyecta al inicio del documento) no se bloquee: si el botón atrás deja de funcionar, añadir el hash del script inyectado a `script-src`; no se pudo construir el APK en este entorno.

## Agente IA: tarea `proponer_horario`
- Sensible: siempre exige aprobación humana (también en `ejecuta_con_registro`); el agente nunca guarda horarios. Solo director/secretaría/admin_red con `horarios.editar`, comprobado al solicitar y al aprobar; el docente, el tutor y el estudiante no la ven ni pueden solicitarla.
- El contexto enviado es una lista blanca de ids, horas y restricciones; los docentes viajan como alias `D01…` y el texto libre (≤ 300 caracteres) pasa por `limpiarTexto`. El simulado no usa red; la API key sigue solo en el servidor.
- La salida del proveedor se valida por esquema (ids conocidos, días 1–5, franjas de clase), se descarta lo inválido y el motor re-valida conflictos antes de la vista previa; todo dato mostrado pasa por `EDU.esc` y la resolución queda en `agenteLog` y `auditoria` (`EDU.repo.auditar`). Para ello `secretaria` recibió escritura en `agenteLog`.

## Backend, Fase 0 (`Educentro/server/`)
Existe ya la base del servidor: login real con sesión en cookie opaca `__Host-edu_sid` (HttpOnly, Secure, SameSite=Lax; solo se guarda su hash), argon2id, bloqueo con retroceso y rate limit, CSRF (`X-EDU-CSRF` + `Origin`), recuperación por token de un solo uso y auditoría de accesos append-only en PostgreSQL (rol de la app distinto del propietario). **Aún no protege los datos del frontend**: la autorización por rol/centro/alcance, la RLS y la conexión de `EDU.repo` llegan en la Fase 1, así que las limitaciones de abajo siguen vigentes hasta entonces. Ver `docs/BACKEND.md` y `server/README.md`.

## Limitaciones conocidas (requieren backend)
1. Autenticación y autorización reales (hoy el login es un selector de usuarios demo y la sesión es editable en `localStorage`).
2. Datos en el servidor, no en el navegador: cifrado en reposo, copias, retención, borrado.
3. Registro de auditoría inmutable en servidor (hoy `auditoria` vive en el mismo almacén que el atacante controla).
4. Cuestionarios: calificar y guardar respuestas correctas solo en el servidor.
5. Validación de entradas y reglas de negocio (periodo cerrado, pesos, notas) duplicadas en servidor.
6. Importación de Excel en el servidor o en un `Worker` aislado con SheetJS ≥ 0.20.3.
7. Cabeceras HTTP (CSP con `frame-ancestors`, HSTS), límites de tasa, anti-fuerza-bruta.

## Recomendaciones (orden de prioridad)
1. Backend con autenticación (OIDC/sesión HttpOnly), autorización por centro/rol/alcance y API para `EDU.repo.usar(adaptadorApi)`; mover `auditar` y `registrarLectura` a endpoints propios.
2. Actualizar SheetJS a ≥ 0.20.3 en cuanto haya red (`xlsx-0.20.3.tgz`) o procesar los `.xlsx` en el servidor.
3. Autoalojar las fuentes y retirar los dominios de Google de la CSP.
4. Migrar estilos inline a clases/hojas para eliminar `'unsafe-inline'`.
5. Build de release Android firmado, `minifyEnabled true`, pantalla de bloqueo/biometría y limpiar datos al cerrar sesión en dispositivos compartidos.
6. Añadir las pruebas de esta pasada (fuzz XSS, aislamiento por centro, smoke de rutas por rol y ancho) a CI.

## Pruebas de regresión (Playwright/Chromium, `file://`)
- `tests/calculo.test.html`: PASS 28/28. `tests/planilla.test.html`: PASS 10/10 (2 nuevas: aborto por contaminación de prototipos; rechazo de macros/enlaces externos/exceso de componentes).
- Smoke: 6 roles × 30 rutas (incluye rutas con parámetros y una inexistente) = 180 visitas en cada configuración, a 1280 px y 375 px, con modelo ponderado y con modelo por competencias: **0 errores de consola (incluidas violaciones de CSP), 0 tarjetas de error, 0 desbordamientos horizontales**.
