-- 0010 · Integridad de reglas de negocio en el SERVIDOR (Fase 3A).
-- Restricciones UNIQUE parciales (solo entre registros vivos: borrado_en IS NULL) sobre columnas GENERADAS (STORED) a partir
-- de `datos`, como en 0008: el registro y la API no cambian. Además, una tabla de secuencias por centro (código MAT y turno
-- de las listas de espera).
--
-- DATOS PREVIOS: antes de crear cada índice único se RESUELVEN los duplicados que ya hubiera, sin perder filas:
--   * documento (cédula): se normaliza a 11 dígitos; si no los tiene (o está repetido en la colección y el centro), la fila
--     más antigua conserva el documento y las demás lo pierden: queda en `documentoOriginal` (y `migracion0010`).
--   * código MAT repetido: las filas más recientes reciben un código nuevo de la secuencia (`MAT-<n>-<####>`).
--   * matrícula repetida (centro, estudiante, año): queda la activa (o la más reciente); las otras se marcan borradas.
--   * año / escala activos: queda uno (el de fecha de inicio más reciente / el primero por id); los demás pasan a inactivos.
--   * versión de currículo «vigente» repetida: queda la más reciente; las demás pasan a «anterior».
--   * sección repetida (curso, año, nombre): la repetida recibe el sufijo « (2)», « (3)»…
--   * periodo con orden repetido en el año: se renumeran los órdenes del año (1…n según orden y antigüedad).
--   * inscripción repetida (curso, estudiante): queda la de mejor estado; las otras se marcan borradas.
--   * carga repetida (sección, asignatura): si la repetida no tiene categorías ni actividades se marca borrada; si las tiene,
--     la migración se DETIENE con un mensaje que lista la carga (se resuelve a mano: fusionar o reasignar).
-- Las filas tocadas llevan `migracion0010` en `datos` para poder auditarlas.
SELECT set_config('app.rol', 'admin_red', true); -- la migración opera sobre todos los centros (RLS FORCE)

-- ------------------------------------------------------------------------------------------------ secuencias por centro
CREATE TABLE secuencias_centro (
  centro_id text    NOT NULL REFERENCES centros (id),
  nombre    text    NOT NULL CHECK (nombre ~ '^[a-z_]{1,40}$'),
  valor     bigint  NOT NULL CHECK (valor >= 0),
  PRIMARY KEY (centro_id, nombre)
);
ALTER TABLE secuencias_centro ENABLE ROW LEVEL SECURITY;
ALTER TABLE secuencias_centro FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_centro ON secuencias_centro
  USING (current_setting('app.rol', true) = 'admin_red' OR centro_id = NULLIF(current_setting('app.centro_id', true), ''))
  WITH CHECK (current_setting('app.rol', true) = 'admin_red' OR centro_id = NULLIF(current_setting('app.centro_id', true), ''));
REVOKE ALL ON secuencias_centro FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON secuencias_centro TO educentro_app;

-- Siguiente valor de una secuencia del centro (bloquea la fila hasta el fin de la transacción). Si la secuencia no existe
-- arranca en max(`base`, `minimo`) + 1, siendo `base` el mayor valor ya usado (lo calcula quien llama).
CREATE FUNCTION siguiente_secuencia(p_centro text, p_nombre text, p_base bigint) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  INSERT INTO secuencias_centro (centro_id, nombre, valor) VALUES (p_centro, p_nombre, greatest(p_base, 0) + 1)
  ON CONFLICT (centro_id, nombre) DO UPDATE SET valor = greatest(secuencias_centro.valor, greatest(p_base, 0)) + 1
  RETURNING valor INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION siguiente_secuencia(text, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION siguiente_secuencia(text, text, bigint) TO educentro_app;

-- ------------------------------------------------------------------------------------------------ documento y código MAT
DO $$
DECLARE
  t text;
  tablas text[] := ARRAY['estudiantes', 'docentes', 'tutores'];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    -- 1) documento no vacío y que no tenga 11 dígitos → se aparta
    EXECUTE format($f$
      UPDATE %I SET datos = (datos - 'documento') || jsonb_build_object('documentoOriginal', datos->>'documento', 'migracion0010', 'documento_invalido')
       WHERE datos ? 'documento'
         AND (jsonb_typeof(datos->'documento') <> 'string'
              OR (regexp_replace(datos->>'documento', '\D', '', 'g') <> '' AND regexp_replace(datos->>'documento', '\D', '', 'g') !~ '^\d{11}$'))$f$, t);
    -- 2) documento repetido (mismo centro) → conserva la fila más antigua
    EXECUTE format($f$
      WITH d AS (
        SELECT id, row_number() OVER (PARTITION BY centro_id, regexp_replace(datos->>'documento', '\D', '', 'g') ORDER BY creado_en, id) AS rn
          FROM %I WHERE borrado_en IS NULL AND regexp_replace(coalesce(datos->>'documento', ''), '\D', '', 'g') <> '')
      UPDATE %I x SET datos = (x.datos - 'documento') || jsonb_build_object('documentoOriginal', x.datos->>'documento', 'migracion0010', 'documento_duplicado')
        FROM d WHERE d.id = x.id AND d.rn > 1$f$, t, t);
    EXECUTE format($f$
      ALTER TABLE %I ADD COLUMN documento_norm text
        GENERATED ALWAYS AS (nullif(regexp_replace(coalesce(datos->>'documento', ''), '\D', '', 'g'), '')) STORED$f$, t);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (documento_norm IS NULL OR documento_norm ~ ''^\d{11}$'')', t, t || '_documento_chk');
    EXECUTE format('CREATE UNIQUE INDEX %I ON %I (centro_id, documento_norm) WHERE borrado_en IS NULL AND documento_norm IS NOT NULL', t || '_documento_uidx', t);
  END LOOP;
