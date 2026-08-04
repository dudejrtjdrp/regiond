/* atlas.js — 도트 스프라이트 절차 생성기. 외부 이미지 파일은 하나도 쓰지 않는다.
   16×16(지형·자원) / 24×24(건물) / 16×20(사람) 격자에 사각형만으로 그려
   오프스크린 캔버스에 한 번 캐시하고, 렌더러가 drawImage 로 확대해 쓴다.
   ★ v3 — 건물 33종·울타리 조각·그루터기·마차·적 6종이 여기서 나온다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var U = GM.ui;

  var CACHE = {};

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
    fertile: { base: '#9c8341', dots: ['#ae944e', '#8a7238', '#bda45b'] }
  };

  function terrain(code, variant) {
    var key = 't:' + code + ':' + variant;
    var def = TERRA[code] || TERRA.grass;
    return cached(key, 16, 16, function (P) {
      P(0, 0, 16, 16, def.base);
      var r = U.rngFrom(code + variant);
      for (var i = 0; i < 12; i++) {
        var x = Math.floor(r() * 16), y = Math.floor(r() * 16);
        P(x, y, 2, 1, def.dots[Math.floor(r() * def.dots.length)]);
      }
      if (code === 'forest') {
        P(4, 5, 3, 6, '#2f4d27'); P(9, 3, 3, 7, '#2f4d27');
        P(3, 3, 5, 4, '#5f8a4c'); P(8, 1, 5, 4, '#5f8a4c');
      }
      if (code === 'rock') {
        P(3, 8, 6, 5, '#6f6a5e'); P(3, 8, 6, 1, '#b0aa9c');
        P(9, 4, 4, 4, '#6f6a5e'); P(9, 4, 4, 1, '#b0aa9c');
      }
      if (code === 'water') { P(2, 5, 6, 1, '#78aed6'); P(9, 10, 5, 1, '#78aed6'); }
      if (code === 'fertile') { for (var k = 1; k < 16; k += 4) P(0, k, 16, 1, '#8a7238'); }
    });
  }

  /* ══════════ 자원 자리 ══════════ */
  var FIELD_STAGE = { sown: 0, sprout: 1, grow: 2, ripe: 3 };

  function node(type, opts) {
    opts = opts || {};
    var stage = opts.stage || null;
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
    /* 군사 */
    watchpost:   { wall: '#a3703f', roof: '#6b4526', shape: 'tower', mark: 'eye' },
    arrow_tower: { wall: '#a3703f', roof: '#8a5e33', shape: 'tower', mark: 'arrow' },
    barracks:    { wall: '#c07a78', roof: '#7d2a2c', shape: 'gable', mark: 'sword' },
    ballista:    { wall: '#8b9fb0', roof: '#6b4526', shape: 'engine', mark: 'bolt' },
    cannon:      { wall: '#5e646c', roof: '#3b4148', shape: 'engine', mark: 'barrel' },
    /* 발전 */
    campfire:    { wall: '#6b4526', roof: '#e08541', shape: 'fire',  mark: null },
    trading_post: { wall: '#cdb283', roof: '#8a5e33', shape: 'gable', mark: 'ship' },
    market:      { wall: '#e0c89a', roof: '#bc4749', shape: 'stall', mark: 'awning' },
    shrine:      { wall: '#c3b0de', roof: '#6f5aa8', shape: 'gable', mark: 'holy' },
    consulate:   { wall: '#9db6d8', roof: '#3a5580', shape: 'gable', mark: 'flag' },
    monument:    { wall: '#dcd6c4', roof: '#b0a894', shape: 'obelisk', mark: null },
    /* 장식 */
    lamp:        { wall: '#6b4526', roof: '#e8a33d', shape: 'lamp',  mark: null },
    banner:      { wall: '#6b4526', roof: '#bc4749', shape: 'banner', mark: null },
    garden:      { wall: '#6a994e', roof: '#bc4749', shape: 'garden', mark: null },
    fountain:    { wall: '#c4cad2', roof: '#4a7fa8', shape: 'fountain', mark: null }
  };
  var DEFAULT_STYLE = { wall: '#c8a874', roof: '#8a5e33', shape: 'gable', mark: null };

  function styleOfBuilding(key) { return STYLE[key] || DEFAULT_STYLE; }

  function building(key, tier, opts) {
    opts = opts || {};
    var t = Math.max(1, Math.min(4, tier || 1));
    var ruined = opts.ruined ? 1 : 0;
    var ck = 'b:' + key + ':' + t + ':' + ruined;
    return cached(ck, 24, 24, function (P) {
      var st = styleOfBuilding(key);
      var wall = ruined ? U.mix(st.wall, '#4a4038', 0.55) : st.wall;
      var roof = ruined ? U.mix(st.roof, '#3a3028', 0.55) : st.roof;
      var dark = '#4a3220';
      var grow = (t - 1);

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
          return;
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
          return;
        }
        case 'crate': {
          P(4, 12, 16, 10, wall); P(4, 12, 16, 1, U.shade(wall, 0.3));
          P(4, 21, 16, 2, U.shade(wall, -0.3));
          P(4, 16, 16, 2, roof); P(11, 12, 2, 10, roof);
          if (t >= 2) { P(6, 6, 12, 6, wall); P(6, 6, 12, 1, U.shade(wall, 0.3)); P(6, 9, 12, 1, roof); }
          return;
        }
        case 'well': {
          P(6, 14, 12, 8, wall); P(6, 14, 12, 1, U.shade(wall, 0.35));
          P(8, 16, 8, 5, '#2b3a4a');
          P(5, 4, 2, 11, '#6b4526'); P(17, 4, 2, 11, '#6b4526');
          P(3, 2, 18, 3, roof); P(3, 2, 18, 1, U.shade(roof, 0.3));
          P(11, 6, 2, 4, '#8a5e33');
          return;
        }
        case 'pile': {
          P(2, 15, 20, 7, wall); P(2, 15, 20, 1, U.shade(wall, 0.28));
          for (var w = 3; w < 21; w += 4) P(w, 16, 2, 5, U.shade(wall, -0.25));
          if (t >= 2) { P(4, 9, 16, 6, wall); for (var w2 = 5; w2 < 19; w2 += 4) P(w2, 10, 2, 4, U.shade(wall, -0.25)); }
          if (t >= 3) { P(7, 4, 10, 5, wall); }
          return;
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
        case 'ship':     P(4, 3, 6, 5, '#f4e4bc'); P(3, 8, 9, 2, '#8a5e33'); break;
        case 'awning':   P(2, 2, 20, 2, '#bc4749'); break;
        case 'holy':     P(11, 0, 2, 5, '#f6e6a8'); P(9, 1, 6, 2, '#f6e6a8'); break;
        case 'flag':     P(4, 0, 2, 8, '#6b4526'); P(6, 1, 6, 4, '#4a6fa5'); break;
        case 'flap':     P(3, 3, 4, 3, '#bc4749'); break;
        default: break;
      }
      if (ruined) {
        P(2, 2, 4, 2, '#3a3028'); P(17, 5, 5, 2, '#3a3028');
        P(6, 8, 3, 2, '#3a3028'); P(13, 12, 4, 2, '#3a3028');
      }
    });
  }

  /** 건설 현장 — 진행도 4단계 */
  function site(progress) {
    var p = Math.round(Math.max(0, Math.min(1, progress || 0)) * 3);
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
  function fence(opts) {
    opts = opts || {};
    var vertical = opts.vertical ? 1 : 0;
    var tier = opts.tier === 2 ? 2 : 1;
    var gate = opts.gate ? 1 : 0;
    var dmg = opts.damage || 0;                 // 0 온전 · 1 상함 · 2 부서짐
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
    var key = 'a:' + appKey(app) + ':' + dir + ':' + frame + ':' + crown + ':' + sw + ':' + (tool || '-');
    var skin = palette('skin', app.skin, '#f5d6b8');
    var hairC = palette('hairColor', app.hairColor, '#3b2a1d');
    var outC = palette('outfitColor', app.outfitColor, '#6a994e');
    var hairS = styleOf('hair', app.hair, 'short');
    var outS = styleOf('outfit', app.outfit, 'tunic');
    return cached(key, 16, 20, function (P) {
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
      /* 도구 — 손에 든 것 */
      if (tool) {
        var tx = sw === 1 ? 13 : (sw === 2 ? 14 : 13);
        var ty = sw === 1 ? bodyTop - 7 : (sw === 2 ? bodyTop + 4 : bodyTop);
        var head = tool === 'sword' ? '#c6d6e2' : (tool === 'hoe' ? '#8b9fb0' : '#8b9fb0');
        if (tool === 'sword') { P(tx, ty - 5, 1, 8, head); P(tx - 1, ty + 3, 3, 1, '#a8701f'); }
        else { P(tx, ty - 4, 1, 7, '#8a5e33'); P(tx - 2, ty - 5, 4, 3, head); }
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

  /* ══════════ 적 유닛 6종 ══════════ */
  function enemy(type, frame) {
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
      var col = type === 'viking' ? '#6b7580' : (type === 'pirate' ? '#5a4038' : '#7a5a48');
      P(3, 12 + bob, 2, 4 - bob, '#2b2118');
      P(8, 12, 2, 4, '#2b2118');
      P(2, 6 + bob, 9, 7, col); P(2, 6 + bob, 9, 1, U.shade(col, 0.3));
      P(3, 1 + bob, 7, 5, '#c8a184');
      P(4, 3 + bob, 1, 2, '#1a1008'); P(8, 3 + bob, 1, 2, '#1a1008');
      if (type === 'viking') { P(1, 0 + bob, 2, 3, '#f0e6d2'); P(10, 0 + bob, 2, 3, '#f0e6d2'); P(3, 0 + bob, 7, 2, '#8b9fb0'); }
      if (type === 'pirate') { P(2, 0 + bob, 9, 2, '#7d2a2c'); P(7, 3 + bob, 3, 1, '#1a1008'); }
      if (type === 'bandit') { P(3, 3 + bob, 7, 1, '#3a3028'); P(2, 0 + bob, 9, 2, '#5c4438'); }
      P(11, 3 + bob, 2, 9, '#8b9fb0'); P(11, 3 + bob, 2, 1, '#c6d6e2');
    });
  }

  function clear() { CACHE = {}; }

  GM.atlas = {
    terrain: terrain, node: node, stump: stump, building: building, site: site, fence: fence,
    town: town, hall: hall, wagon: wagon, caravan: caravan, camp: camp, folk: folk,
    avatar: avatar, avatarPortrait: avatarPortrait, avatarImg: avatarImg,
    enemy: enemy, variantAt: variantAt, hash01: h2, clear: clear,
    palette: palette, styleOf: styleOf, appKey: appKey, styleOfBuilding: styleOfBuilding
  };
})(window);
