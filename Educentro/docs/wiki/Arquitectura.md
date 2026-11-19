# Arquitectura

## Principios
- **Scripts clásicos, sin build y sin ES modules**, para que la app corra por `file://`. Todo cuelga del namespace global `window.EDU`; cada archivo es una IIFE.
- **Un archivo por vista** en `js/vistas/<ruta>.js`, más helpers por módulo (`aula-util.js`, `horarios-motor.js`, `cursos-logica.js`, `plan-util.js`).
- Funciones de cálculo **puras** en `js/core/` (sin DOM ni almacenamiento).
- Acceso a datos solo a través de `EDU.repo` (fachada con adaptador intercambiable).

## Estructura
```
Educentro/
  index.html          orden de <script> y CSP
  css/                base, layout, componentes, aula, print
  js/
    core/             almacen, formato, escala, calculo, planilla, validacion, permisos
    vendor/           SheetJS 0.18.5 (xlsx.full.min.js) + licencia + README
    data/             repo-local, repo, semilla, curriculo-semilla, cursos-semilla, consultas
    estado.js  router.js  app.js  ui/componentes.js
    vistas/           una por módulo (+ helpers)
  tests/              calculo.test.html, planilla.test.html
  docs/               PLAN, API, CURRICULO-MINERD, PLANTILLAS-CALIFICACION, SEGURIDAD, wiki/
  mobile/             proyecto Capacitor (Android)
  propuestas/         3 propuestas visuales (historial)
```

## Capas
```
 Vistas (js/vistas/*)  ──usa──▶  EDU.ui (componentes)   EDU.router (hash)
        │                              │
        ▼                              ▼
 EDU.consultas (cargar, resumenNotas)   EDU.permisos (matriz, alcance)
        │                              │
        ▼                              ▼
 EDU.repo  (sesión + centro activo + permisos de escritura + propiedad + auditoría)
        │  adaptador intercambiable: EDU.repo.usar(adaptador)
        ▼
 EDU.repoLocal (localStorage)   ← hoy        API HTTP  ← futuro
        ▼
 EDU.almacen (localStorage con fallback en memoria)

 EDU.calculo / EDU.escala / EDU.planilla : funciones puras usadas por vistas y consultas
```

## Orden de carga (index.html)
`core/almacen → formato → escala → calculo → vendor/xlsx → planilla → validacion → permisos → data/repo-local → repo → curriculo-semilla → semilla → cursos-semilla → consultas → estado → ui/componentes → router → vistas (login, dashboard, módulos) → app.js`. Un módulo nuevo: crear `js/vistas/<ruta>.js`, listarlo antes de `app.js` y añadir su entrada en `EDU.permisos.NAV` y `MATRIZ`.

## Router
Router por hash (`#/ruta/:param?query`). `EDU.router.register(ruta, {titulo, render(container, params)})`; el módulo de una ruta es su primer segmento. 403/404 los resuelve el router; si `render` lanza, se muestra una tarjeta de error. El `render` puede devolver una función de limpieza.

## Repositorio con adaptador
`EDU.repo` expone `listar`, `consultar`, `contar`, `obtener`, `guardar`, `guardarMuchos`, `borrar`, `exportarTodo`, `importarTodo`, `auditar`, `registrarLectura` y `usar(adaptador)`. Aplica: sesión obligatoria, filtro por centro activo (un no-admin que pida otro centro recibe `Error('Centro no permitido')`), permiso de escritura por colección y rol, **propiedad** (docente solo sus cargas; estudiante solo lo propio; solo `admin_red` crea usuarios `admin_red`) y auditoría automática de `calificaciones` y `notasCompetencia`. El adaptador por defecto `EDU.repoLocal` usa `localStorage` (claves `edu:v1:col:<coleccion>`, ~5 MB) con aviso si cae a memoria. Con `EDU_CONFIG.modo='api'` se activa `EDU.repoApi` (`js/data/repo-api.js`: API REST con cookie HttpOnly y CSRF, caché en memoria); `js/config.js` se carga primero.

## Sesión
`EDU.estado`: `sesion()`, `iniciarSesion`, `cerrarSesion`, `cambiarCentro`, `onCambio`. Persistida en `edu:sesion`; al arrancar `app.js` la contrasta con el registro de usuario (rol, centro, `refId`) y la descarta si no coincide. Solo `admin_red` puede elegir "Todos los centros".

## Componentes de UI
`EDU.ui`: `tabla`, `modal`, `confirmar`, `formulario`, `tabs`, `toast`, `kpis`, `cabecera`, `badge`, etc. Todo dato de usuario se escapa con `EDU.esc` / `EDU.html` (ver [Seguridad y privacidad](Seguridad-y-privacidad)). Impresión con `css/print.css`.

Ver también [Modelo de datos](Modelo-de-datos) y [Roles y permisos](Roles-y-permisos).
