#!/usr/bin/env python3
"""PixelLab 행동 시트를 게임이 읽는 8×8 균일 격자로 다시 굽는다.

원본(`public/assets/char_spritesheet/exec-*.png`)은 캐릭터마다 행 수가 6·7·8로
제각각이고 칸 경계도 안 맞는다. 방향 회전도 완전하지 않아서 — mage 는 뒷모습이
아예 없고 tank 는 거의 다 뒷모습이다 — 8방향을 그대로 못 뽑는다.

그래서 각 시트에서 확실히 읽히는 정면·측면·뒷모습 세 행만 고르고, 반대쪽 측면은
좌우 반전으로 만들어 8방향을 채운다. 결과는

    행 = 0:남 1:남서 2:서 3:북서 4:북 5:북동 6:동 7:남동
    열 = 공격·벌목·채광·수확 × (준비, 타격)

로 `public/assets/player/action-8dir/<skin>.png` 에 저장된다. 한 칸에 전신
하나만 들어가므로 `action-sprites.js` 는 단순 나눗셈으로 슬라이싱하면 된다.

의존성은 Pillow 와 numpy 뿐이다(연결 성분은 런 union-find 로 직접 구한다).
사용: python3 tools/pack_action_sheets.py
"""
import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'public', 'assets', 'char_spritesheet')
DST = os.path.join(ROOT, 'public', 'assets', 'player', 'action-8dir')

# 원본 파일명 -> 스킨 키. 원화(public/assets/characters/<role>/sheet.png)와 대조해 확정.
SHEETS = {
    'exec-9ce41e35-4fd3-4e82-9337-e853efb7b3e5.png': 'saint',      # 백발 여성    = saint 성녀
    'exec-19a8a3b1-7ad2-47e1-b2ec-9a011bb726cf.png': 'mage',       # 하늘색 머리  = farm 농업
    'exec-48f1febb-b450-4b01-a86f-fccfff3ea047.png': 'tank',       # 수염 거한    = factory 공업
    'exec-b7cf67ed-3469-4de6-aa13-c18c2fc7053d.png': 'archer',     # 붉은머리     = defense 방어
    'exec-bb1ed232-7f11-4d0f-b917-89f0a2362918.png': 'tactician',  # 흑발 남성    = trade 교역
    'exec-bf8dc208-78c7-4184-8fed-93faeda6dfde.png': 'warrior',    # 금발 소년    = build 건설
    'exec-cdc70af7-3314-4138-8afb-66e68bd86db6.png': 'male',       # 갈색머리 소년 = 주민 남
    # 주민 여는 초록 배경본을 쓴다. 마젠타본(exec-be2beac7)은 칸이 겹쳐 덩어리가 갈라진다.
    'exec-49b6e521-8e2c-4edf-9382-a7765ea1803a.png': 'female',
}

# 스킨 -> 쓸 소스 행 번호. leftmirror 는 그 행이 이미 오른쪽을 보고 있다는 뜻.
PICK = {
    'saint':     dict(front=0, left=2, back=3),
    'mage':      dict(front=0, left=2, back=3),
    'tank':      dict(front=0, left=2, back=3),
    'archer':    dict(front=0, left=2, back=4, leftmirror=True),
    'tactician': dict(front=0, left=2, back=4),
    'warrior':   dict(front=0, left=2, back=4),
    'male':      dict(front=0, left=1, back=3),
    'female':    dict(front=0, left=2, back=4),
}

# 게임 8방향을 네 버킷에 나눠 담는다.
BUCKET = ['front', 'left', 'left', 'back', 'back', 'back', 'right', 'right']


def chroma_key(im):
    """마젠타·초록 배경을 투명으로. HSV 색상 ±24°, 채도 0.30 이상만 지운다."""
    rgb = np.asarray(im.convert('RGB'))
    a = rgb.astype(np.float32) / 255.0
    mx, mn = a.max(2), a.min(2)
    d = np.maximum(mx - mn, 1e-6)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    h = np.zeros_like(mx)
    m = mx == r
    h[m] = ((g - b)[m] / d[m]) % 6
    m = (mx == g) & (mx != r)
    h[m] = ((b - r)[m] / d[m]) + 2
    m = (mx == b) & (mx != r) & (mx != g)
    h[m] = ((r - g)[m] / d[m]) + 4
    h *= 60.0

    def near(hc):
        return np.minimum(np.abs(h - hc), 360 - np.abs(h - hc))

    key = ((near(300) <= 24) | (near(120) <= 24)) & (s >= 0.30) & (mx >= 0.30)
    return Image.fromarray(np.dstack([rgb, np.where(key, 0, 255).astype(np.uint8)]), 'RGBA')


