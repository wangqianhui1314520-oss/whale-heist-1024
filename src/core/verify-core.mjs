import assert from 'node:assert/strict';
import { CHAPTERS, RULES } from './chapters.mjs';
import { GameCore } from './state.mjs';
import { SAVE_KEY, SAVE_VERSION, loadCheckpoint } from './storage.mjs';

const memoryStorage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const ok = (result) => assert.equal(result.ok, true, JSON.stringify(result));
let eventSequence = 0;
const unique = (prefix) => `${prefix}-${++eventSequence}`;

function execute(core, target, precise = false) {
  const commandId = unique('command');
  ok(core.prepareCommand({ commandId, teammate: target.teammate, targetId: target.id, precise }));
  ok(core.beginCommand(target.teammate));
  ok(core.completeCommand(target.teammate, commandId));
  ok(core.advanceTime(8000));
}

function transport(core, ids) {
  for (const id of ids) {
    if (core.view().attempt.inventory.length === RULES.backpackCapacity) ok(core.deliver(unique('delivery')));
    ok(core.pickup(id));
  }
  if (core.view().attempt.inventory.length) ok(core.deliver(unique('delivery')));
}

function finishStandardChapter(core, { optional = false, collaboration = true, keepBroadcast = false } = {}) {
  const { chapter } = core.view();
  assert.notEqual(chapter.number, 5);
  if (collaboration) chapter.commandTargets.filter((target) => target.collaboration).forEach((target) => execute(core, target));
  transport(core, chapter.requiredItems.map((item) => item.id));
  if (optional) transport(core, chapter.optionalItems.map((item) => item.id));
  if (chapter.number === 4) {
    if (!keepBroadcast) ok(core.setBroadcast(false));
    ok(core.activateReturnBeacon());
  }
  ok(core.board());
}

// Transaction boundaries: result screen changes no committed score/history or persisted entry.
{
  const storage = memoryStorage();
  const core = new GameCore({ storage });
  const initialSave = storage.getItem(SAVE_KEY);
  const oldAttemptId = core.view().attempt.attemptId;
  finishStandardChapter(core, { optional: true });
  assert.equal(core.view().pendingResult.score, 100);
  assert.equal(core.view().campaign.totalScore, 0);
  assert.equal(core.view().campaign.historyExposure, 0);
  assert.equal(storage.getItem(SAVE_KEY), initialSave);
  assert.equal(GameCore.resume({ storage }).view().chapter.number, 1);
  assert.equal(GameCore.resume({ storage }).view().attempt.deliveredIds.length, 0);
  ok(core.retryChapter());
  assert.equal(core.view().pendingResult, null);
  assert.equal(core.view().attempt.exposureDelta, 0);
  assert.equal(core.view().attempt.qualifiers, 2);
  assert.equal(core.view().attempt.health, 100);
  assert.equal(core.worldEvent(oldAttemptId, { type: 'alarm', eventId: 'late', sourceId: 'late' }).reason, 'stale-attempt');
  finishStandardChapter(core, { optional: true });
  const delta = core.view().pendingResult.exposureDelta;
  ok(core.continueCampaign());
  assert.equal(core.view().campaign.totalScore, 100);
  assert.equal(core.view().campaign.historyExposure, delta);
  assert.equal(core.continueCampaign().ok, false);
  assert.equal(core.view().campaign.historyExposure, delta);
  const loaded = GameCore.resume({ storage });
  assert.equal(loaded.view().chapter.number, 2);
  assert.equal(loaded.view().campaign.totalScore, 100);
}

