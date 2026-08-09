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
  /* 대화는 Enter로만 넘긴다. E를 누른 채 대화가 열려도 여러 문장이 지나가지 않게 한다. */
  var SKIP_KEYS = { enter: 1 };
  var NUM_KEYS = { 1: 1, 2: 2, 3: 3, 4: 4 };

  var cur = null;

  /* ★ 말하는 이는 왼쪽, 답하는 이는 오른쪽.
     「왜」 부르는 쪽에 맡기지 않나 — 한 마디마다 open() 이 새로 불리는 구조라(story.js 는 장면을
     onClose 로 잇는다) 부르는 자리마다 side 를 적어 두면 같은 대화가 두 손에서 갈라진다.
     그래서 **자리는 이 파일이 기억한다**: 한 판에서 처음 입을 연 사람이 왼쪽을 잡고,
     다른 사람이 받으면 오른쪽에 선다. 판이 끊기면 기억도 함께 지운다. */
  var exchange = { first: '', linked: false, until: 0 };

  function whoOf(o) { return String(o.speaker || o.portraitKey || '?'); }

  function sideFor(o) {
    if (o.side === 'left' || o.side === 'right') return o.side;   /* 부르는 쪽이 못박으면 그대로 */
    var who = whoOf(o);
    var goes_on = exchange.linked || Date.now() < exchange.until;
    if (!goes_on || !exchange.first) exchange.first = who;
    return who === exchange.first ? 'left' : 'right';
  }

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
    /* 대화가 상호작용(E) 중에 열릴 수 있으므로, 기존 홀드 작업을 먼저 끊는다. */
    if (GM.swing) GM.swing.stopHold();
    if (GM.input && GM.input.stopMovement) GM.input.stopMovement();
    else if (GM.avatar && GM.avatar.stop) GM.avatar.stop();
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
             onClose: o.onClose || null, speaker: o.speaker || '',
             portraitKey: o.portraitKey || '', side: sideFor(o) };
  }

  /** 대화창을 접는다 — ESC · 마지막 줄 · 전투 경보가 모두 이 문으로 나간다 */
  function close() {
    if (!cur) return;
    var end = cur.onClose;
    stopTimer();
    cur = null;
    U.clear(root());
    document.body.classList.remove('dialogue');
    if (!end) { exchange.first = ''; exchange.until = 0; return; }
    /* onClose 안에서 곧바로 다음 장면이 열리면 같은 판이다 — 그때만 자리 기억을 잇는다 */
    exchange.linked = true;
    try { end(); } finally { exchange.linked = false; }
    if (!cur) { exchange.first = ''; exchange.until = 0; }
  }

  /* ══════════ 판 짜기 ══════════ */
  function buildBox(o) {
    var box = U.el('div', 'dlg');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-live', 'polite');
    box.classList.add('dlg-cinematic', 'dlg-' + cur.side);
    var scene = document.createElement('img');
    scene.className = 'dlg-scene decor';
    scene.src = scenePath(sceneKey(cur.portraitKey, cur.speaker));
    scene.alt = '';
    scene.setAttribute('aria-hidden', 'true');
    /* Each supplied plate has its own native ratio.  Preserve it instead of
       stretching the character to a generic dialogue-box ratio. */
    scene.onload = function () {
      if (scene.naturalWidth && scene.naturalHeight) {
        box.style.aspectRatio = scene.naturalWidth + ' / ' + scene.naturalHeight;
      }
    };
    box.appendChild(scene);
    box.appendChild(U.el('div', 'dlg-name', cur.speaker || '누군가'));
    var body = U.el('div', 'dlg-body');
    body.appendChild(textCol());
    box.appendChild(body);
    box.appendChild(U.el('span', 'dlg-next decor', '▼'));
    box.onclick = advance;
    cur.box = box;
    return box;
  }

  /* The supplied plates include the full character and frame.  Mirroring
     only the visual layer keeps Korean text and choice buttons readable. */
  function scenePath(key) { return 'assets/dialogue/portraits-transparent/' + key + '.png?v=2'; }

  /* ★ 관제 여섯의 판은 캐릭터 시트(assets/characters/<역할>/sheet.png)와 **같은 사람**이다.
     대화창 얼굴과 프로필 얼굴이 어긋나면 「누가 말하는지」가 무너진다. 국방(붉은 머리)은
     받은 판 여덟 장에 없어 시트 정면을 액자에 세워 red_general.png 를 새로 지었다.
     남는 셋(green_prince·elf_queen·black_kimono)은 관제가 아닌 바깥 사람들 몫이다. */
  var OFFICER = { farm: 'blue_mage', factory: 'raider', build: 'young_lord',
                  defense: 'red_general', trade: 'blue_knight', saint: 'white_priestess' };

  function sceneKey(key, speaker) {
    var k = String(key || '') + ' ' + String(speaker || '');
    if (/crew:farm|\bfarm\b|농정/.test(k)) return OFFICER.farm;
    if (/crew:factory|\bfactory\b|공장/.test(k)) return OFFICER.factory;
    if (/crew:build|\bbuild\b|건축/.test(k)) return OFFICER.build;
    if (/crew:defense|\bdefense\b|국방/.test(k)) return OFFICER.defense;
    if (/crew:trade|\btrade\b|외교/.test(k)) return OFFICER.trade;
    if (/crew:saint|\bsaint\b|성녀/.test(k)) return OFFICER.saint;
    if (/세라|sara|crew:/.test(k)) return OFFICER.farm;
    if (/왕|king|lord|me\b/.test(k)) return OFFICER.build;
    if (/외교|diplom|ship|교역/.test(k)) return 'green_prince';
    if (/추적|trail|bandit|산적/.test(k)) return OFFICER.factory;
    if (/성지|shrine|gem|땅/.test(k)) return OFFICER.saint;
    /* 이름 없는 손님들은 바깥 사람 셋 중에서 이름값으로 고른다 — 같은 이름은 늘 같은 얼굴이다 */
    var choices = ['green_prince', 'elf_queen', 'black_kimono'];
    var hash = 0;
    for (var i = 0; i < k.length; i++) hash = ((hash * 31) + k.charCodeAt(i)) >>> 0;
    return choices[hash % choices.length];
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
    /* 고른 답에 서버가 늦게 대답하는 길(흔적 조사 등)도 같은 판이다 — 잠깐 자리를 붙들어 둔다 */
    exchange.until = Date.now() + 8000;
    if (c.act) c.act();
  }

  /* ══════════ 열쇠 ══════════ */
  /* ★ 「왜」 내리는 길목(capture)에서 받나 — input.js 는 문서 바닥에서 듣는다.
     여기서 먼저 잡아 삼키지 않으면 대화 중에 누른 E 가 도끼질로, Space 가 화면 이동으로 샌다. */
  function onKey(e) {
    if (!cur || typingInto(e)) return;
    var k = String(e.key || '').toLowerCase();
    /* 대화가 열린 동안 E/Space는 월드 상호작용으로 새지 않되, 대화를 넘기지도 않는다. */
    if (k === 'e' || k === ' ') { swallow(e); return; }
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
