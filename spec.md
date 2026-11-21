# 规格：让「和 AI 一起合作通关」被真正感知

## 1. 目标

在不改动玩法规则、计分与关卡几何的前提下，让玩家在三个时刻明确感觉到队友是「活的分工者」：

1. **平时**：AI 船员会自己找活、主动出声提示，且不同角色关注不同信息。
2. **下指令后**：能看到从「接单 → 前往 → 执行 → 回执」的完整响应链，且默认/精确/等待/接力四种编排的台词与结果不同。
3. **过关时**：结算页出现本局配合摘要（指令数、自主协助数、每人贡献、MVP），让胜利归因于「我和它们配合」。

硬约束：
- 不改任何计分、扣费、冷却、伤害、路线与碰撞逻辑。
- 不新增 `world.receipts` 条目（回归脚本对长度与字段有断言）。
- 所有新行为可缺席降级：旧存档、无 `cooperation` 字段时 UI 正常。
- 文件夹版与单文件版都必须可构建、可运行。

## 2. 现状与插入点（已确认）

| 文件 | 关键位置 | 现状 |
| --- | --- | --- |
| `src/game/world.mjs` | 构造函数 73 行 | crew 只有 name/x/y/pose/status/route/task/repathAt |
| 同上 | `confirmCommand` 400-420 | 有 `sound command-confirm` + 一句通用 `dialogue` |
| 同上 | `startExpandedPlan` 550-564 | 同上，精确/等待只换一句短语 |
| 同上 | `updateCrew` 635-730 | travel→execute、各角色执行、`completeTask`/`failTask` |
| 同上 | `completeTask` 576-600 | 生成 receipt，然后 `toast('X：协作完成。')` |
| 同上 | `snapshot` 153-159 | 无 crew 状态、无配合统计 |
| 同上 | `board` 907-908 | `emit('chapter-result', {})` |
| `src/render/scene-renderer.mjs` | `#actor` 444-459 | 只画角色，无台词/接单标记 |
| 同上 | `#guards` 约 430-442 | 有诱饵/分心标签，无「被盯梢」 |
| `src/ui/ui.mjs` | `update` 166-178 | `ready-X` 只看 core 的 executing/冷却 |
| 同上 | `#renderChapterResult` 236-243 | 无配合摘要 |
| 同上 | `#renderCampaignResult` 245-254 | 有调查笔录，无协作汇总 |
| `src/main.mjs` | `worldEvent` 219-221 | `chapter-result` 未转发 world 附加数据 |
| `src/ui/ui-polish.css` | `.scene-label` 相关 | 可新增 `.scene-label.crew-callout` |

## 3. 设计

### 3.1 世界层：可感知的响应链（world.mjs）

新增世界字段（构造函数）：
- `this.orderCount = 0`：玩家确认过的指令数。
- `this.autoAssists = 0`：AI 自主完成的实际协助（标陷阱、盯守卫）。
- `this.autoHints = 0`：AI 自主口头提示（点名障碍/资料等）。
- `this.crewOrders = []`：本局最近 20 条回执 `{teammate, stage, text, at}`。
- `this.crewLines = []`：最近 12 句台词（用于结算/调试）。
- `this.autoIndex = 0`、`this.nextAutoCall = 18`、`this.seed = 1024`（已有 seed）。
- 每个 crew 增加：`order:null`、`callout:null`、`calloutUntil:0`、`lastCallAt:0`。

新增方法：
1. `crewSay(actor, text, {duration=4, focus=null, stage=null, autonomous=false}={})`
   - 仅当 `TEAMMATES` 包含 actor.name 时执行。
   - 设置 `actor.callout={text,focus}`、`actor.calloutUntil=this.time+duration`、`actor.lastCallAt=this.time`。
   - 追加 `crewLines`（上限 12）。
   - `emit('dialogue',{character:actor.name,text})`；`autonomous` 时 `autoHints++`。
   - 不调用 `toast`，避免覆盖任务目标提示。
2. `orderReceipt(actor, stage, text)`
   - `actor.order={stage,text,at:this.time}`；追加 `crewOrders`（上限 20）。
   - `stage==='accepted'` 时 `orderCount++`。
   - 不改 `this.receipts`、不扣费、不写 record。
