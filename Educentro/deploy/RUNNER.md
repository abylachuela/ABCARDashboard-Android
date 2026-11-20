# Despliegue desde GitHub Actions con un runner propio en la VM

La VM está en una red privada y no se puede alcanzar desde internet. Por eso **no** se despliega por SSH desde GitHub: se instala en la VM un *runner* de GitHub Actions que **conecta hacia GitHub** (solo tráfico de salida HTTPS) y espera trabajos. El workflow `.github/workflows/deploy-vm.yml` es manual (`workflow_dispatch`), pide aprobación en el entorno `produccion` y ejecuta `sudo -n node Educentro/deploy/deploy.mjs` en la propia VM. No se guarda ninguna contraseña de root ni clave SSH en GitHub.

```
GitHub (repo privado) <── HTTPS saliente ── runner en la VM ──> sudo node deploy.mjs ──> nginx
```

## 0. Entiende el riesgo antes de empezar
- El runner ejecuta el código del repositorio. La regla de sudo (sección 4) permite al usuario `gh-runner` ejecutar `deploy.mjs` **como root**. Por tanto, **quien pueda cambiar `deploy.mjs` o el workflow en el repositorio (y lanzarlo) controla root en la VM.**
- Como `workflow_dispatch` usa el workflow de la rama elegida, cualquiera con permiso de escritura puede lanzar una rama con un workflow modificado y ejecutar código en el runner. La guarda de rama del workflow es una comodidad, **no** una barrera de seguridad: la barrera real es (a) quién tiene permiso de escritura, (b) `main` protegida y (c) la aprobación manual del entorno `produccion` restringido a `main`.
- Concede escritura solo a personas de confianza y trata ese permiso como acceso root a la VM.

## 1. Preparar la VM
```bash
# Node 20 o superior, instalado como paquete del sistema (que quede en /usr/bin/node; no uses nvm: sudo no lo ve)
node --version && command -v node        # v20.x o superior, /usr/bin/node
# (NodeSource o el repositorio oficial de tu distribución; sigue su guía actual)
```
nginx lo instala `deploy.mjs` si falta (apt, dnf o yum). Opcional pero recomendable: `git` (lo usa `actions/checkout`; si falta, usa la descarga por API, más lenta).

## 2. Usuario dedicado `gh-runner`
```bash
sudo adduser --disabled-password --gecos "" gh-runner     # sin contraseña: no se puede entrar con ella
sudo usermod -s /usr/sbin/nologin gh-runner               # sin shell de login interactivo
# Sin grupos privilegiados: NO lo añadas a sudo, docker ni adm.
```
Con `nologin` el runner sigue funcionando (lo arranca systemd); para trabajar como ese usuario usa `sudo -u gh-runner -H bash` desde tu cuenta de administración.

## 3. Instalar el runner
1. En GitHub: repositorio → **Settings → Actions → Runners → New self-hosted runner** → Linux. La página muestra comandos de descarga con la versión vigente y un **token de registro** de un solo uso y corta vida.
2. **El token lo genera y lo pega solo quien administra el repositorio, en la VM. No lo compartas con nadie** (ni por chat, ni con una IA, ni en un archivo del repositorio).
3. En la VM, como `gh-runner`, ejecuta los comandos de esa página (descargar, verificar y extraer en `/home/gh-runner/actions-runner`) y configura con la etiqueta propia:
```bash
sudo -u gh-runner -H bash
cd ~/actions-runner
./config.sh --url https://github.com/<dueño>/<repositorio> --token <TOKEN_DE_LA_PÁGINA> \
  --labels educentro-vm --name educentro-vm --unattended
exit
```
`self-hosted` y `linux` los añade el runner solo; el resultado son las etiquetas `self-hosted, linux, educentro-vm`, que son las que pide el workflow. Úsalo a nivel de repositorio (no de organización) para que ningún otro repositorio pueda usarlo.

