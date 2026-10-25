/** Runtime/save regression checks. Failure is reported without modifying implementation files. */
import assert from 'node:assert/strict';
import { GameCore } from '../src/core/state.mjs';
import { SAVE_KEY, newCheckpoint } from '../src/core/storage.mjs';
import { EXPERIENCE_KEY, BACKUP_KEY, normalizeExperience, loadExperience, saveExperience, backupExperience, exportSave, parseSave } from '../src/core/experience-storage.mjs';
import { DEFAULT_SETTINGS, SETTINGS_KEY, normalizeSettings, loadSettings, saveSettings, updateSetting, setBinding } from '../src/game/preferences.mjs';
import { TutorialDirector } from '../src/game/tutorial.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
const failures = [];
let passed = 0;
const test = (name, callback) => { try { callback(); passed++; console.log('PASS ' + name); } catch (error) { failures.push(name); console.error('FAIL ' + name + '\n' + error.stack); } };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result; };
const bad = result => assert.equal(result.ok, false, JSON.stringify(result));
const makeCore = () => new GameCore({ persist: false });
const storage = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
};
const target = { id: 'extra-runtime-obstacle', teammate: 'Grok', effect: 'break-obstacle' };
const command = (core, commandId, cost = 1) => core.prepareCommand({ commandId, teammate: 'Grok', targetId: target.id, precise: false, cost });
const wrapper = core => ({ version: 2, savedAt: '2026-10-24T00:00:00Z', chapterId: core.view().chapter.id, campaign: core.checkpoint(),
  checkpointLabel: '交付后的安全台', contractId: 'standard', current: { core: core.exportRuntime(), world: { time: 4, player: { x: 120, y: 600 } }, tutorial: new TutorialDirector(1).serialize() },
  checkpoint: { core: core.exportRuntime(), world: { time: 2, player: { x: 85, y: 600 } } } });

