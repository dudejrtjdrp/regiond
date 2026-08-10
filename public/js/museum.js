/* Regiond · Asset Museum — 에셋 검수 전용 로직 (개발 전용)
   「왜」 게임 클라(GM 네임스페이스)와 완전히 분리한다. 박물관이 죽어도 게임은 무관해야 하고,
   반대로 게임 전역 상태가 검수 결과를 오염시켜서도 안 된다.
   「왜」 localStorage·외부 CDN 미사용: 검수 상태는 매번 manifest에서 새로 계산해야 신뢰할 수 있고,
   오프라인(비행기/폐쇄망)에서도 동일하게 열려야 한다. */

/* ==================================================================
   1. 상수 — 아트바이블 정본을 코드로 옮긴 부분
   ================================================================== */

/* 기존 자동 생성본은 보존하되, 전시에는 앞으로 수작업으로 검수해 연결한 에셋만 올린다. */
const MANIFEST_URL = 'assets/manifest.json';
const PALETTE_FALLBACK_URL = 'assets/palette/master-v1.json';

/* 「왜」 게임의 밤 오버레이 값을 그대로 써야 QA(밤 minLuma)가 실제 화면과 일치한다. */
const NIGHT = { hex: '#16214a', alpha: 0.46 };
const NIGHT_MIN_LUMA = 56;

const ENVS = [
  { id: 'day', label: '낮' },
  { id: 'night', label: '밤' },
  { id: 'rain', label: '비' },
  { id: 'snow', label: '눈' },
  { id: 'indoor', label: '실내' },
  { id: 'torch', label: '횃불' }
];

const ZOOMS = [1, 1.5, 2, 3, 4];

const ANIM_ORDER = ['idle', 'walk', 'run', 'attack', 'gather', 'craft', 'hit', 'death'];
const ANIM_LABEL = {
  idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Attack',
  gather: 'Gather', craft: 'Craft', hit: 'Hit', death: 'Death'
};
/* 「왜」 아트바이블 §9 — 루프는 Idle/Walk/Run/Gather/Craft만. 나머지는 1회 재생 후 정지. */
const ANIM_LOOP = new Set(['idle', 'walk', 'run', 'gather', 'craft']);
const ANIM_FPS = { idle: 8, walk: 12, run: 12, attack: 12, gather: 10, craft: 10, hit: 15, death: 10 };
const ANIM_FRAMES_CHAR = { idle: 6, walk: 8, run: 8, attack: 6, gather: 6, craft: 6, hit: 3, death: 8 };
const ANIM_FRAMES_MONSTER = { idle: 4, walk: 6, run: 6, attack: 6, hit: 3, death: 8 };

/* 전시홀 — SPEC 1번. sub 키는 manifest.subcategory 와 매칭(대소문자·한글 라벨 모두 허용). */
const HALLS = [
  { key: 'player', label: '플레이어', subs: [['male', '남'], ['female', '여'], ['gear', '기본장비'], ['job', '직업']] },
  { key: 'npc', label: 'NPC', subs: [['folk', '주민'], ['merchant', '상인'], ['artisan', '장인'], ['noble', '귀족'], ['soldier', '병사'], ['child', '아이'], ['elder', '노인']] },
  { key: 'monster', label: '몬스터', sort: 'size', subs: [['normal', '일반'], ['elite', '엘리트'], ['boss', '보스']] },
  { key: 'animal', label: '동물', subs: [['livestock', '가축'], ['wild', '야생'], ['mount', '탈것']] },
  { key: 'weapon', label: '무기', sort: 'grade', subs: [['sword', '검'], ['bow', '활'], ['spear', '창'], ['axe', '도끼'], ['blunt', '둔기'], ['staff', '지팡이']] },
  { key: 'armor', label: '방어구', sort: 'grade', subs: [['helm', '투구'], ['body', '갑옷'], ['gloves', '장갑'], ['boots', '신발'], ['cloak', '망토']] },
  { key: 'food', label: '음식', subs: [] },
  { key: 'consumable', label: '소비', subs: [] },
  { key: 'material', label: '재료', subs: [] },
  { key: 'mineral', label: '광물', subs: [] },
  { key: 'tree', label: '나무', subs: [] },
  { key: 'plant', label: '식물/작물', subs: [] },
  { key: 'furniture', label: '가구', subs: [] },
  { key: 'building', label: '건물', subs: [] },
  { key: 'tileset', label: '타일셋', subs: [] },
  { key: 'ui', label: 'UI', subs: [['icon', '아이콘'], ['button', '버튼'], ['panel', '패널'], ['inventory', '인벤토리'], ['skill', '스킬']] },
  { key: 'effect', label: '이펙트', subs: [['attack', '공격'], ['explosion', '폭발'], ['gather', '채집'], ['craft', '제작'], ['magic', '마법'], ['buff', '버프'], ['debuff', '디버프']] },
  { key: 'portrait', label: '초상', subs: [] }
];

const ICON_SPEC = { sizes: [[64, 64]], contentH: [48, 56], outline: true };

/* 아트바이블 §8 카테고리별 마스터 규격 표 — QA 해상도/크기비율 검사의 근거. */
const CATEGORY_SPEC = {
  player: { sizes: [[128, 128]], contentH: [96, 112], outline: true },
  npc: { sizes: [[96, 128], [128, 128]], contentH: [80, 112], outline: true },
  monster: {
    sizes: [[128, 128], [160, 160], [256, 256]], contentH: [96, 192], outline: true,
    subs: {
      normal: { sizes: [[128, 128]], contentH: [96, 112] },
      elite: { sizes: [[160, 160]], contentH: [128, 144] },
      boss: { sizes: [[256, 256]], contentH: [192, 248] }
    }
  },
  animal: { sizes: [[96, 96], [128, 128]], contentH: [40, 112], outline: true },
  weapon: ICON_SPEC,
  armor: ICON_SPEC,
  food: ICON_SPEC,
  consumable: ICON_SPEC,
  material: ICON_SPEC,
  mineral: { sizes: [[64, 64], [96, 96]], contentH: [48, 88], outline: true },
  tree: { sizes: [[128, 192]], contentH: [120, 192], outline: true },
  plant: { sizes: [[64, 64]], contentH: [20, 60], outline: true },
  furniture: { sizes: [[96, 96], [128, 128]], contentH: [40, 120], outline: true },
  building: { sizes: [[64, 96], [128, 176], [128, 224], [192, 256], [192, 304], [256, 352]], contentH: [64, 344], outline: true },
  tileset: { sizes: [[64, 64]], contentH: [64, 64], outline: false },
  ui: { sizes: [[64, 64]], contentH: [32, 64], outline: true },
  effect: { sizes: [[128, 128]], contentH: [32, 128], outline: false },
  portrait: { sizes: [[96, 96], [176, 176]], contentH: [72, 176], outline: true }
};

const GRADES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const GRADE_LABEL = { common: '일반', uncommon: '고급', rare: '희귀', epic: '영웅', legendary: '전설' };

const GRID_PAD = 24;   /* 전시대 캔버스 여백 */
const OPAQUE_A = 250;  /* 이 이상은 불투명으로 본다 */

/* 「왜」 파이프라인이 배경 제거로 건물 일부를 삼킨 사고가 있었다. 제거 전(raw.png)과
   제거 후(base.png)를 같은 화면에서 네 가지 방식으로 대조해 즉시 발견한다. */
const CMP_MODES = [
  { id: 'final', label: '최종' },
  { id: 'original', label: '원본' },
  { id: 'side', label: '나란히' },
  { id: 'diff', label: '겹쳐보기' }
];

const LOST_RGB = [206, 48, 56];      /* 원본에만 있는 픽셀 = 제거로 사라진 부분 */
const KEPT_RGB = [86, 214, 198];     /* 최종에 남은 실루엣 */
const FADE_RGB = [236, 233, 225];    /* 배경은 눌러서 실루엣을 도드라지게 */
const BG_TOL = 40;                   /* 테두리 최빈색과 이 거리 안쪽은 배경으로 본다 */
const SILHOUETTE_A = 128;            /* 최종 실루엣 판정 알파 */

/* 오버레이 색 — 지시된 정본(앵커 노랑 / bounds 청록 점선 / 캔버스 회색). */
const OV_ANCHOR = '#ffd44d';
const OV_BOUNDS = '#4fd1c5';
const OV_CANVAS = '#9aa0a8';

/* ==================================================================
   2. 상태 (메모리 전용)
   ================================================================== */

const state = {
  palette: null,
  paletteRGB: [],
  outlineRGB: [],
  manifest: null,
  assets: [],
  byId: new Map(),
  images: new Map(),
  originals: new Map(),
  sheets: new Map(),
  metrics: new Map(),
  qa: new Map(),
  env: 'day',
  zoom: 2,
  checker: false,
  search: '',
  failOnly: false,
  hall: 'all',
  sub: null,
  overrides: new Map(),
  overlay: { anchor: false, bounds: false, canvas: false },
  view: { id: null, anim: null, frame: 0, playing: true, acc: 0, last: 0, raf: 0, cmp: 'side' }
};

/* ==================================================================
   3. 유틸
   ================================================================== */

const $ = (sel) => document.querySelector(sel);

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r, g, b) {
  const v = (r << 16) | (g << 8) | b;
  return '#' + v.toString(16).padStart(6, '0');
}

/* Rec.709 휘도 — 아트바이블의 luma 기준(상>하, 밤 minLuma)에 쓰는 단일 정의. */
function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/* HSV 채도(%) — 아트바이블 §2 "중간톤 채도 35~65%" 검사 단위. */
function saturation(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx === 0) return 0;
  return ((mx - mn) / mx) * 100;
}

function nightPixel(r, g, b) {
  const n = hexToRgb(NIGHT.hex);
  const a = NIGHT.alpha;
  const mul = (c, o) => c * (1 - a) + (c * o / 255) * a;
  return [mul(r, n[0]), mul(g, n[1]), mul(b, n[2])];
}

function pct(v) {
  return (v * 100).toFixed(2) + '%';
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.add('hidden'), 2600);
}

