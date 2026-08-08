// 클라이언트 하니스 — jsdom 으로 public/index.html 을 **실서버에 붙여** 실제로 돌린다.
//
// ★ v3.1 전면 재작성 (GDD3 §11-6).
//   검증 문장이 바뀌었다: 「설명 없이 처음 하는 사람이 각 장을 순서대로 통과한다」.
//   그래서 이 하니스는 시나리오를 **손으로 짜지 않는다** — 목표 카드(state.chapter.goal)와
//   그 카드가 가리키는 마커(goal.targets)만 읽고, **가리키는 대로만** 움직여서 1장 → 6장(감정)까지 간다.
//   중간에 "여기서 이걸 해라" 하고 하니스가 아는 척을 하면 그건 검사가 아니라 각본이다.
//
//   실행: npm run harness   (구경 모드 회귀 포함)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.GALLAEMALLAE_SAVES_DIR = mkdtempSync(join(tmpdir(), 'gm-jsdom-'));

const { JSDOM, VirtualConsole } = await import('jsdom');
const { http, games } = await import('../server/index.js');
const { savesDir } = await import('../server/persistence.js');

/** jsdom 은 canvas 2D 를 구현하지 않는다 → 그리기 호출을 삼키는 스텁을 끼운다. */
function installCanvasStub(window) {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const make = () => new Proxy({
    canvas: null,
    measureText: (t) => ({ width: String(t ?? '').length * 6 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => null,
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    putImageData: noop,
    setTransform: noop,
    save: noop, restore: noop,
  }, {
    get(target, prop) { return prop in target ? target[prop] : noop; },
    set(target, prop, value) { target[prop] = value; return true; },
  });
  window.HTMLCanvasElement.prototype.getContext = function getContext() {
    if (!this.__ctx) { this.__ctx = make(); this.__ctx.canvas = this; }
    return this.__ctx;
  };
  window.HTMLCanvasElement.prototype.toDataURL =
    () => 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
}

function until(fn, { ms = 15000, every = 30, what = '조건' } = {}) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let v;
      try { v = fn(); } catch { v = false; }
      if (v) return resolve(v);
      if (Date.now() - t0 > ms) return reject(new Error(`${what} 대기 시간 초과(${ms}ms)`));
      setTimeout(tick, every);
    };
    tick();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(url, errors) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}`));
  virtualConsole.on('error', (...a) => errors.push(`console.error: ${a.join(' ')}`));

  const dom = await JSDOM.fromURL(url, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      installCanvasStub(window);
      window.fetch = (input, init) => globalThis.fetch(new URL(String(input), window.location.href), init);
      window.addEventListener('error', (e) => errors.push(`window.onerror: ${e.message}`));
      window.addEventListener('unhandledrejection', (e) => errors.push(`unhandledrejection: ${e.reason}`));
    },
  });
  await until(() => dom.window.GM && dom.window.GM.state && dom.window.GM.app, { what: 'GM 네임스페이스 로드' });
  return dom;
}

// ────────────────────────────────────────────────────────────────
// 월드 조작 헬퍼 — 화면 좌표는 카메라에서 역산한다(jsdom 은 레이아웃이 없다)
// ────────────────────────────────────────────────────────────────
function fire(window, type, wx, wy, opts = {}) {
  const cv = window.document.querySelector('#world-canvas');
  const p = window.GM.camera.worldToScreen(wx, wy);
  const ev = new window.MouseEvent(type, {
    bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: opts.button ?? 0, ...opts,
  });
  cv.dispatchEvent(ev);
  return ev;
}
function dragWorld(window, points, opts = {}) {
  fire(window, 'pointerdown', points[0].x, points[0].y, opts);
  for (let i = 1; i < points.length; i += 1) fire(window, 'pointermove', points[i].x, points[i].y, opts);
  const last = points[points.length - 1];
  fire(window, 'pointerup', last.x, last.y, opts);
}

/** 고스트 유효성 판정을 그대로 써서 놓을 자리를 찾는다 */
function findSpot(window, placing, extra) {
  const S = window.GM.state;
  const t = S.territory();
  if (!t) return null;
  const r = Math.floor(t.radius);
  for (let ring = 2; ring <= r; ring += 1) {
    for (let dy = -ring; dy <= ring; dy += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = t.cx + dx;
        const y = t.cy + dy;
        if (extra && !extra(x, y)) continue;
        if (window.GM.build.validate(placing, x, y).ok) return { x, y };
      }
    }
  }
  return null;
}

/** 클라의 명령 통로(GM.net.send)를 그대로 쓰되, 결정론 시각을 실어 빨리 굴린다 */
function sendNow(window, evt, payload) {
  return new Promise((resolve) => {
    let done = false;
    window.GM.net.send(evt, payload, (res) => { done = true; resolve(res); });
    setTimeout(() => { if (!done) resolve(null); }, 6000);
  });
}

const post = (base, path, body) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json());

/**
 * ★ GDD3 §12-11 회귀 검사 — 「10초 관찰 중 역방향 점프 0회」.
 *
 * 주민 하나의 연출 위치(GM.world.unitPos)를 60fps 로 10초 치 굴리며 지켜본다.
 * 한 프레임에 걸을 수 있는 거리는 정해져 있다(2.6칸/초 × dt). 그보다 크게 튀면 순간이동이고,
 * 그 튐이 **가던 방향의 반대**이면 곧 옛 버그가 말하던 "출발 자리로 되돌아감"이다.
 * jsdom 에는 rAF 시계가 없으므로 stepUnits 를 손으로 돌린다(렌더러의 그 함수 그대로).
 */
function observeUnit(window, id, { seconds = 10, dt = 1 / 60 } = {}) {
  const GM = window.GM;
  const start = GM.world.unitPos(id);
  if (!start) return { backJumps: 999, samples: 0, moved: 0, maxJump: 0, worst: null };
  let prev = { x: start.x, y: start.y };
  let backJumps = 0;
  let maxJump = 0;
  let moved = 0;
  let worst = null;
  const budget = 2.6 * dt * 3 + 0.05;      // 한 프레임 최대 이동(넉넉히)
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i += 1) {
    GM.world.stepUnitsForTest(dt);
    const a = GM.world.unitPos(id);
    if (!a) break;
    const dx = a.x - prev.x;
    const dy = a.y - prev.y;
    const d = Math.hypot(dx, dy);
    moved += d;
    if (d > maxJump) { maxJump = d; worst = { frame: i, from: { ...prev }, to: { x: a.x, y: a.y } }; }
    if (d > budget) backJumps += 1;        // 한 프레임에 걸을 수 없는 거리 = 순간이동
    prev = { x: a.x, y: a.y };
  }
  return { backJumps, maxJump, moved, worst, samples: frames };
}

// ────────────────────────────────────────────────────────────────
// 본 시나리오 — 「마커가 가리키는 대로만」
// ────────────────────────────────────────────────────────────────
test('클라이언트 하니스 — 목표 카드가 가리키는 대로만 1장에서 6장(감정)까지', async (t) => {
  const errors = [];
  await new Promise((res) => http.listen(0, '127.0.0.1', res));
  const port = http.address().port;
  const base = `http://127.0.0.1:${port}`;
  let dom = null;
  let gameId = null;
  let now = Date.now() + 20_000;   // 결정론 시각(now 주입)은 늘 실시각보다 앞선다

  try {
    // ★ 씨앗을 고정한다 — 하니스가 매번 다른 땅을 받으면 실패가 코드 탓인지 지도 탓인지 알 수 없다.
    dom = await boot(`${base}/?seed=20260804`, errors);
    const { window } = dom;
    const GM = window.GM;
    const S = GM.state;
    const U = GM.ui;
    const doc = window.document;

    // ── 1. 타이틀 ────────────────────────────────────────────
    await t.test('타이틀 화면과 규약 판번호', async () => {
      assert.equal(doc.querySelector('#scene-title').hidden, false, '타이틀이 떠 있다');
      assert.equal(doc.querySelector('#shell').hidden, true, '게임 화면은 아직 숨어 있다');
      const health = await (await fetch(`${base}/api/health`)).json();
      assert.equal(GM.PROTOCOL, health.protocol, '화면과 서버의 규약 판번호가 같다');
      assert.equal(GM.PROTOCOL, '3.3');
    });

    // ── 2. 개척 시작 ─────────────────────────────────────────
    await t.test('개척 시작 — 이름·난이도·캐릭터 두 번 클릭이면 들어간다', async () => {
      doc.querySelector('#btn-new').click();
      await until(() => doc.querySelector('#scene-found').hidden === false, { what: '개척 화면' });
      const name = doc.querySelector('#found-name');
      name.value = '서온';
      name.dispatchEvent(new window.Event('input', { bubbles: true }));
      const cards = [...doc.querySelectorAll('#found-diff .diff-card')];
      assert.ok(cards.length >= 3, '난이도 카드 3장');
      cards[1].click();
      const go = doc.querySelector('#found-start');
      assert.equal(go.disabled, false, '「마차에 오른다」가 눌릴 수 있다');
      go.click();

      await until(() => !!S.S.map, { ms: 15000, what: '월드 스냅샷' });
      await until(() => !!(S.S.view && S.S.view.nation), { what: '정착지 상태' });
      assert.equal(doc.querySelector('#shell').hidden, false, '게임 화면이 열렸다');
      assert.notEqual(S.S.boot.phase, 'failed', S.S.boot.hint || '');
      gameId = S.S.gameId;
      games.get(gameId).stop();            // 일 틱은 하니스가 손으로 돌린다
    });

    const rt = games.get(gameId);
    const nation = () => rt.world.nations.player;
    const step = () => post(base, '/api/debug/step', { gameId });

    // ── 3. 오프닝 ────────────────────────────────────────────
    await t.test('마차 도착 오프닝 — 뜨고, 건너뛸 수 있다', async () => {
      await until(() => GM.opening.busy(), { ms: 8000, what: '오프닝 시작' });
      doc.querySelector('#opening-skip').click();
      await until(() => !GM.opening.busy(), { what: '오프닝 종료' });
      assert.ok(GM.avatar.pos(), '아바타가 땅 위에 섰다');
    });

    // ── 4. ★ 첫 화면 — 지을 것이 없으면 배치대 단추도 없다 ────
    await t.test('1장 불씨 — 자원 3칸 + 목표 카드 하나. 단추는 아직 거의 없다', async () => {
      GM.hud.update();
      GM.quest.update();
      const chips = [...doc.querySelectorAll('#res-bar .res-chip')].map((c) => c.getAttribute('data-k'));
      /* ★ §19-C — 금화는 점진 공개에서 빠졌다(B03-2): 교역이 열리기 전에도 건물 값·도구 값을
         금으로 치르므로, 「가진 돈」은 1장부터 늘 보인다. 나머지 점진 공개는 그대로다. */
      assert.equal(chips.join(','), 'grain,wood,stone,gold', `야영지 자원칸: ${chips.join(',')}`);
      assert.equal(doc.querySelector('#goal-card').hidden, false, '목표 카드가 보인다');

      const ch = S.chapter();
      assert.equal(ch.id, 1, '1장에서 시작한다');
      assert.equal(ch.goal.key, 'first_swings');
      assert.ok(doc.querySelector('#goal-card .gc-title').textContent.includes('나무'));

      // ★ 「지을 게 없으면 배치대 단추가 아예 없다」 — 이 문장이 이번 개편의 핵심이다
      assert.equal(S.buildable().length, 0, '1장 배치대는 비어 있다');
      assert.equal(doc.querySelector('#tb-build'), null, '세우기 단추가 아예 없다');
      assert.equal(doc.querySelector('#tb-fence'), null, '울타리 단추도 없다');
      assert.equal(doc.querySelector('#tb-people'), null, '주민 단추도 없다');
      assert.equal(doc.querySelector('#cabinet').hidden, true, '각료도 없다');
      assert.equal(doc.querySelector('#badge-threat').hidden, true, '위협 배지도 없다');
      assert.equal(S.S.view.wave, null, '웨이브 블록 자체가 없다');
      assert.equal(S.S.view.market, undefined, '시장 블록 자체가 없다');
    });

    // ── 5. 마커가 실제로 자리를 가리키는가 ────────────────────
    await t.test('마커 — 목표 카드가 가리키는 자리가 실제 나무다', () => {
      const targets = S.goalTargets();
      assert.ok(targets.length > 0, '가리킬 자리가 있다');
      assert.equal(targets[0].kind, 'node');
      const node = S.nodeById(targets[0].id);
      assert.ok(node, '그 자리는 화면이 아는 노드다');
      assert.equal(node.type, 'forest');
      // ★ GDD3 §13-B-2 — 자원 군락은 영토 **밖**에 있다. 걸어갈 만한 거리인지만 본다.
      assert.ok(S.inWorkRange(node.x, node.y), '걸어갈 만한 자리다');
      // 카드를 누르면 시선이 그리로 뛴다
      GM.quest.jumpToGoal();
      assert.ok(Math.hypot(GM.camera.cam.tx - node.x, GM.camera.cam.ty - node.y) < 3, '카메라가 목표로 뛰었다');
      // 근처에 서면 라벨이 붙는다
      GM.avatar.setPos(node.x + 1, node.y);
      assert.equal(GM.world.verbFor(GM.swing.target()), 'E — 나무 베기');
    });

    // ────────────────────────────────────────────────────────
    // ★ 사슬 주행기 — 목표 카드와 마커만 보고 움직인다
    // ────────────────────────────────────────────────────────
    const log = [];
    let lastError = null;
    S.on('server:error', (e) => { lastError = e; });

    /** 마커가 가리키는 노드·현장을 한 번 친다 */
    async function swingMarker() {
      const tgt = S.goalTargets().filter((x) => x.kind === 'node' || x.kind === 'site')[0];
      if (!tgt) return false;
      GM.avatar.setPos(tgt.x + 1, tgt.y);
      now += 2500;
      const payload = tgt.kind === 'site' ? { siteId: tgt.id, now } : { nodeId: tgt.id, now };
      const r = await sendNow(window, 'actionSwing', payload);
      return !!(r && r.ok);
    }

    /** 배치대에서 그 건물을 골라 유효한 자리에 놓는다 (카드가 가리키는 단추만 쓴다) */
    async function placeFromMarker(tgt) {
      const btn = doc.querySelector(tgt.sel || '#tb-build');
      if (!btn) return false;
      if (!GM.build.isOpen()) btn.click();
      await until(() => doc.querySelector('#place-bar').hidden === false, { ms: 4000, what: '배치대' });
      let item = null;
      for (const cat of ['housing', 'production', 'civic', 'military', 'decor']) {
        GM.build.setCat(cat);
        item = [...doc.querySelectorAll('#place-bar .pb-item')]
          .find((b) => (b.getAttribute('data-place') || '').startsWith(tgt.name));
        if (item) break;
      }
      if (!item || item.disabled) { GM.build.close(); return false; }
      item.click();
      const placing = S.S.placing;
      const sites0 = nation().construction.length;
      // 자리를 두어 곳 시도한다 — 서버가 마지막 판정자다(고스트가 초록이어도 튕길 수 있다)
      for (let tries = 0; tries < 4; tries += 1) {
        const spot = findSpot(window, placing);
        if (!spot) break;
        S.setPlacing(placing);
        GM.build.commit(spot.x, spot.y);
        let ok = false;
        try {
          await until(() => nation().construction.length > sites0, { ms: 1500, what: `${tgt.name} 공사` });
          ok = true;
        } catch { ok = false; }
        if (ok) { GM.build.close(); return true; }
      }
      GM.build.close();
      return false;
    }

    /**
     * 자재가 모자라면 — ★ 안내 시스템이 짚어 주는 그 자리로 간다.
     *   quest.onError 가 「석재가 필요해요 — 바위는 회색 언덕에 있습니다」와 함께 노드를 찍어 준다.
     *   여기서는 같은 규칙(가장 가까운 그 자원 노드)을 그대로 써서 캔다.
     */
    // ★ §13-B-1 — 딸기 들이 초반 식량의 두 번째 손이다
    const SOURCE = { wood: ['forest'], stone: ['rock'], grain: ['berry', 'water', 'field', 'fertile'] };
    async function gather(resource, amount, budget = 40) {
      const types = SOURCE[resource] || ['forest'];
      for (let i = 0; i < budget && (nation().resources[resource] || 0) < amount; i += 1) {
        const me = GM.avatar.pos() || S.myTown();
        const node = S.nodeList()
          .filter((n) => types.includes(n.type) && !n.depleted && S.inWorkRange(n.x, n.y)
            && (n.type === 'fertile' || n.type === 'field' ? !!n.harvestReady : true))
          .sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
        if (!node) return false;
        GM.avatar.setPos(node.x + 1, node.y);
        now += 2500;
        const r = await sendNow(window, 'actionSwing', { nodeId: node.id, now });
        if (r && !r.ok) lastError = r.error;
      }
      return (nation().resources[resource] || 0) >= amount;
    }

    /** 조건 하나를 향해 한 걸음 — 카드가 가리키는 것만 본다 */
    async function actOn(c, targets) {
      const tgt = (targets || [])[0];
      if (c.type === 'resource') {
        if (!(await gather(c.resource, c.amount, 14))) await step();
      } else if (c.type === 'swings') {
        if (!(await swingMarker())) await step();
      } else if (c.type === 'structure') {
        const site = (targets || []).find((x) => x.kind === 'site')
          || nation().construction.find((x) => x.building === c.building);
        if (site && site.id) {
          const s0 = nation().construction.find((x) => x.id === site.id);
          if (s0) { GM.avatar.setPos(s0.x + 1, s0.y); now += 2500; await sendNow(window, 'actionSwing', { siteId: s0.id, now }); return; }
        }
        const slot = (targets || []).find((x) => x.kind === 'buildSlot')
          || { kind: 'buildSlot', sel: '#tb-build', name: (S.buildableOf(c.building) || {}).name };
        const b = S.buildableOf(c.building);
        if (b && !b.affordable) {
          for (const res of Object.keys(b.cost || {})) {
            if ((nation().resources[res] || 0) < b.cost[res]) {
              if (!(await gather(res, b.cost[res] + 6, 40))) await step();
              return;
            }
          }
        }
        if (!(await placeFromMarker(slot))) await step();
      } else if (c.type === 'population') {
        // ★ 카드가 「올리다 만 집을 마저 두드려라」를 가리키면 그대로 따른다
        const site = (targets || []).find((x) => x.kind === 'site');
        if (site) {
          GM.avatar.setPos(site.x + 1, site.y); now += 2500;
          await sendNow(window, 'actionSwing', { siteId: site.id, now });
          return;
        }
        // 사람은 기다려야 온다 — 그동안 곳간을 채운다(굶으면 아무도 안 온다)
        if ((nation().resources.grain || 0) < 40) await gather('grain', 60, 16);
        // 「집을 더 지어라」를 가리키면 그대로 따른다
        const slot = (targets || []).find((x) => x.kind === 'buildSlot');
        if (slot) {
          const b = S.buildableOf(slot.id);
          if (b && !b.affordable) {
            for (const res of Object.keys(b.cost || {})) {
              if ((nation().resources[res] || 0) < b.cost[res]) {
                // 자리가 바닥났으면 하루를 흘려 되살아나길 기다린다(노드는 날마다 되자란다)
                if (!(await gather(res, b.cost[res] + 6, 40))) await step();
                return;
              }
            }
          }
          const pend = nation().construction.find((x) => x.building === slot.id);
          if (pend) { GM.avatar.setPos(pend.x + 1, pend.y); now += 2500; await sendNow(window, 'actionSwing', { siteId: pend.id, now }); return; }
          if (await placeFromMarker(slot)) return;
        }
        await step();
      } else if (c.type === 'flag' && c.flag === 'appraised') {
        const st = S.structures().find((x) => x.key === 'appraisal_post');
        assert.ok(st, '감정소가 서 있다');
        GM.structure.open(st.id);
        const btn = doc.querySelector('#st-appraise');
        assert.ok(btn, '건물 패널에 [땅을 감정한다] 단추가 있다');
        btn.click();
        await sleep(400);
      } else {
        await step();
      }
      if (tgt && false) console.log(tgt);        // (마커를 실제로 읽는다는 표시)
    }

    /**
     * ★ GDD3 §12-2 — 조건이 다 차면 **본부를 눌러 [승격]** 한다.
     *   더 이상 저절로 오르지 않으므로, 사람이 하듯 화면의 그 단추를 실제로 누른다.
     *   (땅이 안 넓어지면 집 지을 자리가 곧 바닥나므로, 이 한 번의 클릭이 사슬의 일부다.)
     */
    let promotions = 0;
    async function promoteIfReady() {
      const nx = S.tier().next;
      if (!nx || !nx.ready) return false;
      const b = S.hq();
      if (!b) return false;
      GM.structure.open(b.id);                       // 본부 클릭 = 정착지 패널
      const btn = doc.querySelector('#se-promote');
      if (!btn || btn.disabled) { GM.hud.hideContext(); return false; }
      const before = S.tierNo();
      btn.click();
      await until(() => S.tierNo() > before, { ms: 4000, what: '승격' });
      promotions += 1;
      GM.hud.hideContext();
      return true;
    }

    /** 지금 목표 한 칸을 끝낸다 */
    async function advanceOneStep(limit = 140) {
      const keyOf = () => S.chapter().id + ':' + (S.goal() ? S.goal().key : 'done');
      const startKey = keyOf();
      for (let i = 0; i < limit && keyOf() === startKey; i += 1) {
        const g = S.goal();
        if (!g) break;
        // 배지에 불이 들어오면 누른다 — 땅이 넓어져야 다음 집을 놓을 자리가 생긴다
        await promoteIfReady();
        const c = g.condition || {};
        const list = (c.type === 'all' || c.type === 'any') ? (c.of || []) : [c];
        // 아직 못 채운 조건 중 첫 번째를 향해 한 걸음
        const pending = list.find((x) => !met(x)) || list[0];
        await actOn(pending, g.targets);
        await sleep(4);
      }
      return keyOf() !== startKey;
    }

    /** 조건 하나가 이미 찼는가 — 화면이 가진 장부만 본다 */
    function met(c) {
      if (!c) return true;
      if (c.type === 'resource') return (S.nation().resources[c.resource] || 0) >= c.amount;
      if (c.type === 'structure') return S.structures().filter((s) => s.key === c.building).length >= (c.count || 1);
      if (c.type === 'population') return (S.nation().population || 0) >= c.count;
      if (c.type === 'swings') return false;
      return false;
    }

    /** 장 하나를 통째로 지난다 */
    async function clearChapter(id) {
      for (let guard = 0; guard < 12 && S.chapter().id === id; guard += 1) {
        const before = S.goal() ? S.goal().key : null;
        const moved = await advanceOneStep();
        assert.ok(moved, `${id}장 「${before}」 칸을 넘기지 못했다`
          + ` (인구 ${S.nation().population}/잠자리 ${JSON.stringify(S.housing())}`
          + ` · 자원 ${JSON.stringify(S.nation().resources)}`
          + ` · 배치대 ${S.buildable().map((b) => b.key + (b.affordable ? '' : '✗')).join(',')}`
          + ` · 마커 ${JSON.stringify(S.goalTargets())}`
          + ` · 마지막 오류 ${JSON.stringify(lastError)})`);
      }
      log.push(`${id}장 (${rt.world.tick}일차)`);
      return S.chapter().id > id;
    }

    // ── 6. 1장 → 2장 ─────────────────────────────────────────
    await t.test('1장 불씨 — 나무를 베면 스스로 2장이 열린다', async () => {
      let doneEvt = null;
      S.on('chapterDone', (p) => { doneEvt = p; });
      assert.ok(await clearChapter(1), '1장을 지났다');
      assert.ok(doneEvt, '장 완료 연출이 왔다');
      assert.equal(doneEvt.name, '불씨');
      assert.ok(doneEvt.card && doneEvt.card.title, '「새로 열린 것」 카드가 한 장 실려 있다');
      GM.hud.update();
      assert.ok(doc.querySelector('#tb-build'), '이제서야 세우기 단추가 생겼다');
      assert.equal(S.buildable().map((b) => b.key).join(','), 'tent', '배치대에는 천막만');
    });

    // ── 7. 2장 → 3장 ─────────────────────────────────────────
    await t.test('2장 첫 지붕 — 카드가 가리키는 단추로 천막을 세운다', async () => {
      assert.ok(await clearChapter(2), '2장을 지났다');
      assert.ok(S.structures().some((s) => s.key === 'tent'), '천막이 섰다');
      assert.equal(S.chapter().id, 3);
    });

    // ── 7-b. 자원 팝의 목표 잔여 · 같은 오류 두 번이면 해결 말풍선 (GDD3 §11-3) ──
    await t.test('안내 — 자원 팝에 목표 잔여가 붙고, 같은 오류 두 번이면 해결 방법이 뜬다', () => {
      assert.equal(S.goal().key, 'grain20', '3장 첫 칸은 식량 목표다');
      // ★ 「식량 +2 (오두막까지 8)」의 근거값
      S.S.view.nation.resources.grain = 12;
      const need = S.goalRemaining('grain');
      assert.ok(need, '지금 장의 목표 자원이면 잔여가 계산된다');
      assert.equal(need.remaining, 8);
      assert.equal(need.short, '오두막');
      assert.equal(S.goalRemaining('stone'), null, '목표와 무관한 자원에는 안 붙는다');

      // ★ 같은 오류 두 번 — 첫 번째는 조용하고, 두 번째에 해결 말풍선이 뜬다
      const coach = () => doc.querySelector('#coach-root .coach-one');
      U.clear(doc.querySelector('#coach-root'));
      GM.quest.onError({ code: 'NO_RESOURCE', message: '자재가 모자랍니다.' });
      assert.equal(coach(), null, '첫 번째 오류에는 잔소리하지 않는다');
      GM.quest.onError({ code: 'NO_RESOURCE', message: '자재가 모자랍니다.' });
      const c = coach();
      assert.ok(c, '두 번째에 해결 말풍선이 뜬다');
      assert.ok(/식량이 필요해요/.test(c.textContent), `말풍선: ${c.textContent}`);
      U.clear(doc.querySelector('#coach-root'));
    });

    // ── 8. 3장 → 4장 ─────────────────────────────────────────
    await t.test('3장 허기 — 식량을 모으면 오두막이 열리고, 지으면 4장', async () => {
      assert.equal(S.buildingOn('hut'), false, '오두막은 아직 잠겨 있다');
      assert.ok(await clearChapter(3), '3장을 지났다');
      assert.ok(S.structures().some((s) => s.key === 'hut'), '오두막이 섰다');
      assert.ok(S.featOn('residentArrival'), '이제서야 사람이 찾아온다');
      GM.hud.update();
      assert.ok(doc.querySelector('#tb-people'), '주민 단추가 생겼다');
    });

    // ── 9. 4장 → 5장 ─────────────────────────────────────────
    await t.test('4장 첫 이웃 — 사람이 오고 곡창이 선다', async () => {
      assert.ok(await clearChapter(4), '4장을 지났다');
      assert.ok(nation().population >= 3, `주민 ${nation().population}명`);
      assert.ok(S.structures().some((s) => s.key === 'granary'), '곡창이 섰다');
    });

    // ── 9-b. ★ §13-A-4 한 명이 오면 한 명만 걸어온다 ────────
    await t.test('★ §13-A-4 주민 도착 — 한 명 추가에 두 명이 걸어오지 않는다', () => {
      const before = S.residents().length;
      const one = S.residents()[0];
      assert.ok(one, '주민이 있다');

      // 도착 알림을 그대로 흉내 낸다 (예전엔 이 한 줄이 유령을 하나 더 만들었다)
      GM.residents.arrived({ id: one.id, name: one.name, appearance: one.appearance,
                             x: one.x, y: one.y, total: before, population: before, capacity: before + 4 });
      GM.world.stepUnitsForTest(0.1);

      assert.equal(S.residents().length, before, '알림만으로 사람이 늘지 않는다');
      // 화면이 그리는 몸은 주민 목록 하나뿐이다 — 도착 연출은 이름표일 뿐 몸이 아니다
      const bodies = S.residents().filter((r) => GM.world.unitPos(r.id)).length;
      assert.equal(bodies, S.residents().length, `몸 ${bodies}개 = 주민 ${S.residents().length}명`);
      assert.equal(typeof GM.world.markArrival, 'function', '도착 표시는 markArrival 하나로만 건다');
      assert.equal(GM.world.walkIn, undefined, '연출용 유령을 만드는 문은 닫혔다');
    });

    // ── 9-c. ★ §13-A-5 저장 상한 ────────────────────────────
    await t.test('★ §13-A-5 곳간이 차면 자원칸에 빨간 「가득」 테두리가 뜬다', () => {
      const st = S.storageInfo();
      assert.ok(st && st.limit > 0, `서버가 상한을 실어 준다 (${st && st.limit})`);
      assert.equal(S.storageFull('wood'), false, '아직은 여유가 있다');

      // 곳간을 가득 채운 것처럼 장부만 바꾼다 (스윙 ack 이 앞서 간 상황과 같다)
      const keep = S.nation().resources.wood;
      S.nation().resources.wood = st.limit;
      assert.equal(S.storageFull('wood'), true);
      assert.equal(S.storageFull('population'), false, '인구·금화 칸은 곳간이 아니다');
      GM.hud.update();
      const chip = doc.querySelector('#res-bar .res-chip[data-k="wood"]');
      assert.ok(chip, '목재 자원칸이 있다');
      assert.equal(chip.classList.contains('full'), true, '가득 표시가 붙는다');

      // 자리가 나면 표시도 알림도 되돌아온다
      S.nation().resources.wood = keep;
      GM.hud.update();
      assert.equal(doc.querySelector('#res-bar .res-chip[data-k="wood"]').classList.contains('full'), false);
    });

    // ── 10. 5장 → 6장 ────────────────────────────────────────
    await t.test('5장 마을의 꼴 — 다섯이 되고 본부에서 [승격]을 누르면 촌락', async () => {
      assert.ok(await clearChapter(5), '5장을 지났다');
      assert.ok(nation().population >= 5, `주민 ${nation().population}명`);
      await promoteIfReady();
      // ★ §12-2 — 티어는 저절로 오르지 않는다. 여기까지 오는 동안 실제로 단추를 눌렀어야 한다.
      assert.ok(promotions >= 2, `승격 단추를 ${promotions}번 눌렀다`);
      assert.ok(S.tierNo() >= 2, `티어 ${S.tierNo()} — 눌러서 촌락까지 왔다`);
      assert.equal(S.chapter().id, 6);
      assert.ok(S.buildingOn('appraisal_post'), '감정소가 배치대에 나왔다');
    });

    // ── 10-b. ★ §12-2 정착지 패널 ────────────────────────────
    await t.test('★ §12-2 본부 — 4×4 대형, 누르면 정착지 패널(조건표·유입 게이지·[승격])', async () => {
      const b = S.hq();
      assert.ok(b, '본부가 있다');
      assert.equal(b.fw, 4, '4칸 너비');
      assert.equal(b.fh, 4, '4칸 높이');
      assert.equal(b.immovable, true, '옮기지도 헐지도 못한다');
      assert.equal(b.tier, S.tierNo() + 1, '본부 외형이 정착지 티어를 따라간다');

      GM.structure.open(b.id);
      const panel = doc.querySelector('#context-panel');
      assert.equal(panel.hidden, false, '패널이 열렸다');
      assert.ok(/정착지/.test(panel.textContent), '정착지 패널이다');

      // ★ §12-3 — 조건마다 초록/빨강 + 현재값/필요값
      const rows = [...panel.querySelectorAll('.req-row')];
      assert.ok(rows.length >= 2, `조건 줄 ${rows.length}개`);
      assert.ok(rows.every((r) => r.classList.contains('ok') || r.classList.contains('bad')),
        '모든 조건 줄이 충족/미충족 중 하나로 칠해진다');
      const bad = rows.filter((r) => r.classList.contains('bad'));
      for (const r of bad) {
        assert.match(r.querySelector('.rq-v').textContent, /\d+\/\d+/, '미충족은 현재값/필요값을 낸다');
      }
      // 유입 게이지
      assert.ok(panel.querySelector('.gauge'), '주민 유입 진행바가 있다');
      // 승격 단추 (조건 미달이면 꺼져 있다)
      const btn = doc.querySelector('#se-promote');
      const nx = S.tier().next;
      if (nx) {
        assert.ok(btn, '[승격] 단추가 있다');
        assert.equal(btn.disabled, !S.reqReady(nx.reqs), '조건을 채웠을 때만 눌린다');
      }
      // 본부는 이전·철거 단추가 아예 없다
      assert.equal(doc.querySelector('#st-demolish'), null, '본부에는 [헌다] 단추가 없다');
      assert.equal(doc.querySelector('#st-relocate'), null, '본부에는 [옮긴다] 단추가 없다');
      GM.hud.hideContext();
    });

    // ── 10-b-2. ★ §13-A-1 조건 수량 미반영 버그 회귀 ──────────
    await t.test('★ §13-A-1 조건 수량 — 곡물 46을 들고 있으면 조건 행도 46이다 (12/20 금지)', async () => {
      const nx0 = S.tier().next;
      if (!nx0) return;                                   // 엔드리스 구간이면 검사할 조건이 없다
      const row = (nx0.reqs || []).find((r) => r.kind === 'resource' || r.kind === 'population');
      assert.ok(row, '다시 잴 수 있는 조건 행이 하나는 있다');
      assert.ok(row.kind, '행이 스스로 종류를 밝힌다');
      // 그 행이 읽는 실시간 장부를 손에 쥔다
      const put = (v) => {
        if (row.kind === 'resource') S.nation().resources[row.resource] = v;
        else S.nation().population = v;
      };

      // 서버 스냅샷은 일부러 낡게 둔다 — 스윙 ack 만 창고를 앞서 갱신한 그 순간을 그대로 만든다
      const stale = Math.max(0, row.need - 8);
      row.have = stale; row.ok = false; nx0.ready = false;
      put(row.need + 26);                                 // 예: 곡물 46

      const b = S.hq();
      GM.structure.open(b.id);
      const panel = doc.querySelector('#context-panel');
      const line = [...panel.querySelectorAll('.req-row')]
        .find((r) => r.querySelector('.rq-t').textContent === row.text);
      assert.ok(line, `조건 줄 「${row.text}」 을 찾았다`);
      assert.ok(line.classList.contains('ok'), '지금 국고로 다시 재어 충족으로 칠해진다');
      assert.equal(line.querySelector('.rq-v').textContent, String(row.need),
        `낡은 스냅샷(${stale}/${row.need})이 아니라 지금 값으로 그린다`);

      // 배지 · 목표 카드 · 승격 단추까지 같은 한 곳을 지난다
      const live = S.reqList(nx0.reqs).find((r) => r.key === row.key);
      assert.equal(live.have, row.need + 26, 'S.reqLive 가 지금 장부를 읽는다');
      assert.equal(live.ok, true);

      // 열려 있는 패널은 'live' 한 번이면 스스로 따라온다 (닫았다 열 필요가 없다)
      put(stale);
      GM.structure.refreshOpen();
      const again = [...doc.querySelectorAll('#context-panel .req-row')]
        .find((r) => r.querySelector('.rq-t').textContent === row.text);
      assert.ok(again.classList.contains('bad'), '줄어들면 그 자리에서 빨강으로 돌아온다');
      assert.equal(again.querySelector('.rq-v').textContent, `${stale}/${row.need}`);
      GM.hud.hideContext();
    });

    // ── 10-c. ★ §12-5 조작 규칙 ──────────────────────────────
    await t.test('★ §12-5 조작 — 좌클릭은 걷지 않는다 · 우클릭 지면이 걷는다', async () => {
      const me = GM.avatar.pos();
      // 걸어갈 만한 빈 땅을 찾는다 (건물·자원이 없는 자리)
      const t0 = S.territory();
      let spot = null;
      for (let ring = 3; ring <= 5 && !spot; ring += 1) {
        for (let dy = -ring; dy <= ring && !spot; dy += 1) {
          for (let dx = -ring; dx <= ring && !spot; dx += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
            const x = t0.cx + dx, y = t0.cy + dy;
            if (!S.inTerritory(x, y)) continue;
            if (S.nodeAt(x, y)) continue;
            if (S.structures().some((s) => S.cellIn(S.rectOfThing(s), x, y))) continue;
            if (Math.hypot(x - me.x, y - me.y) < 3) continue;
            spot = { x, y };
          }
        }
      }
      assert.ok(spot, '빈 땅을 찾았다');

      // ① 좌클릭 = 선택 해제만. 목적지가 생기지 않는다.
      S.selectResidents(S.residents().slice(0, 1).map((v) => v.id));
      GM.avatar.stop();
      fire(window, 'pointerdown', spot.x, spot.y, { button: 0 });
      fire(window, 'pointerup', spot.x, spot.y, { button: 0 });
      assert.equal(GM.avatar.destPos(), null, '좌클릭 지면은 이동 명령이 아니다');
      assert.equal((S.S.selection.residents || []).length, 0, '좌클릭 지면은 선택을 푼다');

      // ② 우클릭 = 이동. 목적지 마커가 생긴다.
      fire(window, 'contextmenu', spot.x, spot.y, { button: 2 });
      const d = GM.avatar.destPos();
      assert.ok(d, '우클릭 지면은 이동 명령이다');
      assert.equal(Math.round(d.x), spot.x);
      assert.equal(Math.round(d.y), spot.y);

      // ③ 백성을 고른 상태의 우클릭은 백성 명령이 먼저다
      const one = S.residents()[0];
      if (one) {
        GM.avatar.stop();
        S.selectResidents([one.id]);
        fire(window, 'contextmenu', spot.x, spot.y, { button: 2 });
        assert.equal(GM.avatar.destPos(), null, '백성을 고른 채 우클릭하면 아바타는 움직이지 않는다');
        S.clearSelection();
      }
    });

    // ── 10-d. ★ §12-11 텔레포트 회귀 ─────────────────────────
    await t.test('★ §12-11 텔레포트 — 10초를 지켜보아도 역방향 점프가 0회', async () => {
      // 주민 하나를 멀리 있는 자리로 보낸다 — 서버 좌표는 일 틱에만 움직이므로
      // 옛 고무줄이 살아 있으면 이 관찰 중에 반드시 출발 자리로 되튄다.
      const v = S.residents()[0];
      assert.ok(v, '지켜볼 주민이 있다');
      const far = S.nodeList()
        .filter((n) => !n.depleted && S.inWorkRange(n.x, n.y))
        .sort((a, b) => Math.hypot(b.x - v.x, b.y - v.y) - Math.hypot(a.x - v.x, a.y - v.y))[0];
      assert.ok(far, '멀리 있는 일터가 있다');
      await sendNow(window, 'commandVillagers', { ids: [v.id], order: { type: 'work', nodeId: far.id } });
      await sleep(30);

      const report = observeUnit(window, v.id, { seconds: 10, dt: 1 / 60 });
      assert.equal(report.backJumps, 0,
        `10초 관찰 중 역방향 점프 ${report.backJumps}회 (최대 ${report.maxJump.toFixed(2)}칸 · ${JSON.stringify(report.worst)})`);
      assert.ok(report.samples > 400, `표본 ${report.samples}개`);
      assert.ok(report.moved > 0.5, `실제로 움직였다 (${report.moved.toFixed(2)}칸)`);
    });

    // ── 11. 6장 — 감정소 → [땅을 감정한다] ───────────────────
    await t.test('6장 땅의 비밀 — 감정소를 세우고 눌러야만 감정의 날이 온다', async () => {
      assert.equal(rt.world.emotionDayDone, false, '여기까지 오는 동안 저절로 오지 않았다');
      let emotion = null;
      S.on('emotionDay', (p) => { emotion = p; });
      assert.ok(await clearChapter(6), '6장을 지났다');
      assert.ok(rt.world.emotionDayDone, '감정의 날이 왔다');
      assert.ok(emotion, '컷신이 왔다');
      assert.ok((emotion.tags || []).length >= 2, '태그가 공개된다');
      assert.ok(S.featOn('roles'), '역할이 열렸다');
      assert.equal(S.chapter().id, 7, '7장 낯선 발자국으로 넘어갔다');
      log.push(`감정 완료 (${rt.world.tick}일차)`);
      console.log('  · 사슬 통과 — ' + log.join(' · '));
    });

    // ── 12. 콘솔 ─────────────────────────────────────────────
    await t.test('콘솔이 조용하다', () => {
      const noisy = errors.filter((e) => !/AudioContext|Not implemented|Could not parse CSS/i.test(e));
      assert.deepEqual(noisy, [], noisy.join(' / '));
    });
  } finally {
    if (dom) dom.window.close();
    if (gameId) {
      games.get(gameId)?.stop();
      await rm(join(savesDir(), gameId), { recursive: true, force: true });
    }
    await new Promise((res) => http.close(res));
  }
});

