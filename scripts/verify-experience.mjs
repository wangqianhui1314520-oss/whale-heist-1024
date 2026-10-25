/** Pure experience contracts: malformed prompts cannot spend, lessons need actual events, stories use receipts. */
import assert from 'node:assert/strict';
import { compilePrompt, validatePlan, getConstraints, getTemplates } from '../src/game/prompts.mjs';
import { TutorialDirector } from '../src/game/tutorial.mjs';
import { STORY_SCENES, getStoryScene, getStoryReplayIndex } from '../src/game/story.mjs';
import { CONTRACTS, createContract, applyContract, describeContract } from '../src/game/contracts.mjs';

const failures = [];
let count = 0;
const test = (name, callback) => { try { callback(); count++; console.log('PASS ' + name); } catch (error) { failures.push(name); console.error('FAIL ' + name + '\n' + error.stack); } };
const targets = [
  { id: 'paper-window', label: '撞开纸窗', teammate: 'Grok', effect: 'break-obstacle', aliases: ['蓝色隔板'] },
  { id: 'outer-node', label: '外侧节点', teammate: 'Grok', effect: 'break-obstacle' },
  { id: 'patrol-east', label: '东巡逻', teammate: 'Claude', effect: 'change-patrol' },
  { id: 'trap-bridge', label: '校验桥', teammate: 'GLM', effect: 'review-traps' },
  { id: 'east-guard', name: '东守卫', type: 'guard' },
  { id: 'cargo-lift', name: '货运升降台', type: 'lift' },
  { id: 'mfa-core', label: 'MFA门', teammate: 'Grok' },
];
const compile = input => compilePrompt({ targets, unlockedChapter: 5, ...input });
const succeeds = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result; };
const rejects = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.cost, 0); assert.equal(result.plan, null); if (code) assert.equal(result.error.code, code); };

