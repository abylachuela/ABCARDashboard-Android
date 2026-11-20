// Currículo: marcar versión vigente y importación atómica, con el esquema, el aplanado y el hash del CLIENTE (curriculo-semilla.js).
import { randomUUID } from 'node:crypto';
import { ErrorHttp } from '../errores.js';
import type { Registro } from '../domain/autorizacion.js';
import { metaDe } from '../domain/colecciones.js';
import { curriculoCompartido } from '../domain/curriculo-shim.js';
import { registrarAuditoria } from './auditoria.js';
import type { Peticion } from './generico.js';
import { actualizarDatos, centroDeEscritura, esFecha, esObjeto, exigirRolEscribe, hoyServidor, insertarDatos, invalido, leerFila, str } from './util-negocio.js';

const meta = (n: string) => metaDe(n) as NonNullable<ReturnType<typeof metaDe>>;
export const MAX_ITEMS_IMPORTACION = 5000;

/** POST /curriculo/versiones/:id/vigente: la versión pasa a vigente y la vigente actual a «anterior», en una transacción. */
export async function marcarVigente(p: Peticion, id: string): Promise<{ version: Registro; anterior: string | null }> {
  exigirRolEscribe(p, 'curriculoVersiones', 'editar');
  const m = meta('curriculoVersiones');
  const previa = await leerFila(p, m, id);
  if (!previa) throw new ErrorHttp(404, 'no_encontrado', 'Versión no encontrada.');
  if (previa.datos.esConfig) throw invalido('Ese registro no es una versión del currículo.', 'id');
  await p.tx.query('SELECT id FROM curriculo_versiones WHERE centro_id = $1 AND borrado_en IS NULL ORDER BY id FOR UPDATE', [previa.centroId]);
  const f = await leerFila(p, m, id);
  if (!f) throw new ErrorHttp(404, 'no_encontrado', 'Versión no encontrada.');
  if (f.datos.estado === 'vigente') return { version: { ...f.datos, id, centroId: f.centroId, actualizadoEn: f.actualizadoEn }, anterior: null };
  const act = await p.tx.query<{ id: string }>(
    `UPDATE curriculo_versiones SET datos = datos || '{"estado":"anterior"}'::jsonb WHERE centro_id = $1 AND borrado_en IS NULL AND estado = 'vigente' AND id <> $2 RETURNING id`,
    [previa.centroId, id],
  );
  const v = await actualizarDatos(p, m, id, { estado: 'vigente', vigenteDesde: str(f.datos.vigenteDesde) ?? hoyServidor() });
  await registrarAuditoria(p.tx, p.ses, previa.centroId, { accion: 'curriculo_vigente', coleccion: 'curriculoVersiones', registroId: id, extra: { anterior: act.rows[0]?.id ?? null } });
  return { version: v, anterior: act.rows[0]?.id ?? null };
}

/** POST /curriculo/versiones/importar {doc, centroId?, nombre?, idExterno?, vigenteDesde?}: valida, calcula el hash y guarda versión + contenidos como borrador. */
export async function importarVersion(p: Peticion, cuerpo: unknown): Promise<{ version: Registro; total: number; hash: string; duplicadaDe: string | null }> {
  exigirRolEscribe(p, 'curriculoVersiones', 'crear');
  exigirRolEscribe(p, 'curriculoContenidos', 'crear');
  const b = esObjeto(cuerpo) ? cuerpo : {};
  const doc = b.doc;
  if (!esObjeto(doc)) throw invalido('Falta el documento curricular (doc).', 'doc');
  const centro = centroDeEscritura(p, b.centroId);
  const c = curriculoCompartido();
  const errores = c.validarDoc(doc);
  if (errores.length) throw new ErrorHttp(422, 'documento_invalido', `El documento no cumple el esquema: ${errores[0] as string}`, ['doc'], { errores });
  const items = c.aplanar(doc);
  if (items.length > MAX_ITEMS_IMPORTACION) throw invalido(`El documento tiene demasiados elementos (máximo ${MAX_ITEMS_IMPORTACION}).`, 'doc');
  const hash = c.hashItems(items);
  const extra: Registro = { estado: 'borrador', vigenteDesde: null };
  if (b.nombre !== undefined) {
    if (typeof b.nombre !== 'string' || !b.nombre.trim() || b.nombre.length > 300) throw invalido('El nombre no es válido.', 'nombre');
    extra.nombre = b.nombre.trim();
  }
  if (b.idExterno !== undefined) {
    if (typeof b.idExterno !== 'string' || !b.idExterno.trim() || b.idExterno.length > 200) throw invalido('idExterno no es válido.', 'idExterno');
    extra.idExterno = b.idExterno.trim();
  }
  if (b.vigenteDesde !== undefined && b.vigenteDesde !== null) {
    if (!esFecha(b.vigenteDesde)) throw invalido('vigenteDesde no es una fecha válida.', 'vigenteDesde');
    extra.vigenteDesde = b.vigenteDesde;
  }
  const dup = await p.tx.query<{ id: string }>(`SELECT id FROM curriculo_versiones WHERE centro_id = $1 AND borrado_en IS NULL AND datos->>'hash' = $2 AND datos->'esConfig' IS NULL LIMIT 1`, [centro, hash]);
  const mv = meta('curriculoVersiones');
  const mc = meta('curriculoContenidos');
  const vid = `${mv.prefijo}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const regs = c.registros(doc, centro, vid);
  const datosVersion = c.versionDe(doc, regs, extra);
  delete datosVersion.centroId;
  delete datosVersion.id;
  const version = await insertarDatos(p, mv, vid, centro, { ...datosVersion, estado: 'borrador', hash, total: regs.length });
  const ids = regs.map(() => `${mc.prefijo}_${randomUUID().replace(/-/g, '').slice(0, 20)}`);
  const datos = regs.map((r) => {
    const x = { ...r, versionId: vid } as Registro;
    delete x.centroId;
    return JSON.stringify(x);
  });
  // inserción en bloque (una sola sentencia): todo o nada junto con la versión
  await p.tx.query(
    `INSERT INTO curriculo_contenidos (id, centro_id, datos) SELECT i, $1, d::jsonb FROM unnest($2::text[], $3::text[]) AS t(i, d)`,
    [centro, ids, datos],
  );
  await registrarAuditoria(p.tx, p.ses, centro, { accion: 'curriculo_importar', coleccion: 'curriculoVersiones', registroId: vid, extra: { total: regs.length, hash } });
  return { version, total: regs.length, hash, duplicadaDe: dup.rows[0]?.id ?? null };
}
