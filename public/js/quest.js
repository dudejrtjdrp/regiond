/* quest.js — ★ 안내 시스템 (GDD3 §11-3). 「뭘 해야 할지 모르는 순간 제로」의 화면 몫.
   원칙 셋:
     ① 목표 카드는 **언제나 한 장**이다. 서버의 진행 감독(state.chapter.goal)이 정본이고,
        화면은 그걸 그대로 옮겨 적는다 — 클라가 퀘스트를 지어내지 않는다.
     ② 카드는 **가리킨다**. 카드를 누르면 카메라가 목표로 뛰고, 월드에는 바운스 화살표가 선다
        (화면 밖이면 가장자리 화살표 — 그리는 것은 world.js).
     ③ 같은 실패가 두 번이면 **해결 방법**을 말풍선으로 준다. 오류만 두 번 뜨는 화면은 실패다.
   장이 넘어가면 팡파레 + 「새로 열린 것」 카드 한 장(1개념)만 띄운다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var shownKey = null;         // 지금 카드에 걸린 목표(장:칸)
  var hintedKeys = {};         // 코치마크는 목표마다 한 번만
  var errorCounts = {};        // 같은 오류가 몇 번째인가
  var lastErrorAt = 0;

  function goalKey() {
    var c = S.chapter();
    if (!c) return null;
    return c.goal ? (c.id + ':' + c.goal.key) : (c.id + ':done');
  }

  /* ══════════ 목표 카드 ══════════ */
  function update() {
    var card = U.qs('#goal-card');
    if (!card) return;
    if (!S.uiOn('hud.questCard') || !S.S.view) { card.hidden = true; return; }

    var ch = S.chapter();
    var g = ch && ch.goal;
    var key = goalKey();

    if (shownKey && key && shownKey !== key) celebrate(card);
    shownKey = key;

    card.hidden = false;
    U.clear(card);

    if (!g) {
      card.classList.remove('clickable');
      card.onclick = null;
      card.appendChild(U.el('span', 'gc-cap', ch ? ch.name : '이번에 할 일'));
      card.appendChild(U.el('span', 'gc-title', '한숨 돌려도 됩니다'));
      card.appendChild(U.el('span', 'gc-sub', '정착지는 스스로 자랍니다. 다음 이야기는 그대의 손끝에서 열립니다.'));
      return;
    }

    var p = S.goalProgress() || { have: g.have, need: g.need, ratio: 0 };
    card.appendChild(U.el('span', 'gc-cap', (ch.id < ch.total ? ch.id + '장 · ' : '') + ch.name));
    card.appendChild(U.el('span', 'gc-title', g.title));
    if (p.need > 1) {
      var gauge = U.makeGauge({ height: 15, color: '#6a994e' });
      gauge.setValue(p.ratio, U.fmt(p.have, 0) + ' / ' + U.fmt(p.need, 0), g.title, g.sub);
      card.appendChild(gauge);
    }
    if (g.sub) card.appendChild(U.el('span', 'gc-sub', g.sub));

    var where = pointerText(g);
    if (where) card.appendChild(U.el('span', 'gc-unlock', where));

    /* ★ §19-E(F04-6) — 이 장에 남은 칸. 「이 장이 언제까지 막힐지 모르겠다」의 답이다.
       조건까지 미리 재지는 않는다 — 열리지 않은 칸의 숫자는 스포일러이자 헛계산이다. */
    var rest = (ch.remaining || []).map(function (r) { return r.title; });
    if (rest.length) card.appendChild(U.el('span', 'gc-rest', '이 장에 남은 것 — ' + rest.join(' · ')));

    /* ★ Sprint 5 — 목표가 「사람 몇 명」이면 부르는 손도 여기 있어야 한다.
       여태 이 칸의 답은 「기다리세요」뿐이었다 — 본부까지 찾아가 갈래를 고르는 길은 있었지만
       카드를 읽은 사람에게는 보이지 않는 길이었다. 값을 치르고 하루를 앞당기는 선택을 여기 둔다. */
    maybeRecruit(card, g);

    /* ② 카드를 누르면 목표로 시선이 뛴다 */
    card.classList.add('clickable');
    card.onclick = function () { jumpToGoal(); };
    U.tipSet(card, g.title, (g.sub || '') + '\n눌러서 그 자리로 시선을 옮깁니다.');

    maybeHint(g);
  }

  /* ══════════ ★ Sprint 5 — 목표 카드 위의 [사람을 부른다] ══════════ */
  /** 조건 나무 어딘가에 사람 수를 세는 잎이 있는가 (any·all 은 갈래일 뿐 잎이 아니다) */
  function needsPeople(cond) {
    if (!cond) return false;
    if (cond.type === 'any' || cond.type === 'all') {
      var of = cond.of || [];
      for (var i = 0; i < of.length; i++) if (needsPeople(of[i])) return true;
      return false;
    }
    return cond.type === 'population';
  }

  function maybeRecruit(card, g) {
    if (!needsPeople(g.condition)) return;
    if (!S.cmdOn('recruitResident')) return;           // 잠긴 것은 부재다(§11-1)
    var r = S.recruitInfo() || {};
    var cost = Object.keys(r.cost || {}).map(function (k) {
      return S.resourceMeta(k).name + ' ' + U.fmt(r.cost[k], 0);
    }).join(' · ');
    var box = U.el('div', 'gc-act');
    var b = U.btn('사람을 부른다' + (cost ? ' — ' + cost : ''), 'btn-small btn-primary', function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();   // 카드 전체의 「시선 옮기기」가 함께 일어나지 않게
      sendRecruit();
    });
    b.id = 'gc-recruit';
    if (r.open === false) {
      b.disabled = true;
      U.tipSet(b, '아직 부를 수 없습니다', r.reason || '조건이 아직 모자랍니다.');
    } else {
      U.tipSet(b, '지금 한 사람을 부릅니다', '값을 치르면 그 자리에서 한 사람이 옵니다.');
    }
    box.appendChild(b);
    card.appendChild(box);
    if (r.open === false && r.reason) card.appendChild(U.el('span', 'gc-rest', r.reason));
    card.appendChild(U.el('span', 'gc-sub', '장식·사기·식량 잉여가 발걸음을 당깁니다.'));
  }

  function sendRecruit() {
    GM.net.send('recruitResident', {}, function (res) {
      if (!res) return;
      if (!res.ok) {
        U.toast((res.error && res.error.message) || '지금은 부를 수 없습니다.', 'warn', 3400);
        GM.sfx.play('deny');
        return;
      }
      GM.sfx.play('arrive');
      var nm = (res.resident && res.resident.name) || '한 사람';
      U.toast(nm + U.josa(nm, '이', '가') + ' 왔습니다.', 'good', 3200);
    });
  }

  /** 카드 아래 한 줄 — 어디를 봐야 하는가 */
  function pointerText(g) {
    var t = (g.targets || [])[0];
    if (!t) return null;
    if (t.kind === 'buildSlot') return '눌러서 [건설]로 — ' + (t.name || '');
    if (t.kind === 'ui') return '눌러서 그 단추로';
    var me = GM.avatar && GM.avatar.pos();
    if (me && t.x != null) {
      var d = Math.round(Math.hypot(t.x - me.x, t.y - me.y));
      return '눌러서 그 자리로 — ' + d + '칸 떨어져 있습니다';
    }
    return '눌러서 그 자리로';
  }

  /** 카드 클릭 = 카메라 점프 (월드 대상) 또는 단추 짚기 (화면 대상) */
  function jumpToGoal() {
    var g = S.goal();
    var t = g && (g.targets || [])[0];
    if (!t) return;
    if (t.x != null && t.y != null) {
      GM.camera.moveTo(t.x, t.y);
      GM.world.ping(t.x, t.y, '#f6cf7a');
      GM.sfx.play('tap');
      return;
    }
    var sel = t.sel || '#tb-build';
    pulse(sel);
    U.hintAt(sel, t.kind === 'buildSlot' ? (t.name || '') + '을(를) 여기서 고릅니다' : '여기입니다', 4200);
    GM.sfx.play('tap');
  }

  function pulse(sel) {
    var node = U.qs(sel);
    if (!node) return;
    node.classList.remove('quest-pulse');
    void node.offsetWidth;
    node.classList.add('quest-pulse');
    setTimeout(function () { node.classList.remove('quest-pulse'); }, 4200);
  }

  function celebrate(card) {
    card.classList.remove('done');
    void card.offsetWidth;
    card.classList.add('done');
    GM.sfx.play('fanfare');
    U.sparkle(card, '#6a994e');
    setTimeout(function () { card.classList.remove('done'); }, 800);
  }

  /* ══════════ 한 줄 코치마크 ══════════ */
  function maybeHint(g) {
    if (!g.hint || hintedKeys[g.key]) return;
    if (GM.opening && GM.opening.busy()) return;
    hintedKeys[g.key] = 1;
    setTimeout(function () {
      if (shownKey !== goalKey()) return;
      U.hintAt(g.hint.sel, g.hint.text, 6200);
    }, 900);
  }

  /* ══════════ ★ 장 전환 연출 (GDD3 §11-2) ══════════ */
  /** 장을 넘겼다 — 팡파레 + 「새로 열린 것」 카드 한 장(개념 하나만) */
  function chapterDone(p) {
    if (!p) return;
    GM.sfx.play('fanfare');
    GM.fx.flash('#fff0c8', 0.2, 0.45);
    var me = GM.avatar && GM.avatar.pos();
    if (me) {
      GM.fx.sparkle(me.x, me.y - 0.5, 26, '#f6cf7a');
      GM.fx.ring(me.x, me.y, '#f6cf7a', 0.2, 3.2, 0.9, 3);
    }
    U.banner({ icon: 'tier', kind: 'level', title: p.name + ' — 끝', sub: p.line || '', ms: 2600 });
    if (!p.card) return;
    setTimeout(function () { openUnlockCard(p.card); }, 1500);
  }

  /** 새로 연 장이 알려 주는 것 — 이것도 한 장, 한 개념 */
  function chapterOpen(p) {
    if (!p) return;
    setTimeout(function () {
      U.banner({ icon: 'scroll', kind: 'good',
                 title: p.id + '장 — ' + p.name, sub: p.subtitle || '', ms: 2600 });
    }, 400);
  }

  /**
   * 「새로 열린 것」 카드 — 한 번에 **한 개념**만 말한다.
   *   여러 개가 한꺼번에 열려도 카드는 한 장이고, 나머지는 코치마크가 줄을 서서 짚어 준다.
   */
  function openUnlockCard(cardData) {
    var body = U.el('div', 'unlock-card');
    var head = U.el('div', 'uc-head');
    head.appendChild(GM.icons.img(cardData.icon || 'star', 34));
    head.appendChild(U.el('span', 'uc-t', cardData.title || '새로 열렸습니다'));
    body.appendChild(head);
    body.appendChild(U.el('p', 'uc-x', cardData.text || ''));
    var foot = U.el('div');
    foot.appendChild(U.btn('알겠다', 'btn-primary', function () { U.closeTopModal(); }));
    U.openModal({ title: '새로 열린 것', body: body, footer: foot, width: '460px',
                  key: 'unlock', icon: GM.icons.img('star', 22) });
    GM.sfx.play('unlock');
  }

  /* ══════════ 새로 열린 UI 짚어 주기 ══════════ */
  var UI_HINT = {
    'panel.build': { sel: '#tb-build', text: '여기서 지을 것을 고르고 땅을 눌러 자리를 잡습니다' },
    'hud.population': { sel: '#res-bar', text: '이제 사람이 늘어납니다 — 인구가 위쪽에 보입니다' },
    'panel.residents': { sel: '#tb-people', text: '주민을 끌어서 고르고 오른쪽 단추로 일을 시킵니다' },
    'panel.skills': { sel: '#tb-skills', text: '그동안 익힌 솜씨를 여기서 봅니다' },
    'hud.threat': { sel: '#badge-threat', text: '바깥에서 무리가 오기 시작합니다 — 여기서 남은 날을 봅니다' },
    'panel.fence': { sel: '#tb-fence', text: '끌어서 선을 그으면 울타리가 섭니다' },
    'panel.roles': { sel: '#cabinet', text: '각료가 자리에 앉았습니다 — 초상을 누르면 보고를 듣습니다' },
    'panel.trade': { sel: '#cabinet', text: '교역소가 섰습니다 — 외교관에게 가면 흥정할 수 있습니다' },
    'panel.orders': { sel: '#cabinet', text: '국법을 적어 둘 수 있습니다' },
    'panel.council': { sel: '#cabinet', text: '어전 회의는 오른쪽 알림에 쌓입니다 — 여는 건 언제나 그대입니다' },
    'panel.diplomacy': { sel: '#cabinet', text: '이웃과 사절을 주고받습니다' },
    'panel.prestige': { sel: '#btn-chronicle', text: '위신이 쌓이기 시작했습니다' }
  };

  function announceUnlocks(keys) {
    var list = (keys || []).filter(function (k) { return UI_HINT[k] && !S.S.seenUi[k]; });
    list.forEach(function (k, i) {
      S.S.seenUi[k] = 1;
      setTimeout(function () {
        var h = UI_HINT[k];
        U.hintAt(h.sel, h.text, 5600);
        pulse(h.sel);
      }, 2600 + i * 5800);
    });
  }

  /* ══════════ ③ 같은 오류 두 번이면 해결 방법 ══════════ */
  /**
   * 오류 코드마다 「그럼 어떻게 하나」를 짝지어 둔다.
   *   fix.text  — 말풍선 한 줄
   *   fix.find  — 그 답이 있는 자리를 찾아 마커를 세운다(월드 좌표)
   */
  var FIX = {
    NO_RESOURCE: { text: null, find: 'need' },
    OUT_OF_RANGE: { text: '조금 더 가까이 가세요 — 대상 곁에 서야 손이 닿습니다', find: 'goal' },
    OUT_OF_TERRITORY: { text: '우리 땅 밖입니다 — 말뚝 안쪽에서만 일할 수 있습니다', find: 'town' },
    NOT_READY: { text: '아직 여물지 않았습니다 — 노란 표시가 뜬 밭만 거둘 수 있습니다', find: 'ripe' },
    DEPLETED: { text: '다 캐낸 자리입니다 — 다른 자리를 찾아보세요', find: 'goal' },
    NOT_WORKABLE: { text: '여기서는 거둘 것이 없습니다', find: 'goal' },
    COOLDOWN: { text: '숨을 고르는 중입니다 — 발밑 링이 차면 다시 휘두릅니다', find: null },
    CHAPTER_LOCKED: { text: '아직 그럴 때가 아닙니다 — 목표 카드가 가리키는 일을 먼저 끝내세요', find: 'goal' },
    NO_SPACE: { text: '자리가 좁습니다 — 건물끼리 두 칸은 떨어져야 합니다', find: null },
    BAD_TERRAIN: { text: '이 땅에는 지을 수 없습니다 — 풀밭이나 숲을 고르세요', find: null },
    ON_NODE: { text: '자원이 나는 자리입니다 — 한 칸 옆으로 옮기세요', find: null }
  };

  /** 자원 이름 → 그 자원이 나는 노드 종류 */
  var SOURCE = {
    wood: { types: ['forest'], text: '목재가 필요해요 — 나무는 짙은 초록 숲에 있습니다' },
    stone: { types: ['rock'], text: '석재가 필요해요 — 바위는 회색 언덕에 있습니다' },
    grain: { types: ['water', 'field', 'fertile'], text: '식량이 필요해요 — 물가에서 고기를 건지거나 여문 밭을 거두세요' },
    ironOre: { types: ['iron'], text: '철광석이 필요해요 — 광맥은 바위 지대 깊은 곳에 있습니다' },
    /* ★ §17-5 이후 고기도 목표 자원이다(3장 「곡물 20 또는 고기 7」) — 그 갈래로 가는 사람에게도 길을 짚어 준다 */
    meat: { types: ['water'], text: '고기가 필요해요 — 물가에서 건지거나 들짐승을 사냥하세요' }
  };

  /**
   * 서버가 실패를 돌려줬다. 두 번째부터는 '어떻게 하는지'를 말해 주고 그 자리를 짚는다.
   * @param {{code:string,message:string}} err
   */
  function onError(err) {
    if (!err || !err.code) return;
    var t = Date.now();
    if (t - lastErrorAt > 30000) errorCounts = {};       // 한참 지났으면 셈을 새로 한다
    lastErrorAt = t;
    var n = (errorCounts[err.code] = (errorCounts[err.code] || 0) + 1);
    if (n < 2) return;                                    // 첫 번째는 토스트로 족하다
    if (n > 4) return;                                    // 잔소리는 하지 않는다
    var fix = FIX[err.code];
    if (!fix) return;

    var text = fix.text;
    var spot = null;

    if (fix.find === 'need') {
      var lack = missingResource();
      if (lack && SOURCE[lack]) {
        text = SOURCE[lack].text;
        spot = nearestNodeOf(SOURCE[lack].types);
      }
    } else if (fix.find === 'goal') {
      var g = S.goal();
      var tg = g && (g.targets || [])[0];
      if (tg && tg.x != null) spot = { x: tg.x, y: tg.y };
    } else if (fix.find === 'town') {
      spot = S.myTown();
    } else if (fix.find === 'ripe') {
      spot = nearestNodeOf(['field', 'fertile'], function (nd) { return !!nd.harvestReady; });
    }
    if (!text) return;

    U.hintAt('#world-canvas', text, 6400);
    if (spot) {
      GM.world.ping(spot.x, spot.y, '#f6cf7a');
      GM.fx.floatText(spot.x, spot.y - 1.2, '여기', '#f6cf7a', 13);
    }
  }

  /** 지금 목표가 요구하는 것 중 가장 모자란 자원 */
  function missingResource() {
    /* ★ §17-E-1 — 목표 조건은 갈래(any·all)일 수 있다. 예전에는 `type === 'resource'` 인 잎 하나만
       봤기 때문에, 3장 「곡물 20 또는 고기 7」에서는 해결 말풍선이 통째로 침묵했다.
       이제 상태가 내주는 잎 목록(goalNeeds — 서버와 같은 자로 가까운 순)에서 **아는 자원**을 고른다. */
    var needs = S.goalNeeds ? S.goalNeeds() : [];
    for (var i = 0; i < needs.length; i++) if (SOURCE[needs[i].resource]) return needs[i].resource;
    var n = S.nation();
    if (!n) return null;
    var pl = S.S.placing;
    var b = pl && pl.key ? S.buildableOf(pl.key) : null;
    if (b && b.cost) {
      var worst = null, gap = 0;
      for (var r in b.cost) {
        if (!Object.prototype.hasOwnProperty.call(b.cost, r)) continue;
        var d = b.cost[r] - ((n.resources && n.resources[r]) || 0);
        if (d > gap) { gap = d; worst = r; }
      }
      if (worst) return worst;
    }
    return null;
  }

  function nearestNodeOf(types, filter) {
    var me = (GM.avatar && GM.avatar.pos()) || S.myTown();
    if (!me) return null;
    var best = null, bd = 1e9;
    S.nodeList().forEach(function (nd) {
      if (types.indexOf(nd.type) < 0 || nd.depleted) return;
      if (filter && !filter(nd)) return;
      var d = Math.hypot(nd.x - me.x, nd.y - me.y);
      if (d < bd) { bd = d; best = nd; }
    });
    return best;
  }

  function reset() { shownKey = null; hintedKeys = {}; errorCounts = {}; }
  function clearProgress() { reset(); }

  GM.quest = {
    update: update, reset: reset, clearProgress: clearProgress,
    announceUnlocks: announceUnlocks, chapterDone: chapterDone, chapterOpen: chapterOpen,
    jumpToGoal: jumpToGoal, onError: onError, openUnlockCard: openUnlockCard,
    current: function () {
      var g = S.goal();
      if (!g) return null;
      var p = S.goalProgress();
      return { g: { key: g.key, title: g.title, sub: g.sub }, cur: p.have, max: p.need };
    }
  };
})(window);
