// 일 틱 파이프라인 — docs/GDD3.md §5. 순서 고정. 순수 함수: step(state, inputs, rng) -> {state, events}
//
// ★ 아키텍처(GDD3 §5): '일 틱'과 '실시간'을 분리한다.
//   · 일 틱(이 파일)   — 하루 단위 경제 정산: 산출·소비·가격·무역·인구·사기·웨이브 일정·사건·티어
//   · 실시간(소켓)     — 스윙(actions.js)·전투 스윙·아바타 이동: 틱을 기다리지 않고 즉시 처리
//   · 서브틱(battle.js) — 웨이브 전투: subtickSeconds 단위 결정론 시뮬. 실시간이든 헤드리스든 결과가 같다.
//   매크로 공식(콥더글러스·가격·무역)은 한 줄도 바뀌지 않았다 (GDD3 §9 유지 목록).
import { loadGameData } from './data.js';
import { rngFromState } from './rng.js';
import {
  cobbDouglas, departmentCapital, officerFactor, buildingFactor, clampedOfficerBuilding,
  tagFactor, producesResource, targetStock, applySpoilage, localPriceTable, round2, clamp, hasSkill,
} from './economy.js';
// ★ §20-R4 — 하루 한 번 걷은 훅을 국가에 박고(거울), 심은 것을 자라게 하고, 그 반경 몫을 부서에 얹는다.
import {
  collectHooks, artifactFoundEvent, chronicleArtifact,
  mirrorArtifactHooks, growPlanted, auraDeptBonus,
} from './artifacts.js';
import { selectActions } from './orders.js';
import { applyCommand, normalizeAlloc } from './commands.js';
import { accrueXp, rolePerk } from './npc.js';
import { rollRandomEvent, applyEventEffect, rollMidShock, expireBuffs, buffModifiers } from './events.js';
import { aiAdjustPolicy, generateOffers, aiSettle, aiProcure, nationWealth } from './ai_nation.js';
import { isCouncilTick, openCouncil, enqueueDecision } from './council.js';
import { migrateWorld } from './state.js';
import { difficultyPreset } from './difficulty.js';
import { regenActionPoints } from './king.js';
import { autoAssist } from './advisor.js';
import {
  stepVillagers, stepNodes, stepFields, reassignDepleted, deriveLabor, syncNodeWorkers,
  nodeContribution, nodeFlatYield,
} from './villagers.js';
// ★ §20-R4(§20-4 아로스의 눈) — 안개가 날마다 스스로 물러선다. 그 원을 찍는 손이 stampVisionDisc 다.
import { recomputeFog, stampVisionDisc, fogCfg, visionTierBonus } from './fog.js';
import {
  completeStructure, finishSite, syncLegacyBuildings, structureOutputBonus, storageBonus,
  flatOutputs, goldPerDay, hasBuilding, moraleBonus, prestige as prestigeOf, effectValue,
} from './structures.js';
// ★ §19-F3(F07-6·7·8) — 방한(설산 곁 털 소비) · 특산품 재고 회복 · 재감정 알림
import { restockSpecialties } from './trade.js';
import { reappraisalState, reappraisalCfg } from './emotion_day.js';
import {
  settlementTier, tierDef,
} from './tiers.js';
// ★ GDD3 §11-1 — 모든 문은 진행 감독이 쥔다. 이 파일은 '시간'을 담당하지만, 시간은 아무것도 열지 않는다.
import {
  departmentsActive, featureUnlocked, evaluateProgress, checkTrace, chapterIndex, ensureProgress,
} from './progression.js';
import {
  capacity, stepArrivals, residentSettle, loseResidents, grainDays, housewarmArrival, clearWorkLedgers,
} from './residents.js';
// ★ Sprint 2 — 노는 손 자동 배치·정찰 목적지. 새로 온 사람도 그 자리에서 일을 받는다.
import { stepAssignments, autoPlaceIdle } from './assign.js';
import {
  updateWaveSchedule, ensureCamps, updateCampIntel, campEventView, daysUntilWave, nextWaveSpec,
  dominantBiome,
} from './waves.js';
import { startBattle, runBattle } from './battle.js';
// ★ GDD3 §13-A-5 — 산출도 곳간 상한을 넘기지 못한다(서버 권위)
import { deposit, spoilFloor } from './storage.js';
// ★ GDD3 §13-D-5 — 기술 트리. 값은 착수할 때 치르고, 날은 여기서 흐른다.
import { stepResearch, productionBonus, gatherResearchBonus } from './research.js';
// ★ GDD3 §13-B·C — 은닉 유적 발견 · 상시 생태계 · 사냥꾼 오두막
import { revealConcealed, townOf } from './world.js';
import { stepEcologyDay, huntYield, cullForHunters, livestockOutputs } from './ecology.js';
// ★ GDD3 §15-C — 동료 봇. 아무도 안 보는 시간만큼을 일 틱이 몰아 돌린다(이중 계산 없음).
import { stepCompanionsDay } from './companions.js';
import { recordRuinFound, discoverBiomes } from './codex.js';
import { record as chronicle } from './chronicle.js';

/**
 * 한 틱(= 1게임일) 진행. 상태를 변형하지 않고 새 상태를 반환한다.
 * @param {object} opts {liveBattle} — true 면 웨이브를 '시작만' 하고 서브틱은 런타임이 돌린다.
 *                      false(기본) 면 이 자리에서 헤드리스로 완주시킨다(테스트·시뮬).
 */
