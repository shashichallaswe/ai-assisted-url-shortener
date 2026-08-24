import { ClickCapture } from './analytics/click-capture.js';
import { buildApp } from './app.js';
import { RedisClickCounters } from './cache/redis-click-counters.js';
import { RedisRateLimiter } from './cache/redis-rate-limiter.js';
import { RedisUrlCache, createRedis } from './cache/redis-url-cache.js';
import { loadDotEnv, parseEnvOrExit } from './config/env.js';
import { createPool } from './db/pool.js';
import { ensureDemoApiKey } from './db/seed-api-key.js';
import { insertClickEvents } from './repos/click-events.js';

loadDotEnv();

const env = parseEnvOrExit();
const pool = createPool(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
let warnBackground: (error: unknown, message: string) => void = () => undefined;
const cache = new RedisUrlCache(redis, (error) => {
  warnBackground(error, 'redis cache error; falling back to postgres');
});
const clicks = new ClickCapture({
  salt: env.CLICK_IP_SALT,
  clock: () => new Date(),
  counters: new RedisClickCounters(redis, (error) => {
    warnBackground(error, 'click counter failed');
  }),
  insert: (rows) => insertClickEvents(pool, rows),
  onError: (error) => {
    warnBackground(error, 'click capture failed');
  },
});
const rateLimiter = new RedisRateLimiter(redis, (error) => {
  warnBackground(error, 'rate limiter redis error; failing open');
});
const app = await buildApp({
  pool,
  baseUrl: env.BASE_URL,
  cache,
  clicks,
  rateLimiter,
  rateLimits: {
    createMax: env.RATE_LIMIT_CREATE_MAX,
    createWindowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
    redirectMax: env.RATE_LIMIT_REDIRECT_MAX,
    redirectWindowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
    ipPepper: env.CLICK_IP_SALT,
  },
});
warnBackground = (error, message) => {
  app.log.warn({ err: error }, message);
};
void redis.connect().catch((error: unknown) => {
  warnBackground(error, 'redis connect failed; redirects will use postgres');
});

if (env.API_KEY !== undefined) {
  await ensureDemoApiKey(pool, env.API_KEY, app.log);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(
      async () => {
        await clicks.flush();
        await redis.quit().catch(() => undefined);
        await pool.end();
        process.exit(0);
      },
      async () => {
        await clicks.flush();
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
  await clicks.flush();
  await redis.quit().catch(() => undefined);
  await pool.end();
  process.exit(1);
}