/* 결정적 난수 — 「왜」 비/눈 입자가 매 프레임 흔들리면 검수에 방해된다. */
function seedRandom(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

async function loadJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(url + ' → HTTP ' + res.status);
  return res.json();
}

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/* ==================================================================
   4. 팔레트
   ================================================================== */

function flattenPalette(pal) {
  const out = [];
  const ramps = pal && pal.ramps ? pal.ramps : {};
  Object.keys(ramps).forEach((key) => {
    ramps[key].forEach((hex, i) => out.push({ hex, ramp: key, step: i, rgb: hexToRgb(hex) }));
  });
  return out;
}

/* 외곽선 허용색 = 각 램프 0단 + ink 램프 전체 (아트바이블 §5). */
function outlineAllowed(list) {
  return list.filter((c) => c.step === 0 || c.ramp === 'ink');
}

function nearestPaletteDist(r, g, b) {
  let best = 1e9;
  for (let i = 0; i < state.paletteRGB.length; i++) {
    const p = state.paletteRGB[i];
    const d = Math.sqrt((r - p[0]) ** 2 + (g - p[1]) ** 2 + (b - p[2]) ** 2);
    if (d < best) best = d;
  }
  return best;
}

const paletteHitCache = new Map();

function inPalette(r, g, b) {
  if (state.paletteRGB.length === 0) return true; /* 팔레트 미로드 시 오탐 방지 */
  const key = (r << 16) | (g << 8) | b;
  const hit = paletteHitCache.get(key);
  if (hit !== undefined) return hit;
  const ok = nearestPaletteDist(r, g, b) <= 6;
  paletteHitCache.set(key, ok);
  return ok;
}

function isOutlineColor(r, g, b) {
  for (let i = 0; i < state.outlineRGB.length; i++) {
    const p = state.outlineRGB[i];
    const d = Math.sqrt((r - p[0]) ** 2 + (g - p[1]) ** 2 + (b - p[2]) ** 2);
    if (d <= 10) return true;
  }
  return false;
}

/* ==================================================================
   5. 이미지 분석 (QA·비교 수치의 원천)
   ================================================================== */

function readPixels(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
}

function scanBasics(data, w, h) {
  const acc = {
    w, h, total: w * h, opaque: 0, semi: 0, violate: 0,
    minX: w, minY: h, maxX: -1, maxY: -1,
    lumaSum: 0, satSum: 0, nightSum: 0, colors: new Map(),
    topSum: 0, topN: 0, botSum: 0, botN: 0
  };
  for (let i = 0; i < data.length; i += 4) {
    accumulatePixel(acc, data, i, w);
  }
  finishBasics(acc);
  return acc;
}

function accumulatePixel(acc, data, i, w) {
  const a = data[i + 3];
  if (a === 0) return;
  const p = i / 4;
  const x = p % w;
  const y = (p - x) / w;
  if (a < 255) acc.semi++;
  if (x < acc.minX) acc.minX = x;
  if (x > acc.maxX) acc.maxX = x;
  if (y < acc.minY) acc.minY = y;
  if (y > acc.maxY) acc.maxY = y;
  if (a < OPAQUE_A) return;
  countOpaque(acc, data[i], data[i + 1], data[i + 2], y);
}

function countOpaque(acc, r, g, b, y) {
  acc.opaque++;
  const l = luma(r, g, b);
  acc.lumaSum += l;
  acc.satSum += saturation(r, g, b);
  const nb = nightPixel(r, g, b);
  acc.nightSum += luma(nb[0], nb[1], nb[2]);
  if (!inPalette(r, g, b)) acc.violate++;
  const key = rgbToHex(r, g, b);
  acc.colors.set(key, (acc.colors.get(key) || 0) + 1);
  acc.rows = acc.rows || [];
  acc.rows.push(y, l);
}

/* 상·하반부 luma는 콘텐츠 bbox 기준으로 갈라야 여백이 결과를 왜곡하지 않는다. */
function finishBasics(acc) {
  const rows = acc.rows || [];
  const mid = (acc.minY + acc.maxY) / 2;
  for (let i = 0; i < rows.length; i += 2) {
    if (rows[i] <= mid) { acc.topSum += rows[i + 1]; acc.topN++; }
    if (rows[i] > mid) { acc.botSum += rows[i + 1]; acc.botN++; }
  }
  acc.rows = null;
}

function collectRuns(data, w, h, horizontal) {
  const lens = [];
  const outer = horizontal ? h : w;
  const inner = horizontal ? w : h;
  for (let o = 0; o < outer; o++) {
    scanLine(data, w, o, inner, horizontal, lens);
  }
  return lens;
}

function scanLine(data, w, o, inner, horizontal, lens) {
  let prev = -1;
  let run = 0;
  for (let n = 0; n < inner; n++) {
    const x = horizontal ? n : o;
    const y = horizontal ? o : n;
    const i = (y * w + x) * 4;
    const key = data[i + 3] < OPAQUE_A ? -1 : (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    if (key !== prev) { pushRun(lens, prev, run); prev = key; run = 0; }
    run++;
  }
  pushRun(lens, prev, run);
}

function pushRun(lens, key, run) {
  if (key < 0) return;
  if (run <= 0) return;
  if (run > 16) return; /* 대면적 단색은 그리드 추정에 노이즈 */
  lens.push(run);
}

function modeOf(lens) {
  const map = new Map();
  lens.forEach((v) => map.set(v, (map.get(v) || 0) + 1));
  let best = 1;
  let bestN = -1;
  map.forEach((n, v) => {
    if (n > bestN) { bestN = n; best = v; }
  });
  return best;
}

/* 「왜」 최빈값만 보면 3px 클러스터 아트가 오탐된다. 최빈값 g의 배수 비율까지 봐야
   "정말 g배 업스케일된 격자"인지 구분된다. */
function estimateGrid(data, w, h) {
  const a = collectRuns(data, w, h, true);
  const b = collectRuns(data, w, h, false);
  if (a.length === 0 || b.length === 0) return 1;
  const g = Math.min(modeOf(a), modeOf(b));
  if (g < 2) return 1;
  const all = a.concat(b);
  const divisible = all.filter((v) => v % g === 0).length / all.length;
  if (divisible >= 0.8) return g;
  return 1;
}

function outlineStats(data, w, h) {
  const res = { boundary: 0, ok: 0, colors: new Map() };
  for (let y = 0; y < h; y++) {
    scanOutlineRow(data, w, h, y, res);
  }
  return res;
}

function scanOutlineRow(data, w, h, y, res) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (data[i + 3] < OPAQUE_A) continue;
    if (!isBoundary(data, w, h, x, y)) continue;
    tallyOutline(res, data[i], data[i + 1], data[i + 2]);
  }
}

function isBoundary(data, w, h, x, y) {
  const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
  for (let k = 0; k < nb.length; k++) {
    const [nx, ny] = nb[k];
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) return true;
    if (data[(ny * w + nx) * 4 + 3] < OPAQUE_A) return true;
  }
  return false;
}

function tallyOutline(res, r, g, b) {
  res.boundary++;
  if (isOutlineColor(r, g, b)) res.ok++;
  const key = rgbToHex(r, g, b);
  res.colors.set(key, (res.colors.get(key) || 0) + 1);
}

function topColors(map, n) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function analyzeImage(img) {
  const px = readPixels(img);
  const basics = scanBasics(px.data, px.w, px.h);
  const outline = outlineStats(px.data, px.w, px.h);
  const grid = estimateGrid(px.data, px.w, px.h);
  const contentW = Math.max(0, basics.maxX - basics.minX + 1);
  const contentH = Math.max(0, basics.maxY - basics.minY + 1);
  return {
    w: px.w, h: px.h, contentW, contentH,
    bbox: [basics.minX, basics.minY, basics.maxX, basics.maxY],
    opaque: basics.opaque,
    semiRate: basics.total > 0 ? basics.semi / Math.max(1, basics.opaque + basics.semi) : 0,
    violateRate: basics.opaque > 0 ? basics.violate / basics.opaque : 0,
    meanLuma: basics.opaque > 0 ? basics.lumaSum / basics.opaque : 0,
    meanSat: basics.opaque > 0 ? basics.satSum / basics.opaque : 0,
    nightLuma: basics.opaque > 0 ? basics.nightSum / basics.opaque : 0,
    topLuma: basics.topN > 0 ? basics.topSum / basics.topN : 0,
    botLuma: basics.botN > 0 ? basics.botSum / basics.botN : 0,
    colorCount: basics.colors.size,
    swatches: topColors(basics.colors, 8),
    outlineRatio: outline.boundary > 0 ? outline.ok / outline.boundary : 0,
    outlineColor: topColors(outline.colors, 1)[0] || ['—', 0],
    grid
  };
}

/* ==================================================================
   6. 자동 QA — SPEC 9번 알고리즘
   ================================================================== */

function specFor(asset) {
  const base = CATEGORY_SPEC[asset.category];
  if (!base) return null;
  const subs = base.subs || {};
  const sub = subs[String(asset.subcategory || '').toLowerCase()];
  if (!sub) return base;
  return Object.assign({}, base, sub);
}

function chk(id, label, status, detail) {
  return { id, label, status, detail };
}

function checkPalette(m) {
  if (state.paletteRGB.length === 0) return chk('palette', '팔레트', 'SKIP', 'master-v1.json 미로드');
  const r = m.violateRate;
  if (r > 0.08) return chk('palette', '팔레트', 'FAIL', `마스터 외 색 ${pct(r)} (>8%)`);
  if (r > 0.02) return chk('palette', '팔레트', 'WARNING', `마스터 외 색 ${pct(r)} (>2%)`);
  return chk('palette', '팔레트', 'PASS', `마스터 외 색 ${pct(r)} · 사용색 ${m.colorCount}`);
}

function checkSemi(m) {
  const r = m.semiRate;
  if (r > 0.05) return chk('semi', '반투명', 'FAIL', `외곽 AA 의심 ${pct(r)} (>5%)`);
  if (r > 0.01) return chk('semi', '반투명', 'WARNING', `반투명 픽셀 ${pct(r)} (>1%)`);
  return chk('semi', '반투명', 'PASS', `반투명 ${pct(r)} — 알파 0/255 준수`);
}

