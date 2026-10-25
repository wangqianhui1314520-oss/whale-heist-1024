import { RULES } from '../core/chapters.mjs';
import { getChapterRooms, getRoom } from './rooms.mjs';
import { applyContract } from './contracts.mjs';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const copy=v=>JSON.parse(JSON.stringify(v));
const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
const bodyRect=p=>({x:p.x-p.w/2,y:p.y-p.h,w:p.w,h:p.h});
const actionTokenCost=plan=>plan.budgetSource==='analysis'||plan.precise?RULES.aiTokenPreciseCost:RULES.aiTokenDefaultCost;
const DESCRIPTIONS={
  Grok:['沿平台持续冲锋，撞开沿途障碍后停下。','只破指定障碍，在目标后停下。'],
  Claude:['纸页吸引附近同层最多三名守卫，可能改变另一条路线。','只引开同层距离目标最近的一名守卫。'],
  GLM:['站定扫描大范围陷阱；波纹碰到警戒器会报警。','只扫描目标方向的窄范围，减少惊动警戒器。'],
};

/** Platforms connected by visible ladders form the crew's navigation graph. */
export function routeFor(platforms,ladders,actor,target){
  const nearest=p=>platforms.reduce((best,s)=>{
    const cost=Math.abs(s.y-p.y)+Math.max(s.x-p.x,0,p.x-s.x-s.w)*4;
    return !best||cost<best.cost?{s,cost}:best;
  },null)?.s;
  const from=nearest(actor),to=nearest(target);
  if(!from||!to)return null;
  const queue=[from.id],seen=new Set(queue),prev=new Map();
  while(queue.length){
    const id=queue.shift();if(id===to.id)break;
    const a=platforms.find(p=>p.id===id);
    for(const b of platforms){
      if(seen.has(b.id))continue;
      let link=null;
      if(Math.abs(a.y-b.y)<5&&a.x<=b.x+b.w+8&&b.x<=a.x+a.w+8){
        link={x:clamp((Math.max(a.x,b.x)+Math.min(a.x+a.w,b.x+b.w))/2,20,1260),walk:true};
      }else{
        link=ladders.find(l=>l.x>=a.x-12&&l.x<=a.x+a.w+12&&l.x>=b.x-12&&l.x<=b.x+b.w+12
          &&Math.min(a.y,b.y)>=l.y-15&&Math.max(a.y,b.y)<=l.y+l.h+15);
      }
      if(link){seen.add(b.id);prev.set(b.id,{id,link});queue.push(b.id);}
    }
  }
  if(!seen.has(to.id))return null;
  const edges=[];let id=to.id;
  while(id!==from.id){const step=prev.get(id);edges.unshift({from:platforms.find(p=>p.id===step.id),to:platforms.find(p=>p.id===id),link:step.link});id=step.id;}
  const points=[];
  for(const edge of edges){points.push({x:edge.link.x,y:edge.from.y});points.push({x:edge.link.x,y:edge.to.y,climb:!edge.link.walk});}
  points.push({x:clamp(target.x,to.x+14,to.x+to.w-14),y:to.y});
  return points;
}

export class GameWorld{
  constructor(core,map,{onEvent=()=>{},expanded=false,compilePrompt=null,contract=null,trainingCredits={}}={}){
    this.expanded=expanded;this.compilePrompt=compilePrompt;this.contract=contract;
    this.trainingCredits={Claude:Math.max(0,Math.min(1,Number.isInteger(trainingCredits.Claude)?trainingCredits.Claude:0))};
    this.rooms=expanded?getChapterRooms(core.view().chapter.id).map(room=>contract?applyContract(room,contract):room):[];
    this.currentRoom=expanded?this.rooms[0]:null;
    if(this.currentRoom)map=this.currentRoom;
    if(!map.analysisStation)map={...map,analysisStation:{x:330,y:600}};
    this.core=core;this.map=map;this.onEvent=onEvent;
    this.time=0;this.eventSequence=0;this.attemptId=core.view().attempt.attemptId;
    this.platforms=copy(map.platforms);this.barriers=copy(map.barriers).map(b=>({...b,broken:false}));
    this.gates=copy(map.gates).map(g=>({...g,open:false}));this.plates=copy(map.plates).map(p=>({...p,pressed:false}));
    this.items=copy(map.items).map(i=>({...i,collected:false}));this.supplies=copy(map.supplies).map(s=>({...s,collected:false}));
    this.nodes=this.items.filter(i=>core.view().chapter.number<=3&&!i.optional&&i.kind==='data')
      .map(i=>({id:'node-'+i.id,itemId:i.id,x:i.x,y:i.y,hp:2,lastAttack:null,flashUntil:0}));
    this.guards=copy(map.guards).map(g=>({...g,homeX:g.x,direction:g.direction===-1?'left':'right',luredUntil:0,lure:null}));
    this.traps=copy(map.traps).map(t=>({...t,revealedUntil:0}));this.alarms=copy(map.alarms);
    this.player={...map.spawn,w:28,h:48,vx:0,vy:0,direction:'right',pose:'idle',grounded:true,
      coyote:.1,jumpBuffer:0,dashCooldown:0,dashTime:0,hurtUntil:0,climbing:false};
    this.crew=core.view().chapter.teammates.map((name,i)=>({name,x:map.spawn.x+45+i*50,y:map.spawn.y,
      direction:'right',pose:'idle',status:'following',route:[],task:null,repathAt:0}));
    this.effects=[];this.selected=null;this.commandPreview=null;this.slowRemaining=8;this.slowSession=0;
    this.nearby=null;this.interaction=null;this.mustReleaseInteract=false;this.message='';
    this.rendezvousRequested=false;this.scanWarning=null;this.nextScan=10;this.lastBagToast=-10;
    // Short, readable telegraphs for damage sources. Alarm warnings are
    // investigator/sensor warnings; guardWarnings are the final hit window.
    this.alarmWarnings=[];this.guardWarnings=[];this.evacuationSafeUntil=0;
    this.tutorialIndex=0;this.visited=new Set();this.lastClimb=0;
    this.roomStates={};this.receipts=[];this.records=[];this.eventFlags=new Set();this.seed=1024;
    this.promptConfig={precise:false,constraintId:null,condition:null,promptText:'',sequence:[]};this.relayQueue=[];
    if(expanded){this.installObjectTargets();this.core.registerWorldTargets?.(this.rooms.flatMap(room=>room.targets));this.core.registerWorldTargets?.(this.map.targets);this.runRoomEvents('room-enter');}
  }
  emit(type,payload={}){this.onEvent(type,payload);}
  event(type,payload={}){
    const before=this.core.view(),result=this.core.worldEvent(this.attemptId,{type,...payload});
    if(this.expanded&&result.ok){
      if(['delivery','alarm','broadcast','rendezvous','remote-prepare','evacuation-confirm'].includes(type))this.addRecord(type,{...payload,outcome:type==='broadcast'?(payload.on?'公开广播开启':'公开广播关闭'):type==='remote-prepare'?'远端资料装载完成':'已生效',broadcastOn:before.attempt.broadcastOn});
      if(this.core.view().chapter?.number===5 && ['rendezvous','remote-prepare','evacuation-confirm'].includes(type)) {
        const after=this.core.view().attempt;
        this.emit('evacuation-status',{stage:after.evacuationStage,assist:after.evacuationAssist,
          remainingMs:after.evacuationRemainingMs,notice:after.evacuationNotice});
      }
      if(type==='pickup'){
        this.runRoomEvents('item-picked',payload.itemId);
        const clueId=this.evidenceClueForItem(payload.itemId);
        if(clueId){
          const evidence=this.core.collectVulnerabilityEvidence(clueId,{source:'鲸港演算舱 · 现场拾取',eventId:payload.itemId});
          if(evidence.ok)this.addRecord('evidence-collected',{clueId,outcome:`已收集虚构证据：${evidence.clue.label}`,public:false});
        }
      }
      if(type==='evacuation-confirm'){
        this.eventFlags.add('side-routes-sealed');
        // Give the player a readable departure window after the beacon is
        // armed. It is deliberately short and only applies to chapter 5.
        if(before.chapter?.number===5){
          this.evacuationSafeUntil=this.time+5;
          this.emit('evacuation-safe-window',{duration:5});
          this.toast('撤离窗口已打开：5 秒内不会受到守卫伤害。');
        }
      }
    }
    if(type==='emergency-ai-token'&&result.ok){
      const receipt={id:this.unique('emergency-token'),type,roomId:this.currentRoom?.id,
        elapsedMs:this.core.view().attempt.elapsedMs,amount:result.amount,
        outcome:'演算舱应急补给：AI Token +1',public:false,broadcastOn:false};
      this.receipts.push(receipt);this.addRecord(type,receipt);this.emit('resource-receipt',copy(receipt));
    }
    return result;
  }
  evidenceClueForItem(itemId){
    const chapter=this.core.view().chapter?.id;
    const maps={
      'paper-window':['c1-window-replay','c1-sealed-note','c1-safe-route'],
      'resume-storm':['c2-resume-copy','c2-guard-route','c2-duplicate-flag'],
      'review-quietly':['c3-scan-shadow','c3-alarm-cycle','c3-confirmed-gap'],
      'public-report':['c4-broadcast-ledger','c4-draft-screen','c4-disclosure-gap'],
      'close-hatch':['c5-chain-index','c5-crew-signoff','c5-return-check'],
    }[chapter]||[];
    const index=Number(String(itemId||'').match(/(\d+)$/)?.[1]||0);
    return maps[index-1]||null;
  }
  analysisCollect(clueId){return this.core.collectVulnerabilityEvidence(clueId,{source:'鲸港演算舱'});}
  analysisAnalyze(clueId,mode='summarize'){return this.core.analyzeVulnerability(clueId,mode);}
  analysisRepair(repairId){return this.core.selectVulnerabilityRepair(repairId);}
  unique(prefix){return `${prefix}-${++this.eventSequence}`;}
  cue(group,x,y,direction='right'){this.effects.push({group,x,y,started:this.time,direction});}
  strikeNodes(fromX,toX,y,attackId,power=1,allowedIds=null){
    for(const node of this.nodes){
      if(allowedIds&&!allowedIds.includes(node.id))continue;
      if(node.hp<=0||node.lastAttack===attackId||Math.abs(node.y-y)>48
        ||node.x<Math.min(fromX,toX)-30||node.x>Math.max(fromX,toX)+30)continue;
      node.lastAttack=attackId;node.hp=Math.max(0,node.hp-power);node.flashUntil=this.time+.14;
      if(this.expanded)this.emit(node.hp?'node-hit':'node-open',{nodeId:node.id,hp:node.hp,attackId,actor:power===1?'DeepSeek':'Grok'});
      this.emit('sound',{name:'impact'});
      if(node.hp===0){this.cue('axe-impact',node.x,node.y-25);this.toast('节点已打开，靠近拾取数据。');}
      else this.toast('节点出现裂纹，再冲刺撞击一次。');
    }
  }
  toast(text){this.message=text;this.messageUntil=this.time+4;this.emit('toast',{text});}
  snapshot(){return {message:this.message,nearby:this.nearby,selected:this.selected,commandPreview:this.commandPreview,
    slowRemaining:this.slowRemaining,guardWarnings:copy(this.guardWarnings),alarmWarnings:copy(this.alarmWarnings),
    evacuationSafeUntil:this.evacuationSafeUntil,player:{dashCooldown:this.player.dashCooldown,x:this.player.x,y:this.player.y},
    room:this.currentRoom?{id:this.currentRoom.id,name:this.currentRoom.name,index:this.currentRoom.index,total:this.currentRoom.total,
      optional:this.currentRoom.optional,exits:copy(this.currentRoom.exits)}:null,
    receipts:copy(this.receipts),records:copy(this.records),eventFlags:[...this.eventFlags]};}
  solidBodies(){return [...this.barriers.filter(b=>!b.broken),...this.gates.filter(g=>!g.open),{id:'mfa-door-fixed',x:1220,y:475,w:60,h:125}];}
  nearestSurface(point){return this.platforms.reduce((a,b)=>!a||Math.abs(b.y-point.y)+Math.max(b.x-point.x,0,point.x-b.x-b.w)*4<Math.abs(a.y-point.y)+Math.max(a.x-point.x,0,point.x-a.x-a.w)*4?b:a,null);}

