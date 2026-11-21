import assert from 'node:assert/strict';
import { GameCore } from '../src/core/state.mjs';
import { GameWorld } from '../src/game/world.mjs';
import { getMap } from '../src/game/maps.mjs';
import { compilePrompt } from '../src/game/prompts.mjs';
import { chapterCheckpoint } from '../src/game/session.mjs';
import { createContract } from '../src/game/contracts.mjs';
import { getStoryScene } from '../src/game/story.mjs';
import { playerGuidance } from '../src/game/player-guidance.mjs';
const fixture = (chapter='paper-window', contract=null) => {
  const core = new GameCore({ checkpoint:chapterCheckpoint(chapter), persist:false });
  const world = new GameWorld(core,getMap(chapter),{expanded:true,compilePrompt,contract});
  return {core,world,guide:()=>playerGuidance(world,core.view())};
};
{
  const {core,world,guide}=fixture();
  const before=JSON.stringify({core:core.exportRuntime(),world:world.exportState()});
  assert.match(guide().label,/收集资料 0\/4/); assert.equal(guide().target.x,390);
  for(let i=0;i<50;i++)guide();
  assert.equal(JSON.stringify({core:core.exportRuntime(),world:world.exportState()}),before,'guidance is read-only');
  for(const id of ['harbor-data-1','harbor-data-2','harbor-data-3'])assert(core.pickup(id).ok);
  assert.match(guide().label,/回艇交付 3/);assert.equal(guide().target.x,85);
  assert(core.deliver('fixture-delivery').ok);
  assert.match(guide().label,/收集资料 3\/4/);assert.equal(guide().local,false);assert.equal(guide().target.x,1170);
  assert(core.pickup('harbor-data-4').ok);assert.match(guide().label,/回艇交付 1/);
  assert(core.deliver('fixture-final-delivery').ok);assert.match(guide().label,/Grok 打开纸窗/);
  assert(core.prepareCommand({commandId:'fixture-grok',teammate:'Grok',targetId:'paper-window',precise:false}).ok);
  assert(core.beginCommand('Grok').ok);assert(core.completeCommand('Grok','fixture-grok').ok);
  assert.match(guide().label,/登艇/);
  console.log('PASS actual inventory, deliveries and accepted mechanics drive collection, return and boarding guidance without mutating progress');
}
for(const chapter of ['resume-storm','review-quietly','public-report']){
  const {core,world,guide}=fixture(chapter);assert(world.transitionRoom('to-action'));
  const hatch=world.map.exits.find(exit=>exit.id==='return-hatch');assert(hatch);
  assert.equal(world.transitionRoom(hatch.id),false,'locked hatch cannot teleport');
  const source=world.map.events.find(event=>event.id===hatch.requiresEvent).subject;
  assert.equal(world.items.find(item=>item.id===source).collected,false);
  assert(world.event('pickup',{itemId:source}).ok);world.items.find(item=>item.id===source).collected=true;
  assert(world.eventFlags.has(hatch.requiresEvent));
  // Isolated accepted item fixtures fill the pack; the runtime gate above is real.
  for(const item of core.view().chapter.requiredItems)if(core.view().attempt.inventory.length<3&&!core.view().attempt.inventory.includes(item.id))assert(core.pickup(item.id).ok);
  world.player.x=1090;assert.equal(guide().target.x,1090,'nearby unlocked hatch is preferred');
  const state=world.exportState();assert(world.restoreState(state).ok,'hatch event survives a complete world restore');
  assert(world.transitionRoom('return-hatch'));assert.equal(world.currentRoom.index,1);assert.equal(world.player.x,140);
  assert.equal(core.view().attempt.deliveredIds.length,0,'shortcut never delivers or scores items');
  const closed=fixture(chapter,createContract('closed-shortcuts',{chapter}));assert(closed.world.transitionRoom('to-action'));
  closed.world.eventFlags.add(hatch.requiresEvent);assert.equal(closed.world.transitionRoom('return-hatch'),false);
  assert.equal(closed.world.transitionRoom('to-harbor'),true,'original route remains available');
}
console.log('PASS three earned return hatches preserve pickups, saves and closed-shortcut challenge rules');
{
  // Keeping the broadcast public is a legitimate route: guidance goes straight
  // to the task while the ledger leaks, instead of railroading to the console.
  const {core,world,guide}=fixture('public-report');
  assert.equal(core.view().attempt.broadcastOn,true);
  assert.match(guide().label,/收集任务档案/);
  assert(world.event('broadcast',{on:false}).ok);assert.match(guide().label,/收集任务档案/);
}
{
  const {core,world,guide}=fixture('close-hatch');assert.match(guide().label,/远端站/);assert.equal(guide().target.x,1170);
  assert(world.transitionRoom('to-action'));assert.match(guide().label,/收集最终资料 0\/3/);
  for(const item of core.view().chapter.requiredItems)assert(core.pickup(item.id).ok);
  assert.match(guide().label,/集结队友 0\/3/);assert.equal(core.view().attempt.evacuationStarted,false);
  assert.equal(world.map.exits.some(exit=>exit.id==='return-hatch'),false,'timed final route is retained');
  const target=world.map.targets.find(target=>target.id==='evacuation-divider');
  assert(world.selectTeammate('Grok'));assert.equal(world.commandPreview.targetId,target.id);
}
{
  const {world}=fixture();world.update(1/60,{dashPressed:true});assert(world.player.dashCooldown<=1.65);
  for(let i=0;i<102;i++)world.update(1/60,{});assert.equal(world.player.dashCooldown,0);
  const departure=getStoryScene('departure');assert.equal(departure.steps.length,2);assert.equal(departure.duration,8);
  assert(departure.steps.every(step=>!step.choice));assert.equal(departure.requiresStart,true);
}
console.log('PASS broadcast, final preparation, shorter dash recovery and a two-beat departure retain their real gates');
