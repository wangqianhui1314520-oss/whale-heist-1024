import { CHAPTERS } from '../core/chapters.mjs';
import { UIV3Controller } from './ui-v3.mjs';
import { rasterIconHTML } from './raster-icons.mjs';

const TEAM = ['Grok', 'Claude', 'GLM'];
const JOBS = { Grok: '破障', Claude: '诱饵', GLM: '扫描' };
const DEFAULTS = {
  Grok: ['一直冲到障碍物，连续破开沿途阻挡。', '到这里停。只处理选中的障碍。'],
  Claude: ['散出简历，引走范围内同层的巡逻守卫。', '只引这个。仅吸引同层最近的守卫。'],
  GLM: ['扫描大片区域，发现陷阱，也可能触动警戒。', '只看这里。仅扫描指定区域。'],
};
const esc = (text = '') => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icon = rasterIconHTML;
const portrait = (name) => `assets/portraits/${String(name).toLowerCase()}-portrait.webp`;
const clock = (value = 0) => { const seconds = Math.max(0, Math.ceil(Number(value || 0) / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; };
const button = (action, label, type = '', attrs = '') => `<button class="game-button ${type}" type="button" data-action="${action}" ${attrs}>${label}</button>`;
const bestFor = (best, chapter) => Array.isArray(best) ? best.find((item) => item.chapterId === chapter.id) : best?.[chapter.id];
const compactObjectiveLabel = (label = '') => ({
  '交付必需数据': '交付资料', '交付两份任务物': '交付档案', 'Grok 打开纸窗': '打开纸窗',
  '完成诱饵或破障路线': '开路', '完成扫描或打开回程': '复查', '关闭或验证广播已关闭': '关闭广播',
  '设置返航信标': '设置信标', '三名队友在远端信标到齐': '队友到齐', '在远端接应并装载最后三块': '装载资料',
  '完成一项协作或保底返航': '完成协作', '确认准备撤离': '确认撤离', '交付可选档案': '可选档案',
  '收集可选撤离补给': '可选补给', '收集本章调查线索': '收集线索', '分析全部调查线索': '分析线索',
  '采用至少一项修复建议': '选修复建议',
}[String(label)] || String(label));
const compactNearbyLabel = (label = '') => String(label).replace(/^打开演算舱 · /, '打开演算舱：').replace(/^领取 /, '领取 ');

/** Lightweight HTML interface. Call update at about 24 Hz; input and simulation stay in the game engine. */
export class GameUI {
  constructor({ onAction = () => {} } = {}) {
    this.onAction = onAction;
    this.view = null;
    this.screen = 'none';
    this.payload = {};
    this.toastTimer = null;
    this.dialogueTimer = null; this.dialogueAt = 0;
    this.commandSignature = '';
    this.screenOpenedAt = -Infinity;
    this.lastPointerDownAt = -Infinity;
    // Presses that started on a HUD touch control can finish after the game
    // opens an overlay. Their release click lands on whatever is under the
    // finger now (often the settlement's retry button), so remember when the
    // press began to tell those carry-over clicks apart from a real tap.
    document.addEventListener('pointerdown', () => { this.lastPointerDownAt = performance.now(); }, true);
    this.root = document.getElementById('ui-root');
    this.menu = document.getElementById('menu-root');
    this.toasts = document.getElementById('toast-root');
    this.dialogues = document.getElementById('dialogue-root');
    this.root.innerHTML = this.#hudTemplate();
    this.loading = document.createElement('div');
    this.loading.className = 'loading-screen';
    this.loading.innerHTML = `<img src="assets/ui/whale-emblem.webp" alt=""><div class="loading-name">鲸鱼魔盗团</div><div class="loading-rail"><i></i></div><p>正在准备这次行动…</p>`;
    this.loading.setAttribute('role', 'status');
    this.loading.insertAdjacentHTML('beforeend', '<div class="loading-recovery" hidden><button type="button" class="game-button primary" data-load-retry>重新加载</button><button type="button" class="game-button" data-load-back>返回主菜单</button></div>');
    this.loading.querySelector('[data-load-retry]').addEventListener('click', () => globalThis.location.reload());
    this.loading.querySelector('[data-load-back]').addEventListener('click', () => { document.getElementById('game-shell').dataset.loading = 'false'; this.setLoading(1); this.onAction('title', {}); });
    document.getElementById('game-shell').append(this.loading);
    this.fields = Object.fromEntries([...this.root.querySelectorAll('[data-field]')].map((element) => [element.dataset.field, element]));
    this.v3 = new UIV3Controller(this);
    const actionHandler = (event) => {
      const element = event.target.closest('[data-action]');
      if (!element || element.disabled) return;
      // Drop carry-over releases: the press began before this overlay existed,
      // so the click is the end of a HUD hold, not a deliberate menu tap.
      if (event.currentTarget === this.menu && event.detail > 0 && performance.now() - this.screenOpenedAt < 1200 && this.lastPointerDownAt < this.screenOpenedAt) return;
      if (this.v3.dispatch(element.dataset.action, element)) return;
      const payload = {};
      if (element.dataset.teammate) payload.teammate = element.dataset.teammate;
      if (element.dataset.chapterId) payload.chapterId = element.dataset.chapterId;
      if (element.dataset.precise !== undefined) payload.precise = element.dataset.precise === 'true';
      this.onAction(element.dataset.action, payload);
    };
    this.root.addEventListener('click', actionHandler);
    this.menu.addEventListener('click', actionHandler);
    this.menu.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusable = [...this.menu.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
    });
    this.root.hidden = true;
  }

  #hudTemplate() {
    return `<header class="mission-hud"><div class="hud-brand"><img src="assets/ui/whale-emblem.webp" alt=""><span>鲸鱼魔盗团</span></div><div class="chapter-heading"><small data-field="chapter-number">01</small><strong data-field="chapter-name">纸窗入港</strong></div><div class="hud-clock">${icon('clock', 'clock-dial')}<b data-field="time">00:00</b></div><div class="hud-vitals"><div>${icon('heart', 'hp-icon')}<b data-field="health">100</b><small>/100</small></div><div class="health-rail"><i data-field="health-bar"></i></div></div><div class="hud-resource-strip" aria-label="行动资源"><div class="ai-token-meter hud-badge" data-field="ai-token-meter" aria-label="AI Token 资源"><span class="hud-badge-art hud-art-token" aria-hidden="true"></span><span class="ai-token-label">Token</span><b data-field="ai-tokens">12</b><small>/</small><small data-field="ai-token-max">12</small></div><div class="qualifier-meter hud-badge" data-field="qualifier-meter" aria-label="限定词资源"><span class="hud-badge-art hud-art-qualifier" aria-hidden="true"></span><span class="qualifier-label">限定</span><b data-field="hud-qualifiers">2</b></div><div class="hud-alert hud-badge" data-field="hud-alert" aria-label="警戒值"><span class="hud-badge-art hud-art-alert" aria-hidden="true"></span><span class="alert-label">警戒</span><b data-field="alert">0</b><i class="alert-dot" data-field="alert-dot"></i></div></div><button class="hud-pause" type="button" data-action="pause" aria-label="暂停">${icon('pause')}</button></header>
      <section class="objective-panel" aria-label="当前任务"><div class="objective-heading"><span class="tiny-label"><span class="hud-badge-art hud-art-objective" aria-hidden="true"></span>任务</span><span class="broadcast-badge" data-field="broadcast">公开</span></div><div data-field="objectives" class="objective-list"></div></section>
      <div class="evacuation-banner" data-field="evacuation" role="status" aria-live="assertive" aria-atomic="true" hidden><span class="evacuation-kicker" data-field="evacuation-stage">准备撤离</span><b data-field="evacuation-time">—</b><span class="evacuation-caption" data-field="evacuation-caption">全员登艇</span><div class="evacuation-progress" aria-hidden="true"><i data-field="evacuation-progress"></i></div></div>
      <div class="world-message" data-field="message"></div>
      <div class="interaction-hint" data-field="nearby" hidden><span class="keycap">E</span><strong data-field="nearby-label">互动</strong><span class="interact-hold" data-field="nearby-progress"></span></div>
      <div class="slow-hint" data-field="slow" hidden>指令时刻 <i></i></div>
      <div class="bottom-hud"><div class="crew-panel" aria-label="小队指令">${TEAM.map((name, index) => `<button class="crew-button" type="button" data-action="command-select" data-teammate="${name}" aria-label="选择 ${name}，${JOBS[name]}"><span class="crew-key">${index + 1}</span><span class="crew-portrait"><img src="${portrait(name)}" alt=""><span class="crew-cooldown" data-field="cooldown-${name}" hidden></span></span><span class="crew-name">${name}</span><span class="crew-job">${JOBS[name]}</span><span class="crew-ready" data-field="ready-${name}"></span></button>`).join('')}</div><div class="cargo-panel"><div class="cargo-slots" aria-label="背包"><span class="hud-badge-art hud-art-cargo" aria-hidden="true"></span>${[0, 1, 2].map((index) => `<span class="cargo-slot" data-field="cargo-${index}">${icon('cube')}</span>`).join('')}</div></div></div>
      <div class="touch-controls" aria-label="触屏操作"><div class="touch-movement"><button class="touch-up" type="button" data-control="up" aria-label="向上爬梯">${icon('up')}</button><button class="touch-left" type="button" data-control="left" aria-label="向左移动">${icon('left')}</button><button class="touch-right" type="button" data-control="right" aria-label="向右移动">${icon('right')}</button><button class="touch-down" type="button" data-control="down" aria-label="向下爬梯">${icon('down')}</button></div><div class="touch-actions"><button class="touch-interact" type="button" data-control="interact" aria-label="互动">${icon('interact')}<small>互动</small></button><button type="button" data-control="jump" aria-label="跳跃">${icon('jump')}<small>跳跃</small></button><button type="button" data-control="dash" aria-label="冲刺">${icon('dash')}<small data-field="dash">冲刺</small></button></div></div>
      <div class="keyboard-strip"><span><kbd>A</kbd><kbd>D</kbd> 移动</span><span><kbd>空格</kbd> 跳跃</span><span><kbd>W</kbd><kbd>S</kbd> 爬梯</span><span><kbd>Shift</kbd> 冲刺</span><span><kbd>E</kbd> 互动</span><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 指令</span></div>`;
  }

  #text(name, value) { const field = this.fields[name]; if (field && field.textContent !== String(value)) field.textContent = value; }

  update(view) {
    this.view = view || {};
    const core = this.view.core || {};
    const attempt = core.attempt || {};
    const chapter = core.chapter || {};
    this.root.dataset.chapter = String(chapter.number || 1);
    const world = this.view.world || {};
    this.root.querySelector('.objective-panel').classList.toggle('is-overlapping', (world.player?.x || 0) > 840 && (world.player?.y || 600) < 250);
    document.documentElement.classList.toggle('reduce-motion', Boolean(this.view.reduceMotion));
    const modeLabel = this.view.mode === 'demo' ? '展示 / ' : this.view.mode === 'challenge' ? '挑战 / ' : '';
    this.#text('chapter-number', `${modeLabel}${String(chapter.number || 1).padStart(2, '0')}`);
    this.#text('chapter-name', chapter.name || '准备出发');
    this.#text('time', clock(attempt.elapsedMs));
    this.#text('health', Math.max(0, Math.round(attempt.health ?? 100)));
    this.fields['health-bar'].style.width = `${Math.max(0, Math.min(100, attempt.health ?? 100))}%`;
    this.fields['health-bar'].classList.toggle('is-low', (attempt.health ?? 100) <= 40);
    const aiTokens = Math.max(0, Number.isFinite(attempt.aiTokens) ? attempt.aiTokens : 0);
    const aiTokenMax = Math.max(1, Number.isFinite(attempt.aiTokenMax) ? attempt.aiTokenMax : 12);
    this.#text('ai-tokens', aiTokens);
    this.#text('ai-token-max', aiTokenMax);
    this.fields['ai-token-meter']?.classList.toggle('is-low', aiTokens <= Math.max(2, Math.ceil(aiTokenMax * .25)));
    this.fields['ai-token-meter']?.classList.toggle('is-empty', aiTokens <= 0);
    this.#text('alert', Math.round(attempt.alert || 0));
    this.fields['alert-dot'].classList.toggle('is-danger', (attempt.alert || 0) >= 70);
    this.#text('broadcast', attempt.broadcastOn ? '公开' : '封存');
    this.fields.broadcast.classList.toggle('is-off', !attempt.broadcastOn);
    const objectives = core.objectives || [];
    const signature = JSON.stringify(objectives);
    if (this.objectiveSignature !== signature) {
      this.objectiveSignature = signature;
      // Keep one actionable row visible in the compact HUD. The last row is
      // retained after completion so the player still gets a clear success
      // state before returning to the boat.
      const firstIncomplete = objectives.findIndex((item) => !item.complete);
      const currentIndex = firstIncomplete >= 0 ? firstIncomplete : Math.max(0, objectives.length - 1);
      this.fields.objectives.innerHTML = objectives.map((item, index) => `<div class="objective-row ${item.complete ? 'is-complete' : ''} ${index === currentIndex ? 'is-current' : ''}"><span class="objective-check">${item.complete ? '✓' : '◇'}</span><span>${esc(compactObjectiveLabel(item.label))}</span>${item.required !== undefined ? `<b>${item.current || 0}/${item.required}</b>` : ''}</div>`).join('');
    }
    this.#text('message', world.message || '');
    this.fields.message.hidden = !world.message;
    this.fields.nearby.hidden = !world.nearby || this.screen !== 'none';
    if (world.nearby) {
      this.#text('nearby-label', compactNearbyLabel(world.nearby.label || '互动'));
      const progress = Math.max(0, Math.min(1, Number(world.nearby.progress) || 0));
      this.fields['nearby-progress'].style.setProperty('--progress', `${progress * 100}%`);
      this.fields['nearby-progress'].hidden = !progress;
    }
    const evacuationStatus = core.evacuationStatus || {};
    const evacuationStage = evacuationStatus.stage || attempt.evacuationStage || 'preparing';
    const evacuationLabels = {
      preparing: ['准备撤离', '先完成协作或启用保底路线'],
      'crew-ready': ['全员已集结', '确认远端返航信标'],
      'remote-ready': ['返航信标已就绪', '靠近信标确认撤离'],
      evacuating: ['最后撤离', '全员登艇'],
    };
    const [stageLabel, stageCaption] = evacuationLabels[evacuationStage] || evacuationLabels.preparing;
    const evacuationVisible = chapter.number === 5 && ['preparing', 'crew-ready', 'remote-ready', 'evacuating'].includes(evacuationStage);
    this.fields.evacuation.hidden = !evacuationVisible;
    this.#text('evacuation-stage', stageLabel);
    const evacuationRemaining = Math.max(0, Number(attempt.evacuationRemainingMs || 0));
    this.#text('evacuation-time', attempt.evacuationStarted ? clock(evacuationRemaining) : '—');
    this.#text('evacuation-caption', attempt.evacuationStarted ? '全员登艇' : stageCaption);
    this.fields['evacuation-progress']?.style.setProperty('width', `${attempt.evacuationStarted ? Math.min(100, evacuationRemaining / 60000 * 100) : 100}%`);
    this.fields.evacuation.classList.toggle('is-prep', evacuationVisible && !attempt.evacuationStarted);
    this.fields.evacuation.dataset.stage = evacuationStage;
    this.fields.evacuation.classList.toggle('is-warning', evacuationRemaining <= 30000 && evacuationRemaining > 15000);
    this.fields.evacuation.classList.toggle('is-urgent', evacuationRemaining <= 15000 && evacuationRemaining > 10000);
    this.fields.evacuation.classList.toggle('is-critical', evacuationRemaining <= 10000);
    this.fields.evacuation.setAttribute('aria-label', attempt.evacuationStarted
      ? `最后撤离，剩余 ${clock(evacuationRemaining)}，全员登艇`
      : `第五章撤离状态：${stageLabel}。${stageCaption}`);
    this.root.classList.toggle('has-evacuation', evacuationVisible);
    this.root.classList.toggle('has-nearby', Boolean(world.nearby));
    this.root.dataset.nearbyType = world.nearby?.type || '';
    this.fields.slow.hidden = !world.slowRemaining || this.screen !== 'command';
    this.#text('qualifiers', attempt.qualifiers ?? 0);
    this.#text('hud-qualifiers', attempt.qualifiers ?? 0);
    [0, 1, 2].forEach((index) => this.fields[`cargo-${index}`].classList.toggle('is-filled', index < (attempt.inventory?.length || 0)));
    TEAM.forEach((name) => {
      const available = (chapter.teammates || []).includes(name);
      const remaining = Math.max(0, (attempt.readyAtMs?.[name] || 0) - (attempt.elapsedMs || 0));
      const executing = attempt.commands?.[name]?.status === 'executing';
      const crew = (world.crew || []).find((entry) => entry.name === name);
      const stage = crew?.stage || null;
      const recognised = crew?.order?.stage === 'done' && Number.isFinite(crew.order.at) && Number(world.time || 0) - crew.order.at < 4;
      const stageLabel = stage === 'waiting' ? '等待' : stage === 'travel' ? '接单' : stage === 'execute' ? '执行' : recognised ? '回执' : '';
      const button = this.root.querySelector(`[data-teammate="${name}"]`);
      button.disabled = !available;
      button.classList.toggle('is-locked', !available);
      button.classList.toggle('is-selected', world.selected === name);
      button.classList.toggle('is-busy', remaining > 0 || executing || Boolean(stage));
      this.fields[`cooldown-${name}`].hidden = !remaining && !executing && !stage;
      this.#text(`cooldown-${name}`, stage ? stageLabel : executing ? '执行中' : `${Math.ceil(remaining / 1000)}s`);
      this.#text(`ready-${name}`, !available ? '锁定' : stageLabel || (executing ? '执行' : remaining > 0 ? '冷却' : '就绪'));
    });
    const cooldown = Number(world.player?.dashCooldown || 0);
    this.#text('dash', cooldown > 0 ? '冷却中' : '冲刺');
    // V3 updates the existing command nodes; cooldown ticks never replace focused controls.
    const mute = this.menu.querySelector('[data-action="mute"]');
    if (mute) { mute.setAttribute('aria-pressed', String(Boolean(this.view.muted))); mute.textContent = this.view.muted ? '声音：关闭' : '声音：开启'; }
    const reduce = this.menu.querySelector('[data-action="reduce-motion"]');
    if (reduce) { reduce.setAttribute('aria-pressed', String(Boolean(this.view.reduceMotion))); reduce.textContent = this.view.reduceMotion ? '动态效果：轻量' : '动态效果：完整'; }
    this.v3.update(this.view);
  }

  show(screen, payload = {}) {
    this.previousScreen = this.screen;
    this.screen = screen;
    this.screenOpenedAt = performance.now();
    this.payload = payload || {};
    this.menu.className = `menu-root screen-${screen}`;
    this.root.dataset.screen = screen;
    this.root.hidden = ['title', 'chapter-select', 'chapter-result', 'campaign-result', 'settings', 'story', 'briefing', 'archive', 'analysis', 'contracts', 'confirm-new'].includes(screen);
    this.dialogues.hidden = screen !== 'none';
    this.menu.hidden = screen === 'none';
    this.menu.setAttribute('aria-label', { title: '主菜单', pause: '暂停菜单', help: '操作说明', 'chapter-select': '章节选择', 'chapter-result': '章节结算', 'campaign-result': '主线结算', command: '队友指令' }[screen] || '');
    if (screen === 'none') {
      // A command is confirmed while the command panel is still open; keep the
      // crew's reply for the moment the panel closes instead of dropping it.
      if (this.dialogueAt && Date.now() - this.dialogueAt < 1200 && this.dialogues.innerHTML) {
        this.dialogues.hidden = false; this.dialogues.classList.add('is-visible');
        clearTimeout(this.dialogueTimer);
        this.dialogueTimer = setTimeout(() => this.dialogues.classList.remove('is-visible'), 6000);
      }
      this.menu.replaceChildren(); document.getElementById('game-canvas').focus({ preventScroll: true }); return;
    }
    if (this.v3.screen(screen, payload)) { queueMicrotask(() => {
      const focus = screen === 'command' ? this.menu.querySelector('[data-command-confirm]:not(:disabled)') || this.menu.querySelector('[data-command-select="prompt-target"]') : this.menu.querySelector(screen === 'story' ? '[data-action="story-next"]' : 'button:not(:disabled)');
      focus?.focus({ preventScroll: true });
    }); return; }
    if (screen === 'title') this.#renderTitle();
    else if (screen === 'pause') this.#renderPause();
    else if (screen === 'help') this.#renderHelp();
    else if (screen === 'chapter-select') this.#renderChapters();
    else if (screen === 'chapter-result') this.#renderChapterResult();
    else if (screen === 'campaign-result') this.#renderCampaignResult();
    else if (screen === 'command') this.#renderCommand();
    queueMicrotask(() => this.menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true }));
  }

  #renderTitle() {
    const { hasSave, completed } = this.payload;
    this.menu.innerHTML = `<div class="menu-backdrop"></div><section class="title-brand" aria-labelledby="title-game-name"><img src="assets/ui/whale-emblem.webp" alt="鲸艇徽记"><h1 id="title-game-name">鲸鱼魔盗团</h1><div class="title-actions" aria-label="主要行动">${hasSave && !completed ? button('resume', '继续行动', 'primary') : ''}${button('new-game', completed ? '再次出发' : '开始行动', hasSave && !completed ? '' : 'primary')}${hasSave ? button('new-game', '重新开始', 'text-button title-restart') : ''}</div><nav class="title-secondary" aria-label="航程工具">${button('chapter-select', '航图', 'secondary-action')}${button('settings-open', '设置', 'secondary-action')}${button('archive-open', '档案', 'secondary-action')}</nav></section><aside class="title-crew" aria-label="行动小队"><img src="${portrait('DeepSeek')}" alt="DeepSeek"></aside>`;
  }

  #panel(eyebrow, title, content, className = '') { this.menu.innerHTML = `<div class="screen-shade"></div><section class="menu-panel ${className}" role="dialog" aria-modal="true"><div class="panel-ornament"></div><div class="panel-eyebrow">${eyebrow}</div><h2>${title}</h2>${content}</section>`; }

  #renderPause() {
    this.#panel('TAKE A BREATH', '行动暂停', `<p class="panel-lead">小队会等你，深蓝也是。</p><div class="vertical-actions">${button('resume-play', '继续行动', 'primary')}${button('retry', '重试本章')}${button('help', '行动指南')}${button('title', '返回主菜单', 'text-button')}</div><div class="settings-row">${button('mute', this.view?.muted ? '声音：关闭' : '声音：开启', 'setting-button', `aria-pressed="${Boolean(this.view?.muted)}"`)}${button('reduce-motion', this.view?.reduceMotion ? '动态效果：轻量' : '动态效果：完整', 'setting-button', `aria-pressed="${Boolean(this.view?.reduceMotion)}"`)}</div><p class="tiny-note">本章重新开始不会影响已完成章节。</p>`, 'pause-panel');
  }

  #renderHelp() {
    const active = Boolean(this.view?.core?.attempt) && this.payload.from !== 'title' && !['title', 'chapter-select'].includes(this.previousScreen);
    this.#panel('FIELD GUIDE', '行动指南', `<div class="help-grid"><div><h3>亲自潜入</h3><dl><div><dt><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd></dt><dd>移动</dd></div><div><dt><kbd>空格</kbd></dt><dd>跳跃</dd></div><div><dt><kbd>W</kbd><kbd>S</kbd> / <kbd>↑</kbd><kbd>↓</kbd></dt><dd>爬梯</dd></div><div><dt><kbd>Shift</kbd> / <kbd>J</kbd></dt><dd>冲刺</dd></div><div><dt><kbd>E</kbd></dt><dd>按住互动 / 交货</dd></div><div><dt><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd></dt><dd>选择队友</dd></div><div><dt><kbd>Esc</kbd></dt><dd>暂停 / 取消指令</dd></div></dl></div><div><h3>把话说清楚</h3><p>选择队友，再点击场景中的目标。确认前可以查看作用范围。</p><p>整片开路消耗 <b>1 AI Token</b>；只开此处再消耗 <b>1 枚限定词</b>，把队友的行动限定在目标上。</p><h3>带着成果返航</h3><p>背包最多三块，装满会变慢。回母舰交货，完成本章任务后登艇。</p><p>蓝色服务器节点需要两次冲刺，Grok 冲锋可一次撞开；裂纹表示还差一次。</p><p class="help-warning">广播开启时交货更快，但行动记录会引来调查。留意警戒和自己的后院。</p></div></div><div class="help-team">${TEAM.map((name) => `<span><img src="${portrait(name)}" alt=""><b>${name}</b><small>${JOBS[name]}</small></span>`).join('')}</div><p class="tiny-note">触屏设备使用画面两侧按钮。队友会按本章进度逐步加入。</p>${button(active ? 'resume-play' : 'title', active ? '返回行动' : '返回主菜单', 'primary')}`, 'help-panel');
  }

  #renderChapters() {
    const demoSelect = Boolean(this.payload.demoSelect);
    const unlocked = demoSelect ? 5 : Math.max(1, Math.min(5, this.payload.unlocked || this.view?.unlocked || 1));
    this.#panel(demoSelect ? 'CHAPTER SHOWCASE' : 'CHOOSE A CHAPTER', demoSelect ? '章节展示' : '章节挑战', `<p class="panel-lead">${demoSelect ? '自由查看五章场景，熟悉每一段航程。' : '重新走一遍熟悉的路，试试更漂亮的配合。'}</p><div class="chapter-list">${CHAPTERS.map((chapter) => { const locked = chapter.number > unlocked; const best = demoSelect ? null : bestFor(this.payload.best, chapter); return `<article class="chapter-card ${locked ? 'is-locked' : ''}"><span class="chapter-index">${String(chapter.number).padStart(2, '0')}</span><div><h3>${esc(chapter.name)}</h3><p>约 ${chapter.targetMinutes} 分钟 · ${chapter.teammates.map(esc).join(' / ')}</p>${demoSelect ? '<small>场景体验 · 不计入正式航程</small>' : best ? `<small>最佳 ${esc(best.grade || '')} · ${best.score ?? best.totalScore ?? 0} 分</small>` : `<small>${locked ? '完成前一章后解锁' : '等待一场漂亮行动'}</small>`}</div><div class="chapter-card-actions">${button(demoSelect ? 'demo-start' : 'challenge-start', demoSelect ? '进入展示' : locked ? '未解锁' : '挑战', 'compact primary', `data-chapter-id="${chapter.id}" ${locked ? 'disabled' : ''}`)}</div></article>`; }).join('')}</div>${button('title', '返回主菜单', 'text-button')}<p class="tiny-note">${demoSelect ? '展示模式不写入正式进度和成绩。' : '章节挑战单独结算，不改变主线航程。'}</p>`, 'chapters-panel');
  }

  #renderChapterResult() {
    const core = this.payload.core || this.view?.core || {};
    const result = this.payload.result || core.pendingResult || {};
    const chapter = CHAPTERS.find((item) => item.id === result.chapterId) || core.chapter || {};
    const special = (this.payload.mode || this.view?.mode || 'campaign') !== 'campaign';
    const breakdown = result.breakdown || {};
    this.#panel(`CHAPTER ${String(chapter.number || 1).padStart(2, '0')} COMPLETE`, esc(chapter.name || '本章完成'), `<div class="chapter-result-hero"><div class="grade-seal">${esc(result.grade || (result.score >= 90 ? 'S' : result.score >= 75 ? 'A' : 'B'))}</div><div><span>行动评分</span><strong>${result.score || 0}<small> / 100</small></strong><p>小队已登艇。数据安全归档。</p></div></div><div class="result-metrics"><span>本章用时<b>${clock(result.elapsedMs)}</b></span><span>暴露记录<b>${result.exposureDelta || 0}</b></span><span>重新出发<b>${result.failedAttempts || 0}</b></span></div><div class="score-lines"><span>任务 <b>${breakdown.required || 0}</b></span><span>探索 <b>${breakdown.optional || 0}</b></span><span>协作 <b>${breakdown.collaboration || 0}</b></span><span>低警戒 <b>${breakdown.lowAlert || 0}</b></span>${breakdown.broadcast !== undefined ? `<span>广播 <b>${breakdown.broadcast}</b></span>` : ''}</div><div class="result-actions">${button('retry', '再试一次')}${button(special ? 'chapter-select' : 'continue', special ? '选择章节' : chapter.number === 5 ? '全员返航' : '下一章 →', 'primary')}</div><p class="tiny-note">${special ? '本次记录独立于主线。' : '选择继续后，本章成绩将自动保存。'}</p>`, 'results-panel');
  }

  #renderCampaignResult() {
    const core = this.payload.core || this.view?.core || {};
    const campaign = core.campaign || this.payload.campaign || {};
    const results = campaign.results || [];
    const total = campaign.totalScore ?? results.reduce((sum, item) => sum + (item.score || 0), 0);
    const elapsed = results.reduce((sum, item) => sum + (item.elapsedMs || 0), 0);
    const publicCommands = results.reduce((sum, item) => sum + (item.events?.publicCommands || 0), 0);
    const alarms = results.reduce((sum, item) => sum + (item.events?.alarms || 0), 0);
    this.menu.innerHTML = `<div class="results-backdrop"></div><section class="campaign-panel" role="dialog" aria-modal="true"><div class="panel-eyebrow">ALL ABOARD · ALL TOGETHER</div><h2>全员返航</h2><p class="panel-lead">这一次，把数据和队友都带了回来。</p><div class="campaign-summary"><div class="grade-seal">${esc(campaign.grade || (total >= 450 ? 'S' : total >= 375 ? 'A' : 'B'))}</div><div><span>魔盗团总评分</span><strong>${total}<small> / 500</small></strong></div></div><div class="result-metrics"><span>完整航程<b>${clock(elapsed)}</b></span><span>完成章节<b>${results.length} / 5</b></span><span>历史暴露<b>${campaign.historyExposure ?? results.reduce((sum, item) => sum + (item.exposureDelta || 0), 0)}</b></span></div><div class="investigation-note"><span>调查笔录 / 摘录</span><p>“广播留下了 ${publicCommands} 次指令记录，现场响起 ${alarms} 次警报。”</p><p>DeepSeek：“下次出发前，先检查一下我们的设置。”</p></div><div class="result-actions">${button('title', '返回主菜单')}${button('chapter-select', '章节挑战', 'primary')}</div></section>`;
  }

  #renderCommand() {
    const world = this.view?.world || {};
    const core = this.view?.core || {};
    const preview = world.commandPreview || this.payload.commandPreview || null;
    const name = preview?.teammate || world.selected || this.payload.teammate || 'Grok';
    const defaults = DEFAULTS[name] || DEFAULTS.Grok;
    const remaining = Math.max(0, (core.attempt?.readyAtMs?.[name] || 0) - (core.attempt?.elapsedMs || 0));
    const available = Boolean(preview?.targetId) && preview?.available !== false && remaining <= 0;
    const qualifiers = core.attempt?.qualifiers || 0;
    const unavailableReason = preview?.reason || (remaining > 0 ? `${name} 还需要 ${Math.ceil(remaining / 1000)} 秒恢复。` : '');
    this.menu.innerHTML = `<div class="command-dimmer"></div><section class="command-panel" role="dialog" aria-modal="true" aria-label="${esc(name)} 的指令"><div class="command-header"><img src="${portrait(name)}" alt=""><div><small>小队指令 · ${JOBS[name] || ''}</small><h2>${esc(name)}</h2></div><button type="button" class="icon-button" data-action="command-cancel" aria-label="取消指令">${icon('close')}</button></div><div class="command-target"><span>当前目标</span><strong>${esc(preview?.label || '点击场景中的高亮目标')}</strong>${preview?.description ? `<p>${esc(preview.description)}</p>` : ''}${!available && unavailableReason ? `<p class="command-warning" role="status">${esc(unavailableReason)}</p>` : ''}</div><div class="command-options"><button type="button" data-action="command-confirm" data-precise="false" ${available ? '' : 'disabled'}><span class="command-option-heading"><b>整片开路</b><em>AI Token × 1</em></span><p>${esc(defaults[0])}</p><strong>范围较宽 →</strong></button><button type="button" class="precise-option" data-action="command-confirm" data-precise="true" ${available && qualifiers > 0 ? '' : 'disabled'}><span class="command-option-heading"><b>只开此处</b><em>${icon('token')} × 1 · 限定词 × 1</em></span><p>${esc(defaults[1])}</p><strong>${qualifiers > 0 ? '范围更准 →' : '限定词不足'}</strong></button></div><p class="command-footer">${preview ? '确认前可以在场景中切换目标。' : '先选择一个目标，再确认行动。'} <span>Esc 取消</span></p></section>`;
  }

  resetFeedback() {
    clearTimeout(this.toastTimer); clearTimeout(this.dialogueTimer);
    this.toasts.classList.remove('is-visible'); this.toasts.textContent='';
    this.dialogues.classList.remove('is-visible'); this.dialogues.hidden=true;
  }

  toast(text) {
    clearTimeout(this.toastTimer);
    this.toasts.textContent = this.v3.hint(text);
    this.toasts.classList.add('is-visible');
    this.toastTimer = setTimeout(() => this.toasts.classList.remove('is-visible'), 3400);
  }

  dialogue(character, text) {
    if (['story', 'briefing'].includes(this.screen)) return;
    clearTimeout(this.dialogueTimer);
    this.dialogueAt = Date.now();
    this.dialogues.innerHTML = `<img src="${portrait(character || 'DeepSeek')}" alt=""><div><b>${esc(character || 'DeepSeek')}</b><p>${esc(this.v3.hint(text))}</p></div><span>▼</span>`;
    this.dialogues.hidden = this.screen !== 'none';
    this.dialogues.classList.add('is-visible');
    this.dialogueTimer = setTimeout(() => this.dialogues.classList.remove('is-visible'), 6000);
  }

  setLoading(progress, label = '正在准备这次行动…') {
    clearTimeout(this.loadingTimer);
    const value = Math.max(0, Math.min(1, Number(progress) || 0));
    this.loading.querySelector('i').style.width = `${value * 100}%`;
    this.loading.querySelector('p').textContent = label;
    this.loading.querySelector('.loading-recovery').hidden = !/失败|错误|无法读取/.test(label);
    this.loading.classList.toggle('is-complete', value >= 1);
    if (value >= 1) this.loadingTimer = setTimeout(() => { this.loading.hidden = true; }, 320);
    else this.loading.hidden = false;
  }
}
