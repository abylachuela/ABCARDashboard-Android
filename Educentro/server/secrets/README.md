# secrets/

Aquí van (solo en la VM, **nunca en git**; `.gitignore` los excluye) los archivos que `compose.yml` monta como Docker secrets.
El directorio queda en modo 700 y los archivos en 644 (así los lee el usuario no root de cada contenedor; el acceso lo limita el directorio). Un salto de línea final en cada archivo se recorta al leerlo.

| Archivo | Contenido |
|---|---|
| `postgres_password` | contraseña del superusuario `postgres` (solo para inicializar y administrar) |
| `db_owner_password` | contraseña del rol `educentro_owner` (migraciones) |
| `db_app_password` | contraseña del rol `educentro_app` (la API) |
| `database_url` | `postgres://educentro_app:<db_app_password>@db:5432/educentro` |
| `migration_database_url` | `postgres://educentro_owner:<db_owner_password>@db:5432/educentro` |
| `session_secret` | >= 32 bytes aleatorios (`openssl rand -base64 48`) |
| `backup_passphrase` | frase de paso de las copias (`openssl rand -base64 48`). **Guárdala también fuera de la VM**: sin ella no se restauran las copias |
| `smtp_pass` | (opcional) contraseña SMTP; vacío si no se usa |

Si una contraseña lleva caracteres especiales en una URL, codifícala (`openssl rand -hex 24` evita el problema).
Generación rápida de todo: `server/secrets/generar.sh`.
