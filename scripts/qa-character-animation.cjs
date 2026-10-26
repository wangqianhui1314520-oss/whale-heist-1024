/* Isolated production-browser animation QA. Draw calls are observed; gameplay
 * is driven through the normal UI and keys, without changing live game state. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'output/animation-qa');
const port = Number(process.env.QA_PORT || 8787);
fs.mkdirSync(out, { recursive: true });
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'dist/assets/runtime-catalog.json'), 'utf8'));
const report = { target: 'dist', checks: [], errors: [], screenshots: [] };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const action = (page, name) => page.locator(`[data-action="${name}"]:visible`).first();
const screen = (page, name) => page.waitForSelector(`#ui-root[data-screen="${name}"]`, { state: 'attached' });
const crop = (name, direction, pose) => catalog.sprites[`character-${name}-${direction}-${pose}`].content_rect.join(',');
let server, browser;
async function screenshot(page, name) {
  await page.screenshot({ path: path.join(out, name + '.png') }); report.screenshots.push(name + '.png');
}
async function openGame(options) {
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    window.animationQA = { phase: 'load', calls: [] };
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      const match = args[0]?.src?.match(/\/([a-z]+)-actions\.(?:png|webp)/);
      if (match && this.canvas.id === 'game-canvas' && args.length === 9) {
        const qa = window.animationQA;
        if (qa.calls.length < 30000) qa.calls.push({ phase: qa.phase, name: match[1], crop: args.slice(1, 5).join(',') });
      }
      return original.apply(this, args);
    };
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) report.errors.push(response.status() + ' ' + response.url()); });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await screen(page, 'title');
  await page.locator('.loading-screen').waitFor({ state: 'hidden' });
  await action(page, 'chapter-select').click(); await screen(page, 'chapter-select');
  await action(page, 'demo-select').click();
  await page.locator('[data-action="demo-start"][data-chapter-id="paper-window"]').click();
  await screen(page, 'none'); await page.locator('.loading-screen').waitFor({ state: 'hidden' });
  // Release the menu button's focus so the normal gameplay key handler runs.
  await page.evaluate(() => document.activeElement?.blur());
  return { context, page };
}
async function phase(page, name) { await page.evaluate(name => { window.animationQA.phase = name; }, name); }
async function expectCrops(page, phaseName, expected, name = 'deepseek') {
  const seen = await page.evaluate(({ phaseName, name }) => [...new Set(window.animationQA.calls.filter(call => call.phase === phaseName && call.name === name).map(call => call.crop))], { phaseName, name });
  for (const [direction, pose] of expected) assert(seen.includes(crop(name, direction, pose)), `${phaseName}/${name}: missing ${direction}/${pose}; saw ${seen.join(' | ')}`);
  report.checks.push({ phase: phaseName, name, poses: expected.map(entry => entry.join('/')), crops: seen });
}
(async () => {
  try {
    server = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs'), '--port', String(port), '--root', path.join(root, 'dist')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let ready = false, serverError = '';
    server.on('error', error => { serverError = error.message; });
    server.stdout.on('data', data => { if (String(data).includes('Local:')) ready = true; });
    server.stderr.on('data', data => { serverError += data; });
    for (let i = 0; i < 100 && !ready && !serverError; i++) await wait(50);
    assert(ready, 'Own QA server did not start: ' + serverError);
    browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.QA_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
    report.browser = browser.version();
    for (const mobile of [false, true]) {
      const label = mobile ? 'mobile' : 'desktop';
      const { context, page } = await openGame({ viewport: mobile ? { width: 844, height: 390 } : { width: 1280, height: 720 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
      await phase(page, label + '-walk');
      await page.keyboard.down('d'); await page.waitForTimeout(750); await screenshot(page, label + '-walk'); await page.keyboard.up('d');
      await expectCrops(page, label + '-walk', [['right', 'walk']]);
      await page.waitForTimeout(180);
      await phase(page, label + '-jump'); await page.keyboard.down('Space');
      await page.waitForTimeout(200); await screenshot(page, label + '-jump');
      await page.waitForTimeout(400); await page.keyboard.up('Space'); await page.waitForTimeout(100);
      await expectCrops(page, label + '-jump', [['right', 'jump'], ['right', 'fall']]);
      await phase(page, label + '-dash'); await page.keyboard.press('j'); await page.waitForTimeout(300);
      await expectCrops(page, label + '-dash', [['right', 'skill']]);
      await phase(page, label + '-left'); await page.keyboard.down('a'); await page.waitForTimeout(700); await page.keyboard.up('a');
      await expectCrops(page, label + '-left', [['left', 'walk']]);
      if (!mobile) {
        await page.locator('[data-teammate="Grok"]').click(); await screen(page, 'command');
        if (await action(page, 'ui-command-forecast').count()) await action(page, 'ui-command-forecast').click();
        assert(await action(page, 'command-confirm').isEnabled(), 'Grok command is available');
        await phase(page, 'grok-command'); await action(page, 'command-confirm').click(); await screen(page, 'none');
        await page.waitForTimeout(6500); await screenshot(page, 'desktop-grok-command');
        await expectCrops(page, 'grok-command', [['right', 'walk'], ['right', 'skill']], 'grok');
      }
      await context.close();
    }
    // Render a labelled diagnostic sheet with the same built sampler and
    // AssetLibrary used in play. No additional artwork is generated.
    const page = await browser.newPage({ viewport: { width: 1440, height: 720 } });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    // Explicit render fixtures, separate from the UI-driven gameplay above.
    // Observe the real canvas drawImage source regions, including every gait
    // beat and two seconds of continuous sampling in each fixed direction.
    const grokFixture = await page.evaluate(async () => {
      const { AssetLibrary } = await import('/src/render/assets.js');
      const { sampleCharacterMotion } = await import('/src/render/character-motion.js');
      const assets = await AssetLibrary.load('/assets/runtime-catalog.json');
      const canvas = document.createElement('canvas'); canvas.width = 1440; canvas.height = 440;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#102c40'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#d4f5ff'; ctx.font = '18px sans-serif';
      ctx.fillText('Grok fixed-direction walk: six production sampler beats (render fixture)', 20, 30);
      const probe = document.createElement('canvas').getContext('2d');
      const observe = context => {
        const draws = [], original = context.drawImage;
        context.drawImage = function (...args) {
          draws.push({ image: args[0]?.src, crop: args.slice(1, 5).join(',') });
          return original.apply(this, args);
        };
        return draws;
      };
      const draws = observe(ctx), probeDraws = observe(probe), checks = [];
      const ensure = (condition, message) => { if (!condition) throw new Error(message); };
      const seed = [...'Grok'].reduce((total, letter) => (total + letter.charCodeAt(0)) % 17, 0);
      const gaitTime = frame => ((frame - seed % 6 + 6) % 6 + .01) / 10;
      const world = { time: 0, crew: [] };
      for (const [row, direction] of ['left', 'right'].entries()) {
        const actor = Object.freeze({ name: 'Grok', isPlayer: false, direction, grounded: true, pose: 'walk' });
        const expected = assets.catalog.sprites[`character-grok-${direction}-walk`].content_rect.join(',');
        const inspect = (context, observed, time, x, y, scale = 1) => {
          const motion = sampleCharacterMotion(actor, world, { time });
          ensure(motion.state === 'walk' && motion.pose === 'walk', `Grok ${direction} walk mixed ${motion.pose} at ${time}s`);
          ensure(actor.direction === direction && motion.scaleX > 0, `Grok ${direction} direction changed at ${time}s`);
          assets.drawActor(context, 'Grok', motion.pose, actor.direction, x + motion.xOffset, y + motion.yOffset, {
            nativeScale: assets.catalog.sprites[`character-grok-${direction}-walk`].native_scale * scale,
            rotation: motion.rotation, scaleX: motion.scaleX, scaleY: motion.scaleY,
          });
          const actual = observed.at(-1);
          ensure(actual.crop === expected, `Grok ${direction} selected a different direction/pose crop at ${time}s: ${actual.crop}`);
          ensure(/\/grok-actions\.(?:png|webp)$/.test(actual.image), 'Grok fixture must draw the production atlas');
          return motion;
        };
        ctx.fillStyle = '#d4f5ff'; ctx.font = '17px sans-serif';
        ctx.fillText(direction, 20, 133 + row * 190);
        for (let frame = 0; frame < 6; frame++) {
          const x = 200 + frame * 205, y = 185 + row * 190;
          const motion = inspect(ctx, draws, gaitTime(frame), x, y, 1.5);
          ensure(motion.frame === frame, `Grok ${direction} fixture missed gait beat ${frame}`);
          ctx.fillText(`beat ${frame + 1}: ${motion.pose}`, x - 55, y + 30);
        }
        for (let tick = 0; tick < 120; tick++) inspect(probe, probeDraws, tick / 60, 0, 0);
        checks.push({ phase: 'fixture-grok-walk-' + direction, fixture: true, name: 'grok',
          direction, beats: 6, continuousSamples: 120, poses: ['walk'], crops: [expected] });
        const skillCrop = assets.catalog.sprites[`character-grok-${direction}-skill`].content_rect.join(',');
        for (let tick = 0; tick < 70; tick++) {
          const stageTime = .06 + tick / 60;
          const executing = Object.freeze({ ...actor, pose: 'skill', task: { stage: 'execute', stageTime } });
          const motion = sampleCharacterMotion(executing, world, { time: stageTime });
          ensure(motion.action === 'break' && motion.pose === 'skill', `Grok ${direction} strike returned to ${motion.pose} at ${stageTime}s`);
          assets.drawActor(probe, 'Grok', motion.pose, direction, 0, 0);
          ensure(probeDraws.at(-1).crop === skillCrop, `Grok ${direction} strike changed direction/pose crop`);
        }
        checks.push({ phase: 'fixture-grok-strike-' + direction, fixture: true, name: 'grok',
          direction, continuousSamples: 70, startSeconds: .06, poses: ['skill'], crops: [skillCrop] });
      }
      return { png: canvas.toDataURL('image/png').split(',')[1], checks };
    });
    fs.writeFileSync(path.join(out, 'grok-walk-directions.png'), Buffer.from(grokFixture.png, 'base64'));
    report.screenshots.push('grok-walk-directions.png');
    report.checks.push(...grokFixture.checks);
    const png = await page.evaluate(async () => {
      const { AssetLibrary } = await import('/src/render/assets.js');
      const { sampleCharacterMotion } = await import('/src/render/character-motion.js');
      const assets = await AssetLibrary.load('/assets/runtime-catalog.json');
      const canvas = document.createElement('canvas'); canvas.width = 1440; canvas.height = 640;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#102c40'; ctx.fillRect(0, 0, 1440, 640);
      const columns = ['idle', 'walk / beat 1', 'walk / beat 3', 'jump', 'fall', 'dash', 'interact', 'board'];
      ctx.font = '16px sans-serif'; ctx.fillStyle = '#d4f5ff';
      columns.forEach((text, i) => ctx.fillText(text, 140 + i * 160, 34));
      for (const [row, name] of ['DeepSeek', 'Grok', 'Claude', 'GLM'].entries()) {
        const actor = { name, isPlayer: true, direction: 'right', grounded: true, pose: 'idle' };
        const seed = [...name].reduce((total, letter) => (total + letter.charCodeAt(0)) % 17, 0);
        const gaitTime = frame => ((frame - seed % 6 + 6) % 6 + .01) / 10;
        const world = { time: 0, crew: [] };
        const states = [
          [actor, world, {}], [{ ...actor, pose: 'walk' }, world, { time: gaitTime(0) }],
          [{ ...actor, pose: 'walk' }, world, { time: gaitTime(2) }],
          [{ ...actor, pose: 'jump', grounded: false, vy: -250 }, world, {}],
          [{ ...actor, pose: 'fall', grounded: false, vy: 250 }, world, {}],
          [{ ...actor, pose: 'skill', dashTime: .1 }, world, {}],
          [actor, { ...world, interaction: { target: 'delivery', progress: .5 } }, {}],
          [actor, { ...world, interaction: { target: 'board', progress: .6 } }, {}],
        ];
        ctx.fillStyle = '#d4f5ff'; ctx.fillText(name, 18, 110 + row * 145);
        states.forEach(([actor, world, options], col) => {
          const motion = sampleCharacterMotion(actor, world, options);
          assets.drawActor(ctx, name, motion.pose, 'right', 185 + col * 160 + motion.xOffset, 150 + row * 145 + motion.yOffset, { nativeScale: assets.catalog.sprites[`character-${name.toLowerCase()}-right-${motion.pose}`].native_scale * 1.2, rotation: motion.rotation, scaleX: motion.scaleX, scaleY: motion.scaleY });
        });
      }
      return canvas.toDataURL('image/png').split(',')[1];
    });
    fs.writeFileSync(path.join(out, 'character-keyframes.png'), Buffer.from(png, 'base64'));
    report.screenshots.push('character-keyframes.png');
    assert.equal(report.errors.length, 0, report.errors.join('\n'));
    console.log('PASS production desktop/mobile UI movement and Grok command; separate fixed-direction walk/strike render fixtures and animation screenshots.');
  } catch (error) { report.failure = error.stack; process.exitCode = 1; console.error(error.stack); }
  finally {
    fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2));
    if (browser) await browser.close();
    if (server) server.kill();
  }
})();
