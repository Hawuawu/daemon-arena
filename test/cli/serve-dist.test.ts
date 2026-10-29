/** The production-like static server used for local checks and the ZAP DAST scan. */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT } from '../support/fixtures';

let server: ChildProcess;
let base = '';

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve-dist.mjs')], { env: { ...process.env, PORT: String(port) } });
  await new Promise((resolve) => server.stdout!.once('data', resolve));
});
afterAll(() => server?.kill());

describe('serve-dist', () => {
  it.each(['/..%2fpackage.json', '/..%2f..%2fetc%2fpasswd', '/assets/..%2f..%2ffirebase.json'])('refuses path traversal %s', async (p) => {
    expect((await fetch(base + p)).status).toBe(400);
  });

  it('answers 404 for missing files', async () => {
    expect((await fetch(`${base}/does-not-exist.txt`)).status).toBe(404);
  });

  it.skipIf(!existsSync(path.join(ROOT, 'dist', 'index.html')))('serves the build with the firebase.json security headers', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });
});
