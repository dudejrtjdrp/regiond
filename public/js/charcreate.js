/* charcreate.js — 캐릭터 생성기. 피부 6 · 머리 8 · 머리색 10 · 의상 6 · 의상색 10 을
   레이어 팔레트 스왑으로 합성해 실시간 미리보기로 보여 준다. 에셋 파일은 하나도 쓰지 않는다.
   같은 위젯을 건국 화면과 게임 안 [모습 고치기]가 함께 쓴다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var STYLE_KO = {
    short: '단발', bob: '뭉치', long: '긴 머리', ponytail: '묶은 머리',
    braid: '땋은 머리', topknot: '상투', curly: '곱슬', bald: '민머리',
    tunic: '무명옷', robe: '도포', coat: '겉옷', armor: '갑옷', hanbok: '한복', cloak: '망토'
  };

  /** host 에 생성기를 붙인다 → {get, set, destroy} */
  function mount(host, initial, onChange) {
    var cfg = S.appearanceCfg();
    var app = {};
    var base = initial || S.defaultAppearance();
    for (var k in cfg.fields) if (Object.prototype.hasOwnProperty.call(cfg.fields, k)) {
      app[k] = U.clamp(base[k] == null ? cfg.default[k] : base[k], 0, cfg.fields[k].count - 1) | 0;
    }

    U.clear(host);
    var wrap = U.el('div', 'cc-wrap');

    /* 미리보기 */
    var stage = U.el('div', 'cc-stage');
    var cv = document.createElement('canvas');
    cv.id = 'cc-preview';
    cv.width = 128; cv.height = 160;
    cv.style.width = '128px';
    cv.style.height = '160px';
    stage.appendChild(cv);
    var dice = U.btn('🎲 마음대로', 'btn-sm', function () {
      var r = S.randomAppearance();
      for (var kk in r) if (Object.prototype.hasOwnProperty.call(r, kk)) app[kk] = r[kk];
      paintRows();
      fire();
      GM.sfx.play('gain');
    });
    dice.id = 'cc-random';
    U.tipSet(dice, '주사위를 굴려 모습을 새로 고릅니다', '마음에 들 때까지 몇 번이고 굴려도 됩니다.');
    stage.appendChild(dice);
    wrap.appendChild(stage);

    /* 항목 */
    var rows = U.el('div', 'cc-rows');
    wrap.appendChild(rows);
    host.appendChild(wrap);

    var raf = null, t0 = 0;
    function paintPreview(t) {
      t0 = t || 0;
      var ctx = cv.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, 128, 160);
        ctx.fillStyle = '#2b2440';
        ctx.fillRect(0, 0, 128, 160);
        for (var i = 0; i < 24; i++) {
          ctx.fillStyle = i % 3 ? '#3a3358' : '#4a4270';
          ctx.fillRect((i * 37) % 128, (i * 53) % 140, 2, 2);
        }
        ctx.fillStyle = '#3f5a32';
        ctx.fillRect(0, 132, 128, 28);
        var frame = Math.floor(t0 / 380) % 2;
        var dir = 0;
        try { ctx.drawImage(GM.atlas.avatar(app, dir, frame), 16, 8, 96, 120); } catch (e) {}
      }
      raf = requestAnimationFrame(paintPreview);
    }
    raf = requestAnimationFrame(paintPreview);

    function fire() { if (onChange) onChange(get()); }

    function paintRows() {
      U.clear(rows);
      Object.keys(cfg.fields).forEach(function (field) {
        var spec = cfg.fields[field];
        var row = U.el('div', 'cc-row');
        row.setAttribute('data-field', field);
        var lab = U.el('span', 'cc-label', spec.name);
        row.appendChild(lab);

        var minus = U.btn('◀', 'btn-sm', function () { shift(field, -1); });
        minus.setAttribute('data-dir', 'prev');
        row.appendChild(minus);

        var opts = U.el('div', 'cc-opts');
        for (var i = 0; i < spec.count; i++) (function (idx) {
          var b = U.el('button', 'cc-opt' + (app[field] === idx ? ' on' : ''));
          b.type = 'button';
          b.setAttribute('data-idx', String(idx));
          if (spec.palette && spec.palette[idx]) {
            b.style.background = spec.palette[idx];
            b.title = spec.name + ' ' + (idx + 1);
          } else {
            var st = (spec.styles && spec.styles[idx]) || String(idx + 1);
            b.textContent = STYLE_KO[st] || st;
          }
          b.onclick = function () { app[field] = idx; paintRows(); fire(); GM.sfx.play('tap'); };
          opts.appendChild(b);
        })(i);
        row.appendChild(opts);

        var plus = U.btn('▶', 'btn-sm', function () { shift(field, 1); });
        plus.setAttribute('data-dir', 'next');
        row.appendChild(plus);
        rows.appendChild(row);
      });
    }

    function shift(field, d) {
      var n = cfg.fields[field].count;
      app[field] = ((app[field] + d) % n + n) % n;
      paintRows();
      fire();
      GM.sfx.play('tap');
    }

    function get() {
      return { skin: app.skin | 0, hair: app.hair | 0, hairColor: app.hairColor | 0,
               outfit: app.outfit | 0, outfitColor: app.outfitColor | 0 };
    }
    function set(next) {
      for (var kk in next) if (Object.prototype.hasOwnProperty.call(app, kk)) app[kk] = next[kk] | 0;
      paintRows();
    }
    function destroy() { if (raf) cancelAnimationFrame(raf); raf = null; }

    paintRows();
    return { get: get, set: set, destroy: destroy };
  }

  /** 게임 안에서 모습 고치기 */
  function openEditor() {
    var body = U.el('div');
    body.appendChild(U.el('p', 'hint', '고른 모습은 다른 군주들에게도 곧바로 보입니다.'));
    var host = U.el('div');
    body.appendChild(host);
    var w = mount(host, S.S.you.appearance || S.defaultAppearance(), null);
    var foot = U.el('div');
    foot.appendChild(U.btn('닫는다', 'btn-ghost', function () { U.closeTopModal(); }));
    var ok = U.btn('이 모습으로', 'btn-primary', function () {
      var a = w.get();
      S.set({ you: { role: S.S.you.role, appearance: a, avatarId: S.S.avatarId } });
      GM.net.send('setAppearance', { appearance: a });
      GM.sfx.play('unlock');
      U.toast('모습을 고쳤습니다.', 'good');
      U.closeTopModal();
    });
    ok.id = 'appearance-save';
    foot.appendChild(ok);
    return U.openModal({ title: '군주의 모습', body: body, footer: foot, width: '620px',
                         key: 'appearance', icon: GM.icons.img('crown', 22),
                         onClose: function () { w.destroy(); } });
  }

  GM.charcreate = { mount: mount, openEditor: openEditor, STYLE_KO: STYLE_KO };
})(window);
