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

# 「왜」 의존성 미설치가 첫 실행에서 가장 흔한 실패라, traceback 대신 해결 명령을 바로 보여준다.
try:
    import animslice
    import postprocess as pp
    import qa
    import register
    import spritesheet
    from comfy_client import ComfyClient, ComfyError
except ModuleNotFoundError as missing:
    if missing.name not in ("PIL", "requests", "websocket"):
        raise
    print(f"필수 파이썬 패키지가 없습니다: {missing.name}")
    print("다음 명령으로 설치한 뒤 다시 실행하세요:")
    print("  pip install pillow requests websocket-client")
    print("  (안 되면: py -3 -m pip install pillow requests websocket-client)")
    raise SystemExit(1)

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
# 「왜」 프롬프트 뒤쪽은 희석된다. 배경 지시는 ComfyUI 가중 문법으로 눌러 준다.
#      (텍스트:숫자) 형식이며 괄호 안 콜론 뒤 숫자 하나 — 중첩/여분 괄호는 파서 오류를 낸다.
STYLE_BACKGROUND = (
    "isolated single subject centered on a (completely flat solid magenta background:1.3), "
    "(pure #FF00FF magenta backdrop:1.3), (uniform chroma key background:1.2), "
    "no gradient on the background, no shadow cast on the background, "
    "no ground plane, no scenery, no studio backdrop"
)

CATEGORY_PROMPTS: dict[str, dict] = {
    "player":     {"view": "top-down three-quarter view game character sprite, facing the camera, full body, feet visible", "extra": "adventurer proportions, readable silhouette, gear details"},
    "npc":        {"view": "top-down three-quarter view villager sprite, facing the camera, full body, feet visible", "extra": "everyday clothing, profession tool in hand"},
    "monster":    {"view": "top-down three-quarter view monster sprite, facing the camera, full body", "extra": "menacing readable silhouette, creature anatomy"},
    "animal":     {"view": "top-down three-quarter view animal sprite, side-facing three-quarter, full body", "extra": "fur or hide texture in pixel clusters"},
    "portrait":   {"view": "character portrait bust, head and shoulders, facing camera", "extra": "expressive face, painted-pixel rendering"},
    "weapon":     {"view": "exactly one single subject, a single game inventory icon, diagonal three-quarter presentation, one item floating alone", "extra": "metal specular 1px highlights, high contrast material"},
    "armor":      {"view": "exactly one single subject, a single game inventory icon, front three-quarter presentation, one item floating alone", "extra": "cloth and leather folds, low contrast ramps"},
    "food":       {"view": "exactly one single subject, a single game inventory icon, one appetizing item floating alone", "extra": "soft warm ramps, glossy 1px highlight"},
    "consumable": {"view": "exactly one single subject, a single game inventory icon, one potion or flask floating alone", "extra": "glass transparency suggested with blue ramps and diagonal highlight"},
    "material":   {"view": "exactly one single subject, a single game inventory icon, one crafting material floating alone", "extra": "clear material identity, chunky readable shape"},
    "mineral":    {"view": "exactly one single subject, one top-down three-quarter view ore node resource object, a single connected rock mass", "extra": "rock facets with chipped corners, embedded glinting ore veins"},
    "tree":       {"view": "exactly one single subject, one top-down three-quarter view tree, full trunk and canopy, roots at the base", "extra": "leaf clusters of 3-6 pixels, no individual leaves"},
    "plant":      {"view": "exactly one single subject, one top-down three-quarter view small plant or crop, a single connected patch", "extra": "compact leafy clusters"},
    "furniture":  {"view": "exactly one single subject, one top-down three-quarter view furniture piece", "extra": "wood grain strokes, plank seams"},
    "building":   {"view": "exactly one single subject, one top-down three-quarter view fantasy village building, front facade and roof visible", "extra": "stone and timber construction, warm glowing windows"},
    "tileset":    {"view": "seamless repeating natural ground surface texture seen from directly above, filling the entire frame edge to edge", "extra": "a natural terrain surface and not a man-made floor or wall, no outline, no border, uniform density across the whole frame, no large focal object, repeats seamlessly on all four sides"},
    "ui":         {"view": "exactly one single subject, a single flat game UI skill icon, one centered emblem", "extra": "bold readable symbol, subtle bevel"},
    "effect":     {"view": "exactly one single subject, one magical effect burst, isolated", "extra": "additive-friendly bright core with 1-2px glow"},
}

