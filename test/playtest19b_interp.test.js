// §19-B 위치 보간 회귀 — docs/QA1차/02_네트워크_최적화.md (B02-1 몹·플레이어 이동 끊김/텔레포트)
//
// 증상은 「동물·적·플레이어·봇이 뚝뚝 끊기며 이동하거나 텔레포트한다.
// 특히 ① 게임 시작 직후 ② 새 플레이어 입장 직후 심하다」였다.
// 서버 틱은 죄가 없다 — 죄는 화면이 그 사이를 잇는 방식에 있었다. 이 파일이 지키는 것 여섯:
//   ① 등속 — 서버가 일정 간격으로 미는 좌표 사이를 고르게 지난다(프레임 간 이동량 흩어짐이 작다).
//   ② 외삽 금지 — 좌표가 끊기면 받은 마지막 자리에 선다. 앞질러 갔다 되돌아오지 않는다.
//   ③ 지연폭 ≥ 간격 — 기본 간격(아직 못 잰 놈)이 실제 간격보다 짧으면 띠가 말라
//      매 스냅샷마다 「멈췄다 확 뛴다」. 시작 직후·입장 직후가 유난했던 자리다.
//   ④ 쉼은 박자가 아니다 — 한참 서 있다 다시 걸어도 지연폭이 부풀지 않고,
//      그 걸음이 서 있던 참 전체에 걸쳐 늘어지지도 않는다.
//   ⑤ 스냅은 정말 멀 때만 — 걸어서 못 갈 거리에서만 즉시 옮긴다(그 밖에는 언제나 이어 걷는다).
//   ⑥ 수치는 코드가 아니라 data/world.json render.interp 가 쥐고, 규격(/api/config)에 실려 간다.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { loadGameData, publicConfig } from '../server/engine/data.js';

const data = loadGameData();

/** 화면 없는 보간기 한 채 — public/js/interp.js 만 올려 규칙을 그대로 꺼내 본다. */
function boot() {
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync('public/js/interp.js', 'utf8'), ctx);
  const IP = ctx.window.GM.interp;
  return { IP, d: IP.dials(data.world.render) };
}

/** 좌표를 gap 마다 흘리며 60fps 로 그린다 — 프레임마다의 이동량을 모아 준다 */
function run(IP, d, { gap, defGap, steps, speed, frames = 60 }) {
  const a = IP.create(0, 0, 0, null);
  const moves = [];
  let clock = 0;
  for (let s = 1; s <= steps; s += 1) {
    IP.push(a, s * speed, 0, s * gap, 12, d, defGap);
    for (let f = 0; f < frames; f += 1) {
      clock += gap / frames;
      const p = IP.sample(a, clock, d, defGap);
      moves.push(Math.abs(p.x - a.x));
      a.x = p.x; a.y = p.y;
    }
  }
  return { a, moves };
}

test('§19-B ① 등속 — 서버 간격 사이를 고르게 지난다 (프레임 간 흩어짐 25% 미만)', () => {
  const { IP, d } = boot();
  const { moves } = run(IP, d, { gap: 500, defGap: d.wildGapMs, steps: 12, speed: 1.5 });
  const tail = moves.slice(moves.length - 300);
  const mean = tail.reduce((x, y) => x + y, 0) / tail.length;
  assert.ok(mean > 0, '움직이기는 한다');
  const sd = Math.sqrt(tail.reduce((x, y) => x + (y - mean) ** 2, 0) / tail.length);
  assert.ok(sd / mean < 0.25, `프레임 간 이동량이 고르지 않다 — 흩어짐 ${(sd / mean * 100).toFixed(1)}%`);
});

test('§19-B ② 외삽 금지 — 좌표가 끊기면 받은 마지막 자리에 서서 기다린다', () => {
  const { IP, d } = boot();
  const { a } = run(IP, d, { gap: 500, defGap: d.wildGapMs, steps: 8, speed: 1.5 });
  let clock = 8 * 500;
  for (let f = 0; f < 600; f += 1) {
    clock += 16;
    const p = IP.sample(a, clock, d, d.wildGapMs);
    a.x = p.x; a.y = p.y;
  }
  assert.ok(a.x <= 8 * 1.5 + 0.01, `받은 마지막 좌표를 앞질렀다 (x=${a.x})`);
  assert.ok(a.x > 8 * 1.5 - 0.01, '받은 길을 다 걷지 못하고 멈췄다');
});

