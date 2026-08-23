import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Integration tests share one PostgreSQL schema; running files in parallel
    // would let migrations race each other.
    fileParallelism: false,
  },
});
