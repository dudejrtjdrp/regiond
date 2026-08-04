import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
process.env.GALLAEMALLAE_SAVES_DIR = mkdtempSync(join(tmpdir(), 'gm-saves-'));

import { loadGameData } from '../server/engine/data.js';
import { createWorld, npcAssignments } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { step } from '../server/engine/tick.js';
import { saveSnapshot, loadSnapshot, appendEvents, readEvents, savesDir } from '../server/persistence.js';
import { ExpressionQueue, buildSnapshot } from '../server/expression/index.js';
import { templateText, renderTemplate } from '../server/expression/templates.js';
import { isEnabled } from '../server/expression/claude_adapter.js';
import { buildRegencyReport, nationScoreboard } from '../server/engine/report.js';
import { chronicleView } from '../server/engine/chronicle.js';

const data = loadGameData();

test('저장/복원 — 스냅샷 왕복과 이벤트 로그 append', async () => {
  const gameId = `test_${Date.now()}`;
  try {
    let w = createWorld({ gameId, seed: 5, data, assignments: npcAssignments(data) });
    const rng = createRng(5);
    const { state, events } = step(w, [], rng, data);
    w = state;
    saveSnapshot(w);
    appendEvents(gameId, events);

    const loaded = loadSnapshot(gameId);
    assert.equal(loaded.tick, w.tick);
    assert.equal(loaded.seed, 5);
    assert.equal(JSON.stringify(loaded), JSON.stringify(w));

    const log = readEvents(gameId, { sinceTick: 0 });
    assert.equal(log.length, events.length);

    // 복원한 스냅샷에서 이어서 진행해도 같은 결과가 나온다
    const a = step(loaded, [], createRng(77), data).state;
    const b = step(w, [], createRng(77), data).state;
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  } finally {
    await rm(join(savesDir(), gameId), { recursive: true, force: true });
  }
});

test('표현 계층 — 템플릿은 이벤트별 3개 이상 변형을 갖는다', () => {
  for (const [kind, variants] of Object.entries(data.templates.templates)) {
    assert.ok(Array.isArray(variants) && variants.length >= 3, `${kind} 변형 ${variants.length}개 (3개 이상 필요)`);
  }
});

test('표현 계층 — 자리표시자 치환과 미지 이벤트 폴백', () => {
  assert.equal(renderTemplate('{{a}} / {{b}}', { a: '곡물', b: 12.345 }), '곡물 / 12.35');
  const text = templateText('invasion_win', { tick: 5, enemy: '해적', ratio: 1.14, winChance: 66 }, data);
  assert.ok(text.includes('해적') || text.length > 0);
  const fallback = templateText('nonexistent_kind', { tick: 3 }, data);
  assert.ok(fallback.length > 0, '없는 이벤트도 폴백 문장을 낸다');
});

test('표현 계층 — LLM 없이도 동기적으로 문장을 반환한다 (진행 비차단)', () => {
  const q = new ExpressionQueue({ data, useLlm: false });
  const out = q.express({ tick: 5, kind: 'invasion_win', nationId: 'player', data: { enemy: '드래곤', ratio: 1.14, winChance: 0.66 } });
  assert.equal(out.source, 'template');
  assert.ok(typeof out.text === 'string' && out.text.length > 0);
  assert.equal(q.pending, 0);
});

test('표현 계층 — 스냅샷은 사실만 담는다 (승률 %, 자원명 한국어)', () => {
  const snap = buildSnapshot({ tick: 9, kind: 'invasion_lose', nationId: 'player', data: { enemy: '바이킹', winChance: 0.35, losses: { population: 12, resourceRatio: 0.25 } } }, data);
  assert.equal(snap.winChance, 35);
  assert.equal(snap.populationLoss, 12);
  assert.equal(snap.resourceLoss, 25);
  const snap2 = buildSnapshot({ tick: 4, kind: 'trade_done', data: { resource: 'grain', amount: 10 } }, data);
  assert.equal(snap2.resource, '곡물');
});

test('Claude 어댑터 — API 키가 없으면 비활성', () => {
  const had = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(isEnabled(), false);
  if (had) process.env.ANTHROPIC_API_KEY = had;
});

test('치세 보고서 — 마지막 관측 이후를 문장으로 요약한다', () => {
  let w = createWorld({ seed: 91, data, assignments: npcAssignments(data) });
  const rng = createRng(91);
  w.nations.player.online = false;
  for (let i = 0; i < 6; i += 1) w = step(w, [], rng, data).state;
  const report = buildRegencyReport(w, w.nations.player, data);
  assert.equal(report.sinceTick, 0);
  assert.equal(report.toTick, 6);
  assert.ok(report.lines.length >= 2);
  assert.ok(report.lines[0].includes('섭정'));
});