test('runtime restores inventory, spent budget, alarms, broadcast, cooldowns and actual elapsed time together', () => {
  const core = makeCore(); ok(core.registerWorldTargets([target])); ok(core.collectSupply('harbor-qualifier'));
  ok(core.pickup('harbor-data-1')); ok(core.damage(20)); ok(core.alarm({ eventId: 'alarm-once', sourceId: 'source-once' }));
  ok(command(core, 'runtime-command')); ok(core.beginCommand('Grok')); ok(core.completeCommand('Grok', 'runtime-command'));
  ok(core.setBroadcast(false)); ok(core.advanceTime(1234)); ok(core.setPaused(true));
  const saved = JSON.parse(JSON.stringify(core.exportRuntime())), oldAttempt = saved.attempt.attemptId;
  const restored = makeCore(); ok(restored.restoreRuntime(saved));
  const before = core.view().attempt, after = restored.view().attempt;
  for (const key of ['health', 'qualifiers', 'inventory', 'deliveredIds', 'elapsedMs', 'alarmIds', 'publicCommandIds', 'readyAtMs', 'completedTargetIds', 'broadcastOn']) assert.deepEqual(after[key], before[key], key);
  assert.notEqual(after.attemptId, oldAttempt); bad(restored.worldEvent(oldAttempt, { type: 'pickup', itemId: 'harbor-data-2' }));
  assert.equal(restored.view().phase, 'playing'); assert.equal(restored.view().attempt.inventory.length, 1);
});
test('dynamic target registration is validated and completion never creates main collaboration credit', () => {
  const core = makeCore(); ok(core.registerWorldTargets([target, { ...target, teammate: 'Unknown' }, { id: 'bad', teammate: 'Grok', effect: 'unlock-mfa' }]));
  ok(command(core, 'dynamic')); ok(core.beginCommand('Grok')); ok(core.completeCommand('Grok', 'dynamic'));
  assert(core.view().attempt.completedTargetIds.includes(target.id)); assert(!core.view().attempt.collaborationIds.includes(target.id));
  const restored = makeCore(); ok(restored.restoreRuntime(core.exportRuntime()));
  assert(restored.exportRuntime().worldTargets.some(item => item.id === target.id));
  bad(restored.prepareCommand({ commandId: 'bad-target', teammate: 'Grok', targetId: 'bad' }));
});
test('waiting command costs one even with precise false, charges only at start and refunds once on system failure', () => {
  const core = makeCore(); ok(core.registerWorldTargets([target])); const initial = core.view().attempt.qualifiers;
  ok(command(core, 'wait-cost')); assert.equal(core.view().attempt.qualifiers, initial);
  ok(core.beginCommand('Grok')); assert.equal(core.view().attempt.qualifiers, initial - 1); bad(core.beginCommand('Grok'));
  ok(core.refundCommand('Grok', 'wait-cost')); assert.equal(core.view().attempt.qualifiers, initial);
  bad(core.refundCommand('Grok', 'wait-cost')); assert.equal(core.view().attempt.qualifiers, initial);
});
test('cancelling a prepared action is free, an active player cancellation retains spent cost', () => {
  const core = makeCore(); ok(core.registerWorldTargets([target])); const initial = core.view().attempt.qualifiers;
  ok(command(core, 'not-started')); ok(core.cancelCommand('Grok')); assert.equal(core.view().attempt.qualifiers, initial);
  ok(command(core, 'started')); ok(core.beginCommand('Grok')); ok(core.cancelCommand('Grok')); assert.equal(core.view().attempt.qualifiers, initial - 1);
});
test('free actions never mint budget through refund and malformed cost is rejected', () => {
  const core = makeCore(); ok(core.registerWorldTargets([target])); const initial = core.view().attempt.qualifiers;
  ok(command(core, 'free', 0)); ok(core.beginCommand('Grok')); ok(core.refundCommand('Grok', 'free')); assert.equal(core.view().attempt.qualifiers, initial);
  const other = makeCore(); ok(other.registerWorldTargets([target]));
  for (const cost of [-1, 2, 0.5, NaN, Infinity]) bad(command(other, 'bad-' + String(cost), cost));
  assert.equal(other.view().attempt.qualifiers, initial);
});
test('invalid runtime attempts are rejected atomically without replacing the live attempt', () => {
  const core = makeCore(), saved = core.exportRuntime(), before = core.exportRuntime();
  const mutate = [
    state => { state.attempt.health = 0; }, state => { state.attempt.qualifiers = 999; },
    state => { state.attempt.inventory = ['foreign-chapter-item']; }, state => { state.attempt.inventory = ['harbor-data-1', 'harbor-data-1']; },
    state => { state.attempt.elapsedMs = Infinity; }, state => { state.phase = 'unknown-phase'; },
    state => { state.attempt.evacuationStarted = true; },
  ];
  for (const change of mutate) { const candidate = copy(saved); change(candidate); bad(core.restoreRuntime(candidate)); assert.deepEqual(core.exportRuntime(), before); }
});
test('V2 experience wrapper round trips current world, checkpoint, tutorial and campaign', () => {
  const core = makeCore(), memory = storage(), value = wrapper(core);
  assert.equal(saveExperience(memory, value), true); assert.equal(loadExperience(memory).ok, true);
  assert.deepEqual(loadExperience(memory).value.current, value.current); assert.deepEqual(loadExperience(memory).value.checkpoint, value.checkpoint);
  const imported = parseSave(exportSave(memory)); ok(imported); assert.deepEqual(imported.campaign, core.checkpoint());
  assert.equal(imported.experience.chapterId, 'paper-window'); assert.deepEqual(imported.experience.current.tutorial, value.current.tutorial);
  assert.equal(backupExperience(memory), true); assert.equal(memory.getItem(BACKUP_KEY), memory.getItem(EXPERIENCE_KEY));
});
test('legacy V1 campaign can export through V2 without a manufactured runtime checkpoint', () => {
  const memory = storage(); memory.setItem(SAVE_KEY, JSON.stringify(newCheckpoint()));
  const imported = parseSave(exportSave(memory)); ok(imported); assert.deepEqual(imported.campaign, newCheckpoint()); assert.equal(imported.experience, null);
  bad(parseSave('{broken')); bad(parseSave(JSON.stringify({ format: 'whale-heist-save', version: 99, campaign: newCheckpoint() })));
});
test('experience chapter identity is bound to the campaign and unsupported chapters are rejected', () => {
  const value = wrapper(makeCore());
  assert.equal(normalizeExperience({ ...value, chapterId: 'not-a-chapter' }), null);
  assert.equal(normalizeExperience({ ...value, chapterId: 'close-hatch' }), null);
});
test('settings persist valid bindings, clamp numeric ranges and migrate legacy settings', () => {
  const memory = storage(), input = normalizeSettings({ masterVolume: 3, touchOpacity: 0, subtitleScale: 2,
    bindings: { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', jump: 'KeyJ', dash: 'KeyK', interact: 'KeyL' } });
  assert.equal(input.masterVolume, 1); assert.equal(input.touchOpacity, 0.3); assert.equal(input.subtitleScale, 1.6);
  assert.equal(saveSettings(memory, input), true); assert.deepEqual(loadSettings(memory), input);
  const legacy = storage(); legacy.setItem('whale-heist:settings', JSON.stringify({ muted: true, reduceMotion: true }));
  assert.equal(loadSettings(legacy).masterVolume, 0); assert.equal(loadSettings(legacy).reduceMotion, true);
  memory.setItem(SETTINGS_KEY, 'bad-json'); assert.deepEqual(loadSettings(memory), normalizeSettings());
});
test('binding collisions normalize to unique keys and interactive remaps reject duplicates', () => {
  const settings = normalizeSettings({ bindings: { left: 'KeyD', right: 'KeyD' } });
  assert.equal(new Set(Object.values(settings.bindings)).size, Object.keys(DEFAULT_SETTINGS.bindings).length);
  bad(setBinding(normalizeSettings(), 'left', 'KeyD')); bad(setBinding(normalizeSettings(), 'left', 'F5'));
  const result = setBinding(normalizeSettings(), 'left', 'KeyQ'); ok(result); assert.equal(result.settings.bindings.left, 'KeyQ');
});
test('interactive settings reject unknown booleans, enums and nonfinite numbers', () => {
  const settings = normalizeSettings();
  for (const [key, value] of [['tacticalPause', 'banana'], ['quality', 'ultra'], ['interactionMode', 'automatic'], ['masterVolume', Infinity], ['subtitleScale', 'not-a-number'], ['unknown', true]]) bad(updateSetting(settings, key, value));
  const result = updateSetting(settings, 'tacticalPause', 'false'); ok(result); assert.equal(result.settings.tacticalPause, false);
});
test('chapters without teaching steps still serialize and restore as completed tutorial state', () => {
  for (const chapter of [4, 5]) {
    const director = new TutorialDirector(chapter); assert.equal(director.getState().done, true);
    const restored = TutorialDirector.restore(director.serialize()); assert.equal(restored.getState().done, true); assert.equal(restored.chapter, director.chapter);
  }
});

if (failures.length) { console.error(`Runtime/save verification: ${passed} passed, ${failures.length} failed: ${failures.join(', ')}`); process.exitCode = 1; }
else console.log(`Runtime/save verification: ${passed} passed.`);
