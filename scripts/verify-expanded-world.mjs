/** V3 room persistence and physical interaction regressions. No simulated results are claimed from geometry checks. */
import assert from 'node:assert/strict';
import { CHAPTERS } from '../src/core/chapters.mjs';
import { GameCore } from '../src/core/state.mjs';
import { getMap } from '../src/game/maps.mjs';
import { ROOMS,getChapterRooms } from '../src/game/rooms.mjs';
import { GameWorld,routeFor } from '../src/game/world.mjs';
import { compilePrompt } from '../src/game/prompts.mjs';
import { chapterCheckpoint } from '../src/game/session.mjs';
import { createContract } from '../src/game/contracts.mjs';

const DT=1/60;
function fixture(index=0,options={}){const events=[],core=new GameCore({checkpoint:chapterCheckpoint(CHAPTERS[index].id),persist:false});
  const world=new GameWorld(core,getMap(CHAPTERS[index].id),{expanded:true,compilePrompt,...options,onEvent:(type,payload)=>events.push({type,payload})});return {world,core,events};}
function step(world,input={}){assert(!world.update(DT,input)?.rebuild,'Unexpected retry');}
function advance(world,seconds,input={}){for(let n=0;n<Math.ceil(seconds/DT);n++)step(world,input);}
function walk(world,x){for(let n=0;n<900;n++){const dx=x-world.player.x;if(Math.abs(dx)<3&&Math.abs(world.player.vx)<15)return;
  step(world,{left:dx<-2,right:dx>2});}assert.fail(`walk blocked ${world.currentRoom.id}: ${world.player.x} => ${x}`);}
function go(world,target){
  const route=routeFor(world.platforms,world.map.ladders,world.player,target);assert(route,`No static route to ${JSON.stringify(target)}`);
  for(const point of route){
    walk(world,point.x);
    if(point.climb){for(let n=0;n<600&&Math.abs(world.player.y-point.y)>2;n++)step(world,{up:world.player.y>point.y,down:world.player.y<point.y});assert(Math.abs(world.player.y-point.y)<3,'climb blocked');advance(world,.1);}
  }
  walk(world,target.x);
}
function interact(world,seconds=.35){advance(world,.05);advance(world,seconds,{interact:true});advance(world,.05);}
function waitTask(world,name,seconds=20){for(let n=0;n<seconds/DT&&world.crew.find(c=>c.name===name).task;n++)step(world);assert(!world.crew.find(c=>c.name===name).task,'task timeout');}
const passed=[];
function test(name,fn){fn();passed.push(name);console.log('PASS '+name);}

test('13 scenes preserve all five chapter item, supply and registered target IDs exactly once',()=>{
  assert.equal(ROOMS.length,13);
  for(const chapter of CHAPTERS){const rooms=getChapterRooms(chapter.id);assert.equal(rooms.length,chapter.number<=3?3:2);
    assert.equal(rooms.filter(r=>!r.optional).length,2);
    for(const [roomKey,chapterKey] of [['items','requiredItems'],['supplies','supplies'],['targets','commandTargets']]){
      const actual=rooms.flatMap(room=>room[roomKey].map(e=>e.id));assert.equal(new Set(actual).size,actual.length);
      const expected=roomKey==='items'?[...chapter.requiredItems,...chapter.optionalItems].map(e=>e.id):chapter[chapterKey].map(e=>e.id);
      assert.deepEqual(actual.sort(),expected.sort());
    }
    for(const room of rooms){
      assert(room.platforms.some(p=>p.id==='floor'&&p.y===600&&p.w===1280));
      for(const object of [...room.items,...room.supplies,...room.targets,...room.exits])assert(routeFor(room.platforms,room.ladders,room.spawn,object),`${room.id}: ${object.id} has no ladder route`);
      for(const exit of room.exits)assert(ROOMS.some(r=>r.id===exit.to&&r.chapterId===room.chapterId));
    }
  }
});

