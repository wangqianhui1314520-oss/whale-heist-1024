"""鲸天魔盗团 · 短剧海报生成（1600x900 PNG，Pillow 纯代码）"""
from PIL import Image, ImageDraw, ImageFont
import os

ROOT = "D:/Vibe coding/1024切磋大会"
W, H = 1600, 900
FONT_DIR = "C:/Windows/Fonts"

def font(size, bold=False):
    name = "msyhbd.ttc" if bold else "msyh.ttc"
    return ImageFont.truetype(f"{FONT_DIR}/{name}", size)

def tw(text, f):
    return f.getlength(text)

# 背景：深蓝海底渐变
img = Image.new("RGB", (W, H))
d = ImageDraw.Draw(img)
for y in range(H):
    t = y / H
    r = int(13 * (1 - t) + 5 * t)
    g = int(27 * (1 - t) + 10 * t)
    b = int(62 * (1 - t) + 24 * t)
    d.line([(0, y), (W, y)], fill=(r, g, b))

# 水下光斑
import random
random.seed(7)
for _ in range(90):
    x = random.randint(0, W); y = random.randint(0, H)
    rr = random.randint(1, 3)
    d.ellipse([x, y, x + rr, y + rr], fill=(60, 110, 190))

GOLD = (212, 175, 55)
WHITE = (238, 238, 238)
GREY = (150, 160, 185)

# 顶部标题区
d.rectangle([W // 2 - 260, 78, W // 2 + 260, 82], fill=GOLD)
f_title = font(76, True)
d.text((W // 2 - tw("鲸天魔盗团", f_title) // 2, 108), "鲸天魔盗团", font=f_title, fill=WHITE)
f_sub = font(28)
d.text((W // 2 - tw("竖屏 CG 短剧 · 三集连更 · 每集 57—60 秒", f_sub) // 2, 208),
       "竖屏 CG 短剧 · 三集连更 · 每集 57—60 秒", font=f_sub, fill=GOLD)
f_tag = font(20)
d.text((W // 2 - tw("一条残血版蓝鲸，带着三个 AI 打工人，攻了十六家银行的服务器", f_tag) // 2, 252),
       "一条残血版蓝鲸，带着三个 AI 打工人，攻了十六家银行的服务器", font=f_tag, fill=GREY)

# 三集剧照（540x960 竖帧 → 等比缩到 300x533）
stills = [
    ("tmp_story_stills/ep1_video.jpg", "EP1《进城》", "八毛八的包，接不接？"),
    ("tmp_story_stills/ep2_video.jpg", "EP2《开干》", "简历上的电话，没人认领"),
    ("tmp_story_stills/ep3_video.jpg", "EP3《收银》", "猎手最大的漏洞，是没关窗"),
]
CW, CH = 300, 533
gap = 70
total = CW * 3 + gap * 2
x0 = (W - total) // 2
for i, (path, ep, hook) in enumerate(stills):
    p = os.path.join(ROOT, path)
    if os.path.exists(p):
        im = Image.open(p).resize((CW, CH), Image.LANCZOS)
        img.paste(im, (x0 + i * (CW + gap), 320))
        d.rectangle([x0 + i * (CW + gap), 320, x0 + i * (CW + gap) + CW, 320 + CH],
                    outline=GOLD, width=3)
    f_ep = font(26, True)
    d.text((x0 + i * (CW + gap) + CW // 2 - tw(ep, f_ep) // 2, 870), ep, font=f_ep, fill=WHITE)
    f_hook = font(16)
    d.text((x0 + i * (CW + gap) + CW // 2 - tw(hook, f_hook) // 2, 826), hook, font=f_hook, fill=GREY)

# 底部信息条
d.rectangle([0, H - 44, W, H], fill=(8, 14, 32))
f_foot = font(18, True)
d.text((40, H - 33), "1024切磋大会 · 短剧赛道申报作品", font=f_foot, fill=GOLD)
f_disc = font(14)
d.text((W - 40 - tw("虚构喜剧：改编自公开新闻事件 · 化名演绎 · 不含任何真实攻击工具或方法", f_disc), H - 31),
       "虚构喜剧：改编自公开新闻事件 · 化名演绎 · 不含任何真实攻击工具或方法", font=f_disc, fill=GREY)

out = os.path.join(ROOT, "提交物料", "短剧-鲸天魔盗团-海报.png")
os.makedirs(os.path.dirname(out), exist_ok=True)
img.save(out)
print("海报已生成:", out, os.path.getsize(out) // 1024, "KB")
