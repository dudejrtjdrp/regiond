/* minimap.js — 우하단 축소 지도. 지형·안개·영토·아군/적 점·침공 방향 화살표.
   클릭(또는 끌기)하면 그 자리로 카메라가 날아간다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var cv = null, ctx = null, base = null, baseSeed = null;
  var SIZE = 168;
  var dragging = false;
  var animT = 0;
  /* ★ §17-17 — 안개 축소본 캐시. 아래 buildVeil 의 주석에 까닭이 있다.
     veilReady 를 따로 두는 까닭: 캔버스가 없는 자리에서는 veil 이 영영 null 이라
     「비었으니 다시 굽자」가 매 프레임 헛돌기 때문이다. */
  var veil = null, veilReady = false;

  /* ══════════ ★ Sprint 3 ══════════
     축소 지도는 **매 프레임** 다시 그려지고 있었다: 울타리 400조각(조각마다 캔버스 명령 넷),
     철로·건물·주민·적진까지 전부. 게다가 겹 하나를 구울 때마다 캔버스와 ImageData 를
     **새로** 만들어 384² 짜리 판을 프레임마다 두 장씩 버렸다. 세 가지를 고친다:
       ① 겹을 담는 캔버스와 픽셀 그릇을 **하나씩 두고 되쓴다**(굽는 값은 그대로, 쓰레기는 없다)
       ② 좀처럼 바뀌지 않는 것(철로·울타리)은 한 겹에 구워 두고 **바뀔 때만** 다시 굽는다
       ③ 판 전체를 초당 minimapHz 번만 그린다 — 눈이 좇는 그림이 아니라 곁눈으로 보는 판이다
     그림 자체는 한 점도 달라지지 않는다(겹의 순서도 그대로다). */
  var layers = {};                       // 이름 → 되쓰는 캔버스(칸 하나 = 픽셀 하나)
  var imgBuf = { size: -1, img: null };  // 되쓰는 픽셀 그릇
  var statics = null, staticsDirty = true;   // 철로·울타리를 구워 둔 겹(축소 지도 크기 그대로)
  var lastDraw = 0;                      // 마지막으로 판을 다 그린 시각(ms)
  var MINIMAP_HZ_FALLBACK = 8;

  function nowMs() { return (global.performance && performance.now) ? performance.now() : Date.now(); }
  function minimapHz() {
    var w = S.worldCfg && S.worldCfg();
    var hz = w && w.render && w.render.perf && w.render.perf.minimapHz;
    return (typeof hz === 'number' && hz > 0) ? hz : MINIMAP_HZ_FALLBACK;
  }

  function mount() {
    cv = U.qs('#minimap');
    if (!cv) return;
    ctx = U.fitCanvas(cv, SIZE, SIZE);
    cv.style.width = SIZE + 'px';
    cv.style.height = SIZE + 'px';
    cv.addEventListener('pointerdown', function (e) {
      dragging = true;
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      jump(e);
    });
    cv.addEventListener('pointermove', function (e) { if (dragging) jump(e); });
    cv.addEventListener('pointerup', function () { dragging = false; });
    cv.addEventListener('pointerleave', function () { dragging = false; });
    S.on('world', function () {
      base = null; veil = null; veilReady = false;
      layers = {}; imgBuf = { size: -1, img: null };
      statics = null; staticsDirty = true;
    });
    /* ★ Sprint 3 — 장부가 바뀌면 구워 둔 겹을 버린다. 값이 진짜 바뀌었는지는 따지지 않는다:
       다시 굽는 값이 옛 셈의 **한 프레임 값**과 같아서, 초당 몇 번이면 그 자체로 크게 남는다. */
    S.on('change', function () { staticsDirty = true; });
  }

  /** 축소본 한 겹을 담을 캔버스 (한 칸 = 한 픽셀) — 이름마다 하나를 두고 되쓴다 */
  function layerFor(name, m) {
    var c = layers[name];
    if (!c || c.width !== m.size || c.height !== m.size) {
      c = document.createElement('canvas');
      c.width = m.size; c.height = m.size;
      layers[name] = c;
    }
    return c;
  }

  /** 되쓰는 픽셀 그릇 — 쓰기 전에 반드시 비운다(안 비우면 지난 겹이 비쳐 보인다) */
  function bufFor(g, m) {
    if (imgBuf.size !== m.size || !imgBuf.img) {
      imgBuf.img = (g.createImageData && g.createImageData(m.size, m.size)) || null;
      imgBuf.size = m.size;
    }
    var img = imgBuf.img;
    if (!img || !img.data) return null;
    var px = img.data;
    if (px.fill) px.fill(0);
    else for (var i = 0; i < px.length; i++) px[i] = 0;
    return img;
  }

  var HEX = { r: 0, g: 0, b: 0 };
  /** '#rrggbb' → 픽셀 성분. ImageData 로 칠하려면 색을 숫자로 풀어야 한다. */
  function hex(s) {
    var v = parseInt(String(s).replace('#', ''), 16) || 0;
    HEX.r = (v >> 16) & 255; HEX.g = (v >> 8) & 255; HEX.b = v & 255;
    return HEX;
  }

  function jump(e) {
    var m = S.S.map;
    if (!m) return;
    var r = cv.getBoundingClientRect();
    var x = ((e.clientX - r.left) / Math.max(1, r.width)) * m.size;
    var y = ((e.clientY - r.top) / Math.max(1, r.height)) * m.size;
    GM.camera.moveTo(x, y);
    if (GM.sfx) GM.sfx.play('tap');
  }

  /**
   * 축소본 한 겹을 굽는다 — 칸 하나가 픽셀 하나다. at(i) 가 그 칸의 [r,g,b,a] 를 돌려주고,
   * null 을 돌려주면 그 칸은 건드리지 않는다(투명).
   *
   * ★ §17-17 — 지도가 384² 가 되며 칠할 칸이 65,536 → 147,456 으로 늘었다. 칸마다 캔버스 명령을
   * 부르던 옛 셈은 그 수만큼 명령을 쌓는다. ImageData 한 판에 직접 적으면 캔버스 명령이 **한 번**으로
   * 줄어든다 — 그림은 같다. 캔버스가 흉내뿐인 자리(하니스 스텁)에는 ImageData 가 없으므로,
   * 그때만 옛 길(칸마다 fillRect)로 물러선다.
   */
  function paintLayer(name, m, at) {
    var c = layerFor(name, m);
    var g = c.getContext('2d');
    if (!g) return null;
    /* ★ Sprint 3 — 겹을 되쓰므로 지난 그림을 먼저 지운다. 픽셀 그릇으로 칠할 때는
       putImageData 가 판을 통째로 덮으니 지울 일이 없다(칸마다 칠하는 물러선 길만 지운다). */
    var img = bufFor(g, m);
    if (img) fastPaint(g, img, m, at);
    else { try { g.clearRect(0, 0, m.size, m.size); } catch (e) {} slowPaint(g, m, at); }
    return c;
  }

  function fastPaint(g, img, m, at) {
    var px = img.data;
    for (var i = 0; i < m.size * m.size; i++) {
      var v = at(i);
      if (!v) continue;
      px[i * 4] = v[0]; px[i * 4 + 1] = v[1]; px[i * 4 + 2] = v[2]; px[i * 4 + 3] = v[3];
    }
    g.putImageData(img, 0, 0);
  }

  /* 물러설 길 — ImageData 를 못 쓰는 자리에서는 줄 단위로 묶어 칠한다.
     at 이 돌려주는 배열은 표에서 꺼낸 **같은 것**이라 === 하나로 묶음의 경계를 안다. */
  function slowPaint(g, m, at) {
    for (var y = 0; y < m.size; y++) paintRow(g, m, at, y);
  }

  function paintRow(g, m, at, y) {
    var start = 0;
    var cur = at(y * m.size);
    for (var x = 1; x <= m.size; x++) {
      var v = rowAt(m, at, y, x);
      if (v === cur) continue;
      if (cur) fillRun(g, cur, start, y, x - start);
      start = x; cur = v;
    }
  }

  /** 줄 끝을 넘어서면 undefined — 어떤 색과도 같지 않아 마지막 묶음이 반드시 칠해진다 */
  function rowAt(m, at, y, x) {
    if (x >= m.size) return undefined;
    return at(y * m.size + x);
  }

  function fillRun(g, v, x, y, w) {
    g.fillStyle = 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + (v[3] / 255).toFixed(3) + ')';
    g.fillRect(x, y, w, 1);
  }

  /** 지형 축소본 — 월드가 바뀔 때 한 번만 굽는다 */
  function buildBase() {
    var m = S.S.map;
    if (!m) return null;
    var pal = palette(m);
    var c = paintLayer('base', m, function (i) { return pal[m.terrain[i]] || pal[0]; });
    baseSeed = m.seed;
    return c;
  }

  /** 지형 코드값(RLE 인덱스) → 픽셀 성분. ★ §17-17 로 설산·밀림이 뒤에 붙어도 이 표가 그대로 받는다. */
  function palette(m) {
    var out = [];
    for (var i = 0; i < m.codes.length; i++) {
      var h = hex(S.terrainMeta(m.codes[i]).color);
      out.push([h.r, h.g, h.b, 255]);
    }
    return out;
  }

  /* 안개 세 단계의 덮개 — 0 모르는 땅(통째로) · 1 기억하는 땅(절반) · 2 시야(안 덮는다) */
  var VEIL = [[8, 6, 16, 255], [8, 6, 16, 128], null];

  /**
   * 안개 축소본.
   * ★ §17-17 — 옛 셈은 **매 프레임** 147,456 칸을 훑었다(384²). 60fps 면 초당 880만 번이라
   * 축소 지도 하나가 프레임 예산을 먹는다. 안개는 걸음마다 바뀌는 것이 아니라 **바뀔 때만** 바뀌므로
   * 한 판 구워 두고 그때만 다시 굽는다(state 가 세워 두는 fogDirty 가 그 신호다).
   */
  /* ★ Sprint 3 — 여기가 **서버 안개(m.fog)만** 읽는다는 사실이 이 판의 열쇠였다.
     state.revealAround(아바타 둘레의 클라 예측)이 걷는 내내 초당 서너 번 fogDirty 를 세웠고,
     그때마다 이 함수가 384² 판을 **글자 그대로 똑같이** 다시 구웠다(그림은 한 픽셀도 안 바뀐다).
     이제 국지 예측은 localFogDirty 로 따로 서고, 이 겹은 서버 안개가 올 때만 다시 굽는다. */
  function buildVeil(m) {
    veil = paintLayer('veil', m, function (i) { return VEIL[m.fog[i]] || null; });
    veilReady = true;
    m.fogDirty = false;
    return veil;
  }

  /**
   * ★ Sprint 3 — 좀처럼 바뀌지 않는 겹(철로 · 울타리)을 구워 둔다.
   * 축소 지도 크기(SIZE) 그대로 굽는 까닭: 굵기(1.5px)와 점 크기(2px)가 **화면 픽셀** 값이라
   * 칸 단위로 구워 확대하면 굵기가 함께 늘어 그림이 달라진다. 여기서는 옛 코드와
   * 글자 그대로 같은 명령을 같은 자리에 쌓는다 — 다만 프레임마다가 아니라 바뀔 때만.
   * 건물은 이 겹에 넣지 않는다: 옛 차례가 「울타리 → 주민 → 건물」이라, 한 겹으로 묶으면
   * 주민 점과 건물 점의 위아래가 뒤집힌다(건물은 쉰 개 남짓이라 값도 크지 않다).
   */
  function buildStatics(m, k) {
    if (!statics) {
      statics = document.createElement('canvas');
      statics.width = SIZE; statics.height = SIZE;
    }
    var g = statics.getContext('2d');
    if (!g) return null;
    g.clearRect(0, 0, SIZE, SIZE);
    /* ★ GDD3 §13-D-5 — 철로. 축소 지도에서도 길이 보여야 어디에 더 깔지 알 수 있다. */
    g.fillStyle = '#9aa4ae';
    S.rails().forEach(function (r) { g.fillRect(r.x * k - 0.5, r.y * k - 0.5, 2, 2); });
    /* 울타리 */
    g.strokeStyle = '#a3703f';
    g.lineWidth = 1.5;
    S.fences().forEach(function (f) {
      g.beginPath();
      g.moveTo(f.x1 * k, f.y1 * k);
      g.lineTo(f.x2 * k, f.y2 * k);
      g.stroke();
    });
    staticsDirty = false;
    return statics;
  }

  function draw(t) {
    if (!ctx) return;
    /* ★ Sprint 3 — 위 ③(초당 minimapHz 번만 그린다)이 **쓰이지 않고 있었다**. lastDraw·minimapHz·
       buildStatics 셋 다 선언만 되고 draw 가 옛길 그대로 매 프레임을 다 그렸다. 여기서 잇는다:
       판은 눈이 좇는 그림이 아니라 곁눈으로 보는 그림이고, 안 그린 프레임은 지난 판이 그대로 남는다. */
    var now = (typeof t === 'number' && t > 0) ? t : nowMs();
    if (lastDraw && now - lastDraw < 1000 / minimapHz()) return;
    lastDraw = now;
    var m = S.S.map;
    animT += 16;
    ctx.fillStyle = '#0a0710';
    ctx.fillRect(0, 0, SIZE, SIZE);
    if (!m) return;
    if (!base || baseSeed !== m.seed) base = buildBase();
    var k = SIZE / m.size;
    if (base) { try { ctx.drawImage(base, 0, 0, SIZE, SIZE); } catch (e) {} }

    /* 안개 — ★ §17-17: 구워 둔 한 판을 얹는다(바뀐 프레임에만 다시 굽는다) */
    if (!veilReady || m.fogDirty) buildVeil(m);
    if (veil) { try { ctx.drawImage(veil, 0, 0, SIZE, SIZE); } catch (e) {} }

    /* ★ 영토 — 굵은 경계 한 줄 (GDD3 §11-5). 작은 지도에서도 '우리 땅'이 한눈에 들어와야 한다.
       월드의 말뚝·밧줄을 그대로 축소해 그릴 수는 없으니, 안쪽을 살짝 채우고 테두리를 굵게 두른다. */
    var t = S.territory();
    if (t && t.cx != null) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(t.cx * k, t.cy * k, t.radius * k, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(246,231,180,.07)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(40,26,12,.75)';        // 바깥 그림자 — 밝은 지형 위에서도 보이게
      ctx.stroke();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(232,190,110,.95)';     // 밧줄 색
      ctx.stroke();
      ctx.restore();
    }

    /* 도읍 */
    (m.towns || []).forEach(function (tw) {
      if (!tw.isPlayer && !tw.known) return;
      ctx.fillStyle = tw.isPlayer ? '#f6cf7a' : '#c9c3b0';
      ctx.fillRect(tw.x * k - 2, tw.y * k - 2, 5, 5);
    });

    /* ★ Sprint 3 — 철로 · 울타리를 구워 둔 한 겹으로 얹는다(그리는 차례도 명령도 옛것과 같다).
       울타리 400조각이면 프레임마다 캔버스 명령 1,600개였다 — 이제 바뀔 때만 굽는다. */
    if (staticsDirty || !statics) buildStatics(m, k);
    if (statics) { try { ctx.drawImage(statics, 0, 0); } catch (e) {} }

    /* 주민 · 건물 · 아바타 */
    ctx.fillStyle = '#8dbb6d';
    S.residents().forEach(function (v) { ctx.fillRect(v.x * k - 0.5, v.y * k - 0.5, 2, 2); });
    S.structures().forEach(function (b) {
      if (b.x == null) return;
      ctx.fillStyle = b.category === 'military' ? '#8b9fb0' : (b.ruined ? '#7a5a52' : '#c8a874');
      ctx.fillRect(b.x * k - 1, b.y * k - 1, 3, 3);
    });
    /* 전투 중이면 적도 */
    var bt = S.battleLive();
    if (bt) {
      ctx.fillStyle = '#ff6b68';
      (bt.enemies || []).forEach(function (e) { if (e.hp > 0) ctx.fillRect(e.x * k - 1, e.y * k - 1, 3, 3); });
    }
    (S.S.avatars || []).forEach(function (a) {
      ctx.fillStyle = a.id === S.S.avatarId ? '#ffe9a8' : '#a8c8ff';
      ctx.fillRect(a.x * k - 2, a.y * k - 2, 4, 4);
    });
    var me = GM.avatar && GM.avatar.pos();
    if (me) { ctx.fillStyle = '#ffe9a8'; ctx.fillRect(me.x * k - 2, me.y * k - 2, 5, 5); }

    /* 적 캠프 + 침공 방향 화살표 */
    var blink = 0.45 + 0.55 * Math.abs(Math.sin(animT / 420));
    S.camps().forEach(function (c) {
      if (c.x == null) return;
      ctx.save();
      ctx.globalAlpha = blink;
      ctx.fillStyle = '#ff6b68';
      ctx.fillRect(c.x * k - 3, c.y * k - 3, 6, 6);
      ctx.restore();
      var t2 = S.territory();
      if (t2 && t2.cx != null) {
        ctx.save();
        ctx.globalAlpha = blink * 0.8;
        ctx.strokeStyle = '#bc4749';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(c.x * k, c.y * k);
        ctx.lineTo(t2.cx * k, t2.cy * k);
        ctx.stroke();
        ctx.restore();
      }
    });

    /* 카메라 사각형 */
    var cam = GM.camera.cam;
    var vw = cam.w / cam.tile, vh = cam.h / cam.tile;
    ctx.strokeStyle = 'rgba(255,246,220,.85)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect((cam.cx - vw / 2) * k, (cam.cy - vh / 2) * k, vw * k, vh * k);
  }

  GM.minimap = { mount: mount, draw: draw };
})(window);