## 4. Regla de sudo mínima
Crea `/etc/sudoers.d/educentro-deploy` **validándola antes de instalarla** (un error en sudoers puede dejarte sin sudo):
```bash
# Cambia <repositorio> por el nombre real de la carpeta (el runner usa _work/<repo>/<repo>).
cat > /tmp/educentro-deploy <<'EOF'
# El usuario del runner solo puede ejecutar node sobre el deploy.mjs de su carpeta de trabajo, sin contraseña.
gh-runner ALL=(root) NOPASSWD: /usr/bin/node /home/gh-runner/actions-runner/_work/<repositorio>/<repositorio>/Educentro/deploy/deploy.mjs *
EOF
sudo visudo -cf /tmp/educentro-deploy && \
  sudo install -m 0440 -o root -g root /tmp/educentro-deploy /etc/sudoers.d/educentro-deploy
rm -f /tmp/educentro-deploy
sudo visudo -c                                   # valida todo el sistema
sudo -l -U gh-runner                             # debe mostrar solo esa línea
```
Detalles que importan:
- sudo compara **la cadena exacta** del comando: por eso el workflow llama a `sudo -n node "$GITHUB_WORKSPACE/Educentro/deploy/deploy.mjs" ...` con ruta absoluta, y por eso la regla no usa comodines en la ruta (un `*` en la ruta casaría también `/` y `..`). El `*` final son los argumentos (`--https-mode=...`, etc.), que el propio script valida con listas blancas.
- sudo vacía las variables de entorno, así que el workflow pasa las opciones como argumentos (`--server-name`, `--https-mode`, `--email`, `--with-api`, `--dry-run`).
- Si tu `node` no está en `/usr/bin/node` (`command -v node`), cambia esa ruta en la regla.
- Si algún día quieres poder hacer rollback desde el workflow, añade una segunda línea igual con `rollback.mjs`; hoy se hace por SSH (`sudo node Educentro/deploy/rollback.mjs`).
- **Alternativa más estricta**: copia `Educentro/deploy/deploy.mjs` a un directorio de `root` (`/opt/educentro-deploy/`, permisos 0755, dueño root) tras revisarla, apunta la regla a esa copia y actualízala a mano en cada cambio. Así un cambio en el repositorio no se convierte en root sin que tú lo revises. (Tendrías que cambiar la ruta que usa el workflow.)

## 5. Servicio systemd del runner
El runner trae su instalador de servicio:
```bash
cd /home/gh-runner/actions-runner
sudo ./svc.sh install gh-runner      # crea y habilita actions.runner.<...>.service, ejecutándose como gh-runner
sudo ./svc.sh start
sudo ./svc.sh status                 # debe estar "active (running)"
journalctl -u 'actions.runner.*' -f  # registros
```
En GitHub (Settings → Actions → Runners) debe aparecer **Idle** con las tres etiquetas.

## 6. Entorno `produccion` y protecciones del repositorio
- **Settings → Environments → New environment → `produccion`**: *Required reviewers* = tú (el dueño; si trabajas solo, deja desmarcado *Prevent self-review*); *Deployment branches and tags* = **Selected branches → `main`**. Sin aprobación el trabajo no arranca.
- **Settings → Branches / Rulesets**: protege `main` (pull request obligatorio, sin push directo, sin force-push).
- **Settings → Actions → General**: *Fork pull request workflows*: exige aprobación para todos; no actives workflows de PR de forks. El repositorio es privado: mantenlo así (un runner propio en un repositorio **público** es peligroso).
- Los otros workflows del repositorio usan `ubuntu-latest`; ninguno debe usar las etiquetas de este runner.

## 7. Primer uso
1. Primero una **simulación**: Actions → *Desplegar Educentro en la VM* → *Run workflow* en `main`, marca `dry_run`. Aprueba el entorno. El resumen muestra qué haría `deploy.mjs` sin tocar nada.
2. Si aún no está fusionado a `main`: en *Use workflow from* elige tu rama y escribe su nombre en `ref_permitida` (p. ej. `mi-rama`). Además añade temporalmente esa rama a *Deployment branches* del entorno `produccion`. **Al terminar, quita esa rama del entorno y deja `ref_permitida` en `main`.**
3. Despliegue real: sin `dry_run`. Revisa el resumen (comprobaciones `OK ...`) y abre `https://<SERVER_NAME>/`.
4. Para volver atrás: por SSH, `sudo node /home/gh-runner/actions-runner/_work/<repo>/<repo>/Educentro/deploy/rollback.mjs` (o desde tu copia del repositorio).