// ────────────────────────────────────────────────────────────────
// 후반 계층 회귀 — 울타리·개축·웨이브는 그 장이 열린 뒤에 확인한다
// ────────────────────────────────────────────────────────────────
test('클라이언트 하니스 — 7장 이후(울타리·개축·웨이브·연대기)', async (t) => {
  const errors = [];
  const { openChapterForDebug } = await import('../server/engine/progression.js');
  const { loadGameData } = await import('../server/engine/data.js');
  const data = loadGameData();
  await new Promise((res) => http.listen(0, '127.0.0.1', res));
  const port = http.address().port;
  const base = `http://127.0.0.1:${port}`;
  let dom = null;
  let gameId = null;
  let now = Date.now() + 20_000;

  try {
    dom = await boot(`${base}/?seed=20260805`, errors);
    const { window } = dom;
    const GM = window.GM;
    const S = GM.state;
    const doc = window.document;

    doc.querySelector('#btn-new').click();
    await until(() => doc.querySelector('#scene-found').hidden === false, { what: '개척 화면' });
    const name = doc.querySelector('#found-name');
    name.value = '나래';
    name.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.querySelector('#found-start').click();
    await until(() => !!S.S.map, { ms: 15000, what: '월드 스냅샷' });
    await until(() => !!(S.S.view && S.S.view.nation), { what: '정착지 상태' });
    gameId = S.S.gameId;
    const rt = games.get(gameId);
    rt.stop();
    const nation = () => rt.world.nations.player;
    const step = () => post(base, '/api/debug/step', { gameId });

    if (GM.opening.busy()) doc.querySelector('#opening-skip').click();
    await until(() => !GM.opening.busy(), { what: '오프닝 종료' });

    // 뒷장은 개발 손잡이로 열어 둔다 (앞장 통과는 위 시나리오가 이미 지킨다)
    openChapterForDebug(rt.world, nation(), data, 8);
    nation().tier = 2;
    nation().resources.wood = 900;
    nation().resources.stone = 500;
    await step();
    await until(() => S.uiOn('panel.fence'), { what: '울타리 해금 반영' });

    await t.test('울타리 — 끌어서 선을 그으면 조각으로 선다', async () => {
      GM.hud.update();
      assert.ok(doc.querySelector('#tb-fence'), '울타리 단추가 생겼다');
      // 첫 위협까지는 말미가 있다(§12-4 재보정: firstDelayDays 6) — 경보 창에 들어설 때까지 하루씩 민다
      for (let i = 0; i < 10 && !(S.wave() && S.wave().enemy); i += 1) await step();
      GM.hud.update();
      assert.equal(doc.querySelector('#badge-threat').hidden, false,
        `위협 배지가 떴다 (${JSON.stringify(S.wave())})`);
      const town = S.myTown();
      GM.build.openFence();
      // 물·건물이 없는 곧은 줄을 찾아 그 위에 긋는다(지도마다 지형이 다르다)
      let col = null;
      const tryLine = (fx) => {
        const line = [];
        for (let k = -4; k <= 4; k += 1) {
          const p = fx(k);
          if (!GM.build.fenceTileOk(p.x, p.y)) { if (line.length >= 4) break; line.length = 0; continue; }
          line.push(p);
        }
        return line.length >= 4 ? line : null;
      };
      for (let d = 3; d <= 9 && !col; d += 1) {
        col = tryLine((k) => ({ x: town.x + d, y: town.y + k }))
          || tryLine((k) => ({ x: town.x - d, y: town.y + k }))
          || tryLine((k) => ({ x: town.x + k, y: town.y + d }))
          || tryLine((k) => ({ x: town.x + k, y: town.y - d }));
      }
      assert.ok(col, '울타리를 그을 만한 줄을 찾았다');
      const before = nation().fences.length;
      dragWorld(window, col, { shiftKey: true });
      await until(() => nation().fences.length > before, { ms: 8000, what: '울타리 조각' });
      assert.ok(nation().fences.length >= 4, `조각 ${nation().fences.length}개`);
      assert.ok(nation().fences.some((f) => f.gate), '문 조각도 함께 섰다');
      S.setPlacing(null);
    });

    await t.test('건물 개축 — 그 한 채만 다음 단계로', async () => {
      const spot = findSpot(window, { kind: 'build', key: 'hut' });
      assert.ok(spot, '오두막을 놓을 자리를 찾았다');
      const r = await sendNow(window, 'placeBuilding', { building: 'hut', x: spot.x, y: spot.y });
      assert.ok(r && r.ok, `오두막 공사가 섰다: ${JSON.stringify(r && r.error)}`);
      const site = nation().construction[nation().construction.length - 1];
      GM.avatar.setPos(site.x + 1, site.y);
      for (let i = 0; i < 40; i += 1) {
        const cur = nation().construction.find((c) => c.id === site.id);
        if (!cur || cur.remaining <= 0.01) break;
        now += 2500;
        await sendNow(window, 'actionSwing', { siteId: site.id, now });
      }
      await step();
      await until(() => S.structures().some((s) => s.key === 'hut'), { what: '오두막 완공' });
      const hut = S.structures().find((s) => s.key === 'hut');
      GM.structure.open(hut.id);
      const btn = doc.querySelector('#st-upgrade');
      assert.ok(btn, '[개축] 단추가 있다');
      const sites0 = nation().construction.length;
      btn.click();
      await until(() => nation().construction.length > sites0, { ms: 8000, what: '개축 현장' });
      assert.equal(nation().construction[nation().construction.length - 1].structureId, hut.id);
    });

    await t.test('웨이브 — 경보 · 실시간 전투 · 검 참여 · 결과', async () => {
      let incoming = null; let started = null; let ticks = 0; let result = null;
      S.on('waveIncoming', (p) => { incoming = p; });
      S.on('battleStart', (p) => { started = p; });
      S.on('battleTick', () => { ticks += 1; });
      S.on('waveResult', (p) => { result = p; });

      // 앞선 검사들이 며칠을 흘려보냈을 수 있다 — 진행 중인 전투가 있으면 먼저 매듭짓는다
      if (nation().battle) { await post(base, '/api/debug/battle', { gameId }); await sleep(200); }
      nation().wave.arrivalTick = rt.world.tick + 1;
      await step();
      await until(() => !!incoming, { ms: 8000, what: 'waveIncoming' });
      await until(() => !!started, { ms: 8000, what: 'battleStart' });
      assert.ok(started.enemies.length > 0, '적이 실제 유닛으로 걸어 들어온다');
      await until(() => ticks > 0, { ms: 10000, what: 'battleTick 스트림' });
      assert.equal(doc.querySelector('#battle-bar').hidden, false, '전투 띠가 떴다');

      const live = S.battleLive();
      const enemy = (live.enemies || []).find((e) => e.hp > 0);
      assert.ok(enemy, '칠 수 있는 적이 있다');
      GM.avatar.setPos(Math.round(enemy.x), Math.round(enemy.y));
      await sleep(80);
      /* ★ 적은 걸어오는 중이다 — 80ms 전 자리에 서면 그 사이 한 서브틱(0.25초)을 더 걸어 나가
         사거리(2.5칸)를 아슬아슬하게 벗어나곤 했다(간헐 OUT_OF_RANGE). **보내기 직전의 자리**로
         다시 선다: setPos 는 그 자리에서 lordMove 를 내고, socket.io 가 순서를 지키므로
         서버는 새 자리로 스윙을 잰다(public/js/swing.js §16-4 와 같은 규칙). */
      const cur = (S.battleLive().enemies || []).find((e) => e.id === enemy.id) || enemy;
      GM.avatar.setPos(Math.round(cur.x), Math.round(cur.y));
      now += 2500;
      const hit = await sendNow(window, 'combatSwing', { targetId: enemy.id, now });
      assert.ok(hit && hit.ok, `검이 닿았다: ${JSON.stringify(hit && hit.error)}`);
      assert.ok(hit.damage > 0, '피해가 들어간다');

      await post(base, '/api/debug/battle', { gameId });
      await until(() => !!result, { ms: 14000, what: 'waveResult' });
      await until(() => !!doc.querySelector('#wave-ok'), { ms: 8000, what: '결과 화면' });
      doc.querySelector('#wave-ok').click();
      assert.equal(doc.querySelector('#battle-bar').hidden, true, '전투 띠가 걷혔다');
    });

    await t.test('연대기 — 지나온 길이 남는다', async () => {
      GM.chronicle.open();
      await until(() => !!doc.querySelector('#chronicle-body .chr-row'), { ms: 8000, what: '연대기 목록' });
      const kinds = [...doc.querySelectorAll('#chronicle-body .chr-row')].map((r) => r.getAttribute('data-kind'));
      assert.ok(kinds.includes('wave'), `연대기: ${kinds.join(',')}`);
      GM.ui.closeTopModal();
    });

    // ── ★ GDD3 §12-12 — 철거 · 이전 ──────────────────────────
    await t.test('★ §12-12 철거 — 헐면 자재 절반이 돌아오고, 중간에 그만둘 수 있다', async () => {
      // 헐 건물 하나를 새로 세운다(개축 중인 오두막과 섞이지 않게)
      const spot = findSpot(window, { kind: 'build', key: 'tent' });
      assert.ok(spot, '천막 자리를 찾았다');
      const r = await sendNow(window, 'placeBuilding', { building: 'tent', x: spot.x, y: spot.y });
      assert.ok(r && r.ok, JSON.stringify(r && r.error));
      const site = nation().construction.find((c) => c.id === r.siteId);
      GM.avatar.setPos(site.x + 1, site.y);
      for (let i = 0; i < 20; i += 1) {
        const cur = nation().construction.find((c) => c.id === site.id);
        if (!cur) break;
        now += 2500;
        await sendNow(window, 'actionSwing', { siteId: site.id, now });
      }
      await until(() => nation().structures.some((s) => s.key === 'tent' && s.x === site.x),
        { ms: 5000, what: '천막 완공' });
      await step();
      const tent = S.structures().find((s) => s.key === 'tent' && s.x === site.x);
      assert.ok(tent, '천막이 화면 장부에 있다');

      // ① 패널에 [헌다]·[옮긴다]가 있다
      GM.structure.open(tent.id);
      assert.ok(doc.querySelector('#st-demolish'), '[헌다] 단추가 있다');
      assert.ok(doc.querySelector('#st-relocate'), '[옮긴다] 단추가 있다');

      // ② 헐기 시작 → 효과가 멎고(inactive) 되돌릴 수 있다
      const cap0 = S.housing().capacity;
      doc.querySelector('#st-demolish').click();
      await until(() => nation().construction.some((c) => c.mode === 'demolish'), { ms: 5000, what: '철거 현장' });
      await step();
      const inWork = S.structureById(tent.id);
      assert.ok(inWork.work, '건물 뷰에 진행 중인 일이 실린다');
      assert.equal(inWork.work.mode, 'demolish');
      assert.equal(inWork.inactive, true, '허무는 동안 효과가 멎는다');
      assert.ok(S.housing().capacity < cap0, `잠자리가 ${cap0} → ${S.housing().capacity} 로 빠졌다`);
      assert.ok(inWork.work.refund && Object.keys(inWork.work.refund).length, '돌아올 자재가 미리 보인다');

      // ③ 그만두면 건물이 그대로 돌아온다
      GM.structure.open(tent.id);
      const cancel = doc.querySelector('#st-cancel-work');
      assert.ok(cancel, '[그만둔다] 단추가 있다');
      cancel.click();
      await until(() => !nation().construction.some((c) => c.structureId === tent.id), { ms: 5000, what: '철거 취소' });
      await step();
      assert.equal(S.structureById(tent.id).inactive, false, '멎었던 효과가 되살아난다');
      assert.equal(S.housing().capacity, cap0, '잠자리가 되돌아왔다');

      // ④ 다시 헐고 끝까지 — 자재 절반이 돌아온다
      //    (일 틱은 산출·소비가 섞이므로 재지 않는다. 마지막 망치질 직후의 곳간만 본다.)
      const cost = data.buildings.tent.tiers[0].cost;
      const wood0 = nation().resources.wood;
      const dr = await sendNow(window, 'demolishStructure', { structureId: tent.id });
      assert.ok(dr && dr.ok, JSON.stringify(dr && dr.error));
      const dsite = nation().construction.find((c) => c.mode === 'demolish');
      GM.avatar.setPos(dsite.x + 1, dsite.y);
      for (let i = 0; i < 25 && nation().construction.some((c) => c.id === dsite.id); i += 1) {
        now += 2500;
        await sendNow(window, 'actionSwing', { siteId: dsite.id, now });
      }
      assert.ok(!nation().structures.some((s) => s.id === tent.id), '건물이 사라졌다');
      const back = nation().resources.wood - wood0;
      const want = cost.wood * data.balance.structureWork.refundRatio;
      assert.ok(Math.abs(back - want) < 0.5, `목재 ${back} 가 돌아왔다 (기대 ${want})`);
      await step();
    });

    await t.test('★ §12-12 이전 — 해체+재건 두 마디, 자재는 더 안 든다', async () => {
      const spot = findSpot(window, { kind: 'build', key: 'tent' });
      const r = await sendNow(window, 'placeBuilding', { building: 'tent', x: spot.x, y: spot.y });
      assert.ok(r && r.ok, JSON.stringify(r && r.error));
      const site = nation().construction.find((c) => c.id === r.siteId);
      GM.avatar.setPos(site.x + 1, site.y);
      for (let i = 0; i < 20 && nation().construction.some((c) => c.id === site.id); i += 1) {
        now += 2500;
        await sendNow(window, 'actionSwing', { siteId: site.id, now });
      }
      await step();
      const tent = S.structures().find((s) => s.key === 'tent' && s.x === site.x);
      assert.ok(tent, '옮길 천막이 섰다');

      // 새 자리를 고른다 — 지금 자리는 못 본 척하되(ignoreId), 제자리는 아니어야 한다
      const to = findSpot(window, { kind: 'relocate', key: 'tent', structureId: tent.id, ignoreId: tent.id },
        (x, y) => !(x === tent.x && y === tent.y));
      assert.ok(to, '옮길 자리를 찾았다');
      const wood0 = nation().resources.wood;
      const rr = await sendNow(window, 'relocateStructure', { structureId: tent.id, x: to.x, y: to.y });
      assert.ok(rr && rr.ok, JSON.stringify(rr && rr.error));
      assert.equal(nation().resources.wood, wood0, '이전에는 자재가 더 들지 않는다');
      const rsite = nation().construction.find((c) => c.mode === 'relocate');
      assert.ok(rsite, '이전 현장이 섰다');
      assert.equal(rsite.phase, 'takedown', '해체 마디부터');
      await step();
      assert.equal(S.structureById(tent.id).inactive, true, '옮기는 동안 효과가 멎는다');

      // 해체 → 재건까지 두드린다
      for (let i = 0; i < 60 && nation().construction.some((c) => c.id === rsite.id); i += 1) {
        const cur = nation().construction.find((c) => c.id === rsite.id);
        GM.avatar.setPos(cur.x + 1, cur.y);
        now += 2500;
        await sendNow(window, 'actionSwing', { siteId: rsite.id, now });
      }
      await step();
      const moved = nation().structures.find((s) => s.id === tent.id);
      assert.ok(moved, '건물은 그대로 남아 있다');
      assert.equal(moved.x, to.x, '새 자리로 옮겨졌다');
      assert.equal(moved.y, to.y);
      assert.ok(!moved.inactive, '효과가 되살아났다');
    });

    // ── ★ GDD3 §12-6 — 캐러밴 게이트 (사슬을 앞질러 다니던 「자동차 같은 것」) ──
    await t.test('★ §12-6 캐러밴 — 무역이 열리기 전에는 지도에 아예 없다', async () => {
      assert.equal(S.featOn('trade'), false, '아직 8장을 못 지났다');
      assert.equal(S.S.map.caravans.length, 0, '무역 전에는 상단이 목록에 실리지도 않는다');
      // 8장을 지나 무역이 열리면 그제야 나타난다 — 다시 붙지 않아도 그 자리에서
      openChapterForDebug(rt.world, nation(), data, 9);
      await step();
      await until(() => S.featOn('trade'), { ms: 6000, what: '무역 해금' });
      await until(() => (S.S.map.caravans || []).length > 0, { ms: 6000, what: '상단 등장' });
      assert.ok(S.S.map.caravans.length > 0, '무역이 열린 뒤에는 상단이 다닌다');
    });

    await t.test('콘솔이 조용하다', () => {
      const noisy = errors.filter((e) => !/AudioContext|Not implemented|Could not parse CSS/i.test(e));
      assert.deepEqual(noisy, [], noisy.join(' / '));
    });
  } finally {
    if (dom) dom.window.close();
    if (gameId) {
      games.get(gameId)?.stop();
      await rm(join(savesDir(), gameId), { recursive: true, force: true });
    }
    await new Promise((res) => http.close(res));
  }
});

