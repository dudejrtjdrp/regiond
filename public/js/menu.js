/* menu.js — 통합 메뉴 (톱바 ☰ · Esc). ★ 4단계B.
   피드백: "화면 좌우에 UI가 너무 많다. 지속 기능은 내부 메뉴로, 화면에는 최소만."
   그래서 **늘 켜져 있을 까닭이 없는 것**은 전부 이 한 판으로 들어온다 —
   설정·도움말·연대기·도감·장비·솜씨·주민·방어·국법·유물함·발견 기록.
   화면에 남는 것은 지금 벌어지는 일(자원·날짜·위협·목표·원정)뿐이다.

   두 가지 원칙만 지킨다.
     ① 잠긴 것은 부재다(GDD3 §11-1) — 아직 안 열린 칸은 회색이 아니라 **아예 없다**.
     ② 단축키는 사라지지 않는다 — 칸마다 제 키를 적어 두고, 아래에 표로 한 번 더 모은다.
        (메뉴는 길을 하나 더 내는 것이지, 손에 익은 길을 막는 것이 아니다.) */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var openBack = null;

  /* 한 칸 = 이름 · 단축키 · 아이콘 · 열쇠(uiOn, 없으면 늘 열림) · 부를 곳(mod.fn).
     손잡이를 이름으로 적어 두는 까닭: 이 파일이 남의 파일 로드 차례를 붙들지 않게,
     그리고 아직 안 실린 모듈의 칸은 **없는 것으로** 칠 수 있게 하기 위해서다. */
  var ENTRIES = [
    { label: '설정',         hot: 'Esc', icon: 'gear',   ui: null,               mod: 'settings',   fn: 'open',
      tip: '화면 밝기와 소리 크기를 고칩니다.' },
    { label: '도움말',       hot: null,  icon: 'scroll', ui: null,               mod: 'hud',        fn: 'openHelp',
      tip: '걷기·일하기·건설부터 함께 하기까지 한 번에 읽습니다.' },
    { label: '연대기',       hot: 'L',   icon: 'book',   ui: null,               mod: 'chronicle',  fn: 'open',
      tip: '정착지가 지나온 길을 모아 둡니다.' },
    { label: '주민',         hot: 'P',   icon: 'folk',   ui: 'panel.residents',  mod: 'residents',  fn: 'openPanel',
      tip: '주민을 고르고 일터를 지정합니다.' },
    { label: '솜씨',         hot: 'K',   icon: 'tools',  ui: 'panel.skills',     mod: 'skills',     fn: 'open',
      tip: '농사·벌목·채광·건설·전투 다섯 가지가 얼마나 올랐는지 봅니다.' },
    { label: '도감',         hot: 'J',   icon: 'book',   ui: 'panel.codex',      mod: 'codex',      fn: 'open',
      tip: '만난 것과 잡은 것, 뒤진 유적을 모아 둡니다.' },
    { label: '내 몸과 장비', hot: 'C',   icon: 'anvil',  ui: 'panel.equipment',  mod: 'equip',      fn: 'open',
      tip: '능력치를 나눠 주고 무기와 방어구를 만듭니다.' },
    { label: '방어',         hot: 'V',   icon: 'shield', ui: 'hud.threat',       mod: 'combat',     fn: 'openThreat',
      tip: '울타리·터렛·민병이 다음 무리를 얼마나 버티는지 봅니다.' },
    { label: '국법',         hot: null,  icon: 'scroll', ui: 'panel.orders',     mod: 'orders',     fn: 'open',
      tip: '자리를 비운 사이 정착지가 따를 지침입니다.' },
    { label: '유물함',       hot: 'I',   icon: 'gem',    ui: 'panel.relic',      mod: 'artifacts',  fn: 'open',
      tip: '땅이 내어준 것들을 꺼내 봅니다.' },
    { label: '발견 기록',    hot: null,  icon: 'eye',    ui: null,               mod: 'artifacts',  fn: 'openJournal',
      tip: '유적에서 읽은 전설과 단서를 다시 읽습니다.' }
  ];

  /* 손에 익은 키는 메뉴가 생겼다고 사라지지 않는다 — 여기 한 번에 모아 둔다. */
  var HOTKEYS = [
    ['W A S D', '걷는다'],
    ['E', '캐고 짓고 말을 건다 (누르고 있으면 계속)'],
    ['Q', '짐승을 데려온다'],
    ['B / F', '건설 · 울타리'],
    ['P / K / J', '주민 · 솜씨 · 도감'],
    ['C / V / L', '내 몸과 장비 · 방어 · 연대기'],
    ['I', '유물 보관함 (같은 키로 닫는다)'],
    ['M / Enter', '명부 접기·펴기 · 한 줄 건네기'],
    ['H / Space', '정착지로 · 나에게'],
    ['방향키', '시선을 옮긴다'],
    ['+ / -', '가까이 · 멀리'],
    ['Esc', '고른 것을 물리고, 없으면 이 메뉴']
  ];

  /** 아직 안 실린 모듈의 칸은 없는 것으로 친다(개발 화면·검사판에서도 판이 선다) */
  function handler(e) {
    var mod = GM[e.mod];
    return mod && typeof mod[e.fn] === 'function' ? mod[e.fn] : null;
  }

  /** 지금 문이 열려 있는 칸만 남긴다 — 잠긴 칸은 회색이 아니라 없다(§11-1) */
  function usable(e) {
    if (e.ui && !(S && S.uiOn && S.uiOn(e.ui))) return false;
    return !!handler(e);
  }

  function cell(e) {
    var b = U.el('button', 'gmenu-item');
    b.type = 'button';
    b.setAttribute('data-menu', e.mod + '.' + e.fn);
    if (GM.icons && GM.icons.img) b.appendChild(GM.icons.img(e.icon, 26));
    b.appendChild(U.el('span', 'gmenu-lb', e.label));
    if (e.hot) b.appendChild(U.el('span', 'gmenu-hot', e.hot));
    U.tipSet(b, e.label + (e.hot ? ' (' + e.hot + ')' : ''), e.tip || '');
    /* 메뉴는 문간이다 — 열어 주고 저는 비켜선다(창이 창 위에 겹쳐 쌓이지 않게). */
    b.onclick = function () {
      var run = handler(e);
      close();
      if (run) run();
    };
    return b;
  }

  function buildBody() {
    var body = U.el('div', 'gmenu');
    var grid = U.el('div', 'gmenu-grid');
    var n = 0;
    ENTRIES.forEach(function (e) { if (usable(e)) { grid.appendChild(cell(e)); n++; } });
    body.appendChild(grid);
    if (!n) body.appendChild(U.el('p', 'hint', '아직 열린 것이 없습니다. 정착지가 자라면 여기에 하나씩 늘어납니다.'));

    var keys = U.el('div', 'gmenu-keys');
    keys.appendChild(U.el('h3', 'sec-title', '손에 익히면 빠른 키'));
    var tbl = U.el('table', 'gmenu-keytbl');
    var tbody = U.el('tbody');
    HOTKEYS.forEach(function (r) {
      var tr = U.el('tr');
      tr.appendChild(U.el('th', null, r[0]));
      tr.appendChild(U.el('td', null, r[1]));
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    keys.appendChild(tbl);
    body.appendChild(keys);
    return body;
  }

  /** 같은 손잡이로 열고 닫는다(☰ 도 Esc 도) */
  function open() {
    if (openBack) { close(); return null; }
    openBack = U.openModal({
      title: '메뉴', width: '560px', key: 'menu',
      icon: GM.icons && GM.icons.img ? GM.icons.img('scroll', 22) : null,
      body: buildBody(),
      footer: U.btn('닫는다', 'btn-primary', function () { close(); }),
      onClose: function () { openBack = null; }
    });
    if (GM.sfx) GM.sfx.play('page');
    return openBack;
  }

  function close() {
    if (!openBack) return;
    var b = openBack;
    openBack = null;
    U.closeModal(b);
  }

  function isOpen() { return !!openBack; }

  GM.menu = { open: open, close: close, isOpen: isOpen, entries: ENTRIES, hotkeys: HOTKEYS };
})(window);
