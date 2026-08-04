/* avatar.js — 개척자 아바타. 위치는 클라가 관리하고, 행동 판정은 전부 서버가 한다.
   WASD/방향키 · **우클릭 지면** 이동(좌클릭은 선택 전용 — GDD3 §12-5). 노동은 GM.swing 이 맡는다(스윙 체계, GDD3 §3).
   ★ 걸을 때마다 둘레를 곧바로 밝힌다 — 검은 땅으로 들어가도 늘 주변이 보인다 (GDD3 §8). */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var me = { x: 64, y: 64, dir: 0, frame: 0, ft: 0 };
  var dest = null;
  var lastReport = 0, lastX = -1, lastY = -1;
  var lastRevealX = -999, lastRevealY = -999;
  var placed = false;
  var frozen = false;             // 오프닝 동안에는 조작을 잠근다
  var hidden = false;             // ★ §12-7 — 마차가 굴러오는 동안에는 그리지 않는다

  /**
   * ★ GDD3 §12-7 — 시작 자리는 **한 곳**이다.
   *   오프닝에서 마차가 사람을 내려놓는 자리도, 오프닝을 건너뛰었을 때 서 있는 자리도,
   *   컷신이 끝나고 돌아오는 자리도 전부 이 식이 낸다. 세 곳이 달라서 "내렸는데 딴 데 있다"가 났었다.
   *   본부가 4×4 라 그 사각형 바깥(오른쪽 아래 모서리 옆)에 선다.
   */
  function startPos(town) {
    var t = town || S.myTown();
    if (!t) return null;
    return { x: t.x + 3, y: t.y + 2 };
  }

  function init() {
    S.on('world', function () { placed = false; snapToTown(); });
  }

  function snapToTown() {
    var t = S.myTown();
    if (t && !placed) {
      var s = startPos(t);
      me.x = s.x; me.y = s.y;
      placed = true;
      reveal(true);
      report(true);
    }
  }

  function pos() { return S.S.map ? me : null; }
  function destPos() { return dest; }
  function freeze(v) { frozen = !!v; if (v) dest = null; }
  function isFrozen() { return frozen; }
  function setHidden(v) { hidden = !!v; }
  function isHidden() { return hidden; }

  function walkable(x, y) {
    var code = S.terrainKey(Math.round(x), Math.round(y));
    if (!code) return false;
    var w = S.worldCfg();
    var list = (w && w.terrain && w.terrain.walkable) || ['grass', 'forest', 'rock', 'fertile'];
    return list.indexOf(code) >= 0;
  }

  function speed() {
    /* 정착지가 커지면 몸도 가벼워진다 (GDD3 §3) */
    var p = S.player();
    var bonus = (p && p.tierSpeedBonus) || 0;
    return 4.6 * (1 + bonus * 0.6);
  }

  function step(dt) {
    if (!S.S.map) return;
    if (!placed) snapToTown();
    if (frozen) return;
    if (S.downed()) { me.frame = 0; return; }
    var sp = speed() * dt;
    var dx = 0, dy = 0;
    var k = GM.input ? GM.input.keys : {};
    if (k.up) dy -= 1;
    if (k.down) dy += 1;
    if (k.left) dx -= 1;
    if (k.right) dx += 1;
    if (dx || dy) dest = null;
    if (!dx && !dy && dest) {
      var ddx = dest.x - me.x, ddy = dest.y - me.y;
      var d = Math.hypot(ddx, ddy);
      if (d < 0.12) { dest = null; }
      else { dx = ddx / d; dy = ddy / d; }
    }
    var moving = false;
    if (dx || dy) {
      var len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      var nx = me.x + dx * sp, ny = me.y + dy * sp;
      if (walkable(nx, ny)) { me.x = nx; me.y = ny; moving = true; }
      else if (walkable(nx, me.y)) { me.x = nx; moving = true; }
      else if (walkable(me.x, ny)) { me.y = ny; moving = true; }
      else dest = null;
      me.x = U.clamp(me.x, 0, S.mapSize() - 1);
      me.y = U.clamp(me.y, 0, S.mapSize() - 1);
      me.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 1) : (dy > 0 ? 0 : 3);
      me.ft += dt;
      if (me.ft > 0.17) { me.ft = 0; me.frame = me.frame ? 0 : 1; }
    } else if (!GM.swing || !GM.swing.busy()) {
      me.frame = 0;
    }
    if (moving) reveal(false);
    report(false);
  }

  /** ★ 안개 즉시 공개 — 서버가 하루에 한 번만 다시 계산하므로 클라가 앞질러 밝힌다 */
  function reveal(force) {
    if (!S.S.map) return;
    var rx = Math.round(me.x), ry = Math.round(me.y);
    if (!force && Math.abs(rx - lastRevealX) < 1 && Math.abs(ry - lastRevealY) < 1) return;
    lastRevealX = rx; lastRevealY = ry;
    S.revealAround(rx, ry, S.visionRadius());
  }

  /** 저빈도 위치 보고 — 걸음마다 보내지 않는다 */
  function report(force) {
    var now = Date.now();
    var rx = Math.round(me.x), ry = Math.round(me.y);
    if (!force && (now - lastReport < 900 || (rx === lastX && ry === lastY))) return;
    lastReport = now; lastX = rx; lastY = ry;
    /* ★ GDD3 §13-B-4·5 — 발걸음이 여는 것 둘. 서버가 ack 로 알려 준다:
       ① 은닉 유적을 찾았다 ② 사나운 땅(링2)에 처음 발을 들였다.
       링 판정은 **서버가** 한다 — 영토가 자라면 안전한 땅도 함께 자라므로 화면이 제 셈으로 하면 어긋난다. */
    GM.net.send('lordMove', { x: rx, y: ry }, function (res) {
      if (!res || !res.ok) return;
      if (res.ringEntered && GM.fx) {
        U.toast(res.ringText || '여기서부터는 사나운 것들의 땅입니다.', 'bad', 5200);
        GM.fx.dangerEdge(1.6);
        if (GM.sfx) GM.sfx.play('deny');
      }
      if (res.revealedNodes && res.revealedNodes.length) {
        U.toast('숨어 있던 옛 자취를 찾았습니다.', 'good', 4200);
        if (GM.sfx) GM.sfx.play('open');
      }
    });
  }

  function moveTo(x, y) { if (!frozen) dest = { x: x, y: y }; }
  function faceTo(x, y) {
    var dx = x - me.x, dy = y - me.y;
    me.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 1) : (dy > 0 ? 0 : 3);
  }
  function setPos(x, y) {
    me.x = x; me.y = y; placed = true;
    if (GM.swing) GM.swing.invalidate();
    reveal(true); report(true);
  }
  function distTo(x, y) { return Math.hypot(me.x - x, me.y - y); }

  GM.avatar = {
    init: init, step: step, pos: pos, moveTo: moveTo, faceTo: faceTo, setPos: setPos,
    distTo: distTo, freeze: freeze, isFrozen: isFrozen, reveal: reveal,
    destPos: destPos, stop: function () { dest = null; },
    setHidden: setHidden, isHidden: isHidden, startPos: startPos,
    report: function () { report(true); },
    interact: function () { if (GM.swing) GM.swing.once(); }
  };
})(window);
