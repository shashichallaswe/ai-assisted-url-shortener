import { buildApp } from './app.js';
import { RedisUrlCache, createRedis } from './cache/redis-url-cache.js';
import { loadDotEnv, parseEnvOrExit } from './config/env.js';
import { createPool } from './db/pool.js';
import { ensureDemoApiKey } from './db/seed-api-key.js';

loadDotEnv();

const env = parseEnvOrExit();
const pool = createPool(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
let warnRedis: (error: unknown, message: string) => void = () => undefined;
const cache = new RedisUrlCache(redis, (error) => {
  warnRedis(error, 'redis cache error; falling back to postgres');
});
const app = await buildApp({ pool, baseUrl: env.BASE_URL, cache });
warnRedis = (error, message) => {
  app.log.warn({ err: error }, message);
};
void redis.connect().catch((error: unknown) => {
  warnRedis(error, 'redis connect failed; redirects will use postgres');
});

if (env.API_KEY !== undefined) {
  await ensureDemoApiKey(pool, env.API_KEY, app.log);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(
      async () => {
        await redis.quit().catch(() => undefined);
        await pool.end();
        process.exit(0);
      },
      async () => {
        await redis.quit().catch(() => undefined);
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
  await redis.quit().catch(() => undefined);
  await pool.end();
  process.exit(1);
}