## 8. Actualizar el runner
Por defecto el runner se **actualiza solo** cuando GitHub publica una versión nueva. Si lo desactivaste o falla: `sudo ./svc.sh stop`, descarga la versión nueva desde la página *New self-hosted runner* (misma carpeta; conserva `.runner` y `.credentials`), extrae encima como `gh-runner` y `sudo ./svc.sh start`. Una versión demasiado vieja deja de recibir trabajos. Actualiza también Node y el sistema (`apt upgrade`) con tu rutina habitual.

## 9. Cortafuegos
- **Entrada**: ninguna para el runner. Solo 80/443 hacia tu red interna (la web) y SSH desde tu equipo de administración.
- **Salida**: el runner solo necesita HTTPS (443) hacia GitHub: `github.com`, `api.github.com`, `*.actions.githubusercontent.com`, `codeload.github.com`, `objects.githubusercontent.com` (la lista oficial cambia: consulta «Communication between self-hosted runners and GitHub» en la documentación de GitHub). Para instalar paquetes hacen falta además tus réplicas de apt/dnf, y `acme-v02.api.letsencrypt.org` si usas `HTTPS_MODE=letsencrypt`. `ufw` no filtra por nombre: aplica la regla en el cortafuegos/proxy de salida de tu red.
- No abras puertos de la VM a internet por esto.

## 10. Qué NO hacer
- No ejecutes el runner como `root`, ni lo añadas a `sudo`, `docker` ni `adm`. No des a `gh-runner` una regla `ALL`.
- No registres el runner en un repositorio público ni ejecutes en él pull requests de forks.
- No guardes secretos de root, claves SSH ni tokens en el repositorio ni en los secretos del workflow.
- No pegues el token de registro en chats, tickets ni commits (caduca rápido, pero dentro de ese plazo permite registrar un runner).
- No pongas comodines en la ruta de la regla de sudo, ni uses `sudo bash -c` / `sudo sh`.
- No dejes una rama de prueba permitida en el entorno ni `ref_permitida` distinta de `main` después de la primera prueba.
- No compartas la VM del runner con otros proyectos: los trabajos dejan archivos en `_work`.

## 11. Desinstalar
```bash
cd /home/gh-runner/actions-runner
sudo ./svc.sh stop && sudo ./svc.sh uninstall
# Token de baja: Settings → Actions → Runners → (runner) → Remove; pega el comando que muestra (lo genera el administrador)
sudo -u gh-runner -H ./config.sh remove --token <TOKEN_DE_BAJA>
sudo rm -f /etc/sudoers.d/educentro-deploy && sudo visudo -c
sudo deluser --remove-home gh-runner
```
Después, en GitHub, comprueba que el runner ya no aparece y elimina el entorno `produccion` si ya no lo usas. El sitio publicado en `/var/www/educentro` no se toca.

## Lista de comprobación de seguridad
- [ ] Repositorio **privado**; runner registrado a nivel de **repositorio**.
- [ ] Runner con el usuario `gh-runner`: sin contraseña, `nologin`, fuera de `sudo`/`docker`/`adm`; el servicio no corre como root.
- [ ] `/etc/sudoers.d/educentro-deploy` validado con `visudo -c`, permisos 0440, una sola línea, ruta absoluta sin comodines, solo `node` + `deploy.mjs`.
- [ ] `sudo -l -U gh-runner` no muestra nada más.
- [ ] Entorno `produccion` con aprobación manual y solo la rama `main`.
- [ ] `main` protegida (PR obligatorio); escritura solo para gente de confianza (equivale a root en la VM).
- [ ] Workflows de PR de forks desactivados o con aprobación; ningún otro workflow usa las etiquetas del runner.
- [ ] `ref_permitida` = `main` y sin ramas de prueba en el entorno.
- [ ] Cortafuegos: sin entradas para el runner; salida limitada a GitHub (y a los repositorios de paquetes).
- [ ] Sin secretos de root/SSH en GitHub; token de registro no compartido con nadie.
- [ ] Node 20+ y el runner actualizados; `journalctl -u 'actions.runner.*'` revisado tras cada despliegue.
- [ ] Probado primero con `dry_run`.
