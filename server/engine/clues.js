// 단서 — ★ §22-2 층3 (유적개편기획 §22). 유적이 다음 유적을 부른다.
//
// 「왜」 이 파일이 따로 있나 — §22 가 유적을 「한 자리에서 끝나는 이야기」로 만들자 새 물음이 생겼다:
// 그러면 **다음 자취에는 왜 가나**. 답이 「아직 안 가 본 곳이라서」뿐이면 유저가 처음 물었던
// 「왜 있는 거지」로 되돌아간다. 단서는 그 답을 자취 스스로에게 시킨다 — 깊은 방까지 판 사람은
// 다음에 갈 곳을 얻는다.
//
// 규율 셋 — 탐험기획 §18-3 의 것을 그대로 물려받는다. 고칠 때 반드시 지킨다.
//  ① 마커·화살표·좌표 금지. 단서가 여는 것은 **안개**와 **한 줄의 말**뿐이다.
//     좌표는 ack 에서 지워져 나간다(server/index.js 가 investigateTrail 에 하던 그대로).
//  ② 월드 난수를 한 톨도 축내지 않는다. 고르기는 statRng(`씨앗:clue:<노드id>`) 다 —
//     실시간 명령이 월드 난수를 건드리면 같은 씨앗이 다른 게임이 된다.
//  ③ 수치·문구는 전부 data/ruins.json 의 `clue` 다. 여기에는 규칙만 있다.
import { statRng } from './traits.js';
import { terrainNameAt } from './world.js';
import { stampVisionDisc } from './fog.js';
import { record as chronicle } from './chronicle.js';
import { templeNodes } from './temple.js';
/* ★ 3단계A — 단서를 **적어 둔다**. 장부는 도감이 쥔다(codex.js 의 recordClue 머리말 참조):
   닿음 표시를 박는 자리가 temple.js 라 기록을 여기 두면 clues ↔ temple 고리가 생긴다. */
import { recordClue } from './codex.js';

export const clueCfg = (data) => data.ruins?.clue ?? null;

/**
 * 이 자취가 가리키는 곳의 안개를 연다.
 * @returns {{text, dir, land, revealed}|null} 가리킬 곳이 없으면 null (문구는 부르는 쪽이 고른다)
 */
export function dropClue(world, nation, data, node) {
  const cfg = clueCfg(data);
  if (!cfg || !node) return null;
  /* ★ 한 자취는 **한 곳만** 가리킨다. 돌에 새겨진 지도는 물을 때마다 다른 곳을 가리키지 않고,
     방이 넷인 성채에서 깊은 카드를 둘 뽑았다고 갈 곳이 둘로 늘어서도 안 된다(단서 농사 금지). */
  if (node.clueGiven) return null;
  /* 깊은 유적의 세 번째 단서는 다음 유적이 아니라 신전으로 이어진다.
     궤·유적을 여는 행동이 "언젠가 좋은 게 나오겠지"에서 명확한 원정 목표로 바뀐다. */
  const count = (nation.templeClues ?? 0) + 1;
  const temple = count % 3 === 0 ? pickTemple(world, nation, data, count) : null;
  const target = temple?.node ?? pickTarget(world, nation, data, node, cfg);
  if (target) node.clueGiven = true;
  if (!target) return null;
  nation.templeClues = count;
  const dir = dirWord(cfg, target.x - node.x, target.y - node.y);
  const land = landWord(world, data, cfg, target);
  const text = temple ? templeLine(cfg, temple.kind, dir, land) : lineFor(cfg, node, dir, land);
  const revealed = stampVisionDisc(nation, data, world.tick, target.x, target.y, cfg.revealRadius ?? 9);
  chronicle(world, {
    kind: 'discovery', title: cfg.chronicleTitle ?? '옮겨 적은 선', text,
    data: { from: node.id },
  }, data);
  /* ★ 3단계A — 카드가 닫혀도 이 한 줄은 도감에 남는다. 난수는 한 톨도 안 쓴다(규율 ②) —
     적는 일일 뿐이다. 가리킨 자취의 id 는 「닿았는가」 판별용으로만 들어가고 뷰에서 잘린다. */
  recordClue(nation, {
    fromNodeId: node.id, fromName: node.ruinName ?? null,
    line: text, dir, land, temple: Boolean(temple),
    targetNodeId: target.id, tick: world.tick ?? 0,
  });
  return { text, dir, land, revealed, temple: Boolean(temple), templeId: temple?.kind?.id ?? null };
}

