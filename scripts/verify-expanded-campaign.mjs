/** Input-driven expanded campaign. Navigation is copied from verify-world and adapted for solid-aware room routes.
 * No player coordinates, item flags, node HP, gates, teammate locations or world events are assigned by this test.
 * Only chapter-start budget configuration, directional inputs, held interactions and the public command API are used.
 */
import assert from 'node:assert/strict';
import { CHAPTERS } from '../src/core/chapters.mjs';
import { GameCore } from '../src/core/state.mjs';
import { getMap } from '../src/game/maps.mjs';
import { GameWorld, routeFor } from '../src/game/world.mjs';
import { compilePrompt } from '../src/game/prompts.mjs';
import { TutorialDirector } from '../src/game/tutorial.mjs';
import { LessonBridge } from '../src/game/lesson-bridge.mjs';

const DT = 1 / 60;
const failures = [], reports = [];
const freePlay = process.argv.includes('--free-play'), lessons = new WeakMap();
let activeWorld = null;
const ok = result => assert.equal(result.ok, true, JSON.stringify(result));
function diagnostics(world) {
  const view = world?.core.view();
  return { chapter: view?.chapter?.id, room: world?.currentRoom?.id, time: Math.round((world?.time ?? 0) * 100) / 100,
    player: world?.player, health: view?.attempt?.health, qualifiers: view?.attempt?.qualifiers, objectives: view?.objectives,
    inventory: view?.attempt?.inventory, delivered: view?.attempt?.deliveredIds, message: world?.message,
    crew: world?.crew.map(actor => ({ name: actor.name, x: actor.x, y: actor.y, status: actor.status, task: actor.task })),
    barriers: world?.barriers.map(entry => ({ id: entry.id, broken: entry.broken })),
    guards: world?.guards.map(entry => ({ id: entry.id, x: entry.x, y: entry.y, state: entry.state })),
    failures: view?.failuresThisChapter };
}
function step(world, input = {}) {
  const result = world.update(DT, input);
  assert(!result?.rebuild, 'Unexpected physical death/retry: ' + JSON.stringify(diagnostics(world)));
  lessons.get(world)?.observe(world, DT);
}
function advance(world, seconds, input = {}) { for (let n = 0; n < Math.ceil(seconds / DT); n++) step(world, input); }
function until(world, condition, seconds, label, input = {}) {
  for (let n = 0; n < Math.ceil(seconds / DT); n++) { if (condition()) return; step(world, typeof input === 'function' ? input() : input); }
  assert(condition(), label + ': ' + JSON.stringify(diagnostics(world)));
}
function hold(world, seconds) { step(world); advance(world, seconds, { interact: true }); step(world); }
const defensiveIdle = (world) => {
  const p = world.player, warning = world.scanWarning;
  if (warning) {
    if (p.x <= warning.x - 24 || p.x >= warning.x + warning.w + 24) return {};
    const left = Math.max(16, warning.x - 32), right = Math.min(1264, warning.x + warning.w + 32);
    const goal = right > warning.x + warning.w + 20
      && Math.abs(right - p.x) < Math.abs(left - p.x) ? right : left;
    return { [goal > p.x ? 'right' : 'left']: true };
  }
  const guard = world.guards.some((entry) => Math.abs(entry.y - p.y) < 110
    && Math.abs(entry.x - p.x) < 150);
  return guard ? { jump: true, jumpPressed: p.grounded } : {};
};

