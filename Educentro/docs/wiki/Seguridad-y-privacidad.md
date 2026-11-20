# Seguridad y privacidad

Resume `docs/SEGURIDAD.md` (pasada final de seguridad y calidad, 2026-11-19). Ese informe no contiene nombres de personas.

> **EduCentro es un prototipo con datos ficticios. No usarlo con datos reales de estudiantes en producción hasta tener un backend con autenticación y autorización.**

## Resultado de la pasada
| Severidad | Hallazgos | Estado |
|---|---|---|
| Crítico | 1 | Limitación estructural (control de acceso solo en cliente); mitigado parcialmente |
| Alto | 4 | 3 corregidos, 1 mitigado (SheetJS 0.18.5) |
| Medio | 8 | Corregidos |
| Bajo | 7 | 4 corregidos, 3 documentados |

## XSS
Convención: todo dato de usuario insertado en HTML pasa por `EDU.esc` / `EDU.html` (o `textContent`); nunca `innerHTML = dato`. No hay `eval`, `new Function`, `document.write` ni `outerHTML`. Enlaces dinámicos: hash-rutas con `encodeURIComponent` o `urlSegura` (solo http/https, con `rel="noopener noreferrer"`). Adjuntos solo `data:` con MIME pasivo (se rechazan html/svg/xml/javascript). Verificado con cargas útiles (`"'><img onerror>`, `<svg onload>`, `javascript:`) en todos los campos de texto, 6 roles y ~49 rutas con parámetros hostiles: 0 ejecuciones. Las exportaciones CSV/Excel anteponen `'` a celdas que empiezan por `= + - @`.

## CSP
`<meta http-equiv="Content-Security-Policy">` en `index.html`: `default-src 'none'; script-src 'self'` (sin inline ni eval), `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`, `font-src https://fonts.gstatic.com`, `img-src 'self' data: blob:`, `connect-src 'self'`, `object-src/base-uri/form-action/frame-src/worker-src 'none'`, más `referrer: no-referrer`. `'unsafe-inline'` solo en estilos (cientos de atributos `style` en plantillas). Una `<meta>` no puede fijar `frame-ancestors`: si se sirve por HTTP, enviar la cabecera real.

## Permisos solo del lado cliente (hallazgo crítico C1)
Roles, centro activo y alcance se ejecutan en el navegador sobre `localStorage`: quien tenga acceso al dispositivo o a DevTools puede leer todas las colecciones o editar `edu:sesion`. Mitigaciones (defensa en profundidad, **no sustituyen al servidor**): contraste de la sesión con el usuario al arrancar; el repo valida centro, propiedad y rol en cada escritura; `EDU.repo.auditar` y `registrarLectura` en vez de escrituras directas; `exportarTodo` filtra por centro; `importarTodo` aborta con datos ajenos y no reescribe `auditoria`; un director no puede escalar a `admin_red`.

## API key del agente
Nunca en el navegador (campo deshabilitado); vive solo en el servidor. Contexto anonimizado y registro en `agenteLog`. Ver [Agente IA](Agente-IA).

## Datos personales
- La semilla es **ficticia**. Los datos reales (planilla Excel) están en `Educentro/datos-privados/`, **ignorada por git**, igual que `*.xlsx`, `*.xls`, `*.xlsm`, `educentro-respaldo-*.json` y `planilla-*.csv`.
- Verificación: se compararon 214 frases de nombre de la planilla contra todos los archivos versionados y el historial reciente: 0 coincidencias. Esta wiki no incluye nombres ni notas reales.
- `localStorage` sin cifrar; los datos persisten si el dispositivo se comparte y cerrar sesión no los borra. Google Fonts envía la IP a un tercero (recomendado autoalojar las fuentes).
- Android: `allowBackup=false` para no copiar datos de menores a la nube.

## Importador de Excel
SheetJS 0.18.5 con CVE conocidos y mitigaciones propias; ver [Planilla Excel y competencias](Planilla-Excel-y-competencias). Riesgo residual: un archivo hostil podría congelar la UI unos segundos. Importar solo planillas propias.

## Límites conocidos (requieren backend)
1. Autenticación y autorización reales (hoy el login es un selector de usuarios demo).
2. Datos en servidor con cifrado, copias y retención.
3. Auditoría inmutable en servidor.
4. Cuestionarios: calificar y guardar respuestas correctas solo en servidor.
5. Validación y reglas de negocio (periodo cerrado, pesos, notas) también en servidor.
6. Importación de Excel en servidor o en un `Worker` aislado con SheetJS ≥ 0.20.3.
7. Cabeceras HTTP (CSP con `frame-ancestors`, HSTS), límites de tasa y anti-fuerza-bruta.

## Accesibilidad (WCAG)
Contraste AA en la paleta, bordes de campo y foco ≥ 3:1, áreas táctiles ≥ 44 px, región `aria-live` para avisos, sin desbordamiento horizontal a 375 px.

Siguiente: [Pruebas](Pruebas), [Hoja de ruta](Hoja-de-ruta).