export function step(state, inputs = [], rng = null, data = loadGameData(), opts = {}) {
  const world = migrateWorld(structuredClone(state), data);
  if (!world) throw new Error('구버전 스냅샷입니다. saves/ 를 비우고 새로 시작하세요.');
  const r = rng ?? rngFromState(world.seed, world.rngState);
  const events = [];
  world.tick += 1;
  const tick = world.tick;
  const diff = difficultyPreset(world, data);

  // ── 0. 하루 시작 — 행동력 회복(이월 없음) ─────────────────────
  for (const nation of Object.values(world.nations)) {
    if (!nation.isPlayer) continue;
    regenActionPoints(nation, data, tick);
    /* ★ §19-C — 잠은 하룻밤짜리다. 표를 남겨 두면 다음 날에도 「잠듦」이 붙어 있고,
       한 사람이 자 둔 표만으로 이튿날 아침이 곧장 넘어간다(§17-7 다같이 잠자기). */
    nation.sleepVotes = {};
  }

  // ── 1. 입력 반영 ────────────────────────────────────────────────
  for (const input of inputs) {
    const res = applyCommand(world, input.nationId ?? world.playerNationId, input.cmd ?? input, data, r);
    if (!res.ok) events.push({ tick, kind: 'error', nationId: input.nationId, data: res.error });
    else if (res.events?.length) events.push(...res.events.map((e) => ({ tick, ...e })));
  }
  for (const nation of Object.values(world.nations)) {
    if (!nation.isPlayer) aiAdjustPolicy(nation, data, r);
  }

  // ── 1-b. 각료 자동 보좌 — 섭정 방치 시에만 (역할이 열린 뒤) ────
  for (const nation of Object.values(world.nations)) {
    if (!departmentsActive(nation, data)) continue;
    const auto = autoAssist(world, nation, data);
    if (!auto) continue;
    const res = applyCommand(world, nation.id, auto.cmd, data, r);
    events.push({
      tick, kind: 'auto_advice', nationId: nation.id,
      data: { adviceId: auto.advice.id, role: auto.advice.role, roleName: auto.advice.roleName,
        label: auto.advice.label, text: auto.advice.text, executed: auto.cmd.type, ok: res.ok },
    });
  }

  // ── 1-c. 월드 유지 — 주민 이동 · 고갈 재배치 · ★ Sprint 2 노는 손 자동 배치 · 배치 파생 laborAlloc ──
  for (const nation of Object.values(world.nations)) {
    if (!(nation.villagers || []).length) continue;
    stepVillagers(world, nation, data, tick);
    const moved = reassignDepleted(world, nation, data);
    if (moved.length) {
      events.push({ tick, kind: 'villagers_moved', nationId: nation.id, data: { count: moved.length, reason: 'depleted' } });
    }
    /* ★ Sprint 2 — 유휴는 더 이상 흡수 상태가 아니다: 노는 손(수동 지시 제외)을 필요도순으로
       빈 자리에 앉히고, 정찰꾼에게는 안개 경계의 다음 목적지를 준다. */
    const auto = stepAssignments(world, nation, data);
    if (auto.moved.length) {
      events.push({ tick, kind: 'villagers_moved', nationId: nation.id, data: { count: auto.moved.length, reason: 'idle' } });
    }
    syncNodeWorkers(world, nation, data);
    const derived = deriveLabor(nation, data);
    if (derived) {
      nation.laborAlloc = normalizeAlloc(derived.alloc, data);
      nation.gatherScale = derived.gatherScale;
      nation.villagerCounts = derived.counts;
    }
  }

  // ── 2. 논리 회로(국법) — 티어 4부터 ────────────────────────────
  for (const nation of Object.values(world.nations)) {
    if (!nation.orders?.length) continue;
    if (nation.isPlayer && !featureUnlocked(nation, 'orders', data)) continue;
    const ctx = orderContext(world, nation, data);
    const fired = selectActions(nation.orders, ctx, data);
    for (const o of fired) {
      const cmd = actionToCommand(o.action, nation, data);
      if (!cmd) continue;
      const res = applyCommand(world, nation.id, cmd, data, r);
      events.push({
        tick, kind: 'order_fired', nationId: nation.id,
        data: { orderId: o.id, text: o.text, ok: res.ok, error: res.ok ? null : res.error?.message ?? null },
      });
    }
  }

  // ── 3. 산출 ────────────────────────────────────────────────────
  const production = {};
  for (const nation of Object.values(world.nations)) {
    const hooks = collectHooks(nation, data);
    /* ★ §20-R1 — 유물이 얹는 인구 상한(왕관의 조각 +30 · 깨진 왕관 파편 +15)의 **거울**.
       capacity() 는 주민 배치·도착 판정에서 수없이 불리는 자리라 그때마다 훅을 걷을 수 없다.
       nation.storageBonus 와 같은 방식으로 매 틱 여기서 채운다(레거시 거울 규칙). */
    nation.artifactCapDelta = hooks.populationCapDelta;
    /* ★ §20-R4 — 거울 두 벌을 여기서 한꺼번에 박는다. mirrorArtifactHooks 는 **실시간 경로**
       (스윙·물기·이동)가 읽는 것이고, mirrorArtifactDay 는 하루 경로 중 훅을 못 받는 자리
       (연구·기차·안개·부패·사기·감정의 날)가 읽는 것이다. 둘 다 하루 한 번만 걷는다. */
    mirrorArtifactHooks(nation, hooks);
    mirrorArtifactDay(nation, hooks);
    /* ★ §20-R4(유물기획 §20-3 이그니스의 왕관) — 「낮 동안」의 번역.
       기획서는 「낮 동안 전 자원 +35%」라 적었지만 **서버에는 낮과 밤이 없다**: 낮밤은 클라의
       벽시계 연출이고(public/js), 산출은 하루에 딱 한 번 이 자리에서 정산된다. 그래서 조건을
       「웨이브가 오지 않는 날」로 옮겼다 — 유물의 값(「해가 떠 있는 동안만 곳간이 찬다,
       대신 성문 밖은 위험하다」)을 하루 눈금 위에서 지키는 가장 가까운 번역이다.
       daysUntilWave 가 null(예정 없음)이면 웨이브 당일이 아니므로 산다. */
    hooks.dayOutputActive = daysUntilWave(world, nation) !== 0;
    /* 심은 것의 하루 — 자란 단계만 알린다(연출은 화면 몫). 심은 유물이 없으면 빈 배열이다. */
    for (const g of growPlanted(nation, tick, data)) {
      events.push({ tick, kind: 'artifact_grown', nationId: nation.id, data: g });
    }
    // 설치형 반경 보너스 — 부서 단위로 미리 걷어 둔다(departmentMultiplier 가 부서마다 읽는다)
    hooks.auraDept = auraDeptBonus(world, nation, data);
    production[nation.id] = produceNation(world, nation, data, hooks);
    const granted = applyDailyGrants(nation, hooks, data);
    if (granted) production[nation.id].granted = granted;
    for (const done of production[nation.id].completed || []) {
      events.push({ tick, kind: 'building_done', nationId: nation.id, data: done });
      // ★ §17-6 집들이 — 완공과 함께 들어온 사람은 도착 연출(이름표)도 같이 나간다
      if (done.housewarm) {
        /* ★ Sprint 2 — 집들이로 들어온 사람도 그 자리에서 일을 받는다(집결지가 없었을 때) */
        autoPlaceIdle(world, nation, data);
        nation.stats.residentsArrived = (nation.stats.residentsArrived || 0) + 1;
        events.push({
          tick, kind: 'resident_arrived', nationId: nation.id,
          data: {
            ...done.housewarm, total: nation.stats.residentsArrived,
            population: Math.floor(nation.population), capacity: nation.populationCap ?? null, housewarm: true,
          },
        });
      }
      if (nation.isPlayer) {
        chronicle(world, {
          kind: 'building', title: done.name,
          text: `${done.name}${done.tier > 1 ? ` T${done.tier}` : ''}이(가) 세워졌다.`,
          data: done,
        }, data);
      }
    }
  }
  stepNodes(world, data, tick);
  stepFields(world, data, tick);

  // ── 3-b. ★ GDD3 §13-C — 상시 생태계. 접속자가 없어도 들에는 짐승이 산다.
  //   실시간 루프(server/index.js)가 1초마다 굴리는 것과 **같은 함수**를 하루치로 몰아 돌린다.
  for (const nation of Object.values(world.nations)) {
    if (!nation.isPlayer) continue;
    for (const e of stepEcologyDay(world, nation, data)) events.push({ tick, ...e });
    /* ★ GDD3 §15-C — 동료의 하루. 지켜본 초는 이미 1초 루프가 굴렸으므로 **안 본 만큼만** 돈다.
       그래서 방치가 이득도 손해도 되지 않는다(터렛의 §15-A maxShotsPerStep 과 같은 규율). */
    stepCompanionsDay(world, nation, data);
    // 사냥꾼 오두막의 하루 수확 (§13-C-8) — 짐승이 남아 있는 만큼만 난다
    const hunt = huntYield(world, nation, data);
    for (const [res, amount] of Object.entries(hunt.resources)) {
      const got = deposit(nation, res, amount, data);
      if (got > 0) (production[nation.id] ||= {}).hunted = { ...(production[nation.id].hunted || {}), [res]: got };
    }
    if (hunt.workers > 0) cullForHunters(world, nation, data);
    // 은닉 유적 — 주민의 발길이 닿아도 드러난다
    for (const n of revealConcealed(world, nation, data, tick)) recordRuinFound(nation, n, tick);
    /* ★ §17-17 — 새 땅의 첫 발견. 걸음마다 판정하는 문(lordMove)이 정본이지만, 동료가 지시를 받아
       혼자 걸어 들어간 경우처럼 사람의 걸음이 없는 길도 있다 — 하루에 한 번 여기서도 훑는다. */
    for (const b of discoverBiomes(world, nation, data, tick)) {
      events.push({ tick, kind: 'biome_found', nationId: nation.id, data: b });
    }
    /* ★ GDD3 §13-D-5 — 붙들고 있는 연구의 하루. 다 되는 날 석탄·석유 노두가 링1~2 에 드러난다. */
    for (const e of stepResearch(world, nation, data, r)) {
      events.push({ tick, ...e });
      chronicle(world, {
        kind: 'research', title: e.data.name,
        text: e.data.line ?? `${e.data.name} 연구가 끝났다.`, data: e.data,
      }, data);
    }
    /* ★ §19-F3(F07-7·8) — 이웃 좌판의 재고가 다시 차고, 감정소에 기운이 고이면 한 번 알린다. */
    restockSpecialties(world, nation, data);
    events.push(...reappraisalNotice(world, nation, data).map((e) => ({ tick, ...e })));
  }

  // ── 4. 소비·재고 ───────────────────────────────────────────────
  for (const nation of Object.values(world.nations)) {
    const ev = consumeAndStock(world, nation, data);
    events.push(...ev.map((e) => ({ tick, nationId: nation.id, ...e })));
  }

  // ── 5. 로컬 가격 ───────────────────────────────────────────────
  for (const nation of Object.values(world.nations)) {
    nation.market = localPriceTable(nation, data);
  }

  // ── 6. 무역 — 교역소가 서야 바깥과 값을 주고받는다(티어 3) ──────
  world.offers = world.offers.filter((o) => o.expiresTick >= tick);
  for (const nation of Object.values(world.nations)) {
    const hooks = collectHooks(nation, data);
    if (nation.isPlayer) {
      if (nation.autoExport && tradeOpen(nation, data)) {
        const gold = autoExport(nation, data, hooks);
        if (gold > 0.01) events.push({ tick, kind: 'auto_export', nationId: nation.id, data: { gold: round2(gold) } });
      }
    } else {
      aiProcure(nation, data);
      aiSettle(nation, data);
    }
  }
  const player = world.nations[world.playerNationId];
  if (tradeOpen(player, data)) {
    for (const o of generateOffers(world, data, r)) {
      world.offers.push(o);
      if (player.online) {
        events.push({ tick, kind: 'offer_received', nationId: player.id, data: { ...o, nation: o.nationName } });
      } else {
        enqueueDecision(player, {
          decisionId: `d_${o.offerId}`, kind: 'trade_offer', title: '무역 제안',
          text: `${o.nationName}에서 ${data.resources.meta[o.resource].name} ${o.amount} 제안이 도착했습니다.`,
          options: ['accept', 'reject'], offer: o, createdTick: tick,
        });
      }
    }
  }

  // ── 7. 주민 유입 · 사기 ────────────────────────────────────────
  for (const nation of Object.values(world.nations)) {
    const ev = updatePopulationAndMorale(world, nation, data, r);
    events.push(...ev.map((e) => ({ tick, nationId: nation.id, ...e })));
    for (const e of ev) {
      if (e.kind === 'resident_arrived' && nation.isPlayer && nation.stats.residentsArrived === e.data.total) {
        // 첫 주민은 연대기의 큰 사건이다
        if (e.data.total === 1) {
          chronicle(world, { kind: 'first_resident', title: '첫 주민', text: `${e.data.name}이(가) 정착지에 닿았다.`, data: e.data }, data);
        }
      }
    }
  }

  // ── 8. 엔드리스 웨이브 ─────────────────────────────────────────
  for (const nation of Object.values(world.nations)) {
    if (!nation.isPlayer) continue;
    updateWaveSchedule(world, nation, data, r);
    for (const camp of ensureCamps(world, nation, data)) {
      events.push({ tick, kind: 'camp_spotted', nationId: nation.id, data: campEventView(camp, data) });
    }
    const days = daysUntilWave(world, nation);
    if (days === 0 && !nation.battle) {
      const spec = nextWaveSpec(world, nation, data);
      events.push({
        tick, kind: 'wave_incoming', nationId: nation.id,
        data: { index: spec.index, number: spec.index + 1, type: spec.type, name: spec.name, units: spec.units, power: spec.power, direction: spec.direction },
      });
      startBattle(world, nation, data, { hooks: collectHooks(nation, data), virtualPlayers: opts.virtualPlayers ?? [] });
      if (!opts.liveBattle) {
        const result = runBattle(world, nation, data);
        events.push({ tick, kind: result.won ? 'wave_held' : 'wave_breached', nationId: nation.id, data: result });
        chronicle(world, {
          kind: 'wave', title: `제${result.number}차 습격 — ${result.name}`,
          text: result.text, data: { won: result.won, killed: result.enemiesKilled, total: result.enemiesTotal },
        }, data);
      }
    }
  }

  // ── 9. 사건 (재해·중간충격·버프 만료) ─────────────────────────
  // ★ GDD3 §11-1 — 갓 도끼질을 배운 사람에게 하늘이 무너지지 않는다.
  //   재해·중간충격은 '바깥이 우리를 알아본 뒤'(7장 낯선 발자국)부터만 굴린다.
  //   판정은 **세계 단위**다 — 이웃 나라의 흉년 소식도 개척 첫 주에는 화면에 뜨지 않는다.
  const disasters = disastersOpen(world.nations[world.playerNationId], data);
  for (const nation of Object.values(world.nations)) {
    const ev = disasters ? rollRandomEvent(nation, data, r) : null;
    if (ev) {
      applyEventEffect(nation, ev, tick, data);
      events.push({ tick, kind: 'disaster', nationId: nation.id, data: { name: ev.name, text: ev.text, blocked: Boolean(ev.blocked) } });
    }
    expireBuffs(nation, tick);
    if (nation.sanctuary?.active && tick >= nation.sanctuary.expiresTick) nation.sanctuary.active = false;
  }
  const shock = (diff.midShock?.enabled && disasters) ? rollMidShock(world, data, r) : null;
  if (shock) {
    world.midShockFired = true;
    const intensity = diff.midShock.intensityMultiplier ?? 1;
    const ranked = Object.values(world.nations).sort((a, b) => nationWealth(b, data) - nationWealth(a, data));
    ranked.forEach((nation, i) => {
      const weight = (i === 0 ? shock.leaderWeight : 1) * (nation.isPlayer ? intensity : 1);
      const scaled = structuredClone(shock);
      if (scaled.effect?.delta != null) scaled.effect.delta *= weight;
      if (scaled.effect?.ratio != null) scaled.effect.ratio *= weight;
      if (scaled.effect?.multiplier != null && nation.isPlayer) scaled.effect.multiplier *= intensity;
      applyEventEffect(nation, scaled, tick, data);
    });
    events.push({ tick, kind: 'mid_shock', nationId: world.playerNationId, data: { name: shock.name, text: shock.text } });
  }

  // ── 10. 성장 아크 — ★ GDD3 §12-2: 일 틱은 더 이상 티어를 올리지 않는다.
  //   승격은 본부의 [승격] 단추(promoteSettlement)만이 발동한다. "영토가 언제 왜 넓어졌는지 모르겠다"를
  //   없애기 위해서다 — 조건표를 눈으로 읽고, 다 차면 스스로 누른다.
  //   (감정의 날도 마찬가지로 시간이 아니라 [땅을 감정한다]로만 열린다 — GDD3 §11-4.)

  // ── 10-a. ★ 진행 감독 — 장 사슬 판정. 게임의 모든 문이 여기서 열린다. ──
  for (const nation of Object.values(world.nations)) {
    if (!nation.isPlayer) continue;
    checkTrace(world, nation, data);
    for (const e of evaluateProgress(world, nation, data)) {
      events.push({ tick, ...e });
      if (e.kind === 'chapter_done') {
        chronicle(world, {
          kind: 'chapter', title: `${e.data.name}`,
          text: e.data.line ?? `${e.data.name}을(를) 지났다.`, data: { id: e.data.id },
        }, data);
        if (e.data.openCouncil) events.push(...openCouncilNow(world, nation, data, r, tick));
      }
    }
  }

  // 어전 회의 — ★ 9장(사당)을 지난 뒤에만. 그 전에는 주기가 와도 아무 일도 없다.
  //   열린 뒤에도 화면에 저절로 뜨지 않는다 — 오른쪽 알림에 쌓일 뿐이다(GDD3 §11-5).
  if (isCouncilTick(tick, data)) {
    for (const nation of Object.values(world.nations)) {
      if (!nation.isPlayer || !featureUnlocked(nation, 'council', data)) continue;
      events.push(...openCouncilNow(world, nation, data, r, tick));
    }
  }
  world.phase = 'endless';

  // ── 10-b. 안개 갱신 + 캠프 정찰 ────────────────────────────────
  for (const nation of Object.values(world.nations)) {
    if (!nation.fog) continue;
    recomputeFog(world, nation, data, tick);
    /* ★ §20-R4(§20-4 아로스의 눈) — 다시 칠한 **뒤에** 스스로 걷힌 원을 덧찍는다.
       순서가 중요하다: recomputeFog 는 시야원 밖을 「탐사됨(1)」으로 눌러 놓으므로,
       먼저 찍으면 그날의 개방이 곧바로 지워진다. 유물이 없으면 이 줄은 즉시 되돌아 나온다. */
    autoRevealFog(world, nation, data, tick);
    for (const c of updateCampIntel(world, nation, data)) {
      events.push({ tick, kind: 'camp_scouted', nationId: nation.id, data: campEventView(c, data) });
    }
  }

  // ── 11. 스냅샷 ─────────────────────────────────────────────────
  const flowWindow = data.balance.trade.tradeFlowWindowTicks ?? 2;
  world.tradeFlow = (world.tradeFlow || []).filter((f) => f.tick > tick - flowWindow);
  world.rngState = r.getState();
  world.lastProduction = production;
  world.log = [...(world.log || []), ...events].slice(-400);
  return { state: world, events };
}

