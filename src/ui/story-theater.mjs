import { STORY_SCENES, getStoryScene } from '../game/story.mjs';
import { browserStorage, loadCheckpoint } from '../core/storage.mjs';
import { loadArchive, loadExperience } from '../core/experience-storage.mjs';
import { storyBackdrop, portraitPath, escapeHTML as esc } from './ui-v3.mjs';
import { STORY_ART_BEATS, STORY_ART_IMAGES, storyBeatFor, storyArtFor, comicFrameFor } from '../game/story-art.mjs';
import { AssetLibrary } from '../render/assets.mjs';

// Read the saved journey, never instantiate GameCore or write playback progress.
const storage = browserStorage(), experience = loadExperience(storage).value, archive = loadArchive(storage);
const campaign = experience?.campaign?.campaign ?? loadCheckpoint(storage).checkpoint?.campaign ?? { results: [], broadcastOn: true, completed: false };
const attempt = experience?.current?.core?.attempt ?? {};
const recordMap = new Map(archive.records.map(record => [record.id, record]));
for (const record of experience?.current?.world?.records ?? []) {
  const prefix = `${experience.chapterId}:`, id = String(record.id ?? '');
  const normalized = { ...record, id: id.startsWith(prefix) ? id : prefix + id };
  recordMap.set(normalized.id, normalized);
}
const records = [...recordMap.values()].slice(-300);
const context = { campaign, attempt, records };
const conditionRecord = { id: 'preview-condition', type: 'preview', public: true, text: '【条件占位】此处显示本次航程中已公开的实际行动回执。' };

