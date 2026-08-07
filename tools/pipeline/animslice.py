#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""애니메이션 프레임 슬라이싱·정렬 — 내용 인식(content-aware) 방식.

「왜」 균등 그리드 슬라이싱은 실패한다: 생성 모델이 그리는 프레임은 폭이 제각각이고
     여백도 고르지 않아 1/N로 자르면 팔다리가 잘린다. 그래서 알파 점유 프로파일의
     '빈 골짜기'로 경계를 찾는 내용 인식 슬라이싱을 쓴다.
「왜」 정렬을 postprocess.process_image 반복으로 하지 않는 이유: 그 함수는 이미지마다
     축소 배율을 따로 고른다. 프레임마다 배율이 다르면 재생 중 캐릭터 크기가 튄다.
     여기서는 **전 프레임 공통 배율 1개**를 union bbox로 정하고 다 같이 줄인다.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

import postprocess as pp

# 「왜」 한 열의 불투명 픽셀이 이 비율 이하면 '빈 열'로 본다. 안티에일리어싱 잔재를 무시하기 위함.
EMPTY_COLUMN_RATIO = 0.004
MIN_GAP_PX = 3        # 이보다 짧은 빈 구간은 프레임 내부 틈으로 보고 무시
MIN_BAND_RATIO = 0.20  # 평균 밴드 폭의 20% 미만은 파편으로 보고 이웃에 흡수


# ------------------------------------------------------------------ 점유 프로파일

def occupancy(img: Image.Image, axis: str = "x") -> list[int]:
    """축별 불투명 픽셀 수 프로파일. 슬라이싱과 베이스라인 추정의 공통 재료."""
    alpha = img.convert("RGBA").getchannel("A")
    px = pp.pixels(alpha)
    w, h = img.size
    if axis == "x":
        return [sum(1 for y in range(h) if px[y * w + x] > 0) for x in range(w)]
    return [sum(1 for x in range(w) if px[y * w + x] > 0) for y in range(h)]


def _bands(profile: list[int], limit: int, min_gap: int) -> list[tuple[int, int]]:
    """점유가 limit를 넘는 구간(=콘텐츠 밴드)을 [start, end) 목록으로 돌려준다."""
    filled = [i for i, v in enumerate(profile) if v > limit]
    if not filled:
        return []
    return _group_runs(filled, min_gap)


def _group_runs(filled: list[int], min_gap: int) -> list[tuple[int, int]]:
    bands, start, prev = [], filled[0], filled[0]
    for i in filled[1:]:
        if i - prev > min_gap:
            bands.append((start, prev + 1))
            start = i
        prev = i
    bands.append((start, prev + 1))
    return bands


