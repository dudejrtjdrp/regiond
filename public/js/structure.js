/* structure.js — 건물 한 채의 정보 패널 (GDD3 §7).
   건물을 누르면 이름·단계·효과·내구도가 뜨고 [개축]·[수리] 를 여기서 한다.
   ★ 개별 건물 티어다 — 같은 종류라도 한 채씩 따로 올린다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  /* ★ GDD3 §13-A-1 — 지금 열려 있는 정착지 패널을 다시 그리기 위한 표지.
     예전에는 패널이 **열린 순간의 값**으로 한 번 그려지고 끝이라, 도끼질로 곡물이 늘어도
     닫았다 열기 전까지는 숫자가 굳어 있었다. 'live' 마다 여기 있는 본부를 다시 그린다. */
  var openHqId = null;
  /* ★ GDD3 §13-D — 본부 패널의 갈래. 정착지 / 모집 / 연구. 열려 있는 갈래를 기억한다. */
  var hqTab = 'settle';

  function open(structureId) {
    var b = S.structureById(structureId);
    if (!b) { GM.hud.hideContext(); return; }
    S.selectTarget('structureId', structureId);
    /* ★ GDD3 §12-2 — 본부를 누르면 건물 정보가 아니라 **정착지 패널**이 열린다 */
    if (b.hq) { openSettlement(b); return; }
    openHqId = null;
    render(b);
  }

  /** 정착지 패널이 열려 있으면 지금 값으로 다시 그린다 (app.js 의 'live'·'change' 가 부른다) */
  function refreshOpen() {
    if (!openHqId) return;
    var p = U.qs('#context-panel');
    if (!p || p.hidden) { openHqId = null; return; }
    var b = S.structureById(openHqId);
    if (!b) { openHqId = null; return; }
    openSettlement(b);
  }

  /* ══════════ ★ 조건 한 줄 (GDD3 §12-3 전역 원칙) ══════════
     충족 = 초록 체크 / 미충족 = 빨강 + 흐림 + 「현재값/필요값」. 화면 어디서나 같은 얼굴이다. */
  function reqRow(ok, text, have, need, unit, dec) {
    var d = dec || 0;
    var row = U.el('div', 'req-row ' + (ok ? 'ok' : 'bad'));
    row.appendChild(U.el('span', 'rq-mark', ok ? '✔' : '✕'));
    row.appendChild(U.el('span', 'rq-t', text));
    if (need != null) {
      row.appendChild(U.el('span', 'rq-v',
        ok ? (num(need, d) + (unit || '')) : (num(have, d) + '/' + num(need, d) + (unit || ''))));
    }
    return row;
  }
  /* 소수 자리는 있을 때만 — 「곡물 1.5」는 살리고 「곡물 20.0」은 만들지 않는다 */
  function num(v, dec) {
    var s = U.fmt(v, dec || 0);
    return dec ? s.replace(/\.?0+$/, '') : s;
  }

  /**
   * ★ GDD3 §13-A-1 — **조건 행을 그리는 유일한 문**.
   *   서버 스냅샷의 have 를 그대로 믿지 않고 S.reqLive 로 지금 장부에 다시 물은 뒤 그린다.
   *   정착지 패널·주민 패널·티어 배지가 전부 이 함수를 지나므로, 「곡물 46인데 12/20」이 다시 날 수 없다.
   */
  function reqRowOf(r) {
    var v = S.reqLive(r) || r;
    var row = reqRow(v.ok, v.text, v.have, v.need, v.unit, v.dec);
    if (v.detail) U.tipSet(row, v.text, v.detail);
    return row;
  }

  /**
   * ★ GDD3 §12-2 — 정착지 패널.
   *   "영토가 넓어지는 조건을 모르겠다"에 대한 답이다. 지금 단계·다음 단계 조건표(초록/빨강+현재값/필요값)·
   *   주민 유입 조건과 다음 사람까지의 진행바, 그리고 조건이 다 차면 켜지는 [승격] 단추.
   */
  /** 본부 갈래 단추 줄 — 열린 것만 그린다(잠긴 계층은 부재, §11-1) */
  function hqTabs(b) {
    var tabs = [{ key: 'settle', name: '정착지', icon: 'tier' }];
    if (S.recruitInfo()) tabs.push({ key: 'recruit', name: '모집', icon: 'person' });
    if (S.research()) tabs.push({ key: 'research', name: '연구', icon: 'research' });
    if (tabs.length < 2) return null;
    if (!tabs.some(function (t) { return t.key === hqTab; })) hqTab = 'settle';
    var row = U.el('div', 'hq-tabs');
    tabs.forEach(function (t) {
      var btn = U.el('button', 'tab' + (hqTab === t.key ? ' on' : ''));
      btn.type = 'button';
      btn.setAttribute('data-hqtab', t.key);
      btn.appendChild(GM.icons.img(t.icon, 16));
      btn.appendChild(U.el('span', null, t.name));
      btn.onclick = function () { hqTab = t.key; openSettlement(b); };
      row.appendChild(btn);
    });
    return row;
  }

  /* ══════════ ★ §13-D-2 — 모집 갈래 ══════════ */
  function recruitBody(b) {
    var r = S.recruitInfo();
    var body = U.el('div', 'settle');
    body.appendChild(U.el('h4', 'se-sec', '사람을 부른다'));
    body.appendChild(U.el('p', 'se-line',
      '길 위의 사람에게 먹을 것을 들려 보내면 하루 안에 한 사람이 옵니다. '
      + '저절로 찾아오는 사람은 그대로 옵니다.'));
    var rl = U.el('div', 'req-list');
    (r.reqs || []).forEach(function (q) { rl.appendChild(reqRowOf(q)); });
    body.appendChild(rl);
    if (r.count) body.appendChild(U.el('p', 'hint', '지금까지 ' + r.count + '명을 불렀습니다.'));

    /* ★ §16-18 — 집결지(RTS 의 랠리 포인트). 새로 오는 주민이 곧장 갈 일터를 꽂아 둔다. */
    body.appendChild(U.el('h4', 'se-sec', '집결지'));
    var rl2 = S.rally();
    body.appendChild(U.el('p', 'se-line', rl2
      ? '지금: ' + (rl2.name || '일터') + ' — 새로 오는 사람이 이리로 가서 곧장 일합니다.'
      : '꽂아 두면 새로 오는 사람이 그 일터로 가서 곧장 일을 시작합니다.'));
    var row = U.el('div', 'se-actions');
    row.appendChild(U.btn(rl2 ? '옮겨 꽂는다' : '집결지를 꽂는다', 'btn-small btn-primary', function () {
      U.closeTopModal();
      S.setPlacing({ kind: 'rally' });
      U.toast('집결지로 삼을 일터(자원 자리)를 누르세요.', 'good', 3600);
    }));
    if (rl2) {
      row.appendChild(U.btn('걷는다', 'btn-small', function () {
        GM.net.send('setRally', { targetId: null }, function () {
          U.toast('집결지를 걷었습니다.', 'good', 2200);
          GM.structure.refreshOpen();
        });
      }));
    }
    body.appendChild(row);
    return body;
  }

  /* ══════════ ★ §13-D-5 — 연구 갈래 ══════════ */
  /** ★ §19-F4(F09-1) — 연구소가 갈래마다 얹어 준 걸음 한 줄. 값은 서버(research.labs)가 쥔다. */
  function labsRow(body, r) {
    var labs = r && r.labs;
    if (!labs || !(labs.fields || []).length) return;
    var on = labs.fields.filter(function (f) { return f.bonus > 0; });
    if (!on.length) return;
    var text = on.map(function (f) { return f.name + ' +' + Math.round(f.bonus * 100) + '%'; }).join(' · ');
    var row = U.el('p', 'rs-line', '연구소가 하루를 늘립니다 — ' + text);
    row.setAttribute('data-research-labs', '1');
    body.appendChild(row);
  }

  /** 「며칠인가」 — 연구소가 서 있으면 실제로 걸리는 날을 적는다(정본 days 는 그대로다) */
  function researchDaysText(x) {
    var step = x.step || 1;
    if (step <= 1.0001) return x.days + '일';
    return Math.ceil(x.days / step) + '일 (본래 ' + x.days + '일)';
  }

  function researchBody(b) {
    var r = S.research();
    var body = U.el('div', 'settle');
    if (r.active) {
      var cur = null;
      (r.list || []).forEach(function (x) { if (x.key === r.active.key) cur = x; });
      if (cur) {
        var g = U.makeGauge({ height: 18, color: '#7fb3ff' });
        g.setValue(U.clamp(cur.progress || 0, 0, 1),
          cur.name + ' — 남은 ' + U.fmt(cur.remainingDays, 1) + '일',
          '붙들고 있는 연구', '한 번에 하나만 붙듭니다. 값은 이미 치렀습니다.');
        body.appendChild(g);
      }
      hasteRow(body, r, b);
    }
    labsRow(body, r);
    var list = U.el('div', 'rs-list');
    (r.list || []).forEach(function (x) {
      var row = U.el('div', 'rs-item' + (x.done ? ' done' : '') + (x.active ? ' active' : '') + (x.ready ? ' ready' : ''));
      row.setAttribute('data-research', x.key);
      var head = U.el('div', 'rs-h');
      head.appendChild(GM.icons.img('research', 18));
      head.appendChild(U.el('b', null, x.name));
      if (x.done) head.appendChild(U.el('span', 'rs-tag ok', '끝남'));
      else if (x.active) head.appendChild(U.el('span', 'rs-tag', '진행 중'));
      else head.appendChild(U.el('span', 'rs-tag', researchDaysText(x)));
      row.appendChild(head);
      row.appendChild(U.el('p', 'rs-d', x.desc || ''));
      if (!x.done) {
        var rl = U.el('div', 'req-list');
        (x.reqs || []).forEach(function (q) {
          rl.appendChild(reqRow(q.ok, q.text, q.have, q.need, q.unit, q.dec));
        });
        row.appendChild(rl);
        var btn = U.btn('연구한다', 'btn-small', function () { doResearch(x.key, b); });
        btn.setAttribute('data-research-start', x.key);
        btn.disabled = !x.ready;
        U.tipSet(btn, x.name, x.active ? '이미 붙들고 있습니다'
          : (x.busy ? '다른 연구를 먼저 끝내야 합니다'
            : (x.ready ? '값을 치르고 그날부터 ' + x.days + '일' : '아직 조건이 모자랍니다')));
        row.appendChild(btn);
      } else if (x.line) {
        row.appendChild(U.el('p', 'rs-line', x.line));
      }
      list.appendChild(row);
    });
    body.appendChild(list);
    var rail = S.railInfo();
    if (rail && rail.open) {
      body.appendChild(U.el('h4', 'se-sec', '철로'));
      body.appendChild(U.el('p', 'se-line',
        '깐 조각 ' + rail.tiles + ' / ' + rail.maxTiles
        + ' · 위를 걷는 주민은 ' + rail.speedMultiplier + '배로 빠릅니다.'));
      var railBtn = U.btn('철로를 깐다', 'btn-small btn-primary', function () {
        U.closeTopModal(); GM.hud.hideContext(); GM.build.openRail();
      });
      railBtn.id = 'rs-lay-rail';
      body.appendChild(railBtn);
    }
    /* ★ §17-13 — 다리·매립. 철로와 같은 자리(연구 갈래)에서 놓기 시작한다. */
    var bridge = S.bridgeInfo();
    if (bridge && bridge.open) {
      body.appendChild(U.el('h4', 'se-sec', '다리'));
      body.appendChild(U.el('p', 'se-line',
        '놓은 조각 ' + bridge.tiles + ' / ' + bridge.maxTiles
        + ' · 사람은 다리 위로 물을 건넙니다. 짐승과 적은 못 씁니다.'));
      var brBtn = U.btn('다리를 놓는다', 'btn-small btn-primary', function () {
        U.closeTopModal(); GM.hud.hideContext(); GM.build.openOverlay('bridge');
      });
      brBtn.id = 'rs-lay-bridge';
      body.appendChild(brBtn);
    }
    var fill = S.fillInfo();
    if (fill && fill.open) {
      body.appendChild(U.el('h4', 'se-sec', '매립'));
      body.appendChild(U.el('p', 'se-line',
        '메운 칸 ' + fill.tiles + ' / ' + fill.maxTiles
        + ' · 메운 자리에는 걷고, 짓고, 울타리도 두를 수 있습니다.'));
      var flBtn = U.btn('매립한다', 'btn-small btn-primary', function () {
        U.closeTopModal(); GM.hud.hideContext(); GM.build.openOverlay('fill');
      });
      flBtn.id = 'rs-lay-fill';
      body.appendChild(flBtn);
    }
    return body;
  }

  /* ★ §19-F3(F07-8) — 첫 감정을 마친 감정소의 두 번째 동사. 며칠에 한 번 「기운이 다시 고인다」:
     태그 하나를 다시 뽑고, 그 사이 넓어진 영토의 지하를 마저 연다. 날수·값은 서버가 센다. */
  function reappraiseAct(b) {
    var st = (S.S.view && S.S.view.reappraisal) || {};
    var wait = (st.daysLeft || 0) > 0 && !(st.charges > 0);
    return {
      label: b.postActionLabel || '다시 감정한다', cls: 'btn-primary', id: 'st-reappraise',
      disabled: !st.open,
      tip: wait ? '기운이 고이기까지 ' + st.daysLeft + '일 남았습니다'
        : (st.charges > 0 ? '옛 지도 조각을 씁니다' : '금화 ' + U.fmt(st.gold || 0, 0) + '이 듭니다'),
      detail: '땅의 됨됨이 하나를 다시 뽑고, 넓어진 영토의 지하를 마저 드러냅니다.',
      onClick: function () { doReappraise(b); }
    };
  }

  function doReappraise(b) {
    GM.hud.hideContext();
    GM.net.send('reappraiseLand', { structureId: b.id }, function (r) {
      if (!r || !r.ok) {
        U.toast((r && r.error && r.error.message) || '지금은 다시 감정할 수 없습니다.', 'warn', 3200);
        return;
      }
      GM.sfx.play('unlock');
      GM.fx.flash('#fff0c8', 0.2, 0.6);
      GM.fx.ring(b.x, b.y, '#f6cf7a', 0.2, 5, 1.1, 4);
      U.banner({ icon: 'research', kind: 'good', title: '땅을 다시 읽었다',
                 sub: reappraiseLine(r), ms: 4200 });
    });
  }

  function reappraiseLine(r) {
    var parts = [];
    if (r.swapped) parts.push(r.swapped.fromName + ' → ' + r.swapped.toName);
    if (r.revealedNodes && r.revealedNodes.length) parts.push('지하 ' + r.revealedNodes.length + '자리');
    return parts.length ? parts.join(' · ') : (r.tagNames || []).join(' · ');
  }

  /* ★ §19-F3(F07-5) — 붙들고 있는 궁리에 금화를 부어 하루를 앞당긴다.
     값·가능 여부는 전부 서버가 셈해 보낸다(research.haste) — 화면은 단추만 그린다. */
  function hasteRow(body, r, b) {
    var h = r.haste;
    if (!h) return;
    var btn = U.btn('금화 ' + U.fmt(h.gold, 0) + '로 하루 앞당긴다', 'btn-small', function () {
      GM.net.send('hastenResearch', {}, function (res) {
        if (!res || !res.ok) {
          U.toast((res && res.error && res.error.message) || '지금은 앞당길 수 없습니다.', 'warn');
          return;
        }
        U.toast('사람을 더 붙였습니다 — 하루가 줄었습니다.', 'good', 2800);
        GM.sfx.play('gain');
        openSettlement(b);
      });
    });
    btn.id = 'rs-haste';
    btn.disabled = !h.ready;
    U.tipSet(btn, '연구 가속', h.room ? (h.ready ? '금화 ' + U.fmt(h.gold, 0) + '을 치르고 하루를 줄입니다'
      : '금화가 모자랍니다') : '내일이면 어차피 끝납니다');
    body.appendChild(btn);
  }

  function doResearch(key, b) {
    GM.net.send('startResearch', { key: key }, function (res) {
      if (!res) return;
      if (!res.ok) { U.toast((res.error && res.error.message) || '아직 연구할 수 없습니다.', 'warn', 3400); GM.sfx.play('deny'); return; }
      U.toast('연구를 시작했습니다.', 'good', 2600);
      GM.sfx.play('unlock');
      openSettlement(b);
    });
  }

  function openSettlement(b) {
    openHqId = b && b.id ? b.id : null;
    var t = S.tier();
    var nx = t.next;
    var h = S.housing() || {};
    var arr = h.arrival || null;
    var tabRow = hqTabs(b);

    if (tabRow && hqTab !== 'settle') {
      var alt = U.el('div');
      alt.appendChild(tabRow);
      alt.appendChild(hqTab === 'recruit' ? recruitBody(b) : researchBody(b));
      var altActs = [];
      if (hqTab === 'recruit') {
        var rr = S.recruitInfo() || {};
        var costText = Object.keys(rr.cost || {}).map(function (k) {
          return S.resourceMeta(k).name + ' ' + U.fmt(rr.cost[k], 0);
        }).join(' · ');
        altActs.push({
          label: '모집한다 — ' + costText, cls: 'btn-primary', id: 'se-recruit',
          disabled: !rr.open,
          tip: rr.open ? '지금 한 사람을 부릅니다' : ('아직 부를 수 없습니다 — ' + (rr.reason || '')),
          detail: '값을 치르면 그 자리에서 한 사람이 옵니다. 다시 부르기까지 '
            + U.fmt(rr.cooldownDays, 0) + '일 걸립니다.',
          onClick: function () {
            GM.net.send('recruitResident', {}, function (res) {
              if (!res) return;
              if (!res.ok) { U.toast((res.error && res.error.message) || '지금은 부를 수 없습니다.', 'warn', 3400); GM.sfx.play('deny'); return; }
              GM.sfx.play('arrive');
              openSettlement(b);
            });
          }
        });
      }
      altActs.push({ label: '닫는다', cls: 'btn-ghost', onClick: function () { S.clearSelection(); GM.hud.hideContext(); } });
      GM.hud.showContext({
        icon: hqTab === 'recruit' ? 'person' : 'research',
        title: b.name + ' — ' + (hqTab === 'recruit' ? '모집' : '연구'),
        facts: [{ k: '단계', v: t.tier + ' · ' + t.name },
                { k: '사는 사람', v: (h.population || 0) + ' / ' + (h.capacity || 0) + '자리' }],
        extra: alt,
        actions: altActs,
        note: hqTab === 'recruit' ? '자연히 찾아오는 사람은 그대로 옵니다.'
                                  : '한 번에 하나만 붙듭니다. 값은 시작할 때 치릅니다.'
      });
      return;
    }

    var body = U.el('div', 'settle');
    if (tabRow) body.appendChild(tabRow);

    var head = U.el('div', 'se-head');
    head.appendChild(U.el('span', 'se-name', t.name || '야영지'));
    head.appendChild(U.el('span', 'se-next', nx ? ('다음 — ' + nx.name) : '끝이 없는 길'));
    body.appendChild(head);
    if (t.line) body.appendChild(U.el('p', 'se-line', t.line));

    /* ① 다음 단계 조건 체크리스트 */
    if (nx) {
      body.appendChild(U.el('h4', 'se-sec', '다음 단계 조건'));
      var list = U.el('div', 'req-list');
      (nx.reqs || []).forEach(function (r) { list.appendChild(reqRowOf(r)); });
      body.appendChild(list);
      body.appendChild(U.el('p', 'se-line',
        '오르면 땅이 반경 ' + U.fmt(nx.fromRadius, 0) + ' → ' + U.fmt(nx.radius, 0) + ' 로 넓어지고, '
        + '시야와 손놀림도 함께 자랍니다.'));
    }

    /* ② 주민 유입 조건 + 다음 사람까지 진행바 (§12-4) */
    body.appendChild(U.el('h4', 'se-sec', '사람이 찾아오는 조건'));
    if (arr) {
      var rl = U.el('div', 'req-list');
      (arr.reqs || []).forEach(function (r) { rl.appendChild(reqRowOf(r)); });
      body.appendChild(rl);

      var g = U.makeGauge({ height: 18, color: '#6a994e' });
      g.setValue(U.clamp(arr.progress || 0, 0, 1),
        arr.open ? ('다음 사람까지 약 ' + U.fmt(arr.daysUntil, 1) + '일')
                 : (arr.reason || '지금은 오지 않습니다'),
        '주민 유입',
        '매력도 ' + U.fmt(arr.attractiveness, 2) + ' / ' + U.fmt(arr.attractivenessMax, 1)
        + '\n약 ' + U.fmt(arr.intervalDays, 1) + '일마다 한 명씩 옵니다.'
        + '\n식량이 넉넉하고 꾸밈이 늘수록 빨라집니다.');
      body.appendChild(g);

      var ag = U.makeGauge({ height: 14, color: '#e8a33d' });
      ag.setValue(U.clamp((arr.attractiveness || 1) / (arr.attractivenessMax || 2), 0, 1),
        '매력도 ' + U.fmt(arr.attractiveness, 2),
        '매력도', '식량 잉여 · 꾸밈 · 사기가 모여 도착 주기를 나눕니다.');
      body.appendChild(ag);
    } else {
      body.appendChild(U.el('p', 'se-line', '아직 사람이 찾아올 만한 곳이 아닙니다.'));
    }

    var acts = [];
    if (nx) {
      /* ★ §13-A-1 — 단추의 활성 여부도 서버 스냅샷이 아니라 지금 장부로 정한다.
         조건 행이 다 초록인데 단추만 꺼져 있는 어긋남을 원천에서 없앤다. */
      var live = S.reqList(nx.reqs);
      var ready = live.length ? S.reqReady(nx.reqs) : Boolean(nx.ready);
      var missing = live.filter(function (r) { return !r.ok; });
      acts.push({
        label: '승격한다 — ' + nx.name, cls: 'btn-primary', id: 'se-promote',
        disabled: !ready,
        tip: ready ? '지금 올릴 수 있습니다' : ('아직 모자랍니다 — ' + missing.map(function (r) {
          return r.text + ' ' + num(r.have, r.dec) + '/' + num(r.need, r.dec);
        }).join(' · ')),
        detail: '땅이 넓어지고 말뚝이 새 자리에 박힙니다.',
        onClick: function () {
          GM.net.send('promoteSettlement', {}, function (r) {
            if (!r) return;
            if (!r.ok) { U.toast((r.error && r.error.message) || '아직 오를 수 없습니다.', 'warn', 3200); GM.sfx.play('deny'); return; }
            GM.sfx.play('unlock');
          });
          GM.hud.hideContext();
        }
      });
    }
    acts.push({ label: '닫는다', cls: 'btn-ghost', onClick: function () { S.clearSelection(); GM.hud.hideContext(); } });

    GM.hud.showContext({
      icon: 'tier',
      title: b.name + ' — 정착지',
      facts: [{ k: '단계', v: t.tier + ' · ' + t.name },
              { k: '사는 사람', v: (h.population || 0) + ' / ' + (h.capacity || 0) + '자리' }],
      extra: body,
      actions: acts,
      note: '정착지의 심장입니다. 여기서 다음 단계로 올립니다.'
    });
  }

  function render(b) {
    var facts = [];
    facts.push({ k: '단계', v: b.tier + ' / ' + b.maxTier });
    var cond = b.condition === undefined ? 1 : b.condition;
    facts.push({ k: '튼튼함', v: U.pct(cond, 0),
      tip: U.fmt(b.hp, 0) + ' / ' + U.fmt(b.maxHp, 0) + (b.ruined ? '\n부서져서 아무 몫도 못 합니다.' : '') });
    if (b.residents) facts.push({ k: '사는 사람', v: b.residents + '명' });
    /* ★ GDD3 §15-A-4 — 터렛이면 사거리를 적고, 지도 위에는 원을 그린다(world.drawSelectionMarks). */
    if (b.turret && b.turret.range) {
      facts.push({ k: '사거리', v: U.fmt(b.turret.range, 0) + '칸',
        tip: '지도 위 노란 원 안에 든 것을 저절로 쏩니다.',
        detail: '짐승은 영토 안으로 못 들어옵니다 — 원이 경계를 넘어야 바깥의 것에 닿습니다.' });
      facts.push({ k: '화력', v: U.fmt(b.turret.dps, 0) + ' DPS' });
    }
    if (b.adjacency) facts.push({ k: '이웃한 자리의 덕', v: '+' + U.pct(b.adjacency, 0) });

    var extra = U.el('div', 'st-body');
    if (b.effects && b.effects.length) {
      var ef = U.el('div', 'st-effects');
      b.effects.forEach(function (e) {
        var r = U.el('span', 'st-eff');
        r.appendChild(U.el('b', null, e.label));
        r.appendChild(U.el('span', null, ' ' + e.value));
        ef.appendChild(r);
      });
      extra.appendChild(ef);
    }
    if (b.nextTier) {
      var nx = U.el('div', 'st-next');
      nx.appendChild(U.el('span', 'st-next-cap', '개축하면 — ' + (b.nextTier.name || '') + ' ' + b.nextTier.tier + '단'));
      (b.nextTier.effects || []).forEach(function (e) {
        var r2 = U.el('span', 'st-eff up');
        r2.appendChild(U.el('b', null, e.label));
        r2.appendChild(U.el('span', null, ' ' + e.value));
        nx.appendChild(r2);
      });
      /* ★ §12-3 — 드는 것 중 모자란 자원만 빨강 「석재 12/30」 */
      var cw = U.el('span', 'st-cost');
      cw.appendChild(U.el('span', null, '드는 것 — '));
      cw.appendChild(GM.build.costNodes(b.nextTier.cost, b.nextTier.gold));
      if (b.nextTier.buildPoints) cw.appendChild(U.el('span', null, ' · 공사 ' + U.fmt(b.nextTier.buildPoints, 0)));
      nx.appendChild(cw);
      extra.appendChild(nx);
    }

    /* ★ §12-12 — 지금 걸린 일(철거·이전)의 진행 표시 */
    if (b.work) {
      var wk = U.el('div', 'st-work');
      var name = b.work.mode === 'demolish' ? '허무는 중'
        : (b.work.phase === 'rebuild' ? '새 자리에 다시 세우는 중' : '헐어 내는 중');
      wk.appendChild(U.el('span', 'sw-t', name + ' · ' + U.pct(b.work.progress || 0, 0)));
      var bar = U.el('div', 'sw-bar');
      var fill = U.el('i');
      fill.style.width = Math.round(U.clamp(b.work.progress || 0, 0, 1) * 100) + '%';
      bar.appendChild(fill);
      wk.appendChild(bar);
      if (b.work.mode === 'demolish' && b.work.refund) {
        wk.appendChild(U.el('span', 'sw-t', '헐면 돌아오는 것 — ' + GM.build.costText(b.work.refund)));
      }
      wk.appendChild(U.el('span', 'sw-t', '현장 가까이서 누르고 있으면 빨리 끝납니다. 그동안 이 건물은 아무 몫도 하지 않습니다.'));
      extra.appendChild(wk);
    }

    var acts = [];
    /* ★ 건물이 품은 '한 번 누르는 동사' — 감정소의 [땅을 감정한다] (GDD3 §11-4).
       감정의 날은 시간으로 오지 않는다. 이 단추가 유일한 문이다. */
    if (b.action === 'appraiseLand') {
      var done = !!(S.S.view && S.S.view.mandate && S.S.view.mandate.unlocked);
      if (done && b.postAction === 'reappraiseLand') acts.push(reappraiseAct(b));
      else acts.push({
        label: b.actionLabel || '땅을 감정한다', cls: 'btn-primary', id: 'st-appraise',
        disabled: done,
        tip: done ? '이 땅은 이미 감정했습니다' : '이 땅이 무엇을 품었는지 드러납니다',
        detail: '태그가 공개되고, 저마다의 자리(역할)를 고를 수 있게 됩니다.',
        onClick: function () {
          GM.hud.hideContext();
          GM.net.send('appraiseLand', { structureId: b.id }, function (r) {
            if (r && r.ok) {
              GM.sfx.play('unlock');
              GM.fx.flash('#fff0c8', 0.24, 0.6);
              GM.fx.ring(b.x, b.y, '#f6cf7a', 0.2, 5, 1.1, 4);
            }
          });
        }
      });
    }
    /* ★ §17-9 — 건물 손일(직접 상호작용): 제련소 손제련 · 우물 두레박 · 기도 · 톱질 등.
       비용·산출·쿨다운 전부 서버 설정(handWork)이 정본이고, 여기서는 그리기만 한다. */
    if (b.handWork && !b.ruined && !b.work) {
      var hw = b.handWork;
      var parts = [];
      if (hw.cost) parts.push('든다: ' + GM.build.costText(hw.cost));
      if (hw.yield) parts.push('받는다: ' + GM.build.costText(hw.yield));
      if (hw.gold) parts.push('골드 +' + hw.gold);
      if (hw.buildPoints) parts.push('공사력 +' + hw.buildPoints);
      if (hw.heal) parts.push('체력 +' + hw.heal);
      if (hw.morale) parts.push('사기 +' + hw.morale);
      acts.push({
        label: hw.label || '거든다', cls: 'btn-primary', id: 'st-handwork',
        tip: hw.desc || '건물 곁에서 직접 거듭니다.',
        detail: parts.join(' · ') + (hw.cooldownDays ? ' · 하루 한 번' : (hw.cooldownSeconds ? ' · ' + hw.cooldownSeconds + '초마다' : ''))
          + ' · 건물 곁에서 E 를 눌러도 곧바로 합니다',
        onClick: function () { runHandWork(b, true); }
      });
    }
    if (b.nextTier) {
      var afford = GM.build.canAfford(b.nextTier.cost, b.nextTier.gold);
      acts.push({
        label: '개축한다 (' + b.tier + ' → ' + b.nextTier.tier + ')', cls: 'btn-primary', id: 'st-upgrade',
        disabled: !afford || b.upgrading || !!b.work,
        tip: b.upgrading ? '이미 개축 중입니다'
          : (b.work ? '지금은 다른 일이 걸려 있습니다'
            : (afford ? '이 한 채만 다음 단계로 올립니다'
              : '자재가 모자랍니다 — ' + GM.build.shortText(b.nextTier.cost, b.nextTier.gold))),
        detail: '개축은 공사 현장으로 섭니다 — 직접 두드리면 빨리 오릅니다.',
        onClick: function () {
          GM.net.send('upgradeStructure', { structureId: b.id }, function (r) {
            if (r && r.ok) {
              U.toast('개축을 시작했습니다.', 'good');
              GM.sfx.play('build');
              GM.fx.sparkle(b.x, b.y, 14, '#f6cf7a');
            }
          });
          GM.hud.hideContext();
        }
      });
    } else {
      acts.push({ label: '다 올렸다', disabled: true, cls: 'btn-ghost' });
    }
    if (cond < 0.999) {
      acts.push({
        label: b.ruined ? '다시 짓는다' : '수리한다', cls: 'btn-good', id: 'st-repair',
        tip: '자재를 들여 내구도를 되돌립니다',
        onClick: function () {
          GM.net.send('repairStructure', { structureId: b.id }, function (r) {
            if (r && r.ok) {
              U.toast('고쳤습니다 · ' + GM.build.costText(r.cost), 'good');
              GM.sfx.play('build');
              GM.fx.dust(b.x, b.y, 12);
              GM.world.bounceStructure(b.id);
            }
          });
          GM.hud.hideContext();
        }
      });
    }
    /* ★ GDD3 §12-12 — 이전 · 철거 · 되돌리기. 본부는 아예 단추가 없다. */
    if (!b.immovable) {
      if (b.work) {
        acts.push({
          label: '그만둔다', cls: 'btn-good', id: 'st-cancel-work',
          disabled: !b.work.cancelable,
          tip: b.work.cancelable ? '하던 일을 물리고 건물을 그대로 둡니다' : '이미 헐어 버려 되돌릴 수 없습니다',
          onClick: function () {
            GM.net.send('cancelStructureWork', { structureId: b.id }, function (r) {
              if (r && r.ok) { U.toast('하던 일을 물렸습니다.', 'good'); GM.sfx.play('tap'); }
            });
            GM.hud.hideContext();
          }
        });
      } else {
        acts.push({
          label: '옮긴다', id: 'st-relocate',
          tip: '새 자리를 고르면 헐었다가 다시 짓습니다',
          detail: '자재는 더 들지 않습니다. 다만 옮기는 동안에는 아무 몫도 하지 않습니다.',
          onClick: function () { GM.hud.hideContext(); GM.build.startRelocate(b); }
        });
        acts.push({
          label: '헌다', cls: 'btn-danger', id: 'st-demolish',
          tip: '허물면 들인 자재의 절반이 돌아옵니다',
          detail: '허무는 동안에는 [그만둔다]로 되돌릴 수 있습니다.',
          onClick: function () {
            GM.net.send('demolishStructure', { structureId: b.id }, function (r) {
              if (!r) return;
              if (!r.ok) { U.toast((r.error && r.error.message) || '헐 수 없습니다.', 'bad'); GM.sfx.play('deny'); return; }
              U.toast('허물기 시작했습니다 · 끝나면 ' + GM.build.costText(r.refund) + ' 가 돌아옵니다.', 'good', 3400);
              GM.sfx.play('build');
            });
            GM.hud.hideContext();
          }
        });
      }
    }
    acts.push({ label: '닫는다', cls: 'btn-ghost', onClick: function () { S.clearSelection(); GM.hud.hideContext(); } });

    var fp = S.footprintOfThing(b);
    if (fp.w > 1 || fp.h > 1) facts.push({ k: '차지한 자리', v: fp.w + '×' + fp.h + '칸' });

    /* ★ GDD3 §15-B-2 — 패널 맨 위의 한 줄도 「왜 짓는가」다. 건설 카드와 **같은 문장**을 쓴다:
       고를 때 읽은 말과 지은 뒤에 읽는 말이 다르면 그것은 설명이 아니라 소음이다. */
    var bdef = S.buildingDef(b.key) || {};
    GM.hud.showContext({
      icon: GM.build.iconOf(b.key),
      title: b.name + (b.ruined ? ' (부서짐)' : ''),
      facts: facts, extra: extra, actions: acts,
      note: bdef.purpose || bdef.desc || null
    });
  }

  /** 공사 현장 패널 — 직접 두드려 올리는 안내 */
  function openSite(siteId) {
    var c = S.siteById(siteId);
    if (!c) { GM.hud.hideContext(); return; }
    S.selectTarget('siteId', siteId);
    var ctr = S.centerOfThing(c);
    var near = GM.avatar.pos() && c.x != null && GM.avatar.distTo(ctr.x, ctr.y) <= S.swingRange() + 1;
    var wrecking = c.mode === 'demolish' || c.mode === 'relocate';
    var acts = [
      { label: '현장으로 간다', cls: 'btn-primary', id: 'site-go',
        onClick: function () { GM.avatar.moveTo(ctr.x, ctr.y); GM.camera.moveTo(ctr.x, ctr.y); } },
      { label: '주민을 붙인다', id: 'site-workers', onClick: function () {
          var ids = (S.S.selection.residents || []);
          if (!ids.length) ids = GM.residents.nearestIdle(ctr.x, ctr.y, 4);
          if (!ids.length) { U.toast('보낼 사람이 없습니다.', 'warn'); return; }
          GM.net.send('commandVillagers', { ids: ids, order: { type: 'work', nodeId: c.id } });
          GM.world.ping(ctr.x, ctr.y, '#8dfa8d');
        } }
    ];
    /* ★ §12-12 — 철거·이전은 진행 중에 되돌릴 수 있다 */
    if (wrecking && c.cancelable) {
      acts.push({ label: '그만둔다', cls: 'btn-good', id: 'site-cancel',
        tip: '하던 일을 물리고 건물을 그대로 둡니다',
        onClick: function () {
          GM.net.send('cancelStructureWork', { structureId: c.structureId || c.id }, function (r) {
            if (r && r.ok) { U.toast('하던 일을 물렸습니다.', 'good'); GM.sfx.play('tap'); }
          });
          S.clearSelection(); GM.hud.hideContext();
        } });
    }
    acts.push({ label: '닫는다', cls: 'btn-ghost', onClick: function () { S.clearSelection(); GM.hud.hideContext(); } });

    var facts = [{ k: wrecking ? '진행' : '올라간 정도', v: U.pct(c.progress || 0, 0) },
                 { k: '남은 일', v: U.fmt(c.remaining, 0) + ' / ' + U.fmt(c.total, 0) }];
    if (c.mode === 'demolish' && c.refund) facts.push({ k: '돌아올 것', v: GM.build.costText(c.refund) });
    if (c.mode === 'relocate') facts.push({ k: '마디', v: c.phase === 'rebuild' ? '다시 짓기' : '헐어 내기' });

    GM.hud.showContext({
      icon: wrecking ? 'pickaxe' : 'hammer',
      title: c.name + ' ' + (c.modeName || '공사'),
      facts: facts,
      note: near ? '가까이 있습니다 — 누르고 있으면 계속 두드립니다.' : '현장 가까이 가서 누르고 있으면 일이 빨리 끝납니다.',
      actions: acts
    });
  }

  /** 울타리 조각 패널 */
  function openFence(fenceId) {
    var list = S.fences();
    var f = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === fenceId) f = list[i];
    if (!f) { GM.hud.hideContext(); return; }
    S.selectTarget('fenceId', fenceId);
    var cond = f.condition === undefined ? 1 : f.condition;
    GM.hud.showContext({
      icon: f.gate ? 'gate' : 'fence',
      title: f.name + (f.broken ? ' (부서짐)' : ''),
      facts: [{ k: '단계', v: f.tier === 2 ? '석벽' : '목책' },
              { k: '튼튼함', v: U.pct(cond, 0), tip: U.fmt(f.hp, 0) + ' / ' + U.fmt(f.maxHp, 0) }],
      actions: [
        { label: '이 조각 수리', id: 'fence-repair-one', disabled: cond >= 0.999,
          onClick: function () {
            GM.net.send('repairFence', { segmentIds: [f.id] }, function (r) {
              if (r && r.ok) { U.toast('고쳤습니다.', 'good'); GM.sfx.play('build'); }
            });
          } },
        { label: '석벽으로', id: 'fence-up-one', disabled: f.tier >= 2,
          onClick: function () {
            GM.net.send('upgradeFence', { segmentIds: [f.id] }, function (r) {
              if (r && r.ok) { U.toast('석벽으로 올렸습니다.', 'good'); GM.sfx.play('build'); }
            });
          } },
        { label: '치운다', cls: 'btn-danger', id: 'fence-remove',
          onClick: function () {
            GM.net.send('removeFence', { segmentIds: [f.id] }, function (r) {
              if (r && r.ok) { U.toast('치웠습니다 · ' + GM.build.costText(r.refund) + ' 돌려받았습니다.', 'good'); }
            });
            S.clearSelection(); GM.hud.hideContext();
          } },
        { label: '닫는다', cls: 'btn-ghost', onClick: function () { S.clearSelection(); GM.hud.hideContext(); } }
      ]
    });
  }

  /** 자원 자리 패널 */
  function openNode(nodeId) {
    var n = S.nodeById(nodeId);
    if (!n) { GM.hud.hideContext(); return; }
    S.selectTarget('nodeId', nodeId);
    var meta = S.nodeMeta(n.type);
    var pv = S.swingTarget(n.type);
    var facts = [{ k: '자리', v: meta.name + (n.rich ? ' (유난히 기름짐)' : '') }];
    if (n.max > 0) facts.push({ k: '남은 양', v: U.pct(n.ratio || 0, 0), tip: U.fmt(n.amount, 0) + ' / ' + U.fmt(n.max, 0) });
    if (n.swingsPerCycle) facts.push({ k: '한 번 끝내기', v: n.swings + ' / ' + n.swingsPerCycle + '번' });
    if (pv) facts.push({ k: '스윙 간격', v: U.fmt(pv.cooldownMs / 1000, 2) + '초',
      tip: '솜씨가 오르고 정착지가 커지면 짧아집니다.' });
    if (n.stageName) facts.push({ k: '자람', v: n.stageName });
    if (n.workers) facts.push({ k: '붙은 사람', v: n.workers + ' / ' + n.slots });

    var near = GM.avatar.pos() && GM.avatar.distTo(n.x, n.y) <= S.swingRange();
    var acts = [
      { label: '자리로 간다', cls: 'btn-primary', id: 'node-go',
        onClick: function () { GM.avatar.moveTo(n.x, n.y); GM.camera.moveTo(n.x, n.y); } }
    ];
    if (S.uiOn('panel.residents')) {
      acts.push({ label: '주민을 보낸다', id: 'node-workers', onClick: function () {
        var ids = (S.S.selection.residents || []);
        if (!ids.length) ids = GM.residents.nearestIdle(n.x, n.y, Math.max(1, (n.slots || 1) - (n.workers || 0)));
        if (!ids.length) { U.toast('보낼 사람이 없습니다.', 'warn'); return; }
        GM.net.send('commandVillagers', { ids: ids, order: { type: 'work', nodeId: n.id } });
        GM.world.ping(n.x, n.y, '#8dfa8d');
      } });
    }
    /* ★ §17-12 — 걷어내기. 영토 안의 걷을 수 있는 종류(nodes.clear.refundResource)만 단추가 뜬다.
       판정의 정본은 서버(clearNode)다 — 여기는 단추를 그릴지 말지만 가른다. */
    var wCfg = S.worldCfg();
    var clearCfg = wCfg && wCfg.nodes && wCfg.nodes.clear;
    var clearOk = clearCfg && clearCfg.refundResource
      && Object.prototype.hasOwnProperty.call(clearCfg.refundResource, n.type)
      && (clearCfg.onlyTerritory === false || S.inTerritory(n.x, n.y));
    if (clearOk) {
      var refRes = clearCfg.refundResource[n.type];
      var expect = refRes
        ? Math.max((clearCfg.minRefund && clearCfg.minRefund[n.type]) || 0, (n.amount || 0) * (clearCfg.refundRatio || 0.5))
        : 0;
      acts.push({
        label: '걷어낸다', cls: 'btn-danger', id: 'node-clear',
        tip: '이 자리를 치워 건물 놓을 땅을 냅니다',
        detail: refRes
          ? ('걷으면 ' + S.resourceMeta(refRes).name + ' 약 ' + U.fmt(expect, 0) + '을(를) 돌려받습니다. 되돌릴 수 없습니다.')
          : '돌려받는 것은 없습니다. 되돌릴 수 없습니다.',
        onClick: function () {
          U.confirmBox(meta.name + ' — 걷어내기',
            '이 자리를 걷어내면 다시 자라지 않습니다.'
            + (refRes ? ' ' + S.resourceMeta(refRes).name + ' 약 ' + U.fmt(expect, 0) + '이(가) 곳간으로 들어옵니다.' : ''),
            function () {
              GM.net.send('clearNode', { nodeId: n.id }, function (r) {
                if (!r) return;
                if (!r.ok) { U.toast((r.error && r.error.message) || '걷어 낼 수 없습니다.', 'bad'); GM.sfx.play('deny'); return; }
                GM.sfx.play('dig');
                U.toast('자리를 걷어냈습니다.', 'good', 2600);
                if (r.refund && r.refund.res && r.refund.amount > 0.009) {
                  var rm = S.resourceMeta(r.refund.res);
                  GM.fx.resourcePop(n.x, n.y - 0.5, r.refund.res,
                    '+' + U.fmt(r.refund.amount, r.refund.amount < 10 ? 1 : 0) + ' ' + rm.name, rm.color);
                }
                GM.fx.dust(n.x, n.y, 10, '#c8a874');
                if (r.resources) S.applyLiveResources(r.resources);
                S.dropNode(r.nodeId || n.id);
                S.clearSelection();
                GM.hud.hideContext();
              });
            }, '걷어낸다');
        }
      });
    }
    acts.push({ label: '닫는다', cls: 'btn-ghost', onClick: function () { S.clearSelection(); GM.hud.hideContext(); } });

    GM.hud.showContext({
      icon: meta.icon, title: meta.name, facts: facts, actions: acts,
      note: n.depleted ? '다 캔 자리입니다. 시간이 지나면 다시 우거집니다.'
        : (near ? '손이 닿습니다 — 누르고 있으면 계속 ' + meta.verb + '.' : '가까이 가야 손이 닿습니다.')
    });
  }

  /* ══════════ ★ §19-D(F03-6) 건물 손일을 한 문으로 ══════════
     「왜」 한 곳으로 모았나 — 여태 손일을 부르는 길은 건물 패널의 단추 하나뿐이었다.
     이제 E 키도 같은 일을 하므로, 두 길이 각자 셈을 베껴 쓰면 한쪽만 고쳐지는 날이 온다.
     서버 계약(handWork 명령·거리·쿨다운 판정)은 한 줄도 건드리지 않는다 — 부르는 길만 늘린다. */
  function runHandWork(b, refresh) {
    if (!b) return;
    GM.net.send('handWork', { structureId: b.id }, function (r) {
      if (!r) return;
      if (!r.ok) { U.toast((r.error && r.error.message) || '지금은 할 수 없습니다.', 'warn'); return; }
      GM.sfx.play('build');
      paintHandWork(b, r);
      if (refresh) open(b.id);   /* 패널이 열려 있을 때만 값을 새로 고친다 */
    });
  }
  function paintHandWork(b, r) {
    var px = r.x != null ? r.x : b.x, py = r.y != null ? r.y : b.y;
    var shown = 0;
    Object.keys(r.gained || {}).forEach(function (k) {
      var v = r.gained[k];
      if (!(v > 0.009)) return;
      var meta = S.resourceMeta(k);
      GM.fx.resourcePop(px + (shown * 0.4 - 0.2), py - 0.5, k,
        '+' + U.fmt(v, v < 10 ? 1 : 0) + ' ' + meta.name, meta.color);
      shown += 1;
    });
    paintHandWorkExtras(px, py, r);
    if (r.resources) S.applyLiveResources(r.resources);
    GM.fx.sparkle(px, py, 10, '#fff0c8');
  }
  function paintHandWorkExtras(px, py, r) {
    if (r.gold) GM.fx.floatText(px, py - 0.9, '+' + r.gold + ' 골드', '#f6cf7a');
    if (r.buildPoints) GM.fx.floatText(px, py - 0.9, '공사 +' + r.buildPoints, '#c8e6a0');
    if (r.healed) GM.fx.floatText(px, py - 0.9, '+' + U.fmt(r.healed, 0) + ' 체력', '#8fd06a');
    if (r.morale != null) U.toast('마을의 사기가 조금 올랐습니다.', 'good');
  }

  /** 손이 닿는 거리 — 서버(balance.handWork.reachTiles)와 **같은 자**를 쓴다. 다르면 「E 는 떴는데 멀다고 한다」가 된다. */
  function handReach() {
    var c = S.cfg();
    var v = c && c.balance && c.balance.handWork && c.balance.handWork.reachTiles;
    return v == null ? 3.2 : v;
  }
  /** ★ §19-D(F03-6) — 지금 서 있는 자리에서 손이 닿는, 손일이 있는 건물 하나(가장 가까운 것) */
  function handWorkNear() {
    var p = GM.avatar && GM.avatar.pos && GM.avatar.pos();
    if (!p) return null;
    var list = S.structures(), best = null, bd = 1e9;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (!b || !b.handWork || b.x == null || b.ruined || b.inactive || b.work) continue;
      var f = S.footprintOfThing(b), c = S.centerOfThing(b);
      var d = Math.hypot(c.x - p.x, c.y - p.y) - Math.max(f.w, f.h) / 2;
      if (d < bd && d <= handReach()) { bd = d; best = b; }
    }
    return best;
  }

  GM.structure = { open: open, openSite: openSite, openFence: openFence, openNode: openNode,
                   openSettlement: openSettlement, reqRow: reqRow, reqRowOf: reqRowOf,
                   refreshOpen: refreshOpen,
                   /* ★ §19-D(F03-6) — E 키가 쓰는 두 문 */
                   handWorkNear: handWorkNear, runHandWork: runHandWork };
})(window);
