// Maintained regressions for the 2026-10-25 audit. All fixtures are isolated synthetic game runs.
import assert from 'node:assert/strict';
import { harness } from './lib/main-harness.mjs';
import { finishSyntheticChapter as finish, syntheticCampaignSave } from './lib/synthetic-campaign.mjs';
import { SAVE_KEY, SAVE_TRANSACTION_KEY, loadCheckpoint, recoverSaveTransaction } from '../src/core/storage.mjs';
import { EXPERIENCE_KEY, ARCHIVE_KEY, BACKUP_KEY, loadExperience, loadCampaignSave, loadArchive, exportSave, parseSave } from '../src/core/experience-storage.mjs';

let passed = 0, failed = 0, sequence = 0;
const copy = value => JSON.parse(JSON.stringify(value));
const ok = result => assert.equal(result.ok, true, JSON.stringify(result));
const unique = kind => `synthetic-regression-${kind}-${++sequence}`;
async function test(name, run) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
const fixture = syntheticCampaignSave(4);
fixture.archive.records.push({ id: 'synthetic-imported', type: 'test' }); fixture.archive.seenStories.push('prologue');
const completed = syntheticCampaignSave(5).campaign;

await test('final continue, epilogue, export, title and a fresh resume keep all five results', async () => {
  const { api, items, memory } = await harness();
  await api.act('save-import', { text: JSON.stringify(fixture) });
  await api.act('resume'); api.finishStory();
  if (api.state.ui.screen === 'briefing') await api.act('briefing-start');
  finish(api.state.core); api.worldEvent('chapter-result'); await api.act('continue');
  const exp = loadExperience(memory).value;
  assert.equal(exp.campaign.campaign.completed, true);
  assert.equal(exp.current, null); assert.equal(exp.checkpoint, null);
  assert.equal(exp.story.sceneId, 'epilogue'); assert.equal(exp.story.destination, 'result');
  const duringStory = await harness({ initialItems: items });
  await duringStory.api.act('resume');
  assert.equal(duringStory.api.state.storyPlayer.scene.id, 'epilogue');
  api.finishStory();
  assert.equal(api.state.ui.screen, 'campaign-result');
  assert.equal(loadExperience(memory).value.story, null);
  assert.equal(api.getView().saveSummary.completed, true);
  const exported = parseSave(exportSave(memory)); ok(exported);
  assert.equal(exported.campaign.campaign.results.length, 5);
  await api.act('title');
  assert.equal(api.state.ui.payload.completed, true);
  const reloaded = await harness({ initialItems: items }); await reloaded.api.act('resume');
  assert.equal(reloaded.api.state.core.view().campaign.completed, true);
  assert.equal(reloaded.api.state.core.view().chapter, null);
  await reloaded.api.act('demo-start', { chapterId: 'paper-window' });
  await reloaded.api.act('title'); await reloaded.api.act('resume');
  assert.equal(reloaded.api.state.world, null, 'a prior demo world cannot leak into the epilogue');
});

await test('already affected saves recover a later matching campaign for title, export and resume', async () => {
  const { api, items, memory } = await harness();
  await api.act('save-import', { text: JSON.stringify(fixture) }); await api.act('resume');
  const stale = items.get(EXPERIENCE_KEY);
  memory.setItem(SAVE_KEY, JSON.stringify(completed));
  assert.equal(loadCampaignSave(memory).experience.current, null);
  assert.equal(api.getView().saveSummary.completed, true);
  const exported = parseSave(exportSave(memory)); ok(exported);
  assert.equal(exported.campaign.campaign.completed, true);
  const reloaded = await harness({ initialItems: items }); await reloaded.api.act('resume');
  assert.equal(reloaded.api.state.core.view().campaign.completed, true);
  const unrelated = copy(completed); unrelated.campaign.results[0].elapsedMs += 1;
  memory.setItem(EXPERIENCE_KEY, stale); memory.setItem(SAVE_KEY, JSON.stringify(unrelated));
  assert.equal(loadCampaignSave(memory).campaign.campaign.completed, false, 'do not merge unrelated voyages');
});

await test('unavailable storage leaves the live chapter and screen intact and reports import failure', async () => {
  for (const options of [{ storage: null }, { writeFault() { throw new Error('synthetic storage blocked'); } }]) {
    const { api } = await harness(options); await api.startWorld({ showIntro: false });
    await api.act('help'); const before = api.state;
    await api.act('save-import', { text: JSON.stringify(fixture) });
    assert.equal(api.state.core, before.core); assert.equal(api.state.world, before.world);
    assert.equal(api.state.ui.screen, 'help'); assert.match(api.state.ui.toasts.at(-1), /导入失败/);
  }
});

await test('every import mutation failure rolls back campaign, experience, archive and backup', async () => {
  const seed = await harness(); await seed.api.startWorld({ showIntro: false });
  seed.memory.setItem(BACKUP_KEY, 'synthetic-previous-backup');
  for (let failAt = 1; failAt <= 6; failAt++) {
    let armed = false, writes = 0;
    const { api, items } = await harness({ initialItems: seed.items, writeFault() {
      if (armed && ++writes === failAt) throw new Error('synthetic one-shot write failure');
    } });
    await api.act('resume'); await api.act('help');
    const before = new Map(items), state = api.state;
    armed = true; await api.act('save-import', { text: JSON.stringify(fixture) });
    assert.match(api.state.ui.toasts.at(-1), /导入失败/, `failure at ${failAt}`);
    assert.deepEqual(items, before, `raw records restored at ${failAt}`);
    assert.equal(api.state.core, state.core); assert.equal(api.state.world, state.world);
    assert.equal(api.state.archive, state.archive); assert.equal(api.state.ui.screen, 'help');
  }
});

