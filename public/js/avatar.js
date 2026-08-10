/* avatar.js — 개척자 아바타. 위치는 클라가 관리하고, 행동 판정은 전부 서버가 한다.
   WASD/방향키 · **우클릭 지면** 이동(좌클릭은 선택 전용 — GDD3 §12-5). 노동은 GM.swing 이 맡는다(스윙 체계, GDD3 §3).
   ★ 걸을 때마다 둘레를 곧바로 밝힌다 — 검은 땅으로 들어가도 늘 주변이 보인다 (GDD3 §8). */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var me = { x: 64, y: 64, dir: 0, frame: 0, ft: 0 };
  var dest = null;
  /* ★ Sprint 1 — 목적지까지의 길(웨이포인트). 직진+한 번 미끄러짐은 물가에서 영원히
     제자리 걸음을 했다(Q-qa-4). 이제 우클릭 한 번에 GM.path 가 길을 한 번 내고, 걸음은 그 길을 따른다. */
  var path = null, pathI = 0, repathAt = 0;
  /* ★ Sprint 1 — 쓰러짐의 화면 쪽 빗장. 서버의 down 표(S.downed)는 다음 state 푸시까지 늦어,
     그 틈에 걷고 자리 보고까지 나갔다(부활 좌표를 덮는 절반). playerDown 이 오는 즉시 잠근다. */
  var downLocal = false;
  var lastReport = 0, lastX = -1, lastY = -1;
  var lastRevealX = -999, lastRevealY = -999;
  var placed = false;
  var frozen = false;             // 오프닝 동안에는 조작을 잠근다
  var hidden = false;             // ★ §12-7 — 마차가 굴러오는 동안에는 그리지 않는다

  /**
   * ★ GDD3 §12-7 — 시작 자리는 **한 곳**이다.
   *   오프닝에서 마차가 사람을 내려놓는 자리도, 오프닝을 건너뛰었을 때 서 있는 자리도,
   *   컷신이 끝나고 돌아오는 자리도 전부 이 식이 낸다. 세 곳이 달라서 "내렸는데 딴 데 있다"가 났었다.
   *   본부가 4×4 라 그 사각형 바깥(오른쪽 아래 모서리 옆)에 선다.
   */
  function animateWalk(dt) {
    var role = S.myRole && S.myRole();
    var frameCount = role ? 9 : 2;
    var running = GM.input && GM.input.keys && GM.input.keys.run;
    /* 달리기는 같은 8방향 도트 시퀀스를 더 빠르게 재생해 기존 그림체를 유지한다. */
    var interval = role ? (running ? 0.055 : 0.1) : (running ? 0.11 : 0.17);
    me.ft += dt;
    if (me.ft > interval) { me.ft = 0; me.frame = (me.frame + 1) % frameCount; }
  }

  function facing(dx, dy) {
    var ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax > ay * 2) return dx > 0 ? 6 : 2;
    if (ay > ax * 2) return dy > 0 ? 0 : 4;
    if (dx > 0) return dy > 0 ? 7 : 5;
    return dy > 0 ? 1 : 3;
  }

  function startPos(town) {
    /* The server assigns reconnects to the same safe respawn tile used after
       death. Never replace it with the old town-centre fallback on load. */
    var server = serverMe();
    if (server && Number.isFinite(server.x) && Number.isFinite(server.y)) {
      return { x: server.x, y: server.y };
    }
    var t = town || S.myTown();
    if (!t) return null;
    var hq = S.hq && S.hq();
    if (hq && S.footprintOfThing) {
      var f = S.footprintOfThing(hq);
      return { x: Math.round(hq.x + (f.w - 1) / 2), y: hq.y + f.h };
    }
    return { x: t.x + 3, y: t.y + 2 };
  }

  function init() {
    S.on('world', function () { placed = false; snapToTown(); });
  }

  function snapToTown() {
    var t = S.myTown();
    if (t && !placed) {
      var s = startPos(t);
      me.x = s.x; me.y = s.y;
      placed = true;
      reveal(true);
      report(true);
    }
  }

  /**
   * ★ GDD3 §13-D-3 — 스프라이트에 실을 장비 요약.
   *   그림에 필요한 것만 뽑는다(등급·강화 단수·인첸트 등급). 값이 바뀌면 표지를 새로 만든다.
   */
  var gearMark = null;
  function gear() {
    var e = S.equipment();
    if (!e || !e.gear) return null;
    var w = e.gear.weapon || {};
    var a = e.gear.armor || {};
    return {
      weaponGrade: w.grade || 0, weaponPlus: w.plus || 0,
      weaponEnchant: (w.enchant && w.enchant.grade) || null,
      armorGrade: a.grade || 0, armorPlus: a.plus || 0,
      armorEnchant: (a.enchant && a.enchant.grade) || null
    };
  }
  function markGear() { gearMark = Date.now(); }

  function pos() { return S.S.map ? me : null; }
  function destPos() { return dest; }
  function freeze(v) { frozen = !!v; if (v) { dest = null; path = null; } }
  function isFrozen() { return frozen; }
  function setHidden(v) { hidden = !!v; }
  function isHidden() { return hidden; }

  /* ★ Sprint 1 — 폴백 목록에 설산·정글이 빠져 있었다. 설정이 늦게 오는 첫 몇 프레임에
     그 땅을 밟고 있으면 「밟을 수 없는 곳에 서 있다」가 된다 — 잠복 버그를 미리 잰다.
     ★ Sprint 3 — 그 목록을 **표**로 세워 둔다. 길찾기(A*)가 칸마다 이 판정을 부르는데
     그때마다 배열을 훑으면(indexOf) 길 한 번에 수천 번의 헛걸음이 된다.
     설정 객체는 좀처럼 바뀌지 않으므로 같은 배열이면 세워 둔 표를 그대로 쓴다(값은 같다). */
  var WALK_FALLBACK = ['grass', 'forest', 'rock', 'fertile', 'snow', 'jungle',
    /* ★ §19-F2(F07-1) — 새로 붙은 여섯 땅도 걸을 수 있다. 정본은 서버 설정(terrain.walkable)이고
       이 목록은 설정이 오기 전 몇 프레임을 버티는 폴백이다 — 빠지면 그 땅에서 「밟을 수 없다」가 된다. */
    'desert', 'marsh', 'ash', 'mush', 'salt', 'dusk'];
  var walkTable = { src: null, map: null };
  function walkableCodes() {
    var w = S.worldCfg();
    var list = (w && w.terrain && w.terrain.walkable) || WALK_FALLBACK;
    if (walkTable.src !== list) {
      var map = {};
      for (var i = 0; i < list.length; i++) map[list[i]] = 1;
      walkTable.src = list; walkTable.map = map;
    }
    return walkTable.map;
  }

  function waterMargin(x, y) {
    var m = S.S.map;
    if (!m || !m.codes) return false;
    var cx = Math.round(x), cy = Math.round(y);
    for (var dy = -1; dy <= 1; dy += 1) for (var dx = -1; dx <= 1; dx += 1) {
      var nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && ny >= 0 && nx < m.size && ny < m.size && m.codes[m.terrain[ny * m.size + nx]] === 'water') return true;
    }
    return false;
  }

  /* Buildings use their full placement footprint for movement as well as drawing. */
  function structureBlocks(x, y) {
    var cx = Math.round(x), cy = Math.round(y);
    var list = S.structures ? S.structures() : [];
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      /* The persistent campfire key is also used by the upgraded settlement
         HQ.  Treat its full footprint as solid on the client as well. */
      var f = S.footprintOfThing ? S.footprintOfThing(b) : { w: 1, h: 1 };
      if (cx >= b.x && cx < b.x + f.w && cy >= b.y && cy < b.y + f.h) return true;
    }
    /* 완성 전 공사 현장도 이미 사람이 밟을 수 없는 부지다. */
    var sites = S.sites ? S.sites() : [];
    for (var j = 0; j < sites.length; j++) {
      var site = sites[j];
      if (site.mode !== 'build' || site.x == null || site.y == null) continue;
      var sf = S.footprintOf(site.building);
      if (cx >= site.x && cx < site.x + sf.w && cy >= site.y && cy < site.y + sf.h) return true;
    }
    return false;
  }

  /** 건물을 뺀 「땅만」의 판정 — 갇힘 탈출(아래 stuck)이 쓰는 반쪽이다 */
  function groundWalkable(x, y) {
    var code = S.terrainKey(Math.round(x), Math.round(y));
    if (!code) return false;
    if (code === 'water') return S.onBridge(x, y) || S.onFill(x, y);
    if (waterMargin(x, y)) return false;
    /* ★ §17-13 — 다리·매립 위의 물은 길이다. 사람만 — 짐승과 적은 서버가 그대로 막는다. */
    return walkableCodes()[code] === 1;
  }

  function walkable(x, y) {
    if (structureBlocks(x, y)) return false;
    return groundWalkable(x, y);
  }

  /* ★ §19-F2(F07-1) 땅의 무게 — 진창은 발을 물고 소금 판은 미끄럽다.
     값은 전부 자료(world.terrain.moveMultiplier)가 쥔다. 아바타 자리는 클라 권위라(§12-11)
     여기서 곱해도 서버와 어긋나지 않는다 — 서버는 「어디에 섰는가」만 받아 적는다. */
  function ground() {
    var w = S.worldCfg();
    var tbl = (w && w.terrain && w.terrain.moveMultiplier) || null;
    if (!tbl) return 1;
    var code = S.terrainKey(Math.round(me.x), Math.round(me.y));
    return code && tbl[code] > 0 ? tbl[code] : 1;
  }

  function speed() {
    /* 정착지가 커지면 몸도 가벼워진다 (GDD3 §3) */
    var p = S.player();
    var bonus = (p && p.tierSpeedBonus) || 0;
    /* ★ GDD3 §13-D-4 — 「바람 걸음」이 깃들면 실제로 더 빨리 걷는다 */
    var e = S.equipment();
    var charm = (e && e.effects && e.effects.moveSpeed) || 0;
    /* ★ GDD3 §14-5 — 민첩 한 점이 걸음을 3% 빠르게 한다(서버가 낸 값을 그대로 쓴다) */
    var agility = (p && p.progress && p.progress.effects && p.progress.effects.moveSpeed) || 1;
    var running = GM.input && GM.input.keys && GM.input.keys.run;
    /* ★ §20-R4b — 유물의 걸음(폭풍의 망토·바람의 깃). 서버가 you.clientStats 에 이미 얹어 두었는데
       아무도 안 읽고 있었다. state.js 에 접근자가 없어 여기서 방어적으로 읽는다(그 파일은 다른 트랙 몫).
       웨이브 중에는 망토가 한 겹 더 붙는다 — 최전선 스윙이 이 유물이 파는 값이다.
       유물이 없으면 move 가 0 이라 (1+move)=1 — 곱해도 지금 걸음이 한 톨도 달라지지 않는다. */
    var relic = ((S.you && S.you()) || {}).clientStats || {};
    var w = S.wave ? S.wave() : null;
    var move = (relic.moveSpeed || 0) + ((w && w.active) ? (relic.moveSpeedWave || 0) : 0);
    return 4.6 * (1 + bonus * 0.6) * (1 + charm) * agility * ground() * (running ? 1.55 : 1) * (1 + move);
  }

  /**
   * ★ GDD3 §15-C 자동 플레이 — 서버가 내 아바타를 몬다.
   *
   * 평소에 이 아바타의 자리는 **클라가** 쥔다(§12-11 — 그래야 걸음이 끊기지 않는다).
   * 자동 플레이가 도는 동안에는 그 소유권이 잠시 서버로 넘어간다: 서버가 두뇌를 굴려
   * 자리를 정하고, 화면은 avatars 채널로 오는 그 자리를 **따라 걷는다**(튀지 않는다).
   * 그래서 두 주인이 한 몸을 서로 다른 곳으로 끌지 않는다.
   */
  function serverMe() {
    var id = S.S.avatarId;
    var list = S.S.avatars || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function autoStep(dt) {
    var srv = serverMe();
    if (!srv) return;
    var dx = srv.x - me.x, dy = srv.y - me.y;
    var d = Math.hypot(dx, dy);
    if (d < 0.02) { me.frame = 0; return; }
    if (d > 12) { me.x = srv.x; me.y = srv.y; reveal(true); return; }   // 부활 등으로 멀리 옮겨졌다
    var k = Math.min(1, (speed() * 1.25 * dt) / d);
    me.x += dx * k; me.y += dy * k;
    me.dir = facing(dx, dy);
    animateWalk(dt);
    reveal(false);
  }

  /** 길 위의 다음 웨이포인트 — 다 밟았으면 null(도착) */
  function nextWaypoint() {
    if (!path) return dest;
    while (pathI < path.length) {
      var wp = path[pathI];
      if (Math.hypot(wp.x - me.x, wp.y - me.y) > 0.14) return wp;
      pathI += 1;
    }
    return null;
  }

  /** 목적지까지의 길을 한 번 낸다. 목표가 물이면 곁의 뭍으로, 못 닿으면 갈 수 있는 데까지. */
  function computePath() {
    if (!dest) return;
    path = (GM.path && GM.path.find) ? GM.path.find(me.x, me.y, dest.x, dest.y, walkable) : null;
    pathI = 1;
    if (path) {
      var end = path[path.length - 1];
      dest = { x: end.x, y: end.y };
    } else {
      dest = null;      // 제자리를 찍었거나 한 칸도 갈 수 없다 — 걷는 척하지 않는다
    }
  }

  /** 걷다가 막혔다(다리가 사라지는 등 드문 일) — 한 번만 다시 찾고, 그래도 없으면 선다 */
  function repath() {
    var now = Date.now();
    if (now - repathAt < 700) { dest = null; path = null; return; }
    repathAt = now;
    computePath();
  }

  function step(dt) {
    if (!S.S.map) return;
    if (!placed) snapToTown();
    if (frozen) return;
    if (downLocal || S.downed()) { me.frame = 0; return; }
    /* ★ §19-F4(F09-2) — 기차에 탄 동안에는 몸을 서버가 쥔다. 키도 목적지도 읽지 않고
       받은 자리로 다가가기만 한다(쓰러짐 빗장과 같은 결) — 자리 보고도 나가지 않는다. */
    if (S.riding()) { rideStep(dt); return; }
    /* ★ §15-C — 자동 플레이가 도는 동안에는 키도 목적지도 읽지 않는다. 서버를 따라간다. */
    if (S.autoPlay().active) { dest = null; path = null; autoStep(dt); return; }
    var sp = speed() * dt;
    var dx = 0, dy = 0;
    var k = GM.input ? GM.input.keys : {};
    if (k.up) dy -= 1;
    if (k.down) dy += 1;
    if (k.left) dx -= 1;
    if (k.right) dx += 1;
    if (dx || dy) { dest = null; path = null; }
    if (!dx && !dy && dest) {
      var wp = nextWaypoint();
      if (!wp) { dest = null; path = null; }
      else {
        var ddx = wp.x - me.x, ddy = wp.y - me.y;
        var d = Math.hypot(ddx, ddy) || 1;
        dx = ddx / d; dy = ddy / d;
      }
    }
    var px0 = me.x, py0 = me.y;
    /* ★ A8 갇힘 탈출 — 서 있는 칸이 이미 건물에 먹혔다(본부가 자랐다·부지가 완공됐다·옛 세이브).
       평소 판정은 사방이 다 건물이라 한 발짝도 허락하지 않아 그 자리에 영영 굳는다.
       이때만 건물 검사를 풀고 **땅**만 잰다 — 한 걸음이 풋프린트를 못 벗어나도 밖으로 걸어 나갈 수 있다.
       물 위로는 여전히 못 간다(groundWalkable). 서버도 같은 상황을 relocated 로 구제한다. */
    var stuck = structureBlocks(me.x, me.y);
    var canStand = stuck ? groundWalkable : walkable;
    if (dx || dy) {
      var len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      var nx = me.x + dx * sp, ny = me.y + dy * sp;
      /* ★ Sprint 1 — 미끄러짐은 실제로 나아갈 때만. 옛 코드는 목표가 축과 나란하면
         「지금 선 칸」을 되물어 늘 참이 됐고, 걸음 애니메이션은 의도(dx||dy)에 걸려 있어
         한 발짝도 못 가면서 영원히 걸었다. 이제 ① 나아감이 없는 미끄러짐은 실패고
         ② 애니메이션은 실제 변위로만 돈다. */
      if (canStand(nx, ny)) { me.x = nx; me.y = ny; }
      else if (nx !== me.x && canStand(nx, me.y)) { me.x = nx; }
      else if (ny !== me.y && canStand(me.x, ny)) { me.y = ny; }
      else if (dest) repath();
      me.x = U.clamp(me.x, 0, S.mapSize() - 1);
      me.y = U.clamp(me.y, 0, S.mapSize() - 1);
      me.dir = facing(dx, dy);
    }
    var moving = (me.x !== px0 || me.y !== py0);
    if (moving) {
      animateWalk(dt);
    } else if (!GM.swing || !GM.swing.busy()) {
      me.frame = 0;
    }
    if (moving) reveal(false);
    report(false);
  }

  /** ★ 안개 즉시 공개 — 서버가 하루에 한 번만 다시 계산하므로 클라가 앞질러 밝힌다 */
  function reveal(force) {
    if (!S.S.map) return;
    var rx = Math.round(me.x), ry = Math.round(me.y);
    if (!force && Math.abs(rx - lastRevealX) < 1 && Math.abs(ry - lastRevealY) < 1) return;
    lastRevealX = rx; lastRevealY = ry;
    S.revealAround(rx, ry, S.visionRadius());
  }

  /** ★ §19-B — 자리 보고의 최소 간격(ms). 같은 칸이면 어차피 보내지 않으므로(정수 칸 스로틀)
      이 값은 「한 칸을 걷는 데 드는 시간」이면 족하다 — 그보다 길면 **남의 화면에서 내가
      건너뛴다**: 초당 4.6칸 걷는 사람을 0.9초에 한 번 알리면 네 칸씩 순간이동으로 중계되고,
      지나온 칸의 안개도 함께 건너뛴다(revealAvatar 가 보고받은 칸에만 도장을 찍는다). */
  function reportEveryMs() {
    var w = S.worldCfg();
    var base = (w && w.avatar && w.avatar.moveReportMs) || 220;
    var running = GM.input && GM.input.keys && GM.input.keys.run;
    /* 달릴 때도 한 번에 보내는 타일 간격은 걷기와 비슷하게 유지한다. */
    return running ? Math.round(base / 1.55) : base;
  }

  /** 저빈도 위치 보고 — 걸음마다 보내지 않는다 */
  function report(force) {
    /* ★ Sprint 1 — 쓰러져 있는 동안에는 보고하지 않는다. 부활 좌표(모닥불)를
       죽은 자리 좌표로 되덮는 것이 「죽은 자리에서 일어난다」의 클라 쪽 절반이었다. */
    if (downLocal) return;
    /* ★ §19-F4(F09-2) — 기차 위에서도 마찬가지다. 서버가 옮기는 자리를 클라가 되덮으면
       몸만 승강장에 떨어져 남는다(서버는 RIDING 으로 물리치지만 헛걸음을 아낀다). */
    if (S.riding()) return;
    /* ★ §16-7b — 마차에서 내리기 전에는 자리 보고를 보내지 않는다. 이 보고가 서버의 잠든
       동료들을 깨우는 신호라, 내리기 전에 새어 나가면 봇이 마차보다 먼저 일하기 시작한다. */
    if (GM.opening && GM.opening.busy && GM.opening.busy() && !GM.opening.dropped()) return;
    var now = Date.now();
    var rx = Math.round(me.x), ry = Math.round(me.y);
    if (!force && (now - lastReport < reportEveryMs() || (rx === lastX && ry === lastY))) return;
    lastReport = now; lastX = rx; lastY = ry;
    /* ★ GDD3 §13-B-4·5 — 발걸음이 여는 것 둘. 서버가 ack 로 알려 준다:
       ① 은닉 유적을 찾았다 ② 사나운 땅(링2)에 처음 발을 들였다.
       링 판정은 **서버가** 한다 — 영토가 자라면 안전한 땅도 함께 자라므로 화면이 제 셈으로 하면 어긋난다. */
    GM.net.send('lordMove', { x: rx, y: ry }, function (res) {
      if (!res || !res.ok) return;
      /* ★ A8 — 서버가 「그 칸은 건물 밑이다」며 몸을 꺼내 줬다. 자리의 주인은 클라라
         여기서 받아 앉히지 않으면 다음 보고가 옛 좌표를 다시 올려 도로 갇힌다. */
      if (res.relocated && Number.isFinite(res.relocated.x) && Number.isFinite(res.relocated.y)
        && (res.relocated.x !== Math.round(me.x) || res.relocated.y !== Math.round(me.y))) {
        me.x = res.relocated.x; me.y = res.relocated.y;
        dest = null; path = null;
        lastX = res.relocated.x; lastY = res.relocated.y;
        if (GM.swing) GM.swing.invalidate();
        reveal(true);
      }
      if (res.ringEntered && GM.fx) {
        announceLand(cinema().dangerTitle || '사나운 것들의 땅', res.ringText, 'danger', true);
        GM.fx.dangerEdge(1.6);
        if (GM.sfx) GM.sfx.play('deny');
      }
      if (res.revealedNodes && res.revealedNodes.length) {
        // ★ §17-17 — 숨어 있던 것이 유적만은 아니다. 찾은 것의 이름을 그대로 부른다.
        var kinds = res.revealedKinds || [];
        var what = kinds.indexOf('cache') >= 0 ? '숨은 궤' : '옛 자취';
        U.toast('숨어 있던 ' + what + '를 찾았습니다.', 'good', 4200);
        if (GM.sfx) GM.sfx.play('open');
      }
      // ★ §17-17 — 처음 밟은 땅. 문구는 서버(자료)가 쥔다 — 화면이 제 낱말을 만들지 않는다.
      if (res.biomes && res.biomes.length) announceBiomes(res.biomes);
      /* ★ §19-F2(F07-4) — 굴 앞. 서버가 한 번만 보내므로 여기서는 쿨다운을 걸지 않는다(요란해도 된다).
         ★ 연출 — 경고 문구에 앞서 컷신이 한 번 선다: 평화롭던 하늘이 어두워지고, 날개가 온다
           (storycine.DRAGON). 컷신이 끝난 뒤에야 땅의 이름(경고)이 선다. */
      if (res.dragonWarn) {
        var dw = res.dragonWarn;
        var dragonLand = function () {
          announceLand(dw.title, dw.text, 'danger', false);
          if (GM.fx) { GM.fx.dangerEdge(2.4); GM.fx.shakeScreen(6, 0.5); }
          if (GM.sfx) GM.sfx.play('deny');
        };
        if (GM.storycine) GM.storycine.play(GM.storycine.DRAGON, { auto: true, onEnd: dragonLand });
        else dragonLand();
      }
    });
  }

  /** ★ §17-17 — 새 땅의 첫 발견. 한 지형에 한 번뿐이라 요란해도 된다(반짝임 + 큰 이름). */
  function announceBiomes(list) {
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      announceLand(b.name || b.text, b.name ? b.text : null, 'land', false);
      if (GM.fx) GM.fx.sparkle(me.x, me.y, 18, '#eef2f6');
      if (GM.sfx) GM.sfx.play('open');
    }
  }

  /* ★ §19-D(F03-3) — 새 지형에 들어선 순간은 구석의 작은 알림이 아니라 **장면**이다.
     화면 한가운데 이름을 크게 띄우고, 설명 한 줄을 그 밑에 둔다.
     「왜」 쿨다운이 걸리나 — 첫 발견(biomes)은 서버가 한 지형에 한 번만 알려 주지만,
     사나운 땅 경고는 경계선을 오갈 때마다 온다. 연타하면 화면이 제목으로 도배된다. */
  var lastLandAt = 0;
  function cinema() {
    var w = S.worldCfg();
    return (w && w.render && w.render.cinema) || {};
  }
  function announceLand(title, sub, kind, cooled) {
    var gap = cinema().landCooldownMs;
    if (cooled && Date.now() - lastLandAt < (gap == null ? 25000 : gap)) return;
    lastLandAt = Date.now();
    U.epic({ title: title, sub: sub, kind: kind });
  }

  function moveTo(x, y) {
    if (frozen) return null;
    GM.autoplay.touched();      // ★ §15-C — 손이 닿았다: 자동이 잠시 물러난다
    dest = { x: x, y: y };
    computePath();              // ★ Sprint 1 — 길은 여기서 한 번만 낸다(프레임마다 찾지 않는다)
    return dest;                //   물이면 곁의 뭍으로 스냅된 실제 목적지 | null(갈 수 없다·제자리)
  }
  function faceTo(x, y) {
    var dx = x - me.x, dy = y - me.y;
    me.dir = facing(dx, dy);
  }
  /** 기차 위의 한 걸음 — 받은 자리로 부드럽게 다가간다(튀지 않게) */
  function rideStep(dt) {
    var t = S.myTrain();
    if (!t) return;
    var k = Math.min(1, dt * 6);
    me.x += (t.x - me.x) * k;
    me.y += (t.y - me.y) * k;
    dest = null; path = null; me.frame = 0;
    reveal(false);
  }

  function setPos(x, y) {
    me.x = x; me.y = y; placed = true;
    dest = null; path = null;
    if (GM.swing) GM.swing.invalidate();
    reveal(true); report(true);
  }

  /** ★ Sprint 1 — 쓰러짐 빗장. down.js 가 playerDown/playerRevived 순간에 잠그고 푼다. */
  function setDowned(v) {
    downLocal = !!v;
    if (downLocal) { dest = null; path = null; }
  }
  function distTo(x, y) { return Math.hypot(me.x - x, me.y - y); }

  GM.avatar = {
    init: init, step: step, pos: pos, moveTo: moveTo, faceTo: faceTo, setPos: setPos,
    distTo: distTo, freeze: freeze, isFrozen: isFrozen, reveal: reveal,
    setDowned: setDowned,
    destPos: destPos, stop: function () { dest = null; path = null; },
    setHidden: setHidden, isHidden: isHidden, startPos: startPos,
    /* ★ GDD3 §13-D-3 — 스프라이트가 읽는 장비 요약 */
    gear: gear, markGear: markGear,
    report: function () { report(true); },
    interact: function () { if (GM.swing) GM.swing.once(); }
  };
})(window);
