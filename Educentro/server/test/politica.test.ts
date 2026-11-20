import { describe, expect, it } from 'vitest';
import { hashClave, verificarClave } from '../src/auth/password.js';
import { validarClave } from '../src/auth/politica.js';

describe('política de contraseñas', () => {
  it('exige al menos 10 caracteres', () => {
    expect(validarClave('Corta1!x')).toMatch(/al menos 10/);
    expect(validarClave('Larga-y-segura-9')).toBeNull();
  });
  it('rechaza contraseñas comunes aunque cumplan la longitud', () => {
    expect(validarClave('password123')).toMatch(/común/);
    expect(validarClave('1234567890')).toMatch(/común/);
    expect(validarClave('Educentro-123')).toMatch(/común/); // se normaliza (sin guiones)
    expect(validarClave('Café-Montaña-81')).toBeNull();
  });
  it('rechaza repeticiones y claves simples', () => {
    expect(validarClave('aaaaaaaaaaaa')).toBeTruthy();
    expect(validarClave('abababababab')).toMatch(/simple/);
  });
  it('rechaza claves que contienen el correo o su parte local', () => {
    expect(validarClave('xx-maria.lopez@escuela.test-xx', { email: 'maria.lopez@escuela.test' })).toMatch(/correo/);
    expect(validarClave('MARIA.LOPEZ-2025!', { email: 'maria.lopez@escuela.test' })).toMatch(/correo/);
    expect(validarClave('Otra-clave-fuerte-7', { email: 'maria.lopez@escuela.test' })).toBeNull();
  });
  it('limita la longitud máxima', () => {
    expect(validarClave('a1'.repeat(70))).toMatch(/superar/);
  });
});

describe('argon2id', () => {
  it('genera hashes argon2id con parámetros OWASP y verifica', async () => {
    const h = await hashClave('Una-clave-valida-55');
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verificarClave(h, 'Una-clave-valida-55')).toBe(true);
    expect(await verificarClave(h, 'otra')).toBe(false);
    expect(await verificarClave('no-es-un-hash', 'x')).toBe(false);
  });
});
