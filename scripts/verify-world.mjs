/**
 * Deterministic action-world integration checks (Node, fixed 1/60 s timestep).
 * Isolated cases may place the player at legal supported positions.
 * The campaign run uses only live directional/interact inputs and world commands:
 * no player teleport, core.pickup, core.deliver or core.completeCommand shortcuts.
 */
import assert from 'node:assert/strict';
import { CHAPTERS } from '../src/core/chapters.mjs';
import { GameCore } from '../src/core/state.mjs';
import { MAPS, getMap } from '../src/game/maps.mjs';
import { GameWorld, routeFor } from '../src/game/world.mjs';

const DT = 1 / 60;
const ok = (result) => assert.equal(result.ok, true, JSON.stringify(result));
const failures = [];
const checkpointFor = (index) => {
  const results = CHAPTERS.slice(0, index).map((chapter, i) => ({
    chapterId: chapter.id, score: 70,
    breakdown: { required: 60, optional: 0, collaboration: 0, lowAlert: 10 },
    events: { publicCommands: 0, publicDeliveries: 0, alarms: 0 },
    exposureDelta: 0, elapsedMs: 0, failedAttempts: 0,
    broadcastOn: i < 3,
    storyFlags: i < 3 ? ['briefing-published']
      : ['briefing-published', 'broadcast-discovered', 'return-beacon-ready'],
  }));
  return { version: 1, campaign: { results, completed: false,
    broadcastOn: index < 4, storyFlags: results.at(-1)?.storyFlags ?? ['briefing-published'] } };
};
const fixture = (index = 0) => {
  const core = new GameCore({ checkpoint: checkpointFor(index), persist: false });
  const events = [];
  const world = new GameWorld(core, MAPS[index],
    { onEvent: (type, payload) => events.push({ type, payload }) });
  return { core, world, events };
};
const step = (world, input = {}) => {
  const before = world.core.view().attempt?.health;
  const result = world.update(DT, input);
  if (process.env.WORLD_TRACE === '1' && world.core.view().attempt?.health < before) {
    console.log('DAMAGE ' + JSON.stringify({ chapter: world.map.id, time: world.time,
      x: world.player.x, y: world.player.y, health: world.core.view().attempt.health,
      alert: world.core.view().attempt.alert, scan: world.scanWarning,
      guards: world.guards.map((guard) => [guard.x, guard.y]) }));
  }
  assert(!result?.rebuild, 'Unexpected attempt reset: ' + JSON.stringify({
    chapter: world.map.id, player: world.player, failures: world.core.view().failuresThisChapter,
  }));
};
const advance = (world, seconds, input = {}) => {
  for (let i = 0; i < Math.ceil(seconds / DT); i++) step(world, input);
};
const until = (world, condition, seconds, label, input = {}) => {
  for (let i = 0; i < Math.ceil(seconds / DT); i++) {
    if (condition()) return;
    step(world, typeof input === 'function' ? input() : input);
  }
  assert(condition(), label + ': ' + JSON.stringify({
    chapter: world.map.id, player: world.player, message: world.message,
    commands: world.core.view().attempt?.commands,
  }));
};
const place = (world, x, y) => Object.assign(world.player,
  { x, y, vx: 0, vy: 0, grounded: true, climbing: false, dashTime: 0 });
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
const hold = (world, seconds) => {
  step(world);
  advance(world, seconds, { interact: true });
  step(world);
};
const command = (world, id, precise = false) => {
  const target = world.map.targets.find((entry) => entry.id === id);
  assert(target, 'Unknown test target ' + id);
  until(world, () => {
    const state = world.core.view().attempt;
    return state.readyAtMs[target.teammate] <= state.elapsedMs
      && !world.crew.find((actor) => actor.name === target.teammate).task;
  }, 12, 'Wait for command cooldown',()=>defensiveIdle(world));
  assert(world.selectTeammate(target.teammate), 'Cannot select ' + target.teammate);
  assert(world.pointAt(target.x, target.y), 'Cannot point at ' + id);
  assert(world.confirmCommand(precise), 'Cannot confirm ' + id + ': ' + world.message);
  until(world, () => !world.crew.find(actor=>actor.name===target.teammate).task
    && world.core.view().attempt.completedTargetIds.includes(id),
    30, 'World command did not complete ' + id,()=>defensiveIdle(world));
};
const test = (name, callback) => {
  try { callback(); console.log('PASS ' + name); }
  catch (error) { failures.push(name); console.error('FAIL ' + name + '\n' + error.stack); }
};

