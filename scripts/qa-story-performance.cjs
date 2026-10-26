/* Observe the production build through normal UI actions. Canvas instrumentation
 * counts real paints without changing game state, input, or animation timing. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'output/story-performance-20261025/targeted');
const port = Number(process.env.QA_PORT || 18754);
const base = `http://127.0.0.1:${port}/`;
const report = { startedAt: new Date().toISOString(), target: 'dist', checks: [], diagnostics: [], performance: [], screenshots: [] };
fs.mkdirSync(out, { recursive: true });
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const action = (page, name) => page.locator(`[data-action="${name}"]:visible`).first();
const screen = (page, name) => page.waitForSelector(`#ui-root[data-screen="${name}"]`, { state: 'attached' });
let browser, server;

async function sample(page, label, duration = 1500) {
  const result = await page.evaluate(async duration => {
    const start = performance.now(), before = globalThis.__qaPaints;
    const intervals = []; let previous = start, callbacks = 0, running = true;
    function tick(now) { if (!running) return; callbacks++; intervals.push(now - previous); previous = now; requestAnimationFrame(tick); }
    requestAnimationFrame(tick);
    await new Promise(resolve => setTimeout(resolve, duration)); running = false;
    const elapsed = performance.now() - start, paints = globalThis.__qaPaints - before;
    intervals.shift(); intervals.sort((a, b) => a - b);
    return { durationMs: elapsed, paints, paintsPerSecond: paints * 1000 / elapsed,
      callbacksPerSecond: callbacks * 1000 / elapsed, p95CallbackMs: intervals[Math.floor(intervals.length * .95)],
      callbacksOver50ms: intervals.filter(value => value > 50).length,
      screen: document.querySelector('#ui-root').dataset.screen };
  }, duration);
  report.performance.push({ label, ...result }); save(); return result;
}

async function artCoverage(page, style, label) {
  await page.locator(`[data-action="story-style"][data-style="${style}"]`).click();
  await page.waitForTimeout(200);
  if (style === 'stage') await page.locator('canvas[data-stage-assets="ready"]').waitFor({ state: 'attached' });
  const art = await page.evaluate(async style => {
    const menu = document.querySelector('#menu-root');
    const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const imageElements = style === 'comic' ? [...menu.querySelectorAll('.comic-panel')] : [menu.querySelector('.story-backdrop')];
    const images = [];
    for (const element of imageElements) {
      const css = getComputedStyle(element);
      const match = /url\(["']?([^"')]+)["']?\)/.exec(css.backgroundImage);
      let loaded = false;
      if (match) { const image = new Image(); image.src = match[1]; try { await image.decode(); loaded = image.naturalWidth > 0; } catch {} }
      images.push({ ...rect(element), size: css.backgroundSize, loaded });
    }
    const buttons = [...menu.querySelectorAll('.story-heading button, [data-action="story-next"]')].map(element => {
      const r = rect(element), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { action: element.dataset.action, ...r, reachable: element === hit || element.contains(hit) };
    });
    return { frame: rect(menu), images, buttons };
  }, style);
  assert(art.images.every(image => image.loaded), `${label}: story art did not decode`);
  if (style !== 'comic') assert(art.images[0].size.split(',').every(size => size.trim() === 'cover'), `${label}: a background layer does not cover the frame`);
  const union = { left: Math.min(...art.images.map(r => r.left)), top: Math.min(...art.images.map(r => r.top)),
    right: Math.max(...art.images.map(r => r.right)), bottom: Math.max(...art.images.map(r => r.bottom)) };
  assert(union.left <= art.frame.left + 1 && union.top <= art.frame.top + 1 && union.right >= art.frame.right - 1 && union.bottom >= art.frame.bottom - 1, `${label}: story art leaves uncovered edges`);
  assert(art.buttons.every(button => button.reachable), `${label}: story controls are covered`);
  const paused = await sample(page, label + '-story-' + style, 750);
  assert.equal(paused.paints, 0, `${label}/${style}: gameplay canvas repaints behind story`);
  const file = `${label}-story-${style}.png`;
  await page.screenshot({ path: path.join(out, file) });
  report.screenshots.push(file); report.checks.push({ label, style, passed: true, ...art }); save();
}

(async () => {
  try {
    let ready = false, serverError = '';
    server = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs'), '--port', String(port), '--root', path.join(root, 'dist')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', data => { if (String(data).includes('Local:')) ready = true; });
    server.stderr.on('data', data => { serverError += String(data); });
    for (let i = 0; i < 100 && !ready && server.exitCode === null; i++) await delay(50);
    assert(ready, 'Own QA server failed: ' + serverError);
    browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.QA_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
    report.browser = browser.version();
    for (const device of [
      { label: 'desktop', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
      { label: 'touch-dpr3', viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    ]) {
      const { label, ...options } = device;
      const context = await browser.newContext(options);
      await context.addInitScript(() => {
        globalThis.__qaPaints = 0;
        const clear = CanvasRenderingContext2D.prototype.clearRect;
        CanvasRenderingContext2D.prototype.clearRect = function (...args) {
          if (this.canvas.id === 'game-canvas') globalThis.__qaPaints++;
          return Reflect.apply(clear, this, args);
        };
      });
      const page = await context.newPage();
      page.on('pageerror', error => report.diagnostics.push({ label, type: 'pageerror', message: error.message }));
      page.on('response', response => { if (response.status() >= 400) report.diagnostics.push({ label, type: 'http', url: response.url(), status: response.status() }); });
      await page.goto(base, { waitUntil: 'networkidle' }); await screen(page, 'title');
      await action(page, 'chapter-select').click(); await action(page, 'demo-select').click();
      await page.locator('[data-action="demo-start"][data-chapter-id="close-hatch"]').click();
      await screen(page, 'none'); await page.locator('.loading-screen').waitFor({ state: 'hidden' });
      const gameplay = await sample(page, label + '-gameplay');
      assert(gameplay.paints > 0 && gameplay.paintsPerSecond <= 62, `${label}: unexpected repaint cadence ${gameplay.paintsPerSecond}`);
      await action(page, 'pause').click(); await screen(page, 'pause'); await page.waitForTimeout(100);
      assert.equal((await sample(page, label + '-pause', 750)).paints, 0);
      await action(page, 'resume-play').click(); await screen(page, 'none');
      assert((await sample(page, label + '-resume', 750)).paints > 0);
      await action(page, 'pause').click(); await action(page, 'title').click(); await screen(page, 'title');
      assert.equal((await sample(page, label + '-title', 750)).paints, 0);
      await action(page, 'new-game').click(); await screen(page, 'story');
      for (const style of ['cinematic', 'stage', 'comic']) await artCoverage(page, style, label);
      await context.close(); console.log(`PASS ${label}: repaint cadence, overlay idle, resume, three full-frame story styles`);
    }
    assert.deepEqual(report.diagnostics, []);
    report.passed = true;
  } catch (error) { report.passed = false; report.error = error.stack; console.error(error.stack); process.exitCode = 1; }
  finally { if (browser) await browser.close(); if (server) server.kill(); report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ passed: report.passed, report: path.join(out, 'report.json') })); }
})();