END $$;

-- código MAT: los repetidos de un centro reciben un código nuevo de la secuencia (la fila más antigua conserva el suyo)
DO $$
DECLARE
  f record;
  mx bigint;
  n bigint;
BEGIN
  FOR f IN
    SELECT id, centro_id FROM (
      SELECT id, centro_id, row_number() OVER (PARTITION BY centro_id, datos->>'matricula' ORDER BY creado_en, id) AS rn
        FROM estudiantes WHERE borrado_en IS NULL AND coalesce(datos->>'matricula', '') <> '') d
     WHERE rn > 1 ORDER BY centro_id, id
  LOOP
    SELECT coalesce(max((regexp_match(datos->>'matricula', '(\d+)$'))[1]::bigint), 2000) INTO mx FROM estudiantes WHERE centro_id = f.centro_id;
    n := siguiente_secuencia(f.centro_id, 'matricula_mat', mx);
    UPDATE estudiantes SET datos = datos || jsonb_build_object('matricula', 'MAT-' || regexp_replace(f.centro_id, '\D', '', 'g') || '-' || n::text,
                                                               'matriculaAnterior', datos->>'matricula', 'migracion0010', 'codigo_repetido') WHERE id = f.id;
  END LOOP;
END $$;
ALTER TABLE estudiantes
  ADD COLUMN codigo_matricula text GENERATED ALWAYS AS (nullif(btrim(datos->>'matricula'), '')) STORED;
CREATE UNIQUE INDEX estudiantes_codigo_uidx ON estudiantes (centro_id, codigo_matricula) WHERE borrado_en IS NULL AND codigo_matricula IS NOT NULL;

-- ------------------------------------------------------------------------------------------------ matrículas
WITH d AS (
  SELECT id, row_number() OVER (PARTITION BY centro_id, datos->>'estudianteId', datos->>'anioId'
                                ORDER BY (datos->>'estado' = 'activa') DESC, creado_en DESC, id) AS rn
    FROM matriculas WHERE borrado_en IS NULL AND coalesce(datos->>'estudianteId', '') <> '' AND coalesce(datos->>'anioId', '') <> '')
UPDATE matriculas m SET borrado_en = now(), datos = m.datos || '{"migracion0010":"matricula_duplicada"}'::jsonb FROM d WHERE d.id = m.id AND d.rn > 1;
ALTER TABLE matriculas
  ADD COLUMN estudiante_id text GENERATED ALWAYS AS (datos->>'estudianteId') STORED,
  ADD COLUMN anio_id       text GENERATED ALWAYS AS (datos->>'anioId') STORED,
  ADD COLUMN seccion_id    text GENERATED ALWAYS AS (datos->>'seccionId') STORED,
  ADD COLUMN estado        text GENERATED ALWAYS AS (datos->>'estado') STORED;
CREATE UNIQUE INDEX matriculas_estudiante_anio_uidx ON matriculas (centro_id, estudiante_id, anio_id)
  WHERE borrado_en IS NULL AND estudiante_id IS NOT NULL AND anio_id IS NOT NULL;
CREATE INDEX matriculas_seccion_estado_idx ON matriculas (seccion_id, estado) WHERE borrado_en IS NULL;

-- ------------------------------------------------------------------------------------------------ año activo
WITH d AS (
  SELECT id, row_number() OVER (PARTITION BY centro_id ORDER BY coalesce(datos->>'inicio', '') DESC, creado_en DESC, id) AS rn
    FROM anios WHERE borrado_en IS NULL AND datos->'activo' = 'true'::jsonb)
