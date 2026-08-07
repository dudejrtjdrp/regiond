/* residents.js — 주민 조작. 클릭 선택 / 드래그 박스 / 같은 일 전체 선택, 우클릭 명령.
   ★ v3 — 주민은 무리가 아니라 사람이다. 이름이 있고 얼굴이 있다(60명까지 1유닛 = 1명).
   서버는 "누가 어느 자리에 붙었나"만 권위로 안다 — 걷는 연출은 클라의 몫이다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var lastClickAt = 0, lastClickId = null;

  /* ══════════ 선택 ══════════ */
  /* ★ Sprint 1 — 판정은 **그려진 몸**으로 한다. 옛 판정은 발끝 중심 반경 0.75 원이었는데
     스프라이트는 발끝에서 0.8칸 위까지 그려져, 머리·어깨를 누르면 빗나가 뒤의 건물이 잡혔다
     (「주민을 고르려는데 건물이 열린다」의 절반 — 나머지 절반은 건물의 ±1칸 여유, input.js).
     사각형은 world.drawResidents 가 그리는 자와 같다: x ±0.36, y −0.8 ~ +0.12 (+여유 약간). */
  function residentAt(wx, wy) {
    var best = null, bd = 1e9;
    S.residents().forEach(function (v) {
      var a = GM.world.unitPos(v.id) || v;
      if (wx < a.x - 0.42 || wx > a.x + 0.42 || wy < a.y - 0.88 || wy > a.y + 0.2) return;
      var d = Math.hypot(a.x - wx, (a.y - 0.34) - wy);   // 몸통 중심에서 잰다 — 겹치면 가까운 몸
      if (d < bd) { bd = d; best = v; }
    });
    return best;
  }

  function selectAt(wx, wy, additive) {
    if (!S.uiOn('panel.residents')) return false;
    var v = residentAt(wx, wy);
    if (!v) return false;
    var now = Date.now();
    if (lastClickId === v.id && now - lastClickAt < 380) { selectSameJob(v.job); return true; }
    lastClickId = v.id; lastClickAt = now;
    var cur = additive ? (S.S.selection.residents || []).slice() : [];
    if (cur.indexOf(v.id) < 0) cur.push(v.id);
    S.selectResidents(cur);
    GM.sfx.play('tap');
    renderPanel();
    return true;
  }

  function selectBox(x0, y0, x1, y1, additive) {
    if (!S.uiOn('panel.residents')) return 0;
    var ax = Math.min(x0, x1), bx = Math.max(x0, x1);
    var ay = Math.min(y0, y1), by = Math.max(y0, y1);
    var ids = additive ? (S.S.selection.residents || []).slice() : [];
    S.residents().forEach(function (v) {
      var a = GM.world.unitPos(v.id) || v;
      if (a.x >= ax - 0.5 && a.x <= bx + 0.5 && a.y >= ay - 0.5 && a.y <= by + 0.5) {
        if (ids.indexOf(v.id) < 0) ids.push(v.id);
      }
    });
    S.selectResidents(ids);
    if (ids.length) GM.sfx.play('tap');
    renderPanel();
    return ids.length;
  }

  function selectSameJob(job) {
    var ids = S.residents().filter(function (v) { return v.job === job; }).map(function (v) { return v.id; });
    S.selectResidents(ids);
    GM.sfx.play('gain');
    U.toast(S.jobMeta(job).name + ' ' + ids.length + '명을 모두 골랐습니다.', 'good', 2000);
    renderPanel();
    return ids.length;
  }

  function selectAllIdle() {
    var ids = S.residents().filter(function (v) { return v.job === 'idle'; }).map(function (v) { return v.id; });
    S.selectResidents(ids);
    renderPanel();
    return ids.length;
  }

  /* ══════════ 명령 ══════════ */
  function targetAt(x, y) {
    var n = S.nodeAt(x, y);
    if (n && !n.depleted && S.fogAt(x, y) >= 1) return { kind: 'node', id: n.id, x: n.x, y: n.y, obj: n };
    var best = null, bd = 1e9;
    S.workPosts().forEach(function (p) {
      var d = Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
      if (d <= 1.6 && d < bd) { bd = d; best = { kind: p.kind === 'site' ? 'site' : 'post', id: p.id, x: p.x, y: p.y, obj: p }; }
    });
    return best;
  }

  function command(x, y) {
    var ids = (S.S.selection.residents || []).slice();
    if (!ids.length) return false;
    var t = targetAt(x, y);
    if (t) {
      var name = t.obj.name || '그 자리';
      GM.net.send('commandVillagers', { ids: ids, order: { type: 'work', nodeId: t.id } }, function (res) {
        if (!res || !res.ok) return;
        var placed = (res.placed || []).length;
        var left = (res.rejected || []).length;
        /* ★ §16-14 — 자리가 다 차면 곁의 같은 일터로 흩어진다. 흩어진 몫도 함께 알린다. */
        var tail = '';
        if (res.spread) tail += ' · ' + res.spread + '명은 곁의 ' + (res.spreadNodes || 1) + '곳으로 흩어졌습니다';
        if (left) tail += ' · ' + left + '명은 자리가 없어 남았습니다 (' + res.used + '/' + res.slots + ')';
        U.toast(placed + '명이 ' + name + ' 곁에 붙었습니다' + tail,
          left ? 'warn' : 'good', (left || res.spread) ? 3600 : 2000);
      });
      GM.world.ping(t.x, t.y, '#8dfa8d');
      GM.sfx.play('click');
      return true;
    }
    var fog = S.fogAt(x, y);
    if (fog < 1) {
      GM.net.send('commandVillagers', { ids: ids, order: { type: 'scout', x: x, y: y } });
      GM.world.ping(x, y, '#f6cf7a');
      GM.sfx.play('click');
      U.toast('안개 속을 살피러 보냅니다.', 'good', 2000);
      return true;
    }
    GM.net.send('commandVillagers', { ids: ids, order: { type: 'move', x: x, y: y } });
    GM.world.ping(x, y, '#a8c8ff');
    GM.sfx.play('tap');
    return true;
  }

  /* ══════════ ★ GDD3 §13-D-1 — 능력치 ══════════
     네 수치를 눈금으로 보이고, 지금 하는 일에 잘 맞는 것에는 초록 테를 두른다.
     수치를 그대로 적는 까닭: 「손재주 8」이 「수확이 조금 낫다」보다 정확하고, 사람을 고를 근거가 된다. */
  function statBars(v, opts) {
    var o = opts || {};
    var wrap = U.el('div', 'st-stats' + (o.big ? ' big' : ''));
    if (!v || !v.stats) return wrap;
    var max = (S.statsCfg() && S.statsCfg().max) || 10;
    S.statOrder().forEach(function (key) {
      var d = S.statDefs()[key] || {};
      var val = v.stats[key] || 0;
      var fit = S.statFit(v, key);
      var row = U.el('div', 'sb' + (fit ? ' fit' : ''));
      row.appendChild(U.el('span', 'sb-n', d.short || d.name || key));
      var bar = U.el('span', 'sb-bar');
      var fill = U.el('span', 'sb-fill');
      fill.style.width = Math.round((val / max) * 100) + '%';
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(U.el('span', 'sb-v', String(val)));
      U.tipSet(row, (d.name || key) + ' ' + val + '/' + max,
        (d.desc || '') + (fit ? '\n지금 하는 일에 잘 맞습니다.' : ''));
      wrap.appendChild(row);
    });
    return wrap;
  }

  /* ══════════ 선택 패널 ══════════ */
  function counts(ids) {
    var out = {};
    ids.forEach(function (id) {
      var v = S.residentById(id);
      if (!v) return;
      out[v.job || 'idle'] = (out[v.job || 'idle'] || 0) + 1;
    });
    return out;
  }

  function renderPanel() {
    var sel = S.S.selection;
    if (!sel) return;
    if (sel.residents && sel.residents.length) return renderResidentPanel(sel.residents);
    if (sel.nodeId) return GM.structure.openNode(sel.nodeId);
    if (sel.structureId) return GM.structure.open(sel.structureId);
    if (sel.siteId) return GM.structure.openSite(sel.siteId);
    if (sel.fenceId) return GM.structure.openFence(sel.fenceId);
    GM.hud.hideContext();
  }

  function renderResidentPanel(ids) {
    var c = counts(ids);
    var names = ids.slice(0, 3).map(function (id) {
      var v = S.residentById(id);
      return v ? v.name : '';
    }).filter(Boolean).join(' · ');
    var extra = U.el('div', 'sel-strip');
    /* ★ §13-D-1 — 한 사람만 골랐으면 그 사람의 능력치를 그대로 보여 준다 */
    if (ids.length === 1) {
      var only = S.residentById(ids[0]);
      if (only) {
        var box = U.el('div', 'sel-one');
        box.appendChild(statBars(only, { big: true }));
        if (only.fit && only.fit.best) {
          box.appendChild(U.el('p', 'hint',
            (only.fit.ok ? '이 일에 잘 맞습니다 — ' : '더 잘 맞는 일이 있을지 모릅니다 — ')
            + S.statName(only.fit.best.key) + ' ' + only.fit.best.value));
        }
        extra.appendChild(box);
      }
    }
    Object.keys(c).forEach(function (job) {
      var m = S.jobMeta(job);
      var chip = U.el('div', 'sel-folk');
      chip.style.borderColor = m.color;
      chip.appendChild(GM.icons.img(m.icon, 20));
      chip.appendChild(U.el('span', 'sf-n', m.name));
      chip.appendChild(U.el('span', 'sf-c', '×' + c[job]));
      U.tipSet(chip, m.name + ' ' + c[job] + '명', '같은 일을 하는 사람을 두 번 누르면 전부 골라집니다.');
      extra.appendChild(chip);
    });

    GM.hud.showContext({
      icon: 'person',
      title: '주민 ' + ids.length + '명' + (names ? ' — ' + names + (ids.length > 3 ? ' 외' : '') : ''),
      note: '오른쪽 단추를 눌러 일터·빈 땅·안개로 보냅니다.',
      extra: extra,
      actions: [
        { label: '알아서 나누기', cls: 'btn-primary', id: 'ctx-auto-mix',
          tip: '지금 형편에 맞춰 사람을 알맞게 나눕니다',
          onClick: function () {
            var r = S.S.view && S.S.view.recommendations && S.S.view.recommendations.labor;
            GM.net.send('setVillagerMix', { alloc: r || {} });
            U.toast('사람을 다시 나누었습니다.', 'good');
            GM.sfx.play('gain');
          } },
        { label: '노는 사람 모으기', id: 'ctx-idle', onClick: function () {
            var k = selectAllIdle();
            U.toast(k ? '노는 사람 ' + k + '명을 골랐습니다.' : '노는 사람이 없습니다.', k ? 'good' : 'warn');
          } },
        { label: '선택 풀기', cls: 'btn-ghost', onClick: function () { S.clearSelection(); GM.hud.hideContext(); } }
      ].concat(customizeAct(ids))
    });
  }

  /* ★ §19-F3(F07-9) — 한 사람만 골랐을 때만 붙는 손짓. 패널은 동료 것과 같은 것을 쓴다(crewpanel):
     봇이든 주민이든 사람의 이름과 옷을 고르는 손짓은 하나다. */
  function customizeAct(ids) {
    if (ids.length !== 1) return [];
    return [{ label: '이름·옷 바꾸기', id: 'ctx-customize',
      tip: '옷감과 품삯이 조금 듭니다',
      onClick: function () { GM.crewpanel.openResident(ids[0]); } }];
  }

  /** 주민 명부 — 누가 무슨 일을 하고 있는가 */
  function openPanel() {
    if (!S.uiOn('panel.residents')) { U.toast('아직 사람이 없습니다.', 'warn'); return; }
    var list = S.residents();
    var h = S.housing() || {};
    var body = U.el('div');

    var top = U.el('div', 'res-head');
    top.appendChild(U.el('span', null, '사는 사람 ' + list.length + '명 · 잠자리 ' + (h.capacity || 0) +
      ' · 빈자리 ' + (h.freeBeds || 0)));
    body.appendChild(top);
    if (h.arrival) {
      /* ★ §12-4 — "다음 사람까지" 를 날수로 못 박아 준다 */
      var g = U.makeGauge({ height: 18, color: '#6a994e' });
      g.setValue(U.clamp(h.arrival.progress || 0, 0, 1),
        h.arrival.open ? ('다음 사람까지 약 ' + U.fmt(h.arrival.daysUntil, 1) + '일')
                       : (h.arrival.reason || '지금은 오지 않습니다'),
        '주민 유입', '매력도 ' + U.fmt(h.arrival.attractiveness, 2) +
        ' · 약 ' + U.fmt(h.arrival.intervalDays, 1) + '일마다 한 명\n식량 여유 ' + U.fmt(h.arrival.grainDays, 1) + '일치');
      body.appendChild(g);
      /* ★ §12-3 — 못 오는 까닭은 빨강 + 부족분으로 */
      if (!h.arrival.open && h.arrival.reqs) {
        var rl = U.el('div', 'req-list');
        h.arrival.reqs.forEach(function (r) {
          rl.appendChild(GM.structure.reqRowOf(r));   /* ★ §13-A-1 — 조건 행은 한 문으로만 */
        });
        body.appendChild(rl);
      }
    }

    var grid = U.el('div', 'res-grid');
    list.forEach(function (v) {
      var card = U.el('button', 'res-card');
      card.type = 'button';
      card.setAttribute('data-resident', v.id);
      if (v.appearance) card.appendChild(GM.atlas.avatarImg(v.appearance, 34));
      else card.appendChild(GM.icons.img('person', 34));
      var col = U.el('div', 'rs-col');
      col.appendChild(U.el('span', 'rs-n', v.name));
      col.appendChild(U.el('span', 'rs-j', (v.jobName || S.jobMeta(v.job).name) + (v.militia ? ' · 민병' : '')));
      /* ★ §13-D-1 — 명부에서도 한눈에. 적임인 수치에는 초록 테가 선다. */
      col.appendChild(statBars(v));
      card.appendChild(col);
      card.onclick = function () {
        S.selectResidents([v.id]);
        GM.camera.moveTo(v.x, v.y);
        U.closeTopModal();
        renderPanel();
      };
      grid.appendChild(card);
    });
    if (!list.length) grid.appendChild(U.el('p', 'empty', '아직 아무도 살지 않습니다. 잠자리를 지으면 사람이 찾아옵니다.'));
    body.appendChild(grid);

    var foot = U.el('div');
    foot.appendChild(U.btn('알아서 나누기', 'btn-primary', function () {
      var r = S.S.view && S.S.view.recommendations && S.S.view.recommendations.labor;
      GM.net.send('setVillagerMix', { alloc: r || {} });
      U.toast('사람을 다시 나누었습니다.', 'good');
      U.closeTopModal();
    }));
    foot.appendChild(U.btn('닫는다', 'btn-ghost', function () { U.closeTopModal(); }));
    return U.openModal({ title: '우리 사람들', body: body, footer: foot, width: '660px',
                         key: 'residents', icon: GM.icons.img('person', 22) });
  }

  function nearestIdle(x, y, n) {
    var list = S.residents().filter(function (v) { return v.job === 'idle'; });
    if (!list.length) list = S.residents();
    list.sort(function (a, b) { return Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y); });
    return list.slice(0, Math.max(1, n || 1)).map(function (v) { return v.id; });
  }

  /* ══════════ ★ 주민 도착 연출 ══════════ */
  /**
   * ★ GDD3 §13-A-4 — 한 명이 오면 한 명만 걸어온다.
   *   예전엔 여기서 연출용 유령을 하나 더 걸어, 진짜 주민과 나란히 두 사람이 걸어 들어왔다.
   *   진짜 주민은 서버가 이미 영토 밖에 세워 마을로 걷게 해 두었다 — 우리는 이름표만 붙인다.
   */
  function arrived(p) {
    if (!p) return;
    var town = S.myTown();
    if (!town) return;
    GM.world.markArrival(p.id, p.name);
    GM.sfx.play('arrive');
    U.banner({ icon: 'person', kind: 'good', title: p.name + '이(가) 도착했다',
               sub: '이제 ' + p.population + '명이 산다', ms: 3400 });
    /* ★ GDD3 §13-D-1 — 도착 연출의 능력치 카드. 새 사람이 어떤 사람인지 그 자리에서 보인다. */
    statCard(p);
    GM.fx.ring(p.x, p.y, '#8dbb6d', 0.3, 1.6, 0.7);
    /* 처음 몇 명은 카메라가 맞이한다 */
    if ((p.total || p.population) <= 2) {
      GM.camera.moveTo((p.x + town.x) / 2, (p.y + town.y) / 2);
    }
  }

  /** ★ §13-D-1 — 도착 카드: 이름·얼굴·네 수치·가장 뛰어난 것 한 줄 */
  function statCard(p) {
    if (!p || !p.stats || !S.statsCfg()) return null;
    var host = U.qs('#fx-cards') || U.qs('#hud');
    if (!host) return null;
    var card = U.el('div', 'arrive-card');
    card.setAttribute('data-arrive-card', p.id || '');
    var head = U.el('div', 'ac-head');
    if (p.appearance) head.appendChild(GM.atlas.avatarImg(p.appearance, 30));
    else head.appendChild(GM.icons.img('person', 30));
    var nm = U.el('div', 'ac-n');
    nm.appendChild(U.el('b', null, p.name || '새 사람'));
    nm.appendChild(U.el('span', null, p.recruited ? '불러온 사람' : '스스로 찾아온 사람'));
    head.appendChild(nm);
    card.appendChild(head);
    card.appendChild(statBars({ stats: p.stats, job: 'idle' }, { big: true }));
    var best = null;
    S.statOrder().forEach(function (k) {
      if (!best || (p.stats[k] || 0) > best.v) best = { k: k, v: p.stats[k] || 0 };
    });
    if (best) card.appendChild(U.el('p', 'ac-top', S.statName(best.k) + '이(가) ' + best.v + ' — 이 사람의 몫입니다.'));
    host.appendChild(card);
    setTimeout(function () { card.classList.add('out'); }, 4200);
    setTimeout(function () { if (card.parentNode) card.parentNode.removeChild(card); }, 5200);
    return card;
  }

  GM.residents = {
    statBars: statBars, statCard: statCard,
    selectAt: selectAt, selectBox: selectBox, selectSameJob: selectSameJob,
    selectAllIdle: selectAllIdle, command: command, targetAt: targetAt,
    renderPanel: renderPanel, openPanel: openPanel, residentAt: residentAt,
    nearestIdle: nearestIdle, arrived: arrived
  };
})(window);
