/* settings.js — 설정 패널 (Esc 또는 톱니). ★ GDD3 §14-2.
   피드백: "화면이 어둡다 / 소리를 조절하고 싶다". 두 눈금과 그것을 기억하는 자리.
   값은 localStorage 에만 산다 — 서버는 밝기도 음량도 모른다(보기의 문제이지 규칙의 문제가 아니다). */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var openBack = null;

  /** 눈금 한 줄 — 값이 바뀌는 순간 곧바로 화면에 먹는다(미리보기가 곧 결과다) */
  function slider(o) {
    var row = U.el('div', 'set-row');
    var head = U.el('div', 'set-head');
    head.appendChild(U.el('b', null, o.label));
    var val = U.el('span', 'set-val', o.format(o.value));
    head.appendChild(val);
    row.appendChild(head);

    var input = U.el('input', 'set-slider');
    input.type = 'range';
    input.min = String(o.min);
    input.max = String(o.max);
    input.step = String(o.step);
    input.value = String(o.value);
    input.id = o.id;
    input.setAttribute('aria-label', o.label);
    var apply = function () {
      var v = parseFloat(input.value);
      if (!isFinite(v)) return;
      val.textContent = o.format(o.onChange(v));
    };
    input.oninput = apply;
    input.onchange = apply;
    row.appendChild(input);
    if (o.hint) row.appendChild(U.el('p', 'hint', o.hint));
    return row;
  }

  function pct(v) { return Math.round(v * 100) + '%'; }

  function buildBody() {
    var body = U.el('div', 'setwrap');
    var bc = S.brightnessCfg();

    body.appendChild(slider({
      id: 'set-brightness', label: '화면 밝기',
      min: bc.min, max: bc.max, step: bc.step, value: S.getBrightness(),
      format: pct,
      hint: '밤과 안개가 덮는 어둠을 걷고 빛을 더합니다. 지금 화면에 곧바로 먹습니다.',
      onChange: function (v) { return S.setBrightness(v); }
    }));

    body.appendChild(slider({
      id: 'set-volume', label: '소리 크기',
      min: 0, max: 1, step: 0.05, value: GM.sfx.getVolume(),
      format: pct,
      hint: '0 으로 내리면 소리가 꺼집니다.',
      onChange: function (v) {
        var out = GM.sfx.setVolume(v);
        GM.hud.paintSound();
        if (out > 0) GM.sfx.play('tap');
        return out;
      }
    }));

    var foot = U.el('div', 'set-foot');
    foot.appendChild(U.btn('기본값으로', 'btn-sm btn-ghost', function () {
      S.setBrightness(bc.default);
      GM.sfx.setVolume(GM.sfx.defaultVolume());
      GM.hud.paintSound();
      refresh();
      U.toast('기본값으로 되돌렸습니다.', 'good', 1800);
    }));
    body.appendChild(foot);

    body.appendChild(U.el('p', 'hint', '고른 값은 이 기기에 남아 다음에도 그대로 열립니다.'));
    return body;
  }

  function refresh() {
    if (!openBack || !openBack.__body) return;
    openBack.__body.innerHTML = '';
    openBack.__body.appendChild(buildBody());
  }

  function open() {
    if (openBack) { U.closeTopModal(); return null; }
    openBack = U.openModal({
      title: '설정', width: '460px', key: 'settings',
      icon: GM.icons.img('gear', 22),
      body: buildBody(),
      footer: U.btn('닫는다', 'btn-primary', function () { U.closeTopModal(); }),
      onClose: function () { openBack = null; }
    });
    GM.sfx.play('page');
    return openBack;
  }

  function isOpen() { return !!openBack; }

  GM.settings = { open: open, isOpen: isOpen, refresh: refresh };
})(window);
