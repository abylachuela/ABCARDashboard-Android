import { describe, expect, it } from 'vitest';
import { cargarPermisosDelCliente, compararPermisos, leerJsonServidor } from '../scripts/paridad.js';
import { COLECCIONES } from '../src/domain/colecciones.js';
import { ESCRIBE, MATRIZ } from '../src/domain/permisos.js';

describe('paridad de permisos (permisos.js ↔ permisos.json)', () => {
  const cliente = cargarPermisosDelCliente();

  it('MATRIZ, ESCRIBE, ROLES, NAV y COLECCIONES coinciden', () => {
    expect(compararPermisos(cliente, leerJsonServidor())).toEqual([]);
  });

  it('detecta una divergencia en MATRIZ y en ESCRIBE', () => {
    const roto = structuredClone(leerJsonServidor());
    roto.MATRIZ.tutor!.libroFalso = ['ver'];
    roto.ESCRIBE.estudiante!.push('usuarios');
    const dif = compararPermisos(cliente, roto);
    expect(dif.some((d) => d.startsWith('MATRIZ[tutor][libroFalso]'))).toBe(true);
    expect(dif.some((d) => d.startsWith('ESCRIBE[estudiante]'))).toBe(true);
  });

  it('el módulo del servidor usa exactamente el JSON y el registro cubre las colecciones del cliente', () => {
    expect(MATRIZ).toEqual(leerJsonServidor().MATRIZ);
    expect(ESCRIBE).toEqual(leerJsonServidor().ESCRIBE);
    expect(COLECCIONES.length).toBe(cliente.COLECCIONES.length);
    expect([...COLECCIONES].sort()).toEqual([...cliente.COLECCIONES].sort());
  });
});
