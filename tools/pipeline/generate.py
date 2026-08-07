#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""갈래말래(Toji) 에셋 생성 오케스트레이터 — SPEC '파이프라인 CLI 계약' 구현.

  후보 N장 생성(ComfyUI) → 후처리(아트바이블 강제) → QA 랭킹 → 1위를 base.png → manifest 등록

「왜」 프롬프트 빌더가 이 파일에 있는 이유: 아트바이블 §1~7(하이비트·좌상단 광원·팔레트 hex·
     외곽선·3/4 탑다운)을 카테고리 템플릿으로 인코딩한 것이 곧 '생성 계약'이기 때문이다.
「왜」 desc는 영어를 전제한다 — SDXL CLIP은 한국어를 사실상 이해하지 못한다.
"""

from __future__ import annotations

import argparse
import json
import random
import shutil
import sys
from pathlib import Path

import postprocess as pp
import qa
import register
import spritesheet
from comfy_client import ComfyClient, ComfyError

CONFIG_PATH = pp.PIPELINE_DIR / "config.json"
WORKFLOW_DIR = pp.PIPELINE_DIR / "workflows"

# ------------------------------------------------------------------ 프롬프트 빌더

# 「왜」 §1 스타일 선언은 모든 카테고리에 공통으로 앞에 붙는다.
STYLE_HEAD = (
    "high quality hi-bit pixel art sprite, modern 16-bit era game asset, "
    "hand-crafted dithering-free pixel clusters, crisp 1px pixel grid, no anti-aliasing on the silhouette, "
    "in the style of Children of Morta and Eastward and Octopath Traveler"
)

# 「왜」 §3 광원·§4 명암·§5 외곽선은 문장으로 못 박아야 모델이 흔들리지 않는다.
STYLE_LIGHT = (
    "single light source from the upper-left at 45 degrees, warm highlights on upper-left facets, "
    "cool blue-violet reflected light inside the lower-right silhouette, four to five shading steps per material, "
    "no pillow shading, no banding"
)
STYLE_OUTLINE = (
    "1px dark outline in deep brown ink (never pure black), open lighter outline along the top lit edge, "
    "internal separations drawn with neighbouring ramp colors"
)

# 「왜」 배경 제거를 파이썬에서 하므로 ComfyUI에는 '평평한 마젠타 배경'만 요구한다.
STYLE_BACKGROUND = (
    "isolated single subject centered on a completely flat solid magenta background (#FF00FF), "
    "background is one uniform pure magenta color with no gradient, no shadow cast on the background, "
    "no ground plane, no scenery"
)

CATEGORY_PROMPTS: dict[str, dict] = {
    "player":     {"view": "top-down three-quarter view game character sprite, facing the camera, full body, feet visible", "extra": "adventurer proportions, readable silhouette, gear details"},
    "npc":        {"view": "top-down three-quarter view villager sprite, facing the camera, full body, feet visible", "extra": "everyday clothing, profession tool in hand"},
    "monster":    {"view": "top-down three-quarter view monster sprite, facing the camera, full body", "extra": "menacing readable silhouette, creature anatomy"},
    "animal":     {"view": "top-down three-quarter view animal sprite, side-facing three-quarter, full body", "extra": "fur or hide texture in pixel clusters"},
    "portrait":   {"view": "character portrait bust, head and shoulders, facing camera", "extra": "expressive face, painted-pixel rendering"},
    "weapon":     {"view": "single game inventory icon, diagonal three-quarter presentation, item floating", "extra": "metal specular 1px highlights, high contrast material"},
    "armor":      {"view": "single game inventory icon, front three-quarter presentation, item floating", "extra": "cloth and leather folds, low contrast ramps"},
    "food":       {"view": "single game inventory icon, appetizing item floating", "extra": "soft warm ramps, glossy 1px highlight"},
    "consumable": {"view": "single game inventory icon, potion or flask floating", "extra": "glass transparency suggested with blue ramps and diagonal highlight"},
    "material":   {"view": "single game inventory icon, crafting material floating", "extra": "clear material identity, chunky readable shape"},
    "mineral":    {"view": "top-down three-quarter view ore node resource object", "extra": "rock facets with chipped corners, embedded glinting ore veins"},
    "tree":       {"view": "top-down three-quarter view tree, full trunk and canopy, roots at the base", "extra": "leaf clusters of 3-6 pixels, no individual leaves"},
    "plant":      {"view": "top-down three-quarter view small plant or crop", "extra": "compact leafy clusters"},
    "furniture":  {"view": "top-down three-quarter view furniture piece", "extra": "wood grain strokes, plank seams"},
    "building":   {"view": "top-down three-quarter view fantasy village building, front facade and roof visible", "extra": "stone and timber construction, warm glowing windows"},
    "tileset":    {"view": "seamless tileable top-down terrain texture filling the entire frame edge to edge", "extra": "no outline, no border, uniform density, tiles seamlessly on all four sides"},
    "ui":         {"view": "single flat game UI skill icon, centered emblem", "extra": "bold readable symbol, subtle bevel"},
    "effect":     {"view": "single magical effect burst, isolated", "extra": "additive-friendly bright core with 1-2px glow"},
}

GRADE_HINTS = {
    "common": "plain worn materials, muted tones",
    "uncommon": "slightly refined materials, a touch of green-tinted trim",
    "rare": "fine craftsmanship, blue accents and clean edges",
    "epic": "ornate craftsmanship, violet accents and engraved details",
    "legendary": "masterwork artifact, golden filigree and faint emissive glow",
}


def build_prompt(desc: str, category: str, grade: str | None, palette: list[str]) -> str:
    """아트바이블 규칙 + 카테고리 템플릿 + 사용자 desc를 한 문장 덩어리로 합친다."""
    tpl = CATEGORY_PROMPTS[category]
    parts = [STYLE_HEAD, tpl["view"], desc.strip(), tpl["extra"]]
    parts += [_grade_clause(grade), STYLE_LIGHT, _palette_clause(palette), STYLE_OUTLINE, STYLE_BACKGROUND]
    return ", ".join(p for p in parts if p)


def _grade_clause(grade: str | None) -> str:
    return GRADE_HINTS.get(grade or "", "")


def _palette_clause(palette: list[str], take: int = 20) -> str:
    """「왜」 전체 62색을 나열하면 토큰만 먹는다. 대표색만 알려 주고 최종 강제는 양자화가 한다."""
    sample = palette[::max(1, len(palette) // take)][:take]
    return "restricted earthy fantasy color palette using only these colors: " + " ".join(sample)


# ------------------------------------------------------------------ 워크플로우 조립

def load_config() -> dict:
    if not CONFIG_PATH.exists():
        raise SystemExit(f"설정 파일이 없습니다: {CONFIG_PATH}")
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def load_workflow(name: str) -> dict:
    path = WORKFLOW_DIR / f"{name}.json"
    if not path.exists():
        available = ", ".join(sorted(p.stem for p in WORKFLOW_DIR.glob("*.json")))
        raise SystemExit(f"워크플로우를 찾지 못했습니다: {path}\n사용 가능: {available}")
    return json.loads(path.read_text(encoding="utf-8"))


def find_node(workflow: dict, title: str) -> dict:
    """_meta.title로 노드를 찾는다. 노드 번호가 바뀌어도 파이프라인이 안 깨지게 하기 위함."""
    for node in workflow.values():
        if node.get("_meta", {}).get("title") == title:
            return node
    raise SystemExit(f"워크플로우에 '{title}' 제목의 노드가 없습니다 — workflows/*.json을 확인하세요.")


def apply_settings(workflow: dict, cfg: dict, prompt: str, seed: int) -> dict:
    """모델·프롬프트·시드를 워크플로우에 주입한다."""
    find_node(workflow, "CHECKPOINT")["inputs"]["ckpt_name"] = cfg["checkpoint"]
    find_node(workflow, "VAE")["inputs"]["vae_name"] = cfg["vae"]
    _apply_lora(find_node(workflow, "LORA"), cfg)
    find_node(workflow, "POSITIVE")["inputs"]["text"] = prompt
    find_node(workflow, "NEGATIVE")["inputs"]["text"] = cfg["negative"]
    find_node(workflow, "SAMPLER")["inputs"]["seed"] = seed
    return workflow


def _apply_lora(node: dict, cfg: dict) -> None:
    loras = cfg.get("loras") or []
    if not loras:
        return
    node["inputs"]["lora_name"] = loras[0]["name"]
    node["inputs"]["strength_model"] = loras[0].get("strength", 1.0)
    node["inputs"]["strength_clip"] = loras[0].get("strength", 1.0)


def verify_models(client: ComfyClient, cfg: dict) -> list[str]:
    """설치 안 된 모델 파일명을 미리 잡아낸다 — 4장 다 돌린 뒤 실패하면 시간 낭비다."""
    checks = [("CheckpointLoaderSimple", "ckpt_name", cfg["checkpoint"]),
              ("VAELoader", "vae_name", cfg["vae"])]
    checks += [("LoraLoader", "lora_name", lo["name"]) for lo in cfg.get("loras") or []]
    found = [_missing_text(n, v, client.available(n, i)) for n, i, v in checks]
    return [text for text in found if text]


def _missing_text(class_type: str, value: str, options: list[str]) -> str:
    """「왜」 /object_info가 비면(구버전·오류) 검증을 건너뛴다 — 헛경보로 막지 않기 위함."""
    if not options or value in options:
        return ""
    sample = ", ".join(options[:8])
    return f"{class_type}에 '{value}' 가 없습니다. 설치된 목록: {sample}"


# ------------------------------------------------------------------ 생성 루프

def generate_candidates(client: ComfyClient, cfg: dict, args, prompt: str, out_dir: Path) -> list[Path]:
    """시드를 바꿔 가며 후보 N장을 큐잉·회수해 candidate_*.png로 저장한다."""
    saved: list[Path] = []
    for index in range(args.candidates):
        seed = args.seed + index if args.seed is not None else random.randint(0, 2**31 - 1)
        workflow = apply_settings(load_workflow(args.workflow), cfg, prompt, seed)
        print(f"  [{index + 1}/{args.candidates}] 큐잉 (seed={seed}) ...", flush=True)
        saved.extend(_run_one(client, workflow, out_dir, index))
    return saved


def _run_one(client: ComfyClient, workflow: dict, out_dir: Path, index: int) -> list[Path]:
    prompt_id = client.queue(workflow)
    client.wait(prompt_id, on_progress=_progress)
    print("", flush=True)
    return _save_images(client.images(prompt_id), out_dir, index)


def _progress(value: int, total: int) -> None:
    if total:
        print(f"\r      진행 {value}/{total}", end="", flush=True)


def _save_images(blobs: list[bytes], out_dir: Path, index: int) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for offset, blob in enumerate(blobs):
        path = out_dir / f"candidate_{index:02d}_{offset:02d}.png"
        path.write_bytes(blob)
        paths.append(path)
    return paths


# ------------------------------------------------------------------ 후처리 + 랭킹

def refine_and_rank(raws: list[Path], spec: dict, cfg: dict, args, out_dir: Path) -> list[dict]:
    """후보를 전부 규격화한 뒤 QA 점수로 정렬한다(동점이면 먼저 나온 것)."""
    scored = [_refine_one(raw, spec, cfg, args, out_dir) for raw in raws]
    alive = [s for s in scored if s.get("report")]
    if not alive:
        raise SystemExit("모든 후보가 후처리에 실패했습니다 — 마젠타 배경이 제대로 생성됐는지 확인하세요.")
    return sorted(alive, key=lambda s: -s["report"]["score"])


def _refine_one(raw: Path, spec: dict, cfg: dict, args, out_dir: Path) -> dict:
    dst = out_dir / f"refined_{raw.stem}.png"
    opts = _postprocess_options(cfg, args)
    try:
        info = pp.process_image(raw, dst, spec, opts)
    except ValueError as err:
        print(f"  ! {raw.name}: {err}")
        return {"raw": raw, "report": None}
    report = qa.run_checks(dst, args.category, args.subcategory, root=pp.project_root(cfg.get("projectRoot")))
    print(f"  · {raw.name} → {report['result']} 점수 {report['score']} (축소 1/{info['factor']}, {info['contentFit']})")
    return {"raw": raw, "refined": dst, "info": info, "report": report}


def _postprocess_options(cfg: dict, args) -> dict:
    return {
        "quantize_strength": args.quantize_strength,
        "downscale_filter": args.downscale_filter,
        "key_tolerance": cfg.get("keyTolerance", pp.KEY_TOLERANCE),
        "halo_tolerance": cfg.get("haloTolerance", pp.HALO_TOLERANCE),
        "root": pp.project_root(cfg.get("projectRoot")),
    }


# ------------------------------------------------------------------ 배치/등록

def publish(best: dict, args, root: Path, sheet_meta: dict | None) -> list[str]:
    """1위 후보를 public/assets/<id>/base.png로 복사한다."""
    asset_dir = root / "public/assets" / args.id
    asset_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(best["refined"], asset_dir / "base.png")
    written = [str(asset_dir / "base.png")]
    if sheet_meta:
        written.append(str(asset_dir / sheet_meta["sheet"]))
    return written


def build_info(best: dict, args, sheet_meta: dict | None) -> dict:
    report = best["report"]
    return {
        "id": args.id, "name": args.name, "category": args.category,
        "subcategory": args.subcategory, "grade": args.grade,
        "size": report["canvas"], "pixelSize": report["pixelSize"],
        "frames": sheet_meta, "paletteUsed": report["paletteUsed"],
        "tags": args.tags.split(",") if args.tags else [],
        "qa": {"result": report["result"], "checks": report["checks"], "notes": args.notes or ""},
    }


def make_sheet(args, root: Path) -> dict | None:
    """--sheet 모드: 프레임 폴더를 시트로 패킹하고 frames 메타를 돌려준다."""
    if not args.sheet:
        return None
    folder = Path(args.sheet)
    if not folder.is_dir():
        raise SystemExit(f"--sheet 폴더가 없습니다: {folder}")
    out_png = root / "public/assets" / args.id / "sheet.png"
    return spritesheet.pack(folder, out_png, pp.parse_size(args.size))


# ------------------------------------------------------------------ CLI

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="generate.py",
        description="아트바이블 규격 픽셀아트 에셋을 ComfyUI로 생성·후처리·검수·등록한다.",
        epilog='예: python tools/pipeline/generate.py --id monster/goblin_warrior --name "고블린 전사" '
               '--desc "small hunched goblin warrior, rusty sword" --category monster --candidates 4',
    )
    _add_core_args(p)
    _add_option_args(p)
    return p


def _add_core_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--id", required=True, help="에셋 id — <category>/<snake_case> (예: monster/goblin_warrior)")
    p.add_argument("--name", required=True, help="한국어 표시 이름")
    p.add_argument("--desc", required=True, help="영문 프롬프트 설명 (SDXL CLIP은 한국어를 못 읽는다)")
    p.add_argument("--category", required=True, choices=pp.CATEGORIES, help="아트바이블 §10 카테고리")
    p.add_argument("--grade", default="common", choices=register.GRADES, help="등급 (기본 common)")


def _add_option_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--candidates", type=int, help="후보 장수 (기본 config.candidates)")
    p.add_argument("--size", help="캔버스 강제 지정 (예: 160x160). 생략 시 §8 규격")
    p.add_argument("--workflow", help="workflows/<이름>.json (생략 시 카테고리 매핑)")
    p.add_argument("--subcategory", help="박물관 전시 소구역")
    p.add_argument("--tags", help="쉼표로 구분한 태그")
    p.add_argument("--notes", help="QA 예외 사유 메모")
    p.add_argument("--seed", type=int, help="시작 시드 (생략 시 무작위)")
    p.add_argument("--quantize-strength", type=float, default=None, help="0.0(28색)~1.0(16색)")
    p.add_argument("--downscale-filter", choices=("nearest", "box"), default=None, help="색 축소 필터 (기본 nearest)")
    p.add_argument("--sheet", help="스프라이트시트로 묶을 프레임 폴더")
    p.add_argument("--no-register", action="store_true", help="manifest.json을 건드리지 않는다")
    p.add_argument("--keep-candidates", action="store_true", help="out/ 후보 파일을 지우지 않는다")
    p.add_argument("--dry-run", action="store_true", help="프롬프트만 출력하고 생성하지 않는다")


def _fill_defaults(args, cfg: dict) -> None:
    """CLI로 안 준 값은 config.json 기본값으로 채운다."""
    args.candidates = _pick(args.candidates, cfg.get("candidates", 4))
    args.workflow = args.workflow or cfg.get("workflowByCategory", {}).get(args.category, "character")
    args.quantize_strength = _pick(args.quantize_strength, cfg.get("quantizeStrength", 0.5))
    args.downscale_filter = args.downscale_filter or cfg.get("downscaleFilter", "nearest")


def _pick(value, fallback):
    if value is None:
        return fallback
    return value


def _validate(args, parser) -> None:
    """「왜」 id 접두는 §10 명명 규칙이지만 스모크 테스트용 test/ 같은 예외가 있어 경고만 낸다."""
    if "/" not in args.id:
        parser.error(f"--id는 '<폴더>/<snake_case>' 형식이어야 합니다 (지금: {args.id})")
    if not args.id.startswith(f"{args.category}/"):
        print(f"  ! 경고: --id가 '{args.category}/...' 로 시작하지 않습니다 (지금: {args.id}) — 아트바이블 §10 명명 규칙 확인")
    if args.candidates < 1:
        parser.error("--candidates는 1 이상이어야 합니다.")


def _connect(cfg: dict) -> ComfyClient:
    """접속 실패 시 친절한 한국어 안내를 남기고 종료한다."""
    client = ComfyClient(cfg["comfyUrl"], timeout=cfg.get("timeoutSeconds", 900))
    stats = client.system_stats()
    print(f"ComfyUI 연결 OK — {cfg['comfyUrl']} (버전 {stats.get('system', {}).get('comfyui_version', '?')})")
    _warn_missing(verify_models(client, cfg))
    return client


def _warn_missing(problems: list[str]) -> None:
    for text in problems:
        print(f"  ! 모델 확인 필요: {text}")
    if problems:
        raise SystemExit("모델 파일명이 맞지 않습니다 — docs/에셋파이프라인_설치.md의 배치 경로를 확인하세요.")


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    cfg = load_config()
    _fill_defaults(args, cfg)
    _validate(args, parser)
    root = pp.project_root(cfg.get("projectRoot"))
    spec = pp.category_spec(args.category, pp.parse_size(args.size))
    prompt = build_prompt(args.desc, args.category, args.grade, pp.palette_hexes(root))
    return _run(args, cfg, root, spec, prompt)


def _run(args, cfg: dict, root: Path, spec: dict, prompt: str) -> int:
    print(f"# {args.id} — {args.name} ({args.category}, {spec['canvas'][0]}x{spec['canvas'][1]})")
    print(f"프롬프트: {prompt}\n")
    if args.dry_run:
        return 0
    out_dir = root / cfg.get("outDir", "tools/pipeline/out") / args.id
    try:
        return _pipeline(args, cfg, root, spec, prompt, out_dir)
    except ComfyError as err:
        print(f"\n{err}", file=sys.stderr)
        return 1


def _pipeline(args, cfg: dict, root: Path, spec: dict, prompt: str, out_dir: Path) -> int:
    client = _connect(cfg)
    raws = generate_candidates(client, cfg, args, prompt, out_dir)
    client.close()
    ranked = refine_and_rank(raws, spec, cfg, args, out_dir)
    written = _finish(ranked[0], args, root)
    _cleanup(args, out_dir)
    _report(ranked, written)
    return 0


def _finish(best: dict, args, root: Path) -> list[str]:
    sheet_meta = make_sheet(args, root)
    written = publish(best, args, root, sheet_meta)
    if args.no_register:
        return written
    result = register.register(root, build_info(best, args, sheet_meta))
    return written + result["written"]


def _cleanup(args, out_dir: Path) -> None:
    if args.keep_candidates or not out_dir.exists():
        return
    shutil.rmtree(out_dir, ignore_errors=True)


def _report(ranked: list[dict], written: list[str]) -> None:
    best = ranked[0]["report"]
    print(f"\n## 선정: {Path(ranked[0]['refined']).name} — QA {best['result']} (점수 {best['score']})")
    for key in qa.CHECK_ORDER:
        print(f"  - {key}: {best['checks'][key]} — {best['details'][key]}")
    print("\n## 변경 파일")
    for path in written:
        print(f"  {path}")
    print("\ngit은 건드리지 않았습니다 — 스테이징 여부는 직접 결정하세요.")


if __name__ == "__main__":
    sys.exit(main())
