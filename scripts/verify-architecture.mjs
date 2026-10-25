import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFile(path.join(root, relative), 'utf8');
const exists = async relative => { try { await fs.access(path.join(root, relative)); return true; } catch { return false; } };

for (const directory of ['src/core', 'src/game', 'src/render', 'src/ui', 'assets', 'scripts', 'docs']) {
  assert.equal(await exists(directory), true, `required directory exists: ${directory}`);
}
assert.equal(await exists('src/render/scene-renderer.mjs'), true, 'scene renderer lives in render layer');
assert.equal(await exists('src/game/renderer.mjs'), true, 'legacy renderer facade is preserved');
assert.equal(await exists('src/ui/styles.css'), true, 'single runtime stylesheet entry exists');

const renderer = await read('src/game/renderer.mjs');
assert.match(renderer, /export \{ GameRenderer \} from ['"]\.\.\/render\/scene-renderer\.mjs['"]/);
const main = await read('src/main.mjs');
assert.match(main, /from ['"]\.\/render\/scene-renderer\.mjs['"]/);
const html = await read('index.html');
assert.match(html, /href="src\/ui\/styles\.css"/);
assert.doesNotMatch(html, /href="src\/ui\/(?:game|ui-v3|ui-polish|ui-icon-polish)\.css"/);
const styles = await read('src/ui/styles.css');
for (const name of ['game.css', 'ui-v3.css', 'ui-polish.css', 'ui-icon-polish.css']) assert.match(styles, new RegExp(`@import url\\("\\./${name.replace('.', '\\.') }"\\)`));

console.log('Architecture verification: passed');
