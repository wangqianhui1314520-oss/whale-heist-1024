# 《鲸鱼魔盗团》音频批量生成规格书（2026-10-25，已冻结）

本文件是 4 个并行 Subagent 的统一执行依据。每名 Subagent 只负责下方"分片"里列出的资产，
逐条：**生成 → 下载 → 管线转码 → 落盘 → 自检 → 回报**。禁止修改 `src/`、`scripts/`（管线脚本除外不可动）、
`docs/` 下任何文件，禁止触碰 `assets/` 下除 `assets/audio/` 之外的任何文件。

## 工具链（本机 Windows，shell 一律用 PowerShell）

- 生成：`text_to_audio_plus`（文生音频，返回 WAV 访问 URL）。若你的工具列表里没有它，
  用 `tool_search` 检索 "text to audio" 或 "audio generation"，调用返回的工具。
- 下载：`curl.exe -sL -o <本地路径> <URL>`（URL 是短链会跳转，curl 会跟随）。
- 转码：`python "D:\Vibe coding\1024切磋大会\游戏-鲸鱼魔盗团\scripts\audio_pipeline.py" <wav> <category> <asset_id> <out_dir> [--dur N] [--loop|--no-loop]`
- 循环检查：`python "D:\Vibe coding\1024切磋大会\游戏-鲸鱼魔盗团\scripts\audio_loop_check.py" <mp3>`
- 校验：`ffprobe -v error -show_entries format=duration,size:stream=codec_name,bit_rate,channels -of json <mp3>`

转码管线已封装：规格编码（music/ambience 96k 立体声、sfx 128k 单声道、voice 96k 单声道）、
响度归一化（music 平均 -20dB / ambience 平均 -28dB / sfx 峰值 -8dB / voice 峰值 -12dB）、
无缝循环交叉淡化 + 循环缝淡入淡出、静音裁剪、无截断自检。**逐条按下方参数调用，不要加额外参数。**

## 处理步骤（每条资产）

1. 用 `text_to_audio_plus` 按下方"生成 prompt"逐条调用，每次一条资产；标注"时长参数"的资产在调用时
   传入 `duration` 参数，其余不传。
2. 把返回的 URL 下载到**你自己的 agent workspace 临时目录**（不要放进项目目录），文件名用资产 ID（如 `dash.wav`）。
   下载后先 `ffprobe` 确认是 PCM WAV 且时长 > 0.3s，若异常重新生成。
3. 按"管线参数"列调用 `audio_pipeline.py`。
4. 循环类资产（music/ambience 中 `loop=true` 的）再跑 `audio_loop_check.py` 验证循环缝。
5. 原始 WAV 处理完即删，项目里只保留最终 MP3。
6. 把结果记入回报 JSON。

## 失败重试

- `text_to_audio_plus` 报错：等几秒重试同一 prompt 一次；仍失败则换更简短的措辞再试一次；
  再失败就如实报告该条 status=failed，不要伪造。
- 管线或检查脚本报错：读错误信息修问题；脚本本身如有 bug，记录现象报告给我，不要自行改脚本。

## 回报格式（任务结束时一次性返回）

```json
{
  "slice": "music|ambience+sfx|sfx|voice",
  "assets": [
    {
      "id": "...", "category": "...", "status": "ok|failed",
      "prompt": "生成时实际使用的完整 prompt（逐字）",
      "generation_url": "...",
      "file": "绝对路径", "bytes": 0, "duration_s": 0.0,
      "bitrate_kbps": 0.0, "channels": 0,
      "loop_check": {"run": true, "pass": true},
      "truncation_pass": true,
      "note": "问题说明（如有）"
    }
  ]
}
```

`prompt` 必须逐字记录你实际发送给生成工具的文本（manifest 要登记）；如你改动过下方 prompt，以实际为准。
---

# 分片 1（Agent: 音乐）—— 5 条 BGM，落盘 `assets\audio\music\`

| 资产 ID | 目标/循环 | 生成时长参数 | 管线参数 |
| --- | --- | --- | --- |
| bgm_investigation | 36s 循环 | 44 | `--dur 36 --loop` |
| bgm_evacuation | 36s 循环 | 44 | `--dur 36 --loop` |
| bgm_results | 16s 非循环 | 18 | `--dur 16 --no-loop --fade-tail 0.25` |
| bgm_failure | 10s 非循环 | 12 | `--dur 10 --no-loop --fade-tail 0.2` |
| bgm_story | 30s 循环 | 38 | `--dur 30 --loop` |

生成 prompt（逐字使用）：

