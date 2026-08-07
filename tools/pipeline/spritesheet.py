#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""프레임 폴더 → 스프라이트시트 패킹 + anims 메타 (아트바이블 §9).

입력 레이아웃(둘 다 지원):
  frames/idle/000.png, frames/idle/001.png ...     ← 애니메이션별 하위 폴더
  frames/idle_000.png, frames/walk_001.png ...     ← 접두사 평면 배치

출력: 가로 = 프레임, 세로 = 애니메이션 행. 프레임 크기 고정, 앵커는 각 프레임 하단 중앙.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from PIL import Image

import postprocess as pp

# 아트바이블 §9 정본 — 행 순서·기본 프레임 수·fps·루프 여부
ANIM_TABLE = {
    "idle":   {"row": 0, "count": 6, "fps": 8,  "loop": True},
    "walk":   {"row": 1, "count": 8, "fps": 12, "loop": True},
    "run":    {"row": 2, "count": 8, "fps": 12, "loop": True},
    "attack": {"row": 3, "count": 6, "fps": 12, "loop": False},
    "gather": {"row": 4, "count": 6, "fps": 12, "loop": True},
    "craft":  {"row": 5, "count": 6, "fps": 12, "loop": True},
    "hit":    {"row": 6, "count": 3, "fps": 15, "loop": False},
    "death":  {"row": 7, "count": 8, "fps": 10, "loop": False},
    # 「왜」 §9 표는 캐릭터용이다. 횃불·모닥불·마법·식물처럼 '움직이는 사물'은 아래 루프를 쓴다.
    "flicker": {"row": 8,  "count": 4, "fps": 10, "loop": True},
    "burn":    {"row": 9,  "count": 6, "fps": 12, "loop": True},
    "sway":    {"row": 10, "count": 4, "fps": 6,  "loop": True},
    "cast":    {"row": 11, "count": 6, "fps": 12, "loop": False},
    "impact":  {"row": 12, "count": 6, "fps": 15, "loop": False},
}

# 몬스터·사물 축약 표기를 표준 이름으로 흡수한다.
ALIASES = {"move": "walk", "moving": "walk", "idle_loop": "idle",
           "flame": "flicker", "fire": "burn", "wind": "sway"}

_FLAT = re.compile(r"^([a-z_]+?)[_-]?(\d+)$")


def collect_frames(folder: Path) -> dict[str, list[Path]]:
    """폴더에서 애니메이션별 프레임 목록을 모은다(하위 폴더 우선)."""
    nested = _collect_nested(folder)
    if nested:
        return nested
    return _collect_flat(folder)


def _collect_nested(folder: Path) -> dict[str, list[Path]]:
    out: dict[str, list[Path]] = {}
    for sub in sorted(p for p in folder.iterdir() if p.is_dir()):
        frames = sorted(sub.glob("*.png"))
        if frames:
            out[_canonical(sub.name)] = frames
    return out


def _collect_flat(folder: Path) -> dict[str, list[Path]]:
    out: dict[str, list[Path]] = {}
    for png in sorted(folder.glob("*.png")):
        match = _FLAT.match(png.stem.lower())
        if match:
            out.setdefault(_canonical(match.group(1)), []).append(png)
    return {k: sorted(v) for k, v in out.items()}


def _canonical(name: str) -> str:
    key = name.strip().lower().rstrip("_-")
    return ALIASES.get(key, key)


def _fps_of(name: str) -> int:
    entry = ANIM_TABLE.get(name)
    if entry is None:
        return 12
    return entry["fps"]


def order_anims(frames: dict[str, list[Path]]) -> list[str]:
    """§9 행 순서를 지키되, 표에 없는 이름은 뒤에 알파벳 순으로 붙인다."""
    known = [n for n in ANIM_TABLE if n in frames]
    extra = sorted(n for n in frames if n not in ANIM_TABLE)
    return known + extra


def pack(folder: Path, out_png: Path, frame_size: tuple[int, int] | None = None) -> dict:
    """프레임들을 시트 1장으로 굽고 manifest용 frames 메타를 돌려준다."""
    frames = collect_frames(folder)
    if not frames:
        raise ValueError(f"프레임 PNG를 찾지 못했습니다: {folder} — <anim>/000.png 또는 <anim>_000.png 형식이어야 합니다.")
    size = frame_size or _detect_frame_size(frames)
    images = {name: [_open(p) for p in paths] for name, paths in frames.items()}
    return write_sheet(images, out_png, size, {})


def _open(path: Path) -> Image.Image:
    with Image.open(path) as img:
        return img.convert("RGBA")


def _detect_frame_size(frames: dict[str, list[Path]]) -> tuple[int, int]:
    """모든 프레임이 같은 크기여야 한다(§9 '프레임 크기 고정')."""
    sizes = {_size_of(p) for group in frames.values() for p in group}
    if len(sizes) != 1:
        raise ValueError(f"프레임 크기가 섞여 있습니다: {sorted(sizes)} — 모든 프레임이 같은 캔버스여야 합니다.")
    return sizes.pop()