/**
 * 바깥과 값을 주고받을 수 있는가.
 * ★ GDD3 §11-1 — 「무역 오퍼 자동」의 문. 교역소가 서 있는지가 아니라 **8장을 지났는지**가 정본이다
 *   (교역소는 8장의 목표이고, 8장 완료가 무역을 연다). 그 전에는 상단이 저절로 찾아오지 않는다.
 */
export const tradeOpen = (nation, data) =>
  !nation.isPlayer || featureUnlocked(nation, 'trade', data);

/** 재해·중간충격이 도는가 — 7장(낯선 발자국) 뒤부터 */
export function disastersOpen(nation, data) {
  if (!nation) return false;
  if (!nation.isPlayer) return true;
  return chapterIndex(nation) >= (data.chapters.disastersFromChapter ?? 7);
}

/** 어전 회의 한 번 열기 (주기 · 9장 완료 보상 공용) */
function openCouncilNow(world, nation, data, r, tick) {
  const out = [];
  const council = openCouncil(world, nation, data, r);
  world.councils.push(council);
  /* ★ Sprint 3 — 회의록은 지금껏 끝없이 쌓였다. 엔드리스라 끝이 없으니 이 배열도 끝이 없었고,
     그 전부가 스냅샷에 실려 매 틱 structuredClone 되고 매 저장마다 JSON 으로 굳었다.
     그런데 화면이 보는 것은 마지막 셋이고(view.js `slice(-3)`), 답을 기다리는 회의도 언제나
     맨 뒤의 몇이다. 그래서 최근 councilHistoryMax 개만 남긴다 — 그보다 오래된 회의는
     아무도 열지 않고 아무도 답하지 않는다. (다이얼: data/world.json simulation) */
  const keep = data.world.simulation?.councilHistoryMax ?? 20;
  if (keep > 0 && world.councils.length > keep) world.councils.splice(0, world.councils.length - keep);
  out.push({ tick, kind: 'council_open', nationId: nation.id, data: { councilId: council.councilId, decisions: council.decisions.length, artifactDrop: council.artifactDrop } });
  if (council.artifactDrop?.key) {
    // ★ §20-R1.5 — 세 획득 경로가 같은 모양의 발견 사실을 낸다(서사는 표현 계층이 얹는다)
    const found = artifactFoundEvent(world, nation, council.artifactDrop.key, 'chest', data);
    out.push(found);
    chronicleArtifact(world, found, council.artifactDrop, data);
  }
  return out;
}

