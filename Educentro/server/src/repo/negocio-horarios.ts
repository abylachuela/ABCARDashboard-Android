// Horarios: guardado atómico por diferencias (POST /horarios/guardar), franjas por tanda (POST /franjas/tanda) y la
// comprobación de conflictos que también aplica el PUT/POST genérico. La validación es la del CLIENTE (horarios-motor.js,
// cargada por `vm`): conflictos que BLOQUEAN = docente | sección | aula | disponibilidad | franja inexistente/no-clase/día;
// los avisos (tope de horas, incompletas, tanda) se devuelven sin bloquear.
import { ErrorHttp } from '../errores.js';
import { puede, type Registro } from '../domain/autorizacion.js';
import { metaDe } from '../domain/colecciones.js';
import { motorHorarios, type ConflictoHorario, type DatosHorarios, type EntradaHorario, type AvisoHorario } from '../domain/horarios-shim.js';
import { registrarAuditoria } from './auditoria.js';
import type { Peticion } from './generico.js';
import { actualizarDatos, bloquearClave, centroDeEscritura, esObjeto, exigirRolEscribe, insertarDatos, invalido, str } from './util-negocio.js';
import { randomUUID } from 'node:crypto';

const meta = (n: string) => metaDe(n) as NonNullable<ReturnType<typeof metaDe>>;
const TANDAS = ['matutina', 'vespertina', 'extendida'];
const TIPOS_FRANJA = ['clase', 'recreo', 'almuerzo'];
const HHMM = /^\d{1,2}:\d{2}$/;
const mins = (h: string): number => Number(h.split(':')[0]) * 60 + Number(h.split(':')[1]);
const hhmm = (n: number): string => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/** Lee los 8 conjuntos que usa el motor (datos planos con id y centroId) de un centro. */
export async function cargarDatosHorarios(p: Peticion, centro: string): Promise<DatosHorarios> {
  const leer = async (tabla: string): Promise<Registro[]> => {
    const r = await p.tx.query<{ id: string; datos: Registro }>(`SELECT id, datos FROM ${tabla} WHERE centro_id = $1 AND borrado_en IS NULL ORDER BY id`, [centro]);
    return r.rows.map((x) => ({ ...x.datos, id: x.id, centroId: centro }));
  };
  // en serie: todas las consultas comparten la conexión de la transacción (pg no admite consultas concurrentes en un cliente)
  const franjas = await leer('franjas');
  const horarios = await leer('horarios');
  const disponibilidad = await leer('disponibilidad');
  const cargas = await leer('cargas');
  const secciones = await leer('secciones');
  const cursos = await leer('cursos');
  const asignaturas = await leer('asignaturas');
  const docentes = await leer('docentes');
  return { franjas, horarios, disponibilidad, cargas, secciones, cursos, asignaturas, docentes } as DatosHorarios;
}

const aEntrada = (h: Registro): EntradaHorario => ({ id: String(h.id), cargaId: String(h.cargaId ?? ''), dia: Number(h.dia), franjaId: String(h.franjaId ?? ''), aula: typeof h.aula === 'string' ? h.aula : '' });

export interface InformeConflictos {
  /** Conflictos que involucran a alguna entrada tocada (BLOQUEAN). */
  bloqueantes: ConflictoHorario[];
  /** Conflictos entre entradas no tocadas (datos anteriores): se informan, no bloquean. */
  previos: ConflictoHorario[];
  avisos: AvisoHorario[];
}

/** Valida el conjunto resultante de aplicar `nuevas` (clave → entrada) y quitar `quitar` (ids) sobre los horarios actuales. */
export function evaluarHorarios(datos: DatosHorarios, nuevas: EntradaHorario[], quitar: Set<string>, tocadas: Set<string>): InformeConflictos {
  const reemplazadas = new Set(nuevas.map((n) => n.id ?? '').filter(Boolean));
  const vigentes = datos.horarios
    .filter((h) => !quitar.has(String(h.id)) && !reemplazadas.has(String(h.id)) && str(h.franjaId))
    .map(aEntrada);
  // día fuera de 1–5: conflicto propio (el motor del cliente no soporta nombrar un día inexistente con una franja que no es de clase)
  const diaMalo = nuevas.filter((n) => !(n.dia >= 1 && n.dia <= 5));
  const buenas = nuevas.filter((n) => n.dia >= 1 && n.dia <= 5);
  const r = motorHorarios().validar(datos, [...vigentes, ...buenas]);
  for (const n of diaMalo) r.conflictos.push({ tipo: 'franja', msg: 'Día no válido: debe ser de lunes (1) a viernes (5).', claves: [n.id ?? n._k ?? ''] });
  const involucra = (c: ConflictoHorario): boolean => c.claves.some((k) => tocadas.has(k));
  return { bloqueantes: r.conflictos.filter(involucra), previos: r.conflictos.filter((c) => !involucra(c)), avisos: r.avisos };
}

