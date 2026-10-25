/**
 * Discrete motion loops for the existing five-pose atlas. These transforms are
 * deliberately visual: sampling never writes actor, world or physics state.
 * Coordinates remain in the logical 1280 × 720 space; round the actor anchor
 * before adding the returned integer offsets.
 */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const LOOPS = Object.freeze({
  idle: { frames: 4, fps: 8 },
  walk: { frames: 6, fps: 10 },
  jump: { frames: 3, fps: 10 },
  dash: { frames: 4, fps: 16 },
  interact: { frames: 4, fps: 10 },
  hurt: { frames: 2, fps: 10 },
  board: { frames: 4, fps: 10 },
});

function actorSeed(actor) {
  return [...String(actor.name || (actor.isPlayer ? 'DeepSeek' : 'crew'))]
    .reduce((total, letter) => (total + letter.charCodeAt(0)) % 17, 0);
}

function actionFor(actor, world) {
  const target = String(world.interaction?.target || '');
  if (actor.isPlayer) {
    if (world.interaction && (target === 'board' || /登艇/.test(world.nearby?.label || ''))) return 'board';
    if (world.interaction) return target === 'delivery' || target === 'prepare' ? 'carry' : 'read';
    if (world.commandPreview || (world.selected && !world.crew?.some(crew => crew.task))) return 'command';
    if (finite(actor.carryCount, finite(world.carryCount)) > 0) return 'carry';
  }
  if (actor.task?.stage === 'execute' || actor.pose === 'skill') {
    return actor.name === 'Grok' ? 'break' : actor.name === 'Claude' ? 'lure' : actor.name === 'GLM' ? 'scan' : 'command';
  }
  return null;
}

/**
 * All loops are stepped at their advertised FPS, rather than continuously
 * resampling sine transforms at display refresh speed. `pose` always names an
 * existing atlas pose. Reduced motion keeps a static readable pose and turns
 * off trails/flash; task and interaction progress still remain accurate.
 */
export function sampleCharacterMotion(actor = {}, world = {}, { time = world.time || 0, reduceMotion = false } = {}) {
  const now = Math.max(0, finite(time));
  const simulationTime = Math.max(0, finite(world.time, now));
  const direction = actor.direction === 'left' || actor.direction === -1 ? -1 : 1;
  const action = actionFor(actor, world);
  const isHurt = Boolean(actor.isPlayer && finite(actor.hurtUntil) > simulationTime);
  const isDash = Boolean((actor.isPlayer && finite(actor.dashTime) > 0) || action === 'break');
  const airborne = actor.pose === 'jump' || actor.pose === 'fall' || actor.grounded === false && !actor.climbing;
  const walking = actor.pose === 'walk' || Math.abs(finite(actor.vx)) > 10;
  const interacting = Boolean(action && action !== 'carry' || world.interaction && actor.isPlayer);
  const state = isHurt ? 'hurt' : isDash ? 'dash' : action === 'board' ? 'board' : airborne ? 'jump'
    : interacting ? 'interact' : walking ? 'walk' : 'idle';
  const loop = LOOPS[state];
  const clock = actor.task?.stage === 'execute' ? Math.max(0, finite(actor.task.stageTime))
    : state === 'dash' ? Math.max(0, .22 - finite(actor.dashTime)) : now;
  let frame = Math.floor(clock * loop.fps + (state === 'idle' || state === 'walk' ? actorSeed(actor) : 0)) % loop.frames;
  const interactionProgress = clamp(finite(world.interaction?.progress, finite(world.nearby?.progress)), 0, 1);
  if (state === 'board') frame = Math.min(3, Math.floor(interactionProgress * 4));
  if (state === 'jump') frame = actor.grounded === true ? 2 : finite(actor.vy) < -120 ? 0 : finite(actor.vy) > 120 || actor.pose === 'fall' ? 2 : 1;
  if (reduceMotion) frame = state === 'jump' ? 1 : 0;
  const motion = {
    state, pose: 'idle', frame, frames: loop.frames, fps: loop.fps,
    xOffset: 0, yOffset: 0, rotation: 0, scaleX: 1, scaleY: 1,
    opacity: 1, trail: [], flash: 0,
    progress: state === 'board' || actor.isPlayer && world.interaction ? interactionProgress : (frame + 1) / loop.frames,
    action, reduceMotion: Boolean(reduceMotion),
  };
  if (state === 'walk') motion.pose = 'walk';
  if (state === 'jump') motion.pose = frame === 2 ? 'fall' : 'jump';
  if (state === 'dash' || state === 'interact' || state === 'board') motion.pose = 'skill';
  if (state === 'hurt') motion.pose = airborne ? (actor.pose === 'fall' ? 'fall' : 'jump') : 'idle';
  if (reduceMotion) return motion;

  if (state === 'idle') {
    motion.yOffset = [0, -1, -1, 0][frame];
    motion.scaleX = [1, 1.006, 1, .994][frame];
    motion.scaleY = [1, .992, 1, 1.008][frame];
  } else if (state === 'walk') {
    motion.yOffset = [0, -1, -2, 0, -1, -2][frame];
    motion.rotation = [-.014, 0, .014, .014, 0, -.014][frame] * direction;
    motion.scaleX = [1.012, 1, .988, 1.012, 1, .988][frame];
    motion.scaleY = [.988, 1, 1.012, .988, 1, 1.012][frame];
    if (action === 'carry') motion.rotation *= .4;
  } else if (state === 'jump') {
    motion.scaleX = [.96, 1, 1.025][frame];
    motion.scaleY = [1.04, 1, .975][frame];
    motion.rotation = [-.025, 0, .025][frame] * direction;
  } else if (state === 'dash') {
    motion.rotation = [.04, .07, .05, .015][frame] * direction;
    motion.scaleX = [1.02, 1.04, 1.025, 1][frame];
    motion.scaleY = [.98, .96, .975, 1][frame];
    motion.yOffset = [-1, -2, -1, 0][frame];
    motion.trail = [1, 2, 3].map(index => ({ xOffset: -direction * (9 + index * 8), yOffset: 0, opacity: .16 / index }));
  } else if (state === 'interact') {
    motion.yOffset = [0, -1, 0, 1][frame];
    motion.rotation = [0, -.018, .018, 0][frame] * direction;
    motion.scaleY = [1, 1.012, .99, 1][frame];
  } else if (state === 'hurt') {
    const elapsed = clamp(.7 - (actor.hurtUntil - simulationTime), 0, .7);
    motion.flash = elapsed < .12 ? 1 - elapsed / .12 : 0;
    motion.xOffset = elapsed < .18 ? -direction * (frame ? 2 : 4) : 0;
    motion.opacity = elapsed < .12 ? 1 : frame ? .65 : 1;
    motion.rotation = elapsed < .18 ? -.04 * direction : 0;
  } else if (state === 'board') {
    motion.yOffset = [0, -4, -7, -2][frame];
    motion.xOffset = [0, 2, 4, 5][frame] * direction;
    motion.scaleX = [1, .99, .97, .95][frame];
    motion.scaleY = [1, 1.01, 1.025, .97][frame];
    motion.opacity = [1, 1, .95, .8][frame];
    motion.rotation = [0, .02, .04, .02][frame] * direction;
  }
  return motion;
}

