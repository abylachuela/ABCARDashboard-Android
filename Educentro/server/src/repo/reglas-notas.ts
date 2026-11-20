// Reglas de negocio de las notas, ejecutadas EN EL SERVIDOR antes de escribir (hooks de la capa genérica):
// el cliente que usa /c/:col sigue funcionando y no puede esquivarlas.
//   a) periodo cerrado: el docente (y cualquier rol sin cierre) no escribe; el director y admin_red solo con motivo
//      (cabecera X-EDU-Motivo, 5–300 caracteres) y queda auditado con motivo;
//   b) rangos y tipos: puntos 0..puntosMax, notas de competencia dentro de la escala, fases válidas; los campos
//      calculados (final, estado…) que mande el cliente se IGNORAN: el servidor recalcula al leer (/notas/resumen);
//   d) carga de la actividad/categoría en el centro de la sesión;
//   e) `periodos.cerrado` solo cambia con POST /periodos/:id/{cerrar,reabrir}.
// El periodo de cada registro se resuelve CON CONSULTAS (actividad → periodo; carga → año → periodos), nunca por
// lo que diga el cliente sobre si el periodo está cerrado.
import { ErrorHttp } from '../errores.js';
import { calculo } from '../domain/calculo-shim.js';
import type { Registro } from '../domain/autorizacion.js';
import type { MetaColeccion } from '../domain/colecciones.js';
import type { Peticion } from './generico.js';

export const MOTIVO_MIN = 5;
export const MOTIVO_MAX = 300;
/** Roles que pueden editar un periodo cerrado (siempre con motivo) y cerrar/reabrir periodos. */
export const ROLES_EDITAN_CERRADO: readonly string[] = ['director', 'admin_red'];
const EPS = 1e-9;
const MAX_DECIMALES = 6;

/** Campos calculados: el servidor los ignora siempre (se recalculan al leer). */
const CALCULADOS = ['final', 'cf', 'cfc', 'cexf', 'ce', 'nota', 'notaFinal', 'promedio', 'promedios', 'pct', 'aprobado', 'estado', 'via', 'calc', 'resultado', 'completo', 'periodos', 'efectivos', 'usuarioId', 'rol'];
/** Campos de cierre del periodo: solo los fijan cerrar/reabrir. */
const CAMPOS_CIERRE = ['cerrado', 'cerradoEn', 'cerradoPor', 'cerradoPendientes', 'reabiertoEn', 'reabiertoPor', 'reabiertoMotivo'];

export interface EntradaRegla {
  p: Peticion;
  meta: MetaColeccion;
  accion: 'crear' | 'editar' | 'borrar';
  centro: string;
  id: string;
  /** Estado anterior (plano) o null al crear. */
  antes: Registro | null;
  /** Campos nuevos (sin id/centroId). MUTABLE: las reglas ignoran o conservan campos. null al borrar. */
  nuevo: Registro | null;
}
export interface ResultadoRegla {
  /** Se añade a `extra` de la entrada de auditoría (motivo, periodo…). */
  auditoria?: Record<string, unknown>;
}

const COLECCIONES_CON_REGLAS = new Set(['calificaciones', 'actividades', 'categorias', 'notasCompetencia', 'periodos']);
export const tieneReglas = (nombre: string): boolean => COLECCIONES_CON_REGLAS.has(nombre);

const str = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null);
const invalido = (mensaje: string, campo: string, codigo = 'datos_invalidos'): ErrorHttp => new ErrorHttp(422, codigo, mensaje, [campo]);

