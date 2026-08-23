import { z } from 'zod';

const httpUrl = z
  .url()
  .refine((value) => /^https?:$/.test(new URL(value).protocol), {
    message: 'must be an http or https URL',
  });

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  /** Short links are built from this, never from attacker-controlled request headers. */
  BASE_URL: httpUrl,
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Loads a local `.env` if one exists. Uses Node's built-in loader rather than a
 * dependency; a missing file is normal in CI and in a container.
 */
export function loadDotEnv(path = '.env'): void {
  try {
    process.loadEnvFile(path);
  } catch {
    // No .env on disk. Real environments supply variables directly.
  }
}

/**
 * Validates the environment and throws naming every offending variable, so a
 * misconfigured deployment fails at startup rather than on first request.
 */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');

    throw new Error(`Invalid environment: ${detail}`);
  }

  return result.data;
}

/**
 * Entry-point wrapper: a misconfigured process should print one readable line
 * and exit, not a stack trace that buries which variable is wrong.
 */
export function parseEnvOrExit(source: Record<string, string | undefined> = process.env): Env {
  try {
    return parseEnv(source);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