def _absorb_slivers(bands: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """「왜」 무기 끝·이펙트 파편이 별도 밴드로 잡히면 프레임 수가 부풀어 오른다. 이웃에 흡수한다."""
    if len(bands) < 2:
        return bands
    mean = sum(b - a for a, b in bands) / len(bands)
    floor = max(2, mean * MIN_BAND_RATIO)
    return _merge_small(bands, floor)


def _merge_small(bands: list[tuple[int, int]], floor: float) -> list[tuple[int, int]]:
    out = [bands[0]]
    for band in bands[1:]:
        if band[1] - band[0] < floor:
            out[-1] = (out[-1][0], band[1])
            continue
        out.append(band)
    return out


# ------------------------------------------------------------------ 개수 맞추기

def reconcile(bands: list[tuple[int, int]], expected: int | None) -> list[tuple[int, int]]:
    """검출 밴드 수를 기대 프레임 수에 맞춘다(모델이 요청한 장수를 안 지키는 일이 잦다)."""
    if not expected or not bands or len(bands) == expected:
        return bands
    if len(bands) > expected:
        return _merge_until(bands, expected)
    return _split_until(bands, expected)


def _merge_until(bands: list[tuple[int, int]], target: int) -> list[tuple[int, int]]:
    """간격이 가장 좁은 이웃끼리 합쳐 개수를 줄인다."""
    work = list(bands)
    while len(work) > target:
        gaps = [work[i + 1][0] - work[i][1] for i in range(len(work) - 1)]
        i = gaps.index(min(gaps))
        work[i:i + 2] = [(work[i][0], work[i + 1][1])]
    return work


def _split_until(bands: list[tuple[int, int]], target: int) -> list[tuple[int, int]]:
    """가장 넓은 밴드를 균등 분할해 개수를 늘린다(마지막 수단)."""
    work = list(bands)
    while len(work) < target:
        widths = [b - a for a, b in work]
        i = widths.index(max(widths))
        work[i:i + 1] = _halve(work[i])
    return work


def _halve(band: tuple[int, int]) -> list[tuple[int, int]]:
    mid = (band[0] + band[1]) // 2
    return [(band[0], mid), (mid, band[1])]


# ------------------------------------------------------------------ 슬라이싱

def slice_sheet(src: Image.Image, expected: int | None = None, opts: dict | None = None) -> list[dict]:
    """마젠타 배경 시트 1장 → 프레임 조각 목록. 각 항목은 이미지와 시트 내 좌표를 담는다."""
    cleaned = _clean(src, opts or {})
    rows = _row_bands(cleaned)
    out: list[dict] = []
    for row in rows:
        out.extend(_slice_row(cleaned, row, _row_quota(expected, len(rows))))
    return out


def _row_quota(expected: int | None, rows: int) -> int | None:
    """여러 행이면 기대 장수를 행 수로 나눠 각 행에 배분한다."""
    if not expected or rows <= 0:
        return expected
    return max(1, expected // rows)


def _row_bands(img: Image.Image) -> list[tuple[int, int]]:
    profile = occupancy(img, "y")
    limit = int(img.width * EMPTY_COLUMN_RATIO)
    bands = _absorb_slivers(_bands(profile, limit, MIN_GAP_PX))
    if not bands:
        return [(0, img.height)]
    return bands


def _slice_row(img: Image.Image, row: tuple[int, int], expected: int | None) -> list[dict]:
    strip = img.crop((0, row[0], img.width, row[1]))
    profile = occupancy(strip, "x")
    limit = int(strip.height * EMPTY_COLUMN_RATIO)
    bands = reconcile(_absorb_slivers(_bands(profile, limit, MIN_GAP_PX)), expected)
    return [_cut(strip, band, row) for band in bands]


def _cut(strip: Image.Image, band: tuple[int, int], row: tuple[int, int]) -> dict:
    """「왜」 베이스라인(발 위치)을 맞추려면 잘라내기 전 행 안에서의 세로 위치를 기억해야 한다."""
    piece = strip.crop((band[0], 0, band[1], strip.height))
    box = piece.getchannel("A").getbbox() or (0, 0, piece.width, piece.height)
    return {"image": piece.crop(box), "rowTop": row[0], "topInRow": box[1], "bottomInRow": box[3]}


def _clean(src: Image.Image, opts: dict) -> Image.Image:
    """배경 제거 + halo 절삭 + 알파 이진화 — postprocess와 같은 규칙을 재사용한다."""
    key = opts.get("key", pp.MAGENTA_KEY)
    keyed = pp.remove_key_color(src.convert("RGBA"), key, opts.get("key_tolerance", pp.KEY_TOLERANCE))
    haloed = pp.strip_halo(keyed, key, opts.get("halo_tolerance", pp.HALO_TOLERANCE), opts.get("halo_rounds", 2))
    return pp.binarize_alpha(pp.despeckle(haloed))


# ------------------------------------------------------------------ 공통 정렬

def align_frames(pieces: list[dict], spec: dict, opts: dict | None = None) -> list[Image.Image]:
    """프레임들을 **공통 배율·공통 캔버스**로 정렬한다. 재생 중 크기가 튀지 않게 하는 핵심."""
    o = _merged(opts)
    cleaned = [_ensure_clean(p, o) for p in pieces]
    factor = shared_factor([c["image"].size for c in cleaned], spec)
    shrunk = [_shrink(c, factor, o) for c in cleaned]
    baseline = _baseline(shrunk, o["align"])
    return [_place(s, spec, baseline, o) for s in shrunk]


def _merged(opts: dict | None) -> dict:
    base = {"quantize_strength": 0.5, "downscale_filter": "nearest", "align": "row",
            "margin": 0, "palette": None, "root": None,
            "key": pp.MAGENTA_KEY, "key_tolerance": pp.KEY_TOLERANCE,
            "halo_tolerance": pp.HALO_TOLERANCE, "halo_rounds": 2}
    base.update(opts or {})
    if base["palette"] is None:
        base["palette"] = pp.load_palette(base["root"])
    return base


def _ensure_clean(piece: dict, opts: dict) -> dict:
    """이미 슬라이싱에서 정리된 조각은 그대로, 원본 PNG는 여기서 배경을 지운다."""
    if piece.get("clean"):
        return piece
    trimmed = pp.trim_content(_clean(piece["image"], opts))
    return {**piece, "image": trimmed, "clean": True}


def shared_factor(sizes: list[tuple[int, int]], spec: dict) -> int:
    """전 프레임을 아우르는 union 크기로 배율 하나를 정한다(§6 정수배 유지)."""
    if not sizes:
        return 1
    union = (max(w for w, _ in sizes), max(h for _, h in sizes))
    return pp.pick_factor(union, (spec["canvas"][0], spec["content"][1]))


def _shrink(piece: dict, factor: int, opts: dict) -> dict:
    small = pp.integer_downscale(piece["image"], factor, opts["downscale_filter"])
    quantized = pp.quantize_to_palette(small, opts["palette"], opts["quantize_strength"])
    return {**piece, "image": pp.trim_content(quantized),
            "bottomInRow": piece.get("bottomInRow", 0) / factor}


def _baseline(shrunk: list[dict], mode: str) -> float | None:
    """「왜」 시트에서 잘라낸 프레임은 원래 발 높이가 서로 다르다. 공통 바닥을 잡아야 안 튄다."""
    if mode != "row":
        return None
    bottoms = [s.get("bottomInRow") for s in shrunk if s.get("bottomInRow")]
    if not bottoms:
        return None
    return max(bottoms)


def _place(piece: dict, spec: dict, baseline: float | None, opts: dict) -> Image.Image:
    margin = opts["margin"] + _lift(piece, baseline)
    return pp.place_on_canvas(piece["image"], tuple(spec["canvas"]), spec["anchor"], margin)


def _lift(piece: dict, baseline: float | None) -> int:
    """공통 바닥보다 위에서 끝난 프레임은 그만큼 띄워 상대 높이를 보존한다."""
    if baseline is None:
        return 0
    return max(0, int(round(baseline - piece.get("bottomInRow", baseline))))


# ------------------------------------------------------------------ 파일 입출력

def frames_from_sheet(src: Path, spec: dict, expected: int | None, opts: dict | None = None) -> list[Image.Image]:
    """시트 PNG 1장 → 정렬된 프레임 이미지 목록."""
    with Image.open(src) as handle:
        raw = handle.convert("RGBA")
    pieces = slice_sheet(raw, expected, opts)
    if not pieces:
        raise ValueError(f"{src.name}: 프레임을 찾지 못했습니다 — 마젠타 배경 위에 스프라이트가 그려졌는지 확인하세요.")
    return align_frames([{**p, "clean": True} for p in pieces], spec, opts)


def frames_from_images(paths: list[Path], spec: dict, opts: dict | None = None) -> list[Image.Image]:
    """개별 생성된 프레임 PNG 목록 → 정렬된 프레임 이미지 목록."""
    pieces = [{"image": _open(p)} for p in paths]
    merged = {**(opts or {})}
    merged.setdefault("align", "frame")  # 「왜」 따로 생성된 프레임은 공통 좌표계가 없다.
    return align_frames(pieces, spec, merged)


def _open(path: Path) -> Image.Image:
    with Image.open(path) as handle:
        return handle.convert("RGBA")


def save_frames(frames: list[Image.Image], folder: Path, anim: str) -> list[Path]:
    """spritesheet.pack이 읽는 <anim>/000.png 레이아웃으로 떨군다."""
    target = folder / anim
    target.mkdir(parents=True, exist_ok=True)
    paths = []
    for index, frame in enumerate(frames):
        path = target / f"{index:03d}.png"
        frame.save(path, "PNG", optimize=True)
        paths.append(path)
    return paths


# ------------------------------------------------------------------ CLI

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="스프라이트 시트를 내용 인식으로 잘라 프레임 폴더로 만든다.")
    p.add_argument("--src", required=True, help="입력 시트 PNG (마젠타 배경)")
    p.add_argument("--out", required=True, help="출력 프레임 폴더")
    p.add_argument("--anim", default="idle", help="애니메이션 이름 (하위 폴더명)")
    p.add_argument("--category", required=True, choices=pp.CATEGORIES)
    p.add_argument("--frames", type=int, help="기대 프레임 수 (생략 시 검출값 그대로)")
    p.add_argument("--size", help="캔버스 강제 지정 (예: 128x128)")
    p.add_argument("--quantize-strength", type=float, default=0.5)
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    spec = pp.category_spec(args.category, pp.parse_size(args.size))
    frames = frames_from_sheet(Path(args.src), spec, args.frames,
                               {"quantize_strength": args.quantize_strength})
    paths = save_frames(frames, Path(args.out), args.anim)
    print(json.dumps({"frames": len(paths), "canvas": list(frames[0].size),
                      "files": [str(p) for p in paths]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