test('§19-B ③ 지연폭은 늘 간격보다 넓다 — 띠가 마르면 그것이 곧 「멈췄다 확 뛴다」', () => {
  const { IP, d } = boot();
  /* 아직 박자를 못 잰 놈(시작 직후·막 들어온 사람)의 기본값이 실제 간격보다 짧으면
     첫 몇 초 동안 매 스냅샷마다 얼어붙었다 뛴다 — 기본값은 실제 박자 이상이어야 한다. */
  const wildGap = data.creatures.sim.stepSeconds * 1000;
  assert.ok(d.wildGapMs >= wildGap,
    `짐승 기본 간격 ${d.wildGapMs}ms 가 서버 스텝 ${wildGap}ms 보다 짧다`);
  const fresh = IP.create(0, 0, 0, null);
  assert.ok(IP.delayOf(fresh, d, d.wildGapMs) > wildGap, '처음 본 짐승의 지연폭이 간격보다 좁다');
  assert.ok(IP.delayOf(fresh, d, d.mateGapMs) > d.mateGapMs, '처음 본 사람의 지연폭이 간격보다 좁다');
});

test('§19-B ④ 쉼은 박자가 아니다 — 오래 서 있어도 지연폭이 부풀지 않는다', () => {
  const { IP, d } = boot();
  const a = IP.create(0, 0, 0, null);
  IP.push(a, 1, 0, 900, 12, d, d.mateGapMs);
  IP.push(a, 2, 0, 1800, 12, d, d.mateGapMs);
  const before = IP.delayOf(a, d, d.mateGapMs);
  IP.push(a, 3, 0, 1800 + 20000, 12, d, d.mateGapMs);   // 20초를 서 있다가 다시 한 걸음
  assert.equal(IP.delayOf(a, d, d.mateGapMs), before, '서 있던 참을 박자로 잘못 배웠다');
});

test('§19-B ④-b 쉬었다 걷는 첫 걸음이 서 있던 참 전체로 늘어지지 않는다', () => {
  const { IP, d } = boot();
  const a = IP.create(0, 0, 0, null);
  IP.push(a, 1, 0, 900, 12, d, d.mateGapMs);
  IP.push(a, 2, 0, 1800, 12, d, d.mateGapMs);
  const t = 1800 + 20000;
  IP.push(a, 3, 0, t, 12, d, d.mateGapMs);
  /* 다시 걷기 시작한 자리는 「한 박자 전」에 다시 박힌다 — 마지막 두 장의 사이가 한 박자다 */
  const buf = a.buf;
  const span = buf[buf.length - 1].t - buf[buf.length - 2].t;
  assert.ok(span <= d.idleGapMs, `걸음 한 번이 ${Math.round(span)}ms 에 걸쳐 늘어진다`);
  assert.ok(span > 0, '차례가 뒤집혔다');
});

test('§19-B ④-c 쉬었다 걷는 첫 프레임에 껑충 뛰지 않는다 (봇·팀원의 순간이동)', () => {
  const { IP, d } = boot();
  /* 이것이 「봇·초대 유저가 막 순간이동한다」의 정체다. 봇과 사람은 서고 걷기를 되풀이하는데,
     옛 규칙은 「선 시각 → 다시 걷기 시작한 시각」을 한 구간으로 이었다. 그리는 시각은 이미
     그 구간의 9할을 지난 자리라, 다시 걷는 첫 프레임에 한 칸을 통째로 건너뛰었다. */
  const a = IP.create(0, 0, 0, null);
  IP.push(a, 1, 0, 1000, 12, d, d.mateGapMs);
  IP.push(a, 2, 0, 2000, 12, d, d.mateGapMs);
  let clock = 0;
  for (; clock < 22000; clock += 16) {
    const p = IP.sample(a, clock, d, d.mateGapMs);
    a.x = p.x; a.y = p.y;
  }
  const before = a.x;
  IP.push(a, 3, 0, clock, 12, d, d.mateGapMs);        // 20초를 서 있다가 다시 한 걸음
  const p = IP.sample(a, clock + 16, d, d.mateGapMs);
  assert.ok(Math.abs(p.x - before) < 0.2,
    `다시 걷는 첫 프레임에 ${(p.x - before).toFixed(2)}칸을 건너뛴다`);
});

