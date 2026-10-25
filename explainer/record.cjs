/* 录制游戏关键片段(真实浏览器 + 真实按键/点击,不改游戏状态)。
 * 用法: node record.cjs <dist目录> <输出目录> [片段名,片段名...]
 * 环境: PW_MODULE, CHROME_BIN, LD_LIBRARY_PATH
 * 每个片段: <out>/<name>/<name>.webm + meta.json(trimStartSec / marks / facts / wallSec)。
 * marks 与 trimStartSec 同一时间基准(页面创建时刻),合成时减去 trimStartSec 即片段内时间。 */
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(process.argv[2]), outDir = path.resolve(process.argv[3]);
const only = (process.argv[4] || '').split(',').filter(Boolean);
const { chromium } = require(process.env.PW_MODULE);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.resolve(root, '.' + (rel.endsWith('/') ? rel + 'index.html' : rel));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }   // 只伺服游戏目录
  fs.readFile(file, (e, b) => e ? res.writeHead(404).end() : (res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }), res.end(b)));
});
const act = (p, a) => p.locator(`[data-action="${a}"]:visible`).first();
const screen = (p, n, t = 20000) => p.waitForSelector(`#ui-root[data-screen="${n}"]`, { state: 'attached', timeout: t });
const wait = (p, ms) => p.waitForTimeout(ms);
const press = async (p, key, ms) => { await p.keyboard.down(key); await wait(p, ms); await p.keyboard.up(key); };
const tokens = p => p.locator('[data-field="ai-tokens"]').innerText().then(s => Number(String(s).trim()));
let base, browser, T0 = 0, M = null;
const mark = n => { M.marks[n] = (Date.now() - T0) / 1000; };

async function openChapter(page, id) {      // 章节展示模式:不写存档,不影响正式进度
  await act(page, 'chapter-select').click(); await screen(page, 'chapter-select');
  await act(page, 'demo-select').click();
  await page.locator(`[data-action="demo-start"][data-chapter-id="${id}"]`).click();
  await screen(page, 'none'); await page.locator('.loading-screen').waitFor({ state: 'hidden' });
}

const hud = p => p.locator('[data-field="time"]').first().innerText().then(s => { const [m, x] = String(s).trim().split(':').map(Number); return m * 60 + x; });
const CLIPS = {
  async clock(page) {                        // 诊断:录制时游戏内计时 vs 真实时间(不用于成片)
    await openChapter(page, 'paper-window'); await wait(page, 1500);
    const a = await hud(page), t = Date.now();
    await wait(page, 12000);
    const b = await hud(page);
    M.facts = { hudStart: a, hudEnd: b, hudSec: b - a, wallSec: +((Date.now() - t) / 1000).toFixed(1) };
  },
  async menu(page) {                         // 主菜单 -> 章节航图
    await wait(page, 2500);
    mark('chapters'); await act(page, 'chapter-select').click(); await screen(page, 'chapter-select'); await wait(page, 3000);
  },
  async move(page) {                         // 第一章:走、回头、跳、冲刺
    await openChapter(page, 'paper-window'); await wait(page, 1200);
    mark('right'); await press(page, 'd', 1800); await wait(page, 400);
    mark('left'); await press(page, 'a', 900); await wait(page, 500);
    mark('jump'); await press(page, 'Space', 150); await wait(page, 1500);
    mark('dash'); await page.keyboard.down('d'); await press(page, 'ShiftLeft', 150); await wait(page, 600);
    await page.keyboard.up('d'); await wait(page, 2500);
  },
  async command(page) {                      // 选队友 -> 看影响 -> 对比两种方案 -> 确认执行
    await openChapter(page, 'resume-storm'); await wait(page, 1500);
    M.facts.tokensBefore = await tokens(page);
    mark('select'); await page.locator('[data-teammate="Grok"]').click(); await screen(page, 'command'); mark('panel'); await wait(page, 5600);
    mark('forecast'); await act(page, 'ui-command-forecast').click(); await wait(page, 5600);
    mark('precise'); await page.locator('[data-action="prompt-mode"][data-precise="true"]').first().click(); await wait(page, 6200);
    mark('default'); await page.locator('[data-action="prompt-mode"][data-precise="false"]').first().click(); await wait(page, 4200);
    mark('confirm'); await act(page, 'command-confirm').click(); await screen(page, 'none'); await wait(page, 7500);
    M.facts.tokensAfter = await tokens(page);
  },
  async cancel(page) {                       // 打开 Claude 指令面板后取消
    await openChapter(page, 'resume-storm'); await wait(page, 1200);
    M.facts.tokensBefore = await tokens(page);
    mark('select'); await page.locator('[data-teammate="Claude"]').click(); await screen(page, 'command'); mark('panel'); await wait(page, 6200);
    mark('cancel'); await act(page, 'command-cancel').click(); await screen(page, 'none'); await wait(page, 5200);
    M.facts.tokensAfter = await tokens(page);
  },
  async help(page) {                         // 暂停菜单 + 行动指南
    await openChapter(page, 'paper-window'); await wait(page, 1200);
    mark('pause'); await act(page, 'pause').click(); await screen(page, 'pause'); await wait(page, 1800);
    mark('help'); await act(page, 'help').click(); await screen(page, 'help'); await wait(page, 3500);
  },
};

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-gpu'] });
  const names = Object.keys(CLIPS).filter(n => !only.length || only.includes(n));
  for (const name of names) {
    const dir = path.join(outDir, name);
    for (let attempt = 1; attempt <= 3; attempt++) {         // 软件渲染偶发卡顿:失败就整段重录,不拼接半成品
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir, size: { width: 1280, height: 720 } } });
      const page = await ctx.newPage(); page.setDefaultTimeout(15000);
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      T0 = Date.now(); M = { marks: {}, facts: {} }; let ok = true, err = null, trim = 0;
      try {
        await page.goto(base, { waitUntil: 'networkidle' }); await screen(page, 'title');
        await page.locator('.loading-screen').waitFor({ state: 'hidden' });
        trim = (Date.now() - T0) / 1000;                    // 进入可操作画面之前的等待,合成时裁掉
        await CLIPS[name](page);
      } catch (e) { ok = false; err = e.message; }
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ name, ok, trimStartSec: trim, wallSec: (Date.now() - T0) / 1000, marks: M.marks, facts: M.facts, errors }));
      const video = page.video(); await ctx.close();
      fs.renameSync(await video.path(), path.join(dir, name + '.webm'));
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  try=${attempt}  wall=${((Date.now() - T0) / 1000).toFixed(1)}s  pageerrors=${errors.length}  facts=${JSON.stringify(M.facts)}${err ? '  ' + err.split('\n')[0] : ''}`);
      if (ok && !errors.length) break;
    }
  }
  await browser.close(); server.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
