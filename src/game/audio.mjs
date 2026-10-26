// GameAudio: asset-backed audio for 鲸鱼魔盗团.
// BGM / ambience / SFX / voice MP3s live under assets/audio/ and are fetched and
// decoded lazily on first use. When a buffer is missing or still loading, short
// effects degrade to the procedural synth below instead of failing silently;
// music and voice simply wait for their buffer. All legacy entry points
// (unlock/configure/setMuted/setScene/setPaused/play/dispose) keep their shape.

const SFX_FILES={
  dash:'sfx/dash.mp3',impact:'sfx/impact.mp3',pickup:'sfx/pickup.mp3',delivery:'sfx/delivery.mp3',
  'command-confirm':'sfx/command-confirm.mp3',alarm:'sfx/alarm.mp3',results:'sfx/results.mp3',jump:'sfx/jump.mp3',
  ui:'sfx/ui.mp3',door:'sfx/door.mp3',story:'sfx/story.mp3','story-page':'sfx/story-page.mp3',
  'story-scan':'sfx/story-scan.mp3','story-impact':'sfx/story-impact.mp3','story-alert':'sfx/story-alert.mp3',
  'story-beacon':'sfx/story-beacon.mp3'};
const MUSIC_FILES={
  title:'music/bgm_title.mp3',harbor:'music/bgm_harbor.mp3',investigation:'music/bgm_investigation.mp3',
  evacuation:'music/bgm_evacuation.mp3',results:'music/bgm_results.mp3',failure:'music/bgm_failure.mp3',
  story:'music/bgm_story.mp3'};
const AMBIENCE_FILES={harbor:'ambience/amb_harbor.mp3',ops:'ambience/amb_ops.mp3',alarm:'ambience/amb_alarm.mp3'};
const VOICE_FILES={
  hero_confirm:'voice/voice_hero_confirm.mp3',hero_charge:'voice/voice_hero_charge.mp3',hero_encourage:'voice/voice_hero_encourage.mp3',
  hero_evacuate:'voice/voice_hero_evacuate.mp3',hero_scan:'voice/voice_hero_scan.mp3',
  grok_confirm:'voice/voice_grok_confirm.mp3',grok_charge:'voice/voice_grok_charge.mp3',grok_cheer:'voice/voice_grok_cheer.mp3',
  grok_evacuate:'voice/voice_grok_evacuate.mp3',grok_pickup:'voice/voice_grok_pickup.mp3',
  claude_confirm:'voice/voice_claude_confirm.mp3',claude_alert:'voice/voice_claude_alert.mp3',claude_analyze:'voice/voice_claude_analyze.mp3',
  claude_careful:'voice/voice_claude_careful.mp3',claude_record:'voice/voice_claude_record.mp3',
  glm_confirm:'voice/voice_glm_confirm.mp3',glm_public:'voice/voice_glm_public.mp3',glm_route:'voice/voice_glm_route.mp3',
  glm_scan:'voice/voice_glm_scan.mp3',glm_warn:'voice/voice_glm_warn.mp3'};
const ROLE_VOICES={Grok:'grok',Claude:'claude',GLM:'glm',hero:'hero'};
const VOICE_COOLDOWN_MS=8000,ENCOURAGE_COOLDOWN_MS=6000;

// Procedural fallback for the 16 legacy triggers when a file is unavailable.
const SYNTH_PRESETS={
  dash:[440,120,.18,'sine'],impact:[120,45,.13,'triangle'],pickup:[700,1200,.12,'sine'],delivery:[520,1040,.25,'sine'],
  'command-confirm':[330,660,.16,'triangle'],alarm:[720,400,.3,'square'],results:[523,1046,.5,'sine'],jump:[240,420,.09,'sine'],
  ui:[500,620,.07,'sine'],door:[180,360,.28,'triangle'],story:[520,780,.1,'sine'],
  'story-page':[620,980,.16,'sine'],'story-scan':[260,760,.22,'triangle'],
  'story-impact':[110,55,.18,'sawtooth'],'story-alert':[740,280,.28,'square'],
  'story-beacon':[440,880,.24,'sine']};

