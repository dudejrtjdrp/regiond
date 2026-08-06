// §17-19(D-5) 대화창 — 창의 규칙 회귀 (docs/탐험기획.md §18-6)
//
// 배치 D 의 나머지는 눈으로 봐야 아는 일이지만, 대화창에는 **셈이 되는 규칙**이 몇 가지 있다.
// 화면 없이 jsdom 한 장 위에 ui.js + dialogue.js 만 올려 그 규칙만 꺼내 본다.
//
// 이 파일이 지키는 것 여섯:
//   ① 판이 스펙대로 선다 — 이름표·도트 초상·본문, 그리고 대화 중에는 body 에 표가 붙는다(하단 HUD fade).
//   ② 넘기기 — 한 번은 「다 보여 줘」, 그다음은 「다음 줄」, 끝에서는 닫힌다.
//   ③ 선택지 — 마지막 줄에서만 뜨고, 숫자키 1~4 가 그대로 짝이 된다.
//   ④ 서버 권위 — 선택지가 보내는 것은 **기존 화이트리스트 명령뿐**이다(이 창이 만든 새 명령은 없다).
//   ⑤ ESC·전투 경보로 접히고, 접히면 흔적(body 표·판)이 남지 않는다.
//   ⑥ 수치는 코드가 아니라 data/world.json render.dialogue 가 쥔다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { loadGameData } from '../server/engine/data.js';

const data = loadGameData();
const DIAL = data.world.render.dialogue;
const HTML = '<!doctype html><html><body><div id="dialogue-root"></div></body></html>';

/** 화면 없는 대화창 한 채 — 타자 속도는 0(한 번에 다 찍힘)으로 두어 시계에 기대지 않는다. */
function boot(typeMs = 0) {
  const dom = new JSDOM(HTML, { runScripts: 'outside-only' });
  const w = dom.window;
  const sent = [];
  w.eval(readFileSync('public/js/ui.js', 'utf8'));
  w.GM.state = {
    S: { avatars: [], you: null, avatarId: 'me' },
    dialogueCfg: () => ({ ...DIAL, typeMs }),
    defaultAppearance: () => ({}),
    companionById: () => null,
  };
  w.GM.sfx = { play() {} };
  w.GM.net = { send: (type, payload) => sent.push({ type, payload }) };
  w.GM.icons = {
    img: (name, size) => {
      const im = w.document.createElement('img');
      im.setAttribute('data-icon', name);
      im.width = size;
      return im;
    },
  };
  w.eval(readFileSync('public/js/dialogue.js', 'utf8'));
  return { w, sent, dlg: w.GM.dialogue, doc: w.document };
}

const key = (w, k) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));

test('§17-19-D5 ① 판이 스펙대로 선다 — 이름표·초상·본문·하단 HUD 표', () => {
  const { w, dlg, doc } = boot();
  dlg.open({ speaker: '서온', portraitKey: 'icon:person', lines: ['안녕하십니까.'] });
  const box = doc.querySelector('#dialogue-root .dlg');
  assert.ok(box, '대화창 판이 서지 않았다');
  assert.equal(doc.querySelector('.dlg-name').textContent, '서온');
  assert.ok(doc.querySelector('.dlg-portrait img'), '초상이 없다 — 절차 도트를 키워 쓰기로 했다');
  assert.equal(doc.querySelector('.dlg-line').textContent, '안녕하십니까.');
  assert.ok(box.classList.contains('typed'), '다 찍힌 줄에는 다음 표(▼)가 켜져야 한다');
  assert.ok(doc.body.classList.contains('dialogue'), '대화 중에는 하단 HUD 가 물러나는 표가 붙어야 한다');
  assert.equal(dlg.isOpen(), true);
  void w;
});

test('§17-19-D5 ② 넘기기 — 다 보여 주고, 다음 줄로 가고, 끝에서 닫힌다', () => {
  const { dlg, doc } = boot(18);
  dlg.open({ speaker: '땅', lines: ['첫 줄입니다.', '둘째 줄입니다.'] });
  assert.notEqual(doc.querySelector('.dlg-line').textContent, '첫 줄입니다.', '타자기가 한 번에 다 찍었다');
  dlg.advance();
  assert.equal(dlg.peek().shown, '첫 줄입니다.', '첫 번째 넘김은 「다 보여 줘」다');
  dlg.advance();
  assert.equal(dlg.peek().idx, 1, '두 번째 넘김은 다음 줄이다');
  dlg.advance();
  dlg.advance();
  assert.equal(dlg.isOpen(), false, '마지막 줄을 넘기면 창이 닫힌다');
  assert.equal(doc.body.classList.contains('dialogue'), false, '닫혔는데 하단 HUD 가 물러난 채다');
});

