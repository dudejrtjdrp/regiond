#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""등록된 전 에셋에 현행 QA를 다시 돌려 재검수한다.

「왜」 QA 규칙이 늘어나면(배경 잔존 검사 등) 예전에 통과한 에셋이 사실은 반려 대상일 수 있다.
     그 목록을 뽑고, **재생성 명령까지 복붙 가능하게** 만들어 주는 것이 이 스크립트의 목적이다.

사용:  python tools\\pipeline\\requalify.py
       [--category mineral] [--fail-only] [--json] [--write]
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import postprocess as pp
import qa
import register

BATCH_DIR = pp.PIPELINE_DIR / "batches"


# ---------------------------------------------------------------- 재검수

def load_assets(root: Path, category: str | None) -> list[dict]:
    manifest = register.load_manifest(root)
    assets = manifest.get("assets") or []
    if not category:
        return assets
    return [a for a in assets if a.get("category") == category]


def requalify_one(root: Path, asset: dict) -> dict:
    """에셋 1점을 다시 검사한다. 파일이 없으면 그 사실을 결과로 남긴다."""
    png = root / "public" / asset.get("path", "") / asset.get("still", "base.png")
    if not png.exists():
        return {"id": asset["id"], "result": "MISSING", "checks": {}, "details": {},
                "was": _previous(asset), "png": str(png)}
    report = qa.run_checks(png, asset["category"], asset.get("subcategory"),
                           _sheet_path(root, asset), asset.get("frames"), root)
    return {"id": asset["id"], "result": report["result"], "checks": report["checks"],
            "details": report["details"], "was": _previous(asset), "png": str(png)}


def _sheet_path(root: Path, asset: dict) -> Path | None:
    frames = asset.get("frames")
    if not frames:
        return None
    return root / "public" / asset.get("path", "") / frames["sheet"]


def _previous(asset: dict) -> str:
    return (asset.get("qa") or {}).get("result", "미검사")


def requalify_all(root: Path, category: str | None) -> list[dict]:
    return [requalify_one(root, a) for a in load_assets(root, category)]


# ---------------------------------------------------------------- 배치 역인덱스

def batch_index() -> dict[str, str]:
    """id → 그 id가 들어 있는 배치 파일명. 재생성 명령을 만들기 위한 역인덱스."""
    index: dict[str, str] = {}
    for path in sorted(BATCH_DIR.glob("*.json")):
        for entry in _entries(path):
            index.setdefault(entry, path.name)
    return index


def _entries(path: Path) -> list[str]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return []
    return [e["id"] for e in data.get("assets", []) if isinstance(e, dict) and "id" in e]


def _win(path: str) -> str:
    """「왜」 사용자는 Windows에서 복붙한다. 출력 경로는 백슬래시로 낸다."""
    return path.replace("/", "\\")


def rerun_commands(failed: list[str], index: dict[str, str]) -> list[str]:
    """FAIL id를 배치별로 묶어 run_batch.py 명령으로 만든다(배치별 1줄 + 개별 줄)."""
    grouped = _group_by_batch(failed, index)
    lines: list[str] = []
    for batch, ids in sorted(grouped.items()):
        lines.extend(_batch_lines(batch, ids))
    lines.extend(_orphan_lines(failed, index))
    return lines


def _group_by_batch(failed: list[str], index: dict[str, str]) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {}
    for asset_id in failed:
        batch = index.get(asset_id)
        if batch:
            grouped.setdefault(batch, []).append(asset_id)
    return grouped


def _batch_lines(batch: str, ids: list[str]) -> list[str]:
    target = _win(f"tools/pipeline/batches/{batch}")
    runner = _win("tools/pipeline/run_batch.py")
    head = [f":: {batch} — {len(ids)}건 한 번에",
            f"python {runner} {target} --only {','.join(ids)} --force", ""]
    single = [f"python {runner} {target} --only {i} --force" for i in ids]
    return head + [":: 개별로 다시 돌리려면"] + single + [""]


def _orphan_lines(failed: list[str], index: dict[str, str]) -> list[str]:
    orphans = [i for i in failed if i not in index]
    if not orphans:
        return []
    return [":: 배치 파일에서 찾지 못한 id (generate.py로 직접 재생성하세요)"] + \
           [f"::   {i}" for i in orphans] + [""]


# ---------------------------------------------------------------- 출력

STATUS_ORDER = ("FAIL", "WARNING", "PASS", "MISSING")