function checkSize(asset, m, spec) {
  if (!spec) return chk('size', '해상도', 'SKIP', `카테고리 규격 미정의 (${asset.category})`);
  const hit = spec.sizes.some((s) => s[0] === m.w && s[1] === m.h);
  const want = spec.sizes.map((s) => s.join('×')).join(' / ');
  if (hit) return chk('size', '해상도', 'PASS', `${m.w}×${m.h} — 규격 일치`);
  return chk('size', '해상도', 'FAIL', `${m.w}×${m.h} — 규격 ${want} 아님`);
}

function checkGrid(m) {
  if (m.grid <= 1) return chk('grid', '픽셀 밀도', 'PASS', '추정 그리드 1px — 1에셋 1그리드');
  return chk('grid', '픽셀 밀도', 'WARNING', `추정 그리드 ${m.grid}px — 업스케일 원본 의심(마스터는 1×)`);
}

function checkOutline(m, spec) {
  if (spec && spec.outline === false) return chk('outline', '외곽선', 'SKIP', '외곽선 없는 카테고리(타일/이펙트)');
  const r = m.outlineRatio;
  const detail = `경계 ink/램프0단 비율 ${pct(r)} · 주색 ${m.outlineColor[0]}`;
  if (r < 0.7) return chk('outline', '외곽선', 'WARNING', detail + ' (<70%)');
  return chk('outline', '외곽선', 'PASS', detail);
}

function checkLight(m) {
  const d = m.topLuma - m.botLuma;
  const detail = `상 ${m.topLuma.toFixed(1)} / 하 ${m.botLuma.toFixed(1)}`;
  if (d <= 0) return chk('light', '광원', 'WARNING', detail + ' — 상반부가 더 어둡다(좌상 45° 위반 의심)');
  return chk('light', '광원', 'PASS', detail);
}

function checkNight(m) {
  const v = m.nightLuma;
  if (v < NIGHT_MIN_LUMA) return chk('night', '밤 minLuma', 'FAIL', `밤 합성 후 평균 luma ${v.toFixed(1)} (<${NIGHT_MIN_LUMA})`);
  return chk('night', '밤 minLuma', 'PASS', `밤 합성 후 ${v.toFixed(1)} ≥ ${NIGHT_MIN_LUMA}`);
}

function expectedFrames(asset, name) {
  if (asset.category === 'monster') return ANIM_FRAMES_MONSTER[name];
  return ANIM_FRAMES_CHAR[name];
}

function checkFrames(asset, sheet) {
  if (!asset.frames) return chk('frames', '프레임', 'SKIP', '정지 에셋(frames 없음)');
  if (!sheet) return chk('frames', '프레임', 'FAIL', '시트 이미지를 불러오지 못했다');
  const f = asset.frames;
  const bad = [];
  if (sheet.naturalWidth % f.frameW !== 0) bad.push(`가로 ${sheet.naturalWidth}가 frameW ${f.frameW}의 배수 아님`);
  if (sheet.naturalHeight % f.frameH !== 0) bad.push(`세로 ${sheet.naturalHeight}가 frameH ${f.frameH}의 배수 아님`);
  const cols = Math.floor(sheet.naturalWidth / f.frameW);
  const rows = Math.floor(sheet.naturalHeight / f.frameH);
  const warn = collectFrameWarnings(asset, f, cols, rows, bad);
  if (bad.length > 0) return chk('frames', '프레임', 'FAIL', bad.join(' · '));
  if (warn.length > 0) return chk('frames', '프레임', 'WARNING', warn.join(' · '));
  return chk('frames', '프레임', 'PASS', `${cols}열 × ${rows}행 · ${Object.keys(f.anims || {}).length}개 애니 정합`);
}

function collectFrameWarnings(asset, f, cols, rows, bad) {
  const warn = [];
  Object.entries(f.anims || {}).forEach(([name, a]) => {
    if (a.row >= rows) bad.push(`${name}: row ${a.row} ≥ 행수 ${rows}`);
    if (a.count > cols) bad.push(`${name}: count ${a.count} > 열수 ${cols}`);
    const want = expectedFrames(asset, name);
    if (want && a.count !== want) warn.push(`${name} ${a.count}프레임(권장 ${want})`);
  });
  return warn;
}

function checkRatio(asset, m, spec) {
  if (!spec) return chk('ratio', '크기 비율', 'SKIP', '기준 없음');
  const [lo, hi] = spec.contentH;
  const min = lo * 0.75;
  const max = hi * 1.25;
  const detail = `콘텐츠 ${m.contentW}×${m.contentH}px · 기준 높이 ${lo}~${hi}px`;
  if (m.contentH < min || m.contentH > max) return chk('ratio', '크기 비율', 'WARNING', detail + ' (±25% 밖)');
  return chk('ratio', '크기 비율', 'PASS', detail);
}

function rollup(checks) {
  if (checks.some((c) => c.status === 'FAIL')) return 'FAIL';
  if (checks.some((c) => c.status === 'WARNING')) return 'WARNING';
  return 'PASS';
}

function runQA(asset, m, sheet) {
  const spec = specFor(asset);
  const checks = [
    checkPalette(m), checkSemi(m), checkSize(asset, m, spec), checkGrid(m),
    checkOutline(m, spec), checkLight(m), checkNight(m),
    checkFrames(asset, sheet), checkRatio(asset, m, spec)
  ];
  return { result: rollup(checks), checks };
}

/* ==================================================================
   7. 캔버스 — 전시대·환경 합성
   ================================================================== */

function paintBackdrop(ctx, w, h) {
  if (state.checker) return paintChecker(ctx, w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#f2efe7');
  g.addColorStop(1, '#d9d5ca');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function paintChecker(ctx, w, h) {
  const s = 8;
  ctx.fillStyle = '#e9e6de';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#cdc9c0';
  for (let y = 0; y < h; y += s) {
    paintCheckerRow(ctx, w, y, s);
  }
}

function paintCheckerRow(ctx, w, y, s) {
  for (let x = 0; x < w; x += s) {
    if (((x / s) + (y / s)) % 2 === 0) ctx.fillRect(x, y, s, s);
  }
}

/* 모든 전시대의 그림자는 같은 규칙(타원·#120b06 35%) — 에셋 간 비교를 방해하지 않기 위함. */
function paintShadow(ctx, cx, groundY, width) {
  ctx.save();
  ctx.fillStyle = 'rgba(18, 11, 6, 0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, groundY, Math.max(8, width * 0.42), Math.max(3, width * 0.13), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* 「왜」 그림자 폭은 캔버스가 아니라 콘텐츠 실루엣 폭을 따라야 에셋끼리 비교가 된다. */
function contentWidthOf(asset, img) {
  const m = state.metrics.get(asset.id);
  if (m && m.contentW > 0) return m.contentW;
  return img.naturalWidth;
}

/* 정수배만 허용: 축소가 필요하면 1/2, 1/3처럼 정수 분모로만 줄인다. */
function integerScale(ratio) {
  if (ratio >= 1) return Math.max(1, Math.floor(ratio));
  return 1 / Math.ceil(1 / ratio);
}

function fitScale(img, boxW, boxH) {
  return integerScale(Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight));
}

function drawSprite(ctx, img, cx, groundY, scale, smooth) {
  ctx.save();
  ctx.imageSmoothingEnabled = smooth === true;
  const dw = Math.round(img.naturalWidth * scale);
  const dh = Math.round(img.naturalHeight * scale);
  ctx.drawImage(img, Math.round(cx - dw / 2), Math.round(groundY - dh), dw, dh);
  ctx.restore();
}

function drawFrame(ctx, sheet, fr, cx, groundY, scale, smooth) {
  ctx.save();
  ctx.imageSmoothingEnabled = smooth === true;
  const dw = Math.round(fr.w * scale);
  const dh = Math.round(fr.h * scale);
  ctx.drawImage(sheet, fr.x, fr.y, fr.w, fr.h, Math.round(cx - dw / 2), Math.round(groundY - dh), dw, dh);
  ctx.restore();
}

/* --- 앵커·바운즈 오버레이 (meta.json 기하 계약) --- */

/* 「왜」 구 에셋 manifest에는 anchor/bounds/scaleFactor가 아예 없다. 숫자로 검증해 통과한 것만
   써야 콘솔 에러 없이 조용히 넘어간다. 타일은 원래 anchor가 없는 것이 정상이다. */
function geomAnchor(asset) {
  const a = asset && asset.anchor;
  if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return null;
  return { x: a.x, y: a.y };
}

function geomBounds(asset) {
  const b = asset && asset.bounds;
  if (!b || !Number.isFinite(b.w) || !Number.isFinite(b.h)) return null;
  return { x: num(b.x, 0), y: num(b.y, 0), w: b.w, h: b.h };
}

function geomFactor(asset) {
  const f = asset && asset.scaleFactor;
  if (!Number.isFinite(f) || f < 1) return null;
  return Math.round(f);
}

/* 스프라이트가 실제로 그려진 사각형 — 오버레이는 이 원점 기준으로 얹어야 어긋나지 않는다. */
function spriteRect(canvasW, groundY, src, scale) {
  const dw = Math.round(src.w * scale);
  const dh = Math.round(src.h * scale);
  return { x: Math.round(canvasW / 2 - dw / 2), y: Math.round(groundY - dh), w: dw, h: dh };
}

function paintOverlays(ctx, asset, rect, scale) {
  const ov = state.overlay;
  if (ov.canvas) strokeBox(ctx, rect.x, rect.y, rect.w, rect.h, OV_CANVAS, [3, 3]);
  const b = ov.bounds ? geomBounds(asset) : null;
  if (b) strokeBox(ctx, rect.x + b.x * scale, rect.y + b.y * scale, b.w * scale, b.h * scale, OV_BOUNDS, [4, 3]);
  const a = ov.anchor ? geomAnchor(asset) : null;
  if (a) paintAnchorCross(ctx, rect.x + a.x * scale, rect.y + a.y * scale);
}

function strokeBox(ctx, x, y, w, h, color, dash) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash(dash);
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.max(1, Math.round(w) - 1), Math.max(1, Math.round(h) - 1));
  ctx.restore();
}

