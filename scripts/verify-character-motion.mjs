import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sampleCharacterMotion, drawCharacterMotionFX } from '../src/render/character-motion.mjs';
import { AssetLibrary } from '../src/render/assets.mjs';

const player = Object.freeze({ name: 'DeepSeek', isPlayer: true, x: 100.25, y: 500.75, direction: 'right', pose: 'idle', grounded: true });
const world = Object.freeze({ time: 3, crew: [] });
const sample = (actor = player, scene = world, options = {}) => sampleCharacterMotion(actor, scene, options);
const definitions = [
  ['idle', player, world, 4, 8],
  ['walk', { ...player, pose: 'walk', vx: 200 }, world, 6, 10],
  ['jump', { ...player, pose: 'jump', grounded: false, vy: -250 }, world, 3, 10],
  ['dash', { ...player, pose: 'skill', dashTime: .16 }, world, 4, 16],
  ['interact', player, { ...world, interaction: { target: 'analysis-station', progress: .4 } }, 4, 10],
  ['hurt', { ...player, hurtUntil: 3.65 }, world, 2, 10],
  ['board', player, { ...world, interaction: { target: 'board', progress: .6 } }, 4, 10],
];
for (const [state, actor, scene, frames, fps] of definitions) {
  const before = JSON.stringify({ actor, scene });
  const result = sample(actor, scene);
  assert.equal(result.state, state); assert.equal(result.frames, frames); assert.equal(result.fps, fps);
  assert(result.frame >= 0 && result.frame < frames);
  assert(['idle', 'walk', 'jump', 'fall', 'skill'].includes(result.pose), 'Only supplied atlas poses are selected');
  for (const key of ['xOffset', 'yOffset']) assert(Number.isInteger(result[key]), `${key} keeps a crisp logical anchor`);
  assert(result.scaleX >= .95 && result.scaleX <= 1.04); assert(result.scaleY >= .96 && result.scaleY <= 1.04);
  assert.equal(JSON.stringify({ actor, scene }), before, 'Sampling does not mutate game state');
  const reduced = sample(actor, scene, { reduceMotion: true });
  assert.equal(reduced.xOffset, 0); assert.equal(reduced.yOffset, 0); assert.equal(reduced.rotation, 0);
  assert.equal(reduced.scaleX, 1); assert.equal(reduced.scaleY, 1); assert.equal(reduced.opacity, 1);
  assert.equal(reduced.flash, 0); assert.deepEqual(reduced.trail, []);
}

// Loop cadence must be display-rate independent, with all beats reachable.
for (const [state, actor, scene, frames, fps] of definitions.filter(row => ['idle', 'walk'].includes(row[0]))) {
  const seen = new Set(Array.from({ length: frames }, (_, index) => sample(actor, scene, { time: index / fps }).frame));
  assert.equal(seen.size, frames, `${state} exposes every discrete frame`);
  assert.equal(sample(actor, scene, { time: .001 }).frame, sample(actor, scene, { time: .02 }).frame, `${state} holds a frame between ticks`);
}
assert.deepEqual(sample(player, world), sample(player, world), 'Sampling is deterministic');
assert.equal(sample({ ...player, pose: 'jump', grounded: false, vy: -240 }).frame, 0);
assert.equal(sample({ ...player, pose: 'jump', grounded: false, vy: 0 }).frame, 1);
assert.equal(sample({ ...player, pose: 'fall', grounded: false, vy: 240 }).frame, 2);
assert(sample({ ...player, dashTime: .1 }).trail.every(trail => trail.xOffset < 0));
assert(sample({ ...player, dashTime: .1, direction: 'left' }).trail.every(trail => trail.xOffset > 0));
assert(sample({ ...player, hurtUntil: 3.7 }).flash > .9);
assert.equal(sample({ ...player, hurtUntil: 3.4 }).flash, 0, 'The white flash only lasts 120 ms');
assert.equal(sample(player, { ...world, interaction: { target: 'board', progress: .99 } }).frame, 3);
assert.equal(sample(player, { ...world, interaction: { target: 'delivery', progress: .6 } }).state, 'interact', 'Delivery is not confused with boarding');
assert.equal(sample({ ...player, carryCount: 2 }).action, 'carry');
assert.equal(sample(player, { ...world, selected: 'Grok' }).action, null, 'Selection alone does not perform a skill');
const previewWorld = { ...world, selected: 'Grok', commandPreview: { teammate: 'Grok' } };
assert.equal(sample(player, previewWorld).action, 'command');
for (const [pose, grounded, vy] of [['walk', true, 0], ['jump', false, -250], ['fall', false, 250]]) {
  const actor = { ...player, pose, grounded, vy, vx: 200 };
  const result = sample(actor, previewWorld);
  assert.equal(result.state, pose === 'walk' ? 'walk' : 'jump', 'Command preview cannot mask movement');
  assert.equal(result.action, null, 'Movement does not carry a command console');
  if (pose === 'fall') assert.equal(sample(actor, previewWorld, { reduceMotion: true }).pose, 'fall', 'Reduced motion preserves descent');
}
assert.equal(sample({ ...player, pose: 'skill', dashTime: .15 }, previewWorld).action, null, 'Player dash is not a teammate command');
assert.equal(sample({ ...player, carryCount: 2, pose: 'walk', vx: 200 }, previewWorld).action, 'carry', 'Cargo stays visible during movement');
assert.equal(sample({ ...player, isPlayer: false, name: 'Grok', pose: 'skill', task: { stage: 'execute', stageTime: .2 } }).fps, 16);

