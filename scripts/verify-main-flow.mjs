import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// Run main's actual orchestration against the real game modules. Only the
// browser shell, drawing, audio and asset transport are replaced; no server or
// browser process is required for these integration regressions.
const mainURL = new URL('../src/main.mjs', import.meta.url);
const source = fs.readFileSync(mainURL, 'utf8');
let passed = 0, failed = 0;

async function harness() {
  const context = { console, performance, setTimeout, Blob, URL, Map, Set };
  for (const match of source.matchAll(/import \{ ([^}]+) \} from '([^']+)';/g)) {
    const module = await import(new URL(match[2], mainURL));
    for (const name of match[1].split(',').map(value => value.trim())) context[name] = module[name];
  }
  const items = new Map(), canvasEvents = new Map();
  context.browserStorage = () => ({
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
    removeItem: key => items.delete(key),
  });
  const canvas = {
    addEventListener: (name, handler) => canvasEvents.set(name, handler),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
  };
  context.document = {
    hidden: false,
    getElementById: id => id === 'game-canvas' ? canvas : { dataset: {} },
    addEventListener() {},
  };
  context.window = { matchMedia: () => ({ matches: false }), addEventListener() {} };
  // Story keyframes preload through new Image(); decode resolves asynchronously.
  context.Image = class {
    constructor() { this.onload = null; this.onerror = null; }
    set src(value) { this._src = value; queueMicrotask(() => this.onload?.()); }
    get src() { return this._src; }
    decode() { return Promise.resolve(); }
    get complete() { return true; }
    addEventListener() {}
  };
  context.requestAnimationFrame = () => {};
  context.GameUI = class {
    constructor() { this.screen = 'none'; this.toasts = []; }
    update(view) { this.view = view; }
    show(screen, payload) { this.screen = screen; this.payload = payload; }
    toast(text) { this.toasts.push(text); }
    setLoading() {}
    dialogue() {}
  };
  context.GameInput = class { clear() {} configure() {} sample() { return {}; } consume() {} };
  context.GameAudio = class { muted = false; configure() {} play() {} playMusic() {} playVoice() {} unlock() {} setPaused() {} setScene() {} stopAmbience() {} setAlertHigh() {} };
  context.renderCalls = 0;
  context.GameRenderer = class { render() { context.renderCalls++; } };
  const instrumented = source
    .replace(/^import[^\n]+\r?\n/gm, '')
    .replaceAll('import.meta.url', JSON.stringify(mainURL.href))
    .replace('void bootstrap();', '') + `
globalThis.api = {
  beginStory, finishStory, nextStory, storyChoice, act, frame, startWorld, worldEvent, playChapterIntro,
  get state() { return { storyPlayer, world, tutorial, settings, ui, core, archive, pendingChapterIntro }; },
  initAssets() { assets = { preload: async () => {} }; },
  setTutorialWorld(nextWorld, director) { world = nextWorld; tutorial = director; lesson = null; },
  setSkipSeen(value) { settings.skipSeenStory = value; },
  setQuality(value) { settings.quality = value; },
  setAuto(value) { settings.autoDialogue = value; }
};`;
  vm.createContext(context);
  vm.runInContext(instrumented, context, { filename: fileURLToPath(mainURL) });
  context.api.initAssets();
  context.api.setSkipSeen(false);
  return { api: context.api, context, canvasEvents };
}

async function test(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); }
}

function finishOpening(api) {
  api.finishStory();
  for (const id of ['observe', 'issue', 'evacuate']) { api.storyChoice(id); api.finishStory(); }
  api.nextStory();
}

function atCommandLesson(context) {
  const director = new context.TutorialDirector(1);
  for (const [type, payload] of [
    ['move', { reached: true }],
    ['climb', { reached: true, grounded: true, onPlatform: true }],
    ['jump', { grounded: true, crossedGap: true }],
    ['node-hit', { nodeId: 'lesson-node', attackId: 'dash-1', hp: 1 }],
    ['node-open', { nodeId: 'lesson-node', attackId: 'dash-2', hp: 0 }],
  ]) director.handleEvent(type, payload);
  assert.equal(director.current().id, 'grok-obstacle');
  return director;
}

