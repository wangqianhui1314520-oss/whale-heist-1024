// Refresh 游戏发布快照 with the current audio-wired build (P0 fix).
// Copies the runtime-relevant tree from the main project into the snapshot and
// verifies the result: 46 mp3 in dist, manifest present, wirings present.
import { cp, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const main = path.resolve('D:/Vibe coding/1024切磋大会/游戏-鲸鱼魔盗团');
const snap = path.resolve('D:/Vibe coding/1024切磋大会/游戏发布快照');
const targets = ['src', 'assets', 'dist', 'index.html', 'story-theater.html'];
for (const item of targets) {
    await cp(path.join(main, item), path.join(snap, item), { recursive: true });
    console.log('copied ' + item);
}
const audioJs = await readFile(path.join(snap, 'dist/src/game/audio.js'), 'utf8');
const mainJs = await readFile(path.join(snap, 'dist/src/main.js'), 'utf8');
const srcMain = await readFile(path.join(snap, 'src/main.mjs'), 'utf8');
const checks = [
    ['dist audio.js manifest', /VOICE_FILES/.test(audioJs) && /AMBIENCE_FILES/.test(audioJs)],
    ['dist audio.js ops layering', /playAmbience\('ops'\)/.test(audioJs)],
    ['dist main.js ui click', /UI_CLICK_ACTIONS/.test(mainJs)],
    ['dist main.js story voices', /hero_charge/.test(mainJs) && /glm_route/.test(mainJs)],
    ['dist main.js event voices', /playVoice\('grok','pickup'\)/.test(mainJs) && /playVoice\('claude','alert'\)/.test(mainJs)],
    ['dist main.js alert voice', /playVoice\('glm','warn'\)/.test(mainJs)],
    ['src main.mjs wirings', /UI_CLICK_ACTIONS/.test(srcMain) && /chapterOrderPlayed/.test(srcMain)],
];
let mp3 = 0;
async function count(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await count(file);
        else if (/\.mp3$/.test(entry.name)) mp3++;
    }
}
await count(path.join(snap, 'dist/assets/audio'));
checks.push(['dist mp3 count = 46', mp3 === 46]);
for (const [name, ok] of checks) console.log((ok ? 'OK   ' : 'FAIL ') + name);
if (!checks.every(c => c[1]) || mp3 !== 46) { console.error('SNAPSHOT REFRESH INCOMPLETE'); process.exit(1); }
console.log('SNAPSHOT REFRESHED: ' + mp3 + ' mp3 in dist, all wiring checks green');
