/* down.js — 쓰러짐과 일어남. ★ GDD3 §14-6.
   피드백: "죽었는데 뭐가 어떻게 되는 건지 모르겠다."
   서버에는 이미 규칙이 있었다(체력 0 → downSeconds 뒤 모닥불에서 기상 + 사기 소폭 하락).
   없던 것은 **그 사실을 알려 주는 화면**이다. 그래서 여기서 하는 일은 셋뿐이다:
     ① 화면을 어둡게 덮고 남은 초를 크게 센다
     ② 다 세면 어디서 어떻게 일어났는지(체력 절반·무적 3초) 한 줄로 알린다
     ③ **처음 쓰러진 한 번만** 규칙을 설명하는 카드를 띄운다(그 뒤로는 방해하지 않는다)
   초를 세는 것은 화면이지만, 실제로 언제 일어나는지는 서버가 정한다 — playerRevived 가 오면 즉시 걷는다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var veil = null;
  var timer = null;
  var until = 0;
  var total = 10;
  var invulnEl = null;
  var invulnTimer = null;

  var FIRST_KEY = 'gm.downExplained';
  function explained() {
    try { return localStorage.getItem(FIRST_KEY) === '1'; } catch (e) { return false; }
  }
  function markExplained() {
    try { localStorage.setItem(FIRST_KEY, '1'); } catch (e) {}
  }

  function stage() { return U.qs('#stage') || document.body; }

  function build(seconds, by) {
    remove();
    veil = U.el('div', 'down-veil');
    veil.id = 'down-veil';
    veil.appendChild(U.el('h2', null, '쓰러졌습니다'));
    veil.appendChild(U.el('p', null, by ? (by + '에게 당했습니다.') : '몸을 가눌 수 없습니다.'));
    var count = U.el('div', 'down-count', String(Math.ceil(seconds)));
    count.id = 'down-count';
    veil.appendChild(count);
    var ring = U.el('div', 'down-ring');
    var fill = U.el('i');
    fill.style.width = '100%';
    ring.appendChild(fill);
    veil.appendChild(ring);
    veil.appendChild(U.el('p', null, '초 뒤 모닥불에서 일어납니다 — 죽지는 않습니다.'));
    document.body.appendChild(veil);
    return { count: count, fill: fill };
  }

  function remove() {
    if (timer) { clearInterval(timer); timer = null; }
    if (veil && veil.parentNode) veil.parentNode.removeChild(veil);
    veil = null;
  }

  /** 서버가 보낸 playerDown — 나의 것일 때만 화면을 덮는다 */
  function onDown(p) {
    if (!p) return false;
    if (p.avatarId && S.S.avatarId && p.avatarId !== S.S.avatarId) return false;
    total = Math.max(1, Number(p.downSeconds) || (S.combatCfg().downSeconds || 10));
    until = Date.now() + total * 1000;
    /* ★ Sprint 1 — 쓰러진 즉시 몸을 잠근다. 서버의 down 표(S.downed)는 다음 state 푸시까지
       늦어, 그 틈에 걷고 자리 보고(lordMove)까지 나가 부활 좌표를 덮었다. */
    if (GM.avatar && GM.avatar.setDowned) GM.avatar.setDowned(true);
    var parts = build(total, p.by);
    GM.sfx.play('bad');
    GM.fx.flash('#7d1c1c', 0.45, 0.7);
    timer = setInterval(function () {
      var left = Math.max(0, (until - Date.now()) / 1000);
      parts.count.textContent = String(Math.ceil(left));
      parts.fill.style.width = Math.round((left / total) * 100) + '%';
      /* ★ 스스로 걷는 안전장치 — 서버의 「일어났다」가 오지 않아도 장막은 반드시 걷힌다.
         화면을 덮은 채 남으면 그 뒤의 모든 클릭이 막혀 게임이 멎는다(실제로 그 사고가 났다).
         넉넉히 2초를 더 기다린 뒤 걷는다: 정상 흐름에서는 그 전에 playerRevived 가 온다. */
      if (left <= 0) {
        clearInterval(timer); timer = null;
        setTimeout(function () {
          if (veil) remove();
          /* 안전장치로 걷힐 때도 빗장은 반드시 푼다 — 잠긴 채 남으면 영영 못 걷는다 */
          if (GM.avatar && GM.avatar.setDowned) GM.avatar.setDowned(false);
        }, 2000);
      }
    }, 100);
    if (!explained()) {
      markExplained();
      firstCard(p);
    }
    return true;
  }

  /** 첫 다운 1회 설명 카드 — 규칙을 여기서 한 번만 못 박는다 */
  function firstCard(p) {
    var body = U.el('div');
    body.appendChild(U.el('p', null, '이 땅에서는 죽지 않습니다. 쓰러지면 잠시 뒤 모닥불 곁에서 다시 일어납니다.'));
    var ul = U.el('ul');
    [['기다리는 시간', Math.round(Number(p.downSeconds) || total) + '초'],
     ['일어나는 자리', '정착지 본부(모닥불)'],
     ['일어날 때 체력', Math.round((Number(p.reviveHpRatio) || 0.5) * 100) + '%'],
     ['일어난 직후', Math.round(Number(p.invulnSeconds) || 3) + '초 동안 아무도 나를 건드리지 못합니다'],
     ['치르는 값', '사기가 조금 내려갑니다']].forEach(function (r) {
      var li = U.el('li');
      li.appendChild(U.el('b', null, r[0] + ' — '));
      li.appendChild(U.el('span', null, r[1]));
      ul.appendChild(li);
    });
    body.appendChild(ul);
    body.appendChild(U.el('p', 'hint', '이 설명은 처음 한 번만 뜹니다. 도움말(?)에 늘 적혀 있습니다.'));
    U.openModal({
      title: '쓰러져도 끝이 아닙니다', body: body, width: '520px', key: 'downHelp',
      icon: GM.icons.img('heart', 22),
      footer: U.btn('알겠다', 'btn-primary', function () { U.closeTopModal(); })
    });
  }

  /** 서버가 보낸 playerRevived — 카운트다운을 걷고 무적 표시를 띄운다 */
  function onRevived(p) {
    if (!p) return false;
    if (p.avatarId && S.S.avatarId && p.avatarId !== S.S.avatarId) return false;
    remove();
    GM.sfx.play('unlock');
    /* ★ Sprint 1 — 카메라만 옮기던 것이 「죽은 자리에서 일어난다」의 정체다.
       위치는 클라 권위(§12-11)라 서버가 아바타를 모닥불로 옮겨도 클라 몸은 그대로였고,
       0.9초 안의 lordMove 가 그 서버 좌표마저 되덮었다. 이제 **몸부터** 부활 좌표로 옮기고
       (setPos 가 즉시 보고까지 한다), 빗장을 푼 뒤, 카메라가 따라간다. */
    if (GM.avatar && GM.avatar.setDowned) GM.avatar.setDowned(false);
    if (p.x != null && GM.avatar && GM.avatar.setPos) GM.avatar.setPos(p.x, p.y);
    GM.camera.moveTo(p.x, p.y);
    GM.fx.ring(p.x, p.y, '#b9cdff', 0.2, 2.2, 0.7);
    U.banner({ icon: 'heart', kind: 'good', title: '다시 일어섰다',
               sub: '체력 ' + U.fmt(p.hp, 0) + ' / ' + U.fmt(p.maxHp, 0)
                    + ' · ' + Math.round(p.invulnSeconds || 0) + '초 동안 무적', ms: 3000 });
    showInvuln(p.invulnSeconds || 0);
    GM.hud.renderMe();
    return true;
  }

  function showInvuln(seconds) {
    hideInvuln();
    if (!(seconds > 0)) return;
    invulnEl = U.el('div', 'invuln-tag decor', '무적 ' + Math.round(seconds) + '초');
    stage().appendChild(invulnEl);
    var left = seconds;
    invulnTimer = setInterval(function () {
      left -= 0.25;
      if (left <= 0) { hideInvuln(); return; }
      invulnEl.textContent = '무적 ' + Math.ceil(left) + '초';
    }, 250);
  }
  function hideInvuln() {
    if (invulnTimer) { clearInterval(invulnTimer); invulnTimer = null; }
    if (invulnEl && invulnEl.parentNode) invulnEl.parentNode.removeChild(invulnEl);
    invulnEl = null;
  }

  function reset() { remove(); hideInvuln(); }
  function isDown() { return !!veil; }

  GM.down = { onDown: onDown, onRevived: onRevived, reset: reset, isDown: isDown, firstCard: firstCard };
})(window);
