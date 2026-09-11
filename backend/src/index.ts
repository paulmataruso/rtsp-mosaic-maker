import { loadEnv } from './config/env.js';
import { getLogger } from './config/logger.js';
import { buildApp } from './app.js';
import { bootstrap } from './services/bootstrap.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const log = getLogger();
  process.env.TZ = env.TZ;

  const app = await buildApp();
  const runtime = await bootstrap();

  await app.listen({ port: env.PORT, host: env.HOST });
  log.info(`HTTP + WebSocket listening on http://${env.HOST}:${env.PORT}`);
  log.info(`API docs at http://${env.HOST}:${env.PORT}/docs`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal}; shutting down gracefully…`);
    const timer = setTimeout(() => {
      log.error('Graceful shutdown timed out; forcing exit.');
      process.exit(1);
    }, 20_000);
    try {
      await app.close();
      await runtime.shutdown();
      clearTimeout(timer);
      log.info('Shutdown complete.');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => void shutdown(sig));
  }
  process.on('unhandledRejection', (reason) => {
    log.error({ reason }, 'unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    log.error({ err }, 'uncaughtException');
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
