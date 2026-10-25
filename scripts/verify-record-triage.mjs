import assert from 'node:assert/strict';
import { recordTriageState, chooseRecordTreatment } from '../src/game/record-triage.mjs';

const records = [
  { id: 'chapter4:command-1', type: 'command', teammate: 'GLM', public: true, promptText: '扫描广播室目标' },
  { id: 'chapter4:delivery-1', type: 'delivery', public: false, outcome: '资料已交付' },
];
const state = recordTriageState(records);
assert.equal(state.available, true);
assert.equal(state.source.id, 'chapter4:command-1');
assert.equal(state.choices.length, 3);
for (const choice of state.choices) {
  const picked = chooseRecordTreatment(choice.id, { records });
  assert.equal(picked.ok, true);
  assert.equal(picked.record.type, 'record-triage');
  assert.equal(picked.record.sourceRecordId, 'chapter4:command-1');
  assert.equal(picked.record.safe, true);
}
assert.equal(chooseRecordTreatment('bad-choice', { records }).ok, false);
assert.equal(chooseRecordTreatment('seal-evidence', { records: [] }).reason, 'no-public-record');
const prior = { id: 'triage-chapter4:command-1-seal-evidence', type: 'record-triage', sourceRecordId: 'chapter4:command-1', choiceId: 'seal-evidence' };
assert.equal(chooseRecordTreatment('seal-evidence', { records: [...records, prior] }).reason, 'record-treatment-already-selected');
console.log('PASS optional public-record triage: three choices, safe local record, duplicate guard');
