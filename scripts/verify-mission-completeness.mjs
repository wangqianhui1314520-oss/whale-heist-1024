/** Main gates and optional investigation progress must remain independent. */
import assert from 'node:assert/strict';
import { CHAPTERS } from '../src/core/chapters.mjs';
import { GameCore } from '../src/core/state.mjs';
import { chapterCheckpoint } from '../src/game/session.mjs';

const ok = result => assert.equal(result.ok, true, JSON.stringify(result));
let sequence = 0;
const transport = (core, items) => {
  for (const item of items) {
    if (core.view().attempt.inventory.length === 3) ok(core.deliver('mission-delivery-' + ++sequence));
    ok(core.pickup(item.id));
  }
  if (core.view().attempt.inventory.length) ok(core.deliver('mission-delivery-' + ++sequence));
};
let archives = 0, supplies = 0;
for (const chapter of CHAPTERS) {
  const fixture = () => new GameCore({ checkpoint: chapterCheckpoint(chapter.id), persist: false });
  const core = fixture(), initial = core.view().optionalObjectives, initialScore = core.view().campaign.totalScore;
  assert.deepEqual(initial, core.optionalObjectives());
  assert(initial.every(goal => goal.optional && goal.current === 0 && !goal.complete));
  assert.equal(initial.filter(goal => goal.kind === 'analysis').length, 3);
  archives += initial.find(goal => goal.id === 'optional-delivery')?.required ?? 0;
  supplies += initial.find(goal => goal.id === 'optional-supplies')?.required ?? 0;
  transport(core, chapter.optionalItems);
  if (chapter.optionalItems.length) assert(core.optionalObjectives().find(goal => goal.id === 'optional-delivery').complete);
  for (const supply of chapter.supplies.filter(entry => entry.optionalObjective)) ok(core.collectSupply(supply.id));
  if (chapter.number === 5) assert(core.optionalObjectives().find(goal => goal.id === 'optional-supplies').complete);
  for (const clue of core.vulnerabilityState().caseFile.clues) {
    ok(core.collectVulnerabilityEvidence(clue.id));ok(core.analyzeVulnerability(clue.id));
  }
  ok(core.selectVulnerabilityRepair(core.vulnerabilityState().caseFile.repairs[0].id));
  if (chapter.number === 4) ok(core.setBroadcast(false));
  assert(core.optionalObjectives().every(goal => goal.complete));
  assert.equal(core.view().campaign.totalScore, initialScore, 'Optional progress never directly awards score');
  const restored = fixture();ok(restored.restoreRuntime(JSON.parse(JSON.stringify(core.exportRuntime()))));
  assert.deepEqual(restored.optionalObjectives(), core.optionalObjectives());

  // Leave every optional objective unfinished while satisfying only real gates.
  const main = fixture();
  if (chapter.number <= 3) {
    const target = chapter.commandTargets.find(entry => chapter.number === 1 || entry.effect === (chapter.number === 2 ? 'change-patrol' : 'review-traps'));
    ok(main.prepareCommand({commandId:'main-command',teammate:target.teammate,targetId:target.id}));
    ok(main.beginCommand(target.teammate));ok(main.completeCommand(target.teammate,'main-command'));
  }
  // Chapter four's broadcast is optional by design: the main-only run boards
  // with the ledger still public, so only the beacon gate is satisfied here.
  if (chapter.number === 4) ok(main.activateReturnBeacon());
  if (chapter.number === 5) {
    for (const item of chapter.requiredItems) ok(main.pickup(item.id));
    for (const name of chapter.teammates) ok(main.rendezvous(name, chapter.rendezvousTarget));
    ok(main.prepareRemoteBeacon(chapter.rendezvousTarget));ok(main.startEvacuation(chapter.rendezvousTarget));
    assert(main.optionalObjectives().find(goal => goal.id === 'optional-supplies').sealed);
    ok(main.deliver('final-main-delivery'));
  } else transport(main, chapter.requiredItems);
  assert(main.objectives().every(goal => goal.complete));
  assert(main.optionalObjectives().every(goal => !goal.complete));
  ok(main.board());assert.equal(main.view().phase, 'chapter-result');
  console.log('PASS ' + chapter.id + ': optional progress restores and incomplete side investigations never block boarding');
}
assert.equal(archives, 8);assert.equal(supplies, 2);
console.log('PASS mission coverage: 8 optional archives, 2 evacuation supplies, and all 5 evidence chains');