- **bgm_investigation**：悬疑紧迫的游戏章节背景音乐，调查揭秘场景配乐。低频弦乐长音脉冲与规律的滴答钟表声交织，随进行逐步加密加厚，营造紧张逼近的气氛但保持克制，不能过于恐怖。乐器编配：低音弦乐群、大提琴、钟表滴答声、微弱合成器低音脉冲、远处木鱼点缀。情绪平稳推进、无剧烈爆发、无明显收尾感，适合无缝循环播放，整体音量适中给音效留空间。时长约44秒。
- **bgm_evacuation**：高速紧迫的游戏撤离背景音乐，倒计时逃出场景配乐。电子脉冲节奏明显偏快，密集的合成器打击与加速的鼓点推进，叠加紧张的低音铺底，节奏感强、能量充沛，适合60秒倒计时撤离。乐器编配：电子脉冲音色、合成器贝斯、快速军鼓与拍手音色、微弱警报衬底。情绪高能持续、无停顿、无明显收尾感，适合无缝循环播放。时长约44秒。
- **bgm_results**：滑稽加冕仪式感的游戏结算背景音乐，章末评分揭晓配乐。小型铜管乐队的上行号角旋律，像卡通片里滑稽的授勋加冕，节奏诙谐欢快带一点夸张，最后干净收尾。乐器编配：小号、长号、圆号、轻鼓与铙钹点缀、低音提琴。时长约18秒，需要有明确干净的开头和结尾。
- **bgm_failure**：诙谐懊恼的游戏失败结算背景音乐，卡通式的垂头丧气。低音提琴拨弦奏出经典的"哇哇"下行音型，配短促无力的弱奏弦乐与一声小号"噗"，幽默可爱而非悲伤沉重。乐器编配：低音提琴拨弦、弦乐群弱奏、小号、鼓刷轻点。时长约12秒，开头明确、结尾干净。
- **bgm_story**：叙事性的游戏剧情演出背景音乐，轻柔的弦乐与钢琴长音垫底，温暖、专注、略带期待，给对白留出空间，不抢戏。乐器编配：弦乐群长音、钢琴分解和弦、极轻的竖琴点缀。情绪平稳安静、无旋律性抢戏、无明显收尾感，适合无缝循环播放，整体音量较低。时长约38秒。

# 分片 2（Agent: 环境+音效A）—— 3 条环境 + 8 条音效