# 「왜」 pixel-art-xl은 캐릭터 편향이 강해 추상적인 desc를 주면 사람을 그린다.
#      실제로 mineral/oil_seep·iron_node에서 검사·전사가 나왔다. 비캐릭터 계열은 사람을 막는다.
NEGATIVE_NO_HUMAN = ("person, human, man, woman, character, warrior, knight, adventurer, "
                     "hero, portrait, face, figure, humanoid")

# 「왜」 "아이템 세트 시트"로 해석돼 한 장에 궤짝 7개·화분 12개가 콜라주로 나온 사례가 있었다.
NEGATIVE_NO_COLLAGE = ("multiple separate objects, collection of items, item set, collage, "
                       "sprite sheet, grid layout, rows of objects, catalog")

# 「왜」 'tile'이라는 단어가 세라믹·포장 타일로 읽혀 desert 지형이 벽돌 석조로 생성됐다.
#      지형은 사람이 깐 바닥이 아니라 자연 지표면이라는 것을 네거티브로 못 박는다.
NEGATIVE_NO_MASONRY = ("brick, bricks, brickwork, masonry, mortar, grout, cobblestone, "
                       "pavement, paving stones, flagstone, tiled floor, ceramic tile, "
                       "stone slab floor, wall, checkerboard, man-made floor, "
                       "repeating decorative pattern, wallpaper")

# 「왜」 jungle_canopy 캐노피가 프레임에 잘렸다. 타일 제외 전 카테고리에 잘림 금지.
NEGATIVE_NO_CROP = "cropped, cut off at the edge, out of frame, partial view, extreme close-up"

# 캐릭터 계열 — 사람이 나와야 정상이므로 사람 금지를 걸지 않는다.
CHARACTER_CATEGORIES = frozenset({"player", "npc", "monster", "animal", "portrait"})

# 단일 오브젝트 강제 — 낱개로 놓이는 오브젝트·아이콘 전부
SINGLE_OBJECT_CATEGORIES = frozenset({
    "weapon", "armor", "food", "consumable", "material", "ui",
    "mineral", "tree", "plant", "furniture", "building",
})


def _negatives_for(category: str) -> list[str]:
    """카테고리 계약 네거티브. 「왜」 config가 아니라 코드 상수인 이유: 카테고리의 정의이지
       사용자 취향이 아니다. 취향은 config의 negativeExtra로 덧붙인다."""
    out = []
    if category not in CHARACTER_CATEGORIES:
        out.append(NEGATIVE_NO_HUMAN)
    if category in SINGLE_OBJECT_CATEGORIES:
        out.append(NEGATIVE_NO_COLLAGE)
    if category != "tileset":
        out.append(NEGATIVE_NO_CROP)
    if category == "tileset":
        out.append(NEGATIVE_NO_MASONRY)
    return out


NEGATIVE_BY_CATEGORY = {c: ", ".join(_negatives_for(c)) for c in pp.CATEGORIES}


def category_negative(category: str, cfg_extra: str = "") -> str:
    """카테고리 계약 네거티브 + config의 negativeExtra."""
    parts = [NEGATIVE_BY_CATEGORY.get(category, ""), cfg_extra]
    return ", ".join(p for p in parts if p)


def build_negative(cfg: dict, category: str) -> str:
    """config의 기본 네거티브 + 카테고리 계약 네거티브."""
    extra = category_negative(category, cfg.get("negativeExtra", ""))
    if not extra:
        return cfg["negative"]
    return f"{cfg['negative']}, {extra}"


GRADE_HINTS = {
    "common": "plain worn materials, muted tones",
    "uncommon": "slightly refined materials, a touch of green-tinted trim",
    "rare": "fine craftsmanship, blue accents and clean edges",
    "epic": "ornate craftsmanship, violet accents and engraved details",
    "legendary": "masterwork artifact, golden filigree and faint emissive glow",
}


# 「왜」 tree/jungle_canopy에서 캐노피가 좌우 테두리에 잘려 나왔다 — 피사체가 프레임을 넘치면
#      후처리로 복구할 방법이 없다. 타일(edge-to-edge가 정상)만 빼고 전 카테고리에 여백을 강제한다.
STYLE_FIT = (
    "(the entire subject fits fully inside the frame with clear empty margin on all sides:1.2), "
    "nothing cropped at the image edges"
)


