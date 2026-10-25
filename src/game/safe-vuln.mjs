/**
 * Fictional vulnerability-analysis sandbox for 鲸鱼魔盗团.
 *
 * This module deliberately models observation and repair planning only. It
 * never stores real addresses, credentials, commands, exploit payloads or
 * instructions for accessing a real system. Every clue belongs to the
 * fictional “鲸港演算舱” and can be completed offline.
 */
const clone = value => JSON.parse(JSON.stringify(value));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

export const ANALYSIS_TOKEN_MAX = 6;
export const ANALYSIS_TOKEN_START = 5;
const CHAPTERS = ['paper-window', 'resume-storm', 'review-quietly', 'public-report', 'close-hatch'];

const CASES = [
  {
    chapterId: 'paper-window', chapter: 1, title: '纸窗的异常回声', subtitle: '发现异常，但先保持观察',
    briefing: '鲸港演算舱出现重复的门禁回声。小队只能在沙盒中整理线索，不能直接修改任何系统。',
    clues: [
      { id: 'c1-window-replay', label: '纸窗回声记录', kind: 'log', text: '同一份门禁回声在短时间内出现两次，时间顺序不一致。', tags: ['时间线', '异常重复'], requires: [] },
      { id: 'c1-sealed-note', label: '封存便签', kind: 'note', text: '值班员建议暂缓通行，并核对门禁来源。', tags: ['人工复核'], requires: ['c1-window-replay'] },
      { id: 'c1-safe-route', label: '安全路线草图', kind: 'map', text: '沙盒提供一条绕行路线，可在不触碰异常节点的情况下继续任务。', tags: ['保底路线'], requires: ['c1-window-replay'] },
    ],
    repairs: [
      { id: 'r1-sequence-check', label: '增加事件顺序校验', text: '让门禁记录按统一时间线排序，并把重复事件标记给人工复核。', supports: ['c1-window-replay'] },
      { id: 'r1-safe-fallback', label: '启用安全绕行', text: '异常未确认前保持原通道封存，允许队伍使用已审查的绕行路线。', supports: ['c1-safe-route'] },
    ],
  },
  {
    chapterId: 'resume-storm', chapter: 2, title: '简历夹层', subtitle: '确认资料流向',
    briefing: '资料分拣区出现同一份简历被多次转交的迹象。分析的目标是找出流向断点，而不是模拟真实投递。',
    clues: [
      { id: 'c2-resume-copy', label: '简历副本索引', kind: 'document', text: '同一编号的副本出现在两个虚构分拣柜，来源字段缺少一段说明。', tags: ['副本', '来源'], requires: [] },
      { id: 'c2-guard-route', label: '巡逻交接卡', kind: 'note', text: '交接时段与副本出现时段相邻，仍需人工确认关联性。', tags: ['交接', '时间窗'], requires: ['c2-resume-copy'] },
      { id: 'c2-duplicate-flag', label: '重复投递标记', kind: 'screen', text: '沙盒标记了疑似重复流转的记录，未对外发送任何内容。', tags: ['沙盒标记'], requires: ['c2-resume-copy'] },
    ],
    repairs: [
      { id: 'r2-provenance', label: '补充资料来源链', text: '为每次转交补充来源与接收方，缺失时暂停流转并请求复核。', supports: ['c2-resume-copy'] },
      { id: 'r2-single-review', label: '设置单人复核', text: '疑似重复资料进入单人复核队列，避免同一份资料被多次处理。', supports: ['c2-duplicate-flag'] },
    ],
  },
  {
    chapterId: 'review-quietly', chapter: 3, title: '复查勿扰', subtitle: '用最小范围确认风险',
    briefing: '复查桥上的警戒器会对过宽的观察范围发出提示。小队要学会以最小范围核对线索。',
    clues: [
      { id: 'c3-scan-shadow', label: '扫描阴影', kind: 'sensor', text: '一段检测结果被安全沙盒标为“范围不足”，无法单独作为结论。', tags: ['范围', '不完整'], requires: [] },
      { id: 'c3-alarm-cycle', label: '警戒周期表', kind: 'screen', text: '警戒器按固定周期亮起，亮起不等于已经发生外泄。', tags: ['周期', '误报边界'], requires: [] },
      { id: 'c3-confirmed-gap', label: '复查缺口', kind: 'log', text: '两次安全复查之间缺少一条连续记录，需要补做人工复核。', tags: ['证据缺口'], requires: ['c3-scan-shadow', 'c3-alarm-cycle'] },
    ],
    repairs: [
      { id: 'r3-narrow-observe', label: '采用最小观察范围', text: '默认只观察当前目标附近的沙盒数据，扩大范围前要求再次确认。', supports: ['c3-scan-shadow'] },
      { id: 'r3-continuous-audit', label: '补齐连续复查', text: '为相邻复查建立连续编号，缺失时转入人工复核，不自动下结论。', supports: ['c3-confirmed-gap'] },
    ],
  },
  {
    chapterId: 'public-report', chapter: 4, title: '公开广播', subtitle: '区分已公开与仅在沙盒出现的记录',
    briefing: '战报屏幕正在广播。玩家需要辨别哪些记录已经公开，哪些仍只存在于内部沙盒。',
    clues: [
      { id: 'c4-broadcast-ledger', label: '广播账本', kind: 'log', text: '账本只显示公开状态和时间，不包含任何真实网络位置。', tags: ['公开状态'], requires: [] },
      { id: 'c4-draft-screen', label: '内部草稿屏', kind: 'screen', text: '草稿只在本地沙盒可见，未被计入公开记录。', tags: ['内部', '未公开'], requires: [] },
      { id: 'c4-disclosure-gap', label: '公开边界缺口', kind: 'note', text: '一条记录的公开状态没有得到二次确认，应保持封存。', tags: ['二次确认'], requires: ['c4-broadcast-ledger', 'c4-draft-screen'] },
    ],
    repairs: [
      { id: 'r4-broadcast-gate', label: '广播前二次确认', text: '公开前要求队长和记录员共同确认，状态不明时默认封存。', supports: ['c4-disclosure-gap'] },
      { id: 'r4-public-separation', label: '分离公开与草稿', text: '为公开账本和内部草稿设置清晰边界，并显示醒目标记。', supports: ['c4-broadcast-ledger', 'c4-draft-screen'] },
    ],
  },
  {
    chapterId: 'close-hatch', chapter: 5, title: '闭舱返航', subtitle: '把证据链完整带回',
    briefing: '最后三份资料是本章主线目标。证据链整理是可选调查支线：可以核对线索来源、分析结论和修复建议，写入调查笔录；未完成分析也能按任务清单装载、撤离并登艇。',
    clues: [
      { id: 'c5-chain-index', label: '证据链索引', kind: 'archive', text: '索引列出四章已确认的线索，但仍有一项来源等待队友签名。', tags: ['索引', '待签名'], requires: [] },
      { id: 'c5-crew-signoff', label: '队友复核签名', kind: 'note', text: '三名队友分别确认自己负责的观察结果，签名只代表复核，不代表执行。', tags: ['复核', '协作'], requires: ['c5-chain-index'] },
      { id: 'c5-return-check', label: '可选调查清单', kind: 'checklist', text: '可选调查清单用于核对证据链和修复建议，补全后写入调查笔录。主线仍以三份资料、三名队友集结和确认撤离为准，调查进度不阻挡登艇。', tags: ['可选调查'], requires: ['c5-chain-index', 'c5-crew-signoff'] },
    ],
    repairs: [
      { id: 'r5-evidence-bundle', label: '封存证据包', text: '将已确认线索、来源和修复建议打包为只读档案，交回调查桌。', supports: ['c5-return-check'] },
      { id: 'r5-rotate-review', label: '轮换复核人', text: '下一次航程由不同队友复核同一条关键线索，减少单点判断。', supports: ['c5-crew-signoff'] },
    ],
  },
];

