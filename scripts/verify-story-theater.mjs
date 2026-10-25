/** Exercise the real read-only theater and every branch without a browser. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { STORY_SCENES, getStoryScene } from '../src/game/story.mjs';
import { STORY_ART_BEATS, STORY_ART_IMAGES, storyBeatFor, storyArtFor, comicFrameFor } from '../src/game/story-art.mjs';
import { storyBackdrop, portraitPath, escapeHTML } from '../src/ui/ui-v3.mjs';

const nodes = new Map();
const node = id => {
  if (!nodes.has(id)) nodes.set(id, {
    style: {}, dataset: {}, children: [], listeners: {}, hidden: false,
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    setAttribute() {}, scrollIntoView() {},
  });
  return nodes.get(id);
};
let writes = 0;
const context = vm.createContext({
  STORY_SCENES, getStoryScene, STORY_ART_BEATS, STORY_ART_IMAGES, storyBeatFor, storyArtFor, comicFrameFor,
  storyBackdrop, portraitPath, esc: escapeHTML, URL, URLSearchParams,
  browserStorage: () => ({ getItem: () => null, setItem() { writes++; }, removeItem() { writes++; } }),
  loadExperience: () => ({ value: null }), loadCheckpoint: () => ({ checkpoint: null }), loadArchive: () => ({ records: [] }),
  document: { hidden: false, getElementById: node, querySelectorAll: () => [], addEventListener() {} },
  location: { search: '' }, matchMedia: () => ({ matches: false }), performance: { now: () => 0 },
  setTimeout: () => 1, clearTimeout() {}, cancelAnimationFrame() {}, requestAnimationFrame: () => 1,
});
const source = (await readFile(new URL('../src/ui/story-theater.mjs', import.meta.url), 'utf8'))
  .replace(/^import .+;\r?$/gm, '').replaceAll('import.meta.url', "'http://127.0.0.1/src/ui/story-theater.mjs'");
vm.runInContext(source + `
globalThis.qa = {
  entries,
  position: () => [sceneIndex, variantIndex, lineIndex],
  playing: () => playing,
  next,
  style: value => { storyStyle = value; render(); },
  selectScene: value => { sceneIndex = value; variantIndex = lineIndex = 0; render(); },
};`, context);
const qa = context.qa;
const expected = qa.entries.flatMap((entry, si) => entry.variants.flatMap((variant, vi) => variant.scene.steps.map((_, li) => [si, vi, li].join(':'))));
const reached = [];
while (qa.playing() && reached.length < 500) { reached.push(qa.position().join(':')); qa.next(); }
assert.deepEqual(reached, Array.from(expected), 'continuous play reaches every line of every branch exactly once');
assert.equal(qa.entries.length, 12);
assert.equal(qa.entries.reduce((n, entry) => n + entry.variants.length, 0), 20);
assert.equal(node('progress').style.width, '100%');
const finalPosition = qa.position().join(':'); qa.next();
assert.equal(qa.position().join(':'), finalPosition, 'the last branch stays selected on completion');
for (const expectedPosition of reached.slice(0, -1).reverse()) {
  node('previous').listeners.click();
  assert.equal(qa.position().join(':'), expectedPosition, 'previous crosses branch and scene boundaries in reverse order');
}
assert.equal(node('previous').disabled, true);
console.log(`PASS theater: all 12 scenes, 20 variants and ${reached.length} lines play forward/backward without omissions`);

for (const id of ['chapter4-reveal', 'chapter5-preparation', 'epilogue']) {
  const sceneIndex = qa.entries.findIndex(entry => entry.id === id);
  qa.selectScene(sceneIndex);
  for (let variant = 0; variant < qa.entries[sceneIndex].variants.length; variant++) {
    node('branch-select').listeners.change({ target: { value: String(variant) } });
    assert.equal(qa.position()[1], variant); assert.equal(qa.position()[2], 0);
    assert.equal(node('dialogue').textContent, qa.entries[sceneIndex].variants[variant].scene.steps[0].text);
    assert.equal(node('branch-select').disabled, false);
  }
}
for (const style of ['cinematic', 'comic']) {
  qa.style(style);
  assert.equal(node('scene-art').style.backgroundSize, 'contain', `${style}: complete art is fitted without single-frame stretching`);
}
assert.equal(writes, 0, 'theater playback never writes storage');
console.log('PASS dynamic branch selector, complete art fitting, final branch retention and read-only storage');