// Settlement "retry" total counts real terminations once, even after a
// checkpoint resume or a manual restart following the death screen.
{
  const core = new GameCore();
  const snapshot = core.exportRuntime();
  ok(core.damage(100));
  assert.equal(core.view().failuresThisChapter.length, 1);
  ok(core.restoreRuntime(snapshot));
  assert.equal(core.view().failuresThisChapter.length, 1, 'Checkpoint resume must not erase a termination');
  ok(core.damage(100));
  assert.equal(core.view().failuresThisChapter.length, 2);
  ok(core.retryChapter('manual', { count: false }));
  assert.equal(core.view().failuresThisChapter.length, 2, 'Manual restart after a death is not another death');
  finishStandardChapter(core);
  assert.equal(core.view().pendingResult.failedAttempts, 2);
  ok(core.continueCampaign());
  assert.equal(core.view().chapter.number, 2);
  assert.equal(core.view().failuresThisChapter.length, 0, 'Next chapter starts its own retry total');
}

// No resource charge for invalid or cancelled previews; exact costs start once execution begins.
{
  const core = new GameCore();
  assert.equal(core.prepareCommand({ commandId: 'bad', teammate: 'Claude', targetId: 'paper-window', precise: true }).ok, false);
  assert.equal(core.view().attempt.qualifiers, 2);
  ok(core.prepareCommand({ commandId: 'cancelled', teammate: 'Grok', targetId: 'paper-window', precise: true }));
  ok(core.cancelCommand('Grok'));
  assert.equal(core.view().attempt.qualifiers, 2);
  ok(core.prepareCommand({ commandId: 'exact', teammate: 'Grok', targetId: 'paper-window', precise: true }));
  ok(core.beginCommand('Grok'));
  assert.equal(core.view().attempt.qualifiers, 1);
  assert.equal(core.beginCommand('Grok').ok, false);
  assert.equal(core.completeCommand('Grok', 'stale-command').reason, 'stale-command');
  ok(core.completeCommand('Grok', 'exact'));
  assert.equal(core.view().attempt.qualifiers, 1);
  assert.equal(core.prepareCommand({ commandId: 'again', teammate: 'Grok', targetId: 'paper-window' }).ok, false);
  assert.equal(core.view().attempt.collaborationIds.length, 1);
  ok(core.advanceTime(6000));
  ok(core.prepareCommand({commandId:'repeat-after-cooldown',teammate:'Grok',targetId:'paper-window'}));
  ok(core.beginCommand('Grok'));ok(core.completeCommand('Grok','repeat-after-cooldown'));
  assert.equal(core.view().attempt.collaborationIds.length,1,'Repeated useful commands cannot farm collaboration score');
  assert.equal(core.view().attempt.completedTargetIds.length,1);
}

// Alarm deduplication, hit protection, pause and scaled clocks share one model time.
{
  const core = new GameCore();
  ok(core.alarm({ eventId: 'alarm-1', sourceId: 'sensor' }));
  assert.equal(core.alarm({ eventId: 'alarm-1', sourceId: 'sensor' }).reason, 'duplicate-alarm');
  assert.equal(core.alarm({ eventId: 'alarm-2', sourceId: 'sensor' }).reason, 'source-cooling-down');
  ok(core.damage());
  assert.equal(core.damage().reason, 'damage-protected');
  ok(core.advanceTime(1000, { timeScale: 0.5 }));
  assert.equal(core.view().attempt.elapsedMs, 500);
  assert.equal(core.damage().reason, 'damage-protected');
  ok(core.setPaused(true));
  assert.equal(core.advanceTime(5000).ok, false);
  assert.equal(core.deliver('paused-delivery').ok, false);
  assert.equal(core.view().attempt.elapsedMs, 500);
  ok(core.setPaused(false));
  ok(core.advanceTime(1500));
  ok(core.alarm({ eventId: 'alarm-2', sourceId: 'sensor' }));
  assert.equal(core.view().attempt.exposureDelta, 4);
  ok(core.damage(100));
  assert.equal(core.view().attempt.health, 100);
  assert.equal(core.view().attempt.alarmIds.length, 0);
  assert.equal(core.view().campaign.historyExposure, 0);
}

