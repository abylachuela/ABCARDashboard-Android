import { buildApp, iniciarLimpieza } from './app.js';
import { cargarConfig, ConfigError, resumenSeguro } from './config.js';

async function main(): Promise<void> {
  let config;
  try {
    config = cargarConfig();
  } catch (e) {
    console.error(e instanceof ConfigError ? e.message : 'No se pudo cargar la configuración');
    process.exit(1);
  }
  const app = await buildApp(config);
  iniciarLimpieza(app);
  const parar = (senal: string) => {
    app.log.info({ senal }, 'cerrando');
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGTERM', () => parar('SIGTERM'));
  process.on('SIGINT', () => parar('SIGINT'));
  await app.listen({ host: config.host, port: config.puerto });
  app.log.info(resumenSeguro(config), 'EduCentro API iniciada');
}

main().catch((e: Error) => {
  console.error('Error al iniciar:', e.name);
  process.exit(1);
});