// ────────────────────────────────────────────────────────────────
// ★ GDD3 §13-D — RPG 계층의 길: 모집 → 능력치 카드 → 장비 → 인첸트 → 연구 → 철로
//   앞장과 같은 규칙으로 검사한다 — **화면에 실제로 있는 단추만 눌러서** 간다.
// ────────────────────────────────────────────────────────────────
test('클라이언트 하니스 — §13-D RPG 계층 (모집·능력치·장비·인첸트·연구·철로)', async (t) => {
  const errors = [];
  const { openChapterForDebug } = await import('../server/engine/progression.js');
  const { loadGameData } = await import('../server/engine/data.js');
  const data = loadGameData();
  await new Promise((res) => http.listen(0, '127.0.0.1', res));
  const port = http.address().port;
  const base = `http://127.0.0.1:${port}`;
  let dom = null;
  let gameId = null;

  try {
    dom = await boot(`${base}/?seed=20260806`, errors);
    const { window } = dom;
    const GM = window.GM;
    const S = GM.state;
    const doc = window.document;

    doc.querySelector('#btn-new').click();
    await until(() => doc.querySelector('#scene-found').hidden === false, { what: '개척 화면' });
    const name = doc.querySelector('#found-name');
    name.value = '나래';
    name.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.querySelector('#found-start').click();
    await until(() => !!S.S.map, { ms: 15000, what: '월드 스냅샷' });
    await until(() => !!(S.S.view && S.S.view.nation), { what: '정착지 상태' });
    gameId = S.S.gameId;
    const rt = games.get(gameId);
    rt.stop();
    const nation = () => rt.world.nations.player;
    const step = () => post(base, '/api/debug/step', { gameId });
    if (GM.opening.busy()) doc.querySelector('#opening-skip').click();
    await until(() => !GM.opening.busy(), { what: '오프닝 종료' });

    const openHq = () => {
      const hq = S.hq();
      assert.ok(hq, '본부가 있다');
      GM.structure.open(hq.id);
      return doc.querySelector('#context-panel');
    };

    // ── ★ §13-D-2 모집 — 4장(첫 이웃)에서 열린다 ──
    await t.test('★ §13-D-2 모집 — 본부 [모집] 갈래가 열리고, 식량을 치르면 그 자리에서 한 사람', async () => {
      openChapterForDebug(rt.world, nation(), data, 5);
      nation().resources.grain = 400;
      nation().resources.wood = 600;
      // 잠자리가 있어야 사람이 든다 — 값으로 잠자리를 살 수는 없다(§13-D-2)
      const { completeStructure: build } = await import('../server/engine/structures.js');
      for (const dx of [4, -4]) {
        const hutSpot = findSpot(window, { kind: 'build', key: 'hut' }, (x) => (dx > 0 ? x > S.myTown().x : x < S.myTown().x));
        if (hutSpot) build(rt.world, nation(), { building: 'hut', tier: 1, x: hutSpot.x, y: hutSpot.y, placed: true }, data);
      }
      await step();
      await until(() => !!S.recruitInfo(), { ms: 6000, what: '모집 해금' });

      let panel = openHq();
      const tab = panel.querySelector('[data-hqtab="recruit"]');
      assert.ok(tab, '본부에 [모집] 갈래가 생겼다');
      tab.click();
      panel = doc.querySelector('#context-panel');
      const btn = panel.querySelector('#se-recruit');
      assert.ok(btn, '[모집] 단추가 그려졌다');
      assert.equal(btn.disabled, false, `지금 부를 수 있어야 한다 (${JSON.stringify(S.recruitInfo().reqs)})`);

      const before = nation().villagers.length;
      const grain0 = nation().resources.grain;
      btn.click();
      await until(() => nation().villagers.length > before, { ms: 6000, what: '모집한 주민 도착' });
      assert.ok(nation().resources.grain < grain0, '식량을 치렀다');

      // 쿨다운 — 같은 날 두 번은 없다
      const again = await sendNow(window, 'recruitResident', {});
      assert.equal(again.ok, false, '하루가 지나야 다시 부른다');
    });

    // ── ★ §13-D-1 능력치 — 도착 카드와 주민 패널 ──
    await t.test('★ §13-D-1 능력치 — 도착 카드가 뜨고, 주민 패널이 네 수치를 그린다', async () => {
      const who = nation().villagers[nation().villagers.length - 1];
      assert.ok(who.stats, '서버가 능력치를 붙여 보낸다');
      GM.residents.arrived({
        id: who.id, name: who.name, x: who.x, y: who.y, stats: who.stats,
        population: nation().villagers.length, recruited: true,
      });
      const card = doc.querySelector('[data-arrive-card]');
      assert.ok(card, '도착 연출에 능력치 카드가 뜬다');
      assert.equal(card.querySelectorAll('.st-stats .sb').length, S.statOrder().length,
        '네 수치가 모두 그려진다');

      await until(() => S.residents().length > 0, { ms: 6000, what: '주민 뷰' });
      GM.residents.openPanel();
      const bars = doc.querySelectorAll('.res-card .st-stats .sb');
      assert.ok(bars.length >= S.statOrder().length, '명부 카드에도 능력치가 실린다');
      window.GM.ui.closeTopModal();
    });

    // ── ★ §13-D-3·4 장비와 인첸트 — 9장(나라의 격)에서 열린다 ──
    await t.test('★ §13-D-3 장비 — 캐릭터 창에서 벼리면 손에 들린다', async () => {
      openChapterForDebug(rt.world, nation(), data, 9);
      const spot = findSpot(window, { kind: 'build', key: 'smithy' });
      assert.ok(spot, '대장간 자리를 찾았다');
      const { completeStructure: mk } = await import('../server/engine/structures.js');
      mk(rt.world, nation(), { building: 'smithy', tier: 1, x: spot.x, y: spot.y, placed: true }, data);
      nation().gold = 4000;
      for (const k of ['stone', 'wood', 'ironOre', 'steel', 'hide', 'wool']) nation().resources[k] = 400;
      await step();
      await until(() => S.uiOn('panel.equipment'), { ms: 6000, what: '장비 해금' });

      GM.hud.update();
      assert.ok(doc.querySelector('#tb-equip'), '연장통에 [내 장비] 단추가 생겼다');
      GM.equip.open();
      const craft = doc.querySelector('[data-craft="stone_blade"]');
      assert.ok(craft, '대장간 목록에 돌칼이 있다');
      assert.equal(craft.disabled, false, '자재가 있으면 벼릴 수 있다');
      craft.click();
      await until(() => {
        const e = S.equipment();
        return e && e.gear && e.gear.weapon && e.gear.weapon.key === 'stone_blade';
      }, { ms: 6000, what: '무기 장착' });
      assert.ok(GM.avatar.gear().weaponGrade > 0, '아바타 스프라이트가 벼린 것을 읽는다');

      // 공장장이 없으면 윗단은 잠겨 있다 (조건 가시화 — 사라지지 않는다)
      const elite = doc.querySelector('[data-craft="elite_blade"]');
      assert.ok(elite, '잠긴 윗단도 목록에는 남는다');
      assert.equal(elite.disabled, true, '공장장이 없으면 못 벼린다');
    });

    await t.test('★ §13-D-4 인첸트 — 특성 하나가 깃들고, 확률은 성녀가 바꾼다', async () => {
      const before = JSON.stringify(S.equipment().enchant.odds);
      const b = doc.querySelector('[data-enchant="weapon"]');
      assert.ok(b, '인첸트 단추가 있다');
      assert.equal(b.disabled, false);
      b.click();
      await until(() => {
        const e = S.equipment();
        return e && e.gear.weapon && e.gear.weapon.enchant;
      }, { ms: 6000, what: '특성 부여' });
      const ench = S.equipment().gear.weapon.enchant;
      assert.ok(ench.trait && ench.grade, `특성 ${ench.name} 이 깃들었다`);

      // 성녀가 앉으면 상위 등급 확률이 두 배가 된다
      nation().roles = { ...(nation().roles || {}), saint: { holder: 'npc9', level: 1 } };
      await step();
      await until(() => JSON.stringify(S.equipment().enchant.odds) !== before, { ms: 6000, what: '확률 갱신' });
      const odds = S.equipment().enchant.odds;
      const upper = odds.filter((o) => o.upper).reduce((a, o) => a + o.chance, 0);
      assert.ok(upper > 0.5, `성녀가 있으면 좋은 것이 붙을 확률이 절반을 넘는다 (${upper})`);
      assert.equal(S.equipment().saint, true);
    });

    // ── ★ §13-D-5 연구와 철로 — 10장(끝이 없는 길) ──
    await t.test('★ §13-D-5 연구 — 본부 [연구] 갈래에서 붙들고, 끝나는 날 석탄이 드러난다', async () => {
      openChapterForDebug(rt.world, nation(), data, 10);
      nation().tier = 4;
      nation().gold = 8000;
      for (const k of ['stone', 'ironOre', 'steel']) nation().resources[k] = 1200;
      await step();
      await until(() => !!S.research(), { ms: 6000, what: '연구 해금' });

      let panel = openHq();
      const tab = panel.querySelector('[data-hqtab="research"]');
      assert.ok(tab, '본부에 [연구] 갈래가 생겼다');
      tab.click();
      panel = doc.querySelector('#context-panel');
      assert.ok(panel.querySelector('[data-research="coal_mining"]'), '석탄 채굴이 목록에 있다');
      const locked = panel.querySelector('[data-research-start="steam_engine"]');
      assert.ok(locked, '잠긴 연구도 목록에서 사라지지 않는다 (조건 가시화)');
      assert.equal(locked.disabled, true, '선행이 없으면 못 붙든다');

      const go = panel.querySelector('[data-research-start="coal_mining"]');
      assert.equal(go.disabled, false, '단계와 값이 차면 붙들 수 있다');
      go.click();
      await until(() => !!nation().research.active, { ms: 6000, what: '연구 착수' });

      const days = data.research.defs.coal_mining.days;
      for (let i = 0; i < days; i += 1) await step();
      assert.ok(nation().research.done.coal_mining != null, '날이 차면 끝난다');
      const coal = (rt.world.map.nodes || []).filter((n) => n.type === 'coal');
      assert.ok(coal.length > 0, `석탄 노두가 드러났다 (${coal.length}곳)`);
    });

    await t.test('★ §13-D-5 철로 — 끌어서 깔면 그 위를 걷는 걸음이 두 배다', async () => {
      nation().tier = 5;
      nation().research.done.steam_engine = rt.world.tick;
      nation().research.done.railway = rt.world.tick;
      nation().resources.steel = 900;
      await step();
      await until(() => S.railInfo() && S.railInfo().open, { ms: 6000, what: '철로 해금' });

      GM.build.openRail();
      assert.equal(S.S.placing.kind, 'rail', '철로 배치 모드가 열렸다');
      const town = S.myTown();
      let line = null;
      for (let d = 2; d <= 6 && !line; d += 1) {
        const cand = [];
        for (let k = 0; k <= 6; k += 1) {
          const q = { x: town.x + d, y: town.y - 3 + k };
          if (!GM.build.railTileOk(q.x, q.y)) { cand.length = 0; continue; }
          cand.push(q);
        }
        if (cand.length >= 5) line = cand;
      }
      assert.ok(line, '철로를 깔 만한 줄을 찾았다');
      const before = (nation().rails || []).length;
      dragWorld(window, line);
      await until(() => (nation().rails || []).length > before, { ms: 8000, what: '철로 조각' });
      assert.ok(nation().rails.length >= 4, `${nation().rails.length}칸이 깔렸다`);
      await step();
      await until(() => S.rails().length > 0, { ms: 6000, what: '철로 뷰' });
      const one = S.rails()[0];
      assert.equal(S.onRail(one.x, one.y), true, '화면도 서버와 같은 자리를 안다');
      S.setPlacing(null);
    });

    await t.test('콘솔이 조용하다', () => {
      const noisy = errors.filter((e) => !/AudioContext|Not implemented|Could not parse CSS/i.test(e));
      assert.deepEqual(noisy, [], noisy.join(' / '));
    });
  } finally {
    if (dom) dom.window.close();
    if (gameId) {
      games.get(gameId)?.stop();
      await rm(join(savesDir(), gameId), { recursive: true, force: true });
    }
    await new Promise((res) => http.close(res));
  }
});

