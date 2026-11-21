import { GameCore } from './core/state.mjs';
import { CHAPTERS } from './core/chapters.mjs';
import { browserStorage } from './core/storage.mjs';
import { loadCampaignSave, saveExperience, backupExperience, clearExperience, loadArchive, saveArchive, exportSave, parseSave, importSave } from './core/experience-storage.mjs';
import { AssetLibrary } from './render/assets.mjs';
import { GameUI } from './ui/ui.mjs';
import { GameWorld } from './game/world.mjs';
import { GameRenderer, sceneImageKeys } from './render/scene-renderer.mjs';
import { GameInput } from './game/input.mjs';
import { GameAudio } from './game/audio.mjs';
import { getMap } from './game/maps.mjs';
import { chapterCheckpoint, loadBest, recordBest } from './game/session.mjs';
import { loadSettings, saveSettings, updateSetting, setBinding, normalizeSettings, keyLabel } from './game/preferences.mjs';
import { getStoryScene, getStoryReplayIndex } from './game/story.mjs';
import { TutorialDirector } from './game/tutorial.mjs';
import { LessonBridge } from './game/lesson-bridge.mjs';
import { compilePrompt, getConstraints, getTemplates } from './game/prompts.mjs';
import { CONTRACTS, createContract } from './game/contracts.mjs';
import { recordTriageState, chooseRecordTreatment } from './game/record-triage.mjs';
import { storyArtFor } from './game/story-art.mjs';

const storage=browserStorage(),canvas=document.getElementById('game-canvas'),audio=new GameAudio();
let audioScene='title';
let settings=loadSettings(storage),archive=loadArchive(storage);
let core=GameCore.resume({storage}),world=null,renderer=null,assets=null,tutorial=null,lesson=null;
let mode='campaign',busy=false,best=loadBest(storage),checkpoint=null,contractId='standard',selectedChapterId=null;
let loadSequence=0,pauseAfterLoad=false,lastFrame=0,lastUI=0,accumulator=0,lastAutosave=0,nextRenderAt=0;
let storyPlayer=null,storyAfter=null,storyRunId=0,pendingChapterIntro=false,overlayStack=[],promptError=null,bindingAction=null,failure=null;
let noticeQueue=[],lastNoticeAt=0,trainingUsed=false,recordCounter=0,preparationSeen=false,grokJoinPlayed=false;
let chapterOrderPlayed=false,evacuationVoiceTick=0;
// A checkpoint is written on room entry / pickup, so a death deep in a room
// used to restore the exact low health that caused it. Keep a floor on retry.
const CHECKPOINT_HEALTH_FLOOR=60;
// Watchdog: the world must never stall while the player is in free play. If the
// simulation clock stops advancing behind an opaque "no overlay" state, recover
// instead of leaving the character frozen.
let wdAt=0,wdTime=0,wdHiddenAt=0,wdStallSince=0;
// Decode narrative art ahead of display and retain a bounded set of bitmaps.
const storyImageCache=new Map();
function preloadStoryImage(story, style=settings.storyStyle){
  if(typeof Image!=='function')return Promise.resolve(null);
  const path=storyArtFor(story,style),existing=storyImageCache.get(path);
  if(existing)return existing.promise;
  const image=new Image(); image.decoding='async';
  const entry={image,promise:null};
  entry.promise=new Promise(resolve=>{
    let settled=false;
    const done=(ok)=>{
      if(settled)return;settled=true;image.onload=image.onerror=null;
      if(!ok&&storyImageCache.get(path)===entry)storyImageCache.delete(path);
      resolve(ok?image:null);
    };
    image.onload=()=>done(true);image.onerror=()=>done(false);
    image.src=globalThis.__ASSET_DATA__?.[path]??path;
    if(typeof image.decode==='function')image.decode().then(()=>done(true),()=>{if(image.complete)done(Boolean(image.naturalWidth));});
    else if(image.complete)done(Boolean(image.naturalWidth));
  });
  storyImageCache.set(path,entry);
  while(storyImageCache.size>8)storyImageCache.delete(storyImageCache.keys().next().value);
  return entry.promise;
}
function preloadStoryFrames(){
  if(!storyPlayer)return;
  const {scene,index,following}=storyPlayer;
  const current={...scene.steps[index],sceneId:scene.id};
  void preloadStoryImage(current);
  // Scene identity determines the artwork. Warm the next distinct scene while
  // the player reads this one rather than requesting it only after a click.
  if(following[0])void preloadStoryImage({sceneId:following[0]});
}
const ui=new GameUI({onAction:(action,payload)=>void act(action,payload)});
const input=new GameInput({settings,getScreen:()=>ui.screen,onAction:(action,payload)=>void act(action,payload)});
audio.configure(settings);
// Menu and overlay navigation answers with the paper-click sound. Command and
// prompt actions keep their own audio; story turns use the page-turn sound.
const UI_CLICK_ACTIONS=new Set(['new-game','new-game-confirm','new-game-cancel','resume','pause','resume-play','title','help','chapter-select','demo-select','contracts-open','contract-select','challenge-start','demo-start','settings-open','settings-back','overlay-back','settings-change','settings-reset','bind-key','binding-captured','save-export','save-import','archive-open','records-open','map-open','analysis-open','story-replay','briefing-start','tutorial-skip','tutorial-restart','retry','retry-checkpoint','continue','mute','reduce-motion','story-style','campaign-summary']);
const copy=value=>JSON.parse(JSON.stringify(value));
const mustStayPaused=()=>document.hidden||window.matchMedia('(orientation: portrait)').matches;
const active=()=>world&&core.view().attempt;
const errorText=value=>typeof value==='string'?value:value?.message||'这条指令还不能执行。';
const unlocked=()=>Math.min(5,(loadCampaignSave(storage).campaign?.campaign.results.length||0)+1);
const normalizedRecord=(record)=>({...record,id:record.id?.startsWith(core.view().chapter?.id+':')?record.id:`${core.view().chapter?.id||'voyage'}:${record.id||++recordCounter}`,chapterId:core.view().chapter?.id,chapter:core.view().chapter?.name,room:record.room||world?.currentRoom?.name||''});
function records(){const map=new Map(archive.records.map(r=>[r.id,r]));for(const r of world?.records||[]){const row=normalizedRecord(r);map.set(row.id,row);}return [...map.values()].slice(-300);}
function saveSummary(){const {experience:exp,campaign}=loadCampaignSave(storage);
 const chapter=CHAPTERS[campaign?.campaign.results.length||0];return {hasSave:Boolean(campaign),completed:campaign?.campaign.completed||false,
 chapterNumber:chapter?.number||5,chapterName:chapter?.name||'全员返航',checkpointLabel:exp?.checkpointLabel||'从本章入口开始'};}
