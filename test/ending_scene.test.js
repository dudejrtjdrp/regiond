// ending_scene.test.js — ★ 매듭의 화면 몫. 서버 없이 public/index.html 을 jsdom 에 올려 실제로 돌린다.
//
//   지키는 것 넷:
//     ① 용의 최후 — fx.cinemaSlow 가 화면 시계를 늦추고 검은 띠를 내린다(서버 tick 은 손대지 않는다).
//     ② 엔딩 컷신 — 일러스트 여덟 장이 순서대로 갈리고, 그림에 구워진 자막 위에 가리개가 선다.
//     ③ 대사는 서버가 치환한 것을 그대로 찍는다 — 화면이 {name}·{lord} 를 지어내지 않는다.
//     ④ 매듭 뒤 두 화면 — 제작자 · 「계속 플레이 하시겠습니까」의 단추 셋이 진짜로 동작한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const story = JSON.parse(readFileSync('data/story.json', 'utf8'));
const endingBeat = story.beats.find((b) => b.id === 'ending');

/** index.html 을 올리고 연출에 필요한 스크립트만 끼운다(서버·소켓은 부르지 않는다) */
function boot(files) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}`));
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), {
    runScripts: 'outside-only', url: 'http://localhost/', virtualConsole: vc, pretendToBeVisual: true,
  });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy(
    { measureText: () => ({ width: 10 }) }, { get: (t, p) => (p in t ? t[p] : () => {}) });
  for (const f of files) w.eval(readFileSync(f, 'utf8'));
  return { w, errors };
}

const UI = 'public/js/ui.js';

test('용의 최후 — 화면 시계가 늦어지고 검은 띠가 내려온다', () => {
  const { w } = boot([UI, 'public/js/fx.js']);
  const fx = w.GM.fx;
  assert.equal(fx.timeScale(), 1, '평소에는 한 톨도 늦지 않는다');
  assert.equal(w.document.body.classList.contains('cinema'), false);

  fx.cinemaSlow(0.16, 2600, 3600);
  assert.equal(fx.timeScale(), 0.16, '여섯 배 느리게');
  assert.equal(w.document.body.classList.contains('cinema'), true, '띠가 내려왔다');
  assert.ok(w.document.getElementById('cinema-bars'), '띠 판이 섰다');

  fx.reset();                       // 판을 갈면 연출도 함께 걷힌다(방을 옮겨도 띠가 남지 않는다)
  assert.equal(fx.timeScale(), 1);
  assert.equal(w.document.body.classList.contains('cinema'), false);
});

test('엔딩 컷신 — 일러스트 여덟 장 · 자막 가리개 · 서버가 치환한 대사', () => {
  const { w, errors } = boot([UI, 'public/js/storycine.js']);
  const cine = w.GM.storycine;

  /* 서버(story.js renderScenes)가 하는 일을 그대로 흉내 낸다 — 치환은 서버 몫이다 */
  const scenes = endingBeat.scenes.map((s) => ({
    ...s, text: s.text.replaceAll('{name}', '서온국').replaceAll('{lord}', '서온'),
  }));
  cine.play(scenes, { auto: false });

  const wrap = w.document.querySelector('.cine');
  assert.ok(wrap, '컷신 판이 섰다');
  assert.ok(wrap.classList.contains('masked'), '구워진 자막을 덮는 가리개가 걸렸다');
  assert.equal(cine.peek().total, 8, '여덟 장');
  assert.ok(!cine.peek().text.includes('{'), '{name}·{lord} 가 남아 있지 않다');

  const seen = [];
  for (let i = 0; i < 8; i += 1) {
    seen.push(cine.peek().bg);
    wrap.onclick();          // ① 「글 다 보여 줘」
    wrap.onclick();          // ② 「다음 장」
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 7].map((n) => `assets/ending/tea_0${n}.png`),
    '그림이 순서대로 갈리고, 마지막 두 장은 같은 그림 위로 글만 흐른다');
  assert.equal(cine.busy(), false, '끝나면 판이 걷힌다');
  assert.equal(w.document.querySelector('.cine'), null);
  assert.deepEqual(errors, []);
});

test('엔딩 컷신 — [건너뛰기] 한 번이면 남은 장이 전부 접힌다(§0-1)', () => {
  const { w } = boot([UI, 'public/js/storycine.js']);
  let ended = 0;
  w.GM.storycine.play(endingBeat.scenes, { onEnd: () => { ended += 1; } });
  w.document.querySelector('.cine-skip').click();
  assert.equal(w.GM.storycine.busy(), false);
  assert.equal(ended, 1, 'onEnd 는 꼭 한 번만 — 이야기 사슬이 여기서 끊기면 안 된다');
});

test('매듭 뒤 — 제작자 화면과 「계속 플레이」의 단추 셋', () => {
  const { w, errors } = boot([UI, 'public/js/endcredits.js']);
  const ec = w.GM.endcredits;
  ec.play();

  const root = w.document.querySelector('#endcredits');
  assert.ok(root, '엔딩 화면이 섰다');
  assert.equal(ec.peek().stage, 1, '1장 = 제작자');
  assert.ok(root.querySelector('.ec-plate'), '배경은 홈 일러스트 그대로');
  assert.ok(root.querySelector('.ec-hide'), '그림에 구워진 메뉴 줄은 가린다');
  assert.match(root.textContent, /제작자/);
  assert.match(root.textContent, /이성효/);

  root.onclick();
  assert.equal(ec.peek().stage, 2, '2장 = 계속 묻기');
  assert.match(root.textContent, /게임을 계속 플레이 하시겠습니까/);
  assert.deepEqual([...root.querySelectorAll('.ec-btn')].map((b) => b.textContent),
    ['이어하기', '새로하기', '게임종료']);

  root.querySelectorAll('.ec-btn')[0].click();          // 이어하기 = 하던 자리로
  assert.equal(ec.busy(), false, '판이 걷힌다');
  assert.equal(w.document.body.classList.contains('cutscene'), false, '연출 잠금도 풀린다');
  assert.deepEqual(errors, []);
});

test('사슬 — 엔딩 beat 가 다 끝난 뒤에야 제작자 화면이 온다', async () => {
  const { w } = boot([UI, 'public/js/storycine.js', 'public/js/endcredits.js', 'public/js/story.js']);
  const played = [];
  w.GM.dialogue = {                                   // 대사 beat 는 대화창 몫 — 여기서는 그릇만 흉내
    open: (o) => { played.push(o.lines[0]); o.onClose(); },
    isOpen: () => false, close: () => {},
  };
  w.GM.endcredits.play = () => { played.push('#credits'); };

  w.GM.story.onBeat({ id: 'ending', scenes: endingBeat.scenes });
  assert.equal(w.GM.storycine.busy(), true, '엔딩은 일러스트 컷신으로 튼다');
  assert.ok(!played.includes('#credits'), '아직 크레딧이 아니다');

  /* 앞 장이 끝나고 쿠키가 **뒤늦게** 와도 크레딧이 새치기하지 않는다(한 묶음으로 오지 않는 경우) */
  w.GM.storycine.finish();                            // [건너뛰기]
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!played.includes('#credits'), '줄이 잠깐 비었다고 크레딧을 올리지 않는다');

  w.GM.story.onBeat({ id: 'ending_cookie', scenes: [{ speaker: '세라', text: '…우리는 결국, 해냈네요.' }] });
  await new Promise((r) => setTimeout(r, 1200));      // finale 은 한 박자 쉬고 온다
  assert.deepEqual(played, ['…우리는 결국, 해냈네요.', '#credits'], '쿠키가 끝난 뒤에 크레딧 한 번');
});
