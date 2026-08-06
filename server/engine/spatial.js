// 노드 공간 색인 — ★ Sprint 3 (성능). **파생 캐시일 뿐이다.**
//
// 왜 생겼나. 지도가 384×384 로 넓어지며 자원 노드가 5,000개에 이르렀는데, 노드를 찾는 길이
// 전부 `world.map.nodes.find(...)` 한 줄이었다. 그 한 줄이 초당 수십만 번씩 불린다:
//   · residents.nodeOfResident — 방송 한 번에 주민 60명 × 노드 5,000 × 두 곳(state·worldDiff)
//   · companions.targetValid/aimPoint — 동료 넷이 1초마다
//   · villagers.listTargets · companions.pickNode — 노드 전체를 훑고 거리를 잰다
//
// 규율 셋 (이것을 어기면 캐시가 아니라 버그다):
//   ① **저장하지 않는다.** WeakMap 으로 `world.map` 에 매달아 두므로, 일 틱의 structuredClone 이
//      새 map 을 만들면 캐시도 저절로 새로 난다. 스냅샷에는 한 바이트도 실리지 않는다.
//   ② **순서를 지킨다.** nodesNear 는 언제나 **원래 배열 차례**로 돌려준다(칸을 훑은 차례가 아니다).
//      노드를 고르는 자리에는 거리 정렬·자리 번호 나눔이 걸려 있고, JS 정렬은 안정 정렬이라
//      원래 차례가 곧 동점자의 승부다 — 차례가 흔들리면 같은 씨앗이 다른 게임이 된다.
//   ③ **자리는 변하지 않는다.** 노드는 태어난 자리에서 죽는다(고갈·은닉은 깃발일 뿐 좌표가 아니다).
//      그래서 칸 색인은 배열이 늘거나 줄 때만 다시 지으면 된다. 깃발 판정(depleted·hidden·concealed)은
//      부르는 쪽이 예전 그대로 한다 — 이 모듈은 「어디에 있나」만 안다.

/** 칸 크기(타일). 16 은 안개 청크와 같은 눈금이라 사람이 머릿속에 두 개의 격자를 들지 않아도 된다. */
const BUCKET = 16;

/** @type {WeakMap<object, {stamp:string, nodes:Array, byId:Map, grid:Map}>} */
const CACHE = new WeakMap();

/**
 * 이 색인이 아직 유효한가를 가르는 표.
 * `nodesStamp` 는 world.js 의 addNode·removeNode 가 올린다 — 지웠다 넣어 길이가 그대로인 찰나에도
 * 색인이 낡지 않게 하는 자물쇠다. 길이를 함께 보는 것은 옛 세이브(스탬프가 없는 판)의 안전망이다.
 */
function stampOf(map) {
  return `${map.nodesStamp ?? 0}:${map.nodes.length}`;
}

const keyOf = (x, y) => `${Math.floor(x / BUCKET)},${Math.floor(y / BUCKET)}`;

function build(map, stamp) {
  const nodes = map.nodes;
  const byId = new Map();
  const order = new Map();
  const grid = new Map();
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    byId.set(n.id, n);
    order.set(n.id, i);
    const k = keyOf(n.x, n.y);
    const b = grid.get(k);
    // 칸에는 노드가 아니라 **번호**를 담는다 — 돌려줄 때 원래 차례로 되세우기 위해서다(규율 ②)
    if (b) b.push(i);
    else grid.set(k, [i]);
  }
  return { stamp, nodes, byId, order, grid };
}

function entryOf(world) {
  const map = world?.map;
  if (!map || !Array.isArray(map.nodes)) return null;
  const stamp = stampOf(map);
  const hit = CACHE.get(map);
  if (hit && hit.stamp === stamp && hit.nodes === map.nodes) return hit;
  const made = build(map, stamp);
  CACHE.set(map, made);
  return made;
}

/** 아이디로 노드 하나. 없으면 null. (world.js 의 nodeById 가 이 문으로 들어온다) */
export function nodeById(world, id) {
  if (id == null) return null;
  const e = entryOf(world);
  if (!e) return null;
  return e.byId.get(id) ?? null;
}

/**
 * (x,y) 에서 반경 r 안에 **있을 수 있는** 노드들 — 칸 단위라 원이 아니라 사각형을 훑는다.
 * 즉 돌려주는 것은 언제나 「진짜 답의 상위집합」이다. 정확한 거리 판정은 부르는 쪽이 예전 그대로 한다.
 * @returns {Array} 원래 배열 차례를 지킨 후보 목록
 */
export function nodesNear(world, x, y, r) {
  const e = entryOf(world);
  if (!e) return [];
  if (!(r >= 0) || !Number.isFinite(x) || !Number.isFinite(y)) return [];
  const gx0 = Math.floor((x - r) / BUCKET);
  const gx1 = Math.floor((x + r) / BUCKET);
  const gy0 = Math.floor((y - r) / BUCKET);
  const gy1 = Math.floor((y + r) / BUCKET);
  const idx = [];
  for (let gy = gy0; gy <= gy1; gy += 1) {
    for (let gx = gx0; gx <= gx1; gx += 1) {
      const b = e.grid.get(`${gx},${gy}`);
      if (b) for (let k = 0; k < b.length; k += 1) idx.push(b[k]);
    }
  }
  if (!idx.length) return [];
  idx.sort((a, b) => a - b);                 // ★ 규율 ② — 칸을 훑은 차례가 아니라 원래 차례로
  const out = new Array(idx.length);
  for (let k = 0; k < idx.length; k += 1) out[k] = e.nodes[idx[k]];
  return out;
}

/** 노드 하나의 원래 배열 번호 — 여러 곳에서 모은 결과를 원래 차례로 되세울 때 쓴다 */
export function nodeOrderIndex(world, id) {
  const e = entryOf(world);
  if (!e) return -1;
  return e.order.get(id) ?? -1;
}

/** ★ 시험·진단용 — 지금 색인이 몇 칸에 몇을 담고 있나 */
export function spatialStats(world) {
  const e = entryOf(world);
  if (!e) return null;
  return { nodes: e.nodes.length, buckets: e.grid.size, bucket: BUCKET, stamp: e.stamp };
}
