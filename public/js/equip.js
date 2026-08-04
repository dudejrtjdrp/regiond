/* equip.js — 캐릭터 창 (단축키 C). GDD3 §13-D-3·4.
   내가 든 것과 두른 것, 대장간에서 벼릴 수 있는 것, 그리고 특성을 깃들이는 자리.
   ★ 조건 가시화(§12-3): 못 만드는 것은 숨기지 않는다 — 무엇이 얼마나 모자란지 빨강으로 적는다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var openBack = null;
  var lastSlot = 'weapon';

  function eq() { return S.equipment(); }

  /* ── 값 한 줄: 모자란 것만 빨강 (§12-3) ── */
  function costRow(cost, gold, missing, goldShort) {
    var wrap = U.el('span', 'eq-cost');
    var miss = {};
    (missing || []).forEach(function (m) { miss[m.resource] = m; });
    Object.keys(cost || {}).forEach(function (res) {
      var m = S.resourceMeta(res);
      var chip = U.el('span', 'eq-c' + (miss[res] ? ' bad' : ''));
      chip.appendChild(GM.icons.img(iconOf(res), 14));
      chip.appendChild(U.el('span', null, m.name + ' ' +
        (miss[res] ? (U.fmt(miss[res].have, 0) + '/' + U.fmt(cost[res], 0)) : U.fmt(cost[res], 0))));
      wrap.appendChild(chip);
    });
    if (gold > 0) {
      var g = U.el('span', 'eq-c' + (goldShort ? ' bad' : ''));
      g.appendChild(GM.icons.img('coin', 14));
      g.appendChild(U.el('span', null, goldShort
        ? (U.fmt(goldShort.have, 0) + '/' + U.fmt(gold, 0)) : U.fmt(gold, 0)));
      wrap.appendChild(g);
    }
    return wrap;
  }

  function iconOf(res) {
    var c = S.cfg();
    var meta = c && c.resources && c.resources.meta && c.resources.meta[res];
    return (meta && meta.icon) || 'stone';
  }

  /* ── 지금 낀 것 카드 ── */
  function slotCard(slot, info, view) {
    var card = U.el('div', 'eq-slot' + (info.key ? '' : ' empty'));
    card.setAttribute('data-slot', slot);
    var defs = (S.equipCfg() && S.equipCfg().slotDefs) || {};
    var sd = defs[slot] || { name: slot, icon: 'sword' };

    var head = U.el('div', 'eq-head');
    head.appendChild(GM.icons.img(sd.icon, 22));
    head.appendChild(U.el('span', 'eq-sname', sd.name));
    card.appendChild(head);

    if (!info.key) {
      card.appendChild(U.el('p', 'eq-empty', '아직 아무것도 없습니다.'));
      card.appendChild(U.el('p', 'hint', sd.desc || ''));
      return card;
    }
    var nm = U.el('div', 'eq-name');
    nm.appendChild(U.el('b', null, info.name));
    if (info.plus > 0) nm.appendChild(U.el('span', 'eq-plus', '+' + info.plus));
    card.appendChild(nm);

    var facts = U.el('div', 'eq-facts');
    (info.facts || []).forEach(function (f) {
      var r = U.el('span', 'eq-f');
      r.appendChild(U.el('b', null, f.k));
      r.appendChild(U.el('span', null, ' ' + f.v));
      facts.appendChild(r);
    });
    card.appendChild(facts);

    var e = info.enchant;
    var ench = U.el('div', 'eq-ench' + (e ? ' on' : ''));
    if (e) {
      var dot = U.el('span', 'eq-grade');
      dot.style.background = e.color;
      ench.appendChild(dot);
      ench.appendChild(U.el('b', null, e.gradeName + ' ' + e.name));
      ench.appendChild(U.el('span', null, ' — ' + e.text));
    } else {
      ench.appendChild(U.el('span', null, '깃든 특성이 없습니다'));
    }
    card.appendChild(ench);

    /* 강화 — 공장장이 있어야 열린다 */
    var nx = view.enhance && view.enhance.next && view.enhance.next[slot];
    if (nx) {
      var row = U.el('div', 'eq-enh');
      var b = U.btn('+' + nx.to + ' 로 벼린다', 'btn-small', function () { doEnhance(slot); });
      b.disabled = !nx.ok;
      U.tipSet(b, '강화 +' + nx.to,
        nx.locked ? (view.officerRoleName + '이(가) 자리에 있어야 열립니다')
                  : '한 단계마다 무기는 피해가, 방어구는 경감이 조금씩 붙습니다.');
      row.appendChild(b);
      row.appendChild(costRow(nx.cost, nx.gold, nx.missing,
        nx.gold > 0 && !nx.ok && !nx.missing.length ? { have: S.nation().gold, need: nx.gold } : null));
      if (nx.locked) row.appendChild(U.el('span', 'eq-lock', view.officerRoleName + ' 필요'));
      card.appendChild(row);
    } else if (info.plus >= info.maxPlus) {
      card.appendChild(U.el('p', 'hint', '더 벼릴 수 없습니다 (+' + info.maxPlus + ').'));
    }
    return card;
  }

  /* ── 대장간 목록 ── */
  function catalogList(slot, view) {
    var wrap = U.el('div', 'eq-cat');
    (view.catalog[slot] || []).forEach(function (t) {
      var row = U.el('div', 'eq-row' + (t.equipped ? ' on' : '') + (t.locked ? ' locked' : ''));
      var left = U.el('div', 'eq-l');
      left.appendChild(U.el('span', 'eq-g', String(t.grade)));
      left.appendChild(U.el('b', null, t.name));
      if (t.equipped) left.appendChild(U.el('span', 'eq-tag', '지금 이것'));
      if (t.officer) left.appendChild(U.el('span', 'eq-tag off', '공장장'));
      row.appendChild(left);

      var eff = U.el('div', 'eq-e');
      if (slot === 'weapon') {
        eff.appendChild(U.el('span', null, '피해 ×' + U.fmt(t.damage, 2)));
        eff.appendChild(U.el('span', null, '사냥 +' + Math.round((t.huntYield || 0) * 100) + '%'));
      } else {
        eff.appendChild(U.el('span', null, '경감 ' + Math.round((t.reduction || 0) * 100) + '%'));
        eff.appendChild(U.el('span', null, '다운 저항 ' + Math.round((t.downResist || 0) * 100) + '%'));
      }
      row.appendChild(eff);
      row.appendChild(costRow(t.cost, t.gold, t.missing, t.goldShort));

      var b = U.btn('벼린다', 'btn-small', function () { doCraft(slot, t.key); });
      b.setAttribute('data-craft', t.key);
      b.disabled = !t.ok;
      U.tipSet(b, t.name, t.locked ? t.lockReason
        : (t.equipped ? '이미 들고 있습니다'
          : (t.missing.length ? '자재가 모자랍니다' : '대장간에서 벼립니다')));
      row.appendChild(b);
      wrap.appendChild(row);
    });
    return wrap;
  }

  /* ── 인첸트 ── */
  function enchantBox(view) {
    var box = U.el('div', 'eq-enchbox');
    box.appendChild(U.el('h4', 'eq-sec', '특성 깃들이기'));
    box.appendChild(U.el('p', 'hint',
      '무엇이 붙을지는 고를 수 없습니다. 이미 깃든 것이 있으면 덮어씁니다.'));

    var odds = U.el('div', 'eq-odds');
    (view.enchant.odds || []).forEach(function (o) {
      var chip = U.el('span', 'eq-odd');
      var dot = U.el('span', 'eq-grade');
      dot.style.background = o.color;
      chip.appendChild(dot);
      chip.appendChild(U.el('span', null, o.name + ' ' + Math.round(o.chance * 100) + '%'));
      odds.appendChild(chip);
    });
    box.appendChild(odds);
    box.appendChild(U.el('p', view.saint ? 'eq-saint on' : 'eq-saint',
      view.saint ? '성녀가 자리에 있어 좋은 특성이 붙을 확률이 두 배입니다.'
                 : '성녀가 자리에 있으면 좋은 특성이 붙을 확률이 두 배가 됩니다.'));

    var row = U.el('div', 'eq-enh');
    row.appendChild(costRow(view.enchant.cost, view.enchant.gold, view.enchant.missing, null));
    ['weapon', 'armor'].forEach(function (slot) {
      var has = view.gear[slot] && view.gear[slot].key;
      var b = U.btn((((S.equipCfg() || {}).slotDefs || {})[slot] || {}).name + '에 깃들인다', 'btn-small',
        function () { doEnchant(slot); });
      b.setAttribute('data-enchant', slot);
      b.disabled = !view.enchant.ok || !has;
      U.tipSet(b, '특성 깃들이기', has ? '등급을 뽑고 그 등급에서 특성 하나가 붙습니다.' : '먼저 벼려야 합니다.');
      row.appendChild(b);
    });
    box.appendChild(row);
    return box;
  }

  /* ══════════ 명령 ══════════ */
  function refresh() {
    if (!openBack) return;
    var back = openBack;
    var body = back.__body;
    if (!body) return;
    body.innerHTML = '';
    body.appendChild(buildBody());
  }

  function doCraft(slot, key) {
    GM.net.send('craftEquipment', { slot: slot, key: key }, function (r) {
      if (!r) return;
      if (!r.ok) { U.toast((r.error && r.error.message) || '벼리지 못했습니다.', 'warn', 3200); GM.sfx.play('deny'); return; }
      U.toast(r.name + '을(를) 벼렸습니다.', 'good', 2600);
      GM.sfx.play('unlock');
      if (GM.avatar && GM.avatar.markGear) GM.avatar.markGear();
      refresh();
    });
  }
  function doEnhance(slot) {
    GM.net.send('enhanceEquipment', { slot: slot }, function (r) {
      if (!r) return;
      if (!r.ok) { U.toast((r.error && r.error.message) || '더 벼리지 못했습니다.', 'warn', 3200); GM.sfx.play('deny'); return; }
      U.toast('+' + r.plus + ' 이(가) 되었습니다.', 'good', 2600);
      GM.sfx.play('gain');
      if (GM.avatar && GM.avatar.markGear) GM.avatar.markGear();
      refresh();
    });
  }
  function doEnchant(slot) {
    GM.net.send('enchantEquipment', { slot: slot }, function (r) {
      if (!r) return;
      if (!r.ok) { U.toast((r.error && r.error.message) || '깃들이지 못했습니다.', 'warn', 3200); GM.sfx.play('deny'); return; }
      var e = r.enchant;
      U.banner({ icon: 'gem', kind: 'good', title: e.gradeName + ' ' + e.name,
                 sub: e.text + (r.replaced ? ' · 앞의 특성을 덮었습니다' : ''), ms: 3200 });
      GM.sfx.play('unlock');
      if (GM.avatar && GM.avatar.markGear) GM.avatar.markGear();
      refresh();
    });
  }

  /* ══════════ 창 ══════════ */
  function buildBody() {
    var view = eq();
    var body = U.el('div', 'eqwrap');
    if (!view) {
      body.appendChild(U.el('p', 'empty', '아직 벼릴 자리가 없습니다.'));
      return body;
    }
    if (!view.smithy) {
      body.appendChild(U.el('p', 'eq-warn', '대장간이 서야 벼릴 수 있습니다.'));
    }

    var slots = U.el('div', 'eq-slots');
    slots.appendChild(slotCard('weapon', view.gear.weapon, view));
    slots.appendChild(slotCard('armor', view.gear.armor, view));
    body.appendChild(slots);

    var fx = view.effects || {};
    var sum = U.el('div', 'eq-sum');
    function chip(label, value, tip) {
      var c = U.el('span', 'eq-s');
      c.appendChild(U.el('b', null, label));
      c.appendChild(U.el('span', null, ' ' + value));
      if (tip) U.tipSet(c, label, tip);
      sum.appendChild(c);
    }
    chip('피해', '×' + U.fmt(fx.damage || 1, 2), '휘두를 때의 배수입니다. 사냥에도 같이 붙습니다.');
    chip('피해 경감', Math.round((fx.reduction || 0) * 100) + '%', '맞을 때 덜어 내는 몫입니다.');
    chip('다운 저항', Math.round((fx.downResist || 0) * 100) + '%', '쓰러져 있는 시간이 그만큼 짧아집니다.');
    if (fx.harvest) chip('거두기', '+' + Math.round(fx.harvest * 100) + '%', '깃든 특성의 몫입니다.');
    if (fx.lumber) chip('벌목', '+' + Math.round(fx.lumber * 100) + '%', '깃든 특성의 몫입니다.');
    if (fx.moveSpeed) chip('걸음', '+' + Math.round(fx.moveSpeed * 100) + '%', '깃든 특성의 몫입니다.');
    if (fx.nightVision) chip('밤눈', '+' + U.fmt(fx.nightVision, 1) + '칸', '밤에 그만큼 더 보입니다.');
    body.appendChild(sum);

    var tabs = U.el('div', 'eq-tabs');
    ['weapon', 'armor'].forEach(function (slot) {
      var defs = (S.equipCfg() && S.equipCfg().slotDefs) || {};
      var b = U.btn((defs[slot] || {}).name || slot, 'tab' + (lastSlot === slot ? ' on' : ''), function () {
        lastSlot = slot;
        refresh();
      });
      b.setAttribute('data-eqtab', slot);
      tabs.appendChild(b);
    });
    body.appendChild(tabs);
    body.appendChild(catalogList(lastSlot, view));
    body.appendChild(enchantBox(view));
    return body;
  }

  function open() {
    if (!S.uiOn('panel.equipment')) { U.toast('아직 벼릴 자리가 없습니다.', 'warn'); return null; }
    var back = U.openModal({
      title: '내 몸과 장비', width: '720px', key: 'equip',
      icon: GM.icons.img('anvil', 22),
      body: buildBody(),
      footer: U.btn('닫는다', 'btn-ghost', function () { U.closeTopModal(); }),
      onClose: function () { openBack = null; }
    });
    openBack = back;
    return back;
  }

  GM.equip = { open: open, refresh: refresh };
})(window);