test('room changes require an exit interaction; all five main-room round trips use physical directional input',()=>{
  for(let i=0;i<5;i++){
    const {world,core,events}=fixture(i),attempt=core.view().attempt.attemptId;
    walk(world,1170);assert.equal(world.currentRoom.index,1);interact(world);
    assert.equal(world.currentRoom.index,2);assert.equal(core.view().attempt.attemptId,attempt);
    assert(world.crew.every(c=>Math.abs(c.y-world.player.y)<1&&Math.abs(c.x-world.player.x)<180));
    walk(world,1120);walk(world,65);interact(world);
    assert.equal(world.currentRoom.index,1);assert.equal(core.view().attempt.attemptId,attempt);
    assert.equal(events.filter(e=>e.type==='room-change').length,2);
  }
});

test('Grok really breaks the paper window and deploys a persistent return bridge once',()=>{
  const {world,core}=fixture();
  go(world,{x:390,y:490});advance(world,1.5);
  world.selectTeammate('Grok');world.selectTarget('paper-window');
  assert.equal(world.commandPreview.available,true,world.commandPreview.reason);assert.equal(world.confirmCommand(false),true);waitTask(world,'Grok');
  assert(world.barriers.find(b=>b.id==='paper-window').broken);
  assert(world.platforms.some(p=>p.id==='powered-return-bridge'));
  assert(world.eventFlags.has('paper-power-bridge'));const count=world.records.filter(r=>r.eventId==='paper-power-bridge').length;assert.equal(count,1);
  const savedInventory=core.view().attempt.inventory.slice();go(world,{x:1170,y:600});interact(world);walk(world,65);interact(world);
  assert(world.barriers.find(b=>b.id==='paper-window').broken);assert.equal(world.platforms.filter(p=>p.id==='powered-return-bridge').length,1);
  assert.equal(world.records.filter(r=>r.eventId==='paper-power-bridge').length,1);assert.deepEqual(core.view().attempt.inventory,savedInventory);
});

test('Grok rejects a repeated command with no remaining obstacle or node before charging',()=>{
  const {world,core}=fixture();go(world,{x:390,y:490});advance(world,1);
  world.selectTeammate('Grok');world.selectTarget('paper-window');assert(world.confirmCommand());waitTask(world,'Grok');
  advance(world,6.1);const tokens=core.view().attempt.aiTokens,receiptCount=world.receipts.length;
  world.selectTeammate('Grok');world.selectTarget('paper-window');
  assert.equal(world.commandPreview.available,false);assert.match(world.commandPreview.reason,/已经打开/);
  assert.equal(world.confirmCommand(),false);assert.equal(core.view().attempt.aiTokens,tokens);assert.equal(world.receipts.length,receiptCount);
});

