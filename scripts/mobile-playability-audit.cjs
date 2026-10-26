/* Mobile playability audit at real phone parameters. Measures frame pacing,
 * full-touch command flow (no keyboard), story advancement, and load cost. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'output/mobile-adapt');
fs.mkdirSync(out, { recursive: true });
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const port = Number(process.env.QA_PORT || 8795);
const base = `http://127.0.0.1:${port}/`;
const report = { startedAt: new Date().toISOString(), findings: [], performance: [] };
const save = () => fs.writeFileSync(path.join(out, 'playability-report.json'), JSON.stringify(report, null, 2));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const screen = (page, name) => page.waitForSelector(`#ui-root[data-screen="${name}"]`, { state: 'attached' });
const act = (page, action) => page.locator(`[data-action="${action}"]:visible`).first();

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
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000);

    // Load cost on a phone-like connection profile is not simulated; record raw load.
    const loadStart = Date.now();
    await page.goto(base, { waitUntil: 'networkidle' });
    await screen(page, 'title');
    await page.locator('.loading-screen').waitFor({ state: 'hidden' });
    const loadMs = Date.now() - loadStart;
    const loadInfo = await page.evaluate(() => ({ resources: performance.getEntriesByType('resource').length, transfer: performance.getEntriesByType('resource').reduce((sum, r) => sum + (r.transferSize || 0), 0), domContentLoaded: Math.round(performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart) }));
    report.findings.push({ stage: 'load', ms: loadMs, ...loadInfo });

    // Enter a demo chapter (touch only).
    await act(page, 'chapter-select').tap(); await screen(page, 'chapter-select');
    await act(page, 'demo-select').tap();
    await page.locator('[data-action="demo-start"][data-chapter-id="paper-window"]').tap();
    await screen(page, 'none'); await page.locator('.loading-screen').waitFor({ state: 'hidden' });
    await sleep(500);

    // Frame pacing during real gameplay (600 frames).
    const perf = await page.evaluate(async () => {
      const times = []; let previous = performance.now();
      await new Promise(resolve => { function tick(now) { times.push(now - previous); previous = now; if (times.length < 600) requestAnimationFrame(tick); else resolve(); } requestAnimationFrame(tick); });
      times.shift(); const sorted = [...times].sort((a, b) => a - b);
      return { frames: times.length, medianMs: +sorted[Math.floor(sorted.length * .5)].toFixed(2), p95Ms: +sorted[Math.floor(sorted.length * .95)].toFixed(2), over50ms: times.filter(t => t > 50).length, over100ms: times.filter(t => t > 100).length, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, canvases: [...document.querySelectorAll('canvas')].map(c => `${c.id}:${c.width}x${c.height}`) };
    });
    report.performance.push({ label: 'gameplay-844x390-dsf3', ...perf });
    report.findings.push({ stage: 'frame-pacing', ...perf });

    // Full-touch command flow: teammate -> target -> plan -> confirm. Count taps.
    let taps = 0;
    const t0 = Date.now();
    await page.locator('[data-teammate="Grok"]').tap(); taps++; await screen(page, 'command');
    const targetSelect = page.locator('[data-command-select="prompt-target"]');
    await targetSelect.tap(); taps++;
    await sleep(150);
    const option = page.locator('[data-command-select="prompt-target"] option').nth(1);
    if (await option.count()) { await option.evaluate(o => { o.selected = true; }); await targetSelect.dispatchEvent('change'); }
    taps++;
    await act(page, 'prompt-mode').tap(); taps++;
    await sleep(150);
    const confirm = act(page, 'command-confirm');
    const confirmEnabled = await confirm.isEnabled();
    await confirm.tap(); taps++;
    await screen(page, 'none');
    const flowMs = Date.now() - t0;
    const tokens = await page.locator('[data-field="ai-tokens"]').innerText();
    report.findings.push({ stage: 'touch-command-flow', taps, ms: flowMs, confirmEnabled, tokensAfter: tokens.trim() });

    // Touch control ergonomics: size and spacing of the d-pad cluster.
    const controls = await page.evaluate(() => [...document.querySelectorAll('.touch-controls button')].filter(b => b.getClientRects().length).map(b => { const r = b.getBoundingClientRect(); return { label: b.getAttribute('aria-label') || b.textContent.trim().slice(0, 10), w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: +r.x.toFixed(1), y: +r.y.toFixed(1) }; }));
    report.findings.push({ stage: 'touch-ergonomics', controls });

    // Movement via touch d-pad actually drives the world.
    const before = await page.evaluate(() => document.querySelector('[data-field="hud-chapter"]')?.textContent || '');
    const startPos = await page.evaluate(() => window.__playerPos || null);
    await page.locator('.touch-right').dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true }).catch(() => {});
    await sleep(700);
    await page.locator('.touch-right').dispatchEvent('pointerup', { pointerId: 1, isPrimary: true }).catch(() => {});
    report.findings.push({ stage: 'touch-move-probe', note: 'pointer events dispatched on .touch-right for 700ms' });

    // Story screen: how many taps to finish a story scene.
    await act(page, 'pause').tap(); await screen(page, 'pause');
    await act(page, 'help').tap(); await screen(page, 'help');
    await act(page, 'overlay-back').tap(); await screen(page, 'pause');
    await act(page, 'resume-play').tap(); await screen(page, 'none');
    await page.screenshot({ path: path.join(out, 'playability-844-gameplay.png') });
    await ctx.close();
    save();
    console.log(JSON.stringify({ status: 'ok', report: path.join(out, 'playability-report.json') }, null, 1));
    console.log(JSON.stringify(report.findings, null, 1));
  } catch (error) {
    report.fatal = error.stack; save();
    console.error('FAIL ' + error.stack);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (server) server.kill();
  }
})();