const CASE_INDEX = new Map(CASES.map(item => [item.chapterId, item]));
freeze(CASES);

const chapterOf = chapter => typeof chapter === 'object' ? chapter.chapterId ?? chapter.id : chapter;
const safeChapter = chapter => CASE_INDEX.has(chapterOf(chapter)) ? chapterOf(chapter) : null;
const finiteInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const clueFor = (caseFile, clueId) => caseFile?.clues.find(clue => clue.id === clueId) ?? null;

/** Return a detached fictional case file. It is safe to show in a briefing. */
export function getVulnerabilityCase(chapterId) {
  const entry = CASE_INDEX.get(safeChapter(chapterId));
  return entry ? clone(entry) : null;
}

export function listVulnerabilityCases() {
  return CASES.map(entry => ({ chapterId: entry.chapterId, chapter: entry.chapter, title: entry.title, subtitle: entry.subtitle }));
}

/**
 * Create a deterministic offline analysis session. `tokens` is a gameplay
 * resource only; it is never exchanged for network access.
 */
export function createAnalysisSession({ chapterId, tokens = ANALYSIS_TOKEN_START, collected = [], analyzed = [], repairs = [] } = {}) {
  const chapter = safeChapter(chapterId);
  if (!chapter) return { ok: false, reason: 'unknown-chapter' };
  if (!finiteInt(tokens, 0, ANALYSIS_TOKEN_MAX)) return { ok: false, reason: 'invalid-token-count' };
  const file = CASE_INDEX.get(chapter);
  const valid = ids => Array.isArray(ids) && [...new Set(ids)].length === ids.length && ids.every(id => Boolean(clueFor(file, id)));
  if (!valid(collected) || !valid(analyzed)) return { ok: false, reason: 'invalid-clue-list' };
  const validRepairs = Array.isArray(repairs) && [...new Set(repairs)].length === repairs.length && repairs.every(id => file.repairs.some(item => item.id === id));
  if (!validRepairs) return { ok: false, reason: 'invalid-repair-list' };
  if (analyzed.some(id => !collected.includes(id))) return { ok: false, reason: 'analysis-without-evidence' };
  return { ok: true, session: { version: 1, chapterId: chapter, tokens, collected: [...collected], analyzed: [...analyzed], repairs: [...repairs], history: [] } };
}