export class GameAudio {
  constructor(){
    this.muted=false;this.context=null;this.scene='title';this.paused=false;this.alertHigh=false;
    this.settings={masterVolume:.65,sfxVolume:.8,musicVolume:.25,ambienceVolume:.8,voiceVolume:.8};
    this.buffers=new Map();this.pending=new Map();this.voiceCooldown=new Map();
    this.musicId=null;this.musicNode=null;this.musicGain=null;
    this.ambience=new Map();
  }
  urlOf(relative){return new URL('../../assets/audio/'+relative,import.meta.url).href;}
  getBuffer(url){
    if(this.buffers.has(url))return Promise.resolve(this.buffers.get(url));
    if(this.pending.has(url))return this.pending.get(url);
    const request=fetch(url).then(response=>{
      if(!response.ok)throw new Error('HTTP '+response.status);
      return response.arrayBuffer();
    }).then(data=>{
      if(!this.context)throw new Error('audio-not-unlocked');
      return this.context.decodeAudioData(data);
    }).then(buffer=>{this.buffers.set(url,buffer);this.pending.delete(url);return buffer;})
      .catch(error=>{this.pending.delete(url);throw error;});
    this.pending.set(url,request);return request;
  }
  preload(){
    if(!this.context)return;
    for(const table of [SFX_FILES,MUSIC_FILES,AMBIENCE_FILES,VOICE_FILES])
      for(const relative of Object.values(table))this.getBuffer(this.urlOf(relative)).catch(()=>{});
  }
  unlock(){
    try{
      if(!this.context){
        this.context=new (globalThis.AudioContext||globalThis.webkitAudioContext)();
        this.master=this.context.createGain();this.sfx=this.context.createGain();
        this.music=this.context.createGain();this.ambienceBus=this.context.createGain();
        this.voice=this.context.createGain();
        this.sfx.connect(this.master);this.music.connect(this.master);
        this.ambienceBus.connect(this.master);this.voice.connect(this.master);
        this.master.connect(this.context.destination);this.applyVolumes();
      }
      if(this.context.state==='suspended')this.context.resume().catch(()=>{});
      this.preload();
    }catch{}
  }
  configure(settings){
    this.settings={masterVolume:.65,sfxVolume:.8,musicVolume:.25,ambienceVolume:.8,voiceVolume:.8,...(settings||{})};
    this.muted=this.settings.masterVolume===0;this.applyVolumes();
  }
  setMuted(value){this.muted=Boolean(value);this.applyVolumes();}
  setScene(scene){
    this.scene=scene||'title';
    const music={title:'title',harbor:'harbor',investigation:'investigation',evacuation:'evacuation'}[this.scene];
    const harbor=this.scene==='harbor'||this.scene==='investigation';
    if(music)this.playMusic(music);
    // Chapters 1-4 run the harbor bed with the server-room hum layered on top
    // (audio design: indoor scenes overlay amb_ops); evacuation and menu
    // scenes keep the bed only.
    if(harbor){this.playAmbience('harbor');this.playAmbience('ops');}
    else{this.stopAmbience('harbor');this.stopAmbience('ops');}
    if(!this.alertHigh)this.stopAmbience('alarm');
  }
  setAlertHigh(high){
    this.alertHigh=Boolean(high);
    if(this.alertHigh)this.playAmbience('alarm');else this.stopAmbience('alarm');
  }
  setPaused(value){this.paused=Boolean(value);this.applyVolumes();}
  applyVolumes(){
    if(!this.context)return;
    const t=this.context.currentTime;
    this.master.gain.setTargetAtTime(this.muted?0:this.settings.masterVolume,t,.04);
    this.sfx.gain.setTargetAtTime(this.settings.sfxVolume,t,.04);
    this.voice.gain.setTargetAtTime(this.settings.voiceVolume??.8,t,.04);
    this.music.gain.setTargetAtTime(this.paused?0:this.settings.musicVolume,t,.15);
    this.ambienceBus.gain.setTargetAtTime(this.paused?0:(this.settings.ambienceVolume??.8),t,.15);
  }
  swapMusic(buffer){
    const c=this.context;if(!c)return;
    if(this.musicNode){try{this.musicNode.stop();}catch{}this.musicNode.disconnect();this.musicNode=null;}
    if(this.musicGain){this.musicGain.disconnect();this.musicGain=null;}
    const node=c.createBufferSource();node.buffer=buffer;node.loop=true;
    const gain=c.createGain();gain.gain.setValueAtTime(.0001,c.currentTime);
    gain.gain.exponentialRampToValueAtTime(1,c.currentTime+1.4);
    node.connect(gain);gain.connect(this.music);
    node.start();
    this.musicNode=node;this.musicGain=gain;
  }
  playMusic(id){
    const file=MUSIC_FILES[id];if(!file)return;
    if(this.musicId===id&&this.musicNode)return;
    this.musicId=id;
    const url=this.urlOf(file),ready=this.buffers.get(url);
    if(ready){this.swapMusic(ready);return;}
    this.getBuffer(url).then(buffer=>{if(this.musicId===id)this.swapMusic(buffer);})
      .catch(()=>{if(this.musicId===id)this.musicId=null;});
  }
  startAmbience(id,buffer){
    const c=this.context;if(!c)return;
    const node=c.createBufferSource();node.buffer=buffer;node.loop=true;
    const gain=c.createGain();gain.gain.setValueAtTime(.0001,c.currentTime);
    gain.gain.exponentialRampToValueAtTime(1,c.currentTime+1.4);
    node.connect(gain);gain.connect(this.ambienceBus);
    node.start();
    this.ambience.set(id,{node,gain});
  }
  playAmbience(id){
    const file=AMBIENCE_FILES[id];if(!file)return;
    if(this.ambience.has(id))return;
    const url=this.urlOf(file),ready=this.buffers.get(url);
    if(ready){this.startAmbience(id,ready);return;}
    this.getBuffer(url).then(buffer=>{if(!this.ambience.has(id))this.startAmbience(id,buffer);}).catch(()=>{});
  }
  stopAmbience(id){
    const entry=this.ambience.get(id);if(!entry)return;
    this.ambience.delete(id);
    const c=this.context;if(!c)return;
    entry.gain.gain.setTargetAtTime(.0001,c.currentTime,.25);
    setTimeout(()=>{try{entry.node.stop();}catch{}entry.node.disconnect();entry.gain.disconnect();},700);
  }
  playVoice(roleOrKey,kind){
    if(this.muted||!this.context||this.context.state!=='running')return;
    const role=ROLE_VOICES[roleOrKey]||roleOrKey;
    const key=kind?`${role}_${kind}`:roleOrKey;
    const file=VOICE_FILES[key];if(!file)return;
    const now=performance.now(),until=this.voiceCooldown.get(key)||0;
    if(now<until)return;
    this.voiceCooldown.set(key,now+(key==='hero_encourage'?ENCOURAGE_COOLDOWN_MS:VOICE_COOLDOWN_MS));
    const url=this.urlOf(file),buffer=this.buffers.get(url);
    if(buffer){this.trigger(buffer,this.voice);return;}
    this.getBuffer(url).then(loaded=>{if(!this.muted)this.trigger(loaded,this.voice);}).catch(()=>{});
  }
  trigger(buffer,bus){
    const c=this.context;if(!c||c.state!=='running')return;
    const source=c.createBufferSource();source.buffer=buffer;
    source.connect(bus);source.start();
    source.onended=()=>{try{source.disconnect();}catch{}};
  }
  play(name){
    if(this.muted||!this.context||this.context.state!=='running')return;
    const file=SFX_FILES[name];
    if(file){
      const url=this.urlOf(file),buffer=this.buffers.get(url);
      if(buffer){this.trigger(buffer,this.sfx);return;}
      this.getBuffer(url).then(loaded=>{if(!this.muted)this.trigger(loaded,this.sfx);})
        .catch(()=>this.synth(name));
      return;
    }
    this.synth(name);
  }
  synth(name){
    const preset=SYNTH_PRESETS[name]||SYNTH_PRESETS.pickup;
    const [from,to,duration,type]=preset,c=this.context,now=c.currentTime;
    const oscillator=c.createOscillator(),gain=c.createGain();oscillator.type=type;
    oscillator.frequency.setValueAtTime(from,now);oscillator.frequency.exponentialRampToValueAtTime(to,now+duration);
    gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(name==='alarm'?.035:.065,now+.012);
    gain.gain.exponentialRampToValueAtTime(.001,now+duration);oscillator.connect(gain);gain.connect(this.sfx);
    oscillator.start(now);oscillator.stop(now+duration+.01);
  }
  dispose(){
    if(this.musicNode){try{this.musicNode.stop();}catch{}this.musicNode.disconnect();this.musicNode=null;}
    for(const entry of this.ambience.values()){try{entry.node.stop();}catch{}entry.node.disconnect();}
    this.ambience.clear();
    this.context?.close().catch(()=>{});this.context=null;this.buffers.clear();this.pending.clear();
  }
}
