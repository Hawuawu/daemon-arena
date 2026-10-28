import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bundleCore } from '../src/runtime/bundle';

const root = path.resolve(import.meta.dirname, '..');
const srcDir = path.join(root, 'cores');
const outDir = path.join(srcDir, 'dist');

await mkdir(outDir, { recursive: true });
const entries = (await readdir(srcDir)).filter((f) => /\.(ts|js)$/.test(f));
for (const file of entries) {
  const code = await bundleCore(path.join(srcDir, file));
  const out = path.join(outDir, file.replace(/\.(ts|js)$/, '.core.js'));
  await writeFile(out, code);
}
console.log(`built ${entries.length} daemon cores -> ${path.relative(root, outDir)}`);
