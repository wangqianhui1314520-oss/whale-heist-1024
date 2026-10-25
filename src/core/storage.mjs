import { CHAPTERS, STORY_FLAGS } from './chapters.mjs';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'whale-heist:campaign:v1';
const MAX_SAVE_LENGTH = 128_000;
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const flagsValid = (flags) => Array.isArray(flags)
  && flags.length <= STORY_FLAGS.length && new Set(flags).size === flags.length
  && flags.every((flag) => STORY_FLAGS.includes(flag));

export function newCheckpoint() {
  return {
    version: SAVE_VERSION,
    campaign: { results: [], broadcastOn: true, storyFlags: ['briefing-published'], completed: false },
  };
}

/** Rebuild an allow-listed record instead of trusting JSON objects or stored totals. */
export function normalizeCheckpoint(raw) {
  if (!raw || raw.version !== SAVE_VERSION || !raw.campaign) return null;
  const campaign = raw.campaign;
  if (!Array.isArray(campaign.results) || campaign.results.length > CHAPTERS.length
      || typeof campaign.broadcastOn !== 'boolean' || typeof campaign.completed !== 'boolean'
      || campaign.completed !== (campaign.results.length === CHAPTERS.length)
      || !flagsValid(campaign.storyFlags) || !campaign.storyFlags.includes('briefing-published')) return null;
  const results = [];
  for (let i = 0; i < campaign.results.length; i += 1) {
    const value = campaign.results[i];
    if (!value || value.chapterId !== CHAPTERS[i].id || !value.breakdown || !value.events
        || typeof value.broadcastOn !== 'boolean' || !flagsValid(value.storyFlags)) return null;
    const score = value.breakdown;
    const counts = value.events;
    if (score.required !== 60 || ![0, 10, 20].includes(score.optional)
        || ![0, 5, 10].includes(score.collaboration)
        || !integer(score.lowAlert, 0, 10) || score.lowAlert % 2 !== 0
        || !integer(value.score, 60, 100)
        || value.score !== score.required + score.optional + score.collaboration + score.lowAlert
        || !Number.isFinite(value.elapsedMs) || value.elapsedMs < 0
        || !integer(value.failedAttempts, 0, 1_000_000)
        || !integer(counts.publicCommands, 0, 1000)
        || !integer(counts.publicDeliveries, 0, 1000)
        || !integer(counts.alarms, 0, 1000)
        || score.lowAlert !== Math.max(0, 10 - counts.alarms * 2)
        || value.exposureDelta !== Math.min(20, 2 * (counts.publicCommands + counts.publicDeliveries + counts.alarms))) return null;
    if (i === 3 && (!value.storyFlags.includes('return-beacon-ready') || value.broadcastOn)) return null;
    results.push({
      chapterId: value.chapterId, score: value.score,
      breakdown: { required: 60, optional: score.optional, collaboration: score.collaboration, lowAlert: score.lowAlert },
      events: { publicCommands: counts.publicCommands, publicDeliveries: counts.publicDeliveries, alarms: counts.alarms },
      exposureDelta: value.exposureDelta, elapsedMs: value.elapsedMs,
      failedAttempts: value.failedAttempts, broadcastOn: value.broadcastOn,
      storyFlags: [...value.storyFlags],
    });
  }
  if (results.length && campaign.broadcastOn !== results.at(-1).broadcastOn) return null;
  const expectedFlags = new Set(['briefing-published', ...results.flatMap((result) => result.storyFlags)]);
  if (campaign.storyFlags.length !== expectedFlags.size || !campaign.storyFlags.every((flag) => expectedFlags.has(flag))) return null;
  return { version: SAVE_VERSION, campaign: {
    results, broadcastOn: campaign.broadcastOn, storyFlags: [...campaign.storyFlags], completed: campaign.completed,
  } };
}

export function loadCheckpoint(storage) {
  if (!storage || typeof storage.getItem !== 'function') return { ok: false, reason: 'storage-unavailable', checkpoint: null };
  let serialized;
  try { serialized = storage.getItem(SAVE_KEY); }
  catch { return { ok: false, reason: 'storage-unavailable', checkpoint: null }; }
  if (serialized === null || serialized === undefined) return { ok: false, reason: 'missing', checkpoint: null };
  if (typeof serialized !== 'string' || serialized.length > MAX_SAVE_LENGTH) return { ok: false, reason: 'invalid-schema', checkpoint: null };
  let value;
  try { value = JSON.parse(serialized); }
  catch { return { ok: false, reason: 'invalid-json', checkpoint: null }; }
  if (value?.version !== SAVE_VERSION) return { ok: false, reason: 'unsupported-version', checkpoint: null };
  const checkpoint = normalizeCheckpoint(value);
  return checkpoint ? { ok: true, reason: null, checkpoint } : { ok: false, reason: 'invalid-schema', checkpoint: null };
}

export function saveCheckpoint(storage, checkpoint) {
  const safe = normalizeCheckpoint(checkpoint);
  if (!safe) return { ok: false, reason: 'invalid-schema' };
  if (!storage || typeof storage.setItem !== 'function') return { ok: false, reason: 'storage-unavailable' };
  try { storage.setItem(SAVE_KEY, JSON.stringify(safe)); return { ok: true, reason: null }; }
  catch { return { ok: false, reason: 'storage-unavailable' }; }
}

/** Access can throw in private/embedded browsing contexts; obtaining it is optional. */
export function browserStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
