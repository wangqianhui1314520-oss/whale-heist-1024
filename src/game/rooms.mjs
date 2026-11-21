import { MAPS } from './maps.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const p = (id,x,y,w,kind='stone',extra={}) => ({id,x,y,w,h:kind==='thin'?14:20,kind,...extra});
const l = (id,x,y,h) => ({id,x,y,h});
const layouts = {
  dock: {
    platforms:[p('floor',0,600,1280),p('west-deck',180,490,380),p('east-deck',700,490,400),p('observation',300,380,600)],
    ladders:[l('dock-west',240,490,110),l('dock-east',1000,490,110),l('observe-west',350,380,110),l('observe-east',820,380,110)],
  },
  sorting: {
    platforms:[p('floor',0,600,1280),p('sorting',180,490,940),p('west-shelf',320,380,310),p('east-shelf',780,380,350),p('upper-link',480,270,460,'thin')],
    ladders:[l('sorting-west',240,490,110),l('sorting-east',1050,490,110),l('shelf-west',370,380,110),l('shelf-east',850,380,110),l('link-west',550,270,110),l('link-east',850,270,110)],
  },
  gallery: {
    platforms:[p('floor',0,600,1280),p('west-gallery',150,490,400),p('east-gallery',650,490,500),p('review-walk',300,380,700),p('high-review',550,270,400,'thin'),p('service-lift',560,490,75,'lift',{minY:380,maxY:490,period:6})],
    ladders:[l('gallery-west',220,490,110),l('gallery-east',1050,490,110),l('review-west',350,380,110),l('review-east',800,380,110),l('high-west',600,270,110),l('high-east',900,270,110)],
  },
  tower: {
    platforms:[p('floor',0,600,1280),p('low-route',160,490,960),p('mid-route',300,380,820),p('archive-route',420,270,340),p('beacon-terrace',860,270,360),p('high-return',620,170,360,'thin')],
    ladders:[l('tower-entry',220,490,110),l('tower-return',1080,490,110),l('tower-west',350,380,110),l('tower-east',1050,380,110),l('archive-access',530,270,110),l('beacon-access',1100,270,110),l('high-west',700,170,100),l('high-east',930,170,100)],
  },
  annex: {
    platforms:[p('floor',0,600,1280),p('annex-entry',180,490,360),p('annex-middle',330,380,570),p('annex-vault',660,270,420,'thin')],
    ladders:[l('annex-low',240,490,110),l('annex-middle',400,380,110),l('annex-upper',800,270,110)],
  },
};
const at = (entries,placements) => placements.map(([id,x,y]) => ({...clone(entries.find(entry=>entry.id===id)),x,y}));
const b = (id,x,y) => ({id,x,y:y-76,w:44,h:76,targetId:id,breakable:true});
const exit = (id,x,y,to,arrival,label) => ({id,x,y,to,arrival,label});
const mainId = (chapter,index) => `${chapter}:room-${index}`;
const annexId = chapter => `${chapter}:annex`;

