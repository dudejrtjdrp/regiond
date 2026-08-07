#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""갈래말래(Toji) 픽셀아트 후처리 — 마젠타 제거 → 트림 → 정수 다운스케일 → 팔레트 양자화 → 앵커 배치.

「왜」 이 모듈은 파이프라인의 '아트바이블 강제 장치'다. 생성 모델이 무엇이든
     결과물이 §2 팔레트·§6 픽셀 밀도·§8 규격을 반드시 만족하도록 여기서 못 박는다.
「왜」 카테고리 규격표(§8)와 마스터 팔레트 로더도 여기 둔다 — qa.py/generate.py/register.py가
     같은 정본을 공유해야 박물관 QA와 수치가 어긋나지 않는다.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, deque
from pathlib import Path

from PIL import Image

# ------------------------------------------------------------------ 경로/상수

# 「왜」 스크립트 위치 기준으로 루트를 잡아야 사용자가 어느 폴더에서 실행하든 동작한다.
PIPELINE_DIR = Path(__file__).resolve().parent
DEFAULT_PROJECT_ROOT = PIPELINE_DIR.parent.parent
PALETTE_REL = "public/assets/palette/master-v1.json"

MAGENTA_KEY = (255, 0, 255)
KEY_TOLERANCE = 110        # 「왜」 배경 본색 제거용 RGB 유클리드 거리 임계.
HALO_TOLERANCE = 190       # 「왜」 실루엣에 번진 마젠타 프린지는 더 헐거운 임계로 깎는다.
ALPHA_CUTOFF = 128         # 「왜」 아트바이블 §1 — 알파는 0 또는 255만 허용.


def project_root(config_root: str | None = None) -> Path:
    """프로젝트 루트를 돌려준다. config의 projectRoot는 config.json 위치 기준 상대경로다."""
    if not config_root:
        return DEFAULT_PROJECT_ROOT
    return (PIPELINE_DIR / config_root).resolve()


def load_palette(root: Path | None = None) -> list[tuple[int, int, int]]:
    """master-v1.json의 램프를 펼쳐 중복 제거한 마스터 팔레트를 돌려준다."""
    base = root or DEFAULT_PROJECT_ROOT
    data = json.loads((base / PALETTE_REL).read_text(encoding="utf-8"))
    hexes = [h for ramp in data["ramps"].values() for h in ramp]
    hexes += list(data.get("extremes", {}).values())
    return _dedupe_rgb([_hex_to_rgb(h) for h in hexes])


def palette_hexes(root: Path | None = None) -> list[str]:
    """프롬프트에 박아 넣을 hex 문자열 목록(정본 순서)."""
    return ["#%02x%02x%02x" % rgb for rgb in load_palette(root)]


def pixels(img: Image.Image) -> list:
    """「왜」 Pillow 12부터 getdata()가 deprecated다. 두 버전 모두에서 조용히 동작하게 감싼다."""
    if hasattr(img, "get_flattened_data"):
        return list(img.get_flattened_data())
    return list(img.getdata())


def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    v = value.lstrip("#")
    return (int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16))


def _dedupe_rgb(colors: list[tuple[int, int, int]]) -> list[tuple[int, int, int]]:
    seen: dict[tuple[int, int, int], None] = {}
    for c in colors:
        seen.setdefault(c, None)
    return list(seen.keys())


# ------------------------------------------------- 카테고리 규격표 (아트바이블 §8)

# canvas: 기본 캔버스 / content: 콘텐츠 높이 (min, max) / anchor: bottom|center|fill
CATEGORY_SPECS: dict[str, dict] = {
    "player":     {"canvas": (128, 128), "content": (96, 112), "anchor": "bottom", "outline": True},
    "npc":        {"canvas": (96, 128),  "content": (80, 96),  "anchor": "bottom", "outline": True},
    "monster":    {"canvas": (128, 128), "content": (96, 112), "anchor": "bottom", "outline": True},
    "animal":     {"canvas": (96, 96),   "content": (60, 88),  "anchor": "bottom", "outline": True},
    "weapon":     {"canvas": (64, 64),   "content": (48, 56),  "anchor": "center", "outline": True},
    "armor":      {"canvas": (64, 64),   "content": (48, 56),  "anchor": "center", "outline": True},
    "food":       {"canvas": (64, 64),   "content": (48, 56),  "anchor": "center", "outline": True},
    "consumable": {"canvas": (64, 64),   "content": (48, 56),  "anchor": "center", "outline": True},
    "material":   {"canvas": (64, 64),   "content": (48, 56),  "anchor": "center", "outline": True},
    "mineral":    {"canvas": (96, 96),   "content": (56, 84),  "anchor": "bottom", "outline": True},
    "tree":       {"canvas": (128, 192), "content": (150, 184), "anchor": "bottom", "outline": True},
    "plant":      {"canvas": (64, 64),   "content": (36, 60),  "anchor": "bottom", "outline": True},
    "furniture":  {"canvas": (96, 96),   "content": (60, 88),  "anchor": "bottom", "outline": True},
    "building":   {"canvas": (128, 176), "content": (130, 168), "anchor": "bottom", "outline": True},
    "tileset":    {"canvas": (64, 64),   "content": (64, 64),  "anchor": "fill",   "outline": False},
    "ui":         {"canvas": (64, 64),   "content": (44, 56),  "anchor": "center", "outline": True},
    "effect":     {"canvas": (128, 128), "content": (80, 120), "anchor": "center", "outline": False},
    "portrait":   {"canvas": (96, 96),   "content": (78, 92),  "anchor": "center", "outline": True},
}

