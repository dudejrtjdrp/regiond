// 왕의 하루 — docs/GAMEPLAY2.md §C + docs/WORLD.md §10(군주 아바타).
// ★ v2: 대상이 타일 인덱스가 아니라 월드의 노드/일자리 id 다. 계약(AP 비용·쿨다운·효과)은 그대로 재사용한다.
// 섭정(오프라인)은 AP를 쓰지 않는다: AP는 '접속한 사람만 얻는 보너스'이고,
// 시뮬 체크포인트는 AP 미사용 기준으로 유지된다(§C-1).
import { grantArtifact, dropPool } from './artifacts.js';
import { round2 } from './economy.js';
import { nodeById, townOf, territoryRadius, dist } from './world.js';
import { templeCard } from './temple.js';   // ★ §20-R4b — 자취가 신전이면 게이지 대신 신전이 선다
import {
  resolveTarget, isHarvestReady, markHarvestCycle, fieldStage, fieldStageView,
} from './villagers.js';

export const apConfig = (data) => data.balance.actionPoints;
export const harvestConfig = (data) => data.balance.harvest;

/**
 * 하루 시작 시 AP 리셋(이월 없음) + 일일 사용 기록 초기화.
 * ★ GDD3 §3 — '몸소 일하기'와 하루 체감 곡선(fatigue)은 폐지됐다. 노동은 스윙(actionSwing)이고
 *   그 제한은 쿨타임이다. AP 는 큰 액션(격려 순행·유적 탐사·조사)에만 남는다.
 */
export function regenActionPoints(nation, data, tick) {
  const cfg = apConfig(data);
  const ap = (nation.ap ||= { current: cfg.max, max: cfg.max, day: tick });
  ap.max = cfg.max;
  ap.current = cfg.carryOver ? Math.min(cfg.max, (ap.current || 0) + cfg.regenPerDay) : cfg.regenPerDay;
  ap.current = Math.min(ap.current, cfg.max);
  ap.day = tick;
  nation.apState = { inspiredDepts: [], workedNodes: [] };
  return ap;
}

/** 대상(노드/일자리) → 부처 추정 */
export function deptForTarget(target, data) {
  const cfg = apConfig(data).actions.inspire;
  if (!target) return cfg.defaultDept;
  if (target.kind === 'node') return cfg.deptByNodeType[target.nodeType] ?? cfg.defaultDept;
  return cfg.deptByPost[target.post] ?? cfg.defaultDept;
}

/**
 * AP 액션. 반환은 commands.applyCommand 규약({ok, ...}|{ok:false, error}).
 * events 를 함께 실어 보내면 서버가 즉시 브로드캐스트한다(유적 카드 등).
 */