function navigate(world, destination, replans = 0) {
  assert(replans < 12, 'Too many physical route replans: ' + world.map.id);
  const solidTop=world.player.grounded&&world.solidBodies().find(s=>
    Math.abs(world.player.y-s.y)<1&&world.player.x+14>s.x&&world.player.x-14<s.x+s.w);
  if(solidTop){
    // Closed gate roofs are legal support surfaces but are not ladder-graph
    // platforms. Walk off the roof before asking for another platform route.
    const right=destination.x>solidTop.x+solidTop.w/2&&solidTop.x+solidTop.w+30<1264;
    const edge=right?solidTop.x+solidTop.w+30:solidTop.x-30;
    until(world,()=>right?world.player.x>edge:world.player.x<edge,2,
      'Step off a solid gate roof',{[right?'right':'left']:true});
    advance(world,.35);
  }
  if (world.player.grounded && world.player.y === 475 && world.player.x >= 1220) {
    // The closed MFA door is a solid body, not a ladder-graph surface. If a
    // high escape dash lands on it, physically step back onto the mapped route.
    until(world, () => world.player.x < 1195, 2, 'Step off the MFA door top', { left: true });
    advance(world, .3);
  }
  const surfaces = world.platforms.filter((surface) => surface.kind !== 'lift');
  // Prefer an existing alternate ladder route whose endpoints do not put the
  // player directly into a patrol. This changes only input planning, not world state.
  const passableLadders=world.map.ladders.filter(rung=>!world.solidBodies().some(s=>
    rung.x+14>s.x&&rung.x-14<s.x+s.w&&rung.y-48<s.y+s.h&&rung.y+rung.h>s.y));
  const quietLadders = passableLadders.filter((rung) => !world.guards.some((guard) =>
    (Math.abs(guard.y - rung.y) < 4 || Math.abs(guard.y - rung.y - rung.h) < 4)
    && rung.x >= guard.minX - 45 && rung.x <= guard.maxX + 45));
  const route = world.navigationRoute(world.player, destination)
    ?? routeFor(surfaces, replans ? passableLadders : quietLadders, world.player, destination)
    ?? routeFor(surfaces, passableLadders, world.player, destination);
  assert(route, 'No navigation route to ' + JSON.stringify(destination));
  for (const waypoint of route) {
    const start = world.time;
    let lastJump = -10;
    let landingEscape = null;
    let scanEscapeTarget = null;
    let airborneLadderTransfer = false;
    while (world.time - start < 20) {
      const p = world.player;
      const dx = waypoint.x - p.x;
      const dy = waypoint.y - p.y;
      const nextWaypoint = route[route.indexOf(waypoint) + 1];
      if (!waypoint.climb && nextWaypoint?.climb && Math.abs(dx) < 20
        && p.y <= waypoint.y + 2 && p.y >= waypoint.y - 85
        && world.map.ladders.some((rung) => Math.abs(rung.x - p.x) < 25
          && p.y >= rung.y && p.y <= rung.y + rung.h)) {
        airborneLadderTransfer = true;
        break;
      }
      // Finish ascent at the actual top, not 2–3px below a one-way platform.
      // Releasing up below its collision plane would correctly fall to the lower floor.
      if (Math.abs(dx) < 10 && Math.abs(dy) < (waypoint.climb ? .45 : 3)
        && Math.abs(p.vx) < 10) break;
      if (p.grounded && Math.abs(dy) > 6 && (!waypoint.climb || Math.abs(dx) > 25)) {
        if (process.env.WORLD_TRACE === '1') console.log('REPLAN ' + JSON.stringify({
          chapter: world.map.id, destination, waypoint, x: p.x, y: p.y, route }));
        return navigate(world, destination, replans + 1);
      }
      const input = {};
      if (landingEscape) {
        if (p.grounded) landingEscape = null;
        else {
          step(world, { [landingEscape]: true, dashPressed: world.player.dashCooldown === 0 });
          continue;
        }
      }
      const warning = world.scanWarning;
      if (warning) {
        if (scanEscapeTarget === null) {
          const left = Math.max(16, warning.x - 32);
          const right = Math.min(1264, warning.x + warning.w + 32);
          scanEscapeTarget = right >= warning.x + warning.w + 16
            && Math.abs(right - p.x) < Math.abs(left - p.x) ? right : left;
        }
        const away = scanEscapeTarget - p.x;
        if (Math.abs(away) > 8) input[away > 0 ? 'right' : 'left'] = true;
        if (!p.dashCooldown && Math.abs(away) > 45) input.dashPressed = true;
        step(world, input);
        continue;
      }
      scanEscapeTarget = null;
      const landingTrap = !p.grounded && !p.climbing && p.vy >= 0 && world.traps.find((trap) =>
        p.y >= trap.y - 140 && p.y < trap.y - 20
        && p.x > trap.x - 40 && p.x < trap.x + trap.w + 40);
      if (landingTrap) {
        const direction = p.x < landingTrap.x + landingTrap.w / 2 ? 'left' : 'right';
        landingEscape = direction;
        step(world, { [direction]: true, dashPressed: world.player.dashCooldown === 0 });
        continue;
      }
      const floorTrap = !waypoint.climb && p.grounded && world.traps.find((trap) =>
        Math.abs(trap.y + 8 - p.y) < 12 && (trap.x + trap.w / 2 - p.x) * Math.sign(dx) > 0
        && (dx > 0 ? waypoint.x > trap.x : waypoint.x < trap.x + trap.w)
        && Math.abs(trap.x + trap.w / 2 - p.x) < 130);
      if (floorTrap) {
        // Leave the hazard plane first, then cross it with an actual airborne
        // dash. This avoids landing on the far half of a wide trap at low speed.
        const direction = dx > 0 ? 'right' : 'left';
        if (world.player.dashCooldown > 0
          && (p.x < floorTrap.x - 16 || p.x > floorTrap.x + floorTrap.w + 16)) {
          until(world, () => world.player.dashCooldown === 0, 4,
            'Wait safely outside the trap before a low dash');
          continue;
        }
        const walkingJump = world.player.dashCooldown > 0 ? { [direction]: true } : {};
        step(world, { jumpPressed: true, jump: true, ...walkingJump });
        // Keep feet about 48px above the floor: enough trap clearance while
        // remaining below gates mounted on the next (490px) platform.
        advance(world, .08, { jump: true, ...walkingJump });
        if (world.player.dashCooldown > 0) {
          advance(world, .45, { [direction]: true, jump: true });
          continue;
        }
        step(world, { [direction]: true, dashPressed: true });
        until(world, () => world.player.dashTime <= 0, .5, 'Air dash across the trap',
          { [direction]: true });
        continue;
      }
      if (waypoint.climb) {
        const guardedExit = p.grounded && world.guards.some((guard) => {
          if (Math.abs(guard.y - waypoint.y) >= 4 || p.y <= guard.y + 50) return false;
          if (destination.x >= waypoint.x && guard.minX <= waypoint.x - 90)
            return guard.x > waypoint.x - 90;
          if (destination.x < waypoint.x && guard.maxX >= waypoint.x + 90)
            return guard.x < waypoint.x + 90;
          return Math.abs(guard.x - waypoint.x) < 90;
        });
        if (guardedExit) { step(world); continue; }
        const trappedExit = world.core.view().chapter.id === 'review-quietly'
          && dy < 0 && p.y <= waypoint.y + 45 && p.y > waypoint.y + 35
          && world.traps.find((trap) => Math.abs(trap.y + 8 - waypoint.y) < 4
            && waypoint.x >= trap.x - 14 && waypoint.x <= trap.x + trap.w + 14);
        if (trappedExit) {
          const side = waypoint.x > trappedExit.x + trappedExit.w / 2 ? 'right' : 'left';
          step(world, { jump: true, jumpPressed: true, [side]: true });
          advance(world, .3, { jump: true, [side]: true });
          until(world, () => world.player.grounded, 1, 'Jump clear of a trapped ladder exit');
          return navigate(world, destination, replans + 1);
        }
        if (Math.abs(dx) > 19) input[dx > 0 ? 'right' : 'left'] = true;
        else if (Math.abs(dy) > 1) input[dy > 0 ? 'down' : 'up'] = true;
      } else {
        const stoppingDistance = p.vx * p.vx / 6000 + 3;
        if (Math.abs(dx) > Math.max(5, stoppingDistance))
          input[dx > 0 ? 'right' : 'left'] = true;
        const ahead = dx > 0 ? 1 : -1;
        const hazard = world.traps.some((trap) => Math.abs(trap.y + 8 - p.y) < 14
          && (trap.x + trap.w / 2 - p.x) * ahead > 0
          && (dx > 0 ? waypoint.x > trap.x : waypoint.x < trap.x + trap.w)
          && Math.abs(trap.x + trap.w / 2 - p.x) < 75)
          || world.guards.some((guard) => Math.abs(guard.y - p.y) < 20
            && (guard.x - p.x) * ahead > 0 && Math.abs(guard.x - p.x) < 78);
        if (hazard && Math.abs(dx) > 10 && p.grounded && world.time - lastJump > .5) {
          input.jumpPressed = true; lastJump = world.time;
        }
        if (world.time - lastJump < .3) input.jump = true;
      }
      step(world, input);
    }
    assert(Math.abs(world.player.x - waypoint.x) < 20
      && (airborneLadderTransfer || Math.abs(world.player.y - waypoint.y) < 6), 'Input route blocked: ' + JSON.stringify({
      chapter: world.map.id, destination, waypoint, route, player: world.player,
      message: world.message, broken: world.barriers.map((entry) => [entry.id, entry.broken]),
    }));
  }
  advance(world, .06);
}


