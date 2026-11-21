/**
 * AI crew agency regressions: order receipts, completion callouts and
 * safe autonomous observations. These checks never move actors or spend
 * resources; they assert that visible cooperation is additive only.
 */
import assert from 'node:assert/strict';
import { CHAPTERS } from '../src/core/chapters.mjs';
import { GameCore } from '../src/core/state.mjs';
import { getMap } from '../src/game/maps.mjs';
import { GameWorld, routeFor } from '../src/game/world.mjs';
import { chapterCheckpoint } from '../src/game/session.mjs';

const DT = 1 / 60;
const fixture = (index = 0) => {
  const events = [];
  const core = new GameCore({ checkpoint: chapterCheckpoint(CHAPTERS[index].id), persist: false });
  const world = new GameWorld(core, getMap(CHAPTERS[index].id), {
    expanded: true, onEvent: (type, payload) => events.push({ type, payload }),
  });
  return { world, core, events };
};
const step = (world, input = {}) => assert(!world.update(DT, input)?.rebuild, 'Unexpected retry');
const advance = (world, seconds, input = {}) => {
  for (let i = 0; i < Math.ceil(seconds / DT); i++) step(world, input);
};
const walk = (world, x) => {
  for (let i = 0; i < 900; i++) {
    const dx = x - world.player.x;
    if (Math.abs(dx) < 3 && Math.abs(world.player.vx) < 15) return;
    step(world, { left: dx < -2, right: dx > 2 });
  }
  assert.fail(`walk blocked ${world.currentRoom.id}: ${world.player.x} => ${x}`);
};
const go = (world, target) => {
  const route = routeFor(world.platforms, world.map.ladders, world.player, target);
  assert(route, `No static route to ${JSON.stringify(target)}`);
  for (const point of route) {
    walk(world, point.x);
    if (point.climb) {
      for (let i = 0; i < 600 && Math.abs(world.player.y - point.y) > 2; i++) {
        step(world, { up: world.player.y > point.y, down: world.player.y < point.y });
      }
      assert(Math.abs(world.player.y - point.y) < 3, 'climb blocked');
      advance(world, .1);
    }
  }
  walk(world, target.x);
};
const waitTask = (world, name, seconds = 20) => {
  for (let i = 0; i < seconds / DT && world.crew.find((c) => c.name === name).task; i++) step(world);
  assert(!world.crew.find((c) => c.name === name).task, 'task timeout');
};
const passed = [];
const test = (name, fn) => { fn(); passed.push(name); console.log('PASS ' + name); };

test('confirmed orders expose accepted/travel/done receipts without extra receipts', () => {
  const { world, core, events } = fixture(0);
  go(world, { x: 390, y: 490 });
  advance(world, 1);
  const actor = world.crew.find((entry) => entry.name === 'Grok');
  const receiptsBefore = world.receipts.length;
  world.selectTeammate('Grok');
  world.selectTarget('paper-window');
  assert(world.confirmCommand(false), 'command should be accepted');
  assert.equal(actor.order?.stage, 'accepted');
  const snapshot = world.snapshot();
  const crewRow = snapshot.crew.find((entry) => entry.name === 'Grok');
  assert.equal(crewRow.stage, 'travel');
  assert.equal(crewRow.order.stage, 'accepted');
  assert.equal(snapshot.cooperation.orders, 1);
  assert(events.some((event) => event.type === 'dialogue' && event.payload.character === 'Grok'));
  waitTask(world, 'Grok');
  assert.equal(actor.order.stage, 'done');
  assert(world.receipts.length === receiptsBefore + 1, 'exactly one mission receipt');
  assert(world.cooperationSummary().completed >= 1);
  assert(world.cooperationSummary().perCrew.Grok.orders === 1);
  // The after-action report reads these rows verbatim, so they must carry the
  // player's request and the crew's result.
  const reportRow = world.cooperationSummary().receipts[0];
  assert.equal(reportRow.teammate, 'Grok');
  assert(reportRow.promptText, 'report row keeps the player prompt text');
  assert.match(reportRow.outcome, /障碍|节点/);
  assert(events.some((event) => event.type === 'dialogue' && event.payload.text.includes('开了')));
  assert.equal(core.view().campaign.totalScore, 0);
});

