/** Seeded world stress tests. Legal supported placements isolate upper-floor cases;
 * these random walks are boundary coverage, not a claim of human campaign clears. */
import assert from 'node:assert/strict';
import { CHAPTERS } from '../src/core/chapters.mjs';
import { GameCore } from '../src/core/state.mjs';
import { getMap } from '../src/game/maps.mjs';
import { GameWorld } from '../src/game/world.mjs';
import { getChapterRooms } from '../src/game/rooms.mjs';
import { chapterCheckpoint } from '../src/game/session.mjs';
import { CONTRACTS, createContract } from '../src/game/contracts.mjs';
import { compilePrompt } from '../src/game/prompts.mjs';

const failures = [], counts = { targetedRegressions: 0, cases: 0, frames: 0, snapshots: 0, commands: 0, resets: 0 };
const overlap = (p,s) => p.x+14>s.x+.001 && p.x-14<s.x+s.w-.001
  && p.y>s.y+.001 && p.y-48<s.y+s.h-.001;
const prng = seed => () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const fixture = (chapterIndex, roomIndex, contractId, seed) => {
  const chapter = CHAPTERS[chapterIndex];
  const core = new GameCore({ checkpoint: chapterCheckpoint(chapter.id), persist: false });
  const world = new GameWorld(core, getMap(chapter.id), { expanded: true, compilePrompt,
    contract: createContract(contractId, { seed, chapter: chapter.id }) });
  if (roomIndex) { world.captureRoom(); world.loadRoom(world.rooms[roomIndex]); world.runRoomEvents('room-enter'); }
  return { core, world };
};
const check = (world, context) => {
  const p = world.player, view = world.core.view();
  assert([p.x,p.y,p.vx,p.vy,world.time].every(Number.isFinite), 'Non-finite physics');
  assert(p.x>=16 && p.x<=1264 && p.y<=735, 'Player left playable bounds');
  assert(!world.solidBodies().some(s=>overlap(p,s)), 'Player intersects a solid: '+JSON.stringify({p,solids:world.solidBodies().filter(s=>overlap(p,s))}));
  assert(world.guards.every(g=>g.x>=g.minX && g.x<=g.maxX), 'Guard left patrol bounds');
  for (const key of ['inventory','deliveredIds','collectedSupplyIds','completedTargetIds'])
    assert.equal(new Set(view.attempt[key]).size, view.attempt[key].length, 'Duplicate core item: '+key);
  assert(view.attempt.inventory.length<=3, 'Backpack exceeded capacity');
  assert(world.nodes.every(n=>Number.isInteger(n.hp)&&n.hp>=0&&n.hp<=2), 'Node HP outside bounds');
  if (context.snapshot) {
    const before = world.exportState(), restored = world.restoreState(before);
    assert(restored.ok, 'Live snapshot rejected: '+restored.reason+' '+JSON.stringify(before));
    assert.deepEqual(world.exportState(),before,'Save/restore changed live state');
    counts.snapshots++;
  }
};

