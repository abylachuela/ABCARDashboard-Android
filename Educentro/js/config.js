/* Configuracion de ejecucion de EduCentro. Se carga PRIMERO (index.html) y NO contiene secretos.
   modo   'local' (def.): demo con datos en localStorage y selector de usuarios; funciona abriendo index.html por file://.
          'api'         : usa el servidor (Educentro/server): sesion por cookie HttpOnly, datos en PostgreSQL; nada personal en el navegador.
   apiBase  prefijo de la API. '/api/v1' = mismo origen (web con nginx). Una URL absoluta (app Capacitor, Fase 6) exige ademas
            anadir ese origen a `connect-src` en la CSP de index.html (y CORS/tokens en el servidor); la web NO lo necesita.
   El despliegue (`deploy.mjs --with-api`) REESCRIBE este archivo en la version publicada con modo 'api'; el repositorio conserva 'local'. */
window.EDU_CONFIG = Object.freeze({ modo: 'local', apiBase: '/api/v1' });
