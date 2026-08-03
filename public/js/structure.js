/* structure.js — 건물 한 채의 정보 패널 (GDD3 §7).
   건물을 누르면 이름·단계·효과·내구도가 뜨고 [개축]·[수리] 를 여기서 한다.
   ★ 개별 건물 티어다 — 같은 종류라도 한 채씩 따로 올린다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  function open(structureId) {
    var b = S.structureById(structureId);
    if (!b) { GM.hud.hideContext(); return; }
    S.selectTarget('structureId', structureId);
    /* ★ GDD3 §12-2 — 본부를 누르면 건물 정보가 아니라 **정착지 패널**이 열린다 */
    if (b.hq) { openSettlement(b); return; }
    render(b);
  }

  /* ══════════ ★ 조건 한 줄 (GDD3 §12-3 전역 원칙) ══════════
     충족 = 초록 체크 / 미충족 = 빨강 + 흐림 + 「현재값/필요값」. 화면 어디서나 같은 얼굴이다. */
  function reqRow(ok, text, have, need, unit) {
    var row = U.el('div', 'req-row ' + (ok ? 'ok' : 'bad'));
    row.appendChild(U.el('span', 'rq-mark', ok ? '✔' : '✕'));
    row.appendChild(U.el('span', 'rq-t', text));
    if (need != null) {
      row.appendChild(U.el('span', 'rq-v',
        ok ? (U.fmt(need, 0) + (unit || '')) : (U.fmt(have, 0) + '/' + U.fmt(need, 0) + (unit || ''))));
    }
    return row;
  }

  /**
   * ★ GDD3 §12-2 — 정착지 패널.
   *   "영토가 넓어지는 조건을 모르겠다"에 대한 답이다. 지금 단계·다음 단계 조건표(초록/빨강+현재값/필요값)·
   *   주민 유입 조건과 다음 사람까지의 진행바, 그리고 조건이 다 차면 켜지는 [승격] 단추.
   */
  function openSettlement(b) {
    var t = S.tier();
    var nx = t.next;
    var h = S.housing() || {};
    var arr = h.arrival || null;

    var body = U.el('div', 'settle');

    var head = U.el('div', 'se-head');
    head.appendChild(U.el('span', 'se-name', t.name || '야영지'));
    head.appendChild(U.el('span', 'se-next', nx ? ('다음 — ' + nx.name) : '끝이 없는 길'));
    body.appendChild(head);
    if (t.line) body.appendChild(U.el('p', 'se-line', t.line));

    /* ① 다음 단계 조건 체크리스트 */
    if (nx) {
      body.appendChild(U.el('h4', 'se-sec', '다음 단계 조건'));
      var list = U.el('div', 'req-list');
      (nx.reqs || []).forEach(function (r) {
        list.appendChild(reqRow(r.ok, r.text, r.have, r.need));
      });
      body.appendChild(list);
      body.appendChild(U.el('p', 'se-line',
        '오르면 땅이 반경 ' + U.fmt(nx.fromRadius, 0) + ' → ' + U.fmt(nx.radius, 0) + ' 로 넓어지고, '
        + '시야와 손놀림도 함께 자랍니다.'));
    }

    /* ② 주민 유입 조건 + 다음 사람까지 진행바 (§12-4) */
    body.appendChild(U.el('h4', 'se-sec', '사람이 찾아오는 조건'));
    if (arr) {
      var rl = U.el('div', 'req-list');
      (arr.reqs || []).forEach(function (r) {
        var row = reqRow(r.ok, r.text, r.have, r.need, r.unit);
        if (r.detail) U.tipSet(row, r.text, r.detail);
        rl.appendChild(row);
      });
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
      var missing = (nx.reqs || []).filter(function (r) { return !r.ok; });
      acts.push({
        label: '승격한다 — ' + nx.name, cls: 'btn-primary', id: 'se-promote',
        disabled: !nx.ready,
        tip: nx.ready ? '지금 올릴 수 있습니다' : ('아직 모자랍니다 — ' + missing.map(function (r) {
          return r.text + ' ' + U.fmt(r.have, 0) + '/' + U.fmt(r.need, 0);
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
                   openSettlement: openSettlement, reqRow: reqRow };
})(window);