test('§17-19-D5 ③ 선택지는 마지막 줄에서만 뜨고 숫자키 1~4 와 짝이다', () => {
  const { w, dlg, doc } = boot();
  let picked = 0;
  dlg.open({
    speaker: '길손', lines: ['하나', '둘'],
    choices: [{ label: '따라간다', act: () => { picked = 1; } }, { label: '보낸다', act: () => { picked = 2; } }],
  });
  assert.equal(doc.querySelectorAll('[data-dlg-choice]').length, 0, '첫 줄부터 선택지가 뜨면 안 된다');
  dlg.advance();
  dlg.advance();
  assert.equal(doc.querySelectorAll('[data-dlg-choice]').length, 2, '마지막 줄에서 선택지가 떠야 한다');
  key(w, '2');
  assert.equal(picked, 2, '숫자키 2 가 둘째 선택지를 고르지 않았다');
  assert.equal(dlg.isOpen(), false, '고르면 창은 닫힌다');
});

test('§17-19-D5 ④ 서버 권위 — 선택지는 기존 화이트리스트 명령만 보낸다', () => {
  const { dlg, sent } = boot();
  dlg.open({ speaker: '이웃', lines: ['오셨군요.'],
             choices: [{ label: '찾아간다', cmd: 'visitNation', payload: { nationId: 'ai1' } }] });
  dlg.advance();
  dlg.choose(0);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { type: 'visitNation', payload: { nationId: 'ai1' } });
  const src = readFileSync('public/js/dialogue.js', 'utf8');
  const sends = src.match(/GM\.net\.send\(([^)]*)\)/g) || [];
  assert.equal(sends.length, 1, '대화창이 제 손으로 명령을 짓고 있다 — 부르는 쪽이 준 cmd 만 보내야 한다');
  assert.ok(sends[0].includes('c.cmd'), `대화창이 이름을 박은 명령을 보낸다: ${sends[0]}`);
});

test('§17-19-D5 ⑤ ESC·전투 경보로 접히고 흔적이 남지 않는다', () => {
  const { w, dlg, doc } = boot();
  dlg.open({ speaker: '동료', lines: ['부르셨습니까.'] });
  key(w, 'Escape');
  assert.equal(dlg.isOpen(), false, 'ESC 로 닫히지 않았다');
  assert.equal(doc.querySelector('#dialogue-root').childNodes.length, 0, '판이 남아 있다');
  dlg.open({ speaker: '동료', lines: ['부르셨습니까.'] });
  dlg.close();                                  // 전투 경보(combat.onIncoming)가 부르는 바로 그 문
  assert.equal(dlg.peek(), null);
  dlg.close();                                  // 두 번 접어도 탈이 없어야 한다
});

test('§17-19-D5 ⑥ 수치는 자료가 쥔다 — 코드에 매직넘버가 없다', () => {
  assert.ok(DIAL.typeMs > 0 && DIAL.typeMs <= 60, `타자 속도 ${DIAL.typeMs}ms — 스펙은 18ms 대다`);
  assert.equal(DIAL.maxChoices, 4, '선택지 수는 숫자키 1~4 와 짝이라 4다');
  assert.ok(DIAL.portraitSize >= 72 && DIAL.portraitSize <= 96, `초상 ${DIAL.portraitSize}px — 스펙은 72~96 이다`);
  const { dlg, doc } = boot();
  const many = [1, 2, 3, 4, 5, 6].map((i) => ({ label: '고르기 ' + i }));
  dlg.open({ speaker: '표', lines: ['고르십시오.'], choices: many });
  dlg.advance();
  assert.equal(doc.querySelectorAll('[data-dlg-choice]').length, DIAL.maxChoices,
    '숫자키로 누를 수 없는 선택지가 생겼다');
});
