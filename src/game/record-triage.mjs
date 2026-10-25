/**
 * Optional public-record triage for the fictional offline archive.
 *
 * This is an editorial choice inside the game. It never contacts a server,
 * changes a real record, or exposes an address, credential, command, or
 * exploit payload. The selected treatment is saved as a local investigation
 * note and never gates chapter completion.
 */
const clone = value => JSON.parse(JSON.stringify(value));

export const RECORD_TRIAGE_CHOICES = Object.freeze([
  Object.freeze({ id: 'publish-summary', label: '公开摘要', short: '保留结论，隐藏细节', outcome: '已生成一条不含细节的公开摘要。' }),
  Object.freeze({ id: 'seal-evidence', label: '封存证据', short: '仅队内保存', outcome: '证据已封存，仅保留在鲸艇调查档案。' }),
  Object.freeze({ id: 'flag-review', label: '标记待核验', short: '交给调查员复核', outcome: '已标记待核验，后续由调查员复查。' }),
]);

const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 160;
const choiceFor = id => RECORD_TRIAGE_CHOICES.find(choice => choice.id === id) || null;
const isPublic = record => Boolean(record?.public ?? record?.broadcastOn ?? record?.published);
const sourceRecords = records => (Array.isArray(records) ? records : [])
  .filter(record => record && typeof record === 'object' && (record.type === 'command' || record.type === 'delivery' || record.type === 'broadcast' || isPublic(record)));

/** Return a detached, compact view for the records panel. */
export function recordTriageState(records = []) {
  const all = sourceRecords(records);
  const source = [...all].reverse().find(isPublic) || [...all].reverse()[0] || null;
  const selected = [...(Array.isArray(records) ? records : [])].reverse().find(record => record?.type === 'record-triage' && record.sourceRecordId === (source && String(source.id || '')));
  return {
    available: Boolean(source),
    source: source ? { id: String(source.id || ''), text: String(source.promptText || source.text || source.outcome || source.type || '公开记录').slice(0, 140) } : null,
    selected: selected ? { choiceId: selected.choiceId || null, sourceRecordId: selected.sourceRecordId || null } : null,
    choices: RECORD_TRIAGE_CHOICES.map(clone),
  };
}

/**
 * Apply one treatment to the latest public fictional record.
 * The caller persists the returned record in its local archive.
 */
export function chooseRecordTreatment(choiceId, { records = [] } = {}) {
  const choice = choiceFor(choiceId);
  if (!choice) return { ok: false, reason: 'unknown-record-treatment' };
  const all = sourceRecords(records);
  const source = [...all].reverse().find(isPublic) || [...all].reverse()[0] || null;
  if (!source || !validId(String(source.id || 'record'))) return { ok: false, reason: 'no-public-record' };
  const sourceRecordId = String(source.id);
  const duplicate = (Array.isArray(records) ? records : []).some(record => record?.type === 'record-triage'
    && record.sourceRecordId === sourceRecordId);
  if (duplicate) return { ok: false, reason: 'record-treatment-already-selected' };
  const publicSummary = choice.id === 'publish-summary';
  const record = {
    id: `triage-${sourceRecordId}-${choice.id}`.slice(0, 160),
    type: 'record-triage',
    teammate: 'DeepSeek',
    sourceRecordId,
    choiceId: choice.id,
    promptText: `公开记录处理：${choice.label}`,
    outcome: choice.outcome,
    public: publicSummary,
    published: publicSummary,
    broadcastOn: publicSummary,
    safe: true,
  };
  return { ok: true, choice: clone(choice), source: clone(source), record };
}
