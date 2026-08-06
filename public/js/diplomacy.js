/* diplomacy.js — ★ §17-16 이웃 나라 찾아가기.
   세 나라는 여태 「교역 목록의 이름」이었다. 도읍이 지도 위에 서 있는데도 걸어가 볼 일이 없었다.
   이제 도읍 앞(world.towns.visitRadius)에 서면 E 로 찾아갈 수 있다:
   서버가 그 나라를 「만난 나라」로 적고, 그 자리에서 이름·성정·품은 땅·시세가 열린다.
   값은 전부 서버가 정본이다 — 화면은 받은 첩(帖)을 펼쳐 보일 뿐 셈을 하지 않는다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var DEFAULT_RADIUS = 6;
  var memo = { t: 0, val: null };

  function now() { return (global.performance && performance.now) ? performance.now() : Date.now(); }

  function radius() {
    var c = S.cfg();
    var t = c && c.world && c.world.towns;
    return (t && t.visitRadius) || DEFAULT_RADIUS;
  }

  /** 세계 뷰에 실린 그 나라의 첩 — 한 번 만났으면 시세가 여기 남아 있다 */
  function known(nationId) {
    var w = S.S.worldState;
    var list = (w && w.nations) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === nationId) return list[i];
    return null;
  }

  /* ══════════ 도읍 앞인가 ══════════ */
  /** 지금 내 아바타가 문 앞에 선 이웃 도읍 — 매 프레임 불리므로 짧게 기억해 둔다 */
  function nearTown() {
    var n0 = now();
    if (n0 - memo.t < 90) return memo.val;
    memo.t = n0;
    memo.val = findTown();
    return memo.val;
  }

  function findTown() {
    var me = GM.avatar && GM.avatar.pos();
    var m = S.S.map;
    if (!me || !m) return null;
    var r = radius();
    var best = null, bd = 1e9;
    (m.towns || []).forEach(function (tw) {
      if (tw.isPlayer) return;
      if (S.fogAt(Math.round(tw.x), Math.round(tw.y)) < 1) return;
      var d = Math.hypot(tw.x - me.x, tw.y - me.y);
      if (d <= r && d < bd) { bd = d; best = tw; }
    });
    return best;
  }

  /* ══════════ 찾아간다 ══════════ */
  function visit(tw) {
    tw = tw || nearTown();
    if (!tw) { U.toast('가까이에 이웃의 도읍이 없습니다.', 'warn', 2400); return; }
    GM.net.send('visitNation', { nationId: tw.nationId }, function (res) {
      if (!res || !res.ok) {
        U.toast((res && res.error && res.error.message) || '지금은 찾아갈 수 없습니다.', 'warn');
        return;
      }
      if (res.first) {
        U.toast(res.name + '의 문이 열렸습니다 — 이제 그곳의 값이 보입니다.', 'good', 4200);
        GM.sfx.play('unlock');
      }
      open(res);
    });
  }

  /* ══════════ 방문 화면 ══════════ */
  function open(brief) {
    if (!brief) return null;
    var body = U.el('div', 'nation-panel');
    body.appendChild(head(brief));
    if (brief.concept) body.appendChild(U.el('p', 'hint', brief.concept));
    tagRow(body, brief.tagNames);
    priceTable(body, brief.prices);

    var foot = U.el('div');
    foot.appendChild(U.btn('물러난다', 'btn-ghost', function () { U.closeTopModal(); }));
    var deal = U.btn('교역한다', 'btn-primary', function () {
      U.closeTopModal();
      GM.ministry.open('trade');
    });
    deal.id = 'nation-trade';
    deal.setAttribute('data-visit-trade', brief.nationId);
    foot.appendChild(deal);

    return U.openModal({
      title: brief.name, body: body, footer: foot, width: '600px',
      key: 'nation:' + brief.nationId, icon: GM.icons.img('ship', 22)
    });
  }

  function head(brief) {
    var sp = U.el('div', 'speech');
    sp.appendChild(GM.icons.img('ship', 40));
    var sb = U.el('div', 'sp-body');
    sb.appendChild(U.el('span', 'sp-who', brief.name));
    sb.appendChild(U.el('div', 'sp-line', '문 앞까지 걸어와 인사를 나누었습니다.'));
    sp.appendChild(sb);
    return sp;
  }

  /** 그 땅이 품은 것 — 찾아가 눈으로 봤으니 이제 안다 */
  function tagRow(body, names) {
    if (!names || !names.length) return;
    body.appendChild(U.el('h3', 'sec-title', '그 땅이 품은 것'));
    var row = U.el('div', 'ctx-acts');
    names.forEach(function (nm) { row.appendChild(U.el('span', 'chip', nm)); });
    body.appendChild(row);
  }

  /** 그곳의 값 · 우리 값 — 두 줄을 나란히 두어야 어느 쪽이 이(利)인지 보인다 */
  function priceTable(body, prices) {
    if (!prices) { body.appendChild(U.el('p', 'hint', '아직 그곳의 값을 듣지 못했습니다.')); return; }
    body.appendChild(U.el('h3', 'sec-title', '그곳의 값'));
    var tbl = U.el('div', 'price-rows');
    var mine = (S.S.view && S.S.view.market && S.S.view.market.local) || {};
    S.RESOURCES.forEach(function (r) {
      if (prices[r.key] == null) return;
      tbl.appendChild(priceRow(r, prices[r.key], mine[r.key]));
    });
    body.appendChild(tbl);
  }

  function priceRow(r, there, here) {
    var row = U.row();
    row.appendChild(GM.icons.img(GM.icons.resIcon(r.key), 18));
    row.appendChild(U.el('span', 'row-name', r.name));
    row.appendChild(U.el('span', 'row-cost', U.fmt(there, 2)));
    if (here && here.price != null) {
      row.appendChild(U.el('span', 'row-cost', '우리 ' + U.fmt(here.price, 2)));
    }
    return row;
  }

  function invalidate() { memo.t = 0; memo.val = null; }

  GM.diplomacy = { nearTown: nearTown, visit: visit, open: open, invalidate: invalidate };
})(window);