test('card and Chinese text compile to the same precise geometry plan with one charge', () => {
  const text = succeeds(compile({ text: 'Grok，对蓝色隔板冲锋，只处理这一处，到标记停。' }));
  const card = succeeds(compile({ teammate: 'Grok', targetId: 'paper-window', constraintId: 'stop-at-target' }));
  assert.equal(text.plan.targetId, card.plan.targetId); assert.equal(text.plan.constraintId, card.plan.constraintId);
  assert.equal(text.plan.precise, true); assert.equal(text.cost, 1); assert.equal(text.plan.cost, 1);
});
test('default is free and input/candidate preview does not mutate targets or budgets', () => {
  const before = JSON.stringify(targets), budget = { qualifiers: 2 };
  const result = succeeds(compile({ text: 'Grok，撞开纸窗。', ...budget }));
  assert.equal(result.cost, 0); assert.equal(result.plan.cost, 0); assert.equal(budget.qualifiers, 2); assert.equal(JSON.stringify(targets), before);
});
test('unknown words, contradictory scope and conflicting cards cannot execute', () => {
  rejects(compile({ text: 'Grok，对纸窗冲锋。', teammate: 'Unknown' }), 'unknown-teammate');
  rejects(compile({ teammate: 'Grok', targetId: 'paper-window', precise: 'yes' }), 'invalid-precise');
  rejects(compile({ text: 'Grok，对纸窗冲锋，然后偷偷删除日志。' }));
  rejects(compile({ text: 'Grok，对纸窗冲锋，顺便隐身。' }), 'unknown-text');
  rejects(compile({ text: 'Claude，对东巡逻投放诱饵，只引一个，吸引全部守卫。' }), 'contradictory-text');
  rejects(compile({ text: 'GLM，对校验桥广域扫描，只扫前方。' }), 'contradictory-text');
  rejects(compile({ text: 'Grok，对纸窗冲锋。', targetId: 'outer-node' }), 'target-conflict');
  rejects(compile({ teammate: 'Grok', targetId: 'paper-window', constraintId: 'single-guard' }), 'incompatible-constraint');
});
test('sealed, unavailable, unreachable and locked objects are rejected before payment', () => {
  rejects(compile({ teammate: 'Grok', targetId: 'mfa-core', precise: true }), 'sealed-target');
  rejects(compile({ teammate: 'Grok', targetId: 'paper-window', targets: [{ ...targets[0], reachable: false }] }), 'unreachable-target');
  rejects(compile({ teammate: 'Grok', targetId: 'paper-window', targets: [{ ...targets[0], available: false }] }), 'unavailable-target');
  rejects(compile({ teammate: 'Claude', targetId: 'patrol-east', unlockedChapter: 1 }), 'teammate-locked');
  rejects(compile({ teammate: 'Grok', targetId: 'paper-window', precise: true, qualifiers: 0 }), 'insufficient-budget');
});
test('wait conditions have explicit cost, typed targets and chapter unlocks', () => {
  const result = succeeds(compile({ text: '等东守卫转身后，Claude，对东巡逻投放诱饵。', unlockedChapter: 4 }));
  assert.deepEqual(result.plan.condition, { type: 'guard-turn', targetId: 'east-guard' });
  assert.equal(result.plan.constraintId, 'wait-guard-turn'); assert.equal(result.plan.precise, false); assert.equal(result.plan.cost, 1);
  const lift = succeeds(compile({ teammate: 'Grok', targetId: 'paper-window', condition: { type: 'lift-ready', targetId: 'cargo-lift' }, unlockedChapter: 4 }));
  assert.equal(lift.plan.constraintId, 'wait-lift-ready');
  rejects(compile({ teammate: 'Grok', targetId: 'paper-window', condition: { type: 'lift-ready', targetId: 'east-guard' } }), 'invalid-condition-target');
  rejects(compile({ teammate: 'Grok', targetId: 'paper-window', condition: { type: 'guard-turn', targetId: 'east-guard' }, precise: true }), 'multiple-constraints');
  rejects(compile({ ...lift.plan, text: '', unlockedChapter: 3 }), 'constraint-locked');
});
test('relay is exactly two different teammates in order, with atomic budget validation', () => {
  const result = succeeds(compile({ text: 'Grok，对纸窗冲锋，到点停。然后Claude，对东巡逻投放诱饵，只引一个。', qualifiers: 2 }));
  assert.deepEqual(result.plan.sequence.map(entry => entry.teammate), ['Grok', 'Claude']);
  assert.deepEqual(result.plan.sequence.map(entry => entry.cost), [1, 1]); assert.equal(result.cost, 2); assert.equal(result.plan.totalCost, 2);
  rejects(compile({ sequence: result.plan.sequence, qualifiers: 1 }), 'insufficient-budget');
  rejects(compile({ sequence: result.plan.sequence, unlockedChapter: 4 }), 'relay-locked');
  rejects(compile({ sequence: [result.plan.sequence[0], result.plan.sequence[0]] }), 'relay-needs-two-teammates');
  rejects(compile({ sequence: [...result.plan.sequence, result.plan.sequence[0]] }), 'invalid-relay');
  assert.deepEqual(succeeds(validatePlan(result.plan, { targets, unlockedChapter: 5 })).plan.sequence, result.plan.sequence);
});
test('constraints and templates reflect teammate and chapter unlocks', () => {
  assert.deepEqual(getConstraints('Grok', 1).map(entry => entry.id), ['stop-at-target']);
  assert.equal(getConstraints('Grok', 4).length, 3);
  assert.equal(getTemplates(null, 1).length, 2); assert.equal(getTemplates(null, 3).length, 6);
  const list = getConstraints('Grok'); list[0].label = 'tampered'; assert.notEqual(getConstraints('Grok')[0].label, 'tampered');
});

