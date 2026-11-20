import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/helpers/global-setup.ts'],
    fileParallelism: false, // una sola base de datos de pruebas compartida
    testTimeout: 20_000,
    hookTimeout: 60_000,
    pool: 'forks',
  },
});
