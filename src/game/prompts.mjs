/** Finite, offline Chinese prompt compiler. Unknown text is an error, never a guessed action. */
const clone = value => JSON.parse(JSON.stringify(value));
const TEAMMATES = ['Grok', 'Claude', 'GLM'];
const TEAM_CHAPTER = { Grok: 1, Claude: 2, GLM: 3 };
const ALIASES = { Grok: ['grok'], Claude: ['claude'], GLM: ['glm'] };
const ACTIONS = {
  Grok: ['冲锋', '撞开', '破开', '破障', '处理', '冲', '撞'],
  Claude: ['放置诱饵', '投放诱饵', '吸引守卫', '引开守卫', '吸引', '引开', '诱饵', '社工'],
  GLM: ['扫描', '复查', '查'],
};
const SPATIAL = { Grok: 'stop-at-target', Claude: 'single-guard', GLM: 'narrow-scan' };
const CONSTRAINTS = [
  { id: 'stop-at-target', teammate: 'Grok', label: '只处理一处，到点停', cost: 1, unlockedChapter: 1, precise: true,
    phrases: ['只处理这一处', '只处理这个目标', '只处理一个目标', '只撞这一个', '只撞一个', '到标记处停止', '到标记处停', '到标记停', '到目标停', '到点停', '不要过头'] },
  { id: 'single-guard', teammate: 'Claude', label: '只引指定一名', cost: 1, unlockedChapter: 2, precise: true,
    phrases: ['只引指定一名守卫', '只引指定一名', '只吸引一名守卫', '只引一名守卫', '只引一个守卫', '只引一个', '只引一人', '只引一名'] },
  { id: 'narrow-scan', teammate: 'GLM', label: '前方窄区，避开警戒器', cost: 1, unlockedChapter: 3, precise: true,
    phrases: ['只扫描前方窄区', '只扫描前方', '只扫前方窄区', '只扫前方', '只扫窄区', '避开已标出的警戒器区域', '避开警戒器'] },
  { id: 'wait-guard-turn', teammate: '*', label: '等待守卫转身', cost: 1, unlockedChapter: 4, precise: false, conditionType: 'guard-turn', phrases: [] },
  { id: 'wait-lift-ready', teammate: '*', label: '等待升降台到位', cost: 1, unlockedChapter: 4, precise: false, conditionType: 'lift-ready', phrases: [] },
];
const normalize = value => String(value).toLowerCase().replace(/[\s，。！？、：；,.;:!?“”‘’"'（）()【】\[\]]/gu, '');
const failure = (code, message, detail = null) => ({ ok: false, plan: null, error: { code, message, ...(detail === null ? {} : { detail }) }, cost: 0 });
const success = plan => {
  const cost = plan.sequence ? plan.sequence.reduce((sum, entry) => sum + (entry.constraintId ? 1 : 0), 0) : plan.constraintId ? 1 : 0;
  return { ok: true, plan: { ...plan, cost: plan.constraintId ? 1 : 0, ...(plan.sequence ? { totalCost: cost } : {}) }, error: null, cost };
};
const chapterNumber = chapter => chapter && typeof chapter === 'object' ? chapter.number ?? 1 : Number(chapter ?? 1);
const resolveTeammate = value => TEAMMATES.find(name => name.toLowerCase() === String(value).toLowerCase() || ALIASES[name].includes(normalize(value))) ?? null;
const listTargets = targets => Array.isArray(targets) ? targets : targets && typeof targets === 'object' ? Object.values(targets) : [];
const validTargets = targets => listTargets(targets).every(target => target && typeof target === 'object' && !Array.isArray(target)
  && typeof target.id === 'string' && target.id.length > 0
  && ['aliases', 'tags', 'teammates'].every(key => target[key] === undefined || Array.isArray(target[key]) && target[key].every(value => typeof value === 'string')));
const aliasesFor = target => [...new Set([target.id, target.label, target.name, ...(target.aliases ?? [])]
  .filter(value => typeof value === 'string' && value.length > 0)
  .flatMap(value => [value, value.replace(/^(?:撞开|破开|引开|扫描|复查|处理|打开)/u, '')]).map(normalize).filter(value => value.length >= 2))];
const replaceAll = (text, phrase) => text.split(phrase).join('');
const sorted = words => [...words].sort((a, b) => b.length - a.length);
function targetMatches(text, targets) {
  const matches = targets.map(target => ({ target, aliases: aliasesFor(target).filter(alias => text.includes(alias)) })).filter(entry => entry.aliases.length);
  // An object with a longer explicit alias wins over a shorter alias contained within it.
  return matches.filter(entry => !matches.some(other => other !== entry && entry.aliases.every(alias => other.aliases.some(longer => longer !== alias && longer.includes(alias)))));
}
const isMFA = target => /mfa/i.test(`${target.id} ${target.type ?? ''}`) || target.sealed === true || target.tags?.some(tag => /^(mfa|sealed|unbreakable)$/i.test(tag));
function compatible(target, teammate) {
  if (target.teammate) return target.teammate === teammate;
  if (target.teammates) return target.teammates.includes(teammate);
  const descriptor = `${target.type ?? ''} ${target.kind ?? ''} ${target.effect ?? ''} ${(target.tags ?? []).join(' ')}`;
  if (!descriptor.trim()) return true; // Legacy registered command targets may contain only an id and a label.
  return ({ Grok: /break|obstacle|node|barrier|可破坏|节点|障碍/i, Claude: /guard|decoy|patrol|守卫|诱饵/i, GLM: /scan|trap|review|alarm|扫描|陷阱|警戒/i }[teammate]).test(descriptor);
}

export function getConstraints(teammate, unlockedChapter = 5) {
  const member = resolveTeammate(teammate);
  return CONSTRAINTS.filter(entry => member && (entry.teammate === member || entry.teammate === '*') && entry.unlockedChapter <= chapterNumber(unlockedChapter)).map(clone);
}

export function getTemplates(teammate = null, unlockedChapter = 5) {
  if (typeof teammate === 'object' && teammate) { unlockedChapter = teammate.unlockedChapter ?? 5; teammate = teammate.teammate ?? null; }
  const names = teammate ? [resolveTeammate(teammate)].filter(Boolean) : TEAMMATES;
  return names.filter(name => TEAM_CHAPTER[name] <= chapterNumber(unlockedChapter)).flatMap(name => [
    { id: `${name.toLowerCase()}-default`, label: `${name} · 默认范围`, teammate: name, precise: false, constraintId: null, cost: 0,
      text: `${name}，对【目标】${ACTIONS[name][0]}。`, promptText: `${name}，对【目标】${ACTIONS[name][0]}。` },
    { id: `${name.toLowerCase()}-precise`, label: `${name} · ${CONSTRAINTS.find(entry => entry.id === SPATIAL[name]).label}`, teammate: name, precise: true, constraintId: SPATIAL[name], cost: 1,
      text: `${name}，对【目标】${ACTIONS[name][0]}，${CONSTRAINTS.find(entry => entry.id === SPATIAL[name]).phrases[0]}。`,
      promptText: `${name}，对【目标】${ACTIONS[name][0]}，${CONSTRAINTS.find(entry => entry.id === SPATIAL[name]).phrases[0]}。` },
  ]);
}

function validateSingle(plan, context) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return failure('invalid-plan', '指令计划格式不正确。');
  const teammate = resolveTeammate(plan.teammate), chapter = chapterNumber(context.unlockedChapter ?? 1);
  if (!teammate) return failure('unknown-teammate', '请选择 Grok、Claude 或 GLM。');
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 5) return failure('invalid-chapter', '章节解锁信息无效。');
  if (TEAM_CHAPTER[teammate] > chapter) return failure('teammate-locked', '这名队友尚未加入。');
  if (typeof plan.precise !== 'boolean') return failure('invalid-precise', '默认或精确模式必须明确选择。');
  const target = listTargets(context.targets).find(entry => entry.id === plan.targetId);
  if (!target) return failure('unknown-target', '请选择已登记的合法目标。');
  if (isMFA(target)) return failure('sealed-target', 'MFA 封闭区域不可开启，也不能作为技能目标。');
  if (!compatible(target, teammate)) return failure('incompatible-target', '这名队友不能对该目标执行此动作。');
  if (target.available === false || target.valid === false || target.active === false) return failure('unavailable-target', '该目标当前不可用。');
  if (target.reachable === false) return failure('unreachable-target', '当前无法到达目标，不会扣费。');
  const constraint = CONSTRAINTS.find(entry => entry.id === plan.constraintId);
  if (plan.constraintId && !constraint) return failure('unknown-constraint', '无法识别这张约束卡。');
  if (constraint && constraint.teammate !== '*' && constraint.teammate !== teammate) return failure('incompatible-constraint', '这张约束卡不适用于当前队友。');
  if (constraint && constraint.unlockedChapter > chapter) return failure('constraint-locked', '该约束尚未解锁。');
  if (Boolean(plan.precise) !== Boolean(constraint?.precise)) return failure('constraint-mode-conflict', '精确模式与约束卡不一致。');
  let condition = null;
  if (plan.condition) {
    if (!constraint?.conditionType || plan.condition.type !== constraint.conditionType) return failure('condition-conflict', '等待条件与约束卡不一致，每条指令最多一组约束。');
    const conditionTarget = listTargets(context.targets).find(entry => entry.id === plan.condition.targetId);
    if (!conditionTarget) return failure('unknown-condition-target', '等待条件缺少合法对象。');
    const descriptors = `${conditionTarget.type ?? ''} ${conditionTarget.kind ?? ''} ${(conditionTarget.tags ?? []).join(' ')} ${conditionTarget.id}`;
    if (!(plan.condition.type === 'guard-turn' ? /guard|patrol|守卫/i : /lift|elevator|升降/i).test(descriptors)) return failure('invalid-condition-target', '等待对象的类型不匹配。');
    condition = { type: plan.condition.type, targetId: conditionTarget.id };
  } else if (constraint?.conditionType) return failure('missing-condition', '请指定等待哪名守卫或哪座升降台。');
  const qualifiers = context.qualifiers ?? context.budget;
  if (constraint && Number.isFinite(qualifiers) && qualifiers < 1) return failure('insufficient-budget', '限定词不足，可以改用默认范围。');
  return success({ teammate, targetId: target.id, precise: plan.precise, constraintId: constraint?.id ?? null, condition, promptText: String(plan.promptText ?? '') });
}

