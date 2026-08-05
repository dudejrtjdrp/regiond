/* net.js — socket.io 래퍼. docs/PROTOCOL.md v3.0 의 이벤트만 취급한다.
   여기 없는 이벤트를 다른 모듈이 직접 쏘지 않도록, 송신은 전부 GM.net.send 를 통한다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state;

  /* PROTOCOL v3.0 §3 — 클라 → 서버 화이트리스트.
     ★ 폐기: expand · setWallFocus · placeTurret · removeTurret · workSite · buildStart */
  var OUT = [
    'join', 'requestWorld', 'requestChronicle',
    /* 실시간 — 스윙 */
    'actionSwing', 'combatSwing', 'lordMove',
    /* 건설 · 울타리 */
    'placeBuilding', 'upgradeStructure', 'repairStructure', 'reclaimField',
    'placeFence', 'upgradeFence', 'repairFence', 'removeFence',
    /* ★ GDD3 §12-12 — 철거 · 이전 · 되돌리기 */
    'demolishStructure', 'relocateStructure', 'cancelStructureWork',
    /* ★ GDD3 §12-2 — 정착지 승격(본부의 [승격] 단추) */
    'promoteSettlement',
    /* ★ GDD3 §13-D — RPG 계층: 모집 · 장비/강화/인첸트 · 연구 · 철로 */
    'recruitResident',
    'craftEquipment', 'enhanceEquipment', 'enchantEquipment',
    'startResearch', 'placeRail', 'removeRail',
    /* ★ §17-13 — 다리(물을 건넌다) · 매립(물을 덮는다) */
    'placeBridge', 'removeBridge', 'placeFill', 'removeFill',
    /* ★ §17-12 — 걷어내기: 영토 안의 자원 자리를 치워 땅을 낸다 */
    'clearNode',
    /* ★ GDD3 §14-5 — 레벨업 능력치 점수 나누기(캐릭터 창 C) */
    'allocStat',
    /* ★ GDD3 §15-C — 자동 플레이 켜기·끄기와, 손이 닿았을 때의 잠시 물러남 */
    'setAutoPlay',
    /* ★ §17-11 — 동료 상호작용: 지시(이곳으로 보낸다·해제) · 꾸미기(이름·모양새) */
    'commandCompanion', 'customizeCompanion',
    /* ★ §16-18 · §16-19 — 집결지 · 수비 깃발 */
    'setRally', 'setDefenseFlag',
    /* ★ 감정의 날 — 감정소를 눌러 여는 유일한 문 (GDD3 §11-4) */
    'appraiseLand',
    /* 주민 */
    'commandVillagers', 'setVillagerMix', 'setLabor',
    /* 경제 · 역할 (티어 해금) */
    'trade', 'respondOffer', 'decide', 'buyTool', 'sellWeapon', 'setQueue',
    'ordersSet', 'saintBuff', 'useArtifact', 'councilAck',
    'setAutoExport', 'setExportFloor', 'pickRole', 'delegate',
    'adviceAct', 'setAutoAssist', 'apAction', 'harvestNode', 'setBattlePlan',
    /* 사회 */
    'setAppearance', 'chat',
    /* ★ §17-7 — 다같이 잠자기(하루 넘기기) */
    'sleepVote',
    /* ★ §17-9 — 건물 손일(직접 상호작용) */
    'handWork'
  ];

  var socket = null;
  var queue = [];
  var lastJoin = null;

  /* ══════════ 지도 감시 ══════════ */
  var WATCH_RETRY_MS = 4500;
  var WATCH_FAIL_MS = 11000;
  var watchTimers = [];

  function clearWatch() { while (watchTimers.length) clearTimeout(watchTimers.pop()); }

  function startWorldWatch() {
    clearWatch();
    if (S.S.map) return;
    S.setBoot('waiting', '땅을 살피는 중…', null);
    watchTimers.push(setTimeout(function () {
      if (S.S.map) return;
      S.setBoot('retrying', '땅을 살피는 중…', '지도를 다시 청하고 있습니다.');
      send('requestWorld', {});
    }, WATCH_RETRY_MS));
    watchTimers.push(setTimeout(function () {
      if (S.S.map) return;
      S.setBoot('failed', '지도를 받지 못했습니다',
        '서버가 낡았거나 응답하지 않습니다. 서버 창을 닫고 npm start 로 다시 켜 주세요.');
      GM.ui.toast('지도를 받지 못했습니다 — 서버를 다시 켜 주세요.', 'bad', 12000);
    }, WATCH_FAIL_MS));
  }

  function checkProtocol(p) {
    var got = (p && p.protocol) || (p && p.config && p.config.protocol) || null;
    if (got === GM.PROTOCOL) return true;
    clearWatch();
    S.setBoot('failed', '서버가 낡았습니다',
      '화면은 ' + GM.PROTOCOL + '판인데 서버는 ' + (got ? got + '판' : '옛 판') +
      '입니다. 서버 창을 닫고 npm start 로 다시 켜 주세요.');
    GM.ui.toast('서버가 낡았습니다 — 서버를 다시 켜 주세요.', 'bad', 14000);
    return false;
  }

  function isMock() { return !!(socket && socket.__mock); }

  function connect(mock) {
    if (socket) return socket;
    if (mock) {
      socket = GM.mock.createSocket({ seed: 20260803 });
      S.set({ mock: true, connected: true });
      bind();
      GM.ui.toast('구경 모드 — 서버 없이 화면만 돌아갑니다.', 'warn', 5000);
      return socket;
    }
    if (typeof global.io !== 'function') {
      GM.ui.toast('서버에 닿지 못했습니다. 서버가 켜져 있는지 확인하세요.', 'bad', 8000);
      S.set({ connected: false });
      return null;
    }
    socket = global.io();
    socket.on('connect', function () {
      var wasIn = !!S.S.gameId;
      S.set({ connected: true });
      flush();
      if (wasIn && lastJoin) {
        var again = {};
        for (var k in lastJoin) if (Object.prototype.hasOwnProperty.call(lastJoin, k)) again[k] = lastJoin[k];
        again.gameId = S.S.gameId;
        out('join', again);
      }
      S.emit('net:connect');
    });
    socket.on('disconnect', function () {
      S.set({ connected: false });
      clearWatch();
      GM.ui.toast('연락이 끊겼습니다. 정착지는 스스로 굴러갑니다.', 'warn', 6000);
      S.emit('net:disconnect');
    });
    socket.on('connect_error', function () { S.set({ connected: false }); });
    bind();
    return socket;
  }

  /* ── 서버 → 클라 (PROTOCOL §4) ───────────────────────── */
  function bind() {
    socket.on('joined', function (p) {
      S.set({
        gameId: p.gameId, nationId: p.nationId,
        avatarId: (p.you && p.you.avatarId) || null,
        you: p.you || { role: null }, config: p.config || null,
        joining: false
      });
      if (isMock() || checkProtocol(p)) startWorldWatch();
      S.emit('joined', p);
    });

    socket.on('you', function (p) {
      if (!p) return;
      var prev = S.S.you || {};
      S.set({ you: { role: p.role || null, avatarId: p.avatarId || S.S.avatarId, appearance: prev.appearance || null } });
      if (p.takenFrom) GM.ui.toast(p.takenFrom + '님의 자리를 넘겨받았습니다 — ' + (p.roleName || ''), 'good', 5200);
      else if (p.takenBy) GM.ui.toast(p.takenBy + '님이 그대의 자리를 넘겨받았습니다.', 'warn', 5600);
      S.emit('you', p);
    });

    socket.on('state', function (nv) {
      var prev = S.S.view;
      S.set({ prevView: prev, view: nv });
      S.syncYou();
      S.emit('state', nv);
    });

    socket.on('worldState', function (w) { S.set({ worldState: w }); S.emit('worldState', w); });
    socket.on('world', function (w) { clearWatch(); S.applyWorld(w); });
    socket.on('worldDiff', function (d) { S.applyWorldDiff(d); });

    socket.on('events', function (list) {
      if (!list) return;
      if (!Array.isArray(list)) list = [list];
      var all = list.slice().reverse().concat(S.S.events).slice(0, 300);
      S.set({ events: all });
      S.emit('events', list);
    });

    /* ★ v3 신설 이벤트 */
    socket.on('tierUp', function (p) { S.emit('tierUp', p); });
    /* ★ §17-14 — 깃발 점령. 새 영토 원이 생겼다(배너 + 자리 짚기). */
    socket.on('territoryClaimed', function (p) { S.emit('territoryClaimed', p); });
    socket.on('residentArrived', function (p) { S.emit('residentArrived', p); });
    /* ★ GDD3 §13-D-5 — 연구 완료. 새 노두가 드러나는 순간이라 지도를 다시 청한다. */
    socket.on('researchDone', function (p) { S.emit('researchDone', p); });
    socket.on('buildingDone', function (p) { S.emit('buildingDone', p); });
    socket.on('waveIncoming', function (p) { S.emit('waveIncoming', p); });
    socket.on('battleStart', function (p) { S.set({ battle: p }); S.emit('battleStart', p); });
    socket.on('battleTick', function (p) { S.set({ battle: p }); S.emit('battleTick', p); });
    socket.on('waveResult', function (p) { S.set({ battle: null, lastWave: p }); S.emit('waveResult', p); });
    socket.on('chronicle', function (p) { S.set({ chronicle: p }); S.emit('chronicle', p); });
    /* 동료의 스윙 — 창고는 나라 공용이라 잔고·노드 잔량은 함께 갱신한다(솜씨 장부는 제외) */
    socket.on('swing', function (p) {
      try { S.applyAck(p && p.type, p, { self: false }); } catch (e) {}
      S.emit('swing', p);
    });

    /* ★ v3.2 — 상시 생태계(GDD3 §13-C). 1초에 한 번 들의 것들이 어디 있는지가 온다.
       화면은 이 좌표로 튀지 않는다 — world.js 가 그 사이를 보간해 걸어가게 만든다. */
    socket.on('creatures', function (p) { S.applyCreatures(p && p.list, p && p.shots); });
    socket.on('wildHit', function (p) { S.emit('wildHit', p); });
    /* ★ GDD3 §15-A-2 — 터렛이 잡았다. 드롭은 서버가 이미 국고에 넣었다:
       화면은 그 값을 쓰러진 자리에 띄우고 자원칸을 곧바로 고쳐 쓴다(주민 사이클과 같은 문). */
    socket.on('turretKill', function (p) {
      if (!p) return;
      if (p.resources) S.applyLiveResources(p.resources);
      S.emit('turretKill', p);
    });
    socket.on('playerDown', function (p) { S.emit('playerDown', p); });
    socket.on('playerRevived', function (p) { S.emit('playerRevived', p); });

    /* ★ GDD3 §14-1 — 주민의 작업 사이클이 끝났다. 서버가 이미 곳간에 넣은 값이 함께 온다:
       화면은 그 값을 그 사람 자리에 띄우고 자원칸을 곧바로 고쳐 쓴다(일 틱을 기다리지 않는다). */
    socket.on('residentWork', function (p) {
      if (!p) return;
      if (p.resources) S.applyLiveResources(p.resources);
      S.emit('residentWork', p);
    });

    socket.on('emotionDay', function (p) { S.set({ emotionDay: p }); S.emit('emotionDay', p); });
    socket.on('mandate', function (p) { S.set({ mandate: p }); S.emit('mandate', p); });
    socket.on('council', function (p) { S.set({ council: p }); S.emit('council', p); });
    socket.on('campSpotted', function (p) { S.emit('campSpotted', p); });
    socket.on('campScouted', function (p) { S.emit('campScouted', p); });
    socket.on('ruinEvent', function (p) { S.emit('ruinEvent', p); });
    socket.on('report', function (p) { S.set({ report: p }); S.emit('report', p); });

    /* ★ v3.1 — 진행 감독(콘텐츠 사슬). 장이 넘어갈 때만 온다. */
    socket.on('questStep', function (p) { S.emit('questStep', p); });
    socket.on('chapterDone', function (p) { S.emit('chapterDone', p); });
    socket.on('chapterOpen', function (p) { S.emit('chapterOpen', p); });

    socket.on('avatars', function (list) {
      S.set({ avatars: Array.isArray(list) ? list : [] });
      S.emit('avatars', S.S.avatars);
    });
    socket.on('chatHistory', function (list) {
      S.set({ chat: Array.isArray(list) ? list.slice() : [] });
      S.emit('chatHistory', S.S.chat);
    });
    socket.on('chat', function (m) {
      if (!m) return;
      var next = (S.S.chat || []).concat([m]).slice(-100);
      S.set({ chat: next });
      S.emit('chat', m);
    });
    socket.on('offer', function (o) {
      var list = S.S.offers.filter(function (x) { return x.offerId !== o.offerId; });
      list.unshift(o);
      S.set({ offers: list.slice(0, 20) });
      S.emit('offer', o);
    });

    socket.on('serverError', function (e) {
      e = e || {};
      /* 쿨타임은 사고가 아니다 — 토스트로 잔소리하지 않는다 */
      if (e.code === 'COOLDOWN' || e.code === 'NOT_READY') { S.emit('server:error', e); return; }
      GM.ui.toast((e.message || '그 명은 받들 수 없습니다.'), 'bad', 5200);
      if (GM.sfx) GM.sfx.play('deny');
      /* ★ GDD3 §11-3 — 같은 오류가 두 번이면 '어떻게 하는지'를 말풍선으로 준다(+ 그 자리에 마커) */
      if (GM.quest && GM.quest.onError) { try { GM.quest.onError(e); } catch (e2) {} }
      S.emit('server:error', e);
    });
  }

  function flush() {
    while (queue.length) { var q = queue.shift(); out(q[0], q[1], q[2]); }
  }

  function out(evt, payload, ack) {
    if (typeof ack === 'function') {
      /* ★ ack 에 실려 온 권위값(창고 잔고·노드 잔량·공사 진척)을 먼저 장부에 옮겨 적고 넘긴다.
         스윙은 일 틱을 기다리지 않으므로, 이게 없으면 자원칸이 최대 10분 묵는다. */
      socket.emit(evt, payload, function (res) {
        try { S.applyAck(evt, res); } catch (e) { console.warn('[net] ack 반영 실패 ' + evt, e); }
        ack(res);
      });
    } else socket.emit(evt, payload);
  }

  function send(evt, payload, ack) {
    if (OUT.indexOf(evt) < 0) {
      console.error('[net] 규약에 없는 이벤트: ' + evt);
      return false;
    }
    if (evt === 'join') lastJoin = payload || {};
    if (!socket) { console.warn('[net] 소켓 없음, 무시: ' + evt); return false; }
    if (!S.S.connected && !isMock()) { queue.push([evt, payload || {}, ack || null]); return true; }
    out(evt, payload || {}, ack);
    return true;
  }

  function rest(method, path, body) {
    if (isMock()) return Promise.resolve(socket.rest(path, body || {}));
    var opt = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body) opt.body = JSON.stringify(body);
    return fetch(path, opt).then(function (r) {
      if (!r.ok) {
        /* ★ 호출한 쪽이 상태 코드로 갈래를 탈 수 있게 실어 준다
           (운영 서버는 개발 뒷문 /api/debug/* 를 404 로 닫아 둔다 — 개발 패널이 이걸 보고 조용히 접는다) */
        var e = new Error(path + ' → ' + r.status);
        e.status = r.status;
        throw e;
      }
      return r.json();
    });
  }

  GM.net = {
    connect: connect,
    send: send,
    isMock: isMock,
    socket: function () { return socket; },
    get: function (p) { return rest('GET', p); },
    post: function (p, b) { return rest('POST', p, b); }
  };
})(window);
