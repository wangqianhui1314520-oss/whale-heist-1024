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
assert.equal(renderResolution({ dpr: 3, cssWidth: 700, mobile: true }), 2);
assert.equal(renderResolution({ dpr: 4, cssWidth: 1000, mobile: true }), 2);
assert.equal(renderResolution({ dpr: 1, cssWidth: 640, mobile: true }), 1.5);
// Mobile backing never drops below the 1:1 physical grid: standard supersamples
// 25%, low stays exactly 1:1 (844x390@3x letterboxed shell: 693.3 CSS px -> 2080).
assert.equal(renderResolution({ dpr: 3, cssWidth: 700, mobile: true, quality: 'low' }), 1.625);
assert.equal(renderResolution({ dpr: 3, cssWidth: 693.3, mobile: true }), 2);
assert.equal(renderResolution({ dpr: 3, cssWidth: 693.3, mobile: true, quality: 'low' }), 1.625);
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
const assets = new AssetLibrary(catalog, new URL('../assets/runtime-catalog.json', import.meta.url));
for (const key of Object.keys(catalog.images)) assets.images.set(key, { key });
const draw = assets.draw.bind(assets), drawActor = assets.drawActor.bind(assets), drawEffect = assets.drawEffect.bind(assets);
assets.draw = (ctx, id, x, y, options = {}) => {
    assert(catalog.sprites[id], id); assert(readyImages.has(catalog.sprites[id].image), `${id}: source image must be preloaded in this chapter`); assert(Number.isInteger(x) && Number.isInteger(y), `${id}: integer anchor`); spriteDraws++;
    if (options.sourceRect) {
      const [x, y, w, h] = options.sourceRect, [sx, sy, sw, sh] = catalog.sprites[id].source_rect;
      assert(options.sourceRect.every(Number.isFinite) && w > 0 && h > 0 && x >= sx && y >= sy && x + w <= sx + sw && y + h <= sy + sh, `${id}: authored fragment stays in the designated source region`);
      authoredFragments++;
    }
    return draw(ctx, id, x, y, options);
};
assets.drawActor = (ctx, name, pose, direction, x, y, options = {}) => {
    assert(catalog.sprites[`character-${name.toLowerCase()}-${direction}-${pose}`], `${name}:${pose}`);
    assert(Number.isInteger(x) && Number.isInteger(y), 'integer actor anchor');
    actorDraws++;
    return drawActor(ctx, name, pose, direction, x, y, options);
};
assets.drawEffect = (ctx, group, elapsed, x, y, options) => {
  assert(catalog.animations[group], group); assert(readyImages.has(catalog.sprites[catalog.animations[group].frames[0]].image), `${group}: ambient/skill atlas must be preloaded`); assert([elapsed, x, y].every(Number.isFinite)); effectDraws++;
  return drawEffect(ctx, group, elapsed, x, y, options);
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
// Advance the actual world with a command preview open. Observe source crops
// emitted by the complete renderer/AssetLibrary path during movement and jump.
readyImages = new Set(sceneImageKeys(CHAPTERS[0]));
const motionCore = new GameCore({ persist: false });
const motionWorld = new GameWorld(motionCore, getMap(CHAPTERS[0].id), { expanded: true, compilePrompt });
assert(motionWorld.selectTeammate('Grok'));
const start = calls.length;
for (let tick = 0; tick < 120; tick++) {
  motionWorld.update(1 / 60, { right: true });
  if (tick % 6 === 0) renderer.render(motionWorld, motionCore.view());
}
const playerImage = assets.images.get('deepseek-actions');
const playerCropsSince = index => new Set(calls.slice(index).filter(call => call.name === 'actors' && call.key === 'drawImage' && call.args[0] === playerImage).map(call => call.args.slice(1, 5).join(',')));
const crop = pose => catalog.sprites[`character-deepseek-right-${pose}`].content_rect.join(',');
const walkingCrops = playerCropsSince(start);
assert(walkingCrops.has(crop('walk')), 'Live walking renders the authored same-direction gait pose');
assert(!walkingCrops.has(crop('skill')), 'A selected command cannot lock walking to the skill cell');
const jumpStart = calls.length;
for (let tick = 0; tick < 190; tick++) {
  motionWorld.update(1 / 60, { jump: true, jumpPressed: tick === 0 });
  if (tick % 4 === 0) renderer.render(motionWorld, motionCore.view());
}
const jumpingCrops = playerCropsSince(jumpStart);
assert(jumpingCrops.has(crop('jump')) && jumpingCrops.has(crop('fall')), 'Live jumping renders ascent and descent with the preview still open');
assert(motionWorld.commandPreview, 'Regression keeps the command preview open');
const library = new AssetLibrary(catalog, new URL('../assets/runtime-catalog.json', import.meta.url));
library.images.set('harbor-kit', {});
library.draw(context('crop-contract'), 'scene-water-channel', 80, 90, { sourceRect: [583, 327, 23, 26], width: 6, height: 6 });
assert.deepEqual(calls.find(call => call.name === 'crop-contract' && call.key === 'drawImage').args.slice(1, 5), [583, 327, 23, 26], 'Asset adapter samples the requested original PNG fragment');
console.log(`PASS desktop 2×+, mobile 1.5–2×, independent layers, PNG-only scene decoration, exact range masks, ${previews} command previews and original atlas crops (${actorDraws} actors / ${spriteDraws} sprites). No browser screenshot was taken.`);