const move = director => succeeds(director.handleEvent('move', { reached: true, eventId: 'move-1' }));
const climb = director => succeeds(director.handleEvent('climb', { reached: true, grounded: true, eventId: 'climb-1' }));
const jump = director => succeeds(director.handleEvent('jump', { crossedGap: true, grounded: true, eventId: 'jump-1' }));
test('chapter one is actual movement, two independent node attacks, break, delivery and board', () => {
  const director = new TutorialDirector(1);
  assert.equal(director.handleEvent('move', { pressed: true }).ok, false); move(director); climb(director); jump(director);
  succeeds(director.handleEvent('node-hit', { nodeId: 'node-1', hp: 1, attackId: 'dash-1', eventId: 'hit-1' }));
  assert.equal(director.handleEvent('node-open', { nodeId: 'node-1', hp: 0, attackId: 'dash-1' }).ok, false);
  assert.equal(director.handleEvent('node-open', { nodeId: 'another', hp: 0, attackId: 'dash-2' }).ok, false);
  succeeds(director.handleEvent('node-open', { nodeId: 'node-1', hp: 0, attackId: 'dash-2' }));
  assert.equal(director.handleEvent('command-complete', { teammate: 'Grok', effect: 'break-obstacle', preview: true }).ok, false);
  succeeds(director.handleEvent('obstacle-broken', { teammate: 'Grok', broken: true }));
  assert.equal(director.handleEvent('delivery', { status: 'completed', count: 0 }).ok, false);
  succeeds(director.handleEvent('delivery', { status: 'completed', count: 3 }));
  succeeds(director.handleEvent('chapter-result', {})); assert.equal(director.getState().done, true);
});
test('tutorial restore preserves node identity and cannot jump unfinished lessons', () => {
  const director = new TutorialDirector(1); move(director); climb(director); jump(director);
  succeeds(director.handleEvent('node-first', { nodeId: 'n', hp: 1, attackId: 'a' }));
  const restored = TutorialDirector.restore(JSON.parse(JSON.stringify(director.serialize())));
  assert.equal(restored.current().id, 'node-open');
  assert.equal(restored.handleEvent('node-open', { nodeId: 'n', hp: 0, attackId: 'a' }).ok, false);
  succeeds(restored.handleEvent('node-open', { nodeId: 'n', hp: 0, attackId: 'b' }));
  const corrupt = director.serialize(); corrupt.completed = ['board']; assert.equal(director.restore(corrupt).ok, false);
  assert.equal(director.current().id, 'node-open');
});
test('an actual action completed early is remembered without redoing it after restore', () => {
  const director = new TutorialDirector(1);
  succeeds(director.handleEvent('jump', { crossedGap: true, grounded: true, eventId: 'early-jump' }));
  assert.equal(director.current().id, 'move');
  const restored = TutorialDirector.restore(director.serialize()); move(restored); climb(restored);
  assert.equal(restored.current().id, 'node-first'); assert.deepEqual(restored.completed, ['move', 'climb', 'jump']);
  assert.equal(restored.handleEvent('jump', { crossedGap: true, grounded: true, eventId: 'early-jump' }).reason, 'duplicate-event');
});
test('12s goal, 25s tool and two actual failures reveal progressively stronger guidance', () => {
  const director = new TutorialDirector(1);
  for (const inactive of [{ reading: true }, { paused: true }, { focused: false }, { active: false }]) director.tick(100, { ...inactive, failed: true });
  assert.equal(director.getState().idleSeconds, 0); assert.equal(director.getState().failures, 0);
  director.tick(11.9); assert.equal(director.getState().hintLevel, 0);
  director.tick(.1); assert.equal(director.getState().hintLevel, 1);
  director.tick(13); assert.equal(director.getState().hintLevel, 2); assert.equal(director.getState().canShowRoute, false);
  director.tick(100); assert.equal(director.getState().hintLevel, 2);
  director.tick(0, { failed: true }); assert.equal(director.getState().hintLevel, 2);
  director.tick(0, { failed: true }); assert.equal(director.getState().hintLevel, 3); assert.equal(director.getState().canShowRoute, true);
  const hint = director.hint(); assert.equal(hint.route, true);
  for (const part of director.current().hints) assert(hint.text.includes(part), 'explicit help includes goal, tool and route');
  assert.equal(director.current().id, 'move'); move(director);
  assert.equal(director.getState().hintLevel, 0); assert.equal(director.getState().failures, 0);
  director.skip(); assert.equal(director.getState().done, true);
  director.restart(); assert.equal(director.current().id, 'move');
});

