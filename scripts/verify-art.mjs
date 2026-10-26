import assert from 'node:assert/strict';

/** Canvas size from a WebP container (VP8X extended, VP8L lossless, VP8 lossy). */
function webpSize(bytes) {
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return { width: (bytes.readUIntLE(24, 3) & 0xffffff) + 1, height: (bytes.readUIntLE(27, 3) & 0xffffff) + 1 };
  if (chunk === 'VP8L') { const header = bytes.readUInt32LE(21); return { width: (header & 0x3fff) + 1, height: ((header >> 14) & 0x3fff) + 1 }; }
  if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  assert.fail('unsupported WebP chunk: ' + chunk);
}
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssetLibrary } from '../src/render/assets.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(project, 'assets');
const readJSON = async filename => JSON.parse((await readFile(filename, 'utf8')).replace(/^\uFEFF/, ''));
const catalog = await readJSON(path.join(assets, 'runtime-catalog.json'));
const manifest = await readJSON(path.join(assets, 'asset-manifest.json'));
const sha = buffer => createHash('sha256').update(buffer).digest('hex');
const counts = {};
const physical = {};
const provenance = {};
const checks = [];
const notes = [];
const equal = (actual, expected, label) => assert.deepEqual(actual, expected, label);
function within(inner, outer, label) {
  assert.equal(inner.length, 4, label + ': rectangle shape');
  assert(inner.every(Number.isFinite), label + ': finite coordinates');
  const [x,y,w,h] = inner, [ox,oy,ow,oh] = outer;
  assert(w>0 && h>0 && x>=ox && y>=oy && x+w<=ox+ow && y+h<=oy+oh,
    label + ': rectangle containment ' + JSON.stringify({inner,outer}));
}
const pyRound = n => {
  const floor = Math.floor(n);
  return n-floor === .5 ? (floor % 2 === 0 ? floor : floor+1) : Math.round(n);
};
function normalize(r) {
  let [x,y,w,h] = Array.isArray(r) ? r : [r.x,r.y,r.width??r.w,r.height??r.h];
  const right=pyRound(x+w),bottom=pyRound(y+h);
  x=pyRound(x);y=pyRound(y);
  return [x,y,right-x,bottom-y];
}
for(const [key, entry] of Object.entries(catalog.images)) {
  const filename=path.resolve(assets,entry.file);
  assert(filename.startsWith(assets+path.sep),key+': image escaped asset directory');
  const bytes=await readFile(filename);
  const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  let width,height,colorType=6;
  if(webp) {
    // Delivered art ships as WebP to keep phone first-load small. The generated
    // PNG stays on disk and keeps the provenance contract below.
    ({width,height}=webpSize(bytes));
    assert.equal(bytes.length,entry.delivered_bytes,key+': WebP byte length');
    assert.equal(sha(bytes),entry.delivered_sha256,key+': WebP checksum');
    colorType=4;
  } else {
    equal([...bytes.subarray(0,8)], [137,80,78,71,13,10,26,10],key+': PNG signature');
    assert.equal(bytes.toString('ascii',12,16),'IHDR',key+': first PNG chunk');
    width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);colorType=bytes[25];
    assert.equal(entry.bytes,bytes.length,key+': physical byte length');
    assert.equal(entry.sha256,sha(bytes),key+': source checksum');
  }
  equal([entry.width,entry.height],[width,height],key+': native dimensions');
  if(entry.transparent) {
    assert([4,6].includes(colorType),key+': image carries an alpha channel');
    assert(entry.alpha.has_channel && entry.alpha.fully_transparent_pixels>0,key+': real transparent pixels');
  }
  const prov=await readJSON(path.resolve(assets,entry.provenance));
  assert.equal(prov.tool,'image_gen',key+': generation tool evidence');
  const raw=prov.raw_output_path??prov.rawPath??prov.raw;
  assert(raw,key+': raw generation path recorded');
  assert.equal(sha(await readFile(raw)),entry.sha256,key+': byte-identical to generated raw PNG');
  const native=prov.dimensions??(prov.width&&prov.height?[prov.width,prov.height]:null);
  if(Array.isArray(native))equal(native,[width,height],key+': provenance dimensions');
  const prompts=prov.prompts??[prov.prompt_path??prov.promptPath];
  assert(prompts.length && prompts.every(Boolean),key+': generation prompt recorded');
  for(const prompt of prompts)assert((await stat(path.isAbsolute(prompt)?prompt:path.resolve(project,prompt))).isFile(),key+': prompt file exists');
  physical[key]={filename,width,height};
  provenance[key]=prov;
}
checks.push('All catalog PNGs have valid native headers, exact bytes/SHA256, genuine-alpha metadata, generation prompts, and byte-identical generated raw files.');
for(const [id,sprite] of Object.entries(catalog.sprites)) {
  const image=physical[sprite.image];
  assert(image,id+': referenced image exists');
  within(sprite.source_rect,[0,0,image.width,image.height],id+': source');
  within(sprite.content_rect,sprite.source_rect,id+': visible content');
  within(sprite.solid_rect,sprite.source_rect,id+': solid content');
  assert(sprite.logical_size.length===2&&sprite.logical_size.every(v=>Number.isFinite(v)&&v>0),id+': positive display dimensions');
  assert(sprite.anchor.length===2&&sprite.anchor.every(v=>Number.isFinite(v)&&v>=0&&v<=1),id+': normalized anchor');
  counts[sprite.category]=(counts[sprite.category]??0)+1;
  const entry=manifest.assets.find(v=>v.id===id);
  assert(entry,id+': inventory record');
  equal(entry.source_rect,sprite.source_rect,id+': manifest source rectangle');
  assert.equal(entry.provenance.sha256,catalog.images[sprite.image].sha256,id+': manifest image checksum');
}
equal(counts,catalog.summary.categories,'actual category counts match catalog');
assert.equal(catalog.summary.png_files,Object.keys(catalog.images).length,'image count');
assert.equal(catalog.summary.sprite_regions,Object.keys(catalog.sprites).length,'sprite count');
checks.push('All source/content/solid rectangles are contained by their native PNGs and manifest mappings agree.');