/* 「왜」 앵커는 콘텐츠 하단 중앙이라 어두운 픽셀 위에 얹히기 쉽다 — 검은 밑선을 깔아야 노랑이 읽힌다. */
function paintAnchorCross(ctx, x, y) {
  const cx = Math.round(x) + 0.5;
  const cy = Math.round(y) + 0.5;
  ctx.save();
  ctx.setLineDash([]);
  strokeCrossAt(ctx, cx, cy, 'rgba(18, 11, 6, 0.85)', 3);
  strokeCrossAt(ctx, cx, cy, OV_ANCHOR, 1);
  ctx.restore();
}

function strokeCrossAt(ctx, cx, cy, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  strokeLine(ctx, cx, cy - 10, cx, cy + 10);
  strokeLine(ctx, cx - 10, cy, cx + 10, cy);
}

/* --- 환경 합성 (SPEC 4번) — 전시대 캔버스 전체에 적용한다 --- */
function applyEnv(ctx, w, h, env) {
  if (env === 'night') return tint(ctx, w, h, NIGHT.hex, NIGHT.alpha);
  if (env === 'indoor') return tint(ctx, w, h, '#3b2a18', 0.25);
  if (env === 'rain') return envRain(ctx, w, h);
  if (env === 'snow') return envSnow(ctx, w, h);
  if (env === 'torch') return envTorch(ctx, w, h);
}

function tint(ctx, w, h, hex, alpha) {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function envRain(ctx, w, h) {
  tint(ctx, w, h, '#2f5a7c', 0.34);
  const rnd = seedRandom(7);
  ctx.save();
  ctx.strokeStyle = 'rgba(168, 205, 224, 0.55)';
  ctx.lineWidth = 1;
  for (let i = 0; i < Math.round((w * h) / 900); i++) {
    strokeDrop(ctx, rnd() * w, rnd() * h, 10);
  }
  ctx.restore();
}

function strokeDrop(ctx, x, y, len) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - len * 0.35, y + len);
  ctx.stroke();
}

function envSnow(ctx, w, h) {
  tint(ctx, w, h, '#b5cbe8', 0.3);
  const rnd = seedRandom(13);
  ctx.save();
  ctx.fillStyle = 'rgba(253, 248, 236, 0.85)';
  for (let i = 0; i < Math.round((w * h) / 1400); i++) {
    ctx.fillRect(Math.round(rnd() * w), Math.round(rnd() * h), 2, 2);
  }
  ctx.restore();
}

function envTorch(ctx, w, h) {
  const cx = w / 2;
  const cy = h * 0.62;
  const r = Math.max(w, h) * 0.62;
  ctx.save();
  const dark = ctx.createRadialGradient(cx, cy, r * 0.18, cx, cy, r);
  dark.addColorStop(0, 'rgba(18, 11, 6, 0)');
  dark.addColorStop(1, 'rgba(18, 11, 6, 0.82)');
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, w, h);
  paintTorchGlow(ctx, cx, cy, r);
  ctx.restore();
}

function paintTorchGlow(ctx, cx, cy, r) {
  const warm = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.55);
  warm.addColorStop(0, 'rgba(255, 176, 80, 0.42)');
  warm.addColorStop(1, 'rgba(255, 122, 48, 0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = warm;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
}

/* ==================================================================
   8. 데이터 적재
   ================================================================== */

async function loadPalette(url) {
  const pal = await loadJSON(url);
  state.palette = pal;
  const list = flattenPalette(pal);
  state.paletteRGB = list.map((c) => c.rgb);
  state.outlineRGB = outlineAllowed(list).map((c) => c.rgb);
}

function assetURL(asset, file) {
  const base = String(asset.path || '').replace(/\/?$/, '/');
  return base + file;
}

/* 「왜」 originalPng은 게시 파이프라인이 나중에 추가한 키다. 구 에셋에는 없거나 파일이 빠져 있을 수
   있으니 실패를 정상 경로로 흡수하고, 없으면 대조 UI 자체를 감춘다. */
async function loadOriginal(asset) {
  if (!asset.originalPng) return null;
  const img = await loadImage(assetURL(asset, asset.originalPng));
  if (img) state.originals.set(asset.id, img);
  return img;
}

async function prepareAsset(asset) {
  const img = await loadImage(assetURL(asset, asset.still || 'base.png'));
  await loadOriginal(asset);
  if (!img) return markBroken(asset);
  state.images.set(asset.id, img);
  const sheet = await loadSheet(asset);
  const m = analyzeImage(img);
  state.metrics.set(asset.id, m);
  state.qa.set(asset.id, runQA(asset, m, sheet));
}

async function loadSheet(asset) {
  if (!asset.frames || !asset.frames.sheet) return null;
  const sheet = await loadImage(assetURL(asset, asset.frames.sheet));
  if (sheet) state.sheets.set(asset.id, sheet);
  return sheet;
}

function markBroken(asset) {
  state.qa.set(asset.id, {
    result: 'FAIL',
    checks: [chk('load', '로드', 'FAIL', '이미지를 불러오지 못했다: ' + assetURL(asset, asset.still || 'base.png'))]
  });
}

async function loadAssets(manifest) {
  const list = Array.isArray(manifest.assets) ? manifest.assets : [];
  state.assets = list;
  list.forEach((a) => state.byId.set(a.id, a));
  for (const asset of list) {
    await prepareAsset(asset);
  }
}

/* ==================================================================
   9. 목록·필터·정렬
   ================================================================== */

function subKeyOf(hall, asset) {
  const raw = String(asset.subcategory || '').toLowerCase();
  const hit = hall.subs.find((s) => s[0] === raw || s[1] === asset.subcategory);
  if (hit) return hit[0];
  return '_etc';
}

function matchSearch(asset) {
  const q = state.search.trim().toLowerCase();
  if (q === '') return true;
  const hay = [asset.id, asset.name, ...(asset.tags || [])].join(' ').toLowerCase();
  return hay.includes(q);
}

function matchFail(asset) {
  if (!state.failOnly) return true;
  const q = state.qa.get(asset.id);
  return q && q.result === 'FAIL';
}

function visibleAssets() {
  return state.assets.filter((a) => matchSearch(a) && matchFail(a));
}

function sortAssets(list, hall) {
  const copy = list.slice();
  if (hall.sort === 'size') return copy.sort((a, b) => contentArea(a) - contentArea(b));
  if (hall.sort === 'grade') return copy.sort((a, b) => GRADES.indexOf(a.grade) - GRADES.indexOf(b.grade));
  return copy.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));
}

function contentArea(asset) {
  const m = state.metrics.get(asset.id);
  if (!m) return 0;
  return m.contentW * m.contentH;
}

function hallAssets(hall) {
  return visibleAssets().filter((a) => a.category === hall.key);
}

/* ==================================================================
   10. 렌더 — 사이드바 / 기준 슬롯 / 전시홀
   ================================================================== */

function renderSidebar() {
  const nav = $('#sidebar');
  clear(nav);
  nav.appendChild(sideItem('전체 전시장', visibleAssets().length, 'cat', state.hall === 'all', () => selectHall('all', null)));
  HALLS.forEach((hall) => renderSideHall(nav, hall));
}

function renderSideHall(nav, hall) {
  const list = hallAssets(hall);
  const on = state.hall === hall.key && state.sub === null;
  const cls = 'cat' + (list.length === 0 ? ' empty' : '');
  nav.appendChild(sideItem(hall.label, list.length, cls, on, () => selectHall(hall.key, null)));
  if (state.hall !== hall.key) return;
  hall.subs.forEach((s) => renderSideSub(nav, hall, s, list));
}

function renderSideSub(nav, hall, sub, list) {
  const n = list.filter((a) => subKeyOf(hall, a) === sub[0]).length;
  const cls = 'sub' + (n === 0 ? ' empty' : '');
  const on = state.hall === hall.key && state.sub === sub[0];
  nav.appendChild(sideItem(sub[1], n, cls, on, () => selectHall(hall.key, sub[0])));
}

function sideItem(label, count, cls, on, onClick) {
  const node = el('div', 'side-item ' + cls + (on ? ' on' : ''));
  node.appendChild(el('span', null, label));
  node.appendChild(el('span', 'side-count', count === 0 ? '미등록' : String(count)));
  node.addEventListener('click', onClick);
  return node;
}

function selectHall(key, sub) {
  state.hall = key;
  state.sub = sub;
  renderSidebar();
  renderHalls();
}

function renderReference() {
  const slot = $('#reference-slot');
  clear(slot);
  const refId = state.manifest && state.manifest.reference;
  const asset = refId ? state.byId.get(refId) : null;
  slot.appendChild(referenceCanvas(asset));
  slot.appendChild(referenceText(asset, refId));
}

function referenceCanvas(asset) {
  const box = 128;
  const c = el('canvas');
  c.width = box;
  c.height = box;
  const ctx = c.getContext('2d');
  paintBackdrop(ctx, box, box);
  paintEmptyOrSprite(ctx, box, asset);
  applyEnv(ctx, box, box, state.env);
  if (asset) c.addEventListener('click', () => openViewer(asset.id));
  if (asset) c.style.cursor = 'pointer';
  return c;
}

function paintEmptyOrSprite(ctx, box, asset) {
  const groundY = box - 14;
  if (!asset || !state.images.get(asset.id)) return paintEmptyPedestal(ctx, box, groundY);
  const img = state.images.get(asset.id);
  const s = fitScale(img, box - GRID_PAD, box - GRID_PAD);
  paintShadow(ctx, box / 2, groundY, contentWidthOf(asset, img) * s);
  drawSprite(ctx, img, box / 2, groundY, s);
}

function paintEmptyPedestal(ctx, box, groundY) {
  ctx.save();
  ctx.strokeStyle = '#8b8577';
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(box * 0.25, groundY - box * 0.5, box * 0.5, box * 0.5);
  ctx.fillStyle = '#5e646c';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('빈 대좌', box / 2, groundY - box * 0.22);
  ctx.restore();
}

