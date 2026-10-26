// Mutation harness for verify-audio-usage.mjs.
// Each mutation removes one audio trigger; the guard MUST fail (non-zero exit).
// Discipline: backup bytes first, assert baseline PASS, apply -> assert applied ->
// run guard with timeout -> assert FAIL -> restore -> assert byte-identical.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const guard = path.join(root, 'scripts/verify-audio-usage.mjs');
const mainPath = path.join(root, 'src/main.mjs');
const audioPath = path.join(root, 'src/game/audio.mjs');
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

const originals = new Map([[mainPath, readFileSync(mainPath)], [audioPath, readFileSync(audioPath)]]);
const runGuard = () => {
  const r = spawnSync(node, [guard], { cwd: root, timeout: 60000, encoding: 'utf8' });
  return { rc: r.status === null ? 'TIMEOUT' : r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const applyMutation = (file, find, replace) => {
  const text = originals.get(file).toString('utf8');
  if (!text.includes(find)) throw new Error('mutation target not found: ' + find.slice(0, 60));
  const next = text.replace(find, replace);
  if (next === text) throw new Error('mutation was a no-op: ' + find.slice(0, 60));
  writeFileSync(file, next, 'utf8');
};
const restore = file => writeFileSync(file, originals.get(file));

const mutations = [
  { id: 'M1-delivery-voice', file: mainPath,
    find: `else if(payload.name==='delivery')audio.playVoice('grok','pickup');`, replace: '',
    kills: 'grok_pickup loses its only trigger (delivery event branch)' },
  { id: 'M2-amb-ops-scene', file: audioPath,
    find: `if(harbor){this.playAmbience('harbor');this.playAmbience('ops');}`, replace: `if(harbor){this.playAmbience('harbor');}`,
    kills: 'ops loses setScene layering (design: indoor overlay)' },
  { id: 'M3-story-beacon-voice', file: mainPath,
    find: `beacon:'glm_route',`, replace: '',
    kills: 'glm_route loses the story beacon cue' },
  { id: 'M4-grok-evacuate', file: mainPath,
    find: `if(evacuationVoiceTick++%2)audio.playVoice('grok','evacuate');else audio.playVoice('hero','evacuate');`,
    replace: `audio.playVoice('hero','evacuate');`,
    kills: 'grok_evacuate loses the alternating evacuation call' },
  { id: 'M5-manifest-entry', file: audioPath,
    find: `glm_warn:'voice/voice_glm_warn.mp3'`, replace: '',
    kills: 'disk integrity: voice_glm_warn.mp3 on disk but unregistered' },
  { id: 'M6-hero-scan-speaker', file: mainPath,
    find: `name==='scan'&&step?.speaker==='DeepSeek'?'hero_scan':voices[name]`, replace: `voices[name]`,
    kills: 'hero_scan loses the speaker-aware scan cue' },
  { id: 'M7-claude-alert', file: mainPath,
    find: `else if(payload.name==='alarm')audio.playVoice('claude','alert');`, replace: '',
    kills: 'claude_alert loses the alarm event branch' },
];

const base = runGuard();
if (base.rc !== 0) { console.error('BASELINE FAILED - aborting mutation run\n' + base.out); process.exit(1); }
console.log('baseline: PASS (guard green before mutations)');

const results = [];
try {
  for (const m of mutations) {
    applyMutation(m.file, m.find, m.replace);
    const r = runGuard();
    const killed = r.rc !== 0 && r.rc !== 'TIMEOUT';
    results.push({ id: m.id, killed, rc: r.rc, kills: m.kills });
    restore(m.file);
    const hashOk = sha(readFileSync(m.file)) === sha(originals.get(m.file));
    if (!hashOk) throw new Error('restore verification failed for ' + m.id);
    if (r.rc === 'TIMEOUT') throw new Error('guard timed out under ' + m.id);
  }
} finally {
  for (const [file, buf] of originals) writeFileSync(file, buf);
}

const notKilled = results.filter(r => !r.killed);
for (const r of results) console.log((r.killed ? 'KILLED  ' : 'SURVIVED') + ' ' + r.id + ' (guard rc=' + r.rc + ') - ' + r.kills);
const after = runGuard();
if (after.rc !== 0) { console.error('POST-RESTORE FAILED\n' + after.out); process.exit(1); }
console.log('post-restore: PASS (guard green, files byte-identical)');
if (notKilled.length) { console.error('MUTATION TEST INCOMPLETE: ' + notKilled.map(r => r.id).join(', ')); process.exit(1); }
console.log('PASS mutation-audio-usage: ' + results.length + '/' + results.length + ' mutations killed');
