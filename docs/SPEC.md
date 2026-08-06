# 갈래말래 (가제) — 구현 스펙 v1.0  (작성: Fable / 기획·설계 담당)

> 기준 문서: 「갈래말래(미정) 진짜 최종 기획안 v6.0」 + 「유물」 (outputs 폴더의 .txt 추출본 2개 — 반드시 함께 읽을 것).
> 수치가 충돌하면 **밸런스 설계안(기획안 후반부 §1~§14) 우선** — 검증 계산이 붙어 있기 때문.
> 모든 수치는 `data/*.json`으로 외부화한다 (다이얼 원칙).

## 0. 구현 결정 사항 (기획서와 다르거나 기획서가 모호한 부분)

| # | 결정 | 근거 |
|---|---|---|
| D1 | **1틱 = 게임 1일, 시즌 = 14게임일.** 틱당 실시간 길이는 다이얼(`tickRealSeconds`, 기본 30초 데모 / 600초 지속형) | 기획 전반부 "1틱=10분, 시즌 실시간 14일≈게임 5.5년"과 밸런스 문서의 day5/9/13 침공·누적 계산이 양립 불가. 밸런스 수치를 살리는 쪽 선택 |
| D2 | 재화 7종 + 무기(티어 자산): 곡물·목재·석재·철광석·석유·강재·연료 | MVP 6종 목록에 석재·강재가 빠져 있으나 밸런스 문서의 성벽/성지/병영 비용이 전부 석재·강재 기반 |
| D3 | 무기는 재고가 아니라 **공방 티어 자산**(골드+원유로 제작, 전투력 +20/+50/+100, 60% 환급 판매) | 밸런스 §9-2·§10-7 검증 수치 유지. 논리회로 QUEUE_SWITCH(무기)는 "무기 티어 제작 시도"로 매핑 |
| D4 | 인구는 곡물만 소비(1.0/인/일). 연료는 제련(강재 1당 0.15)에만 소비 | "연료 0.2/인" 적용 시 무유전국 밸런스(§10-6 검증) 붕괴 |
| D5 | 감정의 날 = 게임 3일차 강제, 그 전에 식량100·목재100 달성 시 조기 발동 | §19 미결정 항목. 단순한 쪽 채택 |
| D6 | 침공: 해적 day5(공격력150) · 바이킹 day9(420) · 드래곤 day13(1000). 승률 = 로지스틱 1/(1+e^(-4.62(R-1))) | 밸런스 §6-4 |
| D7 | 드래곤·유물·중간충격 포함 (MVP 절단선 확장) | 사용자 지시 "기획대로 모든 부분 구현" |
| D8 | AI 3국 = 산유국(동방풍)·임업국(엘프풍)·곡창국(유럽풍) | §2-5 국가 컨셉과 §10-5 태그 배분 병합 |
| D9 | 저장 = JSON 스냅샷 + JSONL 이벤트 로그 (SQLite 대신) | 네이티브 모듈 빌드 리스크 제거. 인터페이스는 교체 가능하게 |
| D10 | LLM 표현 계층 = 템플릿 엔진 기본 + ANTHROPIC_API_KEY 있으면 Claude API 어댑터 (비동기, 실패 시 템플릿 폴백) | §10-2 계약 그대로 |
| D11 | 멀티 = 한 국가 협동(1~5인, socket.io 룸). 국가 간 대전은 범위 외 | §19 미결정. MVP는 협동 |
| D12 | 랜덤 이벤트 풀 최소 구현: 흉작(-40% 곡물 2일)·악천후(운임 +0.1, 2일)·재해(자원 -10%) + 중간충격(6~9일차 1회, 선두국에 가중) | 유물 IV군이 요구. §13-5 |

## 1. 시간 모델
- 1틱 = 게임 1일. tick 0부터. 시즌 종료 = tick 14 처리 후 결산.
- 어전 회의: tick 7, 14 (매 7틱). 유물 상자 판정(12%)은 어전 회의 시.
- 서버 setInterval(tickRealSeconds), **일시정지/배속/수동스텝 API 필수** (개발·시연·시뮬레이션용).

