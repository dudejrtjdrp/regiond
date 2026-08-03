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
  var CH = 16;
  var BASE = 16;

  var units = {};            // 주민 걷기 연출 (클라 권위)
  var walkIns = [];          // 걸어 들어오는 새 주민 {x,y,tx,ty,name,app,t}
  var lastT = 0, animT = 0;
  var hoverTile = { x: -1, y: -1 };
  var dragBox = null;
  var fencePath = null;      // 울타리 드래그 중인 꺾은선
  var territoryAnim = null;  // {from, to, t}
  var stakePhase = 0;
  var frameTimes = [];       // 프레임 간격 (스모크가 읽는다)
  var workTimes = [];        // 한 프레임을 그리는 데 든 시간 — 60fps 예산(16.7ms) 대비 여유

  /* ══════════ 마운트 ══════════ */
  function mount() {
    cv = U.qs('#world-canvas');
    if (!cv) return;
    resize();
    S.on('world', function () { chunkCache = {}; units = {}; recenter(); });
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
    GM.camera.setViewport(W, H);
  }

  /* ══════════ 지형 청크 ══════════ */
  function chunkCanvas(cx, cy) {
    var key = cx + ',' + cy;
    if (chunkCache[key]) return chunkCache[key];
    var m = S.S.map;
    if (!m) return null;
    var c = document.createElement('canvas');
    c.width = CH * BASE; c.height = CH * BASE;
    var g = c.getContext('2d');
    if (!g) return null;
    g.imageSmoothingEnabled = false;
    var codes = m.codes;
    for (var y = 0; y < CH; y++) {
      for (var x = 0; x < CH; x++) {
        var wx = cx * CH + x, wy = cy * CH + y;
        if (wx >= m.size || wy >= m.size) continue;
        var code = codes[m.terrain[wy * m.size + wx]] || 'grass';
        var v = GM.atlas.variantAt(wx, wy, 3);
        try { g.drawImage(GM.atlas.terrain(code, v), x * BASE, y * BASE); } catch (e) {}
      }
    }
    chunkCache[key] = c;
    return c;
  }

  function drawTerrain() {
    var m = S.S.map;
    if (!m) return;
    var cam = GM.camera.cam;
    var vis = GM.camera.visible();
    var cx0 = Math.floor(vis.x0 / CH), cx1 = Math.floor(vis.x1 / CH);
    var cy0 = Math.floor(vis.y0 / CH), cy1 = Math.floor(vis.y1 / CH);
    var scale = cam.tile / BASE;
    for (var cy = cy0; cy <= cy1; cy++) {
      for (var cx = cx0; cx <= cx1; cx++) {
        var c = chunkCanvas(cx, cy);
        if (!c) continue;
        var p = GM.camera.worldToScreen(cx * CH - 0.5, cy * CH - 0.5);
        try {
          ctx.drawImage(c, Math.round(p.x), Math.round(p.y),
            Math.ceil(CH * BASE * scale), Math.ceil(CH * BASE * scale));
        } catch (e) {}
      }
    }
  }

  /* ══════════ 전장의 안개 ══════════ */
  function drawFog() {
    var m = S.S.map;
    if (!m) return;
    var cam = GM.camera.cam;
    var vis = GM.camera.visible();
    var t = cam.tile;
    for (var y = vis.y0; y <= vis.y1; y++) {
      var runStart = -1, runVal = -1;
      for (var x = vis.x0; x <= vis.x1 + 1; x++) {
        var v = x > vis.x1 ? -2 : S.fogAt(x, y);
        if (v === runVal) continue;
        if (runStart >= 0 && runVal >= 0 && runVal < 2) {
          var p0 = GM.camera.worldToScreen(runStart - 0.5, y - 0.5);
          ctx.fillStyle = runVal === 0 ? '#0a0710' : 'rgba(8,6,16,.42)';
          ctx.fillRect(Math.floor(p0.x), Math.floor(p0.y), Math.ceil((x - runStart) * t) + 1, Math.ceil(t) + 1);
        }
        runStart = x; runVal = v;
      }
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
    for (var j = 0; j < pts.length; j++) {
      var p0 = pts[j], p1 = pts[(j + 1) % pts.length];
      if (!p0 || !p1) continue;
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
  }

  /* ══════════ 울타리 조각 ══════════ */
  function drawFences() {
    var list = S.fences();
    if (!list.length) return;
    var tile = GM.camera.cam.tile;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var mx = (f.x1 + f.x2) / 2, my = (f.y1 + f.y2) / 2;
      if (!GM.camera.onScreen(mx, my, tile * 2)) continue;
      if (S.fogAt(Math.round(mx), Math.round(my)) < 1) continue;
      var vertical = f.x1 === f.x2;
      var cond = f.condition === undefined ? 1 : f.condition;
      var dmg = f.broken ? 2 : (cond < 0.6 ? 1 : 0);
      var sp = GM.atlas.fence({ vertical: vertical, tier: f.tier, gate: f.gate, damage: dmg });
      var p = GM.camera.worldToScreen(mx - 0.5, my - 0.62);
      ctx.save();
      if (f.broken) ctx.globalAlpha = 0.6;
      try { ctx.drawImage(sp, Math.round(p.x), Math.round(p.y), Math.ceil(tile), Math.ceil(tile)); } catch (e) {}
      ctx.restore();
      if (S.S.selection && S.S.selection.fenceId === f.id) ringAt(mx, my, '#e8a33d', 0.9);
    }
  }

  /* ══════════ 자원 자리 ══════════ */
  function drawNodes() {
    var cam = GM.camera.cam;
    var list = S.nodeList();
    var t = cam.tile;
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (!GM.camera.onScreen(n.x, n.y, t)) continue;
      if (S.fogAt(n.x, n.y) < 1) continue;
      var sh = GM.fx ? GM.fx.nodeShake(n.id) : 0;
      var p = GM.camera.worldToScreen(n.x - 0.5 + sh, n.y - 0.5);
      var sp = GM.atlas.node(n.type, {
        stage: n.stage, rich: n.rich,
        thin: n.ratio !== undefined && n.ratio !== null && n.ratio < 0.4
      });
      try { ctx.drawImage(sp, Math.round(p.x), Math.round(p.y), Math.ceil(t), Math.ceil(t)); } catch (e) {}
      if (n.depleted) {
        ctx.fillStyle = 'rgba(20,14,8,.42)';
        ctx.fillRect(p.x, p.y, t, t);
      }
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

  /* ══════════ 건물 · 공사 · 도읍 ══════════ */
  var doneBounce = {};      // structureId → 완공 연출 시작 시각
  var structSort = { sig: '', list: [] };

  function bounceStructure(id) { doneBounce[id] = animT; }

  /** y 순으로 정렬된 건물 목록 — 60fps 예산을 위해 목록이 바뀔 때만 다시 정렬한다 */
  function sortedStructures() {
    var src = S.structures();
    var sig = src.length + ':' + (src.length ? src[0].id + ':' + src[src.length - 1].id : '');
    if (structSort.sig !== sig) {
      structSort.sig = sig;
      structSort.list = src.slice().sort(function (a, b) { return (a.y || 0) - (b.y || 0); });
    }
    return structSort.list;
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
      var f = S.footprintOfThing(b);
      var c = S.centerOfThing(b);
      if (!GM.camera.onScreen(c.x, c.y, t * (Math.max(f.w, f.h) + 2))) return;
      var scale = 1;
      var bd = doneBounce[b.id];
      if (bd !== undefined) {
        var age = (animT - bd) / 1000;
        if (age > 0.75) delete doneBounce[b.id];
        else scale = 1 + Math.sin(Math.min(1, age / 0.75) * Math.PI) * 0.22 * (1 - age / 0.75);
      }
      var w = t * (f.w + 0.7) * scale, h = t * (f.h + 0.7) * scale;
      var baseY = c.y + (f.h - 1) / 2 + 0.55;
      var p = GM.camera.worldToScreen(c.x - (f.w + 0.7) / 2 + 0.1, baseY - (f.h + 0.7));
      /* 본부 둘레의 광장 — 티어에 비례해 넓어진다 (§12-2) */
      if (b.hq) drawPlaza(c, t);
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
        var sprite = b.hq ? GM.atlas.hall(S.tierNo(), { ruined: b.ruined })
                          : GM.atlas.building(b.key, b.tier, { ruined: b.ruined });
        ctx.drawImage(sprite, Math.round(p.x), Math.round(p.y), Math.ceil(w), Math.ceil(h));
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
    var p = GM.camera.worldToScreen(c.x, c.y);
    ctx.save();
    var g;
    try {
      g = ctx.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, r);
      g.addColorStop(0, 'rgba(146,120,86,.34)');
      g.addColorStop(0.75, 'rgba(120,98,70,.18)');
      g.addColorStop(1, 'rgba(120,98,70,0)');
    } catch (e) { g = null; }
    if (g) {
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
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

  /** ★ §12-9 노동 루프 — 서버 수치와 무관한 순수 연출이다 */
  function stepWork(v, a, dt) {
    var res = CARRY_JOBS[v.job];
    var node = v.targetId ? S.nodeById(v.targetId) : null;
    if (!res || !node) { a.phase = 'idle'; a.carry = 0; return false; }
    a.home = a.home || { x: node.x, y: node.y };
    a.home.x = node.x; a.home.y = node.y;

    if (a.phase === 'work') {
      a.swingT = (a.swingT || 0) + dt;
      a.pose = Math.max(0, 1 - (a.swingT % 0.9) / 0.42);      // 0.9초마다 한 번 휘두른다
      faceTo(a, node.x - a.x, node.y - a.y);
      if (a.swingT - (a.lastHit || 0) >= 0.9) {
        a.lastHit = a.swingT;
        if (GM.fx) {
          GM.fx.shakeNode(node.id, 0.45);
          GM.fx.debris(node.x, node.y, S.nodeMeta(node.type).color, 3, 0.6);
        }
        a.carry = (a.carry || 0) + 1;
      }
      if ((a.carry || 0) >= 4) { a.phase = 'haul'; a.drop = dropSpot(a); a.swingT = 0; a.pose = 0; }
      return true;
    }
    if (a.phase === 'haul') {
      if (!a.drop) { a.phase = 'work'; return true; }
      if (walkStep(a, a.drop.x, a.drop.y, dt, WALK_SPEED * 0.86)) { a.phase = 'unload'; a.unloadT = 0; }
      return true;
    }
    if (a.phase === 'unload') {
      a.unloadT = (a.unloadT || 0) + dt;
      if (a.unloadT > 0.55) {
        // 하역 — 자원 팝을 소량 (숫자는 서버가 정한다. 이건 "일이 흘러간다"는 그림일 뿐이다)
        if (GM.fx) {
          GM.fx.dust(a.x, a.y, 4, '#c8a874');
          // 숫자는 붙이지 않는다 — 실제 셈은 서버의 일 틱이 한다. 여기서는 "무언가 들어갔다"만 보인다.
          GM.fx.resourcePop(a.x, a.y - 0.4, res, '', (S.resourceMeta(res) || {}).color);
        }
        a.carry = 0;
        a.phase = 'return';
      }
      return true;
    }
    if (a.phase === 'return') {
      if (walkStep(a, a.home.x, a.home.y, dt, WALK_SPEED)) { a.phase = 'work'; a.swingT = 0; a.lastHit = 0; }
      return true;
    }
    return false;
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
        if (Math.hypot(a.x - v.x, a.y - v.y) > SNAP_TILES) { a.x = v.x; a.y = v.y; }
      }

      /* 노동 루프가 돌고 있으면 이동은 그 안에서 한다 */
      if (a.phase !== 'travel' && stepWork(v, a, dt)) continue;

      var tx = v.destX == null ? v.x : v.destX;
      var ty = v.destY == null ? v.y : v.destY;
      if (walkStep(a, tx, ty, dt)) {
        /* 일터에 닿았다 — 노동 연출로 넘어간다 */
        if (a.phase === 'travel' && CARRY_JOBS[v.job] && v.targetId && S.nodeById(v.targetId)) {
          a.phase = 'work'; a.swingT = 0; a.lastHit = 0;
        } else {
          a.phase = 'idle';
        }
      }
    }
    for (var id in units) if (!seen[id]) delete units[id];

    /* 도착 연출 — 영토 밖에서 정착지로 걸어 들어온다 */
    for (var k = walkIns.length - 1; k >= 0; k--) {
      var wi = walkIns[k];
      wi.t += dt;
      var ddx = wi.tx - wi.x, ddy = wi.ty - wi.y;
      var dd = Math.hypot(ddx, ddy);
      if (dd < 0.4 || wi.t > 26) { walkIns.splice(k, 1); continue; }
      var step = Math.min(dd, 2.4 * dt);
      wi.x += ddx / dd * step; wi.y += ddy / dd * step;
      wi.dir = Math.abs(ddx) > Math.abs(ddy) ? (ddx > 0 ? 2 : 1) : (ddy > 0 ? 0 : 3);
      wi.ft = (wi.ft || 0) + dt;
      if (wi.ft > 0.2) { wi.ft = 0; wi.frame = wi.frame ? 0 : 1; }
    }
  }

  /** 새 주민이 걸어 들어오는 연출을 건다 */
  function walkIn(from, to, name, appearance) {
    walkIns.push({ x: from.x, y: from.y, tx: to.x, ty: to.y, name: name || '새 사람',
                   app: appearance || null, t: 0, dir: 0, frame: 0 });
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
      var p = GM.camera.worldToScreen(a.x - 0.36, a.y - 0.8);
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

    /* 걸어 들어오는 새 주민 */
    for (var k = 0; k < walkIns.length; k++) {
      var wi = walkIns[k];
      if (!GM.camera.onScreen(wi.x, wi.y, t * 2)) continue;
      var wp = GM.camera.worldToScreen(wi.x - 0.36, wi.y - 0.8);
      var ws = wi.app ? GM.atlas.avatar(wi.app, wi.dir, wi.frame, { crown: false })
                      : GM.atlas.folk('idle', wi.dir, wi.frame);
      try { ctx.drawImage(ws, Math.round(wp.x), Math.round(wp.y), Math.ceil(t * 0.72), Math.ceil(t * 0.92)); } catch (e5) {}
      label(wi.name, wi.x, wi.y - 1.15, '#f6e6a8');
    }
  }

  /* ══════════ 아바타 ══════════ */
  function drawAvatars() {
    var t = GM.camera.cam.tile;
    var mine = S.S.avatarId;
    (S.S.avatars || []).forEach(function (a) {
      if (a.id === mine) return;
      if (!GM.camera.onScreen(a.x, a.y, t * 2)) return;
      drawLord(a.x, a.y, a.appearance, 0, 0, a.name || '개척자', '#a8c8ff', a.id, 0, null, a.down);
    });
    var me = GM.avatar && GM.avatar.pos();
    // ★ §12-7 — 마차가 굴러오는 동안 개척자는 아직 마차 안에 있다. 내리는 순간 나타난다.
    if (me && !(GM.avatar.isHidden && GM.avatar.isHidden())) {
      var sw = GM.swing ? GM.swing.pose() : { phase: 0, tool: null };
      drawLord(me.x, me.y, S.S.you.appearance, me.dir, me.frame, '그대', '#f6cf7a', mine,
        sw.phase, sw.tool, S.downed());
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

  function drawLord(x, y, app, dir, frame, name, nameColor, avatarId, swingPhase, tool, down) {
    var t = GM.camera.cam.tile;
    var p = GM.camera.worldToScreen(x - 0.42, y - 1.05);
    var w = t * 0.88, h = t * 1.14;
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    try { ctx.ellipse(p.x + w / 2, p.y + h - 1, w * 0.4, w * 0.18, 0, 0, Math.PI * 2); } catch (e) {}
    ctx.fill();
    ctx.restore();
    ctx.save();
    if (down) {
      ctx.translate(p.x + w / 2, p.y + h);
      ctx.rotate(-Math.PI / 2.2);
      ctx.globalAlpha = 0.75;
      try { ctx.drawImage(GM.atlas.avatar(app, dir, 0), 0, -w / 2, Math.ceil(w), Math.ceil(h)); } catch (e1) {}
      ctx.restore();
      label(name + ' — 쓰러짐', x, y - 1.35, '#ff9d99');
      return;
    }
    try {
      ctx.drawImage(GM.atlas.avatar(app, dir, frame, { swing: swingPhase, tool: tool }),
        Math.round(p.x), Math.round(p.y), Math.ceil(w), Math.ceil(h));
    } catch (e2) {}
    ctx.restore();
    if (name && t >= 16) label(name, x, y - 1.35, nameColor || '#f4e4bc');
    var bub = GM.social && avatarId ? GM.social.bubbleFor(avatarId) : null;
    if (bub) label(bub, x, y - 2.15, '#fff6dc');
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
    if (hoverTile.x < 0) return;
    var v = GM.build ? GM.build.validate(pl, hoverTile.x, hoverTile.y) : { ok: true };
    /* ★ §12-1 — 고스트도 풋프린트 사각형 전체를 보여 준다 (놓기 전에 "얼마나 큰지"가 보여야 한다) */
    var key = pl.kind === 'build' ? pl.key : (pl.kind === 'relocate' ? pl.key : null);
    var f = key ? S.footprintOf(key) : { w: 1, h: 1 };
    var a0 = key ? S.anchorFromCell(key, hoverTile.x, hoverTile.y) : { x: hoverTile.x, y: hoverTile.y };
    var cxy = { x: a0.x + (f.w - 1) / 2, y: a0.y + (f.h - 1) / 2 };
    var p = GM.camera.worldToScreen(a0.x - 0.5, a0.y - 0.5);
    ctx.save();
    ctx.globalAlpha = 0.7;
    if (key) {
      var gw = t * (f.w + 0.7), gh = t * (f.h + 0.7);
      var gbase = cxy.y + (f.h - 1) / 2 + 0.55;
      var gp = GM.camera.worldToScreen(cxy.x - (f.w + 0.7) / 2 + 0.1, gbase - (f.h + 0.7));
      try {
        var gs = (S.buildingDef(key) || {}).hq ? GM.atlas.hall(S.tierNo()) : GM.atlas.building(key, 1);
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
    var lby = a0.y - 1.25;
    if (!v.ok && v.reason) label(v.reason, cxy.x, lby, '#ff9d99');
    else if (v.ok && v.note) label(v.note, cxy.x, lby, '#b8f0a0');

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

  function drawSelectionMarks() {
    var sel = S.S.selection;
    if (!sel) return;
    if (sel.nodeId) { var n = S.nodeById(sel.nodeId); if (n) ringAt(n.x, n.y, '#e8a33d'); }
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
    return {
      idx: i,
      alpha: U.lerp(cur.alpha, toward.alpha, k),
      tint: k > 0 ? U.mix(cur.tint, toward.tint, k) : cur.tint,
      sky: cur.sky, ground: cur.ground,
      skyK: 1 - Math.abs(local - 0.5) * 0.8
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
    /* ② 새벽·노을 그라데이션 */
    if (ph.sky || ph.ground) {
      var g0 = null;
      try {
        g0 = ctx.createLinearGradient(0, 0, 0, H);
        g0.addColorStop(0, ph.sky || 'rgba(0,0,0,0)');
        g0.addColorStop(0.52, 'rgba(0,0,0,0)');
        g0.addColorStop(1, ph.ground || 'rgba(0,0,0,0)');
      } catch (e) { g0 = null; }
      if (g0) {
        ctx.save();
        ctx.globalAlpha = ph.skyK;
        ctx.fillStyle = g0;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    }
    /* ③ 밤 광원 — 모닥불·본부·가로등·창문 */
    if (ph.idx !== 3 && ph.alpha < 0.3) return;
    var strength = U.clamp((ph.alpha - 0.2) / 0.5, 0, 1);
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
      var p = GM.camera.worldToScreen(c.x, c.y);
      var flick = kind === 'window' ? 1 : (0.92 + 0.08 * Math.sin(animT / (kind === 'lamp' ? 520 : 190) + c.x));
      var r = t * (kind === 'hq' ? 5.4 + S.tierNo() * 0.4 : (kind === 'fire' ? 4.6 : (kind === 'lamp' ? 3.4 : 2.4))) * flick;
      var g;
      try {
        g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, kind === 'window' ? 'rgba(255,214,150,.26)' : 'rgba(255,190,110,.42)');
        g.addColorStop(1, 'rgba(255,190,110,0)');
      } catch (e) { g = null; }
      if (!g) return;
      ctx.globalAlpha = strength;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  /* 밤에 창문이 켜지는 건물 — 사람이 사는 곳과 불을 쓰는 곳 */
  var LIT_HOUSES = { tent: 1, hut: 1, house: 1, manor: 1, granary: 1, smithy: 1, smelter: 1,
                     barracks: 1, market: 1, trading_post: 1, shrine: 1, consulate: 1, appraisal_post: 1 };

  /* ══════════ 라벨 ══════════ */
  function label(text, wx, wy, color) {
    var p = GM.camera.worldToScreen(wx, wy);
    if (p.x < -80 || p.y < -20 || p.x > W + 80 || p.y > H + 20) return;
    ctx.save();
    ctx.font = '11px "Galmuri11", monospace';
    ctx.textAlign = 'center';
    var w = 0;
    try { w = ctx.measureText(text).width; } catch (e) { w = String(text).length * 6; }
    ctx.fillStyle = 'rgba(20,14,8,.62)';
    ctx.fillRect(p.x - w / 2 - 3, p.y - 11, w + 6, 14);
    ctx.fillStyle = color || '#f4e4bc';
    try { ctx.fillText(text, p.x, p.y); } catch (e2) {}
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
    site: 'E — 짓기', enemy: 'E — 베기'
  };

  function verbFor(t) {
    if (!t) return null;
    if (t.kind === 'enemy') return VERB.enemy;
    if (t.kind === 'site') {
      var name = t.obj && t.obj.name ? t.obj.name : '공사';
      return 'E — ' + name + ' 짓기';
    }
    return VERB[t.nodeType] || 'E — 일하기';
  }

  /** ① 근처 대상 상호작용 라벨 — 손이 닿는 것 하나에만 붙는다 */
  function drawInteractPrompt() {
    if (!GM.swing || !GM.swing.target) return;
    if (GM.opening && GM.opening.busy && GM.opening.busy()) return;
    var t = GM.swing.target();
    if (!t) return;
    var txt = verbFor(t);
    if (!txt) return;
    var p = GM.camera.worldToScreen(t.x, t.y);
    var tile = GM.camera.cam.tile;
    var y = p.y - tile * 1.15;
    var bob = Math.sin(animT / 260) * 2;
    ctx.save();
    ctx.font = '12px Galmuri11, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var w = ctx.measureText(txt).width + 14;
    var ready = GM.swing.ready && GM.swing.ready();
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
    drawTerritory();
    if (GM.fx) GM.fx.drawStumps(ctx, tile);
    drawNodes();
    drawFences();
    drawStructures();
    drawCamps();
    drawMoveMarker();
    drawResidents();
    if (GM.combat && GM.combat.drawUnits) GM.combat.drawUnits(ctx, tile, animT);
    drawAvatars();
    drawCooldownRing();
    drawFog();
    drawDayNight();
    drawSelectionMarks();
    drawGhost();
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
    var w0 = (global.performance && performance.now) ? performance.now() : Date.now();

    var frozen = GM.fx && GM.fx.frozen();
    GM.camera.update(dt);
    if (!frozen) {
      stepUnits(dt);
      if (GM.avatar) GM.avatar.step(dt);
      if (GM.swing) GM.swing.step(dt);
      if (GM.combat && GM.combat.step) GM.combat.step(dt);
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
    if (GM.minimap) GM.minimap.draw();

    var w1 = (global.performance && performance.now) ? performance.now() : Date.now();
    workTimes.push(w1 - w0);
    if (workTimes.length > 240) workTimes.shift();
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
    return { avg: f.avg, p95: f.p95, n: f.n, workAvg: w.avg, workP95: w.p95 };
  }
  function resetStats() { frameTimes = []; workTimes = []; }

  function setHover(x, y) { hoverTile.x = x; hoverTile.y = y; }
  function hover() { return hoverTile; }
  function setDragBox(b) { dragBox = b; }
  function reset() {
    chunkCache = {}; units = {}; walkIns = []; doneBounce = {}; territoryAnim = null;
    structSort = { sig: '', list: [] };
  }

  GM.world = {
    mount: mount, resize: resize, draw: draw, tickAnim: tickAnim,
    setHover: setHover, hover: hover, setDragBox: setDragBox, recenter: recenter, reset: reset,
    animateTerritory: animateTerritory, bounceStructure: bounceStructure, walkIn: walkIn,
    setFencePath: setFencePath, getFencePath: getFencePath,
    label: label, ringAt: ringAt, verbFor: verbFor,
    frameStats: frameStats, resetStats: resetStats,
    size: function () { return { w: W, h: H }; },
    unitPos: function (id) { return units[id] || null; },
    /* ★ §12-11 회귀 하니스 전용 — jsdom 에는 rAF 시계가 없어 걸음을 손으로 돌린다 */
    stepUnitsForTest: stepUnits,
    ping: function (x, y, color) { if (GM.fx) GM.fx.ring(x, y, color || '#8dfa8d'); }
  };
})(window);
