// §17-E-1 목표 잔여 안내 — 조건이 갈래(any·all)여도 자원 팝이 길을 알려 준다
//
// 실측한 버그: 4c440af 가 3장 첫 칸을 「곡물 20 **또는** 고기 7」(condition.type='any')로
// 두껍게 만든 뒤로, 자원을 캘 때 뜨던 「식량 +2 (오두막까지 8)」이 통째로 사라졌다.
// public/js/state.js goalRemaining() 이 `type !== 'resource'` 면 곧장 null 을 냈기 때문이다.
// 조건은 자라는데 안내만 옛 모양에 박혀 있으면, 두꺼워진 만큼 플레이어가 길을 잃는다.
//
// 이 파일이 지키는 것 다섯:
//   ① any 안쪽 잎 — 「곡물 20 또는 고기 7」에서 곡물 잔여가 나온다(잎의 need 로 잰다).
//   ② 같은 갈래의 다른 잎도 제 잔여로 안내한다(고기 7 → 7).
//   ③ ★ any 는 「아무거나 하나」 — 한 갈래가 이미 찼으면 안내를 붙이지 않는다.
//   ④ all 안쪽 잎도 내려가 찾는다.
//   ⑤ 목표와 무관한 자원·못 재는 조건에는 붙지 않는다.
//
// 조건 표는 **실제 data/chapters.json** 에서 꺼내 온다 — 자료가 또 바뀌면 여기서 먼저 깨진다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { loadGameData } from '../server/engine/data.js';

const data = loadGameData();

/** 자료에서 그 칸의 조건 한 장 꺼내기 */
function stepCondition(chapterKey, stepKey) {
  const ch = (data.chapters.chapters || []).find((c) => c.key === chapterKey);
  assert.ok(ch, `${chapterKey} 장이 자료에 없다`);
  const st = (ch.steps || []).find((s) => s.key === stepKey);
  assert.ok(st, `${chapterKey}/${stepKey} 칸이 자료에 없다`);
  return st;
}

/** 화면 없는 상태 저장소 한 채 — state.js 는 GM 하나만 있으면 선다 */
function boot(goal, nation) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(readFileSync('public/js/state.js', 'utf8'));
  const S = w.GM.state;
  S.S.view = {
    nation: { resources: {}, population: 0, ...nation },
    structures: nation?.structures ?? [],
    chapter: { id: 3, goal },
  };
  return S;
}

/** 서버 chapterView 가 내는 goal 카드 모양 (progression.js chapterView) */
function goalCard(st, over = {}) {
  return {
    key: st.key, title: st.title, short: st.short ?? null, sub: st.sub ?? '',
    condition: st.condition, have: 0, need: 1, done: false, targets: [], ...over,
  };
}

test('§17-E-1 ① any 안쪽 잎 — 「곡물 20 또는 고기 7」에서 곡물 잔여가 나온다', () => {
  const st = stepCondition('hunger', 'grain20');
  assert.equal(st.condition.type, 'any', '이 회귀의 전제 — 3장 첫 칸은 갈래 조건이다');
  const S = boot(goalCard(st), { resources: { grain: 12, meat: 0 } });
  const r = S.goalRemaining('grain');
  assert.ok(r, '갈래 조건이어도 잔여가 계산돼야 한다 (이 줄이 그 버그다)');
  assert.equal(r.remaining, 8, '곡물 20 중 12 를 들었으니 8');
  assert.equal(r.need, 20, 'need 는 장 전체가 아니라 **그 잎**의 몫이다');
  assert.equal(r.short, st.short, '팝에 붙는 짧은 이름은 칸이 쥔다');
});

test('§17-E-1 ② 같은 갈래의 다른 잎도 제 잔여로 안내한다', () => {
  const st = stepCondition('hunger', 'grain20');
  const S = boot(goalCard(st), { resources: { grain: 0, meat: 2 } });
  const r = S.goalRemaining('meat');
  assert.ok(r, '고기 갈래도 목표다 — 물가에서 고기를 건지는 사람에게도 길이 보여야 한다');
  assert.equal(r.remaining, 5, '고기 7 중 2 를 들었으니 5');
});

test('§17-E-1 ③ any 는 아무거나 하나 — 한 갈래가 차면 안내를 붙이지 않는다', () => {
  const st = stepCondition('hunger', 'grain20');
  const S = boot(goalCard(st), { resources: { grain: 3, meat: 7 } });
  assert.equal(S.goalRemaining('grain'), null, '고기로 이미 넘겼는데 「곡물까지 17」은 잔소리다');
  assert.equal(S.goalRemaining('meat'), null, '찬 갈래 자신에게도 붙지 않는다');
});

test('§17-E-1 ④ all 안쪽 잎도 내려가 찾는다', () => {
  const cond = {
    type: 'all',
    of: [
      { type: 'resource', resource: 'wood', amount: 10 },
      { type: 'structure', building: 'hut', count: 1 },
    ],
  };
  const S = boot(goalCard({ key: 'x', title: '둘 다', short: '오두막', condition: cond }),
    { resources: { wood: 4 } });
  const r = S.goalRemaining('wood');
  assert.ok(r, 'all 안쪽 자원 잎도 안내 대상이다');
  assert.equal(r.remaining, 6);
});

test('§17-E-1 ⑥ goalNeeds — 가까운 순의 자는 서버(진행 비율)와 같다', () => {
  const st = stepCondition('hunger', 'grain20');
  const S = boot(goalCard(st), { resources: { grain: 12, meat: 0 } });
  const rows = S.goalNeeds();
  // (배열은 jsdom 창 안에서 만들어져 realm 이 다르다 — 값만 이어 붙여 잰다)
  assert.equal(rows.map((r) => r.resource).join(','), 'grain,meat',
    '곡물 12/20(0.6)이 고기 0/7(0)보다 가깝다 — 남은 양(8 > 7)이 아니라 찬 비율로 잰다');
  // ★ 해결 말풍선(quest.missingResource)이 이 차례를 그대로 따른다
  const flipped = boot(goalCard(st), { resources: { grain: 0, meat: 5 } });
  assert.equal(flipped.goalNeeds()[0].resource, 'meat', '고기로 가고 있으면 고기를 짚어 준다');
});

test('§17-E-1 ⑤ 무관한 자원·못 재는 조건에는 붙지 않는다', () => {
  const st = stepCondition('hunger', 'grain20');
  const S = boot(goalCard(st), { resources: { grain: 12 } });
  assert.equal(S.goalRemaining('stone'), null, '목표와 무관한 자원에는 안 붙는다');

  const held = boot(goalCard({ key: 'w', title: '무리를 막아라', condition: { type: 'wavesHeld', count: 1 } }),
    { resources: { grain: 1 } });
  assert.equal(held.goalRemaining('grain'), null, '화면이 못 재는 조건은 서버 몫이다');
});