UPDATE anios a SET datos = a.datos || '{"activo":false,"migracion0010":"anio_activo_repetido"}'::jsonb FROM d WHERE d.id = a.id AND d.rn > 1;
ALTER TABLE anios
  ADD COLUMN activo boolean GENERATED ALWAYS AS (CASE WHEN jsonb_typeof(datos->'activo') = 'boolean' THEN (datos->>'activo')::boolean ELSE false END) STORED;
CREATE UNIQUE INDEX anios_activo_uidx ON anios (centro_id) WHERE activo AND borrado_en IS NULL;

-- ------------------------------------------------------------------------------------------------ escala activa
-- El cliente trata `activa` ausente como activa (escalaDe: activa !== false).
WITH d AS (
  SELECT id, row_number() OVER (PARTITION BY centro_id ORDER BY id) AS rn
    FROM escalas WHERE borrado_en IS NULL AND datos->'activa' IS DISTINCT FROM 'false'::jsonb)
UPDATE escalas s SET datos = s.datos || '{"activa":false,"migracion0010":"escala_activa_repetida"}'::jsonb FROM d WHERE d.id = s.id AND d.rn > 1;
ALTER TABLE escalas
  ADD COLUMN activa boolean GENERATED ALWAYS AS (datos->'activa' IS DISTINCT FROM 'false'::jsonb) STORED;
CREATE UNIQUE INDEX escalas_activa_uidx ON escalas (centro_id) WHERE activa AND borrado_en IS NULL;

-- ------------------------------------------------------------------------------------------------ currículo vigente
WITH d AS (
  SELECT id, row_number() OVER (PARTITION BY centro_id ORDER BY coalesce(datos->>'vigenteDesde', '') DESC, creado_en DESC, id) AS rn
    FROM curriculo_versiones WHERE borrado_en IS NULL AND datos->>'estado' = 'vigente')
UPDATE curriculo_versiones v SET datos = v.datos || '{"estado":"anterior","migracion0010":"vigente_repetida"}'::jsonb FROM d WHERE d.id = v.id AND d.rn > 1;
ALTER TABLE curriculo_versiones
  ADD COLUMN estado text GENERATED ALWAYS AS (datos->>'estado') STORED;
CREATE UNIQUE INDEX curriculo_versiones_vigente_uidx ON curriculo_versiones (centro_id) WHERE estado = 'vigente' AND borrado_en IS NULL;
ALTER TABLE curriculo_contenidos
  ADD COLUMN version_id text GENERATED ALWAYS AS (datos->>'versionId') STORED;
CREATE INDEX curriculo_contenidos_version_idx ON curriculo_contenidos (version_id) WHERE borrado_en IS NULL;

-- ------------------------------------------------------------------------------------------------ secciones
WITH d AS (
  SELECT id, row_number() OVER (PARTITION BY centro_id, datos->>'cursoId', datos->>'anioId', lower(btrim(datos->>'nombre')) ORDER BY creado_en, id) AS rn
    FROM secciones WHERE borrado_en IS NULL AND coalesce(btrim(datos->>'nombre'), '') <> '')
UPDATE secciones s SET datos = s.datos || jsonb_build_object('nombre', btrim(s.datos->>'nombre') || ' (' || d.rn || ')', 'migracion0010', 'seccion_repetida') FROM d WHERE d.id = s.id AND d.rn > 1;
ALTER TABLE secciones
  ADD COLUMN curso_id text GENERATED ALWAYS AS (datos->>'cursoId') STORED,
  ADD COLUMN anio_id  text GENERATED ALWAYS AS (datos->>'anioId') STORED,
  ADD COLUMN nombre_norm text GENERATED ALWAYS AS (nullif(lower(btrim(datos->>'nombre')), '')) STORED;
CREATE UNIQUE INDEX secciones_curso_anio_nombre_uidx ON secciones (centro_id, curso_id, anio_id, nombre_norm) WHERE borrado_en IS NULL AND nombre_norm IS NOT NULL;
CREATE INDEX secciones_curso_idx ON secciones (curso_id) WHERE borrado_en IS NULL;

-- ------------------------------------------------------------------------------------------------ cargas
DO $$
DECLARE
  f record;
  lista text;
BEGIN
  SELECT string_agg(c.id, ', ') INTO lista FROM (
    SELECT id, row_number() OVER (PARTITION BY datos->>'seccionId', datos->>'asignaturaId' ORDER BY creado_en, id) AS rn
      FROM cargas WHERE borrado_en IS NULL AND coalesce(datos->>'seccionId', '') <> '' AND coalesce(datos->>'asignaturaId', '') <> '') c
   WHERE c.rn > 1 AND (EXISTS (SELECT 1 FROM categorias k WHERE k.borrado_en IS NULL AND k.datos->>'cargaId' = c.id)
                       OR EXISTS (SELECT 1 FROM actividades a WHERE a.borrado_en IS NULL AND a.datos->>'cargaId' = c.id));
  IF lista IS NOT NULL THEN
    RAISE EXCEPTION 'Migración 0010: hay cargas repetidas (misma sección y asignatura) con categorías o actividades: %. Fusiónalas o reasígnalas a mano y vuelve a migrar.', lista;
  END IF;
  FOR f IN
    SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY datos->>'seccionId', datos->>'asignaturaId' ORDER BY creado_en, id) AS rn
                      FROM cargas WHERE borrado_en IS NULL AND coalesce(datos->>'seccionId', '') <> '' AND coalesce(datos->>'asignaturaId', '') <> '') d WHERE rn > 1
  LOOP
    UPDATE cargas SET borrado_en = now(), datos = datos || '{"migracion0010":"carga_repetida"}'::jsonb WHERE id = f.id;
  END LOOP;
