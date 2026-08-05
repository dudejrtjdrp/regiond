# 클라-서버 프로토콜 v3.3 (양측 구현 계약 — 이 파일이 최종 정본)

> 임의 변경 금지. 바꿔야 하면 **이 파일을 먼저 고치고** 서버·클라를 따라 고친다.
> 서버 판번호는 `server/index.js` 의 `PROTOCOL = '3.3'`, 클라는 `public/js/state.js` 의 `GM.PROTOCOL` 과 **반드시 같아야** 한다.
> 설계 근거는 `docs/GDD3.md`(§1~§10 엔드리스 정착지 성장 · **§11 진행 감독** · **§12 플레이테스트 1차** · **§13 플레이테스트 2차** · **§14 플레이테스트 3차** · **§15 플레이테스트 4차**), 공간 계층은 `docs/WORLD.md`.

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

### 0-Z-1. 신설

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

### 0-Z-2. 바뀐 계약

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
| **일 틱** | `config.time.dayRealSeconds` (기본 600초 = 1게임일) | 산출·소비·가격·무역·주민 유입·사기·웨이브 일정·사건·티어 판정 | `state`, `worldDiff`, `worldState`, `events` |
| **실시간** | 즉시 | 스윙(`actionSwing`)·전투 스윙(`combatSwing`)·아바타 이동(`lordMove`)·건설/울타리 명령 | 그 명령의 **ack**(+ 남의 스윙은 `swing`, 새 땅을 밟으면 `worldDiff`) |
| **서브틱** | `config.time.subtickSeconds` (기본 0.25초) | 웨이브 전투 시뮬(적 이동·터렛 사격·민병·플레이어) | `battleTick` |

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
                         "blockedTerrain": ["water"], "requiresTerritory": true } },

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
  "resources": { "grain": 12, "wood": 17.2, "stone": 5 } }   // ★ 스윙 뒤의 창고 잔고(권위값)
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

`laborAlloc` 은 여전히 **배치의 파생값**이다(슬라이더가 아니다). 티어 3 미만에서는 부처가 돌지 않으므로 배치는 '누가 어느 노드에서 캐는가'만 정한다.

### 3-5. 경제·역할 (v2.1 그대로, 해금 조건만 추가)

| 명령 | 해금 | 비고 |
|---|---|---|
| `trade {nationId, side, resource, amount}` | 티어 3(교역소) | 아니면 `TRADE_LOCKED` |
| `respondOffer {offerId, accept}` / `decide {decisionId, choice}` | — | |
| `buyTool {tool, tier}` / `sellWeapon {}` | 티어 3(대장간) | 국가 단위 도구 — 개인 스킬 도구와 별개 |
| `setQueue {factory:{steel,fuel,weapon}}` | 티어 3 | |
| `ordersSet {orders}` | 티어 4(국법) | |
| `saintBuff {resource}` | 성녀 재임 | |
| `useArtifact {key}` / `councilAck {councilId}` | 티어 4 | |
| `setAutoExport {enabled}` / `setExportFloor {floors}` | — | |
| `pickRole {role}` / `delegate {assignments, vacant}` | 티어 3(관제 선포) | 아니면 `ROLE_LOCKED` |
| `adviceAct {adviceId}` / `setAutoAssist {enabled}` | — | |
| `apAction {type:'inspire'\|'explore'\|'survey', nodeId?, dept?}` | — | ★ `'work'` 는 폐기 |
| `harvestNode {nodeId}` | — | 클릭 수확 보너스 |
| `setBattlePlan {tactic}` | 티어 2 | ★ 서지 3구간 배분은 폐기 |
| `setAppearance {appearance}` / `chat {text}` | — | |

---

## 4. 서버 → 클라

### 4-0. 이벤트 한눈에

