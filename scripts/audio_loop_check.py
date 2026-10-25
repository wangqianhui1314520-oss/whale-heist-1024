#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MP3 循环点检查：解码后统计整体峰值、循环缝（边界样本落差与首尾 2ms 电平）、中段电平。

判定：
- no_clip  : 整体峰值 < 0dB（无削波）
- no_click : 边界样本落差 |last-first| < 1% 满幅（loop=true 跳转点无爆音），且首/尾 2ms 电平显著低于中段（淡入淡出生效）
- 中段电平存在（非静音文件）

用法: python audio_loop_check.py <mp3>
"""
import array
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import wave


def decode_to_wav(mp3):
    tmp = os.path.join(tempfile.mkdtemp(prefix="loopchk_"), "dec.wav")
    subprocess.run(["ffmpeg", "-hide_banner", "-y", "-i", mp3, "-f", "wav", tmp],
                   check=True, capture_output=True)
    return tmp


def db(v):
    return round(20 * math.log10(max(v, 1e-7)), 2)


def main():
    mp3 = sys.argv[1]
    tmp = decode_to_wav(mp3)
    try:
        w = wave.open(tmp, "rb")
        n = w.getnframes()
        ch = w.getnchannels()
        sr = w.getframerate()
        sw = w.getsampwidth()
        data = w.readframes(n)
        w.close()
        fmt = {1: "b", 2: "h", 4: "i"}[sw]
        a = array.array(fmt)
        a.frombytes(data)
        if ch > 1:
            a = a[::ch]
        norm = 2 ** (8 * sw - 1)
        dur = n / sr

        def amp_db(t0, t1):
            i0, i1 = int(t0 * sr), int(t1 * sr)
            seg = a[i0:i1]
            if not seg:
                return float("-inf")
            return db(max(abs(x) for x in seg) / norm)

        peak = max(abs(x) for x in a) / norm
        boundary_delta = abs(a[-1] - a[0]) / norm
        head2 = amp_db(0.0, 0.002)
        tail2 = amp_db(max(0.0, dur - 0.002), dur)
        mid = amp_db(0.3, 0.6)
        no_clip = peak < 0.995
        no_click = boundary_delta < 0.01 and head2 < mid - 10 and tail2 < mid - 10
        mid_present = mid > -50
        print(json.dumps({
            "file": mp3,
            "duration_s": round(dur, 3),
            "peak_db": db(peak),
            "boundary_delta_db": db(boundary_delta),
            "head_2ms_db": head2,
            "tail_2ms_db": tail2,
            "mid_db": mid,
            "no_clip": no_clip,
            "no_click": no_click,
            "mid_present": mid_present,
            "pass": no_clip and no_click and mid_present,
        }, ensure_ascii=False, indent=2))
        return 0 if (no_clip and no_click and mid_present) else 1
    finally:
        shutil.rmtree(os.path.dirname(tmp), ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
