/* interp.js — 남이 쥔 좌표를 부드럽게 그리기 위한 **스냅샷 띠**(snapshot interpolation).
   ★ §19-B — 짐승(서버가 쥔다)과 함께 있는 사람·동료(서버가 중계한다)가 같은 규칙을 쓴다.
     규칙은 교과서 그대로다:
       ① 받은 좌표를 시각과 함께 띠에 쌓는다.
       ② 그리는 시각을 한 박자 뒤로 미룬다(지연 버퍼) — 다음 좌표가 이미 손에 있는 구간만 그린다.
       ③ 그 두 장 사이를 등속으로 지난다. 외삽하지 않는다(앞질렀다 되돌아오는 것이 가장 큰 끊김이다).
     수치는 코드가 아니라 data/world.json render.interp 가 쥔다 — 아래 FALLBACK 은 그 값이
     닿지 않는 자리(구경 모드·옛 세이브)를 위한 같은 값 한 벌이다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};

  var FALLBACK = {
    wildGapMs: 600, mateGapMs: 1000, battleGapMs: 320,
    leadFactor: 1.4, leadPadMs: 80, minDelayMs: 160, maxDelayMs: 2400,
    minGapMs: 60, idleGapMs: 1800, keep: 5,
    growPerMs: 0.45, shrinkPerMs: 0.06, clockMaxStepMs: 2000
  };

  var cache = { src: null, val: FALLBACK };

  /** data/world.json render.interp 를 예비값 위에 덮어 쓴 한 벌 — 판이 바뀔 때만 다시 빚는다. */
  function dials(render) {
    var src = (render && render.interp) || null;
    if (cache.src === src) return cache.val;
    var out = {};
    for (var k in FALLBACK) {
      if (!Object.prototype.hasOwnProperty.call(FALLBACK, k)) continue;
      out[k] = (src && typeof src[k] === 'number') ? src[k] : FALLBACK[k];
    }
    cache.src = src; cache.val = out;
    return out;
  }

  /** 띠 한 채 — 그리는 자리(x,y)와 받은 좌표들(buf), 그리고 배운 박자(gapMs). */
  function create(x, y, t, gapMs) {
    return { x: x, y: y, buf: [{ x: x, y: y, t: t }], gaps: [], gapMs: gapMs || null,
             delay: null, dClock: null };
  }

  /** 지연폭 — 배운 박자보다 넉넉히 뒤를 그려야 띠가 마르지 않는다. */
  function delayOf(a, d, defGap) {
    var g = (a && a.gapMs) || defGap || d.mateGapMs;
    return Math.min(d.maxDelayMs, Math.max(d.minDelayMs, g * d.leadFactor + d.leadPadMs));
  }

  /** 박자 한 장을 배운다. ★ 멈춰 서 있던 참(idleGapMs 초과)은 박자가 아니라 **쉼**이라 세지 않는다 —
      세면 지연폭이 쉰 만큼 부풀어, 다시 걷기 시작한 놈이 몇 초 뒤처져 보인다.
      ★ minGapMs 아래도 박자가 아니다: 같은 한 걸음이 두 채널로 겹쳐 오거나(worldDiff 와 creatures 가
      같은 순간에 온다), 미래 스탬프(하차 연출) 뒤에 차례를 지키려 억지로 1ms 를 준 자리다.
      그것을 박자로 배우면 지연폭이 최소(minDelayMs)로 무너져 매 스냅샷마다 얼어붙었다 뛴다
      — 「게임 시작 직후 봇이 막 순간이동한다」의 정체가 이것이었다. */
  function learnGap(a, gap, d) {
    if (!(gap >= d.minGapMs) || gap > d.idleGapMs) return;
    a.gaps.push(gap);
    if (a.gaps.length > 3) a.gaps.shift();
    a.gapMs = Math.max.apply(null, a.gaps);
  }

  /** 쉬었다 다시 걷는 놈의 출발점을 **한 박자 앞**에 다시 박는다.
      안 그러면 서 있던 참 전체(수 초)에 두 점을 이어, 두 칸 걸음이 몇 초짜리 미끄러짐이 된다. */
  function reanchor(a, last, now, gap, d, defGap) {
    if (gap <= d.idleGapMs) return;
    a.buf.push({ x: last.x, y: last.y, t: now - ((a.gapMs || defGap || d.mateGapMs)) });
  }

  /** 걸어서는 못 갈 거리 — 같은 놈이 걸어간 것으로 볼 수 없다. 그때만 스냅한다. */
  function snapTo(a, x, y, now) {
    a.buf = [{ x: x, y: y, t: now }];
    a.x = x; a.y = y;
  }

  /** 아직 닿지 않은 **미래의 도착점**(하차 연출)이 줄 끝에 남아 있다 — 새 좌표는 그 뒤에 서지 않고
      도착점을 고쳐 쓴다. 차례를 지키려 1ms 씩 뒤에 밀어 넣으면, 밀어 넣은 점들이 도착하는 순간
      한꺼번에 지나가 버린다(1ms 짜리 구간은 한 프레임에 다 지난다) — 그것이 곧 순간이동이다. */
  function amend(a, last, x, y, now, snapDist) {
    if (Math.hypot(x - last.x, y - last.y) > snapDist) { snapTo(a, x, y, now); return; }
    last.x = x; last.y = y;
  }

  /** 띠에 좌표 한 장을 얹는다 — 박자를 배우고, 쉼을 가르고, 못 갈 거리는 스냅한다. */
  function push(a, x, y, now, snapDist, d, defGap) {
    var last = a.buf[a.buf.length - 1];
    if (last && now <= last.t) { amend(a, last, x, y, now, snapDist); return; }
    if (last) {
      if (last.x === x && last.y === y && now - last.t < 1) return;
      var gap = now - last.t;
      learnGap(a, gap, d);
      reanchor(a, last, now, gap, d, defGap);
      if (Math.hypot(x - last.x, y - last.y) > snapDist) { snapTo(a, x, y, now); return; }
    }
    a.buf.push({ x: x, y: y, t: now });
    while (a.buf.length > d.keep) a.buf.shift();   // 쉼을 가르며 한 장이 더 늘 수 있다
  }

  /** 그릴 시각 = 시계 − 지연폭. ★ 지연폭은 한 번에 움직이지 않는다 — 박자를 새로 배울 때마다
      툭 바뀌면 그 순간 화면이 한 발 건너뛴다. 늘 때는 빠르게, 줄 때는 천천히 미끄러뜨린다. */
  function renderAt(a, clock, d, defGap) {
    var target = delayOf(a, d, defGap);
    if (a.delay == null) a.delay = target;
    else {
      var el = a.dClock == null ? 0 : clock - a.dClock;
      var diff = target - a.delay;
      var step = diff > 0 ? Math.max(2, el * d.growPerMs) : Math.max(0.5, el * d.shrinkPerMs);
      a.delay += Math.max(-step, Math.min(step, diff));
    }
    a.dClock = clock;
    return clock - a.delay;
  }

  /** 띠에서 그릴 자리를 읽는다 — render 시각을 품는 두 장 사이의 등속점. 외삽하지 않는다. */
  function at(a, render) {
    var b = a.buf;
    if (!b.length) return { x: a.x, y: a.y };
    if (render <= b[0].t) return { x: b[0].x, y: b[0].y };
    for (var i = b.length - 1; i >= 0; i--) {
      if (b[i].t > render) continue;
      var p = b[i], q = b[i + 1];
      if (!q) return { x: p.x, y: p.y };                    // 띠의 끝 — 멈춰 기다린다
      var k = Math.max(0, Math.min(1, (render - p.t) / Math.max(1, q.t - p.t)));
      return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
    }
    return { x: b[0].x, y: b[0].y };
  }

  /** 지금 그릴 자리 한 번에 — 지연폭을 미끄러뜨리고 그 시각의 등속점을 준다. */
  function sample(a, clock, d, defGap) {
    return at(a, renderAt(a, clock, d, defGap));
  }

  GM.interp = {
    FALLBACK: FALLBACK, dials: dials, create: create, push: push,
    delayOf: delayOf, renderAt: renderAt, at: at, sample: sample
  };
})(window);
