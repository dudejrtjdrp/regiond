/* world.js — 오픈월드 렌더러. 단일 캔버스에 지형·안개·자원·주민·건물·울타리·아바타·전투를 그린다.
   보이는 청크만 그리고, 지형 도트는 청크 캔버스에 한 번 구워 두었다가 확대해 쓴다.
   ★ 서버가 준 것만 그린다 — 안개 밖의 것은 페이로드에 아예 없다.
   ★ 안개는 서버 확정본과 클라 예측(아바타 둘레)을 겹쳐 본다 (GDD3 §8).
   ★ 이펙트는 GM.fx 가 쥐고 있고, 여기서는 순서만 맞춰 불러 준다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var cv = null, ctx = null;
  var W = 960, H = 540;
  var chunkCache = {};
  var chunkOrder = [];       // ★ §17-17 — 구운 순서(가장 오래된 것부터 버린다). 아래 CHUNK_CAP 참고.
  var CH = 16;
  var BASE = 16;
  /* ★ §17-17 — 구워 둔 지형 청크의 상한. 지도가 384² 가 되며 청크가 256 → 576 장으로 늘었고,
     한 장이 256×256 픽셀이라 지도를 다 밟으면 캐시만 150MB 를 넘는다(옛 지도는 67MB 였다).
     화면에 한 번에 드는 청크는 아무리 넓혀도 스무 장 남짓이라, 넉넉히 이만큼만 들고 있으면
     되돌아가는 걸음에도 다시 굽는 일이 거의 없다 — 한 장 굽는 값은 1ms 안쪽이다. */
  var CHUNK_CAP = 192;

  /* ══════════ ★ 청크 굽기를 여러 프레임에 나눠 담는다 ══════════
     「왜」 — 한 장을 굽는 값이 **1ms 가 아니다**. 위 주석의 1ms 는 지형 조각(terrainBlob)이
     이미 곳간에 있을 때의 값이고, **처음 밟는 땅**에서는 256칸이 전부 곳간 밖이다.
     조각 한 장은 캔버스를 새로 잡고 베지에 여덟 획으로 경계를 오려 붙인다 —
     실측 0.35ms(느린 기계) 이고, 256칸이면 청크 한 장이 **70~140ms** 다.
     걸어서 청크 경계를 넘으면 그런 장이 한 프레임에 두세 장씩 구워졌다:
     이것이 「돌아다니면 특정 주기로 한 번씩 끊긴다」의 정체다(주기 = 청크 16칸을 걷는 시간).

     고치는 법은 셋이고, 그림은 한 점도 바뀌지 않는다:
       ① 굽기를 **줄 단위**로 쪼개 한 프레임에 BAKE_BUDGET_MS 만큼만 굽는다
       ② 다 구워지기 전에는 그 자리에 **지형 바탕색**을 깔아 둔다(축소 지도와 같은 색이라 위화감이 없다)
       ③ 화면 밖 한 겹(PREBAKE_RING)을 미리 구워 둔다 — 걸음이 닿기 훨씬 전에 끝나므로
          ②의 밋밋한 한때는 사실상 눈에 띄지 않는다(처음 접속한 그 순간만 스친다). */
  var BAKE_BUDGET_MS = 4;    // 한 프레임에 굽기에 내주는 시간(16.7ms 예산의 1/4)
  var BAKE_URGENT_MS = 9;    // 지금 화면에 밋밋한 자리가 있으면 그만큼 더 낸다(처음 접속·순간이동)
  var PREBAKE_RING = 1;      // 화면 밖으로 몇 겹을 미리 구울까
  var PREBAKE_NEW_PER_FRAME = 2;   // 그 겹에서 한 프레임에 새로 잡을 장 수
  var chunkPending = {};     // key → {c, g, cx, cy, row}
  var bakeQueue = [];        // 구울 차례 (앞이 급한 것 — 보이는 청크가 먼저)
  var visiblePending = 0;    // 이번 판에 화면에 든 청크 중 아직 다 안 구워진 수
  var FLAT_COLOR = {};       // 지형 코드 → 바탕색 (②의 색)

  function flatColorOf(code) {
    var c = FLAT_COLOR[code];
    if (c) return c;
    var meta = S.terrainMeta && S.terrainMeta(code);
    c = (meta && meta.color) || '#7d9b4e';
    FLAT_COLOR[code] = c;
    return c;
  }

  function dropChunks() {
    chunkCache = {}; chunkOrder = []; chunkPending = {}; bakeQueue = [];
  }

  var units = {};            // 주민 걷기 연출 (클라 권위)
  var walkIns = [];          // ★ §13-A-4 막 도착한 주민의 이름표 {id,name,t} — 몸이 아니라 표시다
  var lastT = 0, animT = 0;
  var hoverTile = { x: -1, y: -1 };
  var dragBox = null;
  var fencePath = null;      // 울타리 드래그 중인 꺾은선
  var territoryAnim = null;  // {from, to, t}
  var stakePhase = 0;
  var frameTimes = [];       // 프레임 간격 (스모크가 읽는다)
  var workTimes = [];        // 한 프레임을 그리는 데 든 시간 — 60fps 예산(16.7ms) 대비 여유

  /* ══════════ ★ Sprint 3 — 어디에 시간이 갔는가 ══════════
     「무엇을 고쳤나」를 말로 다투지 않으려고 세 자리만 따로 잰다:
       nodes  — 자원 자리 그리기(늦은 판에 목록이 3천까지 자란다)
       minimap— 축소 지도 한 판
       path   — 주민 길찾기(A*)에 든 시간과 **횟수**. 한 프레임에 몰리면 그때 화면이 멎는다.
     재는 값은 performance.now() 한 쌍뿐이라 재는 일 자체가 예산을 먹지 않는다. */
  var nodesTimes = [], minimapTimes = [], pathTimes = [], pathCallTimes = [];
  var nodesMs = 0, minimapMs = 0, pathMs = 0, pathCalls = 0;
  function nowMs() { return (global.performance && performance.now) ? performance.now() : Date.now(); }

  /* ★ Sprint 3 — 프레임 예산 다이얼(data/world.json render.perf). 자료가 없는 자리
     (구경 모드·하니스)에서도 그림이 멎지 않게 옛 성질 그대로의 예비값을 든다. */
  /* ★ Sprint 3 — 되쓰는 점 하나. 화면 좌표를 담을 그릇이 필요할 뿐인 자리에서
     프레임마다 {x,y} 를 새로 낳지 않는다(값은 옛것과 같다). 쓰고 곧 버리는 자리에만 쓴다. */
  var P2 = { x: 0, y: 0 };

  /** ★ Sprint 3 — 화면(픽셀) 밖인가. 걸러 낼 것을 걸러 내야 명령이 안 쌓인다. */
  function offScreen(px, py, m) { return px < -m || py < -m || px > W + m || py > H + m; }

  var PERF_FALLBACK = { pathFindsPerFrame: 2, minimapHz: 8 };
  function perfCfg() {
    var w = S.worldCfg();
    return (w && w.render && w.render.perf) || PERF_FALLBACK;
  }

  /* ══════════ ★ Sprint 3 — 그라데이션 곳간 ══════════
     「왜」 — createRadialGradient 은 부를 때마다 브라우저 안에서 색 띠 하나를 새로 굽는다.
     군락 바닥·광장·밤 등불은 **프레임마다** 그것을 수십 개씩 구워 버렸다(등불만 최대 18개).
     띠는 자리(중심)를 품으므로 그대로는 되쓸 수 없다 — 그래서 원점(0,0)에 굽고 그릴 때
     ctx.translate 로 자리를 옮긴다. 옮겨 그린 그림은 제자리에 구운 것과 **같다**.
     열쇠에 반지름을 그대로 넣는 까닭: 줌이 멎어 있으면 반지름이 몇 값뿐이라 거의 다 맞고,
     줌이 도는 몇 프레임만 새로 굽는다(상한을 넘으면 통째로 비운다 — 곳간이 새지 않는다). */
  /* 상한 — 줌이 멎어 있을 때 실제로 도는 열쇠는 쉰 남짓이다(등불의 흔들리는 반지름이 대부분이라
     넉넉히 잡는다). 넘치면 통째로 비우고 다시 채운다 — 몇 프레임의 값으로 곳간이 새는 것을 막는다. */
  var GRAD_CAP = 256;
  var gradCache = {}, gradCount = 0;
  function radialAt0(key, inner, outer, stops) {
    var g = gradCache[key];
    if (g !== undefined) return g;
    if (gradCount >= GRAD_CAP) { gradCache = {}; gradCount = 0; }
    try {
      g = ctx.createRadialGradient(0, 0, inner, 0, 0, outer);
      for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    } catch (e) { g = null; }
    gradCache[key] = g; gradCount += 1;
    return g;
  }
  /* 세로 하늘 띠 — 색은 구간이 바뀔 때만 갈리므로 열쇠가 곧 그 색이다(값이 같으면 같은 띠다) */
  var skyGrad = { key: '', g: null };
  function dropGradients() { gradCache = {}; gradCount = 0; skyGrad = { key: '', g: null }; }

  /* ══════════ 마운트 ══════════ */
  function mount() {
    cv = U.qs('#world-canvas');
    if (!cv) return;
    resize();
    S.on('world', function () { dropChunks(); units = {}; recenter(); });
    global.addEventListener('gm:terrain-assets-ready', function () { dropChunks(); });
  }

  function recenter() {
    var t = S.myTown();
    if (t) GM.camera.reset(t.x, t.y);
    else GM.camera.reset();
  }

  function resize() {
    if (!cv) return;
    var host = U.qs('#stage');
    var r = host ? host.getBoundingClientRect() : { width: 960, height: 540 };
    W = Math.max(320, Math.round(r.width || 960));
    H = Math.max(240, Math.round(r.height || 540));
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    ctx = U.fitCanvas(cv, W, H);
    dropGradients();          /* ★ Sprint 3 — 캔버스가 다시 잡히면 구워 둔 띠도 버린다 */
    GM.camera.setViewport(W, H);
  }

  /* ══════════ 지형 청크 ══════════ */
  /* 두 바이옴의 경계는 선으로 긋지 않는다. 이웃 지형을 2~4px의 들쭉날쭉한
     마스크로 현재 칸 안에 살짝 침범시켜, 레퍼런스처럼 풀·흙이 서로 물린다. */
  function blendTerrainEdge(g, x, y, wx, wy, code, other, vertical) {
    if (code === other) return;
    var sprite = GM.atlas.terrain(other, GM.atlas.variantAt(wx + (vertical ? 1 : 0), wy + (vertical ? 0 : 1), 3));
    var seed = ((wx * 92821) ^ (wy * 68917) ^ (vertical ? 71 : 37)) >>> 0;
    /* 폭이 한 번에 튀지 않도록 저주파 곡선으로 바꾼다. 1px마다 찍어도
       실루엣은 부드러운 둥근 가장자리, 확대하면 픽셀 결로 읽힌다. */
    function depth(i) {
      var wave = Math.sin((i + (seed & 15)) * 0.58) * 1.25 + Math.sin((i + (seed >>> 5)) * 0.22) * 1.1;
      return Math.max(3, Math.min(7, Math.round(5 + wave)));
    }
    g.save();
    g.beginPath();
    if (vertical) {
      g.moveTo(x + BASE, y);
      for (var yy = 0; yy <= BASE; yy += 1) g.lineTo(x + BASE - depth(yy), y + yy);
      g.lineTo(x + BASE, y + BASE);
    } else {
      g.moveTo(x, y + BASE);
      for (var xx = 0; xx <= BASE; xx += 1) g.lineTo(x + xx, y + BASE - depth(xx));
      g.lineTo(x + BASE, y + BASE);
    }
    g.closePath();
    g.clip();
    try { g.drawImage(sprite, x, y, BASE, BASE); } catch (e) {}
    g.restore();
  }

  /* 8방향 동일 지형 마스크. 47-blob의 기본 키이며, 변환 타일을 별도 파일로
     늘리지 않아도 외곽·내각·모서리의 조합을 청크별로 결정할 수 있다. */
  function terrainMask(m, codes, wx, wy, code) {
    var bits = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8], [1, -1, 16], [1, 1, 32], [-1, 1, 64], [-1, -1, 128]];
    var mask = 0;
    for (var i = 0; i < bits.length; i += 1) {
      var nx = wx + bits[i][0], ny = wy + bits[i][1];
      if (nx >= 0 && ny >= 0 && nx < m.size && ny < m.size && codes[m.terrain[ny * m.size + nx]] === code) mask |= bits[i][2];
    }
    return mask;
  }

  function terrainBackdrop(m, codes, wx, wy, code) {
    /* A single blob can only reveal one backing terrain correctly.  At a
       three-way junction, choosing the "most common" neighbour leaks water
       into an unrelated land-to-land edge.  Blend only unambiguous cardinal
       borders; the junction itself remains its real terrain tile. */
    var dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    var backdrop = null;
    for (var i = 0; i < dirs.length; i += 1) {
      var nx = wx + dirs[i][0], ny = wy + dirs[i][1];
      if (nx < 0 || ny < 0 || nx >= m.size || ny >= m.size) continue;
      var other = codes[m.terrain[ny * m.size + nx]] || code;
      if (other === code) continue;
      if (backdrop && backdrop !== other) return code;
      backdrop = other;
    }
    return backdrop || code;
  }

  /** 한 줄(16칸)을 진짜 도트로 굽는다 — 다 구웠으면 true */
  function bakeRow(p) {
    var m = S.S.map;
    if (!m) return true;
    var codes = m.codes;
    var y = p.row;
    for (var x = 0; x < CH; x++) {
      var wx = p.cx * CH + x, wy = p.cy * CH + y;
      if (wx >= m.size || wy >= m.size) continue;
      var code = codes[m.terrain[wy * m.size + wx]] || 'grass';
      var mask = terrainMask(m, codes, wx, wy, code);
      /* 47-blob 마스크도 변주 seed에 넣어, 같은 지형의 외곽/내각이 같은
         결로 반복되지 않도록 한다. */
      var v = (GM.atlas.variantAt(wx, wy, 4) + (mask & 3)) % 4;
      var backdrop = terrainBackdrop(m, codes, wx, wy, code);
      try { p.g.drawImage(GM.atlas.terrainBlob(code, backdrop, mask, v, wx, wy), x * BASE, y * BASE); } catch (e) {}
    }
    p.row += 1;
    return p.row >= CH;
  }

  /** ★ 다 구워지기 전의 한때 — 지형 바탕색을 깔아 둔다(축소 지도와 같은 색). 줄 단위로 묶어 칠한다. */
  function prefillChunk(p, m) {
    var codes = m.codes;
    var g = p.g;
    for (var y = 0; y < CH; y++) {
      var runStart = 0, runCol = null;
      for (var x = 0; x <= CH; x++) {
        var col = null;
        if (x < CH) {
          var wx = p.cx * CH + x, wy = p.cy * CH + y;
          if (wx < m.size && wy < m.size) col = flatColorOf(codes[m.terrain[wy * m.size + wx]] || 'grass');
        }
        if (col === runCol) continue;
        if (runCol) { g.fillStyle = runCol; g.fillRect(runStart * BASE, y * BASE, (x - runStart) * BASE, BASE); }
        runStart = x; runCol = col;
      }
    }
  }

  /**
   * 청크 한 장을 **얻는다**(굽기를 기다리지 않는다).
   * @param urgent 지금 화면에 드는 자리인가 — 그렇다면 굽는 줄에 새치기한다.
   */
  function chunkCanvas(cx, cy, urgent) {
    var key = cx + ',' + cy;
    var hit = chunkCache[key];
    if (hit) { touchChunk(key); return hit; }
    var p = chunkPending[key];
    if (p) {
      if (urgent && bakeQueue[0] !== key) {
        var at = bakeQueue.indexOf(key);
        if (at > 0) { bakeQueue.splice(at, 1); bakeQueue.unshift(key); }
      }
      return p.c;
    }
    var m = S.S.map;
    if (!m) return null;
    var c = document.createElement('canvas');
    c.width = CH * BASE; c.height = CH * BASE;
    var g = c.getContext('2d');
    if (!g) return null;
    g.imageSmoothingEnabled = false;
    p = { c: c, g: g, cx: cx, cy: cy, row: 0 };
    prefillChunk(p, m);
    chunkPending[key] = p;
    if (urgent) bakeQueue.unshift(key); else bakeQueue.push(key);
    return c;
  }

  /** 한 프레임의 굽기 몫. 시간이 남으면 다음 장으로 넘어간다(줄 하나가 최소 단위다). */
  function bakeStep(budgetMs) {
    if (!bakeQueue.length) return;
    var t0 = nowMs();
    do {
      var key = bakeQueue[0];
      var p = chunkPending[key];
      if (!p) { bakeQueue.shift(); continue; }
      if (bakeRow(p)) {
        delete chunkPending[key];
        bakeQueue.shift();
        chunkCache[key] = p.c;
        chunkOrder.push(key);
        if (chunkOrder.length > CHUNK_CAP) evictChunk();
      }
    } while (bakeQueue.length && nowMs() - t0 < budgetMs);
  }

  /** 화면 밖 한 겹을 미리 굽는 줄에 세운다 — 걸음이 닿기 전에 끝나라고.
      한 프레임에 새로 잡는 장 수를 묶어 둔다: 카메라가 멀리 뛰면 스물다섯 장이 한 번에 서고,
      그 자리 잡기(캔버스 + 바탕색)만으로도 한 프레임이 부푼다. 급할 것 없는 겹이다. */
  function queuePrebake(cx0, cx1, cy0, cy1) {
    if (bakeQueue.length > 24) return;              // 이미 밀려 있으면 더 얹지 않는다
    var m = S.S.map;
    if (!m) return;
    var per = Math.ceil(m.size / CH);
    var room = PREBAKE_NEW_PER_FRAME;
    for (var cy = cy0 - PREBAKE_RING; cy <= cy1 + PREBAKE_RING; cy++) {
      for (var cx = cx0 - PREBAKE_RING; cx <= cx1 + PREBAKE_RING; cx++) {
        if (cx < 0 || cy < 0 || cx >= per || cy >= per) continue;
        if (cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1) continue;   // 보이는 자리는 이미 섰다
        var key = cx + ',' + cy;
        if (chunkCache[key] || chunkPending[key]) continue;
        if (room-- <= 0) return;
        chunkCanvas(cx, cy, false);
      }
    }
  }

  /** ★ 최근에 쓴 것을 뒤로 — 눈앞의 청크가 상한에 밀려 버려지지 않게 한다(옛 셈은 구운 순서였다). */
  function touchChunk(key) {
    var i = chunkOrder.indexOf(key);
    if (i >= 0 && i < chunkOrder.length - 1) { chunkOrder.splice(i, 1); chunkOrder.push(key); }
  }

  /** ★ §17-17 — 가장 오래 전에 쓴 청크 한 장을 버린다(상한 초과분만). */
  function evictChunk() {
    var old = chunkOrder.shift();
    if (old != null) delete chunkCache[old];
  }

  function drawTerrain() {
    var m = S.S.map;
    if (!m) return;
    var cam = GM.camera.cam;
    var vis = GM.camera.visible();
    var cx0 = Math.floor(vis.x0 / CH), cx1 = Math.floor(vis.x1 / CH);
    var cy0 = Math.floor(vis.y0 / CH), cy1 = Math.floor(vis.y1 / CH);
    var scale = cam.tile / BASE;
    visiblePending = 0;
    for (var cy = cy0; cy <= cy1; cy++) {
      for (var cx = cx0; cx <= cx1; cx++) {
        var c = chunkCanvas(cx, cy, true);
        if (!c) continue;
        if (chunkPending[cx + ',' + cy]) visiblePending += 1;
        var p = GM.camera.worldToScreen(cx * CH - 0.5, cy * CH - 0.5);
        try {
          ctx.drawImage(c, Math.round(p.x), Math.round(p.y),
            Math.ceil(CH * BASE * scale), Math.ceil(CH * BASE * scale));
        } catch (e) {}
      }
    }
    /* ★ 보이는 자리를 다 세운 뒤에 화면 밖 한 겹을 세운다(급한 것이 줄 앞에 서게) */
    queuePrebake(cx0, cx1, cy0, cy1);
  }

  /* ══════════ 자원 군락 바닥 (GDD3 §13-B-1) ══════════
     군락은 '노드 여럿'이 아니라 **지역**이다. 그 지역이 지역으로 읽히려면 발밑이 달라야 한다 —
     숲 군락은 짙은 이끼, 딸기 들은 붉은 기, 바위 지대는 잿빛 자갈, 강가 어장은 젖은 모래.
     지형 청크를 다시 굽지 않고 반투명 원을 얹는다: 지형 캐시를 건드리지 않아 티어업·재접속에도 흔들림이 없다. */
  var CLUSTER_TINT = {
    forest:  { fill: 'rgba(48,84,44,.20)',  edge: 'rgba(48,84,44,.10)' },
    berry:   { fill: 'rgba(150,60,70,.16)', edge: 'rgba(150,60,70,.08)' },
    rock:    { fill: 'rgba(126,132,140,.20)', edge: 'rgba(126,132,140,.09)' },
    water:   { fill: 'rgba(196,178,132,.20)', edge: 'rgba(196,178,132,.09)' },
    fertile: { fill: 'rgba(178,140,58,.18)', edge: 'rgba(178,140,58,.08)' },
    iron:    { fill: 'rgba(150,96,72,.16)', edge: 'rgba(150,96,72,.07)' },
    oil:     { fill: 'rgba(88,72,140,.16)', edge: 'rgba(88,72,140,.07)' }
  };

  function drawClusters() {
    var list = S.clusterList();
    if (!list || !list.length) return;
    var t = GM.camera.cam.tile;
    ctx.save();
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var tint = CLUSTER_TINT[c.type];
      if (!tint) continue;
      var rad = (c.r + 1.4) * t;
      if (!GM.camera.onScreen(c.x, c.y, rad * 2)) continue;
      if (S.fogAt(c.x, c.y) < 1) continue;
      /* ★ Sprint 3 — 원점에 구워 둔 띠를 자리로 옮겨 칠한다(그림은 옛것과 같다) */
      var g = radialAt0(c.type + ':' + rad, Math.max(1, rad * 0.25), rad,
        [[0, tint.fill], [0.68, tint.edge], [1, 'rgba(0,0,0,0)']]);
      if (!g) continue;
      ctx.save();
      ctx.translate(GM.camera.worldToScreenX(c.x), GM.camera.worldToScreenY(c.y));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  /* ══════════ 전장의 안개 ══════════ */
  function drawFog() {
    var m = S.S.map;
    if (!m) return;
    var cam = GM.camera.cam;
    var vis = GM.camera.visible();
    var t = cam.tile;
    /* ★ §13-A-2 — 「기억하는 땅」의 장막은 화면을 가장 크게 어둡게 만드는 항이다.
       0.42 → 다이얼(기본 0.30)로 완화하고, **건설 모드에서는 더 옅게**(0.18) 덮는다.
       건물을 놓으러 카메라를 옮기면 시야를 벗어나 화면이 훅 어두워지던 것이 이 값 때문이었다. */
    var veil = 'rgba(8,6,16,' + S.fogVeil().toFixed(3) + ')';
    for (var y = vis.y0; y <= vis.y1; y++) {
      var runStart = -1, runVal = -1;
      for (var x = vis.x0; x <= vis.x1 + 1; x++) {
        var v = x > vis.x1 ? -2 : S.fogAt(x, y);
        if (v === runVal) continue;
        if (runStart >= 0 && runVal >= 0 && runVal < 2) {
          var p0 = GM.camera.worldToScreen(runStart - 0.5, y - 0.5);
          ctx.fillStyle = runVal === 0 ? '#0a0710' : veil;
          ctx.fillRect(Math.floor(p0.x), Math.floor(p0.y), Math.ceil((x - runStart) * t) + 1, Math.ceil(t) + 1);
        }
        runStart = x; runVal = v;
      }
    }
  }

  /* ★ §16-18 · §16-19 — 집결지(금빛) · 수비 깃발(붉은빛). 장대 + 나부끼는 천. */
  function drawFlags() {
    var t = GM.camera.cam.tile;
    var flags = [];
    var rl = S.rally();
    if (rl && rl.x != null) flags.push({ x: rl.x, y: rl.y, color: '#f6cf7a', edge: '#b98a2e' });
    var df = S.defenseFlag();
    if (df && df.x != null) flags.push({ x: df.x, y: df.y, color: '#e06a6c', edge: '#8d2f31' });
    for (var i = 0; i < flags.length; i++) {
      var fg = flags[i];
      if (!GM.camera.onScreen(fg.x, fg.y, t * 2)) continue;
      var p = GM.camera.worldToScreen(fg.x, fg.y - 1.4);
      var base = GM.camera.worldToScreen(fg.x, fg.y);
      ctx.save();
      ctx.strokeStyle = '#5a4632';
      ctx.lineWidth = Math.max(2, t * 0.09);
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      var wav = Math.sin(animT / 260 + i) * t * 0.08;
      ctx.fillStyle = fg.color;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + t * 0.62, p.y + t * 0.16 + wav);
      ctx.lineTo(p.x, p.y + t * 0.34);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = fg.edge;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ══════════ 영토 · 말뚝 ══════════ */
  /** 티어업 — 말뚝이 새 반경으로 옮겨 박히는 연출 */
  function animateTerritory(from, to) {
    territoryAnim = { from: from, to: to, t: 0 };
  }

  function territoryRadiusNow() {
    var t = S.territory();
    var r = t ? t.radius : 6;
    if (territoryAnim) {
      var k = U.clamp(territoryAnim.t / 1.5, 0, 1);
      var e = 1 - Math.pow(1 - k, 3);
      return territoryAnim.from + (territoryAnim.to - territoryAnim.from) * e;
    }
    return r;
  }

  /**
   * ★ 영토 경계 — 원 점선을 걷어 내고 **말뚝 + 밧줄**로 다시 그린다 (GDD3 §11-5).
   *   ① 안쪽은 아주 옅게 밝다(우리 땅이라는 감각) ② 경계 가까이는 그라데이션으로 어두워진다
   *   ③ 일정 간격으로 말뚝을 박고 ④ 말뚝 사이를 밧줄이 늘어져 잇는다(사이사이 처짐).
   *   티어업 때 말뚝이 하나씩 옮겨 박히는 연출은 그대로 살아 있다.
   */
  function drawTerritory() {
    var t = S.territory();
    if (!t || t.cx == null) return;
    var c = GM.camera.worldToScreen(t.cx, t.cy);
    var rr = territoryRadiusNow();
    var tile = GM.camera.cam.tile;
    var r = rr * tile;
    if (r <= 2) return;

    /* ① 내부 밝기 + ② 경계 그라데이션 — 선이 아니라 '땅의 결'로 안팎을 가른다 */
    ctx.save();
    var inner = Math.max(0, r - Math.max(6, tile * 0.9));
    var g = ctx.createRadialGradient(c.x, c.y, inner, c.x, c.y, r);
    g.addColorStop(0, 'rgba(246,231,180,.045)');
    g.addColorStop(0.72, 'rgba(246,231,180,.03)');
    g.addColorStop(1, 'rgba(58,40,20,.20)');
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    /* ③④ 말뚝과 밧줄 — 말뚝 간격은 화면에서 일정하게 보이도록 반경에 따라 늘린다 */
    var n = Math.max(10, Math.min(48, Math.round(rr * 1.5)));
    var postW = Math.max(2, Math.round(tile * 0.16));
    var postH = Math.max(6, Math.round(tile * 0.5));
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 - Math.PI / 2;
      var pop = 0;
      if (territoryAnim) {
        var d = territoryAnim.t - 0.25 - (i / n) * 0.5;
        if (d < 0) { pts.push(null); continue; }        // 아직 안 박힌 말뚝
        pop = Math.max(0, 1 - d * 4);
      }
      pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r, pop: pop });
    }

    /* 밧줄 먼저 — 말뚝 뒤로 지나가야 한다. 두 말뚝 사이가 살짝 늘어진다. */
    ctx.save();
    ctx.strokeStyle = 'rgba(198,166,110,.75)';
    ctx.lineWidth = Math.max(1, tile * 0.055);
    ctx.lineCap = 'round';
    var cull = postH * 2 + 12;                          // ★ Sprint 3 — 늘어짐·기둥 높이만큼 넉넉히
    for (var j = 0; j < pts.length; j++) {
      var p0 = pts[j], p1 = pts[(j + 1) % pts.length];
      if (!p0 || !p1) continue;
      /* ★ Sprint 3 — 양 끝이 다 화면 밖이면 그 밧줄은 눈에 들 수 없다.
         영토가 넓어지면 말뚝이 마흔여덟, 밧줄이 마흔여덟인데 옛 셈은 화면 밖 것까지
         곡선 명령을 다 쌓았다(잘라 내는 일은 캔버스가 뒤늦게 한다). */
      if (offScreen(p0.x, p0.y, cull) && offScreen(p1.x, p1.y, cull)) continue;
      var mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
      var sag = Math.max(1.5, tile * 0.1);              // 늘어짐
      var ox = mx - c.x, oy = my - c.y;
      var len = Math.hypot(ox, oy) || 1;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y - postH * 0.78);
      ctx.quadraticCurveTo(mx + (ox / len) * sag, my + (oy / len) * sag - postH * 0.7, p1.x, p1.y - postH * 0.78);
      ctx.stroke();
    }
    ctx.restore();

    /* 말뚝 — 나무 기둥 + 밝은 머리. 새로 박히는 순간에는 흙먼지 선이 튄다. */
    ctx.save();
    for (var k = 0; k < pts.length; k++) {
      var p = pts[k];
      if (!p) continue;
      if (offScreen(p.x, p.y, cull)) continue;          /* ★ Sprint 3 — 화면 밖 말뚝은 건너뛴다 */
      var h = postH * (1 + p.pop * 0.55);
      ctx.fillStyle = 'rgba(20,14,8,.35)';              // 그림자
      ctx.fillRect(p.x - postW, p.y - 1, postW * 2, Math.max(1, postW * 0.7));
      ctx.fillStyle = '#6b4526';
      ctx.fillRect(p.x - postW / 2, p.y - h, postW, h);
      ctx.fillStyle = '#8a5c33';
      ctx.fillRect(p.x - postW / 2, p.y - h, Math.max(1, postW * 0.4), h);
      ctx.fillStyle = p.pop > 0 ? '#f6cf7a' : '#c8a874';
      ctx.fillRect(p.x - postW / 2, p.y - h, postW, Math.max(2, h * 0.2));
      if (p.pop > 0.1) {
        ctx.globalAlpha = p.pop;
        ctx.fillStyle = '#f6e6a8';
        ctx.fillRect(p.x - postW * 1.8, p.y - 1, postW * 3.6, 2);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();

    /* ★ §17-14 — 깃발로 얻은 점령지(claims). 본영과 같은 결의 옅은 안쪽 밝음에
       점선 고리를 둘러 「본영은 밧줄, 새 땅은 점선」으로 서로 다르게 읽히게 한다. */
    var claims = (t && t.claims) || [];
    for (var q = 0; q < claims.length; q++) {
      var cl = claims[q];
      var cc = GM.camera.worldToScreen(cl.x, cl.y);
      var cr = cl.radius * tile;
      if (cr <= 2) continue;
      ctx.save();
      var gi = Math.max(0, cr - Math.max(6, tile * 0.9));
      var gg = ctx.createRadialGradient(cc.x, cc.y, gi, cc.x, cc.y, cr);
      gg.addColorStop(0, 'rgba(246,231,180,.04)');
      gg.addColorStop(1, 'rgba(58,40,20,.16)');
      ctx.beginPath();
      ctx.arc(cc.x, cc.y, cr, 0, Math.PI * 2);
      ctx.fillStyle = gg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(198,166,110,.7)';
      ctx.lineWidth = Math.max(1, tile * 0.06);
      ctx.setLineDash([Math.max(3, tile * 0.35), Math.max(3, tile * 0.3)]);
      ctx.beginPath();
      ctx.arc(cc.x, cc.y, cr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ══════════ ★ §19-F4(F09-2) 기차 ══════════
     자리는 서버가 쥔다 — 화면은 받은 좌표를 그대로 그린다(제 셈으로 굴리지 않는다).
     그림은 캔버스 도형 몇 개다: 몸통·차창·차대·바퀴. 에셋을 부르지 않는다. */
  function drawTrains() {
    var list = S.trains();
    if (!list.length) return;
    var t = GM.camera.cam.tile;
    for (var i = 0; i < list.length; i++) {
      var tr = list[i];
      if (!GM.camera.onScreen(Math.round(tr.x), Math.round(tr.y), t)) continue;
      if (S.fogAt(Math.round(tr.x), Math.round(tr.y)) < 1) continue;
      paintTrain(tr, GM.camera.worldToScreen(tr.x - 1.1, tr.y - 0.75), t);
    }
  }

  function paintTrain(tr, p, t) {
    var w = Math.max(6, Math.round(t * 2.2));
    var h = Math.max(4, Math.round(t * 1.15));
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(Math.round(p.x), Math.round(p.y + h * 0.86), w, Math.max(2, Math.round(h * 0.22)));
    ctx.fillStyle = '#4a5058';
    ctx.fillRect(Math.round(p.x), Math.round(p.y + h * 0.2), w, Math.round(h * 0.7));
    ctx.fillStyle = tr.dwell > 0 ? '#7d8892' : '#5e646c';
    ctx.fillRect(Math.round(p.x), Math.round(p.y), Math.round(w * 0.34), Math.round(h * 0.55));
    paintTrainTrim(tr, p, w, h);
    ctx.restore();
  }

  /** 차창·굴뚝·바퀴 — 탄 사람이 있으면 창에 불이 든다 */
  function paintTrainTrim(tr, p, w, h) {
    ctx.fillStyle = (tr.riders && tr.riders.length) ? '#f6cf7a' : '#9fb4c6';
    for (var k = 0; k < 3; k++) {
      ctx.fillRect(Math.round(p.x + w * (0.42 + k * 0.18)), Math.round(p.y + h * 0.34),
                   Math.max(2, Math.round(w * 0.11)), Math.max(2, Math.round(h * 0.3)));
    }
    ctx.fillStyle = '#2b3138';
    ctx.fillRect(Math.round(p.x + w * 0.08), Math.round(p.y - h * 0.24), Math.max(2, Math.round(w * 0.1)), Math.round(h * 0.3));
    for (var q = 0; q < 4; q++) {
      ctx.fillRect(Math.round(p.x + w * (0.08 + q * 0.24)), Math.round(p.y + h * 0.86),
                   Math.max(2, Math.round(w * 0.1)), Math.max(2, Math.round(h * 0.16)));
    }
  }

  /** 곁에 선 기차 하나 — [E] 가 이것을 집는다(판정은 서버가 다시 한다) */
  function nearestTrain(x, y, range) {
    var list = S.trains();
    var best = null;
    var bd = range;
    for (var i = 0; i < list.length; i++) {
      var d = Math.hypot(list[i].x - x, list[i].y - y);
      if (d <= bd) { bd = d; best = list[i]; }
    }
    return best;
  }

  /* ══════════ 울타리 조각 ══════════ */
  /* ★ GDD3 §13-D-5 — 철로. 바닥에 깔린 것이라 건물·사람보다 먼저 그린다. */
  function drawRails() {
    var list = S.rails();
    if (!list.length) return;
    var t = GM.camera.cam.tile;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!GM.camera.onScreen(r.x, r.y, t)) continue;
      if (S.fogAt(r.x, r.y) < 1) continue;
      var p = GM.camera.worldToScreen(r.x - 0.5, r.y - 0.5);
      ctx.save();
      /* 침목 — 가로 세 줄 */
      ctx.fillStyle = '#6b4526';
      for (var k = 0; k < 3; k++) {
        ctx.fillRect(Math.round(p.x + t * (0.12 + k * 0.3)), Math.round(p.y + t * 0.2),
                     Math.max(1, Math.round(t * 0.12)), Math.max(1, Math.round(t * 0.6)));
      }
      /* 레일 — 세로 두 줄 */
      ctx.fillStyle = '#9aa4ae';
      ctx.fillRect(Math.round(p.x), Math.round(p.y + t * 0.26), Math.ceil(t), Math.max(1, Math.round(t * 0.1)));
      ctx.fillRect(Math.round(p.x), Math.round(p.y + t * 0.64), Math.ceil(t), Math.max(1, Math.round(t * 0.1)));
      ctx.restore();
    }
  }

  /* ★ §17-13 — 매립. 물을 덮은 모래흙 칸이라 노드·건물·다리보다 먼저(지형 바로 위에) 깔린다. */
  function drawFills() {
    var list = S.fills();
    if (!list.length) return;
    var t = GM.camera.cam.tile;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (!GM.camera.onScreen(f.x, f.y, t)) continue;
      if (S.fogAt(f.x, f.y) < 1) continue;
      var p = GM.camera.worldToScreen(f.x - 0.5, f.y - 0.5);
      ctx.save();
      /* 메운 흙 — 모래빛 바탕에 어두운 알갱이 몇 점 */
      ctx.fillStyle = '#c9b28a';
      ctx.fillRect(Math.round(p.x), Math.round(p.y), Math.ceil(t), Math.ceil(t));
      ctx.fillStyle = '#a8916b';
      var d = Math.max(1, Math.round(t * 0.08));
      ctx.fillRect(Math.round(p.x + t * 0.22), Math.round(p.y + t * 0.3), d, d);
      ctx.fillRect(Math.round(p.x + t * 0.62), Math.round(p.y + t * 0.18), d, d);
      ctx.fillRect(Math.round(p.x + t * 0.44), Math.round(p.y + t * 0.66), d, d);
      ctx.fillRect(Math.round(p.x + t * 0.76), Math.round(p.y + t * 0.58), d, d);
      ctx.restore();
    }
  }

  /* ★ §17-13 — 다리. 물 위에 걸친 나무 판자 — 매립 다음, 철로보다 먼저 그린다. */
  function drawBridges() {
    var list = S.bridges();
    if (!list.length) return;
    var t = GM.camera.cam.tile;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (!GM.camera.onScreen(b.x, b.y, t)) continue;
      if (S.fogAt(b.x, b.y) < 1) continue;
      var p = GM.camera.worldToScreen(b.x - 0.5, b.y - 0.5);
      ctx.save();
      /* 판자 바탕 — 두 갈색 톤을 번갈아 */
      ctx.fillStyle = '#8a5c33';
      ctx.fillRect(Math.round(p.x), Math.round(p.y), Math.ceil(t), Math.ceil(t));
      ctx.fillStyle = '#6b4526';
      for (var k = 0; k < 2; k++) {
        ctx.fillRect(Math.round(p.x), Math.round(p.y + t * (0.28 + k * 0.36)),
                     Math.ceil(t), Math.max(1, Math.round(t * 0.14)));
      }
      /* 판자 틈 — 가로 어두운 줄(널빤지 경계) */
      ctx.fillStyle = 'rgba(20,14,8,.45)';
      for (var m2 = 0; m2 < 3; m2++) {
        ctx.fillRect(Math.round(p.x + t * (0.08 + m2 * 0.32)), Math.round(p.y),
                     Math.max(1, Math.round(t * 0.05)), Math.ceil(t));
      }
      ctx.restore();
    }
  }

  /* ══════════ ★ Sprint 3 — 칸 바구니(공간 색인) ══════════
     「왜」 — 화면에 드는 것은 늘 한 줌인데, 옛 셈은 늦은 판에 3천까지 자라는 자원 자리와
     울타리 400조각을 **프레임마다 통째로** 훑고 나서야 화면 밖인 줄 알았다(초당 20만 번의 헛걸음).
     목록이 바뀔 때만 16칸 격자에 나눠 담고, 그릴 때는 화면에 걸친 바구니만 연다.
     담는 것은 물건이 아니라 **목록에서의 자리(index)** 다 — 꺼낸 뒤 번호순으로 세우면
     겹쳐 그리는 차례가 옛 그림과 글자 그대로 같다(그림이 달라지면 최적화가 아니다). */
  var BUCKET = 16;
  var nodeIndex = { src: null, n: -1, cells: null, w: 0 };
  var fenceIndex = { src: null, n: -1, cells: null, w: 0 };
  var pickBuf = [];          // 바구니에서 꺼낸 번호들 — 프레임마다 새로 만들지 않고 되쓴다

  function buildIndex(ix, list, xOf, yOf) {
    if (ix.src === list && ix.n === list.length) return ix;
    var w = Math.max(1, Math.ceil((S.mapSize() || 384) / BUCKET));
    var cells = {};
    for (var i = 0; i < list.length; i++) {
      var cx = Math.floor(xOf(list[i]) / BUCKET), cy = Math.floor(yOf(list[i]) / BUCKET);
      var k = cy * w + cx;
      if (cells[k]) cells[k].push(i);
      else cells[k] = [i];
    }
    ix.src = list; ix.n = list.length; ix.cells = cells; ix.w = w;
    return ix;
  }

  /** 화면(여유 margin 칸)에 걸친 바구니의 번호들 — 목록 순서 그대로 */
  function pickVisible(ix, margin) {
    var vis = GM.camera.visible();
    var w = ix.w;
    var cx0 = Math.floor((vis.x0 - margin) / BUCKET), cx1 = Math.floor((vis.x1 + margin) / BUCKET);
    var cy0 = Math.floor((vis.y0 - margin) / BUCKET), cy1 = Math.floor((vis.y1 + margin) / BUCKET);
    pickBuf.length = 0;
    for (var cy = cy0; cy <= cy1; cy++) {
      if (cy < 0 || cy >= w) continue;
      for (var cx = cx0; cx <= cx1; cx++) {
        if (cx < 0 || cx >= w) continue;
        var b = ix.cells[cy * w + cx];
        if (!b) continue;
        for (var i = 0; i < b.length; i++) pickBuf.push(b[i]);
      }
    }
    pickBuf.sort(function (a, b2) { return a - b2; });   // 옛 그리기 차례를 그대로 지킨다
    return pickBuf;
  }

  function fenceMidX(f) { return (f.x1 + f.x2) / 2; }
  function fenceMidY(f) { return (f.y1 + f.y2) / 2; }

  /**
   * ★ Sprint 3 — 이 자리 둘레(반경 r)의 자원 자리들.
   * 손이 닿는 것을 고르는 일(swing.findTarget)은 반경 두어 칸을 보면서 목록 삼천 개를
   * 통째로 훑고 있었다. 바구니를 쓰면 볼 것이 한 줌이다 — 고르는 규칙은 부르는 쪽 그대로다.
   * 돌려주는 배열은 **되쓰는 그릇**이라 다음 부름 전까지만 쓴다(목록 순서는 지킨다).
   */
  var nearBuf = [], nearIdx = [];
  function nodesNear(x, y, r) {
    var list = S.nodeList();
    var ix = buildIndex(nodeIndex, list, nodeX, nodeY);
    var w = ix.w;
    nearIdx.length = 0; nearBuf.length = 0;
    var cx0 = Math.floor((x - r) / BUCKET), cx1 = Math.floor((x + r) / BUCKET);
    var cy0 = Math.floor((y - r) / BUCKET), cy1 = Math.floor((y + r) / BUCKET);
    for (var cy = cy0; cy <= cy1; cy++) {
      if (cy < 0 || cy >= w) continue;
      for (var cx = cx0; cx <= cx1; cx++) {
        if (cx < 0 || cx >= w) continue;
        var b = ix.cells[cy * w + cx];
        if (!b) continue;
        for (var i = 0; i < b.length; i++) nearIdx.push(b[i]);
      }
    }
    nearIdx.sort(function (a, b2) { return a - b2; });
    for (var k = 0; k < nearIdx.length; k++) {
      var n = list[nearIdx[k]];
      if (Math.abs(n.x - x) <= r && Math.abs(n.y - y) <= r) nearBuf.push(n);
    }
    return nearBuf;
  }

  function drawFences() {
    var list = S.fences();
    if (!list.length) return;
    var tile = GM.camera.cam.tile;
    var pick = pickVisible(buildIndex(fenceIndex, list, fenceMidX, fenceMidY), 2);
    for (var pi = 0; pi < pick.length; pi++) {
      var i = pick[pi];
      var f = list[i];
      var mx = (f.x1 + f.x2) / 2, my = (f.y1 + f.y2) / 2;
      if (!GM.camera.onScreen(mx, my, tile * 2)) continue;
      if (S.fogAt(Math.round(mx), Math.round(my)) < 1) continue;
      var vertical = f.x1 === f.x2;
      var cond = f.condition === undefined ? 1 : f.condition;
      var dmg = f.broken ? 2 : (cond < 0.6 ? 1 : 0);
      var sp = GM.atlas.fence({ vertical: vertical, tier: f.tier, gate: f.gate, damage: dmg });
      /* ★ Sprint 3 — 점 객체를 안 만든다(값은 worldToScreen 과 같다) */
      var px = GM.camera.worldToScreenX(mx - 0.5), py = GM.camera.worldToScreenY(my - 0.62);
      ctx.save();
      if (f.broken) ctx.globalAlpha = 0.6;
      try { ctx.drawImage(sp, Math.round(px), Math.round(py), Math.ceil(tile), Math.ceil(tile)); } catch (e) {}
      ctx.restore();
      if (S.S.selection && S.S.selection.fenceId === f.id) ringAt(mx, my, '#e8a33d', 0.9);
    }
  }

  /* ══════════ 자원 자리 ══════════ */
  function nodeX(n) { return n.x; }
  function nodeY(n) { return n.y; }

  function drawNodes() {
    var t0 = nowMs();
    drawNodesInner();
    nodesMs += nowMs() - t0;
  }

  function drawNodesInner() {
    var cam = GM.camera.cam;
    var list = S.nodeList();
    var t = cam.tile;
    /* ★ Sprint 3 — 화면에 걸친 바구니만 연다. 자리 하나가 흔들려도(nodeShake) 한 칸을 넘지
       않으므로 여유 한 바구니면 충분하다 — 걸러 내는 자는 아래 onScreen 이 그대로 든다. */
    var pick = pickVisible(buildIndex(nodeIndex, list, nodeX, nodeY), BUCKET);
    for (var pi = 0; pi < pick.length; pi++) {
      var i = pick[pi];
      var n = list[i];
      if (!GM.camera.onScreen(n.x, n.y, t)) continue;
      if (S.fogAt(n.x, n.y) < 1) continue;
      var sh = GM.fx ? GM.fx.nodeShake(n.id) : 0;
      var p = P2;                                       // 되쓰는 점 하나 — 프레임마다 쓰레기를 안 남긴다
      p.x = GM.camera.worldToScreenX(n.x - 0.5 + sh);
      p.y = GM.camera.worldToScreenY(n.y - 0.5);
      /* ★ §13-B-3 — 다 캔 자리는 **그루터기**다. 아이콘을 어둡게 덮는 게 아니라 그루터기를 그린다. */
      if (n.depleted) {
        ctx.save();
        ctx.globalAlpha = 0.85;
        try { ctx.drawImage(GM.atlas.stump(n.type), Math.round(p.x), Math.round(p.y), Math.ceil(t), Math.ceil(t)); } catch (e0) {}
        ctx.restore();
        drawRegrowClock(n, p, t);
        continue;
      }
      var sp = GM.atlas.node(n.type, {
        stage: n.stage, rich: n.rich,
        thin: n.ratio !== undefined && n.ratio !== null && n.ratio < 0.4
      });
      /* ★ §13-B-3 — 고갈이 임박하면 **옅어진다**. 남은 양이 fadeAt(35%) 아래로 내려가는 순간부터
         비율에 비례해 투명해지므로, 멀리서도 '저 숲은 곧 끝난다'가 눈으로 읽힌다. */
      var fadeAt = S.regrowCfg() ? S.regrowCfg().fadeAt : 0.35;
      var ratio = (n.ratio == null) ? 1 : n.ratio;
      var faded = ratio < fadeAt;
      if (faded) { ctx.save(); ctx.globalAlpha = 0.42 + 0.58 * (ratio / Math.max(0.01, fadeAt)); }
      try { ctx.drawImage(sp, Math.round(p.x), Math.round(p.y), Math.ceil(t), Math.ceil(t)); } catch (e) {}
      if (faded) ctx.restore();
      if (n.harvestReady) {
        var g = 0.5 + 0.5 * Math.sin(animT / 260 + n.x);
        ctx.save();
        ctx.globalAlpha = 0.35 + g * 0.5;
        ctx.fillStyle = '#f6e6a8';
        ctx.fillRect(p.x + t * 0.34, p.y - t * 0.28, t * 0.3, t * 0.3);
        ctx.restore();
      }
      /* 스윙 진행 — 몇 번 더 치면 되는가 */
      if (n.swings > 0 && n.swingsPerCycle > 1 && t >= 20) {
        var per = n.swingsPerCycle;
        var dotW = Math.max(3, t * 0.14);
        var totalW = per * (dotW + 2) - 2;
        var bx = p.x + (t - totalW) / 2, by = p.y - 6;
        for (var k = 0; k < per; k++) {
          ctx.fillStyle = k < n.swings ? '#f6cf7a' : 'rgba(20,14,8,.5)';
          ctx.fillRect(bx + k * (dotW + 2), by, dotW, 3);
        }
      }
      if (n.workers > 0 && t >= 24) {
        ctx.fillStyle = 'rgba(20,14,8,.6)';
        ctx.fillRect(p.x, p.y + t - 5, t, 5);
        ctx.fillStyle = '#8dbb6d';
        ctx.fillRect(p.x, p.y + t - 5, t * Math.min(1, n.workers / Math.max(1, n.slots)), 5);
      }
    }
  }

  /* ══════════ ★ §18-D2 앞마당의 흔적 ══════════
     자원 자리보다 **작게, 낮게** 그린다(0.72칸). 흔적은 지형에 얹힌 자국이지 지형이 아니다 —
     발자국이 나무만 하면 앞마당이 흔적 밭으로 보인다.
     ★ 마커·화살표는 여기에 없다. 아직 안 조사한 흔적이라고 화살표가 서지 않고, 사슬의 다음
     발자국도 안개가 열린 자리에 **그냥 놓여** 있을 뿐이다(§18-3). 눈으로 찾는 것이 이 시스템이다. */
  var TRAIL_SCALE = 0.72;

  function drawTrails() {
    var list = S.trailList();
    if (!list.length) return;
    var t = GM.camera.cam.tile;
    var s = Math.ceil(t * TRAIL_SCALE);
    for (var i = 0; i < list.length; i++) drawTrail(list[i], t, s);
  }

  function drawTrail(tr, t, s) {
    if (!GM.camera.onScreen(tr.x, tr.y, t)) return;
    if (S.fogAt(tr.x, tr.y) < 1) return;
    var px = GM.camera.worldToScreenX(tr.x - 0.5) + (t - s) / 2;
    var py = GM.camera.worldToScreenY(tr.y - 0.5) + (t - s) / 2;
    /* 오늘 못 쓰는 것(우물을 이미 길었다)은 흐리게 — 없어진 척하지 않는다. 내일 다시 온다. */
    if (!tr.ready) ctx.globalAlpha = 0.5;
    try { ctx.drawImage(GM.atlas.trail(tr.art, !tr.ready), Math.round(px), Math.round(py), s, s); } catch (e) {}
    ctx.globalAlpha = 1;
  }

  /** 그루터기 위 작은 시계 — 며칠 뒤에 되살아나는지 (§13-B-3) */
  function drawRegrowClock(n, p, t) {
    if (n.respawnAt == null || t < 22) return;
    var left = n.respawnAt - (S.S.view ? S.S.view.day : 0);
    if (!(left > 0)) return;
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = 'rgba(20,14,8,.6)';
    ctx.fillRect(p.x + t * 0.28, p.y - t * 0.26, t * 0.44, t * 0.3);
    ctx.fillStyle = '#8dbb6d';
    ctx.font = Math.max(8, Math.round(t * 0.26)) + 'px Galmuri11, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.ceil(left)), p.x + t * 0.5, p.y - t * 0.11);
    ctx.restore();
  }

  /* ══════════ 들에 사는 것들 (GDD3 §13-C) ══════════
     ★ 위치의 주인은 **서버**다(주민과 정반대다 — 주민은 클라가 쥔다).
       서버는 1초에 한 번만 좌표를 보내므로, 그 값을 그대로 찍으면 짐승이 1초에 한 번 튄다.
       그래서 화면은 제 렌더 좌표를 따로 들고 서버 좌표로 **다가간다**(lerp).
       처음 본 놈과 너무 멀리 벌어진 놈만 스냅한다 — §12-11 텔레포트 사고의 해법을 그대로 뒤집어 쓴 것이다. */
  var wild = {};
  var WILD_SNAP = 12;

  /* ★ GDD3 §14-3 — 뚝뚝 끊기던 까닭과 고친 규칙.
     옛 코드는 지수 감쇠(`d × min(1, dt×6)`)로 서버 좌표에 '다가갔다'. 그 곡선은 새 좌표가 오는
     순간 가장 빠르고 다음 좌표가 올 때쯤 거의 멈춘다 — 1초 주기로 **빨라졌다 느려지는** 톱니가
     그대로 눈에 보인다(실측: 프레임 간 이동량 표준편차 ÷ 평균 = 0.94).
     고친 규칙은 교과서 그대로다:
       ① 서버 좌표를 **두 개**(prev·next) 들고 있는다.
       ② 그리는 시각을 **한 스텝 뒤로 미룬다**(지연 버퍼) — 다음 좌표가 이미 손에 있는 구간만 그린다.
       ③ 그 두 점 사이를 **등속**으로 지난다. k 는 [0,1] 로 잘라 **외삽하지 않는다**
          (패킷이 늦으면 멈춰 기다린다 — 앞질러 갔다가 되돌아오는 것이 가장 큰 끊김이다).
       ④ 방향은 값이 아니라 **각도를 스무딩**해서 정한다. 왼·오른쪽 뒤집기에는 문턱을 둬
          제자리걸음에 스프라이트가 파닥거리지 않게 한다. */
  /* ★ §16-3 — 두 점 버퍼를 **스냅샷 띠(ring buffer)** 로 바꾼다.
     옛 규칙(prev·next 두 점 + 고정 지연 1000ms)은 지연폭이 스냅샷 간격과 **정확히 같을 때만** 등속이다.
     간격이 흔들리면(서버 setInterval·네트워크·프레임 처짐) 그 차이만큼 매 주기 얼어붙었다 움직이는
     미세 끊김이 남고, 시계가 벽시계보다 늦게 가면(무거운 프레임의 dt 캡) 1초에 한 번 순간이동이 됐다.

     ★ §19-B — 그 띠를 public/js/interp.js 한 채로 모은다. 같은 규칙을 짐승·사람·웨이브 적이
     **세 벌** 들고 있었고, 그래서 결함도 셋 다에 똑같이 있었다(고치면 세 군데를 고쳐야 했다).
     수치는 코드가 아니라 data/world.json render.interp 가 쥔다. */
  var wild = {};
  var WILD_SNAP = 12;

  function dials() { return GM.interp.dials(S.worldCfg() && S.worldCfg().render); }

  /* ★ §19-B — 연출 시계(ms)는 **벽시계로 흐른다**. 옛 시계는 프레임 dt(0.05초로 잘린 값)를 쌓아
     만들어, 무거운 프레임이 이어지면 벽시계보다 뒤처졌다: 좌표는 제 시각에 오는데 그리는 시각만
     늦어 띠 앞머리에 얼어붙고, 한 장 밀려날 때마다 통째로 건너뛰었다(멈췄다 튀는 반복).
     한 프레임의 걸음은 clockMaxStepMs 로 자른다 — 탭이 멈췄다 돌아온 뒤 몇 분을 한 번에 밀면
     띠를 통째로 지나쳐 그것이 곧 순간이동이다. */
  var wildClock = 0;
  var wallMark = null;                  // 마지막 프레임의 벽시계 — 프레임 **사이**의 흐름을 잰다

  function advanceClock(rawMs) {
    var step = typeof rawMs === 'number' ? rawMs : 16;
    wildClock += Math.max(0, Math.min(step, dials().clockMaxStepMs));
    wallMark = nowMs();
    return wildClock;
  }

  /** ★ §19-B — **받은 그 순간**의 연출 시계. 좌표는 프레임 사이(소켓 콜백)에 닿으므로 프레임 시각으로
      찍으면, 무거운 프레임 하나에 몰려 든 두세 장이 한 점에 겹친다 — 겹친 점은 차례를 지키려 1ms 씩
      밀려 그 자리를 곧바로 지나가 버린다. 그 건너뜀이 곧 순간이동이고, 프레임이 제일 무거운 때가
      바로 「게임 시작 직후 · 새 사람이 들어온 직후」다. */
  function netNow() {
    if (wallMark == null) return wildClock;
    return wildClock + Math.max(0, Math.min(nowMs() - wallMark, dials().clockMaxStepMs));
  }

  function newWild(c, now) {
    var a = GM.interp.create(c.x, c.y, now, null);
    a.dir = 1; a.face = 0; a.frame = 0; a.ft = 0; a.hurt = 0;
    return a;
  }

  /** 새 좌표 묶음이 왔다 — 각자의 띠에 한 장씩 얹는다 */
  function pushWildSnapshot(list) {
    var now = netNow();
    var src = list || [];
    /* ★ Sprint 3 — 살아 있는 놈의 표를 **먼저** 세운다. 옛 셈은 화면이 든 놈마다
       새 묶음을 처음부터 훑어(n×n) 짐승이 늘수록 좌표 한 묶음 받는 값이 제곱으로 컸다. */
    var alive = {};
    for (var i = 0; i < src.length; i++) {
      var c = src[i];
      alive[c.id] = 1;
      var a = wild[c.id];
      if (!a) { wild[c.id] = newWild(c, now); continue; }
      GM.interp.push(a, c.x, c.y, now, WILD_SNAP, dials(), dials().wildGapMs);
    }
    for (var k in wild) {
      if (!Object.prototype.hasOwnProperty.call(wild, k)) continue;
      if (alive[k] !== 1) delete wild[k];
    }
  }

  function stepWild(dt, rawMs) {
    advanceClock(typeof rawMs === 'number' ? rawMs : dt * 1000);
    var list = S.creatureList();
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      seen[c.id] = true;
      var a = wild[c.id];
      if (!a) { wild[c.id] = newWild(c, wildClock); continue; }
      var pos = GM.interp.sample(a, wildClock, dials(), dials().wildGapMs);
      var mx = pos.x - a.x, my = pos.y - a.y;
      a.x = pos.x; a.y = pos.y;
      var moved = Math.hypot(mx, my);
      if (moved > 0.0015) {
        /* 방향 스무딩 — 각도를 따라가고, 좌우 뒤집기에는 문턱을 둔다 */
        var want = Math.atan2(my, mx);
        var diff = Math.atan2(Math.sin(want - a.face), Math.cos(want - a.face));
        a.face += diff * Math.min(1, dt * 7);
        var cosF = Math.cos(a.face);
        if (cosF > 0.22) a.dir = 1;
        else if (cosF < -0.22) a.dir = -1;
        a.ft += dt;
        if (a.ft > 0.22) { a.ft = 0; a.frame = a.frame ? 0 : 1; }
      }
      if (a.hurt > 0) a.hurt = Math.max(0, a.hurt - dt);
    }
    for (var id in wild) if (Object.prototype.hasOwnProperty.call(wild, id) && !seen[id]) delete wild[id];
  }

  function markWildHurt(id) { if (wild[id]) wild[id].hurt = 0.35; }

  /* ══════════ ★ GDD3 §15-C — 함께 있는 사람들(동료 봇 · 같이 접속한 이)의 걸음 ══════════
     그들의 자리는 1초에 한 번 온다(동료는 서버 저빈도 두뇌가, 사람은 걸음 보고가 그 박자다).
     그대로 그리면 1초마다 툭툭 튄다 — 짐승에게 쓴 §14-3 의 규칙을 그대로 쓴다:
     두 점을 들고, 한 스텝 뒤를 등속으로 지나고, 외삽하지 않는다. */
  var mates = {};
  var MATE_SNAP = 12;

  /* ★ §16-7 — 마차 동반 하차. 오프닝이 도는 동안 동료들은 **마차 안**이라 그리지 않고,
     막이 걷히는 순간 마차 자리에서 한 사람씩(0.5초 간격) 내려 제 자리로 걸어간다.
     서버 좌표는 건드리지 않는다 — 내리는 연출은 순전히 화면의 몫이고,
     띠 보간(stepMates)이 마차→실제 자리 걸음을 알아서 그린다. */
  function crewDisembark(x, y) {
    var list = S.S.avatars || [];
    var mine = S.S.avatarId;
    var k = 0;
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (v.id === mine) continue;
      var t0 = wildClock + 500 + k * 550;
      var walkMs = Math.max(400, Math.hypot(v.x - x, v.y - y) / 3.2 * 1000);
      var a = GM.interp.create(x, y, t0, walkMs);
      a.buf.push({ x: v.x, y: v.y, t: t0 + walkMs });
      a.dir = 0; a.frame = 0; a.ft = 0; a.delay = 200;
      mates[v.id] = a;
      k += 1;
    }
  }

  function newMate(v, now) {
    var a = GM.interp.create(v.x, v.y, now == null ? wildClock : now, null);
    a.dir = 0; a.frame = 0; a.ft = 0;
    return a;
  }

  /** ★ §19-B — 아바타 자리 묶음이 왔다. 짐승과 같이 **받은 그 순간** 각자의 띠에 얹는다.
      「왜」 프레임에서 훑지 않나 — 무거운 프레임(시작 직후·남이 들어온 직후) 하나에 여러 장이 몰려
      들면, 프레임에서 훑는 눈에는 마지막 한 장만 남아 그 사이의 걸음이 통째로 건너뛴다.
      ★ 자리가 그대로인 이는 얹지 않는다 — 이 방송은 **남이 걸을 때마다** 오므로, 서 있는 이의 띠에
      같은 점을 쌓으면 박자를 방송 간격(그의 진짜 박자보다 훨씬 짧다)으로 잘못 배워 띠가 마른다. */
  function pushMates(list) {
    var now = netNow();
    var mine = S.S.avatarId;
    var src = list || [];
    for (var i = 0; i < src.length; i++) {
      var v = src[i];
      if (!v || v.id === mine) continue;            // 내 몸은 avatar.js 가 쥔다
      var a = mates[v.id];
      if (!a) { mates[v.id] = newMate(v, now); continue; }
      var last = a.buf[a.buf.length - 1];
      if (last && last.x === v.x && last.y === v.y) continue;
      GM.interp.push(a, v.x, v.y, now, MATE_SNAP, dials(), dials().mateGapMs);
    }
  }

  function stepMates(dt) {
    var list = S.S.avatars || [];
    var mine = S.S.avatarId;
    /* ★ §16-7b — 내리기 전까지만 마차 안이다(내리면 자막이 남아 있어도 함께 내려 걷는다) */
    var boarding = GM.opening && GM.opening.busy() && !GM.opening.dropped();
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (v.id === mine) continue;                 // 내 몸은 avatar.js 가 쥔다
      if (boarding) { seen[v.id] = true; continue; }
      seen[v.id] = true;
      var a = mates[v.id];
      /* 띠에 얹는 일은 pushMates(받은 그 순간)가 한다 — 여기서는 그릴 자리만 읽는다 */
      if (!a) { mates[v.id] = newMate(v, wildClock); continue; }
      var pos = GM.interp.sample(a, wildClock, dials(), dials().mateGapMs);
      var mx = pos.x - a.x, my = pos.y - a.y;
      a.x = pos.x; a.y = pos.y;
      if (Math.hypot(mx, my) > 0.0015) {
        var ax = Math.abs(mx), ay = Math.abs(my);
        if (!v.role) a.dir = ax > ay ? (mx > 0 ? 2 : 1) : (my > 0 ? 0 : 3);
        else if (ax > ay * 2) a.dir = mx > 0 ? 6 : 2;
        else if (ay > ax * 2) a.dir = my > 0 ? 0 : 4;
        else if (mx > 0) a.dir = my > 0 ? 7 : 5;
        else a.dir = my > 0 ? 1 : 3;
        a.ft += dt;
        if (a.ft > (v.role ? 0.1 : 0.18)) {
          a.ft = 0;
          a.frame = v.role ? (a.frame + 1) % 9 : (a.frame ? 0 : 1);
        }
      } else a.frame = 0;
    }
    for (var id in mates) if (Object.prototype.hasOwnProperty.call(mates, id) && !seen[id]) delete mates[id];
  }

  function drawWild() {
    var list = S.creatureList();
    if (!list.length) return;
    var t = GM.camera.cam.tile;
    /* ★ Sprint 1 — §11-1 「잠긴 것은 부재다」를 짐승에도 적용한다. 사냥(hunt)은 3장 해금인데
       짐승은 1장부터 그려져, 보이는 것을 때릴 수 없는 채 「가까이 가라」는 엉뚱한 안내만 났다
       (「시작하자마자 동물 타겟팅이 안 된다」의 정체). 해금 전에는 그리지 않는다 —
       다만 이미 나를 쫓는 놈(chase)은 예외다: 보이지 않는 이빨에 물리는 일은 없어야 한다. */
    var huntOn = S.featOn('hunt');
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!huntOn && !(c.kind === 'predator' && c.state === 'chase')) continue;
      var a = wild[c.id] || { x: c.x, y: c.y, frame: 0, dir: 1, hurt: 0 };
      if (!GM.camera.onScreen(a.x, a.y, t * 2)) continue;
      if (S.fogAt(Math.round(a.x), Math.round(a.y)) < 2) continue;   // 지금 눈에 보이는 것만
      var p = P2;                                                    // ★ Sprint 3 — 되쓰는 점
      p.x = GM.camera.worldToScreenX(a.x - 0.5);
      p.y = GM.camera.worldToScreenY(a.y - 0.5);
      var img = GM.atlas.wild(c.sp, a.frame, { hurt: a.hurt > 0 });
      ctx.save();
      if (a.dir < 0) {
        ctx.translate(Math.round(p.x) + t, Math.round(p.y));
        ctx.scale(-1, 1);
        try { ctx.drawImage(img, 0, 0, Math.ceil(t), Math.ceil(t)); } catch (e) {}
      } else {
        try { ctx.drawImage(img, Math.round(p.x), Math.round(p.y), Math.ceil(t), Math.ceil(t)); } catch (e2) {}
      }
      ctx.restore();
      /* 성이 난 놈은 발밑이 붉다 — 쫓기고 있다는 것을 한눈에 */
      if (c.kind === 'predator' && c.state === 'chase') {
        ctx.save();
        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(animT / 140);
        ctx.strokeStyle = '#bc4749';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(p.x + t / 2, p.y + t * 0.92, t * 0.34, t * 0.16, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      if (c.hp < c.maxHp && t >= 18) {
        var w = t * 0.7;
        ctx.fillStyle = 'rgba(20,14,8,.65)';
        ctx.fillRect(p.x + (t - w) / 2, p.y - 5, w, 3);
        ctx.fillStyle = c.kind === 'predator' ? '#bc4749' : '#8dbb6d';
        ctx.fillRect(p.x + (t - w) / 2, p.y - 5, w * Math.max(0, c.hp / c.maxHp), 3);
      }
    }
  }

  /* ══════════ 건물 · 공사 · 도읍 ══════════ */
  var doneBounce = {};      // structureId → 완공 연출 시작 시각
  var structSort = { src: null, n: -1, rev: -2, list: [] };

  function bounceStructure(id) { doneBounce[id] = animT; }

  /** y 순으로 정렬된 건물 목록 — 60fps 예산을 위해 목록이 바뀔 때만 다시 정렬한다.
      ★ §17-2 — 서명에 좌표·티어·상태를 넣는다. 개수+양끝 id 만 보던 옛 서명은
      「이전(relocate)」 뒤에도 낡은 객체를 그려 건물이 옛 자리에 남아 보였다. */
  /* ★ Sprint 3 — 서명을 **판 번호**로 바꾼다.
     옛 셈은 프레임마다 건물 수만큼 문자열을 이어 붙여(건물 50채면 50번의 문자열 잇기)
     「바뀌었는가」를 물었다. 값은 거의 언제나 같은데 묻는 값이 더 컸다.
     장부는 갱신 때 통째로 갈아 끼워지므로 **같은 배열·같은 길이**면 그대로다.
     배열 안에서 한 칸만 바꿔 끼우는 길(완공 ack)은 state 가 structuresRev 를 한 칸 민다 —
     §17-2 의 「이전한 건물이 옛 자리에 남는다」를 그 한 칸이 막는다. */
  function sortedStructures() {
    var src = S.structures();
    var rev = S.structuresRev ? S.structuresRev() : 0;
    if (structSort.src === src && structSort.n === src.length && structSort.rev === rev) return structSort.list;
    structSort.src = src; structSort.n = src.length; structSort.rev = rev;
    structSort.list = src.slice().sort(function (a, b) { return (a.y || 0) - (b.y || 0); });
    return structSort.list;
  }

  /* ★ §17-19 — 건물 스프라이트 다이얼(data/world.json render.structureSprite).
     자료가 없는 옛 세이브·모의 상태에서도 그림이 멎지 않게 옛 수치를 그대로 예비로 든다. */
  var SPRITE_FALLBACK = { scale: 1.18, pad: 0.7, baseDrop: 0.55, shiftX: 0.1 };
  function spriteCfg() {
    var w = S.worldCfg();
    return (w && w.render && w.render.structureSprite) || SPRITE_FALLBACK;
  }

  /**
   * ★ §17-19 — 건물이 그려지는 사각형(월드 좌표)의 **하나뿐인 정본**.
   * 「왜」 한 곳으로 모았나 — 그림(drawStructures)과 「얼굴을 눌러도 잡힌다」 판정(§16-20
   *   input.structureAtSprite)이 같은 식을 각자 베껴 쓰고 있었다. 스프라이트를 키우는 순간
   *   둘이 어긋나 눌러도 안 잡히는 건물이 생긴다. 이제 키우는 일도 여기 한 줄(scale)이 한다.
   * 에셋의 고유 비율을 보존하고, 지정 풋프린트의 가로·세로 한가운데에 둔다.
   * @param {object} b 건물 · @param {number} grow 준공 튀어오름 같은 덤 배율
   */
  /* ★ §19-D(F03-9) — 건물별 덤 배율(data/buildings.json spriteScale).
     「왜」 필요한가 — 분수·기념비·가로등처럼 **한 칸을 차지하지만 크게 보여야 하는 것**이 있다.
     자리(풋프린트)를 키우면 충돌·배치 격자·비용 검증이 통째로 흔들리므로, 여기서는 그림만 키운다:
     밑변과 가로 한가운데는 그대로라 건물은 제자리에 선 채 위로·옆으로만 자란다.
     클릭 판정도 같은 사각형을 쓰므로(§17-19) 「보이는데 눌러지지 않는다」가 생기지 않는다. */
  function spriteScaleOf(b) {
    var key = b && (b.key || b.building);
    var d = (key && S.buildingDef) ? S.buildingDef(key) : null;
    return (d && d.spriteScale) || 1;
  }

  /* 수작업 PNG의 최신 자리 계약. 이미 실행 중인 서버가 예전 fw/fh를 보내도
     새 칸 수로 화면·고스트·클릭 영역을 일관되게 보여 준다. */
  var HANDMADE_FOOTPRINTS = { campfire: [2, 2], tent: [3, 3], hut: [4, 4], house: [6, 5], manor: [6, 7], well: [3, 3], woodpile: [2, 2], granary: [4, 4], sawmill: [4, 4], quarry_camp: [4, 4], hunter_hut: [4, 4], storage: [4, 4], bloomery: [3, 3], trading_post: [4, 4], market: [4, 5], watchpost: [3, 4], arrow_tower: [3, 4], barracks: [6, 5], ballista: [3, 3], cannon: [4, 4], frost_tower: [4, 4], flame_tower: [4, 4], fence: [2, 2], gate: [3, 3], appraisal_post: [4, 4], consulate: [6, 6], claim_flag: [2, 2], lamp: [2, 2], banner: [2, 2], garden: [4, 4], fountain: [6, 6], library: [4, 4], workshop: [4, 4], academy: [5, 5], station: [5, 5], smelter: [3, 4], smithy: [4, 4], mill: [4, 4], ranch: [4, 4], mine_shaft: [3, 3] };
  var HQ_STAGE_FOOTPRINTS = [[2, 2], [4, 4], [5, 5], [7, 7], [9, 9], [11, 9]];
  function renderFootprint(key, fallback) {
    var f = HANDMADE_FOOTPRINTS[key];
    return f ? { w: f[0], h: f[1] } : fallback;
  }
  function structureRenderFootprint(b) {
    if (b && b.hq) {
      var hqDef = S.buildingDef(b.key || b.building) || {};
      var hqSizes = hqDef.tierFootprints || HQ_STAGE_FOOTPRINTS;
      var hqSize = hqSizes[Math.max(0, Math.min(hqSizes.length - 1, (b.tier || 1) - 1))];
      if (hqSize) return { w: hqSize[0], h: hqSize[1] };
    }
    return renderFootprint(b && (b.key || b.building), S.footprintOfThing(b));
  }
  function structureRenderCenter(b, f) {
    /* 본부는 처음의 2×2 중심에 고정한 채, 승급할수록 사방으로 자란다. */
    if (b && b.hq) return S.centerOfThing(b);
    if (b && b.x != null && b.y != null) return { x: b.x + (f.w - 1) / 2, y: b.y + (f.h - 1) / 2 };
    return S.centerOfThing(b);
  }

  function structureRect(b, grow) {
    var f = structureRenderFootprint(b);
    var c = structureRenderCenter(b, f);
    var cfg = spriteCfg();
    var layoutG = (cfg.scale || 1) * (grow || 1);
    /* 풋프린트 자체를 정렬 상자로 쓴다. 옛 렌더 여백은 넣지 않아 가로 중앙이
       실제 지정 칸의 중앙과 정확히 맞는다. */
    var slotW = f.w * layoutG, slotH = f.h * layoutG;
    var w = slotW, h = slotH;
    /* 지정한 칸 수가 최종 가로·세로를 결정한다. 모든 에셋은 이 상자를 정확히 채운다. */
    var baseY = c.y + (f.h - 1) / 2 + cfg.baseDrop;
    return { x: c.x + cfg.shiftX - w / 2, y: baseY - h, w: w, h: h, baseY: baseY };
  }

  /* 건물 footprint 주변의 시각 전환층. 충돌·배치 규칙은 바꾸지 않는다. */
  function drawBuildingApron(b, c, f, t) {
    var key = b.key || b.building || '';
    var dirt = /farm|field|lumber|camp/.test(key);
    var fill = dirt ? 'rgba(126,89,47,.18)' : 'rgba(112,106,94,.12)';
    var pad = 0.18;
    var p = GM.camera.worldToScreen(c.x - f.w / 2 - pad, c.y - f.h / 2 - pad);
    var w = (f.w + pad * 2) * t, h = (f.h + pad * 2) * t;
    var step = Math.max(2, Math.round(t * 0.16));
    var seed = String(b.id || key).length * 37 + Math.round(c.x * 17 + c.y * 29);
    function inset(i) { return ((seed + i * 31) % 3) * step; }
    ctx.save();
    /* 픽셀식 들쭉날쭉한 개간지 외곽. 테두리 선을 쓰지 않아 잔디와 녹아든다. */
    ctx.beginPath();
    ctx.moveTo(p.x + step, p.y - inset(0));
    for (var xx = step; xx < w; xx += step) ctx.lineTo(p.x + xx, p.y - inset(xx));
    for (var yy = 0; yy < h; yy += step) ctx.lineTo(p.x + w + inset(yy), p.y + yy);
    for (var rx = w; rx > 0; rx -= step) ctx.lineTo(p.x + rx, p.y + h + inset(rx));
    for (var ry = h; ry > 0; ry -= step) ctx.lineTo(p.x - inset(ry), p.y + ry);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = dirt ? '#c69b5a' : '#bdb59b';
    /* Broken tufts around the base keep the original terrain visible. */
    for (var dot = 0; dot < 16; dot += 1) {
      var edge = dot % 4;
      var q = (seed * (dot + 3) * 17) % 997;
      var dx = edge < 2 ? (q % Math.max(1, Math.round(w))) : (edge === 2 ? -step + (q % step) : w - (q % step));
      var dy = edge < 2 ? (edge === 0 ? -step + (q % step) : h - (q % step)) : (q % Math.max(1, Math.round(h)));
      ctx.fillRect(Math.round(p.x + dx), Math.round(p.y + dy), Math.max(1, Math.round(step * 0.65)), Math.max(1, Math.round(step * 0.4)));
    }
    /* A compact entry strip gives farms and camps a grounded exit, without a square pad. */
    if (dirt) {
      ctx.globalAlpha = 0.24;
      ctx.fillStyle = '#9c7340';
      ctx.fillRect(Math.round(p.x + w * 0.42), Math.round(p.y + h - step), Math.max(2, Math.round(w * 0.16)), Math.round(t * 0.42));
    }
    ctx.restore();
  }

  function drawStructures() {
    var cam = GM.camera.cam, t = cam.tile;
    var m = S.S.map;
    var sel = S.S.selection || {};
    if (m) {
      /* ★ §12-2 — 도읍 자리에는 이제 4×4 본부가 선다. 옛 '도읍 그림'은 본부가 없을 때의 대비책이다. */
      if (!S.hq()) {
        (m.towns || []).forEach(function (tw) {
          if (!tw.isPlayer) return;
          if (!GM.camera.onScreen(tw.x, tw.y, t * 2)) return;
          var p = GM.camera.worldToScreen(tw.x - 1, tw.y - 1);
          try { ctx.drawImage(GM.atlas.town(true), Math.round(p.x), Math.round(p.y), Math.ceil(t * 2), Math.ceil(t * 2)); } catch (e) {}
        });
      }
      drawAiTowns(m, t);
      /* ★ §12-6 — 무역이 열리기 전에는 상단이 없다 (서버도 빈 목록을 준다. 화면도 한 번 더 막는다) */
      (S.featOn('trade') ? (m.caravans || []) : []).forEach(function (cvn, i) {
        var ph = ((animT / 9000) + i * 0.31) % 1;
        var f = ph > 0.5 ? (1 - ph) * 2 : ph * 2;
        var x = cvn.from.x + (cvn.to.x - cvn.from.x) * f;
        var y = cvn.from.y + (cvn.to.y - cvn.from.y) * f;
        if (S.fogAt(Math.round(x), Math.round(y)) < 2) return;
        if (!GM.camera.onScreen(x, y, t)) return;
        var p2 = GM.camera.worldToScreen(x - 0.5, y - 0.4);
        try { ctx.drawImage(GM.atlas.caravan(), Math.round(p2.x), Math.round(p2.y), Math.ceil(t), Math.ceil(t * 0.75)); } catch (e) {}
      });
    }

    /* 뒤에 있는 것부터 그린다 — y 순 정렬 (목록이 바뀔 때만 다시 정렬) */
    var list = sortedStructures();
    list.forEach(function (b) {
      if (b.x == null) return;
      /* ★ §12-1 — 풋프린트 기준 렌더. 1×1 이면 옛 값과 정확히 같다(1.7칸). */
      var f = structureRenderFootprint(b);
      var c = structureRenderCenter(b, f);
      if (!GM.camera.onScreen(c.x, c.y, t * (Math.max(f.w, f.h) + 2))) return;
      var scale = 1;
      var bd = doneBounce[b.id];
      if (bd !== undefined) {
        var age = (animT - bd) / 1000;
        if (age > 0.75) delete doneBounce[b.id];
        else scale = 1 + Math.sin(Math.min(1, age / 0.75) * Math.PI) * 0.22 * (1 - age / 0.75);
      }
      /* ★ §17-19 — 사각형은 structureRect 한 곳에서만 잰다(클릭 판정도 같은 것을 쓴다) */
      var r = structureRect(b, scale);
      var w = t * r.w, h = t * r.h;
      var p = P2;                                       // ★ Sprint 3 — 되쓰는 점
      p.x = GM.camera.worldToScreenX(r.x);
      p.y = GM.camera.worldToScreenY(r.y);
      /* 본부 둘레의 광장 — 티어에 비례해 넓어진다 (§12-2) */
      if (b.hq) drawPlaza(c, t);
      else drawBuildingApron(b, c, f, t);
      /* 그림자 */
      ctx.save();
      ctx.globalAlpha = 0.24;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      try { ctx.ellipse(p.x + w / 2, p.y + h - t * 0.18, w * 0.34, w * 0.13, 0, 0, Math.PI * 2); } catch (e) {}
      ctx.fill();
      ctx.restore();
      ctx.save();
      /* 이전·철거 중이면 반투명 — 효과가 멎었다는 표시 (§12-12) */
      if (b.inactive) ctx.globalAlpha = 0.55;
      try {
        /* 본부 1단계는 실제 모닥불 PNG를 우선한다. 이후 단계는 기존 본부 외형으로
           자연스럽게 성장한다. */
        /* 정착지 단계는 0부터지만, 시작 본부 구조물은 tier 1이다. 화면의
           정착지 단계가 아니라 구조물 티어를 기준으로 골라야 첫 장면부터 새
           모닥불이 나온다. */
        var hqKey = b.key || b.building || '';
        var hqStages = ['campfire', 'hq_camp', 'hq_village', 'hq_town', 'hq_city', 'hq_royal'];
        var handmadeHq = b.hq && GM.atlas.handmadeBuilding
          ? GM.atlas.handmadeBuilding(hqStages[Math.max(0, Math.min(5, (b.tier || 1) - 1))]) : null;
        var sprite = handmadeHq || (b.hq ? GM.atlas.hall(S.tierNo(), { ruined: b.ruined })
                          : GM.atlas.building(b.key, b.tier, { ruined: b.ruined }));
        var campfireSheet = handmadeHq && hqKey === 'campfire' && GM.atlas.buildingAnimation
          ? GM.atlas.buildingAnimation(hqKey) : null;
        if (campfireSheet && campfireSheet.complete && campfireSheet.naturalWidth && !campfireSheet.failed) {
          var frameW = campfireSheet.naturalWidth / 4;
          var frame = Math.floor(animT / 135) % 4;
          ctx.drawImage(campfireSheet, frame * frameW, 0, frameW, campfireSheet.naturalHeight,
            Math.round(p.x), Math.round(p.y), Math.ceil(w), Math.ceil(h));
        } else ctx.drawImage(sprite, Math.round(p.x), Math.round(p.y), Math.ceil(w), Math.ceil(h));
      } catch (e2) {}
      ctx.restore();
      /* 개축 중 — 황금 반짝 */
      if (b.upgrading) {
        ctx.save();
        ctx.globalAlpha = 0.28 + 0.24 * Math.sin(animT / 200);
        ctx.fillStyle = '#f6cf7a';
        ctx.fillRect(p.x, p.y, w, h);
        ctx.restore();
      }
      /* 내구도 — 상했을 때만 */
      var cond = b.condition === undefined ? 1 : b.condition;
      if (cond < 0.995 && t >= 18) {
        var bw = t * 1.1;
        var bx = p.x + (w - bw) / 2, by = p.y + h - t * 0.1;
        ctx.fillStyle = 'rgba(20,14,8,.7)';
        ctx.fillRect(bx, by, bw, 4);
        ctx.fillStyle = cond < 0.35 ? '#bc4749' : (cond < 0.7 ? '#e8a33d' : '#8dbb6d');
        ctx.fillRect(bx, by, bw * cond, 4);
      }
      if (b.ruined) label('부서짐', c.x, c.y - f.h / 2 - 0.8, '#ff9d99');
      else if (b.work) label(b.work.mode === 'demolish' ? '허무는 중' : '옮기는 중',
        c.x, c.y - f.h / 2 - 0.8, '#f0a09c');
      else if (t >= 26) label(b.name + (b.tier > 1 && !b.hq ? ' ' + b.tier : ''),
        c.x, c.y + f.h / 2 + 0.3, '#f4e4bc');
      if (sel.structureId === b.id) footRing(c, f, '#e8a33d');
    });

    S.sites().forEach(function (c) {
      if (c.x == null) return;
      var sf = S.footprintOfThing(c);
      var sc = S.centerOfThing(c);
      if (!GM.camera.onScreen(sc.x, sc.y, t * (Math.max(sf.w, sf.h) + 2))) return;
      var sw = t * (sf.w + 0.6), shh = t * (sf.h + 0.6);
      var sbase = sc.y + (sf.h - 1) / 2 + 0.5;
      var p = GM.camera.worldToScreen(sc.x - (sf.w + 0.6) / 2, sbase - (sf.h + 0.6));
      try { ctx.drawImage(GM.atlas.site(c.progress), Math.round(p.x), Math.round(p.y), Math.ceil(sw), Math.ceil(shh)); } catch (e) {}
      var bx = GM.camera.worldToScreen(sc.x - (sf.w + 0.6) / 2, sbase + 0.12);
      ctx.fillStyle = 'rgba(20,14,8,.72)';
      ctx.fillRect(bx.x, bx.y, sw, 6);
      /* 철거·이전은 붉은 띠 — 짓는 일과 헐는 일을 색으로 가른다 (§12-12) */
      ctx.fillStyle = (c.mode === 'demolish' || c.mode === 'relocate') ? '#bc4749' : '#e8a33d';
      ctx.fillRect(bx.x, bx.y, sw * U.clamp(c.progress || 0, 0, 1), 6);
      if (t >= 22) label(c.name + ' ' + (c.modeName || '공사'), sc.x, sc.y + sf.h / 2 + 0.9, '#f6cf7a');
      /* 이전이면 갈 자리를 점선으로 미리 보여 준다 */
      if (c.mode === 'relocate' && c.toX != null) ghostRect(c.toX, c.toY, sf, '#8dfa8d');
      if (sel.siteId === c.id) footRing(sc, sf, '#e8a33d');
    });
  }

  /** 풋프린트 사각형을 두르는 선택 테두리 */
  function footRing(c, f, color) {
    var t = GM.camera.cam.tile;
    var p = GM.camera.worldToScreen(c.x - f.w / 2, c.y - f.h / 2);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(Math.round(p.x), Math.round(p.y), Math.ceil(f.w * t), Math.ceil(f.h * t));
    ctx.restore();
  }

  /** 좌상단 앵커 기준 점선 사각형 (이전 목적지 미리보기) */
  function ghostRect(ax, ay, f, color) {
    var t = GM.camera.cam.tile;
    var p = GM.camera.worldToScreen(ax - 0.5, ay - 0.5);
    ctx.save();
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(animT / 260);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(Math.round(p.x), Math.round(p.y), Math.ceil(f.w * t), Math.ceil(f.h * t));
    ctx.restore();
  }

  /** ★ §12-2 본부 광장 — 티어에 비례해 넓어지는 장식 바닥 */
  function drawPlaza(c, t) {
    var r = (3.2 + S.tierNo() * 0.9) * t;
    /* ★ Sprint 3 — 띠는 원점에 한 번 구워 두고 자리로 옮겨 칠한다(그림은 옛것과 같다) */
    var g = radialAt0('plaza:' + r, r * 0.2, r,
      [[0, 'rgba(146,120,86,.34)'], [0.75, 'rgba(120,98,70,.18)'], [1, 'rgba(120,98,70,0)']]);
    if (!g) return;
    ctx.save();
    ctx.translate(GM.camera.worldToScreenX(c.x), GM.camera.worldToScreenY(c.y));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ══════════ ★ §17-16 이웃 나라의 도읍 ══════════
     세 나라는 여태 교역 목록의 이름이었다 — 도읍 자리는 있는데 화면에 아무것도 서지 않았다.
     이제 안개가 걷힌 자리(fog≥1)에서만 그 집들이 보인다: 가 보지도 않은 땅의 마을이 지도에 뜨면
     탐사가 뜻을 잃는다. 스프라이트는 우리 건물과 같은 벌을 쓴다(atlas.building·hall). */
  function drawAiTowns(m, t) {
    (m.towns || []).forEach(function (tw) {
      if (tw.isPlayer) return;
      if (S.fogAt(Math.round(tw.x), Math.round(tw.y)) < 1) return;
      if (!GM.camera.onScreen(tw.x, tw.y, t * 8)) return;
      presetOf(tw).forEach(function (b) { drawPresetHouse(b, t); });
      label(tw.name || '이웃 나라', tw.x, tw.y - 3.6, '#cfe0f6');
    });
  }

  /** 뒤에 선 집부터 그린다 — 도읍 배치는 바뀌지 않으므로 한 번만 정렬해 둔다 */
  function presetOf(tw) {
    if (!tw.presetSorted) {
      tw.presetSorted = (tw.preset || []).slice().sort(function (a, b) { return a.y - b.y; });
    }
    return tw.presetSorted;
  }

  function drawPresetHouse(b, t) {
    if (S.fogAt(b.x, b.y) < 1) return;
    var big = b.key === 'hall';
    var span = big ? 2.6 : 1.7;
    var p = GM.camera.worldToScreen(b.x - span / 2 + 0.5, b.y - span + 0.9);
    var sprite = big ? GM.atlas.hall(2) : GM.atlas.building(b.key, 2);
    try { ctx.drawImage(sprite, Math.round(p.x), Math.round(p.y), Math.ceil(t * span), Math.ceil(t * span)); } catch (e) {}
  }

  /* ══════════ 적 캠프 ══════════ */
  function drawCamps() {
    var t = GM.camera.cam.tile;
    S.camps().forEach(function (c) {
      if (c.x == null) return;
      if (!GM.camera.onScreen(c.x, c.y, t * 3)) { edgeMarker(c); return; }
      var p = GM.camera.worldToScreen(c.x - 1, c.y - 1);
      try { ctx.drawImage(GM.atlas.camp(c.type), Math.round(p.x), Math.round(p.y), Math.ceil(t * 2), Math.ceil(t * 2)); } catch (e) {}
      label(c.name + (c.sizeHint ? ' · ' + c.sizeHint : ' · 규모 모름'), c.x, c.y - 1.3, '#f0a09c');
      /* ★ Sprint 5 — 두드린 만큼 줄어드는 띠. 들짐승의 그것과 같은 말투다(drawWild). */
      if (c.maxHp > 0 && c.hp < c.maxHp && t >= 18) {
        var bw = t * 1.4;
        var bx = p.x + t - bw / 2, by = p.y - 5;
        ctx.fillStyle = 'rgba(20,14,8,.65)';
        ctx.fillRect(bx, by, bw, 4);
        ctx.fillStyle = '#bc4749';
        ctx.fillRect(bx, by, bw * Math.max(0, c.hp / c.maxHp), 4);
      }
      if (!c.scouted) {
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.35 * Math.sin(animT / 320);
        ctx.strokeStyle = '#bc4749';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(p.x + t, p.y + t, t * 1.8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    });
  }

  function edgeMarker(c) {
    var p = GM.camera.worldToScreen(c.x, c.y);
    var cxp = W / 2, cyp = H / 2;
    var dx = p.x - cxp, dy = p.y - cyp;
    if (!dx && !dy) return;
    var m = 34;
    var sc = Math.min((W / 2 - m) / Math.max(1, Math.abs(dx)), (H / 2 - m) / Math.max(1, Math.abs(dy)));
    var ex = cxp + dx * sc, ey = cyp + dy * sc;
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.globalAlpha = 0.5 + 0.4 * Math.sin(animT / 300);
    ctx.fillStyle = '#bc4749';
    ctx.beginPath();
    ctx.moveTo(12, 0); ctx.lineTo(-9, -8); ctx.lineTo(-9, 8);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /* ══════════ 주민 ══════════
     ★ GDD3 §12-11 — 텔레포트 버그의 정공 해법.
       옛 코드는 "클라 보간 위치가 서버 좌표에서 10칸 넘게 벌어지면 서버 좌표로 되돌린다"는
       고무줄을 달고 있었다. 그런데 서버의 주민 좌표(u.x,u.y)는 **일 틱(기본 10분)에 한 번**
       moveTilesPerTick 만큼만 나아간다 — 클라는 초당 2.6칸으로 걸어 15칸 떨어진 나무에 몇 초 만에
       닿는다. 그 순간 벌어진 거리가 10을 넘고, 고무줄이 주민을 **출발 자리로 되돌린다.** 그리고
       다시 걷고, 다시 되돌아가고… 이것이 "이동 중 출발 위치로 반복 순간이동"의 정체다.

       고친 원칙(§12-11 그대로):
         · 직업·대상이 그대로면 **위치의 주인은 클라**다. 서버 좌표는 쳐다보지 않는다.
         · 서버가 주는 (destX,destY) 는 위치가 아니라 **목표점**이다.
         · 스냅은 **대상이 바뀐 순간에만**, 그것도 정말 멀 때(SNAP_TILES)만 한다.
       그래서 서버가 뭘 방송하든 걷던 사람이 뒤로 튀는 일이 없다.

     ★ GDD3 §12-9 — 그 위에 노동 상태 머신을 얹었다(순수 연출):
       이동 → 작업(스윙·파편·노드 흔들림) → 들짐 → 저장 궤짝/저장고로 운반 → 하역 → 복귀 */
  var SNAP_TILES = 26;          // 이만큼 멀면 '같은 사람이 걸어간 것'으로 볼 수 없다 → 그때만 스냅
  var WALK_SPEED = 2.6;
  var CARRY_JOBS = { farm: 'grain', lumber: 'wood', quarry: 'stone', mine: 'ironOre' };

  function unitSig(v) {
    return (v.job || '') + '|' + (v.targetId || '') + '|' + (v.destX == null ? v.x : v.destX)
      + ',' + (v.destY == null ? v.y : v.destY);
  }

  /** 짐을 부릴 곳 — 저장 궤짝·저장고·곡창이 있으면 가장 가까운 곳, 없으면 본부 */
  function dropSpot(from) {
    var best = null, bd = 1e9;
    var list = S.structures();
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.x == null) continue;
      if (b.key !== 'storage_crate' && b.key !== 'storage' && b.key !== 'granary' && !b.hq) continue;
      var c = S.centerOfThing(b);
      var d = Math.hypot(c.x - from.x, c.y - from.y) + (b.hq ? 6 : 0);   // 본부는 마지막 수단
      if (d < bd) { bd = d; best = { x: c.x, y: c.y, id: b.id }; }
    }
    if (best) return best;
    var t = S.myTown();
    return t ? { x: t.x, y: t.y, id: null } : null;
  }

  function faceTo(a, dx, dy) {
    a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 1) : (dy > 0 ? 0 : 3);
  }

  /** 목표점으로 한 걸음. 닿았으면 true */
  function walkStep(a, tx, ty, dt, speed) {
    var dx = tx - a.x, dy = ty - a.y;
    var d = Math.hypot(dx, dy);
    if (d <= 0.08) { a.frame = 0; return true; }
    var mv = Math.min(d, (speed || WALK_SPEED) * dt);
    a.x += dx / d * mv; a.y += dy / d * mv;
    faceTo(a, dx, dy);
    a.ft += dt;
    if (a.ft > 0.22) { a.ft = 0; a.frame = a.frame ? 0 : 1; }
    return false;
  }

  /* ★ Sprint 1 — 주민 걸음의 통행 판정. avatar.walkable 과 같은 「사람」 규칙(지형 + 다리·매립).
     걷기 연출에는 판정이 아예 없어 주민이 호수를 그대로 질러 걸었다. */
  /* ★ Sprint 3 — 걸을 수 있는 지형을 **표**로 세워 둔다. 길찾기(A*)가 칸마다 이 판정을
     부르므로 길 한 번에 수천 번이 걸리는데, 옛 셈은 그때마다 설정을 꺼내 배열을 훑었다.
     설정 객체는 좀처럼 바뀌지 않으니 같은 배열이면 세워 둔 표를 그대로 쓴다(값은 같다). */
  var WALK_FALLBACK = ['grass', 'forest', 'rock', 'fertile', 'snow', 'jungle',
    /* ★ §19-F2(F07-1) — 새로 붙은 여섯 땅도 걸을 수 있다. 정본은 서버 설정(terrain.walkable)이고
       이 목록은 설정이 오기 전 몇 프레임을 버티는 폴백이다 — 빠지면 그 땅에서 「밟을 수 없다」가 된다. */
    'desert', 'marsh', 'ash', 'mush', 'salt', 'dusk'];
  var walkTable = { src: null, map: null };
  function walkableCodes() {
    var w = S.worldCfg();
    var list = (w && w.terrain && w.terrain.walkable) || WALK_FALLBACK;
    if (walkTable.src !== list) {
      var map = {};
      for (var i = 0; i < list.length; i++) map[list[i]] = 1;
      walkTable.src = list; walkTable.map = map;
    }
    return walkTable.map;
  }

  function waterMargin(x, y) {
    var m = S.S.map;
    if (!m || !m.codes) return false;
    var cx = Math.round(x), cy = Math.round(y);
    for (var dy = -1; dy <= 1; dy += 1) for (var dx = -1; dx <= 1; dx += 1) {
      var nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && ny >= 0 && nx < m.size && ny < m.size && m.codes[m.terrain[ny * m.size + nx]] === 'water') return true;
    }
    return false;
  }

  function unitWalkable(x, y) {
    var code = S.terrainKey(Math.round(x), Math.round(y));
    if (!code) return false;
    if (code === 'water') return S.onBridge(x, y) || S.onFill(x, y);
    if (waterMargin(x, y)) return false;
    return walkableCodes()[code] === 1;
  }

  /**
   * ★ Sprint 1 — 길을 따라 목표점으로. walkStep 의 자리에 서는 물-우회 판.
   * 길은 목표가 바뀔 때 **한 번만** 낸다(a.pathKey) — 주민 60명이 프레임마다 A* 를 돌리지 않는다.
   * 목표가 물이면 GM.path 가 곁의 뭍으로 스냅하고, 못 닿으면 갈 수 있는 데까지 간다.
   * 닿았으면(또는 더 갈 수 없으면) true.
   */
  /**
   * ★ Sprint 3 — 한 프레임에 낼 수 있는 길의 수(예산).
   *
   * 「왜」 — 길은 목표가 바뀔 때 한 번만 낸다는 계약은 지켜지고 있었다. 문제는 **언제**다:
   * 날이 넘어가며 서버가 주민 예순 명의 일터를 한꺼번에 갈아 주면, 예순 개의 pathKey 가
   * **같은 프레임에** 바뀐다 — A* 한 번이 1~5ms 라 그 프레임 하나가 100ms 를 넘게 멎었다
   * (인구가 늘수록 정확히 그만큼 더 크게 멎는 「인구에 비례하는 딸꾹질」의 정체).
   * 이제 한 프레임에는 pathFindsPerFrame 만큼만 새로 내고, 못 낸 사람은 다음 프레임에 낸다.
   * 기다리는 동안 가만히 서 있으면 온 마을이 굳어 보이므로 목표 쪽으로 곧장 한 걸음 떼되,
   * **딛을 칸이 뭍일 때만** 뗀다 — 물 위를 걸어 건너던 Sprint 1 이전의 사고를 되살리지 않는다.
   */
  function resetPathBudget() {
    var n = perfCfg().pathFindsPerFrame;
    pathBudget = (typeof n === 'number' && n >= 0) ? n : PERF_FALLBACK.pathFindsPerFrame;
  }
  var pathBudget = 2;

  /** 예산이 빈 프레임의 임시 걸음 — 다음 발끝이 뭍이 아니면 서서 기다린다 */
  function straightStep(a, tx, ty, dt, speed) {
    var dx = tx - a.x, dy = ty - a.y;
    var d = Math.hypot(dx, dy);
    if (d <= 0.08) { a.frame = 0; return true; }
    var mv = Math.min(d, (speed || WALK_SPEED) * dt);
    var nx = a.x + dx / d * mv, ny = a.y + dy / d * mv;
    if (!unitWalkable(nx, ny)) { a.frame = 0; return false; }   // 물가에서는 선다 — 길이 나면 돌아간다
    a.x = nx; a.y = ny;
    faceTo(a, dx, dy);
    a.ft += dt;
    if (a.ft > 0.22) { a.ft = 0; a.frame = a.frame ? 0 : 1; }
    return false;
  }

  function walkAlong(a, tx, ty, dt, speed) {
    var key = Math.round(tx) + ',' + Math.round(ty);
    if (a.pathKey !== key) {
      a.pathKey = key;
      a.path = null; a.pathI = 1;
      a.pathPending = true;                                // 길은 예산이 허락하는 프레임에 낸다
    }
    if (a.pathPending) {
      if (pathBudget <= 0 || !(GM.path && GM.path.find)) return straightStep(a, tx, ty, dt, speed);
      pathBudget -= 1;
      var t0 = nowMs();
      a.path = GM.path.find(a.x, a.y, tx, ty, unitWalkable);
      pathMs += nowMs() - t0; pathCalls += 1;
      a.pathI = 1;
      a.pathPending = false;
    }
    if (!a.path) return walkStep(a, tx, ty, dt, speed);   // 제자리·못 가는 곳 — 옛 직선 걸음이 안전망
    /* 다음 웨이포인트를 고른다 — 밟은 것은 접는다 */
    while (a.pathI < a.path.length
      && Math.hypot(a.path[a.pathI].x - a.x, a.path[a.pathI].y - a.y) <= 0.1) a.pathI += 1;
    if (a.pathI >= a.path.length) {
      var end = a.path[a.path.length - 1];
      /* 길 끝이 곧 도착이다 — 목표가 물이었어도 끝(뭍)까지 왔으면 닿은 것으로 친다 */
      return walkStep(a, end.x, end.y, dt, speed);
    }
    var wp = a.path[a.pathI];
    if (walkStep(a, wp.x, wp.y, dt, speed)) a.pathI += 1;
    return false;
  }

  /**
   * ★ §12-9 노동 루프 — ★ GDD3 §14-1 로 **순수 연출**이 되었다.
   *
   * 옛 규칙(§13-A-3)은 화면이 짐을 시간만큼 쌓아 두었다가 하역하는 순간 숫자를 띄웠다.
   * 실측해 보니 그 순간이 오기까지 **154초**였고(자루 하나 = 하루길이÷4 = 150초 + 걸어가는 시간),
   * 국고는 그동안 한 톨도 안 움직였다(일 틱 600초). 그것이 "일해도 안 늘고 플로팅도 안 뜬다"의 정체다.
   *
   * 이제 수치는 **서버가 사이클마다 곧바로** 넣고 residentWork 로 알려 준다(creditFloat).
   * 여기 남은 것은 그림뿐이다: 휘두르고, 지고, 날라 부리고, 돌아온다. 자루는 **시간으로만** 찬다
   * (deliveriesPerDay 는 이제 왕복 빈도 다이얼일 뿐 크레딧과 무관하다).
   */
  /* ★ Sprint 2 — 건설 주민의 망치질. 옛 화면은 farm/lumber/quarry/mine 만 작업 연출이 있어
     서버가 「짓는 중」으로 아는 사람도 화면에서는 미동 없이 서 있었다 — "주민이 논다"의 체감 절반.
     수치는 서버 몫(buildPoints)이고 여기는 그림뿐이다: 몸이 기울고(스윙 포즈) 먼지가 인다. */
  function stepBuild(v, a, dt) {
    var site = null;
    var list = S.sites();
    for (var i = 0; i < list.length; i++) if (list[i].id === v.targetId) { site = list[i]; break; }
    if (!site || site.x == null) { a.phase = 'idle'; a.carry = 0; return false; }
    var wk = S.villagerWorkCfg();
    a.swingT = (a.swingT || 0) + dt;
    a.pose = Math.max(0, 1 - (a.swingT % wk.swingSeconds) / (wk.swingSeconds * 0.47));
    faceTo(a, site.x - a.x, site.y - a.y);
    if (a.swingT - (a.lastHit || 0) >= wk.swingSeconds) {
      a.lastHit = a.swingT;
      if (GM.fx) GM.fx.dust(site.x, site.y, 2, '#c8a874');
    }
    return true;
  }

  function stepWork(v, a, dt) {
    if (v.job === 'build') return stepBuild(v, a, dt);
    var res = CARRY_JOBS[v.job];
    var node = v.targetId ? S.nodeById(v.targetId) : null;
    if (!res || !node) { a.phase = 'idle'; a.carry = 0; return false; }
    a.home = a.home || { x: node.x, y: node.y };
    a.home.x = node.x; a.home.y = node.y;

    var wk = S.villagerWorkCfg();
    var working = !!(v.yield && v.yield.resource === res && v.yield.perDay > 0);
    /* 왕복 한 번에 걸리는 시간 — 하루를 deliveriesPerDay 로 나눈 것(순수 연출 박자) */
    var haulEvery = S.dayRealSeconds() / Math.max(1, wk.deliveriesPerDay);

    if (a.phase === 'work') {
      a.swingT = (a.swingT || 0) + dt;
      a.pose = Math.max(0, 1 - (a.swingT % wk.swingSeconds) / (wk.swingSeconds * 0.47));
      faceTo(a, node.x - a.x, node.y - a.y);
      if (a.swingT - (a.lastHit || 0) >= wk.swingSeconds) {
        a.lastHit = a.swingT;
        if (GM.fx) {
          GM.fx.shakeNode(node.id, 0.45);
          GM.fx.debris(node.x, node.y, S.nodeMeta(node.type).color, 3, 0.6);
        }
      }
      /* 일하지 않는 사람(고갈된 노드 등)은 나르지 않는다 — 헛걸음을 보이지 않는다 */
      if (working && a.swingT >= haulEvery) {
        a.carry = 1; a.phase = 'haul'; a.drop = dropSpot(a); a.swingT = 0; a.pose = 0;
      }
      return true;
    }
    if (a.phase === 'haul') {
      if (!a.drop) { a.phase = 'work'; return true; }
      if (walkAlong(a, a.drop.x, a.drop.y, dt, WALK_SPEED * 0.86)) { a.phase = 'unload'; a.unloadT = 0; }
      return true;
    }
    if (a.phase === 'unload') {
      a.unloadT = (a.unloadT || 0) + dt;
      if (a.unloadT > 0.55) {
        /* 부리는 그림만 남았다 — 숫자는 서버가 사이클마다 이미 띄웠다(§14-1) */
        if (GM.fx) GM.fx.dust(a.x, a.y, 4, '#c8a874');
        a.carry = 0;
        a.phase = 'return';
      }
      return true;
    }
    if (a.phase === 'return') {
      if (walkAlong(a, a.home.x, a.home.y, dt, WALK_SPEED)) { a.phase = 'work'; a.swingT = 0; a.lastHit = 0; }
      return true;
    }
    return false;
  }

  /**
   * ★ GDD3 §14-1 — 서버가 방금 곳간에 넣은 한 사이클 몫을 그 사람 자리에 띄운다.
   *   연출 좌표(units[id])가 있으면 그 자리에, 없으면 서버가 준 좌표에 띄운다.
   *   숫자 서식은 플레이어 스윙과 같다("+0.11 목재") — 값이 작을수록 소수 자리를 늘려 0 이 안 뜬다.
   */
  function creditFloat(c) {
    if (!c || !GM.fx) return false;
    var a = units[c.id];
    var x = a ? a.x : c.x;
    var y = a ? a.y : c.y;
    if (!GM.camera.onScreen(x, y, GM.camera.cam.tile * 3)) return false;
    var meta = S.resourceMeta(c.resource) || {};
    var n = Number(c.amount) || 0;
    if (n <= 0) return false;
    var digits = n >= 10 ? 0 : (n >= 1 ? 1 : 2);
    GM.fx.floatText(x, y - 0.9, '+' + U.fmt(n, digits) + ' ' + (meta.name || c.resource),
      meta.color || '#f6e6a8', 12);
    GM.fx.resourcePop(x, y - 0.4, c.resource, '', meta.color);
    return true;
  }

  /**
   * ★ GDD3 §15-A-2 — 터렛이 잡은 자리.
   *   드롭은 서버가 이미 국고에 넣었다(저장 상한도 서버가 지켰다). 여기서는 **그 자리에** 값을 띄운다.
   *   한 마리가 여러 자원을 떨구면 줄을 조금씩 어긋나게 쌓아 서로 가리지 않게 한다.
   */
  function turretKillFloat(k) {
    if (!k || !GM.fx) return false;
    var x = Number(k.x) || 0, y = Number(k.y) || 0;
    if (!GM.camera.onScreen(x, y, GM.camera.cam.tile * 3)) return false;
    GM.fx.debris(x, y, '#bc4749', 7, 0.9);
    GM.fx.ring(x, y, '#f6cf7a', 0.2, 1.3, 0.5);
    var keys = Object.keys(k.gained || {});
    if (!keys.length) {
      GM.fx.floatText(x, y - 0.9, (k.name || '') + ' 처치', '#dcd0b4', 11);
      return true;
    }
    keys.forEach(function (r, i) {
      var meta = S.resourceMeta(r) || {};
      var n = Number(k.gained[r]) || 0;
      if (n <= 0) return;
      var digits = n >= 10 ? 0 : (n >= 1 ? 1 : 2);
      GM.fx.floatText(x, y - 0.9 - i * 0.55, '+' + U.fmt(n, digits) + ' ' + (meta.name || r),
        meta.color || '#f6e6a8', 12);
      GM.fx.resourcePop(x, y - 0.4, r, '', meta.color);
    });
    return true;
  }

  function stepUnits(dt) {
    var list = S.residents();
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      seen[v.id] = 1;
      var a = units[v.id];
      var sig = unitSig(v);
      if (!a) {
        /* 처음 본 사람 — 서버가 아는 자리에서 시작한다 */
        a = units[v.id] = { x: v.x, y: v.y, dir: 0, frame: 0, ft: 0, sig: sig,
                            phase: 'travel', carry: 0, pose: 0 };
      }
      if (a.sig !== sig) {
        /* ★ 대상이 바뀌었다 — 이때만 스냅을 따진다. 그것도 '걸어서는 못 갈 거리'일 때만. */
        a.sig = sig;
        a.phase = 'travel';
        a.carry = 0; a.pose = 0; a.swingT = 0; a.lastHit = 0; a.drop = null; a.home = null;
        a.path = null; a.pathKey = null;      // ★ Sprint 1 — 대상이 바뀌면 길도 새로 낸다
        a.pathPending = true;                 // ★ Sprint 3 — 다시 내는 일은 예산이 허락할 때
        if (Math.hypot(a.x - v.x, a.y - v.y) > SNAP_TILES) { a.x = v.x; a.y = v.y; }
      }

      /* 노동 루프가 돌고 있으면 이동은 그 안에서 한다 */
      if (a.phase !== 'travel' && stepWork(v, a, dt)) continue;

      var tx = v.destX == null ? v.x : v.destX;
      var ty = v.destY == null ? v.y : v.destY;
      if (walkAlong(a, tx, ty, dt)) {
        /* 일터에 닿았다 — 노동 연출로 넘어간다 */
        if (a.phase === 'travel' && CARRY_JOBS[v.job] && v.targetId && S.nodeById(v.targetId)) {
          a.phase = 'work'; a.swingT = 0; a.lastHit = 0;
        } else if (a.phase === 'travel' && v.job === 'build' && v.targetId) {
          /* ★ Sprint 2 — 공사장에 닿은 건설 주민은 망치를 든다(stepBuild) */
          a.phase = 'work'; a.swingT = 0; a.lastHit = 0;
        } else {
          a.phase = 'idle';
        }
      }
    }
    for (var id in units) if (!seen[id]) delete units[id];

    /* ★ §13-A-4 도착 표시 — 걷는 것은 진짜 주민이고, 여기서는 **이름표만** 세어 지운다 */
    for (var k = walkIns.length - 1; k >= 0; k--) {
      walkIns[k].t += dt;
      if (walkIns[k].t > 12 || !units[walkIns[k].id]) walkIns.splice(k, 1);
    }
  }

  /**
   * ★ GDD3 §13-A-4 — 새로 온 사람을 **표시**한다. 몸을 하나 더 만들지 않는다.
   *
   * 고친 버그: 한 명이 왔는데 두 명이 걸어 들어왔다.
   *   서버는 처음부터 주민을 **영토 밖에 세우고** destX,destY 를 마을로 잡아 준다 —
   *   즉 진짜 주민이 이미 스스로 걸어 들어온다. 그런데 화면은 residentArrived 를 받고
   *   똑같은 자리에서 똑같은 외형·이름의 **연출용 유령**을 하나 더 걸었다.
   *   둘은 속도(2.4 vs 2.6)와 도착점이 살짝 달라 나란히 걷는 두 사람으로 보였다.
   * 이제 유령은 없다. 진짜 주민 머리 위에 이름표를 잠시 띄울 뿐이다.
   */
  function markArrival(id, name) {
    if (!id) return;
    for (var i = 0; i < walkIns.length; i++) if (walkIns[i].id === id) return;
    walkIns.push({ id: id, name: name || '새 사람', t: 0 });
    if (walkIns.length > 6) walkIns.shift();
  }

  function drawResidents() {
    var cam = GM.camera.cam, t = cam.tile;
    var sel = (S.S.selection && S.S.selection.residents) || [];
    var list = S.residents();
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      var a = units[v.id];
      if (!a) continue;
      if (!GM.camera.onScreen(a.x, a.y, t * 2)) continue;
      var w = t * 0.72, h = t * 0.92;
      var p = P2;                                       // ★ Sprint 3 — 되쓰는 점
      p.x = GM.camera.worldToScreenX(a.x - 0.36);
      p.y = GM.camera.worldToScreenY(a.y - 0.8);
      if (sel.indexOf(v.id) >= 0) {
        ctx.save();
        ctx.strokeStyle = '#8dfa8d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        try { ctx.ellipse(p.x + w / 2, p.y + h, w * 0.55, w * 0.3, 0, 0, Math.PI * 2); } catch (e) {}
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      try { ctx.ellipse(p.x + w / 2, p.y + h - 1, w * 0.35, w * 0.15, 0, 0, Math.PI * 2); } catch (e2) {}
      ctx.fill();
      ctx.restore();
      var sp = v.appearance
        ? GM.atlas.avatar(v.appearance, a.dir, a.frame, { crown: false })
        : GM.atlas.folk(v.job, a.dir, a.frame);
      /* ★ §12-9 — 작업 중이면 몸이 앞으로 기울고(스윙), 짐을 지면 살짝 눌린다 */
      var lean = (a.pose || 0) * 0.28;
      if (lean > 0.01) {
        ctx.save();
        ctx.translate(p.x + w / 2, p.y + h);
        ctx.rotate((a.dir === 1 ? lean : -lean) * 0.5);
        ctx.translate(-(p.x + w / 2), -(p.y + h));
      }
      try { ctx.drawImage(sp, Math.round(p.x), Math.round(p.y), Math.ceil(w), Math.ceil(h)); } catch (e3) {}
      if (lean > 0.01) ctx.restore();
      /* 들짐 — 머리 위 자루 */
      if ((a.carry || 0) > 0 && (a.phase === 'haul' || a.phase === 'unload')) {
        ctx.save();
        ctx.fillStyle = '#8a5e33';
        ctx.fillRect(Math.round(p.x + w * 0.18), Math.round(p.y - t * 0.22), Math.ceil(w * 0.64), Math.ceil(t * 0.24));
        ctx.fillStyle = '#c8a874';
        ctx.fillRect(Math.round(p.x + w * 0.18), Math.round(p.y - t * 0.22), Math.ceil(w * 0.64), Math.max(1, Math.ceil(t * 0.06)));
        ctx.restore();
      }
      if (v.militia) {
        ctx.fillStyle = '#bc4749';
        ctx.fillRect(p.x + w - 3, p.y - 2, 4, 4);
      }
      if (t >= 26 && v.job && v.job !== 'idle') {
        var im = GM.icons.canvas(S.jobMeta(v.job).icon, 11);
        if (im) { try { ctx.drawImage(im, Math.round(p.x + w * 0.15), Math.round(p.y - 12), 11, 11); } catch (e4) {} }
      }
    }

    /* ★ §13-A-4 — 막 도착한 사람의 이름표. 몸은 위에서 이미 한 번 그렸다(하나뿐이다). */
    for (var k = 0; k < walkIns.length; k++) {
      var wi = walkIns[k];
      var wa = units[wi.id];
      if (!wa || !GM.camera.onScreen(wa.x, wa.y, t * 2)) continue;
      label(wi.name, wa.x, wa.y - 1.15, '#f6e6a8');
    }
  }

  /* ══════════ 아바타 ══════════ */
  /* ★ GDD3 §15-C — 동료가 지금 무엇을 하고 있는가. 이름표 밑에 한 낱말로 적는다:
     서 있기만 하는 사람과 일하러 가는 사람이 눈으로 갈려야 「살아 있다」가 된다. */
  var CREW_DOING = {
    node: '캐는 중', site: '짓는 중', creature: '싸우는 중', enemy: '싸우는 중',
    haul: '나르는 중', rest: '쉬는 중', flee: '물러나는 중', down: '쓰러짐', idle: '',
    /* ★ §17-11 — 수동 지시(동료 패널의 「이곳으로 보낸다」)를 받은 사람 */
    move: '지시받은 곳으로', hold: '지시 대기',
    patrol: '오가는 중'   /* ★ Sprint 2 — 크레딧을 기다리며 일터와 곳간을 오간다 */
  };

  function drawAvatars() {
    var t = GM.camera.cam.tile;
    var mine = S.S.avatarId;
    var boarding = GM.opening && GM.opening.busy() && !GM.opening.dropped();
    (S.S.avatars || []).forEach(function (a) {
      if (a.id === mine) return;
      if (boarding) return;                        // ★ §16-7b — 아직 마차 안이다(내리면 그린다)
      var m = mates[a.id] || { x: a.x, y: a.y, dir: 0, frame: 0 };
      if (!GM.camera.onScreen(m.x, m.y, t * 2)) return;
      /* 이름표 색이 사람과 동료를 가른다: 같이 온 사람은 푸른빛, 동료는 저마다의 빛깔이다. */
      var color = a.bot ? (a.color || '#8fe3b4') : '#a8c8ff';
      drawLord(m.x, m.y, a.appearance, m.dir, m.frame, a.name || '개척자', color, a.id, a.role, 0, null, a.down);
      if (!a.bot) return;
      var doing = a.down ? CREW_DOING.down : (CREW_DOING[a.state] || '');
      var sub = a.roleName ? (a.roleName + (doing ? ' · ' + doing : '')) : doing;
      if (sub) label(sub, m.x, m.y - 0.42, 'rgba(240,235,220,.86)');
    });
    var me = GM.avatar && GM.avatar.pos();
    // ★ §12-7 — 마차가 굴러오는 동안 개척자는 아직 마차 안에 있다. 내리는 순간 나타난다.
    if (me && !(GM.avatar.isHidden && GM.avatar.isHidden())) {
      var sw = GM.swing ? GM.swing.pose() : { phase: 0, tool: null };
      /* ★ §19-A — 이름표는 **제가 적어 넣은 이름**이다. '그대'로 못 박아 두었더니 여럿이 함께 있을 때
         내 머리 위만 2인칭이 떠서, 팀원 화면의 내 이름과도 어긋났다(2인칭은 문장에서만 쓴다). */
      drawLord(me.x, me.y, S.S.you.appearance, me.dir, me.frame, S.myName(), '#f6cf7a', mine,
        S.myRole(), sw.phase, sw.tool, S.downed());
    }
  }

  /** ★ §12-5 — 우클릭 이동 마커. 목적지에 링이 남아 "어디로 가는지"가 보인다. */
  function drawMoveMarker() {
    if (!GM.avatar || !GM.avatar.destPos) return;
    var d = GM.avatar.destPos();
    if (!d) return;
    var p = GM.camera.worldToScreen(d.x, d.y);
    var t = GM.camera.cam.tile;
    var k = (animT / 700) % 1;
    ctx.save();
    ctx.strokeStyle = '#8dfa8d';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.85 - k * 0.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, t * (0.28 + k * 0.34), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(p.x, p.y, t * 0.14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawLord(x, y, app, dir, frame, name, nameColor, avatarId, role, swingPhase, tool, down) {
    var t = GM.camera.cam.tile;
    var p = GM.camera.worldToScreen(x - 0.42, y - 1.05);
    var w = t * 0.88, h = t * 1.14;
    var roleW = t * 1.45, roleH = t * 1.85;
    var roleX = p.x - (roleW - w) / 2;
    // 원본 도트 프레임의 발 아래 투명 여백을 상쇄해 실제 발과 그림자가 맞닿게 한다.
    var roleY = p.y - (roleH - h) + t * 0.12;
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    try { ctx.ellipse(p.x + w / 2, p.y + h - 1, w * 0.4, w * 0.18, 0, 0, Math.PI * 2); } catch (e) {}
    ctx.fill();
    ctx.restore();
    ctx.save();
    var mine = GM.avatar && avatarId === (S.you() && S.you().avatarId);
    var roleSprite = role && GM.roleSprites ? GM.roleSprites.get(role, dir, frame) : null;
    if (down) {
      ctx.translate(p.x + w / 2, p.y + h);
      ctx.rotate(-Math.PI / 2.2);
      ctx.globalAlpha = 0.75;
      try {
        if (roleSprite) ctx.drawImage(roleSprite, 50, 55, 144, 135, 0, -roleW / 2, Math.ceil(roleW), Math.ceil(roleH));
        else ctx.drawImage(GM.atlas.avatar(app, dir, 0), 0, -w / 2, Math.ceil(w), Math.ceil(h));
      } catch (e1) {}
      ctx.restore();
      label(name + ' — 쓰러짐', x, y - 2.05, '#ff9d99');
      return;
    }
    try {
      /* ★ GDD3 §13-D-3 — 내 아바타에는 벼린 것이 그대로 실린다(동료의 장비는 서로 보이지 않는다) */
      var gear = mine && GM.avatar.gear ? GM.avatar.gear() : null;
      if (roleSprite) {
        ctx.drawImage(roleSprite, 50, 55, 144, 135, Math.round(roleX), Math.round(roleY), Math.ceil(roleW), Math.ceil(roleH));
      } else {
        ctx.drawImage(GM.atlas.avatar(app, dir, frame, { swing: swingPhase, tool: tool, gear: gear }),
          Math.round(p.x), Math.round(p.y), Math.ceil(w), Math.ceil(h));
      }
    } catch (e2) {}
    ctx.restore();
    if (name && t >= 16) label(name, x, y - 2.05, nameColor || '#f4e4bc');
    var bub = GM.social && avatarId ? GM.social.bubbleFor(avatarId) : null;
    if (bub) label(bub, x, y - 2.85, '#fff6dc');
  }

  /** 스윙 쿨타임 링 — 내 발밑에 남은 시간을 그린다 */
  function drawCooldownRing() {
    if (!GM.swing) return;
    var c = GM.swing.cooldown();
    var me = GM.avatar && GM.avatar.pos();
    if (!me || c.ratio >= 1) return;
    var t = GM.camera.cam.tile;
    var p = GM.camera.worldToScreen(me.x, me.y);
    ctx.save();
    ctx.lineWidth = Math.max(2.5, t * 0.11);
    ctx.strokeStyle = 'rgba(20,14,8,.45)';
    ctx.beginPath();
    ctx.arc(p.x, p.y + t * 0.15, t * 0.52, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#f6cf7a';
    ctx.beginPath();
    ctx.arc(p.x, p.y + t * 0.15, t * 0.52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * c.ratio);
    ctx.stroke();
    ctx.restore();
  }

  /* ══════════ 고스트 미리보기 ══════════ */
  function drawGhost() {
    var pl = S.S.placing;
    if (!pl) return;
    var t = GM.camera.cam.tile;

    if (pl.kind === 'fence') {
      drawFenceGhost();
      return;
    }
    if (pl.kind === 'rail') {
      drawRailGhost();
      return;
    }
    /* ★ §17-13 — 다리·매립도 철로와 같은 끌기 고스트를 쓴다(칸 판정·값만 다르다) */
    if (pl.kind === 'bridge' || pl.kind === 'fill') {
      drawOverlayGhost(pl.kind);
      return;
    }
    if (hoverTile.x < 0) return;
    var v = GM.build ? GM.build.validate(pl, hoverTile.x, hoverTile.y) : { ok: true };
    /* ★ §12-1 — 고스트도 풋프린트 사각형 전체를 보여 준다 (놓기 전에 "얼마나 큰지"가 보여야 한다) */
    var key = pl.kind === 'build' ? pl.key : (pl.kind === 'relocate' ? pl.key : null);
    var previewDef = key ? (S.buildingDef(key) || {}) : {};
    var previewStages = previewDef.tierFootprints || HQ_STAGE_FOOTPRINTS;
    var previewSize = previewDef.hq ? previewStages[Math.max(0, Math.min(previewStages.length - 1, S.tierNo()))] : null;
    var f = previewSize ? { w: previewSize[0], h: previewSize[1] } : (key ? renderFootprint(key, S.footprintOf(key)) : { w: 1, h: 1 });
    var a0 = key ? { x: Math.round(hoverTile.x) - Math.floor((f.w - 1) / 2), y: Math.round(hoverTile.y) - Math.floor((f.h - 1) / 2) } : { x: hoverTile.x, y: hoverTile.y };
    var cxy = { x: a0.x + (f.w - 1) / 2, y: a0.y + (f.h - 1) / 2 };
    var p = GM.camera.worldToScreen(a0.x - 0.5, a0.y - 0.5);
    ctx.save();
    ctx.globalAlpha = 0.7;
    if (key) {
      var gw = t * (f.w + 0.7), gh = t * (f.h + 0.7);
      var gbase = cxy.y + (f.h - 1) / 2 + 0.55;
      var gp = GM.camera.worldToScreen(cxy.x - (f.w + 0.7) / 2 + 0.1, gbase - (f.h + 0.7));
      try {
        var hqPreview = previewDef.hq;
        var previewStagesKeys = ['campfire', 'hq_camp', 'hq_village', 'hq_town', 'hq_city', 'hq_royal'];
        var handmadePreview = hqPreview && GM.atlas.handmadeBuilding
          ? GM.atlas.handmadeBuilding(previewStagesKeys[Math.max(0, Math.min(5, S.tierNo()))]) : null;
        var gs = handmadePreview || (hqPreview ? GM.atlas.hall(S.tierNo()) : GM.atlas.building(key, 1));
        ctx.drawImage(gs, Math.round(gp.x), Math.round(gp.y), Math.ceil(gw), Math.ceil(gh));
      } catch (e) {}
    }
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = v.ok ? '#6a994e' : '#bc4749';
    ctx.fillRect(p.x, p.y, t * f.w, t * f.h);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.strokeStyle = v.ok ? '#8dfa8d' : '#ff9d99';
    ctx.strokeRect(p.x, p.y, t * f.w, t * f.h);
    ctx.restore();
    /* ★ §15-A-4 — 놓기 전에 어디까지 닿는지 보여 준다. 이것이 "터렛이 안 쏜다"의 예방약이다. */
    var tur = key ? S.turretSpecOf(key, 1) : null;
    if (tur && tur.range) rangeCircle(cxy.x, cxy.y, tur.range, v.ok ? '#f6cf7a' : '#ff9d99', true);
    var lby = a0.y - 1.25;
    if (!v.ok && v.reason) label(v.reason, cxy.x, lby, '#ff9d99');
    else if (v.ok && v.note) label(v.note, cxy.x, lby, '#b8f0a0');
    else if (tur && tur.range) label(turretReachNote(cxy.x, cxy.y, tur.range), cxy.x, lby, '#f6cf7a');

    if (pl.kind === 'reclaim' && pl.drag) {
      var a = pl.drag;
      var x0 = Math.min(a.x0, hoverTile.x), x1 = Math.max(a.x0, hoverTile.x);
      var y0 = Math.min(a.y0, hoverTile.y), y1 = Math.max(a.y0, hoverTile.y);
      var q = GM.camera.worldToScreen(x0 - 0.5, y0 - 0.5);
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#e0c65a';
      ctx.fillRect(q.x, q.y, (x1 - x0 + 1) * t, (y1 - y0 + 1) * t);
      ctx.restore();
    }
  }

  /** 울타리 드래그 — 지금 긋고 있는 선을 미리 보여 준다 */
  function drawFenceGhost() {
    var t = GM.camera.cam.tile;
    var pts = fencePath ? fencePath.slice() : [];
    if (hoverTile.x >= 0) pts = pts.concat([{ x: hoverTile.x, y: hoverTile.y }]);
    if (!pts.length) return;
    ctx.save();
    ctx.globalAlpha = 0.85;
    for (var i = 0; i < pts.length; i++) {
      var okHere = GM.build ? GM.build.fenceTileOk(pts[i].x, pts[i].y) : true;
      var p = GM.camera.worldToScreen(pts[i].x - 0.5, pts[i].y - 0.5);
      ctx.fillStyle = okHere ? 'rgba(140,250,140,.35)' : 'rgba(220,90,90,.4)';
      ctx.fillRect(p.x, p.y, t, t);
      if (i > 0) {
        var a = GM.camera.worldToScreen(pts[i - 1].x, pts[i - 1].y);
        var b = GM.camera.worldToScreen(pts[i].x, pts[i].y);
        ctx.strokeStyle = '#a3703f';
        ctx.lineWidth = Math.max(3, t * 0.2);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.restore();
    var cost = GM.build ? GM.build.fenceCostText(pts.length) : '';
    if (cost) label(cost, pts[pts.length - 1].x, pts[pts.length - 1].y - 1.2, '#f6cf7a');
  }

  /** ★ §13-D-5 — 철로 고스트. 지나간 칸이 그대로 놓일 자리다(선분이 아니다). */
  function drawRailGhost() {
    var t = GM.camera.cam.tile;
    var pts = fencePath ? fencePath.slice() : [];
    if (hoverTile.x >= 0) pts = pts.concat([{ x: hoverTile.x, y: hoverTile.y }]);
    if (!pts.length) return;
    ctx.save();
    ctx.globalAlpha = 0.8;
    for (var i = 0; i < pts.length; i++) {
      var okHere = GM.build ? GM.build.railTileOk(pts[i].x, pts[i].y) : true;
      var p = GM.camera.worldToScreen(pts[i].x - 0.5, pts[i].y - 0.5);
      ctx.fillStyle = okHere ? 'rgba(154,164,174,.5)' : 'rgba(220,90,90,.4)';
      ctx.fillRect(p.x, p.y, t, t);
    }
    ctx.restore();
    var cost = GM.build ? GM.build.railCostText(pts.length) : '';
    if (cost) label(cost, pts[pts.length - 1].x, pts[pts.length - 1].y - 1.2, '#c8d2dc');
  }

  /** ★ §17-13 — 다리·매립 고스트. 철로 고스트와 같은 문법 — 지나간 칸이 그대로 놓일 자리다. */
  function drawOverlayGhost(kind) {
    var t = GM.camera.cam.tile;
    var pts = fencePath ? fencePath.slice() : [];
    if (hoverTile.x >= 0) pts = pts.concat([{ x: hoverTile.x, y: hoverTile.y }]);
    if (!pts.length) return;
    var okColor = kind === 'bridge' ? 'rgba(138,92,51,.55)' : 'rgba(201,178,138,.55)';
    ctx.save();
    ctx.globalAlpha = 0.8;
    for (var i = 0; i < pts.length; i++) {
      var okHere = GM.build ? GM.build.overlayTileOk(kind, pts[i].x, pts[i].y) : true;
      var p = GM.camera.worldToScreen(pts[i].x - 0.5, pts[i].y - 0.5);
      ctx.fillStyle = okHere ? okColor : 'rgba(220,90,90,.4)';
      ctx.fillRect(p.x, p.y, t, t);
    }
    ctx.restore();
    var cost = GM.build ? GM.build.overlayCostText(kind, pts.length) : '';
    if (cost) label(cost, pts[pts.length - 1].x, pts[pts.length - 1].y - 1.2, '#e0cba0');
  }

  function setFencePath(pts) { fencePath = pts; }
  function getFencePath() { return fencePath; }

  /* ══════════ 선택 표시 ══════════ */
  function ringAt(x, y, color, alpha) {
    var t = GM.camera.cam.tile;
    var p = GM.camera.worldToScreen(x, y);
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, t * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * ★ GDD3 §15-A-4 — 터렛 사거리 원.
   *
   * 왜 이것이 P0 의 나머지 반쪽인가: §14-4 가 짐승을 영토 밖으로 못박은 뒤로, 본부 옆에 세운
   * 터렛은 **닿을 수가 없다**(실측: 영토 반경 16 · 사거리 7 · 짐승 최근접 11.05칸).
   * 그러니 "왜 안 쏘지"의 답은 코드만이 아니라 **눈**으로도 와야 한다 — 어디까지 닿는지를 그린다.
   * 영토 경계와 겹쳐 그려서, 원이 경계를 넘어야 바깥의 것에 닿는다는 사실이 한눈에 보이게 한다.
   */
  function rangeCircle(cx, cy, range, color, strong) {
    var t = GM.camera.cam.tile;
    var p = GM.camera.worldToScreen(cx, cy);
    var r = Math.max(2, range * t);
    ctx.save();
    ctx.globalAlpha = strong ? 0.16 : 0.10;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = strong ? 0.85 : 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.lineDashOffset = -(animT / 42) % 11;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    if (t >= 16) label('사거리 ' + U.fmt(range, 0) + '칸', cx, cy - range - 0.5, color);
  }

  /**
   * ★ §15-A-4 — 이 자리에 세우면 영토 경계 **밖** 몇 칸까지 닿는가.
   * 짐승은 영토 안으로 못 들어온다(§14-4). 그래서 경계를 못 넘는 터렛은 평생 한 발도 못 쏜다 —
   * 그 사실을 놓기 전에 한 줄로 알려 준다.
   */
  function turretReachNote(cx, cy, range) {
    var t = S.territory();
    var R = t && t.radius;
    if (!t || t.cx == null || !R) return '사거리 ' + U.fmt(range, 0) + '칸';
    var toEdge = R - Math.hypot(cx - t.cx, cy - t.cy);
    var over = range - toEdge;
    if (over >= 0.5) return '경계 밖 ' + U.fmt(over, 0) + '칸까지 닿습니다';
    return '경계에 못 미칩니다 — 바깥 짐승에 닿지 않습니다';
  }

  function drawSelectionMarks() {
    var sel = S.S.selection;
    if (!sel) return;
    if (sel.nodeId) { var n = S.nodeById(sel.nodeId); if (n) ringAt(n.x, n.y, '#e8a33d'); }
    /* ★ §15-A-4 — 터렛을 누르면 사거리가 보인다 */
    if (sel.structureId) {
      var st = S.structureById ? S.structureById(sel.structureId) : null;
      if (st && st.turret && st.turret.range) {
        var c = S.centerOfThing(st);
        rangeCircle(c.x, c.y, st.turret.range, '#f6cf7a', true);
      }
    }
    if (dragBox) {
      ctx.save();
      ctx.strokeStyle = '#8dfa8d';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.fillStyle = 'rgba(140,250,140,.12)';
      var x = Math.min(dragBox.x0, dragBox.x1), y = Math.min(dragBox.y0, dragBox.y1);
      var w = Math.abs(dragBox.x1 - dragBox.x0), h = Math.abs(dragBox.y1 - dragBox.y0);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
    /* 손이 닿는 대상 — 지금 E 를 누르면 무엇을 하는가 */
    if (GM.swing) {
      var tgt = GM.swing.target();
      if (tgt) {
        ctx.save();
        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(animT / 240);
        ringAt(tgt.x, tgt.y, '#8dfa8d', 1);
        ctx.restore();
      }
    }
  }

  /* ══════════ 밤낮 조명 4구간 — ★ GDD3 §12-10 대비 강화 ══════════
     ① 구간 전체에 걸쳐 부드럽게 섞는다(옛 코드는 마지막 25%에서만 이어 붙여 계단이 보였다)
     ② 새벽·노을에는 하늘 쪽(위)과 땅 쪽(아래)이 다른 색으로 물드는 세로 그라데이션을 얹는다
     ③ 밤에는 모닥불·본부·가로등·집 창문이 실제로 빛난다 */
  function phaseBlend() {
    var f = U.clamp(S.S.dayFraction || 0, 0, 1);
    var pos = f * 4;
    var i = Math.min(3, Math.floor(pos));
    var local = pos - i;
    var cur = S.DAY_PHASES[i];
    var nxt = S.DAY_PHASES[(i + 1) % 4];
    /* 구간의 한가운데를 '그 구간다운' 색으로 두고, 앞뒤 25%를 이웃과 섞는다 */
    var k = local < 0.25 ? (0.5 - local * 2) : (local > 0.75 ? (local - 0.75) * 2 : 0);
    var toward = local < 0.25 ? S.DAY_PHASES[(i + 3) % 4] : nxt;
    /* ★ §14-2 — 자료의 값에 플레이어의 밝기 슬라이더를 곱한다(1.0 이면 자료 그대로) */
    var dark = S.darkScale();
    var lift = S.liftBonus();
    return {
      idx: i,
      alpha: Math.max(0, U.lerp(cur.alpha, toward.alpha, k) * dark),
      tint: k > 0 ? U.mix(cur.tint, toward.tint, k) : cur.tint,
      /* ★ §13-A-2 — 어둠(alpha)과 나란히 빛(lift)도 섞는다. 낮은 따뜻하게, 밤은 달빛으로. */
      lift: Math.max(0, U.lerp(cur.lift || 0, toward.lift || 0, k) + lift),
      liftColor: k > 0 ? U.mix(cur.liftColor || '#ffffff', toward.liftColor || '#ffffff', k) : (cur.liftColor || '#ffffff'),
      sky: cur.sky, ground: cur.ground,
      skyK: (1 - Math.abs(local - 0.5) * 0.8) * dark,
      dark: dark
    };
  }

  function drawDayNight() {
    var ph = phaseBlend();
    if (ph.alpha >= 0.01) {
      ctx.save();
      ctx.globalAlpha = ph.alpha;
      ctx.fillStyle = ph.tint;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    /* ★ §13-A-2 밝기 하한 — 어둠을 덜어 내는 것만으로는 낮이 밝아지지 않는다(낮은 이미 alpha 0).
       그래서 빛을 **더한다**. 밤에는 이 항이 달빛이 되어 칠흑을 막는 바닥이 된다. */
    if (ph.lift >= 0.005) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = ph.lift;
      ctx.fillStyle = ph.liftColor;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    /* ② 새벽·노을 그라데이션
       ★ Sprint 3 — 이 띠는 **구간 색**으로만 만들어진다(ph.sky·ph.ground 는 섞지 않은 값이다).
       즉 하루 중 네 번만 달라지는데 옛 셈은 프레임마다 새로 구웠다. 색과 높이가 같으면 같은 띠다. */
    if (ph.sky || ph.ground) {
      var skyKey = (ph.sky || '-') + '|' + (ph.ground || '-') + '|' + H;
      if (skyGrad.key !== skyKey) {
        var made = null;
        try {
          made = ctx.createLinearGradient(0, 0, 0, H);
          made.addColorStop(0, ph.sky || 'rgba(0,0,0,0)');
          made.addColorStop(0.52, 'rgba(0,0,0,0)');
          made.addColorStop(1, ph.ground || 'rgba(0,0,0,0)');
        } catch (e) { made = null; }
        skyGrad = { key: skyKey, g: made };
      }
      var g0 = skyGrad.g;
      if (g0) {
        ctx.save();
        ctx.globalAlpha = ph.skyK;
        ctx.fillStyle = g0;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    }
    /* ③ 밤 광원 — 모닥불·본부·가로등·창문
       ★ §13-A-2 — 세기를 밤 어둠(다이얼) 대비 상대값으로 잰다. 밤을 완화해도 등불은 그대로 밝다. */
    /* 밤 어둠의 최대치도 밝기 슬라이더를 탄다 — 밝게 해도 등불이 꺼지지 않게 같은 자로 잰다(§14-2) */
    var maxA = (((S.DAY_PHASES[3] && S.DAY_PHASES[3].alpha) || 0.44) * (ph.dark || 1)) || 0.01;
    var lightOn = maxA * 0.45;
    if (ph.idx !== 3 && ph.alpha < lightOn) return;
    var strength = U.clamp((ph.alpha - lightOn) / Math.max(0.01, maxA - lightOn), 0, 1);
    if (strength <= 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var t = GM.camera.cam.tile;
    var lights = 0;
    S.structures().forEach(function (b) {
      if (lights >= 18) return;                        // 등불 상한 — 60fps 예산
      if (b.x == null) return;
      var c = S.centerOfThing(b);
      if (!GM.camera.onScreen(c.x, c.y, t * 5)) return;
      var kind = b.hq ? 'hq' : (b.key === 'lamp' ? 'lamp'
        : (b.key === 'campfire' ? 'fire' : (LIT_HOUSES[b.key] ? 'window' : null)));
      if (!kind) return;
      lights++;
      var flick = kind === 'window' ? 1 : (0.92 + 0.08 * Math.sin(animT / (kind === 'lamp' ? 520 : 190) + c.x));
      var r0 = t * (kind === 'hq' ? 5.4 + S.tierNo() * 0.4 : (kind === 'fire' ? 4.6 : (kind === 'lamp' ? 3.4 : 2.4))) * flick;
      /* ★ Sprint 3 — 등불 열여덟 개가 **프레임마다** 색 띠 열여덟 개를 새로 굽고 있었다.
         모닥불·가로등은 반지름이 흔들려(flick) 값이 끝없이 갈리므로, 반지름을 픽셀 단위로
         반올림해 곳간에 넣는다. 등불의 가장자리는 이미 투명으로 사그라드는 자리라
         1픽셀 안쪽의 차이는 눈에 들지 않는다 — 세기(strength)와 겹침 방식은 그대로다. */
      var r = Math.max(1, Math.round(r0));
      var g = radialAt0('lit:' + kind + ':' + r, 0, r,
        [[0, kind === 'window' ? 'rgba(255,214,150,.26)' : 'rgba(255,190,110,.42)'],
         [1, 'rgba(255,190,110,0)']]);
      if (!g) return;
      ctx.save();
      ctx.translate(GM.camera.worldToScreenX(c.x), GM.camera.worldToScreenY(c.y));
      ctx.globalAlpha = strength;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    ctx.restore();
  }

  /* 밤에 창문이 켜지는 건물 — 사람이 사는 곳과 불을 쓰는 곳 */
  var LIT_HOUSES = { tent: 1, hut: 1, house: 1, manor: 1, granary: 1, smithy: 1, smelter: 1,
                     barracks: 1, market: 1, trading_post: 1, shrine: 1, consulate: 1, appraisal_post: 1 };

  /* ══════════ 라벨 ══════════ */
  /* ★ Sprint 3 — 글자 폭 곳간. measureText 는 글꼴 셈을 브라우저에 시키는 값비싼 물음인데,
     이름표는 프레임마다 같은 글자를 다시 묻는다(건물 이름·주민 이름은 좀처럼 바뀌지 않는다).
     글꼴이 한 벌뿐이라 열쇠는 글자 자체다. 상한을 넘으면 통째로 비운다 — 곳간이 새지 않는다. */
  var LABEL_FONT = '11px "Galmuri11", monospace';
  var LABEL_CAP = 512;
  var labelW = {}, labelWN = 0;
  function textWidth(text) {
    var w = labelW[text];
    if (w !== undefined) return w;
    try { w = ctx.measureText(text).width; } catch (e) { w = String(text).length * 6; }
    if (labelWN >= LABEL_CAP) { labelW = {}; labelWN = 0; }
    labelW[text] = w; labelWN += 1;
    return w;
  }

  function label(text, wx, wy, color) {
    var px = GM.camera.worldToScreenX(wx);
    if (px < -80 || px > W + 80) return;
    var py = GM.camera.worldToScreenY(wy);
    if (py < -20 || py > H + 20) return;
    ctx.save();
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'center';
    var w = textWidth(text);
    ctx.fillStyle = 'rgba(20,14,8,.62)';
    ctx.fillRect(px - w / 2 - 3, py - 11, w + 6, 14);
    ctx.fillStyle = color || '#f4e4bc';
    try { ctx.fillText(text, px, py); } catch (e2) {}
    ctx.restore();
  }

  /* ══════════ 지도가 아직 없을 때 ══════════ */
  function drawBootNotice() {
    var b = S.S.boot || { phase: 'waiting' };
    var failed = b.phase === 'failed';
    var title = b.title || '땅을 살피는 중…';
    var hint = b.hint || null;
    ctx.textAlign = 'center';
    ctx.fillStyle = failed ? '#e8a08a' : '#8a8496';
    ctx.font = '15px "Galmuri11", monospace';
    try { ctx.fillText(title, W / 2, H / 2 - (hint ? 12 : 0)); } catch (e) {}
    if (hint) {
      ctx.fillStyle = failed ? '#c8a08a' : '#6f6a7c';
      ctx.font = '12px "Galmuri11", monospace';
      var words = String(hint).split(' ');
      var lines = [''], max = Math.max(18, Math.floor(W / 13));
      for (var i = 0; i < words.length; i++) {
        var t = lines[lines.length - 1];
        if ((t + ' ' + words[i]).trim().length > max && lines.length < 3) lines.push(words[i]);
        else lines[lines.length - 1] = (t + ' ' + words[i]).trim();
      }
      for (var k = 0; k < lines.length; k++) {
        try { ctx.fillText(lines[k], W / 2, H / 2 + 12 + k * 17); } catch (e2) {}
      }
    }
  }

  /* ══════════ ★ 안내 시스템 (GDD3 §11-3) ══════════ */
  /* 「뭘 해야 할지 모르는 순간 제로」의 화면 몫.
     ① 아바타 곁의 대상에 상호작용 라벨을 띄우고
     ② 목표 카드가 가리키는 자리에 바운스 화살표를, 화면 밖이면 가장자리 화살표를 세운다. */

  var VERB = {
    forest: 'E — 나무 베기', rock: 'E — 돌 캐기', iron: 'E — 광맥 캐기', oil: 'E — 기름 긷기',
    water: 'E — 물고기 잡기', fertile: 'E — 거두기', field: 'E — 거두기', ruin: 'E — 유적 살피기',
    berry: 'E — 열매 따기', site: 'E — 짓기', enemy: 'E — 베기', wild: 'E — 사냥하기',
    // ★ §17-17 — 숨은 궤. 캐는 것이 아니라 여는 것이다(한 번 열면 그 자리는 사라진다).
    cache: 'E — 궤를 연다'
  };

  function verbFor(t) {
    if (!t) return null;
    if (t.kind === 'enemy') return VERB.enemy;
    /* ★ §19-F1(F08-4) — 목장이 서 있고 온순한 짐승이면 「키우기」가 한 줄 더 붙는다(사냥과 병존). */
    if (t.kind === 'wild') {
      var nm = (t.obj && t.obj.name) ? t.obj.name : '짐승';
      return 'E — ' + nm + ' 사냥' + (tameable(t.obj) ? '   ·   Q — 키우기' : '');
    }
    if (t.kind === 'site') {
      var name = t.obj && t.obj.name ? t.obj.name : '공사';
      return 'E — ' + name + ' 짓기';
    }
    return VERB[t.nodeType] || 'E — 일하기';
  }

  /** ★ §19-F1(F08-4) — 데려올 수 있는가. 판정은 서버가 다시 한다(여기는 말머리를 걸 뿐이다). */
  function tameable(c) {
    if (!c || c.tamed || c.kind !== 'animal') return false;
    var list = S.structures() || [];
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.key === 'ranch' && !b.ruined && !b.inactive) return true;
    }
    return false;
  }

  /** ① 근처 대상 상호작용 라벨 — 손이 닿는 것 하나에만 붙는다 */
  function drawInteractPrompt() {
    if (GM.opening && GM.opening.busy && GM.opening.busy()) return;
    /* ★ §17-16 — 이웃 도읍 앞에 서 있으면 「찾아간다」가 먼저다(손보다 발이 앞선 자리다) */
    var tw = GM.diplomacy && GM.diplomacy.nearTown();
    if (tw) { promptBox('E — ' + tw.name + ' 찾아가기', tw.x, tw.y, true); return; }
    /* ★ §18-D2 — 흔적 곁이면 「살핀다」. 동사는 자료가 쥔다(verb) — 화면이 문구를 짓지 않는다.
       input.js startInteract 와 **같은 차례**로 고른다: 말머리와 E 가 갈리면 손이 헛나간다. */
    var tr = GM.trails && GM.trails.near();
    if (tr) { promptBox(tr.verb, tr.x, tr.y, tr.ready); return; }
    if (!GM.swing || !GM.swing.target) return;
    var t = GM.swing.target();
    if (!t) { promptHandWork(); return; }
    var txt = verbFor(t);
    if (!txt) return;
    promptBox(txt, t.x, t.y, GM.swing.ready && GM.swing.ready());
  }

  /** ★ §19-D(F03-6) — 휘두를 것이 없고 손일 건물 곁이면 그 건물의 대표 행동을 말머리에 건다.
      input.js startInteract 와 **같은 차례**다 — 말머리와 E 가 갈리면 손이 헛나간다. */
  function promptHandWork() {
    var b = GM.structure && GM.structure.handWorkNear && GM.structure.handWorkNear();
    if (!b) return;
    var c = S.centerOfThing(b);
    promptBox('E — ' + ((b.handWork && b.handWork.label) || '거든다'), c.x, c.y, true);
  }

  /** 말머리 상자 하나 — 대상 위에 떠서 까딱인다 */
  function promptBox(txt, wx, wy, ready) {
    var p = GM.camera.worldToScreen(wx, wy);
    var tile = GM.camera.cam.tile;
    var y = p.y - tile * 1.15;
    var bob = Math.sin(animT / 260) * 2;
    ctx.save();
    ctx.font = '12px Galmuri11, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var w = ctx.measureText(txt).width + 14;
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = 'rgba(16,12,22,.82)';
    ctx.fillRect(Math.round(p.x - w / 2), Math.round(y - 10 + bob), Math.round(w), 20);
    ctx.strokeStyle = ready ? 'rgba(246,207,122,.9)' : 'rgba(150,140,120,.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(p.x - w / 2) + 0.5, Math.round(y - 10 + bob) + 0.5, Math.round(w) - 1, 19);
    ctx.fillStyle = ready ? '#f6e6a8' : '#b8ae9c';
    ctx.globalAlpha = 1;
    try { ctx.fillText(txt, p.x, y + bob); } catch (e) {}
    ctx.restore();
  }

  /** ② 퀘스트 마커 — 목표 카드가 가리키는 자리 */
  function drawQuestMarkers() {
    if (!S.goalTargets) return;
    if (GM.opening && GM.opening.busy && GM.opening.busy()) return;
    var prog = S.goalProgress && S.goalProgress();
    if (prog && prog.done) return;
    var list = S.goalTargets().filter(function (t) { return t && t.x != null && t.y != null; });
    if (!list.length) return;
    var tile = GM.camera.cam.tile;
    var bob = Math.abs(Math.sin(animT / 380)) * Math.max(3, tile * 0.22);

    for (var i = 0; i < list.length; i++) {
      var g = list[i];
      var p = GM.camera.worldToScreen(g.x, g.y);
      var onScreen = p.x >= 8 && p.y >= 8 && p.x <= W - 8 && p.y <= H - 8;
      var alpha = i === 0 ? 1 : 0.45;                 // 첫 후보가 주인공, 나머지는 예비
      if (onScreen) {
        drawBounceArrow(p.x, p.y - tile * 0.9 - bob, alpha, i === 0);
        if (i === 0) {
          ctx.save();
          ctx.globalAlpha = 0.35 + Math.sin(animT / 300) * 0.12;
          ctx.strokeStyle = '#f6cf7a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, tile * 0.66, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      } else if (i === 0) {
        drawEdgeArrow(p.x, p.y, g);
      }
    }
  }

  function drawBounceArrow(x, y, alpha, big) {
    var s = big ? 9 : 6;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#f6cf7a';
    ctx.strokeStyle = 'rgba(20,14,8,.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + s);
    ctx.lineTo(x - s, y - s);
    ctx.lineTo(x + s, y - s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** 화면 밖이면 가장자리에서 방향을 가리킨다 (거리도 함께) */
  function drawEdgeArrow(sx, sy, g) {
    var m = 26;
    var cx = W / 2, cy = H / 2;
    var dx = sx - cx, dy = sy - cy;
    var len = Math.hypot(dx, dy) || 1;
    var kx = (W / 2 - m) / Math.abs(dx || 1e-6);
    var ky = (H / 2 - m) / Math.abs(dy || 1e-6);
    var k = Math.min(kx, ky);
    var ex = cx + dx * k, ey = cy + dy * k;
    var ang = Math.atan2(dy, dx);
    var me = GM.avatar && GM.avatar.pos();
    var tiles = me ? Math.round(Math.hypot(g.x - me.x, g.y - me.y)) : null;

    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(ang);
    ctx.globalAlpha = 0.85 + Math.sin(animT / 300) * 0.12;
    ctx.fillStyle = '#f6cf7a';
    ctx.strokeStyle = 'rgba(20,14,8,.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-8, -8);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    if (tiles != null) {
      ctx.save();
      ctx.font = '11px Galmuri11, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(16,12,22,.8)';
      var lbl = tiles + '칸';
      var w2 = ctx.measureText(lbl).width + 10;
      ctx.fillRect(Math.round(ex - w2 / 2), Math.round(ey + 12), Math.round(w2), 16);
      ctx.fillStyle = '#f6e6a8';
      try { ctx.fillText(lbl, ex, ey + 20); } catch (e) {}
      ctx.restore();
    }
  }

  /* ══════════ 프레임 ══════════ */
  function draw() {
    if (!ctx) return;
    ctx.setTransform(Math.min(global.devicePixelRatio || 1, 2), 0, 0, Math.min(global.devicePixelRatio || 1, 2), 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#08060e';
    ctx.fillRect(0, 0, W, H);
    if (!S.S.map) { drawBootNotice(); return; }

    var sh = GM.fx ? GM.fx.shakeOffset() : { x: 0, y: 0 };
    if (sh.x || sh.y) ctx.translate(sh.x, sh.y);

    var tile = GM.camera.cam.tile;
    drawTerrain();
    drawClusters();
    drawTerritory();
    if (GM.fx) GM.fx.drawStumps(ctx, tile);
    drawFills();                         /* ★ §17-13 — 메운 땅이 맨 아래다 */
    drawBridges();                       /* ★ §17-13 — 다리는 그 위에 걸린다 */
    drawRails();                         /* ★ §13-D-5 — 바닥에 깔린 것이 먼저다 */
    drawNodes();
    drawTrails();                        /* ★ §18-D2 — 흔적은 자원 자리 위, 울타리 아래 */
    drawFences();
    drawStructures();
    drawCamps();
    drawMoveMarker();
    drawTrains();                        /* ★ §19-F4(F09-2) — 기차는 사람보다 아래에 선다 */
    drawWild();
    drawResidents();
    if (GM.combat && GM.combat.drawUnits) GM.combat.drawUnits(ctx, tile, animT);
    drawAvatars();
    drawCooldownRing();
    drawFog();
    drawDayNight();
    drawSelectionMarks();
    drawGhost();
    drawFlags();          // ★ §16-18 · §16-19 — 집결지·수비 깃발
    // ★ 안내 시스템 — 안개·조명 위에 얹는다(어두워도 길잡이는 또렷해야 한다)
    drawInteractPrompt();
    drawQuestMarkers();
    if (GM.fx) GM.fx.drawWorld(ctx, tile);
    if (GM.combat && GM.combat.drawOverlay) GM.combat.drawOverlay(ctx, W, H, animT);
    if (GM.opening && GM.opening.drawOverlay) GM.opening.drawOverlay(ctx, W, H, animT);
  }

  function tickAnim(t) {
    var raw = lastT ? (t - lastT) : 16;
    var dt = lastT ? Math.min(0.05, raw / 1000) : 0.016;
    lastT = t;
    animT = t;
    frameTimes.push(raw);
    if (frameTimes.length > 240) frameTimes.shift();
    /* ★ 한 프레임을 만드는 데 실제로 든 시간. 프레임 간격(raw)은 60fps 로 맞물리면 늘 16.7ms 라
       그것만으로는 여유가 있는지 알 수 없다 — 그리는 일 자체의 값을 따로 잰다. */
    var w0 = nowMs();
    /* ★ Sprint 3 — 이 프레임의 몫을 새로 담는다(길 예산 · 구간별 시간계) */
    resetPathBudget();
    nodesMs = 0; minimapMs = 0; pathMs = 0; pathCalls = 0;

    var frozen = GM.fx && GM.fx.frozen();
    GM.camera.update(dt);
    if (!frozen) {
      stepUnits(dt);
      /* ★ §19-B — 보간 시계에는 **자르지 않은 프레임 간격(raw)** 을 준다. dt 는 0.05초로 잘려 있어
         무거운 프레임이 이어지면 시계가 벽시계보다 뒤처지고, 그 차이가 곧 끊김·순간이동이 된다. */
      stepWild(dt, raw);
      stepMates(dt);        // ★ §15-C — 동료와 동료들의 걸음(1초 좌표 사이를 등속으로)
      if (GM.avatar) GM.avatar.step(dt);
      if (GM.swing) GM.swing.step(dt);
      if (GM.combat && GM.combat.step) GM.combat.step(dt, raw);
      if (GM.opening && GM.opening.step) GM.opening.step(dt);
      if (territoryAnim) {
        territoryAnim.t += dt;
        if (territoryAnim.t > 1.8) territoryAnim = null;
      }
      stakePhase += dt;
    }
    if (GM.input) GM.input.step(dt);
    if (GM.fx) GM.fx.step(dt);
    draw();
    if (GM.fx) GM.fx.drawLayer();
    if (GM.minimap) {
      var m0 = nowMs();
      GM.minimap.draw(t);
      minimapMs += nowMs() - m0;
    }

    /* ★ 남은 지형 청크를 이 프레임의 몫만큼만 굽는다 — 그리기가 끝난 뒤에 한다
       (이번 판에 필요한 것은 이미 바탕색으로라도 화면에 올라가 있다). */
    bakeStep(visiblePending ? BAKE_URGENT_MS : BAKE_BUDGET_MS);

    var w1 = nowMs();
    workTimes.push(w1 - w0);
    if (workTimes.length > 240) workTimes.shift();
    /* ★ Sprint 3 — 구간별 값도 같은 길이의 띠에 쌓는다(고치기 전·후를 같은 자로 견주려고) */
    pushRing(nodesTimes, nodesMs);
    pushRing(minimapTimes, minimapMs);
    pushRing(pathTimes, pathMs);
    pushRing(pathCallTimes, pathCalls);
  }

  function pushRing(list, v) {
    list.push(v);
    if (list.length > 240) list.shift();
  }

  function stat(list) {
    if (!list.length) return { avg: 0, p95: 0, n: 0 };
    var a = list.slice().sort(function (x, y) { return x - y; });
    var sum = 0;
    for (var i = 0; i < a.length; i++) sum += a[i];
    return { avg: sum / a.length, p95: a[Math.floor(a.length * 0.95)], n: a.length };
  }

  /**
   * 스모크·개발 패널이 읽는 프레임 통계 (밀리초).
   *   avg·p95 — 프레임 **간격**. 60fps 로 맞물려 돌면 16.7ms 근처가 정상이다(작을수록 좋은 값이 아니다).
   *   work    — 한 프레임을 실제로 **그리는 데 든 시간**. 16.7ms 예산 대비 여유가 이 값으로 보인다.
   */
  function frameStats() {
    var f = stat(frameTimes);
    var w = stat(workTimes);
    /* ★ Sprint 3 — 어디에 시간이 갔는가(띠 평균). 옛 필드는 한 칸도 건드리지 않는다. */
    return { avg: f.avg, p95: f.p95, n: f.n, workAvg: w.avg, workP95: w.p95,
             nodesMs: stat(nodesTimes).avg, minimapMs: stat(minimapTimes).avg,
             pathMs: stat(pathTimes).avg, pathCalls: stat(pathCallTimes).avg,
             pathP95: stat(pathTimes).p95 };
  }
  function resetStats() {
    frameTimes = []; workTimes = [];
    nodesTimes = []; minimapTimes = []; pathTimes = []; pathCallTimes = [];
  }

  function setHover(x, y) { hoverTile.x = x; hoverTile.y = y; }
  function hover() { return hoverTile; }
  function setDragBox(b) { dragBox = b; }
  function reset() {
    dropChunks(); units = {}; walkIns = []; doneBounce = {}; territoryAnim = null;
    structSort = { src: null, n: -1, rev: -2, list: [] };
    /* ★ Sprint 3 — 세워 둔 색인·띠도 함께 버린다(판이 바뀌면 옛 표는 거짓말이 된다) */
    nodeIndex = { src: null, n: -1, cells: null, w: 0 };
    fenceIndex = { src: null, n: -1, cells: null, w: 0 };
    labelW = {}; labelWN = 0;
    dropGradients();
    wild = {};
  }

  /** 사냥 대상 고르기 — 아바타에서 사거리 안, 가장 가까운 놈 (§13-C-8)
      ★ §16-4 — 화면 자리(보간, 한 스텝 뒤)와 서버 자리(제일 새 좌표) **중 가까운 쪽**으로 잰다.
      화면만 보면 쫓아오는 놈이 아직 멀어 보여 대상조차 안 잡히고, 서버만 보면 눈앞의 놈이
      안 잡힌다 — 판정은 어차피 서버가 다시 한다(huntSwing 의 지금·직전 괄호). */
  function nearestWild(x, y, range) {
    var list = S.creatureList();
    var best = null;
    var bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var a = wild[c.id] || c;
      var d = Math.min(Math.hypot(a.x - x, a.y - y), Math.hypot(c.x - x, c.y - y));
      if (d < bestD) { bestD = d; best = { c: c, d: d, x: a.x, y: a.y }; }
    }
    if (!best || (range != null && best.d > range)) return null;
    return best;
  }
  function wildPos(id) { return wild[id] || null; }

  GM.world = {
    mount: mount, resize: resize, draw: draw, tickAnim: tickAnim,
    setHover: setHover, hover: hover, setDragBox: setDragBox, recenter: recenter, reset: reset,
    animateTerritory: animateTerritory, bounceStructure: bounceStructure, markArrival: markArrival,
    setFencePath: setFencePath, getFencePath: getFencePath,
    /* ★ §16-7 — 마차 동반 하차: 오프닝이 걷히는 순간 동료들이 마차 자리에서 내린다 */
    crewDisembark: crewDisembark,
    /* ★ §16-12 — 동료·다른 사람의 화면 자리(보간) — 스윙 팝을 그 사람 곁에 띄울 때 쓴다 */
    matePos: function (id) { return mates[id] || null; },
    nearestWild: nearestWild, wildPos: wildPos, markWildHurt: markWildHurt,
    /* ★ §19-F4(F09-2) — 곁에 선 기차(E 한 손잡이가 집는다) */
    nearestTrain: nearestTrain,
    /* ★ Sprint 3 — 둘레의 자원 자리만 추린다(칸 바구니). 손 닿는 것 고르기가 쓴다. */
    nodesNear: nodesNear,
    /* ★ §17-19 — 건물 스프라이트 사각형의 정본. input.js 의 클릭 판정이 이것을 그대로 쓴다. */
    structureRect: structureRect,
    /* ★ GDD3 §14-1 — 주민 작업 사이클의 수치 표시 */
    creditFloat: creditFloat,
    /* ★ GDD3 §15-A-2 — 터렛이 잡은 자리에 뜨는 수치 */
    turretKillFloat: turretKillFloat,
    /* ★ GDD3 §14-3 — 서버 좌표 묶음이 올 때마다 지연 버퍼를 한 칸 민다 */
    pushWild: pushWildSnapshot,
    /* ★ §19-B — 함께 있는 사람·동료의 자리도 같은 문으로 든다(받은 그 순간에 띠를 민다) */
    pushMates: pushMates,
    /* 하니스·스모크 전용 — jsdom 에는 rAF 시계가 없어 걸음을 손으로 돌린다 */
    stepWildForTest: stepWild,
    stepMatesForTest: stepMates,
    label: label, ringAt: ringAt, verbFor: verbFor,
    frameStats: frameStats, resetStats: resetStats,
    size: function () { return { w: W, h: H }; },
    unitPos: function (id) { return units[id] || null; },
    /* ★ §12-11 회귀 하니스 전용 — jsdom 에는 rAF 시계가 없어 걸음을 손으로 돌린다 */
    stepUnitsForTest: stepUnits,
    ping: function (x, y, color) { if (GM.fx) GM.fx.ring(x, y, color || '#8dfa8d'); }
  };
})(window);
