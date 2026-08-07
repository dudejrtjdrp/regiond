#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""배치 파일(batches/*.json)의 에셋을 순서대로 generate.py로 생성한다.

「왜」 별도 러너인 이유: ComfyUI 생성은 장당 수십 초라 배치 도중 끊겨도
     이미 등록된 에셋은 건너뛰고 이어서 돌 수 있어야 한다.
사용:  python tools/pipeline/run_batch.py tools/pipeline/batches/batch1_probe.json
       [--only <id>] [--force] [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent


def load_registered_ids() -> set[str]:
    """「왜」 재실행 시 완료분을 건너뛰기 위해 manifest의 id를 모은다."""
    cfg = json.loads((PIPELINE_DIR / "config.json").read_text(encoding="utf-8"))
    root = (PIPELINE_DIR / cfg.get("projectRoot", "../..")).resolve()
    manifest = root / "public/assets/manifest.json"
    if not manifest.exists():
        return set()
    data = json.loads(manifest.read_text(encoding="utf-8"))
    return {a["id"] for a in data.get("assets", [])}


def build_cmd(entry: dict, passthrough: list[str]) -> list[str]:
    cmd = [sys.executable, str(PIPELINE_DIR / "generate.py"),
           "--id", entry["id"], "--name", entry["name"],
           "--desc", entry["desc"], "--category", entry["category"]]
    for key, flag in (("grade", "--grade"), ("size", "--size"),
                      ("candidates", "--candidates"), ("workflow", "--workflow"),
                      ("subcategory", "--subcategory")):
        if key in entry:
            cmd += [flag, str(entry[key])]
    return cmd + passthrough


def run_entry(entry: dict, passthrough: list[str]) -> int:
    print(f"\n===== {entry['id']} — {entry['name']} =====")
    rc = subprocess.run(build_cmd(entry, passthrough)).returncode
    if rc != 0:
        return rc
    return run_anims(entry, passthrough)


def run_anims(entry: dict, passthrough: list[str]) -> int:
    """「왜」 base.png(앵커)가 성공한 뒤에만 애니를 돌린다 — anchor 전략의 전제."""
    for anim in entry.get("anims", []):
        cmd = build_cmd(entry, passthrough) + ["--anim", anim["name"]]
        if "frames" in anim:
            cmd += ["--anim-frames", str(anim["frames"])]
        print(f"----- {entry['id']} anim:{anim['name']}")
        rc = subprocess.run(cmd).returncode
        if rc != 0:
            return rc
    return 0


def main() -> None:
    ap = argparse.ArgumentParser(description="에셋 배치 실행기")
    ap.add_argument("batch", help="배치 json 경로")
    ap.add_argument("--only", help="이 id만 실행")
    ap.add_argument("--force", action="store_true", help="이미 등록된 에셋도 다시 생성")
    ap.add_argument("--dry-run", action="store_true", help="generate.py에 --dry-run 전달")
    args = ap.parse_args()
    entries = json.loads(Path(args.batch).read_text(encoding="utf-8"))["assets"]
    if args.only:
        entries = [e for e in entries if e["id"] == args.only]
    done = set() if args.force else load_registered_ids()
    passthrough = ["--dry-run"] if args.dry_run else []
    results = {}
    for entry in entries:
        if entry["id"] in done:
            print(f"----- {entry['id']} 이미 등록됨 → 건너뜀 (--force로 재생성)")
            continue
        results[entry["id"]] = run_entry(entry, passthrough)
    failed = [aid for aid, rc in results.items() if rc != 0]
    print(f"\n배치 완료: 실행 {len(results)}장 · 실패 {len(failed)}장")
    for aid in failed:
        print(f"  ! 실패: {aid}")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
