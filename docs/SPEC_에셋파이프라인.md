# SPEC — 에셋 파이프라인 & Asset Museum (구현 계약서)

이 문서는 구현 에이전트용 계약이다. 아트 규칙 정본은 `docs/아트바이블.md`.

## 공통 제약

- 게임 클라는 바닐라 JS(`GM` 네임스페이스), 서버는 Node 22 ESM express+socket.io. **프로젝트 루트 `package.json` 변경 금지, npm 의존성 추가 금지.**
- 박물관은 빌드 없이 `public/museum.html`로 열리는 정적 페이지 (express가 public/을 정적 서빙, `npm start` → `localhost:3000/museum.html`).
- 파이프라인 스크립트는 사용자 **Windows** 로컬에서 실행 (Python 3.10+, 의존성은 `Pillow`, `requests`, `websocket-client`만).
- ComfyUI는 사용자 Windows에서 `http://127.0.0.1:8188` (RTX 3060+).
- 주석은 한국어 「왜」 중심, indent depth ≤2, 함수 ≤15줄 지향, else·3항연산자 지양.

## 폴더 구조

```
public/
  museum.html                  ← Asset Museum (단일 페이지, dev 전용)
  js/museum.js                 ← 박물관 로직 (바닐라, GM 네임스페이스 불사용 독립)
  css/museum.css               ← 박물관 스타일
  assets/
    palette/master-v1.json
    manifest.json
    <category>/<asset_id>/{base.png, sheet.png, meta.json}
tools/
  pipeline/
    generate.py                ← CLI 오케스트레이터
    comfy_client.py            ← ComfyUI HTTP/WS 클라이언트
    postprocess.py             ← 배경제거·트림·다운스케일·팔레트 양자화
    spritesheet.py             ← 시트 패킹 + 프레임 메타
    register.py                ← meta.json 작성 + manifest.json 갱신
    qa.py                      ← 아트바이블 §11 검사 (박물관 QA와 동일 규칙)
    config.json                ← comfy url·모델·기본값
    workflows/*.json           ← ComfyUI API 포맷 워크플로우
  asset-mcp/
    server.mjs                 ← 무의존 Node MCP 서버 (stdio)
.mcp.json                      ← 프로젝트 MCP 등록 (Claude Code가 읽음)
docs/
  아트바이블.md
  에셋파이프라인_설치.md        ← ComfyUI 설치·모델·체크리스트 (사용자용)
```

## manifest.json 스키마 (v1)

```json
{
  "version": 1,
  "palette": "assets/palette/master-v1.json",
  "reference": "player/hero_base",
  "assets": [
    {
      "id": "monster/goblin_warrior",
      "name": "고블린 전사",
      "category": "monster",
      "subcategory": "normal",           // 카테고리별 전시 소구역
      "grade": "common",                  // common|uncommon|rare|epic|legendary
      "path": "assets/monster/goblin_warrior/",
      "still": "base.png",
      "size": [128, 128],                 // 캔버스
      "pixelSize": [62, 88],              // 불투명 콘텐츠 bbox
      "frames": {                          // 없으면 null
        "sheet": "sheet.png",
        "frameW": 128, "frameH": 128,
        "anims": { "idle": {"row":0,"count":4,"fps":8},
                   "walk": {"row":1,"count":6,"fps":12} }
      },
      "paletteUsed": 22,
      "version": "1.0.0",
      "updated": "2026-08-07",
      "tags": ["wave","melee"],
      "qa": { "result": "PASS", "checks": {"palette":"PASS","outline":"WARNING"}, "notes": "" },
      "scale": 1.0, "offsetX": 0, "offsetY": 0   // 박물관 사이즈 조정값 반영분
    }
  ]
}
```

- 개별 `meta.json`은 assets[] 원소 1개와 동일 스키마.
- `register.py`와 박물관은 이 스키마만 신뢰한다.

## Asset Museum (public/museum.html) 요구사항

