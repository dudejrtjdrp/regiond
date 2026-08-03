/* camera.js — 월드 카메라. 화면 중앙이 보는 좌표(cx, cy)와 한 칸의 크기(tile)를 들고 있다.
   조작: WASD/방향키, 화면 가장자리, 미니맵 클릭, 휠 줌(16·24·32). 값은 전부 부드럽게 보간된다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var U = GM.ui;

  var STEPS = [16, 24, 32];

  var cam = {
    cx: 64, cy: 64,          // 지금 보고 있는 칸 (보간값)
    tx: 64, ty: 64,          // 목표 칸
    zoom: 1,                 // STEPS 인덱스
    tile: STEPS[1],          // 지금 한 칸 크기 (보간값)
    tileTarget: STEPS[1],
    w: 960, h: 540,
    edgePan: true
  };

  function size() { return GM.state.mapSize(); }

  function setViewport(w, h) { cam.w = Math.max(64, w); cam.h = Math.max(64, h); }

  function clampTarget() {
    var n = size();
    var halfW = cam.w / (2 * cam.tileTarget);
    var halfH = cam.h / (2 * cam.tileTarget);
    var minX = Math.min(n / 2, halfW - 2), maxX = Math.max(n / 2, n - halfW + 2);
    var minY = Math.min(n / 2, halfH - 2), maxY = Math.max(n / 2, n - halfH + 2);
    cam.tx = U.clamp(cam.tx, minX, maxX);
    cam.ty = U.clamp(cam.ty, minY, maxY);
  }

  function moveTo(x, y, instant) {
    cam.tx = x; cam.ty = y;
    clampTarget();
    if (instant) { cam.cx = cam.tx; cam.cy = cam.ty; }
  }
  function pan(dx, dy) { cam.tx += dx; cam.ty += dy; clampTarget(); }

  function setZoom(i, anchor) {
    var next = U.clamp(Math.round(i), 0, STEPS.length - 1);
    if (next === cam.zoom) return;
    var before = anchor ? screenToWorld(anchor.x, anchor.y) : null;
    cam.zoom = next;
    cam.tileTarget = STEPS[next];
    if (before) {
      // 커서 아래의 칸이 제자리에 남도록 중심을 민다
      var after = screenToWorldWith(anchor.x, anchor.y, cam.tileTarget, cam.tx, cam.ty);
      cam.tx += before.x - after.x;
      cam.ty += before.y - after.y;
    }
    clampTarget();
  }
  function zoomBy(d, anchor) { setZoom(cam.zoom + d, anchor); }

  function worldToScreen(wx, wy) {
    return { x: (wx - cam.cx) * cam.tile + cam.w / 2, y: (wy - cam.cy) * cam.tile + cam.h / 2 };
  }
  function screenToWorld(sx, sy) { return screenToWorldWith(sx, sy, cam.tile, cam.cx, cam.cy); }
  function screenToWorldWith(sx, sy, tile, cx, cy) {
    return { x: (sx - cam.w / 2) / tile + cx, y: (sy - cam.h / 2) / tile + cy };
  }
  function screenToTile(sx, sy) {
    var w = screenToWorld(sx, sy);
    return { x: Math.floor(w.x + 0.5), y: Math.floor(w.y + 0.5) };
  }

  /** 화면에 보이는 칸 범위 (여유 1칸) */
  function visible() {
    var n = size();
    var halfW = cam.w / (2 * cam.tile), halfH = cam.h / (2 * cam.tile);
    return {
      x0: Math.max(0, Math.floor(cam.cx - halfW) - 1),
      y0: Math.max(0, Math.floor(cam.cy - halfH) - 1),
      x1: Math.min(n - 1, Math.ceil(cam.cx + halfW) + 1),
      y1: Math.min(n - 1, Math.ceil(cam.cy + halfH) + 1)
    };
  }

  function onScreen(wx, wy, margin) {
    var p = worldToScreen(wx, wy);
    var m = margin === undefined ? 40 : margin;
    return p.x > -m && p.y > -m && p.x < cam.w + m && p.y < cam.h + m;
  }

  /** 고정 스텝 보간 — dt 는 초 */
  function update(dt) {
    var k = 1 - Math.pow(0.0016, Math.min(0.1, dt));
    cam.cx += (cam.tx - cam.cx) * k;
    cam.cy += (cam.ty - cam.cy) * k;
    cam.tile += (cam.tileTarget - cam.tile) * k;
    if (Math.abs(cam.tile - cam.tileTarget) < 0.05) cam.tile = cam.tileTarget;
    if (Math.abs(cam.cx - cam.tx) < 0.002) cam.cx = cam.tx;
    if (Math.abs(cam.cy - cam.ty) < 0.002) cam.cy = cam.ty;
  }

  function reset(x, y) {
    cam.zoom = 1; cam.tileTarget = STEPS[1]; cam.tile = STEPS[1];
    cam.cx = cam.tx = x === undefined ? size() / 2 : x;
    cam.cy = cam.ty = y === undefined ? size() / 2 : y;
    clampTarget();
    cam.cx = cam.tx; cam.cy = cam.ty;
  }

  GM.camera = {
    cam: cam, STEPS: STEPS,
    setViewport: setViewport, moveTo: moveTo, pan: pan,
    setZoom: setZoom, zoomBy: zoomBy,
    worldToScreen: worldToScreen, screenToWorld: screenToWorld, screenToTile: screenToTile,
    visible: visible, onScreen: onScreen, update: update, reset: reset,
    tile: function () { return cam.tile; }
  };
})(window);
