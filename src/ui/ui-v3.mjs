import { CHAPTERS } from '../core/chapters.mjs';
import { storyBeatFor, storyArtFor, comicFrameFor } from '../game/story-art.mjs';
import { AssetLibrary } from '../render/assets.mjs';
import { rasterIconHTML, applyRasterIcon } from './raster-icons.mjs';

// Keep narrative atlas loading separate from dialogue state. A slow image never
// pauses the story, and the DOM-only verification harness needs no Image/fetch.
let storyAssetsPromise;
function loadStoryAssets() {
  if (typeof globalThis.Image !== 'function' || typeof globalThis.fetch !== 'function') return null;
  if (!storyAssetsPromise) storyAssetsPromise = (async () => {
    const catalogURL = new URL('../../assets/runtime-catalog.json', import.meta.url);
    const response = await fetch(catalogURL);
    if (!response.ok) throw new Error(`Story atlas: HTTP ${response.status}`);
    const library = new AssetLibrary(await response.json(), catalogURL);
    await library.preload(['deepseek-actions', 'grok-actions', 'claude-actions', 'glm-actions', 'water-dash-atlas', 'axe-impact-atlas', 'paper-decoy-atlas', 'scan-grid-atlas']);
    return library;
  })().catch(() => null);
  return storyAssetsPromise;
}

