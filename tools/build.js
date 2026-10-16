// Builds the browser client into dist/.
//   node tools/build.js           -> dist/index.html + dist/game.js + dist/style.css
//   node tools/build.js --single  -> also dist/hollow-stars.html (one self-contained file)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(DIST, { recursive: true });
const dev = process.argv.includes('--dev');

const result = await build({
  entryPoints: [path.join(ROOT, 'client/main.js')],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  outfile: path.join(DIST, 'game.js'),
  legalComments: 'none',
  logLevel: 'warning',
  metafile: true,
});
fs.copyFileSync(path.join(ROOT, 'client/index.html'), path.join(DIST, 'index.html'));
fs.copyFileSync(path.join(ROOT, 'client/style.css'), path.join(DIST, 'style.css'));
const kb = (fs.statSync(path.join(DIST, 'game.js')).size / 1024).toFixed(0);
console.log(`Built dist/game.js (${kb} KB)`);

if (process.argv.includes('--single')) {
  let html = fs.readFileSync(path.join(ROOT, 'client/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'client/style.css'), 'utf8');
  const js = fs.readFileSync(path.join(DIST, 'game.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  html = html.replace('<link rel="stylesheet" href="style.css" />', () => `<style>\n${css}\n</style>`);
  html = html.replace('<script type="module" src="game.js"></script>', () => `<script type="module">\n${js}\n</script>`);
  fs.writeFileSync(path.join(DIST, 'hollow-stars.html'), html);
  console.log(`Built dist/hollow-stars.html (${(html.length / 1024).toFixed(0)} KB)`);
  // Fragment for hosts that supply their own document skeleton (e.g. a published Claude artifact)
  const frag = html
    .replace(/<!doctype html>\s*/i, '')
    .replace(/<\/?html[^>]*>\s*/gi, '')
    .replace(/<\/?head>\s*/gi, '')
    .replace(/<\/?body>\s*/gi, '')
    .replace(/<meta charset="utf-8" \/>\s*/i, '')
    .replace(/<meta name="viewport"[^>]*>\s*/i, '')
    .replace('<style>', '<style>\n:root { color-scheme: dark; }');
  fs.writeFileSync(path.join(DIST, 'artifact.html'), frag);
  console.log(`Built dist/artifact.html (${(frag.length / 1024).toFixed(0)} KB)`);
}