test('empty action tokens recover only after a real console interaction and unlock the required GLM scan',()=>{
  const {world,core,events}=fixture(2);
  // Use the public resource/command API to reproduce an exhausted attempt;
  // actual console travel, held interaction and the later scan use the world.
  for(const supply of core.view().chapter.supplies)assert(core.collectSupply(supply.id).ok);
  for(const clue of core.vulnerabilityState().caseFile.clues){assert(core.collectVulnerabilityEvidence(clue.id).ok);assert(core.analyzeVulnerability(clue.id).ok);}
  for(const repair of core.vulnerabilityState().caseFile.repairs)assert(core.selectVulnerabilityRepair(repair.id).ok);
  for(let i=0;i<12;i++){
    assert(core.prepareCommand({commandId:'exhaust-'+i,teammate:'Grok',targetId:'return-divider'}).ok);
    assert(core.beginCommand('Grok').ok);assert(core.cancelCommand('Grok').ok);assert(core.advanceTime(6000).ok);
  }
  assert.equal(core.view().attempt.aiTokens,0);assert.equal(core.view().objectives.find(o=>o.id==='completed-review').complete,false);
  const mainGoals=core.objectives(),score=core.view().campaign.totalScore,exposure=core.view().attempt.exposureDelta;
  assert.equal(core.claimEmergencyToken('boat').reason,'not-at-analysis-station');
  interact(world,1);assert.equal(core.view().attempt.aiTokens,0,'Interacting away from the console cannot refill');
  walk(world,330);const emergency=world.getInteraction(core.view());assert.equal(emergency.id,'emergency-ai-token');
  walk(world,100);emergency.action();assert.equal(core.view().attempt.aiTokens,0,'Leaving the station invalidates its delayed interaction');
  walk(world,330);
  interact(world,.4);assert.equal(core.view().attempt.aiTokens,0,'A partial hold cannot refill');
  interact(world,.9);assert.equal(core.view().attempt.aiTokens,1);
  emergency.action();assert.equal(core.view().attempt.aiTokens,1,'A stale callback cannot stockpile tokens');
  assert.equal(core.claimEmergencyToken('analysis-station').reason,'emergency-token-not-needed');
  assert.equal(world.getInteraction(core.view()).id,'analysis-station');
  assert.equal(world.receipts.filter(r=>r.type==='emergency-ai-token').length,1);
  assert.equal(events.filter(e=>e.type==='resource-receipt').length,1);
  assert.equal(world.records.find(r=>r.type==='emergency-ai-token').public,false);
  assert.deepEqual(core.objectives(),mainGoals);assert.equal(core.view().campaign.totalScore,score);assert.equal(core.view().attempt.exposureDelta,exposure);
  go(world,{x:650,y:380});advance(world,1);world.selectTeammate('GLM');world.selectTarget('trap-bridge');
  assert(world.commandPreview.available,world.commandPreview.reason);assert(world.confirmCommand(false));waitTask(world,'GLM');
  assert.equal(core.view().objectives.find(o=>o.id==='completed-review').complete,true);
  assert.equal(core.view().attempt.aiTokens,0);assert(world.receipts.some(r=>r.teammate==='GLM'&&r.revealedCount>0));
  go(world,{x:330,y:600});interact(world,.9);assert.equal(core.view().attempt.aiTokens,1,'A later empty attempt can refill again');
});

test('every expanded room has a console physically reachable from its entry without commands',()=>{
  for(let i=0;i<CHAPTERS.length;i++)for(const room of getChapterRooms(CHAPTERS[i].id)){
    const {world}=fixture(i);if(room.index!==1)assert(world.transitionRoom(room.optional?'to-annex':'to-action'));
    assert(world.map.analysisStation,room.id);assert(world.navigationRoute(world.player,world.map.analysisStation),room.id);
    go(world,world.map.analysisStation);assert.equal(world.getInteraction(world.core.view()).id,'analysis-station',room.id);
  }
});

test('optional annex traversal, collected supply and node damage remain persistent across rooms',()=>{
  const {world}=fixture();go(world,{x:390,y:490});step(world,{right:true,dashPressed:true});advance(world,.25);assert.equal(world.nodes[0].hp,1);
  go(world,{x:870,y:380});interact(world);assert(world.currentRoom.optional);
  go(world,{x:750,y:270});assert(world.supplies[0].collected);const supplyId=world.supplies[0].id;
  go(world,{x:65,y:600});interact(world);assert.equal(world.currentRoom.index,1);assert.equal(world.nodes[0].hp,1);
  go(world,{x:870,y:380});interact(world);assert(world.supplies.find(s=>s.id===supplyId).collected);
  assert.equal(world.snapshot().room.optional,true);
});

