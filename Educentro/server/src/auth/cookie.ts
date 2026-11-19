import type { CookieSerializeOptions } from '@fastify/cookie';
import type { Config } from '../config.js';

/** Producción: __Host-edu_sid (exige Secure, Path=/, sin Domain). Desarrollo: edu_sid sin Secure. */
export const nombreCookie = (cfg: Config): string => (cfg.produccion ? '__Host-edu_sid' : 'edu_sid');

export function opcionesCookie(cfg: Config): CookieSerializeOptions {
  return { httpOnly: true, secure: cfg.produccion, sameSite: 'lax', path: '/', maxAge: cfg.sesionAbsolutaSeg };
}

export function opcionesBorrado(cfg: Config): CookieSerializeOptions {
  const { maxAge: _m, ...resto } = opcionesCookie(cfg);
  return resto;
}
