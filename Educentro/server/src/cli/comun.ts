import { cargarConfig, ConfigError, type Config } from '../config.js';
import { crearPool, type Pool } from '../db/pool.js';

export function cargarConfigCli(): Config {
  try {
    return cargarConfig();
  } catch (e) {
    console.error(e instanceof ConfigError ? e.message : 'No se pudo cargar la configuración');
    process.exit(1);
  }
}

export function poolDe(url: string): Pool {
  return crearPool(url, { max: 2, nombre: 'educentro-cli' });
}

export function argumento(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