/**
 * ★ §20-R4 거울(하루 경로) — artifacts.mirrorArtifactHooks 가 실시간 경로를 맡는 것과 짝이다.
 * 「왜」 훅을 넘기지 않고 국가에 박나 — 아래 소비처들은 하루 파이프라인 **바깥**에서도 불린다
 * (researchStep 은 조언·화면이, trainSummary 는 뷰가, visionSources 는 걸음마다 fog 가 부른다).
 * 그때마다 collectHooks 를 걷으면 유물 목록을 도는 뜨거운 길목이 새로 생긴다 —
 * 기존 nation.artifactCapDelta · nation.storageBonus 와 똑같은 규율을 넓힌 것뿐이다.
 * 유물이 없으면 전부 기본값(배수 1 · 델타 0 · false)이라 한 톨도 달라지지 않는다.
 */
function mirrorArtifactDay(nation, hooks) {
  nation.artifactResearchSpeed = hooks.researchSpeedMultiplier;   // research.researchStep
  nation.artifactTrainCargo = hooks.trainCargoMultiplier;         // train.boardTrain · trainSummary
  nation.artifactVisionDelta = hooks.visionDelta ?? 0;            // fog.visionSources
  nation.artifactMoraleDelta = hooks.moraleDelta;                 // updatePopulationAndMorale
  nation.artifactSpoilImmune = hooks.spoilImmune;                 // consumeAndStock
  nation.artifactFogAutoReveal = hooks.fogAutoReveal;             // 아래 10-b 안개 갱신
  nation.artifactEmotionDay = hooks.emotionDayMultiplier;         // emotion_day.assignTags
  nation.artifactCraftTime = hooks.craftTimeMultiplier;           // equipment.js — R4b 이월(제작이 즉시라 쓸 자리가 없다)
}

/**
 * ★ §20-R4 — 매일 들어오는 몫(dailyGrant). 지금 data/artifacts.json 에는 **한 줄도 없다**:
 * 세계수의 열매·희귀 약초는 대응하는 자원 키가 resources.json 에 없어 데이터에서 걷혔다(그 파일 _note).
 * 그래서 이 고리는 지금 한 번도 돌지 않는다 — 자원 키가 서는 날 데이터 한 줄로 살아난다.
 * requireStage 는 「다 자란 뒤에만」을 위한 문이다(심은 것의 단계로 판정한다).
 * @returns {object|null} {자원: 실제로 들어간 양} — 곳간이 안 받으면 아무것도 남기지 않는다
 */
function applyDailyGrants(nation, hooks, data) {
  if (!hooks.dailyGrants?.length) return null;
  const out = {};
  for (const g of hooks.dailyGrants) {
    if (g.requireStage > 0 && !plantedAtStage(nation, g.requireStage)) continue;
    const got = deposit(nation, g.resource, g.amount, data);
    if (got > 0) out[g.resource] = round2((out[g.resource] || 0) + got);
  }
  return Object.keys(out).length ? out : null;
}

/** 심은 것 가운데 그만큼 자란 것이 하나라도 있는가 */
const plantedAtStage = (nation, stage) =>
  (nation.artifacts || []).some((a) => (a.planted?.stage ?? -1) >= stage);

/**
 * ★ §20-R4(유물기획 §20-4 아로스의 눈) — 안개가 날마다 스스로 한 겹씩 물러선다.
 * 본영을 중심으로 원이 **날마다 조금씩 넓어진다**: 어제 열린 만큼에 오늘치(radiusPerDay)를 더한다.
 * 「왜」 상한을 두나 — 누적이라 며칠만 지나도 지도 전체를 덮어 버린다. 그러면 이 유물이
 * 「안개를 걷는 재미」를 없애 버린다(§18-3 마커 금지와 같은 결). 지도 절반에서 멈춘다.
 * 누적 상태는 nation.fogAutoRadius 한 칸이다 — 옛 세이브에는 없어 첫날은 본영 시야에서 시작한다.
 */
function autoRevealFog(world, nation, data, tick) {
  const per = nation.artifactFogAutoReveal || 0;
  if (!(per > 0)) return;
  const town = townOf(world, nation.id);
  if (!town) return;
  const base = (fogCfg(data).vision?.town ?? 0) + visionTierBonus(nation, data);
  const cap = data.world.size / 2;
  const r = Math.min(cap, Math.max(nation.fogAutoRadius ?? base, base) + per);
  nation.fogAutoRadius = r;
  stampVisionDisc(nation, data, tick, town.x, town.y, r);
}

// ────────────────────────────────────────────────────────────────
// 산출
// ────────────────────────────────────────────────────────────────
export function sanctuaryFactor(nation, resource, data, tick) {
  const s = nation.sanctuary;
  if (!s?.active || s.resource !== resource) return 1;
  if (s.expiresTick != null && tick >= s.expiresTick) return 1;
  return data.balance.saint.sanctuaryMultiplier;
}

