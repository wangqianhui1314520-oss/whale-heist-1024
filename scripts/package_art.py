"""Package generated art and its offline viewer, without altering images."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json

ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT/'deliverables'


def main():
    OUTPUT.mkdir(exist_ok=True)
    files=[p for p in (ROOT/'assets').rglob('*') if p.is_file()
           and 'archived' not in p.relative_to(ROOT).parts
           and '__pycache__' not in p.parts]
    files.extend(ROOT/name for name in ('src/render/assets.mjs','scripts/verify-art.mjs',
        'scripts/build_art_catalog.py','scripts/package_art.py','docs/美术资产交付说明.md',
        'docs/美术资产复核报告.md'))
    files=sorted(set(files))
    for file in files:
        assert file.is_file(), file
    catalog=json.loads((ROOT/'assets/runtime-catalog.json').read_text(encoding='utf-8'))
    index={'project':'鲸鱼魔盗团','date':'2026-10-24','summary':catalog['summary'],
           'open_first':'assets/preview/index.html',
           'note':'28张生产PNG（含5张剧情关键帧）；概念图、参考JPG与浏览器预览截图另计。声音与真实实机投稿卡待游戏开发阶段完成。',
           'files':[{'path':p.relative_to(ROOT).as_posix(),'bytes':p.stat().st_size,
                     'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]}
    path=OUTPUT/'鲸鱼魔盗团-完整美术资产包.zip'
    with ZipFile(path,'w',ZIP_DEFLATED,compresslevel=6) as archive:
        for file in files:
            archive.write(file,file.relative_to(ROOT).as_posix())
        archive.writestr('bundle-index.json',json.dumps(index,ensure_ascii=False,indent=2)+'\n')
        archive.writestr('先看这里.txt','鲸鱼魔盗团 · 美术资产包\n\n解压后双击 assets/preview/index.html 查看素材。\n使用说明：assets/README.md\n运行取样坐标：assets/runtime-catalog.json\n原图、提示词和生成证据均在 assets/ 内。\n\n本包交付游戏美术与接入工具，预览场景不可游玩。\n')
    with ZipFile(path) as archive:
        assert archive.testzip() is None
        assert len(archive.namelist())==len(files)+2
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    (OUTPUT/(path.name+'.sha256')).write_text(digest+'  '+path.name+'\n',encoding='utf-8')
    print(json.dumps({'archive':str(path),'file_count':len(files)+2,'bytes':path.stat().st_size,
                      'sha256':digest,'zip_verified':True},ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
