# assets meta 정리 · 2차 (중복 제거)

2026-08-09 · 삭제가 아니라 `_to_delete/assets-dup-20260809/` 로 **이동**했습니다. 되돌릴 수 있습니다.

## 1. 결론부터

- **meta 가진 폴더 중 "아무데도 안 쓰이는 것"은 0개**였습니다. 정본 192개는 전부 건물 테스트 월드나 수작업 에셋룸에서 불러옵니다.
- 대신 정본과 **바이트 단위로 동일한 중복 폴더 321개**가 있었고, 이걸 걷어냈습니다.
- 이동 전 **1,841개 파일 전수 MD5 비교 → 100% 동일, 고유 내용 0**. 기능 손실 없습니다.

## 2. 걷어낸 것

| 패턴 | 폴더 | 예시 |
|---|---|---|
| `<cat>/$R.......//` 휴지통 복원 잔재 | 11 | `armor/$RDQ3GZQ/` |
| `<cat>/<cat>/<id>/` | 20 | `creature/creature/wolf/` |
| `<cat>/<id>/<id>/` | 290 | `building/academy/academy/` |
| **합계** | **321** | 1,841 파일 · **약 1.13GB** |

`_meta/` 미러에서도 대응되는 140개를 함께 정리했습니다.

## 3. 지키기로 한 것 (요청하신 스프라이트시트)

정본 시트는 하나도 건드리지 않았습니다. 이동 후 재확인 완료:

- `creature/` 20종 — `wolf, bear, deer, boar, direwolf, snow_fox, sand_lizard, jungle_panther, marsh_lurker, spore_walker, ash_hound, ash_wyrm, stray_dog, bandit_scout, rabbit, chicken, cow, pig, sheep` 의 `sheet.png`
- `enemy/` 7종 `sheet.png` + `enemy/camp/base.png`
- `temple/` 11종 `guardian-sheet.png`
- `characters/` 6종, `char_spritesheet/` (`NPC`, `Female_NPC`, exec-*.png)
- `player/action-8dir`, `player/npc-walk`, `player/role-walk`, `player/hero_base`
- `cutscene/`, `dialogue/portraits-transparent/`

## 4. "건물 테스트 월드 기준"으로 지우지 않은 이유

건물 테스트 월드가 실제로 여는 건 `generated-manifest.json` 182건 + `assets/building/<key>/base.png` 43종입니다. 그 기준을 그대로 적용하면 아래 **149개**가 삭제 대상이 되는데, 이 중 상당수를 메인 게임이 씁니다.

- `tileset/` **32개** — `atlas.js:190,196` 에서 `assets/tileset/<code>/base-v4.png` 를 직접 로드합니다. 지우면 지형이 통째로 깨집니다.
- `ui/` 30개, `player/hero_base`, `monster/wolf`, `effect/`, `armor/`, `weapon/`, `material/`, `mineral/`, `plant/`, `tree/`, `consumable/`, `food/`, `test/` — `assets/manifest.json` 에 등재되어 **수작업 에셋룸(museum.html)** 에서 표시됩니다.

즉 "건물 테스트 월드에 없다" ≠ "안 쓴다" 였습니다. 이 192개는 그대로 뒀습니다.

## 5. 현재 상태

- 정본 meta 폴더 **192개** (건물 테스트 월드 43 · 에셋룸 전용 149)
- `assistant-made/` 120개 — 하드링크 인덱스, 유지
- `_meta/index.json` — 정본 192개 색인 (경로·id·이름·카테고리·크기·QA)
- 무결성 재확인: `manifest.json` 192/192, `handmade-manifest.json` 42/42, `generated-manifest.json` 182/182, 건물 base.png 43/43 전부 정상

정본 카테고리: building 52, ui 30, tileset 26, material 15, effect 11, tree 11, weapon 11, armor 8, mineral 8, plant 8, furniture 6, food 4, monster 1, player 1

정본 QA: WARNING 124, FAIL 52, PASS 12, 미검사 4

## 6. 남은 제안

- `public/assets/` 는 **git 에 커밋되어 있지 않습니다**(전부 untracked). 지금은 `_to_delete/` 가 유일한 백업이니, 확인 후 폴더째 지우시면 됩니다.
- 재발 방지: `.gitignore` 에 `public/assets/**/$R*/` 한 줄. 말씀 주시면 넣겠습니다.