function command(world, id, precise = false) {
  const target = world.map.targets.find(entry => entry.id === id);
  assert(target, 'Target is not in the current room: ' + id);
  until(world, () => !world.crew.find(actor => actor.name === target.teammate).task
    && world.core.view().attempt.readyAtMs[target.teammate] <= world.core.view().attempt.elapsedMs,
    15, 'Wait for command cooldown ' + id, () => defensiveIdle(world));
  const receiptCount = world.receipts.length;
  assert(world.selectTeammate(target.teammate), 'Select ' + target.teammate);
  assert(world.selectTarget(id), 'Select target ' + id);
  world.setPromptMode(precise);
  assert(world.commandPreview.available, 'Command preview blocked for ' + id + ': ' + world.commandPreview.reason + ' ' + JSON.stringify(diagnostics(world)));
  assert(world.confirmCommand(precise), 'Confirm command ' + id + ': ' + world.message);
  until(world, () => !world.crew.find(actor => actor.name === target.teammate).task,
    25, 'Complete physical command ' + id, () => defensiveIdle(world));
  assert(world.receipts.length > receiptCount && !world.receipts.at(-1).failed,
    'Command ended without a real success receipt: ' + id + ' ' + JSON.stringify(diagnostics(world)));
  assert(world.core.view().attempt.completedTargetIds.includes(id), 'Core did not receive command completion: ' + id);
}