function promptTargets(){return world?.promptTargets?.()||world?.map.targets||[];}
function conditionTarget(type){return promptTargets().filter(t=>type==='guard-turn'?/guard|patrol/i.test(`${t.id} ${t.type}`):/lift|elevator/i.test(`${t.id} ${t.type}`)).sort((a,b)=>Math.hypot(a.x-world.player.x,a.y-world.player.y)-Math.hypot(b.x-world.player.x,b.y-world.player.y))[0];}
function promptSentence(preview){if(!preview)return '';const verb={Grok:'冲锋',Claude:'投放诱饵',GLM:'扫描'}[preview.teammate];
 const target=world.map.targets.find(t=>t.id===preview.targetId),name=target?.label||preview.label||'目标';
 return `${preview.teammate}，对${name}${verb}。${preview.precise?({Grok:'只处理这一处，到标记停。',Claude:'只引一名。',GLM:'只扫描前方窄区。'}[preview.teammate]):''}`;}
function getView(){
 const view=core.view(),snapshot=world?.snapshot()||{};
 if(snapshot.room){snapshot.rooms=world.rooms.map(r=>({id:r.id,name:r.name,optional:r.optional,current:r.id===world.currentRoom.id,visited:world.visited.has(r.id)}));}
 if(snapshot.commandPreview){const p=snapshot.commandPreview;const config=world.promptConfig||{};
  p.constraints=[{id:'',label:'不附加约束 · 仅消耗 Token'},...getConstraints(p.teammate,view.chapter.number)];
  p.targets=world.map.targets.filter(t=>t.teammate===p.teammate).map(t=>({id:t.id,label:t.label}));
  p.conditions=[{id:'none',label:'立即执行'},...(view.chapter.number>=4&&conditionTarget('guard-turn')?[{id:'guard-turn',label:'守卫转身后'}]:[]),...(view.chapter.number>=4&&conditionTarget('lift-ready')?[{id:'lift-ready',label:'升降台到位后'}]:[])];
  p.condition=config.condition?.type||'none';p.promptText=config.promptText||promptSentence(p);p.parseError=promptError;
  p.receipt=p.promptText;p.cost=p.plan?.totalCost??p.totalCost??p.cost;
  p.trainingAvailable=world.trainingCredits?.[p.teammate]||0;p.trainingCost=p.plan?.trainingCost??p.trainingCost??0;
 }
 const t=tutorial?.getState();let tutorialView=null;
 if(t&&!t.done){const guide=t.guide; tutorialView={title:({1:'码头行动训练',2:'诱饵与限定词',3:'复查演练'})[view.chapter?.number]||'行动训练',
  text:t.hint||guide?.text||t.step.text, step:guide?.index??t.completed.length,total:guide?.total??tutorial.steps.length,
  complete:t.done,hintLevel:t.hintLevel,guide,canShowRoute:t.canShowRoute};}
 const scene=storyPlayer?{sceneId:storyPlayer.scene.id,title:storyPlayer.scene.title,...storyPlayer.scene.steps[storyPlayer.index],runId:storyPlayer.runId,replay:storyPlayer.replay,index:storyPlayer.index,total:storyPlayer.scene.steps.length,auto:settings.autoDialogue,presentation:settings.storyStyle,comicPanels:storyPlayer.scene.steps.map((entry)=>({caption:entry.speaker,text:entry.text,speaker:entry.speaker,backdrop:entry.backdrop})),progress:(storyPlayer.index+1)/storyPlayer.scene.steps.length,choiceSelected:storyPlayer.choiceSelected||null}:null;
 return {core:view,world:snapshot,mode,muted:audio.muted,reduceMotion:settings.reduceMotion,unlocked:unlocked(),settings,saveSummary:saveSummary(),
  tutorial:tutorialView,story:scene,records:records(),recordTriage:recordTriageState(records()),checkpoint:{available:Boolean(checkpoint),label:checkpoint?.label||'本章入口'},bindingAction,
  selectedChapterId,contractId,contracts:CONTRACTS,archive:{stories:getStoryReplayIndex({...view,records:records(),seenScenes:archive.seenStories}).map(entry=>({...entry,available:entry.id==='prologue'&&archive.seenStories.includes('departure')||/^chapter[1-5]-briefing$/.test(entry.id)&&entry.chapter<=(view.chapter?.number||5)})),
  templates:[...archive.templates.map(t=>({...t,unlocked:true})),...getTemplates(null,view.chapter?.number||5).map(t=>({...t,name:t.label,unlocked:true}))],
  characters:[{name:'DeepSeek',job:'行动队长',description:'鲸尾冲刺、搬运资料，安排大家一起返航。'},{name:'Grok',job:'破障',description:'默认连续冲锋，限定后到指定位置停下。'},{name:'Claude',job:'诱饵',description:'纸页引开同层巡逻，限定后只影响一名。'},{name:'GLM',job:'扫描',description:'复查隐藏机关，范围越广越需要留意警戒器。'}]}};
}
const updateUI=()=>ui.update(getView());
function setLoading(progress,label){document.getElementById('game-shell').dataset.loading=progress<1?'true':'false';ui.setLoading(progress,label);}
function announce(text,priority=0){if(!text)return;
 if(priority>=2&&ui.screen==='none'){ui.toast(text);lastNoticeAt=performance.now();noticeQueue=noticeQueue.filter(n=>n.priority>=priority);return;}
 if(noticeQueue.some(n=>n.text===text))return;noticeQueue.push({text,priority});noticeQueue.sort((a,b)=>b.priority-a.priority);noticeQueue=noticeQueue.slice(0,5);}
