import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const at=name=>new URL('../'+name,import.meta.url);
const manifest=JSON.parse(await fs.readFile(at('assets/asset-manifest.json'),'utf8'));
manifest.scope.note='五章横版本地可玩版已实现；首次体验二十分钟为待真人校准的设计目标。28张生产PNG、96个采样区保持原生输出，主角卡另计。';
for(const r of manifest.assets){
  if(r.category==='audio'){
    r.status='implemented';r.implementation_target='src/game/audio.mjs#'+r.id.replace('audio-','');
    r.note='已实现 Web Audio 程序合成；用户操作后解锁音频，可静音。';
  }
  if(r.id==='submission-hero-card'){
    const buffer=await fs.readFile(at('assets/submission/deepseek-hero-card.png'));
    r.status='verified';r.dimensions_verified=true;
    r.derivation='HTML排版用户参考、原生生成头像与侧视图集、实际浏览器截图，再导出1600×900 PNG；原图未修改。';
    r.provenance={tool:'HTML/CSS + Canvas 2D + browser screenshot',prompt_path:'output/submission/index.html',raw_output_path:'output/screenshots/chapter-4.png',generated_at:'2026-10-24',usage_verified:true};
    r.note='实际运行画面为标注章节展示模式的第四章；不作为正式通关凭证。';
    r.bytes=buffer.length;r.sha256=crypto.createHash('sha256').update(buffer).digest('hex');
  }
}
manifest.summary.by_status={};for(const r of manifest.assets)manifest.summary.by_status[r.status]=(manifest.summary.by_status[r.status]||0)+1;
await fs.writeFile(at('assets/asset-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const edits=[
 ['assets/README.md','这是美术资源与接入资料，游戏逻辑、五章可玩流程和比赛主角卡仍需继续完成。','美术已接入五章可玩游戏；主角卡已用真实运行画面制作于 submission/。'],
 ['assets/README.md','声音尚未生成，比赛主角卡等待真实游戏运行截图。','声音已在 src/game/audio.mjs 中以 Web Audio 合成，比赛主角卡已完成。'],
 ['docs/美术资产交付说明.md','声音尚未生成或实现。','声音已在 src/game/audio.mjs 中以 Web Audio 合成。'],
 ['src/core/README.md','这是开发起点：原生浏览器 ES modules，无依赖。它实现了可验证的五章数据和主线状态 API，尚未实现可玩的动作游戏。','这是五章可玩游戏的状态层：原生浏览器 ES modules，无第三方运行依赖。动作层位于 ../game/，入口为 ../main.mjs。']
];
for(const [name,from,to] of edits){let text=await fs.readFile(at(name),'utf8');await fs.writeFile(at(name),text.replace(from,to));}
for(const name of ['docs/美术资产交付说明.md','docs/美术资产复核报告.md','docs/美术资产制作清单.md','docs/当前视觉与开发基线.md']){
 let text=await fs.readFile(at(name),'utf8');const marker='## 2026-10-24 游戏接入更新';
 if(!text.includes(marker))text+='\n\n'+marker+'\n\n五章侧视可玩流程、键鼠与触屏输入、章间存档、重试、结算和程序音效已实现。比赛主角卡已用真实运行画面制作于 `assets/submission/deepseek-hero-card.png`，1600×900 PNG。前文“待开发”“待截图”等为此前阶段记录；当前实施与验收见[开发与验收记录](开发与验收记录.md)。首次体验二十分钟待真人校准；在线发布等待源码上传和部署授权。\n';
 await fs.writeFile(at(name),text);
}
console.log('Delivery metadata and implementation notes updated.');
