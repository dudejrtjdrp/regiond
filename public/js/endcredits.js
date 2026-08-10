/* endcredits.js — ★ 매듭 뒤의 두 화면. 「제작자」와 「계속 플레이 하시겠습니까」.

   원칙 셋:
     ① 배경은 **홈 화면 그대로**다(assets/cutscene/title/main.png). 엔딩 전용 배경을 따로 두지
        않는 까닭 — 이 게임의 얼굴은 홈 일러스트 한 장이고, 마지막에 그 얼굴로 돌아오는 것이
        「끝이 아니라 매듭」이라는 이야기와 같은 말이기 때문이다.
     ② 홈 그림에는 메뉴 문구(새로하기·이어하기·멀티플레이)가 **구워져** 있다. 그 줄만 흐린 띠로
        덮고(.ec-hide), 우리 단추는 아래에 따로 세운다 — 로고(REGIOND)는 가리지 않는다.
     ③ 나가는 문은 셋뿐이고 전부 진짜로 동작한다: 이어하기(그대로 돌아간다) · 새로하기 ·
        게임종료. 「계속」이 기본값이다 — 엔딩은 게임을 끝내지 않는다(§세계관 W3 매듭형 엔딩).

   부르는 자리는 하나다 — story.js 가 엔딩 사슬(ending → ending_cookie)을 다 틀고 나서 부른다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var U = GM.ui;

  var CREDITS = {
    caption: '제작자',
    names: ['이성효', '강동현', '김대윤'],
    foot: '이 이야기는 끝이 아니라 매듭입니다.'
  };

  var root = null;      // #endcredits
  var stage = 0;        // 1 = 크레딧, 2 = 계속 묻기
  var holdTimer = 0;

  function play() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'endcredits';
    root.className = 'ec';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', '엔딩');

    var plate = document.createElement('div');
    plate.className = 'ec-plate';
    var hide = document.createElement('div');
    hide.className = 'ec-hide';           /* 그림에 구워진 메뉴 줄을 덮는 흐린 띠 */
    plate.appendChild(hide);
    root.appendChild(plate);

    var body = document.createElement('div');
    body.className = 'ec-body';
    root.appendChild(body);
    root.__body = body;

    document.body.appendChild(root);
    document.body.classList.add('cutscene');
    document.addEventListener('keydown', onKey, true);
    void root.offsetWidth;
    root.classList.add('show');

    showCredits();
  }

  /* ══════════ 1장 — 제작자 ══════════ */
  function showCredits() {
    stage = 1;
    var body = root.__body;
    U.clear(body);
    body.className = 'ec-body ec-credits';
    body.appendChild(U.el('p', 'ec-cap', CREDITS.caption));
    body.appendChild(U.el('p', 'ec-names', CREDITS.names.join('   ')));
    body.appendChild(U.el('p', 'ec-foot', CREDITS.foot + nationTail()));
    body.appendChild(U.el('p', 'ec-hint decor', '화면을 누르면 넘어갑니다'));
    fadeIn(body);
    root.onclick = showContinue;
    holdTimer = setTimeout(showContinue, 7000);
  }

  /** 「{나라이름}의 길은 계속됩니다」 — 나라 이름을 모르면 조용히 뺀다 */
  function nationTail() {
    var n = '';
    try { n = (GM.state && GM.state.nation && GM.state.nation().name) || ''; } catch (e) {}
    return n ? ' ' + n + '의 길은 계속됩니다.' : '';
  }

  /* ══════════ 2장 — 계속 플레이 하시겠습니까 ══════════ */
  function showContinue() {
    if (stage === 2) return;
    stage = 2;
    clearTimeout(holdTimer);
    holdTimer = 0;
    root.onclick = null;

    var body = root.__body;
    U.clear(body);
    body.className = 'ec-body ec-ask';
    body.appendChild(U.el('p', 'ec-q', '게임을 계속 플레이 하시겠습니까?'));

    var row = U.el('div', 'ec-row');
    row.appendChild(U.btn('이어하기', 'ec-btn', resume));
    row.appendChild(U.btn('새로하기', 'ec-btn', restart));
    row.appendChild(U.btn('게임종료', 'ec-btn', quit));
    body.appendChild(row);
    body.appendChild(U.el('p', 'ec-hint decor',
      '이어하기를 고르면 정착지로 돌아갑니다 — 나라는 그대로 자라고 있습니다.'));
    fadeIn(body);
    setTimeout(function () {
      var first = root && root.querySelector('.ec-btn');
      if (first) try { first.focus(); } catch (e) {}
    }, 60);
  }

  /* ══════════ 나가는 문 셋 ══════════ */
  /** 이어하기 — 판을 걷고 하던 자리로 돌아간다. 서버는 애초에 멈춘 적이 없다. */
  function resume() {
    close();
    if (GM.ui) GM.ui.toast('첫 매듭을 맺었습니다 — 길은 계속됩니다.', 'good', 6000);
  }

  /** 새로하기 — 타이틀로 되돌린다(주소는 그대로, 붙어 있던 방 번호만 턴다) */
  function restart() {
    close();
    try { localStorage.removeItem('gm.gameId'); } catch (e) {}
    global.location.href = global.location.pathname;
  }

  /** 게임종료 — 스크립트로 연 창이 아니면 브라우저가 close() 를 막는다. 그때는 타이틀로 물린다. */
  function quit() {
    close();
    try { global.close(); } catch (e) {}
    setTimeout(function () {
      if (!global.closed) global.location.href = global.location.pathname;
    }, 350);
  }

  /* ══════════ 잡일 ══════════ */
  function fadeIn(node) {
    node.classList.remove('in');
    void node.offsetWidth;
    node.classList.add('in');
  }

  function onKey(e) {
    if (!root) return;
    var k = String(e.key || '');
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); showContinue(); return; }
    if (stage === 1 && (k === 'Enter' || k === ' ')) {
      e.preventDefault(); e.stopPropagation();
      if (!e.repeat) showContinue();
    }
  }

  function close() {
    if (!root) return;
    clearTimeout(holdTimer);
    holdTimer = 0;
    document.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('cutscene');
    var r = root;
    root = null;
    stage = 0;
    r.classList.remove('show');
    setTimeout(function () { if (r.parentNode) r.parentNode.removeChild(r); }, 500);
  }

  GM.endcredits = {
    play: play,
    close: close,
    busy: function () { return !!root; },
    /* 하니스·회귀 검사 전용 */
    peek: function () { return root ? { stage: stage } : null; }
  };
})(window);