/** Validation is shared by card and text plans; this function never spends a resource. */
export function validatePlan(plan, context = {}) {
  if (!context || typeof context !== 'object' || !validTargets(context.targets)) return failure('invalid-targets', '目标列表格式不正确，请重新选择。');
  if (plan?.plan && plan.ok === true) plan = plan.plan;
  if (plan?.sequence) {
    if (chapterNumber(context.unlockedChapter ?? 1) < 5) return failure('relay-locked', '双人接力在第五章解锁。');
    if (!Array.isArray(plan.sequence) || plan.sequence.length !== 2 || plan.sequence.some(entry => entry?.sequence)) return failure('invalid-relay', '接力只支持两名队友依次执行一次，不支持循环或并发。');
    const checked = plan.sequence.map(entry => validateSingle(entry, { ...context, qualifiers: undefined, budget: undefined }));
    const invalid = checked.find(entry => !entry.ok); if (invalid) return invalid;
    if (checked[0].plan.teammate === checked[1].plan.teammate) return failure('relay-needs-two-teammates', '接力必须由两名不同队友按顺序完成。');
    const cost = checked.reduce((sum, entry) => sum + entry.cost, 0), budget = context.qualifiers ?? context.budget;
    if (Number.isFinite(budget) && budget < cost) return failure('insufficient-budget', '接力所需限定词不足，不会执行或扣费。');
    const sequence = checked.map(entry => entry.plan);
    return success({ ...sequence[0], promptText: String(plan.promptText ?? sequence.map(entry => entry.promptText).join('，然后')), sequence });
  }
  return validateSingle(plan, context);
}

