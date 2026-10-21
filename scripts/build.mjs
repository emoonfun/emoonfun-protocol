import { mkdir, rm, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { render } from './render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = ['lib', 'fx', 'market', 'main'];
const ASSETS = ['logo-512.png', 'logo-192.png', 'favicon.svg'];

// minimal bundler: drop single-line imports and `export` keywords, wrap in one scope
function bundle(sources) {
  const body = sources
    .map((s) => s.replace(/^import\s[^;]*;\s*$/gm, '').replace(/^export\s+(async\s+function|function|const|let)/gm, '$1'))
    .join('\n');
  return '(function () {\n"use strict";\n' + body + '\n})();\n';
}

const sha = async (p) => createHash('sha256').update(await readFile(p)).digest('hex');

export async function build({ records, outDir }) {
  await rm(outDir, { recursive: true, force: true });
  for (const d of ['css', 'js', 'assets']) await mkdir(join(outDir, d), { recursive: true });

  const html = render(records);
  await writeFile(join(outDir, 'index.html'), html);
  await copyFile(join(ROOT, 'src', 'tokens.css'), join(outDir, 'css', 'tokens.css'));
  await copyFile(join(ROOT, 'src', 'styles.css'), join(outDir, 'css', 'styles.css'));

  const srcs = [];
  for (const m of MODULES) srcs.push(await readFile(join(ROOT, 'src', 'js', m + '.mjs'), 'utf8'));
  await writeFile(join(outDir, 'js', 'app.js'), bundle(srcs));

  // assets are copied explicitly, never implicitly
  for (const a of ASSETS) await copyFile(join(ROOT, 'src', 'assets', a), join(outDir, 'assets', a));

  // verify: every asset landed byte-identical and index.html points at it with a relative path
  for (const a of ASSETS) {
    const from = join(ROOT, 'src', 'assets', a);
    const to = join(outDir, 'assets', a);
    if ((await sha(from)) !== (await sha(to))) throw new Error('asset mismatch: ' + a);
    if (!(await stat(to)).size) throw new Error('empty asset: ' + a);
  }
  for (const ref of ['assets/logo-512.png', 'assets/logo-192.png', 'assets/favicon.svg']) {
    if (!html.includes('"' + ref + '"')) throw new Error('index.html does not reference ' + ref);
    await stat(join(outDir, ref));
  }
  return { outDir };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const records = JSON.parse(await readFile(join(ROOT, 'src', 'register.json'), 'utf8')).records;
  await build({ records, outDir: join(ROOT, 'dist') });
  console.log('build ok -> dist/');
}
