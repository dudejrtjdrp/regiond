/* opening.js — ★ 마차 도착 오프닝 (GDD3 §2). 첫 30분의 첫 20초.
   마차가 굴러와 멈추고, 개척자가 내리고, 모닥불에 불이 붙는다. 자막 네 줄.
   언제든 [건너뛰기] 또는 아무 키로 넘길 수 있다. 한 번 본 정착지에서는 다시 뜨지 않는다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var LINES = [
    { at: 0.6,  text: '마차는 사흘을 달려 여기서 멈췄다.' },
    { at: 4.2,  text: '지도에 이름이 없는 땅. 사람도 없다.' },
    { at: 7.6,  text: '가진 것은 도끼 한 자루와 불씨 하나.' },
    { at: 10.8, text: '여기서 시작한다.' }
  ];
  var TOTAL = 14.4;

  var st = null;             // {t, done, from, to, onDone}
  var onEnd = null;
  var skipBtn = null;

  function seenKey() { return 'gm.opening.' + (S.S.gameId || 'new'); }
  function seen() {
    try { return localStorage.getItem(seenKey()) === '1'; } catch (e) { return false; }
  }
  function markSeen() {
    try { localStorage.setItem(seenKey(), '1'); } catch (e) {}
  }

  /** 지금 오프닝을 틀 자리인가 — 갓 세운 야영지에서만 */
  function shouldPlay() {
    if (S.S.mock) return true;
    if (seen()) return false;
    if (S.tierNo() > 0) return false;
    var q = new URLSearchParams(location.search);
    if (q.get('opening') === '0') return false;
    if (q.get('opening') === '1') return true;
    /* 갓 도착한 자리 — 모닥불 하나뿐이고 아직 아무도 살지 않는다 */
    var v = S.S.view;
    if (v && v.day > 1) return false;
    if ((S.residents() || []).length > 0) return false;
    return (S.structures() || []).length <= 1;
  }

  /**
   * ★ GDD3 §12-7 — 하차 자리 = 실제 시작 자리.
   *   마차가 멈추는 곳, 사람이 내리는 곳, 컷신이 끝나고 서 있는 곳이 전부 같아야 한다.
   *   그 한 곳은 GM.avatar.startPos 가 정한다(본부 4×4 사각형 바깥의 고정점).
   */
  function dropPoint(town) {
    return GM.avatar.startPos(town) || { x: town.x + 3, y: town.y + 2 };
  }

  function play(done) {
    var town = S.myTown();
    if (!town) { if (done) done(); return; }
    onEnd = done || null;
    S.set({ opening: true });
    var drop = dropPoint(town);
    st = {
      t: 0,
      from: { x: drop.x - 18, y: drop.y + 1 },
      /* 마차는 하차 자리 바로 옆에 선다 — 사람은 마차에서 내려 그 자리에 그대로 남는다 */
      to: { x: drop.x + 1.4, y: drop.y },
      wx: drop.x - 18, wy: drop.y + 1,
      drop: drop,
      dropped: false, lit: false, line: -1
    };
    GM.avatar.freeze(true);
    /* ★ 마차가 굴러오는 동안 개척자는 마차 안에 있다 — 스프라이트를 감춘다 */
    GM.avatar.setHidden(true);
    GM.avatar.setPos(drop.x, drop.y);
    GM.camera.reset(town.x, town.y);
    GM.camera.moveTo(town.x, town.y);
    GM.sfx.play('wheel');
    mountSkip();
  }

  function mountSkip() {
    var root = U.qs('#cutscene-root');
    if (!root) return;
    U.clear(root);
    var wrap = U.el('div', 'open-skip');
    skipBtn = U.btn('건너뛰기 ▸', 'btn-sm', finish);
    skipBtn.id = 'opening-skip';
    wrap.appendChild(skipBtn);
    root.appendChild(wrap);
    /* 컷신 동안에는 알림 더미가 건너뛰기 단추를 덮지 않도록 비켜 세운다(main.css body.cutscene) */
    document.body.classList.add('cutscene');
    document.addEventListener('keydown', onKey, true);
  }

  function onKey(e) {
    if (!st) return;
    if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); finish(); }
  }

  function step(dt) {
    if (!st) return;
    st.t += dt;
    var t = st.t;

    /* 마차가 굴러온다 (0 ~ 5.4초) */
    var k = U.clamp(t / 5.4, 0, 1);
    var e = 1 - Math.pow(1 - k, 2.4);
    st.wx = st.from.x + (st.to.x - st.from.x) * e;
    st.wy = st.from.y + (st.to.y - st.from.y) * e;
    /* ★ 하차 — 이 순간 개척자가 나타난다. 자리는 실제 시작 자리 그대로. */
    if (!st.dropped && t > 5.6) {
      st.dropped = true;
      GM.avatar.setPos(st.drop.x, st.drop.y);
      GM.avatar.setHidden(false);
      GM.fx.dust(st.drop.x, st.drop.y + 0.2, 12);
      GM.fx.ring(st.drop.x, st.drop.y, '#f6cf7a', 0.15, 1.2, 0.5);
      GM.sfx.play('build');
    }
    if (st.dropped) {
      /* 마차는 온 길로 되돌아간다 */
      st.wx -= 2.2 * dt;
      st.wy -= 0.24 * dt;
    }
    if (!st.lit && t > 8.4) {
      st.lit = true;
      var town = S.myTown();
      if (town) {
        GM.fx.sparkle(town.x, town.y, 16, '#f6cf7a');
        GM.fx.ring(town.x, town.y, '#e08541', 0.3, 2.4, 0.9, 3);
        GM.fx.flash('#ffdcae', 0.22, 0.5);
      }
      GM.sfx.play('unlock');
    }
    for (var i = 0; i < LINES.length; i++) {
      if (t >= LINES[i].at && st.line < i) st.line = i;
    }
    if (t > TOTAL) finish();
  }

  function drawOverlay(ctx, W, H, animT) {
    if (!st) return;
    var t = st.t;
    var tile = GM.camera.cam.tile;

    /* 마차 */
    if (st.wx > -50) {
      var p = GM.camera.worldToScreen(st.wx - 1, st.wy - 1.1);
      var frame = Math.floor(animT / 140) % 2;
      try {
        ctx.drawImage(GM.atlas.wagon(frame), Math.round(p.x), Math.round(p.y),
          Math.ceil(tile * 2.2), Math.ceil(tile * 1.65));
      } catch (e) {}
    }

    /* 레터박스 */
    var bar = Math.round(H * 0.11);
    var barK = U.clamp(t < 0.6 ? t / 0.6 : (t > TOTAL - 0.8 ? (TOTAL - t) / 0.8 : 1), 0, 1);
    ctx.save();
    ctx.fillStyle = '#0d0a06';
    ctx.fillRect(0, 0, W, bar * barK);
    ctx.fillRect(0, H - bar * barK, W, bar * barK);
    ctx.restore();

    /* 열림·닫힘 페이드 */
    if (t < 1.0) {
      ctx.save();
      ctx.globalAlpha = 1 - t / 1.0;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    /* 자막 — 한 줄씩 */
    if (st.line >= 0) {
      var line = LINES[st.line];
      var age = t - line.at;
      var alpha = U.clamp(age / 0.5, 0, 1) * U.clamp((3.2 - age) / 0.6, 0, 1);
      if (alpha > 0.01) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textAlign = 'center';
        ctx.font = '18px "Galmuri11", monospace';
        var w = 0;
        try { w = ctx.measureText(line.text).width; } catch (e2) { w = line.text.length * 12; }
        var bx = W / 2 - w / 2 - 18, by = H - bar - 54;
        ctx.fillStyle = 'rgba(20,14,8,.78)';
        ctx.fillRect(bx, by - 22, w + 36, 38);
        ctx.fillStyle = '#e8a33d';
        ctx.fillRect(bx, by - 22, w + 36, 2);
        ctx.fillStyle = '#f4e4bc';
        try { ctx.fillText(line.text, W / 2, by + 3); } catch (e3) {}
        ctx.restore();
      }
    }
  }

  function finish() {
    if (!st) return;
    st = null;
    document.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('cutscene');
    var root = U.qs('#cutscene-root');
    if (root) U.clear(root);
    markSeen();
    S.set({ opening: false });
    GM.avatar.freeze(false);
    GM.avatar.setHidden(false);
    var town = S.myTown();
    if (town) {
      /* ★ §12-7 — 건너뛰든 끝까지 보든 서 있는 자리는 하나다 */
      var d = dropPoint(town);
      GM.avatar.setPos(d.x, d.y);
      GM.camera.moveTo(town.x, town.y);
    }
    U.banner({ icon: 'campfire', kind: 'good', title: '모닥불에 불이 붙었다',
               sub: '여기가 우리의 자리다', ms: 3000 });
    if (onEnd) { var f = onEnd; onEnd = null; f(); }
  }

  function busy() { return !!st; }

  GM.opening = { play: play, step: step, drawOverlay: drawOverlay, busy: busy,
                 shouldPlay: shouldPlay, finish: finish };
})(window);
