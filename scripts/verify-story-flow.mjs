/** Drive the real main.mjs story controller without a browser or VM module flags.
 * Rendering, input and physical-world coverage remain in their dedicated scripts.
 * The VM only replaces platform adapters; story, core, settings and saves are real.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as coreModule from '../src/core/state.mjs';
import * as chapterModule from '../src/core/chapters.mjs';
import * as storageModule from '../src/core/storage.mjs';
import * as experienceModule from '../src/core/experience-storage.mjs';
import * as sessionModule from '../src/game/session.mjs';
import * as preferencesModule from '../src/game/preferences.mjs';
import * as storyModule from '../src/game/story.mjs';
import * as tutorialModule from '../src/game/tutorial.mjs';
import * as lessonModule from '../src/game/lesson-bridge.mjs';
import * as promptModule from '../src/game/prompts.mjs';
import * as contractModule from '../src/game/contracts.mjs';
import * as mapModule from '../src/game/maps.mjs';
import * as recordTriageModule from '../src/game/record-triage.mjs';
import * as storyArtModule from '../src/game/story-art.mjs';
import { sceneImageKeys } from '../src/render/scene-renderer.mjs';

const sourceUrl = new URL('../src/main.mjs', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const data = new Map(), writes = [];
const memory = {
  getItem: key => data.get(key) ?? null,
  setItem: (key, value) => { data.set(key, String(value)); writes.push(key); },
  removeItem: key => { data.delete(key); writes.push(key); },
};
const element = { dataset: {}, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) };
const document = { hidden: false, getElementById: () => element, addEventListener() {} };
const orientation = { matches: false, addEventListener() {} };
const window = { matchMedia: () => orientation, addEventListener() {} };

class FakeUI {
  screen = 'title'; payload = {}; view = null; history = []; toasts = [];
  constructor(options) { this.options = options; }
  update(view) { this.view = view; }
  show(screen, payload = {}) { this.screen = screen; this.payload = payload; this.history.push(screen); }
  toast(text) { this.toasts.push(text); }
  setLoading() {}
  dialogue() {}
}
class FakeInput {
  constructor() { this.clears = 0; }
  clear() { this.clears++; }
  configure() {}
  consume() {}
  sample() { return {}; }
  releaseInteraction() {}
}
class FakeAudio {
  muted = false; paused = false; alertHigh = false; sounds = []; music = []; ambience = []; voices = [];
  configure() {}
  unlock() {}
  setScene() {}
  setPaused(value) { this.paused = value; }
  play(name) { this.sounds.push(name); }
  playMusic(id) { this.music.push(id); }
  playAmbience(id) { this.ambience.push(id); }
  stopAmbience(id) { this.ambience.push('stop:' + id); }
  playVoice(role, kind) { this.voices.push(kind ? `${role}_${kind}` : role); }
  setAlertHigh(high) { this.alertHigh = Boolean(high); }
}
class FakeImage {
  constructor() { this.complete = true; this.decoding = 'async'; }
  addEventListener() {}
  decode() { return Promise.resolve(); }
}
class FakeWorld {
  records = []; receipts = []; barriers = []; crew = []; updates = 0;
  constructor(core, map) {
    this.core = core; this.map = map; this.currentRoom = { id: `${map.id}:room-1`, name: '测试入口', index: 1 };
    this.rooms = [this.currentRoom]; this.visited = new Set([this.currentRoom.id]);
    this.player = { x: 85, y: 600, w: 28, grounded: true }; this.platforms = map.platforms;
    this.trainingCredits = {}; this.promptConfig = {}; this.selected = null;
  }
  snapshot() { return {}; }
  exportState() { return { roomId: this.currentRoom.id, time: 0, records: [] }; }
  restoreState() { return { ok: true }; }
  update(seconds) { this.updates++; this.core.advanceTime(seconds * 1000); }
  cancelPreview() {}
}
class FakeRenderer { render() {} }

const context = vm.createContext({
  ...coreModule, ...chapterModule, ...storageModule, ...experienceModule,
  ...sessionModule, ...preferencesModule, ...storyModule, ...tutorialModule,
  ...lessonModule, ...promptModule, ...contractModule, ...mapModule,
  ...recordTriageModule, ...storyArtModule, sceneImageKeys,
  GameUI: FakeUI, GameInput: FakeInput, GameAudio: FakeAudio, GameWorld: FakeWorld, GameRenderer: FakeRenderer, Image: FakeImage,
  browserStorage: () => memory, document, window, console, URL, Blob, performance: { now: () => 1000 },
  requestAnimationFrame() {}, setTimeout() {}, __memory: memory,
});
const executable = source
  .replace(/^import\s+.*?\s+from\s+['"][^'"]+['"];[ \t]*\r?$/gm, '')
  .replaceAll('import.meta.url', JSON.stringify(sourceUrl.href))
  .replace(/^void bootstrap\(\);[ \t]*\r?$/m, '');
vm.runInContext(executable + `
globalThis.controller = {
 beginStory, finishStory, nextStory, storyChoice, sequenceStories, startWorld,
 act, frame, worldEvent, openOverlay, overlayBack, persist,
 get player(){return storyPlayer;}, get ui(){return ui;}, get core(){return core;},
 get world(){return world;}, get archive(){return archive;}, get settings(){return settings;},
 reset({chapter=1,seen=[],autoDialogue=false,skipSeenStory=true,worldReady=false}={}){
  settings=normalizeSettings({autoDialogue,skipSeenStory});
  archive={version:3,seenStories:[...seen],records:[],templates:[]};
  core=new GameCore({checkpoint:chapterCheckpoint(CHAPTERS[chapter-1].id),storage:null,persist:false});
  world=worldReady?new GameWorld(core,getMap(core.view().chapter.id)):null;
  renderer=null; tutorial=null; lesson=null; checkpoint=null; storyPlayer=null; storyAfter=null; pendingChapterIntro=false;
  mode='campaign'; busy=false; loadSequence=0; pauseAfterLoad=false; lastFrame=0; lastUI=0; lastAutosave=0; accumulator=0;
  preparationSeen=false; grokJoinPlayed=false; trainingUsed=false; overlayStack=[]; noticeQueue=[];
  assets={preload:async (_keys,onProgress)=>onProgress?.(1)};
  ui.screen='archive'; ui.payload={}; ui.history=[]; ui.toasts=[];
 },
 setSettings(patch){settings=normalizeSettings({...settings,...patch});},
 setIndex(index){storyPlayer.index=index;storyPlayer.elapsed=0;storyPlayer.choiceSelected=null;},
 reload(){
  world=null; renderer=null; tutorial=null; lesson=null; checkpoint=null; storyPlayer=null; storyAfter=null;
  pendingChapterIntro=false; busy=false; loadSequence=0; pauseAfterLoad=false; overlayStack=[]; noticeQueue=[];
  lastFrame=0; lastUI=0; lastAutosave=0; accumulator=0; archive=loadArchive(storage);
  ui.screen='title'; ui.payload={}; ui.history=[]; ui.toasts=[];
 },
};`, context, { filename: sourceUrl.pathname });
const c = context.controller;
let passed = 0;
const failures = [];
const json = value => JSON.stringify(value);
const reset = options => { data.clear(); writes.length = 0; document.hidden = false; orientation.matches = false; c.reset(options); };
const test = async (name, check) => {
  try { await check(); passed++; console.log('PASS ' + name); }
  catch (error) { failures.push(name); console.error('FAIL ' + name + '\n' + error.stack); }
};
function finishCurrent() {
  const id = c.player?.scene.id;
  for (let limit = 0; limit < 50 && c.player?.scene.id === id; limit++) {
    const current = c.player.scene.steps[c.player.index];
    if (current.choice) c.storyChoice(current.choice.options[0].id);
    c.nextStory();
  }
  assert.notEqual(c.player?.scene.id, id, `Scene ${id} did not finish`);
}
function frames(count = 200) {
  for (let index = 0; index < count; index++) c.frame(1000 + index * 80);
}

await test('all controller scene references and all chapter briefings resolve to complete scenes', () => {
  const referenced = [...source.matchAll(/beginStory\(['"]([^'"]+)['"]/g)].map(match => match[1]);
  referenced.push('prologue', 'grok-join', 'claude-join', 'glm-join');
  for (let number = 1; number <= 5; number++) referenced.push(`chapter${number}-briefing`);
  for (const id of new Set([...referenced, ...Object.keys(storyModule.STORY_SCENES)])) {
    const scene = storyModule.getStoryScene(id);
    assert(scene?.steps.length > 0, id);
    assert.equal(scene.duration, scene.steps.reduce((sum, step) => sum + step.duration, 0), id);
    for (const step of scene.steps) {
      for (const key of ['speaker', 'text', 'pose', 'backdrop']) assert.equal(typeof step[key], 'string', `${id}.${key}`);
      assert(step.duration > 0, id);
    }
  }
});

await test('first chapter enters hands-on teaching immediately after the confirmed opening', async () => {
  reset(); await c.startWorld();
  assert.equal(c.player?.scene.id, 'prologue');
  assert.equal(c.core.view().phase, 'paused');
  finishCurrent(); assert.equal(c.player, null);
  assert.equal(c.ui.screen, 'none'); assert.equal(c.core.view().phase, 'playing');
});

await test('chapters two and three play their join scene, briefing scene and mission briefing', async () => {
  for (const [chapter, join] of [[2, 'claude-join'], [3, 'glm-join']]) {
    reset({ chapter }); await c.startWorld(); assert.equal(c.player?.scene.id, join);
    finishCurrent(); assert.equal(c.player?.scene.id, `chapter${chapter}-briefing`);
    finishCurrent(); assert.equal(c.ui.screen, 'briefing');
  }
});

await test('chapter-four briefing starts its reveal and chapter-five briefing leads into play', async () => {
  reset({ chapter: 4 }); await c.startWorld(); assert.equal(c.player?.scene.id, 'chapter4-briefing');
  finishCurrent(); assert.equal(c.ui.screen, 'briefing');
  await c.act('briefing-start'); assert.equal(c.player?.scene.id, 'chapter4-reveal');
  finishCurrent(); assert.equal(c.ui.screen, 'none'); assert.equal(c.core.view().phase, 'playing');
  reset({ chapter: 5 }); await c.startWorld(); assert.equal(c.player?.scene.id, 'chapter5-briefing');
  finishCurrent(); await c.act('briefing-start'); assert.equal(c.ui.screen, 'none');
});

await test('skipping the first prologue cannot bypass required choices or its start confirmation', () => {
  reset(); let completed = 0; c.beginStory('prologue', () => completed++);
  for (const choice of ['observe', 'issue', 'evacuate']) {
    c.finishStory(); const index = c.player.index;
    assert.equal(c.player.scene.steps[index].choice.options[0].id, choice);
    c.nextStory(); assert.equal(c.player.index, index);
    c.storyChoice('unrecognized-choice'); assert.equal(c.player.choiceSelected, null);
    c.storyChoice(choice); assert.equal(c.player.choiceSelected, choice);
  }
  c.finishStory(); assert.equal(c.player.index, c.player.scene.steps.length - 1);
  assert.equal(completed, 0); assert.equal(c.archive.seenStories.includes('prologue'), false);
  c.nextStory(); assert.equal(completed, 1); assert.equal(c.archive.seenStories.includes('prologue'), true);
});

await test('automatic dialogue waits at each choice and at the first opening start confirmation', () => {
  reset({ autoDialogue: true }); let completed = 0; c.beginStory('prologue', () => completed++);
  for (const choice of ['observe', 'issue', 'evacuate']) {
    const index = c.player.scene.steps.findIndex(step => step.choice?.options.some(option => option.id === choice));
    c.setIndex(index); frames(); assert.equal(c.player.index, index); assert.equal(completed, 0);
    c.storyChoice(choice);
  }
  c.setIndex(c.player.scene.steps.length - 1); frames();
  assert(c.player); assert.equal(completed, 0); c.nextStory(); assert.equal(completed, 1);
});

await test('hidden pages, portrait orientation and overlays pause automatic story advancement', () => {
  for (const pause of ['hidden', 'portrait', 'overlay']) {
    reset({ autoDialogue: true }); c.beginStory('chapter2-briefing', () => {});
    if (pause === 'hidden') document.hidden = true;
    else if (pause === 'portrait') orientation.matches = true;
    else c.openOverlay('settings');
    frames(); assert.equal(c.player.index, 0, pause); assert.equal(c.player.elapsed, 0, pause);
  }
});

await test('plot playback leaves world time, resources, objectives and records unchanged', () => {
  reset({ worldReady: true, autoDialogue: true });
  c.beginStory('chapter4-reveal', () => {});
  const before = json(c.core.exportRuntime()), recordBefore = json(c.archive.records);
  frames(20); assert.equal(c.world.updates, 0); assert.equal(json(c.core.exportRuntime()), before);
  assert.equal(json(c.archive.records), recordBefore);
});

await test('seen static scenes skip, while each dynamic scene rebuilds and plays from current state', () => {
  reset({ seen: ['chapter2-briefing', 'chapter4-reveal', 'chapter5-preparation', 'epilogue'] });
  let skipped = 0; c.beginStory('chapter2-briefing', () => skipped++); assert.equal(skipped, 1); assert.equal(c.player, null);
  for (const id of ['chapter4-reveal', 'chapter5-preparation', 'epilogue']) {
    c.beginStory(id, () => {}); assert.equal(c.player?.scene.id, id);
    assert(c.player.scene.steps.length > 0); c.finishStory();
  }
});

await test('replaying every scene is read-only for campaign, archive, best score and all storage', async () => {
  for (const worldReady of [false, true]) {
    for (const id of Object.keys(storyModule.STORY_SCENES)) {
      reset({ worldReady }); c.core.setPaused(true); c.ui.show('archive', { tab: 'story' });
      const before = json(c.core.exportRuntime()), archiveBefore = json(c.archive), persistedBefore = json([...data]);
      const writeCount = writes.length;
      await c.act('story-replay', { sceneId: id }); assert.equal(c.player?.scene.id, id);
      c.finishStory(); assert.equal(c.player, null); assert.equal(c.ui.screen, 'archive');
      assert.equal(json(c.core.exportRuntime()), before, id);
      assert.equal(json(c.archive), archiveBefore, id); assert.equal(json([...data]), persistedBefore, id);
      assert.equal(writes.length, writeCount, id);
    }
  }
});

await test('closing a title-screen story replay preserves the saved world before that world is loaded', async () => {
  reset({ chapter: 2 }); await c.startWorld(); c.persist();
  const savedBefore = json([...data]), writeCount = writes.length;
  c.reload();
  await c.act('story-replay', { sceneId: 'prologue' }); c.finishStory();
  c.persist(); // beforeunload also runs while browsing an archive from the title.
  assert.equal(json([...data]), savedBefore);
  assert.equal(writes.length, writeCount);
});

await test('chapter briefings unlock through the current chapter and remain accessible from archive and task map', async () => {
  for (let chapter = 1; chapter <= 5; chapter++) {
    reset({ chapter, worldReady: true }); c.core.setPaused(true); c.openOverlay('archive');
    for (let number = 1; number <= 5; number++) {
      const id = `chapter${number}-briefing`;
      const entry = c.ui.view.archive.stories.find(story => story.id === id);
      assert(entry, id); assert.equal(entry.available, number <= chapter, `${chapter}.${id}`);
      if (number <= chapter) {
        const persistedBefore = json([...data]), archiveBefore = json(c.archive), coreBefore = json(c.core.exportRuntime());
        await c.act('story-replay', { sceneId: id }); assert.equal(c.player?.scene.id, id);
        finishCurrent(); assert.equal(c.ui.screen, 'archive');
        assert.equal(json([...data]), persistedBefore); assert.equal(json(c.archive), archiveBefore);
        assert.equal(json(c.core.exportRuntime()), coreBefore);
      }
    }
  }
  reset({ worldReady: true }); c.ui.show('none'); c.openOverlay('map');
  await c.act('story-replay', { sceneId: 'chapter1-briefing' }); assert.equal(c.player?.scene.id, 'chapter1-briefing');
  finishCurrent(); assert.equal(c.ui.screen, 'map'); assert.equal(c.core.view().phase, 'paused');
});

await test('portrait-load pause preserves the complete first chapter introduction after resume', async () => {
  reset(); orientation.matches = true; await c.startWorld();
  assert.equal(c.ui.screen, 'pause'); assert.equal(c.player, null);
  orientation.matches = false; await c.act('resume-play');
  assert.equal(c.player?.scene.id, 'prologue');
  finishCurrent(); assert.equal(c.player, null); assert.equal(c.ui.screen, 'none');
  assert.equal(c.core.view().phase, 'playing');
});

await test('Grok join needs an actual first-chapter paper-window success and only plays once', () => {
  reset({ worldReady: true });
  c.world.barriers = [{ id: 'paper-window', broken: false }];
  const receipt = { teammate: 'Grok', affected: { barriers: ['paper-window'] } };
  c.worldEvent('command-receipt', receipt); assert.equal(c.player, null);
  c.world.barriers[0].broken = true;
  c.worldEvent('command-receipt', { ...receipt, failed: true }); assert.equal(c.player, null);
  c.worldEvent('command-receipt', receipt); assert.equal(c.player?.scene.id, 'grok-join');
  finishCurrent(); c.worldEvent('command-receipt', receipt); assert.equal(c.player, null);
});

await test('an interrupted first opening restores its current line, chosen keywords and direct teaching destination', async () => {
  reset(); await c.startWorld();
  for (let index = 0; index < 3; index++) c.nextStory();
  assert.equal(c.player.scene.steps[c.player.index].choice.options[0].id, 'observe');
  c.storyChoice('observe');
  let stored = experienceModule.loadExperience(memory);
  assert.equal(stored.ok, true); assert.equal(stored.value.story.index, 3);
  assert.equal(stored.value.story.choices.find(entry => entry.step === 3)?.id, 'observe');
  c.reload(); await c.act('resume');
  assert.equal(c.player?.scene.id, 'prologue'); assert.equal(c.player.index, 3);
  assert.equal(c.player.choiceSelected, 'observe', 'a confirmed current choice does not need another click after reload');
  c.nextStory();
  stored = experienceModule.loadExperience(memory);
  assert.equal(stored.value.story.sceneId, 'prologue'); assert.equal(stored.value.story.index, 4);
  assert.equal(json(stored.value.story.following), json([]));
  assert.equal(stored.value.story.destination, 'play');
  const textBefore = c.player.scene.steps[4].text;
  c.reload(); await c.act('resume');
  assert.equal(c.player?.scene.id, 'prologue'); assert.equal(c.player.index, 4);
  assert.equal(c.player.scene.steps[c.player.index].text, textBefore);
  assert.equal(c.player.choices.find(entry => entry.step === 3)?.id, 'observe');
  assert.equal(json(c.player.following), json([]));
  assert.equal(c.core.view().phase, 'paused');
  c.finishStory();
  assert.equal(c.player.scene.steps[c.player.index].choice.options[0].id, 'issue', 'completed observe is retained, but issue is still mandatory');
  const issueIndex = c.player.index;
  assert.equal(experienceModule.loadExperience(memory).value.story.index, issueIndex, 'skip-to-choice must persist the visible line');
  c.reload(); await c.act('resume');
  assert.equal(c.player.index, issueIndex); assert.equal(c.player.choiceSelected, null);
  const waitingIndex = c.player.index; c.nextStory(); assert.equal(c.player.index, waitingIndex);
  finishCurrent(); assert.equal(c.player, null); assert.equal(c.ui.screen, 'none'); assert.equal(c.core.view().phase, 'playing');
  assert.equal(experienceModule.loadExperience(memory).value.story, null);
});

await test('interrupting a join scene preserves its following chapter briefing through two resumptions', async () => {
  reset({ chapter: 2 }); await c.startWorld(); c.nextStory();
  assert.equal(c.player?.scene.id, 'claude-join'); assert.equal(c.player.index, 1);
  c.reload(); await c.act('resume');
  assert.equal(c.player?.scene.id, 'claude-join'); assert.equal(c.player.index, 1);
  assert.equal(json(c.player.following), json(['chapter2-briefing']));
  finishCurrent(); assert.equal(c.player?.scene.id, 'chapter2-briefing');
  c.nextStory(); c.reload(); await c.act('resume');
  assert.equal(c.player?.scene.id, 'chapter2-briefing'); assert.equal(c.player.index, 1);
  assert.equal(c.player.destination, 'briefing');
  finishCurrent(); assert.equal(c.ui.screen, 'briefing'); assert.equal(c.core.view().phase, 'paused');
});

await test('an interrupted chapter-four reveal restores its actual-record line and finishes into play', async () => {
  reset({ chapter: 4 }); await c.startWorld(); finishCurrent();
  c.worldEvent('record', { id: 'chapter4-receipt', type: 'command', teammate: 'Grok', targetId: 'archive-gate', public: true,
    promptText: 'Grok，处理已登记的档案门。', elapsedMs: 12000 });
  await c.act('briefing-start'); assert.equal(c.player?.scene.id, 'chapter4-reveal');
  c.nextStory(); assert.equal(c.player.index, 1);
  const before = { text: c.player.scene.steps[1].text, sourceRecordIds: [...c.player.scene.sourceRecordIds], branch: c.player.scene.branch };
  const stored = experienceModule.loadExperience(memory);
  assert.equal(stored.value.story.sceneId, 'chapter4-reveal'); assert.equal(stored.value.story.index, 1);
  assert.equal(json(stored.value.story.following), json([])); assert.equal(stored.value.story.destination, 'play');
  c.reload(); await c.act('resume');
  assert.equal(c.player?.scene.id, 'chapter4-reveal'); assert.equal(c.player.index, 1);
  assert.equal(c.player.scene.steps[1].text, before.text);
  assert.equal(json(c.player.scene.sourceRecordIds), json(before.sourceRecordIds)); assert.equal(c.player.scene.branch, before.branch);
  assert.equal(c.core.view().phase, 'paused');
  finishCurrent(); assert.equal(c.ui.screen, 'none'); assert.equal(c.core.view().phase, 'playing');
  assert.equal(experienceModule.loadExperience(memory).value.story, null);
});

await test('malformed optional story data is ignored without invalidating the saved campaign or world', async () => {
  reset(); await c.startWorld();
  const valid = experienceModule.loadExperience(memory).value;
  assert(valid.current); assert(valid.checkpoint); assert(valid.story);
  const invalidStories = [
    null,
    { ...valid.story, sceneId: 'unknown-story' },
    { ...valid.story, sceneId: 'chapter4-reveal' },
    { ...valid.story, index: -1 },
    { ...valid.story, index: '1' },
    { ...valid.story, choices: null },
    { ...valid.story, choices: [null] },
    { ...valid.story, choices: [{}] },
    { ...valid.story, choices: [{ step: 3, id: 42 }] },
    { ...valid.story, following: ['unknown-story'] },
    { ...valid.story, following: ['chapter4-briefing'] },
    { ...valid.story, destination: 'unknown-screen' },
  ];
  for (const [index, story] of invalidStories.entries()) {
    const raw = { ...valid, story }, text = json(raw), writeCount = writes.length;
    data.set(experienceModule.EXPERIENCE_KEY, text);
    const loaded = experienceModule.loadExperience(memory);
    assert.equal(loaded.ok, true, `dirty story ${index} must not discard the whole experience`);
    assert.equal(loaded.value.story, null, `dirty story ${index}`);
    for (const key of ['campaign', 'current', 'checkpoint']) assert.equal(json(loaded.value[key]), json(valid[key]), `${index}.${key}`);
    assert.equal(memory.getItem(experienceModule.EXPERIENCE_KEY), text, 'reading must not overwrite the original save');
    assert.equal(writes.length, writeCount);
    const imported = experienceModule.parseSave(json({ format: 'whale-heist-save', version: 2,
      campaign: valid.campaign, experience: raw, archive: {} }));
    assert.equal(imported.ok, true, `dirty story ${index} must remain importable`);
    assert.equal(imported.experience.story, null);
  }
});

console.log(`Story flow: ${passed} passed, ${failures.length} failed. This exercises the real controller; it does not verify visual layout or human completion time.`);
if (failures.length) process.exitCode = 1;
