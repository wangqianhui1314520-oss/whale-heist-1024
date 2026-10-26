// Audio usage guard: every key registered in the GameAudio manifests must have
// at least one runtime trigger, and every MP3 under assets/audio must be
// registered. Orphaned assets (generated but never played) and unregistered
// files (played but missing from the catalog) both fail this check.
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audioPath = path.join(root, 'src/game/audio.mjs');
const audioSrc = await readFile(audioPath, 'utf8');
const mainSrc = await readFile(path.join(root, 'src/main.mjs'), 'utf8');

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(file));
    else if (/\.mjs$/.test(entry.name)) out.push(file);
  }
  return out;
}
const srcFiles = await walk(path.join(root, 'src'));
const srcText = new Map();
for (const file of srcFiles) srcText.set(file, await readFile(file, 'utf8'));
const allSrc = [...srcText.values()].join('\n');
const unquote = value => { const m = /^\s*['"`]([^'"`]+)['"`]\s*$/.exec(value || ''); return m ? m[1] : null; };
const literals = value => [...(value || '').matchAll(/['"`]([^'"`]+)['"`]/g)].map(m => m[1]);

// --- 1. Parse the four manifest tables (keys + relative files) ----------------
const tableBlock = name => { const m = new RegExp(`const ${name}=\\{([\\s\\S]*?)\\};`).exec(audioSrc); return m ? m[1] : ''; };
const tableEntries = block => [...block.matchAll(/(?:'([^']+)'|([A-Za-z_$][\w$-]*))\s*:\s*'([^']+)'/g)]
  .map(m => ({ key: m[1] || m[2], file: m[3] }));
const tables = {
  SFX: tableEntries(tableBlock('SFX_FILES')),
  MUSIC: tableEntries(tableBlock('MUSIC_FILES')),
  AMBIENCE: tableEntries(tableBlock('AMBIENCE_FILES')),
  VOICE: tableEntries(tableBlock('VOICE_FILES')),
};
for (const [name, entries] of Object.entries(tables)) assert(entries.length > 0, `${name} manifest parsed empty; check audio.mjs formatting`);
const manifestFiles = new Set(Object.values(tables).flat().map(e => e.file));

// --- 2. Collect trigger evidence ----------------------------------------------
const roleValues = [...audioSrc.matchAll(/ROLE_VOICES=\{([^}]*)\}/g)]
  .flatMap(m => [...m[1].matchAll(/\w+\s*:\s*'(\w+)'/g)].map(x => x[1]))
  .filter((v, i, a) => a.indexOf(v) === i);
assert(roleValues.length >= 4, 'ROLE_VOICES could not be parsed from audio.mjs');
// setScene maps a scene name to a music id: those map values are real triggers.
const sceneMusic = [...audioSrc.matchAll(/const music=\{([^}]*)\}\[this\.scene\]/g)].flatMap(m => literals(m[1]));
// playVoice calls: literal role+kind pairs, single-key form, and dynamic roles
// (payload.teammate, ternaries) expanded over every literal candidate found in
// the argument, falling back to the full ROLE_VOICES table.
const voiceKeys = new Set();
for (const call of [...mainSrc.matchAll(/playVoice\(([^)]*)\)/g)]) {
  const parts = call[1].split(',').map(s => s.trim());
  if (parts.length === 1) { const key = unquote(parts[0]); if (key) voiceKeys.add(key); continue; }
  const kind = unquote(parts[1] || '');
  if (!kind) continue;
  const roles = literals(parts[0]);
  for (const role of (roles.length ? roles : roleValues)) voiceKeys.add(`${role}_${kind}`);
}
const esc = key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A stop* reference is not a trigger: strip those calls before the bare-literal
// fallback so "stopAmbience('ops')" can never stand in for a missing play.
const mainPlaySrc = mainSrc.replace(/stop(?:Ambience|Music)\('[^']+'\)/g, '');
const triggers = new Set();
for (const key of [...manifestFiles].map(f => f.replace(/^[a-z]+\//, '').replace(/\.mp3$/, ''))) triggers.add(key); // ids are file stems; real evidence below overrides
triggers.clear();
for (const key of Object.values(tables).flat().map(e => e.key)) {
  if (new RegExp(`play(?:Music|Ambience)?\\('${esc(key)}'\\)`).test(allSrc)) triggers.add(key);       // direct play()/playMusic()/playAmbience()
  else if (new RegExp(`emit\\('sound',\\{name:'${esc(key)}'`).test(allSrc)) triggers.add(key);        // world event source
  else if (voiceKeys.has(key)) triggers.add(key);                                                    // playVoice combo
  else if (tables.MUSIC.some(e => e.key === key) && sceneMusic.includes(key)) triggers.add(key);     // setScene music map value
  else if (new RegExp(`['"\`]${esc(key)}['"\`]`).test(mainPlaySrc)) triggers.add(key);                  // maps/comparisons/sets in main.mjs
}

// --- 3. Report + assertions -----------------------------------------------------
const rows = [];
for (const [name, entries] of Object.entries(tables)) {
  for (const { key, file } of entries) rows.push({ layer: name, key, file, used: triggers.has(key) });
}
const orphaned = rows.filter(r => !r.used);
console.log('audio usage guard: ' + rows.filter(r => r.used).length + '/' + rows.length + ' registered assets have a runtime trigger');
for (const r of rows) console.log((r.used ? '  USED   ' : '  ORPHAN ') + r.layer.padEnd(9) + r.key);
assert(orphaned.length === 0, 'orphaned audio assets (registered but never triggered): ' + orphaned.map(r => r.key).join(', '));

// --- 4. Manifest <-> disk integrity --------------------------------------------
const audioDir = path.join(root, 'assets/audio');
const diskFiles = new Set();
async function walkAudio(dir, base = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) await walkAudio(path.join(dir, entry.name), base + entry.name + '/');
    else if (/\.mp3$/.test(entry.name)) diskFiles.add(base + entry.name);
  }
}
await walkAudio(audioDir);
const unregistered = [...diskFiles].filter(f => !manifestFiles.has(f));
const missing = [...manifestFiles].filter(f => !diskFiles.has(f));
console.log('disk integrity: ' + diskFiles.size + ' mp3 on disk, ' + manifestFiles.size + ' registered');
assert(missing.length === 0, 'manifest entries with no file on disk: ' + missing.join(', '));
assert(unregistered.length === 0, 'mp3 files on disk but not registered in audio.mjs: ' + unregistered.join(', '));

// --- 5. Reverse check (informational): sound events without an SFX asset -------
const sfxKeys = new Set(tables.SFX.map(e => e.key));
const synthOnly = [...allSrc.matchAll(/emit\('sound',\{name:'([^']+)'/g)].map(m => m[1])
  .filter((v, i, a) => a.indexOf(v) === i && !sfxKeys.has(v));
if (synthOnly.length) console.log('synth-fallback sound events (no SFX file, procedural only): ' + synthOnly.join(', '));
console.log('PASS verify-audio-usage');
