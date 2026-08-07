/* input.js — 월드 캔버스 조작.
   카메라(방향키·가장자리·휠) · 아바타(WASD·**우클릭 지면** 이동 — 좌클릭은 선택·상호작용 전용, GDD3 §12-5) · ★ 누르고 있으면 계속 스윙 ·
   주민(클릭 선택 / 드래그 박스 / 우클릭 명령) · 배치(고스트 클릭) · ★ 울타리 드래그 · 단축키. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var keys = { up: 0, down: 0, left: 0, right: 0, camUp: 0, camDown: 0, camLeft: 0, camRight: 0 };
  var cv = null;
  var drag = null;          // {sx, sy, x, y, moved, mode}
  var pointerIn = false, px = 0, py = 0, lastPointerAt = 0;
  var followUntil = 0;
  var manualPanAt = 0;
  var eHeld = false;

  function init() {
    cv = U.qs('#world-canvas');
    if (!cv) return;
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('pointerleave', function () { pointerIn = false; GM.world.setHover(-1, -1); });
    cv.addEventListener('pointerenter', function () { pointerIn = true; });
    cv.addEventListener('contextmenu', onContext);
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('dblclick', function (e) { e.preventDefault(); });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', function () {
      keys.up = keys.down = keys.left = keys.right = 0;
      keys.camUp = keys.camDown = keys.camLeft = keys.camRight = 0;
      eHeld = false;
      if (GM.swing) GM.swing.stopHold();
    });
  }

  function tileFrom(e) {
    var r = cv.getBoundingClientRect();
    return GM.camera.screenToTile(e.clientX - r.left, e.clientY - r.top);
  }
  function localXY(e) {
    var r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** 이 칸을 누르면 스윙이 되는가 — 대상이 사거리 안에 있어야 한다 */
  function swingableAt(tx, ty) {
    if (!GM.swing) return false;
    var t = GM.swing.target();
    if (!t) return false;
    return Math.max(Math.abs(t.x - tx), Math.abs(t.y - ty)) <= 1.2;
  }

  /* ══════════ 마우스 ══════════ */
  function onDown(e) {
    if (e.button === 2) return;
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    var l = localXY(e);
    var t = tileFrom(e);
    var pl = S.S.placing;

    /* ★ 울타리(선분)와 철로·다리·매립(칸)은 같은 끌기를 쓴다 — 모으는 점의 뜻만 다르다 */
    if (pl && (pl.kind === 'fence' || pl.kind === 'rail' || pl.kind === 'bridge' || pl.kind === 'fill')) {
      GM.world.setFencePath([{ x: t.x, y: t.y }]);
      drag = { sx: l.x, sy: l.y, x: l.x, y: l.y, moved: false, mode: pl.kind };
      return;
    }
    if (pl && pl.kind === 'reclaim') {
      pl.drag = { x0: t.x, y0: t.y };
      drag = { sx: l.x, sy: l.y, x: l.x, y: l.y, moved: false, mode: 'reclaim' };
      return;
    }
    /* ★ §12-12 — 이전(relocate)도 같은 고스트 배치 흐름을 탄다 */
    if (pl && (pl.kind === 'build' || pl.kind === 'relocate')) {
      drag = { sx: l.x, sy: l.y, x: l.x, y: l.y, moved: false, mode: 'place' };
      return;
    }
    /* ★ §16-18 · §16-19 · §17-11 — 집결지·수비 깃발·동료 보내기: 다음 클릭 한 번이 곧 지정이다 */
    if (pl && (pl.kind === 'rally' || pl.kind === 'flag' || pl.kind === 'crewMove')) {
      drag = { sx: l.x, sy: l.y, x: l.x, y: l.y, moved: false, mode: pl.kind };
      return;
    }
    /* ★ 대상 곁이면 누르고 있는 동안 계속 스윙한다 */
    if (swingableAt(t.x, t.y)) {
      drag = { sx: l.x, sy: l.y, x: l.x, y: l.y, moved: false, mode: 'swing' };
      GM.swing.startHold();
      return;
    }
    drag = { sx: l.x, sy: l.y, x: l.x, y: l.y, moved: false, mode: 'select', additive: e.shiftKey };
  }

  function onMove(e) {
    pointerIn = true;
    lastPointerAt = Date.now();
    var l = localXY(e);
    px = l.x; py = l.y;
    var t = tileFrom(e);
    GM.world.setHover(t.x, t.y);
    if (!drag) return;
    drag.x = l.x; drag.y = l.y;
    if (Math.abs(l.x - drag.sx) > 6 || Math.abs(l.y - drag.sy) > 6) drag.moved = true;
    if (drag.mode === 'select' && drag.moved) {
      GM.world.setDragBox({ x0: drag.sx, y0: drag.sy, x1: l.x, y1: l.y });
    }
    if (drag.mode === 'fence' || drag.mode === 'rail' || drag.mode === 'bridge' || drag.mode === 'fill') {
      var path = GM.world.getFencePath() || [];
      var last = path[path.length - 1];
      if (!last || last.x !== t.x || last.y !== t.y) {
        var cfg = drag.mode === 'rail' ? (S.railCfg() || { maxPointsPerRequest: 64 })
          : (drag.mode === 'bridge' ? (S.bridgeCfg() || { maxPointsPerRequest: 64 })
            : (drag.mode === 'fill' ? (S.fillCfg() || { maxPointsPerRequest: 64 }) : S.fenceCfg()));
        if (path.length < (cfg.maxPointsPerRequest || 64)) {
          path.push({ x: t.x, y: t.y });
          GM.world.setFencePath(path);
        }
      }
    }
  }

  function onUp(e) {
    if (GM.swing) GM.swing.stopHold();
    if (!drag) return;
    var d = drag;
    drag = null;
    GM.world.setDragBox(null);
    var t = tileFrom(e);
    var pl = S.S.placing;

    if (d.mode === 'swing') return;

    if (d.mode === 'fence') {
      var path = GM.world.getFencePath() || [];
      GM.build.commitFence(path, !!e.shiftKey);
      return;
    }
    if (d.mode === 'rail') {
      GM.build.commitRail(GM.world.getFencePath() || []);
      return;
    }
    /* ★ §17-13 — 다리·매립도 같은 끌기로 놓는다 */
    if (d.mode === 'bridge' || d.mode === 'fill') {
      GM.build.commitOverlay(d.mode, GM.world.getFencePath() || []);
      return;
    }

    if (d.mode === 'reclaim') {
      var a = pl && pl.drag;
      if (a) {
        if (a.x0 === t.x && a.y0 === t.y) GM.build.commit(t.x, t.y);
        else GM.build.commitReclaimBox(a.x0, a.y0, t.x, t.y);
        pl.drag = null;
      }
      return;
    }

    if (d.mode === 'place') { GM.build.commit(t.x, t.y); return; }

    /* ★ §16-18 — 집결지: 일터(노드)를 눌러 꽂는다 */
    if (d.mode === 'rally') {
      S.setPlacing(null);
      var rn = S.nodeAt(t.x, t.y);
      if (!rn || S.fogAt(t.x, t.y) < 1) { U.toast('일터(자원 자리)를 눌러 주세요.', 'warn', 2400); return; }
      GM.net.send('setRally', { targetId: rn.id }, function (res) {
        if (!res || !res.ok) { U.toast((res && res.error && res.error.message) || '지금은 꽂을 수 없습니다.', 'warn'); return; }
        U.toast('집결지를 꽂았습니다 — 새로 오는 주민이 이리로 옵니다.', 'good', 3200);
        GM.world.ping(rn.x, rn.y, '#f6cf7a');
        GM.sfx.play('build');
      });
      return;
    }
    /* ★ §17-11 — 동료 보내기: 땅을 눌러 그 자리를 찍는다(패널의 [이곳으로 보낸다]) */
    if (d.mode === 'crewMove') {
      var crewId = pl && pl.companionId;
      S.setPlacing(null);
      if (S.fogAt(t.x, t.y) < 1) { U.toast('아직 못 본 땅입니다.', 'warn', 2400); return; }
      GM.net.send('commandCompanion', { companionId: crewId, order: { kind: 'move', x: t.x, y: t.y } }, function (res) {
        if (!res || !res.ok) { U.toast((res && res.error && res.error.message) || '지금은 지시할 수 없습니다.', 'warn'); return; }
        U.toast('지시를 내렸습니다 — 그 자리로 갑니다.', 'good', 3200);
        GM.world.ping(t.x, t.y, '#8fe3b4');
        GM.sfx.play('tap');
      });
      return;
    }

    /* ★ §16-19 — 수비 깃발: 땅을 눌러 꽂는다 */
    if (d.mode === 'flag') {
      S.setPlacing(null);
      if (S.fogAt(t.x, t.y) < 1) { U.toast('아직 못 본 땅입니다.', 'warn', 2400); return; }
      GM.net.send('setDefenseFlag', { x: t.x, y: t.y }, function (res) {
        if (!res || !res.ok) { U.toast((res && res.error && res.error.message) || '지금은 꽂을 수 없습니다.', 'warn'); return; }
        U.toast('수비 깃발을 꽂았습니다 — 수비대가 그리로 모입니다.', 'good', 3200);
        GM.world.ping(t.x, t.y, '#bc4749');
        GM.sfx.play('build');
      });
      return;
    }

    if (d.moved) {
      var w0 = GM.camera.screenToWorld(d.sx, d.sy);
      var w1 = GM.camera.screenToWorld(d.x, d.y);
      GM.residents.selectBox(w0.x, w0.y, w1.x, w1.y, d.additive);
      return;
    }

    /* ★ GDD3 §12-5 — 좌클릭은 **선택·상호작용 전용**이다. 절대 걷지 않는다.
       (옛 규칙에서는 빈 땅 좌클릭이 곧 이동이라, 무언가 고르려다 자꾸 걸어갔다.) */
    var w = GM.camera.screenToWorld(d.x, d.y);

    /* ★ Sprint 1 — 통합 픽킹. 옛 사슬은 대상마다 좌표계(월드/칸)·여유·동순위 규칙이 제각각이라
         · 건물·공사장의 ±1칸 관용 판정이 주민(반경 0.75)·울타리(맨 끝 순서)를 상시 가로챘다
         · 울타리는 forEach 마지막 매치가 이겨 곁의 딴 조각이 열렸다
       이제 **정확 판정**을 우선순위대로 지나고 — 유닛 > 울타리(점-선분 거리) > 발밑 사각형 >
       자원 > 얼굴 사각형 — 한 칸 여유는 전부 빗나갔을 때 가장 가까운 것 하나만 받는다. */
    if (GM.residents.selectAt(w.x, w.y, d.additive)) return;

    /* ★ §17-11 — 동료(봇)를 누르면 상호작용 패널이 열린다(지시·이름·모양새).
       건물보다 먼저 잰다 — 동료는 걸어 다니는 몸이라 건물 발밑을 지날 때가 많다. */
    /* ★ §17-19(D-5) — 이제 먼저 말을 건다(대화창). 수치판은 「무엇을 하는지 본다」를 고를 때 열린다. */
    var crew = crewAt(w.x, w.y);
    if (crew) { GM.crewpanel.greet(crew.id); GM.sfx.play('tap'); return; }

    var f = fenceAt(w.x, w.y);
    if (f) { GM.structure.openFence(f.id); GM.sfx.play('tap'); return; }

    /* ★ Sprint 5 — 적 야영지. 마을 밖 먼 자리라 건물·주민과 겹칠 일이 드물어
       울타리 다음, 건물 앞에 둔다(닿는 것 중 가장 가까운 하나). */
    var cp = campAt(w.x, w.y);
    if (cp) { GM.structure.openCamp(cp.id); GM.sfx.play('tap'); return; }

    var b = structureAt(t.x, t.y);
    if (b) { GM.structure.open(b.id); GM.sfx.play('tap'); return; }

    var site = siteAt(t.x, t.y);
    if (site) { GM.structure.openSite(site.id); GM.sfx.play('tap'); return; }

    var n = S.nodeAt(t.x, t.y);
    if (n && S.fogAt(t.x, t.y) >= 1) { GM.structure.openNode(n.id); GM.sfx.play('tap'); return; }

    /* ★ §16-20 — 키 큰 건물의 「얼굴」을 눌러도 잡힌다. 발밑(풋프린트)이 다 빗나갔을 때,
       그려진 스프라이트 사각형으로 한 번 더 잰다(앞에 선 건물이 이긴다). */
    var sb = structureAtSprite(w.x, w.y);
    if (sb) { GM.structure.open(sb.id); GM.sfx.play('tap'); return; }

    /* 한 칸 여유(옛 감각) — 정확 판정이 전부 빗나갔을 때만, 가장 가까운 것 하나 */
    var nm = nearMissAt(t.x, t.y);
    if (nm) {
      if (nm.kind === 'site') GM.structure.openSite(nm.obj.id);
      else GM.structure.open(nm.obj.id);
      GM.sfx.play('tap');
      return;
    }

    /* 빈 땅 좌클릭 = 선택 해제 (이동 아님) */
    S.clearSelection();
    GM.hud.hideContext();
  }

  /**
   * ★ GDD3 §12-5 — 우클릭이 이동·명령을 맡는다.
   *   우선순위: 배치 중이면 취소 → 백성을 고른 상태면 백성 명령 → 그 밖에는 아바타 이동(마커 링)
   */
  function onContext(e) {
    e.preventDefault();
    var t = tileFrom(e);
    if (S.S.placing) { S.setPlacing(null); GM.build.close(); return; }
    var ids = S.S.selection.residents || [];
    if (ids.length) { GM.residents.command(t.x, t.y); return; }
    /* ★ Sprint 1 — ① moveTo 가 길찾기를 하고 실제 목적지(물이면 곁의 뭍)를 돌려준다.
       마커 링은 그 실제 자리에 찍는다 — 링과 도착점이 어긋나지 않는다.
       ② 예전엔 여기서 followUntil 을 6초 걸어, 멀리 화면을 옮겨 두고 우클릭하면 900ms 뒤
       카메라가 **내 몸 자리로 홱 돌아갔다**(「클릭하면 내 자리로 와버린다」의 정체).
       이제 카메라는 그대로 두고, 걷는 몸이 화면 밖으로 나가려 할 때만 따라간다(step). */
    var goal = GM.avatar.moveTo(t.x, t.y);
    if (goal) {
      GM.world.ping(goal.x, goal.y, '#8dfa8d');
      GM.sfx.play('tap');
    } else {
      GM.world.ping(t.x, t.y, '#bc4749');   // 갈 수 없는 자리 — 붉은 링으로만 답한다
    }
  }

  function onWheel(e) {
    e.preventDefault();
    var l = localXY(e);
    GM.camera.zoomBy(e.deltaY > 0 ? -1 : 1, l);
    manualPanAt = Date.now();
  }

  /**
   * ★ §16-20 — 그려진 스프라이트 사각형(월드 좌표) 판정.
   * ★ §17-19 — 사각형 식을 여기서 다시 세지 않는다. 그림과 똑같은 자를 쓰지 않으면
   *   스프라이트를 키우는 순간 「보이는데 눌러지지 않는 건물」이 생긴다(GM.world.structureRect).
   */
  function structureAtSprite(wx, wy) {
    var list = S.structures();
    var best = null, bestBase = -1e9;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.x == null) continue;
      var r = GM.world.structureRect(b);
      if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.baseY && r.baseY > bestBase) {
        best = b; bestBase = r.baseY;
      }
    }
    return best;
  }

  /* ★ §17-11 — 동료(봇) 아바타 판정. 그려진 자리(보간 matePos)가 정본이다 —
     서버 좌표는 이미 앞서 가 있어, 서버 좌표로 재면 화면에 보이는 몸을 눌러도 빗나간다. */
  function crewAt(x, y) {
    var list = S.S.avatars || [];
    var best = null, bd = 1.1;
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      /* avatars 채널의 원본에는 bot 표가 없을 때가 있다 — companions 뷰로 한 번 더 잰다 */
      if (!a || !(a.bot || S.companionById(a.id))) continue;
      var p = (GM.world && GM.world.matePos) ? (GM.world.matePos(a.id) || a) : a;
      var dd = Math.hypot((p.x || 0) - x, (p.y || 0) - y);
      if (dd <= bd) { bd = dd; best = a; }
    }
    return best;
  }

  /* ★ §12-1 — 클릭 판정도 풋프린트 사각형 기준. 4×4 본부는 어느 귀퉁이를 눌러도 잡힌다.
     ★ Sprint 1 — 여기는 이제 **정확 판정만** 한다. 옛 「한 칸 여유」는 nearMissAt 으로 옮겼다:
       여유 판정이 사슬 중간에 있으면 건물이 사실상 ±1.5칸을 먹어, 곁에 선 주민·울타리를
       상시 가로챘다. 여유는 아무것도 안 잡혔을 때의 관용이지 우선권이 아니다. */
  function structureAt(x, y) {
    var list = S.structures();
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.x == null) continue;
      if (S.cellIn(S.rectOfThing(b), x, y)) return b;
    }
    return null;
  }
  function siteAt(x, y) {
    var list = S.sites();
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.x == null) continue;
      if (S.cellIn(S.rectOfThing(c), x, y)) return c;
    }
    return null;
  }
  /** 한 칸 여유의 관용 판정 — 건물·공사장을 한데 모아 [틈새 → 중심 거리] 순으로 가장 가까운 것 하나.
      (옛 코드는 배열 첫 매치가 이겨, 겹치면 아무 건물이나 열렸다) */
  function nearMissAt(x, y) {
    var best = null, bg = 2, bd = 1e9;
    function consider(list, kind) {
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (o.x == null) continue;
        var gap = S.rectGap(S.rectOfThing(o), { x0: x, y0: y, x1: x, y1: y });
        if (gap > 1) continue;
        var c = S.centerOfThing(o);
        var d = Math.hypot(c.x - x, c.y - y);
        if (gap < bg || (gap === bg && d < bd)) { bg = gap; bd = d; best = { kind: kind, obj: o }; }
      }
    }
    consider(S.structures(), 'structure');
    consider(S.sites(), 'site');
    return best;
  }
  /** 점-선분 거리 */
  function segDist(px, py, x1, y1, x2, y2) {
    var vx = x2 - x1, vy = y2 - y1;
    var l2 = vx * vx + vy * vy;
    var t = l2 ? Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / l2)) : 0;
    return Math.hypot(px - (x1 + vx * t), py - (y1 + vy * t));
  }
  /* ★ Sprint 1 — 울타리는 **선분**이다. 옛 판정은 중점 ±0.75 칸 상자라 조각의 양 끝이 비고,
     forEach 마지막 매치가 이겨 곁의 딴 조각이 열렸다. 이제 월드 좌표의 점-선분 거리로
     가장 가까운 조각을 고른다 — 보이는 그 울타리가 눌린다. */
  function fenceAt(wx, wy) {
    var best = null, bd = 0.55;
    S.fences().forEach(function (f) {
      var d = segDist(wx, wy, f.x1, f.y1, f.x2, f.y2);
      if (d < bd) { bd = d; best = f; }
    });
    return best;
  }

  /* ★ Sprint 5 — 야영지 판정. 그려지는 스프라이트가 두 칸짜리라 중심에서 1.2칸까지 잡는다.
     여러 개가 겹치면 가장 가까운 하나(울타리·주민과 같은 규칙). */
  function campAt(wx, wy) {
    var list = S.camps();
    var best = null, bd = 1.2;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || c.x == null) continue;
      var d = Math.hypot(c.x - wx, c.y - wy);
      if (d <= bd) { bd = d; best = c; }
    }
    return best;
  }

  /* ══════════ 자판 ══════════ */
  function typing(e) {
    var t = e.target;
    return !!(t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName));
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (S.S.placing) { S.setPlacing(null); GM.build.close(); return; }
      if (U.anyModalOpen()) { U.closeTopModal(); return; }
      /* 고른 것이 있으면 먼저 물린다 — 그다음 Esc 가 설정을 연다(§14-2) */
      var sel = S.S.selection || {};
      var hadSelection = !!(sel.residents && sel.residents.length) || !!sel.nodeId
        || !!sel.structureId || !!sel.siteId || !!sel.fenceId;
      U.coachClear();
      S.clearSelection();
      GM.hud.hideContext();
      if (!hadSelection && GM.app.inGame()) GM.settings.open();
      return;
    }
    if (typing(e)) return;
    if (!GM.app.inGame()) return;
    if (U.anyModalOpen()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key.toLowerCase();
    /* ★ GDD3 §15-C — 손이 닿았다. 걷거나 휘두르려 한 순간 자동이 잠시 물러난다
       (끄는 것이 아니라 비켜 주는 것이다 — 30초 뒤 스스로 다시 잡는다). */
    if (k === 'w' || k === 's' || k === 'a' || k === 'd' || k === 'e') GM.autoplay.touched();
    switch (k) {
      case 'w': keys.up = 1; break;
      case 's': keys.down = 1; break;
      case 'a': keys.left = 1; break;
      case 'd': keys.right = 1; break;
      case 'arrowup': keys.camUp = 1; e.preventDefault(); break;
      case 'arrowdown': keys.camDown = 1; e.preventDefault(); break;
      case 'arrowleft': keys.camLeft = 1; e.preventDefault(); break;
      case 'arrowright': keys.camRight = 1; e.preventDefault(); break;
      case 'e':
        if (!eHeld) { eHeld = true; startInteract(); }
        e.preventDefault();
        break;
      /* ★ §19-F1(F08-4) — Q 는 「키우기」다. 검을 든 손(E)과 나란히 선 다른 손짓이라 자리를 따로 준다:
         같은 짐승 앞에서 잡을지 데려올지를 유저가 고른다. 판정은 전부 서버가 다시 한다. */
      case 'q': startTame(); break;
      case 'b': GM.build.open(); break;
      case 'f': GM.build.openFence(); break;
      case 'p': GM.residents.openPanel(); break;
      case 'k': GM.skills.open(); break;
      /* ★ GDD3 §13-C-3 — 도감 */
      case 'j': GM.codex.open(); break;
      /* ★ GDD3 §13-D-3 — 캐릭터 창. C 는 이제 '나'다(방어는 V 로 옮겼다). */
      case 'c': GM.equip.open(); break;
      case 'v': GM.combat.openThreat(); break;
      case 'l': GM.chronicle.open(); break;
      case 'h': centerTown(); break;
      case 'm': GM.social.toggle(); break;
      case ' ': centerLord(); e.preventDefault(); break;
      case 'enter': GM.social.focusInput(); e.preventDefault(); break;
      case '+': case '=': GM.camera.zoomBy(1); break;
      case '-': GM.camera.zoomBy(-1); break;
      default: break;
    }
  }

  /** ★ §17-16 · §18-D2 — E 한 손잡이. 도읍 앞이면 찾아가고, 흔적 곁이면 살피고, 아니면 휘두른다.
      (문 앞이나 발자국 위에서 허공을 도끼질하지 않게 — 화면의 말머리 상자도 같은 순서로 고른다.
       흔적을 도읍보다 뒤에 두는 까닭: 도읍 앞은 오직 한 자리뿐이고, 흔적은 어디에나 있다.) */
  function startInteract() {
    /* ★ §19-F4(F09-2) — 기차가 먼저다. 승강장 앞은 오직 그 한 자리뿐이고(도읍 앞과 같은 이유),
       타고 있는 동안에는 E 가 「내린다」가 된다 — 같은 손잡이로 타고 내린다. */
    if (trainInteract()) return;
    var tw = GM.diplomacy && GM.diplomacy.nearTown();
    if (tw) { GM.diplomacy.visit(tw); return; }
    var tr = GM.trails && GM.trails.near();
    if (tr) { GM.trails.investigate(tr); return; }
    var hw = handWorkTarget();
    if (hw) { GM.structure.runHandWork(hw); return; }
    GM.swing.startHold();
  }

  /** 기차를 타거나 내린다 — 집을 것이 없으면 false 라 다음 손잡이로 넘어간다 */
  function trainInteract() {
    if (!GM.world || !GM.world.nearestTrain) return false;
    if (S.riding()) { GM.net.send('leaveTrain', {}, onTrain); return true; }
    var me = GM.avatar && GM.avatar.pos();
    var info = S.trainInfo();
    if (!me || !info || !info.open) return false;
    var t = GM.world.nearestTrain(me.x, me.y, info.boardRadius || 3);
    if (!t || !(t.dwell > 0)) return false;
    GM.net.send('boardTrain', { trainId: t.id }, onTrain);
    return true;
  }

  function onTrain(r) {
    if (!r || !r.ok) { U.toast((r && r.error && r.error.message) || '기차를 탈 수 없습니다.', 'warn'); return; }
    if (r.trains) S.set({ trainList: r.trains });
    GM.sfx.play('build');
  }

  /** ★ §19-F1(F08-4) — 곁의 온순한 짐승을 목장으로 데려온다(사냥과 병존) */
  function startTame() {
    var t = tameTarget();
    if (!t) { U.toast('곁에 기를 짐승이 없습니다.', 'warn'); return; }
    GM.net.send('tameCreature', { targetId: t.c.id }, onTamed);
  }

  function onTamed(r) {
    if (!r || !r.ok) { U.toast((r && r.error && r.error.message) || '기를 수 없습니다.', 'bad'); return; }
    GM.sfx.play('build');
    U.toast(r.speciesName + '을(를) 목장으로 데려왔습니다 (' + r.heads + '/' + r.capacity + ').', 'good');
  }

  /** 데려올 짐승 하나 — 사냥 사거리와 같은 잣대로 고른다(서버가 다시 잰다) */
  function tameTarget() {
    if (!GM.world || !GM.world.nearestWild) return null;
    var me = GM.avatar && GM.avatar.pos();
    if (!me) return null;
    var w = GM.world.nearestWild(me.x, me.y, (S.combatCfg().huntRangeTiles) || 2.8);
    if (!w || !w.c || w.c.tamed || w.c.kind !== 'animal') return null;
    return w;
  }

  /** ★ §19-D(F03-6) — 건물 위에서 E 면 그 건물의 대표 행동(손수 제련한다 · 톱질을 거든다 …)을 곧바로.
      「왜」 휘두를 것이 있으면 비켜 주나 — 제련소 곁의 나무를 베려던 손을 건물이 가로채면
      「E 가 엉뚱한 일을 한다」가 된다. 손에 잡히는 것이 없을 때만 건물 차례다. */
  function handWorkTarget() {
    if (!GM.structure || !GM.structure.handWorkNear) return null;
    if (GM.swing && GM.swing.target()) return null;
    return GM.structure.handWorkNear();
  }

  function onKeyUp(e) {
    var k = (e.key || '').toLowerCase();
    if (k === 'w') keys.up = 0;
    if (k === 's') keys.down = 0;
    if (k === 'a') keys.left = 0;
    if (k === 'd') keys.right = 0;
    if (k === 'e') { eHeld = false; if (GM.swing) GM.swing.stopHold(); }
    if (k === 'arrowup') keys.camUp = 0;
    if (k === 'arrowdown') keys.camDown = 0;
    if (k === 'arrowleft') keys.camLeft = 0;
    if (k === 'arrowright') keys.camRight = 0;
  }

  function centerTown() {
    var t = S.myTown();
    if (t) { GM.camera.moveTo(t.x, t.y); manualPanAt = Date.now(); followUntil = 0; }
  }
  function centerLord() {
    var p = GM.avatar.pos();
    if (p) { GM.camera.moveTo(p.x, p.y); followUntil = Date.now() + 8000; }
  }
  /** ★ §19-D(F03-5) — 밖에서 눈을 옮긴다(명부의 얼굴 누르기).
      따라가기를 함께 풀지 않으면 걷는 몸이 카메라를 곧바로 제자리로 끌어당긴다. */
  function focusAt(x, y) {
    if (x == null || y == null) return;
    GM.camera.moveTo(x, y);
    manualPanAt = Date.now();
    followUntil = 0;
  }

  /* ══════════ 매 프레임 ══════════ */
  function step(dt) {
    var speed = 26 * dt / (GM.camera.cam.tile / 24);
    var dx = 0, dy = 0;
    if (keys.camLeft) dx -= 1;
    if (keys.camRight) dx += 1;
    if (keys.camUp) dy -= 1;
    if (keys.camDown) dy += 1;
    var fresh = Date.now() - lastPointerAt < 1200;
    var covered = (U.anyModalOpen && U.anyModalOpen()) ||
                  !!(U.qs('#coach-root') && U.qs('#coach-root').children.length);
    if (pointerIn && fresh && !covered && !drag) {
      /* ★ §16-11 — 가장자리 이동 띠를 26 → 56px 로 넓혔다(피드백: "반경을 조금 넓혀줘").
         띠가 넓은 만큼 안쪽 경사는 완만하다 — 끝에 바짝 대면 그때 최고 속도가 난다. */
      var m = 56;
      var sz = GM.world.size();
      if (px < m) dx -= (m - px) / m;
      if (px > sz.w - m) dx += (px - (sz.w - m)) / m;
      if (py < m) dy -= (m - py) / m;
      if (py > sz.h - m) dy += (py - (sz.h - m)) / m;
    }
    if (dx || dy) {
      GM.camera.pan(dx * speed, dy * speed);
      manualPanAt = Date.now();
      followUntil = 0;
    }
    var lord = GM.avatar.pos();
    if (lord) {
      var moving = keys.up || keys.down || keys.left || keys.right;
      if (moving) followUntil = Date.now() + 5000;
      /* ★ Sprint 1 — 우클릭 이동 중에는 몸이 **화면 밖으로 나가려 할 때만** 따라간다.
         목적지를 보고 있는 눈을 카메라가 빼앗지 않는다. */
      if (GM.avatar.destPos() && !lordInView(lord)) followUntil = Date.now() + 1200;
      if (Date.now() < followUntil && Date.now() - manualPanAt > 900) GM.camera.moveTo(lord.x, lord.y);
    }
  }

  /** 몸이 화면 안(가장자리 2칸 여유)에 있는가 */
  function lordInView(p) {
    var v = GM.camera.visible();
    return p.x >= v.x0 + 2 && p.x <= v.x1 - 2 && p.y >= v.y0 + 2 && p.y <= v.y1 - 2;
  }

  GM.input = { init: init, keys: keys, step: step, centerTown: centerTown, centerLord: centerLord,
    /* ★ §19-D — 명부·패널이 눈을 옮길 때 쓰는 문 */
    focusAt: focusAt,
    /* ★ §17-19 — 회귀 전용 문. 그려진 사각형과 클릭 판정이 정말 한 자로 재는지 밖에서 확인한다. */
    structureAtSprite: structureAtSprite };
})(window);