## 2. 국가 상태 스키마 (요지)
```js
nation = {
  id, name, isPlayer, aiPersona,
  tags: ['비옥지','성지',...],
  tiles: [64],                    // {terrain, revealed, building, potential}
  population, populationCap,      // cap = 성지 티어 (50/90/160/260)
  morale,                         // 0.6~1.25, 기본 1.0
  gold,
  resources: { grain, wood, stone, ironOre, oil, steel, fuel },
  laborAlloc: { farm:.40, factory:.20, build:.16, defense:.20, trade:.04 },
  roles: { farm:{holder:'npc'|'player'|null, level, xp}, factory, build, defense, trade, saint },
  buildings: { granary:0..3, tools:{hoe,pickaxe,weapon:0..3}, wall:0..3, storage:0..3,
               road:0..3, consulate:0..5, barracks:0..3, shrine:0..3 },
  defense: { permanent, surge },
  invasion: { nextType, arrivalTick, isDatePrecise, hint },
  orders: [{id, priority, condition(AST), action, enabled}],
  artifacts: [{key, obtainedTick, consumed}],
  decisionQueue: [], reports: [], buffs: [],
  soilFatigue, online, lastSeenTick
}
```

## 3. 경제 공식 (밸런스 문서 그대로)
### 3-1. 산출
`Y(g) = A(g) × L^0.7 × K^0.3 × T(g) × M × O(g) × B(g) × 성역(g)`
- A: 곡물 3.078 / 강재 1.283 / 건설포인트 1.090 / 방어게이지 1.604 (역산값 — 다이얼 파일에 두되 "만지지 말 것" 주석)
- L = 인구×laborAlloc, K 기준: 농10/공8/건6/방8 (건물 티어에 비례 성장)
- T: 비옥지 곡물+40% / 대삼림 목재+50% / 철광맥+50% / 척박지 곡물-35% / 유전 없으면 석유 0 / ★§17-18 너덜겅 석재+45% · 삭은맥 철광석-30%·석재-15%
- O: 공석 0.65 / 재임 1.00+0.08×Lv (상한 1.50). **O×B ≤ 1.8 클램프**
- 목재 1.8/인/일, 석재 0.9/인/일 (전인구 기본 채집, 대삼림 보정 적용)
- 제련: 강재 1 = 철광석 2 + 연료 0.15. 정유: 석유→연료 1:1. 철광석은 공장 노동 부산출(곡괭이 티어 가중). 공장 큐 = {steel, fuel, weapon} 배분
### 3-2. 소비·인구
- 곡물 인구×1.0/일. 비축 0 → 배급(사기 -0.2) → 3일 후 인구 -1%/일 (즉사 없음)
- 인구 성장 +0.5~2%/일 (잉여·사기 기반), 성지 태그 ×1.15, 상한 = 성지 건물
### 3-3. 로컬 가격
`P_local = P_ref × clamp((S_target/S_now)^0.6, 0.30, 4.00)`
- P_ref: 곡물1.0 목재0.6 석재0.8 철광석1.2 석유2.5 강재2.0 연료2.2 (다이얼)
- S_target = 인구 × 소비계수 × 30. 창고 = 목표×(3/3.5/4/5 저장티어), 초과분 2%/일 부패
### 3-4. 무역
`P_import = P_foreign × (1+관세) × (1+운임률) × (1+정보손실)`
- 관세 15% − 영사관 티어×1%p (최저 10%). 운임 0.40/0.18/0.08 (도로 티어). 정보손실: 외교관 재임 0 / 공석 0.20
- 외교관 없으면 클라에서 타국 시세 마스킹. 최하위국 관세 면제
### 3-5. 골드
- 잉여 자동수출 정책(온오프) + 수동 거래. 수출가 = 가격×0.90 (수출마찰)
- 국고 ≤ 0 → 전 부처 산출 -20%