function compileSingle(input) {
  const targets = listTargets(input.targets), chapter = chapterNumber(input.unlockedChapter ?? 1);
  if (input.teammate !== undefined && input.teammate !== null && !resolveTeammate(input.teammate)) return failure('unknown-teammate', '无法识别所选队友。');
  if (input.precise !== undefined && typeof input.precise !== 'boolean') return failure('invalid-precise', '默认或精确模式必须是明确选项。');
  if (input.targetId !== undefined && (typeof input.targetId !== 'string' || !input.targetId.length)) return failure('unknown-target', '目标卡格式不正确。');
  if (input.constraintId !== undefined && input.constraintId !== null && typeof input.constraintId !== 'string') return failure('unknown-constraint', '约束卡格式不正确。');
  if (input.text !== undefined && typeof input.text !== 'string') return failure('invalid-text', '提示词必须是一句短中文。');
  if (input.text?.length > 240) return failure('text-too-long', '每步提示词最多 240 字，请改用有限卡片。');
  let remaining = normalize(input.text ?? ''), teammate = input.teammate ? resolveTeammate(input.teammate) : null;
  const named = TEAMMATES.filter(name => ALIASES[name].some(alias => remaining.includes(alias)));
  if (named.length > 1 || (teammate && named.length && named[0] !== teammate)) return failure('teammate-conflict', '一句指令只能指定一名队友；接力请使用“然后”。');
  teammate ??= named[0] ?? null;
  if (!teammate) return failure('unknown-teammate', '请选择或写明一名已解锁队友。');
  for (const alias of ALIASES[teammate]) remaining = replaceAll(remaining, alias);
  let condition = input.condition ?? null;
  if (typeof condition === 'string') return failure('invalid-condition', '等待条件必须指定类型与对象。');
  const wait = remaining.match(/(?:等待|等)(.+?)(转身后|转身再|到位后|到位再)/u);
  let inferredCondition = null;
  if (wait) {
    const matches = targetMatches(wait[1], targets);
    if (matches.length !== 1) return failure('unknown-condition-target', '请明确指定等待哪名守卫或哪座升降台。');
    let unknown = wait[1]; for (const alias of sorted(matches[0].aliases)) unknown = replaceAll(unknown, alias);
    if (unknown) return failure('unknown-text', '等待条件含有无法识别的文字。', unknown);
    inferredCondition = { type: wait[2].startsWith('转身') ? 'guard-turn' : 'lift-ready', targetId: matches[0].target.id };
    if (condition && (condition.type !== inferredCondition.type || condition.targetId !== inferredCondition.targetId)) return failure('condition-conflict', '文字与等待条件卡相互矛盾。');
    condition ??= inferredCondition; remaining = replaceAll(remaining, wait[0]);
  }
  const foundConstraints = CONSTRAINTS.filter(entry => entry.phrases.some(phrase => remaining.includes(phrase)));
  const spatialIds = [...new Set(foundConstraints.map(entry => entry.id))];
  if (spatialIds.length > 1) return failure('multiple-constraints', '每条指令最多装一组约束，请移除冲突卡片。');
  const defaultConflict = teammate === 'Grok' ? /全部|所有|一直冲|冲到底|不要停/u : teammate === 'Claude' ? /全部|所有|所有人|附近多人/u : /全图|全场|广域|大范围|全部/u;
  if ((spatialIds.length || input.precise === true || (input.constraintId && !input.constraintId.startsWith('wait-'))) && defaultConflict.test(remaining)) return failure('contradictory-text', '默认范围与精确限定相互矛盾，请选择一种。');
  if (condition && (spatialIds.length || input.precise === true || (input.constraintId && !input.constraintId.startsWith('wait-')))) return failure('multiple-constraints', '等待条件与范围限定是两组约束，当前只允许选择一组。');
  const inferredId = condition ? condition.type === 'guard-turn' ? 'wait-guard-turn' : condition.type === 'lift-ready' ? 'wait-lift-ready' : null : spatialIds[0] ?? null;
  if (condition && !inferredId) return failure('unknown-condition', '只支持等待守卫转身或升降台到位。');
  if (input.constraintId && inferredId && input.constraintId !== inferredId) return failure('constraint-conflict', '文字与约束卡相互矛盾。');
  const constraintId = input.constraintId || inferredId || (input.precise === true ? SPATIAL[teammate] : null);
  for (const entry of foundConstraints) for (const phrase of sorted(entry.phrases)) remaining = replaceAll(remaining, phrase);
  const matches = targetMatches(remaining, targets), explicitTarget = input.targetId ? targets.find(target => target.id === input.targetId) : null;
  if (input.targetId && !explicitTarget) return failure('unknown-target', '卡片指定的目标不存在。');
  if (matches.length > 1) return failure('ambiguous-target', '一句指令只能指定一个目标，请在列表中明确选择。');
  if (matches.length && explicitTarget && matches[0].target.id !== explicitTarget.id) return failure('target-conflict', '文字目标与所选目标卡不一致。');
  const target = explicitTarget ?? matches[0]?.target;
  if (!target) return failure('unknown-target', '未识别到合法目标，请从目标列表选择。');
  const original = normalize(input.text ?? '');
  const hasAction = ACTIONS[teammate].some(action => original.includes(action));
  if (original && !hasAction) return failure('missing-action', '请写明这名队友能执行的动作。');
  for (const alias of sorted(aliasesFor(target))) remaining = replaceAll(remaining, alias);
  const phrases = [...ACTIONS[teammate], '免费默认', '默认方案', '默认', '沿当前通道', '沿通道', '附近同层的多名守卫', '附近同层守卫', '附近守卫', '附近多人', '所有守卫', '全部守卫', '大范围', '广域', '全图', '全部', '所有', '一直冲', '冲到底', '不要停', '请', '让', '对', '向', '把', '执行', '进行'];
  for (const phrase of sorted(phrases)) remaining = replaceAll(remaining, phrase);
  if (remaining) return failure('unknown-text', '存在无法识别的文字；请改用列出的动作、对象或约束卡。', remaining);
  const precise = Boolean(CONSTRAINTS.find(entry => entry.id === constraintId)?.precise);
  const promptText = input.text?.trim() || `${teammate}，对${target.label ?? target.name ?? target.id}${ACTIONS[teammate][0]}${constraintId ? `，${CONSTRAINTS.find(entry => entry.id === constraintId)?.label ?? constraintId}` : ''}。`;
  return validateSingle({ teammate, targetId: target.id, precise, constraintId, condition, promptText }, { ...input, targets, unlockedChapter: chapter });
}

