-- 0008 · Columnas «calientes» de las colecciones de notas (Fase 2).
-- El registro sigue guardado en `datos` (jsonb): la API y el formato plano del cliente NO cambian. Estas columnas
-- son GENERADAS (STORED) a partir de `datos`: no se escriben nunca, solo sirven para indexar, para el UNIQUE de
-- negocio y para los CHECK de rango. Los valores no numéricos o fuera de tipo quedan en NULL (no rompen la
-- generación); la validación de tipos y rangos de la API (reglas de notas) los rechaza antes de escribir.
--
-- Sustituye los índices de expresión de 0006 por índices sobre las columnas generadas.

DROP INDEX calificaciones_actividad_idx;
DROP INDEX calificaciones_estudiante_idx;
DROP INDEX actividades_carga_idx;
DROP INDEX categorias_carga_idx;
DROP INDEX notas_competencia_carga_idx;
DROP INDEX notas_competencia_estudiante_idx;
DROP INDEX calificaciones_unica_idx;

-- calificaciones: actividad + estudiante + puntos
ALTER TABLE calificaciones
  ADD COLUMN actividad_id  text    GENERATED ALWAYS AS (datos->>'actividadId') STORED,
  ADD COLUMN estudiante_id text    GENERATED ALWAYS AS (datos->>'estudianteId') STORED,
  ADD COLUMN puntos        numeric GENERATED ALWAYS AS (CASE WHEN jsonb_typeof(datos->'puntos') = 'number' THEN (datos->>'puntos')::numeric END) STORED,
  ADD CONSTRAINT calificaciones_puntos_chk CHECK (puntos IS NULL OR puntos >= 0);
CREATE INDEX calificaciones_actividad_idx  ON calificaciones (actividad_id) WHERE borrado_en IS NULL;
CREATE INDEX calificaciones_estudiante_idx ON calificaciones (estudiante_id) WHERE borrado_en IS NULL;
-- Único de negocio (solo entre vivos): una nota por actividad y estudiante. Sirve también de índice por actividad+estudiante.
CREATE UNIQUE INDEX calificaciones_act_est_uidx ON calificaciones (actividad_id, estudiante_id) WHERE borrado_en IS NULL;

-- actividades: carga, categoría, periodo y puntos máximos
ALTER TABLE actividades
  ADD COLUMN carga_id      text    GENERATED ALWAYS AS (datos->>'cargaId') STORED,
  ADD COLUMN categoria_id  text    GENERATED ALWAYS AS (datos->>'categoriaId') STORED,
  ADD COLUMN periodo_id    text    GENERATED ALWAYS AS (datos->>'periodoId') STORED,
  ADD COLUMN puntos_max    numeric GENERATED ALWAYS AS (CASE WHEN jsonb_typeof(datos->'puntosMax') = 'number' THEN (datos->>'puntosMax')::numeric END) STORED,
  ADD CONSTRAINT actividades_puntos_max_chk CHECK (puntos_max IS NULL OR puntos_max > 0);
CREATE INDEX actividades_carga_periodo_idx ON actividades (carga_id, periodo_id) WHERE borrado_en IS NULL;
CREATE INDEX actividades_categoria_idx     ON actividades (categoria_id) WHERE borrado_en IS NULL;
CREATE INDEX actividades_periodo_idx      ON actividades (periodo_id) WHERE borrado_en IS NULL;

-- categorias: carga y peso (0–100)
ALTER TABLE categorias
  ADD COLUMN carga_id text    GENERATED ALWAYS AS (datos->>'cargaId') STORED,
  ADD COLUMN peso     numeric GENERATED ALWAYS AS (CASE WHEN jsonb_typeof(datos->'peso') = 'number' THEN (datos->>'peso')::numeric END) STORED,
  ADD CONSTRAINT categorias_peso_chk CHECK (peso IS NULL OR (peso >= 0 AND peso <= 100));
CREATE INDEX categorias_carga_idx ON categorias (carga_id) WHERE borrado_en IS NULL;

-- periodos: año, orden, peso (0–100) y estado de cierre
ALTER TABLE periodos
  ADD COLUMN anio_id text    GENERATED ALWAYS AS (datos->>'anioId') STORED,
  ADD COLUMN orden   numeric GENERATED ALWAYS AS (CASE WHEN jsonb_typeof(datos->'orden') = 'number' THEN (datos->>'orden')::numeric END) STORED,
  ADD COLUMN peso    numeric GENERATED ALWAYS AS (CASE WHEN jsonb_typeof(datos->'peso') = 'number' THEN (datos->>'peso')::numeric END) STORED,
  ADD COLUMN cerrado boolean GENERATED ALWAYS AS (CASE WHEN jsonb_typeof(datos->'cerrado') = 'boolean' THEN (datos->>'cerrado')::boolean ELSE false END) STORED,
  ADD CONSTRAINT periodos_peso_chk CHECK (peso IS NULL OR (peso >= 0 AND peso <= 100));
CREATE INDEX periodos_anio_orden_idx ON periodos (centro_id, anio_id, orden) WHERE borrado_en IS NULL;

-- notas_competencia: carga + estudiante (único entre vivos)
ALTER TABLE notas_competencia
  ADD COLUMN carga_id      text GENERATED ALWAYS AS (datos->>'cargaId') STORED,
  ADD COLUMN estudiante_id text GENERATED ALWAYS AS (datos->>'estudianteId') STORED;
CREATE UNIQUE INDEX notas_competencia_carga_est_uidx ON notas_competencia (carga_id, estudiante_id) WHERE borrado_en IS NULL;
CREATE INDEX notas_competencia_estudiante_idx ON notas_competencia (estudiante_id) WHERE borrado_en IS NULL;

-- Las cargas por docente/sección y las matrículas por sección/estudiante siguen con los índices de 0006.
