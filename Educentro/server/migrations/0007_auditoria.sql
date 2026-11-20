-- 0007 · Auditoría de datos (calificaciones, notas por competencias, exportaciones, importaciones…).
-- Append-only: sin UPDATE ni DELETE para la API (REVOKE) y un trigger que los aborta incluso para el propietario.
-- (Es distinta de `auditoria_accesos`, que registra inicios de sesión.) usuario_id y centro_id NO son claves
-- foráneas a propósito: el registro debe sobrevivir al borrado del usuario o del centro.
CREATE TABLE auditoria (
  id          text PRIMARY KEY DEFAULT ('aud_' || replace(gen_random_uuid()::text, '-', '')),
  centro_id   text NOT NULL,
  usuario_id  text NOT NULL,
  rol         text NOT NULL,
  accion      text NOT NULL CHECK (length(accion) BETWEEN 1 AND 60),
  coleccion   text,
  registro_id text,
  antes       jsonb,
  despues     jsonb,
  extra       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(extra) = 'object' AND octet_length(extra::text) <= 131072),
  fecha       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_centro_fecha_idx ON auditoria (centro_id, fecha DESC);
CREATE INDEX auditoria_registro_idx ON auditoria (centro_id, coleccion, registro_id);

ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria FORCE ROW LEVEL SECURITY;
CREATE POLICY auditoria_lectura ON auditoria FOR SELECT
  USING (current_setting('app.rol', true) = 'admin_red' OR centro_id = NULLIF(current_setting('app.centro_id', true), ''));
CREATE POLICY auditoria_alta ON auditoria FOR INSERT
  WITH CHECK (current_setting('app.rol', true) = 'admin_red' OR centro_id = NULLIF(current_setting('app.centro_id', true), ''));

-- Defensa 1: privilegios.
REVOKE ALL ON auditoria FROM PUBLIC;
GRANT SELECT, INSERT ON auditoria TO educentro_app;

-- Defensa 2: trigger (UPDATE, DELETE y TRUNCATE abortan).
CREATE FUNCTION auditoria_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'auditoria es de solo anexado: % no permitido', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER auditoria_sin_cambios BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION auditoria_inmutable();
CREATE TRIGGER auditoria_sin_truncate BEFORE TRUNCATE ON auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_inmutable();
