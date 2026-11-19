-- 0006 · Tablas de las colecciones de la Fase 1 (34 colecciones; `centros` tiene tabla propia, `usuarios` es la
-- tabla de autenticación y `auditoria` se crea en 0007).
-- Diseño: columnas tipadas comunes + el resto del registro en `datos` (jsonb). Las columnas «calientes» se
-- normalizarán en fases posteriores. Los ids actuales se conservan (id text).
--
-- Aislamiento multi-centro (defensa en profundidad, además de la capa de aplicación):
--   * RLS ENABLE + FORCE en todas las tablas con datos de centro.
--   * La política mira `app.centro_id` y `app.rol`, que la API fija con SET LOCAL en cada transacción.
--     admin_red ve todo; el resto solo su centro; SIN contexto = 0 filas (y no se puede insertar).
--   * educentro_app solo tiene SELECT, INSERT y UPDATE (el borrado es lógico: borrado_en); no hay DELETE.

-- Monótono: garantiza que actualizado_en crece al menos 1 ms en cada cambio (control optimista con If-Match).
CREATE FUNCTION tocar_actualizado_en_mono() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := greatest(now(), OLD.actualizado_en + interval '1 millisecond');
  RETURN NEW;
END $$;

DO $$
DECLARE
  t text;
  tablas text[] := ARRAY[
    'anios', 'periodos', 'cursos', 'secciones', 'asignaturas', 'cargas', 'docentes', 'estudiantes', 'tutores',
    'matriculas', 'escalas', 'categorias', 'actividades', 'calificaciones', 'asistencia', 'comunicados', 'planes',
    'horarios', 'agente_config', 'agente_log', 'notas_competencia', 'curriculo_versiones', 'curriculo_contenidos',
    'secuencias', 'franjas', 'disponibilidad', 'cursos_extra', 'inscripciones', 'aula_contenidos', 'tareas',
    'entregas', 'cuestionarios', 'intentos', 'foros', 'foro_mensajes', 'anuncios'];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format($f$
      CREATE TABLE %I (
        id             text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
        centro_id      text NOT NULL REFERENCES centros (id),
        datos          jsonb NOT NULL DEFAULT '{}'::jsonb
                       CHECK (jsonb_typeof(datos) = 'object' AND octet_length(datos::text) <= 262144),
        creado_en      timestamptz NOT NULL DEFAULT now(),
        actualizado_en timestamptz NOT NULL DEFAULT now(),
        borrado_en     timestamptz
      )$f$, t);
    EXECUTE format('CREATE INDEX %I ON %I (centro_id) WHERE borrado_en IS NULL', t || '_centro_idx', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en_mono()',
                   t || '_actualizado', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY aislamiento_centro ON %I
        USING (current_setting('app.rol', true) = 'admin_red' OR centro_id = NULLIF(current_setting('app.centro_id', true), ''))
        WITH CHECK (current_setting('app.rol', true) = 'admin_red' OR centro_id = NULLIF(current_setting('app.centro_id', true), ''))$f$, t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO educentro_app', t);
  END LOOP;
END $$;

-- Índices de las claves por las que se filtra a diario (expresiones sobre `datos`; GIN no se justifica todavía).
CREATE INDEX calificaciones_actividad_idx ON calificaciones ((datos->>'actividadId'));
CREATE INDEX calificaciones_estudiante_idx ON calificaciones ((datos->>'estudianteId'));
CREATE INDEX actividades_carga_idx ON actividades ((datos->>'cargaId'));
CREATE INDEX categorias_carga_idx ON categorias ((datos->>'cargaId'));
CREATE INDEX notas_competencia_carga_idx ON notas_competencia ((datos->>'cargaId'));
CREATE INDEX notas_competencia_estudiante_idx ON notas_competencia ((datos->>'estudianteId'));
CREATE INDEX cargas_docente_idx ON cargas ((datos->>'docenteId'));
CREATE INDEX cargas_seccion_idx ON cargas ((datos->>'seccionId'));
CREATE INDEX matriculas_seccion_idx ON matriculas ((datos->>'seccionId'));
CREATE INDEX matriculas_estudiante_idx ON matriculas ((datos->>'estudianteId'));
CREATE INDEX asistencia_seccion_fecha_idx ON asistencia ((datos->>'seccionId'), (datos->>'fecha'));
CREATE INDEX asistencia_estudiante_idx ON asistencia ((datos->>'estudianteId'));

-- Únicos de negocio (solo entre registros vivos): una nota por actividad y estudiante; una asistencia por
-- sección, estudiante y fecha.
CREATE UNIQUE INDEX calificaciones_unica_idx ON calificaciones ((datos->>'actividadId'), (datos->>'estudianteId'))
  WHERE borrado_en IS NULL;
CREATE UNIQUE INDEX asistencia_unica_idx ON asistencia ((datos->>'seccionId'), (datos->>'estudianteId'), (datos->>'fecha'))
  WHERE borrado_en IS NULL;
