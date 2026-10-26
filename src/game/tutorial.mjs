/** Event-verified tutorials. Key presses, previews and elapsed time never complete a lesson. */
const clone = value => JSON.parse(JSON.stringify(value));
const lesson = (id, text, events, hints) => ({ id, text, events, hints });
const chapterId = chapter => ({ 1: 'paper-window', 2: 'resume-storm', 3: 'review-quietly', 4: 'public-report', 5: 'close-hatch' }[chapter] ?? chapter);
export const TUTORIALS = {
  'paper-window': [
    lesson('move', '沿亮起的短路径走到标记处。', ['move', 'move-complete', 'tutorial-move'], ['先走到地面的亮点。', '使用移动键或左侧方向按钮，直到脚下标记亮起。', '路线示范：从码头起点沿地面走到第一处标记。']),
    lesson('climb', '爬上短梯，到达上方平台。', ['climb', 'climb-complete', 'tutorial-climb'], ['目标在梯子顶端的平台。', '靠近梯子后按上；到达平台才算完成。', '路线示范：站在梯子中线，向上爬到平台，松开方向。']),
    lesson('jump', '跳过安全缺口，并在对面落地。', ['jump', 'jump-landed', 'tutorial-jump'], ['先看清对面的落脚点。', '向缺口方向移动，同时按跳跃。', '路线示范：在平台边缘起跳，越过短缺口后落地。']),
    lesson('node-first', '对蓝色节点完成第一次独立冲刺，让它出现裂纹。', ['node-first', 'node-hit'], ['目标是无守卫的蓝色节点。', '面向节点冲刺，看到裂纹后等待冲刺恢复。', '路线示范：与节点保持同层，面向它冲刺一次。']),
    lesson('node-open', '等冲刺恢复，再次冲刺打开同一个节点。', ['node-open', 'node-opened'], ['刚才的裂纹节点还需要一次冲刺。', '松开冲刺，等冷却结束，再发起第二次独立冲刺。', '路线示范：退开少许，冲刺恢复后再撞一次，靠近拾取。']),
    lesson('grok-obstacle', '选择 Grok，确认指令，等待纸窗实际破开。', ['grok-obstacle', 'obstacle-broken', 'command-complete'], ['主角撞不开这道纸窗。', '选 Grok 和纸窗目标，检查预览，再确认执行。', '路线示范：打开指令面板，选纸窗，使用默认指令（不耗限定词，消耗 AI Token），等破障回执。']),
    lesson('delivery', '把资料带回鲸艇，按住互动直到交付完成。', ['delivery', 'delivery-complete'], ['三格背包装着需要带回的资料。', '回艇后按住互动，等待交付进度完成。', '路线示范：沿已开启的返程路线回码头，在交付点持续互动。']),
    lesson('board', '交货后先松开，再次按住互动登艇。', ['board', 'board-complete', 'chapter-result'], ['交货与登艇是两次独立互动。', '先松开互动键，看到登艇提示后再次按住。', '路线示范：确认任务完成，松开互动，再按住直到登艇进度结束。']),
  ],
  'resume-storm': [
    lesson('claude-decoy', '在安全演练区，让 Claude 的默认诱饵实际引开守卫。', ['decoy-effective', 'claude-decoy', 'command-complete'], ['默认诱饵把同层多名守卫引到远端纸页，抵达后分心 6 秒。', '选择 Claude 和诱饵标记，查看范围后执行；默认方案不耗限定词，但消耗 AI Token。', '路线示范：在安全观察台发令；纸页标记亮着时，通过原通道不会被吸引中的守卫碰伤。']),
    lesson('claude-constraint', '使用一枚训练限定词，比较只引一人的效果。', ['constraint-effective', 'claude-constraint', 'command-complete'], ['训练限定词与正式资源分开标记。', '为 Claude 装上“只引一人”，确认后观察另一名守卫。', '路线示范：选单名守卫卡，使用训练预算，等只影响一人的回执。']),
  ],
  'review-quietly': [
    lesson('glm-scan', '让 GLM 完成扫描，查看显出的陷阱与范围。', ['scan-complete', 'glm-scan', 'command-complete'], ['GLM 扫描揭示陷阱；触碰警戒器后会出现敌方红色扫描区。', '选 GLM 和校验桥，比较不耗限定词的广域与限定窄区；两者都消耗 AI Token。', '路线示范：若出现调查扫描，在 1.8 秒内向两侧离开固定红区，或全身藏到平台下的蓝区。']),
  ],
  'public-report': [],
  'close-hatch': [],
};
for (const steps of Object.values(TUTORIALS)) for (const entry of steps) { Object.freeze(entry.events); Object.freeze(entry.hints); Object.freeze(entry); }
Object.values(TUTORIALS).forEach(Object.freeze); Object.freeze(TUTORIALS);