# 「왜」 §8의 건물 풋프린트 표를 CLI에서 --size로 그대로 지정할 수 있게 참고표로 남긴다.
BUILDING_FOOTPRINTS = {
    "1x1": (64, 96), "2x2": (128, 176), "2x3": (128, 224),
    "3x3": (192, 256), "3x4": (192, 304), "4x4": (256, 352),
}

CATEGORIES = tuple(CATEGORY_SPECS.keys())


def category_spec(category: str, size: tuple[int, int] | None = None) -> dict:
    """카테고리 규격을 돌려주고, --size가 오면 캔버스와 콘텐츠 목표를 함께 스케일한다."""
    base = CATEGORY_SPECS.get(category)
    if base is None:
        raise ValueError(f"알 수 없는 카테고리입니다: {category} — 허용값: {', '.join(CATEGORIES)}")
    if size is None or tuple(size) == base["canvas"]:
        return dict(base)
    return _rescaled_spec(base, size)


def _rescaled_spec(base: dict, size: tuple[int, int]) -> dict:
    """캔버스를 바꾸면 콘텐츠 높이 목표도 같은 비율로 따라가야 규격 검사가 성립한다."""
    ratio = size[1] / base["canvas"][1]
    lo, hi = base["content"]
    spec = dict(base)
    spec["canvas"] = (int(size[0]), int(size[1]))
    spec["content"] = (int(round(lo * ratio)), int(round(hi * ratio)))
    return spec


def parse_size(text: str | None) -> tuple[int, int] | None:
    """'128x128' 형태를 (128,128)로. 잘못된 값은 한국어로 거절한다."""
    if not text:
        return None
    parts = text.lower().replace("*", "x").split("x")
    if len(parts) != 2 or not all(p.strip().isdigit() for p in parts):
        raise ValueError(f"--size 형식이 잘못됐습니다: {text} — 예: 128x128")
    return (int(parts[0]), int(parts[1]))


# --------------------------------------------------------- 1단계: 마젠타 배경 제거

def _sq_dist(c: tuple[int, int, int], key: tuple[int, int, int]) -> int:
    return (c[0] - key[0]) ** 2 + (c[1] - key[1]) ** 2 + (c[2] - key[2]) ** 2


def remove_key_color(img: Image.Image, key=MAGENTA_KEY, tol: int = KEY_TOLERANCE) -> Image.Image:
    """키 색(#FF00FF)과의 RGB 거리로 배경을 뚫는다. 알파는 곧장 0/255로 이진화한다."""
    rgba = img.convert("RGBA")
    limit = tol * tol
    px = pixels(rgba)
    out = [(p[0], p[1], p[2], 0) if _sq_dist(p[:3], key) <= limit else (p[0], p[1], p[2], 255) for p in px]
    rgba.putdata(out)
    return rgba


def binarize_alpha(img: Image.Image, cutoff: int = ALPHA_CUTOFF) -> Image.Image:
    """§1 '투명 배경과 맞닿는 외곽 AA 절대 금지' — 반투명을 남기지 않는다."""
    rgba = img.convert("RGBA")
    alpha = rgba.getchannel("A").point(lambda a: 255 if a >= cutoff else 0)
    rgba.putalpha(alpha)
    return rgba


# --------------------------------------- 1-b단계: 마젠타 실패 시 테두리 배경 폴백

