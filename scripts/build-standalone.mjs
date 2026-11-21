/**
 * Build a directly-openable release.
 *
 * Two artifacts are produced from the same source snapshot:
 *   release/index.html            one HTML + an assets/ folder (all art/audio)
 *   release/鲸鱼魔盗团.html        one self-contained HTML (art/audio as data URIs)
 *
 * Both inline the runtime catalog, so a plain double-click works without a
 * server. The folder build keeps audio on disk (browsers block fetch() under
 * file://, so those files fall back to the procedural synth when opened that
 * way); the single file embeds audio as data URIs and keeps voice/music.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const release = path.join(root, 'release');
const bundlePath = path.join(release, 'game.bundle.js');
const CSS_ORDER = ['game.css', 'ui-v3.css', 'ui-polish.css', 'ui-icon-polish.css', 'visual-direction.css', 'component-art.css', 'story-layout.css', 'player-polish.css'];
const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };

await fs.mkdir(release, { recursive: true });
execFileSync(process.execPath, [path.join(root, 'scripts/build-game.mjs')], { cwd: root, stdio: 'inherit' });

execSync(`npx --yes esbuild src/main.mjs --bundle --format=iife --target=es2020 --minify --outfile="${bundlePath}" --log-level=warning`, { cwd: root, stdio: 'inherit' });
const js = (await fs.readFile(bundlePath, 'utf8')).replaceAll('</script', '<\\/script');

let css = '';
for (const file of CSS_ORDER) css += `\n/* ${file} */\n` + await fs.readFile(path.join(root, 'src/ui', file), 'utf8');
const cssFolder = css.replaceAll('../../assets/', 'assets/');

async function walk(dir, prefix = '') {
  const rows = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name), rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) rows.push(...await walk(full, rel));
    else rows.push({ full, rel, ext: path.extname(entry.name).toLowerCase() });
  }
  return rows;
}
const files = await walk(path.join(dist, 'assets'));

// ---- Publish slimming ----------------------------------------------------
// Re-encode catalog art/audio for the self-contained file. Sprite-sheet
// dimensions are preserved because frame coordinates in the catalog depend on
// them; only full-bleed story/background/foreground art is resized to the
// 1280x720 design width. Audio is downsampled per category. ffmpeg is required
// so the result is reproducible from source instead of hand-edited output.
const slimRoot = path.join(dist, '.slim');
const hasFfmpeg = (() => {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
if (!hasFfmpeg) throw new Error('ffmpeg not found on PATH; it is required to slim the single-file release.');
const WEBP_ARGS = ['-c:v', 'libwebp', '-lossless', '0', '-quality', '74', '-compression_level', '6'];
const AUDIO_ARGS = {
  music: ['-c:a', 'libmp3lame', '-b:a', '64k', '-ar', '32000', '-ac', '2'],
  ambience: ['-c:a', 'libmp3lame', '-b:a', '48k', '-ar', '32000', '-ac', '1'],
  voice: ['-c:a', 'libmp3lame', '-b:a', '32k', '-ar', '24000', '-ac', '1'],
  sfx: ['-c:a', 'libmp3lame', '-b:a', '48k', '-ar', '32000', '-ac', '1'],
};
const RESIZE_GROUPS = new Set(['story', 'backgrounds', 'foreground']);
async function slimAsset(file) {
  const target = path.join(slimRoot, file.rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const parts = file.rel.split('/');
  const group = parts[0];
  const audioGroup = group === 'audio' ? parts[1] : null;
  let args = null;
  if (file.ext === '.webp') args = [...(RESIZE_GROUPS.has(group) ? ['-vf', 'scale=1280:-1:flags=lanczos'] : []), ...WEBP_ARGS];
  else if (file.ext === '.mp3' && AUDIO_ARGS[audioGroup]) args = AUDIO_ARGS[audioGroup];
  if (!args) { await fs.copyFile(file.full, target); return; }
  try {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', file.full, ...args, target], { stdio: ['ignore', 'ignore', 'pipe'] });
    // Never publish an encode that grew (tiny SFX can).
    if ((await fs.stat(target)).size >= (await fs.stat(file.full)).size) await fs.copyFile(file.full, target);
  } catch {
    await fs.copyFile(file.full, target);
  }
}
await fs.mkdir(slimRoot, { recursive: true });
for (const file of files) await slimAsset(file);
const inlineFiles = await walk(slimRoot);
const assetData = {};
for (const file of inlineFiles) {
  const mime = MIME[file.ext];
  if (!mime) continue;
  assetData['assets/' + file.rel] = `data:${mime};base64,${(await fs.readFile(file.full)).toString('base64')}`;
}
// Deduplicate CSS art: several sheets reference the same backdrop dozens of
// times. One custom property per unique file keeps the single HTML bounded.
// The properties are injected at runtime from the asset map, so the base64
// payload exists once in the document instead of once in JS and once in CSS.
const cssAssets = new Map();
let cssAssetIndex = 0;
const cssSingleBody = css.replace(/url\((['"]?)\.\.\/\.\.\/(assets\/[^)'"]+)\1\)/g, (match, quote, rel) => {
  if (!cssAssets.has(rel)) cssAssets.set(rel, `--asset-${cssAssetIndex++}`);
  return `var(${cssAssets.get(rel)})`;
});
const cssSingle = cssSingleBody;
const cssSingleKeys = [...cssAssets.keys()];
const catalog = (await fs.readFile(path.join(root, 'assets/runtime-catalog.json'), 'utf8')).replaceAll('</script', '<\\/script');
const catalogScript = `<script>globalThis.__CATALOG__=${catalog};</script>`;
const emblem = assetData['assets/ui/whale-emblem.webp'];

const sourceHTML = await fs.readFile(path.join(root, 'index.html'), 'utf8');
function assemble({ cssText, jsText, inline }) {
  const icon = inline ? emblem : 'assets/ui/whale-emblem.webp';
  return sourceHTML
    .replace('<link rel="icon" type="image/png" href="assets/ui/whale-emblem.webp">', () => `<link rel="icon" type="image/webp" href="${icon}">`)
    .replace('<link rel="stylesheet" href="src/ui/styles.css">', () => `<style>${cssText}</style>`)
    .replace('src="assets/ui/whale-emblem.webp"', () => `src="${icon}"`)
    .replace('<script type="module" src="src/main.mjs"></script>', () => `${catalogScript}${jsText}`);
}

await fs.writeFile(path.join(release, 'index.html'), assemble({ cssText: cssFolder, jsText: `<script>${js}</script>`, inline: false }));
await fs.rm(path.join(release, 'assets'), { recursive: true, force: true });
await fs.cp(path.join(dist, 'assets'), path.join(release, 'assets'), { recursive: true });

const cssUrlScript = `<script>globalThis.__CSS_ASSET_KEYS__=${JSON.stringify(cssSingleKeys)};</script>`;
const shim = `<script>globalThis.__ASSET_DATA__=${JSON.stringify(assetData)};</script>
<script>(()=>{const map=globalThis.__ASSET_DATA__;const urls=globalThis.__CSS_ASSET_KEYS__||[];if(urls.length){const st=document.createElement('style');st.textContent=':root{'+urls.map((k,i)=>'--asset-'+i+':url("'+(map[k]||'assets/'+k.slice(7))+'")').join(';')+'}';document.head.appendChild(st);}const norm=v=>{const s=String(v);const i=s.indexOf('assets/');return i>=0?s.slice(i):s};const inline=s=>String(s).replace(/assets\\/[\\w./-]+\\.(?:webp|png|mp3|ogg|wav)/g,m=>map[m]||m);const fix=el=>{if(!el||el.nodeType!==1)return;for(const a of ['src','href','poster','style']){const v=el.getAttribute(a);if(v&&v.includes('assets/'))el.setAttribute(a,inline(v))}};for(const C of [HTMLImageElement,HTMLMediaElement]){const d=Object.getOwnPropertyDescriptor(C.prototype,'src');if(d&&d.set)Object.defineProperty(C.prototype,'src',{...d,set(v){d.set.call(this,map[norm(v)]||v)}})}const h=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');if(h&&h.set)Object.defineProperty(Element.prototype,'innerHTML',{...h,set(v){h.set.call(this,typeof v==='string'?inline(v):v)}});const mo=new MutationObserver(rows=>{for(const r of rows){if(r.type==='attributes')fix(r.target);else for(const n of r.addedNodes)if(n.nodeType===1){fix(n);n.querySelectorAll?.('[src],[href],[style]').forEach(fix)}}});mo.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','href','poster','style']})})();</script>`;
const singlePath = path.join(release, '鲸鱼魔盗团.html');
await fs.writeFile(singlePath, assemble({ cssText: cssSingle, jsText: `${cssUrlScript}${shim}<script>${js}</script>`, inline: true }));
await fs.rm(slimRoot, { recursive: true, force: true });
await fs.rm(bundlePath, { force: true });

const size = async p => (await fs.stat(p)).size;
console.log(JSON.stringify({ status: 'built', folder: 'release/index.html', single: 'release/鲸鱼魔盗团.html', folderBytes: await size(path.join(release, 'index.html')), singleBytes: await size(singlePath), assets: files.length }));
