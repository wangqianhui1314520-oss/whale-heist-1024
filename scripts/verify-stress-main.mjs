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
const stressSteps = Number(process.env.MSTRESS_STEPS || 2000);
const stressSeed = Number(process.env.MSTRESS_SEED || 0x5124);
assert(Number.isSafeInteger(stressSteps) && stressSteps >= 1 && stressSteps <= 1000000, 'MSTRESS_STEPS must be an integer from 1 to 1000000');
assert(Number.isSafeInteger(stressSeed) && stressSeed >= 0 && stressSeed <= 0xffffffff, 'MSTRESS_SEED must be a uint32');

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
  context.GameRenderer = class { render() {} };
  const instrumented = source
    .replace(/^import[^\n]+\r?\n/gm, '')
    .replaceAll('import.meta.url', JSON.stringify(mainURL.href))
    .replace('void bootstrap();', '') + `
globalThis.api = {
  beginStory, finishStory, nextStory, storyChoice, act, frame, startWorld, worldEvent, playChapterIntro, persist, getView,
  get state() { return { storyPlayer, world, tutorial, settings, ui, core, archive, pendingChapterIntro }; },
  initAssets() { assets = { preload: async () => {} }; },
  setTutorialWorld(nextWorld, director) { world = nextWorld; tutorial = director; lesson = null; },
  setSkipSeen(value) { settings.skipSeenStory = value; },
  setAuto(value) { settings.autoDialogue = value; }
};`;
  vm.createContext(context);
  vm.runInContext(instrumented, context, { filename: fileURLToPath(mainURL) });
  context.api.initAssets();
  context.api.setSkipSeen(false);
  return { api: context.api, context, canvasEvents, items };
}

async function test(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); }
}

await test('browsing menus before starting never manufactures an in-progress campaign', async () => {
  const { api } = await harness();
  assert.equal(api.getView().saveSummary.hasSave, false);
  await api.act('title');
  await api.act('settings-open');
  await api.act('settings-back');
  api.persist();
  assert.equal(api.getView().saveSummary.hasSave, false);
});

await test('chapter map returns to the title after a previously loaded world', async () => {
  const { api, context } = await harness();
  await api.act('demo-start', { chapterId: context.CHAPTERS[2].id });
  await api.act('title');
  await api.act('chapter-select');
  await api.act('overlay-back');
  assert.equal(api.state.ui.screen, 'title');
});

await test('incompatible room snapshots reset the whole attempt instead of mixing old cargo with a fresh world', async () => {
  const { api } = await harness();
  await api.startWorld({ showIntro: false });
  assert.equal(api.state.core.pickup('harbor-data-1').ok, true);
  const previousAttempt = api.state.core.view().attempt.attemptId;
  const state = { core: api.state.core.exportRuntime(), world: api.state.world.exportState(), tutorial: api.state.tutorial.serialize() };
  state.world.version = 999;
  await api.startWorld({ state, showIntro: false });
  assert.equal(api.state.core.view().attempt.inventory.length, 0);
  assert.notEqual(api.state.core.view().attempt.attemptId, previousAttempt);
  assert.equal(api.state.world.attemptId, api.state.core.view().attempt.attemptId);
  assert.equal(api.state.world.restoreState(api.state.world.exportState()).ok, true);
  api.frame(performance.now() + 4000);
  assert(api.state.ui.toasts.some(text => text.includes('不兼容')));
});

await test('loading an unavailable saved template keeps the archive paused', async () => {
  const { api, context } = await harness();
  await api.act('demo-start', { chapterId: context.CHAPTERS[2].id });
  const { world, archive } = api.state;
  world.map = { ...world.map, targets: [] };
  archive.templates.push({ id: 'empty-room', teammate: 'Grok', promptText: 'Grok，撞开纸窗。', plan: { teammate: 'Grok', targetId: 'missing', precise: false } });
  await api.act('archive-open');
  await api.act('template-load', { templateId: 'empty-room' });
  assert.equal(api.state.ui.screen, 'archive');
  assert.equal(api.state.core.view().phase, 'paused');
});

let transitions = 0;
await test(`${stressSteps} seeded menu, command, replay, retry and invalid-import transitions preserve usable state`, async () => {
  const { api, context } = await harness();
  let seed = stressSeed;
  const random = size => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % size; };
  const pick = values => values[random(values.length)];
  const run = async (action, payload = {}) => { await api.act(action, payload); transitions++; api.frame(performance.now() + transitions * 17); };
  await run('title');
  for (let index = 0; index < stressSteps; index++) {
    const { ui, core, world, storyPlayer } = api.state;
    switch (ui.screen) {
      case 'title': await run(pick(['chapter-select', 'settings-open', 'help', 'archive-open'])); break;
      case 'chapter-select': await run('demo-start', { chapterId: pick(context.CHAPTERS).id }); break;
      case 'none': await run(pick(['pause', 'map-open', 'archive-open', 'records-open', 'analysis-open', 'command-select']), { teammate: pick(core.view().chapter.teammates) }); break;
      case 'pause': await run(pick(['resume-play', 'retry-checkpoint', 'retry', 'settings-open', 'help', 'title', 'map-open'])); break;
      case 'settings': if (random(4)) await run('settings-change', { key: pick(['masterVolume', 'touchSize', 'subtitleScale', 'invalid']), value: pick([0, 1, 1.5, 'bad', Infinity, -30]) }); else await run('settings-back'); break;
      case 'command': {
        const entry = pick(world.map.targets);
        const action = pick(['prompt-mode', 'prompt-target', 'prompt-condition', 'prompt-parse', 'command-confirm', 'command-cancel']);
        await run(action, action === 'prompt-mode' ? { precise: Boolean(random(2)) } : action === 'prompt-target' ? { targetId: entry?.id || 'missing' } : action === 'prompt-condition' ? { condition: pick(['none', 'guard-turn', 'lift-ready']) } : action === 'prompt-parse' ? { text: pick(['', 'not a valid instruction <>', 'GLM，只扫描前方窄区。']) } : {});
        break;
      }
      case 'map': if (random(4) === 0) await run('story-replay', { sceneId: `chapter${core.view().chapter.number}-briefing` }); else await run('overlay-back'); break;
      case 'story': {
        const choice = storyPlayer?.scene.steps[storyPlayer.index]?.choice?.options?.[0];
        if (choice) await run('story-choice', { choiceId: choice.id });
        await run(pick(['story-next', 'story-skip'])); break;
      }
      case 'archive': case 'records': case 'analysis': case 'help': await run('overlay-back'); break;
      case 'failure': await run('retry'); break;
      case 'briefing': await run('briefing-start'); break;
      default: throw new Error(`Unexpected screen ${ui.screen}`);
    }
    assert.doesNotThrow(() => api.getView());
    const next = api.state;
    if (next.world && ['none', 'command'].includes(next.ui.screen)) assert.equal(next.core.view().phase, 'playing', `stuck after ${index}`);
    if (next.core.view().attempt) {
      assert(Number.isFinite(next.world?.player.x ?? 0));
      assert(Number.isFinite(next.world?.player.y ?? 0));
      assert(next.core.view().attempt.aiTokens >= 0);
    }
    if (index % 41 === 0) {
      const before = JSON.stringify(api.getView().saveSummary);
      await run('save-import', { text: pick(['{bad', '{"format":"wrong"}', '', 'null']) });
      assert.equal(JSON.stringify(api.getView().saveSummary), before);
    }
  }
});

console.log(JSON.stringify({ suite: 'main-stress', passed, failed, transitions, stressSteps, stressSeed }));
if (failed) process.exitCode = 1;

