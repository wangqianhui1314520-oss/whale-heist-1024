/* Production UI regressions. Fixtures and browser storage are isolated from player saves. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output/tutorial-free-play-20261026');
const port = Number(process.env.QA_PORT || 8791), url = `http://127.0.0.1:${port}/`;
const report = { checks: [], diagnostics: [] };
const visibleAction = (page, action) => page.locator(`[data-action="${action}"]:visible`).first();
const screen = (page, name) => page.waitForSelector(`#ui-root[data-screen="${name}"]`, { state: 'attached' });
let browser, server;

async function fixture(kind) {
  const { harness } = await import('./lib/main-harness.mjs');
  const { api, items } = await harness(); await api.startWorld({ showIntro: false });
  const { tutorial, world } = api.state;
  if (kind.startsWith('command')) {
    for (const [type, payload] of [
      ['move', { reached: true }], ['climb', { reached: true, grounded: true }], ['jump', { grounded: true, crossedGap: true }],
      ['node-hit', { nodeId: world.nodes[0].id, hp: 1, attackId: 'fixture-first' }],
      ['node-open', { nodeId: world.nodes[0].id, hp: 0, attackId: 'fixture-second' }],
    ]) assert.equal(tutorial.handleEvent(type, payload).ok, true);
    tutorial.guidedCommandStage = kind === 'command-stale' ? 4 : 0;
  }
  if (kind === 'old-room-save') world.loadRoom(world.rooms.find(room => room.index === 2));
  api.persist(); return [...items];
}
async function open(kind = 'fresh', mobile = false) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 720 } });
  const entries = await fixture(kind);
  await ctx.addInitScript(({ entries, origin }) => {
    if (location.origin === origin && !sessionStorage.getItem('tutorial-fixture-seeded')) {
      for (const [key, value] of entries) localStorage.setItem(key, value);
      sessionStorage.setItem('tutorial-fixture-seeded', 'true');
    }
  }, { entries, origin: new URL(url).origin });
  const page = await ctx.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => report.diagnostics.push(error.message));
  page.on('response', response => { if (response.status() >= 400) report.diagnostics.push(`${response.status()} ${response.url()}`); });
  await page.goto(url, { waitUntil: 'networkidle' }); await screen(page, 'title');
  await page.locator('.loading-screen').waitFor({ state: 'hidden' });
  await visibleAction(page, 'resume').click(); await screen(page, 'none');
  await page.locator('.loading-screen').waitFor({ state: 'hidden' });
  return { ctx, page };
}
async function test(name, run) {
  try { await run(); report.checks.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { report.checks.push({ name, passed: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  try {
    server = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs'), '--port', String(port), '--root', path.join(root, 'dist')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('QA server startup timeout')), 10000);
      server.on('error', reject); server.stderr.on('data', data => { clearTimeout(timeout); reject(new Error(String(data))); });
      server.stdout.on('data', data => { if (String(data).includes('Local:')) { clearTimeout(timeout); resolve(); } });
    });
    browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.QA_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
    for (const kind of ['command', 'command-stale']) await test(`${kind}: confirm and precise plan remain usable at unfinished tutorial stages`, async () => {
      const { ctx, page } = await open(kind);
      try {
        await visibleAction(page, 'command-select').click(); await screen(page, 'command');
        assert.equal(await visibleAction(page, 'command-confirm').isEnabled(), true);
        assert.equal(await page.locator('[data-action="prompt-mode"][data-precise="true"]').isEnabled(), true);
        await page.locator('[data-action="prompt-mode"][data-precise="true"]').click();
        assert.equal(await page.locator('[data-action="prompt-mode"][data-precise="true"]').getAttribute('aria-pressed'), 'true');
        await page.screenshot({ path: path.join(output, kind + '.png') });
        await visibleAction(page, 'command-confirm').click(); await screen(page, 'none');
      } finally { await ctx.close(); }
    });
    for (const mobile of [false, true]) await test(`${mobile ? 'touch' : 'desktop'}: skip from HUD, move, reload and resume`, async () => {
      const { ctx, page } = await open('fresh', mobile);
      try {
        const skip = visibleAction(page, 'tutorial-skip'); await skip.waitFor({ state: 'visible' });
        const bounds = await skip.boundingBox(); assert(bounds && bounds.x >= 0 && bounds.y >= 0);
        if (mobile) assert(bounds.width >= 44 && bounds.height >= 44, 'touch target is at least 44px');
        await page.screenshot({ path: path.join(output, `${mobile ? 'touch' : 'desktop'}-skip.png`) });
        if (mobile) await skip.tap(); else await skip.click();
        await page.locator('.tutorial-card').waitFor({ state: 'hidden' });
        if (!mobile) {
          const before = await page.locator('[data-field="time"]').innerText();
          await page.keyboard.down('d'); await page.waitForTimeout(1200); await page.keyboard.up('d');
          assert.notEqual(await page.locator('[data-field="time"]').innerText(), before, 'simulation continues');
        }
        await visibleAction(page, 'pause').click(); await screen(page, 'pause');
        await page.reload({ waitUntil: 'networkidle' }); await screen(page, 'title');
        await visibleAction(page, 'resume').click(); await screen(page, 'none');
        assert.equal(await page.locator('.tutorial-card').isVisible(), false);
        await visibleAction(page, 'command-select').click(); await screen(page, 'command');
        assert.equal(await visibleAction(page, 'command-confirm').isEnabled(), true);
      } finally { await ctx.close(); }
    });
    await test('skip inside the command panel immediately removes guidance and preserves a usable command', async () => {
      const { ctx, page } = await open('command-stale');
      try {
        await visibleAction(page, 'command-select').click(); await screen(page, 'command');
        await visibleAction(page, 'tutorial-skip').click();
        assert.equal(await page.locator('.command-guide').isVisible(), false);
        assert.equal(await visibleAction(page, 'command-confirm').isEnabled(), true);
        await visibleAction(page, 'command-confirm').click(); await screen(page, 'none');
      } finally { await ctx.close(); }
    });
    await test('an old save beyond the training room opens directly into free play', async () => {
      const { ctx, page } = await open('old-room-save');
      try {
        assert.equal(await page.locator('.tutorial-card').isVisible(), false);
        await visibleAction(page, 'command-select').click(); await screen(page, 'command');
        assert.equal(await page.locator('.command-guide').isVisible(), false);
        assert.equal(await visibleAction(page, 'command-confirm').isEnabled(), true);
        await page.screenshot({ path: path.join(output, 'restored-free-play.png') });
      } finally { await ctx.close(); }
    });
    assert.deepEqual(report.diagnostics, [], 'no browser exceptions or failed HTTP resources');
  } catch (error) { report.diagnostics.push(error.stack); process.exitCode = 1; }
  finally {
    await browser?.close(); server?.kill();
    report.passed = report.checks.filter(check => check.passed).length;
    report.failed = report.checks.filter(check => !check.passed).length;
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, failed: report.failed, diagnostics: report.diagnostics }));
    if (report.failed || report.diagnostics.length) process.exitCode = 1;
  }
})();
