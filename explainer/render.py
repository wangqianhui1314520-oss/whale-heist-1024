"""《鲸鱼魔盗团》讲解视频渲染:逐镜出图 -> edge-tts 配音 -> ffmpeg 合成。
用法(沙箱):
  /tmp/venv_tts/bin/python -I render.py --out /path/to/out [--only title,play] [--no-tts]
"""
import argparse
import asyncio
import hashlib
import json
import math
import os
import subprocess
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw, ImageFilter, ImageFont  # noqa: E402

import storyboard as sb  # noqa: E402

W, H = 1920, 1080
NOTO_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
NOTO_REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
SC = 2  # Noto Sans CJK SC 在 ttc 里的索引
GOLD = (236, 200, 120)
CYAN = (110, 220, 255)
FPS = 25
# 所有分段用同一套编码参数,最后才能无损拼接(concat -c copy)
ENC = ["-pix_fmt", "yuv420p", "-r", str(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", "50"]


def fw(text):
    """显示用:中文语境下把半角标点换成全角(配音文本不受影响)。"""
    return text.translate(str.maketrans({",": "，", ":": "：", "(": "（", ")": "）"}))


def font(size, bold=True):
    return ImageFont.truetype(NOTO_BOLD if bold else NOTO_REG, size, index=SC)


def run(cmd):
    r = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if r.returncode:
        raise RuntimeError(r.stderr.decode(errors="replace")[-600:])


def probe(path):
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", path]).decode().strip()
    return float(out)


def load_img(key):
    path, crop_top, note = sb.IMG[key]
    im = Image.open(path).convert("RGB")
    if crop_top:
        im = im.crop((0, crop_top, im.width, im.height))
    return im, note


def blurred_bg(im):
    bg = im.resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(28))
    dark = Image.new("RGB", (W, H), (4, 12, 28))
    return Image.blend(bg, dark, 0.55)


def wrap_cjk(draw, text, fnt, max_w):
    lines, cur = [], ""
    for ch in text:
        if draw.textlength(cur + ch, font=fnt) > max_w and cur:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


def draw_label(d, x, y, text, fnt):
    pad = 8
    w = d.textlength(text, font=fnt)
    d.rounded_rectangle((x, y, x + w + pad * 2, y + fnt.size + pad), 6, fill=(8, 20, 40, 235),
                        outline=GOLD, width=2)
    d.text((x + pad, y + pad // 2 - 1), text, font=fnt, fill=GOLD)
    return w + pad * 2


def render_shot(shot, out_png, im=None, note=None, badge=None):
    """返回截图区域 (ox, oy, sw, sh),供视频片段叠加定位。"""
    if im is None:
        im, note = load_img(shot.img)
    canvas = blurred_bg(im).convert("RGBA")

    # 截图区域:上方留标题条,下方留字幕条
    top, bottom = 84, 214
    area_w, area_h = W - 120, H - top - bottom
    scale = min(area_w / im.width, area_h / im.height)
    sw, sh = int(im.width * scale), int(im.height * scale)
    shot_im = im.resize((sw, sh), Image.LANCZOS).convert("RGBA")
    ox, oy = (W - sw) // 2, top + (area_h - sh) // 2

    d = ImageDraw.Draw(canvas, "RGBA")
    d.rounded_rectangle((ox - 6, oy - 6, ox + sw + 6, oy + sh + 6), 10, fill=(236, 200, 120, 255))
    canvas.alpha_composite(shot_im, (ox, oy))

    # 高亮框 + 角标
    lab = font(24)
    for i, box in enumerate(shot.boxes):
        x0, y0, x1, y1 = box.r
        rx0, ry0 = ox + int(x0 * sw), oy + int(y0 * sh)
        rx1, ry1 = ox + int(x1 * sw), oy + int(y1 * sh)
        d.rounded_rectangle((rx0, ry0, rx1, ry1), 8, outline=CYAN, width=4)
        if box.label:
            text = f"{i + 1} {fw(box.label)}"
            tw = d.textlength(text, font=lab) + 16
            if box.pos == "right":
                lx, ly = rx1 + 10, (ry0 + ry1) // 2 - (lab.size + 8) // 2
            elif box.pos == "left":
                lx, ly = rx0 - int(tw) - 10, (ry0 + ry1) // 2 - (lab.size + 8) // 2
            elif box.pos == "below":
                lx, ly = rx0, ry1 + 6
            else:
                lx = min(max(rx0, ox), ox + sw - int(tw))
                ly = ry0 - lab.size - 14
                if ly < oy + 2:
                    ly = ry1 + 6
            lx = min(lx, ox + sw - int(tw) - 4)
            draw_label(d, lx, ly, text, lab)

    # 顶部标题条
    d.rectangle((0, 0, W, top), fill=(4, 12, 28, 255))
    d.text((60, 16), fw(shot.tag), font=font(40), fill=(255, 255, 255))
    brand_w = d.textlength("鲸鱼魔盗团 · 游戏讲解", font=font(26))
    d.text((W - 60 - brand_w, 28), "鲸鱼魔盗团 · 游戏讲解", font=font(26), fill=CYAN)
    if badge:
        bf = font(24)
        draw_label(d, int(W - 60 - brand_w - 40 - d.textlength(badge, font=bf) - 16), 22, badge, bf)
    if note:
        nf = font(24, bold=False)
        d.text((ox + sw - d.textlength(note, font=nf) - 14, oy + sh - 40), note, font=nf,
               fill=(255, 220, 140))

    # 底部字幕
    d.rectangle((0, H - bottom, W, H), fill=(4, 12, 28, 255))
    sub = font(40)
    line = fw(shot.line)
    lines = wrap_cjk(d, line, sub, W - 160)
    if len(lines) > 3:
        sub = font(34)
        lines = wrap_cjk(d, line, sub, W - 160)
    y = H - bottom + 24
    for ln in lines[:4]:
        d.text((80, y), ln, font=sub, fill=(255, 255, 255))
        y += sub.size + 12

    canvas.convert("RGB").save(out_png)
    return ox, oy, sw, sh


async def _tts(text, out):
    import edge_tts
    last = None
    for _ in range(4):
        try:
            await edge_tts.Communicate(text, sb.VOICE, rate=sb.RATE).save(out)
            if os.path.getsize(out) > 1024:
                return
        except Exception as e:  # noqa: BLE001
            last = e
            await asyncio.sleep(0.6)
    raise RuntimeError(f"TTS failed: {last}")


def make_silence(sec, out):
    run(["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=24000",
         "-t", f"{sec:.3f}", "-c:a", "libmp3lame", "-q:a", "4", out])


def frames_of(sec):
    """秒 -> 整数帧;音频和视频都按这个帧数裁,拼接后不会逐段累积偏差。"""
    return max(1, round(sec * FPS))


def unit_audio(raw, nframes, out):
    """配音补静音/截断到恰好 nframes 帧的时长。"""
    run(["ffmpeg", "-y", "-i", raw, "-af", "apad", "-t", f"{nframes / FPS:.4f}",
         "-ar", "24000", "-ac", "1", "-c:a", "aac", "-b:a", "128k", out])


def still_unit(png, nframes, out):
    run(["ffmpeg", "-y", "-loop", "1", "-framerate", str(FPS), "-i", png, "-frames:v", str(nframes), *ENC, out])


# 无头 Chromium 录屏比脚本里的操作时间晚约 0.78s(对 command 片段做逐帧差分实测:
# 5 次操作的画面变化分别滞后 0.71/0.80/0.74/0.81/0.78s)。换算时间点时补上这个延迟。
REC_LAG = 0.78


def resolve_mark(meta, ref, clip_len):
    name, off = ref
    if name == "END":
        return max(0.0, clip_len + off)
    return max(0.0, meta["marks"][name] + REC_LAG + off)


def load_meta(clips_dir, clip):
    path = os.path.join(clips_dir, clip, "meta.json")
    meta = json.load(open(path, encoding="utf-8"))
    if not meta["ok"] or meta["errors"]:
        raise RuntimeError(f"录屏片段 {clip} 不可用: ok={meta['ok']} errors={meta['errors']}")
    meta["webm"] = os.path.join(clips_dir, clip, clip + ".webm")
    meta["len"] = probe_stream(meta["webm"])
    return meta


def probe_stream(path):
    """webm 容器没有总时长,用解码出的帧数 / 25fps。"""
    out = subprocess.check_output(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
                                   "-show_entries", "stream=nb_read_frames", "-of", "default=nw=1:nk=1", path])
    return int(out.strip()) / FPS


def fill_facts(text, facts):
    """把 {tb}/{ta} 换成录屏时读到的 AI Token;缺读数就报错,不编数字。"""
    if "{" not in text:
        return text
    need = {"tb": "tokensBefore", "ta": "tokensAfter"}
    vals = {}
    for k, key in need.items():
        if "{" + k + "}" in text:
            if key not in facts:
                raise RuntimeError(f"文案需要 {key},但录屏没有记录")
            vals[k] = facts[key]
    def cnum(n):
        if not isinstance(n, int) or not 0 <= n <= 12:
            raise RuntimeError(f"AI Token 读数 {n!r} 超出 0-12,请检查录屏")
        return {10: "十", 11: "十一", 12: "十二"}.get(n) or "零一二三四五六七八九"[n]
    return text.format(**{k: cnum(v) for k, v in vals.items()})


def clip_units(shot, n, work, clips_dir, no_tts):
    """录屏镜头 -> 若干 (视频段, 音频段, 说明)。每段 = 一句配音 + 对应的真实录屏。"""
    meta = load_meta(clips_dir, shot.clip)
    trim = meta["trimStartSec"]
    units = []
    # 画框:用第一帧占位图算出屏幕区域,录屏缩放进去
    fake = Image.new("RGB", (1280, 720), (0, 0, 0))
    frame_png = os.path.join(work, f"{n:02d}_{shot.id}_frame.png")
    ox, oy, sw, sh = render_shot(SimpleNamespace(boxes=(), tag=shot.tag, line=" "), frame_png, im=fake,
                                 badge="实机录屏")
    for i, seg in enumerate(shot.segs):
        text = fill_facts(seg.text, meta["facts"])
        # marks 与 webm 同一时间轴(从页面创建算起);END = 录屏末尾;再减 trim 得到"可用片段内"的时间
        a = resolve_mark(meta, seg.a, meta["len"]) - trim
        b = resolve_mark(meta, seg.b, meta["len"]) - trim
        a = max(0.0, a)
        tag = f"{n:02d}_{shot.id}_{i}"
        raw = os.path.join(work, tag + "_raw.mp3")
        if no_tts:
            speech = 3.0
            make_silence(speech, raw)
        else:
            asyncio.run(_tts(text, raw))
            speech = probe(raw)
        if seg.cut:      # 界面静止:配音讲完就切,录屏取窗口起点开始
            dur = speech + 0.5
            if a + dur > b + 0.1:   # 窗口会把下一步操作提前拍进来,配音和画面就对不上了
                raise RuntimeError(f"{tag}: 配音+留白 {dur:.1f}s 超过两次操作间隔 {b - a:.1f}s,请加长录屏等待")
            b = a + dur
        else:            # 动作画面:跟着录屏走,配音放在开头;窗口比配音短就报错,不拖慢画面
            dur = max(b - a, 0.5)
            if speech > dur + 0.3:
                raise RuntimeError(f"{tag}: 配音 {speech:.1f}s 超过动作窗口 {dur:.1f}s,请加长录屏或缩短文案")
        if a + dur > meta["len"] - trim + 0.05:
            raise RuntimeError(f"{tag}: 需要录屏 {a:.1f}~{a + dur:.1f}s,但可用到 {meta['len'] - trim:.1f}s")
        nfr = frames_of(dur)
        sub_png = os.path.join(work, tag + "_sub.png")
        render_shot(SimpleNamespace(boxes=(), tag=shot.tag, line=text), sub_png, im=fake, badge="实机录屏")
        v = os.path.join(work, tag + "_v.mp4")
        # 录屏缩放进画框(底图含字幕条),覆盖在 (ox,oy)
        run(["ffmpeg", "-y", "-loop", "1", "-framerate", str(FPS), "-i", sub_png,
             "-ss", f"{trim + a:.3f}", "-i", meta["webm"],
             "-filter_complex", f"[1:v]fps={FPS},scale={sw}:{sh}[g];[0:v][g]overlay={ox}:{oy}:shortest=1",
             "-frames:v", str(nfr), *ENC, v])
        au = os.path.join(work, tag + ".m4a")
        unit_audio(raw, nfr, au)
        units.append((v, au, f"{tag} {dur:.1f}s  录屏 {a:.1f}~{a + dur:.1f}s"))
    return units


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="")
    ap.add_argument("--no-tts", action="store_true")
    ap.add_argument("--clips", default="", help="record.cjs 的输出目录(含 move/command/cancel 子目录)")
    args = ap.parse_args()

    work = os.path.join(args.out, "work")
    os.makedirs(work, exist_ok=True)
    only = {s for s in args.only.split(",") if s}
    shots = [s for s in sb.SHOTS if not only or s.id in only]
    if any(isinstance(s, sb.ClipShot) for s in shots) and not args.clips:
        sys.exit("分镜含录屏镜头,请用 --clips 指定 record.cjs 的输出目录")

    units = []          # (视频段, 音频段, 说明)
    for n, shot in enumerate(shots, 1):
        if isinstance(shot, sb.ClipShot):
            new = clip_units(shot, n, work, args.clips, args.no_tts)
            units += new
            for _, _, info in new:
                print(f"[{n:02d}/{len(shots)}] 录屏 {info}")
            continue
        png = os.path.join(work, f"{n:02d}_{shot.id}.png")
        render_shot(shot, png)
        raw = os.path.join(work, f"{n:02d}_{shot.id}_raw.mp3")
        if args.no_tts:
            speech = 3.3
            make_silence(speech, raw)
        else:
            asyncio.run(_tts(shot.say or shot.line, raw))
            speech = probe(raw)
        nfr = frames_of(speech + 0.7)      # 句尾留白
        v = os.path.join(work, f"{n:02d}_{shot.id}_v.mp4")
        a = os.path.join(work, f"{n:02d}_{shot.id}.m4a")
        still_unit(png, nfr, v)
        unit_audio(raw, nfr, a)
        units.append((v, a, ""))
        print(f"[{n:02d}/{len(shots)}] {shot.id:9s} {nfr / FPS:5.1f}s")

    # 先各自拼接视频流和音频流,再一次性混流;所有单元按整数帧对齐,不会累积漂移
    vtxt, atxt = os.path.join(work, "v.txt"), os.path.join(work, "a.txt")
    for path, idx in ((vtxt, 0), (atxt, 1)):
        with open(path, "w", encoding="utf-8") as f:
            for u in units:
                f.write(f"file '{u[idx]}'\n")
    video, audio = os.path.join(work, "video.mp4"), os.path.join(work, "audio.m4a")
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", vtxt, "-c", "copy", video])
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", atxt, "-c", "copy", audio])
    final = os.path.join(args.out, "鲸鱼魔盗团-游戏讲解.mp4")
    run(["ffmpeg", "-y", "-i", video, "-i", audio, "-c", "copy", "-movflags", "+faststart", final])
    dv, da = probe_stream(final), probe(final)
    print(f"完成 {final}  视频 {dv:.1f}s  容器 {da:.1f}s")


if __name__ == "__main__":
    main()
