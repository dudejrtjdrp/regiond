/* cutscene.js — 감정의 날 도트 컷신(땅이 갈라지고 빛이 샌다) + 자리 정하기 + 시즌 결산(연대기) */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var W = 480, H = 270;
  var raf = null, running = false;

  function normFrames(list) {
    if (!list || !list.length) {
      return [{ text: '땅이 낮게 울었다.', color: '#8a8496' },
              { text: '갈라진 틈으로 빛이 새어 나온다.', color: '#e8a33d' }];
    }
    return list.map(function (f) {
      if (typeof f === 'string') return { text: f, color: '#e8a33d' };
      if (Array.isArray(f)) return { text: f[0], color: f[1] || '#e8a33d' };
      return { text: f.text || f.line || '', color: f.color || '#e8a33d' };
    });
  }

  function play(payload, onEnd) {
    var frames = normFrames(payload && payload.cutscene);
    var root = U.qs('#cutscene-root');
    U.clear(root);

    var back = U.el('div', 'cut-back');
    var cv = document.createElement('canvas');
    cv.id = 'cut-canvas';
    back.appendChild(cv);
    var txt = U.el('div', 'cut-text', '');
    back.appendChild(txt);

    var skip = U.btn('건너뛰기 ▶', 'cut-skip');
    back.appendChild(skip);
    root.appendChild(back);

    var t0 = (global.performance && performance.now) ? performance.now() : Date.now();
    var TOTAL = Math.max(6000, frames.length * 2100);
    running = true;
    GM.sfx.play('warn');

    function finish() {
      if (!running) return;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      U.clear(root);
      showTags(payload, onEnd);
    }
    skip.onclick = finish;

    function frame(t) {
      /* 건너뛰기로 이미 끝났으면 남은 한 프레임은 그리지 않는다 (지워진 요소를 만지지 않게) */
      if (!running || !txt.parentNode) return;
      var e = t - t0;
      var p = U.clamp(e / TOTAL, 0, 1);
      drawScene(cv, p, frames);
      var fi = Math.max(0, Math.min(frames.length - 1, Math.floor(e / (TOTAL / frames.length))));
      var line = frames[fi] || frames[frames.length - 1] || { text: '', color: '#f4e4bc' };
      txt.textContent = line.text || '';
      txt.style.color = line.color || '#f4e4bc';
      if (p >= 1) { finish(); return; }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  }

  function drawScene(cv, p, frames) {
    var ctx = U.fitCanvas(cv, W, H);
    var s = 3;
    var horizon = H * 0.62;

    var skyTop = U.mix('#0d0a14', '#241a38', U.clamp(p * 1.6, 0, 1));
    var skyBot = U.mix('#1b1428', '#5a2f26', U.clamp(p * 1.2, 0, 1));
    for (var y = 0; y < horizon; y += s) U.px(ctx, 0, y, W, s, U.mix(skyTop, skyBot, y / horizon));

    var rnd = U.rngFrom('cut-stars');
    for (var i = 0; i < 70; i++) {
      var sx = Math.floor(rnd() * W / s) * s, sy = Math.floor(rnd() * horizon / s) * s;
      U.px(ctx, sx, sy, s, s, rnd() > 0.8 ? '#8a86aa' : '#2f2c46');
    }
    for (var gy = horizon; gy < H; gy += s) {
      var t = (gy - horizon) / (H - horizon);
      U.px(ctx, 0, gy, W, s, U.mix('#5a4a2a', '#221a0e', t));
    }

    var crackW = U.clamp((p - 0.25) / 0.55, 0, 1) * 46;
    if (crackW > 0) {
      var cx = W * 0.5;
      var rc = U.rngFrom('crack');
      var lightC = frames[frames.length - 1].color || '#e8a33d';
      for (var cy = horizon; cy < H; cy += s) {
        var t2 = (cy - horizon) / (H - horizon);
        var wdt = crackW * (0.25 + t2 * 1.05);
        var jag = (rc() - 0.5) * 8;
        U.px(ctx, cx - wdt / 2 + jag, cy, wdt, s, U.mix('#0d0a14', lightC, U.clamp(0.15 + t2 * 0.9, 0, 1)));
        U.px(ctx, cx - wdt / 2 + jag - s, cy, s, s, '#0d0a14');
        U.px(ctx, cx + wdt / 2 + jag, cy, s, s, '#0d0a14');
      }
      var beam = U.clamp((p - 0.45) / 0.4, 0, 1);
      for (var b = 0; b < 30; b++) {
        var a = beam * (1 - b / 30) * 0.5;
        if (a <= 0) continue;
        var bw = crackW * (1 - b / 42);
        ctx.fillStyle = U.rgba('#e8a33d', a);
        ctx.fillRect(Math.round(cx - bw / 2), Math.round(horizon - b * 5), Math.round(bw), 5);
      }
      for (var k = 0; k < 26; k++) {
        var pr = U.rngFrom('spark' + k);
        var life = (p * 2.2 + pr()) % 1;
        var px0 = cx + (pr() - 0.5) * crackW * 2.4;
        var py0 = horizon - life * 90;
        ctx.fillStyle = U.rgba('#f6cf7a', (1 - life) * beam);
        ctx.fillRect(Math.round(px0 / s) * s, Math.round(py0 / s) * s, s, s);
      }
    }

    for (var q = 0; q < 7; q++) {
      var pxp = W * (0.12 + q * 0.125) + (q % 2 ? 6 : 0);
      if (Math.abs(pxp - W / 2) < crackW * 0.8) continue;
      drawPerson(ctx, pxp, horizon + 2, s, p);
    }
    for (var v = 0; v < H; v += 4) U.px(ctx, 0, v, W, 1, 'rgba(0,0,0,.16)');
  }

  function drawPerson(ctx, x, groundY, s, p) {
    var c = '#120e18';
    var sway = Math.sin(p * 12 + x) * 1;
    U.px(ctx, x - s, groundY - 14 + sway, s * 2, s * 2, c);
    U.px(ctx, x - s * 1.5, groundY - 9 + sway, s * 3, s * 3, c);
    U.px(ctx, x - s * 1.5, groundY - 3, s, s * 3, c);
    U.px(ctx, x + s * 0.5, groundY - 3, s, s * 3, c);
  }

  /* ── 컷신 끝 → 땅의 내력 공개 → 드러난 자원 반짝임 → 관제 선포는 mandate.js 가 받는다 ── */
  function showTags(payload, onEnd) {
    var body = U.el('div');
    body.appendChild(U.el('p', null, '땅이 제 정체를 밝혔습니다.'));

    var tg = U.el('div');
    tg.style.margin = '10px 0';
    ((payload && payload.tags) || []).forEach(function (t) {
      var c = U.el('span', 'chip chip-tag', t);
      c.style.fontSize = '15px';
      c.style.padding = '4px 12px';
      tg.appendChild(c);
    });
    body.appendChild(tg);
    if (payload && payload.tagLine) body.appendChild(U.el('p', null, payload.tagLine));

    var revealed = (payload && payload.revealedNodes) || [];
    if (revealed.length || (payload && payload.nodesRevealed)) {
      body.appendChild(U.el('p', 'hint',
        '땅속에 숨어 있던 자리 ' + (payload.nodesRevealed || revealed.length) + '곳이 드러났습니다.'));
      var strip = U.el('div', 'reveal-strip');
      var byType = {};
      revealed.forEach(function (r) { byType[r.type] = (byType[r.type] || 0) + 1; });
      Object.keys(byType).forEach(function (t) {
        var chip = U.el('span', 'chip chip-role', S.nodeMeta(t).name + ' ' + byType[t] + '곳');
        strip.appendChild(chip);
      });
      body.appendChild(strip);
    }

    body.appendChild(U.el('p', null, '이어서 관제를 선포합니다 — 자리는 그때 정합니다.'));

    var foot = U.el('div');
    var ok = U.btn('땅을 둘러본다', 'btn-primary');
    ok.id = 'emotion-ok';
    foot.appendChild(ok);
    var m2 = U.openModal({ title: '감정의 날', body: body, footer: foot, width: '640px',
                           key: 'emotion', icon: GM.icons.img('gem', 22) });
    ok.onclick = function () {
      U.closeModal(m2);
      /* 드러난 자리로 시선을 옮기고 반짝임을 뿌린다 */
      if (revealed.length) {
        var first = revealed[0];
        GM.camera.moveTo(first.x, first.y);
        revealed.forEach(function (r, i) {
          setTimeout(function () {
            GM.world.ping(r.x, r.y, '#b39ad6');
            GM.fx.floatText(r.x, r.y - 0.5, S.nodeMeta(r.type).name, '#e0d0f4', 13);
          }, i * 140);
        });
        GM.sfx.play('unlock');
      }
      if (onEnd) onEnd();
      /* 관제 선포가 이미 도착해 있으면 바로 연다 */
      if (S.S.mandate) setTimeout(function () { GM.mandate.open(S.S.mandate); }, 900);
    };
  }

  GM.cutscene = {
    play: play,
    busy: function () { return running || !!U.modalOpen('emotion'); }
  };
})(window);
