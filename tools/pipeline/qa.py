#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""아트바이블 §11 검수 게이트 — 박물관 자동 QA(public/js/museum.js)와 동일 규칙·동일 임계값.

「왜」 파이썬(파이프라인)과 JS(박물관)가 같은 판정을 내려야 "여기선 PASS, 저기선 FAIL"이 안 생긴다.
     아래 THRESHOLDS·CATEGORY_SPEC·ANIM_FRAMES_* 는 museum.js의 동명 상수를 **1:1로 옮긴 것**이다.
     한쪽을 고치면 반드시 다른 쪽도 같이 고쳐야 한다.
「왜」 알고리즘도 museum.js와 같은 순서·같은 근사를 쓴다(불투명 기준 250, 런 길이 상한 16,
     외곽선 색 거리 10, 상/하 luma는 캔버스가 아니라 콘텐츠 bbox 중앙으로 가른다).
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from PIL import Image

import postprocess as pp

# ---------------------------------------------------------------- 임계값 정본

THRESHOLDS = {
    "paletteMatchDistance": 6,     # 마스터 색으로 인정하는 RGB 유클리드 거리
    "paletteWarn": 0.02, "paletteFail": 0.08,
    "translucentWarn": 0.01, "translucentFail": 0.05,
    "outlineMatchDistance": 10,    # 외곽선 허용색 판정 거리 (museum.js isOutlineColor)
    "outlineInkRatio": 0.70,       # 실루엣 경계의 70%+가 ink/램프0단
    "nightOverlay": (0x16, 0x21, 0x4a), "nightAlpha": 0.46, "nightMinLuma": 56,
    "sizeRatioTolerance": 0.25,
    # 「왜」 생성 모델이 마젠타를 무시하고 다른 단색 배경을 그리면 양자화가 그 배경을
    #      팔레트색으로 바꿔 놓아 다른 검사에 전혀 안 걸린다. 테두리 링으로 직접 잡는다.
    "borderRingBand": 2,
    "backgroundResidueWarn": 0.02, "backgroundResidueFail": 0.05,
    # 「왜」 타일은 랩(좌↔우, 상↔하)이 내부 인접 줄만큼 이어져야 격자 줄무늬가 안 보인다.
    #      절대값이 아니라 '내부 텍스처 노이즈 대비 비율'로 재야 잔디처럼 거친 텍스처가 억울하지 않다.
    "seamWarn": 1.4, "seamFail": 2.0,
    "opaqueAlpha": 250,            # museum.js OPAQUE_A
    "runLengthCap": 16,            # 대면적 단색을 그리드 추정에서 제외
    "gridDivisibleRatio": 0.80,
}

PASS, WARNING, FAIL, SKIP = "PASS", "WARNING", "FAIL", "SKIP"
_RANK = {PASS: 0, SKIP: 0, WARNING: 1, FAIL: 2}

# museum.js CATEGORY_SPEC 사본 — 해상도·크기비율 검사의 근거(아트바이블 §8).
_ICON = {"sizes": [(64, 64)], "contentH": (48, 56), "outline": True}
CATEGORY_SPEC: dict[str, dict] = {
    "player":     {"sizes": [(128, 128)], "contentH": (96, 112), "outline": True},
    "npc":        {"sizes": [(96, 128), (128, 128)], "contentH": (80, 112), "outline": True},
    "monster":    {"sizes": [(128, 128), (160, 160), (256, 256)], "contentH": (96, 192), "outline": True,
                   "subs": {"normal": {"sizes": [(128, 128)], "contentH": (96, 112)},
                            "elite": {"sizes": [(160, 160)], "contentH": (128, 144)},
                            "boss": {"sizes": [(256, 256)], "contentH": (192, 248)}}},
    "animal":     {"sizes": [(96, 96), (128, 128)], "contentH": (40, 112), "outline": True},
    "weapon": _ICON, "armor": _ICON, "food": _ICON, "consumable": _ICON, "material": _ICON,
    "mineral":    {"sizes": [(64, 64), (96, 96)], "contentH": (48, 88), "outline": True},
    "tree":       {"sizes": [(128, 192)], "contentH": (120, 192), "outline": True},
    "plant":      {"sizes": [(64, 64)], "contentH": (20, 60), "outline": True},
    "furniture":  {"sizes": [(96, 96), (128, 128)], "contentH": (40, 120), "outline": True},
    "building":   {"sizes": [(64, 96), (128, 176), (128, 224), (192, 256), (192, 304), (256, 352)],
                   "contentH": (64, 344), "outline": True},
    "tileset":    {"sizes": [(64, 64)], "contentH": (64, 64), "outline": False},
    "ui":         {"sizes": [(64, 64)], "contentH": (32, 64), "outline": True},
    "effect":     {"sizes": [(128, 128)], "contentH": (32, 128), "outline": False},
    "portrait":   {"sizes": [(96, 96), (176, 176)], "contentH": (72, 176), "outline": True},
}

