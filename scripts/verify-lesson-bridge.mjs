/** Bridge checks use actual supported player states, not button events or synthetic key presses. */
import assert from 'node:assert/strict';
import { TutorialDirector } from '../src/game/tutorial.mjs';
import { LessonBridge } from '../src/game/lesson-bridge.mjs';
import { GameCore } from '../src/core/state.mjs';
import { GameWorld } from '../src/game/world.mjs';
import { getMap } from '../src/game/maps.mjs';
import { chapterCheckpoint } from '../src/game/session.mjs';
const failures = []; let passed = 0;
const test = (name, callback) => { try { callback(); passed++; console.log('PASS ' + name); } catch (error) { failures.push(name); console.error('FAIL ' + name + '\n' + error.stack); } };
const fixture = (chapter = 1) => {
  const tutorial = new TutorialDirector(chapter), state = { phase: 'playing', chapter: { id: tutorial.chapter, number: chapter },
    attempt: { attemptId: 'attempt-1', deliveredIds: [], deliveryIds: [] }, pendingResult: null };
  const world = { core: { view: () => structuredClone(state) }, currentRoom: { id: tutorial.chapter + ':room-1', index: 1 },
    map: { id: tutorial.chapter + ':room-1', ladders: [{ id: 'short-ladder', x: 240, y: 490, h: 110 }], targets: [{ id: 'training-target', teammate: chapter === 2 ? 'Claude' : 'GLM', x: 430, y: 490 }] },
    platforms: [{ id: 'floor', x: 0, y: 600, w: 1280 }, { id: 'west-deck', x: 180, y: 490, w: 140 }, { id: 'training-landing', x: 365, y: 490, w: 195 }],
    barriers: [{ id: 'paper-window', broken: false }], player: { x: 120, y: 600, w: 28, grounded: true, climbing: false, vy: 0 } };
  const bridge = new LessonBridge({ tutorial, world });
  const place = (patch, dt = 1 / 60) => { Object.assign(world.player, patch); return bridge.observe(world, dt); };
  const walk = () => { for (let x = 124; x <= 192; x += 4) place({ x }); };
  const climb = () => { place({ x: 240 }, .1); for (let y = 596; y >= 492; y -= 4) place({ y, grounded: false, climbing: true }); place({ y: 490, grounded: true, climbing: false }); };
  const jump = () => { for (let x = 244; x <= 312; x += 4) place({ x, y: 490, grounded: true, climbing: false, vy: 0 });
    place({ x: 324, y: 480, grounded: false, vy: -500 }); place({ x: 340, y: 460, vy: -250 });
    place({ x: 358, y: 463, vy: 100 }); place({ x: 376, y: 479, vy: 300 }); place({ x: 390, y: 490, grounded: true, vy: 0 }); };
  return { tutorial, world, state, bridge, place, walk, climb, jump };
};