function variants(id) {
  if (id === 'chapter4-reveal') return [
    { label: '广播仍开启 · 有公开记录', context: { ...context, broadcastOn: true, records: records.some(r => r.public === true || r.published === true || r.broadcastOn === true) ? records : [conditionRecord] }, note: '如没有已公开回执，使用明确标注的条件占位。' },
    { label: '已提前关闭 · 有公开记录', context: { ...context, broadcastOn: false, records: records.some(r => r.public === true || r.published === true || r.broadcastOn === true) ? records : [conditionRecord] } },
    { label: '广播仍开启 · 无可核验记录', context: { ...context, broadcastOn: true, records: [] } },
    { label: '已提前关闭 · 无可核验记录', context: { ...context, broadcastOn: false, records: [] } },
    { label: '仅有艇内记录 · 公开状态未确认', context: { ...context, broadcastOn: false, records: [{ ...conditionRecord, public: false, text: '【条件占位】此处显示艇内可用记录；公开状态未确认。' }] } },
  ];
  if (id === 'chapter5-preparation') return [
    { label: '三人到齐 · 装载完成 · 等待确认', context: { ...context, rendezvousCrew: ['Grok', 'Claude', 'GLM'], remoteReady: true, evacuationStarted: false } },
    { label: '尚在集结与装载', context: { ...context, rendezvousCrew: [], remoteReady: false, evacuationStarted: false, records: [] } },
    { label: '已主动确认撤离', context: { ...context, rendezvousCrew: ['Grok', 'Claude', 'GLM'], remoteReady: true, evacuationStarted: true } },
  ];
  if (id === 'epilogue') return [
    { label: '航程完成 · 广播关闭', context: { ...context, completed: true, broadcastOn: false }, templateTotals: !campaign.completed },
    { label: '航程完成 · 广播仍开', context: { ...context, completed: true, broadcastOn: true }, templateTotals: !campaign.completed },
    { label: '当前航程笔录', context },
  ];
  return [{ label: '完整剧情', context }];
}
const entries = Object.keys(STORY_SCENES).map((id, index) => ({ id, index, variants: variants(id).map(v => {
  const scene = getStoryScene(id, v.context);
  if (v.templateTotals) {
    scene.steps[0].text = '已确认 5 章，合计【实际总分】分。航程完成。';
    const totals = scene.steps.find(step => step.text.startsWith('章节汇总：'));
    if (totals) totals.text = '章节汇总：公开指令【实际次数】次，交付【实际次数】次，报警【实际次数】次。';
    v.note = '结局预览：总分和次数在通关后按实际航程计算。';
  }
  return { ...v, scene };
}) }));
const $ = id => document.getElementById(id);
const styles = { cinematic: '电影卡片', stage: '实景小剧场', comic: '分镜动态漫画' };
const styleDescriptions = { cinematic: '电影关键帧 · 镜头平移与特写', stage: '独立场景底图 · 正式角色动作与技能特效', comic: '三格连续叙事 · 随台词推进聚焦镜头' };
const beatNames = { opening: '深海广播 · 纸窗入港', grok: 'Grok · 破窗开路', claude: 'Claude · 纸页诱饵', glm: 'GLM · 扫描校验桥', broadcast: '战报公开 · 广播反转', evacuation: '闭舱返航 · 全员集结', epilogue: '返航之后 · 调查笔录' };
const beatSceneIds = { opening: 'prologue', grok: 'grok-join', claude: 'claude-join', glm: 'glm-join', broadcast: 'chapter4-reveal', evacuation: 'chapter5-preparation', epilogue: 'epilogue' };
let storyStyle = new URLSearchParams(location.search).get('style');
if (!Object.hasOwn(styles, storyStyle)) storyStyle = 'cinematic';
const fallbackFor = scene => storyBackdrop(scene.steps.find(step => String(step.backdrop).startsWith('story-'))?.backdrop ?? scene.steps[0].backdrop);
const artFor = scene => storyArtFor(scene, storyStyle);
const artBackground = scene => `url('${artFor(scene)}'),url('${fallbackFor(scene)}')`;
$('summary').textContent = `${entries.length} 段剧情 · ${entries.reduce((n, entry) => n + entry.variants.length, 0)} 个剧情版本 · 连播包含全部分支`;
$('scene-nav').innerHTML = entries.map(entry => `<button type="button" data-scene="${entry.index}"><span>${String(entry.index + 1).padStart(2, '0')}</span>${esc(entry.variants[0].scene.title)}</button>`).join('');
$('script-list').innerHTML = entries.map(entry => `<article class="script-scene" id="script-${entry.id}" data-scene-id="${entry.id}">
  <div class="script-cover" data-cover-scene="${entry.index}" style="background-image:${artBackground(entry.variants[0].scene)}"><div><small>CHAPTER ${String(STORY_SCENES[entry.id].chapter).padStart(2, '0')} / ${String(entry.index + 1).padStart(2, '0')}</small><h3>${esc(entry.variants[0].scene.title)}</h3></div><button type="button" data-scene="${entry.index}">播放这一段 ↗</button></div>
  ${entry.variants.map((variant, vi) => `<section class="variant"><h4>${esc(variant.label)}<button type="button" data-scene="${entry.index}" data-variant="${vi}">播放此分支</button></h4>${variant.note ? `<p class="branch-note">${esc(variant.note)}</p>` : ''}${variant.scene.steps.map((step, li) => `<div class="script-line"><small>${String(li + 1).padStart(2, '0')}</small><strong>${esc(step.speaker)}</strong><p>${esc(step.text)}${step.choice ? `<span class="script-choice">互动：${esc(step.choice.prompt)} · ${step.choice.options.map(option => esc(option.label + ' — ' + option.hint)).join(' / ')}</span>` : ''}</p></div>`).join('')}</section>`).join('')}
</article>`).join('');

