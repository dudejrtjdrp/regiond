/* residents.js — 주민 조작. 클릭 선택 / 드래그 박스 / 같은 일 전체 선택, 우클릭 명령.
   ★ v3 — 주민은 무리가 아니라 사람이다. 이름이 있고 얼굴이 있다(60명까지 1유닛 = 1명).
   서버는 "누가 어느 자리에 붙었나"만 권위로 안다 — 걷는 연출은 클라의 몫이다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var lastClickAt = 0, lastClickId = null;

  /* ══════════ 선택 ══════════ */
  function residentAt(wx, wy, radius) {
    var r = radius === undefined ? 0.75 : radius;
    var best = null, bd = 1e9;
    S.residents().forEach(function (v) {
      var a = GM.world.unitPos(v.id) || v;
      var d = Math.hypot(a.x - wx, a.y - wy);
      if (d < r && d < bd) { bd = d; best = v; }
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
        U.toast(placed + '명이 ' + name + '에 붙었습니다'
          + (left ? ' · ' + left + '명은 자리가 없어 남았습니다 (' + res.used + '/' + res.slots + ')' : ''),
          left ? 'warn' : 'good', left ? 3600 : 2000);
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
      ]
    });
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
    GM.fx.ring(p.x, p.y, '#8dbb6d', 0.3, 1.6, 0.7);
    /* 처음 몇 명은 카메라가 맞이한다 */
    if ((p.total || p.population) <= 2) {
      GM.camera.moveTo((p.x + town.x) / 2, (p.y + town.y) / 2);
    }
  }

  GM.residents = {
    selectAt: selectAt, selectBox: selectBox, selectSameJob: selectSameJob,
    selectAllIdle: selectAllIdle, command: command, targetAt: targetAt,
    renderPanel: renderPanel, openPanel: openPanel, residentAt: residentAt,
    nearestIdle: nearestIdle, arrived: arrived
  };
})(window);