test('연대기 — 시즌 결산·랭킹을 대신하는 누적 기록 (GDD3 §5)', () => {
  let w = createWorld({ seed: 92, data, assignments: npcAssignments(data) });
  const rng = createRng(92);
  for (let i = 0; i < 14; i += 1) w = step(w, [], rng, data).state;
  assert.equal(w.seasonEnded, undefined, '시즌 종료는 폐지됐다');
  assert.equal(w.seasonResult, undefined);
  const view = chronicleView(w, w.nations.player, data);
  assert.equal(view.day, 14);
  assert.equal(typeof view.totals.wavesFaced, 'number');
  assert.ok(Array.isArray(view.entries));
  const board = nationScoreboard(w, data);
  assert.equal(board.length, 4);
  assert.ok(board[0].roles.farm.name === '농정관');
});

test('REST — /api/health, /api/config, /api/debug/*', async () => {
  process.env.NODE_ENV = 'test';
  const { http, getOrCreateGame } = await import('../server/index.js');
  await new Promise((res) => http.listen(0, res));
  const port = http.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.ok, true);

    const config = await (await fetch(`${base}/api/config`)).json();
    // ★ PROTOCOL v3 — config 목록
    for (const key of ['balance', 'resources', 'buildings', 'roles', 'tags', 'tactics', 'artifacts',
      'aiNations', 'difficulty', 'tiers', 'skills', 'waves', 'world', 'time']) {
      assert.ok(config[key], `config.${key} 누락`);
    }
    assert.equal(config.protocol, '3.2');
    assert.equal(config.artifacts.list.length, 50);
    assert.ok(config.buildings.defs.hut, '건물 도감이 실린다');
    assert.equal(config.buildings.defs.hut.requiresTier, 0);
    assert.equal(config.tiers.levels.length, 7);
    assert.ok(config.skills.order.includes('combat'));
    assert.ok(config.waves.rotation.length === 6);
    assert.equal(config.invasions, undefined, '옛 침공 스케줄은 폐기됐다');
    assert.ok(!JSON.stringify(config).includes('arrivalTick'), '침공 날짜는 config 에 없다');

    const rt = getOrCreateGame(null, { playerName: '테스트', seed: 1234 });
    rt.stop();
    const stepRes = await (await fetch(`${base}/api/debug/step`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: rt.gameId }),
    })).json();
    assert.equal(stepRes.ok, true);
    assert.equal(stepRes.tick, 1);

    const pause = await (await fetch(`${base}/api/debug/pause`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: rt.gameId, paused: true }),
    })).json();
    assert.equal(pause.paused, true);

    const speed = await (await fetch(`${base}/api/debug/speed`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: rt.gameId, tickRealSeconds: 1 }),
    })).json();
    assert.equal(speed.tickRealSeconds, 1);

    const seed = await (await fetch(`${base}/api/debug/seed`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: rt.gameId, seed: 4242 }),
    })).json();
    assert.equal(seed.seed, 4242);

    rt.stop();
    await rm(join(savesDir(), rt.gameId), { recursive: true, force: true });
  } finally {
    await new Promise((res) => http.close(res));
  }
});

/**
 * ★ 배포 하드닝 (docs/DEPLOY.md) — 운영에서는 개발 뒷문이 통째로 잠긴다.
 *   헬스체크만은 살아 있어야 한다. Render 가 그 길로 서비스의 생사를 판정하기 때문이다.
 */
test('REST — 운영에서는 /api/debug/* 가 통째로 404, 헬스체크는 200', async () => {
  const { http } = await import('../server/index.js');
  const hadEnv = process.env.NODE_ENV;
  const hadDebug = process.env.DEBUG_API;
  delete process.env.DEBUG_API;
  await new Promise((res) => http.listen(0, res));
  const base = `http://127.0.0.1:${http.address().port}`;
  const hit = (p) => fetch(`${base}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  try {
    process.env.NODE_ENV = 'production';

    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.ok, true, '헬스체크는 운영에서도 열려 있다');
    assert.equal(health.debugApi, false, '잠긴 사실을 알린다 — 개발 패널이 이걸 보고 스스로 접는다');
    assert.equal(typeof health.version, 'string');

    for (const path of ['speed', 'pause', 'step', 'battle', 'seed']) {
      const res = await hit(`/api/debug/${path}`);
      assert.equal(res.status, 404, `/api/debug/${path} 는 운영에서 없는 길이다`);
      assert.equal((await res.json()).error.code, 'NOT_FOUND', '뒷문의 존재 자체를 알리지 않는다');
    }

    // DEBUG_API=1 — 운영에서도 강제로 여는 임시 손잡이
    process.env.DEBUG_API = '1';
    assert.equal((await (await fetch(`${base}/api/health`)).json()).debugApi, true);
    const opened = await hit('/api/debug/step');
    assert.notEqual((await opened.json())?.error?.code, 'NOT_FOUND', '자물쇠가 아니라 핸들러가 답한다');

    // DEBUG_API=0 — 개발에서도 잠근다
    process.env.NODE_ENV = 'test';
    process.env.DEBUG_API = '0';
    assert.equal((await hit('/api/debug/step')).status, 404);
  } finally {
    if (hadEnv == null) delete process.env.NODE_ENV; else process.env.NODE_ENV = hadEnv;
    if (hadDebug == null) delete process.env.DEBUG_API; else process.env.DEBUG_API = hadDebug;
    await new Promise((res) => http.close(res));
  }
});