test('default and precise orders produce visibly different acceptance receipts', () => {
  const defaultRun = fixture(0);
  go(defaultRun.world, { x: 390, y: 490 });
  advance(defaultRun.world, 1);
  defaultRun.world.selectTeammate('Grok');
  defaultRun.world.selectTarget('paper-window');
  assert(defaultRun.world.confirmCommand(false));
  const wide = defaultRun.world.crew.find((entry) => entry.name === 'Grok').order.text;

  const preciseRun = fixture(0);
  go(preciseRun.world, { x: 390, y: 490 });
  advance(preciseRun.world, 1);
  preciseRun.world.selectTeammate('Grok');
  preciseRun.world.selectTarget('paper-window');
  assert(preciseRun.world.confirmCommand(true));
  const narrow = preciseRun.world.crew.find((entry) => entry.name === 'Grok').order.text;
  assert.notEqual(wide, narrow);
  assert(wide.includes('预览范围'));
  assert(narrow.includes('标记'));
});

test('GLM autonomously marks a nearby trap without moving the crew or spending resources', () => {
  const { world, core } = fixture(2);
  const trap = world.traps.find((entry) => entry.id === 'review-bridge-trap');
  assert(trap, 'chapter-three main trap exists');
  Object.assign(world.player, { x: 720, y: 380, vx: 0, vy: 0, grounded: true, climbing: false });
  world.crew.forEach((actor) => { actor.task = null; actor.status = 'following'; actor.lastCallAt = -100; });
  const positions = world.crew.map((actor) => `${actor.x}:${actor.y}`);
  const tokens = core.view().attempt.aiTokens;
  const score = core.view().campaign.totalScore;
  const exposure = core.view().attempt.exposureDelta;
  world.time = 0;
  world.nextAutoCall = 0;
  world.autoIndex = world.crew.findIndex((actor) => actor.name === 'GLM');
  world.autonomyTick(core.view());
  assert.equal(world.autoAssists, 1);
  assert(trap.revealedUntil > world.time, 'trap is revealed by the autonomous scan');
  // The settlement cards need a human-readable line, not just a counter.
  assert.equal(world.cooperationSummary().autoLog.at(-1)?.name, 'GLM');
  assert.match(world.cooperationSummary().autoLog.at(-1)?.text || '', /陷阱/);
  assert.equal(core.view().attempt.aiTokens, tokens);
  assert.equal(core.view().campaign.totalScore, score);
  assert.equal(core.view().attempt.exposureDelta, exposure);
  assert.deepEqual(world.crew.map((actor) => `${actor.x}:${actor.y}`), positions);
});

test('Claude autonomously watches a nearby guard without moving anyone', () => {
  const { world, core } = fixture(1);
  const guard = world.guards.find((entry) => entry.id === 'resume-west-guard');
  assert(guard, 'chapter-two west guard exists');
  Object.assign(world.player, { x: 430, y: 490, vx: 0, vy: 0, grounded: true, climbing: false });
  world.crew.forEach((actor) => { actor.task = null; actor.status = 'following'; actor.lastCallAt = -100; });
  const positions = world.crew.map((actor) => `${actor.x}:${actor.y}`);
  const score = core.view().campaign.totalScore;
  world.time = 0;
  world.nextAutoCall = 0;
  world.autoIndex = world.crew.findIndex((actor) => actor.name === 'Claude');
  world.autonomyTick(core.view());
  assert.equal(world.autoAssists, 1);
  assert(guard.scoutedUntil > world.time, 'guard carries a scouted marker');
  assert.equal(core.view().campaign.totalScore, score);
  assert.deepEqual(world.crew.map((actor) => `${actor.x}:${actor.y}`), positions);
});

console.log(`Crew agency: ${passed.length} checks passed.`);
