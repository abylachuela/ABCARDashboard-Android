# Despliegue de Educentro en una VM (nginx)

Educentro es un **sitio estático** (HTML/CSS/JS): nginx solo sirve archivos. Los datos viven en el navegador de cada usuario hasta que el backend (Fase 0 ya implementada en `Educentro/server`, ver `docs/BACKEND.md`) se conecte al frontend en la Fase 1; el proxy de la API es opcional (`WITH_API=1`).

## Qué hace `deploy.sh`
- Instala nginx si falta (apt, dnf o yum).
- Copia **solo** `index.html`, `css/` y `js/` a una versión nueva en `/var/www/educentro/releases/<fecha>` y activa el enlace `current` de forma atómica (nunca queda el sitio a medias).
- Configura nginx con HTTPS, redirección de HTTP a HTTPS, cabeceras de seguridad (CSP con `frame-ancestors`, `nosniff`, `no-referrer`…) y respuestas 404 para `datos-privados/`, `docs/`, `mobile/`, `tests/`, `propuestas/` y cualquier `.xlsx/.csv/.md`.
- Conserva las últimas 5 versiones y comprueba al final que `/` responde y que lo privado devuelve 404.
- Probado en Ubuntu 24.04 con nginx 1.24 (fallos reales corregidos durante la prueba). No probado en tu VM concreta.

## Pasos (en la VM, como root)
```bash
git clone https://github.com/abylachuela/ABCARDashboard-Android.git
cd ABCARDashboard-Android
git checkout claude/jolly-curie-3ovzdl     # o main cuando se fusione el PR
sudo bash Educentro/deploy/deploy.sh
```
Si el repositorio es privado, clónalo con tu usuario/token de GitHub, o copia la carpeta desde tu equipo:
```bash
scp -r Educentro root@IP_DE_LA_VM:/root/Educentro   # solo index.html, css y js son necesarios; datos-privados NO se copia a ningún sitio
```
(con `scp` desde tu máquina, excluye `Educentro/datos-privados`; el script además lo elimina del sitio publicado).

## Modos de HTTPS
| Modo | Uso |
|---|---|
| `HTTPS_MODE=selfsigned` (por defecto) | Red interna / IP. El navegador avisa de certificado no confiable; hay que aceptarlo una vez. |
| `HTTPS_MODE=letsencrypt SERVER_NAME=notas.tudominio.edu EMAIL=tu@correo` | Certificado válido y renovable. Necesita un **dominio** que apunte a la VM y el puerto 80 abierto a internet (no funciona con IPs privadas). |
| `HTTPS_MODE=none` | Solo HTTP. No lo uses con datos reales. |

Otras variables: `SERVER_NAME` (por defecto la IP de la VM), `APP_DIR`, `KEEP`, `WITH_API` y `API_UPSTREAM` (ver abajo).

## Con la API (opt-in: `WITH_API=1`)
Por defecto el despliegue es **solo estático** y no cambia. Con `WITH_API=1` el script añade además el proxy a la API del backend (`Educentro/server`, Fase 0):
```bash
# 1) Arranca la API (Educentro/server/README.md → «Docker»): escucha en 127.0.0.1:3000
# 2) Publica web + proxy:
sudo WITH_API=1 SERVER_NAME=notas.tudominio.edu EMAIL=tu@correo HTTPS_MODE=letsencrypt bash Educentro/deploy/deploy.sh
```
- Crea `location ^~ /api/` y `location ^~ /api/v1/auth/` (proxy a `API_UPSTREAM`, por defecto `127.0.0.1:3000`) con `X-Forwarded-For/Proto/Host` fijados por nginx (el cliente no puede falsear su IP), `client_max_body_size 1m`, `limit_req` con zonas propias (`edu_api` 10 r/s, `edu_auth` 2 r/s con ráfaga) y sin caché. Las cabeceras de seguridad de `/api/` las envía la propia API.
- Configura la API con `PUBLIC_URL=https://<SERVER_NAME>` y `TRUST_PROXY` con la IP de nginx. Como web y API comparten origen, la CSP (`connect-src 'self'`) **no cambia**.
- Si la API aún no responde, el script avisa (502) pero termina bien; si nginx no enruta `/api/` (404) falla. Volver a ejecutar sin `WITH_API` elimina el proxy.
- Probado aquí con nginx real (modo estático y modo API, `nginx -t` en ambos, y con la API detrás: login por HTTPS, cookie `__Host-`, 413 a 1 MB, 429 por `limit_req`); no probado en tu VM.

## Actualizar y volver atrás
```bash
cd ABCARDashboard-Android && git pull && sudo bash Educentro/deploy/deploy.sh    # nueva versión
sudo bash Educentro/deploy/rollback.sh                                           # volver a la anterior
```

## Cortafuegos
Abre solo 80 y 443 (`ufw allow 80,443/tcp` o `firewall-cmd --add-service=http --add-service=https --permanent`). El script no toca el cortafuegos.

## Si algo falla
- `nginx -t` indica errores de configuración; `/var/log/nginx/error.log` el detalle.
- En RHEL/Rocky con SELinux: `chcon -R -t httpd_sys_content_t /var/www/educentro`.
- Sitio en blanco: revisa la consola del navegador; la CSP solo permite scripts del mismo origen y Google Fonts.

## La app Android con la VM
La app móvil lleva la web empaquetada y no necesita la VM para funcionar. Cuando haya backend, habrá que apuntarla a su dirección HTTPS en `mobile/capacitor.config.json` y permitir ese origen en `connect-src` de la CSP (`index.html` y `deploy.sh`). Un certificado autofirmado **no** lo aceptará la app móvil: para eso usa un dominio con Let's Encrypt.

## Seguridad (importante)
- Todo el control de acceso es del lado del navegador: **no cargues datos reales de estudiantes** hasta tener backend.
- Cambia la contraseña de root si se compartió por un chat, y usa claves SSH en lugar de contraseña.
