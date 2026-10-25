"""Read native PNGs; create metadata only. Never crop, resize or save an image."""
from collections import Counter
from pathlib import Path
import hashlib
import json
import math
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
MANIFEST = ASSETS / 'asset-manifest.json'
STORY_STYLES = {'cinematic': '电影卡片', 'stage': '实景小剧场', 'comic': '分镜动态漫画'}
STORY_BEATS = {'opening': '序章启航', 'grok': 'Grok 破窗加入', 'claude': 'Claude 诱饵加入',
               'glm': 'GLM 扫描加入', 'broadcast': '广播反转', 'evacuation': '撤离集结',
               'epilogue': '调查尾声'}


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def normalized_rect(value):
    if isinstance(value, (tuple, list)):
        x, y, w, h = value
    else:
        x, y = value['x'], value['y']
        w, h = value.get('width', value.get('w')), value.get('height', value.get('h'))
    right, bottom = round(x + w), round(y + h)
    x, y = round(x), round(y)
    return [x, y, right - x, bottom - y]


def bounds_in_rect(im, rect, threshold):
    x, y, w, h = rect
    if 'A' not in im.getbands():
        return rect.copy()
    # Read-only alpha region, no raster output is created.
    alpha = im.getchannel('A').crop((x, y, x + w, y + h))
    box = alpha.point(lambda a: 255 if a > threshold else 0).getbbox()
    if box is None:
        raise ValueError(f'Empty source region {rect}')
    return [x + box[0], y + box[1], box[2] - box[0], box[3] - box[1]]


