-- 0003 · Tokens de recuperación de contraseña (un solo uso; solo se guarda el hash SHA-256).
CREATE TABLE tokens_recuperacion (
  hash       text PRIMARY KEY CHECK (hash ~ '^[0-9a-f]{64}$'),
  usuario_id text NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  creado_en  timestamptz NOT NULL DEFAULT now(),
  expira     timestamptz NOT NULL,
  usado_en   timestamptz
);
CREATE INDEX tokens_recuperacion_usuario_idx ON tokens_recuperacion (usuario_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON tokens_recuperacion TO educentro_app;