/** Expanded rooms retain the chapter's registered item/target IDs exactly once. */
function room(chapter,index,name,layout,data={}) {
  const base=MAPS.find(map=>map.id===chapter), optional=index===3;
  return {
    id:optional?annexId(chapter):mainId(chapter,index),chapterId:chapter,name,index,
    total:['paper-window','resume-storm','review-quietly'].includes(chapter)?3:2,optional,
    subtitle:data.subtitle||base.subtitle,tint:base.tint,spawn:{x:120,y:600},
    boat:index===1?{x:85,y:600}:null,broadcast:index===1?{x:235,y:600}:null,beacon:null,
    // A local, fictional evidence console used by the safe vulnerability
    // analysis loop. It never contacts a server.
    // Keep the local evidence console away from the boat/broadcast interaction
    // so the first room's existing route remains unambiguous.
    analysisStation:{x:330,y:600},
    ...clone(layouts[layout]),barriers:[],gates:[],plates:[],items:[],supplies:[],targets:[],guards:[],traps:[],alarms:[],events:[],
    decoration:[{id:'room-server',x:27,y:470,w:48,h:130,asset:'scene-server-rack'}],exits:[],...data,
  };
}
const chapterRooms = [];
function pair(chapter,a,bRoom,annex) {
  a.exits.push(exit('to-action',1170,600,bRoom.id,{x:85,y:600},'进入 '+bRoom.name));
  bRoom.exits.push(exit('to-harbor',65,600,a.id,{x:1130,y:600},'返回 '+a.name));
  if(annex){
    a.exits.push(exit('to-annex',870,380,annex.id,{x:110,y:600},'支线 · '+annex.name));
    annex.exits.push(exit('from-annex',65,600,a.id,{x:825,y:380},'返回主通道'));
    if(chapter==='paper-window')annex.exits.push({...exit('maintenance-hatch',1140,600,bRoom.id,{x:85,y:600},'维护舱捷径 · 前往机房'),requiresEvent:'harbor-annex-found'});
  }
  chapterRooms.push(a,bRoom,...(annex?[annex]:[]));
}
{
  const c=MAPS[0],a=room(c.id,1,'入港教学码头','dock',{
    subtitle:'安全节点、短梯与第一道纸窗；右侧通往机房。',
    platforms:[p('floor',0,600,1280),p('west-deck',180,490,140),p('training-landing',365,490,195),p('east-deck',700,490,400),p('observation',300,380,600)],
    ladders:[l('dock-west',240,490,110),l('landing-access',390,490,110),l('landing-return',520,490,110),l('dock-east',1000,490,110),l('observe-west',390,380,110),l('observe-east',820,380,110)],
    items:at(c.items,[['harbor-data-1',390,490],['harbor-data-2',500,490]]),
    barriers:[b('paper-window',420,490)],targets:at(c.targets,[['paper-window',442,490]]),
    events:[{id:'paper-power-bridge',trigger:'barrier-broken',subject:'paper-window',action:'open-bridge',platform:p('powered-return-bridge',560,490,140,'thin'),text:'纸窗后的电力接通，回程桥展开了。'}],
  }),d=room(c.id,2,'纸窗资料机房','sorting',{
    items:at(c.items,[['harbor-data-3',430,490],['harbor-data-4',1000,380]]),
    barriers:[b('outer-node',900,380)],targets:at(c.targets,[['outer-node',922,380]]),
    guards:[{id:'harbor-guard',x:1040,y:380,minX:980,maxX:1090,speed:38}],
    events:[{id:'harbor-vault-open',trigger:'barrier-broken',subject:'outer-node',action:'record',text:'外侧机柜已打开，原路梯子和下层返程都可用。'}],
  }),s=room(c.id,3,'高处档案夹层','annex',{
    items:at(c.items,[['harbor-extra-1',550,380],['harbor-extra-2',950,270]]),supplies:at(c.supplies,[['harbor-qualifier',750,270]]),
    events:[{id:'harbor-annex-found',trigger:'item-picked',subject:'harbor-extra-1',action:'record',text:'档案里留下了小队的第一张行动草图，维护舱捷径随之开启。'}],
  });pair(c.id,a,d,s);
}
{
  const c=MAPS[1],a=room(c.id,1,'招聘观察前厅','dock',{
    items:at(c.items,[['resume-data-1',300,490],['resume-data-2',560,490],['resume-data-3',760,490]]),
    targets:at(c.targets,[['patrol-west',430,490]]),
    // One dock patrol walks a 90px band (410-500) that a single running jump
    // clears, and every dock pickup (300 / 560 / 760) still sits more than a
    // body-width outside it. The second patrol watches the observation deck a
    // storey above, so the two can never clump into the same contact zone and
    // turn one crossing into a 40-damage double hit.
    guards:[{id:'resume-west-guard',x:440,y:490,minX:410,maxX:500,speed:38},{id:'resume-observer',x:600,y:380,minX:560,maxX:680,speed:33}],
    events:[{id:'resume-first-decoy',trigger:'target-completed',subject:'patrol-west',action:'record',text:'纸页确实把同层巡逻引向了招聘板，检查口空出来了。'}],
  }),d=room(c.id,2,'简历分拣机房','sorting',{
    items:at(c.items,[['resume-data-4',740,490],['resume-data-5',850,380],['resume-data-6',1100,380]]),
    barriers:[b('cargo-divider',650,490)],targets:at(c.targets,[['cargo-divider',672,490],['patrol-east',1000,490]]),
    gates:[{id:'sorting-gate',x:900,y:418,w:30,h:72,plateId:'east-pressure'}],plates:[{id:'east-pressure',x:1005,y:374,w:54,h:6,gateId:'sorting-gate'}],
    // The east patrol walks the lower sorting deck while the remote shelf and
    // its pickup stay a storey above, and its band stops 40px short of the
    // 1050 ladder so climbing up is never a blind contact.
    guards:[{id:'resume-east-guard',x:980,y:490,minX:950,maxX:1010,speed:40}],traps:[{id:'resume-floor-trap',x:720,y:592,w:68}],
    events:[{id:'sorting-return-latched',trigger:'plate-latched',subject:'east-pressure',action:'record',text:'回程闸门锁定开启，再经过这里无需重新踩板。'}],
  }),s=room(c.id,3,'误投简历档案室','annex',{
    items:at(c.items,[['resume-extra-1',550,380],['resume-extra-2',950,270]]),supplies:at(c.supplies,[['resume-qualifier',750,270]]),
    events:[{id:'resume-annex-found',trigger:'item-picked',subject:'resume-extra-1',action:'record',text:'误投档案显示：默认诱饵适合同时腾出多个通道。'}],
  });pair(c.id,a,d,s);
}
{
  const c=MAPS[2],a=room(c.id,1,'校验灯桥','gallery',{
    items:at(c.items,[['review-data-1',300,490],['review-data-2',730,490],['review-data-3',650,380]]),
    targets:at(c.targets,[['trap-bridge',740,380]]),traps:[{id:'review-bridge-trap',x:710,y:372,w:70}],alarms:[{id:'review-bridge-alarm',x:940,y:380}],
    supplies:at(c.supplies,[['review-qualifier-a',440,380]]),
    events:[{id:'review-cycle-revealed',trigger:'target-completed',subject:'trap-bridge',action:'record',text:'扫描标出了陷阱周期；上层梯路可以完全绕开它。'}],
  }),d=room(c.id,2,'复查服务管廊','gallery',{
    items:at(c.items,[['review-data-4',450,490],['review-data-5',850,380],['review-data-6',900,270]]),
    supplies:at(c.supplies,[['review-first-aid',1040,600]]),
    barriers:[b('return-divider',750,490)],targets:at(c.targets,[['return-divider',772,490],['alarm-fan',860,270]]),
    traps:[{id:'review-floor-trap',x:712,y:592,w:65},{id:'review-west-trap',x:650,y:372,w:65}],alarms:[{id:'review-upper-alarm',x:1000,y:270}],
    guards:[{id:'review-east-guard',x:955,y:490,minX:900,maxX:1010,speed:42}],
    events:[{id:'review-return-bridge',trigger:'barrier-broken',subject:'return-divider',action:'open-bridge',platform:p('review-return-bridge',550,490,100,'thin'),text:'回程隔板落下成为桥面，原来的静态梯路仍然畅通。'}],
  }),s=room(c.id,3,'高处审计柜','annex',{
    items:at(c.items,[['review-extra-1',550,380],['review-extra-2',950,270]]),supplies:at(c.supplies,[['review-qualifier-b',750,270]]),
    events:[{id:'review-annex-found',trigger:'item-picked',subject:'review-extra-1',action:'record',text:'审计柜记录了警戒器位置，窄扫描可以避开它。'}],
  });pair(c.id,a,d,s);
}
{
  const c=MAPS[3],a=room(c.id,1,'公开战报后台','gallery',{
    items:at(c.items,[['report-task-1',900,270],['report-archive-1',440,380]]),supplies:at(c.supplies,[['report-qualifier-a',300,490]]),
    targets:at(c.targets,[['return-inspection',740,380]]),traps:[{id:'report-return-trap',x:710,y:372,w:68}],alarms:[{id:'report-backstage-alarm',x:950,y:380}],
    events:[{id:'report-records-read',trigger:'room-enter',action:'record',text:'调查屏正在重放此前真实的公开行动；关闭广播只能停止新记录。'}],
  }),d=room(c.id,2,'档案塔与远端站','tower',{
    beacon:{x:1100,y:270},items:at(c.items,[['report-task-2',1160,270],['report-archive-2',850,170]]),supplies:at(c.supplies,[['report-qualifier-b',980,380]]),
    barriers:[b('archive-divider',590,270)],targets:at(c.targets,[['archive-divider',612,270],['archive-guard',1000,270]]),
    guards:[{id:'report-archive-guard',x:1130,y:270,minX:1040,maxX:1200,speed:44}],
    gates:[{id:'archive-gate',x:990,y:198,w:30,h:72,plateId:'inspection-pressure'}],plates:[{id:'inspection-pressure',x:800,y:374,w:54,h:6,gateId:'archive-gate'}],
    alarms:[{id:'report-beacon-alarm',x:1205,y:270}],
    events:[{id:'report-return-light',trigger:'item-picked',subject:'report-task-2',action:'record',text:'任务物取回，远端站亮起返航灯；先设置信标再回艇。'}],
  });pair(c.id,a,d);
}
{
  const c=MAPS[4],a=room(c.id,1,'接应准备前区','gallery',{
    targets:at(c.targets,[['evacuation-traps',740,380]]),supplies:at(c.supplies,[['rendezvous-supply-a',440,380]]),
    traps:[{id:'evacuation-return-trap',x:710,y:372,w:70}],
    gates:[{id:'evacuation-gate',x:900,y:418,w:30,h:72,plateId:'return-pressure'}],plates:[{id:'return-pressure',x:820,y:374,w:54,h:6,gateId:'evacuation-gate'}],
    events:[{id:'evacuation-return-unlocked',trigger:'plate-latched',subject:'return-pressure',action:'record',text:'返程门已经锁定开启。确认撤离之前，可以先检查整条路线。'}],
  }),d=room(c.id,2,'远端装载接应站','tower',{
    beacon:{x:1100,y:270},items:at(c.items,[['final-data-1',1040,270],['final-data-2',1120,270],['final-data-3',1180,270]]),supplies:at(c.supplies,[['rendezvous-supply-b',850,170]]),
    barriers:[b('evacuation-divider',910,270)],targets:at(c.targets,[['evacuation-divider',932,270],['evacuation-patrol',1000,270]]),
    guards:[{id:'evacuation-upper-guard',x:1160,y:270,minX:1030,maxX:1200,speed:48}],alarms:[{id:'evacuation-east-alarm',x:1205,y:270}],
    events:[{id:'evacuation-route-ready',trigger:'barrier-broken',subject:'evacuation-divider',action:'record',text:'装载通道已经打开；三人到齐、数据装好后由你确认倒计时。'}],
  });pair(c.id,a,d);
}

// The outward trip earns a physical return route. These doors never skip a
// pickup, delivery or chapter gate, and the final timed evacuation keeps its route.
for (const [chapter, itemId] of [['resume-storm','resume-data-6'],['review-quietly','review-data-6'],['public-report','report-task-2']]) {
  const action = chapterRooms.find(room => room.id === mainId(chapter, 2));
  const id = chapter + '-return-hatch';
  action.events.push({ id, trigger:'item-picked', subject:itemId, action:'record', text:'远端资料已取出，底层返航维护舱亮起。可以从右侧直接回到鲸艇旁。' });
  action.exits.push({ ...exit('return-hatch',1090,600,mainId(chapter,1),{x:140,y:600},'返航维护舱 · 直达鲸艇'), requiresEvent:id, optionalShortcut:true, lockedLabel:'取得远端任务资料后，返航维护舱才会开启。' });
}
for(const room of chapterRooms)for(const gate of room.gates)gate.optionalShortcut=true;
export const ROOMS = chapterRooms;
export const getChapterRooms = chapterId => ROOMS.filter(room=>room.chapterId===chapterId);
export const getRoom = id => ROOMS.find(room=>room.id===id) || null;
