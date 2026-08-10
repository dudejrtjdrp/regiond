/* combat.js — ★ 엔드리스 웨이브 전투 (GDD3 §6).
   경고(waveIncoming) → 개시(battleStart) → 서브틱 스트림(battleTick) 을 월드 위에 실시간으로 그린다.
   적이 걸어와 울타리를 두드리고, 터렛이 쏘고, 민병이 붙고, **플레이어가 검을 들고 참전**한다.
   판정은 전부 서버다 — 여기서 하는 일은 서버가 보내 주는 스냅샷을 아름답게 보여 주는 것이다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var shots = [];
  var interp = {};
  var bclock = 0;          // 전투 연출 시계(ms) — step(dt) 이 굴린다

  /* ══════════ ★ 3단계B — 적의 목소리 ══════════
     「왜」 대화창이 아니라 토스트인가 — 대화창(GM.dialogue)은 싸움이 붙는 순간 스스로 접히는 것이
     이 파일의 규약이다(위 :19 · :35). 그 규약을 어기지 않으면서 한 줄을 들려주려면, 화면을 가리지
     않고 스스로 사라지는 자리여야 한다. 판정에는 한 톨도 닿지 않는다 — 문장 고르기까지 결정론이라
     같은 웨이브를 다시 보아도, 여럿이 함께 보아도 같은 말을 듣는다(enemy-lines.js).
     혼성 웨이브(본대+호위대)에서는 **본대 종류**만 말한다: 두 무리가 겹쳐 떠들면 누가 오는지가 흐려진다. */
  var saidBreach = false;      // 한 판에 한 번 — 울타리가 뚫릴 때마다 같은 말을 되풀이하지 않는다

  function sayEnemy(typeKey, waveNo, where, ms) {
    if (!GM.enemyLines || !typeKey) return null;
    var line = GM.enemyLines.pick(typeKey, waveNo, where);
    if (!line) return null;
    U.toast(line, 'danger', ms || 4200);
    return line;
  }

  /** 지금 살아 있는 판의 (종류·번호) — 사건 처리가 대사를 고를 때 쓴다 */
  function liveWave() {
    var b = S.battleLive();
    return b ? { type: b.type, number: b.number || 1 } : null;
  }

  /** 울타리가 뚫리거나 건물이 무너지는 순간 — 한 판에 한 번만 운다 */
  function sayBreachOnce() {
    if (saidBreach) return null;
    var w = liveWave();
    if (!w) return null;
    saidBreach = true;
    return sayEnemy(w.type, w.number, 'breach');
  }

  /* ══════════ 경고 ══════════ */
  function onIncoming(p) {
    if (!p) return;
    /* ★ §17-19(D-5) — 경보가 울리면 대화창은 스스로 접힌다.
       무리가 몰려오는데 아래에서 한가한 이야기가 이어지면 그 순간의 무게가 통째로 새어 나간다. */
    if (GM.dialogue) GM.dialogue.close();
    var meta = S.enemyMeta(p.type);
    GM.sfx.play('alarm');
    GM.fx.flash('#7d1c1c', 0.3, 0.5);
    U.banner({ icon: meta.icon, kind: 'danger', title: (p.name || meta.name) + '이(가) 몰려온다',
               sub: S.directionMeta(p.direction).name + '에서 ' + p.units + '이(가) 옵니다', ms: 4200 });
    var vg = U.qs('#vignette');
    if (vg) vg.classList.add('on');
    GM.hud.flash({ kind: 'danger', icon: meta.icon, title: (p.name || meta.name) + '이(가) 옵니다',
                   sub: '방어를 살펴보세요', open: openThreat }, 24000);
    /* ★ 3단계B — 배너 바로 뒤에 무리의 첫 마디가 붙는다. 배너의 sub 는 이미 「어디서 몇이」를
       쥐고 있으므로(정보), 목소리는 따로 선다(연출). */
    saidBreach = false;
    sayEnemy(p.type, p.number || 1, 'approach');
  }

  /* ══════════ 전투 ══════════ */
  function onStart(p) {
    shots = [];
    interp = {};
    saidBreach = false;
    if (GM.dialogue) GM.dialogue.close();      /* ★ §17-19(D-5) — 싸움이 붙으면 말은 끊긴다 */
    var core = p && p.core;
    if (core) GM.camera.moveTo(core.x, core.y);
    GM.sfx.play('alarm');
    U.toast('싸움이 시작됩니다. 검을 들고 직접 붙을 수 있습니다 — 죽지 않습니다.', 'warn', 6000);
    pushSnapshot(p);
    setBattleBar(p);
  }

  function onTick(p) {
    if (!p) return;
    pushSnapshot(p);
    playEvents(p);
    setBattleBar(p);
  }

  /* ★ §16-3 — 적·민병도 짐승과 같은 규칙으로 걷는다: 서브틱 스냅샷을 띠로 들고,
     간격의 1.4배 뒤를 등속으로 지난다. 옛 지수 감쇠(`+= d*0.22`/프레임)는 새 좌표가 온 순간
     빨랐다 이내 느려지는 톱니라, 적들이 뚝뚝 끊겨 보이던 바로 그 원인이었다.
     ★ §19-B — 그 규칙을 여기 따로 베껴 두지 않는다: 짐승·사람과 **같은 한 채**(GM.interp)를 탄다.
     세 벌이 따로 있으면 한 곳을 고쳐도 나머지 둘에 같은 결함이 남는다. */
  var BATTLE_SNAP = 10;                  // 이만큼 벌어지면 걸어간 것으로 볼 수 없다(들판보다 좁다 — 전장은 붙어 있다)

  function dials() { return GM.interp.dials(S.worldCfg() && S.worldCfg().render); }

  function pushSnapshot(p) {
    if (!p) return;
    var d = dials();
    var seen = {};
    var put = function (id, x, y) {
      seen[id] = 1;
      var a = interp[id];
      if (!a) { interp[id] = GM.interp.create(x, y, bclock, null); return; }
      /* ★ §21-A2 — 제자리에 선 놈은 띠에 얹지 않는다. 민병은 이제 절반 박자(2Hz)로 오고,
         그 사이 서브틱마다 **같은 좌표**를 다시 얹으면 띠가 250ms 박자를 배워 버린다:
         그러면 500ms 어치 걸음을 250ms 만에 지나가 걷다 서다 하는 톱니가 된다. */
      var last = a.buf[a.buf.length - 1];
      if (last && last.x === x && last.y === y) return;
      GM.interp.push(a, x, y, bclock, BATTLE_SNAP, d, d.battleGapMs);
    };
    var i;
    for (i = 0; i < (p.enemies || []).length; i++) put(p.enemies[i].id, p.enemies[i].x, p.enemies[i].y);
    for (i = 0; i < (p.militia || []).length; i++) put('m' + p.militia[i].id, p.militia[i].x, p.militia[i].y);
    for (var id in interp) if (Object.prototype.hasOwnProperty.call(interp, id) && !seen[id]) delete interp[id];
  }

  function unitPos(id, fx, fy) {
    var a = interp[id];
    if (!a) return { x: fx, y: fy };
    var d = dials();
    var pos = GM.interp.sample(a, bclock, d, d.battleGapMs);
    a.x = pos.x; a.y = pos.y;
    return a;
  }

  /* ★ §21-C1(D) — 서브틱이 실어 오는 events 는 **그 서브틱에 새로 생긴 것만**이다
     (battle.js `b.timeline.slice(before)`). 그런데 여기는 누적 커서(seenEvents)로 읽고 있었다:
     첫 장에서 커서가 8까지 오르면, 새 사건 3개가 온 두 번째 장은 `for (i = 8; i < 3; …)` 이 되어
     **한 개도 재생되지 않는다**. 화살·파편·비명이 첫 장 이후로 통째로 사라지던 까닭이다.
     보내 준 것은 이미 새것뿐이니, 커서 없이 전부 재생하는 것이 맞다(판정과는 무관 — 연출만). */
  function playEvents(p) {
    var evs = p.events || [];
    for (var i = 0; i < evs.length; i++) handleEvent(evs[i], p);
  }

  function findEnemy(p, id) {
    for (var i = 0; i < (p.enemies || []).length; i++) if (p.enemies[i].id === id) return p.enemies[i];
    return interp[id] || null;
  }
  function findTurret(p, id) {
    for (var i = 0; i < (p.turrets || []).length; i++) if (p.turrets[i].id === id) return p.turrets[i];
    return null;
  }
  function fenceById(id) {
    var l = S.fences();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }

  function handleEvent(e, p) {
    if (!e) return;
    if (e.kind === 'kill') {
      var t = findEnemy(p, e.targetId);
      if (t) {
        GM.fx.debris(t.x, t.y, '#bc4749', 10, 1.3);
        GM.fx.ring(t.x, t.y, '#ff9d99', 0.2, 1.2, 0.45);
        var src = e.by === 'turret' ? findTurret(p, e.byId) : null;
        if (src) shots.push({ from: { x: src.x, y: src.y - 0.8 }, to: { x: t.x, y: t.y }, t: 0, dur: 0.22, color: '#f6e6a8' });
        GM.sfx.play('kill');
      }
    } else if (e.kind === 'fenceBreak') {
      GM.sfx.play('fenceBreak');
      GM.fx.shakeScreen(4, 0.25);
      var f = fenceById(e.targetId);
      if (f) {
        var mx = (f.x1 + f.x2) / 2, my = (f.y1 + f.y2) / 2;
        GM.fx.debris(mx, my, '#8a5e33', 12, 1.4);
        GM.fx.floatText(mx, my - 0.8, '울타리가 부서졌다', '#ff9d99', 12);
      }
    } else if (e.kind === 'structureHit' || e.kind === 'structureRuined' || e.kind === 'structureBreach') {
      /* ★ §19-F1 — 서버가 실어 보내는 이름은 structureId 다(targetId 아님). 옛 줄은 늘 빈손이라
         건물이 맞아도 화면에 먼지 한 톨 안 났다 — 부수며 진입(F05-3)이 이 길을 그대로 쓴다. */
      var b = S.structureById(e.structureId || e.targetId);
      if (b) {
        GM.fx.debris(b.x, b.y, '#c8a874', e.kind === 'structureRuined' ? 16 : 6, 1.2);
        if (e.kind === 'structureBreach') GM.fx.floatText(b.x, b.y - 1.2, b.name + ' 뚫림', '#f0a09c', 12);
        if (e.kind === 'structureRuined') {
          GM.fx.shakeScreen(5, 0.3);
          GM.fx.floatText(b.x, b.y - 1.2, b.name + ' 무너짐', '#ff9d99', 13);
          GM.sfx.play('crumble');
          /* ★ 3단계B — 「부수는 중」의 목소리. 울타리가 아니라 건물부터 무너지는 판도 있다
             (드래곤은 담장을 넘어 곧장 내려앉는다) — 그 길에도 같은 한 줄이 붙어야 한다. */
          sayBreachOnce();
        }
      }
    } else if (e.kind === 'breach') {
      GM.fx.flash('#7d1c1c', 0.3, 0.5);
      GM.sfx.play('bad');
      U.toast('울타리가 뚫렸습니다 — 안쪽을 지키세요.', 'bad', 4200);
      sayBreachOnce();
    } else if (e.kind === 'playerHit') {
      /* ★ §17-19 — 흔들림·붉은 섬광·깎인 수는 hud.hurt 한 곳이 낸다(체력 감시와 겹쳐 두 번 흔들리지 않게) */
      GM.sfx.play('hurt');
      GM.hud.hurt(e.amount || 0);
    } else if (e.kind === 'playerDown') {
      /* ★ GDD3 §14-6 — 전투 중에 쓰러져도 같은 화면이 뜬다(카운트다운 · 첫 다운 설명 카드). */
      if (!e.targetId || e.targetId === S.S.avatarId) {
        GM.down.onDown({
          avatarId: e.targetId || S.S.avatarId,
          downSeconds: S.combatCfg().downSeconds,
          reviveHpRatio: S.combatCfg().reviveHpRatio,
          invulnSeconds: S.combatCfg().invulnSeconds,
          by: '몰려온 무리',
        });
      }
    } else if (e.kind === 'playerRevived') {
      if (!e.targetId || e.targetId === S.S.avatarId) GM.down.onRevived(e);
    } else if (e.kind === 'militiaDown') {
      var r = S.residentById(e.targetId);
      if (r) GM.fx.debris(r.x, r.y, '#bc4749', 6, 1);
    } else if (e.kind === 'withdraw') {
      U.toast('남은 무리가 챙긴 것을 들고 물러갑니다.', 'warn', 4200);
    }
  }

  /** ★ §19-B — 전투 시계도 **자르지 않은 프레임 간격**으로 흐른다(world.js tickAnim 이 넘겨 준다).
      dt 는 0.05초로 잘려 있어 무거운 프레임이 이어지면 시계가 벽시계보다 뒤처지고,
      그 차이만큼 적이 띠 앞머리에 얼어붙었다가 한 장 밀려날 때 통째로 건너뛴다. */
  function step(dt, rawMs) {
    var d = dials();
    bclock += Math.max(0, Math.min(typeof rawMs === 'number' ? rawMs : dt * 1000, d.clockMaxStepMs));
    for (var i = shots.length - 1; i >= 0; i--) {
      shots[i].t += dt;
      if (shots[i].t > shots[i].dur) { shotImpact(shots[i]); shots.splice(i, 1); }
    }
    /* 터렛이 쉬지 않고 쏘는 그림 — 서버 사건과 별개인 순수 연출 */
    var b = S.battleLive();
    if (b && b.turrets && b.turrets.length && b.enemies && b.enemies.length && Math.random() < dt * 6) {
      var tr = b.turrets[Math.floor(Math.random() * b.turrets.length)];
      var en = null, bd = 1e9;
      for (var k = 0; k < b.enemies.length; k++) {
        var d = Math.hypot(b.enemies[k].x - tr.x, b.enemies[k].y - tr.y);
        if (d <= (tr.range || 8) && d < bd) { bd = d; en = b.enemies[k]; }
      }
      if (en) {
        shots.push({ from: { x: tr.x, y: tr.y - 0.8 }, to: { x: en.x, y: en.y }, t: 0, dur: 0.2,
                     color: shotColor(tr.key) });
        GM.sfx.play('shot');
      }
    }
  }

  /* ══════════ 월드 위 유닛 ══════════ */

  /* ★ GDD3 §15-A-1 — 터렛이 쏜 발은 웨이브 밖에서도 그려야 한다.
     서버 생태계 루프(1초)가 흘려보낸 shots 를 그대로 궤적으로 만든다. */
  function addGuardShots(list) {
    for (var i = 0; i < (list || []).length; i++) {
      var s = list[i];
      shots.push({
        from: { x: s.x, y: s.y - 0.8 }, to: { x: s.tx, y: s.ty },
        t: 0, dur: 0.24, color: shotColor(s.key)
      });
      if (GM.world && GM.world.markWildHurt && s.targetId) GM.world.markWildHurt(s.targetId);
    }
    if ((list || []).length && GM.sfx) GM.sfx.play('shot');
  }

  /* ★ §19-F1(F08-3) — 쏘는 것이 늘었으니 빛깔도 늘어난다(터렛마다 제 빛). */
  var SHOT_COLOR = { cannon: '#e08541', ballista: '#c6d6e2', frost_tower: '#9fd4ee', flame_tower: '#f0763a' };
  function shotColor(key) {
    return SHOT_COLOR[key] || '#f6e6a8';
  }

  /* ══════════ ★ §19-D(F03-7) 터렛의 한 발 ══════════
     「왜」 손봤나 — 옛 그림은 총구에서 지금 자리까지 굵기 2의 실선 하나였다. 밝은 낮 화면에서는
     그 선이 배경에 묻혀 "터렛이 공격하는지도 모르겠다"는 말이 나왔다. 이제 세 몫으로 나눈다:
       ① 머리 뒤로 짧게 끌리는 **꼬리**(옅은 빛 + 심지) — 어디에서 어디로 가는지가 보인다
       ② 쏜 자리에 잠깐 남는 **총구 불티** — 어느 터렛이 쐈는지가 보인다
       ③ 닿는 순간의 **테와 불티** — 맞았다는 것이 보인다
     전부 렌더 계층이다: 피해·판정·서버 사건은 한 눈금도 달라지지 않는다. 수치는 world.json render.turretShot. */
  var SHOT_FALLBACK = { width: 3.4, glowWidth: 9, headRadius: 3.2, trailFrac: 0.42, muzzleFrac: 0.34,
    muzzleRadius: 0.42, impactRadius: 0.95, impactSeconds: 0.3, impactWidth: 2.5, sparks: 6 };
  function shotDials() {
    var w = S.worldCfg();
    return (w && w.render && w.render.turretShot) || SHOT_FALLBACK;
  }
  /** 발이 지금 있는 자리 — 곡선(포물선)은 옛 식 그대로다 */
  function shotAt(sh, k) {
    var kk = U.clamp(k, 0, 1);
    return { x: sh.from.x + (sh.to.x - sh.from.x) * kk,
             y: sh.from.y + (sh.to.y - sh.from.y) * kk - Math.sin(kk * Math.PI) * 1.1 };
  }
  function strokeLine(ctx, a, c, color, width, alpha) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();
  }

  /** 날아가는 것들 — 전투 중이든 아니든 늘 그린다 */
  function drawShots(ctx) {
    if (!shots.length) return;
    var d = shotDials();
    ctx.save();
    ctx.lineCap = 'round';
    for (var i = 0; i < shots.length; i++) drawOneShot(ctx, shots[i], d);
    ctx.restore();
  }

  function drawOneShot(ctx, sh, d) {
    var kk = U.clamp(sh.t / sh.dur, 0, 1);
    var a = GM.camera.worldToScreen(sh.from.x, sh.from.y);
    var head = shotAt(sh, kk), tailW = shotAt(sh, kk - (d.trailFrac || 0.42));
    var c = GM.camera.worldToScreen(head.x, head.y);
    var tp = GM.camera.worldToScreen(tailW.x, tailW.y);
    strokeLine(ctx, tp, c, sh.color, d.glowWidth || 9, 0.3 * (1 - kk * 0.35));
    strokeLine(ctx, tp, c, sh.color, d.width || 3.4, 0.95);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff6dc';
    ctx.beginPath();
    ctx.arc(c.x, c.y, d.headRadius || 3.2, 0, Math.PI * 2);
    ctx.fill();
    drawMuzzle(ctx, a, kk, sh.color, d);
  }

  /** 총구 불티 — 쏜 직후 잠깐만. 어느 터렛이 쐈는지가 이것으로 보인다 */
  function drawMuzzle(ctx, a, kk, color, d) {
    var span = d.muzzleFrac || 0.34;
    if (kk > span) return;
    var f = 1 - kk / span;
    ctx.globalAlpha = 0.85 * f;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(a.x, a.y, (d.muzzleRadius || 0.42) * GM.camera.cam.tile * (0.5 + f), 0, Math.PI * 2);
    ctx.fill();
  }

  /** 닿는 순간 — 테 하나와 불티 몇 점. 「맞았다」가 보여야 방어가 일하는 줄 안다 */
  function shotImpact(sh) {
    if (!GM.fx || !sh || !sh.to) return;
    var d = shotDials();
    GM.fx.ring(sh.to.x, sh.to.y, sh.color, 0.1, d.impactRadius || 0.95,
      d.impactSeconds || 0.3, d.impactWidth || 2.5);
    GM.fx.sparkle(sh.to.x, sh.to.y, d.sparks || 6, '#fff6dc');
  }

  function drawUnits(ctx, tile, animT) {
    drawShots(ctx);
    var b = S.battleLive();
    if (!b) return;

    (b.turrets || []).forEach(function (tr) {
      if (!GM.camera.onScreen(tr.x, tr.y, tile * 8)) return;
      var p = GM.camera.worldToScreen(tr.x, tr.y);
      ctx.save();
      ctx.globalAlpha = 0.10;
      ctx.strokeStyle = '#f6e6a8';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, (tr.range || 8) * tile, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });

    (b.militia || []).forEach(function (m) {
      if (!m.alive) return;
      var q = unitPos('m' + m.id, m.x, m.y);
      if (!GM.camera.onScreen(q.x, q.y, tile * 2)) return;
      var p = GM.camera.worldToScreen(q.x - 0.36, q.y - 0.8);
      var f = Math.floor(animT / 200 + q.x) % 2;
      try { ctx.drawImage(GM.atlas.folk('defense', 0, f), Math.round(p.x), Math.round(p.y), Math.ceil(tile * 0.7), Math.ceil(tile * 0.9)); } catch (e) {}
      hpBar(ctx, p.x, p.y - 5, tile * 0.7, m.hp / Math.max(1, m.maxHp), '#8dbb6d');
    });

    (b.enemies || []).forEach(function (en) {
      if (en.hp <= 0) return;
      var q = unitPos(en.id, en.x, en.y);
      if (!GM.camera.onScreen(q.x, q.y, tile * 2)) return;
      var p = GM.camera.worldToScreen(q.x - 0.4, q.y - 0.9);
      var f = Math.floor(animT / 170 + q.x * 2) % 2;
      /* 침입 적은 전투에서 눈에 띄도록 두 배로 그리고, 발은 기존 바닥선에 맞춘다. */
      var w = tile * 1.6, h = tile * 1.9;
      var drawX = p.x - tile * 0.4, drawY = p.y - tile * 0.95;
      ctx.save();
      ctx.globalAlpha = 0.24;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      try { ctx.ellipse(drawX + w / 2, drawY + h - 1, w * 0.32, w * 0.14, 0, 0, Math.PI * 2); } catch (e1) {}
      ctx.fill();
      ctx.restore();
      try { ctx.drawImage(GM.atlas.enemy(b.type, f), Math.round(drawX), Math.round(drawY), Math.ceil(w), Math.ceil(h)); } catch (e2) {}
      hpBar(ctx, drawX, drawY - 6, w, en.hp / Math.max(1, en.maxHp), '#bc4749');
      if (en.looting) {
        ctx.save();
        ctx.globalAlpha = 0.6 + 0.3 * Math.sin(animT / 200);
        ctx.fillStyle = '#e8a33d';
        ctx.fillRect(drawX + w - 4, drawY - 12, 5, 5);
        ctx.restore();
      }
    });

  }

  function hpBar(ctx, x, y, w, ratio, color) {
    ctx.fillStyle = 'rgba(20,14,8,.72)';
    ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * U.clamp(ratio, 0, 1), 4);
  }

  /** 붉은 하늘 — 전투 중에만 */
  function drawOverlay(ctx, W, H, animT) {
    if (!S.battleLive()) return;
    ctx.save();
    ctx.globalAlpha = 0.10 + 0.05 * Math.sin(animT / 260);
    ctx.fillStyle = '#7d1c1c';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  /* ══════════ 전투 상단 띠 ══════════ */
  function setBattleBar(p) {
    var bar = U.qs('#battle-bar');
    if (!bar) return;
    if (!p) { bar.hidden = true; return; }
    bar.hidden = false;
    U.clear(bar);
    var meta = S.enemyMeta(p.type);
    bar.appendChild(GM.icons.img(meta.icon, 24));
    bar.appendChild(U.el('span', 'bb-n', p.name || meta.name));
    var g = U.el('span', 'bb-gauge');
    var fill = U.el('i');
    var killed = p.killed || 0, total = Math.max(1, p.total || 1);
    fill.style.width = Math.round((killed / total) * 100) + '%';
    g.appendChild(fill);
    bar.appendChild(g);
    bar.appendChild(U.el('span', 'bb-c', killed + ' / ' + total));
    var me = null;
    (p.players || []).forEach(function (pl) { if (pl.id === S.S.avatarId) me = pl; });
    if (me) {
      var hp = U.el('span', 'bb-hp' + (me.down ? ' down' : ''));
      hp.appendChild(GM.icons.img('heart', 16));
      hp.appendChild(U.el('span', null, U.fmt(me.hp, 0) + ' / ' + U.fmt(me.maxHp, 0)));
      bar.appendChild(hp);
    }
    bar.appendChild(U.el('span', 'bb-t', '남은 시간 ' + Math.max(0, Math.round((p.maxSeconds || 120) - (p.t || 0))) + '초'));
  }

  function clearBattleBar() {
    var bar = U.qs('#battle-bar');
    if (bar) { bar.hidden = true; U.clear(bar); }
  }

  /* ══════════ 결과 ══════════ */
  function onResult(r) {
    clearBattleBar();
    interp = {}; shots = [];
    var vg = U.qs('#vignette');
    if (vg) vg.classList.remove('on');
    if (!r) return;
    var meta = S.enemyMeta(r.type);
    var body = U.el('div');

    var head = U.el('div', 'result-head ' + (r.won ? 'won' : 'lost'));
    head.textContent = r.won ? (r.name || meta.name) + '을(를) 모두 몰아냈다' : (r.name || meta.name) + '이(가) 챙겨 갔다';
    body.appendChild(head);

    /* ★ 3단계B — 무리의 마지막 한 마디. 이겼으면 쓸려 나간 자의 말(fallen),
       못 막았으면 챙긴 것을 들고 돌아서는 자의 말(retreat)이다. 숫자표 바로 위에 한 줄로 선다 —
       결과창은 이미 싸움이 끝난 자리라 걸음을 멈추지 않는다. */
    if (GM.enemyLines) {
      var last = GM.enemyLines.pick(r.type, r.number || 1, r.won ? 'fallen' : 'retreat');
      if (last) body.appendChild(U.el('p', 'enemy-line', last));
    }

    var g = U.el('div', 'stat-grid');
    stat(g, '쓰러뜨린 수', U.fmt(r.enemiesKilled, 0) + ' / ' + U.fmt(r.enemiesTotal, 0));
    stat(g, '버틴 시간', U.fmt(r.duration, 1) + '초');
    stat(g, '부서진 울타리', U.fmt(r.fencesBroken, 0) + '조각');
    if (r.militiaDowned) stat(g, '쓰러진 민병', U.fmt(r.militiaDowned, 0) + '명', '다시 일어납니다');
    if (r.gold) stat(g, '거둔 금화', U.fmt(r.gold, 0));
    if (r.moraleDelta) stat(g, '사기', U.signed(r.moraleDelta, 2));
    body.appendChild(g);

    if ((r.structuresDamaged || []).length) {
      body.appendChild(U.el('h3', 'sec-title', '상한 것'));
      var ul = U.el('ul');
      r.structuresDamaged.slice(0, 6).forEach(function (s) {
        ul.appendChild(U.el('li', null, s.name + ' — ' +
          (s.ruined ? '무너짐' : '튼튼함 ' + U.fmt(s.hp, 0) + ' / ' + U.fmt(s.maxHp, 0))));
      });
      body.appendChild(ul);
      body.appendChild(U.el('p', 'hint', '건물을 눌러 [수리]하면 되돌아옵니다. 한 번에 다 무너지지는 않습니다.'));
    }

    var note = U.el('p', 'soft-note');
    if (r.won) {
      note.textContent = r.text || '한 놈도 남기지 않고 몰아냈습니다. 사람들이 울타리 밖으로 나와 숨을 돌립니다.';
      body.appendChild(note);
      body.appendChild(U.el('p', 'hint', '다음은 더 셉니다 — 울타리를 석벽으로 올리거나 화살탑을 하나 더 세워 두세요.'));
    } else {
      note.textContent = (r.text || '') + ' 창고가 조금 축났습니다. 다만 끝난 것은 아닙니다 — ' +
        '사람들은 잔해를 치우고 다시 밭으로 나갑니다.';
      body.appendChild(note);
      body.appendChild(U.el('p', 'hint', '진 것이 아니라 덜 막은 것입니다. 울타리를 고치고 한 겹 더 두르면 눈에 띄게 달라집니다.'));
    }

    var foot = U.el('div');
    var ok = U.btn('알겠다', 'btn-primary', function () { U.closeTopModal(); });
    ok.id = 'wave-ok';
    foot.appendChild(ok);
    GM.sfx.play(r.won ? 'fanfare' : 'bad');
    return U.openModal({ title: (r.name || meta.name) + ' 제 ' + (r.number || 1) + '차', body: body, footer: foot,
                         width: '620px', key: 'wave', icon: GM.icons.img(meta.icon, 22) });
  }

  function stat(grid, name, val, sub) {
    var c = U.el('div', 'stat');
    c.appendChild(U.el('span', 's-name', name));
    c.appendChild(U.el('span', 'num s-val', val));
    if (sub) c.appendChild(U.el('span', 's-sub', sub));
    grid.appendChild(c);
  }

  /* ══════════ 방어 패널 ══════════ */
  function openThreat() {
    if (!S.uiOn('hud.threat')) { U.toast('아직 바깥 소식이 닿지 않습니다.', 'warn'); return; }
    var body = U.el('div');
    body.id = 'threat-body';
    paintThreat(body);
    var foot = U.el('div');
    /* ★ §16-19 — 수비 깃발. 웨이브가 오는 쪽에 미리 진을 친다. */
    var df = S.defenseFlag();
    foot.appendChild(U.btn(df ? '깃발을 옮긴다' : '수비 깃발을 꽂는다', 'btn-small', function () {
      U.closeTopModal();
      S.setPlacing({ kind: 'flag' });
      U.toast('수비대가 모여 설 자리를 누르세요.', 'good', 3600);
    }));
    if (df) {
      foot.appendChild(U.btn('깃발을 걷는다', 'btn-small', function () {
        GM.net.send('setDefenseFlag', { x: null }, function () { U.toast('수비 깃발을 걷었습니다.', 'good', 2200); });
        U.closeTopModal();
      }));
    }
    foot.appendChild(U.btn('닫는다', 'btn-primary', function () { U.closeTopModal(); }));
    return U.openModal({ title: '울타리 앞', body: body, footer: foot, width: '660px',
                         key: 'threat', icon: GM.icons.img('shield', 22) });
  }

  function paintThreat(host) {
    U.clear(host);
    var w = S.wave(), d = S.defense();
    if (!w || !d) { host.appendChild(U.el('p', 'empty', '아직 헤아릴 것이 없습니다.')); return; }

    if (w.enemy) {
      var meta = S.enemyMeta(w.enemy.type);
      var card = U.el('div', 'scroll-card');
      var t = U.el('div', 'th-enemy');
      t.appendChild(GM.icons.img(meta.icon, 34));
      var col = U.el('div');
      col.appendChild(U.el('span', 'th-n', (w.enemy.name || meta.name) + ' 제 ' + (w.number || 1) + '차'));
      var days = w.precise ? w.daysUntil : w.daysUntilMin;
      col.appendChild(U.el('span', 'th-s',
        (days === null || days === undefined ? '언제 올지 모릅니다'
          : (w.precise ? days + '일 뒤' : days + '일 안쪽')) + ' · ' + S.directionMeta(w.enemy.direction).name + '에서'));
      t.appendChild(col);
      card.appendChild(t);
      if (w.precise) {
        card.appendChild(U.el('p', null, w.enemy.units + '마리 · 한 마리 체력 ' + U.fmt(w.enemy.unitHp, 0) +
          ' · 공격력 ' + U.fmt(w.enemy.unitDps, 0)));
        /* ★ §19-F2(F07-3) — 무엇이 섞여 오는지도 예언에 든다. 문구는 서버가 쥔 이름 그대로다. */
        if (w.enemy.escort) {
          card.appendChild(U.el('p', 'state-warn',
            '섞여 온다 — ' + w.enemy.escort.name + ' ' + w.enemy.escort.units + '마리'));
        }
      } else {
        card.appendChild(U.el('p', 'hint', '성녀가 자리에 있어야 규모와 날을 정확히 압니다.'));
      }
      if (w.hint) card.appendChild(U.el('p', null, w.hint));
      if (w.tacticHint) card.appendChild(U.el('p', 'state-good', w.tacticHint.text || ''));
      host.appendChild(card);
    }

    /* ★ Sprint 5 — 「침공 채비」. 기다리는 동안 무엇이 모자란지, 다 갖추면 무엇을 할 수 있는지를
       한자리에 모은다. 판정의 정본은 서버(rushWave)다 — 화면은 서버가 준 표를 옮겨 적을 뿐이다. */
    paintReadiness(host, w);

    var est = d.estimate || {};
    var g = U.makeGauge({ height: 24 });
    var ratio = est.secondsFenceHolds && est.secondsToClear
      ? U.clamp(est.secondsFenceHolds / Math.max(1, est.secondsToClear) / 2, 0, 1) : 0.4;
    var word = est.comfortable ? { text: '넉넉함' } : S.wordFor(ratio * 1.4);
    g.setValue(ratio, word.text, '지금 울타리 앞은 ' + word.text,
      '적을 다 쓸어내는 데 약 ' + U.fmt(est.secondsToClear, 0) + '초, 울타리가 버티는 시간 약 ' +
      U.fmt(est.secondsFenceHolds, 0) + '초로 봅니다.\n' +
      '싸움은 길어야 ' + U.fmt(est.maxSeconds, 0) + '초이고, 시간이 다 되면 남은 적이 챙긴 것을 들고 물러갑니다.');
    host.appendChild(g);

    var grid = U.el('div', 'stat-grid');
    stat(grid, '터렛', U.fmt(d.turretCount, 0) + '기', '공격력 ' + U.fmt(d.turretDps, 0));
    stat(grid, '민병', U.fmt(d.militiaCount, 0) + '명', '공격력 ' + U.fmt(d.militiaDps, 0));
    stat(grid, '나', U.fmt(d.playerDps, 1), '직접 붙으면 이만큼');
    stat(grid, '울타리', U.fmt(d.fenceSegments, 0) + '조각', '튼튼함 합 ' + U.fmt(d.fenceHp, 0));
    host.appendChild(grid);

    if ((d.turrets || []).length) {
      host.appendChild(U.el('h3', 'sec-title', '세워 둔 것'));
      var list = U.el('div', 'th-turrets');
      d.turrets.forEach(function (t2) {
        var row = U.el('button', 'th-turret');
        row.type = 'button';
        row.appendChild(GM.icons.img(GM.build.iconOf(t2.key), 22));
        row.appendChild(U.el('span', null, t2.name + ' · 공격력 ' + U.fmt(t2.dps, 0) + ' · 사거리 ' + U.fmt(t2.range, 0)));
        row.onclick = function () { GM.camera.moveTo(t2.x, t2.y); U.closeTopModal(); };
        list.appendChild(row);
      });
      host.appendChild(list);
    }

    var n = S.nation();
    var plan = n && n.battlePlan;
    if (plan && (plan.options || []).length) {
      host.appendChild(U.el('h3', 'sec-title', '어떻게 맞설까'));
      var tg = U.el('div', 'tactic-grid');
      plan.options.forEach(function (o) {
        var b = U.el('button', 'tactic-card' + (plan.tactic === o.key ? ' on' : ''));
        b.type = 'button';
        b.setAttribute('data-tactic', o.key);
        b.appendChild(GM.icons.img(o.key === 'siege' ? 'shield' : (o.key === 'sortie' ? 'sword' : 'fuel'), 28));
        b.appendChild(U.el('span', 'tc-n', o.name));
        b.appendChild(U.el('span', 'tc-d', o.desc));
        b.onclick = function () {
          GM.net.send('setBattlePlan', { tactic: o.key });
          U.qsa('.tactic-card', tg).forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-tactic') === o.key); });
          GM.sfx.play('tap');
          U.toast(o.name + '(으)로 맞섭니다.', 'good');
        };
        tg.appendChild(b);
      });
      host.appendChild(tg);
    }

    host.appendChild(U.el('p', 'hint',
      '져도 정착지가 끝나지는 않습니다. 건물이 상하고 창고가 축날 뿐, 사람들은 다시 일어섭니다.'));
  }

  /**
   * ★ Sprint 5 — 침공 채비 체크리스트와 [적을 불러들인다].
   * 「왜」 여기에 두나 — 여태 「채비 끝」은 좌상단 한 줄로만 알렸고, 정작 누를 자리가 없었다.
   * 조건 한 줄의 얼굴(✔/✕ · 현재값/필요값)은 화면 어디서나 같다(§12-3).
   */
  function paintReadiness(host, w) {
    var rd = w.readiness;
    var rows = (rd && rd.rows) || [];
    if (!rows.length && !w.canRush && !w.rushed) return;
    host.appendChild(U.el('h3', 'sec-title', '침공 채비'));
    if (rows.length) {
      var list = U.el('div', 'req-list');
      rows.forEach(function (r) {
        var row = U.el('div', 'req-row ' + (r.ok ? 'ok' : 'bad'));
        row.setAttribute('data-ready', r.key || '');
        row.appendChild(U.el('span', 'rq-mark', r.ok ? '✔' : '✕'));
        row.appendChild(U.el('span', 'rq-t', r.label || ''));
        row.appendChild(U.el('span', 'rq-v', U.fmt(r.have, 0) + '/' + U.fmt(r.need, 0)));
        list.appendChild(row);
      });
      host.appendChild(list);
    }

    if (w.rushed) {
      host.appendChild(U.el('p', 'state-warn', '북은 이미 울렸다 — 내일 온다.'));
      return;
    }
    if (!w.canRush) {
      host.appendChild(U.el('p', 'hint', '채비를 다 갖추면 먼저 부를 수 있습니다. 기다릴지 부를지는 그대의 몫입니다.'));
      return;
    }
    var act = U.el('div', 'th-rush');
    act.appendChild(U.btn('적을 불러들인다 — 내일 온다', 'btn-primary', function () {
      GM.net.send('rushWave', {}, function (res) {
        if (!res) return;
        if (!res.ok) {
          U.toast((res.error && res.error.message) || '지금은 부를 수 없습니다.', 'warn', 3400);
          GM.sfx.play('deny');
          return;
        }
        GM.sfx.play('unlock');
        U.toast('북을 울렸습니다 — 내일 옵니다.', 'good', 3200);
        updateThreat();
      });
    }));
    host.appendChild(act);
    host.appendChild(U.el('p', 'hint', '북을 울리면 남은 날을 기다리지 않습니다 — 채비가 끝났을 때만 열립니다.'));
  }

  function updateThreat() {
    var host = U.qs('#threat-body');
    if (host && U.modalOpen('threat')) paintThreat(host);
  }

  function reset() { shots = []; interp = {}; saidBreach = false; clearBattleBar(); }

  GM.combat = {
    onIncoming: onIncoming, onStart: onStart, onTick: onTick, onResult: onResult,
    step: step, drawUnits: drawUnits, drawOverlay: drawOverlay,
    /* ★ GDD3 §15-A — 웨이브 밖의 터렛 사격(생태계 루프가 준 것) */
    addGuardShots: addGuardShots, drawShots: drawShots,
    shotCount: function () { return shots.length; },
    openThreat: openThreat, updateThreat: updateThreat,
    reset: reset, clearBattleBar: clearBattleBar
  };
})(window);
