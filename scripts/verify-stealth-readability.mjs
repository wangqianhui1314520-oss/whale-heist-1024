/** Damage and movement regressions for decoys and the visible investigation beam. */
import assert from 'node:assert/strict';
import { GameCore } from '../src/core/state.mjs';
import { GameWorld, SCAN_WARNING_SECONDS } from '../src/game/world.mjs';
import { getMap } from '../src/game/maps.mjs';
import { chapterCheckpoint } from '../src/game/session.mjs';
import { compilePrompt } from '../src/game/prompts.mjs';

const DT=1/60;
function fixture(chapter='resume-storm'){
  const core=new GameCore({checkpoint:chapterCheckpoint(chapter),persist:false});
  const world=new GameWorld(core,getMap(chapter),{expanded:true,compilePrompt});
  return {core,world};
}
function place(world,x,y){Object.assign(world.player,{x,y,vx:0,vy:0,grounded:true,climbing:false});}
function step(world,input={}){assert(!world.update(DT,input)?.rebuild,'Unexpected retry');}
function advance(world,seconds,input={}){for(let i=0;i<Math.ceil(seconds/DT);i++)step(world,input);}
function until(world,condition,seconds=5,input={}){for(let i=0;i<seconds/DT&&!condition();i++)step(world,input);assert(condition(),'Timed out');}
function walk(world,x){until(world,()=>Math.abs(world.player.x-x)<4,5,{[x>world.player.x?'right':'left']:true});advance(world,.12);}
function prepareDecoy(world,precise=false){
  place(world,260,490);Object.assign(world.crew.find(c=>c.name==='Claude'),{x:400,y:490});
  assert(world.selectTeammate('Claude'));assert(world.selectTarget('patrol-west'));
  world.setPromptMode(precise);return structuredClone(world.commandPreview.geometry);
}
function scan(world,x=50,w=140){world.scanWarning={x,y:95,w,remaining:SCAN_WARNING_SECONDS};}
const checks=[];
function test(name,fn){fn();checks.push(name);console.log('PASS '+name);}

test('default decoy previews a remote destination, physically clears the lane, and permits an unharmed round trip',()=>{
  const {world,core}=fixture(),preview=prepareDecoy(world);
  assert.equal(preview.lures.length,2);assert(preview.lures.every(l=>l.x===520&&l.y===490));
  assert(world.confirmCommand(false));
  assert.deepEqual(world.crew.find(c=>c.name==='Claude').task.geometry.lures,preview.lures);
  until(world,()=>world.guards.every(g=>g.lure));
  walk(world,545);walk(world,260);
  assert.equal(core.view().attempt.health,100,'Crossing distracted guards must not hurt');
  assert.equal(core.view().attempt.alarmIds.length,0,'Distracted guards must not report the crossing');
  assert(world.guards.every(g=>g.x===520&&g.luredUntil>world.time));
  assert.equal(world.receipts[0].affectedCount,2);
  const expires=Math.max(...world.guards.map(g=>g.luredUntil));
  advance(world,expires-world.time+.15);
  assert(world.guards.every(g=>g.x<520&&g.luredUntil<=world.time),'Patrol must resume after the visible window');
});

test('precise decoy affects one guard, cancels its pending detection, and leaves the other patrol active',()=>{
  const {world}=fixture(),preview=prepareDecoy(world,true),chosen=preview.guardIds[0];
  world.warnAlarm(chosen,400,490);assert(world.confirmCommand(true));
  until(world,()=>world.guards.some(g=>g.lure));
  assert.equal(world.guards.filter(g=>g.luredUntil>world.time).length,1);
  assert.equal(world.alarmWarnings.length,0);
  const untouched=world.guards.find(g=>g.id!==chosen),oldX=untouched.x;
  advance(world,.25);assert.equal(untouched.lure,null);assert.notEqual(untouched.x,oldX);
});

test('a guard already at the paper destination completes successfully without requiring fake movement',()=>{
  const {world}=fixture();prepareDecoy(world);
  for(const g of world.guards){g.x=520;g.direction='left';}
  assert(world.confirmCommand(false));
  until(world,()=>!world.crew.find(c=>c.name==='Claude').task,1.2);
  assert.equal(world.receipts.length,1);assert.equal(world.receipts[0].affectedCount,2);
});

