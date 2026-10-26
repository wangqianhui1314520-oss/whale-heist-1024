/** Regressions for playing past optional lessons, using real controller/world rules and synthetic saves. */
import assert from 'node:assert/strict';
import { harness } from './lib/main-harness.mjs';
import { TutorialDirector } from '../src/game/tutorial.mjs';
import { LessonBridge } from '../src/game/lesson-bridge.mjs';
import { GameCore } from '../src/core/state.mjs';
import { GameWorld } from '../src/game/world.mjs';
import { getMap } from '../src/game/maps.mjs';
import { chapterCheckpoint } from '../src/game/session.mjs';
import { RULES } from '../src/core/chapters.mjs';

let passed = 0, failed = 0;
async function test(name, run) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
function commandLesson(tutorial) {
  for (const [type, payload] of [
    ['move', { reached: true }], ['climb', { reached: true, grounded: true }],
    ['jump', { grounded: true, crossedGap: true }],
    ['node-hit', { nodeId: 'training-node', hp: 1, attackId: 'first-dash' }],
    ['node-open', { nodeId: 'training-node', hp: 0, attackId: 'second-dash' }],
  ]) assert.equal(tutorial.handleEvent(type, payload).ok, true);
  assert.equal(tutorial.current().id, 'grok-obstacle');
}
function fixture(chapter = 'paper-window') {
  const core = new GameCore({ checkpoint: chapterCheckpoint(chapter), persist: false });
  const world = new GameWorld(core, getMap(chapter), { expanded: true });
  const tutorial = new TutorialDirector(chapter);
  return { core, world, tutorial, bridge: new LessonBridge({ world, tutorial }) };
}

await test('all command guide stages allow a valid precise execution without mandatory tutorial clicks', async () => {
  for (const stage of [0, 1, 2, 3, 4]) {
    const { api } = await harness(); await api.startWorld({ showIntro: false });
    const { tutorial, world, core } = api.state;
    commandLesson(tutorial); tutorial.guidedCommandStage = stage;
    const before = core.view().attempt;
    await api.act('command-select', { teammate: 'Grok' });
    assert.equal(world.selected, 'Grok', `stage ${stage}`);
    await api.act('prompt-mode', { precise: true });
    assert.equal(world.promptConfig.precise, true, `stage ${stage}: precise plan is usable`);
    await api.act('command-confirm');
    assert(world.crew.find(actor => actor.name === 'Grok').task, `stage ${stage}: command starts`);
    assert.equal(api.state.ui.screen, 'none');
    assert.equal(core.view().attempt.aiTokens, before.aiTokens - RULES.aiTokenPreciseCost);
    assert.equal(core.view().attempt.qualifiers, before.qualifiers - 1);
    assert.equal(tutorial.current().id, 'grok-obstacle', 'clicks do not invent an obstacle completion');
    assert.equal(core.view().attempt.commandIds.length, before.commandIds.length + 1);
  }
});

await test('hidden hints, custom prompts and templates do not leave invisible tutorial locks', async () => {
  for (const route of ['prompt-parse', 'template-load']) {
    const { api } = await harness(); await api.startWorld({ showIntro: false });
    commandLesson(api.state.tutorial);
    await api.act('settings-change', { key: 'tutorialHints', value: false });
    await api.act('command-select', { teammate: 'Grok' });
    if (route === 'prompt-parse') await api.act(route, { text: 'Grok，撞开纸窗。' });
    else await api.act(route, { templateId: 'grok-default' });
    await api.act('command-confirm');
    assert(api.state.world.crew.find(actor => actor.name === 'Grok').task, route);
    assert.equal(api.state.ui.screen, 'none');
  }
});

await test('world resource and task rules still reject unavailable commands during the optional lesson', async () => {
  const { api } = await harness(); await api.startWorld({ showIntro: false });
  commandLesson(api.state.tutorial);
  await api.act('command-select', { teammate: 'Claude' });
  assert.notEqual(api.state.world.selected, 'Claude', 'locked teammates stay locked');
  api.state.core.configureAttempt({ qualifiers: 0 });
  await api.act('command-select', { teammate: 'Grok' });
  await api.act('prompt-mode', { precise: true });
  const before = api.state.core.view().attempt.aiTokens;
  await api.act('command-confirm');
  assert.equal(api.state.world.crew.find(actor => actor.name === 'Grok').task, null);
  assert.equal(api.state.core.view().attempt.aiTokens, before, 'invalid precise command spends nothing');
});