$('gallery-list').innerHTML = STORY_ART_BEATS.map((beat, index) => `<article class="gallery-beat"><div class="gallery-beat-title"><span>${String(index + 1).padStart(2, '0')}</span><h3>${esc(beatNames[beat] || beat)}</h3></div><div class="gallery-row">${Object.entries(styles).map(([style, label]) => {
  const path = STORY_ART_IMAGES.find(path => path.endsWith(`/${style}/${beat}.png`)) ?? `assets/story/${style}/${beat}.png`;
  return `<button class="gallery-card gallery-${style}" type="button" data-art-path="${path}" data-art-beat="${beat}" data-art-style="${style}" aria-label="查看${esc(beatNames[beat])}的${label}原画"><div class="gallery-image"><img src="${path}" alt="${esc(beatNames[beat])} · ${label}" loading="lazy"><span class="image-pending">画面准备中</span></div><div class="gallery-caption"><strong>${label}</strong><span>${style === 'stage' ? '场景底图 + 角色演出' : style === 'comic' ? '连续三格分镜' : '电影叙事关键帧'} ↗</span></div></button>`;
}).join('')}</div></article>`).join('');
document.querySelectorAll('.gallery-image img').forEach(image => {
  const show = () => image.parentElement.classList.add('image-ready');
  image.addEventListener('load', show);
  image.addEventListener('error', () => image.parentElement.classList.remove('image-ready'));
  if (image.complete && image.naturalWidth) show();
});

let sceneIndex = 0, variantIndex = 0, lineIndex = 0, playing = !matchMedia('(prefers-reduced-motion: reduce)').matches, timer, changedAt = 0, remainingMs = 0;
const current = () => entries[sceneIndex].variants[variantIndex].scene;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const cast = ['DeepSeek', 'Grok', 'Claude', 'GLM'];
let stageAssets, stageFrame, stageTime = 0, stageTick = 0, stageLoading;