const exhaustTo = (core, remaining, targetId) => {
  for(let i=0;core.view().attempt.aiTokens>remaining;i++) {
    assert(core.prepareCommand({commandId:'budget-fixture-'+i,teammate:'Grok',targetId}).ok);
    assert(core.beginCommand('Grok').ok); assert(core.cancelCommand('Grok').ok);
    assert(core.advanceTime(6000).ok);
  }
};
// Regression: previews used to offer precise actions with one token and start
// half-funded relays, spending the first token before silently dropping step 2.
{
  const {world,core}=fixture(4,1,'standard',1024);
  Object.assign(world.player,{x:870,y:270});
  Object.assign(world.crew.find(c=>c.name==='Grok'),{x:860,y:270});
  Object.assign(world.crew.find(c=>c.name==='Claude'),{x:1020,y:270});
  exhaustTo(core,1,'evacuation-divider');
  world.selectTarget('evacuation-divider');world.setPromptMode(true);
  assert.equal(world.commandPreview.available,false);assert.match(world.commandPreview.reason,/AI Token/);
  assert.equal(world.confirmCommand(true),false);assert.equal(core.view().attempt.aiTokens,1);counts.targetedRegressions++;
  const plan={teammate:'Grok',targetId:'evacuation-divider',precise:false,constraintId:null,condition:null,promptText:'',cost:0,
    sequence:[{teammate:'Grok',targetId:'evacuation-divider',precise:false,cost:0},{teammate:'Claude',targetId:'evacuation-patrol',precise:false,cost:0}]};
  const before=core.view().attempt;
  assert(world.setPromptPlan(plan));assert.equal(world.commandPreview.available,false);assert.match(world.commandPreview.reason,/接力需要 2 枚 AI Token/);
  assert.equal(world.confirmCommand(false),false);assert.deepEqual(core.view().attempt,before);
  assert(world.crew.every(actor=>!actor.task));assert.deepEqual(world.relayQueue,[]);counts.targetedRegressions++;
  world.setPromptPlan({...plan,sequence:[]});assert.equal(world.commandPreview.available,true);
  assert(world.confirmCommand(false));assert.equal(core.view().attempt.aiTokens,0);counts.targetedRegressions++;
}
{
  const core=new GameCore({persist:false}),world=new GameWorld(core,getMap('paper-window'));
  exhaustTo(core,1,'paper-window');world.selectTarget('paper-window');world.previewTarget(world.map.targets[0],true);
  assert.equal(world.commandPreview.available,false);assert.match(world.commandPreview.reason,/AI Token/);
  assert.equal(world.confirmCommand(true),false);assert.equal(core.view().attempt.aiTokens,1);counts.targetedRegressions++;
}

const seeds = Number(process.env.FUZZ_SEEDS || 3), frames = Number(process.env.FUZZ_FRAMES || 900);
for (let chapter=0;chapter<5;chapter++) for (let room=0;room<getChapterRooms(CHAPTERS[chapter].id).length;room++)
  for (const contract of CONTRACTS) for (let seed=1;seed<=seeds;seed++) {
    const context={chapter:CHAPTERS[chapter].id,room,contract:contract.id,seed}, random=prng(seed*7919+chapter*31+room*101);
    let {world,core}=fixture(chapter,room,contract.id,seed), input={}; counts.cases++;
    try {
      for (let frame=0;frame<frames;frame++) {
        context.frame=frame;
        // Exercise all elevations without pretending random input learned a route.
        if (frame%300===0) {
          const surfaces=world.platforms.filter(p=>p.kind!=='lift'), surface=surfaces[Math.floor(random()*surfaces.length)];
          const candidate={x:surface.x+20+random()*Math.max(0,surface.w-40),y:surface.y};
          if (!world.solidBodies().some(s=>overlap(candidate,s))) Object.assign(world.player,candidate,{vx:0,vy:0,grounded:true,climbing:false,dashTime:0});
        }
        if (frame%15===0) input={left:random()<.45,right:random()<.45,up:random()<.2,down:random()<.2,jump:random()<.35,interact:random()<.15};
        input.jumpPressed=random()<.035; input.dashPressed=random()<.015;
        if (frame%79===0 && world.map.targets.length) {
          const target=world.map.targets[Math.floor(random()*world.map.targets.length)];
          world.selectTarget(target.id);world.setPromptMode(random()<.5);
          if (world.confirmCommand(world.promptConfig.precise)) counts.commands++;
        }
        if (frame%97===0) world.cancelPreview();
        const result=world.update(1/60,input); counts.frames++;
        if (result?.rebuild) { counts.resets++; world=new GameWorld(core,getMap(CHAPTERS[chapter].id),{expanded:true,compilePrompt,contract:world.contract}); continue; }
        if(core.view().phase!=='playing') break;
        check(world,{snapshot:frame%113===0});
      }
    } catch(error) {
      failures.push({...context,message:error.message});
      console.error('FUZZ_FAIL '+JSON.stringify({...context,message:error.message.slice(0,500)}));
    }
  }
console.log('WORLD_FUZZ_REPORT '+JSON.stringify({seeds,framesPerCase:frames,...counts,failures:failures.map(f=>({...f,message:f.message.slice(0,1000)}))}));
assert.equal(failures.length,0,'World stress failures: '+failures.length);