function rechazar(inf: InformeConflictos): never {
  const n = inf.bloqueantes.length;
  throw new ErrorHttp(
    409, 'horario_conflictos',
    n === 1 ? (inf.bloqueantes[0] as ConflictoHorario).msg : `El horario tiene ${n} conflictos: ${(inf.bloqueantes[0] as ConflictoHorario).msg} (y ${n - 1} más).`,
    undefined, { conflictos: inf.bloqueantes, avisos: inf.avisos },
  );
}

function entradaValida(x: unknown, etiqueta: string, conId: boolean): { id?: string; cargaId: string; dia: number; franjaId: string; aula: string } {
  if (!esObjeto(x)) throw invalido(`${etiqueta}: debe ser un objeto.`, 'horarios');
  const cargaId = str(x.cargaId);
  const franjaId = str(x.franjaId);
  const dia = typeof x.dia === 'number' ? x.dia : Number(x.dia);
  if (!cargaId) throw invalido(`${etiqueta}: cargaId es obligatorio.`, 'cargaId');
  if (!franjaId) throw invalido(`${etiqueta}: franjaId es obligatorio.`, 'franjaId');
  if (!Number.isInteger(dia)) throw invalido(`${etiqueta}: el día debe ser un entero de 1 (lunes) a 5 (viernes).`, 'dia', 'dia_invalido');
  const aula = x.aula === undefined || x.aula === null ? '' : x.aula;
  if (typeof aula !== 'string' || aula.length > 40) throw invalido(`${etiqueta}: el aula debe ser texto de hasta 40 caracteres.`, 'aula');
  const id = str(x.id);
  if (conId && !id) throw invalido(`${etiqueta}: id es obligatorio.`, 'id');
  return { ...(id ? { id } : {}), cargaId, dia, franjaId, aula: aula.trim() };
}

const campoDerivado = (datos: DatosHorarios, franjaId: string): { hora: string; duracion: number } => {
  const f = datos.franjas.find((x) => x.id === franjaId);
  return f && typeof f.inicio === 'string' && typeof f.fin === 'string' ? { hora: f.inicio, duracion: mins(f.fin) - mins(f.inicio) } : { hora: '', duracion: 45 };
};

