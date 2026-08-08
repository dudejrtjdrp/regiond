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
      greet(res);
    });
  }

  /* ★ §17-19(D-5) — 문 앞에서 인사 한마디를 먼저 나누고, 첩(帖)은 그다음에 편다.
     「왜」 표를 곧장 안 펴나 — 여태 남의 나라에 걸어 들어가는 일이 시세표 한 장으로 끝났다.
     한 줄이라도 사람의 말이 앞에 서면 「찾아갔다」가 되고, 표는 그 뒤의 용건이 된다.
     대화창이 없는 자리(구경 모드 등)에서는 옛길 그대로 첩부터 편다. */
  function greet(brief) {
    if (!GM.dialogue) return open(brief);
    return GM.dialogue.open({
      speaker: brief.name, portraitKey: 'icon:ship', lines: [greetLine(brief)],
      choices: [{ label: '첩을 펼친다', act: function () { open(brief); } },
                { label: '오늘은 물러난다' }]
    });
  }

  function greetLine(brief) {
    if (brief.first) return '먼 길을 오셨습니다. 우리 문을 여니, 값도 함께 열어 드리지요.';
    return '또 오셨군요. 오늘의 값은 그대로입니다 — 보시겠습니까.';
  }

  /* ══════════ 방문 화면 ══════════ */
  function open(brief) {
    if (!brief) return null;
    var body = U.el('div', 'nation-panel');
    body.appendChild(head(brief));
    if (brief.concept) body.appendChild(U.el('p', 'hint', brief.concept));
    relationRow(body, brief.relation);
    tagRow(body, brief.tagNames);
    profileRow(body, brief.tradeProfile);
    priceTable(body, brief.prices);

    var foot = U.el('div');
    foot.appendChild(U.btn('물러난다', 'btn-ghost', function () { U.closeTopModal(); }));
    var deal = U.btn('교역한다', 'btn-primary', function () {
      U.closeTopModal();
      /* ★ §19-F3(F07-7) — 문 앞에서 곧바로 그 나라의 좌판으로. 좌판이 아직 없으면 옛길(집무실)로 간다. */
      if (GM.ministry.openPartner(brief.nationId)) return;
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

  /* ★ §세계관 W4 — 관계 결. 점수 게이지 한 줄 + 지금의 호칭. 셈은 전부 서버가 했다. */
  function relationRow(body, rel) {
    if (!rel) return;
    body.appendChild(U.el('h3', 'sec-title', '우리 사이'));
    var row = U.el('div', 'ctx-acts');
    row.appendChild(U.el('span', 'chip', rel.title || ''));
    var bar = U.el('div', 'meter');
    bar.style.cssText = 'flex:1;height:8px;background:#2a2620;border-radius:4px;overflow:hidden;align-self:center';
    var fill = U.el('div', '');
    fill.style.cssText = 'height:100%;width:' + Math.round(rel.score) + '%;background:#8fe3b4';
    bar.appendChild(fill);
    row.appendChild(bar);
    var label = rel.nextAt != null ? Math.round(rel.score) + ' / 다음 문턱 ' + rel.nextAt : String(Math.round(rel.score));
    row.appendChild(U.el('span', 'hint', label));
    body.appendChild(row);
  }

  /** 그 땅이 품은 것 — 찾아가 눈으로 봤으니 이제 안다 */
  function tagRow(body, names) {
    if (!names || !names.length) return;
    body.appendChild(U.el('h3', 'sec-title', '그 땅이 품은 것'));
    var row = U.el('div', 'ctx-acts');
    names.forEach(function (nm) { row.appendChild(U.el('span', 'chip', nm)); });
    body.appendChild(row);
  }

  /* ★ §19-F3(F07-7) — 이 나라의 성정이 곧 값이다: 무엇을 헐값에 내주고 무엇을 후하게 사는가.
     여기 한 줄이 「왜 여기까지 걸어왔는가」의 답이 된다. */
  function profileRow(body, prof) {
    if (!prof) return;
    var rows = [['헐값에 내주는 것', prof.exports], ['후하게 사는 것', prof.demands]];
    rows.forEach(function (pair) {
      if (!pair[1] || !pair[1].length) return;
      body.appendChild(U.el('h3', 'sec-title', pair[0]));
      var row = U.el('div', 'ctx-acts');
      pair[1].forEach(function (x) {
        row.appendChild(U.el('span', 'chip', x.name + ' ×' + U.fmt(x.factor, 2)));
      });
      body.appendChild(row);
    });
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

  GM.diplomacy = { nearTown: nearTown, visit: visit, greet: greet, open: open, invalidate: invalidate };
})(window);
