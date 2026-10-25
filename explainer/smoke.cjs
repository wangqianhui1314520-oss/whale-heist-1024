/* 冒烟测试:无头 Chromium 能否加载游戏并进入主菜单。
 * 用法: node smoke.cjs <游戏根目录> <输出png>
 * 环境: PW_MODULE=playwright-core 路径, CHROME_BIN=headless_shell 路径 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.argv[2]);
const outPng = path.resolve(process.argv[3]);
const { chromium } = require(process.env.PW_MODULE);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.resolve(root, '.' + (rel.endsWith('/') ? rel + 'index.html' : rel));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }   // 禁止越出游戏目录
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const problems = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('response', r => { if (r.status() >= 400) problems.push(`http ${r.status()} ${r.url()}`); });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('#ui-root[data-screen="title"]', { state: 'attached', timeout: 20000 });
  await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 20000 });
  await page.screenshot({ path: outPng });
  console.log('OK title reached; problems:', JSON.stringify(problems));
  await browser.close(); server.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
