/* 探针:开启 recordVideo 后的帧率与录制时长是否可信。 */
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
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: outDir, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'networkidle' }); await screen(page, 'title');
  await page.locator('.loading-screen').waitFor({ state: 'hidden' });
  await act(page, 'chapter-select').click(); await screen(page, 'chapter-select');
  await act(page, 'demo-select').click();
  await page.locator('[data-action="demo-start"][data-chapter-id="paper-window"]').click();
  await screen(page, 'none'); await page.locator('.loading-screen').waitFor({ state: 'hidden' });
  const fps = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); }));
  console.log('rAF fps while recording:', fps.toFixed(1));
  const t0 = Date.now();
  await page.keyboard.down('d'); await page.waitForTimeout(3000); await page.keyboard.up('d');
  console.log('wall seconds of input phase:', ((Date.now() - t0) / 1000).toFixed(1));
  const video = page.video();
  await ctx.close();
  console.log('video:', await video.path());
  await browser.close(); server.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
