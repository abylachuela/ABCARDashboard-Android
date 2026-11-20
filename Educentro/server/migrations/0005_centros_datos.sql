-- 0005 · `centros` como colección de la API (Fase 1): campos libres en `datos`, borrado lógico y RLS.
-- Se ejecuta con el rol PROPIETARIO. La API (educentro_app) NO es propietaria, así que la RLS le aplica.
ALTER TABLE centros
  ADD COLUMN datos jsonb NOT NULL DEFAULT '{}'::jsonb
      CHECK (jsonb_typeof(datos) = 'object' AND octet_length(datos::text) <= 262144),
  ADD COLUMN borrado_en timestamptz;

-- RLS sin FORCE a propósito: el propietario (migraciones, copias) queda fuera; la API siempre queda dentro.
-- Sin contexto (app.rol / app.centro_id) la API no lee ni escribe nada. Un centro solo ve su propia fila;
-- solo admin_red crea y modifica centros.
ALTER TABLE centros ENABLE ROW LEVEL SECURITY;
CREATE POLICY centros_lectura ON centros FOR SELECT TO educentro_app
  USING (current_setting('app.rol', true) = 'admin_red' OR id = NULLIF(current_setting('app.centro_id', true), ''));
CREATE POLICY centros_alta ON centros FOR INSERT TO educentro_app
  WITH CHECK (current_setting('app.rol', true) = 'admin_red');
CREATE POLICY centros_cambio ON centros FOR UPDATE TO educentro_app
  USING (current_setting('app.rol', true) = 'admin_red')
  WITH CHECK (current_setting('app.rol', true) = 'admin_red');
