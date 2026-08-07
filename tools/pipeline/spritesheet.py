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
}

# 몬스터 축약 표기를 표준 이름으로 흡수한다.
ALIASES = {"move": "walk", "moving": "walk", "idle_loop": "idle"}

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
    names = order_anims(frames)
    fw, fh = frame_size or _detect_frame_size(frames)
    sheet = _draw_sheet(frames, names, (fw, fh))
    out_png.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_png, "PNG", optimize=True)
    return _meta(names, frames, (fw, fh), out_png)


def _detect_frame_size(frames: dict[str, list[Path]]) -> tuple[int, int]:
    """모든 프레임이 같은 크기여야 한다(§9 '프레임 크기 고정')."""
    sizes = {_size_of(p) for group in frames.values() for p in group}
    if len(sizes) != 1:
        raise ValueError(f"프레임 크기가 섞여 있습니다: {sorted(sizes)} — 모든 프레임이 같은 캔버스여야 합니다.")
    return sizes.pop()


def _size_of(path: Path) -> tuple[int, int]:
    with Image.open(path) as img:
        return img.size


def _draw_sheet(frames: dict, names: list[str], size: tuple[int, int]) -> Image.Image:
    fw, fh = size
    cols = max(len(frames[n]) for n in names)
    sheet = Image.new("RGBA", (cols * fw, len(names) * fh), (0, 0, 0, 0))
    for row, name in enumerate(names):
        _draw_row(sheet, frames[name], row, size)
    return sheet


def _draw_row(sheet: Image.Image, paths: list[Path], row: int, size: tuple[int, int]) -> None:
    fw, fh = size
    for col, path in enumerate(paths):
        with Image.open(path) as raw:
            frame = pp.place_on_canvas(raw.convert("RGBA"), size, "bottom")
        sheet.alpha_composite(frame, (col * fw, row * fh))


def _meta(names: list[str], frames: dict, size: tuple[int, int], out_png: Path) -> dict:
    anims = {}
    for index, name in enumerate(names):
        anims[name] = {"row": index, "count": len(frames[name]), "fps": _fps_of(name)}
    return {"sheet": out_png.name, "frameW": size[0], "frameH": size[1], "anims": anims}


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
