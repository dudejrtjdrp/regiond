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

    /* ★ 울타리(선분)와 철로(칸)는 같은 끌기를 쓴다 — 모으는 점의 뜻만 다르다 */
    if (pl && (pl.kind === 'fence' || pl.kind === 'rail')) {
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
    if (drag.mode === 'fence' || drag.mode === 'rail') {
      var path = GM.world.getFencePath() || [];
      var last = path[path.length - 1];
      if (!last || last.x !== t.x || last.y !== t.y) {
        var cfg = drag.mode === 'rail' ? (S.railCfg() || { maxPointsPerRequest: 64 }) : S.fenceCfg();
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

    if (d.moved) {
      var w0 = GM.camera.screenToWorld(d.sx, d.sy);
      var w1 = GM.camera.screenToWorld(d.x, d.y);
      GM.residents.selectBox(w0.x, w0.y, w1.x, w1.y, d.additive);
      return;
    }

    /* ★ GDD3 §12-5 — 좌클릭은 **선택·상호작용 전용**이다. 절대 걷지 않는다.
       (옛 규칙에서는 빈 땅 좌클릭이 곧 이동이라, 무언가 고르려다 자꾸 걸어갔다.) */
    var w = GM.camera.screenToWorld(d.x, d.y);
    if (GM.residents.selectAt(w.x, w.y, d.additive)) return;

    var b = structureAt(t.x, t.y);
    if (b) { GM.structure.open(b.id); GM.sfx.play('tap'); return; }

    var site = siteAt(t.x, t.y);
    if (site) { GM.structure.openSite(site.id); GM.sfx.play('tap'); return; }

    var n = S.nodeAt(t.x, t.y);
    if (n && S.fogAt(t.x, t.y) >= 1) { GM.structure.openNode(n.id); GM.sfx.play('tap'); return; }

    var f = fenceAt(t.x, t.y);
    if (f) { GM.structure.openFence(f.id); GM.sfx.play('tap'); return; }

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
    GM.avatar.moveTo(t.x, t.y);
    GM.world.ping(t.x, t.y, '#8dfa8d');
    GM.sfx.play('tap');
    followUntil = Date.now() + 6000;
  }

  function onWheel(e) {
    e.preventDefault();
    var l = localXY(e);
    GM.camera.zoomBy(e.deltaY > 0 ? -1 : 1, l);
    manualPanAt = Date.now();
  }

  /* ★ §12-1 — 클릭 판정도 풋프린트 사각형 기준. 4×4 본부는 어느 귀퉁이를 눌러도 잡힌다.
     사각형 안이면 무조건, 아니면 한 칸 여유(옛 감각)까지 받아 준다. */
  function structureAt(x, y) {
    var list = S.structures();
    var near = null;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.x == null) continue;
      var r = S.rectOfThing(b);
      if (S.cellIn(r, x, y)) return b;
      if (!near && S.rectGap(r, { x0: x, y0: y, x1: x, y1: y }) <= 1) near = b;
    }
    return near;
  }
  function siteAt(x, y) {
    var list = S.sites();
    var near = null;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.x == null) continue;
      var r = S.rectOfThing(c);
      if (S.cellIn(r, x, y)) return c;
      if (!near && S.rectGap(r, { x0: x, y0: y, x1: x, y1: y }) <= 1) near = c;
    }
    return near;
  }
  function fenceAt(x, y) {
    var out = null;
    S.fences().forEach(function (f) {
      var mx = (f.x1 + f.x2) / 2, my = (f.y1 + f.y2) / 2;
      if (Math.abs(mx - x) <= 0.75 && Math.abs(my - y) <= 0.75) out = f;
    });
    return out;
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
      U.coachClear();
      S.clearSelection();
      GM.hud.hideContext();
      return;
    }
    if (typing(e)) return;
    if (!GM.app.inGame()) return;
    if (U.anyModalOpen()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key.toLowerCase();
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
        if (!eHeld) { eHeld = true; GM.swing.startHold(); }
        e.preventDefault();
        break;
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
      var m = 26;
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
      if (Date.now() < followUntil && Date.now() - manualPanAt > 900) GM.camera.moveTo(lord.x, lord.y);
    }
  }

  GM.input = { init: init, keys: keys, step: step, centerTown: centerTown, centerLord: centerLord };
})(window);