function referenceText(asset, refId) {
  const wrap = el('div');
  wrap.appendChild(el('h2', null, '기준 캐릭터 (스타일 원기)'));
  if (!asset) return fillRefEmpty(wrap, refId);
  const m = state.metrics.get(asset.id);
  const q = state.qa.get(asset.id);
  wrap.appendChild(el('div', 'ref-meta', `${asset.name} · ${asset.id} · ${m ? m.w + '×' + m.h : '—'} · v${asset.version || '—'}`));
  wrap.appendChild(el('div', 'ref-meta', `모든 신규 에셋은 이 캐릭터와 나란히 놓고 크기·명암·채도·광원·외곽선을 비교한다. QA: ${q ? q.result : '—'}`));
  return wrap;
}

function fillRefEmpty(wrap, refId) {
  wrap.appendChild(el('div', 'ref-empty', `기준 캐릭터 미등록 — manifest.reference = "${refId || '(없음)'}"`));
  wrap.appendChild(el('div', 'ref-empty', '기준 에셋을 먼저 등록해야 스타일 비교·크기 비율 QA가 의미를 가진다.'));
  return wrap;
}

function gridBox() {
  return Math.min(600, Math.max(152, Math.round(128 * state.zoom) + GRID_PAD));
}

function renderHalls() {
  const host = $('#halls');
  clear(host);
  document.documentElement.style.setProperty('--tile', (gridBox() + 20) + 'px');
  const halls = HALLS.filter((h) => state.hall === 'all' || h.key === state.hall);
  halls.forEach((hall) => host.appendChild(renderHall(hall)));
}

function renderHall(hall) {
  const sec = el('section', 'hall');
  const head = el('div', 'hall-head');
  head.appendChild(el('h2', null, hall.label));
  head.appendChild(el('span', 'hall-en', hall.key));
  sec.appendChild(head);
  const list = sortAssets(hallAssets(hall), hall);
  /* 「왜」 전체 보기에서 빈 홀의 소구획까지 다 펼치면 스크롤만 길어져 검수가 느려진다.
     빈 홀은 한 줄로 접고, 해당 홀을 선택했을 때만 소구획을 전부 펼친다. */
  if (list.length === 0 && state.hall === 'all') {
    sec.appendChild(el('div', 'empty-hall', '미등록 — 이 전시홀에는 아직 에셋이 없다'));
    return sec;
  }
  buckets(hall, list).forEach((b) => sec.appendChild(renderSubBlock(b)));
  return sec;
}

/* subcategory 정의가 없는 카테고리도 "전체" 한 구획으로 통일해 전시 규칙을 동일하게 유지한다. */
function buckets(hall, list) {
  const defs = hall.subs.length > 0 ? hall.subs.slice() : [['_all', '전체']];
  const out = defs.map((d) => ({ key: d[0], label: d[1], items: bucketItems(hall, list, d[0]) }));
  const etc = list.filter((a) => hall.subs.length > 0 && subKeyOf(hall, a) === '_etc');
  if (etc.length > 0) out.push({ key: '_etc', label: '기타', items: etc });
  if (state.sub === null) return out;
  return out.filter((b) => b.key === state.sub);
}

function bucketItems(hall, list, key) {
  if (key === '_all') return list;
  return list.filter((a) => subKeyOf(hall, a) === key);
}

function renderSubBlock(bucket) {
  const block = el('div', 'sub-block');
  const head = el('div', 'sub-head');
  head.appendChild(el('span', null, `${bucket.label} · ${bucket.items.length}`));
  block.appendChild(head);
  if (bucket.items.length === 0) block.appendChild(el('div', 'empty-hall', '미등록 — 이 전시홀에는 아직 에셋이 없다'));
  if (bucket.items.length > 0) block.appendChild(renderGrid(bucket.items));
  return block;
}

function renderGrid(items) {
  const grid = el('div', 'grid');
  items.forEach((a) => grid.appendChild(renderPedestal(a)));
  return grid;
}

function renderPedestal(asset) {
  const card = el('div', 'pedestal');
  card.appendChild(pedestalCanvas(asset));
  card.appendChild(el('div', 'ped-name', asset.name || asset.id));
  card.appendChild(pedestalSub(asset));
  card.appendChild(qaBadge(asset));
  card.addEventListener('click', () => openViewer(asset.id));
  return card;
}

function pedestalCanvas(asset) {
  const box = gridBox();
  const c = el('canvas');
  c.width = box;
  c.height = box;
  paintPedestal(c, asset);
  return c;
}

function paintPedestal(canvas, asset) {
  const box = canvas.width;
  const ctx = canvas.getContext('2d');
  const groundY = box - Math.round(box * 0.12);
  paintBackdrop(ctx, box, box);
  const img = state.images.get(asset.id);
  if (img) paintPedestalSprite(ctx, asset, img, box, groundY);
  if (!img) paintEmptyPedestal(ctx, box, groundY);
  applyEnv(ctx, box, box, state.env);
}

function paintPedestalSprite(ctx, asset, img, box, groundY) {
  const s = pedestalScale(img, box, groundY);
  paintShadow(ctx, box / 2, groundY, contentWidthOf(asset, img) * s);
  drawSprite(ctx, img, box / 2, groundY, s);
}

/* 그리드에서는 배율을 그대로 쓰되 전시대를 넘치면 맞춤 축소한다 — 잘린 실루엣은 검수가 안 된다. */
function pedestalScale(img, box, groundY) {
  const fit = fitScale(img, box - GRID_PAD, groundY - 8);
  const want = integerScale(state.zoom);
  if (fit < want) return fit;
  return want;
}

function pedestalSub(asset) {
  const m = state.metrics.get(asset.id);
  const row = el('div', 'ped-sub');
  row.appendChild(el('span', null, m ? `${m.w}×${m.h}` : '로드 실패'));
  if (asset.grade) row.appendChild(el('span', 'grade grade-' + asset.grade, GRADE_LABEL[asset.grade] || asset.grade));
  return row;
}

function qaBadge(asset) {
  const q = state.qa.get(asset.id);
  const result = q ? q.result : 'FAIL';
  return el('span', 'badge ' + result, result);
}

/* ==================================================================
   11. 뷰어
   ================================================================== */

function openViewer(id) {
  const asset = state.byId.get(id);
  if (!asset) return;
  state.view.id = id;
  state.view.anim = defaultAnim(asset);
  state.view.frame = 0;
  state.view.playing = true;
  $('#viewer').classList.remove('hidden');
  fillViewer(asset);
  startLoop();
}

function defaultAnim(asset) {
  if (!asset.frames || !asset.frames.anims) return null;
  const names = ANIM_ORDER.filter((n) => asset.frames.anims[n]);
  if (names.length === 0) return null;
  return names[0];
}

function closeViewer() {
  $('#viewer').classList.add('hidden');
  state.view.id = null;
  cancelAnimationFrame(state.view.raf);
}

function fillViewer(asset) {
  const q = state.qa.get(asset.id);
  $('#v-name').textContent = asset.name || asset.id;
  $('#v-id').textContent = asset.id;
  const badge = $('#v-badge');
  badge.className = 'badge static ' + (q ? q.result : 'FAIL');
  badge.textContent = q ? q.result : 'FAIL';
  fillInfo(asset);
  fillQA(asset);
  fillAnimButtons(asset);
  fillOriginal(asset);
  updateOverlayNote(asset);
  fillCompareSelect(asset);
  fillSizeControls(asset);
}

function updateOverlayNote(asset) {
  const has = [];
  if (geomAnchor(asset)) has.push('anchor');
  if (geomBounds(asset)) has.push('bounds');
  const txt = has.length > 0 ? has.join(' · ') + ' 기록됨' : 'anchor·bounds 미기록 (타일 또는 구 에셋)';
  $('#ov-note').textContent = txt;
}

function fillInfo(asset) {
  const m = state.metrics.get(asset.id);
  const dl = $('#v-info');
  clear(dl);
  infoRows(asset, m).forEach((row) => {
    dl.appendChild(el('dt', null, row[0]));
    dl.appendChild(el('dd', null, row[1]));
  });
}

function infoRows(asset, m) {
  return baseRows(asset, m).concat(geometryRows(asset));
}

/* 「왜」 필드가 없는 구 에셋에서도 표는 같은 모양을 유지해야 "빠졌다"는 사실이 눈에 띈다. */
function geometryRows(asset) {
  const b = geomBounds(asset);
  const a = geomAnchor(asset);
  return [
    ['픽셀 밀도', densityText(asset)],
    ['bounds', b ? `${b.w}×${b.h} @ (${b.x}, ${b.y})` : '— (미기록)'],
    ['anchor', a ? `(${a.x}, ${a.y})` : '— (타일 또는 미기록)'],
    ['raw.png', rawText(asset)]
  ];
}

function densityText(asset) {
  const f = geomFactor(asset);
  if (!f) return '— (미기록)';
  return `1/${f} (정수 축소 배율 ${f}×)`;
}

function rawText(asset) {
  if (!asset.originalPng) return '없음 (구 에셋)';
  if (state.originals.has(asset.id)) return `있음 · ${asset.originalPng}`;
  return `${asset.originalPng} — 로드 실패`;
}

function baseRows(asset, m) {
  const px = asset.pixelSize || (m ? [m.contentW, m.contentH] : null);
  return [
    ['이름', asset.name || '—'],
    ['ID', asset.id],
    ['카테고리', `${asset.category} / ${asset.subcategory || '—'}`],
    ['해상도', m ? `${m.w}×${m.h}` : '—'],
    ['pixelSize', px ? `${px[0]}×${px[1]} (측정 ${m ? m.contentW + '×' + m.contentH : '—'})` : '—'],
    ['프레임', frameSummary(asset)],
    ['버전', asset.version || '—'],
    ['팔레트 수', `${m ? m.colorCount : '—'}색 (메타 ${asset.paletteUsed || '—'})`],
    ['수정일', asset.updated || '—'],
    ['태그', (asset.tags || []).join(', ') || '—']
  ];
}

function frameSummary(asset) {
  if (!asset.frames || !asset.frames.anims) return '정지 1컷';
  const anims = asset.frames.anims;
  const total = Object.values(anims).reduce((s, a) => s + (a.count || 0), 0);
  return `${Object.keys(anims).length}종 · 총 ${total}프레임 · ${asset.frames.frameW}×${asset.frames.frameH}`;
}

