export const CLAVE_MIN = 10;
export const CLAVE_MAX = 128; // evita cargas abusivas al hash

// Lista corta de contraseñas muy comunes (en minúsculas, sin separadores). No sustituye a una lista grande.
const COMUNES = new Set([
  '1234567890', '12345678910', '123456789012', '0123456789', '1111111111', '0000000000', '1234512345',
  'password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd123', 'p@ssw0rd123',
  'contrasena', 'contrasena1', 'contrasena123', 'contrasena12', 'clave12345', 'clave123456', 'micontrasena',
  'qwertyuiop', 'qwerty1234', 'qwerty12345', 'qwerty123456', 'asdfghjkl', 'asdfghjkl1', 'zxcvbnm123',
  'iloveyou12', 'iloveyou123', 'letmein123', 'welcome123', 'welcome1234', 'admin12345', 'admin123456',
  'administrador', 'administrador1', 'educentro', 'educentro1', 'educentro12', 'educentro123', 'educentro2024',
  'educentro2025', 'educentro2026', 'escuela123', 'colegio123', 'estudiante1', 'estudiante123', 'profesor123',
  'docente123', 'maestro123', 'dominicana', 'republicadominicana', 'santodomingo', 'abcdefghij', 'abc1234567',
  'changeme123', 'cambiame123', 'cambiame', 'default123', 'test123456', 'prueba12345', 'monkey1234', 'dragon1234',
  'football123', 'baseball123', 'beisbol123', 'superman123', 'princesa123', 'princess123', 'sunshine123',
  'trustno1234', 'master12345', 'shadow12345', 'michael1234', 'jordan12345',
]);

const normalizar = (s: string) => s.toLowerCase().replace(/[\s._\-!@#$%^&*()]/g, '');

export interface ContextoClave {
  email?: string;
  nombre?: string;
}

/** Devuelve el motivo (en español) por el que la contraseña no es aceptable, o null si lo es. */
export function validarClave(clave: string, ctx: ContextoClave = {}): string | null {
  if (typeof clave !== 'string') return 'La contraseña no es válida.';
  if ([...clave].length < CLAVE_MIN) return `La contraseña debe tener al menos ${CLAVE_MIN} caracteres.`;
  if (clave.length > CLAVE_MAX) return `La contraseña no puede superar ${CLAVE_MAX} caracteres.`;
  const n = normalizar(clave);
  if (COMUNES.has(n)) return 'La contraseña es demasiado común. Elige otra.';
  if (/^(.)\1+$/.test(n)) return 'La contraseña no puede ser un solo carácter repetido.';
  if (new Set(n).size < 4) return 'La contraseña es demasiado simple. Elige otra.';
  const minus = clave.toLowerCase();
  if (ctx.email) {
    const email = ctx.email.toLowerCase();
    const local = email.split('@')[0] ?? '';
    if (minus.includes(email) || (local.length >= 4 && minus.includes(local))) {
      return 'La contraseña no puede contener tu correo electrónico.';
    }
  }
  return null;
}