function flushNotices(now){if(noticeQueue.length&&['none','command'].includes(ui.screen)&&now-lastNoticeAt>2700){ui.toast(noticeQueue.shift().text);lastNoticeAt=now;}}
function snapshot(){if(!active()||!world.exportState)return null;return {core:core.exportRuntime(),world:world.exportState(),tutorial:tutorial?.serialize(),trainingUsed};}
function persist(){const view=core.view();if(mode!=='campaign'||(!world&&!view.campaign.completed))return;archive.records=records();saveArchive(storage,archive);
 const current=world&&['playing','paused'].includes(view.phase)?snapshot():null;
 saveExperience(storage,{version:2,savedAt:new Date().toISOString(),chapterId:view.chapter?.id||'campaign-complete',campaign:core.checkpoint(),
  current,checkpoint:view.campaign.completed?null:checkpoint?.snapshot||null,checkpointLabel:view.campaign.completed?'全员返航':checkpoint?.label||'本章入口',contractId:'standard',
  story:storyPlayer&&!storyPlayer.replay?{sceneId:storyPlayer.scene.id,index:storyPlayer.index,choices:storyPlayer.choices,following:storyPlayer.following||[],destination:storyPlayer.destination||'play'}:null});
}
function makeCheckpoint(label){if(!active()||core.view().attempt.evacuationStarted)return;checkpoint={label,snapshot:snapshot()};persist();}
function clearChapterRecords(chapterId){archive.records=archive.records.filter(r=>r.chapterId!==chapterId);}
function applySettings(){input.configure(settings);audio.configure(settings);saveSettings(storage,settings);updateUI();}
function showTitle({save=true}={}){input.clear();world?.cancelPreview();storyPlayer=null;storyAfter=null;overlayStack=[];noticeQueue=[];
 if(core.view().phase==='playing')core.setPaused(true);audio.setPaused(false);audioScene='title';audio.setScene('title');if(save)persist();updateUI();ui.show('title',saveSummary());}
function showChapters(demoSelect=false){input.clear();if(core.view().phase==='playing')core.setPaused(true);overlayStack=[];updateUI();ui.show('chapter-select',{unlocked:demoSelect?5:unlocked(),best,demoSelect});}
function openOverlay(screen,payload={}){if(!['settings','map','records','archive','analysis','help','contracts'].includes(screen))return;
 overlayStack.push({screen:ui.screen,payload:ui.payload});input.clear();if(core.view().phase==='playing')core.setPaused(true);updateUI();ui.show(screen,payload);}
function overlayBack(){bindingAction=null;input.bindingAction=null;
 if(ui.screen==='chapter-select'){showTitle();return;}
 if(ui.screen==='story'){finishStory();return;}if(ui.screen==='briefing'){void act('briefing-start');return;}
 if(ui.screen==='confirm-new'){showTitle();return;}
 const previous=overlayStack.pop();if(previous){if(['none','command'].includes(previous.screen)&&!mustStayPaused())core.setPaused(false);updateUI();ui.show(previous.screen,previous.payload);}
 else if(active()){core.setPaused(true);updateUI();ui.show('pause');}else showTitle();
}
function storyMotionSound(step){
 const fx=Array.isArray(step?.motion?.fx)?step.motion.fx:[];
 const names={page:'story-page',decoy:'story-page',scan:'story-scan',impact:'story-impact',alert:'story-alert',beacon:'story-beacon',water:'dash',record:'story-scan'};
 fx.map(name=>names[name]).filter(Boolean).slice(0,2).forEach(name=>audio.play(name));
 // One character line per story beat, picked from the motion cue: DeepSeek's own
 // observation answers with his scan bark, every other scan belongs to GLM.
 const voices={water:'hero_charge',impact:'grok_charge',alert:'glm_warn',beacon:'glm_route',record:'claude_record',scan:'glm_scan'};
 const voice=fx.map(name=>name==='scan'&&step?.speaker==='DeepSeek'?'hero_scan':voices[name]).find(Boolean);
 if(voice)audio.playVoice(voice);
}
function beginStory(id,after=()=>resumePlay(),{replay=false,following=[],destination='play',restore=null,skipSeen=true}={}){
 const scene=getStoryScene(id,{...core.view(),records:records()});if(!scene?.steps?.length){after();return;}
 // Stateful scenes must use this voyage's records even when seen on an older run.
 if(skipSeen&&settings.skipSeenStory&&archive.seenStories.includes(scene.id)&&!scene.dynamic&&!replay&&!restore){after();return;}
 const index=restore?Math.min(restore.index,scene.steps.length-1):0;
 const choices=(restore?.choices||[]).filter(entry=>scene.steps[entry.step]?.choice?.options?.some(option=>option.id===entry.id));
 storyPlayer={scene,index,elapsed:0,replay,runId:++storyRunId,choiceSelected:choices.find(entry=>entry.step===index)?.id||null,choices,following:[...following],destination};storyAfter=after;preloadStoryFrames();input.clear();core.setPaused(true);updateUI();ui.show('story');audio.playMusic('story');audio.play('story');storyMotionSound(scene.steps[index]);
 if(!replay)persist();
}
function finishStory({allowStart=false}={}){if(!storyPlayer){overlayBack();return;}const id=storyPlayer.scene.id,replay=storyPlayer.replay;
 // The first opening may fast-forward its animation, but each keyword still
 // needs an actual click and entry to the dock needs an explicit confirmation.
 if(id==='prologue'&&!storyPlayer.replay){
  const pending=(storyPlayer.scene.requiredChoices||[]).find(choice=>!storyPlayer.choices.some(entry=>entry.id===choice));
  if(pending||!allowStart){
   storyPlayer.index=pending?storyPlayer.scene.steps.findIndex(entry=>entry.choice?.options?.some(option=>option.id===pending)):storyPlayer.scene.steps.length-1;
   storyPlayer.elapsed=0;storyPlayer.choiceSelected=null;updateUI();storyMotionSound(storyPlayer.scene.steps[storyPlayer.index]);persist();
   ui.toast(pending?'点击亮起的关键词，亲手完成行动准备。':'点击“开始行动”进入码头。');return;
  }
 }
 if(!storyPlayer.replay&&mode==='campaign'){if(!archive.seenStories.includes(id))archive.seenStories.push(id);saveArchive(storage,archive);}storyPlayer=null;
 audio.setScene(audioScene);const callback=storyAfter;storyAfter=null;callback?.();if(!replay&&mode==='campaign'&&!storyPlayer)persist();}