test('movement, jump arc, ladder climb and chained ladder joints', () => {
  const { world, events } = fixture();
  advance(world, .3, { right: true });
  assert(world.player.x > 160 && world.player.x < 200);
  place(world, 120, 600);
  step(world, { jumpPressed: true, jump: true });
  advance(world, .2, { jump: true });
  assert(world.player.y < 540, 'Jump must leave the floor');
  assert(events.some((event) => event.type === 'sound' && event.payload.name === 'jump'));
  advance(world, 1);
  assert.equal(world.player.y, 600);
  place(world, 240, 600);
  advance(world, .8, { up: true });
  assert(Math.abs(world.player.y - 490) < 2);
  advance(world, .8, { down: true });
  assert(Math.abs(world.player.y - 600) < 2);
  place(world, 650, 600);
  advance(world, 2.3, { up: true });
  assert(Math.abs(world.player.y - 270) < 2, 'Overlapping ladder joints must allow ascent');
  advance(world, 2.3, { down: true });
  assert(Math.abs(world.player.y - 600) < 2, 'Overlapping ladder joints must allow descent');
});

test('dash respects an unbroken Grok barrier', () => {
  const { world } = fixture();
  place(world, 380, 490);
  step(world, { right: true, dashPressed: true });
  advance(world, .35, { right: true });
  assert(world.player.x <= 406.01, 'Dash must stop at wall minus half actor width');
  assert.equal(world.barriers.find((entry) => entry.id === 'paper-window').broken, false);
  assert.match(world.message, /Grok/);
});

test('climbing cannot pass through a solid barrier at a ladder exit',()=>{
  const {world}=fixture();
  place(world,985,600);
  advance(world,2,{up:true});
  assert(world.player.y>=428,'Feet must stay below the wall bottom plus actor height');
  assert(!world.barriers.find(b=>b.id==='outer-node').broken);
});

test('physical pickup radius, full backpack and sustained boat/broadcast interactions', () => {
  // Chapter four has bare task/archive pickups, isolating radius/hold behaviour
  // from the separately tested two-hit server nodes in the first three chapters.
  const { world, core } = fixture(3);
  place(world, 640, 270);
  step(world);
  assert.equal(core.view().attempt.inventory.length, 0, '50px away is too far to pick up');
  place(world, 670, 270);
  step(world);
  assert(core.view().attempt.inventory.includes('report-task-1'));
  for (const point of [[1160, 270], [545, 380]]) { place(world, ...point); step(world); }
  assert.equal(core.view().attempt.inventory.length, 3);
  place(world, 850, 190);
  step(world);
  assert.equal(core.view().attempt.inventory.length, 3);
  assert.equal(world.items.find((entry) => entry.id === 'report-archive-2').collected, false);
  place(world, 85, 600);
  advance(world, .2, { interact: true });
  assert.equal(core.view().attempt.deliveredIds.length, 0, 'Short hold cannot deliver');
  hold(world, .5);
  assert.equal(core.view().attempt.deliveredIds.length, 3);
  place(world, 235, 600);
  advance(world, .4, { interact: true });
  assert.equal(core.view().attempt.broadcastOn, true, 'Short hold cannot toggle broadcast');
  hold(world, .9);
  assert.equal(core.view().attempt.broadcastOn, false);
  place(world, 850, 190);
  step(world);
  assert(core.view().attempt.inventory.includes('report-archive-2'));
  place(world, 85, 600);
  advance(world, 1.3, { interact: true });
  assert.equal(core.view().attempt.inventory.length, 1, 'Closed broadcast needs the longer hold');
  advance(world, .4, { interact: true });
  assert.equal(core.view().attempt.inventory.length, 0);
});

