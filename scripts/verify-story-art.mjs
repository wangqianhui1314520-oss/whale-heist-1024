/** Narrative art routing contracts; image readiness is reported separately. */
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { STORY_REPLAY_INDEX, getStoryScene } from '../src/game/story.mjs';
import { STORY_ART_BEATS, STORY_ART_IMAGES, storyBeatFor, storyArtFor, comicFrameFor } from '../src/game/story-art.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const styles = ['cinematic', 'stage', 'comic'];
const expectedBeats = {
  prologue: 'opening', 'chapter1-briefing': 'grok', 'grok-join': 'grok',
  'claude-join': 'claude', 'chapter2-briefing': 'claude',
  'glm-join': 'glm', 'chapter3-briefing': 'glm',
  'chapter4-briefing': 'broadcast', 'chapter4-reveal': 'broadcast',
  'chapter5-briefing': 'evacuation', 'chapter5-preparation': 'evacuation', epilogue: 'epilogue',
};
assert.equal(STORY_REPLAY_INDEX.length, 12, 'all 12 narrative scenes are covered');
assert.equal(STORY_ART_BEATS.length, 7, 'seven separately illustrated beats');
assert.equal(new Set(STORY_ART_BEATS).size, 7, 'beat identities are unique');
assert.equal(STORY_ART_IMAGES.length, 21, 'one image per beat and treatment');
assert.equal(new Set(STORY_ART_IMAGES).size, 21, 'image routes never alias another treatment');
for (const style of styles) for (const beat of STORY_ART_BEATS) {
  const route = `assets/story/${style}/${beat}.png`;
  assert(STORY_ART_IMAGES.includes(route), `${route}: canonical image route`);
  assert.equal(storyArtFor(beat, style), route);
}
for (const { id } of STORY_REPLAY_INDEX) {
  const expected = expectedBeats[id];
  assert(expected, `${id}: explicit scene coverage`);
  for (const context of [{}, { broadcastOn: false }, { completed: true, remoteReady: true, rendezvousCrew: ['Grok', 'Claude', 'GLM'] }]) {
    const scene = getStoryScene(id, context);
    assert(scene.steps.length, `${id}: actual scene contains dialogue`);
    for (const step of scene.steps) {
      const current = { ...step, sceneId: id };
      assert.equal(storyBeatFor(current), expected, `${id}: scene identity keeps one authored beat across reusable backdrops`);
      for (const style of styles) assert(STORY_ART_IMAGES.includes(storyArtFor(current, style)), `${id}/${style}: manifest route`);
    }
    assert.equal(storyBeatFor({ sceneId: id, backdrop: 'story-epilogue', speaker: 'GLM' }), expected, `${id}: explicit scene beats backdrop/speaker fallback`);
  }
}
for (const [backdrop, beat] of [['story-prologue', 'opening'], ['story-grok', 'grok'], ['recruitment-hall', 'claude'], ['inspection-bridge', 'glm'], ['broadcast-room', 'broadcast'], ['remote-beacon', 'evacuation'], ['investigation-desk', 'epilogue']]) assert.equal(storyBeatFor(backdrop), beat);
for (const speaker of ['Grok', 'Claude', 'GLM']) assert.equal(storyBeatFor({ speaker }), speaker.toLowerCase(), 'speaker fallback remains usable without scene identity');
console.log('PASS all 12 scenes and dynamic branches resolve to seven valid beats and 21 unique treatment images');

for (const total of [1, 2, 3, 4, 6, 9, 12, 30]) {
  const frames = Array.from({ length: total }, (_, index) => comicFrameFor({ index, total }));
  assert(frames.every(frame => Number.isInteger(frame) && frame >= 0 && frame <= 2), `${total} dialogue steps: generated comic crops stay in their three frame bounds`);
  assert.equal(frames[0], 0, 'first line begins with observation');
  if (total > 1) assert.equal(frames.at(-1), 2, 'final line reaches the result frame');
  assert(frames.every((frame, index) => index === 0 || frame >= frames[index - 1]), 'frame progression does not jump backwards');
}
assert.deepEqual(Array.from({ length: 9 }, (_, index) => comicFrameFor({ index, total: 9 })), [0, 0, 0, 1, 1, 1, 2, 2, 2]);
for (const comicFrame of [-5, 0, 1, 2, 9]) assert([0, 1, 2].includes(comicFrameFor({ comicFrame })), 'explicit frame requests are clamped');
console.log('PASS observation/action/result crops stay in bounds and follow chronological thirds');

