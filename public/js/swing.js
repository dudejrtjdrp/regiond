/* swing.js — ★ 직접 노동의 손맛 (GDD3 §3 · §8).
   클릭이나 E 를 누르고 있으면 서버 쿨타임에 맞춰 연속으로 스윙한다.
   한 번의 스윙은 이렇게 흐른다:
     ① 곧바로 자세를 잡고(선행 연출) 명령을 쏜다
     ② 명중 프레임에 세상이 한 박자 멈추고 파편이 튀고 대상이 흔들린다
     ③ 자원이 아크를 그리며 상단 자원칸으로 빨려 들어간다
     ④ 한 주기를 끝내면(나무 한 그루) 큰 이펙트 + 그루터기가 남는다
   서버가 진짜 판정을 하고, 클라는 그 결과로 숫자를 고쳐 쓴다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var WINDUP = 0.10;          // 치켜드는 시간
  var FOLLOW = 0.13;          // 내려친 뒤 되돌아오는 시간

  var pose = { phase: 0, t: 0, tool: null };
  var cdUntil = 0, cdSpan = 1200;
  var holding = false;
  var pending = null;         // {target, at, impacted, ack}
  var lastHintAt = 0;
  var stats = { swings: 0, cycles: 0 };

  var TOOL_OF = { lumber: 'axe', mining: 'pick', farm: 'hoe', build: 'hammer', combat: 'sword' };
  var SOUND_OF = { lumber: 'chop', mining: 'mine', farm: 'dig', build: 'hammer', combat: 'slash' };
  var DEBRIS_COLOR = {
    forest: '#8a5e33', rock: '#9aa0a8', iron: '#b07050', oil: '#6f5aa8',
    field: '#c8a94a', fertile: '#c8a94a', water: '#78aed6', ruin: '#b39ad6', site: '#c8a874',
    /* ★ Sprint 5 — 적 야영지(천막·말뚝) */
    camp: '#8a5e33'
  };

  function now() { return (global.performance && performance.now) ? performance.now() : Date.now(); }

  /* ══════════ 대상 고르기 ══════════ */
  /** 지금 손이 닿는 것 — 적 > 건설 현장 > 자원 자리.
      매 프레임(렌더러가 표시등을 그린다) 불리므로 짧게 기억해 둔다. */
  var memo = { t: 0, val: null };
  function target() {
    var n0 = now();
    if (n0 - memo.t < 70) return memo.val;
    memo.t = n0;
    memo.val = findTarget();
    return memo.val;
  }

  function findTarget() {
    var me = GM.avatar && GM.avatar.pos();
    if (!me) return null;

    /* 전투 중이면 적이 먼저다 */
    var b = S.battleLive();
    if (b && b.enemies && b.enemies.length) {
      var cr = S.combatCfg().rangeTiles || 2.5;
      var best = null, bd = 1e9;
      for (var i = 0; i < b.enemies.length; i++) {
        var e = b.enemies[i];
        if (e.hp <= 0) continue;
        var d = Math.hypot(e.x - me.x, e.y - me.y);
        if (d <= cr && d < bd) { bd = d; best = e; }
      }
      if (best) return { kind: 'enemy', id: best.id, x: best.x, y: best.y, obj: best, skill: 'combat' };
    }

    /* ★ GDD3 §13-C-8 — 웨이브 밖에서는 들에 사는 것들이 검의 상대다.
       사슴 한 마리가 고기 셋이고, 늑대는 이쪽이 안 베면 저쪽이 문다.
       사냥이 열리기 전(3장 '허기' 이전)에는 이 갈래 자체가 없다 — 잠긴 것은 부재다(§11-1). */
    if (S.featOn('hunt') && GM.world && GM.world.nearestWild) {
      var hr = (S.combatCfg().huntRangeTiles) || S.combatCfg().rangeTiles || 2.8;
      var w = GM.world.nearestWild(me.x, me.y, hr);
      if (w) return { kind: 'wild', id: w.c.id, x: w.x, y: w.y, obj: w.c, skill: 'combat', species: w.c.sp };
    }

    /* ★ Sprint 5 — 적 야영지. 「언제 올지 모르는 무리를 기다리는」 시간을 **찾아가서 끝내는** 시간으로
       바꾸는 갈래다. 웨이브가 열리기 전에는 이 갈래 자체가 없다(§11-1 — 잠긴 것은 부재다).
       들짐승보다 뒤에 둔다: 야영지 곁에서 늑대에게 물리는데 검이 야영지만 향하면 안 된다. */
    var cm = campTarget();
    if (cm) return cm;

    var r = S.swingRange();
    var bestT = null, bestD = 1e9;
    S.sites().forEach(function (c) {
      if (c.x == null) return;
      /* ★ §12-1 — 큰 현장은 앵커가 아니라 중심에서 잰다 (3×3 사당의 반대편 귀퉁이에 서도 손이 닿아야 한다) */
      var ctr = S.centerOfThing(c);
      var f = S.footprintOfThing(c);
      var reach = r + Math.max(f.w, f.h) / 2;
      var d = Math.hypot(ctr.x - me.x, ctr.y - me.y);
      if (d <= reach && d < bestD) {
        bestD = d;
        bestT = { kind: 'site', id: c.id, x: ctr.x, y: ctr.y, obj: c, skill: 'build' };
      }
    });
    if (bestT) return bestT;

    /* ★ Sprint 3 — 손이 닿는 반경은 두어 칸인데 옛 셈은 지도의 자원 자리를 **통째로** 훑었다
       (늦은 판이면 삼천 개). 둘레의 바구니만 열어 볼 것을 한 줌으로 줄인다 —
       고르는 규칙(가장 가까운 것)은 한 글자도 바뀌지 않는다. */
    var near = (GM.world && GM.world.nodesNear) ? GM.world.nodesNear(me.x, me.y, r) : S.nodeList();
    for (var ni = 0; ni < near.length; ni++) {
      var n = near[ni];
      if (!nodeWorkable(n)) continue;
      var nd = Math.hypot(n.x - me.x, n.y - me.y);
      if (nd <= r && nd < bestD) {
        bestD = nd;
        bestT = { kind: 'node', id: n.id, x: n.x, y: n.y, obj: n,
                  skill: S.nodeMeta(n.type).skill || 'lumber', nodeType: n.type };
      }
    }
    return bestT;
  }

  /** ★ Sprint 5 — 손이 닿는 야영지 하나. 판정의 정본은 서버(strikeCamp)다 — 여기는 손잡이만 만든다. */
  function campTarget() {
    var wv = S.wave();
    if (!S.featOn('waves') && !(wv && wv.unlocked)) return null;
    if (!S.cmdOn('strikeCamp')) return null;
    var list = S.camps();
    if (!list.length) return null;
    var me = GM.avatar && GM.avatar.pos();
    if (!me) return null;
    var cc = S.combatCfg();
    var r = cc.campRangeTiles || cc.rangeTiles || 2.5;
    var best = null, bd = 1e9;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || c.x == null || !(c.hp > 0)) continue;
      var d = Math.hypot(c.x - me.x, c.y - me.y);
      if (d <= r && d < bd) { bd = d; best = c; }
    }
    if (!best) return null;
    return { kind: 'camp', id: best.id, x: best.x, y: best.y, obj: best, skill: 'combat' };
  }

  function nodeWorkable(n) {
    if (!n || n.depleted) return false;
    /* ★ GDD3 §13-B-2 — **영토 밖 채집은 언제나 허용된다.**
       자원 군락이 영토 바깥에 앉게 된 이상 「우리 땅이 아니다」로 막으면 1장부터 게임이 멎는다.
       (서버도 같은 규칙이다 — actions.swingNode 의 OUT_OF_TERRITORY 를 함께 걷어 냈다.) */
    if (n.type === 'field' || n.type === 'fertile') return !!n.harvestReady;
    return true;
  }

  /** 지금 대상을 치면 무엇이 나오는가 — 서버가 미리 준 표(state.you.swing.targets) */
  function preview(t) {
    if (!t) return null;
    if (t.kind === 'site') {
      var sw = S.swingInfo();
      return (sw && sw.targets && sw.targets.site) || null;
    }
    if (t.kind === 'node') return S.swingTarget(t.nodeType);
    return null;
  }

  /* ══════════ 쿨타임 ══════════ */
  function cooldown() {
    var left = Math.max(0, cdUntil - now());
    return { remainMs: left, ratio: cdSpan > 0 ? U.clamp(1 - left / cdSpan, 0, 1) : 1 };
  }
  function ready() { return now() >= cdUntil; }

  /* ══════════ 스윙 ══════════ */
  function once() { attempt(); }
  function startHold() { holding = true; attempt(); }
  function stopHold() { holding = false; }
  function isHolding() { return holding; }
  function busy() { return pose.phase !== 0; }
  function poseOf() { return { phase: pose.phase, tool: pose.tool }; }

  function attempt() {
    if (GM.avatar && GM.avatar.isFrozen()) return false;
    if (S.downed()) { hint('쓰러졌습니다. 곧 모닥불 곁에서 일어납니다.'); return false; }
    if (!ready()) return false;
    var t = target();
    if (!t) { hint('가까이 다가가야 손이 닿습니다.'); return false; }

    GM.avatar.faceTo(t.x, t.y);
    pose.phase = 1; pose.t = 0;
    pose.tool = TOOL_OF[t.skill] || 'axe';

    /* 서버 판정을 기다리지 않고 쿨타임을 먼저 건다 — 왕복 사이에 두 번 쏘지 않게 */
    var pv = preview(t);
    var guessCd = (t.kind === 'enemy' || t.kind === 'wild' || t.kind === 'camp')
      ? guessCombatCooldown() : ((pv && pv.cooldownMs) || 1200);
    cdSpan = guessCd;
    cdUntil = now() + guessCd;

    pending = { target: t, at: now(), impacted: false, ack: null, preview: pv };
    var mine = pending;

    if (t.kind === 'enemy' || t.kind === 'wild') {
      /* ★ §16-4 — 서버가 든 내 자리는 0.9초 스로틀로 낡아 있다. 검을 휘두르는 순간만은
         지금 자리를 먼저 알린다(lordMove) — socket.io 는 순서를 지키므로 스윙 판정은 새 자리로 잰다. */
      if (GM.avatar && GM.avatar.report) GM.avatar.report();
      GM.net.send('combatSwing', { targetId: t.id }, function (res) { onAck(mine, res); });
    } else if (t.kind === 'camp') {
      /* ★ Sprint 5 — 야영지도 지금 자리로 판정한다(서버가 곁에 섰는지 다시 잰다) */
      if (GM.avatar && GM.avatar.report) GM.avatar.report();
      GM.net.send('strikeCamp', { campId: t.id }, function (res) { onAck(mine, res); });
    } else if (t.kind === 'site') {
      GM.net.send('actionSwing', { siteId: t.id }, function (res) { onAck(mine, res); });
    } else {
      GM.net.send('actionSwing', { nodeId: t.id }, function (res) { onAck(mine, res); });
    }
    return true;
  }

  function guessCombatCooldown() {
    var sk = S.skillOf('combat');
    return sk && sk.cooldownSec ? Math.round(sk.cooldownSec * 1000) : 1200;
  }

  function onAck(mine, res) {
    if (!res) return;                                   // 구경 모드 — 예측만으로 굴러간다
    if (!res.ok) {
      var code = res.error && res.error.code;
      if (code === 'COOLDOWN' && res.error.waitMs) {
        cdUntil = now() + res.error.waitMs;
        cdSpan = res.error.cooldownMs || cdSpan;
      } else if (code === 'STORAGE_FULL') {
        /* ★ GDD3 §13-A-5 — 곳간이 찼다. 두드릴 때마다 떠들지 않고 **자원마다 딱 한 번** 알린다.
           (자원칸의 빨간 「가득」 테두리가 그 뒤로도 계속 이유를 말해 준다.) */
        cdUntil = now() + 700;
        if (pending === mine) { pending = null; pose.phase = 0; }
        var list = res.error.resources || [];
        var fresh = list.filter(function (r) { return !S.S.dismissed['storageFull:' + r]; });
        list.forEach(function (r) { S.S.dismissed['storageFull:' + r] = 1; });
        if (fresh.length) {
          U.toast(res.error.message || '곳간이 가득 찼습니다.', 'warn', 5200);
          GM.sfx.play('deny');
        }
      } else if (code) {
        cdUntil = now() + 350;                          // 헛손질 — 잠깐 쉬고 다시
        if (pending === mine) { pending = null; pose.phase = 0; }
        if (code !== 'OUT_OF_RANGE' && code !== 'NO_TARGET') hint(res.error.message || '지금은 할 수 없습니다.');
      }
      return;
    }
    if (res.cooldownMs) { cdSpan = res.cooldownMs; cdUntil = mine.at + res.cooldownMs; }
    if (mine.impacted) { applyResult(mine, res); return; }
    mine.ack = res;
  }

  function step(dt) {
    if (pose.phase === 1) {
      pose.t += dt;
      if (pose.t >= WINDUP) {
        pose.phase = 2; pose.t = 0;
        if (pending && !pending.impacted) {
          pending.impacted = true;
          impact(pending, pending.ack);
        }
      }
    } else if (pose.phase === 2) {
      pose.t += dt;
      if (pose.t >= FOLLOW) { pose.phase = 0; pose.t = 0; }
    }
    /* 누르고 있으면 쿨이 풀리는 즉시 다시 휘두른다 */
    if (holding && pose.phase === 0 && ready()) attempt();
  }

  /* ══════════ 명중 ══════════ */
  /**
   * ★ §17-19 — 맞은 놈이 하얗게 번쩍한다.
   * 「왜」 화면을 흔들지 않고 그 자리만 터뜨리나 — 내가 때릴 때마다 화면이 크게 요동치면
   *   손맛이 아니라 멀미가 된다. 흔들림은 **내가 맞을 때**의 몫으로 아껴 둔다(hud.hurt).
   *   수치는 data/world.json render.hit 이 쥔다 — 세기를 고치려면 그 표만 만지면 된다.
   */
  function targetFlash(t) {
    var c = S.hitFx();
    GM.fx.ring(t.x, t.y - 0.3, c.targetFlashColor, 0.1, c.targetRingTo, c.targetRingSeconds, c.targetRingWidth);
    GM.fx.sparkle(t.x, t.y - 0.3, c.targetSparkles, c.targetFlashColor);
  }

  function impact(mine, ack) {
    var t = mine.target;
    var me = GM.avatar.pos();
    if (!me) return;
    var ang = Math.atan2(t.y - me.y, t.x - me.x);

    GM.fx.swingArc(me.x, me.y, ang, t.kind === 'enemy' ? '#ffe9a8' : '#fff6dc', 1.0);
    if (t.kind === 'enemy') GM.fx.slash(t.x, t.y, ang, '#ffd06a');
    /* ★ §17-19 — 산 것을 때리면 그 자리가 하얗게 번쩍한다(나무·바위는 부스러기로 충분하다) */
    if (t.kind === 'enemy' || t.kind === 'wild') targetFlash(t);
    /* ★ Sprint 5 — 야영지는 흔들 수 있는 자리(node)가 아니다. 그 자리에 고리를 하나 둘러 대신한다. */
    if (t.kind === 'camp') GM.fx.ring(t.x, t.y, '#e05a2c', 0.15, 1.5, 0.4, 3);

    /* 명중 프레임 정지 — 한 박자 */
    GM.fx.hitStop(t.kind === 'enemy' ? 70 : 48);
    GM.fx.shakeScreen(t.kind === 'enemy' ? 3.4 : 2.2, 0.16);
    GM.fx.debris(t.x, t.y - 0.2, DEBRIS_COLOR[t.nodeType || t.kind] || '#c8a874',
      t.kind === 'enemy' ? 5 : 7, 1);
    if (t.kind === 'node') GM.fx.shakeNode(t.id, 1);
    GM.sfx.play(SOUND_OF[t.skill] || 'chop');

    if (ack) applyResult(mine, ack);
    else if (mine.preview) previewPop(mine);
  }

  /** ack 가 늦으면 서버가 미리 준 표로 자원 팝을 먼저 띄운다(값은 ack 로 정정된다) */
  function previewPop(mine) {
    var pv = mine.preview;
    if (!pv || !pv.yield) return;
    mine.pre = true;
    popGains(mine.target, pv.yield, 1);
  }

  function applyResult(mine, res) {
    var t = mine.target;
    /* ★ §13-C-8 사냥 — 맞으면 붉게 튀고, 쓰러지면 드롭이 그 자리에서 자원칸으로 빨려 들어간다 */
    if (t.kind === 'wild') {
      if (GM.world.markWildHurt) GM.world.markWildHurt(t.id);
      GM.fx.floatText(t.x, t.y - 0.9, '-' + U.fmt(res.damage, res.damage < 10 ? 1 : 0), '#ffd06a', 14);
      if (res.killed) {
        GM.fx.debris(t.x, t.y, '#bc4749', 12, 1.5);
        GM.fx.ring(t.x, t.y, '#ff9d99', 0.2, 1.4, 0.5);
        GM.fx.hitStop(90);
        GM.fx.shakeScreen(4.2, 0.24);
        GM.sfx.play('kill');
        if (res.gained) popGains(t, res.gained, 1);
        U.toast((res.speciesName || '짐승') + '을(를) 잡았습니다.', 'good', 2600);
      }
      checkLevel(res);
      stats.swings++;
      return;
    }
    /* ★ Sprint 5 — 야영지 한 대. 다 무너뜨리면 그 무리는 오지 않는다(서버가 그렇게 답한다). */
    if (t.kind === 'camp') {
      GM.fx.floatText(t.x, t.y - 1.1, '-' + U.fmt(res.damage, res.damage < 10 ? 1 : 0), '#ffd06a', 14);
      if (res.destroyed) {
        GM.fx.debris(t.x, t.y, '#8a5e33', 18, 1.8);
        GM.fx.sparkle(t.x, t.y, 20, '#ffcf6a');
        GM.fx.ring(t.x, t.y, '#e05a2c', 0.1, 3.4, 1.0, 3);
        GM.fx.hitStop(110);
        GM.fx.shakeScreen(6.5, 0.4);
        GM.sfx.play('kill');
        U.banner({ icon: 'sword', kind: 'level', title: '야영지를 무너뜨렸다',
                   sub: res.waveCancelled ? '그 무리는 오지 않는다' : '' });
      }
      checkLevel(res);
      stats.swings++;
      return;
    }
    if (t.kind === 'enemy') {
      GM.fx.floatText(t.x, t.y - 0.9, '-' + U.fmt(res.damage, res.damage < 10 ? 1 : 0), '#ffd06a', 14);
      if (res.killed) {
        GM.fx.debris(t.x, t.y, '#bc4749', 12, 1.5);
        GM.fx.ring(t.x, t.y, '#ff9d99', 0.2, 1.4, 0.5);
        GM.fx.hitStop(90);
        GM.fx.shakeScreen(5, 0.28);
        GM.sfx.play('kill');
      }
      checkLevel(res);
      stats.swings++;
      return;
    }
    if (t.kind === 'site') {
      GM.fx.floatText(t.x, t.y - 1.0, '공사 +' + U.fmt(res.buildPoints, 1), '#f6cf7a', 13);
      GM.fx.debris(t.x, t.y - 0.3, '#c8a874', 5, 0.8);
      if (res.cycle) {
        GM.fx.dust(t.x, t.y, 12);
        GM.sfx.play('build');
      }
      checkLevel(res);
      stats.swings++;
      return;
    }

    /* 자원 자리 */
    if (!mine.pre && res.gained) popGains(t, res.gained, res.multiplier);
    else if (mine.pre && res.gained) { /* 이미 띄웠다 — 값 차이는 다음 스윙에서 맞춰진다 */ }

    var node = S.nodeById(t.id);
    if (res.cycle) {
      stats.cycles++;
      cycleEffect(t, res);
    }
    if (res.depleted && node) {
      GM.fx.floatText(t.x, t.y - 1.2, '다 캤다', '#c8bda4', 12);
    }
    if (res.ruin) {
      GM.fx.sparkle(t.x, t.y, 10, '#b39ad6');
      GM.fx.floatText(t.x, t.y - 1.1, '옛 자취 ' + res.ruin.gauge + '/' + res.ruin.threshold, '#d0b8f0', 12);
    }
    // ★ §17-17 — 궤가 열렸다. 자리는 그 자리에서 사라지므로 화면 장부에서도 함께 지운다.
    if (res.cache) cacheOpened(t, res.cache);
    checkLevel(res);
    stats.swings++;
  }

  /** ★ §17-17 — 뚜껑이 열린 순간. 금빛 한 번, 나온 것 한 줄, 그리고 자리는 사라진다. */
  function cacheOpened(t, c) {
    GM.fx.sparkle(t.x, t.y, 16, '#f6cf7a');
    GM.fx.ring(t.x, t.y, '#f6cf7a', 0.2, 2.2, 0.7, 3);
    GM.fx.floatText(t.x, t.y - 1.2, '금 ' + c.gold, '#f6cf7a', 14);
    if (c.artifact) U.toast(c.artifact.name + ' — 궤 안에 있었다', 'good', 3200);
    if (GM.sfx) GM.sfx.play('harvest');
    S.dropNode(c.nodeId);
  }

  /** 한 주기 완료 — 나무가 넘어가고 그루터기가 남는다 */
  function cycleEffect(t, res) {
    var type = t.nodeType;
    GM.fx.hitStop(95);
    GM.fx.shakeScreen(5.5, 0.34);
    GM.fx.ring(t.x, t.y, '#f6cf7a', 0.25, 1.9, 0.6, 3);
    GM.fx.debris(t.x, t.y - 0.3, DEBRIS_COLOR[type] || '#c8a874', 16, 1.7);
    if (type === 'forest') {
      GM.sfx.play('timber');
      GM.fx.stump(t.x, t.y, 'forest', 30);
      GM.fx.floatText(t.x, t.y - 1.3, '나무가 넘어갔다', '#f6e6a8', 13);
    } else if (type === 'rock' || type === 'iron' || type === 'oil') {
      GM.sfx.play('crumble');
      GM.fx.stump(t.x, t.y, 'rock', 22);
    } else if (type === 'field' || type === 'fertile') {
      GM.sfx.play('harvest');
      GM.fx.sparkle(t.x, t.y, 12, '#f6e6a8');
      GM.fx.floatText(t.x, t.y - 1.3, '거두었다', '#f6e6a8', 13);
    } else {
      GM.sfx.play('crumble');
    }
  }

  function popGains(t, gained, multiplier) {
    var keys = Object.keys(gained || {});
    var shown = 0;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = gained[k];
      if (!(v > 0.009)) continue;
      var meta = S.resourceMeta(k);
      /* ★ GDD3 §11-3 — 자원 팝에 목표 잔여를 붙인다: 「목재 +4 (천막까지 6)」.
         지금 장의 목표가 요구하는 자원일 때만 — 아무 때나 붙으면 잔소리가 된다. */
      var need = S.goalRemaining ? S.goalRemaining(k) : null;
      var tail = need && need.remaining > 0
        ? ' (' + (need.short ? need.short + '까지 ' : '목표까지 ') + U.fmt(need.remaining, 0) + ')' : '';
      GM.fx.resourcePop(t.x + (shown * 0.35 - 0.15), t.y - 0.5,
        k, '+' + U.fmt(v, v < 10 ? 1 : 0) + ' ' + meta.name + tail, meta.color);
      shown++;
    }
    if (shown) GM.sfx.play('pickup');
    if (multiplier && multiplier > 1.4 && shown) {
      GM.fx.floatText(t.x, t.y - 1.5, '×' + U.fmt(multiplier, 2), '#f6cf7a', 12);
    }
  }

  /* ══════════ 레벨업 ══════════ */
  function checkLevel(res) {
    if (!res || !res.leveled) return;
    var meta = S.skillMeta(res.skill);
    var sk = S.skillOf(res.skill) || {};
    var me = GM.avatar.pos();
    if (me) {
      GM.fx.sparkle(me.x, me.y - 0.5, 22, '#f6cf7a');
      GM.fx.ring(me.x, me.y, '#f6cf7a', 0.2, 2.2, 0.7, 3);
      GM.fx.flash('#fff0c8', 0.18, 0.3);
    }
    GM.sfx.play('levelup');
    var cd = res.cooldownMs || (sk.cooldownSec ? sk.cooldownSec * 1000 : null);
    U.banner({
      icon: 'star', kind: 'level',
      title: meta.name + ' ' + res.level + '단이 되었다',
      sub: cd ? '손이 빨라졌다 — 스윙 간격 ' + U.fmt(cd / 1000, 2) + '초' : '손이 빨라졌다'
    });
    if (res.tool && res.tool.name) {
      setTimeout(function () {
        U.banner({ icon: 'axe', kind: 'tool', title: res.tool.name + '을(를) 손에 익혔다',
                   sub: '스윙당 거두는 몫 ×' + U.fmt(res.tool.multiplier, 1) });
      }, 1400);
    }
  }

  function hint(msg) {
    var t = now();
    if (t - lastHintAt < 2600) return;
    lastHintAt = t;
    U.toast(msg, 'warn', 1900);
  }

  /* ══════════ 남의 스윙 (멀티 · 동료 · 자동 플레이 연출) ══════════ */
  /* ★ §16-12 — 거둔 것은 **누구의 손이든** 그 자리에 뜬다(피드백: "자동을 켜면 +1.2 목재가 안 뜬다.
     봇·주민의 행동에도 다 떠야 한다"). 자동 플레이·동료의 스윙은 서버가 'swing' 채널로 알려 오고
     (내 손으로 휘두른 것은 ack 로 로컬에서 띄우므로 두 번 뜨지 않는다 — 서버가 보낸 사람은 뺀다),
     주민의 몫은 §14-1 작업 사이클(creditFloat)이 띄운다. */
  function remote(p) {
    if (!p) return;
    var pos = null;
    var n = p.nodeId ? S.nodeById(p.nodeId) : null;
    if (n) {
      GM.fx.shakeNode(n.id, 0.7);
      GM.fx.debris(n.x, n.y - 0.2, DEBRIS_COLOR[n.type] || '#c8a874', 4, 0.7);
      if (p.cycle) GM.fx.ring(n.x, n.y, '#f6cf7a', 0.25, 1.5, 0.5);
      pos = { x: n.x, y: n.y };
    } else if (p.x != null && p.y != null) {
      pos = { x: p.x, y: p.y };                     // 사냥 — 짐승이 쓰러진 자리
    } else if (p.siteId) {
      var sList = S.sites();
      for (var si = 0; si < sList.length; si++) {
        if (sList[si].id === p.siteId) { pos = S.centerOfThing(sList[si]); break; }
      }
    } else if (p.avatarId && GM.world.matePos) {
      var m = GM.world.matePos(p.avatarId);
      if (m) pos = { x: m.x, y: m.y };
    }
    if (!pos) return;
    if (p.gained) popGains(pos, p.gained, p.multiplier || 1);
    if (p.hunt && p.killed) {
      GM.fx.debris(pos.x, pos.y, '#bc4749', 8, 1.1);
      GM.fx.ring(pos.x, pos.y, '#ff9d99', 0.2, 1.1, 0.4);
    }
    /* ★ §19-F2(F07-4) — 세상에 한 마리뿐이던 것이 눕는 순간. 한 판에 한 번뿐이라 요란해도 된다.
       문구는 서버(자료)가 쥔다 — 화면이 제 낱말을 지어내지 않는다(§17-17 과 같은 규칙). */
    if (p.boss) {
      U.epic({ title: p.boss.title, sub: p.boss.text, kind: 'land' });
      GM.fx.ring(pos.x, pos.y, '#e05a2c', 0.1, 4.5, 1.4);
      GM.fx.sparkle(pos.x, pos.y, 42, '#ffcf6a');
      GM.fx.shakeScreen(9, 0.9);
    }
    if (p.buildPoints) GM.fx.floatText(pos.x, pos.y - 1.0, '공사 +' + U.fmt(p.buildPoints, 1), '#f6cf7a', 12);
  }

  function invalidate() { memo.t = 0; memo.val = null; }

  function reset() {
    invalidate();
    pose = { phase: 0, t: 0, tool: null };
    cdUntil = 0; holding = false; pending = null;
    stats = { swings: 0, cycles: 0 };
  }

  GM.swing = {
    step: step, once: once, startHold: startHold, stopHold: stopHold, isHolding: isHolding,
    target: target, preview: preview, pose: poseOf, cooldown: cooldown, ready: ready,
    invalidate: invalidate,
    busy: busy, remote: remote, reset: reset,
    stats: function () { return { swings: stats.swings, cycles: stats.cycles }; }
  };
})(window);
