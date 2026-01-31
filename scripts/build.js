import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

// Ensure dist directory exists
const distDir = path.resolve('dist');
fs.mkdirSync(distDir, { recursive: true });

// Build with esbuild
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: 'dist/index.js',
  minify: true,
});

console.log('Build complete!');
console.log(`  dist/index.js (${fs.statSync('dist/index.js').size} bytes)`);