function esNumeroFinito(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
function decimales(n: number): number {
  const s = String(n);
  if (s.includes('e')) return Math.max(0, MAX_DECIMALES + 1); // notación exponencial: muy pequeño o muy grande
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/** null/undefined → null; número finito con ≤ 6 decimales dentro de [min, max]; si no, 422. */
function nota(valor: unknown, min: number, max: number, campo: string, etiqueta: string): number | null {
  if (valor === null || valor === undefined) return null;
  if (!esNumeroFinito(valor)) throw invalido(`${etiqueta} debe ser un número (o vacío).`, campo);
  if (decimales(valor) > MAX_DECIMALES) throw invalido(`${etiqueta} admite como máximo ${MAX_DECIMALES} decimales.`, campo);
  if (valor < min - EPS || valor > max + EPS) throw invalido(`${etiqueta} debe estar entre ${min} y ${max}.`, campo, 'fuera_de_rango');
  return valor;
}

function quitarCalculados(nuevo: Registro): void {
  for (const k of CALCULADOS) delete nuevo[k];
}

// ------------------------------------------------------------------------------------------------ periodo cerrado
export interface PeriodoFila {
  id: string;
  centroId: string;
  nombre: string;
  cerrado: boolean;
  anioId: string | null;
  orden: number | null;
}

/**
 * ¿Se puede escribir en este periodo? Abierto: sí. Cerrado: docente/secretaría/etc. → 409 `periodo_cerrado`;
 * director y admin_red → solo con motivo (422 `motivo_requerido` si falta) y se devuelve el extra de auditoría.
 */
export function exigirPeriodoAbierto(p: Peticion, per: PeriodoFila, que: string): Record<string, unknown> | null {
  if (!per.cerrado) return null;
  if (!ROLES_EDITAN_CERRADO.includes(p.ses.rol)) {
    throw new ErrorHttp(409, 'periodo_cerrado', `El periodo «${per.nombre}» está cerrado: no se pueden modificar ${que}. Pide al director que lo reabra.`);
  }
  if (!p.motivo) {
    throw new ErrorHttp(
      422,
      'motivo_requerido',
      `El periodo «${per.nombre}» está cerrado: para editar ${que} indica el motivo (cabecera X-EDU-Motivo, ${MOTIVO_MIN} a ${MOTIVO_MAX} caracteres).`,
      ['X-EDU-Motivo'],
    );
  }
  return { motivo: p.motivo, periodoId: per.id, periodoCerrado: true };
}

const unir = (a: Record<string, unknown> | null, b: Record<string, unknown> | null): Record<string, unknown> | null => (a && b ? { ...a, ...b } : (a ?? b));

// ------------------------------------------------------------------------------------------------ calificaciones
async function reglaCalificaciones(e: EntradaRegla): Promise<ResultadoRegla> {
  const { p } = e;
  let aud: Record<string, unknown> | null = null;
  const versiones: string[] = []; // actividades afectadas (antes y después)

  if (e.accion !== 'borrar') {
    const n = e.nuevo as Registro;
    quitarCalculados(n);
    const act = str(n.actividadId);
    const est = str(n.estudianteId);
    if (!act) throw invalido('actividadId es obligatorio.', 'actividadId');
    if (!est) throw invalido('estudianteId es obligatorio.', 'estudianteId');
    if (e.antes && (e.antes.actividadId !== act || e.antes.estudianteId !== est)) {
      throw invalido('actividadId y estudianteId de una calificación no se pueden cambiar.', 'actividadId', 'campo_inmutable');
    }
    const a = await p.actividad(act);
    if (!a) throw new ErrorHttp(422, 'actividad_no_encontrada', 'La actividad no existe.', ['actividadId']);
    if (a.centroId !== e.centro) throw new ErrorHttp(422, 'referencia_invalida', 'La actividad no pertenece al centro.', ['actividadId']);
    // puntos: null = sin nota; si no, 0..puntosMax de la actividad
    const max = a.puntosMax !== null && a.puntosMax > 0 ? a.puntosMax : Infinity;
    n.puntos = nota(n.puntos, 0, max, 'puntos', 'Los puntos');
    if (n.comentario !== undefined && n.comentario !== null && (typeof n.comentario !== 'string' || n.comentario.length > 1000)) {
      throw invalido('El comentario debe ser texto de hasta 1000 caracteres.', 'comentario');
    }
    versiones.push(act);
  }
  const actAntes = e.antes ? str(e.antes.actividadId) : null;
  if (actAntes && !versiones.includes(actAntes)) versiones.push(actAntes);
  for (const act of versiones) {
    const a = await p.actividad(act);
    const per = a?.periodoId ? await p.periodo(a.periodoId) : null;
    if (per) aud = unir(aud, exigirPeriodoAbierto(p, per, 'calificaciones'));
  }
  return aud ? { auditoria: aud } : {};
}

// ------------------------------------------------------------------------------------------------ actividades
async function reglaActividades(e: EntradaRegla): Promise<ResultadoRegla> {
  const { p } = e;
  let aud: Record<string, unknown> | null = null;
  const periodos = new Set<string>();
  if (e.accion !== 'borrar') {
    const n = e.nuevo as Registro;
    quitarCalculados(n);
    const carga = str(n.cargaId);
    if (carga) {
      const c = await p.carga(carga);
      if (!c || c.centroId !== e.centro) throw new ErrorHttp(422, 'referencia_invalida', 'La carga docente no pertenece al centro.', ['cargaId']);
      if (e.antes && e.antes.cargaId !== undefined && e.antes.cargaId !== carga) throw invalido('La carga de una actividad no se puede cambiar.', 'cargaId', 'campo_inmutable');
      const cat = str(n.categoriaId);
      if (cat) {
        const k = await p.categoria(cat);
        if (!k || k.cargaId !== carga) throw new ErrorHttp(422, 'referencia_invalida', 'La categoría no existe o es de otra carga.', ['categoriaId']);
      }
      const pid = str(n.periodoId);
      if (pid) {
        const per = await p.periodo(pid);
        if (!per || per.centroId !== e.centro) throw new ErrorHttp(422, 'referencia_invalida', 'El periodo no existe en el centro.', ['periodoId']);
        if (per.anioId && c.anioId && per.anioId !== c.anioId) throw new ErrorHttp(422, 'referencia_invalida', 'El periodo es de otro año escolar.', ['periodoId']);
      }
    }
    if (n.puntosMax !== undefined && n.puntosMax !== null) {
      if (!esNumeroFinito(n.puntosMax) || n.puntosMax <= 0 || n.puntosMax > 1000) throw invalido('Los puntos máximos deben ser un número mayor que 0 y hasta 1000.', 'puntosMax', 'fuera_de_rango');
      if (decimales(n.puntosMax) > MAX_DECIMALES) throw invalido(`Los puntos máximos admiten como máximo ${MAX_DECIMALES} decimales.`, 'puntosMax');
      if (e.antes && n.puntosMax !== e.antes.puntosMax) {
        const r = await p.tx.query<{ m: string | null }>(`SELECT max(puntos)::text AS m FROM calificaciones WHERE actividad_id = $1 AND borrado_en IS NULL`, [e.id]);
        const m = r.rows[0]?.m;
        if (m !== null && m !== undefined && Number(m) > n.puntosMax + EPS) {
          throw invalido(`Hay notas de hasta ${m} puntos: los puntos máximos no pueden ser menores.`, 'puntosMax', 'fuera_de_rango');
        }
      }
    }
    if (n.nombre !== undefined && (typeof n.nombre !== 'string' || n.nombre.length > 200)) throw invalido('El nombre debe ser texto de hasta 200 caracteres.', 'nombre');
    if (str(n.periodoId)) periodos.add(n.periodoId as string);
  }
  if (e.antes && str(e.antes.periodoId)) periodos.add(e.antes.periodoId as string);
  for (const id of periodos) {
    const per = await p.periodo(id);
    if (per) aud = unir(aud, exigirPeriodoAbierto(p, per, 'actividades ni calificaciones'));
  }
  p.invalidarCache();
  return aud ? { auditoria: aud } : {};
}

// ------------------------------------------------------------------------------------------------ categorías
async function reglaCategorias(e: EntradaRegla): Promise<ResultadoRegla> {
  const { p } = e;
  let afectaPesos = e.accion === 'borrar';
  let carga = e.antes ? str(e.antes.cargaId) : null;
  if (e.accion !== 'borrar') {
    const n = e.nuevo as Registro;
    quitarCalculados(n);
    const c = str(n.cargaId);
    if (c) {
      const k = await p.carga(c);
      if (!k || k.centroId !== e.centro) throw new ErrorHttp(422, 'referencia_invalida', 'La carga docente no pertenece al centro.', ['cargaId']);
    }
    if (e.antes && e.antes.cargaId !== undefined && c !== e.antes.cargaId) throw invalido('La carga de una categoría no se puede cambiar.', 'cargaId', 'campo_inmutable');
    if (n.peso !== undefined && n.peso !== null) {
      if (!esNumeroFinito(n.peso) || n.peso < 0 || n.peso > 100) throw invalido('El peso debe ser un número entre 0 y 100.', 'peso', 'fuera_de_rango');
      if (decimales(n.peso) > MAX_DECIMALES) throw invalido(`El peso admite como máximo ${MAX_DECIMALES} decimales.`, 'peso');
    }
    if (n.nombre !== undefined && (typeof n.nombre !== 'string' || n.nombre.length > 80)) throw invalido('El nombre debe ser texto de hasta 80 caracteres.', 'nombre');
    carga = c ?? carga;
    const pesoNuevo = typeof n.peso === 'number' ? n.peso : 0;
    afectaPesos = e.antes ? (e.antes.peso ?? 0) !== pesoNuevo : pesoNuevo > 0;
  }
  // Cambiar pesos (o quitar una categoría) altera las notas ya calculadas de los periodos cerrados de la carga.
  if (afectaPesos && carga) {
    const r = await p.tx.query<{ id: string }>(
      `SELECT DISTINCT per.id FROM actividades a JOIN periodos per ON per.id = a.periodo_id AND per.borrado_en IS NULL
        WHERE a.carga_id = $1 AND a.borrado_en IS NULL AND per.cerrado`,
      [carga],
    );
    let aud: Record<string, unknown> | null = null;
    for (const f of r.rows) {
      const per = await p.periodo(f.id);
      if (per) aud = unir(aud, exigirPeriodoAbierto(p, per, 'los pesos de las categorías'));
    }
    if (aud) return { auditoria: aud };
  }
  return {};
}

// ------------------------------------------------------------------------------------------------ notasCompetencia
type Celdas = Map<number, boolean>; // índice de periodo → hay cambios

function celda(c: unknown, campo: 'p' | 'rp', i: number): number | null {
  const v = (c as { p?: unknown[]; rp?: unknown[] } | null)?.[campo]?.[i];
  return typeof v === 'number' ? v : null;
}

/** Periodos (índice 0..n) en cuyas celdas P_i / RP_i hay diferencias entre `a` y `b` (listas `c` de competencias). */
function periodosModificados(a: unknown, b: unknown): number[] {
  const la = Array.isArray(a) ? a : [];
  const lb = Array.isArray(b) ? b : [];
  const out: Celdas = new Map();
  for (let j = 0; j < Math.max(la.length, lb.length); j++) {
    for (let i = 0; i < 12; i++) {
      for (const campo of ['p', 'rp'] as const) {
        if (celda(la[j], campo, i) !== celda(lb[j], campo, i)) out.set(i, true);
      }
    }
  }
  return [...out.keys()];
}

async function reglaNotasCompetencia(e: EntradaRegla): Promise<ResultadoRegla> {
  const { p } = e;
  const calc = calculo();
  const cargaId = str((e.nuevo ?? e.antes)?.cargaId);
  const carga = cargaId ? await p.carga(cargaId) : null;
  let cambiadas: number[];
  if (e.accion !== 'borrar') {
    const n = e.nuevo as Registro;
    quitarCalculados(n);
    if (!cargaId) throw invalido('cargaId es obligatorio.', 'cargaId');
    if (!carga || carga.centroId !== e.centro) throw new ErrorHttp(422, 'referencia_invalida', 'La carga docente no pertenece al centro.', ['cargaId']);
    if (!str(n.estudianteId)) throw invalido('estudianteId es obligatorio.', 'estudianteId');
    if (e.antes && (e.antes.cargaId !== cargaId || e.antes.estudianteId !== n.estudianteId)) {
      throw invalido('cargaId y estudianteId de las notas por competencia no se pueden cambiar.', 'cargaId', 'campo_inmutable');
    }
    const escala = await p.escala(e.centro);
    const min = Number(escala.min ?? 0);
    const max = Number(escala.max ?? 100);
    // estructura y rangos de c: [{p:[..], rp:[..]}]
    if (n.c !== undefined && n.c !== null) {
      if (!Array.isArray(n.c) || n.c.length > 12) throw invalido('El campo c debe ser una lista de hasta 12 competencias.', 'c');
      n.c.forEach((comp: unknown, j: number) => {
        if (comp === null) return;
        if (typeof comp !== 'object' || Array.isArray(comp)) throw invalido(`La competencia ${j + 1} no es válida.`, 'c');
        for (const campo of ['p', 'rp'] as const) {
          const lista = (comp as Record<string, unknown>)[campo];
          if (lista === undefined || lista === null) continue;
          if (!Array.isArray(lista) || lista.length > 12) throw invalido(`La competencia ${j + 1}: ${campo} debe ser una lista de hasta 12 notas.`, 'c');
          lista.forEach((v: unknown, i: number) => nota(v, min, max, 'c', `La nota ${campo.toUpperCase()}${i + 1} de la competencia ${j + 1}`));
        }
      });
    }
    for (const f of ['cec', 'cex', 'esp'] as const) nota(n[f], min, max, f, `La nota ${f}`);
    // fases: solo cuando corresponden (y solo si cambiaron: un valor previo no se vuelve a exigir)
    if (calc.modelo(escala) === 'competencias') {
      const c = n.c ?? [];
      const sin = calc.calcularCompetencias({ competencias: c, escala });
      const minA = calc.aNumero(escala.notaMinAprobar) ?? 70;
      const cecOk = sin.completo && sin.cf !== null && sin.cf < minA - EPS;
      const conCec = calc.calcularCompetencias({ competencias: c, cec: n.cec, escala });
      const cexOk = typeof n.cec === 'number' && conCec.estado === 'Extraordinaria';
      const conCex = calc.calcularCompetencias({ competencias: c, cec: n.cec, cex: n.cex, escala });
      const espOk = typeof n.cex === 'number' && typeof n.cec === 'number' && conCex.estado === 'Reprobado' && conCex.cexf !== null;
      const cambio = (f: 'cec' | 'cex' | 'esp'): boolean => typeof n[f] === 'number' && n[f] !== (e.antes?.[f] ?? null);
      if (cambio('cec') && !cecOk) throw invalido('La nota de completiva solo aplica con el año completo y la calificación final por debajo del mínimo.', 'cec', 'fase_no_valida');
      if (cambio('cex') && !cexOk) throw invalido('La nota de extraordinaria solo aplica si la completiva no alcanzó el mínimo.', 'cex', 'fase_no_valida');
      if (cambio('esp') && !espOk) throw invalido('La nota de evaluación especial solo aplica si la extraordinaria no alcanzó el mínimo.', 'esp', 'fase_no_valida');
    }
    cambiadas = periodosModificados(e.antes?.c, n.c);
  } else {
    cambiadas = periodosModificados(e.antes?.c, []);
  }
  // Periodo i ↔ i-ésimo periodo (por orden) del año de la carga. Las fases posteriores no dependen del cierre.
  if (!cambiadas.length || !carga?.anioId) return {};
  const pers = await p.periodosDelAnio(e.centro, carga.anioId);
  let aud: Record<string, unknown> | null = null;
  for (const i of cambiadas) {
    const per = pers[i];
    if (per) aud = unir(aud, exigirPeriodoAbierto(p, per, 'las notas por competencia'));
  }
  return aud ? { auditoria: aud } : {};
}

// ------------------------------------------------------------------------------------------------ periodos
async function reglaPeriodos(e: EntradaRegla): Promise<ResultadoRegla> {
  const { p } = e;
  const antes = e.antes;
  if (e.accion === 'crear') {
    const n = e.nuevo as Registro;
    if (n.cerrado === true) throw new ErrorHttp(422, 'campo_protegido', 'El cierre de un periodo solo se cambia con «cerrar» y «reabrir».', ['cerrado']);
    for (const k of CAMPOS_CIERRE) delete n[k];
  } else if (e.accion === 'editar') {
    const n = e.nuevo as Registro;
    const habia = antes?.cerrado === true;
    if (n.cerrado !== undefined && (n.cerrado === true) !== habia) {
      throw new ErrorHttp(422, 'campo_protegido', 'El cierre de un periodo solo se cambia con «cerrar» y «reabrir».', ['cerrado']);
    }
    // Los campos de cierre los gestiona el servidor: se conservan los actuales, el cliente no los fija.
    for (const k of CAMPOS_CIERRE) {
      if (antes && antes[k] !== undefined) n[k] = antes[k];
      else delete n[k];
    }
  }
  if (e.accion !== 'borrar') {
    const n = e.nuevo as Registro;
    if (n.peso !== undefined && n.peso !== null) {
      if (!esNumeroFinito(n.peso) || n.peso < 0 || n.peso > 100) throw invalido('El peso del periodo debe ser un número entre 0 y 100.', 'peso', 'fuera_de_rango');
    }
    if (n.orden !== undefined && n.orden !== null && (!esNumeroFinito(n.orden) || n.orden < 1 || n.orden > 20 || !Number.isInteger(n.orden))) {
      throw invalido('El orden del periodo debe ser un entero entre 1 y 20.', 'orden', 'fuera_de_rango');
    }
    const ini = str(n.inicio);
    const fin = str(n.fin);
    if (ini && fin && /^\d{4}-\d{2}-\d{2}/.test(ini) && /^\d{4}-\d{2}-\d{2}/.test(fin) && ini > fin) throw invalido('La fecha de inicio es posterior al fin.', 'inicio');
  }
  // Editar o borrar un periodo cerrado (nombre, pesos, fechas): solo director/admin_red con motivo.
  if (antes?.cerrado === true && e.accion !== 'crear') {
    const per = await p.periodo(e.id);
    if (per) {
      const aud = exigirPeriodoAbierto(p, per, 'el periodo');
      p.invalidarCache();
      return aud ? { auditoria: aud } : {};
    }
  }
  p.invalidarCache();
  return {};
}

// ------------------------------------------------------------------------------------------------ entrada
export async function aplicarReglas(e: EntradaRegla): Promise<ResultadoRegla> {
  switch (e.meta.nombre) {
    case 'calificaciones':
      return reglaCalificaciones(e);
    case 'actividades':
      return reglaActividades(e);
    case 'categorias':
      return reglaCategorias(e);
    case 'notasCompetencia':
      return reglaNotasCompetencia(e);
    case 'periodos':
      return reglaPeriodos(e);
    default:
      return {};
  }
}

/** Decodifica y valida la cabecera X-EDU-Motivo (texto codificado con encodeURIComponent). null si no viene. */
export function motivoDeCabecera(valor: string | string[] | undefined): string | null {
  if (valor === undefined) return null;
  if (Array.isArray(valor)) throw new ErrorHttp(422, 'motivo_invalido', 'Envía una sola cabecera X-EDU-Motivo.', ['X-EDU-Motivo']);
  let t: string;
  try {
    t = decodeURIComponent(valor);
  } catch {
    throw new ErrorHttp(422, 'motivo_invalido', 'El motivo debe enviarse codificado (encodeURIComponent).', ['X-EDU-Motivo']);
  }
  return validarMotivo(t, 'X-EDU-Motivo');
}

export function validarMotivo(texto: unknown, campo: string): string {
  // eslint-disable-next-line no-control-regex
  const t = typeof texto === 'string' ? texto.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (t.length < MOTIVO_MIN || t.length > MOTIVO_MAX) {
    throw new ErrorHttp(422, 'motivo_invalido', `El motivo debe tener entre ${MOTIVO_MIN} y ${MOTIVO_MAX} caracteres.`, [campo]);
  }
  return t;
}

