// Operaciones de notas del servidor: lotes transaccionales, resumen (con el cálculo compartido del cliente),
// informe/cierre/reapertura de periodos y reemplazo atómico de categorías.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { aRespuesta, ErrorHttp } from '../errores.js';
import { calculo, normalizar } from '../domain/calculo-shim.js';
import { condicionAlcance } from '../domain/alcance.js';
import type { Registro } from '../domain/autorizacion.js';
import { metaDe } from '../domain/colecciones.js';
import { registrarAuditoria } from './auditoria.js';
import { borrar, centroDePeticion, guardar, MAX_LOTE, obtener, type Peticion, validarCuerpo } from './generico.js';
import { ROLES_EDITAN_CERRADO, validarMotivo } from './reglas-notas.js';

type Json = Record<string, unknown>;
const meta = (n: string) => metaDe(n) as NonNullable<ReturnType<typeof metaDe>>;
const str = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null);

// ------------------------------------------------------------------------------------------------ lotes por fila
export interface FilaRechazada {
  indice: number;
  id: string | null;
  codigo: string;
  mensaje: string;
  campos?: string[];
}
export interface ResultadoLote {
  atomico: boolean;
  total: number;
  aplicadas: { indice: number; id: string; registro: Registro }[];
  rechazadas: FilaRechazada[];
}

const esquemaLote = z.object({ registros: z.array(z.unknown()).min(1).max(MAX_LOTE), atomico: z.boolean().optional() });

/**
 * Lote con validación por fila y resultado por fila. Cada fila pasa por el MISMO camino que una escritura suelta
 * (autorización, propiedad, periodo cerrado, rangos, auditoría) dentro de un SAVEPOINT: la fila inválida se
 * rechaza con su código y las demás se aplican. Con `atomico:true`, una sola fila inválida deshace TODO el lote
 * (422 `lote_invalido` con la lista de filas rechazadas). Los errores internos (5xx) abortan siempre.
 */
async function loteGenerico(
  p: Peticion,
  nombre: 'calificaciones' | 'notasCompetencia',
  cuerpoBruto: unknown,
  clave: (r: Registro) => { llave: string; idPorDefecto: string; buscar: [string, string] } | null,
): Promise<ResultadoLote> {
  const { registros, atomico } = esquemaLote.parse(cuerpoBruto);
  const m = meta(nombre);
  const tabla = m.tabla;
  const [colA, colB] = nombre === 'calificaciones' ? ['actividad_id', 'estudiante_id'] : ['carga_id', 'estudiante_id'];
  const aplicadas: ResultadoLote['aplicadas'] = [];
  const rechazadas: FilaRechazada[] = [];
  const vistas = new Set<string>();
  for (const [indice, bruto] of registros.entries()) {
    let id: string | null = null;
    try {
      await p.tx.parcial(async () => {
        const cuerpo = { ...validarCuerpo(bruto) };
        const k = clave(cuerpo);
        if (!k) throw new ErrorHttp(422, 'datos_invalidos', 'Faltan los identificadores de la fila.', nombre === 'calificaciones' ? ['actividadId', 'estudianteId'] : ['cargaId', 'estudianteId']);
        if (vistas.has(k.llave)) throw new ErrorHttp(409, 'duplicado_en_lote', 'La misma celda aparece más de una vez en el lote.');
        vistas.add(k.llave);
        // La celda (actividad+estudiante / carga+estudiante) es única: se actualiza el registro vivo que ya la ocupa.
        const ex = await p.tx.query<{ id: string }>(`SELECT id FROM ${tabla} WHERE ${colA} = $1 AND ${colB} = $2 AND borrado_en IS NULL`, k.buscar);
        const existente = ex.rows[0]?.id ?? null;
        const pedido = typeof cuerpo.id === 'string' ? cuerpo.id : null;
        if (pedido && existente && pedido !== existente) throw new ErrorHttp(409, 'conflicto', 'Ya existe una nota para esa celda con otro identificador.');
        id = existente ?? pedido ?? k.idPorDefecto;
        const r = await guardar(p, m, { ...cuerpo, id }, { modo: 'upsert' });
        aplicadas.push({ indice, id, registro: r.registro });
      });
    } catch (e) {
      const { status, cuerpo } = aRespuesta(e);
      if (status >= 500) throw e;
      rechazadas.push({ indice, id, codigo: cuerpo.error.codigo, mensaje: cuerpo.error.mensaje, ...(cuerpo.error.campos ? { campos: cuerpo.error.campos } : {}) });
    }
  }
  if (atomico && rechazadas.length) {
    throw new ErrorHttp(422, 'lote_invalido', `El lote no se aplicó: ${rechazadas.length} fila(s) inválida(s) de ${registros.length}.`, undefined, { rechazadas, aplicadas: 0, total: registros.length });
  }
  return { atomico: !!atomico, total: registros.length, aplicadas, rechazadas };
}

