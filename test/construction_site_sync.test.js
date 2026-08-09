import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function clientState() {
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync('public/js/state.js', 'utf8'), ctx);
  return ctx.window.GM.state;
}

test('이전 현장이 재조립 단계로 바뀌면 게이지 기준값을 통째로 동기화한다', () => {
  const state = clientState();
  state.set({ view: {
    nation: { sites: [{ id: 'c7', mode: 'relocate', phase: 'takedown', remaining: 2, total: 2, progress: 0.8 }], structures: [] },
    you: { player: { skills: {} } },
  } });

  state.applyAck('actionSwing', {
    ok: true, siteId: 'c7', remaining: 6, total: 6, progress: 0,
    site: { id: 'c7', mode: 'relocate', phase: 'rebuild', remaining: 6, total: 6, progress: 0, cancelable: false },
  });

  const site = state.sites()[0];
  assert.equal(site.phase, 'rebuild');
  assert.equal(site.total, 6);
  assert.equal(site.remaining, 6);
  assert.equal(site.progress, 0);
  assert.equal(site.cancelable, false);
});