function departmentMultiplier(world, nation, dept, resource, data, hooks, buffs) {
  const p = data.balance.production;
  const O = officerFactor(nation, dept, data, world.tick);
  const B = buildingFactor(nation, resource, data, structureOutputBonus(nation, resource, data));
  const OB = clampedOfficerBuilding(O, B, p.officerBuildingClamp);
  const T = tagFactor(nation, resource, data);
  const M = clamp(nation.morale, data.balance.morale.min, data.balance.morale.max);
  const sanct = sanctuaryFactor(nation, resource, data, world.tick);
  /* ★ §20-R4 — 자원 보정에 항 셋을 **덧붙인다**(기존 순서·기존 항은 한 줄도 안 바뀐다).
     ① 와일드카드 '*' — R1 부터 outputBonus 를 자원 키로만 조회해서, 「전 자원」으로 적힌
        세트 2개 보너스(수에르의 균형)와 굶주린 왕관이 조용히 죽어 있었다. 같은 표의 같은 축이므로
        자원별 값과 **더한다**(§20-10-5 「평탄값은 더한다」).
     ② 낮 보너스 — 웨이브 당일에는 0 (위 dayOutputActive 의 번역 근거 참고).
     ③ 건물별 보너스 — 아래 buildingOutputBonusFor 의 근사 설명 참고. */
  const wild = hooks.outputBonus['*'] || 0;
  const day = hooks.dayOutputActive
    ? (hooks.dayOutputBonus?.[resource] || 0) + (hooks.dayOutputBonus?.['*'] || 0) : 0;
  const byBuilding = buildingOutputBonusFor(nation, dept, resource, data, hooks);
  const resBuff = 1 + (buffs.outputByResource[resource] || 0) + (hooks.outputBonus[resource] || 0)
    + wild + day + byBuilding;
  /* ★ §20-R4(§20-3 세계수의 씨앗) — 심은 것의 반경 몫. 부서 단위로 이미 걷어 둔 표를 읽기만 한다
     (하루 한 번 tick 이 hooks.auraDept 에 채운다 — 여기서 매번 유물을 훑지 않는다). */
  const deptBuff = 1 + (buffs.outputByDept[dept] || 0) + (hooks.auraDept?.[dept] || 0);
  const globalBuff = 1 + buffs.output;
  const treasury = nation.gold <= 0 ? 1 - p.treasuryDeficitOutputPenalty : 1;
  const offline = nation.isPlayer && !nation.online ? p.offlineRegencyMultiplier : 1;
  return Math.max(0, OB * T * M * sanct * resBuff * deptBuff * globalBuff * treasury * offline);
}

/**
 * ★ §20-R4 — 건물별 산출 보너스(아쿠아의 물방울 우물·분수 +25% · 이그니스의 불씨 제련 계열 +25%).
 *
 * 「왜 근사인가」 — 산출은 **건물 하나하나가 아니라 부서로 뭉쳐** 계산된다(콥더글러스 L·K).
 * buildingFactor·structureOutputBonus 는 건물의 몫을 이미 자원별 한 숫자로 눌러 놓아서,
 * 「이 우물이 낸 몫에만 25%」를 얹을 자리가 남아 있지 않다. 그래서 가장 단순한 꼴로 물러섰다:
 * **그 건물을 실제로 가진 나라에서, 그 건물이 속한 부서(또는 그 건물이 내는 자원)의 산출에만** 얹는다.
 *   · 건물 정의에 role(=부서)이 적혀 있으면 그 부서에만 — 제련소·대장간은 factory 다.
 *   · role 이 없으면 그 건물이 내는 자원에만 — 우물은 곡물을 내므로 농정의 곡물에 붙는다.
 *   · 둘 다 없으면(분수 같은 장식) 아무 데도 안 붙는다.
 * 건물별 산출이 제 칸으로 쪼개지면(R4b) 이 근사를 걷고 그 자리에 바로 얹으면 된다.
 */
function buildingOutputBonusFor(nation, dept, resource, data, hooks) {
  const table = hooks.buildingOutputBonus;
  if (!table) return 0;
  let sum = 0;
  for (const [key, delta] of Object.entries(table)) {
    if (!delta) continue;
    if (!(nation.structures || []).some((s) => s.key === key && !s.inactive)) continue;
    const def = data.buildings?.[key];
    const owner = def?.role ?? null;
    if (owner ? owner !== dept : !(def?.tiers || []).some((t) => t?.output?.[resource])) continue;
    sum += delta;
  }
  return sum;
}

/**
 * 하루 산출.
 * ★ GDD3 §8 — 두 체제가 티어로 갈린다:
 *   · 티어 0~2: 주민 개별 채집(residents.residentGather) + 건물 정액 산출. 부처는 아직 없다.
 *   · 티어 3+ : 기존 콥더글러스 부처 산출(무수정) + 건물 정액 산출.
 *   어느 쪽이든 플레이어 스윙(actions.actionSwing)은 실시간으로 따로 들어온다.
 */
