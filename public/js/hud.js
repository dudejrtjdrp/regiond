/* hud.js — 화면 정보 구조. ★ 점진 공개(PROTOCOL §6)가 이 파일의 뼈대다.
   야영지에서는 자원 3칸 + 목표 카드뿐이고, 티어가 오를 때마다 칸과 단추가 하나씩 늘어난다.
   켜지지 않은 것은 회색으로 두지 않는다 — 아예 없다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var lastRes = {};
  var flashes = [];
  var speechOpen = null;
  var lastStructures = null;

  function init() {
    U.qs('#btn-sound').onclick = function () {
      var m = GM.sfx.toggle();
      paintSound();
      U.toast(m ? '소리를 껐습니다.' : '소리를 켰습니다.', 'good', 1800);
    };
    U.qs('#btn-help').onclick = openHelp;
    /* ★ GDD3 §14-2 — 톱니: 밝기·소리. Esc 로도 열린다(input.js). */
    var gear = U.qs('#btn-settings');
    if (gear) {
      gear.onclick = function () { GM.settings.open(); };
      U.tipSet(gear, '설정', '화면 밝기와 소리 크기를 고칩니다. Esc 로도 열립니다.');
    }
    var look = U.qs('#btn-look');
    if (look) {
      look.onclick = function () { GM.charcreate.openEditor(); };
      U.tipSet(look, '내 모습을 고칩니다', '고른 모습은 함께 하는 이들에게도 곧바로 보입니다.');
    }
    var ch = U.qs('#btn-chronicle');
    ch.onclick = function () { GM.chronicle.open(); };
    U.tipSet(ch, '연대기', '정착지가 지나온 길을 모아 둡니다.');
    var th = U.qs('#badge-threat');
    if (th) th.onclick = function () { GM.combat.openThreat(); };
    paintSound();
    renderToolbar();
    document.addEventListener('click', function (e) {
      if (speechOpen && !e.target.closest('.mn-speech') && !e.target.closest('.minister')) closeSpeech();
    });
  }

  function paintSound() {
    var b = U.qs('#btn-sound');
    var muted = GM.sfx.isMuted();
    b.textContent = muted ? '✕' : '♪';
    b.classList.toggle('off', muted);
    U.tipSet(b, muted ? '소리 꺼짐' : '소리 켜짐', '작은 8비트 효과음이 납니다. 언제든 다시 끌 수 있습니다.');
  }

  /* ══════════ 상단 자원 바 (점진 공개) ══════════ */
  function resItems() {
    var n = S.nation();
    if (!n) return [];
    var out = [];
    var showAll = S.uiOn('panel.build');           // 촌락부터 전 자원
    S.RESOURCES.forEach(function (r) {
      if (!showAll && S.BASIC3.indexOf(r.key) < 0) return;
      var v = (n.resources && n.resources[r.key]) || 0;
      /* ★ §13-D-5 — 석탄도 '아직 한 톨도 없으면' 칸을 차지하지 않는다(연구 전에는 세상에 없다) */
      if (showAll && v <= 0 && ['ironOre', 'coal', 'oil', 'steel', 'fuel'].indexOf(r.key) >= 0) return;
      out.push({ key: r.key, name: r.name, value: v, digits: 0 });
    });
    if (S.uiOn('hud.population')) {
      out.push({ key: 'population', name: '사람', value: n.population || 0, digits: 0 });
    }
    /* ★ §19-C — 금화는 늘 보인다. 교역이 열리기 전에도 금은 이미 들어오고 나간다
       (건물 값·도구 값·유물). 「가진 돈」이 안 보이면 값을 치르는 창마다 셈이 막힌다. */
    out.push({ key: 'gold', name: '금화', value: n.gold || 0, digits: 0 });
    if (S.uiOn('hud.population')) {
      out.push({ key: 'morale', name: '사기', value: n.morale || 0, digits: 2, isMorale: true });
    }
    return out;
  }

  function renderResBar() {
    var bar = U.qs('#res-bar');
    var n = S.nation();
    if (!bar || !n) return;
    var items = resItems();
    var sig = items.map(function (i) { return i.key; }).join(',');

    if (bar.getAttribute('data-sig') !== sig) {
      U.clear(bar);
      bar.setAttribute('data-sig', sig);
      items.forEach(function (it) {
        var d = U.el('div', 'res-chip');
        d.setAttribute('data-k', it.key);
        d.appendChild(GM.icons.img(GM.icons.resIcon(it.key), 18));
        var col = U.el('div', 'rc-col');
        var v = U.el('span', 'num rc-v'); v.setAttribute('data-v', it.value);
        col.appendChild(v);
        col.appendChild(U.el('span', 'rc-n', it.name));
        d.appendChild(col);
        d.appendChild(U.el('span', 'rc-d'));
        bar.appendChild(d);
      });
    }

    items.forEach(function (it, i) {
      var d = bar.childNodes[i];
      if (!d) return;
      var v = d.querySelector('.rc-v');
      U.tweenNum(v, it.value, it.isMorale
        ? { digits: 2, fmt: function (x) { return U.fixed(x, 2); }, delta: false }
        : { digits: it.digits, delta: false });

      var prev = lastRes[it.key];
      var dl = d.querySelector('.rc-d');
      if (prev !== undefined && Math.abs(it.value - prev) > (it.isMorale ? 0.004 : 0.5)) {
        var diff = it.value - prev;
        dl.textContent = (diff > 0 ? '▲' : '▼') + U.fmt(Math.abs(diff), it.isMorale ? 2 : 0);
        dl.className = 'rc-d ' + (diff > 0 ? 'up' : 'down');
      } else if (prev === undefined) { dl.textContent = ''; dl.className = 'rc-d'; }

      var word = stateWord(it, n);
      /* ★ GDD3 §13-A-5 — 곳간이 찬 자원은 빨간 테두리 + 「가득」. 왜 안 늘어나는지가 한눈에 보여야 한다. */
      var full = S.storageFull(it.key);
      U.tipSet(d, it.name + ' — ' + (full ? '가득 참' : word.text),
        withUses(it.key, full ? ('곳간 상한 ' + U.fmt(S.storageLimit(), 0) + '에 닿았습니다.\n'
                + '더 캐도 들어가지 않습니다 — 저장 궤짝이나 저장고를 더 짓거나 키우세요.')
             : word.detail));
      d.classList.toggle('low', word.low && !full);
      d.classList.toggle('full', full);
    });
  }

  /** ★ 자원 팝이 날아갈 목적지 — fx.resourcePop 이 부른다 */
  function chipPoint(key) {
    var bar = U.qs('#res-bar');
    if (!bar) return null;
    var chip = bar.querySelector('[data-k="' + key + '"]');
    if (!chip) chip = bar.firstChild;
    if (!chip || !chip.getBoundingClientRect) return null;
    var r = chip.getBoundingClientRect();
    if (!r.width) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  /** 자원이 칸에 닿는 순간 — 칸이 한 번 튄다 */
  function absorb(key) {
    var bar = U.qs('#res-bar');
    if (!bar) return;
    var chip = bar.querySelector('[data-k="' + key + '"]');
    if (!chip) return;
    chip.classList.remove('absorb');
    void chip.offsetWidth;
    chip.classList.add('absorb');
  }

  /* ★ §19-D(F03-10) — 「이 자원은 어디에 쓰나」. 문구는 data/resources.json 의 meta[].uses 가 정본이다:
     화면이 제 낱말을 지어내면 실제 비용표와 어긋난 거짓말이 남는다. 사람·사기처럼 쓰임이 없는 칸은
     그대로 지나간다(uses 가 없으면 한 글자도 붙지 않는다). */
  function usesOf(key) {
    var c = S.cfg();
    var m = c && c.resources && c.resources.meta && c.resources.meta[key];
    return (m && m.uses) || null;
  }
  function withUses(key, detail) {
    var u = usesOf(key);
    return u ? (detail + '\n\n' + u) : detail;
  }

  function stateWord(it, n) {
    var f = U.fmt;
    if (it.key === 'grain') {
      var pop = Math.max(1, n.population || 0);
      var days = (n.population ? it.value / n.population : it.value);
      var w = n.population ? (days >= 6 ? '넉넉함' : days >= 3 ? '빠듯함' : '위험') : '쌓이는 중';
      return { text: n.population ? w + ' (' + f(days, 1) + '일치)' : f(it.value, 0), low: !!n.population && days < 3,
        detail: '곳간에 ' + f(it.value, 0) + '. 사람 ' + f(n.population, 0) + '명이 하루 한 사람 앞 1을 먹습니다.\n' +
                '식량이 넉넉해야 새 사람이 찾아옵니다.' };
    }
    if (it.key === 'population') {
      var h = S.housing() || {};
      return { text: f(it.value, 0) + '명 (잠자리 ' + f(h.freeBeds || 0, 0) + ' 남음)', low: false,
        detail: '수용 ' + f(h.capacity || 0, 0) + '명 — 천막 1 · 오두막 2 · 가옥 4 · 저택 6.\n' +
                (h.arrival && h.arrival.intervalDays
                  ? '지금 매력도라면 약 ' + U.fmt(h.arrival.intervalDays, 1) + '일마다 한 명씩 찾아옵니다.'
                  : '빈 잠자리와 식량 여유가 있어야 사람이 옵니다.') };
    }
    if (it.key === 'morale') {
      var w2 = it.value >= 1.05 ? '드높음' : it.value >= 0.9 ? '보통' : '가라앉음';
      return { text: w2, low: it.value < 0.85,
        detail: '사기 ' + U.fixed(it.value, 2) + ' — 0.6에서 1.25 사이를 오갑니다.\n산출 전체에 그대로 곱해집니다.' };
    }
    if (it.key === 'gold') {
      return { text: it.value <= 0 ? '텅 빔' : f(it.value, 0), low: it.value <= 0,
        detail: '금화 ' + f(it.value, 0) + '. 도구·영사관·화포를 금화로 삽니다.' };
    }
    return { text: f(it.value, 0), low: false, detail: '창고에 ' + f(it.value, 0) + ' 있습니다.' };
  }

  function snapshotRes() {
    var n = S.nation();
    if (!n) return;
    lastRes = {};
    S.RESOURCES.forEach(function (r) { lastRes[r.key] = (n.resources && n.resources[r.key]) || 0; });
    lastRes.gold = n.gold || 0;
    lastRes.population = n.population || 0;
    lastRes.morale = n.morale || 0;
  }

  /* ══════════ 배지: 정착지 · 하루 · 위협 ══════════ */
  function renderBadges() {
    var v = S.S.view;
    if (!v) return;
    var t = S.tier();

    /* 정착지 이름과 단계
       ★ Sprint 3 — 이 배지는 승격을 할 때 말고는 바뀌지 않는데, 상태가 밀릴 때마다
       조건 표를 다시 세우고 아이콘·점(pip)·긴 설명말을 통째로 다시 짓고 있었다.
       그리는 데 쓰는 값(이름·다음 단계·조건마다의 참/거짓과 현재값/필요값)으로 서명을 만든다.
       ※ 아래 「하루」 배지는 일부러 그냥 둔다 — dayFraction 이 밀 때마다 달라져서
         서명을 달아 봐야 늘 어긋난다(해·달 원호가 움직여야 하는 것이 옳다). */
    var tb = U.qs('#badge-tier');
    if (tb) {
      var tnx = t.next;
      var treqs = tnx ? S.reqList(tnx.reqs) : null;
      var tsig = [t.name || '', tnx ? tnx.name : '-', tnx ? tnx.radius : '-', tnx ? '' : (t.line || '')];
      if (treqs) {
        for (var ri = 0; ri < treqs.length; ri += 1) {
          var rr = treqs[ri];
          tsig.push((rr.ok ? 1 : 0) + ',' + rr.text + ',' + rr.have + ',' + rr.need + ',' + (rr.dec || 0));
        }
      }
      renderTierBadge(tb, t, tnx, treqs, tsig.join('|'));
    }

    renderDayBadge(v);
    renderThreatBadge();
  }

  function renderTierBadge(tb, t, nx, reqs, sig) {
    if (tb.getAttribute('data-sig') === sig) return;
    tb.setAttribute('data-sig', sig);
    U.clear(tb);
    tb.appendChild(GM.icons.img('tier', 24));
    var col = U.el('div');
    col.appendChild(U.el('span', 'bt-name', t.name || '야영지'));
    col.appendChild(U.el('span', 'bt-sub', nx ? ('다음 — ' + nx.name) : '끝이 없는 길'));
    tb.appendChild(col);
    if (nx) {
      /* ★ §13-A-1 — 배지도 서버 스냅샷이 아니라 지금 장부로 다시 잰 값을 그린다
         (★ Sprint 3 — 그 값은 서명을 만들 때 이미 쟀다. 두 번 재지 않는다.) */
      var okN = reqs.filter(function (r) { return r.ok; }).length;
      var g = U.el('span', 'bt-pips');
      reqs.forEach(function (r) { g.appendChild(U.el('i', 'pip' + (r.ok ? ' on' : ''))); });
      tb.appendChild(g);
      /* ★ §12-3 — 조건마다 현재값/필요값을 그대로 보여 준다 */
      U.tipSet(tb, t.name + ' — 다음은 ' + nx.name,
        reqs.map(function (r) {
          return (r.ok ? '✔ ' : '✕ ') + r.text + ' (' + U.fmt(r.have, r.dec || 0) + '/' + U.fmt(r.need, r.dec || 0) + ')';
        }).join('\n') +
        '\n땅이 반경 ' + nx.radius + '까지 넓어집니다. (' + okN + '/' + reqs.length + ')' +
        '\n\n눌러서 정착지 패널을 엽니다 — 승격도 거기서 합니다.');
    } else {
      U.tipSet(tb, t.name, (t.line || '') + '\n\n눌러서 정착지 패널을 엽니다.');
    }
    /* ★ §12-2 — 본부를 못 찾아도 여기로 들어갈 수 있다 (같은 패널)
       ※ 이 닫힘은 그때 그때 S.hq() 를 다시 물으므로 헌 것을 잡지 않는다 — 서명으로 걸러도 안전하다. */
    tb.classList.add('clickable');
    tb.onclick = function () {
      var b = S.hq();
      if (!b) return;
      S.selectTarget('structureId', b.id);
      GM.structure.openSettlement(b);
      GM.camera.moveTo(b.cx == null ? b.x : b.cx, b.cy == null ? b.y : b.cy);
    };
  }

  function renderDayBadge(v) {
    /* 하루 — 며칠째 + 지금이 언제인가 */
    wakeOnNewDay(v);
    var badge = U.qs('#badge-day');
    if (badge) {
      var ph = S.phaseMeta();
      var icon = ['sprout', 'sun', 'leaf', 'moon'][S.phaseIndex()];
      U.clear(badge);
      badge.appendChild(GM.icons.img(icon, 24));
      var c2 = U.el('div');
      c2.appendChild(U.el('span', 'cal-day-n', (v.day || 1) + '일째'));
      c2.appendChild(U.el('span', 'cal-season', ph.name));
      badge.appendChild(c2);
      /* ★ GDD3 §12-10 — 해·달이 원호를 그리며 지나간다. 진행바보다 "지금이 언제인지"가 몸으로 읽힌다. */
      badge.appendChild(skyArc(S.S.dayFraction || 0));
      var prog = U.el('span', 'day-prog');
      var fill = U.el('i');
      fill.style.width = Math.round((S.S.dayFraction || 0) * 100) + '%';
      prog.appendChild(fill);
      badge.appendChild(prog);
      var mins = Math.round(((S.timeCfg().dayRealSeconds || 600) / 60) * 10) / 10;
      U.tipSet(badge, (v.day || 1) + '일째 · ' + ph.name,
        '하루는 ' + mins + '분입니다. 아침·낮·저녁·밤으로 나뉘고, 밤에는 시야가 좁아집니다.' +
        '\n해가 원호의 왼쪽에서 떠 오른쪽으로 지고, 밤에는 달이 그 길을 갑니다.' +
        (v.paused ? '\n지금 시간이 멈춰 있습니다.' : ''));
    }
  }

  function renderThreatBadge() {
    /* 위협 — 티어 2부터 */
    var ib = U.qs('#badge-threat');
    var w = S.wave();
    if (!ib) return;
    if (!S.uiOn('hud.threat') || !w || !w.unlocked || !w.enemy) { ib.hidden = true; return; }
    ib.hidden = false;
    var meta = S.enemyMeta(w.enemy.type);
    var days = w.precise ? w.daysUntil : w.daysUntilMin;
    var txt = w.active ? meta.name + ' · 지금 옵니다'
      : (days === null || days === undefined ? meta.name + ' · 언제일지 모름'
        : meta.name + ' · ' + days + '일' + (w.precise ? ' 뒤' : ' 안쪽'));
    /* ★ Sprint 3 — 이 배지가 읽는 것은 아이콘·글자·급함 표시·설명말 넷뿐이다.
       파도는 하루 단위로 다가오므로 밀 때마다 다시 지을 까닭이 없다. */
    var sig = meta.icon + '|' + txt + '|' + (w.precise ? 1 : 0) + '|' + (w.hint || '') + '|' +
              S.directionMeta(w.enemy.direction).name;
    if (ib.getAttribute('data-sig') !== sig) {
      ib.setAttribute('data-sig', sig);
      U.clear(ib);
      ib.appendChild(GM.icons.img(meta.icon, 22));
      ib.appendChild(U.el('span', null, txt));
      U.tipSet(ib, txt + (w.precise ? ' (성녀가 날을 못 박았습니다)' : ' (소문만 돕니다)'),
        (w.hint || '') + '\n' + S.directionMeta(w.enemy.direction).name + '에서 옵니다. 눌러서 방어를 살피세요.');
    }
    /* 급함·비네트는 값싼 판정이라 서명 밖에 둔다(늘 지금 값을 따른다) */
    ib.classList.toggle('soon', !!(days !== null && days !== undefined && days <= 2) || !!w.active);

    var vg = U.qs('#vignette');
    if (vg) vg.classList.toggle('on', !!(days !== null && days !== undefined && days <= 1) || !!w.active);
  }

  /* ══════════ 조작 단추 줄 (점진 공개) ══════════ */
  function tb(bar, id, icon, label, tip, detail, onClick) {
    var b = U.el('button', 'tool-btn');
    b.type = 'button';
    b.id = id;
    b.appendChild(GM.icons.img(icon, 22));
    b.appendChild(U.el('span', null, label));
    U.tipSet(b, tip, detail);
    b.onclick = onClick;
    bar.appendChild(b);
    return b;
  }

  /**
   * ★ GDD3 §11-1 — 「지을 게 없으면 배치대 단추가 아예 없어야 한다」.
   *   서버의 buildable 은 **지금 장에서 지을 수 있는 것만** 담고 있으므로, 그것이 비면 단추를 그리지 않는다.
   *   ("아직 지을 수 있는 것이 없습니다" 라는 문구가 뜨는 상황 자체가 설계 실패다.)
   */
  function canBuildNow() {
    return S.uiOn('panel.build') && S.buildable().length > 0;
  }

  function toolbarSig() {
    return [canBuildNow() ? 1 : 0, S.uiOn('panel.fence') ? 1 : 0,
            S.uiOn('panel.residents') ? 1 : 0, S.uiOn('panel.skills') ? 1 : 0,
            S.uiOn('hud.threat') ? 1 : 0, S.uiOn('panel.codex') ? 1 : 0].join('');
  }

  function renderToolbar() {
    var bar = U.qs('#toolbar');
    if (!bar) return;
    var sig = toolbarSig();
    if (bar.getAttribute('data-sig') === sig) return;
    bar.setAttribute('data-sig', sig);
    U.clear(bar);

    if (canBuildNow()) {
      tb(bar, 'tb-build', 'hammer', '건설 (B)', '건물을 손수 자리 잡아 짓습니다',
        '주거·생산·군사·발전·장식 갈래에서 고른 뒤 땅을 누르면 미리보기가 초록인 자리에 섭니다. ' +
        '개간은 끌어서 여러 칸을 한 번에.',
        function () { GM.build.open(); });
    }

    if (S.uiOn('panel.fence')) {
      tb(bar, 'tb-fence', 'fence', '울타리 (F)', '끌어서 선을 그으면 조각으로 섭니다',
        '누른 채 끌어 선을 긋고 손을 떼면 세워집니다. Shift 를 누른 채 끝내면 그 조각이 문이 됩니다.',
        function () { GM.build.openFence(); });
    }
    if (S.uiOn('panel.residents')) {
      tb(bar, 'tb-people', 'person', '주민 (P)', '주민을 고르고 일을 시킵니다',
        '끌어서 여럿을 고르고, 오른쪽 단추로 일터를 지정합니다.',
        function () { GM.residents.openPanel(); });
    }
    if (S.uiOn('panel.skills')) {
      tb(bar, 'tb-skills', 'tools', '솜씨 (K)', '농사·벌목·채광·건설·전투 다섯 가지',
        '스윙마다 오르고, 오를수록 손이 빨라지고 거두는 몫이 늘어납니다.',
        function () { GM.skills.open(); });
    }
    /* ★ GDD3 §13-C-3 — 도감. 사냥이 열리는 3장(허기)부터 나타난다. */
    if (S.uiOn('panel.codex')) {
      tb(bar, 'tb-codex', 'book', '도감 (J)', '만난 것과 잡은 것을 모아 둡니다',
        '마주치면 이름과 사는 곳이 열리고, 다섯을 잡으면 능력치와 나오는 것이, 스물을 잡으면 이야기가 열립니다. ' +
        '뒤진 유적도 따로 남습니다.',
        function () { GM.codex.open(); });
    }
    if (S.uiOn('hud.threat')) {
      tb(bar, 'tb-defense', 'shield', '방어 (V)', '울타리·터렛·민병을 한눈에',
        '다음 무리가 얼마나 센지, 지금 우리가 얼마나 버틸 수 있는지 보여 줍니다.',
        function () { GM.combat.openThreat(); });
    }
    /* ★ GDD3 §13-D-3 — 캐릭터 창. 대장간이 서는 장(9장)부터 나타난다. */
    if (S.uiOn('panel.equipment')) {
      tb(bar, 'tb-equip', 'anvil', '내 장비 (C)', '무기와 방어구를 벼립니다',
        '기본 세 단은 그냥 벼릴 수 있고, 공장장이 자리에 있으면 윗단과 강화가 열립니다. ' +
        '특성은 성녀가 있을 때 좋은 것이 붙을 확률이 두 배입니다.',
        function () { GM.equip.open(); });
    }
    tb(bar, 'tb-town', 'castle', '정착지 (H)', '정착지로 시선을 옮깁니다', '',
      function () { GM.input.centerTown(); });
    tb(bar, 'tb-lord', 'crown', '나 (Space)', '나에게 시선을 옮깁니다',
      'W A S D 로 걷고, 대상 곁에서 누르고 있으면 계속 일합니다.', function () { GM.input.centerLord(); });
  }

  /* ══════════ 알림 스택 ══════════ */
  function flash(item, ms) {
    item.until = Date.now() + (ms || 14000);
    item.id = item.id || (item.kind + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 6));
    flashes.unshift(item);
    if (flashes.length > 6) flashes.length = 6;
    renderNotices();
  }

  function notices() {
    var out = [];
    var n = S.nation();
    var v = S.S.view;
    if (!n || !v) return out;
    var now = Date.now();
    flashes = flashes.filter(function (f) { return f.until > now; });

    var c = S.S.council;
    if (S.uiOn('panel.council') && c && !c.acked && !S.S.dismissed['council:' + c.councilId]) {
      out.push({ id: 'council:' + c.councilId, kind: 'council', icon: 'crown',
        title: '어전 회의가 열렸습니다', sub: '각료들이 기다립니다',
        open: function () { GM.council.openCouncil(c); } });
    }

    S.decisionQueue().forEach(function (d) {
      out.push({ id: 'dec:' + d.decisionId, kind: 'decision', icon: 'scroll',
        title: d.title || '판단이 필요합니다', sub: shorten(d.text, 34),
        open: function () { GM.council.openDecision(d); } });
    });

    if (S.featOn('trade')) {
      var tick = v.tick || 0;
      S.offers().forEach(function (o) {
        if (o.expiresTick !== undefined && o.expiresTick < tick) return;
        var rm = S.resourceMeta(o.resource);
        out.push({ id: 'offer:' + o.offerId, kind: 'offer', icon: 'ship',
          title: (o.nationName || '어느 상단') + '의 제안',
          sub: rm.name + ' ' + U.fmt(o.amount, 0) + (o.side === 'buy' ? ' 사겠답니다' : ' 팔겠답니다'),
          open: function () { GM.ministry.openOffer(o); } });
      });
    }

    S.camps().forEach(function (cp) {
      out.push({ id: 'camp:' + cp.id + ':' + (cp.scouted ? 's' : 'n'), kind: 'danger', icon: 'tent',
        title: cp.name + '이(가) 가장자리에 진을 쳤습니다',
        sub: cp.scouted ? (cp.sizeHint || '규모를 헤아렸습니다') : '주민을 보내 규모를 살피세요',
        open: function () {
          if (cp.x != null) GM.camera.moveTo(cp.x, cp.y);
          var ids = GM.residents.nearestIdle(cp.x, cp.y, 2);
          if (ids.length) {
            GM.net.send('commandVillagers', { ids: ids, order: { type: 'scout', x: cp.x, y: cp.y } });
            U.toast('정찰을 보냅니다.', 'good');
          }
        } });
    });

    flashes.forEach(function (f) { out.push(f); });
    warnings(n, v).forEach(function (w) { if (!S.S.dismissed[w.id]) out.push(w); });
    return out;
  }

  function warnings(n, v) {
    var out = [];
    var day = Math.floor((v.tick || 0) / 2);
    if (n.population > 0) {
      var days = (n.resources.grain || 0) / n.population;
      if (days < 3) {
        out.push({ id: 'w:grain:' + day, kind: 'danger', icon: 'warn',
          title: '곳간이 비어 갑니다', sub: '식량 ' + U.fmt(days, 1) + '일치뿐입니다',
          open: function () { GM.input.centerTown(); } });
      }
    }
    var ruined = S.structures().filter(function (b) { return b.ruined || (b.condition || 1) < 0.6; });
    if (ruined.length) {
      out.push({ id: 'w:repair:' + day + ':' + ruined.length, kind: 'warn', icon: 'repair',
        title: '상한 건물이 ' + ruined.length + '채 있습니다', sub: '눌러서 수리하세요',
        open: function () {
          var b = ruined[0];
          GM.camera.moveTo(b.x, b.y);
          S.selectTarget('structureId', b.id);
          GM.structure.open(b.id);
        } });
    }
    var fs = S.fenceSummary();
    if (fs && (fs.broken > 0 || fs.damaged > 2)) {
      out.push({ id: 'w:fence:' + day, kind: 'warn', icon: 'fence',
        title: '울타리가 상했습니다', sub: (fs.broken ? fs.broken + '조각이 부서졌습니다' : fs.damaged + '조각이 상했습니다'),
        open: function () { GM.build.repairAllFence(); } });
    }
    var w = S.wave();
    var d = S.defense();
    if (S.uiOn('hud.threat') && w && w.enemy && d && d.estimate && !d.estimate.comfortable) {
      var du = w.precise ? w.daysUntil : w.daysUntilMin;
      if (du !== null && du !== undefined && du <= 3) {
        out.push({ id: 'w:def:' + day, kind: 'danger', icon: 'shield',
          title: '울타리 앞이 위태롭습니다', sub: '터렛을 세우거나 울타리를 두르세요',
          open: function () { GM.combat.openThreat(); } });
      }
    }
    var idle = S.residents().filter(function (u) { return u.job === 'idle'; }).length;
    if (idle >= 5) {
      out.push({ id: 'w:idle:' + day, kind: 'warn', icon: 'folk',
        title: '노는 사람이 ' + idle + '명입니다', sub: '일터를 정해 주세요',
        open: function () { GM.residents.selectAllIdle(); GM.residents.openPanel(); } });
    }
    return out;
  }

  function shorten(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  /* ══════════ ★ Sprint 3 — 안내 쪽지의 서명 ══════════
     「왜」 서명을 다나 — renderNotices 는 상태가 밀릴 때마다(초에 여러 번) 불리는데,
     그때마다 쪽지 일곱 장을 부수고 다시 짓는다. 아이콘 그림 일곱 개를 새로 만들고
     설명말(tip)까지 다시 다는 일이 매번 되풀이된다. 그런데 열에 아홉은 **글자 한 자도
     달라지지 않는다**. 그리는 데 쓰는 값(id·갈래·아이콘·제목·잔글)을 그대로 이어 서명을
     만들고, 같으면 손대지 않는다.
     ★ 한 가지 함정: 쪽지의 open 은 그때 그때의 알맹이(cp·o·d…)를 품은 닫힘(closure)이다.
     헌 쪽지를 그대로 두면 닫힘도 헌 것이 남는다. 그래서 **누를 때 id 로 지금 목록에서
     다시 찾아** 부른다 — 화면은 그대로 두면서 손은 늘 새것을 잡는다. */
  var noticeNow = [];

  function noticeSig(list) {
    var parts = [];
    for (var i = 0; i < list.length; i += 1) {
      var it = list[i];
      parts.push(it.id + '' + it.kind + '' + it.icon + '' + it.title + '' + (it.sub || ''));
    }
    return parts.join('');
  }

  function noticeById(id, fallback) {
    for (var i = 0; i < noticeNow.length; i += 1) if (noticeNow[i].id === id) return noticeNow[i];
    return fallback;
  }

  function renderNotices() {
    var box = U.qs('#notices');
    if (!box) return;
    var list = notices().slice(0, 7);
    noticeNow = list;                       // 닫힘이 되짚을 「지금」 목록은 늘 새로 둔다
    var sig = noticeSig(list);
    if (box.getAttribute('data-sig') === sig) return;
    box.setAttribute('data-sig', sig);
    U.clear(box);
    list.forEach(function (it) {
      var b = U.el('button', 'notice kind-' + it.kind);
      b.type = 'button';
      b.setAttribute('data-id', it.id);
      b.appendChild(GM.icons.img(it.icon, 22));
      var col = U.el('div', 'nt-col');
      col.appendChild(U.el('span', 'nt-t', it.title));
      if (it.sub) col.appendChild(U.el('span', 'nt-s', it.sub));
      b.appendChild(col);
      b.onclick = function () {
        var cur = noticeById(it.id, it);     // ★ Sprint 3 — 헌 닫힘을 잡지 않는다
        if (cur.kind === 'warn' || cur.kind === 'good') S.S.dismissed[cur.id] = 1;
        if (cur.open) cur.open();
        renderNotices();
      };
      U.tipSet(b, it.title, it.sub || '눌러서 펼칩니다.');
      box.appendChild(b);
    });
  }

  /* ══════════ 각료 초상 (티어 3+) ══════════ */
  function cabinetSig() {
    if (!S.uiOn('panel.roles')) return 'off';
    var n = S.nation();
    var parts = ['on'];
    S.ROLES.forEach(function (r) { parts.push(r.key + (S.isVacant(r.key) ? 'v' : 'o')); });
    parts.push(S.uiOn('panel.orders') ? 'L' : '-');
    parts.push(((n && n.artifacts) || []).filter(function (a) { return !a.consumed; }).length);
    return parts.join('|');
  }

  var ROYAL = [
    { key: 'law',  name: '국법',   icon: 'scroll', ui: 'panel.orders', open: function () { GM.orders.open(); } },
    { key: 'relic', name: '유물함', icon: 'gem',   ui: 'panel.council', open: function () { GM.artifacts.open(); } }
  ];

  function renderCabinet() {
    var box = U.qs('#cabinet');
    if (!box) return;
    var sig = cabinetSig();
    if (box.getAttribute('data-sig') === sig) return;
    box.setAttribute('data-sig', sig);
    U.clear(box);
    closeSpeech();
    if (!S.uiOn('panel.roles')) { box.hidden = true; return; }
    box.hidden = false;
    var n = S.nation();

    S.ROLES.forEach(function (r) {
      var b = U.el('button', 'minister');
      b.type = 'button';
      b.setAttribute('data-role', r.key);
      var vacant = S.isVacant(r.key);
      if (vacant) b.classList.add('vacant');
      b.appendChild(U.el('span', 'mn-dot'));
      b.appendChild(GM.icons.portraitImg(r.key, 44, 'cab'));
      b.appendChild(U.el('span', 'mn-name', r.name));
      U.tipSet(b, vacant ? r.name + ' — 빈자리' : r.name + ' · ' + (S.holderName(r.key) || ''),
        vacant ? r.vacancy : r.line + '\n눌러서 보고를 듣고 그 부처를 관리합니다.');
      b.onclick = function (e) { e.stopPropagation(); toggleSpeech(b, r.key); };
      box.appendChild(b);
    });

    box.appendChild(U.el('span', 'cab-sep decor'));

    ROYAL.forEach(function (rl) {
      if (!S.uiOn(rl.ui)) return;
      var b = U.el('button', 'minister royal');
      b.type = 'button';
      b.setAttribute('data-royal', rl.key);
      b.appendChild(GM.icons.img(rl.icon, 44));
      b.appendChild(U.el('span', 'mn-name', rl.name));
      if (rl.key === 'relic') {
        var cnt = ((n && n.artifacts) || []).filter(function (a) { return !a.consumed; }).length;
        if (cnt) { var dot = U.el('span', 'mn-dot'); dot.style.background = 'var(--gold)'; b.appendChild(dot); }
      }
      U.tipSet(b, rl.key === 'law' ? '국법 — 자리를 비운 사이의 지침' : '유물함 — 땅이 내어준 것들', '');
      b.onclick = rl.open;
      box.appendChild(b);
    });
  }

  function toggleSpeech(hostBtn, roleKey) {
    if (speechOpen && speechOpen.__role === roleKey) { closeSpeech(); return; }
    closeSpeech();
    var n = S.nation();
    var meta = S.roleMeta(roleKey);
    var vacant = S.isVacant(roleKey);
    var sp = U.el('div', 'mn-speech');
    sp.__role = roleKey;
    sp.appendChild(U.el('span', 'sp-who', vacant ? meta.name + ' (빈자리)' : (S.holderName(roleKey) + ' ' + meta.name)));
    sp.appendChild(U.el('div', 'sp-line', brief(roleKey, n)));
    var go = U.el('div', 'sp-go');
    go.appendChild(U.btn(meta.name + '에게 간다', 'btn-sm btn-primary', function () {
      closeSpeech();
      GM.ministry.open(roleKey);
    }));
    sp.appendChild(go);
    /* ★ §17-1 — 각료 바(#cabinet)는 overflow로 말풍선을 잘라먹는다(피드백: "클릭해도 아무것도 안 뜸").
       문서 몸통에 fixed 로 붙여 단추 위에 띄운다. */
    var r = hostBtn.getBoundingClientRect();
    sp.style.position = 'fixed';
    sp.style.left = Math.max(6, r.left - 6) + 'px';
    sp.style.bottom = (window.innerHeight - r.top + 10) + 'px';
    sp.style.marginBottom = '0';
    document.body.appendChild(sp);
    speechOpen = sp;
    GM.sfx.play('page');
  }
  function closeSpeech() {
    if (speechOpen && speechOpen.parentNode) speechOpen.parentNode.removeChild(speechOpen);
    speechOpen = null;
  }

  function brief(key, n) {
    if (!n) return '아직 드릴 말씀이 없습니다.';
    if (S.isVacant(key)) return '이 자리는 비어 있습니다. ' + S.roleMeta(key).vacancy + '.';
    var f = U.fmt;
    var direct = { farm: 'farmBrief', factory: 'factoryBrief', build: 'buildBrief',
                   defense: 'defenseBrief', saint: 'saintBrief' }[key];
    if (direct && n[direct]) return String(n[direct]);
    if (key === 'farm') {
      var days = n.population ? (n.resources.grain || 0) / n.population : 0;
      return '곳간에 식량 ' + f(n.resources.grain, 0) + '. 사람 ' + f(n.population, 0) + '명 기준 ' + f(days, 1) + '일치입니다.';
    }
    if (key === 'factory') return '강재 ' + f(n.resources.steel, 0) + ', 연료 ' + f(n.resources.fuel, 0) + '.';
    if (key === 'build') {
      return (n.sites && n.sites.length) ? '공사 ' + n.sites.length + '건이 올라가고 있습니다.'
        : '목재 ' + f(n.resources.wood, 0) + ', 석재 ' + f(n.resources.stone, 0) + '. 지금은 손이 비었습니다.';
    }
    if (key === 'defense') {
      var d = S.defense() || {};
      return '터렛 ' + f(d.turretCount, 0) + '기, 민병 ' + f(d.militiaCount, 0) + '명, 울타리 ' + f(d.fenceSegments, 0) + '조각입니다.';
    }
    if (key === 'trade') {
      var cnt = S.offers().length;
      return cnt ? '상단 ' + cnt + '곳이 답을 기다립니다. 금화는 ' + f(n.gold, 0) + '.' : '금화는 ' + f(n.gold, 0) + '.';
    }
    if (key === 'saint') return S.hasPreciseWave() ? '다가오는 날은 이미 보았습니다.' : '아직 빛이 흐립니다.';
    return '별일 없이 돌아갑니다.';
  }

  /* ══════════ 선택 패널 ══════════ */
  function showContext(o) {
    var p = U.qs('#context-panel');
    if (!p) return;
    /* ★ §17-19 — 배치대도 하단 가운데로 내려왔다. 둘이 겹치지 않게 여는 쪽이 상대를 접는다.
       다만 자리를 놓는 중이면 배치대를 지킨다(놓다 말고 패널이 닫히면 손이 끊긴다). */
    if (!S.S.placing && GM.build && GM.build.close) GM.build.close();
    U.clear(p);
    p.hidden = false;

    var head = U.el('div', 'ctx-head');
    if (o.icon) head.appendChild(GM.icons.img(o.icon, 30));
    head.appendChild(U.el('span', 'ctx-title', o.title || ''));
    /* ★ Sprint 1 — ✕ 는 **선택까지** 물린다. DOM 만 숨기면 selection 이 남아,
       다음 state 푸시(행동마다 온다)의 refreshAll → renderPanel 이 패널을 도로 열었다 —
       「닫았는데 계속 다시 켜진다」의 정체. Esc·다른 닫기 단추들은 이미 이렇게 한다. */
    var x = U.btn('✕', 'btn-sm btn-ghost ctx-close', function () {
      S.clearSelection();
      hideContext();
    });
    x.setAttribute('aria-label', '닫기');
    head.appendChild(x);
    p.appendChild(head);

    if (o.facts && o.facts.length) {
      var fw = U.el('div', 'ctx-facts');
      o.facts.forEach(function (f) {
        var s = U.el('span');
        s.appendChild(U.el('b', null, f.k + ' '));
        s.appendChild(U.el('span', null, f.v));
        /* ★ §15-B-1 — 뜻은 곧바로(data-tip2), 곁가지만 잠깐 머물면(data-tip3) */
        if (f.tip) U.tipSet(s, f.k + ' ' + f.v, f.tip, f.detail || null);
        fw.appendChild(s);
      });
      p.appendChild(fw);
    }
    if (o.note) p.appendChild(U.el('p', 'hint', o.note));
    if (o.extra) p.appendChild(o.extra);

    if (o.actions && o.actions.length) {
      var aw = U.el('div', 'ctx-acts');
      o.actions.forEach(function (a) {
        var b = U.btn(a.label, a.cls || '', a.onClick);
        if (a.disabled) b.disabled = true;
        /* ★ §15-B-1 — 단추가 무엇을 하는지는 곧바로. 「자재는 더 들지 않습니다」 같은 곁가지만 지연. */
        if (a.tip) U.tipSet(b, a.label, a.tip, a.detail || null);
        if (a.id) b.id = a.id;
        aw.appendChild(b);
      });
      p.appendChild(aw);
    }
  }
  function hideContext() {
    var p = U.qs('#context-panel');
    if (p) { p.hidden = true; U.clear(p); }
  }

  /* ══════════ ★ GDD3 §14-5 — 나의 상태 (초상 · HP · XP · 레벨) ══════════
     피드백: "내 체력도 레벨도 안 보인다". 화면 왼쪽 아래에 늘 떠 있는 작은 판 하나로 답한다.
     값은 전부 서버가 낸 것을 그대로 쓴다(you.player.progress) — 화면은 셈을 하지 않는다.
     남은 스탯 포인트가 있으면 레벨 배지가 반짝이고, 판을 누르면 캐릭터 창이 열린다. */
  var lastLevel = null;
  /* ★ §17-7 — 잠자기 표 상태(화면 쪽 기억) */
  var sleep = { on: false, slept: 0, need: 1 };
  var lastSleepDay = null;

  /**
   * ★ §19-C — 날이 바뀌면 잠에서 깬다.
   * 「왜」 화면에도 필요한가 — 잠자기 표는 ack 로만 돌아온다: 여럿이 하는 판에서 마지막 사람이
   * 자면 하루는 넘어가지만 **먼저 잔 사람의 화면**에는 「잠듦」이 그대로 남았다(서버 표는
   * tick.js 가 아침마다 비운다). 날짜가 바뀐 것을 보는 이 자리에서 같이 깨운다.
   */
  function wakeOnNewDay(v) {
    var day = (v && v.day) || 0;
    if (lastSleepDay === day) return;
    lastSleepDay = day;
    if (!sleep.on && !sleep.slept) return;
    sleep.on = false; sleep.slept = 0;
    renderMe();
  }

  /* ★ §17-19 — 맞은 순간의 반응을 내는 자리. 수치는 전부 data/world.json render.hit 이 쥔다. */
  var lastHurtAt = 0;
  var lastHp = null;

  /**
   * ★ §17-19 — 내가 맞으면 화면이 한 번 흔들리고 붉게 번지고, 깎인 수가 몸에서 떠오른다.
   * 「왜」 한 곳으로 모았나 — 같은 매가 두 길로 온다(전투 사건 playerHit · 체력 감시 watchHp).
   *   두 길이 각자 흔들면 한 대에 화면이 두 번 요동친다. mergeMs 안의 두 번째는 조용히 삼킨다.
   */
  function hurt(amount) {
    var c = S.hitFx();
    var at = Date.now();
    if (at - lastHurtAt < c.mergeMs) return;
    lastHurtAt = at;
    GM.fx.hitStop(c.hitStopMs);
    GM.fx.shakeScreen(c.shake, c.shakeSeconds);
    GM.fx.flash(c.flashColor, c.flashAlpha, c.flashSeconds);
    var me = GM.avatar && GM.avatar.pos && GM.avatar.pos();
    if (!me || !(amount > 0)) return;
    GM.fx.floatText(me.x, me.y - 1.2, '-' + U.fmt(amount, 0), c.textColor, c.textSize);
  }

  /**
   * ★ §17-19 — 체력이 줄어든 순간을 잡는다. 사건이 붙지 않는 매(들짐승·굶주림)도 몸으로 느껴져야 한다.
   *   잔 눈금(minDamage 아래)은 넘기고, 쓰러진 뒤는 다운 화면(down.js)에 맡긴다.
   */
  function watchHp(p) {
    var hp = Math.max(0, p.hp || 0);
    var prev = lastHp;
    lastHp = hp;
    if (prev == null || p.down) return;
    if (prev - hp < S.hitFx().minDamage) return;
    hurt(prev - hp);
  }

  function bar(cls, ratio, text, tip, title) {
    var b = U.el('div', 'me-bar ' + cls);
    var fill = U.el('i');
    fill.style.width = Math.round(U.clamp(ratio, 0, 1) * 100) + '%';
    b.appendChild(fill);
    b.appendChild(U.el('span', null, text));
    if (tip) U.tipSet(b, title || '', tip);
    return b;
  }

  /* ★ Sprint 3 — 「나」 칸의 서명. 이 칸이 읽는 값을 **하나도 빼놓지 않고** 이어 붙인다:
     쓰러짐·이름·체력·최대체력 / 단계·눈금비·능력치점수·눈금·다음눈금·이전눈금 / 생김새 / 잠자기 표.
     하나라도 빠뜨리면 화면이 옛 값에 멈춰 버리므로, 의심스러우면 넣는 쪽을 골랐다. */
  function meSig(p, prog) {
    var mine = (S.S.avatars || []).filter(function (a) { return a.id === S.S.avatarId; })[0];
    var look = (mine && mine.appearance) || (S.S.you && S.S.you.appearance) || null;
    return [p.down ? 1 : 0, p.name || '', p.hp || 0, p.maxHp || 0,
            prog.level, prog.ratio, prog.points, prog.xp, prog.need, prog.from,
            look && GM.atlas.appKey ? GM.atlas.appKey(look) : '-',
            sleep.on ? 1 : 0, sleep.slept, sleep.need].join('|');
  }

  function renderMe() {
    var host = U.qs('#me-panel');
    if (!host) return;
    var p = S.player();
    if (!p) { host.hidden = true; U.clear(host); host.removeAttribute('data-sig'); return; }
    var prog = p.progress || { level: 1, ratio: 0, points: 0, xp: 0, need: null };
    host.hidden = false;
    watchHp(p);                              // ★ §17-19 — 체력이 깎인 순간을 여기서 잡는다
                                             //   (★ Sprint 3 — 서명보다 **먼저**: 걸러 낼 수 없는 일이다)
    var meSg = meSig(p, prog);
    if (host.getAttribute('data-sig') === meSg) { meLevelWatch(prog); return; }
    host.setAttribute('data-sig', meSg);
    U.clear(host);
    host.classList.toggle('down', !!p.down);

    var face = U.el('div', 'me-face');
    var mine = (S.S.avatars || []).filter(function (a) { return a.id === S.S.avatarId; })[0];
    var look = (mine && mine.appearance) || (S.S.you && S.S.you.appearance) || null;
    if (look && GM.atlas.avatarImg) face.appendChild(GM.atlas.avatarImg(look, 40));
    else face.appendChild(GM.icons.img('person', 34));
    var lv = U.el('span', 'me-lv', String(prog.level));
    if (prog.points > 0) lv.style.background = 'var(--gold-deep)';
    face.appendChild(lv);
    host.appendChild(face);

    var bars = U.el('div', 'me-bars');
    var name = U.el('div', 'me-name');
    name.appendChild(U.el('span', null, p.name || '개척자'));
    if (prog.points > 0) name.appendChild(U.el('span', 'me-pts', '능력치 +' + prog.points));
    bars.appendChild(name);

    var hp = Math.max(0, p.hp || 0);
    var maxHp = Math.max(1, p.maxHp || 1);
    var ratio = hp / maxHp;
    var hpCls = 'hp' + (ratio <= 0.25 ? ' crit' : (ratio <= 0.5 ? ' low' : ''));
    bars.appendChild(bar(hpCls, ratio, U.fmt(hp, 0) + ' / ' + U.fmt(maxHp, 0),
      '쓰러져도 죽지 않습니다 — 모닥불 곁에서 다시 일어납니다.\n체력 능력치 한 점마다 최대치가 10 늘어납니다.', '체력'));

    var xpText = prog.need != null
      ? U.fmt(prog.xp - prog.from, 0) + ' / ' + U.fmt(prog.need - prog.from, 0)
      : '다 올랐다';
    bars.appendChild(bar('xp', prog.ratio || 0, xpText,
      '다섯 솜씨(농사·벌목·채광·건설·전투)로 얻은 눈금을 모두 더한 값입니다.\n한 단계 오를 때마다 능력치 점수를 하나 받습니다.',
      '눈금 · ' + prog.level + '단계'));
    host.appendChild(bars);

    /* ★ §17-7 — 다같이 잠자기(하루 넘기기). 사람 아바타가 모두 잠들면 하루가 곧장 넘어간다. */
    var zzz = U.el('button', 'me-sleep' + (sleep.on ? ' on' : ''));
    zzz.type = 'button';
    zzz.appendChild(GM.icons.img('moon', 18));
    zzz.appendChild(U.el('span', null, sleep.on ? '잠듦 ' + sleep.slept + '/' + sleep.need : '잠자기'));
    U.tipSet(zzz, '잠자리에 든다', '사람 모두가 잠들면 하루가 곧장 넘어갑니다.\n혼자라면 누르는 즉시 다음 날입니다. 싸움 중에는 잘 수 없습니다.');
    zzz.onclick = function (e) {
      e.stopPropagation();
      var turnOn = !sleep.on;
      GM.net.send('sleepVote', { on: turnOn }, function (r) {
        if (!r || !r.ok) { if (r && r.error) U.toast(r.error.message, 'warn'); return; }
        if (r.advanceDay) {
          sleep.on = false; sleep.slept = 0;
          GM.sfx.play('page');
        } else {
          sleep.on = turnOn; sleep.slept = r.slept || 0; sleep.need = r.need || 1;
          if (turnOn && sleep.need > 1) {
            U.toast('잠들었습니다 — ' + sleep.slept + '/' + sleep.need + '명. 모두 잠들면 하루가 넘어갑니다.', 'good');
          }
        }
        renderMe();
      });
    };
    host.appendChild(zzz);

    host.onclick = function () { GM.equip.open(); };
    U.tipSet(host, '나의 상태', '눌러서 캐릭터 창을 엽니다 (C).');

    meLevelWatch(prog);
  }

  /** ★ Sprint 3 — 단계가 오른 순간은 한 번만 알린다.
      서명이 같아 화면을 안 고치는 프레임에도 이 판정은 반드시 지나가야 하므로 따로 뺐다
      (사실 단계가 오르면 서명이 달라지지만, 이 알림을 서명에 매달아 두지 않는 편이 안전하다). */
  function meLevelWatch(prog) {
    if (lastLevel != null && prog.level > lastLevel) {
      GM.sfx.play('levelup');
      U.banner({ icon: 'up', kind: 'good', title: prog.level + '단계가 되었다',
                 sub: '능력치 점수를 하나 받았습니다 — C 를 눌러 나눠 주세요.', ms: 3600 });
    }
    lastLevel = prog.level;
  }

  /* ══════════ 도움말 ══════════ */
  function openHelp() {
    var body = U.el('div');
    body.appendChild(U.el('p', null, '마차가 멈춘 자리에 모닥불 하나. 여기서 정착지를 키웁니다. 끝은 없습니다.'));
    var ul = U.el('ul');
    [['걷기', 'W A S D 로 걷습니다. 빈 땅을 **오른쪽 단추**로 누르면 그리로 걸어갑니다 — 왼쪽 단추는 고르고 만지는 데만 씁니다.'],
     ['일하기', '나무·바위·밭·공사 곁에서 누르고 있으면(또는 E 를 누르고 있으면) 계속 스윙합니다. 발밑의 링이 다음 스윙까지 남은 시간입니다.'],
     ['건설', 'B 를 눌러 갈래에서 고르고 땅을 누릅니다. 지은 건물을 누르면 개축·수리·이전·철거를 할 수 있습니다.\n아직 잠긴 건물은 흐리게 자물쇠와 함께 남아, 언제 열리는지 알려 줍니다.'],
     ['정착지', '한가운데 큰 본부를 누르면 정착지 패널이 열립니다. 다음 단계 조건과 사람이 찾아오는 조건이 거기 다 있고, 조건이 차면 [승격]을 눌러 땅을 넓힙니다.'],
     ['울타리', 'F 를 누르고 지도를 끌면 선을 따라 조각이 섭니다. Shift 를 누른 채 끝내면 문이 됩니다.'],
     ['주민', '끌어서 고르고 오른쪽 단추로 일터를 지정합니다. 사람은 빈 잠자리와 식량이 있으면 스스로 찾아옵니다.'],
     ['싸움', '무리가 몰려오면 검을 들고 직접 붙을 수 있습니다. 쓰러져도 죽지 않습니다 — 10초를 세면 모닥불에서 체력 절반으로 일어나고, 3초 동안은 아무도 나를 건드리지 못합니다(사기가 조금 내려갑니다).'],
     ['나의 상태', '왼쪽 아래 초상 옆이 체력과 눈금입니다. 눈금이 차면 단계가 오르고 능력치 점수를 하나 받습니다 — C 를 눌러 나눠 주세요.'],
     ['보기 고치기', 'Esc 또는 오른쪽 위 톱니로 설정을 엽니다. 화면 밝기와 소리 크기를 여기서 고칩니다.'],
     ['함께 하기', '오른쪽 명부에서 초대 코드를 건네고, Enter 로 한 줄을 나눕니다.']].forEach(function (r) {
      var li = U.el('li');
      li.appendChild(U.el('b', null, r[0] + ' — '));
      li.appendChild(U.el('span', null, r[1]));
      ul.appendChild(li);
    });
    body.appendChild(ul);
    body.appendChild(U.el('p', 'hint', 'Esc 로 고른 것을 물리고 창을 닫습니다. Space 는 나에게, H 는 정착지로.'));
    var foot = U.el('div');
    var ok = U.btn('알겠다', 'btn-primary', function () { U.closeTopModal(); });
    foot.appendChild(ok);
    U.openModal({ title: '어떻게 하나요', body: body, footer: foot, width: '620px',
                  icon: GM.icons.img('scroll', 22) });
  }

  /* ══════════ 갱신 ══════════ */
  function update() {
    var n = S.nation();
    if (!n) return;
    detectCompletions(n);
    renderResBar();
    renderBadges();
    renderNotices();
    renderToolbar();
    renderCabinet();
    renderMe();                       /* ★ §14-5 — 초상 옆 HP·XP·단계 */
    renderUpcoming();                 /* ★ §16-16 — 다가오는 것들 + 아침 안내판 */
    var kn = U.qs('#tb-kingdom');
    if (kn) kn.textContent = n.name || '';
    if (GM.build) GM.build.refresh();
    snapshotRes();
  }

  function detectCompletions(n) {
    var cur = {};
    S.structures().forEach(function (b) { cur[b.id] = b.tier; });
    lastStructures = cur;
  }

  function reset() {
    lastRes = {}; flashes = []; lastStructures = null; lastLevel = null;
    lastHp = null; lastHurtAt = 0;           // ★ §17-19 — 판이 바뀌면 옛 체력 기억도 버린다
    var me = U.qs('#me-panel'); if (me) { me.hidden = true; U.clear(me); me.removeAttribute('data-sig'); }
    var cab = U.qs('#cabinet'); if (cab) cab.removeAttribute('data-sig');
    var bar = U.qs('#toolbar'); if (bar) bar.removeAttribute('data-sig');
    /* ★ Sprint 3 — 새로 단 서명들도 함께 버린다. 판이 갈렸는데 옛 서명이 남아 있으면
       화면이 「똑같다」고 잘못 짚어 헌 그림을 그대로 붙들고 있게 된다. */
    noticeNow = [];
    ['#notices', '#upcoming', '#badge-tier', '#badge-threat'].forEach(function (sel) {
      var el = U.qs(sel); if (el) el.removeAttribute('data-sig');
    });
    closeSpeech(); hideContext();
  }

  /**
   * ★ GDD3 §12-10 — HUD 시계의 해·달 원호.
   *   하루(0~1)를 반원에 얹는다. 낮 절반(0.05~0.75)은 해가, 나머지는 달이 같은 길을 간다.
   *   캔버스 하나에 매 갱신마다 다시 그린다 — 아주 작아서 값이 싸다.
   */
  function skyArc(f) {
    var W = 58, H = 26;
    var cv = U.el('canvas', 'sky-arc decor');
    cv.width = W * 2; cv.height = H * 2;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    var g = cv.getContext ? cv.getContext('2d') : null;
    if (!g) return cv;
    g.scale(2, 2);
    var cx = W / 2, cy = H - 3, r = W / 2 - 4;
    /* 하늘 길 */
    g.strokeStyle = 'rgba(60,40,20,.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, r, Math.PI, 0);
    g.stroke();
    /* 지평선 */
    g.strokeStyle = 'rgba(60,40,20,.5)';
    g.beginPath();
    g.moveTo(2, cy); g.lineTo(W - 2, cy);
    g.stroke();

    var night = f >= 0.75 || f < 0.05;
    /* 낮은 0.05~0.75 를 반원 하나로, 밤은 0.75~1.05 를 다시 반원 하나로 */
    var k = night ? (((f + 0.25) % 1) / 0.3) : ((f - 0.05) / 0.7);
    k = Math.max(0, Math.min(1, k));
    var a = Math.PI - k * Math.PI;
    var px = cx + Math.cos(a) * r;
    var py = cy - Math.sin(a) * r;
    g.fillStyle = night ? '#dfe4f5' : '#f6cf7a';
    g.beginPath();
    g.arc(px, py, night ? 4 : 5, 0, Math.PI * 2);
    g.fill();
    if (night) {                       // 달은 한쪽을 베어 초승으로
      g.fillStyle = '#3b2318';
      g.beginPath();
      g.arc(px + 2.4, py - 1.2, 3.6, 0, Math.PI * 2);
      g.fill();
    } else {                           // 해는 빛살
      g.strokeStyle = 'rgba(246,207,122,.75)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(px, py, 7.5, 0, Math.PI * 2);
      g.stroke();
    }
    return cv;
  }

  /* ══════════ ★ §16-15 · §16-16 — 다가오는 것들 · 아침 안내판 ══════════
     턴제 전략물의 「한 턴만 더」에서 배웠다: 다음에 올 것들의 카운트다운이 눈앞에 있어야
     "한 번만 더 보고 잔다"가 생긴다. 농장 생활물의 아침 일기예보처럼 아침(일 틱)마다 같은 내용을
     배너 한 줄로도 알린다. 전부 이미 서버가 주던 값이다 — 모아서 보여줄 뿐이다. */
  var lastMorning = null;

  function upcomingRows() {
    var rows = [];
    var v = S.S.view || {};
    var w = S.wave();
    if (w && w.unlocked && !w.active) {
      if (w.daysUntil != null) rows.push({ icon: 'sword', text: '웨이브 D-' + U.fmt(w.daysUntil, w.daysUntil < 2 ? 1 : 0) + (w.enemy && w.enemy.name ? ' · ' + w.enemy.name : '') });
      else if (w.daysUntilMin != null) rows.push({ icon: 'sword', text: '웨이브 D-' + U.fmt(w.daysUntilMin, 0) + '±' });
    }
    var r = v.research;
    if (r && r.active) {
      var meta = (r.list || []).filter(function (x) { return x.key === r.active.key; })[0];
      rows.push({ icon: 'book', text: '연구 「' + ((meta && meta.name) || r.active.key) + '」 D-' + U.fmt(r.active.remainingDays || 0, 0) });
    }
    var hz = v.nation && v.nation.housing && v.nation.housing.arrival;
    if (hz && hz.open && hz.daysUntil != null) {
      rows.push({ icon: 'person', text: '다음 주민 D-' + U.fmt(hz.daysUntil, hz.daysUntil < 2 ? 1 : 0) });
    }
    var tn = v.tier && v.tier.next;
    if (tn) {
      if (tn.ready) rows.push({ icon: 'flag', text: '승격 준비 완료 — 본부의 [승격]' });
      else {
        var bad = (tn.reqs || []).filter(function (q) { return !q.ok; })[0];
        if (bad) rows.push({ icon: 'flag', text: tn.name + '까지 — ' + bad.text + ' (' + U.fmt(bad.have, 0) + '/' + U.fmt(bad.need, 0) + ')' });
      }
    }
    return rows.slice(0, 4);
  }

  function renderUpcoming() {
    var box = U.qs('#upcoming');
    if (!box) return;
    var rows = upcomingRows();
    if (!rows.length) { box.hidden = true; return; }
    box.hidden = false;
    /* ★ Sprint 3 — 「다가오는 것」 네 줄은 하루에 몇 번이나 바뀔까. 거의 안 바뀐다.
       그런데도 상태가 밀릴 때마다 줄을 부수고 아이콘 그림을 새로 만들고 있었다.
       그리는 데 쓰는 값은 아이콘과 글자 둘뿐이니 그것으로 서명을 만든다.
       ★ 아침 안내판(morningBoard)은 **서명과 무관하게 늘** 부른다 — 날이 바뀐 순간을
       재는 일이라 한 번이라도 걸러 먹으면 그날 아침이 통째로 사라진다. */
    var sig = '';
    for (var i = 0; i < rows.length; i += 1) sig += rows[i].icon + '' + rows[i].text + '';
    if (box.getAttribute('data-sig') !== sig) {
      box.setAttribute('data-sig', sig);
      U.clear(box);
      var head = U.el('div', 'up-head', '다가오는 것');
      box.appendChild(head);
      rows.forEach(function (r) {
        var line = U.el('div', 'up-row');
        line.appendChild(GM.icons.img(r.icon, 14));
        line.appendChild(U.el('span', null, r.text));
        box.appendChild(line);
      });
    }
    morningBoard(rows);
  }

  /** ★ §16-15 — 아침 안내판. 날이 바뀌는 순간 오늘의 예보를 배너 한 줄로. */
  function morningBoard(rows) {
    var day = S.S.view && S.S.view.day;
    if (day == null) return;
    if (lastMorning == null) { lastMorning = day; return; }   // 접속 첫 화면에는 떠들지 않는다
    if (day <= lastMorning) { lastMorning = Math.min(lastMorning, day); return; }
    lastMorning = day;
    if (S.battleLive()) return;                               // 싸움 중의 아침은 조용히 지나간다
    var sub = rows.map(function (r) { return r.text; }).join(' · ');
    dayCurtain(day, sub);
    U.banner({ icon: 'sun', kind: 'good', title: day + '일째 아침', sub: sub || '고요한 하루가 시작됩니다', ms: 4200 });
  }

  /* ★ §19-D(F03-4) — 날이 바뀌는 순간의 전환. 어둠이 한 번 덮었다 걷히고 그 위에 「N일차」가 크게 뜬다.
     「왜」 예보를 밑줄로 함께 다나 — 큰 글자만 뜨면 '무슨 날인지'가 빠진다. 아침 안내판(배너)은
     그대로 두어 다시 읽을 수 있게 하고, 이 장면은 눈을 한 번 돌리게 하는 몫만 맡는다. */
  function dayCurtain(day, sub) {
    var w = S.worldCfg();
    var c = (w && w.render && w.render.cinema) || {};
    var title = (c.dayTitle || '{n}일차').replace('{n}', day);
    U.epic({ title: title, sub: sub || null, kind: 'day', veil: true, ms: c.dayHoldMs });
  }

  GM.hud = {
    init: init, update: update, reset: reset,
    renderResBar: renderResBar, renderNotices: renderNotices, renderCabinet: renderCabinet,
    renderToolbar: renderToolbar, showContext: showContext, hideContext: hideContext,
    renderMe: renderMe,
    /* ★ §17-19 — 내가 맞았을 때의 반응(전투 사건도 이 문으로 들어온다) */
    hurt: hurt,
    flash: flash, brief: brief, openHelp: openHelp, paintSound: paintSound,
    chipPoint: chipPoint, absorb: absorb
  };
})(window);
