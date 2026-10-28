// Serves dist/ with the exact headers from firebase.json (CSP etc.), for local checks and the DAST scan.
import { existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const port = Number(process.env.PORT ?? 4173);
const { headers } = JSON.parse(readFileSync(path.join(root, 'firebase.json'), 'utf8')).hosting;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const glob = (pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/(?<!\.)\*/g, '[^/]*')}$`);

http
  .createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.resolve(dist, `.${url}`);
    const rel = path.relative(dist, file);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return res.writeHead(400).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!existsSync(file)) return res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    for (const rule of headers) if (rule.source === '**' || glob(rule.source).test(url)) for (const h of rule.headers) res.setHeader(h.key, h.value);
    res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  })
  .listen(port, () => console.log(`dist/ with production headers on http://localhost:${port}`));