export const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const esc = escapeHTML;
// URLs substituted into CSS custom properties resolve at the consuming style
// sheet. Make them absolute so nested UI sheets cannot relocate the asset.
export const cssAssetURL = path => new URL(path, globalThis.document?.baseURI || new URL('../../index.html', import.meta.url)).href;
const TEAM = ['Grok', 'Claude', 'GLM'];
const JOBS = { Grok: '破障', Claude: '诱饵', GLM: '扫描', DeepSeek: '行动队长' };
const LABELS = { left: '向左', right: '向右', up: '爬梯向上', down: '爬梯向下', jump: '跳跃', dash: '冲刺', interact: '互动' };
export const SETTINGS_DEFAULTS = Object.freeze({ masterVolume: .65, sfxVolume: .8, musicVolume: .25, subtitleScale: 1, reduceMotion: false, reduceFlashes: false, tacticalPause: true, tutorialHints: true, touchSize: 1, touchOpacity: .75, leftHanded: false, interactionMode: 'hold', textSpeed: 32, autoDialogue: false, skipSeenStory: true, storyStyle: 'cinematic', quality: 'standard', bindings: { left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS', jump: 'Space', dash: 'ShiftLeft', interact: 'KeyE' } });
export function normalizedSettings(value = {}) { const source = value && typeof value === 'object' ? value : {}; return { ...SETTINGS_DEFAULTS, ...source, bindings: { ...SETTINGS_DEFAULTS.bindings, ...source.bindings } }; }
export function keyLabel(code = '') { return ({ Space: '空格', ShiftLeft: '左 Shift', ShiftRight: '右 Shift', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Enter: 'Enter', Escape: 'Esc' })[code] || String(code).replace(/^Key/, '').replace(/^Digit/, ''); }
export function formatControlHints(text, preferences = {}, touch = false) {
  const bindings = normalizedSettings(preferences).bindings;
  const names = { A: 'left', D: 'right', W: 'up', S: 'down', E: 'interact', J: 'dash', Shift: 'dash', Space: 'jump', 空格: 'jump' };
  const touchNames = { left: '向左按钮', right: '向右按钮', up: '向上爬梯按钮', down: '向下爬梯按钮', interact: '互动按钮', dash: '冲刺按钮', jump: '跳跃按钮' };
  return String(text || '').replace(/A\s*[/／、]\s*D|W\s*[/／、]\s*S|←\s*[/／、]\s*→|↑\s*[/／、]\s*↓|\b(?:Shift|Space|A|D|W|S|E|J)\b|空格/g, (token) => {
    if (/^[A←]/.test(token) && /D|→/.test(token)) return touch ? '左右移动按钮' : `${keyLabel(bindings.left)} / ${keyLabel(bindings.right)}`;
    if (/^[W↑]/.test(token) && /S|↓/.test(token)) return touch ? '上下爬梯按钮' : `${keyLabel(bindings.up)} / ${keyLabel(bindings.down)}`;
    const action = names[token]; return action ? touch ? touchNames[action] : keyLabel(bindings[action]) : token;
  });
}
export function formatTime(milliseconds = 0) { const n = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000)); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; }
export function storyBackdrop(value) { const name = String(value || 'menu-background'); const aliases = {
  'boat-interior': 'menu-background', 'harbor-dock': 'menu-background', 'rendezvous-front': 'menu-background',
  'harbor-server': 'gameplay-backdrop', 'recruitment-hall': 'gameplay-backdrop', 'sorting-room': 'gameplay-backdrop',
  'inspection-bridge': 'gameplay-backdrop', 'audit-pipes': 'gameplay-backdrop', 'broadcast-room': 'gameplay-backdrop',
  'record-screen': 'gameplay-backdrop', 'rendezvous-beacon': 'gameplay-backdrop', 'remote-beacon': 'gameplay-backdrop',
  'return-boat': 'results-background', 'investigation-desk': 'results-background', epilogue: 'results-background',
  // Story-only keyframes generated for the narrative beats. These are full
  // raster scenes, so every presentation style shares the same authored art.
  'story-prologue': 'story/prologue-paper-window.png', 'story-grok': 'story/grok-paper-window.png',
  'story-broadcast': 'story/broadcast-reveal.png', 'story-evacuation': 'story/evacuation-beacon.png',
  'story-epilogue': 'story/investigation-epilogue.png'
}; return /^assets\/[\w\-/]+\.(png|jpg|webp)$/.test(name) ? name : aliases[name]?.includes('/') ? `assets/${aliases[name]}` : `assets/backgrounds/${aliases[name] || (['menu-background', 'gameplay-backdrop', 'results-background'].includes(name) ? name : 'menu-background')}.png`; }
export function portraitPath(name) { return `assets/portraits/${['deepseek', 'grok', 'claude', 'glm'].includes(String(name).toLowerCase()) ? String(name).toLowerCase() : 'deepseek'}-portrait.png`; }
export function receiptText(value) { if (typeof value === 'string') return value; if (value && typeof value === 'object') return value.text || value.summary || value.message || value.label || Object.entries(value).filter(([, v]) => typeof v === 'number').map(([k, v]) => `${k} ${v}`).join(' · '); return ''; }
export function commandModel(view = {}, payload = {}) {
  const preview = view.world?.commandPreview || payload.commandPreview || {};
  const teammate = preview.teammate || view.world?.selected || payload.teammate || 'Grok';
  const attempt = view.core?.attempt || {};
  const remaining = Math.max(0, ((attempt.readyAtMs?.[teammate] || 0) - (attempt.elapsedMs || 0)) / 1000);
  const precise = Boolean(preview.precise);
  const cost = Number(preview.cost ?? (precise ? 1 : 0));
  const tokenCost = Math.max(1, Number(preview.tokenCost ?? (precise ? 2 : 1)));
  const aiTokens = Math.max(0, Number(attempt.aiTokens ?? preview.aiTokens ?? 0));
  const aiTokenMax = Math.max(1, Number(attempt.aiTokenMax ?? preview.aiTokenMax ?? 12));
  const budget = Number(attempt.qualifiers || 0);
  const trainingAvailable = Math.max(0, Number(preview.trainingAvailable || 0));
  const trainingCost = Math.max(0, Number(preview.trainingCost || 0));
  const reason = preview.parseError ? String(typeof preview.parseError === 'string' ? preview.parseError : preview.parseError.message || '这句指令还不能识别，请改用下面的卡片。') : preview.reason || (remaining > 0 ? `队友恢复中，还需 ${Math.ceil(remaining)} 秒。` : cost > budget || trainingCost > trainingAvailable ? '限定词不足，可使用默认范围。' : aiTokens < tokenCost ? `AI Token 不足：需要 ${tokenCost}，当前 ${aiTokens}。先收集补给或完成分析。` : !preview.targetId ? '请选择一个高亮目标。' : '');
  return { ...preview, teammate, precise, constrained: Boolean(preview.constraintId) || cost > 0 || trainingCost > 0 || precise, cost, budget, trainingAvailable, trainingCost, remaining, tokenCost, aiTokens, aiTokenMax, reason, canConfirm: Boolean(preview.targetId) && preview.available !== false && !preview.parseError && remaining <= 0 && cost <= budget && trainingCost <= trainingAvailable && aiTokens >= tokenCost, targets: Array.isArray(preview.targets) ? preview.targets : [], constraints: Array.isArray(preview.constraints) ? preview.constraints : [], conditions: Array.isArray(preview.conditions) ? preview.conditions : [] };
}
export function normalizeRecord(value = {}) {
  return { id: value.id || '', teammate: value.teammate || '小队', text: value.promptText || value.text || value.label || value.type || '行动记录', outcome: receiptText(value.receipt || value.outcome), time: typeof value.time === 'string' ? value.time : formatTime(value.elapsedMs ?? (Number(value.time) || 0) * 1000), published: Boolean(value.public ?? value.broadcastOn), chapter: value.chapter?.name || value.chapter || '', room: value.room?.name || value.room || '' };
}
const ico = rasterIconHTML;
const btn = (action, text, type = '', attrs = '') => `<button type="button" class="game-button ${type}" data-action="${action}" ${attrs}>${text}</button>`;
// Small authored PNG marks keep dense navigation scannable. The full label
// remains in aria-label/title so keyboard and screen-reader users retain the
// same meaning while the visual surface can lead with the artwork.
const artMark = (kind, label = '') => rasterIconHTML(kind, `art-mark art-mark--${String(kind || 'map').replace(/[^a-z0-9_-]/gi, '')}`);
const actionBtn = (action, label, kind, type = '', attrs = '') => btn(action, `${artMark(kind, label)}<span class="action-label">${label}</span>`, type, `${attrs}${/aria-label=/i.test(attrs) ? '' : ` aria-label="${esc(label)}"`}`);
const artButton = (action, label, kind, type = '', attrs = '') => btn(action, label, `${type} art-action`, `${attrs} data-art-kind="${esc(kind)}" aria-label="${esc(label)}"`);
const optionId = (item) => typeof item === 'string' ? item : item.id ?? item.targetId ?? item.value ?? '';
const optionLabel = (item) => typeof item === 'string' ? item : item.label || item.name || item.title || item.id || '';
const list = (value) => Array.isArray(value) ? value : [];
const optionalGoalItems = (goals) => list(goals).map((goal) => `<li class="${goal.complete ? 'is-complete' : ''}"><span>${goal.complete ? '✓' : '◇'}</span>${esc(goal.label)}${goal.required !== undefined ? `<b>${goal.current || 0}/${goal.required}</b>` : ''}</li>`).join('');
// The compact HUD has room for one short action only. Keep the full wording in
// the map/briefing panels, and use these concise labels for the always-visible
// objective toggle.
const compactObjective = (label = '') => ({
  '交付必需数据': '交付资料', '交付两份任务物': '交付档案', 'Grok 打开纸窗': '打开纸窗',
  '完成诱饵或破障路线': '开路', '完成扫描或打开回程': '复查', '关闭或验证广播已关闭': '关闭广播',
  '设置返航信标': '设置信标', '三名队友在远端信标到齐': '队友到齐', '在远端接应并装载最后三块': '装载资料',
  '完成一项协作或保底返航': '完成协作', '确认准备撤离': '确认撤离', '交付可选档案': '可选档案',
  '收集可选撤离补给': '可选补给', '收集本章调查线索': '收集线索', '分析全部调查线索': '分析线索',
  '采用至少一项修复建议': '选修复建议',
}[String(label)] || String(label));

/** V3 screen/controller extension. The original GameUI API remains the integration boundary. */
export class UIV3Controller {
  constructor(ui) {
    this.ui = ui;
    this.settingsTab = 'audio'; this.archiveTab = 'stories'; this.moreCommand = false; this.forecastOpen = false;
    this.view = {}; this.settings = normalizedSettings(); this.lastStoryKey = ''; this.forceStoryText = false; this.storyHistory = []; this.storySessionActive = false;
    this.handled = new Set(['title', 'pause', 'help', 'chapter-select', 'settings', 'story', 'briefing', 'archive', 'records', 'map', 'analysis', 'confirm-new', 'failure', 'contracts', 'command', 'chapter-result', 'campaign-result']);
    ui.menu.addEventListener('input', (event) => this.formChange(event));
    ui.menu.addEventListener('change', (event) => this.formChange(event));
    ui.menu.addEventListener('keydown', (event) => this.keydown(event));
    this.ensureHUD();
  }

  ensureHUD() {
    const root = this.ui.root;
    root.insertAdjacentHTML('beforeend', `<button class="hud-map-button" data-action="map-open" type="button" aria-label="房间总览">${artMark('map')}<span class="action-label">航图</span></button><button class="objective-toggle" type="button" data-action="ui-objectives" aria-expanded="false" aria-label="任务清单">${artMark('objective')}<span class="action-label">任务清单</span> <span data-v3="objective-summary"></span></button><section class="tutorial-card" hidden aria-label="当前目标"><div class="tutorial-top"><span data-v3="tutorial-title"></span><small data-v3="tutorial-count"></small></div><p data-v3="tutorial-text"></p><div class="tutorial-actions">${btn('tutorial-hint', '需要提示', 'text-button')}</div><div class="tutorial-rail"><i></i></div></section><div class="room-chip" data-v3="room-chip"></div>`);
    const strip = root.querySelector('.keyboard-strip'); if (strip) strip.dataset.v3 = 'key-strip';
    root.querySelector('.objective-panel')?.insertAdjacentHTML('beforeend', '<section class="optional-objectives-hud" hidden><h3>可选支线</h3><ul class="map-objectives" data-v3="optional-objectives"></ul><small>不影响主线通关</small></section>');
  }

  dispatch(action, element) {
    if (action.startsWith('ui-')) {
      if (action === 'ui-setting-tab') { this.settingsTab = element.dataset.tab; this.renderSettings(); this.ui.menu.querySelector(`[data-action="ui-setting-tab"][data-tab="${this.settingsTab}"]`)?.focus({ preventScroll: true }); }
      if (action === 'ui-archive-tab') { this.archiveTab = element.dataset.tab; this.renderArchive(); this.ui.menu.querySelector(`[data-action="ui-archive-tab"][data-tab="${this.archiveTab}"]`)?.focus({ preventScroll: true }); }
      if (action === 'ui-command-more') { this.moreCommand = !this.moreCommand; this.ui.menu.querySelector('.command-advanced').hidden = !this.moreCommand; this.ui.menu.querySelector('.v3-command-panel').classList.toggle('is-expanded', this.moreCommand); element.setAttribute('aria-expanded', String(this.moreCommand)); }
      if (action === 'ui-command-forecast') { this.forecastOpen = !this.forecastOpen; const panel = this.ui.menu.querySelector('.command-forecast'); if (panel) panel.hidden = !this.forecastOpen; element.setAttribute('aria-expanded', String(this.forecastOpen)); this.ui.menu.querySelector('.v3-command-panel')?.classList.toggle('has-forecast', this.forecastOpen); }
      if (action === 'ui-objectives') {
        const expanded = this.ui.root.classList.toggle('objectives-expanded');
        element.setAttribute('aria-expanded', String(expanded));
        const panel = this.ui.root.querySelector('.objective-panel');
        if (panel) panel.hidden = !expanded;
        this.syncOptionalObjectives();
      }
      if (action === 'ui-fullscreen') { const call = document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.(); call?.catch?.(() => this.ui.toast('当前浏览器暂不支持全屏，请使用横屏。')); }
      if (action === 'ui-story-history') { const history = this.ui.menu.querySelector('.story-history'); if (history) history.hidden = !history.hidden; }
      return true;
    }
    const payload = {};
    for (const key of ['teammate', 'chapterId', 'sceneId', 'targetId', 'clueId', 'repairId', 'constraintId', 'templateId', 'contractId', 'choiceId', 'from']) if (element.dataset[key] !== undefined) payload[key] = element.dataset[key];
    if (action === 'story-style' && element.dataset.style) payload.style = element.dataset.style;
    if (element.dataset.precise !== undefined) payload.precise = element.dataset.precise === 'true';
    if (action === 'settings-open') payload.from = this.ui.screen;
    if (action === 'bind-key') payload.action = element.dataset.binding;
    if (action === 'command-confirm') payload.precise = commandModel(this.view, this.ui.payload).precise;
    if (action === 'prompt-parse') payload.text = this.ui.menu.querySelector('[data-command-text]')?.value || '';
    if (action === 'save-import') payload.text = this.ui.menu.querySelector('[data-import-text]')?.value || '';
    if (action === 'story-next' && this.ui.screen === 'story' && !this.forceStoryText && this.revealedCharacters < (this.currentStory?.text || '').length) { this.forceStoryText = true; this.syncStory(); return true; }
    if (action === 'challenge-start' && !payload.contractId) payload.contractId = this.ui.payload.contractId || this.view.contractId || 'standard';
    this.ui.onAction(action, payload); return true;
  }

  formChange(event) {
    const element = event.target;
    if (element.dataset.setting) {
      if (event.type === 'input' && element.type !== 'range') return;
      if (event.type === 'change' && element.type === 'range') return;
      const value = element.type === 'checkbox' ? element.checked : element.type === 'range' || element.dataset.number ? Number(element.value) : element.value;
      this.ui.onAction('settings-change', { key: element.dataset.setting, value });
      const output = element.closest('.setting-row')?.querySelector('output'); if (output) output.textContent = this.settingValue(element.dataset.setting, value);
    }
    if (event.type === 'change' && element.dataset.commandSelect) this.ui.onAction(element.dataset.commandSelect, { [element.dataset.payloadKey]: element.value });
  }

  keydown(event) {
    if (this.view.bindingAction) return;
    const form = event.target.closest('input,textarea,select,[contenteditable="true"]');
    const nativeControl = form || event.target.closest('button,a[href]');
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (event.repeat) return; const history = this.ui.menu.querySelector('.story-history'); if (history && !history.hidden) { history.hidden = true; return; } this.ui.onAction(this.ui.screen === 'command' ? 'command-cancel' : this.ui.screen === 'confirm-new' ? 'new-game-cancel' : this.ui.screen === 'pause' ? 'resume-play' : 'overlay-back', {}); return; }
    if (this.ui.screen === 'command' && event.key === 'Enter' && !nativeControl) {
      event.preventDefault(); event.stopPropagation(); const model = commandModel(this.view, this.ui.payload); if (!event.repeat && model.canConfirm) this.ui.onAction('command-confirm', { precise: model.precise });
    }
    if (this.ui.screen === 'story' && event.code === 'Space' && !nativeControl) { event.preventDefault(); event.stopPropagation(); if (!event.repeat) this.dispatch('story-next', { dataset: {} }); }
  }

  syncOptionalObjectives() {
    const root = this.ui.root, optional = root.querySelector('.optional-objectives-hud');
    if (!optional) return;
    const goals = list(this.view.core?.optionalObjectives);
    optional.hidden = !root.classList.contains('objectives-expanded') || !goals.length;
    const signature = JSON.stringify(goals);
    if (signature !== this.optionalObjectiveSignature) { this.optionalObjectiveSignature = signature; root.querySelector('[data-v3="optional-objectives"]').innerHTML = optionalGoalItems(goals); }
  }

  update(view) {
    this.view = view || {}; this.settings = normalizedSettings(this.view.settings);
    this.isTouch = Boolean(globalThis.matchMedia?.('(hover: none), (pointer: coarse)').matches);
    const root = this.ui.root, shell = document.getElementById('game-shell');
    shell.style.setProperty('--subtitle-scale', this.settings.subtitleScale);
    shell.style.setProperty('--touch-size', this.settings.touchSize);
    shell.style.setProperty('--touch-opacity', this.settings.touchOpacity);
    shell.dataset.handed = this.settings.leftHanded ? 'left' : 'right';
    shell.dataset.quality = this.settings.quality;
    shell.classList.toggle('reduce-flashes', this.settings.reduceFlashes);
    document.documentElement.classList.toggle('reduce-motion', this.settings.reduceMotion);
    const world = this.view.world || {}, core = this.view.core || {};
    const chapterKey = core.chapter?.id || core.chapter?.number || '';
    if (chapterKey && chapterKey !== this.objectiveChapterKey) {
      this.objectiveChapterKey = chapterKey;
      root.classList.remove('objectives-expanded');
      root.querySelector('.objective-toggle')?.setAttribute('aria-expanded', 'false');
    }
    this.syncOptionalObjectives();
    const objective = list(core.objectives).find((item) => !item.complete);
    const objectiveText = compactObjective(objective?.label || '任务完成，返回鲸艇');
    this.text(root, 'objective-summary', objectiveText);
    const room = world.room;
    this.text(root, 'room-chip', room ? `${room.name || ''}${room.total ? `  ${Number(room.index ?? 1)}/${room.total}` : ''}` : '');
    const tutorial = this.view.tutorial, card = root.querySelector('.tutorial-card');
    // The tutorial card is a first-minute guide, not a permanent second task
    // list. Once the verified tutorial is complete, the scene keeps only the
    // compact objective toggle and interaction affordance visible.
    const guided = Boolean(tutorial && !tutorial.complete && this.settings.tutorialHints);
    card.hidden = this.ui.screen !== 'none' || !core.chapter || !guided;
    const objectiveToggle = root.querySelector('.objective-toggle');
    if (objectiveToggle) {
      // While the tutorial is active its card is the single source of truth;
      // after that, the toggle is the only persistent objective summary.
      objectiveToggle.hidden = this.ui.screen !== 'none' || guided;
      objectiveToggle.setAttribute('aria-label', objective ? `当前目标：${objectiveText}` : '当前目标：任务完成，返回鲸艇');
    }
    const objectivePanel = root.querySelector('.objective-panel');
    if (objectivePanel) {
      // Full checklist is opt-in. This prevents the same goal from appearing
      // in both the HUD panel and the compact summary by default.
      objectivePanel.hidden = this.ui.screen !== 'none' || !root.classList.contains('objectives-expanded');
    }
    const keyStrip = root.querySelector('[data-v3="key-strip"]');
    if (keyStrip) keyStrip.hidden = this.ui.screen !== 'none' || !guided || this.isTouch;
    if (!card.hidden) {
      this.text(card, 'tutorial-title', '当前目标');
      this.text(card, 'tutorial-text', formatControlHints(guided ? tutorial.text : world.message || objective?.label || '回到鲸艇，松开后再次按住互动登艇。', this.settings, this.isTouch));
      this.text(card, 'tutorial-count', guided ? `${Math.min(Number(tutorial.step || 0) + 1, tutorial.total || 1)} / ${tutorial.total || 1}` : '');
      card.querySelector('.tutorial-actions').hidden = !guided;
      card.querySelector('.tutorial-rail').hidden = !guided;
      card.querySelector('.tutorial-rail i').style.width = `${Math.min(100, Number(tutorial?.step || 0) / (tutorial?.total || 1) * 100)}%`;
    }
    const tool = tutorial && tutorial.hintLevel >= 2 ? tutorial.guide?.control || ({ 0: 'right', 1: 'up', 2: 'jump', 3: 'dash', 8: 'interact', 9: 'interact' })[tutorial.guide?.index] : null;
    root.querySelectorAll('[data-control]').forEach(button => button.classList.toggle('is-guide-target', Boolean(tool && button.dataset.control === tool)));
    root.querySelectorAll('.crew-button').forEach(button => button.classList.toggle('is-guide-target', tutorial?.hintLevel >= 2 && (tutorial.guide?.index === 4 || tool === 'command') && button.dataset.teammate === 'Grok'));
    const keyIndex = ({ right: 0, up: 2, jump: 1, dash: 3, interact: 4 })[tool];
    root.querySelectorAll('.keyboard-strip>span').forEach((span, index) => span.classList.toggle('is-guide-target', index === keyIndex));
    const message = this.hint(world.message || ''); if (this.ui.fields.message.textContent !== message) this.ui.fields.message.textContent = message;
    // Nearby interaction has a dedicated affordance. Suppress transient world
    // text at the same time so the player never sees two competing prompts.
    this.ui.fields.message.hidden = !message || Boolean(world.nearby);
    if (message && message === this.ui.toasts.textContent && this.ui.toasts.classList.contains('is-visible')) this.ui.fields.message.hidden = true;
    const keycap = root.querySelector('.interaction-hint .keycap'); if (keycap) keycap.textContent = this.isTouch ? '互动' : keyLabel(this.settings.bindings.interact);
    const interact = root.querySelector('.touch-interact'); if (interact?.firstChild?.nodeType === 3) interact.firstChild.textContent = '◇';
    const movementSide = this.settings.leftHanded ? '右侧' : '左侧', actionSide = this.settings.leftHanded ? '左侧' : '右侧';
    const canvas = document.getElementById('game-canvas');
    const aria = this.isTouch ? `鲸鱼魔盗团游戏画面。使用屏幕${movementSide}方向按钮移动和爬梯，${actionSide}跳跃、冲刺、互动按钮行动；点击队友头像编排指令。` : `鲸鱼魔盗团游戏画面。使用 ${keyLabel(this.settings.bindings.left)} 和 ${keyLabel(this.settings.bindings.right)} 移动，${keyLabel(this.settings.bindings.up)} 和 ${keyLabel(this.settings.bindings.down)} 爬梯，${keyLabel(this.settings.bindings.jump)} 跳跃，${keyLabel(this.settings.bindings.dash)} 冲刺，${keyLabel(this.settings.bindings.interact)} 互动，1、2、3 选择队友，Enter 确认指令，Esc 暂停或返回。`;
    if (canvas.getAttribute('aria-label') !== aria) canvas.setAttribute('aria-label', aria);
    const strip = root.querySelector('[data-v3="key-strip"]');
    const signature = JSON.stringify(this.settings.bindings);
    if (strip && signature !== this.keySignature) { this.keySignature = signature; strip.innerHTML = [['left', 'right'], ['jump'], ['up', 'down'], ['dash'], ['interact']].map((keys, index) => `<span>${keys.map((key) => `<kbd>${esc(keyLabel(this.settings.bindings[key]))}</kbd>`).join('')} ${['移动', '跳跃', '爬梯', '冲刺', '互动'][index]}</span>`).join('') + '<span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 指令</span>'; }
    if (this.ui.screen === 'command') this.syncCommand();
    if (this.ui.screen === 'story') this.syncStory();
    if (this.ui.screen === 'settings') this.syncSettings();
    if (this.ui.screen === 'contracts') this.syncContracts();
  }

  text(root, name, value) { const field = root.querySelector(`[data-v3="${name}"]`); if (field && field.textContent !== String(value ?? '')) field.textContent = value ?? ''; }
  hint(value) { const text = String(value || ''); return /按(?:住|下)?\s*(?:[ADWSEJ]|Shift|Space|空格)|[ADWSEJ]\s*[/／]\s*[ADWSEJ]|(?:Shift|空格|Space).{0,8}(?:跳|冲)|(?:键位|按键|按钮)/.test(text) ? formatControlHints(text, this.settings, this.isTouch) : text; }
  screen(screen, payload) { if (screen !== 'story') this.storySessionActive = false; if (!this.handled.has(screen)) return false; this.ui.menu.dataset.v3Screen = screen; const renderers = { title: 'renderTitle', pause: 'renderPause', help: 'renderHelp', 'chapter-select': 'renderChapters', settings: 'renderSettings', story: 'renderStory', briefing: 'renderBriefing', archive: 'renderArchive', records: 'renderRecords', map: 'renderMap', analysis: 'renderAnalysis', 'confirm-new': 'renderConfirm', failure: 'renderFailure', contracts: 'renderContracts', command: 'renderCommand', 'chapter-result': 'renderChapterResult', 'campaign-result': 'renderCampaignResult' }; if (renderers[screen]) this[renderers[screen]](payload); return true; }
  panel(eyebrow, title, body, className = '', footer = '') { this.ui.menu.innerHTML = `<div class="screen-shade"></div><section class="menu-panel v3-panel ${className}" role="dialog" aria-modal="true"><div class="panel-ornament"></div><header class="v3-panel-heading"><div><div class="panel-eyebrow">${eyebrow}</div><h2>${title}</h2></div><button type="button" class="icon-button v3-back" data-action="${this.ui.screen === 'pause' ? 'resume-play' : 'overlay-back'}" aria-label="${this.ui.screen === 'pause' ? '继续行动' : '返回'}">${ico('close')}</button></header><div class="v3-panel-body">${body}</div>${footer ? `<footer class="v3-panel-footer">${footer}</footer>` : ''}</section>`; }

  renderTitle() {
    const summary = this.view.saveSummary || this.ui.payload || {};
    const hasSave = Boolean(summary.hasSave ?? this.ui.payload.hasSave);
    const completed = Boolean(summary.completed ?? this.ui.payload.completed);
    const chapterNumber = Math.max(1, Number(summary.chapterNumber || this.view.core?.chapter?.number || 1));
    const primaryLabel = completed ? '再次出发' : hasSave ? '继续行动' : '开始行动';
    const primaryAction = completed ? 'chapter-select' : hasSave ? 'resume' : 'new-game';
    const primary = btn(primaryAction, esc(primaryLabel), 'primary', `aria-label="${esc(primaryLabel)}" data-focus="primary"`);
    const statusLabel = completed ? '航程已完成' : hasSave ? `进行中 · 第 ${chapterNumber} 章` : '尚未出发';
    const crew = [
      ['DeepSeek', '指挥', completed ? '返航完成' : hasSave ? '行动中' : '待命'],
      ['Grok', '破障', chapterNumber >= 1 ? '可调度' : '待加入'],
      ['Claude', '诱饵', chapterNumber >= 2 ? '可调度' : '待加入'],
      ['GLM', '扫描', chapterNumber >= 3 ? '可调度' : '待加入'],
    ];
    const crewRail = crew.map(([name, job, state], index) => `<article class="title-crew-chip ${index === 0 ? 'is-lead' : ''}" style="--crew-index:${index}"><img src="${portraitPath(name)}" alt="${name}"><span><b>${name}</b><small>${job} · ${state}</small></span><i aria-hidden="true"></i></article>`).join('');
    this.ui.menu.innerHTML = `<div class="menu-backdrop v3-menu-backdrop" aria-hidden="true"></div><div class="title-signal-grid" aria-hidden="true"><i></i><i></i><i></i><i></i></div><img class="title-dock-overlay" src="assets/foreground/dock-rail-overlay-v3.png" alt="" aria-hidden="true"><img class="title-hero-ship" src="assets/foreground/whale-crew-hero-v2.png" alt="鲸艇与行动小队" aria-hidden="true"><section class="title-brand v3-title-brand" aria-labelledby="title-game-name"><div class="title-overline">DEEP BLUE OPERATION <span>· 1024 / ${String(chapterNumber).padStart(2, '0')}</span></div><img src="assets/ui/whale-emblem.png" alt="鲸艇徽记"><h1 id="title-game-name">鲸鱼魔盗团</h1><img class="title-ornament" src="assets/ui/title-ornament-v1.png" alt="" aria-hidden="true"><div class="title-status" role="status" aria-live="polite"><span class="title-status-dot ${completed ? 'is-complete' : hasSave ? 'is-active' : ''}" aria-hidden="true"></span><span><b>${esc(statusLabel)}</b></span></div><div class="title-actions" aria-label="主要行动">${primary}${hasSave ? btn('new-game', '重新开始', 'text-button title-restart', 'aria-label="重新开始航程"') : ''}</div><nav class="title-secondary" aria-label="航程工具">${actionBtn('chapter-select', '航图', 'map', 'secondary-action')}${actionBtn('settings-open', '设置', 'settings', 'secondary-action')}${actionBtn('archive-open', '档案', 'book', 'secondary-action')}</nav></section><section class="title-crew-rail" aria-label="行动小队状态"><div class="title-crew-rail-head"><span>行动小队</span><small>一同返航</small></div>${crewRail}</section>`;
  }

  renderPause() { const checkpoint = this.view.checkpoint || {}; this.panel('TAKE A BREATH', '行动暂停', `<p class="panel-lead">${esc(this.view.core?.chapter?.name || '')} · ${esc(this.view.world?.room?.name || '鲸艇航程')}</p><div class="pause-grid">${actionBtn('resume-play', '继续行动', 'play', 'primary')}${actionBtn('settings-open', '设置', 'settings')}${actionBtn('map-open', '航图', 'map')}${actionBtn('records-open', '记录', 'book')}${actionBtn('retry-checkpoint', '检查点', 'checkpoint', '', checkpoint.available ? '' : 'disabled')}${actionBtn('retry', '重试本章', 'retry')}${actionBtn('help', '指南', 'guide')}${actionBtn('title', '返回主菜单', 'home', 'text-button')}</div><p class="tiny-note">${checkpoint.available ? `最近检查点：${esc(checkpoint.label || '本章安全区域')}。` : '本章尚无检查点。'} 已完成章节会保留。</p>`, 'v3-pause'); }

  renderChapters() {
    const demo = Boolean(this.ui.payload.demoSelect), unlocked = demo ? 5 : Math.max(1, this.ui.payload.unlocked || this.view.unlocked || 1), best = this.ui.payload.best || {};
    const chapterArt = ['story/prologue-paper-window.png', 'story/grok-paper-window.png', 'story/broadcast-reveal.png', 'story/evacuation-beacon.png', 'story/investigation-epilogue.png'];
    this.panel(demo ? 'CHAPTER SHOWCASE' : 'CAMPAIGN MAP', demo ? '章节展示' : '章节航图', `<div class="chapter-mode-note">${demo ? '自由查看全部场景，不写入正式进度与成绩。' : '完成主线逐章解锁。挑战成绩独立记录，展示可自由查看场景。'}${!demo ? actionBtn('demo-select', '进入章节展示', 'map', 'text-button') : actionBtn('chapter-select', '返回正式章节', 'map', 'text-button')}</div><div class="v3-chapter-grid">${CHAPTERS.map((chapter) => { const locked = chapter.number > unlocked; const record = Array.isArray(best) ? best.find((item) => item.chapterId === chapter.id) : best[chapter.id]; const art = chapterArt[chapter.number - 1] || chapterArt[0]; return `<article class="v3-chapter-card ${locked ? 'is-locked' : ''}"><div class="chapter-card-art chapter-art-${chapter.number}" style="--chapter-art:url('${cssAssetURL(`assets/${art}`)}')"><span>${String(chapter.number).padStart(2, '0')}</span><i>${chapter.teammates.map((name) => `<img src="${portraitPath(name)}" alt="${name}">`).join('')}</i></div><div class="chapter-card-copy"><h3>${esc(chapter.name)}</h3><p>目标约 ${chapter.targetMinutes} 分钟 · ${chapter.number === 1 ? '破窗与合作' : chapter.number === 2 ? '诱饵与巡逻' : chapter.number === 3 ? '扫描与近路' : chapter.number === 4 ? '广播与旧记录' : '接应与撤离'}</p><small>${demo ? '场景展示 · 不计分' : locked ? '完成前一章后解锁' : record ? `最佳 ${esc(record.grade || '')} · ${record.score || 0} 分` : '等待一场漂亮行动'}</small>${actionBtn(demo ? 'demo-start' : 'contracts-open', demo ? '进入展示' : locked ? '尚未解锁' : '章节挑战', 'play', 'primary compact', `data-chapter-id="${chapter.id}" ${locked ? 'disabled' : ''}`)}</div></article>`; }).join('')}</div>`, 'v3-chapters', actionBtn('title', '返回鲸艇', 'home', 'text-button')); }

  renderConfirm() { const summary = this.view.saveSummary || {}; this.panel('START A NEW VOYAGE', '重新开始航程？', `<div class="confirm-art"><img src="${portraitPath('DeepSeek')}" alt=""></div><p class="panel-lead">将替换${summary.chapterNumber ? `第 ${summary.chapterNumber} 章「${esc(summary.chapterName)}」` : '当前'}的正式航程。<br>现有存档会自动保留一份备份。</p><p class="tiny-note">设置与已收藏的提示词不会改变。</p>`, 'v3-confirm', `${btn('new-game-cancel', '保留当前航程')}${btn('new-game-confirm', '确认重新出发', 'primary')}`); }

  renderHelp() {
    const settings=this.settings;
    const controls=Object.entries(LABELS).map(([action,label]) => `<div><dt>${ico(action)}<kbd>${esc(this.isTouch ? label : keyLabel(settings.bindings[action]))}</kbd></dt><dd>${esc(label)}</dd></div>`).join('');
    this.panel('FIELD GUIDE','行动指南',`<div class="v3-help-grid"><section><h3>亲自潜入</h3><dl>${controls}<div><dt>${TEAM.map(name=>`<img class="guide-portrait" src="${portraitPath(name)}" alt="${name}">`).join('')}</dt><dd>头像 / 1、2、3 选择队友</dd></div><div><dt><kbd>Enter</kbd><kbd>Esc</kbd></dt><dd>确认 / 返回</dd></div></dl></section><section class="guide-cards"><article>${ico('interact')}<div><h3>协作开路</h3><p>选队友 → 选目标 → 选范围 → 确认。</p><small>默认覆盖整片；限定词只处理目标。</small></div></article><article>${ico('dash')}<div><h3>取回资料</h3><p>蓝色节点要两次冲刺；Grok 一次撞开。</p><small>裂纹表示还差一次。</small></div></article><article>${ico('cube')}<div><h3>全员返航</h3><p>最多携带三份，回艇交付后再次互动登艇。</p><small>${settings.interactionMode==='toggle'?'点击互动开始，再点取消。':'按住互动直到完成。'}</small></div></article><details class="art-details"><summary>广播与记录</summary><p>广播开启时交货更快，也会公开新的记录。关闭后仍保留此前记录。</p></details></section></div>`, 'v3-help',`${btn('tutorial-restart','重看教程')}${btn('overlay-back','返回行动','primary')}`);
  }

  settingValue(key, value) { return ['masterVolume', 'sfxVolume', 'musicVolume', 'touchOpacity'].includes(key) ? `${Math.round(value * 100)}%` : ['subtitleScale', 'touchSize'].includes(key) ? `${Math.round(value * 100)}%` : key === 'textSpeed' ? `${value} 字/秒` : String(value); }
  range(key, label, min, max, step, hint = '') { const value = this.settings[key]; return `<label class="setting-row"><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span><input data-setting="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}"><output>${this.settingValue(key, value)}</output></label>`; }
  toggle(key, label, hint = '') { return `<label class="setting-row setting-toggle"><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span><input data-setting="${key}" type="checkbox" ${this.settings[key] ? 'checked' : ''}><i aria-hidden="true"></i></label>`; }
  select(key, label, options, hint = '') { return `<label class="setting-row"><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span><select data-setting="${key}">${options.map(([value, text]) => `<option value="${value}" ${this.settings[key] === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`; }
  renderSettings() {
    const tabs = [['audio', '声音'], ['controls', '操作'], ['accessibility', '阅读与辅助'], ['system', '存档与显示']];
    let body = '';
    if (this.settingsTab === 'audio') body = this.range('masterVolume', '总音量', 0, 1, .05) + this.range('musicVolume', '背景音乐', 0, 1, .05) + this.range('sfxVolume', '动作与界面音效', 0, 1, .05) + '<p class="setting-note">声音会在你首次操作后播放。离开此页时设置已保存。</p>';
    if (this.settingsTab === 'controls') body = `<div class="binding-list">${Object.entries(LABELS).map(([action, label]) => `<div class="binding-row"><span>${label}</span>${btn('bind-key', esc(keyLabel(this.settings.bindings[action])), 'compact key-binding', `data-binding="${action}"`)}</div>`).join('')}</div><div class="binding-notice" data-v3="binding-notice" hidden></div>` + this.range('touchSize', '触控按钮大小', 1, 1.4, .05, '命中区域始终至少 44 × 44') + this.range('touchOpacity', '触控按钮透明度', .35, 1, .05) + this.toggle('leftHanded', '左手操作布局', '移动与动作区域交换') + this.select('interactionMode', '互动方式', [['hold', '按住直到完成'], ['toggle', '点击开始，再点取消']]);
    if (this.settingsTab === 'accessibility') body = this.range('subtitleScale', '字幕与说明字号', 1, 1.5, .1) + this.range('textSpeed', '剧情文字速度', 12, 72, 4) + this.toggle('autoDialogue', '自动推进剧情') + this.toggle('skipSeenStory', '重玩时跳过已看剧情') + this.toggle('tacticalPause', '编排指令时暂停', '剧情体验生效；挑战遵循当前契约') + this.toggle('tutorialHints', '情境教学与卡住提示') + this.toggle('reduceMotion', '减少动态效果', '降低位移、晃动与粒子运动') + this.toggle('reduceFlashes', '降低闪烁效果', '保留危险形状和文字预警');
    if (this.settingsTab === 'system') body = this.select('storyStyle', '剧情演出风格', [['cinematic', '电影卡片式'], ['stage', '实景小剧场'], ['comic', '分镜动态漫画']], '三种演出风格，剧情和记录不变。') + this.select('quality', '画面效果', [['standard', '标准'], ['low', '轻量']]) + `<div class="setting-row"><span><b>全屏游玩</b><small>保持完整横版场景</small></span>${btn('ui-fullscreen', document.fullscreenElement ? '退出全屏' : '进入全屏', 'compact')}</div><details class="save-tools art-details"><summary>导入 / 导出航程</summary><p>导入前校验版本。</p>${btn('save-export', '导出航程', 'compact')}<label class="import-label">粘贴航程文件内容<textarea data-import-text spellcheck="false" placeholder="在这里粘贴导出的 JSON 内容" aria-label="导入存档内容"></textarea></label>${btn('save-import', '校验并导入', 'compact')}</details><div class="settings-reset">${btn('settings-reset', '恢复默认设置', 'text-button')}<span>仅恢复设置，不清空航程。</span></div>`;
    this.panel('MAKE YOURSELF AT HOME', '设置', `<nav class="v3-tabs" aria-label="设置类别">${tabs.map(([id, label]) => `<button type="button" data-action="ui-setting-tab" data-tab="${id}" aria-pressed="${this.settingsTab === id}">${label}</button>`).join('')}</nav><div class="settings-content">${body}</div>`, 'v3-settings', `<span class="autosave-note">即时生效 · 自动保存</span>${btn('settings-back', '完成', 'primary')}`); this.syncSettings();
  }
  syncSettings() { this.ui.menu.querySelectorAll('[data-setting]').forEach((element) => { const value = this.settings[element.dataset.setting]; if (element.type === 'checkbox') element.checked = Boolean(value); else if (document.activeElement !== element) element.value = value; const output = element.closest('.setting-row')?.querySelector('output'); if (output) output.textContent = this.settingValue(element.dataset.setting, value); }); const waiting = this.ui.menu.querySelector('[data-v3="binding-notice"]'); if (waiting) { waiting.hidden = !this.view.bindingAction; waiting.textContent = `请按一个按键，绑定「${LABELS[this.view.bindingAction] || ''}」；Esc 取消。`; } this.ui.menu.querySelectorAll('[data-binding]').forEach((button) => { button.textContent = keyLabel(this.settings.bindings[button.dataset.binding]); button.classList.toggle('is-waiting', button.dataset.binding === this.view.bindingAction); }); }

  renderBriefing() { const chapter = this.ui.payload.chapter || this.view.core?.chapter || {}; const goals = list(this.ui.payload.objectives || this.view.core?.objectives), optional = list(this.ui.payload.optionalObjectives || this.view.core?.optionalObjectives); this.panel(`NEXT PORT / CHAPTER ${String(chapter.number || 1).padStart(2, '0')}`, esc(chapter.name || '出发前的简报'), `<div class="briefing-layout"><div class="briefing-chart"><img src="assets/ui/whale-emblem.png" alt=""><span>观察 → 协作 → 返航</span><i class="chart-route"></i></div><div class="briefing-copy"><p>${esc(this.ui.payload.description || chapter.description || '带队取回资料，留好回程。')}</p><h3>这次要做的事</h3><ul>${goals.length ? goals.map((goal) => `<li>${esc(goal.label || goal)}</li>`).join('') : '<li>探索房间，取得任务数据</li><li>与队友协作，打开返航路径</li><li>回艇交付，全员登艇</li>'}</ul>${optional.length ? `<section class="briefing-optional"><h3>可选支线</h3><ul class="map-objectives">${optionalGoalItems(optional)}</ul><small>自行选择探索，不影响主线通关。</small></section>` : ''}<div class="briefing-crew">${list(chapter.teammates).map((name) => `<img src="${portraitPath(name)}" alt="${name}">`).join('')}</div><small>同章房间会保留队友、物品和机关。</small></div></div>`, 'v3-briefing', btn('briefing-start', '准备好了，出发 →', 'primary')); }

  storyState(story, restart = false) {
    const session = `${story.runId ?? ''}:${story.sceneId ?? ''}`;
    const key = `${session}:${story.index}:${story.text}`;
    if (restart || session !== this.storySessionId) {
      this.storyHistory = []; this.currentStory = null; this.lastStoryKey = ''; this.storySessionId = session;
    }
    if (key !== this.lastStoryKey) {
      if (this.currentStory?.text) this.storyHistory.push({ speaker: this.currentStory.speaker, text: this.currentStory.text, index: this.currentStory.index });
      this.currentStory = story; this.lastStoryKey = key; this.storyStart = performance.now(); this.forceStoryText = false;
    } else this.currentStory = story;
  }

  renderStory() {
    const story = this.view.story || this.ui.payload.story || this.ui.payload || {};
    const preserve = this.storySessionActive && this.storySessionId === `${story.runId ?? ''}:${story.sceneId ?? ''}`;
    const historyOpen = preserve && this.ui.menu.querySelector('.story-history')?.hidden === false;
    this.storyState(story, !preserve); this.storySessionActive = true;
    const style = ['cinematic', 'stage', 'comic'].includes(this.settings.storyStyle) ? this.settings.storyStyle : 'cinematic';
    const comic = style === 'comic';
    const styleButtons = `<nav class="story-style-switch" aria-label="剧情演出风格"><span>演出</span>${[['cinematic','电影'],['stage','实景'],['comic','分镜']].map(([id,label]) => btn('story-style', label, `story-style-button ${id === style ? 'is-active' : ''}`, `data-style="${id}" aria-pressed="${id === style}"`)).join('')}</nav>`;
    this.ui.menu.dataset.storyStyle = style;
    const stage = comic ? '<main class="comic-board" data-v3="comic-board" aria-label="完整三格分镜：观察、行动、结果"></main>' : `<div class="story-stage"><canvas class="story-stage-canvas" data-v3="story-stage-canvas" aria-hidden="true"></canvas><div class="story-orbit"></div><div class="story-fx-layer" aria-hidden="true"><i class="story-fx-beacon"></i><i class="story-fx-page"></i><i class="story-fx-water"></i><i class="story-fx-impact"></i><i class="story-fx-scan"></i><i class="story-fx-alert"></i><i class="story-fx-record"></i></div><img class="story-speaker" data-v3="story-portrait" src="${portraitPath(story.speaker)}" alt=""><img class="story-paper" src="assets/ui/whale-emblem.png" alt=""></div>`;
    this.ui.menu.innerHTML = `<div class="story-backdrop ${comic ? 'comic-backdrop' : ''}" style="background-image:url('${storyArtFor(story, comic ? 'stage' : style)}'),url('${storyBackdrop(story.backdrop)}')"></div><div class="${comic ? 'comic-shade' : 'story-shade'}"></div><header class="story-heading ${comic ? 'comic-heading' : ''}"><span data-v3="story-title">${esc(story.title || '鲸鱼魔盗团')}</span><small data-v3="story-count"></small>${styleButtons}${btn('ui-story-history', '对话历史', 'text-button')}${btn('story-skip', '跳过演出', 'text-button')}</header>${stage}<section class="story-dialogue ${comic ? 'comic-dialogue' : ''}" role="dialog" aria-label="剧情对话"><div class="story-speaker-name" data-v3="story-speaker"></div><p data-v3="story-text"></p><div class="story-choice" data-v3="story-choice"></div><div class="story-dialogue-footer"><span data-v3="story-auto-note">点击或按空格推进</span>${btn('story-next', '继续 →', 'primary')}</div></section><aside class="story-history" ${historyOpen ? '' : 'hidden'}><h3>本段对话</h3><div data-v3="story-history"></div></aside><div class="story-progress"><i></i></div>`;
    this.comicPageSignature = ''; this.storyChoiceSignature = ''; this.syncStory();
  }

  syncStory() {
    const story = this.view.story || this.ui.payload.story || this.ui.payload || {};
    this.storyState(story);
    const root = this.ui.menu, index = Math.max(0, Number(story.index) || 0), total = Math.max(1, Number(story.total) || 1);
    const style = ['cinematic', 'stage', 'comic'].includes(this.settings.storyStyle) ? this.settings.storyStyle : 'cinematic';
    root.dataset.storyBeat = storyBeatFor(story);
    const backdrop = root.querySelector('.story-backdrop'); if (backdrop) backdrop.style.backgroundImage = `url('${storyArtFor(story, style === 'comic' ? 'stage' : style)}'),url('${storyBackdrop(story.backdrop)}')`;
    this.text(root, 'story-title', story.title || '鲸鱼魔盗团'); this.text(root, 'story-count', `${index + 1} / ${total}`); this.text(root, 'story-speaker', story.speaker || 'DeepSeek');
    const image = root.querySelector('[data-v3="story-portrait"]'); if (image && image.getAttribute('src') !== portraitPath(story.speaker)) image.src = portraitPath(story.speaker);
    this.revealedCharacters = this.forceStoryText || this.settings.reduceMotion ? (story.text || '').length : Math.max(1, Math.floor((performance.now() - this.storyStart) / 1000 * this.settings.textSpeed));
    const visibleText = String(story.text || '').slice(0, this.revealedCharacters);
    this.text(root, 'story-text', visibleText);
    const stage = root.querySelector('.story-stage'); if (stage) {
      const motion = story.motion || {}; stage.dataset.pose = story.pose || 'idle'; stage.dataset.camera = motion.camera || 'hold'; stage.dataset.enter = motion.enter || 'fade'; stage.dataset.fx = Array.isArray(motion.fx) ? motion.fx.join(' ') : ''; stage.classList.toggle('is-record', !['DeepSeek', ...TEAM].includes(story.speaker)); stage.dataset.style = this.settings.storyStyle || 'cinematic';
    }
    const board = root.querySelector('[data-v3="comic-board"]'); if (board) {
      // Artwork panels are observation/action/result, not one panel per line.
      // Keep the entire strip visible even for scenes with only two lines.
      // Dialogue still advances below; future dialogue never enters the board.
      const frame = comicFrameFor(story);
      const signature = JSON.stringify([this.storySessionId, storyBeatFor(story), frame]);
      if (signature !== this.comicPageSignature) {
        this.comicPageSignature = signature; board.style.setProperty('--comic-panel-count', 3);
        board.innerHTML = [0, 1, 2].map(panel => `<article class="comic-panel ${panel === frame ? 'is-active' : ''}" data-comic-frame="${panel}" style="background-image:url('${storyArtFor(story, 'comic')}');background-size:300% 100%;background-position:${panel * 50}% 50%"><span class="comic-caption">${panel + 1} · ${['观察', '行动', '结果'][panel]}</span></article>`).join('');
      }
    }
    root.querySelectorAll('.story-style-button').forEach((button) => { const active = button.dataset.style === (this.settings.storyStyle || 'cinematic'); button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active)); });
    const choiceRoot = root.querySelector('[data-v3="story-choice"]'); if (choiceRoot) {
      const choice = story.choice, signature = JSON.stringify([choice, story.choiceSelected]);
      if (signature !== this.storyChoiceSignature) {
        this.storyChoiceSignature = signature;
        choiceRoot.innerHTML = choice?.options?.length ? `<span>${esc(choice.prompt || '选择行动')}</span>${choice.options.map((option) => `<button type="button" class="story-choice-button ${story.choiceSelected === option.id ? 'is-selected' : ''}" data-action="story-choice" data-choice-id="${esc(option.id)}" aria-pressed="${story.choiceSelected === option.id}">${esc(option.label)}<small>${esc(option.hint || '')}</small></button>`).join('')}` : '';
      }
      choiceRoot.hidden = !choice?.options?.length;
    }
    const next = root.querySelector('[data-action="story-next"]'); if (next) {
      const blocked = Boolean(story.choice?.options?.length) && !story.choiceSelected;
      const ending = story.replay ? '返回调查档案 →' : story.sceneId === 'prologue' ? '开始行动 →' : story.sceneId === 'epilogue' ? '查看航程总结 →' : /^chapter[1-5]-briefing$/.test(story.sceneId || '') ? '查看任务 →' : '继续行动 →';
      next.disabled = blocked; next.textContent = blocked ? '先选择行动' : index + 1 >= total ? ending : '继续 →';
    }
    this.text(root, 'story-auto-note', story.choice?.options?.length && !story.choiceSelected ? '请选择一个关键词，再继续' : story.auto || this.settings.autoDialogue ? '自动推进中 · 也可点击继续' : '点击继续；文字未完时点击可立即显示');
    const rail = root.querySelector('.story-progress i'); if (rail) rail.style.width = `${clamp01(story.progress ?? (index + 1) / total) * 100}%`;
    const history = root.querySelector('[data-v3="story-history"]'); if (history) history.innerHTML = [...this.storyHistory, story].map((line) => `<p><b>${esc(line.speaker || '小队')}</b>${esc(line.text)}</p>`).join('');
    this.syncStoryLayout();
    if ((this.settings.storyStyle || 'cinematic') === 'stage') this.drawStoryStage();
  }

  syncStoryLayout() {
    const root = this.ui.menu, box = root.getBoundingClientRect?.();
    const heading = root.querySelector('.story-heading')?.getBoundingClientRect?.();
    const dialogue = root.querySelector('.story-dialogue')?.getBoundingClientRect?.();
    if (!box?.height || !heading || !dialogue) return;
    // Choices, subtitle size and wrapped mobile toolbars all change these edges.
    // Fit the complete art between them instead of letting dialogue cover it.
    root.style.setProperty('--story-art-top', `${Math.max(0, heading.bottom - box.top + 8)}px`);
    root.style.setProperty('--story-art-bottom', `${Math.max(0, box.bottom - dialogue.top + 8)}px`);
    root.style.setProperty('--story-art-height', `${Math.max(1, dialogue.top - heading.bottom - 16)}px`);
  }

  drawStoryStage() {
    const canvas = this.ui.menu.querySelector('[data-v3="story-stage-canvas"]');
    if (!canvas?.getContext || !canvas.getBoundingClientRect) return;
    let ctx; try { ctx = canvas.getContext('2d'); } catch { return; }
    if (!ctx?.drawImage) return;
    const box = canvas.getBoundingClientRect(), w = Math.max(1, box.width), h = Math.max(1, box.height);
    const d = this.settings.quality === 'low' ? 1 : Math.min(2, globalThis.devicePixelRatio || 1);
    const cw = Math.round(w * d), ch = Math.round(h * d);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, w, h);
    if (!this.storyAssets) {
      if (!this.storyAssetsLoading) {
        this.storyAssetsLoading = true;
        loadStoryAssets()?.then(library => {
          this.storyAssets = library;
          if (library && this.ui.screen === 'story' && this.settings.storyStyle === 'stage') this.drawStoryStage();
        });
      }
      return;
    }
    const story = this.currentStory || {}, beat = storyBeatFor(story), assets = this.storyAssets;
    const t = this.settings.reduceMotion ? 0 : Math.max(0, (performance.now() - this.storyStart) / 1000);
    const crew = beat === 'opening' ? ['DeepSeek'] : beat === 'grok' ? ['DeepSeek', 'Grok'] : beat === 'claude' ? ['DeepSeek', 'Grok', 'Claude'] : ['DeepSeek', ...TEAM];
    const performer = ({ grok: 'Grok', claude: 'Claude', glm: 'GLM' })[beat] || story.speaker;
    const skill = comicFrameFor(story) === 1 || ['ready', 'resume', 'scan'].includes(story.pose);
    const dialogueBox = this.ui.menu.querySelector('.story-dialogue')?.getBoundingClientRect?.();
    const visibleFloor = dialogueBox && Number.isFinite(box.top) ? Math.max(44, dialogueBox.top - box.top - 12) : h * .94;
    const feet = Math.min(h * .94, visibleFloor);
    const sceneScale = Math.min(h * .67 / 88, feet * .85 / 88, w / (crew.length * 190));
    crew.forEach((name, i) => {
      const x = crew.length === 1 ? w * .46 : w * (.2 + i * .6 / (crew.length - 1));
      const active = name === performer, direction = name === 'DeepSeek' ? 'right' : 'left';
      const pose = active && skill ? 'skill' : beat === 'evacuation' && !this.settings.reduceMotion && t % 4 < 1.2 ? 'walk' : 'idle';
      const sprite = assets.catalog.sprites[`character-${name.toLowerCase()}-${direction}-${pose}`];
      if (!sprite || !assets.images.has(sprite.image)) return;
      // All poses retain their character's atlas scale, including the wide axe pose.
      const bob = this.settings.reduceMotion ? 0 : Math.sin(t * 2.5 + i) * Math.min(3, h * .008);
      assets.drawActor(ctx, name, pose, direction, x, feet + bob, { nativeScale: sprite.native_scale * sceneScale, opacity: active ? 1 : .92 });
      if (active && skill) {
        const effect = ({ Grok: 'axe-impact', Claude: 'paper-decoy', GLM: 'scan-grid', DeepSeek: 'water-dash' })[name];
        const sign = direction === 'left' ? -1 : 1;
        if (effect && assets.catalog.animations[effect]) assets.drawEffect(ctx, effect, t, x + sign * h * .18, feet - h * .2, { width: h * .54, height: h * .54, loop: !this.settings.reduceMotion, opacity: .86 });
      }
    });
    canvas.dataset.stageAssets = 'ready';
  }

  renderArchive() { const archive = this.view.archive || this.ui.payload.archive || {}; let body = '';

    if (this.archiveTab === 'stories') body = `<div class="archive-card-grid">${list(archive.stories).map((story, index) => { const art = storyArtFor(story, 'cinematic'); return `<article class="archive-card archive-story-card ${!story.seen && !story.available ? 'is-locked' : ''}"><div class="archive-card-art" style="--archive-art:url('${cssAssetURL(art)}')"><span class="archive-number">${String(index + 1).padStart(2, '0')}</span><span class="archive-card-state" aria-hidden="true">${story.seen ? '✓' : story.available ? '◇' : '×'}</span></div><h3>${esc(story.title || story.name || story.id)}</h3><p>${story.seen ? '已看，可重温。' : story.available ? '本章已到，可看简报。' : '随航程解锁。'}</p>${btn('story-replay', story.seen ? '回看这一段' : story.available ? '查看任务简报' : '尚未解锁', 'compact', `data-scene-id="${esc(story.id)}" aria-label="${esc(story.seen ? '回看这一段' : story.available ? '查看任务简报' : '尚未解锁')}" ${story.seen || story.available ? '' : 'disabled'}`)}</article>`; }).join('') || '<p class="v3-empty">还没有剧情记录。开始行动后会自动保存。</p>'}</div>`;
    if (this.archiveTab === 'templates') body = `<div class="archive-card-grid">${list(archive.templates).map((item) => `<article class="archive-card archive-template-card"><div class="archive-template-mark">${artMark(item.teammate === 'GLM' ? 'scan' : item.teammate === 'Claude' ? 'book' : 'axe')}</div><span class="archive-type">${esc(item.teammate || '提示词')}</span><h3>${esc(item.name || item.id)}</h3><p>${esc(item.promptText || '可从指令页收藏。')}</p>${btn('template-load', item.unlocked === false ? '尚未解锁' : '载入模板', 'compact', `data-template-id="${esc(item.id)}" ${item.unlocked === false ? 'disabled' : ''}`)}</article>`).join('') || '<p class="v3-empty">还没有收藏。可在指令页保存常用方案。</p>'}</div>`;
    if (this.archiveTab === 'characters') { const characters = list(archive.characters).length ? archive.characters : [{ name: 'DeepSeek', description: '潜入、搬运与全员返航的行动队长。' }, ...TEAM.map((name) => ({ name, job: JOBS[name], description: '在航程中逐步加入，与主角配合。' }))]; body = `<div class="character-archive">${characters.map((character) => `<article><img src="${portraitPath(character.name)}" alt=""><div><small>${esc(character.job || JOBS[character.name] || '')}</small><h3>${esc(character.name)}</h3><p>${esc(character.description || '')}</p></div></article>`).join('')}</div>`; }
    this.panel('THE CREW ARCHIVE', '调查档案', `<nav class="v3-tabs" aria-label="调查档案分类">${[['stories', '已看剧情', 'book'], ['templates', '提示词收藏', 'token'], ['characters', '小队图鉴', 'map']].map(([id, label, kind]) => `<button type="button" data-action="ui-archive-tab" data-tab="${id}" aria-label="${esc(label)}" aria-pressed="${this.archiveTab === id}">${artMark(kind)}<span class="action-label">${label}</span></button>`).join('')}</nav>${body}`, 'v3-archive', `${actionBtn('records-open', '查看本次指令记录', 'book', 'text-button')}${actionBtn('overlay-back', '返回', 'home', 'primary')}`); }

  recordHTML(records) { return list(records).map(normalizeRecord).reverse().map((record) => `<article class="record-entry"><time>${esc(record.time)}</time><div><div class="record-meta"><b>${esc(record.teammate)}</b><small>${esc([record.chapter, record.room].filter(Boolean).join(' · '))}</small><span class="record-badge ${record.published ? 'is-public' : ''}">${record.published ? '已公开' : '本地记录'}</span></div><p>${esc(record.text)}</p>${record.outcome ? `<div class="record-outcome">↳ ${esc(record.outcome)}</div>` : ''}</div></article>`).join('') || '<p class="v3-empty">还没有指令记录。小队真正完成行动后，会在这里留下回执。</p>'; }
  renderRecords() {
    const triage = this.view.recordTriage || {};
    const source = triage.source;
    const choices = list(triage.choices);
    const triageSelected = triage.selected?.sourceRecordId && source?.id && triage.selected.sourceRecordId === source.id;
    const triagePanel = triage.available && source ? `<section class="record-triage" aria-label="公开记录处理"><div><b>处理最近公开记录</b><small>${esc(source.text || '公开行动记录')}</small></div><div class="record-triage-choices">${choices.map(choice => btn('record-triage', triageSelected ? '已处理' : esc(choice.label), 'compact', `data-choice-id="${esc(choice.id)}" title="${esc(choice.short || '')}" ${triageSelected ? 'disabled' : ''}`)).join('')}</div><p class="tiny-note">${triageSelected ? '本条记录已完成选择。' : '三选一，写入本地调查档案，不影响主线。'}</p></section>` : '';
    this.panel('ACTION LOG', '指令记录', `<p class="panel-lead">每次行动都会留下结果。</p>${triagePanel}<div class="record-list">${this.recordHTML(this.view.records || this.ui.payload.records)}</div>`, 'v3-records', btn('overlay-back', '返回行动', 'primary'));
  }

  renderMap() { const room = this.view.world?.room || {}, goals = list(this.view.core?.objectives), optional = list(this.view.core?.optionalObjectives), rooms = list(this.ui.payload.rooms || this.view.world?.rooms); const nodes = rooms.length ? rooms : [{ ...room, current: true }, ...list(room.exits).map((exit) => ({ id: exit.to || exit.roomId || exit.targetRoomId || exit.id, name: exit.label || exit.name || '相邻房间', locked: exit.locked, optional: exit.optional }))]; this.panel('ROOM OVERVIEW', '当前任务与航图', `<div class="map-overview"><div class="room-node-list">${nodes.map((node, index) => `<article class="room-node ${(node.id === room.id || node.current) ? 'is-current' : ''} ${node.locked ? 'is-locked' : ''}"><span>${String(index + 1).padStart(2, '0')}</span><h3>${esc(node.name || '当前房间')}</h3><small>${node.id === room.id || node.current ? '当前位置' : node.locked ? '暂未开启' : node.optional ? '可选探索' : '可通行房间'}</small></article>`).join('')}</div><aside><h3>${esc(this.view.core?.chapter?.name || '本章任务')}</h3><ul class="map-objectives">${goals.map((goal) => `<li class="${goal.complete ? 'is-complete' : ''}"><span>${goal.complete ? '✓' : '◇'}</span>${esc(goal.label)}${goal.required !== undefined ? `<b>${goal.current || 0}/${goal.required}</b>` : ''}</li>`).join('')}</ul>${optional.length ? `<section class="map-optional"><h3>可选支线</h3><ul class="map-objectives">${optionalGoalItems(optional)}</ul><small>不影响主线通关</small></section>` : ''}<details class="art-details"><summary>房间移动</summary><p>从场景出口换房。本章物品、队友与机关会保留。</p></details></aside></div>`, 'v3-map', `${btn('records-open', '指令记录')}${Number.isInteger(this.view.core?.chapter?.number) && this.view.core.chapter.number >= 1 && this.view.core.chapter.number <= 5 ? btn('story-replay', '章首简报', '', `data-scene-id="chapter${this.view.core.chapter.number}-briefing"`) : ''}${btn('overlay-back', '收起航图', 'primary')}`); }

  renderAnalysis() {
    const data = this.view.vulnerability || this.ui.payload.vulnerability || {}, session = data.session || {}, file = data.caseFile || {};
    const progress = data.progress || {}, suggestions = data.suggestions || {};
    const clueRows = list(file.clues).map((clue) => {
      const collected = list(session.collected).includes(clue.id), analyzed = list(session.analyzed).includes(clue.id);
      const action = analyzed ? '已完成' : collected ? '分析摘要' : '等待现场拾取';
      return `<article class="analysis-clue">${ico(clue.kind === 'sensor' ? 'scan' : clue.kind === 'screen' ? 'qualifier' : 'book', 'clue-art')}<div><b>${esc(clue.label)}</b><small>${collected ? analyzed ? '已分析' : '已收集' : '未收集'}</small>${collected ? `<details class="art-details"><summary>查看证据</summary><p>${esc(clue.text)}</p></details>` : ''}</div>${collected && !analyzed ? btn('analysis-analyze', action, 'compact', `data-clue-id="${esc(clue.id)}"`) : `<span class="analysis-state">${action}</span>`}</article>`;
    }).join('');
    const repairRows = list(suggestions.suggestions).map((repair) => btn('analysis-repair', `采用「${esc(repair.label)}」并补充 1 Token`, 'compact', `data-repair-id="${esc(repair.id)}"`)).join('') || '<p class="v3-empty">先完成证据分析，再解锁修复建议。</p>';
    this.panel('EVIDENCE DESK', '线索分析', `<p class="panel-lead">${esc(file.briefing || '仅分析游戏内日志、配置和证据链。')}</p><div class="analysis-meter"><strong>${ico('token')}分析 Token ${Number(progress.tokens ?? session.tokens ?? 0)} / ${Number(progress.tokenMax ?? 6)}</strong><span>已收集 ${Number(progress.collected || 0)} / ${Number(progress.total || list(file.clues).length)} · 已分析 ${Number(progress.analyzed || 0)}</span></div><div class="analysis-clues">${clueRows || '<p class="v3-empty">当前章节没有可分析证据。</p>'}</div><section class="analysis-repairs"><h3>修复建议</h3>${repairRows}</section><p class="tiny-note">离线虚构沙盒：不连接真实服务器。</p>`, 'v3-analysis', btn('overlay-back', '返回行动', 'primary'));
  }

  renderFailure() { const failure = this.ui.payload.failure || this.ui.payload, checkpoint = this.view.checkpoint || {}; const reason = ({ 'health-depleted': '生命耗尽了。小队会在安全处等你。', 'evacuation-timeout': '最后的舱门关闭了。下次出发前，先安排好返程。', fall: '这段落差比想象中更深。试试旁边的梯路。' })[failure.reason] || failure.message || '这次行动暂时告一段落，再调整一下安排。'; const last = list(this.view.records).at(-1); this.panel('REGROUP & TRY AGAIN', '重新集合', `<div class="failure-hero"><img src="${portraitPath('DeepSeek')}" alt=""><div><h3>${esc(failure.title || '还有一次漂亮的机会。')}</h3><p>${esc(reason)}</p>${failure.location ? `<small>危险位置：${esc(failure.location)}</small>` : ''}</div></div>${last ? `<div class="failure-last"><span>最后一条指令</span>${this.recordHTML([last])}</div>` : ''}<p class="tiny-note">${checkpoint.available ? `检查点：${esc(checkpoint.label || '本章安全区')}。重试会恢复当时的完整行动状态。` : '本章尚无检查点，将从章首重新出发。'}</p>`, 'v3-failure', `${btn('tutorial-hint', '查看提示', 'text-button')}${btn('retry', '本章重来')}${btn(checkpoint.available ? 'retry-checkpoint' : 'retry', checkpoint.available ? '从检查点再试' : '重新出发', 'primary')}`); }

  renderContracts() {
    const contracts = list(this.ui.payload.contracts || this.view.contracts), chapterId = this.ui.payload.chapterId || this.view.selectedChapterId || this.view.core?.chapter?.id;
    const cardArt = { standard:'book', 'low-budget':'qualifier', 'dense-patrol':'scan', 'closed-shortcuts':'map' };
    const shortRules = { standard:'原有路线与资源', 'low-budget':'初始限定词上限 1', 'dense-patrol':'守卫巡逻速度 ×1.2', 'closed-shortcuts':'关闭可选捷径，保留梯路' };
    const cards = contracts.map(contract => `<button type="button" class="contract-card" data-action="contract-select" data-contract-id="${esc(contract.id)}" aria-pressed="false" title="${esc(contract.description || '')}">${artMark(cardArt[contract.id] || 'book')}<h3>${esc(contract.name || contract.title || contract.label || contract.id)}</h3><p>${esc(shortRules[contract.id] || contract.description || '')}</p></button>`).join('');
    const rules = contracts.map(contract => `<p><b>${esc(contract.name || contract.title || contract.label || contract.id)}</b> · ${esc(contract.description || '')}${list(contract.impacts).length ? `<br><small>${esc(contract.impacts.join(' · '))}</small>` : ''}</p>`).join('');
    this.panel('SET THE TERMS', '选择挑战契约', `<p class="panel-lead">先选规则，再出发。</p><div class="contract-grid">${cards || '<p class="v3-empty">当前为标准规则。</p>'}</div><details class="art-details"><summary>完整契约规则</summary>${rules}</details>`, 'v3-contracts', `${btn('chapter-select', '返回章节')}${btn('challenge-start', '按此契约出发 →', 'primary', `data-chapter-id="${esc(chapterId || '')}" data-contract-start`)}`);
    this.syncContracts();
  }
  syncContracts() { const selected = this.view.contractId || this.view.selectedContractId || this.ui.payload.contractId || 'standard'; this.ui.menu.querySelectorAll('[data-action="contract-select"]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.contractId === selected))); const start = this.ui.menu.querySelector('[data-contract-start]'); if (start) start.dataset.contractId = selected; }

  targetArt(targetId = '', label = '') {
    const id = `${targetId} ${label}`.toLowerCase();
    const maps = [
      [/guard|patrol|守卫/, 'assets/enemies/guard.png', '100% 100%', 'center'],
      [/investigator|调查/, 'assets/enemies/investigator.png', '100% 100%', 'center'],
      [/paper|window|divider|barrier|纸|窗|障/, 'assets/atlases/masonry-kit.png', '366% 256%', '40.4% 70%'],
      [/node|data|数据|节点/, 'assets/atlases/props-kit.png', '300% 200%', '66.7% 0%'],
      [/beacon|信标/, 'assets/atlases/props-kit.png', '300% 200%', '100% 100%'],
      [/alarm|sensor|警戒/, 'assets/atlases/harbor-kit.png', '300% 200%', '0% 100%'],
      [/trap|陷阱/, 'assets/atlases/harbor-kit.png', '300% 200%', '50% 100%'],
      [/lift|elevator|升降/, 'assets/atlases/mechanisms-kit.png', '300% 200%', '50% 0%'],
      [/broadcast|广播/, 'assets/atlases/props-kit.png', '300% 200%', '50% 100%'],
    ];
    return maps.find(([pattern]) => pattern.test(id))?.slice(1) || ['assets/ui/whale-emblem.png', '100% 100%', 'center'];
  }

  renderChapterResult() {
    const result = this.ui.payload.result || this.view.core?.pendingResult || {}, chapter = CHAPTERS.find((item) => item.id === result.chapterId) || this.view.core?.chapter || {};
    const breakdown = result.breakdown || {}, grade = result.grade || (result.score >= 90 ? 'S' : result.score >= 75 ? 'A' : 'B');
    this.panel(`CHAPTER ${String(chapter.number || 1).padStart(2, '0')} COMPLETE`, esc(chapter.name || '本章完成'), `<div class="result-visual-hero"><div class="result-visual-backdrop" style="--result-bg:url('${cssAssetURL('assets/backgrounds/results-background.png')}')"></div><img src="assets/foreground/whale-crew-hero-v2.png" alt="全员返航" class="result-crew-art"><div class="grade-seal" aria-label="评级 ${esc(grade)}">${esc(grade)}</div><div class="result-visual-copy"><span>行动评分</span><strong>${Number(result.score || 0)}<small> / 100</small></strong><p>小队已登艇，数据安全归档。</p></div></div><div class="result-metrics"><span>${ico('clock', 'metric-art metric-art-time')}<small>用时</small><b>${formatTime(result.elapsedMs)}</b></span><span>${ico('scan', 'metric-art metric-art-alert')}<small>暴露</small><b>${result.exposureDelta || 0}</b></span><span>${ico('retry', 'metric-art metric-art-retry')}<small>重试</small><b>${result.failedAttempts || 0}</b></span></div><div class="score-lines"><span>${ico('map', 'metric-art metric-art-objective')}<small>任务</small><b>${breakdown.required || 0}</b></span><span>${ico('map', 'metric-art metric-art-explore')}<small>探索</small><b>${breakdown.optional || 0}</b></span><span>${ico('interact', 'metric-art metric-art-crew')}<small>协作</small><b>${breakdown.collaboration || 0}</b></span><span>${ico('scan', 'metric-art metric-art-stealth')}<small>低警戒</small><b>${breakdown.lowAlert || 0}</b></span></div><div class="result-crew-strip">${list(chapter.teammates || ['DeepSeek', 'Grok', 'Claude', 'GLM']).map((name) => `<span><img src="${portraitPath(name)}" alt="${name}"><b>${esc(name)}</b></span>`).join('')}</div>`, 'v3-results', `${actionBtn('retry', '再试一次', 'retry')}${actionBtn('continue', chapter.number === 5 ? '全员返航' : '下一章 →', 'play', 'primary')}`);
  }

  renderCampaignResult() {
    const campaign = this.ui.payload.campaign || this.view.core?.campaign || {}, results = list(campaign.results), total = campaign.totalScore ?? results.reduce((sum, item) => sum + Number(item.score || 0), 0), grade = campaign.grade || (total >= 450 ? 'S' : total >= 375 ? 'A' : 'B');
    this.ui.menu.innerHTML = `<div class="results-backdrop v3-campaign-backdrop"></div><section class="menu-panel v3-panel v3-campaign" role="dialog" aria-modal="true"><div class="panel-ornament"></div><header class="v3-panel-heading"><div><div class="panel-eyebrow">ALL ABOARD · ALL TOGETHER</div><h2>全员返航</h2></div></header><div class="v3-panel-body"><div class="campaign-visual-hero"><img src="assets/foreground/whale-crew-hero-v2.png" alt="鲸艇与全员返航"><div class="campaign-grade grade-seal">${esc(grade)}</div><div><span>魔盗团总评分</span><strong>${Number(total)}<small> / 500</small></strong><p>五章航程完成，所有资料和队友都已带回。</p></div></div><div class="result-metrics"><span>${ico('map', 'metric-art metric-art-objective')}<small>完成章节</small><b>${results.length} / 5</b></span><span>${ico('scan', 'metric-art metric-art-alert')}<small>历史暴露</small><b>${campaign.historyExposure || 0}</b></span><span>${ico('book', 'metric-art metric-art-book')}<small>调查记录</small><b>${results.reduce((n, item) => n + Number(item.events?.publicCommands || 0), 0)}</b></span></div><div class="campaign-chapter-rail">${CHAPTERS.map((chapter, index) => `<span class="${index < results.length ? 'is-complete' : ''}"><i>${String(chapter.number).padStart(2, '0')}</i><b>${esc(chapter.name)}</b></span>`).join('')}</div></div><footer class="v3-panel-footer">${actionBtn('title', '返回主菜单', 'home')}${actionBtn('chapter-select', '章节挑战', 'play', 'primary')}</footer></section>`;
  }

  renderCommand() {
    this.moreCommand = false; this.forecastOpen = false; this.targetSignature = ''; this.constraintSignature = ''; this.conditionSignature = '';
    this.ui.menu.innerHTML = `<div class="command-dimmer"></div><section class="command-panel v3-command-panel" role="dialog" aria-modal="true" aria-label="小队指令"><header class="command-header"><img data-v3="command-portrait" src="${portraitPath('Grok')}" alt=""><div><small data-v3="command-role">选择目标</small><h2 data-v3="command-name">Grok</h2></div><span class="command-budget">${ico('token')}<b data-v3="command-budget">0</b></span><button type="button" class="icon-button" data-action="command-cancel" aria-label="返回">${ico('close')}</button></header><div class="command-step-rail" aria-hidden="true"><span class="is-active"><i>01</i>目标</span><b></b><span><i>02</i>方案</span><b></b><span><i>03</i>执行</span></div><div class="v3-command-body"><div class="command-target-control"><div class="command-target-visual" aria-hidden="true"><span class="command-target-ring"><i data-v3="command-target-image" class="command-target-art"></i><i class="command-target-pulse"></i></span><span><small>行动对象</small><b data-v3="command-target-visual-label">未锁定目标</b></span></div><label><span>目标</span><select data-command-select="prompt-target" data-payload-key="targetId" aria-label="选择行动目标"></select></label><span data-v3="command-target-count"></span></div><div class="command-preview-card" aria-live="polite"><span class="command-step-label">预览影响</span><strong data-v3="command-target-label">先选一个高亮目标</strong><p data-v3="command-status" role="status">选择目标后查看范围。</p></div><div class="command-options" role="group" aria-label="选择行动方案"><button type="button" data-action="prompt-mode" data-precise="false" aria-pressed="true"><span class="command-option-art" data-command-fx="default" aria-hidden="true"><i class="command-fx-atlas"></i>${ico('axe')}</span><span class="command-option-heading"><b>整片开路</b><em>AI Token × 1</em></span><p data-v3="command-default"></p><strong>范围较宽</strong></button><button type="button" class="precise-option" data-action="prompt-mode" data-precise="true" aria-pressed="false"><span class="command-option-art" data-command-fx="precise" aria-hidden="true"><i class="command-fx-atlas"></i>${ico('axe')}</span><span class="command-option-heading"><b>只开此处</b><em>Token × 1 · 限定词 × 1</em></span><p data-v3="command-precise"></p><strong>范围更准</strong></button></div><div class="command-receipt"><span class="command-receipt-avatar"><img data-v3="command-receipt-image" src="${portraitPath('Grok')}" alt=""></span><span>队友复述</span><p data-v3="command-receipt">先选目标，我会复述安排。</p></div><button type="button" class="command-forecast-toggle" data-action="ui-command-forecast" aria-expanded="false">${ico('scan')} 查看影响</button><section class="command-forecast" data-v3="command-forecast" hidden aria-label="行动影响"><div class="forecast-grid"><div><small>会发生什么</small><p data-v3="forecast-impact"></p></div><div><small>可能反应</small><p data-v3="forecast-risk"></p></div><div><small>返程提醒</small><p data-v3="forecast-return"></p></div></section><div class="command-advanced-wrap"><button class="command-more" data-action="ui-command-more" aria-expanded="false">高级编排 <span>⌄</span></button><div class="command-advanced" hidden><div class="command-constraint-row"><label>约束 <select data-command-select="prompt-constraint" data-payload-key="constraintId" aria-label="行动约束"></select></label><label>时机 <select data-command-select="prompt-condition" data-payload-key="condition" aria-label="行动时机"></select></div><div class="command-custom"><label>自定义短句<textarea data-command-text rows="2" placeholder="输入一句清楚的指令。" aria-label="中文指令"></textarea></label><div class="parse-row">${btn('prompt-parse', '识别短句', 'compact')}<span>仅识别已解锁句式。</span></div><div class="command-templates">${[1, 2, 3].map((index) => `<span><small>收藏 ${index}</small>${btn('template-save', '存入', 'compact text-button', `data-template-id="slot-${index}"`)}${btn('template-load', '载入', 'compact text-button', `data-template-id="slot-${index}"`)}</span>`).join('')}</div></div></div></div></div><footer class="command-submit"><span data-v3="command-cost"></span>${btn('command-confirm', '确认执行', 'primary', 'data-command-confirm disabled')}<small>Enter 确认 · Esc 返回</small></footer></section>`; this.syncCommand();
  }
  options(select, values, selected, signatureKey) { const signature = JSON.stringify(values.map((value) => [optionId(value), optionLabel(value)])); if (this[signatureKey] !== signature) { this[signatureKey] = signature; select.innerHTML = values.map((value) => `<option value="${esc(optionId(value))}">${esc(optionLabel(value))}</option>`).join(''); } [...select.options].forEach((option, index) => { const source = values[index]; option.disabled = source?.available === false || Boolean(source?.disabled); }); if (select.value !== String(selected || '')) select.value = selected || ''; select.disabled = !values.length; }
  syncCommand() {
    const root = this.ui.menu, model = commandModel(this.view, this.ui.payload), name = model.teammate;
    if (!root.querySelector('.command-guide')) root.querySelector('.command-header').insertAdjacentHTML('afterend', '<aside class="command-guide" hidden><b>当前目标</b><span data-v3="command-guide-text"></span><button type="button" class="game-button text-button" data-action="tutorial-hint">需要提示</button></aside>');
    const commandGuide = root.querySelector('.command-guide');
    commandGuide.hidden = !this.view.tutorial || !this.settings.tutorialHints;
    this.text(root, 'command-guide-text', formatControlHints(this.view.tutorial?.text || '', this.settings, this.isTouch));
    const guide = this.view.tutorial?.guide;
    const guidedCommand = coreChapterOne(this.view) && Number.isInteger(guide?.commandStage);
    const chooseTarget = guidedCommand && guide.commandStage === 1;
    this.text(root, 'command-name', name); this.text(root, 'command-role', JOBS[name] || '协作'); this.text(root, 'command-budget', `AI ${model.aiTokens}/${model.aiTokenMax} · ${model.trainingAvailable ? `限定词 ${model.budget} / 训练 ${model.trainingAvailable}` : `限定词 ${model.budget}`}`);
    const portrait = portraitPath(name); const image = root.querySelector('[data-v3="command-portrait"]'); if (image && image.getAttribute('src') !== portrait) image.src = portrait;
    const receiptImage = root.querySelector('[data-v3="command-receipt-image"]'); if (receiptImage && receiptImage.getAttribute('src') !== portrait) receiptImage.src = portrait;
    const targetImage = root.querySelector('[data-v3="command-target-image"]'); if (targetImage) { const art = this.targetArt(model.targetId, model.label); targetImage.style.setProperty('--target-art-url', `url("${cssAssetURL(art[0])}")`); targetImage.style.setProperty('--target-art-size', art[1]); targetImage.style.setProperty('--target-art-position', art[2]); targetImage.setAttribute('aria-label', model.label || '未锁定目标'); }
    this.text(root, 'command-target-visual-label', model.label || (model.targetId ? '已锁定目标' : '未锁定目标'));
    root.dataset.commandTeammate = String(name || '').toLowerCase();
    const fxPath = name === 'Claude' ? 'assets/fx/paper-decoy-atlas.png' : name === 'GLM' ? 'assets/fx/scan-grid-atlas.png' : 'assets/fx/axe-impact-atlas.png';
    root.style.setProperty('--command-fx-url', `url("${cssAssetURL(fxPath)}")`);
    const iconId = name === 'Claude' ? 'book' : name === 'GLM' ? 'scan' : 'axe';
    root.querySelectorAll('.command-option-art .ui-icon').forEach(element => applyRasterIcon(element, iconId));
    const defaults = { Grok: ['沿通道持续冲锋，打开沿途合法障碍。', '只处理指定对象，在标记处停下。'], Claude: ['引走附近同层的多名守卫。', '只引指定的一名守卫。'], GLM: ['扫描大片区域，可能惊动警戒器。', '只扫描前方窄区，控制影响范围。'] }[name] || ['', ''];
    this.text(root, 'command-default', model.defaultDescription || defaults[0]); this.text(root, 'command-precise', model.preciseDescription || defaults[1]); this.text(root, 'command-target-label', model.label || (model.targetId ? '已选目标' : '先选一个高亮目标'));
    root.querySelectorAll('[data-action="prompt-mode"]').forEach((button) => { button.setAttribute('aria-pressed', String((button.dataset.precise === 'true') === model.constrained)); button.disabled = button.dataset.precise === 'true' && model.budget + model.trainingAvailable < 1; });
    const preciseCost = root.querySelector('[data-action="prompt-mode"][data-precise="true"] em'); if (preciseCost) preciseCost.textContent = model.trainingAvailable ? '训练限定词 × 1' : '限定词 × 1';
    const defaultCost = root.querySelector('[data-action="prompt-mode"][data-precise="false"] em'); if (defaultCost) defaultCost.textContent = 'AI Token × 1 · 限定词 0';
    const targets = model.targets.length ? model.targets : model.targetId ? [{ id: model.targetId, label: model.label || model.targetId }] : [];
    this.options(root.querySelector('[data-command-select="prompt-target"]'), chooseTarget ? [{ id: '', label: '请选择行动目标', disabled: true }, ...targets] : targets, chooseTarget ? '' : model.targetId, 'targetSignature'); this.text(root, 'command-target-count', targets.length ? `${targets.length} 个合法对象` : '靠近场景中的目标');
    root.querySelector('.command-step-rail span:nth-of-type(1)')?.classList.toggle('is-complete', Boolean(model.targetId));
    root.querySelector('.command-step-rail span:nth-of-type(2)')?.classList.toggle('is-active', Boolean(model.targetId));
    root.querySelector('.command-step-rail span:nth-of-type(3)')?.classList.toggle('is-active', Boolean(model.canConfirm));
    const constraints = model.constraints.length ? model.constraints : model.constraintId ? [{ id: model.constraintId, label: model.constraintId }] : [];
    this.options(root.querySelector('[data-command-select="prompt-constraint"]'), constraints, model.constraintId || optionId(constraints[0] || ''), 'constraintSignature'); root.querySelector('[data-command-select="prompt-constraint"]').disabled = !model.constrained || !constraints.length;
    const conditions = model.conditions.length ? model.conditions : [{ id: 'none', label: '立即执行' }]; this.options(root.querySelector('[data-command-select="prompt-condition"]'), conditions, model.condition || 'none', 'conditionSignature');
    this.text(root, 'command-receipt', receiptText(model.receipt) || (model.label ? `对「${model.label}」${model.precise ? '精准处理' : '执行'}` : '选择目标后确认'));
    const affectedCount = model.affectedIds?.length || 0; this.text(root, 'command-status', model.reason || (affectedCount ? `影响 ${affectedCount} 个对象` : '可执行'));
    const forecast = root.querySelector('[data-v3="command-forecast"]');
    if (forecast) {
      const geometry = model.geometry || {}, affected = model.affectedIds?.length || ['guardIds','trapIds','alarmIds','barrierIds','nodeIds'].reduce((sum, key) => sum + (geometry[key]?.length || 0), 0);
      const alarms = geometry.alarmIds?.length || 0;
      const impact = model.targetId ? `${name}将${model.precise ? '限定处理' : '按默认范围处理'}「${model.label || '当前目标'}」${affected ? `，预计触及 ${affected} 个对象` : ''}。` : '先选目标。';
      const risk = !model.targetId ? '尚未锁定目标。' : alarms ? `范围可能触及 ${alarms} 个警戒器；精确方案可避开高亮危险区。` : model.precise ? '范围收窄，警戒器保持在排除区外。' : '默认范围较宽，移动守卫可能改变返程路线。';
      const ret = !model.targetId ? '选目标后显示返程建议。' : model.teammate === 'Grok' ? '破障后会打开一条新路径，记得带资料回鲸艇。' : model.teammate === 'Claude' ? '诱饵会改变守卫位置，完成搬运后先观察回程。' : '扫描会留下陷阱回执，沿已标记的安全边缘返航。';
      this.text(root, 'forecast-impact', impact); this.text(root, 'forecast-risk', risk); this.text(root, 'forecast-return', ret);
      forecast.hidden = !this.forecastOpen;
    }
    const status = root.querySelector('[data-v3="command-status"]'); status.classList.toggle('is-warning', Boolean(model.reason)); status.setAttribute('role', model.parseError ? 'alert' : 'status');
    this.text(root, 'command-cost', model.trainingCost || model.budgetSource === 'training' ? `本次使用训练限定词 × ${model.trainingCost || 1} · AI Token × ${model.tokenCost}` : `${model.cost ? `限定词 × ${model.cost} · ` : ''}开始执行时消耗 AI Token × ${model.tokenCost}`); const confirm = root.querySelector('[data-command-confirm]'); if (confirm) confirm.disabled = !model.canConfirm || (guidedCommand && guide.commandStage !== 3);
    root.querySelectorAll('[data-action="prompt-mode"]').forEach(button => {
      if (guidedCommand) button.disabled = button.dataset.precise === 'true' || guide.commandStage < 2;
      button.classList.toggle('is-guide-target', guidedCommand && guide.commandStage === 2 && button.dataset.precise === 'false');
    });
    root.querySelector('[data-command-select="prompt-target"]').classList.toggle('is-guide-target', chooseTarget);
    confirm?.classList.toggle('is-guide-target', guidedCommand && guide.commandStage === 3);
    const text = root.querySelector('[data-command-text]'); if (text && document.activeElement !== text && model.promptText && model.promptText !== this.lastPromptText) text.value = model.promptText; this.lastPromptText = model.promptText;
    root.querySelectorAll('[data-action="template-save"]').forEach((button) => button.disabled = !model.targetId || Boolean(model.parseError));
    const templates = list(this.view.archive?.templates); root.querySelectorAll('[data-action="template-load"]').forEach((button) => { const template = templates.find((item) => item.id === button.dataset.templateId); button.disabled = !template || template.unlocked === false; button.title = template?.name || '这个收藏位还是空的'; });
  }
}
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const coreChapterOne = (view) => view?.core?.chapter?.number === 1;