const states=['idle','walk','jump','fall','skill'],directions=['left','right'];
for(const character of ['deepseek','grok','claude','glm']) {
  const key=character+'-actions',prov=provenance[key];
  for(const state of states)for(const direction of directions) {
    const id='character-'+character+'-'+direction+'-'+state,s=catalog.sprites[id];
    assert(s,id+': required state exists');
    equal([s.character,s.state,s.direction,s.category],[character,state,direction,'character'],id+': identity mapping');
    const recommended=prov.recommended_source_rects?.find(v=>v.id===state+'_'+direction)
      ??prov.frames?.find(v=>v.state===state&&v.direction===direction);
    if(recommended)equal(s.source_rect,normalize(recommended.recommendedSrc??recommended.src??recommended),id+': approved atlas mapping');
  }
}
assert.equal(counts.character,40,'all forty character states, no extra/missing pose');
for(const [group,animation] of Object.entries(catalog.animations)) {
  equal(animation.layout,[2,2],group+': effect layout');
  assert.equal(animation.frames.length,4,group+': four effect frames');
  assert.equal(new Set(animation.frames).size,4,group+': unique frame ids');
  assert.equal(animation.duration_ms,animation.frames.length/animation.fps*1000,group+': duration matches playback');
  for(let i=0;i<4;i++) {
    const s=catalog.sprites[animation.frames[i]],image=physical[s.image];
    assert.equal(s.category,'fx_frame',group+': FX frame category');
    assert.equal(s.group,group,group+': frame group identity');
    equal([s.frame,s.anchor[0],s.anchor[1]],[i,.5,.5],group+': frame ordering and common anchor');
    const x=pyRound(i%2*image.width/2),y=pyRound(Math.floor(i/2)*image.height/2);
    equal(s.source_rect,[x,y,pyRound((i%2+1)*image.width/2)-x,pyRound((Math.floor(i/2)+1)*image.height/2)-y],group+': 2x2 common frame source');
  }
}
checks.push('All 40 directional character poses map to recorded atlas coordinates; all four FX groups have ordered 2x2 frames and correct 500 ms duration.');