await test('leaving training retires stale lessons in all three chapters and does not invent learned actions', () => {
  for (const chapter of ['paper-window', 'resume-storm', 'review-quietly']) {
    const { world, tutorial, bridge } = fixture(chapter);
    world.loadRoom(world.rooms.find(room => room.index === 2));
    bridge.handleEvent('room-change');
    assert.equal(tutorial.getState().skipped, true, chapter);
    assert.deepEqual(tutorial.completed, []);
    assert.equal(bridge.marker, null); assert.deepEqual(bridge.getRoute(), []);
    world.loadRoom(world.rooms.find(room => room.index === 1)); bridge.observe();
    assert.equal(tutorial.current(), null, 'returning cannot resurrect the outdated exercise');
  }
});

await test('old saves with a broken paper window or cargo resume without impossible movement exercises', () => {
  for (const progress of ['barrier', 'cargo', 'delivery', 'room']) {
    const { world, tutorial } = fixture();
    if (progress === 'barrier') world.barriers.find(barrier => barrier.id === 'paper-window').broken = true;
    if (progress === 'cargo' || progress === 'delivery') assert.equal(world.core.pickup('harbor-data-1').ok, true);
    if (progress === 'delivery') assert.equal(world.core.deliver('early-delivery').ok, true);
    if (progress === 'room') world.loadRoom(world.rooms.find(room => room.index === 2));
    const restored = TutorialDirector.restore(tutorial.serialize());
    new LessonBridge({ world, tutorial: restored });
    assert.equal(restored.getState().skipped, true, progress);
    assert.deepEqual(restored.completed, [], 'retirement never forges completion evidence');
    assert.equal(TutorialDirector.restore(restored.serialize()).skipped, true);
  }
});

await test('a node opened by Grok cannot trap the independent two-dash exercise or point at a spent node', () => {
  const { world, tutorial, bridge } = fixture();
  for (const [type, payload] of [['move', { reached: true }], ['climb', { reached: true, grounded: true }], ['jump', { grounded: true, crossedGap: true }]]) tutorial.handleEvent(type, payload);
  const [first, second] = world.nodes;
  world.strikeNodes(first.x, first.x, first.y, 'grok-hit', 2);
  bridge.observe();
  assert.equal(tutorial.current().id, 'node-first');
  assert.equal(bridge.marker.x, second.x, 'point at an unopened alternative');
  world.strikeNodes(second.x, second.x, second.y, 'grok-hit-2', 2);
  bridge.observe();
  assert.equal(tutorial.skipped, true, 'no eligible practice node remains');
  assert.equal(tutorial.completed.includes('node-first'), false);
});

await test('explicit skip clears hints immediately and survives save, reload and tutorial review', async () => {
  const run = await harness(); await run.api.startWorld({ showIntro: false });
  const { world, tutorial, core } = run.api.state;
  commandLesson(tutorial); tutorial.hint(); world.tutorialMarker = { x: 442, y: 490 }; world.tutorialRoute = [{ x: 442, y: 490 }];
  await run.api.act('command-select', { teammate: 'Grok' });
  const before = core.exportRuntime();
  await run.api.act('tutorial-skip');
  assert.equal(run.api.getView().tutorial, null);
  assert.equal(world.tutorialMarker, null); assert.equal(world.tutorialRoute.length, 0);
  assert.deepEqual(core.exportRuntime(), before, 'skip does not alter tasks, resources or objectives');
  assert.equal(run.api.state.ui.screen, 'command', 'the current command remains editable');
  const reload = await harness({ initialItems: run.items }); await reload.api.act('resume');
  assert.equal(reload.api.state.tutorial.skipped, true);
  await reload.api.act('help'); await reload.api.act('tutorial-restart'); await reload.api.act('overlay-back');
  assert.equal(reload.api.state.tutorial.skipped, true);
  assert.equal(reload.api.getView().tutorial, null);
});

console.log(JSON.stringify({ suite: 'tutorial-free-play', passed, failed }));
if (failed) process.exitCode = 1;