3. `autonomyTick(view)`（在 `update` 末尾调用）
   - 早退条件：`!this.expanded`、`this.time<this.nextAutoCall`、`view.phase!=='playing'`、`view.scanWarning`、存在 `story` 覆盖（由 main 控制暂停，update 不跑）。
   - 间隔：`12 + (this.seed++ % 5)` 秒，确定、无 Math.random。
   - 从 `!actor.task` 且 `this.time-actor.lastCallAt>14` 的成员中轮转取一人，按优先级选一条**真实存在**的观察：
     1. GLM 且玩家 240px 内有未揭示陷阱：设置 `trap.revealedUntil=this.time+6`，`cue('scan-grid', trap.x+.., trap.y-.., 'right')`，台词「我先把这处陷阱标出来。」；`autoAssists++`。
     2. Claude 且玩家 300px 内有守卫：设置 `guard.scoutedUntil=this.time+8`，台词「这名守卫的视线我盯着，别站进他正前方。」；`autoAssists++`。
     3. Grok 且玩家 320px 内有未破障碍/未开节点：台词「这面墙我能撞，点它给我个目标。」并 `focus` 到目标；`autoHints++`。
     4. 任意成员且 240px 内有未拾取必选资料：台词「那边还有一份资料，我记着了。」；`autoHints++`。
     5. 兜底人设短句（不改变任何状态）：Grok「手有点痒，想撞点什么。」Claude「我在数巡逻的步点。」GLM「背景噪音降了 12%。」
   - **不移动任何 actor**，不碰玩家物理、不碰任务状态。
4. `cooperationSummary()` 返回值：
   ```
   { orders: orderCount,
     completed: receipts.filter(r=>!r.failed).length,
     failed: receipts.filter(r=>r.failed).length,
     autoAssists, autoHints,
     perCrew: { Grok:{orders,effects}, Claude:{...}, GLM:{...} },
     mvp: 完成数最多的成员名（并列按 Grok/Claude/GLM 顺序） }
   ```
   `effects` 取 receipt 的 `affectedCount`（Grok 障碍/节点、Claude 守卫、GLM 陷阱）。

接入点：
- `confirmCommand`（非 expanded）与 `startExpandedPlan`：
  - 确认成功后调用 `orderReceipt(actor,'accepted', ...)`。
  - 台词按编排分叉：
    - 精确：Grok「只撞这一处，到点就收。」Claude「只引一名，纸页算好距离。」GLM「窄区细扫，避开警戒器。」
    - 默认：Grok「整片开路，我自己找落点。」Claude「同层三名守卫，一起引走。」GLM「大范围扫一遍，警戒器可能响。」
    - 等待条件：「条件成立我就动手，先盯着。」
    - 接力（`plan.sequence.length`）追加一句「第二步交给 X，我做完就轮到他。」
- `updateCrew` 的 `travel→execute` 分支：`orderReceipt(actor,'moving','已到目标位')`，并按角色说一句执行台词（Grok「到点，撞！」Claude「纸页投放！」GLM「开始扫描。」）。
- `completeTask`：`orderReceipt(actor,'done', outcome)`；用实际数量生成台词：
  - Grok：「开了 N 处，停在标记位置。」
  - Claude：「引走 N 名，守卫正在看纸页。」
  - GLM：无警戒器「扫出 N 处陷阱，没碰警戒器。」有则「扫出 N 处，碰到了 M 个警戒器。」
  - 替换通用 `toast('X：协作完成。')` 为上述简短回执；保留纸窗特殊文案。
- `failTask`：`orderReceipt(actor,'failed',reason)`，台词「这条路线走不通，换个目标我再试。」
- `board` 成功时：`this.emit('chapter-result',{cooperation:this.cooperationSummary()})`。
- `snapshot()` 增加：
  ```
  crew: [{ name, status, stage: task?.stage||null, order: {stage,text}|null,
           callout: 未过期 ? {text} : null }],
  cooperation: { orders, completed, autoAssists, autoHints }
  ```
  只增字段，不改既有字段。

### 3.2 渲染层：看得见的响应（scene-renderer.mjs）

- `#actor`：非玩家且 `actor.callout && actor.calloutUntil > world.time` 时，在角色头顶 `#groundLabel(actor.x, actor.y-104, text, '#c9f3ff', 10, true, 'crew-callout')`；不替代「你」标签。
- `#guards`：`guard.scoutedUntil > world.time` 时在守卫头顶显示 `#groundLabel(...,'Claude 盯梢中','#b9e6ff',9)`。
- 复用已有 `cue('scan-grid')`，不新增美术资源。

