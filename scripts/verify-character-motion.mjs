import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sampleCharacterMotion, drawCharacterMotionFX } from '../src/render/character-motion.mjs';

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
for (const [state, actor, scene, frames, fps] of definitions.filter(row => ['idle', 'walk', 'interact'].includes(row[0]))) {
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
assert.equal(sample(player, { ...world, selected: 'Grok' }).action, 'command');
assert.equal(sample({ ...player, isPlayer: false, name: 'Grok', pose: 'skill', task: { stage: 'execute', stageTime: .2 } }).fps, 16);

// Effects must select genuine atlas regions, expose all four artwork frames,
// and avoid painting substitute canvas shapes.
const calls = [];
const ctx = new Proxy({}, { get: (target, key) => target[key] || ((...args) => calls.push([key, ...args])) });
const artCalls = [];
const catalog = JSON.parse(await readFile(new URL('../assets/runtime-catalog.json', import.meta.url), 'utf8'));
const assets = { catalog,
  draw(context, id, x, y) { assert(catalog.sprites[id], id); assert(Number.isInteger(x) && Number.isInteger(y)); artCalls.push({ id, x, y }); },
  drawEffect(context, group, elapsed, x, y) { assert(catalog.animations[group], group); assert(Number.isInteger(x) && Number.isInteger(y)); artCalls.push({ group, frame: Math.floor(elapsed * catalog.animations[group].fps) }); },
};
for (const name of ['Grok', 'Claude', 'GLM']) {
  const actor = { ...player, name, isPlayer: false, pose: 'skill', task: { stage: 'execute', stageTime: .15 } };
  const motion = sample(actor);
  const before = artCalls.length;
  for (let frame = 0; frame < 4; frame++) drawCharacterMotionFX(ctx, actor, world, { ...motion, frame }, assets);
  const group = name === 'Grok' ? 'axe-impact' : name === 'Claude' ? 'paper-decoy' : 'scan-grid';
  assert.deepEqual([...new Set(artCalls.slice(before).filter(call => call.group === group).map(call => call.frame))], [0, 1, 2, 3], `${name} uses all supplied effect frames`);
}
assert.equal(calls.length, 0, 'Character feedback delegates to PNG assets rather than canvas geometry');
const beforeReduced = artCalls.length;
drawCharacterMotionFX(ctx, player, world, sample(player, { ...world, selected: 'Grok' }, { reduceMotion: true }), assets);
assert.equal(artCalls.length, beforeReduced, 'Reduced-motion sampling also suppresses animated effects');
console.log('PASS character loops, cadence, state priority, crisp offsets, all four PNG skill frames, reduced motion and physics immutability.');