def print_table(rows: list[dict]) -> None:
    print(f"{'에셋 id':<34} {'이전':<8} {'현재':<8} 문제 항목")
    print("-" * 96)
    for row in sorted(rows, key=_sort_key):
        print(f"{row['id']:<34} {row['was']:<8} {row['result']:<8} {_problem_text(row)}")


def _sort_key(row: dict) -> tuple:
    rank = STATUS_ORDER.index(row["result"]) if row["result"] in STATUS_ORDER else 9
    return (rank, row["id"])


def _problem_text(row: dict) -> str:
    if row["result"] == "MISSING":
        return f"파일 없음: {_win(row['png'])}"
    bad = [k for k, v in row["checks"].items() if v in ("FAIL", "WARNING")]
    if not bad:
        return "-"
    return ", ".join(f"{k}={row['checks'][k]}" for k in bad)


def print_summary(rows: list[dict]) -> None:
    tally = Counter(r["result"] for r in rows)
    parts = [f"{k} {tally.get(k, 0)}" for k in STATUS_ORDER]
    print(f"\n집계: 총 {len(rows)}건 · " + " · ".join(parts))
    _print_regressions(rows)


def _print_regressions(rows: list[dict]) -> None:
    """「왜」 '예전엔 PASS였는데 지금 FAIL'이 이번 규칙 강화로 새로 드러난 것들이다."""
    newly = [r for r in rows if r["result"] == "FAIL" and r["was"] != "FAIL"]
    if not newly:
        return
    print(f"\n새 규칙으로 새로 반려된 에셋 {len(newly)}건:")
    for row in newly:
        print(f"  - {row['id']} ({row['was']} → FAIL) {_problem_text(row)}")


def print_rerun(rows: list[dict]) -> None:
    failed = [r["id"] for r in sorted(rows, key=_sort_key) if r["result"] == "FAIL"]
    if not failed:
        print("\nFAIL 에셋이 없습니다 — 재생성할 것이 없습니다.")
        return
    print(f"\n{'=' * 96}\n재생성 명령 (Windows, 프로젝트 루트에서 실행)\n{'=' * 96}")
    for line in rerun_commands(failed, batch_index()):
        print(line)


def write_back(root: Path, rows: list[dict]) -> int:
    """--write: 재검사 결과를 manifest/meta의 qa 필드에 반영한다."""
    manifest = register.load_manifest(root)
    by_id = {r["id"]: r for r in rows if r["result"] != "MISSING"}
    changed = _apply_results(manifest, by_id)
    if changed:
        register.write_json_atomic(root / register.MANIFEST_REL, manifest)
    return changed


def _apply_results(manifest: dict, by_id: dict) -> int:
    changed = 0
    for asset in manifest.get("assets") or []:
        row = by_id.get(asset.get("id"))
        if row and _needs_update(asset, row):
            asset["qa"] = {"result": row["result"], "checks": row["checks"],
                           "notes": (asset.get("qa") or {}).get("notes", "")}
            changed += 1
    return changed


def _needs_update(asset: dict, row: dict) -> bool:
    old = asset.get("qa") or {}
    return old.get("result") != row["result"] or old.get("checks") != row["checks"]


# ---------------------------------------------------------------- CLI

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="manifest 전 에셋에 현행 QA를 다시 돌린다.")
    p.add_argument("--category", choices=pp.CATEGORIES, help="이 카테고리만")
    p.add_argument("--fail-only", action="store_true", help="FAIL만 표에 출력")
    p.add_argument("--json", action="store_true", help="JSON으로 출력")
    p.add_argument("--write", action="store_true", help="결과를 manifest의 qa 필드에 반영")
    p.add_argument("--root", help="프로젝트 루트 (기본: 자동 탐지)")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    root = Path(args.root).resolve() if args.root else pp.project_root()
    rows = requalify_all(root, args.category)
    if not rows:
        print("manifest에 등록된 에셋이 없습니다.")
        return 0
    return _emit(args, root, rows)


def _emit(args, root: Path, rows: list[dict]) -> int:
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return 0
    shown = [r for r in rows if r["result"] == "FAIL"] if args.fail_only else rows
    print_table(shown)
    print_summary(rows)
    print_rerun(rows)
    _maybe_write(args, root, rows)
    return 0


def _maybe_write(args, root: Path, rows: list[dict]) -> None:
    if not args.write:
        return
    print(f"\nmanifest.json의 qa 필드 {write_back(root, rows)}건을 갱신했습니다.")


if __name__ == "__main__":
    sys.exit(main())