export function performApAction(world, nation, cmd, data, rng) {
  const cfg = apConfig(data);
  // 소켓 계층에서 cmd.type 은 이벤트명('apAction')이 되므로 원본 페이로드가 cmd.payload 로 함께 온다.
  const type = cmd.apType ?? cmd.payload?.type ?? cmd.action ?? cmd.kind;
  const def = cfg.actions[type];
  if (!def) return { ok: false, error: { code: 'BAD_AP_ACTION', message: '알 수 없는 행동입니다.' } };
  if (!nation.isPlayer) return { ok: false, error: { code: 'NOT_PLAYER', message: '왕의 행동은 플레이어 국가만 할 수 있습니다.' } };

  const nodeId = cmd.nodeId ?? cmd.payload?.nodeId ?? null;
  const target = nodeId == null ? null : resolveTarget(world, nation, nodeId, data);
  if (nodeId != null && !target) {
    return { ok: false, error: { code: 'BAD_NODE', message: '영토 안에 그런 곳이 없습니다.' } };
  }
  if (type !== 'inspire' && !target) {
    return { ok: false, error: { code: 'BAD_NODE', message: '대상을 골라야 합니다.' } };
  }

  const ap = (nation.ap ||= { current: cfg.max, max: cfg.max, day: world.tick });
  const cost = def.cost ?? 0;
  if (cost > 0 && (ap.current || 0) < cost) {
    return { ok: false, error: { code: 'NO_AP', message: '오늘 쓸 수 있는 행동력을 다 썼습니다.' } };
  }
  const st = (nation.apState ||= { inspiredDepts: [], workedNodes: [] });

  switch (type) {
    case 'inspire': {
      const asked = cmd.dept ?? cmd.payload?.dept ?? null;
      if (!target && !asked) return { ok: false, error: { code: 'BAD_NODE', message: '대상을 골라야 합니다.' } };
      const dept = asked && data.roles.order.includes(asked) ? asked : deptForTarget(target, data);
      if (def.oncePerDeptPerDay && st.inspiredDepts.includes(dept)) {
        return { ok: false, error: { code: 'ALREADY_INSPIRED', message: '오늘 그 부처는 이미 순행했습니다.' } };
      }
      st.inspiredDepts.push(dept);
      ap.current -= cost;
      (nation.buffs ||= []).push({
        id: `king_inspire_${dept}_${world.tick}`,
        name: `${data.roles.defs[dept]?.name ?? dept} 격려 순행`,
        outputBonusByDept: { [dept]: def.outputBonus },
        expiresTick: world.tick + (def.durationTicks ?? 1),
      });
      return { ok: true, ap: { ...ap }, action: 'inspire', dept, bonus: def.outputBonus, nodeId: target?.id ?? null };
    }
    case 'explore': {
      if (target.kind !== 'node' || target.nodeType !== def.requiresNodeType) {
        return { ok: false, error: { code: 'NOT_RUIN', message: '탐사할 유적이 아닙니다.' } };
      }
      ap.current -= cost;
      nation.ruinGauge = (nation.ruinGauge || 0) + (def.gaugeGain ?? 1);
      const events = [];
      /* ★ §20-R4b — 이 자취가 신전이면 게이지를 기다리지 않는다. 신전은 「뒤지다 보면 나오는 것」이
         아니라 **찾아가는 곳**이라, 선 그 자리에서 다음 단이 열린다(수수께끼 → 시련 → 안치소). */
      let card = templeCard(world, nation, target.node ?? target, data);
      if (card) {
        (nation.decisionQueue ||= []).push({ ...card, createdTick: world.tick });
      } else if (nation.ruinGauge >= data.ruins.gaugeThreshold) {
        nation.ruinGauge = 0;
        card = openRuinCard(world, nation, data, rng);   // 이 문이 제 손으로 큐에 넣는다
      }
      if (card) events.push({ kind: 'ruin_event', nationId: nation.id, data: { card } });
      return { ok: true, ap: { ...ap }, action: 'explore', nodeId: target.id, ruinGauge: nation.ruinGauge, card, events };
    }
    case 'survey': {
      const node = target.kind === 'node' ? target.node : null;
      const def2 = node ? data.world.nodes.types[node.type] : null;
      const survey = {
        nodeId: target.id,
        kind: target.kind,
        name: target.name,
        x: target.x,
        y: target.y,
        nodeType: node?.type ?? null,
        rich: Boolean(node?.rich),
        amount: node ? round2(node.amount) : null,
        max: node ? round2(node.max) : null,
        depleted: Boolean(node?.depleted),
        workers: node?.workers ?? 0,
        slots: target.slots,
        hint: node
          ? `${def2?.name ?? node.type}${node.rich ? ' — 유난히 기름집니다.' : ''}`
          : `${target.name} — 사람을 붙일 수 있습니다.`,
        surveyedTick: world.tick,
      };
      nation.survey = survey;
      return { ok: true, ap: { ...ap }, action: 'survey', survey };
    }
    default:
      return { ok: false, error: { code: 'BAD_AP_ACTION', message: '알 수 없는 행동입니다.' } };
  }
}

