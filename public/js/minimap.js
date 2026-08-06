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
    S.on('world', function () { base = null; veil = null; veilReady = false; });
  }

  /** 축소본 한 겹을 담을 빈 캔버스 (한 칸 = 한 픽셀) */
  function layerFor(m) {
    var c = document.createElement('canvas');
    c.width = m.size; c.height = m.size;
    return c;
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
  function paintLayer(m, at) {
    var c = layerFor(m);
    var g = c.getContext('2d');
    if (!g) return null;
    var img = g.createImageData && g.createImageData(m.size, m.size);
    if (img && img.data) fastPaint(g, img, m, at);
    else slowPaint(g, m, at);
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
    var c = paintLayer(m, function (i) { return pal[m.terrain[i]] || pal[0]; });
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
  function buildVeil(m) {
    veil = paintLayer(m, function (i) { return VEIL[m.fog[i]] || null; });
    veilReady = true;
    m.fogDirty = false;
    return veil;
  }

  function draw() {
    if (!ctx) return;
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

    /* ★ GDD3 §13-D-5 — 철로. 축소 지도에서도 길이 보여야 어디에 더 깔지 알 수 있다. */
    ctx.fillStyle = '#9aa4ae';
    S.rails().forEach(function (r) { ctx.fillRect(r.x * k - 0.5, r.y * k - 0.5, 2, 2); });

    /* 울타리 · 주민 · 건물 · 아바타 */
    ctx.strokeStyle = '#a3703f';
    ctx.lineWidth = 1.5;
    S.fences().forEach(function (f) {
      ctx.beginPath();
      ctx.moveTo(f.x1 * k, f.y1 * k);
      ctx.lineTo(f.x2 * k, f.y2 * k);
      ctx.stroke();
    });
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
