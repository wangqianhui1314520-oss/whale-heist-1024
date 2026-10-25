/** Rendering contract checks with a drawing spy; this does not claim visual/browser QA. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderResolution } from '../src/render/resolution.mjs';
import { GameRenderer } from '../src/game/renderer.mjs';
import { GameCore } from '../src/core/state.mjs';
import { GameWorld } from '../src/game/world.mjs';
import { CHAPTERS } from '../src/core/chapters.mjs';
import { chapterCheckpoint } from '../src/game/session.mjs';
import { getMap } from '../src/game/maps.mjs';
import { compilePrompt } from '../src/game/prompts.mjs';
import { AssetLibrary } from '../src/render/assets.mjs';
import { sceneImageKeys } from '../src/render/scene-renderer.mjs';

assert.equal(renderResolution({ dpr: 1 }), 2);
assert.equal(renderResolution({ dpr: 1.25, cssWidth: 1600 }), 2);
assert.equal(renderResolution({ dpr: 2, cssWidth: 1920 }), 3);
assert.equal(renderResolution({ dpr: 3, cssWidth: 700, mobile: true }), 1.75);
assert.equal(renderResolution({ dpr: 4, cssWidth: 1000, mobile: true }), 2);
assert.equal(renderResolution({ dpr: 1, cssWidth: 640, mobile: true }), 1.5);
assert.equal(renderResolution({ quality: 'low' }), 1.5);
const calls = [];
const context = name => new Proxy({ globalAlpha: 1, canvas: null }, { get(target, key) {
  if (key in target) return target[key];
  if (key === 'measureText') return text => ({ width: String(text).length * 6 });
  if (/^create.*Gradient$/.test(key)) return () => ({ addColorStop() {} });
  return (...args) => {
    assert(args.filter(value => typeof value === 'number').every(Number.isFinite), `${name}.${String(key)} finite`);
    calls.push({ name, key, args });
  };
} });
const doc = { getElementById: id => elements[id], createElement: () => ({ style: {}, classList: { toggle() {} }, hidden: false, textContent: '' }) };
const makeCanvas = name => { const ctx = context(name); return { width: 1280, height: 720, style: {}, dataset: {}, ownerDocument: doc, getContext: () => ctx, getBoundingClientRect: () => ({ width: 1280 }) }; };
const elements = { 'background-canvas': makeCanvas('background'), 'structure-canvas': makeCanvas('structure'), 'game-canvas': makeCanvas('actors'), 'effects-canvas': makeCanvas('effects'), 'scene-labels': { children: [], append(child) { this.children.push(child); } } };
const catalog = JSON.parse(await readFile(new URL('../assets/runtime-catalog.json', import.meta.url), 'utf8'));
let actorDraws = 0, spriteDraws = 0, authoredFragments = 0, effectDraws = 0, previews = 0;
let readyImages = new Set();
const assets = { catalog,
  draw(ctx, id, x, y, options = {}) {
    assert(catalog.sprites[id], id); assert(readyImages.has(catalog.sprites[id].image), `${id}: source image must be preloaded in this chapter`); assert(Number.isInteger(x) && Number.isInteger(y), `${id}: integer anchor`); spriteDraws++;
    if (options.sourceRect) {
      const [x, y, w, h] = options.sourceRect, [sx, sy, sw, sh] = catalog.sprites[id].source_rect;
      assert(options.sourceRect.every(Number.isFinite) && w > 0 && h > 0 && x >= sx && y >= sy && x + w <= sx + sw && y + h <= sy + sh, `${id}: authored fragment stays in the designated source region`);
      authoredFragments++;
    }
  },
  drawActor(ctx, name, pose, direction, x, y) { assert(catalog.sprites[`character-${name.toLowerCase()}-${direction}-${pose}`], `${name}:${pose}`); assert(Number.isInteger(x) && Number.isInteger(y), 'integer actor anchor'); actorDraws++; },
  drawEffect(ctx, group, elapsed, x, y) { assert(catalog.animations[group], group); assert(readyImages.has(catalog.sprites[catalog.animations[group].frames[0]].image), `${group}: ambient/skill atlas must be preloaded`); assert([elapsed, x, y].every(Number.isFinite)); effectDraws++; },
};
const renderer = new GameRenderer(elements['game-canvas'], assets);
assert.equal(elements['game-canvas'].width, 2560);
assert.equal(elements['structure-canvas'].width, 2560);
assert.equal(elements['background-canvas'].width, 1920);
assert.equal(elements['effects-canvas'].height, 1440);
for (const chapter of CHAPTERS) {
  readyImages = new Set(sceneImageKeys(chapter));
  const core = new GameCore({ checkpoint: chapterCheckpoint(chapter.id), persist: false });
  const world = new GameWorld(core, getMap(chapter.id), { expanded: true, compilePrompt });
  for (const room of world.rooms) {
    if (room.id !== world.currentRoom.id) world.loadRoom(room);
    world.player.x += .321; world.player.y += .235;
    renderer.render(world, core.view());
    renderer.render(world, core.view(), { reduceMotion: true, reduceFlashes: true });
    for (const target of world.map.targets) {
      world.selectTarget(target.id);
      for (const precise of [false, true]) {
        world.previewTarget(target, precise);
        renderer.render(world, core.view()); previews++;
      }
    }
    world.cancelPreview();
    world.scanWarning = { x: 540, y: 180, w: 190, remaining: .8 };
    renderer.render(world, core.view(), { quality: 'low' });
    world.scanWarning = null;
  }
}
for (const layer of ['background', 'structure', 'actors', 'effects']) assert(calls.some(call => call.name === layer && call.key === 'clearRect'), `clears ${layer}`);
assert(actorDraws > 20 && spriteDraws > 50);
assert(elements['scene-labels'].children.length > 0, 'scene text rendered in HTML');
assert(authoredFragments > 500 && effectDraws > 10 && previews > 30, 'All rooms exercise authored atmosphere, skills and command-range overlays');
assert(!calls.some(call => ['fill', 'fillRect', 'stroke', 'strokeRect', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'fillText'].includes(call.key)), 'Normal rendering paints no substitute shapes or text icons; range geometry only clips art');
const library = new AssetLibrary(catalog, new URL('../assets/runtime-catalog.json', import.meta.url));
library.images.set('harbor-kit', {});
library.draw(context('crop-contract'), 'scene-water-channel', 80, 90, { sourceRect: [583, 327, 23, 26], width: 6, height: 6 });
assert.deepEqual(calls.find(call => call.name === 'crop-contract' && call.key === 'drawImage').args.slice(1, 5), [583, 327, 23, 26], 'Asset adapter samples the requested original PNG fragment');
console.log(`PASS desktop 2×+, mobile 1.5–2×, independent layers, PNG-only scene decoration, exact range masks, ${previews} command previews and original atlas crops (${actorDraws} actors / ${spriteDraws} sprites). No browser screenshot was taken.`);