test('Grok action breaks the addressed physical wall', () => {
  const { world } = fixture();
  place(world, 350, 600);
  command(world, 'paper-window');
  assert(world.barriers.find((entry) => entry.id === 'paper-window').broken);
  assert(!world.solidBodies().some((entry) => entry.id === 'paper-window'));
  assert.equal(world.nodes.find((node) => node.itemId === 'harbor-data-2').hp, 0,
    'A real Grok charge must apply two damage to a node along its sweep');
});

test('ordinary server nodes require two distinct actual dashes; repeated substeps count once', () => {
  const { world, core } = fixture();
  const node = world.nodes.find((entry) => entry.itemId === 'harbor-data-1');
  place(world, node.x, node.y); step(world);
  assert.equal(node.hp, 2);
  assert.equal(core.view().attempt.inventory.length, 0, 'An intact node cannot be picked up');
  place(world, 280, 490);
  step(world, { right: true, dashPressed: true });
  advance(world, .4, { right: true });
  assert.equal(node.hp, 1, 'Many sweep substeps in one dash remove only one HP');
  const firstAttack = node.lastAttack;
  assert.equal(core.view().attempt.inventory.length, 0);
  until(world, () => world.player.dashCooldown === 0, 3, 'Second actual dash cooldown');
  step(world, { left: true, dashPressed: true });
  advance(world, .3, { left: true });
  assert.equal(node.hp, 0);
  assert.notEqual(node.lastAttack, firstAttack);
  assert(core.view().attempt.inventory.includes(node.itemId), 'Opened data becomes a real nearby pickup');
});

test('a node opened with a full backpack remains in the world until a later pickup', () => {
  const { world, core } = fixture();
  command(world, 'paper-window');
  for (const point of [[485, 490], [555, 380], [800, 270]]) {
    place(world, ...point); step(world);
  }
  assert.equal(core.view().attempt.inventory.length, 3);
  const node = world.nodes.find((entry) => entry.itemId === 'harbor-data-1');
  openNode(world, node);
  assert.equal(node.hp, 0);
  assert.equal(world.items.find((entry) => entry.id === node.itemId).collected, false);
  assert.equal(core.view().attempt.inventory.length, 3);
  place(world, 85, 600); hold(world, .5);
  place(world, node.x, node.y); step(world);
  assert(core.view().attempt.inventory.includes(node.itemId));
});

test('open command previews recover after cooldown without requiring a second target click', () => {
  const { world, core } = fixture();
  place(world, 350, 600);
  command(world, 'paper-window');
  assert(world.selectTeammate('Grok'));
  // Keep a useful unopened target selected; the already-open paper window
  // correctly stays unavailable even after Grok's cooldown expires.
  assert(world.selectTarget('outer-node'));
  assert.equal(world.commandPreview.available, false);
  until(world, () => core.view().attempt.elapsedMs > core.view().attempt.readyAtMs.Grok + 50,
    12, 'Preview cooldown clock');
  assert.equal(world.commandPreview.available, true,
    'Available state must refresh while an already-open command panel is visible');
});

test('open command previews recover when real movement enters command range', () => {
  const { world } = fixture(4);
  assert(world.selectTeammate('Claude'));
  assert.equal(world.commandPreview.targetId, 'evacuation-patrol');
  assert.equal(world.commandPreview.available, false, 'Remote target starts outside 900px');
  until(world, () => world.commandPreview.available, 6,
    'Walk into the live command preview range', { right: true });
  assert(world.player.x > world.map.spawn.x, 'Range changed through actual movement');
  assert(world.confirmCommand(false), 'In-range target must accept confirmation');
});

test('Claude action gives a real guard a lure destination and changes its path', () => {
  const { world, core } = fixture(1);
  place(world, 400, 600);
  command(world, 'patrol-east');
  const guard = world.guards.find((entry) => entry.id === 'resume-east-guard');
  assert(guard.lure && guard.luredUntil > 0, 'Guard must receive the actual decoy destination');
  assert(core.view().attempt.completedTargetIds.includes('patrol-east'));
  assert(Math.abs(guard.x - guard.homeX) > 8, 'Guard must physically move');
});