// ────────────────────────────────────────────────────────────────
// 수확 (§C-2) — 밭 노드. 클릭은 보너스만. 안 눌러도 자동 수확(3단계 산출)에는 이미 들어 있다.
// ────────────────────────────────────────────────────────────────
export function harvestNode(world, nation, cmd, data) {
  const cfg = harvestConfig(data);
  const node = nodeById(world, cmd.nodeId ?? cmd.payload?.nodeId);
  if (!node) return { ok: false, error: { code: 'BAD_NODE', message: '없는 자리입니다.' } };
  const town = townOf(world, nation.id);
  if (!town || dist(node.x, node.y, town.x, town.y) > territoryRadius(nation, data) + 0.001) {
    return { ok: false, error: { code: 'OUT_OF_TERRITORY', message: '우리 땅이 아닙니다.' } };
  }
  const def = data.world.nodes.types[node.type];
  if (!def?.harvest) return { ok: false, error: { code: 'NOT_FARM', message: '밭에서만 거둘 수 있습니다.' } };
  if (!isHarvestReady(node, data, world.tick)) {
    return { ok: false, error: { code: 'NOT_READY', message: '아직 여물지 않았습니다.' } };
  }
  const gained = { ...cfg.clickBonus };
  for (const [res, v] of Object.entries(gained)) nation.resources[res] = (nation.resources[res] || 0) + v;
  // ★ §13 재배 루프 — 거두면 곧바로 재파종된다(자동). 성장 단계는 서버가 노드 상태로 관리한다.
  node.readyAt = world.tick + cfg.readyEveryTicks;
  node.stage = fieldStage(node, data, world.tick);
  node.stamp = world.tick;
  return { ok: true, nodeId: node.id, gained, readyAt: node.readyAt, stage: node.stage };
}

export { isHarvestReady, markHarvestCycle, fieldStage, fieldStageView };

// ────────────────────────────────────────────────────────────────
// 유적 카드 (§C-4) — 규칙 그대로
// ────────────────────────────────────────────────────────────────
export function openRuinCard(world, nation, data, rng) {
  const def = rng.pick(data.ruins.cards);
  const decisionId = `ruin_${nation.id}_${world.tick}_${def.id}`;
  const card = {
    decisionId,
    cardId: def.id,
    name: def.name,
    text: def.text,
    options: def.options.map((o) => ({ key: o.key, label: o.label })),
  };
  (nation.decisionQueue ||= []).push({
    decisionId,
    kind: data.ruins.decisionKind,
    title: data.ruins.title,
    text: `${def.name} — ${def.text}`,
    options: def.options.map((o) => o.key),
    createdTick: world.tick,
    ruin: { cardId: def.id },
  });
  return card;
}

/** decide {decisionId, choice} 로 들어온 유적 카드 선택 처리 */
export function resolveRuinChoice(world, nation, decision, choice, data, rng) {
  const card = data.ruins.cards.find((c) => c.id === decision.ruin?.cardId);
  if (!card) return { ok: false, error: { code: 'NO_RUIN_CARD', message: '없는 유적 카드입니다.' } };
  const opt = card.options.find((o) => o.key === choice) ?? card.options[card.options.length - 1];
  const applied = [];
  const lines = [opt.text];
  let artifact = null;

  for (const out of opt.outcomes || []) {
    switch (out.op) {
      case 'artifactRoll': {
        if (rng.chance(out.chance)) {
          /* ★ §17-17 버그 수정 — 큰 유적의 gradeBoost 가 여태 굴림에 실리지 않았다.
             actions.js 가 뒤진 유적의 등급 보정을 nation.ruinGradeBoost 에 쌓아 두기만 했고
             카드를 여는 이 자리가 그것을 읽지 않았다: 「죽은 자의 성채」를 스무 번 두드려도
             나오는 물건의 급이 「옛 자취」와 똑같았다. 여기서 넘겨 쓰고 **쓴 즉시 0 으로 되돌린다**
             (한 번 쌓은 보정은 한 번의 굴림에만 얹힌다 — 안 그러면 성채 하나로 영영 후해진다). */
          artifact = grantRandomArtifact(nation, data, rng, world.tick, consumeRuinGradeBoost(nation), { world, via: 'ruin' });
          lines.push(artifact ? `${out.successText} (${artifact.name})` : out.successText);
          applied.push(artifact ? `artifact:${artifact.key}` : 'artifact:none');
        } else {
          lines.push(out.failText);
          for (const fx of out.failEffects || []) applyRuinEffect(nation, fx, data, applied);
        }
        break;
      }
      default: applyRuinEffect(nation, out, data, applied); if (out.text) lines.push(out.text); break;
    }
  }
  return {
    ok: true,
    result: {
      cardId: card.id, name: card.name, choice: opt.key, label: opt.label,
      text: lines.filter(Boolean).join(' '), applied,
      artifact: artifact ? { key: artifact.key, name: artifact.name, grade: artifact.grade } : null,
    },
  };
}