  addRecord(type,data={}){
    const view=this.core.view();const record={id:this.unique('record'),type,roomId:this.currentRoom?.id,
      elapsedMs:view.attempt.elapsedMs,time:this.time,public:Boolean(data.broadcastOn??view.attempt.broadcastOn),broadcastOn:Boolean(data.broadcastOn??view.attempt.broadcastOn),...data};
    this.records.push(record);this.emit('record',copy(record));return record;
  }
  captureRoom(){
    if(!this.currentRoom)return;
    this.roomStates[this.currentRoom.id]=copy(Object.fromEntries(['platforms','barriers','gates','plates','items','supplies','nodes','guards','traps','alarms','alarmWarnings','guardWarnings','scanWarning'].map(key=>[key,this[key]])));
  }
  loadRoom(room){
    this.currentRoom=room;this.map=room;
    const saved=this.roomStates[room.id];
    if(saved){
      for(const key of ['platforms','barriers','gates','plates','items','supplies','nodes','guards','traps','alarms','alarmWarnings','guardWarnings','scanWarning']){
        if(saved[key]!==undefined)this[key]=copy(saved[key]);
        else if(key==='alarmWarnings'||key==='guardWarnings')this[key]=[];
      }
      this.installObjectTargets();return;
    }
    this.platforms=copy(room.platforms);this.barriers=copy(room.barriers).map(b=>({...b,broken:false}));
    this.gates=copy(room.gates).map(g=>({...g,open:false}));this.plates=copy(room.plates).map(p=>({...p,pressed:false}));
    this.items=copy(room.items).map(item=>({...item,collected:false}));this.supplies=copy(room.supplies).map(s=>({...s,collected:false}));
    this.nodes=this.items.filter(i=>this.core.view().chapter.number<=3&&!i.optional&&i.kind==='data').map(i=>({id:'node-'+i.id,itemId:i.id,x:i.x,y:i.y,hp:2,lastAttack:null,flashUntil:0}));
    this.guards=copy(room.guards).map(g=>({...g,homeX:g.x,direction:g.direction===-1?'left':'right',state:'patrol',suspicion:0,luredUntil:0,lure:null}));
    this.traps=copy(room.traps).map(t=>({...t,revealedUntil:0}));this.alarms=copy(room.alarms);
    this.alarmWarnings=[];this.guardWarnings=[];this.scanWarning=null;
    this.installObjectTargets();
  }
  installObjectTargets(){
    if(!this.expanded)return;
    const extra=this.nodes.map((node,index)=>({id:node.id,teammate:'Grok',x:node.x,y:node.y,itemId:node.itemId,
      label:'资料节点 '+(node.itemId.match(/\d+$/)?.[0]||index+1),type:'data-node',aliases:['节点'+(node.itemId.match(/\d+$/)?.[0]||index+1)],effect:'break-obstacle',collaboration:false}));
    this.map={...this.currentRoom,targets:[...this.currentRoom.targets,...extra]};
    this.core.registerWorldTargets?.(this.map.targets);
  }
  transitionRoom(exitOrId){
    if(!this.expanded)return false;
    const exit=typeof exitOrId==='string'?this.currentRoom.exits.find(e=>e.id===exitOrId||e.to===exitOrId):exitOrId;
    if(!exit||!this.currentRoom.exits.some(e=>e.id===exit.id&&e.to===exit.to))return false;
    const room=this.rooms.find(room=>room.id===exit.to);if(!room||room.chapterId!==this.core.view().chapter.id)return false;
    if(room.optional&&this.core.view().attempt.evacuationStarted){this.toast('撤离已经开始，支线路口已封存。');return false;}
    if(this.crew.some(a=>a.task&&a.task.stage!=='waiting')){this.toast('队友正在执行，请等回执完成后一起换房。');return false;}
    for(const actor of this.crew)if(actor.task){this.core.cancelCommand(actor.name);actor.task=null;actor.route=[];actor.status='following';}
    const from=this.currentRoom.id;this.captureRoom();this.cancelPreview();this.relayQueue=[];this.loadRoom(room);
    Object.assign(this.player,exit.arrival,{vx:0,vy:0,dashTime:0,climbing:false,grounded:true,pose:'idle'});
    this.crew.forEach((actor,index)=>Object.assign(actor,{x:clamp(this.player.x+(this.player.x<640?45:-45)*(index+1),25,1190),y:this.player.y,route:[],task:null,status:'following',pose:'idle',repathAt:0}));
    this.interaction=null;this.nearby=null;this.effects=[];this.mustReleaseInteract=true;
    this.visited.add(room.id);this.runRoomEvents('room-enter');
    this.toast(room.name+' · 队友已同行');this.emit('room-change',{from,to:room.id,room:this.snapshot().room});return true;
  }
  runRoomEvents(trigger,subject=null){
    if(!this.expanded||!this.currentRoom)return;
    for(const event of this.currentRoom.events||[]){
      if(event.trigger!==trigger||(event.subject&&event.subject!==subject)||this.eventFlags.has(event.id))continue;
      this.eventFlags.add(event.id);
      const shortcutClosed=this.contract?.rules?.shortcutsEnabled===false&&event.action==='open-bridge';
      if(event.action==='open-bridge'&&!shortcutClosed&&event.platform&&!this.platforms.some(p=>p.id===event.platform.id))this.platforms.push({...copy(event.platform),eventBridge:true});
      if(event.action==='latch-gate'){const gate=this.gates.find(g=>g.id===event.gateId);if(gate)gate.open=true;const plate=this.plates.find(p=>p.gateId===event.gateId);if(plate)plate.latched=true;}
      this.addRecord('world-event',{eventId:event.id,outcome:shortcutClosed?'挑战关闭返程桥，静态梯路保留。':event.text,public:false});
      this.cue('scan-grid',event.platform?event.platform.x+event.platform.w/2:this.player.x,event.platform?event.platform.y:this.player.y-35);
      this.toast(shortcutClosed?'挑战契约关闭了返程桥，请使用保留的静态梯路。':event.text);this.emit('world-event',{id:event.id,roomId:this.currentRoom.id,text:event.text,action:event.action,shortcutClosed});
    }
  }
  exportState(){
    this.captureRoom();
    const keys=['time','eventSequence','attemptId','player','crew','effects','selected','commandPreview','slowRemaining','slowSession','mustReleaseInteract','message','messageUntil','rendezvousRequested','scanWarning','alarmWarnings','guardWarnings','evacuationSafeUntil','nextScan','lastBagToast','tutorialIndex','lastClimb','receipts','records','promptConfig','relayQueue','seed','trainingCredits'];
    return copy({version:3,expanded:this.expanded,contract:this.contract,chapterId:this.core.view().chapter.id,roomId:this.currentRoom?.id||null,
      roomStates:this.roomStates,eventFlags:[...this.eventFlags],visited:[...this.visited],...Object.fromEntries(keys.map(key=>[key,this[key]??null])),
      ...(!this.expanded?{legacyRoom:Object.fromEntries(['platforms','barriers','gates','plates','items','supplies','nodes','guards','traps','alarms'].map(key=>[key,this[key]]))}:{})});
  }
  restoreState(state){
    let value,rooms;
    try{
      const serialized=JSON.stringify(state);if(!serialized||serialized.length>750000)return {ok:false,reason:'oversized-world-snapshot'};
      value=JSON.parse(serialized);
      if(!value||value.version!==3||value.chapterId!==this.core.view().chapter.id||value.expanded!==this.expanded)return {ok:false,reason:'invalid-world-snapshot'};
      rooms=this.expanded?getChapterRooms(value.chapterId).map(room=>value.contract?applyContract(room,value.contract):room):[this.map];
      if(value.contract){const canonical=rooms[0]?.contract;if(!canonical||canonical.layoutSeed!==value.contract.layoutSeed)return {ok:false,reason:'invalid-contract'};value.contract=canonical;}
      const error=this.validateState(value,rooms);if(error)return {ok:false,reason:error};
    }catch{return {ok:false,reason:'invalid-world-snapshot'};}
    this.roomStates=value.roomStates;
    if(this.expanded){this.contract=value.contract||null;this.rooms=rooms;this.loadRoom(this.rooms.find(room=>room.id===value.roomId));}else if(value.legacyRoom)Object.assign(this,value.legacyRoom);
    for(const key of ['time','eventSequence','player','crew','effects','selected','commandPreview','slowRemaining','slowSession','mustReleaseInteract','message','messageUntil','rendezvousRequested','scanWarning','alarmWarnings','guardWarnings','evacuationSafeUntil','nextScan','lastBagToast','tutorialIndex','lastClimb','receipts','records','promptConfig','relayQueue','seed','trainingCredits'])if(key in value)this[key]=value[key];
    this.eventFlags=new Set(value.eventFlags||[]);this.visited=new Set(value.visited||[]);this.attemptId=this.core.view().attempt.attemptId;
    this.interaction=null;this.nearby=null;return {ok:true};
  }
  validateState(value,rooms){
    const object=v=>v&&typeof v==='object'&&!Array.isArray(v),finite=(v,min=-1e9,max=1e9)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
    const string=(v,max=240)=>typeof v==='string'&&v.length<=max;
    const point=p=>object(p)&&finite(p.x,0,1280)&&finite(p.y,-100,735);
    const list=(v,max=200)=>Array.isArray(v)&&v.length<=max;
    const unique=v=>new Set(v).size===v.length;
    const names=this.core.view().chapter.teammates,room=this.expanded?rooms.find(r=>r.id===value.roomId):this.map;
    if(!room||!object(value.roomStates)||!list(value.eventFlags,100)||!unique(value.eventFlags)||!list(value.visited,13)||!unique(value.visited))return 'invalid-room';
    const allowedFlags=[...rooms.flatMap(r=>(r.events||[]).map(e=>e.id)),'side-routes-sealed'];
    if(value.eventFlags.some(id=>!allowedFlags.includes(id))||value.visited.some(id=>!rooms.some(r=>r.id===id)))return 'invalid-event-flags';
    const allTargets=base=>[...base.targets,...base.items.filter(i=>this.core.view().chapter.number<=3&&!i.optional&&i.kind==='data').map(i=>({id:'node-'+i.id,teammate:'Grok',x:i.x,y:i.y,itemId:i.id}))];
    const currentTargets=allTargets(room),targetIds=currentTargets.map(t=>t.id),conditionIds=[...room.guards.map(g=>g.id),...room.platforms.filter(p=>p.kind==='lift').map(p=>p.id)];
    const route=points=>list(points,100)&&points.every(p=>point(p)&&(p.climb===undefined||typeof p.climb==='boolean'));
    const constraints=[null,'stop-at-target','single-guard','narrow-scan','wait-guard-turn','wait-lift-ready'];
    const condition=c=>c===null||object(c)&&['guard-turn','lift-ready'].includes(c.type)&&(c.targetId===null||conditionIds.includes(c.targetId));
    const plan=p=>object(p)&&names.includes(p.teammate)&&targetIds.includes(p.targetId)&&typeof p.precise==='boolean'&&Number.isInteger(p.cost??0)&&finite(p.cost??0,0,1)&&constraints.includes(p.constraintId??null)&&condition(p.condition??null)&&string(p.promptText??'',500);
    const geometry=g=>object(g)&&g.ok===true&&route(g.route)&&point(g.goal)&&point(g.origin)&&[1,-1].includes(g.direction)&&finite(g.end,0,1280)
      &&['barrierIds','nodeIds','guardIds','trapIds','alarmIds'].every((key,index)=>list(g[key],100)&&unique(g[key])&&g[key].every(id=>
        (index===1?room.items.map(i=>'node-'+i.id):room[['barriers','nodes','guards','traps','alarms'][index]]||[]).some(entry=>(typeof entry==='string'?entry:entry.id)===id)))
      &&(g.bounds===null||object(g.bounds)&&finite(g.bounds.x,-1280,2560)&&finite(g.bounds.y,-720,1440)&&finite(g.bounds.w,0,2560)&&finite(g.bounds.h,0,1440));
    if(!finite(value.time,0,1e7)||!Number.isInteger(value.eventSequence)||value.eventSequence<0||value.eventSequence>1e8
      ||!point(value.player)||value.player.w!==28||value.player.h!==48||!finite(value.player.vx,-1500,1500)||!finite(value.player.vy,-1500,1500)
      ||!['left','right'].includes(value.player.direction)||!['idle','walk','jump','fall','skill'].includes(value.player.pose)
      ||!['grounded','climbing'].every(key=>typeof value.player[key]==='boolean')
      ||!finite(value.player.coyote,0,.2)||!finite(value.player.jumpBuffer,0,.2)||!finite(value.player.dashCooldown,0,3)||!finite(value.player.dashTime,-.1,.3)
      ||!finite(value.player.hurtUntil,0,value.time+1)||value.player.attackId!==undefined&&!string(value.player.attackId,120))return 'invalid-player-state';
    if(!list(value.crew,3)||value.crew.length!==names.length||!unique(value.crew.map(a=>a.name)))return 'invalid-crew-state';
    for(const actor of value.crew){
      if(!names.includes(actor.name)||!point(actor)||!['left','right'].includes(actor.direction)||!route(actor.route)||!finite(actor.repathAt,0,1e9)
        ||!['idle','walk','jump','skill'].includes(actor.pose)||!['following','travelling','executing','waiting'].includes(actor.status))return 'invalid-crew-state';
      if(actor.task){const t=actor.task,target=currentTargets.find(entry=>entry.id===t.target?.id&&entry.teammate===actor.name);
        if(!object(t)||!target||t.target.x!==target.x||t.target.y!==target.y||!string(t.commandId,120)||!['waiting','travel','execute'].includes(t.stage)
          ||!finite(t.started,0,value.time)||!finite(t.stageTime,0,60)||typeof t.precise!=='boolean')return 'invalid-task-state';
        if(this.expanded&&(t.roomId!==room.id||!plan(t.plan)||!geometry(t.geometry)||t.plan.teammate!==actor.name||t.plan.targetId!==t.target.id||t.plan.precise!==t.precise))return 'invalid-task-state';
        if(t.lured&&(!list(t.lured,3)||t.lured.some(id=>!room.guards.some(g=>g.id===id))))return 'invalid-task-state';
      }
    }
    if(value.selected!==null&&!names.includes(value.selected))return 'invalid-prompt-state';
    if(!object(value.promptConfig)||typeof value.promptConfig.precise!=='boolean'||!constraints.includes(value.promptConfig.constraintId)||!condition(value.promptConfig.condition)
      ||!string(value.promptConfig.promptText,500)||!list(value.promptConfig.sequence,2)||!value.promptConfig.sequence.every(plan))return 'invalid-prompt-state';
    if(!list(value.relayQueue,2)||!value.relayQueue.every(plan))return 'invalid-relay-state';
    if(value.commandPreview&&(!object(value.commandPreview)||!targetIds.includes(value.commandPreview.targetId)||!names.includes(value.commandPreview.teammate)
      ||typeof value.commandPreview.available!=='boolean'||!finite(value.commandPreview.cost,0,2)||value.commandPreview.geometry?.ok&&!geometry(value.commandPreview.geometry)))return 'invalid-preview-state';
    if(!finite(value.slowRemaining,0,8)||!finite(value.slowSession,0,3)||!finite(value.nextScan,0,1e9)||!finite(value.lastClimb,-100,1e9)||!finite(value.lastBagToast,-100,1e9)
      ||!Number.isInteger(value.tutorialIndex)||value.tutorialIndex<0||value.tutorialIndex>100||!string(value.message,500)||value.messageUntil!==null&&!finite(value.messageUntil,0,1e9)
      ||typeof value.mustReleaseInteract!=='boolean'||typeof value.rendezvousRequested!=='boolean'||!Number.isInteger(value.seed)||!object(value.trainingCredits)
      ||value.evacuationSafeUntil!==undefined&&!finite(value.evacuationSafeUntil,0,1e7)
      ||!Number.isInteger(value.trainingCredits.Claude)||value.trainingCredits.Claude<0||value.trainingCredits.Claude>1)return 'invalid-clock-state';
    const warning=w=>object(w)&&finite(w.x,0,1280)&&finite(w.y,0,720)&&finite(w.remaining,0,5);
    if(value.scanWarning&&(!warning(value.scanWarning)||!finite(value.scanWarning.w,1,1280)))return 'invalid-warning-state';
    if(!list(value.alarmWarnings,30)||value.alarmWarnings.some(w=>!warning(w)||w.roomId!==room.id||!string(w.sourceId,120)))return 'invalid-warning-state';
    if(!list(value.guardWarnings,30)||value.guardWarnings.some(w=>!warning(w)||w.roomId!==room.id||!string(w.sourceId,120)))return 'invalid-warning-state';
    if(!list(value.effects,200)||value.effects.some(e=>!point(e)||!string(e.group,80)||!finite(e.started,0,value.time)))return 'invalid-effects-state';
    for(const key of ['records','receipts'])if(!list(value[key],3000)||value[key].some(entry=>!object(entry)||!string(entry.id,120)||!string(entry.outcome??'',500)
      ||!string(entry.promptText??'',500)||entry.elapsedMs!==undefined&&!finite(entry.elapsedMs,0,1e12)||entry.roomId&&!rooms.some(r=>r.id===entry.roomId)))return 'invalid-records';
    if(this.expanded&&(Object.keys(value.roomStates).some(id=>!rooms.some(r=>r.id===id))||!value.roomStates[value.roomId]))return 'invalid-room-state';
    const states=this.expanded?Object.entries(value.roomStates).map(([id,state])=>[rooms.find(r=>r.id===id),state]):[[this.map,value.legacyRoom]];
    for(const [base,saved] of states){
      if(!object(saved))return 'invalid-room-state';
      if(this.expanded&&(!list(saved.alarmWarnings||[],30)||saved.alarmWarnings?.some(w=>!warning(w)||w.roomId!==base.id||!string(w.sourceId,120))
        ||!list(saved.guardWarnings||[],30)||(saved.guardWarnings||[]).some(w=>!warning(w)||w.roomId!==base.id||!string(w.sourceId,120))
        ||saved.scanWarning&&(!warning(saved.scanWarning)||!finite(saved.scanWarning.w,1,1280))))return 'invalid-room-warning';
      const expected={...base,nodes:base.items.filter(i=>this.core.view().chapter.number<=3&&!i.optional&&i.kind==='data').map(i=>({id:'node-'+i.id,itemId:i.id,x:i.x,y:i.y}))};
      const bridgeDefs=(base.events||[]).filter(e=>e.action==='open-bridge'&&e.platform&&value.eventFlags.includes(e.id)&&value.contract?.rules?.shortcutsEnabled!==false).map(e=>e.platform);
      expected.platforms=[...base.platforms,...bridgeDefs];
      for(const key of ['platforms','barriers','gates','plates','items','supplies','nodes','guards','traps','alarms']){
        if(!list(saved[key],100)||saved[key].length!==expected[key].length||!unique(saved[key].map(e=>e.id)))return 'invalid-'+key;
        for(const entry of saved[key]){
          if(!object(entry))return 'invalid-'+key;
          const original=expected[key].find(e=>e.id===entry.id);if(!original)return 'invalid-'+key;
          for(const property of ['x','y','w','h','kind','optional','targetId','breakable','plateId','gateId','minX','maxX','speed','minY','maxY','period','itemId']){
            if(key==='guards'&&property==='x'||key==='platforms'&&original.kind==='lift'&&property==='y')continue;
            if(original[property]!==undefined&&entry[property]!==original[property])return 'invalid-'+key;
          }
          if(key==='platforms'&&original.kind==='lift'&&!finite(entry.y,original.minY,original.maxY))return 'invalid-lift';
          if(['items','supplies'].includes(key)&&typeof entry.collected!=='boolean'||key==='barriers'&&typeof entry.broken!=='boolean'
            ||key==='gates'&&(typeof entry.open!=='boolean'||Boolean(entry.disabled)!==Boolean(original.disabled))
            ||key==='plates'&&(typeof entry.pressed!=='boolean'||entry.latched!==undefined&&typeof entry.latched!=='boolean'))return 'invalid-'+key;
          if(key==='nodes'&&(!Number.isInteger(entry.hp)||entry.hp<0||entry.hp>2||!finite(entry.flashUntil,0,1e9)||entry.lastAttack!==null&&!string(entry.lastAttack,120)))return 'invalid-node';
          if(key==='traps'&&!finite(entry.revealedUntil,0,1e9))return 'invalid-trap';
          if(key==='guards'&&(!finite(entry.x,original.minX,original.maxX)||!['left','right'].includes(entry.direction)||!finite(entry.homeX,original.minX,original.maxX)
            ||!finite(entry.luredUntil,0,1e9)||entry.suspicion!==undefined&&!finite(entry.suspicion,0,1.2)
            ||entry.lure!==null&&(!point(entry.lure)||entry.lure.x<original.minX||entry.lure.x>original.maxX||entry.lure.y!==original.y)))return 'invalid-guard';
        }
      }
    }
    return null;
  }
  setPromptCompiler(compiler){this.compilePrompt=compiler;return this;}
  setPromptMode(precise){this.promptConfig.precise=Boolean(precise);this.promptConfig.condition=null;this.promptConfig.constraintId=precise?({Grok:'stop-at-target',Claude:'single-guard',GLM:'narrow-scan'}[this.selected]||null):null;return this.refreshPrompt();}
  selectTarget(id){const target=this.map.targets.find(t=>t.id===id);if(!target)return false;this.selected=target.teammate;return this.previewTarget(target,this.promptConfig.precise);}
  setConstraint(id){this.promptConfig.constraintId=id||null;this.promptConfig.precise=['stop-at-target','single-guard','narrow-scan'].includes(id);this.promptConfig.condition=String(id).startsWith('wait-')?{type:id.slice(5),targetId:null}:null;return this.refreshPrompt();}
  setCondition(condition){this.promptConfig.condition=typeof condition==='string'?{type:condition.replace(/^wait-/,''),targetId:null}:condition?copy(condition):null;if(condition){this.promptConfig.precise=false;this.promptConfig.constraintId='wait-'+this.promptConfig.condition.type;}return this.refreshPrompt();}
  setPromptText(text){this.promptConfig.promptText=String(text||'').slice(0,180);return this.refreshPrompt();}
  setSequence(sequence){this.promptConfig.sequence=copy(sequence||[]);return this.refreshPrompt();}
  setPromptPlan(plan){
    if(!plan||!this.map.targets.some(target=>target.id===plan.targetId&&target.teammate===plan.teammate))return false;
    this.selected=plan.teammate;this.promptConfig={precise:Boolean(plan.precise),constraintId:plan.constraintId||null,condition:copy(plan.condition||null),promptText:plan.promptText||'',sequence:copy(plan.sequence||[])};
    this.previewTarget(this.map.targets.find(target=>target.id===plan.targetId),plan.precise);return true;
  }
  refreshPrompt(){const target=this.map.targets.find(t=>t.id===this.commandPreview?.targetId);return target?this.previewTarget(target,this.promptConfig.precise):false;}