// Verify actual drawImage source regions through the production adapter, not
// a stub that merely echoes the sampler's frame number.
const catalog = JSON.parse(await readFile(new URL('../assets/runtime-catalog.json', import.meta.url), 'utf8'));
const library = new AssetLibrary(catalog, new URL('../assets/runtime-catalog.json', import.meta.url));
for (const key of Object.keys(catalog.images)) library.images.set(key, { key });
const crops = [];
const raster = { globalAlpha: 1, save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, drawImage(...args) { crops.push(args); } };
const used = new Set();
for (const name of ['DeepSeek', 'Grok', 'Claude', 'GLM']) for (const direction of ['left', 'right']) {
  const actor = { ...player, name, direction };
  const draw = (changes, scene = world, options = {}) => {
    const motion = sample({ ...actor, ...changes }, scene, options);
    const id = `character-${name.toLowerCase()}-${direction}-${motion.pose}`;
    library.drawActor(raster, name, motion.pose, direction, 100, 500);
    const args = crops.at(-1), sprite = catalog.sprites[id];
    assert.deepEqual(args.slice(1, 5), sprite.content_rect, `${id}: actual crop`);
    assert(Math.abs(args[7] / args[3] - sprite.native_scale) < 1e-10, `${id}: uniform native scale`);
    assert.equal(args[6] + args[8], 0, `${id}: bottom-centre foot anchor`);
    used.add(id);
    return { pose: motion.pose, crop: args.slice(1, 5).join(',') };
  };
  draw({});
  const walking = Array.from({ length: 6 }, (_, frame) => draw({ pose: 'walk', vx: 200 }, world, { time: (frame + .01) / 10 }));
  assert.equal(new Set(walking.map(result => result.crop)).size, 1, `${name}/${direction}: walking retains its authored facing/silhouette`);
  assert(walking.every(result => result.pose === 'walk'), `${name}/${direction}: no idle weapon swap inside the stride`);
  const dash = [0, .07, .13, .20].map(elapsed => draw({ pose: 'skill', dashTime: .22 - elapsed }).pose);
  assert.deepEqual(dash, ['skill', 'skill', 'skill', 'skill'], 'An active dash never cuts back to a walking silhouette');
  const jump = [-250, 0, 250].map(vy => draw({ pose: vy > 0 ? 'fall' : 'jump', grounded: false, vy }).pose);
  assert.deepEqual(jump, ['jump', 'jump', 'fall']);
  const interact = [.05, .35, .65, .95].map(progress => draw({}, { ...world, interaction: { target: 'delivery', progress } }).pose);
  assert.deepEqual(interact, ['idle', 'skill', 'skill', 'idle'], 'Held interaction has entry and recovery beats');
  const boarding = [.05, .35, .65, .95].map(progress => draw({}, { ...world, interaction: { target: 'board', progress } }).pose);
  assert.deepEqual(boarding, ['idle', 'walk', 'jump', 'fall']);
  for (const time of [0, .2, 1.2]) assert.equal(sample({ ...actor, pose: 'walk' }, world, { time, reduceMotion: true }).pose, 'walk');
}
assert.equal(used.size, 40, 'All four characters, both directions and five supplied poses reach drawImage');
// Reproduce the reported Grok defect across several complete strides, not
// merely a set of declared frame indices. Check the real drawImage regions.
for (const direction of ['left', 'right']) {
  const actor = { ...player, name: 'Grok', isPlayer: false, direction, pose: 'walk' };
  const expected = catalog.sprites[`character-grok-${direction}-walk`].content_rect;
  for (let tick = 0; tick < 180; tick++) {
    const motion = sample(actor, { time: tick / 60 });
    library.drawActor(raster, actor.name, motion.pose, actor.direction, 100 + tick, 500);
    assert.deepEqual(crops.at(-1).slice(1, 5), expected, `Grok ${direction}: stride must never select an idle/opposite-direction cell`);
    assert.equal(motion.scaleX, 1, 'Walking preserves body and weapon proportions');
    assert.equal(motion.scaleY, 1, 'Walking preserves body and weapon proportions');
    assert(Math.abs(motion.yOffset) <= 1, 'Walking avoids excessive whole-body bouncing');
  }
  assert.equal(sample({ ...actor, pose: 'idle' }).pose, 'idle', 'Stopping restores the idle pose');
  const frames = [];
  for (let tick = 0; tick < 72; tick++) {
    const motion = sample({ ...actor, pose: 'skill', task: { stage: 'execute', stageTime: tick / 60 } });
    assert.equal(motion.pose, 'skill', 'Grok holds his active strike rather than swapping his axe every 250 ms');
    frames.push(motion.frame);
  }
  assert(frames.every((frame, index) => index === 0 || frame >= frames[index - 1]), 'Grok charge settles without repeating anticipation');
}
for (const name of ['Claude', 'GLM']) {
  const taskPose = stageTime => sample({ ...player, name, isPlayer: false, pose: 'skill', task: { stage: 'execute', stageTime } }).pose;
  assert.equal(taskPose(.02), 'idle', 'Task starts with anticipation');
  for (const elapsed of [.15, .4, .8, 1.2, 1.6]) assert.equal(taskPose(elapsed), 'skill', 'Long action does not restart anticipation');
  if (name === 'GLM') assert.equal(taskPose(1.9), 'idle', 'Scan recovers before completing');
}

