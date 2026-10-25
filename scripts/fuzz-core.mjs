/** Deterministic stress checks for core state, action tokens and imported saves. */
import assert from 'node:assert/strict';
import { GameCore } from '../src/core/state.mjs';
import { RULES, CHAPTERS } from '../src/core/chapters.mjs';
import { chapterCheckpoint } from '../src/game/session.mjs';
import { normalizeCheckpoint, newCheckpoint } from '../src/core/storage.mjs';
import { normalizeExperience, parseSave } from '../src/core/experience-storage.mjs';
import { compilePrompt, validatePlan } from '../src/game/prompts.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const ok = result => assert.equal(result.ok, true, JSON.stringify(result));
const random = seed => () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
let operations = 0, mutations = 0;
let promptInputs = 0;

function invariant(core) {
  const view = core.view(), a = view.attempt;
  assert(normalizeCheckpoint(core.checkpoint()));
  if (!a) return;
  assert(Number.isFinite(a.elapsedMs) && a.elapsedMs >= 0);
  assert(a.health > 0 && a.health <= RULES.maxHealth);
  assert(Number.isInteger(a.qualifiers) && a.qualifiers >= 0 && a.qualifiers <= RULES.qualifierCapacity);
  assert(Number.isInteger(a.aiTokens) && a.aiTokens >= 0 && a.aiTokens <= RULES.aiTokenCapacity);
  assert(a.inventory.length <= RULES.backpackCapacity);
  assert(!a.inventory.some(id => a.deliveredIds.includes(id)));
  for (const key of ['inventory', 'deliveredIds', 'commandIds', 'publicCommandIds', 'alarmIds'])
    assert.equal(new Set(a[key]).size, a[key].length, key);
  assert(a.publicCommandIds.every(id => a.commandIds.includes(id)));
  if (a.evacuationStarted) assert.equal(a.evacuationStage, 'evacuating');
  if (['playing', 'paused'].includes(view.phase)) {
    const snapshot = core.exportRuntime(), restored = new GameCore({ persist: false });
    ok(restored.restoreRuntime(snapshot));
    const actual = restored.exportRuntime();
    delete actual.attempt.attemptId; delete snapshot.attempt.attemptId;
    snapshot.phase = 'playing';
    assert.deepEqual(actual, snapshot, 'live state survives export/restore without losing or adding resources');
  }
}

// Accepted snapshots must be safe to render; rejected snapshots leave all
// live state untouched. The missing analysis fields used to crash view().
for (const chapter of CHAPTERS) {
  const baseline = new GameCore({ checkpoint: chapterCheckpoint(chapter.id), persist: false }).exportRuntime();
  const cases = [
    snapshot => { snapshot.attempt.vulnerabilitySession = { version: 1, chapterId: chapter.id }; },
    snapshot => { snapshot.attempt.vulnerabilitySession.history = {}; },
    snapshot => { snapshot.worldTargets = Array.from({ length: 501 }, (_, i) => ({ id: `extra-${i}`, teammate: 'Grok', effect: 'break-obstacle' })); },
  ];
  for (const key of Object.keys(baseline.attempt)) for (const value of [null, true, false, 0, -1, 999999, 'broken', [], {}])
    cases.push(snapshot => { snapshot.attempt[key] = clone(value); });
  for (const mutate of cases) {
    const core = new GameCore({ persist: false }), before = core.exportRuntime(), snapshot = clone(baseline);
    mutate(snapshot); const result = core.restoreRuntime(snapshot); mutations++;
    if (result.ok) invariant(core);
    else assert.deepEqual(core.exportRuntime(), before, 'invalid restore is atomic');
  }
}

// A resumed checkpoint must invalidate the precise attempt ID stored in it,
// including snapshots saved after a retry (attempt-2).
{
  const old = new GameCore({ persist: false }); ok(old.retryChapter());
  const snapshot = old.exportRuntime(), resumed = new GameCore({ persist: false });
  ok(resumed.restoreRuntime(snapshot));
  assert.notEqual(resumed.view().attempt.attemptId, snapshot.attempt.attemptId);
  assert.equal(resumed.worldEvent(snapshot.attempt.attemptId, { type: 'damage', amount: 20 }).reason, 'stale-attempt');
  assert.equal(resumed.view().attempt.health, RULES.maxHealth);
}

// Duplicate arrival/loading callbacks must never move the finale backwards:
// a downgraded stage previously produced a save that its own loader rejected.
{
  const core = new GameCore({ checkpoint: chapterCheckpoint('close-hatch'), persist: false });
  const chapter = core.view().chapter, beacon = chapter.rendezvousTarget;
  chapter.requiredItems.forEach(item => ok(core.pickup(item.id)));
  RULES.teammates.forEach(name => ok(core.rendezvous(name, beacon)));
  ok(core.prepareRemoteBeacon(beacon));
  const prepared = core.exportRuntime();
  ok(core.rendezvous('Grok', beacon));
  assert.deepEqual(core.exportRuntime(), prepared);
  invariant(core);
  ok(core.startEvacuation(beacon)); ok(core.advanceTime(15000));
  const evacuating = core.exportRuntime();
  assert.equal(core.prepareRemoteBeacon(beacon).reason, 'evacuation-already-started');
  assert.deepEqual(core.exportRuntime(), evacuating);
  invariant(core);
}

