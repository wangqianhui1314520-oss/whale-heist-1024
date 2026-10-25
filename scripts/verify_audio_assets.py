#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""《鲸鱼魔盗团》音频资产全量验收：
按 assets/provenance/audio-manifest.json 逐条核对文件存在性、ffprobe 规格（格式/码率/时长/体积/无截断）、
循环类循环缝检查、总体积预算。用法: python scripts/verify_audio_assets.py
"""
import json
import os
import subprocess
import sys

ROOT = r"D:\Vibe coding\1024切磋大会\游戏-鲸鱼魔盗团"
MANIFEST = os.path.join(ROOT, "assets", "provenance", "audio-manifest.json")
LOOP_CHECK = os.path.join(ROOT, "scripts", "audio_loop_check.py")

CATEGORY_SPEC = {
    "music":  {"bitrate": 96.0, "channels": 2},
    "ambience": {"bitrate": 96.0, "channels": 2},
    "sfx":    {"bitrate": 128.0, "channels": 1},
    "voice":  {"bitrate": 96.0, "channels": 1},
}


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration,size:stream=codec_name,sample_rate,channels,bit_rate",
         "-of", "json", path],
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    if out.returncode != 0:
        return None
    data = json.loads(out.stdout)
    fmt = data.get("format", {})
    s = (data.get("streams") or [{}])[0]
    return {
        "duration": float(fmt.get("duration") or 0),
        "bytes": int(fmt.get("size") or 0),
        "codec": s.get("codec_name", ""),
        "bitrate": float(s.get("bit_rate") or 0) / 1000.0,
        "channels": int(s.get("channels") or 0),
    }


def main():
    manifest = json.load(open(MANIFEST, encoding="utf-8"))
    assets = manifest["assets"]
    problems = []
    total_bytes = 0
    ok = 0
    rows = []
    for a in assets:
        aid = a["id"]
        if a.get("status") != "ok":
            problems.append(f"{aid}: status={a.get('status')}")
            continue
        p = os.path.join(ROOT, "assets", "audio", a["category"], aid + ".mp3")
        if not os.path.exists(p):
            problems.append(f"{aid}: file missing {p}")
            continue
        pr = probe(p)
        if pr is None:
            problems.append(f"{aid}: ffprobe failed")
            continue
        spec = CATEGORY_SPEC[a["category"]]
        t = a.get("target_duration_s") or 0
        # 时长区间：目标值 ± 容差（BGM/环境 30-45s 之类已在目标值体现；sfx/voice 用上限）
        if a["category"] in ("music", "ambience"):
            dmin, dmax = t - 1.0, t + 1.5
        elif a["category"] == "sfx":
            dmin, dmax = 0.05, 0.62
        else:
            dmin, dmax = 0.5, 3.4
        if not (dmin <= pr["duration"] <= dmax):
            problems.append(f"{aid}: duration {pr['duration']:.2f}s out of [{dmin},{dmax}]")
        if pr["codec"] != "mp3":
            problems.append(f"{aid}: codec {pr['codec']} != mp3")
        if not (spec["bitrate"] * 0.85 <= pr["bitrate"] <= spec["bitrate"] * 1.2):
            problems.append(f"{aid}: bitrate {pr['bitrate']:.1f}k != ~{spec['bitrate']}k")
        if pr["channels"] != spec["channels"]:
            problems.append(f"{aid}: channels {pr['channels']} != {spec['channels']}")
        rec = a.get("transcoded", {})
        if abs(rec.get("bytes", 0) - pr["bytes"]) > max(64, pr["bytes"] * 0.02):
            problems.append(f"{aid}: recorded bytes {rec.get('bytes')} != actual {pr['bytes']}")
        # 无截断：manifest 记录的 pcm 时长 vs mp3 解码时长（ffprobe 对 mp3 报告的是解码后时长）
        pcm = rec.get("pcm_duration_s")
        if pcm and abs(pcm - pr["duration"]) > max(0.15, 0.02 * pcm):
            problems.append(f"{aid}: truncation? pcm {pcm}s vs mp3 {pr['duration']:.2f}s")
        if a.get("loop"):
            r = subprocess.run([sys.executable, LOOP_CHECK, p], capture_output=True, text=True, encoding="utf-8")
            try:
                lc = json.loads(r.stdout)
                if not lc.get("pass"):
                    problems.append(f"{aid}: loop check fail {json.dumps(lc, ensure_ascii=False)}")
            except Exception:
                problems.append(f"{aid}: loop check could not run ({r.stdout[:200]})")
        ok += 1
        total_bytes += pr["bytes"]
        rows.append((aid, a["category"], round(pr["duration"], 2), pr["bitrate"], pr["channels"], pr["bytes"]))
        a["transcoded"]["duration_s"] = round(pr["duration"], 3)
        a["transcoded"]["bitrate_kbps"] = round(pr["bitrate"], 1)
        a["transcoded"]["bytes"] = pr["bytes"]
    json.dump(manifest, open(MANIFEST, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("=== per-asset (id, category, duration_s, bitrate_kbps, channels, bytes) ===")
    for r in rows:
        print("  %-22s %-9s %8.2f %8.1f %5d %9d" % r)
    print("=== totals ===")
    print(f"ok={ok}/{len(assets)}  total_bytes={total_bytes} ({total_bytes/1024/1024:.2f} MB)  budget=4.5MB")
    if total_bytes > 4.5 * 1024 * 1024:
        problems.append(f"total size {total_bytes/1024/1024:.2f}MB exceeds 4.5MB budget")
    if problems:
        print("=== PROBLEMS ===")
        for p_ in problems:
            print("  - " + p_)
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
