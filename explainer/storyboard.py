"""《鲸鱼魔盗团》讲解视频分镜。
boxes 使用 0-1 比例坐标(相对裁切后的原图);mode: frame=截图加边框, full=整幅铺满。"""
import os
from collections import namedtuple

ROOT = os.environ.get(
    "WHALE_ROOT",
    "/sessions/eloquent-vibrant-archimedes/mnt/1024切磋大会/游戏-鲸鱼魔盗团")
RAS = os.path.join(ROOT, "output", "screenshots", "raster-release-2026-10-25")
OLD = os.path.join(ROOT, "output", "screenshots")
SUB = os.path.join(ROOT, "assets", "submission")
VOICE = "zh-CN-XiaoxiaoNeural"
RATE = "+6%"
FIXTURE_NOTE = "界面示例 · 构造数据 · 非实际通关"

# key -> (路径, 顶部裁掉的像素, 右上角备注)
IMG = {
    "cover": (os.path.join(SUB, "鲸鱼魔盗团-游戏封面-v1-1600x1200.png"), 0, None),
    "title": (os.path.join(RAS, "desktop-title.png"), 0, None),
    "story": (os.path.join(RAS, "desktop-story-cinematic.png"), 0, None),
    "help": (os.path.join(RAS, "desktop-help.png"), 0, None),
    "play": (os.path.join(RAS, "desktop-gameplay.png"), 0, None),
    "cmd": (os.path.join(RAS, "desktop-command.png"), 0, None),
    "chapters": (os.path.join(RAS, "desktop-chapters.png"), 0, None),
    "ch4": (os.path.join(OLD, "chapter-4.png"), 0, None),
    "ch5": (os.path.join(OLD, "chapter-5.png"), 0, None),
    "analysis": (os.path.join(RAS, "analysis-fixture.png"), 48, FIXTURE_NOTE),
    "result": (os.path.join(RAS, "campaign-result-fixture.png"), 48, FIXTURE_NOTE),
    "mobile": (os.path.join(RAS, "mobile-touch.png"), 0, "浏览器横屏模拟"),
    "hero": (os.path.join(SUB, "deepseek-hero-card.png"), 0, None),
}

Box = namedtuple("Box", "r label pos")
Shot = namedtuple("Shot", "id img tag line boxes say")


def B(x0, y0, x1, y1, label="", pos="above"):
    """相对坐标框 (0-1),label 为角标文字;pos: above / below / right。"""
    return Box((x0, y0, x1, y1), label, pos)


def S(id, img, tag, line, boxes=(), say=None):
    """line=屏幕字幕;say=配音文本(缺省与字幕相同)。"""
    return Shot(id, img, tag, line, tuple(boxes), say)


IMG["ch2"] = (os.path.join(OLD, "chapter-2.png"), 0, None)

# 实机录屏镜头:segs 里每段 = 一句配音 + 录屏里的时间窗口。
# a/b 是 (标记名, 偏移秒);标记由 record.cjs 在真实操作时写入,"END" 表示片段末尾。
# cut=True:界面静止,配音结束即切走;cut=False:连续播放到 b(动作画面)。
ClipShot = namedtuple("ClipShot", "id clip tag segs")
Seg = namedtuple("Seg", "text a b cut")

