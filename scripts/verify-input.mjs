import assert from 'node:assert/strict';
import { GameInput } from '../src/game/input.mjs';
class Surface{
  listeners=new Map();
  addEventListener(name,fn){this.listeners.set(name,[...(this.listeners.get(name)||[]),fn]);}
  fire(name,event={}){for(const fn of this.listeners.get(name)||[])fn({preventDefault(){},...event});}
}
const win=new Surface(),doc=new Surface(),orientation=new Surface(),actions=[],captured=[];
win.matchMedia=()=>orientation;doc.querySelectorAll=()=>[];
globalThis.window=win;globalThis.document=doc;
let screen='none';
const input=new GameInput({getScreen:()=>screen,onAction:(action,payload)=>{actions.push(action);captured.push({action,payload});}});
const control=name=>({dataset:{control:name},classList:{add(){},remove(){}},setPointerCapture(){}});
const target=name=>({closest:selector=>selector==='[data-control]'?control(name):null});
doc.fire('pointerdown',{pointerId:11,target:target('right')});
doc.fire('pointerdown',{pointerId:22,target:target('jump')});
assert(input.sample().right&&input.sample().jump&&input.sample().jumpPressed);
input.consume();assert(!input.sample().jumpPressed&&input.sample().jump);
doc.fire('pointerup',{pointerId:11});assert(!input.sample().right&&input.sample().jump);
doc.fire('pointercancel',{pointerId:22});assert(!input.sample().jump);
doc.fire('pointerdown',{pointerId:33,target:target('dash')});
win.fire('blur');assert(!input.sample().dash);assert(actions.includes('lost-focus'));
win.fire('keydown',{code:'KeyD',target:{closest:()=>null}});assert(input.sample().right);
orientation.fire('change',{matches:true});assert(!input.sample().right);
let prevented=false;
win.fire('keydown',{code:'Space',target:{closest:selector=>selector==='button'?{}:null},preventDefault(){prevented=true;}});
assert(!prevented&&!input.sample().jump,'Menu Space keeps its native button action');
win.fire('keydown',{code:'KeyD',ctrlKey:true,target:{closest:()=>null}});assert(!input.sample().right);
console.log('PASS simultaneous touch holds, independent release/cancel, blur/rotation clearing and native menu/browser shortcuts.');

// Repeated keydown must create a single action edge. A separate touch on the
// same movement must survive keyboard release, then release independently.
win.fire('keydown',{code:'Space',target:{closest:()=>null}});
assert(input.sample().jumpPressed);input.consume();
for(let i=0;i<100;i++)win.fire('keydown',{code:'Space',repeat:true,target:{closest:()=>null}});
assert(input.sample().jump&&!input.sample().jumpPressed);
win.fire('keyup',{code:'Space'});assert(!input.sample().jump);
win.fire('keydown',{code:'KeyD',target:{closest:()=>null}});
doc.fire('pointerdown',{pointerId:40,target:target('right')});
doc.fire('pointerdown',{pointerId:41,target:target('right')});
win.fire('keyup',{code:'KeyD'});assert(input.sample().right);
doc.fire('pointerup',{pointerId:40});assert(input.sample().right);
doc.fire('lostpointercapture',{pointerId:41});assert(!input.sample().right);
console.log('PASS held keys have single action edges and mixed keyboard/multiple-touch releases remain independent.');

input.configure({interactionMode:'toggle',bindings:{left:'KeyQ'}});
assert.equal(input.actionFor('KeyQ'),'left');
for(const [code,action] of [['Space','jump'],['ShiftLeft','dash'],['KeyE','interact'],['ArrowRight','right']])assert.equal(input.actionFor(code),action,'partial remaps preserve other controls');
win.fire('keydown',{code:'KeyE',target:{closest:()=>null}});assert(input.sample().interact);
for(let i=0;i<100;i++)win.fire('keydown',{code:'KeyE',repeat:true,target:{closest:()=>null}});
assert(input.sample().interact,'held toggle does not repeatedly reverse');
win.fire('keyup',{code:'KeyE'});assert(input.sample().interact);
input.releaseInteraction();assert(!input.sample().interact,'boarding completion can require a fresh gesture');
doc.fire('pointerdown',{pointerId:43,target:target('interact')});doc.fire('pointerup',{pointerId:43});assert(input.sample().interact);
doc.fire('pointerdown',{pointerId:44,target:target('interact')});assert(!input.sample().interact);
input.configure({});assert(!input.sample().interact&&!input.sample().jump&&!input.sample().right);
console.log('PASS partial remapping, toggle auto-repeat, touch toggling and explicit fresh-interaction release.');

for(const selector of ['input','select','textarea','[contenteditable="true"]']){
  const count=actions.length;let prevented=false;
  win.fire('keydown',{code:'KeyE',target:{closest:query=>query.includes(selector)?{}:null},preventDefault(){prevented=true;}});
  assert(!input.sample().interact&&!prevented);assert.equal(actions.length,count);
}
input.listenForBinding('jump');
win.fire('keydown',{code:'Escape',target:{closest:()=>null}});
assert.deepEqual(captured.at(-1),{action:'binding-captured',payload:{action:'jump',code:'Escape',cancelled:true}});
input.listenForBinding('dash');
win.fire('keydown',{code:'KeyK',target:{closest:()=>null}});
assert.deepEqual(captured.at(-1),{action:'binding-captured',payload:{action:'dash',code:'KeyK',cancelled:false}});
assert(!input.sample().dash&&!input.sample().jump);
console.log('PASS editable fields keep native keys; remap capture/cancel never leaks into gameplay.');

for(const nextScreen of ['story','briefing']){
  screen=nextScreen;const count=actions.length;
  win.fire('keydown',{code:'Space',target:{closest:()=>null}});
  assert.equal(actions.at(-1),nextScreen==='story'?'story-next':'briefing-start');
  win.fire('keydown',{code:'Space',repeat:true,target:{closest:()=>null}});
  assert.equal(actions.length,count+1);assert(!input.sample().jump);
}
screen='none';
for(let i=0;i<1000;i++){
  win.fire('keydown',{code:'KeyD',target:{closest:()=>null}});
  doc.fire('pointerdown',{pointerId:i+100,target:target('jump')});
  if(i%3===0)win.fire('pagehide');else if(i%3===1){doc.hidden=true;doc.fire('visibilitychange');doc.hidden=false;}else win.fire('blur');
  assert(!input.sample().right&&!input.sample().jump&&!input.sample().jumpPressed&&!input.sample().interact,'interruptions clear every held action and edge');
  doc.fire('pointerup',{pointerId:i+100});win.fire('keyup',{code:'KeyD'});
}
console.log('PASS story/briefing shortcuts and 1,000 focus/page-hide/visibility interruption cycles.');

// Overlay, story, pause and command transitions call clear(). They must NOT
// drop physically held keys: a key that is already down never fires another
// keydown, so clearing the held set froze the character once the overlay
// closed until the player released and pressed it again (frontend full
// playthrough regression, 2026-10-25). Genuine focus loss — the interruption
// cycle block above — still has to drop everything.
win.fire('keydown',{code:'KeyD',target:{closest:()=>null}});
input.consume();
input.clear();
assert(input.sample().right,'overlay clear() keeps physically held keys');
win.fire('keyup',{code:'KeyD'});
assert(!input.sample().right,'keyup after an overlay still ends the hold');
console.log('PASS overlay clear() preserves held keys; only real focus loss resets them.');
