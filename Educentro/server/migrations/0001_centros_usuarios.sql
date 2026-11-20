-- 0001 · Centros y usuarios.
-- Se ejecuta con el rol PROPIETARIO (educentro_owner). La API usa educentro_app, que NO es propietario
-- (condición para que la RLS de la Fase 1 le aplique). Ver db/roles.sql.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'educentro_app') THEN
    RAISE EXCEPTION 'Falta el rol educentro_app: ejecuta primero db/roles.sql (ver server/README.md)';
  END IF;
END $$;

CREATE FUNCTION tocar_actualizado_en() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END $$;

CREATE TABLE centros (
  id             text PRIMARY KEY,
  nombre         text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 200),
  codigo         text UNIQUE CHECK (codigo IS NULL OR length(codigo) BETWEEN 1 AND 50),
  activo         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER centros_actualizado BEFORE UPDATE ON centros
  FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en();

CREATE TABLE usuarios (
  id                  text PRIMARY KEY,
  centro_id           text REFERENCES centros (id),
  rol                 text NOT NULL
                      CHECK (rol IN ('admin_red', 'director', 'docente', 'secretaria', 'tutor', 'estudiante')),
  ref_id              text,
  nombre              text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 200),
  email               text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  hash                text NOT NULL,
  activo              boolean NOT NULL DEFAULT true,
  intentos            integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  bloqueado_hasta     timestamptz,
  debe_cambiar_clave  boolean NOT NULL DEFAULT false,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usuarios_email_unico UNIQUE (email),
  -- admin_red no pertenece a un centro; el resto, siempre.
  CONSTRAINT usuarios_centro_segun_rol CHECK (
    (rol = 'admin_red' AND centro_id IS NULL) OR (rol <> 'admin_red' AND centro_id IS NOT NULL)
  )
);
CREATE INDEX usuarios_centro_idx ON usuarios (centro_id);
CREATE TRIGGER usuarios_actualizado BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en();

GRANT SELECT, INSERT, UPDATE ON centros TO educentro_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON usuarios TO educentro_app;