function nextStory(){if(!storyPlayer)return;const current=storyPlayer.scene.steps[storyPlayer.index];if(current.choice&&!storyPlayer.choiceSelected)return;if(storyPlayer.index+1<storyPlayer.scene.steps.length){storyPlayer.index++;storyPlayer.elapsed=0;storyPlayer.choiceSelected=null;preloadStoryFrames();updateUI();audio.play('story');storyMotionSound(storyPlayer.scene.steps[storyPlayer.index]);if(!storyPlayer.replay)persist();}else finishStory({allowStart:true});}
function storyChoice(id){if(!storyPlayer)return;const current=storyPlayer.scene.steps[storyPlayer.index];if(!current.choice)return;const option=current.choice.options?.find(item=>item.id===id);if(!option)return;storyPlayer.choiceSelected=id;if(!storyPlayer.choices.some(entry=>entry.step===storyPlayer.index&&entry.id===id))storyPlayer.choices.push({step:storyPlayer.index,id});audio.play('story');updateUI();if(!storyPlayer.replay)persist();}
function sequenceStories(ids,after,destination=after===showBriefing?'briefing':'play',{skipSeen=true}={}){const queue=[...ids];const next=()=>{if(queue.length){const id=queue.shift();beginStory(id,next,{following:queue,destination,skipSeen});}else after();};next();}
function restoreStory(savedStory){
 if(!savedStory)return;
 const after=()=>sequenceStories(savedStory.following,()=>{if(savedStory.destination==='briefing')showBriefing();else if(savedStory.destination==='result'){updateUI();ui.show('campaign-result',{core:core.view()});}else resumePlay();},savedStory.destination);
 beginStory(savedStory.sceneId,after,{following:savedStory.following,destination:savedStory.destination,restore:savedStory});
}
function showBriefing(){input.clear();core.setPaused(true);updateUI();ui.show('briefing',{core:core.view(),chapter:core.view().chapter});}
function playChapterIntro(){
 pendingChapterIntro=false;
 const chapter=core.view().chapter;if(!chapter){resumePlay();return;}
 if(chapter.number===1){beginStory('departure',resumePlay,{skipSeen:false});return;}
 const scenes=chapter.number===2?['claude-join']:chapter.number===3?['glm-join']:[];
 scenes.push(`chapter${chapter.number}-briefing`);sequenceStories(scenes,showBriefing,'briefing',{skipSeen:false});
}
function resumePlay(){if(!world){showTitle();return;}if(mustStayPaused()){core.setPaused(true);updateUI();ui.show('pause');return;}
 if(pendingChapterIntro){playChapterIntro();return;}
 core.setPaused(false);input.clear();accumulator=0;lastFrame=performance.now();updateUI();ui.show('none');audio.setPaused(false);}
function worldEvent(type,payload={}){
 lesson?.handleEvent(type,payload);
 if(type==='toast')announce(payload.text,/警戒|受击|撤离|失败/.test(payload.text)?2:/完成|交付|回程|维护舱|装载/.test(payload.text)?1:0);
 if(type==='evacuation-status'){
  if(evacuationVoiceTick++%2)audio.playVoice('grok','evacuate');else audio.playVoice('hero','evacuate');
  if(payload.notice)announce(payload.notice,1);}
 if(type==='sound'){audio.play(payload.name);
  if(payload.name==='command-confirm'&&payload.teammate)audio.playVoice(payload.teammate,'confirm');
  else if(payload.name==='pickup')audio.playVoice('hero','encourage');
  else if(payload.name==='alarm')audio.playVoice('claude','alert');
  else if(payload.name==='delivery')audio.playVoice('grok','pickup');
  else if(payload.name==='guard-warning')audio.playVoice('claude','careful');}
 if(type==='dialogue'&&['none','command'].includes(ui.screen)&&!world?.scanWarning)ui.dialogue(payload.character,payload.text);
 // A pickup changes the backpack and is not replayed by any other checkpoint,
 // so snapshot it immediately: dying before the next boat trip used to erase
 // everything collected in this room without telling the player.
 if(type==='pickup')makeCheckpoint((world?.currentRoom?.name||'房间')+' · 拾取后');
 if(type==='checkpoint')makeCheckpoint(payload.label||'中途检查点');
 if(type==='record'){const row=normalizedRecord(payload);archive.records.push(row);archive.records=archive.records.slice(-300);}
 if(type==='command-receipt'&&(payload.training||payload.budgetSource==='training'))trainingUsed=true;
 if(type==='command-receipt'&&!payload.failed&&!chapterOrderPlayed){chapterOrderPlayed=true;audio.playVoice('hero','confirm');}
 if(type==='command-receipt'&&mode==='campaign'&&!grokJoinPlayed&&core.view().chapter?.number===1&&payload.teammate==='Grok'
   &&!payload.failed&&(payload.affected?.barriers||[]).some(id=>id==='paper-window'&&world?.barriers.some(barrier=>barrier.id===id&&barrier.broken))){
  grokJoinPlayed=true;beginStory('grok-join',resumePlay);
 }
 if(type==='room-change'){input.clear();makeCheckpoint(payload.room?.name||world.currentRoom?.name||'房间入口');audio.play('door');}
 if(type==='analysis-open'){
  audio.playVoice('claude','analyze');
  openOverlay('analysis',{vulnerability:core.vulnerabilityState()});persist();
 }
 if(type==='chapter-result'){audio.playMusic('results');audio.stopAmbience('harbor');audio.stopAmbience('alarm');audio.stopAmbience('ops');audio.playVoice('grok','cheer');input.clear();lesson?.handleEvent('chapter-result',{complete:true});archive.records=records();saveArchive(storage,archive);
  const view=core.view();if(mode!=='demo'&&contractId==='standard'&&(mode==='challenge'||settings.tacticalPause===false))best=recordBest(storage,best,view.pendingResult);
  // The delivery toast is still on screen when the boat boards; drop it so it
  // does not float over the score card in the result layout.
  updateUI();ui.resetFeedback?.();ui.show('chapter-result',{core:view,result:view.pendingResult,mode,cooperation:payload.cooperation});}
}
async function startWorld({state=null,showIntro=true,resumeCheckpoint=null}={}){
 const view=core.view();if(!view.chapter){world=null;tutorial=null;lesson=null;checkpoint=null;updateUI();beginStory('epilogue',()=>{updateUI();ui.show('campaign-result',{core:core.view()});},{destination:'result'});return;}
 const request=++loadSequence;busy=true;pauseAfterLoad=mustStayPaused();input.clear();ui.resetFeedback?.();setLoading(.05,`正在展开「${view.chapter.name}」…`);
 const keys=sceneImageKeys(view.chapter);
 let recoveryNotice='';
 try{
  await assets.preload(keys,p=>{if(request===loadSequence&&busy)setLoading(.1+p*.85,`正在展开「${view.chapter.name}」…`);});if(request!==loadSequence)return;
  const contract=createContract(mode==='challenge'?contractId:'standard',{seed:'whale-v3',chapter:view.chapter.id});
  if(!state&&contract.rules.qualifierLimit!==null)core.configureAttempt({qualifiers:Math.min(view.chapter.qualifiers,contract.rules.qualifierLimit)});
  lesson=null;tutorial=null;
  const trainingCredits={Claude:mode==='campaign'&&view.chapter.number===2&&!state?.trainingUsed?1:0};
  world=new GameWorld(core,getMap(view.chapter.id),{onEvent:worldEvent,expanded:true,compilePrompt,contract,trainingCredits});renderer??=new GameRenderer(canvas,assets);
  if(state){const restored=world.restoreState(state.world);if(!restored.ok){
    // A stale V3 room snapshot must never strand the player on the failure screen.
    // Keep the campaign checkpoint and restart this chapter from its safe entrance.
    // A fresh room must be paired with a fresh attempt. Retaining old cargo,
    // completed commands or evacuation state would mix incompatible worlds.
    core.retryChapter('incompatible-checkpoint',{count:false});clearChapterRecords(view.chapter.id);
    if(contract.rules.qualifierLimit!==null)core.configureAttempt({qualifiers:Math.min(view.chapter.qualifiers,contract.rules.qualifierLimit)});
    state=null;resumeCheckpoint=null;
    world=new GameWorld(core,getMap(view.chapter.id),{onEvent:worldEvent,expanded:true,compilePrompt,contract,
      trainingCredits:{Claude:mode==='campaign'&&view.chapter.number===2?1:0}});
    recoveryNotice='本次房间检查点与当前版本不兼容，已从本章入口恢复。';
  }}
  tutorial=new TutorialDirector({chapter:view.chapter.id,enabled:mode==='campaign'});if(state?.tutorial)tutorial.restore(state.tutorial);
  lesson=new LessonBridge({tutorial,world});trainingUsed=state?.trainingUsed||false;preparationSeen=core.view().attempt.remoteReady;
  checkpoint=resumeCheckpoint||null;failure=null;promptError=null;overlayStack=[];noticeQueue=[];chapterOrderPlayed=false;evacuationVoiceTick=0;
  if(recoveryNotice)announce(recoveryNotice,1);
  accumulator=0;lastFrame=performance.now();core.setPaused(false);updateUI();setLoading(1);busy=false;
  if(!checkpoint)makeCheckpoint(world.currentRoom?.name||'本章入口');
  audioScene=view.chapter.number===5?'evacuation':view.chapter.number===4?'investigation':'harbor';audio.setScene(audioScene);
  pendingChapterIntro=showIntro&&mode==='campaign';
  if(showIntro&&mode==='campaign'&&view.chapter.number===4)announce('广播仍开着：交付更快（0.4s），但每次公开动作都会留下记录。到控制台关闭广播（交付变慢 1.6s），再设置返航信标。',1);
  if(showIntro&&mode==='campaign'&&view.chapter.number===5)announce('先让三名队友在远端信标到齐，装载最后资料，再确认 60 秒撤离。',1);
  if(pauseAfterLoad||mustStayPaused()){core.setPaused(true);ui.show('pause');}
  else resumePlay();
 }catch(error){if(request===loadSequence){busy=false;setLoading(1);updateUI();ui.show('failure',{message:`场景准备失败：${error.message}。可重试本章或返回菜单。`});console.error(error);}}
 finally{if(request===loadSequence)busy=false;}
}
async function newCampaign(){backupExperience(storage);clearExperience(storage);mode='campaign';contractId='standard';grokJoinPlayed=false;
 core=new GameCore({storage});checkpoint=null;world=null;tutorial=null;lesson=null;archive.records=[];await startWorld();}
