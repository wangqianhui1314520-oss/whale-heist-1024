import { CHAPTERS, RULES, getChapter, chapterGrade, campaignGrade } from './chapters.mjs';
import { newCheckpoint, normalizeCheckpoint, loadCheckpoint, saveCheckpoint } from './storage.mjs';
import {
  ANALYSIS_TOKEN_START,
  createAnalysisSession,
  getVulnerabilityCase,
  collectEvidence,
  analyzeEvidence,
  repairSuggestions,
  selectRepair,
  analysisProgress,
  restoreAnalysisSession,
} from '../game/safe-vuln.mjs';

const copy = (value) => JSON.parse(JSON.stringify(value));
const success = (extra = {}) => ({ ok: true, ...extra });
const failure = (reason) => ({ ok: false, reason });
const validId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 160;
const exposureOf = (attempt) => Math.min(20,
  2 * (attempt.publicCommandIds.length + attempt.publicDeliveryIds.length + attempt.alarmIds.length));
const committedExposure = (checkpoint) => Math.min(100,
  checkpoint.campaign.results.reduce((sum, result) => sum + result.exposureDelta, 0));

// Stable finale status text for HUD/story feedback. It is derived from the
// authoritative attempt so countdown copy cannot drift from the actual gates.
const evacuationNotice = (attempt, chapter) => {
  if (!attempt || chapter?.number !== 5) return null;
  const seconds = Math.max(0, Math.ceil(attempt.evacuationRemainingMs / 1000));
  if (attempt.evacuationStarted) {
    return seconds <= 10 ? `撤离危急：剩余 ${seconds} 秒，立即回艇。` : `撤离进行中：剩余 ${seconds} 秒。`;
  }
  if (attempt.remoteReady) return '装载完成，确认开始 60 秒撤离。';
  if (attempt.rendezvousCrew.length === 3) return '三名队友已到齐，装载资料并准备撤离。';
  return `等待三名队友到信标（${attempt.rendezvousCrew.length}/3）。`;
};

const targetGroupComplete = (chapter, attempt, group) =>
  group.some(id => attempt.completedTargetIds.includes(id));

function makeAttempt(checkpoint, chapter, generation) {
  const vulnerability = createAnalysisSession({ chapterId: chapter.id, tokens: ANALYSIS_TOKEN_START });
  return {
    chapterId: chapter.id, attemptId: `attempt-${generation}`, health: RULES.maxHealth, qualifiers: chapter.qualifiers,
    aiTokens: RULES.aiTokenCapacity, aiTokenMax: RULES.aiTokenCapacity,
    // This is an offline, fictional evidence chain. It never represents a
    // real host, credential, address, command or exploit payload.
    vulnerabilitySession: vulnerability.ok ? vulnerability.session : null,
    elapsedMs: 0, lastDamageAtMs: -Infinity,
    alert: Math.min(100, chapter.baseAlert + Math.min(10, Math.floor(committedExposure(checkpoint) / 10))),
    broadcastOn: checkpoint.campaign.broadcastOn,
    storyFlags: [...checkpoint.campaign.storyFlags],
    inventory: [], deliveredIds: [], collectedSupplyIds: [], collectedTokenCacheIds: [],
    completedTargetIds: [], collaborationIds: [],
    commandIds: [], commands: {}, readyAtMs: { Grok: 0, Claude: 0, GLM: 0 },
    deliveryIds: [], publicCommandIds: [], publicDeliveryIds: [],
    alarmIds: [], lastAlarmAtBySource: {},
    returnBeaconReady: false, rendezvousCrew: [], remoteReady: false,
    evacuationStarted: false, evacuationRemainingMs: RULES.finalEvacuationMs,
    evacuationStage: 'preparing', evacuationAssist: 'pending',
  };
}

/**
 * A deterministic campaign model, not an action engine.
 * The world must validate distances, collision, command effects and interaction durations
 * before reporting successful actions to this API. No wall-clock timers are installed.
 */
export class GameCore {
  #checkpoint;
  #attempt;
  #phase;
  #pending = null;
  #storage;
  #storageStatus;
  #loadNotice = null;
  #failures = [];
  #generation = 1;
  #worldTargets = [];

  constructor({ checkpoint = null, storage = null, persist = true } = {}) {
    const safe = checkpoint === null ? newCheckpoint() : normalizeCheckpoint(checkpoint);
    if (!safe) throw new TypeError('Invalid or unsupported campaign checkpoint');
    this.#checkpoint = safe;
    this.#storage = storage;
    this.#storageStatus = { ok: false, reason: 'not-saved' };
    this.#phase = safe.campaign.completed ? 'campaign-complete' : 'playing';
    this.#attempt = safe.campaign.completed ? null : makeAttempt(safe, CHAPTERS[safe.campaign.results.length], this.#generation);
    if (persist) this.#persist();
  }

  static resume({ storage = null } = {}) {
    const loaded = loadCheckpoint(storage);
    const core = new GameCore({ checkpoint: loaded.checkpoint, storage, persist: false });
    core.#loadNotice = loaded.ok ? null : loaded.reason;
    core.#storageStatus = loaded.ok ? { ok: true, reason: null } : { ok: false, reason: loaded.reason };
    // Malformed or newer saves are left untouched until the user starts/commits a new run.
    return core;
  }

