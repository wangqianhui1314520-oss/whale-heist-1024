import assert from 'node:assert/strict';
import { GameCore } from '../src/core/state.mjs';
import { GameWorld } from '../src/game/world.mjs';
import { getMap } from '../src/game/maps.mjs';
import { compilePrompt } from '../src/game/prompts.mjs';

const fixture=()=>{const core=new GameCore({persist:false});return {core,world:new GameWorld(core,getMap('paper-window'),{expanded:true,compilePrompt})};};
const paperGoal=core=>core.objectives().find(goal=>goal.id==='effective-command').complete;
function execute(world,target='node-harbor-data-1',precise=false){
  world.selectTeammate('Grok');world.selectTarget(target);assert(world.confirmCommand(precise),world.commandPreview?.reason);
  for(let i=0;i<1800&&world.crew[0].task;i++)world.update(1/60,{});
  assert(!world.crew[0].task);assert.equal(world.receipts.length,1);
}
{
 const {core,world}=fixture(),tokens=core.view().attempt.aiTokens;
 world.selectTeammate('Grok');world.selectTarget('node-harbor-data-1');
 assert(world.commandPreview.geometry.barrierIds.includes('paper-window'));
 assert.equal(paperGoal(core),false,'Preview is not completion evidence');
 assert.equal(core.recordCommandEffects({commandId:'fake',teammate:'Grok',targetId:'node-harbor-data-1',affectedTargetIds:['paper-window']}).ok,false);
 execute(world);
 assert(world.barriers[0].broken);assert(paperGoal(core));
 assert(core.view().attempt.completedTargetIds.includes('node-harbor-data-1'));
 assert(core.view().attempt.collaborationIds.includes('paper-window'));
 assert.equal(core.view().attempt.aiTokens,tokens-1);assert.equal(core.view().attempt.publicCommandIds.length,1);
 for(const id of ['harbor-data-1','harbor-data-2','harbor-data-3'])assert(core.pickup(id).ok);
 assert(core.deliver('paper-regression-delivery-1').ok);assert(core.pickup('harbor-data-4').ok);assert(core.deliver('paper-regression-delivery-2').ok);
 assert(core.board().ok,'The completed physical paper-window effect must allow boarding after required deliveries');
 console.log('PASS broad node command completes the physical paper window, spends once, and permits boarding');
}
{
 const {core,world}=fixture();execute(world,'node-harbor-data-1',true);
 assert(!world.barriers[0].broken);assert(!paperGoal(core),'Precise node-only action must not credit an untouched paper window');
 console.log('PASS precise node-only commands cannot complete an untouched paper window');
}
{
 const {core,world}=fixture();execute(world);
 const runtime=core.exportRuntime();runtime.attempt.completedTargetIds=runtime.attempt.completedTargetIds.filter(id=>id!=='paper-window');
 runtime.attempt.collaborationIds=runtime.attempt.collaborationIds.filter(id=>id!=='paper-window');runtime.phase='paused';
 const state=world.exportState();world.loadRoom(world.rooms[1]);const away=world.exportState();
 for(const saved of [state,away]){
  const restored=new GameCore({persist:false});assert(restored.restoreRuntime(runtime).ok);
  const loaded=new GameWorld(restored,getMap('paper-window'),{expanded:true,compilePrompt});assert(loaded.restoreState(saved).ok);
  assert(paperGoal(restored));const before=restored.exportRuntime().attempt;
  assert(loaded.restoreState(saved).ok);assert.deepEqual(restored.exportRuntime().attempt,before,'Recovery must be idempotent');
  assert.equal(before.aiTokens,runtime.attempt.aiTokens);assert.equal(before.elapsedMs,runtime.attempt.elapsedMs);
 }
 const untouched=structuredClone(state);untouched.roomStates[untouched.roomId].barriers[0].broken=false;
 const unproven=new GameCore({persist:false});assert(unproven.restoreRuntime(runtime).ok);
 const unprovenWorld=new GameWorld(unproven,getMap('paper-window'),{expanded:true,compilePrompt});assert(unprovenWorld.restoreState(untouched).ok);assert(!paperGoal(unproven));
 console.log('PASS old paused saves recover at the dock or in another room without charging, resetting, or trusting receipts alone');
}