SHOTS = [
    S("cover", "cover", "鲸鱼魔盗团 · 游戏讲解",
      "《鲸鱼魔盗团》是一款横版小队动作加机关协作的网页游戏。"
      "你操控 DeepSeek,带着 Grok、Claude、GLM 完成五章行动。"),
    S("title", "title", "01 · 开始游戏",
      "主菜单在水下神殿的鲸艇上。有存档会直接继续行动,左下角是小队状态,下方有航图、设置和档案入口。",
      [B(.129, .556, .43, .632, "继续行动"), B(.055, .854, .426, .951, "小队状态"),
       B(.215, .76, .36, .84, "航图 / 设置 / 档案")]),
    S("story", "story", "02 · 剧情演出",
      "每一章开始都有一小段剧情演出,交代这一章要做什么。演出可以跳过,看过的剧情也能在档案里回放。",
      [B(.072, .65, .926, .924, "对话与提示")]),
    S("help", "help", "03 · 操作方式",
      "移动用 A 和 D,W 和 S 爬梯,空格跳跃,Shift 冲刺,E 互动。数字键 1、2、3 选择队友。"
      "手机横屏有触控按钮。",
      [B(.16, .34, .457, .736, "键盘操作"), B(.484, .29, .703, .583, "三条核心规则")]),
    S("play", "play", "04 · 关卡画面",
      "关卡是固定镜头的横版场景。顶部看章节、计时、生命和资源,底部是小队头像和三格背包。"
      "走到可交互的地方,会出现提示。",
      [B(.0, .0, .99, .085, "章节 · 计时 · 生命 · 资源"),
       B(.336, .84, .664, .958, "小队与背包"), B(.431, .65, .569, .733, "互动提示")]),
    ClipShot("move", "move", "05 · 实机演示：移动、跳跃、冲刺", [
        Seg("A 和 D 控制左右移动。", ("right", -0.4), ("jump", -0.1), False),
        Seg("空格跳跃，Shift 冲刺。", ("jump", -0.1), ("dash", 1.8), False),
    ]),
    ClipShot("cmd", "command", "06 · 实机演示：给队友下指令", [
        Seg("核心玩法是给队友下指令。先点队友，再看方案。", ("select", -0.4), ("forecast", 0), True),
        Seg("整片开路是默认方案，消耗一点 AI Token，不用限定词。", ("forecast", 0), ("precise", 0), True),
        Seg("只开此处是精确方案，要一枚限定词，外加两点 AI Token。", ("precise", 0), ("default", 0), True),
        Seg("这次选默认方案，确认执行。", ("default", 0), ("confirm", 0), True),
        # {tb}/{ta} 由 render.py 用录屏时读到的 AI Token 数填入,读数对不上会直接报错
        Seg("Grok 出发，节点被打开。AI Token 从{tb}点变成{ta}点。", ("confirm", 0), ("END", 0), False),
    ]),
    ClipShot("cancel", "cancel", "07 · 实机演示：不满意可以取消", [
        Seg("打开 Claude 的指令面板，看过之后不想执行，可以直接取消。", ("select", -0.4), ("cancel", 0), True),
        Seg("取消以后，AI Token 没有变化，还是{tb}点。", ("cancel", 0), ("END", 0), False),
    ]),
    S("ch2", "ch2", "08 · 三名队友",
      "三名队友各有分工。Grok 负责破障,从第一章就在队里。Claude 放诱饵引开守卫,第二章加入。"
      "GLM 负责扫描陷阱和警戒器,第三章加入。",
      [B(.345, .80, .555, .955, "Grok 破障 · Claude 诱饵 · GLM 扫描", "right")]),
    S("chapters", "chapters", "09 · 五章流程",
      "一共五章:纸窗入港、简历风波、复查勿扰、战报公开、闭舱返航。每章都要搬回资料,"
      "再带着队友回到鲸艇交付。完成前一章才会解锁下一章。",
      [B(.086, .25, .353, .44, "纸窗入港"), B(.365, .25, .632, .44, "简历风波"),
       B(.643, .25, .91, .44, "复查勿扰 · 未解锁"),
       B(.087, .547, .353, .82, "战报公开 · 未解锁", "below"),
       B(.365, .547, .632, .82, "闭舱返航 · 未解锁", "below")]),
    S("ch4", "ch4", "10 · 第四章:战报公开",
      "第四章有一个反转:你之前下过的指令,会被公开广播出去。要先关广播,再取回任务物、设置返航信标。"
      "关掉广播只能停止新记录,旧的不会消失。",
      [B(.84, .115, .985, .27, "本章任务"), B(.15, .70, .22, .84, "广播开关")]),
    S("ch5", "ch5", "11 · 第五章:闭舱返航",
      "最后一章是撤离。三名队友在远端信标集齐,带够三块数据,由你确认后,六十秒倒计时才开始。",
      [B(.83, .115, .985, .31, "本章任务"), B(.80, .30, .895, .37, "远端数据", "left")]),
    S("analysis", "analysis", "12 · 线索分析",
      "这是线索分析界面的示例。过关途中收集到的线索,可以花分析 Token 做离线分析,还能采用修复建议。"
      "这一切都在虚构场景里完成,不会连接任何真实服务器。",
      [B(.2, .28, .33, .345, "分析 Token", "right"), B(.715, .54, .785, .60, "分析摘要")]),
    S("result", "result", "13 · 结算评分",
      "这是结算界面的示例,数据为构造,不是真实通关记录。五章通关后会给出总评分,满分五百,"
      "并统计完成章节、历史暴露和调查记录。",
      [B(.18, .31, .47, .47, "总评分"), B(.17, .55, .83, .65, "章节统计")]),
    S("mobile", "mobile", "14 · 手机也能玩",
      "手机请横屏游玩,左边是方向键,右边是互动、跳跃和冲刺按钮。竖屏时游戏会自动暂停。",
      [B(.108, .637, .257, .966, "方向键"), B(.684, .83, .887, .966, "互动 · 跳跃 · 冲刺")]),
    S("end", "cover", "鲸鱼魔盗团",
      "把话说清楚,把队友一个不少地带回来。现在就来试试《鲸鱼魔盗团》吧。"),
]