export function produceNation(world, nation, data, hooks) {
  const p = data.balance.production;
  const A = p.technologyCoefficients;
  const a = p.laborExponent;
  const b = p.capitalExponent;
  const buffs = buffModifiers(nation);
  const out = {};

  syncLegacyBuildings(nation, data);
  nation.storageBonus = storageBonus(nation, data);

  const active = departmentsActive(nation, data);
  out.departments = active;

  if (active) {
    const pop = nation.population;
    const alloc = nation.laborAlloc;
    const L = (d) => pop * (alloc[d] || 0);
    const K = (d) => departmentCapital(nation, d, data);
    const contrib = nodeContribution(world, nation, data);
    const flat = nodeFlatYield(world, nation, data);
    out.nodeContribution = contrib;

    const soil = 1 - (nation.soilFatigue || 0);
    /* ★ Sprint 4 — 연구 채집 보정(농정술·석공술). 티어 0~2 의 residentYield(형편 배수)와
       **같은 함수**(gatherResearchBonus)를 곱한다 — 두 층이 다른 답을 내면 3티어 진입 순간 튄다. */
    out.grain = cobbDouglas(A.grain, L('farm'), K('farm'), a, b)
      * departmentMultiplier(world, nation, 'farm', 'grain', data, hooks, buffs) * soil
      * (1 + (contrib.grain || 0)) * (1 + gatherResearchBonus(nation, data, 'grain'));

    const gatherBuff = 1 + buffs.gather;
    const gs = nation.gatherScale || { wood: 1, stone: 1 };
    out.wood = pop * p.gatherPerCapita.wood * tagFactor(nation, 'wood', data, 'gather') * gatherBuff
      * (gs.wood ?? 1) * (1 + (contrib.wood || 0)) * (1 + gatherResearchBonus(nation, data, 'wood'));
    out.stone = pop * p.gatherPerCapita.stone * tagFactor(nation, 'stone', data, 'gather') * gatherBuff
      * (gs.stone ?? 1) * (1 + (contrib.stone || 0)) * (1 + gatherResearchBonus(nation, data, 'stone'));

    const factoryStaffed = Boolean(nation.roles?.factory?.holder);
    out.ironOre = (factoryStaffed
      ? cobbDouglas(A.ironOre, L('factory'), K('factory'), a, b)
        * departmentMultiplier(world, nation, 'factory', 'ironOre', data, hooks, buffs)
      : 0) + (flat.ironOre || 0);

    out.oil = producesResource(nation, 'oil', data)
      ? cobbDouglas(A.oil, L('factory'), K('factory'), a, b)
        * departmentMultiplier(world, nation, 'factory', 'oil', data, hooks, buffs) + (flat.oil || 0)
      : 0;

    /* ★ GDD3 §13-A-5 — 부처 산출도 곳간을 넘길 수 없다. 들어간 만큼만 out 에 남긴다. */
    for (const key of ['grain', 'wood', 'stone', 'ironOre', 'oil']) {
      out[key] = deposit(nation, key, out[key], data);
    }
    applyFactoryQueue(world, nation, data, hooks, buffs, out);

    const speed = nation.roles?.build?.holder ? data.roles.defs.build.tenureBonus.buildSpeedMultiplier : 1;
    out.buildPoints = cobbDouglas(A.build, L('build'), K('build'), a, b)
      * departmentMultiplier(world, nation, 'build', 'build', data, hooks, buffs) * speed;

    /* ★ 실시간 채집 정지 버그 수정 — 부처가 도는 티어에서도 노동 장부는 매일 비운다.
       옛 코드는 장부를 residentSettle(아래 else 가지) 안에서만 비웠다. 그래서 3티어에 오르는
       순간 장부가 영영 안 비워졌고, 사람마다 하루치를 한 번 채운 뒤로는 stepResidentWork 의
       want 가 0 이 되어 실시간 채집이 통째로 멎었다 — 걷는 연출만 남고 곳간은 안 올랐다.
       ★ 이 가지에서 주민 몫은 부처 산출에서 **빼지 않는다**(위 out.* 은 그대로다):
       부처 공식이 이미 인구를 노동으로 세고 있으니 엄밀히는 겹치는 몫이지만, 「사람이 캐면
       곳간이 오른다」는 손맛을 3티어 위에서도 그대로 두기로 한 선택이다. 겹침이 부담되면
       residentSettle 처럼 prepaid 를 빼는 쪽으로 좁히면 된다. */
    nation.gatherMorale = nation.morale ?? data.balance.morale.default ?? 1;
    clearWorkLedgers(nation);
  } else {
    /* ── 티어 0~2 — 주민 개별 채집 적립 ──
       ★ GDD3 §14-1 — 이제 하루 몫의 대부분은 실시간 루프가 사이클마다 이미 건네주었다.
       여기서는 **아직 안 준 나머지**만 채운다(residentSettle). 아무도 접속하지 않아 실시간 루프가
       멎어 있었다면 나머지가 곧 하루 전부이므로, 어느 쪽이든 하루 합계는 옛 값과 정확히 같다. */
    /* ★ §16-8 — 사기 스냅샷. 정산과 다음 하루의 실시간 크레딧이 **같은 사기 값**을 쓴다 —
       실시간 값이 틱 도중 흔들리면 「뜬 숫자의 합 = 국고 증가분」(§13-A-3)이 깨진다. */
    nation.gatherMorale = nation.morale ?? data.balance.morale.default ?? 1;
    const gathered = residentSettle(world, nation, data);
    out.residentGather = { resources: gathered.gross, buildPoints: gathered.buildPoints, workers: gathered.workers };
    out.residentPrepaid = gathered.prepaid;
    /* ★ §13-A-5 — 주민이 지고 온 것도 곳간이 받아 주는 만큼만 들어간다 */
    for (const [res, amount] of Object.entries(gathered.resources)) {
      out[res] = round2((out[res] || 0) + deposit(nation, res, amount, data));
    }
    out.buildPoints = gathered.buildPoints;
    for (const key of ['grain', 'wood', 'stone', 'ironOre', 'oil', 'steel', 'fuel']) out[key] ??= 0;
  }

  /* ── 건물 정액 산출 (두 체제 공통, 레이트 기준) ──
     ★ GDD3 §13-D-5 — 증기기관이 여기에 얹힌다. 「생산 건물 효율 +15%」의 자리는 바로 이곳이다:
     사람이 캐는 몫(residentGather)이나 부처 공식이 아니라, **건물이 저 혼자 내는 몫**이 는다.
     시뮬 봇은 연구를 하지 않으므로 체크포인트에는 닿지 않는다. */
  const techBonus = 1 + productionBonus(nation, data);
  const flatBuild = flatOutputs(nation, data);
  /* ★ §19-F1(F08-4) — 우리에 든 짐승의 몫. 건물이 저 혼자 내는 몫과 같은 자리에 얹는다
     (곳간 상한·연구 배수를 똑같이 지나야 한다 — 목장만 다른 문으로 들어오면 새는 자리가 생긴다). */
  for (const [res, v] of Object.entries(livestockOutputs(nation, data))) {
    flatBuild[res] = round2((flatBuild[res] || 0) + v);
  }
  out.flatOutput = flatBuild;
  out.techBonus = round2(techBonus);
  for (const [res, amount] of Object.entries(flatBuild)) {
    out[res] = round2((out[res] || 0) + deposit(nation, res, amount * techBonus, data));
  }
  const tax = goldPerDay(nation, data);
  if (tax > 0) {
    nation.gold = round2(nation.gold + tax);
    nation.stats.goldEarned = round2((nation.stats.goldEarned || 0) + tax);
    out.goldPerDay = tax;
  }

  nation.buildPoints = round2((nation.buildPoints || 0) + out.buildPoints);
  out.completed = advanceConstruction(world, nation, data);
  nation.defense.permanent = 0;
  nation.prestige = prestigeOf(nation, data);

  // 토양 피로 — 농정관 공석 시 누적 (부처가 도는 티어에서만)
  if (active) {
    const farmCfg = data.roles.defs.farm.vacancy;
    if (!nation.roles?.farm?.holder) {
      nation.soilFatigue = Math.min(farmCfg.soilFatigueMax, (nation.soilFatigue || 0) + farmCfg.soilFatiguePerDay);
    } else {
      nation.soilFatigue = Math.max(0, (nation.soilFatigue || 0) - farmCfg.soilFatiguePerDay / 2);
    }
    for (const [dept, share] of Object.entries(nation.laborAlloc)) {
      if (nation.roles?.[dept]) nation.roles[dept].activity = (nation.roles[dept].activity || 0) + share;
    }
    const pop = Math.max(1, nation.population);
    const perf = {
      farm: clamp(out.grain / pop, 0, 1), factory: clamp((out.steel || 0) / 12, 0, 1),
      build: clamp(out.buildPoints / 8, 0, 1), defense: 0,
      trade: clamp((nation.stats?.tradeVolume || 0) / 100, 0, 1), saint: nation.sanctuary?.active ? 1 : 0,
    };
    out.xpEvents = accrueXp(nation, data, perf, hooks);
  }
  return out;
}

function applyFactoryQueue(world, nation, data, hooks, buffs, out) {
  const p = data.balance.production;
  const A = p.technologyCoefficients;
  const a = p.laborExponent;
  const b = p.capitalExponent;
  const L = (d) => nation.population * (nation.laborAlloc[d] || 0);
  const K = (d) => departmentCapital(nation, d, data);
  /* ★ §17-15 — 공장장 개성. 자리가 채워져 있으면 가동량이 15% 는다(공석이면 1 — 무보정). */
  const factoryCapacity = (L('factory') > 0 && K('factory') > 0)
    ? Math.pow(L('factory'), a) * Math.pow(K('factory'), b)
      * departmentMultiplier(world, nation, 'factory', 'steel', data, hooks, buffs)
      * rolePerk(nation, 'factory', 'factoryCapacityMultiplier', data)
    : 0;
  const q = nation.factoryQueue;
  const thrift = hasSkill(nation, 'factory', data) ? data.roles.defs.factory.skill.inputCostMultiplier : 1;

  const fuelWant = A.fuel * factoryCapacity * (q.fuel || 0);
  const fuelMade = Math.min(fuelWant, nation.resources.oil / data.balance.recipes.fuel.oil);
  nation.resources.oil -= fuelMade * data.balance.recipes.fuel.oil;
  nation.resources.fuel += fuelMade;
  out.fuel = fuelMade;

  const rec = data.balance.recipes.steel;
  const oreNeed = rec.ironOre * thrift;
  const fuelNeed = rec.fuel * thrift;
  const woodPerFuel = rec.woodPerFuel ?? 0;
  const steelWant = A.steel * factoryCapacity * (q.steel || 0);
  const fuelBudget = nation.resources.fuel + (woodPerFuel > 0 ? nation.resources.wood / woodPerFuel : 0);
  const steelMade = Math.max(0, Math.min(
    steelWant,
    nation.resources.ironOre / oreNeed,
    fuelNeed > 0 ? fuelBudget / fuelNeed : Infinity,
  ));
  const fuelUsed = steelMade * fuelNeed;
  const fuelFromStock = Math.min(nation.resources.fuel, fuelUsed);
  nation.resources.fuel -= fuelFromStock;
  if (fuelUsed - fuelFromStock > 0 && woodPerFuel > 0) {
    nation.resources.wood = Math.max(0, nation.resources.wood - (fuelUsed - fuelFromStock) * woodPerFuel);
    out.charcoalWood = (fuelUsed - fuelFromStock) * woodPerFuel;
  }
  nation.resources.ironOre -= steelMade * oreNeed;
  nation.resources.steel += steelMade;
  out.steel = steelMade;
}

