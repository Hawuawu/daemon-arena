import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  server: { host: true, port: 5173 },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // The engine and core runtimes are unit-tested; src/web (canvas UI, workers) is covered by browser smoke tests.
      include: ['src/**/*.ts'],
      exclude: ['src/web/**', 'src/api.ts', 'src/**/types.ts'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { lines: 90, statements: 90, functions: 95, branches: 75 },
    },
  },
} as never);
