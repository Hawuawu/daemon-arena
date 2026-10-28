import { build } from 'esbuild';

/** Bundle a TypeScript/JavaScript daemon entry (and its imports) into a single CommonJS core. */
export async function bundleCore(entry: string): Promise<string> {
  const out = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'neutral',
    target: 'es2020',
    legalComments: 'none',
    logLevel: 'silent',
    banner: { js: '// daemon-arena core bundle' },
  });
  return out.outputFiles[0].text;
}