/**
 * 현장 하나가 다 됐다 — 신축·개축이면 건물이 서고, 철거·이전이면 그 결과를 낸다 (GDD3 §12-12).
 * @returns {{report, keep:boolean}} keep 이 true 면 현장이 남는다(이전의 해체→재건 사이)
 */
function settleSite(world, nation, proj, data) {
  const mode = proj.mode ?? (proj.structureId ? 'upgrade' : 'build');
  if (mode === 'demolish' || mode === 'relocate') {
    const r = finishSite(world, nation, proj, data);
    if (!r) return { report: null, keep: false };
    // 이전의 해체 마디가 끝났을 뿐이면 현장은 재건 마디로 이어 산다
    if (r.kind === 'takedown') return { report: null, keep: true };
    return {
      report: {
        structureId: r.structureId ?? null, building: proj.building, key: proj.building,
        name: r.name ?? proj.building, tier: proj.tier,
        x: r.x ?? proj.x ?? null, y: r.y ?? proj.y ?? null,
        mode, upgrade: false, refund: r.refund ?? null,
      },
      keep: false,
    };
  }
  const s = completeStructure(world, nation, proj, data);
  // ★ §17-6 집들이 — 잠자리 완공이면 한 사람이 곧장 들어온다
  const guest = s && nation.isPlayer ? housewarmArrival(world, nation, s, data) : null;
  return {
    report: {
      structureId: s?.id ?? null, building: proj.building, key: proj.building,
      name: s ? (data.buildings[proj.building]?.tiers?.[proj.tier - 1]?.name ?? data.buildings[proj.building].name) : proj.building,
      tier: proj.tier, x: proj.x ?? null, y: proj.y ?? null,
      mode, upgrade: Boolean(proj.structureId),
      housewarm: guest ? { id: guest.id, name: guest.name, appearance: guest.appearance, x: guest.x, y: guest.y } : null,
    },
    keep: false,
  };
}

function advanceConstruction(world, nation, data) {
  const done = [];
  let guard = 0;
  while ((nation.construction || []).length > 0 && nation.buildPoints > 0 && guard++ < 64) {
    const proj = nation.construction[0];
    const use = Math.min(proj.remaining, nation.buildPoints);
    proj.remaining = round2(proj.remaining - use);
    nation.buildPoints = round2(nation.buildPoints - use);
    if (proj.remaining > 0.0001) break;
    const { report, keep } = settleSite(world, nation, proj, data);
    if (!keep) nation.construction.shift();
    if (report) done.push(report);
    if (keep) break;                       // 재건 마디는 다음 바퀴에서 민다(무한 루프 방지)
  }
  // 완성되지 않은 공사도 스윙으로 밀어 놨을 수 있다 — 남은 것 중 다 된 것을 걷어 준다
  for (let i = 0; i < (nation.construction || []).length; i += 1) {
    const proj = nation.construction[i];
    if (proj.remaining > 0.0001) continue;
    const { report, keep } = settleSite(world, nation, proj, data);
    if (!keep) { nation.construction.splice(i, 1); i -= 1; }
    if (report) done.push(report);
  }
  return done;
}

// ────────────────────────────────────────────────────────────────
function consumeAndStock(world, nation, data) {
  const events = [];
  const pcfg = data.balance.population;
  const need = nation.population * pcfg.grainPerCapita;
  const have = nation.resources.grain || 0;
  if (need <= 0) {
    nation.rationing = false;
    nation.starvationDays = 0;
  } else if (have >= need) {
    nation.resources.grain = round2(have - need);
    nation.rationing = false;
    nation.starvationDays = 0;
  } else if (eatFallback(nation, round2(need - have), data)) {
    /* ★ GDD3 §13-C-1 — 곡물이 떨어지면 **곳간의 고기가 사람을 먹인다**(고기 1 = 곡물 3).
       사냥이 식량 경제의 두 번째 다리라는 뜻이고, 굶주림 판정은 그 다리까지 무너진 뒤에야 선다.
       고기가 없으면(=지금까지의 모든 판) 이 갈래는 통째로 건너뛰므로 옛 곡선이 한 톨도 안 바뀐다. */
    nation.resources.grain = 0;
    nation.rationing = false;
    nation.starvationDays = 0;
    events.push({ kind: 'ate_meat', data: { short: round2(need - have) } });
  } else {
    nation.resources.grain = 0;
    nation.rationing = true;
    nation.morale = Math.max(data.balance.morale.min, nation.morale - data.balance.morale.rationPenalty);
    nation.starvationDays = (nation.starvationDays || 0) + 1;
    events.push({ kind: 'famine_warning', data: { need: round2(need), have: round2(have) } });
    if (nation.starvationDays > pcfg.starvationGraceDays) {
      const lost = Math.max(pcfg.starvationMinLoss, Math.floor(nation.population * pcfg.starvationLossPerDay));
      if (nation.villagers?.length) loseResidents(nation, lost);
      else nation.population = Math.max(pcfg.floor, nation.population - lost);
      events.push({ kind: 'starvation', data: { lost } });
    }
  }
  nation.stats.consumption += need;
  const warm = burnWarmth(world, nation, data);
  if (warm) events.push({ kind: 'warmth', data: warm });
  /* ★ §20-R4(§20-5 아쿠아의 물방울) — 부패 면역. 「왜」 곳간 전체인가 — 유물 설명은 「식량 부패
     없음」이지만 훅(spoilImmune)에는 자원 칸이 없고, 부패 규칙 자체도 자원을 가리지 않는다
     (곳간을 넘긴 것은 무엇이든 썩는다). 갈래를 하나만 두어 「어떤 것은 썩고 어떤 것은 안 썩는」
     설명 불가능한 중간 상태를 만들지 않았다. 유물이 없으면 아래는 예전 그대로 돈다. */
  // ★ §19-E(QA-A) — 곳간 상한 안의 재고는 썩지 않는다(496↔499 되튐 제거)
  const spoiled = nation.artifactSpoilImmune ? {} : applySpoilage(nation, data, spoilFloor(nation, data));
  if (Object.keys(spoiled).length) events.push({ kind: 'spoilage', data: spoiled });
  return events;
}

/**
 * ★ §19-F3(F07-8) — 「기운이 다시 고인다」는 **한 주기에 한 번만** 알린다.
 *   알린 뒤 다시 감정하지 않고 버티면 잔소리가 되므로, 고인 시점의 날을 적어 두고 그 뒤로는 잠잠하다.
 */
function reappraisalNotice(world, nation, data) {
  const cfg = reappraisalCfg(data);
  if (!cfg || !nation.isPlayer) return [];
  const st = reappraisalState(world, nation, data);
  const since = world.lastAppraisalTick ?? world.emotionDayTick ?? 0;
  if (!st.open || st.daysLeft > 0 || nation.reappraisalNotifiedFor === since) return [];
  nation.reappraisalNotifiedFor = since;
  return [{ kind: cfg.readyEventKind, nationId: nation.id, data: { line: cfg.line, gold: cfg.gold } }];
}

/**
 * ★ §19-F3(F07-6) 방한 — 설산 곁에 자리 잡으면 사람들이 털을 껴입는다.
 * 「왜」 벌하지 않는가 — 털이 없다고 얼려 죽이면 옛 세이브가 하루아침에 손해를 본다.
 *   있으면 하루치를 태워 사기가 오르고, 없으면 아무 일도 없다. **쓸 곳**이지 **족쇄**가 아니다.
 * @returns {{wool:number, morale:number}|null}
 */
function burnWarmth(world, nation, data) {
  const cfg = data.balance.warmth;
  if (!cfg || !nation.isPlayer || !world.map) return null;
  if (dominantBiome(world, nation, data) !== cfg.biome) return null;
  const need = round2(nation.population * (cfg.woolPerPerson ?? 0));
  if (!(need > 0) || (nation.resources.wool || 0) < need) return null;
  nation.resources.wool = round2(nation.resources.wool - need);
  nation.morale = Math.min(data.balance.morale.max, nation.morale + (cfg.moraleBonus ?? 0));
  return { wool: need, morale: cfg.moraleBonus ?? 0 };
}