## 4. 역할 6종
| key | 이름 | Tier | 독점 정보 | 공석 페널티 |
|---|---|---|---|---|
| farm | 농정관 | 0 | 토양 피로도·작황 예보 | O=0.65 + 토양피로 누적(-1%/일, 최대 -15%) |
| factory | 공장장 | 0 | 공정 병목·재고 회전율 | O=0.65 + 철광석 부산출 폐기 |
| build | 건축가 | 1 | 내구도·인접 보너스 | O=0.65 + 성벽·도로 T2+ 잠김 |
| defense | 국방부 | 1 | 적 규모·취약 구간 | 서지 효율 -40% + 자동 방어 배치 불가 |
| trade | 외교관 | 2 | 타국 실시간 시세 | 시세 마스킹 + 정보손실 0.20 |
| saint | 성녀 | 2 | 침공 확정 D-day | 침공일 불확실 유지 |
- NPC XP: 담당 틱마다 +1(실적 가중), Lv5 스킬: 공장 소모 -10% / 농정 +15% / 국방 성벽 +10% / 외교 정보손실 0
- 전직: 숙련 50% 상실 + 7틱 인수인계(O=0.80)
- 싱글: 플레이어 1 + NPC 4 + 공석 1. 인접 보너스: 제분소/곡창을 밭 옆 등 +15% (건축가 재임 시만)

## 5. 건물 (data/buildings.json — 밸런스 표 그대로)
- 곡창 60/30 · 130/70 · 240/130 (목/석) → 곡물 +15/30/50%
- 공방 도구(골드): 괭이·곡괭이 50/120/250G (+10/20/35%), 무기 80G+원유5 / 180G+원유12 / 380G+원유25 (전투력 +20/+50/+100, 60% 환급 판매 가능)
- 성벽 80/40/− · 150/100/30 · 250/200/100 (목/석/강) → 영구방어 40/100/220
- 병영 목100·강20 / 목180·강50 / 목300·강100 → +30/+70/+150
- 저장 40/20 · 90/50 · 160/90, 도로 70/30 · 150/70 · 280/140, 영사관 60·80·110·150·200G
- 성지 120/80/0 · 220/150/60 · 350/280/150 → 인구상한 90/160/260
- 건설 = 건설포인트(건축 부처 산출) + 자원 차감. 건축가 재임: 비용 -25%·속도 +40%

## 6. 침공·전투
- day5 해적150 / day9 바이킹420 / day13 드래곤1000 (다이얼)
- 총전투력 = 영구(성벽+병영+무기) + 서지, 요새지 태그 ×1.15
- 서지: D-3부터 국방 노동으로 게이지 적립(방어게이지 산출식), 침공 후 소모. **성녀 없으면 유효 서지 50%**
- 승률 = clamp(1/(1+e^(-4.62(R-1))), 0.05, 0.98), R = 전투력/공격력
- 보상: 해적 수집+15% 2일 / 바이킹 +30% 3일 / 드래곤 전부처 +20% 5일 + 왕관의 조각 확정
- 실패: 해적 자원-10% 인구-3% / 바이킹 -25% -8% / 드래곤 -20% 건물 1~2티어 파괴 -12%. 인구 하한 20
- 예고: D-7 전원 간접 힌트. 성녀 재임 → 확정 날짜

## 7. 성녀
- 성역 버프: 지정 재화 ×1.25, 3틱 지속, 쿨다운 14틱. 전투력 계열 금지
- '예언의 구슬' 유물 → 성녀 없어도 예언 상시

## 8. 논리 회로 DSL
```
Order := IF Condition THEN Action
Condition := Term ((AND|OR) Term)*
Term := Metric Op Value
Metric := resource.{grain|wood|stone|ironOre|oil|steel|fuel} | gold | invasion.daysUntil | tick | population | defense.total
Op := > >= < <= ==
Action := TRANSFER(resource,amount|surplus) | CONVERT(output) | QUEUE_SWITCH(output) | TRADE(side,resource,amount) | DEFEND(allocPct)
```
- 파서 → JSON AST. 클라 편집기는 폼 기반 + 텍스트 미리보기
- 평가: priority desc, 자원 경합 시 상위 우선·잔여 재시도, 틱당 동일 자원 이동 ≤3회
- 성녀 없으면 invasion.daysUntil은 보수 추정치(isDatePrecise=false)

## 9. 유물 50종 (유물 문서 그대로 → data/artifacts.json)
> 초안의 "47종"은 오기다. 원본 표를 세면 19+17+6+7 + 왕관의 조각 = **50종**이며 data/artifacts.json·테스트가 50을 정본으로 쓴다.
- 어전 회의마다 상자 12% → 등급 55/32/8/5% → 주간 역할 활동 가중으로 개별 선택
- 효과 유형: consumable / permanent / utility / cosmetic / tradeoff(playtest 플래그)
- 행운의 부적: 발견 +3%p, 상한 25%. 왕관의 조각: 상자 풀 제외·드래곤 확정
- 구현: effect descriptor + 엔진 훅 (onProduce, onInvasionPower, onTariff, onDiscoverChance, onDefeat, onCouncil…)

