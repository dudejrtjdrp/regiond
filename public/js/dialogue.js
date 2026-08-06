/* dialogue.js — ★ §17-19(D-5) 대화창. 정본 스펙은 docs/탐험기획.md §18-6.
   화면 아래 가운데에 종이판 하나가 밀려 올라와, 말하는 이의 도트 초상 곁에서 글이 한 자씩 찍힌다.

   「왜」 창 하나를 따로 두나 — 지금까지 이야기가 나가는 길은 토스트(2초 뒤 사라짐)와
   모달(화면을 통째로 덮음)뿐이었다. 둘 다 「누군가 나에게 말을 건다」에는 맞지 않는다.
   토스트는 놓치면 그만이고, 모달은 지도를 가려 대화하는 동안 세상이 멎는다.
   대화창은 지도를 열어 둔 채 아래에서만 말한다 — 걷다가 말을 걸고, 말을 들으며 둘러본다.

   원칙 셋:
     ① 그림 파일 0장 — 초상은 atlas 의 절차 도트를 그대로 키운 것이다(image-rendering:pixelated).
     ② 수치는 자료가 쥔다 — 타자 속도·초상 크기·선택지 수는 data/world.json render.dialogue.
     ③ 서버는 한 줄도 바뀌지 않는다 — 선택지가 보내는 것은 기존 화이트리스트 명령뿐이다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  /* 자료가 닿지 않는 자리(구경 모드·옛 세이브)에서도 말은 나와야 한다 */
  var FALLBACK = { typeMs: 18, portraitSize: 88, maxChoices: 4 };
  /* 클릭·E·Space 가 「다음」이다 — 마우스를 쥔 손도, 걷던 손도 그대로 이어 간다 */
  var SKIP_KEYS = { e: 1, ' ': 1 };
  var NUM_KEYS = { 1: 1, 2: 2, 3: 3, 4: 4 };

  var cur = null;

  function cfg() {
    var c = (S && S.dialogueCfg) ? S.dialogueCfg() : null;
    return c || FALLBACK;
  }
  function root() { return U.qs('#dialogue-root'); }
  function isOpen() { return !!cur; }
  function line() { return (cur && cur.lines[cur.idx]) || ''; }

  /* ══════════ 열고 닫기 ══════════ */
  /**
   * 말을 건다. @param {object} o {speaker, portraitKey, lines:[...], choices:[{label,cmd?,payload?,act?}], onClose}
   * 「왜」 lines 를 배열로 받나 — 한 사람이 두세 마디를 잇는 것이 대화의 기본 단위이고,
   *   부르는 쪽이 창을 몇 번 여닫을지 세지 않아도 되게 하기 위해서다.
   */
  function open(o) {
    var host = root();
    if (!host || !o) return null;
    close();
    cur = newTalk(o);
    U.clear(host);
    host.appendChild(buildBox(o));
    document.body.classList.add('dialogue');
    if (GM.sfx) GM.sfx.play('open');
    startLine();
    return cur;
  }

  function newTalk(o) {
    /* 한 줄만 건네도(문자열) 여러 줄을 건네도(배열) 같은 문으로 들어온다 */
    var raw = [].concat(o.lines || o.line || []);
    var lines = raw.filter(function (t) { return t !== undefined && t !== null && String(t).length; })
                   .map(function (t) { return String(t); });
    return { lines: lines.length ? lines : ['…'], idx: 0, shown: 0, timer: 0, picked: false,
             choices: (o.choices || []).slice(0, cfg().maxChoices),
             onClose: o.onClose || null, speaker: o.speaker || '' };
  }

  /** 대화창을 접는다 — ESC · 마지막 줄 · 전투 경보가 모두 이 문으로 나간다 */
  function close() {
    if (!cur) return;
    var end = cur.onClose;
    stopTimer();
    cur = null;
    U.clear(root());
    document.body.classList.remove('dialogue');
    if (end) end();
  }

  /* ══════════ 판 짜기 ══════════ */
  function buildBox(o) {
    var box = U.el('div', 'dlg');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-live', 'polite');
    box.appendChild(U.el('div', 'dlg-name', cur.speaker || '누군가'));
    var body = U.el('div', 'dlg-body');
    body.appendChild(portrait(o.portraitKey));
    body.appendChild(textCol());
    box.appendChild(body);
    box.appendChild(U.el('span', 'dlg-next decor', '▼'));
    box.onclick = advance;
    cur.box = box;
    return box;
  }

  function textCol() {
    var col = U.el('div', 'dlg-text');
    cur.lineNode = U.el('p', 'dlg-line');
    cur.choiceNode = U.el('div', 'dlg-choices');
    col.appendChild(cur.lineNode);
    col.appendChild(cur.choiceNode);
    return col;
  }

  /* ★ 초상은 새로 그리지 않는다 — 지도 위를 걸어다니는 바로 그 도트를 키워 쓴다.
     외부 그림 한 장 없이 「그 사람의 얼굴」이 나오는 이유이고, 모양새를 바꾸면 초상도 함께 바뀐다. */
  function portrait(key) {
    var wrap = U.el('div', 'dlg-portrait decor');
    var im = portraitImg(String(key || ''));
    if (im) wrap.appendChild(im);
    return wrap;
  }

  function portraitImg(k) {
    var size = cfg().portraitSize;
    if (k === 'me') return faceOf(myLook(), size);
    if (k.indexOf('crew:') === 0) return faceOf(crewLook(k.slice(5)), size);
    if (k.indexOf('icon:') === 0) return GM.icons.img(k.slice(5), size);
    return GM.icons.img('person', size);
  }

  function faceOf(look, size) {
    if (!GM.atlas || !GM.atlas.avatarImg) return GM.icons.img('person', size);
    return GM.atlas.avatarImg(look || S.defaultAppearance(), size);
  }
  function myLook() {
    var mine = (S.S.avatars || []).filter(function (a) { return a && a.id === S.S.avatarId; })[0];
    return (mine && mine.appearance) || (S.S.you && S.S.you.appearance) || null;
  }
  function crewLook(id) {
    var c = S.companionById ? S.companionById(id) : null;
    return (c && c.appearance) || null;
  }

  /* ══════════ 타자기 ══════════ */
  /* ★ 「왜」 한 자씩 찍나 — 다 적힌 글은 읽는 것이지만, 찍히는 글은 **듣는 것**이다.
     그래서 건너뛰기를 반드시 붙인다(클릭·E·Space) — 두 번째 판부터는 아무도 기다리고 싶지 않다. */
  function startLine() {
    stopTimer();
    cur.shown = 0;
    paint();
    if (cfg().typeMs > 0) cur.timer = setInterval(step, cfg().typeMs);
    if (cfg().typeMs <= 0) fillLine();
  }

  function step() {
    if (!cur) return;
    cur.shown += 1;
    paint();
    if (cur.shown >= line().length) stopTimer();
  }

  function paint() {
    if (!cur || !cur.lineNode) return;
    cur.lineNode.textContent = line().slice(0, cur.shown);
    cur.box.classList.toggle('typed', cur.shown >= line().length);
  }

  function fillLine() {
    stopTimer();
    cur.shown = line().length;
    paint();
  }

  function stopTimer() {
    if (cur && cur.timer) clearInterval(cur.timer);
    if (cur) cur.timer = 0;
  }

  /* ══════════ 넘기기 ══════════ */
  /** 한 번은 「다 보여 줘」, 그다음은 「다음 줄」, 끝에서는 선택지 또는 닫기 */
  function advance() {
    if (!cur) return;
    if (cur.shown < line().length) { fillLine(); return; }
    if (cur.idx < cur.lines.length - 1) { nextLine(); return; }
    if (cur.choices.length) { showChoices(); return; }
    close();
  }

  function nextLine() {
    cur.idx += 1;
    startLine();
    if (GM.sfx) GM.sfx.play('tap');
  }

  function showChoices() {
    if (cur.picked) return;
    cur.picked = true;
    cur.choices.forEach(function (c, i) { cur.choiceNode.appendChild(choiceBtn(c, i)); });
  }

  function choiceBtn(c, i) {
    var b = U.btn((i + 1) + '. ' + (c.label || '…'), 'btn-small', function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      choose(i);
    });
    b.setAttribute('data-dlg-choice', String(i + 1));
    return b;
  }

  /**
   * ★ 서버 권위 — 선택의 결과는 여기서 셈하지 않는다.
   *   cmd 가 붙어 있으면 **기존 화이트리스트 명령 그대로** 보내고, 화면 일(창 열기 따위)은 act 가 맡는다.
   *   이 창 때문에 새로 생긴 명령은 하나도 없다.
   */
  function choose(i) {
    if (!cur || !cur.picked) return;
    var c = cur.choices[i];
    if (!c) return;
    if (GM.sfx) GM.sfx.play('click');
    if (c.cmd) GM.net.send(c.cmd, c.payload || {});
    close();
    if (c.act) c.act();
  }

  /* ══════════ 열쇠 ══════════ */
  /* ★ 「왜」 내리는 길목(capture)에서 받나 — input.js 는 문서 바닥에서 듣는다.
     여기서 먼저 잡아 삼키지 않으면 대화 중에 누른 E 가 도끼질로, Space 가 화면 이동으로 샌다. */
  function onKey(e) {
    if (!cur || typingInto(e)) return;
    var k = String(e.key || '').toLowerCase();
    if (SKIP_KEYS[k]) { advance(); swallow(e); return; }
    if (k === 'escape') { close(); swallow(e); return; }
    if (NUM_KEYS[k] && cur.picked) { choose(NUM_KEYS[k] - 1); swallow(e); }
  }

  /* 글을 적는 중이면(귀엣말 칸 따위) 열쇠는 그쪽 몫이다 — 「대」 를 치다가 창이 넘어가면 안 된다 */
  function typingInto(e) {
    var t = e.target || {};
    var tag = String(t.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || t.isContentEditable === true;
  }

  function swallow(e) {
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
  }

  document.addEventListener('keydown', onKey, true);

  GM.dialogue = {
    open: open, close: close, advance: advance, choose: choose, isOpen: isOpen,
    /* 하니스·회귀 검사 전용 — 지금 무엇이 떠 있는지 한눈에 */
    peek: function () {
      if (!cur) return null;
      return { speaker: cur.speaker, idx: cur.idx, total: cur.lines.length,
               shown: cur.lineNode ? cur.lineNode.textContent : '', full: line(),
               choices: cur.choices.length, picked: cur.picked };
    }
  };
})(window);
