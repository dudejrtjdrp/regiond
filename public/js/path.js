/* path.js — 화면 쪽 길찾기 (Sprint 1).
   「자동이동이 물 앞에서 제자리 걸음」의 정공 해법: 직진+한 번 미끄러짐(docs/QUESTIONS.md Q-qa-4)을
   경계 제한 A* 로 바꾼다. 서버 server/engine/path.js 와 같은 규칙·같은 성질이다:
     · 8방향, 모서리 끊어 걷기 금지(양옆이 다 뚫려야 대각선)
     · 시작·목표 상자 + pad 만 뒤진다(맵 384² 전체를 뒤지지 않는다 — 프레임 예산)
     · 목표가 물이면 곁의 뭍으로 스냅, 끝내 못 닿으면 **가장 가까이 간 곳까지** 돌려준다
   길은 목적지가 바뀔 때 한 번만 계산한다 — 프레임마다 다시 찾지 않는다(성능 계약).
   통행 판정(walkable)은 호출자가 넣는다: 아바타·주민 모두 「사람」 규칙(지형 + 다리·매립)이다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};

  var SQRT2 = Math.SQRT2;

  /* ══════════ ★ Sprint 3 — 뒤진 자국을 담는 그릇 ══════════
     옛 셈은 g·from 을 그냥 객체({})에 담았다. 칸 하나를 적을 때마다 숨은 표(hidden class)가
     자라고, 4천 칸을 뒤지면 그 객체는 프레임이 끝나자마자 통째로 버려질 쓰레기가 된다.
     한 번 상태를 밀 때 주민 예순이 길을 내면 그 쓰레기가 프레임을 끊는다.

     그래서 **칸 번호로 바로 찍는 띠**(TypedArray)로 바꾼다. 창(window)의 넓이만큼만 잡고
     모듈에 얹어 두어 되쓴다 — 매번 새로 잡으면 띠가 곧 새 쓰레기가 되기 때문이다.
     되쓰려면 「지난 번 자국」을 지워야 하는데, 14만 칸을 매번 0으로 미는 대신
     **세대 도장**(stampArr === gen)을 찍는다: 도장이 이번 세대가 아니면 빈 칸이다.
     셈·순서·결과는 옛것과 **글자 그대로 같다**(seq 로 잡던 동점 처리도 그대로 둔다).

     계약: walkable 은 조회만 하는 판이어야 한다(그 안에서 다시 find 를 부르면 띠가 겹친다).
     지금 부르는 곳(world.unitWalkable · avatar 의 사람 판정)은 모두 조회뿐이다. */
  var scratchN = 0, gArr = null, fromArr = null, stampArr = null, gen = 0;
  function ensureScratch(n) {
    if (scratchN >= n) return;
    gArr = new Float64Array(n);
    fromArr = new Int32Array(n);
    stampArr = new Int32Array(n);   // 갓 잡은 띠는 0 — 아래에서 gen 을 1부터 올린다
    scratchN = n;
    gen = 0;
  }

  /**
   * @param sx,sy 시작(월드 좌표 — 반올림해 칸으로 쓴다)
   * @param tx,ty 목표
   * @param walkable function(x, y) → boolean
   * @param opts {pad, maxNodes, snapR, size}
   * @returns Array<{x,y}> 시작 칸 포함 웨이포인트 | null(한 칸도 못 간다)
   */
  function find(sx, sy, tx, ty, walkable, opts) {
    opts = opts || {};
    var pad = opts.pad || 16;
    var maxNodes = opts.maxNodes || 4000;
    var size = opts.size || (GM.state && GM.state.mapSize && GM.state.mapSize()) || 512;
    /* ★ Sprint 3 — 시작 칸을 지도 안으로 물린다. 「왜」 이제 와서 —
       옛 셈은 자국을 객체에 담아서 칸 번호가 음수여도 그냥 적혔지만, 띠(TypedArray)는
       음수 자리를 **소리 없이 버린다**. 그러면 시작 칸의 값이 사라져 셈이 NaN 으로 번진다.
       지도 밖에 선 몸은 원래 있을 수 없는 자리이므로(좌표는 서버가 죈다) 안으로 물리는 것이
       옳고, 지도 안의 보통 경우에는 이 줄이 아무것도 바꾸지 않는다. */
    var st = { x: Math.max(0, Math.min(size - 1, Math.round(sx))),
               y: Math.max(0, Math.min(size - 1, Math.round(sy))) };
    var gx = Math.round(tx), gy = Math.round(ty);

    /* 목표가 설 수 없는 칸(물을 찍었다)이면 곁의 뭍으로 갈아 끼운다 */
    if (!walkable(gx, gy)) {
      var near = nearest(gx, gy, walkable, opts.snapR || 6);
      if (near) { gx = near.x; gy = near.y; }
    }
    if (st.x === gx && st.y === gy) return [{ x: st.x, y: st.y }];

    var x0 = Math.max(0, Math.min(st.x, gx) - pad);
    var y0 = Math.max(0, Math.min(st.y, gy) - pad);
    var x1 = Math.min(size - 1, Math.max(st.x, gx) + pad);
    var y1 = Math.min(size - 1, Math.max(st.y, gy) + pad);
    var w = x1 - x0 + 1;
    var hgt = y1 - y0 + 1;

    /* ★ Sprint 3 — 이번 창(w×hgt)만큼 띠를 마련하고 세대 도장을 하나 올린다 */
    ensureScratch(w * hgt);
    gen += 1;
    if (gen >= 2147483647) { stampArr.fill(0); gen = 1; }   // 도장 자리가 넘치면 한 번만 민다
    var g = gArr, from = fromArr, stamp = stampArr, mark = gen;

    var heap = [];
    var seq = 0;

    function key(x, y) { return (y - y0) * w + (x - x0); }
    function cmp(a, b) { return (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]); }
    function push(f, h, x, y) {
      heap.push([f, h, seq++, x, y]);
      var i = heap.length - 1;
      while (i > 0) {
        var p = (i - 1) >> 1;
        if (cmp(heap[i], heap[p]) >= 0) break;
        var t0 = heap[i]; heap[i] = heap[p]; heap[p] = t0;
        i = p;
      }
    }
    function pop() {
      var top = heap[0];
      var last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        var i = 0;
        for (;;) {
          var l = i * 2 + 1, r = l + 1, m = i;
          if (l < heap.length && cmp(heap[l], heap[m]) < 0) m = l;
          if (r < heap.length && cmp(heap[r], heap[m]) < 0) m = r;
          if (m === i) break;
          var t1 = heap[i]; heap[i] = heap[m]; heap[m] = t1;
          i = m;
        }
      }
      return top;
    }
    function oct(x, y) {
      var dx = Math.abs(x - gx), dy = Math.abs(y - gy);
      return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy);
    }
    /* 시작 칸은 무조건 지난다 — 어쩌다 물 위에 선 몸(옛 저장 등)도 뭍으로 걸어 나올 수 있어야 한다 */
    function walk(x, y) {
      if (x < x0 || x > x1 || y < y0 || y > y1) return false;
      if (x === st.x && y === st.y) return true;
      return walkable(x, y);
    }

    var startK = key(st.x, st.y);
    g[startK] = 0; stamp[startK] = mark;
    from[startK] = -1;                    // ★ Sprint 3 — 되짚기의 끝 표시(-1 = 없음)
    push(oct(st.x, st.y), oct(st.x, st.y), st.x, st.y);
    var best = { x: st.x, y: st.y, h: oct(st.x, st.y) };
    var expanded = 0;

    while (heap.length && expanded < maxNodes) {
      var top = pop();
      var h = top[1], cx = top[3], cy = top[4];
      expanded += 1;
      if (cx === gx && cy === gy) { best = { x: cx, y: cy, h: 0 }; break; }
      if (h < best.h) best = { x: cx, y: cy, h: h };
      var cg = g[key(cx, cy)];
      for (var dy = -1; dy <= 1; dy += 1) {
        for (var dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          var nx = cx + dx, ny = cy + dy;
          if (!walk(nx, ny)) continue;
          if (dx && dy && (!walk(cx + dx, cy) || !walk(cx, cy + dy))) continue;
          var nk = key(nx, ny);
          var ng = cg + (dx && dy ? SQRT2 : 1);
          /* ★ Sprint 3 — 「적힌 적 있는가」를 세대 도장으로 본다(옛 g[nk] != null 과 같은 뜻) */
          if (stamp[nk] === mark && ng >= g[nk]) continue;
          g[nk] = ng; stamp[nk] = mark;
          from[nk] = key(cx, cy);
          var nh = oct(nx, ny);
          push(ng + nh, nh, nx, ny);
        }
      }
    }

    var out = [];
    var cur = key(best.x, best.y);
    /* ★ Sprint 3 — 되짚기는 -1(끝)에서 멈춘다. 도장까지 견주는 것은 지난 세대의 자국을
       실수로 따라가지 않기 위한 빗장이다(정상 사슬에서는 옛 셈과 한 걸음도 다르지 않다). */
    while (cur >= 0 && stamp[cur] === mark) {
      out.push({ x: (cur % w) + x0, y: Math.floor(cur / w) + y0 });
      if (cur === startK) break;
      cur = from[cur];
    }
    out.reverse();
    if (out.length < 2) return null;
    return smooth(out, walkable);
  }

  /** 가장 가까운 설 수 있는 칸 — 고리 탐색 */
  function nearest(cx, cy, walkable, maxR) {
    if (walkable(cx, cy)) return { x: cx, y: cy };
    for (var r = 1; r <= maxR; r += 1) {
      for (var dy = -r; dy <= r; dy += 1) {
        for (var dx = -r; dx <= r; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (walkable(cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
        }
      }
    }
    return null;
  }

  /** 줄 당기기 — 사이가 훤히 뚫린 웨이포인트는 접는다(격자 계단 걸음이 직선이 된다) */
  function smooth(path, walkable) {
    if (path.length <= 2) return path;
    var out = [path[0]];
    var anchor = 0;
    for (var i = 2; i < path.length; i += 1) {
      if (!lineClear(path[anchor], path[i], walkable)) {
        out.push(path[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(path[path.length - 1]);
    return out;
  }

  /** 두 칸 사이를 0.33칸 간격으로 밟아 본다 — 전부 설 수 있어야 잇는다 */
  function lineClear(a, b, walkable) {
    var d = Math.hypot(b.x - a.x, b.y - a.y);
    var n = Math.max(1, Math.ceil(d * 3));
    for (var i = 1; i < n; i += 1) {
      var t = i / n;
      if (!walkable(Math.round(a.x + (b.x - a.x) * t), Math.round(a.y + (b.y - a.y) * t))) return false;
    }
    return true;
  }

  GM.path = { find: find, nearest: nearest };
})(window);
