// Parámetros de la base de datos de PRUEBAS (efímera, solo local/CI). Contraseñas ficticias de prueba.
export const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
export const DB_NOMBRE = 'educentro_test';
export const CLAVE_OWNER = 'owner_test_pw';
export const CLAVE_APP = 'app_test_pw';

const base = new URL(ADMIN_URL);
const url = (usuario: string, clave: string) =>
  `postgres://${usuario}:${clave}@${base.hostname}:${base.port || '5432'}/${DB_NOMBRE}`;
export const OWNER_URL = url('educentro_owner', CLAVE_OWNER);
export const APP_URL = url('educentro_app', CLAVE_APP);