  selectTeammate(name){
    const view=this.core.view();if(!view.chapter.teammates.includes(name)){this.toast('这位队友将在后续章节加入。');return false;}
    const targets=this.map.targets.filter(t=>t.teammate===name);
    if(!targets.length){this.toast('当前房间没有这位队友可处理的目标。试试其他队友，或查看航图。');return false;}
    this.selected=name;this.slowSession=3;
    if(this.expanded){this.promptConfig={precise:false,constraintId:null,condition:null,promptText:'',sequence:[]};}
    this.previewTarget(targets.sort((a,b)=>distance(a,this.player)-distance(b,this.player))[0]);
    return true;
  }
  previewTarget(target,precise=false){
    if(!target)return false;
    if(this.expanded)return this.previewExpanded(target,precise);
    const view=this.core.view(),remaining=Math.max(0,(view.attempt.readyAtMs[target.teammate]-view.attempt.elapsedMs)/1000);
    const direction=target.x>=this.player.x?1:-1,surface=this.nearestSurface(target);
    const start=target.x-65*direction,end=precise?target.x+direction*35:clamp(target.x+direction*290,surface.x+20,surface.x+surface.w-20);
    const noEffect=target.teammate==='Grok'&&!this.barriers.some(b=>!b.broken&&((b.id===target.id||b.targetId===target.id)
      ||Math.abs(target.y-(b.y+b.h))<65&&Math.min(start,end)-28<=b.x+b.w&&Math.max(start,end)+28>=b.x))
      &&!this.nodes.some(n=>n.hp>0&&Math.abs(n.y-target.y)<48&&n.x>=Math.min(start,end)-30&&n.x<=Math.max(start,end)+30);
    const tokenCost=actionTokenCost({precise}),insufficientTokens=view.attempt.aiTokens<tokenCost;
    const insufficientQualifiers=precise&&view.attempt.qualifiers<1;
    const available=!noEffect&&!insufficientTokens&&!insufficientQualifiers&&distance(this.player,target)<900&&remaining===0&&!this.crew.find(c=>c.name===target.teammate)?.task;
    this.commandPreview={teammate:target.teammate,targetId:target.id,x:target.x,y:target.y,label:target.label,
      description:DESCRIPTIONS[target.teammate][precise?1:0],defaultDescription:DESCRIPTIONS[target.teammate][0],
      preciseDescription:DESCRIPTIONS[target.teammate][1],precise,cost:precise?1:0,available,
      reason:noEffect?'这个范围内的障碍和节点已经打开，无需再次消耗 AI Token。':remaining>0?`冷却还剩 ${Math.ceil(remaining)} 秒`:insufficientTokens?`AI Token 不足，需要 ${tokenCost} 枚。`:insufficientQualifiers?'限定词不足，可以使用默认指令。':!available?'靠近目标，或等待队友执行完毕':'',tokenCost,aiTokens:view.attempt.aiTokens,aiTokenMax:view.attempt.aiTokenMax};
    return true;
  }
  pointAt(x,y){
    if(!this.selected)return false;
    const targets=this.map.targets.filter(t=>t.teammate===this.selected);
    const target=targets.sort((a,b)=>distance(a,{x,y})-distance(b,{x,y}))[0];
    if(target&&distance(target,{x,y})<150){this.previewTarget(target);return true;}return false;
  }
  cancelPreview(){this.selected=null;this.commandPreview=null;this.slowSession=0;}
  confirmCommand(precise=false){
    if(this.expanded)return this.confirmExpanded(precise);
    const preview=this.commandPreview;if(!preview)return false;
    const target=this.map.targets.find(t=>t.id===preview.targetId);
    this.previewTarget(target,precise);
    if(!this.commandPreview.available){this.toast(this.commandPreview.reason);return false;}
    const actor=this.crew.find(c=>c.name===target.teammate);
    const direction=target.x>=this.player.x?1:-1;
    const goal={x:target.x-(target.teammate==='Grok'?65:30)*direction,y:target.y};
    const route=routeFor(this.platforms,this.map.ladders,actor,goal);
    if(!route){this.toast('当前路线不可达，请换一个目标。');return false;}
    const commandId=this.unique('command');
    const tokenCost=precise?RULES.aiTokenPreciseCost:RULES.aiTokenDefaultCost;
    let result=this.core.prepareCommand({commandId,teammate:actor.name,targetId:target.id,precise,tokenCost});
    if(!result.ok){this.toast(result.reason==='qualifier-unavailable'?'限定词不足，可以使用默认指令。':result.reason==='ai-token-unavailable'?'AI Token 不足，请先收集 Token 或完成分析。':'队友暂时无法执行，请等待冷却。');return false;}
    result=this.core.beginCommand(actor.name);if(!result.ok)return false;
    actor.task={commandId,target,precise,direction,stage:'travel',started:this.time,stageTime:0};
    actor.route=route;actor.status='travelling';
    this.emit('sound',{name:'command-confirm'});this.emit('dialogue',{character:actor.name,text:precise?'收到，我会按限定范围执行。':{Grok:'明白，沿这条路撞过去！',Claude:'简历已经准备好了。',GLM:'开始全面复查。'}[actor.name]});
    this.cancelPreview();return true;
  }
  buildPlan(target,precise=this.promptConfig.precise){
    let plan={teammate:target.teammate,targetId:target.id,precise:Boolean(precise),
      constraintId:this.promptConfig.constraintId,condition:this.promptConfig.condition?copy(this.promptConfig.condition):null,
      promptText:this.promptConfig.promptText||'',sequence:copy(this.promptConfig.sequence||[])};
    if(plan.precise&&!plan.constraintId)plan.constraintId={Grok:'stop-at-target',Claude:'single-guard',GLM:'narrow-scan'}[plan.teammate];
    if(String(plan.constraintId).startsWith('wait-')&&!plan.condition)plan.condition={type:plan.constraintId.slice(5),targetId:null};
    if(plan.condition&&!plan.condition.targetId){
      const entries=plan.condition.type==='guard-turn'?this.guards:this.platforms.filter(p=>p.kind==='lift');
      plan.condition.targetId=[...entries].sort((a,b)=>distance(a,target)-distance(b,target))[0]?.id||null;
    }
    if(this.compilePrompt&&plan.promptText){
      const {sequence,...single}=plan;
      const compiled=this.compilePrompt({...single,...(sequence.length?{sequence}:{}),text:plan.promptText,
        unlockedChapter:this.core.view().chapter.number,targets:this.promptTargets(),qualifiers:this.core.view().attempt.qualifiers+(plan.teammate==='Claude'?this.trainingCredits.Claude:0)});
      if(!compiled?.ok)return {ok:false,error:compiled?.error?.message||compiled?.error||'未识别的指令，请使用已解锁卡片。'};
      plan={...plan,...compiled.plan,cost:compiled.plan.cost??compiled.cost};
    }
    plan.cost=plan.cost??(plan.constraintId||plan.precise||plan.condition?1:0);
    if(plan.teammate==='Claude'&&plan.precise&&this.trainingCredits.Claude>0){plan.cost=0;plan.trainingCost=1;plan.budgetSource='training';}
    return {ok:true,plan};
  }
  promptTargets(){return [...this.map.targets,...this.guards.map((g,i)=>({...g,type:'guard',label:'巡逻守卫 '+(i+1),conditionOnly:true})),...this.platforms.filter(p=>p.kind==='lift').map((p,i)=>({...p,type:'lift',label:'升降台 '+(i+1),conditionOnly:true}))];}
  actionGeometry(plan){
    const target=this.map.targets.find(t=>t.id===plan.targetId&&t.teammate===plan.teammate),actor=this.crew.find(c=>c.name===plan.teammate);
    if(!target||!actor)return {ok:false,reason:'目标不在当前房间，不能在隐藏房间执行。'};
    if(actor.task)return {ok:false,reason:'队友正在执行上一条指令。'};
    const view=this.core.view(),remaining=Math.max(0,((view.attempt.readyAtMs[actor.name]||0)-view.attempt.elapsedMs)/1000);
    if(remaining>0)return {ok:false,reason:`冷却还剩 ${Math.ceil(remaining)} 秒`};
    if(distance(this.player,target)>=900)return {ok:false,reason:'先靠近当前房间的目标。'};
    if(actionTokenCost(plan)>view.attempt.aiTokens)return {ok:false,reason:`AI Token 不足，需要 ${actionTokenCost(plan)} 枚。`};
    if(plan.cost>view.attempt.qualifiers)return {ok:false,reason:'限定词不足，可以使用默认范围。'};
    const allowed={Grok:['stop-at-target'],Claude:['single-guard'],GLM:['narrow-scan']}[actor.name];
    if(plan.constraintId&&!allowed.includes(plan.constraintId)&&!['wait-guard-turn','wait-lift-ready'].includes(plan.constraintId))return {ok:false,reason:'这个约束不适用于当前队友。'};
    if(plan.condition&&view.chapter.number<4)return {ok:false,reason:'等待条件将在第四章解锁。'};
    if(plan.condition&&plan.precise)return {ok:false,reason:'每条指令只能选择一组约束，等待与范围不能叠加。'};
    if(plan.condition?.type==='guard-turn'&&!this.guards.some(g=>g.id===plan.condition.targetId))return {ok:false,reason:'本房间没有指定的巡逻守卫。'};
    if(plan.condition?.type==='lift-ready'&&!this.platforms.some(p=>p.id===plan.condition.targetId&&p.kind==='lift'))return {ok:false,reason:'本房间没有指定的升降台。'};
    if(plan.condition&&!['guard-turn','lift-ready'].includes(plan.condition.type))return {ok:false,reason:'未知的等待条件。'};
    if(plan.sequence?.length>2||plan.sequence?.length&&view.chapter.number<5)return {ok:false,reason:'双人接力在第五章解锁，最多两个不同队友。'};
    if(plan.sequence?.length&&new Set(plan.sequence.map(step=>step.teammate)).size!==plan.sequence.length)return {ok:false,reason:'接力需要不同队友，不能循环。'};
    if(plan.sequence?.length){
      const steps=[plan,...plan.sequence.filter(step=>step.teammate!==plan.teammate||step.targetId!==plan.targetId)];
      const total=steps.reduce((sum,step)=>sum+(step.cost??(step.constraintId||step.precise||step.condition?1:0)),0);
      if(total>view.attempt.qualifiers)return {ok:false,reason:'整组接力的限定词不足，尚未执行或扣费。'};
      const tokenTotal=steps.reduce((sum,step)=>sum+actionTokenCost(step),0);
      if(tokenTotal>view.attempt.aiTokens)return {ok:false,reason:`接力需要 ${tokenTotal} 枚 AI Token，尚未执行或扣费。`};
      for(const step of plan.sequence)if(step.teammate!==plan.teammate||step.targetId!==plan.targetId){
        const checked=this.actionGeometry({...step,cost:step.cost??(step.constraintId||step.precise||step.condition?1:0),sequence:[]});
        if(!checked.ok)return {ok:false,reason:'接力第二步：'+checked.reason};
      }
    }
    const direction=target.x>=actor.x?1:-1,surface=this.nearestSurface(target);
    const goal={x:clamp(target.x-(actor.name==='Grok'?65:30)*direction,surface.x+18,surface.x+surface.w-18),y:target.y};
    const route=this.navigationRoute(actor,goal);
    if(!route)return {ok:false,reason:'静态梯路尚未连通，请换一个落脚点。'};
    // Navigation and its preview reject the same solid crossings. A selected barrier
    // is only exempt during Grok's visible attack, never during travel.
    let previous=actor;
    for(const point of route){
      if(!point.climb&&Math.abs(previous.y-point.y)<6){
        const path={x:Math.min(previous.x,point.x)-13,y:point.y-47,w:Math.abs(previous.x-point.x)+26,h:46};
        if(this.solidBodies().some(s=>overlap(path,s)))return {ok:false,reason:'梯口或沿途仍有实体障碍，先从同侧靠近。'};
      }previous=point;
    }
    let end=plan.precise?target.x+direction*35:clamp(target.x+direction*290,surface.x+20,surface.x+surface.w-20);
    if(actor.name==='Grok')for(const solid of this.solidBodies()){
      const mayBreak=solid.breakable&&(!plan.precise||solid.id===target.id||solid.targetId===target.id);
      if(mayBreak||solid.y>=target.y||solid.y+solid.h<=target.y-48)continue;
      if(direction>0&&solid.x>=goal.x&&solid.x<=end+14)end=Math.min(end,solid.x-16);
      if(direction<0&&solid.x+solid.w<=goal.x&&solid.x+solid.w>=end-14)end=Math.max(end,solid.x+solid.w+16);
    }
    const geometry={ok:true,route:copy(route),direction,goal,end,targetId:target.id,
      origin:{...goal},barrierIds:[],nodeIds:[],guardIds:[],trapIds:[],alarmIds:[],bounds:null};
    if(actor.name==='Grok'){
      geometry.bounds={x:Math.min(goal.x,end)-28,y:target.y-60,w:Math.abs(end-goal.x)+56,h:60};
      geometry.barrierIds=this.barriers.filter(b=>!b.broken&&overlap(geometry.bounds,b)&&(!plan.precise||b.id===target.id||b.targetId===target.id)).map(b=>b.id);
      geometry.nodeIds=this.nodes.filter(n=>n.hp>0&&Math.abs(n.y-target.y)<48&&n.x>=geometry.bounds.x&&n.x<=geometry.bounds.x+geometry.bounds.w&&(!plan.precise||n.id===target.id||n.itemId===target.itemId)).map(n=>n.id);
      if(!geometry.barrierIds.length&&!geometry.nodeIds.length)return {ok:false,reason:'这个范围内的障碍和节点已经打开，无需再次消耗 AI Token。'};
    }else if(actor.name==='Claude'){
      geometry.guardIds=this.guards.filter(g=>Math.abs(g.y-target.y)<48&&distance(g,target)<450).sort((a,b)=>distance(a,target)-distance(b,target)).slice(0,plan.precise?1:3).map(g=>g.id);
      if(!geometry.guardIds.length)return {ok:false,reason:'同层没有可被纸页引开的守卫。'};
      geometry.bounds={x:target.x-450,y:target.y-48,w:900,h:96};
    }else{
      const inside=point=>{const dx=point.x-goal.x,dy=point.y-goal.y;return plan.precise?dx*direction>=-20&&Math.abs(dx)<210&&Math.abs(dy)<70&&!this.alarms.some(a=>distance(a,point)<42):distance(point,goal)<280;};
      geometry.trapIds=this.traps.filter(inside).map(t=>t.id);geometry.alarmIds=plan.precise?[]:this.alarms.filter(inside).map(a=>a.id);
      geometry.exclusions=plan.precise?this.alarms.filter(a=>Math.abs(a.x-goal.x)<250&&Math.abs(a.y-goal.y)<100).map(a=>({x:a.x,y:a.y,r:42})):[];
      geometry.bounds=plan.precise?{x:goal.x+(direction<0?-210:0),y:goal.y-70,w:210,h:140}:{x:goal.x-280,y:goal.y-280,w:560,h:560,circle:true};
    }
    return geometry;
  }
  previewExpanded(target,precise=false){
    const compiled=this.buildPlan(target,precise),plan=compiled.plan||{...this.promptConfig,teammate:target.teammate,targetId:target.id,precise,cost:0};
    const geometry=compiled.ok?this.actionGeometry(plan):{ok:false,reason:compiled.error};
    this.commandPreview={...plan,x:target.x,y:target.y,label:target.label,
      description:plan.condition?`等待${plan.condition.type==='guard-turn'?'守卫转身':'升降台到站'}后执行。`:DESCRIPTIONS[target.teammate][plan.precise?1:0],
      defaultDescription:DESCRIPTIONS[target.teammate][0],preciseDescription:DESCRIPTIONS[target.teammate][1],
      available:geometry.ok,reason:geometry.reason||'',route:geometry.route||[],geometry,plan,
      tokenCost:actionTokenCost(plan),
      aiTokens:this.core.view().attempt.aiTokens,aiTokenMax:this.core.view().attempt.aiTokenMax};return true;
  }
  confirmExpanded(precise=this.promptConfig.precise){
    const target=this.map.targets.find(t=>t.id===this.commandPreview?.targetId);if(!target)return false;
    // Confirming a legacy precise button updates its corresponding constraint card.
    if(Boolean(precise)!==this.promptConfig.precise&&!this.promptConfig.condition)this.setPromptMode(precise);
    this.previewExpanded(target,this.promptConfig.precise);
    const preview=this.commandPreview;if(!preview.available){this.toast(preview.reason);return false;}
    const plan=copy(preview.plan);const started=this.startExpandedPlan(plan,preview.geometry);
    if(started){this.relayQueue=copy((plan.sequence||[]).filter(step=>step.teammate!==plan.teammate||step.targetId!==plan.targetId));this.cancelPreview();}
    return started;
  }
  startExpandedPlan(plan,geometry=null){
    geometry=geometry||this.actionGeometry(plan);if(!geometry.ok){this.toast(geometry.reason);return false;}
    const actor=this.crew.find(c=>c.name===plan.teammate),target=this.map.targets.find(t=>t.id===plan.targetId),commandId=this.unique('command');
    const tokenCost=actionTokenCost(plan);
    let result=this.core.prepareCommand({commandId,teammate:actor.name,targetId:target.id,precise:plan.precise,cost:plan.cost,tokenCost});
    if(!result.ok){this.toast('这条指令暂时无法开始，请检查冷却或限定词。');return false;}
    const waiting=Boolean(plan.condition);
    if(!waiting){result=this.core.beginCommand(actor.name);if(!result.ok){this.core.cancelCommand(actor.name);return false;}if(plan.budgetSource==='training')this.trainingCredits.Claude--;}
    actor.task={commandId,target:copy(target),precise:plan.precise,direction:geometry.direction,stage:waiting?'waiting':'travel',
      started:this.time,stageTime:0,roomId:this.currentRoom.id,plan:copy(plan),geometry:copy(geometry),
      trainingSpent:plan.budgetSource==='training'&&!waiting,
      conditionDirection:plan.condition?.type==='guard-turn'?this.guards.find(g=>g.id===plan.condition.targetId)?.direction:null};
    actor.route=waiting?[]:copy(geometry.route);actor.status=waiting?'waiting':'travelling';
    this.emit('sound',{name:'command-confirm'});this.emit('dialogue',{character:actor.name,text:waiting?'收到，条件成立后我再开始。':plan.precise?'收到，只处理限定范围。':'收到，按预览范围执行。'});return true;
  }
  completeTask(actor){
    const task=actor.task;const result=this.event('command-complete',{teammate:actor.name,commandId:task.commandId});
    if(this.expanded&&result.ok){
      const outcome=actor.name==='Grok'?`打开 ${task.geometry?.barrierIds.filter(id=>this.barriers.find(b=>b.id===id)?.broken).length||0} 处障碍、${task.geometry?.nodeIds.filter(id=>this.nodes.find(n=>n.id===id)?.hp===0).length||0} 个节点`:
        actor.name==='Claude'?`引开 ${task.lured?.length||0} 名守卫`:`发现 ${task.geometry?.trapIds.length||0} 处陷阱，触及 ${task.geometry?.alarmIds.length||0} 个警戒器`;
      const receipt={id:task.commandId,teammate:actor.name,targetId:task.target.id,promptText:task.plan.promptText||task.target.label,
        cost:task.plan.cost,precise:task.precise,constraintId:task.plan.constraintId,roomId:this.currentRoom.id,elapsedMs:this.core.view().attempt.elapsedMs,outcome,
        budgetSource:task.plan.budgetSource||'regular',training:task.plan.budgetSource==='training',trainingCost:task.plan.trainingCost||0,chargedCost:task.plan.cost,
        affectedCount:actor.name==='Claude'?task.lured?.length||0:actor.name==='GLM'?task.geometry.trapIds.length:task.geometry.barrierIds.length+task.geometry.nodeIds.length,
        revealedCount:task.geometry.trapIds.length,
        affected:{barriers:task.geometry.barrierIds,nodes:task.geometry.nodeIds,guards:task.lured||[],traps:task.geometry.trapIds,alarms:task.geometry.alarmIds}};
      this.receipts.push(receipt);this.addRecord('command',receipt);this.emit('command-receipt',copy(receipt));this.runRoomEvents('target-completed',task.target.id);
    }
    actor.task=null;actor.route=[];actor.status='following';actor.pose='idle';
    if(result.ok){this.emit('objective',{});this.toast(`${actor.name}：协作完成。`);}
  }
  failTask(actor){
    if(this.expanded){const task=actor.task;const refunded=this.core.refundCommand?.(actor.name,task.commandId);if(!refunded?.ok)this.core.cancelCommand(actor.name);
      if(task.trainingSpent)this.trainingCredits.Claude=Math.min(1,this.trainingCredits.Claude+1);
      this.receipts.push({id:task.commandId,teammate:actor.name,targetId:task.target.id,roomId:this.currentRoom.id,outcome:'系统路线无法完成，限定词已退还。',failed:true});this.relayQueue=[];
    }else this.core.cancelCommand(actor.name);
    actor.task=null;actor.route=[];actor.status='following';this.toast(`${actor.name}：这条路被挡住了，请重新安排。`);
  }
  moveAlong(actor,dt,speed=195){
    let remaining=speed*dt;
    while(actor.route.length&&remaining>0){
      const next=actor.route[0],dx=next.x-actor.x,dy=next.y-actor.y,d=Math.hypot(dx,dy);
      if(d<1){actor.x=next.x;actor.y=next.y;actor.route.shift();continue;}
      const step=Math.min(remaining,d),old={x:actor.x,y:actor.y};actor.x+=dx/d*step;actor.y+=dy/d*step;
      if(this.expanded&&this.solidBodies().some(s=>overlap({x:actor.x-13,y:actor.y-47,w:26,h:46},s))){actor.x=old.x;actor.y=old.y;actor.route=[];actor.pose='idle';return false;}
      if(Math.abs(dx)>1)actor.direction=dx>0?'right':'left';
      actor.pose=Math.abs(dy)>4?'jump':'walk';remaining-=step;if(step===d)actor.route.shift();
    }
    if(!actor.route.length)actor.pose='idle';
    return true;
  }
  navigationRoute(actor,target){
    if(!this.expanded)return routeFor(this.platforms,this.map.ladders,actor,target);
    const solids=this.solidBodies(),segments=[];
    for(const platform of this.platforms.filter(p=>p.kind!=='lift')){
      let spans=[[platform.x,platform.x+platform.w]];
      for(const solid of solids)if(solid.y<platform.y&&solid.y+solid.h>platform.y-47){
        spans=spans.flatMap(([left,right])=>solid.x>=right||solid.x+solid.w<=left?[[left,right]]:
          [[left,Math.min(right,solid.x-14)],[Math.max(left,solid.x+solid.w+14),right]].filter(([a,b])=>b-a>28));
      }
      spans.forEach(([x,right],index)=>segments.push({...platform,id:platform.id+':'+index,x,w:right-x}));
    }
    const ladders=this.map.ladders.filter(l=>!solids.some(s=>overlap({x:l.x-13,y:l.y-47,w:26,h:l.h+46},s)));
    return routeFor(segments,ladders,actor,target);
  }
  updateCrew(dt,view){
    for(const [i,actor] of this.crew.entries()){
      if(actor.task){
        const task=actor.task;task.stageTime+=dt;
        if(this.expanded&&task.roomId!==this.currentRoom.id){this.failTask(actor);continue;}
        if(task.stage==='waiting'){
          const condition=task.plan.condition;
          const guard=condition.type==='guard-turn'?this.guards.find(g=>g.id===condition.targetId):null;
          const lift=condition.type==='lift-ready'?this.platforms.find(p=>p.id===condition.targetId):null;
          const ready=guard?guard.direction!==task.conditionDirection:lift?Math.abs(lift.y-(Math.abs(actor.y-lift.minY)<Math.abs(actor.y-lift.maxY)?lift.minY:lift.maxY))<12:false;
          if(ready){
            const result=this.core.beginCommand(actor.name);
            if(!result.ok){this.core.cancelCommand(actor.name);actor.task=null;actor.status='following';this.toast('等待结束时预算不足，指令已取消。');continue;}
            task.stage='travel';task.stageTime=0;task.started=this.time;actor.route=copy(task.geometry.route);actor.status='travelling';
            this.toast(actor.name+'：等待条件成立，开始行动。');
          }else if(task.stageTime>30){this.core.cancelCommand(actor.name);actor.task=null;actor.status='following';this.relayQueue=[];this.toast('条件未成立，等待已取消，没有花费限定词。');}
          continue;
        }
        if(this.time-task.started>22){this.failTask(actor);continue;}
        if(task.stage==='travel'){
          if(!this.moveAlong(actor,dt,220)){this.failTask(actor);continue;}
          if(!actor.route.length){task.stage='execute';task.stageTime=0;actor.status='executing';actor.direction=task.direction>0?'right':'left';
            if(actor.name==='Claude'){
              const candidates=this.guards.filter(g=>Math.abs(g.y-task.target.y)<48&&distance(g,task.target)<450&&(!this.expanded||task.geometry.guardIds.includes(g.id))).sort((a,b)=>distance(a,task.target)-distance(b,task.target));
              task.lured=candidates.slice(0,task.precise?1:3).map(g=>g.id);task.originals={};
              for(const g of candidates.filter(g=>task.lured.includes(g.id))){task.originals[g.id]=g.x;g.lure={x:clamp(task.target.x+30*(g.x<task.target.x?1:-1),g.minX,g.maxX),y:g.y};g.luredUntil=this.time+4;if(this.expanded){g.state='reading';g.suspicion=0;}}
              this.cue('paper-decoy',task.target.x,task.target.y-35);this.emit('sound',{name:'command-confirm'});
            }
          }
        }else if(actor.name==='Grok'){
          actor.pose='skill';const surface=this.nearestSurface(task.target);
          const end=this.expanded?task.geometry.end:task.precise?task.target.x+task.direction*35:clamp(task.target.x+task.direction*290,surface.x+20,surface.x+surface.w-20);
          const oldX=actor.x;actor.x+=task.direction*780*dt;
          if(task.direction>0?actor.x>end:actor.x<end)actor.x=end;
          this.strikeNodes(oldX,actor.x,actor.y,task.commandId,2,this.expanded?task.geometry.nodeIds:null);
          for(const b of this.barriers){
            if(!b.broken&&(!this.expanded||task.geometry.barrierIds.includes(b.id))&&Math.abs(actor.y-(b.y+b.h))<65&&Math.min(oldX,actor.x)-28<=b.x+b.w&&Math.max(oldX,actor.x)+28>=b.x){
              b.broken=true;this.cue('axe-impact',b.x+b.w/2,b.y+b.h/2,actor.direction);this.emit('sound',{name:'impact'});
              if(this.expanded)this.emit('obstacle-broken',{teammate:'Grok',broken:true,targetId:b.id});
              this.runRoomEvents('barrier-broken',b.id);
            }
          }
          if(Math.abs(actor.x-end)<2||task.stageTime>1.2){
            const barrier=this.barriers.find(b=>b.targetId===task.target.id||b.id===task.target.id);
            if(barrier&&!barrier.broken&&(!this.expanded||task.geometry.barrierIds.includes(barrier.id))){barrier.broken=true;this.cue('axe-impact',task.target.x,task.target.y-35,actor.direction);this.runRoomEvents('barrier-broken',barrier.id);}
            this.completeTask(actor);
          }
        }else if(actor.name==='Claude'){
          actor.pose='skill';
          const changed=(task.lured||[]).some(id=>Math.abs(this.guards.find(g=>g.id===id).x-task.originals[id])>8);
          if(task.stageTime>1&&changed)this.completeTask(actor);
          else if(task.stageTime>4)this.failTask(actor);
        }else{
          actor.pose='skill';
          if(task.stageTime>=2){
            for(const trap of this.traps){const dx=trap.x-actor.x,dy=trap.y-actor.y;
              if(this.expanded?task.geometry.trapIds.includes(trap.id):task.precise?dx*task.direction>=-20&&Math.abs(dx)<210&&Math.abs(dy)<70:distance(trap,actor)<280)trap.revealedUntil=this.time+8;
            }
            if(!task.precise)for(const alarm of this.alarms)if(this.expanded?task.geometry.alarmIds.includes(alarm.id):distance(alarm,actor)<280){
              if(this.expanded)this.warnAlarm(alarm.id,alarm.x,alarm.y);else this.triggerAlarm(alarm.id);
            }
            this.cue('scan-grid',actor.x+task.direction*110,actor.y-30,actor.direction);this.completeTask(actor);
          }
        }
      }else if(this.rendezvousRequested&&this.map.beacon&&view.chapter.number===5&&!view.attempt.evacuationStarted){
        if(!view.attempt.rendezvousCrew.includes(actor.name)){
          if(!actor.route.length&&distance(actor,this.map.beacon)>35)actor.route=this.navigationRoute(actor,{x:this.map.beacon.x-35+i*25,y:this.map.beacon.y})||[];
          this.moveAlong(actor,dt,230);
          if(distance(actor,this.map.beacon)<70)this.event('rendezvous',{teammate:actor.name,interactionTarget:view.chapter.rendezvousTarget});
        }
      }else{
        if(this.time>actor.repathAt&&distance(actor,this.player)>100+i*25){
          actor.route=this.navigationRoute(actor,{x:clamp(this.player.x-42-i*34,25,1250),y:this.player.y})||[];
          actor.repathAt=this.time+1.2;
        }
        this.moveAlong(actor,dt,210);
      }
    }
    if(this.expanded&&this.relayQueue.length&&!this.crew.some(actor=>actor.task)){
      const plan=this.relayQueue.shift();if(!this.startExpandedPlan({...plan,sequence:[]}))this.relayQueue=[];
    }
  }
  triggerAlarm(sourceId){const result=this.event('alarm',{eventId:this.unique('alarm'),sourceId});if(result.ok){this.emit('sound',{name:'alarm'});this.toast('现场警戒上升，留意预警区域。');}}
  warnAlarm(sourceId,x,y){
    if(this.alarmWarnings.some(w=>w.sourceId===sourceId))return;
    this.alarmWarnings.push({sourceId,x,y,roomId:this.currentRoom.id,remaining:1.3});
    this.emit('sound',{name:'alarm'});this.toast('扫描触及警戒器：调查将在预警后抵达。');
  }
  warnGuard(guard){
    if(!this.expanded||this.core.view().chapter.number!==5||this.time<this.evacuationSafeUntil)return;
    if(this.guardWarnings.some(w=>w.sourceId===guard.id))return;
    this.guardWarnings.push({sourceId:guard.id,x:guard.x,y:guard.y,roomId:this.currentRoom?.id,remaining:.55});
    guard.state='suspicious';
    this.emit('sound',{name:'guard-warning'});
    this.toast('守卫逼近：立刻冲刺离开红色预警区。');
  }
  guardVision(guard){
    const direction=guard.direction==='right'?1:-1;
    let reach=130;
    for(const solid of this.solidBodies())if(solid.y<guard.y&&solid.y+solid.h>guard.y-48){
      const d=direction>0?solid.x-guard.x:guard.x-solid.x-solid.w;if(d>=0)reach=Math.min(reach,d);
    }
    return {x:guard.x+(direction<0?-reach:0),y:guard.y-48,w:reach,h:48,direction};
  }
  guardSeesPlayer(guard){
    if(guard.luredUntil>this.time)return false;
    const region=this.guardVision(guard),p=this.player;
    const centreY=p.y-p.h/2;
    return p.x>=region.x&&p.x<=region.x+region.w&&centreY>=region.y&&centreY<=region.y+region.h;
  }
  hurt(amount=20){if(this.time<this.player.hurtUntil)return;const result=this.event('damage',{amount});if(result.ok){this.player.hurtUntil=this.time+.7;this.emit('sound',{name:'impact'});}}
  movePlayer(dt,input,view){
    const p=this.player;p.dashCooldown=Math.max(0,p.dashCooldown-dt);p.coyote=p.grounded?.11:Math.max(0,p.coyote-dt);
    p.jumpBuffer=input.jumpPressed?.14:Math.max(0,p.jumpBuffer-dt);
    const ladder=this.map.ladders.find(l=>Math.abs(p.x-l.x)<25&&p.y>=l.y-12&&p.y-p.h<=l.y+l.h+8
      &&(!input.up||p.y>l.y+.5)&&(!input.down||p.y<l.y+l.h-.5));
    const climb=ladder&&(input.up||input.down);
    if(climb){
      p.climbing=true;p.vx=0;p.vy=0;p.x+=(ladder.x-p.x)*Math.min(1,dt*15);
      const previousY=p.y;
      p.y=clamp(p.y+(input.down?160:-160)*dt,ladder.y,ladder.y+ladder.h);
      for(const solid of this.solidBodies())if(overlap(bodyRect(p),solid)){
        p.y=input.down?Math.min(previousY,solid.y):Math.max(previousY,solid.y+solid.h+p.h);
        this.toast(solid.targetId?'梯口被挡住了，先让 Grok 破障。':'梯口的闸门尚未开启。');
      }
      p.grounded=false;p.pose='walk';this.lastClimb=this.time;
    }else{
      p.climbing=false;
      const axis=(input.right?1:0)-(input.left?1:0),speed=235*(1-view.attempt.inventory.length*.05);
      if(axis)p.direction=axis>0?'right':'left';
      if(input.dashPressed&&p.dashCooldown===0){p.dashTime=.22;p.dashCooldown=2.8;p.vy=0;p.attackId=this.unique('dash');this.cue('water-dash',p.x,p.y-20,p.direction);this.emit('sound',{name:'dash'});}
      if(p.dashTime>0){p.vx=(p.direction==='right'?1:-1)*840;p.vy=0;p.dashTime-=dt;}
      else{
        const wanted=axis*speed,maxChange=(axis?2500:3000)*dt;
        p.vx+=clamp(wanted-p.vx,-maxChange,maxChange);
        if(p.jumpBuffer>0&&(p.coyote>0||this.time-this.lastClimb<.12)){
          p.vy=-590;p.grounded=false;p.coyote=0;p.jumpBuffer=0;this.lastClimb=-10;this.emit('sound',{name:'jump'});
        }
        p.vy=Math.min(800,p.vy+1850*dt);
        if(!input.jump&&p.vy<-240)p.vy+=1700*dt;
      }
      const steps=Math.max(1,Math.ceil(Math.max(Math.abs(p.vx*dt),Math.abs(p.vy*dt))/7));
      p.grounded=false;
      for(let n=0;n<steps;n++){
        const oldX=p.x,dx=p.vx*dt/steps;p.x=clamp(p.x+dx,16,1264);
        if(p.dashTime>0)this.strikeNodes(oldX,p.x,p.y,p.attackId,1);
        for(const s of this.solidBodies())if(overlap(bodyRect(p),s)){
          if(p.dashTime>0&&s.breakable&&!s.targetId){s.broken=true;this.cue('axe-impact',s.x+s.w/2,s.y+s.h/2);this.emit('sound',{name:'impact'});}
          else {p.x=dx>0?s.x-p.w/2:s.x+s.w+p.w/2;p.vx=0;if(p.dashTime>0){p.dashTime=0;this.toast(s.targetId?'这里需要 Grok 的破障指令。':'前路被机关挡住了。');}}
        }
        const before=p.y,dy=p.vy*dt/steps;p.y+=dy;
        if(dy>=0)for(const s of this.platforms){
          if(p.x+p.w/2>s.x&&p.x-p.w/2<s.x+s.w&&before<=s.y+2&&p.y>=s.y){p.y=s.y;p.vy=0;p.grounded=true;}
        }
        for(const s of this.solidBodies())if(overlap(bodyRect(p),s)){
          if(dy>=0&&before<=s.y+3){p.y=s.y;p.vy=0;p.grounded=true;}
          else if(dy<0){p.y=s.y+s.h+p.h;p.vy=0;}
        }
      }
      p.pose=p.dashTime>0?'skill':!p.grounded?(p.vy<0?'jump':'fall'):Math.abs(p.vx)>10?'walk':'idle';
    }
    if(p.y>735){this.hurt(20);p.x=this.map.spawn.x;p.y=this.map.spawn.y;p.vy=p.vx=0;this.toast('鲸尾把你带回了码头。');}
  }
  collectNearby(view){
    for(const item of this.items){
      if(item.collected||Math.abs(item.x-this.player.x)>32||Math.abs(item.y-this.player.y)>60)continue;
      if(this.nodes.some(n=>n.itemId===item.id&&n.hp>0))continue;
      const result=this.event('pickup',{itemId:item.id});
      if(result.ok){item.collected=true;this.emit('sound',{name:'pickup'});this.emit('objective',{});
        // Every data pickup can reveal one next clue in the offline fictional
        // evidence chain. The chain follows prerequisites and never touches a
        // network, host, credential, command, or exploit payload.
        const vuln=this.core.vulnerabilityState?.();
        const next=vuln?.caseFile?.clues?.find(clue=>!vuln.session.collected.includes(clue.id)
          && clue.requires.every(id=>vuln.session.collected.includes(id)));
        if(next){const evidence=this.core.collectVulnerabilityEvidence(next.id,{source:`地图拾取 · ${item.id}`,eventId:item.id});if(evidence.ok)this.toast(`发现虚构证据：${next.label}。前往演算舱整理。`);}
      }
      else if(result.reason==='backpack-full'&&this.time-this.lastBagToast>4){this.toast('背包已满三格，先回鲸艇交付。');this.lastBagToast=this.time;}
    }
    for(const supply of this.supplies){if(!supply.collected&&distance(supply,this.player)<45){const result=this.event('supply',{supplyId:supply.id});if(result.ok){supply.collected=true;this.emit('sound',{name:'pickup'});const gained=result.tokenGain||0;this.toast(gained?`补给已接入：限定词 +${result.qualifierGain||0} · AI Token +${gained}`:'获得一枚限定词。');}}}
  }
  getInteraction(view){
    const p=this.player;
    if(this.map.analysisStation&&distance(p,this.map.analysisStation)<58){
      if(view.attempt.aiTokens===0)return {id:'emergency-ai-token',type:'analysis',label:'AI Token 耗尽，领取 1 枚应急 Token',duration:.8,
        action:()=>{if(!this.map.analysisStation||distance(this.player,this.map.analysisStation)>=58)return;
          const result=this.event('emergency-ai-token',{interactionTarget:'analysis-station'});
          if(result.ok){this.emit('sound',{name:'pickup'});this.toast('应急 AI Token +1，已记录补给回执。可继续执行默认指令。');}}};
      return {id:'analysis-station',type:'analysis',label:'打开演算舱 · 分析虚构证据',duration:.25,
        action:()=>this.emit('analysis-open',{chapterId:view.chapter?.id})};
    }
    if(this.expanded){
      const exit=this.currentRoom.exits.find(e=>distance(e,p)<48);
      if(exit)return {id:'exit-'+exit.id,type:'room-exit',label:exit.label,duration:.18,action:()=>this.transitionRoom(exit)};
    }
    if(this.map.broadcast&&distance(p,this.map.broadcast)<55){
      return {id:'broadcast',type:'broadcast',label:view.attempt.broadcastOn?'关闭公开广播':'开启公开广播',duration:.8,
        action:()=>{this.event('broadcast',{on:!view.attempt.broadcastOn});this.toast(view.attempt.broadcastOn?'广播已关闭，后续公开记录停止增长。':'广播已开启，交付确认更快。');}};
    }
    if(this.map.beacon&&distance(p,this.map.beacon)<60&&view.chapter.number>=4){
      if(view.chapter.number===4)return {id:'beacon',type:'beacon',label:view.attempt.returnBeaconReady?'返航信标已经就绪':'设置远端返航信标',duration:.8,
        action:()=>{this.event('return-beacon');this.toast('远端返航信标已设置。');}};
      if(!view.attempt.evacuationStarted){
        if(view.attempt.rendezvousCrew.length<3)return {id:'rendezvous',type:'beacon',label:this.rendezvousRequested?`等待队友到齐 ${view.attempt.rendezvousCrew.length}/3`:'召集三名队友到信标',duration:.6,
          action:()=>{this.rendezvousRequested=true;for(const a of this.crew){a.route=[];}this.toast('队友正在沿梯子赶来，先装载最后三块数据。');}};
        if(view.attempt.inventory.length<3)return {id:'load',type:'beacon',label:'先拾取信标旁的三块数据',duration:.4,action:()=>this.toast('最后三块数据都要在背包中。')};
        if(!view.attempt.remoteReady)return {id:'prepare',type:'beacon',label:'接应完成，装载最终数据',duration:.8,
          action:()=>{const r=this.event('remote-prepare',{interactionTarget:view.chapter.rendezvousTarget});if(r.ok)this.toast('装载完毕。再次互动，确认开始 60 秒撤离。');}};
        return {id:'evacuate',type:'beacon',label:'确认开始 60 秒撤离',duration:.8,
          action:()=>{const r=this.event('evacuation-confirm',{interactionTarget:view.chapter.rendezvousTarget});if(r.ok){this.emit('dialogue',{character:'DeepSeek',text:'全员到齐，回鲸艇！'});this.toast('60 秒撤离开始：回鲸艇交付，再登艇。');}}};
      }
    }
    if(this.map.boat&&distance(p,this.map.boat)<75){
      if(view.attempt.inventory.length)return {id:'delivery',type:'boat',label:`交付背包 ${view.attempt.inventory.length}/3`,duration:view.attempt.deliveryDurationMs/1000,
        action:()=>{const r=this.event('delivery',{eventId:this.unique('delivery')});if(r.ok){this.emit('sound',{name:'delivery'});this.toast('数据交付成功。');}else this.toast(view.chapter.number===5?'请先去远端信标完成接应并确认撤离。':'当前无法交付。');}};
      const complete=view.objectives.every(o=>o.complete);
      return {id:'board',type:'boat',label:complete?'任务完成，登艇结算':'查看任务／登艇',duration:.6,
        action:()=>{const r=this.event('board');if(r.ok){this.emit('sound',{name:'results'});this.emit('chapter-result',{});}else this.toast(view.objectives.filter(o=>!o.complete).map(o=>o.label).join(' · '));}};
    }
    const plate=this.plates.find(s=>distance({x:s.x+s.w/2,y:s.y},p)<45);
    if(plate)return {id:'plate-'+plate.id,type:'plate',label:plate.pressed?'机关已锁定开启':'锁定压力板机关',duration:.5,action:()=>{plate.latched=true;plate.pressed=true;const gate=this.gates.find(g=>g.id===plate.gateId);if(gate&&!gate.disabled)gate.open=true;this.runRoomEvents('plate-latched',plate.id);this.toast(gate?.disabled?'挑战关闭此捷径，静态梯路仍然畅通。':'闸门已开启，返程通路保持畅通。');}};
    return null;
  }
  interact(dt,input,view){
    const target=this.getInteraction(view);
    if(!input.interact){this.mustReleaseInteract=false;this.interaction=null;}
    if(input.interact&&!this.mustReleaseInteract&&target){
      if(this.interaction?.target!==target.id)this.interaction={target:target.id,progress:0};
      this.interaction.progress=Math.min(1,this.interaction.progress+dt/target.duration);
      if(this.interaction.progress>=1){this.mustReleaseInteract=true;this.interaction=null;target.action();}
    }else if(!target)this.interaction=null;
    this.nearby=target?{type:target.type,label:target.label,progress:this.interaction?.progress||0}:null;
  }
  update(dt,input={}){
    let view=this.core.view();if(view.phase!=='playing')return;
    if(view.attempt?.attemptId!==this.attemptId)return {rebuild:true};
    const slow=Boolean(this.commandPreview)&&this.slowRemaining>0&&this.slowSession>0;
    if(slow){this.slowRemaining=Math.max(0,this.slowRemaining-dt);this.slowSession=Math.max(0,this.slowSession-dt);}
    const scale=slow?.25:1;
    this.core.advanceTime(dt*1000,{timeScale:scale});
    if(this.core.view().attempt?.attemptId!==this.attemptId)return {rebuild:true};
    dt*=scale;this.time+=dt;if(this.time>this.messageUntil)this.message='';
    for(const p of this.platforms)if(p.kind==='lift'){
      const old=p.y;p.y=(p.minY+p.maxY)/2+Math.sin(this.time*2*Math.PI/(p.period||5))*(p.maxY-p.minY)/2;
      if(this.player.grounded&&Math.abs(this.player.y-old)<3&&this.player.x>p.x&&this.player.x<p.x+p.w)this.player.y+=p.y-old;
    }
    this.movePlayer(dt,input,view);
    for(const g of this.guards){
      const old=g.x;
      if(g.luredUntil>this.time&&g.lure){g.x+=clamp(g.lure.x-g.x,-100*dt,100*dt);if(this.expanded)g.state='reading';}
      else{g.x+=(g.direction==='right'?1:-1)*g.speed*dt;if(g.x>=g.maxX){g.x=g.maxX;g.direction='left';}if(g.x<=g.minX){g.x=g.minX;g.direction='right';}}
      g.x=clamp(g.x,g.minX,g.maxX);
      if(g.x!==old)g.direction=g.x>old?'right':'left';
      if(this.expanded){
        if(g.luredUntil<=this.time){
          const visible=this.guardSeesPlayer(g);g.suspicion=clamp((g.suspicion||0)+(visible?dt:-dt*1.5),0,1.2);
          g.state=visible?'suspicious':g.suspicion>0?'searching':'patrol';
          if(g.suspicion>=1.2){this.warnAlarm(g.id,g.x,g.y);g.suspicion=0;g.state='searching';}
        }
      }
      if(Math.abs(g.x-this.player.x)<34&&Math.abs(g.y-this.player.y)<48){
        if(this.expanded&&view.chapter.number===5){
          this.warnGuard(g);
        }else{this.hurt(20);this.triggerAlarm(g.id);}
      }
    }
    this.updateCrew(dt,view);
    for(const plate of this.plates){plate.pressed=plate.latched||Math.abs(this.player.y-plate.y)<8&&this.player.x>plate.x&&this.player.x<plate.x+plate.w;
      const gate=this.gates.find(g=>g.id===plate.gateId);if(gate)gate.open=!gate.disabled&&Boolean(plate.pressed||plate.latched);}
    for(const trap of this.traps){
      trap.active=!this.expanded||(this.time+(trap.x%5))%4<2.5;
      if(trap.active&&Math.abs(this.player.y-trap.y)<12&&this.player.x>trap.x&&this.player.x<trap.x+trap.w){this.hurt(20);this.triggerAlarm(trap.id);}
    }
    for(const alarm of this.alarms)if(distance(this.player,alarm)<58){if(this.expanded)this.warnAlarm(alarm.id,alarm.x,alarm.y);else this.triggerAlarm(alarm.id);}
    this.collectNearby(view);view=this.core.view();this.interact(dt,input,view);
    if(this.commandPreview){const target=this.map.targets.find(t=>t.id===this.commandPreview.targetId);if(target)this.previewTarget(target,this.commandPreview.precise);}
    if(view.attempt.scanIntervalMs&&this.time>this.nextScan&&!this.scanWarning){
      this.scanWarning={x:clamp(this.player.x-65,5,1135),y:95,w:140,remaining:1.2};this.emit('sound',{name:'alarm'});
    }
    if(this.scanWarning){this.scanWarning.remaining-=dt;if(this.scanWarning.remaining<=0){if(this.player.x>this.scanWarning.x&&this.player.x<this.scanWarning.x+this.scanWarning.w)this.hurt(20);this.scanWarning=null;this.nextScan=this.time+(view.attempt.scanIntervalMs||10000)/1000;}}
    for(const warning of this.alarmWarnings){warning.remaining-=dt;if(warning.remaining<=0&&warning.roomId===this.currentRoom?.id){this.triggerAlarm(warning.sourceId);if(!this.scanWarning)this.scanWarning={x:clamp(warning.x-70,5,1135),y:95,w:140,remaining:1.2};}}
    this.alarmWarnings=this.alarmWarnings.filter(w=>w.remaining>0);
    for(const warning of this.guardWarnings){
      warning.remaining-=dt;
      if(warning.remaining<=0&&warning.roomId===this.currentRoom?.id){
        const guard=this.guards.find(g=>g.id===warning.sourceId);
        const close=guard&&Math.abs(guard.x-this.player.x)<44&&Math.abs(guard.y-this.player.y)<54;
        if(close&&this.time>=this.evacuationSafeUntil){this.hurt(15);this.triggerAlarm(warning.sourceId);}
        if(guard&&guard.state==='suspicious')guard.state='searching';
      }
    }
    this.guardWarnings=this.guardWarnings.filter(w=>w.remaining>0);
    this.effects=this.effects.filter(e=>this.time-e.started<.5);
    if(this.core.view().attempt?.attemptId!==this.attemptId)return {rebuild:true};
    return null;
  }
}
