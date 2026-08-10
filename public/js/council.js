/* council.js — 어전 회의(두루마리 모달) · 어전 안건 카드 · 침공 판정 연출 · 소식 두루마리
   기획: 로그인했을 때 먼저 보이는 것은 보고서가 아니라 "판단"이어야 한다 → 안건은 알림 스택 맨 위에 선다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var KIND_KO = {
    trade_offer: '상단의 제안', invasion: '성문 앞의 일', budget: '나라 살림', disaster: '재해',
    diplomacy: '이웃과의 일', council: '어전 안건', build: '공사'
  };
  var OPT_KO = {
    accept: '받아들인다', reject: '물린다', defer: '미뤄 둔다', ignore: '넘긴다',
    yes: '그리한다', no: '하지 않는다', grain: '곡물', wall: '성벽', granary: '곡창',
    buy: '산다', sell: '판다', ok: '알겠다'
  };

  function normDecision(d) {
    return {
      id: d.decisionId || d.id,
      kind: KIND_KO[d.kind] || d.title || d.kind || '어전 안건',
      title: d.title || KIND_KO[d.kind] || '어전 안건',
      text: d.text || d.title || d.summary || '판단이 필요합니다.',
      due: d.expiresTick !== undefined ? d.expiresTick
        : (d.offer && d.offer.expiresTick !== undefined ? d.offer.expiresTick
        : (d.dueTick !== undefined ? d.dueTick : null)),
      urgent: !!(d.urgent || d.kind === 'invasion' || d.priority === 'high'),
      offer: d.offer || null,
      /* ★ §20-R4b — 라벨을 실어 보낸 카드는 그 라벨을 쓴다(신전의 「땅의 문양」·「맞선다」).
         OPT_KO 는 옛 안건들이 열쇠말만 보내던 시절의 대비표다 — 새 카드까지 여기에 적어 넣으면
         한국어가 서버와 화면 두 곳에 살게 되어 언젠가 갈린다. */
      choices: normChoices(d.optionLabels || d.choices || d.options)
    };
  }
  function normChoices(list) {
    if (!list || !list.length) return [{ key: 'ok', label: '알겠다' }];
    return list.map(function (c, i) {
      if (typeof c === 'string') return { key: c, label: OPT_KO[c] || c };
      var k = c.key || c.id || c.value || String(i);
      return { key: k, label: c.label || c.text || c.name || OPT_KO[k] || String(k) };
    });
  }

  /* 결과 미리보기 한 줄 — 상단 제안이면 수치를 미리 셈해 보여 준다 */
  function previewOf(dd) {
    var o = dd.offer;
    if (!o) return null;
    var rm = S.resourceMeta(o.resource);
    var money = U.fmt((o.amount || 0) * (o.price || 0), 0);
    return o.side === 'buy'
      ? '받아들이면: ' + rm.name + ' −' + U.fmt(o.amount, 0) + ', 국고 +' + money
      : '받아들이면: ' + rm.name + ' +' + U.fmt(o.amount, 0) + ', 국고 −' + money;
  }

  function decisionCard(d, onDone) {
    var dd = normDecision(d);
    var c = U.el('div', 'agenda' + (dd.urgent ? ' urgent' : ''));
    c.setAttribute('data-decision', dd.id);
    var head = U.el('div', 'ag-head');
    head.appendChild(U.el('span', null, dd.kind));
    if (dd.due !== null) head.appendChild(U.el('span', null, dd.due + '일까지'));
    c.appendChild(head);
    c.appendChild(U.el('div', 'ag-body', dd.text));
    var pv = previewOf(dd);
    if (pv) c.appendChild(U.el('span', 'ag-preview', pv));

    var box = U.el('div', 'ag-choices');
    /* ★ 2단계A — 유적 카드는 갈래를 하나 눌러도 창이 닫히지 않는다.
       「왜」 — 방 하나를 4~6번 두드려 연 자리가 클릭 한 번으로 끝나고, 무엇을 포기했는지도
       모른 채 떠나게 되어 있었다. 이제 누른 단추만 잠기고, 결과가 카드 안에 한 줄씩 쌓인다.
       창을 닫는 때를 화면이 제 손으로 셈하지 않는 까닭: 「남은 갈래가 있는가」는 자료(closes)와
       이미 고른 것을 함께 봐야 아는 사실이라, 두 곳에서 세면 언젠가 어긋난다 — 서버가 done 으로
       일러 준다. 유적이 아닌 결정(어전·상단·신전)은 옛 그대로 한 번에 닫힌다. */
    var isRuin = !!d.ruin;
    var results = null;
    function resultLine(text) {
      if (!text) return;
      if (!results) { results = U.el('div', 'ag-results'); c.appendChild(results); }
      results.appendChild(U.el('p', 'ag-result', text));
    }
    function lockAll() {
      c.style.opacity = '.45';
      U.qsa('button', c).forEach(function (x) { x.disabled = true; });
    }
    dd.choices.forEach(function (ch, i) {
      var b = U.btn(ch.label, i === 0 ? 'btn-primary' : '', function () {
        if (b.disabled) return;
        b.disabled = true;
        GM.sfx.play('page');
        if (!isRuin) {
          GM.net.send('decide', { decisionId: dd.id, choice: ch.key });
          lockAll();
          if (onDone) onDone(dd.id);
          return;
        }
        GM.net.send('decide', { decisionId: dd.id, choice: ch.key }, function (res) {
          if (!res || res.ok === false) {
            /* 이미 살펴본 갈래거나 카드가 이미 닫혔다 — 단추는 잠근 채 까닭만 알린다 */
            U.toast((res && res.error && res.error.message) || '지금은 고를 수 없습니다.', 'warn');
            return;
          }
          resultLine((res.ruin && res.ruin.text) || '');
          if (res.done) {
            lockAll();
            // 큐에서 내려간 카드의 쪽지를 그 자리에서 거둔다(없는 결정을 여는 줄을 남기지 않는다)
            if (GM.hud && GM.hud.dropFlash) GM.hud.dropFlash('dec:' + dd.id);
            if (onDone) onDone(dd.id);
          }
        });
      });
      b.setAttribute('data-choice', ch.key);
      /* 창을 닫았다 다시 열어도 이미 살펴본 갈래는 잠겨 있다 — 장부(used)는 서버가 쥔다 */
      if (isRuin && (d.used || []).indexOf(ch.key) >= 0) b.disabled = true;
      box.appendChild(b);
    });
    c.appendChild(box);
    if (isRuin) c.appendChild(U.el('span', 'ag-preview', '갈래를 하나씩 살펴볼 수 있습니다. 「떠난다」를 누르면 이 방을 닫습니다.'));
    return c;
  }

  /* 알림에서 안건 하나만 펼치기 */
  function openDecision(d) {
    var dd = normDecision(d);
    /* ★ 2단계A — 같은 카드로 창이 두 번 뜨지 않게. 유적 카드는 이제 두 문으로 온다:
       ① 스윙 ack(즉시·1차 진입점) ② ruinEvent 푸시(알림 스택 실시간 갱신). 둘 다 카드를 쥐고
       있어 가드가 없으면 방을 열 때마다 같은 두루마리가 두 장 겹쳐 떴다. 이미 열려 있으면
       그 창을 그대로 돌려준다 — 닫고 다시 그리면 눌러 둔 갈래와 결과 줄이 날아간다. */
    var already = U.modalOpen('decision:' + dd.id);
    if (already) return already;
    /* ★ 4단계 — 신전은 두루마리 한 장이 아니라 **들어간 방**이어야 한다. 새 씬을 짓지 않는다는
       설계 정본은 그대로 두고(결정 큐 규약 그대로), 이 창의 몸통에 단 이름을 달아 준다 —
       그러면 갈래 단추(.ag-choices)까지 그 단의 옷을 입는다(문양은 크게, 안치소는 금빛으로).
       화면이 단을 셈하지 않는다: 서버가 실어 보낸 temple.stage 를 그대로 이름에 옮길 뿐이다. */
    var body = U.el('div', d.temple ? 'temple-scene temple-scene-' + (d.temple.stage || 'riddle') : null);
    if (d.temple) body.appendChild(templeInterior(d));
    if (d.lore && d.lore.lines && d.lore.lines.length) {
      var lore = U.el('section', 'ruin-lore');
      lore.appendChild(U.el('strong', 'ruin-lore-title', d.lore.title || '탐험 기록'));
      d.lore.lines.forEach(function (line) { lore.appendChild(U.el('p', null, line)); });
      body.appendChild(lore);
    }
    var sp = U.el('div', 'speech');
    var who = dd.kind === '상단의 제안' ? 'trade' : dd.kind === '성문 앞의 일' ? 'defense' : 'build';
    sp.appendChild(GM.icons.portraitImg(who, 58, 'agenda'));
    var sb = U.el('div', 'sp-body');
    sb.appendChild(U.el('span', 'sp-who', S.roleMeta(who).name));
    sb.appendChild(U.el('div', 'sp-line', '전하, 결정을 기다립니다.'));
    sp.appendChild(sb);
    body.appendChild(sp);
    var m = null;
    /* 유적은 마지막 결과 한 줄을 읽을 참을 준다 — 500ms 면 글이 뜨자마자 창이 사라진다 */
    var closeAfter = d.ruin ? 1600 : 500;
    body.appendChild(decisionCard(d, function () { setTimeout(function () { U.closeModal(m); }, closeAfter); }));
    var foot = U.el('div');
    foot.appendChild(U.btn('나중에 본다', 'btn-ghost', function () { U.closeModal(m); }));
    m = U.openModal({ title: dd.title, body: body, footer: foot, width: '600px',
                      key: 'decision:' + dd.id, icon: GM.icons.img('scroll', 22) });
  }

  /* ★ 4단계 — 「고대 신전 내부」를 3단 도식에서 **어두운 석조 방**으로 올린다.
     「왜」 그림 파일을 안 쓰나 — 이 방은 게임에서 세 번(신전 종류마다) 열리는 자리다. 도트를
     한 벌 그려 붙이면 그 뒤로 신전을 열 종류로 늘릴 때마다 그림 빚이 함께 늘고, 로딩할 것도
     한 벌 는다. 여기서 필요한 것은 「밖과 다른 공기」 하나뿐이라 그것은 CSS 로 낼 수 있다:
     돌결(반복 그라디언트) · 횃불 그림자(가장자리 음영) · 지금 선 단의 금빛 맥동.
     이 함수는 뼈대만 세운다 — 색·박자·크기의 정본은 main.css 의 .temple-* 블록이다. */
  var TEMPLE_STEPS = [
    { key: 'riddle', icon: '◇', name: '문양의 전실' },
    { key: 'trial', icon: '⚔', name: '수호자의 회랑' },
    { key: 'vault', icon: '✦', name: '안치소' }
  ];
  var TEMPLE_COPY = {
    riddle: '문양 셋 가운데 하나만 눌립니다. 고르면 돌문이 열리고, 틀리면 며칠 뒤에 다시 설 수 있습니다.',
    trial: '문 안쪽의 수호자를 쓰러뜨려야 안치소의 봉인이 풀립니다.',
    vault: '받침돌 위의 것은 이 신전에서만 나옵니다. 거두면 이 신전은 닫힙니다.'
  };

  function templeInterior(d) {
    var stage = d.temple.stage || 'riddle';
    var box = U.el('section', 'temple-interior temple-' + stage);
    /* 돌벽·횃불 그림자는 순전한 장식이다 — 클릭을 먹지 않게 .decor 를 단다(harness 규약). */
    box.appendChild(U.el('div', 'temple-wall decor'));
    var cap = U.el('div', 'temple-interior-cap');
    cap.appendChild(U.el('span', 'temple-cap-main', '고대 신전 내부'));
    if (d.temple.kindName) cap.appendChild(U.el('span', 'temple-cap-kind', d.temple.kindName));
    box.appendChild(cap);
    var route = U.el('div', 'temple-route');
    var current = TEMPLE_STEPS.findIndex(function (s) { return s.key === stage; });
    TEMPLE_STEPS.forEach(function (s, i) {
      var el = U.el('div', 'temple-step' + (i === current ? ' active' : '') + (i < current ? ' passed' : ''));
      el.appendChild(U.el('span', 'temple-step-icon', s.icon));
      el.appendChild(U.el('span', 'temple-step-name', s.name));
      route.appendChild(el);
    });
    box.appendChild(route);
    box.appendChild(templeStageArt(stage));
    box.appendChild(U.el('p', 'temple-interior-copy', TEMPLE_COPY[stage] || TEMPLE_COPY.riddle));
    return box;
  }

  /* 단마다 다른 한 컷. 전부 장식이라 .decor 를 달고, 뜻은 아래 문장(temple-interior-copy)이 진다. */
  function templeStageArt(stage) {
    var art = U.el('div', 'temple-art temple-art-' + stage + ' decor');
    if (stage === 'riddle') {
      /* 문양의 전실 — 돌문 한 짝과 그 위에 새겨진 문양 셋(고르는 것은 아래 갈래 단추다) */
      var door = U.el('div', 'temple-door');
      ['◇', '≈', '△'].forEach(function (g) { door.appendChild(U.el('span', 'temple-sigil', g)); });
      art.appendChild(door);
      return art;
    }
    if (stage === 'trial') {
      /* 수호자의 회랑 — 열린 문틈의 빛과 그 앞에 선 그림자 */
      art.appendChild(U.el('div', 'temple-gate'));
      art.appendChild(U.el('div', 'temple-guardian'));
      return art;
    }
    /* 안치소 — 천장 틈으로 내려온 빛줄기 · 받침돌 · 그 위의 유물 실루엣 */
    art.appendChild(U.el('div', 'temple-shaft'));
    art.appendChild(U.el('div', 'temple-relic'));
    art.appendChild(U.el('div', 'temple-plinth'));
    return art;
  }

  /* ══════════ 어전 회의 ══════════ */
  function openCouncil(c) {
    var body = U.el('div');

    var metrics = summaryMetrics(c.summary);
    if (metrics) body.appendChild(metrics);

    body.appendChild(U.el('h3', 'sec-title', '각료의 보고'));
    var speeches = normSummary(c.summary, c.agenda);
    var speechBox = U.el('div');
    body.appendChild(speechBox);

    if (c.agenda && c.agenda.length) {
      body.appendChild(U.el('h3', 'sec-title', '오늘의 안건'));
      var sc = U.el('div', 'scroll-card');
      var ul = U.el('ul');
      (Array.isArray(c.agenda) ? c.agenda : [c.agenda]).forEach(function (a) {
        ul.appendChild(U.el('li', null, typeof a === 'string' ? a : (a.text || a.title || '')));
      });
      sc.appendChild(ul);
      body.appendChild(sc);
    }

    var decs = c.decisions || [];
    if (decs.length) {
      body.appendChild(U.el('h3', 'sec-title', '결정'));
      var dbox = U.el('div');
      decs.forEach(function (d) { dbox.appendChild(decisionCard(d)); });
      body.appendChild(dbox);
    }

    var chestHost = U.el('div');
    body.appendChild(chestHost);

    var foot = U.el('div');
    var close = U.btn('회의를 마친다', 'btn-primary');
    close.id = 'council-close';
    foot.appendChild(close);

    var modal = U.openModal({
      title: '어전 회의', body: body, footer: foot, width: '800px', key: 'council',
      icon: GM.icons.img('crown', 22),
      onClose: function () { if (c.councilId) GM.net.send('councilAck', { councilId: c.councilId }); }
    });
    close.onclick = function () { U.closeModal(modal); };

    typeSpeeches(speechBox, speeches, function () {
      if (c.artifactDrop) {
        chestHost.appendChild(U.el('h3', 'sec-title', '땅이 내어준 것'));
        GM.artifacts.openChest(c.artifactDrop, chestHost, function () {
          U.toast('유물을 찾았습니다.', 'good', 4600);
        });
      }
    });
    return modal;
  }

  function summaryMetrics(sum) {
    if (!sum || typeof sum !== 'object' || Array.isArray(sum)) return null;
    if (sum.population === undefined && sum.gold === undefined && sum.resources === undefined) return null;
    var wrap = U.el('div');
    wrap.appendChild(U.el('h3', 'sec-title', '나라 형편'));
    var g = U.el('div', 'stat-grid');
    function card(name, val, sub) {
      var c = U.el('div', 'stat');
      c.appendChild(U.el('span', 's-name', name));
      c.appendChild(U.el('span', 'num s-val', val));
      if (sub) c.appendChild(U.el('span', 's-sub', sub));
      g.appendChild(c);
    }
    if (sum.population !== undefined) card('백성', U.fmt(sum.population, 0) + '명',
      sum.populationCap ? '최대 ' + U.fmt(sum.populationCap, 0) : null);
    if (sum.morale !== undefined) card('민심', U.fixed(sum.morale, 2), null);
    if (sum.gold !== undefined) card('국고', U.fmt(sum.gold, 0), null);
    if (sum.defense) card('성문 앞', U.fmt((sum.defense.permanent || 0) + (sum.defense.surge || 0), 0),
      '굳은 ' + U.fmt(sum.defense.permanent, 0) + ' + 모은 ' + U.fmt(sum.defense.surge, 0));
    if (sum.resources) {
      S.RESOURCES.forEach(function (r) {
        if (sum.resources[r.key] === undefined) return;
        card(r.name, U.fmt(sum.resources[r.key], 0), null);
      });
    }
    wrap.appendChild(g);
    return wrap;
  }

  function normSummary(sum, agenda) {
    if (!sum) return [];
    if (typeof sum === 'string') return [{ role: null, text: sum }];
    if (Array.isArray(sum)) {
      return sum.map(function (s0) {
        if (typeof s0 === 'string') return { role: null, text: s0 };
        return { role: s0.role || s0.who || null, text: s0.text || s0.line || s0.message || '' };
      });
    }
    if (sum.roles) {
      var AGENDA_ROLE = { invasion: 'defense', budget: 'trade', build: 'build',
                          trade: 'trade', disaster: 'farm', diplomacy: 'trade' };
      var byRole = {}, leftover = [];
      (agenda || []).forEach(function (a) {
        var kind = (typeof a === 'object' && a.kind) ? a.kind : null;
        var txt = (typeof a === 'string') ? a : (a.text || '');
        var rk = AGENDA_ROLE[kind];
        if (rk && !byRole[rk]) byRole[rk] = txt; else leftover.push(txt);
      });
      var lines = [];
      S.ROLES.forEach(function (r) {
        var info = sum.roles[r.key];
        if (!info) return;
        var who = info.npcName ? (info.npcName + ' ' + r.name) : r.name;
        var t;
        if (!info.holder) t = '(이 자리는 비어 있습니다 — ' + r.vacancy + ')';
        else {
          t = byRole[r.key] || GM.hud.brief(r.key, S.nation());
          if (leftover.length && !byRole[r.key]) t = leftover.shift();
        }
        lines.push({ role: r.key, who: who, text: t });
      });
      return lines;
    }
    return Object.keys(sum).map(function (k) { return { role: k, text: String(sum[k]) }; });
  }

  function typeSpeeches(host, list, onDone) {
    var i = 0;
    function next() {
      if (i >= list.length) { if (onDone) onDone(); return; }
      var s = list[i++];
      var row = U.el('div', 'speech');
      row.appendChild(GM.icons.portraitImg(s.role || 'build', 58, 'council'));
      var b = U.el('div', 'sp-body');
      b.appendChild(U.el('span', 'sp-who', s.who || (s.role ? S.roleMeta(s.role).name : '신하')));
      var line = U.el('div', 'sp-line typing');
      b.appendChild(line);
      row.appendChild(b);
      host.appendChild(row);

      var full = s.text || '', k = 0;
      var iv = setInterval(function () {
        k += 2;
        line.textContent = full.slice(0, k);
        if (k >= full.length) {
          clearInterval(iv);
          line.classList.remove('typing');
          setTimeout(next, 200);
        }
      }, 18);
    }
    next();
  }

  /* ══════════ 침공 판정 — 연출은 월드 위 타워디펜스 리플레이(combat.js)가 맡는다 ══════════ */
  function openInvasionResult(r) {
    return GM.combat.onResult(r);
  }

  /* ══════════ 소식 두루마리 (치세 보고서 + 사건 기록) ══════════ */
  function openChronicle() {
    var body = U.el('div');
    var r = S.S.report;
    if (r) {
      body.appendChild(U.el('h3', 'sec-title', '자리를 비운 사이'));
      var sc = U.el('div', 'scroll-card');
      var ul = U.el('ul');
      (r.lines || []).forEach(function (l) { ul.appendChild(U.el('li', null, l)); });
      sc.appendChild(ul);
      body.appendChild(sc);
      if (r.deltas) {
        var g = U.el('div', 'stat-grid');
        Object.keys(r.deltas).forEach(function (k) {
          var c = U.el('div', 'stat');
          c.appendChild(U.el('span', 's-name', labelOf(k)));
          var v = r.deltas[k];
          var vs = U.el('span', 'num s-val', typeof v === 'number' ? U.signed(v, 0) : String(v));
          vs.style.color = (typeof v === 'number' && v < 0) ? '#7d2a2c' : '#446b32';
          c.appendChild(vs);
          g.appendChild(c);
        });
        body.appendChild(g);
      }
    }
    body.appendChild(U.el('h3', 'sec-title', '요즘 소식'));
    var evs = S.S.events || [];
    if (!evs.length) body.appendChild(U.el('div', 'empty', '조용합니다.'));
    else {
      var list = U.el('div', 'rowlist');
      evs.slice(0, 60).forEach(function (e) {
        var row = U.row();
        row.appendChild(U.el('span', 'row-name', (e.tick !== undefined ? e.tick + '일' : '—')));
        row.appendChild(U.el('span', 'row-cost', e.text || ''));
        list.appendChild(row);
      });
      body.appendChild(list);
    }
    var foot = U.el('div');
    foot.appendChild(U.btn('덮는다', 'btn-primary', function () { U.closeTopModal(); }));
    U.openModal({ title: '나라의 기록', body: body, footer: foot, width: '660px', key: 'chronicle',
                  icon: GM.icons.img('scroll', 22) });
  }
  function labelOf(k) {
    if (k === 'gold') return '국고';
    if (k === 'population') return '백성';
    if (k === 'morale') return '민심';
    return S.resourceMeta(k).name;
  }

  GM.council = {
    openCouncil: openCouncil, openDecision: openDecision, openInvasionResult: openInvasionResult,
    decisionCard: decisionCard, openChronicle: openChronicle
  };
})(window);