function pickTemple(world, nation, data, count) {
  const pool = Object.values(templeNodes(world, nation, data))
    .filter((p) => !nation.temples?.[p.node.id]?.done);
  if (!pool.length) return null;
  return pool[Math.floor((count - 1) / 3) % pool.length];
}

function templeLine(cfg, kind, dir, land) {
  const lines = cfg.templeLines || [];
  if (!lines.length) return `${dir} ${land}, ${kind.name}의 문양이 보인다.`;
  return lines[Math.abs(hash(String(kind.id))) % lines.length]
    .replace('{dir}', dir).replace('{land}', land).replace('{temple}', kind.name);
}

/**
 * 가리킬 자취 하나. 조건 넷 — 아직 안 뒤진 곳 · 여기서 너무 가깝지도 멀지도 않은 곳 ·
 * 이미 밝은 곳이 아닌 곳 · 신전이 아닌 곳(신전은 제 문으로 찾아가는 곳이다, §20-R4e).
 * 「왜」 본영이 아니라 **이 자취**에서 재나 — 단서는 집으로 돌아가는 길이 아니라 **더 나아가는**
 * 길이다. 본영에서 재면 이미 훑은 앞마당이 자꾸 다시 걸린다.
 */
function pickTarget(world, nation, data, node, cfg) {
  const min = cfg.minDistance ?? 30;
  const max = cfg.maxDistance ?? 110;
  const seen = (nation.clueSeen ||= []);
  const pool = (world.map?.nodes || []).filter((n) => candidate(n, node, seen, min, max));
  if (!pool.length) return null;
  const picked = statRng(`${world.seed}:clue:${node.id}`).pick(pool);
  seen.push(picked.id);
  return picked;
}

function candidate(n, from, seen, min, max) {
  if (n.type !== 'ruin' || n.id === from.id || n.spent || n.roomsOpened) return false;
  if (seen.includes(n.id)) return false;                 // 한 곳을 두 번 가리키지 않는다
  const d = Math.hypot(n.x - from.x, n.y - from.y);
  return d >= min && d <= max;
}

/** 여덟 방위 한 낱말. 「왜」 각도가 아니라 낱말인가 — 각도는 좌표의 다른 이름이다(규율 ①). */
function dirWord(cfg, dx, dy) {
  const names = cfg.dirNames ?? {};
  const ns = Math.abs(dy) < Math.abs(dx) * 0.5 ? '' : (dy < 0 ? 'n' : 's');
  const ew = Math.abs(dx) < Math.abs(dy) * 0.5 ? '' : (dx < 0 ? 'w' : 'e');
  return names[`${ns}${ew}`] ?? names.n ?? '먼 곳';
}

function landWord(world, data, cfg, target) {
  const code = terrainNameAt(world.map, Math.round(target.x), Math.round(target.y), data);
  return (cfg.landNames ?? {})[code] ?? cfg.landFallback ?? '어느 땅';
}

/** 문구는 자취마다 고정이다 — 같은 지도의 같은 자취는 언제 물어도 같은 말을 한다(규율 ②). */
function lineFor(cfg, node, dir, land) {
  const lines = cfg.lines || [];
  if (!lines.length) return `${dir} ${land}.`;
  const pick = lines[Math.abs(hash(String(node.id))) % lines.length];
  return pick.replace('{dir}', dir).replace('{land}', land);
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
