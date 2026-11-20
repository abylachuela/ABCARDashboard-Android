import { randomUUID } from 'node:crypto';
import { hashClave } from '../auth/password.js';
import { validarClave } from '../auth/politica.js';
import { argumento, cargarConfigCli, poolDe } from './comun.js';
import { preguntar, preguntarOculto } from './prompt.js';

// Uso: npm run crear-admin -- --email admin@dominio --nombre "Nombre"
// Contraseña: prompt oculto, o variable de entorno puntual ADMIN_PASSWORD (no la dejes en .env ni en el historial).
async function main(): Promise<void> {
  const cfg = cargarConfigCli();
  const email = (argumento('email') ?? (await preguntar('Correo del administrador: '))).trim().toLowerCase();
  const nombre = (argumento('nombre') ?? (await preguntar('Nombre: '))).trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) throw new Error('Correo inválido.');
  if (!nombre || nombre.length > 200) throw new Error('Nombre inválido.');

  let clave = process.env.ADMIN_PASSWORD;
  if (!clave) {
    clave = await preguntarOculto('Contraseña (oculta): ');
    const otra = await preguntarOculto('Repite la contraseña: ');
    if (clave !== otra) throw new Error('Las contraseñas no coinciden.');
  }
  const motivo = validarClave(clave, { email, nombre });
  if (motivo) throw new Error(motivo);

  const pool = poolDe(cfg.databaseUrl);
  try {
    const hash = await hashClave(clave);
    const id = `usr_${randomUUID()}`;
    await pool.query(
      `INSERT INTO usuarios (id, centro_id, rol, nombre, email, hash, debe_cambiar_clave)
       VALUES ($1, NULL, 'admin_red', $2, $3, $4, false)`,
      [id, nombre, email, hash],
    );
    console.log(`Administrador de red creado: ${email} (${id})`);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new Error('Ya existe un usuario con ese correo.');
    throw e;
  } finally {
    await pool.end();
  }
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
