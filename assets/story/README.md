# 剧情演出关键帧

这些宽幅 PNG 是本项目为剧情动画新增的生成美术资产，不属于普通关卡背景或角色头像。

| 文件 | 剧情节点 | 接入方式 |
| --- | --- | --- |
| `prologue-paper-window.png` | 序章接单、观察纸窗 | `story-prologue` |
| `grok-paper-window.png` | Grok 首次破窗加入 | `story-grok` |
| `broadcast-reveal.png` | 第四章广播反转 | `story-broadcast` |
| `evacuation-beacon.png` | 第五章远端集结与撤离准备 | `story-evacuation` |
| `investigation-epilogue.png` | 尾声调查笔录 | `story-epilogue` |

`src/game/story.mjs` 为每个关键镜头指定节点，`src/ui/ui-v3.mjs` 的电影、实景和分镜模式共同读取这些图片；镜头平移、角色头像、粒子效果和字幕仍由运行时叠加。每张图均保留对应的 `assets/prompts/` 与 `assets/provenance/` 记录。
