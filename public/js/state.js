/* state.js — 클라이언트 상태 저장소 + 도메인 메타데이터 (프로토콜 v3.1)
   서버 권위. 여기 담긴 값은 전부 서버가 보낸 것의 사본이며, 클라는 표시와 명령 제출만 한다.
   ★ v3 — 엔드리스 정착지 성장. 시즌·개척령·성곽 링·백성 무리는 없다.
     성장 아크(state.tier)와 점진 공개(state.unlocked)가 화면을 켜고 끈다.
   ★ v3.1 — 진행 감독(state.chapter). 「시간은 아무것도 열지 않는다」(GDD3 §11).
     목표 카드 한 장·퀘스트 마커·해금은 전부 이 블록에서 나온다. 잠긴 계층은 뷰에 아예 없다.
   ★ 안개는 서버 확정본 + 아바타 주변 로컬 예측을 겹쳐 본다 (GDD3 §8). */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};

  /* ★ 규약 판번호 — server/index.js 의 PROTOCOL 과 반드시 같아야 한다. */
  GM.PROTOCOL = '3.3';

  /* ── 재화 ───────────────────────────────────────────── */
  var RESOURCES = [
    { key: 'grain',   name: '곡물',   color: '#e0c65a' },
    { key: 'wood',    name: '목재',   color: '#a3703f' },
    { key: 'stone',   name: '석재',   color: '#9aa0a8' },
    { key: 'ironOre', name: '철광석', color: '#b07050' },
    /* ★ GDD3 §13-D-5 — 「석탄 채굴」 연구가 열기 전에는 세상에 한 톨도 없다 */
    { key: 'coal',    name: '석탄',   color: '#4a4a52' },
    { key: 'oil',     name: '석유',   color: '#6f5aa8' },
    { key: 'steel',   name: '강재',   color: '#a8bccc' },
    { key: 'fuel',    name: '연료',   color: '#e08541' },
    /* ★ GDD3 §13-C-1 — 사냥이 들여온 셋. 고기는 곳간의 곡물이 떨어졌을 때 사람을 먹인다. */
    { key: 'meat',    name: '고기',   color: '#c4614c' },
    { key: 'hide',    name: '가죽',   color: '#9a7448' },
    { key: 'wool',    name: '털',     color: '#e2ddd0' }
  ];
  /* 야영지 HUD 는 이 셋만 보여준다 (GDD3 §2) */
  var BASIC3 = ['wood', 'grain', 'stone'];

  /* ── 개인 스킬 5종 ──────────────────────────────────── */
  var SKILLS = [
    { key: 'farm',   name: '농사', color: '#6a994e', icon: 'hoe' },
    { key: 'lumber', name: '벌목', color: '#a3703f', icon: 'axe' },
    { key: 'mining', name: '채광', color: '#9aa0a8', icon: 'pickaxe' },
    { key: 'build',  name: '건설', color: '#c8965a', icon: 'hammer' },
    { key: 'combat', name: '전투', color: '#bc4749', icon: 'sword' }
  ];

  /* ── 각료 6 (티어 3 이후) ───────────────────────────── */
  var ROLES = [
    { key: 'farm', name: '농정관', tier: 0, color: '#6a994e', stars: 1,
      line: '밭과 곳간을 살핀다. 사람이 굶지 않게 하는 자리.',
      forWhom: '처음 정착지를 세워 보는 분께',
      info: '땅의 지침과 다음 수확 예보', vacancy: '수확이 3분의 2로 줄고 땅이 해마다 지친다' },
    { key: 'factory', name: '공장장', tier: 0, color: '#8d7f6a', stars: 2,
      line: '용광로와 정유 가마를 돌린다. 쇠와 기름의 자리.',
      forWhom: '물건 만드는 순서를 짜는 게 즐거운 분께',
      info: '어느 공정이 막혔는지·창고가 도는 속도', vacancy: '산출이 3분의 2로 줄고 캐낸 철광석이 버려진다' },
    { key: 'build', name: '건축가', tier: 1, color: '#c8965a', stars: 2,
      line: '집과 곳간을 올린다. 남는 것을 형태로 바꾸는 자리.',
      forWhom: '무언가 지어 올리는 맛을 아는 분께',
      info: '건물의 튼튼함과 이웃한 땅의 덕', vacancy: '산출이 3분의 2로 줄고 개축이 막힌다' },
    { key: 'defense', name: '국방대신', tier: 1, color: '#bc4749', stars: 3,
      line: '울타리 앞에 설 사람을 셈한다. 밀려오는 무리를 맞는 자리.',
      forWhom: '아슬아슬한 계산을 즐기는 분께',
      info: '몰려오는 무리의 규모와 울타리의 약한 자리', vacancy: '민병의 힘이 크게 깎이고 자동 배치가 막힌다' },
    { key: 'trade', name: '외교관', tier: 2, color: '#4a6fa5', stars: 3,
      line: '이웃과 값을 흥정한다. 눈을 뜨고 장사하게 해주는 자리.',
      forWhom: '싸게 사서 비싸게 파는 재미를 아는 분께',
      info: '이웃 나라의 값과 뱃삯', vacancy: '이웃 값이 가려지고 흥정이 20% 불리해진다' },
    { key: 'saint', name: '성녀', tier: 2, color: '#8367a8', stars: 2,
      line: '다가오는 날을 미리 본다. 숫자가 아니라 때를 읽는 자리.',
      forWhom: '계산보다 타이밍이 좋은 분께',
      info: '밀려오는 날짜와 성역의 빛', vacancy: '밀려오는 날이 끝까지 흐릿하게 남는다' }
  ];

  var LABOR = [
    { key: 'farm',    name: '밭일',   color: '#6a994e' },
    { key: 'factory', name: '공방일', color: '#8d7f6a' },
    { key: 'build',   name: '공사',   color: '#c8965a' },
    { key: 'defense', name: '수비',   color: '#bc4749' },
    { key: 'trade',   name: '장사',   color: '#4a6fa5' }
  ];

  /* ── 주민의 일 10종 ────────────────────────────────── */
  var JOBS = [
    { key: 'farm',    name: '농부',   color: '#6a994e', icon: 'hoe' },
    { key: 'lumber',  name: '나무꾼', color: '#a3703f', icon: 'axe' },
    { key: 'quarry',  name: '석공',   color: '#9aa0a8', icon: 'pickaxe' },
    { key: 'mine',    name: '광부',   color: '#b07050', icon: 'pickaxe' },
    { key: 'factory', name: '공방',   color: '#8d7f6a', icon: 'anvil' },
    { key: 'build',   name: '건설',   color: '#c8965a', icon: 'hammer' },
    { key: 'defense', name: '수비',   color: '#bc4749', icon: 'shield' },
    { key: 'trade',   name: '장사',   color: '#4a6fa5', icon: 'ship' },
    { key: 'scout',   name: '정찰',   color: '#e8a33d', icon: 'eye' },
    { key: 'idle',    name: '쉬는 중', color: '#9c8f76', icon: 'folk' }
  ];

  /* 배치대 갈래 — config.buildings.categories 가 정본, 이건 차례와 안내 문구다 */
  var BUILD_CATEGORIES = [
    { key: 'housing',    name: '주거', hint: '사람이 들어와 살 자리' },
    { key: 'production', name: '생산', hint: '곳간과 살림을 불린다' },
    { key: 'military',   name: '군사', hint: '울타리 앞을 지킨다' },
    { key: 'civic',      name: '발전', hint: '정착지를 키운다' },
    { key: 'decor',      name: '장식', hint: '보기 좋은 것이 사람을 부른다' }
  ];

  var TOOLS = [
    { key: 'hoe',     name: '괭이',   max: 3, effect: '밭일 수확이 10/20/35% 늘어난다' },
    { key: 'pickaxe', name: '곡괭이', max: 3, effect: '캐낸 광석이 10/20/35% 늘어난다' },
    { key: 'weapon',  name: '무기',   max: 3, effect: '싸울 힘이 20/50/100 붙는다 (되팔면 6할을 돌려받는다)' }
  ];

  /* ── 지형 (RLE 값의 순서 = config.world.terrain.codes) ── */
  var TERRAIN = [
    { key: 'grass',   name: '풀밭',      color: '#7d9b4e', color2: '#8fae5c' },
    { key: 'forest',  name: '숲',        color: '#456b39', color2: '#527a42' },
    { key: 'rock',    name: '바위 노두',  color: '#8b8577', color2: '#9c968a' },
    { key: 'water',   name: '물',        color: '#3f6f96', color2: '#4d81ab' },
    { key: 'fertile', name: '기름진 땅',  color: '#9c8341', color2: '#ae944e' }
  ];

  /* ── 자원 자리(노드) ── */
  var NODES = {
    forest:  { name: '나무',      color: '#3f6130', job: 'lumber', res: 'wood',    verb: '벤다',   skill: 'lumber', icon: 'tree' },
    berry:   { name: '딸기 덤불', color: '#b8434f', job: 'farm',   res: 'grain',   verb: '딴다',   skill: 'farm',   icon: 'grain' },
    rock:    { name: '바위',      color: '#7e848c', job: 'quarry', res: 'stone',   verb: '캔다',   skill: 'mining', icon: 'stone' },
    fertile: { name: '기름진 땅', color: '#c8a24a', job: 'farm',   res: 'grain',   verb: '거둔다', skill: 'farm',   icon: 'farmTile' },
    water:   { name: '물가',      color: '#4a6fa5', job: 'farm',   res: 'grain',   verb: '건진다', skill: 'farm',   icon: 'ship' },
    iron:    { name: '철광맥',    color: '#b07050', job: 'mine',   res: 'ironOre', verb: '캔다',   skill: 'mining', icon: 'ore' },
    coal:    { name: '석탄 노두',  color: '#4a4a52', job: 'mine',   res: 'coal',    verb: '캔다',   skill: 'mining', icon: 'coal' },
    oil:     { name: '유막',      color: '#6f5aa8', job: 'mine',   res: 'oil',     verb: '퍼낸다', skill: 'mining', icon: 'oil' },
    ruin:    { name: '옛 자취',   color: '#b39ad6', job: 'scout',  res: null,      verb: '살핀다', skill: 'build',  icon: 'gem' },
    field:   { name: '밭',        color: '#e0c65a', job: 'farm',   res: 'grain',   verb: '거둔다', skill: 'farm',   icon: 'farmTile' }
  };

  var GRADES = {
    common:    { name: '흔한 것',   cls: 'g-common',    color: '#9c8f76' },
    uncommon:  { name: '쓸 만한 것', cls: 'g-uncommon',  color: '#6a994e' },
    rare:      { name: '귀한 것',   cls: 'g-rare',      color: '#4a6fa5' },
    unique:    { name: '하나뿐인 것', cls: 'g-unique',  color: '#8367a8' },
    legendary: { name: '전설의 것', cls: 'g-legendary', color: '#e8a33d' },
    fixed:     { name: '약속된 것', cls: 'g-legendary', color: '#e8a33d' }
  };

  /* ── 웨이브 적 6종 (config.waves.types 가 정본) ── */
  var ENEMIES = {
    wolf:   { name: '늑대 떼', icon: 'wolf',   color: '#8a8070' },
    bandit: { name: '도적',    icon: 'bandit', color: '#7a5a48' },
    pirate: { name: '해적',    icon: 'pirate', color: '#5a4038' },
    viking: { name: '바이킹',  icon: 'viking', color: '#6b7580' },
    ogre:   { name: '오우거',  icon: 'ogre',   color: '#6b7a4a' },
    dragon: { name: '용',      icon: 'dragon', color: '#4a7040' }
  };

  var DIRECTION = {
    sea:   { name: '바다', dx: -1, dy: 0.2 },
    north: { name: '북쪽', dx: 0, dy: -1 },
    east:  { name: '동쪽', dx: 1, dy: 0 },
    west:  { name: '서쪽', dx: -1, dy: 0 },
    south: { name: '남쪽', dx: 0, dy: 1 }
  };

  var NATION_COLORS = ['#e8a33d', '#bc4749', '#6a994e', '#4a6fa5', '#8367a8', '#e08541'];

  /* 하루 4구간 — 조명·분위기 (GDD3 §5 · §12-10 · ★ §13-A-2 밝기 완화)
     alpha 는 화면 전체에 덮는 **어둠**, lift 는 그 위에 더하는 **빛**(lighter 합성),
     sky/ground 는 위아래로 얹는 세로 그라데이션이다.

     ★ §13-A-2 — 플레이테스트 2차: "밤이 칠흑이라 아무것도 안 보인다".
       밤을 없애지 않고 **달빛으로 바꾼다**: 어둠을 0.70 → 0.44 로 줄이고 틴트를 먹빛 남색(#0b1440)에서
       달빛 남색(#22305e)으로 올린 뒤, 푸른 lift 를 얹어 '빛이 없는 곳'이 아니라 '푸르게 밝은 밤'이 되게 했다.
       낮은 alpha 가 이미 0 이라 더 뺄 어둠이 없어, 따뜻한 lift 를 더해 소폭 올렸다.
     이 표는 data/world.json 의 light.phases 가 정본이고, 아래 값은 설정을 못 받았을 때의 폴백이다. */
  var DAY_PHASES_FALLBACK = [
    /* 아침 — 첫머리에 새벽빛이 하늘 쪽부터 걷힌다 */
    { key: 'morning', name: '아침', tint: '#3a4a88', alpha: 0.22, lift: 0.05, liftColor: '#ffd9a8', vision: 0.94,
      sky: 'rgba(255,168,120,.30)', ground: 'rgba(38,48,108,.16)' },
    { key: 'day',     name: '낮',   tint: '#ffffff', alpha: 0,    lift: 0.09, liftColor: '#fff4d8', vision: 1,
      sky: null, ground: null },
    /* 저녁 — 노을이 하늘을 물들이고 땅부터 어두워진다 */
    { key: 'evening', name: '저녁', tint: '#e8663a', alpha: 0.18, lift: 0.05, liftColor: '#ffc890', vision: 0.96,
      sky: 'rgba(255,132,70,.32)', ground: 'rgba(58,40,92,.20)' },
    /* 밤 — 달빛. 어둡되 캄캄하지 않다 */
    { key: 'night',   name: '밤',   tint: '#16214a', alpha: 0.60, lift: 0.05, liftColor: '#b9cdff', vision: 0.80,
      sky: 'rgba(20,30,74,.20)', ground: 'rgba(14,20,52,.22)' }
  ];
  var LIGHT_FALLBACK = {
    phases: DAY_PHASES_FALLBACK, fogVeil: 0.30, buildVeil: 0.18, minLuma: 48,
    brightness: { min: 0.6, max: 1.6, step: 0.05, default: 1, darkPerStep: 1, liftPerStep: 0.22 }
  };
  /* 화면이 실제로 읽는 표 — 설정이 오면 lightCfg() 가 갈아 끼운다 */
  var DAY_PHASES = DAY_PHASES_FALLBACK.slice();

  var STAGE_NAMES = { sown: '파종', sprout: '새싹', grow: '자라는 중', ripe: '여물었다' };

  /* ── 저장소 ───────────────────────────────────────────── */
  var S = {
    mock: false, connected: false, joining: false,
    gameId: null, nationId: null, avatarId: null,
    you: { role: null, appearance: null },
    config: null,

    view: null, prevView: null,
    worldState: null,
    map: null,

    avatars: [],
    chat: [],
    mandate: null,
    battle: null,          // 진행 중인 전투 스냅샷 (battleStart/battleTick)
    lastWave: null,

    events: [], offers: [],
    council: null, report: null, emotionDay: null, chronicle: null,

    screen: 'title',       // title | found | load | game
    opening: false,        // 마차 도착 연출 중
    selection: { residents: [], nodeId: null, structureId: null, siteId: null, fenceId: null, enemyId: null },
    placing: null,         // {kind:'build'|'fence'|'reclaim', key?, tier?}
    dismissed: {},
    seenUi: {},            // 이미 코치마크를 보여 준 해금 키
    muted: false,
    joinAppearance: null,
    dayFraction: 0,        // 오늘이 얼마나 지났는가 (0~1, 클라 시계)

    boot: { phase: 'idle', title: null, hint: null }
  };

  var subs = {};
  function on(evt, fn) { (subs[evt] = subs[evt] || []).push(fn); return function () { off(evt, fn); }; }
  function off(evt, fn) { var a = subs[evt]; if (!a) return; var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  function emit(evt, data) {
    var a = subs[evt];
    if (a) { var c = a.slice(); for (var i = 0; i < c.length; i++) { try { c[i](data); } catch (e) { console.error('[state] ' + evt, e); } } }
    var w = subs['*']; if (w) for (var j = 0; j < w.length; j++) { try { w[j](evt, data); } catch (e2) {} }
  }
  function set(patch, evt) {
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) S[k] = patch[k];
    if (evt) emit(evt, S[evt] !== undefined ? S[evt] : patch);
    emit('change', S);
  }

  /* ══════════ 월드 스냅샷 ══════════ */
  function decodeRleInto(rle, arr) {
    var i = 0, p = 0;
    while (i < rle.length - 1) {
      var v = rle[i], n = rle[i + 1];
      for (var k = 0; k < n && p < arr.length; k++) arr[p++] = v;
      i += 2;
    }
    return arr;
  }

  function decodeFogChunk(entry, chunk, size, fog) {
    var cx = entry[0], cy = entry[1];
    var x0 = cx * chunk, y0 = cy * chunk;
    var w = Math.min(chunk, size - x0), h = Math.min(chunk, size - y0);
    var idx = 0;
    for (var i = 2; i < entry.length - 1; i += 2) {
      var v = entry[i], n = entry[i + 1];
      for (var k = 0; k < n; k++) {
        var yy = y0 + Math.floor(idx / w), xx = x0 + (idx % w);
        if (yy < y0 + h && xx < size && yy < size) fog[yy * size + xx] = v;
        idx++;
      }
    }
  }

  function setBoot(phase, title, hint) {
    S.boot = { phase: phase, title: title || null, hint: hint || null };
    emit('boot', S.boot);
    emit('change', S);
  }

  function applyWorld(w) {
    try { return applyWorldInner(w); }
    catch (e) {
      console.error('[state] 월드 스냅샷을 풀지 못했습니다', e);
      setBoot('failed', '지도를 펼치지 못했습니다',
        '서버가 보낸 땅의 모양을 읽지 못했습니다. 서버를 다시 켜 주세요.');
      return undefined;
    }
  }

  function applyWorldInner(w) {
    if (!w || !w.size) {
      setBoot('failed', '지도가 비어 왔습니다', '서버가 땅을 그리지 못했습니다. 서버를 다시 켜 주세요.');
      return;
    }
    var size = w.size;
    var terrain = new Uint8Array(size * size);
    if (w.terrain && w.terrain.rle) decodeRleInto(w.terrain.rle, terrain);
    var fog = new Uint8Array(size * size);
    var chunk = (w.fog && w.fog.chunk) || 16;
    if (w.fog && w.fog.chunks) {
      for (var i = 0; i < w.fog.chunks.length; i++) decodeFogChunk(w.fog.chunks[i], chunk, size, fog);
    }
    var nodes = {};
    (w.nodes || []).forEach(function (n) { nodes[n.id] = n; });
    S.map = {
      size: size, seed: w.seed, tick: w.tick,
      codes: (w.terrain && w.terrain.codes) || TERRAIN.map(function (t) { return t.key; }),
      terrain: terrain, fog: fog, fogChunk: chunk,
      /* ★ GDD3 §8 — 클라 예측 안개. 0 모름 / 1 가 본 적 있음 / 2 지금 보인다 */
      localFog: new Uint8Array(size * size),
      localDisc: [],
      nodes: nodes, nodeArr: null, nodesDirty: true,
      /* ★ GDD3 §13-B-1 — 자원 군락. 바닥 질감을 지역마다 달리 칠하는 근거다. */
      clusters: w.clusters || [],
      /* ★ GDD3 §13-B-5 — 위험 띠 경계(본부 기준 반지름 둘) */
      rings: w.rings || null,
      /* ★ GDD3 §13-C — 들에 사는 것들. 서버가 좌표의 주인이고 화면은 그 사이를 보간한다. */
      creatures: [],
      towns: w.towns || [],
      caravans: w.caravans || [],
      territory: w.territory || null,
      structures: w.structures || [],
      fences: w.fences || [],
      camps: [],
      tier: w.tier || 0,
      dirty: true, fogDirty: true
    };
    S.boot = { phase: 'idle', title: null, hint: null };
    emit('world', S.map);
    emit('change', S);
  }

  function applyWorldDiff(d) {
    try { applyWorldDiffInner(d); }
    catch (e) { console.error('[state] 월드 변경분을 풀지 못했습니다', e); }
  }

  function applyWorldDiffInner(d) {
    var m = S.map;
    if (!m || !d) return;
    if (d.fog && d.fog.length) {
      for (var i = 0; i < d.fog.length; i++) decodeFogChunk(d.fog[i], m.fogChunk, m.size, m.fog);
      m.fogDirty = true;
    }
    if (d.nodes && d.nodes.length) {
      d.nodes.forEach(function (n) { m.nodes[n.id] = n; });
      m.nodesDirty = true;
    }
    /* ★ §17-12 — 걷어 낸 자리. diff 는 '있는 노드'만 실으므로 지워진 것은 이 목록으로 지운다.
       안 지우면 유령 나무가 화면에 영영 남는다(서버 removeNode 의 장부). */
    if (d.removedNodes && d.removedNodes.length) {
      for (var rn = 0; rn < d.removedNodes.length; rn++) dropNode(d.removedNodes[rn]);
    }
    if (d.towns) {
      d.towns.forEach(function (t) {
        var found = null;
        for (var k = 0; k < m.towns.length; k++) if (m.towns[k].nationId === t.nationId) found = m.towns[k];
        if (found) { found.x = t.x; found.y = t.y; found.radius = t.radius; found.known = t.known; }
        else m.towns.push(t);
      });
    }
    if (d.territory && d.territory.radius != null) m.territory = d.territory;
    /* ★ §13-B-1·5 — 군락과 위험 띠. 둘 다 id/값을 통째로 갈아 끼운다(누적이 아니다). */
    if (d.clusters && d.clusters.length) {
      var seen = {};
      var merged = d.clusters.slice();
      for (var ci = 0; ci < merged.length; ci++) seen[merged[ci].id] = true;
      for (var cj = 0; cj < (m.clusters || []).length; cj++) {
        if (!seen[m.clusters[cj].id]) merged.push(m.clusters[cj]);
      }
      m.clusters = merged;
    }
    if (d.rings) m.rings = d.rings;
    if (d.creatures) applyCreatures(d.creatures);
    /* ★ §12-6 — 상단은 무역이 열린 뒤에야 목록에 실린다. 열리기 전에는 늘 빈 배열이 온다. */
    if (d.caravans) m.caravans = d.caravans;
    if (d.camps) m.camps = d.camps;
    if (d.avatars) S.avatars = d.avatars;
    if (d.structures && d.structures.length) m.structures = d.structures;
    if (d.fences && d.fences.length) m.fences = d.fences;
    m.tick = d.tick;
    emit('worldDiff', d);
    emit('change', S);
  }

  /* ══════════ ★ 안개 로컬 예측 (GDD3 §8) ══════════
     서버는 하루 한 번만 안개를 다시 계산한다 — 그 사이 검은 땅으로 걸어 들어가면
     아무것도 안 보이는 사고가 난다. 그래서 아바타 둘레는 클라가 곧바로 밝힌다.
     서버 확정본이 오면 둘 중 밝은 쪽을 쓴다(겹쳐 보기). */
  function visionRadius() {
    var w = worldCfg();
    var base = (w && w.fog && w.fog.vision && w.fog.vision.lord) || 9;
    /* ★ GDD3 §12-8 — 정착지가 클수록 세상이 넓게 보인다 (서버 fog.visionTierBonus 와 같은 식) */
    var per = (w && w.fog && w.fog.visionPerTier) || 0;
    var night = phaseIndex() === 3 ? ((w && w.fog && w.fog.nightVisionMultiplier) || 0.8) : 1;
    return Math.max(3, (base + per * tierNo()) * night);
  }

  /** 아바타 자리를 중심으로 곧바로 밝힌다. 지난 자리는 '가 본 적 있음(1)'으로 남는다. */
  function revealAround(cx, cy, radius) {
    var m = S.map;
    if (!m) return 0;
    var r = radius === undefined ? visionRadius() : radius;
    var size = m.size, lf = m.localFog;
    for (var i = 0; i < m.localDisc.length; i++) {
      var idx = m.localDisc[i];
      if (lf[idx] === 2) lf[idx] = 1;
    }
    var disc = [];
    var r2 = r * r;
    var x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(size - 1, Math.ceil(cx + r));
    var y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(size - 1, Math.ceil(cy + r));
    var fresh = 0;
    for (var y = y0; y <= y1; y++) {
      var dy = y - cy;
      for (var x = x0; x <= x1; x++) {
        var dx = x - cx;
        if (dx * dx + dy * dy > r2) continue;
        var k = y * size + x;
        if (lf[k] === 0 && m.fog[k] === 0) fresh++;
        lf[k] = 2;
        disc.push(k);
      }
    }
    m.localDisc = disc;
    m.fogDirty = true;
    return fresh;
  }

  /* ══════════ ★ 실시간 ack 즉시 반영 ══════════
     스윙은 일 틱을 기다리지 않는다 — 서버가 ack 에 그 스윙이 바꾼 것(창고 잔고·노드 잔량·
     공사 진척·솜씨)을 실어 준다. 여기서 화면 장부에 곧바로 옮겨 적는다.
     값은 전부 서버가 준 권위값이라 예측 오차가 생기지 않는다. 다음 state 방송이 오면 그대로 덮인다. */
  /** 창고가 바뀌면 배치대의 '지을 수 있음' 표시도 그 자리에서 다시 맞춘다.
      값 계산은 서버 buildableCatalog 와 같은 식(자재 전부 + 골드)이고,
      진짜 판정은 placeBuilding 이 서버에서 다시 한다 — 여기는 표시만이다. */
  function refreshAffordable(n) {
    var list = (n && n.buildable) || [];
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var ok = (n.gold || 0) >= (b.gold || 0);
      var cost = b.cost || {};
      for (var r in cost) {
        if (!Object.prototype.hasOwnProperty.call(cost, r)) continue;
        if ((n.resources[r] || 0) < cost[r]) { ok = false; break; }
      }
      b.affordable = ok;
    }
  }

  /** 노드 한 자리의 장부를 서버가 준 값으로 고쳐 적는다 (성공·실패 어느 쪽 ack 이든) */
  function patchNode(src) {
    if (!src || !src.nodeId || !S.map) return false;
    var n = S.map.nodes[src.nodeId];
    if (!n) return false;
    if (src.swings != null) n.swings = src.swings;
    if (src.swingsPerCycle != null) n.swingsPerCycle = src.swingsPerCycle;
    if (src.amount != null) {
      n.amount = src.amount;
      n.ratio = n.max > 0 ? Math.round((n.amount / n.max) * 100) / 100 : 1;
    }
    if (src.depleted != null) n.depleted = src.depleted;
    /* ★ 재배 루프 — 거두면 곧바로 재파종된다. 이 값을 안 받으면 화면은 계속
       '여물어 있다'고 믿고 빈 밭을 두드린다(일 틱은 최대 10분 뒤에 온다). */
    if (src.harvestReady != null) n.harvestReady = src.harvestReady;
    if (src.readyAt !== undefined) n.readyAt = src.readyAt;
    if (src.stage !== undefined) n.stage = src.stage;
    if (src.stageName !== undefined) n.stageName = src.stageName;
    if (src.growth !== undefined) n.growth = src.growth;
    S.map.dirty = true;
    return true;
  }

  /**
   * ★ GDD3 §14-1 — 서버가 실시간으로 고쳐 쓴 창고 잔고를 그대로 받아 적는다.
   *   주민의 작업 사이클(residentWork)과 스윙 ack 이 같은 문을 쓴다: 자원칸이 일 틱을 안 기다린다.
   */
  function applyLiveResources(table) {
    var v = S.view;
    if (!table || !v || !v.nation || !v.nation.resources) return false;
    for (var k in table) {
      if (!Object.prototype.hasOwnProperty.call(table, k)) continue;
      v.nation.resources[k] = table[k];
    }
    refreshAffordable(v.nation);
    clearStorageNotice();
    emit('change', S);
    emit('live', S);
    return true;
  }

  function applyAck(evt, res, opts) {
    if (!res) return;
    /* 실패한 명령도 사실을 하나 알려 준다 — 「저 밭은 아직 아니다」 같은 것 */
    if (res.ok === false) {
      if (res.error && patchNode(res.error)) { emit('change', S); emit('live', S); }
      return;
    }
    var self = !opts || opts.self !== false;      // 남의 스윙 중계는 내 솜씨 장부를 건드리지 않는다
    var v = S.view;
    var touched = false;

    if (res.resources && v && v.nation && v.nation.resources) {
      for (var k in res.resources) {
        if (!Object.prototype.hasOwnProperty.call(res.resources, k)) continue;
        v.nation.resources[k] = res.resources[k];
      }
      refreshAffordable(v.nation);
      clearStorageNotice();          /* ★ §13-A-5 — 자리가 나면 알림을 되살린다 */
      touched = true;
    }
    if (patchNode(res)) touched = true;
    if (res.siteId && v && v.nation && v.nation.sites) {
      for (var i = 0; i < v.nation.sites.length; i++) {
        if (v.nation.sites[i].id !== res.siteId) continue;
        if (res.remaining != null) v.nation.sites[i].remaining = res.remaining;
        if (res.progress != null) v.nation.sites[i].progress = res.progress;
        touched = true;
      }
      /* ★ 마지막 망치질이 건물을 세운다 — 공사 목록에서 빼고 건물 목록에 넣는다.
         (서버가 그 자리에서 완공시키므로 화면도 일 틱을 기다리지 않는다) */
      if (res.done) {
        v.nation.sites = v.nation.sites.filter(function (c) { return c.id !== res.siteId; });
        if (res.structure) {
          var has = false;
          for (var j = 0; j < v.nation.structures.length; j++) {
            if (v.nation.structures[j].id === res.structure.id) { v.nation.structures[j] = res.structure; has = true; }
          }
          if (!has) v.nation.structures.push(res.structure);
          if (S.map) {
            S.map.structures = (S.map.structures || []).filter(function (b) { return b.id !== res.structure.id; });
            S.map.structures.push(res.structure);
            S.map.dirty = true;
          }
        }
        touched = true;
      }
    }
    if (self && res.skill && v && v.you && v.you.player && v.you.player.skills) {
      var sk = v.you.player.skills[res.skill];
      if (sk) {
        if (res.xp != null) sk.xp = res.xp;
        if (res.level != null) sk.level = res.level;
        touched = true;
      }
    }
    /* ★ 'live' — 일 틱을 기다리지 않고 화면을 고쳐 그리라는 신호(app.js 가 HUD·목표 카드를 새로 그린다).
       스윙은 초당 한 번꼴이라 이 주기로 다시 그려도 값이 싸다. */
    if (touched) { emit('change', S); emit('live', S); }
  }

  /* ── 월드 조회 ─────────────────────────────────────── */
  function mapSize() { return S.map ? S.map.size : 128; }
  function terrainAt(x, y) {
    var m = S.map;
    if (!m || x < 0 || y < 0 || x >= m.size || y >= m.size) return -1;
    return m.terrain[y * m.size + x];
  }
  function codes() { return (S.map && S.map.codes) || TERRAIN.map(function (t) { return t.key; }); }
  function terrainKey(x, y) {
    var i = terrainAt(x, y);
    return i < 0 ? null : (codes()[i] || null);
  }
  function terrainMeta(key) {
    for (var i = 0; i < TERRAIN.length; i++) if (TERRAIN[i].key === key) return TERRAIN[i];
    return { key: key, name: '아직 모르는 땅', color: '#6b6b6b', color2: '#7a7a7a' };
  }
  /** 서버 확정본과 클라 예측 중 밝은 쪽 */
  function fogAt(x, y) {
    var m = S.map;
    if (!m || x < 0 || y < 0 || x >= m.size || y >= m.size) return 0;
    var k = y * m.size + x;
    var a = m.fog[k], b = m.localFog[k];
    return a > b ? a : b;
  }
  /** 자원 자리 목록 — 매 프레임 부르는 자리라 목록을 캐시해 둔다 (60fps 예산) */
  function nodeList() {
    var m = S.map;
    if (!m) return [];
    if (m.nodeArr && !m.nodesDirty) return m.nodeArr;
    var out = [];
    for (var k in m.nodes) if (Object.prototype.hasOwnProperty.call(m.nodes, k)) out.push(m.nodes[k]);
    m.nodeArr = out;
    m.nodesDirty = false;
    return out;
  }
  function nodeById(id) { return (S.map && S.map.nodes[id]) || null; }

  /** ★ §17-12 — 노드를 화면 장부에서 지운다(걷어내기 ack · worldDiff.removedNodes 가 부른다) */
  function dropNode(id) {
    var m = S.map;
    if (!m || !id || !m.nodes[id]) return false;
    delete m.nodes[id];
    m.nodesDirty = true;
    if (S.selection && S.selection.nodeId === id) S.selection.nodeId = null;
    return true;
  }

  /* ★ GDD3 §13-C — 들에 사는 것들.
     위치의 정본은 **서버**다(주민과 반대다 — 주민은 클라가 쥔다). 대신 서버는 1초에 한 번만 보내므로
     화면은 이 좌표로 튀지 않고 그리로 다가간다(world.js 가 보간한다). 여기서는 마지막 사실만 적어 둔다. */
  function applyCreatures(list, shots) {
    var m = S.map;
    if (!m) return;
    m.creatures = Array.isArray(list) ? list : [];
    emit('creatures', m.creatures);
    /* ★ GDD3 §15-A-1 — 같은 박자로 온 터렛 사격. 좌표와 발이 한 묶음이라 궤적이 어긋나지 않는다. */
    if (shots && shots.length) emit('turretShots', shots);
  }
  function creatureList() { return (S.map && S.map.creatures) || []; }
  function clusterList() { return (S.map && S.map.clusters) || []; }
  /**
   * ★ GDD3 §13-B-2 — 손이 닿는 일터의 반경.
   * 자원 군락이 영토 **밖**에 앉으면서 「우리 땅 안인가」는 더 이상 일할 수 있는지의 기준이 아니다.
   * 주민 배치·마커·하니스가 전부 이 자를 쓴다(서버 villagers.listTargets 와 같은 식).
   */
  function workReach() {
    var t = S.map && S.map.territory;
    var bonus = (S.config && S.config.world && S.config.world.villagers
      && S.config.world.villagers.workRadiusBonus) || 26;
    return ((t && t.radius) || 6) + bonus;
  }
  function inWorkRange(x, y) {
    var t = S.map && S.map.territory;
    if (!t || t.cx == null) return true;
    return Math.hypot(x - t.cx, y - t.cy) <= workReach() + 0.001;
  }
  /** ★ §13-B-5 — 지금 이 자리가 몇 번째 위험 띠인가 (서버가 준 경계로 화면도 같은 식으로 잰다) */
  function ringOfPoint(x, y) {
    var m = S.map;
    var t = m && m.territory;
    if (!m || !m.rings || !t || t.cx == null) return 0;
    var d = Math.hypot(x - t.cx, y - t.cy);
    if (d <= m.rings.r0) return 0;
    if (d <= m.rings.r1) return 1;
    return 2;
  }
  /** ★ §13-C-3 — 도감. 서버가 조우·처치를 세고 잠긴 층은 필드 자체가 없다. */
  function codex() { return (S.view && S.view.codex) || null; }
  /** ★ §13-B-3 — 재생 다이얼(옅어짐 문턱). 서버 자료가 정본이고 없으면 폴백 값으로 돈다(구경 모드). */
  function regrowCfg() {
    var c = S.config && S.config.world && S.config.world.nodes && S.config.world.nodes.regrow;
    return c || { byType: {}, fadeAt: 0.35 };
  }
  /** ★ §13-B-5 — 링 다이얼(경고 띠·문구) */
  function ringsCfg() {
    var c = S.config && S.config.world && S.config.world.rings;
    return c || { warnRing: 2, warnText: '여기서부터는 사나운 것들의 땅입니다.' };
  }
  function nodeAt(x, y) {
    var list = nodeList();
    for (var i = 0; i < list.length; i++) if (list[i].x === x && list[i].y === y) return list[i];
    return null;
  }
  function nodeMeta(type) {
    return NODES[type] || { name: type, color: '#9c8f76', job: null, res: null, verb: '살핀다', skill: null, icon: 'stone' };
  }
  function myTown() {
    var n = nation();
    if (n && n.town) return n.town;
    var m = S.map;
    if (!m) return null;
    for (var i = 0; i < m.towns.length; i++) if (m.towns[i].isPlayer) return m.towns[i];
    return null;
  }
  function territory() {
    var n = nation();
    if (n && n.territory && n.territory.cx != null) return n.territory;
    return (S.map && S.map.territory) || null;
  }
  function inTerritory(x, y) {
    var t = territory();
    if (!t || t.cx == null) return false;
    if (Math.hypot(x - t.cx, y - t.cy) <= t.radius + 0.001) return true;
    /* ★ §17-14 — 깃발로 얻은 점령지(claims)도 우리 땅이다(서버 world.inTerritory 의 거울) */
    var cl = t.claims || [];
    for (var i = 0; i < cl.length; i++) {
      if (Math.hypot(x - cl[i].x, y - cl[i].y) <= cl[i].radius + 0.001) return true;
    }
    return false;
  }

  /* ── 나라 파생 ─────────────────────────────────────── */
  function nation() { return (S.view && S.view.nation) || null; }
  function residents() { var n = nation(); return (n && n.residents) || []; }
  function residentById(id) {
    var l = residents();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function structures() {
    var n = nation();
    if (n && n.structures) return n.structures;
    return (S.map && S.map.structures) || [];
  }
  function structureById(id) {
    var l = structures();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }

  /* ══════════ ★ 풋프린트 (GDD3 §12-1) ══════════
     건물은 칸 하나가 아니라 사각형을 차지한다. 앵커(x,y)는 좌상단, 중심은 x+(w-1)/2 다.
     서버(server/engine/structures.js)의 식과 **글자 그대로 같아야** 한다 —
     어긋나면 "고스트는 초록인데 서버가 거절"이라는 최악의 어긋남이 난다. */
  function footprintOf(key) {
    var d = buildingDef(key);
    var f = d && d.footprint;
    if (!f || f.length < 2) return { w: 1, h: 1 };
    return { w: Math.max(1, f[0]), h: Math.max(1, f[1]) };
  }
  /** 실체(건물·현장)가 서버에서 받아 온 풋프린트 — 없으면 도감에서 캔다 */
  function footprintOfThing(o) {
    if (!o) return { w: 1, h: 1 };
    if (o.fw && o.fh) return { w: o.fw, h: o.fh };
    return footprintOf(o.key || o.building);
  }
  function centerOfThing(o) {
    if (!o) return { x: 0, y: 0 };
    if (o.cx != null && o.cy != null) return { x: o.cx, y: o.cy };
    var f = footprintOfThing(o);
    return { x: o.x + (f.w - 1) / 2, y: o.y + (f.h - 1) / 2 };
  }
  /** 커서가 가리킨 칸 → 앵커(좌상단) */
  function anchorFromCell(key, cx, cy) {
    var f = footprintOf(key);
    return { x: Math.round(cx) - Math.floor((f.w - 1) / 2), y: Math.round(cy) - Math.floor((f.h - 1) / 2) };
  }
  function rectOfThing(o) {
    var f = footprintOfThing(o);
    return { x0: o.x, y0: o.y, x1: o.x + f.w - 1, y1: o.y + f.h - 1 };
  }
  function rectGap(a, b) {
    return Math.max(Math.max(b.x0 - a.x1, a.x0 - b.x1), Math.max(b.y0 - a.y1, a.y0 - b.y1));
  }
  function cellIn(rect, x, y) { return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1; }

  /** ★ §12-2 — 정착지 본부 (한 채뿐이다) */
  function hq() {
    var l = structures();
    for (var i = 0; i < l.length; i++) if (l[i].hq) return l[i];
    for (var j = 0; j < l.length; j++) if (l[j].key === 'campfire') return l[j];
    return null;
  }
  function sites() { var n = nation(); return (n && n.sites) || []; }
  function siteById(id) {
    var l = sites();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function fences() {
    var n = nation();
    if (n && n.fences) return n.fences;
    return (S.map && S.map.fences) || [];
  }
  function fenceSummary() { var n = nation(); return (n && n.fenceSummary) || null; }
  function buildable() { var n = nation(); return (n && n.buildable) || []; }
  /** ★ GDD3 §14-7 — 열린 갈래 안에서 아직 잠긴 건물들(서버가 해금 조건 글까지 실어 준다) */
  function lockedBuildings() {
    var n = nation();
    return (n && n.lockedBuildings) || [];
  }
  function buildableOf(key) {
    var l = buildable();
    for (var i = 0; i < l.length; i++) if (l[i].key === key) return l[i];
    return null;
  }
  function housing() { var n = nation(); return (n && n.housing) || null; }
  /* ── ★ GDD3 §13-D — RPG 계층 ─────────────────────────────────
     잠긴 계층은 뷰에 필드 자체가 없다(§11-1). 그래서 여기 없으면 화면도 그리지 않는다. */
  function recruitInfo() { var h = housing(); return (h && h.recruit) || null; }
  function statsCfg() { var c = cfg(); return (c && c.residentStats) || null; }
  function statDefs() { var t = statsCfg(); return (t && t.defs) || {}; }
  function statOrder() { var t = statsCfg(); return (t && t.order) || []; }
  function statName(key) { var d = statDefs()[key]; return (d && d.name) || key; }
  /** 이 직업에 잘 맞는 능력치들 — 주민 패널이 초록 테를 두를 목록 (§13-D-1) */
  function jobFitStats(job) { var t = statsCfg(); return (t && t.jobFit && t.jobFit[job]) || []; }
  function statFit(v, key) {
    var t = statsCfg();
    if (!t || !v || !v.stats) return false;
    return (v.stats[key] || 0) >= (t.fitThreshold || 7) && jobFitStats(v.job).indexOf(key) >= 0;
  }
  function equipCfg() { var c = cfg(); return (c && c.equipment) || null; }
  function equipment() { var y = you(); return (y && y.equipment) || null; }
  function research() { var n = nation(); return (n && n.research) || null; }
  function researchOf(key) {
    var r = research();
    if (!r) return null;
    for (var i = 0; i < (r.list || []).length; i++) if (r.list[i].key === key) return r.list[i];
    return null;
  }
  function rails() { var n = nation(); return (n && n.rails) || []; }
  function railInfo() { var n = nation(); return (n && n.railSummary) || null; }
  function railCfg() { var c = cfg(); return (c && c.research && c.research.rails) || null; }
  function onRail(x, y) {
    var l = rails();
    var rx = Math.round(x), ry = Math.round(y);
    for (var i = 0; i < l.length; i++) if (l[i].x === rx && l[i].y === ry) return true;
    return false;
  }
  /* ★ §17-13 — 다리·매립. 철로와 같은 조회 계약(뷰의 목록 + 칸 판정). */
  function bridges() { var n = nation(); return (n && n.bridges) || []; }
  function fills() { var n = nation(); return (n && n.fills) || []; }
  function bridgeInfo() { var n = nation(); return (n && n.bridgeSummary) || null; }
  function fillInfo() { var n = nation(); return (n && n.fillSummary) || null; }
  function bridgeCfg() { var c = cfg(); return (c && c.research && c.research.bridges) || null; }
  function fillCfg() { var c = cfg(); return (c && c.research && c.research.fill) || null; }
  function onBridge(x, y) {
    var l = bridges();
    var rx = Math.round(x), ry = Math.round(y);
    for (var i = 0; i < l.length; i++) if (l[i].x === rx && l[i].y === ry) return true;
    return false;
  }
  function onFill(x, y) {
    var l = fills();
    var rx = Math.round(x), ry = Math.round(y);
    for (var i = 0; i < l.length; i++) if (l[i].x === rx && l[i].y === ry) return true;
    return false;
  }
  function workPosts() { var n = nation(); return (n && n.workPosts) || []; }
  function camps() {
    var n = nation();
    if (n && n.camps && n.camps.length) return n.camps;
    return (S.map && S.map.camps) || [];
  }
  function jobMeta(key) {
    for (var i = 0; i < JOBS.length; i++) if (JOBS[i].key === key) return JOBS[i];
    return { key: key, name: key || '쉬는 중', color: '#9c8f76', icon: 'folk' };
  }
  function skillMeta(key) {
    for (var i = 0; i < SKILLS.length; i++) if (SKILLS[i].key === key) return SKILLS[i];
    return { key: key, name: key, color: '#9c8f76', icon: 'hammer' };
  }
  function stageName(stage) { return STAGE_NAMES[stage] || null; }

  /* ── 성장 아크 · 점진 공개 (PROTOCOL §6) ───────────── */
  function tier() { return (S.view && S.view.tier) || { tier: 0, name: '야영지', radius: 6, next: null }; }
  function tierNo() { return tier().tier || 0; }
  function unlocked() {
    var u = (S.view && S.view.unlocked) || null;
    return u || { buildings: [], features: [], ui: [], commands: [] };
  }

  /* ══════════ ★ 조건 한 줄의 단일 정본 — 클라 몫 (GDD3 §13-A-1) ══════════

     실측한 버그: 곡물 46을 들고 있는데 정착지 패널은 「곡물 12/20」이라고 했다.
     서버 셈은 늘 옳았다. 어긋난 것은 **잰 시각**이다 — 스윙은 실시간 명령이라 뷰를 새로 만들지
     않으므로, 창고 숫자만 ack 로 앞서 가고 tier.next.reqs 는 하루 전 값에 박혀 있었다.

     그래서 화면은 서버가 준 have 를 **그대로 믿지 않는다.** 행에 실려 온 kind 를 보고
     지금 장부로 다시 잰다. 목표 카드에만 있던 이 규칙을 조건 행 전부로 넓힌 것이 이 함수다.
     티어 조건·유입 조건·목표 카드가 전부 여기 하나를 지난다. */
  function reqLive(r) {
    if (!r) return r;
    var n = nation();
    var raw = null;
    if (n) {
      if (r.kind === 'resource' && r.resource) raw = Number((n.resources || {})[r.resource]) || 0;
      else if (r.kind === 'structure' && r.building) {
        raw = structures().filter(function (s) { return s.key === r.building; }).length;
      } else if (r.kind === 'population') raw = Math.floor(n.population || 0);
    }
    /* 서버만 아는 것(빈 잠자리·소문 따위)은 다시 재지 않고 그대로 쓴다 */
    if (raw == null) return r;
    var p = Math.pow(10, r.dec || 0);
    var have = Math.floor(raw * p) / p;
    /* ok 와 have 는 반드시 **같은 값**에서 나온다 — 「20/20 인데 단추가 꺼져 있다」를 막는다 */
    return {
      key: r.key, kind: r.kind, resource: r.resource, building: r.building,
      text: r.text, unit: r.unit, detail: r.detail, dec: r.dec || 0,
      need: r.need, have: have, ok: have >= r.need,
    };
  }
  /** 조건 표 한 장을 통째로 지금 값으로 (없으면 빈 배열) */
  function reqList(rows) {
    if (!rows || !rows.length) return [];
    return rows.map(reqLive);
  }
  /** 이 표가 전부 찼는가 — 승격 단추의 활성 여부도 서버 스냅샷이 아니라 이걸로 정한다 */
  function reqReady(rows) {
    var l = reqList(rows);
    if (!l.length) return false;
    for (var i = 0; i < l.length; i++) if (!l[i].ok) return false;
    return true;
  }

  /* ── ★ 진행 감독 — 콘텐츠 사슬 (GDD3 §11-2) ────────── */
  /** 지금 열려 있는 장. 서버가 정본이고 화면은 이것만 보고 길잡이를 그린다. */
  function chapter() { return (S.view && S.view.chapter) || null; }
  /** 지금 목표 카드 한 장 (없으면 null — 「한숨 돌려도 됩니다」) */
  function goal() { var c = chapter(); return (c && c.goal) || null; }
  /**
   * 목표의 진행도.
   * ★ §13-A-1 — 조건 행과 **같은 함수**(reqLive)를 지난다. 목표 카드만 실시간이던 시절은 끝났다.
   * (스윙 ack 이 창고를 바로 갱신하므로 일 틱을 기다리지 않고 숫자가 움직인다.)
   */
  function goalProgress() {
    var g = goal();
    if (!g) return null;
    var c = g.condition || {};
    var r = reqLive({
      key: 'goal', kind: c.type, resource: c.resource, building: c.building,
      need: g.need, have: g.have, ok: g.done, dec: 0,
    });
    var have = Math.min(r.need, r.have);
    return { have: have, need: r.need, ratio: r.need > 0 ? Math.min(1, have / r.need) : 1, done: have >= r.need };
  }
  /** 이 자원이 지금 목표가 요구하는 것인가 — 자원 팝에 「(천막까지 6)」을 붙이는 근거 */
  function goalRemaining(resource) {
    var g = goal();
    if (!g || !g.condition || g.condition.type !== 'resource') return null;
    if (g.condition.resource !== resource) return null;
    var p = goalProgress();
    if (!p || p.done) return null;
    return { remaining: Math.max(0, p.need - p.have), title: g.title, need: p.need, short: g.short || null };
  }
  /** 목표가 가리키는 대상 후보 (월드 좌표 또는 화면 단추) */
  function goalTargets() {
    var g = goal();
    return (g && g.targets) || [];
  }
  /** 명령 하나가 열렸는가 — 잠긴 단추는 아예 그리지 않는다 */
  function cmdOn(key) {
    var list = unlocked().commands;
    if (!list || !list.length) return true;      // 서버가 안 보냈으면 막지 않는다(하위 호환)
    return list.indexOf(key) >= 0;
  }
  /** UI 패널 하나가 켜졌는가 — 켜지기 전에는 화면에 아예 없다(비활성이 아니라 부재) */
  function uiOn(key) { return (unlocked().ui || []).indexOf(key) >= 0; }
  /** 기능 하나가 열렸는가 */
  function featOn(key) { return (unlocked().features || []).indexOf(key) >= 0; }
  function buildingOn(key) { return (unlocked().buildings || []).indexOf(key) >= 0; }

  /* ── 나 자신 (스킬·스윙) ───────────────────────────── */
  function you() { return (S.view && S.view.you) || null; }
  function player() { var y = you(); return (y && y.player) || null; }
  function swingInfo() { var y = you(); return (y && y.swing) || null; }
  function skillOf(key) {
    var p = player();
    return (p && p.skills && p.skills[key]) || null;
  }
  /** 그 노드를 치면 무슨 일이 벌어지는가 — 서버가 미리 계산해 준 표 */
  function swingTarget(nodeType) {
    var sw = swingInfo();
    return (sw && sw.targets && sw.targets[nodeType]) || null;
  }
  function swingRange() {
    var sw = swingInfo();
    if (sw && sw.rangeTiles) return sw.rangeTiles;
    var c = cfg();
    return (c && c.skills && c.skills.swing && c.skills.swing.rangeTiles) || 3;
  }
  function combatCfg() {
    var c = cfg();
    return (c && c.skills && c.skills.combat) || { rangeTiles: 2.5, damagePerSwing: 9, playerHp: 60, downSeconds: 12 };
  }
  function downed() {
    var p = player();
    return !!(p && p.down);
  }

  /* ── ★ GDD3 §15-C — 동료와 자동 플레이 ───────────────
     둘 다 **서버가 정본**이다. 화면은 서버가 낸 값을 그릴 뿐이고, 다만 토글을 누른 그 순간과
     손이 닿은 그 순간만은 다음 상태가 올 때까지 제 값으로 앞질러 그린다(누른 느낌이 즉시 와야 한다). */
  var autoLocal = { on: null, suspendUntil: 0 };
  function companions() { var n = nation(); return (n && n.companions) || []; }
  function companionById(id) {
    var list = companions();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function seats() { var n = nation(); return (n && n.seats) || 5; }
  function autoPlayCfg() {
    var c = cfg();
    return (c && c.companions && c.companions.autoPlay) || { suspendSeconds: 30 };
  }
  /** 지금의 자동 플레이 상태 {on, active, suspendedFor} */
  function autoPlay() {
    var y = you();
    var srv = (y && y.autoPlay) || null;
    var on = autoLocal.on != null ? autoLocal.on : !!(srv && srv.on);
    var left = Math.max(0, Math.ceil((autoLocal.suspendUntil - Date.now()) / 1000));
    if (srv && !left) left = srv.suspendedFor || 0;
    return {
      on: on,
      active: on && left <= 0,
      suspendedFor: on ? left : 0,
      suspendSeconds: (srv && srv.suspendSeconds) || autoPlayCfg().suspendSeconds || 30
    };
  }
  /** 토글을 누른 그 순간(서버 응답을 기다리지 않는다) */
  function setAutoPlayLocal(on) { autoLocal.on = !!on; autoLocal.suspendUntil = 0; return autoPlay(); }
  /** 손이 닿았다 — 서버와 같은 길이만큼 화면도 스스로 물러난다 */
  function suspendAutoPlayLocal() {
    if (!autoPlay().on) return null;
    autoLocal.suspendUntil = Date.now() + (autoPlay().suspendSeconds * 1000);
    return autoPlay();
  }
  function resetAutoPlayLocal() { autoLocal = { on: null, suspendUntil: 0 }; }

  /* ── 웨이브 ────────────────────────────────────────── */
  /* ★ §16-18 · §16-19 — 집결지 · 수비 깃발 */
  function rally() { var n = nation(); return (n && n.rally) || null; }
  function defenseFlag() { var n = nation(); return (n && n.defenseFlag) || null; }

  function wave() { return (S.view && S.view.wave) || null; }
  function defense() { return (S.view && S.view.defense) || null; }
  function chronicle() { return S.chronicle || (S.view && S.view.chronicle) || null; }
  function battleLive() { return S.battle; }
  function enemyMeta(type) {
    var base = ENEMIES[type] || { name: type || '알 수 없는 무리', icon: 'bandit', color: '#7a5a48' };
    var c = cfg();
    var def = c && c.waves && c.waves.types && c.waves.types[type];
    return { key: type, name: (def && def.name) || base.name, icon: base.icon, color: base.color,
             hp: def && def.hp, dps: def && def.dps, direction: def && def.direction,
             weakTo: def && def.weakTo, flying: !!(def && def.flying) };
  }
  function directionMeta(key) { return DIRECTION[key] || DIRECTION.north; }

  /* ── 시간 (하루 4구간) ─────────────────────────────── */
  function timeCfg() {
    var v = S.view;
    if (v && v.time) return v.time;
    var c = cfg();
    return (c && c.time) || { dayRealSeconds: 600, dayPhases: ['morning', 'day', 'evening', 'night'] };
  }
  function phaseIndex() {
    var f = S.dayFraction || 0;
    return Math.min(3, Math.max(0, Math.floor(f * 4)));
  }
  function phaseMeta() { return DAY_PHASES[phaseIndex()]; }
  function isNight() { return phaseIndex() === 3; }

  /* ── ★ 밝기 다이얼 (GDD3 §13-A-2) ────────────────────
     data/world.json 의 light 가 정본이다. 설정이 오면 4구간 표를 통째로 갈아 끼우고,
     못 받았으면 폴백으로 돈다 — 어느 쪽이든 화면은 같은 한 곳(lightCfg)만 본다. */
  var lightCache = null;
  function lightCfg() {
    var w = worldCfg();
    var l = w && w.light;
    if (!l || !l.phases || l.phases.length !== 4) return LIGHT_FALLBACK;
    if (lightCache && lightCache.__src === l) return lightCache;
    lightCache = {
      __src: l,
      phases: l.phases,
      fogVeil: l.fogVeil != null ? l.fogVeil : LIGHT_FALLBACK.fogVeil,
      buildVeil: l.buildVeil != null ? l.buildVeil : LIGHT_FALLBACK.buildVeil,
      minLuma: l.minLuma != null ? l.minLuma : LIGHT_FALLBACK.minLuma,
      brightness: l.brightness || LIGHT_FALLBACK.brightness,
    };
    DAY_PHASES.length = 0;
    for (var i = 0; i < l.phases.length; i++) DAY_PHASES.push(l.phases[i]);
    return lightCache;
  }

  /* ── ★ GDD3 §14-2 — 플레이어의 밝기 슬라이더 ────────────
     자료의 값은 이제 '기본값'이다. 여기 곱해지는 배수 하나가 화면 전체의 밝기를 정한다:
       · 덮는 어둠(phase.alpha · fogVeil) 은 (1 − (b−1)×darkPerStep) 만큼 얇아지고
       · 더하는 빛(phase.lift) 은 (b−1)×liftPerStep 만큼 두꺼워진다.
     b = 1 이면 자료 그대로다. 서버는 이 값을 모른다 — 보기의 문제이지 규칙의 문제가 아니다. */
  var brightness = null;
  function brightnessCfg() { return lightCfg().brightness || LIGHT_FALLBACK.brightness; }
  function getBrightness() {
    var c = brightnessCfg();
    if (brightness == null) {
      var v = null;
      try { v = parseFloat(localStorage.getItem('gm.brightness')); } catch (e) { v = null; }
      brightness = (isFinite(v) && v > 0) ? v : c.default;
    }
    return Math.max(c.min, Math.min(c.max, brightness));
  }
  function setBrightness(v) {
    var c = brightnessCfg();
    var n = Math.max(c.min, Math.min(c.max, Number(v) || c.default));
    brightness = n;
    try { localStorage.setItem('gm.brightness', String(n)); } catch (e) {}
    emit('brightness', n);
    return n;
  }
  /** 덮는 어둠에 곱하는 값 (0 아래로는 안 내려간다) */
  function darkScale() {
    var c = brightnessCfg();
    return Math.max(0, 1 - (getBrightness() - 1) * (c.darkPerStep != null ? c.darkPerStep : 1));
  }
  /** 더하는 빛에 얹는 값 */
  function liftBonus() {
    var c = brightnessCfg();
    return (getBrightness() - 1) * (c.liftPerStep != null ? c.liftPerStep : 0.22);
  }

  /**
   * 지금 땅에 덮이는 장막의 세기 — 탐사했지만 눈에 안 닿는 칸에 쓴다.
   * ★ §13-A-2 — **건설 모드에서는 더 옅다.** 건물을 놓으러 카메라를 옮기면 시야 밖으로 나가
   *   화면이 훅 어두워졌다("건설 모드로 들어가면 어두워진다")는 피드백의 정면 답이다.
   * ★ §14-2 — 그 위에 밝기 슬라이더가 곱해진다.
   */
  function fogVeil() {
    var l = lightCfg();
    return (S.placing ? l.buildVeil : l.fogVeil) * darkScale();
  }

  /* ── ★ 주민 노동 다이얼 (GDD3 §13-A-3) ───────────────
     화면의 짐 쌓임·나르기 주기가 이 표를 따른다. 서버 설정이 정본, 아래는 폴백. */
  var WORK_FALLBACK = { deliveriesPerDay: 4, swingSeconds: 0.9 };
  function villagerWorkCfg() {
    var w = worldCfg();
    var k = w && w.villagers && w.villagers.work;
    if (!k) return WORK_FALLBACK;
    return {
      deliveriesPerDay: k.deliveriesPerDay > 0 ? k.deliveriesPerDay : WORK_FALLBACK.deliveriesPerDay,
      swingSeconds: k.swingSeconds > 0 ? k.swingSeconds : WORK_FALLBACK.swingSeconds,
    };
  }
  /** 게임 하루가 실제로 몇 초인가 — 주민이 초당 얼마를 버는지 재는 분모 */
  function dayRealSeconds() { return timeCfg().dayRealSeconds || 600; }

  /* ── ★ 저장 상한 (GDD3 §13-A-5) — 서버가 정본, 화면은 읽기만 한다 ── */
  function storageInfo() { var n = nation(); return (n && n.storage) || null; }
  /** 자원 하나가 쌓일 수 있는 총량 (모르면 0 = 상한 없음으로 본다) */
  function storageLimit() { var s = storageInfo(); return (s && s.limit) || 0; }
  /** 이 자원칸이 지금 가득 찼는가 — 자원이 아닌 칸(인구·금화·사기)은 언제나 아니다 */
  function storageFull(key) {
    var s = storageInfo();
    if (!s || !s.limit) return false;
    if (!S.config || !S.config.resources || (S.config.resources.order || []).indexOf(key) < 0) return false;
    var n = nation();
    var have = (n && n.resources && n.resources[key]) || 0;
    /* 서버가 준 목록이 우선이되, 스윙 ack 로 앞서 간 장부도 함께 본다(§13-A-1 과 같은 원칙) */
    return have >= s.limit - 0.005 || (s.full || []).indexOf(key) >= 0;
  }
  /**
   * 곳간에 다시 자리가 생기면 「가득 찼습니다」 알림을 **다시 한 번 받을 수 있게** 되돌린다.
   * (한 번 보고 영영 안 보이면, 궤짝을 지어 풀었다가 또 차도 아무 말이 없다.)
   */
  function clearStorageNotice() {
    var s = storageInfo();
    if (!s || !s.limit) return;
    var n = nation();
    var res = (n && n.resources) || {};
    for (var k in S.dismissed) {
      if (k.indexOf('storageFull:') !== 0) continue;
      var key = k.slice(12);
      if (((res[key] || 0) < s.limit - 0.005)) delete S.dismissed[k];
    }
  }

  /* ── 역할 ──────────────────────────────────────────── */
  function myRole() {
    var n = nation();
    var me = S.avatarId;
    if (n && n.roles) {
      for (var i = 0; i < ROLES.length; i++) {
        var k = ROLES[i].key, r = n.roles[k];
        if (!r || r.holder !== 'player') continue;
        if (r.owner == null || r.owner === me) return k;
      }
    }
    return (S.you && S.you.role) || null;
  }
  function syncYou() {
    var role = myRole();
    if (!S.you) S.you = { role: null, appearance: null };
    if (S.you.role !== role) S.you = { role: role, appearance: S.you.appearance };
    return role;
  }
  function hasRole(key) { return myRole() === key; }
  function roleHolder(key) {
    var n = nation();
    if (!n || !n.roles || !n.roles[key]) return null;
    return n.roles[key].holder || null;
  }
  function isVacant(key) {
    var h = roleHolder(key);
    return h === null || h === undefined || h === 'vacant' || h === 'none';
  }
  function holderName(key) {
    var n = nation();
    var r = n && n.roles && n.roles[key];
    if (!r || !r.holder) return null;
    if (r.holder === 'player') return '그대';
    return r.npcName || roleMeta(key).name;
  }
  function mandateOpen() {
    var v = S.view;
    return !!(v && v.mandate && v.mandate.unlocked);
  }
  function hasForeignPrices() { return !!(S.view && S.view.market && S.view.market.foreign); }
  function hasPreciseWave() {
    var w = wave();
    return !!(w && w.precise);
  }

  /* ── config 어댑터 ─────────────────────────────────── */
  function cfg() { return S.config || null; }
  function worldCfg() { var c = cfg(); return (c && c.world) || null; }
  function tiersCfg() { var c = cfg(); return (c && c.tiers) || null; }
  function skillsCfg() { var c = cfg(); return (c && c.skills) || null; }
  function wavesCfg() { var c = cfg(); return (c && c.waves) || null; }
  function buildingsCfg() { var c = cfg(); return (c && c.buildings) || null; }
  function fenceCfg() {
    var w = worldCfg();
    return (w && w.fences) || { maxSegments: 400, maxPointsPerRequest: 64, maxSegmentSpan: 40,
                                blockedTerrain: ['water'], requiresTerritory: true };
  }
  function buildingDef(key) {
    var b = buildingsCfg();
    var d = b && b.defs && b.defs[key];
    return d || null;
  }
  function buildingName(key, tierNum) {
    var d = buildingDef(key);
    if (!d) return key;
    var t = d.tiers && d.tiers[(tierNum || 1) - 1];
    return (t && t.name) || d.name || key;
  }
  function buildingTier(key, tierNum) {
    var d = buildingDef(key);
    return (d && d.tiers && d.tiers[(tierNum || 1) - 1]) || null;
  }
  /** ★ GDD3 §15-A-4 — 이 건물이 터렛인가, 그렇다면 얼마나 멀리 쏘는가 (사거리 원의 재료) */
  function turretSpecOf(key, tierNum) {
    var t = buildingTier(key, tierNum || 1);
    return (t && t.turret) || null;
  }
  function categoryName(key) {
    var b = buildingsCfg();
    var c = b && b.categories && b.categories[key];
    if (c && c.name) return c.name;
    for (var i = 0; i < BUILD_CATEGORIES.length; i++) if (BUILD_CATEGORIES[i].key === key) return BUILD_CATEGORIES[i].name;
    return key;
  }

  var APPEARANCE_FALLBACK = {
    fields: {
      skin: { name: '피부색', count: 6, styles: null,
        palette: ['#f5d6b8', '#e8bb92', '#d29a6c', '#b4784c', '#8a5836', '#5f3b22'] },
      hair: { name: '머리 모양', count: 8, palette: null,
        styles: ['short', 'bob', 'long', 'ponytail', 'braid', 'topknot', 'curly', 'bald'] },
      hairColor: { name: '머리 색', count: 10, styles: null,
        palette: ['#1b1b1f', '#3b2a1d', '#6b4423', '#a8703a', '#d9a441', '#e8dcc0', '#9a9a9a', '#7a3b3b', '#3b5a7a', '#5a3b6b'] },
      outfit: { name: '옷차림', count: 6, palette: null,
        styles: ['tunic', 'robe', 'coat', 'armor', 'hanbok', 'cloak'] },
      outfitColor: { name: '옷 색', count: 10, styles: null,
        palette: ['#6a994e', '#4a6fa5', '#bc4749', '#8367a8', '#e8a33d', '#3f6130', '#8d7f6a', '#c8965a', '#2f4858', '#a8558a'] }
    },
    default: { skin: 0, hair: 0, hairColor: 0, outfit: 0, outfitColor: 0 },
    nameMaxLength: 16
  };
  function appearanceCfg() {
    var w = worldCfg();
    return (w && w.appearance) || APPEARANCE_FALLBACK;
  }
  function defaultAppearance() {
    var c = appearanceCfg();
    return { skin: c.default.skin, hair: c.default.hair, hairColor: c.default.hairColor,
             outfit: c.default.outfit, outfitColor: c.default.outfitColor };
  }
  function randomAppearance() {
    var c = appearanceCfg();
    var out = {};
    for (var k in c.fields) if (Object.prototype.hasOwnProperty.call(c.fields, k)) {
      out[k] = Math.floor(Math.random() * c.fields[k].count);
    }
    return out;
  }
  function difficulties() {
    var c = cfg();
    var d = c && c.difficulty;
    if (!d) {
      return [{ key: 'story', name: '이야기', desc: '천천히 정착지를 키우고 싶은 분께.' },
              { key: 'kingdom', name: '왕국', desc: '설계된 그대로의 균형.' },
              { key: 'trial', name: '시련', desc: '한 번의 실수가 정착지를 흔듭니다.' }];
    }
    return (d.order || Object.keys(d.presets || {})).map(function (k) {
      var p = (d.presets || {})[k] || {};
      return { key: k, name: p.name || k, desc: p.desc || '' };
    });
  }
  function defaultDifficulty() {
    var c = cfg();
    return (c && c.difficulty && c.difficulty.default) || 'kingdom';
  }

  function resourceMeta(key) {
    var base = null;
    for (var i = 0; i < RESOURCES.length; i++) if (RESOURCES[i].key === key) base = RESOURCES[i];
    var c = cfg();
    var meta = c && c.resources && c.resources.meta && c.resources.meta[key];
    if (base) return { key: key, name: base.name, color: base.color, referencePrice: meta && meta.referencePrice };
    if (key === 'gold') return { key: 'gold', name: '금화', color: '#e8a33d' };
    return { key: key, name: (meta && meta.name) || key, color: '#9c8f76' };
  }
  function roleMeta(key) {
    var base = { key: key, name: key, tier: 0, color: '#9c8f76', info: '', vacancy: '', line: '', forWhom: '', stars: 1 };
    for (var i = 0; i < ROLES.length; i++) if (ROLES[i].key === key) base = ROLES[i];
    return base;
  }
  function tagName(t) {
    var c = cfg();
    if (c && c.tags && c.tags[t] && c.tags[t].name) return c.tags[t].name;
    return t;
  }
  function nationTags(n) {
    n = n || nation();
    if (!n) return [];
    if (n.tagNames && n.tagNames.length) return n.tagNames;
    return (n.tags || []).map(tagName);
  }
  function gradeInfo(g) { return GRADES[g] || GRADES.common; }
  function artifactDef(key) {
    var c = S.config;
    if (!c) return null;
    var pools = [c.artifacts && c.artifacts.list, c.artifactsByKey, c.artifacts];
    for (var i = 0; i < pools.length; i++) {
      var p = pools[i];
      if (!p) continue;
      if (Array.isArray(p)) { for (var j = 0; j < p.length; j++) if (p[j] && p[j].key === key) return p[j]; }
      else if (typeof p === 'object' && p[key]) return p[key];
    }
    return null;
  }
  /* ★ §17-10 피드백("만료된 제안이 안 사라져") — 뷰(서버 정본)를 우선하고, 소켓으로 밀려온
     복사본(S.offers)은 뷰에 offers 칸이 아예 없을 때만 쓴다. 만료 표가 지난 것은 어디서 왔든 걸러낸다. */
  function offers() {
    var v = S.view || {};
    var tick = v.tick || 0;
    var list = Array.isArray(v.offers) ? v.offers : (S.offers || []);
    var seen = {}, out = [];
    list.forEach(function (o) {
      if (!o || seen[o.offerId]) return;
      if (o.expiresTick !== undefined && o.expiresTick < tick) return;
      seen[o.offerId] = 1; out.push(o);
    });
    return out;
  }
  function decisionQueue() { var n = nation(); return (n && n.decisionQueue) || []; }
  function members() { var n = nation(); return (n && n.members) || []; }
  function ap() { var n = nation(); return (n && n.ap) || { current: 0, max: 3 }; }

  function wordFor(ratio) {
    if (ratio >= 1.15) return { text: '넉넉함', cls: 'state-good' };
    if (ratio >= 0.95) return { text: '빠듯함', cls: 'state-warn' };
    if (ratio >= 0.6) return { text: '모자람', cls: 'state-bad' };
    return { text: '위험', cls: 'state-bad' };
  }

  /* ── 선택 ─────────────────────────────────────────── */
  var EMPTY_SEL = { residents: [], nodeId: null, structureId: null, siteId: null, fenceId: null, enemyId: null };
  function blankSel() {
    return { residents: [], nodeId: null, structureId: null, siteId: null, fenceId: null, enemyId: null };
  }
  function selectResidents(ids) {
    S.selection = blankSel();
    S.selection.residents = ids.slice();
    emit('selection', S.selection);
  }
  function selectTarget(kind, id) {
    S.selection = blankSel();
    S.selection[kind] = id;
    emit('selection', S.selection);
  }
  function clearSelection() {
    S.selection = blankSel();
    emit('selection', S.selection);
  }
  function setPlacing(p) { S.placing = p; emit('placing', p); }

  function reset() {
    S.map = null; S.avatars = []; S.chat = []; S.mandate = null; S.battle = null;
    S.events = []; S.offers = []; S.dismissed = {}; S.seenUi = {};
    resetAutoPlayLocal();                    // ★ §15-C — 판이 바뀌면 앞질러 그린 값도 버린다
    clearSelection();
  }

  GM.state = {
    S: S, on: on, off: off, emit: emit, set: set, reset: reset, setBoot: setBoot,
    applyWorld: applyWorld, applyWorldDiff: applyWorldDiff, decodeRleInto: decodeRleInto,
    revealAround: revealAround, visionRadius: visionRadius, applyAck: applyAck,
    applyLiveResources: applyLiveResources,

    nation: nation, ap: ap,
    tier: tier, tierNo: tierNo, unlocked: unlocked, uiOn: uiOn, featOn: featOn, buildingOn: buildingOn,
    reqLive: reqLive, reqList: reqList, reqReady: reqReady,
    chapter: chapter, goal: goal, goalProgress: goalProgress, goalRemaining: goalRemaining,
    goalTargets: goalTargets, cmdOn: cmdOn,
    you: you, player: player, swingInfo: swingInfo, skillOf: skillOf, swingTarget: swingTarget,
    swingRange: swingRange, combatCfg: combatCfg, downed: downed,
    /* ★ GDD3 §15-C — 동료 · 자동 플레이 */
    companions: companions, companionById: companionById, seats: seats,
    autoPlay: autoPlay, autoPlayCfg: autoPlayCfg, setAutoPlayLocal: setAutoPlayLocal,
    suspendAutoPlayLocal: suspendAutoPlayLocal, resetAutoPlayLocal: resetAutoPlayLocal,
    rally: rally, defenseFlag: defenseFlag,
    wave: wave, defense: defense, chronicle: chronicle, battleLive: battleLive,
    enemyMeta: enemyMeta, directionMeta: directionMeta,
    timeCfg: timeCfg, phaseIndex: phaseIndex, phaseMeta: phaseMeta, isNight: isNight,
    lightCfg: lightCfg, fogVeil: fogVeil,
    /* ★ GDD3 §14-2 — 밝기 슬라이더 */
    brightnessCfg: brightnessCfg, getBrightness: getBrightness, setBrightness: setBrightness,
    darkScale: darkScale, liftBonus: liftBonus,
    villagerWorkCfg: villagerWorkCfg, dayRealSeconds: dayRealSeconds,
    storageLimit: storageLimit, storageFull: storageFull, storageInfo: storageInfo,

    myRole: myRole, syncYou: syncYou, hasRole: hasRole, roleHolder: roleHolder, isVacant: isVacant,
    holderName: holderName, mandateOpen: mandateOpen, members: members,
    tagName: tagName, nationTags: nationTags,
    hasForeignPrices: hasForeignPrices, hasPreciseWave: hasPreciseWave,
    resourceMeta: resourceMeta, roleMeta: roleMeta, skillMeta: skillMeta,
    artifactDef: artifactDef, decisionQueue: decisionQueue, offers: offers, gradeInfo: gradeInfo,
    wordFor: wordFor,

    cfg: cfg, worldCfg: worldCfg, tiersCfg: tiersCfg, skillsCfg: skillsCfg, wavesCfg: wavesCfg,
    buildingsCfg: buildingsCfg, fenceCfg: fenceCfg,
    buildingDef: buildingDef, buildingName: buildingName, buildingTier: buildingTier,
    turretSpecOf: turretSpecOf,
    categoryName: categoryName,
    appearanceCfg: appearanceCfg, defaultAppearance: defaultAppearance, randomAppearance: randomAppearance,
    difficulties: difficulties, defaultDifficulty: defaultDifficulty,

    mapSize: mapSize, terrainAt: terrainAt, terrainKey: terrainKey, terrainMeta: terrainMeta,
    fogAt: fogAt, nodeList: nodeList, nodeById: nodeById, nodeAt: nodeAt, nodeMeta: nodeMeta,
    applyCreatures: applyCreatures, creatureList: creatureList, clusterList: clusterList,
    ringOfPoint: ringOfPoint, codex: codex, regrowCfg: regrowCfg, ringsCfg: ringsCfg,
    workReach: workReach, inWorkRange: inWorkRange,
    myTown: myTown, territory: territory, inTerritory: inTerritory,
    residents: residents, residentById: residentById,
    structures: structures, structureById: structureById, sites: sites, siteById: siteById,
    footprintOf: footprintOf, footprintOfThing: footprintOfThing, centerOfThing: centerOfThing,
    anchorFromCell: anchorFromCell, rectOfThing: rectOfThing, rectGap: rectGap, cellIn: cellIn, hq: hq,
    fences: fences, fenceSummary: fenceSummary, buildable: buildable, buildableOf: buildableOf,
    lockedBuildings: lockedBuildings,
    housing: housing, workPosts: workPosts, camps: camps,
    /* ★ GDD3 §13-D — RPG 계층 */
    recruitInfo: recruitInfo, statsCfg: statsCfg, statDefs: statDefs, statOrder: statOrder,
    statName: statName, jobFitStats: jobFitStats, statFit: statFit,
    equipCfg: equipCfg, equipment: equipment,
    research: research, researchOf: researchOf,
    rails: rails, railInfo: railInfo, railCfg: railCfg, onRail: onRail,
    /* ★ §17-13 — 다리·매립 · ★ §17-12 — 걷어내기 */
    bridges: bridges, bridgeInfo: bridgeInfo, bridgeCfg: bridgeCfg, onBridge: onBridge,
    fills: fills, fillInfo: fillInfo, fillCfg: fillCfg, onFill: onFill,
    dropNode: dropNode,
    jobMeta: jobMeta, stageName: stageName,

    selectResidents: selectResidents, selectTarget: selectTarget,
    clearSelection: clearSelection, setPlacing: setPlacing,

    RESOURCES: RESOURCES, BASIC3: BASIC3, SKILLS: SKILLS, ROLES: ROLES, LABOR: LABOR, JOBS: JOBS,
    BUILD_CATEGORIES: BUILD_CATEGORIES, TOOLS: TOOLS, TERRAIN: TERRAIN, NODES: NODES,
    GRADES: GRADES, ENEMIES: ENEMIES, DIRECTION: DIRECTION, DAY_PHASES: DAY_PHASES,
    NATION_COLORS: NATION_COLORS, EMPTY_SEL: EMPTY_SEL
  };
})(window);