/**
 * 곡물이 모자란 만큼을 다른 먹을 것으로 메운다 (§13-C-1).
 * foodValue 가 붙은 자원(지금은 고기 하나)이 그 대상이고, **전부 메웠을 때만** true 다 —
 * 반쯤 메우고 굶주림을 면하게 하면 「고기 1점으로 흉년을 넘긴다」가 되어 버린다.
 * @returns {boolean} 굶주림을 면했는가
 */
function eatFallback(nation, shortfall, data) {
  if (!(shortfall > 0)) return true;
  const foods = Object.entries(data.resources.meta)
    .filter(([, m]) => (m.foodValue ?? 0) > 0)
    .sort((a, b) => (a[1].foodValue ?? 0) - (b[1].foodValue ?? 0));
  if (!foods.length) return false;
  /* ★ §19-F3(F07-6) 요리 — 사냥꾼 오두막에서 손질하고 말리면 같은 고기 한 점이 더 멀리 간다.
     곳간이 빌 때만 도는 길이라 곡물 살림에는 한 눈금도 영향이 없다(옛 세이브 그대로). */
  const cook = 1 + effectValue(nation, 'foodValueBonus', data);
  let left = shortfall;
  const plan = [];
  for (const [res, meta] of foods) {
    if (left <= 0.0001) break;
    const stock = nation.resources[res] || 0;
    if (stock <= 0) continue;
    const value = meta.foodValue * cook;
    const units = Math.min(stock, left / value);
    plan.push([res, units]);
    left = round2(left - units * value);
  }
  if (left > 0.0001) return false;                     // 다 못 메웠다 — 굶주림 판정으로 넘긴다
  for (const [res, units] of plan) nation.resources[res] = round2((nation.resources[res] || 0) - units);
  return true;
}

function updatePopulationAndMorale(world, nation, data, rng) {
  const events = [];
  const mcfg = data.balance.morale;

  if (nation.isPlayer) {
    nation.populationCap = capacity(nation, data);
    let arrivedNow = 0;
    for (const person of stepArrivals(world, nation, data, rng)) {
      arrivedNow += 1;
      nation.stats.residentsArrived = (nation.stats.residentsArrived || 0) + 1;
      events.push({
        kind: 'resident_arrived',
        data: {
          id: person.id, name: person.name, appearance: person.appearance,
          x: person.x, y: person.y, total: nation.stats.residentsArrived,
          population: Math.floor(nation.population), capacity: nation.populationCap,
        },
      });
    }
    nation.stats.peakPopulation = Math.max(nation.stats.peakPopulation || 0, Math.floor(nation.population));
    /* ★ Sprint 2 — 갓 도착한 사람이 다음 틱(10분)까지 놀지 않게, 도착 처리 직후 한 번 더 앉힌다.
       (집결지가 이미 앉힌 사람은 유휴가 아니라 여기 걸리지 않는다) */
    if (arrivedNow > 0) autoPlaceIdle(world, nation, data);
  }

  /* ★ §20-R4(§20-3 죽음의 낫) — 상시 사기(−10%p). 「왜」 하루치로 더하지 않고 **띠의 천장을 내리나** —
     회복은 하루 +0.03 인데 낫은 −0.10 이다. 결과에 매일 더하면 사흘 만에 바닥(min)에 눌어붙어
     「상시 −10%p」가 아니라 「사기 파괴」가 된다. 천장을 그만큼 내리면 여유 있는 나라의 평형이
     정확히 10%p 낮은 자리에 서고, 바닥은 기존 clamp 가 그대로 지킨다.
     델타가 0 이면 cap 은 mcfg.max 와 한 톨도 다르지 않다(옛 판 불변). */
  const cap = Math.max(mcfg.min, mcfg.max + (nation.artifactMoraleDelta || 0));
  if (!nation.rationing) {
    nation.morale = Math.min(cap, nation.morale + mcfg.recoveryPerTick + moraleBonus(nation, data) * 0.5);
    if (grainDays(nation, data) > 5) nation.morale = Math.min(cap, nation.morale + mcfg.surplusBonusPerTick);
  }
  nation.morale = clamp(nation.morale, mcfg.min, cap);
  return events;
}

/** 유지 — 주거 수용력(주민 상한). 기존 capacityFor 를 대신한다. */
export function capacityFor(nation, data) {
  return capacity(nation, data);
}

// ────────────────────────────────────────────────────────────────
function autoExport(nation, data, hooks) {
  const t = data.balance.trade;
  const g = data.balance.gold;
  const reserveDays = g.autoExportReserveDays ?? 10;
  const capCfg = g.autoExportGoldCapPerTick;
  const cap = capCfg ? capCfg.base + capCfg.perRoadTier * (nation.buildings?.road || 0) : Infinity;
  let gold = 0;
  for (const res of data.resources.order) {
    if (gold >= cap) break;
    if (res === 'grain' && nation.rationing) continue;
    const meta = data.resources.meta[res];
    // ★ §13-C-1 — 먹을 것과 만들 것(고기·가죽·털)은 등 뒤에서 팔지 않는다
    if (meta.autoExport === false) continue;
    const floor = nation.exportFloors?.[res] ?? 0;
    const reserve = Math.max(nation.population * (meta.stockCoefficient ?? 0) * reserveDays, floor);
    const surplus = (nation.resources[res] || 0) - reserve;
    if (surplus <= 0) continue;
    const unit = meta.referencePrice * (1 - t.exportFriction);
    const shippable = Math.min(surplus, unit > 0 ? (cap - gold) / unit : surplus);
    nation.resources[res] -= shippable;
    gold += shippable * unit;
  }
  gold *= hooks.goldMultiplier ?? 1;
  nation.gold += gold;
  nation.stats.goldEarned += gold;
  return gold;
}

// ────────────────────────────────────────────────────────────────
function orderContext(world, nation, data) {
  const hooks = collectHooks(nation, data);
  const days = daysUntilWave(world, nation);
  return {
    resources: nation.resources,
    gold: nation.gold,
    tick: world.tick,
    population: nation.population,
    defenseTotal: 0,
    invasionDaysUntil: days ?? 999,
    hooks,
  };
}

function actionToCommand(action, nation, data) {
  switch (action.type) {
    case 'TRANSFER': {
      const res = action.args.resource;
      const amount = action.args.amount === 'surplus'
        ? Math.max(0, (nation.resources[res] || 0) - targetStock(nation, res, data))
        : action.args.amount;
      if (!(amount > 0)) return null;
      return { type: 'trade', nationId: 'ai3', side: 'sell', resource: res, amount };
    }
    case 'CONVERT':
    case 'QUEUE_SWITCH': {
      const o = action.args.output;
      if (o === 'weapon') {
        const next = (nation.buildings.tools.weapon || 0) + 1;
        if (next > data.buildings.tools.weapon.tiers.length) return null;
        return { type: 'buyTool', tool: 'weapon', tier: next };
      }
      const q = o === 'steel' ? { steel: 0.8, fuel: 0.15, weapon: 0.05 } : { steel: 0.2, fuel: 0.75, weapon: 0.05 };
      return { type: 'setQueue', factory: q };
    }
    case 'TRADE': {
      const res = action.args.resource;
      const amount = action.args.amount === 'surplus'
        ? Math.max(0, (nation.resources[res] || 0) - targetStock(nation, res, data))
        : action.args.amount;
      if (!(amount > 0)) return null;
      return { type: 'trade', nationId: 'ai3', side: action.args.side, resource: res, amount };
    }
    case 'DEFEND': {
      const alloc = { ...nation.laborAlloc };
      const target = clamp(action.args.allocPct, 0, 0.95);
      const delta = target - alloc.defense;
      alloc.defense = target;
      const donors = ['build', 'factory', 'trade', 'farm'];
      let need = delta;
      for (const d of donors) {
        if (need <= 0) break;
        const take = Math.min(need, Math.max(0, alloc[d] - 0.02));
        alloc[d] -= take; need -= take;
      }
      return { type: 'setLabor', alloc: normalizeAlloc(alloc, data) };
    }
    default: return null;
  }
}