function fillQA(asset) {
  const host = $('#v-qa');
  clear(host);
  const q = state.qa.get(asset.id);
  if (!q) return;
  q.checks.forEach((c) => host.appendChild(qaRow(c)));
}

function qaRow(c) {
  const row = el('div', 'qa-row');
  row.appendChild(el('span', null, c.label));
  row.appendChild(el('span', 'qa-status ' + c.status, c.status));
  row.appendChild(el('span', 'qa-detail', c.detail));
  return row;
}

/* --- 애니메이션 --- */
function fillAnimButtons(asset) {
  const host = $('#anim-buttons');
  clear(host);
  const anims = (asset.frames && asset.frames.anims) || {};
  ANIM_ORDER.forEach((name) => host.appendChild(animButton(name, anims[name])));
  if (Object.keys(anims).length === 0) host.appendChild(el('span', 'vid', '이 에셋은 정지 1컷이다 (frames 없음)'));
}

function animButton(name, def) {
  const btn = el('button', 'btn btn-sm' + (state.view.anim === name ? ' on' : ''), ANIM_LABEL[name]);
  btn.type = 'button';
  btn.disabled = !def;
  if (!def) btn.title = '미등록';
  if (def) btn.addEventListener('click', () => selectAnim(name));
  return btn;
}

function selectAnim(name) {
  state.view.anim = name;
  state.view.frame = 0;
  state.view.playing = true;
  const asset = state.byId.get(state.view.id);
  fillAnimButtons(asset);
  $('#anim-play').textContent = '일시정지';
}

function animDef(asset) {
  if (!asset || !asset.frames || !state.view.anim) return null;
  const def = asset.frames.anims[state.view.anim];
  if (!def) return null;
  return def;
}

function animFps(name, def) {
  if (def && def.fps) return def.fps;
  return ANIM_FPS[name] || 10;
}

function frameRect(asset, def, index) {
  const f = asset.frames;
  return { x: index * f.frameW, y: def.row * f.frameH, w: f.frameW, h: f.frameH };
}

function stepFrame(delta) {
  const asset = state.byId.get(state.view.id);
  const def = animDef(asset);
  if (!def) return;
  state.view.playing = false;
  $('#anim-play').textContent = '재생';
  state.view.frame = (state.view.frame + delta + def.count) % def.count;
  renderStages();
}

function advance(ts) {
  const asset = state.byId.get(state.view.id);
  const def = animDef(asset);
  if (!def) return;
  const dt = Math.min(200, ts - state.view.last);
  state.view.acc += dt;
  const step = 1000 / animFps(state.view.anim, def);
  if (state.view.acc < step) return;
  state.view.acc = 0;
  nextFrame(def);
}

function nextFrame(def) {
  const last = def.count - 1;
  if (state.view.frame < last) { state.view.frame++; return; }
  if (ANIM_LOOP.has(state.view.anim)) { state.view.frame = 0; return; }
  state.view.playing = false;
  $('#anim-play').textContent = '재생';
}

function startLoop() {
  cancelAnimationFrame(state.view.raf);
  state.view.last = performance.now();
  const tick = (ts) => {
    if (state.view.id === null) return;
    if (state.view.playing) advance(ts);
    state.view.last = ts;
    renderStages();
    state.view.raf = requestAnimationFrame(tick);
  };
  state.view.raf = requestAnimationFrame(tick);
}

/* --- 스테이지(nearest vs 브라우저 기본) --- */
function renderStages() {
  const asset = state.byId.get(state.view.id);
  if (!asset) return;
  paintStage($('#stage-near'), asset, false);
  paintStage($('#stage-smooth'), asset, true);
  updateAnimInfo(asset);
  renderSizePreview(asset);
}

function paintStage(canvas, asset, smooth) {
  fitStageCanvas(canvas, asset);
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const groundY = h - Math.round(h * 0.14);
  paintBackdrop(ctx, w, h);
  paintStageSprite(ctx, asset, w, groundY, smooth);
  applyEnv(ctx, w, h, state.env);
  /* 「왜」 환경 합성 뒤에 그려야 밤·횃불에서 오버레이 선까지 같이 어두워지지 않는다. */
  paintOverlays(ctx, asset, spriteRect(w, groundY, spriteSize(asset), state.zoom), state.zoom);
}

/* 「왜」 400% 배율에서 스프라이트가 잘리면 외곽선 검수를 못 한다 — 무대를 배율에 맞춰 넓힌다. */
function fitStageCanvas(canvas, asset) {
  const src = spriteSize(asset);
  const w = Math.max(470, Math.round(src.w * state.zoom) + 48);
  const h = Math.max(430, Math.round(src.h * state.zoom) + 72);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
}

function spriteSize(asset) {
  const def = animDef(asset);
  if (def) return { w: asset.frames.frameW, h: asset.frames.frameH };
  const img = state.images.get(asset.id);
  if (img) return { w: img.naturalWidth, h: img.naturalHeight };
  return { w: 128, h: 128 };
}

function paintStageSprite(ctx, asset, w, groundY, smooth) {
  const def = animDef(asset);
  const sheet = state.sheets.get(asset.id);
  const img = state.images.get(asset.id);
  if (def && sheet) return paintStageFrame(ctx, asset, def, sheet, w, groundY, smooth);
  if (!img) return paintEmptyPedestal(ctx, w, groundY);
  paintShadow(ctx, w / 2, groundY, contentWidthOf(asset, img) * state.zoom);
  drawSprite(ctx, img, w / 2, groundY, state.zoom, smooth);
}

function paintStageFrame(ctx, asset, def, sheet, w, groundY, smooth) {
  const fr = frameRect(asset, def, Math.min(state.view.frame, def.count - 1));
  paintShadow(ctx, w / 2, groundY, contentWidthOf(asset, sheet) * state.zoom);
  drawFrame(ctx, sheet, fr, w / 2, groundY, state.zoom, smooth);
}

function updateAnimInfo(asset) {
  const zoomTxt = `배율 ${Math.round(state.zoom * 100)}%`;
  const def = animDef(asset);
  if (!def) { $('#anim-info').textContent = zoomTxt + ' · 정지 1컷'; return; }
  const loop = loopLabel(state.view.anim);
  $('#anim-info').textContent =
    `${ANIM_LABEL[state.view.anim]} · ${state.view.frame + 1}/${def.count} · ${animFps(state.view.anim, def)}fps · ${loop} · ${zoomTxt}`;
}

function loopLabel(name) {
  if (ANIM_LOOP.has(name)) return '루프';
  return '1회';
}

/* --- 원본 대조 (배경 제거 전 raw.png ↔ 최종 base.png) --- */

function srcW(img) { return img.naturalWidth || img.width; }
function srcH(img) { return img.naturalHeight || img.height; }

function fillOriginal(asset) {
  const has = state.originals.has(asset.id);
  $('#orig-panel').classList.toggle('hidden', !has);
  if (!has) return;
  fillCmpModes();
  renderOriginal(asset);
}

function fillCmpModes() {
  const host = $('#orig-modes');
  clear(host);
  host.appendChild(el('span', 'group-label', '보기'));
  buildToggleGroup(host, CMP_MODES, (i) => i.id === state.view.cmp, (i) => setCmpMode(i.id));
}

function setCmpMode(id) {
  state.view.cmp = id;
  syncToggleGroup($('#orig-modes'), id);
  renderOriginal(state.byId.get(state.view.id));
}

function renderOriginal(asset) {
  if (!asset) return;
  const raw = state.originals.get(asset.id);
  if (!raw) return;
  const c = $('#orig-canvas');
  const ctx = c.getContext('2d');
  const fin = state.images.get(asset.id);
  paintBackdrop(ctx, c.width, c.height);
  paintCmpMode(ctx, c, raw, fin);
  $('#orig-note').textContent = cmpNote(asset, raw, fin);
}

function paintCmpMode(ctx, c, raw, fin) {
  const mode = state.view.cmp;
  if (mode === 'original') return paintFitted(ctx, raw, 0, c.width, c.height, '원본 raw.png (배경 제거 전)');
  if (mode === 'final') return paintFitted(ctx, fin, 0, c.width, c.height, '최종 base.png (배경 제거 후)');
  if (mode === 'side') return paintSideBySide(ctx, c, raw, fin);
  paintDiff(ctx, c, raw, fin);
}

function paintSideBySide(ctx, c, raw, fin) {
  const half = c.width / 2;
  paintFitted(ctx, raw, 0, half, c.height, 'ORIGINAL · raw.png');
  paintFitted(ctx, fin, half, half, c.height, 'FINAL · base.png');
  paintCompareDivider(ctx, half, c.height);
}

function paintDiff(ctx, c, raw, fin) {
  if (!fin) return paintFitted(ctx, raw, 0, c.width, c.height, '최종 base.png 없음 — 원본만 표시');
  const merged = diffCanvas(raw, fin);
  paintFitted(ctx, merged, 0, c.width, c.height, '겹쳐보기 · 빨강=제거로 사라진 픽셀 · 청록=최종 실루엣');
}

/* 「왜」 검수용이라 nearest 고정이다 — 보간이 끼면 실루엣 경계가 거짓말을 한다. */
function paintFitted(ctx, img, x0, w, h, label) {
  if (!img) return;
  const s = Math.min((w - 24) / srcW(img), (h - 36) / srcH(img));
  const dw = Math.max(1, Math.round(srcW(img) * s));
  const dh = Math.max(1, Math.round(srcH(img) * s));
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, Math.round(x0 + (w - dw) / 2), Math.round((h - 28 - dh) / 2) + 6, dw, dh);
  ctx.restore();
  paintCmpLabel(ctx, label, x0 + w / 2, h - 10);
}

function paintCmpLabel(ctx, text, cx, y) {
  ctx.save();
  ctx.fillStyle = '#3b2318';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, cx, y);
  ctx.restore();
}

/* 「왜」 raw.png는 알파 없는 RGB로 저장된다. 그래서 "원본에만 있는 픽셀"을 알파로는 못 가른다 —
   테두리 최빈색을 배경으로 보고 실루엣을 추정한 뒤, 최종을 원본 크기에 nearest로 맞춰 픽셀 대 픽셀로 비교한다. */
