import { loadDotEnv, parseEnvOrExit } from '../config/env.js';
import { describeError } from '../lib/errors/describe.js';
import { migrate } from './migrate.js';
import { createPool } from './pool.js';

loadDotEnv();

const env = parseEnvOrExit();
const pool = createPool(env.DATABASE_URL);

try {
  const applied = await migrate(pool);

  process.stdout.write(
    applied.length === 0
      ? 'Schema is up to date; nothing to apply.\n'
      : `Applied ${String(applied.length)} migration(s):\n${applied.map((name) => `  ${name}`).join('\n')}\n`,
  );
} catch (error) {
  process.stderr.write(`Migration failed: ${describeError(error)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
