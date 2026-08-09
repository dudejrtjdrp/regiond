# 클라-서버 프로토콜 v3.3 (양측 구현 계약 — 이 파일이 최종 정본)

> 임의 변경 금지. 바꿔야 하면 **이 파일을 먼저 고치고** 서버·클라를 따라 고친다.
> 서버 판번호는 `server/index.js` 의 `PROTOCOL = '3.3'`, 클라는 `public/js/state.js` 의 `GM.PROTOCOL` 과 **반드시 같아야** 한다.
> 설계 근거는 `docs/GDD3.md`(§1~§10 엔드리스 정착지 성장 · **§11 진행 감독** · **§12 플레이테스트 1차** · **§13 플레이테스트 2차** · **§14 플레이테스트 3차** · **§15 플레이테스트 4차**), 공간 계층은 `docs/WORLD.md`.

---

## 0-B. v3.3 안 델타 — **밀려 있던 중간 콘텐츠를 제자리로** (§21-C3)

**판번호를 올리지 않는다**(`world.schema` **6** 유지, `MIGRATION_REV` 그대로).
소켓 이벤트도 새로 나지 않는다 — 바뀐 것은 **자료(어느 장이 무엇을 여는가)** 와, 그 자료가 쓸 수 있는
조건·마커 낱말 둘이다. 옛 세이브도 그대로 열린다(해금은 저장되지 않는 파생값이다 — §0-A).

### 0-B-1. 무엇이 잘못돼 있었나

진행 감독은 티어 해금을 **마지막 장에 들어선 뒤에만** 합류시킨다(§11 새치기 봉쇄). 그 규칙은 옳다.
문제는 티어 4~6 건물 **열두 채**와 무역·이웃이 **어느 장의 `opens` 에도 안 적혀 있었다**는 것이다.
그래서 규칙의 그늘에 갇혀, 티어는 5·6까지 오르는데 배치대에는 새 건물이 한 채도 안 뜨다가
10장에 들어서는 순간 열두 채가 한꺼번에 쏟아졌다.

| 어디로 | 무엇이 |
|---|---|
| **7장** `opens` | 저택 · 목장 · 방앗간 · 분수 (티어 4 살림 — 인구 25를 넘는 그 장에서) |
| **7장** `wave_held` 칸 | 서리탑 · 화염탑 (한 무리를 겪어 본 뒤에 더 나은 탑) |
| **8장** `trading_post_built` 칸 | `trade` · `panel.trade` · 무역 명령 일곱 (**장 보상에서 칸으로 옮김**) |
| **8장** `first_trade` 칸 | 영사관 |
| **9장** `opens` | 서고 · 기념비 · 공방 · 정거장 · 대학당 (티어 5·6) |

무역 해금이 **장 보상에서 칸으로** 옮겨 간 것이 계약상 가장 큰 변화다. 예전에는 교역소를 다 세워도
장이 끝나야 좌판이 열려 「지었는데 아무 일도 안 난다」가 되었다. 지금은 지은 그 자리에서 열린다.

### 0-B-2. 새 조건 낱말 — `metNations`

```
{ "type": "metNations", "count": 1 }
```

`nation.metNations`(§17-16 `visitNation` 이 적어 두는 표)의 크기를 센다. `grow`/`growMax`(§0-C-3)도 받는다.
**관계 점수가 아니라 「가 봤는가」를 센다** — 9장의 새 칸이 가르치려는 동사가 '찾아가기'이기 때문이다.

### 0-B-3. 새 마커 낱말 — `town`

`goal.target = { "type": "town" }` 이면 `targets[]` 에 `kind:'town'` 이 실린다(`id` 는 나라 id, `name` 은 자료의 나라 이름).

- **안개를 묻지 않는다** — 노드 마커와 다른 점이다. 이웃 나라가 어디 있는지는 비밀이 아니다(예언과
  연대기가 이미 그 이름을 말한다). 숨은 것은 자리가 아니라 **길**이고, 그 길을 걷는 것이 이 칸의 전부다.
- 아직 얼굴을 못 익힌 나라를 **먼저** 준다. 그다음이 아바타에서 가까운 순. 최대 셋.
- 클라는 고칠 것이 없다 — `x`/`y` 가 있는 마커는 이미 한 길로 그린다(카메라 점프 · 거리 표시).

### 0-B-4. 새 깃발 — `traded`

`trade` 명령이 **성공한 순간**(사는 쪽·파는 쪽 양쪽) `progress.flags.traded` 가 선다.
8장 `first_trade` 칸이 이 깃발 하나만 본다 — 방향도 액수도 묻지 않는다.

### 0-B-5. 바뀌지 않은 것

- 「시간은 아무것도 열지 않는다」 · 「티어 해금은 마지막 장 뒤에만 합류」 — 규칙은 한 글자도 안 고쳤다.
  고친 것은 **자료가 그 규칙에 무엇을 맡겼는가**뿐이다.
- 1~6장의 문·조건은 그대로다(회귀로 붙듦).
- `buildingUnlockInfo` 의 티어 분기는 남겨 둔다 — 지금은 거의 안 지나가지만, 자료가 다시
  「어느 장에도 안 적힌 건물」을 만들면 그때 이 길이 다시 답을 낸다.

### 0-B-6. 밸런스 — 이 배치는 수치를 **움직였다**

저택·방앗간이 10장이 아니라 7장에 열리면서 시뮬 자동 플레이가 그것을 짓기 시작한다.
시드42 20판: 인구 80.8 → **85.3**, 건물 63.5 → 58.6채(저택이 오두막·가옥 여럿을 대신한다),
**웨이브5 생존율 55.0% MISS → 65.0% PASS** — 유물 상향 이후 계속 MISS 던 칸이 밴드 안으로 들어왔다.
체크포인트 3/4 → **4/4**. 「중간이 비어 있다」는 체감과 「웨이브5에서 밀린다」는 수치가 **같은 원인**이었다.

---

## 0-C. v3.3 안 델타 — **연구 조기 분기와 끝없는 장의 매듭** (§21-C2)

**판번호를 올리지 않는다**(`world.schema` **6** 유지, `MIGRATION_REV` 그대로).
소켓 이벤트도 새로 나지 않는다 — 이미 있던 `state.chapter` 에 칸 하나(`cycle`)가 더해지고,
`chapterDone` 이 실어 오는 것이 한 칸(`cycle`) 늘 뿐이다. 옛 세이브도 그대로 열린다.

### 0-C-1. 연구가 **4장**에 열린다

`data/chapters.json` 4장 「첫 이웃」의 `opens` 에 `features:['research']` · `ui:['panel.research']` ·
`commands:['startResearch']` 가 들어갔다. 계약은 한 톨도 안 바뀌었다 — 여는 문은 여전히
`progression.unlockedList` 하나이고, 연구를 시작하는 것도 여전히 사람의 손(`startResearch`)이다.

새 연구 둘(`tidy_stores` 곳간 정리 · `whetstone` 숫돌)은 **금화 0 · 하루 · 티어 1~2 · 선행 없음**이다.
`research.order` 의 **맨 뒤**에 놓았다 — `order` 는 자동 플레이의 우선순위이기도 해서(playtest15c 계약)
앞에 끼우면 후반 자동 플레이가 잔가지부터 붙든다. `data/tiers.json` 의 `unlocks.research` 거울도 따라간다.

> **왜 4장인가.** 첫 주민을 기다리는 4~5장은 손이 완전히 비어 있었다(잠자리와 식량을 갖추면 남는 일이 없다).
> 연구는 값이 아니라 **하루**를 치르는 일이라 그 빈칸에 정확히 들어맞는다. 시작 금화가 20 이고 교역소
> 전에는 수입이 없으므로 **금화를 받지 않는 것**이 이 가지의 핵심이다.

### 0-C-2. 마지막 장은 끝나지 않고 **매듭**을 짓는다

`data/chapters.json` 10장에 `cycle: true` 와 칸 둘(`knot_folk` · `knot_hold`)이 생겼다.
`progression.evaluateProgress` 는 칸을 다 지났는데 다음 장이 없고 `cycle` 이 참이면,
장을 넘기는 대신 **매듭 하나를 짓고 첫 칸으로 돌아온다**.

| 자리 | 뜻 |
|---|---|
| `nation.progress.cycle: number` | 지금까지 지은 매듭 수. 옛 세이브에 없으면 0 |
| `nation.progress.mark: {population, wavesFaced, wavesHeld} \| null` | **이번 매듭이 시작될 때의 눈금**. 순환 장에 서 있는데 없으면 그 자리에서 찍는다(옛 세이브 이관) |
| `state.chapter.cycle: number` | 위 `cycle` 의 거울. 화면은 「(cycle+1)번째 매듭」을 적는다 — 다 지어야 한 매듭으로 센다 |
| `chapterDone.cycle?: number` | **있으면 매듭**이다(장이 끝난 것이 아니다). 이때 `card` 는 언제나 `null` 이고 `chapterOpen` 이 뒤따르지 않는다 |

### 0-C-3. 칸 조건의 두 칸 — `since` · `grow`/`growMax`

`condition` 에 붙는 선택 칸이다. **적지 않으면 예전 그대로**라서 1~9장의 셈은 한 톨도 달라지지 않는다.

- `since: true` — 「지금까지 얼마나」가 아니라 **「이 매듭에 들어와서 얼마나」**. `have = max(0, 현재 − 눈금)`.
  지금 받는 곳은 `population` · `wavesFaced` · `wavesHeld` 셋이다.
- `grow: n` — 매듭마다 높아지는 문턱(`need = count + n × cycle`). `growMax` 가 그 천장이다.
  **천장을 반드시 둘 것** — 없으면 언젠가 아무도 못 짓는 매듭이 온다.

### 0-C-4. 바뀌지 않은 것

- 「시간은 아무것도 열지 않는다」 — 매듭도 사람의 행동(사람이 깃들고 무리를 막는 일)이 짓는다.
- 해금 셈(`unlockedList`)·캐시 열쇠·`declaredCommands` 무변경. 매듭 칸에는 `opens` 가 없다.
- 월드 난수 무접촉. 매듭은 난수를 한 톨도 쓰지 않는다.

---

## 0-L. v3.3 안 델타 — **흔적의 링1~3: 세계가 장마다 한 겹 자란다** (§21-C1 / docs/탐험기획.md §18-1·§18-4)

**판번호를 올리지 않는다**(`world.schema` **6** 유지, `MIGRATION_REV` 그대로).
소켓 이벤트도 새로 나지 않는다 — 흔적은 이미 `world`·`state` 의 `trails` 배열로 흐르고 있었고,
링1~3 은 **그 배열이 길어지는 일**일 뿐이다. 옛 세이브도 그대로 열린다(`map.trailRings` 가 없으면 빈 목록).

### 0-L-1. 서버 상태 (저장됨)

| 자리 | 뜻 |
|---|---|
| `world.map.trailRings: number[]` | 이미 심은 링 번호. 없으면 `[]` — 옛 세이브는 다음 장이 열릴 때 링1부터 따라잡는다 |
| `world.map.trails[]` | 모양 무변경. 링1~3 의 것도 같은 한 배열에 이어 붙는다(`id` 는 `tr<n>` 이어 번호) |

### 0-L-2. 언제 자라나

`progression.onChapterOpen` 한 곳뿐이다. `data/trails.json rings[].openAtChapter`(링1=4장 · 링2=7장 · 링3=9장)에
닿으면 그 링을 **딱 한 번** 심는다. 이 문을 두 번 두지 말 것 — 지금은 「그 장이 열렸는가」만 보므로
장을 건너뛰어 열려도(디버그 `openChapterForDebug` 포함) 밀린 링을 한꺼번에 따라잡는다.

**결정론**: 링마다 제 난수(`statRng('<seed>:trails:ring2')`)다. **언제** 열리든 자리는 씨앗이 정한다 —
4·7·9장을 한꺼번에 열든 하루씩 나눠 열든 같은 씨앗이면 같은 지도다(회귀 테스트가 이 등식을 지킨다).
월드 난수(`createRng`)는 여기서도 한 톨도 쓰지 않는다.

### 0-L-3. `investigateTrail` ack — 더해진 두 칸

| 칸 | 뜻 |
|---|---|
| `joined: number` | ★ 생존자 결말이 데려온 사람 수(`reward.villager`). 0 이면 그냥 0 이다 |
| `healed: number` | **부호가 생겼다.** 양수는 회복(`reward.heal`), **음수는 그 자리에서 입은 상처**(`reward.damage`) |

`reward.damage` 는 조사한 **그 사람**의 hp 만 깎고 **1 아래로는 내리지 않는다**(GDD3 §14-6 패배 관대 —
흔적이 사람을 죽이지는 않는다). 클라는 음수 `healed` 를 붉게 내려 찍고 `hurt` 소리를 낸다.

### 0-L-4. 바뀌지 않은 것

`trails` 뷰의 모양(`id·key·kind·x·y·name·art·verb·ready`) · 마커 금지(다음 흔적의 좌표는 ack 에 없다,
여는 것은 안개뿐) · `reachTiles` 한 자 · 1차/2차(`choice`) 두 걸음 · 부재 원칙(안개 밖은 목록에서 통째로 빠진다).

---

## 0-U. v3.3 안 델타 — **유물 리워크 R1~R4: 상향·충전제·발견 서사·연출·기록과 도감·상자 밖의 것들·고대 신전** (docs/유물기획.md §20 + 팀 원안)

**판번호를 올리지 않는다**(`world.schema` **6** 유지). **필드는 더하기만 했다.**
옛 세이브의 유물에는 `chargesLeft` 가 없다 — `migrateWorld` 가 열 때 **1회분**으로 채운다
(정의표가 2·3회로 늘었다고 저장분을 소급해 늘리면 「이미 써 버린 사람」만 손해를 본다).
`state.js MIGRATION_REV` 는 2 → **3**.

### 0-U-1. 등급 체계 — **팀 원안 그대로**, 수치만 상향 (★ R1.5)

R1 이 상자 풀을 일반·레어로 좁혔던 것을 **되돌린다**. 등급 명단·상자 확률의 정본은 팀 원안이다.

| 다이얼 | 값 | 뜻 |
|---|---|---|
| `gradeWeights` | **`{common .55, rare .32, unique .08, legendary .05}`** | 네 등급 모두 상자에서 나온다. 어전 회의 상자·유적 카드 `artifactRoll`·탐험 궤가 이 표 하나를 함께 읽는다 |
| 등급 명단 | 일반 19 · 레어 17 · **유니크 6**(외형 5 + 언어의 돌) · **레전더리 7** · fixed 1 | `fixed`(왕관의 조각)만 상자 풀 밖이다 |
| `discoverChanceCap` | 0.25 → **0.30** | 행운의 부적이 +5%p 로 오른 것을 받는다 (R1 유지) |
| `luckyCharmBonus` | 0.03 → **0.05** | (R1 유지) |
| `ringDropTable` | **신설** | 탐험 궤의 유물 확률을 본영 거리로 가른다: `ringRadii [12,60,140]`(탐험기획 §18-1) · `chanceByRing [0.30,0.30,0.35,0.40]` (R1 유지) |

- `ruinGradeBoost` 는 예전처럼 `common→rare→unique→legendary` 차례로 민다.
- `data/artifacts.json grades` 에서 `chance` 를 걷었다. 등급표에 남은 것은 **표기명**뿐이고
  (`일반 / 레어 / 유니크 / 레전더리`), 상자 가중치의 정본은 위 `balance` 한 곳이다.
- 엔트리 신규 필드: `acquireVia[]`(획득 경로) · `curse: true`(대가 계열 5종) · `charges`(충전 수).
  `lore` · `hint` · `setKey` · `exclusive` · `fxTier` 는 아직 **없다**(R2~R4).
- **효과 수치는 R1 상향판이 정본이다** — 등급이 레전더리로 돌아간 항목(여행자의 인장·예언의 구슬·
  행운의 부적·봉인된 용의 비늘·용맹의 깃발·탐욕의 반지·악마와의 계약서)도 상향된 effects 를 그대로 쓴다.

### 0-U-2. 뷰 — `nation.artifacts[]` 에 충전이 실린다

```
artifacts: [{ key, name, grade, desc, type, obtainedTick, consumed, chargesLeft, charges }]
```

- `chargesLeft` 는 **남은 횟수**, `charges` 는 그 유물의 정의상 총 횟수다. 옛 세이브는 `1`(쓴 것은 `0`)이 온다.
- `consumed` 의 뜻은 그대로다 — **충전을 다 쓴 뒤에야** `true` 가 된다. `chargesLeft` 를 모르는 옛 화면은
  예전과 똑같이 굴러간다(「쓴다」 단추가 남고, 다 쓰면 「이미 썼습니다」로 바뀐다). 표시 개선은 R2 몫.
- `useArtifact {key}` ack 에 `chargesLeft` · `consumed` 가 늘었다. 남은 충전이 없으면 예전처럼 `ALREADY_USED`.

### 0-U-3. 뷰 — `wave.enemy` 에 규모 등급 칸이 생긴다 (성녀가 없을 때)

성녀가 없어도 유물이 여는 만큼만 열린다(§11-1 「잠긴 계층은 부재다」 그대로 — **연 만큼만 칸이 생긴다**).

| 유물 | `wave.enemy` 에 실리는 것 |
|---|---|
| 없음 | `{type:null, name:null, units:null, power:null, direction, sprite:null}` (옛 계약 그대로) |
| 정찰병의 망원경 | `type` · `name` · `sprite` 가 채워진다. 예고 리드 `+1일`(감시탑과 별개 소스, 중첩) |
| + 별자리 지도 | 위에 더해 **`scaleGrade`**(`"소"|"중"|"대"`). 문턱의 정본은 `data/waves.json warn.scaleGrades` |

- **마릿수(`units`)와 파워는 여전히 성녀의 몫이다.** 유물은 등급까지만 연다.
- 성녀(또는 예언의 구슬)가 있으면 예전처럼 전부 열리므로 이 칸은 나오지 않는다.

### 0-U-4. push `artifact_found` 확장 — 발견 사실 + 발견 서사 (★ R1.5)

세 경로(**어전 회의 상자 · 유적 카드 · 숨은 궤**)가 **같은 모양**의 이벤트를 낸다. 용 전리품은 제 컷신을 쓴다.

```
{ tick, kind: "artifact_found", nationId,
  data: { artifact, key, grade, category, effect, source, role,
          narrativeSeed, narrative, narrativeSource } }
```

| 필드 | 뜻 |
|---|---|
| `key` · `category` | ★ 신설. 화면이 정의표를 다시 뒤지지 않고 등급색·계열 아이콘을 고른다 |
| `source` | `"chest"` \| `"ruin"` \| `"cache"` — 어디서 나왔는가 |
| `role` | 발견처의 한국어 이름(`data/templates.ko.json artifactNarrative.sourceNames`). 옛 토스트 문구가 쓰던 칸을 그대로 이어받았다 |
| `narrativeSeed` | ★ 신설. 서사 뽑기의 씨앗 문자열. **엔진이 적고 표현 계층이 읽는다** — 월드 난수를 축내지 않는다 |
| `narrative` | ★ 신설. 발견 서사 1~2문장. **표현 계층이 채운다**(엔진 이벤트에는 없다) |
| `narrativeSource` | `"template"`(폴백) \| `"llm"` |

- **판정과 서사는 분리한다.** 엔진(`artifactFoundEvent`)은 사실과 씨앗만 낸다 — 시뮬·검사가 도는 자리에는
  난수도 LLM 도 끼어들지 않는다. 문장은 `server/expression` 이 push 직전에 얹는다.
- **LLM 이 서면** 같은 이벤트가 한 번 더 온다(`narrativeSource:"llm"`). 화면은 **새 카드를 띄우지 말고**
  이미 열린 카드의 서사 줄만 갈아 끼운다(`key` 가 같으면 같은 발견이다).
- `text`(토스트 한 줄)의 계약은 **그대로**다. 옛 화면은 `narrative` 를 몰라도 예전과 똑같이 굴러간다.
- 표현 품질(`언어의 돌`, `expressionQuality`)이 LLM 호출의 `quality` 로 전달된다 — 나라마다 이벤트 묶음당 한 번만 잰다.

### 0-U-5. push `artifact_found` 재확장 — 연출 급과 자리 (★ R2)

**필드는 더하기만 했다.** 아래 넷을 모르는 옛 화면은 R1.5 와 똑같이 굴러간다(카드 한 장 + 서사).

| 필드 | 뜻 |
|---|---|
| `fxTier` | 1~4. 획득 연출의 급. 정본은 `data/artifacts.json grades[등급].fxTier`(일반 1 · 레어 2 · 유니크 3 · 레전더리 4 · fixed 3)이고, 엔트리에 `fxTier` 를 적으면 **그것이 이긴다**(§20-11) |
| `foundBy` | 발견자 캐릭터명. 모르면 `null`(어전 회의 상자는 나라의 일이다) |
| `foundById` | 발견자 아바타 id. **화면은 이 값으로 「내가 찾았는가」를 가른다** — 내 것이 아니면 창을 띄우지 않고 방 배너와 작은 빛기둥만 |
| `nodePos` | `{x, y}` 빛기둥이 설 자리. 궤는 제 자리, 유적은 찾은 사람 자리, 상자는 도읍으로 물러선다 |

- **연출 다이얼의 정본은 `data/world.json render.artifactFx`** 다: `cardDelayMs` · `veilAlpha` · `sparkleCount` ·
  `sfx`(급→효과음 이름) · `beam{seconds,widthTiles,heightTiles,ringCount,sharedScale}` · `zoom{step,holdMs}` ·
  `vignetteSeconds` · `slowmo{scale,ms}` · `globalBannerMs`. **서버는 이 표를 한 칸도 읽지 않는다.**
- **슬로모는 렌더 이펙트다.** 이펙트 계층(`GM.fx.step`)의 시계만 잠깐 늦춘다 — 서버 tick·전투 서브틱·
  보간(`stepUnits`)은 손대지 않는다. 서버 시계는 불변이라는 계약이 그대로다.
- 연출 중 **ESC·클릭·E** 로 건너뛰면 카드만 남는다. `battleStart` 가 오면 그 자리에서 접는다(종이 이긴다).

### 0-U-6. push 신설 `artifact_global` — 레전더리는 서버 전체가 안다 (★ R2)

소켓 이벤트 이름은 **`artifactGlobal`**(`story_beat`→`storyBeat` 와 같은 규칙). **`io.emit` — 방을 넘는 유일한 유물 push 다.**

```
artifactGlobal { nationName, foundBy, artifactName, grade, text }
```

- **레전더리(`grade === "legendary"`)에서만** 나간다. 그 밖의 등급은 보내지 않는다.
- `text` 의 정본은 `data/templates.ko.json artifactGlobal`(`byFinder` / `byNation` 두 벌). 발견자를 알면
  이름이, 모르면 「군주가」가 들어간다. **화면은 제 문장을 짓지 않는다.**
- 보낼지 말지와 문구는 표현 계층의 순수 함수 `artifactGlobalPush(event, nationName, data)` 가 정한다 —
  소켓 없이도 잴 수 있다(`test/artifacts.test.js`).
- 받는 쪽은 **금띠 배너**(`.banner-relic`)로 몇 초 띄운다. 다른 방의 일이라 눌러도 열리는 곳이 없다.

### 0-U-7. `/api/config` — 등급표가 이름·색·연출 급의 정본이다 (★ R2)

`config.artifacts.grades[등급]` 이 `{ name, cls, color, fxTier }` 를 함께 내려보낸다.
클라의 `GRADES` 하드코딩은 **대비값으로 물러섰다**(규격이 아직 안 온 첫 프레임에만 쓴다) —
이제 `data/artifacts.json` 을 고치면 유물함·발견 카드·연출 급이 함께 따라온다.

### 0-U-8. 기록과 도감 — 「세계에 남은 것」 (★ R3 · 유물기획 §20-8)

**판번호를 올리지 않는다**(`world.schema` 유지). **필드는 더하기만 했다.** `state.js MIGRATION_REV` 는 3 → **4**.

#### ① 상태 — 두 곳에 적는다

```
nation.artifacts[i] += { foundBy, foundById, foundDate:{year,day}, foundRealAt }
world.artifactRegistry = { [key]: { firstFoundBy, firstFoundById, firstFoundTick, firstFoundDate, count } }
```

- 엔트리는 **「우리 나라의 것」**, 등록부는 **「이 방의 역사」**다. 유물을 다 써도, 방에 나라가 여럿이라
  같은 유물이 다시 나와도, **최초 발견자는 한 번 적히면 바뀌지 않는다**(`count` 만 쌓인다).
- `foundDate` 는 **표시 전용 달력**이다 — 정본은 `balance.time.daysPerYear` 하나뿐이고 어떤 판정도 「해」를 읽지 않는다.
- 적는 자리는 `recordArtifactFound()` 하나다. 세 경로(상자·유적·궤)는 `artifactFoundEvent` 안에서 함께 적히고,
  용 전리품은 제 컷신을 쓰므로 **기록만** 남긴다(push 없음).
- **옛 세이브**: 보유 엔트리에서 등록부를 역생성한다. 발견자는 `null` — 도감이 「전해지지 않음」이라 적는다.
  **이름을 지어내지 않는다.** 얻은 날(`obtainedTick`)은 남아 있으므로 그날은 되살린다.
- 연대기 `kind:'artifact'` 의 `title` 에 발견자를 병기한다(`「용맹의 깃발 — 아린」`). 모르면 예전 그대로.

#### ② 뷰 — `state.codex.artifacts` 신설 (4단, **서버가 자른다**)

```
codex.artifacts = { crownGrade: "legendary", totals:{found,owned,total},
                    cards: [{ key, grade, category, type, color, tier, ...단별 필드 }] }
```

| 단 | 조건 | 실리는 것 |
|---|---|---|
| 0 | 미발견 | `hint` 만. **`name` · `lore` · `record` 는 필드 자체가 없다** |
| 1 | 방에서 누가 찾음(등록부에 있음) | `name` + `record` |
| 2 | 우리 나라 보유 | 위에 더해 `desc` · `lore` · `owned` · `consumed` · `chargesLeft` |
| 3 | 기록까지 | `record.{firstFoundBy?, firstFoundDate, count, myFoundDate?, myFoundRealAt?}` |

- `crownGrade` 는 목록 맨 위 별도 단(「왕가의 보물」)에 크게 그릴 등급이다 — 미발견이어도 실루엣이 보인다.
- `codexView(nation, data, world)` — `world` 없이 부르면 `artifacts` 칸 **자체가 없다**(§11-1).
- `nation.artifacts[]` 뷰에도 `foundBy` · `foundDate` · `foundRealAt` 이 **있을 때만** 동봉된다.

#### ③ `/api/config` 정보 비대칭 — 유물도 생태계와 같은 자를 쓴다

`publicArtifacts()` 가 **이름 · 효과 서술 · `effects` · `lore` · `hint` 를 전부 잘라 낸다.**
규격에 남는 것은 화면이 **그리는 데** 필요한 것뿐이다: 등급표(`grades`)와 `{key, grade, category, type, role}`.

- 근거: 이미 `publicCreatures()` 가 종의 이름·능력치·일화를 규격에서 빼고 도감(state.codex)에만 열어 준다.
  유물 도감의 0단이 「이름을 숨기는 층」인 이상 **같은 원칙**을 따라야 한다 — 화면이 감춰도 규격이 열려 있으면
  감춘 것이 아니다. 자르지 않으면 §11-1 이 「화면의 예의」로 격하된다.
- 클라 영향 없음: 유물함·발견 카드·상자 연출은 전부 **뷰와 push** 가 준 이름을 쓴다
  (`state.artifactDef` 는 그 값들이 없을 때만 도는 대비 경로였다).

### 0-U-9. R4a — **상자 밖 축**: 신규 21종 · 세트 · 저주 봉인 · 설치형 (docs/유물기획.md §20-3~6 · §20-9 · §20-11)

**판번호를 올리지 않는다**(`world.schema` **6** 유지). **필드는 더하기만 했다.**
`state.js MIGRATION_REV` 는 5 → **6** (유물 엔트리에 `sealed`·`planted` 칸을 연다 — 없으면
`false`·`null`. 없는 것을 있다고 적지 않는다).

**정의표(`data/artifacts.json`) — 50종 → 71종.** 원안 50종은 **한 줄도 바뀌지 않았다.**

| 필드 | 뜻 |
|---|---|
| `setKey` | ★ 신설. `"genesis"` \| `"expedition"` — 세트 조각 표시 |
| `curse` | 저주 속성(기존 5종 + 신규 3종). 등급과 **직교**한다 |
| `exclusive` | ★ 신설. `"room"` — 그 방에서 한 번 나오면 끝(전설 4종). `"server"` 는 잼후 R5 |
| `acquireVia` | 값이 늘었다: `temple` · `cache3` · `event` · `chain:*` · `ruin:*` · `micro:*` |
| `type` | `"installable"` 이 늘었다(세계수의 씨앗 — 심기 전에는 아무 효과도 없다) |
| `sets` | ★ 최상위 신설 블록. `{setKey: {name, pieces[], bonuses:{"2":[...], "4":[...]}}}` |

- **상자·유적·궤 세 풀의 명단은 한 톨도 안 바뀐다.** 굴림은 `dropPool(world, nation, data, grade, via)`
  하나를 지나며, 그 경로를 `acquireVia` 에 **제 입으로 적은 것**만 남는다. 옛 50종은 전부
  `chest`·`ruin`·`cache` 를 적어 두었고 신규 21종은 셋 중 어느 것도 적지 않는다 —
  그래서 **같은 씨앗의 시뮬 결과가 완전히 동일하다**(시드 42·77 실측 확인).
- **등급표(`gradeWeights` 55/32/8/5)는 그대로다.** 표는 「보통 무엇이 나오는가」의 정본이고,
  희소는 표가 아니라 **경로**가 만든다(§20-1).
- `balance.artifacts` 신규 키: `ringDropTable.ring3UniqueChance`(0.05) · `sealCostGold`(180) ·
  `plantRadiusTiles`(24) · `templeRetryDays`(1, R4b 예약).

### 0-U-10. 명령 신설 3종

| 명령 | 인자 | 뜻 |
|---|---|---|
| `sealArtifact` | `{key, sealed?}` | 저주 봉인·해봉. 골드 `sealCostGold` 를 치른다. **기록은 남고 효과만 꺼진다** |
| `plantArtifact` | `{key, x, y}` | 설치형을 심는다. 본영에서 `plantRadiusTiles` 안. 두 번은 못 심는다 |
| `tyrantPick` | `{role}` | 폭군의 왕관이 세울 자리를 고른다. 고르기만 하고 효과는 `useArtifact` 가 낸다 |

- 셋 다 **서버가 다시 잰다** — 화면이 보낸 「저주다」·「보유했다」·「그 자리에 사람이 있다」는 믿지 않는다.
- 장 게이트(`data/chapters.json`)에는 적지 않았다 — 유물을 얻은 순간부터 쓸 수 있어야 한다.

### 0-U-11. push 신설 3종 · 뷰 더하기

| push | 실리는 것 |
|---|---|
| `artifact_grown` | `{key, name, stage, max, x, y}` — 심은 것이 한 단계 자랐다(하루 틱) |
| `artifact_sealed` | `{key, name, sealed}` — 봉인/해봉 |
| `artifact_planted` | `{key, name, x, y, tick, stage}` — 심었다 |

- 뷰 `nation.artifacts[]` 엔트리에 **`planted`** 가 더해졌다(안 심었으면 `null`).
- 뷰 `nation.artifactSets` ★ 신설 — `{setKey: {name, owned, total, tiers[]}}`. 화면이 조각 수를
  **다시 세지 않는다**(세는 규칙이 둘이 되면 언젠가 어긋난다). 하나도 안 가졌으면 빈 객체다.
- 뷰 `clientStats` 에 `moveSpeed`·`moveSpeedWave` 가 더해졌다. ⚠ **소비(`public/js/avatar.js`)는 R4b 이월** —
  그 파일은 지금 에셋 트랙이 고치고 있어 손대지 않았다. 유물이 없으면 둘 다 0 이라 지금 화면도 무해하다.

### 0-U-12. 바뀌지 않은 것

`world.schema` 6 · 등급표 55/32/8/5 · 원안 50종의 이름·효과·`acquireVia` · `artifact_found` 의 모양 ·
`artifact_global`(§20-R2) · 도감 4단(§20-R3) · `publicArtifacts()` 의 정보 비대칭(이름·효과·lore·hint 비공개).


