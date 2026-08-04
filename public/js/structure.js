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
    return body;
  }

  /* ══════════ ★ §13-D-5 — 연구 갈래 ══════════ */
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
    }
    var list = U.el('div', 'rs-list');
    (r.list || []).forEach(function (x) {
      var row = U.el('div', 'rs-item' + (x.done ? ' done' : '') + (x.active ? ' active' : '') + (x.ready ? ' ready' : ''));
      row.setAttribute('data-research', x.key);
      var head = U.el('div', 'rs-h');
      head.appendChild(GM.icons.img('research', 18));
      head.appendChild(U.el('b', null, x.name));
      if (x.done) head.appendChild(U.el('span', 'rs-tag ok', '끝남'));
      else if (x.active) head.appendChild(U.el('span', 'rs-tag', '진행 중'));
      else head.appendChild(U.el('span', 'rs-tag', x.days + '일'));
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
      acts.push({
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
        label: b.ruined ? '다시 세운다' : '수리한다', cls: 'btn-good', id: 'st-repair',
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
          tip: '새 자리를 고르면 헐었다가 다시 세웁니다',
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

    GM.hud.showContext({
      icon: GM.build.iconOf(b.key),
      title: b.name + (b.ruined ? ' (부서짐)' : ''),
      facts: facts, extra: extra, actions: acts,
      note: (S.buildingDef(b.key) || {}).desc || null
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
    if (c.mode === 'relocate') facts.push({ k: '마디', v: c.phase === 'rebuild' ? '다시 세우기' : '헐어 내기' });

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
    acts.push({ label: '닫는다', cls: 'btn-ghost', onClick: function () { S.clearSelection(); GM.hud.hideContext(); } });

    GM.hud.showContext({
      icon: meta.icon, title: meta.name, facts: facts, actions: acts,
      note: n.depleted ? '다 캔 자리입니다. 시간이 지나면 다시 우거집니다.'
        : (near ? '손이 닿습니다 — 누르고 있으면 계속 ' + meta.verb + '.' : '가까이 가야 손이 닿습니다.')
    });
  }

  GM.structure = { open: open, openSite: openSite, openFence: openFence, openNode: openNode,
                   openSettlement: openSettlement, reqRow: reqRow, reqRowOf: reqRowOf,
                   refreshOpen: refreshOpen };
})(window);