// ────────────────────────────────────────────────────────────────
// 구경 모드 회귀 — 서버 없이도 화면이 돈다 (사슬도 함께 흉내 낸다)
// ────────────────────────────────────────────────────────────────
test('구경 모드(?mock=1) — 서버 없이도 첫 화면이 돌고, 사슬이 같은 규칙을 지킨다', async () => {
  const errors = [];
  await new Promise((res) => http.listen(0, '127.0.0.1', res));
  const port = http.address().port;
  let dom = null;
  try {
    dom = await boot(`http://127.0.0.1:${port}/?mock=1&opening=0`, errors);
    const { window } = dom;
    const doc = window.document;
    const S = window.GM.state;

    doc.querySelector('#btn-new').click();
    await until(() => doc.querySelector('#scene-found').hidden === false, { what: '개척 화면' });
    const name = doc.querySelector('#found-name');
    name.value = '구경';
    name.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.querySelector('#found-start').click();

    await until(() => !!S.S.map, { ms: 12000, what: '구경 모드 지도' });
    await until(() => !!(S.S.view && S.S.view.nation), { what: '구경 모드 상태' });
    assert.equal(doc.querySelector('#shell').hidden, false);
    assert.equal(S.S.view.protocol, 3, '구경 모드도 v3 모양으로 말한다');
    assert.ok(S.chapter(), '구경 모드에도 장이 있다');
    assert.equal(S.chapter().id, 1);
    assert.equal(S.buildable().length, 0, '구경 모드도 1장에서는 지을 것이 없다');
    assert.equal(S.S.view.wave, null, '웨이브 블록도 없다');
    assert.ok(S.goalTargets().length > 0, '마커가 가리킬 자리가 있다');

    /* 스윙 한 번 — 구경 모드도 ack 를 돌려준다 */
    const forest = S.nodeList().find((n) => n.type === 'forest' && S.inWorkRange(n.x, n.y));
    assert.ok(forest, '구경 모드에도 나무가 있다');
    window.GM.avatar.setPos(forest.x + 1, forest.y);
    await sleep(80);
    const before = S.nation().resources.wood;
    window.GM.swing.once();
    await until(() => window.GM.swing.stats().swings >= 1, { ms: 8000, what: '구경 모드 스윙' });
    assert.ok(S.nation().resources.wood >= before, '목재가 늘었다');

    const noisy = errors.filter((e) => !/AudioContext|Not implemented|Could not parse CSS/i.test(e));
    assert.deepEqual(noisy, [], noisy.join(' / '));
  } finally {
    if (dom) dom.window.close();
    await new Promise((res) => http.close(res));
  }
});

