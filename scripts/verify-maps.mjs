/**
 * Static map-contract checks only. This does not run player physics, enemy AI,
 * command logic or a simulated playthrough. A connected ladder graph is a
 * geometric sanity check; actual controls and collisions still need playtesting.
 */
import assert from 'node:assert/strict';
import { CHAPTERS } from '../src/core/chapters.mjs';
import { MAPS, getMap } from '../src/game/maps.mjs';

const WIDTH = 1280;
const WORLD_TOP = 95;
const FLOOR_Y = 600;
const HALF_ACTOR = 14;
const arrays = ['platforms', 'ladders', 'barriers', 'gates', 'plates', 'items',
  'supplies', 'targets', 'guards', 'traps', 'alarms', 'decoration'];
const finite = (value, label) => assert(Number.isFinite(value), label + ' must be finite');
const sameIds = (actual, expected, label) =>
  assert.deepEqual(actual.map((entry) => entry.id).sort(),
    expected.map((entry) => entry.id).sort(), label);
const supports = (platforms, x, y, margin = HALF_ACTOR) =>
  platforms.filter((surface) => surface.kind !== 'lift'
    && Math.abs(surface.y - y) <= 1
    && x - margin >= surface.x && x + margin <= surface.x + surface.w);
const samePoint = (a, b) => a.x === b.x && a.y === b.y;

assert.equal(MAPS.length, 5, 'Five maps are required');
sameIds(MAPS, CHAPTERS, 'Map IDs must cover the chapter IDs exactly');
assert.equal(getMap('does-not-exist'), null);

