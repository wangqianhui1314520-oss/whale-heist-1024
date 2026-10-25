"""Verify the actual deliverable ZIPs against the accepted build and source."""
from pathlib import Path
import hashlib
import json
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'deliverables'
DIST = ROOT / 'dist'
summary = json.loads((ROOT / 'output/qa-2026-10-25/summary.json').read_text(encoding='utf-8-sig'))
browser = json.loads((ROOT / 'output/final-acceptance/browser-report.json').read_text(encoding='utf-8-sig'))
assert summary['failed'] == 0 and summary['passed'] == summary['total'] >= 25
assert browser['failed'] == 0 and browser['passed'] == len(browser['checks']) >= 11 and not browser.get('fatal')

# Preserve the exact Node sorting/hash convention used by qa-browser.cjs.
script = r"""
const fs=require('fs'),path=require('path'),crypto=require('crypto'),root=process.argv[1];
const files=fs.readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).sort((a,b)=>path.join(a.parentPath,a.name).localeCompare(path.join(b.parentPath,b.name)));
const hash=crypto.createHash('sha256');
for(const entry of files){const f=path.join(entry.parentPath,entry.name);hash.update(path.relative(root,f).replaceAll('\\','/'));hash.update(fs.readFileSync(f));}
console.log(hash.digest('hex'));
"""
build_hash = subprocess.check_output(['node', '-e', script, str(DIST)], text=True).strip()
assert build_hash == browser['build']['sha256'], 'Build changed after browser acceptance'
for file in DIST.rglob('*'):
    if not file.is_file():
        continue
    relative = file.relative_to(DIST)
    source = ROOT / (relative.with_suffix('.mjs') if file.suffix == '.js' else relative)
    expected = source.read_bytes()
    if file.suffix in {'.js', '.html', '.css'}:
        expected = expected.decode('utf-8').replace('.mjs', '.js').encode('utf-8')
    assert file.read_bytes() == expected, f'Source/build drift: {relative}'

def digest_stream(stream):
    hasher = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        hasher.update(chunk)
    return hasher.hexdigest()

packages = json.loads((OUT / '交付包校验.json').read_text(encoding='utf-8'))
results = []
for package in packages:
    file = OUT / package['file']
    with file.open('rb') as stream:
        assert digest_stream(stream) == package['sha256'], f'ZIP checksum changed: {file.name}'
    is_web = '网页部署包' in file.name
    with zipfile.ZipFile(file) as archive:
        assert archive.testzip() is None, f'CRC failure: {file.name}'
        names = archive.namelist()
        assert len(names) == len(set(names)) == package['files']
        if is_web:
            assert set(names) == {p.relative_to(DIST).as_posix() for p in DIST.rglob('*') if p.is_file()}
        else:
            assert '鲸鱼魔盗团/scripts/qa-browser.cjs' in names
            assert '鲸鱼魔盗团/docs/最终暴力测试与视觉验收-2026-10-25.md' in names
        for name in names:
            relative = name if is_web else name.removeprefix('鲸鱼魔盗团/')
            expected = (DIST if is_web else ROOT) / relative
            assert expected.is_file(), f'Stale ZIP entry: {name}'
            with archive.open(name) as stream, expected.open('rb') as original:
                assert digest_stream(stream) == digest_stream(original), f'ZIP differs from current file: {name}'
    results.append({**package, 'crcVerified': True, 'currentContentsVerified': True})

result = {'status': 'passed', 'automatedChecks': summary['total'], 'browserChecks': browser['passed'],
          'acceptedBuildSHA256': build_hash, 'packages': results}
(OUT / '最终交付验收.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False, indent=2))
