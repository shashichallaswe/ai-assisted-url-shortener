import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

/** Resolves to `<repo>/migrations` from both `src/db` and the built `dist/db`. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

const MIGRATION_FILENAME = /^(\d+)_[A-Za-z0-9_-]+\.sql$/;

/**
 * Reads migrations from disk in version order. Throws rather than guessing when
 * a filename is unparseable or two files claim the same version, because an
 * ambiguous apply order is a silent corruption waiting to happen.
 */
export function discoverMigrations(directory: string): Migration[] {
  const files = readdirSync(directory).filter((name) => name.endsWith('.sql'));
  const versions = new Map<number, string>();

  const migrations = files.map((name) => {
    const match = MIGRATION_FILENAME.exec(name);
    const rawVersion = match?.[1];

    if (rawVersion === undefined) {
      throw new Error(`Migration filename must look like <version>_<name>.sql, got: ${name}`);
    }

    const version = Number.parseInt(rawVersion, 10);
    const duplicate = versions.get(version);

    if (duplicate !== undefined) {
      throw new Error(`Two migrations share version ${rawVersion}: ${duplicate} and ${name}`);
    }

    versions.set(version, name);
    const sql = readFileSync(join(directory, name), 'utf8');

    return {
      version,
      name,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    };
  });

  return migrations.sort((left, right) => left.version - right.version);
}
