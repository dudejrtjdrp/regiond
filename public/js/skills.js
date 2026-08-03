/* skills.js — 개인 솜씨 다섯 가지 (GDD3 §3). 티어 3(panel.skills)부터 열린다.
   스윙마다 오르고, 오를수록 손이 빨라지고(쿨 −3%/단) 거두는 몫이 늘어난다(+5%/단).
   특정 단에서 도구가 열린다 — 스윙당 획득이 곱절이 된다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  function open() {
    if (!S.uiOn('panel.skills')) { U.toast('아직 솜씨를 헤아릴 때가 아닙니다.', 'warn'); return; }
    var body = U.el('div');
    body.id = 'skills-body';
    paint(body);
    var foot = U.el('div');
    foot.appendChild(U.btn('닫는다', 'btn-primary', function () { U.closeTopModal(); }));
    var m = U.openModal({ title: '내 솜씨', body: body, footer: foot, width: '640px',
                          key: 'skills', icon: GM.icons.img('tools', 22) });
    return m;
  }

  function paint(host) {
    U.clear(host);
    var p = S.player();
    if (!p) { host.appendChild(U.el('p', 'empty', '아직 헤아릴 것이 없습니다.')); return; }

    var head = U.el('p', 'hint',
      '정착지가 커지면 손도 빨라집니다 — 지금 단계의 덕은 +' + U.pct(p.tierSpeedBonus || 0, 0) + '입니다.');
    host.appendChild(head);

    S.SKILLS.forEach(function (meta) {
      var sk = (p.skills && p.skills[meta.key]) || null;
      var card = U.el('div', 'skill-card');
      card.setAttribute('data-skill', meta.key);
      var top = U.el('div', 'sk-top');
      top.appendChild(GM.icons.img(meta.icon, 26));
      top.appendChild(U.el('span', 'sk-n', meta.name));
      top.appendChild(U.el('span', 'sk-lv', (sk ? sk.level : 1) + '단'));
      card.appendChild(top);

      if (sk) {
        var g = U.makeGauge({ height: 15, color: meta.color });
        var nx = sk.next;
        if (nx && nx.need) {
          var base = nx.need - (nx.remaining || 0);
          g.setValue(U.clamp((nx.have - (nx.have - base)) / Math.max(1, nx.need - (nx.have - base)), 0, 1),
            U.fmt(nx.have, 0) + ' / ' + U.fmt(nx.need, 0),
            meta.name + ' ' + sk.level + '단', '다음 단까지 ' + U.fmt(nx.remaining, 0) + ' 남았습니다.');
        } else {
          g.setValue(1, '다 익혔다', meta.name, '더 오를 곳이 없습니다.');
        }
        card.appendChild(g);

        var facts = U.el('div', 'sk-facts');
        facts.appendChild(fact('스윙 간격', U.fmt(sk.cooldownSec, 2) + '초'));
        facts.appendChild(fact('거두는 몫', '×' + U.fmt(sk.yieldMultiplier, 2)));
        if (sk.tool) facts.appendChild(fact('도구', sk.tool.name + ' ×' + U.fmt(sk.tool.multiplier, 1)));
        card.appendChild(facts);

        if (sk.nextTool) {
          card.appendChild(U.el('p', 'sk-next',
            sk.nextTool.level + '단에 ' + sk.nextTool.name + ' — 스윙당 ×' + U.fmt(sk.nextTool.multiplier, 1)));
        }
      }
      host.appendChild(card);
    });

    var st = p.stats || {};
    var sum = U.el('div', 'sk-sum');
    sum.appendChild(U.el('span', null, '휘두른 횟수 ' + U.fmt(st.swings || 0, 0)));
    if (st.kills) sum.appendChild(U.el('span', null, '쓰러뜨린 적 ' + U.fmt(st.kills, 0)));
    var got = st.gathered || {};
    var parts = [];
    S.RESOURCES.forEach(function (r) { if (got[r.key] > 0) parts.push(S.resourceMeta(r.key).name + ' ' + U.fmt(got[r.key], 0)); });
    if (parts.length) sum.appendChild(U.el('span', null, '거둔 것 ' + parts.join(' · ')));
    host.appendChild(sum);
  }

  function fact(k, v) {
    var s = U.el('span', 'sk-fact');
    s.appendChild(U.el('b', null, k + ' '));
    s.appendChild(U.el('span', null, v));
    return s;
  }

  function update() {
    var host = U.qs('#skills-body');
    if (host && U.modalOpen('skills')) paint(host);
  }

  GM.skills = { open: open, update: update };
})(window);