test('chapter-one archive unlocks a persistent maintenance shortcut while the original return route remains usable',()=>{
  const {world,core,events}=fixture();go(world,{x:870,y:380});interact(world);assert.equal(world.currentRoom.id,'paper-window:annex');
  const hatch=world.currentRoom.exits.find(exit=>exit.id==='maintenance-hatch');assert(hatch);
  go(world,{x:hatch.x,y:hatch.y});assert.equal(world.getInteraction(core.view()).type,'room-exit-locked');
  assert.equal(world.transitionRoom(hatch),false);assert.equal(world.transitionRoom({...hatch,requiresEvent:undefined}),false);
  const unopened=JSON.parse(JSON.stringify(world.exportState()));unopened.eventFlags.push('harbor-annex-found');
  assert.equal(new GameWorld(core,getMap('paper-window'),{expanded:true}).restoreState(unopened).ok,false,'an unlocked hatch requires its archive item');
  assert.equal(world.currentRoom.id,'paper-window:annex');
  go(world,{x:550,y:380});assert(world.items.find(item=>item.id==='harbor-extra-1').collected);
  assert(world.eventFlags.has('harbor-annex-found'));assert(events.some(event=>event.type==='world-event'&&/维护舱捷径/.test(event.payload.text)));
  go(world,{x:hatch.x,y:hatch.y});assert.equal(world.getInteraction(core.view()).id,'exit-maintenance-hatch');
  const saved=JSON.parse(JSON.stringify(world.exportState()));
  const restored=new GameWorld(core,getMap('paper-window'),{expanded:true});assert.equal(restored.restoreState(saved).ok,true);
  assert.equal(restored.getInteraction(core.view()).id,'exit-maintenance-hatch');assert(restored.transitionRoom('maintenance-hatch'));
  assert.equal(restored.currentRoom.id,'paper-window:room-2');
  const forged=JSON.parse(JSON.stringify(saved));
  forged.roomStates['paper-window:annex'].items.find(item=>item.id==='harbor-extra-1').collected=false;
  assert.equal(new GameWorld(core,getMap('paper-window'),{expanded:true}).restoreState(forged).ok,false,'collected archive and unlock event must agree');

  const legacy=fixture().world;go(legacy,{x:870,y:380});interact(legacy);go(legacy,{x:65,y:600});interact(legacy);
  assert.equal(legacy.currentRoom.id,'paper-window:room-1');go(legacy,{x:1170,y:600});interact(legacy);
  assert.equal(legacy.currentRoom.id,'paper-window:room-2');
});

test('JSON world snapshots restore room, bridge, player, clocks, records, receipts and cooldown display state',()=>{
  const {world,core}=fixture();go(world,{x:390,y:490});advance(world,1);world.selectTeammate('Grok');world.selectTarget('paper-window');assert(world.confirmCommand());waitTask(world,'Grok');
  const snapshot=JSON.parse(JSON.stringify(world.exportState()));
  const restored=new GameWorld(core,getMap('paper-window'),{expanded:true});assert.equal(restored.restoreState(snapshot).ok,true);
  assert.deepEqual(restored.exportState(),snapshot);assert.equal(restored.restoreState({...snapshot,chapterId:'close-hatch'}).ok,false);
});

test('in-flight commands prevent hidden-room execution; waiting cancellation does not spend a qualifier',()=>{
  const {world,core}=fixture(3);world.player.x=700;world.player.y=380;world.crew.find(c=>c.name==='GLM').x=680;world.crew.find(c=>c.name==='GLM').y=380;
  world.selectTeammate('GLM');world.selectTarget('return-inspection');assert(world.confirmCommand());
  assert.equal(world.transitionRoom('to-action'),false);assert.equal(world.currentRoom.index,1);
  waitTask(world,'GLM');assert.equal(world.transitionRoom('to-action'),true);
  const actor=world.crew.find(c=>c.name==='Claude');actor.x=900;actor.y=270;world.player.x=900;world.player.y=270;
  world.selectTeammate('Claude');world.selectTarget('archive-guard');world.setCondition({type:'guard-turn',targetId:'report-archive-guard'});
  const qualifiers=core.view().attempt.qualifiers;
  assert.equal(world.commandPreview.cost,1);assert(world.confirmCommand(false));assert.equal(actor.task.stage,'waiting');assert.equal(core.view().attempt.qualifiers,qualifiers);
  assert(world.transitionRoom('to-harbor'));assert.equal(core.view().attempt.qualifiers,qualifiers);assert.equal(actor.task,null);
});

