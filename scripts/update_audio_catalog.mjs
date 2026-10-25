#!/usr/bin/env node
// 从 assets/provenance/audio-manifest.json 派生更新 assets/runtime-catalog.json 的 audio 键。
// 用法: node scripts/update_audio_catalog.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'assets/provenance/audio-manifest.json');
const catalogPath = path.join(root, 'assets/runtime-catalog.json');

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
if (!Array.isArray(manifest.assets)) throw new Error('manifest.assets must be an array');

const audio = {};
for (const a of manifest.assets) {
  if (a.status !== 'ok') continue;
  audio[a.id] = {
    file: `audio/${a.category}/${a.id}.mp3`,
    category: a.category,
    loop: Boolean(a.loop),
    duration_s: a.transcoded.duration_s,
    bitrate_kbps: a.transcoded.bitrate_kbps,
    bytes: a.transcoded.bytes,
    provenance: 'provenance/audio-manifest.json',
  };
}
catalog.audio = audio;
await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ updated: true, catalog: catalogPath, audioEntries: Object.keys(audio).length }));
