import { calcularAnclas } from '../repo/anclas.js';
import { argumento, cargarConfigCli, poolDe } from './comun.js';

// Imprime el hash final de la cadena de auditoría de cada centro y la fecha, para guardarlo FUERA de la VM
// (otro equipo, correo a un responsable, repositorio aparte…). Verifica la cadena antes: si está alterada no ancla (sale con 2).
// Uso: npm run anclar-auditoria [-- --centro <id>] [--json]     (en la imagen: node dist/cli/anclar-auditoria.js)
async function main(): Promise<void> {
  const cfg = cargarConfigCli();
  const pool = poolDe(cfg.databaseUrl);
  try {
    const anclas = await calcularAnclas(pool, argumento('centro'));
    const mala = anclas.filter((a) => !a.ok);
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({ generadoEn: new Date().toISOString(), anclas }, null, 2));
    } else {
      console.log(`# EduCentro · ancla de la auditoría · ${new Date().toISOString()}`);
      console.log('# centro\tseq\thash(SHA-256)\tregistros\testado');
      for (const a of anclas) console.log(`${a.centroId}\t${a.seq}\t${a.hash}\t${a.registros}\t${a.ok ? 'verificada' : 'ALTERADA'}`);
      console.log('# Guarda estas líneas fuera de la VM. Para comprobarlas: GET /api/v1/auditoria/verificar?centroId=…&anclaSeq=…&anclaHash=…');
    }
    if (mala.length) {
      console.error(`ATENCIÓN: la cadena de ${mala.map((a) => a.centroId).join(', ')} NO verifica (alterada). Revisa GET /auditoria/verificar y restaura desde una copia.`);
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