/** Cards may omit text. A relay uses sequence:[{...singleInput},{...singleInput}] or “Grok…，然后 Claude…”. */
export function compilePrompt(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return failure('invalid-input', '指令输入格式不正确。');
  if (!validTargets(input.targets)) return failure('invalid-targets', '目标列表格式不正确，请重新选择。');
  let sequence = input.sequence;
  if (!sequence && typeof input.text === 'string' && /然后|接着|再让|再由/u.test(input.text)) {
    const parts = input.text.split(/然后|接着|再让|再由/u).map(text => text.trim()).filter(Boolean);
    if (parts.length !== 2) return failure('invalid-relay', '接力只支持两个依次执行的步骤。');
    sequence = parts.map(text => ({ text }));
  }
  if (sequence) {
    if (!Array.isArray(sequence) || sequence.length !== 2 || sequence.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry) || entry.sequence)) return failure('invalid-relay', '接力需要两个且仅两个步骤，不支持嵌套。');
    if (chapterNumber(input.unlockedChapter ?? 1) < 5) return failure('relay-locked', '双人接力在第五章解锁。');
    const { sequence: ignoredSequence, text: ignoredText, teammate: ignoredMember, targetId: ignoredTarget, constraintId: ignoredConstraint, precise: ignoredPrecise, condition: ignoredCondition, ...shared } = input;
    const results = sequence.map(entry => compileSingle({ ...shared, ...entry, qualifiers: undefined, budget: undefined }));
    const invalid = results.find(entry => !entry.ok); if (invalid) return invalid;
    return validatePlan({ ...results[0].plan, sequence: results.map(entry => entry.plan), promptText: input.text ?? results.map(entry => entry.plan.promptText).join('，然后') }, input);
  }
  return compileSingle(input);
}