**컨셉:** 밝은 중성 조명의 현대 갤러리. 어두운 중성 배경(#26282c 계열)+밝은 전시대, 체커보드 토글. 성능보다 가독성·검수 우선. 픽셀 표시는 `image-rendering: pixelated` + 정수배만.

1. **전시홀(카테고리 사이드바):** 플레이어(남/여/기본장비/직업), NPC(주민/상인/장인/귀족/병사/아이/노인), 몬스터(일반/엘리트/보스 — 크기순 정렬), 동물(가축/야생/탈것), 무기(검/활/창/도끼/둔기/지팡이 — 등급순), 방어구(투구/갑옷/장갑/신발/망토), 음식, 소비, 재료, 광물, 나무, 식물, 가구, 건물, 타일셋, UI(아이콘/버튼/패널/인벤토리/스킬), 이펙트(공격/폭발/채집/제작/마법/버프/디버프). subcategory 필드로 구획. 빈 홀은 "미등록" 표시.
2. **전시 규칙:** 모든 에셋 동일 간격 그리드, 동일 배경 전시대, 하단 그림자 연출 동일. 클릭 → 확대 뷰어.
3. **애니메이션:** frames 있는 에셋은 뷰어에서 Idle/Walk/Run/Attack/Gather/Craft/Hit/Death 버튼 + 루프 재생 + fps 표시 + 프레임 스텝.
4. **환경 테스트 버튼:** 낮(없음) / 밤(`#16214a` alpha 0.46 multiply — 게임 값 그대로) / 비(청색틴트+빗줄기 오버레이) / 눈(한색틴트+입자) / 실내(warm `#3b2a18` alpha 0.25) / 횃불(방사형 warm 라이트 + 주변 어둡게). 캔버스 합성으로 구현, 전시장 전체에 적용.
5. **배율 테스트:** 100/150/200/300/400% 버튼. 정수배가 아닌 150%는 의도적으로 포함(흐림 발생 확인용) — 뷰어에 nearest 강제 상태와 브라우저 기본 상태 비교 표시.
6. **기준 캐릭터:** manifest.reference 에셋을 상단 고정 슬롯에 항상 표시. 미등록이면 빈 대좌 + 안내.
7. **스타일 비교:** 뷰어에서 "비교" → 아무 에셋이나 선택해 나란히 표시 + 자동 수치: 콘텐츠 크기, 평균 luma, 평균 채도, 주요 색상 스와치 8개, 외곽선 색, 추정 픽셀 그리드. 기준 캐릭터와의 비교가 기본값.
8. **정보 패널:** 이름·카테고리·해상도·pixelSize·프레임 수·버전·사용 팔레트 수·updated.
9. **자동 QA:** 로드 시 각 에셋을 캔버스로 분석해 아트바이블 §11 검사 → PASS/WARNING/FAIL 뱃지. 항목별 상세는 뷰어에. 검사 알고리즘:
   - 팔레트: 불투명 픽셀을 master-v1 62색과 RGB 거리 ≤6 매칭, 위반율 >2% W, >8% F
   - 반투명: 0<a<255 비율 >1% W, >5% F
   - 해상도: 카테고리 규격 표 대조 (§8 표를 JS 상수로)
   - 픽셀 밀도: 수평/수직 동일색 런 길이 최빈값으로 그리드 추정, 캔버스와 어긋나면 W
   - 외곽선: 실루엣 경계 픽셀의 70%+가 ink 계열/램프 0단인지
   - 광원: 상반부 평균 luma ≤ 하반부면 W
   - 밤 minLuma: 밤 합성 후 불투명 평균 luma <56 F
   - 프레임: sheet 크기 % frameW/H == 0, anims count 정합
   - 크기 비율: pixelSize가 카테고리 기준 ±25% 밖이면 W
10. **사이즈 조정 + JSON 내보내기:** 뷰어에서 scale(0.25~4.0 슬라이더+숫자)·offsetX/Y 조정, 기준 캐릭터·타일 그리드 위에 실시간 미리보기. 변경된 에셋 목록을 모아 "JSON 내보내기" → `size-overrides.json` 다운로드 + 클립보드 복사(클로드에게 그대로 붙여넣는 용도). 포맷: `{ "version":1, "overrides": { "<id>": {"scale":1.25,"offsetY":-4} } }`
11. **기타:** 검색창(이름/태그), QA 필터(FAIL만 보기), localStorage 사용 금지(메모리 변수만), 외부 CDN 금지(완전 오프라인 동작).

## 파이프라인 CLI 계약

```
python tools/pipeline/generate.py \
  --id monster/goblin_warrior --name "고블린 전사" \
  --desc "small hunched goblin warrior, rusty sword, leather scraps" \
  --category monster [--grade common] [--candidates 4] [--size 128x128] \
  [--workflow character] [--no-register] [--keep-candidates]
```
1. 아트바이블 팔레트 + 카테고리 규격을 읽어 프롬프트/워크플로우 파라미터 구성
2. ComfyUI에 후보 N장 큐잉 (`comfy_client.py`) — 시드 상이
3. 후보를 `tools/pipeline/out/<id>/candidate_*.png`에 저장
4. `postprocess.py`: 배경 제거(생성은 단색 마젠타 `#FF00FF` 배경 → RGB 거리 임계 제거, 잔여 halo 알파 이진화) → 콘텐츠 트림 → 목표 캔버스로 정수 다운스케일(nearest) → 마스터 팔레트 양자화(옵션 `--quantize-strength`) → 하단 중앙 앵커 배치
5. `qa.py` 점수로 후보 자동 랭킹 → 1위를 base.png로 (전 후보 보존)
6. `register.py`: meta.json 생성 + manifest.json 갱신(정렬 유지, 원자적 쓰기)
7. `--sheet` 모드: 프레임 이미지 폴더 → `spritesheet.py`로 시트 패킹
8. git은 건드리지 않는다(스테이징은 사람이/Claude가 결정). 마지막에 변경 파일 목록 출력.

`config.json`: `{ "comfyUrl": "http://127.0.0.1:8188", "checkpoint": "...", "loras": [...], "negative": "...", "steps": ..., "cfg": ..., "projectRoot": ".." }` — 모델명은 설치 가이드와 일치시킬 것.

## MCP 서버 계약 (tools/asset-mcp/server.mjs)

- Node 22, **외부 의존성 0** (stdio JSON-RPC 직접 구현). MCP 프로토콜: `initialize`, `notifications/initialized`, `tools/list`, `tools/call` 지원, protocolVersion "2024-11-05" 호환.
- 도구:
  - `generate_asset {id, name, desc, category, grade?, candidates?, size?, workflow?}` → generate.py 하위 프로세스 실행(작업 디렉토리=프로젝트 루트, `python` 우선·실패 시 `py -3`), stdout 요약 + 생성 파일 경로 + QA 결과 반환
  - `list_assets {category?}` → manifest 요약
  - `qa_asset {id}` → qa.py 단독 실행 결과
  - `apply_size_overrides {json}` → size-overrides.json 내용을 manifest에 반영
  - `comfy_status {}` → ComfyUI 접속/모델 로드 확인
- `.mcp.json` (프로젝트 루트): `{"mcpServers": {"toji-assets": {"command": "node", "args": ["tools/asset-mcp/server.mjs"]}}}`
- 에러는 사람이 읽을 수 있는 한국어 메시지로(예: "ComfyUI가 응답하지 않습니다 — 실행 여부와 포트 8188 확인").

## 설치 가이드 (docs/에셋파이프라인_설치.md) 요구

- ComfyUI Windows portable 설치 → 실행 확인
- 필수 커스텀 노드(가능한 한 최소로; 워크플로우가 실제 참조하는 것만) — **웹 조사로 2026년 8월 기준 현행 확인 후 작성**
- 픽셀아트 모델 추천: 주력 1 + 대안 1 (RTX 3060 12GB에서 도는 것, 다운로드 링크·배치 폴더 경로 명시) — 웹 조사로 확인
- Python 의존성: `pip install pillow requests websocket-client`
- Claude Code 연동: `.mcp.json` 자동 인식 안내 + 수동 `claude mcp add` 대안
- 스모크 테스트 절차: `python tools/pipeline/generate.py --id test/style_probe ...` → museum.html에서 확인 → test/ 삭제
- 사용자가 해야 할 일 체크리스트(순서·소요시간 포함)
