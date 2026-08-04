/* autoplay.js — ★ GDD3 §15-C 자동 플레이.
   켜면 **동료의 두뇌가 내 아바타를 몬다**: 무엇이 모자란지 보고 그리로 걸어가 캐고, 공사장을 돕고,
   덤비는 것과 싸운다. 판단은 전부 서버가 한다(서버 권위) — 이 파일이 하는 일은 셋뿐이다.
     ① 켜고 끄는 청을 보낸다        ② 손이 닿은 순간을 알린다(잠시 물러남)   ③ 「자동」 배지를 그린다.
   ★ 끄는 것과 물러나는 것은 다르다: 걸으려 하거나 휘두르려 한 순간에는 **끄지 않고 30초만 비켜 준다.**
     그래서 잠깐 손을 대려고 토글을 다시 찾을 일이 없다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var badge = null;
  var lastTouch = 0;
  var lastPaint = '';

  function init() {
    badge = U.qs('#badge-auto');
    S.on('state', paint);
    S.on('reset', paint);
    paint();
    setInterval(paint, 1000);       // 남은 초를 세는 것은 화면의 몫이다
  }

  function isOn() { return S.autoPlay().on; }
  function isActive() { return S.autoPlay().active; }

  /** 켜고 끄기 — 설정 패널의 토글이 부른다 */
  function set(on) {
    var want = !!on;
    S.setAutoPlayLocal(want);
    paint();
    GM.net.send('setAutoPlay', { enabled: want });
    U.toast(want
      ? '자동을 켰습니다. 움직이거나 휘두르면 잠시 손을 뗍니다.'
      : '자동을 껐습니다.', want ? 'good' : null, 2600);
    return want;
  }

  function toggle() { return set(!isOn()); }

  /**
   * 손이 닿았다 — 걷기·스윙·목적지 찍기가 부른다.
   * 청은 **1초에 한 번만** 보낸다: 키를 누르고 있는 동안 초당 수십 번이 나가면 안 된다.
   */
  function touched() {
    if (!isOn()) return;
    var now = Date.now();
    S.suspendAutoPlayLocal();
    paint();
    if (now - lastTouch < 1000) return;
    lastTouch = now;
    GM.net.send('setAutoPlay', { suspend: true });
  }

  /** ★ 배지 — 지금 자동이 도는가, 아니면 몇 초 뒤에 다시 잡는가 */
  function paint() {
    if (!badge) badge = U.qs('#badge-auto');
    if (!badge) return;
    var a = S.autoPlay();
    if (!a.on || !GM.app.inGame()) {
      if (!badge.hidden) badge.hidden = true;
      lastPaint = '';
      return;
    }
    var text = a.active ? '자동' : ('자동 ' + a.suspendedFor + '초 뒤');
    badge.hidden = false;
    badge.classList.toggle('is-paused', !a.active);
    badge.title = a.active
      ? '동료의 판단으로 스스로 움직이는 중입니다. 움직이거나 휘두르면 잠시 멈춥니다.'
      : '손이 닿아 잠시 멈췄습니다. ' + a.suspendedFor + '초 뒤에 다시 스스로 움직입니다.';
    if (text !== lastPaint) { badge.textContent = text; lastPaint = text; }
  }

  GM.autoplay = { init: init, set: set, toggle: toggle, touched: touched, paint: paint, isOn: isOn, isActive: isActive };
})(window);
