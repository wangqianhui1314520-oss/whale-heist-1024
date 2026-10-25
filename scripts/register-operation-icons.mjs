import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { OPERATION_ICON_SHEET, OPERATION_ICON_RECTS } from '../src/ui/raster-icons.mjs';

const raw='C:/Users/Administrator/.codex/generated_images/01a17084-fe91-7f83-bd6d-d338c4309fa9/exec-88a2c3cf-6e5c-452c-94d7-6b885ddcd5cc.png';
const bytes=await readFile(OPERATION_ICON_SHEET.file), sha256=createHash('sha256').update(bytes).digest('hex');
const metadata=JSON.parse(await readFile('assets/ui/operation-icons-v1.metadata.json','utf8'));
const provenance={asset:'ui-operation-icons-v1',tool:'image_gen',mode:'built-in',date:'2026-10-25',raw_output_path:raw,prompts:['assets/prompts/operation-icons-v1.txt'],dimensions:[metadata.width,metadata.height],sha256,post_processing:'Byte-identical generated PNG. No image edits. Icons are sampled at measured source rectangles in HTML/CSS.',regions:OPERATION_ICON_RECTS,visual_qa:{inspected:true,semantic_icons:16,notes:['Left/right/up/down, jump, dash, interact and pause have distinct painted silhouettes.','Navigation and status icons have measured individual crop rectangles rather than assuming a uniform grid.']}};
await writeFile('assets/provenance/operation-icons-v1.json',JSON.stringify(provenance,null,2)+'\n');
const catalog=JSON.parse((await readFile('assets/runtime-catalog.json','utf8')).replace(/^\uFEFF/,''));
catalog.images['operation-icons-v1']={file:'ui/operation-icons-v1.png',width:metadata.width,height:metadata.height,mode:'RGBA',transparent:true,alpha:metadata.alpha,bytes:bytes.length,sha256,raw_output_sha256_verified:sha256===createHash('sha256').update(await readFile(raw)).digest('hex'),provenance:'provenance/operation-icons-v1.json',ui_regions:OPERATION_ICON_RECTS};
catalog.summary.png_files=Object.keys(catalog.images).length;
await writeFile('assets/runtime-catalog.json',JSON.stringify(catalog,null,2)+'\n');
const manifest=JSON.parse((await readFile('assets/asset-manifest.json','utf8')).replace(/^\uFEFF/,''));
const entry={id:'ui-operation-icons-v1',name:'手绘操作与导航图标带',category:'ui',supplemental:true,status:'implemented',creation_method:'image_gen',source_path:OPERATION_ICON_SHEET.file,runtime_path:'src/ui/raster-icons.mjs',provenance:{tool:'image_gen',path:'assets/provenance/operation-icons-v1.json',sha256},note:'16 个独立可辨识操作图标，真实 Alpha。使用原图测量坐标，未后期改图。'};
const old=manifest.assets.findIndex(a=>a.id===entry.id); if(old>=0)manifest.assets[old]=entry;else manifest.assets.push(entry);
manifest.summary={...manifest.summary,total_records:manifest.assets.length,production_png_files:catalog.summary.png_files,runtime_sprite_regions:Object.keys(catalog.sprites).length,by_category:manifest.assets.reduce((o,a)=>(o[a.category]=(o[a.category]||0)+1,o),{}),by_status:manifest.assets.reduce((o,a)=>(o[a.status]=(o[a.status]||0)+1,o),{})};
await writeFile('assets/asset-manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({png_files:catalog.summary.png_files,icons:Object.keys(OPERATION_ICON_RECTS).length,sha256}));

await writeFile('assets/preview/catalog.js','window.WHALE_ASSETS = '+JSON.stringify(catalog)+';\n');