### 0-U-15. R4d — **나머지 길**: 사슬 결말 · 땅의 변주 · 국가 이벤트 보상 (docs/유물기획.md §20-9)

§0-U-13(고대 신전)이 `temple` 계열을 열었지만, 그때까지도 신규 21종 중 **열셋은 갈 길이 없었다**.
이 절이 그 나머지를 연다. **판번호·세이브 포맷·명령 모두 무변경** — 자료 낱말 하나와 기존 명령의
ack 확장뿐이다.

| 자리 | 계약 |
|---|---|
| `data/trails.json` 결말 보상 | 낱말 **`artifact`** 신설 — `{key}`(확정, 전설이 이리로) 또는 `{via, chance?}`(풀 뽑기) |
| `investigateTrail` ack | `artifact:{key,name,grade,desc}` 가 실릴 수 있고, 그때 `events` 에 `artifact_found` 가 함께 온다 |
| `data/ruins.json` 카드 | `outcomes[].via` — 그 선택지만 여는 풀(봉분의 금기 → `ruin:barrow`, 제단의 이름 부르기 → `ruin:altar`) |
| `data/ruins.json` **`biomeCards`** | 땅별 카드 변주. 설산 유적은 「얼음 밑 돌무지」가 되고 `ruin:snow` 를 연다 |
| `data/events.json` | 국가 이벤트 `followUp.artifact` — 그 **특가 제안에 응한** 나라가 받는다 |
| `acceptOffer` ack | 같은 모양으로 `artifact` + `events` 가 실릴 수 있다 |
| 뷰 | `nation.artifacts[]` 에 `curse`·`setKey`, `planted.max`(총 단계) |
| 도감 카드 | `curse`·`setKey`·`setName`·`exclusive` 가 **0층에서도** 실린다 — 가지기 전에도 저주 표기·세트 진행이 보여야 목표가 된다. 이름·효과·이야기는 여전히 층이 열려야 나온다 |
| `/api/config` | `artifacts.list[].curse` 한 칸만 열었다(§20-6 「몰래 나쁜 것 금지」는 가지기 전에도 지켜야 한다) |
| `public/js/avatar.js` | `you.clientStats.moveSpeed`/`moveSpeedWave` 를 **드디어 읽는다**(§0-U-11 이 실어만 두었던 칸) |

**공용 문 `grantVia(world, nation, data, rng, spec, tick)`** — 사슬·유적 카드·신전·국가 이벤트가 전부
이 하나를 지난다. 이미 가진 것·이 방에서 나온 전설(`exclusive:"room"`)은 조용히 접는다.
후보가 있는 등급만 남겨 **등급표(55/32/8/5)를 다시 정규화**한다 — 풀이 좁아져도 「전설은 드물다」가 산다
(등급을 먼저 굴리고 거르면 좁은 풀은 열 번에 여덟 번 빈손으로 끝난다).

**결정론 — 이 절에서 지킨 것**
- 유적 카드 뽑기는 **언제나 한 번**. 땅의 변주는 뽑은 **뒤에** 바꿔치기한다 — `?? rng.pick(...)` 로 쓰면
  단락 평가 때문에 난수를 한 톨 덜 쓰고, 설산 유적을 한 번 연 판은 그 뒤 모든 굴림이 밀린다(회귀가 잡았다).
- `cards` 는 **12장 붙박이**, 모든 카드의 **마지막 옵션은 `leave`** — 시뮬 봇이 늘 `reject` 를 보내고
  엔진이 마지막 옵션으로 물러서기 때문이다. 새 선택지는 반드시 그 앞에 낀다.
- `data/trails.json` 의 `micro` 배열은 **한 항목도 못 늘린다**(가중 순서 뽑기라 목록 길이가 차례를 바꾼다).
  그래서 `micro:jungle`(아쿠아의 물방울)은 `chain:jungle` 로 옮겼다.
- 사슬의 유물 굴림은 statRng `` `<seed>:trail:artifact:<흔적id>` `` — 월드 난수 불침범.
- 실측: 시드42 시뮬 출력이 이 절 이전과 **완전 동일**.

### 0-U-13. R4b·R4c — **고대 신전**과 유물함의 손잡이들 (docs/유물기획.md §20-9 · §20-3·6)

**판번호를 올리지 않는다. 필드는 더하기만 했다.** 정본은 `data/ruins.json temple` + `server/engine/temple.js`.

#### ① 고대 신전 — 새 씬이 아니라 **세 번 잇는 결정 큐**

결정 종류는 `temple`(유적 카드의 `ruin` 과 다른 칸). 한 자취에서 세 번 연달아 묻는다.

| 단 | 묻는 것 | 넘어가는 조건 |
|---|---|---|
| `riddle` | 문양 셋 중 하나 | 정답 = `statRng("<seed>:temple:<nodeId>")`. 틀리면 `balance.artifacts.templeRetryDays` 만큼 물러선다 |
| `trial` | 맞선다 / 물러선다 | 지키는 것을 **세우고 눕혀야** 열린다 — 세우기 전에는 안치소가 열리지 않는다 |
| `vault` | 거둔다 / 두고 나온다 | 상자 밖 풀에서 한 점(`dropPool`). **전설이 먼저**, 없으면 고유 |

- **세상에 신전은 셋뿐이다** (★ R4e) — 설산에서 가장 깊은 자취 하나, 밀림에서 하나, 본영에서 `ruins.temple.ringRadius`(140) 밖 들판에서 **가장 먼** 하나(`templeNodes`). 유적 198곳 가운데 백 곳이 신전이면 그것은 신전이 아니라 그냥 유적이다. 자리가 정하므로 같은 씨앗의 같은 지도는 언제나 같은 세 곳을 낸다.
- **문은 발이 연다** (★ R4e): 신전은 본영에서 200타일 안팎이라 어전 행동 `explore` 로는 **닿지 않는다**(그 문은 영토 반경 49 + 일자리 26 안의 자취만 고른다). 걸어가서 손 닿는 거리(`balance.handWork.reachTiles`)에서 **E** — 명령 `enterTemple {nodeId}`. 서버가 거리를 다시 재고 결정 큐에 카드를 올린다(두 번 두드려도 안건은 하나).
- **지도에서 알아볼 수 있다** (★ R4e): 걸어 본 자리의 신전 노드에는 `temple`(종류 id)과 신전 이름이 실려 나가고(`worldState.nodes[]`), 화면은 E 안내를 「문을 두드린다」로 바꾸고 축소 지도에 금색 점을 남긴다. 안개 규칙은 그대로 — 가 본 적 없는 자리의 노드는 애초에 오지 않는다.
- **신전마다 내어주는 것이 다르다**(§20-4): 설산 `temple:snow`→얼어붙은 왕의 홀 · 밀림 `temple:jungle`→아쿠아의 성배 · 들판 `temple`→아로스의 눈. 「어느 신전을 찾아갔나」가 무엇을 얻는지 정한다.
- 신전은 **뒤지다 보면 나오는 것이 아니라 찾아가는 곳**이라, 걸어가서 문을 두드린 그 자리에서 다음 단이 열린다(§20-R4e `enterTemple`).
- ★ §22 — 여느 자취를 뒤지는 일(스윙 → 방 → 카드)과 신전의 문을 두드리는 일은 **다른 동작**이다. 한 자리에 두 문을 내지 않는다.
- 지키는 것은 `spawnGuardian` 이 **정해진 자리에** 세운다(여느 짐승의 띠 판정을 지나지 않는다 — 세상이 낳은 것이 아니라 신전이 세워 둔 것이다). 눕히면 그 자리는 다시 채워지지 않는다.
- 진행은 `nation.temples[nodeId] = {stage, failedTick, guardianId, done}` 에 저장된다.
- 카드는 `options`(열쇠말)와 함께 **`optionLabels`(한국어)** 를 싣는다. 화면은 라벨이 실려 오면 그것을 쓴다 — 한국어가 서버와 화면 두 곳에 살면 언젠가 갈린다(`council.js normDecision`).

#### ② 뷰 — 유물함이 손잡이를 붙일 자리를 안다

```
nation.artifacts[i] += { curse, sealed, setKey, plantable, picksRole }
nation.artifactSets[key].steps = [{ need, text, on }]      // 문턱의 글(data sets[key].tierText)
nation.sealCostGold
```

- **안 가진 유물의 성질은 여전히 알 수 없다.** 규격(`/api/config`)에서 유물의 속살을 걷어 낸 규칙은 그대로고(§0-U-8), 화면이 「봉인한다·심는다·자리를 고른다」 단추를 어디에 붙일지 알아야 하므로 **보유분에만** 실어 보낸다.
- 세트의 셈(`owned`·`tiers`)은 `collectHooks` 가 이미 한다 — 뷰는 문턱의 **글**만 붙인다. 문턱의 정본은 `data/artifacts.json sets[key].bonuses` 의 열쇠 하나뿐이다.
- 유물함(`public/js/artifacts.js`): 충전이 남으면 단추가 「쓴다 (2번 남음)」이라 말하고, 저주에는 봉인/해봉이, 설치형에는 「선 자리에 심는다」가, 자리를 묻는 유물에는 역할 고르기 창이 붙는다. 자리는 **선 자리**(내 아바타 좌표)이고 반경 판정은 서버가 한다.

---

## 0-E. v3.3 안 델타 — **관계 결·살아있는 세 나라** (§세계관 W4)

**판번호를 올리지 않는다. 필드는 더하기만 했다.** 정본은 `data/ai_nations.json relation` + `data/events.json nations` + `docs/세계관기획.md §3·§4`.
단순 호감도는 없다 — 같은 0~100 게이지를 쓰되 **오르내리는 규칙이 나라마다 다르다**:
에르니아(재회)=거래 금화+위신 사건(티어업·격퇴·유물), 청명(신의)=계약 이행 건수만(거절 3연속이면 쇄국),
엘라시아(세 부족)=가장 쉽게 열림. 모든 평가는 서버(advance·commands)에서만 — **시뮬 봇 경로·세계 난수 불가침**(확률은 statRng).

### 0-E-1. 서버 상태 (저장됨)

| 필드 | 뜻 |
|---|---|
| `nation.relations` | `{ai1,ai2,ai3}` 0~100. 없으면 거래 누계 × `relation.migratePerGold` 로 이관 근사(옛 세이브 후퇴 방지) |
| `nation.relMeta` | 거절 연속 장부 등 |
| `world.offerBanUntil` / `world.natEvState` / `world.relState` | 제안 중단(쇄국·부족 회의) / 국가 이벤트 예약·발화 장부 / 강재 특가 쿨타임 |

### 0-E-2. 이벤트·제안 (S→C 는 기존 `events` 피드·`offers` 재사용 — 새 소켓 이벤트 없음)

| kind | 언제 |
|---|---|
| `nation_event` | 국가 이벤트 발화(8종 — 숲 화재·부족 회의·새 문파·왕위 계승·곡물 덤핑·기근/흉작 탄원·쇄국). 효과는 기존 buffs 체계 |
| `nation_omen` | **성녀 자리가 채워져 있으면** 하루 전 예감이 먼저 온다(`events.nations.saintForewarn`) |
| `nation_contract` | 엘라시아 정기 계약(임계 30) — 매 일 틱 목재 자동 입고, 금고 빈 날은 쉼 |
| 특수 제안 | `world.offers` 에 `special:{adj, relBonus}` 로 실림(강재 특가·도움 요청·조약). **단가 보정은 respondOffer 만 채운다** — 클라 페이로드의 `_` 키는 서버가 벗긴다 |

### 0-E-3. 규칙 변경

- `respondOffer` 거절이 관계를 깎는다(나라별 `refuseDelta`). 청명은 3연속이면 쇄국(-8·제안 4틱 중단).
- **엔딩 게이트 승격**: `balance.ending` 의 거래 누계 조건 → **재회 게이지 `relations.ai3 ≥ reunionScoreMin(60)`**. 위신 사건이 게이지를 미니 관계 게이지로 채운다.
- 외교 첩(`visitNation` ack)·세계 뷰 `nations[]` 에 `relation:{score,title,nextAt}` — **만난 나라만**. 호칭: 에르니아 3단계(옛 영웅들→신흥국→{name}의 군주(들)), 청명(낯선 이방인→얼굴을 아는 손→신의를 맺은 벗), 엘라시아(가까운 이웃→오랜 벗).

## 0-D. v3.3 안 델타 — **매듭형 엔딩(초대장·재회)** (§세계관 W3)

**판번호를 올리지 않는다. 필드는 더하기만 했다.** 정본은 `data/balance.json ending` + `docs/세계관기획.md §8`.
조건 3중(티어 5 · 용 격퇴 — 웨이브 용 승리 **또는** 세계 보스 처치 · 에르니아 거래 금화 누계)이 차면
다음 일 틱에 초대장이 온다. **저절로 열리지 않는다** — 봉투 단추가 남고, 여는 것은 군주다.

### 0-D-1. 신설 — 이벤트 (S→C)

