-- 0002 · Sesiones. El id es el SHA-256 (hex) del token opaco de 256 bits: la BD nunca guarda el token.
CREATE TABLE sesiones (
  id               text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
  usuario_id       text NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  creada           timestamptz NOT NULL DEFAULT now(),
  expira           timestamptz NOT NULL,
  ultima_actividad timestamptz NOT NULL DEFAULT now(),
  ip               text,
  user_agent       text
);
CREATE INDEX sesiones_usuario_idx ON sesiones (usuario_id);
CREATE INDEX sesiones_expira_idx ON sesiones (expira);

GRANT SELECT, INSERT, UPDATE, DELETE ON sesiones TO educentro_app;
