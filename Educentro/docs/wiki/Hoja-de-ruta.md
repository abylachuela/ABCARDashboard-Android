# Hoja de ruta

Lo ya hecho está en [Historial](Historial). Pendiente, por prioridad.

## 1. Backend/API real y control de acceso en servidor (bloqueante para datos reales)
- Autenticación (OIDC o sesión HttpOnly) y autorización por centro, rol y alcance **en el servidor**; repetir allí las reglas de `permisos.js` y de propiedad del repo.
- Adaptador API para `EDU.repo.usar(adaptadorApi)`; endpoints propios para `auditar` y `registrarLectura`; auditoría inmutable.
- Calificación de cuestionarios y validaciones de negocio (periodo cerrado, pesos, notas) en servidor.
- Añadir su origen a `connect-src`; cabeceras HTTP (CSP con `frame-ancestors`, HSTS), límites de tasa.
- Sincronización entre usuarios y **notificaciones push**.
- Proxy del agente IA con la API key en servidor ([Agente IA](Agente-IA)).

## 2. Seguridad pendiente
- **Actualizar SheetJS a ≥ 0.20.3** (`xlsx-0.20.3.tgz` → `js/vendor/`, correr `tests/planilla.test.html`) o procesar los `.xlsx` en el servidor / en un `Worker` aislado.
- Autoalojar Fraunces e Inter y retirar los dominios de Google de la CSP.
- Migrar estilos inline a hojas para quitar `'unsafe-inline'`.

## 3. Funcionalidad
- **Enlace de cursos virtuales (`cursosExtra` tipo `virtual`) con el aula**: abrir un curso virtual propio con los inscritos como participantes, y unir su horario al del estudiante.
- Choque de horario de cursos contra el horario de secciones.

## 4. Android
- **Probar el APK en un dispositivo** y **verificar la CSP con el puente de Capacitor** (botón atrás).
- **Iconos y splash** propios.
- Release firmado, `minifyEnabled true`, bloqueo de pantalla/biometría, limpieza de datos al cerrar sesión ([App Android](App-Android)).

## 5. Contenido normativo
- **Verificar el currículo con los PDFs oficiales** del MINERD (diseños curriculares, adecuación 2023, Ordenanza 04-2023) y reemplazar los "pendiente de validar" ([Curriculo MINERD](Curriculo-MINERD)).
- **Confirmar el formato oficial de la secuencia didáctica** y ajustar el editor.
- Confirmar edades, periodos, promoción, completivos y calendario.

## 6. Calidad
- Versionar y ejecutar en CI los scripts de smoke por rol/ancho, fuzz XSS y aislamiento por centro.
- **Validaciones de producción**: revisión de privacidad con datos reales y consentimiento del centro para el agente.