def _size_of(path: Path) -> tuple[int, int]:
    with Image.open(path) as img:
        return img.size


def _draw_sheet(images: dict[str, list[Image.Image]], names: list[str], size: tuple[int, int]) -> Image.Image:
    fw, fh = size
    cols = max(len(images[n]) for n in names)
    sheet = Image.new("RGBA", (cols * fw, len(names) * fh), (0, 0, 0, 0))
    for row, name in enumerate(names):
        _draw_row(sheet, images[name], row, size)
    return sheet


def _draw_row(sheet: Image.Image, frames: list[Image.Image], row: int, size: tuple[int, int]) -> None:
    fw, fh = size
    for col, raw in enumerate(frames):
        frame = pp.place_on_canvas(raw.convert("RGBA"), size, "bottom")
        sheet.alpha_composite(frame, (col * fw, row * fh))


def _meta(names: list[str], images: dict, size: tuple[int, int], out_png: Path, fps_hint: dict) -> dict:
    anims = {}
    for index, name in enumerate(names):
        anims[name] = {"row": index, "count": len(images[name]), "fps": fps_hint.get(name) or _fps_of(name)}
    return {"sheet": out_png.name, "frameW": size[0], "frameH": size[1], "anims": anims}


def write_sheet(images: dict[str, list[Image.Image]], out_png: Path,
                size: tuple[int, int], fps_hint: dict) -> dict:
    """이미지 사전을 §9 행 순서로 배치해 시트를 굽는다."""
    names = order_anims(images)
    sheet = _draw_sheet(images, names, size)
    out_png.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_png, "PNG", optimize=True)
    return _meta(names, images, size, out_png, fps_hint)


# ---------------------------------------------------------------- 행 누적(병합)

def explode(sheet_png: Path, meta: dict) -> dict[str, list[Image.Image]]:
    """기존 sheet.png를 anims 메타대로 다시 프레임 이미지로 푼다."""
    fw, fh = meta["frameW"], meta["frameH"]
    with Image.open(sheet_png) as handle:
        sheet = handle.convert("RGBA")
    return {name: _cut_row(sheet, a, fw, fh) for name, a in (meta.get("anims") or {}).items()}


def _cut_row(sheet: Image.Image, anim: dict, fw: int, fh: int) -> list[Image.Image]:
    top = anim["row"] * fh
    return [sheet.crop((c * fw, top, (c + 1) * fw, top + fh)) for c in range(anim["count"])]


def merge_anim(out_png: Path, existing_meta: dict | None, anim: str,
               frames: list[Image.Image], fps: int | None = None) -> dict:
    """「왜」 idle을 뽑은 뒤 walk를 추가할 때 기존 행을 잃으면 안 된다. 풀었다가 다시 굽는다."""
    if not frames:
        raise ValueError(f"{anim}: 병합할 프레임이 없습니다.")
    size = _uniform_size(frames)
    images, hints = _existing_rows(out_png, existing_meta, size, anim)
    images[_canonical(anim)] = frames
    hints[_canonical(anim)] = fps
    return write_sheet(images, out_png, size, hints)


def _uniform_size(frames: list[Image.Image]) -> tuple[int, int]:
    sizes = {f.size for f in frames}
    if len(sizes) != 1:
        raise ValueError(f"프레임 크기가 섞여 있습니다: {sorted(sizes)} — 모든 프레임이 같은 캔버스여야 합니다.")
    return sizes.pop()


def _existing_rows(out_png: Path, meta: dict | None, size: tuple[int, int],
                   anim: str) -> tuple[dict, dict]:
    """기존 시트를 읽어 온다. 프레임 크기가 다르면 섞을 수 없으니 한국어로 거절한다."""
    if not meta or not out_png.exists():
        return ({}, {})
    _assert_same_size(meta, size)
    images = explode(out_png, meta)
    images.pop(_canonical(anim), None)
    hints = {n: a.get("fps") for n, a in (meta.get("anims") or {}).items()}
    return (images, hints)


def _assert_same_size(meta: dict, size: tuple[int, int]) -> None:
    old = (meta.get("frameW"), meta.get("frameH"))
    if old != size:
        raise ValueError(
            f"기존 시트의 프레임 크기 {old[0]}x{old[1]}와 새 프레임 {size[0]}x{size[1]}가 다릅니다 — "
            "sheet.png와 meta.json의 frames를 지우고 처음부터 다시 만드세요.")


# ---------------------------------------------------------------- CLI

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="프레임 폴더를 스프라이트시트로 패킹한다.")
    p.add_argument("--frames", required=True, help="프레임 폴더")
    p.add_argument("--out", required=True, help="출력 sheet.png 경로")
    p.add_argument("--size", help="프레임 크기 강제 (예: 128x128)")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    meta = pack(Path(args.frames), Path(args.out), pp.parse_size(args.size))
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
