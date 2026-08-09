/* build.js — 배치대(B) + 울타리 긋기(F) + 개간.
   ★ GDD3 §7 — 건물은 전부 여기서 고르고 지도에서 손수 자리를 찍는다.
     갈래는 주거·생산·군사·발전·장식 다섯이고, 목록은 서버가 판정한 state.nation.buildable 이 정본이다.
     울타리는 드래그로 선을 긋는다(placeFence). 자동 성곽 링은 폐지됐다.
   고스트 유효성 판정은 서버 규칙의 복제다 — 최종 판정은 언제나 서버가 다시 한다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var bar = null;
  var open_ = false;
  var cat = 'housing';
  /* 배치 입력은 서버 확인 전에는 한 건만 보낸다. 빠른 연타가 같은 현장을 여러 번
     예약해, 화면은 다음 공사 틱까지 멈춘 것처럼 보이던 문제를 막는다. */
  var pendingCommit = false;

  function init() { bar = U.qs('#place-bar'); }

  /* ══════════ 규칙 복제 ══════════ */
  function placeCfg() {
    var w = S.worldCfg();
    return (w && w.buildingPlacement) || { minSpacing: 2, nodeClearance: 1, adjacency: {} };
  }
  function reclaimCfg() {
    var w = S.worldCfg();
    return (w && w.reclaim) || { cost: { wood: 12 }, terrain: ['grass', 'fertile'], maxFields: 40, minSpacing: 2 };
  }
  function cheb(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }

  function canAfford(cost, gold) {
    var n = S.nation();
    if (!n) return true;
    for (var r in (cost || {})) {
      if (!Object.prototype.hasOwnProperty.call(cost, r)) continue;
      var have = r === 'gold' ? (n.gold || 0) : ((n.resources && n.resources[r]) || 0);
      if (have < cost[r]) return false;
    }
    if (gold && (n.gold || 0) < gold) return false;
    return true;
  }
  function costText(cost, gold) {
    var parts = [];
    for (var r in (cost || {})) if (Object.prototype.hasOwnProperty.call(cost, r)) {
      if (!cost[r]) continue;
      parts.push(S.resourceMeta(r).name + ' ' + U.fmt(cost[r], 0));
    }
    if (gold) parts.push('금화 ' + U.fmt(gold, 0));
    return parts.join(' · ');
  }

  /**
   * ★ GDD3 §12-3 — 조건 가시화 전역 원칙의 '비용' 몫.
   *   모자란 자원만 빨강으로, 그것도 **얼마나 모자란지**(석재 12/30)를 그대로 보여 준다.
   *   충분한 자원은 평범한 색으로 남겨 눈이 부족분에만 가게 한다.
   * @returns {HTMLElement} 인라인 span 묶음
   */
  function costNodes(cost, gold) {
    var n = S.nation();
    var wrap = U.el('span', 'cost-line');
    var first = true;
    var add = function (label, have, need) {
      if (!need) return;
      if (!first) wrap.appendChild(U.el('span', 'cost-sep', ' · '));
      first = false;
      var short = have < need;
      var s = U.el('span', 'cost-part' + (short ? ' short' : ''));
      s.textContent = label + ' ' + (short ? U.fmt(have, 0) + '/' + U.fmt(need, 0) : U.fmt(need, 0));
      wrap.appendChild(s);
    };
    for (var r in (cost || {})) if (Object.prototype.hasOwnProperty.call(cost, r)) {
      var have = r === 'gold' ? ((n && n.gold) || 0) : ((n && n.resources && n.resources[r]) || 0);
      add(S.resourceMeta(r).name, have, cost[r]);
    }
    if (gold) add('금화', (n && n.gold) || 0, gold);
    return wrap;
  }

  /** 모자란 자원만 골라 "석재 12/30" 꼴의 글로 (툴팁·토스트용) */
  function shortText(cost, gold) {
    var n = S.nation();
    var out = [];
    for (var r in (cost || {})) if (Object.prototype.hasOwnProperty.call(cost, r)) {
      var have = r === 'gold' ? ((n && n.gold) || 0) : ((n && n.resources && n.resources[r]) || 0);
      if (have < cost[r]) out.push(S.resourceMeta(r).name + ' ' + U.fmt(have, 0) + '/' + U.fmt(cost[r], 0));
    }
    if (gold && (!n || (n.gold || 0) < gold)) out.push('금화 ' + U.fmt((n && n.gold) || 0, 0) + '/' + U.fmt(gold, 0));
    return out.join(' · ');
  }

  /** ★ §19-C — 이 칸에 지을 수 있는가. 매립한 물 칸은 뭍과 똑같이 친다(§17-13). */
  function placeableCell(buildable, x, y) {
    var code = S.terrainKey(x, y);
    if (buildable.indexOf(code) >= 0) return true;
    return code === 'water' && S.onFill(x, y);
  }

  /* 서버의 hqReserveRect와 같은 본부 최종 확장 부지. */
  function hqReserveRect(s) {
    var d = S.buildingDef(s && (s.key || s.building)) || {};
    if (!d.hq || !d.reserveFootprint) return null;
    var w = Math.max(1, Math.round(d.reserveFootprint[0] || 1));
    var h = Math.max(1, Math.round(d.reserveFootprint[1] || 1));
    var c = S.centerOfThing(s);
    var x0 = Math.round(c.x - (w - 1) / 2), y0 = Math.round(c.y - (h - 1) / 2);
    return { x0: x0, y0: y0, x1: x0 + w - 1, y1: y0 + h - 1 };
  }

  /** 고스트 유효성 — {ok, reason?, note?} */
  function validate(pl, x, y) {
    if (!pl) return { ok: false };
    var n = S.nation();
    if (!n) return { ok: false, reason: '아직 정착지가 서지 않았습니다' };
    if (x < 0 || y < 0 || x >= S.mapSize() || y >= S.mapSize()) return { ok: false, reason: '지도 밖입니다' };

    if (pl.kind === 'reclaim') {
      var rc = reclaimCfg();
      var rsp = rc.minSpacing != null ? rc.minSpacing : 2;
      if (!S.inTerritory(x, y)) return { ok: false, reason: '아직 우리 땅이 아닙니다' };
      var code = S.terrainKey(x, y);
      if ((rc.terrain || []).indexOf(code) < 0) return { ok: false, reason: '갈아엎을 수 있는 땅이 아닙니다' };
      var nodes = S.nodeList();
      for (var i = 0; i < nodes.length; i++) if (cheb(nodes[i].x, nodes[i].y, x, y) < rsp) return { ok: false, reason: '이미 무언가 나는 자리입니다' };
      var st = S.structures();
      for (var j = 0; j < st.length; j++) if (st[j].x != null && cheb(st[j].x, st[j].y, x, y) < rsp) return { ok: false, reason: '건물과 너무 가깝습니다' };
      var fields = nodes.filter(function (o) { return o.type === 'field'; }).length;
      if (fields >= (rc.maxFields || 40)) return { ok: false, reason: '더 일굴 밭이 없습니다' };
      if (!canAfford(rc.cost)) return { ok: false, reason: shortText(rc.cost) + ' 가 모자랍니다' };
      return { ok: true, note: '밭을 일군다 · ' + costText(rc.cost) };
    }

    /* 건물 — ★ §12-1 판정 단위는 풋프린트 사각형이다 (서버 structures.validatePlacement 의 거울) */
    var cfg = placeCfg();
    var key = pl.key;
    var f = S.footprintOf(key);
    var an = S.anchorFromCell(key, x, y);
    var rect = { x0: an.x, y0: an.y, x1: an.x + f.w - 1, y1: an.y + f.h - 1 };
    var size = S.mapSize();
    if (rect.x0 < 0 || rect.y0 < 0 || rect.x1 >= size || rect.y1 >= size) return { ok: false, reason: '지도 밖입니다' };
    var w = S.worldCfg();
    var buildable = (w && w.terrain && w.terrain.buildable) || ['grass', 'forest', 'fertile'];
    /* ★ §17-14 — 개척 깃발(allowOutsideTerritory)은 유일하게 영토 밖에 선다.
       본영에서 claim.maxRangeFromTown 안이면 된다(서버 validatePlacement 의 거울). */
    var defA = S.buildingDef(key) || {};
    var townA = S.myTown();
    var maxRange = ((w && w.territory && w.territory.claim) || {}).maxRangeFromTown || 70;
    for (var cy = rect.y0; cy <= rect.y1; cy++) {
      for (var cx2 = rect.x0; cx2 <= rect.x1; cx2++) {
        if (defA.allowOutsideTerritory) {
          if (townA && Math.hypot(townA.x - cx2, townA.y - cy) > maxRange + 0.001) {
            return { ok: false, reason: '본영에서 너무 멉니다' };
          }
        } else if (!S.inTerritory(cx2, cy)) return { ok: false, reason: '아직 우리 땅이 아닙니다' };
        /* ★ §19-C — 매립한 물 칸은 뭍으로 친다(서버 structures.validatePlacement 와 같은 §17-13 규칙).
           이 한 줄이 없어 화면이 먼저 막아 세웠다 — 서버는 허락하는데 커서가 붉었다(B08-2). */
        if (!placeableCell(buildable, cx2, cy)) return { ok: false, reason: '여기에는 지을 수 없습니다' };
      }
    }
    var sp = cfg.minSpacing || 2;
    var ignore = pl.ignoreId || null;
    var stl = S.structures();
    for (var a = 0; a < stl.length; a++) {
      if (stl[a].x == null || stl[a].id === ignore) continue;
      var reserved = hqReserveRect(stl[a]);
      if (reserved && S.rectGap(reserved, rect) < 1) return { ok: false, reason: '본부 확장 예정 부지입니다' };
      if (S.rectGap(S.rectOfThing(stl[a]), rect) < sp) return { ok: false, reason: '다른 건물과 너무 가깝습니다' };
    }
    var sites = S.sites();
    for (var b = 0; b < sites.length; b++) {
      if (sites[b].x == null || sites[b].structureId === ignore) continue;
      if (S.rectGap(S.rectOfThing(sites[b]), rect) < sp) return { ok: false, reason: '공사 중인 자리와 겹칩니다' };
    }
    var clear = cfg.nodeClearance == null ? 1 : cfg.nodeClearance;
    var nds = S.nodeList();
    for (var c = 0; c < nds.length; c++) {
      if (S.rectGap({ x0: nds[c].x, y0: nds[c].y, x1: nds[c].x, y1: nds[c].y }, rect) < clear) {
        return { ok: false, reason: '자원이 나는 자리입니다' };
      }
    }
    /* Match the server's PERSON_OCCUPIED rule so the ghost is denied immediately. */
    var people = (S.residents() || []).concat(S.S.avatars || []);
    /* 내 움직임은 서버 중계보다 먼저 화면에서 보간된다. 목록에 아직 반영되지 않은
       한 박자도 놓치지 않도록 실제 조작 중인 좌표를 함께 검사한다. */
    if (GM.avatar && GM.avatar.pos) {
      var me = GM.avatar.pos();
      if (me) people.push(me);
    }
    for (var p = 0; p < people.length; p++) {
      var person = people[p];
      if (!Number.isFinite(person.x) || !Number.isFinite(person.y)) continue;
      if (person.x >= rect.x0 - 0.5 && person.x < rect.x1 + 0.5
        && person.y >= rect.y0 - 0.5 && person.y < rect.y1 + 0.5) {
        return { ok: false, reason: '사람이 서 있는 자리에는 지을 수 없습니다.' };
      }
    }
    if (pl.kind === 'relocate') return { ok: true, note: '여기로 옮긴다' };
    var bi = S.buildableOf(key);
    if (bi && !bi.affordable) return { ok: false, reason: shortText(bi.cost, bi.gold) + ' 가 모자랍니다' };
    return { ok: true, note: adjacencyNote(key, x, y) };
  }

  /** 이웃한 자리의 덕 */
  function adjacencyNote(key, x, y) {
    var cfg = placeCfg().adjacency || {};
    var wants = (cfg.byBuilding && cfg.byBuilding[key]) || [];
    if (!wants.length) return null;
    var r = cfg.radius || 5;
    var cnt = 0;
    S.nodeList().forEach(function (nd) {
      if (wants.indexOf(nd.type) < 0) return;
      if (Math.hypot(nd.x - x, nd.y - y) <= r) cnt++;
    });
    if (!cnt) return null;
    var bonus = Math.min(cfg.max || 0.1, cnt * (cfg.perNode || 0.02));
    return '이웃한 자리 ' + cnt + '곳 · 덕 +' + U.pct(bonus, 0);
  }

  /* ══════════ 건설대 ══════════ */
  /** 지금 장에서 실제로 무언가 지을 수 있는 갈래만 탭으로 낸다 */
  function categories() {
    var have = {};
    S.buildable().forEach(function (b) { have[b.category] = 1; });
    if (S.featOn('reclaim')) have.production = 1;       // 개간은 건물이 아니지만 생산 갈래에 산다
    return S.BUILD_CATEGORIES.filter(function (c) { return have[c.key]; });
  }

  /** ★ GDD3 §14-7 — 이 갈래에서 아직 잠긴 건물들(서버가 까닭까지 실어 준다) */
  function lockedIn(category) {
    return S.lockedBuildings().filter(function (b) { return b.category === category; });
  }

  function open(category) {
    // ★ GDD3 §11-1 — 여기까지 오는 길(단추)은 지을 것이 있을 때만 그려진다(hud.canBuildNow).
    //   그래도 방어적으로 한 번 더 본다: 빈 배치대는 열지 않는다.
    var cats = categories();
    if (!cats.length) return;
    var keys = cats.map(function (c) { return c.key; });
    var want = category || (keys.indexOf(cat) >= 0 ? cat : keys[0]);
    if (open_ && cat === want) { close(); return; }
    open_ = true;
    cat = want;
    /* ★ §17-19 — 배치대가 하단 가운데로 내려왔다. 그 자리는 하나뿐이라 선택 패널은 물러난다. */
    if (GM.hud && GM.hud.hideContext) GM.hud.hideContext();
    render();
    GM.sfx.play('page');
  }

  function close(keepPlacing) {
    open_ = false;
    if (!keepPlacing) {
      S.setPlacing(null);
      GM.world.setFencePath(null);
    }
    if (bar) { bar.hidden = true; U.clear(bar); }
  }

  function setCat(next) {
    cat = next;
    S.setPlacing(null);
    render();
    GM.sfx.play('tap');
  }

  var CAT_TITLE = {
    housing: '사람이 살 자리', production: '살림을 불릴 것',
    military: '울타리 앞을 지킬 것', civic: '정착지를 키울 것',
    /* ★ §19-F4(F09-1) */
    research: '궁리를 앞당길 것', decor: '보기 좋은 것'
  };

  function render() {
    bar = bar || U.qs('#place-bar');
    if (!bar || !open_) return;
    U.clear(bar);
    bar.hidden = false;
    var n = S.nation();
    if (!n) return;

    var head = U.el('div', 'pb-head');
    head.appendChild(U.el('span', 'pb-title', CAT_TITLE[cat] || '무엇을 건설할까'));
    var h = S.housing();
    if (cat === 'housing' && h) {
      var g = U.el('span', 'pb-cap');
      g.textContent = '잠자리 ' + h.population + ' / ' + h.capacity;
      U.tipSet(g, '지금 사는 사람과 수용 인원', '빈 잠자리가 있어야 새 사람이 찾아옵니다.');
      head.appendChild(g);
    }
    head.appendChild(U.btn('✕ 닫기', 'btn-sm btn-ghost', close));
    bar.appendChild(head);

    var tabs = U.el('div', 'pb-tabs');
    categories().forEach(function (c) {
      var b = U.el('button', 'pb-tab' + (cat === c.key ? ' on' : ''));
      b.type = 'button';
      b.textContent = c.name;
      b.setAttribute('data-cat', c.key);
      U.tipSet(b, c.name, c.hint);
      b.onclick = function () { setCat(c.key); };
      tabs.appendChild(b);
    });
    bar.appendChild(tabs);

    var row = U.el('div', 'pb-row');
    bar.appendChild(row);

    if (cat === 'production' && S.featOn('reclaim')) {
      var rc = reclaimCfg();
      row.appendChild(item('farmTile', '개간', costNodes(rc.cost),
        '풀밭을 끌어서 밭을 일굽니다. 밭은 파종→새싹→자람→여묾 순으로 자랍니다.',
        canAfford(rc.cost), function () { pick({ kind: 'reclaim' }); }));
    }

    // 서버가 준 buildable 은 이미 '지금 장에서 지을 수 있는 것'만이다 — 잠긴 항목은 아예 오지 않는다
    var list = S.buildable().filter(function (b) { return b.category === cat; });
    list.forEach(function (b) {
      var def = S.buildingDef(b.key) || {};
      var full = !b.multi && b.built > 0;
      var label = b.name + (b.multi && b.built ? ' (' + b.built + ')' : '');
      /* ★ §17-15 — 건축가 전용 건물. 자리가 비어 있으면 잠긴 카드로 그린다(서버 ROLE_REQUIRED 의 거울). */
      if (b.requiresRole && !b.roleReady) {
        var roleReason = (b.roleName || '각료') + '이(가) 자리에 있어야 짓습니다';
        var lockedIt = item(iconOf(b.key), label, roleReason,
          purposeOf(b) + keyFactLine(b) + '\n\n' + roleReason, false, null, null, purposeOf(b));
        lockedIt.classList.add('locked');
        lockedIt.setAttribute('data-locked', b.key);
        U.tipSet(lockedIt, b.name + ' — ' + roleReason,
          purposeOf(b) + keyFactLine(b) + '\n' + roleReason,
          '값: ' + (costText(b.cost, b.gold) || '없음'));
        row.appendChild(lockedIt);
        return;
      }
      /* ★ GDD3 §15-B-2 — 툴팁 첫 줄은 「왜 짓는가」다. 값이나 크기보다 그것이 먼저다. */
      var detail = purposeOf(b) + (def.desc ? '\n' + def.desc : '') + keyFactLine(b);
      var fp = S.footprintOf(b.key);
      if (fp.w > 1 || fp.h > 1) detail += '\n차지하는 자리 ' + fp.w + '×' + fp.h + '칸';
      var aside = (b.buildPoints ? '공사 ' + U.fmt(b.buildPoints, 0) + ' — 현장에서 직접 두드리면 빨리 오릅니다.\n' : '')
        + (b.multi ? '여러 채 건설할 수 있습니다.' : '한 채만 건설합니다.');
      row.appendChild(item(iconOf(b.key), label, costNodes(b.cost, b.gold), detail,
        !full && b.affordable, function () { pick({ kind: 'build', key: b.key }); }, full ? '이미 건설함' : null,
        purposeOf(b), aside));
    });

    /* ★ GDD3 §14-7 — 아직 잠긴 것도 이 갈래 안에 그대로 보인다.
       흐림 + 자물쇠 + 「언제 열리는가」. "없는 줄 알았다"를 막는 유일한 방법은 보여 주는 것이다.
       (§11-1 의 '부재' 원칙은 갈래·시스템 단위에만 적용한다 — 갈래가 안 열렸으면 서버가 아예 안 보낸다.) */
    lockedIn(cat).forEach(function (b) {
      var it = item(iconOf(b.key), b.name, b.lockReason,
        purposeOf(b) + keyFactLine(b) + '\n\n' + b.lockReason,
        false, null, null, purposeOf(b));
      it.classList.add('locked');
      it.setAttribute('data-locked', b.key);
      /* ★ §15-B-2 — 잠긴 것도 「왜 짓는가」가 먼저다. 그래야 열릴 때까지 기다릴 까닭이 생긴다. */
      U.tipSet(it, b.name + ' — 아직 잠김',
        purposeOf(b) + keyFactLine(b) + '\n' + b.lockReason,
        '값: ' + (costText(b.cost, b.gold) || '없음'));
      row.appendChild(it);
    });

    if (cat === 'military' && S.uiOn('panel.fence')) bar.appendChild(fenceStrip());
  }

  function effectLine(key, tier) {
    var t = S.buildingTier(key, tier || 1);
    if (!t || !t.effects || !t.effects.length) return '';
    return '\n' + t.effects.map(function (e) { return e.label + ' ' + e.value; }).join(' · ');
  }

  /* ★ GDD3 §15-B-2 — 「왜 짓는가」 한 줄. 서버가 준 값이 정본이고, 없으면 도감의 같은 줄을 쓴다. */
  function purposeOf(b) {
    if (b && b.purpose) return b.purpose;
    var def = S.buildingDef(b && b.key) || {};
    return def.purpose || def.desc || '';
  }

  /** ★ §15-B-2 — 핵심 수치 1~2개. 서버가 골라 준 keyFacts 가 없으면 1단계 효과표 앞머리를 쓴다. */
  function keyFacts(b) {
    if (b && b.keyFacts && b.keyFacts.length) return b.keyFacts;
    var t = S.buildingTier(b && b.key, 1);
    return (t && t.effects) ? t.effects.slice(0, 2) : [];
  }
  function keyFactLine(b) {
    var f = keyFacts(b);
    if (!f.length) return '';
    return '\n' + f.map(function (e) { return e.label + ' ' + e.value; }).join(' · ');
  }

  function fenceStrip() {
    var wrap = U.el('div', 'pb-segs');
    var fs = S.fenceSummary() || { segments: 0, gates: 0, broken: 0, damaged: 0, costs: {} };
    wrap.appendChild(U.el('span', 'pb-note',
      '울타리 ' + fs.segments + '조각 · 문 ' + fs.gates + (fs.broken ? ' · 부서짐 ' + fs.broken : '')));
    var b1 = U.btn('울타리 긋기 (F)', 'btn-sm btn-primary', function () { openFence(); });
    b1.id = 'fence-draw';
    wrap.appendChild(b1);
    var b2 = U.btn('석벽으로 올리기', 'btn-sm', function () {
      GM.net.send('upgradeFence', {}, function (r) {
        if (r && r.ok) { U.toast(r.upgraded + '조각을 석벽으로 올렸습니다.', 'good'); GM.sfx.play('build'); }
      });
    });
    b2.id = 'fence-upgrade';
    wrap.appendChild(b2);
    var b3 = U.btn('전부 수리', 'btn-sm', repairAllFence);
    b3.id = 'fence-repair';
    b3.disabled = !(fs.broken || fs.damaged);
    wrap.appendChild(b3);
    return wrap;
  }

  function iconOf(key) {
    var map = {
      tent: 'tent', hut: 'house', house: 'house', manor: 'house',
      ranch: 'sheep',
      campfire: 'campfire', well: 'stone', woodpile: 'wood', storage_crate: 'storage',
      granary: 'granary', sawmill: 'axe', quarry_camp: 'pickaxe', hunter_hut: 'bandit',
      storage: 'storage', smelter: 'fuel', smithy: 'anvil', mine_shaft: 'ore', mill: 'grain',
      fence: 'fence', gate: 'gate', watchpost: 'eye', arrow_tower: 'arrowTower',
      barracks: 'barracks', ballista: 'ballista', cannon: 'cannon',
      frost_tower: 'frostTower', flame_tower: 'flameTower',
      trading_post: 'ship', market: 'coin', shrine: 'shrine', consulate: 'consulate', monument: 'tier',
      lamp: 'fuel', banner: 'flag', garden: 'sprout', fountain: 'morale'
    };
    return map[key] || 'hammer';
  }

  /**
   * 배치대 한 칸. cost 는 글이거나 **DOM 묶음**(costNodes — 부족분이 빨강)이다.
   * ★ §12-3 — 못 짓는 까닭이 "값이 모자람"이면 그 자원만 빨갛게 「석재 12/30」으로 보인다.
   */
  function item(icon, name, cost, tip, enabled, onClick, badge, purpose, aside) {
    var b = U.el('button', 'pb-item' + (enabled ? '' : ' off'));
    b.type = 'button';
    b.setAttribute('data-place', name);
    b.appendChild(GM.icons.img(icon, 26));
    b.appendChild(U.el('span', 'pb-n', name));
    /* ★ GDD3 §15-B-2 — 카드 위에 「왜 짓는가」를 그대로 적는다.
       툴팁에만 두면 마우스를 올려야 알 수 있다 — 고르는 순간에 이미 보여야 한다. */
    if (purpose) {
      var w = U.el('span', 'pb-why');
      w.textContent = purpose;
      b.appendChild(w);
    }
    var c = U.el('span', 'pb-c');
    if (badge) c.textContent = badge;
    else if (cost && cost.nodeType === 1) c.appendChild(cost);
    else c.textContent = cost || '';
    b.appendChild(c);
    U.tipSet(b, name + (c.textContent ? ' — ' + c.textContent : ''), tip || '', aside || null);
    b.disabled = !enabled;
    b.onclick = onClick;
    return b;
  }

  function pick(pl) {
    S.setPlacing(pl);
    // Hide the catalog while keeping placement mode active; B opens it again.
    close(true);
    U.toast(pl.kind === 'reclaim' ? '풀밭을 끌어서 밭을 일구세요.' : '지도에서 자리를 골라 누르세요.', 'good', 2400);
  }

  function nameOf(key) {
    var b = S.buildableOf(key);
    if (b) return b.name;
    return S.buildingName(key, 1);
  }

  /* ══════════ 실제 배치 ══════════ */
  function commit(x, y) {
    var pl = S.S.placing;
    if (!pl) return false;
    if (pendingCommit) return false;
    /* 위치 보고는 저빈도라 막 움직인 직후에는 서버가 한 칸 전의 나를 알고 있을 수 있다.
       착공보다 먼저 현재 발 위치를 보내면 같은 소켓 순서로 서버 판정도 최신 좌표를 쓴다. */
    if (pl.kind === 'build' && GM.avatar && GM.avatar.pos) {
      var me = GM.avatar.pos();
      if (me) GM.net.send('lordMove', { x: Math.round(me.x), y: Math.round(me.y) });
    }
    var v = validate(pl, x, y);
    if (!v.ok) {
      U.toast(v.reason || '그 자리에는 놓을 수 없습니다.', 'bad', 2600);
      GM.sfx.play('deny');
      return false;
    }
    /* ★ §12-12 — 이전: 새 자리를 찍으면 해체+재건 현장이 선다 */
    if (pl.kind === 'relocate') {
      pendingCommit = true;
      var sent = GM.net.send('relocateStructure', { structureId: pl.structureId, x: x, y: y }, function (r) {
        pendingCommit = false;
        if (!r) return;
        if (!r.ok) { U.toast((r.error && r.error.message) || '옮길 수 없습니다.', 'bad', 2800); GM.sfx.play('deny'); return; }
        U.toast('옮기기 시작했습니다 — 해체하고 새 자리에 다시 짓습니다.', 'good', 3200);
        GM.sfx.play('build');
        GM.fx.ring(x, y, '#8dfa8d', 0.2, 1.6, 0.5);
      });
      if (!sent) pendingCommit = false;
      S.setPlacing(null);
      return true;
    }
    if (pl.kind === 'build') {
      pendingCommit = true;
      var sent = GM.net.send('placeBuilding', { building: pl.key, x: x, y: y }, function (r) {
        pendingCommit = false;
        if (r && r.ok) {
          GM.fx.dust(x, y, 10);
          if (r.instant && r.structure) {
            U.banner({ icon: 'up', kind: 'good', title: r.structure.name + ' 완공', sub: '' });
          }
        }
      });
      if (!sent) pendingCommit = false;
      GM.sfx.play('build');
      GM.fx.ring(x, y, '#e8a33d', 0.2, 1.4, 0.5);
      S.setPlacing(null);
      setTimeout(render, 300);
    } else if (pl.kind === 'reclaim') {
      GM.net.send('reclaimField', { x: x, y: y });
      GM.sfx.play('dig');
      GM.fx.dust(x, y, 8, '#c8a94a');
      GM.fx.ring(x, y, '#e0c65a', 0.2, 1.2, 0.45);
    }
    return true;
  }

  function commitReclaimBox(x0, y0, x1, y1) {
    var n = 0;
    var ax = Math.min(x0, x1), bx = Math.max(x0, x1);
    var ay = Math.min(y0, y1), by = Math.max(y0, y1);
    for (var y = ay; y <= by && n < 12; y++) {
      for (var x = ax; x <= bx && n < 12; x++) {
        var v = validate({ kind: 'reclaim' }, x, y);
        if (!v.ok) continue;
        GM.net.send('reclaimField', { x: x, y: y });
        GM.fx.dust(x, y, 6, '#c8a94a');
        n++;
      }
    }
    if (n) { GM.sfx.play('dig'); U.toast(n + '곳을 일굽니다.', 'good', 2200); }
    else { U.toast('일굴 수 있는 풀밭이 없습니다.', 'warn'); GM.sfx.play('deny'); }
    return n;
  }

  /* ══════════ ★ 울타리 드래그 ══════════ */
  function openFence() {
    if (!S.uiOn('panel.fence')) { U.toast('아직 울타리를 두를 때가 아닙니다.', 'warn'); return; }
    S.setPlacing({ kind: 'fence' });
    GM.world.setFencePath([]);
    U.toast('지도를 눌러 끌면 선을 따라 울타리가 섭니다. Shift 를 누른 채 놓으면 문이 됩니다.', 'good', 4200);
    GM.sfx.play('page');
  }

  function fenceTileOk(x, y) {
    var cfg = S.fenceCfg();
    if (cfg.requiresTerritory && !S.inTerritory(x, y)) return false;
    var code = S.terrainKey(x, y);
    if ((cfg.blockedTerrain || []).indexOf(code) >= 0) return false;
    var st = S.structures();
    for (var i = 0; i < st.length; i++) if (st[i].x === x && st[i].y === y) return false;
    return true;
  }

  function fenceUnitCost() {
    var fs = S.fenceSummary();
    return (fs && fs.costs && fs.costs.wood) || { wood: 6 };
  }
  function fenceCostText(points) {
    var segs = Math.max(0, (points || 0) - 1);
    if (!segs) return '';
    var unit = fenceUnitCost();
    var total = {};
    for (var k in unit) if (Object.prototype.hasOwnProperty.call(unit, k)) total[k] = unit[k] * segs;
    return segs + '조각 · ' + costText(total);
  }

  /** 드래그가 끝났다 — 모아 둔 꺾은선을 그대로 서버에 넘긴다 */
  function commitFence(points, gateLast) {
    var cfg = S.fenceCfg();
    if (!points || points.length < 2) { U.toast('조금 더 길게 끌어 주세요.', 'warn'); return false; }
    var pts = points.slice(0, cfg.maxPointsPerRequest || 64);
    var gates = gateLast ? [pts.length - 2] : [];
    GM.net.send('placeFence', { points: pts, gates: gates, tier: 1 }, function (r) {
      if (!r) return;
      if (!r.ok) { GM.sfx.play('deny'); return; }
      GM.sfx.play('build');
      U.toast(r.placed + '조각을 세웠습니다' + (r.skipped ? ' (' + r.skipped + '조각은 자리가 안 되어 건너뛰었습니다)' : '') +
        ' · ' + costText(r.cost), r.skipped ? 'warn' : 'good', 3200);
      (r.segments || []).forEach(function (sg, i) {
        setTimeout(function () {
          GM.fx.dust((sg.x1 + sg.x2) / 2, (sg.y1 + sg.y2) / 2, 4, '#c8a874');
        }, i * 26);
      });
    });
    GM.world.setFencePath([]);
    return true;
  }

  /* ══════════ ★ GDD3 §13-D-5 — 철로 드래그 ══════════
     울타리와 같은 끌기지만 놓이는 것은 **선분이 아니라 칸**이다. 위를 걷는 주민이 두 배로 빨라진다. */
  function openRail() {
    var info = S.railInfo();
    if (!info || !info.open) { U.toast('철로를 아직 모릅니다.', 'warn'); return; }
    S.setPlacing({ kind: 'rail' });
    GM.world.setFencePath([]);
    U.toast('지도를 눌러 끌면 지나간 칸에 철로가 깔립니다. 그 위를 걷는 주민은 두 배로 빠릅니다.', 'good', 4200);
    GM.sfx.play('page');
  }

  function railTileOk(x, y) {
    var cfg = S.railCfg() || { blockedTerrain: ['water'], requiresTerritoryMargin: 30 };
    var code = S.terrainKey(x, y);
    if ((cfg.blockedTerrain || []).indexOf(code) >= 0) return false;
    var t = S.myTown();
    if (t) {
      var w = S.worldCfg();
      var base = (w && w.territory && w.territory.baseRadius) || 6;
      if (Math.hypot(t.x - x, t.y - y) > base + (cfg.requiresTerritoryMargin || 30)) return false;
    }
    if (S.onRail(x, y)) return false;
    return true;
  }

  function railCostText(tiles) {
    var cfg = S.railCfg();
    if (!cfg || !tiles) return '';
    var total = {};
    for (var k in cfg.costPerTile) {
      if (Object.prototype.hasOwnProperty.call(cfg.costPerTile, k)) total[k] = cfg.costPerTile[k] * tiles;
    }
    return tiles + '칸 · ' + costText(total);
  }

  function commitRail(points) {
    var cfg = S.railCfg() || { maxPointsPerRequest: 64 };
    if (!points || !points.length) { GM.world.setFencePath([]); return false; }
    var pts = points.slice(0, cfg.maxPointsPerRequest || 64);
    GM.net.send('placeRail', { points: pts }, function (r) {
      if (!r) return;
      if (!r.ok) { U.toast((r.error && r.error.message) || '깔지 못했습니다.', 'warn', 3200); GM.sfx.play('deny'); return; }
      GM.sfx.play('build');
      U.toast(r.placed + '칸을 깔았습니다' + (r.skipped ? ' (' + r.skipped + '칸은 자리가 안 되어 건너뛰었습니다)' : '')
        + ' · ' + costText(r.cost), r.skipped ? 'warn' : 'good', 3200);
      (r.tiles || []).forEach(function (t, i) {
        setTimeout(function () { GM.fx.dust(t.x, t.y, 3, '#9aa4ae'); }, i * 18);
      });
    });
    GM.world.setFencePath([]);
    return true;
  }

  /* ══════════ ★ §17-13 — 다리·매립 드래그 ══════════
     철로와 같은 끌기(칸)이되 자리가 정반대다 — 물 위에만 놓인다(allowedTerrain).
     다리 위는 사람이 걷고, 매립한 칸은 걷고 짓고 울타리도 두른다. */
  var OVERLAYS = {
    bridge: {
      info: function () { return S.bridgeInfo(); }, cfg: function () { return S.bridgeCfg(); },
      on: function (x, y) { return S.onBridge(x, y); },
      send: 'placeBridge', noun: '다리',
      lockText: '다리를 아직 모릅니다 — 「가교」를 연구하세요.',
      pickText: '지도를 눌러 물 위로 끌면 지나간 칸에 다리가 놓입니다. 사람은 다리 위로 물을 건넙니다.',
      dust: '#8a5c33'
    },
    fill: {
      info: function () { return S.fillInfo(); }, cfg: function () { return S.fillCfg(); },
      on: function (x, y) { return S.onFill(x, y); },
      send: 'placeFill', noun: '매립',
      lockText: '매립을 아직 모릅니다 — 「매립」을 연구하세요.',
      pickText: '지도를 눌러 물 위로 끌면 지나간 칸이 메워집니다. 메운 자리에는 걷고 지을 수 있습니다.',
      dust: '#c9b28a'
    }
  };

  function openOverlay(kind) {
    var o = OVERLAYS[kind];
    if (!o) return;
    var info = o.info();
    if (!info || !info.open) { U.toast(o.lockText, 'warn'); return; }
    S.setPlacing({ kind: kind });
    GM.world.setFencePath([]);
    U.toast(o.pickText, 'good', 4200);
    GM.sfx.play('page');
  }

  function overlayTileOk(kind, x, y) {
    var o = OVERLAYS[kind];
    if (!o) return false;
    var cfg = o.cfg() || { allowedTerrain: ['water'], requiresTerritoryMargin: 40 };
    var code = S.terrainKey(x, y);
    if ((cfg.allowedTerrain || ['water']).indexOf(code) < 0) return false;   /* 물 위에만 */
    var t = S.myTown();
    if (t) {
      var w = S.worldCfg();
      var base = (w && w.territory && w.territory.baseRadius) || 6;
      if (Math.hypot(t.x - x, t.y - y) > base + (cfg.requiresTerritoryMargin || 40)) return false;
    }
    if (o.on(x, y)) return false;
    return true;
  }

  function overlayCostText(kind, tiles) {
    var o = OVERLAYS[kind];
    var cfg = o && o.cfg();
    if (!cfg || !tiles) return '';
    var total = {};
    for (var k in cfg.costPerTile) {
      if (Object.prototype.hasOwnProperty.call(cfg.costPerTile, k)) total[k] = cfg.costPerTile[k] * tiles;
    }
    return tiles + '칸 · ' + costText(total);
  }

  function commitOverlay(kind, points) {
    var o = OVERLAYS[kind];
    if (!o) return false;
    var cfg = o.cfg() || { maxPointsPerRequest: 64 };
    if (!points || !points.length) { GM.world.setFencePath([]); return false; }
    var pts = points.slice(0, cfg.maxPointsPerRequest || 64);
    GM.net.send(o.send, { points: pts }, function (r) {
      if (!r) return;
      if (!r.ok) { U.toast((r.error && r.error.message) || '놓지 못했습니다.', 'warn', 3200); GM.sfx.play('deny'); return; }
      GM.sfx.play('build');
      U.toast(r.placed + '칸에 ' + o.noun + '을 놓았습니다'
        + (r.skipped ? ' (' + r.skipped + '칸은 자리가 안 되어 건너뛰었습니다)' : '')
        + ' · ' + costText(r.cost), r.skipped ? 'warn' : 'good', 3200);
      (r.tiles || []).forEach(function (t, i) {
        setTimeout(function () { GM.fx.dust(t.x, t.y, 3, o.dust); }, i * 18);
      });
    });
    GM.world.setFencePath([]);
    return true;
  }

  function repairAllFence() {
    GM.net.send('repairFence', {}, function (r) {
      if (r && r.ok) {
        U.toast(r.repaired + '조각을 고쳤습니다 · ' + costText(r.cost), 'good');
        GM.sfx.play('build');
      }
    });
  }

  function refresh() { if (open_) render(); }
  function isOpen() { return open_; }

  GM.build = {
    init: init, open: open, close: close, validate: validate, commit: commit,
    commitReclaimBox: commitReclaimBox, refresh: refresh, isOpen: isOpen,
    setCat: setCat, category: function () { return cat; },
    costText: costText, costNodes: costNodes, shortText: shortText, canAfford: canAfford, iconOf: iconOf,
    /** ★ §12-12 — 건물 정보 패널의 [이전]이 부르는 배치 모드 */
    startRelocate: function (b) {
      S.setPlacing({ kind: 'relocate', key: b.key, structureId: b.id, ignoreId: b.id });
      U.toast('옮길 자리를 고르세요. 초록으로 보이는 곳에 놓입니다.', 'good', 3400);
      GM.sfx.play('page');
    },
    openFence: openFence, fenceTileOk: fenceTileOk, fenceCostText: fenceCostText,
    commitFence: commitFence, repairAllFence: repairAllFence,
    /* ★ GDD3 §13-D-5 — 철로 */
    openRail: openRail, railTileOk: railTileOk, railCostText: railCostText, commitRail: commitRail,
    /* ★ §17-13 — 다리·매립(철로와 같은 끌기, 물 위에만) */
    openOverlay: openOverlay, overlayTileOk: overlayTileOk,
    overlayCostText: overlayCostText, commitOverlay: commitOverlay
  };
})(window);
