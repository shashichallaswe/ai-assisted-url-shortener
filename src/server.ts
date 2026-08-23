import { buildApp } from './app.js';
import { loadDotEnv, parseEnvOrExit } from './config/env.js';
import { createPool } from './db/pool.js';
import { ensureDemoApiKey } from './db/seed-api-key.js';

loadDotEnv();

const env = parseEnvOrExit();
const pool = createPool(env.DATABASE_URL);
const app = await buildApp({ pool, baseUrl: env.BASE_URL });

if (env.API_KEY !== undefined) {
  await ensureDemoApiKey(pool, env.API_KEY, app.log);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(
      async () => {
        await pool.end();
        process.exit(0);
      },
      async () => {
        await pool.end();
        process.exit(1);
      },
    );
  });
}

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error, 'failed to start');
  await pool.end();
  process.exit(1);
}