/** POST /horarios/guardar {centroId?, crear:[…], actualizar:[…], borrar:[ids]}: atómico; 409 con los conflictos si introduce alguno. */
export async function guardarHorarios(p: Peticion, cuerpo: unknown): Promise<{ creados: Registro[]; actualizados: Registro[]; borrados: string[]; avisos: AvisoHorario[]; conflictosPrevios: ConflictoHorario[] }> {
  exigirRolEscribe(p, 'horarios', 'crear');
  const b = esObjeto(cuerpo) ? cuerpo : {};
  const crear = Array.isArray(b.crear) ? b.crear : [];
  const actualizar = Array.isArray(b.actualizar) ? b.actualizar : [];
  const borrar = Array.isArray(b.borrar) ? b.borrar : [];
  if (crear.length + actualizar.length + borrar.length === 0) throw invalido('No hay cambios que guardar.', 'crear');
  if (crear.length > 500 || actualizar.length > 500 || borrar.length > 500) throw invalido('Máximo 500 cambios por tipo.', 'crear');
  if (borrar.some((x) => !str(x))) throw invalido('borrar debe ser una lista de ids.', 'borrar');
  const centro = centroDeEscritura(p, b.centroId);
  await bloquearClave(p, `horarios:${centro}`);
  const datos = await cargarDatosHorarios(p, centro);
  const porId = new Map(datos.horarios.map((h) => [String(h.id), h]));
  const cargaPor = new Map(datos.cargas.map((c) => [String(c.id), c]));
  const nuevas: EntradaHorario[] = [];
  const tocadas = new Set<string>();
  const altas = crear.map((x, i) => ({ ...entradaValida(x, `Nuevo bloque ${i + 1}`, false), _k: `nuevo_${i}` }));
  for (const a of altas) {
    nuevas.push({ _k: a._k, cargaId: a.cargaId, dia: a.dia, franjaId: a.franjaId, aula: a.aula });
    tocadas.add(a._k);
  }
  const cambios = actualizar.map((x, i) => entradaValida(x, `Bloque ${i + 1}`, true));
  const idsCambio = new Set<string>();
  for (const c of cambios) {
    const id = c.id as string;
    if (idsCambio.has(id)) throw invalido(`El bloque ${id} aparece dos veces.`, 'actualizar');
    idsCambio.add(id);
    if (!porId.has(id)) throw new ErrorHttp(404, 'no_encontrado', `El bloque ${id} no existe en este centro.`);
    nuevas.push({ id, cargaId: c.cargaId, dia: c.dia, franjaId: c.franjaId, aula: c.aula });
    tocadas.add(id);
  }
  const quitar = new Set<string>(borrar as string[]);
  for (const id of quitar) {
    if (!porId.has(id)) throw new ErrorHttp(404, 'no_encontrado', `El bloque ${id} no existe en este centro.`);
    if (idsCambio.has(id)) throw invalido(`El bloque ${id} no puede actualizarse y borrarse a la vez.`, 'borrar');
  }
  // cargas del centro (referencia) y propiedad (docente: solo las suyas)
  const alc = await p.alcance();
  const comprobar = async (accion: 'crear' | 'editar' | 'borrar', reg: Registro, antes: Registro | null): Promise<void> => {
    const c = cargaPor.get(String(reg.cargaId));
    if (!c) throw new ErrorHttp(422, 'referencia_invalida', 'La carga docente del bloque no pertenece al centro.', ['cargaId']);
    const dec = await puede(p.ses, 'horarios', accion, { ...reg, centroId: centro }, { antes, alcance: alc });
    if (!dec.ok) throw new ErrorHttp(dec.status, dec.codigo, dec.mensaje);
  };
  for (const a of altas) await comprobar('crear', a, null);
  for (const c of cambios) {
    const antes = porId.get(c.id as string) as Registro;
    await comprobar('editar', c, antes);
  }
  for (const id of quitar) await comprobar('borrar', porId.get(id) as Registro, porId.get(id) as Registro);

  const inf = evaluarHorarios(datos, nuevas, quitar, tocadas);
  if (inf.bloqueantes.length) rechazar(inf);

  const m = meta('horarios');
  const creados: Registro[] = [];
  const actualizados: Registro[] = [];
  for (const id of quitar) await p.tx.query('UPDATE horarios SET borrado_en = now() WHERE id = $1', [id]);
  for (const c of cambios) {
    actualizados.push(await actualizarDatos(p, m, c.id as string, { cargaId: c.cargaId, dia: c.dia, franjaId: c.franjaId, aula: c.aula, ...campoDerivado(datos, c.franjaId) }));
  }
  for (const a of altas) {
    creados.push(await insertarDatos(p, m, `${m.prefijo}_${randomUUID().replace(/-/g, '').slice(0, 20)}`, centro, { cargaId: a.cargaId, dia: a.dia, franjaId: a.franjaId, aula: a.aula, ...campoDerivado(datos, a.franjaId) }));
  }
  await registrarAuditoria(p.tx, p.ses, centro, { accion: 'guardar_horarios', coleccion: 'horarios', extra: { creados: creados.length, actualizados: actualizados.length, borrados: quitar.size } });
  return { creados, actualizados, borrados: [...quitar], avisos: inf.avisos, conflictosPrevios: inf.previos };
}

/** Usado por la capa genérica: un horario creado/editado por PUT/POST no puede introducir conflictos. */
export async function validarHorarioGenerico(p: Peticion, centro: string, id: string, nuevo: Registro): Promise<void> {
  if (!str(nuevo.franjaId)) return; // horario heredado (hora + duración): sin franja no hay conflictos que evaluar
  const e = entradaValida({ ...nuevo, id }, 'El bloque', true);
  await bloquearClave(p, `horarios:${centro}`);
  const datos = await cargarDatosHorarios(p, centro);
  if (!datos.cargas.some((c) => c.id === e.cargaId)) throw new ErrorHttp(422, 'referencia_invalida', 'La carga docente del bloque no pertenece al centro.', ['cargaId']);
  const inf = evaluarHorarios(datos, [{ id, cargaId: e.cargaId, dia: e.dia, franjaId: e.franjaId, aula: e.aula }], new Set(), new Set([id]));
  if (inf.bloqueantes.length) rechazar(inf);
  Object.assign(nuevo, campoDerivado(datos, e.franjaId), { dia: e.dia, aula: e.aula });
}