/** The actor effects reuse the four supplied PNG animation atlases. Every
 * additional handheld object is an authored prop, never a painted rectangle.
 */
export function drawCharacterMotionFX(ctx, actor, world, motion, assets) {
  if (!motion || motion.reduceMotion || !assets) return;
  if (!motion.trail.length && !motion.action && !motion.flash) return;
  const left = actor.direction === 'left' || actor.direction === -1;
  const direction = left ? -1 : 1;
  const x = Math.round(finite(actor.x)) + motion.xOffset;
  const y = Math.round(finite(actor.y)) + motion.yOffset;
  const effect = (group, dx, dy, width, height, opacity = .75) => assets.drawEffect(ctx, group, motion.frame / (assets.catalog?.animations[group]?.fps || 8), x + dx * direction, y + dy, {
    width, height, flipX: left, anchor: [.5, .5], untrimmed: false, opacity, loop: true,
  });
  const prop = (id, dx, dy, width, height, opacity = .9) => assets.draw(ctx, id, x + dx * direction, y + dy, {
    width, height, flipX: left, anchor: [.5, .5], opacity,
  });
  if (motion.state === 'dash') {
    effect('water-dash', -24, -24, 92, 44, .62);
    if (motion.action === 'break') effect('axe-impact', 24, -30, 75, 68, motion.frame < 2 ? .58 : .85);
  } else if (motion.action === 'lure') {
    effect('paper-decoy', 30, -39, 86, 58, .88);
  } else if (motion.action === 'scan') {
    effect('scan-grid', 52, -32, 108, 55, .78);
  } else if (motion.state === 'board') {
    effect('water-dash', 0, -5, 69 + motion.frame * 6, 29, .62);
  } else if (motion.action === 'command') {
    prop('prop-broadcast-console', 19, -34, 20, 24);
  } else if (motion.action === 'read') {
    prop('prop-resume-decoy', 18, -34, 18, 23);
  } else if (motion.action === 'carry') {
    prop('prop-data-cube', 0, -23, 15, 17);
  }
  if (motion.flash > 0) effect('water-dash', 0, -28, 46, 58, motion.flash * .8);
}