// Broadcast stays off across chapters; chapter four accepts an already closed broadcast.
// Whole mainline can score 500, and the final timer begins ONLY after remote preparation/confirmation.
{
  const storage = memoryStorage();
  const core = new GameCore({ storage });
  ok(core.setBroadcast(false));
  for (let i = 0; i < 4; i += 1) {
    assert.equal(core.view().chapter.id, CHAPTERS[i].id);
    assert.equal(core.view().attempt.broadcastOn, false);
    assert.equal(core.view().attempt.qualifiers, CHAPTERS[i].qualifiers);
    if (i === 3) assert.equal(core.view().optionalObjectives.find((goal) => goal.id === 'broadcast-off').complete, true);
    finishStandardChapter(core, { optional: true });
    assert.equal(core.view().pendingResult.score, 100);
    ok(core.continueCampaign());
  }
  assert.equal(core.view().chapter.name, '闭舱返航');
  const finalChapter = core.view().chapter;
  const beacon = finalChapter.rendezvousTarget;
  ok(core.advanceTime(240_000)); // Exploration has no hard chapter timer.
  assert.equal(core.view().attempt.evacuationStarted, false);
  assert.equal(core.view().attempt.evacuationRemainingMs, 60_000);
  assert.equal(core.startEvacuation(beacon).reason, 'remote-preparation-incomplete');
  assert.equal(core.prepareRemoteBeacon(beacon).ok, false);
  finalChapter.requiredItems.forEach((item) => ok(core.pickup(item.id)));
  assert.equal(core.deliver('too-early').reason, 'confirm-at-remote-beacon-first');
  for (const teammate of RULES.teammates) ok(core.rendezvous(teammate, beacon));
  assert.equal(core.startEvacuation(beacon).ok, false);
  ok(core.prepareRemoteBeacon(beacon));
  assert.equal(core.view().attempt.evacuationStarted, false);
  assert.equal(core.startEvacuation('boat').reason, 'not-at-remote-beacon');
  finalChapter.supplies.forEach((supply) => ok(core.collectSupply(supply.id)));
  finalChapter.commandTargets.filter((target) => target.collaboration).forEach((target) => execute(core, target));
  ok(core.startEvacuation(beacon));
  assert.equal(core.startEvacuation(beacon).reason, 'evacuation-already-started');
  assert.equal(core.collectSupply(finalChapter.supplies[0].id).reason, 'evacuation-no-backtracking');
  ok(core.advanceTime(15_000));
  assert.equal(core.view().attempt.evacuationRemainingMs, 45_000);
  ok(core.deliver('final-delivery'));
  ok(core.board());
  assert.equal(core.view().campaign.totalScore, 400);
  assert.equal(core.view().pendingResult.score, 100);
  ok(core.continueCampaign());
  assert.equal(core.view().phase, 'campaign-complete');
  assert.equal(core.view().campaign.totalScore, 500);
  assert.equal(core.view().campaign.grade, 'S');
  assert.equal(core.view().campaign.historyExposure, 0);
  assert.equal(GameCore.resume({ storage }).view().phase, 'campaign-complete');
}