// ----------------------------------------------------------------------------------------------------------------- franjas
function validarFormatoFranja(f: Registro, etiqueta: string): void {
  if (f.tipo === 'config') return;
  if (!TIPOS_FRANJA.includes(String(f.tipo))) throw invalido(`${etiqueta}: el tipo debe ser clase, recreo o almuerzo.`, 'tipo');
  if (f.tanda !== undefined && !TANDAS.includes(String(f.tanda))) throw invalido(`${etiqueta}: la tanda debe ser matutina, vespertina o extendida.`, 'tanda');
  const ini = f.inicio, fin = f.fin;
  if (typeof ini !== 'string' || typeof fin !== 'string' || !HHMM.test(ini) || !HHMM.test(fin)) throw invalido(`${etiqueta}: inicio y fin deben tener formato HH:MM.`, 'inicio');
  if (mins(ini) >= 24 * 60 || mins(fin) >= 24 * 60 || Number(ini.split(':')[1]) > 59 || Number(fin.split(':')[1]) > 59) throw invalido(`${etiqueta}: hora fuera de rango.`, 'inicio');
  if (mins(ini) >= mins(fin)) throw invalido(`${etiqueta}: el inicio debe ser anterior al fin.`, 'inicio');
}

/** Regla genérica de franjas (POST/PUT /c/franjas): formato, inicio<fin, sin solapes en la tanda, clase si tiene bloques. */
export async function validarFranjaGenerica(p: Peticion, centro: string, id: string, nuevo: Registro): Promise<void> {
  if (nuevo.tipo === 'config') {
    if (nuevo.topeHoras !== undefined && nuevo.topeHoras !== null && (typeof nuevo.topeHoras !== 'number' || !(nuevo.topeHoras >= 0 && nuevo.topeHoras <= 80))) throw invalido('El tope de horas debe estar entre 0 y 80.', 'topeHoras', 'fuera_de_rango');
    return;
  }
  validarFormatoFranja(nuevo, 'La franja');
  const tanda = str(nuevo.tanda);
  if (tanda) {
    const otras = await p.tx.query<{ datos: Registro }>(`SELECT datos FROM franjas WHERE centro_id = $1 AND borrado_en IS NULL AND id <> $2 AND datos->>'tanda' = $3 AND datos->>'tipo' IS DISTINCT FROM 'config'`, [centro, id, tanda]);
    const errores = motorHorarios().validarFranjas([...otras.rows.map((r) => r.datos), nuevo]);
    if (errores.length) throw new ErrorHttp(422, 'franjas_invalidas', errores[0] as string, ['inicio'], { errores });
  }
  if (nuevo.tipo !== 'clase') {
    const n = (await p.tx.query<{ n: number }>('SELECT count(*)::int AS n FROM horarios WHERE franja_id = $1 AND borrado_en IS NULL', [id])).rows[0]?.n ?? 0;
    if (n) throw new ErrorHttp(409, 'franja_con_clases', `La franja tiene ${n} clases asignadas y debe seguir siendo de tipo Clase.`);
  }
}

/** Antes de borrar una franja: sin clases; sus marcas de disponibilidad se retiran en cascada. */
export async function prepararBorradoFranja(p: Peticion, id: string): Promise<void> {
  const n = (await p.tx.query<{ n: number }>('SELECT count(*)::int AS n FROM horarios WHERE franja_id = $1 AND borrado_en IS NULL', [id])).rows[0]?.n ?? 0;
  if (n) throw new ErrorHttp(409, 'franja_con_clases', `No se puede eliminar la franja: tiene ${n} clases asignadas.`, undefined, { clases: n });
  await p.tx.query(`UPDATE disponibilidad SET borrado_en = now() WHERE borrado_en IS NULL AND datos->>'franjaId' = $1`, [id]);
}

