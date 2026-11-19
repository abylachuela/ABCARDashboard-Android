# EduCentro Mobile (Capacitor 6, Android)

Proyecto Capacitor **independiente** de la app Android raíz (ABCAR). Empaqueta la web de `Educentro/` en un APK.

## Requisitos
Node 18+, JDK 17, Android SDK 34 (`ANDROID_HOME` definido o `android/local.properties` con `sdk.dir=...`).

## Pasos
```bash
cd Educentro/mobile
npm install
npm run cap:add      # solo la primera vez (ya existe android/ si se generó)
npm run cap:sync     # sync-web (copia + inyección móvil) + cap sync android
npm run cap:open     # abre Android Studio
npm run apk:debug    # -> android/app/build/outputs/apk/debug/app-debug.apk
```
`scripts/sync-web.js` copia `index.html`, `css/`, `js/` (y `assets/` si existe) a `www/` (excluye docs, propuestas, tests, mobile). En `www/index.html` inyecta viewport con `viewport-fit=cover`, `theme-color`, enlace a `manifest.webmanifest` (generado), CSS de safe-area y el manejo de StatusBar/botón atrás. El `index.html` original no se modifica. `www/` no se versiona: regenerar siempre con `npm run sync-web`.

## Ajustes móviles
- **StatusBar / SplashScreen**: en `capacitor.config.json` (color `#1e3a8a`). Sin imagen de splash propia: añadir iconos/splash con `@capacitor/assets` cuando haya logo.
- **Botón atrás**: la app usa router por hash; el botón atrás hace `history.back()` y, en la raíz, `App.exitApp()`. Ajustar en `sync-web.js` si se añaden modales que deban cerrarse primero.
- **Safe-area**: `env(safe-area-inset-*)` en el body.
- `androidScheme: https` (origen `https://localhost`), sin cleartext ni `allowNavigation`.

## Permisos
Solo `INTERNET` (lo añade Capacitor; necesario para el futuro backend). No se pide cámara ni almacenamiento: ninguna función actual lo requiere. Si se añade subida de fotos/archivos, usar el selector del sistema (`<input type=file>`) o declarar `CAMERA` en `AndroidManifest.xml` justificándolo aquí.

## Firmar release
```bash
keytool -genkey -v -keystore educentro.keystore -alias educentro -keyalg RSA -keysize 2048 -validity 10000
cd android && ./gradlew assembleRelease     # o bundleRelease para Play Store
zipalign -v 4 app/build/outputs/apk/release/app-release-unsigned.apk educentro.apk
apksigner sign --ks ../educentro.keystore educentro.apk
```
No subir el keystore ni contraseñas al repo (ya ignorados).

## Backend real
Hoy los datos son locales (almacén en el WebView). Para apuntar a un backend: servirlo por **HTTPS**, configurar CORS para `https://localhost`, poner la URL base en la capa de datos de `js/data/` y no usar `server.url`/cleartext en producción.

## Estado verificado
`sync-web` genera `www/` y carga por file:// sin errores de JS. `index.html` de origen referencia `js/vistas/secuencias.js`, que aún no existe (404 en consola hasta que otro agente lo cree).