// Chapter four accepts a public broadcast run: no gate, but leaked records,
// extra exposure and a 10-point settlement penalty. Closing freezes the ledger.
{
  const storage = memoryStorage();
  const core = new GameCore({ storage });
  for (let i = 0; i < 3; i += 1) { finishStandardChapter(core); ok(core.continueCampaign()); }
  assert.equal(core.view().chapter.id, 'public-report');
  assert.equal(core.view().attempt.broadcastOn, true, 'Campaign enters chapter four while still public');
  assert.equal(core.view().objectives.some((goal) => goal.id === 'broadcast-off'), false,
    'Broadcast is a choice, never a boarding gate');
  assert.equal(core.view().optionalObjectives.find((goal) => goal.id === 'broadcast-off').complete, false);
  ok(core.advanceTime(60_000));
  assert.equal(core.view().attempt.broadcastLeaks, 5, 'Public ledger accrues every 12 s');
  assert.equal(core.view().attempt.exposureDelta, 10, 'Leaked records count toward exposure');
  finishStandardChapter(core, { optional: true, keepBroadcast: true });
  const result = core.view().pendingResult;
  assert.equal(result.broadcastOn, true);
  assert.equal(result.breakdown.broadcast, -10);
  assert.equal(result.score, 90, 'Public run still clears but scores 10 less than closed');
  assert.ok(result.events.publicLeaks >= 5);
  assert.ok(result.exposureDelta >= 14, 'Public deliveries stack with leaked records');
  ok(core.continueCampaign());
  assert.equal(core.view().chapter.number, 5, 'Public broadcast run still advances');
  assert.equal(GameCore.resume({ storage }).view().chapter.number, 5, 'Public chapter-four result saves and reloads');
}
{
  const core = new GameCore();
  for (let i = 0; i < 3; i += 1) { finishStandardChapter(core); ok(core.continueCampaign()); }
  ok(core.advanceTime(30_000));
  assert.equal(core.view().attempt.broadcastLeaks, 2);
  ok(core.setBroadcast(false));
  ok(core.advanceTime(120_000));
  assert.equal(core.view().attempt.broadcastLeaks, 2, 'Closing the broadcast stops new public records');
  assert.equal(core.view().attempt.exposureDelta, 4, 'Earlier leaked records remain');
  assert.equal(core.view().optionalObjectives.find((goal) => goal.id === 'broadcast-off').complete, true);
}

// Timeout restores the fifth-chapter entry, including already committed history/broadcast.
{
  const core = new GameCore();
  for (let i = 0; i < 4; i += 1) { finishStandardChapter(core); ok(core.continueCampaign()); }
  const before = core.view().campaign;
  const chapter = core.view().chapter;
  const beacon = chapter.rendezvousTarget;
  chapter.requiredItems.forEach((item) => ok(core.pickup(item.id)));
  RULES.teammates.forEach((teammate) => ok(core.rendezvous(teammate, beacon)));
  ok(core.prepareRemoteBeacon(beacon));
  ok(core.startEvacuation(beacon));
  ok(core.setBroadcast(true));
  ok(core.alarm({ eventId: 'failed-alarm', sourceId: 'failed-sensor' }));
  const timedOut = core.advanceTime(60_000);
  assert.equal(timedOut.retried, true);
  assert.equal(core.view().chapter.number, 5);
  assert.equal(core.view().attempt.evacuationStarted, false);
  assert.equal(core.view().attempt.broadcastOn, false);
  assert.equal(core.view().attempt.inventory.length, 0);
  assert.equal(core.view().attempt.exposureDelta, 0);
  assert.equal(core.view().campaign.totalScore, before.totalScore);
  assert.equal(core.view().campaign.historyExposure, before.historyExposure);
}

// Bad, future-version and disabled storage do not crash or prevent continuous play.
{
  const storage = memoryStorage();
  storage.setItem(SAVE_KEY, '{broken-json');
  assert.equal(GameCore.resume({ storage }).view().loadNotice, 'invalid-json');
  storage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION + 1 }));
  assert.equal(loadCheckpoint(storage).reason, 'unsupported-version');
  const malformed = new GameCore().checkpoint();
  malformed.campaign.results = [{ chapterId: 'paper-window', score: 999 }];
  storage.setItem(SAVE_KEY, JSON.stringify(malformed));
  assert.equal(loadCheckpoint(storage).reason, 'invalid-schema');
  const unavailable = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  const core = GameCore.resume({ storage: unavailable });
  assert.equal(core.view().loadNotice, 'storage-unavailable');
  finishStandardChapter(core);
  assert.equal(core.continueCampaign().ok, true);
  assert.equal(core.view().chapter.number, 2);
  assert.equal(core.view().storage.ok, false);
  const detached = core.view();
  detached.attempt.qualifiers = 99;
  assert.equal(core.view().attempt.qualifiers, 3);
}

console.log('PASS: campaign transactions, retries, resources, event deduplication, remote evacuation, 500-point scoring and save recovery.');
