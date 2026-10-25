import { CHAPTERS } from '../core/chapters.mjs';
import { newCheckpoint } from '../core/storage.mjs';

/** Isolated chapter sessions never share campaign storage or submit seed scores. */
export function chapterCheckpoint(chapterId){
  const index=CHAPTERS.findIndex(c=>c.id===chapterId);if(index<0)throw new Error('Unknown chapter');
  const checkpoint=newCheckpoint();
  for(let i=0;i<index;i++){
    const storyFlags=i>=3?['briefing-published','broadcast-discovered','return-beacon-ready']:['briefing-published'];
    checkpoint.campaign.results.push({chapterId:CHAPTERS[i].id,score:70,
      breakdown:{required:60,optional:0,collaboration:0,lowAlert:10},events:{publicCommands:0,publicDeliveries:0,alarms:0},
      exposureDelta:0,elapsedMs:0,failedAttempts:0,broadcastOn:i<3,storyFlags});
    checkpoint.campaign.broadcastOn=i<3;checkpoint.campaign.storyFlags=storyFlags;
  }
  return checkpoint;
}

const BEST_KEY='whale-heist:chapter-best:v1';
export function loadBest(storage){try{const raw=JSON.parse(storage?.getItem(BEST_KEY)||'{}'),safe={};
  for(const chapter of CHAPTERS){const r=raw[chapter.id];if(r&&Number.isInteger(r.score)&&r.score>=60&&r.score<=100&&Number.isFinite(r.elapsedMs)&&r.elapsedMs>=0)safe[chapter.id]={score:r.score,elapsedMs:r.elapsedMs,grade:r.score>=90?'S':r.score>=75?'A':'B'};}
  return safe;}catch{return {};}}
export function recordBest(storage,previous,result){const best={...previous},old=best[result.chapterId];
  if(!old||result.score>old.score||(result.score===old.score&&result.elapsedMs<old.elapsedMs))best[result.chapterId]={score:result.score,elapsedMs:result.elapsedMs,grade:result.score>=90?'S':result.score>=75?'A':'B'};
  try{storage?.setItem(BEST_KEY,JSON.stringify(best));}catch{}return best;}