test('movement and ladder lessons require actual arrival and actual ascent to supported platform', () => {
  const f = fixture(); assert.deepEqual(f.bridge.marker, { x: 190, y: 600, label: '沿地面走到这里',
    guideStep: { index: 0, text: '走到地面蓝色标记处。', total: 10 } });
  assert.equal(f.bridge.handleEvent('keydown', { key: 'right' }).ok, false); f.bridge.observe(); assert.equal(f.tutorial.current().id, 'move');
  f.walk(); assert.equal(f.tutorial.current().id, 'climb');
  f.place({ x: 240, y: 490 }, 1 / 60); assert.equal(f.tutorial.current().id, 'climb', 'teleporting onto platform is not climbing');
  f.place({ x: 240, y: 600 }, 1 / 60); f.climb(); assert.equal(f.tutorial.current().id, 'jump');
  assert.deepEqual(f.bridge.marker, { x: 380, y: 490, label: '跳过缺口，在对面落地',
    guideStep: { index: 2, text: '跳过安全缺口，在对面落地。', total: 10 } });
});
test('jump lesson needs an actual airborne arc across gap and landing on a different platform', () => {
  const f = fixture(); f.walk(); f.climb(); f.jump(); assert.equal(f.tutorial.current().id, 'node-first');
  const evidence = f.tutorial.serialize().verifiedEvents.jump.payload;
  assert.equal(evidence.fromPlatform, 'west-deck'); assert.equal(evidence.toPlatform, 'training-landing');
});
test('jump in place, falling into gap, air teleport and unsupported landing never satisfy gap lesson', () => {
  for (const mode of ['in-place', 'fall', 'teleport', 'unsupported']) {
    const f = fixture(); f.walk(); f.climb(); f.place({ x: 300 }, .3);
    if (mode === 'in-place') { f.place({ x: 305, y: 475, grounded: false, vy: -400 }); f.place({ x: 310, y: 470, vy: 100 }); f.place({ x: 310, y: 490, grounded: true, vy: 0 }); }
    if (mode === 'fall') { f.place({ x: 324, y: 492, grounded: false, vy: 20 }); f.place({ x: 345, y: 515, vy: 150 }); f.place({ x: 380, y: 600, grounded: true }, .2); }
    if (mode === 'teleport') { f.place({ x: 305, y: 475, grounded: false, vy: -400 }); f.place({ x: 1000, y: 490, grounded: true }, 1 / 60); }
    if (mode === 'unsupported') { f.place({ x: 320, y: 475, grounded: false, vy: -400 }); f.place({ x: 340, y: 460, vy: -100 }); f.place({ x: 345, y: 490, grounded: true, vy: 0 }); }
    assert.equal(f.tutorial.current().id, 'jump', mode);
  }
});
test('early valid actions are remembered without redoing them in tutorial order', () => {
  const f = fixture(); f.climb(); f.jump(); assert.equal(f.tutorial.current().id, 'move');
  f.place({ x: 120, y: 600 }, 0); f.walk();
  assert.equal(f.tutorial.current().id, 'node-first');
});
test('node, actual obstacle, delivery delta and board completion advance full remaining lesson chain', () => {
  const f = fixture(); f.walk(); f.climb(); f.jump();
  assert.equal(f.bridge.handleEvent('node-hit', { nodeId: 'node-1', hp: 1, attackId: 'dash-1', actor: 'DeepSeek' }).ok, true);
  assert.equal(f.bridge.handleEvent('node-open', { nodeId: 'node-1', hp: 0, attackId: 'dash-1', actor: 'DeepSeek' }).ok, false);
  assert.equal(f.bridge.handleEvent('node-open', { nodeId: 'node-1', hp: 0, attackId: 'dash-2', actor: 'DeepSeek' }).ok, true);
  assert.equal(f.bridge.handleEvent('command-receipt', { teammate: 'Grok', affected: { barriers: ['paper-window'] }, id: 'grok-1' }).ok, false);
  f.world.barriers[0].broken = true;
  assert.equal(f.bridge.handleEvent('command-receipt', { teammate: 'Grok', affected: { barriers: ['paper-window'] }, id: 'grok-1' }).ok, true);
  f.state.attempt.deliveredIds = ['harbor-data-1']; f.bridge.observe(); assert.equal(f.tutorial.current().id, 'delivery', 'item count alone cannot invent delivery');
  f.state.attempt.deliveredIds.push('harbor-data-2'); f.state.attempt.deliveryIds.push('delivery-real'); f.bridge.observe(); assert.equal(f.tutorial.current().id, 'board');
  assert.equal(f.bridge.handleEvent('board', {}).ok, false); f.state.phase = 'chapter-result'; f.state.pendingResult = { score: 80 }; f.bridge.observe(); assert.equal(f.tutorial.getState().done, true);
});
test('receipt adapter preserves Claude training budget source and GLM actual reveal count', () => {
  const f = fixture(2);
  assert.equal(f.bridge.handleEvent('command-receipt', { id: 'c0', teammate: 'Claude', precise: false, affectedCount: 2 }).ok, true);
  assert.equal(f.bridge.handleEvent('command-receipt', { id: 'c1', teammate: 'Claude', precise: true, affectedCount: 1 }).ok, false);
  assert.equal(f.bridge.handleEvent('command-receipt', { id: 'c2', teammate: 'Claude', precise: true, affectedCount: 1, budgetSource: 'training' }).ok, true);
  assert.equal(f.tutorial.getState().done, true);
  const g = fixture(3); assert.equal(g.bridge.handleEvent('command-receipt', { teammate: 'GLM', revealedCount: 0 }).ok, false);
  assert.equal(g.bridge.handleEvent('command-receipt', { teammate: 'GLM', revealedCount: 2, failed: true }).ok, false);
  assert.equal(g.bridge.handleEvent('command-receipt', { id: 'glm-real', teammate: 'GLM', revealedCount: 2 }).ok, true);
});
test('observing world is read-only, does not advance hint clocks and resets motion on attempt change', () => {
  const f = fixture(), before = JSON.stringify(f.world); f.bridge.observe(f.world, .5); assert.equal(JSON.stringify(f.world), before); assert.equal(f.tutorial.getState().idleSeconds, 0);
  f.state.attempt.attemptId = 'attempt-2'; f.place({ x: 190 }); assert.equal(f.tutorial.current().id, 'move');
  f.place({ x: 120 }, .5); f.walk(); assert.equal(f.tutorial.current().id, 'climb');
});
test('pausing while climbing preserves actual ascent evidence without counting idle time', () => {
  const f = fixture(); f.walk(); f.place({ x: 240 }, .1);
  for (let y = 596; y >= 500; y -= 4) f.place({ y, climbing: true, grounded: false });
  f.state.phase = 'paused'; f.bridge.observe(f.world, 0); f.bridge.observe(f.world, .5);
  f.state.phase = 'playing'; f.place({ y: 496, climbing: true, grounded: false }); f.place({ y: 492 });
  f.place({ y: 490, climbing: false, grounded: true }); assert.equal(f.tutorial.current().id, 'jump');
});

