#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""集中重处理：按 CSV（id,category,url,expected_s,args...）重新下载原始 WAV、
经 audio_pipeline.py 转码落盘并收集报告。CSV 第一行是表头。
用法: python scripts/audio_reprocess.py <csv> [--out report.json]
"""
import csv
import json
import os
import subprocess
import sys
import tempfile
import urllib.request

ROOT = r"D:\Vibe coding\1024切磋大会\游戏-鲸鱼魔盗团"
PIPE = os.path.join(ROOT, "scripts", "audio_pipeline.py")
OUTDIR = os.path.join(ROOT, "assets", "audio")


def probe_duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    try:
        return float(out.stdout.strip())
    except Exception:
        return 0.0


def main():
    csv_path = sys.argv[1]
    report_path = sys.argv[2] if len(sys.argv) > 2 else None
    rows = list(csv.DictReader(open(csv_path, encoding="utf-8-sig")))
    tmp = tempfile.mkdtemp(prefix="audio_redo_")
    results = []
    failures = []
    try:
        for r in rows:
            aid, cat, url = r["id"].strip(), r["category"].strip(), r["url"].strip()
            exp = float(r.get("expected_s") or 0)
            wav = os.path.join(tmp, aid + ".wav")
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=180) as resp, open(wav, "wb") as f:
                    f.write(resp.read())
            except Exception as e:
                failures.append({"id": aid, "step": "download", "error": str(e)})
                continue
            size = os.path.getsize(wav)
            dur = probe_duration(wav)
            entry = {"id": aid, "category": cat, "url": url, "download_bytes": size, "download_duration_s": round(dur, 2)}
            if size < 10000:
                failures.append({**entry, "step": "download_size", "error": f"too small {size}B"})
                continue
            if exp and dur < exp * 0.5:
                failures.append({**entry, "step": "download_duration", "error": f"{dur:.2f}s < 50% of {exp}s"})
                continue
            args = [sys.executable, PIPE, wav, cat, aid,
                    os.path.join(OUTDIR, cat if cat != "ambience" else "ambience")]
            dur_arg = r.get("dur") or ""
            if dur_arg:
                args += ["--dur", dur_arg]
            if (r.get("loop") or "").strip().lower() in ("1", "true", "yes"):
                args += ["--loop"]
            if (r.get("no_loop") or "").strip().lower() in ("1", "true", "yes"):
                args += ["--no-loop"]
            ft = r.get("fade_tail") or ""
            if ft:
                args += ["--fade-tail", ft]
            p = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
            try:
                rep = json.loads(p.stdout)
            except Exception:
                failures.append({**entry, "step": "pipeline", "error": p.stderr[-1500:], "stdout": p.stdout[:500]})
                continue
            rep["download_bytes"] = size
            rep["download_duration_s"] = round(dur, 2)
            results.append(rep)
            if rep.get("status") != "ok":
                failures.append(rep)
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)
    payload = {"processed": len(results), "failures": failures, "assets": results}
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    if report_path:
        json.dump(payload, open(report_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