test('ten-step guide verifies teammate, target, default plan and confirmation without inventing a world effect', () => {
  const director = new TutorialDirector(1); move(director); climb(director); jump(director);
  succeeds(director.handleEvent('node-hit', { nodeId: 'n', hp: 1, attackId: 'a' }));
  assert.equal(director.guideView().index, 3);
  succeeds(director.handleEvent('node-open', { nodeId: 'n', hp: 0, attackId: 'b' }));
  assert.equal(director.guideView().index, 4);
  assert.equal(director.guidedInput('confirm-command', { teammate: 'Grok', targetId: 'paper-window', precise: false }).ok, false);
  assert.equal(director.guidedInput('select-teammate', { teammate: 'Claude' }).ok, false);
  director.tick(25); succeeds(director.guidedInput('select-teammate', { teammate: 'Grok' }));
  assert.equal(director.getState().idleSeconds, 0); assert.equal(director.guideView().index, 5);
  assert.equal(director.guidedInput('select-target', { teammate: 'Grok', targetId: 'outer-node' }).ok, false);
  succeeds(director.guidedInput('select-target', { teammate: 'Grok', targetId: 'paper-window' }));
  assert.equal(director.guideView().index, 6);
  assert.equal(director.guidedInput('default-plan', { precise: true }).ok, false);
  succeeds(director.guidedInput('default-plan', { precise: false })); assert.equal(director.guideView().index, 7);
  const before = director.serialize(), confirm = { teammate: 'Grok', targetId: 'paper-window', precise: false };
  succeeds(director.guidedInput('confirm-command', confirm, { commit: false }));
  assert.deepEqual(director.serialize(), before, 'rejected world execution can retry confirmation');
  succeeds(director.guidedInput('confirm-command', confirm)); assert.equal(director.current().id, 'grok-obstacle');
  assert.equal(director.handleEvent('command-complete', { ...confirm, status: 'prepared' }).ok, false);
  succeeds(director.handleEvent('obstacle-broken', { ...confirm, broken: true })); assert.equal(director.guideView().index, 8);
  succeeds(director.handleEvent('delivery', { count: 2, complete: true })); assert.equal(director.guideView().index, 9);
  succeeds(director.handleEvent('board', { complete: true })); assert.equal(director.getState().done, true);
});

test('old tutorial saves without guided command stage restore their real action evidence', () => {
  const director = new TutorialDirector(1); move(director); climb(director); jump(director);
  succeeds(director.handleEvent('node-hit', { nodeId: 'n', hp: 1, attackId: 'a' }));
  succeeds(director.handleEvent('node-open', { nodeId: 'n', hp: 0, attackId: 'b' }));
  const old = director.serialize(); delete old.guidedCommandStage;
  const restored = TutorialDirector.restore(old); assert.equal(restored.guidedCommandStage, 0); assert.equal(restored.guideView().index, 4);
  succeeds(restored.handleEvent('obstacle-broken', { teammate: 'Grok', broken: true }));
  const afterObstacle = restored.serialize(); delete afterObstacle.guidedCommandStage;
  assert.equal(TutorialDirector.restore(afterObstacle).guidedCommandStage, 4);
});
test('chapter two uses actual default/one-guard outcomes and marked training budget', () => {
  const director = new TutorialDirector(2);
  assert.equal(director.handleEvent('command-complete', { teammate: 'Claude', precise: false, status: 'completed' }).ok, false);
  succeeds(director.handleEvent('command-complete', { teammate: 'Claude', precise: false, status: 'completed', affectedCount: 2 }));
  assert.equal(director.handleEvent('constraint-effective', { teammate: 'Claude', precise: true, status: 'completed', affectedCount: 1 }).ok, false);
  succeeds(director.handleEvent('constraint-effective', { teammate: 'Claude', precise: true, status: 'completed', affectedCount: 1, budgetSource: 'training' }));
  assert.equal(director.getState().done, true);
  const glm = new TutorialDirector(3);
  succeeds(glm.handleEvent('scan-complete', { teammate: 'GLM', status: 'completed', revealedIds: ['trap-1'] })); assert.equal(glm.getState().done, true);
});

