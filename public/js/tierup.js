/* tierup.js — ★ 성장의 가시화 (GDD3 §1 · §8).
   티어가 오르면: 팡파레 → 영토 말뚝이 새 반경으로 박히는 연출 → 새로 열린 건물 도감 카드.
   이 순간이 "땅이 눈에 띄게 넓어졌다"를 몸으로 느끼게 하는 자리다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var busy_ = false;

  function play(p) {
    if (!p) return;
    busy_ = true;
    var town = S.myTown();

    /* ① 팡파레 + 화면 번쩍 */
    GM.sfx.play('tierup');
    GM.fx.flash('#fff3d4', 0.4, 0.6);
    GM.fx.shakeScreen(4, 0.4);
    U.banner({ icon: 'tier', kind: 'tier', title: p.name + '이(가) 되었다',
               sub: p.line || '', ms: 4200 });

    /* ② 영토 말뚝이 새 반경으로 */
    if (town) GM.camera.moveTo(town.x, town.y);
    GM.world.animateTerritory(p.fromRadius || 6, p.radius || 6);
    var stakes = 0;
    var stakeTimer = setInterval(function () {
      stakes++;
      GM.sfx.play('stake');
      if (stakes >= 5) clearInterval(stakeTimer);
    }, 190);

    /* ③ 새로 들어온 자원 자리를 하나씩 짚어 준다 */
    (p.addedNodeIds || []).slice(0, 14).forEach(function (id, i) {
      setTimeout(function () {
        var n = S.nodeById(id);
        if (n) { GM.fx.ring(n.x, n.y, '#8dbb6d', 0.2, 1.3, 0.5); GM.fx.sparkle(n.x, n.y, 5, '#8dbb6d'); }
      }, 700 + i * 90);
    });

    /* ④ 도감 카드 */
    setTimeout(function () {
      busy_ = false;
      openCards(p);
      GM.quest.announceUnlocks((p.unlocks && p.unlocks.ui) || []);
    }, 2100);
  }

  var FEATURE_NAME = {
    gather: '채집', swing: '직접 노동', reclaim: '개간', placeBuilding: '건설', chronicle: '연대기',
    residentArrival: '주민 유입', commandVillagers: '주민 지시', reclaimField: '밭 일구기',
    fences: '울타리', waves: '바깥의 무리', prophecyHint: '예언',
    emotionDay: '감정의 날', roles: '역할', trade: '교역', departments: '부처', advisor: '조언',
    orders: '국법', council: '어전 회의', artifacts: '유물',
    highTierUpgrade: '상급 개축', diplomacy: '외교', prestige: '위신'
  };

  function openCards(p) {
    var body = U.el('div');
    body.appendChild(U.el('p', null,
      '땅이 반경 ' + (p.fromRadius || 0) + '에서 ' + p.radius + '(으)로 넓어졌습니다.' +
      (p.nodesGained ? ' 새 자원 자리 ' + p.nodesGained + '곳이 우리 것이 되었습니다.' : '')));

    var buildings = (p.unlocks && p.unlocks.buildings) || [];
    if (buildings.length) {
      body.appendChild(U.el('h3', 'sec-title', '새로 지을 수 있는 것'));
      var grid = U.el('div', 'codex-grid');
      buildings.forEach(function (b, i) {
        var key = b.key || b;
        var def = S.buildingDef(key) || {};
        var t1 = S.buildingTier(key, 1) || {};
        var card = U.el('div', 'codex');
        card.setAttribute('data-building', key);
        card.style.animationDelay = (i * 0.08) + 's';
        var cv = U.el('canvas', 'codex-art decor');
        cv.width = 72; cv.height = 72;
        var g = cv.getContext('2d');
        if (g) {
          g.imageSmoothingEnabled = false;
          try { g.drawImage(GM.atlas.building(key, 1), 0, 0, 72, 72); } catch (e) {}
        }
        card.appendChild(cv);
        card.appendChild(U.el('span', 'cx-n', b.name || def.name || key));
        card.appendChild(U.el('span', 'cx-c', S.categoryName(def.category)));
        if (def.desc) card.appendChild(U.el('span', 'cx-d', def.desc));
        if (t1.cost) card.appendChild(U.el('span', 'cx-cost', GM.build.costText(t1.cost, t1.gold)));
        grid.appendChild(card);
      });
      body.appendChild(grid);
    }

    var feats = ((p.unlocks && p.unlocks.features) || []).map(function (f) { return FEATURE_NAME[f] || f; });
    if (feats.length) {
      body.appendChild(U.el('h3', 'sec-title', '새로 열린 것'));
      var fw = U.el('div', 'unlock-grid');
      feats.forEach(function (name, i) {
        var c = U.el('div', 'unlock');
        c.style.animationDelay = (i * 0.07) + 's';
        c.appendChild(GM.icons.img('star', 30));
        c.appendChild(U.el('span', 'u-n', name));
        fw.appendChild(c);
      });
      body.appendChild(fw);
    }

    /* ★ v3.1 — 감정의 날은 티어가 아니라 감정소가 연다(GDD3 §11-4). 승격 카드는 승격만 말한다. */

    var foot = U.el('div');
    var ok = U.btn('둘러본다', 'btn-primary', function () { U.closeTopModal(); });
    ok.id = 'tierup-ok';
    foot.appendChild(ok);
    U.openModal({ title: p.name + '이(가) 되었다', body: body, footer: foot, width: '660px',
                  key: 'tierup', icon: GM.icons.img('tier', 22) });
    GM.sfx.play('unlock');
  }

  function busy() { return busy_; }

  GM.tierup = { play: play, busy: busy, openCards: openCards };
})(window);
