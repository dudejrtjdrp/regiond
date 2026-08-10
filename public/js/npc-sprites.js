/* npc-sprites.js — 주민과 직업을 고르기 전 개척자가 함께 쓰는 8방향 도트 */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  /* 0=S, 1=SW, 2=W, 3=NW, 4=N, 5=NE, 6=E, 7=SE */
  var DIRECTION = ['south', 'sw', 'west', 'nw', 'north', 'ne', 'east', 'se'];
  /* 원본마다 투명 캔버스 여백이 다르다. [x, y, width, height]는 9프레임 전체를 감싼 실제 도트 영역. */
  /* ★ 2026-08 최적화 — PNG 자체를 위 「실제 도트 영역」으로 잘라 굽고 0.55배로 줄였다.
     투명 여백이 90%였고(252² 중 실제는 60×134), 그 여백까지 브라우저가 낱장마다 디코드해
     GPU 로 올리고 있었다. 잘린 그림의 원본 높이(65~76px)는 최대 줌의 표시 높이(t*2 = 64px)보다
     여전히 크므로 **화질은 한 픽셀도 손해 보지 않는다**. 원본은 tools/opt_backup/player 에 있다.
     그래서 이제 잘라낼 것이 없다 — 각 칸은 그림 전체다. */
  var CROP = {
    male: [
      [0, 0, 27, 70], [0, 0, 31, 67], [0, 0, 24, 67], [0, 0, 28, 65],
      [0, 0, 29, 70], [0, 0, 28, 65], [0, 0, 31, 65], [0, 0, 29, 68]
    ],
    female: [
      [0, 0, 33, 74], [0, 0, 38, 76], [0, 0, 37, 70], [0, 0, 40, 68],
      [0, 0, 32, 70], [0, 0, 36, 74], [0, 0, 40, 69], [0, 0, 38, 73]
    ]
  };
  /* ★ 2026-08 최적화 — 방향마다 9프레임을 가로 한 줄(스트립)로 묶었다.
     낱장 144개는 그림 파일 144개 · GPU 텍스처 144개였고, 걷는 사람이 열이면 한 프레임에
     텍스처를 백 번 갈아 끼웠다. 이제 방향당 한 장이라 열여섯 장이면 끝난다.
     픽셀은 이어 붙였을 뿐 한 점도 달라지지 않았다. */
  var FRAME = {
    female: { south: [33, 74], sw: [38, 76], west: [37, 70], nw: [40, 68],
              north: [32, 70], ne: [36, 74], east: [40, 69], se: [38, 73] },
    male:   { south: [27, 70], sw: [31, 67], west: [24, 67], nw: [28, 65],
              north: [29, 70], ne: [28, 65], east: [31, 65], se: [29, 68] }
  };
  var images = {};

  function skinFor(id) {
    /* 성별 값이 없는 기존 저장본도 접속할 때마다 같은 모습으로 보이게 한다. */
    var text = String(id || 'npc');
    var hash = 0;
    for (var i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    return (hash & 1) ? 'female' : 'male';
  }

  function imageFor(key) {
    var image = images[key];
    if (!image) {
      image = new Image();
      image.src = 'assets/player/npc-walk-strip/' + key + '.png';
      images[key] = image;
    }
    return image;
  }

  function get(id, dir) {
    var skin = skinFor(id);
    var direction = DIRECTION[dir] || 'south';
    var image = imageFor(skin + '/' + direction);
    return image.complete && image.naturalWidth ? image : null;
  }

  /** 스트립 안에서 이 프레임이 앉은 칸. frame 을 안 주면 첫 칸(멈춰 선 모습)이다. */
  function cropFor(id, dir, frame) {
    var skin = skinFor(id);
    var direction = DIRECTION[dir] || 'south';
    var f = FRAME[skin][direction] || FRAME[skin].south;
    var no = ((frame | 0) % 9 + 9) % 9;
    return [no * f[0], 0, f[0], f[1]];
  }

  /* ★ 2026-08 — 「나」 칸의 얼굴. 역할을 맡기 전(감정의 날 이전)에는 초상 자리에 직업 얼굴을
     걸어서는 안 된다. 지도 위를 걷는 바로 그 NPC 도트의 **머리만** 잘라 세운다 —
     초상과 발밑의 도트가 같은 사람이라야 「나는 아직 아무것도 아니다」가 그대로 읽힌다. */
  function faceImg(id, px) {
    var size = px || 40;
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    cv.className = 'npc-face';
    cv.style.imageRendering = 'pixelated';
    var ctx = cv.getContext('2d');
    var crop = cropFor(id, 0, 0);
    var image = imageFor(skinFor(id) + '/south');
    function paint() {
      if (!image.complete || !image.naturalWidth) return;
      var side = crop[2] * 0.72;                      // 어깨는 버리고 머리만 담을 만큼
      var sx = crop[0] + (crop[2] - side) / 2;
      var sy = crop[1] - side * 0.04;                 // 정수리가 잘리지 않게 한 뼘 위에서
      ctx.clearRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = false;
      try { ctx.drawImage(image, sx, sy, side, side, 0, 0, size, size); } catch (e) {}
    }
    if (image.complete) paint(); else image.addEventListener('load', paint);
    return cv;
  }

  function preload() {
    ['male', 'female'].forEach(function (skin) {
      DIRECTION.forEach(function (direction) { imageFor(skin + '/' + direction); });
    });
  }

  preload();
  GM.npcSprites = { get: get, cropFor: cropFor, skinFor: skinFor, faceImg: faceImg };
})(window);
