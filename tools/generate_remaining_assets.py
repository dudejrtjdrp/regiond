"""Generate the remaining Toji pixel-art asset set as individual transparent PNGs.

The game uses crisp low-resolution art, so these are deliberately authored as
pixel primitives at a small master resolution and upscaled without smoothing.
Every output is an individual file; creature animation is the only exception,
where one sprite sheet represents the frames of one creature.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'assets'

GRADE = {'common': '#9c8f76', 'rare': '#4e83c8', 'unique': '#a369cf', 'legendary': '#d69a32', 'fixed': '#e3d165'}
PALETTE = ['#d29a50', '#7ea55a', '#6d94bd', '#b96864', '#a981c4', '#b8a78c', '#cd7b42', '#689a99']

def data(name):
    return json.loads((ROOT / 'data' / name).read_text(encoding='utf8'))

def hashv(s):
    return int(hashlib.sha256(s.encode()).hexdigest()[:8], 16)

def rgba(c):
    c = c.lstrip('#')
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4)) + (255,)

def shade(c, f=.72):
    r,g,b,a=rgba(c)
    return (int(r*f),int(g*f),int(b*f),a)

def canvas(n=32): return Image.new('RGBA', (n,n), (0,0,0,0))

def save(im, path, scale=2):
    path.parent.mkdir(parents=True, exist_ok=True)
    if scale != 1: im = im.resize((im.width*scale, im.height*scale), Image.Resampling.NEAREST)
    im.save(path)

def px(draw, box, color, outline=True):
    x,y,w,h=box
    if outline: draw.rectangle((x-1,y-1,x+w,y+h), fill=(35,29,24,255))
    draw.rectangle((x,y,x+w-1,y+h-1), fill=color)

def icon(key, grade='common', label=None):
    im=canvas(); d=ImageDraw.Draw(im); h=hashv(key); col=PALETTE[h % len(PALETTE)]; edge=GRADE.get(grade, GRADE['common'])
    # Grade rim keeps the visual language consistent while the silhouette identifies the artifact.
    d.rectangle((2,2,29,29), fill=(35,29,24,230)); d.rectangle((3,3,28,28), outline=rgba(edge), width=2)
    k=(label or key).lower()
    if any(x in k for x in ('ring','seal','sigil','crown','charm')):
        d.ellipse((9,8,22,21), outline=rgba(col), width=4); d.rectangle((14,12,18,17), fill=rgba(edge))
    elif any(x in k for x in ('scroll','map','journal','book','contract','treaty','plan','song')):
        px(d,(8,7,15,18),rgba('#dcc79d')); d.line((11,11,19,11),fill=shade('#dcc79d'),width=1); d.line((11,15,19,15),fill=shade('#dcc79d'),width=1); d.line((11,19,17,19),fill=shade('#dcc79d'),width=1)
    elif any(x in k for x in ('sword','spear','scythe','pickaxe','tools','whetstone')):
        d.polygon([(15,5),(19,18),(17,18),(16,26),(13,26),(15,18),(12,18)],fill=rgba('#d8dce0')); d.rectangle((10,17,21,19),fill=rgba(col)); d.rectangle((14,19,17,27),fill=shade(col))
    elif any(x in k for x in ('orb','eye','droplet','heart','ember','seed','feather','tooth','scale')):
        d.ellipse((8,7,23,22),fill=rgba(col),outline=(35,29,24,255),width=2); d.ellipse((12,11,19,18),fill=rgba(edge))
        if 'feather' in k: d.polygon([(16,5),(22,16),(17,25),(12,15)],fill=rgba(col)); d.line((16,7,16,24),fill=shade(col),width=2)
    elif any(x in k for x in ('cloak','robe','boots','helm')):
        d.polygon([(11,6),(21,6),(24,25),(8,25)],fill=rgba(col)); d.rectangle((12,5,20,9),fill=rgba(edge))
    elif any(x in k for x in ('horn','chalice','furnace','oil','firewood','essence')):
        d.polygon([(10,7),(22,7),(20,24),(12,24)],fill=rgba(col)); d.rectangle((12,10,20,13),fill=rgba(edge))
    else:
        d.polygon([(16,5),(25,12),(22,24),(10,26),(6,15)],fill=rgba(col),outline=(35,29,24,255)); d.rectangle((13,12,19,18),fill=rgba(edge))
    return im

def creature_sheet(key, boss=False):
    # Four facing columns × idle / 2 walk / 3 attack rows.
    size=32; im=Image.new('RGBA',(size*4,size*6),(0,0,0,0)); h=hashv(key); col=PALETTE[h%len(PALETTE)]
    if key in {'wolf','direwolf','ash_hound'}: col='#78818a'
    if key=='bear': col='#74523b'
    if key=='ash_wyrm': col='#9a4e39'
    if key=='snow_fox': col='#dce8f0'
    for state in range(6):
        for facing in range(4):
            d=ImageDraw.Draw(im); ox=facing*size; oy=state*size; bob=1 if state in (1,3) else 0; attack=state>=3
            bodyw=19 if not boss else 25; bodyh=12 if not boss else 17; x=ox+(size-bodyw)//2; y=oy+15-bob
            d.ellipse((x,y,x+bodyw,y+bodyh),fill=rgba(col),outline=(34,27,25,255),width=2)
            headx=x+bodyw-8 if facing in (1,3) else x+1; d.ellipse((headx,oy+8-bob,headx+10,oy+18-bob),fill=rgba(col),outline=(34,27,25,255),width=2)
            if key in {'rabbit','snow_fox'}: d.rectangle((headx+2,oy+3-bob,headx+4,oy+10-bob),fill=rgba(col)); d.rectangle((headx+6,oy+3-bob,headx+8,oy+10-bob),fill=rgba(col))
            if key in {'chicken'}: d.polygon([(headx+4,oy+4),(headx+7,oy+8),(headx+1,oy+8)],fill=rgba('#cb4e43'))
            if key in {'cow','deer','ash_wyrm'}: d.line((headx+2,oy+8,headx,oy+3),fill=rgba('#e7d9b4'),width=2); d.line((headx+8,oy+8,headx+10,oy+3),fill=rgba('#e7d9b4'),width=2)
            if key in {'bandit_scout'}: d.rectangle((headx,oy+6,headx+10,oy+10),fill=rgba('#4f3a50'))
            for leg in (x+3,x+bodyw-6): d.rectangle((leg,oy+25,leg+3,oy+29-bob),fill=shade(col))
            if attack: d.line((headx+5,oy+16,headx+(14 if facing in (1,3) else -4),oy+21),fill=rgba('#efe0b9'),width=3)
    return im

def scene(key, size=(240,135)):
    # Transparent cutscene/card composition: a unique landmark, no baked panel background.
    im=Image.new('RGBA',size,(0,0,0,0));d=ImageDraw.Draw(im); w,h=size; col=PALETTE[hashv(key)%len(PALETTE)]
    d.ellipse((w*.12,h*.72,w*.88,h*.94),fill=(36,29,20,110))
    d.polygon([(w*.5,h*.1),(w*.78,h*.76),(w*.22,h*.76)],fill=rgba(col),outline=(35,29,24,255))
    d.rectangle((w*.42,h*.43,w*.58,h*.76),fill=rgba('#5a4430'))
    for i in range(4):
        x=int(w*.28+i*w*.13); d.rectangle((x,int(h*.57),x+int(w*.07),int(h*.63)),fill=rgba('#e6d099'))
    d.ellipse((w*.44,h*.22,w*.56,h*.34),fill=rgba(GRADE['legendary']))
    return im

def build_ruined():
    for folder in (OUT/'building').iterdir():
        base=folder/'base.png'
        if not base.exists(): continue
        im=Image.open(base).convert('RGBA')
        dark=ImageEnhance.Brightness(im).enhance(.54)
        d=ImageDraw.Draw(dark); w,h=dark.size
        for i in range(5):
            x=(hashv(folder.name+str(i))%(max(1,w-8)))+4; y=(hashv(str(i)+folder.name)%(max(1,h-8)))+4
            d.line((x,y,x+max(3,w//12),y+max(3,h//14)),fill=(35,24,19,220),width=max(1,w//80))
        dark.save(folder/'ruined.png')
    for i in range(1,5):
        im=canvas(96); d=ImageDraw.Draw(im); d.rectangle((8,72,87,87),fill=rgba('#5f432a'))
        d.rectangle((14,30,81,72),outline=rgba('#b28d5b'),width=4)
        for x in range(16,82,16): d.line((x,32,x,71),fill=rgba('#846344'),width=3)
        if i>=2: d.rectangle((26,50,70,72),fill=rgba('#b8a06f'))
        if i>=3: d.polygon([(20,50),(48,18),(76,50)],fill=rgba('#7c5840'))
        if i>=4: d.rectangle((38,38,58,72),fill=rgba('#453125'))
        save(im,OUT/'building'/'site'/f'phase-{i}.png',1)
    # 울타리·문은 파도 공격에서 온전/상함/부서짐을 읽어야 한다.
    for key in ('fence','gate'):
        src=OUT/'building'/key/'base.png'
        if src.exists():
            for state, amount in (('damaged',4),('broken',10)):
                im=Image.open(src).convert('RGBA'); d=ImageDraw.Draw(im); w,h=im.size
                for i in range(amount):
                    x=hashv(key+state+str(i)) % max(1,w-4); y=hashv(state+key+str(i)) % max(1,h-4)
                    d.line((x,y,x+max(3,w//16),y+max(2,h//22)),fill=(48,32,24,255),width=max(1,w//90))
                if state=='broken': d.rectangle((w//2-w//9,h//2,w//2+w//9,h-1),fill=(0,0,0,0))
                im.save(OUT/'building'/key/f'{state}.png')
    parts={'fence_h':(96,48),'fence_v':(48,96),'fence_post':(48,48),'wall_h':(96,48),'wall_v':(48,96),'wall_post':(48,48),'gate_wood':(96,96),'gate_stone':(96,96)}
    for key,wh in parts.items():
        im=Image.new('RGBA',wh,(0,0,0,0));d=ImageDraw.Draw(im); wood='#825734' if 'wall' not in key else '#9a948a'
        if key.endswith('_h'): d.rectangle((4,wh[1]//3,wh[0]-5,wh[1]*2//3),fill=rgba(wood),outline=(35,29,24,255),width=3)
        elif key.endswith('_v'): d.rectangle((wh[0]//3,4,wh[0]*2//3,wh[1]-5),fill=rgba(wood),outline=(35,29,24,255),width=3)
        elif 'post' in key: d.rectangle((wh[0]//3,4,wh[0]*2//3,wh[1]-5),fill=rgba(wood),outline=(35,29,24,255),width=3)
        else:
            d.rectangle((7,28,wh[0]-8,wh[1]-8),fill=rgba(wood),outline=(35,29,24,255),width=3); d.rectangle((wh[0]//2-4,wh[1]//2,wh[0]//2+4,wh[1]-8),fill=rgba('#d4b66d'))
        target = OUT/'building_parts'/f'{key}.png'
        target.parent.mkdir(parents=True, exist_ok=True)
        im.save(target)

def main():
    arts=data('artifacts.json')
    manifest=[]
    for a in arts['list']:
        save(icon(a['key'],a.get('grade','common'),a.get('name')),OUT/'artifact'/a['key']/'base.png')
        manifest.append({'key':'asset/artifact/'+a['key']+'/base.png','name':'유물 · '+a.get('name',a['key']),'category':'collection','footprint':[2,2]})
    for g,c in GRADE.items():
        im=canvas(32);d=ImageDraw.Draw(im);d.rectangle((1,1,30,30),outline=rgba(c),width=3); d.rectangle((4,4,27,27),outline=(35,29,24,255),width=1);save(im,OUT/'artifact'/'frame'/f'{g}.png',2)
    build_ruined()
    # 영사관은 유일한 5단계 일반 건물이다. 칸 수는 유지하고 장식·금장만 깊게 올린다.
    consulate = OUT/'building'/'consulate'/'tier-3.png'
    if consulate.exists():
        for level in (4,5):
            im = Image.open(consulate).convert('RGBA')
            d = ImageDraw.Draw(im); w,h=im.size; gold = rgba('#f2c75c'); deep = rgba('#8f5d30')
            inset=max(3,w//35); d.rectangle((inset,inset,w-inset-1,h-inset-1),outline=deep,width=max(2,w//110))
            d.rectangle((inset*2,inset*2,w-inset*2-1,h-inset*2-1),outline=gold,width=max(1,w//150))
            for x in range(w//5,w,w//5): d.ellipse((x-w//70,h//5,x+w//70,h//5+w//35),fill=gold)
            if level==5: d.polygon([(w//2,h//10),(w//2+w//18,h//5),(w//2-w//18,h//5)],fill=gold)
            im.save(OUT/'building'/'consulate'/f'tier-{level}.png')
            manifest.append({'key':'asset/building/consulate/tier-'+str(level)+'.png','name':'영사관 · '+str(level)+'단계','category':'collection','footprint':[6,6]})
    for folder in (OUT/'building').iterdir():
        if (folder/'base-v1-source.png').exists() and (folder/'ruined.png').exists():
            manifest.append({'key':'asset/building/'+folder.name+'/ruined.png','name':'건물 폐허 · '+folder.name,'category':'collection','footprint':[4,4]})
    for i in range(1,5): manifest.append({'key':'asset/building/site/phase-'+str(i)+'.png','name':'건설 현장 · '+str(i)+'단계','category':'collection','footprint':[4,4]})
    for key in ('fence','gate'):
        for state in ('damaged','broken'):
            manifest.append({'key':'asset/building/'+key+'/'+state+'.png','name':'피해 상태 · '+key+' '+state,'category':'collection','footprint':[2,2]})
    for k in ['fence_h','fence_v','fence_post','wall_h','wall_v','wall_post','gate_wood','gate_stone']:
        manifest.append({'key':'asset/building_parts/'+k+'.png','name':'성벽 부속 · '+k,'category':'collection','footprint':[2,2]})
    creatures=data('creatures.json')
    defs=creatures['defs']; defs['ash_wyrm']=creatures['worldBoss']
    for k in defs: save(creature_sheet(k,k=='ash_wyrm'),OUT/'creature'/k/'sheet.png',1)
    for k,v in defs.items():
        name = v.get('name', k) if isinstance(v, dict) else ('잿빛 산의 늙은 용' if k == 'ash_wyrm' else k)
        manifest.append({'key':'asset/creature/'+k+'/sheet.png','name':'생물 · '+name,'category':'collection','footprint':[3,3]})
    for k in ['wolf','bandit','pirate','viking','ogre','dragon']:
        save(creature_sheet(k,k in {'ogre','dragon'}),OUT/'enemy'/k/'sheet.png',1)
        manifest.append({'key':'asset/enemy/'+k+'/sheet.png','name':'침공 적 · '+k,'category':'collection','footprint':[3,3]})
    save(scene('raider_camp'),OUT/'enemy'/'camp'/'base.png',1)
    manifest.append({'key':'asset/enemy/camp/base.png','name':'침공 · 선발대 야영지','category':'collection','footprint':[5,3]})
    ruins=data('ruins.json')
    for c in ruins['cards']:
        save(scene(c['id']),OUT/'ruin_card'/c['id']/'base.png',1)
        manifest.append({'key':'asset/ruin_card/'+c['id']+'/base.png','name':'유적 카드 · '+c['name'],'category':'collection','footprint':[5,3]})
    for k in ['riddle','trial','sanctum']: save(scene('temple_'+k),OUT/'ruin_card'/'temple'/f'{k}.png',1)
    for k in data('research.json')['defs']:
        save(icon(k,'rare',k),OUT/'research'/k/'base.png')
        manifest.append({'key':'asset/research/'+k+'/base.png','name':'연구 · '+k,'category':'collection','footprint':[2,2]})
    ui=['pirate','viking','dragon','sprout','sun','leaf','moon','sheep','gem','anvil','sword','castle','dice','hoe','pickaxe','wall','road','farmTile','axe','rail','person','bandit','ogre']
    for k in ui:
        save(icon(k,'common',k),OUT/'ui'/'generated'/k/'base.png')
        manifest.append({'key':'asset/ui/generated/'+k+'/base.png','name':'UI · '+k,'category':'collection','footprint':[2,2]})
    chapter=data('chapters.json')
    for c in chapter['chapters']:
        k=c.get('id') or c.get('key') or c.get('chapter')
        if k: save(scene('chapter_'+str(k)),OUT/'cutscene'/str(k)/'base.png',1)
    # The canonical ten cards also get stable English keys for UI binding.
    for k in ['spark','first_roof','hunger','first_neighbor','shape_of_town','secret_of_land','strange_tracks','traders_road','dignity','endless']:
        save(scene(k),OUT/'cutscene'/k/'base.png',1)
        manifest.append({'key':'asset/cutscene/'+k+'/base.png','name':'챕터 · '+k,'category':'collection','footprint':[5,3]})
    markers=['node','site','structure','buildSlot','ui','point','resident']
    for k in markers: save(icon(k,'rare',k),OUT/'minimap'/f'{k}.png')
    save(scene('toji_title',(360,160)),OUT/'ui'/'title_logo.png',1)
    save(scene('loading',(360,160)),OUT/'ui'/'loading.png',1)
    # 9-slice source: corners, edges, and center all live in one UI-only source image.
    im=Image.new('RGBA',(48,48),(0,0,0,0));d=ImageDraw.Draw(im);d.rectangle((0,0,47,47),fill=rgba('#4f3829'));d.rectangle((5,5,42,42),fill=rgba('#d5bc86'));d.rectangle((10,10,37,37),fill=rgba('#f1dfb2'));im.save(OUT/'ui'/'panel_9slice.png')
    (OUT/'generated-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    print('remaining asset generation complete')

if __name__=='__main__': main()