test('GLM reveals real trap regions and broad scans can activate an alarm', () => {
  const { world, core } = fixture(2);
  place(world, 400, 600);
  command(world, 'trap-bridge');
  assert(world.traps.some((entry) => entry.revealedUntil > world.time),
    'Trap must be temporarily revealed by the actual world effect');
  const alarmsBefore = core.view().attempt.alarmIds.length;
  command(world, 'alarm-fan');
  assert(core.view().attempt.alarmIds.length > alarmsBefore,
    'Broad scan near the upper alarm must report an actual alarm');
});

test('Claude cannot pull a guard off its own floor or beyond the patrol corridor', () => {
  const {world}=fixture(3);
  place(world,440,600);
  command(world,'archive-guard');
  const lower=world.guards.find(g=>g.id==='report-centre-guard');
  assert.equal(lower.lure,null,'An upper-floor decoy cannot teleport a lower patrol across gaps');
  for(const guard of world.guards){
    if(guard.lure)assert(guard.lure.x>=guard.minX&&guard.lure.x<=guard.maxX);
  }
  advance(world,3);
  for(const guard of world.guards)assert(guard.x>=guard.minX&&guard.x<=guard.maxX);
});

test('retry rebuild restores map objects and rejects the old world instance', () => {
  const { world, core } = fixture();
  command(world, 'paper-window');
  place(world, 485, 490); step(world);
  assert(world.barriers.some((entry) => entry.broken));
  assert(world.items.some((entry) => entry.collected));
  assert(world.nodes.some((entry) => entry.hp === 0));
  ok(core.retryChapter('world-integration-test'));
  const newAttemptTime = core.view().attempt.elapsedMs;
  assert.equal(world.update(DT, {} ).rebuild, true);
  assert.equal(core.view().attempt.elapsedMs, newAttemptTime,
    'A stale world must not advance the fresh attempt clock');
  const rebuilt = new GameWorld(core, getMap(core.view().chapter.id));
  assert.equal(rebuilt.player.x, rebuilt.map.spawn.x);
  assert.equal(rebuilt.player.y, rebuilt.map.spawn.y);
  assert(rebuilt.items.every((entry) => !entry.collected));
  assert(rebuilt.barriers.every((entry) => !entry.broken));
  assert(rebuilt.gates.every((entry) => !entry.open));
  assert(rebuilt.nodes.every((entry) => entry.hp === 2 && entry.lastAttack === null));
});

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
  const route = routeFor(surfaces, replans ? passableLadders : quietLadders, world.player, destination)
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
        const trappedExit = world.map.id === 'review-quietly'
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

function deliverAtBoat(world) {
  navigate(world, world.map.boat);
  const duration=world.core.view().attempt.deliveryDurationMs/1000+.15;
  if(world.core.view().attempt.scanIntervalMs&&world.nextScan-world.time<duration+.2){
    until(world,()=>!world.scanWarning&&world.nextScan-world.time>duration+.2,
      4,'Avoid a scheduled investigation column before holding delivery',()=>defensiveIdle(world));
    navigate(world,world.map.boat);
  }
  assert.equal(world.getInteraction(world.core.view())?.id, 'delivery', 'Boat delivery must be in range');
  hold(world, world.core.view().attempt.deliveryDurationMs / 1000 + .15);
  assert.equal(world.core.view().attempt.inventory.length, 0, 'Held interaction must empty the bag');
}