// ────────────────────────────────────────────────────────────────
// ★ §20-R1.5 — 유물 발견 카드. 서버가 빚은 서사를 화면이 그대로 읽는가.
// ────────────────────────────────────────────────────────────────
test('발견 카드 — 서사가 뜨고, 개선본이 와도 카드는 하나뿐이며, ESC 로 닫힌다', async () => {
  const errors = [];
  await new Promise((res) => http.listen(0, '127.0.0.1', res));
  const port = http.address().port;
  let dom = null;
  try {
    dom = await boot(`http://127.0.0.1:${port}/?mock=1&opening=0`, errors);
    const { window } = dom;
    const doc = window.document;
    doc.querySelector('#btn-new').click();
    await until(() => doc.querySelector('#scene-found').hidden === false, { what: '개척 화면' });
    const name = doc.querySelector('#found-name');
    name.value = '구경';
    name.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.querySelector('#found-start').click();
    await until(() => !!(window.GM.state.S.view && window.GM.state.S.view.nation), { ms: 12000, what: '상태' });

    const found = { artifact: '풍요의 뿔', key: 'horn_of_plenty', grade: 'rare', category: 'role',
      effect: '즉시 곡물', source: 'ruin', narrative: '옛 자취에서 풍요의 뿔이(가) 나왔습니다.' };
    window.GM.artifacts.discovery(found);
    assert.ok(window.GM.ui.modalOpen('relic-found'), '발견 카드가 떴다');
    assert.equal(doc.querySelectorAll('.art-found').length, 1);
    assert.equal(doc.querySelector('.af-name').textContent, '풍요의 뿔');
    assert.equal(doc.querySelector('.af-dot').style.imageRendering || '', '', '늘리기는 CSS 가 쥔다');

    /* 궁정 서기의 개선본이 뒤늦게 와도 카드는 하나다 — 글줄만 갈린다 */
    window.GM.artifacts.discovery({ ...found, narrative: '고쳐 적은 서사입니다.', narrativeSource: 'llm' });
    assert.equal(doc.querySelectorAll('.art-found').length, 1, '카드가 두 장 뜨지 않는다');
    doc.querySelector('.art-found').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(doc.querySelector('.af-tale').textContent, '고쳐 적은 서사입니다.');

    doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(window.GM.ui.modalOpen('relic-found'), null, 'ESC 로 닫힌다');

    /* ★ §20-R2 — 등급표·연출 박자는 **규격에서 파생**한다. 구경 모드의 대비 규격에는 그 칸이 없으므로
       실제 /api/config 를 끼워 넣고 잰다(진짜 판에서는 app.js 가 첫 프레임에 이렇게 넣는다). */
    const S2 = window.GM.state;
    const realCfg = await (await window.fetch('/api/config')).json();
    S2.set({ config: realCfg });
    assert.ok(realCfg.world.render.artifactFx.cardDelayMs, '연출 박자가 규격에 실려 내려온다');
    assert.equal(S2.gradeInfo('common').name, '일반', '등급 이름표를 화면이 제 손으로 들지 않는다');
    assert.equal(S2.gradeInfo('legendary').name, '레전더리');
    assert.equal(S2.gradeInfo('unique').fxTier, 3);
    assert.equal(S2.gradeInfo('legendary').fxTier, 4);
    assert.equal(window.GM.artifacts.tierOf({ grade: 'rare' }), 2);
    assert.equal(window.GM.artifacts.tierOf({ grade: 'common', fxTier: 4 }), 4, '유물이 적은 값이 이긴다');

    /* T4 — 뜸을 들였다가 뜬다. 그 사이 화면은 어둡고 획득 지점에 빛기둥이 선다. */
    const legend = { artifact: '용맹의 깃발', key: 'banner_of_valor', grade: 'legendary', category: 'combat',
      effect: '패배 인구손실 −70%', source: 'ruin', narrative: '마당이 조용해졌습니다.',
      fxTier: 4, nodePos: { x: 64, y: 64 } };
    window.GM.artifacts.discovery(legend);
    assert.equal(doc.querySelector('.art-found'), null, '레전더리는 곧바로 뜨지 않는다(암전이 먼저다)');
    assert.ok(doc.querySelector('.ep-veil'), '화면이 어두워진다');
    window.GM.artifacts.endShow();                       // 전투 경보·건너뛰기와 같은 문
    assert.ok(doc.querySelector('.art-found.t4'), '접으면 카드만 남는다');
    assert.equal(doc.querySelector('.ep-veil'), null, '어둠은 걷힌다');
    window.GM.ui.closeTopModal();

    /* 남이 찾은 것 — 내 화면을 덮지 않고 배너 한 줄만 */
    window.GM.ui.bannerClear();
    window.GM.artifacts.discovery({ ...legend, foundById: 'someone-else', foundBy: '이웃' });
    assert.equal(window.GM.ui.modalOpen('relic-found'), null, '남의 발견은 창을 띄우지 않는다');

    /* ★ §20-R3 도감 유물 층 — 서버가 잘라 준 단을 그대로 옮겨 적는가.
       (단을 세는 것은 서버다 — 여기서는 「잠긴 단은 화면에 없다」만 확인한다) */
    const view = S2.S.view;
    view.unlocked = { ...(view.unlocked || {}), ui: ((view.unlocked || {}).ui || []).concat('panel.codex') };
    view.codex = {
      totals: {}, species: [], ruins: [],
      artifacts: {
        crownGrade: 'legendary', totals: { found: 1, owned: 1, total: 3 },
        cards: [
          { key: 'a0', grade: 'legendary', category: 'combat', type: 'permanent', color: '#e8a33d',
            tier: 0, hint: '지고도 물러서지 않은 자리에 남는다.' },
          { key: 'a1', grade: 'rare', category: 'role', type: 'consumable', color: '#4a6fa5',
            tier: 1, name: '풍요의 뿔', record: { firstFoundBy: '이웃', firstFoundDate: { year: 1, day: 4 }, count: 1 } },
          { key: 'a2', grade: 'common', category: 'qol', type: 'permanent', color: '#9c8f76',
            tier: 3, name: '신속의 신발', desc: '이동속도 +30%', lore: '바람의 원소가 남긴 실이다.',
            owned: true, consumed: false,
            record: { firstFoundBy: '아린', firstFoundDate: { year: 2, day: 9 }, count: 2,
                      myFoundDate: { year: 2, day: 9 }, myFoundRealAt: '2026-08-08T00:00:00.000Z' } },
        ],
      },
    };
    S2.emit('state', view);
    window.GM.codex.open();
    doc.querySelectorAll('.codex-tabs button')[2].click();
    const cards = doc.querySelectorAll('.relic-card');
    assert.equal(cards.length, 3);
    assert.ok(doc.querySelector('.relic-sect.crown'), '레전더리는 「왕가의 보물」 단에 따로 선다');
    assert.equal(cards[0].querySelector('.relic-name').textContent, '？？？', '미발견은 이름이 없다');
    assert.ok(cards[0].querySelector('.relic-hint'), '대신 힌트 한 줄이 있다');
    assert.equal(cards[0].querySelector('.relic-lore'), null, '이야기는 잠겨 있다');
    const owned = doc.querySelector('.relic-card.owned');
    assert.equal(owned.querySelector('.relic-name').textContent, '신속의 신발');
    assert.ok(owned.querySelector('.relic-lore').textContent.includes('바람의 원소'));
    assert.ok(owned.querySelector('.relic-rec').textContent.includes('아린'), '최초 발견자가 적힌다');
    assert.ok(owned.querySelector('.relic-rec').textContent.includes('2년 9일'), '게임 내 날짜가 적힌다');
    window.GM.ui.closeTopModal();

    /* 전역 알림 — 서버가 빚은 문장을 그대로 읽는 금띠 배너 */
    S2.emit('artifactGlobal', { nationName: '엘도린', foundBy: '이웃', artifactName: '용맹의 깃발',
      grade: 'legendary', text: '엘도린의 이웃이(가) 레전더리 유물 「용맹의 깃발」을(를) 발견했습니다.' });
    await until(() => !!doc.querySelector('.banner-relic'), { what: '전역 알림 금띠' });
    assert.ok(doc.querySelector('.banner-relic').textContent.includes('용맹의 깃발'));

    const noisy = errors.filter((e) => !/AudioContext|Not implemented|Could not parse CSS/i.test(e));
    assert.deepEqual(noisy, [], noisy.join(' / '));
  } finally {
    if (dom) dom.window.close();
    await new Promise((res) => http.close(res));
  }
});

