import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Check the production snapshot independently from the source tree. This catches
// missing copied assets and stale relative paths before a static upload.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const exists = async file => { try { await stat(file); return true; } catch { return false; } };
assert(await exists(path.join(dist, 'index.html')), 'dist/index.html is missing; run build-game first');

const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else files.push(file);
  }
}
await walk(dist);
const missing = new Set();
const addReference = (owner, raw, base = owner) => {
  const value = raw.trim().replace(/^['"]|['"]$/g, '');
  if (!value || value.startsWith('#') || value.startsWith('data:') || value.startsWith('http://') || value.startsWith('https://')) return;
  const withoutQuery = value.split(/[?#]/, 1)[0];
  if (!withoutQuery) return;
  const resolved = withoutQuery.startsWith('/')
    ? path.resolve(dist, `.${withoutQuery}`)
    : path.resolve(path.dirname(base), withoutQuery);
  const target = withoutQuery.endsWith('/') ? path.join(resolved, 'index.html') : resolved;
  if (!target.startsWith(dist + path.sep) || !existsSync(target)) missing.add(`${path.relative(dist, owner)} -> ${value}`);
};
const existsSync = file => { try { return statSync(file).isFile(); } catch { return false; } };

for (const file of files) {
  const ext = path.extname(file).toLowerCase();
  if (!['.html', '.css', '.js'].includes(ext)) continue;
  const text = await readFile(file, 'utf8');
  if (ext === '.html') {
    for (const match of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) addReference(file, match[1]);
  } else if (ext === '.css') {
    for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) addReference(file, match[1]);
  } else {
    // Static URL constructors are resolved relative to the module file.
    for (const match of text.matchAll(/new URL\(\s*["']((?:\.\.?\/)+assets\/[^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) addReference(file, match[1]);
    for (const match of text.matchAll(/(?:src|href)\s*[:=]\s*["'](assets\/[^"']+)["']/g)) addReference(file, match[1], path.join(dist, 'index.html'));
    for (const match of text.matchAll(/(?<![./])(assets\/[A-Za-z0-9_./-]+\.(?:png|jpg|svg|json))(?![A-Za-z0-9_])/g)) addReference(file, match[1], path.join(dist, 'index.html'));
  }
}
assert.equal(missing.size, 0, `Missing production references:\n${[...missing].join('\n')}`);
const required = ['index.html', 'assets/runtime-catalog.json', 'assets/ui/hud-icon-badges.png', 'src/main.js'];
for (const file of required) assert(await exists(path.join(dist, file)), `${file} is missing from production snapshot`);
console.log(JSON.stringify({ status: 'verified', directory: dist, files: files.length, missing: 0, required }));
