# 《鲸鱼魔盗团》数据与主线状态核心

这是五章可玩游戏的状态层：原生浏览器 ES modules，无第三方运行依赖。动作层位于 ../game/，入口为 ../main.mjs。

**当前视角已按用户最新要求改为横版侧视固定镜头**，采用类似《森林冰火人》的多层平台与机关。后续动作层需要实现左右移动、跳跃、冲刺和平台机关；不再按旧稿的俯视滑行方式开发。这里的五章任务、约二十分钟流程目标、每章 100 分／总计 500 分、广播和存档状态规则保持不变，状态核心不依赖镜头方向。

## 已实现

- 五章名称、必需物品、可选物品、协作检查点和队友解锁顺序，与当前定稿对应。
- 每章 100 点体力、三格背包、限定词固定配额 2／3／4／4／3、补给及五枚上限；受击保护、队友冷却按统一模型时间推进。
- 默认指令不消耗限定词。精确指令在开始执行时扣一枚，取消预览、无效目标不扣，重复完成同一目标不刷协作分。
- 每章最高 100 分、五章最高 500 分；必做 60、支线 20、协作 10、独立报警表现 10。
- 广播开关跨章保留；关闭只阻止后续公开任务／交付增长。独立现场报警仍生效。
- 现场警戒与历史暴露分开。成功尝试每次公开指令、公开交付、独立报警各计 2 点历史暴露，每章最多 20、总计最多 100。后章初始警戒取历史暴露除以十向下取整，最多增加 10 点。
- 本章结果先暂存，按“继续／完成主线”才一次提交分数、历史暴露、广播和剧情标记。重复点击无效。
- 手动重试、体力归零、最终撤离超时均回滚至本章入口；失败尝试单独记在当前会话的失败列表，不刷分、不累计失败中的暴露。
- 第四章广播提前关闭时，该目标直接满足，仍须交付两份任务物、设置返航信标、登艇。
- 第五章必须在第四章设置的**远端返航信标**完成三人接应和最终三块装载，准备就绪后再明确确认，才启动 60 秒撤离。登艇前须回母舰交付；末段不能再取支线或补给。
- 章间入口存档及恢复。存档含版本、已提交结果、广播和剧情；主线总分及暴露从结果重新计算。损坏、未知版本和存储禁用均有状态返回，不影响连续游玩。
- 章入口恢复不保存章内位置和进度。刷新会重玩本章；暂存结果未按继续也不会写入存档。

## 文件

- `chapters.mjs`：只读五章配置、规则与评级。
- `state.mjs`：`GameCore` 主线状态 API。
- `storage.mjs`：版本化检查点、字段校验、本地存储容错。
- `verify-core.mjs`：Node 原生断言验证，无测试依赖。

## 浏览器集成

```js
import { GameCore } from './core/state.mjs';
import { browserStorage } from './core/storage.mjs';

const game = GameCore.resume({ storage: browserStorage() });
const initial = game.view();
// initial.storage.ok 为 false 时，界面需明确提示当前不能保存。

// 玩家确认预览；目标的世界可执行性由动作层检查。
const commandId = crypto.randomUUID();
game.prepareCommand({ commandId, teammate: 'Grok', targetId: 'paper-window', precise: false });
game.beginCommand('Grok');

// 动作真正完成后报告；保留发令时 attemptId，隔离旧章和重试前的异步回调。
const attemptId = game.view().attempt.attemptId;
game.worldEvent(attemptId, { type: 'command-complete', teammate: 'Grok', commandId });

// 固定步动作循环传入统一 delta。暂停不推进；慢动作时所有模型时间一起缩放。
game.advanceTime(1000 / 60, { timeScale: 1 });

// 达成目标、回到船上并完成互动后调用 board()，此时只产生暂存结算。
// 点击重试：game.retryChapter()。
// 点击继续：game.continueCampaign()，此时才提交且保存下一章入口。
```

查询用 `view()`；返回动态数据副本，配置自身冻结。失败动作返回 `{ ok: false, reason }`，正常成功返回 `{ ok: true }`。`checkpoint()` 返回可持久化的本章入口，不能当作实时动作存档使用。`new GameCore({ storage })` 表示明确开始新主线，会写入初始检查点；`GameCore.resume({ storage })` 读取存档，不自动覆盖损坏或未知版本记录。

动作层的延迟事件统一经 `worldEvent(attemptId, event)` 报告，避免重试前回调污染新尝试。支持 `pickup`、`supply`、`delivery`、`command-complete`、`alarm`、`damage`、`broadcast`、`return-beacon`、`rendezvous`、`remote-prepare`、`evacuation-confirm`、`board`。事件标识需在当前尝试内唯一，指令完成必须携带原 `commandId`。

## 尚未实现与调用边界

这里没有画面、输入、横版平台碰撞、左右移动／跳跃／冲刺、平台机关、寻路、指令效果、实际交付互动计时、调查扫描实体、音效或触屏。世界层必须确认距离／碰撞／目标效果，再调用成功事件；不能把直接调用这些 API 当作实机玩法验收。广播互动 0.8 秒、交付 0.4／1.6 秒由世界层执行，规则值已导出。

未实现章节挑战及其独立最佳成绩存储、战术慢动作额度、剧情演出与失败次数跨浏览器会话保存。主线失败次数只记当前会话，提交结果时固化该章会话内次数。

五章约 20 分钟仍是策划目标，目前没有五张实机地图，也未进行通关时长、移动端或性能验证。当前断言只验证数据和状态不变量。

## 运行验证

在工作区根目录用 PowerShell：

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '游戏-鲸鱼魔盗团/src/core/verify-core.mjs'
```

验证覆盖：暂存与提交隔离、重试不刷分／暴露、旧尝试事件隔离、精确指令扣费、报警去重、受击与暂停、广播提前关闭不锁第四章、最终章远端确认前计时不启动、撤离超时回滚、五章 500 分闭环和损坏／未知版本／不可用存储。