END $$;
ALTER TABLE cargas
  ADD COLUMN seccion_id    text GENERATED ALWAYS AS (datos->>'seccionId') STORED,
  ADD COLUMN asignatura_id text GENERATED ALWAYS AS (datos->>'asignaturaId') STORED,
  ADD COLUMN docente_id    text GENERATED ALWAYS AS (datos->>'docenteId') STORED;
CREATE UNIQUE INDEX cargas_seccion_asignatura_uidx ON cargas (seccion_id, asignatura_id)
  WHERE borrado_en IS NULL AND seccion_id IS NOT NULL AND asignatura_id IS NOT NULL;
CREATE INDEX cargas_asignatura_idx ON cargas (asignatura_id) WHERE borrado_en IS NULL;

-- ------------------------------------------------------------------------------------------------ inscripciones
WITH d AS (
  SELECT id, row_number() OVER (PARTITION BY datos->>'cursoId', datos->>'estudianteId'
                                ORDER BY CASE datos->>'estado' WHEN 'inscrito' THEN 0 WHEN 'completado' THEN 1 WHEN 'en_lista_espera' THEN 2 ELSE 3 END, creado_en DESC, id) AS rn
    FROM inscripciones WHERE borrado_en IS NULL AND coalesce(datos->>'cursoId', '') <> '' AND coalesce(datos->>'estudianteId', '') <> '')
UPDATE inscripciones i SET borrado_en = now(), datos = i.datos || '{"migracion0010":"inscripcion_duplicada"}'::jsonb FROM d WHERE d.id = i.id AND d.rn > 1;
ALTER TABLE inscripciones
  ADD COLUMN curso_id       text GENERATED ALWAYS AS (datos->>'cursoId') STORED,
  ADD COLUMN estudiante_id  text GENERATED ALWAYS AS (datos->>'estudianteId') STORED,
  ADD COLUMN estado         text GENERATED ALWAYS AS (datos->>'estado') STORED;
CREATE UNIQUE INDEX inscripciones_curso_estudiante_uidx ON inscripciones (curso_id, estudiante_id)
  WHERE borrado_en IS NULL AND curso_id IS NOT NULL AND estudiante_id IS NOT NULL;
CREATE INDEX inscripciones_estudiante_idx ON inscripciones (estudiante_id) WHERE borrado_en IS NULL;

-- ------------------------------------------------------------------------------------------------ periodos: orden único por año
WITH g AS (
  SELECT centro_id, anio_id FROM periodos
   WHERE borrado_en IS NULL AND anio_id IS NOT NULL AND orden IS NOT NULL GROUP BY centro_id, anio_id HAVING count(*) <> count(DISTINCT orden)),
r AS (
  SELECT p.id, p.orden AS antes, row_number() OVER (PARTITION BY p.centro_id, p.anio_id ORDER BY p.orden, p.creado_en, p.id) AS nuevo
    FROM periodos p JOIN g ON g.centro_id = p.centro_id AND g.anio_id = p.anio_id WHERE p.borrado_en IS NULL AND p.orden IS NOT NULL)
UPDATE periodos p SET datos = p.datos || jsonb_build_object('orden', r.nuevo, 'migracion0010', 'orden_renumerado') FROM r WHERE r.id = p.id AND r.antes <> r.nuevo;
CREATE UNIQUE INDEX periodos_anio_orden_uidx ON periodos (centro_id, anio_id, orden)
  WHERE borrado_en IS NULL AND anio_id IS NOT NULL AND orden IS NOT NULL;

-- ------------------------------------------------------------------------------------------------ horarios, franjas
ALTER TABLE horarios
  ADD COLUMN carga_id   text GENERATED ALWAYS AS (datos->>'cargaId') STORED,
  ADD COLUMN franja_id  text GENERATED ALWAYS AS (datos->>'franjaId') STORED;
CREATE INDEX horarios_carga_idx ON horarios (carga_id) WHERE borrado_en IS NULL;
CREATE INDEX horarios_franja_idx ON horarios (franja_id) WHERE borrado_en IS NULL;
