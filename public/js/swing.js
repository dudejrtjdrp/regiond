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
    field: '#c8a94a', fertile: '#c8a94a', water: '#78aed6', ruin: '#b39ad6', site: '#c8a874'
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

    S.nodeList().forEach(function (n) {
      if (!nodeWorkable(n)) return;
      var d = Math.hypot(n.x - me.x, n.y - me.y);
      if (d <= r && d < bestD) {
        bestD = d;
        bestT = { kind: 'node', id: n.id, x: n.x, y: n.y, obj: n,
                  skill: S.nodeMeta(n.type).skill || 'lumber', nodeType: n.type };
      }
    });
    return bestT;
  }

  function nodeWorkable(n) {
    if (!n || n.depleted) return false;
    if (!S.inTerritory(n.x, n.y) && n.type !== 'ruin') return false;
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
    var guessCd = t.kind === 'enemy' ? guessCombatCooldown() : ((pv && pv.cooldownMs) || 1200);
    cdSpan = guessCd;
    cdUntil = now() + guessCd;

    pending = { target: t, at: now(), impacted: false, ack: null, preview: pv };
    var mine = pending;

    if (t.kind === 'enemy') {
      GM.net.send('combatSwing', { targetId: t.id }, function (res) { onAck(mine, res); });
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
  function impact(mine, ack) {
    var t = mine.target;
    var me = GM.avatar.pos();
    if (!me) return;
    var ang = Math.atan2(t.y - me.y, t.x - me.x);

    GM.fx.swingArc(me.x, me.y, ang, t.kind === 'enemy' ? '#ffe9a8' : '#fff6dc', 1.0);
    if (t.kind === 'enemy') GM.fx.slash(t.x, t.y, ang, '#ffd06a');

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
    checkLevel(res);
    stats.swings++;
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

  /* ══════════ 남의 스윙 (멀티 연출) ══════════ */
  function remote(p) {
    if (!p) return;
    var n = p.nodeId ? S.nodeById(p.nodeId) : null;
    if (!n) return;
    GM.fx.shakeNode(n.id, 0.7);
    GM.fx.debris(n.x, n.y - 0.2, DEBRIS_COLOR[n.type] || '#c8a874', 4, 0.7);
    if (p.cycle) GM.fx.ring(n.x, n.y, '#f6cf7a', 0.25, 1.5, 0.5);
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
