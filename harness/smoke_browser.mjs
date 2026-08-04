// smoke_browser.mjs — **실브라우저(헤드리스 크롬)** 연기 검사. ★ v3 기준 재작성.
//
//   jsdom 하니스는 캔버스를 흉내 내고 레이아웃이 없다. 그래서 실브라우저에서만 드러나는 사고
//   (지도 미도착 → 화면 갇힘, 클릭 가로채기, 그리기 예외로 애니메이션 루프 사망, 안개가 안 걷힘,
//   프레임 저하)를 못 잡는다. 이 검사는 진짜 크롬을 띄워 **진짜 마우스 입력**으로
//   타이틀 → 개척 시작 → 마차 오프닝 → 나무 3연타 스윙 → 배치대 → 안개 속 걷기 → 프레임 측정까지 밟는다.
//
//   실행: npm run smoke
//   크롬이 없으면 **건너뛰고 경고만 남긴다**(종료 코드 0). 경로는 CHROME_PATH 로 지정할 수 있다.
//
//   구현 노트: puppeteer 같은 의존성을 새로 들이지 않는다. Node 22 의 내장 WebSocket 으로
//   크롬 개발자 도구 규약(CDP)에 직접 말을 건다.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ────────────────────────────────────────────────────────────────
// 0. 크롬 찾기 — 없으면 건너뛴다
// ────────────────────────────────────────────────────────────────
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser', '/usr/bin/chromium',
  '/snap/bin/chromium',
  '/tmp/chromium',                       // @sparticuz/chromium 이 풀어 놓는 자리
].filter(Boolean);

const CHROME = CANDIDATES.find((p) => { try { return existsSync(p); } catch { return false; } });
if (!CHROME) {
  console.warn('⚠ 크롬을 찾지 못해 실브라우저 검사를 건너뜁니다.');
  console.warn('  크롬(또는 엣지)을 설치하거나 CHROME_PATH 로 실행 파일 경로를 알려 주세요.');
  console.warn('  예) CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" npm run smoke');
  process.exit(0);
}

// ────────────────────────────────────────────────────────────────
// 1. 얇은 CDP 클라이언트
// ────────────────────────────────────────────────────────────────
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error('개발자 도구에 붙지 못했습니다: ' + url));
    });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id != null && c.pending.has(m.id)) {
        const { res, rej } = c.pending.get(m.id); c.pending.delete(m.id);
        if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result);
      } else if (m.method) for (const h of c.handlers) h(m);
    };
    return c;
  }
  on(fn) { this.handlers.push(fn); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch { /* 이미 닫힘 */ } }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  });
}

async function getJson(url, tries = 100) {
  for (let i = 0; i < tries; i += 1) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch { /* 아직 */ }
    await sleep(200);
  }
  throw new Error('응답이 없습니다: ' + url);
}

// ────────────────────────────────────────────────────────────────
// 2. 검사 뼈대
// ────────────────────────────────────────────────────────────────
const steps = [];
let failed = 0;
function pass(name, extra) { steps.push({ ok: true, name, extra }); console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); }
function fail(name, why) { steps.push({ ok: false, name, why }); failed += 1; console.error(`  ✗ ${name} — ${why}`); }
function must(cond, name, why) { if (cond) pass(name); else fail(name, why || '조건 불충족'); return cond; }

const SAVES = mkdtempSync(join(tmpdir(), 'gm-smoke-'));
const PROFILE = mkdtempSync(join(tmpdir(), 'gm-chrome-'));
process.env.GALLAEMALLAE_SAVES_DIR = SAVES;
process.env.NODE_ENV = 'test';

let chrome = null; let page = null; let browser = null; let http = null;

