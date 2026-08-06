/* fx.js — 이펙트 계층. GDD3 §8 「타격감 체크리스트」를 한 곳에 모았다.
     스윙 궤적 · 명중 순간 정지 · 파편 파티클 · 자원 팝이 아크를 그리며 HUD 로 흡수 ·
     나무 흔들림 · 그루터기 잔존 · 먼지 구름 · 황금 반짝 · 화면 흔들림 · 떠오르는 글자.

   두 층으로 그린다.
     ① 월드층 — world.js 가 카메라 변환 안에서 불러 준다 (궤적·파편·흔들림·그루터기)
     ② 화면층 — 이 파일이 직접 가진 전체 화면 캔버스 (자원 팝이 상단 자원칸까지 날아간다)
   상한을 두어 60fps 를 지킨다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var U = GM.ui;

  var MAX_PARTS = 260;
  var MAX_POPS = 40;

  var parts = [];        // 월드 파편 {x,y,vx,vy,life,max,color,size,g}
  var arcs = [];         // 스윙 궤적 {x,y,a0,a1,t,dur,color,reach}
  var rings = [];        // 충격 링 {x,y,t,dur,color,r0,r1,w}
  var floats = [];       // 월드 위 글자 {x,y,vy,t,dur,text,color,size}
  var stumps = [];       // 그루터기 {x,y,born,life,type}
  var slashes = [];      // 베기 섬광 {x,y,ang,t,dur,color,len}
  var pops = [];         // 화면층 자원 팝 {sx,sy,cx,cy,tx,ty,t,dur,icon,text,color}
  var shake = { t: 0, dur: 0, power: 0 };
  var freezeUntil = 0;
  var flashes = [];      // 전체 화면 번쩍 {t,dur,color,alpha}
  /* ★ GDD3 §13-B-5 — 사나운 땅(링2)에 발을 들인 순간 화면 **가장자리**가 한 번 붉어진다.
     화면 전체를 물들이면 지금 하던 일이 안 보인다 — 가운데는 그대로 두고 테두리만 경고한다. */
  var danger = { t: 0, dur: 0 };

  var layer = null, lctx = null, LW = 0, LH = 0;

  /* ══════════ 화면층 캔버스 ══════════ */
  function mount() {
    layer = U.qs('#fx-layer');
    if (!layer) return;
    resize();
    window.addEventListener('resize', resize);
  }
  function resize() {
    if (!layer) return;
    LW = Math.max(320, window.innerWidth || 1024);
    LH = Math.max(240, window.innerHeight || 768);
    layer.style.width = LW + 'px';
    layer.style.height = LH + 'px';
    lctx = U.fitCanvas(layer, LW, LH);
  }

  /* ══════════ 명중 순간 정지 · 화면 흔들림 ══════════ */
  /** 한 프레임쯤 세상을 멈춘다 — 때린 느낌은 여기서 절반이 나온다 */
  function hitStop(ms) {
    var t = now() + (ms === undefined ? 55 : ms);
    if (t > freezeUntil) freezeUntil = t;
  }
  function frozen() { return now() < freezeUntil; }
  function shakeScreen(power, dur) {
    var p = power === undefined ? 3 : power;
    if (p <= shake.power && shake.t < shake.dur) return;
    shake.power = p; shake.dur = dur === undefined ? 0.22 : dur; shake.t = 0;
  }
  /* ★ Sprint 3 — 흔들림 값을 담을 그릇 하나를 되쓴다. 「왜」 —
     이 판은 프레임마다 꼭 한 번 불리고(world.js 의 그리기 머리), 부르는 쪽은 값을 그 자리에서
     읽고 버린다. 그런데도 옛 셈은 프레임마다 점 객체를 하나씩 낳아 초당 예순 개의 쓰레기를
     쌓았다. 값은 옛것과 같다 — 다만 그릇을 새로 만들지 않을 뿐이다.
     계약: 부르는 쪽은 이 값을 **간직하지 않는다**(다음 프레임에 덮어써진다). */
  var SHAKE_OUT = { x: 0, y: 0 };
  function shakeOffset() {
    if (shake.t >= shake.dur) { SHAKE_OUT.x = 0; SHAKE_OUT.y = 0; return SHAKE_OUT; }
    var k = 1 - shake.t / shake.dur;
    var a = shake.t * 92;
    SHAKE_OUT.x = Math.sin(a) * shake.power * k;
    SHAKE_OUT.y = Math.cos(a * 1.37) * shake.power * k;
    return SHAKE_OUT;
  }
  function flash(color, alpha, dur) {
    flashes.push({ t: 0, dur: dur || 0.28, color: color || '#fff6dc', alpha: alpha === undefined ? 0.35 : alpha });
  }

  function now() {
    return (global.performance && performance.now) ? performance.now() : Date.now();
  }

  /* ══════════ 월드 이펙트 ══════════ */
  function push(list, item, cap) {
    list.push(item);
    if (list.length > cap) list.splice(0, list.length - cap);
  }

  /** 스윙 궤적 — 아바타가 대상 쪽으로 도구를 휘두른 자국 */
  function swingArc(x, y, angle, color, reach) {
    push(arcs, { x: x, y: y, a0: angle - 1.15, a1: angle + 0.75, t: 0, dur: 0.19,
                 color: color || '#fff6dc', reach: reach || 1.05 }, 8);
  }

  /** 베기 섬광 — 전투 스윙 */
  function slash(x, y, angle, color) {
    push(slashes, { x: x, y: y, ang: angle, t: 0, dur: 0.16, color: color || '#ffe9a8', len: 1.5 }, 10);
  }

  /** 파편 — 나무 부스러기·돌조각·흙 */
  function debris(x, y, color, count, power) {
    var n = count === undefined ? 7 : count;
    var p = power === undefined ? 1 : power;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = (0.9 + Math.random() * 2.1) * p;
      push(parts, {
        x: x, y: y,
        vx: Math.cos(a) * sp, vy: -Math.abs(Math.sin(a)) * sp - 0.9 * p,
        life: 0.42 + Math.random() * 0.34, max: 0.76,
        color: color || '#c8a874', size: 2 + Math.floor(Math.random() * 2), g: 7.5
      }, MAX_PARTS);
    }
  }

  /** 흙먼지 — 건물 완공·주민 착지 */
  function dust(x, y, count, color) {
    var n = count === undefined ? 14 : count;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      push(parts, {
        x: x + Math.cos(a) * 0.5, y: y + Math.sin(a) * 0.25,
        vx: Math.cos(a) * (0.7 + Math.random()), vy: -0.25 - Math.random() * 0.5,
        life: 0.5 + Math.random() * 0.5, max: 1,
        color: color || '#d8c69a', size: 3, g: 1.2, soft: true
      }, MAX_PARTS);
    }
  }

  /** 황금 반짝 — 개축·티어업·레벨업 */
  function sparkle(x, y, count, color) {
    var n = count === undefined ? 12 : count;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      push(parts, {
        x: x, y: y,
        vx: Math.cos(a) * (0.5 + Math.random() * 1.4), vy: Math.sin(a) * (0.5 + Math.random() * 1.4) - 1,
        life: 0.6 + Math.random() * 0.5, max: 1.1,
        color: color || '#f6cf7a', size: 2, g: -0.8, twinkle: true
      }, MAX_PARTS);
    }
  }

  function ring(x, y, color, r0, r1, dur, w) {
    push(rings, { x: x, y: y, t: 0, dur: dur || 0.55, color: color || '#f6cf7a',
                  r0: r0 === undefined ? 0.2 : r0, r1: r1 === undefined ? 1.6 : r1, w: w || 2.5 }, 24);
  }

  function floatText(x, y, text, color, size) {
    push(floats, { x: x, y: y, vy: -1.35, t: 0, dur: 1.05, text: text,
                   color: color || '#fff6dc', size: size || 13 }, 24);
  }

  /** 벤 자리에 남는 그루터기 (GDD3 §8) */
  function stump(x, y, type, life) {
    stumps.push({ x: x, y: y, type: type || 'forest', born: now(), life: (life || 26) * 1000 });
    if (stumps.length > 40) stumps.shift();
  }
  function stumpList() { return stumps; }

  /* 노드 흔들림 — world.js 가 스프라이트를 그릴 때 이 값만큼 좌우로 민다 */
  var shakes = {};
  function shakeNode(id, power) {
    shakes[id] = { t: now(), power: power === undefined ? 1 : power };
  }
  function nodeShake(id) {
    var s = shakes[id];
    if (!s) return 0;
    var age = (now() - s.t) / 1000;
    if (age > 0.34) { delete shakes[id]; return 0; }
    return Math.sin(age * 46) * (1 - age / 0.34) * 0.16 * s.power;
  }

  /* ══════════ 자원 팝 — 아크를 그리며 HUD 로 흡수 ══════════ */
  /**
   * 월드 좌표에서 튀어나와 상단 자원칸으로 빨려 들어간다.
   * @param {number} wx,wy 월드 좌표
   * @param {string} resKey 자원 키 (HUD 목적지를 찾는 열쇠)
   * @param {string} text  화면에 뜰 글자 (+4 목재)
   */
  function resourcePop(wx, wy, resKey, text, color) {
    if (!GM.camera) return;
    var p = GM.camera.worldToScreen(wx, wy);
    var host = U.qs('#world-canvas');
    var r = host ? host.getBoundingClientRect() : { left: 0, top: 0 };
    var sx = r.left + p.x + (Math.random() - 0.5) * 18;
    var sy = r.top + p.y - 8;
    var dest = GM.hud && GM.hud.chipPoint ? GM.hud.chipPoint(resKey) : null;
    if (!dest) dest = { x: LW * 0.3, y: 26 };
    /* 아크의 꼭짓점 — 위로 한 번 솟았다가 빨려 들어간다 */
    var cx = (sx + dest.x) / 2 + (Math.random() - 0.5) * 60;
    var cy = Math.min(sy, dest.y) - 90 - Math.random() * 40;
    push(pops, { sx: sx, sy: sy, cx: cx, cy: cy, tx: dest.x, ty: dest.y,
                 t: 0, dur: 0.72 + Math.random() * 0.12, text: text || '',
                 color: color || '#f6e6a8', key: resKey, hit: false }, MAX_POPS);
  }

  /* ══════════ 스텝 ══════════ */
  function step(dt) {
    var i;
    for (i = parts.length - 1; i >= 0; i--) {
      var pt = parts[i];
      pt.life -= dt;
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.vy += pt.g * dt;
      pt.vx *= 0.985;
      if (pt.life <= 0) parts.splice(i, 1);
    }
    for (i = arcs.length - 1; i >= 0; i--) { arcs[i].t += dt; if (arcs[i].t > arcs[i].dur) arcs.splice(i, 1); }
    for (i = slashes.length - 1; i >= 0; i--) { slashes[i].t += dt; if (slashes[i].t > slashes[i].dur) slashes.splice(i, 1); }
    for (i = rings.length - 1; i >= 0; i--) { rings[i].t += dt; if (rings[i].t > rings[i].dur) rings.splice(i, 1); }
    for (i = floats.length - 1; i >= 0; i--) {
      floats[i].t += dt;
      floats[i].y += floats[i].vy * dt;
      floats[i].vy *= 0.94;
      if (floats[i].t > floats[i].dur) floats.splice(i, 1);
    }
    for (i = flashes.length - 1; i >= 0; i--) { flashes[i].t += dt; if (flashes[i].t > flashes[i].dur) flashes.splice(i, 1); }
    if (danger.dur > 0) danger.t += dt;
    var t0 = now();
    for (i = stumps.length - 1; i >= 0; i--) if (t0 - stumps[i].born > stumps[i].life) stumps.splice(i, 1);
    if (shake.t < shake.dur) shake.t += dt;

    for (i = pops.length - 1; i >= 0; i--) {
      var po = pops[i];
      po.t += dt;
      if (!po.hit && po.t >= po.dur) {
        po.hit = true;
        if (GM.hud && GM.hud.absorb) GM.hud.absorb(po.key);
      }
      if (po.t > po.dur + 0.06) pops.splice(i, 1);
    }
  }

  /* ══════════ 월드층 그리기 (world.js 가 부른다) ══════════ */
  function drawWorld(ctx, tile) {
    var i, p, s;
    /* 스윙 궤적 */
    for (i = 0; i < arcs.length; i++) {
      var a = arcs[i];
      var k = a.t / a.dur;
      var c = GM.camera.worldToScreen(a.x, a.y - 0.45);
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.85;
      ctx.strokeStyle = a.color;
      ctx.lineWidth = Math.max(2, tile * 0.13 * (1 - k * 0.5));
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(c.x, c.y, tile * a.reach, a.a0 + (a.a1 - a.a0) * Math.max(0, k - 0.32),
              a.a0 + (a.a1 - a.a0) * Math.min(1, k + 0.16));
      ctx.stroke();
      ctx.restore();
    }
    /* 베기 섬광 */
    for (i = 0; i < slashes.length; i++) {
      s = slashes[i];
      var sk = s.t / s.dur;
      var sc = GM.camera.worldToScreen(s.x, s.y);
      ctx.save();
      ctx.translate(sc.x, sc.y);
      ctx.rotate(s.ang);
      ctx.globalAlpha = 1 - sk;
      ctx.fillStyle = s.color;
      var len = tile * s.len * (0.5 + sk * 0.8);
      ctx.fillRect(-len / 2, -Math.max(1, tile * 0.06), len, Math.max(2, tile * 0.12));
      ctx.restore();
    }
    /* 충격 링 */
    for (i = 0; i < rings.length; i++) {
      var rg = rings[i];
      var rk = rg.t / rg.dur;
      var rc = GM.camera.worldToScreen(rg.x, rg.y);
      ctx.save();
      ctx.globalAlpha = 1 - rk;
      ctx.strokeStyle = rg.color;
      ctx.lineWidth = rg.w;
      ctx.beginPath();
      ctx.arc(rc.x, rc.y, tile * (rg.r0 + (rg.r1 - rg.r0) * rk), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    /* 파편 — ★ Sprint 3: 파편은 한 번에 260개까지 살아 있고 프레임마다 전부 그린다.
       그 자리마다 점 객체를 낳으면 초당 만 개가 넘는 쓰레기가 된다. 좌표만 세는 셈으로 바꾼다
       (worldToScreenX/Y 는 worldToScreen 과 **같은 식**이다 — 그림은 한 점도 안 달라진다). */
    var W2SX = GM.camera.worldToScreenX, W2SY = GM.camera.worldToScreenY;
    ctx.save();
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      var ppx = W2SX(p.x), ppy = W2SY(p.y);
      var al = U.clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = p.twinkle ? al * (0.55 + 0.45 * Math.sin(p.life * 40)) : al;
      ctx.fillStyle = p.color;
      var sz = p.size * (p.soft ? (1 + (1 - al) * 1.6) : 1) * Math.max(0.6, tile / 24);
      ctx.fillRect(ppx - sz / 2, ppy - sz / 2, sz, sz);
    }
    ctx.restore();
    /* 떠오르는 글자 */
    ctx.save();
    ctx.textAlign = 'center';
    for (i = 0; i < floats.length; i++) {
      var f = floats[i];
      var fpx = W2SX(f.x), fpy = W2SY(f.y);        // ★ Sprint 3 — 점 객체를 안 만든다
      ctx.globalAlpha = U.clamp(1 - f.t / f.dur, 0, 1);
      ctx.font = 'bold ' + Math.round(f.size) + 'px "Galmuri11", monospace';
      ctx.fillStyle = '#20160c';
      try { ctx.fillText(f.text, fpx + 1, fpy + 1); } catch (e) {}
      ctx.fillStyle = f.color;
      try { ctx.fillText(f.text, fpx, fpy); } catch (e2) {}
    }
    ctx.restore();
  }

  /** 그루터기는 지형 위·건물 아래에 깔린다 */
  function drawStumps(ctx, tile) {
    var t0 = now();
    for (var i = 0; i < stumps.length; i++) {
      var st = stumps[i];
      var age = (t0 - st.born) / st.life;
      var p = GM.camera.worldToScreen(st.x - 0.5, st.y - 0.5);
      ctx.save();
      ctx.globalAlpha = U.clamp(1 - age * age, 0.15, 1);
      try {
        ctx.drawImage(GM.atlas.stump(st.type), Math.round(p.x), Math.round(p.y),
          Math.ceil(tile), Math.ceil(tile));
      } catch (e) {}
      ctx.restore();
    }
  }

  /* ══════════ 화면층 그리기 (자원 팝) ══════════ */
  /** 사나운 땅 경고 — 가장자리 붉은 기 한 번 (§13-B-5) */
  function dangerEdge(seconds) {
    danger.dur = seconds || 1.6;
    danger.t = 0;
  }

  function drawDangerEdge() {
    if (danger.dur <= 0) return;
    var k = danger.t / danger.dur;
    if (k >= 1) { danger.dur = 0; return; }
    var a = Math.sin(Math.PI * k) * 0.55;
    var thick = Math.max(24, Math.min(LW, LH) * 0.16);
    lctx.save();
    lctx.globalAlpha = a;
    var edges = [
      [0, 0, LW, thick, 0, 0, 0, thick],
      [0, LH - thick, LW, thick, 0, LH, 0, LH - thick],
      [0, 0, thick, LH, 0, 0, thick, 0],
      [LW - thick, 0, thick, LH, LW, 0, LW - thick, 0]
    ];
    for (var e = 0; e < edges.length; e++) {
      var d = edges[e];
      var g = lctx.createLinearGradient(d[4], d[5], d[6], d[7]);
      g.addColorStop(0, 'rgba(188,71,73,.95)');
      g.addColorStop(1, 'rgba(188,71,73,0)');
      lctx.fillStyle = g;
      lctx.fillRect(d[0], d[1], d[2], d[3]);
    }
    lctx.restore();
  }

  /* ★ Sprint 3 — 화면층은 대개 **텅 비어 있다**(자원 팝도 번쩍임도 없는 보통의 순간).
     그런데도 옛 셈은 프레임마다 창 전체(1920×1080이면 200만 픽셀)를 지우고 있었다.
     지울 것이 없으면 지우지 않는다. 다만 마지막 하나가 사라진 그 프레임에는 **반드시**
     한 번 지워야 남은 그림이 화면에 눌어붙지 않는다 — 그래서 지난 프레임에 뭔가 있었는지를
     기억해 둔다(layerWasDirty). 눈에 보이는 결과는 옛것과 똑같다. */
  var layerWasDirty = false;

  function drawLayer() {
    if (!lctx) return;
    var hasWork = danger.dur > 0 || flashes.length > 0 || pops.length > 0;
    if (!hasWork && !layerWasDirty) return;
    layerWasDirty = hasWork;
    lctx.clearRect(0, 0, LW, LH);
    if (!hasWork) return;                 // 마지막 뒷정리 — 지우기만 하고 끝낸다
    var i;
    drawDangerEdge();
    for (i = 0; i < flashes.length; i++) {
      var fl = flashes[i];
      lctx.save();
      lctx.globalAlpha = (1 - fl.t / fl.dur) * fl.alpha;
      lctx.fillStyle = fl.color;
      lctx.fillRect(0, 0, LW, LH);
      lctx.restore();
    }
    lctx.save();
    lctx.textAlign = 'center';
    lctx.textBaseline = 'middle';
    for (i = 0; i < pops.length; i++) {
      var p = pops[i];
      var k = U.clamp(p.t / p.dur, 0, 1);
      var e = k * k * (3 - 2 * k);                       // 부드럽게 시작해 빨려 들어간다
      var mx = (1 - e) * (1 - e) * p.sx + 2 * (1 - e) * e * p.cx + e * e * p.tx;
      var my = (1 - e) * (1 - e) * p.sy + 2 * (1 - e) * e * p.cy + e * e * p.ty;
      var alpha = k < 0.82 ? 1 : (1 - (k - 0.82) / 0.18);
      var scale = 1 + 0.35 * Math.sin(Math.PI * k) - k * 0.35;
      lctx.globalAlpha = U.clamp(alpha, 0, 1);
      lctx.font = 'bold ' + Math.round(15 * scale) + 'px "Galmuri11", monospace';
      lctx.fillStyle = 'rgba(20,14,8,.75)';
      try { lctx.fillText(p.text, mx + 1.5, my + 1.5); } catch (e1) {}
      lctx.fillStyle = p.color;
      try { lctx.fillText(p.text, mx, my); } catch (e2) {}
    }
    lctx.restore();
  }

  function busy() { return pops.length + parts.length + arcs.length; }

  function reset() {
    parts = []; arcs = []; rings = []; floats = []; stumps = []; slashes = []; pops = [];
    flashes = []; shakes = {};
    danger = { t: 0, dur: 0 };
    shake = { t: 0, dur: 0, power: 0 };
    freezeUntil = 0;
    layerWasDirty = true;      // ★ Sprint 3 — 판을 갈아엎었으니 남은 그림을 한 번은 지워 준다
  }

  GM.fx = {
    mount: mount, resize: resize, step: step, drawWorld: drawWorld, drawStumps: drawStumps,
    drawLayer: drawLayer, reset: reset, busy: busy,
    hitStop: hitStop, frozen: frozen, shakeScreen: shakeScreen, shakeOffset: shakeOffset, flash: flash,
    swingArc: swingArc, slash: slash, debris: debris, dust: dust, sparkle: sparkle,
    ring: ring, floatText: floatText, stump: stump, stumpList: stumpList,
    dangerEdge: dangerEdge,
    shakeNode: shakeNode, nodeShake: nodeShake, resourcePop: resourcePop,
    counts: function () { return { parts: parts.length, pops: pops.length }; }
  };
})(window);
