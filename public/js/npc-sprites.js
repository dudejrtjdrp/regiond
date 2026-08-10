/* npc-sprites.js — 주민과 직업을 고르기 전 개척자가 함께 쓰는 8방향 도트 */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  /* 0=S, 1=SW, 2=W, 3=NW, 4=N, 5=NE, 6=E, 7=SE */
  var DIRECTION = ['south', 'sw', 'west', 'nw', 'north', 'ne', 'east', 'se'];
  /* 원본마다 투명 캔버스 여백이 다르다. [x, y, width, height]는 9프레임 전체를 감싼 실제 도트 영역. */
  var CROP = {
    male: [
      [98, 59, 49, 128], [93, 64, 56, 122], [14, 4, 43, 121], [38, 5, 51, 118],
      [96, 56, 53, 128], [37, 5, 51, 118], [37, 5, 57, 119], [36, 5, 53, 123]
    ],
    female: [
      [96, 60, 60, 134], [91, 62, 70, 138], [91, 63, 67, 127], [90, 67, 72, 123],
      [97, 61, 58, 127], [94, 59, 65, 135], [92, 63, 72, 126], [93, 62, 70, 133]
    ]
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
      image.src = 'assets/player/npc-walk/' + key + '.png';
      images[key] = image;
    }
    return image;
  }

  function get(id, dir, frame) {
    var skin = skinFor(id);
    var direction = DIRECTION[dir] || 'south';
    var no = String((frame % 9) + 1).padStart(2, '0');
    var image = imageFor(skin + '/' + direction + '/' + no);
    return image.complete && image.naturalWidth ? image : null;
  }

  function cropFor(id, dir) {
    var skin = skinFor(id);
    return CROP[skin][dir] || CROP[skin][0];
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
    var crop = cropFor(id, 0);
    var image = imageFor(skinFor(id) + '/south/01');
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
      DIRECTION.forEach(function (direction) {
        for (var frame = 1; frame <= 9; frame++) imageFor(skin + '/' + direction + '/' + String(frame).padStart(2, '0'));
      });
    });
  }

  preload();
  GM.npcSprites = { get: get, cropFor: cropFor, skinFor: skinFor, faceImg: faceImg };
})(window);
