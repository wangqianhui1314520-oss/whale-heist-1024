import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'dist');
// A build is a reproducible snapshot. Removing the previous output prevents
// deleted/renamed source files from surviving in a deployable directory.
await fs.rm(out,{recursive:true,force:true});
await fs.mkdir(out,{recursive:true});
async function copyFile(relative){
  const normalized=relative.replaceAll('\\','/');
  const source=path.resolve(root,normalized),target=path.resolve(out,normalized);
  if(!source.startsWith(root+path.sep)||!target.startsWith(out+path.sep))throw new Error(`Build path escapes root: ${relative}`);
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(source,target);
}
async function sourceTree(dir){for(const entry of await fs.readdir(path.join(root,dir),{withFileTypes:true})){
  const relative=path.join(dir,entry.name);if(entry.isDirectory()){await sourceTree(relative);continue;}
  if(!/\.(mjs|css)$/.test(entry.name)||entry.name.startsWith('verify-'))continue;
  const target=path.join(out,relative.replace(/\.mjs$/,'.js'));await fs.mkdir(path.dirname(target),{recursive:true});
  const text=await fs.readFile(path.join(root,relative),'utf8');await fs.writeFile(target,text.replaceAll('.mjs','.js'));
}}
await sourceTree('src');
await fs.writeFile(path.join(out,'index.html'),(await fs.readFile(path.join(root,'index.html'),'utf8')).replaceAll('.mjs','.js'));
await fs.writeFile(path.join(out,'story-theater.html'),(await fs.readFile(path.join(root,'story-theater.html'),'utf8')).replaceAll('.mjs','.js'));
const catalog=JSON.parse(await fs.readFile(path.join(root,'assets/runtime-catalog.json'),'utf8'));
for(const item of Object.values(catalog.images)){
  if(!item?.file||typeof item.file!=='string')throw new Error('Runtime catalog image entry is missing a file path');
  await copyFile('assets/'+item.file);
}
// Game audio assets (music/ambience/sfx/voice) are catalog-driven like images:
// each entry's `file` is copied from assets/. Runtime loader falls back to the
// procedural synth when a file is missing, so a dropped asset degrades, never breaks.
for(const item of Object.values(catalog.audio||{})){
  if(!item?.file||typeof item.file!=='string')throw new Error('Runtime catalog audio entry is missing a file path');
  await copyFile('assets/'+item.file);
}
await copyFile('assets/runtime-catalog.json');
// Supplemental HUD art is intentionally outside the runtime catalog: it is a
// CSS sprite sheet used by HTML status badges, not a Canvas sprite region.
await copyFile('assets/ui/hud-icon-badges.webp');
// Authored chrome shells used by the visual direction stylesheet. They stay
// outside the sprite catalog because CSS consumes them as scalable surfaces.
await copyFile('assets/ui/panel-large.webp');
await copyFile('assets/ui/panel-card.webp');
await copyFile('assets/ui/hud-pill.webp');
await copyFile('assets/ui/hud-square.webp');
await copyFile('assets/ui/button-rail.webp');
await copyFile('assets/ui/ring.webp');
await copyFile('assets/ui/title-ornament-v1.webp');
// Menu key art layers are supplemental runtime assets: they are not sprites in
// the gameplay catalog, but are referenced by the title screen composition.
await copyFile('assets/foreground/whale-crew-hero-v2.webp');
await copyFile('assets/foreground/dock-rail-overlay-v3.webp');
// Narrative keyframes, including each presentation style, are copied by the
// catalog loop above. Keep a single source of truth as story art expands.
console.log(JSON.stringify({status:'built',directory:out,clean:true,productionImages:Object.keys(catalog.images).length,audioAssets:Object.keys(catalog.audio||{}).length,viewport:[1280,720],moduleExtension:'.js'}));