function accepted(id, type, payload, memory) {
  if (payload.ok === false || payload.success === false || payload.preview === true || payload.status === 'prepared') return false;
  const explicit = type === id || type === `tutorial-${id}`;
  if (id === 'move') return payload.reached === true || payload.arrived === true || (explicit && payload.complete === true);
  if (id === 'climb') return (payload.reached === true || payload.complete === true) && (payload.grounded === true || payload.onPlatform === true);
  if (id === 'jump') return payload.grounded === true && (payload.crossedGap === true || payload.reached === true || payload.complete === true);
  if (id === 'node-first') return payload.hp === 1 && Boolean(payload.nodeId) && Boolean(payload.attackId) && (payload.actor ?? 'DeepSeek') === 'DeepSeek';
  if (id === 'node-open') return payload.hp === 0 && Boolean(payload.nodeId) && payload.nodeId === memory.nodeId
    && Boolean(payload.attackId) && payload.attackId !== memory.attackId && (payload.actor ?? 'DeepSeek') === 'DeepSeek';
  if (id === 'grok-obstacle') return payload.teammate === 'Grok' && (payload.broken === true || (payload.effect === 'break-obstacle' && payload.status === 'completed'));
  if (id === 'delivery') return (payload.complete === true || payload.status === 'completed' || type === 'delivery-complete') && (payload.count > 0 || payload.itemIds?.length > 0);
  if (id === 'board') return payload.complete === true || payload.status === 'completed' || type === 'chapter-result';
  if (id === 'claude-decoy') return payload.teammate === 'Claude' && !payload.precise && (payload.affectedGuardIds?.length > 0 || payload.affectedCount > 0) && (payload.complete === true || payload.status === 'completed');
  if (id === 'claude-constraint') return payload.teammate === 'Claude' && payload.precise === true && (payload.training === true || payload.budgetSource === 'training')
    && (payload.affectedGuardIds?.length === 1 || payload.affectedCount === 1) && (payload.complete === true || payload.status === 'completed');
  if (id === 'glm-scan') return payload.teammate === 'GLM' && (payload.complete === true || payload.status === 'completed') && (payload.revealedIds?.length > 0 || payload.revealedCount > 0);
  return false;
}

