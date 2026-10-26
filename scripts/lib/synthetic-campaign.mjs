// Isolated test fixtures built through the game's rules, never real player records.
import assert from 'node:assert/strict';
import { GameCore } from '../../src/core/state.mjs';
let sequence = 0;
const unique = kind => `synthetic-campaign-${kind}-${++sequence}`;
const ok = result => assert.equal(result.ok, true, JSON.stringify(result));
export function finishSyntheticChapter(core) {
  core.setPaused(false);
  const { chapter } = core.view();
  const execute = target => {
    const commandId = unique('command');
    ok(core.prepareCommand({ commandId, teammate: target.teammate, targetId: target.id, precise: false }));
    ok(core.beginCommand(target.teammate)); ok(core.completeCommand(target.teammate, commandId)); ok(core.advanceTime(8000));
  };
  if (chapter.number === 5) {
    for (const item of chapter.requiredItems) ok(core.pickup(item.id));
    for (const teammate of ['Grok', 'Claude', 'GLM']) ok(core.rendezvous(teammate, chapter.rendezvousTarget));
    ok(core.prepareRemoteBeacon(chapter.rendezvousTarget));
    for (const target of chapter.commandTargets.filter(target => target.collaboration)) execute(target);
    ok(core.startEvacuation(chapter.rendezvousTarget)); ok(core.deliver(unique('delivery')));
  } else {
    for (const target of chapter.commandTargets.filter(target => target.collaboration)) execute(target);
    for (const item of chapter.requiredItems) {
      if (core.view().attempt.inventory.length === 3) ok(core.deliver(unique('delivery')));
      ok(core.pickup(item.id));
    }
    if (core.view().attempt.inventory.length) ok(core.deliver(unique('delivery')));
    if (chapter.number === 4) { ok(core.setBroadcast(false)); ok(core.activateReturnBeacon()); }
  }
  ok(core.board());
}
export function syntheticCampaignSave(completedChapters) {
  assert(Number.isInteger(completedChapters) && completedChapters >= 0 && completedChapters <= 5);
  const core = new GameCore({ storage: null, persist: false });
  for (let index = 0; index < completedChapters; index++) { finishSyntheticChapter(core); ok(core.continueCampaign()); }
  return { format: 'whale-heist-save', version: 2, campaign: core.checkpoint(), experience: null,
    archive: { version: 3, records: [], seenStories: [], templates: [] } };
}