function applyRuinEffect(nation, fx, data, applied) {
  switch (fx.op) {
    case 'gold':
      nation.gold = round2(nation.gold + fx.amount);
      if (fx.amount < 0) nation.stats.goldSpent += -fx.amount; else nation.stats.goldEarned += fx.amount;
      applied.push(`gold${fx.amount >= 0 ? '+' : ''}${fx.amount}`);
      break;
    case 'morale': {
      const m = data.balance.morale;
      nation.morale = Math.max(m.min, Math.min(m.max, nation.morale + fx.amount));
      applied.push(`morale${fx.amount >= 0 ? '+' : ''}${fx.amount}`);
      break;
    }
    case 'resource':
      nation.resources[fx.resource] = Math.max(0, (nation.resources[fx.resource] || 0) + fx.amount);
      applied.push(`${fx.resource}${fx.amount >= 0 ? '+' : ''}${fx.amount}`);
      break;
    default: break;
  }
}

/**
 * ★ §17-17 — 쌓인 유적 등급 보정을 꺼내 쓰고 그 자리에서 비운다. 「쓰고 되돌린다」가 한 곳에만 있어야
 * 다음에 부르는 쪽(숨은 궤·상자)이 실수로 두 번 얹지 않는다.
 */
export function consumeRuinGradeBoost(nation) {
  const boost = nation.ruinGradeBoost || 0;
  nation.ruinGradeBoost = 0;
  return boost;
}

/**
 * 기존 등급표(balance.artifacts.gradeWeights)를 그대로 재사용한 유물 드랍.
 * ★ §17-17 gradeBoost — 뽑힌 등급을 그만큼 위로 민다(common→rare→unique→legendary).
 *   가중치 표를 고치지 않는 까닭: 표는 「보통 무엇이 나오는가」의 정본이고 유적 크기는 그 위에 얹는
 *   보정이다. 표를 흔들면 상자·의회 드랍까지 함께 움직인다. 민 등급이 동나 있으면 원래 등급으로 내려온다
 *   — 보정 때문에 오히려 빈손으로 돌아오는 일은 없어야 한다.
 */
export function grantRandomArtifact(nation, data, rng, tick, gradeBoost = 0, opts = {}) {
  const cfg = data.balance.artifacts;
  const order = Object.keys(cfg.gradeWeights);
  const rolled = rng.weighted(order.map((value) => ({ value, weight: cfg.gradeWeights[value] })));
  /* ★ §20-R4 — 명단을 dropPool 에 맡긴다(유물기획 §20-1 「상자 밖 축」). 등급표는 그대로 굴리되
     **그 경로가 낼 수 있다고 제 입으로 적은 것**만 남는다. 옛 50종은 전부 chest·ruin·cache 를
     적어 두었으므로 이 세 풀은 한 톨도 안 바뀐다(시드 42 가 그대로 산다). 신규 21종은 셋 중
     어느 것도 적지 않아 자동으로 빠지고, 이미 이 방에서 나온 전설(exclusive:"room")도 빠진다. */
  const via = opts.via ?? 'ruin';
  const inGrade = (g) => dropPool(opts.world ?? null, nation, data, g, via);
  const up = order[Math.min(order.length - 1, order.indexOf(rolled) + Math.max(0, gradeBoost))];
  let pool = inGrade(up);
  if (!pool.length) pool = inGrade(rolled);
  if (!pool.length) return null;
  const pickKey = rng.pick(pool).key;
  const entry = grantArtifact(nation, pickKey, tick, data);
  if (!entry) return null;
  const def = data.artifactsByKey[pickKey];
  return { key: def.key, name: def.name, grade: def.grade };
}
