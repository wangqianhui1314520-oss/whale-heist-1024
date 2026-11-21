import { CHAPTERS, STORY_FLAGS } from './chapters.mjs';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'whale-heist:campaign:v1';
export const SAVE_TRANSACTION_KEY = 'whale-heist:save-transaction:v1';
const TRANSACTION_KEYS = [SAVE_KEY, 'whale-heist:experience:v2', 'whale-heist:archive:v3', 'whale-heist:experience:backup:v2'];
const MAX_SAVE_LENGTH = 128_000;
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const flagsValid = (flags) => Array.isArray(flags)
  && flags.length <= STORY_FLAGS.length && new Set(flags).size === flags.length
  && flags.every((flag) => STORY_FLAGS.includes(flag));

function pendingTransaction(storage) {
  const text = storage.getItem(SAVE_TRANSACTION_KEY);
  if (text == null) return null;
  const value = JSON.parse(text);
  if (value?.version !== 1 || !value.previous || Object.keys(value.previous).length !== TRANSACTION_KEYS.length
      || !TRANSACTION_KEYS.every(key => Object.hasOwn(value.previous, key)
        && (value.previous[key] === null || typeof value.previous[key] === 'string'))) throw new Error('Invalid save transaction');
  return value.previous;
}

/** An unfinished import always reads as the original save, even if rollback is temporarily blocked. */
export function readSaveItem(storage, key) {
  if (!storage) return null;
  const previous = pendingTransaction(storage);
  return previous && Object.hasOwn(previous, key) ? previous[key] : storage.getItem(key);
}

export function recoverSaveTransaction(storage) {
  try {
    if (!storage) return false;
    const previous = pendingTransaction(storage);
    if (!previous) return true;
    // Free changed values before restoring originals, so quota failures can recover.
    for (const key of TRANSACTION_KEYS) {
      if (storage.getItem(key) !== previous[key]) storage.removeItem(key);
    }
    for (const key of TRANSACTION_KEYS) {
      if (previous[key] !== null && storage.getItem(key) !== previous[key]) storage.setItem(key, previous[key]);
      if (storage.getItem(key) !== previous[key]) return false;
    }
    storage.removeItem(SAVE_TRANSACTION_KEY);
    return storage.getItem(SAVE_TRANSACTION_KEY) == null;
  } catch { return false; }
}

/** The journal's removal commits all save records together; failures preserve their previous logical values. */
export function writeSaveTransaction(storage, values) {
  if (!storage || !TRANSACTION_KEYS.every(key => Object.hasOwn(values, key)
      && (values[key] === null || typeof values[key] === 'string'))
      || !recoverSaveTransaction(storage)) return { ok: false, reason: 'storage-unavailable' };
  try {
    const previous = Object.fromEntries(TRANSACTION_KEYS.map(key => [key, storage.getItem(key) ?? null]));
    const journal = JSON.stringify({ version: 1, previous });
    storage.setItem(SAVE_TRANSACTION_KEY, journal);
    if (storage.getItem(SAVE_TRANSACTION_KEY) !== journal) throw new Error('Save journal was not written');
    for (const key of TRANSACTION_KEYS) {
      if (values[key] === null) storage.removeItem(key); else storage.setItem(key, values[key]);
      if (storage.getItem(key) !== values[key]) throw new Error('Save record was not written');
    }
    storage.removeItem(SAVE_TRANSACTION_KEY);
    if (storage.getItem(SAVE_TRANSACTION_KEY) != null) throw new Error('Save transaction was not committed');
    return { ok: true };
  } catch {
    recoverSaveTransaction(storage);
    return { ok: false, reason: 'storage-unavailable' };
  }
}

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
    const chapterFour = value.chapterId === 'public-report';
    // Legacy chapter-four results predate the explicit broadcast price. They
    // were all closed-broadcast runs, so a missing entry reads as 0.
    const broadcast = score.broadcast === undefined ? 0 : score.broadcast;
    const publicLeaks = counts.publicLeaks === undefined ? 0 : counts.publicLeaks;
    if (score.required !== 60 || ![0, 10, 20].includes(score.optional)
        || ![0, 5, 10].includes(score.collaboration)
        || !integer(score.lowAlert, 0, 10) || score.lowAlert % 2 !== 0
        || !integer(broadcast, -10, 0)
        || (chapterFour ? broadcast !== (value.broadcastOn ? -10 : 0) : broadcast !== 0)
        || !integer(value.score, chapterFour ? 50 : 60, 100)
        || value.score !== score.required + score.optional + score.collaboration + score.lowAlert + broadcast
        || !Number.isFinite(value.elapsedMs) || value.elapsedMs < 0
        || !integer(value.failedAttempts, 0, 1_000_000)
        || !integer(counts.publicCommands, 0, 1000)
        || !integer(counts.publicDeliveries, 0, 1000)
        || !integer(publicLeaks, 0, 1000)
        || !integer(counts.alarms, 0, 1000)
        || score.lowAlert !== Math.max(0, 10 - counts.alarms * 2)
        || value.exposureDelta !== Math.min(20, 2 * (counts.publicCommands + counts.publicDeliveries + publicLeaks + counts.alarms))) return null;
    if (i === 3 && !value.storyFlags.includes('return-beacon-ready')) return null;
    results.push({
      chapterId: value.chapterId, score: value.score,
      breakdown: { required: 60, optional: score.optional, collaboration: score.collaboration, lowAlert: score.lowAlert,
        ...(chapterFour ? { broadcast } : {}) },
      events: { publicCommands: counts.publicCommands, publicDeliveries: counts.publicDeliveries,
        publicLeaks, alarms: counts.alarms },
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
  try { serialized = readSaveItem(storage, SAVE_KEY); }
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
  try { if (!recoverSaveTransaction(storage)) return { ok: false, reason: 'storage-unavailable' }; storage.setItem(SAVE_KEY, JSON.stringify(safe)); return { ok: true, reason: null }; }
  catch { return { ok: false, reason: 'storage-unavailable' }; }
}

/** Access can throw in private/embedded browsing contexts; obtaining it is optional. */
export function browserStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
