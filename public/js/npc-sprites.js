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

  function preload() {
    ['male', 'female'].forEach(function (skin) {
      DIRECTION.forEach(function (direction) {
        for (var frame = 1; frame <= 9; frame++) imageFor(skin + '/' + direction + '/' + String(frame).padStart(2, '0'));
      });
    });
  }

  preload();
  GM.npcSprites = { get: get, cropFor: cropFor, skinFor: skinFor };
})(window);
