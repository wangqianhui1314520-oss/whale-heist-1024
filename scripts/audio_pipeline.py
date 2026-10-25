#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""《鲸鱼魔盗团》音频资产转码管线。

用法:
  python audio_pipeline.py <input> <category> <asset_id> <out_dir> [--dur SEC] [--loop|--no-loop] [--fade-tail SEC]

category: music | ambience | sfx | voice
  music      : 96kbps 立体声 MP3，响度归一化到平均 -20dB；默认无缝循环（--loop）
  ambience   : 96kbps 立体声 MP3，响度归一化到平均 -28dB；默认无缝循环（--loop）
  sfx        : 128kbps 单声道 MP3，峰值 -8dB，去首尾静音，上限 0.55s
  voice      : 96kbps 单声道 MP3，峰值 -12dB，去首尾静音，上限 3.2s

--loop 无缝循环做法：取尾部 F 秒与头部 F 秒做三角交叉淡化拼回主体，
再在绝对循环点（缓冲区首尾）各加 30ms 淡入/淡出，保证 Web Audio loop=true 下无爆音。
--no-loop 非循环：仅裁剪 + 尾部淡出。

输出: <out_dir>/<asset_id>.mp3，stdout 打印 JSON 报告。
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"


def run(args, check=True):
    p = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and p.returncode != 0:
        raise RuntimeError("cmd failed: %s\n%s" % (" ".join(args), p.stderr[-2500:]))
    return p.stdout, p.stderr


def probe(path):
    out, _ = run([FFPROBE, "-v", "error", "-show_entries",
                  "format=duration,size:stream=codec_name,sample_rate,channels,bit_rate",
                  "-of", "json", path])
    data = json.loads(out)
    fmt = data.get("format", {})
    streams = data.get("streams", []) or [{}]
    s = streams[0]
    return {
        "duration": float(fmt.get("duration") or 0),
        "bytes": int(fmt.get("size") or 0),
        "codec": s.get("codec_name", ""),
        "sample_rate": int(s.get("sample_rate") or 0),
        "channels": int(s.get("channels") or 0),
        "bit_rate": int(s.get("bit_rate") or 0),
    }


def loudness(wav):
    """Return (mean_volume_db, max_volume_db) via volumedetect (parsed from stderr)."""
    _, err = run([FFMPEG, "-hide_banner", "-i", wav, "-af", "volumedetect", "-f", "null", "-"])
    mean = re.search(r"mean_volume:\s*([-+]?[\d.]+) dB", err)
    mx = re.search(r"max_volume:\s*([-+]?[\d.]+) dB", err)
    if not mean or not mx:
        raise RuntimeError("volumedetect parse failed: %s" % err[-1500:])
    return float(mean.group(1)), float(mx.group(1))


def build_filter(category, asset_id, dur, loop, fade_tail):
    """Return (filter_complex, pcm_target_duration_hint)."""
    if category in ("music", "ambience"):
        ch = "stereo"
        if loop:
            # L = effective loop length
            return None  # handled separately in make_loop
        else:
            fc = (
                "[0:a]aresample=44100,aformat=channel_layouts=stereo,"
                "atrim=0:%s,asetpts=N/SR/TB" % dur
            )
            if fade_tail:
                # afade=t=out 不带 st 会从流起点开始淡出（之后全部静音），
                # 故用"反转+淡入+反转"实现只淡化尾部 fade_tail 秒
                fc += ",areverse,afade=t=in:d=%s,areverse" % fade_tail
            return fc, dur
    if category == "sfx":
        fc = (
            "[0:a]aresample=44100,aformat=channel_layouts=mono,"
            "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05:"
            "stop_periods=1:stop_threshold=-45dB:stop_silence=0.05,"
            "atrim=0:0.55,asetpts=N/SR/TB,areverse,afade=t=in:d=0.06,areverse"
        )
        return fc, 0.55
    if category == "voice":
        fc = (
            "[0:a]aresample=44100,aformat=channel_layouts=mono,"
            "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03:"
            "stop_periods=1:stop_threshold=-45dB:stop_silence=0.03,"
            "atrim=0:3.2,asetpts=N/SR/TB,afade=t=in:d=0.03,areverse,afade=t=in:d=0.05,areverse"
        )
        return fc, 3.2
    raise ValueError("unknown category: %s" % category)


def make_loop(wav, L, F, fade):
    """Crossfade-loop L seconds of wav, plus `fade` boundary fades. Returns output wav path."""
    out_wav = wav + ".loop.wav"
    fc = (
        "[0:a]aresample=44100,aformat=channel_layouts=stereo,"
        "atrim=0:%s,asetpts=N/SR/TB[a]" % L
    )
    fc += ";"
    fc += "[a]asplit=3[a1][a2][a3];"
    fc += "[a1]atrim=0:%s,asetpts=N/SR/TB[body];" % (L - F)
    fc += "[a2]atrim=%s:%s,asetpts=N/SR/TB[tail];" % (L - F, L)
    fc += "[a3]atrim=0:%s,asetpts=N/SR/TB[head];" % F
    fc += "[tail][head]acrossfade=d=%s:c1=tri:c2=tri[xf];" % F
    fc += "[body][xf]concat=n=2:v=0:a=1"
    if fade:
        fc += ",afade=t=in:d=%s,afade=t=out:st=%s:d=%s" % (fade, L - fade, fade)
    run([FFMPEG, "-hide_banner", "-y", "-i", wav, "-filter_complex", fc, out_wav])
    return out_wav