test('§19-B ⑤ 스냅은 걸어서 못 갈 거리에서만 — 그 안이면 언제나 이어 걷는다', () => {
  const { IP, d } = boot();
  const a = IP.create(0, 0, 0, null);
  IP.push(a, 5, 0, 500, 12, d, d.wildGapMs);
  assert.equal(a.buf.length, 2, '11칸도 못 되는 거리에서 띠를 버렸다');
  IP.push(a, 90, 0, 1000, 12, d, d.wildGapMs);
  assert.equal(a.buf.length, 1, '걸어서 못 갈 거리인데 이어 걸으려 한다');
  assert.equal(a.x, 90, '스냅했으면 그리는 자리도 그 자리다');
});

test('§19-B ⑥ 수치는 자료가 쥐고 규격에 실려 간다 (render.interp)', () => {
  const { IP } = boot();
  const cfg = publicConfig();
  assert.ok(cfg.world.render, '/api/config 의 world 에 render 가 실리지 않는다');
  assert.deepEqual(cfg.world.render.interp, data.world.render.interp,
    '규격의 보간 다이얼이 자료와 다르다');
  for (const k of Object.keys(IP.FALLBACK)) {
    assert.equal(typeof data.world.render.interp[k], 'number',
      `data/world.json render.interp 에 ${k} 가 없다 (예비값만 남으면 자료가 죽은 다이얼이 된다)`);
  }
  /* 규격을 안 받은 자리(구경 모드)에서도 같은 값으로 돈다 */
  assert.deepEqual(IP.dials(null), IP.FALLBACK, '예비값이 자료와 갈라졌다');
  const live = IP.dials(data.world.render);
  for (const k of Object.keys(IP.FALLBACK)) {
    assert.equal(live[k], data.world.render.interp[k], `자료의 ${k} 가 예비값을 못 덮는다`);
  }
});

test('§19-B ⑦ 미래의 도착점 뒤에 줄을 세우지 않는다 — 도착점을 고쳐 쓴다', () => {
  const { IP, d } = boot();
  /* 하차 연출은 좌표를 **미래 시각**에 박아 둔다(마차 자리 → 제 자리 걸음).
     그 뒤에 진짜 좌표가 오면 옛 규칙은 차례를 지키려 now = last.t + 1 로 밀어 넣었다:
     1ms 짜리 구간은 한 프레임에 다 지나므로, 밀어 넣은 점들이 도착하는 순간 한꺼번에
     지나가 버렸다 — 「게임 시작 직후 봇이 막 순간이동한다」의 정체가 이것이다.
     게다가 그 1ms 를 박자로 배워 지연폭까지 최소로 무너뜨렸다(띠가 마른다). */
  const a = IP.create(0, 0, 0, null);
  a.buf.push({ x: 2, y: 0, t: 5000 });              // 미래 스탬프(하차 연출)
  IP.push(a, 2.1, 0, 1000, 12, d, d.mateGapMs);     // 그 뒤에 도착한 진짜 좌표
  assert.equal(a.buf.length, 2, '미래 도착점 뒤에 점을 밀어 넣었다');
  assert.equal(a.buf[1].x, 2.1, '도착점이 새 좌표로 고쳐지지 않았다');
  assert.equal(a.gapMs, null, '억지로 준 1ms 를 박자로 배웠다');
  assert.ok(IP.delayOf(a, d, d.mateGapMs) > d.minDelayMs,
    '지연폭이 최소로 무너졌다 — 띠가 마르면 그것이 곧 「멈췄다 확 뛴다」');
});

test('§19-B ⑧ 자리 보고 간격은 한 칸을 걷는 시간 이하다 (남의 화면에서 건너뛰지 않는다)', () => {
  const cfg = publicConfig();
  const ms = cfg.world.avatar.moveReportMs;
  assert.equal(typeof ms, 'number', '/api/config 에 avatar.moveReportMs 가 없다');
  assert.equal(ms, data.world.avatar.moveReportMs, '규격의 보고 간격이 자료와 다르다');
  /* 아바타 기본 걸음은 4.6칸/초(public/js/avatar.js speed) — 한 칸에 약 217ms 다.
     보고 간격이 그보다 길면 정수 칸 보고가 칸을 건너뛰고, 그만큼이 남의 화면에서 순간이동이 된다. */
  const perTileMs = 1000 / 4.6;
  assert.ok(ms <= perTileMs * 1.05, `보고 간격 ${ms}ms 가 한 칸 시간 ${Math.round(perTileMs)}ms 를 넘는다`);
});
