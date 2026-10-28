import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  server: { host: true, port: 5173 },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
} as never);