def encode_pcm(pcm_wav, category, out_mp3):
    if category in ("music", "ambience"):
        bitrate, channels = "96k", 2
    elif category == "sfx":
        bitrate, channels = "128k", 1
    else:
        bitrate, channels = "96k", 1
    run([FFMPEG, "-hide_banner", "-y", "-i", pcm_wav,
         "-map", "0:a", "-c:a", "libmp3lame", "-b:a", bitrate,
         "-ac", str(channels), "-ar", "44100", out_mp3])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("category", choices=["music", "ambience", "sfx", "voice"])
    ap.add_argument("asset_id")
    ap.add_argument("out_dir")
    ap.add_argument("--dur", type=float, default=0.0, help="target trimmed duration (s)")
    ap.add_argument("--loop", dest="loop", action="store_true", default=None)
    ap.add_argument("--no-loop", dest="loop", action="store_false")
    ap.add_argument("--fade-tail", type=float, default=0.0)
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    inp = probe(args.input)
    src_dur = inp["duration"]
    report = {"id": args.asset_id, "category": args.category,
              "source_duration": round(src_dur, 3), "loop": bool(args.loop)}

    tmp = tempfile.mkdtemp(prefix="audio_pipe_")
    try:
        pcm = os.path.join(tmp, "pcm.wav")
        dur = args.dur or src_dur
        loop = args.loop if args.loop is not None else (args.category in ("music", "ambience"))

        if loop and args.category in ("music", "ambience"):
            L = min(dur, src_dur)
            if L < 3.5:
                report["loop"] = False
                report["loop_warning"] = "source too short for crossfade loop"
                fc, hint = build_filter(args.category, args.asset_id, L, False, args.fade_tail or 0.25)
                run([FFMPEG, "-hide_banner", "-y", "-i", args.input, "-filter_complex", fc, pcm])
            else:
                F = min(0.4, L * 0.25)
                pcm = make_loop(args.input, L, F, 0.03)
                report["loop"] = True
                report["loop_crossfade_s"] = round(F, 3)
                report["loop_length_s"] = round(L, 3)
        else:
            fc, hint = build_filter(args.category, args.asset_id, dur, False, args.fade_tail)
            run([FFMPEG, "-hide_banner", "-y", "-i", args.input, "-filter_complex", fc, pcm])

        mean, peak = loudness(pcm)
        if args.category == "music":
            gain = -20.0 - mean
            report["normalize"] = {"mode": "mean", "target_db": -20.0, "measured_mean_db": round(mean, 2)}
        elif args.category == "ambience":
            gain = -28.0 - mean
            report["normalize"] = {"mode": "mean", "target_db": -28.0, "measured_mean_db": round(mean, 2)}
        elif args.category == "sfx":
            gain = -8.0 - peak
            report["normalize"] = {"mode": "peak", "target_db": -8.0, "measured_peak_db": round(peak, 2)}
        else:
            gain = -12.0 - peak
            report["normalize"] = {"mode": "peak", "target_db": -12.0, "measured_peak_db": round(peak, 2)}
        gain = max(-40.0, min(24.0, gain))
        # 峰值保护：均值归一化可能把峰值推过 0dB，增益不得超过 (-1.0 - 原始峰值)
        peak_guard = -1.0 - peak
        if gain > peak_guard:
            gain = peak_guard
        report["normalize"]["applied_gain_db"] = round(gain, 2)

        if abs(gain) > 0.01:
            gained = pcm + ".g.wav"
            run([FFMPEG, "-hide_banner", "-y", "-i", pcm, "-af", "volume=%sdB" % gain, gained])
            pcm = gained

        out_mp3 = os.path.join(args.out_dir, args.asset_id + ".mp3")
        encode_pcm(pcm, args.category, out_mp3)
        out = probe(out_mp3)
        report["file"] = out_mp3
        report["duration_s"] = round(out["duration"], 3)
        report["bitrate_kbps"] = round(out["bit_rate"] / 1000.0, 1)
        report["channels"] = out["channels"]
        report["sample_rate"] = out["sample_rate"]
        report["codec"] = out["codec"]
        report["bytes"] = out["bytes"]
        pcm_probe = probe(pcm)
        report["pcm_duration_s"] = round(pcm_probe["duration"], 3)
        # 无截断校验：MP3 解码时长应接近 PCM 时长（±2% 或 ±0.15s）
        drift = abs(out["duration"] - pcm_probe["duration"])
        report["truncation_check"] = {"pass": drift <= max(0.15, 0.02 * pcm_probe["duration"]), "drift_s": round(drift, 3)}
        # 静音检测：最终 MP3 峰值显著低于目标即判失败（防 afade/滤波把整段弄静音）
        peak_threshold = {"music": -25.0, "ambience": -30.0, "sfx": -18.0, "voice": -25.0}[args.category]
        _, err = run([FFMPEG, "-hide_banner", "-i", out_mp3, "-af", "volumedetect", "-f", "null", "-"])
        mxm = re.search(r"max_volume:\s*([-+]?[\d.]+) dB", err)
        final_max = float(mxm.group(1)) if mxm else float("-inf")
        report["final_max_db"] = round(final_max, 2)
        report["silence_check"] = {"pass": final_max >= peak_threshold, "threshold_db": peak_threshold}
        report["status"] = "ok" if report["truncation_check"]["pass"] and report["silence_check"]["pass"] else "failed"
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report["status"] == "ok" else 2
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