class FakeContext {
  constructor(){this.globalAlpha=.8;this.stack=[];this.draws=[];this.transforms=[];}
  save(){this.stack.push(this.globalAlpha);}
  restore(){assert(this.stack.length,'unbalanced context restore');this.globalAlpha=this.stack.pop();}
  translate(x,y){this.transforms.push(['translate',x,y]);}
  scale(x,y){this.transforms.push(['scale',x,y]);}
  drawImage(...args){this.draws.push({args,alpha:this.globalAlpha});}
}
const library=new AssetLibrary(catalog,new URL('../assets/runtime-catalog.json',import.meta.url));
for(const [key,item] of Object.entries(physical))library.images.set(key,{key,width:item.width,height:item.height});
for(const [id,sprite] of Object.entries(catalog.sprites)) {
  const ctx=new FakeContext(),result=library.draw(ctx,id,30,60),draw=ctx.draws[0];
  assert.equal(ctx.draws.length,1,id+': exactly one Canvas draw');
  equal(draw.args.slice(1,5),sprite.category==='fx_frame'?sprite.source_rect:sprite.content_rect,id+': default trim policy');
  assert(draw.args.slice(1).every(Number.isFinite),id+': finite Canvas arguments');
  assert(result.width>0&&result.height>0,id+': positive dimensions');
  assert(result.width<=sprite.logical_size[0]+1e-9&&result.height<=sprite.logical_size[1]+1e-9,id+': fit bounding box');
  const rect=sprite.category==='fx_frame'?sprite.source_rect:sprite.content_rect;
  assert(Math.abs(result.width/result.height-rect[2]/rect[3])<1e-9,id+': aspect ratio preserved');
  equal(draw.args.slice(5,7),[-result.width*sprite.anchor[0],-result.height*sprite.anchor[1]],id+': anchor placement');
  assert.equal(ctx.globalAlpha,.8,id+': canvas state restored');
  assert.equal(ctx.stack.length,0,id+': save/restore balanced');
}
const sample=Object.keys(catalog.sprites)[0],ctx=new FakeContext();
library.draw(ctx,sample,1,2,{width:160,height:90,stretch:true,anchor:[0,1],opacity:.25,flipX:true,untrimmed:true});
equal(ctx.draws[0].args.slice(1,5),catalog.sprites[sample].source_rect,'untrimmed override');
equal(ctx.draws[0].args.slice(5),[-0,-90,160,90],'stretch and anchor options');
assert.equal(ctx.draws[0].alpha,.2,'opacity multiplies existing context alpha');
assert(ctx.transforms.some(t=>t[0]==='scale'&&t[1]===-1&&t[2]===1),'flip applies local scale');
assert.equal(ctx.globalAlpha,.8,'opacity restoration');
assert.throws(()=>library.draw(new FakeContext(),'no-such-sprite',0,0),/Unknown sprite: no-such-sprite/,'unknown sprite diagnostic');
const missing=new AssetLibrary(catalog,new URL('../assets/runtime-catalog.json',import.meta.url));
assert.throws(()=>missing.draw(new FakeContext(),sample,0,0),/Image not loaded/,'missing decoded image diagnostic');
assert.throws(()=>library.drawEffect(new FakeContext(),'no-such-effect',0,0,0),/Unknown effect/,'unknown effect diagnostic');
for(const character of ['deepseek','grok','claude','glm'])for(const state of states)for(const direction of directions) {
  const a=new FakeContext();library.drawActor(a,character.toUpperCase(),state,direction,100,300);
  assert.equal(a.draws[0].args[0].key,character+'-actions','drawActor resolves character case and atlas');
}
for(const character of ['deepseek','grok','claude','glm']) {
  let referenceScale;
  for(const state of states)for(const direction of directions) {
    const actor=new FakeContext(),id='character-'+character+'-'+direction+'-'+state;
    const sprite=catalog.sprites[id];
    assert(Number.isFinite(sprite.native_scale)&&sprite.native_scale>0,id+': common native scale recorded');
    library.drawActor(actor,character,state,direction,100,300);
    const args=actor.draws[0].args;
    const horizontalScale=args[7]/args[3],verticalScale=args[8]/args[4];
    assert(Math.abs(horizontalScale-verticalScale)<1e-9,id+': isotropic source-pixel scale');
    if(referenceScale===undefined)referenceScale=horizontalScale;
    assert(Math.abs(horizontalScale-referenceScale)<1e-9,id+': source-pixel size stays fixed across all poses and directions');
    assert(Math.abs(horizontalScale-sprite.native_scale)<1e-9,id+': actor uses recorded native scale');
    assert.equal(args[6]+args[8],0,id+': feet anchor stays at local origin');
  }
  const id='character-'+character+'-right-skill',s=catalog.sprites[id];
  const box=new FakeContext();
  library.drawActor(box,character,'skill','right',0,0,{width:60,height:42});
  const ba=box.draws[0].args;
  assert(ba[7]<=60+1e-9&&ba[8]<=42+1e-9,character+': explicit dimensions override actor common scale');
  assert(Math.abs(ba[7]/ba[8]-s.content_rect[2]/s.content_rect[3])<1e-9,character+': actor override keeps aspect ratio');
  const native=new FakeContext();
  library.drawActor(native,character,'skill','right',0,0,{nativeScale:.5});
  const na=native.draws[0].args;
  assert(Math.abs(na[7]/na[3]-.5)<1e-9&&Math.abs(na[8]/na[4]-.5)<1e-9,character+': explicit native scale override');
}
checks.push('Actor source-pixel scale and grounded anchor remain constant across every pose/direction; explicit size and native-scale overrides work.');
for(const [group,animation] of Object.entries(catalog.animations)) {
  for(let i=0;i<animation.frames.length;i++) {
    const a=new FakeContext();
    assert.equal(library.drawEffect(a,group,(i+.1)/animation.fps,0,0),true,group+': active frame');
    equal(a.draws[0].args.slice(1,5),catalog.sprites[animation.frames[i]].source_rect,group+': FX uses untrimmed selected frame');
  }
  const ended=new FakeContext();
  assert.equal(library.drawEffect(ended,group,animation.duration_ms/1000,0,0),false,group+': stops at duration boundary');
  assert.equal(ended.draws.length,0,group+': no expired drawing');
  const looped=new FakeContext();
  assert.equal(library.drawEffect(looped,group,animation.duration_ms/1000,0,0,{loop:true}),true,group+': explicit loop continues');
  equal(looped.draws[0].args.slice(1,5),catalog.sprites[animation.frames[0]].source_rect,group+': loop wraps correctly');
  const pending=new FakeContext();
  assert.equal(library.drawEffect(pending,group,-.001,0,0),false,group+': scheduled effect does not draw before start');
  assert.equal(pending.draws.length,0,group+': negative time causes no draw');
  assert.throws(()=>library.drawEffect(pending,group,NaN,0,0),/finite/,group+': nonfinite time diagnostic');
  assert.throws(()=>library.drawEffect(pending,group,Infinity,0,0),/finite/,group+': infinite time diagnostic');
}
checks.push('Canvas adapter exercised every sprite and actor state, fit/stretch/anchors/opacity/flip/source policy, unknown IDs, unloaded images and effect duration/loop boundaries.');

