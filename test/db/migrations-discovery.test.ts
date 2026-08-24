import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverMigrations } from '../../src/db/migrations.js';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'migrations-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function write(name: string, sql: string): void {
  writeFileSync(join(directory, name), sql, 'utf8');
}

describe('discoverMigrations', () => {
  it('orders migrations by version, not by directory order', () => {
    write('0010_tenth.sql', 'select 10;');
    write('0002_second.sql', 'select 2;');
    write('0001_first.sql', 'select 1;');

    expect(discoverMigrations(directory).map((m) => m.name)).toStrictEqual([
      '0001_first.sql',
      '0002_second.sql',
      '0010_tenth.sql',
    ]);
  });

  it('ignores files that are not SQL', () => {
    write('0001_first.sql', 'select 1;');
    write('README.md', 'not a migration');
    write('0002_second.sql.bak', 'select 2;');

    expect(discoverMigrations(directory).map((m) => m.name)).toStrictEqual(['0001_first.sql']);
  });

  it('checksums content so an edited migration can be detected later', () => {
    write('0001_first.sql', 'select 1;');
    const first = discoverMigrations(directory)[0]?.checksum;

    write('0001_first.sql', 'select 2;');
    const second = discoverMigrations(directory)[0]?.checksum;

    expect(first).toBeTypeOf('string');
    expect(first).not.toBe(second);
  });

  it('produces the same checksum for the same content', () => {
    write('0001_first.sql', 'select 1;');

    expect(discoverMigrations(directory)[0]?.checksum).toBe(
      discoverMigrations(directory)[0]?.checksum,
    );
  });

  it('rejects two migrations sharing a version, which would make order ambiguous', () => {
    write('0001_first.sql', 'select 1;');
    write('0001_also_first.sql', 'select 2;');

    expect(() => discoverMigrations(directory)).toThrow(/0001/);
  });

  it('rejects a filename without a numeric version prefix', () => {
    write('initial.sql', 'select 1;');

    expect(() => discoverMigrations(directory)).toThrow(/initial\.sql/);
  });

  it('fails loudly when the migrations directory is missing', () => {
    expect(() => discoverMigrations(join(directory, 'nope'))).toThrow();
  });
});
