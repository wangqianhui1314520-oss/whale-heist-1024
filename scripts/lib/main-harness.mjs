import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Controller integration with real rules/world/storage and an isolated browser shell.
// Every save in this harness is synthetic; it never reads a player's browser data.
const mainURL = new URL('../../src/main.mjs', import.meta.url);
const source = fs.readFileSync(mainURL, 'utf8');
export async function harness(options = {}) {
  const context = { console, performance, setTimeout, Blob, URL, Map, Set };
  for (const match of source.matchAll(/import \{ ([^}]+) \} from '([^']+)';/g)) {
    const module = await import(new URL(match[2], mainURL));
    for (const name of match[1].split(',').map(value => value.trim())) context[name] = module[name];
  }
  const items = new Map(options.initialItems), canvasEvents = new Map();
  const memory = {
    getItem: key => items.get(key) ?? null,
    setItem(key, value) { options.writeFault?.(key, 'set'); items.set(key, String(value)); },
    removeItem(key) { options.writeFault?.(key, 'remove'); items.delete(key); },
  };
  context.browserStorage = () => Object.hasOwn(options, 'storage') ? options.storage : memory;
  const canvas = {
    addEventListener: (name, handler) => canvasEvents.set(name, handler),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
  };
  context.document = {
    hidden: false, getElementById: id => id === 'game-canvas' ? canvas : { dataset: {} }, addEventListener() {},
  };
  context.window = { matchMedia: () => ({ matches: false }), addEventListener() {} };
  context.Image = class {
    set src(value) { this._src = value; queueMicrotask(() => this.onload?.()); }
    get src() { return this._src; }
    decode() { return Promise.resolve(); }
    get complete() { return true; }
  };
  context.requestAnimationFrame = () => {};
  context.GameUI = class {
    constructor() { this.screen = 'none'; this.toasts = []; }
    update(view) { this.view = view; }
    show(screen, payload) { this.screen = screen; this.payload = payload; }
    toast(text) { this.toasts.push(text); }
    setLoading() {} dialogue() {}
  };
  context.GameInput = class { clear() {} configure() {} sample() { return {}; } consume() {} };
  context.GameAudio = class { muted = false; configure() {} play() {} playMusic() {} playVoice() {} unlock() {} setPaused() {} setScene() {} stopAmbience() {} setAlertHigh() {} };
  context.GameRenderer = class { render() {} };
  const instrumented = source.replace(/^import[^\n]+\r?\n/gm, '')
    .replaceAll('import.meta.url', JSON.stringify(mainURL.href)).replace('void bootstrap();', '') + `
globalThis.api = {
  beginStory, finishStory, nextStory, storyChoice, act, frame, startWorld, worldEvent, persist, getView,
  get state() { return { storyPlayer, world, tutorial, lesson, settings, ui, core, archive, mode, checkpoint }; },
  initAssets() { assets = { preload: async () => {} }; }
};`;
  vm.createContext(context);
  vm.runInContext(instrumented, context, { filename: fileURLToPath(mainURL) });
  context.api.initAssets();
  return { api: context.api, context, canvasEvents, items, memory };
}
