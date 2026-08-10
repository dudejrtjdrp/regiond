/* action-sprites.js — 8방향 행동 시트: 각 행은 방향, 열 두 칸씩 공격·벌목·채광·수확 */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  /* ★ 걷기(role-sprites.js)와 반드시 같은 스킨이어야 한 사람으로 보인다.
     예전 표는 한 칸씩 밀려 있어서, 걷다가 도끼를 들면 다른 캐릭터가 튀어나왔다. */
  var ROLE_SKIN = {
    farm: 'mage', factory: 'tank', build: 'warrior',
    defense: 'archer', trade: 'tactician', saint: 'saint'
  };
  /* 원본 PixelLab 시트는 캐릭터마다 6~8행으로 제각각이라 그대로는 방향을 못 읽는다.
     tools/pack_action_sheets.py 로 8행(게임 방향 순서) × 8열 균일 격자로 다시 구웠다.
     행 = 0:남 1:남서 2:서 3:북서 4:북 5:북동 6:동 7:남동, 열 = 공격·벌목·채광·수확 × 2프레임. */
  var SOURCE = {
    female: 'female', male: 'male', archer: 'archer', mage: 'mage',
    saint: 'saint', warrior: 'warrior', tactician: 'tactician', tank: 'tank'
  };
  var VERSION = 'action-8dir-v9';
  var images = {};
  var crops = {};

  function imageFor(skin) {
    if (!images[skin]) {
      images[skin] = new Image();
      images[skin].src = 'assets/player/action-8dir/' + skin + '.png?v=' + VERSION;
    }
    return images[skin];
  }

  function skinFor(role, id) {
    return ROLE_SKIN[role] || (GM.npcSprites && GM.npcSprites.skinFor(id)) || 'male';
  }

  /* 프레임 밖으로는 절대 넓히지 않는다. 칸마다 전신 하나만 들어 있으므로,
     이 경계 안에서 실제 도트가 찬 범위만 잘라 쓴다. */
  function frameCrop(image, key, sx, sy, sw, sh) {
    if (crops[key]) return crops[key];
    var canvas = document.createElement('canvas');
    canvas.width = sw; canvas.height = sh;
    var c = canvas.getContext('2d');
    c.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
    var data = c.getImageData(0, 0, sw, sh).data;
    var x0 = sw, y0 = sh, x1 = 0, y1 = 0;
    for (var i = 0; i < sw * sh; i++) {
      if (data[i * 4 + 3] < 24) continue;
      var x = i % sw, y = (i / sw) | 0;
      if (x < x0) x0 = x; if (y < y0) y0 = y;
      if (x + 1 > x1) x1 = x + 1; if (y + 1 > y1) y1 = y + 1;
    }
    if (x1 <= x0 || y1 <= y0) return (crops[key] = { x: sx, y: sy, w: sw, h: sh });
    /* 아주 가는 무기·불꽃 끝이 잘리지 않도록 두 픽셀을 남긴다. */
    var px0 = Math.max(0, x0 - 2), py0 = Math.max(0, y0 - 2);
    var px1 = Math.min(sw, x1 + 2), py1 = Math.min(sh, y1 + 2);
    return (crops[key] = { x: sx + px0, y: sy + py0, w: px1 - px0, h: py1 - py0 });
  }

  function get(role, id, dir, kind, phase) {
    var skin = skinFor(role, id);
    var source = SOURCE[skin];
    if (!source) return null;
    var image = imageFor(source);
    if (!image.complete || !image.naturalWidth) return null;
    var col = ({ attack: 0, wood: 2, stone: 4, grain: 6 }[kind] || 0) + ((phase || 0) % 2);
    var row = ((dir % 8) + 8) % 8;
    /* 전체 픽셀 수가 8로 딱 나누어지지 않아도, 반올림 경계로 모든 칸을 빈틈 없이 읽는다. */
    var x0 = Math.round(col * image.naturalWidth / 8), x1 = Math.round((col + 1) * image.naturalWidth / 8);
    var y0 = Math.round(row * image.naturalHeight / 8), y1 = Math.round((row + 1) * image.naturalHeight / 8);
    var crop = frameCrop(image, source + ':' + row + ':' + col, x0, y0, x1 - x0, y1 - y0);
    /* 여덟 장 모두 같은 규격으로 다시 구웠으므로, 폭은 프레임 실제 비율로 통일한다.
       걷기 PNG 폭에 억지로 맞추던 npcSized 예외는 더 필요 없다. */
    return { image: image, sx: crop.x, sy: crop.y, sw: crop.w, sh: crop.h, action: true };
  }

  Object.keys(SOURCE).forEach(function (skin) { imageFor(SOURCE[skin]); });
  GM.actionSprites = { get: get };
})(window);
