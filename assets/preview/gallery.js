(function () {
  'use strict';
  const catalog = window.WHALE_ASSETS || { images: {}, sprites: {}, animations: {} };
  const images = catalog.images || {};
  const sprites = Object.entries(catalog.sprites || {}).map(([id, value]) => ({ id, ...value }));
  // Supplemental HTML UI atlases have measured regions but do not add Canvas
  // sprites. Include those actual painted icons/states in the offline library.
  for (const [image, info] of Object.entries(images)) {
    for (const [name, rect] of Object.entries(info.ui_regions || {})) {
      sprites.push({ id:`ui-${image}-${name}`, image, category:'ui', label:name,
        source_rect:rect, content_rect:rect, logical_size:[64,64], anchor:[.5,.5] });
    }
  }
  const animations = Object.entries(catalog.animations || {}).map(([id, value]) => ({ id, ...value }));
  const $ = (id) => document.getElementById(id);
  const labels = { all: '全部', actors: '角色动作', portraits: '角色头像', scene: '场景构件', props: '机关道具', enemies: '敌人与追踪', fx: '技能特效', ui: '界面组件', backgrounds: '背景画面' };
  const stateLabels = { idle: '待机', walk: '行走', jump: '起跳', fall: '下落', skill: '技能', left: '向左', right: '向右' };
  const cache = new Map();
  let activeTab = 'actors';
  let renderedCards = [];
  let playing = true;
  let speed = 8;
  let animationStart = performance.now();
  let inspectorItem = null;
  let lastFrame = -1;
  const categories = Object.keys(labels);

  function imageInfo(item) {
    const key = typeof item.image === 'string' ? item.image : item.image_key;
    return images[key] || Object.values(images).find((x) => x.file === key) || {};
  }
  function imageURL(info) { return '../' + String(info.file || '').replace(/^\.\//, ''); }
  function categoryOf(item) {
    const category = String(item.category || '').toLowerCase();
    if (/portrait|头像/.test(category)) return 'portraits';
    if (/character|actor|角色/.test(category)) return 'actors';
    if (/enemy|guard|investigator|敌/.test(category)) return 'enemies';
    if (/fx|effect|特效/.test(category)) return 'fx';
    if (/background|背景/.test(category)) return 'backgrounds';
    if (/prop|mechanism|机关|道具/.test(category)) return 'props';
    if (/^ui|interface|界面/.test(category)) return 'ui';
    if (/scene|terrain|场景/.test(category)) return 'scene';
    const path = imageInfo(item).file || '';
    if (path.includes('portraits/')) return 'portraits';
    if (path.includes('actions')) return 'actors';
    if (path.includes('enemies/')) return 'enemies';
    if (path.includes('fx/')) return 'fx';
    if (path.includes('backgrounds/')) return 'backgrounds';
    if (path.includes('ui/')) return 'ui';
    if (/mechanism|props/.test(path)) return 'props';
    return 'scene';
  }
  function loadImage(info) {
    const url = imageURL(info);
    if (cache.has(url)) return cache.get(url);
    const entry = { image: new Image(), loaded: false, failed: false };
    entry.promise = new Promise((resolve) => {
      entry.image.onload = () => { entry.loaded = true; resolve(entry); };
      entry.image.onerror = () => { entry.failed = true; resolve(entry); };
    });
    entry.image.src = url;
    cache.set(url, entry);
    return entry;
  }
  function rectOf(item, fixedFrame) {
    const info = imageInfo(item);
    return (fixedFrame ? item.source_rect : item.content_rect) || item.source_rect || [0, 0, info.width || 1, info.height || 1];
  }
  function fittedDraw(context, item, x, y, width, height, fixedFrame, padding = 0.1) {
    if (!item) return;
    const entry = loadImage(imageInfo(item));
    if (!entry.loaded) return;
    const rect = rectOf(item, fixedFrame);
    if (!rect || rect.length < 4 || !rect[2] || !rect[3]) return;
    const ratio = Math.min(width * (1 - padding * 2) / rect[2], height * (1 - padding * 2) / rect[3]);
    const dw = rect[2] * ratio, dh = rect[3] * ratio;
    context.drawImage(entry.image, rect[0], rect[1], rect[2], rect[3], x + (width - dw) / 2, y + (height - dh) / 2, dw, dh);
  }
  function clearCanvas(canvas) { const context = canvas.getContext('2d'); context.clearRect(0, 0, canvas.width, canvas.height); return context; }
  function drawCard(card, tick) {
    const { canvas, item, animation } = card;
    const context = clearCanvas(canvas);
    let frameItem = item;
    if (animation && animation.frames && animation.frames.length) {
      const frame = animation.frames[tick % animation.frames.length];
      frameItem = sprites.find((sprite) => sprite.id === (typeof frame === 'string' ? frame : frame.id)) || item;
    }
    fittedDraw(context, frameItem, 0, 0, canvas.width, canvas.height, Boolean(animation), categoryOf(item) === 'backgrounds' ? 0 : 0.08);
    const entry = loadImage(imageInfo(frameItem));
    if (entry.failed) { context.fillStyle = '#8ba8ba'; context.font = '22px sans-serif'; context.textAlign = 'center'; context.fillText('原图尚未就绪', canvas.width / 2, canvas.height / 2); }
  }
  function spriteMatches(item) {
    if (activeTab !== 'all' && categoryOf(item) !== activeTab) return false;
    const query = $('asset-search').value.trim().toLowerCase();
    if (query && !`${item.id} ${item.label || ''} ${imageInfo(item).file || ''}`.toLowerCase().includes(query)) return false;
    if (activeTab !== 'actors') return true;
    const character = $('character-select').value;
    const state = $('state-select').value;
    const direction = $('direction-select').value;
    if (character !== 'all' && !`${item.id} ${item.label || ''} ${item.image}`.toLowerCase().includes(character)) return false;
    if (state !== 'all' && (item.state || '').toLowerCase() !== state && !item.id.toLowerCase().includes(state)) return false;
    if (direction !== 'all' && (item.direction || '').toLowerCase() !== direction && !item.id.toLowerCase().includes(direction)) return false;
    return true;
  }
  function makeCard(item, animation) {
    const button = document.createElement('button');
    button.className = 'asset-card'; button.type = 'button'; button.dataset.spriteId = item.id;
    if (animation) button.dataset.animationId = animation.id;
    const stage = document.createElement('div'); stage.className = 'card-stage';
    const canvas = document.createElement('canvas'); canvas.width = 440; canvas.height = 410; canvas.setAttribute('aria-label', item.label || item.id);
    stage.append(canvas);
    const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = animation ? 'ANIMATED / ' + animation.frames.length + ' FRAMES' : categoryOf(item) === 'actors' ? `${stateLabels[item.state] || item.state || 'POSE'} / ${stateLabels[item.direction] || item.direction || ''}` : labels[categoryOf(item)]; stage.append(chip);
    const details = document.createElement('div'); details.className = 'card-info';
    const title = document.createElement('strong'); title.textContent = animation ? (animation.label || animation.id) + ' · 动画' : item.label || item.id;
    const meta = document.createElement('p');
    const code = document.createElement('code'); code.textContent = item.id;
    const dimensions = document.createElement('span'); const rect = rectOf(item, Boolean(animation)); dimensions.textContent = `${rect[2]} × ${rect[3]}`;
    meta.append(code, dimensions); details.append(title, meta); button.append(stage, details);
    const card = { canvas, item, animation }; renderedCards.push(card);
    loadImage(imageInfo(item)).promise.then(() => drawCard(card, 0));
    button.addEventListener('click', () => openInspector(item, animation));
    return button;
  }
  function updateTabs() {
    const nav = $('tabs'); nav.replaceChildren();
    categories.forEach((category) => {
      const count = category === 'all' ? sprites.length : sprites.filter((s) => categoryOf(s) === category).length;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'tab' + (activeTab === category ? ' is-active' : ''); button.dataset.category = category; button.setAttribute('aria-pressed', activeTab === category ? 'true' : 'false');
      const text = document.createTextNode(labels[category]); const small = document.createElement('small'); small.textContent = count; button.append(text, small);
      button.addEventListener('click', () => { activeTab = category; updateTabs(); render(); }); nav.append(button);
    });
  }
  function render() {
    const grid = $('asset-grid'); grid.replaceChildren(); renderedCards = [];
    const list = sprites.filter(spriteMatches);
    $('actor-controls').hidden = activeTab !== 'actors'; $('fx-controls').hidden = activeTab !== 'fx'; $('ui-showcase').hidden = activeTab !== 'ui';
    if (activeTab === 'fx') {
      animations.forEach((animation) => {
        const first = (animation.frames || [])[0];
        const item = sprites.find((sprite) => sprite.id === (typeof first === 'string' ? first : first && first.id));
        if (item && categoryOf(item) === 'fx' && (! $('asset-search').value.trim() || spriteMatches(item))) grid.append(makeCard(item, animation));
      });
    }
    list.forEach((item) => grid.append(makeCard(item)));
    $('catalog-status').textContent = sprites.length ? `当前显示 ${list.length} 个素材切片${activeTab === 'fx' ? '，另含技能动画预览' : ''} · 点击卡片查看原始图集坐标` : '本地 catalog.js 尚未生成。请先运行素材目录构建脚本，再重新打开本页。';
    grid.dataset.visibleCount = list.length;
    if (!list.length) { const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = sprites.length ? '没有符合筛选条件的素材。试试其他角色或动作。' : '等待素材目录'; grid.append(empty); }
  }
  function openInspector(item, animation) {
    inspectorItem = { item, animation };
    $('inspector-title').textContent = item.label || item.id;
    $('inspector-category').textContent = labels[categoryOf(item)].toUpperCase() + (animation ? ' / ANIMATION' : ' / SOURCE REGION');
    const info = imageInfo(item), rect = rectOf(item, Boolean(animation));
    $('inspector-meta').textContent = `源图 ${info.width || '?'} × ${info.height || '?'} px　·　切片 ${rect[2]} × ${rect[3]} px　·　${animation ? '动画保留原始帧中心与透明留白' : '按实际透明边界显示，原图不做裁切改写'}`;
    $('inspector-source').textContent = `${info.file || item.image}\nsource_rect: [${(item.source_rect || []).join(', ')}]\ncontent_rect: [${(item.content_rect || []).join(', ')}]`;
    $('inspector-open').href = imageURL(info);
    $('asset-dialog').showModal(); drawInspector(0);
  }
  function drawInspector(tick) {
    if (!inspectorItem) return;
    const { item, animation } = inspectorItem;
    drawCard({ canvas: $('inspector-canvas'), item, animation }, tick);
  }
  function findSprite(pattern, category) { return sprites.find((item) => (!category || categoryOf(item) === category) && pattern.test(`${item.id} ${item.label || ''}`)); }
  function findActor(name, state, direction) {
    return sprites.find((item) => categoryOf(item) === 'actors' && `${item.id} ${item.image}`.toLowerCase().includes(name) && (item.state === state || item.id.includes(state)) && (item.direction === direction || item.id.includes(direction))) || findSprite(new RegExp(name, 'i'), 'actors');
  }
  function drawAt(context, item, x, baseline, width, height) { fittedDraw(context, item, x - width / 2, baseline - height, width, height, false, 0); }
  function drawStretched(context, item, x, y, width, height) {
    if (!item) return; const info = imageInfo(item), entry = loadImage(info); if (!entry.loaded) return;
    const rect = rectOf(item, false); context.drawImage(entry.image, ...rect, x, y, width, height);
  }
  function drawScene() {
    const canvas = $('scene-canvas'), context = clearCanvas(canvas), width = canvas.width, height = canvas.height;
    const backdrop = Object.values(images).find((info) => /gameplay-backdrop/.test(info.file || '')) || Object.values(images).find((info) => /background/.test(info.file || ''));
    if (backdrop) { const entry = loadImage(backdrop); if (entry.loaded) { const scale = Math.max(width / entry.image.width, height / entry.image.height); const dw = entry.image.width * scale, dh = entry.image.height * scale; context.drawImage(entry.image, (width - dw) / 2, (height - dh) / 2, dw, dh); } }
    const tint = context.createLinearGradient(0, 0, 0, height); tint.addColorStop(0, '#071a2b44'); tint.addColorStop(1, '#00182833'); context.fillStyle = tint; context.fillRect(0, 0, width, height);
    const platform = findSprite(/platform-middle|platform_middle|平台中段|平台主体/, 'scene') || findSprite(/platform|平台/, 'scene');
    const thin = findSprite(/platform-thin|platform_thin|薄平台/, 'scene') || platform;
    drawStretched(context, platform, -20, 455, 410, 72); drawStretched(context, platform, 375, 455, 395, 72); drawStretched(context, platform, 770, 455, 450, 72);
    drawStretched(context, platform, -15, 258, 365, 57); drawStretched(context, thin, 525, 264, 325, 42); drawStretched(context, thin, 935, 160, 300, 48);
    const ladder = findSprite(/ladder|梯/); drawAt(context, ladder, 310, 455, 40, 175); drawAt(context, ladder, 985, 455, 40, 246);
    drawAt(context, findSprite(/server|服务器/), 91, 455, 91, 128);
    drawAt(context, findSprite(/crate|木箱/), 372, 455, 62, 62);
    drawAt(context, findSprite(/lantern|灯笼|提灯/), 492, 455, 35, 73);
    drawAt(context, findSprite(/broadcast|terminal|广播/), 800, 264, 62, 86);
    drawAt(context, findSprite(/cube|数据/, 'props'), 922, 445, 49, 49);
    drawAt(context, findActor('grok', 'skill', 'right'), 194, 258, 140, 130);
    drawAt(context, findActor('claude', 'skill', 'right'), 658, 264, 116, 133);
    drawAt(context, findActor('glm', 'skill', 'left'), 1080, 455, 116, 138);
    drawAt(context, findActor('deepseek', 'skill', 'right'), 502, 423, 145, 132);
    drawAt(context, findSprite(/guard|安全无人机|守卫/, 'enemies'), 918, 160, 80, 72);
    const boat = findSprite(/boat|whale-ship|ship|母舰|鲸鱼艇/); if (boat) drawAt(context, boat, 160, 534, 205, 101);
    context.fillStyle = '#071526da'; context.fillRect(0, 0, width, 44); context.strokeStyle = '#4c849c77'; context.beginPath(); context.moveTo(0, 44); context.lineTo(width, 44); context.stroke();
    context.fillStyle = '#e7f6ff'; context.font = 'bold 17px "Microsoft YaHei", sans-serif'; context.fillText('鲸鱼魔盗团', 25, 29); context.fillStyle = '#94c7de'; context.font = '12px "Microsoft YaHei", sans-serif'; context.fillText('第四章 · 战报公开', 165, 28); context.fillStyle = '#75ddf5'; context.fillText('♥ 80 / 100', 930, 28); context.fillStyle = '#e3d09f'; context.fillText('任务 1 / 2', 1080, 28);
  }
  function frameLoop(now) {
    const tick = playing ? Math.floor((now - animationStart) / (1000 / speed)) : lastFrame < 0 ? 0 : lastFrame;
    if (tick !== lastFrame) { lastFrame = tick; renderedCards.filter((card) => card.animation).forEach((card) => drawCard(card, tick)); if ($('asset-dialog').open && inspectorItem && inspectorItem.animation) drawInspector(tick); }
    requestAnimationFrame(frameLoop);
  }
  $('image-count').textContent = Object.keys(images).length; $('sprite-count').textContent = sprites.length; $('animation-count').textContent = animations.length;
  document.body.classList.add('checker-on');
  $('checker-toggle').addEventListener('change', (event) => document.body.classList.toggle('checker-on', event.target.checked));
  ['character-select', 'state-select', 'direction-select'].forEach((id) => $(id).addEventListener('change', render));
  $('asset-search').addEventListener('input', render);
  $('fx-play').addEventListener('click', () => { playing = !playing; $('fx-play').textContent = playing ? '暂停播放' : '继续播放'; if (playing) animationStart = performance.now() - Math.max(0, lastFrame) * 1000 / speed; });
  $('fx-speed').addEventListener('input', (event) => { speed = Number(event.target.value); $('fx-speed-label').textContent = speed + ' FPS'; animationStart = performance.now(); });
  $('asset-dialog').addEventListener('click', (event) => { if (event.target === $('asset-dialog')) $('asset-dialog').close(); });
  $('asset-dialog').addEventListener('close', () => { inspectorItem = null; });
  updateTabs(); render();
  Promise.all(Object.values(images).map((info) => loadImage(info).promise)).then(() => { renderedCards.forEach((card) => drawCard(card, 0)); drawScene(); });
  requestAnimationFrame(frameLoop);
})();
