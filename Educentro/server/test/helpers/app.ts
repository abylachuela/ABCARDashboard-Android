import { Writable } from 'node:stream';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { Mailer } from '../../src/auth/mailer.js';
import { hashClave } from '../../src/auth/password.js';
import { cargarConfig, type Config } from '../../src/config.js';
import { migrar } from '../../src/db/migrar.js';
import { crearPool, type Pool } from '../../src/db/pool.js';
import { APP_URL, OWNER_URL } from './entorno.js';

export const CLAVE_BUENA = 'Zorro-Violeta-4821!';
export const ORIGEN = 'http://localhost:3000';

export class MailerMemoria implements Mailer {
  enviados: { destino: string; nombre: string; enlace: string }[] = [];
  async enviarRecuperacion(destino: string, nombre: string, enlace: string): Promise<void> {
    this.enviados.push({ destino, nombre, enlace });
  }
  tokenDe(i = this.enviados.length - 1): string {
    return (this.enviados[i]?.enlace ?? '').split('/restablecer/')[1] ?? '';
  }
}

let ownerPool: Pool | null = null;
export function owner(): Pool {
  ownerPool ??= crearPool(OWNER_URL, { max: 3, nombre: 'test-owner' });
  return ownerPool;
}

export async function prepararBD(): Promise<void> {
  await migrar(owner());
}

export async function limpiarBD(): Promise<void> {
  await owner().query('TRUNCATE usuarios, centros CASCADE'); // sesiones y tokens caen en cascada
}

export const envBase = (extra: Record<string, string> = {}): Record<string, string> => ({
  NODE_ENV: 'test',
  DATABASE_URL: APP_URL,
  PUBLIC_URL: ORIGEN,
  LOG_LEVEL: 'info',
  RATE_LIMIT_AUTH_MAX: '100000',
  RATE_LIMIT_RECUPERAR_MAX: '100000',
  ...extra,
});

export interface Contexto {
  app: FastifyInstance;
  mailer: MailerMemoria;
  logs: string[];
  config: Config;
}

export async function crearApp(extraEnv: Record<string, string> = {}): Promise<Contexto> {
  const config = cargarConfig(envBase(extraEnv));
  const mailer = new MailerMemoria();
  const logs: string[] = [];
  const logStream = new Writable({
    write(chunk, _e, cb) {
      logs.push(String(chunk));
      cb();
    },
  });
  const app = await buildApp(config, { mailer, logStream });
  await app.ready();
  return { app, mailer, logs, config };
}

let n = 0;
export async function crearUsuario(
  opciones: { rol?: string; clave?: string; activo?: boolean; debeCambiar?: boolean; email?: string } = {},
): Promise<{ id: string; email: string; clave: string }> {
  const rol = opciones.rol ?? 'docente';
  const clave = opciones.clave ?? CLAVE_BUENA;
  const email = opciones.email ?? `usuario${++n}@prueba.test`;
  const id = `usr_t${n}_${Math.random().toString(36).slice(2, 8)}`;
  let centro: string | null = null;
  if (rol !== 'admin_red') {
    centro = 'ctr_prueba';
    await owner().query("INSERT INTO centros (id, nombre) VALUES ($1, 'Centro de prueba') ON CONFLICT DO NOTHING", [centro]);
  }
  await owner().query(
    `INSERT INTO usuarios (id, centro_id, rol, nombre, email, hash, activo, debe_cambiar_clave)
     VALUES ($1, $2, $3, 'Persona de Prueba', $4, $5, $6, $7)`,
    [id, centro, rol, email, await hashClave(clave), opciones.activo ?? true, opciones.debeCambiar ?? false],
  );
  return { id, email, clave };
}

export const nombreCookie = 'edu_sid';

export function cookieDe(r: LightMyRequestResponse, nombre = nombreCookie): string | undefined {
  return r.cookies.find((c) => c.name === nombre)?.value;
}

export function login(app: FastifyInstance, email: string, clave: string, extra: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: ORIGEN, ...extra },
    payload: { email, clave },
  });
}

/** Inicia sesión y devuelve cookie y CSRF listos para las peticiones siguientes. */
export async function entrar(app: FastifyInstance, email: string, clave: string) {
  const r = await login(app, email, clave);
  if (r.statusCode !== 200) throw new Error(`login falló: ${r.statusCode} ${r.body}`);
  const cookie = cookieDe(r) as string;
  const csrf = (r.json() as { csrfToken: string }).csrfToken;
  return {
    cookie,
    csrf,
    headers: { cookie: `${nombreCookie}=${cookie}`, 'x-edu-csrf': csrf, origin: ORIGEN },
  };
}