function goRoom(world, index) {
  if (world.currentRoom.index === index) return;
  assert([1, 2].includes(index) && !world.currentRoom.optional, 'Campaign only traverses the two main rooms');
  const exit = world.currentRoom.exits.find(entry => entry.id === (index === 2 ? 'to-action' : 'to-harbor'));
  assert(exit, 'Missing main-room exit');
  navigate(world, exit); assert.equal(world.getInteraction(world.core.view())?.id, 'exit-' + exit.id);
  hold(world, .3); assert.equal(world.currentRoom.index, index, 'Held exit must change room');
}
function deliver(world) {
  goRoom(world, 1); navigate(world, world.map.boat);
  assert.equal(world.getInteraction(world.core.view())?.id, 'delivery', 'Must be physically at the boat with cargo');
  const count = world.core.view().attempt.deliveryIds.length;
  hold(world, world.core.view().attempt.deliveryDurationMs / 1000 + .15);
  assert.equal(world.core.view().attempt.inventory.length, 0); assert.equal(world.core.view().attempt.deliveryIds.length, count + 1);
}
function commandOrigin(world, target) {
  // The chosen side is an actual walk on the lower floor, allowing crew to approach a blocked wall from a reachable ladder.
  // Upper-room targets need a real ladder transfer first; issuing from the lower floor
  // would correctly be rejected by the shared preview/path validator.
  if (target.y < 560) { stageBelow(world, target); return; }
  const x = Math.min(1150, target.x + 200);
  navigate(world, { x, y: 600 });
  until(world, () => world.crew.find(actor => actor.name === target.teammate).x > target.x + 8,
    12, 'Crew moves to the chosen side of ' + target.id, () => defensiveIdle(world));
}
function stageBelow(world, target) {
  const candidates = world.map.ladders.filter(ladder => Math.abs(ladder.y - target.y) < 4 && ladder.h >= 100);
  const ladder = candidates.sort((a, b) => Math.abs(a.x - target.x) - Math.abs(b.x - target.x))[0];
  if (ladder) {
    // Reach the foot, then actually climb to the target platform. The route
    // validator intentionally refuses a command issued from the lower floor
    // when a wall or lift separates the actor from the upper target.
    navigate(world, { x: ladder.x, y: ladder.y + ladder.h });
    navigate(world, { x: ladder.x, y: ladder.y });
  } else navigate(world, { x: Math.min(1100, target.x), y: 600 });
}
function setupRoom(world, zeroBudget) {
  const main = [...world.currentRoom.targets];
  for (const target of main.filter(entry => entry.teammate === 'Grok')) {
    const barrier = world.barriers.find(entry => entry.id === target.id);
    if (!barrier?.broken) { commandOrigin(world, target); command(world, target.id, false); }
  }
  for (let count = 0; count < 12; count++) {
    const node = world.nodes.find(entry => entry.hp > 0); if (!node) break;
    const target = world.map.targets.find(entry => entry.id === node.id);
    commandOrigin(world, target); command(world, node.id, false);
  }
  assert(world.nodes.every(entry => entry.hp === 0), 'All required nodes need an actual opening action');
  for (const target of main.filter(entry => entry.teammate === 'GLM')) {
    // Exercise the legitimate Grok return-divider route instead of the scan
    // shown by chapter three's optional teaching example.
    if (freePlay && world.core.view().chapter.number === 3) continue;
    stageBelow(world, target); command(world, target.id, !zeroBudget);
  }
  // Claude is timed close to the actual collection attempt, after node opening and scan travel.
  const decoy = main.find(entry => entry.teammate === 'Claude');
  // Chapter 4's Claude target is an optional patrol diversion. Keep the
  // full-campaign regression deterministic by leaving it for the dedicated
  // broadcast/branch checks; the two required archive items remain a zero-
  // qualifier route and are collected without entering the moving guard lane.
  if (decoy && world.core.view().chapter.id !== 'public-report') { stageBelow(world, decoy); command(world, decoy.id, false); }
}
function pickupPoint(world, item) {
  const surface = world.platforms.find(entry => entry.kind !== 'lift' && Math.abs(entry.y - item.y) < 3 && item.x >= entry.x && item.x <= entry.x + entry.w);
  const guard = world.guards.find(entry => Math.abs(entry.y - item.y) < 4 && Math.abs(entry.minX - item.x) < 80);
  const offset = guard && item.x < (guard.minX + guard.maxX) / 2 ? 28 : -28;
  return { x: surface ? Math.max(surface.x + 18, Math.min(surface.x + surface.w - 18, item.x + offset)) : item.x, y: item.y };
}
function collectRoom(world, index) {
  goRoom(world, index);
  const requiredIds = new Set(world.core.view().chapter.requiredItems.map(entry => entry.id));
  const items = world.currentRoom.items.filter(entry => requiredIds.has(entry.id)).map(entry => entry.id);
  for (const id of items) {
    let state = world.core.view().attempt;
    if (state.deliveredIds.includes(id) || state.inventory.includes(id)) continue;
    if (state.inventory.length === 3) { deliver(world); goRoom(world, index); }
    const item = world.items.find(entry => entry.id === id); assert(item, 'Required item missing on room reload');
    navigate(world, pickupPoint(world, item));
    state = world.core.view().attempt;
    assert(state.inventory.includes(id) || state.deliveredIds.includes(id), 'Proximity pickup did not occur: ' + id + ' ' + JSON.stringify(diagnostics(world)));
  }
}
function finishChapter(world) {
  navigate(world, world.map.boat); assert(world.core.view().objectives.every(entry => entry.complete), JSON.stringify(world.core.view().objectives));
  hold(world, .75); assert.equal(world.core.view().phase, 'chapter-result', 'Held boarding must stage a result');
}

