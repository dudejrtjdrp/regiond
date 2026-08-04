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

  /** 켬·끔 한 줄 — ★ GDD3 §15-C 자동 플레이 */
  function toggleRow(o) {
    var row = U.el('div', 'set-row');
    var head = U.el('div', 'set-head');
    head.appendChild(U.el('b', null, o.label));
    var sw = U.el('label', 'switch');
    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!o.value;
    chk.id = o.id;
    chk.setAttribute('aria-label', o.label);
    var word = U.el('span', null, o.value ? '켬' : '끔');
    chk.onchange = function () {
      word.textContent = chk.checked ? '켬' : '끔';
      o.onChange(chk.checked);
    };
    sw.appendChild(chk); sw.appendChild(U.el('span', 'sw-box')); sw.appendChild(word);
    head.appendChild(sw);
    row.appendChild(head);
    if (o.hint) row.appendChild(U.el('p', 'hint', o.hint));
    return row;
  }

  function buildBody() {
    var body = U.el('div', 'setwrap');
    var bc = S.brightnessCfg();

    /* ★ GDD3 §15-C — 자동 플레이. 동료가 나를 대신해 판단하고 움직인다.
       끄고 켜는 것은 이 한 줄뿐이고, 잠깐 손을 대는 것은 그냥 움직이면 된다(30초 물러난다). */
    body.appendChild(toggleRow({
      id: 'set-autoplay', label: '자동으로 움직이기',
      value: S.autoPlay().on,
      hint: '켜면 동료와 같은 판단으로 내 사람이 스스로 캐고, 짓고, 싸웁니다. '
        + '직접 움직이거나 휘두르면 ' + S.autoPlay().suspendSeconds + '초 동안 손을 뗐다가 다시 이어 갑니다.',
      onChange: function (v) { GM.autoplay.set(v); }
    }));

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