const result = (ok, session, extra = {}) => ({ ok, session: clone(session), ...extra });

/** Add evidence found by a real in-game pickup/record event. No token is spent. */
export function collectEvidence(session, clueId, { source = '沙盒记录', eventId = null } = {}) {
  if (!session || session.version !== 1) return { ok: false, reason: 'invalid-session' };
  const file = CASE_INDEX.get(session.chapterId), clue = clueFor(file, clueId);
  if (!clue) return { ok: false, reason: 'unknown-clue' };
  if (session.collected.includes(clueId)) return result(false, session, { reason: 'already-collected' });
  if (clue.requires.some(id => !session.collected.includes(id))) return result(false, session, { reason: 'evidence-prerequisite', missing: clue.requires.filter(id => !session.collected.includes(id)) });
  const next = clone(session); next.collected.push(clueId); next.history.push({ type: 'collect', clueId, source: String(source).slice(0, 80), eventId: eventId ? String(eventId) : null });
  return result(true, next, { clue: clone(clue), tokensSpent: 0 });
}

/** Spend one or two analysis tokens to produce a safe, non-operational summary. */
export function analyzeEvidence(session, clueId, { mode = 'summarize' } = {}) {
  if (!session || session.version !== 1) return { ok: false, reason: 'invalid-session' };
  const file = CASE_INDEX.get(session.chapterId), clue = clueFor(file, clueId);
  if (!clue) return { ok: false, reason: 'unknown-clue' };
  if (!session.collected.includes(clueId)) return result(false, session, { reason: 'evidence-not-collected' });
  if (session.analyzed.includes(clueId)) return result(false, session, { reason: 'already-analyzed' });
  const costs = { summarize: 1, correlate: 2, check: 1 };
  const cost = costs[mode];
  if (!cost) return { ok: false, reason: 'unknown-analysis-mode' };
  if (session.tokens < cost) return result(false, session, { reason: 'insufficient-analysis-tokens', required: cost, available: session.tokens });
  const next = clone(session); next.tokens -= cost; next.analyzed.push(clueId); next.history.push({ type: 'analyze', clueId, mode, cost });
  const summary = mode === 'correlate'
    ? `已将“${clue.label}”与本章其他沙盒记录对照；这只说明线索之间存在待核验关联，不代表已经发生外泄。`
    : mode === 'check'
      ? `已完成“${clue.label}”的完整性检查；来源与状态仍需以队友复核为准。`
      : `已整理“${clue.label}”：${clue.text}`;
  return result(true, next, { clue: clone(clue), analysis: { mode, cost, summary, safe: true }, tokensSpent: cost });
}

/** Return repair suggestions unlocked by the currently analysed evidence. */
export function repairSuggestions(session) {
  if (!session || session.version !== 1) return { ok: false, reason: 'invalid-session' };
  const file = CASE_INDEX.get(session.chapterId);
  return { ok: true, suggestions: file.repairs.filter(item => item.supports.some(id => session.analyzed.includes(id))).map(clone), locked: file.repairs.filter(item => !item.supports.some(id => session.analyzed.includes(id))).map(item => ({ id: item.id, label: item.label })).map(clone) };
}

/** Select a repair suggestion; selection is recorded but has no external side effect. */
export function selectRepair(session, repairId) {
  if (!session || session.version !== 1) return { ok: false, reason: 'invalid-session' };
  const file = CASE_INDEX.get(session.chapterId), repair = file.repairs.find(item => item.id === repairId);
  if (!repair) return result(false, session, { reason: 'unknown-repair' });
  if (!repair.supports.some(id => session.analyzed.includes(id))) return result(false, session, { reason: 'repair-locked' });
  if (session.repairs.includes(repairId)) return result(false, session, { reason: 'already-selected' });
  const next = clone(session); next.repairs.push(repairId); next.history.push({ type: 'repair-select', repairId });
  return result(true, next, { repair: clone(repair) });
}

export function analysisProgress(session) {
  if (!session || session.version !== 1) return { ok: false, reason: 'invalid-session' };
  const file = CASE_INDEX.get(session.chapterId), total = file.clues.length;
  return { ok: true, chapterId: session.chapterId, tokens: session.tokens, tokenMax: ANALYSIS_TOKEN_MAX, collected: session.collected.length, analyzed: session.analyzed.length, repairs: session.repairs.length, total, readyToReport: session.analyzed.length >= total && session.repairs.length > 0 };
}

export function exportAnalysisSession(session) {
  if (!session || session.version !== 1 || !CASE_INDEX.has(session.chapterId)) return null;
  return clone(session);
}

export function restoreAnalysisSession(snapshot) {
  const created = createAnalysisSession(snapshot ?? {});
  if (!created.ok) return created;
  const history = Array.isArray(snapshot.history) && snapshot.history.length <= 300 ? snapshot.history : [];
  created.session.history = clone(history);
  return created;
}

export function getAnalysisModes() {
  return [{ id: 'summarize', label: '摘要整理', cost: 1 }, { id: 'correlate', label: '交叉比对', cost: 2 }, { id: 'check', label: '完整性检查', cost: 1 }];
}
