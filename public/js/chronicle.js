/* chronicle.js — 연대기 (GDD3 §5, 시즌 결산의 자리를 대신한다).
   정착지가 지나온 길을 두루마리로 펼친다 — 티어업·웨이브·완공·유물·주민.
   끝이 없는 게임이라 '결산'은 없다. 대신 언제 열어도 여기까지 온 길이 보인다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var KIND = {
    tier_up: { name: '성장', icon: 'tier', color: '#e8a33d' },
    wave: { name: '침공', icon: 'swords', color: '#bc4749' },
    building: { name: '완공', icon: 'hammer', color: '#c8965a' },
    resident: { name: '사람', icon: 'person', color: '#6a994e' },
    artifact: { name: '유물', icon: 'gem', color: '#8367a8' },
    emotion_day: { name: '감정의 날', icon: 'crown', color: '#4a6fa5' }
  };

  function kindOf(k) { return KIND[k] || { name: '기록', icon: 'scroll', color: '#9c8f76' }; }

  function open() {
    var body = U.el('div');
    body.id = 'chronicle-body';
    paint(body);
    var foot = U.el('div');
    foot.appendChild(U.btn('닫는다', 'btn-primary', function () { U.closeTopModal(); }));
    GM.net.send('requestChronicle', {});
    return U.openModal({ title: '연대기', body: body, footer: foot, width: '720px',
                         key: 'chronicle', icon: GM.icons.img('book', 22) });
  }

  function paint(host) {
    U.clear(host);
    var c = S.chronicle();
    if (!c) { host.appendChild(U.el('p', 'empty', '아직 적을 것이 없습니다.')); return; }

    var head = U.el('div', 'chr-head');
    head.appendChild(U.el('span', 'chr-title', (c.tierName || '야영지') + ' · ' + (c.day || 0) + '일째'));
    host.appendChild(head);

    var t = c.totals || {};
    var grid = U.el('div', 'stat-grid');
    stat(grid, '지나온 날', U.fmt(t.days, 0) + '일');
    stat(grid, '사는 사람', U.fmt(t.population, 0) + '명', t.peakPopulation ? '가장 많았을 때 ' + U.fmt(t.peakPopulation, 0) + '명' : null);
    stat(grid, '세운 건물', U.fmt(t.structures, 0) + '채');
    stat(grid, '두른 울타리', U.fmt(t.fences, 0) + '조각');
    stat(grid, '맞선 무리', U.fmt(t.wavesFaced, 0) + '번', t.wavesHeld != null ? U.fmt(t.wavesHeld, 0) + '번 막아 냈다' : null);
    if (t.gold) stat(grid, '금화', U.fmt(t.gold, 0));
    if (t.artifacts) stat(grid, '유물', U.fmt(t.artifacts, 0) + '점');
    if (t.prestige) stat(grid, '위신', U.fmt(t.prestige, 0));
    host.appendChild(grid);

    host.appendChild(U.el('h3', 'sec-title', '지나온 길'));
    var list = (c.entries || []).slice().reverse();
    if (!list.length) {
      host.appendChild(U.el('p', 'empty', '아직 적을 것이 없습니다. 첫 나무를 베는 것부터가 기록입니다.'));
      return;
    }
    var wrap = U.el('div', 'chr-list');
    list.slice(0, 60).forEach(function (e) {
      var k = kindOf(e.kind);
      var row = U.el('div', 'chr-row');
      row.setAttribute('data-kind', e.kind);
      var badge = U.el('span', 'chr-day');
      badge.textContent = (e.tick != null ? e.tick + '일' : '');
      row.appendChild(badge);
      row.appendChild(GM.icons.img(k.icon, 22));
      var col = U.el('div', 'chr-col');
      col.appendChild(U.el('span', 'chr-t', e.title || k.name));
      if (e.text) col.appendChild(U.el('span', 'chr-s', e.text));
      row.appendChild(col);
      wrap.appendChild(row);
    });
    host.appendChild(wrap);
  }

  function stat(grid, name, val, sub) {
    var c = U.el('div', 'stat');
    c.appendChild(U.el('span', 's-name', name));
    c.appendChild(U.el('span', 'num s-val', val));
    if (sub) c.appendChild(U.el('span', 's-sub', sub));
    grid.appendChild(c);
  }

  function update() {
    var host = U.qs('#chronicle-body');
    if (host && U.modalOpen('chronicle')) paint(host);
  }

  GM.chronicle = { open: open, update: update };
})(window);