# 「왜」 모델이 마젠타 지시를 무시하고 회색 스튜디오·베이지 배경을 그리는 일이 잦다.
#      그러면 키 제거가 거의 아무것도 못 지우고, 뒤의 양자화가 배경을 팔레트색으로
#      바꿔 놓아 눈에도 안 띈 채 QA를 통과한다. 커버리지가 낮으면 폴백을 돈다.
MIN_KEY_COVERAGE = 0.08     # 키 제거가 이보다 적게 지웠으면 '마젠타 배경이 아니었다'
BORDER_BAND = 3             # 테두리 색을 통계 낼 띠 두께(px)
FLOOD_BASE_TOL = 26         # 적응 임계의 하한
FLOOD_SPREAD_K = 2.2        # 테두리 색 분산에 곱하는 계수(그림자·비네트 흡수용)
FLOOD_MAX_TOL = 120
FLOOD_MIN_REMOVED = 0.04    # 이만큼도 못 지우면 폴백 실패로 본다
FLOOD_MAX_REMOVED = 0.92    # 이만큼 지웠으면 피사체까지 먹은 것으로 본다
FLOOD_LOCAL_TOL = 6         # 이웃 픽셀과의 국소 허용 거리(완만한 그라데이션만 따라간다)
FLOOD_CEILING_MARGIN = 60   # 시드색에서 이만큼 넘게 멀어지면 피사체로 보고 멈춘다
FLOOD_MIN_SHARE = 0.25      # 테두리가 이만큼도 한 색으로 안 덮이면 단색 배경이 아니다
FLOOD_SEED_RADIUS = 70      # 분산을 잴 때 '배경으로 볼' 최대 거리
ALREADY_CUT = 0.10          # 원본이 이미 이만큼 투명하면 배경은 처리된 것으로 본다


def _border_pixels(px: list, w: int, h: int, band: int = BORDER_BAND) -> list:
    """「왜」 이미 투명한 테두리 픽셀의 RGB는 의미 없는 값(대개 검정)이다. 통계에서 뺀다."""
    return [px[y * w + x] for y in range(h) for x in range(w)
            if (x < band or y < band or x >= w - band or y >= h - band)
            and px[y * w + x][3] >= 250]


def border_profile(img: Image.Image, band: int = BORDER_BAND) -> dict:
    """테두리 4변의 지배색과 그 색 주변의 분산을 낸다. 폴백 임계의 근거."""
    rgba = img.convert("RGBA")
    edge = _border_pixels(pixels(rgba), rgba.width, rgba.height, band)
    if not edge:
        return {"color": (0, 0, 0), "share": 0.0, "tolerance": FLOOD_BASE_TOL}
    color, share = _dominant_color(edge)
    return {"color": color, "share": share, "tolerance": _adaptive_tolerance(edge, color)}


