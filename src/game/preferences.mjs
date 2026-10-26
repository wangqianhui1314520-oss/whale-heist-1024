export const SETTINGS_KEY='whale-heist:settings:v3';
export const DEFAULT_SETTINGS=Object.freeze({masterVolume:.65,sfxVolume:.8,musicVolume:.25,ambienceVolume:.8,voiceVolume:.8,subtitleScale:1,
  reduceMotion:false,reduceFlashes:false,tacticalPause:true,tutorialHints:true,touchSize:1,touchOpacity:.75,
  leftHanded:false,interactionMode:'hold',textSpeed:32,autoDialogue:false,skipSeenStory:true,storyStyle:'cinematic',quality:'standard',
  bindings:Object.freeze({left:'KeyA',right:'KeyD',up:'KeyW',down:'KeyS',jump:'Space',dash:'ShiftLeft',interact:'KeyE'})});
const ranges={masterVolume:[0,1],sfxVolume:[0,1],musicVolume:[0,1],ambienceVolume:[0,1],voiceVolume:[0,1],subtitleScale:[.85,1.6],touchSize:[.85,1.5],touchOpacity:[.3,1],textSpeed:[12,80]};
const bools=['reduceMotion','reduceFlashes','tacticalPause','tutorialHints','leftHanded','autoDialogue','skipSeenStory'];
const validCode=code=>typeof code==='string'&&/^(Key[A-Z]|Arrow(Left|Right|Up|Down)|Space|Shift(Left|Right)|Numpad[0-9])$/.test(code);
export function normalizeSettings(raw={}){
  const result={...DEFAULT_SETTINGS,bindings:{...DEFAULT_SETTINGS.bindings}};
  if(!raw||typeof raw!=='object')return result;
  for(const [key,[min,max]] of Object.entries(ranges))if(Number.isFinite(Number(raw[key])))result[key]=Math.max(min,Math.min(max,Number(raw[key])));
  for(const key of bools)if(typeof raw[key]==='boolean')result[key]=raw[key];
  if(['hold','toggle'].includes(raw.interactionMode))result.interactionMode=raw.interactionMode;
  if(['standard','low'].includes(raw.quality))result.quality=raw.quality;
  if(['cinematic','stage','comic'].includes(raw.storyStyle))result.storyStyle=raw.storyStyle;
  const used=new Set();
  for(const action of Object.keys(result.bindings)){
    const code=raw.bindings?.[action];
    if(validCode(code)&&!used.has(code))result.bindings[action]=code;
    if(used.has(result.bindings[action]))result.bindings[action]=DEFAULT_SETTINGS.bindings[action];
    used.add(result.bindings[action]);
  }
  if(new Set(Object.values(result.bindings)).size!==Object.keys(result.bindings).length)result.bindings={...DEFAULT_SETTINGS.bindings};
  return result;
}
export function loadSettings(storage){
  try{const text=storage?.getItem(SETTINGS_KEY);if(text)return normalizeSettings(JSON.parse(text));
    const legacy=JSON.parse(storage?.getItem('whale-heist:settings')||'{}');
    return normalizeSettings({reduceMotion:legacy.reduceMotion,masterVolume:legacy.muted?0:.65});
  }catch{return normalizeSettings();}
}
export function saveSettings(storage,settings){try{storage?.setItem(SETTINGS_KEY,JSON.stringify(normalizeSettings(settings)));return true;}catch{return false;}}
export function updateSetting(settings,key,value){
  if(!(key in DEFAULT_SETTINGS)||key==='bindings')return {ok:false,error:'这项设置不可用。'};
  if(key in ranges){const number=Number(value);if(!Number.isFinite(number))return {ok:false,error:'请输入有效数值。'};value=number;}
  if(bools.includes(key)&&typeof value!=='boolean'){
    if(!['true','false','1','0'].includes(value))return {ok:false,error:'请选择开启或关闭。'};
    value=value==='true'||value==='1';
  }
  if(key==='interactionMode'&&!['hold','toggle'].includes(value))return {ok:false,error:'互动方式不可用。'};
  if(key==='quality'&&!['standard','low'].includes(value))return {ok:false,error:'画质选项不可用。'};
  if(key==='storyStyle'&&!['cinematic','stage','comic'].includes(value))return {ok:false,error:'剧情演出风格不可用。'};
  return {ok:true,settings:normalizeSettings({...settings,[key]:value})};
}
export function setBinding(settings,action,code){
  if(!(action in DEFAULT_SETTINGS.bindings)||!validCode(code))return {ok:false,error:'请选择字母、方向键、空格、Shift 或数字小键盘。'};
  if(Object.entries(settings.bindings).some(([a,c])=>a!==action&&c===code))return {ok:false,error:'这个按键已经分配给另一个操作。'};
  return {ok:true,settings:normalizeSettings({...settings,bindings:{...settings.bindings,[action]:code}})};
}
export function keyLabel(code){return ({Space:'空格',ShiftLeft:'Shift',ShiftRight:'右 Shift',ArrowLeft:'←',ArrowRight:'→',ArrowUp:'↑',ArrowDown:'↓'})[code]||String(code).replace('Key','').replace('Numpad','小键盘 ');}