| 이벤트 | 언제 | 페이로드 | 클라가 할 일 |
|---|---|---|---|
| `endingInvite` | 조건 3중이 갓 찬 일 틱(방 전체) · 안 연 초대장이 있는 채 접속(그 소켓) | `{from, text, accept, later}` | 토스트 1회 + 봉투 단추(#ending-invite-btn). 누르면 대화창이 [간다/아직은]을 묻는다 |

### 0-D-2. 신설 — 명령 (C→S)

| 명령 | 페이로드 | 서버가 하는 일 | 거절 |
|---|---|---|---|
| `acceptEnding` | `{playerName?}` | `world.endingDone` 기록 + `ending_started` 사건 → story.js 가 엔딩·크레딧·쿠키 beat 를 얹는다(방 전체 동시 재생). 연대기에 「첫 매듭」 | `NO_INVITE` · `ALREADY` · `WAVE_DAY`(전투 중이거나 오늘이 도착일 — 「지금은 성을 비울 수 없습니다」) |

### 0-D-3. 서버 상태·보상 (저장됨)

| 필드 | 뜻 |
|---|---|
| `world.endingInviteTick` / `world.endingDone` | 초대장 온 날 / 매듭 지은 날. 엔딩은 1회 — 이후는 연대기에서 회고 |
| `nation.stats.tradeGoldWith[nationId]` | 상대별 거래 금화 누계(사고판 것 모두, respondOffer·decide 경유 포함). 재회의 W3 근사 게이지 — W4 에서 관계 게이지로 승격 예정 |
| 재회 보상 | 엔딩 뒤 영구: 에르니아 제안 빈도 ×`reunion.offerChanceMult`(rng 소비 횟수 불변 — 결정론 유지) · 에르니아에 팔 때 `reunion.sellPremium` 가산 |

- 게임은 끝나지 않는다 — 엔딩·크레딧·쿠키 동안에도 서버 시계는 흐른다(연출은 클라 오버레이).
- 스토리 beat 추가 5종: `dragon_omen`(용 웨이브 예고) · `dragon_slain`(용 웨이브 첫 승리 — **떡밥 2회차·최종**) · `ending` · `ending_credits` · `ending_cookie`. beat 조건에 `when.waveType` 추가.

## 0-H. v3.3 안 델타 — **이야기 연출(storyBeat)** (§세계관 W2)

**판번호를 올리지 않는다**(`world.schema` 유지). **필드는 더하기만 했다.**
정본은 `data/story.json` + `docs/세계관기획.md §7`. 「시간은 아무것도 열지 않는다」 —
모든 beat 의 방아쇠는 행동 이벤트(장 진행·첫 이웃·감정·웨이브)다. 시뮬·봇은 이 길을 지나지 않는다.

### 0-H-1. 신설 — 이벤트 (S→C)

| 이벤트 | 언제 | 페이로드 | 클라가 할 일 |
|---|---|---|---|
| `storyBeat` | beat 방아쇠가 당겨진 순간(방 전체 방송) · 갓 세운 세계의 첫 접속(도입) | `{id, scenes:[{speaker, text}], skippable}` — **치환은 서버가 끝냈다**({name}·{lord}·세라→성녀의 직감) | `story.js` 가 대화창(dialogue.js)에 장면을 이어 담는다. Esc = 남은 장면 전부 접기. 지도·시계는 멈추지 않는다 |

### 0-H-2. 서버 상태 (저장됨)

| 필드 | 뜻 | 옛 세이브 |
|---|---|---|
| `world.storySeen` | `{beatId: tick}` — 1회 보장 장부. 분기 beat(`excludes`)는 서로를 지운다 | 없으면: 세계가 이미 굴렀다면(`tick>0`) 전 beat 를 본 것으로 채운다 — **지난 이야기를 몰아서 틀지 않는다** |

- 첫 이민자의 이름은 **세라**로 고정된다(플레이어 나라 1인째만 — `residents.spawnResident`). 능력치·외형 규칙은 그대로다.
- 성녀 자리 기본 이름표(`npc.NPC_NAMES.saint[0]`)는 「성녀 세라」. 성녀 자리를 **사람이** 쥐면 세라 화자 beat 는 「성녀의 직감」으로 나간다.
- 연대기: `chronicle` 칸을 가진 beat 는 `kind:'story'` 항목을 남긴다 — 재접속자·늦게 온 군주의 회고 창구.

## 0-I. v3.3 안 델타 — **`worldDiff` 가 이름값을 한다** (§21-A1)

**판번호를 올리지 않는다**(`world.schema` **6** 유지). §0-W · §0-J 가 세운 기준 그대로다 —
판번호는 「세이브가 안 맞는가」로만 오른다. 세이브도 판정도 한 칸 안 바뀌었고, 바뀐 것은
**한 이벤트의 실리는 방식**뿐이다. 다만 §0-J 와 마찬가지로 더하기가 아니라 **모양이 바뀐 자리**라
아래를 정본으로 읽는다.

「왜」. 이름은 변경분(diff)인데 실제로 변경분이던 것은 안개 청크와 노드뿐이었다. 나머지는 방송마다,
사람마다 **전량**이 다시 나갔다: 건물 마흔 채(한 채에 효과표·다음 티어 값까지 1KB 가까이),
주민 서른(능력치·적성·산출), 울타리 백 조각, 야영지·군락·마을. 후반 정착지에서 한 장이 60~150KB 였고
그 가운데 실제로 달라진 것은 대개 **한 줄도 없었다** — 조용한 하루의 건물과 울타리는 어제 그대로다.
Sprint 3 의 뷰 공유 캐시가 「같은 것을 사람 수만큼 빚는」 셈은 이미 없앴다. 남은 것은 **전송량**이었다.

### 0-I-1. 나뉜 자리 — 무엇이 변경분이고 무엇이 전량인가

| 몫 | 방식 | 계약 |
|---|---|---|
| 구조물(`structures`) | **변경분** | 지난번과 **달라진 줄만**. 지으면·헐면·티어가 오르면·상하면 그 한 채가 온다. 헐린 것은 `removedStructures:[id]` 가 알린다 |
| 울타리(`fences`) | **변경분** | 같은 규칙. 실제로 달라지는 것은 `hp`(와 그에 딸린 `condition`·`broken`)뿐이라, 물어뜯긴 조각 하나만 온다. 사라진 것은 `removedFences` |
| 야영지(`camps`) | **변경분** | 같은 규칙(`removedCamps`). 정찰·타격으로 값이 바뀔 때만 실린다 |
| 군락(`clusters`) · 마을(`towns`) | **변경분** | 같은 규칙. 새로 밝아진 것과 값이 달라진 것만. 화면은 예전처럼 **쌓아 얹는다**(이 둘은 사라지지 않는다) |
| 주민(`residents`) | **아예 없다** | 사람의 목록은 **판(`state.nation.residents`)이 정본**이다. 같은 방송에서 두 벌이 나가고 있었고, 화면의 세계 병합은 애초에 판 쪽만 읽었다 |
| 아바타(`avatars`) | **매번 전량** | 걸음이 곧 위치라 거의 모든 장에서 달라지고 사람 수는 손에 꼽는다 — 골라내는 값이 아끼는 값보다 비싸다. §19-A 의 정본(`avatarViews`)도 그대로다 |
| 안개·노드 | **그대로** | §17-12 의 stamp 계약을 한 글자도 안 바꿨다(`nodes` · `removedNodes`) |

- **`full` 칸이 계약의 열쇠다**(§0-J 와 같다). `full:false` 면 변경분이고, 그 밖(`true` 이거나 아예 **없는** 경우)은 전량이다.
  → 옛 생산자(구경 모드 `public/js/mock.js`)와 즉시 공개분(`reveal:true`)이 보내는 옛 모양은 그대로 읽힌다.
- **안 바뀐 컬렉션은 열쇠말 자체가 없다.** 빠진 항목은 예나 지금이나 「바뀐 것 없음」이다.
- `counts` — 서버가 아는 줄 수(`{structures,fences,camps,clusters,towns}`). 화면이 제 장부와 견주는 도장이다.

### 0-I-2. 되맞춤 — 잃어버린 한 장을 되찾는 세 길

| 길 | 언제 | 무엇이 오는가 |
|---|---|---|
| `world` 스냅샷 | 입장 · `requestWorld` | 지도 전체(건물·울타리·군락·마을 전량). 서버는 그 사람의 장부를 비운다 |
| 첫 변경분 · 주기 되맞춤 | 장부를 연 뒤 첫 장 · `world.json simulation.worldFullEvery` 장마다 한 번(기본 **20**) | **전량 한 장**(`full:true` + `counts`) |
| `counts` 어긋남 → `requestWorld` | 화면이 제 장부의 줄 수가 서버의 것과 다른 것을 본 순간 | 위의 `world` 스냅샷(5초에 한 번까지만 청한다) |

- 장부는 **방이 아니라 세션**이 쥔다. `battleTick`(§0-J)은 방 전체가 같은 한 장을 받지만
  `worldDiff` 는 사람마다 다른 `sinceTick` 으로 나가므로 「무엇까지 받았는가」도 사람마다 다르다.
- 장부는 서버 런타임의 것이다 — 세이브에도 난수에도 닿지 않는다.

### 0-I-3. 클라가 할 일

`S.map.structures` · `S.map.fences` · `S.map.camps` 는 예전과 **똑같은 모양**을 유지한다 —
붙이는 일은 `public/js/state.js` 의 `mergeCollections()` 한 곳이 한다(전량이면 갈아 끼우고, 변경분이면
id 로 얹고 `removed*` 는 지운다). 군락·마을은 예전 그대로 쌓아 얹는다.
`counts` 가 어긋나면 `requestWorld` 로 지도를 다시 청한다.

### 0-I-4. 바뀌지 않은 것

- **판정·결정론·서버 권위** — 여기는 전송 계층이다. 회귀 시험이 「변경분을 뽑든 안 뽑든 월드가 바이트 단위로 같다」를 붙든다.
- `world` 스냅샷 · `state`(NationView) · 즉시 공개분(`reveal:true`)의 모양 — 한 글자도 안 바뀌었다.
- **장부를 안 주면 옛 계약 그대로다**(`buildWorldDiff` 를 그냥 부르면 주민까지 전량이 실린다) — 시험·단발 호출의 계약이 그대로인 까닭이다.

**실측**(건물 33채 · 주민 30 · 울타리 140조각 · 야영지 · 군락 다수의 후반 월드, 세 씨앗):
정지 상태(변화 없는 되방송 20장) **94.2~94.4%** 절감(1330KB → 75KB), 통상 플레이(20일 × 하루 4방송,
건물 신축·울타리 파손·아바타 이동 포함) **94.1~94.4%** 절감(5435KB → 306KB).
하루 틱 한 장으로는 **68.1KB → 1.5KB**(건물 23.3KB · 주민 17.1KB · 울타리 18.9KB · 군락 7.2KB 가 통째로 빠졌다).

---

## 0-J. v3.3 안 델타 — **`battleTick` 을 나눠 보낸다** (§21-A2)

**판번호를 올리지 않는다**(`world.schema` **6** 유지). §0-W 가 세운 기준 그대로다 —
판번호는 「세이브가 안 맞는가」로만 오른다. 세이브도 상태도 한 칸 안 바뀌었고, 바뀐 것은
**한 이벤트의 실리는 방식**뿐이다. 다만 이것은 더하기가 아니라 **모양이 바뀐 자리**라 아래를 정본으로 읽는다.

「왜」. 서브틱은 초에 넷이다. 그 넷 모두에 적·민병·터렛·플레이어 **전량**과 이름·최대 체력·도읍 자리까지
통째로 실었더니 전투 중 사람마다 초당 20~33KB(적 55·민병 26·터렛 10 판에서 실측)가 나갔다.
그런데 그 안에서 서브틱마다 실제로 달라지는 것은 **적의 좌표**뿐이다. 터렛은 전투 내내 한 자리에 서 있고,
이름·총원·도읍 자리는 끝날 때까지 한 글자도 안 바뀌며, 민병의 걸음은 절반 박자로도 족하다 —
화면은 `GM.interp` 가 박자를 **스스로 배워** 그 사이를 이어 준다(`public/js/interp.js` `learnGap`).

### 0-J-1. 나뉜 자리 — 무엇이 4Hz 이고 무엇이 변경분인가

| 몫 | 박자 | 계약 |
|---|---|---|
| 적(`enemies`) | **매 서브틱(4Hz) 그대로** | 보간의 전제다 — 여기를 줄이면 걸음이 끊긴다. 다만 **살아 있는 놈 전량의 동적 칸만**: `{id,x,y,hp}` + 훔치는 중이면 `looting:true`. 정적 칸(`maxHp`·`type`)은 **그 적이 처음 실릴 때 한 번만** 붙는다 |
| 민병(`militia`) · 터렛(`turrets`) | **2Hz** | 한 장 걸러 한 장에만 실리고, 그마저 **지난번과 달라진 줄만** 온다. 아무도 안 움직였으면 칸 자체가 **없다**. 터렛은 목록이 실제로 달라졌을 때만 **통째로** 다시 온다 |
| 플레이어(`players`) | **바뀔 때만** | `{id,hp,maxHp}` + 쓰러졌으면 `down:true`. 손에 꼽는 수라 최대 체력은 늘 함께 싣는다 |
| 정적 칸 | **안 보낸다** | `number`·`type`·`name`·`maxSeconds`·`core`·`total` 은 델타에 없다. 화면은 앞의 판에서 잇는다 |
| 시계·전황 | 매 서브틱 | `waveIndex`·`t`·`killed`·`escaped`·`over`·`won` — 작은 수라 그냥 싣는다 |

- **델타 한 줄은 그 유닛의 「동적 필드 한 벌」이다.** 빠진 칸은 **거짓**으로 읽는다(`looting`·`down` 은 없으면 거짓,
  `alive` 는 없으면 참). 그래서 훔치기를 그만둔 적에게 `looting:false` 를 따로 보내지 않는다.
- 정적 칸(`maxHp`·`type`)은 **앞의 판에서 잇는다** — 델타에 없다고 지우면 안 된다.

### 0-J-2. 되맞춤 — 잃어버린 한 장을 되찾는 두 길

| 길 | 언제 | 무엇이 오는가 |
|---|---|---|
| `battleStart` | 전투 개시 · **입장/관전 진입**(join 중 `nation.battle` 이 살아 있으면) | **풀 스냅샷 한 장**(옛 모양 그대로 + `full:true`) |
| `battleTick` 되맞춤 | `world.json simulation.battleFullEvery` 서브틱마다 한 번(기본 **40** = 10초) | 같은 **풀 스냅샷**(`full:true`) |

- **`full` 칸이 계약의 열쇠다.** `full:false` 면 델타이고, 그 밖(`true` 이거나 아예 **없는** 경우)은 풀 스냅샷이다.
  → 옛 생산자(구경 모드 `public/js/mock.js`)가 보내는 옛 모양은 `full` 이 없으므로 **그대로 풀로 읽힌다**.
- 풀 스냅샷을 **한 장도 못 받은 채** 델타부터 받은 화면은 그것을 **버린다**(반쪽짜리 판을 그리지 않는다).
  다음 되맞춤이 판을 다시 세운다.
- 한 사람에게만 보내는 풀(입장·관전)은 **방의 장부를 건드리지 않는다** — 그 한 장은 그 사람만 받았고,
  방의 나머지는 이미 그만큼을 알고 있다.
- `/api/debug/battle`(단숨에 끝까지 돌리기)과 전투 종료 직전의 한 장도 **풀**이다 — 델타로는 이을 수 없는 자리다.

### 0-J-3. 클라가 할 일

`S.battle` 은 예전과 **똑같은 모양**을 유지한다 — `combat.js`·`minimap.js`·`swing.js`·`hud.js` 는 한 줄도 안 바뀌었다.
붙이는 일은 `public/js/state.js` 의 `applyBattle()` 한 곳이 한다(풀이면 갈아 끼우고, 델타면 앞의 판 위에 얹는다).
`GM.combat.onTick` 이 받는 것도 **붙여 놓은 온전한 판**이다.

> ★ 보간 주의 — 제자리에 선 유닛을 띠에 다시 얹으면 안 된다. 민병이 2Hz 로 오는데 그 사이 서브틱마다
> 같은 좌표를 얹으면 띠가 250ms 박자를 배워 500ms 어치 걸음을 250ms 만에 지나간다(걷다 서다 하는 톱니).
> `combat.js pushSnapshot` 은 좌표가 앞의 것과 같으면 얹지 않는다.

### 0-J-4. 바뀌지 않은 것

- **판정·결정론·서버 권위** — 여기는 전송 계층이다. 전송 장부(`battleStreamCache`)는 월드가 아니라 **서버 런타임**이 쥐고,
  세이브에도 난수에도 닿지 않는다. 회귀 시험이 「스트림을 뽑든 안 뽑든 전투 결과가 바이트 단위로 같다」를 붙든다.
- `battleStart` · `NationView.battle`(`battleView`) · `waveResult` 의 모양 — 한 글자도 안 바뀌었다.
- `events[]` — 실리는 자리도 뜻도 그대로다(풀이든 델타든 그 서브틱에 난 사건이 함께 온다).

**실측**(적 55·민병 26·터렛 10 / 적 36·민병 34·터렛 14 / 적 77·민병 40·터렛 18, 전투 전 구간 합):
종전 대비 **66.8% · 67.6% · 69.8%** 절감(합계 **69.1%**) — 20.2~33.0 KB/s → 6.6~10.0 KB/s.

---

## 0-G. v3.3 안 델타 — **대기의 앞: 상시 예고와 야영지 선제 타격** (Sprint 5)

**판번호를 올리지 않는다**(`world.schema` **6** 유지). **필드는 더하기만 했다.**
야영지의 `hp`·`maxHp` 도, 경비 짐승도, `nation.wave.struckIndex` 도 **없으면 없는 것**으로 읽힌다 —
옛 세이브의 야영지는 체력이 `null` 이라 `strikeCamp` 가 `NO_CAMP` 로 되돌아올 뿐, 그 밖의 것은 그대로 산다.

「왜」. §19-E 가 앞당기기(`rushWave`)를 냈지만 그것은 「빨리 오게 하는」 한 갈래뿐이었다.
대기 엿새 중 앞 사흘은 **카운트다운조차 없는 사각지대**였고, 지도 가장자리에 선 야영지는
보이기만 하고 만질 수 없는 것이었다. 이 절이 그 둘을 고친다.

### 0-G-1. 바뀐 다이얼 — 예고 리드 (`data/waves.json warn`)

| 다이얼 | 옛값 | 새값 | 뜻 |
|---|---|---|---|
| `warn.hintLeadDays` | 3 | **7** | 흐린 카운트다운이 뜨는 날수. `firstDelayDays`(6)·`intervalDays[1]`(7) 이상이라 **대기 전체를 덮는다** — 사각지대가 없다 |
| `warn.campLeadDays` | 2 | **7** | 야영지가 서는 날수. 예고와 **함께** 서서 기다리는 내내 그 자리에 있다(선제 타격의 문이 열려 있으려면 서 있어야 한다) |

- 야영지가 서는 날의 **정본은 `waves.json warn.campLeadDays`** 다. `world.json camps.leadDays` 는 그 칸이
  없는 옛 자료용 대비값으로만 남는다(같은 숫자를 두 파일에 두면 반드시 어긋난다).
- 성녀의 값어치는 그대로다: `warn.saint.warnLeadDays`(4) 는 이제 **바닥**으로 읽힌다 —
  성녀가 보는 리드는 `max(hintLeadDays, saint.warnLeadDays)` 다. 옛 식(`saint ? 4 : 3`)을 그대로 두면
  성녀를 모신 나라가 D-6 에 아무것도 못 보는 뒤집힘이 난다. **차등은 날수가 아니라 정확함**이다
  (`precise` · `daysUntil` · `enemy` 구성 — 이 계약은 한 톨도 안 바뀌었다).

### 0-G-2. 신설 — 명령 (C→S)

| 명령 | 페이로드 | 서버가 하는 일 | 거절 |
|---|---|---|---|
| `strikeCamp` | `{campId?, avatarId?, playerName?}` | ★ 야영지 선제 타격. `campId` 를 안 주면 **이번 웨이브의 야영지**를 집는다. 사거리(`waves.strike.rangeTiles`)·쿨타임(`combatSwing` 과 **같은** `skills.swing` 자)·피해(`swingDamage × 장비 배수`)를 서버가 다시 잰다 | `NO_CAMP` — 칠 야영지가 없다(옛 세이브·이미 무너짐·이미 싸움이 붙음) · `OUT_OF_RANGE` — 「야영지 곁까지 걸어가야 합니다」 · `COOLDOWN`(`waitMs`·`cooldownMs` 동봉) · `DOWNED` · `CHAPTER_LOCKED`(7장 `opens.commands`) |

- **신원 명령**이다(`IDENTITY_COMMANDS`) — 누구의 손인지는 세션이 정한다. 남의 아바타 자리에서 칠 수 없다.
- ack: `{ok:true, campId, hp, maxHp, destroyed, damage, waveCancelled, xp, cooldownMs, skill:'combat', level, leveled, gearDamage, events[]}`

### 0-G-3. 신설 — 이벤트 (S→C)

| 이벤트 | 언제 | 페이로드 | 클라가 할 일 |
|---|---|---|---|
| `camp_destroyed` | 마지막 한 대가 야영지를 무너뜨렸을 때 | `{waveIndex, name, x, y}` | 야영지 마커를 걷고 알림·연대기. `strikeCamp` ack 의 `events[]` 에 실려 온다 |

### 0-G-4. 신설 — 뷰 필드 (더하기만)

| 자리 | 필드 | 뜻 |
|---|---|---|
| `camps[]`(`campViews`·`campEventView`) | `hp` · `maxHp` | ★ **가리지 않는다.** 이것은 적의 비밀이 아니라 「내 손이 남긴 자국」이다 — 가려 두면 「때렸는데 아무 일도 안 일어난다」가 된다. `power`·`units` 는 지금처럼 국방부(`canSeeTacticHint`)의 몫이다. 체력이 없는 야영지(옛 세이브·`strike.enabled=false`)는 둘 다 `null` |
| `/api/config` `waves.strike` | `{enabled, hpPerPower, rangeTiles, guards, guardSpecies}` | 규칙이지 정보가 아니다 — 화면은 이것으로 「얼마나 가까이 가야 하는가·경비가 몇인가」를 그린다 |

`nation.wave` 에는 아무것도 늘지 않았다(카운트다운은 옛 필드 `daysUntil`·`daysUntilMin` 이 그대로 낸다).

### 0-G-5. 신설 — 상태 칸(전부 기본값 있음)

| 칸 | 기본값 | 뜻 |
|---|---|---|
| `world.camps[].hp` · `.maxHp` | `0` | 야영지 체력. `maxHp = round(waveSpec.power × waves.strike.hpPerPower)` |
| `nation.wave.struckIndex` | `undefined` | 선제 타격으로 무너뜨린 마지막 웨이브 번호 |
| `nation.wave.history[].struck` | `undefined` | 그 무리는 **오기 전에** 끝났다는 표식(`won:true`) |
| `nation.wild.creatures[].camp` · `.campX` · `.campY` | `undefined` | 야영지 경비 표식. 배회하지 않고(생태 난수를 한 톨도 안 쓴다) 제 자리로 돌아오며, 띠 정원·리스폰 줄에 서지 않고, 야영지가 걷힐 때 함께 걷힌다 |

### 0-G-6. 밸런스 계약 — 곡선은 그대로다

- 부분 파괴는 그 웨이브의 머릿수를 `floor((1 − hp/maxHp) × units)` 만큼 덜어 낸다(**최소 하나는 남는다**).
  뜨는 파워도 같은 비율로 줄어든다 — 화면과 서버가 다른 저울을 쓰지 않는다.
- 전량 파괴는 웨이브를 취소하고 **막아 낸 무리로 적는다**(`wavesHeld`·`wavesFaced` 에 그대로 오른다).
  까닭은 §19-E ③ 과 같다 — 잘한 사람이 7장에 갇히면 안 된다.
- 야영지가 성하면 `startBattle` 은 옛 `spec` 을 **그대로** 쓴다: 난수의 뽑는 차례도 마릿수도 한 톨 다르지 않다.
  선제 타격은 **플레이어의 선택**이고 시뮬 봇은 쓰지 않는다 — 체크포인트 곡선은 그대로다(`rush` 와 같은 계약).
  실측(`--runs 20 --seed 42`): 4/4 통과, 웨이브별 생존율·파워·전투 시간까지 개정 전과 **한 글자도 같다**.
- 경비 배치는 `statRng(seed:camp:waveIndex)` 다 — 월드 난수도 생태 난수도 축내지 않는다(§0-O-4 와 같은 규율).

---

## 0-F4. v3.3 안 델타 — **연구 체계 개편 · 기차** (§19-F4 / QA-F4)

**판번호를 올리지 않는다**(`world.schema` **6** 유지). **필드는 더하기만 했다.**
연구소도 기차도 **없으면 없는 것**으로 읽힌다 — 옛 세이브는 한 줄도 고치지 않고 그대로 산다.

### 0-F4-1. 신설 — 명령 (C→S)

| 명령 | 페이로드 | 뜻 |
|---|---|---|
| `boardTrain` | `{trainId?}` | 정거장에 **서 있는**(`dwell>0`) 기차에 탄다. 내 아바타가 `research.trains.boardRadius`(3) 안에 있어야 한다. 실패: `NO_TRAIN` · `NO_AVATAR` · `ALREADY_ABOARD` · `NO_TRAIN_NEAR` · `TRAIN_FULL` |
| `leaveTrain` | `{}` | 스스로 내린다(다음 정거장에 닿으면 저절로도 내린다). 실패: `NOT_ABOARD` |
| `trainSummary` | `{}` | 노선 한 벌을 다시 읽는다(뷰 필드와 같은 내용) |

`boardTrain` · `leaveTrain` 의 ack 에는 `trains[]` 가 실린다. 서버는 그 순간 `avatars` 도 방에 흘린다 —
**탄 사람의 몸은 서버가 옮기기** 때문이다.

### 0-F4-2. 바뀐 계약 — `lordMove` 는 **타고 있는 동안 물리쳐진다**

기차에 탄 아바타의 자리는 서버 권위다(쓰러짐 `DOWNED` 와 같은 빗장).
타고 있는 동안 `lordMove` 는 `RIDING` 으로 되돌아온다 — 클라가 옛 좌표를 되덮어
몸만 승강장에 떨어져 남는 일을 막는다. 클라는 애초에 보내지 않는다.

### 0-F4-3. 신설 — 이벤트 (S→C)

| 이벤트 | 페이로드 | 뜻 |
|---|---|---|
| `trains` | `{tick, list:[{id,x,y,to,dwell,riders[]}]}` | 기차의 자리. **1초에 한 번**, 짐승(`creatures`)과 같은 박자로 온다. 화면은 §19-B 보간 규칙 그대로 읽는다 |
| `train_arrived` | `{trainId, stationId, x, y, dropped[]}` | 정거장에 닿아 사람을 내렸다. 연대기에는 싣지 않는다 |

### 0-F4-4. 신설 — 뷰 필드 (10장이 열린 뒤에만, `rails` 와 같은 자리)

- `trains[] {id,x,y,to,dwell,riders[]}`
- `trainSummary {open,minStations,boardRadius,capacity,stations[{id,x,y}],list[]}`
- `research.labs {fields:[{key,name,bonus}], maxBonus, hasteDiscount}` — 연구소가 갈래마다 얹어 준 걸음
- `research.list[].field` (`land`|`machine`) · `research.list[].step` — 하루가 깎는 날수(연구소가 없으면 1)
- 건물 도감(`/api/config`) `defs[].requiresResearch` — 그 건물을 여는 연구(없으면 `null`)

### 0-F4-5. 신설 — 상태 칸(전부 기본값 있음)

| 칸 | 기본값 | 뜻 |
|---|---|---|
| `nation.trains[]` | `[]` | 지금 다니는 기차. 정거장이 `minStations`(2) 아래로 줄면 통째로 거둬진다 |
| `nation.nextTrainId` | `1` | 기차 번호 |

`nation.research.active.remainingDays` 는 **뜻이 그대로**다. 다만 하루가 지날 때 깎이는 값이
`1` 이 아니라 `1 + 연구소 배수`다 — 연구소가 없으면 정확히 `1` 이라 옛 판의 진행이 한 칸도 안 달라진다.
여는 문(티어·선행·골드·자재)은 **한 칸도 손대지 않았다**.

### 0-F4-6. 자료만 바뀐 것 (계약 아님)

- `data/buildings.json` — 갈래 `research`(연구) 신설 · 건물 `library`·`workshop`·`academy`·`station` 신설 · `effectRules.stackCap.researchSpeed`
- `data/research.json` — 연구마다 `field` · `labs`(분야표·합산 상한) · `trains`(노선 수치)
- `data/tiers.json` — 4단 `library` · 5단 `workshop`·`station` · 6단 `academy`

**이번에 넣지 않은 것**: 기차 **화물**, 연구 **동시 진행 2건**(`research.active` 가 한 칸뿐이라
세이브 모양과 명령 규약이 함께 바뀐다). 둘 다 후속 과제다.

---

## 0-F3. v3.3 안 델타 — **경제 콘텐츠: 무역 동기·금화 사용처·감정소·꾸미기** (§19-F3 / QA-F3)

**판번호를 올리지 않는다**(`world.schema` **6** 유지). **필드는 더하기만 했다.**
새 상태 칸은 전부 **없으면 기본값**으로 읽힌다 — 옛 세이브는 한 줄도 고치지 않고 그대로 산다.

### 0-F3-1. 신설 — 명령 (C→S)

| 명령 | 페이로드 | 뜻 |
|---|---|---|
| `buySpecialty` | `{nationId, key}` | 이웃의 특산품 하나를 금화로 산다. 교역소 해금 + 그 나라를 만나 봤을 것(`metNations`). 실패: `TRADE_LOCKED` · `NOT_MET` · `NO_ITEM` · `SOLD_OUT` · `NO_GOLD` |
| `hastenResearch` | `{}` | 붙들고 있는 연구를 금화로 하루 앞당긴다. 실패: `NO_RESEARCH` · `NO_GOLD` · `ALMOST_DONE` |
| `reappraiseLand` | `{structureId?}` | 감정소를 다시 쓴다(태그 하나 재추첨 + 넓어진 영토의 지하 공개). 실패: `NOT_APPRAISED` · `NO_STRUCTURE` · `NOT_READY` · `NO_GOLD` |
| `customizeResident` | `{residentId, name?, appearance?}` | 주민의 이름·옷을 고친다. `customizeCompanion` 과 같은 규격. 실패: `NO_RESIDENT` · `BAD_NAME` · `NOTHING_TO_CHANGE` · `NO_GOLD` |

`customizeResident` 는 **소액 금화**를 치른다(`balance.gold.customize.resident`).
`customizeCompanion` 은 같은 문을 지나가되 값이 **0** 이라 예전처럼 공짜다(§17-11 계약 유지) —
값은 자료 한 칸이므로 바꾸면 양쪽 다 곧바로 따라간다. ack 에 `gold`(남은 국고)와 `cost` 가 실린다.

### 0-F3-2. 바뀐 계약 — `trade` 의 단가에 **나라 성정**이 붙는다

`trade {nationId, side, resource, amount}` 의 상대국 시세가 이제 나라마다 다르다:

```
foreign = localPrice(상대, 자원) × (1 + priceBias) × tradeFactor(상대, 자원, side)
tradeFactor: side='buy'  → ai_nations.json  <나라>.tradeProfile.exports[자원]  (기본 1)
             side='sell' → ai_nations.json  <나라>.tradeProfile.demands[자원]  (기본 1)
```

★ **오퍼(`world.offers`)의 값은 바뀌지 않았다.** 저쪽이 보내오는 제안은 저쪽이 부르는 값 그대로다 —
성정 배수는 **직접 흥정(`trade`)에만** 붙는다. 그래서 옛 세이브의 자동 응답과 시뮬 기준선이 밀리지 않는다.

### 0-F3-3. 신설 — 뷰 필드

| 자리 | 필드 | 뜻 |
|---|---|---|
| `view.tradePartners[]` | `{id, name, buy{자원:값}, sell{자원:값}, profile{exports[],demands[]}, specialties[]}` | 만나 본 교역 상대. **관세·운임까지 얹은 실제 값**을 서버가 빚어 보낸다(교역소 해금 뒤에만 존재) |
| `view.research.haste` | `{key, gold, days, ready, room}` \| `null` | 지금 붙든 연구를 앞당길 수 있는가·얼마인가 |
| `view.reappraisal` | `{open, post, daysLeft, charges, gold}` | 감정소를 다시 쓸 수 있는가(첫 감정 뒤에만 존재) |
| `structureView` | `postAction` · `postActionLabel` | 첫 감정을 마친 감정소의 두 번째 동사(`reappraiseLand`) |
| `visitNation` 응답 | `tradeProfile` · `specialties[]` | 문 앞에서 펴는 첩에 성정과 좌판이 함께 온다 |

### 0-F3-4. 신설 — 이벤트 (S→C)

| 종류 | 페이로드 | 언제 |
|---|---|---|
| `reappraisal_ready` | `{line, gold}` | 감정소에 기운이 다시 고인 날(한 주기에 한 번만) |
| `warmth` | `{wool, morale}` | 설산 곁 정착지가 하루치 털을 껴입은 날 |

### 0-F3-5. 신설 — 상태 칸(전부 기본값 있음)

```
world.emotionDayTick        감정의 날의 틱(재감정 주기의 기준점)      없으면 0
world.lastAppraisalTick     마지막 감정/재감정의 틱                  없으면 emotionDayTick
nation.specialtyStock       {"<나라>:<물건>": {left, restockTick}}    없으면 좌판 가득
nation.reappraisalCharges   옛 지도 조각으로 얻은 재감정 표          없으면 0
nation.reappraisalCount     재감정 횟수(전용 난수의 씨앗)            없으면 0
nation.reappraisalNotifiedFor  알림을 이미 보낸 주기                 없으면 미알림
```

### 0-F3-6. 자료만 바뀐 것 (계약 아님)

- `data/ai_nations.json` — 나라마다 `tradeProfile`(exports/demands)과 `specialties[]`.
- `data/research.json` `haste` — 가속 값(연구 금화의 `goldRatio` 배, 최소 `goldMin`).
- `data/balance.json` `gold.customize` · `warmth` · `emotionDay.reappraisal`.
- `data/buildings.json` — `appraisal_post.immovable`(철거·이전 금지) · `hunter_hut.tiers[].foodValueBonus`(요리).

---

## 0-F2. v3.3 안 델타 — **세계 콘텐츠 확장: 바이옴·적·용·장비** (§19-F2 / QA-F2)

**판번호를 올리지 않는다**(`world.schema` **6** 유지). **필드는 더하기만 했다.**
옛 세이브는 지형(`world.map.terrain`)과 노드가 스냅샷에 통째로 저장돼 있으므로 **그 지도가 그대로 산다** —
새 바이옴은 **새 월드를 만들 때만** 나온다. 바이옴 배치는 난수를 한 톨도 쓰지 않으므로(위도·고도·습도만 본다)
월드 생성의 난수 소비 **차례도 횟수도 바뀌지 않는다**.

### 0-F2-1. 지형 코드 — 뒤에만 붙었다 (RLE 계약)

```
codes = [grass, forest, rock, water, fertile, snow, jungle,   ← 앞 일곱의 인덱스는 영원히 고정
         desert, marsh, ash, mush, salt, dusk]                ← ★ 새로 붙은 여섯 (7~12)
```

- 옛 세이브의 RLE 값(0~6)은 뜻이 바뀌지 않는다. 옛 클라에 새 세이브를 물리면 7 이상을 모르므로 **클라를 같이 올려야** 한다.
- `/api/config` 의 `world.terrain` 에 `moveMultiplier{}` 가 늘었다 — 밟는 땅마다의 걸음 배수(화면이 제 걸음에 곱한다).
  「어디에 무엇이 있는가」가 아니라 「밟으면 어떤가」라 공개해도 정보 비대칭이 깨지지 않는다.
- `biomeCodes[]` 는 여덟이 됐다(`snow, jungle, desert, marsh, ash, mush, salt, dusk`). 위도·문턱(`terrain.biomes.rules`)은 **여전히 내려보내지 않는다**.
- 첫 발견(`lordMove.biomes[]` · `nation.biomesSeen`)의 계약은 §0-Q-4 그대로다 — 새 여섯도 같은 문을 지난다.

### 0-F2-2. 신설 — 월드 보스(용)

| 자리 | 필드 | 뜻 |
|---|---|---|
| 스냅샷 | `world.dragon = {placed, x, y, slainTick}` | 세계에 하나뿐인 용. 없으면(옛 세이브) `undefined` — 화산재 땅이 없는 지도에서는 영영 앉지 않는다 |
| 스냅샷 | `nation.trophies = {dragon: 게임일}` | 전리품 표식. 대장간의 `requiresTrophy` 물건을 여는 유일한 열쇠 |
| 스냅샷 | `nation.dragonWarnedTick` | 굴 앞 경고를 이미 받았는가(한 번뿐) |
| ack | `lordMove.dragonWarn = {title, text, x, y}\|null` | ★ 굴 반경 안에 들어선 그 한 걸음에만 실린다 |
| ack | `combatSwing/huntSwing.boss = {title, text, gold, trophy, artifact}\|null` | ★ 용을 눕힌 그 일격에만 실린다 |

야생 짐승 목록(`wild[]`)에 `sp:"ash_wyrm"` 으로 함께 실린다 — 그리는 길도 베는 길도 여느 짐승과 같다.

### 0-F2-3. 신설 — 웨이브 구성(호위대)

| 자리 | 필드 | 뜻 |
|---|---|---|
| 웨이브 정의 | `spec.groups[] = {type, units, unitHp, unitDps, speed, sprite, rangeTiles, detonate, ...}` | ★ 무리별 구성. 호위대가 없으면 길이 1 |
| 웨이브 정의 | `spec.escort = {type, name, units}\|null` | 따라온 이웃(없으면 null) |
| 전투 상태 | `battle.spec.groups[]` · `timeline[0].groups[]` | 화면·보고가 「무엇이 섞여 왔는가」를 읽는다 |

- `spec.units` 는 여전히 **총 마릿수**이고, `spec.power` 도 옛 식 그대로다 — 총량은 한 톨도 바뀌지 않았다.
- 적 종류가 넷 늘었다(`raider · ironclad · slinger · sapper`). `rangeTiles`(붙지 않고 때리는 사거리) ·
  `detonate`(울타리에 닿는 순간 제 몸을 터뜨리는 배수)가 새 필드다. 없는 적은 옛 규칙 그대로 군다.
- 호위대는 `waves.escort.fromWave`(6) 번째 웨이브부터 붙는다 — 앞 다섯은 적 한 마리까지 옛것과 같다(밸런스 체크포인트 보존).

### 0-F2-4. 신설 — 장비

`config.equipment.tiers` 가 늘었다(무기 5→9 · 방어구 5→8). 옛 물건의 **열쇠말·값·순서는 하나도 바뀌지 않았다**.
새 필드는 `requiresTrophy`(문자열, 없으면 없음) 하나이고, `equipmentView().catalog[].requiresTrophy` 로 화면에도 내려간다.
`grades` 에 `"6": "용비늘"` 이 붙었고 스프라이트 팔레트도 여섯 칸이 됐다.

---

## 0-S. v3.2 → **v3.3** 델타 — 터렛·전투와 건설 UX (GDD3 §15-A · §15-B)

**판번호를 올린다.** 까닭은 §0-W 와 같다 — **세이브가 안 맞아서**다.
`world.schema` **5 → 6**: §15-B-3 으로 건물이 차지하는 자리가 바뀌었다(저택 3×3→3×4 · 성지 3×3→4×4 …).
옛 좌표를 그대로 읽으면 서 있던 건물끼리 겹치고 노드를 깔고 앉아 **새로 놓을 수도 헐 수도 없는 자리**가 생긴다.
자리를 서버가 임의로 재배치하는 이관은 세이브를 버리는 것보다 나쁘다 — 만나면 버리고 새로 판다
(`isLegacySnapshot` 이 `schema < 6` 을 걸러 낸다).

### 0-S-1. 신설 — 이벤트 (S→C)

| 이벤트 | 언제 | 페이로드 | 클라가 할 일 |
|---|---|---|---|
| `turretKill` | ★ §15-A-2 — 터렛이 들의 것을 잡을 때(생태계 1초 루프) | `{tick, kills:[{turretId,turretName,species,name,x,y,gained}], resources}` | 쓰러진 자리에 `gained` 를 띄우고 자원칸을 갱신 |

`turretKill.resources` 는 `residentWork.resources` 와 **같은 규약**이다 — 그 순간의 창고 잔고 전량(권위값).
`gained` 는 저장 상한을 지나 **실제로 들어간 몫**이다(가득 차면 빈 객체가 온다 — §13-A-5).
연대기(`events`)에는 싣지 않는다: 들의 것 하나가 쓰러지는 일은 나라의 사건이 아니다.

### 0-S-2. 바뀐 계약 — `creatures` 페이로드

```
creatures { tick, list:[…], shots?:[{id,key,x,y,tx,ty,targetId,damage,killed}] }
```

`shots` 는 **그 걸음에 터렛이 쏜 발**이다. 짐승 좌표와 **같은 박자·같은 묶음**으로 보낸다 —
두 채널로 나누면 궤적의 끝점이 짐승의 옛 자리에 꽂힌다. 없으면 필드 자체가 오지 않는다.

### 0-S-3. 신설 — 뷰 필드

| 자리 | 필드 | 뜻 |
|---|---|---|
| `state.nation.buildable[]` · `lockedBuildings[]` | `purpose` | ★ §15-B-2 「왜 짓는가」 한 줄(초등학생이 읽는 문장) |
| 〃 | `keyFacts[]` | ★ §15-B-2 핵심 수치 1~2개 — 1단계 효과표의 앞 두 줄 |
| `state.nation.structures[]` | `turret {dps,range}` | ★ §15-A-4 사거리 원의 재료. 지금 이 티어·이 내구도의 값 |
| `/api/config` `buildings.defs[]` | `purpose` · `tiers[].turret` | 고스트 배치 중에도 원을 그려야 하므로 도감에 실린다 |
| 〃 | `spriteScale` | ★ §19-D(F03-9) — **필드 추가만**. 그림만 키우는 덤 배율(없으면 `null` = 1배). 자리(footprint)·충돌·배치 격자·비용은 한 눈금도 달라지지 않고, 서버는 이 값을 한 번도 판정에 쓰지 않는다 — 화면(world.structureRect)만 읽는다 |

### 0-S-4. 터렛의 두 시각 (§15-A-1) — **한 발을 두 번 세지 않는다**

터렛 판정은 이제 두 곳에서 돈다. 둘은 **서로 배타**다:

| 시각 | 도는 곳 | 대상 | 박자 |
|---|---|---|---|
| 웨이브 중 | `battle.stepBattle` | 웨이브 적 | 서브틱 `0.25초` · 지속 피해(dps × dt) |
| 그 밖의 때 | `ecology.turretGuard` | 야생 짐승·포식자 | 생태계 `1초` 루프 · **한 발씩**(`fireEverySeconds` 1.5초) |

`turretGuard` 는 `nation.battle && !battle.over` 이면 **아무 일도 하지 않는다**(`skipDuringBattle`).
그래서 규모 보정(`defenseIndex`)이 세는 방어력과 실제 화력이 어긋나지 않는다.

목장 규칙(§15-A-3): `def.kind === 'animal'` 이고 `ranchOpenFor(...)` 가 참이면 **표적에서 뺀다**.
그 밖의 짐승은 온순하든 사납든 모두 표적이다.

### 0-S-5. 바뀐 계약 — `defenseIndex` 에 사거리가 들어온다 (§15-B 밸런스)

```
defenseIndex = Σ(터렛 dps × 사거리 ÷ turretRangeReference) + 민병 dps + 울타리 hp × fenceWeight
```

`waves.settlementScale.turretRangeReference`(=8, 화살탑 1단계 사거리)가 그 항이 1이 되는 기준이다.
옛 식은 dps 만 셌다 — 사거리를 올리면 실제 방어력은 오르는데 규모 보정이 그것을 못 본다.

### 0-S-6. UI 계약 — 툴팁 세 켜 (§15-B-1)

`GM.ui.tipSet(node, summary, detail, aside)` — `data-tip` / `data-tip2` / `data-tip3`.
**요약과 설명은 호버하는 순간 함께** 뜬다. 지연(550ms)은 `data-tip3`(곁가지)에만 남는다.
옛 규약의 「잠깐 두면 자세히 보입니다」 자리표시는 폐지됐다.

### 0-S-7. 신설 — **동료 봇 = 각료** (GDD3 §15-C)

**판번호를 올리지 않는다.** 더하기만 했다 — `world.schema` **6** 그대로다.
옛 세이브에 `nation.companions` 가 없으면 다음 걸음의 `syncCompanionSeats` 가 빈 명단을 열고 정원을 채운다
(§0-W 가 세운 기준: 판번호는 '세이브가 안 맞는가'로만 올린다).

#### 채널 — **새 채널을 내지 않는다**

동료는 주민이 아니라 **플레이어와 같은 아바타 실체**다. 그러므로 자리는 `avatars`, 손맛은 `swing`
— 사람이 쓰던 그 채널을 그대로 탄다. 화면은 「사람인가 동료인가」를 아이디로 뜯어보지 않고
서버가 실어 보낸 `bot` 를 읽는다(신원 판정은 서버의 몫이다).

| 자리 | 필드 | 뜻 |
|---|---|---|
| `avatars[]` (S→C) · `state.nation.avatars[]` | `bot` | ★ 이 아바타가 동료인가 |
| 〃 | `color` | ★ 이름표 빛깔(동료마다 다르다 · 사람은 없음) |
| 〃 | `role` · `roleName` | ★ 맡은 자리(감정의 날 뒤) |
| 〃 | `state` | ★ 지금 하는 일 — `node`·`site`·`creature`·`enemy`·`haul`·`rest`·`flee`·`down`·`idle` |
| `state.nation.companions[]` | `{id,seat,name,color,role,roleName,state,hp,maxHp,down}` | ★ 정원을 채운 동료 요약(명부·각료 화면) |
| `state.nation.seats` | 정수 | ★ 국가 정원(기본 5) |
| `state.nation.roles[k]` | `botId` | ★ 그 자리를 맡은 동료의 아바타 — 각료 카드와 들에 선 사람을 잇는다 |

**★ §19-A 아바타 방송의 정본** — `avatars` 이벤트 · `state.nation.avatars` · `worldDiff.avatars` 는
**같은 함수(view.avatarViews)** 가 빚는다. 서버가 `nation.avatars` 를 날것으로 흘리면 위 표의 칸
(`bot`·`color`·`role`·`roleName`·`state`·`down`·`hp`·정규화된 `appearance`)이 통째로 빠져,
화면은 같은 이름의 두 소스를 번갈아 받는다(팀원의 쓰러짐이 사라졌다 나타나고 외형이 흔들린다).
| `state.nation.members[]` | `bot` | ★ 명부에도 동료가 함께 오른다 |
| `state.you` | `autoPlay {on,active,suspendedFor,suspendSeconds}` | ★ 자동 플레이 상태(서버 권위) |
| `/api/config` | `companions {enabled,seats,nameplateColors,autoPlay}` | 규칙만. 누가 어느 자리인지는 state 로만 간다 |

#### 신설 — 명령 (C→S)

| 명령 | 페이로드 | 뜻 |
|---|---|---|
| `setAutoPlay` | `{enabled?:bool}` 또는 `{suspend:true}` | ★ 켜기·끄기 / **수동 입력이 잡혔을 때의 잠시 물러남**(끄는 것이 아니다) |
| `setRally` | `{targetId}` 또는 `{targetId:null}` | ★ §16-18 집결지 — 갓 도착한 주민이 이 일터로 곧장 간다. null 이면 걷는다 |
| `setDefenseFlag` | `{x,y}` 또는 `{x:null}` | ★ §16-19 수비 깃발 — 수비 배치 주민·국방 동료가 이 자리에 모여 선다. null 이면 걷는다 |

자동 플레이는 **연구도 붙든다**(`autoPlay.researchWhenIdle` · `researchEverySeconds`) — 다만 우선순위표를
따로 두지 않는다: `startResearch` 에 연구표 차례대로 청해 보고 처음 되는 것을 잡는다.
장 사슬의 문(`commandUnlocked`)은 그대로 지킨다. 동료에게는 시키지 않는다.

`setAutoPlay` 는 신원 고정 명령이다(`IDENTITY_COMMANDS`) — 남의 아바타를 몰라고 청할 수 없다.
`suspend` 는 `suspendSeconds`(기본 30) 뒤에 스스로 풀린다. 화면은 그 사이에도 토글을 켠 채로 그린다.

#### 자리 규칙 (심리스)

```
동료 수 = seats − max(1, 붙어 있는 사람 수)
```
사람 자리 **하나는 늘 비워 둔다** — 혼자 하는 판의 모습이 「사람 1 + 동료 4」이기 때문이다.
그래서 첫 사람은 아무도 밀어내지 않고, **둘째 사람부터** 동료가 하나씩 비켜난다.
비켜난 동료는 지워지지 않는다(이름·외형·솜씨 장부가 남는다) — 자리가 다시 비면 그 사람이 돌아온다.
나간 사람의 아바타는 `avatars` 에서 **지운다**: 남겨 두면 정원이 영영 차 있고 짐승이 허깨비를 쫓는다.

#### 두 박자 — 한 사람의 노동을 두 번 세지 않는다 (§0-S-4 와 같은 규율)

| 시각 | 도는 곳 | 몫 |
|---|---|---|
| 지켜보는 동안 | `companions.stepCompanions` (생태계 1초 루프에 편승) | 실제로 걷고 휘두른다. 흐른 초를 `liveSeconds` 에 적는다 |
| 아무도 없을 때 | `companions.stepCompanionsDay` (일 틱) | 하루에서 `liveSeconds` 를 뺀 **안 본 만큼만** 몰아 돌린다 |

동료의 스윙은 `actions.actionSwing` · `ecology.huntSwing` · `battle.combatSwing` — **사람과 같은 함수**를 부른다.
다만 `commands.applyCommand` 를 거치지 않는다: ① 순환 참조를 만들지 않고 ② 장 사슬(`evaluateProgress`)은
**사람의 손**이 여는 것이기 때문이다. 그래서 `progression.totalSwings` 는 `player.bot` 을 세지 않는다
(곳간을 채우는 자원 조건은 함께 센다 — 창고는 나라 공용이다).

#### 신설 — `skills.combat.restHealPerSecond` · `restRadiusTiles`

본부(모닥불) 반경 안에 서 있고 웨이브 중이 아니며 **무적이 돌지 않을 때** 초당 그만큼 체력이 돈다.
사람과 동료에게 똑같이 적용된다 — 규칙이 둘로 갈리면 그것은 두 게임이다.

#### 고침 — `playerRevived` 에 전용 채널이 없었다 (P1)

`player_down` 은 `playerDown` 으로 나갔지만 `player_revived` 는 `emitTypedEvent` 의 표에 없었다.
화면을 덮은 장막(`#down-veil`)이 영영 걷히지 않아 **그 뒤의 모든 클릭이 막혔다**(§15-C 연기 검사에서 드러났다).
서버에 그 한 줄을 냈고, 화면에도 스스로 걷는 안전장치를 뒀다(카운트다운이 0이 되고 2초 뒤 강제 제거).

---

## 0-R. v3.3 안 델타 — **이웃 나라 가시화** (§17-16)

**판번호를 올리지 않는다.** 더하기만 했다 — 땅도 세이브도 그대로다(`world.schema` **6** 유지).
옛 세이브에 없는 `nation.metNations` 는 처음 찾아가는 순간 빈 표에서 시작한다(없으면 「아직 아무도 못 만났다」와 같다).

세 나라는 여태 **교역 목록의 이름**이었다. 도읍 좌표는 늘 스냅샷에 실려 있었는데도 화면은 아무것도 그리지 않았고,
그래서 걸어가 볼 까닭도 없었다. 이제 도읍은 지도 위에 서고, 문 앞까지 가 본 나라의 시세는 **외교관 없이도** 열린다.

### 0-R-1. 신설 — 명령 (C→S)

| 명령 | 페이로드 | 여는 장 | 서버가 지키는 것 |
|---|---|---|---|
| `visitNation` | `{nationId}` | (장 제한 없음) | ★ §17-16 — 내 아바타가 그 도읍 중심에서 `world.towns.visitRadius`(6) 안에 서 있어야 한다. 만나면 `nation.metNations[상대] = 그 게임일`. 제 나라·없는 나라는 `NO_NATION` |

**신원 명령이다.** 찾아가는 것은 **내 발**이라, 누구의 아바타인지는 세션이 정한다(클라가 보낸 `avatarId` 는 믿지 않는다).

ack:

```
{ ok, nationId, name, concept, tagNames[], prices{자원:값}, first, tick, x, y }
```

- `first` — 이번이 **처음 만난** 것인가(화면이 문이 열리는 순간만 축하한다). 두 번째부터는 `false` 이고 `metNations` 의 날짜만 새로 적힌다.
- `prices` — 그 나라의 시세표(`foreignPriceTable`). 세계 뷰는 하루에 한 번만 흐르므로 **ack 에 실어 그 자리에서** 준다.
- 오류: `NO_AVATAR`(내 아바타가 없다) · `NO_NATION` · `NO_TOWN`(도읍을 못 찾았다) · `OUT_OF_RANGE`(더 걸어가야 한다).

서버는 이 명령이 성공하면 그 사람에게 **`worldState` 를 한 번 더 흘린다** — 문 앞에 서 있고도 하루를 기다리지 않게.

### 0-R-2. 바뀐 계약 — `worldState.nations[]` 의 마스킹

가격 마스킹의 자가 하나 늘었다. **`외교관 재임 OR 직접 찾아간 나라`** 다.

| 필드 | 옛 규칙 | 새 규칙 |
|---|---|---|
| `prices` | 외교관 있을 때만 | 외교관 **또는** `metNations` 에 적힌 나라 |
| `masked` | `!외교관` | 위의 부정 |
| `tags` | `tagsRevealed` 일 때만 | 〃 **또는** 찾아간 나라(눈으로 봤으니 안다) |
| `metTick` | (없음) | ★ 신설 — 마지막으로 다녀온 게임일. **못 만났으면 필드 자체가 없다** |
| `population` | 외교관 있을 때만 | **그대로다** — 찾아간다고 남의 호구가 세어지지는 않는다 |

발로 얻은 정보는 **사람이 자리를 비워도 남는다**: 외교관이 물러나도 다녀온 나라의 값은 계속 보인다.

### 0-R-3. 신설 — 규격 (`/api/config`)

`world.towns.visitRadius` — 화면이 「E — 찾아가기」 말머리를 **서버와 같은 자로** 잰다. 정본은 `data/world.json towns.visitRadius`.

### 0-R-4. 화면이 그리는 것 (계약이 아니라 약속)

`world.towns[]` 는 이미 `preset[{key,x,y}]` · `name` · `known` 을 실어 왔다. 화면은 그것으로
**안개가 걷힌 자리(fog≥1)에서만** 이웃 도읍의 집과 이름 현판을 그린다 — 가 보지도 않은 땅의 마을이
지도에 뜨면 탐사가 뜻을 잃는다. 스프라이트는 우리 건물과 **같은 벌**(`atlas.building` · `atlas.hall`)을 쓴다.

---

## 0-Q. v3.3 안 델타 — **탐험 확대 · 바이옴 · 맵 확장** (§17-17)

**판번호를 올리지 않는다**(`world.schema` **6** 유지). 다만 **지형 코드 계약이 바뀌었다** — 아래 0-Q-1 은
이 문서에서 드물게 「깨질 수 있는 변경」이니 클라·세이브를 같이 올려야 한다.

옛 세이브에 없는 `nation.biomesSeen` 은 빈 표에서 시작한다(= 「아직 새 땅을 밟지 않았다」).

### 0-Q-1. ★ 계약 변경 — 지형 코드 두 개 추가

`data/world.json terrain.codes` 는 곧 **RLE 전송값**이다(`world.terrain.rle` · `worldDiff` 는 이 배열의 **인덱스**를 싣는다).

```
옛: ["grass","forest","rock","water","fertile"]                       (0~4)
새: ["grass","forest","rock","water","fertile","snow","jungle"]       (0~6)
```

- **앞 다섯의 순서는 영원히 고정이다.** 새 지형은 **뒤에만** 붙일 수 있다 — 앞을 건드리면 옛 세이브의
  지형 문자열과 화면의 색표가 통째로 어긋난다(회귀: `test/playtest17e.test.js` 「바이옴 계약」).
- `terrain.walkable` 에 `snow`·`jungle` 이, `terrain.buildable` 에 `jungle` 만 들어간다(설산에는 못 짓는다).
- 물 판정(`isWaterAt`)은 그대로다 — 설산도 밀림도 물이 아니므로 짐승·적의 물 금지 규칙은 손대지 않았다.
- `/api/config` 의 `world.terrain` 에 `biomeCodes[]`(= `["snow","jungle"]`)가 늘었다.
  **어디에 나는가**(위도 경계·고도/습도 문턱·보호 반경)는 지형 시드와 같은 급의 비밀이라 내려보내지 않는다.

배치 규칙(서버 안쪽, 참고용): 지도 북쪽 띠에서 고도가 높으면 설산, 남쪽 띠에서 습도가 높으면 밀림.
**지도 한복판 `protectRadius`(60)타일 안은 옛 다섯 지형 그대로**라 초반 밸런스는 움직이지 않는다.
난수를 한 톨도 쓰지 않으므로 같은 씨앗은 같은 자리에 같은 바이옴을 낸다.

### 0-Q-2. 맵 384×384

`world.size` 256 → **384**(면적 2.25배). 규약 자체는 그대로다 — 지형은 RLE, 안개는 청크(16) RLE 라
전송량은 「탐사한 만큼」만 자란다(청크 수 256 → 576). 스냅샷·`worldDiff` 의 모양은 한 글자도 안 바뀐다.

같이 움직인 규격(`/api/config`):

| 값 | 옛 | 새 | 까닭 |
|---|---|---|---|
| `world.territory.claim.maxRangeFromTown` | 70 | **110** | 넓어진 지도에서 옛 값은 본영 코앞만 허락한다 |
| `world.territory.claim.maxClaims` | 4 | **6** | 다른 나라들 사이에 우리 땅을 여럿 박아 두는 것이 깃발 멀티의 그림이다 |

규약 밖이지만 같이 봐야 할 것 — **화면이 한 판에 훑는 칸 수**. 월드 렌더와 안개(`world.js`)는 옛날부터
보이는 칸만 돌므로 지도가 넓어져도 값이 그대로다. 지도 전체를 훑던 자리는 둘뿐이었고 둘 다 §17-17 에서 고쳤다:

- **축소 지도의 안개**(`minimap.js`) — 매 프레임 384²(147,456)칸을 훑던 것을 한 판 구워 두고
  `map.fogDirty` 가 설 때만 다시 굽는다. 캔버스 명령이 프레임당 822 → 1 로 준다.
- **지형 축소본·지형 청크 캐시** — 축소본은 `ImageData` 한 판으로 굽고(캔버스 명령 148,278 → 3),
  구워 둔 지형 청크는 192장까지만 들고 있다(청크가 576장으로 늘어 캐시만 150MB 를 넘던 것을 막는다).

### 0-Q-3. 신설 노드 — `cache`(숨은 궤)

| 필드 | 값 | 뜻 |
|---|---|---|
| `type` | `"cache"` | `nodes[]` 에 다른 노드와 똑같이 실린다 |
| `concealed` | 대개 `true` | ★ 신설 — **종류 자체가 숨은** 노드다(옛날엔 유적만 그랬다). 가까이 가야 `revealed` 가 서고, 그 전에는 스냅샷·`worldDiff` 에 실리지 않는다 |

- 여는 법은 새 명령이 아니라 **기존 `actionSwing {nodeId}`** 다(`skills.nodes.cache`: 건설 솜씨 · 3스윙).
- 세 번째 스윙(주기 완료)의 ack 에 `cache` 가 실린다:

```
{ ok, ..., cache: { nodeId, gold, artifact: {key,name,grade}|null, total } }
```

- 열면 그 노드는 **세상에서 지워진다**(`removeNode`) — 그루터기(`depleted`)가 아니다.
  다음 `worldDiff.removedNodes` 에도 실리므로 화면은 장부에서 지운다. 다시 치면 `BAD_NODE`.
- 보상 난수는 **월드 난수가 아니다**: `statRng("<seed>:cache:<nodeId>")` 로 굴린다. 그래서
  ① 실시간 스윙이 시뮬 결정론을 축내지 않고 ② 같은 지도의 같은 궤는 언제 열어도 같은 것을 낸다.
- `lordMove` ack 에 `revealedKinds[]`(찾은 은닉 노드의 종류)가 늘었다 — 화면이 「옛 자취」와 「숨은 궤」를 가려 말한다.

### 0-Q-4. 신설 — `nation.biomesSeen` 과 첫 발견

```
nation.biomesSeen = { snow: 12, jungle: 30 }      // 지형코드 → 처음 밟은 게임일
```

- `worldState.nation.biomesSeen` 으로 매번 내려간다(빈 표여도 필드는 있다).
- 판정은 **발**이다: 아바타·동료가 **선 칸**의 지형이 처음 보는 바이옴이면 그 자리에서 적힌다.
  안개가 걷힌 땅 전체를 훑지 않는다(멀리서 흰 산줄기를 본 것과 그 위에 서는 것은 다르다).
- 문은 둘이다 — `lordMove`(걸음마다) · 일 틱(동료가 혼자 걸어 들어간 경우).
- 몫은 한 번뿐: 사기 `terrain.biomes.discovery.morale` + 연대기 한 줄(`kind: "discovery"`).
- `lordMove` ack 에 `biomes[]` 가 실리고, 같은 내용이 이벤트로도 나간다:

```
biomes: [{ code, name, text, morale, tick }]
event: { kind: "biome_found", nationId, data: {위와 같음} }
```

문구(`text`)의 정본은 `data/world.json terrain.biomes.discovery.text` 하나다 — 화면이 제 낱말을 만들지 않는다.

### 0-Q-5. 고친 버그 — 유적 등급 보정이 굴림에 실린다

`actionSwing` 이 뒤진 유적의 `gradeBoost` 를 `nation.ruinGradeBoost` 에 쌓아 두기만 하고,
유적 카드를 여는 `decide` 경로가 그것을 **읽지 않았다**. 「죽은 자의 성채」를 스무 번 두드려도 나오는 물건의 급이
「옛 자취」와 같았다. 이제 `artifactRoll` 이 그 값을 등급표 위에 얹고(common→rare — ★ §20-R1 이후 상자 풀이 두 등급뿐이라 천장이 레어다),
규약 표면(ack 모양)은 그대로다 — 나오는 물건의 등급 분포만 스펙대로 움직인다.

> ★ §22 갱신 — 보정을 **나라에 쌓았다가 쓴 즉시 0 으로 되돌리는** 방식은 폐지됐다.
> 「쓰고 되돌린다」는 규율을 부르는 쪽마다 지켜야 하는데 궤·상자·유적 셋이 같은 통을 보므로
> 언젠가 두 번 얹히거나 엉뚱한 굴림이 가져간다. 이제 보정은 그것을 번 **방**의 것이고
> 결정에 실려 다닌다(`decision.ruin.gradeBoost`). `nation.ruinGradeBoost` 는 사라졌다.

---

## 0-X. §22 유적 개편 — **한 자리에서 끝나는 이야기**

설계 정본은 `docs/유적개편기획.md`. 구 `docs/GAMEPLAY2.md §C-4`(게이지 3 → 카드)를 대체한다.

**고친 것 — 도달 불가능했던 콘텐츠.** 게이지를 소비하고 카드를 뽑는 코드가 오직
`apAction {type:'explore'}` 안에만 있었는데 클라가 그 명령을 **한 번도 부르지 않았다**.
카드 12장과 `gradeBoost` 가 통째로 죽어 있었고, 화면에는 `옛 자취 4/3` 이라는 넘어도
아무 일 없는 분수만 떴다. (같은 문에 갇혀 있던 신전은 §20-R4e 가 `enterTemple` 로 따로 열었다.)

**새 규칙.** 유적은 **방 단위**로 열린다. 방 하나(`node.swingsPerCycle` = 크기표의 `roomSwings`)를
다 뒤지면 그 자리에서 카드 한 장이 결정 큐에 오르고 `ruinEvent` 가 나간다 — 나라의 게이지도
왕의 행동력도 거치지 않는다. 크기가 곧 방의 수다(1·2·3·4방 / 방당 4·4·5·6 스윙).

| 낱말 | 어디에 | 뜻 |
|---|---|---|
| `node.rooms` | 노드·노드뷰 | 이 자취의 방 수 |
| `node.roomsOpened` | 노드·노드뷰 | 이미 연 방 수 |
| `node.spent` | 노드·노드뷰 | 다 뒤졌다 — 자리는 **남되** 다시 두드려지지 않는다 |
| `actionSwing.ruin` | ack | `{room, rooms, spent, size, name, card}` (구 `{gauge, threshold}` 폐지) |
| `decision.ruin.gradeBoost` | 결정 큐 | 그 방이 번 등급 보정 |
| `ruinSizes.roomBoostCurve` | `data/world.json` | 방 깊이(0~1 정규화)별 보정 비율 |
| `ruins.roomDepth` | `data/ruins.json` | 얕은 방·깊은 방의 카드 명단 |

- 새 오류: `RUIN_SPENT`(다 뒤진 자리를 또 두드렸다) — `{nodeId, spent:true}` 를 함께 준다.
- 폐지: `nation.ruinGauge` · `nation.ruinGradeBoost` · `data.ruins.gaugeThreshold` ·
  `NationView.ruinGauge` · `NationView.ruinThreshold` · `apAction {type:'explore'}` · `consumeRuinGradeBoost()`.
- 카드 굴림은 **월드 난수를 쓰지 않는다** — `statRng('<씨앗>:ruin:<노드id>:<방번호>')`.
  실시간 스윙이 월드 난수를 축내면 같은 씨앗이 다른 게임이 된다(궤와 같은 까닭).
  덤으로 「같은 지도의 같은 방은 언제 열어도 같은 카드」가 따라온다.
- `decisionId` 가 `ruin_<나라>_<노드>_<방>_<틱>_<카드>` 로 길어졌다. 방 사이가 4~6 스윙이라
  **같은 틱에 방 둘을 여는 일이 흔한데**, 옛 열쇠(`나라_틱_카드`)로는 하나가 삼켜졌다.
- `actionSwing.swingsPerCycle` 이 이제 규격이 아니라 **그 노드의 값**이다. 여태 유적에서만
  진행바가 어긋났다(자취는 4~6, 규격은 4).
- `apAction` 자체는 남는다 — `'inspire'`·`'survey'` 가 아직 이 문을 쓴다(클라 미연결은 별건).
- **신전(§20-R4e)과의 경계**: 신전 셋은 이 경로로 열리지 않는다. 저기는 방이 아니라 문이다.

### 0-X-2. 단서 (§22-2 층3) — 유적이 다음 유적을 부른다

깊은 방 카드의 갈래가 `op: 'clue'` 를 적으면, 답한 그 자리에서 **다른 자취 둘레의 안개가 열린다**.

| 낱말 | 어디에 | 뜻 |
|---|---|---|
| `ruins.clue` | `data/ruins.json` | 반경·거리 띠·방위 이름·땅 이름·문구 |
| `decide.ruin.clue` | ack | `{dir, land}` **두 낱말뿐** — 좌표도 대상 id 도 없다 |
| `node.clueGiven` | 노드 | 이 자취는 이미 한 곳을 가리켰다 |
| `nation.clueSeen` | 나라 | 이미 가리켜진 자취들(한 곳을 두 번 가리키지 않는다) |

- **마커 금지가 규약이다.** `decide` 의 ack 에서 `revealed`(좌표 목록)는 **지워져 나간다** —
  `investigateTrail` 과 같은 자리에서 같은 방식이다(`server/index.js`). 안개는 `worldDiff` 로 흐른다.
  화면이 다음 자취의 좌표를 알면 그 순간 마커가 된다(탐험기획 §18-3 규율 ①).
- 고르는 규칙 넷: 아직 손 안 댄 자취 · `minDistance`~`maxDistance`(**이 자취에서** 잰다) ·
  이미 가리킨 적 없는 곳 · 한 자취는 한 곳만.
- 굴림은 `statRng('<씨앗>:clue:<노드id>')` — 월드 난수 불침범.
- 반대 방향: 흔적 사슬 결말의 `spawnNode {type:'ruin', size}` 가 자취를 낳는다.
  규격은 `world.applyRuinSpec()` 한 벌이 입힌다 — 지도 생성과 사슬이 같은 문을 쓴다.
- 고친 버그: `ruin_resolved` 사건이 `e.text` 가 없어 클라 사건 처리기에서 통째로 걷혔다.
  카드에 답해도 화면에 아무것도 안 떴다.

---

## 0-P. v3.3 안 델타 — **손과 잠과 동료** (§17-7 · §17-9 · §17-11)

**판번호를 올리지 않는다.** 더하기만 했다 — 땅도 세이브도 그대로다(`world.schema` **6** 유지).
옛 세이브에 없는 `nation.sleepVotes` · `structure.hand` · `structure.handTickBy` · `companion.mem.order` 는
처음 쓰이는 순간 빈 표에서 시작한다(없으면 「아무도 안 잤다 · 아무도 안 거들었다 · 지시 없음」과 같다).

이 절은 **뒤늦은 기록**이다. 아래 네 명령은 배치5(§17)에서 이미 서버에 서 있었는데 이 문서에만 없었다.
그래서 여기 적는 것은 설계가 아니라 **실제 구현**이다 — `server/engine/commands.js` · `server/index.js` 가 정본이고
이 표는 그것을 옮겨 적은 것이다.

### 0-P-1. 신설 — 명령 (C→S)

| 명령 | 페이로드 | 여는 장 | 서버가 지키는 것 |
|---|---|---|---|
| `sleepVote` | `{on?: boolean}` | (장 제한 없음) | ★ §17-7 — **신원 명령**. 내 아바타의 표 하나. `on:false` 면 표를 걷는다. 봇(동료)은 세지 않는다 — 사람 아바타 전원이 잠들어야 하루가 넘어간다 |
| `handWork` | `{structureId}` | (장 제한 없음) | ★ §17-9 — **신원 명령**. 그 건물에 `buildings.json handWork` 가 있어야 하고, 내 아바타가 `balance.handWork.reachTiles`(3.2) + 발자국 절반 안에 서 있어야 한다. 비용·산출·쿨다운은 전부 자료가 정한다(매직넘버 없음) |
| `commandCompanion` | `{companionId, order: {kind:'move', x, y} \| null}` | (장 제한 없음) | ★ §17-11 — 신원 명령이 **아니다**(내 아바타가 아니라 동료를 겨눈다). `order:null` 은 지시를 걷는 것. `kind` 는 지금 `'move'` 하나뿐이고 좌표는 지도 안이어야 한다 |
| `customizeCompanion` | `{companionId, name?, appearance?}` | (장 제한 없음) | ★ §17-11 — 이름은 1~`world.appearance.nameMaxLength` 자. 외형은 `setAppearance` 와 **같은 규격**이며 범위를 벗어난 칸만 지금 모습으로 되돌린다(전체 거부 금지). 둘 다 없으면 `NOTHING_TO_CHANGE` |

### 0-P-2. `sleepVote` — 하루를 넘기는 유일한 사람 손

ack:

```
{ ok, slept, need, advanceDay }
```

- `slept` / `need` — 잠든 사람 수 / 사람 아바타 수(동료 봇 제외). 화면은 「잠듦 2/3」을 이 두 값으로 쓴다.
- `advanceDay` — **이 표로 하루가 넘어갔는가.** `true` 면 서버가 그 자리에서 `advance()` 를 한 번 돌리고
  **일 틱 시계를 새로 감는다**(`stop()` → `start()`). 그래야 다음 하루가 넘긴 순간부터 온전히 흐른다.
  넘어간 뒤 표는 비워진다 — 다음 날은 다시 처음부터 잠들어야 한다.
- 오류: `NO_NATION`(사람의 나라가 아니다) · `BATTLE_LIVE`(싸움 중에는 못 잔다) · `NO_AVATAR`.
- **뷰 필드가 없다.** 잠든 표는 상태에 실리지 않고 ack 로만 온다 — 화면이 제 단추 모양을 ack 로 고쳐 그린다.
  (여럿이 붙어 있을 때 남의 표가 실시간으로 보이지는 않는다. 다음 상태 방송이 아니라 **다음 내 표**에서 맞춰진다.)

### 0-P-3. `handWork` — 건물 곁에서 직접 거드는 손

ack:

```
{ ok, structureId, key, label, gained{자원:실적립}, healed, gold, buildPoints,
  morale, xp, x, y, resources{…} }
```

- `gained` 는 **창고 상한을 지난 뒤의 실제 적립량**이다(`deposit`). 곳간이 찼으면 0 이 실린다 — 화면은 이 값으로 팝을 띄운다.
- `x`·`y` 는 건물 **중심**(발자국을 감안한 자리). 이펙트를 여기 띄우라는 뜻이다.
- `label` 은 자료가 쥔 그 건물의 손일 이름(「손수 제련한다」 따위).
- `morale` 은 사기가 오른 명령일 때만 숫자, 아니면 `null`. `xp` 는 `{skill, ...}` 또는 `null`.
- 쿨다운은 **두 자** 중 하나다: `cooldownSeconds`(실시간, 사람마다 따로 — `structure.hand[누구]`)
  또는 `cooldownDays`(하루 한 번 — `structure.handTickBy[누구]`, 성소의 기도가 이것). 둘 다 **사람별**이다.
- 오류: `NO_STRUCTURE` · `RUINED` · `INACTIVE`(옮기는 중) · `NO_HANDWORK`(거들 손일이 없는 건물) ·
  `NO_AVATAR` · `OUT_OF_RANGE` · `COOLDOWN`(실시간 쿨다운이면 `{waitMs}` 를 함께 준다) · `NO_RESOURCES`.
- `StructureView.handWork` — 그 건물에 손일이 있으면 정의를 그대로 실어 준다(없으면 `null`).
  화면은 이것을 보고 건물 곁 단추와 비용 툴팁을 그린다. **비용·산출을 화면이 짓지 않는다.**

### 0-P-4. `commandCompanion` · `customizeCompanion` — 동료

ack:

```
commandCompanion   { ok, companionId, order }        // order 는 {kind:'move',x,y} 또는 null
customizeCompanion { ok, companionId, name, appearance }
```

- 지시는 동료 두뇌(`companions.decide`)의 **어떤 갈래보다 먼저** 선다. 지시를 받은 동료는 하던 일을 그 자리에서 물리고
  (`mem.target=null`·`mem.think=0`) 찍힌 자리로 걸어가 대기한다. `order:null` 이면 다음 걸음에 제 일감을 다시 고른다.
- 꾸미기는 **세 장부에 같은 값을 적는다** — 동료 명단 · 아바타 · 명부(`members`), 그리고 각료 카드의 이름표까지.
  명부와 머리 위 이름표가 갈리면 같은 사람이 둘로 보인다.
- 서버는 `customizeCompanion` 이 성공하면 방 전체에 **`avatars` 를 그 자리에서 흘린다**(`setAppearance` 와 같은 규율).
  다음 상태 방송을 기다리면 이름표가 잠깐 옛 사람으로 남는다.
- 오류: `NO_COMPANION` · `COMPANION_AWAY`(자리를 비운 동료) · `BAD_ORDER`(모르는 지시) ·
  `BAD_POSITION`(지도 밖) · `BAD_NAME` · `NOTHING_TO_CHANGE`.

---

## 0-O. v3.3 안 델타 — **링0 앞마당의 흔적** (§18-2 · §18-3 · §18-5 / 배치 D-2)

**판번호를 올리지 않는다.** 더하기만 했다 — 땅도 세이브도 그대로다(`world.schema` **6** 유지).
옛 세이브에 없는 `world.map.trails` 는 빈 목록으로 읽힌다(흔적이 없는 판 = 예전 그대로의 앞마당).
설계 정본은 `docs/탐험기획.md` §18, 수치·문구의 정본은 `data/trails.json`, 규칙의 정본은 `server/engine/trails.js` 다.

**왜 넣었나** — 첫 사흘의 앞마당이 비어 있었다. 마차에서 내리면 나무와 돌뿐이라 걸어 나갈 이유가
「아직 안 가 본 곳」밖에 없었다. 흔적은 호기심에 **방향**을 준다: 발자국 하나가 다음 발자국을 부르고,
그 끝에 이야기가 있다. 링0(본영 12타일) 안에 짧은 사슬 1개 + 미시 발견 4~6개를 **보장** 생성한다.

### 0-O-1. 신설 — 명령 (C→S)

| 명령 | 페이로드 | 여는 장 | 서버가 지키는 것 |
|---|---|---|---|
| `investigateTrail` | `{trailId, choice?}` | (장 제한 없음) | ★ §18-D2 — **신원 명령**. 내 아바타가 `trails.json reachTiles`(3.2) 안에 서 있어야 한다. `choice` 없이 부르면 1차(펼치기), 있으면 2차(확정)다. 보상·문구·굴림 무게는 전부 자료가 정한다(매직넘버 없음) |

ack:

```
{ ok, trailId, key, kind, name, done, ready,
  dialogue: { speaker, portraitKey, lines[], choices[{key,label}] },
  pending?, gained{자원:실적립}, morale, healed, node }
```

- `dialogue` 는 **대화창(§0-S-7 계열 · 탐험기획 §18-6)이 그대로 읽는 한 벌**이다.
  `GM.dialogue.open({speaker, portraitKey, lines, choices})` 에 그대로 넘어간다 — **화면은 문구를 짓지 않는다.**
- `pending:true` — 1차에서 선택지를 편 상태. 이때 흔적은 **소진되지 않는다**(`done:false`).
  화면은 선택지를 그리고, 고른 값을 `choice` 에 실어 **같은 명령을 한 번 더** 보낸다.
- `gained` 는 창고 상한을 지난 뒤의 실제 적립량(`deposit`). `healed` 는 **두레박을 내린 그 사람**의 회복량이다.
- `node` — 결말이 땅에 남긴 자원 자리(`{id, type}`) 또는 `null`. 딸기 군락 결말이 이 길로 온다.
- 오류: `NO_TRAIL`(없거나 소진됐거나 아직 덮여 있다) · `NO_AVATAR` · `OUT_OF_RANGE` ·
  `COOLDOWN`(하루 한 번짜리를 오늘 이미 썼다) · `NO_CHOICE`(살피기 전에 선택부터 보냈다) ·
  `BAD_CHOICE` · `NO_RESOURCES`(선택의 값을 못 치른다).

### 0-O-2. 신설 — 뷰 필드 `trails[]`

`world` 스냅샷 · `worldDiff` · **즉시 공개분(reveal diff)** 셋 모두에 실린다.

```
TrailView { id, key, kind:'chain'|'micro', x, y, name, art, verb, ready }
```

- **부재 원칙** — 안 보이는 것은 마스킹이 아니라 **목록에서 빠진다**. 빠지는 조건 셋:
  ① 아직 안 가 본 자리(`fog < 1`) ② 조사로 소진된 흔적 ③ **아직 덮여 있는 사슬 단계**(`hidden`).
  ③ 이 ①보다 먼저 선다 — 안개가 열려 있어도 앞 단계를 조사하기 전에는 다음 발자국이 없다.
- **누적이 아니라 교체다.** 노드처럼 `removedNodes` 같은 장부를 두지 않는다. 링0 안에 많아야 예닐곱이라
  변경분을 가려내는 값이 목록 자체보다 비싸고, 목록에서 빠지는 것 하나가 곧 「화면에서 지워라」다.
- `verb`·`name`·`art` 는 자료가 쥔 값을 그대로 옮긴 것이다. 화면의 말머리 상자는 `verb` 를 그대로 쓴다.
- `ready:false` — 하루 한 번짜리를 오늘 이미 썼다(옛 우물). **사라지지 않고 흐리게 남는다** — 내일 다시 온다.

### 0-O-3. 조사가 여는 것은 **안개뿐이다** (§18-3 마커 금지)

사슬 한 단계를 조사하면 서버는 ⓐ 다음 단계의 `hidden` 을 벗기고 ⓑ **그 둘레의 안개만** 연다
(`steps[].revealRadius`). 그리고 **ack 에는 그 자리를 싣지 않는다** — `server/index.js` 가
`res.revealed`(청크 목록)를 즉시분 `worldDiff` 로 흘려보낸 뒤 ack 에서 지운다.

이것이 계약인 까닭: 좌표가 ack 에 실리면 화면이 화살표를 그릴 수 있게 된다. 그 순간 이 시스템은
「따라가는 놀이」가 아니라 「지시받은 심부름」이 된다. **발견의 저작권은 플레이어에게 있다.**

### 0-O-4. 흔적은 **월드 난수를 축내지 않는다** (§0-W-4 · §0-V-5 와 같은 규율)

- 배치: 월드 생성 끝머리에 `statRng('<씨앗>:trails:ring0')` 로 자리를 정한다(`generateWorldMap`).
  **월드 난수(`createRng`)를 한 톨도 쓰지 않는다** — 여기서 한 칸이라도 밀면 웨이브 구성·사건·이름이
  통째로 어긋나 「같은 씨앗 같은 판」이 깨진다.
- 결말 굴림: `statRng('<씨앗>:trail:<흔적 id>')` 의 가중 굴림. 실시간 명령이라 더더욱 세계 난수를 못 쓴다
  (§13-C 에서 이미 겪은 사고 — `actions.openCache` 와 같은 까닭).
- 그래서 「같은 지도의 같은 사슬은 언제 따라가도 같은 끝을 낸다」가 공짜로 따라온다.
- 2단계 선택의 상태는 서버가 `trail.pending` 한 글자만 쥔다. 대화의 나머지 상태는 화면 몫이다.

### 0-O-5. 신설 — 규격 (`/api/config`)

`world.trails.reachTiles` — 흔적에 손이 닿는 거리. 화면의 말머리 상자와 E 판정이 **서버와 같은 자**로 재게 하려는 것뿐이다.
**무엇이 어디 있는지·무슨 보상이 나오는지는 여기 없다**(정보 비대칭 — 사슬의 다음 발자국은 안개가 열려야만 온다).

---

## 0-M. v3.3 안 델타 — **진행 흐름과 경제** (§19-E · QA1차 F04-4~7 · F04-9 · F06-1)

**판번호를 올리지 않는다.** 전부 **더하기**다 — 삭제도 의미 변경도 없고 `world.schema` **6** 그대로다.
옛 세이브에 없는 것(`nation.wave.rushedIndex`)은 없으면 `undefined` 로 읽히고 뷰가 `false` 를 내므로
그대로 돈다. 장 진행(`nation.progress`)의 뜻도 바뀌지 않았다 — 7장 마지막 칸의 조건이 **넓어졌을 뿐**이라
이미 그 칸을 통과한 세이브는 통과한 채로 남는다.

### 0-M-1. 신설 — 명령 (C→S)

| 명령 | 페이로드 | 서버가 하는 일 | 거절 |
|---|---|---|---|
| `rushWave` | (없음) | ★ 침공 앞당기기. `waves.canRushWave` 로 **서버가 다시 재고** 도착일을 `waves.rush.daysAhead` 일 뒤로 당긴다. 선발대 캠프도 그 자리에서 세운다 | `NOT_READY` — 채비가 덜 됐거나, 웨이브가 안 잡혔거나, 이미 하루 앞이거나, 전투 중 |
| `devTime` | `{tickRealSeconds?, paused?, togglePause?, step?}` | ★ 개발·QA 전용 시간 손잡이. **방장만**(방에 남아 있는 사람 중 가장 먼저 들어온 이) 받는다. 바뀐 하루 길이는 `timeScale` 로 방 전체에 흘린다 | `NOT_FOUND`(운영에서 뒷문 잠김) · `NOT_JOINED` · `NOT_HOST` |

> `devTime` 이 REST `/api/debug/speed` 를 대신하는 까닭: REST 는 신원도 방도 없어 `gameId` 를 안 주면
> **아무 방이나**(`anyGame`) 집었다 — 멀티에서 남의 방 시계를 밀 수 있었다. REST 뒷문은 도구(E2E·하니스)용으로 남는다.

### 0-M-2. 신설 — 이벤트 (S→C)

| 이벤트 | 언제 | 페이로드 | 클라가 할 일 |
|---|---|---|---|
| `timeScale` | 방장이 `devTime` 을 쓸 때 | `{tickRealSeconds, paused, tick}` | `config.time.dayRealSeconds`·`tickRealSeconds` 를 받아 적는다(해·달·주민 사이클이 전부 이 값을 본다) |
| `wave_rushed` | `rushWave` 성공 | `{index, number, name, daysUntil}` | 연대기·알림 (`events` 채널로 온다) |

### 0-M-3. 신설 — 뷰 필드

| 자리 | 필드 | 뜻 |
|---|---|---|
| `nation.wave` | `readiness` | ★ `{ok, daysAhead, rows:[{label, have, need, ok}]}`. **정보 비대칭 바깥이다** — 적이 언제 오는지는 흐려도 「내가 무엇을 더 갖춰야 하는지」는 언제나 또렷하다. `rows` 는 `data/waves.json` 의 `rush.conditions` 를 **장 목표와 같은 계측기**(`progression.measure`)로 잰 값이다 |
| `nation.wave` | `canRush` | 지금 `rushWave` 를 보낼 수 있는가(화면의 단추 유무) |
| `nation.wave` | `rushed` | 이번 웨이브를 이미 당겼는가 |
| `state.chapter` | `remaining` | ★ `[{key, title}]` — 이 장에 **남은 칸**들의 제목. 조건은 재지 않는다(열리지 않은 칸의 숫자는 스포일러이자 헛계산) |

### 0-M-4. 넓어진 조건 — `wavesFaced` (F04-5)

조건 문법에 `{"type":"wavesFaced","count":N}` 가 늘었다 — **이기든 지든** 겪은 무리의 수다.
7장 마지막 칸이 `any(wavesHeld 1, wavesFaced 2)` 가 되어, 첫 무리를 놓쳐도 두 번째를 겪으면 장이 넘어간다.
벌은 이미 전투가 준다(전리품·구조물 피해·사기) — 그 위에 「장을 못 넘긴다」를 얹지 않는다.
`wavesHeld` 의 뜻은 그대로다: 옛 세이브에서 이미 막아 낸 사람은 예전과 똑같이 통과한다.

### 0-M-5. 부패는 곳간 상한 앞에서 멈춘다 (QA-A 되튐)

`economy.applySpoilage(nation, data, floor)` 에 세 번째 인자가 늘었고, `tick.js` 가 `storage.spoilFloor` 를 준다.
단단한 상한(§0-Y-4)이 무른 문턱(`storageCapacity`)보다 높으면 그 사이는 **채집은 멎었는데 매일 깎이는** 구간이었다
(실측: 상한 500 · 목재 문턱 315 · 하루 −3.68 → 자원칸이 496↔499 로 되튐). 이제 곳간 **안**에 든 것은 썩지 않는다.
상한을 넘겨 받은 몫(교역·전리품·환급)은 그대로 서서히 덜린다 — §0-Y-4 가 말한 「넘친 재고」가 정확히 그것이다.
다이얼은 `balance.storage.spoilRespectsLimit`(false 로 두면 옛 규칙).

### 0-M-6. 자료만 바뀐 것 (계약 아님)

`data/waves.json` `rush`(신설) · `settlementScale.reference` 110→118 ·
`data/buildings.json` `bloomery`(신설, 6장) 와 산출 건물 상향 · `data/chapters.json` 6장 `opens.buildings`.

---

## 0-N. v3.3 안 델타 — **위치 보간 다이얼** (§19-B · QA1차 B02-1)

**판번호를 올리지 않는다.** 이벤트도 페이로드도 그대로다 — `/api/config` 의 `world` 에 **화면만 보는 값 둘**이
늘었을 뿐이다. 옛 클라는 이 필드를 안 읽으므로 그대로 돌고, 새 클라는 값이 안 오면 제 예비값으로 돈다.

「몹·플레이어가 뚝뚝 끊기며 이동하거나 텔레포트한다」는 **서버 틱의 문제가 아니다.** 서버는 지금 박자를
그대로 지키고(생태계 1초 · 걸음 보고), 화면이 그 사이를 잇는 규칙만 고쳤다 — 월드 시뮬·난수는 한 눈금도
건드리지 않는다(결정론 불가침).

| 자리 | 필드 | 뜻 |
|---|---|---|
| `config.world.render` | 통째 | ★ 화면 전용 다이얼 묶음(`interp`·`hit`·`dialogue`·`structureSprite`·`perf`). 서버는 한 번도 읽지 않는다. 전에는 규격에 실리지 않아 `data/world.json` 의 `render` 가 **죽은 다이얼**이었다 |
| `config.world.render.interp` | 보간 버퍼 | 남이 쥔 좌표(짐승·동료·다른 사람·웨이브 적)를 화면이 잇는 규칙. 지연폭 = `간격 × leadFactor + leadPadMs` 를 `minDelayMs`~`maxDelayMs` 로 자른 값. 그만큼 **뒤를** 그리므로 다음 좌표가 이미 손에 있는 구간만 지난다(외삽 없음) |
| `config.world.avatar.moveReportMs` | 정수(ms) | `lordMove` 로 제 자리를 알리는 최소 간격. 이 값이 곧 **남의 화면에서 내가 움직이는 박자**다 — 한 칸을 걷는 시간(≈217ms)보다 길면 정수 칸 보고가 칸을 건너뛴다 |

> `moveReportMs` 는 클라의 송신 스로틀일 뿐이다. `lordMove` 의 페이로드·판정·ack 는 하나도 안 바뀌었다.

---

## 0-T. v3.2 안 델타 — **플레이테스트 3차** (GDD3 §14)

**판번호를 올리지 않는다.** 더하기만 했다 — 땅도 세이브도 그대로다(`world.schema` **5** 유지).
옛 세이브에 없는 것(`player.stats.alloc` · `player.invulnUntil` · `villager.work`)은 처음 읽는 순간
`ensurePlayer` / `ensureWork` 가 빈 값으로 채운다. 새 건물(`ranch`)이 하나 늘었을 뿐이라 지도는 안 건드린다.

### 0-T-1. 신설 — 명령 (C→S)

| 명령 | 뜻 | ack |
|---|---|---|
| `allocStat {stat, count?}` | ★ §14-5 — 레벨업으로 받은 점수를 능력치 하나에 준다. **리스펙 없음** | `{ok, stat, given, alloc, points, player}` |

`stat` 은 `vitality`(체력) / `strength`(힘) / `agility`(민첩) / `luck`(행운).
남은 점수보다 많이 청하면 **가진 만큼만** 준다(`given`). 하나도 없으면 `NO_POINTS`, 없는 능력치면 `BAD_STAT`.
신원은 세션이 정한다(`IDENTITY_COMMANDS`) — 클라가 보낸 `avatarId` 는 믿지 않는다.

### 0-T-2. 신설 — 이벤트 (S→C)

| 이벤트 | 언제 | 페이로드 | 클라가 할 일 |
|---|---|---|---|
| `residentWork` | ★ §14-1 — 주민의 작업 사이클이 끝날 때(실시간 저빈도 루프) | `{tick, credits:[{id,name,x,y,resource,amount,stored}], resources}` | 그 사람 자리에 수치를 띄우고 자원칸을 갱신 |
| `playerRevived` | ★ §14-6 — 쓰러진 사람이 일어날 때 | `{avatarId, hp, maxHp, invulnSeconds, x, y}` | 카운트다운 걷기 + 무적 표시 |

`residentWork.resources` 는 **그 순간의 창고 잔고 전량**(권위값)이다 — 화면은 이 값을 그대로 받아 적는다.
`credits[].amount` 는 낸 몫, `stored` 는 곳간에 실제로 들어간 몫이다(가득 차면 다르다 — §13-A-5).

### 0-T-3. 주민 산출의 박자 (§14-1) — **하루 합계 동일성이 계약이다**

```
사이클 길이 = balance.time.dayRealSeconds ÷ world.villagers.work.cyclesPerDay   (기본 600 ÷ 30 = 20초)
사이클 몫   = residentYield(u,…).perDay ÷ cyclesPerDay
일 틱 정산  = residentSettle() = residentGather() − (그 하루에 이미 곳간에 들어간 몫)
```

* 서버는 사람마다 `u.work.produced`(낸 몫 — 하루 몫을 넘기지 않는 뚜껑)와 `u.work.credited`(곳간에 실제로
  들어간 몫 — 일 틱이 나머지를 셈할 때 쓰는 값)를 **따로** 든다. 둘을 가르지 않으면 `deposit` 이
  소수 둘째 자리에서 끊는 먼지가 쌓여 하루 합계가 어긋난다(실측 오차 2.4%).
* 접속자가 없으면 실시간 루프가 멎으므로 `credited` 가 비고, 일 틱이 하루치를 통째로 낸다 — **어느 쪽이든 합계는 같다.**
* 노는 사람·공사(buildPoints)는 실시간으로 적립하지 않는다(일 틱이 통째로 맡는다).
* 운반 연출(`world.villagers.work.deliveriesPerDay`)은 이제 **장식**이다. 크레딧과 무관하다.

### 0-T-4. 짐승의 영토 진입 금지 · 목장 (§14-4)

* `stepEcology` 의 한 걸음은 ① 울타리를 가로지르면(§13-C-2) ② **영토 안으로 들어서면** 무효다.
* 이미 영토 안에 있으면 본부 반대쪽으로 곧게 **밀어낸다**(경로 탐색 없음, 울타리도 따지지 않는다 —
  안에 갇힌 짐승을 울타리가 붙들면 영영 못 나간다). 미는 동안에는 물지도 도망가지도 않는다.
* 도감 조우 판정은 걸음보다 **먼저** 센다 — 밀려나는 놈도 눈에는 들었기 때문이다.
* **목장**(`ranch`, 생산 2×3, 티어 4)이 서면 `creatures.ranch.radius`(6) 안쪽만은 `kind:'animal'` 에게 열린다.
  포식자는 목장이 있어도 못 든다. 목장 산출은 `buildings.ranch.tiers[].flatOutput`(고기·털·가죽)이 정본이다.
* 웨이브 적은 이 규칙을 타지 않는다 — 그쪽은 `battle.js` 의 별도 계층이다.

★ §19-F1(F08-4) **키우기** — `tameCreature {targetId?}` (C→S). 다 지어진 목장이 있고, 아바타 곁
`creatures.ranch.tame.rangeTiles`(3) 안에 `kind:'animal'` 이 있으면 그 자리에서 가장 가까운 우리로
옮겨 앉는다(사냥과 병존 — 같은 짐승 앞에서 유저가 고른다). 서버가 사거리·종류·정원을 판정한다.
* 정원 = `activeRanches` 마다 `tame.capacityPerTier[티어−1]` 의 합. 넘치면 `RANCH_FULL`.
* 기른 짐승은 `c.tamed = 목장 id` 를 지닌다: 사람을 피하지 않고, 우리 밖으로 목적지를 뽑지 않으며,
  사냥꾼 오두막의 솎아냄(`cullForHunters`)이 집어 가지 않는다.
* 산출은 머릿수 × `tame.perHeadPerDay` 이며 **건물 정액 산출과 같은 문**으로 들어간다(곳간 상한·연구 배수 동일).
* ack: `{ ok, tamed:true, targetId, species, speciesName, ranchId, x, y, heads, capacity }`
* 오류: `NO_RANCH` · `NO_TARGET` · `WILD_BEAST` · `OUT_OF_RANGE` · `RANCH_FULL` · `ALREADY_TAMED`
* `creatures.list[]` 에 **필드 추가만**: `tamed:true`(기르는 것일 때만 실린다 — 옛 클라는 없는 칸으로 읽는다).

### 0-T-5. 플레이어 레벨 · 능력치 (§14-5)

* **레벨은 새 숫자가 아니다.** 다섯 스킬 XP 의 **총합**이 `skills.player.xpCurve` 를 탄다.
  그래서 기존 스킬 장부와 언제나 정합이고, 스킬을 고루 올려도 손해가 없다.
* 레벨업마다 `statPerLevel`(1) 점. **남은 점수 = (레벨−1)×perLevel − 쓴 점수** — 저장하는 값은 `alloc` 뿐이다.
* 훅(전부 서버 계산):

| 능력치 | 붙는 자리 | 값 |
|---|---|---|
| 체력 `vitality` | `playerMaxHp` | 점당 최대 HP +10 |
| 힘 `strength` | `yieldMultiplier`(수확) · `swingDamage`(피해) | 점당 +4% |
| 민첩 `agility` | `swingCooldownMs` · 아바타 걸음(클라가 `progress.effects.moveSpeed` 를 곱한다) | 쿨 −2% / 걸음 +3% (쿨 감소 상한 `cooldownCap` 50%) |
| 행운 `luck` | 사냥 드롭(`huntSwing`) · 인첸트 상위 등급 무게(`upperBoost`) | 점당 +3% |

* 뷰: `you.player.progress = {level, xp, from, need, ratio, points, spent, order, stats, effects}`.
  `you.player.maxHp` 는 언제나 `playerMaxHp` 가 낸 값이다(능력치를 준 그 순간 늘어난다).

### 0-T-6. 다운 · 부활 (§14-6)

`data/skills.json` `combat`: `downSeconds` **10** · `reviveHpRatio` **0.5** · `invulnSeconds` **3** ·
`downMoralePenalty` 0.03(그대로).

* 쓰러진 자리에서 아바타는 곧바로 본부로 옮겨진다. `player_down` 이벤트에 `downSeconds` ·
  `reviveHpRatio` · `invulnSeconds` · `moralePenalty` 가 함께 실린다(첫 다운 설명 카드가 이 값으로 쓰인다).
* 시계는 **두 곳**이 돌린다 — 생태계 루프(`ecology.stepEcology`)와 전투 서브틱(`battle.stepBattle`).
  둘 다 같은 문(체력 절반 · 무적 · 본부 자리)을 쓰고, 각각 `playerRevived` / `battleTick` 의
  `playerRevived` 항목으로 알린다.
* **무적 동안에는 어떤 피해도 들어오지 않는다**(짐승의 `bite`, 웨이브의 근접 타격 둘 다).

### 0-T-7. 건설 탭의 잠긴 항목 (§14-7)

`state.nation.lockedBuildings[]` — **이미 열린 갈래 안**의 아직 잠긴 건물들.

```
{key, name, category, requiresTier, unlocked:false, multi, cost, gold, buildPoints,
 affordable:false, lockKind:'chapter'|'tier', lockChapter, lockTier, lockReason}
```

* `lockReason` 은 화면에 그대로 나가는 글이다 — `"7장 「낯선 발자국」에서 해금"` · `"읍(티어 4)에서 해금"`.
* **갈래가 통째로 안 열렸으면 한 줄도 실리지 않는다.** §11-1(잠긴 계층은 부재)은 갈래·시스템 단위에만,
  §12-3(조건 가시화)은 개별 건물에 적용한다 — §14-7 이 못 박은 경계다.
* 본부(`hq`)와 조각(`piece`)은 목록에서 뺀다(배치대에서 고르는 것이 아니다).

### 0-T-8. 밝기 · 설정 (§14-2)

* `world.light.phases[]` 의 `alpha` / `lift` 와 `fogVeil` / `buildVeil` / `minLuma` 를 한 단계 올렸다
  (밤 alpha 0.60→**0.46** · 낮 lift 0.09→**0.15** · fogVeil 0.30→**0.24** · minLuma 48→**56**).
* 그 위에 **플레이어의 밝기 슬라이더**(`world.light.brightness`, 기본 1.0)가 곱해진다:
  덮는 어둠 `× (1 − (b−1)×darkPerStep)`, 더하는 빛 `+ (b−1)×liftPerStep`.
  **서버는 이 값을 모른다** — `localStorage['gm.brightness']` 에만 산다. 소리 크기는 `localStorage['gm.volume']`.

### 0-T-9. 명칭 (§14-8)

배치대·단추·안내문의 「세우기」는 전부 **「건설」**이다. `harness/check_ui.mjs` 가 금칙어로 막는다
(`public/js/*.js` 의 화면 문자열 + `index.html` + `data/chapters.json` · `data/balance.json`).

---

## 0-V. v3.2 안 델타 — **RPG 계층** (GDD3 §13-D)

**판번호를 올리지 않는다.** 이 층은 더하기만 했다 — 땅도 그대로고, 옛 세이브에 없는 것은
`migrateWorld` 가 채운다(주민 능력치는 「씨앗:나라:사람번호」로 지어 넣고, 연구·철로·모집은 빈 값에서 시작한다).
§0-W 가 판번호를 올린 까닭은 **세이브가 안 맞아서**였다. 여기는 그렇지 않다. `world.schema` 는 **5** 그대로다.

### 0-V-1. 신설 — 명령 (C→S)

| 명령 | 페이로드 | 여는 장 | 서버가 지키는 것 |
|---|---|---|---|
| `recruitResident` | `{}` | 4장 첫 이웃 | 빈 잠자리 · 식량 20 · 쿨다운 1게임일. 자연 유입과 **같은 잠자리 조건**을 쓴다 |
| `craftEquipment` | `{slot,key}` | 9장 나라의 격 | 대장간 존재 · 자재/골드 · **상위 티어는 공장장 재임** |
| `enhanceEquipment` | `{slot}` | 9장 | +1~+3 · **공장장 재임 필수** · 단계마다 값이 `costGrowth` 배 |
| `enchantEquipment` | `{slot}` | 9장 | 등급 뽑기(서버 난수) · **성녀 재임 시 상위 등급 무게 ×2** · 재부여는 덮어쓰기 |
| `startResearch` | `{key}` | 10장 끝이 없는 길 | 티어 · 선행 연구 · 값(골드+자원)은 **착수할 때 한 번에** · 한 번에 하나만 |
| `placeRail` | `{points:[{x,y}…]}` | 10장 | 「철로」 연구 필수 · 칸마다 강재 · 물 위 금지 · 상한 600칸 |
| `removeRail` | `{tileIds:[…]}` | 10장 | 낸 값의 절반 환급 |
| `placeBridge` | `{points:[{x,y}…]}` | 10장 | ★ §17-13 「가교」 연구 필수 · 칸마다 목재 · **물 위에만**(allowedTerrain) · 사람만 건넌다(짐승·적 불가) · 상한 240칸 |
| `removeBridge` | `{tileIds:[…]}` | 10장 | 낸 값의 절반 환급 |
| `placeFill` | `{points:[{x,y}…]}` | 10장 | ★ §17-13 「매립」 연구 필수(선행: 가교) · 칸마다 석재+목재 · **물 위에만** · 메운 칸은 걷고·짓고·울타리 가능 · 상한 160칸 |
| `removeFill` | `{tileIds:[…]}` | 10장 | 낸 값의 절반 환급 |
| `clearNode` | `{nodeId}` | (장 제한 없음) | ★ §17-12 걷어내기 — `world.nodes.clear.refundResource` 에 적힌 종류만 · 영토 안만 · 환급 `max(minRefund, 잔량×refundRatio)` 를 창고 상한대로 적립 · 붙어 있던 주민은 대기로 · 지워진 노드는 `worldDiff.removedNodes` 로 내려간다 |

`craftEquipment`·`enhanceEquipment`·`enchantEquipment` 는 **신원 명령**이다 —
누구의 칼인지는 세션이 정한다(클라가 보낸 `avatarId` 는 믿지 않는다).

### 0-V-2. 신설 — 이벤트 (S→C)

| 이벤트 | 실리는 것 |
|---|---|
| `researchDone` | `{key,name,line,desc,unlocks,spawnedNodes,nodeIds,nodeType}` — 석탄·석유 노두가 드러나는 순간이라 화면은 이때 지도를 다시 청한다 |
| `residentArrived` | (기존) `+ stats{diligence,strength,dexterity,courage}` · `recruited:boolean` |

### 0-V-3. 신설 — 뷰 필드

`state.nation`
- `residents[].stats` · `statFactors{yieldFactor,outdoorFactor,haulFactor,top}` · `fit{ok,keys,best}` · `outdoor` · `haul`
- `housing.recruit` — `{open,reason,reqs[],cost,cooldownDays,cooldownLeft,count}` **(4장 전에는 필드 자체가 없다)**
- `research` — `{order,list[],active,productionBonus,railsOpen,doneCount}` **(10장 전에는 필드 자체가 없다)**
- `rails[] {id,x,y}` · `railSummary {tiles,maxTiles,costPerTile,speedMultiplier,open}`

`state.you`
- `equipment` — `{smithy,officer,saint,gear,effects,catalog,enhance,enchant}` **(9장 전에는 필드 자체가 없다)**

`/api/config`
- `residentStats` (이름·눈금·직업 적합) · `recruit` (값·쿨다운) · `equipment` (티어·재료·특성표) · `research` (선행·값·날수·철로 규격)
- 규칙만 간다. **내가 무엇을 끼고 있는지, 어디까지 연구했는지는 `state` 로만** 간다.

### 0-V-4. 조건 가시화의 두 겹 (§11-1 과 §12-3 이 부딪히지 않는 자리)

- **장(chapter)이 열기 전** → 필드 자체가 없다. 화면은 단추도 탭도 그리지 않는다.
- **장이 열린 뒤, 아직 못 하는 것** → 목록에는 남고 **빨강 + 현재값/필요값**으로 적는다.
  연구가 그렇다: 10장에 들어서면 네 연구가 모두 실리고, 잠긴 것은 「단계 3/4」처럼 무엇이 얼마나 모자란지 적힌다.

### 0-V-5. 능력치는 세계 난수를 쓰지 않는다

§13-C(생태계)와 같은 규칙이다. 주민 능력치는 `「씨앗:나라:사람번호」` 로 지은 **제 난수**에서 나온다.
세계 난수를 한 톨이라도 축내면 웨이브 구성·사건·이름이 통째로 밀려 같은 씨앗이 다른 게임이 된다
— 실제로 그렇게 해 보고 시뮬 웨이브5 생존율이 60% → 45% 로 움직이는 것을 확인한 뒤 갈라냈다.
연구가 심는 석탄·석유 노두도 같은 이유로 제 난수를 쓴다.

### 0-V-6. 새 자원 `coal`

`resources.order` 에 `ironOre` 다음으로 들어간다. **월드 생성에는 한 톨도 나지 않는다**
(`world.nodes.types.coal.count = 0`) — 「석탄 채굴」 연구가 링1~2 에 심는다.
저장 상한·HUD 자원칸·가격표는 다른 자원과 같은 규칙을 그대로 탄다. 도감에는 실리지 않는다(도감은 생물의 것이다).

---

## 0-W. v3.1 → **v3.2** 델타 — 월드 2.0 · 생태계 (GDD3 §13-B · §13-C)

**판번호를 올린 까닭은 하나다: 세이브가 안 맞는다.** 더한 것만 있었다면 3.1 그대로 두었을 텐데
(그것이 §0-Y·§0-Z 에서 한 일이다), 이번에는 **땅 자체가 다시 그려졌다** —
자원이 군락으로 앉고, 시작 영토가 비워지고, 유적에 크기가 생기고, 들에 짐승이 산다.
옛 지도에는 군락도 딸기 들도 없고 영토 한복판에 나무가 박혀 있어, 새 규칙을 옛 땅 위에 얹으면
「군락 없는 군락 게임」이 된다. 그래서 `world.schema` 를 **5** 로 올리고 그 아래 스냅샷은 읽지 않는다.

### 0-W-1. 신설

| 구분 | 이름 | 한 줄 설명 |
|---|---|---|
| S→C | `creatures {tick, list[]}` | ★ §13-C — 들에 사는 것들의 자리. **1초에 한 번**(`config.creatures.sim.broadcastSeconds`) 온다 |
| S→C | `playerDown {avatarId, by, downSeconds, x, y}` | 짐승에게 쓰러졌다. `x,y` 는 모닥불 자리 — 화면은 거기서 일어난다 |
| S→C | `wildHit {avatarId, damage, hp, by}` | 물렸다(아직 서 있다) |
| 뷰 | `state.codex` | ★ §13-C-3 도감. 종별 카드 + 유적 탭 + 층 문턱 |
| 뷰 | `state.nation.rings` | `{r0, r1}` — 위험 띠 경계(본부 기준 반지름) |
| 뷰 | `world.clusters[]` / `worldDiff.clusters[]` | ★ §13-B-1 자원 군락 `{id,type,x,y,r,n}`. **탐사된 것만** |
| 뷰 | `world.rings` | 스냅샷에도 같은 경계가 실린다 |
| 뷰 | `nodeView.respawnAt` | ★ §13-B-3 그루터기가 되살아나는 게임일 |
| 뷰 | `nodeView.cluster` | 이 노드가 속한 군락 id |
| 뷰 | `nodeView.size` / `ruinName` | ★ §13-B-4 유적 크기(1~4)와 이름 |
| ack | `lordMove.ring / ringEntered / ringText` | ★ §13-B-5 지금 선 띠 · **링2 첫 진입** · 경고 문구 |
| ack | `lordMove.revealedNodes[]` | ★ §13-B-4 걸어가서 드러난 은닉 유적 |
| ack | `combatSwing.hunt / species / speciesName / gained` | ★ §13-C-8 사냥 결과(드롭 포함) |
| ack | `actionSwing.respawnAt` | 방금 그루터기가 됐다면 언제 되살아나는지 |
| ack | `actionSwing.progress` / `combatSwing.progress` | ★ §19-C 다섯 솜씨를 합친 내 눈금표(즉시 반영) |
| ack | `setLabor.seated` / `setVillagerMix.seated` | ★ §19-C 나눔 직후 그 자리에서 일터에 앉힌 사람 수 |
| 자료 | `data/creatures.json` | 생태계 정본 — 종 12(동물 6 · 야생 적 6) · 스폰 · 저빈도 시뮬 · 도감 문턱 · 사냥 |
| 자료 | `world.nodes.clusters` | 군락 규칙 — `clearRadius` · `centerRadius` · `nearGuarantee[]` |
| 자료 | `world.nodes.regrow` | 재생 날수 표 + `fadeAt`(옅어짐 문턱) |
| 자료 | `world.nodes.ruinSizes` | 유적 크기표(무게·스윙·게이지·최소 거리·은닉 확률) |
| 자료 | `world.rings` | 스폰 링 다이얼 |
| 자료 | `world.villagers.workRadiusBonus` | 일자리 반경 = 영토 + 이 값 |
| 자료 | `resources.meta.meat/hide/wool` | 신규 자원 셋. `meat.foodValue = 3` |
| config | `creatures` | 공개본 — **종의 이름·능력치·드롭은 없다**(도감이 그것을 여는 열쇠다) |

### 0-W-2. 바뀐 계약

| 무엇 | 전 | 후 |
|---|---|---|
| `actionSwing` 영토 | 영토 밖이면 `OUT_OF_TERRITORY` | ★ §13-B-2 — **언제나 허용**. 자원 군락이 영토 밖에 앉았으므로 막으면 1장부터 게임이 멎는다. 서버가 지키는 것은 사거리·쿨타임·잔량 셋뿐 |
| `combatSwing` | 웨이브 전투 중에만 (`NO_BATTLE`) | 전투 중이면 밀려온 적, 아니면 **들에 사는 것**을 벤다(같은 검·같은 규칙) |
| 노드 재생 | `regenPerTick` 으로 늘 조금씩 | ★ §13-B-3 — 잔량이 0 이면 **그루터기**가 되고 `respawnAt` 에 통째로 돌아온다. 기다리는 동안에는 자라지 않는다. 표(`regrow.byType`)에 없는 종류(물목)는 옛 규칙 그대로 |
| 노드 배치 | 종류마다 지도 전체에 고르게 산포 | ★ §13-B-1 — **군락**. 씨앗 한 점 둘레에 같은 종류가 모여 앉고, 도읍 둘레 `clearRadius` 안에는 한 톨도 없다 |
| 주민 일자리 | 영토 안 노드만 | 영토 + `workRadiusBonus`(26) 안 노드 |
| 목표 마커(`chapter.goal.targets`) | 영토 안 노드만 가리킴 | 같은 반경(영토 + 26). 가까운 순 최대 3개는 그대로 |
| 굶주림 판정 | 곡물이 모자라면 곧바로 배급 | ★ §13-C-1 — **고기가 곡물을 대신한다**(고기 1 = 곡물 3). 다 메우지 못할 때만 배급으로 넘어간다 |
| 자동 수출 | 모든 자원 | `meta.autoExport === false` 인 자원(고기·가죽·털)은 손대지 않는다 |
| 세이브 | `schema >= 4` | **`schema >= 5`**. 그 아래는 폐기하고 새로 판다 |

### 0-W-3. 생태계의 위치 소유권 (§12-11 의 반대편 규칙)

| 무엇 | 위치의 주인 | 화면이 하는 일 |
|---|---|---|
| 주민(`residents`) | **클라** | 서버 `x,y`는 쳐다보지 않고 `destX,destY`만 목표로 쓴다 (§12-11) |
| 야생(`creatures`) | **서버** | 서버 좌표로 **튀지 않고** 그리로 다가간다(lerp). 처음 본 놈과 12칸 넘게 벌어진 놈만 스냅 |

자유 의지로 돌아다니는 것들이라 목표점만으로는 그림이 나오지 않는다. 대신 서버는 1초에 한 번만
굴리고 화면이 그 사이를 메운다 — 그래서 텔레포트가 나지 않는다.
**아무도 안 보고 있으면 실시간 루프는 돌지 않는다.** 그동안의 몫은 일 틱이 `sim.dayStepSeconds` 만큼
몰아서 처리한다(같은 함수를 다른 `dt` 로 부를 뿐이다).

### 0-W-4. 생태계는 월드 난수를 축내지 않는다

생태계·사냥은 `nation.wild.rngState` 에 **제 난수를 따로** 들고 산다. 세계의 난수(`world.rngState`)를
한 번이라도 쓰면 그 뒤의 웨이브 구성·사건·이름이 통째로 밀려, 같은 씨앗으로 잰 밸런스가 어긋난다.
`test/ecology.test.js` 가 이 불변식을 지킨다.

---

## 0-Y. v3.1 안 델타 — **플레이테스트 2차 반영** (GDD3 §13-A)

판번호는 3.1 그대로다(호환을 깨는 삭제가 없다). 아래는 **더해진 계약**이다.

### 0-Y-1. 조건 행의 단일 정본 (§13-A-1)

조건 행(`tier.next.reqs[]` · `housing.arrival.reqs[]`)은 이제 **스스로를 설명한다.**
서버는 `server/engine/requirements.js` 한 곳에서만 이 행을 찍고, 화면은 `state.js` 의
`S.reqLive()` 한 곳에서만 다시 잰다.

| 필드 | 값 | 뜻 |
|---|---|---|
| `reqs[].kind` | `resource` \| `structure` \| `population` \| `count` | 이 행을 **무엇으로 다시 재는가**. `count` 는 서버만 아는 값(빈 잠자리 따위)이라 화면이 다시 재지 않는다 |
| `reqs[].resource` | 자원 키 | `kind:'resource'` 일 때만. 화면이 `nation.resources[resource]` 로 지금 값을 읽는다 |
| `reqs[].building` | 건물 키 | `kind:'structure'` 일 때만 |
| `reqs[].dec` | 정수(기본 0) | 표시·버림 자릿수. `have` 는 이 자리에서 **버림**한다 |

**불변식 두 가지.**
1. `ok === (have >= need)` — 언제나. (전에는 `ok` 가 소수 원본, `have` 가 버림값이라 「20/20 인데 단추가 꺼짐」이 났다)
2. 화면은 서버가 준 `have` 를 **그대로 믿지 않는다.** `actionSwing` 은 실시간 명령이라 뷰를 다시 만들지
   않으므로(§0-Z 의 `REALTIME_COMMANDS`), 창고만 ack 로 앞서 가고 조건 행은 최대 한 게임일 묵는다.
   `kind` 가 있는 행은 클라가 지금 장부로 다시 재어 그린다. 승격 단추의 활성 여부도 이 값으로 정한다.

### 0-Y-2. 화면 밝기 다이얼 (§13-A-2)

`config.world.light` 가 새로 실린다. 조명 상수가 클라 소스에 박혀 있던 것을 데이터로 끌어냈다.

| 필드 | 뜻 |
|---|---|
| `light.phases[]` | 하루 4구간. `{key,name,tint,alpha,lift,liftColor,vision,sky,ground}` — **순서가 곧 아침·낮·저녁·밤** |
| `phases[].alpha` | 월드 위에 덮는 **어둠**의 세기 |
| `phases[].lift` / `liftColor` | ★ 신설 — 그 위에 `lighter` 로 **더하는 빛**. 낮은 따뜻하게, 밤은 달빛으로 |
| `light.fogVeil` | 탐사했지만 지금 안 보이는 땅에 덮는 장막(기본 0.30) |
| `light.buildVeil` | ★ 신설 — **건설 모드일 때의** 장막(기본 0.18). 반드시 `fogVeil` 보다 옅다 |
| `light.minLuma` | 어떤 순간에도 지켜야 할 화면 평균 밝기 하한(0~255). `npm run smoke` 가 실제 캡처로 잰다 |

설정을 못 받으면 `public/js/state.js` 의 폴백 표로 돈다(구경 모드). **두 표의 값은 같아야 한다.**

### 0-Y-3. 주민 노동 수치 (§13-A-3)

| 구분 | 이름 | 한 줄 설명 |
|---|---|---|
| 뷰 | `residents[].yield` | ★ 신설 — `{resource, perDay}`. **그 주민이 하루에 국고에 넣는 값.** 채집직이 아니거나 산출이 0이면 필드 자체가 없다 |
| 자료 | `world.villagers.work` | ★ 신설 — `{deliveriesPerDay, swingSeconds}`. 화면의 짐 쌓임·나르기 주기 |

**불변식:** `Σ residents[].yield.perDay` = 그날 일 틱이 `nation.resources` 에 더하는 값.
서버는 `residentYield()` 한 함수로 이 둘을 낸다. 화면은 짐을 **흐른 시간만큼**
(`perDay ÷ dayRealSeconds` 초당) 쌓고, 한 자루(`perDay ÷ deliveriesPerDay`)가 차면 날라 부리며
그 자루의 값을 `"+1.2 목재"` 로 띄운다 — 하루 동안 뜬 숫자의 합이 곧 국고 증가분이다.

### 0-Y-4. 저장 상한 (§13-A-5)

**서버가 정본이다.** `server/engine/storage.js` 가 상한을 재고, 국고로 들어오는 문(`deposit`)도 그 하나뿐이다.

| 구분 | 이름 | 한 줄 설명 |
|---|---|---|
| 뷰 | `nation.storage` | ★ 신설 — `{limit, full[]}`. `limit` 은 **자원마다 따로** 걸리는 총량, `full` 은 지금 가득 찬 자원 키 목록 |
| 자료 | `balance.storage` | ★ 신설 — `{hqBase, hqPerTier, capPerTierMultiplier}` |
| 자료 | `buildings[].storageCap` | ★ 신설 — 그 건물이 보태는 몫(궤짝 80 · 저장고 250 · 곡창 150). **이 필드가 있으면 저장 계열이다** |
| 오류 | `STORAGE_FULL` | 「곳간이 가득 찼습니다. 궤짝을 더 짓거나 키우세요」 — `{nodeId, limit, resources[]}` 를 함께 준다 |

**규칙.**
- 상한 = `hqBase + hqPerTier × 정착지 티어 + Σ(storageCap × capPerTierMultiplier^(티어-1))`.
  새로 짓든 키우든 둘 다 곳간이 는다. 무너졌거나(`hp<=0`) 옮기는 중인(`inactive`) 건물은 세지 않는다.
- **채집 무효**: 스윙이 낼 자원이 전부 가득이면 `STORAGE_FULL` 로 거절한다 —
  쿨타임도 노드 잔량도 축나지 않는다. 일부만 찼으면 **들어간 만큼만** `gained` 에 실린다.
- 주민 노동·건물 정액 산출·부처 산출도 같은 문을 지난다.
- 상한은 **들어오는 것**만 막는다. 이미 든 재고를 깎지 않는다(교역·전리품·환급으로 넘쳐도 빼앗지 않는다).
  넘친 재고는 기존 `economy.applySpoilage` 가 서서히 덜어 낸다.
- 화면은 `STORAGE_FULL` 을 **자원마다 한 번만** 알리고, 자리가 나면 알림이 되살아난다.
  HUD 자원칸은 `.res-chip.full`(빨간 테두리 + 「가득」)로 계속 이유를 말한다.

### 0-Z. v3.1 안 델타 — **플레이테스트 1차 반영** (GDD3 §12)

판번호는 3.1 그대로다(호환을 깨는 삭제가 없다). 아래는 **더해진 계약**이다.

### 0-Y-1. 신설

| 구분 | 이름 | 한 줄 설명 |
|---|---|---|
| C→S | `promoteSettlement {}` | ★ §12-2 — **정착지 승격의 유일한 방아쇠.** 본부를 눌러 [승격]. 일 틱은 더 이상 티어를 올리지 않는다 |
| C→S | `demolishStructure {structureId}` | ★ §12-12 — 철거 착수. 건설 공수의 40%를 일하면 자재 50% 회수 |
| C→S | `relocateStructure {structureId,x,y}` | ★ §12-12 — 이전 착수. 해체(40%)+재건(60%), 자재 추가 없음 |
| C→S | `cancelStructureWork {structureId}` | ★ §12-12 — 철거·이전 되돌리기(이전의 재건 마디에 들어선 뒤엔 `TOO_LATE`) |
| 자료 | `buildings[].footprint [w,h]` | ★ §12-1 — 그 건물이 차지하는 칸. 배치 충돌·영토 판정·렌더 크기가 전부 이 값을 따른다 |
| 자료 | `buildings.campfire.hq/autoTier/stages` | ★ §12-2 — 정착지 본부(4×4). 티어가 정착지 티어를 따라가고 손으로 개축하지 않는다 |
| 자료 | `balance.structureWork` | ★ §12-12 — 철거·이전 비율 다이얼 |
| 자료 | `balance.residents.arrival.crowdingPerResident` | ★ §12-4 — 붐빔. 주기 = base ÷ 매력도 × (1 + 붐빔 × 인구) |
| 자료 | `world.fog.visionPerTier` | ★ §12-8 — 아바타·건물 시야 = 기본 + 티어 × 0.5 |
| 뷰 | `structureView.fw/fh/cx/cy` | 풋프린트와 중심 좌표(앵커는 좌상단 `x,y`) |
| 뷰 | `structureView.hq/immovable/autoTier` | 본부 표시. `immovable` 이면 이전·철거 단추를 그리지 않는다 |
| 뷰 | `structureView.work` | 지금 걸린 일 `{mode,phase,progress,refund,toX,toY,cancelable}` |
| 뷰 | `structureView.inactive` | 이전·철거 중이라 **효과가 멎었다** (합산에서 빠진다) |
| 뷰 | `siteView.mode/modeName/phase/refund/toX/toY/cancelable` | 현장이 신축·개축·철거·이전 중 무엇인가 |
| 뷰 | `housing.arrival.reqs[]` | ★ §12-3 — 유입 조건 하나하나 `{key,ok,text,have,need,detail}` |
| 뷰 | `housing.arrival.daysUntil` | ★ §12-4 — 다음 주민까지 남은 게임일(못 오는 상태면 `null`) |
| 뷰 | `worldDiff.caravans` | ★ §12-6 — 상단 목록. **무역이 열리기 전에는 언제나 빈 배열** |
| 오류 | `IMMOVABLE` `AUTO_TIER` `TOO_LATE` | 본부는 못 옮긴다 / 본부는 손으로 개축 안 한다 / 이미 헐어 되돌릴 수 없다 |

### 0-Y-2. 바뀐 계약

| 무엇 | 전 | 후 |
|---|---|---|
| 티어 승격 | 일 틱이 조건을 보고 **자동** | **`promoteSettlement` 명령만**. 조건은 `state.tier.next.reqs[]` 에 `have/need` 로 실려 온다 |
| 건물 좌표 | 칸 하나 | **좌상단 앵커 + 풋프린트**. `placeBuilding{x,y}` 의 `x,y` 는 **커서가 가리킨 칸**이고 서버가 앵커로 옮겨 잡는다 |
| 배치 간격 | `cheb(a,b) < minSpacing` 이면 거절 | **두 풋프린트 사각형 사이 간격** < `minSpacing` 이면 거절 (1×1 끼리는 옛 규칙과 같은 값) |
| 캐러밴 | 월드 스냅샷에 늘 실림 | **8장(무역)을 지난 뒤에만** |
| 좌클릭 | 빈 땅 = 이동 | **선택·상호작용 전용**(빈 땅 = 선택 해제). 이동은 **우클릭 지면**(이동 마커) 또는 WASD |
| 주민 위치 | 서버 좌표가 클라 보간을 리셋 | ★ §12-11 — **직업·대상이 그대로면 클라가 위치를 소유**한다. 서버 `x,y`는 쳐다보지 않고 `destX,destY`만 목표점으로 쓴다. 스냅은 **대상이 바뀐 순간 + 26칸 넘게 벌어졌을 때만** |
| 사기(민병) | 쓰러진 **횟수**만큼 깎임 | 한 번이라도 쓰러진 **사람 수**(`waveResult.militiaHurt`)만큼. 같은 사람이 여러 번 쓰러져도 한 사람 몫 |

---

## 0-A. v3.0 → v3.1 델타 — **진행 감독(Progression Director)**

한 문장: **시간은 아무것도 열지 않는다.** 게임의 모든 문(건물·기능·UI·명령·이벤트)을
`server/engine/progression.js` 한 곳이 쥐고, 그 문은 `data/chapters.json` 의 **콘텐츠 사슬 10장**이 연다.

### 0-A-1. 신설

| 구분 | 이름 | 한 줄 설명 |
|---|---|---|
| C→S | `appraiseLand {structureId?}` | **감정의 날의 유일한 방아쇠.** 감정소를 다 세우고 그 건물을 눌러 발동한다 |
| S→C | `chapterOpen` / `chapterDone` / `questStep` | 장이 열리고·닫히고·칸을 통과했다. 화면은 팡파레 + 「새로 열린 것」 카드 1장 |
| 뷰 | `state.chapter` | 지금 장 · 목표 카드 1장 · **마커가 가리킬 대상 후보(좌표)** |
| 뷰 | `state.unlocked.commands` | 이 장에서 받을 수 있는 명령 목록(잠긴 단추는 렌더 자체를 안 한다) |
| config | `chapters` | 사슬 규칙 공개본(어느 장인지는 `state.chapter` 로만) |
| 자료 | `data/chapters.json` | 사슬 정본 — 조건·해금·보상 |
| 건물 | `appraisal_post`(감정소) | 목재 60·석재 30. `structureView.action='appraiseLand'` |
| 오류 | `CHAPTER_LOCKED` | 「아직 그럴 때가 아닙니다」 — 티어가 아니라 **장**이 막았다 |

### 0-A-2. 바뀐 계약

| 무엇 | v3.0 | v3.1 |
|---|---|---|
| 해금의 정본 | `tiers.json` 의 `unlocks` + 건물 `requiresTier` | **`chapters.json`**. 티어 해금은 **마지막 장(엔드리스)에 들어선 뒤에만** 합류한다 |
| 감정의 날 | 티어 3 마일스톤에서 자동 | **`appraiseLand` 명령**으로만. 시간·티어 트리거 전부 삭제 |
| 웨이브 일정 | 티어 2 도달 후 자동 | **7장에서 「낯선 발자국」을 살핀 뒤**에만 잡힌다 |
| 주민 유입 | 티어 1부터 | **4장(오두막 완공)부터** |
| 무역 오퍼 | 교역소가 서면 | **8장 완료(교역소)** 뒤에만 |
| 어전 회의·조언·유물 | 티어 4 / 상시 | **9장 완료(사당)** 뒤에만. 열린 뒤에도 **모달 자동 팝 금지** — 알림 배지만 |
| 재해·중간충격 | 상시 | **7장부터**(`chapters.json` `disastersFromChapter`) |
| 잠긴 계층의 뷰 | `open:false` 로 내려감 | **필드 자체가 없다**(`wave`·`battle`·`defense` 는 `null`, `market`·`offers`·`councils`·`mandate`·`roles`·`advices`·`orders`·`artifacts` 는 부재) |
| `nation.buildable` | 잠긴 것도 `unlocked:false` 로 실림 | **지금 장에서 지을 수 있는 것만** 실린다(비면 배치대 단추를 그리지 않는다) |
| 건물 완공 | 다음 일 틱 | **마지막 망치질이 세운다** — `actionSwing {siteId}` ack 에 `done:true`·`structure` |
| 월드 크기 | 128×128 | **256×256** (노드 수 면적 비례, 도읍 거리 재배치) |
| NodeView | 모든 항목 always | **기본값 항목 생략**(빠지면 `false`·`0`·`null`) — 전면 탐사 스냅샷 584KB → 363KB |

---

## 0. v2.1 → v3.0 델타 표 (먼저 이것만 봐도 된다)

### 0-1. 신설

| 구분 | 이름 | 한 줄 설명 |
|---|---|---|
| C→S | `actionSwing {nodeId\|siteId}` | **스윙 노동**. 틱을 안 기다리고 즉시 처리. 서버가 쿨타임·사거리·노드 스윙 카운트를 판정 |
| C→S | `combatSwing {targetId?}` | 웨이브 전투 중 검 참여. 죽음 없음(다운) |
| C→S | `upgradeStructure {structureId}` | **개별 건물** 한 채만 다음 티어로 |
| C→S | `repairStructure {structureId}` | 파손 건물 수리 |
| C→S | `placeFence {points[],gates[],tier}` | **울타리 조각 드래그 배치** |
| C→S | `upgradeFence {segmentIds?}` | 목책 → 석벽 |
| C→S | `repairFence {segmentIds?}` / `removeFence {segmentIds}` | 조각 수리·철거 |
| C→S | `requestChronicle` | 연대기 다시 청하기 |
| S→C | `tierUp` | **티어업** — 팡파레·영토 말뚝·도감 카드 공개 |
| S→C | `residentArrived` | 주민 한 명 도착(이름·외형) |
| S→C | `buildingDone` | 건물 완공/개축 |
| S→C | `waveIncoming` / `battleStart` / `battleTick` / `waveResult` | 엔드리스 웨이브 실시뮬 스트림 |
| S→C | `swing` | 남의 스윙 중계(연출용) |
| S→C | `chronicle` | 연대기 |
| REST | `POST /api/debug/battle` | 개발·QA — 진행 중인 전투를 즉시 끝까지 돌린다 |
| 뷰 | `state.tier` · `state.unlocked` | 성장 아크와 **점진 공개 목록** |
| 뷰 | `state.you.player` · `state.you.swing` | 내 스킬·도구·쿨타임·스윙 미리보기 |
| 뷰 | `state.nation.residents` / `.housing` | 주민(실인원)·주거 수용력·유입 상태 |
| 뷰 | `state.nation.fences` / `.fenceSummary` | 울타리 조각 |
| 뷰 | `state.nation.buildable` | 지금 지을 수 있는 건물 목록(서버 판정) |
| 뷰 | `state.wave` · `state.battle` · `state.defense` | 웨이브·전투·방어 요약 |
| 뷰 | `state.chronicle` | 연대기(시즌 결산 대체) |
| config | `tiers` · `skills` · `waves` · `buildings`(도감) · `time` | 새 값표 |

### 0-2. 폐기 (보내면 `UNKNOWN_COMMAND`, 뷰에서 사라짐)

| 폐기된 것 | 대체 |
|---|---|
| `expand` (개척령) | 영토는 **티어**가 넓힌다 (`tierUp.radius`) |
| `setWallFocus` · 자동 성곽 링 · `wallRing` 뷰 | `placeFence` 조각 배치 |
| `placeTurret` / `removeTurret` | `placeBuilding {building:'arrow_tower'…}` (별칭으로 `placeTurret` 은 아직 받아 주지만 payload 는 `building` 이다) |
| `workSite` (현장 가속) | `actionSwing {siteId}` |
| `apAction {type:'work'}` · `ap.workFatigue` | `actionSwing {nodeId}` (하루 체감 곡선 폐지 → 쿨타임) |
| `seasonEnd` 이벤트 · `state.seasonResult` | `chronicle` |
| `invasionResult` · `combatScene` | `waveResult`(타임라인 포함) · `battleTick` |
| `state.nation.invasion` | `state.wave` |
| `state.nation.villagers` | `state.nation.residents` (이름·외형이 붙는다) |
| `state.nation.expansion` | `state.tier` |
| `config.invasions` | `config.waves` + `config.tactics` |
| `config.expansion` · `config.turrets` · `config.world.siteWork` | `config.tiers` / `config.buildings` / `config.world.fences` |
| `state.nation.buildings` 로 건물 티어 읽기 | `state.nation.structures[]` (**레거시 거울은 남아 있지만 가격·무역 공식 전용**) |

---

## 1. 기본 계약

### 1-1. 세 개의 시계 (v3 아키텍처의 핵심)

| 계층 | 주기 | 무엇이 도는가 | 클라가 받는 것 |
|---|---|---|---|
| **일 틱** | `config.time.dayRealSeconds` (기본 600초 = 1게임일) | 산출·소비·가격·무역·주민 유입·사기·웨이브 일정·사건·티어 판정 | `state`, `worldDiff` (★ §21-A1 — 일곱 컬렉션은 바뀐 줄만. §0-I), `worldState`, `events` |
| **실시간** | 즉시 | 스윙(`actionSwing`)·전투 스윙(`combatSwing`)·아바타 이동(`lordMove`)·건설/울타리 명령 | 그 명령의 **ack**(+ 남의 스윙은 `swing`, 새 땅을 밟으면 `worldDiff`) |
| **서브틱** | `config.time.subtickSeconds` (기본 0.25초) | 웨이브 전투 시뮬(적 이동·터렛 사격·민병·플레이어) | `battleTick` (★ §21-A2 — 적만 매 서브틱, 민병·터렛은 2Hz 변경분. §0-H) |

즉 **스윙은 틱을 기다리지 않는다.** 클라는 ack 로 돌아온 값(획득량·쿨타임·주기 완료 여부)으로 즉시 이펙트를 재생한다.

**★ 실시간 명령이 지켜야 할 두 가지 (v3.0)**
1. **상태 전량 방송 금지.** `actionSwing`·`combatSwing`·`lordMove` 는 초당 여러 번 오므로 `state`(NationView 전량)를 다시 빚지 않는다.
2. **그 대신 ack 가 제 결과를 데리고 온다.** 스윙 ack에는 창고 잔고(`resources`)·노드 잔량·공사 진척·솜씨가,
   `lordMove` ack·`worldDiff` 에는 방금 밝아진 안개·노드가 실린다. 클라는 이 권위값을 화면 장부에 그대로 옮겨 적는다
   (예측이 아니라 서버가 준 값이므로 어긋날 일이 없다). 다음 일 틱의 `state` 가 오면 그대로 덮인다.

### 1-2. ack 콜백 (모든 C→S 공통)

```js
socket.emit('actionSwing', { nodeId: 'n42' }, (res) => {
  if (!res.ok) return showError(res.error);   // {code, message, ...}
  playSwingEffect(res);                       // 성공 시 명령별 결과가 그대로 온다
});
```
- 콜백을 안 달면 아무 일도 안 한다(하위 호환). 실패는 `serverError` 로도 한 번 더 나간다.
- 실시간 명령(`actionSwing`·`combatSwing`)은 **ack 로만** 결과를 준다 — 초당 여러 번 오므로 `state` 전량 브로드캐스트를 하지 않는다.

### 1-3. 오류 코드

`NOT_JOINED` `NO_GAME` `UNKNOWN_COMMAND` `NO_NATION` `BAD_POSITION` `OUT_OF_TERRITORY` `BAD_TERRAIN` `TOO_CLOSE` `ON_NODE` `ON_STRUCTURE` `NO_SPACE` `NO_RESOURCE` `NO_GOLD` `BAD_BUILDING` `CHAPTER_LOCKED` `ALREADY_DONE` `TIER_LOCKED` `ALREADY_BUILT` `MAX_TIER` `IN_PROGRESS` `NEED_ARCHITECT` `NO_STRUCTURE` `NOT_DAMAGED` `USE_PLACE_FENCE` `BAD_POINTS` `TOO_MANY_POINTS` `SEGMENT_TOO_LONG` `FENCE_CAP` `NO_VALID_SEGMENT` `NO_FENCE` `COOLDOWN` `OUT_OF_RANGE` `NOT_READY` `DEPLETED` `HIDDEN_NODE` `NOT_WORKABLE` `BAD_TARGET` `NO_SITE` `DOWNED` `NO_BATTLE` `NO_TARGET` `ROLE_LOCKED` `TRADE_LOCKED` `NO_SAINT` `NO_AP` `BAD_AP_ACTION` `NO_VILLAGERS` `BAD_ORDER` `NO_ADVICE`

`COOLDOWN` 에는 `waitMs`·`cooldownMs` 가, `NOT_READY` 에는 `readyAt` 이 함께 온다.

---

## 2. REST

| 메서드 | 경로 | 응답 |
|---|---|---|
| GET | `/api/health` | `{ok, protocol, version, tick, paused, games, worldSize, dayRealSeconds, debugApi}` |
| GET | `/api/config` | `{protocol:'3.1', balance, resources, buildings, roles, tags, tactics, artifacts, aiNations, difficulty, tiers, skills, waves, **chapters**, world, time}` |
| GET | `/api/games` | `{games:[gameId]}` |
| POST | `/api/debug/speed` | `{gameId, tickRealSeconds}` → `{ok, tickRealSeconds}` |
| POST | `/api/debug/pause` | `{gameId, paused}` → `{ok, paused}` |
| POST | `/api/debug/step` | `{gameId}` → `{ok, tick, events}` (일 틱 1회) |
| POST | `/api/debug/battle` | `{gameId}` → `{ok, resolved, subticks, won}` (진행 중인 전투 즉시 완주) |
| POST | `/api/debug/seed` | `{gameId, seed}` → `{ok, seed}` |

> ★ **`/api/debug/*` 는 운영에서 잠긴다.** `NODE_ENV=production` 이면 다섯 길 모두 `404 {error:{code:'NOT_FOUND'}}`
> 로 답한다(뒷문의 존재 자체를 알리지 않는다). `DEBUG_API=1` 이면 운영에서도 열리고, `DEBUG_API=0` 이면 개발에서도 닫힌다.
> 지금 열려 있는지는 `/api/health` 의 `debugApi` 로 알 수 있고, 클라 개발 패널은 그 값을 보고 조용히 스스로 접힌다.

### 2-1. `/api/config` 주요 블록

```jsonc
{
  "protocol": "3.1",
  "time": { "dayRealSeconds": 600, "subtickSeconds": 0.25, "dayPhases": ["morning","day","evening","night"] },

  // ★ 성장 아크 — 목표 카드·연대기·도감이 이 표로 그린다
  "tiers": {
    "speedBonusPerTier": 0.05, "maxDefinedTier": 6,
    "endless": { "populationStep": 30, "radiusPerTier": 4, "namePattern": "왕도 {n}대" },
    "levels": [{ "tier": 0, "name": "야영지", "radius": 6,
                 "requires": { "population": 5, "structures": {"hut": 1}, "resources": {"grain": 20} },
                 "unlocks": { "buildings": ["hut"], "features": ["swing"], "ui": ["hud.resources3"] },
                 "line": "…", "milestone": null }]
  },

  // ★ 개인 스킬 — 스킬 패널이 이 표로 그린다
  "skills": {
    "order": ["farm","lumber","mining","build","combat"], "maxLevel": 20,
    "defs": { "lumber": { "name": "벌목", "nodeTypes": ["forest"], "toolTrack": "axe" } },
    "swing": { "baseCooldownSec": 1.2, "cooldownPerLevel": 0.03, "cooldownFloorSec": 0.5,
               "rangeTiles": 3, "yieldPerLevel": 0.05, "xpPerSwing": 2, "xpPerCycle": 6, "drainExponent": 0.85 },
    "xpCurve": [0, 36, 90],
    "tools": { "axe": [{ "level": 1, "key": "stone_axe", "name": "돌도끼", "multiplier": 1 }] },
    "nodes": { "forest": { "skill": "lumber", "swings": 3, "yield": {"wood": 3}, "cycleBonus": {"wood": 4}, "drain": 2 },
               "fertile": { "skill": "farm", "swings": 4, "requiresRipe": true },
               "water":   { "skill": "farm", "swings": 4, "yield": {"grain": 2}, "cycleBonus": {"grain": 5}, "drain": 1 } },
    "site": { "skill": "build", "swings": 4, "buildPointsPerSwing": 1.2, "cycleBonus": 1.5 },
    "combat": { "damagePerSwing": 9, "rangeTiles": 2.5, "playerHp": 60, "downSeconds": 12 }
  },

  // ★ 웨이브 — 규칙과 값표만. '언제 오는지'는 절대 없다(정보 비대칭)
  "waves": {
    "startTier": 2, "firstDelayDays": 2, "intervalDays": [4,6],
    "basePower": 245, "growth": 1.18,
    "rotation": ["wolf","bandit","pirate","viking","ogre","dragon"],
    "types": { "wolf": { "name": "늑대 떼", "hp": 55, "dps": 6, "speed": 2.5,
                         "weakTo": "sortie", "direction": "north", "sprite": "wolf", "flying": false } },
    "warn": { "campLeadDays": 2, "hintLeadDays": 3, "saint": { "warnLeadDays": 4, "damageBonus": 0.25 } },
    "battle": { "subtickSeconds": 0.25, "maxSeconds": 120, "spawnRadiusTiles": 22,
                "coreRadiusTiles": 2.5, "militia": { "hp": 40, "dps": 4 } },
    "powerCurve": [61]     // 위협 곡선 그래프용(1~12번째 웨이브의 기준 파워)
  },

  // ★ 건물 도감 — 카테고리·개별 티어·비용·효과 요약
  "buildings": {
    "categories": { "housing": { "name": "주거", "order": ["tent","hut","house","manor"] } },
    "defs": { "hut": { "key": "hut", "name": "오두막", "category": "housing", "desc": "…",
                       "requiresTier": 0, "maxTier": 3, "multi": true, "piece": false, "core": false,
                       "workSlots": 0, "job": null, "counters": null,
                       "tiers": [{ "tier": 1, "name": "오두막", "cost": {"wood": 45, "stone": 10},
                                   "gold": 0, "buildPoints": 8, "hp": 90,
                                   "effects": [{ "label": "수용 인원", "value": "2명" }] }] } },
    "effectRules": { "mode": {}, "stackCap": {} }
  },

  "world": { "size": 256, "territory": { "baseRadius": 6 },
             "fences": { "maxSegments": 400, "maxPointsPerRequest": 64, "maxSegmentSpan": 40,
                         "blockedTerrain": ["water"], "requiresTerritory": true },
             // ★ §19-B — 화면만 보는 값 둘(§0-N). 서버는 읽지 않는다
             "avatar": { "interactRadius": 3, "dayNightCycle": true, "moveReportMs": 220 },
             "render": { "interp": { "wildGapMs": 600, "mateGapMs": 1000, "leadFactor": 1.4,
                                     "minDelayMs": 160, "maxDelayMs": 2400, "idleGapMs": 1800 } } },

  "tactics": { "options": [{ "key": "siege", "name": "농성", "desc": "…" }], "default": { "tactic": "siege" } },

  // ★ v3.1 — 콘텐츠 사슬(규칙만). 지금 몇 장인지는 여기 없다(state.chapter 로만).
  "chapters": {
    "chapters": [{ "id": 1, "key": "spark", "name": "불씨", "subtitle": "마차가 멈춘 자리", "endless": false,
                   "steps": [{ "key": "first_swings", "title": "나무를 세 번 베어 보세요", "sub": "…", "verb": "E — 나무 베기" }],
                   "opens": { "buildings": [], "features": ["gather","swing"], "ui": ["hud.questCard"] },
                   "reward": { "line": "모닥불이 제대로 타오른다.",
                               "card": { "icon": "hammer", "title": "배치대가 열렸습니다", "text": "…" } } }]
  }
}
```

> ★ **정보 비대칭**: `/api/config` 어디에도 웨이브 도착 틱(`arrivalTick`)·약점·지형 시드·노드 좌표는 없다. 회귀 테스트가 문자열 `arrivalTick` 의 부재를 강제한다.

---

## 3. 클라 → 서버

### 3-0. 접속

#### `join {gameId?, playerName, avatarId?, appearance?, seed?, difficulty?, autoAssist?}`
ack / `joined` 이벤트 payload:
```jsonc
{ "protocol": "3.1", "gameId": "g_…", "nationId": "player",
  "you": { "role": null, "avatarId": "p1", "appearance": {} },
  "config": { "…": "/api/config 와 동일" },
  "roleLocked": true, "tier": 0 }
```
**접속 순서 계약(어기면 P0)** — 서버는 `joined` 를 보내기 **전에** 월드 스냅샷을 만든다. 실패하면 `joined` 를 보내지 않고 `serverError {code:'NO_WORLD'}` 로 접속을 물린다. 성공 시 순서:
`joined` → `chatHistory` → `avatars` → `world` → `state` → `worldState` → `chronicle` → (`battleStart` 진행 중이면) → (`report` 섭정 보고가 있으면)

**★ §19-A 방 전체 재방송 계약** — 사람이 들어오거나 나가면, 들어온 사람의 스냅샷을 다 보낸 **뒤에**
서버는 방 전체에 `state`·`worldDiff`·`worldState` 를 한 번 더 흘린다. 명부(`state.nation.members`)와
비켜난 동료의 자리가 바뀌기 때문이다 — 이게 없으면 먼저 있던 사람의 「함께 다스리는 이들」에
새 사람이 다음 일 틱(최대 `dayRealSeconds`)까지 뜨지 않는다.

**★ §19-A 한 소켓 = 한 방** — 같은 소켓이 다시 `join` 하면 서버는 옛 방을 먼저 뗀다(`leave`).
방을 겹쳐 두면 두 판의 `io.to(room)` 방송이 번갈아 꽂혀 자원·안개·노드·아바타가 두 세상 사이에서 오간다.

`seed` 는 새 정착지를 열 때만 쓰인다(이미 있는 `gameId` 면 무시). 화면은 주소 `?seed=…` 가 붙어 있을 때만 실어 보낸다 —
하니스·스모크가 **같은 땅을 다시 받기 위한 손잡이**이고, 평소에는 서버가 새 씨앗을 고른다.

#### `requestWorld {}` → 월드 스냅샷 재요청 (`world`+`state`+`worldState` 재전송)
#### `requestChronicle {}` → ack `{ok, chronicle}` + `chronicle` 이벤트

### 3-1. ★ 실시간 — 스윙 (GDD3 §3)

#### `actionSwing {nodeId}` — 자원 노드를 한 번 친다
서버 판정: ① 노드가 영토 안인가 ② 아바타가 `config.skills.swing.rangeTiles` 안인가 ③ 쿨타임이 지났는가(플레이어 단위) ④ 고갈/미성숙이 아닌가.
```jsonc
// ack
{ "ok": true, "nodeId": "n42", "nodeType": "forest", "skill": "lumber",
  "gained": { "wood": 4.2 },           // 이번 스윙으로 실제로 들어온 양
  "cycle": false,                       // true 면 한 주기(나무 한 그루)를 끝냈다 → 큰 이펙트
  "swings": 2, "swingsPerCycle": 3,     // 노드별 누적 스윙 / 주기 길이
  "amount": 41, "depleted": false,      // 노드 잔량
  "readyAt": null, "harvestReady": false,          // ★ 재배 루프 상태(밭 계열은 거두면 곧바로 재파종된다)
  "stage": "sown", "stageName": "파종", "growth": 0,
  "cooldownMs": 1140, "multiplier": 1.25,
  "tool": { "key": "stone_axe", "name": "돌도끼", "multiplier": 1 },
  "level": 3, "leveled": false, "xp": 84,
  "ruin": null,                         // 유적이면 {gauge, threshold}
  "resources": { "grain": 12, "wood": 17.2, "stone": 5 },    // ★ 스윙 뒤의 창고 잔고(권위값)
  "progress": { "level": 4, "xp": 210, "from": 180, "need": 260, "ratio": 0.37, "points": 1, "…": "…" } }
  // ★ §19-C 추가 — 다섯 솜씨를 합친 **내 눈금표**(skills.playerProgressView 와 같은 모양).
  //   솜씨 하나의 xp 만 주면 좌하단 눈금 바는 다음 일 틱(최대 10분)까지 낡는다(B04-2).
```
**계약**: `config.skills.defs[*].nodeTypes` 에 적힌 노드는 **반드시** `config.skills.nodes` 에 규격이 있어야 한다.
(둘이 어긋나면 그 노드를 칠 때 `NOT_WORKABLE` 로 튕긴다 — v3.0 에서 `water`(어로)가 그랬고, 지금은 규격이 있다.
 `test/fishing.test.js` 가 이 정합을 지킨다.)
- **어로(`water`)**: 밭 계열과 달리 `requiresRipe` 가 없어 언제든 칠 수 있다. 대신 물목의 물고기(`amount`)가
  유한해서 훑으면 바닥나고(`DEPLETED`) 일 틱마다 `regenPerTick` 만큼 다시 몰려온다.

> **★ ack 은 제 결과를 데리고 온다 (v3.0)** — 실시간 명령은 `state` 전량 방송을 일으키지 않는다.
> 그래서 ack 에 **그 명령이 바꾼 권위값**이 전부 실린다: 창고 잔고(`resources`) · 노드 잔량(`amount`·`depleted`) ·
> **재배 상태**(`readyAt`·`harvestReady`·`stage`) · 공사 진척(`remaining`·`progress`) · 솜씨(`level`·`xp`).
> 하나라도 빠지면 화면이 다음 일 틱(최대 10분)까지 옛 사실을 믿고 헛손질한다 —
> 실제로 `harvestReady` 가 없던 동안 화면은 **거둬 버린 빈 밭을 계속 두드렸다**.
> 남의 스윙은 `swing` 중계 이벤트에 같은 payload 가 실려 온다(창고·노드는 나라 공용이다 — 다만 솜씨 장부는 제 것만 쓴다).
>
> **실패한 ack 도 사실을 하나 준다.** `NOT_READY` 는 `{nodeId, readyAt, harvestReady:false}` 를 함께 실어,
> 화면이 「저 자리는 아직 아니다」를 곧바로 장부에 적을 수 있게 한다.
#### `actionSwing {siteId}` — 건설 현장을 한 번 친다
```jsonc
{ "ok": true, "siteId": "c3", "building": "hut", "skill": "build",
  "buildPoints": 1.2, "remaining": 4.4, "total": 8, "progress": 0.45,
  "cycle": false, "cooldownMs": 1200, "level": 2, "leveled": false, "xp": 30 }
```
> **테스트·시뮬 전용**: `now`(밀리초)를 함께 보내면 서버가 그 시각으로 쿨타임을 판정한다(결정론). 실제 클라는 보내지 않는다.

#### `combatSwing {targetId?}` — 웨이브 전투 중에만
```jsonc
{ "ok": true, "targetId": "e7", "damage": 11.3, "targetHp": 24, "killed": false,
  "cooldownMs": 1200, "skill": "combat", "level": 2, "leveled": false }
```
`targetId` 를 생략하면 사거리 안 가장 가까운 적. 다운 중이면 `DOWNED`.

#### `lordMove {x, y}` — 아바타 위치 보고(연출·안개·스윙 사거리 판정의 기준)
```jsonc
{ "ok": true, "moved": true,
  "avatar": { "id": "가온", "name": "가온", "x": 84, "y": 39, "tick": 12, "appearance": {} },
  "reveal": { "tick": 12, "sinceTick": 12, "reveal": true,
              "fog": [[5,2, 0,120, 2,136]], "nodes": [ /* nodeView */ ], "towns": [] } }
```
**★ 안개 즉시 공개 (v3.0).** 아바타가 선 칸이 바뀌면 서버가 **그 자리에서** 시야 원(`config.world.fog.vision.lord`)을
안개 마스크에 찍고, 방금 밝아진 청크와 그 안의 노드·도읍만 담은 작은 `worldDiff` 를 **방 전체에** 흘린다
(안개 마스크는 나라 공용이라 같이 접속한 동료도 함께 받는다). 같은 payload 가 ack 의 `reveal` 로도 온다.
- 예전(v3.0 이전 구현)에는 안개가 **일 틱**에서만 다시 계산돼, 검은 땅으로 걸어 들어가도 그 자리의 노드가
  최대 `dayRealSeconds`(기본 10분) 뒤에야 내려왔다. 그 사고의 정공 해법이다.
- **이동 스로틀**: 보고한 칸이 직전과 같으면 `moved:false` 로 아무 일도 하지 않고, 새로 밝아진 칸이 하나도
  없으면 `reveal:null` 이다. 비용이 '메시지 수'가 아니라 '새로 알게 된 정보량'에 붙는다 — 연타로 서버를 갉을 수 없다.
- 이 명령은 `state` 전량 방송을 **일으키지 않는다**(초당 여러 번 오기 때문이다). 다른 접속자에게는 `avatars` 만 중계된다.

### 3-2. ★ 건설 (GDD3 §7)

#### `placeBuilding {building, x?, y?}`
좌표를 주면 그 자리(고스트 유효성은 서버가 재검증), 안 주면 서버가 정착지 둘레에서 첫 유효 칸을 고른다.
```jsonc
{ "ok": true, "siteId": "c4", "building": "granary", "tier": 1,
  "buildPoints": 14, "cost": { "wood": 90, "stone": 45 }, "x": 70, "y": 58,
  "adjacency": { "radius": 5, "wants": ["field","fertile"], "counts": { "fertile": 2 }, "bonus": 0.04 } }
```
골드 통화 건물(영사관)은 즉시 완공되어 `{instant:true, structure:{…}}` 가 온다.

#### `upgradeStructure {structureId}` — ★ 그 한 채만
```jsonc
{ "ok": true, "siteId": "c5", "structureId": "s7", "building": "granary", "tier": 2,
  "buildPoints": 24, "cost": { "wood": 180, "stone": 100 } }
```
#### `repairStructure {structureId}` → `{ok, structureId, cost, structure}`
#### `reclaimField {x, y}` → `{ok, node:{id,type,x,y,readyAt}, cost}`

> **★ v3.1 — 마지막 망치질이 건물을 세운다.** `actionSwing {siteId}` 로 남은 일이 0 이 되면
> **그 자리에서** 완공된다(다음 일 틱을 기다리지 않는다). ack 에 `done:true` 와 `structure`(StructureView)가
> 실려 오고, 방 전체에 `buildingDone` 이 나간다. 화면은 공사 목록에서 빼고 건물 목록에 넣는다.

### 3-2b. ★ 감정의 날 (GDD3 §11-4)

#### `appraiseLand {structureId?}`
**이 명령이 감정의 날의 유일한 문이다.** 3일차 자동 발동도, 티어 3 마일스톤도 v3.1 에서 사라졌다.
조건: 감정소(`appraisal_post`, 목재 60·석재 30)가 **완공되어 있을 것**. 아직이면 `NO_STRUCTURE`,
이미 감정했으면 `ALREADY_DONE`.
```jsonc
{ "ok": true, "appraised": true, "structureId": "s7",
  "tags": ["fertile","holy"], "tagNames": ["비옥한 땅","성스러운 터"] }
```
성공하면 서버가 이어서 `emotionDay` → `mandate` 를 보낸다(플레이어가 손수 누른 결과이므로 자동 팝이 아니다).
건물 정보 패널은 `structureView.action === 'appraiseLand'` · `actionLabel` 이 있을 때만 그 단추를 그린다.

#### S→C `emotionDay` — ★ §17-18 로 두꺼워진 몫
```jsonc
{ "tags": ["비옥지","성지"], "tagKeys": ["fertile","holy"], "tagLine": "비옥지 · 성지",
  "revealedNodes": [{ "id": "n77", "type": "iron", "x": 70, "y": 54 }], "nodesRevealed": 4,
  "tagStories": [{ "key": "fertile", "name": "비옥지", "flavor": "괭이를 얕게만 넣어도 …" }],
  "cutscene": [{ "text": "세 밤을 갈아온 땅이 흔들린다.", "color": "#1b1b28" }],
  "worldTags": [{ "id": "ai1", "name": "…", "tags": ["유전","철광맥"] }] }
```
- **`cutscene` 길이는 고정이 아니다 — `5 + 태그 수 + 1` 장이다.** 앞 다섯은 옛 연출, 그 뒤로
  **배정받은 태그마다 한 장**(「이름 — 한 줄 이야기」, 빛깔 `balance.emotionDay.cutscene.flavorColor`),
  마지막 한 장이 마무리다. 클라는 프레임 수를 세지 말고 길이에 맞춰 재생 시간을 늘려야 한다.
- `tagStories` 는 컷신이 흘려보낸 문장을 모달에서 다시 읽히기 위한 몫이다(`flavor` 는 `data/tags.json` 이 쥔다).

### 3-3. ★ 울타리 조각 (GDD3 §7 — 자동 성곽 링 폐지)

#### `placeFence {points:[{x,y},…], gates?:[index], tier?:1|2}`
클라가 드래그한 꺾은선을 그대로 보낸다. 서버가 브레젠험으로 **타일 단위 조각**으로 쪼개고, 물·건물 자리·영토 밖·이미 있는 조각은 걸러 낸다.
```jsonc
{ "ok": true, "placed": 8, "skipped": 0, "cost": { "wood": 48 },
  "segments": [{ "id": "f1", "x1": 70, "y1": 54, "x2": 70, "y2": 55, "gate": true, "tier": 1,
                 "name": "목문", "hp": 90, "maxHp": 90, "condition": 1, "broken": false }] }
```
#### `upgradeFence {segmentIds?}` — 없으면 목책 전부 → 석벽. `{ok, upgraded, cost, segments}`
#### `repairFence {segmentIds?}` → `{ok, repaired, cost}`
#### `removeFence {segmentIds}` → `{ok, removed, refund}` (낸 값의 절반 환급)

### 3-4. 주민

| 명령 | payload | 설명 |
|---|---|---|
| `commandVillagers` | `{ids:[], order:{type:'work'\|'move'\|'scout', nodeId?, targetId?, job?, x?, y?}}` | 개별 지시(우클릭) |
| `setVillagerMix` | `{mix?}` 또는 `{alloc?, gather?, scout?}` | 비율 배치(각료 위임·봇) |
| `setLabor` | `{alloc}` 또는 `{recommended:true}` | 부처 비율 → 배치로 환산 |

★ §19-C — `setLabor` · `setVillagerMix` 는 나눈 **그 자리에서** 남은 유휴를 일터에 앉히고(`seated`),
캐는 손은 도읍(hall)보다 자원 노드를 먼저 받는다. 예전에는 이 정리가 다음 일 틱에나 돌아,
「알아서 나누기」 직후 사람들이 정착지 한복판에 뭉쳐 서 있었다.

`laborAlloc` 은 여전히 **배치의 파생값**이다(슬라이더가 아니다). 티어 3 미만에서는 부처가 돌지 않으므로 배치는 '누가 어느 노드에서 캐는가'만 정한다.

### 3-5. 경제·역할 (v2.1 그대로, 해금 조건만 추가)

| 명령 | 해금 | 비고 |
|---|---|---|
| `trade {nationId, side, resource, amount}` | 티어 3(교역소) | 아니면 `TRADE_LOCKED` |
| `respondOffer {offerId, accept}` / `decide {decisionId, choice}` | — | |
| `buyTool {tool, tier}` / `sellWeapon {}` | 티어 3(대장간) | 국가 단위 도구 — 개인 스킬 도구와 별개 |
| `setQueue {factory:{steel,fuel,weapon}}` | 티어 3 | `weapon` 은 **쓰이지 않는 칸**이다(공정이 만드는 것은 강재·연료뿐 — 무기는 `buyTool`). 계약 유지를 위해 필드는 남기고, 화면은 0을 실어 보낸다 (★ §19-C) |
| `ordersSet {orders}` | 티어 4(국법) | |
| `saintBuff {resource}` | 성녀 재임 | |
| `useArtifact {key}` / `councilAck {councilId}` | 티어 4 | |
| `setAutoExport {enabled}` / `setExportFloor {floors}` | — | |
| `pickRole {role}` / `delegate {assignments, vacant}` | 티어 3(관제 선포) | 아니면 `ROLE_LOCKED` |
| `adviceAct {adviceId}` / `setAutoAssist {enabled}` | — | |
| `apAction {type:'inspire'\|'survey', nodeId?, dept?}` | — | ★ `'work'` 폐기 · ★ §22 `'explore'` 폐기(유적은 스윙이 방 단위로 연다) |
| `harvestNode {nodeId}` | — | 클릭 수확 보너스 |
| `setBattlePlan {tactic}` | 티어 2 | ★ 서지 3구간 배분은 폐기 |
| `setAppearance {appearance}` / `chat {text}` | — | |
| `visitNation {nationId}` | — | ★ §17-16 이웃 나라 찾아가기(§0-R-1). 도읍 중심 `towns.visitRadius` 안 · 신원 명령 |
| `investigateTrail {trailId, choice?}` | — | ★ §18-D2 흔적 조사(§0-O-1 · 링1~3 은 **§0-L**). `trails.json reachTiles` 안 · 신원 명령 · `choice` 없이 1차, 있으면 2차 · ack 에 `joined`(합류 인원) · `healed`(음수면 상처) |
| `sleepVote {on?}` | — | ★ §17-7 다같이 잠자기(§0-P-2). 사람 아바타 전원이 잠들면 하루가 곧장 넘어간다 · 싸움 중 불가 · 신원 명령 |
| `handWork {structureId}` | — | ★ §17-9 건물 손일(§0-P-3). `buildings.json handWork` 가 비용·산출·쿨다운을 쥔다 · 거리·쿨다운은 사람별 · 신원 명령 |
| `commandCompanion {companionId, order}` | — | ★ §17-11 동료 지시(§0-P-4). `order:{kind:'move',x,y}` 또는 `null`(해제) |
| `customizeCompanion {companionId, name?, appearance?}` | — | ★ §17-11 동료 꾸미기(§0-P-4). 성공 시 방 전체에 `avatars` 재방송 |

---

## 4. 서버 → 클라

### 4-0. 이벤트 한눈에

| 이벤트 | 언제 | 클라가 할 일 |
|---|---|---|
| `joined` | join ack 직후 | 화면 전환 |
| `world` | join 1회 / `requestWorld` | 지형 RLE·노드·안개·건물·울타리 전량 그리기 |
| `worldDiff` | 매 일 틱 · **아바타가 새 땅을 밟은 즉시**(`reveal:true`) | ★ §21-A1 — **바뀐 것만 온다**: 바뀐 청크·노드에 더해 구조물·울타리·야영지·군락·마을도 **달라진 줄만**(주민은 판에만, 아바타는 늘 전량). `full` 이 거짓이 아니면 전량이다(§0-I) |
| `state` | 매 일 틱 · 명령 후 | HUD·패널 전량 |
| `worldState` | 매 일 틱 | 세계 지도·웨이브 화살표 |
| `events` | 매 일 틱 | 로그(표현 계층 문장 포함) |
| `tierUp` | 티어업 | **팡파레 + 영토 말뚝 연출 + 도감 카드 공개 + UI 해금** |
| `residentArrived` | 주민 도착 | 걸어오는 연출 + 이름 배너 |
| `buildingDone` | 완공/개축 | 먼지 구름 + 등장 바운스(개축이면 황금 반짝) |
| `emotionDay` / `mandate` | 티어 3 | 컷신 → 관제 선포 화면 |
| `waveIncoming` | 도착일 | 경보 |
| `battleStart` | 전투 개시 | 전투 화면 진입 |
| `battleTick` | 서브틱(0.25초) | ★ §21-A2 — **나뉘어 온다**: 적 위치는 매번(4Hz), 민병·터렛은 2Hz 의 변경분, 정적 칸은 안 온다. `full:false` 면 앞의 판에 얹고, `full` 이 거짓이 아니면 갈아 끼운다(§0-H) |
| `waveResult` | 전투 종료 | 결과 카드 + 리플레이 타임라인 |
| `campSpotted` / `campScouted` | D-2 / 정찰 성공 | 지도 마커 |
| `chronicle` | join · `requestChronicle` | 연대기 화면 |
| `council` / `offer` / `ruinEvent` / `report` | 각각 | 기존과 동일 |
| `chat` / `chatHistory` / `avatars` / `swing` | 멀티 | 말풍선·명부·남의 스윙 이펙트 |
| `questStep` | 목표 한 칸 통과 | 목표 카드 갱신 |
| `chapterDone` | 장 완료 | **팡파레 + 「새로 열린 것」 카드 1장**(개념 하나만) |
| `chapterOpen` | 다음 장 시작 | 배너 한 줄 + 새 UI 코치마크 |
| `you` | 역할 변동 | 내 역할 갱신 |
| `serverError` | 실패 | 토스트 |

### 4-1. `world` — 월드 스냅샷 (join 1회)

```jsonc
{ "protocol": 3, "tick": 0, "size": 128, "seed": 4242,
  "terrain": { "codes": ["grass","forest","rock","water","fertile"], "rle": [0,120,1,30] },
  "nodes": [ { "id": "n42", "type": "forest", "x": 70, "y": 58, "name": "숲", "rich": false,
               "amount": 45, "max": 45, "ratio": 1, "depleted": false, "workers": 0, "slots": 4, "job": "lumber",
               "swings": 0, "swingsPerCycle": 3, "skill": "lumber",
               "readyAt": null, "harvestReady": false, "stage": null, "stageName": null, "growth": null,
               "mine": true } ],
  "towns": [ { "nationId": "player", "name": "…", "x": 68, "y": 60, "isPlayer": true,
               "radius": 6, "preset": [], "known": true } ],
  "caravans": [],
  "fog": { "size": 128, "chunk": 16, "chunks": [[0,0,1,256]] },
  "territory": { "cx": 68, "cy": 60, "radius": 6 },
  "structures": [],
  "fences": [],
  "tier": 0 }
```
노드는 **탐사된 곳만** 실린다(안개 계약). `wall` 필드는 사라졌다.

### 4-2. `worldDiff` — 매 틱 변경분

```jsonc
// ★ §21-A1 — 전량 한 장(입장 뒤 첫 장 · 주기 되맞춤)
{ "tick": 12, "sinceTick": 11, "full": true,
  "fog": [[0,0,1,256]], "nodes": [], "removedNodes": [],
  "territory": {}, "sites": [], "avatars": [],
  "towns": [], "structures": [], "fences": [], "camps": [], "clusters": [],
  "counts": { "structures": 33, "fences": 140, "camps": 1, "clusters": 12, "towns": 4 } }

// ★ §21-A1 — 변경분 한 장. 안 바뀐 컬렉션은 **열쇠말 자체가 없다**
{ "tick": 13, "sinceTick": 12, "full": false,
  "fog": [], "nodes": [], "removedNodes": [],
  "territory": {}, "sites": [], "avatars": [ /* 늘 전량 */ ],
  "fences": [ { "id": "f7", "hp": 40, "condition": 0.5, "…": "그 줄 한 벌" } ],
  "removedStructures": ["s12"],
  "counts": { "structures": 32, "fences": 140, "camps": 1, "clusters": 12, "towns": 4 } }
```
노드 규칙: `stamp > sinceTick` **또는 `stamp === 현재 틱`** 인 것을 싣는다(같은 틱 안의 개간·수확이 누락되지 않게).

일곱 컬렉션(구조물·울타리·주민·야영지·아바타·군락·마을)의 계약은 **§0-I** 가 정본이다:
`full` 이 거짓이 아니면 전량, `full:false` 면 변경분(+`removedStructures`·`removedFences`·`removedCamps`),
**주민은 실리지 않는다**(판이 정본), 아바타는 늘 전량, `counts` 가 어긋나면 `requestWorld` 로 되맞춘다.

**★ 즉시 공개분(`reveal: true`)** — `lordMove` 로 새 땅을 밟은 순간에도 같은 `worldDiff` 가 온다. 일 틱 변경분과 두 가지가 다르다.
```jsonc
{ "tick": 12, "sinceTick": 12, "reveal": true,
  "fog": [[5,2, 0,120, 2,136]], "nodes": [ /* 방금 밝아진 청크 안의 노드만 */ ], "towns": [] }
```
- `sinceTick === tick` 이다. 청크 스탬프는 **게임일** 단위라 같은 날 안에 두 번 밝아진 것을 `sinceTick` 으로 가려낼 수 없다 —
  그래서 무엇이 밝아졌는지는 서버가 스탬프 함수에서 돌려받은 청크 목록으로 직접 정한다.
- `nodes`·`towns` 외의 항목(건물·울타리·주민·캠프)은 안개와 무관하므로 싣지 않는다. 클라의 `worldDiff` 처리는
  모든 항목이 선택적이어야 한다(빠진 항목은 '바뀐 것 없음'이다).

### 4-3. `state` — NationView

```jsonc
{
  "protocol": 3, "tick": 12, "day": 12, "phase": "endless", "paused": false,
  "difficulty": { "key": "kingdom", "name": "왕국", "desc": "…" },
  "time": { "dayRealSeconds": 600, "dayPhases": [], "subtickSeconds": 0.25 },

  // ★ 성장 아크 — 목표 카드와 점진 공개의 정본
  "tier": {
    "tier": 2, "name": "촌락", "radius": 12, "line": "…", "speedBonus": 0.10,
    "next": { "tier": 3, "name": "마을", "radius": 16, "fromRadius": 12, "ready": false,
              "reqs": [ { "key": "population", "ok": false, "need": 12, "have": 7, "text": "주민 12명" } ],
              "unlocks": { "buildings": [{ "key": "smelter", "name": "제련소" }],
                           "features": ["roles"], "ui": ["panel.roles"] },
              "line": "이름이 붙는 날이다.", "endless": false },
    "unlocked": { "buildings": [], "features": [], "ui": [] }
  },
  "unlocked": { "buildings": [], "features": [], "ui": [], "commands": [] },

  // ★ v3.1 — 진행 감독. 목표 카드 한 장과 퀘스트 마커가 전부 이 블록에서 나온다.
  "chapter": {
    "id": 3, "key": "hunger", "name": "허기", "subtitle": "먹을 것을 찾아",
    "total": 10, "endless": false, "stepIndex": 0, "stepCount": 2,
    "goal": {
      "key": "grain20", "title": "식량 20을 모으세요", "sub": "…", "verb": "E — 거두기",
      "short": "오두막",                                   // 자원 팝의 「(오두막까지 6)」
      "condition": { "type": "resource", "resource": "grain", "amount": 20 },
      "have": 12, "need": 20, "done": false,
      "hint": { "sel": "#tb-build", "text": "…" },
      "hintOnFail": { "codes": ["NO_RESOURCE"], "text": "석재가 필요해요 — 바위는 회색 언덕에 있습니다" },
      // ★ 마커가 가리킬 대상 후보 — 가까운 순 최대 3개. 노드는 **탐사된 곳만**(안개 계약)
      "targets": [{ "kind": "node", "id": "n42", "x": 70, "y": 58, "name": "water" }]
    },
    "flags": { "appraised": false },
    "trace": { "x": 84, "y": 39, "found": false }          // 7장 정찰 지점
  },

  // ★ 잠긴 계층은 '비활성'이 아니라 **부재**다 — 아래 필드는 그 장이 열려야 나타난다.
  //   mandate·roles·advices·ap·orders·artifacts·decisionQueue·market·offers·councils·battlePlan
  "mandate": { "open": false, "unlocked": true, "done": false, "vacantDefault": "trade" },

  // ★ 나 자신
  "you": {
    "avatarId": "p1", "role": null, "roleName": null,
    "player": { "id": "p1", "name": "개척자", "hp": 60, "maxHp": 60, "down": false, "downUntil": 0,
                "skills": { "lumber": { "name": "벌목", "level": 4, "xp": 210,
                                        "next": { "need": 276, "have": 210, "remaining": 66 },
                                        "cooldownSec": 1.1, "yieldMultiplier": 1.15,
                                        "tool": { "key": "stone_axe", "name": "돌도끼", "multiplier": 1 },
                                        "nextTool": { "key": "iron_axe", "name": "철도끼", "level": 6, "multiplier": 2 } } },
                "stats": { "swings": 312, "kills": 4, "gathered": { "wood": 840 } },
                "tierSpeedBonus": 0.10, "settlementTier": 2 },
    "swing": { "rangeTiles": 3,
               "targets": { "forest": { "skill": "lumber", "swings": 3, "cooldownMs": 1100,
                                        "multiplier": 1.15, "yield": { "wood": 3 }, "cycleBonus": { "wood": 4 } } } }
  },

  "nation": {
    "id": "player", "name": "…의 정착지", "isPlayer": true, "tags": [], "tagNames": [],
    "town": { "x": 68, "y": 60 }, "territory": { "radius": 12, "cx": 68, "cy": 60 },

    // ★ 주민 = 실인원
    "residents": [ { "id": "r3", "name": "들단이", "appearance": {}, "job": "lumber", "jobName": "나무꾼",
                     "x": 70, "y": 58, "destX": 70, "destY": 58, "targetId": "n42",
                     "militia": false, "represents": 1, "selectable": true } ],
    "housing": { "population": 7, "capacity": 9, "freeBeds": 2, "byBuilding": { "hut": 6, "tent": 3 },
                 "arrival": { "open": true, "reason": null, "freeBeds": 2, "capacity": 9,
                              "attractiveness": 1.34, "intervalDays": 2.24, "progress": 0.4, "grainDays": 6.1 },
                 "departmentsActive": false },
    "peoplePerUnit": 1,
    "villagerMix": { "counts": {}, "mix": {}, "units": 7 },

    // ★ 개별 건물
    "structures": [],
    "sites": [ { "id": "c4", "building": "granary", "structureId": null, "name": "곡창", "tier": 1,
                 "x": 70, "y": 58, "remaining": 6, "total": 14, "progress": 0.57, "upgrade": false } ],
    "fences": [],
    "fenceSummary": { "segments": 32, "gates": 2, "stone": 0, "broken": 0, "damaged": 3, "maxSegments": 400,
                      "costs": { "wood": { "wood": 6 }, "stone": { "stone": 8, "wood": 2 }, "gate": { "wood": 14 } } },
    "buildable": [ { "key": "granary", "name": "곡창", "category": "production", "requiresTier": 2,
                     "unlocked": true, "multi": true, "built": 1, "maxTier": 3,
                     "cost": { "wood": 90, "stone": 45 }, "gold": 0, "buildPoints": 14, "affordable": true } ],

    "workPosts": [], "camps": [], "exploredRatio": 0.21,
    "avatars": [], "players": [{ "id": "p1", "name": "…", "hp": 60, "maxHp": 60, "down": false, "levels": {} }],

    "population": 7, "populationCap": 9, "morale": 1.03, "gold": 42,
    "resources": { "grain": 63.2, "wood": 210.5 },
    "laborAlloc": {}, "gatherScale": {}, "factoryQueue": {}, "departmentsActive": false,
    "roles": {}, "buildings": { "_comment": "레거시 거울 — 가격·무역 공식용. 건물 표시는 structures 를 쓸 것" },
    "buildPoints": 2.4, "prestige": 0,
    "orders": [], "artifacts": [], "decisionQueue": [], "buffs": [], "sanctuary": {},
    "_artifactsNote": "★ §20-R1 — 엔트리는 {key,name,grade,desc,type,obtainedTick,consumed,chargesLeft,charges} (0-U-2)",
    "rationing": false, "autoExport": true, "online": true, "members": [], "stats": {},
    "ap": { "current": 3, "max": 3,
            "actions": { "inspire": { "cost": 1 }, "survey": { "cost": 0 } },
            "usedDepts": [] },
    "advices": [], "autoAssist": true,
    "battlePlan": { "tactic": null, "setTick": null, "options": [], "bonus": 0.12, "penalty": 0.08 },
    "survey": null, "nodeContribution": {}
  },

  // ★ 웨이브
  "wave": {
    "index": 0, "number": 1, "unlocked": true, "startTier": 2, "active": false,
    "arrivalTick": 18, "daysUntil": 3, "daysUntilMin": 3, "precise": true,
    "enemy": { "type": "wolf", "name": "늑대 떼", "desc": "…", "units": 11, "power": 61,
               "unitHp": 55, "unitDps": 6, "direction": "north", "weakTo": "sortie",
               "flying": false, "sprite": "wolf" },
    "blessing": 0.25,
    "hint": "성녀의 예언 — 늑대 떼 11이(가) 3일 뒤 북쪽에서 옵니다.",
    "history": [ { "index": 0, "number": 1, "type": "wolf", "name": "늑대 떼", "tick": 18,
                   "won": true, "enemiesKilled": 11, "enemiesTotal": 11 } ],
    "tacticHint": { "recommended": "sortie", "recommendedName": "요격", "text": "…" }
  },
  "battle": null,
  "lastBattle": { "timelineEvents": 214 },

  "defense": {
    "turrets": [{ "id": "s9", "key": "arrow_tower", "name": "화살탑", "dps": 10, "range": 8,
                  "x": 72, "y": 56, "counters": ["pirate","wolf"] }],
    "turretCount": 3, "turretDps": 26, "militiaCount": 5, "militiaDps": 9.8,
    "playerDps": 7.5, "totalDps": 54.2,
    "permanent": 0, "fenceSegments": 32, "fenceHp": 1860,
    "multipliers": { "defender": 1.28, "enemy": 1 }, "saint": true, "saintBonus": 0.25,
    "estimate": { "enemyHp": 605, "enemyDps": 66, "secondsToClear": 11.2, "secondsFenceHolds": 28.2,
                  "maxSeconds": 120, "comfortable": true }
  },

  "market": { "local": {}, "foreign": null, "open": false, "tariff": 0.15, "freight": 0.4 },
  "recommendations": { "labor": {} },
  "offers": [], "councils": [],

  // ★ 연대기 (시즌 결산 대체)
  "chronicle": { "day": 12, "tier": 2, "tierName": "촌락",
                 "entries": [{ "id": "k7", "tick": 9, "kind": "tier_up", "title": "촌락", "text": "…", "data": {} }],
                 "counts": { "tier_up": 3, "wave": 1 },
                 "totals": { "days": 12, "population": 7, "peakPopulation": 7, "structures": 6, "fences": 32,
                             "wavesFaced": 1, "wavesHeld": 1, "gold": 42, "artifacts": 0, "prestige": 0 },
                 "milestones": { "tier_up": "성장", "wave": "침공" } }
}
```

#### StructureView
```jsonc
{ "id": "s7", "key": "granary", "name": "곡창", "category": "production", "tier": 2, "maxTier": 3,
  "x": 70, "y": 58, "hp": 180, "maxHp": 200, "condition": 0.9, "ruined": false, "upgrading": false,
  "residents": 0,
  "effects": [{ "label": "곡물 산출", "value": "+30%" }],
  "nextTier": { "tier": 3, "name": "곡창", "cost": { "wood": 300, "stone": 180 }, "gold": 0, "buildPoints": 36,
                "effects": [{ "label": "곡물 산출", "value": "+50%" }] },
  "adjacency": 0.04,
  "handWork": { "label": "손수 제련한다", "desc": "…", "cost": { "ironOre": 4 }, "yield": { "steel": 2 },
                "cooldownSeconds": 4 } }
```
`adjacency` 는 건축가 재임 시에만 숫자, 아니면 `null`.
★ §17-9 `handWork` — 그 건물에 손일이 있으면 `buildings.json` 의 정의를 그대로 싣고, 없으면 `null`.
화면은 이것만 보고 건물 곁 단추·비용 툴팁을 그린다(비용·산출을 화면이 짓지 않는다). 명령은 §0-P-3.

#### FenceView
```jsonc
{ "id": "f12", "x1": 70, "y1": 54, "x2": 70, "y2": 55, "gate": false, "tier": 1,
  "name": "목책", "hp": 42, "maxHp": 60, "condition": 0.7, "broken": false }
```
#### CampView / AvatarView
```jsonc
{ "id": "camp_0", "waveIndex": 0, "type": "wolf", "name": "늑대 떼", "direction": "north",
  "x": 68, "y": 18, "spottedTick": 16, "scouted": true,
  "sizeHint": "작은 무리",
  "power": null, "units": null,
  "intel": "정찰병이 멀리서 규모만 어림했습니다." }

{ "id": "p1", "name": "개척자", "x": 70, "y": 58, "tick": 12, "appearance": {},
  "down": false, "hp": 60, "maxHp": 60 }
```
`sizeHint` 는 정찰 전이면 `null`, `power`·`units` 는 국방부 전용이며 아니면 `null`.

### 4-4. ★ `tierUp`
```jsonc
{ "tier": 2, "name": "촌락", "radius": 12, "fromRadius": 9,
  "unlocks": { "buildings": [{ "key": "granary", "name": "곡창" }],
               "features": ["fences","waves"], "ui": ["hud.threat"] },
  "line": "울타리를 두를 만큼은 되었다.",
  "nodesGained": 6, "addedNodeIds": ["n77"],
  "milestone": null,
  "unlockedAll": {} }
```
`milestone` 이 `'emotionDay'` 이면 곧 `emotionDay`·`mandate` 가 따라온다.
클라: 팡파레 → 영토 말뚝이 새 반경으로 박히는 연출 → 새로 열린 건물 도감 카드 → `ui` 목록의 패널 등장(코치마크 1줄).

### 4-5. ★ `residentArrived`
```jsonc
{ "id": "r3", "name": "들단이",
  "appearance": { "skin": 2, "hair": 5, "hairColor": 1, "outfit": 0, "outfitColor": 3 },
  "x": 80, "y": 52, "total": 3, "population": 3, "capacity": 5 }
```
`x,y` 는 **영토 밖 도착 지점**이다 — 클라는 여기서 정착지 중심까지 걸어오는 연출을 재생한다.

### 4-6. ★ `buildingDone`
```jsonc
{ "structureId": "s7", "building": "granary", "key": "granary", "name": "곡창", "tier": 2,
  "x": 70, "y": 58, "upgrade": true }
```

### 4-7. ★ 웨이브 스트림

#### `waveIncoming`
```jsonc
{ "index": 0, "number": 1, "type": "wolf", "name": "늑대 떼", "units": 11, "power": 61, "direction": "north" }
```
#### `battleStart` · `battleTick` 되맞춤 — **풀 스냅샷**(`full` 이 거짓이 **아닌** 장)
```jsonc
{ "full": true,
  "waveIndex": 0, "number": 1, "type": "wolf", "name": "늑대 떼",
  "t": 12.5, "maxSeconds": 120, "core": { "x": 68, "y": 60 }, "over": false, "won": false,
  "total": 11, "killed": 4, "escaped": 0,
  "enemies": [{ "id": "e3", "x": 72.4, "y": 54.1, "hp": 31, "maxHp": 55, "type": "wolf", "looting": false }],
  "militia": [{ "id": "r5", "x": 70, "y": 57, "hp": 40, "maxHp": 40, "alive": true }],
  "turrets": [{ "id": "s9", "x": 72, "y": 56, "range": 8, "key": "arrow_tower" }],
  "players": [{ "id": "p1", "hp": 60, "maxHp": 60, "down": false }],
  "events": [ { "t": 12.25, "kind": "kill", "targetId": "e2", "by": "turret", "byId": "s9" } ] }
```
전투 개시 · 입장/관전 진입 · `battleFullEvery`(기본 40 서브틱) 되맞춤 · `/api/debug/battle` 이 이 모양을 보낸다.
`full` 이 아예 없는 장(구경 모드 `mock.js`)도 **풀로 읽는다** — 옛 모양과 한 글자도 다르지 않다.

#### `battleTick` 서브틱 — **델타**(`full:false`) ★ §21-A2
```jsonc
{ "full": false, "waveIndex": 0, "t": 12.75, "over": false, "won": false, "killed": 4, "escaped": 0,
  "enemies": [{ "id": "e3", "x": 72.9, "y": 54.6, "hp": 28 },
              { "id": "e9", "x": 80.1, "y": 44.2, "hp": 55, "maxHp": 55, "type": "wolf" },
              { "id": "e4", "x": 68.2, "y": 60.4, "hp": 12, "looting": true }],
  "militia": [{ "id": "r5", "x": 70.4, "y": 57.2, "hp": 34 }],
  "players": [{ "id": "p1", "hp": 41, "maxHp": 60 }],
  "events": [ { "t": 12.75, "kind": "playerHit", "targetId": "p1" } ] }
```
- `enemies` — **매 서브틱(4Hz), 살아 있는 놈 전량.** `maxHp`·`type` 은 **처음 실리는 적에게만**(위 `e9`) 붙는다.
  이미 아는 적은 `{id,x,y,hp}` 뿐이고, 훔치는 중일 때만 `looting:true` 가 더 붙는다.
- `militia` — **2Hz · 달라진 줄만.** 아무도 안 움직였으면 이 칸 자체가 없다. 쓰러졌으면 `alive:false` 가 붙는다.
- `turrets` — 목록이 실제로 달라졌을 때만(새 터렛·철거·개축) **통째로** 다시 온다. 그 밖에는 없다.
- `players` — 체력·다운이 달라진 사람만. 쓰러졌으면 `down:true`.
- `number`·`type`·`name`·`maxSeconds`·`core`·`total` 은 **없다** — 앞의 풀 스냅샷에서 잇는다.
- **빠진 칸은 거짓**이다(`looting`·`down` 없음 = 거짓, `alive` 없음 = 참). 정적 칸(`maxHp`·`type`)만 앞의 것을 잇는다.

`events[].kind`: `spawn` `kill` `fenceBreak` `structureHit` `structureRuined` `structureBreach` `breach` `militiaDown` `playerDown` `playerHit` `hold` `withdraw`

> ★ §19-F1(F05-3) — `structureBreach` 는 **길목의 건물이 뚫린** 순간이다(무너진 것이 아니다:
> `waves.battle.breach.openHpRatio` 아래로 밀리면 적이 그 자리를 지나간다). 필드는
> `structureHit` 과 같다: `{ t, kind, structureId, key, x, y }`. 옛 클라이언트는 모르는 kind 를
> 그냥 흘려보내므로 추가만으로 호환이 깨지지 않는다.


#### `waveResult`
```jsonc
{ "index": 0, "number": 1, "tick": 18, "type": "wolf", "name": "늑대 떼", "power": 61,
  "won": true, "duration": 34.9,
  "enemiesTotal": 11, "enemiesKilled": 11, "enemiesEscaped": 0,
  "fencesBroken": 2, "militiaDowned": 1, "playersDowned": 0,
  "looted": {},
  "structuresDamaged": [{ "id": "s3", "key": "hut", "name": "오두막", "damage": 22.5,
                          "ruined": false, "hp": 67.5, "maxHp": 90 }],
  "playerDamage": { "p1": 54 },
  "moraleDelta": 0.04, "gold": 21,
  "timeline": [],
  "text": "늑대 떼 11을(를) 모두 막아 냈습니다." }
```
> 이기려면 **한 놈도 남기지 않고** 쫓아내야 한다. 시간이 다 되면 남은 적이 챙긴 것을 들고 물러간다 — 전멸도 게임오버도 없다. 건물 내구도는 한 웨이브에 `waves.battle.structureDamageFloor`(25%) 아래로 내려가지 않는다.

### 4-8. `swing` — 남의 스윙 중계 (멀티 연출)
```jsonc
{ "avatarId": "가온", "type": "actionSwing", "nodeId": "n42", "gained": { "wood": 4.2 }, "cycle": false,
  "amount": 41, "depleted": false, "resources": { "grain": 12, "wood": 17.2, "stone": 5 } }
```
`removedNodes: ["n42"]` — ★ §19-A. **세상에서 지워진 자리**(궤를 열면 자리가 사라진다 — 그루터기가 아니다).
잔량(`amount`)·그루터기(`depleted`)로는 화면의 노드 사전에서 뺄 수 없어서 따로 싣는다.
같은 순간 서버는 방 전체에 `worldDiff {tick, removedNodes}` 도 흘린다(발신자 포함 — 지움은 모두가 같이 봐야 한다).
지울 것이 없으면 이 칸은 **아예 실리지 않는다**(빈 배열이 아니다).

그 스윙의 ack 와 같은 payload에 `avatarId`·`type` 만 얹은 것이다. 창고(`resources`)와 노드 잔량은 나라 공용이므로
동료의 화면도 함께 갱신된다 — 다만 `level`·`xp` 같은 **솜씨 장부는 제 것만** 쓴다(남의 스윙으로 내 레벨을 덮으면 안 된다).

### 4-9. 그 밖 (v2.1 그대로)
`emotionDay` · `mandate` · `council` · `offer` · `ruinEvent` · `report` · `chat` · `chatHistory` · `avatars` · `you` · `campSpotted` · `campScouted` · `serverError` · `events`

---

## 5. 정보 비대칭 규칙 (서버에서 강제 · 클라 신뢰 금지)

| 정보 | 누가 보는가 |
|---|---|
| 웨이브 **도착일·적 구성** | 성녀 재임(또는 「예언의 구슬」). 없으면 `precise:false` + `daysUntilMin` 만 |
| 웨이브 **상성 힌트**(`wave.tacticHint`) | 국방대신 Lv3+ 또는 플레이어가 국방 담당 |
| 적 캠프 **정확한 병력**(`camps[].power`) | 위와 같음. 정찰 전에는 `sizeHint` 조차 없다 |
| 외국 시세(`market.foreign`) | 외교관 재임 **그리고** 교역소가 선 뒤 |
| 배치 인접 보너스(`structures[].adjacency`, `nation.adjacency`) | 건축가 재임 |
| 토양 피로·수확 예보 | 농정관을 플레이어가 맡았을 때 |
| 병목·재고 회전 | 공장장을 플레이어가 맡았을 때 |
| 안개 밖 노드·도읍 | 아무도 — `world`/`worldDiff` 에 아예 안 실린다 |

**금지**: 클라가 `/api/config` 나 `world` 에서 웨이브 시점을 역산할 수 있으면 안 된다. 회귀 테스트가 `config` 문자열에 `arrivalTick` 이 없음을 강제한다.

---

## 5-A. ★ 콘텐츠 사슬 계약 (v3.1 · GDD3 §11-2)

`data/chapters.json` 이 정본이고 `server/engine/progression.js` 가 유일한 판정자다.

### 조건 타입 (`goal.condition.type`)

| 타입 | 필드 | 무엇을 재는가 |
|---|---|---|
| `swings` | `skill,count` | 그 솜씨로 휘두른 총 횟수(나라 전체) |
| `resource` | `resource,amount` | 창고 잔고 |
| `structure` | `building,count` | 완공된 건물 수 |
| `population` | `count` | 주민 수 |
| `fenceSegments` | `count` | 세운 울타리 조각 |
| `wavesHeld` | `count` | 막아 낸 웨이브 |
| `tier` | `tier` | 정착지 티어 |
| `flag` | `flag` | `appraised`(감정 완료) · `traceFound`(발자국 조사) |
| `all` / `any` | `of[]` | 여러 조건 묶음 |

### 마커 대상 (`goal.targets[].kind`)

| kind | 실리는 것 | 화면이 하는 일 |
|---|---|---|
| `node` `site` `structure` `camp` `point` | `id,x,y,name` | 월드 바운스 화살표 + 화면 밖이면 가장자리 화살표 |
| `buildSlot` | `id(건물키), sel, name` | 그 단추를 두근거리게 하고 코치마크를 붙인다 |
| `ui` | `sel` | 같음 |

목표 카드를 누르면 월드 대상이면 **카메라가 그리로 뛰고**, 화면 대상이면 그 단추를 짚는다.

**금지**: 클라가 사슬을 지어내지 않는다. 화면은 `state.chapter` 를 그대로 옮겨 적기만 한다.

---

## 6. 점진 공개(UI 해금) 계약 — GDD3 §1·§8·**§11-1**

클라는 **`state.unlocked` 만 보고** 화면을 켠다. 그 장이 열리기 전에는 그 패널·버튼이 **아예 없어야** 한다(비활성이 아니라 부재).
★ v3.1: 아래 표의 '티어' 열은 **더 이상 조건이 아니다**(엔드리스 장에 들어선 뒤의 참고값). 여는 것은 장이다.

| `ui` 키 | 켜지는 것 | 티어 |
|---|---|---|
| `hud.resources3` `hud.questCard` | 자원 3칸 + 목표 카드 | 0 |
| `hud.population` `panel.residents` | 인구 표시 · 주민 패널 | 1 |
| `panel.codex` | ★ 도감(J) — 3장 「허기」에서 사냥과 함께 열린다 | — |
| `hud.threat` `panel.build` `panel.fence` | 위협 게이지 · 건설대 · 울타리 그리기 | 2 |
| `panel.roles` `panel.trade` `panel.skills` | 역할 · 교역 · 스킬 | 3 |
| `panel.orders` `panel.council` | 국법 · 어전 회의 | 4 |
| `panel.diplomacy` | 외교 | 5 |
| `panel.prestige` | 위신 | 6+ |

`features` 키(클라 동작 분기): `gather` `swing` `reclaim` `placeBuilding` `chronicle` · **`hunt` `codex`** · `residentArrival` `commandVillagers` `reclaimField` · `fences` `waves` `prophecyHint` · `emotionDay` `roles` `trade` `departments` `advisor` · `orders` `council` `artifacts` · `highTierUpgrade` `diplomacy` · `prestige`

---

## 7. 세이브 정책

`world.schema = 5`. v1(8×8 타일)·v2(시즌 오픈월드)·v3(128×128 · 티어 해금)·**v3.1(schema 4)** 스냅샷은 **읽지 않는다** —
v3.1 에서 월드가 256×256 이 되고 해금의 정본이 장(chapter)으로 옮겨졌으며,
**v3.2 에서는 땅 자체가 다시 그려졌다**(자원 군락 · 영토 안 빈 땅 · 유적 크기 · 상시 생태계).
서버는 구스냅샷을 만나면 폐기하고 새 게임을 판다(콘솔 경고 1줄).
장 상태는 `nation.progress = {chapter, step, cleared[], flags{}, trace}` 에 산다(국가 단위 = 멀티 공유).

---

## 8. 계약 회귀 테스트 (전부 `npm test` 안)

| 파일 | 무엇을 지키는가 |
|---|---|
| `test/tiers.test.js` | 티어 표·조건·반경·해금·감정의 날 마일스톤·주거 수용력 |
| `test/skills.test.js` | 스윙 쿨타임/사거리/노드 카운트/도구 해금/밭 성숙/폐지 확인 |
| `test/settlement.test.js` | 주민 유입·개별 건물 티어·효과 상한·수리·울타리 조각·연대기 |
| `test/waves.test.js` | 파워 공식·로테이션·예언·캠프·실시뮬 결정론·패배 관대·전술/성녀 배수·리플레이 정합 |
| `test/economy.test.js` | ★ 유지된 공식 — 콥더글러스 A값·O×B 클램프·태그·가격·부패 |
| `test/trade.test.js` | ★ 유지된 공식 — 실효배수 1.17/1.46/2.25·관세·운임·환스프레드 |
| `test/orders.test.js` | 국법 DSL |
| `test/artifacts.test.js` | 유물 훅 · ★ §20-R1 등급 재편/스케일링/충전제/마이그레이션/상자 풀 |
| `test/social.test.js` | 외형·채팅·멀티 역할 |
| `test/server.test.js` | 저장/복원·표현 계층·연대기·REST·**config 누출 금지** |
| `test/e2e.mjs` | 실서버 왕복: 개척→스윙→**1장→3장 사슬**→오두막→주민→티어업→울타리→업그레이드→웨이브 |
| `test/progression.test.js` | ★ **진행 감독** — 30게임일 방치 시 모달 0건 · 시작 주민 0/명부 0/배치대 0 · 장 사슬 순차 · 감정소→`appraiseLand` · 웨이브는 흔적을 살핀 뒤 · 마커 대상 |
| `test/world2.test.js` | ★ **월드 2.0** — 군락 생성 재현성 · 영토 안 무노드 · 첫 군락 거리 · 영토 밖 채집 · 그루터기 재생 타이밍 · 유적 크기·은닉 · 스폰 링·링2 경고 |
| `test/ecology.test.js` | ★ **생태계·도감** — 링 스폰 규칙 · 울타리 차단(선분 교차) · 사냥 드롭 · 반격·다운·모닥불 부활 · 도감 층·조우 집계 · 월드 난수 불가침 · 고기 식량 환산 |
| `test/playtest17e.test.js` | ★ **탐험 확대·바이옴·맵 확장(§17-17)** — 숨은 궤 배치(수·은닉·본영 거리) · 보상 결정론(같은 씨앗 같은 궤 = 같은 것) · 영구 소진 · 유적 등급 보정 전달·리셋 회귀 · 유적 카드 12장과 op 화이트리스트 · 384 지도 생성 시간·밀도 · 바이옴 위도 · **시작 반경 보호** · 지형 코드 RLE 계약 · 첫 발견 1회성 |
| `test/playtest17f.test.js` | ★ **감정의 날 확장(§17-18)** — 전 태그 flavor 존재 · 새 태그 둘의 효과 키가 엔진 소비처(output·gather) 화이트리스트 안 · 새 수치가 tagFactor 에 실림 · 컷신 프레임 = 5 + 태그 수 + 1 · 태그별 이야기 장과 tagStories · 마무리 한 줄이 늘 마지막 · emotion_day 변형 6종과 이벤트별 3개 이상 계약 |
| `test/playtest17h.test.js` | ★ **표현·타격감(§17-19)** — 건물 스프라이트 사각형의 정본(`world.structureRect`)과 클릭 판정(`input.structureAtSprite`)이 **한 자**임 · 키워도 밑변·가로 한가운데는 붙박이 · 확대 배율·타격감 수치는 `data/world.json render.*` 가 쥐고 정한 폭 안에 있음 |
| `test/playtest17i.test.js` | ★ **대화창(§17-19 D-5 · 탐험기획 §18-6)** — 판 구성(이름표·도트 초상·본문·하단 HUD fade 표) · 넘기기 3단(다 보여 줘 → 다음 줄 → 닫힘) · 선택지는 마지막 줄에서만·숫자키 1~4 짝 · **서버 무변경**(부르는 쪽이 준 화이트리스트 cmd 만 전송) · ESC·전투 경보로 접힘 · 수치는 `render.dialogue` 가 쥠 |
| `test/playtest15c.test.js` | ★ **동료 봇 = 각료(§15-C)** — 정원 5인·심리스 교대(비켜난 사람이 그대로 돌아온다) · 사람과 같은 스윙 경로 · 하루 예산의 이중 계산 금지 · 사슬 스윙 조건은 사람만 · 헐기에는 손대지 않음 · 각료 이름 일치 · 웨이브 참전 · 모닥불 부활·쉼 · 자동 플레이 토글과 30초 물러남 · 뷰 계약 |

---

## 9. 밸런스 기록 (v3 재보정)

| 항목 | 값 | 근거 |
|---|---|---|
| 1게임일 | 실시간 600초 | GDD3 §5. 개발 패널(`/api/debug/speed`)로 배속 |
| 스윙 쿨 | 1.2초, 레벨당 −3%, 하한 0.5초, 티어당 −5% | GDD3 §3 |
| 도구 배수 | 1 → 2 → 4 (Lv1/6/13, 대장간이 −2Lv) | GDD3 §3 |
| 노드 소모 | `drain × 배수^0.85` | 도구가 좋아지면 **빨리** 캐는 것이지 무한히 캐는 게 아니다. 장기 채집 상한은 노드 잔량·재생이 쥔다 |
| 주민 도착 | `1.0게임일 ÷ 매력도(최대 2.4) × (1 + 0.10×인구)`, 하한 0.5일 | ★ §12-4. 빈 개척지에는 반나절에 한 명, 그득한 도시에는 드물게 — 근거는 아래 9-3 |
| 웨이브 파워 | `520 × 1.07^n × 난이도 × 규모보정 × 초반램프` | GDD3 §6 + **규모 보정**(아래). 근거는 아래 9-2·9-3 |
| ★ 규모 보정 | `(방어지수/88)^0.85`, 0.5~8 | GDD3 §6 보강. 1.18^n 만으로는 '인구 0에서 자라는' 정착지를 못 따라간다. 방어지수 = 터렛 DPS + 민병 DPS + 울타리 내구×0.02. exponent<1 이라 **투자할수록 이득이 남는다** |
| ★ 초반 램프 | 처음 7웨이브에 0.42→1.0 배수 | 갓 울타리를 두른 촌락에게 첫 늑대는 겁을 주는 것이지 무너뜨리는 것이 아니다 |
| ★ 웨이브 일정 | 첫 위협까지 6일, 이후 5~7일 간격 | ★ §12-4 로 사슬이 12일 앞당겨졌다. 말미를 되돌려 **같은 날짜**에 떨어지게 했다(9-3) |
| 민병 | 훈련 4 DPS / 미훈련 ×0.35 | 방어가 **인구**가 아니라 **투자(병영)** 를 따라가게 하는 장치 |
| ★ 민병 사기 벌점 | 쓰러진 **사람 수** × 0.01 | 같은 사람이 여러 번 쓰러져도 마을이 받는 충격은 한 사람 몫. 옛 셈법(횟수)은 인구가 많고 오래 버틸수록 사기가 더 무너지는 뒤집힌 곡선이었다 |
| 건물 효과 상한 | 동종 합산 후 `최고 티어 값 × stackCap` | `output`·`permanentDefense`·`toolDiscount`·`tariffReduction` 은 배수 1 = **옛 상한 그대로** |
| 유지된 공식 | 콥더글러스(A값·지수)·가격(탄력성 0.6, clamp 0.30~4.00)·무역 실효배수 | **한 줄도 안 바꿨다**. 부처 산출은 티어 3부터 돈다 |

### 9-1. 시뮬 체크포인트 (`npm run simulate`, 20회 × 85게임일, seed 42)

| 항목 | 측정 | 목표 | 판정 |
|---|---|---|---|
| 티어3 도달 중앙값 | 15일 | **12~22일** (★ §12-4 재산정) | PASS |
| 웨이브5 생존율(권장 방어) | 60.0% | 60~80% | PASS |
| 식량 파산율 | 0.0% | <5% | PASS |
| 성녀 유무 웨이브8 격차 | 20.0%p | ≥20%p | PASS |

★ v3.2(월드 2.0) 기준으로 다시 잰 값이다. 군락 개편이 경제를 바꿔 곡선을 한 번 재보정했다 — 근거는 §9-5.

난이도 방향성(이야기 ≥ 왕국 ≥ 시련)은 `npm run simulate:full` 로 확인한다.

### 9-2. ★ v3.1 웨이브 곡선 재보정 근거

진행 감독 이후 **웨이브는 티어 2가 아니라 7장(낯선 발자국)에서 시작한다.** 같은 번호의 웨이브가
훨씬 자란 정착지 위에 떨어지므로 옛 곡선(`245 × 1.18^n`)으로는 웨이브5 생존율이 95~100% 로 새어 나갔다.
게다가 v3.1 은 「마지막 망치질이 건물을 세운다」로 정착지가 더 빨리 자란다.

곡선을 **눌러 폈다**: `basePower 245 → 560` (첫 무리도 진짜 싸움이 되게) · `growth 1.18 → 1.07`
(뒷 웨이브가 순식간에 넘사벽이 되지 않게) · 램프 `0.5 → 0.42`.
후보 쓸어보기는 `node harness/tune_waves.mjs --runs 8` 로 재현한다(개발 전용, npm 스크립트에는 없다).

| 후보(base/growth/램프) | w5 | w8 | 성녀 격차8 | 판정 |
|---|---|---|---|---|
| 245 / 1.18 / 5@0.50 (v3.0) | 100% | 60% | 60%p | w5 너무 쉬움 |
| 340 / 1.15 / 4@0.60 | 60% | 0% | 0%p | 뒤가 절벽 |
| 430 / 1.08 / 5@0.46 | 100% | 89% | 89%p | w5 너무 쉬움(완공 즉시화 뒤) |
| **560 / 1.07 / 5@0.42** | **70%** | **55%** | **50%p** | **채택** |

### 9-3. ★ §12-4 유입 가속 재보정 근거 (20회 × 85게임일, seed 42)

피드백은 「사람이 안 온다」였고, GDD3 §12-4 는 도착 주기를 **0.5~1게임일**로 당기라고 못 박았다.
그대로 넣자(=`baseIntervalDays 3.9 → 1.0`) 초반 체감은 살았지만 **곡선 세 개가 한꺼번에 무너졌다.**

| 무엇 | 손대기 전 | §12-4 그대로 넣은 뒤 |
|---|---|---|
| 티어3 도달 중앙값 | 27일 | **14일** |
| 85일차 인구 | 37 | **70** (압축 상한) |
| 웨이브5 생존율 | 70% | **30%** |
| 성녀 웨이브8 격차 | 50%p | **15%p** |

원인은 둘이다. ① 인구가 두 배가 되니 규모 보정이 웨이브를 밀어올린다. ② 사슬 전체가 12일쯤
앞당겨져 **같은 번호의 웨이브가 "자재를 6일치 덜 모은" 정착지 위에** 떨어진다. 방어 투자는 인구가
아니라 **날수**(자재 적립)에 매여 있으므로 ②가 더 무겁다.

세 손잡이로 되돌렸다 — 초반 체감은 그대로 두고 뒤만 붙잡는 방향이다.

1. **붐빔(`crowdingPerResident 0.10`)** — 주기 = `1.0 ÷ 매력도 × (1 + 0.10×인구)`.
   인구 0에서 0.7~0.9일(요구대로 0.5~1), 인구 12에서 1.3일, 인구 50에서 3.4일.
   *빈 개척지에는 소문이 금세 닿지만 이미 그득한 곳에는 새로 올 이유가 줄어든다* 는 이치를 수치로 옮긴 것이다.
2. **말미 되돌리기(`firstDelayDays 2→6` · `intervalDays [4,6]→[5,7]`)** — 첫 다섯 웨이브가 다시
   d16·d24·d31·d39·d45 근처(옛 d17·d22·d29·d35·d42)에 떨어진다.
3. **규모 기준 올리기(`settlementScale.reference 70→88`)** + `basePower 560→520` + `earlyRamp 5→7` —
   커진 정착지(37→52)가 제 규모 때문에 벌 받지 않게.

결과: **4/4 통과.** 티어3 밴드는 `25~40일 → 12~22일` 로 재산정했다.
밴드의 뜻은 「성장이 지루하지도 허무하지도 않다」이지 "27일"이라는 숫자가 아니다 —
15일은 실시간 약 2.5시간이고 그 사이 1~5장을 모두 지난다. 봇은 매일 최적으로 두드리므로
사람 손은 더 걸린다. 위쪽을 22일까지 넓게 잡은 까닭이다.

| 손잡이 조합 | 티어3 | 인구 | w5 | 성녀 격차8 | 판정 |
|---|---|---|---|---|---|
| base 3.9 (손대기 전) | 27일 | 37 | 70% | 50%p | 밴드 이전 기준 |
| base 1.0, 붐빔 없음 | 14일 | 70 | 30% | 15%p | 곡선 붕괴 |
| base 1.0 + 붐빔 0.055 | 14일 | 61 | 0%* | — | 부족 (*6판 표본) |
| base 1.0 + 붐빔 0.10 + 말미 | 15일 | 52 | 40% | 55%p | w5 아직 낮음 |
| **base 1.0 + 붐빔 0.10 + 말미 + 규모 88/520/램프7** | **15일** | **52** | **70%** | **25%p** | **채택** |

### 9-5. ★ v3.2 월드 2.0 재보정 근거 (20회 × 85게임일, seed 42)

군락 개편은 **경제를 통째로 바꾼다.** 자원을 영토 밖으로 내보내면서 두 가지가 동시에 일어났다.

| 무엇 | 손대기 전 | 군락 개편 뒤 |
|---|---|---|
| 45일차 목재 / 석재 / 곡물 | 1283 / 44 / 67 | **2223 / 338 / 894** |
| 45일차 터렛 화력(DPS) | 129 | **145** |
| 웨이브5 파워 | 1344 | **1415** |
| 웨이브5 생존율 | 65% | **40%** |

① **일자리가 넓어졌다.** 주민은 영토 안 노드만 잡을 수 있었는데, 군락이 밖으로 나가면서
반경이 영토 + 26 이 됐다. 닿는 노드가 몇 배로 늘어 채집이 통째로 불어났다.
② **걷는 값을 물렸다.** 봇을 노드 위로 공짜 순간이동시키면 사람이 실제로 겪는 왕복이 사라진다 —
`botWalkTilesPerSwing`(5.5칸 = 스윙 한 번 시간에 걷는 거리)만큼 하루 예산에서 깎게 고쳤다.

①이 ②보다 커서 **정착지는 더 부자가 됐다.** 그런데 규모 보정(`settlementScale`)이 그 부를
곧바로 적군 머릿수로 바꿔 놓는 바람에, 웨이브5(오우거)가 120초 제한에 걸려 무너졌다 —
전투 시간 99.5초 → 106.4초, 딱 그 문턱 근처다.

그래서 **투자가 더 남게** 지수를 눌렀다. `settlementScale.exponent 0.85 → 0.72`.
파워는 여전히 정착지 규모를 따라오지만(따라오되 앞지르지 않는다는 원칙 유지), 화력을 키운 만큼의
몫이 방어 쪽에 더 남는다. 다른 세 체크포인트는 손대지 않았다.

| 후보(exponent) | 티어3 | 웨이브5 | 성녀 격차8 | 판정 |
|---|---|---|---|---|
| 0.85 (v3.1 값) | 15일 | 40% | 30%p | w5 붕괴 |
| 0.80 | 15일 | 45% | 25%p | 아직 낮음 |
| **0.72** | **15일** | **60%** | **20%p** | **채택 — 4/4** |
| 0.70 | 15일 | 65% | 15%p | 성녀 격차 미달 |
| 0.68 | 15일 | 75% | 15%p | 성녀 격차 미달 |
| (참고) reference 88→94 | 15일 | 45% | 10%p | 파워만 낮춰서는 안 풀린다 |

**결과: 4/4 통과** — 티어3 15일 · 웨이브5 60.0% · 식량 파산 0.0% · 성녀 격차 20.0%p.

> **고기·가죽·털이 식량 곡선을 흔들지 않았다.** 봇은 사냥을 하지 않고, 사냥꾼 오두막의 하루 수확도
> **근처에 짐승이 남아 있는 만큼만** 난다(`hunting.perWorkerPerDay` 고기 0.45/사람). 실제로 위 20판에서
> 고기 재고는 0 이었고 `eatFallback` 갈래는 한 번도 타지 않았다 — 옛 곡선이 한 톨도 안 바뀐 채로 잰 값이다.
> 사람이 사냥을 하면 그만큼 식량이 늘지만, 그것은 **손을 쓴 사람이 받는 몫**이라 봇 기준선과 어긋나지 않는다
> (AP 액션·현장 가속과 같은 원칙 — 「접속한 사람만 얻는 보너스」).

### 9-4. ★ §12-12 철거·이전 다이얼

| 항목 | 값 | 뜻 |
|---|---|---|
| `demolishPointsRatio` | 0.40 | 헐어 내는 일 = 지을 때의 40% |
| `refundRatio` | 0.50 | 지금까지 들인 자재(1티어~현재 티어 합)의 절반이 돌아온다 |
| `relocateTakedownRatio` / `relocateRebuildRatio` | 0.40 / 0.60 | 해체 마디 + 재건 마디. 자재는 더 들지 않는다 |

- 철거·이전 중인 건물은 `inactive` 라 **효과 합산에서 빠진다**(잠자리·산출·터렛 전부).
- 되돌리기(`cancelStructureWork`)는 언제든 되지만, 이전이 **재건 마디**에 들어선 뒤에는 `TOO_LATE` —
  이미 헐어 버렸기 때문이다. 그 대신 재건 마디도 망치질로 밀 수 있다.
- 본부(`immovable`)는 두 명령 다 `IMMOVABLE` 로 거절한다. 화면에도 그 단추가 그려지지 않는다.
