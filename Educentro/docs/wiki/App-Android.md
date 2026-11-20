# App Android

Proyecto **Capacitor 6** independiente en `Educentro/mobile/` (no toca la app ABCAR de la raíz del repositorio). Empaqueta la web de `Educentro/` en un APK. Id: `com.educentro.app`, nombre EduCentro. Detalle en `mobile/README.md`.

## Requisitos
Node 18+, JDK 17 y Android SDK 34 (`ANDROID_HOME` o `android/local.properties` con `sdk.dir=…`). Este entorno no tenía SDK: **el APK no se ha construido ni probado en un dispositivo**.

## Pasos
```bash
cd Educentro/mobile
npm install
npm run cap:add      # solo la primera vez (la carpeta android/ ya existe)
npm run cap:sync     # sync-web (copia web a www/) + cap sync android
npm run cap:open     # Android Studio
npm run apk:debug    # android/app/build/outputs/apk/debug/app-debug.apk
```
`scripts/sync-web.js` copia `index.html`, `css/` y `js/` (incluido `js/vendor/`) a `www/`, excluyendo docs, propuestas, tests y mobile; sustituye el viewport por uno con `viewport-fit=cover`, añade `theme-color`, manifiesto web y safe-area, y genera `native.js` (StatusBar y botón atrás: retrocede en el historial de hash y en la raíz sale de la app). El script va en archivo externo porque la CSP prohíbe scripts inline. `www/` no se versiona.

## Configuración endurecida
`allowBackup=false`, `fullBackupContent=false`, `usesCleartextTraffic=false`, `webContentsDebuggingEnabled=false`, `FileProvider` solo con `cache-path`, esquema `https` (origen `https://localhost`), único permiso `INTERNET` (fuentes de Google y futuro API; sin él la app funciona offline). No se piden cámara ni almacenamiento.

## Firmar release
`keytool -genkey …` → `./gradlew assembleRelease` (o `bundleRelease`) → `zipalign` → `apksigner`. El keystore y las contraseñas **nunca** se suben (`*.keystore` ignorado). El build de release tiene `minifyEnabled false`.

## Pendientes
- Construir el APK y **probarlo en un dispositivo** (SDK no disponible aquí).
- **CSP con Capacitor**: comprobar que el puente que Android inyecta no quede bloqueado; si falla el botón atrás, añadir el hash del script a `script-src`.
- **Iconos y splash**: se usan los predeterminados de Capacitor; generar los propios con `@capacitor/assets` cuando haya logo.
- Datos locales por WebView: sin backend no hay sincronización ni notificaciones push. Con backend: HTTPS, CORS para `https://localhost` y sin `server.url`/cleartext.
- Release: firma, `minifyEnabled true`, bloqueo de pantalla/biometría y limpieza de datos al cerrar sesión en dispositivos compartidos.

Ver [Hoja de ruta](Hoja-de-ruta) y [Seguridad y privacidad](Seguridad-y-privacidad).
