import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const nuevoToken = (): string => randomBytes(32).toString('base64url'); // 256 bits
export const hashToken = (t: string): string => createHash('sha256').update(t).digest('hex');

/** Token CSRF ligado a la sesión: HMAC(SESSION_SECRET, id de sesión). No se puede forjar sin el secreto. */
export function csrfDe(secreto: string, sesionId: string): string {
  return createHmac('sha256', secreto).update('csrf:' + sesionId).digest('base64url');
}

export function igualesSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