for (const chapter of CHAPTERS) {
  const layout = getMap(chapter.id);
  const prefix = chapter.id + ': ';
  assert(layout && layout.name === chapter.name, prefix + 'chapter name');
  assert.equal(typeof layout.subtitle, 'string');
  assert.match(layout.tint, /^#[0-9a-f]{6}$/i);
  for (const category of arrays) {
    assert(Array.isArray(layout[category]), prefix + category + ' must be an array');
    const ids = layout[category].map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, prefix + category + ' duplicate IDs');
    for (const entry of layout[category]) {
      assert.equal(typeof entry.id, 'string');
      finite(entry.x, prefix + entry.id + '.x');
      finite(entry.y, prefix + entry.id + '.y');
      assert(entry.x >= 0 && entry.x <= WIDTH, prefix + entry.id + ' horizontal bounds');
      assert(entry.y >= WORLD_TOP && entry.y <= FLOOR_Y, prefix + entry.id + ' world bounds');
    }
  }

  for (const point of ['spawn', 'boat', 'broadcast', 'beacon']) {
    finite(layout[point].x, prefix + point + '.x');
    finite(layout[point].y, prefix + point + '.y');
    assert(supports(layout.platforms, layout[point].x, layout[point].y).length,
      prefix + point + ' must stand on a static platform');
  }
  assert(samePoint(layout.spawn, { x: 120, y: 600 }), prefix + 'spawn baseline');
  assert(samePoint(layout.boat, { x: 85, y: 600 }), prefix + 'boat baseline');
  assert(layout.platforms.some((surface) => surface.x === 0 && surface.y === FLOOR_Y
    && surface.w === WIDTH && surface.h >= 20), prefix + 'full-width floor');

  for (const surface of layout.platforms) {
    finite(surface.w, prefix + surface.id + '.w');
    finite(surface.h, prefix + surface.id + '.h');
    assert(surface.w > HALF_ACTOR * 2 && surface.h > 0, prefix + surface.id + ' size');
    assert(surface.x + surface.w <= WIDTH, prefix + surface.id + ' right edge');
    assert(surface.y + surface.h <= 620, prefix + surface.id + ' enters touch-control area');
    assert(['stone', 'thin', 'lift'].includes(surface.kind ?? 'stone'), prefix + 'platform kind');
    if (surface.kind === 'lift') {
      finite(surface.minY, prefix + surface.id + '.minY');
      finite(surface.maxY, prefix + surface.id + '.maxY');
      finite(surface.period, prefix + surface.id + '.period');
      assert(surface.minY >= WORLD_TOP && surface.maxY <= FLOOR_Y,
        prefix + surface.id + ' lift travel bounds');
      assert(surface.minY < surface.maxY && surface.period > 0,
        prefix + surface.id + ' lift travel/period');
      assert(surface.y >= surface.minY && surface.y <= surface.maxY,
        prefix + surface.id + ' initial lift position');
    }
  }

  sameIds(layout.items, [...chapter.requiredItems, ...chapter.optionalItems], prefix + 'item IDs');
  sameIds(layout.supplies, chapter.supplies, prefix + 'supply IDs');
  sameIds(layout.targets, chapter.commandTargets, prefix + 'command-target IDs');
  const expectedItems = new Map([...chapter.requiredItems, ...chapter.optionalItems]
    .map((entry) => [entry.id, entry]));
  for (const entry of layout.items) {
    const expected = expectedItems.get(entry.id);
    assert.equal(entry.kind, expected.kind, prefix + entry.id + ' kind');
    assert.equal(entry.optional, expected.optional, prefix + entry.id + ' optional flag');
  }
  for (const entry of [...layout.items, ...layout.supplies, ...layout.targets, ...layout.alarms]) {
    assert(supports(layout.platforms, entry.x, entry.y).length,
      prefix + entry.id + ' must have a supported feet/baseline position');
  }
  for (const command of layout.targets) {
    const expected = chapter.commandTargets.find((entry) => entry.id === command.id);
    assert.equal(command.teammate, expected.teammate, prefix + command.id + ' teammate');
    assert.equal(command.effect, expected.effect, prefix + command.id + ' effect');
    assert(command.label.length > 0, prefix + command.id + ' label');
    if (command.teammate === 'Grok') {
      const obstacle = layout.barriers.find((entry) => entry.id === command.id);
      assert(obstacle && obstacle.targetId === command.id && obstacle.breakable === true,
        prefix + command.id + ' must address a real breakable barrier');
      assert.equal(command.y, obstacle.y + obstacle.h, prefix + command.id + ' barrier baseline');
    }
  }

  for (const obstacle of [...layout.barriers, ...layout.gates, ...layout.plates]) {
    assert(obstacle.w > 0 && obstacle.h > 0, prefix + obstacle.id + ' rectangle size');
    assert(obstacle.x + obstacle.w <= WIDTH && obstacle.y + obstacle.h <= FLOOR_Y,
      prefix + obstacle.id + ' rectangle bounds');
    assert(supports(layout.platforms, obstacle.x + obstacle.w / 2,
      obstacle.y + obstacle.h, 0).length, prefix + obstacle.id + ' rectangle support');
  }
  for (const gate of layout.gates) {
    const plate = layout.plates.find((entry) => entry.id === gate.plateId);
    assert(plate && plate.gateId === gate.id, prefix + gate.id + ' reciprocal plate link');
  }
  for (const plate of layout.plates) {
    assert(layout.gates.some((gate) => gate.id === plate.gateId && gate.plateId === plate.id),
      prefix + plate.id + ' reciprocal gate link');
  }
  for (const guard of layout.guards) {
    assert(guard.speed > 0 && guard.minX <= guard.x && guard.x <= guard.maxX,
      prefix + guard.id + ' patrol parameters');
    assert(supports(layout.platforms, guard.minX, guard.y).some((surface) =>
      guard.maxX + HALF_ACTOR <= surface.x + surface.w),
    prefix + guard.id + ' entire patrol must be supported');
  }
  for (const trap of layout.traps) {
    assert(trap.w > 0 && trap.x + trap.w <= WIDTH, prefix + trap.id + ' width');
    assert(supports(layout.platforms, trap.x + trap.w / 2, trap.y + 8, trap.w / 2).length,
      prefix + trap.id + ' trap top must sit 8px above a supported floor');
  }
  for (const piece of layout.decoration) {
    assert(piece.w > 0 && piece.h > 0 && piece.x + piece.w <= WIDTH
      && piece.y + piece.h <= 620, prefix + piece.id + ' decorative bounds');
    assert.equal(typeof piece.asset, 'string');
  }

  // Every static platform has a ladder route to/from the floor. Lifts are optional.
  // This verifies geometry, not the outcomes of traps, gates, commands or physics.
  const staticSurfaces = layout.platforms.filter((surface) => surface.kind !== 'lift');
  const graph = new Map(staticSurfaces.map((surface) => [surface.id, new Set()]));
  for (const rung of layout.ladders) {
    assert(rung.h > 0 && rung.y + rung.h <= FLOOR_Y, prefix + rung.id + ' ladder bounds');
    const upper = supports(staticSurfaces, rung.x, rung.y);
    const lower = supports(staticSurfaces, rung.x, rung.y + rung.h);
    assert(upper.length && lower.length, prefix + rung.id + ' must join supported platform tops');
    for (const a of upper) for (const b of lower) {
      graph.get(a.id).add(b.id);
      graph.get(b.id).add(a.id);
    }
  }
  const seen = new Set(['floor']);
  const queue = ['floor'];
  while (queue.length) {
    for (const next of graph.get(queue.shift()) ?? []) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  assert.equal(seen.size, staticSurfaces.length, prefix + 'disconnected static platform');
  for (const entry of [...layout.items, ...layout.supplies, ...layout.targets]) {
    assert(supports(staticSurfaces, entry.x, entry.y).some((surface) => seen.has(surface.id)),
      prefix + entry.id + ' ladder-graph access');
  }

  console.log(prefix + layout.items.length + ' items, ' + layout.targets.length
    + ' command targets, ' + staticSurfaces.length + ' connected static surfaces');
}

const report = getMap('public-report');
const finale = getMap('close-hatch');
assert(samePoint(report.beacon, finale.beacon), 'Chapters 4/5 share the remote beacon');
assert(samePoint(finale.beacon, { x: 1100, y: 270 }), 'Remote beacon placement');
assert(finale.items.every((entry) => Math.hypot(entry.x - finale.beacon.x,
  entry.y - finale.beacon.y) <= 100), 'Final three data pieces cluster near the remote beacon');
console.log('Map contract / ID coverage / static ladder geometry passed. No gameplay simulation was run.');
