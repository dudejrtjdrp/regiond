/* codex.js — 도감 (GDD3 §13-C-3). 단축키 J · 도구줄 [도감].
   층은 넷이다. 조우 0 이면 **실루엣**뿐이고, 한 번이라도 마주치면 이름과 사는 곳이,
   다섯을 잡으면 능력치와 나오는 것이, 스물을 잡으면 이야기가 열린다.
   ★ 셈은 전부 서버가 한다 — 여기서는 서버가 준 카드를 옮겨 적기만 하고,
     잠긴 층은 필드 자체가 오지 않으므로 화면이 지어낼 수도 없다(§11-1 「잠긴 것은 부재다」). */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var tab = 'life';

  function open() {
    if (!S.uiOn('panel.codex')) { U.toast('아직 도감을 펼칠 때가 아닙니다.', 'warn'); return null; }
    var body = U.el('div');
    body.id = 'codex-body';
    paint(body);
    var foot = U.el('div');
    foot.appendChild(U.btn('덮는다', 'btn-primary', function () { U.closeTopModal(); }));
    return U.openModal({ title: '도감', body: body, footer: foot, width: '720px',
                         key: 'codex', icon: GM.icons.img('book', 22) });
  }

  function paint(host) {
    U.clear(host);
    var c = S.codex();
    if (!c) { host.appendChild(U.el('p', 'empty', '아직 적을 것이 없습니다.')); return; }

    var t = c.totals || {};
    host.appendChild(U.el('p', 'hint',
      '만난 것 ' + (t.seen || 0) + ' / ' + (t.total || 0) + '종 · 잡은 것 ' + (t.killed || 0) +
      ' · 찾은 유적 ' + (t.ruinsFound || 0) + '곳(뒤진 곳 ' + (t.ruinsExplored || 0) + ')'));

    var tabs = U.el('div', 'codex-tabs');
    [['life', '들에 사는 것'], ['ruin', '옛 자취'], ['relic', '세계에 남은 것']].forEach(function (p) {
      var b = U.btn(p[1], 'btn-sm' + (tab === p[0] ? ' btn-primary' : ' btn-ghost'), function () {
        tab = p[0];
        paint(host);
      });
      /* ★ 3단계A — 아직 닿지 못한 단서가 있으면 탭이 스스로 말한다. 「가야 할 데가 남았다」를
         도감을 열어 본 사람만 아는 것으로 두면, 그 저널은 있으나 마나 한 것이 된다. */
      if (p[0] === 'ruin' && (t.cluesOpen || 0) > 0) {
        b.appendChild(U.el('span', 'tab-dot', '●'));
        b.title = '아직 닿지 못한 단서 ' + t.cluesOpen + '개';
      }
      tabs.appendChild(b);
    });
    host.appendChild(tabs);

    if (tab === 'ruin') { paintRuins(host, c); return; }
    if (tab === 'relic') { paintRelics(host, c); return; }

    var grid = U.el('div', 'codex-grid');
    (c.species || []).forEach(function (sp) { grid.appendChild(card(sp, c.thresholds || {})); });
    host.appendChild(grid);
  }

  function card(sp, th) {
    var box = U.el('div', 'codex-card' + (sp.known ? '' : ' unknown'));
    box.setAttribute('data-sp', sp.key);

    var art = U.el('div', 'codex-art');
    try {
      var img = GM.atlas.wild(sp.key, 0, { silhouette: !sp.known });
      var cv = U.el('canvas', 'codex-sprite');
      cv.width = 48; cv.height = 48;
      var g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, 48, 48);
      art.appendChild(cv);
    } catch (e) {}
    box.appendChild(art);

    box.appendChild(U.el('div', 'codex-name', sp.known ? sp.name : '？？？'));
    box.appendChild(U.el('div', 'codex-kind',
      (sp.kind === 'predator' ? '사나운 것' : '온순한 것') + ' · ' + ringName(sp.ring)));

    if (sp.known) box.appendChild(U.el('div', 'codex-habitat', sp.habitat || ''));
    else box.appendChild(U.el('div', 'codex-habitat dim', '아직 마주친 적이 없습니다.'));

    if (sp.stats) {
      var st = U.el('div', 'codex-stats');
      st.appendChild(stat('체력', U.fmt(sp.stats.hp, 0)));
      st.appendChild(stat('빠르기', U.fmt(sp.stats.speed, 1)));
      if (sp.stats.dps > 0) st.appendChild(stat('사나움', U.fmt(sp.stats.dps, 1)));
      box.appendChild(st);
    }
    if (sp.drops && sp.drops.length) {
      var dr = U.el('div', 'codex-drops');
      dr.appendChild(U.el('span', 'lbl', '나오는 것'));
      sp.drops.forEach(function (d) {
        dr.appendChild(U.el('span', 'drop', d.name + ' ' + d.amount));
      });
      box.appendChild(dr);
    }
    if (sp.lore) box.appendChild(U.el('p', 'codex-lore', sp.lore));

    var foot = U.el('div', 'codex-foot');
    foot.appendChild(U.el('span', 'cnt', '만남 ' + sp.encounters + ' · 잡음 ' + sp.kills));
    if (sp.next) {
      foot.appendChild(U.el('span', 'nxt',
        nextLabel(sp.next.what) + '까지 ' + sp.next.unit + ' ' + sp.next.have + '/' + sp.next.need));
    } else {
      foot.appendChild(U.el('span', 'nxt done', '다 알았다'));
    }
    box.appendChild(foot);
    return box;
  }

  function nextLabel(what) {
    if (what === 'name') return '이름';
    if (what === 'stats') return '능력치';
    return '이야기';
  }

  function ringName(r) {
    if (r === 0) return '정착지 근처';
    if (r === 1) return '먼 들';
    return '사나운 땅';
  }

  function stat(k, v) {
    var s = U.el('span', 'st');
    s.appendChild(U.el('b', null, k));
    s.appendChild(U.el('i', null, v));
    return s;
  }

  /** ★ §22 — 이 자취가 어디까지 열렸는가. 옛 화면(방 정보 없는 저장)에서는 예전 문구로 돌아간다. */
  function ruinProgress(r) {
    if (r.rooms == null) return (r.cycles || 0) > 0 ? '뒤진 횟수 ' + r.cycles : '아직 손대지 않음';
    if (r.spent) return '다 뒤졌다 (' + r.rooms + '방)';
    var opened = r.roomsOpened || 0;
    if (!opened) return '아직 손대지 않음 · ' + r.rooms + '방';
    return '방 ' + opened + '/' + r.rooms + ' — ' + (r.rooms - opened) + '방 남음';
  }

  /* ══════════ ★ 3단계A — 옮겨 적은 단서 (탐험 저널) ══════════
     「왜」 도감에 다나 — 단서는 카드 한 장에 한 번 떴다가 사라지는 한 줄이었다. 창을 닫으면
     「북쪽 눈밭」이라는 말은 사람의 기억에만 남고, 하루 뒤에 접속하면 어디로 가려 했는지가 없다.
     여기 쌓이는 것은 **문장과 상태**뿐이다 — 좌표도 화살표도 서버가 아예 안 보낸다(마커 금지). */
  function paintClues(host, c) {
    var list = c.clues || [];
    if (!list.length) return;
    var open = 0;
    list.forEach(function (q) { if (!q.targetSeen) open += 1; });
    host.appendChild(U.el('div', 'codex-sub',
      '옮겨 적은 단서 — 아직 못 찾은 곳 ' + open + ' / ' + list.length));
    var wrap = U.el('div', 'clue-list');
    list.forEach(function (q) { wrap.appendChild(clueCard(q)); });
    host.appendChild(wrap);
  }

  function clueCard(q) {
    var box = U.el('div', 'clue-card' + (q.temple ? ' temple' : '') + (q.targetSeen ? ' seen' : ''));
    box.appendChild(U.el('span', 'line', q.line || ''));
    var meta = U.el('div', 'meta');
    meta.appendChild(U.el('span', 'clue-badge' + (q.targetSeen ? ' done' : ''),
      q.targetSeen ? '닿았다' : '아직 못 찾음'));
    if (q.temple) meta.appendChild(U.el('span', null, '신전으로 이어지는 단서'));
    if (q.fromName) meta.appendChild(U.el('span', null, q.fromName + '에서'));
    if (q.tick != null) meta.appendChild(U.el('span', null, q.tick + '일째'));
    box.appendChild(meta);
    return box;
  }

  /* ══════════ ★ 3단계A — 밟아 온 길 (흔적 사슬 기록) ══════════
     흔적은 조사하면 사라진다. 세 걸음을 다 걸어 결말을 본 사슬도 이튿날 지도에는 자국이 없어서,
     어떤 이야기를 끝냈고 어떤 이야기가 중간에 멈춰 있는지 물어볼 데가 없었다. */
  function paintTrails(host, c) {
    var list = c.trails || [];
    if (!list.length) return;
    var done = 0;
    list.forEach(function (r) { if (r.done) done += 1; });
    host.appendChild(U.el('div', 'codex-sub',
      '밟아 온 길 — 끝까지 간 이야기 ' + done + ' / ' + list.length));
    var wrap = U.el('div', 'trail-list');
    list.forEach(function (r) {
      var row = U.el('div', 'trail-row' + (r.done ? '' : ' walking'));
      row.appendChild(U.el('span', 'nm', r.name || '이름 없는 길'));
      row.appendChild(U.el('span', 'pg', (r.step || 0) + '/' + (r.steps || 0) + '걸음'));
      row.appendChild(U.el('span', 'end',
        r.done ? (r.endingName || '끝을 보았다') : '가는 중'));
      wrap.appendChild(row);
    });
    host.appendChild(wrap);
  }

  function paintRuins(host, c) {
    paintClues(host, c);
    paintTrails(host, c);
    var list = c.ruins || [];
    if (!list.length) {
      host.appendChild(U.el('p', 'empty', '아직 찾은 옛 자취가 없습니다. 멀리 나가 보십시오.'));
      return;
    }
    host.appendChild(U.el('div', 'codex-sub', '찾아낸 옛 자취'));
    var wrap = U.el('div', 'codex-ruins');
    list.forEach(function (r) {
      var row = U.el('div', 'codex-ruin');
      row.appendChild(U.el('span', 'sz', r.size + '×' + r.size));
      row.appendChild(U.el('span', 'nm', r.name || '옛 자취'));
      row.appendChild(U.el('span', 'pos', '(' + r.x + ', ' + r.y + ')'));
      /* ★ §22 — 도감이 「뒤진 횟수」만 적으면 **기록**이지 지도가 아니다. 아직 방이 남았는지가
         적혀야 「저기 다시 가야겠다」가 된다 — 유저가 「왜 가야 하는지 모르겠다」던 것의 절반이
         여기 있었다. 다 뒤진 자취는 끝났다고 분명히 말한다(회색 폐허와 같은 말). */
      row.appendChild(U.el('span', 'cy', ruinProgress(r)));
      if (r.concealed) row.appendChild(U.el('span', 'hid', '숨어 있던 곳'));
      row.onclick = function () {
        U.closeTopModal();
        if (GM.camera) GM.camera.moveTo(r.x, r.y);
      };
      wrap.appendChild(row);
    });
    host.appendChild(wrap);
  }

  /* ══════════ ★ §20-R3 유물 층 (유물기획 §20-8) ══════════
     층은 넷이고 **서버가 센다**: 0 미발견(실루엣+힌트) · 1 방에서 발견(이름) ·
     2 우리가 보유(효과+이야기) · 3 기록(최초 발견자·날·횟수).
     잠긴 단은 필드 자체가 오지 않으므로 화면이 지어낼 수 없다(§11-1). */
  function paintRelics(host, c) {
    var a = c.artifacts;
    if (!a) { host.appendChild(U.el('p', 'empty', '아직 적을 것이 없습니다.')); return; }
    var t = a.totals || {};
    host.appendChild(U.el('p', 'hint',
      '세상에 알려진 것 ' + (t.found || 0) + ' / ' + (t.total || 0) + '가지 · 우리가 지닌 것 ' + (t.owned || 0)));
    var crown = (a.cards || []).filter(function (x) { return x.grade === a.crownGrade; });
    var rest = (a.cards || []).filter(function (x) { return x.grade !== a.crownGrade; });
    if (crown.length) host.appendChild(relicSection('왕가의 보물', crown, 'crown'));
    host.appendChild(relicSection('그 밖의 것들', rest, ''));
  }

  function relicSection(title, list, cls) {
    var wrap = U.el('div', 'relic-sect ' + cls);
    wrap.appendChild(U.el('div', 'relic-sect-t', title));
    var grid = U.el('div', 'relic-grid');
    list.forEach(function (r) { grid.appendChild(relicCard(r)); });
    wrap.appendChild(grid);
    return wrap;
  }

  function relicCard(r) {
    var box = U.el('div', 'relic-card' + (r.tier === 0 ? ' unknown' : '') + (r.owned ? ' owned' : ''));
    box.style.setProperty('--relic', r.color || '#9c8f76');
    box.appendChild(relicArt(r));
    box.appendChild(U.el('div', 'relic-name', r.tier === 0 ? '？？？' : r.name));
    box.appendChild(U.el('div', 'relic-grade', S.gradeInfo(r.grade).name + ' · ' + catName(r.category)));
    if (r.tier === 0) box.appendChild(U.el('p', 'relic-hint', r.hint || '이 세계 어딘가에 있습니다.'));
    /* ★ §20-R4b — 세트 뱃지(§20-5). 「왜」 도감에 다나 — 조각을 모으는 일은 하나를 얻은 뒤에
       시작되는 목표라, 「이것이 어느 벌의 한 짝인가」를 카드가 스스로 말해야 한다.
       서버가 아직 이 칸을 안 실을 수 있으므로 **오면 그리고 안 오면 아무것도 그리지 않는다**(§11-1). */
    if (r.setName || r.setKey) box.appendChild(U.el('div', 'relic-grade', '세트: ' + (r.setName || r.setKey)));
    /* ★ §20-R4b — 저주는 도감에서도 유물함과 같은 시각 언어로 보인다(§20-6 「몰래 나쁜 것 금지」).
       main.css 는 다른 트랙의 몫이라 클래스만 얹고 검은 균열은 인라인으로 그린다. */
    if (r.curse || r.cursed) markCursed(box);
    if (r.desc) box.appendChild(U.el('div', 'relic-desc', r.desc));
    if (r.lore) box.appendChild(U.el('p', 'relic-lore', r.lore));
    if (r.record) box.appendChild(relicRecord(r));
    return box;
  }

  /** ★ §20-R4b — 저주 표기. 유물함(artifacts.js curseOverlay)과 같은 균열·같은 붉은 글씨를 쓴다:
      두 화면이 다른 말을 하면 「이것이 나쁜 것인가」를 다시 판단하게 된다. */
  function markCursed(box) {
    box.classList.add('cursed');
    box.style.boxShadow = 'inset 0 0 0 2px rgba(18,8,22,.6), inset 0 -18px 24px -16px #120816';
    var w = U.el('div', 'relic-desc cursed-note', '저주 — 값을 치르는 힘입니다.');
    w.style.color = '#7c2b34';
    box.appendChild(w);
  }

  /** 도트 자리 — 미발견은 실루엣(등급색으로만 보인다). 에셋이 오면 그림만 갈아 끼운다. */
  function relicArt(r) {
    var art = U.el('div', 'relic-art' + (r.tier === 0 ? ' sil' : ''));
    var im = GM.icons.img(CAT_ICON[r.category] || 'gem', 24, '');
    im.className = 'relic-dot';
    art.appendChild(im);
    return art;
  }

  function relicRecord(r) {
    var box = U.el('div', 'relic-rec');
    var d = r.record.firstFoundDate;
    box.appendChild(recRow('최초 발견', r.record.firstFoundBy || '전해지지 않음'));
    if (d) box.appendChild(recRow('그날', d.year + '년 ' + d.day + '일'));
    if (r.record.myFoundRealAt) box.appendChild(recRow('적힌 날', realDate(r.record.myFoundRealAt)));
    box.appendChild(recRow('이 땅에 나온 횟수', (r.record.count || 1) + '번'));
    if (r.owned) box.appendChild(recRow('지금', r.consumed ? '다 썼습니다' : '우리가 지니고 있습니다'));
    return box;
  }

  function recRow(k, v) {
    var row = U.el('div', 'rec-row');
    row.appendChild(U.el('span', 'k', k));
    row.appendChild(U.el('span', 'v', v));
    return row;
  }

  function realDate(iso) {
    var t = new Date(iso);
    if (isNaN(t.getTime())) return iso;
    return (t.getMonth() + 1) + '월 ' + t.getDate() + '일';
  }

  var CAT_ICON = { role: 'scroll', qol: 'gem', combat: 'sword', environment: 'leaf',
                   resource: 'coin', diplomacy: 'flag', tradeoff: 'dice', cosmetic: 'crown' };
  var CAT_NAME = { role: '부처', qol: '살림', combat: '싸움', environment: '하늘과 땅',
                   resource: '곳간', diplomacy: '바깥', tradeoff: '값을 치르는 것', cosmetic: '보기 좋은 것' };
  function catName(c) { return CAT_NAME[c] || c || '—'; }

  function refresh() {
    var m = U.modalOpen('codex');
    if (!m) return;
    var body = m.querySelector('#codex-body');
    if (body) paint(body);
  }

  GM.codex = { open: open, refresh: refresh };
})(window);
