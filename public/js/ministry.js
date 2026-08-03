/* ministry.js — 각료 집무실(모달). 티어 3(마을)부터 열린다.
   농정관=일손 나누기 / 공장장=공정 / 건축가=건물 개축 / 국방대신=울타리 앞 /
   외교관=교역·흥정 / 성녀=예언·축복.  (유물함·국법은 따로 있다)
   ★ v3 — 부처는 티어 3부터 돌아간다. 그 전에는 이 화면 자체가 없다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  function open(roleKey) {
    if (!S.uiOn('panel.roles')) { U.toast('아직 저마다의 자리가 정해지지 않았습니다.', 'warn'); return; }
    var meta = S.roleMeta(roleKey);
    var body = U.el('div');

    var sp = U.el('div', 'speech');
    sp.appendChild(GM.icons.portraitImg(roleKey, 56, 'office'));
    var sb = U.el('div', 'sp-body');
    sb.appendChild(U.el('span', 'sp-who', S.isVacant(roleKey) ? meta.name + ' (빈자리)'
      : (S.holderName(roleKey) + ' ' + meta.name)));
    sb.appendChild(U.el('div', 'sp-line', GM.hud.brief(roleKey, S.nation())));
    sp.appendChild(sb);
    body.appendChild(sp);

    if (S.isVacant(roleKey)) {
      var w = U.el('div', 'scroll-card');
      w.appendChild(U.el('p', null, '이 자리는 비어 있습니다. ' + meta.vacancy + '.'));
      body.appendChild(w);
    }

    var mk = { farm: farmRoom, factory: factoryRoom, build: buildRoom,
               defense: defenseRoom, trade: tradeRoom, saint: saintRoom }[roleKey];
    if (mk) mk(body);

    var foot = U.el('div');
    foot.appendChild(U.btn('물러난다', 'btn-primary', function () { U.closeTopModal(); }));
    return U.openModal({ title: meta.name + ' 집무실', body: body, footer: foot, width: '660px',
                         key: 'ministry:' + roleKey, icon: GM.icons.portraitImg(roleKey, 22, 'office') });
  }

  /* ── 농정관 — 일손 나누기 ─────────────────────────── */
  function farmRoom(body) {
    var n = S.nation();
    body.appendChild(U.el('h3', 'sec-title', '일손 나누기'));
    var counts = (n.villagerMix && n.villagerMix.counts) || {};
    var wrap = U.el('div', 'labor-rows');
    S.LABOR.forEach(function (l) {
      var row = U.row();
      row.appendChild(U.el('span', 'row-name', l.name));
      var g = U.makeGauge({ height: 18, color: l.color });
      var share = (n.laborAlloc && n.laborAlloc[l.key]) || 0;
      g.setValue(share, U.pct(share, 0) + ' · ' + (counts[l.key] || 0) + '명');
      row.appendChild(g);
      wrap.appendChild(row);
    });
    body.appendChild(wrap);
    var acts = U.el('div', 'ctx-acts');
    acts.appendChild(U.btn('알아서 나누기', 'btn-primary', function () {
      GM.net.send('setLabor', { recommended: true });
      U.toast('일손을 다시 나누었습니다.', 'good');
      U.closeTopModal();
    }));
    acts.appendChild(U.btn('사람 명부 보기', '', function () { U.closeTopModal(); GM.residents.openPanel(); }));
    body.appendChild(acts);

    var days = n.population ? (n.resources.grain || 0) / n.population : 0;
    body.appendChild(U.el('p', 'hint', '곳간에 식량 ' + U.fmt(n.resources.grain, 0) +
      ' — 지금 사람 수로 ' + U.fmt(days, 1) + '일치입니다. 식량이 넉넉해야 새 사람이 찾아옵니다.'));
  }

  /* ── 공장장 — 공정 ────────────────────────────────── */
  function factoryRoom(body) {
    var n = S.nation();
    body.appendChild(U.el('h3', 'sec-title', '무엇을 먼저 만들까'));
    var q = n.factoryQueue || { steel: 0.34, fuel: 0.33, weapon: 0.33 };
    var draft = { steel: q.steel || 0, fuel: q.fuel || 0, weapon: q.weapon || 0 };
    var host = U.el('div');
    body.appendChild(host);
    var NAMES = { steel: '강재', fuel: '연료', weapon: '무기' };
    function paint() {
      U.clear(host);
      var sum = draft.steel + draft.fuel + draft.weapon || 1;
      ['steel', 'fuel', 'weapon'].forEach(function (k) {
        var row = U.row();
        row.appendChild(U.el('span', 'row-name', NAMES[k]));
        var g = U.makeGauge({ height: 18, color: '#8d7f6a' });
        g.setValue(draft[k] / sum, U.pct(draft[k] / sum, 0));
        row.appendChild(g);
        var acts = U.el('span', 'row-acts');
        acts.appendChild(U.btn('−', 'btn-sm', function () { draft[k] = Math.max(0, draft[k] - 0.05); paint(); }));
        acts.appendChild(U.btn('＋', 'btn-sm', function () { draft[k] = Math.min(1, draft[k] + 0.05); paint(); }));
        row.appendChild(acts);
        host.appendChild(row);
      });
    }
    paint();
    var save = U.btn('이대로 돌린다', 'btn-primary', function () {
      GM.net.send('setQueue', { factory: draft });
      U.toast('공정을 정했습니다.', 'good');
      U.closeTopModal();
    });
    save.id = 'factory-save';
    body.appendChild(save);
  }

  /* ── 건축가 — 건물 개축 ───────────────────────────── */
  function buildRoom(body) {
    body.appendChild(U.el('h3', 'sec-title', '세워 둔 것'));
    var list = S.structures();
    if (!list.length) { body.appendChild(U.el('p', 'empty', '아직 세운 것이 없습니다.')); return; }
    var wrap = U.el('div', 'st-list');
    list.slice().sort(function (a, b) { return (b.tier - a.tier) || a.name.localeCompare(b.name); }).forEach(function (b) {
      var row = U.el('button', 'st-row');
      row.type = 'button';
      row.setAttribute('data-structure', b.id);
      row.appendChild(GM.icons.img(GM.build.iconOf(b.key), 24));
      var col = U.el('div', 'st-col');
      col.appendChild(U.el('span', 'st-n', b.name + ' ' + b.tier + '단'));
      var cond = b.condition === undefined ? 1 : b.condition;
      col.appendChild(U.el('span', 'st-s',
        (b.nextTier ? '개축 ' + GM.build.costText(b.nextTier.cost, b.nextTier.gold) : '다 올렸다') +
        (cond < 0.999 ? ' · 튼튼함 ' + U.pct(cond, 0) : '')));
      row.appendChild(col);
      row.onclick = function () {
        U.closeTopModal();
        GM.camera.moveTo(b.x, b.y);
        GM.structure.open(b.id);
      };
      wrap.appendChild(row);
    });
    body.appendChild(wrap);
    body.appendChild(U.el('p', 'hint', '건물을 눌러 그 한 채만 개축하거나 수리합니다.'));
  }

  /* ── 국방대신 — 울타리 앞 ─────────────────────────── */
  function defenseRoom(body) {
    var d = S.defense() || {};
    body.appendChild(U.el('h3', 'sec-title', '울타리 앞 사정'));
    var grid = U.el('div', 'stat-grid');
    stat(grid, '터렛', U.fmt(d.turretCount, 0) + '기');
    stat(grid, '민병', U.fmt(d.militiaCount, 0) + '명');
    stat(grid, '울타리', U.fmt(d.fenceSegments, 0) + '조각');
    stat(grid, '합쳐서', U.fmt(d.totalDps, 0));
    body.appendChild(grid);
    var b = U.btn('울타리 앞을 자세히 본다', 'btn-primary', function () {
      U.closeTopModal();
      GM.combat.openThreat();
    });
    b.id = 'defense-threat';
    body.appendChild(b);
  }

  /* ── 외교관 — 교역 ────────────────────────────────── */
  function tradeRoom(body) {
    if (!S.featOn('trade')) {
      body.appendChild(U.el('p', 'hint', '교역소가 서야 흥정할 수 있습니다.'));
      return;
    }
    var v = S.S.view;
    var market = (v && v.market) || {};
    body.appendChild(U.el('h3', 'sec-title', '우리 값'));
    var tbl = U.el('div', 'price-rows');
    S.RESOURCES.forEach(function (r) {
      var m = market.local && market.local[r.key];
      if (!m) return;
      var row = U.row();
      row.appendChild(GM.icons.img(GM.icons.resIcon(r.key), 18));
      row.appendChild(U.el('span', 'row-name', r.name));
      row.appendChild(U.el('span', 'row-cost', U.fmt(m.price, 2)));
      tbl.appendChild(row);
    });
    body.appendChild(tbl);
    if (!market.foreign) {
      body.appendChild(U.el('p', 'hint', '외교관이 자리에 있어야 이웃의 값이 보입니다.'));
    }
    var offers = S.offers();
    if (offers.length) {
      body.appendChild(U.el('h3', 'sec-title', '들어온 제안'));
      offers.slice(0, 5).forEach(function (o) {
        var row = U.el('button', 'st-row');
        row.type = 'button';
        row.appendChild(GM.icons.img('ship', 22));
        row.appendChild(U.el('span', null, (o.nationName || '어느 상단') + ' — ' +
          S.resourceMeta(o.resource).name + ' ' + U.fmt(o.amount, 0) +
          (o.side === 'buy' ? ' 사겠답니다' : ' 팔겠답니다')));
        row.onclick = function () { U.closeTopModal(); openOffer(o); };
        body.appendChild(row);
      });
    }
  }

  /* ── 성녀 ─────────────────────────────────────────── */
  function saintRoom(body) {
    var w = S.wave();
    body.appendChild(U.el('h3', 'sec-title', '다가오는 날'));
    var card = U.el('div', 'scroll-card');
    if (w && w.precise && w.enemy) {
      card.appendChild(U.el('p', null, w.hint || (w.enemy.name + '이(가) ' + w.daysUntil + '일 뒤에 옵니다.')));
    } else {
      card.appendChild(U.el('p', null, '아직 빛이 흐립니다. 성녀가 자리에 있어야 날이 정해집니다.'));
    }
    body.appendChild(card);

    body.appendChild(U.el('h3', 'sec-title', '성역의 빛'));
    var acts = U.el('div', 'ctx-acts');
    S.RESOURCES.slice(0, 3).forEach(function (r) {
      acts.appendChild(U.btn(r.name + '에 빛을', '', function () {
        GM.net.send('saintBuff', { resource: r.key });
        U.toast(r.name + '에 빛을 내렸습니다.', 'good');
        U.closeTopModal();
      }));
    });
    body.appendChild(acts);
  }

  function stat(grid, name, val, sub) {
    var c = U.el('div', 'stat');
    c.appendChild(U.el('span', 's-name', name));
    c.appendChild(U.el('span', 'num s-val', val));
    if (sub) c.appendChild(U.el('span', 's-sub', sub));
    grid.appendChild(c);
  }

  /* ── 상인 제안 ────────────────────────────────────── */
  function openOffer(o) {
    if (!o) return;
    var rm = S.resourceMeta(o.resource);
    var body = U.el('div');
    body.appendChild(U.el('p', null, (o.nationName || '어느 상단') + '이(가) ' + rm.name + ' ' +
      U.fmt(o.amount, 0) + '을(를) ' + (o.side === 'buy' ? '사겠다' : '팔겠다') + '고 합니다.'));
    if (o.price) body.appendChild(U.el('p', null, '한 몫에 ' + U.fmt(o.price, 2) + ' · 모두 ' +
      U.fmt(o.price * o.amount, 0) + ' 금화'));
    if (o.text) body.appendChild(U.el('p', 'hint', o.text));
    var foot = U.el('div');
    foot.appendChild(U.btn('물린다', 'btn-ghost', function () {
      GM.net.send('respondOffer', { offerId: o.offerId, accept: false });
      U.closeTopModal();
    }));
    var yes = U.btn('받아들인다', 'btn-primary', function () {
      GM.net.send('respondOffer', { offerId: o.offerId, accept: true });
      GM.sfx.play('coin');
      U.closeTopModal();
    });
    yes.id = 'offer-accept';
    foot.appendChild(yes);
    return U.openModal({ title: '상단의 제안', body: body, footer: foot, width: '520px',
                         key: 'offer', icon: GM.icons.img('ship', 22) });
  }

  GM.ministry = { open: open, openOffer: openOffer };
})(window);
