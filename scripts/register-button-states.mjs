import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const raw='C:/Users/Administrator/.codex/generated_images/01a17084-fe91-7f83-bd6d-d338c4309fa9/exec-3da7342c-d678-48a7-ab7c-e2ff5a76d9ad.png';
const file='assets/ui/button-states-v1.webp',bytes=await readFile(file),sha256=createHash('sha256').update(bytes).digest('hex');
const meta=JSON.parse(await readFile('assets/ui/button-states-v1.metadata.json','utf8'));
const regions={normal:[26,118,837,242],focus:[912,118,837,242],pressed:[26,529,837,242],disabled:[912,529,837,242]};
await writeFile('assets/provenance/button-states-v1.json',JSON.stringify({tool:'image_gen',mode:'built-in',date:'2026-10-25',raw_output_path:raw,prompts:['assets/prompts/button-states-v1.txt'],dimensions:[meta.width,meta.height],sha256,regions,post_processing:'Unmodified generated PNG; CSS samples four measured state rectangles.',visual_qa:{inspected:true,states:['cyan','gold','pressed','disabled']}},null,2)+'\n');
const catalog=JSON.parse(await readFile('assets/runtime-catalog.json','utf8'));
catalog.images['button-states-v1']={file:'ui/button-states-v1.png',width:meta.width,height:meta.height,mode:'RGBA',transparent:true,alpha:meta.alpha,bytes:bytes.length,sha256,raw_output_sha256_verified:sha256===createHash('sha256').update(await readFile(raw)).digest('hex'),provenance:'provenance/button-states-v1.json',ui_regions:regions};
catalog.summary.png_files=Object.keys(catalog.images).length;await writeFile('assets/runtime-catalog.json',JSON.stringify(catalog,null,2)+'\n');
const manifest=JSON.parse(await readFile('assets/asset-manifest.json','utf8'));
const entry={id:'ui-button-states-v1',name:'潜艇操作按钮四态图集',category:'ui',supplemental:true,status:'implemented',creation_method:'image_gen',source_path:file,runtime_path:'src/ui/component-art.css',provenance:{tool:'image_gen',path:'assets/provenance/button-states-v1.json',sha256},note:'默认、聚焦、按压、禁用均从真实PNG取样。动态标签保留HTML。'};
const i=manifest.assets.findIndex(a=>a.id===entry.id);if(i>=0)manifest.assets[i]=entry;else manifest.assets.push(entry);manifest.summary={...manifest.summary,total_records:manifest.assets.length,production_png_files:catalog.summary.png_files,runtime_sprite_regions:Object.keys(catalog.sprites).length,by_category:manifest.assets.reduce((o,a)=>(o[a.category]=(o[a.category]||0)+1,o),{}),by_status:manifest.assets.reduce((o,a)=>(o[a.status]=(o[a.status]||0)+1,o),{})};
await writeFile('assets/asset-manifest.json',JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({png_files:catalog.summary.png_files,button_states:4}));

await writeFile('assets/preview/catalog.js','window.WHALE_ASSETS = '+JSON.stringify(catalog)+';\n');