test('short story timings and replay index cover all five briefings and joins', () => {
  const intro = getStoryScene('prologue'); assert(intro.duration >= 25 && intro.duration <= 30);
  assert.equal(intro.duration, intro.steps.reduce((total, step) => total + step.duration, 0));
  assert.deepEqual(intro.requiredChoices, ['observe', 'issue', 'evacuate']);
  assert.deepEqual(intro.steps.filter(step => step.choice).map(step => step.choice.options[0].id), intro.requiredChoices);
  for (let n = 1; n <= 5; n++) assert(getStoryScene(`chapter${n}-briefing`));
  assert(getStoryScene('claude-join').duration <= 8); assert(getStoryScene('glm-join').duration <= 8);
  for (const entry of Object.values(STORY_SCENES)) for (const item of getStoryScene(entry.id).steps) for (const key of ['speaker', 'text', 'pose', 'backdrop', 'duration']) assert(key in item);
  assert(getStoryReplayIndex({ seenScenes: ['prologue'] }).find(item => item.id === 'prologue').seen);
});
test('chapter four branches preserve prior broadcasts and quote only actual receipts', () => {
  const records = [{ id: 'real-cmd-7', type: 'command', teammate: 'Grok', promptText: '只处理纸窗，到点停。', elapsedMs: 63000, public: true },
    { id: 'private-cmd', type: 'command', teammate: 'GLM', promptText: '只扫前方。', public: false }];
  const on = getStoryScene('chapter4-reveal', { broadcastOn: true, records });
  const off = getStoryScene('chapter4-reveal', { broadcastOn: false, records });
  assert.equal(on.branch, 'broadcast-on'); assert.equal(off.branch, 'broadcast-off');
  assert.deepEqual(off.sourceRecordIds, ['real-cmd-7']); assert(off.steps.some(entry => entry.text.includes('只处理纸窗')));
  assert(!off.steps.some(entry => entry.text.includes('只扫前方'))); assert(off.steps.some(entry => entry.text.includes('提前关闭')));
  assert(!getStoryScene('chapter4-reveal').sourceRecordIds.length);
  assert(getStoryScene('chapter4-reveal').steps.some(entry => entry.text.includes('没有可核验')));
  assert.equal(records[0].promptText, '只处理纸窗，到点停。');
});
test('final preparation never claims unstarted countdown and epilogue uses actual totals', () => {
  const prep = getStoryScene('chapter5-preparation', { rendezvousCrew: ['Grok'], remoteReady: false, evacuationStarted: false });
  assert(prep.steps.some(entry => entry.text.includes('1/3'))); assert(prep.steps.some(entry => entry.text.includes('尚未开始')));
  const actualPrep = getStoryScene('chapter5-preparation', { rendezvousCrew: ['Grok'], records: [{ id: 'actual-rendezvous', type: 'rendezvous', teammate: 'Grok' }] });
  assert.deepEqual(actualPrep.sourceRecordIds, ['actual-rendezvous']); assert(actualPrep.duration <= 8);
  const ending = getStoryScene('epilogue', { broadcastOn: false, completed: true,
    results: [{ score: 87, events: { publicCommands: 2, publicDeliveries: 1, alarms: 3 } }], records: [{ id: 'real-delivery', type: 'delivery', count: 3, elapsedMs: 99000 }] });
  assert(ending.steps.some(entry => entry.text.includes('87 分'))); assert(ending.steps.some(entry => entry.text.includes('报警 3 次')));
  assert.deepEqual(ending.sourceRecordIds, ['real-delivery']);
});

test('contracts are explicit, deterministic, detached and preserve static fallback routes', () => {
  assert.equal(CONTRACTS.length, 4);
  const base = { id: 'paper-window', qualifiers: 4, guards: [{ id: 'g', x: 20, minX: 10, maxX: 100, speed: 50 }],
    gates: [{ id: 'short', shortcut: true, open: true }, { id: 'main', open: true }], ladders: [{ id: 'fallback' }] };
  const low = applyContract(base, createContract('low-budget', { seed: 'visible-seed' })); assert.equal(low.qualifiers, 1); assert.equal(base.qualifiers, 4);
  const patrol = createContract('dense-patrol', { seed: 'same', chapter: 2 });
  assert.deepEqual(applyContract(base, patrol), applyContract(base, patrol)); assert.equal(applyContract(base, patrol).guards[0].speed, 60);
  assert.notEqual(createContract('dense-patrol', { seed: 'different', chapter: 2 }).layoutSeed, patrol.layoutSeed);
  const closed = applyContract(base, createContract('closed-shortcuts'));
  assert.equal(closed.gates[0].contractClosed, true); assert.equal(closed.gates[1].open, true); assert.deepEqual(closed.ladders, base.ladders);
  assert.equal(describeContract(patrol).seed, 'same'); assert.equal(patrol.officialCampaignScore, false);
});

if (failures.length) { console.error(`${failures.length} failed: ${failures.join(', ')}`); process.exitCode = 1; }
else console.log(`Experience verification: ${count} passed.`);
