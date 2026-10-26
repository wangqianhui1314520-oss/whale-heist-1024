#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""装配 assets/provenance/audio-manifest.json：
- prompt：从 scripts/audio-generation-brief.md 解析逐字 prompt（voice 按模板构造）
- 转码数据：music/ambience 用嵌入的管线报告；sfx/voice 用 reprocess 报告 JSON
输出完整登记清单。
"""
import csv
import json
import os
import re

ROOT = r"D:\Vibe coding\1024切磋大会\游戏-鲸鱼魔盗团"
BRIEF = os.path.join(ROOT, "scripts", "audio-generation-brief.md")
OUT = os.path.join(ROOT, "assets", "provenance", "audio-manifest.json")
DATE = "2026-10-25"
TOOL = "text_to_audio_plus"

META = {
    # id: (category, use, target_duration_s, loop, priority)
    "bgm_title": ("music", "标题/主菜单背景音乐", 30, True, "P1"),
    "bgm_harbor": ("music", "第1–3章行动背景音乐", 36, True, "P0"),
    "bgm_investigation": ("music", "第4章战报公开背景音乐", 36, True, "P1"),
    "bgm_evacuation": ("music", "第5章60秒撤离背景音乐", 36, True, "P0"),
    "bgm_results": ("music", "章末结算/总评背景音乐", 16, False, "P0"),
    "bgm_failure": ("music", "失败结算背景音乐", 10, False, "P1"),
    "bgm_story": ("music", "剧情演出背景音乐", 30, True, "P1"),
    "amb_harbor": ("ambience", "港口常驻氛围（1–4章）", 25, True, "P0"),
    "amb_ops": ("ambience", "机房运转氛围（室内叠加）", 25, True, "P1"),
    "amb_alarm": ("ambience", "警戒≥70时叠层", 15, True, "P1"),
    "dash": ("sfx", "鲸形冲刺（水花滑行）", 0.3, False, "P0"),
    "impact": ("sfx", "撞开数据节点/破障", 0.3, False, "P0"),
    "pickup": ("sfx", "数据吸附入包", 0.3, False, "P0"),
    "delivery": ("sfx", "交付数据确认", 0.3, False, "P0"),
    "command-confirm": ("sfx", "指令确认", 0.3, False, "P0"),
    "alarm": ("sfx", "警戒器报警", 0.4, False, "P0"),
    "results": ("sfx", "结算播报加冕号角", 0.4, False, "P0"),
    "jump": ("sfx", "跳跃/爬梯", 0.3, False, "P1"),
    "ui": ("sfx", "通用UI点击", 0.2, False, "P1"),
    "door": ("sfx", "房间切换/登艇舱门", 0.5, False, "P1"),
    "story": ("sfx", "剧情翻页/推进", 0.4, False, "P1"),
    "story-page": ("sfx", "剧情对话框打字/翻页", 0.3, False, "P1"),
    "story-scan": ("sfx", "GLM电子网格扫描", 0.5, False, "P1"),
    "story-impact": ("sfx", "剧情中破障撞击", 0.4, False, "P1"),
    "story-alert": ("sfx", "剧情中柔和警报", 0.4, False, "P1"),
    "story-beacon": ("sfx", "返航信标灯塔脉冲", 0.5, False, "P1"),
}

VOICE_CHARS = {
    "hero": "年轻元气少女，活泼明亮，带一点俏皮",
    "grok": "爽朗利落的青年男声，干脆带笑",
    "claude": "文静知性的青年女声，温柔平稳",
    "glm": "冷静理性的青年男声，沉稳平淡",
}
VOICE_LINES = {
    "voice_hero_confirm": ("hero", "收到，出发！"),
    "voice_hero_charge": ("hero", "冲锋！"),
    "voice_hero_scan": ("hero", "扫描完成！"),
    "voice_hero_encourage": ("hero", "别怕，跟我来！"),
    "voice_hero_evacuate": ("hero", "快撤快撤，跟上我！"),
    "voice_grok_confirm": ("grok", "明白，包在我身上！"),
    "voice_grok_charge": ("grok", "就是现在，冲！"),
    "voice_grok_pickup": ("grok", "数据到手啦！"),
    "voice_grok_evacuate": ("grok", "走走走，别磨蹭！"),
    "voice_grok_cheer": ("grok", "嘿嘿，小菜一碟！"),
    "voice_claude_confirm": ("claude", "收到，交给我吧。"),
    "voice_claude_analyze": ("claude", "正在分析……"),
    "voice_claude_careful": ("claude", "小心些，慢慢来。"),
    "voice_claude_record": ("claude", "记录已归档。"),
    "voice_claude_alert": ("claude", "发现异常，请留意。"),
    "voice_glm_confirm": ("glm", "指令确认。"),
    "voice_glm_scan": ("glm", "扫描完成，一切正常。"),
    "voice_glm_warn": ("glm", "警戒值上升，请注意。"),
    "voice_glm_public": ("glm", "您的作战记录，任何人均可查看。"),
    "voice_glm_route": ("glm", "撤离路线已计算完毕。"),
}

# 音乐/环境：管线报告（种子=自行生成；其余=分片回报；results/failure=修复后重处理）
MUSIC_AMB_REPORT = {
    "bgm_title": {"duration_s": 30.0, "bitrate_kbps": 96.0, "channels": 2, "bytes": 360847, "pcm_duration_s": 30.0,
                  "url": "https://aka.doubaocdn.com/s/7oVgg1e5NL"},
    "bgm_harbor": {"duration_s": 36.0, "bitrate_kbps": 96.0, "channels": 2, "bytes": 432945, "pcm_duration_s": 36.0,
                   "url": "https://aka.doubaocdn.com/s/n62k2avfiu"},
    "bgm_investigation": {"duration_s": 36.0, "bitrate_kbps": 96.2, "channels": 2, "bytes": 432945, "pcm_duration_s": 36.0,
                          "url": "https://aka.doubaocdn.com/s/Urjma4SWlL"},
    "bgm_evacuation": {"duration_s": 36.0, "bitrate_kbps": 96.2, "channels": 2, "bytes": 432945, "pcm_duration_s": 36.0,
                       "url": "https://aka.doubaocdn.com/s/96rgterc2V"},
    "bgm_results": {"duration_s": 16.0, "bitrate_kbps": 96.0, "channels": 2, "bytes": 192827, "pcm_duration_s": 16.0,
                    "url": "https://aka.doubaocdn.com/s/DAyYuMcajT"},
    "bgm_failure": {"duration_s": 10.0, "bitrate_kbps": 96.0, "channels": 2, "bytes": 120729, "pcm_duration_s": 10.0,
                    "url": "https://aka.doubaocdn.com/s/WBYhm39da6"},
    "bgm_story": {"duration_s": 30.0, "bitrate_kbps": 96.2, "channels": 2, "bytes": 360847, "pcm_duration_s": 30.0,
                  "url": "https://aka.doubaocdn.com/s/V7anXUAjJv"},
    "amb_harbor": {"duration_s": 25.0, "bitrate_kbps": 96.0, "channels": 2, "bytes": 300974, "pcm_duration_s": 25.0,
                   "url": "https://aka.doubaocdn.com/s/dBQwDLYzC8"},
    "amb_ops": {"duration_s": 25.0, "bitrate_kbps": 96.0, "channels": 2, "bytes": 300974, "pcm_duration_s": 25.0,
                "url": "https://aka.doubaocdn.com/s/jUM2OcMdWP"},
    "amb_alarm": {"duration_s": 15.0, "bitrate_kbps": 96.0, "channels": 2, "bytes": 180915, "pcm_duration_s": 15.0,
                  "url": "https://aka.doubaocdn.com/s/x4uBZEjb67"},
}


def brief_prompts():
    """解析规格书：- **<id>**：<prompt 单行> → {id: prompt}"""
    text = open(BRIEF, encoding="utf-8").read()
    found = {}
    for m in re.finditer(r"^\- \*\*(bgm_\w+|amb_\w+|dash|impact|pickup|delivery|command-confirm|alarm|results|jump|ui|door|story|story-page|story-scan|story-impact|story-alert|story-beacon)\*\*：(.+)$", text, re.M):
        found[m.group(1)] = m.group(2).strip()
    return found


SEED_PROMPTS = {
    "bgm_title": "诙谐欢快的海港阳光背景音乐，动画游戏标题界面配乐。主奏手风琴轻快小调旋律，配轻快的鼓点与零星水花、气泡点缀音色，节奏明朗活泼，卡通感十足，情绪轻松阳光带一点俏皮。整体风格为轻爵士与海港民谣的混合，音色温暖明亮。乐器编配：手风琴、原声贝斯、轻鼓组、零星水花和气泡音效点缀。旋律平稳持续、无剧烈起伏、无明显收尾感，适合无缝循环播放。时长约32秒。",
    "bgm_harbor": "轻快带一点悬念感的轻爵士游戏行动背景音乐，海港冒险场景配乐。中速轻爵士律动，钢琴与电钢琴交织的旋律线，低音提琴拨奏，轻爵士鼓刷节奏，点缀水滴般的清脆音色和微弱电子脉冲，营造\"海港阳光但暗藏悬念\"的气氛。乐器编配：钢琴、低音提琴、鼓刷、马林巴滴水音色、微弱合成器脉冲。情绪平稳持续、无剧烈变化、无明显收尾感，适合无缝循环播放，整体音量适中，给游戏音效留出空间。时长约48秒。",
}


def main():
    prompts = brief_prompts()
    prompts.update(SEED_PROMPTS)
    # sfx/voice 转码数据与 URL
    sfx_data = {a["id"]: a for a in json.load(open(os.path.join(ROOT, "scripts", "reprocess_sfx_report.json"), encoding="utf-8"))["assets"]}
    voice_data = {a["id"]: a for a in json.load(open(os.path.join(ROOT, "scripts", "reprocess_voice_report.json"), encoding="utf-8"))["assets"]}

    assets = []
    order = list(META) + list(VOICE_LINES)
    for aid in order:
        if aid in META:
            cat, use, target, loop, prio = META[aid]
            if cat in ("music", "ambience"):
                rep = MUSIC_AMB_REPORT[aid]
                tr = {k: rep[k] for k in ("duration_s", "bitrate_kbps", "channels", "bytes", "pcm_duration_s")}
                url = rep["url"]
                prompt = prompts[aid]
            else:
                rep = sfx_data[aid]
                tr = {"duration_s": rep["duration_s"], "bitrate_kbps": rep["bitrate_kbps"],
                      "channels": rep["channels"], "bytes": rep["bytes"], "pcm_duration_s": rep.get("pcm_duration_s", rep["duration_s"])}
                url = next(r["url"] for r in csv.DictReader(open(os.path.join(ROOT, "scripts", "reprocess_sfx.csv"), encoding="utf-8-sig")) if r["id"] == aid)
                prompt = prompts[aid]
            char_name = None
        else:
            char, line = VOICE_LINES[aid]
            rep = voice_data[aid]
            tr = {"duration_s": rep["duration_s"], "bitrate_kbps": rep["bitrate_kbps"],
                  "channels": rep["channels"], "bytes": rep["bytes"], "pcm_duration_s": rep.get("pcm_duration_s", rep["duration_s"])}
            url = next(r["url"] for r in csv.DictReader(open(os.path.join(ROOT, "scripts", "reprocess_voice.csv"), encoding="utf-8-sig")) if r["id"] == aid)
            prompt = "Q版动画配音风格，%s，用中文自然地说台词：%s" % (VOICE_CHARS[char], line)
            cat, use, target, loop, prio = "voice", "角色语音短句（%s）" % char, 2.0, False, "P2"
            char_name = char
        entry = {
            "id": aid, "category": cat, "use": use,
            "target_duration_s": target, "loop": loop, "priority": prio,
            "prompt": prompt, "tool": TOOL, "generation_date": DATE,
            "generation_url": url,
            "transcoded": {**tr, "duration_s": round(tr["duration_s"], 2)},
            "status": "ok" if rep.get("status", "ok") == "ok" else rep.get("status"),
        }
        if char_name:
            entry["character"] = char_name
        assets.append(entry)

    manifest = {
        "schema_version": "1.0.0",
        "project": "鲸鱼魔盗团",
        "generated": DATE,
        "tool": TOOL,
        "note": "音频资产生成登记（满足策划案'登记声音来源'要求）。语音为纯 AI 合成、无真人声纹。",
        "assets": assets,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(manifest, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    missing_prompts = [aid for aid in META if prompts.get(aid) is None]
    print(json.dumps({"written": OUT, "assets": len(assets),
                      "missing_prompts": missing_prompts,
                      "counts": {c: sum(1 for a in assets if a["category"] == c) for c in ("music", "ambience", "sfx", "voice")}},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