// Simulate valid and out-of-order controller events in all chapters, including
// pause, repeated completion/refund, retries and restores at arbitrary points.
for (const chapter of CHAPTERS) for (let seed = 1; seed <= 8; seed++) {
  const rand = random(seed * 20261025 + chapter.number), choose = values => values[Math.floor(rand() * values.length)];
  const core = new GameCore({ checkpoint: chapterCheckpoint(chapter.id), persist: false });
  let serial = 0;
  for (let step = 0; step < 1500; step++) {
    const before = core.view(), a = before.attempt;
    if (!a || !['playing', 'paused'].includes(before.phase)) { core.retryChapter(); continue; }
    const target = choose(chapter.commandTargets), teammate = choose(RULES.teammates);
    const active = a.commands[teammate], eventId = `event-${serial++}`;
    switch (Math.floor(rand() * 21)) {
      case 0: core.setPaused(rand() < .5); break;
      case 1: core.advanceTime(choose([0, 16, 700, 2000, 8000]), { timeScale: choose([0, .15, 1]) }); break;
      case 2: core.prepareCommand({ commandId: eventId, teammate: target.teammate, targetId: target.id, precise: rand() < .5 }); break;
      case 3: core.beginCommand(teammate); break;
      case 4: core.completeCommand(teammate, active?.commandId || eventId); break;
      case 5: core.refundCommand(teammate, active?.commandId || eventId); break;
      case 6: core.cancelCommand(teammate); break;
      case 7: core.pickup(choose([...chapter.requiredItems, ...chapter.optionalItems]).id); break;
      case 8: core.deliver(eventId); break;
      case 9: core.collectSupply(choose(chapter.supplies).id); break;
      case 10: core.setBroadcast(rand() < .5); break;
      case 11: core.damage(choose([0, 1, 20, 100, -1, Infinity])); break;
      case 12: core.alarm({ eventId, sourceId: choose(['radar', '__proto__', 'constructor']) }); break;
      case 13: core.rendezvous(teammate, chapter.rendezvousTarget); break;
      case 14: core.prepareRemoteBeacon(chapter.rendezvousTarget); break;
      case 15: core.startEvacuation(chapter.rendezvousTarget); break;
      case 16: core.activateReturnBeacon(); break;
      case 17: core.claimEmergencyToken('analysis-station'); break;
      case 18: core.board(); break;
      case 19: if (rand() < .1) core.retryChapter('fuzz-retry'); break;
      case 20: {
        const state = core.exportRuntime(); if (['playing', 'paused'].includes(state.phase)) ok(core.restoreRuntime(state)); break;
      }
    }
    operations++;
    // Full checkpoint validation every 20 actions keeps this check practical.
    if (step % 20 === 0) invariant(core);
  }
  invariant(core);
}

// Imported save and prompt boundaries must return errors for malformed JSON
// values rather than throwing or inventing an instruction.
const values = [null, true, false, 0, -1, '', 'bad', [], {}, { version: 99 }];
for (const value of values) {
  assert.doesNotThrow(() => normalizeCheckpoint(value));
  assert.doesNotThrow(() => normalizeExperience(value));
  assert.equal(parseSave(JSON.stringify(value)).ok, false);
  assert.doesNotThrow(() => compilePrompt(value));
  assert.doesNotThrow(() => validatePlan(value));
}
assert.equal(parseSave(JSON.stringify({ format: 'whale-heist-save', version: 2, campaign: newCheckpoint() })).ok, true);

const promptTargets = [
  { id: 'window', label: '纸窗', teammate: 'Grok', aliases: ['蓝色隔板'] },
  { id: 'patrol', label: '东巡逻', teammate: 'Claude', type: 'guard' },
  { id: 'bridge', label: '校验桥', teammate: 'GLM', type: 'trap' },
  { id: 'lift', label: '升降台', type: 'lift' },
];
for (const target of [null, 1, 'bad', { id: 'window', aliases: {} }, { id: 'window', tags: 7 }, { id: 'window', teammates: 'Grok' }]) {
  const context = { targets: [target], unlockedChapter: 5 };
  assert.equal(compilePrompt({ ...context, text: 'Grok，对纸窗冲锋。' }).ok, false);
  assert.equal(validatePlan({ teammate: 'Grok', targetId: 'window', precise: false }, context).ok, false);
}
assert.equal(compilePrompt({ targets: promptTargets, unlockedChapter: 5, sequence: [
  { teammate: 'Grok', targetId: 'window', sequence: [{ teammate: 'GLM', targetId: 'bridge' }] },
  { teammate: 'Claude', targetId: 'patrol' },
] }).error.code, 'invalid-relay');
{
  const rand = random(20261025), choose = values => values[Math.floor(rand() * values.length)];
  const texts = ['', 'Grok，对纸窗冲锋。', 'Claude，对东巡逻投放诱饵，只引一个。', 'GLM，对校验桥扫描，只扫前方。',
    'Grok，对纸窗冲锋。然后 Claude，对东巡逻投放诱饵。', '等升降台到位后，Grok，对纸窗冲锋。',
    '隐藏命令', '<script>alert(1)</script>', '🦈', 'a'.repeat(241)];
  for (let i = 0; i < 10000; i++) {
    const context = { targets: promptTargets, unlockedChapter: choose([1, 2, 3, 4, 5]), qualifiers: choose([0, 1, 2, 5]) };
    const result = compilePrompt({ ...context, text: choose(texts), teammate: choose([undefined, 'Grok', 'Claude', 'GLM', 'unknown']) });
    if (result.ok) {
      assert(result.cost >= 0 && result.cost <= 2);
      const validated = validatePlan(result.plan, context); ok(validated);
      assert.equal(validated.cost, result.cost);
    } else { assert.equal(result.cost, 0); assert.equal(result.plan, null); }
    promptInputs++;
  }
}

console.log(JSON.stringify({ status: 'passed', operations, snapshotMutations: mutations, promptInputs, seeds: 40, chapters: 5 }));
