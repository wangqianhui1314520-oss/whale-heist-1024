/** Story UI behavior contracts with a DOM stub; browser layout is checked separately. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { UIV3Controller, normalizedSettings, storyBackdrop } from '../src/ui/ui-v3.mjs';
import { getStoryScene } from '../src/game/story.mjs';

class Element {
  constructor() { this.dataset = {}; this.style = { setProperty: (key, value) => { this.style[key] = value; } }; this.hidden = false; this.textContent = ''; this.attributes = {}; this.classes = new Set(); this.innerHTMLWrites = 0; this.classList = { contains: name => this.classes.has(name), toggle: (name, enabled = !this.classes.has(name)) => { if (enabled) this.classes.add(name); else this.classes.delete(name); return enabled; } }; }
  set innerHTML(value) { this.html = value; this.innerHTMLWrites++; }
  get innerHTML() { return this.html || ''; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
}
class Menu extends Element {
  set innerHTML(value) {
    super.innerHTML = value; this.nodes = new Map();
    for (const name of ['story-title', 'story-count', 'story-speaker', 'story-text', 'story-choice', 'story-auto-note', 'story-history']) this.nodes.set(`[data-v3="${name}"]`, new Element());
    this.nodes.set('.story-backdrop', new Element()); this.nodes.set('.story-progress i', new Element());
    const history = new Element(); history.hidden = /<aside class="story-history" hidden/.test(value); this.nodes.set('.story-history', history);
    this.nodes.set('[data-action="story-next"]', new Element());
    if (value.includes('data-v3="comic-board"')) { this.nodes.set('[data-v3="comic-board"]', new Element()); this.nodes.set('[data-v3="story-panel-text"]', new Element()); }
    else { this.nodes.set('.story-stage', new Element()); this.nodes.set('[data-v3="story-portrait"]', new Element()); }
    this.buttons = ['cinematic', 'stage', 'comic'].map(style => Object.assign(new Element(), { dataset: { style } }));
  }
  get innerHTML() { return super.innerHTML; }
  querySelector(selector) { return this.nodes.get(selector) || null; }
  querySelectorAll(selector) { return selector === '.story-style-button' ? this.buttons : []; }
}
function harness(style, sceneId = 'prologue') {
  const scene = getStoryScene(sceneId), menu = new Menu(), actions = [];
  const controller = Object.create(UIV3Controller.prototype);
  Object.assign(controller, { ui: { menu, screen: 'story', payload: {}, onAction: (action, payload) => actions.push([action, payload]) }, view: {}, settings: normalizedSettings({ storyStyle: style, reduceMotion: true }), storyHistory: [], storySessionActive: false, lastStoryKey: '', forceStoryText: false });
  const show = (index, extra = {}) => { controller.view.story = { ...scene.steps[index], sceneId, runId: 1, title: scene.title, index, total: scene.steps.length, presentation: style, comicPanels: scene.steps.map(entry => ({ ...entry })), ...extra }; };
  show(0); controller.renderStory();
  return { controller, menu, scene, show, actions };
}

for (const style of ['cinematic', 'stage', 'comic']) {
  const { controller, menu, scene, show } = harness(style);
  for (let index = 0; index < scene.steps.length; index++) {
    show(index); controller.syncStory();
    const choice = menu.querySelector('[data-v3="story-choice"]'), next = menu.querySelector('[data-action="story-next"]');
    assert.equal(menu.querySelector('[data-v3="story-text"]').textContent, scene.steps[index].text, `${style}: current dialogue at ${index}`);
    assert.equal(controller.storyHistory.length, index, `${style}: one history item per completed step`);
    assert(menu.querySelector('[data-v3="story-history"]').innerHTML.includes(scene.steps[0].text), `${style}: history contains first line`);
    if (scene.steps[index].choice) {
      assert.equal(choice.hidden, false, `${style}: required choice is visible`); assert.equal(next.disabled, true);
      const id = scene.steps[index].choice.options[0].id;
      assert(choice.innerHTML.includes(`data-choice-id="${id}"`));
      const writes = choice.innerHTMLWrites; controller.syncStory(); assert.equal(choice.innerHTMLWrites, writes, 'unchanged choice retains DOM and keyboard focus');
      show(index, { choiceSelected: id }); controller.syncStory(); assert.equal(next.disabled, false, `${style}: selected choice permits continuation`);
    }
    if (style === 'comic') {
      const board = menu.querySelector('[data-v3="comic-board"]');
      assert.equal((board.innerHTML.match(/class="comic-panel /g) || []).length, 3, 'all three artwork frames stay visible independently of dialogue count');
      for (let future = index + 1; future < scene.steps.length; future++) assert(!board.innerHTML.includes(scene.steps[future].text), `future panel ${future} is hidden`);
      for (const frame of [0, 1, 2]) assert(board.innerHTML.includes(`data-comic-frame="${frame}"`), `complete frame ${frame} is present`);
    }
  }
  assert.equal(menu.querySelector('[data-action="story-next"]').textContent, '开始行动 →');
  console.log(`PASS ${style}: all prologue lines, three mandatory choices, progression and history`);
}

{
  const { controller, menu, show, scene } = harness('cinematic');
  show(1); controller.syncStory(); controller.settings.reduceMotion = false; controller.storyStart = performance.now() - 250; controller.syncStory();
  const start = controller.storyStart, history = JSON.stringify(controller.storyHistory), revealed = controller.revealedCharacters;
  menu.querySelector('.story-history').hidden = false;
  for (const style of ['comic', 'stage', 'cinematic']) {
    controller.settings.storyStyle = style; controller.renderStory();
    assert.equal(controller.storyStart, start, 'style switch retains typewriter clock'); assert.equal(JSON.stringify(controller.storyHistory), history, 'style switch retains history');
    assert(controller.revealedCharacters >= revealed); assert.equal(menu.querySelector('.story-history').hidden, false, 'open history stays open');
  }
  controller.dispatch('story-next', { dataset: {} }); assert.equal(menu.querySelector('[data-v3="story-text"]').textContent, scene.steps[1].text, 'first click reveals unfinished text');
  assert.equal(controller.storyHistory.length, 1, 'revealing text does not advance history');
  show(0, { runId: 2 }); controller.syncStory(); assert.equal(controller.storyHistory.length, 0, 'new playback starts a fresh history');
  console.log('PASS style switches preserve history and reveal state; new playback resets history');
}

for (const [sceneId, expected] of [['chapter2-briefing', '查看任务 →'], ['grok-join', '继续行动 →'], ['chapter4-reveal', '继续行动 →'], ['chapter5-preparation', '继续行动 →'], ['epilogue', '查看航程总结 →']]) {
  const { controller, menu, show, scene } = harness('comic', sceneId); show(scene.steps.length - 1); controller.syncStory();
  assert.equal(menu.querySelector('[data-action="story-next"]').textContent, expected, sceneId);
  show(scene.steps.length - 1, { replay: true }); controller.syncStory(); assert.equal(menu.querySelector('[data-action="story-next"]').textContent, '返回调查档案 →');
}
console.log('PASS final buttons describe task, continuation, ending and replay destinations');

for (const sceneId of ['grok-join', 'claude-join', 'glm-join', 'chapter4-reveal', 'chapter5-preparation', 'epilogue']) {
  const { controller, menu, show, scene } = harness('comic', sceneId);
  for (let index = 0; index < scene.steps.length; index++) {
    show(index); controller.syncStory();
    const board = menu.querySelector('[data-v3="comic-board"]');
    assert.equal((board.innerHTML.match(/data-comic-frame=/g) || []).length, 3, `${sceneId}/${index}: no missing or repeated artwork frames`);
    assert.equal((board.innerHTML.match(/is-active/g) || []).length, 1);
    for (const line of scene.steps) assert(!board.innerHTML.includes(line.text), 'dialogue is read in its own panel, never printed over artwork');
  }
}
{
  const { controller, menu } = harness('cinematic');
  const heading = { bottom: 80 }, dialogue = { top: 500 };
  menu.getBoundingClientRect = () => ({ top: 20, bottom: 740, height: 720 });
  menu.nodes.set('.story-heading', { getBoundingClientRect: () => heading });
  menu.nodes.set('.story-dialogue', { getBoundingClientRect: () => dialogue });
  controller.syncStoryLayout();
  assert.equal(menu.style['--story-art-top'], '68px');
  assert.equal(menu.style['--story-art-bottom'], '248px');
  assert.equal(menu.style['--story-art-height'], '404px');
  heading.bottom = 124; dialogue.top = 420; controller.syncStoryLayout();
  assert.equal(menu.style['--story-art-height'], '280px', 'wrapped heading and expanded choice panel reduce the artwork region without covering it');
}
console.log('PASS complete comic artwork in short/dynamic scenes; art bounds follow actual heading and dialogue edges');

{
  const { controller, menu, actions } = harness('cinematic');
  const target = (kind = '') => ({ closest: selector => kind && selector.includes(kind) ? {} : null });
  const key = (key, code, kind = '', repeat = false) => {
    let prevented = false, stopped = false;
    controller.keydown({ key, code, target: target(kind), repeat, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    return { prevented, stopped };
  };
  controller.ui.screen = 'command';
  controller.view.world = { commandPreview: { targetId: 'paper-window', available: true, tokenCost: 1 } };
  controller.view.core = { attempt: { aiTokens: 5 } };
  assert.equal(key('Enter', 'Enter', 'button').prevented, false, 'Enter on cancel or mode buttons keeps its own native click');
  assert.equal(actions.length, 0, 'focused cancel must never execute the command');
  assert.equal(key('Enter', 'Enter', 'select').prevented, false);
  assert.equal(key('Enter', 'Enter', 'input').prevented, false);
  assert.equal(key('Enter', 'Enter', 'textarea').prevented, false);
  key('Enter', 'Enter'); assert.equal(actions.at(-1)[0], 'command-confirm');
  const count = actions.length; key('Enter', 'Enter', '', true); assert.equal(actions.length, count, 'held shortcut confirms once');
  controller.ui.screen = 'story';
  assert.equal(key(' ', 'Space', 'button').prevented, false, 'Space can select a focused story keyword or history button');
  assert.equal(actions.length, count);
  controller.revealedCharacters = 1e6; key(' ', 'Space'); assert.equal(actions.at(-1)[0], 'story-next');
  const afterStory = actions.length; key(' ', 'Space', '', true); assert.equal(actions.length, afterStory);
  menu.querySelector('.story-history').hidden = true;
  controller.ui.screen = 'pause'; key('Escape', 'Escape'); assert.equal(actions.at(-1)[0], 'resume-play');
  const afterEscape = actions.length; key('Escape', 'Escape', '', true); assert.equal(actions.length, afterEscape);
  controller.panel('PAUSE', '暂停', '', 'v3-pause');
  assert(menu.innerHTML.includes('class="icon-button v3-back" data-action="resume-play"'), 'pause close resumes instead of reopening pause');
  console.log('PASS native keyboard buttons, single-shot shortcuts and pause close/Escape routes');
}

{
  const { controller } = harness('cinematic');
  const root = new Element(), optional = new Element(), goals = new Element(), toggle = new Element();
  root.querySelector = selector => ({ '.optional-objectives-hud': optional, '[data-v3="optional-objectives"]': goals })[selector] || null;
  controller.ui.root = root; controller.view.core = { optionalObjectives: [{ label: '分析全部线索', current: 1, required: 3 }] };
  controller.syncOptionalObjectives(); assert.equal(optional.hidden, true, 'optional tasks stay hidden in compact HUD');
  controller.dispatch('ui-objectives', toggle); assert.equal(optional.hidden, false); assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert(goals.innerHTML.includes('1/3'));
  const writes = goals.innerHTMLWrites; controller.syncOptionalObjectives(); assert.equal(goals.innerHTMLWrites, writes);
  controller.dispatch('ui-objectives', toggle); assert.equal(optional.hidden, true); assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  controller.view.core.optionalObjectives = []; controller.dispatch('ui-objectives', toggle); assert.equal(optional.hidden, true, 'empty optional section is hidden when expanded');
  console.log('PASS compact objectives hide optional branches; expansion synchronizes visibility and accessibility');
}

{
  const { controller } = harness('cinematic'); let body = '', footer = '';
  controller.panel = (_eyebrow, _title, content, _className, actions) => { body = content; footer = actions; };
  controller.view.core = { chapter: { number: 1, name: '纸窗入港' }, objectives: [{ label: '搬回四份资料', current: 0, required: 4 }], optionalObjectives: [{ label: '分析支线证据', current: 1, required: 2, complete: false }] };
  controller.renderBriefing(); assert(body.includes('可选支线')); assert(body.includes('分析支线证据')); assert(body.includes('1/2')); assert(body.includes('不影响主线通关'));
  controller.renderMap(); assert(body.includes('可选支线')); assert(body.includes('分析支线证据')); assert(body.includes('1/2'));
  assert(footer.includes('章首简报')); assert(footer.includes('data-scene-id="chapter1-briefing"'), 'current map exposes its own chapter briefing');
  controller.view.core.chapter.number = 5; controller.renderMap(); assert(footer.includes('data-scene-id="chapter5-briefing"'));
  assert.equal(storyBackdrop('remote-beacon'), 'assets/backgrounds/gameplay-backdrop.webp');
  assert.equal(storyBackdrop('story-prologue'), 'assets/story/prologue-paper-window.webp');
  assert.equal(storyBackdrop('story-grok'), 'assets/story/grok-paper-window.webp');
  assert.equal(storyBackdrop('story-broadcast'), 'assets/story/broadcast-reveal.webp');
  assert.equal(storyBackdrop('story-evacuation'), 'assets/story/evacuation-beacon.webp');
  assert.equal(storyBackdrop('story-epilogue'), 'assets/story/investigation-epilogue.webp');
  console.log('PASS optional tasks appear separately in briefings and map; remote preparation uses gameplay backdrop');
}

{
  const { controller } = harness('cinematic'); let body = '';
  controller.panel = (_eyebrow, _title, content) => { body = content; }; controller.archiveTab = 'stories';
  controller.view.archive = { stories: [{ id: 'prologue', title: '已看序章', seen: true }, { id: 'chapter1-briefing', title: '本章任务简报', seen: false, available: true }, { id: 'epilogue', title: '未看尾声', seen: false, available: false }] };
  controller.renderArchive();
  const buttons = [...body.matchAll(/<button[^>]*data-action="story-replay"[^>]*>[^<]*<\/button>/g)].map(match => match[0]);
  assert.equal(buttons.length, 3);
  assert(!buttons[0].includes('disabled')); assert(buttons[0].includes('回看这一段'));
  assert(!buttons[1].includes('disabled')); assert(buttons[1].includes('查看任务简报'));
  assert(buttons[2].includes('disabled')); assert(buttons[2].includes('尚未解锁'));
  console.log('PASS archive permits reached chapter briefings while unseen story scenes remain locked');
}

// These are CSS safety contracts, not a claim of browser layout coverage.
// Real 844×390 viewport measurements remain part of the manual UI audit.
{
  const css = await readFile(new URL('../src/ui/ui-polish.css', import.meta.url), 'utf8');
  const mobileStart = css.lastIndexOf('@media (max-width: 900px), (max-height: 480px)');
  assert(mobileStart >= 0, 'short landscape gets mobile sizing even above 800px browser width');
  const mobile = css.slice(mobileStart);
  const rule = selector => {
    const offset = mobile.indexOf(selector); assert(offset >= 0, `mobile rule exists: ${selector}`);
    return mobile.slice(mobile.indexOf('{', offset) + 1, mobile.indexOf('}', offset));
  };
  const choices = rule('.menu-root.screen-story .story-choice-button {');
  assert.match(choices, /min-height:\s*44px/); assert.match(choices, /min-width:\s*120px/); assert.match(choices, /font-size:\s*13px/);
  assert.match(rule('.menu-root.screen-story .story-choice-button small'), /font-size:\s*11px/);
  const toolbar = rule('.menu-root.screen-story .story-heading .game-button');
  assert.match(toolbar, /min-width:\s*44px\s*!important/); assert.match(toolbar, /min-height:\s*44px/);
  assert.match(rule('.menu-root.screen-story .story-heading {'), /top:\s*max\(8px,\s*env\(safe-area-inset-top\)\)/);
  assert.match(rule('.ui-root .objective-toggle {'), /white-space:\s*nowrap/);
  assert.match(rule('.ui-root .hud-resource-strip .hud-badge b'), /font-size:\s*max\(12px,/);
  console.log('PASS short-landscape CSS contracts: readable story choices, 44px toolbar, safe top edge and 12px HUD figures (layout requires browser QA)');
}