function diffCanvas(raw, fin) {
  const w = srcW(raw);
  const h = srcH(raw);
  const src = drawToCanvas(raw, w, h);
  const dst = drawToCanvas(fin, w, h);
  const a = src.ctx.getImageData(0, 0, w, h);
  const b = dst.ctx.getImageData(0, 0, w, h);
  markLostPixels(a.data, b.data, backgroundOf(a.data, w, h));
  src.ctx.putImageData(a, 0, 0);
  return src.canvas;
}

function drawToCanvas(img, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  if (img) ctx.drawImage(img, 0, 0, w, h);
  return { canvas, ctx };
}

function markLostPixels(a, b, bg) {
  for (let i = 0; i < a.length; i += 4) {
    if (b[i + 3] >= SILHOUETTE_A) { blendPixel(a, i, KEPT_RGB, 0.3); continue; }
    if (colorDist(a[i], a[i + 1], a[i + 2], bg) > BG_TOL) { blendPixel(a, i, LOST_RGB, 0.72); continue; }
    blendPixel(a, i, FADE_RGB, 0.9);
  }
}

function blendPixel(d, i, rgb, k) {
  d[i] = Math.round(d[i] * (1 - k) + rgb[0] * k);
  d[i + 1] = Math.round(d[i + 1] * (1 - k) + rgb[1] * k);
  d[i + 2] = Math.round(d[i + 2] * (1 - k) + rgb[2] * k);
  d[i + 3] = 255;
}