test('guard detection uses its rendered clipped region, warns before alarm, and never leaves patrol bounds',()=>{
  const {world,core}=fixture(1);const guard=world.guards[0];world.player.x=guard.x-80;world.player.y=guard.y;guard.direction='right';assert.equal(world.guardSeesPlayer(guard),false);
  world.player.x=guard.x+70;assert.equal(world.guardSeesPlayer(guard),true);guard.luredUntil=world.time+1;assert.equal(world.guardSeesPlayer(guard),false);
  world.player.x=100;world.player.y=600;advance(world,1.2);const alarms=core.view().attempt.alarmEventIds?.length??core.view().attempt.alarmCount??0;
  world.warnAlarm('fixture-sensor',700,380);assert.equal(world.alarmWarnings.length,1);advance(world,.8);assert.equal(world.alarmWarnings.length,1);
  advance(world,.6);assert.equal(world.alarmWarnings.length,0);assert(world.records.some(r=>r.type==='alarm'&&r.sourceId==='fixture-sensor'));
  advance(world,8);for(const g of world.guards)assert(g.x>=g.minX&&g.x<=g.maxX);
});

test('precise and default preview geometry is exactly the geometry retained by the executing task',()=>{
  for(const precise of [false,true]){const {world}=fixture();go(world,{x:390,y:490});advance(world,1);world.selectTeammate('Grok');world.selectTarget('paper-window');world.setPromptMode(precise);
    const geometry=JSON.parse(JSON.stringify(world.commandPreview.geometry));assert(world.confirmCommand(precise));assert.deepEqual(world.crew[0].task.geometry,geometry);waitTask(world,'Grok');assert.equal(world.receipts[0].precise,precise);}
});

test('wait-for-turn begins and spends one qualifier only after a real guard turn',()=>{
  const {world,core}=fixture(3);assert(world.transitionRoom('to-action'));
  world.player.x=900;world.player.y=270;const actor=world.crew.find(c=>c.name==='Claude');actor.x=900;actor.y=270;
  world.selectTeammate('Claude');world.selectTarget('archive-guard');world.setCondition({type:'guard-turn',targetId:'report-archive-guard'});
  const before=core.view().attempt.qualifiers;assert(world.confirmCommand(false));assert.equal(core.view().attempt.qualifiers,before);
  assert.equal(actor.task.stage,'waiting');advance(world,.3);assert.equal(actor.task.stage,'waiting');assert.equal(core.view().attempt.qualifiers,before);
  waitTask(world,'Claude');assert.equal(core.view().attempt.qualifiers,before-1);assert.equal(world.receipts[0].affectedCount,1);
});

test('a two-person relay executes in order with real effects and two receipts',()=>{
  const {world}=fixture(4);assert(world.transitionRoom('to-action'));
  world.player.x=870;world.player.y=270;
  Object.assign(world.crew.find(c=>c.name==='Grok'),{x:860,y:270});Object.assign(world.crew.find(c=>c.name==='Claude'),{x:1020,y:270});
  const plan={teammate:'Grok',targetId:'evacuation-divider',precise:false,constraintId:null,condition:null,promptText:'',cost:0,
    sequence:[{teammate:'Grok',targetId:'evacuation-divider',precise:false,cost:0},{teammate:'Claude',targetId:'evacuation-patrol',precise:false,cost:0}]};
  assert(world.setPromptPlan(plan));assert(world.confirmCommand(false));assert.equal(world.crew.find(c=>c.name==='Claude').task,null);
  for(let n=0;n<1800&&(world.crew.some(c=>c.task)||world.relayQueue.length);n++)step(world);
  assert.deepEqual(world.receipts.map(r=>r.teammate),['Grok','Claude']);assert(world.barriers[0].broken);assert(world.guards[0].lure);
});

test('challenge contract affects every room reproducibly and keeps the static fallback when bridges are closed',()=>{
  const contract=createContract('dense-patrol',{seed:'expanded-check',chapter:'resume-storm'});
  const a=fixture(1,{contract}),b=fixture(1,{contract});assert.deepEqual(a.world.guards,b.world.guards);
  assert.equal(a.world.guards[0].speed,38*1.2);a.world.transitionRoom('to-action');b.world.transitionRoom('to-action');assert.deepEqual(a.world.guards,b.world.guards);assert.equal(a.world.guards[0].speed,48*1.2);
  const {world}=fixture(0,{contract:createContract('closed-shortcuts',{chapter:'paper-window'})});go(world,{x:390,y:490});advance(world,1);world.selectTeammate('Grok');world.selectTarget('paper-window');assert(world.confirmCommand());waitTask(world,'Grok');
  assert(!world.platforms.some(p=>p.id==='powered-return-bridge'));assert(world.navigationRoute(world.crew[0],{x:85,y:600}));
});