async function resumeCampaign(){mode='campaign';contractId='standard';const experience=loadCampaignSave(storage).experience;
 core=experience?new GameCore({checkpoint:experience.campaign,storage,persist:false}):GameCore.resume({storage});
 if(experience?.current){const result=core.restoreRuntime(experience.current.core);if(result.ok){await startWorld({state:experience.current,showIntro:false,resumeCheckpoint:experience.checkpoint?{label:experience.checkpointLabel,snapshot:experience.checkpoint}:null});restoreStory(experience.story);return;}}
 await startWorld({showIntro:!experience});if(experience?.story&&experience.chapterId==='campaign-complete')restoreStory(experience.story);}
function resetFailedChapter(){const chapter=core.view().chapter?.id;clearChapterRecords(chapter);core.retryChapter('manual',{count:false});checkpoint=null;return startWorld({showIntro:false});}
async function retryCheckpoint(){if(!checkpoint?.snapshot){await resetFailedChapter();return;}const state=copy(checkpoint.snapshot),label=checkpoint.label;
 if(state?.core?.attempt)state.core.attempt.health=Math.max(Number(state.core.attempt.health)||0,CHECKPOINT_HEALTH_FLOOR);
 const restored=core.restoreRuntime(state.core);if(!restored.ok){await resetFailedChapter();return;}
 clearChapterRecords(core.view().chapter.id);await startWorld({state,showIntro:false,resumeCheckpoint:{label,snapshot:state}});persist();}
function setPromptCondition(type){if(type==='none'||!type){world.setCondition(null);world.setConstraint(null);return;}
 const target=conditionTarget(type);if(!target){promptError='当前房间没有适合这个等待条件的对象。';return;}
 world.setCondition({type,targetId:target.id});}
const dockCommandLesson=()=>tutorial?.chapter==='paper-window'&&tutorial.current()?.id==='grok-obstacle';
function selectCommandTarget(targetId){
 if(!world.selectTarget(targetId))return false;
 if(dockCommandLesson())tutorial.guidedInput('select-target',{teammate:world.selected,targetId});
 promptError=null;world.promptConfig.promptText='';world.promptConfig.sequence=[];return true;
}
function parsePrompt(text){const named=/grok|claude|glm/i.test(text);const result=compilePrompt({text,teammate:named?undefined:world.selected,
 targets:promptTargets(),unlockedChapter:core.view().chapter.number,qualifiers:core.view().attempt.qualifiers+(world.trainingCredits?.Claude||0)});
 if(!result.ok){promptError=result.error;audio.play('impact');return false;}promptError=null;world.setPromptPlan(result.plan);return true;}
