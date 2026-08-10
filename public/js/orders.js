/* orders.js — 국법(칙령) 편집기. "만약 [곡물]이 [100] [이상]이면 → [내다 판다]" 자연어 문장 빌더.
   화면에는 문장만 보이지만, 서버로 보내는 형식은 docs/PROTOCOL.md 의 조건 트리 그대로다:
     비교 {type:'cmp', metric, op, value} / 논리 {type:'and'|'or', children:[좌, 우]} (좌결합)
   사람이 읽는 원문(text)도 함께 실어 보낸다 — 서버 폴백 파서용. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var METRICS = [
    { key: 'resource.grain',   name: '곡물' },
    { key: 'resource.wood',    name: '목재' },
    { key: 'resource.stone',   name: '석재' },
    { key: 'resource.ironOre', name: '철광석' },
    { key: 'resource.oil',     name: '원유' },
    { key: 'resource.steel',   name: '강재' },
    { key: 'resource.fuel',    name: '연료' },
    { key: 'gold',               name: '국고' },
    { key: 'invasion.daysUntil', name: '침공까지 남은 날' },
    { key: 'tick',               name: '지나간 날수' },
    { key: 'population',         name: '백성 수' },
    { key: 'defense.total',      name: '성문 앞 힘' }
  ];
  var OPS = [
    { key: '>=', name: '이상이면' },
    { key: '>',  name: '넘으면' },
    { key: '<=', name: '이하면' },
    { key: '<',  name: '밑돌면' },
    { key: '==', name: '딱 그만큼이면' }
  ];
  var JOINS = [{ key: 'AND', name: '그리고' }, { key: 'OR', name: '또는' }];

  var ACTIONS = [
    { key: 'TRADE',        name: '내다 판다',           args: ['resource', 'amount'], side: 'sell' },
    { key: 'TRADE_BUY',    name: '사들인다',            args: ['resource', 'amount'], side: 'buy', real: 'TRADE' },
    { key: 'QUEUE_SWITCH', name: '공방을 돌린다',        args: ['output'] },
    { key: 'CONVERT',      name: '가공한다',            args: ['output'] },
    { key: 'TRANSFER',     name: '곳간으로 옮긴다',      args: ['resource', 'amount'] },
    { key: 'DEFEND',       name: '백성을 수비에 붙인다',  args: ['allocPct'] }
  ];
  var OUTPUTS = [
    { key: 'steel', name: '강재 만들기' },
    { key: 'fuel', name: '연료 만들기' },
    { key: 'weapon', name: '무기 제작' }
  ];

  var draft = [];
  var dragIdx = -1;
  var host = null;

  function seq() { return 'l' + Date.now().toString(36) + Math.floor(Math.random() * 999).toString(36); }

  function blank() {
    return {
      id: null, uid: seq(), enabled: true,
      terms: [{ metric: 'resource.grain', op: '>=', value: 150, join: null }],
      action: { key: 'TRADE', args: { side: 'sell', resource: 'grain', amount: 'surplus' } }
    };
  }

  /* ── 서버 형식 ↔ 편집 모델 ────────────────────────── */
  function fromServer(list) {
    return (list || []).map(function (o) {
      var m = { id: o.id || null, uid: seq(), enabled: o.enabled !== false, priority: o.priority,
                terms: flatten(o.condition), action: normAction(o.action) };
      if (!m.terms.length) m.terms = [{ metric: 'resource.grain', op: '>=', value: 150, join: null }];
      return m;
    });
  }
  function flatten(c, joinIn) {
    if (!c) return [];
    var t = String(c.type || '').toLowerCase();
    if (t === 'and' || t === 'or' || t === 'logic') {
      var jt = (t === 'or' || String(c.op || '').toUpperCase() === 'OR') ? 'OR' : 'AND';
      var kids = c.children || c.terms || c.nodes;
      if (!kids) kids = [c.left, c.right].filter(function (x) { return !!x; });
      var out = [];
      kids.forEach(function (k, i) { out = out.concat(flatten(k, i === 0 ? (joinIn || null) : jt)); });
      return out;
    }
    return [{ metric: c.metric || 'resource.grain', op: c.op || '>=',
              value: (c.value !== undefined ? c.value : 0), join: joinIn || null }];
  }
  function normAction(a) {
    if (!a) return { key: 'QUEUE_SWITCH', args: { output: 'steel' } };
    var type = (typeof a === 'string') ? a : (a.type || a.kind || 'QUEUE_SWITCH');
    var args = (typeof a === 'string') ? {} : (a.args || a.params || {});
    var key = type;
    if (type === 'TRADE') key = (args.side === 'buy') ? 'TRADE_BUY' : 'TRADE';
    return { key: key, args: JSON.parse(JSON.stringify(args)) };
  }
  function actDef(key) {
    for (var i = 0; i < ACTIONS.length; i++) if (ACTIONS[i].key === key) return ACTIONS[i];
    return ACTIONS[0];
  }
  function toAST(terms) {
    if (!terms.length) return null;
    var node = leaf(terms[0]);
    for (var i = 1; i < terms.length; i++) {
      node = { type: (terms[i].join === 'OR' ? 'or' : 'and'), children: [node, leaf(terms[i])] };
    }
    return node;
  }
  function leaf(t) { return { type: 'cmp', metric: t.metric, op: t.op, value: Number(t.value) }; }

  function realAction(o) {
    var def = actDef(o.action.key);
    var type = def.real || def.key;
    var args = JSON.parse(JSON.stringify(o.action.args || {}));
    if (type === 'TRADE') args.side = def.side || 'sell';
    if (type === 'TRADE' && args.side === 'buy' && args.amount === 'surplus') args.amount = 10;
    return { type: type, args: args };
  }

  function dsl(o) {
    var s = 'IF ';
    o.terms.forEach(function (t, i) {
      if (i) s += ' ' + (t.join || 'AND') + ' ';
      s += t.metric + ' ' + t.op + ' ' + t.value;
    });
    var a = realAction(o);
    var def = actDef(o.action.key);
    var vals = (def.args || []).map(function (k) {
      if (k === 'resource') return a.args.resource;
      if (k === 'output') return a.args.output;
      if (k === 'amount') return a.args.amount;
      if (k === 'allocPct') return a.args.allocPct;
      return '';
    });
    if (a.type === 'TRADE') vals = [a.args.side, a.args.resource, a.args.amount];
    return s + ' THEN ' + a.type + '(' + vals.join(', ') + ')';
  }

  /* 사람이 읽는 한 문장 */
  function readable(o) {
    var parts = [];
    o.terms.forEach(function (t, i) {
      var mn = nameOf(METRICS, t.metric);
      var opn = nameOf(OPS, t.op);
      if (i) parts.push(nameOf(JOINS, t.join || 'AND'));
      parts.push(mn + U.josa(mn, '이', '가') + ' ' + U.fmt(t.value, 0) + ' ' + opn);
    });
    var def = actDef(o.action.key);
    var a = o.action.args || {};
    var tail = def.name;
    if (def.args.indexOf('resource') >= 0) tail = S.resourceMeta(a.resource || 'grain').name + '을(를) ' + def.name;
    if (def.args.indexOf('output') >= 0) tail = nameOf(OUTPUTS, a.output || 'steel') + '(으)로 ' + def.name;
    if (def.args.indexOf('amount') >= 0) {
      tail = (a.amount === 'surplus' ? '남는 만큼 ' : U.fmt(a.amount, 0) + '만큼 ') + tail;
    }
    if (def.args.indexOf('allocPct') >= 0) tail = (a.allocPct === undefined ? 40 : a.allocPct) + '%의 ' + def.name;
    return '만약 ' + parts.join(' ') + ', 그러면 ' + tail + '.';
  }
  function nameOf(list, key) {
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i].name;
    return String(key);
  }

  /* ══════════ 화면 ══════════ */
  function open() {
    if (!S.uiOn('panel.orders')) { U.toast('국법은 읍이 되어야 적을 수 있습니다.', 'warn'); return; }
    if (!draft.length) draft = fromServer((S.nation() || {}).orders);
    if (!draft.length) draft = [blank()];

    var body = U.el('div');
    body.appendChild(U.el('p', null,
      '그대가 자리를 비운 사이 섭정이 이 문장대로 나라를 굴립니다. 위에 적힌 국법이 먼저 지켜집니다.'));

    var btns = U.el('div', 'labor-btns');
    var add = U.btn('＋ 조항을 더한다', '', function () { draft.push(blank()); renderList(); });
    add.id = 'law-add';
    var reload = U.btn('반포된 국법 불러오기', 'btn-ghost', function () {
      draft = fromServer((S.nation() || {}).orders);
      if (!draft.length) draft = [blank()];
      renderList();
      U.toast('지금 지켜지고 있는 국법을 불러왔습니다.', 'good');
    });
    reload.id = 'law-reload';
    btns.appendChild(add); btns.appendChild(reload);
    body.appendChild(btns);

    host = U.el('div');
    host.id = 'law-list';
    body.appendChild(host);
    renderList();

    var foot = U.el('div');
    var save = U.btn('국법으로 반포한다', 'btn-primary', save0);
    save.id = 'law-save';
    U.tipSet(save, '적어 둔 조항 전부를 새 국법으로 세웁니다',
      '반포하면 다음 날부터 섭정이 이 순서대로 움직입니다. 옛 국법은 지워집니다.');
    foot.appendChild(U.btn('닫는다', 'btn-ghost', function () { U.closeTopModal(); }));
    foot.appendChild(save);

    U.openModal({ title: '국법 — 그대가 없을 때의 지침', body: body, footer: foot,
                  width: '820px', key: 'law', icon: GM.icons.img('scroll', 22) });
  }

  function save0() {
    var orders = draft.map(function (o, i) {
      var payload = {
        priority: draft.length - i,
        condition: toAST(o.terms),
        action: realAction(o),
        enabled: !!o.enabled,
        text: dsl(o)
      };
      if (o.id) payload.id = o.id;
      return payload;
    });
    GM.net.send('ordersSet', { orders: orders });
    GM.sfx.play('unlock');
    U.toast('국법을 반포했습니다.', 'good');
  }

  function renderList() {
    if (!host) return;
    U.clear(host);
    draft.forEach(function (o, i) { host.appendChild(card(o, i)); });
    if (!draft.length) host.appendChild(U.el('div', 'empty', '적어 둔 조항이 없습니다. 섭정은 아무것도 하지 않고 기다립니다.'));
  }

  function card(o, idx) {
    var c = U.el('div', 'law' + (o.enabled ? '' : ' off'));
    c.draggable = true;
    c.setAttribute('data-idx', idx);

    c.addEventListener('dragstart', function (e) {
      dragIdx = idx; c.classList.add('dragging');
      try { e.dataTransfer.setData('text/plain', String(idx)); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
    });
    c.addEventListener('dragend', function () {
      dragIdx = -1; c.classList.remove('dragging');
      U.qsa('.law').forEach(function (x) { x.classList.remove('dragover'); });
    });
    c.addEventListener('dragover', function (e) { e.preventDefault(); c.classList.add('dragover'); });
    c.addEventListener('dragleave', function () { c.classList.remove('dragover'); });
    c.addEventListener('drop', function (e) {
      e.preventDefault(); c.classList.remove('dragover');
      if (dragIdx < 0 || dragIdx === idx) return;
      var moved = draft.splice(dragIdx, 1)[0];
      draft.splice(idx, 0, moved);
      dragIdx = -1; renderList();
    });

    var head = U.el('div', 'law-head');
    head.appendChild(U.el('span', 'grip', '⠿'));
    head.appendChild(U.el('span', 'law-ord', '제 ' + (idx + 1) + ' 조'));

    var sw = U.el('label', 'switch');
    var chk = document.createElement('input');
    chk.type = 'checkbox'; chk.checked = !!o.enabled;
    chk.onchange = function () { o.enabled = chk.checked; renderList(); };
    sw.appendChild(chk); sw.appendChild(U.el('span', 'sw-box'));
    sw.appendChild(U.el('span', null, o.enabled ? '지킴' : '멈춤'));
    head.appendChild(sw);

    var acts = U.el('span', 'law-acts');
    acts.appendChild(U.btn('▲', 'btn-sm btn-ghost', function () {
      if (idx > 0) { var m = draft.splice(idx, 1)[0]; draft.splice(idx - 1, 0, m); renderList(); }
    }));
    acts.appendChild(U.btn('▼', 'btn-sm btn-ghost', function () {
      if (idx < draft.length - 1) { var m = draft.splice(idx, 1)[0]; draft.splice(idx + 1, 0, m); renderList(); }
    }));
    acts.appendChild(U.btn('지운다', 'btn-sm btn-danger', function () { draft.splice(idx, 1); renderList(); }));
    head.appendChild(acts);
    c.appendChild(head);

    /* 조건 문장 */
    o.terms.forEach(function (t, ti) {
      var s = U.el('div', 'law-sentence');
      if (ti === 0) s.appendChild(U.el('span', 'lw', '만약'));
      else {
        var js = sel(JOINS, t.join || 'AND', function (v) { t.join = v; renderList(); });
        js.className = 'join';
        s.appendChild(js);
      }
      s.appendChild(sel(METRICS, t.metric, function (v) { t.metric = v; refreshRead(c, o); }));
      s.appendChild(U.el('span', 'lw', '이(가)'));
      var num = document.createElement('input');
      num.type = 'number'; num.value = t.value;
      num.className = 'law-val';
      num.oninput = function () { t.value = num.value === '' ? 0 : Number(num.value); refreshRead(c, o); };
      s.appendChild(num);
      s.appendChild(sel(OPS, t.op, function (v) { t.op = v; refreshRead(c, o); }));
      if (o.terms.length > 1) {
        s.appendChild(U.btn('−', 'btn-sm btn-ghost', function () { o.terms.splice(ti, 1); renderList(); }));
      }
      c.appendChild(s);
    });

    var addRow = U.el('div', 'law-sentence');
    addRow.appendChild(U.btn('＋ 조건을 더한다', 'btn-sm btn-ghost', function () {
      o.terms.push({ metric: 'gold', op: '>=', value: 100, join: 'AND' });
      renderList();
    }));
    c.appendChild(addRow);

    /* 행동 문장 */
    var a = U.el('div', 'law-sentence');
    a.appendChild(U.el('span', 'arrow', '→'));
    a.appendChild(U.el('span', 'lw', '그러면'));
    a.appendChild(sel(ACTIONS, o.action.key, function (v) {
      o.action = { key: v, args: defaultArgs(v) };
      renderList();
    }));
    argFields(a, o, c);
    c.appendChild(a);

    var read = U.el('div', 'law-read', readable(o));
    read.setAttribute('data-read', '1');
    c.appendChild(read);
    return c;
  }

  function refreshRead(cardEl, o) {
    var r = cardEl.querySelector('[data-read]');
    if (r) r.textContent = readable(o);
  }

  function sel(list, value, onChange) {
    var s = U.el('select');
    list.forEach(function (o) {
      var op = U.el('option', null, o.name);
      op.value = o.key;
      if (o.key === value) op.selected = true;
      s.appendChild(op);
    });
    s.onchange = function () { onChange(s.value); };
    return s;
  }

  function defaultArgs(key) {
    if (key === 'TRADE') return { side: 'sell', resource: 'grain', amount: 'surplus' };
    if (key === 'TRADE_BUY') return { side: 'buy', resource: 'grain', amount: 10 };
    if (key === 'TRANSFER') return { resource: 'grain', amount: 'surplus' };
    if (key === 'CONVERT') return { output: 'steel' };
    if (key === 'QUEUE_SWITCH') return { output: 'steel' };
    if (key === 'DEFEND') return { allocPct: 40 };
    return {};
  }

  function argFields(rowEl, o, cardEl) {
    var def = actDef(o.action.key);
    var a = o.action.args;
    (def.args || []).forEach(function (k) {
      if (k === 'resource') {
        var list = S.RESOURCES.map(function (r) { return { key: r.key, name: r.name }; });
        rowEl.appendChild(sel(list, a.resource || 'grain', function (v) { a.resource = v; refreshRead(cardEl, o); }));
      } else if (k === 'output') {
        rowEl.appendChild(sel(OUTPUTS, a.output || 'steel', function (v) { a.output = v; refreshRead(cardEl, o); }));
      } else if (k === 'amount') {
        var modes = [{ key: 'surplus', name: '남는 만큼' }, { key: 'number', name: '정한 만큼' }];
        var cur = (a.amount === 'surplus') ? 'surplus' : 'number';
        var num = document.createElement('input');
        num.type = 'number'; num.min = '1';
        num.value = (a.amount === 'surplus' || a.amount === undefined) ? 20 : a.amount;
        num.hidden = (cur === 'surplus');
        num.oninput = function () { a.amount = Number(num.value) || 1; refreshRead(cardEl, o); };
        var ms = sel(modes, cur, function (v) {
          if (v === 'surplus') { a.amount = 'surplus'; num.hidden = true; }
          else { a.amount = Number(num.value) || 1; num.hidden = false; }
          refreshRead(cardEl, o);
        });
        rowEl.appendChild(ms); rowEl.appendChild(num);
      } else if (k === 'allocPct') {
        var n2 = document.createElement('input');
        n2.type = 'number'; n2.min = '0'; n2.max = '100';
        n2.value = a.allocPct === undefined ? 40 : a.allocPct;
        n2.oninput = function () { a.allocPct = Number(n2.value) || 0; refreshRead(cardEl, o); };
        rowEl.appendChild(n2);
        rowEl.appendChild(U.el('span', 'lw', '%'));
      }
    });
  }

  function onState() {
    if (!draft.length) draft = fromServer((S.nation() || {}).orders);
  }
  function reset() { draft = []; host = null; }

  GM.orders = { open: open, onState: onState, reset: reset,
                _fromServer: fromServer, _toAST: toAST, _readable: readable };
})(window);
