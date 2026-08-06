// §17-19 표현·타격감 — 순수 계산 회귀
//
// 배치 D 는 거의가 눈으로 봐야 아는 일(패널 자리·장식·이펙트)이라 단위 시험 대상이 아니다.
// 다만 **셈이 되는 한 가지**는 못 박아 둔다: 건물 스프라이트 사각형.
// 그리는 쪽(world.drawStructures)과 누르는 쪽(input.structureAtSprite)이 같은 식을 각자 베껴
// 쓰고 있었고, 스프라이트를 키우는 순간 둘이 어긋나면 「보이는데 눌러지지 않는 건물」이 된다.
//
// 이 파일이 지키는 것 셋:
//   ① 그림과 판정이 같은 자다 — 사각형 안은 잡히고, 사각형 밖은 잡히지 않는다.
//   ② 키워도 건물은 제자리에 선다 — 밑변과 가로 한가운데는 배율과 무관하게 붙박이다.
//   ③ 확대 배율은 data/world.json 이 쥐고, §17-19 가 정한 1.15~1.2 안에 있다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { loadGameData } from '../server/engine/data.js';

const data = loadGameData();
const DIAL = data.world.render.structureSprite;

/** 클라 파일 두 개를 맨몸 상자에 올린다 — 화면도 서버도 없이 셈만 꺼내 본다. */
function loadClient(render) {
  const box = { console };
  box.window = box;
  box.GM = {
    ui: {},
    state: {
      worldCfg: () => ({ render }),
      footprintOfThing: (b) => ({ w: b.fw || 1, h: b.fh || 1 }),
      centerOfThing: (b) => ({ x: b.x, y: b.y }),
      structures: () => box.__list || [],
    },
  };
  box.document = { createElement: () => ({ getContext: () => ({}), style: {} }), querySelector: () => null };
  createContext(box);
  for (const f of ['public/js/world.js', 'public/js/input.js']) {
    runInContext(readFileSync(f, 'utf8'), box, { filename: f });
  }
  return box;
}

const BUILDINGS = [
  { id: 1, x: 10, y: 10, fw: 1, fh: 1 },
  { id: 2, x: 30, y: 12, fw: 2, fh: 2 },
  { id: 3, x: 50, y: 40, fw: 4, fh: 4 },
];

test('§17-19 ① 그린 사각형과 누른 자리가 한 자다', () => {
  const box = loadClient({ structureSprite: DIAL });
  box.__list = BUILDINGS;
  for (const b of BUILDINGS) {
    const r = box.GM.world.structureRect(b);
    const inside = [
      [r.x + r.w / 2, r.y + r.h / 2],
      [r.x + 0.02, r.y + 0.02],
      [r.x + r.w - 0.02, r.baseY - 0.02],
    ];
    for (const [x, y] of inside) {
      const hit = box.GM.input.structureAtSprite(x, y);
      assert.equal(hit && hit.id, b.id, `건물 ${b.id}: 그려진 자리(${x}, ${y})를 눌러도 안 잡힌다`);
    }
    const outside = [[r.x - 0.05, r.y + r.h / 2], [r.x + r.w + 0.05, r.y + r.h / 2], [r.x + r.w / 2, r.y - 0.05]];
    for (const [x, y] of outside) {
      const hit = box.GM.input.structureAtSprite(x, y);
      assert.notEqual(hit && hit.id, b.id, `건물 ${b.id}: 그림 밖(${x}, ${y})인데 잡힌다`);
    }
  }
});

test('§17-19 ② 키워도 건물은 제자리에 선다 — 밑변·가로 한가운데는 붙박이', () => {
  const small = loadClient({ structureSprite: { ...DIAL, scale: 1 } });
  const big = loadClient({ structureSprite: { ...DIAL, scale: 1.5 } });
  for (const b of BUILDINGS) {
    const a = small.GM.world.structureRect(b);
    const c = big.GM.world.structureRect(b);
    assert.equal(c.baseY, a.baseY, `건물 ${b.id}: 키웠더니 밑변이 움직였다`);
    assert.ok(Math.abs((c.x + c.w / 2) - (a.x + a.w / 2)) < 1e-9, `건물 ${b.id}: 키웠더니 옆으로 밀렸다`);
    assert.ok(c.w > a.w * 1.4 && c.h > a.h * 1.4, `건물 ${b.id}: 배율이 사각형에 닿지 않았다`);
    assert.ok(c.y < a.y, `건물 ${b.id}: 커진 만큼 위로 자라야 한다`);
  }
});

test('§17-19 ③ 확대 배율은 자료가 쥐고, 정한 폭 안에 있다', () => {
  assert.ok(DIAL.scale >= 1.15 && DIAL.scale <= 1.2, `배율 ${DIAL.scale} — §17-19 는 1.15~1.2 로 정했다`);
  assert.equal(DIAL.pad, 0.7, '옛 여백(§12-1)을 그대로 물려받아야 한다');
  const hit = data.world.render.hit;
  for (const key of ['shake', 'flashAlpha', 'mergeMs', 'minDamage', 'targetFlashColor']) {
    assert.ok(hit[key] !== undefined, `render.hit.${key} 가 없다 — 타격감 수치는 전부 자료가 쥔다`);
  }
  assert.ok(hit.flashAlpha <= 0.4, '붉은 섬광이 너무 짙으면 지도가 안 보인다');
  assert.ok(hit.shake <= 6, '흔들림이 지나치면 손맛이 아니라 멀미다');
});