function cleanup() {
  try { page?.close(); } catch { /* 이미 닫힘 */ }
  try { browser?.close(); } catch { /* 이미 닫힘 */ }
  try { chrome?.kill(); } catch { /* 이미 죽음 */ }
  try { http?.close(); } catch { /* 이미 닫힘 */ }
  for (const d of [SAVES, PROFILE]) { try { rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch { /* 지워지든 말든 */ } }
}

try {
  console.log('실브라우저 연기 검사 —', CHROME);

  // ── 서버 ──
  const port = await freePort();
  const srv = await import(new URL('../server/index.js', import.meta.url).href);
  http = srv.http;
  await new Promise((r) => http.listen(port, '127.0.0.1', r));
  const health = await getJson(`http://127.0.0.1:${port}/api/health`);
  must(health.ok, '서버가 문을 열었다', '/api/health 가 ok 가 아니다');
  must(health.protocol === '3.1', '서버가 v3.1 규약을 쓴다', `protocol=${health.protocol}`);

  // ── 크롬 ──
  const dp = await freePort();
  chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--hide-scrollbars', '--mute-audio', '--window-size=1280,800',
    `--remote-debugging-port=${dp}`, `--user-data-dir=${PROFILE}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', () => { /* 크롬 잡소리는 삼킨다 */ });

  const version = await getJson(`http://127.0.0.1:${dp}/json/version`);
  browser = await CDP.connect(version.webSocketDebuggerUrl);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const list = await getJson(`http://127.0.0.1:${dp}/json/list`);
  const target = list.find((t) => t.id === targetId);
  page = await CDP.connect(target.webSocketDebuggerUrl);

  const errors = [];
  page.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push('예외: ' + String(d.exception?.description || d.text).split('\n')[0]);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('콘솔: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      errors.push('기록: ' + m.params.entry.text);
    }
  });
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  await page.send('Page.enable');
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__frames=0;(function f(){window.__frames++;requestAnimationFrame(f);})();
      window.__onWorld = function (wx, wy) {
        var c = document.querySelector('#world-canvas'); if (!c || !window.GM || !GM.camera) return false;
        var r = c.getBoundingClientRect(); var p = GM.camera.worldToScreen(wx, wy);
        var el = document.elementFromPoint(r.left + p.x, r.top + p.y);
        return !!el && el.id === 'world-canvas';
      };
      // 스윙 동안 파티클·자원 팝이 실제로 생겼는지 훔쳐본다(최댓값을 기억)
      window.__fxPeak = { parts: 0, pops: 0 };
      setInterval(function () {
        if (!window.GM || !GM.fx || !GM.fx.counts) return;
        var c = GM.fx.counts();
        if (c.parts > window.__fxPeak.parts) window.__fxPeak.parts = c.parts;
        if (c.pops > window.__fxPeak.pops) window.__fxPeak.pops = c.pops;
      }, 30);`,
  });

  const ev = async (expression) => {
    const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).split('\n')[0]);
    return r.result.value;
  };
  const until = async (expression, { ms = 20000, what = expression } = {}) => {
    const t0 = Date.now();
    for (;;) {
      let v = false;
      try { v = await ev(expression); } catch { v = false; }
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error(`기다리다 지쳤습니다: ${what}`);
      await sleep(120);
    }
  };
  const clickAt = async (x, y, { button = 'left' } = {}) => {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1, buttons: button === 'right' ? 2 : 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1, buttons: 0 });
  };
  /** ★ GDD3 §12-5 — 이동은 이제 **우클릭**이다. 좌클릭은 고르고 만질 뿐 걷지 않는다. */
  const walkTo = async (x, y) => clickAt(x, y, { button: 'right' });
  const rectOf = async (sel) => ev(`(function(){var n=document.querySelector(${JSON.stringify(sel)});
      if(!n) return null; var r=n.getBoundingClientRect();
      return {x:r.left+r.width/2, y:r.top+r.height/2, w:r.width, h:r.height};})()`);
  const clickSel = async (sel) => {
    const r = await rectOf(sel);
    if (!r || !r.w) throw new Error(`누를 것이 없습니다: ${sel}`);
    await clickAt(r.x, r.y);
  };
  const worldPoint = async (wx, wy) => ev(`(function(){
      var c=document.querySelector('#world-canvas'); var r=c.getBoundingClientRect();
      var p=GM.camera.worldToScreen(${wx},${wy});
      var x=r.left+p.x, y=r.top+p.y;
      var el=document.elementFromPoint(x,y);
      return {x:x, y:y, inside: !!el && el.id==='world-canvas',
              over: el ? (el.id || el.className || el.tagName) : 'none'};})()`);
  const typeText = async (sel, text) => {
    await clickSel(sel);
    for (const ch of text) await page.send('Input.insertText', { text: ch });
    await ev(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new Event('input',{bubbles:true}))`);
  };

  // ── 1. 타이틀 ──
  // ★ 씨앗 고정 — 매번 다른 땅을 받으면 실패가 코드 탓인지 지도 탓인지 알 수 없다.
  //   다른 땅으로 돌려 보고 싶으면 SMOKE_SEED 로 바꾼다.
  const SEED = process.env.SMOKE_SEED || '20260804';
  await page.send('Page.navigate', { url: `http://127.0.0.1:${port}/?seed=${SEED}` });
  await until('!!(window.GM && GM.state && GM.app)', { what: '화면 부팅' });
  await sleep(400);
  must(await ev(`!document.querySelector('#scene-title').hidden`), '타이틀 화면이 떴다');
  must(await ev(`typeof window.io === 'function'`), 'socket.io 가 실려 있다');
  must(await until('GM.state.S.connected === true', { ms: 8000, what: '서버 연결' }), '서버에 닿았다');
  must(await ev(`GM.PROTOCOL === ${JSON.stringify(health.protocol)}`), '화면과 서버의 규약 판번호가 같다',
    `화면 ${await ev('GM.PROTOCOL')} ≠ 서버 ${health.protocol}`);

  // ── 2. 개척 시작 (진짜 클릭·타이핑) ──
  await clickSel('#btn-new');
  await until(`!document.querySelector('#scene-found').hidden`, { what: '개척 화면' });
  await typeText('#found-name', '서온');
  const diff = await ev(`!!document.querySelector('#found-diff .diff-card')`);
  must(diff, '난이도 카드가 그려졌다');
  if (diff) await clickSel('#found-diff .diff-card:nth-child(2)');
  must(await ev(`document.querySelector('#found-start').disabled === false`), '「마차에 오른다」가 눌릴 수 있다');
  await clickSel('#found-start');

  // ── 3. 월드 진입 — 여기가 P0 자리다 ──
  const gotMap = await until('!!GM.state.S.map', { ms: 15000, what: '월드 스냅샷(지도)' }).catch(() => false);
  must(gotMap, '지도를 받아 월드에 들어갔다', '지도가 오지 않았다 — 화면이 갇히는 그 사고다');
  must(await ev(`!document.querySelector('#shell').hidden`), '게임 화면이 열렸다');
  must(await ev(`GM.state.S.boot.phase !== 'failed'`), '부팅에 실패 표시가 없다', await ev('GM.state.S.boot.hint || ""'));
  await until('!!(GM.state.S.view && GM.state.S.view.nation)', { what: '정착지 상태' });
  must(await ev('GM.state.tierNo() === 0'), '야영지(티어 0)에서 시작한다');
  must(await ev('GM.state.residents().length === 0'), '주민 0에서 시작한다');

  // ── 4. 마차 오프닝 ──
  const openingShown = await until('GM.opening.busy()', { ms: 8000, what: '마차 오프닝' }).catch(() => false);
  must(openingShown, '마차 도착 오프닝이 재생된다');
  if (openingShown) {
    must(await ev(`!!document.querySelector('#opening-skip')`), '건너뛰기 단추가 있다');
    await clickSel('#opening-skip');
    must(await until('!GM.opening.busy()', { ms: 6000, what: '오프닝 종료' }).catch(() => false),
      '진짜 클릭으로 오프닝을 건너뛰었다');
  }
  await sleep(300);

  // ── 5. 1장 불씨 — 화면에 거의 아무것도 없다 (GDD3 §11-1) ──
  const chips = await ev(`[...document.querySelectorAll('#res-bar .res-chip')].map(function(c){return c.getAttribute('data-k');}).join(',')`);
  must(chips === 'grain,wood,stone', '야영지 HUD 는 자원 3칸뿐이다', `자원칸: ${chips}`);
  must(await ev(`!document.querySelector('#goal-card').hidden`), '목표 카드가 보인다');
  must(await ev(`GM.state.chapter().id === 1`), '1장 불씨에서 시작한다');
  must(await ev(`document.querySelector('#cabinet').hidden === true`), '각료는 아직 화면에 없다');
  must(await ev(`document.querySelector('#badge-threat').hidden === true`), '위협 배지도 아직 없다');
  must(await ev(`GM.state.buildable().length === 0 && !document.querySelector('#tb-build')`),
    '★ 지을 것이 없으니 배치대 단추가 아예 없다', '잠긴 단추가 남아 있다');
  must(await ev(`GM.state.S.view.wave === null && GM.state.S.view.market === undefined`),
    '★ 잠긴 계층은 뷰에도 없다 (웨이브·시장)');
  must(await ev(`(function(){var c=document.querySelector('#world-canvas');var r=c.getBoundingClientRect();
      var el=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
      return !!el && el.id==='world-canvas';})()`), '월드 한가운데가 실제로 눌리는 자리다',
    '무엇인가가 월드 캔버스를 덮고 있다');

  // ── 6. 그림이 살아 있는가 ──
  //   ★ 캔버스 한 귀퉁이만 비교하면 '가만히 있는 풀밭'이 찍혀 헛경보가 난다.
  //     ① 화면 전체를 성기게 훑어 서명을 뜨고 ② 카메라를 실제로 옮겨서
  //     '다시 그리라'는 요구에 그림이 반응하는지 본다(얼어붙은 캔버스의 진짜 판별).
  const sig = () => ev(`(function(){var c=document.querySelector('#world-canvas');var g=c.getContext('2d');
      var d=g.getImageData(0,0,c.width,c.height).data;
      var h=0;for(var i=0;i<d.length;i+=997)h=(h*31+d[i])>>>0;return h;})()`);
  const f0 = await ev('window.__frames');
  const drawn0 = await ev('GM.world.frameStats().n');
  const s0 = await sig();
  await ev(`(function(){var t=GM.state.myTown(); GM.camera.moveTo(t.x+4, t.y+4);})()`);
  await sleep(1000);
  const f1 = await ev('window.__frames');
  const drawn1 = await ev('GM.world.frameStats().n');
  const s1 = await sig();
  must(f1 > f0, '화면이 계속 그려진다 (애니메이션 루프 살아 있음)', `프레임 ${f0} → ${f1}`);
  must(drawn1 !== drawn0 || drawn1 > 0, '월드 그리기 루프가 돈다', `표본 ${drawn0} → ${drawn1}`);
  must(s0 !== s1, '카메라를 옮기면 월드가 실제로 다시 그려진다', '캔버스가 두 번 다 똑같다 — 얼어붙었다');
  await ev(`(function(){var t=GM.state.myTown(); GM.camera.moveTo(t.x, t.y);})()`);

  // ── 7. ★ 나무 3연타 스윙 (진짜 마우스 누름) ──
  const treeRaw = await ev(`(function(){
      var t = GM.state.myTown();
      var best = null, bd = 1e9;
      GM.state.nodeList().forEach(function(n){
        if (n.type !== 'forest' || n.depleted) return;
        if (!GM.state.inTerritory(n.x, n.y)) return;
        var d = Math.hypot(n.x - t.x, n.y - t.y);
        if (d < bd) { bd = d; best = n; }
      });
      return best ? JSON.stringify({id:best.id, x:best.x, y:best.y}) : null;})()`);
  must(!!treeRaw, '시작 영토에 벨 나무가 있다');
  if (treeRaw) {
    const tree = JSON.parse(treeRaw);
    // 나무 옆 **걸을 수 있는** 빈 땅을 눌러 걸어간다 (진짜 마우스).
    //   아무 이웃 칸이나 찍으면 물·바위가 걸려 제자리에 서 버린다(걸음은 탐색이 아니라 직진이다).
    //   그리고 '나무가 가장 가까운 자리'를 고른다 — 곁에 바위가 더 붙어 있으면 게임은 그쪽을 잡는다.
    const stepRaw = await ev(`(function(){
        var w = GM.state.worldCfg();
        var ok = (w && w.terrain && w.terrain.walkable) || ['grass','forest','rock','fertile'];
        var best = null, bestScore = -1e9;
        [[1,1],[1,0],[0,1],[-1,1],[1,-1],[-1,0],[0,-1],[-1,-1]].forEach(function(d){
          var x = ${tree.x} + d[0], y = ${tree.y} + d[1];
          if (ok.indexOf(GM.state.terrainKey(x,y)) < 0) return;
          if (GM.state.nodeAt(x,y)) return;
          var dTree = Math.hypot(x - ${tree.x}, y - ${tree.y});
          var dOther = 1e9;
          GM.state.nodeList().forEach(function(n){
            if (n.id === ${JSON.stringify(tree.id)} || n.depleted) return;
            dOther = Math.min(dOther, Math.hypot(n.x - x, n.y - y));
          });
          var score = dOther - dTree;
          if (score > bestScore) { bestScore = score; best = {x:x, y:y}; }
        });
        return best ? JSON.stringify(best) : null;})()`);
    must(!!stepRaw, '나무 곁에 발 디딜 자리가 있다');
    const stepTo = JSON.parse(stepRaw || `{"x":${tree.x + 1},"y":${tree.y + 1}}`);
    const dest = await worldPoint(stepTo.x, stepTo.y);

    // ★ GDD3 §12-5 ① — **좌클릭 지면은 걷지 않는다**. 목적지가 생기지 않아야 한다.
    await ev('GM.avatar.stop()');
    if (dest.inside) await clickAt(dest.x, dest.y);
    await sleep(220);
    must(await ev('GM.avatar.destPos() === null'),
      '★ 좌클릭 지면은 이동이 아니다 (선택 전용)', '좌클릭이 아직 걷게 한다');

    // ★ GDD3 §12-5 ② — 우클릭 지면이 걷는다. 목적지에 이동 마커가 남는다.
    if (dest.inside) await walkTo(dest.x, dest.y);
    await sleep(220);
    must(await ev('!!GM.avatar.destPos()'), '★ 우클릭 지면이 이동 명령이다 (이동 마커)');
    const arrived = await until(
      `(function(){var p=GM.avatar.pos(); return p && Math.hypot(p.x-${tree.x}, p.y-${tree.y}) <= 2.6;})()`,
      { ms: 12000, what: '나무 곁 도착' }).catch(() => false);
    must(arrived, '우클릭으로 나무 곁까지 걸어갔다');
    // 도끼질 전에 걸음을 멈춘다 — 걸으면서 치면 사거리 밖으로 흘러 나간다
    await ev('GM.avatar.stop()');
    await sleep(120);

    await ev('window.__fxPeak = {parts:0, pops:0}; GM.world.resetStats();');
    const before = await ev('JSON.stringify(GM.state.nation().resources)').then(JSON.parse);
    /* ★ 누를 자리는 '나무 칸'이 아니라 **지금 손이 닿는 대상**의 칸이다.
       걸어간 자리 곁에 바위가 더 가까이 있으면 게임은 그쪽을 잡는다(그게 정상 동작이다) —
       나무 칸을 고집하면 스윙이 아니라 '빈 땅 클릭'이 되어 헛경보가 난다. */
    const tgtRaw = await until(`(function(){var t=GM.swing.target();
        return t ? JSON.stringify({x:t.x, y:t.y, kind:t.kind, type:t.nodeType||t.kind}) : false;})()`,
      { ms: 6000, what: '손이 닿는 대상' }).catch(() => null);
    must(!!tgtRaw, '나무 곁에 서니 손이 닿는 대상이 잡힌다');
    const tgt = JSON.parse(tgtRaw || `{"x":${tree.x},"y":${tree.y},"type":"forest"}`);
    // ★ GDD3 §11-3 — 상호작용 프롬프트: 대상 위에 「E — 나무 베기」가 붙는다
    const verb = await ev(`GM.world.verbFor(GM.swing.target())`);
    must(verb === 'E — 나무 베기', '대상에 상호작용 라벨이 붙는다', `라벨: ${verb}`);
    const markerRaw = await ev(`JSON.stringify(GM.state.goalTargets())`);
    const markers = JSON.parse(markerRaw || '[]');
    must(markers.length > 0 && markers[0].kind === 'node', '목표 카드가 나무 자리를 가리킨다', markerRaw);
    const tp = await worldPoint(tgt.x, tgt.y);
    must(tp.inside, '그 대상이 실제로 눌리는 자리에 있다');
    // 누르고 있는 동안 쿨타임에 맞춰 연속으로 스윙한다
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tp.x, y: tp.y, button: 'none' });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tp.x, y: tp.y, button: 'left', clickCount: 1, buttons: 1 });
    const swung = await until('GM.swing.stats().swings >= 3', { ms: 12000, what: '3연타 스윙' }).catch(() => false);
    /* 첫 30분 시나리오 그대로 — 천막 값(목재)이 모일 때까지 계속 벤다 */
    const tentWood = await ev(`(function(){var b=GM.state.buildableOf('tent');
        return (b && b.cost && b.cost.wood) || 10;})()`);
    const stocked = await until(`GM.state.nation().resources.wood >= ${tentWood}`,
      { ms: 20000, what: '천막 값 목재' }).catch(() => false);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tp.x, y: tp.y, button: 'left', clickCount: 1, buttons: 0 });
    must(swung, `누르고 있으니 도끼질이 세 번 이어졌다 (${tgt.type})`, `스윙 ${await ev('GM.swing.stats().swings')}회`);
    must(stocked, `벤 나무가 천막 값(목재 ${tentWood})을 채웠다`,
      `목재 ${await ev('GM.state.nation().resources.wood')}`);

    const peak = await ev('JSON.stringify(window.__fxPeak)').then(JSON.parse);
    must(peak.parts > 0, '타격마다 파편이 튄다', `파편 최대 ${peak.parts}`);
    must(peak.pops > 0, '자원이 아크를 그리며 위쪽 자원칸으로 빨려 들어간다', `자원 팝 최대 ${peak.pops}`);
    const after = await ev('JSON.stringify(GM.state.nation().resources)').then(JSON.parse);
    const sum = (o) => Object.values(o).reduce((a, v) => a + v, 0);
    must(sum(after) > sum(before), '자원이 실제로 늘었다 (서버 장부)',
      `${sum(before).toFixed(1)} → ${sum(after).toFixed(1)}`);
    must(await ev('GM.swing.cooldown().ratio < 1 || GM.swing.ready()'), '스윙 쿨타임 링이 돈다');
    must(await ev('GM.swing.stats().cycles >= 0'), '한 그루 주기 셈이 돈다');
  }

  // ── 8. 배치대 — ★ 1장을 지나야 비로소 단추가 생긴다 ──
  must(await until('GM.state.chapter().id >= 2', { ms: 8000, what: '2장 열림' }).catch(() => false),
    '★ 목재 10을 모으니 스스로 2장(첫 지붕)이 열렸다');
  await sleep(300);
  must(await ev(`!!document.querySelector('#tb-build')`), '이제서야 세우기 단추가 생겼다');
  await clickSel('#tb-build');
  await until(`document.querySelector('#place-bar').hidden === false`, { what: '배치대' });
  const tabs = await ev(`[...document.querySelectorAll('#place-bar .pb-tab')].map(function(b){return b.getAttribute('data-cat');}).join(',')`);
  must(/housing/.test(tabs), '배치대에 주거 갈래가 있다', `갈래: ${tabs}`);
  const items = await ev(`[...document.querySelectorAll('#place-bar .pb-item')].map(function(b){return b.getAttribute('data-place');}).join('|')`);
  must(/천막/.test(items), '주거 갈래에 천막이 있다', items);
  must(!/오두막|곡창|화살탑/.test(items), '★ 아직 못 짓는 것은 아예 목록에 없다', items);
  const picked = await ev(`(function(){
      var b=[...document.querySelectorAll('#place-bar .pb-item')].filter(function(x){
        return !x.disabled && /천막/.test(x.getAttribute('data-place')||'');})[0];
      if(!b) return null; b.click(); return b.getAttribute('data-place');})()`);
  must(!!picked, '천막을 골랐다 (자재가 모였다)');
  if (picked) {
    const spot = await ev(`(function(){
        var t = GM.state.myTown(); var pl = GM.state.S.placing; if(!pl) return null;
        for (var r=2;r<=8;r++) for (var dy=-r;dy<=r;dy++) for (var dx=-r;dx<=r;dx++){
          if (Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
          var x=t.x+dx, y=t.y+dy;
          if (GM.build.validate(pl,x,y).ok && window.__onWorld(x,y)) return JSON.stringify({x:x,y:y});
        } return null;})()`);
    must(!!spot, '고스트가 초록이 되는 자리를 찾았다');
    if (spot) {
      const { x, y } = JSON.parse(spot);
      const sites0 = await ev('GM.state.sites().length');
      const p = await worldPoint(x, y);
      if (p.inside) await clickAt(p.x, p.y);
      else await ev(`GM.build.commit(${x},${y})`);
      const built = await until(`GM.state.sites().length > ${sites0}`, { ms: 8000, what: '공사 현장' }).catch(() => false);
      must(built, '진짜 마우스로 천막 자리를 잡았다', '공사 현장이 생기지 않았다');
      const where = await ev('JSON.stringify(GM.state.sites().slice(-1)[0])').then(JSON.parse).catch(() => null);
      must(where && where.x === x && where.y === y, '고른 그 자리에 공사가 섰다', JSON.stringify(where));
    }
  }
  await ev('GM.build.close()');

  // ── 8-b. ★ 마커가 가리키는 대로만 6장(감정)까지 (GDD3 §11-6) ──
  //   「설명 없이 처음 하는 사람이 각 장을 순서대로 통과한다」를 **실브라우저에서** 확인한다.
  //   화면이 스스로 가리키는 것(goal.targets)만 보고 움직인다 — 스모크가 각본을 쥐지 않는다.
  await ev(`window.__chain = (function(){
    var log = [];
    function goal(){ return GM.state.goal(); }
    function key(){ var c = GM.state.chapter(); return c.id + ':' + (goal() ? goal().key : 'done'); }
    function send(evt, payload){ return new Promise(function(res){ GM.net.send(evt, payload, res); }); }
    function stepDay(){ return fetch('/api/debug/step', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ gameId: GM.state.S.gameId }) }).then(function(r){ return r.json(); }); }
    var now = Date.now() + 20000;
    function nodesOf(types){
      var me = GM.avatar.pos() || GM.state.myTown();
      return GM.state.nodeList().filter(function(n){
        if (types.indexOf(n.type) < 0 || n.depleted) return false;
        if (!GM.state.inTerritory(n.x, n.y)) return false;
        if (n.type === 'fertile' || n.type === 'field') return !!n.harvestReady;
        return true;
      }).sort(function(a,b){ return Math.hypot(a.x-me.x,a.y-me.y) - Math.hypot(b.x-me.x,b.y-me.y); });
    }
    var SRC = { wood:['forest'], stone:['rock'], grain:['water','field','fertile'] };
    async function gather(res, amount, budget){
      for (var i=0;i<budget && (GM.state.nation().resources[res]||0) < amount;i++){
        var n = nodesOf(SRC[res] || ['forest'])[0];
        if (!n) return false;
        GM.avatar.setPos(n.x+1, n.y);
        now += 2500;
        await send('actionSwing', { nodeId: n.id, now: now });
      }
      return (GM.state.nation().resources[res]||0) >= amount;
    }
    function findSpot(pl){
      var t = GM.state.territory();
      for (var r=2;r<=Math.floor(t.radius);r++)
        for (var dy=-r;dy<=r;dy++) for (var dx=-r;dx<=r;dx++){
          if (Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
          var x=t.cx+dx, y=t.cy+dy;
          if (GM.build.validate(pl,x,y).ok) return {x:x,y:y};
        }
      return null;
    }
    async function place(slot){
      var btn = document.querySelector(slot.sel || '#tb-build');
      if (!btn) return false;
      if (!GM.build.isOpen()) btn.click();
      var item = null;
      var cats = ['housing','production','civic','military','decor'];
      for (var i=0;i<cats.length && !item;i++){
        GM.build.setCat(cats[i]);
        item = [].slice.call(document.querySelectorAll('#place-bar .pb-item')).filter(function(b){
          return (b.getAttribute('data-place')||'').indexOf(slot.name) === 0; })[0];
      }
      if (!item) { window.__why = 'no-item:' + slot.name; GM.build.close(); return false; }
      if (item.disabled) { window.__why = 'disabled:' + slot.name; GM.build.close(); return false; }
      item.click();
      var spot = findSpot(GM.state.S.placing);
      if (!spot) { window.__why = 'no-spot:' + slot.name; GM.build.close(); return false; }
      var before = GM.state.sites().length;
      GM.build.commit(spot.x, spot.y);
      for (var k=0;k<40 && GM.state.sites().length<=before;k++) await new Promise(function(r){setTimeout(r,25);});
      GM.build.close();
      if (GM.state.sites().length <= before) window.__why = 'commit-failed:' + slot.name;
      return GM.state.sites().length > before;
    }
    function met(c){
      if (!c) return true;
      if (c.type==='resource') return (GM.state.nation().resources[c.resource]||0) >= c.amount;
      if (c.type==='structure') return GM.state.structures().filter(function(s){return s.key===c.building;}).length >= (c.count||1);
      if (c.type==='population') return (GM.state.nation().population||0) >= c.count;
      return false;
    }
    async function actOn(c, targets){
      if (c.type === 'resource') { if (!await gather(c.resource, c.amount, 14)) await stepDay(); return; }
      if (c.type === 'swings') {
        var t0 = (targets||[]).filter(function(x){return x.kind==='node';})[0];
        if (!t0) { await stepDay(); return; }
        GM.avatar.setPos(t0.x+1, t0.y); now += 2500;
        await send('actionSwing', { nodeId: t0.id, now: now }); return;
      }
      if (c.type === 'structure' || c.type === 'population') {
        var site = (targets||[]).filter(function(x){return x.kind==='site';})[0];
        if (site) { GM.avatar.setPos(site.x+1, site.y); now += 2500; await send('actionSwing', { siteId: site.id, now: now }); return; }
        var slot = (targets||[]).filter(function(x){return x.kind==='buildSlot';})[0];
        if (slot) {
          var b = GM.state.buildableOf(slot.id);
          if (b && !b.affordable) {
            for (var res in b.cost) if (Object.prototype.hasOwnProperty.call(b.cost,res)) {
              if ((GM.state.nation().resources[res]||0) < b.cost[res]) { if(!await gather(res, b.cost[res]+6, 40)) await stepDay(); return; }
            }
          }
          if (await place(slot)) return;
        }
        if (c.type === 'population' && (GM.state.nation().resources.grain||0) < 40) await gather('grain', 60, 16);
        await stepDay(); return;
      }
      if (c.type === 'flag' && c.flag === 'appraised') {
        var st = GM.state.structures().filter(function(x){return x.key==='appraisal_post';})[0];
        if (!st) { await stepDay(); return; }
        GM.structure.open(st.id);
        var b2 = document.querySelector('#st-appraise');
        if (b2) b2.click();
        await new Promise(function(r){setTimeout(r,600);});
        return;
      }
      await stepDay();
    }
    /* ★ GDD3 §12-2 — 조건이 차면 본부를 눌러 [승격]. 저절로 오르지 않는다. */
    window.__promotions = 0;
    async function promoteIfReady(){
      var nx = GM.state.tier().next;
      if (!nx || !nx.ready) return false;
      var hq = GM.state.hq();
      if (!hq) return false;
      GM.structure.open(hq.id);
      var b = document.querySelector('#se-promote');
      if (!b || b.disabled) { GM.hud.hideContext(); return false; }
      var t0 = GM.state.tierNo();
      b.click();
      for (var i=0;i<80 && GM.state.tierNo()===t0;i++) await new Promise(function(r){setTimeout(r,25);});
      GM.hud.hideContext();
      if (GM.state.tierNo() > t0) window.__promotions++;
      return true;
    }
    return async function run(target){
      for (var guard=0; guard<900 && GM.state.chapter().id < target; guard++){
        var g = goal();
        if (!g) { await stepDay(); continue; }
        await promoteIfReady();
        var c = g.condition || {};
        var list = (c.type==='all'||c.type==='any') ? (c.of||[]) : [c];
        var pending = list.filter(function(x){return !met(x);})[0] || list[0];
        var before = key();
        await actOn(pending, g.targets);
        if (key() !== before) log.push(before);
        await new Promise(function(r){setTimeout(r,3);});
      }
      await promoteIfReady();
      var g2 = goal();
      return JSON.stringify({ chapter: GM.state.chapter().id, log: log, day: GM.state.S.view.day,
        stuck: g2 ? g2.key : null, have: g2 ? g2.have : null, need: g2 ? g2.need : null,
        targets: (g2 && g2.targets || []).map(function(x){return x.kind + ':' + (x.id||'');}).join(','),
        why: window.__why || null,
        res: JSON.stringify(GM.state.nation().resources), pop: GM.state.nation().population,
        beds: (GM.state.housing()||{}).freeBeds, guard: guard });
    };
  })();`);

  let chainRaw = null;
  try { chainRaw = await ev('window.__chain(6)'); } catch (e) { chainRaw = null; }
  const chain = chainRaw ? JSON.parse(chainRaw) : null;
  must(chain && chain.chapter >= 6, '★ 마커가 가리키는 대로만 6장(땅의 비밀)까지 왔다',
    chain ? `${chain.chapter}장 「${chain.stuck}」 ${chain.have}/${chain.need} · 마커 ${chain.targets}`
      + ` · 인구 ${chain.pop} 잠자리 ${chain.beds} · ${chain.res} · 반복 ${chain.guard} · 막힌 곳 ${chain.why}` : '사슬 주행이 예외로 끝났다');
  if (chain && chain.chapter >= 6) {
    must(await ev('GM.state.buildingOn("appraisal_post")'), '6장에서 감정소가 배치대에 나왔다');
    // ── 8-c. ★ §12-2 본부 클릭 → 정착지 패널 (진짜 마우스) ──
    must(await ev('window.__promotions >= 2'), '★ 사슬을 지나는 동안 [승격]을 손으로 눌렀다',
      `승격 ${await ev('window.__promotions')}회 — 티어는 저절로 오르지 않는다`);
    const hqRaw = await ev(`(function(){var b=GM.state.hq(); return b ? JSON.stringify({id:b.id,x:b.cx,y:b.cy,fw:b.fw,fh:b.fh,tier:b.tier}) : null;})()`);
    must(!!hqRaw, '정착지 본부가 있다');
    if (hqRaw) {
      const hq = JSON.parse(hqRaw);
      must(hq.fw === 4 && hq.fh === 4, '본부는 4×4 대형 구조물이다', `${hq.fw}×${hq.fh}`);
      must(hq.tier === (await ev('GM.state.tierNo()')) + 1, '본부 외형이 정착지 티어를 따라간다');
      // 승격 도감 카드는 팡파레가 끝난 2.1초 뒤에 뜬다 — 다 뜨기를 기다렸다가 사람이 하듯 닫는다
      await sleep(2600);
      for (let k = 0; k < 20; k += 1) {
        await ev(`(function(){
            var list = [].slice.call(document.querySelectorAll('#modal-root .modal-foot .btn'));
            var b = list.length ? list[list.length - 1] : document.querySelector('#modal-root .x-btn');
            if (b) b.click(); else GM.ui.closeTopModal();
            GM.ui.coachClear && GM.ui.coachClear();
            GM.hud.hideContext(); GM.build.close();})()`);
        await sleep(140);
        if (!(await ev(`!document.querySelector('#modal-root .modal')`))) continue;
        break;
      }
      await ev(`GM.camera.reset(${hq.x},${hq.y})`);
      await sleep(900);
      // 4×4 사각형 안에서 실제로 눌리는 칸을 하나 고른다 (HUD 가 덮은 자리는 피한다)
      //   사람이 서 있는 칸은 피한다 — 거기를 누르면 (당연히) 그 사람이 골라진다
      let hp = null;
      let over = '';
      for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [1, 0], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
        const free = await ev(`(function(){
            return !GM.state.residents().some(function(v){
              var a = GM.world.unitPos(v.id) || v;
              return Math.hypot(a.x - (${hq.x} + ${dx}), a.y - (${hq.y} + ${dy})) < 1.1;
            });})()`);
        if (!free) continue;
        const p = await worldPoint(hq.x + dx, hq.y + dy);
        if (p.inside) { hp = p; break; }
        over = p.over;
      }
      const modalTitle = await ev(`(function(){var t=document.querySelector('#modal-root .modal-title');
          return t ? t.textContent : '';})()`);
      must(!!hp, '본부가 실제로 눌리는 자리에 있다', `가려짐: ${over} · 열린 창: ${modalTitle || '없음'}`);
      if (hp) await clickAt(hp.x, hp.y);          // 좌클릭 = 상호작용
      const opened = await until(`(function(){var p=document.querySelector('#context-panel');
          return !!p && !p.hidden && /정착지/.test(p.textContent);})()`,
        { ms: 5000, what: '정착지 패널' }).catch(() => false);
      must(opened, '★ 본부를 누르니 정착지 패널이 열렸다',
        `고른 것 ${await ev('JSON.stringify(GM.state.S.selection)')}`
        + ` · 패널 ${await ev(`(function(){var p=document.querySelector('#context-panel');
            return p.hidden ? '숨김' : (p.textContent||'').slice(0,40);})()`)}`);
      const rows = await ev(`document.querySelectorAll('#context-panel .req-row').length`);
      must(rows >= 2, '다음 단계 조건이 줄줄이 그려진다', `조건 ${rows}줄`);
      const painted = await ev(`[...document.querySelectorAll('#context-panel .req-row')]
        .every(function(r){return r.classList.contains('ok')||r.classList.contains('bad');})`);
      must(painted, '★ 조건마다 초록(충족)/빨강(미충족)으로 칠해진다');
      must(await ev(`!!document.querySelector('#context-panel .gauge')`), '주민 유입 진행바가 있다');
      must(await ev(`document.querySelector('#st-demolish') === null
        && document.querySelector('#st-relocate') === null`), '본부에는 이전·철거 단추가 없다');
      await ev('GM.hud.hideContext()');
    }

    let done = null;
    try { done = await ev('window.__chain(7)'); } catch (e) { done = null; }
    const fin = done ? JSON.parse(done) : null;
    must(fin && fin.chapter >= 7, '★ 감정소를 세우고 [땅을 감정한다]를 눌러 감정의 날을 열었다',
      fin ? `${fin.chapter}장` : '감정 단계에서 멈췄다');
    must(await ev('GM.state.featOn("roles")'), '역할이 열렸다 (감정 뒤)');
    must(await ev(`GM.state.chapter().id === 7`), '7장 낯선 발자국으로 넘어갔다');
    pass('사슬 통과', `${((fin && fin.log) || chain.log).join(' → ')} · ${fin ? fin.day : chain.day}일차`);

  }

  // ── 9. ★ 안개 속으로 걸어가기 (GDD3 §8) ──
  const darkRaw = await ev(`(function(){
      var t = GM.state.myTown(); var m = GM.state.S.map;
      for (var r = 10; r < 22; r++) {
        for (var a = 0; a < 16; a++) {
          var ang = a / 16 * Math.PI * 2;
          var x = Math.round(t.x + Math.cos(ang) * r), y = Math.round(t.y + Math.sin(ang) * r);
          if (x < 2 || y < 2 || x >= m.size - 2 || y >= m.size - 2) continue;
          if (GM.state.fogAt(x, y) !== 0) continue;
          var code = GM.state.terrainKey(x, y);
          if (['grass','forest','rock','fertile'].indexOf(code) < 0) continue;
          return JSON.stringify({x:x, y:y});
        }
      }
      return null;})()`);
  must(!!darkRaw, '아직 아무도 가 보지 않은 검은 땅이 있다');
  if (darkRaw) {
    const dark = JSON.parse(darkRaw);
    must(await ev(`GM.state.fogAt(${dark.x},${dark.y}) === 0`), '그 자리는 지금 완전히 캄캄하다');
    await ev(`GM.camera.moveTo(${dark.x},${dark.y})`);
    await sleep(500);
    const dp2 = await worldPoint(dark.x, dark.y);
    if (dp2.inside) await walkTo(dp2.x, dp2.y);          // ★ §12-5 — 걷는 것은 우클릭이다
    else await ev(`GM.avatar.moveTo(${dark.x},${dark.y})`);
    const walked = await until(
      `(function(){var p=GM.avatar.pos(); return p && Math.hypot(p.x-${dark.x}, p.y-${dark.y}) <= 3;})()`,
      { ms: 20000, what: '검은 땅까지 걷기' }).catch(() => false);
    must(walked, '검은 땅으로 걸어 들어갔다');
    must(await ev(`GM.state.fogAt(${dark.x},${dark.y}) === 2`),
      '★ 걸어 들어간 자리가 곧바로 밝아졌다 (안개 즉시 공개)',
      `안개값 ${await ev(`GM.state.fogAt(${dark.x},${dark.y})`)}`);
    const around = await ev(`(function(){
        var n = 0, seen = 0;
        for (var dy=-4; dy<=4; dy++) for (var dx=-4; dx<=4; dx++) {
          n++; if (GM.state.fogAt(${dark.x}+dx, ${dark.y}+dy) >= 2) seen++;
        } return Math.round(seen / n * 100);})()`);
    must(around >= 70, '둘레도 함께 걷혔다 (시야원)', `둘레 ${around}% 가 보인다`);
    must(await ev(`(function(){var c=document.querySelector('#world-canvas');var g=c.getContext('2d');
        var d=g.getImageData(Math.floor(c.width/2)-40, Math.floor(c.height/2)-40, 80, 80).data;
        var bright=0; for(var i=0;i<d.length;i+=4){ if(d[i]+d[i+1]+d[i+2] > 90) bright++; }
        return bright > 200;})()`), '화면 한가운데가 실제로 캄캄하지 않다', '아바타 둘레가 여전히 검다');
  }

  // ── 9-b. ★ §13-A-3 주민 노동 수치 — "+1.2 목재" 가 정말로 뜨는가 ──
  //   숫자가 뜨기만 하면 되는 게 아니다. **뜬 값이 그 주민의 하루 산출에서 나온 자루 하나**여야 한다.
  {
    const setup = await ev(`(function(){
        var r = GM.state.residents()[0];
        if (!r) return 'NO_RESIDENT';
        // 그 주민에게서 가장 가까운 나무 — 걸어가는 데 검사 시간을 다 쓰지 않도록
        var nd = null, bd = 1e9;
        GM.state.nodeList().forEach(function (n) {
          if (n.type !== 'forest' || n.depleted) return;
          var d = Math.hypot(n.x - r.x, n.y - r.y);
          if (d < bd) { bd = d; nd = n; }
        });
        if (!nd) return 'NO_NODE';
        // 짐이 금세 차도록 하루를 짧게, 자루를 잘게 (검사 뒤 되돌린다)
        var c = GM.state.S.config;
        window.__save = { day: c.time.dayRealSeconds, work: JSON.parse(JSON.stringify(c.world.villagers.work || {})) };
        c.time.dayRealSeconds = 3;
        c.world.villagers.work = { deliveriesPerDay: 10, swingSeconds: 0.4 };
        // 부릴 곳을 나무 옆에 하나 놓아 나르는 길을 짧게 한다 (화면 전용, 검사 뒤 거둔다)
        window.__crate = { id: '__smoke_crate', key: 'storage_crate', name: '저장 궤짝', tier: 1,
                           x: nd.x + 1, y: nd.y, fw: 1, fh: 1, cx: nd.x + 1, cy: nd.y, hp: 40, maxHp: 40 };
        GM.state.nation().structures.push(window.__crate);
        r.job = 'lumber'; r.targetId = nd.id;
        r.x = nd.x; r.y = nd.y; r.destX = nd.x; r.destY = nd.y;
        r.yield = { resource: 'wood', perDay: 3.2 };
        // 플로팅 수치를 엿본다
        window.__floats = [];
        if (!window.__origFloat) window.__origFloat = GM.fx.floatText;
        GM.fx.floatText = function (x, y, t) { window.__floats.push(String(t)); return window.__origFloat.apply(null, arguments); };
        return 'OK';})()`);
    must(setup === 'OK', '★ §13-A-3 주민을 나무에 붙였다', `준비 실패: ${setup}`);
    if (setup === 'OK') {
      // 걸음·작업·나르기를 손으로 돌려 한 바퀴를 확실히 끝낸다(rAF 를 20초 기다리지 않는다)
      const cycle = await ev(`(function(){
          for (var i = 0; i < 4000; i++) GM.world.stepUnitsForTest(0.05);
          var u = GM.world.unitPos(GM.state.residents()[0].id) || {};
          return JSON.stringify({ phase: u.phase, carry: u.carry, floats: window.__floats.length });})()`);
      const got = JSON.parse(cycle);
      const woodFloats = JSON.parse(await ev('JSON.stringify(window.__floats.filter(function(t){return /목재/.test(t);}))'));
      must(/^\+[0-9.]+ 목재$/.test(woodFloats[0] || ''),
        '★ 주민이 하역할 때 "+N 목재" 가 뜬다 (플레이어와 같은 서식)',
        `단계 ${got.phase} · 짐 ${got.carry} · 띄운 것 ${await ev('JSON.stringify(window.__floats.slice(-6))')}`);
      const shown = JSON.parse(await ev(`JSON.stringify(window.__floats.filter(function(t){ return /목재/.test(t); }))`));
      const vals = shown.map((t) => parseFloat(String(t).replace(/[^0-9.]/g, ''))).filter((n) => n > 0);
      // 자루 하나 = 하루 산출 ÷ 하역 횟수 = 3.2 / 10 = 0.32
      must(vals.length > 0 && vals.every((n) => n > 0 && n < 3.2),
        '★ 뜬 값이 그 주민의 하루 산출 안에서 나온 자루 하나다', `값: ${vals.join(', ')}`);
      pass('주민 노동 수치', `뜬 숫자 ${shown.slice(0, 3).join(' · ')}${shown.length > 3 ? ' …' : ''}`);
      await ev(`(function(){
          GM.fx.floatText = window.__origFloat;
          var c = GM.state.S.config;
          c.time.dayRealSeconds = window.__save.day;
          c.world.villagers.work = window.__save.work;
          var st = GM.state.nation().structures;
          for (var i = st.length - 1; i >= 0; i--) if (st[i].id === '__smoke_crate') st.splice(i, 1);
          return 1;})()`);
    }
  }

  // ── 10. ★ 밤낮 4구간 — 이름만이 아니라 **화면이 실제로 어두워지는가** (GDD3 §12-10) ──
  must(await ev(`(function(){
      GM.state.S.dayFraction = 0.1; var a = GM.state.phaseMeta().name;
      GM.state.S.dayFraction = 0.9; var b = GM.state.phaseMeta().name;
      GM.state.S.dayFraction = 0.3;
      return a !== b;})()`), '하루가 아침·낮·저녁·밤으로 갈린다');

  /** 지금 화면의 평균 밝기·푸른 기 — 캔버스를 실제로 찍어서 잰다 */
  const tintOf = async (frac) => {
    await ev(`GM.app.holdDay(${frac})`);
    await sleep(300);
    return ev(`(function(){
        var c=document.querySelector('#world-canvas'); var g=c.getContext('2d');
        var d=g.getImageData(0,0,c.width,c.height).data;
        var r=0,gg=0,b=0,n=0;
        for (var i=0;i<d.length;i+=4*37){ r+=d[i]; gg+=d[i+1]; b+=d[i+2]; n++; }
        return JSON.stringify({ lum: (r+gg+b)/(3*n), blue: (b - r)/n, red: (r - b)/n });})()`).then(JSON.parse);
  };
  const day = await tintOf(0.35);          // 낮
  const dusk = await tintOf(0.62);         // 저녁(노을)
  const night = await tintOf(0.9);         // 밤
  await ev('GM.app.holdDay(null)');
  must(night.lum < day.lum * 0.85, '★ 밤은 낮보다 확실히 어둡다 (캡처 비교)',
    `낮 ${day.lum.toFixed(1)} → 밤 ${night.lum.toFixed(1)}`);
  must(night.blue > day.blue + 8, '★ 밤은 푸르게 물든다',
    `푸른 기 낮 ${day.blue.toFixed(1)} → 밤 ${night.blue.toFixed(1)}`);
  must(dusk.red > day.red + 4 && dusk.blue < night.blue, '★ 노을은 붉게 걸리고, 밤이 되어야 푸르러진다',
    `붉은 기 낮 ${day.red.toFixed(1)} → 노을 ${dusk.red.toFixed(1)} · 푸른 기 노을 ${dusk.blue.toFixed(1)} < 밤 ${night.blue.toFixed(1)}`);
  pass('밤낮 틴트 캡처', `밝기 낮 ${day.lum.toFixed(1)} / 노을 ${dusk.lum.toFixed(1)} / 밤 ${night.lum.toFixed(1)}`
    + ` · 푸른 기 ${day.blue.toFixed(1)} → ${night.blue.toFixed(1)} · 노을 붉은 기 ${dusk.red.toFixed(1)}`);

  // ── 10-b. ★ §13-A-2 밝기 하한 — "칠흑 금지" 를 눈이 아니라 숫자로 못박는다 ──
  //   data/world.json 의 light.minLuma 가 계약이고, 여기서 **실제 캡처 평균**으로 그 값을 지킨다.
  const minLuma = await ev('GM.state.lightCfg().minLuma') ?? 42;
  must(night.lum >= minLuma, '★ 밤에도 밝기 하한을 지킨다 (칠흑 금지)',
    `밤 밝기 ${night.lum.toFixed(1)} < 하한 ${minLuma}`);
  must(day.lum >= minLuma * 1.25, '★ 낮은 하한보다 넉넉히 밝다',
    `낮 밝기 ${day.lum.toFixed(1)} < ${(minLuma * 1.25).toFixed(1)}`);
  must(night.lum >= day.lum * 0.55, '★ 밤이 낮보다 지나치게 어둡지 않다 (달빛 톤)',
    `밤/낮 ${(night.lum / day.lum).toFixed(2)} < 0.55`);

  //   건설 모드로 들어갈 때 화면이 어두워지지 않는가 — 오히려 장막이 옅어져야 한다
  const buildLuma = await (async () => {
    await ev(`GM.app.holdDay(0.9); GM.state.setPlacing({ kind: 'build', key: 'storage_crate', tier: 1 });`);
    await sleep(320);
    const v = await ev(`(function(){
        var c=document.querySelector('#world-canvas'); var g=c.getContext('2d');
        var d=g.getImageData(0,0,c.width,c.height).data; var s=0,n=0;
        for (var i=0;i<d.length;i+=4*37){ s+=d[i]+d[i+1]+d[i+2]; n++; }
        return s/(3*n);})()`);
    await ev('GM.state.setPlacing(null); GM.app.holdDay(null);');
    return Number(v);
  })();
  must(buildLuma >= night.lum - 0.5, '★ 건설 모드로 들어가도 화면이 어두워지지 않는다',
    `건설 ${buildLuma.toFixed(1)} < 평소 ${night.lum.toFixed(1)}`);
  //   계약 자체도 본다 — 건설 모드의 장막이 평소보다 반드시 옅다
  const veils = JSON.parse(await ev(`(function(){
      var a = GM.state.fogVeil();
      GM.state.setPlacing({ kind: 'build', key: 'storage_crate', tier: 1 });
      var b = GM.state.fogVeil();
      GM.state.setPlacing(null);
      return JSON.stringify({ normal: a, build: b });})()`));
  must(veils.build < veils.normal, '★ 건설 모드의 안개 장막이 더 옅다 (고스트가 읽힌다)',
    `평소 ${veils.normal} · 건설 ${veils.build}`);
  const dLuma = buildLuma - night.lum;
  pass('밝기 하한 검사', `하한 ${minLuma} · 밤 ${night.lum.toFixed(1)} · 낮 ${day.lum.toFixed(1)}`
    + ` · 건설 모드 ${buildLuma.toFixed(1)} (밤 대비 ${dLuma >= 0 ? '+' : ''}${dLuma.toFixed(1)})`
    + ` · 장막 ${veils.normal} → ${veils.build}`);

  // ── 11. 프레임 시간 (GDD3 §8 — 60fps 목표) ──
  //   ★ 프레임 '간격'은 60fps 로 맞물려 돌면 늘 16.7ms 다 — 그 값이 16ms 아래로 내려갈 일이 없다.
  //     그래서 두 가지를 나눠 본다: ① 간격이 흔들리지 않는가(끊김) ② 한 프레임을 그리는 데
  //     실제로 얼마나 걸리는가(예산 16.7ms 대비 여유). 후자가 진짜 성능 값이다.
  await ev('GM.world.resetStats()');
  await sleep(2500);
  const frame = await ev('JSON.stringify(GM.world.frameStats())').then(JSON.parse);
  must(frame.n > 60, '프레임을 충분히 모았다', `${frame.n}프레임`);
  must(frame.workAvg > 0 && frame.workAvg < 16.0, '한 프레임을 그리는 데 16ms 아래로 든다 (60fps 예산)',
    `그리기 평균 ${frame.workAvg.toFixed(2)}ms · 95번째 ${frame.workP95.toFixed(2)}ms`);
  must(frame.p95 < 22.0, '프레임이 끊기지 않는다 (95번째 간격 22ms 아래)',
    `간격 95번째 ${frame.p95.toFixed(2)}ms`);
  pass('프레임 측정',
    `그리기 평균 ${frame.workAvg.toFixed(2)}ms(95번째 ${frame.workP95.toFixed(2)}ms) · `
    + `간격 평균 ${frame.avg.toFixed(2)}ms · ${frame.n}프레임`);

  // ── 12. 콘솔이 조용한가 ──
  const noisy = errors.filter((e) => !/AudioContext|autoplay|favicon/i.test(e));
  must(noisy.length === 0, '콘솔에 오류가 없다', noisy.slice(0, 4).join(' / '));
} catch (e) {
  fail('연기 검사가 끝까지 가지 못했다', e?.message || String(e));
} finally {
  cleanup();
}

console.log(`\n실브라우저 연기 검사 — ${steps.length - failed}/${steps.length} 통과`);
process.exit(failed ? 1 : 0);
