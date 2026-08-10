/* atlas.js — 도트 스프라이트 절차 생성기. 외부 이미지 파일은 하나도 쓰지 않는다.
   16×16(지형·자원) / 24×24(건물) / 16×20(사람) 격자에 사각형만으로 그려
   오프스크린 캔버스에 한 번 캐시하고, 렌더러가 drawImage 로 확대해 쓴다.
   ★ v3 — 건물 33종·울타리 조각·그루터기·마차·적 6종이 여기서 나온다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var U = GM.ui;

  var CACHE = {};
  /* 개체별 4방향/행동 스프라이트시트. 파일이 아직 읽히기 전에는 아래 절차 스프라이트가
     그대로 남으므로, 첫 로딩 프레임에서도 짐승이 사라지지 않는다. */
  var WILD_IMAGES = {};
  var GUARDIAN_IMAGES = {};
  function handmadeWild(sp) {
    var im = WILD_IMAGES[sp];
    if (!im) {
      im = new Image();
      im.onload = function () { try { global.dispatchEvent(new Event('gm:building-asset-ready')); } catch (e) {} };
      im.onerror = function () { im.failed = true; };
      im.src = 'assets/creature/' + sp + '/sheet.png?v=wild-set-1';
      WILD_IMAGES[sp] = im;
    }
    return im && im.complete && im.naturalWidth && !im.failed ? im : null;
  }

  /* ★ §19-F2(F07-4) — 세계에 한 마리뿐인 용의 전용 시트.
     여느 짐승의 4×6 시트가 아니라 동작별 9프레임 가로 스트립이다(assets/creature/ash_wyrm/):
     fly_east·fly_west·fly_north·fly_south(비행) · fire_east·fire_west(화염) · stay(대기).
     시트가 아직 안 읽혔으면 null 을 돌려주고, 그때는 기존 sheet.png(4×6) 길이 그대로 남는다. */
  var BOSS_ANIMS = { fly_east: 1, fly_west: 1, fly_north: 1, fly_south: 1,
                     fire_east: 1, fire_west: 1, stay: 1 };
  var BOSS_IMAGES = {};
  function bossSheet(anim) {
    var im = BOSS_IMAGES[anim];
    if (!im) {
      im = new Image();
      im.onload = function () { try { global.dispatchEvent(new Event('gm:building-asset-ready')); } catch (e) {} };
      im.onerror = function () { im.failed = true; };
      im.src = 'assets/creature/ash_wyrm/' + anim + '.png?v=dragon-set-1';
      BOSS_IMAGES[anim] = im;
    }
    return im && im.complete && im.naturalWidth && !im.failed ? im : null;
  }

  /** 용 한 프레임 — anim 은 BOSS_ANIMS 의 이름, frame 은 0~8. 시트 전이면 null. */
  function boss(anim, frame, opts) {
    if (!BOSS_ANIMS[anim]) anim = 'stay';
    var sheet = bossSheet(anim);
    if (!sheet) return null;
    var f = ((frame | 0) % 9 + 9) % 9;
    var cw = Math.floor(sheet.naturalWidth / 9), ch = sheet.naturalHeight;
    var hurt = opts && opts.hurt;
    return cached('boss:' + anim + ':' + f + (hurt ? ':h' : ''), cw, ch, function (P, g) {
      g.drawImage(sheet, f * cw, 0, cw, ch, 0, 0, cw, ch);
      if (hurt) {
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = 'rgba(220,80,70,.4)';
        g.fillRect(0, 0, cw, ch);
        g.globalCompositeOperation = 'source-over';
      }
    });
  }

  /* 신전 수호병은 일반 야생종과 같은 종값을 공유해도 신전별 전용 시트를 쓴다.
     시트는 4열 x 5행(대기·이동·공격·피격·사망)으로 고정한다. */
  function handmadeGuardian(theme) {
    var im = GUARDIAN_IMAGES[theme];
    if (!im) {
      im = new Image();
      im.onload = function () { try { global.dispatchEvent(new Event('gm:building-asset-ready')); } catch (e) {} };
      im.onerror = function () { im.failed = true; };
      im.src = 'assets/temple/' + theme + '/guardian-sheet.png?v=temple-guardian-1';
      GUARDIAN_IMAGES[theme] = im;
    }
    return im && im.complete && im.naturalWidth && !im.failed ? im : null;
  }

  /* 사람이 새로 만든 건물 PNG만 절차 스프라이트 대신 쓴다. 아직 교체하지 않은
     건물까지 한꺼번에 바뀌면 품질이 섞이므로, 완료한 id를 여기서 명시적으로 연다. */
  /* 기존 프로젝트 PNG는 교체 대상이다. 여기에는 이번 Toji 작업에서 새로 만든
     기본 건물 전종과 본부 진화 단계만 올린다. */
  var HANDMADE_BUILDINGS = {
    campfire: true, tent: true, hut: true, house: true, manor: true,
    well: true, woodpile: true, granary: true, sawmill: true, quarry_camp: true,
    storage_crate: true, bloomery: true, trading_post: true, market: true,
    watchpost: true, arrow_tower: true, barracks: true, ballista: true,
    cannon: true, frost_tower: true, flame_tower: true, fence: true,
    gate: true, shrine: true, consulate: true, monument: true,
    appraisal_post: true, claim_flag: true, lamp: true, banner: true,
    garden: true, fountain: true, library: true, workshop: true,
    academy: true, station: true,
    hunter_hut: true, storage: true, smelter: true, smithy: true, mill: true, ranch: true,
    mine_shaft: true, hq_camp: true,
    hq_village: true, hq_town: true, hq_city: true, hq_royal: true
  };
  var BUILDING_IMAGES = {};
  var BUILDING_ANIMATIONS = {};

  function buildingImage(key, tier, ruined) {
    if (!HANDMADE_BUILDINGS[key]) return null;
    var level = Math.max(1, tier || 1);
    var cacheKey = key + '@' + level + (ruined ? ':ruined' : '');
    var image = BUILDING_IMAGES[cacheKey];
    if (image) return image;
    image = new Image();
    image.onload = function () {
      try { global.dispatchEvent(new Event('gm:building-asset-ready')); } catch (e) {}
    };
    image.onerror = function () { image.failed = true; };
    /* 파일 기반 테스트월드에서도 교체된 투명 PNG를 즉시 다시 읽도록 한다. */
    var revision = '?v=handmade-buildings-4';
    image.src = 'assets/building/' + key + '/' + (ruined ? 'ruined.png' : (level > 1 ? 'tier-' + level + '.png' : 'base.png')) + revision;
    BUILDING_IMAGES[cacheKey] = image;
    return image;
  }

  function handmadeBuilding(key, tier, ruined) {
    var level = Math.max(1, tier || 1);
    /* 정착지 본부는 구조물 키는 campfire로 유지하지만 단계마다 별도 건물 PNG를 쓴다.
       campfire/tier-N을 찾으면 기본 모닥불이 큰 칸에 늘어나므로 전용 키로 먼저 바꾼다. */
    if (key === 'campfire' && level > 1) {
      var hqKey = { 2: 'hq_camp', 3: 'hq_village', 4: 'hq_town', 5: 'hq_city', 6: 'hq_royal' }[level];
      if (hqKey) {
        var hqImage = buildingImage(hqKey, 1, ruined);
        if (hqImage && hqImage.complete && hqImage.naturalWidth && !hqImage.failed) return hqImage;
      }
    }
    var image = buildingImage(key, level, ruined);
    if (image && image.failed && level > 1) image = buildingImage(key, 1, ruined);
    return image && image.complete && image.naturalWidth && !image.failed ? image : null;
  }

  /* 현재 수작업 건물 중 애니메이션을 가진 것은 시작 모닥불뿐이다.
     스프라이트시트는 4개의 동일 크기 가로 프레임으로 약속한다. */
  function buildingAnimation(key) {
    if (key !== 'campfire') return null;
    var image = BUILDING_ANIMATIONS[key];
    if (image) return image;
    image = new Image();
    image.onload = function () {
      try { global.dispatchEvent(new Event('gm:building-asset-ready')); } catch (e) {}
    };
    image.onerror = function () { image.failed = true; };
    image.src = 'assets/building/' + key + '/idle.png';
    BUILDING_ANIMATIONS[key] = image;
    return image;
  }

  function buildingAspect(key, tier) {
    var image = handmadeBuilding(key, tier);
    return image ? image.naturalWidth / image.naturalHeight : 0;
  }

  /* ★ 배포최적화 — 원본 스프라이트 축소본 캐시.
     「왜」 필요한가 — 수작업 건물 PNG는 1254×1254인데 화면에서는 타일 1.7~2.6칸,
     즉 41~83px 로만 그려진다. drawImage 에 원본을 그대로 넘기면 브라우저가 매 프레임
     157만 픽셀을 60px 로 줄인다. 면적 400배 축소를 초당 60번 되풀이하는 셈이라
     에셋을 붙인 뒤 프레임이 무너진 진짜 원인이 여기였다(지형·타일은 이미 16/32/64
     오프스크린 캔버스를 거쳐서 멀쩡했다).
     한 번만 줄여 캔버스에 담아 두고 그 뒤로는 등배에 가깝게 찍는다.
     줌은 16·24·32 사이를 보간하므로 폭을 8px 격자로 올림해 캐시가 흔들리지 않게 한다. */
  /* ★ 6단계 — 곳간을 **정말** 최근순으로 쓴다(옛 셈은 들어온 순서였다).
     「왜」 늦은 판에서 프레임이 절벽처럼 무너졌나 — Map 의 열쇠 차례는 **넣은 순서**라,
     넘칠 때 버려지는 것이 늘 「가장 먼저 구운 것」이었다. 그런데 가장 먼저 구운 것은
     본부·집처럼 **화면에 늘 있는** 그림이다. 정착지가 커져 열쇠가 상한을 넘는 순간
     매 프레임 화면의 붙박이 그림을 버리고 다시 굽는 되돌이(thrash)에 빠졌다 —
     1254² 를 60px 로 줄이는 일이 프레임마다 수십 번 되풀이된 것이 절벽의 정체다.
     맞은 열쇠를 지웠다 다시 넣으면 차례의 맨 뒤로 가므로, 넘칠 때 버려지는 것은
     **가장 오래 안 쓴 것**이 된다. 상한도 320 → 512 로 올린다(캔버스 한 장이 대개 64² 안쪽이라
     512장을 다 채워도 몇 MB 수준이다). 굽는 셈은 결정적이라 **그림은 한 점도 달라지지 않는다** —
     버렸다 다시 구워도 같은 픽셀이 나온다. */
  var SCALED = new Map();
  var SCALED_MAX = 512;
  var scaledSeq = 0;

  function scaled(img, w, h) {
    if (!img) return img;
    var nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height;
    if (!nw || !nh) return img;
    /* 아직 안 실린 그림은 굽지 않는다 — 빈 캔버스가 캐시에 박힌다 */
    if (img.complete === false || img.failed) return img;
    w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
    /* 원본이 표시 크기와 비슷하거나 작으면 줄일 이유가 없다(확대는 그대로 맡긴다) */
    if (nw <= w * 1.25 && nh <= h * 1.25) return img;
    var bw = Math.ceil(w / 8) * 8, bh = Math.ceil(h / 8) * 8;
    if (bw >= nw || bh >= nh) return img;
    if (!img.__gmScaleId) img.__gmScaleId = ++scaledSeq;
    var ck = img.__gmScaleId + ':' + bw + 'x' + bh;
    var hit = SCALED.get(ck);
    /* 맞았으면 차례의 맨 뒤로 옮긴다 — 이 한 줄이 FIFO 를 LRU 로 만든다 */
    if (hit) { SCALED.delete(ck); SCALED.set(ck, hit); return hit; }
    var cv = document.createElement('canvas');
    cv.width = bw; cv.height = bh;
    var g = cv.getContext('2d');
    /* jsdom 하니스처럼 2d 문맥이 없는 곳에서는 원본을 그대로 돌려준다 */
    if (!g) return img;
    try {
      /* 픽셀아트 원본을 큰 배율로 줄일 때는 부드럽게 — 계단이 아니라 뭉개짐이 낫다 */
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, bw, bh);
    } catch (e) { return img; }
    if (SCALED.size >= SCALED_MAX) {
      var oldest = SCALED.keys().next();
      if (!oldest.done) SCALED.delete(oldest.value);
    }
    SCALED.set(ck, cv);
    return cv;
  }

  /* 에셋이 새로 실리면 그 그림의 축소본만 버린다(전량 폐기는 줌마다 재구축을 부른다) */
  function dropScaled(img) {
    if (!img || !img.__gmScaleId) return;
    var p = img.__gmScaleId + ':';
    SCALED.forEach(function (v, k) { if (k.indexOf(p) === 0) SCALED.delete(k); });
  }

  function mk(w, h, draw) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      draw(function (x, y, ww, hh, col) {
        ctx.fillStyle = col;
        ctx.fillRect(x | 0, y | 0, Math.max(1, ww | 0), Math.max(1, hh | 0));
      }, ctx);
    }
    return cv;
  }
  function cached(key, w, h, draw) {
    if (!CACHE[key]) CACHE[key] = mk(w, h, draw);
    return CACHE[key];
  }
  function emptySprite(w, h) { return cached('empty:' + w + ':' + h, w, h, function () {}); }

  function h2(x, y) {
    var n = (x * 73856093) ^ (y * 19349663);
    n = (n ^ (n >>> 13)) >>> 0;
    return (n % 1000) / 1000;
  }
  function variantAt(x, y, n) { return Math.floor(h2(x, y) * n) % n; }

  /* ══════════ 지형 ══════════ */
  var TERRA = {
    grass:   { base: '#7d9b4e', dots: ['#8fae5c', '#6d8a42', '#a2be6c'] },
    forest:  { base: '#456b39', dots: ['#527a42', '#38592e', '#5f8a4c'] },
    rock:    { base: '#8b8577', dots: ['#9c968a', '#787264', '#a8a294'] },
    water:   { base: '#3f6f96', dots: ['#4d81ab', '#356084', '#5c92bd'] },
    fertile: { base: '#9c8341', dots: ['#ae944e', '#8a7238', '#bda45b'] },
    /* ★ §17-17 바이옴 — 설산은 밝은 회백(눈이 덮인 돌밭), 밀림은 짙은 초록(빛이 안 드는 숲).
       그리는 규칙은 옛 다섯과 한 벌이다: 바탕 한 겹 + 점 열둘 + 종류마다의 표식 몇 획. */
    snow:    { base: '#d8dee6', dots: ['#eef2f6', '#c2cad4', '#b0b8c4'] },
    jungle:  { base: '#2c4a26', dots: ['#37592e', '#223c1e', '#436a38'] },
    /* ★ §19-F2(F07-1) — 여섯 땅. 그리는 규칙은 옛것과 한 벌이다(바탕 한 겹 + 점 열둘 + 표식 몇 획).
       에셋은 여전히 없다: 팔레트와 사각형 몇 개로만 낸다(CDN·이미지 금지). */
    desert:  { base: '#d9c089', dots: ['#e8d2a0', '#c8ac74', '#f0e0b6'] },
    marsh:   { base: '#4a5f4a', dots: ['#5a7057', '#3b4e3c', '#6b8062'] },
    ash:     { base: '#5a5450', dots: ['#6b6460', '#474240', '#7a736c'] },
    mush:    { base: '#4a3f5c', dots: ['#5b4e70', '#3a3149', '#6d5f85'] },
    salt:    { base: '#e2e6e4', dots: ['#f2f5f4', '#c9cfcd', '#d6dbd9'] },
    dusk:    { base: '#6b4a55', dots: ['#7d5865', '#573a45', '#8f6675'] }
  };

  /* 지형 바닥은 각 바이옴마다 하나의 심리스 표면만 쓴다. 이전 _b 파일은
     독립 그림이라 이웃 칸 경계가 맞지 않아 의도적으로 사용하지 않는다. */
  var TERRAIN_IMAGES = {};
  var TERRAIN_VARIANTS = {};
  var terrainExpected = Object.keys(TERRA).length;
  var terrainSettled = 0;
  var terrainAnnounced = false;

  function settleTerrainImage() {
    terrainSettled += 1;
    if (terrainAnnounced || terrainSettled < terrainExpected) return;
    terrainAnnounced = true;
    try { global.dispatchEvent(new Event('gm:terrain-assets-ready')); } catch (e) {}
  }

  function terrainImage(code) {
    var image = TERRAIN_IMAGES[code];
    if (image) return image;
    image = new Image();
    image.onload = settleTerrainImage;
    /* Keep the original source intact.  New terrain packs live alongside it
       and fall back cleanly on maps that have not been upgraded yet. */
    image.onerror = function () {
      var sources = ['base-v4.png', 'base-v3.png', 'base-v2.png', 'base.png'];
      image._terrainSourceIndex = (image._terrainSourceIndex || 0) + 1;
      if (image._terrainSourceIndex < sources.length) {
        image.src = 'assets/tileset/' + code + '/' + sources[image._terrainSourceIndex];
        return;
      }
      settleTerrainImage();
    };
    image._terrainSourceIndex = 0;
    image.src = 'assets/tileset/' + code + '/base-v4.png';
    TERRAIN_IMAGES[code] = image;
    return image;
  }

  /* 동일한 심리스 원본의 내부에만 아주 약한 색·결 변주를 준다. 가장자리
     6px은 건드리지 않아, 이웃 칸과 만날 때도 타일 이음새가 생기지 않는다. */
  function terrainVariant(code, variant) {
    var image = terrainImage(code);
    if (!(image.complete && image.naturalWidth) || !variant) return image;
    var key = code + ':' + (variant % 4);
    if (TERRAIN_VARIANTS[key]) return TERRAIN_VARIANTS[key];
    var cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    var g = cv.getContext('2d');
    if (!g) return image;
    g.imageSmoothingEnabled = false;
    g.drawImage(image, 0, 0, 64, 64);
    var r = U.rngFrom(key);
    var d = TERRA[code] || TERRA.grass;
    g.globalAlpha = 0.13;
    for (var i = 0; i < 10; i += 1) {
      g.fillStyle = d.dots[Math.floor(r() * d.dots.length)];
      g.fillRect(7 + Math.floor(r() * 48), 7 + Math.floor(r() * 48), 2 + Math.floor(r() * 3), 1 + Math.floor(r() * 2));
    }
    TERRAIN_VARIANTS[key] = cv;
    return cv;
  }

  function preloadTerrainImages() {
    Object.keys(TERRA).forEach(terrainImage);
  }

  /* ★ §19-F2 — 땅마다의 표식을 **표**로 세운다. 옛것은 if 를 줄줄이 이어 붙였는데,
     땅이 일곱에서 열셋이 되면 그 함수 하나가 예순 줄이 된다(함수 ≤15줄 규칙 위반).
     그림은 한 획도 바뀌지 않는다 — 옛 if 의 몸통을 그대로 옮겨 담았다. */
  var MARK = {
    forest: function (P) {
      P(4, 5, 3, 6, '#2f4d27'); P(9, 3, 3, 7, '#2f4d27');
      P(3, 3, 5, 4, '#5f8a4c'); P(8, 1, 5, 4, '#5f8a4c');
    },
    rock: function (P) {
      P(3, 8, 6, 5, '#6f6a5e'); P(3, 8, 6, 1, '#b0aa9c');
      P(9, 4, 4, 4, '#6f6a5e'); P(9, 4, 4, 1, '#b0aa9c');
    },
    water: function (P) { P(2, 5, 6, 1, '#78aed6'); P(9, 10, 5, 1, '#78aed6'); },
    fertile: function (P) { for (var k = 1; k < 16; k += 4) P(0, k, 16, 1, '#8a7238'); },
    /* ★ §17-17 설산 — 눈에 반쯤 묻힌 바위 둘과 그 위 햇빛 한 줄 */
    snow: function (P) {
      P(3, 9, 5, 3, '#a8b0bc'); P(3, 9, 5, 1, '#f2f6fa');
      P(9, 5, 4, 3, '#9ea6b2'); P(9, 5, 4, 1, '#f2f6fa');
    },
    /* ★ §17-17 밀림 — 넓은 잎 세 겹이 겹쳐 바닥이 안 보인다 */
    jungle: function (P) {
      P(1, 6, 7, 8, '#1e3a1a'); P(2, 4, 6, 3, '#436a38');
      P(8, 3, 7, 10, '#254421'); P(9, 2, 5, 3, '#4e7a40');
      P(6, 11, 3, 4, '#1a3216');
    },
    /* ★ §19-F2 사막 — 바람이 밀어 놓은 모래 언덕 세 줄과 그 마루의 햇빛 */
    desert: function (P) {
      P(1, 5, 8, 2, '#c8ac74'); P(1, 5, 8, 1, '#f2e4bc');
      P(7, 10, 8, 2, '#c8ac74'); P(7, 10, 8, 1, '#f2e4bc');
      P(3, 13, 5, 1, '#c0a26a');
    },
    /* ★ §19-F2 습지 — 고인 물웅덩이 둘과 그 사이로 선 갈대 */
    marsh: function (P) {
      P(2, 8, 6, 4, '#31474a'); P(2, 8, 6, 1, '#5d8288');
      P(10, 4, 4, 3, '#31474a'); P(10, 4, 4, 1, '#5d8288');
      P(5, 2, 1, 5, '#7d9160'); P(8, 11, 1, 4, '#7d9160');
    },
    /* ★ §19-F2 화산재 땅 — 식지 않은 갈라진 틈 사이로 붉은 기가 비친다 */
    ash: function (P) {
      P(3, 3, 1, 9, '#2e2a28'); P(4, 7, 6, 1, '#2e2a28');
      P(10, 9, 1, 6, '#2e2a28');
      P(3, 6, 1, 2, '#a8482c'); P(10, 11, 1, 2, '#a8482c');
    },
    /* ★ §19-F2 버섯 숲 — 사람 키만 한 갓 둘. 자루는 희고 갓은 붉다 */
    mush: function (P) {
      P(3, 9, 2, 5, '#d8cfc0'); P(1, 6, 6, 3, '#a8425a'); P(2, 6, 4, 1, '#d4657c');
      P(10, 11, 2, 4, '#d8cfc0'); P(8, 8, 6, 3, '#8c3a6a'); P(9, 8, 4, 1, '#b45a90');
    },
    /* ★ §19-F2 소금 평원 — 말라 갈라진 소금 판의 격자 금 */
    salt: function (P) {
      P(0, 5, 16, 1, '#b8c0be'); P(0, 11, 16, 1, '#b8c0be');
      P(4, 0, 1, 16, '#b8c0be'); P(11, 0, 1, 16, '#b8c0be');
      P(6, 7, 3, 2, '#ffffff');
    },
    /* ★ §19-F2 황혼 골짜기 — 비스듬히 누운 그림자와 그 끝의 노을 한 줄 */
    dusk: function (P) {
      P(0, 10, 16, 4, '#3f2b33'); P(0, 10, 16, 1, '#8f6675');
      P(2, 2, 5, 6, '#4e3540'); P(9, 4, 5, 5, '#4e3540');
      P(0, 0, 16, 1, '#c98a6a');
    }
  };

  function terrain(code, variant) {
    var image = terrainImage(code);
    if (image.complete && image.naturalWidth) return terrainVariant(code, variant);
    /* Never flash the old low-detail procedural ground while the authored
       sheet is loading.  world.js keeps a flat biome-color prefill until the
       terrain-ready event rebuilds the chunk with the real PNG. */
    return emptySprite(16, 16);
  }

  /* Adjacent cells crop adjacent pixels from one shared terrain sheet.  This
     keeps the texture continuous across a biome instead of repeating a whole
     base image inside every 16px cell. */
  function terrainSample(code, worldX, worldY, variant) {
    var image = terrainImage(code);
    if (!(image.complete && image.naturalWidth >= 16 && image.naturalHeight >= 16)) return terrain(code, variant);
    var spanX = Math.max(1, Math.floor(image.naturalWidth / 16));
    var spanY = Math.max(1, Math.floor(image.naturalHeight / 16));
    /* Do not mirror a terrain sheet: mirrored return paths create the very
       obvious 2×2 / four-way symmetry that makes a map read as repeated
       tiles.  The authored v4 sheets hold 32×32 distinct samples, so a plain
       wrap occurs far outside a normal viewport. */
    function phaseAt(n, span) {
      return { index: ((n % span) + span) % span, flip: false };
    }
    var px = phaseAt(worldX, spanX), py = phaseAt(worldY, spanY);
    var sx = px.index * 16, sy = py.index * 16;
    var key = 'ts:' + code + ':' + sx + ':' + sy + ':' + (px.flip ? 1 : 0) + ':' + (py.flip ? 1 : 0);
    return cached(key, 16, 16, function (P, g) {
      try {
        g.save();
        g.translate(px.flip ? 16 : 0, py.flip ? 16 : 0);
        g.scale(px.flip ? -1 : 1, py.flip ? -1 : 1);
        g.drawImage(image, sx, sy, 16, 16, 0, 0, 16, 16);
        g.restore();
      } catch (e) {}
    });
  }

  /* Asset-backed 47-blob compositor. sameMask uses N,E,S,W,NE,SE,SW,NW bits. */
  function terrainBlob(code, backdrop, sameMask, variant, worldX, worldY) {
    backdrop = backdrop || code;
    /* v4 terrain sheets carry 32×32 authored samples.  Cache their full
       variation range so a large source does not collapse back into an 8×8
       repeated patch on the map. */
    var shapeX = worldX == null ? 0 : ((worldX % 11) + 11) % 11;
    var shapeY = worldY == null ? 0 : ((worldY % 11) + 11) % 11;
    var sampleX = worldX == null ? 0 : ((worldX % 32) + 32) % 32;
    var sampleY = worldY == null ? 0 : ((worldY % 32) + 32) % 32;
    var key = 'tb:' + code + ':' + backdrop + ':' + sameMask + ':' + variant + ':' + shapeX + ':' + shapeY + ':' + sampleX + ':' + sampleY;
    return cached(key, 16, 16, function (P, g) {
      var bg = terrainSample(backdrop, worldX, worldY, (variant + 1) % 4);
      var fg = terrainSample(code, worldX, worldY, variant);
      /* Only one side of a terrain pair owns the blend.  If both tiles paint
         an inset, a grass/water border becomes a distracting double stripe. */
      /* Water must remain a continuous surface.  Land owns its shoreline
         transition into water; letting water own it cuts every water tile
         inward and makes a connected river look like separate puddles. */
      var blendRank = { fertile: 1, rock: 2, desert: 3, snow: 4, ash: 5, salt: 6, marsh: 7, mush: 8, grass: 9, forest: 10, jungle: 11, dusk: 12, water: 20 };
      try { g.drawImage(fg, 0, 0, 16, 16); } catch (e0) {}
      var codeRank = blendRank[code] == null ? 99 : blendRank[code];
      var backdropRank = blendRank[backdrop] == null ? 99 : blendRank[backdrop];
      if (code === backdrop || codeRank > backdropRank) return;
      var n = !!(sameMask & 1), e = !!(sameMask & 2);
      var s = !!(sameMask & 4), w = !!(sameMask & 8);
      var ne = !!(sameMask & 16), se = !!(sameMask & 32);
      var sw = !!(sameMask & 64), nw = !!(sameMask & 128);
      /* Let the neighbour reach well into the edge cell.  A deep, round
         scallop reads as one organic contour across several cells instead of
         exposing the square grid used by the logical terrain map. */
      var l = w ? 0 : 4.75, r = e ? 16 : 11.25;
      var t = n ? 0 : 4.75, b = s ? 16 : 11.25;
      function radius(a, d, diagonal) {
        if (a && d) return diagonal ? 0 : 6.1;
        return a || d ? 4.4 : 6.1;
      }
      var rtl = radius(n, w, nw), rtr = radius(n, e, ne);
      var rbr = radius(s, e, se), rbl = radius(s, w, sw);
      /* World coordinates make each outer edge breathe independently, but
         connected sides remain flush so an interior never develops seams. */
      var j = function (salt) { return U.rngFrom(code + ':' + backdrop + ':' + sameMask + ':' + variant + ':' + shapeX + ':' + shapeY + ':' + salt)() * 0.6 - 0.3; };
      var mx = (l + r) / 2, my = (t + b) / 2;
      var topBend = n ? 0 : 4.1 + j(18);
      var rightBend = e ? 0 : 4.1 + j(19);
      var bottomBend = s ? 0 : 4.1 + j(20);
      var leftBend = w ? 0 : 4.1 + j(21);
      function blobPath(target) {
        target.beginPath();
        target.moveTo(l + rtl, t + j(1));
        target.quadraticCurveTo(mx + j(2), t + topBend, r - rtr, t + j(3));
        target.quadraticCurveTo(r + j(3), t + j(4), r + j(5), t + rtr);
        target.quadraticCurveTo(r + rightBend, my + j(6), r + j(7), b - rbr);
        target.quadraticCurveTo(r + j(7), b + j(8), r - rbr, b + j(9));
        target.quadraticCurveTo(mx + j(10), b + bottomBend, l + rbl, b + j(11));
        target.quadraticCurveTo(l + j(11), b + j(12), l + j(13), b - rbl);
        target.quadraticCurveTo(l + leftBend, my + j(14), l + j(15), t + rtl);
        target.quadraticCurveTo(l + j(15), t + j(16), l + rtl, t + j(17));
        target.closePath();
      }
      /* Start with the neighbour, then reveal this tile through one rounded,
         irregular silhouette.  Drawing this in the opposite order hollowed
         out the centre of the active terrain and made transitions look like
         square frames rather than a continuous shoreline. */
      try { g.drawImage(bg, 0, 0, 16, 16); } catch (e1) {}
      /* A slightly expanded low-alpha silhouette softens the material change
         before the crisp pixel-art contour arrives. */
      g.save();
      g.translate(8, 8);
      g.scale(1.16, 1.16);
      g.translate(-8, -8);
      blobPath(g);
      g.clip();
      g.globalAlpha = 0.32;
      try { g.drawImage(fg, 0, 0, 16, 16); } catch (e2) {}
      g.restore();
      g.save();
      blobPath(g);
      g.clip();
      try { g.drawImage(fg, 0, 0, 16, 16); } catch (e3) {}
      g.restore();
    });
  }

  /* Environment dressing deliberately lives apart from the seamless terrain.
     A ground tile must stay quiet enough to repeat; these sparse overlays add
     the roots, leaf litter and little height changes that make a biome read as
     a place rather than a coloured grid. */
  function dressing(code, variant) {
    var key = 'dress:' + code + ':' + (variant % 4);
    return cached(key, 16, 16, function (P) {
      var v = variant % 4;
      if (code === 'forest') {
        if (v === 0) { P(1, 10, 7, 1, '#294722'); P(5, 8, 1, 4, '#294722'); P(10, 4, 2, 2, '#739957'); P(12, 3, 1, 1, '#a7c979'); }
        if (v === 1) { P(2, 5, 3, 2, '#6d4b2b'); P(5, 7, 5, 1, '#6d4b2b'); P(10, 8, 2, 1, '#7d9b4e'); P(12, 10, 2, 2, '#38592e'); }
        if (v === 2) { P(2, 11, 4, 1, '#5f8a4c'); P(3, 9, 1, 3, '#8dbb6d'); P(9, 4, 4, 1, '#2f4d27'); P(11, 5, 1, 2, '#2f4d27'); }
        if (v === 3) { P(1, 6, 2, 2, '#9b7650'); P(4, 8, 2, 1, '#a9875b'); P(10, 10, 4, 1, '#294722'); P(12, 8, 1, 3, '#294722'); }
      } else if (code === 'grass') {
        if (v === 0) { P(3, 9, 1, 4, '#527a42'); P(4, 8, 1, 5, '#8dbb6d'); P(10, 10, 1, 3, '#527a42'); }
        if (v === 1) { P(4, 7, 1, 1, '#f4e4bc'); P(5, 8, 1, 1, '#f4e4bc'); P(10, 10, 2, 2, '#9c968a'); P(11, 9, 1, 1, '#c4cad2'); }
        if (v === 2) { P(2, 11, 4, 1, '#6d8a42'); P(4, 9, 1, 3, '#8dbb6d'); P(12, 6, 1, 5, '#527a42'); }
        if (v === 3) { P(3, 6, 3, 1, '#a8701f'); P(4, 5, 1, 3, '#a8701f'); P(10, 10, 3, 1, '#6d8a42'); }
      } else if (code === 'jungle') {
        if (v === 0) { P(1, 7, 5, 3, '#436a38'); P(2, 6, 3, 1, '#648a4c'); P(9, 4, 6, 3, '#37592e'); P(10, 3, 3, 1, '#648a4c'); }
        if (v === 1) { P(2, 11, 8, 1, '#1e3a1a'); P(5, 8, 1, 4, '#1e3a1a'); P(11, 6, 2, 2, '#6a994e'); }
        if (v === 2) { P(2, 4, 2, 2, '#b8434f'); P(8, 9, 5, 2, '#436a38'); P(10, 8, 2, 1, '#7d9b4e'); }
        if (v === 3) { P(3, 8, 4, 1, '#294722'); P(10, 5, 1, 6, '#294722'); P(11, 4, 3, 2, '#527a42'); }
      } else if (code === 'water') {
        if (v === 0) { P(2, 5, 6, 1, '#8ec4dd'); P(8, 11, 5, 1, '#78aed6'); P(11, 4, 1, 1, '#d7eff0'); }
        if (v === 1) { P(3, 9, 4, 1, '#2b5d80'); P(4, 8, 2, 1, '#78aed6'); P(10, 5, 3, 2, '#6a994e'); P(11, 4, 1, 1, '#a7c979'); }
        if (v === 2) { P(1, 12, 7, 1, '#78aed6'); P(9, 7, 5, 1, '#8ec4dd'); P(6, 4, 1, 1, '#d7eff0'); }
        if (v === 3) { P(3, 5, 3, 2, '#6a994e'); P(4, 4, 1, 1, '#a7c979'); P(10, 11, 4, 1, '#2b5d80'); }
      } else if (code === 'rock') {
        if (v === 0) { P(2, 4, 5, 1, '#b0aa9c'); P(3, 5, 1, 5, '#5e646c'); P(10, 9, 4, 1, '#5e646c'); }
        if (v === 1) { P(2, 11, 4, 2, '#6f6a5e'); P(3, 10, 3, 1, '#a8a294'); P(11, 4, 2, 3, '#456b39'); }
        if (v === 2) { P(4, 3, 1, 6, '#5e646c'); P(5, 8, 4, 1, '#5e646c'); P(10, 12, 3, 1, '#b0aa9c'); }
        if (v === 3) { P(2, 7, 3, 2, '#787264'); P(3, 6, 2, 1, '#c4cad2'); P(10, 5, 3, 4, '#6a994e'); }
      } else if (code === 'snow') {
        if (v === 0) { P(2, 10, 6, 1, '#b4bcc9'); P(7, 8, 1, 3, '#8f99ad'); P(11, 5, 2, 2, '#5e646c'); }
        if (v === 1) { P(2, 6, 5, 1, '#eef1f6'); P(10, 11, 4, 1, '#b4bcc9'); P(11, 10, 1, 1, '#8f99ad'); }
        if (v === 2) { P(3, 12, 2, 1, '#8f99ad'); P(8, 8, 2, 1, '#8f99ad'); P(12, 4, 2, 2, '#5e646c'); }
        if (v === 3) { P(1, 7, 7, 1, '#eef1f6'); P(9, 4, 1, 4, '#b4bcc9'); P(10, 7, 4, 1, '#b4bcc9'); }
      } else if (code === 'desert') {
        if (v === 0) { P(1, 5, 8, 1, '#bfa658'); P(3, 6, 6, 1, '#e0c898'); P(10, 11, 2, 2, '#8a7350'); }
        if (v === 1) { P(2, 11, 10, 1, '#bfa658'); P(4, 12, 7, 1, '#e0c898'); P(12, 4, 1, 4, '#6e5a2c'); }
        if (v === 2) { P(3, 6, 2, 1, '#8a7350'); P(9, 9, 4, 1, '#bfa658'); P(10, 8, 1, 3, '#e0c898'); }
        if (v === 3) { P(1, 9, 7, 1, '#e0c898'); P(2, 10, 8, 1, '#bfa658'); P(12, 5, 2, 1, '#8a7350'); }
      } else if (code === 'marsh') {
        if (v === 0) { P(2, 9, 6, 3, '#31474a'); P(3, 8, 5, 1, '#5d8288'); P(11, 4, 1, 7, '#7d9b4e'); }
        if (v === 1) { P(3, 5, 1, 6, '#7d9160'); P(5, 7, 1, 5, '#8dbb6d'); P(10, 10, 4, 2, '#31474a'); }
        if (v === 2) { P(2, 11, 5, 1, '#5d8288'); P(8, 5, 5, 3, '#31474a'); P(10, 4, 2, 1, '#6a994e'); }
        if (v === 3) { P(2, 4, 1, 7, '#7d9160'); P(4, 7, 1, 6, '#8dbb6d'); P(9, 10, 5, 1, '#5d8288'); }
      } else if (code === 'ash') {
        if (v === 0) { P(2, 7, 7, 1, '#474240'); P(7, 6, 1, 3, '#2e2a28'); P(12, 11, 1, 1, '#c2481c'); }
        if (v === 1) { P(3, 11, 4, 1, '#7a736c'); P(9, 4, 5, 1, '#474240'); P(11, 5, 1, 2, '#2e2a28'); }
        if (v === 2) { P(2, 5, 1, 6, '#2e2a28'); P(3, 8, 5, 1, '#2e2a28'); P(12, 4, 1, 1, '#ff7a30'); }
        if (v === 3) { P(3, 12, 7, 1, '#474240'); P(11, 7, 3, 1, '#7a736c'); P(12, 6, 1, 3, '#2e2a28'); }
      } else if (code === 'mush') {
        if (v === 0) { P(3, 9, 1, 4, '#d8cfc0'); P(1, 6, 6, 3, '#a8425a'); P(2, 6, 4, 1, '#d4657c'); }
        if (v === 1) { P(9, 10, 1, 3, '#d8cfc0'); P(7, 7, 6, 3, '#8c3a6a'); P(8, 7, 4, 1, '#b45a90'); }
        if (v === 2) { P(2, 10, 4, 2, '#5b4e70'); P(10, 5, 2, 2, '#d9c8f0'); P(11, 4, 1, 1, '#fdf8ec'); }
        if (v === 3) { P(2, 5, 7, 1, '#d8cfc0'); P(3, 6, 1, 4, '#5b4e70'); P(11, 10, 3, 2, '#8c3a6a'); }
      } else if (code === 'salt') {
        if (v === 0) { P(2, 5, 1, 5, '#ffffff'); P(3, 7, 3, 1, '#eef1f6'); P(11, 10, 3, 1, '#b8c0be'); }
        if (v === 1) { P(3, 11, 6, 1, '#c9cfcd'); P(10, 4, 2, 3, '#ffffff'); P(11, 3, 1, 1, '#fdf8ec'); }
        if (v === 2) { P(2, 6, 5, 1, '#b8c0be'); P(8, 10, 1, 3, '#ffffff'); P(9, 11, 4, 1, '#eef1f6'); }
        if (v === 3) { P(2, 10, 3, 1, '#ffffff'); P(10, 5, 4, 1, '#c9cfcd'); P(12, 3, 1, 3, '#eef1f6'); }
      } else if (code === 'dusk') {
        if (v === 0) { P(2, 10, 5, 1, '#3f2b33'); P(4, 8, 1, 3, '#8f6675'); P(11, 5, 1, 1, '#d9c8f0'); }
        if (v === 1) { P(3, 5, 3, 2, '#5c4a78'); P(4, 4, 1, 1, '#b39ad6'); P(10, 11, 4, 1, '#3f2b33'); }
        if (v === 2) { P(2, 11, 7, 1, '#4e3540'); P(10, 5, 1, 5, '#8367a8'); P(11, 4, 2, 1, '#b39ad6'); }
        if (v === 3) { P(2, 6, 1, 5, '#3f2b33'); P(4, 9, 4, 1, '#8f6675'); P(11, 8, 2, 2, '#5c4a78'); }
      }
    });
  }

  function edgeDressing(kind, direction, variant) {
    var key = 'edge:' + kind + ':' + direction + ':' + (variant % 3);
    return cached(key, 16, 16, function (P) {
      var dark = kind === 'rock' ? '#3d4146' : (kind === 'shore' ? '#6e5a2c' : '#355b45');
      var mid = kind === 'rock' ? '#6f6a5e' : (kind === 'shore' ? '#9c8341' : '#6a994e');
      var light = kind === 'rock' ? '#a8a294' : (kind === 'shore' ? '#d9c37a' : '#a7c979');
      function strip(y, h, col) { P(0, y, 16, h, col); }
      if (direction === 0) { strip(0, 2, dark); strip(2, 1, mid); if (variant % 2) P(3, 3, 2, 1, light); }
      if (direction === 1) { P(14, 0, 2, 16, dark); P(13, 0, 1, 16, mid); if (variant % 2) P(12, 4, 1, 2, light); }
      if (direction === 2) { strip(14, 2, dark); strip(13, 1, mid); if (variant % 2) P(10, 12, 2, 1, light); }
      if (direction === 3) { P(0, 0, 2, 16, dark); P(2, 0, 1, 16, mid); if (variant % 2) P(3, 9, 1, 2, light); }
    });
  }

  /* Authored here rather than loaded from an existing raster pack.  These
     multi-tile silhouettes are the environment's reusable Codex-native props. */
  function biomeFeature(code, variant) {
    return cached('feature:' + code + ':' + (variant % 3), 48, 64, function (P) {
      var v = variant % 3, trunk = '#5d4037', shadow = '#16281a', leaf = '#3f6130', light = '#7d9b4e';
      function tree(crown, hi) {
        P(22, 32, 5, 26, trunk); P(17, 51, 14, 4, trunk); P(13, 55, 8, 4, trunk); P(28, 55, 8, 4, trunk);
        P(7, 18, 34, 28, shadow); P(4, 24, 40, 16, shadow); P(10, 10, 27, 22, shadow);
        P(8, 17, 31, 25, crown); P(5, 25, 37, 12, crown); P(12, 11, 22, 20, crown);
        P(10 + v * 2, 16, 13, 8, hi); P(25, 20, 11, 9, hi); P(16, 29, 12, 6, hi);
      }
      if (code === 'forest') tree(leaf, light);
      else if (code === 'jungle') { tree('#24401f', '#648a4c'); P(2, 38, 18, 5, '#2c4a26'); P(29, 35, 16, 6, '#2c4a26'); P(6, 35, 10, 2, '#7d9b4e'); }
      else if (code === 'snow') { P(22, 14, 4, 44, '#4a5962'); P(8, 30, 32, 16, '#24401f'); P(12, 19, 24, 14, '#24401f'); P(16, 10, 16, 12, '#24401f'); P(10, 29, 28, 4, '#eef1f6'); P(15, 19, 18, 3, '#fdf8ec'); }
      else if (code === 'desert') { P(22, 20, 5, 38, '#5d4037'); P(12, 28, 10, 5, '#6a994e'); P(27, 24, 10, 5, '#6a994e'); P(10, 31, 5, 17, '#3f6130'); P(34, 27, 5, 14, '#3f6130'); P(19, 18, 11, 5, '#8dbb6d'); }
      else if (code === 'marsh') { P(21, 27, 6, 31, '#3b2318'); P(7, 15, 35, 22, '#24401f'); P(4, 20, 18, 16, '#2c4a26'); P(26, 12, 17, 24, '#2c4a26'); P(6, 36, 35, 3, '#648a4c'); }
      else if (code === 'ash') { P(22, 16, 5, 42, '#3b2318'); P(11, 25, 12, 5, '#474240'); P(27, 19, 12, 5, '#474240'); P(8, 29, 6, 20, '#2e333a'); P(36, 23, 5, 19, '#2e333a'); P(14, 13, 1, 2, '#ff7a30'); }
      else if (code === 'mush') { P(21, 30, 7, 28, '#d8cfc0'); P(8, 17, 32, 17, '#8c3a6a'); P(12, 12, 24, 8, '#b45a90'); P(15, 11, 17, 2, '#d9c8f0'); P(4, 45, 10, 7, '#a8425a'); }
      else if (code === 'dusk') tree('#3d2f52', '#8367a8');
      else if (code === 'rock') { P(4, 38, 38, 17, '#5e646c'); P(9, 27, 27, 17, '#6f6a5e'); P(14, 18, 17, 13, '#8b8577'); P(16, 18, 12, 3, '#c4cad2'); P(7, 39, 13, 2, '#9aa0a8'); }
      else if (code === 'fertile') { P(4, 45, 40, 10, '#6e5a2c'); for (var i = 0; i < 5; i++) { var x = 7 + i * 8; P(x, 27 + (i % 2) * 4, 2, 20, '#3f6130'); P(x - 3, 29 + (i % 2) * 4, 7, 4, '#8dbb6d'); } }
      else { P(6, 43, 36, 12, '#3f6130'); P(10, 34, 26, 12, '#456b39'); P(16, 24, 14, 13, '#648a4c'); P(18, 22, 10, 3, '#a7c979'); }
    });
  }

  /* First production environment pack: real generated raster props only.
     There is intentionally no procedural substitute while an image loads. */
  var FOREST_PROP_IMAGES = {};
  function forestProp(key) {
    if (['oak', 'shrub', 'boulders', 'fallen_log'].indexOf(key) < 0) return null;
    var im = FOREST_PROP_IMAGES[key];
    if (!im) {
      im = new Image();
      im.onload = function () { try { global.dispatchEvent(new Event('gm:building-asset-ready')); } catch (e) {} };
      im.onerror = function () { im.failed = true; };
      im.src = 'assets/environment/forest_' + key + '/base.png?v=forest-props-1';
      FOREST_PROP_IMAGES[key] = im;
    }
    return im.complete && im.naturalWidth && !im.failed ? im : null;
  }

  preloadTerrainImages();

  /* ══════════ 자원 자리 ══════════ */
  var FIELD_STAGE = { sown: 0, sprout: 1, grow: 2, ripe: 3 };

  var NODE_IMAGES = {};
  function handmadeNode(key) {
    var im = NODE_IMAGES[key];
    if (!im) { im = new Image(); im.onload = function () { try { global.dispatchEvent(new Event('gm:building-asset-ready')); } catch (e) {} }; im.onerror = function () { im.failed = true; }; im.src = 'assets/node/' + key + '/base.png'; NODE_IMAGES[key] = im; }
    return im.complete && im.naturalWidth && !im.failed ? im : null;
  }
  function node(type, opts) {
    opts = opts || {};
    var stage = opts.stage || null;
    var manualKey = { forest: 'forest_oak', berry: 'berry_bush_red', rock: 'rock_granite', iron: 'iron_vein', coal: 'coal_vein', oil: 'oil_pool', ruin: 'ruin_pillar', cache: 'cache_crate', water: 'water_spring' }[type] || (stage ? 'field_' + stage : 'field_ripe');
    var manual = handmadeNode(manualKey);
    if (manual) return manual;
    /* Map nodes must never degrade into the 16px debugging fallback. */
    return emptySprite(16, 16);
    var thin = opts.thin ? 1 : 0;
    var key = 'n:' + type + ':' + (stage || '-') + ':' + thin + ':' + (opts.rich ? 'r' : '');
    return cached(key, 16, 16, function (P) {
      if (type === 'forest') {
        var trunk = '#5c3b20';
        if (!thin) { P(2, 9, 2, 5, trunk); P(2, 3, 6, 7, '#3f6130'); P(3, 3, 4, 2, '#5f8a4c'); }
        P(9, 9, 2, 6, trunk);
        P(7, 2, 7, 8, thin ? '#4a7040' : '#3f6130');
        P(8, 2, 5, 2, '#5f8a4c');
        if (opts.rich) P(11, 5, 2, 2, '#8dbb6d');
      } else if (type === 'berry') {
        /* ★ §13-B-1 딸기 덤불 — 덤불 두 무더기에 붉은 알. 옅어지면(thin) 알이 몇 개 안 남는다 */
        P(2, 8, 6, 6, '#3f6130'); P(2, 8, 6, 1, '#5f8a4c');
        P(8, 6, 6, 8, '#4a7040'); P(8, 6, 6, 1, '#6a9a54');
        P(3, 10, 2, 2, '#b8434f');
        if (!thin) { P(9, 8, 2, 2, '#b8434f'); P(11, 11, 2, 2, '#d4525f'); }
        if (opts.rich) P(6, 6, 2, 2, '#f0707c');
      } else if (type === 'rock') {
        P(2, 7, 7, 7, '#7e848c'); P(2, 7, 7, 2, '#a4aab2');
        if (!thin) { P(8, 4, 6, 6, '#8a9098'); P(8, 4, 6, 1, '#b4bac2'); }
        P(4, 12, 3, 1, '#5e646c');
        if (opts.rich) P(5, 9, 2, 2, '#c8d0da');
      } else if (type === 'iron') {
        P(2, 6, 12, 8, '#6f6a5e'); P(2, 6, 12, 1, '#9a948a');
        P(4, 9, 3, 2, '#b07050'); P(9, 11, 3, 2, '#b07050');
        P(5, 9, 1, 1, '#d99b78');
      } else if (type === 'oil') {
        P(3, 8, 10, 6, '#3a2f48'); P(3, 8, 10, 1, '#5a4890');
        P(5, 5, 5, 4, '#6f5aa8'); P(6, 5, 2, 2, '#a493d6');
      } else if (type === 'ruin') {
        P(2, 5, 3, 9, '#a9a390'); P(2, 5, 3, 1, '#cfc9b4');
        P(11, 3, 3, 11, '#a9a390'); P(11, 3, 3, 1, '#cfc9b4');
        P(5, 11, 6, 3, '#8d8878');
        P(6, 6, 4, 4, '#b39ad6'); P(7, 7, 2, 2, '#e0d0f4');
      } else if (type === 'cache') {
        /* ★ §17-17 숨은 궤 — 흙에 반쯤 묻힌 나무 궤짝. 쇠테 둘과 자물쇠 하나, 뚜껑에 금빛 한 점.
           풀·덤불에 가려 있다가 가까이 가야 드러나므로(concealed) 아래쪽에 풀 그림자를 깐다. */
        P(2, 12, 12, 2, '#33501f');
        P(2, 6, 12, 7, '#6b4526'); P(2, 6, 12, 2, '#8a5e33');
        P(2, 8, 12, 1, '#4a2f18');
        P(4, 6, 2, 7, '#b0a070'); P(10, 6, 2, 7, '#b0a070');
        P(7, 8, 2, 3, '#d8c070'); P(7, 9, 2, 1, '#5a4620');
        if (opts.rich) P(6, 4, 4, 2, '#f6cf7a');
      } else if (type === 'water') {
        P(1, 4, 14, 9, '#4a7fa8'); P(1, 4, 14, 1, '#78aed6');
        P(3, 8, 5, 1, '#9ed0ee'); P(9, 10, 4, 1, '#9ed0ee');
        P(5, 5, 3, 2, '#6a994e');
      } else {
        var st = FIELD_STAGE[stage] === undefined ? 3 : FIELD_STAGE[stage];
        P(0, 2, 16, 12, '#7a5c30');
        for (var r = 3; r < 14; r += 3) P(0, r, 16, 1, '#63481f');
        if (st >= 1) for (var c = 2; c < 15; c += 4) { P(c, 8, 1, 3, '#6a994e'); P(c - 1, 7, 3, 1, '#8dbb6d'); }
        if (st >= 2) for (var c2 = 2; c2 < 15; c2 += 4) { P(c2, 5, 1, 6, '#6a994e'); P(c2 - 1, 4, 3, 2, '#8dbb6d'); }
        if (st >= 3) for (var c3 = 2; c3 < 15; c3 += 4) { P(c3 - 1, 3, 3, 3, '#e0c65a'); P(c3, 2, 1, 1, '#f6e6a8'); }
        if (opts.rich) P(14, 2, 2, 2, '#f6cf7a');
      }
    });
  }

  /* ══════════ ★ §18-D2 앞마당의 흔적 ══════════
     자원 자리보다 **작고 낮게** 그린다 — 흔적은 지형에 얹힌 것이지 지형을 대신하는 것이 아니다.
     그림 파일은 여기서도 0장이다: 발자국 넷, 돌 세 덩이, 잔가지 둥지, 우물의 두레박, 이끼 낀 돌사람.
     art 를 모르는 흔적(자료가 앞서 나간 판)은 물음표 대신 **작은 표식 하나**로 나온다 — 안 보이는 것보다 낫다. */
  function trail(art, dim) {
    var faded = dim ? 1 : 0;
    return cached('tr:' + art + ':' + faded, 16, 16, function (P) {
      var ink = faded ? '#6b6458' : '#3f3a30';
      if (art === 'tracks') return tracksArt(P, ink);
      if (art === 'feather') return featherArt(P, ink, faded);
      if (art === 'hollow') return hollowArt(P, faded);
      if (art === 'stones') return stonesArt(P, faded);
      if (art === 'nest') return nestArt(P, faded);
      if (art === 'well') return wellArt(P, faded);
      if (art === 'statue') return statueArt(P, faded);
      if (art === 'vista') return vistaArt(P, faded);
      var far = TRAIL_ART[art];
      if (far) return far(P, ink, faded);
      P(6, 7, 4, 4, ink); P(7, 8, 2, 2, faded ? '#8f8878' : '#d8c98f');
    });
  }

  /* ══════════ ★ §21-C1 링1~3 의 흔적 ══════════
     「왜」 표를 쓰나 — 링이 세 겹 붙으며 art 가 스물 남짓이 되었다. if 스물세 줄은 읽히지 않는다.
     여기서도 그림 파일은 0장이다. 규율은 앞마당의 것 그대로: **작고 낮게**, 자원 자리를 덮지 않게.
     빛깔 두 벌(성한 것 / 바랜 것)은 f() 한 손잡이가 고른다 — 갈래마다 삼항을 늘어놓으면 눈이 아프다. */
  var TRAIL_ART = {
    /* 부서진 마차 — 기운 바퀴 하나와 부러진 채 */
    cart: function (P, ink, d) {
      var f = tone(d);
      P(2, 11, 12, 2, f('#6b5230', '#5a4a34')); P(3, 9, 9, 2, f('#8a6a40', '#6a5a40'));
      P(9, 4, 2, 8, f('#8a6a40', '#6a5a40')); P(7, 6, 6, 2, f('#a98a56', '#7d7460'));
      P(4, 13, 8, 1, ink);
    },
    /* 피어오르는 연기 — 재 위로 오르는 세 겹 */
    smoke: function (P, ink, d) {
      var f = tone(d);
      P(4, 12, 8, 2, f('#4a4038', '#3f3a34')); P(6, 11, 4, 1, f('#a33a34', '#7a5048'));
      P(7, 7, 3, 3, f('#b9b4a8', '#8a8880')); P(5, 4, 3, 3, f('#cfc9bc', '#95948c'));
      P(8, 1, 3, 3, f('#e2ddd2', '#a6a49c'));
    },
    /* 핏자국 — 점점이 이어지다 한쪽이 끌린 자국 */
    blood: function (P, ink, d) {
      var f = tone(d), r = f('#a33a34', '#7a5048');
      P(3, 12, 2, 2, r); P(6, 9, 2, 2, r); P(9, 6, 1, 1, r); P(11, 4, 2, 2, r);
      P(4, 10, 6, 1, f('#7c2c28', '#5f4440'));
    },
    /* 낡은 이정표 — 기울어진 기둥에 판때기 하나 */
    sign: function (P, ink, d) {
      var f = tone(d);
      P(7, 4, 2, 10, f('#6b5230', '#5a4a34'));
      P(2, 3, 12, 4, f('#a98a56', '#7d7460')); P(2, 3, 12, 1, f('#c8bda0', '#95948c'));
      P(4, 5, 3, 1, ink); P(9, 5, 4, 1, ink); P(4, 13, 8, 1, f('#4e7040', '#4a5240'));
    },
    /* 새겨진 바위 — 원 안에 선 셋 */
    carving: function (P, ink, d) {
      var f = tone(d);
      P(2, 4, 12, 10, f('#8a9098', '#7a7870')); P(2, 4, 12, 1, f('#b4bac2', '#95948c'));
      P(5, 6, 6, 1, ink); P(5, 11, 6, 1, ink); P(4, 7, 1, 4, ink); P(11, 7, 1, 4, ink);
      P(6, 8, 1, 3, ink); P(8, 8, 1, 3, ink); P(10, 8, 1, 2, ink);
    },
    /* 빈 배 — 물가에 얹힌 작은 배와 노 하나 */
    boat: function (P, ink, d) {
      var f = tone(d);
      P(1, 12, 14, 2, f('#3d6a8a', '#4a5560'));
      P(2, 8, 12, 4, f('#8a6a40', '#6a5a40')); P(3, 8, 10, 1, f('#a98a56', '#7d7460'));
      P(4, 10, 8, 1, f('#5c4526', '#4e4230')); P(11, 3, 1, 6, f('#c8bda0', '#8a8880'));
    },
    /* 버려진 깃발 — 삭아 갈라진 천 */
    flag: function (P, ink, d) {
      var f = tone(d);
      P(3, 1, 1, 13, f('#6b5230', '#5a4a34'));
      P(4, 2, 8, 5, f('#9a5a4a', '#7a5a52')); P(4, 7, 5, 2, f('#9a5a4a', '#7a5a52'));
      P(10, 4, 2, 3, f('#7c3c34', '#63504a')); P(2, 13, 5, 1, ink);
    },
    /* 덩굴 삼킨 사원 — 돌문 위로 덩굴 */
    temple: function (P, ink, d) {
      var f = tone(d);
      P(2, 3, 12, 11, f('#8a8478', '#74716a')); P(5, 7, 6, 7, f('#20242a', '#33363a'));
      P(2, 3, 12, 2, f('#a9a390', '#8b877c'));
      P(1, 2, 3, 9, f('#3f6130', '#3f5238')); P(12, 4, 3, 8, f('#4e7040', '#46543c'));
      P(6, 2, 4, 1, f('#4e7040', '#46543c'));
    },
    /* 부서진 기계 — 톱니와 굽은 관 */
    machine: function (P, ink, d) {
      var f = tone(d);
      P(3, 6, 8, 7, f('#7e848c', '#6e6c66')); P(3, 6, 8, 1, f('#b4bac2', '#8a8880'));
      P(5, 8, 4, 4, f('#3a3f46', '#3a3a38'));
      P(11, 4, 2, 6, f('#8a9098', '#7a7870')); P(10, 3, 4, 2, f('#a98a56', '#7d7460'));
      P(2, 13, 11, 1, ink);
    },
    /* 짓밟힌 길 — 한 방향으로 누운 풀과 굽 자국 */
    herd: function (P, ink, d) {
      var f = tone(d);
      P(1, 6, 14, 4, f('#6f8a4a', '#5e6a4a')); P(1, 7, 14, 1, f('#4e6a34', '#4a5240'));
      P(3, 11, 2, 2, ink); P(7, 12, 2, 2, ink); P(11, 10, 2, 2, ink);
    },
    /* 지도 조각 — 찢긴 가죽에 물길 한 줄 */
    scrap: function (P, ink, d) {
      var f = tone(d);
      P(2, 3, 11, 10, f('#e0d5b4', '#a8a294')); P(2, 3, 11, 1, f('#f2e9cc', '#bab5a4'));
      P(13, 5, 1, 3, f('#e0d5b4', '#a8a294')); P(12, 9, 2, 2, f('#e0d5b4', '#a8a294'));
      P(4, 6, 6, 1, f('#3d6a8a', '#5a6068')); P(5, 9, 4, 1, ink); P(8, 10, 3, 1, ink);
    },
    /* 얼어붙은 것 — 눈 위로 나온 손 */
    ice: function (P, ink, d) {
      var f = tone(d);
      P(0, 9, 16, 5, f('#dfe8f0', '#aeb4ba')); P(0, 9, 16, 1, f('#ffffff', '#c8ccd0'));
      P(6, 5, 4, 5, f('#5a6470', '#565c62')); P(5, 3, 2, 3, f('#6e7a86', '#61666c'));
      P(9, 2, 2, 4, f('#6e7a86', '#61666c'));
    },
    /* 움푹 팬 자리 — 그을린 사발과 아직 따뜻한 한복판 */
    crater: function (P, ink, d) {
      var f = tone(d);
      P(1, 6, 14, 7, f('#4a4038', '#3f3a34')); P(3, 8, 10, 4, f('#2a2420', '#2a2724'));
      P(6, 9, 4, 2, f('#c86a2a', '#7a5a3a')); P(7, 9, 2, 1, f('#f6b45a', '#95836a'));
      P(2, 4, 3, 2, f('#5f5148', '#4a4440')); P(12, 4, 3, 2, f('#5f5148', '#4a4440'));
    },
    /* 큰 나무 — 옹이 진 둥치와 넓은 우듬지 */
    bigtree: function (P, ink, d) {
      var f = tone(d);
      P(6, 8, 4, 7, f('#6b5230', '#5a4a34')); P(7, 10, 1, 2, f('#4a3820', '#43392c'));
      P(2, 2, 12, 6, f('#3f6130', '#3f5238')); P(3, 1, 10, 2, f('#4e7040', '#46543c'));
      P(1, 5, 3, 3, f('#4e7040', '#46543c')); P(12, 5, 3, 3, f('#4e7040', '#46543c'));
    },
    /* 은빛 딸기 — 알이 굵고 빛이 돈다 */
    berry_rare: function (P, ink, d) {
      var f = tone(d);
      P(2, 7, 12, 7, f('#3f6130', '#3f5238'));
      P(4, 8, 3, 3, f('#d8dce4', '#a8aab0')); P(9, 9, 3, 3, f('#d8dce4', '#a8aab0'));
      P(6, 12, 3, 2, f('#c0c8d4', '#9a9ca2')); P(4, 8, 3, 1, f('#ffffff', '#c4c6ca'));
    },
    /* 수정 박힌 바위 */
    crystal: function (P, ink, d) {
      var f = tone(d);
      P(1, 8, 14, 6, f('#7e848c', '#6e6c66')); P(1, 8, 14, 1, f('#a4aab2', '#8a8880'));
      P(5, 3, 3, 6, f('#8fd6e6', '#8a9ca4')); P(9, 5, 2, 4, f('#b8ecf6', '#a0b0b6'));
      P(5, 3, 3, 1, f('#e6fbff', '#c0ccd0'));
    },
    /* 부러진 검 — 날 반쪽이 꽂혀 있다 */
    sword: function (P, ink, d) {
      var f = tone(d);
      P(7, 2, 2, 8, f('#c8ced6', '#9a9ca2')); P(7, 2, 1, 8, f('#eef2f6', '#b4b6ba'));
      P(5, 10, 6, 1, f('#8a9098', '#7a7870')); P(7, 11, 2, 3, f('#6b5230', '#5a4a34'));
      P(3, 13, 10, 1, ink);
    },
    /* 아이 신발 한 짝 */
    shoe: function (P, ink, d) {
      var f = tone(d);
      P(3, 9, 9, 4, f('#8a5e33', '#6e5a44')); P(3, 9, 9, 1, f('#a87a48', '#877260'));
      P(4, 6, 5, 4, f('#8a5e33', '#6e5a44')); P(5, 5, 3, 2, f('#a87a48', '#877260'));
      P(3, 13, 10, 1, ink);
    },
    /* 덫에 걸린 여우 */
    fox: function (P, ink, d) {
      var f = tone(d);
      P(4, 6, 7, 5, f('#c8763a', '#96786a')); P(3, 4, 3, 3, f('#c8763a', '#96786a'));
      P(3, 3, 1, 2, f('#a4562a', '#7c6258')); P(5, 3, 1, 2, f('#a4562a', '#7c6258'));
      P(11, 7, 4, 2, f('#e0a068', '#b09a8a')); P(4, 11, 8, 1, f('#8a9098', '#7a7870'));
      P(4, 12, 1, 2, ink); P(11, 12, 1, 2, ink);
    },
    /* 길가의 제단 — 돌 셋과 마른 이삭 */
    altar: function (P, ink, d) {
      var f = tone(d);
      P(3, 10, 10, 4, f('#8a9098', '#7a7870')); P(3, 10, 10, 1, f('#b4bac2', '#95948c'));
      P(5, 7, 6, 3, f('#7e848c', '#6e6c66')); P(5, 7, 6, 1, f('#a4aab2', '#8a8880'));
      P(6, 4, 1, 3, f('#e0c65a', '#a8a084')); P(9, 4, 1, 3, f('#e0c65a', '#a8a084'));
      P(6, 3, 4, 1, f('#f6e6a8', '#bab5a4'));
    },
    /* 온천·반딧불 — 김이 오르는 물 */
    spring: function (P, ink, d) {
      var f = tone(d);
      P(2, 8, 12, 6, f('#7e848c', '#6e6c66'));
      P(4, 9, 8, 4, f('#7ac8d8', '#8a9ca4')); P(4, 9, 8, 1, f('#b8ecf6', '#a0b0b6'));
      P(5, 4, 2, 3, f('#e2ddd2', '#a6a49c')); P(9, 2, 2, 4, f('#cfc9bc', '#95948c'));
      P(7, 5, 1, 2, f('#f6e6a8', '#b0aa9c'));
    },
    /* 벌집 — 가지에 매달린 층 */
    hive: function (P, ink, d) {
      var f = tone(d);
      P(1, 2, 14, 1, f('#6b5230', '#5a4a34'));
      P(5, 3, 6, 3, f('#d8a94a', '#a89a7c')); P(4, 6, 8, 4, f('#e0c65a', '#b0a284'));
      P(5, 10, 6, 3, f('#d8a94a', '#a89a7c')); P(7, 7, 2, 2, ink);
      P(2, 5, 1, 1, ink); P(13, 8, 1, 1, ink);
    },
    /* 굴 — 흙 둔덕에 뚫린 구멍과 뼈 몇 */
    burrow: function (P, ink, d) {
      var f = tone(d);
      P(1, 7, 14, 7, f('#7a5c30', '#63533f')); P(1, 7, 14, 1, f('#9a7a44', '#7d7460'));
      P(5, 9, 6, 5, f('#20242a', '#33363a'));
      P(2, 12, 3, 1, f('#e0d5b4', '#a8a294')); P(12, 11, 2, 1, f('#e0d5b4', '#a8a294'));
    },
  };

  /** 성한 빛깔과 바랜 빛깔 중 하나를 고르는 한 손잡이 — 갈래마다 삼항을 늘어놓지 않게 */
  function tone(faded) {
    return function (lit, dim) { return faded ? dim : lit; };
  }

  /* 발자국 넷 — 앞발 둘이 크고 뒷발 둘이 작다. 왼쪽 위로 걸어간 자국이다. */
  function tracksArt(P, ink) {
    P(3, 11, 2, 2, ink); P(6, 12, 2, 2, ink);
    P(5, 7, 2, 2, ink);  P(8, 8, 2, 2, ink);
    P(8, 3, 2, 2, ink);  P(11, 4, 2, 2, ink);
  }
  /* 깃털 한 줌과 마른 핏방울 — 다툰 자리 */
  function featherArt(P, ink, faded) {
    P(4, 4, 1, 8, faded ? '#9a9284' : '#e6dcc4');
    P(3, 5, 3, 4, faded ? '#8a8274' : '#cfc4a8');
    P(9, 6, 1, 6, faded ? '#9a9284' : '#e6dcc4');
    P(8, 7, 3, 3, faded ? '#8a8274' : '#cfc4a8');
    P(11, 12, 2, 2, faded ? '#7a5048' : '#a33a34'); P(6, 13, 1, 1, ink);
  }
  /* 덤불 속 빈터 — 잎이 갈라진 자리에 맨땅 한 뼘 */
  function hollowArt(P, faded) {
    P(1, 5, 5, 8, faded ? '#3f5238' : '#3f6130');
    P(10, 5, 5, 8, faded ? '#3f5238' : '#3f6130');
    P(6, 8, 4, 5, faded ? '#6a5f4c' : '#8a7550');
    P(6, 8, 4, 1, faded ? '#7d7460' : '#a68f64');
  }
  /* 이상한 돌무더기 — 누가 일부러 세 덩이를 쌓았다 */
  function stonesArt(P, faded) {
    var a = faded ? '#8a8880' : '#9aa0a8', b = faded ? '#6e6c66' : '#7e848c';
    P(3, 10, 10, 4, b); P(3, 10, 10, 1, a);
    P(5, 7, 6, 3, b);   P(5, 7, 6, 1, a);
    P(7, 5, 3, 2, b);   P(7, 5, 3, 1, a);
  }
  /* 새 둥지 — 낮은 가지 위 잔가지 그릇에 알 하나 */
  function nestArt(P, faded) {
    P(2, 12, 12, 2, faded ? '#5a4a34' : '#6b5230');
    P(3, 8, 10, 5, faded ? '#6a5a40' : '#8a6a40');
    P(4, 9, 8, 3, faded ? '#4e4230' : '#5c4526');
    P(6, 9, 4, 3, faded ? '#c8c2b0' : '#efe6cf'); P(6, 9, 4, 1, '#fffaf0');
  }
  /* 옛 우물 — 이끼 낀 돌테와 두레박 줄 */
  function wellArt(P, faded) {
    P(3, 8, 10, 6, faded ? '#7a7870' : '#8a9098');
    P(3, 8, 10, 1, faded ? '#95948c' : '#b4bac2');
    P(5, 9, 6, 4, faded ? '#2a3038' : '#1e2a38');
    P(4, 11, 2, 1, '#4e7040'); P(11, 9, 2, 1, '#4e7040');
    P(2, 2, 1, 7, faded ? '#5a4a34' : '#6b5230'); P(13, 2, 1, 7, faded ? '#5a4a34' : '#6b5230');
    P(2, 2, 12, 1, faded ? '#5a4a34' : '#6b5230'); P(7, 3, 1, 4, '#c8bda0');
  }
  /* 이끼 낀 석상 — 얼굴은 닳아 없어졌고 발치의 글자만 남았다 */
  function statueArt(P, faded) {
    P(5, 3, 6, 10, faded ? '#8e8c84' : '#a9a390');
    P(5, 3, 6, 1, faded ? '#a6a49c' : '#cfc9b4');
    P(6, 5, 4, 2, faded ? '#6e6c64' : '#7d786a');
    P(5, 8, 6, 1, '#4e7040'); P(9, 10, 2, 2, '#4e7040');
    P(3, 13, 10, 2, faded ? '#6e6c64' : '#8d8878');
  }
  /* 전망 바위 — 올라설 수 있게 층이 진 큰 돌 */
  function vistaArt(P, faded) {
    P(1, 9, 14, 5, faded ? '#6e6c66' : '#7e848c');
    P(1, 9, 14, 1, faded ? '#8a8880' : '#a4aab2');
    P(4, 5, 8, 5, faded ? '#7a7870' : '#8a9098');
    P(4, 5, 8, 1, faded ? '#95948c' : '#b4bac2');
    P(6, 3, 3, 2, faded ? '#95948c' : '#c8d0da');
  }

  /** ★ 벤 자리에 남는 그루터기 */
  function stump(type) {
    return cached('stump:' + type, 16, 16, function (P) {
      if (type === 'rock' || type === 'iron') {
        P(4, 10, 8, 3, '#6f6a5e'); P(4, 10, 8, 1, '#8a8478');
        P(6, 13, 4, 1, '#57524a');
        return;
      }
      /* ★ §13-B-3 딴 자리 — 딸기는 잎만 남는다(하루면 다시 열린다) */
      if (type === 'berry') {
        P(4, 11, 8, 3, '#3a5a2e'); P(4, 11, 8, 1, '#4e7040');
        P(7, 9, 2, 2, '#3a5a2e');
        return;
      }
      P(5, 10, 6, 4, '#5c3b20'); P(5, 10, 6, 1, '#7a5230');
      P(6, 11, 4, 2, '#8a6238'); P(7, 11, 2, 1, '#a3703f');
      P(3, 13, 10, 1, '#4a2f18');
    });
  }

  /* ══════════ 건물 33종 ══════════
     한 벌의 규칙으로 그리고 표식만 바꾼다 — 33개를 손으로 그리는 대신
     벽/지붕 팔레트 + 지붕 모양 + 표식으로 조합한다. 티어가 오르면 커지고 장식이 붙는다. */
  var STYLE = {
    /* 주거 */
    tent:        { wall: '#c9b79a', roof: '#8a6a4a', shape: 'tent',  mark: 'flap' },
    hut:         { wall: '#c8a874', roof: '#7a5230', shape: 'gable', mark: 'chimney' },
    house:       { wall: '#dcc39a', roof: '#8a5e33', shape: 'gable', mark: 'window2' },
    manor:       { wall: '#e6d3ab', roof: '#a8701f', shape: 'gable', mark: 'tower' },
    /* 생산 */
    storage_crate: { wall: '#b98f5e', roof: '#6b4526', shape: 'crate', mark: 'strap' },
    well:        { wall: '#9aa0a8', roof: '#7a5230', shape: 'well',  mark: null },
    woodpile:    { wall: '#a3703f', roof: '#8a5e33', shape: 'pile',  mark: null },
    granary:     { wall: '#d8b57e', roof: '#8a5e33', shape: 'round', mark: 'grain' },
    sawmill:     { wall: '#c08a52', roof: '#6b4526', shape: 'gable', mark: 'saw' },
    quarry_camp: { wall: '#a8a294', roof: '#5e646c', shape: 'shed',  mark: 'stone' },
    hunter_hut:  { wall: '#a9855c', roof: '#5c3b20', shape: 'gable', mark: 'antler' },
    storage:     { wall: '#b98f5e', roof: '#6b4526', shape: 'gable', mark: 'strap' },
    smelter:     { wall: '#8a8078', roof: '#5e5048', shape: 'stack', mark: 'fire' },
    smithy:      { wall: '#9c8878', roof: '#5c4438', shape: 'shed',  mark: 'anvil' },
    mine_shaft:  { wall: '#8a8478', roof: '#4a4038', shape: 'mine',  mark: null },
    mill:        { wall: '#dcc9a0', roof: '#8a5e33', shape: 'mill',  mark: null },
    /* ★ §19-F1(F08-4) — 목장은 집이 아니다. 낮은 울타리로 두른 우리와 짚가리·여물통이다. */
    ranch:       { wall: '#c9a86e', roof: '#8a5e33', shape: 'ranch', mark: null },
    /* 군사 */
    watchpost:   { wall: '#a3703f', roof: '#6b4526', shape: 'tower', mark: 'eye' },
    arrow_tower: { wall: '#a3703f', roof: '#8a5e33', shape: 'tower', mark: 'arrow' },
    barracks:    { wall: '#c07a78', roof: '#7d2a2c', shape: 'gable', mark: 'sword' },
    ballista:    { wall: '#8b9fb0', roof: '#6b4526', shape: 'engine', mark: 'bolt' },
    cannon:      { wall: '#5e646c', roof: '#3b4148', shape: 'engine', mark: 'barrel' },
    /* ★ §19-F1(F08-3) — 서리탑·화염탑. 새 모양을 빚지 않고 있는 뼈대(tower·engine)에 색과 표식만 얹는다 */
    frost_tower: { wall: '#a9c6d8', roof: '#5d84a6', shape: 'tower', mark: 'frost' },
    flame_tower: { wall: '#b06a44', roof: '#7d2a2c', shape: 'engine', mark: 'flame' },
    /* 발전 */
    campfire:    { wall: '#6b4526', roof: '#e08541', shape: 'fire',  mark: null },
    trading_post: { wall: '#cdb283', roof: '#8a5e33', shape: 'gable', mark: 'ship' },
    market:      { wall: '#e0c89a', roof: '#bc4749', shape: 'stall', mark: 'awning' },
    shrine:      { wall: '#c3b0de', roof: '#6f5aa8', shape: 'gable', mark: 'holy' },
    consulate:   { wall: '#9db6d8', roof: '#3a5580', shape: 'gable', mark: 'flag' },
    monument:    { wall: '#dcd6c4', roof: '#b0a894', shape: 'obelisk', mark: null },
    /* ★ §19-F4(F09-1·2) — 연구소 셋과 정거장. 새 뼈대를 빚지 않고 있는 모양에 색·표식만 얹는다 */
    library:     { wall: '#d8c8a4', roof: '#7d5a8a', shape: 'gable', mark: 'book' },
    workshop:    { wall: '#9c8878', roof: '#4a5058', shape: 'shed',  mark: 'gear' },
    academy:     { wall: '#e2dcc6', roof: '#5d84a6', shape: 'gable', mark: 'quill' },
    station:     { wall: '#c9b394', roof: '#5e646c', shape: 'stall', mark: 'rail' },
    /* 장식 */
    lamp:        { wall: '#6b4526', roof: '#e8a33d', shape: 'lamp',  mark: null },
    banner:      { wall: '#6b4526', roof: '#bc4749', shape: 'banner', mark: null },
    garden:      { wall: '#6a994e', roof: '#bc4749', shape: 'garden', mark: null },
    fountain:    { wall: '#c4cad2', roof: '#4a7fa8', shape: 'fountain', mark: null }
  };
  var DEFAULT_STYLE = { wall: '#c8a874', roof: '#8a5e33', shape: 'gable', mark: null };

  function styleOfBuilding(key) { return STYLE[key] || DEFAULT_STYLE; }

  /* ══════════ ★ GDD3 §15-B-4 — 티어별 외형 진화 (절차 레이어) ══════════
   *
   * 무엇이 문제였나: 티어를 반영하는 모양은 여덟 뿐이었다(gable·round·shed·stack·tower·crate·pile).
   * 노포·화포·시장·기념비·가로등은 1단이든 3단이든 **픽셀 한 톨도 안 달라졌다** — 개축하고도
   * 화면이 그대로면 「올렸다」는 감각이 남지 않는다. 서른다섯 채를 손으로 세 벌씩 그리는 대신,
   * 세 켜를 절차로 얹는다.
   *
   *   ① 재질  — 흙·나무 → 회칠·기와 → 석조·금장 (팔레트를 티어에 따라 섞는다)
   *   ② 규모  — 모양마다 이미 있는 grow 항 (유지)
   *   ③ 장식  — 실제로 그려진 픽셀의 **테두리 상자**를 재어 그 위에 얹는다.
   *             모양별 좌표표가 필요 없어 서른다섯 채가 한 벌의 규칙으로 자란다.
   */
  function tierPalette(wall, roof, t) {
    if (t >= 2) { wall = U.mix(wall, '#efe6d2', 0.26); roof = U.mix(roof, '#5f6a74', 0.26); }
    if (t >= 3) { wall = U.mix(wall, '#f8f1e0', 0.22); roof = U.mix(roof, '#39434f', 0.30); }
    return { wall: wall, roof: roof };
  }

  /** 그려진 픽셀의 테두리 상자 위에 티어 장식을 얹는다 */
  function tierLayer(P, t, box, ruined) {
    if (t < 2 || ruined) return;
    var cl = function (v) { return Math.max(0, Math.min(24, v)); };
    var x0 = cl(box.x0), x1 = cl(box.x1), y0 = cl(box.y0), y1 = cl(box.y1);
    var w = Math.max(2, x1 - x0), h = Math.max(2, y1 - y0);

    /* 2단 — 돌 기단과 모서리 기둥. 건물이 땅에서 한 뼘 올라선다. */
    var px = cl(x0 - 1), pw = Math.min(24 - px, w + 2);
    P(px, cl(y1 - 1), pw, Math.min(2, 24 - cl(y1 - 1)), '#8f8578');
    P(px, cl(y1 - 1), pw, 1, '#b5ab98');
    var post = Math.max(3, Math.round(h * 0.42));
    P(px, cl(y1 - 1 - post), 1, post, '#7d7364');
    P(cl(px + pw - 1), cl(y1 - 1 - post), 1, post, '#7d7364');

    if (t < 3) return;
    /* 3단 — 금장 처마 한 줄, 깃대와 깃발, 켜 놓은 등불. */
    P(x0, cl(y0 + Math.round(h * 0.30)), w, 1, '#e8a33d');
    var fx = cl(x1 - 3);
    P(fx, cl(y0 - 5), 1, Math.min(6, cl(y0) + 5), '#6b4526');
    P(cl(fx - 4), cl(y0 - 5), 4, 3, '#bc4749');
    P(cl(fx - 4), cl(y0 - 5), 4, 1, '#d97a78');
    var ly = cl(y0 + Math.round(h * 0.62));
    P(cl(x0 - 1), ly, 2, 3, '#a8701f');
    P(cl(x0 - 1), ly, 2, 2, '#f6e6a8');

    if (t < 4) return;
    goldTrim(P, cl, x0, y0, x1, w, h);
  }

  /**
   * ★ §17-19 — 마지막 단(4단) 장식. 금테를 두르고 마루 끝에 금장을 하나 얹는다.
   * 「왜」 따로 두나 — 다 키운 건물이 3단과 똑같이 생기면 개축한 보람이 화면에 남지 않는다.
   *   (건물 스프라이트는 4단에서 멈춘다 — 5·6단 자료를 가진 건물도 그림은 여기까지다.)
   */
  function goldTrim(P, cl, x0, y0, x1, w, h) {
    P(x0, cl(y0 - 1), w, 1, '#f6cf7a');
    P(cl(x0 - 1), y0, 1, h, '#e8a33d');
    P(cl(x1), y0, 1, h, '#e8a33d');
    P(cl(x0 + Math.round(w / 2) - 1), cl(y0 - 3), 2, 3, '#f6cf7a');
  }

  function building(key, tier, opts) {
    opts = opts || {};
    var handmade = handmadeBuilding(key, tier, opts.ruined);
    if (handmade) return handmade;
    /* Keep an authored building absent for a moment rather than replacing it
       with a visibly cheaper procedural sprite. */
    return emptySprite(24, 24);
    var t = Math.max(1, Math.min(4, tier || 1));
    var ruined = opts.ruined ? 1 : 0;
    var ck = 'b:' + key + ':' + t + ':' + ruined;
    return cached(ck, 24, 24, function (P0) {
      var st = styleOfBuilding(key);
      /* ★ §15-B-4 ① 재질 — 티어가 오르면 벽과 지붕의 재료가 바뀐다 */
      var pal = tierPalette(st.wall, st.roof, t);
      /* ★ §15-B-4 ③ 장식의 자리를 알기 위해 그려지는 것의 테두리를 잰다 */
      var box = { x0: 99, y0: 99, x1: -1, y1: -1 };
      var P = function (x, y, w, h, c) {
        P0(x, y, w, h, c);
        if (!(w > 0 && h > 0)) return;
        if (x < box.x0) box.x0 = x;
        if (y < box.y0) box.y0 = y;
        if (x + w > box.x1) box.x1 = x + w;
        if (y + h > box.y1) box.y1 = y + h;
      };
      var wall = ruined ? U.mix(pal.wall, '#4a4038', 0.55) : pal.wall;
      var roof = ruined ? U.mix(pal.roof, '#3a3028', 0.55) : pal.roof;
      var dark = '#4a3220';
      var grow = (t - 1);

      /* ★ §15-B-4 — 표식 없이 끝나는 모양들도 티어 레이어까지는 와야 한다: 옛 코드의 `return` 을
         라벨 탈출로 바꿨다(그 모양의 '표식 생략'은 그대로 지킨다). */
      shapeAndMark: {
      switch (st.shape) {
        case 'fire': {                                     // 모닥불
          P(4, 18, 16, 4, '#5a4632');
          P(6, 19, 12, 2, '#7a5e42');
          P(8, 12, 3, 8, '#6b4526'); P(13, 12, 3, 8, '#6b4526');
          P(7, 15, 10, 3, '#8a5e33');
          P(9, 8 - grow, 6, 8 + grow, '#e08541');
          P(10, 10 - grow, 4, 5 + grow, '#f2b06a');
          P(11, 6 - grow, 2, 4, '#f6e6a8');
          P(6, 13, 2, 3, '#d96a2c'); P(16, 12, 2, 4, '#d96a2c');
          break shapeAndMark;
        }
        case 'tent': {
          P(2, 20, 20, 3, '#4a3a2a');
          P(11, 3, 2, 18, '#6b4526');
          for (var i = 0; i <= 8; i++) {
            P(12 - i, 5 + i * 2, 1 + i * 2, 2, i % 2 ? wall : U.shade(wall, -0.08));
          }
          P(3, 19, 18, 2, U.shade(wall, -0.2));
          P(10, 14, 4, 7, dark);
          P(10, 1, 4, 3, roof);
          break shapeAndMark;
        }
        case 'crate': {
          P(4, 12, 16, 10, wall); P(4, 12, 16, 1, U.shade(wall, 0.3));
          P(4, 21, 16, 2, U.shade(wall, -0.3));
          P(4, 16, 16, 2, roof); P(11, 12, 2, 10, roof);
          if (t >= 2) { P(6, 6, 12, 6, wall); P(6, 6, 12, 1, U.shade(wall, 0.3)); P(6, 9, 12, 1, roof); }
          break shapeAndMark;
        }
        case 'well': {
          P(6, 14, 12, 8, wall); P(6, 14, 12, 1, U.shade(wall, 0.35));
          P(8, 16, 8, 5, '#2b3a4a');
          P(5, 4, 2, 11, '#6b4526'); P(17, 4, 2, 11, '#6b4526');
          P(3, 2, 18, 3, roof); P(3, 2, 18, 1, U.shade(roof, 0.3));
          P(11, 6, 2, 4, '#8a5e33');
          break shapeAndMark;
        }
        case 'pile': {
          P(2, 15, 20, 7, wall); P(2, 15, 20, 1, U.shade(wall, 0.28));
          for (var w = 3; w < 21; w += 4) P(w, 16, 2, 5, U.shade(wall, -0.25));
          if (t >= 2) { P(4, 9, 16, 6, wall); for (var w2 = 5; w2 < 19; w2 += 4) P(w2, 10, 2, 4, U.shade(wall, -0.25)); }
          if (t >= 3) { P(7, 4, 10, 5, wall); }
          break shapeAndMark;
        }
        case 'round': {
          var rh = 11 + grow * 2;
          P(4, 22 - rh, 16, rh, wall);
          P(4, 22 - rh, 16, 2, U.shade(wall, 0.28));
          P(4, 21, 16, 2, U.shade(wall, -0.3));
          P(2, 22 - rh - 5, 20, 5, roof);
          P(6, 22 - rh - 8, 12, 3, roof); P(6, 22 - rh - 8, 12, 1, U.shade(roof, 0.3));
          P(10, 16, 5, 6, dark);
          break;
        }
        case 'shed': {
          var sh = 9 + grow * 2;
          P(3, 22 - sh, 18, sh, wall); P(3, 22 - sh, 18, 1, U.shade(wall, 0.3));
          P(1, 22 - sh - 4, 22, 4, roof); P(1, 22 - sh - 4, 22, 1, U.shade(roof, 0.25));
          P(4, 22 - sh - 6, 6, 2, U.shade(roof, -0.2));
          P(9, 16, 6, 6, dark);
          break;
        }
        case 'stack': {
          var kh = 10 + grow * 2;
          P(3, 22 - kh, 15, kh, wall); P(3, 22 - kh, 15, 1, U.shade(wall, 0.3));
          P(17, 4, 5, 18, U.shade(wall, -0.15)); P(17, 4, 5, 1, U.shade(wall, 0.2));
          P(17, 1, 5, 3, '#4a4038');
          P(7, 14, 7, 8, '#e08541'); P(8, 16, 5, 5, '#f6cf7a');
          break;
        }
        case 'mine': {
          P(2, 20, 20, 3, '#4a4038');
          P(4, 8, 16, 13, wall); P(4, 8, 16, 1, U.shade(wall, 0.25));
          P(8, 12, 8, 9, '#1a1410');
          P(6, 6, 3, 15, '#6b4526'); P(15, 6, 3, 15, '#6b4526');
          P(4, 4, 16, 3, '#6b4526'); P(4, 4, 16, 1, '#8a5e33');
          P(10, 14, 4, 3, '#3a3028');
          break;
        }
        case 'mill': {
          P(6, 12, 12, 10, wall); P(6, 12, 12, 1, U.shade(wall, 0.3));
          P(4, 8, 16, 4, roof); P(4, 8, 16, 1, U.shade(roof, 0.3));
          P(11, 2, 2, 8, '#6b4526');
          P(3, 3, 8, 2, '#dcc9a0'); P(13, 5, 8, 2, '#dcc9a0');
          P(11, 0, 2, 2, '#e8a33d');
          P(10, 17, 5, 5, dark);
          break;
        }
        case 'tower': {
          var th = 14 + grow * 2;
          P(6, 22 - th, 12, th, wall); P(6, 22 - th, 12, 2, U.shade(wall, 0.3));
          P(4, 22 - th - 5, 16, 5, U.shade(wall, -0.1));
          P(4, 22 - th - 5, 16, 1, U.shade(wall, 0.25));
          for (var c = 0; c < 4; c++) P(4 + c * 4, 22 - th - 8, 3, 3, wall);
          P(10, 17, 4, 5, dark);
          break;
        }
        case 'engine': {
          P(2, 17, 20, 5, '#6b4526'); P(2, 17, 20, 1, '#8a5e33');
          P(3, 21, 4, 3, '#3b2318'); P(17, 21, 4, 3, '#3b2318');
          P(9, 9, 4, 9, wall);
          P(1, 10, 22, 3, U.shade(wall, 0.25));
          P(0, 6, 3, 9, U.shade(wall, -0.25)); P(21, 6, 3, 9, U.shade(wall, -0.25));
          break;
        }
        case 'stall': {
          P(2, 20, 20, 3, '#6b4526');
          P(4, 12, 16, 9, wall); P(4, 12, 16, 1, U.shade(wall, 0.3));
          for (var s = 0; s < 5; s++) P(2 + s * 4, 7, 4, 5, s % 2 ? roof : '#f4e4bc');
          P(1, 6, 22, 2, '#6b4526');
          P(2, 4, 2, 3, '#6b4526'); P(20, 4, 2, 3, '#6b4526');
          break;
        }
        case 'obelisk': {
          P(4, 19, 16, 4, U.shade(wall, -0.2)); P(4, 19, 16, 1, U.shade(wall, 0.2));
          P(7, 14, 10, 6, U.shade(wall, -0.1));
          P(9, 2, 6, 13, wall); P(9, 2, 6, 1, U.shade(wall, 0.35));
          P(10, 0, 4, 3, '#e8a33d'); P(11, 5, 2, 6, U.shade(wall, -0.28));
          break;
        }
        case 'lamp': {
          P(10, 8, 3, 14, wall); P(9, 21, 5, 2, U.shade(wall, -0.3));
          P(8, 3, 7, 6, roof); P(9, 4, 5, 4, '#f6e6a8');
          P(10, 1, 3, 2, '#a8701f');
          break;
        }
        case 'banner': {
          P(5, 1, 2, 22, wall);
          P(7, 3, 10, 10, roof); P(7, 3, 10, 1, U.shade(roof, 0.3));
          P(7, 13, 3, 3, roof); P(13, 13, 4, 3, roof);
          P(4, 0, 4, 2, '#e8a33d');
          break;
        }
        case 'ranch': {
          /* 바닥 — 밟아 다져진 흙 마당 */
          P(1, 6, 22, 16, '#8a7449'); P(1, 6, 22, 1, '#9c8556');
          P(4, 10, 6, 4, '#7a6540'); P(14, 15, 6, 3, '#7a6540');
          /* 울타리 — 기둥과 가로대 두 줄(사방을 두른다) */
          for (var rp = 0; rp < 6; rp++) {
            P(1 + rp * 4, 4, 2, 5, '#8a5e33');
            P(1 + rp * 4, 19, 2, 5, '#8a5e33');
          }
          P(0, 4, 2, 20, '#8a5e33'); P(22, 4, 2, 20, '#8a5e33');
          P(1, 5, 22, 1, wall); P(1, 7, 22, 1, U.shade(wall, -0.15));
          P(1, 21, 22, 1, wall); P(1, 23, 22, 1, U.shade(wall, -0.15));
          P(1, 5, 1, 19, wall); P(22, 5, 1, 19, U.shade(wall, -0.15));
          /* 우리 한켠의 헛간 지붕과 짚가리·여물통 — 티어가 오르면 짚가리가 자란다 */
          P(14, 4, 9, 6, roof); P(14, 4, 9, 1, U.shade(roof, 0.3));
          P(15, 8 - grow, 7, 3 + grow, '#e8c96a'); P(15, 8 - grow, 7, 1, '#f6e6a8');
          P(3, 16, 6, 3, '#6b4526'); P(3, 16, 6, 1, '#8a5e33');
          break shapeAndMark;
        }
        case 'garden': {
          P(2, 16, 20, 6, '#7a5c30'); P(2, 16, 20, 1, '#8a6a3a');
          for (var g = 0; g < 5; g++) {
            P(3 + g * 4, 11, 2, 6, '#6a994e');
            P(2 + g * 4, 8, 4, 4, g % 2 ? '#bc4749' : '#e8a33d');
            P(3 + g * 4, 9, 2, 2, '#f6e6a8');
          }
          break;
        }
        case 'fountain': {
          P(3, 15, 18, 7, wall); P(3, 15, 18, 1, U.shade(wall, 0.35));
          P(5, 17, 14, 4, roof);
          P(11, 6, 2, 10, wall);
          P(8, 3, 8, 4, U.shade(wall, 0.2));
          P(6, 8, 2, 6, '#78aed6'); P(16, 8, 2, 6, '#78aed6');
          P(10, 1, 4, 3, '#9ed0ee');
          break;
        }
        default: {                                        // gable — 기본 집
          var h = 9 + grow * 2;
          P(3, 22 - h, 18, h, wall);
          P(3, 22 - h, 18, 2, U.shade(wall, 0.25));
          P(3, 21, 18, 2, dark);
          P(1, 22 - h - 4, 22, 4, roof);
          P(1, 22 - h - 4, 22, 1, U.shade(roof, 0.3));
          P(10, 16, 5, 6, dark);
          P(6, 14, 3, 3, '#f6e6a8'); P(16, 14, 3, 3, '#f6e6a8');
          if (t >= 3) { P(9, 22 - h - 8, 6, 4, roof); P(9, 22 - h - 8, 6, 1, U.shade(roof, 0.3)); }
          break;
        }
      }

      /* 표식 — 무슨 건물인지 한눈에 */
      switch (st.mark) {
        case 'chimney':  P(16, 2, 3, 6, '#6b4526'); P(16, 1, 3, 1, '#8a8478'); break;
        case 'window2':  P(5, 9, 3, 3, '#f6e6a8'); P(16, 9, 3, 3, '#f6e6a8'); break;
        case 'grain':    P(9, 2, 6, 3, '#e8a33d'); P(11, 0, 2, 2, '#f6cf7a'); break;
        case 'saw':      P(2, 6, 8, 2, '#c6d6e2'); for (var q = 0; q < 4; q++) P(3 + q * 2, 8, 1, 1, '#c6d6e2'); break;
        case 'stone':    P(15, 3, 6, 5, '#9aa0a8'); P(15, 3, 6, 1, '#c4cad2'); break;
        case 'antler':   P(4, 1, 1, 5, '#dcd0b4'); P(2, 2, 2, 1, '#dcd0b4'); P(6, 3, 2, 1, '#dcd0b4'); break;
        case 'strap':    P(3, 13, 18, 2, '#5c3b20'); break;
        case 'fire':     P(9, 9, 5, 4, '#f6cf7a'); break;
        case 'anvil':    P(14, 3, 8, 3, '#5e646c'); P(16, 6, 4, 2, '#4a5058'); break;
        case 'eye':      P(9, 9, 6, 3, '#f4e4bc'); P(11, 9, 2, 3, '#4a6fa5'); break;
        case 'arrow':    P(11, 3, 2, 6, '#e8a33d'); P(9, 5, 6, 1, '#e8a33d'); break;
        case 'sword':    P(11, 1, 2, 7, '#c6d6e2'); P(9, 7, 6, 2, '#a8701f'); break;
        case 'bolt':     P(10, 5, 4, 3, '#e8a33d'); break;
        case 'barrel':   P(20, 8, 4, 4, '#2b3138'); break;
        /* ★ §19-F1(F08-3) — 서리 결정(여섯 갈래)과 솟는 불꽃 */
        case 'frost':    P(11, 1, 2, 8, '#dff1fb'); P(8, 4, 8, 2, '#dff1fb'); P(9, 2, 2, 2, '#9fd4ee'); P(13, 6, 2, 2, '#9fd4ee'); break;
        case 'flame':    P(10, 1, 4, 5, '#e08541'); P(11, 0, 2, 3, '#f6cf7a'); P(9, 4, 6, 2, '#d96a2c'); break;
        case 'ship':     P(4, 3, 6, 5, '#f4e4bc'); P(3, 8, 9, 2, '#8a5e33'); break;
        case 'awning':   P(2, 2, 20, 2, '#bc4749'); break;
        case 'holy':     P(11, 0, 2, 5, '#f6e6a8'); P(9, 1, 6, 2, '#f6e6a8'); break;
        case 'flag':     P(4, 0, 2, 8, '#6b4526'); P(6, 1, 6, 4, '#4a6fa5'); break;
        case 'flap':     P(3, 3, 4, 3, '#bc4749'); break;
        /* ★ §19-F4 — 책(서고) · 톱니(공방) · 붓(대학당) · 레일(정거장) */
        case 'book':     P(8, 2, 8, 6, '#f4e4bc'); P(11, 2, 2, 6, '#8a5e33'); break;
        case 'gear':     P(10, 2, 4, 4, '#c6d6e2'); P(8, 3, 8, 2, '#c6d6e2'); P(11, 0, 2, 8, '#9aa4ae'); break;
        case 'quill':    P(13, 0, 2, 7, '#f6e6a8'); P(11, 6, 4, 2, '#8a5e33'); P(8, 9, 8, 1, '#c6d6e2'); break;
        case 'rail':     P(2, 12, 20, 1, '#9aa4ae'); P(2, 15, 20, 1, '#9aa4ae'); for (var rq = 0; rq < 5; rq++) P(3 + rq * 4, 12, 1, 4, '#6b4526'); break;
        default: break;
      }
      }
      /* ★ §15-B-4 ③ — 잰 테두리 위에 티어 장식을 얹는다 (서른다섯 채가 같은 규칙으로 자란다) */
      tierLayer(P0, t, box, ruined);
      if (ruined) {
        P0(2, 2, 4, 2, '#3a3028'); P0(17, 5, 5, 2, '#3a3028');
        P0(6, 8, 3, 2, '#3a3028'); P0(13, 12, 4, 2, '#3a3028');
      }
    });
  }

  /** 건설 현장 — 진행도 4단계 */
  var SITE_IMAGES = {};
  function handmadeSite(phase) {
    var im = SITE_IMAGES[phase];
    if (!im) { im = new Image(); im.onload = function () { try { global.dispatchEvent(new Event('gm:building-asset-ready')); } catch (e) {} }; im.onerror = function () { im.failed = true; }; im.src = 'assets/building/site/phase-' + phase + '.png?v=site-set-2'; SITE_IMAGES[phase] = im; }
    return im && im.complete && im.naturalWidth && !im.failed ? im : null;
  }

  /* Biome props are authored project assets.  Keep the list explicit so a
     missing or experimental folder never appears unexpectedly on the map. */
  var BIOME_PROP_IMAGES = {};
  var BIOME_PROP_PATHS = {
    codex_forest_oak: 'generated/environment/forest-oak.png',
    codex_snow_pine: 'generated/environment/snow-pine.png',
    codex_jungle_tree: 'generated/environment/jungle-tree.png'
  };
  function biomeProp(key) {
    if (!BIOME_PROP_PATHS[key]) return null;
    var im = BIOME_PROP_IMAGES[key];
    if (!im) {
      im = new Image();
      im.onload = function () { try { global.dispatchEvent(new Event('gm:building-asset-ready')); } catch (e) {} };
      im.onerror = function () { im.failed = true; };
      im.src = 'assets/' + BIOME_PROP_PATHS[key] + '?v=codex-biome-props-1';
      BIOME_PROP_IMAGES[key] = im;
    }
    return im && im.complete && im.naturalWidth && !im.failed ? im : null;
  }

  var LANDMARK_IMAGES = {};
  var LANDMARK_PATHS = {
    codex_rune_obelisk: 'generated/landmark/rune-obelisk.png'
  };
  function landmark(key) {
    if (!LANDMARK_PATHS[key]) return null;
    var im = LANDMARK_IMAGES[key];
    if (!im) {
      im = new Image();
      im.onload = function () { try { global.dispatchEvent(new Event('gm:building-asset-ready')); } catch (e) {} };
      im.onerror = function () { im.failed = true; };
      im.src = 'assets/' + LANDMARK_PATHS[key] + '?v=codex-landmarks-1';
      LANDMARK_IMAGES[key] = im;
    }
    return im && im.complete && im.naturalWidth && !im.failed ? im : null;
  }
  function site(progress) {
    var p = Math.round(Math.max(0, Math.min(1, progress || 0)) * 3);
    var art = handmadeSite(p + 1);
    if (art) return art;
    return emptySprite(24, 24);
    return cached('site:' + p, 24, 24, function (P) {
      P(4, 20, 16, 3, '#7a6c44');
      P(4, 6, 2, 15, '#a3703f'); P(18, 6, 2, 15, '#a3703f');
      P(4, 6, 16, 2, '#a3703f');
      P(4, 13, 16, 2, '#8a5e33');
      if (p >= 1) P(6, 15, 12, 5, '#c8a874');
      if (p >= 2) P(6, 9, 12, 6, '#c8a874');
      if (p >= 3) { P(4, 4, 16, 4, '#8a5e33'); P(4, 4, 16, 1, '#a3703f'); }
      P(19, 2, 4, 3, '#e8a33d');
    });
  }

  /* ══════════ ★ 울타리 조각 ══════════ */
  /** 한 조각(타일 하나)을 방향·재질·상태에 맞춰 그린다 */
  var FENCE_IMAGES = {};
  function handmadeFencePart(key) {
    var im = FENCE_IMAGES[key];
    if (!im) { im = new Image(); im.onload = function () { try { global.dispatchEvent(new Event('gm:building-asset-ready')); } catch (e) {} }; im.onerror = function () { im.failed = true; }; im.src = 'assets/building_parts/' + key + '.png?v=wall-parts-2'; FENCE_IMAGES[key] = im; }
    return im && im.complete && im.naturalWidth && !im.failed ? im : null;
  }
  function fence(opts) {
    opts = opts || {};
    var vertical = opts.vertical ? 1 : 0;
    var tier = opts.tier === 2 ? 2 : 1;
    var gate = opts.gate ? 1 : 0;
    var dmg = opts.damage || 0;                 // 0 온전 · 1 상함 · 2 부서짐
    /* 정상 목책·석벽은 제작 PNG를 우선한다. 문·피해 상태는 모양이 실시간으로
       갈려야 하므로 아래의 절차 스프라이트가 계속 담당한다. */
    if (!dmg) {
      var part = handmadeFencePart(gate ? (tier === 2 ? 'gate_stone' : 'gate_wood') : (tier === 2 ? (vertical ? 'wall_v' : 'wall_h') : (vertical ? 'fence_v' : 'fence_h')));
      if (part) return part;
    }
    var key = 'fc:' + vertical + ':' + tier + ':' + gate + ':' + dmg;
    return cached(key, 16, 16, function (P) {
      var wood = dmg === 2 ? '#6a5442' : (dmg === 1 ? '#8a6a44' : '#a3703f');
      var lit = U.shade(wood, 0.28), dark = U.shade(wood, -0.3);
      var stone = dmg === 2 ? '#6e747c' : (dmg === 1 ? '#848a92' : '#9aa0a8');
      var stoneL = U.shade(stone, 0.3);

      function bar(x, y, w, h, c, c2) { P(x, y, w, h, c); P(x, y, w, 1, c2); }

      if (tier === 2) {
        if (vertical) {
          bar(5, 0, 6, 16, stone, stoneL);
          P(5, 4, 6, 1, U.shade(stone, -0.3)); P(5, 10, 6, 1, U.shade(stone, -0.3));
          if (dmg === 2) { P(6, 6, 4, 4, 'rgba(0,0,0,0)'); P(5, 6, 2, 3, U.shade(stone, -0.45)); }
        } else {
          bar(0, 5, 16, 6, stone, stoneL);
          P(4, 5, 1, 6, U.shade(stone, -0.3)); P(10, 5, 1, 6, U.shade(stone, -0.3));
          if (dmg === 2) P(6, 5, 3, 3, U.shade(stone, -0.45));
        }
        if (gate) { P(4, 4, 8, 8, '#6b4526'); P(5, 5, 6, 6, '#8a5e33'); P(7, 7, 2, 2, '#e8a33d'); }
        return;
      }
      if (vertical) {
        P(6, 0, 4, 16, wood); P(6, 0, 1, 16, lit);
        P(4, 3, 8, 2, dark); P(4, 10, 8, 2, dark);
        if (dmg >= 1) P(7, 6, 3, 3, U.shade(wood, -0.5));
        if (dmg === 2) { P(6, 11, 4, 5, U.shade(wood, -0.55)); }
      } else {
        P(0, 6, 16, 4, wood); P(0, 6, 16, 1, lit);
        P(3, 4, 2, 8, dark); P(10, 4, 2, 8, dark);
        if (dmg >= 1) P(6, 7, 3, 3, U.shade(wood, -0.5));
        if (dmg === 2) P(11, 6, 5, 4, U.shade(wood, -0.55));
      }
      if (gate) {
        P(3, 3, 10, 10, '#6b4526'); P(4, 4, 8, 8, '#8a5e33');
        P(7, 6, 2, 4, '#e8a33d');
      }
    });
  }

  /* ══════════ 도읍 · 마차 · 적 캠프 ══════════ */
  function town(isPlayer) {
    return cached('town:' + (isPlayer ? 1 : 0), 28, 28, function (P) {
      var wall = isPlayer ? '#dcc9a0' : '#b9b0a0';
      var roof = isPlayer ? '#a8701f' : '#6b6256';
      P(2, 12, 24, 14, wall); P(2, 12, 24, 2, U.shade(wall, 0.3));
      P(2, 25, 24, 3, '#5c3b20');
      for (var i = 0; i < 5; i++) P(2 + i * 5, 9, 3, 3, wall);
      P(5, 6, 6, 8, U.shade(wall, -0.12)); P(17, 6, 6, 8, U.shade(wall, -0.12));
      P(5, 4, 6, 2, roof); P(17, 4, 6, 2, roof);
      P(11, 18, 6, 8, '#5c3b20'); P(13, 21, 2, 2, '#e8a33d');
      P(13, 0, 2, 5, '#6b4526');
      P(15, 1, 6, 3, isPlayer ? '#e8a33d' : '#bc4749');
    });
  }

  /**
   * ★ 정착지 본부 (GDD3 §12-2) — 4×4 대형 구조물. **정착지 티어**에 따라 외형이 자란다.
   *   0 모닥불 · 1 야영 본부 · 2 촌락 회관 · 3 마을 회관 · 4 읍성 관청 · 5+ 도시 궁청
   *   4칸짜리라 48×48 판에 그린다(1칸=12px 기준의 두 배 해상도).
   */
  function hall(tier, opts) {
    opts = opts || {};
    var t = Math.max(0, Math.min(5, tier || 0));
    var ruined = opts.ruined ? 1 : 0;
    var stageKeys = ['campfire', 'hq_camp', 'hq_village', 'hq_town', 'hq_city', 'hq_royal'];
    var art = handmadeBuilding(stageKeys[t], 1, ruined);
    if (art) return art;
    return emptySprite(48, 48);
    return cached('hall:' + t + ':' + ruined, 48, 48, function (P) {
      var wall = ruined ? '#5a5048' : '#dcc9a0';
      var wood = ruined ? '#4a3a2a' : '#8a5e33';
      var roof = ruined ? '#3a3028' : '#a8701f';
      var dark = '#4a3220';
      var glow = ruined ? '#6a5a48' : '#f6cf7a';

      /* 바닥 — 다져진 광장. 티어가 오르면 돌바닥이 된다. */
      P(4, 38, 40, 8, t >= 2 ? '#8b8577' : '#6f5c3e');
      P(4, 38, 40, 1, t >= 2 ? '#9c968a' : '#7f6c4c');

      if (t === 0) {                                   // 모닥불 — 돌을 두른 불자리
        for (var i = 0; i < 8; i++) {
          var a = (i / 8) * Math.PI * 2;
          P(24 + Math.cos(a) * 10 - 2, 32 + Math.sin(a) * 5 - 2, 4, 4, '#8b8577');
        }
        P(18, 26, 4, 10, wood); P(26, 26, 4, 10, wood);
        P(16, 30, 16, 4, '#9a6b3c');
        P(20, 16, 8, 16, '#e08541');
        P(22, 20, 4, 10, '#f2b06a');
        P(23, 12, 2, 6, glow);
        return;
      }

      /* 1+ — 지붕 있는 본채. 티어마다 층·너비·장식이 붙는다. */
      var bw = 22 + t * 3;                              // 본채 너비
      var bh = 12 + t * 2;                              // 본채 높이
      var bx = 24 - bw / 2;
      var by = 38 - bh;
      P(bx, by, bw, bh, wall);
      P(bx, by, bw, 2, U.shade(wall, 0.28));
      P(bx, 36, bw, 2, U.shade(wall, -0.3));
      /* 기둥 */
      P(bx + 1, by, 2, bh, wood);
      P(bx + bw - 3, by, 2, bh, wood);
      /* 지붕 — 티어가 오르면 겹처마가 된다 */
      var rh = 5 + t;
      P(bx - 3, by - rh, bw + 6, rh, roof);
      P(bx - 3, by - rh, bw + 6, 1, U.shade(roof, 0.3));
      if (t >= 2) { P(bx + 1, by - rh - 4, bw - 2, 4, roof); P(bx + 1, by - rh - 4, bw - 2, 1, U.shade(roof, 0.3)); }
      if (t >= 4) { P(bx + 5, by - rh - 8, bw - 10, 4, roof); P(bx + 5, by - rh - 8, bw - 10, 1, U.shade(roof, 0.3)); }
      /* 문 */
      P(22, 38 - 9, 5, 9, dark);
      P(24, 38 - 5, 1, 2, glow);
      /* 창 — 밤에 빛나는 자리 */
      P(bx + 4, by + 4, 4, 4, glow);
      P(bx + bw - 8, by + 4, 4, 4, glow);
      if (t >= 3) { P(bx + 4, by + 10, 4, 4, glow); P(bx + bw - 8, by + 10, 4, 4, glow); }
      /* 깃대 */
      if (t >= 1) { P(38, by - rh - 10, 2, 12, wood); P(40, by - rh - 9, 6, 4, '#e8a33d'); }
      /* 종루·석축 */
      if (t >= 3) { P(8, by - 2, 6, 14, U.shade(wall, -0.1)); P(7, by - 7, 8, 5, roof); }
      if (t >= 5) { P(4, 30, 6, 8, '#8b8577'); P(38, 30, 6, 8, '#8b8577'); }
      /* 곁의 모닥불은 늘 남는다 — 부활 지점 */
      P(6, 33, 5, 3, '#9a6b3c');
      P(7, 28, 3, 6, '#e08541');
      P(8, 26, 1, 3, glow);
    });
  }

  /** ★ 마차 — 오프닝과 주민 도착 연출의 주인공 */
  function wagon(frame) {
    return cached('wagon:' + (frame ? 1 : 0), 32, 24, function (P) {
      var b = frame ? 1 : 0;
      P(3, 12 + b, 22, 7, '#8a5e33'); P(3, 12 + b, 22, 1, '#a3703f');
      P(3, 18 + b, 22, 2, '#5c3b20');
      P(6, 4 + b, 17, 9, '#f4e4bc');
      for (var i = 0; i < 4; i++) P(8 + i * 4, 4 + b, 1, 9, '#d8c69a');
      P(6, 3 + b, 17, 2, '#dcd0b4');
      P(2, 8 + b, 4, 6, '#6b4526');
      P(4, 19, 6, 5, '#3b2318'); P(5, 20, 4, 3, '#6b4526');
      P(19, 19, 6, 5, '#3b2318'); P(20, 20, 4, 3, '#6b4526');
      P(25, 9 + b, 6, 8, '#7a5230'); P(25, 9 + b, 6, 1, '#96683d');
      P(29, 7 + b, 2, 3, '#5c3b20');
      P(26, 11 + b, 1, 2, '#1a1008');
    });
  }

  function caravan() {
    return cached('caravan', 16, 12, function (P) {
      P(1, 4, 12, 5, '#a3703f'); P(1, 4, 12, 1, '#c08a52');
      P(3, 1, 8, 4, '#f4e4bc');
      P(2, 9, 3, 3, '#3b2318'); P(9, 9, 3, 3, '#3b2318');
    });
  }

  function camp(type) {
    if (!camp.__image) {
      camp.__image = new Image();
      camp.__image.onload = function () { try { global.dispatchEvent(new Event('gm:building-asset-ready')); } catch (e) {} };
      camp.__image.onerror = function () { camp.__image.failed = true; };
      camp.__image.src = 'assets/enemy/camp/base.png?v=camp-art-2';
    }
    if (camp.__image.complete && camp.__image.naturalWidth && !camp.__image.failed) return camp.__image;
    return cached('camp:' + type, 24, 24, function (P) {
      var col = type === 'dragon' ? '#4a7040' : type === 'viking' ? '#6b7580'
              : type === 'wolf' ? '#7a7264' : type === 'ogre' ? '#6b7a4a' : '#5a4038';
      P(2, 20, 20, 3, '#3a2a1c');
      P(4, 10, 7, 11, col); P(4, 10, 7, 1, U.shade(col, 0.3));
      P(13, 12, 7, 9, col); P(13, 12, 7, 1, U.shade(col, 0.3));
      P(6, 6, 3, 5, '#6b4526');
      P(9, 6, 5, 3, '#bc4749');
      P(15, 16, 5, 4, '#e08541'); P(16, 15, 3, 2, '#f6cf7a');
    });
  }

  /* ══════════ 사람 ══════════ */
  var JOB_COLOR = {
    farm: '#6a994e', lumber: '#a3703f', quarry: '#9aa0a8', mine: '#b07050',
    factory: '#8d7f6a', build: '#c8965a', defense: '#bc4749', trade: '#4a6fa5',
    scout: '#e8a33d', idle: '#9c8f76'
  };

  function folk(job, dir, frame) {
    var col = JOB_COLOR[job] || '#9c8f76';
    return cached('f:' + job + ':' + dir + ':' + frame, 12, 16, function (P) {
      var bob = frame ? 1 : 0;
      P(3, 12 + bob, 2, 4 - bob, '#4a3a2a');
      P(7, 12 + (frame ? 0 : 1), 2, 4 - (frame ? 0 : 1), '#4a3a2a');
      P(2, 7 + bob, 8, 6, col);
      P(2, 7 + bob, 8, 1, U.shade(col, 0.28));
      P(1, 8 + bob, 1, 4, '#e6b892'); P(10, 8 + bob, 1, 4, '#e6b892');
      P(3, 2 + bob, 6, 5, '#e6b892');
      if (dir !== 3) { P(4, 4 + bob, 1, 2, '#241812'); P(7, 4 + bob, 1, 2, '#241812'); }
      if (job === 'farm') { P(2, 1 + bob, 8, 2, '#e0c65a'); P(1, 2 + bob, 10, 1, '#c8a94a'); }
      else if (job === 'lumber') { P(2, 1 + bob, 8, 2, '#7d2a2c'); P(10, 5 + bob, 2, 5, '#8b9fb0'); }
      else if (job === 'quarry' || job === 'mine') { P(2, 1 + bob, 8, 2, '#5e646c'); P(0, 6 + bob, 2, 2, '#c6d6e2'); }
      else if (job === 'defense') { P(0, 7 + bob, 3, 5, '#8b9fb0'); P(10, 3 + bob, 1, 8, '#c6d6e2'); }
      else if (job === 'build') { P(2, 1 + bob, 8, 2, '#e8a33d'); }
      else if (job === 'scout') { P(2, 0 + bob, 9, 2, '#e8a33d'); P(1, 1 + bob, 11, 1, '#c88a1f'); }
      else if (job === 'trade') { P(9, 8 + bob, 3, 4, '#8a5e33'); }
      else if (job === 'factory') { P(2, 2 + bob, 8, 1, '#5e646c'); }
    });
  }

  /* ── 아바타(외형 레이어 팔레트 스왑) ── */
  var SKIN_SHADE = -0.18;

  function appKey(a) {
    a = a || {};
    return [a.skin | 0, a.hair | 0, a.hairColor | 0, a.outfit | 0, a.outfitColor | 0].join('_');
  }
  function palette(field, idx, fallback) {
    var cfg = GM.state && GM.state.appearanceCfg();
    var f = cfg && cfg.fields && cfg.fields[field];
    if (f && f.palette && f.palette.length) return f.palette[((idx | 0) % f.palette.length + f.palette.length) % f.palette.length];
    return fallback;
  }
  function styleOf(field, idx, fallback) {
    var cfg = GM.state && GM.state.appearanceCfg();
    var f = cfg && cfg.fields && cfg.fields[field];
    if (f && f.styles && f.styles.length) return f.styles[((idx | 0) % f.styles.length + f.styles.length) % f.styles.length];
    return fallback;
  }

  /**
   * 사람 도트 — 16×20. dir 0=아래 1=왼 2=오른 3=위, frame 0/1 걸음.
   * @param {object} opts  {crown:boolean, swing:0|1|2 (도끼질 자세), tool:'axe'|'pick'|'hoe'|'hammer'|'sword'}
   */
  function avatar(app, dir, frame, opts) {
    app = app || {};
    opts = opts || {};
    var crown = opts.crown === false ? 0 : 1;
    var sw = opts.swing || 0;
    var tool = opts.tool || null;
    /* ★ GDD3 §13-D-3 — 벼린 것이 몸에 보인다. 등급이 팔레트를, 강화가 자루의 띠를,
       인첸트가 옅은 기운을 정한다. 키에 섞어야 캐시가 옛 그림을 되돌려 주지 않는다. */
    var g = opts.gear || null;
    /* ★ Sprint 3 — 열쇠는 배열을 거치지 않고 바로 잇는다(값·글자는 옛것과 같은 꼴이다).
       이 판은 사람이 그려질 때마다, 즉 프레임마다 예순 번 넘게 불린다. */
    var gk = g ? ((g.weaponGrade | 0) + '.' + (g.weaponPlus | 0) + '.' + (g.weaponEnchant || '-') + '.' +
                  (g.armorGrade | 0) + '.' + (g.armorPlus | 0) + '.' + (g.armorEnchant || '-')) : '-';
    var key = 'a:' + (app.skin | 0) + '_' + (app.hair | 0) + '_' + (app.hairColor | 0) + '_' +
              (app.outfit | 0) + '_' + (app.outfitColor | 0) +
              ':' + dir + ':' + frame + ':' + crown + ':' + sw + ':' + (tool || '-') + ':' + gk;
    /* ★ Sprint 3 — 색·모양 고르기는 **곳간에 없을 때만** 한다. 「왜」 옮겼나 —
       palette·styleOf 는 다섯 번 다 GM.state.appearanceCfg() 를 캐물어 표를 헤집는데,
       그렇게 고른 색은 이미 구워 둔 그림에는 쓸 데가 없다(열쇠는 위의 번호들만 본다).
       열에 아홉은 곳간이 맞히므로 그 다섯 번은 통째로 헛일이었다. 그림은 그대로다. */
    return cached(key, 16, 20, function (P) {
      var skin = palette('skin', app.skin, '#f5d6b8');
      var hairC = palette('hairColor', app.hairColor, '#3b2a1d');
      var outC = palette('outfitColor', app.outfitColor, '#6a994e');
      var hairS = styleOf('hair', app.hair, 'short');
      var outS = styleOf('outfit', app.outfit, 'tunic');
      var bob = frame ? 1 : 0;
      var skinD = U.shade(skin, SKIN_SHADE);
      var lean = sw === 2 ? 1 : 0;                      // 내려치는 순간 몸이 앞으로
      P(5, 16 + bob, 2, 4 - bob, '#3a2c1e');
      P(9, 16 + (frame ? 0 : 1), 2, 4 - (frame ? 0 : 1), '#3a2c1e');
      var bodyTop = 9 + bob + lean;
      if (outS === 'robe' || outS === 'hanbok') {
        P(3, bodyTop, 10, 9, outC);
        P(2, bodyTop + 6, 12, 3, U.shade(outC, -0.12));
      } else if (outS === 'armor') {
        P(3, bodyTop, 10, 8, '#8b9fb0');
        P(3, bodyTop, 10, 1, '#c6d6e2');
        P(4, bodyTop + 2, 8, 5, outC);
      } else if (outS === 'cloak') {
        P(1, bodyTop - 1, 14, 10, U.shade(outC, -0.2));
        P(4, bodyTop, 8, 8, outC);
      } else if (outS === 'coat') {
        P(3, bodyTop, 10, 9, outC);
        P(7, bodyTop, 2, 9, U.shade(outC, -0.3));
      } else {
        P(3, bodyTop, 10, 8, outC);
      }
      P(3, bodyTop, 10, 1, U.shade(outC, 0.3));
      /* 팔 — 스윙 자세에 따라 위치가 바뀐다 */
      if (sw === 1) { P(2, bodyTop - 4, 2, 6, skin); P(12, bodyTop - 3, 2, 5, skin); }
      else if (sw === 2) { P(2, bodyTop + 3, 3, 3, skin); P(12, bodyTop + 2, 2, 5, skin); }
      else { P(2, bodyTop + 1, 2, 5, skin); P(12, bodyTop + 1, 2, 5, skin); }
      /* 머리 */
      var headY = 3 + bob + lean;
      P(4, headY, 8, 7, skin);
      P(3, headY + 2, 1, 4, skinD); P(12, headY + 2, 1, 4, skinD);
      if (hairS !== 'bald') {
        P(3, headY - 2, 10, 3, hairC);
        P(3, headY + 1, 1, 2, hairC); P(12, headY + 1, 1, 2, hairC);
        if (hairS === 'bob') { P(2, headY + 1, 2, 5, hairC); P(12, headY + 1, 2, 5, hairC); }
        if (hairS === 'long') { P(2, headY + 1, 2, 9, hairC); P(12, headY + 1, 2, 9, hairC); }
        if (hairS === 'ponytail') { P(12, headY + 1, 3, 7, hairC); P(13, headY + 7, 2, 3, hairC); }
        if (hairS === 'braid') { P(2, headY + 1, 2, 8, hairC); P(3, headY + 8, 2, 2, U.shade(hairC, 0.2)); }
        if (hairS === 'topknot') { P(6, headY - 3, 4, 2, hairC); P(5, headY - 4, 6, 1, U.shade(hairC, 0.2)); }
        if (hairS === 'curly') { P(2, headY - 1, 3, 3, hairC); P(11, headY - 1, 3, 3, hairC); P(4, headY - 3, 8, 2, hairC); }
      }
      if (dir !== 3) {
        P(5, headY + 3, 2, 2, '#241812'); P(9, headY + 3, 2, 2, '#241812');
        P(7, headY + 6, 2, 1, skinD);
      }
      /* ★ §13-D-3 — 두른 것: 가슴과 어깨에 갑옷 층이 한 겹 얹힌다 */
      var sp = (GM.state && GM.state.equipCfg() && GM.state.equipCfg().sprite) || null;
      if (g && g.armorGrade > 0) {
        var apal = (sp && sp.armorPalette) || ['#6b5a44', '#8f97a3', '#c3ccd8', '#e8d08a', '#e6b6ff'];
        var ac = apal[Math.min(apal.length - 1, g.armorGrade - 1)];
        P(3, bodyTop + 1, 10, 4, ac);
        P(3, bodyTop + 1, 10, 1, U.shade(ac, 0.3));
        P(2, bodyTop + 1, 2, 2, U.shade(ac, -0.15));
        P(12, bodyTop + 1, 2, 2, U.shade(ac, -0.15));
        if (g.armorPlus > 0) P(7, bodyTop + 2, 2, 2, (sp && sp.plusBand) || '#ffcf6a');
      }
      /* 도구 — 손에 든 것. 벼린 무기가 있으면 그 팔레트로 바뀐다. */
      if (tool) {
        var tx = sw === 1 ? 13 : (sw === 2 ? 14 : 13);
        var ty = sw === 1 ? bodyTop - 7 : (sw === 2 ? bodyTop + 4 : bodyTop);
        var wpal = (sp && sp.weaponPalette) || ['#8b8378', '#b9c0c8', '#dfe6ee', '#ffe6a8', '#ffd0f0'];
        var forged = g && g.weaponGrade > 0 ? wpal[Math.min(wpal.length - 1, g.weaponGrade - 1)] : null;
        var head = forged || (tool === 'sword' ? '#c6d6e2' : '#8b9fb0');
        if (tool === 'sword') {
          P(tx, ty - 5, 1, 8, head);
          P(tx - 1, ty + 3, 3, 1, '#a8701f');
          if (g && g.weaponPlus > 0) P(tx - 1, ty + 2, 3, 1, (sp && sp.plusBand) || '#ffcf6a');
        } else {
          P(tx, ty - 4, 1, 7, '#8a5e33');
          P(tx - 2, ty - 5, 4, 3, head);
        }
        /* 인첸트 — 날 끝에 도는 옅은 기운 */
        if (g && g.weaponEnchant) {
          var glow = (sp && sp.enchantGlow && sp.enchantGlow[g.weaponEnchant]) || '#c9c2b4';
          P(tx, ty - 6, 1, 1, glow);
          P(tx + 1, ty - 4, 1, 1, glow);
        }
      }
      if (crown) {
        P(5, headY - 3, 6, 1, '#e8a33d');
        P(5, headY - 4, 1, 1, '#f6cf7a'); P(10, headY - 4, 1, 1, '#f6cf7a');
      }
    });
  }

  function avatarPortrait(app, size) {
    size = size || 32;
    var key = 'ap:' + appKey(app) + ':' + size;
    if (CACHE[key]) return CACHE[key];
    var src = avatar(app, 0, 0, { crown: false });
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    var ctx = cv.getContext('2d');
    var url = '';
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#e6d3a8';
      ctx.fillRect(0, 0, size, size);
      var s = size / 12;
      try { ctx.drawImage(src, 2, 1, 12, 11, 0, Math.round(size * 0.06), size, Math.round(11 * s)); } catch (e) {}
    }
    try { url = cv.toDataURL('image/png'); } catch (e2) { url = ''; }
    if (!url || url.length < 32) url = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    CACHE[key] = url;
    return url;
  }

  function avatarImg(app, size) {
    var im = document.createElement('img');
    im.src = avatarPortrait(app, size || 32);
    im.width = size || 32; im.height = size || 32;
    im.alt = '';
    im.setAttribute('aria-hidden', 'true');
    im.style.width = (size || 32) + 'px';
    im.style.height = (size || 32) + 'px';
    return im;
  }

  /* ══════════ 적 유닛 ══════════
     ★ §19-F2(F07-3) — 여섯에서 열로 늘었다. 늑대·오우거·드래곤은 제 몸틀을 따로 갖고,
     나머지는 사람꼴 하나에 **옷 색과 표식 한 획**만 달리 준다(에셋 없이 실루엣만으로 갈라 읽히게). */
  var FOE = {
    viking: '#6b7580', pirate: '#5a4038', bandit: '#7a5a48',
    raider: '#8a4a3a', ironclad: '#4e5a68', slinger: '#7a7048', sapper: '#5c4a5e',
  };
  var ENEMY_IMAGES = {};
  function handmadeEnemy(type) {
    var im = ENEMY_IMAGES[type];
    if (!im) { im = new Image(); im.onload = function () { try { global.dispatchEvent(new Event('gm:building-asset-ready')); } catch (e) {} }; im.onerror = function () { im.failed = true; }; im.src = 'assets/enemy/' + type + '/sheet.png?v=wave-set-1'; ENEMY_IMAGES[type] = im; }
    return im && im.complete && im.naturalWidth && !im.failed ? im : null;
  }
  function enemy(type, frame) {
    var sheet = handmadeEnemy(type);
    if (sheet) return cached('enemy-file:' + type + ':' + (frame ? 1 : 0), 32, 32, function (P, g) {
      var cw = sheet.naturalWidth / 4, ch = sheet.naturalHeight / 6;
      g.drawImage(sheet, cw, (frame ? 1 : 0) * ch, cw, ch, 0, 0, 32, 32);
    });
    return cached('e:' + type + ':' + frame, 14, 16, function (P) {
      var bob = frame ? 1 : 0;
      if (type === 'wolf') {
        P(2, 8 + bob, 9, 5, '#7a7264'); P(2, 8 + bob, 9, 1, '#948c7e');
        P(10, 5 + bob, 4, 4, '#7a7264'); P(13, 6 + bob, 1, 2, '#3a3028');
        P(10, 3 + bob, 1, 2, '#5e5850'); P(12, 3 + bob, 1, 2, '#5e5850');
        P(12, 6 + bob, 1, 1, '#e8a33d');
        P(0, 6 + bob, 3, 2, '#5e5850');
        P(3, 13 + bob, 2, 3 - bob, '#4a443c'); P(8, 13, 2, 3, '#4a443c');
        return;
      }
      if (type === 'ogre') {
        P(2, 5 + bob, 10, 8, '#6b7a4a'); P(2, 5 + bob, 10, 1, '#84945e');
        P(4, 0 + bob, 7, 5, '#7a8a56');
        P(5, 2 + bob, 1, 2, '#1a1008'); P(9, 2 + bob, 1, 2, '#1a1008');
        P(6, 4 + bob, 3, 1, '#f0e6d2');
        P(0, 6 + bob, 2, 6, '#6b7a4a'); P(12, 6 + bob, 2, 6, '#6b7a4a');
        P(11, 2 + bob, 3, 5, '#8a5e33');
        P(3, 13 + bob, 3, 3 - bob, '#4a5030'); P(8, 13, 3, 3, '#4a5030');
        return;
      }
      if (type === 'dragon') {
        P(2, 6 + bob, 9, 6, '#4a7040'); P(2, 6 + bob, 9, 1, '#5f8a4c');
        P(9, 3 + bob, 5, 5, '#4a7040');
        P(12, 5 + bob, 2, 1, '#e8a33d');
        P(10, 1 + bob, 1, 3, '#3f6130'); P(12, 1 + bob, 1, 3, '#3f6130');
        P(0, 2 + bob, 4, 6, '#3f6130'); P(1, 3 + bob, 2, 4, '#5f8a4c');
        P(0, 10 + bob, 3, 2, '#3f6130');
        P(3, 12 + bob, 2, 4 - bob, '#3a5a2e'); P(8, 12, 2, 4, '#3a5a2e');
        return;
      }
      var col = FOE[type] || FOE.bandit;
      P(3, 12 + bob, 2, 4 - bob, '#2b2118');
      P(8, 12, 2, 4, '#2b2118');
      P(2, 6 + bob, 9, 7, col); P(2, 6 + bob, 9, 1, U.shade(col, 0.3));
      P(3, 1 + bob, 7, 5, '#c8a184');
      P(4, 3 + bob, 1, 2, '#1a1008'); P(8, 3 + bob, 1, 2, '#1a1008');
      if (type === 'viking') { P(1, 0 + bob, 2, 3, '#f0e6d2'); P(10, 0 + bob, 2, 3, '#f0e6d2'); P(3, 0 + bob, 7, 2, '#8b9fb0'); }
      if (type === 'pirate') { P(2, 0 + bob, 9, 2, '#7d2a2c'); P(7, 3 + bob, 3, 1, '#1a1008'); }
      if (type === 'bandit') { P(3, 3 + bob, 7, 1, '#3a3028'); P(2, 0 + bob, 9, 2, '#5c4438'); }
      /* 질주형 — 몸을 앞으로 눕히고 붉은 띠를 두른다(빠르다는 표) */
      if (type === 'raider') { P(2, 5 + bob, 9, 1, '#d4525f'); P(0, 8 + bob, 3, 1, '#d4525f'); }
      /* 중갑형 — 어깨판이 몸통 밖으로 나오고 투구가 얼굴을 덮는다 */
      if (type === 'ironclad') {
        P(0, 6 + bob, 3, 5, '#8b9fb0'); P(10, 6 + bob, 3, 5, '#8b9fb0');
        P(3, 1 + bob, 7, 3, '#8b9fb0'); P(4, 4 + bob, 5, 1, '#2b3540');
      }
      /* 원거리형 — 머리 위로 돌팔매 줄이 돈다 */
      if (type === 'slinger') { P(1, 0 + bob, 1, 4, '#c8a184'); P(0, 0 + bob, 5, 1, '#c8a184'); }
      /* 자폭형 — 등에 진 통과 그 위의 심지 불 */
      if (type === 'sapper') { P(0, 6 + bob, 3, 5, '#3a3028'); P(1, 4 + bob, 1, 2, '#e8a33d'); }
      P(11, 3 + bob, 2, 9, '#8b9fb0'); P(11, 3 + bob, 2, 1, '#c6d6e2');
    });
  }

  /* ══════════ 들에 사는 것들 (GDD3 §13-C) ══════════
     열두 종을 하나하나 손으로 찍지 않는다 — 몸통·머리·다리의 색과 비례만 종마다 달리 준다.
     그래도 실루엣이 서로 다르게 읽히도록 뿔·갈기·귀 같은 표식을 하나씩 붙였다.
     silhouette:true 면 도감의 '아직 못 만난 것' 카드다 — 같은 모양을 검게만 칠한다. */
  var WILD = {
    chicken:      { w: 10, h: 10, body: '#f0e6d2', dark: '#c9bda4', mark: '#bc4749', legs: '#e8a33d', tag: 'comb' },
    rabbit:       { w: 10, h: 10, body: '#cdc3b2', dark: '#a89c88', mark: '#f4ece0', legs: '#8a7f6c', tag: 'ears' },
    sheep:        { w: 12, h: 11, body: '#eae5d8', dark: '#c3bcab', mark: '#3a3028', legs: '#3a3028', tag: 'wool' },
    pig:          { w: 12, h: 11, body: '#e0a9a0', dark: '#bd8a82', mark: '#8a5e56', legs: '#8a5e56', tag: 'snout' },
    cow:          { w: 14, h: 12, body: '#efe9dd', dark: '#b9b2a4', mark: '#3a3028', legs: '#4a443c', tag: 'horns' },
    deer:         { w: 13, h: 12, body: '#b08553', dark: '#8a6740', mark: '#f4ece0', legs: '#6b4f30', tag: 'antler' },
    wolf:         { w: 13, h: 11, body: '#7a7264', dark: '#5e5850', mark: '#e8a33d', legs: '#4a443c', tag: 'fang' },
    boar:         { w: 13, h: 11, body: '#6b5a48', dark: '#50432f', mark: '#f0e6d2', legs: '#3a3028', tag: 'tusk' },
    stray_dog:    { w: 11, h: 10, body: '#9a8a70', dark: '#77694f', mark: '#e8a33d', legs: '#5e5850', tag: 'fang' },
    bear:         { w: 15, h: 13, body: '#5a4436', dark: '#40301f', mark: '#e8a33d', legs: '#33261c', tag: 'hump' },
    bandit_scout: { w: 12, h: 14, body: '#5c4438', dark: '#3f2f26', mark: '#c8a184', legs: '#2b2118', tag: 'hood' },
    direwolf:     { w: 15, h: 12, body: '#4e4a52', dark: '#37343c', mark: '#bc4749', legs: '#26242a', tag: 'mane' },
    /* ★ §19-F2(F07-1·F07-4) — 새 바이옴의 것들. 몸빛만으로도 어느 땅에서 왔는지 읽히게 잡았다
       (눈여우는 흰빛, 모래도마뱀은 모래빛, 잿빛 사냥개는 재, 홀씨는 버섯 갓의 보랏빛). */
    snow_fox:       { w: 11, h: 10, body: '#e6ecf2', dark: '#bcc6d2', mark: '#8fa6bd', legs: '#a8b2be', tag: 'ears' },
    sand_lizard:    { w: 13, h: 9,  body: '#c9a96a', dark: '#a48546', mark: '#6b5a2e', legs: '#8a7038', tag: 'tusk' },
    jungle_panther: { w: 14, h: 11, body: '#2f3a2c', dark: '#1d251b', mark: '#d9c14a', legs: '#161c14', tag: 'fang' },
    marsh_lurker:   { w: 16, h: 10, body: '#3f5a46', dark: '#2a3d30', mark: '#8fb06a', legs: '#22301f', tag: 'hump' },
    ash_hound:      { w: 13, h: 11, body: '#6e6862', dark: '#4c4742', mark: '#c96a3c', legs: '#332f2c', tag: 'mane' },
    spore_walker:   { w: 13, h: 13, body: '#6d5f85', dark: '#4a3f5c', mark: '#c98cff', legs: '#3a3149', tag: 'wool' },
    /* 세계에 하나뿐인 것 — 몸집(w·h)이 곧 위압이다. 화면은 여느 짐승과 같은 길로 그린다. */
    ash_wyrm:       { w: 16, h: 15, body: '#5a4a4a', dark: '#33292b', mark: '#e05a2c', legs: '#241d1f', tag: 'horns' },
  };

  function wild(sp, frame, opts) {
    opts = opts || {};
    var guardianSheet = opts.guardianTheme ? handmadeGuardian(opts.guardianTheme) : null;
    if (guardianSheet) {
      var stateRow = { idle: 0, walk: 1, attack: 2, hurt: 3, death: 4 }[opts.animation] || 0;
      var guardianCol = Math.max(0, Math.min(3, frame || 0));
      return cached('guardian-file:' + opts.guardianTheme + ':' + stateRow + ':' + guardianCol, 64, 64, function (P, g) {
        var gcw = guardianSheet.naturalWidth / 4, gch = guardianSheet.naturalHeight / 5;
        g.drawImage(guardianSheet, guardianCol * gcw, stateRow * gch, gcw, gch, 0, 0, 64, 64);
      });
    }
    var sheet = handmadeWild(sp);
    if (sheet) {
      var row = opts.attack ? 3 + (frame ? 1 : 0) : (frame ? 1 : 0);
      var col = opts.direction == null ? 1 : opts.direction % 4;
      /* 닭·토끼 외 동물은 월드에서 2배 크기로 그린다. 여기서 32px로 먼저 줄이면
         다시 확대할 때 프레임의 상·하 윤곽이 갈라져 보이므로 64px 원본 해상도를 보존한다. */
      var frameSize = (sp === 'chicken' || sp === 'rabbit') ? 32 : 64;
      return cached('wild-file:' + sp + ':' + row + ':' + col + (opts.hurt ? ':h' : ''), frameSize, frameSize, function (P, g) {
        var cw = sheet.naturalWidth / 4, ch = sheet.naturalHeight / 6;
        g.drawImage(sheet, col * cw, row * ch, cw, ch, 0, 0, frameSize, frameSize);
        if (opts.hurt) { g.fillStyle = 'rgba(220,80,70,.35)'; g.fillRect(0, 0, frameSize, frameSize); }
      });
    }
    var d = WILD[sp] || WILD.rabbit;
    var sil = opts.silhouette ? 1 : 0;
    var key = 'wl:' + sp + ':' + (frame ? 1 : 0) + ':' + sil + (opts.hurt ? ':h' : '');
    return cached(key, 16, 16, function (P) {
      var body = sil ? '#1c1720' : d.body;
      var dark = sil ? '#120f16' : d.dark;
      var mark = sil ? '#1c1720' : d.mark;
      var legs = sil ? '#120f16' : d.legs;
      var bob = frame ? 1 : 0;
      var x0 = Math.round((16 - d.w) / 2);
      var y0 = 16 - d.h - 1;
      /* 다리 — 걷는 티가 나게 앞뒤를 엇갈려 든다 */
      P(x0 + 1, 14 - bob, 2, 2 + bob, legs);
      P(x0 + d.w - 3, 14, 2, 2, legs);
      /* 몸통 */
      P(x0, y0 + bob, d.w, d.h - 3, body);
      P(x0, y0 + bob, d.w, 1, sil ? dark : U.shade(d.body, 0.28));
      P(x0, y0 + d.h - 4 + bob, d.w, 1, dark);
      /* 머리 — 오른쪽 위 */
      var hx = x0 + d.w - 5;
      var hy = y0 - 2 + bob;
      P(hx, hy, 5, 5, body);
      P(hx + 3, hy + 2, 1, 1, sil ? dark : '#1a1008');       // 눈
      /* 종마다 하나씩 다른 표식 — 실루엣만 봐도 갈래가 읽히게 */
      if (d.tag === 'comb') { P(hx + 1, hy - 2, 3, 2, mark); P(hx + 4, hy + 3, 2, 1, mark); }
      if (d.tag === 'ears') { P(hx + 1, hy - 4, 1, 4, body); P(hx + 3, hy - 4, 1, 4, body); }
      if (d.tag === 'wool') { P(x0, y0 - 1 + bob, d.w - 4, 2, body); P(x0 + 2, y0 - 2 + bob, 3, 2, body); }
      if (d.tag === 'snout') { P(hx + 5, hy + 2, 1, 2, mark); }
      if (d.tag === 'horns') { P(hx, hy - 2, 1, 2, mark); P(hx + 4, hy - 2, 1, 2, mark); P(x0 + 2, y0 + 2 + bob, 3, 3, mark); }
      if (d.tag === 'antler') { P(hx, hy - 4, 1, 4, mark); P(hx + 4, hy - 4, 1, 4, mark); P(hx - 1, hy - 4, 1, 1, mark); P(hx + 5, hy - 3, 1, 1, mark); }
      if (d.tag === 'fang') { P(hx + 5, hy + 3, 1, 1, '#f0e6d2'); P(hx + 1, hy - 2, 1, 2, dark); P(hx + 3, hy - 2, 1, 2, dark); P(hx + 3, hy + 2, 1, 1, mark); }
      if (d.tag === 'tusk') { P(hx + 5, hy + 1, 1, 2, mark); P(x0, y0 - 1 + bob, 3, 2, dark); }
      if (d.tag === 'hump') { P(x0 + 1, y0 - 2 + bob, 5, 3, body); P(hx + 1, hy - 2, 1, 2, dark); P(hx + 3, hy - 2, 1, 2, dark); }
      if (d.tag === 'hood') { P(hx - 1, hy - 2, 6, 4, dark); P(hx + 1, hy + 1, 3, 1, mark); P(x0 - 1, y0 + 2 + bob, 2, 6, dark); }
      if (d.tag === 'mane') { P(hx - 2, hy, 3, 5, dark); P(x0 + 1, y0 - 1 + bob, 6, 2, dark); P(hx + 5, hy + 3, 1, 1, mark); }
      if (opts.hurt) P(x0, y0 + bob, d.w, d.h - 3, 'rgba(220,80,70,.45)');
    });
  }

  function clear() { CACHE = {}; }

  GM.atlas = {
    terrain: terrain, terrainSample: terrainSample, terrainBlob: terrainBlob, dressing: dressing, edgeDressing: edgeDressing, biomeFeature: biomeFeature, forestProp: forestProp, biomeProp: biomeProp, landmark: landmark, node: node, stump: stump, trail: trail,
    building: building, handmadeBuilding: handmadeBuilding, buildingAnimation: buildingAnimation, buildingAspect: buildingAspect, site: site, fence: fence,
    scaled: scaled, dropScaled: dropScaled,
    /* ★ 6단계 계측 — 축소본 곳간에 지금 몇 장이 들어 있나(개발 패널·하니스가 읽는다).
       상한(512)에 붙어 있으면 그 판은 곳간이 모자란 판이다 — 절벽의 조짐을 숫자로 본다. */
    scaledSize: function () { return SCALED.size; },
    town: town, hall: hall, wagon: wagon, caravan: caravan, camp: camp, folk: folk,
    avatar: avatar, avatarPortrait: avatarPortrait, avatarImg: avatarImg,
    enemy: enemy, wild: wild, boss: boss, variantAt: variantAt, hash01: h2, clear: clear,
    palette: palette, styleOf: styleOf, appKey: appKey, styleOfBuilding: styleOfBuilding
  };
})(window);