def build_prompt(desc: str, category: str, grade: str | None, palette: list[str]) -> str:
    """아트바이블 규칙 + 카테고리 템플릿 + 사용자 desc를 한 문장 덩어리로 합친다."""
    tpl = CATEGORY_PROMPTS[category]
    parts = [STYLE_HEAD, tpl["view"], desc.strip(), tpl["extra"]]
    parts += [_grade_clause(grade, category), STYLE_LIGHT, _palette_clause(palette), STYLE_OUTLINE, STYLE_BACKGROUND]
    if category != "tileset":
        parts.append(STYLE_FIT)
    return ", ".join(p for p in parts if p)


# 「왜」 UI 심볼·이펙트는 '낡은 재질' 등급 문구가 붙으면 채도와 가독성이 죽는다 — 등급 힌트는 물건에만.
GRADE_SKIP_CATEGORIES = {"ui", "effect"}


def _grade_clause(grade: str | None, category: str = "") -> str:
    if category in GRADE_SKIP_CATEGORIES:
        return ""
    return GRADE_HINTS.get(grade or "", "")


def _palette_clause(palette: list[str], take: int = 12) -> str:
    """「왜」 색 목록이 길수록 뒤따르는 배경 지시가 희석된다. 표본을 12색으로 줄였다."""
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


def apply_settings(workflow: dict, cfg: dict, prompt: str, seed: int,
                   category: str | None = None) -> dict:
    """모델·프롬프트·시드를 워크플로우에 주입한다. category를 주면 계약 네거티브가 붙는다."""
    find_node(workflow, "CHECKPOINT")["inputs"]["ckpt_name"] = cfg["checkpoint"]
    find_node(workflow, "VAE")["inputs"]["vae_name"] = cfg["vae"]
    _apply_lora(find_node(workflow, "LORA"), cfg)
    find_node(workflow, "POSITIVE")["inputs"]["text"] = prompt
    find_node(workflow, "NEGATIVE")["inputs"]["text"] = _negative_for(cfg, category)
    _apply_sampler(find_node(workflow, "SAMPLER"), cfg, seed)
    return workflow


def _negative_for(cfg: dict, category: str | None) -> str:
    if category is None:
        return cfg["negative"]
    return build_negative(cfg, category)


def _apply_sampler(node: dict, cfg: dict, seed: int) -> None:
    """「왜」 config.json이 정본이어야 한다 — 워크플로우 하드코딩 값만 믿으면 config 수정이 조용히 무시된다."""
    inputs = node["inputs"]
    inputs["seed"] = seed
    inputs["steps"] = cfg.get("steps", inputs["steps"])
    inputs["cfg"] = cfg.get("cfg", inputs["cfg"])
    inputs["sampler_name"] = cfg.get("sampler", inputs["sampler_name"])
    inputs["scheduler"] = cfg.get("scheduler", inputs["scheduler"])


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
        workflow = apply_settings(load_workflow(args.workflow), cfg, prompt, seed, args.category)
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
    """후보를 규격화한 뒤 QA 점수로 정렬한다. FAIL 후보는 뽑히지 않게 뒤로 밀어낸다."""
    scored = [_refine_one(raw, spec, cfg, args, out_dir) for raw in raws]
    alive = [s for s in scored if s.get("report")]
    if not alive:
        raise SystemExit("모든 후보가 후처리에 실패했습니다 — 마젠타 배경이 제대로 생성됐는지 확인하세요.")
    return _rank(alive)


def _rank(alive: list[dict]) -> list[dict]:
    """「왜」 배경 잔존 같은 FAIL은 점수가 높아도 반려 대상이다. PASS/WARNING을 항상 앞에 둔다."""
    ok = sorted((s for s in alive if s["report"]["result"] != qa.FAIL), key=_by_score)
    bad = sorted((s for s in alive if s["report"]["result"] == qa.FAIL), key=_by_score)
    if not ok:
        _warn_all_failed(bad)
    return ok + bad


def _by_score(entry: dict) -> float:
    return -entry["report"]["score"]


