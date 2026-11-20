-- 0004 · Auditoría de accesos, append-only. Sin contraseñas, tokens, correos ni contenido personal.
-- usuario_id NO es clave foránea a propósito: el registro debe sobrevivir al borrado del usuario.
CREATE TABLE auditoria_accesos (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fecha      timestamptz NOT NULL DEFAULT now(),
  evento     text NOT NULL CHECK (evento IN (
               'login_ok', 'login_fallo', 'logout', 'bloqueo', 'cambio_clave',
               'recuperacion_solicitada', 'restablecida')),
  usuario_id text,
  ip         text,
  user_agent text
);
CREATE INDEX auditoria_accesos_fecha_idx ON auditoria_accesos (fecha);
CREATE INDEX auditoria_accesos_usuario_idx ON auditoria_accesos (usuario_id, fecha);

-- Defensa 1: privilegios. La API solo puede leer e insertar.
REVOKE ALL ON auditoria_accesos FROM PUBLIC;
GRANT SELECT, INSERT ON auditoria_accesos TO educentro_app;

-- Defensa 2: trigger que aborta UPDATE, DELETE y TRUNCATE incluso para el propietario.
-- (Un superusuario o el propietario podrían desactivar el trigger: queda en los registros de PostgreSQL.)
CREATE FUNCTION auditoria_accesos_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'auditoria_accesos es de solo anexado: % no permitido', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER auditoria_accesos_sin_cambios
  BEFORE UPDATE OR DELETE ON auditoria_accesos
  FOR EACH ROW EXECUTE FUNCTION auditoria_accesos_inmutable();
CREATE TRIGGER auditoria_accesos_sin_truncate
  BEFORE TRUNCATE ON auditoria_accesos
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_accesos_inmutable();