test('confirmed lure destinations survive player repositioning and a JSON checkpoint, with six seconds after arrival',()=>{
  const {world,core}=fixture(),preview=prepareDecoy(world);
  assert(world.confirmCommand(false));place(world,900,600);
  const saved=JSON.parse(JSON.stringify(world.exportState()));
  const restored=new GameWorld(core,getMap('resume-storm'),{expanded:true,compilePrompt});
  assert(restored.restoreState(saved).ok);
  until(restored,()=>restored.guards.every(g=>g.lure));
  assert.deepEqual(restored.guards.map(g=>g.lure.x),preview.lures.map(l=>l.x));
  until(restored,()=>restored.guards.every(g=>Math.abs(g.x-g.lure.x)<.01));
  assert(restored.guards.every(g=>g.luredUntil-restored.time>5.2),'Travel must not consume the holding window');
});

test('periodic scan locks its position, gives 1.8 seconds, and can be escaped with ordinary walking',()=>{
  const {world,core}=fixture('paper-window');place(world,120,600);
  core.configureAttempt({alert:70});world.nextScan=0;step(world);
  assert(world.scanWarning);assert(world.scanWarning.remaining>1.7);
  const origin=world.scanWarning.x;advance(world,.5,{left:true});
  assert.equal(world.scanWarning.x,origin,'The warning cannot chase the player');
  assert.equal(world.scanStatus(),'outside');advance(world,1.4);
  assert.equal(world.scanWarning,null);assert.equal(core.view().attempt.health,100);
});

test('an exposed stationary player takes exactly one hit when the countdown expires, not on entry',()=>{
  const {world,core}=fixture('paper-window');place(world,120,600);scan(world);
  assert.equal(world.scanStatus(),'exposed');advance(world,1.5);
  assert.equal(core.view().attempt.health,100);advance(world,.4);
  assert.equal(core.view().attempt.health,80);advance(world,2);
  assert.equal(core.view().attempt.health,80);
});

test('standing under a fixed platform is safe; standing on the same platform is exposed',()=>{
  const under=fixture('paper-window');place(under.world,240,600);scan(under.world,170);
  assert.equal(under.world.scanStatus(),'covered');advance(under.world,1.9);assert.equal(under.core.view().attempt.health,100);
  const above=fixture('paper-window');place(above.world,240,490);scan(above.world,170);
  assert.equal(above.world.scanStatus(),'exposed');advance(above.world,1.9);assert.equal(above.core.view().attempt.health,80);
});

test('partial cover leaves the exposed body vulnerable, and crossing fully under the roof prevents damage',()=>{
  const edge=fixture('paper-window');place(edge.world,185,600);scan(edge.world,115);
  assert.equal(edge.world.scanStatus(),'exposed','One edge of the body is outside the roof');
  advance(edge.world,1.9);assert.equal(edge.core.view().attempt.health,80);
  const hidden=fixture('paper-window');place(hidden.world,185,600);scan(hidden.world,115);
  advance(hidden.world,.2,{right:true});assert.equal(hidden.world.scanStatus(),'covered');
  advance(hidden.world,1.7);assert.equal(hidden.core.view().attempt.health,100);
});

test('body overlap at the beam edge is a hit, while the adjacent outside position is safe',()=>{
  const edge=fixture('paper-window');place(edge.world,40,600);scan(edge.world);
  assert.equal(edge.world.scanStatus(),'exposed');advance(edge.world,1.9);assert.equal(edge.core.view().attempt.health,80);
  const outside=fixture('paper-window');place(outside.world,35,600);scan(outside.world);
  assert.equal(outside.world.scanStatus(),'outside');advance(outside.world,1.9);assert.equal(outside.core.view().attempt.health,100);
});

test('sensor-triggered scans use the same countdown and safe cover as periodic scans',()=>{
  const {world,core}=fixture('paper-window');place(world,240,600);
  world.warnAlarm('fixture-sensor',240,490);advance(world,1.35);
  assert(world.scanWarning&&world.scanWarning.remaining>1.7);
  assert.equal(world.scanStatus(),'covered');advance(world,1.9);assert.equal(core.view().attempt.health,100);
});

test('scan cover and countdown survive a JSON checkpoint without turning a safe hiding place into a hit',()=>{
  const {world,core}=fixture('paper-window');place(world,240,600);scan(world,170);advance(world,.6);
  const state=JSON.parse(JSON.stringify(world.exportState()));
  const restored=new GameWorld(core,getMap('paper-window'),{expanded:true,compilePrompt});
  assert(restored.restoreState(state).ok);assert.equal(restored.scanWarning.remaining,world.scanWarning.remaining);
  assert.deepEqual(restored.scanGeometry(),world.scanGeometry());assert.equal(restored.scanStatus(),'covered');
  advance(restored,1.3);assert.equal(core.view().attempt.health,100);
});

console.log(`Stealth readability: ${checks.length} movement, damage and checkpoint checks passed.`);
