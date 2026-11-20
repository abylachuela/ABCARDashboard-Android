import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

export class ConfigError extends Error {
  constructor(public readonly problemas: string[]) {
    // Solo nombres de variables y motivos: nunca valores (pueden ser secretos).
    super(`Configuración inválida:\n - ${problemas.join('\n - ')}`);
    this.name = 'ConfigError';
  }
}

export type TrustProxy = boolean | string[];

export interface Config {
  entorno: 'development' | 'test' | 'production';
  produccion: boolean;
  host: string;
  puerto: number;
  logLevel: string;
  databaseUrl: string;
  migrationDatabaseUrl: string;
  sessionSecret: string;
  publicUrl: string;
  origenesPermitidos: string[];
  trustProxy: TrustProxy;
  sesionAbsolutaSeg: number;
  sesionInactividadSeg: number;
  loginMaxIntentos: number;
  loginBloqueoMin: number;
  resetTokenMin: number;
  rateLimitAuthMax: number;
  rateLimitRecuperarMax: number;
  rateLimitVentanaSeg: number;
  correo: {
    transporte: 'consola' | 'smtp';
    from: string;
    smtp: { host: string; port: number; secure: boolean; user?: string; pass?: string } | null;
  };
}

/** Variables cuyo valor puede venir de un archivo (NOMBRE_FILE) para usar Docker secrets. */
const ADMITEN_ARCHIVO = ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'SESSION_SECRET', 'SMTP_PASS'] as const;

type Env = Record<string, string | undefined>;

function resolverArchivos(env: Env, problemas: string[]): Env {
  const salida: Env = { ...env };
  for (const nombre of ADMITEN_ARCHIVO) {
    const ruta = env[`${nombre}_FILE`];
    if (!ruta) continue;
    try {
      salida[nombre] = readFileSync(ruta, 'utf8').replace(/\r?\n$/, '');
    } catch {
      problemas.push(`${nombre}_FILE: no se puede leer el archivo indicado`);
    }
  }
  return salida;
}

const vacioAUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const opt = <T extends z.ZodType>(s: T) => z.preprocess(vacioAUndefined, s.optional());
const entero = (min: number, max: number, def: number) =>
  z.preprocess(vacioAUndefined, z.coerce.number().int().min(min).max(max).default(def));
const booleano = z.preprocess(
  (v) => (typeof v === 'string' ? ['1', 'true', 'si', 'sí', 'yes'].includes(v.trim().toLowerCase()) : v),
  z.boolean().default(false),
);