function finalRoom(world) {
  assert.equal(world.currentRoom.index, 2);
  const decoy = world.currentRoom.targets.find(target => target.teammate === 'Claude');
  // The evacuation patrol is optional; keeping it untouched makes this
  // deterministic acceptance path validate the required rendezvous, loading,
  // confirmation and 60-second window without deliberately entering its lane.
  collectRoom(world, 2); assert.equal(world.core.view().attempt.inventory.length, 3);
  // First summon is separate from loading and from confirming the countdown.
  navigate(world, world.map.beacon); assert.equal(world.getInteraction(world.core.view())?.id, 'rendezvous');
  hold(world, .7); assert(world.rendezvousRequested); assert.equal(world.core.view().attempt.evacuationStarted, false);
  navigate(world, { x: 975, y: 270 });
  until(world, () => world.core.view().attempt.rendezvousCrew.length === 3, 30, 'Three crew actually reach the remote beacon', () => defensiveIdle(world));
  assert.equal(world.core.view().attempt.remoteReady, false); assert.equal(world.core.view().attempt.evacuationStarted, false);
  stageBelow(world, decoy); command(world, decoy.id, false);
  navigate(world, world.map.beacon); assert.equal(world.getInteraction(world.core.view())?.id, 'prepare');
  hold(world, .9); assert.equal(world.core.view().attempt.remoteReady, true); assert.equal(world.core.view().attempt.evacuationStarted, false);
  assert.equal(world.core.view().attempt.evacuationRemainingMs, 60000, 'Loading does not start or consume the timer');
  assert.equal(world.getInteraction(world.core.view())?.id, 'evacuate'); hold(world, .9);
  assert(world.core.view().attempt.evacuationStarted); assert(world.core.view().attempt.evacuationRemainingMs > 59000);
  deliver(world); assert(world.core.view().attempt.evacuationRemainingMs > 0); finishChapter(world);
}

