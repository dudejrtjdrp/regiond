#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""meta.json 작성 + public/assets/manifest.json 원자적 갱신 (SPEC manifest 스키마 v1).

「왜」 manifest.json은 게임·박물관·MCP가 동시에 읽는 단일 진실이다. 중간에 끊긴 반쪽 파일이
     남으면 전부 깨지므로 임시 파일에 쓰고 os.replace로 갈아끼운다(같은 볼륨 내 원자적 교체).
「왜」 박물관에서 사람이 맞춘 scale/offsetX/offsetY는 재생성해도 살려 둔다.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from datetime import date
from pathlib import Path

import postprocess as pp

MANIFEST_REL = "public/assets/manifest.json"
GRADES = ("common", "uncommon", "rare", "epic", "legendary")
KEEP_ON_REGEN = ("scale", "offsetX", "offsetY")

EMPTY_MANIFEST = {
    "version": 1,
    "palette": "assets/palette/master-v1.json",
    "reference": "player/hero_base",
    "assets": [],
}


# ---------------------------------------------------------------- 원자적 쓰기

def write_json_atomic(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as fp:
        json.dump(data, fp, ensure_ascii=False, indent=2)
        fp.write("\n")
    os.replace(tmp, path)


def load_manifest(root: Path) -> dict:
    path = root / MANIFEST_REL
    if not path.exists():
        return json.loads(json.dumps(EMPTY_MANIFEST))
    data = json.loads(path.read_text(encoding="utf-8"))
    data.setdefault("assets", [])
    return data


# ---------------------------------------------------------------- 엔트리 구성

def build_entry(info: dict) -> dict:
    """SPEC assets[] 원소 하나를 만든다. meta.json도 같은 스키마를 그대로 쓴다."""
    asset_id = info["id"]
    entry = {
        "id": asset_id,
        "name": info["name"],
        "category": info["category"],
        "subcategory": info.get("subcategory") or _default_subcategory(info),
        "grade": info.get("grade") or "common",
        "path": f"assets/{asset_id}/",
        "still": info.get("still", "base.png"),
        "size": list(info["size"]),
        "pixelSize": list(info["pixelSize"]),
        "frames": info.get("frames"),
        "paletteUsed": int(info.get("paletteUsed", 0)),
        "version": info.get("version", "1.0.0"),
        "updated": info.get("updated") or date.today().isoformat(),
        "tags": list(info.get("tags") or []),
        "qa": info.get("qa") or {"result": "미검사", "checks": {}, "notes": ""},
        "scale": float(info.get("scale", 1.0)),
        "offsetX": int(info.get("offsetX", 0)),
        "offsetY": int(info.get("offsetY", 0)),
    }
    entry.update(_geometry(info))
    _validate_entry(entry)
    return entry


# 「왜」 박물관과 공유하는 계약 키다. 이름을 바꾸면 박물관 쪽도 같이 바꿔야 한다.
GEOMETRY_KEYS = ("anchor", "bounds", "scaleFactor", "originalPng")


def _geometry(info: dict) -> dict:
    """anchor/bounds/scaleFactor/originalPng — 있는 것만 실어 나른다(타일은 anchor 생략)."""
    out = {}
    for key in GEOMETRY_KEYS:
        if info.get(key) is not None:
            out[key] = info[key]
    return out


def _default_subcategory(info: dict) -> str:
    """전시 소구역이 비면 카테고리별 기본값으로 채운다(박물관 빈 홀 방지)."""
    return {"monster": "normal", "player": "base", "npc": "folk"}.get(info["category"], "general")


def _validate_entry(entry: dict) -> None:
    if "/" not in entry["id"]:
        raise ValueError(f"id는 '<category>/<snake_case>' 형식이어야 합니다: {entry['id']}")
    if entry["category"] not in pp.CATEGORIES:
        raise ValueError(f"알 수 없는 카테고리입니다: {entry['category']}")
    if entry["grade"] not in GRADES:
        raise ValueError(f"등급은 {', '.join(GRADES)} 중 하나여야 합니다: {entry['grade']}")


# ---------------------------------------------------------------- 병합/등록

def merge_entry(assets: list[dict], entry: dict) -> list[dict]:
    """같은 id가 있으면 사람이 맞춘 값만 물려받고 교체한다. 없으면 추가 후 id로 정렬."""
    previous = next((a for a in assets if a.get("id") == entry["id"]), None)
    merged = _inherit(entry, previous)
    kept = [a for a in assets if a.get("id") != entry["id"]]
    kept.append(merged)
    return sorted(kept, key=lambda a: a.get("id", ""))


def _inherit(entry: dict, previous: dict | None) -> dict:
    if previous is None:
        return entry
    out = dict(entry)
    for key in KEEP_ON_REGEN:
        if key in previous:
            out[key] = previous[key]
    out["version"] = _bump(previous.get("version", "1.0.0"))
    return out


def _bump(version: str) -> str:
    """재생성 때마다 패치 버전을 올려 박물관 캐시를 갱신하게 한다."""
    parts = version.split(".")
    if len(parts) != 3 or not parts[2].isdigit():
        return "1.0.1"
    return f"{parts[0]}.{parts[1]}.{int(parts[2]) + 1}"


def register(root: Path, info: dict) -> dict:
    """meta.json을 쓰고 manifest.json을 원자적으로 갱신한다. 변경 파일 목록을 돌려준다."""
    entry = build_entry(info)
    asset_dir = root / "public/assets" / entry["id"]
    write_json_atomic(asset_dir / "meta.json", entry)
    manifest = load_manifest(root)
    manifest["assets"] = merge_entry(manifest["assets"], entry)
    write_json_atomic(root / MANIFEST_REL, manifest)
    return {"entry": entry, "written": [str(asset_dir / "meta.json"), str(root / MANIFEST_REL)]}


def unregister(root: Path, asset_id: str) -> bool:
    """스모크 테스트 정리를 위해 manifest에서만 지운다(파일 삭제는 사람이 한다)."""
    manifest = load_manifest(root)
    before = len(manifest["assets"])
    manifest["assets"] = [a for a in manifest["assets"] if a.get("id") != asset_id]
    write_json_atomic(root / MANIFEST_REL, manifest)
    return len(manifest["assets"]) != before


# ---------------------------------------------------------------- CLI

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="meta.json 작성 + manifest.json 갱신.")
    p.add_argument("--info", help="엔트리 정보 JSON 파일 경로 (generate.py가 만든 것)")
    p.add_argument("--remove", help="manifest에서 제거할 에셋 id")
    p.add_argument("--root", help="프로젝트 루트 (기본: 스크립트 기준 자동 탐지)")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    root = Path(args.root).resolve() if args.root else pp.project_root()
    if args.remove:
        print(f"manifest에서 제거 {'성공' if unregister(root, args.remove) else '대상 없음'}: {args.remove}")
        return 0
    if not args.info:
        print("--info 또는 --remove 중 하나가 필요합니다.", file=sys.stderr)
        return 2
    result = register(root, json.loads(Path(args.info).read_text(encoding="utf-8")))
    print("\n".join(result["written"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