环境落盘 `assets\audio\ambience\`，音效落盘 `assets\audio\sfx\`。

| 资产 ID | 类别 | 目标/循环 | 生成时长参数 | 管线参数 |
| --- | --- | --- | --- | --- |
| amb_harbor | ambience | 25s 循环 | 32 | `--dur 25 --loop` |
| amb_ops | ambience | 25s 循环 | 32 | `--dur 25 --loop` |
| amb_alarm | ambience | 15s 循环 | 20 | `--dur 15 --loop` |
| dash | sfx | ≤0.55s | 1 | （无额外参数） |
| impact | sfx | ≤0.55s | 1 | （无额外参数） |
| pickup | sfx | ≤0.55s | 1 | （无额外参数） |
| delivery | sfx | ≤0.55s | 1 | （无额外参数） |
| command-confirm | sfx | ≤0.55s | 1 | （无额外参数） |
| alarm | sfx | ≤0.55s | 1 | （无额外参数） |
| results | sfx | ≤0.55s | 1 | （无额外参数） |
| jump | sfx | ≤0.55s | 1 | （无额外参数） |

生成 prompt（逐字使用）：

- **amb_harbor**：海港氛围环境音：轻柔的波浪拍打岸边、水滴落下、远处低沉的气笛偶尔响起、海鸥鸣叫很轻，安静舒适的海港清晨，无音乐，适合游戏章节背景环境。声音连续平稳、无突兀事件、无明显收尾感，适合无缝循环播放。时长约32秒。
- **amb_ops**：机房运转环境音：服务器风扇低沉的持续嗡鸣、硬盘读写细碎声、键盘敲击声很轻、散热底噪，安静的机房内部，无音乐。声音连续平稳、无突兀事件、无明显收尾感，适合无缝循环播放。时长约32秒。
- **amb_alarm**：警戒警报环境音：低频持续嗡鸣加上规律雷达脉冲"哔——"声，间隔均匀、紧张但克制，像基地警戒状态，无音乐。声音连续、无明显收尾感，适合无缝循环播放。时长约20秒。
- **dash**：游戏音效：鲸形冲刺滑行，水花"唰"的一声加气泡，清亮利落，卡通风格，约1秒，开头立即起音、结尾干净。
- **impact**：游戏音效：撞开数据节点的玻璃罐碎裂声加低频"砰"，带一点金属尾音，有力但不刺耳，卡通夸张风格，约1秒，开头立即起音、结尾干净。
- **pickup**：游戏音效：数据吸附入包的"啵"一声加轻微电子收束音，短促可爱，卡通风格，约1秒，开头立即起音、结尾干净。
- **delivery**：游戏音效：交付确认的"叮"一声加小号上行两音，清脆上扬、有成就感，卡通风格，约1秒，开头立即起音、结尾干净。
- **command-confirm**：游戏音效：战术指令确认电子音，双音短促确认，区别于交付音，偏电子设备感，卡通风格，约1秒，开头立即起音、结尾干净。
- **alarm**：游戏音效：警戒报警器高频双音脉冲，重复两到三次的"哔哔"声，紧张但卡通化，约1秒，开头立即起音、结尾干净。
- **results**：游戏音效：结算播报加冕号角，短促欢快的铜管上行两三个音，与加冕主题呼应，卡通风格，约1秒，开头立即起音、结尾干净。
- **jump**：游戏音效：跳跃或爬梯的轻弹跳音，弹性十足、俏皮，卡通风格，约1秒，开头立即起音、结尾干净。

# 分片 3（Agent: 音效B）—— 8 条音效，落盘 `assets\audio\sfx\`

| 资产 ID | 类别 | 目标 | 生成时长参数 | 管线参数 |
| --- | --- | --- | --- | --- |
| ui | sfx | ≤0.55s | 1 | （无额外参数） |
| door | sfx | ≤0.55s | 1 | （无额外参数） |
| story | sfx | ≤0.55s | 1 | （无额外参数） |
| story-page | sfx | ≤0.55s | 1 | （无额外参数） |
| story-scan | sfx | ≤0.55s | 1 | （无额外参数） |
| story-impact | sfx | ≤0.55s | 1 | （无额外参数） |
| story-alert | sfx | ≤0.55s | 1 | （无额外参数） |
| story-beacon | sfx | ≤0.55s | 1 | （无额外参数） |

生成 prompt（逐字使用）：

- **ui**：游戏音效：通用界面点击，柔和纸感的"咔哒"一声，轻巧安静，卡通风格，约1秒，开头立即起音、结尾干净。
- **door**：游戏音效：舱门气动开合的"嘶——砰"两声，先放气声再关门声，Q版卡通风格，约1秒，开头立即起音、结尾干净。
- **story**：游戏音效：剧情翻页或推进，纸页翻动声加一个轻提示音，干净利落，卡通风格，约1秒，开头立即起音、结尾干净。
- **story-page**：游戏音效：剧情对话框的短促打字或翻页声，细碎轻快，卡通风格，约1秒，开头立即起音、结尾干净。
- **story-scan**：游戏音效：电子网格扫描扫频音，由低到高的电子扫描"嗖——"，科技感，卡通风格，约1秒，开头立即起音、结尾干净。
- **story-impact**：游戏音效：剧情中破障的低沉撞击声，闷响一下带轻微震动，不刺耳，卡通风格，约1秒，开头立即起音、结尾干净。
- **story-alert**：游戏音效：剧情中警报的柔和变体，比常规警报更轻更柔和的高频双音，提示感强但不刺耳，卡通风格，约1秒，开头立即起音、结尾干净。
- **story-beacon**：游戏音效：返航信标的灯塔脉冲"叮——嘟"两音，一高一低、温暖清晰，卡通风格，约1秒，开头立即起音、结尾干净。

# 分片 4（Agent: 语音）—— 20 条中文语音短句，落盘 `assets\audio\voice\`

音色规范（Q 版动画配音感，纯 AI 合成，无人声克隆）：

| 角色 | 音色描述 |
| --- | --- |
| hero（主角） | 年轻元气少女，活泼明亮，带一点俏皮 |
| grok | 爽朗利落的青年男声，干脆带笑 |
| claude | 文静知性的青年女声，温柔平稳 |
| glm | 冷静理性的青年男声，沉稳平淡 |

每条调用格式：prompt = `Q版动画配音风格，{音色描述}，用中文自然地说台词：{台词}`（逐字使用下表）。
**不传 duration 参数**。管线参数：`python audio_pipeline.py <wav> voice <id> <voice目录>`（无额外参数）。

| 资产 ID | 角色 | 台词 |
| --- | --- | --- |
| voice_hero_confirm | hero | 收到，出发！ |
| voice_hero_charge | hero | 冲锋！ |
| voice_hero_scan | hero | 扫描完成！ |
| voice_hero_encourage | hero | 别怕，跟我来！ |
| voice_hero_evacuate | hero | 快撤快撤，跟上我！ |
| voice_grok_confirm | grok | 明白，包在我身上！ |
| voice_grok_charge | grok | 就是现在，冲！ |
| voice_grok_pickup | grok | 数据到手啦！ |
| voice_grok_evacuate | grok | 走走走，别磨蹭！ |
| voice_grok_cheer | grok | 嘿嘿，小菜一碟！ |
| voice_claude_confirm | claude | 收到，交给我吧。 |
| voice_claude_analyze | claude | 正在分析…… |
| voice_claude_careful | claude | 小心些，慢慢来。 |
| voice_claude_record | claude | 记录已归档。 |
| voice_claude_alert | claude | 发现异常，请留意。 |
| voice_glm_confirm | glm | 指令确认。 |
| voice_glm_scan | glm | 扫描完成，一切正常。 |
| voice_glm_warn | glm | 警戒值上升，请注意。 |
| voice_glm_public | glm | 您的作战记录，任何人均可查看。 |
| voice_glm_route | glm | 撤离路线已计算完毕。 |

台词均为游戏内喜剧向短句，不含任何真实攻击细节或人物贬损，仅限本表内容，不得自行增删台词或角色。
