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
      image.src = 'assets/player/role-walk-strip/' + key + '.png';
      images[key] = image;
    }
    return image;
  }

  function ready(image) { return image.complete && image.naturalWidth; }

  /* ★ 2026-08 최적화 — 방향마다 9프레임을 가로 한 줄로 묶었다(432장 → 48장).
     한 칸은 79×74 로 모든 직업이 같다. world.js 가 frame 으로 칸을 고른다. */
  function get(role, dir) {
    var skin = ROLE_SKIN[role];
    if (!skin) return null;
    var direction = DIRECTION[dir] || 'south';
    var key = skin + '/' + direction;
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
      DIRECTION.forEach(function (direction) { imageFor(skin + '/' + direction); });
    });
  }

  /** 스트립 안에서 이 프레임이 앉은 칸. 모든 직업·방향이 79×74 로 같다. */
  function cropFor(frame) {
    var no = ((frame | 0) % 9 + 9) % 9;
    return [no * 79, 0, 79, 74];
  }

  preload();
  GM.roleSprites = { get: get, cropFor: cropFor };
})(window);
