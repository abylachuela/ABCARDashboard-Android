-- Crea los roles y la base de datos de EduCentro. Ejecutar UNA vez como superusuario de PostgreSQL:
--
--   psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 \
--        -v owner_pw="$(cat /ruta/clave_propietario)" -v app_pw="$(cat /ruta/clave_app)" \
--        -v dbname=educentro -f db/roles.sql
--
-- educentro_owner : propietario de la BD y de las tablas; solo lo usan las migraciones (MIGRATION_DATABASE_URL).
-- educentro_app   : lo usa la API (DATABASE_URL). NO es propietario, NO es superusuario y NO tiene BYPASSRLS,
--                   de modo que las políticas RLS por centro de la Fase 1 le aplicarán.
-- Es idempotente: si los roles existen, solo actualiza las contraseñas.

SELECT 'CREATE ROLE educentro_owner LOGIN'
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educentro_owner') \gexec
SELECT 'CREATE ROLE educentro_app LOGIN'
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educentro_app') \gexec

ALTER ROLE educentro_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'owner_pw';
ALTER ROLE educentro_app   NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'app_pw';

SELECT format('CREATE DATABASE %I OWNER educentro_owner ENCODING ''UTF8''', :'dbname')
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'dbname') \gexec

REVOKE ALL ON DATABASE :"dbname" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"dbname" TO educentro_app;

\connect :dbname

REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO educentro_owner;
GRANT USAGE ON SCHEMA public TO educentro_app;