/** POST /franjas/tanda {centroId?, tanda, franjas:[{id?, inicio, fin, tipo}]}: reemplaza las franjas de una tanda, atómico. */
export async function guardarFranjasTanda(p: Peticion, cuerpo: unknown): Promise<{ franjas: Registro[]; quitadas: string[] }> {
  exigirRolEscribe(p, 'franjas', 'crear');
  const b = esObjeto(cuerpo) ? cuerpo : {};
  const tanda = str(b.tanda);
  if (!tanda || !TANDAS.includes(tanda)) throw invalido('tanda debe ser matutina, vespertina o extendida.', 'tanda');
  const lista = Array.isArray(b.franjas) ? b.franjas : null;
  if (!lista || lista.length > 30) throw invalido('franjas debe ser una lista de hasta 30 elementos.', 'franjas');
  const centro = centroDeEscritura(p, b.centroId);
  const items = lista.map((x, i) => {
    if (!esObjeto(x)) throw invalido(`Franja ${i + 1}: debe ser un objeto.`, 'franjas');
    const f = { id: str(x.id) ?? undefined, inicio: x.inicio, fin: x.fin, tipo: x.tipo, tanda };
    validarFormatoFranja(f as Registro, `Franja ${i + 1}`);
    return f as { id?: string; inicio: string; fin: string; tipo: string; tanda: string };
  });
  const errores = motorHorarios().validarFranjas(items);
  if (errores.length) throw new ErrorHttp(422, 'franjas_invalidas', errores[0] as string, ['franjas'], { errores });
  await bloquearClave(p, `horarios:${centro}`);
  const actuales = await p.tx.query<{ id: string; datos: Registro }>(
    `SELECT id, datos FROM franjas WHERE centro_id = $1 AND borrado_en IS NULL AND datos->>'tanda' = $2 AND datos->>'tipo' IS DISTINCT FROM 'config' ORDER BY id FOR UPDATE`,
    [centro, tanda],
  );
  const porId = new Map(actuales.rows.map((r) => [r.id, r.datos]));
  const vivos = new Set(items.map((i) => i.id).filter((x): x is string => !!x));
  for (const id of vivos) if (!porId.has(id)) throw new ErrorHttp(404, 'no_encontrado', `La franja ${id} no existe en la tanda.`);
  const quitadas = actuales.rows.map((r) => r.id).filter((id) => !vivos.has(id));
  const horarios = await p.tx.query<{ franja_id: string; n: number }>(`SELECT franja_id, count(*)::int AS n FROM horarios WHERE franja_id = ANY($1::text[]) AND borrado_en IS NULL GROUP BY franja_id`, [actuales.rows.map((r) => r.id)]);
  const conClases = new Map(horarios.rows.map((r) => [r.franja_id, r.n]));
  for (const id of quitadas) {
    const f = porId.get(id) as Registro;
    if (conClases.get(id)) throw new ErrorHttp(409, 'franja_con_clases', `No se puede quitar la franja ${String(f.inicio)}–${String(f.fin)}: tiene ${conClases.get(id)} clases asignadas.`);
  }
  for (const i of items) if (i.id && i.tipo !== 'clase' && conClases.get(i.id)) throw new ErrorHttp(409, 'franja_con_clases', `La franja ${i.inicio}–${i.fin} tiene clases asignadas y debe seguir siendo de tipo Clase.`);
  const m = meta('franjas');
  for (const id of quitadas) await prepararBorradoFranja(p, id).then(() => p.tx.query('UPDATE franjas SET borrado_en = now() WHERE id = $1', [id]));
  const orden = items.slice().sort((a, c) => mins(a.inicio) - mins(c.inicio));
  const out: Registro[] = [];
  for (const [k, f] of orden.entries()) {
    const campos = { centroId: centro, tanda, orden: k + 1, inicio: hhmm(mins(f.inicio)), fin: hhmm(mins(f.fin)), tipo: f.tipo };
    if (f.id) out.push(await actualizarDatos(p, m, f.id, { tanda, orden: k + 1, inicio: campos.inicio, fin: campos.fin, tipo: f.tipo }));
    else out.push(await insertarDatos(p, m, `${m.prefijo}_${randomUUID().replace(/-/g, '').slice(0, 20)}`, centro, { tanda, orden: k + 1, inicio: campos.inicio, fin: campos.fin, tipo: f.tipo }));
  }
  await registrarAuditoria(p.tx, p.ses, centro, { accion: 'guardar_franjas', coleccion: 'franjas', extra: { tanda, franjas: out.length, quitadas: quitadas.length } });
  return { franjas: out, quitadas };
}