def _dominant_color(edge: list) -> tuple[tuple[int, int, int], float]:
    """「왜」 그라데이션 배경은 정확히 같은 색이 아니다. 8단위 버킷으로 뭉쳐 최빈 덩어리를 찾는다."""
    buckets = Counter((p[0] // 8, p[1] // 8, p[2] // 8) for p in edge)
    key, count = buckets.most_common(1)[0]
    members = [p for p in edge if (p[0] // 8, p[1] // 8, p[2] // 8) == key]
    return (_mean_rgb(members), count / len(edge))


def _mean_rgb(members: list) -> tuple[int, int, int]:
    n = len(members)
    return tuple(int(round(sum(p[i] for p in members) / n)) for i in range(3))


def _adaptive_tolerance(edge: list, color: tuple[int, int, int]) -> int:
    """「왜」 테두리에는 피사체도 닿는다. 지배색 근처(=배경으로 볼 만한) 픽셀만으로 퍼짐을 재야
       그림자·비네트는 흡수하면서 피사체 색까지 임계에 끌어들이지 않는다."""
    near = sorted(d for d in (_sq_dist(p[:3], color) ** 0.5 for p in edge) if d <= FLOOD_SEED_RADIUS)
    if not near:
        return FLOOD_BASE_TOL
    cut = near[min(len(near) - 1, int(len(near) * 0.90))]
    return int(min(FLOOD_MAX_TOL, max(FLOOD_BASE_TOL, FLOOD_BASE_TOL + cut * FLOOD_SPREAD_K)))


def remove_border_background(img: Image.Image, profile: dict | None = None) -> tuple[Image.Image, float]:
    """테두리에 닿아 있는 배경색 영역만 flood-fill로 지운다. 내부의 같은 색은 살린다."""
    rgba = img.convert("RGBA")
    prof = profile or border_profile(rgba)
    px = pixels(rgba)
    removed = _flood_from_border(px, rgba.width, rgba.height, prof["color"], prof["tolerance"])
    rgba.putdata(px)
    return (rgba, removed / max(1, len(px)))


def _flood_from_border(px: list, w: int, h: int, color, tol: int) -> int:
    """「왜」 4방향 flood-fill이라 배경과 끊긴 내부 동색 픽셀(눈동자·금속면)은 보존된다."""
    seed = _limits(color, tol)
    seen = bytearray(len(px))
    queue = deque(i for i in _border_indices(w, h) if _matches(px[i], color, seed["tol"]))
    for i in queue:
        seen[i] = 1
    return _drain(queue, px, w, h, seed, seen)


def _limits(color, tol: int) -> dict:
    """「왜」 비네트가 있는 배경은 한 임계로 안 잡힌다. 국소 연속성으로 그라데이션을 따라가되,
       시드색에서 너무 멀어지지 않게 천장을 둔다 — 그 천장이 피사체로 새는 걸 막는다."""
    ceiling = min(FLOOD_MAX_TOL, tol + FLOOD_CEILING_MARGIN)
    return {"color": color, "tol": tol * tol,
            "local": FLOOD_LOCAL_TOL * FLOOD_LOCAL_TOL,
            "ceiling": ceiling * ceiling}


def _drain(queue: deque, px: list, w: int, h: int, seed: dict, seen: bytearray) -> int:
    removed = 0
    while queue:
        i = queue.popleft()
        here = px[i]
        px[i] = (here[0], here[1], here[2], 0)
        removed += 1
        _push_neighbors(queue, px, i, w, h, here, seed, seen)
    return removed


def _push_neighbors(queue: deque, px: list, i: int, w: int, h: int,
                    here, seed: dict, seen: bytearray) -> None:
    for n in _neighbors(i, w, h):
        if seen[n] or not _accepts(px[n], here, seed):
            continue
        seen[n] = 1
        queue.append(n)


def _accepts(pixel, here, seed: dict) -> bool:
    """시드색에 가깝거나(평평한 배경), 직전 픽셀과 국소 연속이면(그라데이션) 배경으로 본다."""
    far = _sq_dist(pixel[:3], seed["color"])
    if far <= seed["tol"]:
        return True
    if far > seed["ceiling"]:
        return False
    return _sq_dist(pixel[:3], here[:3]) <= seed["local"]


def _matches(pixel, color, limit: int) -> bool:
    return _sq_dist(pixel[:3], color) <= limit


def _border_indices(w: int, h: int) -> list[int]:
    top = [x for x in range(w)]
    bottom = [(h - 1) * w + x for x in range(w)]
    sides = [y * w + e for y in range(h) for e in (0, w - 1)]
    return top + bottom + sides


# ------------------------------------------------------- 타일 심리스화 (§8 지형)

# 「왜」 생성 모델은 "seamless"를 프롬프트로 시켜도 상하/좌우 랩을 맞춰 주지 않는다.
#      실측: desert 상하랩 44.5(내부 세로 38.5), grass 55.3(43.3). 게임에서 타일을 깔면
#      이 차이가 격자 줄무늬로 보인다. 그래서 후처리에서 기하적으로 강제한다.
SEAM_BAND = 7          # 가장자리에서 섞을 대역 폭(px). 64px 타일 기준
SEAM_MAX_ALPHA = 0.45  # 「왜」 0.5면 양 끝 줄이 완전히 같아져 2px 평평한 띠가 보인다. 살짝 남긴다
# 「왜」 매끈한 타일(잔잔한 물·평평한 눈)은 내부 인접 차이가 0에 가깝다. 그대로 나누면
#      눈에 보이지도 않는 몇 단위 차이가 무한대 비율이 된다. 분모에 바닥을 깐다.
SEAM_MIN_BASE = 4.0


def _cos_ramp(i: int, band: int, peak: float) -> float:
    """가장자리에서 peak, band 끝에서 0으로 부드럽게 떨어지는 코사인 가중."""
    if band <= 0:
        return 0.0
    return peak * 0.5 * (1.0 + math.cos(math.pi * i / band))


def _blend(a: tuple, b: tuple, w: float) -> tuple:
    return tuple(int(round(a[k] * (1 - w) + b[k] * w)) for k in range(3)) + (255,)


def _wrap_blend_axis(px: list, w: int, h: int, band: int, horizontal: bool) -> None:
    """한 축의 양 끝 대역을 서로 마주보게 섞는다(제자리 수정)."""
    span = w if horizontal else h
    limit = min(band, span // 2)
    for i in range(limit):
        weight = _cos_ramp(i, limit, SEAM_MAX_ALPHA)
        _mix_line_pair(px, w, h, i, span - 1 - i, weight, horizontal)


def _mix_line_pair(px: list, w: int, h: int, near: int, far: int,
                   weight: float, horizontal: bool) -> None:
    for k in range(h if horizontal else w):
        ia = _index(w, near, k, horizontal)
        ib = _index(w, far, k, horizontal)
        first, second = px[ia], px[ib]
        px[ia] = _blend(first, second, weight)
        px[ib] = _blend(second, first, weight)


def _index(w: int, along: int, across: int, horizontal: bool) -> int:
    if horizontal:
        return across * w + along
    return along * w + across


def make_seamless(img: Image.Image, band: int = SEAM_BAND) -> Image.Image:
    """좌우·상하 가장자리를 랩 크로스페이드해 타일이 이어지게 만든다."""
    rgba = img.convert("RGBA")
    px = pixels(rgba)
    _wrap_blend_axis(px, rgba.width, rgba.height, band, True)
    _wrap_blend_axis(px, rgba.width, rgba.height, band, False)
    rgba.putdata(px)
    return rgba


# ------------------------------------------------------- 심(seam) 측정 (공용)

def _line(px: list, w: int, h: int, at: int, horizontal: bool) -> list:
    span = h if horizontal else w
    return [px[_index(w, at, k, horizontal)][:3] for k in range(span)]


def _line_gap(a: list, b: list) -> float:
    """두 줄의 평균 RGB 유클리드 거리."""
    if not a:
        return 0.0
    return sum(_sq_dist(p, q) ** 0.5 for p, q in zip(a, b)) / len(a)


def _axis_stats(px: list, w: int, h: int, horizontal: bool) -> tuple[float, float]:
    """(랩 차이, 내부 인접 줄 평균 차이) — 내부 기준이 있어야 텍스처 노이즈와 구분된다."""
    span = w if horizontal else h
    wrap = _line_gap(_line(px, w, h, 0, horizontal), _line(px, w, h, span - 1, horizontal))
    inner = [_line_gap(_line(px, w, h, i, horizontal), _line(px, w, h, i + 1, horizontal))
             for i in range(span - 1)]
    return (wrap, sum(inner) / max(1, len(inner)))


def wrap_metrics(img: Image.Image) -> dict:
    """타일의 랩 심 수치. score는 축별 비율의 최댓값 — 한 축만 어긋나도 잡아야 한다."""
    rgba = img.convert("RGBA")
    px = pixels(rgba)
    lr, inner_x = _axis_stats(px, rgba.width, rgba.height, True)
    tb, inner_y = _axis_stats(px, rgba.width, rgba.height, False)
    ratio_x = lr / max(inner_x, SEAM_MIN_BASE)
    ratio_y = tb / max(inner_y, SEAM_MIN_BASE)
    return {"lr": round(lr, 2), "tb": round(tb, 2),
            "innerX": round(inner_x, 2), "innerY": round(inner_y, 2),
            "ratioX": round(ratio_x, 2), "ratioY": round(ratio_y, 2),
            "score": round(max(ratio_x, ratio_y), 2)}


# ------------------------------------------------------- 2단계: halo 제거

def _neighbors(idx: int, w: int, h: int) -> list[int]:
    x, y = idx % w, idx // w
    around = [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]
    return [ny * w + nx for nx, ny in around if 0 <= nx < w and 0 <= ny < h]


def strip_halo(img: Image.Image, key=MAGENTA_KEY, tol: int = HALO_TOLERANCE, rounds: int = 2) -> Image.Image:
    """실루엣 경계에 남은 마젠타 프린지를 라운드마다 1px씩 깎아낸다."""
    rgba = img.convert("RGBA")
    limit = tol * tol
    px = pixels(rgba)
    for _ in range(rounds):
        px = _strip_once(px, rgba.width, rgba.height, key, limit)
    rgba.putdata(px)
    return rgba


def _strip_once(px: list, w: int, h: int, key, limit: int) -> list:
    doomed = [i for i, p in enumerate(px) if p[3] == 255 and _is_fringe(px, i, w, h, key, limit)]
    for i in doomed:
        px[i] = (px[i][0], px[i][1], px[i][2], 0)
    return px


def _is_fringe(px: list, i: int, w: int, h: int, key, limit: int) -> bool:
    """투명과 맞닿아 있으면서 키 색에 가까운 픽셀 = 언믹싱 실패한 halo."""
    if _sq_dist(px[i][:3], key) > limit:
        return False
    return any(px[n][3] == 0 for n in _neighbors(i, w, h))


def despeckle(img: Image.Image, min_neighbors: int = 2) -> Image.Image:
    """§1 '노이즈성 단일 픽셀 흩뿌림 금지' — 고립 픽셀을 지운다."""
    rgba = img.convert("RGBA")
    px = pixels(rgba)
    w, h = rgba.width, rgba.height
    lonely = [i for i, p in enumerate(px) if p[3] == 255 and _opaque_count(px, i, w, h) < min_neighbors]
    for i in lonely:
        px[i] = (px[i][0], px[i][1], px[i][2], 0)
    rgba.putdata(px)
    return rgba


def _opaque_count(px: list, i: int, w: int, h: int) -> int:
    return sum(1 for n in _neighbors(i, w, h) if px[n][3] == 255)


def bleed_rgb(img: Image.Image, rounds: int = 3) -> Image.Image:
    """「왜」 nearest 축소는 투명 픽셀의 RGB도 집어올 수 있다. 미리 색을 바깥으로 번지게 한다."""
    rgba = img.convert("RGBA")
    px = pixels(rgba)
    for _ in range(rounds):
        px = _bleed_once(px, rgba.width, rgba.height)
    rgba.putdata(px)
    return rgba


def _bleed_once(px: list, w: int, h: int) -> list:
    updates = {}
    for i, p in enumerate(px):
        if p[3] != 0:
            continue
        donor = next((px[n] for n in _neighbors(i, w, h) if px[n][3] == 255), None)
        if donor is not None:
            updates[i] = (donor[0], donor[1], donor[2], 0)
    for i, v in updates.items():
        px[i] = v
    return px


# ------------------------------------------------------------ 3단계: 콘텐츠 트림

def trim_content(img: Image.Image) -> Image.Image:
    """불투명 bbox로 자른다. 완전 투명이면 그대로 돌려준다(상위에서 실패 처리)."""
    rgba = img.convert("RGBA")
    box = rgba.getchannel("A").getbbox()
    if box is None:
        return rgba
    return rgba.crop(box)


# ------------------------------------------------- 4단계: 정수 다운스케일 (nearest)

def pick_factor(content: tuple[int, int], target: tuple[int, int]) -> int:
    """목표 콘텐츠 상자에 들어가는 가장 작은 정수 축소 배율. §6 '정수배만' 규칙."""
    cw, ch = content
    tw, th = target
    fw = -(-cw // max(tw, 1))
    fh = -(-ch // max(th, 1))
    return max(1, fw, fh)


def integer_downscale(img: Image.Image, factor: int, color_filter: str = "nearest") -> Image.Image:
    """색은 nearest(정본), 알파는 box+재이진화 — 실루엣 계단이 무너지는 걸 막는다."""
    if factor <= 1:
        return img.convert("RGBA")
    rgba = img.convert("RGBA")
    size = (max(1, rgba.width // factor), max(1, rgba.height // factor))
    small = rgba.convert("RGB").resize(size, _FILTERS[color_filter])
    alpha = rgba.getchannel("A").resize(size, Image.Resampling.BOX).point(lambda a: 255 if a >= ALPHA_CUTOFF else 0)
    small = small.convert("RGBA")
    small.putalpha(alpha)
    return small


_FILTERS = {"nearest": Image.Resampling.NEAREST, "box": Image.Resampling.BOX}


# --------------------------------------------------------- 5단계: 팔레트 양자화

def _palette_image(palette: list[tuple[int, int, int]]) -> Image.Image:
    """「왜」 남는 256칸을 (0,0,0)으로 두면 어두운 픽셀이 팔레트 밖 검정으로 빨려간다. 마지막 색으로 채운다."""
    flat: list[int] = []
    for c in palette:
        flat.extend(c)
    filler = palette[-1]
    flat.extend(list(filler) * (256 - len(palette)))
    pal = Image.new("P", (1, 1))
    pal.putpalette(flat)
    return pal


def color_budget(strength: float) -> int:
    """§2 '에셋 1점당 16~28색'. strength 1.0이면 16색까지 조인다."""
    clamped = min(1.0, max(0.0, strength))
    return int(round(28 - clamped * 12))


def quantize_to_palette(img: Image.Image, palette: list, strength: float = 0.5) -> Image.Image:
    """모든 불투명 픽셀을 마스터 팔레트로 스냅하고, strength만큼 색 수를 줄인다."""
    rgba = img.convert("RGBA")
    alpha = rgba.getchannel("A")
    indexed = rgba.convert("RGB").quantize(palette=_palette_image(palette), dither=Image.Dither.NONE)
    indexed = _reduce_colors(indexed, alpha, color_budget(strength), palette)
    out = indexed.convert("RGB").convert("RGBA")
    out.putalpha(alpha)
    return out


def _reduce_colors(indexed: Image.Image, alpha: Image.Image, budget: int, palette: list) -> Image.Image:
    """가장 적게 쓰인 색부터 이웃 색으로 흡수해 색 수를 예산 이하로 맞춘다."""
    used = Counter(i for i, a in zip(pixels(indexed), pixels(alpha)) if a == 255)
    if len(used) <= budget:
        return indexed
    keep = [idx for idx, _ in used.most_common(budget)]
    lut = {idx: _nearest_kept(idx, keep, palette) for idx in used if idx not in keep}
    indexed.putdata([lut.get(i, i) for i in pixels(indexed)])
    return indexed


def _nearest_kept(idx: int, keep: list[int], palette: list) -> int:
    src = palette[idx] if idx < len(palette) else palette[-1]
    return min(keep, key=lambda k: _sq_dist(src, palette[k] if k < len(palette) else palette[-1]))


# --------------------------------------------------------- 6단계: 앵커 배치

def place_on_canvas(content: Image.Image, canvas: tuple[int, int], anchor: str, margin: int = 0) -> Image.Image:
    """§8 '앵커 하단 중앙 고정'. 아이콘류는 중앙 정렬한다."""
    sheet = Image.new("RGBA", canvas, (0, 0, 0, 0))
    fitted = _fit_into(content, canvas)
    x = (canvas[0] - fitted.width) // 2
    y = _anchor_y(fitted.height, canvas[1], anchor, margin)
    sheet.alpha_composite(fitted, (max(0, x), max(0, y)))
    return sheet


def _fit_into(content: Image.Image, canvas: tuple[int, int]) -> Image.Image:
    """「왜」 정수 배율 제약으로 콘텐츠가 캔버스보다 큰 경우가 생긴다. 중앙 기준으로 잘라 넣는다."""
    if content.width <= canvas[0] and content.height <= canvas[1]:
        return content
    left = max(0, (content.width - canvas[0]) // 2)
    top = max(0, content.height - canvas[1])
    return content.crop((left, top, left + min(content.width, canvas[0]), top + min(content.height, canvas[1])))


def _anchor_y(ch: int, canvas_h: int, anchor: str, margin: int) -> int:
    if anchor == "center":
        return (canvas_h - ch) // 2
    return canvas_h - ch - margin


# ------------------------------------------------------------------ 오케스트레이션

def process_image(src: Path, dst: Path, spec: dict, options: dict | None = None) -> dict:
    """후보 1장을 아트바이블 규격 PNG로 굽는다. 반환값은 리포트(축소 배율·콘텐츠 크기 등)."""
    opts = _merged_options(options)
    # 「왜」 윈도우는 열린 핸들이 남으면 out/ 폴더 삭제가 실패한다. with로 즉시 닫는다.
    with Image.open(src) as handle:
        raw = handle.convert("RGBA")
    if spec["anchor"] == "fill":
        return _process_tile(raw, dst, spec, opts)
    return _process_sprite(raw, dst, spec, opts)


def _merged_options(options: dict | None) -> dict:
    base = {
        "key": MAGENTA_KEY, "key_tolerance": KEY_TOLERANCE, "halo_tolerance": HALO_TOLERANCE,
        "halo_rounds": 2, "quantize_strength": 0.5, "downscale_filter": "nearest",
        "margin": 0, "palette": None, "root": None,
    }
    base.update(options or {})
    if base["palette"] is None:
        base["palette"] = load_palette(base["root"])
    return base


def _process_sprite(raw: Image.Image, dst: Path, spec: dict, opts: dict) -> dict:
    """캐릭터·오브젝트·아이콘 경로: 배경 제거 → 트림 → 정수 축소 → 양자화 → 앵커."""
    cleaned, fallback = _clean_background(raw, opts)
    trimmed = trim_content(cleaned)
    if trimmed.getchannel("A").getbbox() is None:
        raise ValueError(f"{src_name(dst)}: 배경을 지우고 나니 남은 픽셀이 없습니다 — 마젠타 배경 프롬프트나 임계값을 확인하세요.")
    factor = pick_factor(trimmed.size, _target_box(spec))
    small = integer_downscale(trimmed, factor, opts["downscale_filter"])
    small = trim_content(quantize_to_palette(small, opts["palette"], opts["quantize_strength"]))
    final = place_on_canvas(small, spec["canvas"], spec["anchor"], opts["margin"])
    return _write_report(final, dst, factor, small.size, spec, fallback)


def _process_tile(raw: Image.Image, dst: Path, spec: dict, opts: dict) -> dict:
    """타일 경로: 심리스라 트림·앵커가 없다. 축소 → 랩 크로스페이드 → 양자화."""
    cw, chh = spec["canvas"]
    factor = pick_factor(raw.size, (cw, chh))
    small = integer_downscale(raw.convert("RGBA"), factor, opts["downscale_filter"])
    small = small.resize((cw, chh), Image.Resampling.NEAREST)
    final, seam = _seamless_pass(small, opts)
    final.putalpha(255)   # 「왜」 지형 타일은 전면 불투명이 규격이다(§8 외곽선 없음).
    report = _write_report(final, dst, factor, final.size, spec, False)
    report["seam"] = seam
    return report


def _seamless_pass(small: Image.Image, opts: dict) -> tuple[Image.Image, dict]:
    """심리스화 전/후 랩 수치를 함께 돌려준다. 「왜」 개선됐는지 사람이 눈으로 확인해야 한다."""
    before = wrap_metrics(small)
    if not opts.get("seamless", True):
        return (quantize_to_palette(small, opts["palette"], opts["quantize_strength"]),
                {"applied": False, "before": before, "after": before})
    blended = make_seamless(small, opts.get("seam_band", SEAM_BAND))
    # 「왜」 블렌드는 팔레트 밖 중간색을 만든다. 기존 양자화로 다시 팔레트에 스냅한다.
    final = quantize_to_palette(blended, opts["palette"], opts["quantize_strength"])
    return (final, {"applied": True, "before": before, "after": wrap_metrics(final)})


def _clean_background(raw: Image.Image, opts: dict) -> tuple[Image.Image, bool]:
    """배경을 지우고, 마젠타가 아니라 테두리 폴백을 썼는지 여부를 함께 돌려준다."""
    keyed, coverage = _key_pass(raw, opts)
    keyed, fallback = _fallback_if_needed(raw, keyed, coverage, opts)
    early = trim_content(keyed)  # 「왜」 halo 검사는 픽셀 단위라 먼저 여백을 버려 시간을 줄인다.
    haloed = strip_halo(early, opts["key"], opts["halo_tolerance"], opts["halo_rounds"])
    return (bleed_rgb(binarize_alpha(despeckle(haloed))), fallback)


def _key_pass(raw: Image.Image, opts: dict) -> tuple[Image.Image, float]:
    keyed = remove_key_color(raw, opts["key"], opts["key_tolerance"])
    cleared = sum(1 for a in pixels(keyed.getchannel("A")) if a == 0)
    return (keyed, cleared / max(1, raw.width * raw.height))


def _fallback_if_needed(raw: Image.Image, keyed: Image.Image,
                        coverage: float, opts: dict) -> tuple[Image.Image, bool]:
    """마젠타가 거의 안 지워졌으면 모델이 다른 배경을 그린 것이다. 테두리 색으로 다시 시도한다."""
    if coverage >= opts.get("min_key_coverage", MIN_KEY_COVERAGE):
        return (keyed, False)
    if _already_cut(raw) >= ALREADY_CUT:
        return (keyed, False)  # 「왜」 이미 배경이 빠진 PNG를 또 파내면 피사체가 깎인다.
    profile = border_profile(raw)
    if profile["share"] < FLOOD_MIN_SHARE:
        print(f"  ! 테두리가 단색이 아닙니다(지배색 점유 {profile['share']:.0%}) — 폴백을 건너뜁니다.")
        return (keyed, False)
    return _apply_fallback(raw, keyed, coverage, profile)


def _apply_fallback(raw: Image.Image, keyed: Image.Image,
                    coverage: float, profile: dict) -> tuple[Image.Image, bool]:
    flooded, removed = remove_border_background(raw, profile)
    if not FLOOD_MIN_REMOVED <= removed <= FLOOD_MAX_REMOVED:
        print(f"  ! 배경 폴백 실패(제거율 {removed:.1%}) — 마젠타 결과를 그대로 씁니다.")
        return (keyed, False)
    print(f"  ! 마젠타 배경이 아닙니다(키 제거 {coverage:.1%}) — "
          f"테두리색 {profile['color']} 임계 {profile['tolerance']}로 {removed:.1%} 제거")
    return (flooded, True)


def _already_cut(raw: Image.Image) -> float:
    """원본이 이미 투명 영역을 갖고 있는 비율."""
    if raw.mode != "RGBA":
        return 0.0
    alpha = pixels(raw.getchannel("A"))
    return sum(1 for a in alpha if a < 250) / max(1, len(alpha))


def _target_box(spec: dict) -> tuple[int, int]:
    """콘텐츠가 들어가야 할 최대 상자 — 가로는 캔버스 폭, 세로는 §8 콘텐츠 상한."""
    return (spec["canvas"][0], spec["content"][1])


def _write_report(final: Image.Image, dst: Path, factor: int, content: tuple[int, int],
                  spec: dict, bg_fallback: bool = False) -> dict:
    dst.parent.mkdir(parents=True, exist_ok=True)
    final.save(dst, "PNG", optimize=True)
    return {
        "path": str(dst), "canvas": list(final.size), "pixelSize": list(content),
        "factor": factor, "contentFit": _fit_note(content[1], spec),
        "bgFallback": bg_fallback,
    }


def _fit_note(height: int, spec: dict) -> str:
    lo, hi = spec["content"]
    if lo <= height <= hi:
        return "OK"
    return f"콘텐츠 높이 {height}px가 규격 {lo}~{hi}px를 벗어납니다(정수 배율 제약)."


def src_name(path: Path) -> str:
    return Path(path).name


# ------------------------------------------------------------------ 단독 실행 CLI

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="후보 PNG 1장을 아트바이블 규격으로 후처리한다.")
    p.add_argument("--src", required=True, help="입력 PNG (마젠타 배경)")
    p.add_argument("--dst", required=True, help="출력 PNG")
    p.add_argument("--category", required=True, choices=CATEGORIES)
    p.add_argument("--size", help="캔버스 강제 지정 (예: 160x160)")
    p.add_argument("--quantize-strength", type=float, default=0.5, help="0.0(28색)~1.0(16색)")
    p.add_argument("--downscale-filter", choices=tuple(_FILTERS), default="nearest")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    spec = category_spec(args.category, parse_size(args.size))
    opts = {"quantize_strength": args.quantize_strength, "downscale_filter": args.downscale_filter}
    report = process_image(Path(args.src), Path(args.dst), spec, opts)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