const mainSource = await readFile(path.join(project, 'src/main.mjs'), 'utf8');
const mapping = mainSource.match(/comicPanels:\s*(storyPlayer\.scene\.steps\.map\([\s\S]*?\))\s*,\s*progress:/);
assert(mapping, 'the real controller exposes an inspectable comicPanels map');
for (const { id } of STORY_REPLAY_INDEX) {
  const scene = getStoryScene(id);
  const panels = runInNewContext(mapping[1], { storyPlayer: { scene } }, { timeout: 1000 });
  assert.equal(panels.length, scene.steps.length, `${id}: controller maps every dialogue step`);
  panels.forEach((panel, index) => {
    const step = scene.steps[index];
    assert.equal(panel.text, step.text, `${id}/${index}: comic dialogue is not omitted`);
    assert.equal(panel.speaker, step.speaker, `${id}/${index}: speaker is retained`);
    assert.equal(panel.backdrop, step.backdrop, `${id}/${index}: backdrop survives the main controller mapping`);
    assert(panel.backdrop, `${id}/${index}: usable backdrop information`);
    assert(STORY_ART_IMAGES.includes(storyArtFor({ ...panel, sceneId: id }, 'comic')));
  });
}
console.log('PASS the real main.mjs comicPanels map preserves all dialogue, speakers and backdrop information');

const uiSource = await readFile(path.join(project, 'src/ui/ui-v3.mjs'), 'utf8');
const stageSource = uiSource.match(/drawStoryStage\(\)\s*\{([\s\S]*?)\n\s*renderArchive\(/)?.[1];
assert(stageSource, 'dedicated stage renderer exists');
assert.match(stageSource, /assets\.drawActor\(/, 'stage draws generated character atlas regions');
assert.match(stageSource, /assets\.drawEffect\(/, 'stage draws generated effect atlas regions');
assert(!/ctx\.(?:arc|fillRect)\(/.test(stageSource), 'stage does not fall back to geometric character drawings');
const catalog = JSON.parse((await readFile(path.join(project, 'assets/runtime-catalog.json'), 'utf8')).replace(/^\uFEFF/, ''));
for (const character of ['deepseek', 'grok', 'claude', 'glm']) {
  const image = `${character}-actions`;
  assert(uiSource.includes(`'${image}'`), `${character}: formal action atlas is preloaded`);
  assert(catalog.images[image]?.transparent, `${character}: real transparent action art`);
  assert((await stat(path.join(project, 'assets', catalog.images[image].file))).isFile());
  for (const direction of ['left', 'right']) for (const pose of ['idle', 'walk', 'skill']) {
    assert.equal(catalog.sprites[`character-${character}-${direction}-${pose}`]?.image, image, `${character}/${direction}/${pose}: stage pose uses formal art`);
  }
}
for (const effect of ['water-dash', 'axe-impact', 'paper-decoy', 'scan-grid']) {
  assert(uiSource.includes(`'${effect}-atlas'`), `${effect}: generated effect atlas is preloaded`);
  assert(stageSource.includes(`'${effect}'`), `${effect}: skill is connected to the stage renderer`);
  const animation = catalog.animations[effect];
  assert(animation?.frames?.length === 4, `${effect}: all four generated frames exist`);
  for (const frame of animation.frames) {
    const sprite = catalog.sprites[frame];
    assert(sprite && catalog.images[sprite.image]?.transparent, `${effect}/${frame}: generated alpha effect art`);
  }
}
console.log('PASS the stage uses all four formal character atlases and all four generated skill effects');

const fileStates = await Promise.all(STORY_ART_IMAGES.map(async route => {
  try { return { route, exists: (await stat(path.join(project, route))).isFile() }; }
  catch (error) { if (error.code === 'ENOENT') return { route, exists: false }; throw error; }
}));
const missing = fileStates.filter(entry => !entry.exists);
if (missing.length) {
  console.log(`PENDING generated image files: ${21 - missing.length}/21 present. PNG validation has not run; art delivery is not complete.`);
  console.log(`PENDING ${missing.map(entry => entry.route).join(', ')}`);
} else {
  for (const route of STORY_ART_IMAGES) {
    const png = await readFile(path.join(project, route));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${route}: PNG signature`);
    assert.equal(png.toString('ascii', 12, 16), 'IHDR', `${route}: native PNG dimensions`);
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    assert(width >= 512 && height >= 256, `${route}: useful generated scene resolution`);
    if (route.includes('/comic/')) assert(width > height, `${route}: horizontal comic sheet (equal panel composition requires visual review)`);
  }
  console.log('PASS all 21 generated scene PNGs exist with valid native headers and landscape comic sheets; panel composition requires visual review');
}
