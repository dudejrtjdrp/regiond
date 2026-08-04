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
    for (var cy = rect.y0; cy <= rect.y1; cy++) {
      for (var cx2 = rect.x0; cx2 <= rect.x1; cx2++) {
        if (!S.inTerritory(cx2, cy)) return { ok: false, reason: '아직 우리 땅이 아닙니다' };
        if (buildable.indexOf(S.terrainKey(cx2, cy)) < 0) return { ok: false, reason: '여기에는 지을 수 없습니다' };
      }
    }
    var sp = cfg.minSpacing || 2;
    var ignore = pl.ignoreId || null;
    var stl = S.structures();
    for (var a = 0; a < stl.length; a++) {
      if (stl[a].x == null || stl[a].id === ignore) continue;
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

  /* ══════════ 배치대 ══════════ */
  /** 지금 장에서 실제로 무언가 지을 수 있는 갈래만 탭으로 낸다 */
  function categories() {
    var have = {};
    S.buildable().forEach(function (b) { have[b.category] = 1; });
    if (S.featOn('reclaim')) have.production = 1;       // 개간은 건물이 아니지만 생산 갈래에 산다
    return S.BUILD_CATEGORIES.filter(function (c) { return have[c.key]; });
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
    render();
    GM.sfx.play('page');
  }

  function close() {
    open_ = false;
    S.setPlacing(null);
    GM.world.setFencePath(null);
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
    military: '울타리 앞을 지킬 것', civic: '정착지를 키울 것', decor: '보기 좋은 것'
  };

  function render() {
    bar = bar || U.qs('#place-bar');
    if (!bar || !open_) return;
    U.clear(bar);
    bar.hidden = false;
    var n = S.nation();
    if (!n) return;

    var head = U.el('div', 'pb-head');
    head.appendChild(U.el('span', 'pb-title', CAT_TITLE[cat] || '무엇을 세울까'));
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
      var detail = (def.desc || '') +
        (b.buildPoints ? '\n공사 ' + U.fmt(b.buildPoints, 0) + ' — 현장에서 직접 두드리면 빨리 오릅니다.' : '') +
        (b.multi ? '\n여러 채 세울 수 있습니다.' : '\n한 채만 세웁니다.') +
        effectLine(b.key, 1);
      var fp = S.footprintOf(b.key);
      if (fp.w > 1 || fp.h > 1) detail += '\n차지하는 자리 ' + fp.w + '×' + fp.h + '칸';
      row.appendChild(item(iconOf(b.key), label, costNodes(b.cost, b.gold), detail,
        !full && b.affordable, function () { pick({ kind: 'build', key: b.key }); }, full ? '이미 세웠다' : null));
    });

    if (cat === 'military' && S.uiOn('panel.fence')) bar.appendChild(fenceStrip());
  }

  function effectLine(key, tier) {
    var t = S.buildingTier(key, tier || 1);
    if (!t || !t.effects || !t.effects.length) return '';
    return '\n' + t.effects.map(function (e) { return e.label + ' ' + e.value; }).join(' · ');
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
      campfire: 'campfire', well: 'stone', woodpile: 'wood', storage_crate: 'storage',
      granary: 'granary', sawmill: 'axe', quarry_camp: 'pickaxe', hunter_hut: 'bandit',
      storage: 'storage', smelter: 'fuel', smithy: 'anvil', mine_shaft: 'ore', mill: 'grain',
      fence: 'fence', gate: 'gate', watchpost: 'eye', arrow_tower: 'arrowTower',
      barracks: 'barracks', ballista: 'ballista', cannon: 'cannon',
      trading_post: 'ship', market: 'coin', shrine: 'shrine', consulate: 'consulate', monument: 'tier',
      lamp: 'fuel', banner: 'flag', garden: 'sprout', fountain: 'morale'
    };
    return map[key] || 'hammer';
  }

  /**
   * 배치대 한 칸. cost 는 글이거나 **DOM 묶음**(costNodes — 부족분이 빨강)이다.
   * ★ §12-3 — 못 짓는 까닭이 "값이 모자람"이면 그 자원만 빨갛게 「석재 12/30」으로 보인다.
   */
  function item(icon, name, cost, tip, enabled, onClick, badge) {
    var b = U.el('button', 'pb-item' + (enabled ? '' : ' off'));
    b.type = 'button';
    b.setAttribute('data-place', name);
    b.appendChild(GM.icons.img(icon, 26));
    b.appendChild(U.el('span', 'pb-n', name));
    var c = U.el('span', 'pb-c');
    if (badge) c.textContent = badge;
    else if (cost && cost.nodeType === 1) c.appendChild(cost);
    else c.textContent = cost || '';
    b.appendChild(c);
    U.tipSet(b, name + (c.textContent ? ' — ' + c.textContent : ''), tip || '');
    b.disabled = !enabled;
    b.onclick = onClick;
    return b;
  }

  function pick(pl) {
    S.setPlacing(pl);
    var label = pl.kind === 'reclaim' ? '개간' : nameOf(pl.key);
    U.qsa('#place-bar .pb-item').forEach(function (x) {
      var t = x.getAttribute('data-place') || '';
      x.classList.toggle('on', !!label && t.indexOf(label) === 0);
    });
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
    var v = validate(pl, x, y);
    if (!v.ok) {
      U.toast(v.reason || '그 자리에는 놓을 수 없습니다.', 'bad', 2600);
      GM.sfx.play('deny');
      return false;
    }
    /* ★ §12-12 — 이전: 새 자리를 찍으면 해체+재건 현장이 선다 */
    if (pl.kind === 'relocate') {
      GM.net.send('relocateStructure', { structureId: pl.structureId, x: x, y: y }, function (r) {
        if (!r) return;
        if (!r.ok) { U.toast((r.error && r.error.message) || '옮길 수 없습니다.', 'bad', 2800); GM.sfx.play('deny'); return; }
        U.toast('옮기기 시작했습니다 — 해체하고 새 자리에 다시 세웁니다.', 'good', 3200);
        GM.sfx.play('build');
        GM.fx.ring(x, y, '#8dfa8d', 0.2, 1.6, 0.5);
      });
      S.setPlacing(null);
      return true;
    }
    if (pl.kind === 'build') {
      GM.net.send('placeBuilding', { building: pl.key, x: x, y: y }, function (r) {
        if (r && r.ok) {
          GM.fx.dust(x, y, 10);
          if (r.instant && r.structure) {
            U.banner({ icon: 'up', kind: 'good', title: r.structure.name + ' 완공', sub: '' });
          }
        }
      });
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
    openRail: openRail, railTileOk: railTileOk, railCostText: railCostText, commitRail: commitRail
  };
})(window);