def dilate(mask, k):
    """k×k 사각 커널 이진 팽창. 무기·불꽃이 몸통에서 한두 픽셀 떨어져 있어도 한 덩어리로 묶는다."""
    r = k // 2
    out = np.pad(mask, r)
    for axis in (0, 1):
        acc = out.copy()
        for shift in range(1, r + 1):
            acc |= np.roll(out, shift, axis=axis)
            acc |= np.roll(out, -shift, axis=axis)
        out = acc
    return out[r:-r, r:-r]


def components(mask, min_area=1500, min_h=50, min_w=18):
    """연결 성분의 바운딩 박스. 행 단위 런을 union-find 로 이어 붙인다."""
    parent = []

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    runs, prev = [], []
    for y in range(mask.shape[0]):
        row = mask[y]
        if not row.any():
            prev = []
            continue
        edges = np.flatnonzero(np.diff(np.concatenate(([0], row.view(np.int8), [0]))))
        cur = []
        for x0, x1 in zip(edges[0::2], edges[1::2]):
            rid = len(runs)
            parent.append(rid)
            runs.append((y, x0, x1))
            for px0, px1, pid in prev:
                if px0 < x1 and x0 < px1:
                    union(rid, pid)
            cur.append((x0, x1, rid))
        prev = cur

    boxes = {}
    for rid, (y, x0, x1) in enumerate(runs):
        root = find(rid)
        box = boxes.get(root)
        if box is None:
            boxes[root] = [y, y + 1, x0, x1, x1 - x0]
        else:
            box[1] = y + 1
            box[2] = min(box[2], x0)
            box[3] = max(box[3], x1)
            box[4] += x1 - x0
    return [b[:4] for b in boxes.values()
            if b[4] >= min_area and b[1] - b[0] > min_h and b[3] - b[2] > min_w]


def find_cells(im):
    """전신 덩어리를 찾아 행 단위로 묶는다. 각 행은 왼쪽부터 8칸."""
    boxes = components(dilate(np.asarray(im)[..., 3] > 24, 7))
    boxes.sort(key=lambda r: (r[0] + r[1]) / 2)
    rows, cur = [], [boxes[0]]
    ref = (boxes[0][0] + boxes[0][1]) / 2
    for box in boxes[1:]:
        mid = (box[0] + box[1]) / 2
        if abs(mid - ref) < 70:
            cur.append(box)
            ref = (ref * (len(cur) - 1) + mid) / len(cur)
        else:
            rows.append(cur)
            cur, ref = [box], mid
    rows.append(cur)
    for row in rows:
        row.sort(key=lambda x: x[2])
    return rows


def pack(path, skin):
    im = chroma_key(Image.open(path))
    rows = find_cells(im)
    pick = PICK[skin]
    # 시트 끝쪽 행은 칸이 겹쳐 덩어리가 갈라지기도 한다. 실제로 쓰는 행만 온전하면 된다.
    bad = [i for i in (pick['front'], pick['left'], pick['back']) if len(rows[i]) != 8]
    if bad:
        raise SystemExit('%s: 행 %s 이 8칸이 아니다 (%s)' % (skin, bad, [len(r) for r in rows]))

    def tiles(index, mirror):
        out = []
        for (y0, y1, x0, x1) in rows[index]:
            tile = im.crop((x0, y0, x1, y1))
            out.append(tile.transpose(Image.FLIP_LEFT_RIGHT) if mirror else tile)
        return out

    lm = pick.get('leftmirror', False)
    bucket = {
        'front': tiles(pick['front'], False),
        'back': tiles(pick['back'], False),
        'left': tiles(pick['left'], lm),
        'right': tiles(pick['left'], not lm),
    }
    every = [t for v in bucket.values() for t in v]
    cw = max(t.width for t in every) + 10
    ch = max(t.height for t in every) + 10
    sheet = Image.new('RGBA', (cw * 8, ch * 8), (0, 0, 0, 0))
    for d in range(8):
        frames = bucket[BUCKET[d]]
        for c in range(8):
            tile = frames[c]
            sheet.alpha_composite(tile, (c * cw + (cw - tile.width) // 2,
                                         d * ch + (ch - tile.height) - 5))
    out = os.path.join(DST, skin + '.png')
    sheet.save(out)
    print('%-10s %d행 소스 -> %s (칸 %d×%d)' % (skin, len(rows), out, cw, ch))


if __name__ == '__main__':
    for name, skin in SHEETS.items():
        pack(os.path.join(SRC, name), skin)
