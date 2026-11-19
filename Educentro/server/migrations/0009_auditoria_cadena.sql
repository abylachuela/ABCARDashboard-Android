-- 0009 · Auditoría de datos con cadena de hashes por centro (Fase 2).
-- Cada fila lleva `seq` (1, 2, 3… por centro), `prev_hash` (hash de la fila anterior; 64 ceros en la primera) y
-- `hash` = SHA-256 del contenido canónico de la fila + prev_hash. Lo calcula un trigger BEFORE INSERT dentro de la
-- misma transacción de la escritura auditada, bajo el bloqueo de la fila `auditoria_cabeza` del centro (las
-- inserciones del mismo centro se serializan: sin condiciones de carrera). El servidor fija usuario, rol, fecha,
-- IP y user-agent; el cliente nunca los elige. Quien tiene la BD completa (propietario/superusuario) PUEDE
-- reescribir toda la cadena: GET /auditoria/verificar detecta cualquier alteración parcial, y el hash final debe
-- anclarse periódicamente fuera de la VM (CLI `anclar-auditoria`). Ver docs/SEGURIDAD.md.

SELECT set_config('app.rol', 'admin_red', true); -- la migración opera sobre todos los centros (RLS FORCE)

ALTER TABLE auditoria
  ADD COLUMN seq        bigint,
  ADD COLUMN prev_hash  text,
  ADD COLUMN hash       text,
  ADD COLUMN ip         text CHECK (ip IS NULL OR length(ip) <= 45),
  ADD COLUMN user_agent text CHECK (user_agent IS NULL OR length(user_agent) <= 200);

-- Contenido canónico: array JSON (texto determinista de jsonb) con todos los campos, en orden fijo.
CREATE FUNCTION auditoria_canon(a auditoria) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_array(a.seq, a.id, a.centro_id, a.usuario_id, a.rol, a.accion, a.coleccion, a.registro_id,
                           a.antes, a.despues, a.extra,
                           to_char(a.fecha AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                           a.ip, a.user_agent, a.prev_hash)::text
$$;

-- Cabeza de la cadena por centro (último seq y hash). Solo el trigger (SECURITY DEFINER) la modifica.
CREATE TABLE auditoria_cabeza (
  centro_id text PRIMARY KEY,
  seq       bigint NOT NULL,
  hash      text NOT NULL
);

-- Relleno de las filas existentes (Fase 1): orden por fecha e id. El trigger de inmutabilidad se suspende SOLO aquí.
ALTER TABLE auditoria DISABLE TRIGGER auditoria_sin_cambios;
DO $$
DECLARE
  c text;
  r record;
  n bigint;
  prev text;
  h text;
BEGIN
  FOR c IN SELECT DISTINCT centro_id FROM auditoria ORDER BY 1 LOOP
    n := 0;
    prev := repeat('0', 64);
    FOR r IN SELECT id FROM auditoria WHERE centro_id = c ORDER BY fecha, id LOOP
      n := n + 1;
      UPDATE auditoria SET seq = n, prev_hash = prev WHERE id = r.id;
      SELECT encode(sha256(convert_to(auditoria_canon(a), 'UTF8')), 'hex') INTO h FROM auditoria a WHERE a.id = r.id;
      UPDATE auditoria SET hash = h WHERE id = r.id;
      prev := h;
    END LOOP;
    INSERT INTO auditoria_cabeza (centro_id, seq, hash) VALUES (c, n, prev);
  END LOOP;
END $$;
ALTER TABLE auditoria ENABLE TRIGGER auditoria_sin_cambios;

ALTER TABLE auditoria
  ALTER COLUMN seq SET NOT NULL,
  ALTER COLUMN prev_hash SET NOT NULL,
  ALTER COLUMN hash SET NOT NULL,
  ADD CONSTRAINT auditoria_seq_unica UNIQUE (centro_id, seq),
  ADD CONSTRAINT auditoria_hash_formato CHECK (hash ~ '^[0-9a-f]{64}$' AND prev_hash ~ '^[0-9a-f]{64}$');

CREATE FUNCTION auditoria_encadenar() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  cab auditoria_cabeza%ROWTYPE;
BEGIN
  INSERT INTO auditoria_cabeza (centro_id, seq, hash) VALUES (NEW.centro_id, 0, repeat('0', 64)) ON CONFLICT (centro_id) DO NOTHING;
  -- Bloqueo de la fila: hasta el COMMIT nadie más añade al mismo centro. Cada sentencia lee lo ya confirmado.
  SELECT * INTO cab FROM auditoria_cabeza WHERE centro_id = NEW.centro_id FOR UPDATE;
  NEW.seq := cab.seq + 1;
  NEW.prev_hash := cab.hash;
  NEW.fecha := clock_timestamp(); -- la fecha la fija el servidor de BD, monótona respecto al bloqueo
  NEW.hash := encode(sha256(convert_to(auditoria_canon(NEW), 'UTF8')), 'hex');
  UPDATE auditoria_cabeza SET seq = NEW.seq, hash = NEW.hash WHERE centro_id = NEW.centro_id;
  RETURN NEW;
END $$;
CREATE TRIGGER auditoria_cadena BEFORE INSERT ON auditoria FOR EACH ROW EXECUTE FUNCTION auditoria_encadenar();

-- La cabeza se lee con RLS por centro (para verificar); nadie la modifica salvo el trigger.
ALTER TABLE auditoria_cabeza ENABLE ROW LEVEL SECURITY; -- sin FORCE: el propietario (el trigger) la gestiona
CREATE POLICY cabeza_lectura ON auditoria_cabeza FOR SELECT
  USING (current_setting('app.rol', true) = 'admin_red' OR centro_id = NULLIF(current_setting('app.centro_id', true), ''));
REVOKE ALL ON auditoria_cabeza FROM PUBLIC;
GRANT SELECT ON auditoria_cabeza TO educentro_app;
REVOKE ALL ON FUNCTION auditoria_encadenar() FROM PUBLIC;