## 10. AI 국가 3곳
| id | 이름 | 컨셉 | 태그 | 성향 |
|---|---|---|---|---|
| ai1 | 동방 제국 | 동양풍, 외교 어려움 | 유전·철광맥·척박지 | 산유국(가격 조작 가끔) |
| ai2 | 엘프 연맹 | 엘프, 보통 | 대삼림·성지 | 중상주의(저가 공세) |
| ai3 | 서방 왕국 | 유럽풍, 쉬움 | 비옥지·대삼림 | 균형·패권(골드 풍부) |
- 동일 엔진 + 단순 정책 봇(자급 우선·잉여 수출·부족 수입). AI끼리 교역 없음. 침공 자동 판정(리포트용)
- 매 틱 플레이어에 무역 오퍼 생성. 외교관 보유 시 시세 열람·흥정(±5%)

## 11. 섭정·보고서·어전 회의
- 오프라인: 논리회로 유지, 산출 ×0.7, 판단 사건은 decisionQueue 보류
- 재접속: lastSeenTick 이후 이벤트 요약 → 치세 보고서(손익·가격 변동·침공 캘린더·놓친 제안·타국 동향 문장)
- 어전 회의: 지표 요약 + 결정 큐 + 안건 + 유물 판정. 첫 화면은 보고서가 아니라 **결정**

## 12. 표현 계층 (AI 3계층 중 ②)
```js
async express(eventSnapshot) -> {text}   // 비동기 큐, 진행 비차단
```
- 기본: data/templates.ko.json (이벤트별 3~5 변형). ANTHROPIC_API_KEY 있으면 Claude 호출(5s 타임아웃→폴백)
- 소비처: 성녀 예언, NPC 대사, 치세 보고서, 어전 회의 서두

## 13. 틱 파이프라인 (순서 고정 §15-2)
1 입력 반영 → 2 논리회로 → 3 산출 → 4 소비·재고 → 5 로컬 가격 → 6 무역 → 7 인구·사기 → 8 침공 → 9 사건(재해·중간충격·버프 만료) → 10 트리거(감정의 날·어전·시즌 종료) → 11 스냅샷+브로드캐스트 → 12 표현(비동기)
- **순수 함수**: `step(state, inputs, rng) -> {state, events}` — 시뮬레이터가 같은 코드 재사용. RNG seed 지정 가능

## 14. 저장
- saves/{gameId}/snapshot.json (매 틱) + 7틱마다 히스토리, events.jsonl append. 재시작 시 로드

## 15. 시뮬레이터
- `npm run simulate` — 무접속 풀시즌 N회(기본 200), 체크포인트 리포트:
  자급률 100±5% / 해적 평시 60~70% / 바이킹 절반투입 55~65% / 드래곤 총동원 60~70% / 골드 충당률 50~65% / 성녀 유무 드래곤 격차 ≥30%p

## 16. 폴더 구조
```
gallaemallae/
  package.json          # "type":"module", deps: express + socket.io 만
  server/index.js       # 부트스트랩, 배속/일시정지/스텝 API
  server/engine/        # state.js tick.js economy.js combat.js orders.js
                        # artifacts.js ai_nation.js npc.js events.js report.js emotion_day.js
  server/expression/    # templates.js claude_adapter.js
  server/persistence.js
  server/sim/run.js
  data/*.json           # balance.json resources.json buildings.json roles.json tags.json
                        # invasions.json artifacts.json ai_nations.json events.json templates.ko.json
  public/               # vanilla JS 클라이언트 (빌드 스텝 없음, CDN 금지)
  test/                 # node:test — 경제·전투·DSL 파서 (밸런스 표 값 재현 필수)
  docs/
```

## 17. 코딩 규칙
- Node 22 ESM. 매직넘버 금지(전부 data/). 한국어 UI, 영어 식별자
- 테스트로 밸런스 표 재현: 인구50 곡물 산출 50/일, 드래곤 총동원 R=1.14→승률 66%, 무역 실효배수 1.17/1.46/2.25 등