### 3.3 HUD：指令回执可见（ui.mjs update）

在现有 `TEAM.forEach` 内读取 `const crew = world.crew?.find(c=>c.name===name)`：
- `cooldown-${name}` 文本优先级：`stage==='waiting'?'等待' : stage==='travel'?'前往' : stage==='execute'?'执行' : remaining>0?`${s}s`:'就绪'`。
- `ready-${name}` 文本：`!available?'锁定' : stage==='waiting'?'等待' : stage==='travel'?'接单' : stage==='execute'?'执行' : order?.stage==='done' && this.time? ... : '就绪'`（用 `world.time` 与 `order.at` 比较，4 秒内显示「回执」）。
- 不新增 DOM 节点，避免移动端布局回归。

### 3.4 结算：共同赢下的证据（ui.mjs + main.mjs）

- `main.mjs worldEvent` 的 `chapter-result`：`ui.show('chapter-result',{core:view,result:view.pendingResult,mode,cooperation:payload.cooperation})`。
- `#renderChapterResult`：仅当 `payload.cooperation` 存在时插入一块：
  ```
  <div class="cooperation-recap">
    <span>本次配合</span>
    <p>你下达 <b>N</b> 条指令，AI 自主协助 <b>M</b> 次、主动提示 <b>K</b> 次。</p>
    <p>Grok 处理 X · Claude 引开 Y · GLM 扫出 Z</p>
    <p>本局 MVP：<b>成员名</b> —— 台词</p>
  </div>
  ```
  旧的 `score-lines`、按钮、文案保持原样。
- `#renderCampaignResult`：在 `result-metrics` 增加一项 `协作回应 <b>${results.reduce((s,r)=>s+(r.breakdown?.collaboration||0),0)}</b>`，不新增持久化。

### 3.5 样式（ui-polish.css）

- `.scene-label.crew-callout`：小号、最大宽度 220px、青色描边、`white-space:normal`、`z-index` 与现有 scene-label 一致。
- `.cooperation-recap`：与 `.score-lines` 同视觉语言，顶部细线、两行小字、移动端字号不低于 11px。

## 4. 不做的事

- 不新增场景美术、音效或语音资源。
- 不修改 `src/core/state.mjs` 的计分、事件账本、章节解锁。
- 不改 `rooms.mjs`、`maps.mjs`、`tutorial.mjs`。
- 不允许 AI 自动拾取、自动破障、自动开门或自动使用 Token。

## 5. 验证计划

1. **回归**：`Get-ChildItem scripts/verify-*.mjs | ForEach-Object { node $_.FullName }`，28 个脚本全 PASS。
2. **新增** `scripts/verify-crew-agency.mjs`：
   - 下指令后 `snapshot().crew` 对应成员 stage 为 `travel`，`order.stage==='accepted'`，`cooperation.orders` +1。
   - 完成后 `order.stage==='done'`、`cooperation.completed` +1、`receipts.length` 与改前一致。
   - 构造 GLM 自主标陷阱：`autonomyTick` 后 `autoAssists` +1、`trap.revealedUntil>time`、全队 x/y 不变。
   - 构造 Claude 盯守卫：`guard.scoutedUntil>time`、`autoAssists` +1。
   - 断言 `core.view().campaign.totalScore` 与 `attempt.exposureDelta` 不变。
3. **浏览器关键路径**（Playwright，file://）：
   - 桌面 1280×720 与手机 844×390：标题 → 章节展示/进入 → 命令面板 → 确认指令 → HUD 出现「接单/前往/执行」→ 结算页出现「本次配合」。
   - 记录 console error 数必须为 0。
4. **构建**：`node scripts/build-standalone.mjs`；分别打开 `release/index.html` 与 `release/鲸鱼魔盗团.html` 冒烟，console 0 错误。
5. **回退**：改动前对 5 个源文件留 `.bak`；任一回归失败按文件回退，不允许带病发布。

## 6. 验收标准

- 玩家在 30 秒不操作的情况下，至少能听到/看到一次有真实依据的 AI 主动提示。
- 确认指令后 1 秒内，HUD 对应队员从「就绪」变为「接单/前往」。
- 默认与精确指令的完成台词不同，并包含真实影响数量。
- 结算页能看到指令数、自主协助数、每名队员贡献与 MVP。
- 28 个回归脚本 + 新脚本全 PASS；桌面/手机关键路径 console 0 错误；两种发布物可打开。