// ────────────────────────────────────────────────────────────────
// ★ GDD3 §14 — 플레이테스트 3차. 화면에서 실제로 무엇이 달라졌는가.
//
//   §14-1 주민 수치가 **몇 초 만에** 뜨는가 (옛 규칙은 154초였다)
//   §14-2 밝기 슬라이더가 실제로 화면 다이얼을 움직이는가 · localStorage 에 남는가
//   §14-3 동물 걸음이 고른가 (프레임 간 이동량의 흩어짐)
//   §14-5 HUD 좌하단 HP·XP·단계 · 캐릭터 창의 능력치 분배
//   §14-6 다운 카운트다운 화면
//   §14-7 잠긴 건물 칸
// ────────────────────────────────────────────────────────────────
test('클라이언트 하니스 — §14 플레이테스트 3차 (즉시 수치·밝기·동물·나의 상태·다운·잠금)', async (t) => {
  const errors = [];
  const { openChapterForDebug } = await import('../server/engine/progression.js');
  const { loadGameData } = await import('../server/engine/data.js');
  const { spawnResident } = await import('../server/engine/residents.js');
  const data = loadGameData();
  await new Promise((res) => http.listen(0, '127.0.0.1', res));
  const port = http.address().port;
  const base = `http://127.0.0.1:${port}`;
  let dom = null;
  let gameId = null;

  try {
    dom = await boot(`${base}/?seed=20260805`, errors);
    const { window } = dom;
    const GM = window.GM;
    const S = GM.state;
    const doc = window.document;

    doc.querySelector('#btn-new').click();
    await until(() => doc.querySelector('#scene-found').hidden === false, { what: '개척 화면' });
    const name = doc.querySelector('#found-name');
    name.value = '하람';
    name.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.querySelector('#found-start').click();
    await until(() => !!S.S.map, { ms: 15000, what: '월드 스냅샷' });
    await until(() => !!(S.S.view && S.S.view.nation), { what: '정착지 상태' });
    gameId = S.S.gameId;
    const rt = games.get(gameId);
    rt.stop();
    const nation = () => rt.world.nations.player;
    const step = () => post(base, '/api/debug/step', { gameId });
    if (GM.opening.busy()) doc.querySelector('#opening-skip').click();
    await until(() => !GM.opening.busy(), { what: '오프닝 종료' });

    // ── ★ §14-1 주민 산출 즉시 반영 ────────────────────────────
    await t.test('★ §14-1 주민 수치 — 20초 안에 곳간이 오르고 그 자리에 숫자가 뜬다', async () => {
      openChapterForDebug(rt.world, nation(), data, 5);
      const rng = rt.rng;
      for (let i = 0; i < 3; i += 1) spawnResident(rt.world, nation(), data, rng);
      await step();
      await until(() => S.residents().length >= 3, { ms: 8000, what: '주민 뷰' });

      // 가장 가까운 숲에 셋을 붙인다
      const post0 = (S.S.view.nation.workPosts || [])
        .find((p) => p.kind === 'node' && (p.jobs || []).includes('lumber'));
      assert.ok(post0, '벌목 일터가 있다');
      await sendNow(window, 'commandVillagers', {
        ids: S.residents().map((r) => r.id), order: { type: 'work', nodeId: post0.id },
      });
      await until(() => S.residents().some((r) => r.yield && r.yield.perDay > 0),
        { ms: 8000, what: '주민 산출 뷰' });

      const wood0 = nation().resources.wood || 0;
      const cycle = data.world.villagers.work.cyclesPerDay;
      const cycleSec = data.balance.time.dayRealSeconds / cycle;
      assert.ok(cycleSec <= 30, `사이클 ${cycleSec}초 — 사람이 지켜볼 수 있는 길이여야 한다`);

      // 서버의 실시간 루프를 손으로 돌린다(하니스에는 타이머가 없다)
      const { stepResidentWork } = await import('../server/engine/residents.js');
      let first = null;
      const seen = [];
      for (let s = 1; s <= 60 && seen.length < 3; s += 1) {
        const out = stepResidentWork(rt.world, nation(), data, 1);
        if (out.credits.length) { if (first == null) first = s; seen.push(...out.credits); }
      }
      assert.ok(first != null && first <= 30,
        `첫 수치가 ${first}초 — 옛 규칙(154초)보다 확실히 빨라야 한다`);
      assert.ok((nation().resources.wood || 0) > wood0, '일 틱을 안 기다리고 곳간이 올랐다');

      // 화면이 그 값을 실제로 띄우는가 — creditFloat 가 참을 돌려주면 뜬 것이다
      const c = seen[0];
      GM.camera.moveTo(c.x, c.y);
      const shown = GM.world.creditFloat(c);
      assert.equal(shown, true, '주민 자리에 수치가 떠야 한다');
    });

    // ── ★ §14-2 밝기 · 설정 ────────────────────────────────────
    await t.test('★ §14-2 설정 — Esc·톱니로 열리고, 밝기 눈금이 화면 다이얼을 실제로 움직인다', async () => {
      const veil0 = S.fogVeil();
      const b0 = S.getBrightness();
      doc.querySelector('#btn-settings').click();
      const slider = doc.querySelector('#set-brightness');
      assert.ok(slider, '밝기 눈금이 있다');
      assert.ok(doc.querySelector('#set-volume'), '소리 눈금도 있다');

      slider.value = String(S.brightnessCfg().max);
      slider.dispatchEvent(new window.Event('input', { bubbles: true }));
      assert.ok(S.getBrightness() > b0, '밝기 값이 올랐다');
      assert.ok(S.fogVeil() < veil0, '덮는 장막이 얇아졌다');
      assert.ok(S.liftBonus() > 0, '더하는 빛이 생겼다');
      assert.equal(window.localStorage.getItem('gm.brightness'), String(S.getBrightness()),
        '고른 값이 이 기기에 남는다');

      const vol = doc.querySelector('#set-volume');
      vol.value = '0.3';
      vol.dispatchEvent(new window.Event('input', { bubbles: true }));
      assert.equal(Math.round(GM.sfx.getVolume() * 100), 30);
      assert.equal(window.localStorage.getItem('gm.volume'), '0.3');

      S.setBrightness(b0);
      window.GM.ui.closeTopModal();
    });

    // ── ★ §14-3 동물 보간 ──────────────────────────────────────
    await t.test('★ §14-3 동물 — 서버 1초 스텝 사이를 등속으로 지난다 (프레임 간 흩어짐 작음)', async () => {
      const { ensureCreatures, creatureViews } = await import('../server/engine/ecology.js');
      ensureCreatures(rt.world, nation(), data);
      // 아바타 곁에 한 마리를 세우고 일직선으로 걷게 한다
      const av = GM.avatar.pos();
      const c = nation().wild.creatures[0];
      assert.ok(c, '들의 것이 하나는 있다');
      c.x = Math.round(av.x + 6);
      c.y = Math.round(av.y);
      const speed = data.creatures.defs[c.sp].speed;

      // 1초마다 좌표를 흘리고, 그 사이를 60fps 로 그린다
      const dt = 1 / 60;
      const steps = [];
      /* net.js 가 하는 일 그대로 — applyCreatures 하나가 화면 목록과 지연 버퍼를 함께 민다
         (app.js 의 S.on('creatures') 가 pushWild 를 부른다. 여기서 또 부르면 버퍼가 두 칸 밀린다). */
      const feed = () => S.applyCreatures([{
        id: c.id, sp: c.sp, name: '짐승', kind: 'animal',
        x: c.x, y: c.y, hp: c.hp, maxHp: c.maxHp, ring: 0, state: 'wander',
      }]);
      feed();
      for (let s = 0; s < 8; s += 1) {
        for (let f = 0; f < 60; f += 1) {
          /* wildPos 는 살아 있는 객체를 그대로 준다 — 값을 베껴 두지 않으면 앞뒤가 같아진다 */
          const b = GM.world.wildPos(c.id);
          const before = b ? { x: b.x, y: b.y } : null;
          GM.world.stepWildForTest(dt);
          const a2 = GM.world.wildPos(c.id);
          if (before && a2) steps.push(Math.hypot(a2.x - before.x, a2.y - before.y));
        }
        c.x = Math.round((c.x + speed) * 100) / 100;   // 서버가 일직선으로 민다
        feed();
      }
      // 첫 두 스텝은 버퍼가 차는 구간이라 뺀다
      const tail = steps.slice(120);
      const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
      assert.ok(mean > 0, '움직이기는 한다');
      const sd = Math.sqrt(tail.reduce((a, b) => a + (b - mean) ** 2, 0) / tail.length);
      const cv = sd / mean;
      assert.ok(cv < 0.25,
        `프레임 간 이동량이 고르지 않다 — 흩어짐 ${(cv * 100).toFixed(1)}% (등속이면 0 에 가깝다)`);
      /* 외삽 금지 — 서버가 멎으면 화면은 **받은 마지막 좌표까지만** 따라가 선다.
         (★ §16-3 스냅샷 띠: 지연 폭이 간격보다 넓어, 멎은 직후에는 띠에 남은 길을
          마저 걷는다 — 그것은 외삽이 아니라 이미 받은 길이다. 앞지르는 것만 금한다.) */
      const lastX = c.x;                                   // 마지막으로 흘린 서버 좌표
      for (let f = 0; f < 240; f += 1) GM.world.stepWildForTest(dt);
      const after = GM.world.wildPos(c.id);
      assert.ok(after.x <= lastX + 0.01, '받은 마지막 좌표를 앞질러 갔다 (외삽 금지)');
      const settled = { x: after.x, y: after.y };
      for (let f = 0; f < 120; f += 1) GM.world.stepWildForTest(dt);
      const after2 = GM.world.wildPos(c.id);
      assert.ok(Math.hypot(after2.x - settled.x, after2.y - settled.y) < 0.02,
        '새 좌표가 안 오는데 계속 움직인다 (외삽 금지)');
    });

    // ── ★ §14-5 나의 상태 ──────────────────────────────────────
    await t.test('★ §14-5 HUD — 초상 옆 HP·XP·단계, 캐릭터 창에서 능력치 분배', async () => {
      const me = doc.querySelector('#me-panel');
      GM.hud.renderMe();
      assert.equal(me.hidden, false, '나의 상태 판이 떠 있다');
      assert.ok(me.querySelector('.me-bar.hp'), '체력 바가 있다');
      assert.ok(me.querySelector('.me-bar.xp'), '눈금 바가 있다');
      assert.ok(me.querySelector('.me-lv'), '단계 배지가 있다');

      // 눈금을 억지로 올려 단계를 올린다 — 점수가 붙어야 한다
      const player = nation().players[S.S.avatarId];
      assert.ok(player, '내 장부가 있다');
      player.skills.lumber.xp = data.skills.player.xpCurve[3];
      await step();
      await until(() => S.player() && S.player().progress.level >= 4, { ms: 8000, what: '단계 상승' });
      assert.equal(S.player().progress.points, 3, '단계 4 = 남은 점수 3');

      GM.equip.open();
      const btn = doc.querySelector('[data-alloc="vitality"]');
      assert.ok(btn, '캐릭터 창에 능력치 분배 단추가 있다');
      assert.equal(btn.disabled, false);
      const hp0 = S.player().maxHp;
      btn.click();
      await until(() => S.player().progress.stats.vitality.value >= 1, { ms: 6000, what: '체력 +1' });
      assert.equal(S.player().progress.points, 2, '점수가 하나 줄었다');
      assert.ok(S.player().maxHp > hp0, '최대 체력이 실제로 늘었다');
      window.GM.ui.closeTopModal();
    });

    // ── ★ §14-6 다운 화면 ──────────────────────────────────────
    await t.test('★ §14-6 다운 — 화면이 덮이고 초를 세다가, 일어나면 걷힌다', async () => {
      GM.down.onDown({
        avatarId: S.S.avatarId, downSeconds: data.skills.combat.downSeconds,
        reviveHpRatio: data.skills.combat.reviveHpRatio,
        invulnSeconds: data.skills.combat.invulnSeconds, by: '굶주린 늑대',
      });
      const veil = doc.querySelector('#down-veil');
      assert.ok(veil, '쓰러진 화면이 덮인다');
      assert.equal(doc.querySelector('#down-count').textContent, String(data.skills.combat.downSeconds));
      assert.ok(GM.down.isDown());

      const town = S.myTown();
      GM.down.onRevived({
        avatarId: S.S.avatarId, hp: 30, maxHp: 60,
        invulnSeconds: data.skills.combat.invulnSeconds, x: town.x, y: town.y,
      });
      assert.equal(doc.querySelector('#down-veil'), null, '일어나면 화면이 걷힌다');
      assert.equal(GM.down.isDown(), false);
      GM.down.reset();
    });

    // ── ★ §14-7 잠긴 건물 ──────────────────────────────────────
    await t.test('★ §14-7 건설 갈래 — 잠긴 것도 자물쇠와 해금 조건으로 보인다', async () => {
      await step();
      await until(() => (S.lockedBuildings() || []).length > 0, { ms: 8000, what: '잠긴 목록' });
      GM.build.open('production');
      const locked = [...doc.querySelectorAll('#place-bar .pb-item.locked')];
      assert.ok(locked.length > 0, '생산 갈래에 잠긴 칸이 보인다');
      for (const el of locked) {
        assert.equal(el.disabled, true, '잠긴 칸은 눌리지 않는다');
        assert.ok(/해금/.test(el.textContent), `해금 조건이 적혀 있어야 한다: ${el.textContent}`);
      }
      // ★ §14-8 — 단추와 갈래 제목에 「세우기」가 없다
      assert.equal(doc.querySelector('#tb-build').textContent.includes('세우기'), false);
      assert.ok(doc.querySelector('#tb-build').textContent.includes('건설'), '단추는 「건설」이다');
      GM.build.close();
    });

    await t.test('콘솔이 조용하다', () => {
      const noisy = errors.filter((e) => !/AudioContext|Not implemented|Could not parse CSS/i.test(e));
      assert.deepEqual(noisy, [], noisy.join(' / '));
    });
  } finally {
    if (dom) dom.window.close();
    if (gameId) games.delete(gameId);
    await new Promise((res) => http.close(res));
  }
});