function commandWorld() {
  return {
    selected: null, canConfirm: false, confirmed: 0,
    promptConfig: { precise: false, promptText: '', sequence: [] },
    map: { targets: [{ id: 'paper-window', teammate: 'Grok', x: 440, y: 490 }, { id: 'other-window', teammate: 'Grok', x: 900, y: 490 }] },
    trainingCredits: {}, snapshot() { return {}; },
    selectTeammate(name) { this.selected = name; this.commandPreview = { targetId: 'paper-window' }; return true; },
    selectTarget(id) { this.commandPreview = { targetId: id }; return true; },
    setPromptMode(value) { this.promptConfig.precise = value; return true; },
    setCondition() {},
    confirmCommand() { this.confirmed++; if (!this.canConfirm) return false; this.commandPreview = null; return true; },
  };
}

await test('opening requires three actual keyword choices, even when skipping animation', async () => {
  const { api } = await harness();
  await api.startWorld();
  assert.equal(api.state.storyPlayer.scene.id, 'prologue');
  assert.equal(api.state.storyPlayer.scene.duration, 30);
  api.finishStory();
  const index = api.state.storyPlayer.index;
  assert.equal(api.state.storyPlayer.scene.steps[index].choice.options[0].id, 'observe');
  api.nextStory(); assert.equal(api.state.storyPlayer.index, index);
  api.storyChoice('issue'); assert.equal(api.state.storyPlayer.choiceSelected, null);
  for (const id of ['observe', 'issue', 'evacuate']) { api.storyChoice(id); api.finishStory(); }
  assert.deepEqual(Array.from(api.state.storyPlayer.choices, entry => entry.id), ['observe', 'issue', 'evacuate']);
  assert.equal(api.state.storyPlayer.index, api.state.storyPlayer.scene.steps.length - 1);
  api.setAuto(true);
  const now = performance.now();
  for (let frame = 1; frame <= 100; frame++) api.frame(now + frame * 80);
  assert(api.state.storyPlayer, 'auto dialogue must still wait for Start after eight seconds');
  api.nextStory();
  assert.equal(api.state.storyPlayer, null);
  assert.equal(api.state.ui.screen, 'none');
  assert.equal(api.state.core.view().phase, 'playing');
  assert.equal(api.state.tutorial.current().id, 'move');
});

await test('real playChapterIntro sends chapter one directly from prologue to the playable lesson', async () => {
  const { api } = await harness();
  await api.startWorld({ showIntro: false });
  assert.equal(api.state.storyPlayer, null);
  api.playChapterIntro();
  assert.equal(api.state.storyPlayer.scene.id, 'prologue');
  finishOpening(api);
  assert.equal(api.state.storyPlayer, null, 'chapter1-briefing must not remain in the scene queue');
  assert.equal(api.state.ui.screen, 'none', 'the separate briefing screen must not block the first action');
  assert.equal(api.state.core.view().phase, 'playing');
  assert.equal(api.state.tutorial.current().id, 'move');
});

await test('an unfocused start keeps its pending intro and resumes through the real chapter-intro path', async () => {
  const { api, context } = await harness();
  context.document.hidden = true;
  await api.startWorld();
  assert.equal(api.state.pendingChapterIntro, true);
  assert.equal(api.state.storyPlayer, null);
  assert.equal(api.state.ui.screen, 'pause');
  context.document.hidden = false;
  await api.act('resume-play');
  assert.equal(api.state.pendingChapterIntro, false);
  assert.equal(api.state.storyPlayer.scene.id, 'prologue');
  finishOpening(api);
  assert.equal(api.state.storyPlayer, null);
  assert.equal(api.state.ui.screen, 'none');
  assert.equal(api.state.core.view().phase, 'playing');
  assert.equal(api.state.tutorial.current().id, 'move');
});

await test('command guidance follows explicit choices while alternate valid choices remain available', async () => {
  const { api, context, canvasEvents } = await harness(), world = commandWorld();
  const director = atCommandLesson(context);
  api.setTutorialWorld(world, director);
  await api.act('command-select', { teammate: 'Grok' });
  assert.equal(director.getState().guidedCommandStage, 1, 'nearest target does not count as a player choice');
  await api.act('prompt-mode', { precise: false });
  await api.act('prompt-target', { targetId: 'other-window' });
  canvasEvents.get('pointerdown')({ clientX: 900, clientY: 490 });
  assert.equal(director.getState().guidedCommandStage, 1);
  assert.equal(world.commandPreview.targetId, 'other-window', 'guidance never locks the target');
  canvasEvents.get('pointerdown')({ clientX: 440, clientY: 490 });
  assert.equal(director.getState().guidedCommandStage, 2);
  await api.act('prompt-mode', { precise: true });
  assert.equal(director.getState().guidedCommandStage, 2);
  assert.equal(world.promptConfig.precise, true, 'precise commands remain available during the default lesson');
  await api.act('prompt-mode', { precise: false });
  assert.equal(director.getState().guidedCommandStage, 3);
});

