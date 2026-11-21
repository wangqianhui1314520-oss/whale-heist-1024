const KEYMAP={KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right',KeyW:'up',ArrowUp:'up',KeyS:'down',ArrowDown:'down',Space:'jump',ShiftLeft:'dash',ShiftRight:'dash',KeyJ:'dash',KeyE:'interact'};
export class GameInput{
  constructor({onAction=()=>{},settings={},getScreen=()=> 'none'}={}){
    this.keys=new Set();this.pointers=new Map();this.edges=new Set();this.onAction=onAction;
    this.settings=settings;this.getScreen=getScreen;this.interactToggle=false;this.bindingAction=null;
    window.addEventListener('keydown',event=>{
      if(event.ctrlKey||event.metaKey||event.altKey)return;
      if(this.bindingAction){event.preventDefault();const action=this.bindingAction;this.bindingAction=null;
        onAction('binding-captured',{action,code:event.code,cancelled:event.code==='Escape'});return;}
      if(event.target?.closest?.('input,select,textarea,[contenteditable="true"]'))return;
      const screen=this.getScreen();
      if(['story','briefing'].includes(screen)&&['Space','Enter'].includes(event.code)&&!event.target?.closest?.('button')){
        event.preventDefault();if(!event.repeat)onAction(screen==='story'?'story-next':'briefing-start');return;}
      if(screen==='command'&&['ArrowLeft','ArrowRight'].includes(event.code)){
        event.preventDefault();if(!event.repeat)onAction('prompt-cycle',{direction:event.code==='ArrowRight'?1:-1});return;}
      if(screen==='command'&&event.code==='Enter'&&!event.target?.closest?.('button')){event.preventDefault();if(!event.repeat)onAction('command-confirm');return;}
      const action=this.actionFor(event.code);
      // HUD buttons can retain focus during play. Jump must still reach the
      // character there; Space keeps its native button action in menus.
      const movement=Boolean(action)&&(['left','right','up','down','dash','interact'].includes(action)
        || action==='jump'&&screen==='none');
      if(action&&(movement||!event.target?.closest?.('button'))){event.preventDefault();if(!this.keys.has(event.code))this.edges.add(action);this.keys.add(event.code);
        if(action==='interact'&&!event.repeat&&this.settings.interactionMode==='toggle')this.interactToggle=!this.interactToggle;}
      if(!event.repeat&&event.code==='Escape'){event.preventDefault();onAction('pause');}
      if(!event.repeat&&['Digit1','Digit2','Digit3'].includes(event.code))onAction('command-select',{teammate:['Grok','Claude','GLM'][Number(event.code.at(-1))-1]});
    });
    window.addEventListener('keyup',event=>{this.keys.delete(event.code);
      // Release is authoritative: a held interaction must end the moment the key
      // is let go, even if a frame boundary was skipped while an overlay closed.
      if(this.actionFor(event.code)==='interact')onAction('interact-released',{});});
    document.addEventListener('pointerdown',event=>{
      const control=event.target?.closest?.('[data-control]');if(!control||control.disabled)return;
      event.preventDefault();const action=control.dataset.control;this.pointers.set(event.pointerId,action);this.edges.add(action);control.classList.add('held');
      if(action==='interact'&&this.settings.interactionMode==='toggle')this.interactToggle=!this.interactToggle;
      try{control.setPointerCapture(event.pointerId);}catch{}
    },{passive:false});
    const release=event=>{const action=this.pointers.get(event.pointerId);this.pointers.delete(event.pointerId);if(action&&!Array.from(this.pointers.values()).includes(action))document.querySelectorAll(`[data-control="${action}"]`).forEach(e=>e.classList.remove('held'));};
    document.addEventListener('pointerup',release);document.addEventListener('pointercancel',release);document.addEventListener('lostpointercapture',release);
    // These four are genuine focus-loss cases: no keyup will ever arrive, so the
    // held-key set has to be dropped or a key would stay stuck down forever.
    window.addEventListener('blur',()=>{this.reset();onAction('lost-focus');});
    window.addEventListener('pagehide',()=>{this.reset();onAction('lost-focus');});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){this.reset();onAction('lost-focus');}});
    const orientation=window.matchMedia('(orientation: portrait)');
    const rotated=event=>{if(event.matches){this.reset();onAction('lost-focus');}};
    if(orientation.addEventListener)orientation.addEventListener('change',rotated);
    else orientation.addListener(rotated);
  }
  actionFor(code){
    // Keep the built-in mapping as a per-key fallback. A partially populated
    // custom binding object used to disable Space/Shift/E entirely because the
    // arrow fallback only ran when no bindings existed.
    const entries=Object.entries(this.settings.bindings||{});
    const mapped=entries.find(([,c])=>c===code)?.[0];
    if(mapped)return mapped;
    return ({...KEYMAP,ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'})[code];
  }
  configure(settings){this.reset();this.settings=settings||{};}
  listenForBinding(action){this.reset();this.bindingAction=action;}
  releaseInteraction(){this.interactToggle=false;}
  // Overlay, story, pause and command transitions must NOT drop physically held
  // keys: a key that is already down never fires another keydown, so clearing
  // the held set left the character frozen once the overlay closed until the
  // player released and pressed it again. Physical key state is only unknowable
  // on genuine focus loss, which is exactly what reset() is for.
  clear(){this.pointers.clear();this.edges.clear();this.interactToggle=false;document.querySelectorAll('.held').forEach(e=>e.classList.remove('held'));}
  reset(){this.keys.clear();this.clear();}
  sample(){const held=new Set([...Array.from(this.keys).map(k=>this.actionFor(k)),...this.pointers.values()]);
    return {left:held.has('left'),right:held.has('right'),up:held.has('up'),down:held.has('down'),jump:held.has('jump'),dash:held.has('dash'),interact:this.settings.interactionMode==='toggle'?this.interactToggle:held.has('interact'),jumpPressed:this.edges.has('jump'),dashPressed:this.edges.has('dash')};}
  consume(){this.edges.clear();}
}