# museum.js ANIM_FRAMES_* 사본 — 아트바이블 §9 권장 프레임 수.
ANIM_FRAMES_CHAR = {"idle": 6, "walk": 8, "run": 8, "attack": 6, "gather": 6, "craft": 6, "hit": 3, "death": 8}
ANIM_FRAMES_MONSTER = {"idle": 4, "walk": 6, "run": 6, "attack": 6, "hit": 3, "death": 8}


def worst(statuses: list[str]) -> str:
    """museum.js rollup — FAIL 하나면 FAIL, WARNING 하나면 WARNING."""
    return max(statuses, key=lambda s: _RANK[s]) if statuses else PASS


def spec_for(category: str, subcategory: str | None = None) -> dict | None:
    """카테고리 규격을 찾고, subcategory 오버라이드가 있으면 덮어쓴다."""
    base = CATEGORY_SPEC.get(category)
    if base is None:
        return None
    sub = (base.get("subs") or {}).get(str(subcategory or "").lower())
    if sub is None:
        return base
    return {**base, **sub}


# ---------------------------------------------------------------- 색 유틸

def luma(c) -> float:
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def _is_opaque(alpha: int) -> bool:
    return alpha >= THRESHOLDS["opaqueAlpha"]


def outline_colors(root: Path | None = None) -> list[tuple[int, int, int]]:
    """외곽선 허용색 = 모든 램프의 0단 + ink 램프 전체 (museum.js outlineAllowed와 동일)."""
    base = root or pp.project_root()
    data = json.loads((base / pp.PALETTE_REL).read_text(encoding="utf-8"))
    allowed = {pp._hex_to_rgb(h) for h in data["ramps"]["ink"]}
    allowed |= {pp._hex_to_rgb(ramp[0]) for ramp in data["ramps"].values()}
    return sorted(allowed)


def _within(c, palette, distance: int) -> bool:
    limit = distance * distance
    return any(pp._sq_dist(c, q) <= limit for q in palette)


# ---------------------------------------------------------------- 1회 스캔 지표