function colorDist(r, g, b, c) {
  return Math.sqrt((r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2);
}

function borderKey(data, w, x, y) {
  const i = (y * w + x) * 4;
  return (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
}

function borderHistogram(data, w, h) {
  const map = new Map();
  const bump = (k) => map.set(k, (map.get(k) || 0) + 1);
  for (let x = 0; x < w; x++) { bump(borderKey(data, w, x, 0)); bump(borderKey(data, w, x, h - 1)); }
  for (let y = 0; y < h; y++) { bump(borderKey(data, w, 0, y)); bump(borderKey(data, w, w - 1, y)); }
  return map;
}

function backgroundOf(data, w, h) {
  const best = topColors(borderHistogram(data, w, h), 1)[0];
  if (!best) return [255, 0, 255];
  const k = best[0];
  return [(k >> 16) & 255, (k >> 8) & 255, k & 255];
}

function cmpNote(asset, raw, fin) {
  const f = geomFactor(asset);
  const dens = f ? ` · 픽셀 밀도 1/${f}` : '';
  const rw = raw ? `${srcW(raw)}×${srcH(raw)}` : '—';
  const fw = fin ? `${srcW(fin)}×${srcH(fin)}` : '—';
  return `원본 ${rw} → 최종 ${fw}${dens} · 원본은 최대 변 256 축소본이라 정렬은 근사다. 빨강 덩어리가 보이면 배경 제거가 콘텐츠를 삼킨 것이다.`;
}

/* --- 스타일 비교 (SPEC 7번) --- */
function fillCompareSelect(asset) {
  const sel = $('#cmp-select');
  clear(sel);
  state.assets.forEach((a) => {
    const o = el('option', null, `${a.name || a.id} (${a.id})`);
    o.value = a.id;
    sel.appendChild(o);
  });
  sel.value = defaultCompareId(asset);
  renderCompare(asset, state.byId.get(sel.value));
}

function defaultCompareId(asset) {
  const ref = state.manifest && state.manifest.reference;
  if (ref && state.byId.has(ref) && ref !== asset.id) return ref;
  const other = state.assets.find((a) => a.id !== asset.id);
  if (other) return other.id;
  return asset.id;
}

function renderCompare(a, b) {
  paintCompareCanvas(a, b);
  fillCompareTable(a, b);
}

function paintCompareCanvas(a, b) {
  const c = $('#cmp-canvas');
  const ctx = c.getContext('2d');
  const half = c.width / 2;
  paintBackdrop(ctx, c.width, c.height);
  const s = sharedCompareScale(a, b, half, c.height);
  paintCompareSide(ctx, a, 0, half, c.height, s);
  paintCompareSide(ctx, b, half, half, c.height, s);
  paintCompareDivider(ctx, half, c.height);
  applyEnv(ctx, c.width, c.height, state.env);
}

/* 「왜」 좌우를 서로 다른 배율로 그리면 "크기 비교"가 거짓말이 된다 — 같은 배율로 맞춘다. */
function sharedCompareScale(a, b, w, h) {
  const imgs = [a, b].filter(Boolean).map((x) => state.images.get(x.id)).filter(Boolean);
  if (imgs.length === 0) return 1;
  return Math.min(...imgs.map((img) => fitScale(img, w - 40, h - 70)));
}

function paintCompareSide(ctx, asset, x0, w, h, s) {
  if (!asset) return;
  const img = state.images.get(asset.id);
  const groundY = h - 34;
  if (!img) return;
  paintShadow(ctx, x0 + w / 2, groundY, contentWidthOf(asset, img) * s);
  drawSprite(ctx, img, x0 + w / 2, groundY, s);
  paintCompareLabel(ctx, asset, x0 + w / 2, h - 12, s);
}

function paintCompareLabel(ctx, asset, cx, y, s) {
  ctx.save();
  ctx.fillStyle = '#3b2318';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${asset.name || asset.id} · ×${s}`, cx, y);
  ctx.restore();
}

function paintCompareDivider(ctx, x, h) {
  ctx.save();
  ctx.strokeStyle = 'rgba(59, 35, 24, 0.35)';
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(x, 8);
  ctx.lineTo(x, h - 8);
  ctx.stroke();
  ctx.restore();
}

function fillCompareTable(a, b) {
  const table = $('#cmp-table');
  clear(table);
  const ma = state.metrics.get(a.id);
  const mb = b ? state.metrics.get(b.id) : null;
  table.appendChild(compareHead(a, b));
  compareRows(ma, mb).forEach((r) => table.appendChild(compareRow(r)));
}

function compareHead(a, b) {
  const tr = el('tr');
  tr.appendChild(el('th', null, '항목'));
  tr.appendChild(el('th', null, a.name || a.id));
  tr.appendChild(el('th', null, b ? (b.name || b.id) : '—'));
  return tr;
}

function compareRows(ma, mb) {
  return [
    ['콘텐츠 크기', txt(ma, (m) => `${m.contentW}×${m.contentH}px`), txt(mb, (m) => `${m.contentW}×${m.contentH}px`)],
    ['캔버스', txt(ma, (m) => `${m.w}×${m.h}`), txt(mb, (m) => `${m.w}×${m.h}`)],
    ['평균 luma', txt(ma, (m) => m.meanLuma.toFixed(1)), txt(mb, (m) => m.meanLuma.toFixed(1))],
    ['평균 채도', txt(ma, (m) => m.meanSat.toFixed(1) + '%'), txt(mb, (m) => m.meanSat.toFixed(1) + '%')],
    ['사용 색 수', txt(ma, (m) => String(m.colorCount)), txt(mb, (m) => String(m.colorCount))],
    ['주요색 8', swatchesOf(ma), swatchesOf(mb)],
    ['외곽선 색', txt(ma, (m) => m.outlineColor[0]), txt(mb, (m) => m.outlineColor[0])],
    ['추정 픽셀 그리드', txt(ma, (m) => m.grid + 'px'), txt(mb, (m) => m.grid + 'px')]
  ];
}

function txt(m, fn) {
  if (!m) return '—';
  return fn(m);
}

function swatchesOf(m) {
  const wrap = el('div', 'swatches');
  if (!m) return wrap;
  m.swatches.forEach((s) => {
    const sw = el('span', 'sw');
    sw.style.background = s[0];
    sw.title = `${s[0]} · ${s[1]}px`;
    wrap.appendChild(sw);
  });
  return wrap;
}

function compareRow(cells) {
  const tr = el('tr');
  tr.appendChild(el('td', 'head', cells[0]));
  tr.appendChild(compareCell(cells[1]));
  tr.appendChild(compareCell(cells[2]));
  return tr;
}

function compareCell(value) {
  const td = el('td');
  if (typeof value === 'string') td.textContent = value;
  if (typeof value !== 'string') td.appendChild(value);
  return td;
}

/* --- 사이즈 조정 + 내보내기 (SPEC 10번) --- */
function overrideOf(asset) {
  const cur = state.overrides.get(asset.id);
  if (cur) return cur;
  return { scale: num(asset.scale, 1), offsetX: num(asset.offsetX, 0), offsetY: num(asset.offsetY, 0) };
}

function num(v, dflt) {
  if (typeof v === 'number' && isFinite(v)) return v;
  return dflt;
}

function fillSizeControls(asset) {
  const o = overrideOf(asset);
  $('#size-scale').value = o.scale;
  $('#size-scale-num').value = o.scale;
  $('#size-offx').value = o.offsetX;
  $('#size-offy').value = o.offsetY;
  updateChangedLabel();
}

function applySize(scale, ox, oy, source) {
  const asset = state.byId.get(state.view.id);
  if (!asset) return;
  const clamped = Math.min(4, Math.max(0.25, Math.round(scale * 100) / 100));
  state.overrides.set(asset.id, { scale: clamped, offsetX: Math.round(ox), offsetY: Math.round(oy) });
  syncScaleInputs(clamped, source);
  updateChangedLabel();
  renderSizePreview(asset);
}

/* 「왜」 사용자가 직접 타이핑 중인 입력칸을 되쓰면 커서가 튄다 — 반대쪽만 동기화한다. */
function syncScaleInputs(value, source) {
  if (source !== 'range') $('#size-scale').value = value;
  if (source !== 'number') $('#size-scale-num').value = value;
}

function isChanged(id) {
  const asset = state.byId.get(id);
  const o = state.overrides.get(id);
  if (!asset || !o) return false;
  if (o.scale !== num(asset.scale, 1)) return true;
  if (o.offsetX !== num(asset.offsetX, 0)) return true;
  return o.offsetY !== num(asset.offsetY, 0);
}

function changedIds() {
  return [...state.overrides.keys()].filter(isChanged);
}

function updateChangedLabel() {
  const n = changedIds().length;
  $('#export-count').textContent = `(${n})`;
  $('#size-changed').textContent = n === 0 ? '변경분 없음' : `변경된 에셋 ${n}개`;
}

/* 64px 타일 그리드 = 1 논리타일(16px)의 마스터 스케일. 배치 감각을 여기서 확인한다. */
function renderSizePreview(asset) {
  const c = $('#size-preview');
  const ctx = c.getContext('2d');
  paintBackdrop(ctx, c.width, c.height);
  const groundY = c.height - 44;
  paintTileGrid(ctx, c.width, c.height, groundY);
  paintRefGhost(ctx, asset, groundY);
  paintAdjusted(ctx, asset, groundY);
  applyEnv(ctx, c.width, c.height, state.env);
}

function paintTileGrid(ctx, w, h, groundY) {
  ctx.save();
  ctx.strokeStyle = 'rgba(59, 35, 24, 0.22)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 64) strokeLine(ctx, x + 0.5, 0, x + 0.5, h);
  for (let y = groundY; y >= 0; y -= 64) strokeLine(ctx, 0, y + 0.5, w, y + 0.5);
  ctx.strokeStyle = 'rgba(59, 35, 24, 0.5)';
  strokeLine(ctx, 0, groundY + 0.5, w, groundY + 0.5);
  ctx.restore();
}

function strokeLine(ctx, x0, y0, x1, y1) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function paintRefGhost(ctx, asset, groundY) {
  const ref = refImage();
  if (!ref) return;
  ctx.save();
  ctx.globalAlpha = 0.35;
  const s = integerScale(Math.min(1, 160 /ref.naturalHeight));
  drawSprite(ctx, ref, 76, groundY, s);
  ctx.restore();
}

function refImage() {
  const refId = state.manifest && state.manifest.reference;
  if (!refId) return null;
  return state.images.get(refId) || null;
}

function paintAdjusted(ctx, asset, groundY) {
  const img = state.images.get(asset.id);
  if (!img) return;
  const o = overrideOf(asset);
  const base = integerScale(Math.min(1, 160 /img.naturalHeight));
  const s = base * o.scale;
  paintShadow(ctx, 240 + o.offsetX, groundY + o.offsetY, contentWidthOf(asset, img) * s);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const dw = Math.round(img.naturalWidth * s);
  const dh = Math.round(img.naturalHeight * s);
  ctx.drawImage(img, Math.round(240 - dw / 2 + o.offsetX), Math.round(groundY - dh + o.offsetY), dw, dh);
  ctx.restore();
}

function buildOverrideJSON() {
  const overrides = {};
  changedIds().forEach((id) => {
    overrides[id] = trimOverride(state.overrides.get(id), state.byId.get(id));
  });
  return JSON.stringify({ version: 1, overrides }, null, 2);
}

/* 기본값과 같은 필드는 빼서 클로드에게 붙여넣을 때 잡음을 줄인다. */
function trimOverride(o, asset) {
  const out = {};
  if (o.scale !== num(asset.scale, 1)) out.scale = o.scale;
  if (o.offsetX !== num(asset.offsetX, 0)) out.offsetX = o.offsetX;
  if (o.offsetY !== num(asset.offsetY, 0)) out.offsetY = o.offsetY;
  return out;
}

function exportOverrides() {
  const json = buildOverrideJSON();
  downloadJSON(json);
  copyToClipboard(json);
}

function downloadJSON(json) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = 'size-overrides.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function copyToClipboard(text) {
  const ok = () => toast(`size-overrides.json 내려받기 + 클립보드 복사 완료 (${changedIds().length}건)`);
  if (!navigator.clipboard) return fallbackCopy(text, ok);
  navigator.clipboard.writeText(text).then(ok, () => fallbackCopy(text, ok));
}

function fallbackCopy(text, ok) {
  const ta = el('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  ok();
}

/* ==================================================================
   12. 툴바 · 이벤트
   ================================================================== */

function buildToggleGroup(host, items, isOn, onPick) {
  items.forEach((item) => {
    const btn = el('button', 'btn btn-sm' + (isOn(item) ? ' on' : ''), item.label);
    btn.type = 'button';
    btn.dataset.value = String(item.id);
    btn.addEventListener('click', () => onPick(item));
    host.appendChild(btn);
  });
}

function syncToggleGroup(host, value) {
  host.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.value === String(value)));
}

function buildEnvGroups() {
  const pick = (item) => setEnv(item.id);
  buildToggleGroup($('#env-group'), ENVS, (i) => i.id === state.env, pick);
  buildToggleGroup($('#v-env-group'), ENVS, (i) => i.id === state.env, pick);
}

function buildZoomGroups() {
  const items = ZOOMS.map((z) => ({ id: z, label: Math.round(z * 100) + '%' }));
  const pick = (item) => setZoom(item.id);
  buildToggleGroup($('#zoom-group'), items, (i) => i.id === state.zoom, pick);
  buildToggleGroup($('#v-zoom-group'), items, (i) => i.id === state.zoom, pick);
}

function setEnv(id) {
  state.env = id;
  syncToggleGroup($('#env-group'), id);
  syncToggleGroup($('#v-env-group'), id);
  redrawAll();
}

function setZoom(z) {
  state.zoom = z;
  syncToggleGroup($('#zoom-group'), z);
  syncToggleGroup($('#v-zoom-group'), z);
  redrawAll();
}

function redrawAll() {
  renderReference();
  renderHalls();
  if (state.view.id === null) return;
  const asset = state.byId.get(state.view.id);
  renderStages();
  renderOriginal(asset);
  renderCompare(asset, state.byId.get($('#cmp-select').value));
}

function bindEvents() {
  bindSearch();
  bindViewerControls();
  bindOverlayControls();
  bindSizeControls();
  $('#btn-export').addEventListener('click', exportOverrides);
  $('#size-export').addEventListener('click', exportOverrides);
  document.addEventListener('keydown', onKey);
}

function bindSearch() {
  $('#search').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderSidebar();
    renderHalls();
  });
  $('#filter-fail').addEventListener('change', (e) => {
    state.failOnly = e.target.checked;
    renderSidebar();
    renderHalls();
  });
  $('#toggle-checker').addEventListener('change', (e) => {
    state.checker = e.target.checked;
    redrawAll();
  });
}

function bindViewerControls() {
  $('#v-close').addEventListener('click', closeViewer);
  $('#anim-play').addEventListener('click', togglePlay);
  $('#anim-prev').addEventListener('click', () => stepFrame(-1));
  $('#anim-next').addEventListener('click', () => stepFrame(1));
  $('#cmp-select').addEventListener('change', (e) => {
    renderCompare(state.byId.get(state.view.id), state.byId.get(e.target.value));
  });
}

function bindOverlayControls() {
  ['anchor', 'bounds', 'canvas'].forEach(bindOverlayToggle);
}

function bindOverlayToggle(key) {
  $('#ov-' + key).addEventListener('change', (e) => setOverlay(key, e.target.checked));
}

function setOverlay(key, on) {
  state.overlay[key] = on;
  renderStages();
}

function togglePlay() {
  state.view.playing = !state.view.playing;
  if (state.view.playing) { $('#anim-play').textContent = '일시정지'; return; }
  $('#anim-play').textContent = '재생';
}

function bindSizeControls() {
  $('#size-scale').addEventListener('input', () => readSize($('#size-scale').value, 'range'));
  $('#size-scale-num').addEventListener('input', () => readSize($('#size-scale-num').value, 'number'));
  $('#size-offx').addEventListener('input', () => readSize($('#size-scale').value, 'offset'));
  $('#size-offy').addEventListener('input', () => readSize($('#size-scale').value, 'offset'));
  $('#size-reset').addEventListener('click', resetSize);
}

function readSize(raw, source) {
  const scale = parseFloat(raw);
  if (!isFinite(scale)) return;
  const ox = parseInt($('#size-offx').value, 10) || 0;
  const oy = parseInt($('#size-offy').value, 10) || 0;
  applySize(scale, ox, oy, source);
}

function resetSize() {
  const asset = state.byId.get(state.view.id);
  if (!asset) return;
  state.overrides.delete(asset.id);
  fillSizeControls(asset);
  renderSizePreview(asset);
}

function onKey(e) {
  if (e.key === 'Escape') closeViewer();
  if (state.view.id === null) return;
  if (e.key === 'ArrowLeft') stepFrame(-1);
  if (e.key === 'ArrowRight') stepFrame(1);
}

/* ==================================================================
   13. 부트
   ================================================================== */

async function boot() {
  buildEnvGroups();
  buildZoomGroups();
  bindEvents();
  const manifest = await safeManifest();
  state.manifest = manifest;
  await safePalette(manifest);
  await loadAssets(manifest);
  renderSidebar();
  renderReference();
  renderHalls();
  reportSummary();
}

async function safeManifest() {
  try {
    const base = await loadJSON(MANIFEST_URL);
    const handmade = await loadJSON('assets/handmade-manifest.json').catch(() => ({ assets: [] }));
    const byId = new Map((base.assets || []).map((asset) => [asset.id, asset]));
    (handmade.assets || []).forEach((asset) => byId.set(asset.id, asset));
    base.assets = [...byId.values()];
    return base;
  } catch (err) {
    toast('manifest.json을 읽지 못했다 — 빈 전시장으로 연다');
    return { version: 1, palette: PALETTE_FALLBACK_URL, reference: null, assets: [] };
  }
}

async function safePalette(manifest) {
  try {
    await loadPalette(manifest.palette || PALETTE_FALLBACK_URL);
  } catch (err) {
    toast('팔레트를 읽지 못했다 — 팔레트 QA는 생략된다');
    state.paletteRGB = [];
    state.outlineRGB = [];
  }
}

function reportSummary() {
  const n = state.assets.length;
  if (n === 0) return toast('등록된 에셋이 없다 — 모든 전시홀이 "미등록" 상태다');
  const fails = state.assets.filter((a) => (state.qa.get(a.id) || {}).result === 'FAIL').length;
  toast(`에셋 ${n}개 분석 완료 · FAIL ${fails}개`);
}

boot();
