/* Mobile real-device adaptation repro. Uses real phone parameters
 * (deviceScaleFactor 2-3, coarse pointer, touch) against the dist build.
 * Quantifies shell/canvas/UI geometry and captures screenshots. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'output/mobile-adapt');
fs.mkdirSync(out, { recursive: true });
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const port = Number(process.env.QA_PORT || 8791);
const base = `http://127.0.0.1:${port}/`;
const report = { startedAt: new Date().toISOString(), viewports: [], diagnostics: [] };
const save = () => fs.writeFileSync(path.join(out, 'mobile-report.json'), JSON.stringify(report, null, 2));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const screen = (page, name) => page.waitForSelector(`#ui-root[data-screen="${name}"]`, { state: 'attached' });
const act = (page, action) => page.locator(`[data-action="${action}"]:visible`).first();

async function probe(page, label) {
  const data = await page.evaluate(() => {
    const box = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), display: cs.display, visibility: cs.visibility, fontSize: cs.fontSize }; };
    const canvas = document.getElementById('game-canvas');
    return {
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
      shell: box('.game-shell'),
      canvasCss: box('#game-canvas'),
      canvasBacking: canvas ? { w: canvas.width, h: canvas.height } : null,
      layers: [...document.querySelectorAll('canvas')].map(c => ({ id: c.id, w: c.width, h: c.height })),
      rotateHint: box('.rotate-hint'),
      screen: document.getElementById('ui-root')?.getAttribute('data-screen'),
    };
  });
  report.viewports.push({ label, ...data });
  return data;
}
async function overflow(page) {
  // Any visible element extending past the viewport is a mobile layout defect.
  // Decorative full-bleed backdrops (scale(1.01) bleed) are excluded by design.
  // Elements inside a scrollable ancestor that itself fits the viewport are
  // reachable by scrolling, so they are not defects.
  return page.evaluate(() => {
    const inViewport = r => r.x >= -0.5 && r.y >= -0.5 && r.x + r.width <= innerWidth + 0.5 && r.y + r.height <= innerHeight + 0.5;
    const scrollerOf = e => { let p = e.parentElement; while (p && p !== document.body) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowY)) return p; p = p.parentElement; } return null; };
    const bad = [];
    for (const e of document.querySelectorAll('.game-shell *')) {
      if (e.classList.contains('menu-backdrop') || e.classList.contains('results-backdrop')) continue;
      if (!e.getClientRects().length || getComputedStyle(e).visibility === 'hidden') continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.x >= -0.5 && r.y >= -0.5 && r.x + r.width <= innerWidth + 0.5 && r.y + r.height <= innerHeight + 0.5) continue;
      const sc = scrollerOf(e);
      if (sc && inViewport(sc.getBoundingClientRect()) && e.getBoundingClientRect().top >= sc.getBoundingClientRect().top - 0.5) continue;
      bad.push({ tag: e.tagName, cls: String(e.className).slice(0, 60), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
    }
    return bad.slice(0, 12);
  });
}
async function shot(page, name) { await page.screenshot({ path: path.join(out, name + '.png') }); }

let server, browser;
(async () => {
  try {
    server = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs'), '--port', String(port), '--root', path.join(root, 'dist')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let ready = false, serverError = '';
    server.stdout.on('data', d => { if (String(d).includes('Local:')) ready = true; });
    server.stderr.on('data', d => { serverError += String(d); });
    for (let i = 0; i < 100 && !ready && server.exitCode === null; i++) await sleep(50);
    assert(ready, 'server failed: ' + serverError);
    browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.QA_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });

    for (const vp of [
      { label: 'iphone-landscape-844x390-dsf3', width: 844, height: 390, deviceScaleFactor: 3 },
      { label: 'android-landscape-740x360-dsf2', width: 740, height: 360, deviceScaleFactor: 2 },
      { label: 'small-landscape-640x360-dsf3', width: 640, height: 360, deviceScaleFactor: 3 },
    ]) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: true, hasTouch: true });
      ctx.on('page', page => {
        page.on('pageerror', e => report.diagnostics.push({ vp: vp.label, type: 'pageerror', message: e.message }));
        page.on('console', m => { if (m.type() === 'error') report.diagnostics.push({ vp: vp.label, type: 'console', message: m.text() }); });
      });
      const page = await ctx.newPage();
      page.setDefaultTimeout(10000);
      await page.goto(base, { waitUntil: 'networkidle' });
      await screen(page, 'title');
      await page.locator('.loading-screen').waitFor({ state: 'hidden' });
      await sleep(300);
      const title = await probe(page, vp.label + '/title');
      const titleOverflow = await overflow(page);
      if (titleOverflow.length) report.diagnostics.push({ vp: vp.label, stage: 'title', overflow: titleOverflow });
      await shot(page, vp.label + '-title');
      // Geometry invariants
      assert(title.shell && title.shell.w > 0, 'shell has no size');
      assert(Math.abs(title.shell.w / title.shell.h - 16 / 9) < 0.02, 'shell not 16:9: ' + JSON.stringify(title.shell));
      assert(title.shell.w <= vp.width + 0.5 && title.shell.h <= vp.height + 0.5, 'shell exceeds viewport: ' + JSON.stringify(title.shell));
      const ratioCanvas = title.canvasCss.w / title.canvasCss.h;
      assert(Math.abs(ratioCanvas - 16 / 9) < 0.02, 'canvas css not 16:9: ' + JSON.stringify(title.canvasCss));
      if (title.canvasBacking) assert(Math.abs(title.canvasBacking.w / title.canvasBacking.h - 16 / 9) < 0.02, 'canvas backing not 16:9');
      // Enter a demo chapter for gameplay geometry
      await act(page, 'chapter-select').click(); await screen(page, 'chapter-select');
      await act(page, 'demo-select').click();
      await page.locator('[data-action="demo-start"][data-chapter-id="paper-window"]').click();
      await screen(page, 'none'); await page.locator('.loading-screen').waitFor({ state: 'hidden' });
      await sleep(400);
      const game = await probe(page, vp.label + '/gameplay');
      const gameOverflow = await overflow(page);
      if (gameOverflow.length) report.diagnostics.push({ vp: vp.label, stage: 'gameplay', overflow: gameOverflow });
      await shot(page, vp.label + '-gameplay');
      // Touch controls must be visible, >=44px and fully on screen
      const controls = await page.evaluate(() => [...document.querySelectorAll('.touch-controls button')].filter(b => b.getClientRects().length).map(b => { const r = b.getBoundingClientRect(); return { label: b.getAttribute('aria-label') || b.textContent.trim(), x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; }));
      assert(controls.length >= 6, 'touch controls missing: ' + JSON.stringify(controls));
      for (const c of controls) {
        assert(c.w >= 43.5 && c.h >= 43.5, 'touch control under 44px: ' + JSON.stringify(c));
        assert(c.x >= 0 && c.y >= 0 && c.x + c.w <= vp.width + 0.5 && c.y + c.h <= vp.height + 0.5, 'touch control off-screen: ' + JSON.stringify(c));
      }
      // Canvas backing must cover the canvas physical pixel grid (cssWidth*dpr).
      // The shell is a 16:9 letterbox, so the canvas does NOT span the viewport.
      if (game.canvasBacking && game.canvasCss) {
        const physical = game.canvasCss.w * vp.deviceScaleFactor;
        if (game.canvasBacking.w < physical * 0.98)
          report.diagnostics.push({ vp: vp.label, stage: 'backing', backing: game.canvasBacking.w, physical: Math.round(physical), shortfallPx: Math.round(physical - game.canvasBacking.w) });
        assert(game.canvasBacking.w >= physical * 0.98, `backing ${game.canvasBacking.w}px below physical ${Math.round(physical)}px on ${vp.label}`);
      }
      // Command panel reachability
      await page.locator('[data-teammate="Grok"]').click(); await screen(page, 'command');
      await sleep(200);
      const cmdOverflow = await overflow(page);
      if (cmdOverflow.length) report.diagnostics.push({ vp: vp.label, stage: 'command', overflow: cmdOverflow });
      const submit = await act(page, 'command-confirm').boundingBox();
      assert(submit && submit.y >= 0 && submit.y + submit.height <= vp.height, 'command-confirm off-screen: ' + JSON.stringify(submit));
      // The command panel must fit the viewport on short landscape phones; a
      // scrollbar is acceptable, clipped controls are not.
      assert.equal(cmdOverflow.length, 0, 'command overflow: ' + JSON.stringify(cmdOverflow));
      // The advanced row must be reachable: the panel keeps header/footer fixed
      // and scrolls .v3-command-body internally.
      const reachable = await page.evaluate(() => {
        const panel = document.querySelector('.v3-command-panel');
        const more = document.querySelector('.command-more');
        const body = document.querySelector('.v3-command-body');
        if (!panel || !more || !body) return false;
        body.scrollTop = body.scrollHeight;
        const p = panel.getBoundingClientRect(), m = more.getBoundingClientRect();
        return m.bottom <= p.bottom + 0.5 && m.top >= p.top - 0.5;
      });
      assert(reachable, 'command-more not reachable by scrolling');
      await shot(page, vp.label + '-command');
      await ctx.close();
      console.log('PASS ' + vp.label);
    }

    // Portrait -> landscape rotation flow on a phone
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      await page.goto(base, { waitUntil: 'networkidle' });
      await screen(page, 'title'); await page.locator('.loading-screen').waitFor({ state: 'hidden' });
      await sleep(200);
      const portrait = await probe(page, 'iphone-portrait-390x844/title');
      assert(portrait.rotateHint && portrait.rotateHint.display === 'flex', 'rotate hint not shown in portrait');
      assert(portrait.shell.visibility === 'hidden', 'shell visible in portrait');
      await shot(page, 'iphone-portrait-390x844');
      await page.setViewportSize({ width: 844, height: 390 });
      await sleep(400);
      const rotated = await probe(page, 'iphone-portrait-to-landscape/title');
      assert(rotated.shell.visibility !== 'hidden', 'shell hidden after rotating to landscape');
      assert(rotated.shell.w > 0 && rotated.shell.w <= 844.5, 'shell wrong after rotate: ' + JSON.stringify(rotated.shell));
      await shot(page, 'iphone-rotated-to-landscape');
      await ctx.close();
      console.log('PASS portrait-rotation-flow');
    }
    save();
    console.log(JSON.stringify({ status: 'ok', report: path.join(out, 'mobile-report.json') }));
  } catch (error) {
    report.fatal = error.stack; save();
    console.error('FAIL ' + error.stack);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (server) server.kill();
  }
})();
