import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

/** Lee una línea del terminal sin mostrar lo que se escribe (contraseñas). Exige un TTY. */
export function preguntarOculto(pregunta: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return Promise.reject(new Error('No hay terminal interactivo: use la variable de entorno ADMIN_PASSWORD'));
  }
  let mudo = false;
  const salida = new Writable({
    write(chunk, _enc, cb) {
      if (!mudo) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output: salida, terminal: true });
  return new Promise((resolve) => {
    rl.question(pregunta, (respuesta) => {
      rl.close();
      process.stdout.write('\n');
      resolve(respuesta);
    });
    mudo = true;
  });
}

export function preguntar(pregunta: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(pregunta, (r) => { rl.close(); resolve(r); }));
}
