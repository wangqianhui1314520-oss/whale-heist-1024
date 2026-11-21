# 任务：AI 协作存在感升级

> 实施记录：本轮未改动计分、消耗、冷却、路线与 receipts 长度；新增能力全部是「可观测的响应层」。
> 样式实际落在 `src/ui/visual-direction.css`（该文件在 CSS 构建顺序内）。

## 阶段 0 · 安全网
- [x] 备份将修改的 5 个文件：`src/game/world.mjs`、`src/render/scene-renderer.mjs`、`src/ui/ui.mjs`、`src/ui/ui-polish.css`、`src/main.mjs`（`.bak`，验证通过后已删除）。
- [x] 先跑一遍现有 28 个 `verify-*.mjs`，确认基线全 PASS。

## 阶段 1 · 世界层响应链（world.mjs）
- [x] 构造函数为 crew 增加 `order/callout/calloutUntil/lastCallAt`，世界增加 `orderCount/autoAssists/autoHints/crewOrders/crewLines/autoIndex/nextAutoCall`。
- [x] 实现 `crewSay`、`orderReceipt`、`cooperationSummary`。
- [x] `confirmCommand` / `startExpandedPlan`：接单回执 + 默认/精确/等待/接力四套台词。
- [x] `updateCrew`：travel→execute 的「到点」回执与执行台词；`completeTask` 用真实数量生成回执与 toast；`failTask` 失败台词。
- [x] `autonomyTick`：GLM 自动标陷阱、Claude 自动盯守卫、Grok 点名障碍、资料提示、人设兜底；只做状态安全且可缺席的动作；不移动 actor。
- [x] `snapshot` 增加 `crew` 与 `cooperation`；`board` 的 `chapter-result` 附带 `cooperation`。
- [x] 自检：不新增 `receipts` 条目；不改分数、扣费、冷却、路线。

## 阶段 2 · 渲染与 HUD
- [x] `scene-renderer.mjs`：角色头顶 `crew-callout`；守卫头顶「Claude 盯梢中」。
- [x] `ui.mjs update`：HUD 队员状态显示「等待/接单/执行/回执」。
- [x] `visual-direction.css`：`.scene-label.crew-callout` 与 `.cooperation-recap` 样式，移动端字号 ≥11px。

## 阶段 3 · 结算与事件转发
- [x] `main.mjs worldEvent`：`chapter-result` 转发 `payload.cooperation`；`dialogue` 在命令面板关闭后仍可显示。
- [x] `ui-v3.mjs #renderChapterResult`：条件渲染「本次配合」摘要（无字段时完全隐藏）。
- [x] `ui-v3.mjs #renderCampaignResult`：增加「协作回应」指标（读取现有 breakdown，不新增存档）。

## 阶段 4 · 验证
- [x] 新增 `scripts/verify-crew-agency.mjs`，覆盖：接单/完成状态、receipts 长度不变、GLM 自主标陷阱、Claude 盯守卫、队伍坐标不变、分数不变。
- [x] 全量运行 29 个 verify 脚本：29/29 PASS。
- [x] Playwright 桌面 1280×720：标题 → 章节 → 命令面板 → 确认 → HUD 状态 → 结算摘要；console 0 错误。
- [x] Playwright 手机 844×390（isMobile+hasTouch）：同关键路径；console 0 错误。
- [x] 若任一失败：按文件回退 `.bak`，修复后重跑，不带病继续。

## 阶段 5 · 发布物
- [x] `node scripts/build-standalone.mjs` 生成 `release/index.html` 与 `release/鲸鱼魔盗团.html`。
- [x] 在隔离目录打开文件夹版与单文件版（桌面/手机各一遍），确认标题、章节选择、命令面板、Canvas 正常，console 0 错误。
- [x] 报告：改动清单、验证结果、剩余风险。
