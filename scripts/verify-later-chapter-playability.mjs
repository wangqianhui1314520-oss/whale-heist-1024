/** Targeted later-chapter regressions. Legal supported placements isolate the
 * reported command and beacon states; crew movement and effects stay real. */
import assert from 'node:assert/strict';
import { GameCore } from '../src/core/state.mjs';
import { GameWorld } from '../src/game/world.mjs';
import { getMap } from '../src/game/maps.mjs';
import { chapterCheckpoint } from '../src/game/session.mjs';
import { compilePrompt } from '../src/game/prompts.mjs';
const DT=1/60;
const fixture=chapter=>{const core=new GameCore({checkpoint:chapterCheckpoint(chapter),persist:false});return {core,world:new GameWorld(core,getMap(chapter),{expanded:true,compilePrompt})};};
const command=(world,id,precise=false)=>{world.selectTeammate('Grok');world.selectTarget(id);assert(world.confirmCommand(precise),world.commandPreview?.reason);};
const finish=world=>{for(let i=0;i<1800&&world.crew.find(c=>c.name==='Grok').task;i++)assert(!world.update(DT,{})?.rebuild);assert(!world.crew.find(c=>c.name==='Grok').task);};
{
 const {core,world}=fixture('resume-storm');assert(world.transitionRoom('to-action'));
 const before=core.view().attempt.aiTokens;command(world,'node-resume-data-4');
 const task=world.crew.find(c=>c.name==='Grok').task;assert.equal(task.geometry.route.at(-1).y,490);assert(task.geometry.goal.x<650);
 finish(world);assert(world.barriers.find(b=>b.id==='cargo-divider').broken);assert.equal(world.nodes.find(n=>n.id==='node-resume-data-4').hp,0);
 assert(core.objectives().find(g=>g.id==='changed-patrol').complete);assert.equal(core.view().attempt.aiTokens,before-1);assert.match(world.receipts[0].outcome,/打开 1 处障碍、1 个节点/);
 console.log('PASS chapter two node-first broad command reaches the correct platform and really opens its node and divider');
}
{
 const {core,world}=fixture('resume-storm');world.transitionRoom('to-action');const before=core.view().attempt;
 world.selectTeammate('Grok');world.selectTarget('node-resume-data-4');world.setPromptMode(true);
 assert.equal(world.commandPreview.available,true);assert.equal(world.commandPreview.geometry.direction,-1);assert.equal(world.commandPreview.geometry.route.at(-1).y,490);
 assert(world.confirmCommand(true));finish(world);assert.equal(world.nodes.find(n=>n.id==='node-resume-data-4').hp,0);assert(!world.barriers[0].broken);
 assert.equal(core.view().attempt.aiTokens,before.aiTokens-2);assert.equal(core.view().attempt.qualifiers,before.qualifiers-1);
 console.log('PASS a precise node command walks around to the accessible side without crossing or breaking the wall');
}
{
 const {core,world}=fixture('review-quietly');world.transitionRoom('to-action');command(world,'return-divider');
 assert.equal(world.crew.find(c=>c.name==='Grok').task.geometry.direction,-1);finish(world);
 assert(world.barriers.find(b=>b.id==='return-divider').broken);assert(core.objectives().find(g=>g.id==='completed-review').complete);
 assert(world.eventFlags.has('review-return-bridge'));assert(world.platforms.some(p=>p.id==='review-return-bridge'));
 console.log('PASS chapter three automatically takes a real ladder route to the reachable attack side and opens the return bridge');
}
{
 const {core,world}=fixture('resume-storm');world.transitionRoom('to-action');const budget=core.view().attempt.aiTokens;command(world,'node-resume-data-4');
 const saved=world.exportState(),actor=saved.crew.find(c=>c.name==='Grok');
 // This is the exact bad execution state produced by the old route fallback.
 actor.x=675;actor.y=600;actor.route=[];actor.task.stage='execute';actor.status='executing';
 const restored=new GameWorld(core,getMap('resume-storm'),{expanded:true,compilePrompt});assert(restored.restoreState(saved).ok);assert(!restored.update(DT,{})?.rebuild);
 assert.equal(core.view().attempt.aiTokens,budget);assert.equal(core.view().attempt.commands.Grok,undefined);
 assert(!core.view().attempt.completedTargetIds.includes('node-resume-data-4'));assert(!restored.barriers[0].broken);assert(restored.receipts[0].failed);
 console.log('PASS old wrong-floor tasks are cancelled and refunded without false success or fabricated obstacle breakage');
}
{
 const {core,world}=fixture('resume-storm');world.transitionRoom('to-action');const budget=core.view().attempt.aiTokens;command(world,'node-resume-data-4');
 world.completeTask(world.crew.find(c=>c.name==='Grok'));
 assert.equal(core.view().attempt.aiTokens,budget);assert(world.receipts[0].failed);assert(!core.view().attempt.completedTargetIds.includes('node-resume-data-4'));
 console.log('PASS a completion callback with no world effect cannot consume tokens or complete a mission');
}
{
 const {core,world}=fixture('close-hatch');world.transitionRoom('to-action');world.rendezvousRequested=true;
 world.crew.forEach((actor,index)=>Object.assign(actor,{x:1080+index*20,y:270,route:[]}));world.updateCrew(DT,core.view());
 assert.equal(core.view().attempt.rendezvousCrew.length,3);
 for(const item of world.items){Object.assign(world.player,{x:item.x,y:item.y});world.collectNearby(core.view());}
 assert.equal(core.view().attempt.inventory.length,3);const budget=core.view().attempt.aiTokens;
 const regroup=()=>{
  assert(world.transitionRoom('to-harbor'));assert(world.transitionRoom('to-action'));
  Object.assign(world.player,{x:1100,y:270});
  assert.equal(world.getInteraction(core.view()).id,'rendezvous');assert.match(world.getInteraction(core.view()).label,/0\/3/);
  const before=world.crew.map(actor=>actor.x);
  for(let i=0;i<120;i++){world.time+=DT;world.updateCrew(DT,core.view());}
  assert(world.crew.every((actor,index)=>actor.x!==before[index]),'Previously arrived crew must not freeze at the new room entrance');
  for(let i=0;i<2400&&!world.crew.every(actor=>Math.abs(actor.y-270)<1&&Math.abs(actor.x-1100)<70);i++){world.time+=DT;world.updateCrew(DT,core.view());}
  assert(world.crew.every(actor=>Math.abs(actor.y-270)<1&&Math.abs(actor.x-1100)<70));
  assert.equal(core.view().attempt.rendezvousCrew.length,3);assert.equal(core.view().attempt.aiTokens,budget);
 };
 regroup();assert.equal(world.getInteraction(core.view()).id,'prepare');world.getInteraction(core.view()).action();assert(core.view().attempt.remoteReady);assert(!core.view().attempt.evacuationStarted);
 regroup();assert.equal(world.getInteraction(core.view()).id,'evacuate');world.getInteraction(core.view()).action();assert(core.view().attempt.evacuationStarted);assert.equal(core.view().attempt.evacuationRemainingMs,60000);
 console.log('PASS chapter five regroups after room round trips before and after loading, requires actual crew presence, and starts the timer only on confirmation');
}
