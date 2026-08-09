#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""배치 파일(batches/*.json)의 에셋을 순서대로 generate.py로 생성한다.

「왜」 별도 러너인 이유: ComfyUI 생성은 장당 수십 초라 배치 도중 끊겨도
     이미 등록된 에셋은 건너뛰고 이어서 돌 수 있어야 한다.
사용:  python tools/pipeline/run_batch.py tools/pipeline/batches/batch1_probe.json
       [--only <id>] [--force] [--dry-run] [--exclude-file <path>]
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


SKIPPED: list[str] = []


def run_entry(entry: dict, passthrough: list[str]) -> int:
    print(f"\n===== {entry['id']} — {entry['name']} =====")
    rc = _run_and_watch(build_cmd(entry, passthrough))
    if rc != 0:
        return rc
    return run_anims(entry, passthrough)


def _run_and_watch(cmd: list[str]) -> int:
    """「왜」 generate.py가 미게시할 때 찍는 '!! SKIP' 줄을 모아 배치 끝에 요약한다."""
    proc = subprocess.run(cmd, capture_output=True, text=True)
    _echo(proc.stdout)
    _echo(proc.stderr, err=True)
    SKIPPED.extend(l.strip() for l in proc.stdout.splitlines() if l.startswith("!! SKIP"))
    return proc.returncode


def _echo(text: str, err: bool = False) -> None:
    if not text:
        return
    stream = sys.stderr if err else sys.stdout
    stream.write(text)
    stream.flush()


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


def parse_only(text: str | None) -> list[str]:
    """「왜」 requalify.py가 FAIL id를 쉼표로 묶어 한 줄로 뱉는다. 그걸 그대로 받는다."""
    if not text:
        return []
    return [part.strip() for part in text.split(",") if part.strip()]


def load_excluded_ids(path: str | None) -> set[str]:
    """사람이 제외한 에셋은 재생성 대상에서 영구적으로 뺀다.

    제외 파일은 {"exclude": ["building/hut", ...]} 형식이다. 기존에 폴더나
    manifest를 지워 제외하던 방식은 다음 --force에서 되살아나는 문제가 있어,
    명시적인 장부를 정본으로 둔다.
    """
    if not path:
        return set()
    exclude_path = Path(path)
    if not exclude_path.exists():
        raise FileNotFoundError(f"제외 목록 파일을 찾을 수 없습니다: {exclude_path}")
    data = json.loads(exclude_path.read_text(encoding="utf-8"))
    values = data.get("exclude", data if isinstance(data, list) else [])
    if not isinstance(values, list) or not all(isinstance(aid, str) for aid in values):
        raise ValueError("제외 목록은 {\"exclude\": [\"category/id\", ...]} 형식이어야 합니다.")
    return set(values)


def _select(entries: list[dict], only: str | None, excluded: set[str]) -> list[dict]:
    wanted = parse_only(only)
    if not wanted:
        return [e for e in entries if e["id"] not in excluded]
    picked = [e for e in entries if e["id"] in wanted]
    _warn_unknown(wanted, picked)
    return [e for e in picked if e["id"] not in excluded]


def _warn_unknown(wanted: list[str], picked: list[dict]) -> None:
    missing = [w for w in wanted if w not in {e["id"] for e in picked}]
    for aid in missing:
        print(f"  ! --only에 준 id가 이 배치에 없습니다: {aid}")


def main() -> None:
    ap = argparse.ArgumentParser(description="에셋 배치 실행기")
    ap.add_argument("batch", help="배치 json 경로")
    ap.add_argument("--only", help="이 id만 실행. 쉼표로 여러 개 (예: tree/oak_large,mineral/iron_node)")
    ap.add_argument("--force", action="store_true", help="이미 등록된 에셋도 다시 생성")
    ap.add_argument("--dry-run", action="store_true", help="generate.py에 --dry-run 전달")
    ap.add_argument(
        "--exclude-file",
        help="제외 장부 JSON 경로. 이 목록의 id는 --force여도 생성하지 않음",
    )
    args = ap.parse_args()
    entries = json.loads(Path(args.batch).read_text(encoding="utf-8"))["assets"]
    excluded = load_excluded_ids(args.exclude_file)
    entries = _select(entries, args.only, excluded)
    if excluded:
        print(f"제외 장부 적용: {len(excluded)}개 id")
    done = set() if args.force else load_registered_ids()
    passthrough = ["--dry-run"] if args.dry_run else []
    results = {}
    for entry in entries:
        if entry["id"] in done:
            print(f"----- {entry['id']} 이미 등록됨 → 건너뜀 (--force로 재생성)")
            continue
        results[entry["id"]] = run_entry(entry, passthrough)
    failed = [aid for aid, rc in results.items() if rc != 0]
    print(f"\n배치 완료: 실행 {len(results)}장 · 실패 {len(failed)}장 · 미게시(SKIP) {len(SKIPPED)}장")
    for aid in failed:
        print(f"  ! 실패: {aid}")
    _print_skipped()
    if failed:
        raise SystemExit(1)


def _print_skipped() -> None:
    if not SKIPPED:
        return
    print("\n## 미게시(전 후보 QA FAIL) — desc를 고쳐 --only로 다시 돌리세요")
    for line in SKIPPED:
        print(f"  {line}")


if __name__ == "__main__":
    main()
