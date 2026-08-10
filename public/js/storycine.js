/* storycine.js — ★ 일러스트 컷신 재생기 (docs/연출/스토리_연출_이미지.html 이 정본).
   대화창(dialogue.js)이 「지도를 열어 둔 채 아래에서 말하는」 그릇이라면, 이 모듈은
   「화면을 통째로 내어주는」 그릇이다 — 도입(왕도·알현실·여정)과 용의 등장처럼
   일러스트 한 장이 곧 말인 장면만 여기로 온다.

   원칙 둘:
     ① 장면 자료는 밖에서 온다 — 도입은 data/story.json(서버가 bg 를 실어 보낸다),
        용은 아래 DRAGON 상수 하나뿐이다. 이 파일은 순서와 페이드만 안다.
     ② 언제든 나갈 수 있다 — [건너뛰기]·Esc 는 남은 장면 전부를 접는다(§0-1 모든 연출은 스킵 가능). */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var U = GM.ui;

  var cur = null;   // {scenes, idx, onEnd, auto, els, timer, holdTimer, shown}

  /* ★ §19-F2(F07-4) — 용의 등장. 평화롭던 하늘이 어두워지고, 그 틈으로 날개가 온다.
     굴 경고(dragonWarn)가 한 나라에 한 번뿐이므로 이 연출도 한 번뿐이다. */
  var DRAGON = [
    { bg: 'assets/cutscene/dragon/peace.png',
      text: '이 땅은 오래도록 고요했다.', hold: 2400 },
    { bg: 'assets/cutscene/dragon/dark.png', slow: true, sfx: 'warn',
      text: '…그 고요가 무겁게 가라앉는다. 재 섞인 바람이 해를 삼킨다.', hold: 2800 },
    { bg: 'assets/cutscene/dragon/appear.png', shake: true, sfx: 'deny',
      text: '살아 있는 것이 있다 — 잿빛 하늘을 가르는, 세상에 한 마리뿐인 날개.', hold: 3200 }
  ];

  /* ★ 작업2 — 용을 잡았을 때의 연출(처치). 굴 경고(DRAGON)와 짝을 이루는 두 번째 장면이다.
     에셋은 assets/cutscene/dragon/ 아래 slain.png · rest.png 두 장을 기대한다(아직 없다면
     preload/onerror 폴백이 조용히 감추고 글만 흘러간다 — 아래 next_() 참고).
     문구는 데이터가 아니라 여기 고정 문구를 쓴다: 서버(slayDragon)는 discovery 기록만 남기고
     연출 문구는 화면이 쥔다고 dragon.js 머리말이 이미 정해 두었다(§20-R3). */
  var DRAGON_SLAIN = [
    { bg: 'assets/cutscene/dragon/slain.png', bgAlt: 'assets/cutscene/dragon/appear.png',
      shake: true, sfx: 'fanfare',
      text: '거대한 몸이 대지를 울리며 쓰러진다 — 세상에 하나뿐이던 것이 마침내 눕는다.', hold: 3200 },
    { bg: 'assets/cutscene/dragon/rest.png', bgAlt: 'assets/cutscene/dragon/peace.png',
      text: '재 섞인 바람이 걷히고, 땅에는 낯선 고요가 내려앉는다.', hold: 2600 }
  ];

  /* ★ 용이 정착지로 내려오는 장 — 등장(DRAGON)과 처치(DRAGON_SLAIN) 사이의 한 폭. */
  var DRAGON_ARRIVE = [
    { bg: 'assets/cutscene/dragon/dark.png', slow: true, sfx: 'warn',
      text: '날개 그림자가 우리 지붕 위를 지난다.', hold: 2400 },
    { bg: 'assets/cutscene/dragon/appear.png', shake: true, sfx: 'alarm',
      text: '그것이 마을로 내려온다 — 담장도, 문도 셈에 넣지 않는다.', hold: 3000 }
  ];

  function preload(scenes) {
    (scenes || []).forEach(function (s) {
      /* ★ 작업2 — 앞서 읽어 보는 것뿐이라 실패해도 조용히 넘어간다(브라우저 콘솔에 404만 남는다).
         onerror 를 달아 두는 건 다음 next_() 가 만드는 진짜 <img> 가 아니라 이 프리로드용이라 —
         굳이 막을 판정이 없다. 여기서는 그냥 실패를 삼킨다. */
      if (s && s.bg) { var im = new Image(); im.onerror = function () {}; im.src = s.bg; }
    });
  }

  /**
   * 컷신을 튼다. @param scenes [{bg, text, speaker, hold?, slow?, shake?, sfx?}]
   * @param opts {onEnd, auto} — auto 면 글이 다 찍힌 뒤 hold 만큼 쉬고 저절로 넘어간다.
   */
  function play(scenes, opts) {
    opts = opts || {};
    scenes = (scenes || []).filter(function (s) { return s && (s.bg || s.text); });
    if (!scenes.length) { if (opts.onEnd) opts.onEnd(); return; }
    var root = U.qs('#cutscene-root');
    if (!root) { if (opts.onEnd) opts.onEnd(); return; }
    finish(true);                       // 겹쳐 틀지 않는다 — 앞 판은 조용히 접는다
    preload(scenes);

    U.clear(root);
    var wrap = U.el('div', 'cine');
    var stage = U.el('div', 'cine-stage');
    wrap.appendChild(stage);
    var textBox = U.el('div', 'cine-textbox');
    var nameEl = U.el('div', 'cine-name');
    var lineEl = U.el('p', 'cine-line');
    var next = U.el('span', 'cine-next decor', '▼');
    textBox.appendChild(nameEl);
    textBox.appendChild(lineEl);
    textBox.appendChild(next);
    wrap.appendChild(textBox);
    var skip = U.btn('건너뛰기 ▶', 'cine-skip', function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      finish();
    });
    wrap.appendChild(skip);
    root.appendChild(wrap);
    document.body.classList.add('cutscene');

    cur = { scenes: scenes, idx: -1, onEnd: opts.onEnd || null, auto: !!opts.auto,
            els: { root: root, wrap: wrap, stage: stage, name: nameEl, line: lineEl },
            timer: 0, holdTimer: 0, shown: 0, img: null, form: null, askInput: null };
    wrap.onclick = advance;
    document.addEventListener('keydown', onKey, true);
    next_();
    return cur;
  }

  function scene() { return cur && cur.scenes[cur.idx]; }
  function lineText() { var s = scene(); return (s && s.text) || ''; }

  function next_() {
    if (!cur) return;
    /* 다른 손(오프닝 등)이 #cutscene-root 를 비웠다면 판이 사라진 것이다 — 조용히 끝을 물린다.
       onEnd 는 그대로 부른다: 이야기 사슬(story.js)이 여기서 끊기면 안 된다. */
    if (cur.els.wrap && !cur.els.wrap.isConnected) { finish(); return; }
    stopTimers();
    cur.idx += 1;
    if (cur.idx >= cur.scenes.length) { finish(); return; }
    var s = cur.scenes[cur.idx];

    /* 그림 — 새 장을 위에 얹고 스르르 나타낸다(앞 장은 페이드가 끝나면 걷는다).
       ★ 같은 그림이 이어지는 장(알현실 문답처럼 글만 넘어가는 흐름 — 연출 HTML 원안)은
       그림을 건드리지 않는다: 사진은 그대로, 아래 글만 흘러간다. */
    if (s.bg && !(cur.img && cur.bgSrc === s.bg)) {
      var im = document.createElement('img');
      im.className = 'cine-img' + (s.slow ? ' slow' : '');
      im.alt = '';
      /* ★ 작업2 — 그림이 없거나 로드를 실패해도 컷신은 멈추지 않는다: 깨진 이미지 아이콘 대신
         조용히 감추고, 글자와 hold/자동 넘김 타이머는 그대로 흘러간다(둘 다 로드 이벤트를
         기다리지 않으므로 onEnd 는 이미 반드시 불린다 — 이 핸들러는 눈에 보이는 것만 고친다). */
      im.onerror = function () {
        /* 대체 그림이 있으면 한 번 더 시도하고, 그것도 없으면 조용히 감춘다. */
        if (s.bgAlt && im.src.indexOf(s.bgAlt) < 0) { im.src = s.bgAlt; return; }
        im.style.visibility = 'hidden';
      };
      im.src = s.bg;
      var old = cur.img;
      cur.img = im;
      cur.bgSrc = s.bg;
      cur.els.stage.appendChild(im);
      /* 강제 리플로우 뒤 .show — transition 이 첫 프레임을 건너뛰지 않게 */
      void im.offsetWidth;
      im.classList.add('show');
      if (old) {
        (function (o, ms) { setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); }, ms); })(old, s.slow ? 2100 : 1000);
      }
    }
    cur.els.wrap.classList.toggle('shake', !!s.shake);
    /* ★ 자막 가리개(mask) — 엔딩 일러스트에는 한국어 자막이 **그림에 구워져** 있다. 그 자리를
       불투명한 띠로 덮고, 그 위에 서버가 치환을 마친 진짜 대사({name}·{lord})를 찍는다.
       「왜」 그림을 고치지 않나 — 그림은 원본 그대로 두어야 나중에 문구만 고칠 수 있다. */
    cur.els.wrap.classList.toggle('masked', !!s.mask);
    /* ★ 글 자리 — layout:center 면 화면 한가운데로(도착·이름 묻기, 연출 사양의 마지막 두 장) */
    cur.els.wrap.classList.toggle('center', s.layout === 'center');
    cur.els.wrap.classList.toggle('ask', !!s.ask);
    if (cur.form) { try { cur.form.parentNode.removeChild(cur.form); } catch (e) {} cur.form = null; cur.askInput = null; }
    if (s.sfx && GM.sfx) GM.sfx.play(s.sfx);

    /* 글 — 타자기. 화자가 있으면 이름표를 세운다.
       ★ 글 없는 장(왕도 원경 같은 「보여 주기만 하는」 장)은 잠깐 머물다 저절로 넘어간다. */
    cur.els.name.textContent = s.speaker || '';
    cur.els.name.style.display = s.speaker ? '' : 'none';
    cur.els.wrap.classList.toggle('notext', !s.text);
    cur.shown = 0;
    paint();
    if (!s.text) { cur.holdTimer = setTimeout(next_, s.hold || 2200); return; }
    cur.timer = setInterval(step, 26);
  }

  /* ══════════ ★ 이름 묻기(ask:name) — 「새로운 시작을 알릴 그대의 이름은 무엇인가?」 ══════════
     건국 때 앉힌 이름이 미리 적혀 있고, 고쳐 적으면 christen 명령으로 세계의 정본(아바타·명부·
     나라 가칭)이 함께 따라온다. [건너뛰기]로 나가면 지금 이름 그대로다 — 물음은 강요가 아니다. */
  function mountAsk() {
    if (!cur || cur.form) return;
    var form = U.el('div', 'cine-ask');
    form.onclick = function (e) { if (e && e.stopPropagation) e.stopPropagation(); };
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.maxLength = 16;
    inp.className = 'cine-ask-in';
    inp.placeholder = '이름 입력창';
    var pre = '';
    try {
      var p = GM.state && GM.state.player && GM.state.player();
      pre = (p && p.name) || localStorage.getItem('gm.playerName') || '';
    } catch (e) {}
    inp.value = pre;
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); confirmAsk(); }
      e.stopPropagation();               /* Space·E 가 컷신·월드로 새지 않는다 */
    });
    var okBtn = U.btn('이 이름으로 시작한다', 'cine-ask-go', function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      confirmAsk();
    });
    form.appendChild(inp);
    form.appendChild(okBtn);
    cur.els.wrap.appendChild(form);
    cur.form = form;
    cur.askInput = inp;
    setTimeout(function () { try { inp.focus(); inp.select(); } catch (e) {} }, 80);
  }

  function confirmAsk() {
    if (!cur || !cur.askInput) return;
    var name = String(cur.askInput.value || '').trim().slice(0, 16);
    if (!name) { try { cur.askInput.focus(); } catch (e) {} return; }
    var prev = '';
    try {
      var p = GM.state && GM.state.player && GM.state.player();
      prev = (p && p.name) || '';
    } catch (e) {}
    if (GM.net && GM.net.send && name !== prev) {
      GM.net.send('christen', { name: name });
      try { localStorage.setItem('gm.playerName', name); } catch (e) {}
    }
    if (GM.sfx) GM.sfx.play('unlock');
    var f = cur.form;
    cur.form = null; cur.askInput = null;
    if (f) { try { f.parentNode.removeChild(f); } catch (e) {} }
    next_();
  }

  function step() {
    if (!cur) return;
    if (cur.els.wrap && !cur.els.wrap.isConnected) { finish(); return; }
    cur.shown += 1;
    paint();
    if (cur.shown >= lineText().length) {
      clearInterval(cur.timer); cur.timer = 0;
      afterTyped();
    }
  }

  function paint() {
    if (!cur) return;
    cur.els.line.textContent = lineText().slice(0, cur.shown);
    cur.els.wrap.classList.toggle('typed', cur.shown >= lineText().length);
  }

  /* 다 찍혔다 — 이름 묻는 장이면 입력창을 세우고, 자동이면 hold 만큼 쉬고 저절로 넘어간다 */
  function afterTyped() {
    if (!cur) return;
    var s = scene();
    if (s && s.ask === 'name') { mountAsk(); return; }   /* 물음은 답을 기다린다 */
    if (!cur.auto) return;
    cur.holdTimer = setTimeout(next_, (s && s.hold) || 2400);
  }

  function advance() {
    if (!cur) return;
    if (cur.shown < lineText().length) {   // 한 번은 「다 보여 줘」
      clearInterval(cur.timer); cur.timer = 0;
      cur.shown = lineText().length;
      paint();
      afterTyped();
      return;
    }
    var s = scene();
    if (s && s.ask) { if (cur.askInput) try { cur.askInput.focus(); } catch (e) {} return; }
    next_();                               // 그다음은 「다음 장면」
  }

  function stopTimers() {
    if (!cur) return;
    if (cur.timer) clearInterval(cur.timer);
    if (cur.holdTimer) clearTimeout(cur.holdTimer);
    cur.timer = 0; cur.holdTimer = 0;
  }

  function onKey(e) {
    if (!cur) return;
    /* 이름을 적는 중이면 열쇠는 입력창 몫이다 — Enter 는 입력창의 keydown 이 받는다 */
    var t = e.target || {};
    if (String(t.tagName || '').toLowerCase() === 'input') {
      if (String(e.key || '') === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); }
      return;
    }
    var k = String(e.key || '');
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); return; }
    if (k === 'Enter' || k === ' ') {
      e.preventDefault(); e.stopPropagation();
      if (!e.repeat) advance();
    }
  }

  /** 끝 — 건너뛰든 끝까지 보든 이 문 하나로 나간다. onEnd 는 꼭 한 번만 부른다. */
  function finish(silent) {
    if (!cur) return;
    stopTimers();
    var end = cur.onEnd;
    var root = cur.els.root;
    cur = null;
    document.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('cutscene');
    if (root) U.clear(root);
    if (!silent && end) end();
  }

  GM.storycine = {
    play: play,
    finish: finish,
    busy: function () { return !!cur; },
    DRAGON: DRAGON,
    /* ★ 작업2 — 처치 연출. 호출부(예: p.boss 를 받는 곳)가 GM.storycine.play(GM.storycine.DRAGON_SLAIN,
       {auto:true, onEnd:...}) 로 튼다. avatar.js 의 dragonWarn 처리(:394)와 같은 문이다. */
    DRAGON_SLAIN: DRAGON_SLAIN,
    DRAGON_ARRIVE: DRAGON_ARRIVE,
    /* 하니스·회귀 검사 전용 */
    peek: function () {
      if (!cur) return null;
      return { idx: cur.idx, total: cur.scenes.length,
               bg: (scene() && scene().bg) || '', text: lineText() };
    }
  };
})(window);
