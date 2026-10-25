/* 探针:量无头 Chromium 下的 rAF 帧率,并按 d 键 1 秒后截图,估算移动速度。 */
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(process.argv[2]), outDir = path.resolve(process.argv[3]);
const { chromium } = require(process.env.PW_MODULE);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.resolve(root, '.' + (rel.endsWith('/') ? rel + 'index.html' : rel));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (e, b) => e ? res.writeHead(404).end() : (res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }), res.end(b)));
});
const act = (p, a) => p.locator(`[data-action="${a}"]:visible`).first();
const screen = (p, n) => p.waitForSelector(`#ui-root[data-screen="${n}"]`, { state: 'attached', timeout: 20000 });
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const extra = (process.env.CHROME_ARGS || '--use-gl=angle --use-angle=swiftshader').split(' ').filter(Boolean);
  console.log('args:', extra.join(' ') || '(none)');
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', ...extra] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await page.goto(base, { waitUntil: 'networkidle' }); await screen(page, 'title');
  await page.locator('.loading-screen').waitFor({ state: 'hidden' });
  await act(page, 'chapter-select').click(); await screen(page, 'chapter-select');
  await act(page, 'demo-select').click();
  await page.locator('[data-action="demo-start"][data-chapter-id="paper-window"]').click();
  await screen(page, 'none'); await page.locator('.loading-screen').waitFor({ state: 'hidden' });
  const fps = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); }));
  console.log('rAF fps in gameplay:', fps.toFixed(1));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'p0.png') });
  await page.keyboard.down('d'); await page.waitForTimeout(1000); await page.keyboard.up('d'); await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, 'p1.png') });
  console.log('done');
  await browser.close(); server.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
