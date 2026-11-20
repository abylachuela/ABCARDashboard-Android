#!/usr/bin/env node
// Vuelve a la versión anterior desplegada por deploy.mjs (sustituye a rollback.sh). Sin dependencias.
//   sudo node Educentro/deploy/rollback.mjs [--app-dir=/var/www/educentro] [--dry-run]
// Pasa a la versión inmediatamente más antigua que la activa. Códigos de salida: ver deploy.mjs
// (0 ok, 2 entrada inválida, 3 falta root, 7 no hay versión anterior).

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { EXIT, ErrorDeEntrada, ErrorFatal, activarEnlace, listarVersiones, validarAppDir } from './deploy.mjs';

/** Versión a la que volver: la más reciente que sea más antigua que la activa (o la más reciente distinta si la activa es desconocida). */
export function elegirAnterior(versiones /* de nueva a vieja */, activa) {
  const i = versiones.indexOf(activa);
  if (i === -1) return versiones.find((v) => v !== activa) ?? null;
  return versiones[i + 1] ?? null;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  try {
    let parsed;
    try {
      parsed = parseArgs({ args: argv, strict: true, allowPositionals: false,
        options: { 'app-dir': { type: 'string' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
    } catch (e) { throw new ErrorDeEntrada(e.message); }
    const o = parsed.values;
    if (o.help) { console.log('Uso: sudo node rollback.mjs [--app-dir=RUTA] [--dry-run]   (env APP_DIR; def. /var/www/educentro)'); return EXIT.OK; }
    const appDir = validarAppDir(o['app-dir'] ?? (env.APP_DIR || '/var/www/educentro'));
    if (!o['dry-run'] && process.getuid?.() !== 0) throw new ErrorFatal('Ejecuta como root (sudo).', EXIT.ROOT);

    const enlace = path.join(appDir, 'current');
    let activa = '';
    try { activa = path.basename(fs.realpathSync(enlace)); } catch { /* sin versión activa */ }
    const prev = elegirAnterior(listarVersiones(appDir), activa);
    if (!prev) throw new ErrorFatal('No hay versión anterior.', EXIT.SIN_VERSION);
    if (o['dry-run']) { console.log(`[dry-run] activaría ${prev} (ahora: ${activa || 'ninguna'}); no se modificó nada.`); return EXIT.OK; }
    activarEnlace(enlace, path.join(appDir, 'releases', prev));
    console.log(`Activa ahora: ${prev} (antes: ${activa || 'ninguna'})`);
    return EXIT.OK;
  } catch (e) {
    if (e instanceof ErrorDeEntrada) { console.error(`Entrada inválida: ${e.message}`); return EXIT.ENTRADA; }
    if (e instanceof ErrorFatal) { console.error(e.message); return e.code; }
    console.error(`Error inesperado: ${e?.stack || e}`);
    return EXIT.ERROR;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  process.exitCode = await main();
}