def scan(img: Image.Image, palette: list, outline: list) -> dict:
    """museum.js analyzeImage 대응 — 한 번 훑어 QA에 필요한 모든 수치를 모은다."""
    px = pp.pixels(img)
    acc = _fresh_acc(img.size)
    for index, p in enumerate(px):
        _accumulate(acc, p, index // img.width)
    return _finish(acc, px, img.size, palette, outline)


def _fresh_acc(size: tuple[int, int]) -> dict:
    return {"w": size[0], "h": size[1], "opaque": 0, "semi": 0,
            "minY": size[1], "maxY": -1, "rows": [], "colors": Counter()}


def _accumulate(acc: dict, p, y: int) -> None:
    if p[3] == 0:
        return
    acc["semi"] += 1 if p[3] < 255 else 0
    acc["minY"] = min(acc["minY"], y)
    acc["maxY"] = max(acc["maxY"], y)
    if not _is_opaque(p[3]):
        return
    acc["opaque"] += 1
    acc["colors"][p[:3]] += 1
    acc["rows"].append((y, luma(p[:3])))


def _finish(acc: dict, px: list, size: tuple[int, int], palette: list, outline: list) -> dict:
    denom = max(1, acc["opaque"] + acc["semi"])
    violate = sum(n for c, n in acc["colors"].items()
                  if not _within(c, palette, THRESHOLDS["paletteMatchDistance"]))
    top, bottom = _split_luma(acc["rows"], acc["minY"], acc["maxY"])
    return {
        "size": size, "opaque": acc["opaque"], "colorCount": len(acc["colors"]),
        "semiRate": acc["semi"] / denom,
        "violateRate": violate / max(1, acc["opaque"]),
        "nightLuma": _mean_night(acc["colors"]),
        "topLuma": top, "botLuma": bottom,
        "grid": estimate_grid(px, size),
        "outlineRatio": _outline_ratio(px, size, outline),
    }


def _split_luma(rows: list, min_y: int, max_y: int) -> tuple[float, float]:
    """「왜」 museum.js는 캔버스가 아니라 **콘텐츠 bbox 중앙**으로 상/하를 가른다."""
    mid = (min_y + max_y) / 2
    top = [l for y, l in rows if y <= mid]
    bottom = [l for y, l in rows if y > mid]
    return (_mean(top), _mean(bottom))


def _mean(values: list) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def _mean_night(colors: Counter) -> float:
    total = sum(colors.values())
    if total == 0:
        return 0.0
    return sum(luma(_night_blend(c)) * n for c, n in colors.items()) / total


def _night_blend(c) -> tuple[float, float, float]:
    """§3 밤 오버레이(#16214a alpha 0.46 multiply) — museum.js nightPixel과 동일 식."""
    a = THRESHOLDS["nightAlpha"]
    ov = THRESHOLDS["nightOverlay"]
    return tuple(ch * (1 - a) + (ch * ov[i] / 255.0) * a for i, ch in enumerate(c))


# ---------------------------------------------------------------- 픽셀 그리드

def estimate_grid(px: list, size: tuple[int, int]) -> int:
    """museum.js estimateGrid — 가로/세로 런 최빈값의 min, 80% 정합일 때만 인정."""
    horizontal = _collect_runs(px, size, True)
    vertical = _collect_runs(px, size, False)
    if not horizontal or not vertical:
        return 1
    grid = min(_mode(horizontal), _mode(vertical))
    if grid < 2:
        return 1
    return _confirm_grid(horizontal + vertical, grid)


def _confirm_grid(runs: list[int], grid: int) -> int:
    ratio = sum(1 for v in runs if v % grid == 0) / len(runs)
    if ratio >= THRESHOLDS["gridDivisibleRatio"]:
        return grid
    return 1


def _collect_runs(px: list, size: tuple[int, int], horizontal: bool) -> list[int]:
    w, h = size
    outer, inner = (h, w) if horizontal else (w, h)
    runs: list[int] = []
    for o in range(outer):
        _scan_line(px, w, o, inner, horizontal, runs)
    return runs


def _scan_line(px: list, w: int, o: int, inner: int, horizontal: bool, runs: list[int]) -> None:
    prev, run = None, 0
    for n in range(inner):
        key = _run_key(px, w, o, n, horizontal)
        if key != prev:
            _push_run(runs, prev, run)
            prev, run = key, 0
        run += 1
    _push_run(runs, prev, run)


def _run_key(px: list, w: int, o: int, n: int, horizontal: bool):
    x, y = (n, o) if horizontal else (o, n)
    p = px[y * w + x]
    if not _is_opaque(p[3]):
        return None
    return p[:3]


def _push_run(runs: list[int], key, run: int) -> None:
    """「왜」 투명 런과 대면적 단색(>16px)은 그리드 추정에 노이즈라 버린다."""
    if key is None or run <= 0 or run > THRESHOLDS["runLengthCap"]:
        return
    runs.append(run)


def _mode(values: list[int]) -> int:
    return Counter(values).most_common(1)[0][0]


# ---------------------------------------------------------------- 외곽선

def _outline_ratio(px: list, size: tuple[int, int], allowed: list) -> float:
    edge = _silhouette_edge(px, size)
    if not edge:
        return 0.0
    dist = THRESHOLDS["outlineMatchDistance"]
    return sum(1 for c in edge if _within(c, allowed, dist)) / len(edge)


def _silhouette_edge(px: list, size: tuple[int, int]) -> list:
    w, h = size
    return [px[i][:3] for i in range(len(px)) if _is_opaque(px[i][3]) and _touches_void(px, i, w, h)]


def _touches_void(px: list, i: int, w: int, h: int) -> bool:
    x, y = i % w, i // w
    if x in (0, w - 1) or y in (0, h - 1):
        return True
    return any(not _is_opaque(px[n][3]) for n in pp._neighbors(i, w, h))


# ---------------------------------------------------------------- 개별 검사

def check_palette(m: dict) -> dict:
    """마스터 팔레트 밖 색 비율. §11 >2% WARNING, >8% FAIL."""
    r = m["violateRate"]
    return _result(_ratio_status(r, "paletteWarn", "paletteFail"),
                   f"마스터 외 색 {_pct(r)} · 사용색 {m['colorCount']}", r)


def check_translucent(m: dict) -> dict:
    """0<a<255 비율(분모는 불투명+반투명). §1 외곽 AA 금지. >1% W, >5% F."""
    r = m["semiRate"]
    return _result(_ratio_status(r, "translucentWarn", "translucentFail"), f"반투명 {_pct(r)}", r)


def check_resolution(m: dict, spec: dict | None) -> dict:
    """§8 카테고리 규격 캔버스 목록에 들어가는지."""
    if spec is None:
        return _result(SKIP, "카테고리 규격 미정의", None)
    if tuple(m["size"]) in [tuple(s) for s in spec["sizes"]]:
        return _result(PASS, f"{m['size'][0]}×{m['size'][1]} — 규격 일치", list(m["size"]))
    want = " / ".join(f"{a}×{b}" for a, b in spec["sizes"])
    return _result(FAIL, f"{m['size'][0]}×{m['size'][1]} — 규격 {want} 아님", list(m["size"]))


def check_pixel_grid(m: dict) -> dict:
    """§6 픽셀 밀도 — 추정 그리드가 1px이 아니면 업스케일 원본 의심(WARNING)."""
    if m["grid"] <= 1:
        return _result(PASS, "추정 그리드 1px — 1에셋 1그리드", 1)
    return _result(WARNING, f"추정 그리드 {m['grid']}px — 업스케일 원본 의심", m["grid"])


def check_outline(m: dict, spec: dict | None) -> dict:
    """§5 실루엣 경계 픽셀의 70%+가 ink/램프0단인지. 타일·이펙트는 외곽선 없음이 정상."""
    if spec is not None and spec.get("outline") is False:
        return _result(SKIP, "외곽선 없는 카테고리", None)
    r = m["outlineRatio"]
    status = PASS if r >= THRESHOLDS["outlineInkRatio"] else WARNING
    return _result(status, f"경계 ink/램프0단 비율 {_pct(r)}", r)


def check_light(m: dict) -> dict:
    """§4 상반부가 하반부보다 밝아야 한다(좌상단 45° 광원)."""
    diff = m["topLuma"] - m["botLuma"]
    detail = f"상 {m['topLuma']:.1f} / 하 {m['botLuma']:.1f}"
    if diff <= 0:
        return _result(WARNING, detail + " — 상반부가 더 어둡다(좌상 45° 위반 의심)", round(diff, 1))
    return _result(PASS, detail, round(diff, 1))


def check_night(m: dict) -> dict:
    """§3 밤 합성 후 불투명 평균 luma가 56 미만이면 FAIL."""
    v = m["nightLuma"]
    floor = THRESHOLDS["nightMinLuma"]
    if v < floor:
        return _result(FAIL, f"밤 합성 후 평균 luma {v:.1f} (<{floor})", round(v, 1))
    return _result(PASS, f"밤 합성 후 {v:.1f} ≥ {floor}", round(v, 1))


def check_size_ratio(m: dict, content_h: int, spec: dict | None) -> dict:
    """§8 콘텐츠 높이가 카테고리 기준 ±25% 밖이면 WARNING."""
    if spec is None:
        return _result(SKIP, "기준 없음", content_h)
    lo, hi = spec["contentH"]
    tol = THRESHOLDS["sizeRatioTolerance"]
    detail = f"콘텐츠 높이 {content_h}px · 기준 {lo}~{hi}px"
    if lo * (1 - tol) <= content_h <= hi * (1 + tol):
        return _result(PASS, detail, content_h)
    return _result(WARNING, detail + " (±25% 밖)", content_h)


def check_frames(sheet_path: Path | None, frames: dict | None, category: str) -> dict:
    """시트가 프레임 크기의 정수배인지, row/count가 시트 안에 들어가는지, 권장 프레임 수인지."""
    if not frames:
        return _result(SKIP, "정지 에셋(frames 없음)", None)
    if sheet_path is None or not Path(sheet_path).exists():
        return _result(FAIL, "시트 이미지를 불러오지 못했다", None)
    with Image.open(sheet_path) as sheet:
        size = sheet.size
    return _frame_verdict(size, frames, category)


def _frame_verdict(size: tuple[int, int], frames: dict, category: str) -> dict:
    fw, fh = frames.get("frameW", 0), frames.get("frameH", 0)
    bad = _frame_errors(size, fw, fh)
    cols = size[0] // fw if fw else 0
    rows = size[1] // fh if fh else 0
    warn = _frame_warnings(frames, cols, rows, bad, category)
    if bad:
        return _result(FAIL, " · ".join(bad), None)
    if warn:
        return _result(WARNING, " · ".join(warn), None)
    return _result(PASS, f"{cols}열 × {rows}행 · {len(frames.get('anims') or {})}개 애니 정합", None)


def _frame_errors(size: tuple[int, int], fw: int, fh: int) -> list[str]:
    if fw <= 0 or fh <= 0:
        return [f"frameW/frameH가 잘못됐다 ({fw}x{fh})"]
    bad = []
    if size[0] % fw:
        bad.append(f"가로 {size[0]}가 frameW {fw}의 배수 아님")
    if size[1] % fh:
        bad.append(f"세로 {size[1]}가 frameH {fh}의 배수 아님")
    return bad


def _frame_warnings(frames: dict, cols: int, rows: int, bad: list[str], category: str) -> list[str]:
    table = ANIM_FRAMES_MONSTER if category == "monster" else ANIM_FRAMES_CHAR
    warn = []
    for name, a in (frames.get("anims") or {}).items():
        _check_one_anim(name, a, cols, rows, bad, warn, table.get(name))
    return warn


def _check_one_anim(name: str, a: dict, cols: int, rows: int, bad: list, warn: list, want) -> None:
    if a.get("row", 0) >= rows:
        bad.append(f"{name}: row {a.get('row')} ≥ 행수 {rows}")
    if a.get("count", 0) > cols:
        bad.append(f"{name}: count {a.get('count')} > 열수 {cols}")
    if want and a.get("count") != want:
        warn.append(f"{name} {a.get('count')}프레임(권장 {want})")


def _ratio_status(ratio: float, warn_key: str, fail_key: str) -> str:
    if ratio > THRESHOLDS[fail_key]:
        return FAIL
    if ratio > THRESHOLDS[warn_key]:
        return WARNING
    return PASS


def _result(status: str, detail: str, value) -> dict:
    return {"status": status, "detail": detail, "value": value}


def _pct(v: float) -> str:
    return f"{v * 100:.2f}%"


# ------------------------------------------------------------- 배경 잔존 검사

# 「왜」 museum.js에는 없는 파이프라인 전용 검사다(박물관은 PASS인데 여기선 FAIL일 수 있다).
#      아트바이블 §10은 배경 없는 PNG를 요구하므로 이건 반려 사유(FAIL)로 둔다.

def _ring_indices(size: tuple[int, int], anchor: str, band: int) -> list[int]:
    """캔버스 테두리 링. 하단 앵커 카테고리는 **바닥 변을 뺀다** — 발이 닿는 게 정상이다."""
    w, h = size
    rows = range(h - band, h) if anchor != "bottom" else range(0)
    idx = [y * w + x for y in range(band) for x in range(w)]
    idx += [y * w + x for y in rows for x in range(w)]
    idx += [y * w + x for y in range(band, h - band) for x in _side_columns(w, band)]
    return idx


def _side_columns(w: int, band: int) -> list[int]:
    return list(range(band)) + list(range(w - band, w))


def check_background_residue(img: Image.Image, category: str) -> dict:
    """테두리 링의 불투명 비율로 '지워지지 않은 배경'을 잡는다."""
    anchor = pp.CATEGORY_SPECS.get(category, {}).get("anchor", "bottom")
    if anchor == "fill":
        return _result(SKIP, "타일은 배경 제거 대상이 아닙니다.", None)
    px = pp.pixels(img)
    ring = [px[i] for i in _ring_indices(img.size, anchor, THRESHOLDS["borderRingBand"])]
    if not ring:
        return _result(SKIP, "링을 잴 수 없는 캔버스입니다.", None)
    return _residue_verdict(ring, anchor)


def _residue_verdict(ring: list, anchor: str) -> dict:
    opaque = [p[:3] for p in ring if p[3] >= THRESHOLDS["opaqueAlpha"]]
    ratio = len(opaque) / len(ring)
    where = "상/좌/우" if anchor == "bottom" else "4변"
    detail = f"테두리({where}) 불투명 {_pct(ratio)}{_dominant_note(opaque)}"
    return _result(_ratio_status(ratio, "backgroundResidueWarn", "backgroundResidueFail"), detail, ratio)


def _dominant_note(opaque: list) -> str:
    """「왜」 한 색이 링을 덮고 있으면 '피사체가 닿은 것'이 아니라 배경이다. 근거를 남긴다."""
    if not opaque:
        return ""
    color, count = Counter(opaque).most_common(1)[0]
    hexed = "#%02x%02x%02x" % color
    return f" · 지배색 {hexed} 점유 {count / len(opaque):.0%}"


# ------------------------------------------------------------- 타일 심(seam) 검사

def check_seam(img: Image.Image, category: str) -> dict:
    """타일 전용 — 랩 차이가 내부 인접 줄 대비 얼마나 큰지. 스프라이트는 대상이 아니다."""
    anchor = pp.CATEGORY_SPECS.get(category, {}).get("anchor", "bottom")
    if anchor != "fill":
        return _result(SKIP, "타일이 아닌 카테고리입니다.", None)
    m = pp.wrap_metrics(img)
    detail = (f"랩 좌우 {m['lr']}/내부 {m['innerX']} (비 {m['ratioX']}) · "
              f"랩 상하 {m['tb']}/내부 {m['innerY']} (비 {m['ratioY']})")
    return _result(_seam_status(m["score"]), detail, m)


def _seam_status(score: float) -> str:
    if score > THRESHOLDS["seamFail"]:
        return FAIL
    if score > THRESHOLDS["seamWarn"]:
        return WARNING
    return PASS


# ------------------------------------------------------- 프레임 일관성 (애니 전용)

# 「왜」 museum.js는 프레임을 서로 비교하지 않는다(정지 이미지 1장만 분석). 이 검사는
#      파이프라인 전용 확장이며, 절대 FAIL을 내지 않는다 — 박물관 판정과 어긋나도
#      게이트를 막지 않기 위해서다. 판정 등급은 WARNING까지만.
CONSISTENCY = {
    "identityIouMin": 0.45,   # 캐릭터: 연속 프레임 실루엣 IoU가 이보다 낮으면 정체성 흔들림
    "motionIouMax": 0.92,     # 캐릭터: 너무 같으면 움직임이 안 읽힌다
    "effectIouMax": 0.80,     # §7 이펙트는 프레임마다 실루엣 30%+ 변화가 규칙
    "colorDriftMax": 0.18,    # 색 분포 L1 거리 평균 상한
    "sizeDriftMax": 0.15,     # 콘텐츠 높이 표준편차 / 평균
    # 「왜」 불꽃은 프레임마다 커졌다 작아지는 게 정상이다. 크기 편차 기준을 따로 헐겁게 둔다.
    "effectSizeDriftMax": 0.45,
}

# 이펙트성 카테고리는 '변화가 클수록 좋다'로 기준을 뒤집는다.
VOLATILE_CATEGORIES = ("effect",)


def _mask(img: Image.Image) -> list[bool]:
    return [p[3] >= THRESHOLDS["opaqueAlpha"] for p in pp.pixels(img)]


def silhouette_iou(a: Image.Image, b: Image.Image) -> float:
    """두 프레임 실루엣의 교집합/합집합. 1.0이면 완전히 같은 모양."""
    ma, mb = _mask(a), _mask(b)
    inter = sum(1 for x, y in zip(ma, mb) if x and y)
    union = sum(1 for x, y in zip(ma, mb) if x or y)
    if union == 0:
        return 1.0
    return inter / union


def color_drift(a: Image.Image, b: Image.Image) -> float:
    """색 분포(정규화 히스토그램) L1 거리의 절반 — 0이면 완전히 같은 색 구성."""
    ha, hb = _color_hist(a), _color_hist(b)
    keys = set(ha) | set(hb)
    return sum(abs(ha.get(k, 0.0) - hb.get(k, 0.0)) for k in keys) / 2


def _color_hist(img: Image.Image) -> dict:
    counts = Counter(p[:3] for p in pp.pixels(img) if p[3] >= THRESHOLDS["opaqueAlpha"])
    total = sum(counts.values())
    if total == 0:
        return {}
    return {c: n / total for c, n in counts.items()}


def _content_heights(frames: list[Image.Image]) -> list[int]:
    boxes = [f.getchannel("A").getbbox() for f in frames]
    return [(b[3] - b[1]) if b else 0 for b in boxes]


def check_frame_consistency(frames: list[Image.Image], category: str,
                            limits: dict | None = None) -> dict:
    """연속 프레임의 실루엣 IoU·색 분포·크기 편차를 재 애니메이션 품질을 보고한다."""
    if len(frames) < 2:
        return _result(SKIP, "비교할 프레임이 2장 미만입니다.", None)
    ious = [silhouette_iou(frames[i], frames[i + 1]) for i in range(len(frames) - 1)]
    drifts = [color_drift(frames[i], frames[i + 1]) for i in range(len(frames) - 1)]
    stats = _consistency_stats(ious, drifts, frames)
    return _consistency_verdict(stats, category, {**CONSISTENCY, **(limits or {})})


def _consistency_stats(ious: list[float], drifts: list[float], frames: list) -> dict:
    heights = _content_heights(frames)
    return {"iouMin": min(ious), "iouMean": _mean(ious), "iouMax": max(ious),
            "colorDrift": _mean(drifts), "sizeDrift": _rel_stdev(heights),
            "frames": len(frames)}


def _rel_stdev(values: list[int]) -> float:
    avg = _mean(values)
    if avg <= 0:
        return 0.0
    var = sum((v - avg) ** 2 for v in values) / len(values)
    return (var ** 0.5) / avg


def _consistency_verdict(s: dict, category: str, lim: dict) -> dict:
    problems = _consistency_problems(s, category, lim)
    detail = (f"IoU 최소 {s['iouMin']:.2f}/평균 {s['iouMean']:.2f}/최대 {s['iouMax']:.2f} · "
              f"색편차 {s['colorDrift']:.2f} · 크기편차 {s['sizeDrift']:.2f} · {s['frames']}프레임")
    if problems:
        return _result(WARNING, detail + " — " + " / ".join(problems), s)
    return _result(PASS, detail, s)


def _consistency_problems(s: dict, category: str, lim: dict) -> list[str]:
    if category in VOLATILE_CATEGORIES:
        return _volatile_problems(s, lim)
    return _identity_problems(s, lim)


def _identity_problems(s: dict, lim: dict) -> list[str]:
    """캐릭터·동물: 너무 달라도(정체성 붕괴) 너무 같아도(움직임 없음) 문제다."""
    out = []
    if s["iouMin"] < lim["identityIouMin"]:
        out.append(f"프레임 간 실루엣이 과하게 변합니다(IoU {s['iouMin']:.2f})")
    if s["iouMean"] > lim["motionIouMax"]:
        out.append(f"프레임 차이가 거의 없습니다(IoU {s['iouMean']:.2f}) — denoise를 올리세요")
    out.extend(_shared_problems(s, lim))
    return out


def _volatile_problems(s: dict, lim: dict) -> list[str]:
    """§7 이펙트: 프레임마다 실루엣 30% 이상 변해야 한다. 크기 변화는 허용 범위가 넓다."""
    out = []
    if s["iouMean"] > lim["effectIouMax"]:
        out.append(f"이펙트 실루엣 변화가 부족합니다(IoU {s['iouMean']:.2f}, §7은 30%+ 변화)")
    loose = {**lim, "sizeDriftMax": lim.get("effectSizeDriftMax", lim["sizeDriftMax"])}
    out.extend(_shared_problems(s, loose))
    return out


def _shared_problems(s: dict, lim: dict) -> list[str]:
    out = []
    if s["colorDrift"] > lim["colorDriftMax"]:
        out.append(f"프레임 간 색 구성이 흔들립니다({s['colorDrift']:.2f})")
    if s["sizeDrift"] > lim["sizeDriftMax"]:
        out.append(f"프레임마다 크기가 튑니다({s['sizeDrift']:.2f})")
    return out


# ---------------------------------------------------------------- 종합

CHECK_ORDER = ("palette", "translucent", "resolution", "pixelGrid",
               "outline", "light", "night", "frames", "sizeRatio",
               "backgroundResidue", "seamScore")

# museum.js가 계산할 수 없는(정지 1장 분석으로는 불가능한) 파이프라인 전용 검사 목록.
PIPELINE_ONLY_CHECKS = ("backgroundResidue", "seamScore", "frameConsistency")


def run_checks(png: Path, category: str, subcategory: str | None = None,
               sheet: Path | None = None, frames: dict | None = None,
               root: Path | None = None) -> dict:
    """에셋 1점에 §11 전 항목을 돌려 종합 판정을 만든다."""
    palette = pp.load_palette(root)
    with Image.open(png) as raw:
        img = raw.convert("RGBA")
    metrics = scan(img, palette, outline_colors(root))
    spec = spec_for(category, subcategory)
    box = img.getchannel("A").getbbox() or (0, 0, 0, 0)
    checks = _collect(metrics, spec, box, sheet, frames, category, img)
    return _summarize(checks, metrics, box)


def _collect(m: dict, spec, box, sheet, frames, category, img) -> dict:
    return {
        "palette": check_palette(m),
        "translucent": check_translucent(m),
        "resolution": check_resolution(m, spec),
        "pixelGrid": check_pixel_grid(m),
        "outline": check_outline(m, spec),
        "light": check_light(m),
        "night": check_night(m),
        "frames": check_frames(sheet, frames, category),
        "sizeRatio": check_size_ratio(m, box[3] - box[1], spec),
        "backgroundResidue": check_background_residue(img, category),
        "seamScore": check_seam(img, category),
    }


def _summarize(checks: dict, m: dict, box) -> dict:
    statuses = [checks[k]["status"] for k in CHECK_ORDER]
    return {
        "result": worst(statuses),
        "checks": {k: checks[k]["status"] for k in CHECK_ORDER},
        "details": {k: checks[k]["detail"] for k in CHECK_ORDER},
        "notes": "",
        "score": _score(statuses, m),
        "paletteUsed": m["colorCount"],
        "canvas": list(m["size"]),
        "pixelSize": [box[2] - box[0], box[3] - box[1]],
    }


def _score(statuses: list[str], m: dict) -> float:
    """후보 랭킹용 점수 — FAIL은 크게, WARNING은 작게 깎고 위반율로 잔여 순위를 가른다."""
    penalty = sum({PASS: 0.0, SKIP: 0.0, WARNING: 6.0, FAIL: 30.0}[s] for s in statuses)
    return round(100.0 - penalty - m["violateRate"] * 100 - m["semiRate"] * 50, 2)


# ---------------------------------------------------------------- CLI

def _load_meta(root: Path, asset_id: str) -> dict:
    meta = root / "public/assets" / asset_id / "meta.json"
    if not meta.exists():
        raise SystemExit(f"meta.json이 없습니다: {meta} — 먼저 generate.py로 생성·등록하세요.")
    return json.loads(meta.read_text(encoding="utf-8"))


def _resolve_target(args) -> dict:
    """--png 직접 지정 또는 --id로 등록된 에셋을 찾는다."""
    root = pp.project_root()
    if args.png:
        return {"png": Path(args.png), "category": args.category, "subcategory": args.subcategory,
                "sheet": Path(args.sheet) if args.sheet else None, "frames": None, "root": root}
    meta = _load_meta(root, args.id)
    folder = root / "public/assets" / args.id
    frames = meta.get("frames")
    return {"png": folder / meta.get("still", "base.png"), "category": meta["category"],
            "subcategory": meta.get("subcategory"),
            "sheet": folder / frames["sheet"] if frames else None,
            "frames": frames, "root": root}


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="아트바이블 §11 QA를 실행한다(박물관 QA와 동일 규칙).")
    p.add_argument("--id", help="등록된 에셋 id (예: monster/goblin_warrior)")
    p.add_argument("--png", help="직접 검사할 PNG 경로")
    p.add_argument("--category", choices=pp.CATEGORIES, help="--png 사용 시 필수")
    p.add_argument("--subcategory", help="규격 세분화 (예: monster의 normal/elite/boss)")
    p.add_argument("--sheet", help="스프라이트시트 PNG (선택)")
    p.add_argument("--json", action="store_true", help="JSON만 출력")
    p.add_argument("--strict", action="store_true", help="FAIL이면 종료 코드 1")
    return p


def _validate(args, parser) -> None:
    if not args.id and not args.png:
        parser.error("--id 또는 --png 중 하나는 필요합니다.")
    if args.png and not args.category:
        parser.error("--png를 쓸 때는 --category가 필요합니다.")


def print_report(asset_id: str, report: dict) -> None:
    print(f"# QA — {asset_id} : {report['result']} (점수 {report['score']})")
    for key in CHECK_ORDER:
        print(f"- {key}: {report['checks'][key]} — {report['details'][key]}")
    print(f"- 사용 색 수: {report['paletteUsed']} · 캔버스 {report['canvas']} · 콘텐츠 {report['pixelSize']}")


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    _validate(args, parser)
    t = _resolve_target(args)
    report = run_checks(t["png"], t["category"], t["subcategory"], t["sheet"], t["frames"], t["root"])
    _emit(args, report, t)
    return 1 if (args.strict and report["result"] == FAIL) else 0


def _emit(args, report: dict, target: dict) -> None:
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return
    print_report(args.id or str(target["png"]), report)


if __name__ == "__main__":
    sys.exit(main())