export class TutorialDirector {
  constructor(options = {}) {
    if (typeof options === 'string' || typeof options === 'number') options = { chapter: options };
    this.chapter = chapterId(options.chapter ?? options.chapterId ?? 1);
    this.enabled = options.enabled !== false;
    this.completed = []; this.memory = {}; this.seenEventIds = []; this.verifiedEvents = {};
    // The first chapter presents the command sequence as four concrete actions
    // while keeping the older obstacle lesson as one verified world outcome.
    // This lets old saves restore safely and still prevents the confirm button
    // from skipping the actual teammate/target/plan steps in a live run.
    this.guidedCommandStage = 0; this.objectiveGuide = null;
    this.skipped = false; this.idleSeconds = 0; this.failures = 0; this.hintLevel = 0;
    if (options.state) this.restore(options.state);
  }
  get steps() { return TUTORIALS[this.chapter] ?? []; }
  current() { return this.enabled && !this.skipped ? this.steps.find(entry => !this.completed.includes(entry.id)) ?? null : null; }
  guideView() {
    if (this.chapter !== 'paper-window' || this.skipped || !this.current()) return null;
    const current = this.current();
    if (['delivery', 'board'].includes(current.id) && this.objectiveGuide) return clone(this.objectiveGuide);
    const views = {
      move: { index: 0, text: '走到地面蓝色标记处。' },
      climb: { index: 1, text: '爬上短梯，到达上方平台。' },
      jump: { index: 2, text: '跳过安全缺口，在对面落地。' },
      'node-first': { index: 3, text: '对蓝色节点冲刺两次（1/2）。' },
      'node-open': { index: 3, text: '对同一个蓝色节点再次冲刺（2/2）。' },
      delivery: { index: 8, text: '带着资料回到鲸艇，完成交付。' },
      board: { index: 9, text: '松开互动，再次按住互动登艇。' },
    };
    if (current.id === 'grok-obstacle') {
      const command = [
        '选择 Grok 作为执行队友。',
        '选择“撞开纸窗”作为目标。',
        '点击“默认方案”（不耗限定词）。',
        '确认执行，等待 Grok 实际破障。',
      ];
      return { index: 4 + Math.min(3, this.guidedCommandStage), total: 10,
        text: command[Math.min(3, this.guidedCommandStage)], commandStage: this.guidedCommandStage };
    }
    return { ...(views[current.id] || { index: this.completed.length, text: current.text }), total: 10 };
  }
  /** Live guidance follows world objectives; it is rebuilt from the world after restoring a save. */
  setObjectiveGuide(guide = null) {
    const next = guide && ['delivery', 'board'].includes(this.current()?.id) ? clone(guide) : null;
    if (next?.objectiveKey !== this.objectiveGuide?.objectiveKey) {
      this.idleSeconds = 0; this.failures = 0; this.hintLevel = 0;
    }
    this.objectiveGuide = next;
  }
  /** Record one real command-panel action for the first-minute tutorial. */
  guidedInput(type, payload = {}, { commit = true } = {}) {
    if (!this.enabled || this.chapter !== 'paper-window' || this.current()?.id !== 'grok-obstacle') {
      return { ok: false, reason: 'guided-command-inactive', state: this.getState() };
    }
    const expected = [
      ['select-teammate', value => value.teammate === 'Grok'],
      ['select-target', value => value.teammate === 'Grok' && value.targetId === 'paper-window'],
      ['default-plan', value => value.precise === false],
      ['confirm-command', value => value.teammate === 'Grok' && value.targetId === 'paper-window' && value.precise === false],
    ][this.guidedCommandStage];
    if (!expected) return { ok: false, reason: 'guided-command-complete', state: this.getState() };
    const [name, check] = expected;
    if (type !== name || !check(payload)) return { ok: false, reason: `guided-step-${name}`, state: this.getState() };
    if (commit) {
      this.guidedCommandStage++;
      this.idleSeconds = 0; this.failures = 0; this.hintLevel = 0;
    }
    return { ok: true, guidedStep: this.guidedCommandStage + (commit ? 0 : 1), state: this.getState() };
  }
  getState() {
    const current = this.current();
    return { chapter: this.chapter, enabled: this.enabled, skipped: this.skipped, done: !current, step: current ? clone(current) : null,
      completed: [...this.completed], hintLevel: this.hintLevel, hint: current && this.hintLevel ? this.#hintText(this.hintLevel) : null,
      canShowRoute: Boolean(current && this.hintLevel >= 3), idleSeconds: this.idleSeconds, failures: this.failures,
      guide: this.guideView(), guidedCommandStage: this.guidedCommandStage };
  }
  handleEvent(type, payload = {}) {
    if (type && typeof type === 'object') { payload = { ...type, ...type.payload }; type = type.type; }
    const current = this.current();
    if (!current) return { ok: false, reason: 'tutorial-inactive', state: this.getState() };
    const eventId = payload.eventId ?? payload.id;
    if (eventId && this.seenEventIds.includes(String(eventId))) return { ok: false, reason: 'duplicate-event', state: this.getState() };
    const verified = this.steps.find(entry => !this.completed.includes(entry.id) && !this.verifiedEvents[entry.id]
      && entry.events.includes(type) && accepted(entry.id, type, payload, this.memory));
    if (!verified) return { ok: false, reason: 'event-not-completed', state: this.getState() };
    if (eventId) this.seenEventIds.push(String(eventId));
    if (verified.id === 'node-first') this.memory = { ...this.memory, nodeId: payload.nodeId, attackId: payload.attackId };
    if (verified.id === 'grok-obstacle') this.guidedCommandStage = 4;
    this.verifiedEvents[verified.id] = { type, payload: clone(payload) };
    const advancedSteps = [];
    // Future actions are remembered, while the displayed lesson remains a single ordered step.
    for (const entry of this.steps) {
      if (this.completed.includes(entry.id)) continue;
      if (!this.verifiedEvents[entry.id]) break;
      this.completed.push(entry.id); advancedSteps.push(entry.id);
    }
    if (advancedSteps.length) { this.idleSeconds = 0; this.failures = 0; this.hintLevel = 0; }
    return { ok: true, completedStep: advancedSteps[0] ?? null, verifiedStep: verified.id, advancedSteps, state: this.getState() };
  }
  /** seconds; pass active:false while reading, paused, unfocused or in story. Only actual failures reveal an automatic route. */
  tick(seconds, { active = true, progress = false, failed = false, reading = false, paused = false, focused = true } = {}) {
    if (!Number.isFinite(seconds) || seconds < 0) return this.getState();
    if (!this.current() || !active || reading || paused || !focused) return this.getState();
    if (progress) { this.idleSeconds = 0; this.failures = 0; this.hintLevel = 0; }
    else this.idleSeconds += seconds;
    if (failed) this.failures++;
    const automaticLevel = this.failures >= 2 ? 3 : this.idleSeconds >= 25 ? 2 : this.idleSeconds >= 12 || this.failures > 0 ? 1 : 0;
    this.hintLevel = Math.max(this.hintLevel, automaticLevel);
    return this.getState();
  }
  #hintText(level) {
    const current = this.current();
    if (!current) return null;
    const hints = this.objectiveGuide && ['delivery', 'board'].includes(current.id) ? this.objectiveGuide.hints : current.hints;
    if (level < 3) return hints[level - 1];
    return [this.guideView()?.text ?? current.text, ...hints].join(' ');
  }
  hint(level = 3) {
    if (!this.current() || !Number.isInteger(level) || level < 1 || level > 3) return null;
    this.hintLevel = level;
    return { level, text: this.#hintText(level), route: level === 3 };
  }
  skip() { this.skipped = true; return this.getState(); }
  restart(chapter = this.chapter) { this.chapter = chapterId(chapter); this.completed = []; this.memory = {}; this.seenEventIds = []; this.verifiedEvents = {}; this.guidedCommandStage = 0; this.objectiveGuide = null; this.skipped = false; this.idleSeconds = 0; this.failures = 0; this.hintLevel = 0; return this.getState(); }
  serialize() { return clone({ version: 1, chapter: this.chapter, enabled: this.enabled, completed: this.completed, memory: this.memory,
    seenEventIds: this.seenEventIds, verifiedEvents: this.verifiedEvents, guidedCommandStage: this.guidedCommandStage,
    skipped: this.skipped, idleSeconds: this.idleSeconds, failures: this.failures, hintLevel: this.hintLevel }); }
  restore(snapshot) {
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.completed) || !Array.isArray(snapshot.seenEventIds)
      || !Array.isArray(TUTORIALS[snapshot.chapter] ?? null) || !Number.isFinite(snapshot.idleSeconds) || snapshot.idleSeconds < 0
      || !Number.isInteger(snapshot.failures) || snapshot.failures < 0 || !Number.isInteger(snapshot.hintLevel) || snapshot.hintLevel < 0 || snapshot.hintLevel > 3
      || typeof snapshot.enabled !== 'boolean' || typeof snapshot.skipped !== 'boolean'
      || (snapshot.guidedCommandStage !== undefined && (!Number.isInteger(snapshot.guidedCommandStage) || snapshot.guidedCommandStage < 0 || snapshot.guidedCommandStage > 4))) return { ok: false, reason: 'invalid-tutorial-state' };
    const validSteps = TUTORIALS[snapshot.chapter].map(entry => entry.id);
    // Completed lessons must be an ordered prefix; a save cannot skip unfinished actions.
    if (snapshot.completed.some((id, i) => id !== validSteps[i]) || snapshot.completed.length > validSteps.length
      || snapshot.seenEventIds.some(id => typeof id !== 'string') || new Set(snapshot.seenEventIds).size !== snapshot.seenEventIds.length) return { ok: false, reason: 'invalid-tutorial-state' };
    if (snapshot.completed.includes('node-first') && (!snapshot.memory?.nodeId || !snapshot.memory?.attackId)) return { ok: false, reason: 'invalid-tutorial-node-state' };
    if (snapshot.verifiedEvents !== undefined) {
      if (!snapshot.verifiedEvents || typeof snapshot.verifiedEvents !== 'object' || Array.isArray(snapshot.verifiedEvents)
        || snapshot.completed.some(id => !Object.hasOwn(snapshot.verifiedEvents, id))) return { ok: false, reason: 'invalid-tutorial-evidence' };
      for (const [id, event] of Object.entries(snapshot.verifiedEvents)) {
        const entry = TUTORIALS[snapshot.chapter].find(lesson => lesson.id === id);
        if (!entry || !event || !event.payload || !entry.events.includes(event.type) || !accepted(id, event.type, event.payload, snapshot.memory ?? {})) return { ok: false, reason: 'invalid-tutorial-evidence' };
      }
    }
    const safe = clone(snapshot);
    this.chapter = safe.chapter; this.enabled = safe.enabled; this.completed = safe.completed; this.memory = safe.memory ?? {};
    this.seenEventIds = safe.seenEventIds; this.verifiedEvents = safe.verifiedEvents ?? {};
    this.guidedCommandStage = safe.guidedCommandStage ?? (safe.completed.includes('grok-obstacle') ? 4 : 0);
    this.objectiveGuide = null;
    this.skipped = safe.skipped; this.idleSeconds = safe.idleSeconds; this.failures = safe.failures; this.hintLevel = safe.hintLevel;
    return { ok: true, state: this.getState() };
  }
  static restore(snapshot) { const director = new TutorialDirector({ chapter: snapshot?.chapter ?? 1 }); const result = director.restore(snapshot); if (!result.ok) throw new TypeError(result.reason); return director; }
}
