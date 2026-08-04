/* icons.js — 도트 아이콘 시스템
   16×16 격자에 사각형만으로 한 번 그려서 dataURL 로 캐시하고, 어디서나 <img> 로 재사용한다.
   목적: 텍스트 라벨 의존을 줄이고 화면을 "게임"처럼 보이게 만든다. 이미지 파일은 쓰지 않는다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var U = GM.ui;

  var CACHE = {};
  /* 캔버스가 없는 환경(테스트 하니스)에서도 안전하게 쓰도록 투명 1×1 폴백을 둔다 */
  var BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  /* ── 팔레트 ─────────────────────────────────────────── */
  var C = {
    ink: '#3b2318', dark: '#2b1a12', wood: '#5d4037', woodL: '#8d6e63',
    paper: '#f4e4bc', paperL: '#fdf3d8',
    gold: '#e8a33d', goldL: '#f6cf7a', goldD: '#a8701f',
    green: '#6a994e', greenL: '#8dbb6d', greenD: '#3f6130',
    red: '#bc4749', redL: '#d9706f', redD: '#7d2a2c',
    blue: '#4a6fa5', blueL: '#7b9bc9', violet: '#8367a8', violetL: '#b39ad6',
    grey: '#9aa0a8', greyL: '#c4cad2', greyD: '#5e646c',
    skin: '#e6b892', skinD: '#c08f64',
    white: '#fdf8ec', black: '#1a1008'
  };

  /* ── 개별 아이콘 (16×16 논리 격자, P(x,y,w,h,color)) ── */
  var DRAW = {
    grain: function (P) {                      // 곡물 — 밀 이삭
      P(7, 3, 2, 11, '#b98d3a');
      [3, 5, 7, 9].forEach(function (y, i) {
        P(4 + (i % 2), y, 3, 2, '#e0c65a'); P(9, y, 3, 2, '#e0c65a');
        P(4 + (i % 2), y, 3, 1, '#f2dc84');
      });
      P(6, 1, 4, 2, '#f2dc84');
    },
    wood: function (P) {                       // 목재 — 통나무 두 개
      P(1, 5, 14, 5, '#a3703f'); P(1, 5, 14, 1, '#c08a52');
      P(1, 10, 10, 4, '#8a5e33'); P(1, 10, 10, 1, '#a3703f');
      P(11, 6, 3, 3, '#6b4526'); P(12, 7, 1, 1, '#c08a52');
      P(7, 11, 3, 2, '#5c3b20');
    },
    stone: function (P) {                      // 석재 — 다듬은 돌 무더기
      P(2, 7, 6, 6, '#9aa0a8'); P(2, 7, 6, 1, '#c4cad2');
      P(8, 9, 6, 4, '#8a9098'); P(8, 9, 6, 1, '#b4bac2');
      P(6, 3, 5, 4, '#a8aeb6'); P(6, 3, 5, 1, '#cdd3db');
      P(3, 10, 2, 1, '#5e646c'); P(10, 11, 2, 1, '#5e646c');
    },
    ironOre: function (P) {                    // 철광석 — 돌에 박힌 붉은 광맥
      P(2, 6, 12, 8, '#7e848c'); P(2, 6, 12, 1, '#a4aab2');
      P(4, 4, 7, 3, '#8a9098');
      P(5, 8, 3, 2, '#b07050'); P(9, 10, 3, 2, '#b07050');
      P(6, 8, 1, 1, '#d99b78'); P(10, 10, 1, 1, '#d99b78');
    },
    oil: function (P) {                        // 원유 — 검보라 방울
      P(6, 2, 4, 3, '#8a76bc');
      P(4, 5, 8, 4, '#6f5aa8'); P(3, 8, 10, 5, '#5a4890');
      P(5, 12, 6, 2, '#4a3a78');
      P(6, 6, 2, 2, '#a493d6');
    },
    steel: function (P) {                      // 강재 — 잉곳 두 장
      P(3, 8, 11, 4, '#8b9fb0'); P(3, 8, 11, 1, '#c6d6e2');
      P(2, 5, 10, 3, '#a8bccc'); P(2, 5, 10, 1, '#d6e4ee');
      P(4, 12, 8, 1, '#5e6e7c');
    },
    fuel: function (P) {                       // 연료 — 불꽃
      P(7, 1, 2, 3, '#f6d27a');
      P(5, 4, 6, 4, '#e08541'); P(6, 4, 4, 2, '#f2b06a');
      P(4, 7, 8, 5, '#d96a2c'); P(6, 9, 4, 3, '#f6d27a');
      P(5, 12, 6, 2, '#a84a18');
    },
    coin: function (P) {                       // 골드 — 금화 더미
      P(4, 9, 9, 4, '#a8701f'); P(4, 9, 9, 1, '#e8a33d');
      P(3, 3, 9, 6, '#e8a33d'); P(3, 3, 9, 1, '#f6cf7a'); P(3, 8, 9, 1, '#a8701f');
      P(6, 5, 3, 2, '#a8701f');
    },
    folk: function (P) {                       // 백성 — 작은 사람
      P(6, 2, 4, 4, '#e6b892'); P(6, 2, 4, 1, '#3b2318');
      P(6, 5, 1, 1, '#3b2318'); P(9, 5, 1, 1, '#3b2318');
      P(5, 7, 6, 5, '#6a994e'); P(5, 7, 6, 1, '#8dbb6d');
      P(4, 8, 1, 3, '#e6b892'); P(11, 8, 1, 3, '#e6b892');
      P(6, 12, 2, 3, '#4a3a2a'); P(9, 12, 2, 3, '#4a3a2a');
    },
    morale: function (P) {                     // 사기 — 하트
      P(3, 4, 4, 3, '#d79ad6'); P(9, 4, 4, 3, '#d79ad6');
      P(2, 6, 12, 3, '#c485c3'); P(4, 9, 8, 2, '#c485c3');
      P(6, 11, 4, 2, '#a866a7'); P(4, 5, 2, 1, '#f0c4ef');
    },
    /* 침공 */
    pirate: function (P) {                     // 해적 — 해골
      P(4, 2, 8, 7, '#f0e6d2'); P(4, 2, 8, 1, '#fdf8ec');
      P(5, 5, 2, 2, '#1a1008'); P(9, 5, 2, 2, '#1a1008');
      P(7, 7, 2, 2, '#c8bda4');
      P(5, 10, 6, 2, '#f0e6d2');
      P(6, 12, 1, 2, '#1a1008'); P(9, 12, 1, 2, '#1a1008');
    },
    viking: function (P) {                     // 바이킹 — 뿔투구
      P(4, 5, 8, 6, '#8b9fb0'); P(4, 5, 8, 1, '#c6d6e2');
      P(7, 5, 2, 6, '#5e6e7c');
      P(1, 2, 3, 4, '#f0e6d2'); P(1, 2, 3, 1, '#fdf8ec');
      P(12, 2, 3, 4, '#f0e6d2'); P(12, 2, 3, 1, '#fdf8ec');
      P(4, 11, 8, 2, '#bc4749');
    },
    dragon: function (P) {                     // 드래곤 — 머리와 뿔
      P(3, 5, 10, 6, '#6a994e'); P(3, 5, 10, 1, '#8dbb6d');
      P(11, 7, 4, 3, '#5b8642');
      P(4, 2, 2, 4, '#3f6130'); P(8, 1, 2, 5, '#3f6130');
      P(5, 7, 2, 2, '#e8a33d'); P(6, 8, 1, 1, '#1a1008');
      P(13, 9, 2, 1, '#bc4749'); P(3, 11, 8, 2, '#4a7040');
    },
    /* 계절 */
    sprout: function (P) {
      P(7, 6, 2, 8, '#6a994e');
      P(2, 4, 5, 3, '#8dbb6d'); P(9, 3, 5, 3, '#8dbb6d');
      P(3, 4, 3, 1, '#b4d69a'); P(10, 3, 3, 1, '#b4d69a');
      P(4, 13, 8, 2, '#8a6a3a');
    },
    sun: function (P) {
      P(5, 5, 6, 6, '#e8a33d'); P(5, 5, 6, 1, '#f6cf7a');
      P(7, 1, 2, 3, '#f6cf7a'); P(7, 12, 2, 3, '#f6cf7a');
      P(1, 7, 3, 2, '#f6cf7a'); P(12, 7, 3, 2, '#f6cf7a');
      P(2, 2, 2, 2, '#f6cf7a'); P(12, 2, 2, 2, '#f6cf7a');
      P(2, 12, 2, 2, '#f6cf7a'); P(12, 12, 2, 2, '#f6cf7a');
    },
    leaf: function (P) {
      P(3, 3, 9, 3, '#e08541'); P(2, 6, 11, 4, '#d96a2c');
      P(4, 10, 8, 3, '#bc4749'); P(7, 4, 2, 9, '#8a4a18');
      P(4, 4, 3, 1, '#f2b06a');
    },
    moon: function (P) {
      P(5, 2, 7, 12, '#f6e6a8'); P(3, 5, 4, 6, '#f6e6a8');
      P(8, 3, 6, 10, '#1b2340'); P(9, 5, 3, 3, '#0f1428');
      P(2, 3, 2, 2, '#f6cf7a'); P(13, 12, 2, 2, '#f6cf7a');
    },
    /* 기물 */
    sheep: function (P) {                      // ★ §14-4 목장 — 울 안의 짐승
      P(3, 6, 9, 6, '#f2ece0'); P(3, 6, 9, 2, '#fdfaf3');
      P(2, 7, 2, 3, '#e2d9c8'); P(11, 7, 3, 4, '#e2d9c8');
      P(10, 4, 4, 4, '#3b3128'); P(12, 5, 1, 1, '#f6e6a8');
      P(4, 12, 2, 2, '#6b5a48'); P(9, 12, 2, 2, '#6b5a48');
    },
    gear: function (P) {                       // ★ §14-2 설정 — 톱니
      P(6, 1, 4, 2, '#9aa4ae'); P(6, 13, 4, 2, '#9aa4ae');
      P(1, 6, 2, 4, '#9aa4ae'); P(13, 6, 2, 4, '#9aa4ae');
      P(3, 3, 3, 3, '#8b949e'); P(10, 3, 3, 3, '#8b949e');
      P(3, 10, 3, 3, '#8b949e'); P(10, 10, 3, 3, '#8b949e');
      P(4, 4, 8, 8, '#c6d0da'); P(4, 4, 8, 1, '#e2e8ee');
      P(6, 6, 4, 4, '#3b4148');
    },
    scroll: function (P) {                     // 국법 — 두루마리
      P(3, 2, 10, 12, '#f4e4bc'); P(3, 2, 10, 1, '#fdf3d8');
      P(1, 1, 3, 14, '#a8701f'); P(12, 1, 3, 14, '#a8701f');
      P(1, 1, 3, 1, '#e8a33d'); P(12, 1, 3, 1, '#e8a33d');
      P(5, 5, 6, 1, '#8f7752'); P(5, 7, 6, 1, '#8f7752'); P(5, 9, 4, 1, '#8f7752');
    },
    gem: function (P) {                        // 유물 — 보석
      P(4, 3, 8, 2, '#b39ad6'); P(2, 5, 12, 3, '#8367a8');
      P(4, 8, 8, 3, '#6f5aa8'); P(6, 11, 4, 2, '#5a4890');
      P(5, 4, 2, 1, '#e0d0f4'); P(3, 6, 2, 1, '#c4b0e6');
    },
    hammer: function (P) {                     // 건설
      P(2, 2, 8, 4, '#8b9fb0'); P(2, 2, 8, 1, '#c6d6e2'); P(2, 5, 8, 1, '#5e6e7c');
      P(8, 6, 3, 3, '#a3703f'); P(10, 8, 3, 6, '#a3703f'); P(10, 8, 1, 6, '#c08a52');
    },
    anvil: function (P) {                      // 공방
      P(2, 4, 12, 4, '#5e646c'); P(2, 4, 12, 1, '#9aa0a8');
      P(5, 8, 6, 3, '#4a5058'); P(3, 11, 10, 3, '#3b4148'); P(3, 11, 10, 1, '#6e747c');
      P(13, 5, 2, 2, '#7e848c');
    },
    ship: function (P) {                       // 무역
      P(2, 9, 12, 4, '#a3703f'); P(2, 9, 12, 1, '#c08a52');
      P(7, 2, 2, 7, '#6b4526');
      P(9, 3, 5, 5, '#f4e4bc'); P(9, 3, 5, 1, '#fdf3d8');
      P(3, 4, 4, 4, '#e8a33d');
      P(1, 13, 14, 2, '#4a6fa5');
    },
    shield: function (P) {                     // 방어
      P(3, 2, 10, 7, '#8b9fb0'); P(3, 2, 10, 1, '#c6d6e2');
      P(4, 9, 8, 3, '#7e8e9c'); P(6, 12, 4, 2, '#5e6e7c');
      P(7, 4, 2, 6, '#bc4749'); P(5, 5, 6, 2, '#bc4749');
    },
    sword: function (P) {
      P(7, 1, 2, 9, '#c6d6e2'); P(8, 1, 1, 9, '#8b9fb0');
      P(4, 10, 8, 2, '#a8701f'); P(7, 12, 2, 3, '#6b4526');
    },
    bell: function (P) {                       // 알림
      P(6, 1, 4, 2, '#a8701f');
      P(4, 3, 8, 7, '#e8a33d'); P(4, 3, 8, 1, '#f6cf7a');
      P(2, 10, 12, 2, '#a8701f'); P(6, 12, 4, 2, '#8a5a12');
    },
    warn: function (P) {                       // 경고
      P(6, 1, 4, 3, '#e8a33d'); P(4, 4, 8, 4, '#e8a33d');
      P(2, 8, 12, 5, '#e8a33d'); P(2, 13, 12, 1, '#a8701f');
      P(7, 4, 2, 5, '#3b2318'); P(7, 10, 2, 2, '#3b2318');
    },
    check: function (P) {
      P(2, 7, 3, 3, '#6a994e'); P(4, 9, 3, 3, '#6a994e');
      P(6, 7, 3, 3, '#8dbb6d'); P(8, 4, 3, 3, '#8dbb6d'); P(10, 1, 3, 3, '#8dbb6d');
    },
    lock: function (P) {
      P(5, 2, 6, 2, '#8b9fb0'); P(4, 3, 2, 4, '#8b9fb0'); P(10, 3, 2, 4, '#8b9fb0');
      P(3, 7, 10, 7, '#a8701f'); P(3, 7, 10, 1, '#e8a33d');
      P(7, 9, 2, 4, '#5c380f');
    },
    castle: function (P) {
      P(2, 6, 12, 8, '#9aa0a8'); P(2, 6, 12, 1, '#c4cad2');
      P(2, 3, 3, 3, '#8a9098'); P(7, 2, 3, 4, '#8a9098'); P(12, 3, 3, 3, '#8a9098');
      P(6, 9, 4, 5, '#5e646c'); P(8, 1, 4, 2, '#bc4749');
    },
    flag: function (P) {
      P(3, 1, 2, 14, '#6b4526');
      P(5, 2, 8, 5, '#bc4749'); P(5, 2, 8, 1, '#d9706f');
      P(11, 4, 3, 3, '#bc4749');
    },
    dice: function (P) {
      P(2, 2, 12, 12, '#fdf3d8'); P(2, 2, 12, 1, '#ffffff'); P(2, 13, 12, 1, '#cdb283');
      P(4, 4, 3, 3, '#3b2318'); P(9, 4, 3, 3, '#3b2318');
      P(4, 9, 3, 3, '#3b2318'); P(9, 9, 3, 3, '#3b2318');
    },
    hoe: function (P) {
      P(9, 1, 2, 11, '#a3703f');
      P(4, 2, 6, 2, '#8b9fb0'); P(4, 2, 6, 1, '#c6d6e2'); P(4, 4, 2, 3, '#8b9fb0');
    },
    pickaxe: function (P) {
      P(7, 3, 2, 12, '#a3703f');
      P(1, 3, 14, 2, '#8b9fb0'); P(1, 3, 14, 1, '#c6d6e2');
      P(1, 1, 3, 2, '#8b9fb0'); P(12, 1, 3, 2, '#8b9fb0');
    },
    granary: function (P) {
      P(3, 6, 10, 8, '#c08a52'); P(3, 6, 10, 1, '#dcae76');
      P(2, 3, 12, 3, '#8a5e33'); P(6, 8, 4, 6, '#6b4526');
      P(7, 1, 2, 2, '#e8a33d');
    },
    wall: function (P) {
      P(1, 5, 14, 9, '#9aa0a8'); P(1, 5, 14, 1, '#c4cad2');
      P(1, 2, 3, 3, '#8a9098'); P(6, 2, 3, 3, '#8a9098'); P(11, 2, 3, 3, '#8a9098');
      P(1, 9, 14, 1, '#6e747c'); P(5, 5, 1, 9, '#6e747c'); P(10, 5, 1, 9, '#6e747c');
    },
    shrine: function (P) {
      P(5, 5, 6, 9, '#b39ad6'); P(5, 5, 6, 1, '#e0d0f4');
      P(3, 3, 10, 2, '#8367a8'); P(7, 0, 2, 3, '#f6e6a8');
      P(6, 8, 4, 6, '#6f5aa8');
    },
    road: function (P) {
      P(1, 5, 14, 6, '#a2915f'); P(1, 5, 14, 1, '#c0b184');
      [2, 6, 10].forEach(function (x) { P(x, 7, 3, 2, '#e0d3a8'); });
      P(1, 11, 14, 1, '#7a6c44');
    },
    storage: function (P) {
      P(2, 5, 12, 9, '#a3703f'); P(2, 5, 12, 1, '#c08a52');
      P(4, 8, 8, 6, '#6b4526'); P(1, 3, 14, 2, '#5c3b20');
      P(6, 10, 4, 1, '#e8a33d');
    },
    barracks: function (P) {
      P(2, 6, 12, 8, '#bc4749'); P(2, 6, 12, 1, '#d9706f');
      P(3, 3, 10, 3, '#7d2a2c'); P(6, 9, 4, 5, '#5c1c1e');
      P(7, 1, 2, 2, '#e8a33d');
    },
    consulate: function (P) {
      P(3, 5, 10, 9, '#7b9bc9'); P(3, 5, 10, 1, '#a8c2e2');
      P(2, 3, 12, 2, '#4a6fa5'); P(6, 9, 4, 5, '#3a5580');
      P(4, 6, 2, 3, '#e8e4f0'); P(10, 6, 2, 3, '#e8e4f0');
    },
    crown: function (P) {
      P(2, 6, 12, 6, '#e8a33d'); P(2, 6, 12, 1, '#f6cf7a');
      P(1, 2, 3, 5, '#e8a33d'); P(7, 1, 2, 6, '#f6cf7a'); P(12, 2, 3, 5, '#e8a33d');
      P(5, 8, 2, 2, '#bc4749'); P(9, 8, 2, 2, '#4a6fa5');
    },
    farmTile: function (P) {
      P(1, 3, 14, 11, '#8a6a3a');
      [4, 7, 10, 13].forEach(function (y) { P(1, y, 14, 2, '#e0c65a'); });
    },
    /* ── v2 오픈월드 아이콘 ── */
    axe: function (P) {                        // 도끼 — 벌목
      P(7, 4, 2, 11, '#a3703f');
      P(2, 2, 6, 5, '#8b9fb0'); P(2, 2, 6, 1, '#c6d6e2');
      P(8, 3, 3, 3, '#5e6e7c');
    },
    eye: function (P) {                        // 정찰
      P(2, 6, 12, 5, '#f4e4bc'); P(4, 5, 8, 7, '#f4e4bc');
      P(6, 6, 4, 5, '#4a6fa5'); P(7, 7, 2, 3, '#1a1008');
      P(2, 5, 12, 1, '#8f7752'); P(2, 11, 12, 1, '#8f7752');
    },
    arrowTower: function (P) {
      P(5, 7, 6, 8, '#8a5e33'); P(5, 7, 6, 1, '#a3703f');
      P(3, 3, 10, 4, '#a3703f'); P(3, 3, 10, 1, '#c08a52');
      P(3, 1, 2, 2, '#a3703f'); P(7, 1, 2, 2, '#a3703f'); P(11, 1, 2, 2, '#a3703f');
      P(7, 4, 2, 2, '#3b2318');
    },
    ballista: function (P) {
      P(2, 11, 12, 4, '#6b4526'); P(2, 11, 12, 1, '#8a5e33');
      P(7, 5, 2, 7, '#8b9fb0');
      P(1, 6, 14, 2, '#c6d6e2');
      P(0, 3, 2, 6, '#5e6e7c'); P(14, 3, 2, 6, '#5e6e7c');
      P(7, 1, 2, 5, '#e8a33d');
    },
    cannon: function (P) {
      P(1, 10, 14, 4, '#5e646c'); P(1, 10, 14, 1, '#8a9098');
      P(3, 5, 9, 5, '#3b4148'); P(3, 5, 9, 1, '#6e747c');
      P(12, 6, 4, 3, '#2b3138');
      P(2, 13, 3, 3, '#3b2318'); P(11, 13, 3, 3, '#3b2318');
    },
    chat: function (P) {
      P(1, 2, 14, 9, '#f4e4bc'); P(1, 2, 14, 1, '#fdf3d8');
      P(1, 11, 5, 3, '#f4e4bc');
      P(4, 5, 8, 1, '#8f7752'); P(4, 7, 6, 1, '#8f7752');
      P(0, 1, 16, 1, '#5d4037'); P(0, 11, 16, 1, '#5d4037');
    },
    tent: function (P) {
      P(1, 12, 14, 3, '#3a2a1c');
      P(3, 5, 10, 8, '#5a4038'); P(7, 3, 2, 3, '#6b4526');
      P(6, 9, 4, 4, '#2b1d12'); P(9, 3, 5, 3, '#bc4749');
    },
    tree: function (P) {
      P(6, 9, 4, 6, '#5c3b20');
      P(3, 2, 10, 8, '#3f6130'); P(4, 2, 8, 2, '#5f8a4c');
      P(2, 6, 12, 3, '#4a7040');
    },
    ore: function (P) {
      P(2, 6, 12, 8, '#7e848c'); P(2, 6, 12, 1, '#a4aab2');
      P(4, 9, 3, 2, '#b07050'); P(9, 11, 3, 2, '#b07050');
    },
    coal: function (P) {                       /* ★ §13-D-5 — 석탄 */
      P(3, 7, 10, 7, '#33333a'); P(3, 7, 10, 1, '#565663');
      P(5, 4, 6, 4, '#26262c'); P(6, 5, 2, 2, '#6e6e7c');
      P(9, 10, 2, 2, '#7a7a88');
    },
    rail: function (P) {                       /* ★ §13-D-5 — 철로 조각 */
      P(2, 4, 12, 2, '#9aa4ae'); P(2, 10, 12, 2, '#9aa4ae');
      P(3, 3, 2, 10, '#6b4526'); P(7, 3, 2, 10, '#6b4526'); P(11, 3, 2, 10, '#6b4526');
      P(2, 4, 12, 1, '#c8d2dc'); P(2, 10, 12, 1, '#c8d2dc');
    },
    research: function (P) {                   /* ★ §13-D-5 — 연구(플라스크) */
      P(6, 1, 4, 4, '#c8d2dc'); P(5, 5, 6, 3, '#a8bccc');
      P(3, 8, 10, 6, '#7fb3ff'); P(3, 8, 10, 1, '#a9cfff');
      P(5, 10, 2, 2, '#dff0ff'); P(9, 11, 2, 2, '#dff0ff');
    },
    anvil: function (P) {                      /* ★ §13-D-3 — 벼리는 자리 */
      P(2, 4, 12, 4, '#6b7079'); P(2, 4, 12, 1, '#98a0aa');
      P(6, 8, 4, 3, '#5a606a');
      P(3, 11, 10, 3, '#4a4f58'); P(3, 11, 10, 1, '#6b7079');
    },
    house: function (P) {
      P(3, 7, 10, 8, '#c8a874'); P(3, 7, 10, 1, '#e0c89a');
      P(1, 3, 14, 4, '#8a5e33'); P(1, 3, 14, 1, '#a3703f');
      P(6, 10, 4, 5, '#5c3b20');
    },

    /* ── v3 엔드리스 정착지 ── */
    campfire: function (P) {                   // 모닥불 — 시작의 상징
      P(2, 12, 12, 3, '#5a4632');
      P(3, 10, 4, 4, '#6b4526'); P(9, 10, 4, 4, '#6b4526');
      P(6, 4, 4, 8, '#e08541'); P(7, 6, 2, 5, '#f2b06a');
      P(7, 1, 2, 4, '#f6e6a8');
      P(3, 7, 2, 3, '#d96a2c'); P(11, 6, 2, 4, '#d96a2c');
    },
    fence: function (P) {                      // 울타리 조각
      P(1, 5, 14, 3, '#a3703f'); P(1, 5, 14, 1, '#c08a52');
      P(1, 10, 14, 3, '#8a5e33');
      P(3, 2, 3, 13, '#8a5e33'); P(3, 2, 1, 13, '#a3703f');
      P(10, 2, 3, 13, '#8a5e33'); P(10, 2, 1, 13, '#a3703f');
    },
    gate: function (P) {                       // 문
      P(1, 3, 3, 12, '#6b4526'); P(12, 3, 3, 12, '#6b4526');
      P(4, 4, 8, 10, '#a3703f'); P(4, 4, 8, 1, '#c08a52');
      P(7, 4, 2, 10, '#6b4526');
      P(5, 8, 2, 2, '#e8a33d'); P(9, 8, 2, 2, '#e8a33d');
      P(0, 1, 16, 2, '#5c3b20');
    },
    person: function (P) {                     // 주민 한 사람
      P(6, 1, 5, 5, '#e6b892'); P(6, 1, 5, 1, '#3b2318');
      P(7, 3, 1, 2, '#241812'); P(9, 3, 1, 2, '#241812');
      P(5, 6, 7, 6, '#c8965a'); P(5, 6, 7, 1, '#e0b47a');
      P(4, 7, 1, 4, '#e6b892'); P(12, 7, 1, 4, '#e6b892');
      P(6, 12, 2, 3, '#4a3a2a'); P(9, 12, 2, 3, '#4a3a2a');
    },
    wagon: function (P) {                      // 마차
      P(1, 6, 12, 4, '#8a5e33'); P(1, 6, 12, 1, '#a3703f');
      P(3, 2, 9, 5, '#f4e4bc'); P(3, 2, 9, 1, '#fdf3d8');
      P(2, 10, 4, 4, '#3b2318'); P(9, 10, 4, 4, '#3b2318');
      P(13, 5, 3, 5, '#7a5230');
    },
    tier: function (P) {                       // 성장 — 말뚝과 넓어지는 땅
      P(7, 1, 2, 12, '#8a5e33');
      P(9, 2, 6, 4, '#e8a33d'); P(9, 2, 6, 1, '#f6cf7a');
      P(2, 13, 12, 2, '#6a994e'); P(0, 14, 16, 2, '#3f6130');
      P(3, 11, 2, 2, '#8dbb6d'); P(11, 11, 2, 2, '#8dbb6d');
    },
    book: function (P) {                       // 연대기
      P(1, 2, 14, 12, '#8a5e33'); P(1, 2, 14, 1, '#a3703f');
      P(2, 3, 6, 10, '#f4e4bc'); P(8, 3, 6, 10, '#e6d3a8');
      P(7, 2, 2, 12, '#6b4526');
      P(3, 5, 4, 1, '#8f7752'); P(3, 7, 4, 1, '#8f7752');
      P(9, 5, 4, 1, '#8f7752'); P(9, 8, 3, 1, '#8f7752');
    },
    heart: function (P) {                      // 체력
      P(2, 3, 4, 3, '#d9706f'); P(10, 3, 4, 3, '#d9706f');
      P(1, 5, 14, 3, '#bc4749'); P(3, 8, 10, 2, '#bc4749');
      P(5, 10, 6, 2, '#a03a3c'); P(7, 12, 2, 2, '#7d2a2c');
      P(3, 4, 2, 1, '#f0a09c');
    },
    star: function (P) {                       // 레벨업
      P(7, 1, 2, 14, '#e8a33d'); P(1, 7, 14, 2, '#e8a33d');
      P(4, 4, 8, 8, '#f6cf7a'); P(6, 6, 4, 4, '#fff0c8');
      P(3, 3, 2, 2, '#e8a33d'); P(11, 11, 2, 2, '#e8a33d');
    },
    up: function (P) {                         // 개축
      P(7, 1, 2, 13, '#6a994e');
      P(4, 4, 8, 2, '#8dbb6d'); P(5, 2, 6, 2, '#8dbb6d');
      P(2, 6, 12, 2, '#6a994e');
      P(4, 14, 8, 2, '#3f6130');
    },
    repair: function (P) {                     // 수리
      P(2, 2, 4, 4, '#8b9fb0'); P(2, 2, 4, 1, '#c6d6e2');
      P(5, 5, 3, 3, '#8b9fb0');
      P(7, 7, 7, 7, '#a3703f'); P(7, 7, 7, 1, '#c08a52');
      P(11, 11, 4, 4, '#6b4526');
    },
    wolf: function (P) {
      P(2, 7, 9, 5, '#8a8070'); P(2, 7, 9, 1, '#a49a88');
      P(10, 4, 5, 5, '#8a8070');
      P(10, 1, 2, 3, '#5e5850'); P(13, 1, 2, 3, '#5e5850');
      P(13, 6, 2, 1, '#3a3028'); P(12, 5, 1, 1, '#e8a33d');
      P(0, 5, 3, 2, '#5e5850');
      P(3, 12, 2, 3, '#4a443c'); P(8, 12, 2, 3, '#4a443c');
    },
    bandit: function (P) {
      P(4, 1, 8, 5, '#c8a184'); P(4, 0, 8, 2, '#5c4438');
      P(4, 3, 8, 1, '#3a3028');
      P(3, 6, 10, 7, '#7a5a48'); P(3, 6, 10, 1, '#96745e');
      P(1, 7, 2, 5, '#c8a184'); P(13, 7, 2, 5, '#c8a184');
      P(13, 2, 2, 8, '#8b9fb0');
      P(5, 13, 2, 3, '#3a3028'); P(9, 13, 2, 3, '#3a3028');
    },
    ogre: function (P) {
      P(3, 5, 10, 8, '#6b7a4a'); P(3, 5, 10, 1, '#84945e');
      P(4, 0, 8, 5, '#7a8a56');
      P(5, 2, 2, 2, '#1a1008'); P(9, 2, 2, 2, '#1a1008');
      P(6, 4, 4, 1, '#f0e6d2');
      P(0, 6, 3, 6, '#6b7a4a'); P(13, 6, 3, 6, '#6b7a4a');
      P(4, 13, 3, 3, '#4a5030'); P(9, 13, 3, 3, '#4a5030');
    },
    tools: function (P) {                      // 스킬 패널
      P(2, 2, 2, 12, '#a3703f'); P(1, 1, 4, 3, '#8b9fb0');
      P(11, 2, 2, 12, '#a3703f'); P(10, 1, 5, 2, '#c6d6e2');
      P(6, 6, 4, 4, '#e8a33d');
    },
    swords: function (P) {                     // 웨이브 경보
      P(2, 2, 2, 9, '#c6d6e2'); P(12, 2, 2, 9, '#c6d6e2');
      P(1, 11, 4, 2, '#a8701f'); P(11, 11, 4, 2, '#a8701f');
      P(2, 13, 2, 3, '#6b4526'); P(12, 13, 2, 3, '#6b4526');
      P(5, 5, 6, 2, '#bc4749');
    }
  };

  /* ── 그리기 ─────────────────────────────────────────── */
  /** 오프스크린 캔버스에 실제로 그린다 (월드 렌더러가 drawImage 로 바로 쓴다) */
  function renderCanvas(name, size) {
    var fn = DRAW[name];
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    var ctx = cv.getContext('2d');
    if (!ctx) return cv;
    ctx.imageSmoothingEnabled = false;
    var s = size / 16;
    ctx.clearRect(0, 0, size, size);
    var P = function (x, y, w, h, color) {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x * s), Math.round(y * s), Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
    };
    if (fn) fn(P); else P(3, 3, 10, 10, C.grey);
    return cv;
  }

  function canvas(name, size) {
    size = size || 16;
    var k = 'cv:' + name + '@' + size;
    if (!CACHE[k]) CACHE[k] = renderCanvas(name, size);
    return CACHE[k];
  }

  function render(name, size) {
    var cv = renderCanvas(name, size);
    var url;
    try { url = cv.toDataURL('image/png'); } catch (e) { url = ''; }
    if (!url || url.length < 32) url = BLANK;     // 캔버스 미구현 환경 폴백
    return url;
  }

  function get(name, size) {
    size = size || 16;
    var k = name + '@' + size;
    if (!CACHE[k]) CACHE[k] = render(name, size);
    return CACHE[k];
  }

  function img(name, size, alt) {
    size = size || 16;
    var im = document.createElement('img');
    im.src = get(name, size);
    im.width = size; im.height = size;
    im.alt = alt || '';
    im.setAttribute('aria-hidden', alt ? 'false' : 'true');
    im.style.width = size + 'px';
    im.style.height = size + 'px';
    return im;
  }

  /* 재화 키 → 아이콘 이름 */
  function resIcon(key) {
    if (key === 'gold') return 'coin';
    if (key === 'population') return 'folk';
    if (key === 'morale') return 'morale';
    return DRAW[key] ? key : 'stone';
  }

  /* ── 각료 초상 (48×48 도트, 결정적 생성) ───────────── */
  var SKIN = ['#e6b892', '#d0a074', '#b0805a', '#f0d0b0'];
  var HAIR = ['#3a2a20', '#6b4a2a', '#231a18', '#8a6a3a', '#5a2a2a', '#d8cfae'];

  function renderPortrait(roleKey, size, seedExtra) {
    var cv = document.createElement('canvas');
    var ctx = U.fitCanvas(cv, size, size);
    var meta = GM.state ? GM.state.roleMeta(roleKey) : { color: C.grey };
    var rnd = U.rngFrom(roleKey + '|' + (seedExtra || 'p'));
    var s = size / 16;
    ctx.clearRect(0, 0, size, size);
    function P(x, y, w, h, col) { U.px(ctx, x * s, y * s, Math.max(1, w * s), Math.max(1, h * s), col); }

    /* 배경 — 각료색 계단 + 양피지 톤 */
    for (var i = 0; i < 16; i++) P(0, i, 16, 1, U.mix('#f4e4bc', meta.color, 0.08 + i * 0.022));
    var skin = SKIN[Math.floor(rnd() * SKIN.length)];
    var hair = HAIR[Math.floor(rnd() * HAIR.length)];
    var cloth = meta.color;

    P(2, 12, 12, 4, U.shade(cloth, -0.15));      // 어깨
    P(2, 12, 12, 1, U.shade(cloth, 0.25));
    P(4, 4, 8, 8, skin);                          // 얼굴
    P(3, 6, 1, 5, U.shade(skin, -0.16));
    P(12, 6, 1, 5, U.shade(skin, -0.16));
    P(3, 2, 10, 3, hair);                         // 머리
    P(3, 5, 1, 2, hair); P(12, 5, 1, 2, hair);
    if (rnd() > 0.5) { P(2, 5, 1, 6, hair); P(13, 5, 1, 6, hair); }
    P(6, 7, 1, 2, '#1a1008'); P(9, 7, 1, 2, '#1a1008');   // 눈
    P(7, 10, 2, 1, U.shade(skin, -0.36));                 // 입
    P(5, 6, 2, 1, U.shade(hair, -0.1)); P(9, 6, 2, 1, U.shade(hair, -0.1));

    /* 각료 표식 */
    if (roleKey === 'saint')   { P(5, 0, 6, 1, '#f6e6a8'); P(6, 1, 4, 1, '#f6e6a8'); }
    if (roleKey === 'defense') { P(3, 2, 10, 1, '#9aa0a8'); P(2, 3, 1, 3, '#9aa0a8'); P(13, 3, 1, 3, '#9aa0a8'); }
    if (roleKey === 'trade')   { P(2, 3, 12, 1, '#7b9bc9'); P(7, 13, 2, 2, '#e8a33d'); }
    if (roleKey === 'build')   { P(4, 1, 8, 2, '#c8965a'); P(4, 1, 8, 1, '#e0b47a'); }
    if (roleKey === 'farm')    { P(3, 1, 10, 2, '#b98d3a'); P(3, 1, 10, 1, '#e0c65a'); }
    if (roleKey === 'factory') { P(4, 2, 8, 1, '#8b9fb0'); P(11, 1, 2, 3, '#5e6e7c'); }

    var url;
    try { url = cv.toDataURL('image/png'); } catch (e) { url = ''; }
    if (!url || url.length < 32) url = BLANK;
    return url;
  }

  function portrait(roleKey, size, seedExtra) {
    size = size || 48;
    var k = 'p:' + roleKey + '@' + size + ':' + (seedExtra || '');
    if (!CACHE[k]) CACHE[k] = renderPortrait(roleKey, size, seedExtra);
    return CACHE[k];
  }
  function portraitImg(roleKey, size, seedExtra) {
    size = size || 48;
    var im = document.createElement('img');
    im.src = portrait(roleKey, size, seedExtra);
    im.width = size; im.height = size;
    im.alt = '';
    im.setAttribute('aria-hidden', 'true');
    im.style.width = size + 'px'; im.style.height = size + 'px';
    return im;
  }

  GM.icons = { get: get, canvas: canvas, img: img, resIcon: resIcon,
               portrait: portrait, portraitImg: portraitImg,
               names: Object.keys(DRAW), C: C };
})(window);
