/* Real production-browser acceptance. Requires Playwright and Edge/Chromium.
 * Each run owns its HTTP server and isolated browser storage. Targeted save
 * regressions explicitly seed synthetic fixtures and inject storage failures;
 * the gameplay acceptance flows use ordinary inputs. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const crypto = require('node:crypto');
const runFile = promisify(execFile);
const root = path.resolve(__dirname, '..');
const out = path.resolve(root, process.env.QA_OUT || 'output/final-acceptance');
fs.mkdirSync(out, { recursive: true });
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const port = Number(process.env.QA_PORT || 8773);
const base = `http://127.0.0.1:${port}/`;
const report = { startedAt: new Date().toISOString(), target: 'dist', checks: [], diagnostics: [], screenshots: [], performance: [] };
const save = () => fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2));
function buildConsistency() {
  const entries=fs.readdirSync(path.join(root,'dist'),{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).sort((a,b)=>path.join(a.parentPath,a.name).localeCompare(path.join(b.parentPath,b.name)));
  let codeFiles=0,assetFiles=0;const hash=crypto.createHash('sha256');
  for(const entry of entries){
    const file=path.join(entry.parentPath,entry.name),relative=path.relative(path.join(root,'dist'),file);
    const source=path.join(root,relative.endsWith('.js')?relative.slice(0,-3)+'.mjs':relative);
    if(/\.(?:js|css|html)$/.test(relative)) {assert.equal(fs.readFileSync(file,'utf8'),fs.readFileSync(source,'utf8').replaceAll('.mjs','.js'),relative);codeFiles++;}
    else {assert.deepEqual(fs.readFileSync(file),fs.readFileSync(source),relative);assetFiles++;}
    hash.update(relative.replaceAll('\\','/'));hash.update(fs.readFileSync(file));
  }
  return {codeFiles,assetFiles,sha256:hash.digest('hex')};
}
let server, browser, currentPage;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const act = (page, action) => page.locator(`[data-action="${action}"]:visible`).first();
const screen = (page, name) => page.waitForSelector(`#ui-root[data-screen="${name}"]`, { state: 'attached' });
async function shot(page, name, selector) {
  if (selector) await page.locator(selector).screenshot({ path: path.join(out, name + '.png') });
  else await page.screenshot({ path: path.join(out, name + '.png') });
  report.screenshots.push(name + '.png'); save();
}
async function test(name, run) {
  if (process.env.QA_FILTER && !name.includes(process.env.QA_FILTER)) return;
  const start = Date.now();
  try { const result = await run(); report.checks.push({ name, passed: true, durationMs: Date.now() - start, ...result }); console.log('PASS ' + name); }
  catch (error) {
    report.checks.push({ name, passed: false, durationMs: Date.now() - start, error: error.stack });
    console.error('FAIL ' + name + '\n' + error.stack);
    if (currentPage && !currentPage.isClosed()) await shot(currentPage, 'failure-' + report.checks.length).catch(() => {});
  }
  if(currentPage && !currentPage.isClosed()) await currentPage.context().close();
  save();
}
async function context(options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...options });
  ctx.on('page', page => {
    page.on('pageerror', error => report.diagnostics.push({ type: 'pageerror', url: page.url(), message: error.message }));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) report.diagnostics.push({ type: message.type(), url: page.url(), message: message.text() }); });
    page.on('response', response => { if (response.status() >= 400) report.diagnostics.push({ type: 'http', url: response.url(), status: response.status() }); });
  });
  const page = await ctx.newPage(); currentPage = page;
  page.setDefaultTimeout(10000);
  await page.goto(base, { waitUntil: 'networkidle' }); await screen(page, 'title');
  await page.locator('.loading-screen').waitFor({ state: 'hidden' });
  return { ctx, page };
}
async function title(page) { await act(page, 'pause').click(); await screen(page, 'pause'); await act(page, 'title').click(); await screen(page, 'title'); }
async function demo(page, chapter) {
  await act(page, 'chapter-select').click(); await screen(page, 'chapter-select');
  await act(page, 'demo-select').click();
  await page.locator(`[data-action="demo-start"][data-chapter-id="${chapter}"]`).click();
  await screen(page, 'none'); await page.locator('.loading-screen').waitFor({ state: 'hidden' });
}
async function dimensions(page, selector) {
  return page.locator(selector).evaluateAll(elements => elements.filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').map(e => {
    const r = e.getBoundingClientRect(); return { label: e.getAttribute('aria-label') || e.textContent.trim().slice(0, 30), x: r.x, y: r.y, w: r.width, h: r.height, font: parseFloat(getComputedStyle(e).fontSize) };
  }));
}
async function performanceSample(page, label) {
  const sample = await page.evaluate(async () => {
    const times = []; let previous = performance.now();
    await new Promise(resolve => { function tick(now) { times.push(now - previous); previous = now; if (times.length < 600) requestAnimationFrame(tick); else resolve(); } requestAnimationFrame(tick); });
    times.shift(); times.sort((a,b) => a-b);
    return { frames: times.length, medianMs: times[Math.floor(times.length * .5)], p95Ms: times[Math.floor(times.length * .95)], over50ms: times.filter(t => t > 50).length, memory: performance.memory ? { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize } : null, canvases: [...document.querySelectorAll('canvas')].map(c => ({id:c.id,width:c.width,height:c.height})), resources: performance.getEntriesByType('resource').length };
  });
  report.performance.push({ label, ...sample }); save(); return sample;
}
async function finishPrologue(page) {
  for (let i = 0; i < 40; i++) {
    if (await page.locator('#ui-root').getAttribute('data-screen') === 'none') return;
    const choice = act(page, 'story-choice'); if (await choice.count()) await choice.click();
    await act(page, 'story-next').click(); await page.waitForTimeout(60);
  }
  throw new Error('Prologue did not reach playable tutorial');
}
(async () => {
  try {
    server = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs'), '--port', String(port), '--root', path.join(root, 'dist')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let ready = false, serverError = '';
    server.stdout.on('data', data => { if (String(data).includes('Local:')) ready = true; });
    server.stderr.on('data', data => { serverError += String(data); });
    for (let i = 0; i < 100 && !ready && server.exitCode === null; i++) await sleep(50);
    assert(ready, 'Own QA server failed: ' + serverError);
    browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.QA_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
    report.browser = browser.version();
    await test('Production HTTP assets, MIME, HEAD, path boundaries and 128 concurrent requests',async()=>{
      const result=await runFile(process.execPath,[path.join(root,'scripts/check-http.mjs'),base],{windowsHide:true});
      return {http:JSON.parse(result.stdout.trim())};
    });
    await test('Production code and assets exactly match the current source build',async()=>{
      report.build=buildConsistency();return report.build;
    });
    await test('Production title, settings, invalid import, chapter locks and four challenge contracts', async () => {
      const {ctx,page} = await context();
      await shot(page, 'desktop-title');
      await act(page, 'settings-open').click(); await screen(page, 'settings');
      for (const tab of ['audio','controls','accessibility','system']) {
        await page.locator(`[data-tab="${tab}"]`).click();
        assert.equal(await page.locator(`[data-tab="${tab}"]`).getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator(`[data-tab="${tab}"]`).evaluate(e => e === document.activeElement), true);
      }
      await page.locator('.save-tools summary').click();
      const before = await page.evaluate(() => JSON.stringify(localStorage));
      await page.locator('[data-import-text]').fill('{bad'); await act(page,'save-import').click();
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), before);
      await shot(page,'desktop-settings');
      await act(page,'settings-back').click(); await act(page,'chapter-select').click();
      assert.equal(await page.locator('.v3-chapter-card.is-locked').count(),4);
      await shot(page,'desktop-chapters');
      await page.locator('[data-action="contracts-open"]:not([disabled])').click(); await screen(page,'contracts');
      assert.equal(await page.locator('[data-action="contract-select"]').count(),4);
      await page.locator('[data-contract-id="low-budget"]').click();
      assert.equal(await page.locator('[data-contract-start]').getAttribute('data-contract-id'),'low-budget');
      await shot(page,'desktop-contracts');
      await act(page,'challenge-start').click(); await screen(page,'none'); await page.locator('.loading-screen').waitFor({state:'hidden'});
      assert.equal((await page.locator('[data-field="hud-qualifiers"]').innerText()).trim(),'1');
      await ctx.close();
    });
    await test('Bug fixes: completed save recovery, export, failed imports and tutorial review', async () => {
      // Explicit synthetic fixtures in this test's isolated browser context.
      const {syntheticCampaignSave} = await import('./lib/synthetic-campaign.mjs');
      const complete=syntheticCampaignSave(5),previous=syntheticCampaignSave(4);
      const {ctx,page} = await context();
      await page.evaluate(({complete,previous})=>{
        localStorage.setItem('whale-heist:campaign:v1',JSON.stringify(complete.campaign));
        localStorage.setItem('whale-heist:experience:v2',JSON.stringify({version:2,savedAt:'2026-10-25T00:00:00Z',
          chapterId:'close-hatch',campaign:previous.campaign,current:null,checkpoint:null,checkpointLabel:'synthetic old checkpoint'}));
      },{complete,previous});
      await page.reload({waitUntil:'networkidle'}); await screen(page,'title');
      assert.match(await page.locator('.title-status').innerText(),/返航|完成/);
      await act(page,'settings-open').click(); await page.locator('[data-tab="system"]').click();
      await page.locator('.save-tools summary').click();
      const downloadPromise=page.waitForEvent('download'); await act(page,'save-export').click();
      const download=await downloadPromise,exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
      assert.equal(exported.campaign.campaign.completed,true); assert.equal(exported.experience.chapterId,'campaign-complete');
      const before=await page.evaluate(()=>JSON.stringify(localStorage));
      await page.evaluate(()=>{window.syntheticOriginalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Synthetic quota failure','QuotaExceededError');};});
      await page.locator('[data-import-text]').fill(JSON.stringify(previous)); await act(page,'save-import').click();
      await page.waitForFunction(()=>document.querySelector('#toast-root').textContent.includes('导入失败'));
      assert.equal(await page.locator('#ui-root').getAttribute('data-screen'),'settings');
      assert.equal(await page.evaluate(()=>JSON.stringify(localStorage)),before);
      await shot(page,'save-import-failure');
      await page.evaluate(()=>{Storage.prototype.setItem=window.syntheticOriginalSet;delete window.syntheticOriginalSet;});
      await act(page,'settings-back').click(); await screen(page,'title');
      assert.match(await page.locator('.title-status').innerText(),/航程已完成/);
      assert.equal(await act(page,'resume').count(),0);
      assert.equal(await page.locator('.title-actions [data-action="chapter-select"]').innerText(),'再次出发');
      await shot(page,'completed-campaign');
      await demo(page,'paper-window'); await act(page,'pause').click(); await act(page,'help').click();
      await act(page,'tutorial-restart').click(); await screen(page,'help');
      assert.equal(await page.locator('.tutorial-review li').count(),11);
      assert.match(await page.locator('.v3-panel-heading h2').innerText(),/教程回顾/);
      await page.locator('.tutorial-review details summary').first().click();
      assert.equal(await page.locator('.tutorial-review details').first().getAttribute('open'),'');
      await shot(page,'tutorial-review');
      await act(page,'tutorial-restart').click(); assert.equal(await page.locator('.tutorial-review').count(),0);
      await act(page,'overlay-back').click(); await screen(page,'pause');
      await act(page,'resume-play').click(); await screen(page,'none');
      await ctx.close();
    });
    await test('Five production chapters, cancel via Enter, one charge on double confirm, map, records, guide, story replay', async () => {
      const {ctx,page} = await context();
      for (const [index,id] of ['paper-window','resume-storm','review-quietly','public-report','close-hatch'].entries()) {
        await demo(page,id); await shot(page,`desktop-chapter-${index+1}`);
        const before = Number(await page.locator('[data-field="ai-tokens"]').innerText());
        if(index===3) {
          await page.locator('[data-teammate="Grok"]').click();
          await page.waitForFunction(()=>document.querySelector('#toast-root').textContent.includes('当前房间没有'));
          assert.equal(await page.locator('#ui-root').getAttribute('data-screen'),'none');
        }
        await page.locator(`[data-teammate="${index>=3?'GLM':'Grok'}"]`).click(); await screen(page,'command');
        await act(page,'command-cancel').focus(); await page.keyboard.press('Enter'); await screen(page,'none');
        assert.equal(Number(await page.locator('[data-field="ai-tokens"]').innerText()),before);
        if(index===1) {
          await page.locator('[data-teammate="Grok"]').click(); await act(page,'ui-command-forecast').click();
          await shot(page,'desktop-command');
          assert.equal(await act(page,'command-confirm').isEnabled(),true);
          const rect = await act(page,'command-confirm').boundingBox();
          await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2,{clickCount:2,delay:40}); await screen(page,'none');
          assert.equal(Number(await page.locator('[data-field="ai-tokens"]').innerText()),before-1);
          await act(page,'pause').click(); await act(page,'help').click(); await screen(page,'help'); await shot(page,'desktop-help');
          await act(page,'overlay-back').click(); await screen(page,'pause'); await act(page,'resume-play').click();
        }
        if(index===4) {
          await performanceSample(page,'desktop-1280x720-standard');
          await act(page,'map-open').click(); await screen(page,'map'); await shot(page,'desktop-map');
          await act(page,'story-replay').click(); await screen(page,'story');
          await act(page,'story-skip').click(); await screen(page,'map');
          await act(page,'records-open').click(); await screen(page,'records'); await shot(page,'desktop-records');
          await act(page,'overlay-back').click(); await screen(page,'map'); await act(page,'overlay-back').click();
          for(let n=0;n<60;n++) {
            await act(page,'pause').click(); await screen(page,'pause');
            await act(page,'resume-play').click(); await screen(page,'none');
          }
          await performanceSample(page,'desktop-after-120-pause-transitions');
        }
        await title(page);
      }
      assert.equal(await page.locator('[data-action="resume"]').count(),0,'Demo wrote a campaign save');
      await ctx.close();
    });
    await test('Prologue choices, three story styles, first tutorial input, pause, reload and resume', async () => {
      const {ctx,page} = await context();
      await act(page,'new-game').click(); await screen(page,'story'); await page.locator('.loading-screen').waitFor({state:'hidden'});
      for(const style of ['cinematic','stage','comic']) {
        await page.locator(`[data-action="story-style"][data-style="${style}"]`).click();
        assert.equal(await page.locator('#menu-root').getAttribute('data-story-style'),style);
        if(style==='stage') await page.locator('canvas[data-stage-assets="ready"]').waitFor({state:'attached'});
        await page.waitForTimeout(120); await shot(page,`desktop-story-${style}`);
      }
      await page.locator('[data-action="story-style"][data-style="cinematic"]').click(); await act(page,'story-skip').click();
      await screen(page,'none');
      assert.equal(await page.locator('[data-action="story-choice"]:visible').count(),0,'short departure must not leave a mandatory choice');
      assert.equal((await page.locator('[data-v3="tutorial-count"]').innerText()).trim(),'1 / 10');
      await page.keyboard.down('d'); await page.waitForTimeout(620); await page.keyboard.up('d'); await page.waitForTimeout(100);
      assert.equal((await page.locator('[data-v3="tutorial-count"]').innerText()).trim(),'2 / 10');
      await shot(page,'desktop-tutorial'); await act(page,'pause').click(); await screen(page,'pause');
      const elapsed=await page.locator('[data-field="time"]').innerText(); await page.waitForTimeout(300);
      assert.equal(await page.locator('[data-field="time"]').innerText(),elapsed);
      await page.reload({waitUntil:'networkidle'}); await screen(page,'title');
      await act(page,'resume').click(); await screen(page,'none');
      await page.locator('.loading-screen').waitFor({state:'hidden'});
      await page.waitForFunction(()=>document.querySelector('[data-v3="tutorial-count"]')?.textContent.trim()==='2 / 10');
      assert.equal((await page.locator('[data-v3="tutorial-count"]').innerText()).trim(),'2 / 10');
      await ctx.close();
    });
    for (const viewport of [{width:844,height:390},{width:740,height:360},{width:640,height:360}]) {
      await test(`Touch landscape ${viewport.width}x${viewport.height}, command reachability, safe bounds, portrait recovery`, async () => {
        const {ctx,page}=await context({viewport,isMobile:true,hasTouch:true,deviceScaleFactor:1});
        await demo(page,'close-hatch'); await page.locator('.touch-controls').waitFor();
        const controls=await dimensions(page,'.touch-controls button'); assert.equal(controls.length,7);
        for(const c of controls) { assert(c.w>=43.5&&c.h>=43.5,JSON.stringify(c)); assert(c.x>=0&&c.y>=0&&c.x+c.w<=viewport.width+.5&&c.y+c.h<=viewport.height+.5,JSON.stringify(c)); }
        await shot(page,`mobile-${viewport.width}-gameplay`);
        await page.locator('[data-teammate="GLM"]').click(); await screen(page,'command');
        const submit=await act(page,'command-confirm').boundingBox(); assert(submit&&submit.y>=0&&submit.y+submit.height<=viewport.height);
        await shot(page,`mobile-${viewport.width}-command`);
        await act(page,'ui-command-more').click();
        await page.locator('[data-command-text]').fill('不是有效指令 <script>alert(1)</script>'); await act(page,'prompt-parse').click();
        assert.equal(await act(page,'command-confirm').isDisabled(),true);
        await shot(page,`mobile-${viewport.width}-invalid-command`);
        await page.keyboard.press('Escape'); await screen(page,'none');
        await page.setViewportSize({width:390,height:844}); await page.locator('.rotate-hint').waitFor();
        await page.setViewportSize(viewport); await screen(page,'pause');
        await page.keyboard.press('Escape'); await screen(page,'none');
        if(viewport.width===844) await performanceSample(page,'touch-emulation-844x390-standard');
        await title(page); await act(page,'new-game').click(); await screen(page,'story');
        await page.waitForTimeout(1200);
        const choices=await dimensions(page,'[data-action="story-choice"]');
        assert.equal(choices.length,0,'short departure has no mandatory single-option choices');
        const headings=await dimensions(page,'.story-heading button');
        for(const c of headings) assert(c.y>=0&&c.y+c.h<=viewport.height,JSON.stringify(c));
        await act(page,'story-next').scrollIntoViewIfNeeded();
        const next=await dimensions(page,'[data-action="story-next"]');
        assert(next[0].y>=0 && next[0].y+next[0].h<=viewport.height,JSON.stringify(next));
        await shot(page,`mobile-${viewport.width}-story`); await ctx.close();
        return {controls,choices,headings,next};
      });
    }
    await test('Read-only story theater, all three styles and original-art preview', async () => {
      const {ctx,page}=await context(); await page.goto(base+'story-theater.html',{waitUntil:'networkidle'});
      const before=await page.evaluate(()=>JSON.stringify(localStorage));
      for(const style of ['cinematic','stage','comic']) {
        await page.locator(`.style-selector [data-style="${style}"]`).click();
        assert.equal(await page.locator(`.style-selector [data-style="${style}"]`).getAttribute('aria-pressed'),'true');
        if(style==='stage') { await page.waitForLoadState('networkidle'); assert(await page.locator('#stage-canvas').isVisible()); }
        await page.waitForTimeout(500); await shot(page,`theater-${style}`,'.screen');
      }
      await page.locator('[data-art-path]').first().click(); await page.locator('#art-preview').waitFor({state:'visible'});
      assert(await page.locator('#preview-image').evaluate(e=>e.complete&&e.naturalWidth>0));
      await page.locator('#preview-close').click(); assert.equal(await page.evaluate(()=>JSON.stringify(localStorage)),before);
      const scenes=page.locator('#scene-nav button'),branches=[];
      for(let index=0;index<await scenes.count();index++) {
        await scenes.nth(index).click();
        if((await page.locator('#play').innerText()).includes('暂停')) await page.locator('#play').click();
        const values=await page.locator('#branch-select option').evaluateAll(es=>es.map(e=>e.value));
        for(const value of values){if(values.length>1)await page.locator('#branch-select').selectOption(value);assert((await page.locator('#play-status').innerText()).includes(`分支 ${Number(value)+1} / ${values.length}`));}
        branches.push({scene:index+1,variants:values.length});
      }
      assert.equal(await page.evaluate(()=>JSON.stringify(localStorage)),before);
      await ctx.close();
      return {branches};
    });
    await test('All 13 room render fixtures use current production modules, assets and HUD',async()=>{
      const {ctx,page}=await context();
      // This isolated document deliberately has no main-loop script. It is a
      // labelled rendering fixture, not evidence of navigating/clearing rooms.
      const html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8').replace(/<script type="module" src="src\/main\.js"><\/script>/,'');
      await page.route(base+'__qa_scene__.html',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:html}));
      await page.goto(base+'__qa_scene__.html',{waitUntil:'networkidle'});
      const rooms=await page.evaluate(async()=>{
        const [{GameCore},{CHAPTERS},{getMap},{getChapterRooms},{chapterCheckpoint},{GameWorld},{GameRenderer,sceneImageKeys},{AssetLibrary},{GameUI},{DEFAULT_SETTINGS}]=await Promise.all([
          import('./src/core/state.js'),import('./src/core/chapters.js'),import('./src/game/maps.js'),import('./src/game/rooms.js'),import('./src/game/session.js'),import('./src/game/world.js'),import('./src/render/scene-renderer.js'),import('./src/render/assets.js'),import('./src/ui/ui.js'),import('./src/game/preferences.js')]);
        const url=new URL('assets/runtime-catalog.json',location.href),assets=new AssetLibrary(await(await fetch(url)).json(),url);
        await assets.preload(sceneImageKeys(CHAPTERS[4]));
        const ui=new GameUI(),renderer=new GameRenderer(document.querySelector('#game-canvas'),assets);
        const label=document.createElement('div');label.textContent='视觉验收夹具 · 非通关截图';label.style.cssText='position:absolute;top:10%;right:2%;z-index:150;background:#071c31;color:#ffdf9d;font:12px sans-serif;padding:5px;pointer-events:none';document.querySelector('#game-shell').append(label);
        globalThis.qaRoomFixture={GameCore,CHAPTERS,getMap,getChapterRooms,chapterCheckpoint,GameWorld,ui,renderer,DEFAULT_SETTINGS};
        return CHAPTERS.flatMap(chapter=>getChapterRooms(chapter.id).map((room,index)=>({chapterId:chapter.id,chapter:chapter.number,index,id:room.id,name:room.name})));
      });
      assert.equal(rooms.length,13);
      for(const room of rooms){
        await page.evaluate(room=>{
          const q=globalThis.qaRoomFixture,core=new q.GameCore({checkpoint:q.chapterCheckpoint(room.chapterId),persist:false});
          const world=new q.GameWorld(core,q.getMap(room.chapterId),{expanded:true});
          if(room.index){world.captureRoom();world.loadRoom(world.rooms[room.index]);}
          const snapshot=world.snapshot();snapshot.rooms=world.rooms.map(r=>({id:r.id,name:r.name,optional:r.optional,current:r.id===world.currentRoom.id}));
          q.ui.update({core:core.view(),world:snapshot,mode:'demo',settings:q.DEFAULT_SETTINGS,unlocked:5});q.ui.show('none');q.ui.setLoading(1);
          q.renderer.render(world,core.view(),{reduceMotion:true,quality:'standard'});
        },room);
        await page.locator('.loading-screen').waitFor({state:'hidden'});
        await page.waitForTimeout(100);await shot(page,`fixture-c${room.chapter}-room${room.index+1}`);
      }
      await ctx.close();return{rooms};
    });
    await test('Player upgrade: real next action, optional route, 1-Enter confirmation, distinct role labels and visible scan risk', async()=>{
      const {ctx,page}=await context();
      await act(page,'new-game').click();await screen(page,'story');
      assert.match(await page.locator('[data-v3="story-count"]').innerText(),/2/);
      assert.equal(await act(page,'story-choice').count(),0);
      await act(page,'story-skip').click();await screen(page,'none');
      assert.match(await page.locator('[data-v3="objective-summary"]').innerText(),/收集资料 0\/4/);
      assert.match(await page.locator('[data-v3="objective-progress"]').innerText(),/背包 0\/3/);
      await act(page,'route-toggle').click();assert.equal(await act(page,'route-toggle').getAttribute('aria-pressed'),'true');
      await shot(page,'upgraded-guidance');
      await title(page);await demo(page,'paper-window');
      const before=Number(await page.locator('[data-field="ai-tokens"]').innerText());
      await page.keyboard.press('1');await screen(page,'command');
      assert.equal(await page.evaluate(()=>document.activeElement?.dataset.action),'command-confirm','keyboard shortcut should focus confirmation rather than the select');
      assert.equal(await page.locator('[data-v3="command-default-name"]').innerText(),'连续破障');
      await page.keyboard.press('Enter');await screen(page,'none');
      assert.equal(Number(await page.locator('[data-field="ai-tokens"]').innerText()),before-1);
      await title(page);await demo(page,'review-quietly');await page.keyboard.press('3');await screen(page,'command');
      assert.equal(await page.locator('[data-v3="command-default-name"]').innerText(),'广域扫描');
      assert.equal(await page.locator('[data-v3="command-precise-name"]').innerText(),'精准扫描');
      assert.match(await page.locator('[data-v3="command-risk"]').innerText(),/警戒器/);
      assert(await page.locator('[data-v3="command-risk"]').isVisible());
      await shot(page,'upgraded-scan-command');
      await page.locator('[data-action="prompt-mode"][data-precise="true"]').click();
      assert.match(await page.locator('[data-v3="command-cost"]').innerText(),/Token × 2/);
      await page.keyboard.press('Escape');await screen(page,'none');await title(page);
      await demo(page,'resume-storm');await page.keyboard.press('2');await screen(page,'command');
      assert.equal(await page.locator('[data-v3="command-default-name"]').innerText(),'引开多人');
      assert.equal(await page.locator('[data-v3="command-precise-name"]').innerText(),'只引一人');
      await ctx.close();
      return{keyboard:'1 → Enter spends exactly one token',departureBeats:2,rolePlans:6,scanRiskVisible:true};
    });
    await test('No browser exceptions, failed resources or source/build drift during acceptance', async()=>{assert.deepEqual(report.diagnostics,[]);assert.deepEqual(buildConsistency(),report.build);});
  } catch(error) { report.fatal=error.stack; console.error(error.stack); }
  finally {
    if(browser) await browser.close(); if(server) server.kill();
    report.finishedAt=new Date().toISOString(); report.passed=report.checks.filter(c=>c.passed).length; report.failed=report.checks.filter(c=>!c.passed).length;
    save(); console.log(JSON.stringify({suite:'production-browser',passed:report.passed,failed:report.failed,fatal:report.fatal||null,report:path.join(out,'browser-report.json')}));
    if(report.failed||report.fatal) process.exitCode=1;
  }
})();