def _warn_all_failed(bad: list[dict]) -> None:
    reasons = _fail_reasons(bad[0]["report"])
    print(f"  ! 후보 {len(bad)}장이 전부 QA FAIL입니다 — 최고점을 쓰지만 반려 대상입니다: {reasons}")
    print("    desc를 더 구체적으로 바꾸거나 --candidates를 늘려 다시 뽑으세요.")


def _fail_reasons(report: dict) -> str:
    return ", ".join(k for k, v in report["checks"].items() if v == qa.FAIL) or "(사유 없음)"


def _refine_one(raw: Path, spec: dict, cfg: dict, args, out_dir: Path) -> dict:
    dst = out_dir / f"refined_{raw.stem}.png"
    opts = _postprocess_options(cfg, args)
    try:
        info = pp.process_image(raw, dst, spec, opts)
    except ValueError as err:
        print(f"  ! {raw.name}: {err}")
        return {"raw": raw, "report": None}
    report = qa.run_checks(dst, args.category, args.subcategory, root=pp.project_root(cfg.get("projectRoot")))
    mark = " · 배경폴백" if info.get("bgFallback") else ""
    print(f"  · {raw.name} → {report['result']} 점수 {report['score']} "
          f"(축소 1/{info['factor']}, {info['contentFit']}{mark})")
    return {"raw": raw, "refined": dst, "info": info, "report": report}


