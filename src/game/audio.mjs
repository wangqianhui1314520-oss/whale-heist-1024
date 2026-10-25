export class GameAudio {
  constructor(){this.muted=false;this.context=null;this.settings={masterVolume:.65,sfxVolume:.8,musicVolume:.25};this.scene='harbor';this.paused=false;this.musicTimer=null;this.chord=0;}
  unlock(){try{
    if(!this.context){this.context=new (globalThis.AudioContext||globalThis.webkitAudioContext)();
      this.master=this.context.createGain();this.sfx=this.context.createGain();this.music=this.context.createGain();
      this.sfx.connect(this.master);this.music.connect(this.master);this.master.connect(this.context.destination);this.applyVolumes();}
    if(this.context.state==='suspended')this.context.resume().catch(()=>{});
    if(!this.musicTimer){this.playChord();this.musicTimer=setInterval(()=>this.playChord(),4000);}
  }catch{}}
  configure(settings){this.settings={...this.settings,...settings};this.muted=this.settings.masterVolume===0;this.applyVolumes();}
  setMuted(value){this.muted=Boolean(value);this.applyVolumes();}
  setScene(scene){this.scene=scene||'harbor';}
  setPaused(value){this.paused=Boolean(value);this.applyVolumes();}
  applyVolumes(){if(!this.context)return;const t=this.context.currentTime;
    this.master.gain.setTargetAtTime(this.muted?0:this.settings.masterVolume,t,.04);
    this.sfx.gain.setTargetAtTime(this.settings.sfxVolume,t,.04);
    this.music.gain.setTargetAtTime(this.paused?0:this.settings.musicVolume,t,.15);}
  playChord(){
    if(!this.context||this.context.state!=='running'||this.muted||this.paused||this.settings.musicVolume<=0)return;
    const pads=this.scene==='evacuation'?[[146.83,174.61,220],[130.81,164.81,196],[123.47,146.83,196],[130.81,174.61,220]]
      :[[130.81,164.81,196],[110,130.81,164.81],[87.31,130.81,174.61],[98,123.47,146.83]];
    const now=this.context.currentTime,notes=pads[this.chord++%pads.length];
    for(const [i,hz] of notes.entries()){
      const oscillator=this.context.createOscillator(),gain=this.context.createGain();oscillator.type='sine';
      oscillator.frequency.value=hz*(i===2?2:1);gain.gain.setValueAtTime(.0001,now);
      gain.gain.exponentialRampToValueAtTime(.026/(i+1),now+.8);
      gain.gain.exponentialRampToValueAtTime(.0001,now+4.7);
      oscillator.connect(gain);gain.connect(this.music);oscillator.start(now);oscillator.stop(now+4.8);
    }
  }
  play(name){
    if(this.muted||!this.context||this.context.state!=='running')return;
    const presets={dash:[440,120,.18,'sine'],impact:[120,45,.13,'triangle'],pickup:[700,1200,.12,'sine'],delivery:[520,1040,.25,'sine'],
      'command-confirm':[330,660,.16,'triangle'],alarm:[720,400,.3,'square'],results:[523,1046,.5,'sine'],jump:[240,420,.09,'sine'],
      ui:[500,620,.07,'sine'],door:[180,360,.28,'triangle'],story:[520,780,.1,'sine'],
      'story-page':[620,980,.16,'sine'],'story-scan':[260,760,.22,'triangle'],
      'story-impact':[110,55,.18,'sawtooth'],'story-alert':[740,280,.28,'square'],
      'story-beacon':[440,880,.24,'sine']};
    const [from,to,duration,type]=presets[name]||presets.pickup,c=this.context,now=c.currentTime;
    const oscillator=c.createOscillator(),gain=c.createGain();oscillator.type=type;
    oscillator.frequency.setValueAtTime(from,now);oscillator.frequency.exponentialRampToValueAtTime(to,now+duration);
    gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(name==='alarm'?.035:.065,now+.012);
    gain.gain.exponentialRampToValueAtTime(.001,now+duration);oscillator.connect(gain);gain.connect(this.sfx);
    oscillator.start(now);oscillator.stop(now+duration+.01);
  }
  dispose(){if(this.musicTimer)clearInterval(this.musicTimer);this.musicTimer=null;this.context?.close().catch(()=>{});}
}