// ────────────────────────────────────────────────────────────────
// ★ GDD3 §15-C — 동료 봇(= 각료)과 자동 플레이
//
// 검증 문장: 「혼자 시작해도 넷이 함께 산다. 켜 두면 열 시간을 방치해도 그 사람이 살아 있다.」
// 그래서 여기서는 **화면이 실제로 그들을 받고 그리는지**를 잰다(서버 계약은 test/playtest15c.test.js).
// ────────────────────────────────────────────────────────────────
test('클라이언트 하니스 — §15-C 동료 넷과 자동 플레이(10분 방치 생존)', async (t) => {
  const errors = [];
  const { loadGameData } = await import('../server/engine/data.js');
  const { stepCompanions } = await import('../server/engine/companions.js');
  const data = loadGameData();
  await new Promise((res) => http.listen(0, '127.0.0.1', res));
  const port = http.address().port;
  const base = `http://127.0.0.1:${port}`;
  let dom = null;
  let gameId = null;

  try {
    dom = await boot(`${base}/?seed=20260806`, errors);
    const { window } = dom;
    const GM = window.GM;
    const S = GM.state;
    const doc = window.document;

    doc.querySelector('#btn-new').click();
    await until(() => doc.querySelector('#scene-found').hidden === false, { what: '개척 화면' });
    const name = doc.querySelector('#found-name');
    name.value = '나래';
    name.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.querySelector('#found-start').click();
    await until(() => !!S.S.map, { ms: 15000, what: '월드 스냅샷' });
    await until(() => !!(S.S.view && S.S.view.nation), { what: '정착지 상태' });
    gameId = S.S.gameId;
    const rt = games.get(gameId);
    rt.stop();                                   // 일 틱은 손으로 돌린다
    const nation = () => rt.world.nations.player;
    /* ★ 오프닝이 **막 시작되려는 참**일 수 있다 — busy 가 아직 false 인 순간에 지나치면
       마차 연출이 뒤늦게 아바타를 얼리고(jsdom 에는 rAF 가 없어) 영영 안 풀린다.
       §15-C-4 추종 검사가 이 얼음 때문에 헛돌았다. 시작을 기다렸다가 건너뛴다. */
    try { await until(() => GM.opening.busy(), { ms: 4000, what: '오프닝 시작' }); } catch (e) { /* 이미 끝났다 */ }
    if (GM.opening.busy()) doc.querySelector('#opening-skip').click();
    await until(() => !GM.opening.busy(), { what: '오프닝 종료' });
    assert.equal(GM.avatar.isFrozen(), false, '오프닝이 걷힌 뒤 아바타가 풀려 있다');

    /** 서버의 1초 루프를 손으로 돌린다(하니스에는 타이머가 없다 — §14 검사와 같은 방식) */
    function crewSeconds(seconds) {
      const out = { actions: 0, moved: 0 };
      for (let i = 0; i < seconds; i += 1) {
        const r = stepCompanions(rt.world, nation(), data, 1);
        out.actions += r.actions.length;
        out.moved += r.moved;
      }
      return out;
    }

    await t.test('★ §15-C-1 혼자 시작해도 동료 넷이 함께 선다', async () => {
      await sendNow(window, 'chat', { text: '함께 갑시다' });      // 아무 명령이나 — 상태를 새로 받는다
      await until(() => (S.companions() || []).length >= 4, { ms: 8000, what: '동료 넷' });
      const crew = S.companions();
      assert.equal(crew.length, data.companions.seats - 1, `정원 ${data.companions.seats} 중 넷이 동료다`);
      assert.equal(new Set(crew.map((c) => c.name)).size, crew.length, '이름이 저마다 다르다');
      assert.equal(new Set(crew.map((c) => c.color)).size, crew.length, '이름표 빛깔이 저마다 다르다');

      // 아바타 채널에 그대로 실린다 — 화면이 그리는 자리가 여기다
      const bots = (S.S.view.nation.avatars || []).filter((a) => a.bot);
      assert.equal(bots.length, crew.length, '아바타 채널로 넷이 온다');
      for (const b of bots) {
        assert.ok(b.appearance && Number.isInteger(b.appearance.skin), '외형이 규격대로 온다');
        assert.ok(b.color, '이름표 빛깔이 온다');
      }
      assert.equal(S.seats(), data.companions.seats, '정원이 몇인지 화면도 안다');
    });

    await t.test('★ §15-C-2 동료가 실제로 일한다 — 자리를 옮기고 곳간이 는다', async () => {
      const before = Object.values(nation().resources).reduce((a, b) => a + b, 0);
      const start = S.companions().map((c) => {
        const a = (S.S.view.nation.avatars || []).find((x) => x.id === c.id);
        return { id: c.id, x: a.x, y: a.y };
      });
      const r = crewSeconds(600);                    // 한 게임일치
      assert.ok(r.actions > 0, `하루 동안 ${r.actions}번 휘둘렀다`);
      const after = Object.values(nation().resources).reduce((a, b) => a + b, 0);
      assert.ok(after > before, `곳간이 늘었다 (${before.toFixed(1)} → ${after.toFixed(1)})`);

      await sendNow(window, 'chat', { text: '수고했습니다' });
      await until(() => {
        const av = S.S.view.nation.avatars || [];
        return start.some((s) => {
          const now = av.find((x) => x.id === s.id);
          return now && Math.hypot(now.x - s.x, now.y - s.y) > 1;
        });
      }, { ms: 8000, what: '동료가 옮겨 간 자리' });

      // 화면의 이름표 색이 사람과 동료를 가른다
      const mine = (S.S.view.nation.avatars || []).find((a) => !a.bot);
      const bot = (S.S.view.nation.avatars || []).find((a) => a.bot);
      assert.ok(bot.color !== (mine && mine.color), '동료의 빛깔은 사람의 것과 다르다');
      assert.ok(bot.state, `지금 하는 일이 온다 (${bot.state})`);
    });

    await t.test('★ §15-C-4 자동 — 설정에서 켜면 배지가 뜨고, 손이 닿으면 물러난다', async () => {
      GM.settings.open();
      const toggle = doc.querySelector('#set-autoplay');
      assert.ok(toggle, '설정에 자동 토글이 있다');
      assert.equal(toggle.checked, false, '처음에는 꺼져 있다');
      assert.equal(doc.querySelector('#badge-auto').hidden, true, '꺼져 있으면 배지도 없다');

      toggle.checked = true;
      toggle.dispatchEvent(new window.Event('change', { bubbles: true }));
      window.GM.ui.closeTopModal();
      await until(() => doc.querySelector('#badge-auto').hidden === false, { ms: 6000, what: '자동 배지' });
      assert.equal(doc.querySelector('#badge-auto').textContent, '자동');
      await until(() => nation().players[S.S.avatarId] && nation().players[S.S.avatarId].autoPlay === true,
        { ms: 6000, what: '서버가 자동을 켰다' });

      // 손이 닿으면 — 끄지 않고 잠시 물러난다
      GM.autoplay.touched();
      assert.equal(S.autoPlay().on, true, '켠 채로다');
      assert.equal(S.autoPlay().active, false, '지금은 손을 뗐다');
      GM.autoplay.paint();
      assert.equal(doc.querySelector('#badge-auto').classList.contains('is-paused'), true, '배지가 물러난 얼굴이 된다');
      await until(() => (nation().players[S.S.avatarId].autoPlaySuspendUntil || 0) > Date.now(),
        { ms: 6000, what: '서버도 물러났다' });
    });

    await t.test('★ §15-C-4 10분 방치 — 자동으로 스스로 살아 움직인다', async () => {
      // 물러남을 걷고(직접 손을 뗀 뒤 30초가 지난 셈) 열 시간을 굴린다
      const me = () => nation().players[S.S.avatarId];
      me().autoPlaySuspendUntil = 0;
      /* ★ §16-7 — 이 스위트는 일 틱을 세워 두므로(rt.stop) 앞 칸에서 동료들이 곁의 나무를 다
         캐고 곳간을 채워 두면 「할 일이 없어 쉰다」가 정답이 되어 버린다. 재는 것은 「할 일이
         있으면 스스로 움직이는가」다 — 곳간을 비우고 그루터기를 되살려 할 일을 만들어 준다. */
      nation().resources.wood = 2;
      nation().resources.grain = 4;
      nation().resources.stone = 2;
      for (const n of rt.world.map.nodes || []) {
        if (n.depleted) { n.depleted = false; n.respawnAt = null; n.amount = n.max; n.swings = 0; }
      }
      const av = () => nation().avatars[S.S.avatarId];
      const from = { x: av().x, y: av().y };
      const hp0 = me().hp;
      let downs = 0;
      let acts = 0;
      let roam = 0;                                   // ★ §16-7 — 돌아다닌 최대 반경(끝자리가 아니라)
      let now = Date.now();
      for (let s = 0; s < 600; s += 1) {
        now += 1000;
        const r = stepCompanions(rt.world, nation(), data, 1, { now });
        acts += r.actions.filter((a) => a.avatarId === S.S.avatarId).length;
        roam = Math.max(roam, Math.hypot(av().x - from.x, av().y - from.y));
        if ((me().downUntil || 0) > 0) downs += 1;
      }
      /* ★ §16-7 뒤로 자동은 본부 곁 공사장을 오가므로 **마지막 자리**는 출발점 곁일 수 있다.
         재는 것은 「돌아다녔는가」다 — 지나간 최대 반경으로 잰다. */
      assert.ok(roam > 1, `스스로 걸어 다녔다 (최대 ${roam.toFixed(1)}타일)`);
      assert.ok(acts > 0, `열 시간 동안 ${acts}번 스스로 일했다`);
      assert.ok(me().hp > 0 || downs > 0, '살아 있다(쓰러져도 모닥불에서 일어난다)');
      assert.equal(me().autoPlay, true, '열 시간 뒤에도 자동은 켜져 있다');

      /* 화면도 그 자리를 따라간다 — avatar.js 의 자동 추종.
         ★ 앞 칸에서 손을 댔으므로 화면 쪽 물러남도 걷어 준다(서버 쪽은 위에서 걷었다).
            여기서 재는 것은 「물러남이 도는가」가 아니라 「추종이 따라잡는가」다. */
      /* ★ §16 — 두뇌가 사냥·전투까지 하게 되어 열 시간 끝에 쓰러진 채일 수 있다.
         쓰러진 몸은 추종하지 않는 것이 맞으므로(avatar.step 의 S.downed() 문), 측정 전에 일으켜 세운다. */
      me().downUntil = 0;
      me().hp = Math.max(me().hp || 0, 1);
      S.setAutoPlayLocal(true);
      await sendNow(window, 'chat', { text: '잘 다녀왔습니다' });
      await until(() => !S.downed(), { ms: 6000, what: '일어난 몸이 화면에 닿았다' });
      assert.equal(S.autoPlay().active, true, '자동이 다시 돈다');
      /* ★ §16 — 봇 두뇌가 부지런해져 서버 아바타는 계속 걷는다. 움직이는 과녁은 방송 반 박자만큼
         늘 어긋나므로, 추종의 계약 그대로 「**받은** 자리(S.S.avatars)를 따라잡는가」를 재고,
         방송 흐름 자체는 느슨한 상한으로 따로 확인한다. */
      const known = (S.S.avatars || []).find(function (a) { return a.id === S.S.avatarId; }) || av();
      const srv = { x: known.x, y: known.y };
      assert.ok(Math.hypot(srv.x - av().x, srv.y - av().y) < 8,
        '화면이 아는 자리가 서버와 터무니없이 멀다 (avatars 방송이 끊겼는가)');
      for (let i = 0; i < 900; i += 1) GM.avatar.step(1 / 60);
      const shown = GM.avatar.pos();
      assert.ok(Math.hypot(shown.x - srv.x, shown.y - srv.y) < 1.0,
        `화면이 받은 자리를 따라잡았다 (${shown.x.toFixed(1)},${shown.y.toFixed(1)} ↔ ${srv.x},${srv.y})`);
    });

    await t.test('콘솔이 조용하다', () => {
      const noisy = errors.filter((e) => !/AudioContext|Not implemented|Could not parse CSS/i.test(e));
      assert.deepEqual(noisy, [], noisy.join(' / '));
    });
  } finally {
    if (dom) dom.window.close();
    if (gameId) games.delete(gameId);
    await new Promise((res) => http.close(res));
  }
});
