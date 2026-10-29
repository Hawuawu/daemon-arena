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
      // Engine, runtimes and the worker coordinator are unit-tested; the canvas UI is covered by browser smoke tests.
      include: ['src/**/*.ts'],
      exclude: ['src/web/main.ts', 'src/web/renderer.ts', 'src/web/docs.ts', 'src/web/sim.worker.ts', 'src/web/protocol.ts', 'src/api.ts', 'src/**/types.ts'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 85 },
    },
  },
} as never);
