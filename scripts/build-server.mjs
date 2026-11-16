// Bundles server.ts (+ server/*, the src/agent modules it imports, and its npm dependencies) into one ESM file
// for the desktop app: dist-server/server.mjs runs on plain Node / Electron without tsx or node_modules.
// `npm run dev` / `npm start` are unchanged (tsx server.ts). Vite is only imported on the dev path, so it stays external.
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = resolve(root, 'dist-server');
rmSync(outdir, { recursive: true, force: true });

await build({
  entryPoints: [resolve(root, 'server.ts')],
  outfile: resolve(outdir, 'server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external: ['vite'],
  // Bundled CommonJS dependencies (express, …) still call require() for Node built-ins.
  banner: { js: "import { createRequire as __omniCreateRequire } from 'node:module'; const require = __omniCreateRequire(import.meta.url);" },
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  logLevel: 'info',
});
console.log(`Server bundle written to ${outdir}`);