| 이벤트 | 언제 | 클라가 할 일 |
|---|---|---|
| `joined` | join ack 직후 | 화면 전환 |
| `world` | join 1회 / `requestWorld` | 지형 RLE·노드·안개·건물·울타리 전량 그리기 |
| `worldDiff` | 매 일 틱 · **아바타가 새 땅을 밟은 즉시**(`reveal:true`) | 바뀐 청크·노드·건물·울타리·주민만 갱신 |
| `state` | 매 일 틱 · 명령 후 | HUD·패널 전량 |
| `worldState` | 매 일 틱 | 세계 지도·웨이브 화살표 |
| `events` | 매 일 틱 | 로그(표현 계층 문장 포함) |
| `tierUp` | 티어업 | **팡파레 + 영토 말뚝 연출 + 도감 카드 공개 + UI 해금** |
| `residentArrived` | 주민 도착 | 걸어오는 연출 + 이름 배너 |
| `buildingDone` | 완공/개축 | 먼지 구름 + 등장 바운스(개축이면 황금 반짝) |
| `emotionDay` / `mandate` | 티어 3 | 컷신 → 관제 선포 화면 |
| `waveIncoming` | 도착일 | 경보 |
| `battleStart` | 전투 개시 | 전투 화면 진입 |
| `battleTick` | 서브틱(0.25초) | 적·민병·플레이어 위치·체력 갱신 + `events` 로 타격 이펙트 |
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
{ "tick": 12, "sinceTick": 11,
  "fog": [[0,0,1,256]], "nodes": [],
  "towns": [], "territory": {},
  "structures": [], "sites": [],
  "fences": [], "residents": [],
  "camps": [], "avatars": [] }
```
노드 규칙: `stamp > sinceTick` **또는 `stamp === 현재 틱`** 인 것을 싣는다(같은 틱 안의 개간·수확이 누락되지 않게).

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
    "rationing": false, "autoExport": true, "online": true, "members": [], "stats": {},
    "ap": { "current": 3, "max": 3,
            "actions": { "inspire": { "cost": 1 }, "explore": { "cost": 1 }, "survey": { "cost": 0 } },
            "usedDepts": [] },
    "advices": [], "autoAssist": true,
    "battlePlan": { "tactic": null, "setTick": null, "options": [], "bonus": 0.12, "penalty": 0.08 },
    "ruinGauge": 0, "ruinThreshold": 3, "survey": null, "nodeContribution": {}
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
  "adjacency": 0.04 }
```
`adjacency` 는 건축가 재임 시에만 숫자, 아니면 `null`.

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
#### `battleStart` / `battleTick` — 같은 스냅샷 형태
```jsonc
{ "waveIndex": 0, "number": 1, "type": "wolf", "name": "늑대 떼",
  "t": 12.5, "maxSeconds": 120, "core": { "x": 68, "y": 60 }, "over": false, "won": false,
  "total": 11, "killed": 4, "escaped": 0,
  "enemies": [{ "id": "e3", "x": 72.4, "y": 54.1, "hp": 31, "maxHp": 55, "type": "wolf", "looting": false }],
  "militia": [{ "id": "r5", "x": 70, "y": 57, "hp": 40, "maxHp": 40, "alive": true }],
  "turrets": [{ "id": "s9", "x": 72, "y": 56, "range": 8, "key": "arrow_tower" }],
  "players": [{ "id": "p1", "hp": 60, "maxHp": 60, "down": false }],
  "events": [ { "t": 12.25, "kind": "kill", "targetId": "e2", "by": "turret", "byId": "s9" } ] }
```
`events[].kind`: `spawn` `kill` `fenceBreak` `structureHit` `structureRuined` `breach` `militiaDown` `playerDown` `playerHit` `hold` `withdraw`

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
| `test/artifacts.test.js` | 유물 훅 |
| `test/social.test.js` | 외형·채팅·멀티 역할 |
| `test/server.test.js` | 저장/복원·표현 계층·연대기·REST·**config 누출 금지** |
| `test/e2e.mjs` | 실서버 왕복: 개척→스윙→**1장→3장 사슬**→오두막→주민→티어업→울타리→업그레이드→웨이브 |
| `test/progression.test.js` | ★ **진행 감독** — 30게임일 방치 시 모달 0건 · 시작 주민 0/명부 0/배치대 0 · 장 사슬 순차 · 감정소→`appraiseLand` · 웨이브는 흔적을 살핀 뒤 · 마커 대상 |
| `test/world2.test.js` | ★ **월드 2.0** — 군락 생성 재현성 · 영토 안 무노드 · 첫 군락 거리 · 영토 밖 채집 · 그루터기 재생 타이밍 · 유적 크기·은닉 · 스폰 링·링2 경고 |
| `test/ecology.test.js` | ★ **생태계·도감** — 링 스폰 규칙 · 울타리 차단(선분 교차) · 사냥 드롭 · 반격·다운·모닥불 부활 · 도감 층·조우 집계 · 월드 난수 불가침 · 고기 식량 환산 |
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