def _postprocess_options(cfg: dict, args) -> dict:
    return {
        "quantize_strength": args.quantize_strength,
        "downscale_filter": args.downscale_filter,
        "key_tolerance": cfg.get("keyTolerance", pp.KEY_TOLERANCE),
        "halo_tolerance": cfg.get("haloTolerance", pp.HALO_TOLERANCE),
        "seamless": cfg.get("seamless", True),
        "seam_band": cfg.get("seamBand", pp.SEAM_BAND),
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


# ================================================================== 애니메이션 트랙
#
# 「왜」 세 전략을 두는 이유(조사 결론):
#   anchor    승인된 base.png에서 출발하는 img2img. 프레임마다 같은 그림에서 시작하므로
#             캐릭터 정체성이 가장 잘 버틴다. 프레임당 1024px을 온전히 쓴다. 기본값.
#   variation 시드만 바꾼 txt2img. 불꽃·마법처럼 §7이 "프레임마다 실루엣 30%+ 변화"를
#             요구하는 대상은 오히려 닮으면 안 되므로 이쪽이 맞다.
#   sheet     한 장에 프레임 열을 그리고 내용 인식으로 자른다. 프레임당 해상도가 낮아
#             하이비트 밀도가 안 나오므로 기본값이 아니다(외부 시트 취입·실험용).

ANIM_STRATEGIES = ("anchor", "variation", "sheet")

# 프레임별 포즈/위상 지시문. 모자라면 순환시켜 채운다.
ANIM_PHASES: dict[str, list[str]] = {
    "idle": ["standing still, weight centered, chest neutral",
             "breathing in, chest slightly raised, shoulders up 1px",
             "standing still, weight centered",
             "breathing out, chest lowered, shoulders down 1px"],
    "walk": ["contact pose, left leg forward, right arm forward",
             "down pose, weight on left leg, body lowered",
             "passing pose, legs together, body raised",
             "up pose, right leg pushing off, body highest",
             "contact pose, right leg forward, left arm forward",
             "down pose, weight on right leg, body lowered",
             "passing pose, legs together, body raised",
             "up pose, left leg pushing off, body highest"],
    "run": ["full stride, front leg extended far forward, torso leaning ahead",
            "landing, front foot planted, body compressed low",
            "push off, rear leg extended back, body rising",
            "airborne, both feet off the ground, knees tucked"],
    "attack": ["wind up, weapon pulled back behind the shoulder",
               "anticipation, body coiled, weapon at the highest point",
               "impact frame, weapon swung across the front, motion smear",
               "follow through, weapon low across the body",
               "recovery, returning toward the neutral stance"],
    "gather": ["reaching down toward the ground with both arms",
               "bent over, hands at the ground, tool swinging down",
               "pulling up, arms drawn toward the chest",
               "returning upright, holding the gathered item"],
    "craft": ["raising a tool above the work surface",
              "striking down onto the work surface, sparks",
              "tool resting on the work surface",
              "lifting the tool, inspecting the work"],
    "hit": ["struck, head snapped back, body recoiling",
            "staggering backward, arms flung out",
            "recovering, body returning upright"],
    "death": ["struck fatally, body arching backward",
              "knees buckling, body sinking",
              "falling sideways, arms loose",
              "collapsed on the ground, limbs sprawled"],
    "flicker": ["flame tall and narrow, tip curling left",
                "flame short and wide, embers rising",
                "flame tall and leaning right, bright core",
                "flame mid height, sparks flying off the tip"],
    "burn": ["fire low and spreading wide across the base",
             "fire surging upward in a tall column",
             "fire splitting into two tongues, embers scattering",
             "fire collapsing inward, thick ember glow",
             "fire flaring bright at the core, sparks off the top",
             "fire leaning sideways, trailing smoke wisps"],
    "sway": ["leaves leaning left, stems bent",
             "leaves upright, stems straight",
             "leaves leaning right, stems bent",
             "leaves upright, slight overshoot"],
    "cast": ["magic energy gathering into a small dense core",
             "energy expanding into a bright ring",
             "energy bursting outward with radiating spokes",
             "energy dispersing into scattered motes"],
    "impact": ["sharp bright flash at the center point",
               "shockwave ring expanding outward",
               "debris and sparks flying outward",
               "residual glow fading, sparse motes"],
}

DEFAULT_PHASES = ["phase one of the loop", "phase two of the loop",
                  "phase three of the loop", "phase four of the loop"]


def anim_config(cfg: dict) -> dict:
    """「왜」 이전에 sampler 값이 config를 무시하고 드리프트한 적이 있다. 전부 cfg.get으로 읽는다."""
    return cfg.get("anim") or {}


def resolve_strategy(args, cfg: dict) -> str:
    table = anim_config(cfg).get("strategyByCategory") or {}
    return args.anim_strategy or table.get(args.category, "anchor")


def resolve_frame_count(args, cfg: dict) -> int:
    """§9 표 → 카테고리 오버라이드 → CLI 순으로 프레임 수를 정한다."""
    if args.anim_frames:
        return args.anim_frames
    per_category = (anim_config(cfg).get("frames") or {}).get(args.category)
    if per_category:
        return int(per_category)
    return _bible_frames(args.anim, args.category)


def _bible_frames(anim: str, category: str) -> int:
    table = qa.ANIM_FRAMES_MONSTER if category == "monster" else qa.ANIM_FRAMES_CHAR
    entry = spritesheet.ANIM_TABLE.get(anim)
    if anim in table:
        return table[anim]
    if entry:
        return entry["count"]
    return 4


def resolve_denoise(args, cfg: dict) -> float:
    conf = anim_config(cfg)
    table = conf.get("denoise") or {}
    fallback = conf.get("defaultDenoise", 0.55)
    return _pick(args.anim_denoise, table.get(args.anim, fallback))


def resolve_anim_workflow(args, cfg: dict, strategy: str) -> str:
    table = anim_config(cfg).get("workflowByStrategy") or {}
    return args.workflow or table.get(strategy, f"anim_{strategy}")


def resolve_fps(args, cfg: dict) -> int:
    if args.anim_fps:
        return args.anim_fps
    return (anim_config(cfg).get("fps") or {}).get(args.anim) or spritesheet._fps_of(args.anim)


def frame_prompts(base_prompt: str, anim: str, count: int) -> list[str]:
    """기본 프롬프트에 프레임별 위상 지시문을 덧붙인다."""
    phases = ANIM_PHASES.get(anim) or DEFAULT_PHASES
    return [f"{base_prompt}, animation frame {i + 1} of {count}: {phases[i % len(phases)]}"
            for i in range(count)]


def sheet_prompt(base_prompt: str, anim: str, count: int) -> str:
    """sheet 전략용 — 한 장에 프레임 열을 그리게 지시한다."""
    return (f"{base_prompt}, a horizontal sprite sheet strip of exactly {count} evenly spaced "
            f"{anim} animation frames in a single row, same character in every frame, "
            "clear empty magenta gaps between frames, all frames the same size")


# ------------------------------------------------------------------ 애니 생성 실행

def _anchor_path(args, root: Path) -> Path:
    base = root / "public/assets" / args.id / "base.png"
    if not base.exists():
        raise SystemExit(
            f"앵커로 쓸 정지 컷이 없습니다: {base}\n"
            f"먼저 정지 에셋을 만드세요 — python tools/pipeline/generate.py --id {args.id} "
            f'--name "{args.name}" --desc "..." --category {args.category}\n'
            "또는 --anim-strategy variation 으로 정지 컷 없이 생성하세요.")
    return base


def run_anim_generation(client, cfg: dict, args, prompts: list[str],
                        strategy: str, denoise: float, out_dir: Path, root: Path) -> list[Path]:
    """전략에 따라 프레임 원본을 뽑는다. 반환은 저장된 PNG 경로 목록."""
    workflow_name = resolve_anim_workflow(args, cfg, strategy)
    anchor = _upload_anchor(client, args, root, strategy)
    if strategy == "sheet":
        return _generate_sheet(client, cfg, args, prompts, workflow_name, out_dir)
    return _generate_per_frame(client, cfg, args, prompts, workflow_name, denoise, anchor, out_dir)


def _upload_anchor(client, args, root: Path, strategy: str) -> str | None:
    if strategy != "anchor":
        return None
    return client.upload_image(_anchor_path(args, root))


def _generate_per_frame(client, cfg, args, prompts, workflow_name, denoise, anchor, out_dir) -> list[Path]:
    saved: list[Path] = []
    for index, text in enumerate(prompts):
        seed = _frame_seed(args, index)
        workflow = _anim_workflow(workflow_name, cfg, text, seed, denoise, anchor, args.category)
        print(f"  [{index + 1}/{len(prompts)}] 프레임 큐잉 (seed={seed}, denoise={denoise}) ...", flush=True)
        saved.extend(_run_one(client, workflow, out_dir, index))
    return saved


def _generate_sheet(client, cfg, args, prompts, workflow_name, out_dir) -> list[Path]:
    seed = _frame_seed(args, 0)
    workflow = _anim_workflow(workflow_name, cfg, prompts[0], seed, 1.0, None, args.category)
    print(f"  [1/1] 시트 1장 큐잉 (seed={seed}) — 내용 인식 슬라이싱으로 자릅니다 ...", flush=True)
    return _run_one(client, workflow, out_dir, 0)


def _frame_seed(args, index: int) -> int:
    """「왜」 anchor는 시드를 고정해야 프레임 간 색·질감이 안 흔들린다. variation은 흔들려야 한다."""
    if args.seed is not None:
        return args.seed + index
    return random.randint(0, 2**31 - 1)


def _anim_workflow(name: str, cfg: dict, prompt: str, seed: int,
                   denoise: float, anchor: str | None, category: str | None = None) -> dict:
    workflow = apply_settings(load_workflow(name), cfg, prompt, seed, category)
    _apply_denoise(workflow, denoise)
    _apply_anchor(workflow, anchor)
    return workflow


def _apply_denoise(workflow: dict, denoise: float) -> None:
    find_node(workflow, "SAMPLER")["inputs"]["denoise"] = denoise


def _apply_anchor(workflow: dict, anchor: str | None) -> None:
    if anchor is None:
        return
    find_node(workflow, "ANCHOR")["inputs"]["image"] = anchor


# ------------------------------------------------------------------ 애니 후처리·등록

def refine_anim_frames(raws: list[Path], spec: dict, cfg: dict, args, strategy: str, count: int):
    """원본 프레임(또는 시트)을 공통 배율·공통 캔버스로 정렬한다."""
    opts = _postprocess_options(cfg, args)
    if strategy == "sheet":
        return animslice.frames_from_sheet(raws[0], spec, count, {**opts, "align": "row"})
    return animslice.frames_from_images(raws, spec, opts)


def merge_into_sheet(frames, args, root: Path, fps: int) -> tuple[dict, list[str]]:
    """기존 sheet.png에 이 애니 행을 추가/교체한다(다른 행은 보존)."""
    asset_dir = root / "public/assets" / args.id
    out_png = asset_dir / "sheet.png"
    existing = _existing_frames_meta(asset_dir)
    meta = spritesheet.merge_anim(out_png, existing, args.anim, frames, fps)
    return (meta, [str(out_png)])


def _existing_frames_meta(asset_dir: Path) -> dict | None:
    meta_path = asset_dir / "meta.json"
    if not meta_path.exists():
        return None
    return json.loads(meta_path.read_text(encoding="utf-8")).get("frames")


def _existing_meta(asset_dir: Path) -> dict:
    meta_path = asset_dir / "meta.json"
    if not meta_path.exists():
        return {}
    return json.loads(meta_path.read_text(encoding="utf-8"))


def build_anim_info(args, root: Path, sheet_meta: dict, still_report: dict, consistency: dict) -> dict:
    """기존 meta.json을 뼈대로 삼아 frames만 갈아끼운다(정지 컷 정보를 잃지 않는다)."""
    old = _existing_meta(root / "public/assets" / args.id)
    checks = dict(still_report["checks"])
    checks["frameConsistency"] = consistency["status"]
    return {
        "id": args.id, "name": args.name or old.get("name") or args.id,
        "category": args.category, "subcategory": args.subcategory or old.get("subcategory"),
        "grade": args.grade or old.get("grade"), "size": still_report["canvas"],
        "pixelSize": still_report["pixelSize"], "frames": sheet_meta,
        "paletteUsed": still_report["paletteUsed"],
        "tags": args.tags.split(",") if args.tags else (old.get("tags") or []),
        "qa": {"result": qa.worst([still_report["result"], consistency["status"]]),
               "checks": checks, "notes": _anim_notes(args, consistency)},
    }


def _anim_notes(args, consistency: dict) -> str:
    parts = [n for n in (args.notes, consistency["detail"]) if n]
    return " / ".join(parts)


def _run_anim(args, cfg: dict, root: Path, spec: dict, prompt: str) -> int:
    strategy = resolve_strategy(args, cfg)
    count = resolve_frame_count(args, cfg)
    denoise = resolve_denoise(args, cfg)
    fps = resolve_fps(args, cfg)
    prompts = _anim_prompts(prompt, args, count, strategy)
    _print_anim_plan(args, strategy, count, denoise, fps, prompts)
    if args.dry_run:
        return 0
    return _anim_pipeline(args, cfg, root, spec, prompts, strategy, count, denoise, fps)


def _anim_prompts(prompt: str, args, count: int, strategy: str) -> list[str]:
    if strategy == "sheet":
        return [sheet_prompt(prompt, args.anim, count)]
    return frame_prompts(prompt, args.anim, count)


def _print_negative(args, cfg: dict) -> None:
    """「왜」 카테고리 계약 네거티브가 실제로 붙었는지 dry-run에서 눈으로 확인할 수 있어야 한다."""
    extra = category_negative(args.category, cfg.get("negativeExtra", ""))
    print(f"네거티브(카테고리 추가분): {extra or '(없음)'}\n")


def _print_anim_plan(args, strategy, count, denoise, fps, prompts) -> None:
    print(f"# {args.id} — 애니메이션 '{args.anim}' ({strategy} 전략, {count}프레임, {fps}fps)")
    _print_negative(args, load_config())
    if strategy == "anchor":
        print(f"앵커: public/assets/{args.id}/base.png · denoise {denoise}")
    for index, text in enumerate(prompts):
        print(f"[{index + 1}] {text}\n")


def _anim_pipeline(args, cfg, root, spec, prompts, strategy, count, denoise, fps) -> int:
    out_dir = root / cfg.get("outDir", "tools/pipeline/out") / args.id / f"anim_{args.anim}"
    try:
        return _anim_steps(args, cfg, root, spec, prompts, strategy, count, denoise, fps, out_dir)
    except ComfyError as err:
        print(f"\n{err}", file=sys.stderr)
        return 1
    except ValueError as err:
        print(f"\n애니메이션 처리 실패: {err}", file=sys.stderr)
        return 1


def _anim_steps(args, cfg, root, spec, prompts, strategy, count, denoise, fps, out_dir) -> int:
    client = _connect(cfg)
    raws = run_anim_generation(client, cfg, args, prompts, strategy, denoise, out_dir, root)
    client.close()
    frames = refine_anim_frames(raws, spec, cfg, args, strategy, count)
    print(f"  · 프레임 {len(frames)}장 정렬 완료 (캔버스 {frames[0].size[0]}x{frames[0].size[1]})")
    consistency = _consistency(frames, args, cfg)
    sheet_meta, written = _finish_anim(args, root, frames, fps, consistency)
    _cleanup(args, out_dir)
    return _report_anim(args, written, frames, consistency, sheet_meta)


def _finish_anim(args, root: Path, frames, fps: int, consistency: dict) -> tuple[dict, list[str]]:
    """시트를 병합하고(항상) manifest를 갱신한다(--no-register가 아니면)."""
    sheet_meta, written = merge_into_sheet(frames, args, root, fps)
    if args.no_register:
        return (sheet_meta, written)
    still = qa.run_checks(root / "public/assets" / args.id / "base.png", args.category,
                          args.subcategory, root=root)
    result = register.register(root, build_anim_info(args, root, sheet_meta, still, consistency))
    return (sheet_meta, written + result["written"])


def _consistency(frames, args, cfg: dict) -> dict:
    limits = anim_config(cfg).get("consistency") or {}
    return qa.check_frame_consistency(frames, args.category, limits)


def _rows_text(meta: dict) -> str:
    anims = meta.get("anims") or {}
    return ", ".join(f"{n}(row {a['row']}, {a['count']}f, {a['fps']}fps)" for n, a in anims.items())


def _report_anim(args, written: list[str], frames, consistency: dict, meta: dict) -> int:
    print(f"\n## 애니메이션 '{args.anim}' 완료 — {len(frames)}프레임")
    print(f"  - 프레임 일관성: {consistency['status']} — {consistency['detail']}")
    print(f"  - 시트 행 구성: {_rows_text(meta)}")
    print("\n## 변경 파일")
    for path in written:
        print(f"  {path}")
    print("\ngit은 건드리지 않았습니다 — 스테이징 여부는 직접 결정하세요.")
    return 0


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
    _add_anim_args(p)


def _add_anim_args(p: argparse.ArgumentParser) -> None:
    """「왜」 --anim이 붙으면 정지 생성은 아예 건너뛴다. 기존 계약을 건드리지 않기 위함."""
    names = ", ".join(spritesheet.ANIM_TABLE)
    p.add_argument("--anim", help=f"애니메이션 트랙으로 전환. 이름: {names}")
    p.add_argument("--anim-frames", type=int, help="프레임 수 (생략 시 §9 표/카테고리 기본값)")
    p.add_argument("--anim-strategy", choices=ANIM_STRATEGIES, help="anchor(기본)|variation|sheet")
    p.add_argument("--anim-denoise", type=float, help="anchor 전략의 변형 강도 0.0~1.0")
    p.add_argument("--anim-fps", type=int, help="재생 fps (생략 시 §9 표)")


def _fill_defaults(args, cfg: dict) -> None:
    """CLI로 안 준 값은 config.json 기본값으로 채운다."""
    args.candidates = _pick(args.candidates, cfg.get("candidates", 4))
    args.quantize_strength = _pick(args.quantize_strength, cfg.get("quantizeStrength", 0.5))
    args.downscale_filter = args.downscale_filter or cfg.get("downscaleFilter", "nearest")
    _fill_workflow(args, cfg)


def _fill_workflow(args, cfg: dict) -> None:
    """「왜」 애니 트랙은 전략별 워크플로우를 따로 고른다. 정지용 기본값으로 덮으면 안 된다."""
    if args.anim:
        return
    args.workflow = args.workflow or cfg.get("workflowByCategory", {}).get(args.category, "character")


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
    _validate_anim(args, parser)


def _validate_anim(args, parser) -> None:
    if not args.anim:
        return
    if args.anim_frames is not None and args.anim_frames < 2:
        parser.error("--anim-frames는 2 이상이어야 합니다(1장이면 애니메이션이 아닙니다).")
    if args.anim not in spritesheet.ANIM_TABLE:
        print(f"  ! 경고: '{args.anim}'는 아트바이블 §9 표에 없는 이름입니다 — 시트 맨 뒷행에 붙습니다.")


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
    if args.anim:
        return _run_anim(args, cfg, root, spec, prompt)
    return _run(args, cfg, root, spec, prompt)


def _run(args, cfg: dict, root: Path, spec: dict, prompt: str) -> int:
    print(f"# {args.id} — {args.name} ({args.category}, {spec['canvas'][0]}x{spec['canvas'][1]})")
    print(f"프롬프트: {prompt}\n")
    _print_negative(args, cfg)
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