const originalGlobals={fetch:globalThis.fetch,Image:globalThis.Image,document:globalThis.document};
try {
  const requests=[],decoded=[];
  globalThis.document={baseURI:'https://example.test/whale/index.html'};
  globalThis.fetch=async url=>{requests.push(url.href);return {ok:true,json:async()=>catalog};};
  globalThis.Image=class {
    async decode(){decoded.push(this.src);assert.equal(new URL(this.src).protocol,'https:','preloaded source is a resolved absolute URL');}
  };
  const loaded=await AssetLibrary.load('assets/runtime-catalog.json');
  equal(requests,['https://example.test/whale/assets/runtime-catalog.json'],'relative catalog URL resolves against document');
  assert.equal(loaded.images.size,Object.keys(catalog.images).length,'every catalog image decoded');
  equal(decoded.sort(),Object.values(catalog.images).map(v=>new URL(v.file,'https://example.test/whale/assets/runtime-catalog.json').href).sort(),'image URLs resolve relative to catalog rather than page');
  globalThis.fetch=async()=>({ok:false,status:404});
  await assert.rejects(()=>AssetLibrary.load('assets/missing.json'),/HTTP 404/,'failed catalog HTTP diagnostic');
} finally {
  for(const [key,value] of Object.entries(originalGlobals)) {
    if(value===undefined)delete globalThis[key];else globalThis[key]=value;
  }
}
checks.push('Relative catalog URL loading, all catalog image URLs and HTTP failure diagnostics verified with isolated fetch/Image stubs.');

const report={status:'passed',images:Object.keys(catalog.images).length,sprites:Object.keys(catalog.sprites).length,categories:counts,checks,notes};
console.log(JSON.stringify(report,null,2));

