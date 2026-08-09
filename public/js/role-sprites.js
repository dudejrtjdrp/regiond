/* role-sprites.js — 관제 직업 확정 뒤에만 쓰는 외부 도트 워크 프레임. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var ROLE_SKIN = {
    farm: 'mage', factory: 'tank', build: 'warrior',
    defense: 'archer', trade: 'tactician', saint: 'saint'
  };
  /* 0=S, 1=SW, 2=W, 3=NW, 4=N, 5=NE, 6=E, 7=SE */
  var DIRECTION = ['south', 'sw', 'west', 'nw', 'north', 'ne', 'east', 'se'];
  var images = {};

  function imageFor(key) {
    var image = images[key];
    if (!image) {
      image = new Image();
      image.src = 'assets/player/role-walk/' + key + '.png';
      images[key] = image;
    }
    return image;
  }

  function ready(image) { return image.complete && image.naturalWidth; }

  function get(role, dir, frame) {
    var skin = ROLE_SKIN[role];
    if (!skin) return null;
    var direction = DIRECTION[dir] || 'south';
    var no = String((frame % 9) + 1).padStart(2, '0');
    var key = skin + '/' + direction + '/' + no;
    var image = imageFor(key);
    if (ready(image)) return image;
    /* 다음 프레임이 도착하기 전에도 주민 스프라이트로 되돌아가지 않게 한다. */
    for (var candidate in images) {
      if (candidate.indexOf(skin + '/') === 0 && ready(images[candidate])) return images[candidate];
    }
    return null;
  }

  function preload() {
    Object.keys(ROLE_SKIN).forEach(function (role) {
      var skin = ROLE_SKIN[role];
      DIRECTION.forEach(function (direction) {
        for (var frame = 1; frame <= 9; frame++) {
          imageFor(skin + '/' + direction + '/' + String(frame).padStart(2, '0'));
        }
      });
    });
  }

  preload();
  GM.roleSprites = { get: get };
})(window);
