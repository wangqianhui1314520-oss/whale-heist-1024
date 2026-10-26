/** Shared narrative art routes. Each beat has three separately authored images. */
export const STORY_ART_BEATS = Object.freeze(['opening', 'grok', 'claude', 'glm', 'broadcast', 'evacuation', 'epilogue']);
const STYLES = Object.freeze(['cinematic', 'stage', 'comic']);
export const STORY_ART_IMAGES = Object.freeze(STYLES.flatMap(style => STORY_ART_BEATS.map(beat => `assets/story/${style}/${beat}.webp`)));

const SCENES = Object.freeze({
  prologue: 'opening', intro: 'opening',
  'chapter1-briefing': 'grok', 'grok-join': 'grok',
  'chapter2-briefing': 'claude', 'claude-join': 'claude', 'claude-intro': 'claude',
  'chapter3-briefing': 'glm', 'glm-join': 'glm', 'glm-intro': 'glm',
  'chapter4-briefing': 'broadcast', 'chapter4-reveal': 'broadcast', 'chapter4-twist': 'broadcast',
  'chapter5-briefing': 'evacuation', 'chapter5-preparation': 'evacuation', 'final-preparation': 'evacuation',
  epilogue: 'epilogue', ending: 'epilogue',
});
const BACKDROPS = Object.freeze({
  'story-prologue': 'opening', 'boat-interior': 'opening', 'menu-background': 'opening',
  'story-grok': 'grok', 'harbor-dock': 'grok', 'harbor-server': 'grok',
  'recruitment-hall': 'claude', 'sorting-room': 'claude',
  'inspection-bridge': 'glm', 'audit-pipes': 'glm',
  'story-broadcast': 'broadcast', 'broadcast-room': 'broadcast', 'record-screen': 'broadcast',
  'story-evacuation': 'evacuation', 'rendezvous-front': 'evacuation', 'rendezvous-beacon': 'evacuation', 'remote-beacon': 'evacuation',
  'story-epilogue': 'epilogue', 'return-boat': 'epilogue', 'investigation-desk': 'epilogue', 'results-background': 'epilogue',
});

export function storyBeatFor(storyOrBackdrop = {}) {
  const story = typeof storyOrBackdrop === 'string' ? { backdrop: storyOrBackdrop } : storyOrBackdrop || {};
  // Scene identity wins over a line's speaker or its legacy reusable backdrop.
  const sceneId = String(story.sceneId || story.id || '');
  if (SCENES[sceneId]) return SCENES[sceneId];
  const chapter = sceneId.match(/^(?:chapter-|briefing-)([1-5])$/);
  if (chapter) return ['grok', 'claude', 'glm', 'broadcast', 'evacuation'][Number(chapter[1]) - 1];
  if (STORY_ART_BEATS.includes(story.beat)) return story.beat;
  const backdrop = String(story.backdrop || sceneId || '');
  if (STORY_ART_BEATS.includes(backdrop)) return backdrop;
  if (SCENES[backdrop] || BACKDROPS[backdrop]) return SCENES[backdrop] || BACKDROPS[backdrop];
  const imageBeat = backdrop.match(/\/(?:cinematic|stage|comic)\/([\w-]+)\.(?:png|webp)$/)?.[1];
  if (STORY_ART_BEATS.includes(imageBeat)) return imageBeat;
  if (/prologue|opening/.test(backdrop)) return 'opening';
  if (/evacuation|rendezvous/.test(backdrop)) return 'evacuation';
  if (/epilogue|investigation/.test(backdrop)) return 'epilogue';
  if (/broadcast/.test(backdrop)) return 'broadcast';
  if (/grok/.test(backdrop)) return 'grok';
  return ({ grok: 'grok', claude: 'claude', glm: 'glm' })[String(story.speaker || '').toLowerCase()] || 'opening';
}

export function storyArtFor(storyOrBackdrop, style = 'cinematic') {
  return `assets/story/${STYLES.includes(style) ? style : 'cinematic'}/${storyBeatFor(storyOrBackdrop)}.webp`;
}

/** A generated comic strip has three equal panels: observation, action, result. */
export function comicFrameFor(storyOrPanel = {}) {
  const story = typeof storyOrPanel === 'number' ? { index: storyOrPanel } : storyOrPanel || {};
  if (Number.isInteger(story.comicFrame)) return Math.max(0, Math.min(2, story.comicFrame));
  const index = Math.max(0, Number(story.index) || 0), total = Number(story.total);
  if (Number.isFinite(total) && total > 1) return total === 2 ? Math.min(2, index * 2) : Math.min(2, Math.floor(index / total * 3));
  return index % 3;
}