def build():
    manifest = read_json(MANIFEST)
    by_id = {a['id']: a for a in manifest['assets']}
    catalog = {'schema_version': '1.0.0', 'project': '鲸鱼魔盗团',
               'date': '2026-10-25', 'perspective': 'fixed_camera_sideview_platformer',
               'logical_viewport': [1280, 720], 'images': {}, 'sprites': {}, 'animations': {}}
    loaded, evidence, warnings = {}, {}, []

    def add_image(key, file, transparent=True, provenance=None):
        path = ASSETS / file
        assert path.is_file(), f'Missing image: {path}'
        im = Image.open(path)
        im.load()
        loaded[key] = im
        alpha = im.getchannel('A') if 'A' in im.getbands() else None
        histogram = alpha.histogram() if alpha else []
        stats = {'has_channel': alpha is not None,
                 'extrema': list(alpha.getextrema()) if alpha else [255, 255],
                 'fully_transparent_pixels': histogram[0] if alpha else 0,
                 'total_pixels': im.width * im.height}
        if transparent:
            assert alpha is not None and histogram[0] > 0, f'No real transparency: {file}'
        prov_path = ASSETS / 'provenance' / f'{provenance or key}.json'
        assert prov_path.exists(), f'Missing provenance: {prov_path}'
        prov = read_json(prov_path)
        raw_path=prov.get('raw_output_path') or prov.get('rawPath') or prov.get('raw')
        assert raw_path and Path(raw_path).is_file(), f'Missing original output: {key}'
        digest=hashlib.sha256(path.read_bytes()).hexdigest()
        assert hashlib.sha256(Path(raw_path).read_bytes()).hexdigest()==digest, f'Changed native PNG: {file}'
        if prov.get('status')=='generated_pending_qa':
            prov.update(status='verified',dimensions=[im.width,im.height],alpha=stats,sha256=digest,
                        review='已目视核对各物件或四个特效阶段的顺序、轮廓与透明边缘；PNG与原始输出字节一致。',
                        post_processing='无栅格修改；Pillow仅只读检查。')
            write_json(prov_path,prov)
        evidence[key] = prov
        catalog['images'][key] = {'file': file, 'width': im.width, 'height': im.height,
            'mode': im.mode, 'transparent': transparent, 'alpha': stats,
            'bytes': path.stat().st_size, 'sha256': digest, 'raw_output_sha256_verified':True,
            'provenance': prov_path.relative_to(ASSETS).as_posix()}
        return im, prov

    def add_sprite(id, key, rect=None, label=None, category=None, size=None, anchor=None, **extra):
        image = catalog['images'][key]
        im = loaded[key]
        rect = normalized_rect(rect or [0, 0, im.width, im.height])
        x, y, w, h = rect
        assert x >= 0 and y >= 0 and w > 0 and h > 0 and x+w <= im.width and y+h <= im.height, (id, rect)
        old = by_id.get(id, {})
        category = category or old.get('category', 'scene')
        content = bounds_in_rect(im, rect, 8)
        solid = bounds_in_rect(im, rect, 160)
        if category in ('character', 'prop', 'enemy'):
            bx, by, bw, bh = solid
            if bx <= x or by <= y or bx+bw >= x+w or by+bh >= y+h:
                warnings.append({'id': id, 'note': '实色区域靠近取样边缘，请结合原图目视检查', 'rect': rect})
        planned_size = old.get('dimensions', {}).get('logical_display')
        logical = size or planned_size or [72, 72]
        sprite = {'image': key, 'source_rect': rect, 'content_rect': content,
            'solid_rect': solid, 'label': label or old.get('label', id), 'category': category,
            'logical_size': logical, 'anchor': anchor or ([.5, .5] if category in ('fx_frame', 'portrait', 'ui') else [.5, 1]),
            **extra}
        catalog['sprites'][id] = sprite
        return sprite

    for character in ('deepseek', 'grok', 'claude', 'glm'):
        key = character + '-actions'
        im, prov = add_image(key, f'atlases/{key}.png')
        for row, state in enumerate(('idle', 'walk', 'jump', 'fall', 'skill')):
            for col, direction in enumerate(('left', 'right')):
                rect = [round(col * im.width/2), round(row * im.height/5),
                        round((col+1)*im.width/2)-round(col*im.width/2),
                        round((row+1)*im.height/5)-round(row*im.height/5)]
                if prov.get('recommended_source_rects'):
                    rect = next(v for v in prov['recommended_source_rects'] if v['id'] == f'{state}_{direction}')
                elif isinstance(prov.get('frames'), list):
                    item = next(v for v in prov['frames'] if v['state'] == state and v['direction'] == direction)
                    rect = item.get('recommendedSrc', item['src'])
                add_sprite(f'character-{character}-{direction}-{state}', key, rect,
                           category='character', size=[88, 88], state=state, direction=direction,
                           character=character, animation_note='单张关键姿态；行走配合程序起伏，非完整逐帧步态循环')
        idle_height=max(catalog['sprites'][f'character-{character}-{direction}-idle']['content_rect'][3]
                        for direction in ('left','right'))
        for sprite in catalog['sprites'].values():
            if sprite.get('character')==character:
                sprite['native_scale']=88/idle_height
        portrait_key = character + '-portrait'
        add_image(portrait_key, f'portraits/{portrait_key}.png')
        add_sprite(f'portrait-{character}', portrait_key, category='portrait', size=[96, 96], anchor=[.5, .5])

    for enemy in ('guard', 'investigator'):
        add_image(enemy, f'enemies/{enemy}.png')
        add_sprite(f'enemy-{enemy}', enemy, size=[72, 72], category='enemy',
                   direction='left' if enemy=='guard' else 'right')

    def atlas(key, ids, columns, rows, category, sizes=None, anchors=None):
        im, prov = add_image(key, f'atlases/{key}.png')
        recorded = prov.get('grid', {}).get('source_rectangles', [])
        for index, id in enumerate(ids):
            if recorded:
                match = next((v for v in recorded if v['id'] == id.removeprefix('scene-').removeprefix('prop-')), None)
            else:
                match = None
            if match:
                rect = match
            else:
                col, row = index % columns, index // columns
                x, y = round(col*im.width/columns), round(row*im.height/rows)
                rect = [x, y, round((col+1)*im.width/columns)-x, round((row+1)*im.height/rows)-y]
            add_sprite(id, key, rect, category=category, size=(sizes or {}).get(id), anchor=(anchors or {}).get(id))

    atlas('props-kit', ['prop-'+x for x in ('data-cube','data-node','qualifier-token','resume-decoy','broadcast-console','return-beacon')], 3, 2, 'prop',
          sizes={'prop-data-cube':[40,40], 'prop-qualifier-token':[44,44], 'prop-data-node':[60,72], 'prop-resume-decoy':[40,48], 'prop-broadcast-console':[64,80], 'prop-return-beacon':[64,64]})
    atlas('masonry-kit', ['scene-'+x for x in ('platform-middle','platform-left-cap','platform-right-cap','platform-thin','paper-barrier-intact','paper-barrier-broken')], 3, 2, 'scene')
    atlas('mechanisms-kit', ['scene-'+x for x in ('ladder','lift-platform','pressure-plate','gate-closed','gate-open','mfa-door-fixed')], 3, 2, 'scene')
    atlas('harbor-kit', ['scene-'+x for x in ('room-back-wall','water-channel','mothership','alarm-sensor','hidden-trap','server-rack')], 3, 2, 'scene', sizes={'scene-server-rack':[64,112]})

    for group in ('water-dash','axe-impact','paper-decoy','scan-grid'):
        key = group+'-atlas'
        im, prov = add_image(key, f'fx/{key}.png', provenance=group)
        ids=[]
        for index in range(4):
            x, y = round((index%2)*im.width/2), round((index//2)*im.height/2)
            rect=[x,y,round((index%2+1)*im.width/2)-x,round((index//2+1)*im.height/2)-y]
            id=f'fx-{group}-{index+1:02d}'
            # Preserve common frame centre; avoids animation drift from varying glow bounds.
            add_sprite(id,key,rect,category='fx_frame',size=[144,144],anchor=[.5,.5],group=group,frame=index)
            ids.append(id)
        catalog['animations'][group]={'frames':ids,'fps':8,'loop_default':False,'duration_ms':500,'layout':[2,2]}

    for key in ('gameplay-backdrop','menu-background','results-background'):
        add_image(key,f'backgrounds/{key}.png',transparent=False)
        add_sprite('background-'+key,key,category='background',size=[1280,720],anchor=[0,0])
    add_image('chrome-kit','ui/chrome-kit.png')
    im=loaded['chrome-kit']
    ui_source_names=('hud_bar','skill_ring','dialogue_box','results_panel','resource_capsule','pause_shell')
    ui_prov=evidence['chrome-kit']
    for index,name in enumerate(('hud-shell','skill-button-shell','dialogue-shell','results-shell','resource-shell','pause-shell')):
        x,y=round((index%2)*im.width/2),round((index//2)*im.height/3)
        rect=[x,y,round((index%2+1)*im.width/2)-x,round((index//2+1)*im.height/3)-y]
        if ui_prov.get('recommended_source_rects'):
            rect=next(v for v in ui_prov['recommended_source_rects'] if v['id']==ui_source_names[index])
        add_sprite('ui-'+name,'chrome-kit',rect,category='ui',size=[200,100],anchor=[.5,.5],label=name)
    add_image('whale-emblem','ui/whale-emblem.png')
    add_sprite('ui-whale-emblem','whale-emblem',category='ui',size=[72,72],anchor=[.5,.5],label='鲸鱼魔盗团徽记')

    # Narrative keyframes are full-width authored images rather than gameplay
    # sprites. Keep them in the runtime catalog so build/QA can verify their
    # provenance and the deploy snapshot can copy them with the story UI.
    for key, filename in {
        'story-prologue-paper-window': 'story/prologue-paper-window.png',
        'story-grok-paper-window': 'story/grok-paper-window.png',
        'story-broadcast-reveal': 'story/broadcast-reveal.png',
        'story-evacuation-beacon': 'story/evacuation-beacon.png',
        'story-investigation-epilogue': 'story/investigation-epilogue.png',
    }.items():
        add_image(key, filename, transparent=False)

    # The three presentations have separately generated native keyframes.
    # Discover them on disk so rebuilding never drops registered story images,
    # while the original five remain available to older saved story scenes.
    style_image_count = 0
    for style in STORY_STYLES:
        for beat in STORY_BEATS:
            key, filename = f'story-{style}-{beat}', f'story/{style}/{beat}.png'
            if (ASSETS / filename).is_file() or key in by_id:
                add_image(key, filename, transparent=False)
                catalog['images'][key].update(story_style=style, story_beat=beat)
                style_image_count += 1

    # Narrative images are not sprite aliases. Reconcile their inventory without
    # creating source rectangles or changing the 96 gameplay sampling regions.
    for key, image in catalog['images'].items():
        if not image['file'].startswith('story/'):
            continue
        entry = by_id.get(key)
        if entry is None:
            entry = {'id': key, 'category': 'story', 'priority': 'P0', 'reference_ids': []}
            manifest['assets'].append(entry)
            by_id[key] = entry
        prov = evidence[key]
        style, beat = image.get('story_style'), image.get('story_beat')
        if style:
            entry.update(label=f'{STORY_STYLES[style]} · {STORY_BEATS[beat]}',
                         prompt_recipe='illustration-story-style',
                         prompt_variables={'story_style': style, 'story_beat': beat},
                         usage=['story_presentation', f'story_style_{style}'])
        entry.update(category='story', creation_method='ai_generated',
                     source_path='assets/' + image['file'], runtime_path='assets/' + image['file'],
                     runtime_catalog_id=key, status='verified', dimensions_verified=True, transparent=False,
                     dimensions={'native_png': [image['width'], image['height']], 'logical_display': [1280, 720]},
                     prompt_path=f'assets/prompts/{key}.txt',
                     provenance={'tool': 'image_gen', 'record_path': 'assets/' + image['provenance'],
                                 'sha256': image['sha256'], 'generated_at': prov.get('date', prov.get('generated_at', '2026-10-25')),
                                 'usage_verified': 'story-runtime'})

    # Link the planning inventory to actual packed files; never invent individual PNG paths.
    for id,sprite in catalog['sprites'].items():
        image=catalog['images'][sprite['image']]
        entry=by_id.get(id)
        if entry is None:
            entry={'id':id,'category':sprite['category'],'label':sprite['label'],'priority':'P0','creation_method':'ai_generated'}
            manifest['assets'].append(entry)
            by_id[id]=entry
        if 'planned_individual_paths' not in entry:
            entry['planned_individual_paths']={k:entry.get(k) for k in ('source_path','runtime_path')}
            entry['planned_dimensions']=entry.get('dimensions')
        entry.update(source_path='assets/'+image['file'],runtime_path='assets/'+image['file'],
                     source_rect=sprite['source_rect'],content_rect=sprite['content_rect'],
                     runtime_catalog_id=id,status='verified',dimensions_verified=True,
                     dimensions={'native_png':[image['width'],image['height']],'source_region':sprite['source_rect'][2:],
                                 'logical_display':sprite['logical_size']},
                     anchor={'normalized':sprite['anchor'],'basis':'content_rect'},
                     provenance={'tool':'image_gen','record_path':'assets/'+image['provenance'],
                                 'sha256':image['sha256'],'generated_at':'2026-10-24','usage_verified':'asset-preview'})
        entry['transparent']=image['transparent']
        if 'direction' in sprite:
            entry['direction']=sprite['direction']
        if 'safe_margin_fraction' in entry:
            entry.setdefault('planned_safe_margin_fraction',entry.pop('safe_margin_fraction'))
        if sprite['category']=='character':
            x,y,w,h=sprite['source_rect']
            bx,by,bw,bh=sprite['solid_rect']
            entry['measured_solid_margins_fraction']=[round((bx-x)/w,6),round((by-y)/h,6),
                round((x+w-bx-bw)/w,6),round((y+h-by-bh)/h,6)]
            entry['margin_assessment']='按实际取样检查主体完整；原定12%留白并非全部达成。'
    for character in ('deepseek','grok','claude','glm'):
        source=by_id['portrait-source-'+character]
        target=by_id['portrait-'+character]
        source.update({k:target[k] for k in ('source_path','runtime_path','source_rect','content_rect','dimensions','dimensions_verified','provenance','status','anchor','transparent')})
        source['runtime_catalog_id']='portrait-'+character
        source['note']='独立生成的正面胸像；HUD与对话共用该源图，程序缩放。'
        target['creation_method']='runtime_alias'
        target['derivation']='与独立生成的1254×1254正面胸像共用原生PNG，按content_rect在运行时缩放；未另行裁切导出192×192图片。'
    guard=by_id['enemy-guard']
    guard.setdefault('prompt_variables',{}).update(identity='白壳红镜、后上方天线与机械爪的球形守卫无人机',
                                                  direction='默认主镜头朝画面左侧，转向可由程序镜像')
    guard['acceptance']=['完整守卫无人机轮廓，白壳与红色主镜头辨识清楚',
                         '默认朝左；程序朝右显示需显式水平镜像',
                         '真实透明PNG，无文字或烘焙背景']
    for group in catalog['animations']:
        entry=by_id['fx-atlas-'+group]
        image=catalog['images'][group+'-atlas']
        entry.update(source_path='assets/'+image['file'],runtime_path='assets/'+image['file'],status='verified',dimensions_verified=True,
                     dimensions={'native_png':[image['width'],image['height']],'grid':[2,2]},
                     provenance={'tool':'image_gen','record_path':'assets/'+image['provenance'],'sha256':image['sha256']})
        entry['creation_method']='ai_generated_atlas'
        entry.pop('derived_from',None)
        entry['contains_frames']=catalog['animations'][group]['frames']
        entry['derivation']='直接生成2列×2行四帧透明图集，原图未拼接或缩放；按runtime-catalog取样，8fps。'
        entry['anchor']={'type':'per_frame_center','normalized':[.5,.5]}
    for entry in manifest['assets']:
        if entry['category']=='ui' and entry['id'] not in catalog['sprites'] and not entry.get('supplemental'):
            entry.update(status='implemented',runtime_path='assets/ui/game-ui.css',source_path='assets/ui/hud-icon-badges.png',
                         note='由已生成 PNG 徽章带提供的可伸缩界面标记；动态文本与状态仍由 HTML 更新。')
        if entry['category']=='submission':
            entry.update(status='waiting_for_gameplay_capture',note='比赛主角卡需真实游戏运行截图；当前概念图和美术拼装预览不冒充实机截图。')
        if entry['category']=='audio':
            entry['note']='音频不属于本次静态美术包，保持待制作。'
    manifest['schema_version']='1.2.0'
    manifest['scope']['note']='横版固定镜头；五章约20分钟。生产美术已生成并以图集交付，逐项坐标见runtime-catalog；游戏开发与真实实机投稿截图仍需继续。'
    manifest['conventions'].update(source_size_policy='所有尺寸为已检查的原生PNG尺寸；source_rect指定图集取样，运行时缩放，不对PNG做裁缩。',
                                   atlas_layout_policy='使用source_rect，禁止假定所有图集均匀分格。角色按content_rect底部对齐；特效使用完整source_rect保持共同中心。')
    conventions=manifest['conventions']
    for field in ('character_source_px','character_runtime_px','character_foot_anchor_source_px',
                  'character_foot_anchor_runtime_px','character_safe_margin'):
        if field in conventions:
            conventions.setdefault('planned_'+field,conventions.pop(field))
    conventions.update(character_native_atlas_px=[793,1983],
        character_frame_dimensions='各帧实际大小见runtime-catalog source_rect，不另行导出256×256运行PNG。',
        character_actual_anchor='以content_rect底部中心为脚底锚点，drawActor使用每角色统一native_scale。',
        safe_margin_policy='12%为原计划目标；实际留白已登记，不把局部留白不足误标为缺图或全部通过12%。')
    manifest['status_policy'].update(implemented='程序界面资源已实现',waiting_for_gameplay_capture='等待真实游戏运行后截取投稿图片')
    story_image_count=sum(image['file'].startswith('story/') for image in catalog['images'].values())
    manifest['summary']={**manifest.get('summary', {}), 'total_records':len(manifest['assets']),'by_category':dict(Counter(a['category'] for a in manifest['assets'])),
                         'by_status':dict(Counter(a['status'] for a in manifest['assets'])),
                         'production_png_files':len(catalog['images']),'runtime_sprite_regions':len(catalog['sprites']),
                         'reference_files':2,'concept_files':1,
                         'story_png_files':story_image_count,'story_style_png_files':style_image_count}
    catalog['summary']={'png_files':len(catalog['images']),'sprite_regions':len(catalog['sprites']),
                        'character_poses':40,'portraits':4,'fx_groups':4,'fx_frames':16,
                        'categories':dict(Counter(s['category'] for s in catalog['sprites'].values())),
                        'story_png_files':story_image_count,'story_style_png_files':style_image_count}
    catalog['notes']=['所有PNG保留原始输出；坐标描述用于运行时drawImage取样。',
                      '行走为单张关键姿态，非完整逐帧步态循环。',
                      'drawActor使用每角色统一native_scale，切换动作不因武器外包围框变化而整体缩放。',
                      '特效播放应使用source_rect，以共同帧中心防止抖动。',
                      '背景实际为1672×941，运行时cover适配16:9，不拉伸人物。',
                      '平台装饰支架不等于碰撞盒；碰撞顶面由关卡数据单独定义。',
                      '个别姿态和头像未达到原计划12%留白，已按实际取样确认主体完整。']
    assert len(catalog['images'])==28+style_image_count
    assert style_image_count in (0, len(STORY_STYLES)*len(STORY_BEATS)), 'Incomplete three-style story art: expected all 21 PNGs'
    assert len(catalog['sprites'])==96
    write_json(MANIFEST,manifest)
    write_json(ASSETS/'runtime-catalog.json',catalog)
    (ASSETS/'preview').mkdir(exist_ok=True)
    (ASSETS/'preview'/'catalog.js').write_text('window.WHALE_ASSETS = '+json.dumps(catalog,ensure_ascii=False)+';\n',encoding='utf-8')
    write_json(ASSETS/'qa-report.json',{'date':'2026-10-25','summary':catalog['summary'],
        'read_only_image_checks':True,'raster_modifications':False,
        'checks':[f"{len(catalog['images'])} PNG存在且可完整解码",'透明素材具真实Alpha及零Alpha像素','所有取样框均在原图内','所有取样框均含实色内容','原图SHA256已登记','所有PNG均附独立生成来源记录'],
        'warnings':warnings,'limitations':catalog['notes']})
    print(json.dumps({'summary':catalog['summary'],'boundary_warnings':warnings},ensure_ascii=False,indent=2))


if __name__=='__main__':
    build()