function validateImportedRuntime(experience){
 if(!experience)return true;
 try{for(const state of [experience.current,experience.checkpoint].filter(Boolean)){
  if(JSON.stringify(state.core.checkpoint)!==JSON.stringify(experience.campaign))return false;
  const probe=new GameCore({checkpoint:experience.campaign,storage:null,persist:false});if(!probe.restoreRuntime(state.core).ok)return false;
  const testWorld=new GameWorld(probe,getMap(experience.chapterId),{expanded:true,compilePrompt});if(!testWorld.restoreState(state.world).ok)return false;
  if(state.tutorial){const director=new TutorialDirector({chapter:experience.chapterId});if(!director.restore(state.tutorial).ok)return false;}
 }return true;}catch{return false;}
}
async function act(action,payload={}){
 if(action==='lost-focus'&&busy){pauseAfterLoad=true;input.reset();return;}if(busy&&!['mute','settings-change'].includes(action))return;
 if(action!=='lost-focus')audio.unlock();
 if(UI_CLICK_ACTIONS.has(action))audio.play('ui');
 switch(action){
  case 'new-game':if(saveSummary().hasSave){input.clear();core.setPaused(true);updateUI();ui.show('confirm-new');}else await newCampaign();break;
  case 'new-game-confirm':await newCampaign();break;case 'new-game-cancel':showTitle();break;
  case 'resume':await resumeCampaign();break;
  case 'pause':if(ui.screen==='command'){world.cancelPreview();promptError=null;resumePlay();}
   else if(ui.screen==='pause')resumePlay();else if(ui.screen==='none'&&world){input.clear();core.setPaused(true);persist();updateUI();ui.show('pause');}
   else if(ui.screen==='story')nextStory();else overlayBack();break;
  case 'lost-focus':input.reset();audio.setPaused(true);if(['none','command'].includes(ui.screen)&&world){world.cancelPreview();core.setPaused(true);persist();updateUI();ui.show('pause');}break;
  case 'resume-play':resumePlay();break;case 'retry':await resetFailedChapter();break;case 'retry-checkpoint':await retryCheckpoint();break;
  case 'continue':if(mode==='campaign'){const result=core.continueCampaign();if(result.ok){checkpoint=null;world=null;tutorial=null;lesson=null;persist();await startWorld();}}else showChapters(mode==='demo');break;
  // The after-action report is a sub-view of the settlement screen. Rebuild the
  // payload from the live world so the cards always match this exact run.
  case 'battle-report-open':ui.show('chapter-result',{...ui.payload,report:true,cooperation:world?.cooperationSummary?.()||ui.payload.cooperation});break;
  case 'battle-report-back':ui.show('chapter-result',{...ui.payload,report:false});break;
  case 'title':showTitle();break;case 'help':openOverlay('help',{from:ui.screen});break;
  case 'chapter-select':showChapters();break;case 'demo-select':showChapters(true);break;
  case 'contracts-open':selectedChapterId=payload.chapterId;contractId='standard';openOverlay('contracts',{chapterId:payload.chapterId});break;
  case 'contract-select':if(createContract(payload.contractId)){contractId=payload.contractId;updateUI();}break;
  case 'challenge-start':case 'demo-start':{
   const map=getMap(payload.chapterId);if(!map)return;
   if(action==='challenge-start'&&CHAPTERS.find(c=>c.id===map.id).number>unlocked()){ui.toast('完成前一章后解锁。');return;}
   mode=action==='demo-start'?'demo':'challenge';contractId=action==='demo-start'?'standard':payload.contractId||contractId;
   core=new GameCore({checkpoint:chapterCheckpoint(map.id),storage:null,persist:false});checkpoint=null;world=null;await startWorld({showIntro:false});break;}
  case 'settings-open':openOverlay('settings',{from:payload.from||ui.screen});break;
  case 'settings-back':case 'overlay-back':overlayBack();break;
  case 'settings-change':{const result=updateSetting(settings,payload.key,payload.value);if(result.ok){settings=result.settings;applySettings();}else ui.toast(result.error);break;}
  case 'story-style':{const result=updateSetting(settings,'storyStyle',payload.style);if(result.ok){settings=result.settings;saveSettings(storage,settings);preloadStoryFrames();updateUI();if(storyPlayer)ui.show('story');}else ui.toast(result.error);break;}
  case 'settings-reset':settings=normalizeSettings();applySettings();ui.show('settings');break;
  case 'bind-key':bindingAction=payload.action;input.listenForBinding(bindingAction);updateUI();break;
  case 'binding-captured':{bindingAction=null;if(!payload.cancelled){const result=setBinding(settings,payload.action,payload.code);if(result.ok){settings=result.settings;applySettings();}else ui.toast(result.error);}updateUI();break;}
  case 'save-export':{persist();const text=exportSave(storage);const blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='鲸鱼魔盗团-航程存档.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);ui.toast('存档已导出到浏览器下载目录。');break;}
  case 'save-import':{const result=parseSave(payload.text);if(!result.ok){ui.toast(result.error);break;}
   if(!validateImportedRuntime(result.experience)){ui.toast('检查点内容不完整，原存档已保留。');break;}
   const imported=importSave(storage,result);if(!imported.ok){ui.toast('导入失败：无法写入浏览器存储，原存档已保留。请释放存储空间或检查浏览器存储权限。');break;}
   archive=imported.archive;
   world=null;tutorial=null;lesson=null;mode='campaign';core=new GameCore({checkpoint:result.campaign,storage,persist:false});checkpoint=null;overlayStack=[];showTitle({save:false});ui.toast('导入完成，点击继续航程。');break;}
  case 'archive-open':openOverlay('archive');break;case 'records-open':openOverlay('records');break;case 'map-open':if(world)openOverlay('map',{rooms:world.rooms});break;
  case 'route-toggle':if(world){world.showGuidanceRoute=!world.showGuidanceRoute;updateUI();}break;
  case 'analysis-open':if(world){openOverlay('analysis',{vulnerability:core.vulnerabilityState()});}break;
  case 'analysis-analyze':{const result=core.analyzeVulnerability(payload.clueId,'summarize');if(!result.ok)ui.toast(result.reason==='insufficient-analysis-tokens'?'分析 Token 不足，请先收集证据或返回行动。':'这条证据还不能分析。');else{world?.addRecord?.('vulnerability-analysis',{clueId:payload.clueId,outcome:result.analysis?.summary||'已完成离线摘要',public:false});persist();}updateUI();ui.show('analysis',{vulnerability:core.vulnerabilityState()});break;}
  case 'analysis-repair':{const result=core.selectVulnerabilityRepair(payload.repairId);if(!result.ok)ui.toast('该修复建议尚未解锁。');else{world?.addRecord?.('vulnerability-repair',{repairId:payload.repairId,outcome:'已采用离线修复建议，AI Token +1',public:false});ui.toast('修复建议已记录，AI Token +1。');persist();}updateUI();ui.show('analysis',{vulnerability:core.vulnerabilityState()});break;}
  case 'record-triage':{const result=chooseRecordTreatment(payload.choiceId,{records:records()});if(!result.ok){ui.toast(result.reason==='no-public-record'?'还没有可处理的公开记录。':'这条记录已经处理过了。');break;}const row=normalizedRecord({...result.record,room:world?.currentRoom?.name||''});archive.records.push(row);archive.records=archive.records.slice(-300);saveArchive(storage,archive);persist();ui.toast(result.choice.outcome);updateUI();ui.show('records');break;}
  case 'story-next':nextStory();break;case 'story-choice':storyChoice(payload.choiceId);break;case 'story-skip':finishStory();break;
  case 'story-replay':{const previous={screen:ui.screen,payload:ui.payload};beginStory(payload.sceneId,()=>{updateUI();ui.show(previous.screen,previous.payload);},{replay:true});break;}
  case 'briefing-start':resumePlay();if(core.view().chapter.number===4){audio.playVoice('glm','public');beginStory('chapter4-reveal',resumePlay);}break;
  case 'tutorial-skip':tutorial?.skip();if(world){world.tutorialMarker=null;world.tutorialRoute=[];}updateUI();persist();break;
  case 'tutorial-hint':{const hint=tutorial?.hint(3);if(hint)ui.toast(hint.text);updateUI();break;}
  case 'tutorial-restart':settings.tutorialHints=true;applySettings();ui.show('help',{...ui.payload,tutorialReview:!ui.payload?.tutorialReview});break;
  case 'command-select':if(world&&['none','command'].includes(ui.screen)&&core.view().phase==='playing'){
   if(world.selectTeammate(payload.teammate)){
    if(dockCommandLesson())tutorial.guidedInput('select-teammate',{teammate:payload.teammate});
    input.clear();promptError=null;updateUI();ui.show('command',{teammate:payload.teammate});}}break;
  case 'prompt-mode':if(world){
   promptError=null;world.promptConfig.promptText='';world.promptConfig.sequence=[];world.setCondition(null);
   if(world.setPromptMode(Boolean(payload.precise))&&dockCommandLesson())tutorial.guidedInput('default-plan',{precise:Boolean(payload.precise)});updateUI();}break;
  case 'prompt-target':if(world){
   selectCommandTarget(payload.targetId);updateUI();}break;
  case 'prompt-constraint':if(world){promptError=null;world.promptConfig.promptText='';world.promptConfig.sequence=[];world.setConstraint(payload.constraintId);if(String(payload.constraintId).startsWith('wait-'))setPromptCondition(payload.constraintId.slice(5));updateUI();}break;
  case 'prompt-condition':if(world){promptError=null;world.promptConfig.promptText='';world.promptConfig.sequence=[];setPromptCondition(payload.condition);updateUI();}break;
  case 'prompt-cycle':if(world){const targets=world.map.targets.filter(t=>t.teammate===world.selected),index=targets.findIndex(t=>t.id===world.commandPreview?.targetId);selectCommandTarget(targets[(index+payload.direction+targets.length)%targets.length]?.id);updateUI();}break;
  case 'prompt-parse':if(world){parsePrompt(payload.text);updateUI();}break;
  case 'template-save':if(world?.commandPreview&&!promptError){const p=world.commandPreview,id=payload.templateId||'slot-1';
   const entry={id,name:`${p.teammate} · ${p.label}`,teammate:p.teammate,promptText:world.promptConfig.promptText||promptSentence(p),plan:copy(p.plan||{teammate:p.teammate,targetId:p.targetId,precise:p.precise,constraintId:world.promptConfig.constraintId,condition:world.promptConfig.condition})};
   archive.templates=archive.templates.filter(t=>t.id!==id);archive.templates.push(entry);archive.templates=archive.templates.slice(-3);saveArchive(storage,archive);ui.toast('已收藏到 '+id.replace('slot-','位置 '));updateUI();}break;
  case 'template-load':{const template=archive.templates.find(t=>t.id===payload.templateId)||getTemplates().find(t=>t.id===payload.templateId);if(!template){ui.toast('这个收藏位还是空的。');break;}
   if(!world||!['none','command','archive'].includes(ui.screen)){ui.toast('进入关卡后，在队友编排页载入模板。');break;}
   if(!core.view().chapter.teammates.includes(template.teammate)){ui.toast('这名队友尚未加入。');break;}
   const target=world.map.targets.find(t=>t.id===template.plan?.targetId&&t.teammate===template.teammate)||world.map.targets.find(t=>t.teammate===template.teammate);
   if(!target){ui.toast('当前房间没有适用目标。');break;}
   if(!world.selectTeammate(template.teammate))break;
   promptError=null;world.setPromptPlan({...template.plan,teammate:template.teammate,targetId:target.id,promptText:'',precise:template.plan?.precise??template.precise??false,constraintId:template.plan?.constraintId??template.constraintId??null});core.setPaused(false);overlayStack=[];updateUI();ui.show('command');ui.toast('模板已载入，请确认本房间的目标和范围。');break;}
  case 'command-confirm':if(world&&!promptError){const precise=payload.precise??world.promptConfig.precise;
   const guidedPayload=dockCommandLesson()?{teammate:world.selected,targetId:world.commandPreview?.targetId,precise}:null;
   // Lessons observe accepted actions; only world rules can reject a command.
   if(world.confirmCommand(precise)){if(guidedPayload)tutorial.guidedInput('confirm-command',guidedPayload);input.clear();updateUI();ui.show('none');}else updateUI();}break;
  case 'command-cancel':world?.cancelPreview();promptError=null;input.clear();updateUI();ui.show('none');break;
  case 'mute':settings.masterVolume=settings.masterVolume>0?0:.65;applySettings();break;
  case 'interact-released':if(world)world.mustReleaseInteract=false;break;
  case 'campaign-summary':input.clear();updateUI();ui.show('campaign-result',{campaign:core.view().campaign});break;
  case 'reduce-motion':settings.reduceMotion=!settings.reduceMotion;applySettings();break;
 }
}
canvas.addEventListener('pointerdown',event=>{audio.unlock();if(!world||ui.screen!=='command')return;const rect=canvas.getBoundingClientRect();
 const point={x:(event.clientX-rect.left)*1280/rect.width,y:(event.clientY-rect.top)*720/rect.height};
 if(dockCommandLesson()){
  const target=world.map.targets.filter(t=>t.teammate===world.selected).sort((a,b)=>Math.hypot(a.x-point.x,a.y-point.y)-Math.hypot(b.x-point.x,b.y-point.y))[0];
  if(target&&Math.hypot(target.x-point.x,target.y-point.y)<150){selectCommandTarget(target.id);updateUI();}
 }else if(world.pointAt(point.x,point.y)){promptError=null;world.promptConfig.promptText='';world.promptConfig.sequence=[];updateUI();}});
document.addEventListener('pointerdown',()=>audio.unlock(),{once:true});
window.addEventListener('beforeunload',persist);
function frame(now){requestAnimationFrame(frame);const elapsed=Math.min(.08,(now-(lastFrame||now))/1000);lastFrame=now;
  // If gameplay is supposed to be live but the world clock has not moved for
  // 0.6s, the character is frozen with no overlay. Recover instead of hanging.
  // While the page is hidden we keep the "no redraw" contract, but a *sustained*
  // hidden state still has to leave a visible pause instead of a frozen frame.
  if(world&&ui.screen==='none'&&core.view().phase==='playing'&&now-(wdAt||0)>600){
    if(document.hidden){
      if(!wdHiddenAt)wdHiddenAt=now;
      if(now-wdHiddenAt>800){core.setPaused(true);input.reset();updateUI();ui.show('pause');wdHiddenAt=0;wdAt=now;}
    }else{
      wdHiddenAt=0;const clock=world.time||0;
      if(clock<=(wdTime||0)+.05){
        // Require a sustained stall so a single slow frame burst never triggers it.
        if(!wdStallSince)wdStallSince=now;
        if(now-wdStallSince>1200){
          console.warn('[watchdog] world stalled; resuming',{screen:ui.screen,phase:core.view().phase});
          core.setPaused(false);input.clear();wdStallSince=0;
        }
      }else wdStallSince=0;
      wdTime=clock;wdAt=now;
    }
  }
  if(storyPlayer&&ui.screen==='story'&&settings.autoDialogue&&!mustStayPaused()){
  storyPlayer.elapsed+=elapsed;const step=storyPlayer.scene.steps[storyPlayer.index];
  const waitsForStart=(storyPlayer.scene.id==='prologue'||storyPlayer.scene.requiresStart)&&!storyPlayer.replay&&storyPlayer.index===storyPlayer.scene.steps.length-1;
  if(!waitsForStart&&(!step.choice||storyPlayer.choiceSelected)){if(storyPlayer.elapsed>=Math.max(step.duration||3,step.text.length/settings.textSpeed+1))nextStory();}}
 // The story, pause and menu layers leave the last gameplay frame intact.
 // Repainting four high-resolution canvases behind an opaque overlay made
 // opening a story feel sluggish, especially on integrated GPUs.
 if(world&&renderer&&['none','command'].includes(ui.screen)&&!document.hidden){
  const commandPaused=ui.screen==='command'&&mode!=='challenge'&&settings.tacticalPause;
  if(!busy&&['none','command'].includes(ui.screen)&&core.view().phase==='playing'&&!commandPaused){accumulator+=elapsed;let count=0;
   while(accumulator>=1/60&&count++<6){const before=core.view().attempt;const result=world.update(1/60,input.sample());input.consume();accumulator-=1/60;
    if(settings.interactionMode==='toggle'&&world.mustReleaseInteract)input.releaseInteraction();
    if(result?.rebuild){tutorial?.tick(0,{failed:true});failure={reason:core.view().failuresThisChapter.at(-1)?.reason||'health-depleted',location:world.currentRoom?.name};input.clear();core.setPaused(true);ui.resetFeedback();updateUI();ui.show('failure',{failure});audio.playMusic('failure');audio.stopAmbience('harbor');audio.stopAmbience('alarm');audio.stopAmbience('ops');audio.setPaused(false);accumulator=0;break;}
    const afterUpdate=core.view().attempt;
    // Damage protection permits at most one real hit in a fixed update. A
    // health drop therefore counts once, including a fall back to the dock.
    const failed=afterUpdate?.attemptId===before?.attemptId&&afterUpdate.health<before.health;
    const observed=lesson?.observe(world,1/60);tutorial?.tick(1/60,{active:ui.screen==='none',progress:observed?.progress,failed,focused:!document.hidden});
    if(lesson){world.tutorialMarker=settings.tutorialHints?lesson.getMarker():null;world.tutorialRoute=settings.tutorialHints?lesson.getRoute?.()||[]:[];}
    const after=core.view().attempt;
    if(after?.deliveryIds.length>before.deliveryIds.length)makeCheckpoint(world.currentRoom?.name+' · 交付完成');
    if(after?.remoteReady&&!preparationSeen&&ui.screen==='none'){preparationSeen=true;beginStory('chapter5-preparation',resumePlay);break;}
   }
  }else accumulator=0;
  // Physics already runs at 60 Hz. Avoid drawing the four large scene layers
  // at 120/144/180 Hz in standard mode; high quality retains native refresh.
  if(settings.quality==='high'||now>=nextRenderAt-.25){
   renderer.render(world,core.view(),{reduceMotion:settings.reduceMotion,reduceFlashes:settings.reduceFlashes,quality:settings.quality});
   nextRenderAt=settings.quality==='high'||now-nextRenderAt>=1000/60?now+1000/60:nextRenderAt+1000/60;
  }
 }else nextRenderAt=now;
 if(now-lastUI>75){updateUI();lastUI=now;flushNotices(now);if(world&&['none','command'].includes(ui.screen)){const high=(core.view().attempt?.alert||0)>=70;if(high&&!audio.alertHigh)audio.playVoice('glm','warn');audio.setAlertHigh(high);}}
 if(now-lastAutosave>12000&&mode==='campaign'&&world&&core.view().phase==='playing'&&ui.screen==='none'){persist();lastAutosave=now;}
}
async function bootstrap(){busy=true;
 try{setLoading(.1,'正在打开海底航图…');const url=new URL('assets/runtime-catalog.json',document.baseURI);
  const catalog=globalThis.__CATALOG__??await (async()=>{const response=await fetch(url);if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json();})();
  assets=new AssetLibrary(catalog,url);setLoading(1);updateUI();ui.show('title',saveSummary());requestAnimationFrame(frame);
 }catch(error){setLoading(1);updateUI();ui.show('failure',{message:'资源读取失败，请通过启动器打开游戏。'});console.error(error);}finally{busy=false;}}
void bootstrap();

