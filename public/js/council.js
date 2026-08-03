/* council.js — 어전 회의(두루마리 모달) · 어전 안건 카드 · 침공 판정 연출 · 소식 두루마리
   기획: 로그인했을 때 먼저 보이는 것은 보고서가 아니라 "판단"이어야 한다 → 안건은 알림 스택 맨 위에 선다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var KIND_KO = {
    trade_offer: '상단의 제안', invasion: '성문 앞의 일', budget: '나라 살림', disaster: '재해',
    diplomacy: '이웃과의 일', council: '어전 안건', build: '공사'
  };
  var OPT_KO = {
    accept: '받아들인다', reject: '물린다', defer: '미뤄 둔다', ignore: '넘긴다',
    yes: '그리한다', no: '하지 않는다', grain: '곡물', wall: '성벽', granary: '곡창',
    buy: '산다', sell: '판다', ok: '알겠다'
  };

  function normDecision(d) {
    return {
      id: d.decisionId || d.id,
      kind: KIND_KO[d.kind] || d.title || d.kind || '어전 안건',
      title: d.title || KIND_KO[d.kind] || '어전 안건',
      text: d.text || d.title || d.summary || '판단이 필요합니다.',
      due: d.expiresTick !== undefined ? d.expiresTick
        : (d.offer && d.offer.expiresTick !== undefined ? d.offer.expiresTick
        : (d.dueTick !== undefined ? d.dueTick : null)),
      urgent: !!(d.urgent || d.kind === 'invasion' || d.priority === 'high'),
      offer: d.offer || null,
      choices: normChoices(d.choices || d.options)
    };
  }
  function normChoices(list) {
    if (!list || !list.length) return [{ key: 'ok', label: '알겠다' }];
    return list.map(function (c, i) {
      if (typeof c === 'string') return { key: c, label: OPT_KO[c] || c };
      var k = c.key || c.id || c.value || String(i);
      return { key: k, label: c.label || c.text || c.name || OPT_KO[k] || String(k) };
    });
  }

  /* 결과 미리보기 한 줄 — 상단 제안이면 수치를 미리 셈해 보여 준다 */
  function previewOf(dd) {
    var o = dd.offer;
    if (!o) return null;
    var rm = S.resourceMeta(o.resource);
    var money = U.fmt((o.amount || 0) * (o.price || 0), 0);
    return o.side === 'buy'
      ? '받아들이면: ' + rm.name + ' −' + U.fmt(o.amount, 0) + ', 국고 +' + money
      : '받아들이면: ' + rm.name + ' +' + U.fmt(o.amount, 0) + ', 국고 −' + money;
  }

  function decisionCard(d, onDone) {
    var dd = normDecision(d);
    var c = U.el('div', 'agenda' + (dd.urgent ? ' urgent' : ''));
    c.setAttribute('data-decision', dd.id);
    var head = U.el('div', 'ag-head');
    head.appendChild(U.el('span', null, dd.kind));
    if (dd.due !== null) head.appendChild(U.el('span', null, dd.due + '일까지'));
    c.appendChild(head);
    c.appendChild(U.el('div', 'ag-body', dd.text));
    var pv = previewOf(dd);
    if (pv) c.appendChild(U.el('span', 'ag-preview', pv));

    var box = U.el('div', 'ag-choices');
    dd.choices.forEach(function (ch, i) {
      var b = U.btn(ch.label, i === 0 ? 'btn-primary' : '', function () {
        GM.net.send('decide', { decisionId: dd.id, choice: ch.key });
        GM.sfx.play('page');
        c.style.opacity = '.45';
        U.qsa('button', c).forEach(function (x) { x.disabled = true; });
        if (onDone) onDone(dd.id);
      });
      b.setAttribute('data-choice', ch.key);
      box.appendChild(b);
    });
    c.appendChild(box);
    return c;
  }

  /* 알림에서 안건 하나만 펼치기 */
  function openDecision(d) {
    var dd = normDecision(d);
    var body = U.el('div');
    var sp = U.el('div', 'speech');
    var who = dd.kind === '상단의 제안' ? 'trade' : dd.kind === '성문 앞의 일' ? 'defense' : 'build';
    sp.appendChild(GM.icons.portraitImg(who, 58, 'agenda'));
    var sb = U.el('div', 'sp-body');
    sb.appendChild(U.el('span', 'sp-who', S.roleMeta(who).name));
    sb.appendChild(U.el('div', 'sp-line', '전하, 결정을 기다립니다.'));
    sp.appendChild(sb);
    body.appendChild(sp);
    var m = null;
    body.appendChild(decisionCard(d, function () { setTimeout(function () { U.closeModal(m); }, 500); }));
    var foot = U.el('div');
    foot.appendChild(U.btn('나중에 본다', 'btn-ghost', function () { U.closeModal(m); }));
    m = U.openModal({ title: dd.title, body: body, footer: foot, width: '600px',
                      key: 'decision:' + dd.id, icon: GM.icons.img('scroll', 22) });
  }

  /* ══════════ 어전 회의 ══════════ */
  function openCouncil(c) {
    var body = U.el('div');

    var metrics = summaryMetrics(c.summary);
    if (metrics) body.appendChild(metrics);

    body.appendChild(U.el('h3', 'sec-title', '각료의 보고'));
    var speeches = normSummary(c.summary, c.agenda);
    var speechBox = U.el('div');
    body.appendChild(speechBox);

    if (c.agenda && c.agenda.length) {
      body.appendChild(U.el('h3', 'sec-title', '오늘의 안건'));
      var sc = U.el('div', 'scroll-card');
      var ul = U.el('ul');
      (Array.isArray(c.agenda) ? c.agenda : [c.agenda]).forEach(function (a) {
        ul.appendChild(U.el('li', null, typeof a === 'string' ? a : (a.text || a.title || '')));
      });
      sc.appendChild(ul);
      body.appendChild(sc);
    }

    var decs = c.decisions || [];
    if (decs.length) {
      body.appendChild(U.el('h3', 'sec-title', '결정'));
      var dbox = U.el('div');
      decs.forEach(function (d) { dbox.appendChild(decisionCard(d)); });
      body.appendChild(dbox);
    }

    var chestHost = U.el('div');
    body.appendChild(chestHost);

    var foot = U.el('div');
    var close = U.btn('회의를 마친다', 'btn-primary');
    close.id = 'council-close';
    foot.appendChild(close);

    var modal = U.openModal({
      title: '어전 회의', body: body, footer: foot, width: '800px', key: 'council',
      icon: GM.icons.img('crown', 22),
      onClose: function () { if (c.councilId) GM.net.send('councilAck', { councilId: c.councilId }); }
    });
    close.onclick = function () { U.closeModal(modal); };

    typeSpeeches(speechBox, speeches, function () {
      if (c.artifactDrop) {
        chestHost.appendChild(U.el('h3', 'sec-title', '땅이 내어준 것'));
        GM.artifacts.openChest(c.artifactDrop, chestHost, function () {
          U.toast('유물을 찾았습니다.', 'good', 4600);
        });
      }
    });
    return modal;
  }

  function summaryMetrics(sum) {
    if (!sum || typeof sum !== 'object' || Array.isArray(sum)) return null;
    if (sum.population === undefined && sum.gold === undefined && sum.resources === undefined) return null;
    var wrap = U.el('div');
    wrap.appendChild(U.el('h3', 'sec-title', '나라 형편'));
    var g = U.el('div', 'stat-grid');
    function card(name, val, sub) {
      var c = U.el('div', 'stat');
      c.appendChild(U.el('span', 's-name', name));
      c.appendChild(U.el('span', 'num s-val', val));
      if (sub) c.appendChild(U.el('span', 's-sub', sub));
      g.appendChild(c);
    }
    if (sum.population !== undefined) card('백성', U.fmt(sum.population, 0) + '명',
      sum.populationCap ? '최대 ' + U.fmt(sum.populationCap, 0) : null);
    if (sum.morale !== undefined) card('민심', U.fixed(sum.morale, 2), null);
    if (sum.gold !== undefined) card('국고', U.fmt(sum.gold, 0), null);
    if (sum.defense) card('성문 앞', U.fmt((sum.defense.permanent || 0) + (sum.defense.surge || 0), 0),
      '굳은 ' + U.fmt(sum.defense.permanent, 0) + ' + 모은 ' + U.fmt(sum.defense.surge, 0));
    if (sum.resources) {
      S.RESOURCES.forEach(function (r) {
        if (sum.resources[r.key] === undefined) return;
        card(r.name, U.fmt(sum.resources[r.key], 0), null);
      });
    }
    wrap.appendChild(g);
    return wrap;
  }

  function normSummary(sum, agenda) {
    if (!sum) return [];
    if (typeof sum === 'string') return [{ role: null, text: sum }];
    if (Array.isArray(sum)) {
      return sum.map(function (s0) {
        if (typeof s0 === 'string') return { role: null, text: s0 };
        return { role: s0.role || s0.who || null, text: s0.text || s0.line || s0.message || '' };
      });
    }
    if (sum.roles) {
      var AGENDA_ROLE = { invasion: 'defense', budget: 'trade', build: 'build',
                          trade: 'trade', disaster: 'farm', diplomacy: 'trade' };
      var byRole = {}, leftover = [];
      (agenda || []).forEach(function (a) {
        var kind = (typeof a === 'object' && a.kind) ? a.kind : null;
        var txt = (typeof a === 'string') ? a : (a.text || '');
        var rk = AGENDA_ROLE[kind];
        if (rk && !byRole[rk]) byRole[rk] = txt; else leftover.push(txt);
      });
      var lines = [];
      S.ROLES.forEach(function (r) {
        var info = sum.roles[r.key];
        if (!info) return;
        var who = info.npcName ? (info.npcName + ' ' + r.name) : r.name;
        var t;
        if (!info.holder) t = '(이 자리는 비어 있습니다 — ' + r.vacancy + ')';
        else {
          t = byRole[r.key] || GM.hud.brief(r.key, S.nation());
          if (leftover.length && !byRole[r.key]) t = leftover.shift();
        }
        lines.push({ role: r.key, who: who, text: t });
      });
      return lines;
    }
    return Object.keys(sum).map(function (k) { return { role: k, text: String(sum[k]) }; });
  }

  function typeSpeeches(host, list, onDone) {
    var i = 0;
    function next() {
      if (i >= list.length) { if (onDone) onDone(); return; }
      var s = list[i++];
      var row = U.el('div', 'speech');
      row.appendChild(GM.icons.portraitImg(s.role || 'build', 58, 'council'));
      var b = U.el('div', 'sp-body');
      b.appendChild(U.el('span', 'sp-who', s.who || (s.role ? S.roleMeta(s.role).name : '신하')));
      var line = U.el('div', 'sp-line typing');
      b.appendChild(line);
      row.appendChild(b);
      host.appendChild(row);

      var full = s.text || '', k = 0;
      var iv = setInterval(function () {
        k += 2;
        line.textContent = full.slice(0, k);
        if (k >= full.length) {
          clearInterval(iv);
          line.classList.remove('typing');
          setTimeout(next, 200);
        }
      }, 18);
    }
    next();
  }

  /* ══════════ 침공 판정 — 연출은 월드 위 타워디펜스 리플레이(combat.js)가 맡는다 ══════════ */
  function openInvasionResult(r) {
    return GM.combat.onResult(r);
  }

  /* ══════════ 소식 두루마리 (치세 보고서 + 사건 기록) ══════════ */
  function openChronicle() {
    var body = U.el('div');
    var r = S.S.report;
    if (r) {
      body.appendChild(U.el('h3', 'sec-title', '자리를 비운 사이'));
      var sc = U.el('div', 'scroll-card');
      var ul = U.el('ul');
      (r.lines || []).forEach(function (l) { ul.appendChild(U.el('li', null, l)); });
      sc.appendChild(ul);
      body.appendChild(sc);
      if (r.deltas) {
        var g = U.el('div', 'stat-grid');
        Object.keys(r.deltas).forEach(function (k) {
          var c = U.el('div', 'stat');
          c.appendChild(U.el('span', 's-name', labelOf(k)));
          var v = r.deltas[k];
          var vs = U.el('span', 'num s-val', typeof v === 'number' ? U.signed(v, 0) : String(v));
          vs.style.color = (typeof v === 'number' && v < 0) ? '#7d2a2c' : '#446b32';
          c.appendChild(vs);
          g.appendChild(c);
        });
        body.appendChild(g);
      }
    }
    body.appendChild(U.el('h3', 'sec-title', '요즘 소식'));
    var evs = S.S.events || [];
    if (!evs.length) body.appendChild(U.el('div', 'empty', '조용합니다.'));
    else {
      var list = U.el('div', 'rowlist');
      evs.slice(0, 60).forEach(function (e) {
        var row = U.row();
        row.appendChild(U.el('span', 'row-name', (e.tick !== undefined ? e.tick + '일' : '—')));
        row.appendChild(U.el('span', 'row-cost', e.text || ''));
        list.appendChild(row);
      });
      body.appendChild(list);
    }
    var foot = U.el('div');
    foot.appendChild(U.btn('덮는다', 'btn-primary', function () { U.closeTopModal(); }));
    U.openModal({ title: '나라의 기록', body: body, footer: foot, width: '660px', key: 'chronicle',
                  icon: GM.icons.img('scroll', 22) });
  }
  function labelOf(k) {
    if (k === 'gold') return '국고';
    if (k === 'population') return '백성';
    if (k === 'morale') return '민심';
    return S.resourceMeta(k).name;
  }

  GM.council = {
    openCouncil: openCouncil, openDecision: openDecision, openInvasionResult: openInvasionResult,
    decisionCard: decisionCard, openChronicle: openChronicle
  };
})(window);