function openNode(world, node) {
  const surface = world.platforms.find((entry) => entry.kind !== 'lift'
    && entry.y === node.y && node.x >= entry.x && node.x <= entry.x + entry.w);
  assert(surface, 'Node has no standing surface: ' + node.id);
  const centre = surface.x + surface.w / 2;
  const patrol = world.guards.find((guard) => guard.y === node.y
    && guard.minX <= surface.x + surface.w && guard.maxX >= surface.x);
  const nearbyTrap = world.traps.find((trap) => Math.abs(trap.y + 8 - node.y) < 4
    && Math.abs(trap.x + trap.w / 2 - node.x) < 180);
  const dangerX = patrol ? (patrol.minX + patrol.maxX) / 2
    : nearbyTrap ? nearbyTrap.x + nearbyTrap.w / 2 : null;
  const escapeAim = dangerX === null ? centre
    : node.x < dangerX ? surface.x - 32 : surface.x + surface.w + 32;
  const cluster = world.nodes.filter((entry) => entry.y === node.y && entry.hp > 0
    && entry.x >= surface.x && entry.x <= surface.x + surface.w
    && Math.abs(entry.x - node.x) <= 180 && (!patrol || entry === node));
  for (let attack = 0; node.hp > 0 && attack < 3; attack++) {
    const startX = Math.max(surface.x + 18, Math.min(surface.x + surface.w - 18,
      node.x + (node.x > centre ? (cluster.length > 1 ? 25 : 40) : (cluster.length > 1 ? -25 : -40))));
    const decoy = patrol && world.map.targets.find((entry) =>
      entry.teammate === 'Claude' && entry.y === node.y);
    if (decoy) {
      navigate(world, { x: node.x >= 800 ? 1110 : 400, y: 600 });
      command(world, decoy.id);
    } else if (patrol && world.player.dashCooldown > 0) {
      navigate(world, { x: 1100, y: 600 });
      until(world, () => world.player.dashCooldown === 0, 4,
        'Wait below the patrolled platform rather than inside the guard route');
    }
    navigate(world, { x: startX, y: node.y });
    until(world, () => world.player.dashCooldown === 0, 4, 'Node dash cooldown',
      () => defensiveIdle(world));
    until(world, () => !world.scanWarning, 3, 'Finish avoiding the scan before striking',
      () => defensiveIdle(world));
    until(world, () => world.player.grounded, 2, 'Land before striking a server node');
    const before = node.hp;
    const clusterBefore = new Map(cluster.map((entry) => [entry.id, entry.hp]));
    step(world, { [world.player.x < node.x ? 'right' : 'left']: true, dashPressed: true });
    // Actual directional input can steer the current dash. Once contact is
    // registered, steer toward the platform centre to avoid falling off its edge.
    // No node HP, player coordinates, attack IDs or strike methods are modified.
    until(world, () => world.player.dashTime <= 0, 1, 'Complete the actual node dash', () => {
      const nextNode = cluster.find((entry) => entry.hp > 0
        && entry.hp === clusterBefore.get(entry.id));
      const aim = nextNode?.x ?? escapeAim;
      return { [world.player.x < aim ? 'right' : 'left']: true };
    });
    advance(world, .32);
    until(world, () => world.player.grounded, 3, 'Land after the node escape dash');
    assert.equal(node.hp, before - 1, 'Each player dash must strike the selected node once: '
      + JSON.stringify({ node, player: world.player }));
  }
  assert.equal(node.hp, 0, 'Node must open through actual input');
  if (!world.items.find((entry) => entry.id === node.itemId).collected
    && world.core.view().attempt.inventory.length < 3) navigate(world, node);
}

function carryRequired(world) {
  const chapter = world.core.view().chapter;
  for (let trips = 0; trips < 12; trips++) {
    const state = world.core.view().attempt;
    if (chapter.requiredItems.every((entry) => state.deliveredIds.includes(entry.id))) return;
    if (state.inventory.length === 3) { deliverAtBoat(world); continue; }
    const needed = chapter.requiredItems.find((entry) =>
      !state.deliveredIds.includes(entry.id) && !state.inventory.includes(entry.id));
    if (!needed) { deliverAtBoat(world); continue; }
    if (chapter.number === 2) {
      const lure = needed.id === 'resume-data-1' ? 'patrol-west'
        : needed.id === 'resume-data-5' ? 'patrol-east' : null;
      if (lure && !state.completedTargetIds.includes(lure)) {
        navigate(world, { x: lure === 'patrol-east' ? 1110 : 400, y: 600 });
        command(world, lure);
      }
    }
    const node = world.nodes.find((entry) => entry.itemId === needed.id);
    if (node?.hp > 0) openNode(world, node);
    const pickup = world.items.find((entry) => entry.id === needed.id);
    if (!pickup.collected) navigate(world, pickup);
    assert(world.items.find((entry) => entry.id === needed.id).collected
      || world.core.view().attempt.inventory.length === 3, 'Pickup did not occur through proximity');
  }
  assert.fail('Required transport did not finish in 12 trips');
}

