"""Package local source and static web builds without altering any images."""
from pathlib import Path
import zipfile
import hashlib
import json

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'deliverables'
OUT.mkdir(exist_ok=True)
excluded={'.git','.openai','.sites-runtime','.sites-checkout','dist','deliverables','__pycache__'}
source_files=sorted([p for p in ROOT.rglob('*') if p.is_file() and not any(x in excluded for x in p.relative_to(ROOT).parts)
              and 'archive' not in p.relative_to(ROOT).parts and p.name!='world-trace.txt'])
packages=[('鲸鱼魔盗团-本地试玩与完整源码.zip',source_files,ROOT,True),
          ('鲸鱼魔盗团-网页部署包.zip',[p for p in (ROOT/'dist').rglob('*') if p.is_file()],ROOT/'dist',False)]
result=[]
for name,files,base,prefix in packages:
    destination=OUT/name
    pending=destination.with_suffix('.zip.tmp')
    with zipfile.ZipFile(pending,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for file in files:
            relative=file.relative_to(base).as_posix()
            archive.write(file,('鲸鱼魔盗团/' if prefix else '')+relative)
    with zipfile.ZipFile(pending) as archive:
        assert archive.testzip() is None
        if prefix:
            assert '鲸鱼魔盗团/启动游戏.ps1' in archive.namelist()
            assert '鲸鱼魔盗团/index.html' in archive.namelist()
        else: assert 'index.html' in archive.namelist()
    pending.replace(destination)
    digest=hashlib.sha256(destination.read_bytes()).hexdigest()
    destination.with_suffix('.zip.sha256').write_text(digest+'  '+name+'\n',encoding='utf-8')
    result.append({'file':name,'files':len(files),'bytes':destination.stat().st_size,'sha256':digest})
(OUT/'交付包校验.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
