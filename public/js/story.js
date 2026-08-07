/* story.js — ★ §세계관 W2 스토리 연출 수신기. 정본은 data/story.json(서버가 치환 완료해 보낸다).
   「왜」 새 창을 만들지 않나 — 대화창(dialogue.js)이 이미 「누군가 나에게 말을 건다」의 그릇이다.
   이 모듈은 storyBeat 의 장면들을 그 그릇에 한 장면씩 이어 담을 뿐이다. 지도는 계속 열려 있고
   서버 시계도 그대로 흐른다(세계관기획 §8 — 연출은 클라 오버레이일 뿐이다).
   Esc 는 남은 장면 전부를 접는 「건너뛰기」다(모든 beat 는 스킵 가능 — §0-1). */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};

  var queue = [];        // 아직 틀지 않은 beat 들
  var chain = null;      // 지금 트는 beat 의 남은 장면들 (null 이면 쉬는 중)
  var introHeld = null;  // 오프닝(마차)보다 먼저 틀어야 하는 도입 beat
  var introGate = null;  // app.js 가 건 「도입 먼저」 문

  function onBeat(p) {
    if (!p || !p.scenes || !p.scenes.length) return;
    if (p.id === 'intro' && introGate) { introHeld = p; introGate(); return; }
    queue.push(p);
    drain();
  }

  function drain() {
    if (chain || !queue.length) return;
    play(queue.shift(), drain);
  }

  function play(beat, done) {
    chain = beat.scenes.slice();
    step(beat, done);
  }

  function step(beat, done) {
    var sc = chain && chain.shift();
    if (!sc) { chain = null; done(); return; }
    if (!GM.dialogue) { chain = null; done(); return; }
    GM.dialogue.open({
      speaker: sc.speaker || '',
      portraitKey: portraitOf(sc.speaker),
      lines: [sc.text],
      onClose: function () { step(beat, done); }
    });
  }

  /* 세라는 지도 위에 실제로 걸어다니는 첫 주민이다 — 그 도트가 곧 초상이 된다(dialogue §원칙①) */
  function portraitOf(speaker) {
    if (speaker === '세라') return 'icon:person';
    if (!speaker) return 'icon:scroll';
    return 'icon:person';
  }

  /* Esc = 남은 장면 전부 접기. capture 로 먼저 비워, 대화창의 제 닫기와 겹쳐도 한 번에 끝난다 */
  function onKey(e) {
    if (e.key !== 'Escape' || !chain) return;
    chain.length = 0;
    if (GM.dialogue && GM.dialogue.isOpen()) GM.dialogue.close();
  }

  /**
   * 오프닝(마차 자막)보다 도입(알현실)이 먼저다 — 이야기의 시간 순서(세계관기획 §7-1).
   * 도입 beat 가 이미 와 있으면 바로 틀고, 아직이면 잠깐(1.5초) 기다렸다가 그냥 연다
   * (서버가 안 보내는 자리 — 옛 세이브·구경 모드 — 에서 화면이 멎으면 안 된다).
   */
  function beforeOpening(cb) {
    var fired = false;
    function go() {
      if (fired) return;
      fired = true;
      introGate = null;
      var b = introHeld;
      introHeld = null;
      if (!b) { cb(); return; }
      play(b, function () { cb(); drain(); });
    }
    if (introHeld) { go(); return; }
    introGate = go;
    setTimeout(go, 1500);
  }

  document.addEventListener('keydown', onKey, true);
  GM.story = { onBeat: onBeat, beforeOpening: beforeOpening,
    busy: function () { return !!chain || !!queue.length; } };
})(window);