test('route demonstration requires two actual failures or an explicit request and never completes a lesson', () => {
  const f = fixture(); f.walk();
  f.tutorial.tick(25); assert.deepEqual(f.bridge.getRoute(), [], 'tool hint alone is not a route');
  f.tutorial.tick(0, { failed: true }); assert.deepEqual(f.bridge.getRoute(), []);
  f.tutorial.tick(0, { failed: true });
  const before = f.tutorial.serialize();
  assert.deepEqual(f.bridge.getRoute(), [{ x: 240, y: 600 }, { x: 240, y: 490 }]);
  assert.deepEqual(f.tutorial.serialize(), before); assert.equal(f.tutorial.current().id, 'climb');
  f.climb(); assert.deepEqual(f.bridge.getRoute(), [], 'completed action clears demonstration');
  f.tutorial.hint(); assert.deepEqual(f.bridge.getRoute(), [{ x: 308, y: 490 }, { x: 343, y: 438 }, { x: 380, y: 490 }]);
  assert.equal(f.tutorial.current().id, 'jump');
});

test('a return hint points at this room exit and follows actual descending ladders', () => {
  const f = fixture(); f.world.currentRoom = { id: 'paper-window:room-2', index: 2 };
  f.world.map.exits = [{ x: 65, y: 600, to: 'paper-window:room-1' }];
  f.world.player = { ...f.world.player, x: 430, y: 490 };
  f.tutorial.hint();
  assert.equal(f.bridge.marker.label, '从这里返回入港教学码头');
  assert.deepEqual(f.bridge.getRoute(), [{ x: 240, y: 490 }, { x: 240, y: 600 }, { x: 65, y: 600 }]);
  assert.equal(f.tutorial.current().id, 'move');
});

test('partial real chapter deliveries guide remaining nodes and rooms before permitting a boarding prompt', () => {
  const core = new GameCore({ persist: false }), tutorial = new TutorialDirector(1);
  const world = new GameWorld(core, getMap('paper-window'), { expanded: true });
  for (const [event, payload] of [
    ['move', { reached: true }], ['climb', { reached: true, grounded: true }], ['jump', { crossedGap: true, grounded: true }],
    ['node-hit', { nodeId: 'n', hp: 1, attackId: 'a' }], ['node-open', { nodeId: 'n', hp: 0, attackId: 'b' }],
    ['obstacle-broken', { teammate: 'Grok', broken: true }],
  ]) assert.equal(tutorial.handleEvent(event, payload).ok, true);
  const bridge = new LessonBridge({ tutorial, world }), ok = result => assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(tutorial.guideView().objectiveContinuation, true); assert.equal(bridge.marker.label, '打开这个必需资料节点');
  ok(core.pickup('harbor-data-1')); ok(core.deliver('delivery-1')); bridge.observe();
  assert.equal(tutorial.current().id, 'board', 'first real delivery still teaches delivery once');
  assert.equal(tutorial.guideView().index, 8, 'incomplete chapter keeps the displayed collection/delivery step');
  assert(tutorial.guideView().text.includes('已交 1/4')); assert.equal(bridge.marker.x, 500);
  assert(!tutorial.guideView().text.includes('再次按住互动登艇'));
  tutorial.hint(); assert(!tutorial.getState().hint.includes('再次按住互动登艇'), 'help must not use stale boarding instructions');
  ok(core.pickup('harbor-data-2')); ok(core.deliver('delivery-2')); bridge.observe();
  assert.equal(bridge.marker.x, 1170); assert(tutorial.guideView().text.includes('纸窗资料机房'));
  assert.equal(world.transitionRoom('to-action'), true); bridge.observe();
  assert.equal(bridge.marker.x, 430); assert.equal(tutorial.guideView().control, 'dash');
  ok(core.pickup('harbor-data-3')); bridge.observe(); assert.equal(bridge.marker.x, 1000);
  ok(core.pickup('harbor-data-4')); bridge.observe();
  assert.equal(bridge.marker.x, 65, 'once all missing data is carried, point to this room return exit');
  assert.equal(tutorial.guideView().control, 'interact');
  assert.equal(world.transitionRoom('to-harbor'), true); bridge.observe(); assert.equal(bridge.marker.x, 85);
  ok(core.deliver('delivery-final')); bridge.observe();
  assert(core.view().objectives.find(goal => goal.id === 'required-delivery').complete);
  assert.equal(tutorial.guideView().index, 8, 'a remaining command objective also blocks boarding guidance');
  assert.equal(bridge.marker.x, 442);
  assert.equal(tutorial.guideView().objectiveKey, 'objectives:effective-command');
  assert(tutorial.guideView().text.includes(core.view().objectives.find(goal=>goal.id==='effective-command').label));
  ok(core.prepareCommand({ commandId: 'real-grok', teammate: 'Grok', targetId: 'paper-window' }));
  ok(core.beginCommand('Grok')); ok(core.completeCommand('Grok', 'real-grok')); bridge.observe();
  assert(core.view().objectives.every(goal => goal.complete));
  assert.equal(tutorial.guideView().index, 9); assert(tutorial.guideView().text.includes('再次按住互动登艇'));
  assert.equal(bridge.marker.x, 85); assert.equal(tutorial.getState().hintLevel, 0);
});

