import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cargarConfig, ConfigError, resumenSeguro } from '../src/config.js';
import { MailerConsola } from '../src/auth/mailer.js';

const SECRETO = 'x'.repeat(40);
const PROD = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://educentro_app:CLAVE_SECRETA_BD@db:5432/educentro',
  SESSION_SECRET: SECRETO,
  PUBLIC_URL: 'https://notas.ejemplo.edu',
  MAIL_TRANSPORT: 'smtp',
  SMTP_HOST: 'smtp.ejemplo.invalid',
};

describe('configuración', () => {
  it('acepta una configuración de producción completa', () => {
    const c = cargarConfig(PROD);
    expect(c.produccion).toBe(true);
    expect(c.sesionAbsolutaSeg).toBe(12 * 3600);
    expect(c.sesionInactividadSeg).toBe(2 * 3600);
  });

  it.each([
    ['SESSION_SECRET', { SESSION_SECRET: undefined }],
    ['SESSION_SECRET', { SESSION_SECRET: 'corto' }],
    ['DATABASE_URL', { DATABASE_URL: undefined }],
    ['PUBLIC_URL', { PUBLIC_URL: undefined }],
    ['PUBLIC_URL', { PUBLIC_URL: 'http://inseguro.edu' }],
    ['MAIL_TRANSPORT', { MAIL_TRANSPORT: 'consola' }],
  ])('falla en producción si falta o es inválida %s', (nombre, cambio) => {
    expect(() => cargarConfig({ ...PROD, ...cambio })).toThrow(ConfigError);
    try {
      cargarConfig({ ...PROD, ...cambio });
    } catch (e) {
      expect((e as Error).message).toContain(nombre);
      // Nunca vuelca valores de secretos en el mensaje.
      expect((e as Error).message).not.toContain('CLAVE_SECRETA_BD');
      expect((e as Error).message).not.toContain(SECRETO);
    }
  });

  it('fuera de producción no hay secreto por defecto: se genera uno efímero distinto cada vez', () => {
    const env = { NODE_ENV: 'development', DATABASE_URL: PROD.DATABASE_URL };
    const a = cargarConfig(env).sessionSecret;
    const b = cargarConfig(env).sessionSecret;
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(b);
  });

  it('DATABASE_URL es obligatoria siempre (sin credenciales por defecto)', () => {
    expect(() => cargarConfig({ NODE_ENV: 'development' })).toThrow(/DATABASE_URL/);
  });

  it('lee secretos desde archivos (NOMBRE_FILE)', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'edu-sec-'));
    const f = path.join(dir, 'secreto');
    writeFileSync(f, SECRETO + '\n');
    const { SESSION_SECRET: _omitido, ...resto } = PROD;
    expect(cargarConfig({ ...resto, SESSION_SECRET_FILE: f }).sessionSecret).toBe(SECRETO);
    expect(() => cargarConfig({ ...resto, SESSION_SECRET_FILE: path.join(dir, 'no-existe') })).toThrow(/SESSION_SECRET_FILE/);
  });

  it('el resumen de arranque no incluye secretos ni credenciales', () => {
    const txt = JSON.stringify(resumenSeguro(cargarConfig(PROD)));
    expect(txt).not.toContain('CLAVE_SECRETA_BD');
    expect(txt).not.toContain(SECRETO);
    expect(txt).not.toContain('educentro_app');
  });

  it('TRUST_PROXY admite booleano, saltos y CIDR', () => {
    const base = { NODE_ENV: 'test', DATABASE_URL: PROD.DATABASE_URL };
    expect(cargarConfig({ ...base, TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(cargarConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(cargarConfig({ ...base, TRUST_PROXY: '127.0.0.1, 10.0.0.0/8' }).trustProxy).toEqual(['127.0.0.1', '10.0.0.0/8']);
    expect(() => cargarConfig({ ...base, TRUST_PROXY: 'cualquiera!' })).toThrow(/TRUST_PROXY/);
  });
});

describe('mailer consola', () => {
  it('no puede crearse en producción', () => {
    expect(() => new MailerConsola(true)).toThrow(/producción/);
    expect(() => new MailerConsola(false)).not.toThrow();
  });
});