function campaign(zeroBudget = false) {
  const core = new GameCore({ persist: false }), report = { mode: zeroBudget ? 'zero-qualifiers' : 'assisted', chapters: [], complete: false, simulatedSeconds: 0 };
  reports.push(report);
  for (const chapter of CHAPTERS) {
    assert.equal(core.view().chapter.id, chapter.id);
    if (zeroBudget) ok(core.configureAttempt({ qualifiers: 0 }));
    const events = []; let lesson = null, tutorial = null;
    const world = new GameWorld(core, getMap(chapter.id), { expanded: true, compilePrompt,
      trainingCredits: { Claude: !zeroBudget && chapter.number === 2 ? 1 : 0 }, onEvent: (type, payload) => { events.push({ type, payload }); lesson?.handleEvent(type, payload); } });
    if (freePlay) {
      tutorial = new TutorialDirector({ chapter: chapter.id });
      lesson = new LessonBridge({ tutorial, world }); lessons.set(world, lesson);
    }
    activeWorld = world;
    if (core.view().attempt.broadcastOn) { navigate(world, world.map.broadcast); hold(world, .9); assert.equal(core.view().attempt.broadcastOn, false); }
    setupRoom(world, zeroBudget);
    if (chapter.number < 5) {
      collectRoom(world, 1); if (core.view().attempt.inventory.length) deliver(world);
      goRoom(world, 2); setupRoom(world, zeroBudget); collectRoom(world, 2);
      if (chapter.number === 4) {
        navigate(world, world.map.beacon); hold(world, .9); assert(core.view().attempt.returnBeaconReady);
      }
      if (core.view().attempt.inventory.length) deliver(world); else goRoom(world, 1);
      finishChapter(world);
    } else {
      goRoom(world, 2); setupRoom(world, zeroBudget); finalRoom(world);
    }
    assert(chapter.requiredItems.every(item => core.view().attempt.deliveredIds.includes(item.id)));
    assert(events.filter(event => event.type === 'room-change').some(event => event.payload.to.endsWith(':room-2')));
    const state = core.view().attempt;
    if (freePlay && chapter.number === 1) assert(!tutorial.completed.includes('node-first'), 'Grok may open the nodes without the player performing the manual dash exercise');
    if (freePlay && chapter.number === 2) assert(!tutorial.completed.includes('claude-constraint'), 'The training-only precise decoy is not required to clear chapter two');
    if (freePlay && chapter.number === 3) assert(!state.completedTargetIds.includes('trap-bridge') && state.completedTargetIds.includes('return-divider'), 'The alternate divider route must clear chapter three without the tutorial scan');
    if (zeroBudget) assert(world.records.filter(record => record.type === 'command').every(record => record.chargedCost === 0));
    const entry = { chapter: chapter.id, simulatedSeconds: Math.round(state.elapsedMs / 10) / 100, health: state.health, deliveries: state.deliveryIds.length,
      actualReceipts: world.receipts.length, qualifiersRemaining: state.qualifiers, finalTimerRemainingMs: chapter.number === 5 ? state.evacuationRemainingMs : null,
      ...(freePlay ? { optionalTeaching: { completed: [...tutorial.completed], skipped: tutorial.skipped } } : {}) };
    report.chapters.push(entry); report.simulatedSeconds += entry.simulatedSeconds;
    console.log('PLAYTHROUGH ' + report.mode + ' ' + JSON.stringify(entry)); ok(core.continueCampaign());
  }
  assert.equal(core.view().phase, 'campaign-complete'); assert.equal(core.view().campaign.results.length, 5);
  report.simulatedSeconds = Math.round(report.simulatedSeconds * 100) / 100; report.complete = true;
  console.log('PASS ' + report.mode + ' full expanded input campaign: ' + report.simulatedSeconds + ' simulated seconds');
}

for (const zeroBudget of process.argv.includes('--zero-only') ? [true] : process.argv.includes('--all') ? [false, true] : [false]) {
  try { campaign(zeroBudget); }
  catch (error) { const details = diagnostics(activeWorld); failures.push({ mode: zeroBudget ? 'zero-qualifiers' : 'assisted', message: error.message, details });
    console.error('FAIL expanded campaign: ' + error.stack); break; }
}
console.log('EXPANDED_CAMPAIGN_REPORT ' + JSON.stringify({ reports, failures }));
if (failures.length) process.exitCode = 1;