test('all five chapters complete through physical directional input and held interactions', () => {
  const core = new GameCore({ persist: false });
  for (const chapter of CHAPTERS) {
    assert.equal(core.view().chapter.id, chapter.id);
    const world = new GameWorld(core, getMap(chapter.id));
    if (core.view().attempt.broadcastOn) {
      navigate(world, world.map.broadcast);
      hold(world, .9);
      assert.equal(core.view().attempt.broadcastOn, false);
    }
    navigate(world, { x: 440, y: 600 });
    for (const target of world.map.targets) {
      if (chapter.number === 2 && target.teammate === 'Claude') continue;
      if (target.teammate === 'Grok') {
        const chargeOrigin = chapter.number === 1 ? (target.id === 'paper-window' ? 500 : 1080)
          : chapter.number === 2 ? 720 : chapter.number === 3 ? 700 : 440;
        navigate(world, { x: chargeOrigin, y: 600 });
      }
      command(world, target.id, target.teammate === 'GLM');
    }
    for (const plate of world.plates) {
      if (chapter.number === 2) continue; // Use the open return ladders instead.
      navigate(world, { x: plate.x + plate.w / 2, y: plate.y + plate.h });
      hold(world, 1.3);
      assert(plate.latched && world.gates.find((gate) => gate.id === plate.gateId).open,
        'Pressure plate must physically latch its return gate');
    }
    if (chapter.number < 5) {
      carryRequired(world);
      if (chapter.number === 4) {
        navigate(world,{x:1090,y:380});
        command(world,'archive-guard');
        navigate(world, {x:1148,y:world.map.beacon.y});
        hold(world, .9);
        assert(core.view().attempt.returnBeaconReady);
      }
    } else {
      navigate(world,{x:1100,y:380});
      command(world,'evacuation-patrol');
      for (const item of world.items) navigate(world, item);
      assert.equal(core.view().attempt.inventory.length, 3);
      navigate(world, {x:950,y:270});
      command(world,'evacuation-patrol');
      navigate(world, {x:1050,y:270});
      hold(world, .7);
      assert(world.rendezvousRequested);
      until(world, () => core.view().attempt.rendezvousCrew.length === 3,
        22, 'Crew rendezvous through actual routes',()=>defensiveIdle(world));
      navigate(world, {x:1050,y:270});
      hold(world, .9);
      assert(core.view().attempt.remoteReady);
      hold(world, .9);
      assert(core.view().attempt.evacuationStarted);
      deliverAtBoat(world);
      assert(core.view().attempt.evacuationRemainingMs > 0);
    }
    navigate(world, world.map.boat);
    hold(world, .75);
    assert.equal(core.view().phase, 'chapter-result',
      'Boarding failed: ' + JSON.stringify(core.view().objectives));
    console.log('  PLAYTHROUGH ' + chapter.id + ': '
      + Math.round(core.view().attempt.elapsedMs / 1000) + ' simulated seconds; '
      + core.view().attempt.deliveryIds.length + ' physical delivery interactions; '
      + core.view().attempt.health + ' health');
    ok(core.continueCampaign());
  }
  assert.equal(core.view().phase, 'campaign-complete');
  assert.equal(core.view().campaign.results.length, 5);
});

if (failures.length) {
  console.error('World integration failures: ' + failures.join(', '));
  process.exitCode = 1;
} else console.log('World action integration checks and five-chapter input-driven playthrough passed.');