test('Claude training credit is independent, consumed at start, serialized and reported without spending the chapter budget',()=>{
  const {world,core}=fixture(1,{trainingCredits:{Claude:1}});core.configureAttempt({qualifiers:0});
  world.player.x=100;world.player.y=600;Object.assign(world.crew.find(c=>c.name==='Claude'),{x:390,y:490});
  world.selectTeammate('Claude');world.selectTarget('patrol-west');world.setPromptMode(true);
  assert.equal(world.commandPreview.cost,0);assert.equal(world.commandPreview.trainingCost,1);assert.equal(world.trainingCredits.Claude,1);
  assert(world.confirmCommand(true));assert.equal(world.trainingCredits.Claude,0);assert.equal(core.view().attempt.qualifiers,0);waitTask(world,'Claude');
  assert.equal(world.receipts[0].training,true);assert.equal(world.receipts[0].chargedCost,0);assert.equal(world.receipts[0].budgetSource,'training');assert.equal(world.receipts[0].affectedCount,1);
  const state=JSON.parse(JSON.stringify(world.exportState()));const restored=new GameWorld(core,getMap('resume-storm'),{expanded:true,trainingCredits:{Claude:1}});assert(restored.restoreState(state).ok);assert.equal(restored.trainingCredits.Claude,0);
  advance(world,9);world.selectTeammate('Claude');world.selectTarget('patrol-west');world.setPromptMode(true);assert.equal(world.commandPreview.cost,1);assert.equal(world.commandPreview.available,false);
});

test('malformed snapshots reject coordinates, entities, geometry, flags and oversized data without mutating the live world',()=>{
  const {world}=fixture(),before=world.exportState();const clone=()=>JSON.parse(JSON.stringify(before));const room=before.roomId;
  const mutations=[
    state=>state.player.x=Infinity,state=>state.player.w=200,state=>state.player.dashCooldown=500,
    state=>state.roomId='close-hatch:room-2',state=>state.roomStates[room].items[0].id='foreign-item',
    state=>state.roomStates[room].items.push({...state.roomStates[room].items[0]}),state=>state.roomStates[room].nodes[0].hp=9,
    state=>state.roomStates[room].platforms[0].y=900,state=>state.roomStates[room].platforms.push({id:'injected-bridge',x:0,y:100,w:1280,h:20}),
    state=>state.eventFlags.push('unknown-reward'),state=>state.crew[0].route=[{x:NaN,y:600}],state=>state.crew[0].name='Unknown',
    state=>state.roomStates[room].supplies={},state=>state.trainingCredits.Claude=-1,state=>state.message='x'.repeat(800000),
  ];
  for(const mutate of mutations){const state=clone();mutate(state);assert.equal(world.restoreState(state).ok,false);assert.deepEqual(world.exportState(),before);}
  const circular=clone();circular.self=circular;assert.equal(world.restoreState(circular).ok,false);assert.deepEqual(world.exportState(),before);
});

test('an in-progress command survives a JSON checkpoint and completes exactly once after restoration',()=>{
  const {world,core}=fixture();go(world,{x:390,y:490});advance(world,1);world.selectTeammate('Grok');world.selectTarget('paper-window');assert(world.confirmCommand());advance(world,.1);
  const state=JSON.parse(JSON.stringify(world.exportState()));const restored=new GameWorld(core,getMap('paper-window'),{expanded:true});
  assert.equal(restored.restoreState(state).ok,true);assert.deepEqual(restored.exportState(),state);waitTask(restored,'Grok');assert.equal(restored.receipts.length,1);assert(restored.barriers[0].broken);
});

console.log(`Expanded world: ${passed.length} physical interaction/state checks passed. Geometry coverage is reported separately from traversal; this script does not claim a full V3 campaign clear or a measured human completion time.`);