  #persist() { this.#storageStatus = saveCheckpoint(this.#storage, this.#checkpoint); }
  #playing() { return this.#phase === 'playing' && this.#attempt !== null; }
  #chapter() { return getChapter(this.#attempt?.chapterId); }
  #addAlert(amount) { this.#attempt.alert = Math.min(100, this.#attempt.alert + amount); }

  checkpoint() { return copy(this.#checkpoint); }

  registerWorldTargets(targets = []) {
    if (!Array.isArray(targets) || targets.length > 500) return failure('invalid-world-targets');
    const fixed = new Set(this.#chapter()?.commandTargets.map(t => t.id) || []);
    for (const target of targets) {
      if (!target || !validId(target.id) || !RULES.teammates.includes(target.teammate)
        || !['break-obstacle', 'change-patrol', 'review-traps'].includes(target.effect)) continue;
      if (fixed.has(target.id) || this.#worldTargets.some(t => t.id === target.id)) continue;
      this.#worldTargets.push({ id: target.id, teammate: target.teammate, effect: target.effect, collaboration: false });
    }
    return success();
  }

  #targets() { return [...(this.#chapter()?.commandTargets || []), ...this.#worldTargets]; }

  configureAttempt({ qualifiers, alert } = {}) {
    if (!this.#playing() || this.#attempt.elapsedMs > 0) return failure('attempt-already-started');
    if (Number.isInteger(qualifiers)) this.#attempt.qualifiers = Math.max(0, Math.min(RULES.qualifierCapacity, qualifiers));
    if (Number.isFinite(alert)) this.#attempt.alert = Math.max(0, Math.min(100, alert));
    return success();
  }

  exportRuntime() {
    return copy({ version: 2, checkpoint: this.#checkpoint, attempt: this.#attempt,
      phase: this.#phase, pending: this.#pending, failures: this.#failures, worldTargets: this.#worldTargets });
  }

  restoreRuntime(snapshot, { reason = null } = {}) {
    if (!snapshot || snapshot.version !== 2 || !normalizeCheckpoint(snapshot.checkpoint)
      || !['playing', 'paused'].includes(snapshot.phase)) return failure('invalid-runtime');
    const checkpoint = normalizeCheckpoint(snapshot.checkpoint), chapter = CHAPTERS[checkpoint.campaign.results.length];
    const a = snapshot.attempt;
    if (!chapter || !a || a.chapterId !== chapter.id || !Number.isFinite(a.elapsedMs) || a.elapsedMs < 0
      || a.elapsedMs > 86400000 || !Number.isFinite(a.health) || a.health <= 0 || a.health > RULES.maxHealth
      || !Number.isInteger(a.qualifiers) || a.qualifiers < 0 || a.qualifiers > RULES.qualifierCapacity
      || !Number.isInteger(a.aiTokens) || a.aiTokens < 0 || a.aiTokens > RULES.aiTokenCapacity
      || typeof a.broadcastOn !== 'boolean' || !Number.isFinite(a.alert) || a.alert < 0 || a.alert > 100) return failure('invalid-runtime-attempt');
    let analysisSession = null;
    if (a.vulnerabilitySession !== undefined) {
      const restoredAnalysis = restoreAnalysisSession(a.vulnerabilitySession);
      if (!restoredAnalysis.ok || restoredAnalysis.session.chapterId !== chapter.id) return failure('invalid-runtime-analysis');
      analysisSession = restoredAnalysis.session;
    }
    const idLists = ['inventory','deliveredIds','collectedSupplyIds','collectedTokenCacheIds','completedTargetIds','collaborationIds','commandIds',
      'deliveryIds','publicCommandIds','publicDeliveryIds','alarmIds','rendezvousCrew','storyFlags'];
    if (idLists.some(k => !Array.isArray(a[k]) || a[k].length > 3000 || a[k].some(id => !validId(id))
      || new Set(a[k]).size !== a[k].length) || a.inventory.length > RULES.backpackCapacity) return failure('invalid-runtime-lists');
    const itemIds = new Set([...chapter.requiredItems,...chapter.optionalItems].map(i=>i.id));
    if ([...a.inventory,...a.deliveredIds].some(id=>!itemIds.has(id)) || a.inventory.some(id=>a.deliveredIds.includes(id))) return failure('invalid-runtime-items');
    const supplyIds = new Set(chapter.supplies.map(i=>i.id));
    if (a.collectedSupplyIds.some(id=>!supplyIds.has(id)) || a.rendezvousCrew.some(n=>!chapter.teammates.includes(n))) return failure('invalid-runtime-progress');
    if (!a.readyAtMs || RULES.teammates.some(n=>!Number.isFinite(a.readyAtMs[n]) || a.readyAtMs[n]<0)
      || !a.aiTokenMax || a.aiTokenMax !== RULES.aiTokenCapacity
      || !a.commands || typeof a.commands !== 'object' || Array.isArray(a.commands)) return failure('invalid-runtime-commands');
    const extra = Array.isArray(snapshot.worldTargets) ? snapshot.worldTargets : [];
    if (extra.length > 500) return failure('invalid-world-targets');
    const targets = [...chapter.commandTargets, ...extra.filter(t=>t&&validId(t.id)&&RULES.teammates.includes(t.teammate)
      &&['break-obstacle','change-patrol','review-traps'].includes(t.effect))];
    if (a.completedTargetIds.some(id=>!targets.some(t=>t.id===id))
      || a.collaborationIds.some(id=>!chapter.commandTargets.some(t=>t.id===id&&t.collaboration))) return failure('invalid-runtime-targets');
    for (const [name,c] of Object.entries(a.commands)) if (!chapter.teammates.includes(name) || !c || !validId(c.commandId)
      || !a.commandIds.includes(c.commandId) || !targets.some(t=>t.id===c.targetId&&t.teammate===name)
      || !['prepared','executing'].includes(c.status) || typeof c.precise !== 'boolean'
      || !Number.isInteger(c.cost??Number(c.precise)) || (c.cost??Number(c.precise))<0 || (c.cost??Number(c.precise))>1
      || !Number.isInteger(c.tokenCost) || c.tokenCost<1 || c.tokenCost>RULES.aiTokenPreciseCost) return failure('invalid-runtime-command');
    const evacuationStage = a.evacuationStage ?? (a.evacuationStarted ? 'evacuating'
      : a.remoteReady ? 'remote-ready' : a.rendezvousCrew.length === 3 ? 'crew-ready' : 'preparing');
    const legacyCollaboration = chapter.commandTargets.some(target => target.collaboration
      && a.completedTargetIds?.includes(target.id));
    const evacuationAssist = a.evacuationAssist
      ?? (legacyCollaboration ? 'collaboration' : a.remoteReady ? 'fallback' : 'pending');
    if (['returnBeaconReady','remoteReady','evacuationStarted'].some(k=>typeof a[k]!=='boolean')
      || !Number.isFinite(a.evacuationRemainingMs) || a.evacuationRemainingMs<0 || a.evacuationRemainingMs>RULES.finalEvacuationMs
      || (a.evacuationStarted&&chapter.number!==5)
      || !['preparing','crew-ready','remote-ready','evacuating'].includes(evacuationStage)
      || !['pending','collaboration','fallback'].includes(evacuationAssist)
      || evacuationStage === 'preparing' && (a.remoteReady || a.evacuationStarted || a.rendezvousCrew.length >= 3)
      || evacuationStage === 'crew-ready' && (a.remoteReady || a.evacuationStarted || a.rendezvousCrew.length !== 3)
      || evacuationStage === 'remote-ready' && (!a.remoteReady || a.evacuationStarted)
      || (evacuationStage === 'evacuating' && !a.evacuationStarted)
      || (a.evacuationStarted && evacuationStage !== 'evacuating')) return failure('invalid-runtime-evacuation');
    const failures = [...(Array.isArray(snapshot.failures)?snapshot.failures:[])];
    if (reason) failures.push({reason:String(reason).slice(0,80),elapsedMs:this.#attempt?.elapsedMs||0});
    this.#checkpoint=checkpoint;this.#generation+=1;
    // A new instance may resume a snapshot that already used attempt-2. Keep
    // its old world callbacks stale even when the local counter starts at 1.
    if (`attempt-${this.#generation}` === a.attemptId) this.#generation+=1;
    const fresh=makeAttempt(checkpoint,chapter,this.#generation);
    for (const key of Object.keys(fresh)) if (key in a) fresh[key]=copy(a[key]);
    // Validation may fill legacy analysis fields; restore that canonical
    // session rather than reintroducing the incomplete imported object.
    if (analysisSession) fresh.vulnerabilitySession = analysisSession;
    // Older runtime snapshots predate the finale status fields. Derive their
    // safe equivalent instead of rejecting an otherwise valid save.
    fresh.evacuationStage = evacuationStage;
    fresh.evacuationAssist = evacuationAssist;
    fresh.attemptId=`attempt-${this.#generation}`;
    fresh.lastDamageAtMs=Number.isFinite(a.lastDamageAtMs)?a.lastDamageAtMs:-Infinity;
    fresh.lastAlarmAtBySource=Object.fromEntries(Object.entries(a.lastAlarmAtBySource||{}).filter(([id,t])=>validId(id)&&Number.isFinite(t)&&t>=0));
    this.#attempt=fresh;this.#phase='playing';this.#pending=null;this.#failures=failures.slice(-1000);
    this.#worldTargets=[];this.registerWorldTargets(extra);return success();
  }

  /** Use this gate for delayed world callbacks so old attempts cannot mutate a retry/new chapter. */
  worldEvent(attemptId, event) {
    if (attemptId !== this.#attempt?.attemptId) return failure('stale-attempt');
    if (!event || typeof event !== 'object') return failure('invalid-world-event');
    switch (event.type) {
      case 'pickup': return this.pickup(event.itemId);
      case 'supply': return this.collectSupply(event.supplyId);
      case 'ai-token-supply': return this.collectTokenSupply(event.cacheId);
      case 'emergency-ai-token': return this.claimEmergencyToken(event.interactionTarget);
      case 'delivery': return this.deliver(event.eventId);
      case 'command-complete': return this.completeCommand(event.teammate, event.commandId);
      case 'alarm': return this.alarm(event);
      case 'damage': return this.damage(event.amount);
      case 'broadcast': return this.setBroadcast(event.on);
      case 'return-beacon': return this.activateReturnBeacon();
      case 'rendezvous': return this.rendezvous(event.teammate, event.interactionTarget);
      case 'remote-prepare': return this.prepareRemoteBeacon(event.interactionTarget);
      case 'evacuation-confirm': return this.startEvacuation(event.interactionTarget);
      case 'board': return this.board();
      default: return failure('unknown-world-event');
    }
  }

  /** Read-only status for the fictional offline vulnerability-analysis loop. */
  vulnerabilityState() {
    const attempt = this.#attempt;
    if (!attempt?.vulnerabilitySession) return null;
    const session = copy(attempt.vulnerabilitySession);
    const caseFile = getVulnerabilityCase(session.chapterId);
    const progress = analysisProgress(session);
    const suggestions = repairSuggestions(session);
    return { caseFile, session, progress: progress.ok ? progress : null,
      suggestions: suggestions.ok ? suggestions : { suggestions: [], locked: [] } };
  }

  /** Collect an in-game clue into the local analysis sandbox. */
  collectVulnerabilityEvidence(clueId, meta = {}) {
    if (!this.#attempt || !['playing', 'paused'].includes(this.#phase)) return failure('not-in-chapter');
    const result = collectEvidence(this.#attempt.vulnerabilitySession, clueId, meta);
    if (result.ok) this.#attempt.vulnerabilitySession = result.session;
    return result;
  }

  /** Spend analysis-only tokens to produce a safe, non-operational summary. */
  analyzeVulnerability(clueId, mode = 'summarize') {
    if (!this.#attempt || !['playing', 'paused'].includes(this.#phase)) return failure('not-in-chapter');
    const result = analyzeEvidence(this.#attempt.vulnerabilitySession, clueId, { mode });
    if (result.ok) this.#attempt.vulnerabilitySession = result.session;
    return result;
  }

  /** Select a fictional repair recommendation and award a finite AI-token refill. */
  selectVulnerabilityRepair(repairId) {
    if (!this.#attempt || !['playing', 'paused'].includes(this.#phase)) return failure('not-in-chapter');
    const result = selectRepair(this.#attempt.vulnerabilitySession, repairId);
    if (result.ok) {
      this.#attempt.vulnerabilitySession = result.session;
      // Each distinct repair is a one-time, chapter-local refill. It keeps the
      // action-token economy moving without allowing an infinite farm.
      this.#attempt.aiTokens = Math.min(RULES.aiTokenCapacity, this.#attempt.aiTokens + 1);
    }
    return result;
  }

  view() {
    const results = this.#checkpoint.campaign.results;
    const totalScore = results.reduce((sum, result) => sum + result.score, 0);
    const chapter = this.#chapter();
    const attempt = this.#attempt ? copy(this.#attempt) : null;
    if (attempt) {
      // JSON cannot represent Infinity; this implementation detail is not part of the public view.
      delete attempt.lastDamageAtMs;
      attempt.exposureDelta = exposureOf(this.#attempt);
      attempt.deliveryDurationMs = attempt.broadcastOn ? RULES.deliveryOpenMs : RULES.deliveryClosedMs;
      attempt.scanIntervalMs = attempt.alert >= 100 ? 6000 : attempt.alert >= 70 ? 10_000 : null;
      attempt.evacuationNotice = evacuationNotice(this.#attempt, chapter);
    }
    return {
      phase: this.#phase, chapter, attempt,
      campaign: {
        ...copy(this.#checkpoint.campaign), totalScore,
        historyExposure: committedExposure(this.#checkpoint),
        grade: this.#checkpoint.campaign.completed ? campaignGrade(totalScore) : null,
      },
      vulnerability: this.vulnerabilityState(),
      objectives: this.#attempt ? this.objectives() : [],
      optionalObjectives: this.#attempt ? this.optionalObjectives() : [],
      pendingResult: this.#pending ? { ...copy(this.#pending), grade: chapterGrade(this.#pending.score) } : null,
      failuresThisChapter: copy(this.#failures),
      storage: { ...this.#storageStatus }, loadNotice: this.#loadNotice,
      evacuationStatus: chapter?.number === 5 && attempt ? {
        stage: attempt.evacuationStage,
        assist: attempt.evacuationAssist,
        notice: evacuationNotice(this.#attempt, chapter),
        remainingMs: attempt.evacuationRemainingMs,
      } : null,
    };
  }

  objectives() {
    const chapter = this.#chapter();
    if (!chapter) return [];
    const attempt = this.#attempt;
    const count = chapter.requiredItems.filter((item) => attempt.deliveredIds.includes(item.id)).length;
    const goals = [{ id: 'required-delivery', label: chapter.number === 4 ? '交付两份任务物' : '交付必需数据',
      current: count, required: chapter.requiredItems.length, complete: count === chapter.requiredItems.length }];
    const effects = this.#targets().filter((target) => attempt.completedTargetIds.includes(target.id)).map((target) => target.effect);
    const groups = chapter.requiredTargetGroups || [];
    if (chapter.number === 1) goals.push({ id: 'effective-command', label: 'Grok 打开纸窗', complete: targetGroupComplete(chapter, attempt, groups[0] || ['paper-window']) });
    if (chapter.number === 2) goals.push({ id: 'changed-patrol', label: '完成诱饵或破障路线', complete: targetGroupComplete(chapter, attempt, groups[0] || ['patrol-east']) });
    if (chapter.number === 3) goals.push({ id: 'completed-review', label: '完成扫描或打开回程', complete: targetGroupComplete(chapter, attempt, groups[0] || ['trap-bridge']) });
    if (chapter.number === 4) goals.push(
      { id: 'broadcast-off', label: '关闭或验证广播已关闭', complete: !attempt.broadcastOn },
      { id: 'return-beacon-ready', label: '设置返航信标', complete: attempt.returnBeaconReady },
    );
    if (chapter.number === 5) goals.push(
      { id: 'crew-rendezvous', label: '三名队友在远端信标到齐', current: attempt.rendezvousCrew.length, required: 3, complete: attempt.rendezvousCrew.length === 3 },
      { id: 'remote-ready', label: '在远端接应并装载最后三块', complete: attempt.remoteReady },
      { id: 'teamwork-or-fallback', label: '完成一项协作或保底返航', complete: attempt.evacuationAssist !== 'pending' },
      { id: 'evacuation-confirmed', label: '确认准备撤离', complete: attempt.evacuationStarted && attempt.evacuationRemainingMs > 0 },
    );
    return goals;
  }

  /** Optional investigations never participate in boarding or chapter gates. */
  optionalObjectives() {
    const chapter = this.#chapter();
    if (!chapter) return [];
    const attempt = this.#attempt, goals = [];
    const goal = (id, label, kind, current, required) => ({ id, label, kind,
      current, required, complete: current >= required, optional: true });
    if (chapter.optionalItems.length) goals.push(goal('optional-delivery', '交付可选档案', 'archive',
      chapter.optionalItems.filter(item => attempt.deliveredIds.includes(item.id)).length, chapter.optionalItems.length));
    const optionalSupplies = chapter.supplies.filter(supply => supply.optionalObjective);
    if (optionalSupplies.length) goals.push({ ...goal('optional-supplies', '收集可选撤离补给', 'supply',
      optionalSupplies.filter(supply => attempt.collectedSupplyIds.includes(supply.id)).length, optionalSupplies.length),
      sealed: attempt.evacuationStarted });
    const analysis = attempt.vulnerabilitySession && analysisProgress(attempt.vulnerabilitySession);
    if (analysis?.ok) goals.push(
      goal('analysis-collect', '收集本章调查线索', 'analysis', analysis.collected, analysis.total),
      goal('analysis-analyze', '分析全部调查线索', 'analysis', analysis.analyzed, analysis.total),
      goal('analysis-repair', '采用至少一项修复建议', 'analysis', Math.min(1, analysis.repairs), 1),
    );
    return goals;
  }

  setPaused(paused) {
    if (typeof paused !== 'boolean' || !['playing', 'paused'].includes(this.#phase)) return failure('not-in-chapter');
    this.#phase = paused ? 'paused' : 'playing';
    return success();
  }

  /** One scaled delta advances elapsed time, cooldowns, protection and final timer together. */
  advanceTime(deltaMs, { timeScale = 1 } = {}) {
    if (!this.#playing()) return failure('not-playing');
    if (!Number.isFinite(deltaMs) || deltaMs < 0 || !Number.isFinite(timeScale) || timeScale < 0 || timeScale > 1) return failure('invalid-delta');
    const scaled = deltaMs * timeScale;
    this.#attempt.elapsedMs += scaled;
    if (this.#attempt.evacuationStarted) {
      this.#attempt.evacuationRemainingMs -= scaled;
      if (this.#attempt.evacuationRemainingMs <= 0) return this.retryChapter('evacuation-timeout');
    }
    return success();
  }

  pickup(itemId) {
    if (!this.#playing()) return failure('not-playing');
    const chapter = this.#chapter();
    const item = [...chapter.requiredItems, ...chapter.optionalItems].find((candidate) => candidate.id === itemId);
    if (!item) return failure('unknown-item');
    if (chapter.number === 5 && this.#attempt.evacuationStarted) return failure('evacuation-no-backtracking');
    if (this.#attempt.inventory.includes(itemId) || this.#attempt.deliveredIds.includes(itemId)) return failure('already-collected');
    if (this.#attempt.inventory.length >= RULES.backpackCapacity) return failure('backpack-full');
    this.#attempt.inventory.push(itemId);
    return success();
  }

  collectSupply(supplyId) {
    if (!this.#playing()) return failure('not-playing');
    const supply = this.#chapter().supplies.find((candidate) => candidate.id === supplyId);
    if (!supply) return failure('unknown-supply');
    if (this.#attempt.evacuationStarted) return failure('evacuation-no-backtracking');
    if (this.#attempt.collectedSupplyIds.includes(supplyId)) return failure('already-collected');
    this.#attempt.collectedSupplyIds.push(supplyId);
    this.#attempt.qualifiers = Math.min(RULES.qualifierCapacity, this.#attempt.qualifiers + (supply.qualifiers || 0));
    // Every finite supply also carries one local AI-token cache. Tokens are
    // refilled only when the player physically reaches that pickup.
    const tokenGain = Math.max(0, Math.min(RULES.aiTokenCapacity - this.#attempt.aiTokens, Number(supply.aiTokens) || RULES.aiTokenSupply));
    this.#attempt.aiTokens += tokenGain;
    return success({ tokenGain, qualifierGain: supply.qualifiers || 0 });
  }

  collectTokenSupply(cacheId) {
    if (!this.#playing()) return failure('not-playing');
    if (!validId(cacheId)) return failure('invalid-token-cache');
    if (this.#attempt.collectedTokenCacheIds.includes(cacheId)) return failure('already-collected');
    this.#attempt.collectedTokenCacheIds.push(cacheId);
    const amount = Math.min(RULES.aiTokenCapacity - this.#attempt.aiTokens, RULES.aiTokenSupply);
    this.#attempt.aiTokens += amount;
    return success({ amount, aiTokens: this.#attempt.aiTokens });
  }

  /** The world calls this only after a held interaction at the evidence console.
   * One empty-to-one refill cannot be stockpiled or award score/exposure. */
  claimEmergencyToken(interactionTarget) {
    if (!this.#playing()) return failure('not-playing');
    if (interactionTarget !== 'analysis-station') return failure('not-at-analysis-station');
    if (this.#attempt.aiTokens !== 0) return failure('emergency-token-not-needed');
    this.#attempt.aiTokens = 1;
    return success({ amount: 1, aiTokens: 1 });
  }

  /** Report only after the world completes the current 0.4 s / 1.6 s delivery interaction. */
  deliver(deliveryId) {
    if (!this.#playing()) return failure('not-playing');
    if (!validId(deliveryId)) return failure('invalid-event-id');
    if (this.#attempt.deliveryIds.includes(deliveryId)) return failure('duplicate-delivery');
    if (!this.#attempt.inventory.length) return failure('empty-backpack');
    if (this.#chapter().number === 5 && !this.#attempt.evacuationStarted) return failure('confirm-at-remote-beacon-first');
    this.#attempt.deliveredIds.push(...this.#attempt.inventory);
    this.#attempt.inventory = [];
    this.#attempt.deliveryIds.push(deliveryId);
    if (this.#attempt.broadcastOn) {
      this.#attempt.publicDeliveryIds.push(deliveryId);
      this.#addAlert(RULES.deliveryAlert);
    }
    return success();
  }

  /** Report only after a valid interaction beside the boat. It never changes earlier records. */
  setBroadcast(on) {
    if (!this.#playing()) return failure('not-playing');
    if (typeof on !== 'boolean') return failure('invalid-broadcast-state');
    this.#attempt.broadcastOn = on;
    return success();
  }

  prepareCommand({ commandId, teammate, targetId, precise = false, replace = false, cost = precise ? 1 : 0, tokenCost = precise ? RULES.aiTokenPreciseCost : RULES.aiTokenDefaultCost } = {}) {
    if (!this.#playing()) return failure('not-playing');
    const chapter = this.#chapter();
    const attempt = this.#attempt;
    if (!validId(commandId) || attempt.commandIds.includes(commandId)) return failure('invalid-or-duplicate-command-id');
    if (!chapter.teammates.includes(teammate)) return failure('teammate-unavailable');
    const target = this.#targets().find((candidate) => candidate.id === targetId && candidate.teammate === teammate);
    if (!target) return failure('invalid-target');
    if (attempt.readyAtMs[teammate] > attempt.elapsedMs) return failure('teammate-cooling-down');
    if (typeof precise !== 'boolean' || !Number.isInteger(cost) || cost<0 || cost>1 || attempt.qualifiers<cost) return failure('qualifier-unavailable');
    if (!Number.isInteger(tokenCost) || tokenCost<1 || tokenCost>RULES.aiTokenPreciseCost || attempt.aiTokens<tokenCost) return failure('ai-token-unavailable');
    if (attempt.commands[teammate] && !replace) return failure('replacement-confirmation-required');
    attempt.commands[teammate] = { commandId, teammate, targetId, precise, cost, tokenCost, status: 'prepared' };
    attempt.commandIds.push(commandId);
    return success();
  }

  beginCommand(teammate) {
    if (!this.#playing()) return failure('not-playing');
    const command = this.#attempt.commands[teammate];
    if (!command || command.status !== 'prepared') return failure('no-prepared-command');
    const cost=command.cost??Number(command.precise);
    if (this.#attempt.qualifiers < cost) return failure('qualifier-unavailable');
    if (this.#attempt.aiTokens < command.tokenCost) return failure('ai-token-unavailable');
    this.#attempt.qualifiers -= cost;
    this.#attempt.aiTokens -= command.tokenCost;
    command.status = 'executing';
    return success();
  }

  cancelCommand(teammate) {
    if (!this.#playing()) return failure('not-playing');
    const command = this.#attempt.commands[teammate];
    if (!command) return failure('no-command');
    // Prepared commands have not spent a qualifier; started commands retain their cost.
    if (command.status === 'executing') this.#attempt.readyAtMs[teammate] = this.#attempt.elapsedMs + RULES.cooldownMs[teammate];
    delete this.#attempt.commands[teammate];
    return success();
  }

  refundCommand(teammate, commandId) {
    if (!this.#playing()) return failure('not-playing');
    const command=this.#attempt.commands[teammate];
    if (!command || command.commandId!==commandId) return failure('stale-command');
    if (command.status==='executing') {
      this.#attempt.qualifiers=Math.min(RULES.qualifierCapacity,
        this.#attempt.qualifiers+(command.cost??Number(command.precise)));
      this.#attempt.aiTokens=Math.min(RULES.aiTokenCapacity,
        this.#attempt.aiTokens+(command.tokenCost||RULES.aiTokenDefaultCost));
    }
    return this.cancelCommand(teammate);
  }

  /** The action engine reports success only after the target's world effect actually happened. */
  completeCommand(teammate, commandId) {
    if (!this.#playing()) return failure('not-playing');
    const attempt = this.#attempt;
    const command = attempt.commands[teammate];
    if (!command || command.status !== 'executing') return failure('no-executing-command');
    if (command.commandId !== commandId) return failure('stale-command');
    const target = this.#targets().find((candidate) => candidate.id === command.targetId);
    if (!target) return failure('invalid-target');
    if (!attempt.completedTargetIds.includes(target.id)) attempt.completedTargetIds.push(target.id);
    if (target.collaboration && !attempt.collaborationIds.includes(target.id)) attempt.collaborationIds.push(target.id);
    if (this.#chapter().number === 5 && target.collaboration) attempt.evacuationAssist = 'collaboration';
    if (attempt.broadcastOn) { attempt.publicCommandIds.push(command.commandId); this.#addAlert(RULES.commandAlert); }
    attempt.readyAtMs[teammate] = attempt.elapsedMs + RULES.cooldownMs[teammate];
    delete attempt.commands[teammate];
    return success({ effect: target.effect });
  }

  alarm({ eventId, sourceId } = {}) {
    if (!this.#playing()) return failure('not-playing');
    if (!validId(eventId) || !validId(sourceId)) return failure('invalid-event-id');
    const attempt = this.#attempt;
    if (attempt.alarmIds.includes(eventId)) return failure('duplicate-alarm');
    const lastAt = attempt.lastAlarmAtBySource[sourceId];
    if (lastAt !== undefined && attempt.elapsedMs - lastAt < RULES.alarmSourceCooldownMs) return failure('source-cooling-down');
    attempt.alarmIds.push(eventId);
    // A null-prototype map is not necessary: defineProperty safely accepts names such as __proto__.
    Object.defineProperty(attempt.lastAlarmAtBySource, sourceId, { value: attempt.elapsedMs, writable: true, enumerable: true, configurable: true });
    this.#addAlert(RULES.alarmAlert);
    return success();
  }

  damage(amount = RULES.damage) {
    if (!this.#playing()) return failure('not-playing');
    if (!Number.isFinite(amount) || amount <= 0) return failure('invalid-damage');
    const attempt = this.#attempt;
    if (attempt.elapsedMs - attempt.lastDamageAtMs < RULES.damageProtectionMs) return failure('damage-protected');
    attempt.lastDamageAtMs = attempt.elapsedMs;
    attempt.health = Math.max(0, attempt.health - amount);
    if (attempt.health === 0) return this.retryChapter('health-depleted');
    return success();
  }

  activateReturnBeacon() {
    if (!this.#playing()) return failure('not-playing');
    if (this.#chapter().number !== 4) return failure('wrong-chapter');
    this.#attempt.returnBeaconReady = true;
    for (const flag of ['broadcast-discovered', 'return-beacon-ready']) {
      if (!this.#attempt.storyFlags.includes(flag)) this.#attempt.storyFlags.push(flag);
    }
    return success();
  }

  /** Called after this teammate reaches the remote beacon; boarding the boat cannot replace it. */
  rendezvous(teammate, interactionTarget) {
    if (!this.#playing()) return failure('not-playing');
    const chapter = this.#chapter();
    if (chapter.number !== 5 || interactionTarget !== chapter.rendezvousTarget) return failure('not-at-remote-beacon');
    if (!chapter.teammates.includes(teammate)) return failure('teammate-unavailable');
    if (this.#attempt.evacuationStarted) return failure('evacuation-already-started');
    if (this.#attempt.rendezvousCrew.includes(teammate)) return success();
    this.#attempt.rendezvousCrew.push(teammate);
    if (this.#attempt.rendezvousCrew.length === chapter.teammates.length) this.#attempt.evacuationStage = 'crew-ready';
    return success();
  }

  prepareRemoteBeacon(interactionTarget) {
    if (!this.#playing()) return failure('not-playing');
    const chapter = this.#chapter();
    const attempt = this.#attempt;
    if (chapter.number !== 5 || interactionTarget !== chapter.rendezvousTarget) return failure('not-at-remote-beacon');
    if (attempt.evacuationStarted) return failure('evacuation-already-started');
    if (!attempt.storyFlags.includes('return-beacon-ready')) return failure('beacon-not-established');
    if (attempt.rendezvousCrew.length !== 3 || !chapter.requiredItems.every((item) => attempt.inventory.includes(item.id))) return failure('remote-preparation-incomplete');
    attempt.remoteReady = true;
    attempt.evacuationStage = 'remote-ready';
    // A player who takes the static ladder/route still demonstrates the
    // chapter's fallback plan without spending a command token.
    if (attempt.evacuationAssist === 'pending') attempt.evacuationAssist = 'fallback';
    return success();
  }

  /** This explicit remote interaction is the ONLY operation that starts the final 60 s. */
  startEvacuation(interactionTarget) {
    if (!this.#playing()) return failure('not-playing');
    const chapter = this.#chapter();
    const attempt = this.#attempt;
    if (chapter.number !== 5 || interactionTarget !== chapter.rendezvousTarget) return failure('not-at-remote-beacon');
    if (!attempt.remoteReady || attempt.rendezvousCrew.length !== 3 || !chapter.requiredItems.every((item) => attempt.inventory.includes(item.id))) return failure('remote-preparation-incomplete');
    if (attempt.evacuationStarted) return failure('evacuation-already-started');
    attempt.evacuationStarted = true;
    attempt.evacuationRemainingMs = RULES.finalEvacuationMs;
    attempt.evacuationStage = 'evacuating';
    return success();
  }

  /** Stage only. It does not commit score, exposure, broadcast or story flags. */
  board() {
    if (!this.#playing()) return failure('not-playing');
    const unmet = this.objectives().filter((objective) => !objective.complete);
    if (unmet.length) return failure(`objectives-incomplete:${unmet.map((goal) => goal.id).join(',')}`);
    const chapter = this.#chapter();
    const attempt = this.#attempt;
    const optionalCount = chapter.optionalItems.filter((item) => attempt.deliveredIds.includes(item.id)).length
      + chapter.supplies.filter((supply) => supply.optionalObjective && attempt.collectedSupplyIds.includes(supply.id)).length;
    const breakdown = { required: 60, optional: Math.min(20, optionalCount * 10),
      collaboration: Math.min(10, attempt.collaborationIds.length * 5),
      lowAlert: Math.max(0, 10 - attempt.alarmIds.length * 2) };
    this.#pending = {
      chapterId: chapter.id, score: Object.values(breakdown).reduce((sum, value) => sum + value, 0), breakdown,
      elapsedMs: attempt.elapsedMs, exposureDelta: exposureOf(attempt),
      events: { publicCommands: attempt.publicCommandIds.length, publicDeliveries: attempt.publicDeliveryIds.length, alarms: attempt.alarmIds.length },
      broadcastOn: attempt.broadcastOn, storyFlags: [...attempt.storyFlags], failedAttempts: this.#failures.length,
    };
    this.#phase = 'chapter-result';
    return success({ result: copy(this.#pending) });
  }

  retryChapter(reason = 'manual') {
    if (!this.#attempt || !['playing', 'paused', 'chapter-result'].includes(this.#phase)) return failure('not-in-chapter');
    this.#failures.push({ reason: String(reason).slice(0, 80), elapsedMs: this.#attempt.elapsedMs });
    this.#generation += 1;
    this.#attempt = makeAttempt(this.#checkpoint, this.#chapter(), this.#generation);
    this.#pending = null;
    this.#phase = 'playing';
    return success({ retried: true, reason });
  }

  /** Exactly one chapter is committed; repeated clicks cannot score twice. */
  continueCampaign() {
    if (this.#phase !== 'chapter-result' || !this.#pending) return failure('no-pending-result');
    const campaign = this.#checkpoint.campaign;
    campaign.results.push(copy(this.#pending));
    campaign.broadcastOn = this.#pending.broadcastOn;
    campaign.storyFlags = [...new Set([...campaign.storyFlags, ...this.#pending.storyFlags])];
    campaign.completed = campaign.results.length === CHAPTERS.length;
    this.#pending = null;
    this.#failures = [];
    this.#phase = campaign.completed ? 'campaign-complete' : 'playing';
    this.#generation += 1;
    this.#attempt = campaign.completed ? null : makeAttempt(this.#checkpoint, CHAPTERS[campaign.results.length], this.#generation);
    this.#worldTargets = [];
    this.#persist();
    return success({ campaignComplete: campaign.completed, saved: this.#storageStatus.ok });
  }
}