await test('a persistent mid-import outage exposes only the old save until recovery succeeds', async () => {
  const seed = await harness(); await seed.api.startWorld({ showIntro: false });
  for (const failAt of [3,4,5,6]) {
  let writes = 0, armed = false;
  const run = await harness({ initialItems: seed.items, writeFault() {
    if (armed && ++writes >= failAt) throw new Error('synthetic persistent storage outage');
  } });
  await run.api.act('resume'); const original = exportSave(run.memory);
  armed = true; await run.api.act('save-import', { text: JSON.stringify(fixture) });
  assert.match(run.api.state.ui.toasts.at(-1), /导入失败/);
  assert(run.items.has(SAVE_TRANSACTION_KEY));
  assert.equal(exportSave(run.memory), original);
  assert.equal(loadCheckpoint(run.memory).checkpoint, null, 'the original had an experience save only');
  assert.deepEqual(loadCampaignSave(run.memory).campaign, JSON.parse(original).campaign);
  assert.deepEqual(loadArchive(run.memory), JSON.parse(original).archive);
  const reloaded = await harness({ initialItems: run.items, writeFault() { throw new Error('still unavailable'); } });
  await reloaded.api.act('resume');
  assert.equal(reloaded.api.state.core.view().chapter.number, 1);
  armed = false; assert.equal(recoverSaveTransaction(run.memory), true);
  assert.equal(run.items.has(SAVE_TRANSACTION_KEY), false);
  assert.equal(exportSave(run.memory), original);
  }
});

await test('successful legacy and runtime imports persist together and back up the previous experience', async () => {
  const incoming = await harness();
  await incoming.api.act('save-import', { text: JSON.stringify(fixture) }); await incoming.api.act('resume');
  const runtimeImport = exportSave(incoming.memory);
  for (const text of [JSON.stringify(fixture), runtimeImport]) {
    const { api, items, memory } = await harness(); await api.startWorld({ showIntro: false });
    const previous = items.get(EXPERIENCE_KEY);
    await api.act('save-import', { text });
    assert.match(api.state.ui.toasts.at(-1), /导入完成/);
    assert.equal(items.get(BACKUP_KEY), previous); assert.equal(items.has(SAVE_TRANSACTION_KEY), false);
    assert.equal(loadCheckpoint(memory).checkpoint.campaign.results.length, 4);
    assert.equal(loadExperience(memory).ok, text === runtimeImport);
    assert.deepEqual(loadArchive(memory), {version:3,...parseSave(text).archive});
    const reload = await harness({ initialItems: items }); await reload.api.act('resume');
    assert.equal(reload.api.state.core.view().chapter.number, 5);
  }
});

await test('tutorial review preserves opened nodes, verified steps, chapter progress and spent training', async () => {
  const { api } = await harness(); await api.startWorld({ showIntro: false });
  const { world, tutorial, lesson } = api.state, dock = world.currentRoom;
  for (const room of world.rooms) {
    world.captureRoom(); world.loadRoom(room);
    for (const node of world.nodes) {
      world.strikeNodes(node.x, node.x, node.y, unique('dash'), 1);
      world.strikeNodes(node.x, node.x, node.y, unique('dash'), 1);
    }
  }
  world.captureRoom(); world.loadRoom(dock);
  await api.act('help');
  const beforeWorld = world.exportState(), beforeTutorial = tutorial.serialize(), beforeCore = api.state.core.exportRuntime();
  await api.act('tutorial-restart');
  assert.equal(api.state.ui.payload.tutorialReview, true);
  assert.deepEqual(tutorial.serialize(), beforeTutorial); assert.deepEqual(world.exportState(), beforeWorld);
  assert.deepEqual(api.state.core.exportRuntime(), beforeCore);
  await api.act('tutorial-restart'); assert.equal(api.state.ui.payload.tutorialReview, false);
  await api.act('overlay-back');
  const step = input => { assert(!world.update(1 / 60, input)?.rebuild); lesson.observe(world, 1 / 60); };
  const until = (condition, input) => { for (let i = 0; i < 300 && !condition(); i++) step(input); assert(condition()); };
  until(() => world.player.x >= 192, { right: true });
  until(() => world.player.x >= 237, { right: true });
  until(() => world.player.grounded && world.player.y === 490, { up: true });
  until(() => world.player.x >= 300, { right: true }); step({ right: true, jump: true, jumpPressed: true });
  until(() => world.player.grounded && world.player.x >= 365, { right: true, jump: true });
  assert.equal(tutorial.getState().skipped, true, 'free play in later rooms retires the obsolete first-minute sequence');
  assert.equal(tutorial.current(), null);
  assert(world.nodes.every(node => node.hp === 0), 'review never resets the opened nodes');
  // An already skipped/completed tutorial also remains untouched, with no minted training credit.
  for (const chapterId of ['resume-storm', 'review-quietly']) {
    await api.act('demo-start', { chapterId });
    api.state.world.trainingCredits.Claude = 0; api.state.tutorial.skip();
    await api.act('help'); const state = api.state.tutorial.serialize();
    await api.act('tutorial-restart');
    assert.deepEqual(api.state.tutorial.serialize(), state);
    assert.equal(api.state.world.trainingCredits.Claude, 0); await api.act('overlay-back');
  }
});

console.log(JSON.stringify({ suite: 'audit-bug-fixes', passed, failed }));
if (failed) process.exitCode = 1;