test('a full backpack returns for delivery while a restored partial chapter rebuilds objective guidance', () => {
  const core = new GameCore({ persist: false }), tutorial = new TutorialDirector(1);
  for (const [event, payload] of [
    ['move', { reached: true }], ['climb', { reached: true, grounded: true }], ['jump', { crossedGap: true, grounded: true }],
    ['node-hit', { nodeId: 'n', hp: 1, attackId: 'a' }], ['node-open', { nodeId: 'n', hp: 0, attackId: 'b' }],
    ['obstacle-broken', { teammate: 'Grok', broken: true }], ['delivery', { count: 1, complete: true }],
  ]) assert.equal(tutorial.handleEvent(event, payload).ok, true);
  for (const id of ['harbor-data-1', 'harbor-data-2', 'harbor-extra-1']) assert.equal(core.pickup(id).ok, true);
  const restored = TutorialDirector.restore(tutorial.serialize());
  const world = new GameWorld(core, getMap('paper-window'), { expanded: true }), bridge = new LessonBridge({ tutorial: restored, world });
  assert.equal(restored.guideView().index, 8); assert(restored.guideView().text.includes('背包已满'));
  assert.equal(bridge.marker.x, 85); assert.equal(restored.guideView().control, 'interact');
  assert(!Object.hasOwn(restored.serialize(), 'objectiveGuide'), 'derived world guidance does not alter save format');
});

test('alternate main routes retire obsolete training without inventing tutorial completion or changing the game', () => {
  for (const [chapter, targetId] of [['resume-storm', 'cargo-divider'], ['review-quietly', 'return-divider']]) {
    const core = new GameCore({ checkpoint: chapterCheckpoint(chapter), persist: false });
    const world = new GameWorld(core, getMap(chapter), { expanded: true });
    const tutorial = new TutorialDirector({ chapter });
    assert(core.prepareCommand({ commandId: 'alternate-route', teammate: 'Grok', targetId }).ok);
    assert(core.beginCommand('Grok').ok); assert(core.completeCommand('Grok', 'alternate-route').ok);
    const before = core.exportRuntime(), bridge = new LessonBridge({ tutorial, world });
    assert(tutorial.getState().skipped); assert.deepEqual(tutorial.completed, []);
    assert.deepEqual(tutorial.verifiedEvents, {}); assert.equal(bridge.marker, null);
    assert.deepEqual(core.exportRuntime(), before, 'Teaching reconciliation cannot alter mission state or resources');
    assert.equal(core.board().ok, false, 'Required cargo must still be delivered');
  }
});

if (failures.length) { console.error(`Lesson bridge: ${passed} passed, ${failures.length} failed: ${failures.join(', ')}`); process.exitCode = 1; }
else console.log(`Lesson bridge: ${passed} passed.`);
