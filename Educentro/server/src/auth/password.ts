import { hash, verify } from '@node-rs/argon2';

// Argon2id con los parámetros mínimos recomendados por OWASP: m=19 MiB, t=2, p=1.
const OPCIONES = { memoryCost: 19456, timeCost: 2, parallelismDegree: 1 } as const;

export function hashClave(clave: string): Promise<string> {
  return hash(clave, OPCIONES);
}

export async function verificarClave(hashAlmacenado: string, clave: string): Promise<boolean> {
  try {
    return await verify(hashAlmacenado, clave);
  } catch {
    return false;
  }
}

let ficticio: Promise<string> | null = null;
/** Hash ficticio con los mismos parámetros: se verifica cuando el usuario no existe para igualar tiempos. */
export function hashFicticio(): Promise<string> {
  ficticio ??= hashClave('ficticio-' + Math.random().toString(36));
  return ficticio;
}
