/** Register native generated story PNGs. Metadata only: never rewrites raster art. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');
const styles = { cinematic: '电影卡片', stage: '实景小剧场', comic: '分镜动态漫画' };
const beats = {
  opening: '序章启航', grok: 'Grok 破窗加入', claude: 'Claude 诱饵加入',
  glm: 'GLM 扫描加入', broadcast: '广播反转', evacuation: '撤离集结', epilogue: '调查尾声',
};
const readJSON = async filename => JSON.parse((await readFile(filename, 'utf8')).replace(/^\uFEFF/, ''));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const counts = (entries, field) => entries.reduce((result, entry) => {
  result[entry[field]] = (result[entry[field]] ?? 0) + 1;
  return result;
}, {});
const pretty = value => JSON.stringify(value, null, 2) + '\n';

/** Validate all 21 files before changing any inventory. */
export async function registerStoryStyles() {
  const [catalog, manifest] = await Promise.all([
    readJSON(path.join(assets, 'runtime-catalog.json')),
    readJSON(path.join(assets, 'asset-manifest.json')),
  ]);
  const byId = new Map();
  for (const entry of manifest.assets) {
    assert(!byId.has(entry.id), `Duplicate manifest asset: ${entry.id}`);
    byId.set(entry.id, entry);
  }
  const spriteCount = Object.keys(catalog.sprites).length;
  const registrations = [];
  for (const [style, styleLabel] of Object.entries(styles)) {
    for (const [beat, beatLabel] of Object.entries(beats)) {
      const id = `story-${style}-${beat}`;
      const file = `story/${style}/${beat}.png`;
      const provenanceFile = `provenance/${id}.json`;
      const promptFile = `prompts/${id}.txt`;
      const [bytes, provenance, prompt] = await Promise.all([
        readFile(path.join(assets, file)),
        readJSON(path.join(assets, provenanceFile)),
        readFile(path.join(assets, promptFile), 'utf8'),
      ]);
      assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${id}: PNG signature`);
      assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', `${id}: IHDR header`);
      const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
      const colorType = bytes[25], hasAlpha = [4, 6].includes(colorType);
      assert(width > 0 && height > 0, `${id}: positive native dimensions`);
      assert(prompt.trim(), `${id}: generation prompt must not be empty`);
      assert.equal(provenance.tool, 'image_gen', `${id}: generation tool`);
      const digest = sha256(bytes);
      assert.equal(provenance.sha256, digest, `${id}: provenance SHA256`);
      assert.deepEqual(provenance.dimensions, [width, height], `${id}: provenance dimensions`);
      const rawPath = provenance.raw_output_path ?? provenance.rawPath ?? provenance.raw;
      assert(rawPath, `${id}: generated raw path required`);
      const raw = await readFile(path.isAbsolute(rawPath) ? rawPath : path.resolve(root, rawPath));
      assert.equal(sha256(raw), digest, `${id}: PNG must remain identical to generated raw output`);
      const prompts = provenance.prompts ?? [provenance.prompt_path ?? provenance.promptPath];
      assert(prompts.length && prompts.every(Boolean), `${id}: provenance prompt paths required`);
      for (const filename of prompts) {
        assert((await readFile(path.isAbsolute(filename) ? filename : path.resolve(root, filename), 'utf8')).trim(), `${id}: recorded prompt exists`);
      }
      const mode = ({ 0: 'L', 2: 'RGB', 3: 'P', 4: 'LA', 6: 'RGBA' })[colorType];
      assert(mode, `${id}: known PNG color type`);
      const image = {
        file, width, height, mode, transparent: false,
        alpha: {
          has_channel: hasAlpha,
          extrema: hasAlpha ? null : [255, 255],
          fully_transparent_pixels: hasAlpha ? null : 0,
          total_pixels: width * height,
          inspected: hasAlpha ? 'IHDR only; background is authored opaque' : 'PNG color type has no alpha channel',
        },
        bytes: bytes.length, sha256: digest, raw_output_sha256_verified: true,
        provenance: provenanceFile, story_style: style, story_beat: beat,
      };
      const entry = {
        ...(byId.get(id) ?? {}),
        id, category: 'story', label: `${styleLabel} · ${beatLabel}`, priority: 'P0',
        creation_method: 'ai_generated', source_path: `assets/${file}`, runtime_path: `assets/${file}`,
        runtime_catalog_id: id, dimensions: { native_png: [width, height], logical_display: [1280, 720] },
        transparent: false, reference_ids: byId.get(id)?.reference_ids ?? [],
        prompt_recipe: 'illustration-story-style', prompt_variables: { story_style: style, story_beat: beat },
        usage: ['story_presentation', `story_style_${style}`],
        status: 'verified', dimensions_verified: true,
        provenance: {
          tool: 'image_gen', record_path: `assets/${provenanceFile}`, sha256: digest,
          generated_at: provenance.date ?? provenance.generated_at ?? '2026-10-25',
          usage_verified: 'story-runtime',
        },
        prompt_path: `assets/${promptFile}`,
      };
      registrations.push({ id, image, entry });
    }
  }
  for (const { id, image, entry } of registrations) {
    catalog.images[id] = image;
    if (byId.has(id)) manifest.assets[manifest.assets.indexOf(byId.get(id))] = entry;
    else manifest.assets.push(entry);
  }
  assert.equal(Object.keys(catalog.sprites).length, spriteCount, 'Story registration must not create sprite regions');
  assert.equal(spriteCount, 96, 'Gameplay sprite inventory remains unchanged');
  const imageCount = Object.keys(catalog.images).length;
  assert(imageCount >= 49, '28 base PNGs and 21 story PNGs remain registered alongside supplemental UI art');
  const storyImageCount = Object.values(catalog.images).filter(item => item.file.startsWith('story/')).length;
  catalog.date = '2026-10-25';
  catalog.summary = { ...catalog.summary, png_files: imageCount, sprite_regions: spriteCount, story_png_files: storyImageCount, story_style_png_files: registrations.length };
  manifest.summary = {
    ...manifest.summary, total_records: manifest.assets.length,
    by_category: counts(manifest.assets, 'category'), by_status: counts(manifest.assets, 'status'),
    production_png_files: imageCount, runtime_sprite_regions: spriteCount,
    story_png_files: storyImageCount, story_style_png_files: registrations.length,
  };
  // Preflight is complete. Only JSON/JS metadata is written; all PNG bytes remain untouched.
  await writeFile(path.join(assets, 'runtime-catalog.json'), pretty(catalog), 'utf8');
  await writeFile(path.join(assets, 'asset-manifest.json'), pretty(manifest), 'utf8');
  await writeFile(path.join(assets, 'preview', 'catalog.js'), 'window.WHALE_ASSETS = ' + JSON.stringify(catalog) + ';\n', 'utf8');
  return { status: 'registered', registeredStoryImages: registrations.length, productionImages: imageCount, storyImages: storyImageCount, spriteRegions: spriteCount, rasterModifications: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await registerStoryStyles(), null, 2));
}
