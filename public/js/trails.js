/* trails.js — ★ §18-D2 앞마당의 흔적. 설계 정본은 docs/탐험기획.md §18-2·§18-3·§18-5.

   「왜」 이 창구가 따로 있나 — 첫 사흘의 앞마당이 비어 있었다. 마차에서 내리면 나무와 돌뿐이고,
   걸어 나갈 이유가 「아직 안 가 본 곳」밖에 없었다. 흔적은 호기심에 **방향**을 준다:
   발자국 하나가 다음 발자국을 부르고, 그 끝에 이야기가 있다.

   원칙 셋 — 이 파일을 고칠 때 반드시 지킨다.
     ① 마커·화살표 금지(§18-3). 조사가 여는 것은 **안개**뿐이다. 다음 흔적의 자리는 서버가
        ack 에 싣지 않고, 이 파일도 그것을 아는 척하지 않는다 — 찾는 것은 플레이어의 눈이다.
     ② 화면은 문구를 짓지 않는다. 이름·동사·말·선택지 이름은 전부 서버가 자료(data/trails.json)에서
        길어 온 것을 옮길 뿐이다. 여기에 한국어 문장을 새로 적으면 자료의 정본성이 깨진다.
     ③ 선택은 **같은 명령을 한 번 더**다. 새 명령을 내지 않는다 — 1차 investigateTrail 이
        선택지를 펴고, 2차 investigateTrail{choice} 가 그 몫을 치른다(서버가 pending 으로 순서를 지킨다). */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var FALLBACK_REACH = 3.2;          /* 규격이 아직 안 닿은 자리(구경 모드)에서도 손은 뻗어야 한다 */
  var memo = { t: 0, val: null };
  var busy = false;                  /* 답을 기다리는 동안 E 연타가 같은 흔적을 두 번 열지 않게 */

  function now() { return Date.now(); }
  function reach() {
    var w = S.worldCfg();
    return (w && w.trails && w.trails.reachTiles) || FALLBACK_REACH;
  }

  /* ══════════ 손이 닿는 흔적인가 ══════════ */
  /** 매 프레임 불리는 자리(말머리 상자)라 짧게 기억해 둔다 — 이웃 도읍 판정과 같은 규율 */
  function near() {
    var n0 = now();
    if (n0 - memo.t < 90) return memo.val;
    memo.t = n0;
    memo.val = find();
    return memo.val;
  }

  function find() {
    var me = GM.avatar && GM.avatar.pos();
    if (!me || !S.S.map) return null;
    return S.trailNear(me.x, me.y, reach());
  }

  /* ══════════ 살핀다 ══════════ */
  /** E 한 번. choice 를 주면 2차(선택 확정)다. */
  function investigate(t, choice) {
    t = t || near();
    if (!t || busy) return;
    busy = true;
    var payload = { trailId: t.id };
    if (choice) payload.choice = choice;
    GM.net.send('investigateTrail', payload, function (res) {
      busy = false;
      if (!res || !res.ok) return refuse(res);
      show(t, res);
    });
  }

  function refuse(res) {
    U.toast((res && res.error && res.error.message) || '지금은 살필 수 없습니다.', 'warn', 2400);
    if (GM.sfx) GM.sfx.play('deny');
  }

  /* ══════════ 말과 몫 ══════════ */
  /** 서버가 건넨 한 벌을 대화창에 그대로 편다. 선택지가 있으면 그 자리에서 2차를 부른다. */
  function show(t, res) {
    var d = res.dialogue || {};
    reward(t, res);
    if (!GM.dialogue) return void U.toast((d.lines || [])[0] || '', 'good', 4200);
    GM.dialogue.open({
      speaker: d.speaker, portraitKey: d.portraitKey, lines: d.lines || [],
      choices: (d.choices || []).map(function (c) { return pick(t, c); })
    });
  }

  /* ★ cmd 가 아니라 act 를 쓰는 까닭 — 대화창의 cmd 길은 답을 안 받는다(보내고 닫는다).
     흔적의 선택은 **그 결과가 곧 다음 말**이라 ack 가 있어야 한다. 보내는 명령은 같은 것 하나뿐이다. */
  function pick(t, c) {
    return { label: c.label, act: function () { investigate(t, c.key); } };
  }

  /** 얻은 것을 그 자리에 띄운다 — 곳간 숫자가 다음 방송까지 잠자코 있으면 「먹혔나」 싶어진다 */
  function reward(t, res) {
    var y = t.y - 0.9;
    var got = res.gained || {};
    for (var k in got) {
      if (!got[k] || !Object.prototype.hasOwnProperty.call(got, k)) continue;
      GM.fx.floatText(t.x, y, '+' + U.fmt(got[k], 0) + ' ' + S.resourceMeta(k).name, '#c8e6a0', 13);
    }
    /* ★ §21-C1 — healed 는 이제 **부호가 있다**: 매복·함정·벌집은 그 자리에서 아프다(reward.damage).
       올라간 체력은 초록으로 오르고, 깎인 체력은 붉게 내린다 — 같은 한 줄이 두 일을 한다. */
    if (res.healed > 0) GM.fx.floatText(t.x, y, '+' + U.fmt(res.healed, 0) + ' 체력', '#8fd06a', 13);
    if (res.healed < 0) GM.fx.floatText(t.x, y, U.fmt(res.healed, 0) + ' 체력', '#ff9d99', 14);
    if (res.morale) GM.fx.floatText(t.x, y, '사기 ' + (res.morale > 0 ? '↑' : '↓'), '#f6cf7a', 13);
    /* ★ §21-C1 생존자 결말 — 사람이 따라왔다. 곳간 숫자보다 이쪽이 훨씬 큰 사건이라 따로 알린다. */
    if (res.joined) U.toast(res.joined + '명이 우리를 따라왔습니다.', 'good', 4200);
    if (GM.sfx) GM.sfx.play(res.healed < 0 ? 'hurt' : (res.pending ? 'tap' : 'pickup'));
  }

  GM.trails = { near: near, investigate: investigate, reach: reach };
})(window);
