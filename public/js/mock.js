/* mock.js — 구경 모드(?mock=1). 서버 없이 화면만 돌려 보기 위한 가짜 소켓.
   ★ 프로토콜 v3.1 의 world / state / worldDiff / 스윙 ack 모양을 그대로 흉내 낸다.
     v3.1 부터는 **진행 감독(콘텐츠 사슬)** 도 함께 흉내 낸다 — 구경 모드에서도
     「시간은 아무것도 열지 않는다」가 지켜져야 화면 점검이 뜻을 가진다(GDD3 §11).
     밸런스는 대충이고 하루도 짧다 — 이건 화면과 연출 점검용이다.
     진짜 서버가 붙으면 이 파일은 쓰이지 않는다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};

  var SIZE = 96;
  var CODES = ['grass', 'forest', 'rock', 'water', 'fertile'];
  var DAY_SECONDS = 45;            // 구경 모드는 하루가 짧다

  /* ── 최소 설정표 (서버 config 를 못 받았을 때의 폴백) ── */
  var TIERS = [
    { tier: 0, name: '야영지', radius: 6, requires: {},
      unlocks: { buildings: ['campfire', 'tent', 'hut', 'storage_crate'],
                 features: ['gather', 'swing', 'reclaim', 'placeBuilding', 'chronicle'],
                 ui: ['hud.resources3', 'hud.questCard'] },
      line: '마차가 멈춘 자리에 모닥불을 피웠다.' },
    { tier: 1, name: '개척촌', radius: 9, requires: { structures: { hut: 1 }, resources: { grain: 20 } },
      unlocks: { buildings: ['well', 'woodpile', 'lamp'],
                 features: ['residentArrival', 'commandVillagers', 'reclaimField'],
                 ui: ['hud.population', 'panel.residents'] },
      line: '굴뚝이 하나 늘었다.' },
    { tier: 2, name: '촌락', radius: 12, requires: { population: 5 },
      unlocks: { buildings: ['granary', 'sawmill', 'house', 'watchpost', 'fence', 'gate'],
                 features: ['fences', 'waves'],
                 ui: ['hud.threat', 'panel.build', 'panel.fence'] },
      line: '울타리를 두를 만큼은 되었다.' },
    { tier: 3, name: '마을', radius: 16, requires: { population: 12 },
      unlocks: { buildings: ['smithy', 'arrow_tower', 'trading_post'],
                 features: ['roles', 'trade', 'departments'],
                 ui: ['panel.roles', 'panel.trade', 'panel.skills'] },
      line: '이름이 붙는 날이다.', milestone: 'emotionDay' }
  ];

  var BUILD = {
    campfire: { name: '모닥불', category: 'civic', cost: { wood: 5 }, bp: 2, hp: 40, multi: false },
    tent: { name: '천막', category: 'housing', cost: { wood: 12 }, bp: 4, hp: 40, beds: 1, multi: true },
    hut: { name: '오두막', category: 'housing', cost: { wood: 45, stone: 10 }, bp: 8, hp: 90, beds: 2, multi: true },
    house: { name: '가옥', category: 'housing', cost: { wood: 110, stone: 60 }, bp: 16, hp: 150, beds: 4, multi: true },
    storage_crate: { name: '저장 궤짝', category: 'production', cost: { wood: 10 }, bp: 3, hp: 40, multi: true },
    well: { name: '우물', category: 'production', cost: { wood: 20, stone: 15 }, bp: 6, hp: 70, multi: true },
    woodpile: { name: '장작더미', category: 'production', cost: { wood: 15 }, bp: 4, hp: 50, multi: true },
    granary: { name: '곡창', category: 'production', cost: { wood: 90, stone: 45 }, bp: 14, hp: 140, multi: true },
    sawmill: { name: '제재소', category: 'production', cost: { wood: 80, stone: 30 }, bp: 12, hp: 130, multi: true },
    smithy: { name: '대장간', category: 'production', cost: { wood: 120, stone: 90 }, bp: 20, hp: 180, multi: false },
    watchpost: { name: '초소', category: 'military', cost: { wood: 40, stone: 20 }, bp: 8, hp: 110, multi: true },
    arrow_tower: { name: '화살탑', category: 'military', cost: { wood: 90, stone: 60 }, bp: 16, hp: 160, multi: true, dps: 10, range: 8 },
    appraisal_post: { name: '감정소', category: 'civic', cost: { wood: 60, stone: 30 }, bp: 12, hp: 110, multi: false,
                      maxTier: 1, action: 'appraiseLand', actionLabel: '땅을 감정한다' },
    trading_post: { name: '교역소', category: 'civic', cost: { wood: 120, stone: 60 }, bp: 20, hp: 160, multi: false },
    lamp: { name: '가로등', category: 'decor', cost: { wood: 8 }, bp: 2, hp: 30, multi: true },
    banner: { name: '깃발', category: 'decor', cost: { wood: 10 }, bp: 2, hp: 30, multi: true }
  };

  var NAMES = ['들단', '가온', '노을', '봄이', '한별', '이레', '새롬', '다움', '해솔', '늘품', '미르', '아라'];

  /* ★ 콘텐츠 사슬 (data/chapters.json 의 축약 거울 — 구경 모드는 6장 감정까지만 흉내 낸다) */
  var CHAPTERS = [
    { id: 1, key: 'spark', name: '불씨', subtitle: '마차가 멈춘 자리',
      opens: { buildings: [], features: ['gather', 'swing', 'chronicle'], ui: ['hud.resources3', 'hud.questCard'] },
      steps: [
        { key: 'first_swings', title: '나무를 세 번 베어 보세요', verb: 'E — 나무 베기',
          sub: '나무 곁으로 걸어가 E 를 누르고 있으면 계속 도끼질합니다.',
          cond: { type: 'swings', skill: 'lumber', count: 3 }, target: { type: 'node', nodeTypes: ['forest'] },
          hint: { sel: '#world-canvas', text: 'W A S D 로 걷고, 나무 곁에서 E 를 누르고 있으면 도끼질합니다' } },
        { key: 'wood10', short: '천막', title: '천막을 세울 목재 10을 모으세요',
          sub: '한 그루를 다 베면 큰 몫이 들어옵니다.',
          cond: { type: 'resource', resource: 'wood', amount: 10 }, target: { type: 'node', nodeTypes: ['forest'] } }
      ],
      reward: { line: '모닥불이 제대로 타오른다.',
                card: { icon: 'hammer', title: '배치대가 열렸습니다', text: '이제 [세우기]로 천막 자리를 잡을 수 있습니다.' } } },
    { id: 2, key: 'first_roof', name: '첫 지붕', subtitle: '비를 피할 자리',
      opens: { buildings: ['tent'], features: ['placeBuilding'], ui: ['panel.build'] },
      steps: [{ key: 'tent_built', title: '모닥불 곁에 천막을 세우세요', verb: 'E — 짓기',
                sub: '[세우기]에서 천막을 고르고 땅을 누른 뒤, 현장 곁에서 E 를 눌러 지어 올립니다.',
                cond: { type: 'structure', building: 'tent', count: 1 },
                target: { type: 'site', building: 'tent', fallback: { type: 'buildSlot', building: 'tent', sel: '#tb-build' } },
                hint: { sel: '#tb-build', text: '여기서 세울 것을 고르고 땅을 눌러 자리를 잡습니다' } }],
      reward: { line: '지붕 하나가 생겼다.',
                card: { icon: 'storage', title: '저장 궤짝', text: '자재를 쌓아 둘 곳입니다. 이제 먹을 것을 찾아 나설 차례입니다.' } } },
    { id: 3, key: 'hunger', name: '허기', subtitle: '먹을 것을 찾아',
      opens: { buildings: ['tent', 'storage_crate'], features: ['reclaim', 'reclaimField'], ui: [] },
      steps: [
        { key: 'grain20', short: '오두막', title: '식량 20을 모으세요',
          sub: '물가에서는 언제든 고기를 건집니다. 기름진 땅은 여물어야 거둘 수 있습니다.',
          cond: { type: 'resource', resource: 'grain', amount: 20 },
          target: { type: 'node', nodeTypes: ['water', 'fertile', 'field'] },
          opens: { buildings: ['hut'] } },
        { key: 'hut_built', title: '오두막을 지으세요', verb: 'E — 짓기',
          sub: '사람이 들어와 살 자리입니다.',
          cond: { type: 'structure', building: 'hut', count: 1 },
          target: { type: 'site', building: 'hut', fallback: { type: 'buildSlot', building: 'hut', sel: '#tb-build' } } }
      ],
      reward: { line: '곳간에 처음으로 여유가 생겼다.',
                card: { icon: 'person', title: '사람이 찾아옵니다', text: '빈 잠자리와 식량이 있으면 이웃이 걸어 들어옵니다.' } } },
    { id: 4, key: 'first_neighbor', name: '첫 이웃', subtitle: '혼자가 아니다',
      opens: { buildings: ['tent', 'storage_crate', 'hut'], features: ['residentArrival'],
               ui: ['hud.population', 'panel.residents'] },
      steps: [
        { key: 'resident1', title: '첫 주민을 맞이하세요', sub: '빈 잠자리와 식량이 넉넉하면 사람이 걸어 들어옵니다.',
          cond: { type: 'population', count: 1 }, target: { type: 'structure', building: 'hut' },
          opens: { buildings: ['granary'], features: ['commandVillagers'] } },
        { key: 'granary_and_folk', title: '주민 3명과 곡창 하나', verb: 'E — 짓기',
          sub: '주민을 끌어서 고르고 오른쪽 단추로 일터를 정합니다.',
          cond: { type: 'all', of: [{ type: 'population', count: 3 }, { type: 'structure', building: 'granary', count: 1 }] },
          target: { type: 'site', building: 'granary', fallback: { type: 'buildSlot', building: 'granary', sel: '#tb-build' } } }
      ],
      reward: { line: '이제 혼자가 아니다.',
                card: { icon: 'folk', title: '주민에게 일을 시킵니다', text: '끌어서 고르고 오른쪽 단추를 누르면 그 자리로 갑니다.' } } },
    { id: 5, key: 'shape_of_town', name: '마을의 꼴', subtitle: '사람이 사람을 부른다',
      opens: { buildings: ['tent', 'storage_crate', 'hut', 'granary', 'well', 'woodpile', 'lamp'],
               features: [], ui: ['panel.skills'] },
      steps: [{ key: 'pop5', title: '주민 다섯이면 촌락입니다', sub: '잠자리를 늘리고 곳간을 채우세요.',
                cond: { type: 'population', count: 5 }, target: { type: 'structure', building: 'hut' } }],
      reward: { line: '이름을 얻을 만큼은 되었다.',
                card: { icon: 'tier', title: '촌락이 되었습니다', text: '말뚝이 새 자리에 박히고 땅이 넓어집니다.' } } },
    { id: 6, key: 'secret_of_land', name: '땅의 비밀', subtitle: '이 땅이 무엇인지 알아야 한다',
      opens: { buildings: ['tent', 'storage_crate', 'hut', 'granary', 'well', 'woodpile', 'lamp',
                           'house', 'sawmill', 'watchpost', 'appraisal_post'], features: [], ui: [] },
      steps: [
        { key: 'stone30', short: '감정소', title: '석재 30을 캐세요', verb: 'E — 돌 캐기',
          sub: '회색 바위에서 돌을 캡니다. 감정소는 목재 60·석재 30이 듭니다.',
          cond: { type: 'resource', resource: 'stone', amount: 30 }, target: { type: 'node', nodeTypes: ['rock'] } },
        { key: 'appraisal_built', title: '감정소를 세우세요', verb: 'E — 짓기',
          sub: '땅의 내력을 재는 곳입니다.',
          cond: { type: 'structure', building: 'appraisal_post', count: 1 },
          target: { type: 'site', building: 'appraisal_post', fallback: { type: 'buildSlot', building: 'appraisal_post', sel: '#tb-build' } } },
        { key: 'appraised', title: '감정소를 눌러 [땅을 감정한다]', sub: '이 땅이 무엇을 품었는지 드러납니다.',
          cond: { type: 'flag', flag: 'appraised' }, target: { type: 'structure', building: 'appraisal_post' },
          hint: { sel: '#world-canvas', text: '감정소를 누르면 [땅을 감정한다]가 뜹니다' } }
      ],
      reward: { line: '땅이 제 내력을 드러냈다.',
                opens: { features: ['roles', 'departments'], ui: ['panel.roles'] },
                card: { icon: 'crown', title: '저마다의 자리', text: '각료를 세우고 하나를 손수 맡을 수 있습니다.' } } },
    { id: 7, key: 'strange_tracks', name: '낯선 발자국', subtitle: '바깥이 우리를 알아본다', endless: true,
      opens: { buildings: ['fence', 'gate', 'arrow_tower', 'banner'], features: ['fences', 'waves'],
               ui: ['panel.fence', 'hud.threat'] },
      steps: [], reward: null }
  ];

  function baseConfig() {
    return {
      protocol: '3.1',
      time: { dayRealSeconds: DAY_SECONDS, subtickSeconds: 0.25, dayPhases: ['morning', 'day', 'evening', 'night'] },
      resources: { order: ['grain', 'wood', 'stone', 'ironOre', 'oil', 'steel', 'fuel'],
        meta: { grain: { name: '곡물' }, wood: { name: '목재' }, stone: { name: '석재' },
                ironOre: { name: '철광석' }, oil: { name: '석유' }, steel: { name: '강재' }, fuel: { name: '연료' } } },
      tiers: { speedBonusPerTier: 0.05, maxDefinedTier: 6, levels: TIERS,
               endless: { populationStep: 30, radiusPerTier: 4, namePattern: '왕도 {n}대' } },
      skills: {
        order: ['farm', 'lumber', 'mining', 'build', 'combat'], maxLevel: 20,
        defs: { farm: { name: '농사' }, lumber: { name: '벌목' }, mining: { name: '채광' },
                build: { name: '건설' }, combat: { name: '전투' } },
        swing: { baseCooldownSec: 1.2, cooldownPerLevel: 0.03, cooldownFloorSec: 0.5, rangeTiles: 3,
                 yieldPerLevel: 0.05, xpPerSwing: 2, xpPerCycle: 6, drainExponent: 0.85 },
        combat: { damagePerSwing: 9, rangeTiles: 2.5, playerHp: 60, downSeconds: 12 },
        nodes: {}, site: { skill: 'build', swings: 4, buildPointsPerSwing: 1.2 }
      },
      waves: { startTier: 2, rotation: ['wolf', 'bandit'], basePower: 245, growth: 1.18,
               types: { wolf: { name: '늑대 떼', hp: 55, dps: 6, direction: 'north' },
                        bandit: { name: '도적', hp: 70, dps: 8, direction: 'east' } },
               battle: { subtickSeconds: 0.25, maxSeconds: 120 } },
      buildings: {
        categories: { housing: { name: '주거' }, production: { name: '생산' },
                      military: { name: '군사' }, civic: { name: '발전' }, decor: { name: '장식' } },
        defs: mockBuildingDefs()
      },
      roles: { order: ['farm', 'factory', 'build', 'defense', 'trade', 'saint'], defs: {} },
      tags: {}, artifacts: { grades: {}, list: [] },
      aiNations: [{ id: 'ai_a', name: '북풍국' }],
      difficulty: { order: ['story', 'kingdom', 'trial'], default: 'kingdom',
        presets: { story: { name: '이야기', desc: '천천히 정착지를 키우고 싶은 분께.' },
                   kingdom: { name: '왕국', desc: '설계된 그대로의 균형.' },
                   trial: { name: '시련', desc: '한 번의 실수가 정착지를 흔듭니다.' } } },
      tactics: { options: [{ key: 'siege', name: '농성', desc: '울타리를 걸어 잠그고 버틴다.' },
                           { key: 'sortie', name: '요격', desc: '문을 열고 나가 맞받아친다.' }] },
      world: {
        size: SIZE, territory: { baseRadius: 6 },
        terrain: { codes: CODES, walkable: ['grass', 'forest', 'rock', 'fertile'],
                   buildable: ['grass', 'forest', 'fertile'] },
        buildingPlacement: { minSpacing: 2, nodeClearance: 1, adjacency: { radius: 5, perNode: 0.02, max: 0.1, byBuilding: {} } },
        reclaim: { cost: { wood: 12 }, terrain: ['grass', 'fertile'], minSpacing: 2, maxFields: 40 },
        fences: { maxSegments: 400, maxPointsPerRequest: 64, maxSegmentSpan: 40,
                  blockedTerrain: ['water'], requiresTerritory: true },
        fog: { chunk: 16, vision: { town: 13, building: 6, site: 4, villager: 4, scout: 7, lord: 9 },
               nightVisionMultiplier: 0.8 },
        appearance: null
      }
    };
  }

  function mockBuildingDefs() {
    var out = {};
    Object.keys(BUILD).forEach(function (k) {
      var b = BUILD[k];
      out[k] = { key: k, name: b.name, category: b.category, desc: '', requiresTier: 0,
                 maxTier: 3, multi: !!b.multi, piece: false, core: false,
                 tiers: [1, 2, 3].map(function (t) {
                   return { tier: t, name: b.name, cost: scaleCost(b.cost, t), gold: 0,
                            buildPoints: Math.round(b.bp * (1 + (t - 1) * 0.8)),
                            hp: Math.round(b.hp * (1 + (t - 1) * 0.7)),
                            effects: b.beds ? [{ label: '수용 인원', value: (b.beds * t) + '명' }] : [] };
                 }) };
    });
    return out;
  }
  function scaleCost(c, t) {
    var out = {};
    for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) out[k] = Math.round(c[k] * Math.pow(2.2, t - 1));
    return out;
  }

  /* ══════════ 월드 ══════════ */
  function createSocket(opts) {
    opts = opts || {};
    var handlers = {};
    var rng = mulberry(opts.seed || 4242);
    var cfg = baseConfig();

    var W = {
      tick: 1, paused: false, seed: opts.seed || 4242,
      terrain: new Uint8Array(SIZE * SIZE),
      nodes: [], structures: [], sites: [], fences: [], residents: [],
      cx: 48, cy: 48, radius: 6, tier: 0,
      resources: { grain: 6, wood: 0, stone: 0, ironOre: 0, oil: 0, steel: 0, fuel: 0 },
      gold: 0, morale: 1.0, population: 0,
      skills: {}, swingAt: 0, nextId: 1,
      wave: null, battle: null, waveIndex: 0,
      chronicle: [], nameIdx: 0,
      /* ★ 진행 감독 — 국가 단위 장 상태 */
      progress: { chapter: 1, step: 0, cleared: [], flags: {} },
      swingsBySkill: {}
    };
    ['farm', 'lumber', 'mining', 'build', 'combat'].forEach(function (k) { W.skills[k] = { level: 1, xp: 0 }; });

    genTerrain(W, rng);
    genNodes(W, rng);

    function fire(evt, payload) {
      var list = handlers[evt] || [];
      for (var i = 0; i < list.length; i++) {
        try { list[i](payload); } catch (e) { console.error('[mock] ' + evt, e); }
      }
    }
    function nid(p) { return p + (W.nextId++); }

    /* ── 지형·노드 ── */
    function genTerrain(w, r) {
      for (var y = 0; y < SIZE; y++) {
        for (var x = 0; x < SIZE; x++) {
          var d = Math.hypot(x - w.cx, y - w.cy);
          var n = r();
          var code = 0;
          if (n > 0.86) code = 1;
          else if (n > 0.80) code = 2;
          else if (n > 0.76 && d > 14) code = 3;
          else if (n > 0.66) code = 4;
          w.terrain[y * SIZE + x] = code;
        }
      }
      /* 정착지 자리는 늘 풀밭 */
      for (var yy = -3; yy <= 3; yy++) for (var xx = -3; xx <= 3; xx++) {
        w.terrain[(w.cy + yy) * SIZE + (w.cx + xx)] = 0;
      }
    }

    function genNodes(w, r) {
      var types = [['forest', 26], ['rock', 12], ['fertile', 10], ['water', 6], ['iron', 4]];
      types.forEach(function (t) {
        for (var i = 0; i < t[1]; i++) {
          var a = r() * Math.PI * 2;
          var d = 2.5 + r() * 20;
          var x = Math.round(w.cx + Math.cos(a) * d);
          var y = Math.round(w.cy + Math.sin(a) * d);
          if (x < 2 || y < 2 || x >= SIZE - 2 || y >= SIZE - 2) continue;
          if (nodeAt(w, x, y)) continue;
          w.nodes.push({
            id: nid('n'), type: t[0], x: x, y: y, name: nodeName(t[0]),
            rich: r() > 0.85, amount: 40 + Math.round(r() * 30), max: 70, ratio: 1,
            depleted: false, workers: 0, slots: 4, job: null,
            swings: 0, swingsPerCycle: swingsOf(t[0]), skill: skillOf(t[0]),
            readyAt: null, harvestReady: t[0] === 'fertile' || t[0] === 'water',
            stage: t[0] === 'fertile' ? 'ripe' : null, stageName: null, growth: null, mine: true
          });
        }
      });
    }
    function nodeAt(w, x, y) {
      for (var i = 0; i < w.nodes.length; i++) if (w.nodes[i].x === x && w.nodes[i].y === y) return w.nodes[i];
      return null;
    }
    function nodeName(t) {
      return { forest: '나무', rock: '바위', fertile: '기름진 땅', water: '물가', iron: '철광맥', field: '밭' }[t] || t;
    }
    function swingsOf(t) { return { forest: 3, rock: 4, iron: 5, fertile: 4, water: 4, field: 4 }[t] || 4; }
    function skillOf(t) { return { forest: 'lumber', rock: 'mining', iron: 'mining', fertile: 'farm', water: 'farm', field: 'farm' }[t] || 'lumber'; }
    function yieldOf(t) {
      return { forest: { wood: 3 }, rock: { stone: 2 }, iron: { ironOre: 1 },
               fertile: { grain: 3.5 }, water: { grain: 2 }, field: { grain: 3 } }[t] || { wood: 1 };
    }
    function cycleBonusOf(t) {
      return { forest: { wood: 4 }, rock: { stone: 3 }, iron: { ironOre: 2 },
               fertile: { grain: 9 }, water: { grain: 5 }, field: { grain: 8 } }[t] || { wood: 1 };
    }

    /* ── 뷰 ── */
    function tierDef(t) { return TIERS[Math.min(t, TIERS.length - 1)]; }
    /* ★ 해금은 티어가 아니라 '지금 장'이 쥔다 (GDD3 §11-1) */
    function chapterDef(id) {
      for (var i = 0; i < CHAPTERS.length; i++) if (CHAPTERS[i].id === id) return CHAPTERS[i];
      return null;
    }
    function mergeOpens(out, o) {
      if (!o) return;
      ['buildings', 'features', 'ui'].forEach(function (k) {
        (o[k] || []).forEach(function (v) { if (out[k].indexOf(v) < 0) out[k].push(v); });
      });
    }
    function unlockedList() {
      var out = { buildings: [], features: [], ui: [], commands: [] };
      var p = W.progress;
      for (var i = 0; i < CHAPTERS.length; i++) {
        var ch = CHAPTERS[i];
        if (ch.id > p.chapter) break;
        mergeOpens(out, ch.opens);
        if (ch.id < p.chapter) mergeOpens(out, ch.reward && ch.reward.opens);
        (ch.steps || []).forEach(function (st) {
          if (p.cleared.indexOf(ch.id + ':' + st.key) >= 0) mergeOpens(out, st.opens);
        });
      }
      return out;
    }
    function measure(cond) {
      if (!cond) return { ok: true, have: 1, need: 1 };
      if (cond.type === 'swings') {
        var h = W.swingsBySkill[cond.skill] || 0;
        return { ok: h >= cond.count, have: h, need: cond.count };
      }
      if (cond.type === 'resource') {
        var r = Math.floor(W.resources[cond.resource] || 0);
        return { ok: r >= cond.amount, have: r, need: cond.amount };
      }
      if (cond.type === 'structure') {
        var c = countStructure(cond.building);
        return { ok: c >= (cond.count || 1), have: c, need: cond.count || 1 };
      }
      if (cond.type === 'population') return { ok: W.population >= cond.count, have: W.population, need: cond.count };
      if (cond.type === 'flag') return { ok: !!W.progress.flags[cond.flag], have: W.progress.flags[cond.flag] ? 1 : 0, need: 1 };
      if (cond.type === 'all') {
        var parts = cond.of.map(measure);
        var done = parts.filter(function (x) { return x.ok; }).length;
        return { ok: done === parts.length, have: done, need: parts.length };
      }
      return { ok: false, have: 0, need: 1 };
    }
    /** 사슬 판정 — 명령·스윙·일 틱 뒤마다 부른다 */
    function evaluateProgress() {
      var guard = 0;
      while (guard++ < 24) {
        var ch = chapterDef(W.progress.chapter);
        if (!ch) return;
        var steps = ch.steps || [];
        if (W.progress.step >= steps.length) {
          var next = chapterDef(ch.id + 1);
          if (!next) return;
          fire('chapterDone', { id: ch.id, key: ch.key, name: ch.name,
                                line: ch.reward && ch.reward.line, card: ch.reward && ch.reward.card });
          W.progress.chapter = next.id;
          W.progress.step = 0;
          fire('chapterOpen', { id: next.id, key: next.key, name: next.name, subtitle: next.subtitle });
          continue;
        }
        var st = steps[W.progress.step];
        if (!measure(st.cond).ok) return;
        if (W.progress.cleared.indexOf(ch.id + ':' + st.key) < 0) W.progress.cleared.push(ch.id + ':' + st.key);
        W.progress.step++;
        fire('questStep', { chapter: ch.id, step: st.key, title: st.title });
      }
    }
    /** 목표 카드가 그릴 것 + 마커 대상 후보 */
    function chapterView() {
      var ch = chapterDef(W.progress.chapter);
      if (!ch) return null;
      var st = (ch.steps || [])[W.progress.step] || null;
      var m = st ? measure(st.cond) : null;
      return {
        id: ch.id, key: ch.key, name: ch.name, subtitle: ch.subtitle || null,
        total: CHAPTERS.length, endless: !!ch.endless,
        stepIndex: W.progress.step, stepCount: (ch.steps || []).length,
        goal: st ? {
          key: st.key, title: st.title, sub: st.sub || '', verb: st.verb || null, short: st.short || null,
          condition: st.cond, have: m.have, need: m.need, done: m.ok,
          hint: st.hint || null, hintOnFail: null, targets: targetsFor(st.target)
        } : null,
        flags: W.progress.flags, trace: null
      };
    }
    function targetsFor(t) {
      if (!t) return [];
      var out = [];
      if (t.type === 'node') {
        W.nodes.filter(function (n) {
          return t.nodeTypes.indexOf(n.type) >= 0 && !n.depleted && dist(n.x, n.y) <= W.radius + 0.001;
        }).sort(function (a, b) { return dist(a.x, a.y) - dist(b.x, b.y); })
          .slice(0, 3).forEach(function (n) { out.push({ kind: 'node', id: n.id, x: n.x, y: n.y, name: n.type }); });
      } else if (t.type === 'site') {
        W.sites.forEach(function (c) {
          if (c.building === t.building) out.push({ kind: 'site', id: c.id, x: c.x, y: c.y, name: BUILD[c.building].name });
        });
      } else if (t.type === 'structure') {
        W.structures.forEach(function (x) {
          if (!t.building || x.key === t.building) out.push({ kind: 'structure', id: x.id, x: x.x, y: x.y, name: BUILD[x.key].name });
        });
        out = out.slice(0, 3);
      }
      if (!out.length && t.fallback && t.fallback.type === 'buildSlot') {
        out.push({ kind: 'buildSlot', id: t.fallback.building, sel: t.fallback.sel,
                   name: BUILD[t.fallback.building] ? BUILD[t.fallback.building].name : t.fallback.building });
      }
      return out;
    }
    function featOn(f) { return unlockedList().features.indexOf(f) >= 0; }
    function capacity() {
      var c = 0;
      W.structures.forEach(function (s) {
        var b = BUILD[s.key];
        if (b && b.beds) c += b.beds * s.tier;
      });
      return c;
    }
    function countStructure(key) {
      var n = 0;
      W.structures.forEach(function (s) { if (s.key === key) n++; });
      return n;
    }
    function tierReqs(next) {
      if (!next) return [];
      var out = [];
      var rq = next.requires || {};
      /* ★ §13-A-1 — 구경 모드도 실서버와 **같은 모양의 행**을 낸다(kind·dec).
         화면의 단일 정본(state.js reqLive)이 여기서도 그대로 돌아야 한다. */
      if (rq.population) {
        out.push({ key: 'population', kind: 'population', ok: W.population >= rq.population,
                   need: rq.population, have: W.population, dec: 0, text: '주민 ' + rq.population + '명' });
      }
      if (rq.structures) {
        Object.keys(rq.structures).forEach(function (k) {
          out.push({ key: 'structure:' + k, kind: 'structure', building: k,
                     ok: countStructure(k) >= rq.structures[k], need: rq.structures[k],
                     have: countStructure(k), dec: 0,
                     text: (BUILD[k] ? BUILD[k].name : k) + ' ' + rq.structures[k] + '채' });
        });
      }
      if (rq.resources) {
        Object.keys(rq.resources).forEach(function (k) {
          out.push({ key: 'resource:' + k, kind: 'resource', resource: k,
                     ok: Math.floor(W.resources[k] || 0) >= rq.resources[k], need: rq.resources[k],
                     have: Math.floor(W.resources[k] || 0), dec: 0,
                     text: (k === 'grain' ? '식량' : k) + ' ' + rq.resources[k] });
        });
      }
      return out;
    }

    function skillView(key) {
      var s = W.skills[key];
      var cd = Math.max(0.5, 1.2 * (1 - 0.03 * (s.level - 1)) * (1 - 0.05 * W.tier));
      return {
        name: { farm: '농사', lumber: '벌목', mining: '채광', build: '건설', combat: '전투' }[key],
        level: s.level, xp: s.xp,
        next: { need: 36 * s.level, have: s.xp, remaining: Math.max(0, 36 * s.level - s.xp) },
        cooldownSec: Math.round(cd * 100) / 100,
        yieldMultiplier: 1 + 0.05 * (s.level - 1),
        tool: { key: 'stone', name: s.level >= 6 ? '철도구' : '돌도구', multiplier: s.level >= 6 ? 2 : 1 },
        nextTool: s.level < 6 ? { key: 'iron', name: '철도구', level: 6, multiplier: 2 } : null
      };
    }

    /* ★ 지금 장에서 지을 수 있는 것만 — 잠긴 건물은 목록에 아예 없다(GDD3 §11-1) */
    function buildableList() {
      var un = unlockedList().buildings;
      return Object.keys(BUILD).filter(function (k) { return un.indexOf(k) >= 0; }).map(function (k) {
        var b = BUILD[k];
        var t1 = scaleCost(b.cost, 1);
        var afford = true;
        for (var r in t1) if (W.resources[r] < t1[r]) afford = false;
        return { key: k, name: b.name, category: b.category, requiresTier: 0,
                 unlocked: true, multi: !!b.multi, built: countStructure(k), maxTier: b.maxTier || 3,
                 cost: t1, gold: 0, buildPoints: b.bp, affordable: afford,
                 action: b.action || null, actionLabel: b.actionLabel || null };
      });
    }

    function structureView(s) {
      var b = BUILD[s.key];
      var t = s.tier;
      var maxHp = Math.round(b.hp * (1 + (t - 1) * 0.7));
      return {
        id: s.id, key: s.key, name: b.name, category: b.category, tier: t, maxTier: 3,
        x: s.x, y: s.y, hp: s.hp, maxHp: maxHp, condition: Math.round((s.hp / maxHp) * 100) / 100,
        ruined: s.hp <= 0, upgrading: !!s.upgrading, residents: 0,
        action: b.action || null, actionLabel: b.actionLabel || null,
        effects: b.beds ? [{ label: '수용 인원', value: (b.beds * t) + '명' }] : [],
        nextTier: t < 3 ? { tier: t + 1, name: b.name, cost: scaleCost(b.cost, t + 1), gold: 0,
                            buildPoints: Math.round(b.bp * (1 + t * 0.8)),
                            effects: b.beds ? [{ label: '수용 인원', value: (b.beds * (t + 1)) + '명' }] : [] } : null,
        adjacency: null
      };
    }

    function defenseView() {
      var turrets = W.structures.filter(function (s) { return BUILD[s.key] && BUILD[s.key].dps; })
        .map(function (s) {
          return { id: s.id, key: s.key, name: BUILD[s.key].name, dps: BUILD[s.key].dps,
                   range: BUILD[s.key].range, x: s.x, y: s.y, counters: null };
        });
      var fenceHp = W.fences.reduce(function (a, f) { return a + f.hp; }, 0);
      var dps = turrets.reduce(function (a, t) { return a + t.dps; }, 0) + W.residents.length * 1.5 + 7.5;
      return {
        turrets: turrets, turretCount: turrets.length,
        turretDps: turrets.reduce(function (a, t) { return a + t.dps; }, 0),
        militiaCount: Math.floor(W.residents.length / 2), militiaDps: W.residents.length * 1.5,
        playerDps: 7.5, totalDps: dps, permanent: 0,
        fenceSegments: W.fences.length, fenceHp: fenceHp,
        multipliers: { defender: 1, enemy: 1 }, saint: false, saintBonus: 0,
        estimate: { enemyHp: 400, enemyDps: 40, secondsToClear: Math.max(4, 400 / Math.max(1, dps)),
                    secondsFenceHolds: fenceHp / 40, maxSeconds: 120,
                    comfortable: dps > 30 && fenceHp > 200 }
      };
    }

    function waveView() {
      if (W.tier < 2) return { index: 0, number: 1, unlocked: false, startTier: 2, active: false };
      var type = ['wolf', 'bandit'][W.waveIndex % 2];
      var def = cfg.waves.types[type];
      return {
        index: W.waveIndex, number: W.waveIndex + 1, unlocked: true, startTier: 2,
        active: !!W.battle, arrivalTick: null, daysUntil: null,
        daysUntilMin: W.wave ? W.wave.daysLeft : 3, precise: false,
        enemy: { type: type, name: def.name, desc: '', units: 6 + W.waveIndex * 2, power: 61,
                 unitHp: def.hp, unitDps: def.dps, direction: def.direction, weakTo: 'sortie',
                 flying: false, sprite: type },
        blessing: 0, hint: '바깥이 어수선합니다.', history: [], tacticHint: null
      };
    }

    function chronicleView() {
      return {
        day: W.tick, tier: W.tier, tierName: tierDef(W.tier).name,
        entries: W.chronicle.slice(-40),
        counts: {}, milestones: { tier_up: '성장', wave: '침공' },
        totals: { days: W.tick, population: W.population, peakPopulation: W.population,
                  structures: W.structures.length, fences: W.fences.length,
                  wavesFaced: W.waveIndex, wavesHeld: W.waveIndex, gold: W.gold, artifacts: 0, prestige: 0 }
      };
    }

    function stateView() {
      var cur = tierDef(W.tier);
      var next = TIERS[W.tier + 1] || null;
      return {
        protocol: 3, tick: W.tick, day: W.tick, phase: 'endless', paused: W.paused,
        difficulty: { key: 'kingdom', name: '왕국', desc: '' },
        time: cfg.time,
        tier: {
          tier: W.tier, name: cur.name, radius: W.radius, line: cur.line,
          speedBonus: 0.05 * W.tier,
          next: next ? { tier: next.tier, name: next.name, radius: next.radius, fromRadius: W.radius,
                         ready: tierReqs(next).every(function (r) { return r.ok; }),
                         reqs: tierReqs(next),
                         unlocks: { buildings: next.unlocks.buildings.map(function (k) {
                                      return { key: k, name: BUILD[k] ? BUILD[k].name : k }; }),
                                    features: next.unlocks.features, ui: next.unlocks.ui },
                         line: next.line, endless: false } : null,
          unlocked: unlockedList()
        },
        unlocked: unlockedList(),
        /* ★ v3.1 — 콘텐츠 사슬. 목표 카드와 마커가 전부 이 블록에서 나온다. */
        chapter: chapterView(),
        /* 관제는 감정을 마친 뒤에만 존재한다 — 그 전에는 필드 자체가 없다 */
        mandate: W.progress.flags.appraised
          ? { open: false, unlocked: true, done: true, vacantDefault: 'trade' } : undefined,
        you: {
          avatarId: 'p1', role: null, roleName: null,
          player: {
            id: 'p1', name: '개척자', hp: 60, maxHp: 60, down: false, downUntil: 0,
            skills: { farm: skillView('farm'), lumber: skillView('lumber'), mining: skillView('mining'),
                      build: skillView('build'), combat: skillView('combat') },
            stats: { swings: 0, kills: 0, gathered: {} },
            tierSpeedBonus: 0.05 * W.tier, settlementTier: W.tier
          },
          swing: { rangeTiles: 3, targets: swingTargets() }
        },
        nation: {
          id: 'player', name: (opts.playerName || '그대') + '의 정착지', isPlayer: true, tags: [], tagNames: [],
          town: { x: W.cx, y: W.cy }, territory: { radius: W.radius, cx: W.cx, cy: W.cy },
          residents: W.residents.map(function (r) {
            /* ★ §13-A-3 — 구경 모드도 하루 산출을 실어 준다. 없으면 짐이 안 쌓여 나르지 않는다. */
            var per = { lumber: 3.2, farm: 2.4, quarry: 1.7, mine: 0.9 }[r.job];
            var rk = { lumber: 'wood', farm: 'grain', quarry: 'stone', mine: 'ironOre' }[r.job];
            return { id: r.id, name: r.name, appearance: r.appearance, job: r.job,
                     jobName: { lumber: '나무꾼', farm: '농부', idle: '쉬는 중' }[r.job] || '일꾼',
                     x: r.x, y: r.y, destX: r.destX, destY: r.destY, targetId: r.targetId,
                     militia: false, represents: 1, selectable: true,
                     yield: per && rk ? { resource: rk, perDay: per } : undefined };
          }),
          /* ★ §13-A-5 — 구경 모드도 상한 계약을 갖춘다(자원칸 「가득」 표시가 같은 길로 돈다) */
          storage: (function () {
            var lim = 500 + 250 * (W.tier || 0);
            W.structures.forEach(function (s) {
              var cap = { storage_crate: 80, storage: 250, granary: 150 }[s.key];
              if (cap) lim += cap * Math.pow(1.6, Math.max(0, (s.tier || 1) - 1));
            });
            var full = [];
            for (var k in W.resources) if ((W.resources[k] || 0) >= lim - 0.005) full.push(k);
            return { limit: Math.round(lim * 100) / 100, full: full };
          })(),
          housing: { population: W.population, capacity: capacity(),
                     freeBeds: Math.max(0, capacity() - W.population),
                     byBuilding: {},
                     arrival: { open: capacity() > W.population, reason: capacity() > W.population ? null : '잠자리가 없습니다',
                                freeBeds: Math.max(0, capacity() - W.population), capacity: capacity(),
                                attractiveness: 1.2, intervalDays: 2, progress: (W.tick % 2) / 2,
                                grainDays: W.population ? W.resources.grain / W.population : 9 },
                     departmentsActive: false },
          peoplePerUnit: 1,
          villagerMix: { counts: {}, mix: {}, units: W.residents.length },
          structures: W.structures.map(structureView),
          sites: W.sites.map(function (c) {
            return { id: c.id, building: c.building, structureId: c.structureId || null,
                     name: BUILD[c.building].name, tier: c.tier, x: c.x, y: c.y,
                     remaining: Math.round(c.remaining * 100) / 100, total: c.total,
                     progress: Math.round((1 - c.remaining / c.total) * 100) / 100,
                     upgrade: !!c.structureId };
          }),
          fences: W.fences.slice(),
          fenceSummary: { segments: W.fences.length, gates: W.fences.filter(function (f) { return f.gate; }).length,
                          stone: 0, broken: W.fences.filter(function (f) { return f.broken; }).length,
                          damaged: W.fences.filter(function (f) { return f.condition < 0.9; }).length,
                          maxSegments: 400, costs: { wood: { wood: 6 }, stone: { stone: 8, wood: 2 }, gate: { wood: 14 } } },
          buildable: buildableList(),
          workPosts: [], camps: [], exploredRatio: 0.2,
          avatars: [], players: [{ id: 'p1', name: '그대', hp: 60, maxHp: 60, down: false, levels: {} }],
          population: W.population, populationCap: capacity(), morale: W.morale, gold: W.gold,
          resources: W.resources, laborAlloc: {}, gatherScale: {}, factoryQueue: {},
          departmentsActive: false, roles: {}, buildings: {}, buildPoints: 0, prestige: 0,
          orders: [], artifacts: [], decisionQueue: [], buffs: [], sanctuary: {},
          rationing: false, autoExport: true, online: true, members: [], stats: {},
          ap: { current: 3, max: 3, actions: {}, usedDepts: [] },
          advices: [], autoAssist: true,
          battlePlan: { tactic: 'siege', setTick: null, options: cfg.tactics.options, bonus: 0.12, penalty: 0.08 },
          ruinGauge: 0, ruinThreshold: 3, survey: null, nodeContribution: {}
        },
        /* ★ 웨이브·시장은 그 장이 열리기 전에는 블록 자체가 없다(GDD3 §11-1) */
        wave: featOn('waves') ? waveView() : null,
        battle: null,
        lastBattle: null,
        defense: featOn('waves') ? defenseView() : null,
        recommendations: { labor: {} },
        chronicle: chronicleView()
      };
    }

    function swingTargets() {
      var out = {};
      ['forest', 'rock', 'iron', 'fertile', 'water', 'field'].forEach(function (t) {
        var sk = W.skills[skillOf(t)];
        var cd = Math.max(500, 1200 * (1 - 0.03 * (sk.level - 1)) * (1 - 0.05 * W.tier));
        out[t] = { skill: skillOf(t), swings: swingsOf(t), cooldownMs: Math.round(cd),
                   multiplier: 1 + 0.05 * (sk.level - 1), yield: yieldOf(t), cycleBonus: cycleBonusOf(t) };
      });
      var bs = W.skills.build;
      out.site = { skill: 'build', swings: 4,
                   cooldownMs: Math.round(Math.max(500, 1200 * (1 - 0.03 * (bs.level - 1)))),
                   multiplier: 1, yield: null, cycleBonus: null };
      return out;
    }

    function worldSnapshot() {
      var rle = [];
      var prev = W.terrain[0], run = 0;
      for (var i = 0; i < W.terrain.length; i++) {
        if (W.terrain[i] === prev) run++;
        else { rle.push(prev, run); prev = W.terrain[i]; run = 1; }
      }
      rle.push(prev, run);
      return {
        protocol: 3, tick: W.tick, size: SIZE, seed: W.seed,
        terrain: { codes: CODES, rle: rle },
        nodes: W.nodes.filter(function (n) { return dist(n.x, n.y) <= W.radius + 6; }),
        towns: [{ nationId: 'player', name: '우리 정착지', x: W.cx, y: W.cy, isPlayer: true,
                  radius: W.radius, preset: [], known: true }],
        caravans: [],
        fog: { size: SIZE, chunk: 16, chunks: fogChunks() },
        territory: { cx: W.cx, cy: W.cy, radius: W.radius },
        structures: W.structures.map(structureView),
        fences: W.fences.slice(),
        tier: W.tier
      };
    }
    function dist(x, y) { return Math.hypot(x - W.cx, y - W.cy); }
    function fogChunks() {
      /* 정착지 둘레 청크만 밝힌다 */
      var out = [];
      var per = Math.ceil(SIZE / 16);
      for (var cy = 0; cy < per; cy++) {
        for (var cx = 0; cx < per; cx++) {
          var mx = cx * 16 + 8, my = cy * 16 + 8;
          var d = Math.hypot(mx - W.cx, my - W.cy);
          var v = d < W.radius + 10 ? 2 : (d < W.radius + 20 ? 1 : 0);
          out.push([cx, cy, v, 256]);
        }
      }
      return out;
    }

    /* ── 하루 틱 ── */
    function dayTick() {
      if (W.paused) return;
      W.tick++;
      /* 공사 진행 */
      for (var i = W.sites.length - 1; i >= 0; i--) {
        var c = W.sites[i];
        c.remaining -= 1.2 + W.residents.length * 0.4;
        if (c.remaining <= 0) finishSite(i);
      }
      /* 식량 소비 */
      W.resources.grain = Math.max(0, W.resources.grain - W.population * 0.6);
      /* 주민 유입 */
      if (featOn('residentArrival') && capacity() > W.population && W.resources.grain > 4 && W.tick % 2 === 0) {
        addResident();
      }
      /* 밭 여묾 */
      W.nodes.forEach(function (n) {
        if ((n.type === 'fertile' || n.type === 'field') && !n.harvestReady && W.tick % 3 === 0) {
          n.harvestReady = true; n.stage = 'ripe';
        }
      });
      checkTier();
      evaluateProgress();
      /* 웨이브 — ★ 7장(낯선 발자국)이 열린 뒤에만 */
      if (featOn('waves')) {
        if (!W.wave) W.wave = { daysLeft: 3 };
        else if (!W.battle) {
          W.wave.daysLeft--;
          if (W.wave.daysLeft <= 0) startWave();
        }
      }
      fire('state', stateView());
      fire('worldDiff', { tick: W.tick, sinceTick: W.tick - 1, fog: fogChunks(),
                          nodes: W.nodes.filter(function (n) { return dist(n.x, n.y) <= W.radius + 6; }),
                          towns: [], territory: { cx: W.cx, cy: W.cy, radius: W.radius },
                          structures: W.structures.map(structureView), sites: [],
                          fences: W.fences.slice(), residents: [], camps: [], avatars: [] });
    }

    function addResident() {
      var name = NAMES[(W.nameIdx++) % NAMES.length];
      var a = Math.random() * Math.PI * 2;
      var app = { skin: (Math.random() * 6) | 0, hair: (Math.random() * 8) | 0,
                  hairColor: (Math.random() * 10) | 0, outfit: (Math.random() * 6) | 0,
                  outfitColor: (Math.random() * 10) | 0 };
      var r = {
        id: nid('r'), name: name, appearance: app, job: 'idle',
        x: Math.round(W.cx + Math.cos(a) * (W.radius + 4)),
        y: Math.round(W.cy + Math.sin(a) * (W.radius + 4)),
        destX: W.cx + 1, destY: W.cy + 2, targetId: null
      };
      W.residents.push(r);
      W.population = W.residents.length;
      W.chronicle.push({ id: nid('k'), tick: W.tick, kind: 'resident', title: name + ' 도착', text: '새 사람이 들어왔다.', data: {} });
      fire('residentArrived', { id: r.id, name: name, appearance: app, x: r.x, y: r.y,
                               total: W.population, population: W.population, capacity: capacity() });
    }

    function finishSite(i) {
      var c = W.sites[i];
      W.sites.splice(i, 1);
      var b = BUILD[c.building];
      var s;
      if (c.structureId) {
        s = null;
        W.structures.forEach(function (x) { if (x.id === c.structureId) s = x; });
        if (s) { s.tier = c.tier; s.hp = Math.round(b.hp * (1 + (c.tier - 1) * 0.7)); s.upgrading = false; }
      } else {
        s = { id: nid('s'), key: c.building, tier: 1, x: c.x, y: c.y, hp: b.hp, upgrading: false };
        W.structures.push(s);
      }
      if (!s) return;
      W.chronicle.push({ id: nid('k'), tick: W.tick, kind: 'building', title: b.name + ' 완공', text: '', data: {} });
      fire('buildingDone', { structureId: s.id, building: s.key, key: s.key, name: b.name,
                            tier: s.tier, x: s.x, y: s.y, upgrade: !!c.structureId });
    }

    function checkTier() {
      var next = TIERS[W.tier + 1];
      if (!next) return;
      if (!tierReqs(next).every(function (r) { return r.ok; })) return;
      var from = W.radius;
      W.tier++;
      W.radius = next.radius;
      W.chronicle.push({ id: nid('k'), tick: W.tick, kind: 'tier_up', title: next.name, text: next.line, data: {} });
      var added = W.nodes.filter(function (n) { return dist(n.x, n.y) > from && dist(n.x, n.y) <= W.radius; });
      fire('tierUp', {
        tier: W.tier, name: next.name, radius: W.radius, fromRadius: from,
        unlocks: { buildings: next.unlocks.buildings.map(function (k) { return { key: k, name: BUILD[k] ? BUILD[k].name : k }; }),
                   features: next.unlocks.features, ui: next.unlocks.ui },
        line: next.line, nodesGained: added.length,
        addedNodeIds: added.map(function (n) { return n.id; }),
        milestone: next.milestone || null, unlockedAll: unlockedList()
      });
    }

    /* ── 웨이브 (아주 단순한 실시뮬) ── */
    var battleTimer = null;
    function startWave() {
      var type = ['wolf', 'bandit'][W.waveIndex % 2];
      var def = cfg.waves.types[type];
      var units = 5 + W.waveIndex * 2;
      var enemies = [];
      for (var i = 0; i < units; i++) {
        var a = -Math.PI / 2 + (i - units / 2) * 0.12;
        enemies.push({ id: 'e' + i, x: W.cx + Math.cos(a) * 20, y: W.cy + Math.sin(a) * 20,
                       hp: def.hp, maxHp: def.hp, type: type, looting: false });
      }
      W.battle = { waveIndex: W.waveIndex, number: W.waveIndex + 1, type: type, name: def.name,
                   t: 0, maxSeconds: 60, core: { x: W.cx, y: W.cy }, over: false, won: false,
                   total: units, killed: 0, escaped: 0, enemies: enemies,
                   militia: [], turrets: defenseView().turrets, players: [{ id: 'p1', hp: 60, maxHp: 60, down: false }],
                   events: [] };
      fire('waveIncoming', { index: W.waveIndex, number: W.waveIndex + 1, type: type, name: def.name,
                            units: units, power: 61, direction: def.direction });
      setTimeout(function () {
        fire('battleStart', W.battle);
        battleTimer = setInterval(battleTick, 250);
      }, 1800);
    }

    function battleTick() {
      var b = W.battle;
      if (!b) { clearInterval(battleTimer); return; }
      b.t += 0.25;
      var dps = defenseView().totalDps * 0.25;
      b.enemies.forEach(function (e) {
        if (e.hp <= 0) return;
        var d = Math.hypot(e.x - W.cx, e.y - W.cy);
        if (d > 3) { e.x += (W.cx - e.x) / d * 0.35; e.y += (W.cy - e.y) / d * 0.35; }
      });
      var alive = b.enemies.filter(function (e) { return e.hp > 0; });
      if (alive.length) {
        var target = alive[0];
        target.hp -= dps / Math.max(1, alive.length) * 3;
        if (target.hp <= 0) {
          b.killed++;
          b.events.push({ t: b.t, kind: 'kill', targetId: target.id, by: 'turret',
                          byId: (b.turrets[0] && b.turrets[0].id) || null });
        }
      }
      fire('battleTick', b);
      if (!alive.length || b.t >= b.maxSeconds) endWave(!alive.length);
    }

    function endWave(won) {
      clearInterval(battleTimer);
      var b = W.battle;
      W.battle = null;
      W.wave = { daysLeft: 4 };
      W.waveIndex++;
      W.chronicle.push({ id: nid('k'), tick: W.tick, kind: 'wave', title: b.name + ' 제 ' + b.number + '차',
                        text: won ? '모두 몰아냈다.' : '일부가 챙겨 갔다.', data: {} });
      fire('waveResult', {
        index: b.waveIndex, number: b.number, tick: W.tick, type: b.type, name: b.name, power: 61,
        won: won, duration: b.t, enemiesTotal: b.total, enemiesKilled: b.killed,
        enemiesEscaped: b.total - b.killed, fencesBroken: 0, militiaDowned: 0, playersDowned: 0,
        looted: {}, structuresDamaged: [], playerDamage: {}, moraleDelta: won ? 0.04 : -0.03,
        gold: won ? 20 : 0, timeline: [],
        text: won ? b.name + '을(를) 모두 막아 냈습니다.' : b.name + '이(가) 물러갔습니다.'
      });
      fire('state', stateView());
    }

    /* ── 명령 ── */
    function handleSwing(payload, ack) {
      var now = Date.now();
      if (payload.siteId) {
        var site = null;
        W.sites.forEach(function (c) { if (c.id === payload.siteId) site = c; });
        if (!site) return ack && ack({ ok: false, error: { code: 'NO_SITE', message: '그런 현장이 없습니다.' } });
        var sk = W.skills.build;
        var cd = Math.max(500, 1200 * (1 - 0.03 * (sk.level - 1)));
        if (now - W.swingAt < cd) {
          return ack && ack({ ok: false, error: { code: 'COOLDOWN', message: '아직 숨을 고르는 중', waitMs: cd - (now - W.swingAt), cooldownMs: cd } });
        }
        W.swingAt = now;
        site.remaining = Math.max(0, site.remaining - 1.2);
        site.swings = (site.swings || 0) + 1;
        W.swingsBySkill.build = (W.swingsBySkill.build || 0) + 1;
        var lv = gainXp('build', 2);
        var res = { ok: true, siteId: site.id, building: site.building, skill: 'build',
                    buildPoints: 1.2, remaining: site.remaining, total: site.total,
                    progress: 1 - site.remaining / site.total, cycle: site.swings % 4 === 0,
                    cooldownMs: cd, level: W.skills.build.level, leveled: lv, xp: W.skills.build.xp };
        if (site.remaining <= 0) {
          var idx = W.sites.indexOf(site);
          if (idx >= 0) finishSite(idx);
        }
        evaluateProgress();
        if (ack) ack(res);
        fire('state', stateView());
        return;
      }
      var n = null;
      W.nodes.forEach(function (x) { if (x.id === payload.nodeId) n = x; });
      if (!n) return ack && ack({ ok: false, error: { code: 'BAD_TARGET', message: '그런 자리가 없습니다.' } });
      if (n.depleted) return ack && ack({ ok: false, error: { code: 'DEPLETED', message: '다 캤습니다.' } });
      var skill = skillOf(n.type);
      var s2 = W.skills[skill];
      var cd2 = Math.max(500, 1200 * (1 - 0.03 * (s2.level - 1)) * (1 - 0.05 * W.tier));
      if (now - W.swingAt < cd2) {
        return ack && ack({ ok: false, error: { code: 'COOLDOWN', message: '아직 숨을 고르는 중', waitMs: cd2 - (now - W.swingAt), cooldownMs: cd2 } });
      }
      W.swingAt = now;
      n.swings = (n.swings || 0) + 1;
      var mult = 1 + 0.05 * (s2.level - 1);
      var gained = {};
      var y = yieldOf(n.type);
      Object.keys(y).forEach(function (k) { gained[k] = Math.round(y[k] * mult * 10) / 10; });
      var cycle = n.swings >= n.swingsPerCycle;
      if (cycle) {
        n.swings = 0;
        var cb = cycleBonusOf(n.type);
        Object.keys(cb).forEach(function (k) { gained[k] = Math.round((gained[k] || 0) + cb[k] * mult * 10) / 10; });
        if (n.type === 'fertile' || n.type === 'field') { n.harvestReady = false; n.stage = 'sown'; }
        else { n.amount = Math.max(0, n.amount - 6); }
        if (n.amount <= 0) { n.depleted = true; n.ratio = 0; }
        n.ratio = n.max ? n.amount / n.max : 1;
      }
      Object.keys(gained).forEach(function (k) { W.resources[k] = (W.resources[k] || 0) + gained[k]; });
      W.swingsBySkill[skill] = (W.swingsBySkill[skill] || 0) + 1;
      var leveled = gainXp(skill, cycle ? 6 : 2);
      checkTier();
      evaluateProgress();
      if (ack) {
        ack({ ok: true, nodeId: n.id, nodeType: n.type, skill: skill, gained: gained, cycle: cycle,
              swings: n.swings, swingsPerCycle: n.swingsPerCycle, amount: n.amount, depleted: n.depleted,
              cooldownMs: Math.round(cd2), multiplier: mult,
              tool: { key: 'stone', name: '돌도구', multiplier: 1 },
              level: W.skills[skill].level, leveled: leveled, xp: W.skills[skill].xp, ruin: null });
      }
      fire('state', stateView());
    }

    function gainXp(skill, amount) {
      var s = W.skills[skill];
      s.xp += amount;
      if (s.xp >= 36 * s.level) { s.xp = 0; s.level++; return true; }
      return false;
    }

    function afford(cost) {
      for (var k in cost) if ((W.resources[k] || 0) < cost[k]) return false;
      return true;
    }
    function pay(cost) {
      for (var k in cost) W.resources[k] = (W.resources[k] || 0) - cost[k];
    }

    /* ── 소켓 ── */
    var socket = {
      __mock: true,
      on: function (evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); },
      emit: function (evt, payload, ack) {
        payload = payload || {};
        switch (evt) {
          case 'join':
            opts.playerName = payload.playerName || '그대';
            setTimeout(function () {
              fire('joined', { protocol: '3.1', gameId: 'mock', nationId: 'player',
                               you: { role: null, avatarId: 'p1', appearance: payload.appearance || {} },
                               config: cfg, roleLocked: true, tier: 0 });
              fire('chatHistory', []);
              fire('avatars', []);
              fire('world', worldSnapshot());
              fire('state', stateView());
              fire('worldState', { nations: [], invasionArrows: [] });
              fire('chronicle', chronicleView());
            }, 60);
            break;
          case 'requestWorld':
            fire('world', worldSnapshot());
            fire('state', stateView());
            if (ack) ack({ ok: true });
            break;
          case 'requestChronicle':
            fire('chronicle', chronicleView());
            if (ack) ack({ ok: true, chronicle: chronicleView() });
            break;
          case 'actionSwing': handleSwing(payload, ack); break;
          case 'combatSwing': {
            var b = W.battle;
            if (!b) { if (ack) ack({ ok: false, error: { code: 'NO_BATTLE', message: '지금은 싸울 때가 아닙니다.' } }); break; }
            var tgt = null;
            b.enemies.forEach(function (e) { if (e.hp > 0 && (!payload.targetId || e.id === payload.targetId) && !tgt) tgt = e; });
            if (!tgt) { if (ack) ack({ ok: false, error: { code: 'NO_TARGET', message: '닿는 적이 없습니다.' } }); break; }
            tgt.hp -= 11;
            var killed = tgt.hp <= 0;
            if (killed) { b.killed++; b.events.push({ t: b.t, kind: 'kill', targetId: tgt.id, by: 'player', byId: 'p1' }); }
            if (ack) ack({ ok: true, targetId: tgt.id, damage: 11, targetHp: Math.max(0, tgt.hp),
                           killed: killed, cooldownMs: 1200, skill: 'combat',
                           level: W.skills.combat.level, leveled: gainXp('combat', killed ? 12 : 3) });
            break;
          }
          case 'placeBuilding': {
            var key = payload.building || payload.key;
            var b2 = BUILD[key];
            if (!b2) { if (ack) ack({ ok: false, error: { code: 'BAD_BUILDING', message: '알 수 없는 건물입니다.' } }); break; }
            var cost = scaleCost(b2.cost, 1);
            if (!afford(cost)) { if (ack) ack({ ok: false, error: { code: 'NO_RESOURCE', message: '자재가 모자랍니다.' } }); break; }
            pay(cost);
            var site = { id: nid('c'), building: key, tier: 1, x: payload.x, y: payload.y,
                         remaining: b2.bp, total: b2.bp, swings: 0, structureId: null };
            W.sites.push(site);
            evaluateProgress();
            if (ack) ack({ ok: true, siteId: site.id, building: key, tier: 1, buildPoints: b2.bp,
                           cost: cost, x: site.x, y: site.y, adjacency: null });
            fire('state', stateView());
            break;
          }
          case 'upgradeStructure': {
            var st = null;
            W.structures.forEach(function (x) { if (x.id === payload.structureId) st = x; });
            if (!st) { if (ack) ack({ ok: false, error: { code: 'NO_STRUCTURE', message: '그런 건물이 없습니다.' } }); break; }
            if (st.tier >= 3) { if (ack) ack({ ok: false, error: { code: 'MAX_TIER', message: '더 올릴 수 없습니다.' } }); break; }
            var bd = BUILD[st.key];
            var uc = scaleCost(bd.cost, st.tier + 1);
            if (!afford(uc)) { if (ack) ack({ ok: false, error: { code: 'NO_RESOURCE', message: '자재가 모자랍니다.' } }); break; }
            pay(uc);
            st.upgrading = true;
            var us = { id: nid('c'), building: st.key, tier: st.tier + 1, x: st.x, y: st.y,
                       remaining: bd.bp * 2, total: bd.bp * 2, swings: 0, structureId: st.id };
            W.sites.push(us);
            if (ack) ack({ ok: true, siteId: us.id, structureId: st.id, building: st.key,
                           tier: st.tier + 1, buildPoints: us.total, cost: uc });
            fire('state', stateView());
            break;
          }
          case 'repairStructure': {
            var rs = null;
            W.structures.forEach(function (x) { if (x.id === payload.structureId) rs = x; });
            if (!rs) { if (ack) ack({ ok: false, error: { code: 'NO_STRUCTURE', message: '그런 건물이 없습니다.' } }); break; }
            rs.hp = Math.round(BUILD[rs.key].hp * (1 + (rs.tier - 1) * 0.7));
            if (ack) ack({ ok: true, structureId: rs.id, cost: { wood: 8 }, structure: structureView(rs) });
            fire('state', stateView());
            break;
          }
          case 'placeFence': {
            var pts = payload.points || [];
            var placed = 0;
            var segs = [];
            for (var i = 0; i < pts.length - 1; i++) {
              if (W.resources.wood < 6) break;
              W.resources.wood -= 6;
              var gate = (payload.gates || []).indexOf(i) >= 0;
              var f = { id: nid('f'), x1: pts[i].x, y1: pts[i].y, x2: pts[i + 1].x, y2: pts[i + 1].y,
                        gate: gate, tier: 1, name: gate ? '목문' : '목책', hp: 60, maxHp: 60,
                        condition: 1, broken: false };
              W.fences.push(f);
              segs.push(f);
              placed++;
            }
            if (ack) ack({ ok: true, placed: placed, skipped: Math.max(0, pts.length - 1 - placed),
                           cost: { wood: placed * 6 }, segments: segs });
            fire('state', stateView());
            break;
          }
          case 'upgradeFence': {
            var up = 0;
            W.fences.forEach(function (f) { if (f.tier === 1) { f.tier = 2; f.name = '석벽'; f.maxHp = 140; f.hp = 140; up++; } });
            if (ack) ack({ ok: true, upgraded: up, cost: { stone: up * 8 }, segments: W.fences.slice() });
            fire('state', stateView());
            break;
          }
          case 'repairFence': {
            var rp = 0;
            W.fences.forEach(function (f) { if (f.condition < 1) { f.hp = f.maxHp; f.condition = 1; f.broken = false; rp++; } });
            if (ack) ack({ ok: true, repaired: rp, cost: { wood: rp * 2 } });
            fire('state', stateView());
            break;
          }
          case 'removeFence': {
            var ids = payload.segmentIds || [];
            W.fences = W.fences.filter(function (f) { return ids.indexOf(f.id) < 0; });
            if (ack) ack({ ok: true, removed: ids.length, refund: { wood: ids.length * 3 } });
            fire('state', stateView());
            break;
          }
          case 'reclaimField': {
            if (W.resources.wood < 12) { if (ack) ack({ ok: false, error: { code: 'NO_RESOURCE', message: '목재가 모자랍니다.' } }); break; }
            W.resources.wood -= 12;
            var fn = { id: nid('n'), type: 'field', x: payload.x, y: payload.y, name: '밭',
                       rich: false, amount: 40, max: 40, ratio: 1, depleted: false, workers: 0, slots: 4,
                       job: 'farm', swings: 0, swingsPerCycle: 4, skill: 'farm',
                       readyAt: null, harvestReady: false, stage: 'sown', stageName: '파종', growth: 0, mine: true };
            W.nodes.push(fn);
            if (ack) ack({ ok: true, node: fn, cost: { wood: 12 } });
            fire('state', stateView());
            fire('worldDiff', { tick: W.tick, sinceTick: W.tick, nodes: [fn], fog: [], towns: [],
                                territory: {}, structures: [], sites: [], fences: [], residents: [], camps: [], avatars: [] });
            break;
          }
          case 'commandVillagers': {
            var order = payload.order || {};
            (payload.ids || []).forEach(function (id) {
              W.residents.forEach(function (r) {
                if (r.id !== id) return;
                if (order.type === 'work' && order.nodeId) {
                  var t2 = null;
                  W.nodes.forEach(function (x) { if (x.id === order.nodeId) t2 = x; });
                  if (t2) { r.targetId = t2.id; r.destX = t2.x; r.destY = t2.y; r.job = skillOf(t2.type); }
                } else { r.destX = order.x; r.destY = order.y; r.job = 'idle'; r.targetId = null; }
              });
            });
            if (ack) ack({ ok: true, placed: payload.ids || [], rejected: [], used: 1, slots: 4 });
            fire('state', stateView());
            break;
          }
          /* ★ 감정의 날의 유일한 문 (GDD3 §11-4) */
          case 'appraiseLand': {
            if (!countStructure('appraisal_post')) {
              if (ack) ack({ ok: false, error: { code: 'NO_STRUCTURE', message: '감정소를 먼저 세워야 합니다.' } });
              break;
            }
            if (W.progress.flags.appraised) {
              if (ack) ack({ ok: false, error: { code: 'ALREADY_DONE', message: '이 땅은 이미 감정했습니다.' } });
              break;
            }
            W.progress.flags.appraised = true;
            evaluateProgress();
            if (ack) ack({ ok: true, appraised: true, tagNames: ['비옥한 땅', '성스러운 터'] });
            fire('emotionDay', { tags: ['비옥한 땅', '성스러운 터'], tagLine: '비옥한 땅 · 성스러운 터',
                                 revealedNodes: [], nodesRevealed: 0,
                                 cutscene: [{ text: '땅이 흔들린다.', color: '#1b1b28' },
                                            { text: '균열 사이로 빛이 샌다.', color: '#3a2f4f' },
                                            { text: '비옥한 땅 · 성스러운 터', color: '#e8c07d' }],
                                 worldTags: [] });
            fire('state', stateView());
            break;
          }
          case 'lordMove': if (ack) ack({ ok: true }); break;
          case 'chat':
            fire('chat', { name: opts.playerName || '그대', avatarId: 'p1', text: payload.text, tick: W.tick });
            if (ack) ack({ ok: true });
            break;
          default:
            if (ack) ack({ ok: true });
        }
      },
      rest: function (path) {
        if (/health/.test(path)) return { ok: true, protocol: '3.1', tick: W.tick, paused: W.paused, games: 1, worldSize: SIZE, dayRealSeconds: DAY_SECONDS };
        if (/config/.test(path)) return cfg;
        return { ok: true };
      }
    };

    setInterval(dayTick, DAY_SECONDS * 1000);
    /* 구경 모드는 몇 초마다 상태를 새로 보낸다 — 자원이 실시간으로 보이게 */
    setInterval(function () { fire('state', stateView()); }, 2000);

    return socket;
  }

  function mulberry(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  GM.mock = { createSocket: createSocket };
})(window);
