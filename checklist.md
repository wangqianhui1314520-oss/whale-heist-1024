# 验收清单：AI 协作存在感

- [x] 玩家确认指令后，HUD 立即从「就绪/冷却」切换为「接单」，命令面板关闭后仍能看到该队友的确认台词（verify-crew-agency + 桌面/手机实测 `stage:"接单"`、`crewLine:"整片开路"`）。
- [x] 队友到达目标位时出现「到点」回执，完成后回执包含真实数量（如 Grok 开了 X 障碍/Y 节点），且 `world.receipts` 只增加 1 条（verify-crew-agency case 1）。
- [x] 默认方案与精确方案产生不同的接单台词与回执文本（verify-crew-agency case 2：预览范围 vs 标记）。
- [x] AI 会自主找活：GLM 自动标出附近陷阱、Claude 自动盯住附近守卫；限频触发，不移动角色、不扣 Token、不改分数（verify-crew-agency case 3/4）。
- [x] 场景中能看到队友头顶台词气泡（`crew-callout`）与守卫头顶「Claude 盯梢中」。
- [x] 章节结算出现「本次配合」摘要：指令数、自主协助、主动提示、每人贡献与 MVP；无 `cooperation` 字段时完全隐藏（桌面首屏可见）。
- [x] 手机 844×390 结算首屏可见两行核心摘要，摘要底部与按钮区留有约 9px 间距，无横向溢出。
- [x] 总评页出现「协作回应」指标，数值来自现有 breakdown，不新增存档字段。
- [x] 全量 29 个 `scripts/verify-*.mjs` 全部 PASS。
- [x] 桌面 1280×720 与手机 844×390 关键路径（标题 → 章节进入 → 命令面板 → 确认 → 结算）console 0 错误。
- [x] `release/index.html`（文件夹版）与 `release/鲸鱼魔盗团.html`（单文件版）在隔离目录、桌面与手机下均可进入标题、章节选择与命令面板，console 0 错误；单文件版无外部资源依赖失败。
- [x] 临时探针 `scripts/tmp-probe.mjs` 与全部 `.bak` 备份已清理，源码目录无残留。