export function loteCalificaciones(p: Peticion, cuerpo: unknown): Promise<ResultadoLote> {
  return loteGenerico(p, 'calificaciones', cuerpo, (r) => {
    const a = str(r.actividadId);
    const e = str(r.estudianteId);
    return a && e ? { llave: `${a}|${e}`, idPorDefecto: `cal_${a}_${e}`, buscar: [a, e] } : null;
  });
}
export function loteNotasCompetencia(p: Peticion, cuerpo: unknown): Promise<ResultadoLote> {
  return loteGenerico(p, 'notasCompetencia', cuerpo, (r) => {
    const c = str(r.cargaId);
    const e = str(r.estudianteId);
    return c && e ? { llave: `${c}|${e}`, idPorDefecto: `nc_${c}_${e}`, buscar: [c, e] } : null;
  });
}

// ------------------------------------------------------------------------------------------------ categorías
const esquemaCategorias = z.object({
  cargaId: z.string().min(1).max(100),
  categorias: z.array(z.record(z.string(), z.unknown())).min(1).max(30),
});

/** Reemplazo transaccional del conjunto de categorías de una carga: los pesos deben sumar 100 (si no, 422 `pesos_invalidos`). */
export async function loteCategorias(p: Peticion, cuerpoBruto: unknown): Promise<{ datos: Registro[]; suma: number }> {
  const { cargaId, categorias } = esquemaCategorias.parse(cuerpoBruto);
  const calc = calculo();
  const carga = await p.carga(cargaId);
  if (!carga) throw new ErrorHttp(404, 'no_encontrado', 'La carga docente no existe.');
  centroDePeticion(p.ses, carga.centroId); // no admin_red: debe ser su centro
  if (p.ses.rol === 'docente' && !(await p.alcance())?.cargaIds.includes(cargaId)) throw new ErrorHttp(403, 'sin_permiso', 'Sin permiso: la carga docente no es tuya.');
  const nombres = new Set<string>();
  for (const [i, c] of categorias.entries()) {
    const nombre = typeof c.nombre === 'string' ? c.nombre.trim() : '';
    if (!nombre || nombre.length > 80) throw new ErrorHttp(422, 'datos_invalidos', `Categoría ${i + 1}: el nombre es obligatorio (hasta 80 caracteres).`, ['nombre']);
    if (nombres.has(nombre.toLowerCase())) throw new ErrorHttp(422, 'datos_invalidos', `El nombre «${nombre}» está repetido.`, ['nombre']);
    nombres.add(nombre.toLowerCase());
    if (typeof c.peso !== 'number' || !Number.isFinite(c.peso) || c.peso < 0 || c.peso > 100) {
      throw new ErrorHttp(422, 'datos_invalidos', `Categoría «${nombre}»: el peso debe ser un número entre 0 y 100.`, ['peso']);
    }
  }
  const v = calc.validarPesos(categorias.map((c) => ({ peso: c.peso })), 100);
  if (!v.ok) {
    throw new ErrorHttp(422, 'pesos_invalidos', `Los pesos de las categorías suman ${v.suma} %; deben sumar exactamente 100 %.`, ['peso'], { suma: v.suma, diferencia: v.diferencia });
  }
  const existentes = (await p.tx.query<{ id: string }>('SELECT id FROM categorias WHERE carga_id = $1 AND borrado_en IS NULL ORDER BY id', [cargaId])).rows.map((r) => r.id);
  const enviados = categorias.map((c) => str(c.id)).filter((x): x is string => !!x);
  if (new Set(enviados).size !== enviados.length) throw new ErrorHttp(422, 'datos_invalidos', 'Hay categorías con el mismo id.', ['id']);
  const ajenas = enviados.filter((id) => !existentes.includes(id));
  if (ajenas.length) throw new ErrorHttp(422, 'referencia_invalida', 'Hay categorías que no pertenecen a esta carga.', ['id']);
  const quitar = existentes.filter((id) => !enviados.includes(id));
  for (const id of quitar) {
    const n = (await p.tx.query<{ n: number }>('SELECT count(*)::int AS n FROM actividades WHERE categoria_id = $1 AND borrado_en IS NULL', [id])).rows[0]?.n ?? 0;
    if (n > 0) throw new ErrorHttp(422, 'categoria_con_actividades', 'Una categoría con actividades no se puede quitar: muévelas o elimínalas primero.', ['id']);
  }
  const m = meta('categorias');
  const datos: Registro[] = [];
  for (const c of categorias) {
    const cuerpo = { ...c, cargaId, centroId: carga.centroId, nombre: (c.nombre as string).trim() };
    const id = str(c.id) ?? `cat_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    datos.push((await guardar(p, m, { ...cuerpo, id }, { modo: 'upsert' })).registro);
  }
  for (const id of quitar) await borrar(p, m, id);
  return { datos, suma: v.suma };
}

// ------------------------------------------------------------------------------------------------ cierre de periodos
interface PeriodoCompleto {
  id: string;
  centroId: string;
  anioId: string | null;
  nombre: string;
  cerrado: boolean;
  datos: Json;
}

async function cargarPeriodo(p: Peticion, id: string, bloquear: boolean): Promise<PeriodoCompleto> {
  const r = await p.tx.query<{ id: string; centro_id: string; anio_id: string | null; cerrado: boolean; datos: Json }>(
    `SELECT id, centro_id, anio_id, cerrado, datos FROM periodos WHERE id = $1 AND borrado_en IS NULL ${bloquear ? 'FOR UPDATE' : ''}`,
    [id],
  );
  const f = r.rows[0];
  if (!f) throw new ErrorHttp(404, 'no_encontrado', 'Periodo no encontrado.');
  return { id: f.id, centroId: f.centro_id, anioId: f.anio_id, nombre: str(f.datos.nombre) ?? f.id, cerrado: f.cerrado, datos: f.datos };
}

export interface InformeCierre {
  periodoId: string;
  nombre: string;
  centroId: string;
  anioId: string | null;
  cerrado: boolean;
  modelo: 'ponderado' | 'competencias';
  /** Notas pendientes (actividad × estudiante sin nota; o celdas P_i sin nota por competencias). */
  pendientes: number;
  cargasSinActividades: number;
  pesosPeriodos: { suma: number; ok: boolean };
  cargas: {
    cargaId: string;
    seccionId: string | null;
    asignaturaId: string | null;
    docenteId: string | null;
    actividades: number;
    estudiantes: number;
    pendientes: number;
    sinActividades: boolean;
    pesosCategorias: { n: number; suma: number; ok: boolean };
  }[];
  /** Impiden cerrar (pesos ≠ 100). */
  bloqueos: { codigo: string; mensaje: string; cargaId?: string }[];
  /** Hay pendientes o cargas sin actividades: se exige `confirmar:true`. */
  requiereConfirmacion: boolean;
}

export async function informeCierre(p: Peticion, periodoId: string, bloquear = false): Promise<InformeCierre> {
  const calc = calculo();
  const per = await cargarPeriodo(p, periodoId, bloquear);
  const escala = await p.escala(per.centroId);
  const modelo = calc.modelo(escala);
  const periodosAnio = per.anioId ? await p.periodosDelAnio(per.centroId, per.anioId) : [];
  const indice = periodosAnio.findIndex((x) => x.id === per.id);
  const sumaPer = (await p.tx.query<{ pesos: unknown }>(`SELECT coalesce(jsonb_agg(datos->'peso'), '[]'::jsonb) AS pesos FROM periodos WHERE centro_id = $1 AND anio_id IS NOT DISTINCT FROM $2 AND borrado_en IS NULL`, [per.centroId, per.anioId])).rows[0]?.pesos as unknown[];
  const pesosPeriodos = calc.validarPesos(sumaPer ?? [], 100);

  const cargas = (await p.tx.query<{ id: string; datos: Json }>(`SELECT id, datos FROM cargas WHERE centro_id = $1 AND datos->>'anioId' IS NOT DISTINCT FROM $2 AND borrado_en IS NULL ORDER BY id`, [per.centroId, per.anioId])).rows;
  const mats = (await p.tx.query<{ sec: string | null; est: string | null }>(`SELECT datos->>'seccionId' AS sec, datos->>'estudianteId' AS est FROM matriculas WHERE centro_id = $1 AND datos->>'estado' = 'activa' AND borrado_en IS NULL`, [per.centroId])).rows;
  const porSeccion = new Map<string, string[]>();
  for (const m of mats) if (m.sec && m.est) porSeccion.set(m.sec, [...(porSeccion.get(m.sec) ?? []), m.est]);
  const cargaIds = cargas.map((c) => c.id);

  const acts = (await p.tx.query<{ id: string; carga: string }>(`SELECT id, carga_id AS carga FROM actividades WHERE carga_id = ANY($1::text[]) AND periodo_id = $2 AND borrado_en IS NULL`, [cargaIds, per.id])).rows;
  const notas = new Set((await p.tx.query<{ k: string }>(`SELECT actividad_id || '|' || estudiante_id AS k FROM calificaciones WHERE puntos IS NOT NULL AND borrado_en IS NULL AND actividad_id = ANY($1::text[])`, [acts.map((a) => a.id)])).rows.map((r) => r.k));
  const cats = (await p.tx.query<{ carga: string; peso: unknown }>(`SELECT carga_id AS carga, datos->'peso' AS peso FROM categorias WHERE carga_id = ANY($1::text[]) AND borrado_en IS NULL`, [cargaIds])).rows;
  const ncs = new Map((await p.tx.query<{ carga: string; est: string; c: unknown }>(`SELECT carga_id AS carga, estudiante_id AS est, datos->'c' AS c FROM notas_competencia WHERE carga_id = ANY($1::text[]) AND borrado_en IS NULL`, [cargaIds])).rows.map((r) => [`${r.carga}|${r.est}`, r.c]));
  const nComp = Number(calc.configCompetencias(escala).competencias);

  const filas: InformeCierre['cargas'] = [];
  const bloqueos: InformeCierre['bloqueos'] = [];
  let pendientes = 0;
  let sinAct = 0;
  if (!pesosPeriodos.ok) {
    bloqueos.push({ codigo: 'pesos_periodos', mensaje: `Los pesos de los periodos del año suman ${pesosPeriodos.suma} %; deben sumar 100 %.` });
  }
  for (const cg of cargas) {
    const sec = str(cg.datos.seccionId);
    const ests = sec ? (porSeccion.get(sec) ?? []) : [];
    const misActs = acts.filter((a) => a.carga === cg.id);
    const misCats = cats.filter((c) => c.carga === cg.id).map((c) => ({ peso: c.peso }));
    const pc = calc.validarPesos(misCats, 100);
    let pend = 0;
    if (modelo === 'competencias') {
      for (const e of ests) {
        const c = ncs.get(`${cg.id}|${e}`) as { p?: unknown[] }[] | undefined;
        for (let j = 0; j < nComp; j++) if (indice < 0 || typeof c?.[j]?.p?.[indice] !== 'number') pend++;
      }
    } else {
      for (const a of misActs) for (const e of ests) if (!notas.has(`${a.id}|${e}`)) pend++;
    }
    const sinActividades = modelo === 'ponderado' && misActs.length === 0;
    if (sinActividades) sinAct++;
    pendientes += pend;
    // Pesos de categorías: solo importan en el modelo ponderado y si la carga las usa (categorías o actividades del periodo).
    if (modelo === 'ponderado' && (misCats.length > 0 || misActs.length > 0) && !pc.ok) {
      bloqueos.push({
        codigo: 'pesos_categorias',
        cargaId: cg.id,
        mensaje: misCats.length ? `Una asignatura tiene pesos de categorías que suman ${pc.suma} % (deben sumar 100 %).` : 'Una asignatura tiene actividades pero no categorías.',
      });
    }
    filas.push({
      cargaId: cg.id, seccionId: sec, asignaturaId: str(cg.datos.asignaturaId), docenteId: str(cg.datos.docenteId),
      actividades: misActs.length, estudiantes: ests.length, pendientes: pend, sinActividades,
      pesosCategorias: { n: misCats.length, suma: pc.suma, ok: pc.ok },
    });
  }
  return {
    periodoId: per.id, nombre: per.nombre, centroId: per.centroId, anioId: per.anioId, cerrado: per.cerrado, modelo,
    pendientes, cargasSinActividades: sinAct, pesosPeriodos: { suma: pesosPeriodos.suma, ok: pesosPeriodos.ok },
    cargas: filas, bloqueos, requiereConfirmacion: pendientes > 0 || sinAct > 0,
  };
}

function exigirRolCierre(p: Peticion): void {
  if (!ROLES_EDITAN_CERRADO.includes(p.ses.rol)) throw new ErrorHttp(403, 'sin_permiso', 'Solo el director puede cerrar y reabrir periodos.');
}

export async function cerrarPeriodo(p: Peticion, periodoId: string, cuerpoBruto: unknown): Promise<{ periodo: Registro | null; informe: InformeCierre }> {
  exigirRolCierre(p);
  const { confirmar } = z.object({ confirmar: z.boolean().optional() }).strict().parse(cuerpoBruto ?? {});
  const informe = await informeCierre(p, periodoId, true);
  if (informe.cerrado) throw new ErrorHttp(409, 'periodo_ya_cerrado', `El periodo «${informe.nombre}» ya está cerrado.`);
  if (informe.bloqueos.length) {
    throw new ErrorHttp(422, 'pesos_invalidos', `No se puede cerrar «${informe.nombre}»: ${informe.bloqueos.length} problema(s) con los pesos. Corrígelos y vuelve a intentar.`, undefined, { informe });
  }
  if (informe.requiereConfirmacion && !confirmar) {
    throw new ErrorHttp(409, 'confirmacion_requerida', `El periodo «${informe.nombre}» tiene ${informe.pendientes} nota(s) pendiente(s) o asignaturas sin actividades: confirma para cerrarlo igualmente.`, undefined, { informe });
  }
  const antes = await obtener(p, meta('periodos'), periodoId);
  const ahora = new Date().toISOString();
  await p.tx.query(`UPDATE periodos SET datos = datos || $2::jsonb WHERE id = $1`, [
    periodoId,
    JSON.stringify({ cerrado: true, cerradoEn: ahora, cerradoPor: p.ses.usuarioId, cerradoPendientes: informe.pendientes }),
  ]);
  p.invalidarCache();
  const periodo = await obtener(p, meta('periodos'), periodoId);
  await registrarAuditoria(p.tx, p.ses, informe.centroId, {
    accion: 'cerrar_periodo', coleccion: 'periodos', registroId: periodoId,
    antes: { cerrado: false }, despues: { cerrado: true },
    extra: { pendientes: informe.pendientes, confirmado: !!confirmar, cargasSinActividades: informe.cargasSinActividades, periodoAntes: antes ? { actualizadoEn: antes.actualizadoEn } : null },
  });
  return { periodo, informe };
}

export async function reabrirPeriodo(p: Peticion, periodoId: string, cuerpoBruto: unknown): Promise<Registro | null> {
  exigirRolCierre(p);
  const b = z.object({ motivo: z.unknown().optional() }).strict().parse(cuerpoBruto ?? {});
  const motivo = p.motivo ?? validarMotivo(b.motivo, 'motivo');
  const per = await cargarPeriodo(p, periodoId, true);
  if (!per.cerrado) throw new ErrorHttp(409, 'periodo_no_cerrado', `El periodo «${per.nombre}» no está cerrado.`);
  const ahora = new Date().toISOString();
  await p.tx.query(`UPDATE periodos SET datos = (datos - 'cerradoEn' - 'cerradoPor' - 'cerradoPendientes') || $2::jsonb WHERE id = $1`, [
    periodoId,
    JSON.stringify({ cerrado: false, reabiertoEn: ahora, reabiertoPor: p.ses.usuarioId, reabiertoMotivo: motivo }),
  ]);
  p.invalidarCache();
  await registrarAuditoria(p.tx, p.ses, per.centroId, {
    accion: 'reabrir_periodo', coleccion: 'periodos', registroId: periodoId,
    antes: { cerrado: true }, despues: { cerrado: false }, extra: { motivo },
  });
  return obtener(p, meta('periodos'), periodoId);
}

// ------------------------------------------------------------------------------------------------ resumen
const iso = (c: string): string => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
export const esquemaResumen = z.strictObject({
  seccionId: z.string().min(1).max(100).optional(),
  cargaId: z.string().min(1).max(100).optional(),
  estudianteId: z.string().min(1).max(100).optional(),
  periodoId: z.string().min(1).max(100).optional(),
  centroId: z.string().min(1).max(100).optional(),
});
const MAX_MATRICULAS_RESUMEN = 5000;

/**
 * GET /notas/resumen: lo mismo que EDU.consultas.resumenNotas del cliente, calculado con el MISMO código
 * (calculo-shim) sobre los datos que el usuario puede ver (centro + alcance: docente sus cargas, tutor sus hijos,
 * estudiante él mismo). Cada fila es idéntica a la del cliente; con `periodoId` se añade `notaPeriodo`.
 */
export async function resumenNotas(p: Peticion, consulta: unknown): Promise<{ datos: Json[]; total: number; periodoId: string | null }> {
  const q = esquemaResumen.parse(consulta);
  const calc = calculo();
  const centro = centroDePeticion(p.ses, q.centroId ?? null);
  if (!centro) throw new ErrorHttp(422, 'datos_invalidos', 'centroId es obligatorio (elige un centro).', ['centroId']);
  const alc = await p.alcance();

  const cargar = async (nombre: string, extra: (params: unknown[]) => string[]): Promise<Json[]> => {
    const m = meta(nombre);
    const params: unknown[] = [centro];
    const where = ['centro_id = $1', 'borrado_en IS NULL', ...extra(params)];
    const cond = condicionAlcance(nombre, p.ses, alc, params);
    if (cond) where.push(cond);
    const r = await p.tx.query<{ id: string; centro_id: string; datos: Json; creado_en: string; actualizado_en: string }>(
      `SELECT id, centro_id, datos, ${iso('creado_en')} AS creado_en, ${iso('actualizado_en')} AS actualizado_en FROM ${m.tabla} WHERE ${where.join(' AND ')} ORDER BY id`,
      params,
    );
    // mismo registro plano que devuelve /c/:col (el cliente calcula sobre eso)
    return r.rows.map((f) => ({ ...f.datos, id: f.id, centroId: f.centro_id, creadoEn: f.creado_en, actualizadoEn: f.actualizado_en }));
  };
  const matriculas = await cargar('matriculas', (pr) => {
    const w = [`datos->>'estado' = 'activa'`];
    if (q.seccionId) { pr.push(q.seccionId); w.push(`datos->>'seccionId' = $${pr.length}`); }
    if (q.estudianteId) { pr.push(q.estudianteId); w.push(`datos->>'estudianteId' = $${pr.length}`); }
    return w;
  });
  if (matriculas.length > MAX_MATRICULAS_RESUMEN) {
    throw new ErrorHttp(422, 'demasiados_registros', 'Demasiadas matrículas para un solo resumen: filtra por sección, asignatura o estudiante.');
  }
  const secciones = [...new Set(matriculas.map((m) => m.seccionId as string))];
  const estudiantes = [...new Set(matriculas.map((m) => m.estudianteId as string))];
  const cargas = await cargar('cargas', (pr) => {
    pr.push(secciones);
    const w = [`datos->>'seccionId' = ANY($${pr.length}::text[])`];
    if (q.cargaId) { pr.push(q.cargaId); w.push(`id = $${pr.length}`); }
    return w;
  });
  const cargaIds = cargas.map((c) => c.id as string);
  const categorias = await cargar('categorias', (pr) => { pr.push(cargaIds); return [`carga_id = ANY($${pr.length}::text[])`]; });
  const actividades = await cargar('actividades', (pr) => { pr.push(cargaIds); return [`carga_id = ANY($${pr.length}::text[])`]; });
  const actIds = actividades.map((a) => a.id as string);
  const calificaciones = await cargar('calificaciones', (pr) => { pr.push(actIds, estudiantes); return [`actividad_id = ANY($${pr.length - 1}::text[])`, `estudiante_id = ANY($${pr.length}::text[])`]; });
  const notasCompetencia = await cargar('notasCompetencia', (pr) => { pr.push(cargaIds, estudiantes); return [`carga_id = ANY($${pr.length - 1}::text[])`, `estudiante_id = ANY($${pr.length}::text[])`]; });
  const periodos = await cargar('periodos', () => []);
  const escalas = await cargar('escalas', () => []);
  if (q.periodoId && !periodos.some((x) => x.id === q.periodoId)) throw new ErrorHttp(404, 'no_encontrado', 'Periodo no encontrado.');

  const filas = normalizar<Json[]>(calc.resumenNotas({ matriculas, cargas, categorias, actividades, calificaciones, notasCompetencia, periodos, escalas }));
  if (q.periodoId) {
    for (const f of filas) {
      const x = (f.periodos as { periodoId: string; nota: number | null }[]).find((y) => y.periodoId === q.periodoId);
      f.notaPeriodo = x?.nota ?? null;
    }
  }
  return { datos: filas, total: filas.length, periodoId: q.periodoId ?? null };
}
