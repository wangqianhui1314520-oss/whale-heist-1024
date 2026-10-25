import { normalizeCheckpoint,loadCheckpoint } from './storage.mjs';
import { CHAPTERS } from './chapters.mjs';
import { STORY_SCENES } from '../game/story.mjs';
export const EXPERIENCE_KEY='whale-heist:experience:v2';
export const BACKUP_KEY='whale-heist:experience:backup:v2';
export const ARCHIVE_KEY='whale-heist:archive:v3';
const MAX_BYTES=2500000;
const clone=value=>JSON.parse(JSON.stringify(value));
export function normalizeExperience(raw){
  if(!raw||raw.version!==2||!normalizeCheckpoint(raw.campaign)||typeof raw.chapterId!=='string')return null;
  const chapterId=raw.campaign.campaign.completed?'campaign-complete':CHAPTERS[raw.campaign.campaign.results.length]?.id;
  if(raw.chapterId!==chapterId)return null;
  const safe={version:2,savedAt:typeof raw.savedAt==='string'?raw.savedAt:'',chapterId:raw.chapterId,
    campaign:normalizeCheckpoint(raw.campaign),checkpointLabel:String(raw.checkpointLabel||'本章入口').slice(0,80),
    current:null,checkpoint:null,story:null,contractId:typeof raw.contractId==='string'?raw.contractId:'standard'};
  for(const field of ['current','checkpoint']){
    const snap=raw[field];if(snap&&snap.core?.version===2&&normalizeCheckpoint(snap.core.checkpoint)
      &&snap.core.attempt?.chapterId===raw.chapterId&&snap.world&&typeof snap.world==='object')safe[field]=clone(snap);
  }
  const story=raw.story,source=STORY_SCENES[story?.sceneId];
  if(source&&source.chapter===(CHAPTERS.find(chapter=>chapter.id===chapterId)?.number||5)
    &&Number.isInteger(story.index)&&story.index>=0&&story.index<100
    &&Array.isArray(story.choices)&&story.choices.length<=20
    &&story.choices.every(entry=>entry&&Number.isInteger(entry.step)&&entry.step>=0&&typeof entry.id==='string'&&entry.id.length<100)
    &&Array.isArray(story.following)&&story.following.length<=5&&story.following.every(id=>STORY_SCENES[id]?.chapter===source.chapter)
    &&['play','briefing','result'].includes(story.destination))safe.story=clone(story);
  return safe;
}
export function loadExperience(storage){
  try{const text=storage?.getItem(EXPERIENCE_KEY);if(!text)return {ok:false,reason:'missing',value:null};
    if(text.length>MAX_BYTES)return {ok:false,reason:'oversized',value:null};
    const value=normalizeExperience(JSON.parse(text));return value?{ok:true,value}:{ok:false,reason:'invalid',value:null};
  }catch{return {ok:false,reason:'unavailable',value:null};}
}
export function saveExperience(storage,value){
  const safe=normalizeExperience(value);if(!safe)return false;
  try{const text=JSON.stringify(safe);if(text.length>MAX_BYTES)return false;storage?.setItem(EXPERIENCE_KEY,text);return Boolean(storage);}catch{return false;}
}
export function backupExperience(storage){try{const current=storage?.getItem(EXPERIENCE_KEY);if(current)storage.setItem(BACKUP_KEY,current);return true;}catch{return false;}}
export function clearExperience(storage){try{storage?.removeItem(EXPERIENCE_KEY);return true;}catch{return false;}}
export function loadArchive(storage){
  const safe={version:3,seenStories:[],records:[],templates:[]};
  try{const raw=JSON.parse(storage?.getItem(ARCHIVE_KEY)||'{}');
    if(Array.isArray(raw.seenStories))safe.seenStories=[...new Set(raw.seenStories.filter(x=>typeof x==='string'&&x.length<100))].slice(-100);
    if(Array.isArray(raw.records))safe.records=raw.records.filter(x=>x&&typeof x==='object'&&typeof x.type==='string').slice(-300);
    if(Array.isArray(raw.templates))safe.templates=raw.templates.filter(x=>x&&typeof x.id==='string'&&typeof x.promptText==='string'&&x.promptText.length<500).slice(-3);
  }catch{}return safe;
}
export function saveArchive(storage,value){try{storage?.setItem(ARCHIVE_KEY,JSON.stringify({version:3,seenStories:value.seenStories.slice(-100),records:value.records.slice(-300),templates:value.templates.slice(-3)}));return true;}catch{return false;}}
export function exportSave(storage){
  const exp=loadExperience(storage),legacy=loadCheckpoint(storage);
  return JSON.stringify({format:'whale-heist-save',version:2,experience:exp.value,campaign:exp.value?.campaign||legacy.checkpoint,archive:loadArchive(storage)},null,2);
}
export function parseSave(text){
  try{if(typeof text!=='string'||text.length>MAX_BYTES)return {ok:false,error:'存档过大或格式不正确。'};
    const raw=JSON.parse(text);if(raw.format!=='whale-heist-save'||raw.version!==2)return {ok:false,error:'存档版本不支持。'};
    const campaign=normalizeCheckpoint(raw.campaign);if(!campaign)return {ok:false,error:'主线存档校验未通过。'};
    const experience=raw.experience?normalizeExperience(raw.experience):null;
    if(raw.experience&&!experience)return {ok:false,error:'检查点存档校验未通过。'};
    if(experience&&JSON.stringify(experience.campaign)!==JSON.stringify(campaign))return {ok:false,error:'主线与检查点的航程不一致。'};
    return {ok:true,campaign,experience,archive:raw.archive};
  }catch{return {ok:false,error:'不是有效的游戏 JSON 存档。'};}
}