// The stage reuses the same verified sprites and effect atlases as gameplay.
// It is a read-only performance: no world or campaign instance is created.
async function loadStage() {
  if (stageAssets || stageLoading) return stageLoading;
  stageLoading = (async () => {
    try {
      const catalogURL = new URL('../../assets/runtime-catalog.json', import.meta.url);
      const response = await fetch(catalogURL);
      if (!response.ok) throw new Error('Stage catalog unavailable');
      const assets = new AssetLibrary(await response.json(), catalogURL);
      await assets.preload([...cast.map(name => `${name.toLowerCase()}-actions`), 'axe-impact-atlas', 'paper-decoy-atlas', 'scan-grid-atlas', 'water-dash-atlas']);
      stageAssets = assets;
      $('stage-fallback').hidden = true;
      refreshStage();
    } catch {
      // Existing transparent art remains a usable fallback if an atlas is missing.
      $('stage-fallback').innerHTML = cast.map(name => `<img src="${portraitPath(name)}" alt="${name}">`).join('');
      $('stage-fallback').hidden = storyStyle !== 'stage';
    }
  })();
  return stageLoading;
}
function paintStage() {
  const canvas = $('stage-canvas'), ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!stageAssets) return;
  const scene = current(), line = scene.steps[lineIndex], beat = storyBeatFor(scene);
  const skillName = { grok: 'Grok', claude: 'Claude', glm: 'GLM' }[beat];
  const visibleCast = beat === 'opening' ? ['DeepSeek'] : beat === 'grok' ? ['DeepSeek', 'Grok'] : beat === 'claude' ? ['DeepSeek', 'Grok', 'Claude'] : cast;
  const activeName = cast.includes(line.speaker) ? line.speaker : skillName || 'DeepSeek';
  const positions = visibleCast.length === 1 ? [640] : visibleCast.length === 2 ? [450, 795] : visibleCast.length === 3 ? [355, 640, 925] : [275, 520, 765, 1010];
  visibleCast.forEach((name, index) => {
    const active = name === activeName;
    const progress = reduceMotion.matches ? 0 : Math.min(stageTime / 1.6, 1);
    const drift = name === skillName && !reduceMotion.matches ? Math.sin(progress * Math.PI) * 65 : 0;
    const bob = reduceMotion.matches ? 0 : Math.sin(stageTime * 2 + index) * (active ? 3 : 1.5);
    stageAssets.drawActor(ctx, name, active ? 'skill' : 'idle', index < visibleCast.length / 2 ? 'right' : 'left', positions[index] + drift, 510 + bob, { width: active ? 220 : 195, height: active ? 245 : 220, opacity: active ? 1 : .8, rotation: active && !reduceMotion.matches ? Math.sin(stageTime * 3) * .014 : 0 });
  });
  const effect = { grok: 'axe-impact', claude: 'paper-decoy', glm: 'scan-grid', evacuation: 'water-dash' }[beat];
  if (effect && !reduceMotion.matches) {
    const slot = visibleCast.indexOf(skillName), x = slot >= 0 ? positions[slot] + 75 : 870;
    stageAssets.drawEffect(ctx, effect, stageTime % 3, x, 405, { width: beat === 'glm' ? 400 : 260, height: 220, opacity: .8 });
  }
}
function refreshStage() {
  cancelAnimationFrame(stageFrame);
  if (storyStyle !== 'stage') return;
  paintStage();
  if (!playing || document.hidden || reduceMotion.matches || !stageAssets) return;
  stageTick = performance.now();
  const tick = now => {
    if (storyStyle !== 'stage' || !playing || document.hidden) return;
    stageTime += Math.min((now - stageTick) / 1000, .1); stageTick = now;
    paintStage(); stageFrame = requestAnimationFrame(tick);
  };
  stageFrame = requestAnimationFrame(tick);
}
function syncStyle() {
  $('screen').className = `screen style-${storyStyle}${playing ? '' : ' is-paused'}`;
  $('stage-canvas').hidden = storyStyle !== 'stage';
  $('stage-fallback').hidden = storyStyle !== 'stage' || Boolean(stageAssets) || !$('stage-fallback').children.length;
  $('comic-strip').hidden = storyStyle !== 'comic';
  $('style-description').textContent = styleDescriptions[storyStyle];
  document.querySelectorAll('.style-selector button[data-style]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.style === storyStyle)));
  document.querySelectorAll('[data-cover-scene]').forEach(cover => {
    const scene = entries[Number(cover.dataset.coverScene)].variants[0].scene;
    cover.style.backgroundImage = artBackground(scene);
    cover.classList.toggle('is-comic-cover', storyStyle === 'comic');
  });
  if (storyStyle === 'stage') loadStage();
}
function schedule(delay) {
  clearTimeout(timer);
  if (playing && !document.hidden) {
    remainingMs = delay ?? Math.max(current().steps[lineIndex].duration * 1000, current().steps[lineIndex].text.length / 8 * 1000, 3200);
    changedAt = performance.now(); timer = setTimeout(next, remainingMs);
  }
}
function render() {
  const scene = current(), line = scene.steps[lineIndex];
  const frame = comicFrameFor({ ...line, sceneId: scene.id, index: lineIndex, total: scene.steps.length });
  $('scene-art').style.backgroundImage = artBackground(scene);
  $('scene-art').style.backgroundSize = 'contain';
  $('scene-art').style.backgroundPosition = 'center';
  if (storyStyle === 'comic') {
    $('comic-strip-image').src = storyArtFor(scene, 'comic');
    $('comic-strip-image').alt = `${scene.title} · 完整三格分镜`;
    $('comic-phase').textContent = `三格完整展示 · 当前台词对应第 ${frame + 1} 格`;
  }
  $('scene-heading').textContent = `${String(sceneIndex + 1).padStart(2, '0')} / ${entries.length}  ${scene.title}`;
  $('line-count').textContent = `${lineIndex + 1} / ${scene.steps.length}`;
  $('speaker').textContent = line.speaker;
  $('dialogue').textContent = line.text;
  $('actor').hidden = true;
  $('choice-preview').innerHTML = line.choice ? `<span>${esc(line.choice.prompt)}</span>${line.choice.options.map(o => `<b>${esc(o.label)}</b>`).join('')}<span>放映中自动继续</span>` : '';
  const variantsBefore = entries.slice(0, sceneIndex).reduce((n, entry) => n + entry.variants.length, 0);
  const totalVariants = entries.reduce((n, entry) => n + entry.variants.length, 0);
  $('progress').style.width = `${((variantsBefore + variantIndex + (lineIndex + 1) / scene.steps.length) / totalVariants) * 100}%`;
  $('play').textContent = playing ? '暂停连播' : '连播全部剧情';
  const entry = entries[sceneIndex];
  $('branch-select').innerHTML = entry.variants.map((variant, index) => `<option value="${index}" ${index === variantIndex ? 'selected' : ''}>${esc(variant.label)}</option>`).join('');
  $('branch-select').disabled = entry.variants.length === 1;
  $('play-status').textContent = `分支 ${variantIndex + 1} / ${entry.variants.length}`;
  $('screen').classList.toggle('is-paused', !playing);
  $('previous').disabled = sceneIndex === 0 && variantIndex === 0 && lineIndex === 0;
  document.querySelectorAll('#scene-nav button').forEach((b, i) => b.setAttribute('aria-current', String(i === sceneIndex)));
  stageTime = 0; refreshStage();
  schedule();
}
function next() {
  if (lineIndex + 1 < current().steps.length) lineIndex++;
  else if (variantIndex + 1 < entries[sceneIndex].variants.length) { variantIndex++; lineIndex = 0; }
  else if (sceneIndex + 1 < entries.length) { sceneIndex++; variantIndex = lineIndex = 0; }
  else playing = false;
  render();
}
$('next').addEventListener('click', next);
$('previous').addEventListener('click', () => {
  if (lineIndex > 0) lineIndex--;
  else if (variantIndex > 0) { variantIndex--; lineIndex = current().steps.length - 1; }
  else if (sceneIndex > 0) { sceneIndex--; variantIndex = entries[sceneIndex].variants.length - 1; lineIndex = current().steps.length - 1; }
  render();
});
$('branch-select').addEventListener('change', event => { variantIndex = Number(event.target.value); lineIndex = 0; render(); });
$('play').addEventListener('click', () => { playing = !playing; render(); });
$('restart').addEventListener('click', () => { sceneIndex = variantIndex = lineIndex = 0; playing = true; render(); });
document.addEventListener('click', event => {
  const styleButton = event.target.closest('.style-selector button[data-style]');
  if (styleButton) { storyStyle = styleButton.dataset.style; syncStyle(); render(); return; }
  const artButton = event.target.closest('button[data-art-path]');
  if (artButton) {
    const { artPath, artBeat, artStyle } = artButton.dataset;
    $('preview-title').textContent = `${beatNames[artBeat]} · ${styles[artStyle]}`;
    $('preview-image').src = artPath; $('preview-image').alt = $('preview-title').textContent;
    $('preview-description').textContent = styleDescriptions[artStyle];
    $('preview-play').dataset.beat = artBeat; $('preview-play').dataset.style = artStyle;
    $('art-preview').showModal(); return;
  }
  const button = event.target.closest('button[data-scene]'); if (!button) return;
  sceneIndex = Number(button.dataset.scene); variantIndex = Number(button.dataset.variant ?? 0); lineIndex = 0; playing = true; render();
  document.querySelector('.theater').scrollIntoView({ block: 'start' });
});
$('preview-close').addEventListener('click', () => $('art-preview').close());
$('art-preview').addEventListener('click', event => { if (event.target === $('art-preview')) $('art-preview').close(); });
$('preview-play').addEventListener('click', () => {
  const beat = $('preview-play').dataset.beat;
  storyStyle = $('preview-play').dataset.style;
  sceneIndex = Math.max(0, entries.findIndex(entry => entry.id === beatSceneIds[beat]));
  variantIndex = lineIndex = 0; playing = true;
  $('art-preview').close(); syncStyle(); render();
  document.querySelector('.theater').scrollIntoView({ block: 'start' });
});
$('comic-strip-image').addEventListener('error', event => { event.target.hidden = true; });
$('comic-strip-image').addEventListener('load', event => { event.target.hidden = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden) { remainingMs = Math.max(500, remainingMs - (performance.now() - changedAt)); clearTimeout(timer); cancelAnimationFrame(stageFrame); } else { schedule(remainingMs); refreshStage(); } });
document.addEventListener('keydown', event => {
  if (event.target.closest('button,a,input,select,textarea')) return;
  if (event.code === 'Space') { event.preventDefault(); playing = !playing; render(); }
  if (event.code === 'ArrowRight') { event.preventDefault(); next(); }
  if (event.code === 'ArrowLeft') { event.preventDefault(); $('previous').click(); }
});
syncStyle();
render();
