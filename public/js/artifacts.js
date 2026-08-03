/* artifacts.js — 유물함(모달) + 상자 여는 연출 */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  function defOf(key) {
    var d = S.artifactDef(key);
    if (d) return d;
    return { key: key, name: key, grade: 'common', type: 'permanent', desc: '' };
  }
  function itemDef(a) {
    if (a && a.name) return a;
    var d = defOf(a && a.key);
    return { key: a && a.key, name: d.name, grade: d.grade, type: d.type, desc: d.desc };
  }
  function gradeCls(g) { return S.gradeInfo(g).cls; }
  function gradeName(g) { return S.gradeInfo(g).name; }
  function gradeColor(g) { return S.gradeInfo(g).color; }

  function open() {
    if (!S.uiOn('panel.council')) { U.toast('유물함은 읍이 되어야 열립니다.', 'warn'); return; }
    var body = U.el('div');
    body.appendChild(U.el('p', null,
      '어전 회의마다 낮은 확률로 상자가 열립니다. 그 이레에 부지런했던 부처의 계열이 나오기 쉽습니다.'));
    body.appendChild(U.el('p', 'hint',
      '한 번 쓰면 사라지는 것과, 얻는 순간부터 계속 힘을 쓰는 것이 있습니다.'));
    var g = U.el('div', 'art-grid');
    g.id = 'art-grid';
    body.appendChild(g);
    var foot = U.el('div');
    foot.appendChild(U.btn('덮는다', 'btn-primary', function () { U.closeTopModal(); }));
    U.openModal({ title: '유물함', body: body, footer: foot, width: '760px', key: 'relic',
                  icon: GM.icons.img('gem', 22) });
    paint();
  }

  function paint() {
    var grid = U.qs('#art-grid');
    if (!grid) return;
    U.clear(grid);
    var n = S.nation();
    var list = (n && n.artifacts) || [];
    if (!list.length) {
      grid.appendChild(U.el('div', 'empty', '아직 땅이 내어준 것이 없습니다.'));
      return;
    }
    list.forEach(function (a) {
      var d = itemDef(a);
      var c = U.el('div', 'art ' + gradeCls(d.grade) + (a.consumed ? ' used' : ''));
      c.appendChild(U.el('div', 'a-name', d.name || a.key));
      c.appendChild(U.el('div', 'a-grade', gradeName(d.grade) + ' · ' + typeName(d.type)));
      c.appendChild(U.el('div', 'a-desc', d.desc || ''));
      U.tipSet(c, (d.name || a.key) + ' — ' + gradeName(d.grade),
        (d.desc || '') + (a.obtainedTick !== undefined ? '\n' + a.obtainedTick + '일에 얻었습니다.' : ''));
      if (isConsumable(d) && !a.consumed) {
        var b = U.btn('쓴다', 'btn-sm btn-primary a-act', function () {
          U.confirmBox('유물을 쓸까요?', (d.name || a.key) + ' — ' + (d.desc || '') + '\n\n한 번 쓰면 사라집니다.',
            function () { GM.net.send('useArtifact', { key: a.key }); GM.sfx.play('unlock'); }, '쓴다');
        });
        b.setAttribute('data-artifact', a.key);
        c.appendChild(b);
      } else if (a.consumed) {
        c.appendChild(U.el('div', 'a-act hint', '이미 썼습니다'));
      }
      grid.appendChild(c);
    });
  }

  function isConsumable(d) {
    var t = String(d.type || '').toLowerCase();
    return t === 'consumable' || t === '소모형';
  }
  function typeName(t) {
    t = String(t || '').toLowerCase();
    if (t === 'consumable') return '한 번 쓰는 것';
    if (t === 'permanent') return '늘 힘을 쓰는 것';
    if (t === 'utility') return '요긴한 것';
    if (t === 'cosmetic') return '보기 좋은 것';
    if (t === 'tradeoff') return '주고받는 것';
    return t || '—';
  }

  /* ── 상자 여는 연출 ────────────────────────────────── */
  function openChest(drop, host, onDone) {
    var empty = !drop || !drop.key;
    var def = (drop && drop.name) ? drop
      : (empty ? { name: '빈 상자', grade: (drop && drop.grade) || 'common', type: null,
                   desc: (drop && drop.desc) || '상자는 비어 있었습니다.' }
               : defOf(drop.key));
    var color = gradeColor(def.grade);

    var stage = U.el('div', 'chest-stage');
    var cv = document.createElement('canvas');
    stage.appendChild(cv);
    var nameEl = U.el('div', 'chest-name', '');
    nameEl.style.color = color;
    stage.appendChild(nameEl);
    var descEl = U.el('div', 'hint');
    descEl.style.textAlign = 'center';
    stage.appendChild(descEl);
    host.appendChild(stage);

    var W = 200, H = 150;
    var t0 = (global.performance && performance.now) ? performance.now() : Date.now();
    var done = false;
    GM.sfx.play('page');

    function frame(t) {
      var e = (t - t0) / 1000;
      var ctx = U.fitCanvas(cv, W, H);
      ctx.clearRect(0, 0, W, H);
      var s = 6;
      var shake = e < 1.2 ? Math.sin(e * 34) * 3 * (1.2 - e) : 0;
      var lid = U.clamp((e - 1.2) / 0.7, 0, 1);
      var glow = U.clamp((e - 1.3) / 0.9, 0, 1);

      if (glow > 0) {
        for (var i = 0; i < 22; i++) {
          var a = glow * (1 - i / 22) * 0.75;
          ctx.fillStyle = U.rgba(color, a * 0.5);
          ctx.fillRect(W / 2 - (26 - i * 0.7), H * 0.62 - i * 5, (26 - i * 0.7) * 2, 5);
        }
        for (var k = 0; k < 18; k++) {
          var pr = U.rngFrom('chest' + k);
          var px0 = W / 2 + (pr() - 0.5) * 90;
          var py0 = H * 0.62 - ((e * 46 + pr() * 100) % 110);
          ctx.fillStyle = U.rgba(color, glow * (0.35 + pr() * 0.6));
          ctx.fillRect(Math.round(px0 / 3) * 3, Math.round(py0 / 3) * 3, 3, 3);
        }
      }

      var bx = W / 2 - 40 + shake, by = H * 0.62;
      U.px(ctx, bx, by, 80, 34, '#5c3b20');
      U.px(ctx, bx, by, 80, s, '#7a5230');
      U.px(ctx, bx + 34, by, 12, 34, '#a8701f');
      U.px(ctx, bx - 4, by + 30, 88, 6, '#3b2318');
      var ly = by - 18 - lid * 26;
      var rot = lid * 10;
      U.px(ctx, bx, ly - rot, 80, 18, '#6b4526');
      U.px(ctx, bx, ly - rot, 80, s, '#a3703f');
      U.px(ctx, bx + 34, ly - rot, 12, 18, '#a8701f');

      if (e > 2.3 && !done) {
        done = true;
        nameEl.textContent = def.name || (drop && drop.key) || '빈 상자';
        nameEl.classList.add('show');
        descEl.textContent = empty ? (def.desc || '')
          : (gradeName(def.grade) + ' · ' + typeName(def.type) + ' — ' + (def.desc || ''));
        if (!empty) { GM.sfx.play('fanfare'); U.sparkle(stage, color); }
        if (onDone) onDone();
      }
      if (e < 4.2) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return stage;
  }

  function update() { if (U.modalOpen('relic')) paint(); }

  GM.artifacts = { open: open, update: update, openChest: openChest,
                   gradeColor: gradeColor, defOf: defOf, itemDef: itemDef };
})(window);
