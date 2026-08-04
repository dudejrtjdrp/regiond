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
    S.on('world', function () { base = null; });
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

  /** 지형 축소본 — 월드가 바뀔 때 한 번만 굽는다 */
  function buildBase() {
    var m = S.S.map;
    if (!m) return null;
    var c = document.createElement('canvas');
    c.width = m.size; c.height = m.size;
    var g = c.getContext('2d');
    if (!g) return null;
    for (var y = 0; y < m.size; y++) {
      for (var x = 0; x < m.size; x++) {
        var code = m.codes[m.terrain[y * m.size + x]] || 'grass';
        g.fillStyle = S.terrainMeta(code).color;
        g.fillRect(x, y, 1, 1);
      }
    }
    baseSeed = m.seed;
    return c;
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

    /* 안개 */
    for (var y = 0; y < m.size; y++) {
      var runStart = -1, runVal = -1;
      for (var x = 0; x <= m.size; x++) {
        var v = x === m.size ? -2 : m.fog[y * m.size + x];
        if (v === runVal) continue;
        if (runStart >= 0 && runVal >= 0 && runVal < 2) {
          ctx.fillStyle = runVal === 0 ? '#0a0710' : 'rgba(8,6,16,.5)';
          ctx.fillRect(runStart * k, y * k, (x - runStart) * k + 0.6, k + 0.6);
        }
        runStart = x; runVal = v;
      }
    }

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
