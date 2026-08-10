/* artifacts.js — 유물함(모달) + 상자 여는 연출 */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;
  var JOURNAL_BASE = 'regiond.artifact-journal.v1';
  var ROOMS_KEY = JOURNAL_BASE + '.rooms';       /* 이 기기가 들렀던 방 목록(최근 순) */
  var KEEP_ROOMS = 8;                            /* 기기에 남겨 두는 방의 수 */

  /* ★ 발견 기록은 **그 방의 기억**이다(2026-08).
     「왜」 방마다 나누나 — 예전에는 키 하나(JOURNAL_BASE)에 모아 두어, 새 방을 파고 들어가도
     지난 판에서 읽은 전설이 그대로 차 있었다. 기록은 서버의 소유 장부가 아니라 「내가 읽은 문장」이라
     기기에 남기는 것이 맞지만, 판이 다르면 읽은 적도 없는 것이 된다. 그래서 방 이름(gameId)으로 칸을 가른다.
     방을 모르는 자리(로비·구경)에서는 어디에도 적지 않는다 — 다음 방으로 새지 않게. */
  function roomId() {
    var g = S && S.S ? S.S.gameId : null;
    return g ? String(g) : '';
  }
  function journalKey() {
    var g = roomId();
    return g ? JOURNAL_BASE + ':' + g : '';
  }

  /** 옛 전역 키를 걷어내고, 오래된 방의 기록은 흘려보낸다(기기 저장칸은 좁다) */
  function touchRoom(g) {
    try {
      global.localStorage.removeItem(JOURNAL_BASE);      /* 방 구분이 없던 시절의 키 */
      var rooms = [];
      try { rooms = JSON.parse(global.localStorage.getItem(ROOMS_KEY) || '[]') || []; } catch (e0) { rooms = []; }
      rooms = rooms.filter(function (r) { return r && r !== g; });
      rooms.unshift(g);
      rooms.slice(KEEP_ROOMS).forEach(function (old) {
        global.localStorage.removeItem(JOURNAL_BASE + ':' + old);
      });
      global.localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms.slice(0, KEEP_ROOMS)));
    } catch (e) {}
  }

  /* 서버의 유물 소유 정보와 분리해, 플레이어가 실제로 읽은 발견 문장만 보관한다. */
  function journal() {
    var k = journalKey();
    if (!k) return [];
    try { return JSON.parse(global.localStorage.getItem(k) || '[]'); }
    catch (e) { return []; }
  }
  function saveJournal(rows) {
    var g = roomId();
    if (!g) return;                                     /* 방을 모르면 적지 않는다 */
    touchRoom(g);
    try { global.localStorage.setItem(JOURNAL_BASE + ':' + g, JSON.stringify(rows.slice(-80))); }
    catch (e) {}
  }
  function remember(found) {
    if (!found || !found.key) return;
    var rows = journal();
    var row = { key: found.key, name: found.artifact || found.key, grade: found.grade || 'common',
      source: found.role || found.source || '', effect: found.effect || '', narrative: taleOf(found) };
    var last = rows[rows.length - 1];
    /* 표현 보강 push가 같은 발견을 다시 보내도 기록은 중복하지 않는다. */
    if (last && last.key === row.key && last.narrative === row.narrative && last.source === row.source) return;
    rows.push(row);
    saveJournal(rows);
  }

  function defOf(key) {
    var d = S.artifactDef(key);
    if (d) return d;
    return { key: key, name: key, grade: 'common', type: 'permanent', desc: '' };
  }

  function rememberLore(lore, place) {
    if (!lore || !lore.id) return;
    var rows = journal();
    var key = 'lore:' + lore.id;
    if (rows.some(function (row) { return row.key === key; })) return;
    rows.push({ key: key, name: lore.title || '탐험 기록', grade: 'common', source: place || '유적 탐사',
      effect: '', narrative: (lore.lines || []).join('\n'), lore: true });
    saveJournal(rows);
  }
  function itemDef(a) {
    if (a && a.name) return a;
    var d = defOf(a && a.key);
    return { key: a && a.key, name: d.name, grade: d.grade, type: d.type, desc: d.desc };
  }
  function gradeCls(g) { return S.gradeInfo(g).cls; }
  function gradeName(g) { return S.gradeInfo(g).name; }
  function gradeColor(g) { return S.gradeInfo(g).color; }
  function artwork(key, px, cls) {
    var im = document.createElement('img');
    im.src = 'assets/artifact/' + encodeURIComponent(key || 'crown_shard') + '/base.png?v=artifact-set-1';
    im.width = px; im.height = px; im.alt = '';
    im.className = cls || 'art-icon';
    im.style.imageRendering = 'pixelated';
    return im;
  }

  /* ★ 2026-08 — 보관함의 문은 1장부터 열려 있다(data/chapters.json 1장 ui: panel.relic).
     「왜」 어전(panel.council)에서 떼어 냈나 — 유적은 첫 장부터 유물을 내어 준다. 손에 든 것을
     9장까지 볼 수도 쓸 수도 없다면, 그건 「아직」이 아니라 「없는 것」이다(서버는 이미 useArtifact 를
     앞 장부터 받는다 — progression.commandUnlocked). 어전 회의와 나머지 문은 차례 그대로다.
     (옛 세이브는 state.js UI_ALIAS 가 panel.council 로 같은 문을 열어 준다) */
  function relicOn() { return S.uiOn('panel.relic'); }

  function open() {
    if (!relicOn()) {
      U.toast('보관함은 아직 열리지 않았습니다. 발견 기록(📖)은 지금도 볼 수 있습니다.', 'warn', 5200);
      return;
    }
    var body = U.el('div');
    body.appendChild(U.el('p', null,
      '유적과 신전이 내어준 것, 어전 회의가 열어 준 상자가 여기 모입니다.'));
    body.appendChild(U.el('p', 'hint',
      '한 번 쓰면 사라지는 것과, 얻는 순간부터 계속 힘을 쓰는 것이 있습니다.'));
    /* ★ 4단계 — 착용/해제가 없는 게임에서 「지금은 이걸 끄고 싶다」의 자리. */
    body.appendChild(U.el('p', 'hint', '봉인하면 이 유물의 힘이 잠듭니다. 언제든 되돌릴 수 있습니다.'));
    var g = U.el('div', 'art-grid');
    g.id = 'art-grid';
    body.appendChild(g);
    var s = U.el('div');            // ★ §20-R4c — 세트 진척은 격자 아래 한 칸에 모아 적는다
    s.id = 'art-sets';
    body.appendChild(s);
    var foot = U.el('div');
    foot.appendChild(U.btn('발견 기록', 'btn-ghost', function () { openJournal(); }));
    foot.appendChild(U.btn('닫는다', 'btn-primary', function () { U.closeTopModal(); }));
    U.openModal({ title: '유물함', body: body, footer: foot, width: '760px', key: 'relic',
                  icon: GM.icons.img('gem', 22) });
    paint();
  }

  function paint() {
    var grid = U.qs('#art-grid');
    if (!grid) return;
    U.clear(grid);
    var n = S.nation();
    var list = (n && n.artifacts) || [];
    if (!list.length) {
      grid.appendChild(U.el('div', 'empty', '아직 땅이 내어준 것이 없습니다.'));
      return;
    }
    list.forEach(function (a) {
      var d = itemDef(a);
      var c = U.el('div', 'art ' + gradeCls(d.grade) + (a.consumed ? ' used' : '') + (a.sealed ? ' sealed' : ''));
      c.appendChild(artwork(a.key, 42));
      c.appendChild(U.el('div', 'a-name', d.name || a.key));
      c.appendChild(U.el('div', 'a-grade', gradeName(d.grade) + ' · ' + typeName(d.type)));
      c.appendChild(U.el('div', 'a-desc', d.desc || ''));
      if (a.lore) c.appendChild(U.el('p', 'a-lore', '「' + a.lore + '」'));
      U.tipSet(c, (d.name || a.key) + ' — ' + gradeName(d.grade),
        (d.desc || '') + (a.obtainedTick !== undefined ? '\n' + a.obtainedTick + '일에 얻었습니다.' : ''));
      /* ★ 4단계 — 봉인해 둔 것은 손으로도 쓰지 못한다(서버가 같은 판정을 한다). 잠긴 단추를
         세워 두지 않고 「무엇 때문에 못 쓰는가」만 적는다(§11-1 「잠긴 것은 부재」). */
      if (a.sealed) {
        c.appendChild(U.el('div', 'a-act hint', '봉인해 두었습니다 — 힘이 잠들어 있습니다'));
      } else if (isConsumable(d) && !a.consumed) {
        var b = U.btn(useLabel(a), 'btn-sm btn-primary a-act', function () { useIt(a, d); });
        b.setAttribute('data-artifact', a.key);
        c.appendChild(b);
      } else if (a.consumed) {
        c.appendChild(U.el('div', 'a-act hint', '이미 썼습니다'));
      }
      /* ★ §20-R4c — 심는 것·봉인하는 것은 「쓴다」와 다른 문이다(뷰의 plantable·curse 가 정본).
         화면은 유물의 성질을 제 손으로 알지 않는다 — 규격에서 걷어 냈다(§0-U-8). */
      if (a.plantable) c.appendChild(plantBtn(a, d));
      /* ★ 4단계 — 봉인은 이제 **모든 유물**의 문이다(착용/해제의 1차 대체). 저주만 값이 붙는다 —
         값의 정본은 서버가 실어 보낸 두 칸이라 화면이 「저주면 얼마」를 제 손으로 셈하지 않는다. */
      c.appendChild(sealBtn(a, d));
      grid.appendChild(c);
    });
    paintSets();
  }

  /* 충전이 남았으면 몇 번인지 단추가 말한다(R2 에서 미뤄 둔 표시). */
  function useLabel(a) {
    var left = a.chargesLeft;
    if (left === undefined || left === null || (a.charges || 1) <= 1) return '쓴다';
    return '쓴다 (' + left + '번 남음)';
  }

  /* 폭군의 왕관만 자리를 묻는다 — 뷰의 picksRole 이 그 자리를 알려 준다(R1 부터 미룬 TODO).
     서버의 문도 따로다: 고른 자리는 useArtifact 가 아니라 tyrantPick 으로 간다. */
  function useIt(a, d) {
    if (a.picksRole) { askRole(a, d); return; }
    U.confirmBox('유물을 쓸까요?', (d.name || a.key) + ' — ' + (d.desc || '') + '\n\n한 번 쓰면 사라집니다.',
      function () { GM.net.send('useArtifact', { key: a.key }); GM.sfx.play('unlock'); }, '쓴다');
  }

  function askRole(a, d) {
    var body = U.el('div');
    body.appendChild(U.el('p', null, (d.desc || '') + '\n어느 자리에 왕관을 씌우시겠습니까?'));
    var box = U.el('div', 'ag-choices');
    var m = null;
    roleSeats().forEach(function (r) {
      box.appendChild(U.btn(r.name, '', function () {
        GM.net.send('tyrantPick', { role: r.key });
        GM.net.send('useArtifact', { key: a.key });
        GM.sfx.play('unlock');
        U.closeModal(m);
      }));
    });
    body.appendChild(box);
    var foot = U.el('div');
    foot.appendChild(U.btn('그만둔다', 'btn-ghost', function () { U.closeModal(m); }));
    m = U.openModal({ title: '왕관을 씌울 자리', body: body, footer: foot, width: '460px', key: 'tyrant' });
  }

  function roleSeats() {
    var n = S.nation() || {};
    return Object.keys(n.roles || {})
      .filter(function (k) { return n.roles[k] && n.roles[k].holder; })
      .map(function (k) { return { key: k, name: S.roleMeta(k).name }; });
  }

  /* 심는다 — 자리는 **선 자리**다. 반경 판정은 서버가 한다(본영 곁만). */
  function plantBtn(a, d) {
    if (a.planted) return U.el('div', 'a-act hint', '심어 두었습니다');
    return U.btn('선 자리에 심는다', 'btn-sm a-act', function () {
      var me = standingSpot();
      if (!me) { U.toast('설 자리를 찾지 못했습니다.', 'warn'); return; }
      U.confirmBox('여기에 심을까요?', (d.name || a.key) + '\n\n본영 곁에만 뿌리를 내립니다. 한 번 심으면 옮기지 못합니다.',
        function () { GM.net.send('plantArtifact', { key: a.key, x: Math.round(me.x), y: Math.round(me.y) }); },
        '심는다');
    });
  }

  /* 내가 선 자리 — 아바타 목록에서 내 것을 집는다(world.js 가 쓰는 그 자). */
  function standingSpot() {
    var list = S.S.avatars || [];
    var mine = S.S.avatarId;
    for (var i = 0; i < list.length; i++) if (list[i].id === mine) return list[i];
    return null;
  }

  /* 봉인 값 — 저주만 값을 문다(§20-6). 두 다이얼 다 서버가 실어 보낸다. */
  function sealCost(a) {
    var n = S.nation() || {};
    return (a.curse ? n.sealCostGold : n.sealCostGoldPlain) || 0;
  }

  function sealBtn(a, d) {
    var cost = sealCost(a);
    var costLine = cost > 0 ? ' 금 ' + cost + '이 듭니다.' : '';
    if (a.sealed) {
      return U.btn('봉인을 푼다', 'btn-sm btn-primary a-act', function () {
        if (cost <= 0) { GM.net.send('sealArtifact', { key: a.key, sealed: false }); return; }
        U.confirmBox('봉인을 풀까요?', (d.name || a.key) + '\n\n다시 힘을 씁니다.' + costLine,
          function () { GM.net.send('sealArtifact', { key: a.key, sealed: false }); }, '봉인을 푼다');
      });
    }
    return U.btn('봉인한다', 'btn-sm btn-ghost a-act', function () {
      U.confirmBox('봉인할까요?', (d.name || a.key) + ' — ' + (d.desc || '')
        + '\n\n봉인하면 이 유물의 힘이 잠듭니다.' + costLine + ' 나중에 되돌릴 수 있습니다.',
        function () { GM.net.send('sealArtifact', { key: a.key, sealed: true }); }, '봉인한다');
    });
  }

  /* 세트 — 몇 조각을 모았고 어느 문턱이 켜졌는가. 셈은 서버가 했다(뷰의 artifactSets). */
  function paintSets() {
    var host = U.qs('#art-sets');
    if (!host) return;
    U.clear(host);
    var sets = (S.nation() || {}).artifactSets || {};
    Object.keys(sets).forEach(function (k) {
      var s = sets[k];
      if (!s || !s.owned) return;
      var box = U.el('div', 'art-set');
      box.appendChild(U.el('div', 'a-name', s.name + ' ' + s.owned + '/' + s.total));
      (s.steps || []).forEach(function (st) {
        box.appendChild(U.el('div', st.on ? 'a-desc' : 'hint', st.need + '개 — ' + (st.text || '')));
      });
      host.appendChild(box);
    });
  }

  function isConsumable(d) {
    var t = String(d.type || '').toLowerCase();
    return t === 'consumable' || t === '소모형';
  }
  function typeName(t) {
    t = String(t || '').toLowerCase();
    if (t === 'consumable') return '한 번 쓰는 것';
    if (t === 'permanent') return '늘 힘을 쓰는 것';
    if (t === 'utility') return '요긴한 것';
    if (t === 'cosmetic') return '보기 좋은 것';
    if (t === 'tradeoff') return '주고받는 것';
    return t || '—';
  }

  /* ── 발견 카드 (★ §20-R1.5) ──────────────────────────
     「왜」 여기만 창을 띄우나 — 「창은 저절로 뜨지 않는다」가 규칙이지만, 유물 발견은
     내가 궤를 열거나 어전 회의를 연 **그 행동의 즉각 답**이다. 남의 화면을 빼앗는 알림이 아니라
     내 손이 부른 장면이라 예외로 둔다. 아무 데나 눌러도, ESC 로도 닫힌다.
     도트 일러 자리는 지금 카테고리 아이콘을 작게 그려 크게 늘린 것이다(에셋이 오면 그림만 갈아 끼운다). */
  var CAT_ICON = { role: 'scroll', qol: 'gem', combat: 'sword', environment: 'leaf',
                   resource: 'coin', diplomacy: 'flag', tradeoff: 'dice', cosmetic: 'crown' };

  function discovery(found) {
    if (!found || !found.artifact) return;
    remember(found);
    /* 궁정 서기가 글을 고쳐 보내오면(표현 계층) 카드를 새로 띄우지 않고 그 줄만 갈아 끼운다 */
    var open = U.modalOpen('relic-found');
    if (open && open.__relicKey === found.key) { type.start(open.__relicLine, taleOf(found)); return; }
    var tier = tierOf(found);
    /* ★ §20-R2 — 남이 찾은 것은 **남의 화면을 빼앗지 않는다**: 방 배너와 작은 빛기둥뿐이다 */
    if (!foundByMe(found)) { echoOther(found, tier); return; }
    /* 탐험 궤에서는 월드 위의 짧은 토스트 대신, 놓치기 어려운 하단 대화창으로 읽는다. */
    /* 모든 획득은 읽을 수 있는 대화창으로 열고, 발견 기록에 남긴다. */
    cacheDialogue(found);
  }

  function cacheDialogue(found) {
    if (!GM.dialogue || !GM.dialogue.open) { seq.run(found, tierOf(found)); return; }
    var place = found.role || '탐험 궤';
    var story = taleOf(found);
    var lines = [place + '가 비워진 자리에서 「' + (found.artifact || found.key) + '」을(를) 발견했습니다.'];
    if (story) lines.push(story);
    if (found.effect && found.effect !== story) lines.push('효과 — ' + found.effect);
    GM.dialogue.open({ speaker: '발견 기록', portraitKey: 'icon:gem', lines: lines });
  }

  function openJournal() {
    var rows = journal().slice().reverse();
    var body = U.el('div', 'artifact-journal');
    body.appendChild(U.el('p', 'hint', '발견한 유물과 그 자리에 남았던 기록입니다. 항목을 누르면 다시 대화로 읽습니다.'));
    if (!rows.length) body.appendChild(U.el('p', 'empty', '아직 남겨진 발견 기록이 없습니다.'));
    rows.forEach(function (row) {
      var entry = U.el('article', 'artifact-journal-entry ' + gradeCls(row.grade));
      entry.appendChild(U.el('div', 'artifact-journal-title', row.name));
      if (row.source) entry.appendChild(U.el('div', 'artifact-journal-source', row.source));
      if (row.narrative) entry.appendChild(U.el('p', 'artifact-journal-story', row.narrative));
      if (row.effect) entry.appendChild(U.el('div', 'artifact-journal-effect', '효과 — ' + row.effect));
      entry.onclick = function () { U.closeTopModal(); cacheDialogue({ key: row.key, artifact: row.name, grade: row.grade,
        role: row.source, narrative: row.narrative, effect: row.effect, source: 'cache' }); };
      body.appendChild(entry);
    });
    var foot = U.el('div');
    foot.appendChild(U.btn('닫기', 'btn-primary', function () { U.closeTopModal(); }));
    U.openModal({ title: '유물 발견 기록', body: body, footer: foot, width: '560px', key: 'artifact-journal',
                  icon: GM.icons.img('book', 22) });
  }

  function card(found, tier) {
    var d = itemDef({ key: found.key, name: found.artifact, grade: found.grade,
                      type: (defOf(found.key) || {}).type, desc: found.effect });
    var color = gradeColor(d.grade);
    var body = U.el('div', 'art-found t' + tier);
    body.appendChild(plate(found, color));
    body.appendChild(U.el('div', 'af-name', d.name || found.key));
    body.appendChild(U.el('div', 'af-grade', gradeName(d.grade) + ' · ' + typeName(d.type)));
    var line = U.el('div', 'af-tale');
    body.appendChild(line);
    body.appendChild(U.el('div', 'af-effect', found.effect || d.desc || ''));
    /* ★ §20-R3 — 「기록이 보상이다」(§20-8). 서버는 이미 등록부에 적었다 — 화면은 그 사실만 알린다. */
    body.appendChild(U.el('div', 'af-stamp', '도감에 적혔습니다'));
    openFoundModal(body, line, found, color, tier);
  }

  function taleOf(found) { return String(found.narrative || found.effect || ''); }

  /* ── ★ §20-R2 등급별 연출 (유물기획 §20-7) ─────────────
     「왜」 급을 나누나 — 같은 소리·같은 카드로는 「대박이다」가 오지 않는다. 급이 오를수록
     ① 소리가 두꺼워지고 ② 화면이 어두워져 카드에 눈이 모이고 ③ 그 **자리**에 빛기둥이 선다.
     박자·개수·배율의 정본은 data/world.json render.artifactFx 다(여기 숫자는 없다).
     전부 표시 전용이다 — 서버는 이미 지급·기록을 끝냈고 이 아래 어느 줄도 판정에 닿지 않는다. */
  function fxCfg() { return S.artifactFxCfg ? S.artifactFxCfg() : {}; }
  function byTier(table, tier, dflt) {
    var v = table ? table[String(tier)] : undefined;
    return v === undefined ? dflt : v;
  }
  function tierOf(found) {
    return found.fxTier || S.gradeInfo(found.grade).fxTier || 1;
  }
  /** 내 손이 부른 장면인가 — 발견자를 모르면(어전 회의 상자) 나라의 일이므로 모두가 본다 */
  function foundByMe(found) {
    return found.foundById == null || found.foundById === S.S.avatarId;
  }

  var seq = (function () {
    var timers = [];
    var pending = null;                      // 아직 안 뜬 카드 {found, tier}
    var restoreCam = null;
    function later(fn, ms) { timers.push(setTimeout(fn, ms || 0)); }
    function stop() { timers.forEach(clearTimeout); timers.length = 0; }

    function run(found, tier) {
      finish();
      var cfg = fxCfg();
      pending = { found: found, tier: tier };
      prelude(found, tier, cfg);
      var wait = byTier(cfg.cardDelayMs, tier, 0);
      /* 뜸을 들이지 않는 급(일반·레어)은 **그 자리에서** 뜬다 — 한 프레임이라도 미루면 깜박인다 */
      if (wait > 0) { later(reveal, wait); listen(); } else reveal();
    }
    function reveal() {
      if (!pending) return;
      var p = pending;
      pending = null;
      unlisten();                 // 카드가 떴으면 건너뛰기 귀는 닫는다(모달이 ESC 를 이어받는다)
      card(p.found, p.tier);
    }
    /** 건너뛰기·전투 경보 — 연출은 접고 카드만 남긴다 */
    function finish() {
      var had = !!pending || !!restoreCam;
      stop();
      unlisten();
      if (restoreCam) { restoreCam(); restoreCam = null; }
      if (had) U.epicClear();     // 남의 장면(날 바뀜·땅 이름)까지 걷어 내지 않는다
      reveal();
    }
    function setRestore(fn) { restoreCam = fn; }
    return { run: run, finish: finish, setRestore: setRestore, later: later,
             busy: function () { return !!pending; } };
  })();

  /* 건너뛰기 — 아무 데나 누르거나 ESC. 카드가 뜨기 전 구간에서만 듣는다(뜬 뒤엔 모달의 몫). */
  function onSkipKey(e) { if (e.key === 'Escape' || e.key === 'e' || e.key === 'E') seq.finish(); }
  function listen() {
    document.addEventListener('keydown', onSkipKey, true);
    document.addEventListener('pointerdown', seq.finish, true);
  }
  function unlisten() {
    document.removeEventListener('keydown', onSkipKey, true);
    document.removeEventListener('pointerdown', seq.finish, true);
  }

  /** 카드가 뜨기 **전**의 몫 — 소리·어둠·빛기둥·줌·슬로모·비네트 */
  function prelude(found, tier, cfg) {
    GM.sfx.play(byTier(cfg.sfx, tier, 'gain'));
    if (tier >= 3) U.epic({ veil: true, veilOnly: true, veilAlpha: byTier(cfg.veilAlpha, tier, 0.5),
                            ms: byTier(cfg.cardDelayMs, tier, 0) + (cfg.vignetteSeconds || 2) * 1000 });
    if (tier < 4) return;
    worldBeam(found, cfg, 1);
    zoomTo(found, cfg);
    var sm = cfg.slowmo || {};
    if (GM.fx.slowmo) GM.fx.slowmo(sm.scale, sm.ms);
    GM.fx.vignette(gradeColor(found.grade), cfg.vignetteSeconds);
  }

  /** 획득 지점의 빛기둥 — 월드층이라 카메라를 돌려도 그 자리에 남는다 */
  function worldBeam(found, cfg, scale) {
    var at = found.nodePos;
    var b = cfg.beam;
    if (!at || !b || !GM.fx.beam) return;
    GM.fx.beam({ x: at.x, y: at.y, color: gradeColor(found.grade), seconds: b.seconds,
                 widthTiles: b.widthTiles, heightTiles: b.heightTiles,
                 ringCount: b.ringCount, scale: scale });
  }

  /** 레전더리만 카메라가 다가갔다 제자리로 — 손을 오래 뺏지 않는다 */
  function zoomTo(found, cfg) {
    var z = cfg.zoom;
    if (!found.nodePos || !GM.camera || !z) return;
    var cam = GM.camera.cam;
    var back = { x: cam.tx, y: cam.ty, zoom: cam.zoom };
    var undo = function () { GM.camera.moveTo(back.x, back.y); GM.camera.setZoom(back.zoom); };
    GM.camera.moveTo(found.nodePos.x, found.nodePos.y);
    GM.camera.setZoom(z.step);
    seq.setRestore(undo);
    seq.later(function () { seq.setRestore(null); undo(); }, z.holdMs);
  }

  /** 같은 방의 다른 사람 — 배너 한 줄과 작은 빛기둥. 화면을 덮지 않는다 */
  function echoOther(found, tier) {
    if (tier < 3) return;
    var cfg = fxCfg();
    worldBeam(found, cfg, (cfg.beam || {}).sharedScale || 0.55);
    U.banner({ icon: 'gem', kind: 'good', title: found.artifact,
               sub: (found.foundBy || '누군가') + '이(가) 찾아냈습니다', ms: (cfg.globalBannerMs || 6000) / 2 });
  }

  /** 도트 자리 — 작게 그려 크게 늘린다(pixelated). 에셋이 오면 이 함수만 갈아 끼운다. */
  function plate(found, color) {
    var wrap = U.el('div', 'af-plate');
    wrap.style.borderColor = color;
    var im = artwork(found.key, 96, 'af-dot');
    im.className = 'af-dot';
    im.style.width = '96px';
    im.style.height = '96px';
    wrap.appendChild(im);
    return wrap;
  }

  function openFoundModal(body, line, found, color, tier) {
    var foot = U.el('div');
    foot.appendChild(U.btn('간직한다', 'btn-primary', function () { U.closeTopModal(); }));
    var back = U.openModal({ title: '땅이 무언가를 내어주었다', body: body, footer: foot,
                             width: '420px', key: 'relic-found', icon: GM.icons.img('gem', 22) });
    body.addEventListener('click', function () { type.skip(); });
    if (back) { back.style.setProperty('--relic', color); back.__relicKey = found.key; back.__relicLine = line; }
    sprinkle(body, color, tier);
    type.start(line, taleOf(found));
  }

  /* 금빛 파티클 — 급이 오를수록 촘촘하다(개수의 정본은 render.artifactFx.sparkleCount) */
  function sprinkle(body, color, tier) {
    var n = byTier(fxCfg().sparkleCount, tier, 0);
    U.sparkle(body, color);
    for (var i = 0; i < n; i++) seq.later(function () { U.sparkle(body, color); }, i * 46);
  }

  /* 한 자씩 찍는다 — 다 적힌 글은 읽는 것이지만 찍히는 글은 듣는 것이다. 누르면 즉시 다 보여 준다. */
  var type = (function () {
    var timer = 0, node = null, text = '', shown = 0;
    function stop() { if (timer) clearInterval(timer); timer = 0; }
    function paint() { if (node) node.textContent = text.slice(0, shown); }
    function step() { shown += 1; paint(); if (shown >= text.length) stop(); }
    return {
      start: function (el, t) {
        stop(); node = el; text = t || ''; shown = 0; paint();
        /* 한 글자가 찍히는 시간의 정본은 대화창과 같은 자다(data/world.json render.dialogue.typeMs) */
        var ms = (S.dialogueCfg() || {}).typeMs;
        if (ms > 0) timer = setInterval(step, ms); else this.skip();
      },
      skip: function () { stop(); shown = text.length; paint(); },
    };
  })();

  /* ── 상자 여는 연출 ────────────────────────────────── */
  function openChest(drop, host, onDone) {
    var empty = !drop || !drop.key;
    var def = (drop && drop.name) ? drop
      : (empty ? { name: '빈 상자', grade: (drop && drop.grade) || 'common', type: null,
                   desc: (drop && drop.desc) || '상자는 비어 있었습니다.' }
               : defOf(drop.key));
    var color = gradeColor(def.grade);

    var stage = U.el('div', 'chest-stage');
    var cv = document.createElement('canvas');
    stage.appendChild(cv);
    var nameEl = U.el('div', 'chest-name', '');
    nameEl.style.color = color;
    stage.appendChild(nameEl);
    var descEl = U.el('div', 'hint');
    descEl.style.textAlign = 'center';
    stage.appendChild(descEl);
    host.appendChild(stage);

    var W = 200, H = 150;
    var t0 = (global.performance && performance.now) ? performance.now() : Date.now();
    var done = false;
    GM.sfx.play('page');

    function frame(t) {
      var e = (t - t0) / 1000;
      var ctx = U.fitCanvas(cv, W, H);
      ctx.clearRect(0, 0, W, H);
      var s = 6;
      var shake = e < 1.2 ? Math.sin(e * 34) * 3 * (1.2 - e) : 0;
      var lid = U.clamp((e - 1.2) / 0.7, 0, 1);
      var glow = U.clamp((e - 1.3) / 0.9, 0, 1);

      if (glow > 0) {
        for (var i = 0; i < 22; i++) {
          var a = glow * (1 - i / 22) * 0.75;
          ctx.fillStyle = U.rgba(color, a * 0.5);
          ctx.fillRect(W / 2 - (26 - i * 0.7), H * 0.62 - i * 5, (26 - i * 0.7) * 2, 5);
        }
        for (var k = 0; k < 18; k++) {
          var pr = U.rngFrom('chest' + k);
          var px0 = W / 2 + (pr() - 0.5) * 90;
          var py0 = H * 0.62 - ((e * 46 + pr() * 100) % 110);
          ctx.fillStyle = U.rgba(color, glow * (0.35 + pr() * 0.6));
          ctx.fillRect(Math.round(px0 / 3) * 3, Math.round(py0 / 3) * 3, 3, 3);
        }
      }

      var bx = W / 2 - 40 + shake, by = H * 0.62;
      U.px(ctx, bx, by, 80, 34, '#5c3b20');
      U.px(ctx, bx, by, 80, s, '#7a5230');
      U.px(ctx, bx + 34, by, 12, 34, '#a8701f');
      U.px(ctx, bx - 4, by + 30, 88, 6, '#3b2318');
      var ly = by - 18 - lid * 26;
      var rot = lid * 10;
      U.px(ctx, bx, ly - rot, 80, 18, '#6b4526');
      U.px(ctx, bx, ly - rot, 80, s, '#a3703f');
      U.px(ctx, bx + 34, ly - rot, 12, 18, '#a8701f');

      if (e > 2.3 && !done) {
        done = true;
        nameEl.textContent = def.name || (drop && drop.key) || '빈 상자';
        nameEl.classList.add('show');
        descEl.textContent = empty ? (def.desc || '')
          : (gradeName(def.grade) + ' · ' + typeName(def.type) + ' — ' + (def.desc || ''));
        if (!empty) { GM.sfx.play('fanfare'); U.sparkle(stage, color); }
        if (onDone) onDone();
      }
      if (e < 4.2) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return stage;
  }

  /* ★ 4단계B — 원정 카드 접기. 「왜 탐험하는가」는 늘 손에 닿아야 하지만, 길을 이미 아는
     사람에게 넉 줄짜리 판은 좌상단을 먹는 짐이다. 머리(유물 원정 …)를 누르면 접히고,
     접었다는 사실은 이 기기에 남는다 — 다음에 들어와도 접힌 채로 선다. */
  var FOLD_KEY = 'gm.artifactCard.folded';
  function huntFolded() {
    try { return localStorage.getItem(FOLD_KEY) === '1'; } catch (e) { return false; }
  }
  function applyHuntFold(card) {
    var on = huntFolded();
    card.classList.toggle('folded', on);
    var arrow = card.querySelector('.at-fold');
    if (arrow) arrow.textContent = on ? '▸' : '▾';
  }
  function toggleHuntFold() {
    try { localStorage.setItem(FOLD_KEY, huntFolded() ? '0' : '1'); } catch (e) {}
    var card = U.qs('#artifact-track-card');
    if (card) applyHuntFold(card);
  }

  function paintHunt() {
    var card = U.qs('#artifact-track-card');
    var n = S.nation() || {}, hunt = n.artifactHunt;
    if (!card) return;
    if (!hunt) { card.hidden = true; return; }
    var open = (hunt.temples || []).filter(function (t) { return t.found && !t.completed; })[0];
    var done = (hunt.temples || []).filter(function (t) { return t.completed; }).length;
    var sig = [hunt.clues, hunt.nextAt, open && open.nodeId, open && open.retryAt, done].join('|');
    if (card.getAttribute('data-sig') === sig) return;
    card.setAttribute('data-sig', sig); card.hidden = false; U.clear(card);
    var cap = U.el('span', 'at-cap', '유물 원정 · 탐험의 이유');
    cap.appendChild(U.el('i', 'at-fold', '▾'));
    cap.onclick = function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); toggleHuntFold(); };
    U.tipSet(cap, '유물 원정', '눌러서 이 카드를 접거나 폅니다.');
    card.appendChild(cap);
    card.appendChild(U.el('span', 'at-why', '유적의 전설 → 깊은 방의 단서 3개 → 신전 수호자 → 신전 전용 유물'));
    if (open) {
      card.appendChild(U.el('strong', 'at-title', open.name + ' 발견'));
      var now = (S.S.view && S.S.view.tick) || 0;
      if (open.retryAt && now < open.retryAt) {
        card.appendChild(U.el('span', 'at-sub', open.retryAt + '일째에 봉인이 약해집니다. 그때 이 신전으로 돌아와 재도전할 수 있습니다.'));
      } else {
        card.appendChild(U.el('span', 'at-sub', '수호병을 쓰러뜨리면 이 신전 테마의 희귀·유니크·전설 유물을 얻습니다.'));
      }
      card.appendChild(U.el('span', 'at-why', '왜 가나요? 유물은 전투·생산·탐험 방식을 영구적으로 바꿉니다.'));
      card.classList.add('clickable');
      card.onclick = function () {
        var node = S.nodeById(open.nodeId);
        if (node && GM.camera) GM.camera.moveTo(node.x, node.y);
      };
      U.tipSet(card, open.name, '누르면 발견한 신전으로 시선을 옮깁니다.');
    } else {
      card.appendChild(U.el('strong', 'at-title', '신전으로 가는 단서 ' + (hunt.clues % 3) + ' / 3'));
      card.appendChild(U.el('span', 'at-sub', '맵을 탐험해 깊은 유적을 찾고, 마지막 방까지 캐내세요. ' + hunt.nextAt + '번째 단서가 다음 신전의 길을 드러냅니다.'));
      card.appendChild(U.el('span', 'at-why', '흐름: 깊은 유적 탐사 → 단서 3개 → 신전 발견 → 수호병 격파 → 테마 유물 획득'));
      card.classList.remove('clickable'); card.onclick = null;
      U.tipSet(card, '신전으로 가는 단서', '설산·밀림·먼 들판에 각각 하나씩 있는 신전을 찾습니다.');
    }
    var journalBtn = U.btn('발견 기록 다시 읽기', 'btn-sm at-journal', function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      openJournal();
    });
    card.appendChild(journalBtn);
    applyHuntFold(card);
  }

  /* ★ 2단계A(§11-1 「잠긴 것은 부재」) — 눌러도 「아직 안 됩니다」만 돌아오는 단추는 화면에 없다.
     ★ 2026-08 — 이제 그 문은 1장부터 열려 있으므로 단추도 1장부터 선다(relicOn). */
  function paintInventoryBtn() {
    var b = U.qs('#artifact-inventory-btn');
    if (!b) return;
    b.hidden = !relicOn();
  }

  function update() { if (U.modalOpen('relic')) paint(); paintHunt(); paintInventoryBtn(); }

  document.addEventListener('DOMContentLoaded', function () {
    /* ★ 4단계B — 좌상단에서 「발견 기록」 단추를 거둔다. 같은 문이 이미 둘 더 있다
       (통합 메뉴 · 원정 카드 안의 「발견 기록 다시 읽기」). 화면에는 최소만 남긴다.
       마크업은 그대로 두고 여기서 감춘다 — index.html 은 여러 손이 함께 만지는 자리다. */
    var b = U.qs('#artifact-journal-btn');
    if (b) { b.hidden = true; b.onclick = openJournal; }
    var inventory = U.qs('#artifact-inventory-btn');
    if (inventory) inventory.onclick = open;
  });

  GM.artifacts = { open: open, update: update, openChest: openChest, discovery: discovery, openJournal: openJournal,
                   rememberLore: rememberLore,
                   /* ★ §20-R2 — 전투 경보가 오면 연출을 접는다(app.js 가 부른다) */
                   endShow: function () { seq.finish(); }, tierOf: tierOf,
                   gradeColor: gradeColor, defOf: defOf, itemDef: itemDef };
})(window);