await test('failed world confirmation keeps the lesson retryable; only accepted execution commits', async () => {
  const { api, context } = await harness(), world = commandWorld();
  const director = atCommandLesson(context);
  api.setTutorialWorld(world, director);
  await api.act('command-select', { teammate: 'Grok' });
  await api.act('prompt-target', { targetId: 'paper-window' });
  await api.act('prompt-mode', { precise: false });
  await api.act('command-confirm');
  assert.equal(world.confirmed, 1);
  assert.equal(director.getState().guidedCommandStage, 3);
  world.canConfirm = true;
  await api.act('command-confirm');
  assert.equal(world.confirmed, 2);
  assert.equal(director.getState().guidedCommandStage, 4);
  assert.equal(director.current().id, 'grok-obstacle', 'execution still needs an actual obstacle receipt');
});

await test('Grok joins after real broken-barrier evidence, once per voyage, and respects skip-seen', async () => {
  const { api } = await harness();
  await api.startWorld(); finishOpening(api);
  const barrier = api.state.world.barriers.find(entry => entry.id === 'paper-window');
  const receipt = { id: 'test-grok', teammate: 'Grok', affected: { barriers: ['paper-window'] } };
  api.worldEvent('command-receipt', receipt);
  assert.equal(api.state.storyPlayer, null, 'preview geometry alone does not prove a broken barrier');
  barrier.broken = true;
  api.worldEvent('command-receipt', receipt);
  assert.equal(api.state.storyPlayer.scene.id, 'grok-join');
  assert.equal(api.state.storyPlayer.scene.duration, 7);
  api.finishStory();
  api.worldEvent('command-receipt', receipt);
  assert.equal(api.state.storyPlayer, null);
  api.setSkipSeen(true);
  api.beginStory('grok-join');
  assert.equal(api.state.storyPlayer, null);
});

await test('two real world hits reveal a route, and an explicit hint requests the complete guidance', async () => {
  const { api } = await harness();
  await api.startWorld(); finishOpening(api);
  const { world, core, tutorial } = api.state;
  const update = world.update.bind(world);
  let hits = 0;
  world.update = (dt, input) => {
    const result = update(dt, input);
    if (hits < 2) {
      const before = core.view().attempt.health;
      world.hurt(20);
      if (core.view().attempt.health < before) hits++;
    }
    return result;
  };
  const now = performance.now();
  for (let frame = 1; frame <= 140; frame++) api.frame(now + frame * 1000 / 60);
  assert.equal(hits, 2);
  assert.equal(tutorial.getState().hintLevel, 3);
  assert.equal(tutorial.getState().canShowRoute, true);
  assert(world.tutorialRoute.length > 0, 'the renderer receives route points after two actual hits');
  tutorial.restart();
  await api.act('tutorial-hint');
  assert.equal(tutorial.getState().hintLevel, 3);
  assert(api.state.ui.toasts.at(-1).includes('路线'));
});

await test('180 Hz callbacks draw 60 standard frames; overlays stay idle and quality changes resume immediately', async () => {
  const { api, context } = await harness();
  await api.startWorld({ showIntro: false });
  api.state.ui.show('none');
  api.setQuality('standard');
  for (let i = 0; i < 180; i++) api.frame(1000 + i * 1000 / 180);
  assert(context.renderCalls >= 59 && context.renderCalls <= 61, `standard drew ${context.renderCalls} frames`);
  let before = context.renderCalls;
  api.setQuality('high');
  for (let i = 0; i < 180; i++) api.frame(2000 + i * 1000 / 180);
  assert.equal(context.renderCalls - before, 180, 'high quality retains native refresh');
  before = context.renderCalls;
  api.setQuality('standard');
  for (let i = 0; i < 6; i++) api.frame(3000 + i * 1000 / 180);
  assert(context.renderCalls - before >= 1, 'switching back does not leave a future render deadline');
  for (const name of ['story', 'pause', 'title']) {
    api.state.ui.show(name); before = context.renderCalls;
    for (let i = 0; i < 180; i++) api.frame(4000 + i * 1000 / 180);
    assert.equal(context.renderCalls, before, `${name} keeps the last gameplay frame`);
  }
  api.state.ui.show('none'); context.document.hidden = true;
  before = context.renderCalls; api.frame(6000);
  assert.equal(context.renderCalls, before, 'hidden pages do not redraw');
  context.document.hidden = false; api.frame(6010);
  assert.equal(context.renderCalls, before + 1, 'returning to play draws immediately');
});

console.log(`Main flow: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