// Effects must select genuine atlas regions, expose all four artwork frames,
// and avoid painting substitute canvas shapes.
const calls = [];
const ctx = new Proxy({}, { get: (target, key) => target[key] || ((...args) => calls.push([key, ...args])) });
const artCalls = [];
const assets = { catalog,
  draw(context, id, x, y) { assert(catalog.sprites[id], id); assert(Number.isInteger(x) && Number.isInteger(y)); artCalls.push({ id, x, y }); },
  drawEffect(context, group, elapsed, x, y) { assert(catalog.animations[group], group); assert(Number.isInteger(x) && Number.isInteger(y)); artCalls.push({ group, frame: Math.floor(elapsed * catalog.animations[group].fps) }); },
};
for (const name of ['Grok', 'Claude', 'GLM']) {
  const actor = { ...player, name, isPlayer: false, pose: 'skill', task: { stage: 'execute', stageTime: .15 } };
  const motion = sample(actor);
  const before = artCalls.length;
  for (let frame = 0; frame < 4; frame++) {
    const current = name === 'Grok' ? { ...actor, task: { ...actor.task, stageTime: frame / catalog.animations['axe-impact'].fps } } : actor;
    drawCharacterMotionFX(ctx, current, world, { ...motion, frame }, assets);
  }
  const group = name === 'Grok' ? 'axe-impact' : name === 'Claude' ? 'paper-decoy' : 'scan-grid';
  assert.deepEqual([...new Set(artCalls.slice(before).filter(call => call.group === group).map(call => call.frame))], [0, 1, 2, 3], `${name} uses all supplied effect frames`);
}
const settledGrok = { ...player, name: 'Grok', isPlayer: false, pose: 'skill', task: { stage: 'execute', stageTime: .75 } };
const flowingGrok = { ...settledGrok, task: { ...settledGrok.task, stageTime: .875 } };
assert.equal(sample(settledGrok).frame, sample(flowingGrok).frame, 'The body holds the settled strike beat');
const effectStart = artCalls.length;
for (const actor of [settledGrok, flowingGrok]) drawCharacterMotionFX(ctx, actor, world, sample(actor), assets);
assert.equal(new Set(artCalls.slice(effectStart).filter(call => call.group === 'water-dash').map(call => call.frame % 4)).size, 2, 'Water keeps flowing while Grok holds his strike pose');
assert.equal(calls.length, 0, 'Character feedback delegates to PNG assets rather than canvas geometry');
const beforeReduced = artCalls.length;
drawCharacterMotionFX(ctx, player, world, sample(player, { ...world, selected: 'Grok' }, { reduceMotion: true }), assets);
assert.equal(artCalls.length, beforeReduced, 'Reduced-motion sampling also suppresses animated effects');
console.log('PASS 40 real character crops, 360 Grok directional walking draws, stable body/weapon silhouettes, one-shot charges, interactions, command priority, effects and reduced motion.');