const esquema = z.object({
  NODE_ENV: z.preprocess(vacioAUndefined, z.enum(['development', 'test', 'production']).default('development')),
  HOST: z.preprocess(vacioAUndefined, z.string().default('127.0.0.1')),
  PORT: entero(1, 65535, 3000),
  LOG_LEVEL: z.preprocess(
    vacioAUndefined,
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ),
  DATABASE_URL: z
    .string({ error: 'es obligatoria' })
    .regex(/^postgres(ql)?:\/\//, 'debe empezar por postgres:// o postgresql://'),
  MIGRATION_DATABASE_URL: opt(z.string().regex(/^postgres(ql)?:\/\//, 'debe empezar por postgres://')),
  SESSION_SECRET: opt(z.string()),
  PUBLIC_URL: opt(z.string().url('debe ser una URL http(s)')),
  ALLOWED_ORIGINS: opt(z.string()),
  TRUST_PROXY: opt(z.string()),
  SESSION_ABSOLUTE_HOURS: entero(1, 24 * 30, 12),
  SESSION_IDLE_HOURS: entero(1, 24 * 7, 2),
  LOGIN_MAX_INTENTOS: entero(1, 100, 5),
  LOGIN_BLOQUEO_MIN: entero(1, 24 * 60, 15),
  RESET_TOKEN_MIN: entero(1, 24 * 60, 30),
  RATE_LIMIT_AUTH_MAX: entero(1, 100_000, 20),
  RATE_LIMIT_RECUPERAR_MAX: entero(1, 100_000, 5),
  RATE_LIMIT_WINDOW_S: entero(1, 86_400, 60),
  MAIL_TRANSPORT: z.preprocess(vacioAUndefined, z.enum(['consola', 'smtp']).default('consola')),
  MAIL_FROM: z.preprocess(vacioAUndefined, z.string().max(254).default('EduCentro <no-reply@ejemplo.invalid>')),
  SMTP_HOST: opt(z.string()),
  SMTP_PORT: entero(1, 65535, 587),
  SMTP_SECURE: booleano,
  SMTP_USER: opt(z.string()),
  SMTP_PASS: opt(z.string()),
});

function parsearTrustProxy(v: string | undefined, problemas: string[]): TrustProxy {
  if (v === undefined) return false;
  const t = v.trim().toLowerCase();
  if (t === 'false') return false;
  if (t === 'true') return true;
  // Fastify 5 no admite "número de saltos" (falla cerrado): se exige una lista explícita de proxys de confianza.
  const lista = v.split(',').map((s) => s.trim()).filter(Boolean);
  const valido = (x: string) =>
    ['loopback', 'linklocal', 'uniquelocal'].includes(x) || /^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(x);
  if (lista.length === 0 || lista.some((x) => !valido(x)) || lista.some((x) => /^\d+$/.test(x))) {
    problemas.push('TRUST_PROXY: use false, true o una lista de IP/CIDR (también loopback, linklocal, uniquelocal)');
    return false;
  }
  return lista;
}

export function cargarConfig(envEntrada: Env = process.env): Config {
  const problemas: string[] = [];
  const env = resolverArchivos(envEntrada, problemas);
  const r = esquema.safeParse(env);
  if (!r.success) {
    for (const i of r.error.issues) problemas.push(`${i.path.join('.') || '(general)'}: ${i.message}`);
    throw new ConfigError(problemas);
  }
  const e = r.data;
  const produccion = e.NODE_ENV === 'production';

  let sessionSecret = e.SESSION_SECRET;
  if (sessionSecret !== undefined && Buffer.byteLength(sessionSecret, 'utf8') < 32) {
    problemas.push('SESSION_SECRET: debe tener al menos 32 bytes (openssl rand -base64 48)');
  }
  if (sessionSecret === undefined) {
    if (produccion) problemas.push('SESSION_SECRET: es obligatoria en producción (>= 32 bytes)');
    // Fuera de producción: secreto efímero por proceso (las sesiones/CSRF no sobreviven a un reinicio). Sin valor por defecto.
    else sessionSecret = randomBytes(48).toString('base64url');
  }

  const publicUrl = (e.PUBLIC_URL ?? `http://localhost:${e.PORT}`).replace(/\/+$/, '');
  if (produccion) {
    if (!e.PUBLIC_URL) problemas.push('PUBLIC_URL: es obligatoria en producción');
    else if (!e.PUBLIC_URL.startsWith('https://')) problemas.push('PUBLIC_URL: en producción debe ser https://');
    if (e.MAIL_TRANSPORT !== 'smtp') problemas.push('MAIL_TRANSPORT: en producción debe ser smtp');
  }
  if (e.MAIL_TRANSPORT === 'smtp' && !e.SMTP_HOST) problemas.push('SMTP_HOST: es obligatoria con MAIL_TRANSPORT=smtp');

  const origenes = (e.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  for (const o of origenes) {
    try {
      const u = new URL(o);
      if (u.origin !== o) throw new Error('x');
    } catch {
      problemas.push('ALLOWED_ORIGINS: cada entrada debe ser un origen (esquema://host[:puerto])');
      break;
    }
  }

  const trustProxy = parsearTrustProxy(e.TRUST_PROXY, problemas);
  if (problemas.length) throw new ConfigError(problemas);

  return {
    entorno: e.NODE_ENV,
    produccion,
    host: e.HOST,
    puerto: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    migrationDatabaseUrl: e.MIGRATION_DATABASE_URL ?? e.DATABASE_URL,
    sessionSecret: sessionSecret as string,
    publicUrl,
    origenesPermitidos: origenes,
    trustProxy,
    sesionAbsolutaSeg: e.SESSION_ABSOLUTE_HOURS * 3600,
    sesionInactividadSeg: e.SESSION_IDLE_HOURS * 3600,
    loginMaxIntentos: e.LOGIN_MAX_INTENTOS,
    loginBloqueoMin: e.LOGIN_BLOQUEO_MIN,
    resetTokenMin: e.RESET_TOKEN_MIN,
    rateLimitAuthMax: e.RATE_LIMIT_AUTH_MAX,
    rateLimitRecuperarMax: e.RATE_LIMIT_RECUPERAR_MAX,
    rateLimitVentanaSeg: e.RATE_LIMIT_WINDOW_S,
    correo: {
      transporte: e.MAIL_TRANSPORT,
      from: e.MAIL_FROM,
      smtp:
        e.MAIL_TRANSPORT === 'smtp'
          ? {
              host: e.SMTP_HOST as string,
              port: e.SMTP_PORT,
              secure: e.SMTP_SECURE,
              ...(e.SMTP_USER ? { user: e.SMTP_USER } : {}),
              ...(e.SMTP_PASS ? { pass: e.SMTP_PASS } : {}),
            }
          : null,
    },
  };
}

/** Resumen seguro para el log de arranque: sin secretos ni credenciales de URL. */
export function resumenSeguro(c: Config): Record<string, unknown> {
  let bd = 'invalida';
  try {
    const u = new URL(c.databaseUrl);
    bd = `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    /* sin detalles */
  }
  return {
    entorno: c.entorno,
    host: c.host,
    puerto: c.puerto,
    baseDatos: bd,
    publicUrl: c.publicUrl,
    trustProxy: c.trustProxy,
    correo: c.correo.transporte,
  };
}
