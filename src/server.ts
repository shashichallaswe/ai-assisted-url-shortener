import { buildApp } from './app.js';
import { loadDotEnv, parseEnvOrExit } from './config/env.js';

loadDotEnv();

const env = parseEnvOrExit();
const app = await buildApp();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error, 'failed to start');
  process.exit(1);
}
