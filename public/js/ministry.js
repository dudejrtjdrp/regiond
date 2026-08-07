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
  /* ★ §19-C — 여기는 「검은 기둥 + −/+ 두 개」였다. 무반응의 원인은 둘이다:
     ① 눈금(.gauge)이 flex 자식으로 0폭이 되어 막대도 숫자도 안 보였다(main.css 에서 고쳤다).
     ② 무기 칸은 **어디에서도 쓰이지 않는 죽은 몫**이었다 — 서버의 공정(tick.applyFactoryQueue)이
        만드는 것은 강재와 연료뿐이고, 무기는 골드로 사는 국가 도구(buyTool)다. 그 칸에 준 몫은
        그대로 버려졌다. 실제로 만들어지는 둘만 놓고, 무엇이 무엇으로 바뀌는지를 함께 적는다. */
  var FACTORY_LINES = [
    { key: 'steel', name: '강재', color: '#9aa3ad',
      from: '철광석 + 연료', desc: '녹여 벼린 쇠 — 개축과 장비가 여기서 나옵니다.' },
    { key: 'fuel', name: '연료', color: '#c98b3a',
      from: '석유', desc: '제련의 불. 모자라면 목재를 숯으로 태워 메웁니다.' },
  ];

  function factoryShare(draft, key) {
    var sum = (draft.steel || 0) + (draft.fuel || 0);
    return sum > 0 ? (draft[key] || 0) / sum : 0;
  }

  /** −/+ 한 번 = 5%p. 둘 다 0이 되면 서버가 되돌려 보내므로 한쪽은 남겨 둔다. */
  function bumpFactory(draft, key, dir) {
    var other = key === 'steel' ? 'fuel' : 'steel';
    var v = Math.min(1, Math.max(0, (draft[key] || 0) + dir * 0.05));
    draft[key] = Math.round(v * 100) / 100;
    if ((draft[key] || 0) + (draft[other] || 0) <= 0) draft[other] = 0.05;
  }

  function factoryRow(host, draft, line, repaint) {
    var res = (S.nation() || {}).resources || {};
    var row = U.row();
    row.appendChild(U.el('span', 'row-name', line.name));
    var g = U.makeGauge({ height: 18, color: line.color });
    g.setValue(factoryShare(draft, line.key), U.pct(factoryShare(draft, line.key), 0));
    row.appendChild(g);
    var acts = U.el('span', 'row-acts');
    acts.appendChild(U.btn('−', 'btn-sm', function () { bumpFactory(draft, line.key, -1); repaint(); }));
    acts.appendChild(U.btn('＋', 'btn-sm', function () { bumpFactory(draft, line.key, 1); repaint(); }));
    row.appendChild(acts);
    host.appendChild(row);
    host.appendChild(U.el('p', 'hint', line.from + ' → ' + line.name + ' · ' + line.desc +
      ' 지금 곳간에 ' + U.fmt(res[line.key] || 0, 0) + '.'));
  }

  function saveFactory(draft) {
    /* weapon 은 계약(PROTOCOL setQueue)에 남은 칸이라 0으로 실어 보낸다 — 필드는 지우지 않는다 */
    GM.net.send('setQueue', { factory: { steel: draft.steel, fuel: draft.fuel, weapon: 0 } });
    U.toast('공정을 정했습니다 — 강재 ' + U.pct(factoryShare(draft, 'steel'), 0) +
            ' · 연료 ' + U.pct(factoryShare(draft, 'fuel'), 0) + '.', 'good');
    U.closeTopModal();
  }

  function factoryRoom(body) {
    var q = S.nation().factoryQueue || {};
    var draft = { steel: q.steel == null ? 0.6 : q.steel, fuel: q.fuel == null ? 0.4 : q.fuel };
    body.appendChild(U.el('h3', 'sec-title', '무엇을 먼저 만들까'));
    body.appendChild(U.el('p', 'hint', '공방에 앉은 손이 오늘 어느 쪽에 붙을지 정합니다. ' +
      '두 몫을 합해 100%가 되도록 나뉘고, 원료가 모자라면 그만큼만 나옵니다.'));
    var host = U.el('div');
    body.appendChild(host);
    var repaint = function () {
      U.clear(host);
      FACTORY_LINES.forEach(function (line) { factoryRow(host, draft, line, repaint); });
    };
    repaint();
    var save = U.btn('이대로 돌린다', 'btn-primary', function () { saveFactory(draft); });
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
    partnerRows(body);
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

  /* ── ★ §19-F3(F07-7) 교역 상대 좌판 ────────────────────
     「왜」 이 화면이 생겼나 — 여태 교역은 저쪽이 보내오는 제안을 받는 일뿐이었다. 값이 어디나 같으니
     보낼 제안도 늘 비슷했고, 그래서 무역은 「가끔 뜨는 알림」이었다. 이제 나라마다 값이 다르다:
     어디서 사고 어디에 파는가가 선택이 된다. 값은 전부 서버가 빚어 보낸다(view.tradePartners). */
  function partnerRows(body) {
    var list = S.tradePartners();
    if (!list.length) {
      body.appendChild(U.el('p', 'hint', '아직 찾아가 본 나라가 없습니다. 이웃의 도읍 앞까지 걸어가면 좌판이 열립니다.'));
      return;
    }
    body.appendChild(U.el('h3', 'sec-title', '이웃의 좌판'));
    list.forEach(function (p) {
      var row = U.el('button', 'st-row');
      row.type = 'button';
      row.setAttribute('data-trade-partner', p.id);
      row.appendChild(GM.icons.img('ship', 22));
      row.appendChild(U.el('span', null, p.name + ' — ' + profileLine(p)));
      row.onclick = function () { U.closeTopModal(); openPartner(p.id); };
      body.appendChild(row);
    });
  }

  /** 「싸게 내주는 것 / 비싸게 사는 것」 한 줄 — 성정이 곧 값이라는 것을 이 줄이 말한다 */
  function profileLine(p) {
    var pr = p.profile || {};
    var cheap = (pr.exports || []).map(function (x) { return x.name; }).slice(0, 3).join('·');
    var dear = (pr.demands || []).map(function (x) { return x.name; }).slice(0, 3).join('·');
    return '헐값 ' + (cheap || '—') + ' / 후한값 ' + (dear || '—');
  }

  function partnerById(id) {
    var list = S.tradePartners();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /** 한 나라의 좌판 — 재화마다 살 값·팔 값을 나란히 두고, 아래에 특산품을 편다 */
  function openPartner(id) {
    var p = partnerById(id);
    if (!p) { U.toast('그 나라의 좌판을 아직 못 봤습니다.', 'warn'); return null; }
    var body = U.el('div');
    body.appendChild(U.el('p', 'hint', profileLine(p) + ' — 값은 관세·운임까지 얹은 실제 값입니다.'));
    var tbl = U.el('div', 'price-rows');
    S.RESOURCES.forEach(function (r) { tbl.appendChild(dealRow(p, r)); });
    body.appendChild(tbl);
    specialtyRows(body, p);
    var foot = U.el('div');
    foot.appendChild(U.btn('물러난다', 'btn-ghost', function () { U.closeTopModal(); }));
    return U.openModal({ title: p.name + ' 좌판', body: body, footer: foot, width: '640px',
                         key: 'trade:' + p.id, icon: GM.icons.img('ship', 22) });
  }

  function dealRow(p, r) {
    var row = U.row();
    row.appendChild(GM.icons.img(GM.icons.resIcon(r.key), 18));
    row.appendChild(U.el('span', 'row-name', r.name));
    row.appendChild(U.el('span', 'row-cost', '삼 ' + U.fmt(p.buy[r.key], 2)));
    row.appendChild(U.el('span', 'row-cost', '팜 ' + U.fmt(p.sell[r.key], 2)));
    row.appendChild(U.btn('산다', 'btn-small', function () { askAmount(p, r, 'buy'); }));
    row.appendChild(U.btn('판다', 'btn-small', function () { askAmount(p, r, 'sell'); }));
    return row;
  }

  /** 수량을 묻는 작은 창 — 셈은 서버가 다시 한다(클라 신뢰 금지) */
  function askAmount(p, r, side) {
    var unit = side === 'buy' ? p.buy[r.key] : p.sell[r.key];
    var body = U.el('div');
    body.appendChild(U.el('p', null, r.name + ' 하나에 ' + U.fmt(unit, 2) + ' 금화입니다.'));
    var input = document.createElement('input');
    input.type = 'number';
    input.id = 'trade-amount';
    input.min = '1';
    input.value = '10';
    body.appendChild(input);
    var foot = U.el('div');
    foot.appendChild(U.btn('물러난다', 'btn-ghost', function () { U.closeTopModal(); }));
    var go = U.btn(side === 'buy' ? '산다' : '판다', 'btn-primary', function () {
      U.closeTopModal();
      sendTrade(p, r, side, Math.floor(Number(input.value)));
    });
    go.id = 'trade-confirm';
    foot.appendChild(go);
    return U.openModal({ title: r.name + ' ' + (side === 'buy' ? '사기' : '팔기'), body: body,
                         footer: foot, width: '420px', key: 'trade-amount',
                         icon: GM.icons.img(GM.icons.resIcon(r.key), 22) });
  }

  function sendTrade(p, r, side, amount) {
    if (!(amount > 0)) { U.toast('수량을 적어 주세요.', 'warn'); return; }
    GM.net.send('trade', { nationId: p.id, side: side, resource: r.key, amount: amount }, function (res) {
      if (!res || !res.ok) {
        U.toast((res && res.error && res.error.message) || '거래하지 못했습니다.', 'warn', 3200);
        return;
      }
      U.toast(r.name + ' ' + amount + ' — 금화 ' + U.fmt(res.gold, 1), 'good', 3000);
      GM.sfx.play('gain');
    });
  }

  /** 특산품 — 우리 땅에서 나지 않는 것. 재고가 있고 며칠에 걸쳐 다시 찬다. */
  function specialtyRows(body, p) {
    var items = p.specialties || [];
    if (!items.length) return;
    body.appendChild(U.el('h3', 'sec-title', '특산품'));
    items.forEach(function (it) {
      var card = U.el('div', 'scroll-card');
      card.setAttribute('data-specialty', it.key);
      card.appendChild(U.el('b', null, it.name + ' — 금화 ' + U.fmt(it.gold, 0)));
      card.appendChild(U.el('p', null, it.desc || ''));
      card.appendChild(U.el('span', 'hint', it.left > 0 ? ('남은 ' + it.left + '개')
        : ('다 팔렸습니다 — ' + it.restockInDays + '일 뒤에 들어옵니다')));
      var btn = U.btn('산다', 'btn-small btn-primary', function () { buySpecialty(p, it); });
      btn.disabled = !(it.left > 0);
      card.appendChild(btn);
      body.appendChild(card);
    });
  }

  function buySpecialty(p, it) {
    GM.net.send('buySpecialty', { nationId: p.id, key: it.key }, function (res) {
      if (!res || !res.ok) {
        U.toast((res && res.error && res.error.message) || '사지 못했습니다.', 'warn', 3200);
        return;
      }
      U.toast(it.name + '을(를) 들여왔습니다.', 'good', 3000);
      GM.sfx.play('unlock');
      U.closeTopModal();
      openPartner(p.id);
    });
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

  GM.ministry = {
    openPartner: openPartner, open: open, openOffer: openOffer };
})(window);
