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
    var key = 't:' + code + ':' + variant;
    var def = TERRA[code] || TERRA.grass;
    return cached(key, 16, 16, function (P) {
      P(0, 0, 16, 16, def.base);
      var r = U.rngFrom(code + variant);
      for (var i = 0; i < 12; i++) {
        var x = Math.floor(r() * 16), y = Math.floor(r() * 16);
        P(x, y, 2, 1, def.dots[Math.floor(r() * def.dots.length)]);
      }
      if (MARK[code]) MARK[code](P);
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
      P(6, 7, 4, 4, ink); P(7, 8, 2, 2, faded ? '#8f8878' : '#d8c98f');
    });
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
    terrain: terrain, node: node, stump: stump, trail: trail, building: building, site: site, fence: fence,
    town: town, hall: hall, wagon: wagon, caravan: caravan, camp: camp, folk: folk,
    avatar: avatar, avatarPortrait: avatarPortrait, avatarImg: avatarImg,
    enemy: enemy, wild: wild, variantAt: variantAt, hash01: h2, clear: clear,
    palette: palette, styleOf: styleOf, appKey: appKey, styleOfBuilding: styleOfBuilding
  };
})(window);
