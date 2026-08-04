// check_ui.mjs — jsdom 이 레이아웃을 안 그려서 못 잡는 것들을 정적으로 막는 검사.
//   1) [hidden] 을 저자 규칙이 이기지 못하게 하는 전역 안전장치가 있는가   ← P0 재발 방지
//   2) 장식 요소는 .decor + pointer-events:none 인가                      ← 클릭 가로채기 방지
//   3) 전체화면 배경 캔버스/오버레이가 .decor 없이 남아 있지 않은가
//   4) 화면에 나오는 문구에 금지어(개발자 용어 · v2.1 폐기 용어)가 섞이지 않았는가
//   5) ★ v3 — 폐기된 프로토콜 명령을 클라가 아직 쏘고 있지 않은가
//   6) ★ v3 — 규약 판번호가 서버와 같은가 / 스크립트 목록이 실제 파일과 맞는가
//
//   실행: npm run check:ui   (npm run harness 에도 함께 물려 있다)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'public');
const css = readFileSync(join(PUB, 'css', 'main.css'), 'utf8');
const html = readFileSync(join(PUB, 'index.html'), 'utf8');

const problems = [];
const notes = [];

/* ── 1. [hidden] 전역 안전장치 ───────────────────────────────── */
const hiddenRule = /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/;
if (!hiddenRule.test(css)) {
  problems.push('main.css 에 `[hidden]{display:none !important}` 전역 규칙이 없다. ' +
    '저자 display 선언이 UA 의 [hidden] 을 이겨 숨긴 화면이 안 숨는다 (P0 재발).');
} else notes.push('[hidden] 전역 안전장치 있음');

/* ── 2. .decor 규칙 ──────────────────────────────────────── */
const decorRule = /\.decor\s*\{[^}]*pointer-events\s*:\s*none/;
if (!decorRule.test(css)) {
  problems.push('main.css 에 `.decor{pointer-events:none}` 규칙이 없다. 장식 요소가 클릭을 가로챈다.');
} else notes.push('.decor{pointer-events:none} 규칙 있음');

/* ── 3. 장식으로 보이는데 .decor 가 없는 것 ─────────────────── */
const SUSPECT = /\b(sky|vignette|backdrop|crest|starfield|fx-layer|-bg)\b/;
const tagRe = /<(canvas|div|span|img)\b([^>]*)>/g;
let m;
while ((m = tagRe.exec(html))) {
  const attrs = m[2];
  const clsM = /class\s*=\s*"([^"]*)"/.exec(attrs);
  const idM = /id\s*=\s*"([^"]*)"/.exec(attrs);
  const cls = clsM ? clsM[1] : '';
  const id = idM ? idM[1] : '';
  if (!SUSPECT.test(cls + ' ' + id)) continue;
  if (/\bdecor\b/.test(cls)) continue;
  problems.push(`index.html 의 <${m[1]} ${idM ? 'id="' + id + '"' : 'class="' + cls + '"'}> ` +
    '는 장식으로 보이는데 class 에 decor 가 없다. 장식 요소는 반드시 .decor 를 달아야 한다.');
}
if (!/id="tooltip"[^>]*class="[^"]*\bdecor\b/.test(html)) {
  problems.push('#tooltip 에 decor 클래스가 없다. 툴팁이 커서를 따라다니며 클릭을 먹는다.');
}
if (!/id="fx-layer"[^>]*class="[^"]*\bdecor\b/.test(html)) {
  problems.push('#fx-layer 에 decor 클래스가 없다. 이펙트 층이 화면 전체의 클릭을 먹는다.');
}

/* ── 4. 금지어 ──────────────────────────────────────────────
   ① 개발자 용어  ② v2.1 에서 폐기된 세계관 용어(GDD3 §9 · PROTOCOL §0-2)
   주석은 개발자용이므로 제외하고, 화면에 나가는 문자열 리터럴만 검사한다. */
const BANNED_DEV = ['콥더글러스', 'O(g)', '클램프', 'R값', '틱', 'AST', 'NPC', '큐', '파라미터',
                    '페이로드', '콜백', '소켓', '스냅샷'];
const BANNED_V2 = ['개척령', '성곽', '시즌', '결산', '열나흘', '감정의 날을 기다'];
const BANNED = BANNED_DEV.concat(BANNED_V2);

function stripComments(src) {
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === '/' && c2 === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; out += ' '; continue; }
    if (c === '/' && c2 === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; out += ' '; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

function stringLiterals(src) {
  const out = [];
  const re = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  let mm;
  while ((mm = re.exec(src))) out.push(mm[2]);
  return out;
}

const jsDir = join(PUB, 'js');
const jsFiles = readdirSync(jsDir).filter((x) => x.endsWith('.js'));
for (const f of jsFiles) {
  const src = stripComments(readFileSync(join(jsDir, f), 'utf8'));
  for (const lit of stringLiterals(src)) {
    if (!/[가-힣]/.test(lit)) continue;              // 코드용 문자열은 한글이 없다
    if (lit.startsWith('[')) continue;               // console 로만 나가는 개발자 로그
    for (const w of BANNED) {
      if (lit.includes(w)) problems.push(`public/js/${f} 의 화면 문구에 금지어 "${w}": ${JSON.stringify(lit.slice(0, 60))}`);
    }
  }
}

const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ')
                 .replace(/<!--[\s\S]*?-->/g, ' ')
                 .replace(/<[^>]+>/g, ' ');
for (const w of BANNED) {
  if (text.includes(w)) problems.push(`index.html 화면 문구에 금지어 "${w}"`);
}
notes.push(`금지어 ${BANNED.length}종 검사 (개발자 용어 ${BANNED_DEV.length} · 폐기 용어 ${BANNED_V2.length})`);

/* ── 5. ★ 폐기된 프로토콜 명령 (PROTOCOL v3 §0-2) ───────────── */
const DEAD_COMMANDS = ['expand', 'setWallFocus', 'placeTurret', 'removeTurret', 'workSite', 'buildStart'];
const DEAD_EVENTS = ['seasonEnd', 'combatScene', 'invasionResult', 'expanded'];
for (const f of jsFiles) {
  const src = stripComments(readFileSync(join(jsDir, f), 'utf8'));
  for (const cmd of DEAD_COMMANDS) {
    const re = new RegExp(`send\\(\\s*['"]${cmd}['"]`);
    if (re.test(src)) problems.push(`public/js/${f} 가 폐기된 명령 "${cmd}" 를 보낸다 (PROTOCOL v3 §0-2).`);
  }
  for (const ev of DEAD_EVENTS) {
    const re = new RegExp(`(on|socket\\.on)\\(\\s*['"]${ev}['"]`);
    if (re.test(src)) problems.push(`public/js/${f} 가 폐기된 이벤트 "${ev}" 를 듣는다 (PROTOCOL v3 §0-2).`);
  }
}
/* apAction {type:'work'} 도 폐기 */
for (const f of jsFiles) {
  const src = stripComments(readFileSync(join(jsDir, f), 'utf8'));
  if (/apAction[\s\S]{0,60}type\s*:\s*['"]work['"]/.test(src)) {
    problems.push(`public/js/${f} 가 폐기된 apAction{type:'work'} 를 쓴다 — actionSwing 으로 바뀌었다.`);
  }
}
notes.push(`폐기 명령 ${DEAD_COMMANDS.length}종 · 폐기 이벤트 ${DEAD_EVENTS.length}종 사용 없음`);

/* ── 6. 규약 판번호 · 스크립트 목록 ───────────────────────── */
const stateSrc = readFileSync(join(jsDir, 'state.js'), 'utf8');
const clientProto = /GM\.PROTOCOL\s*=\s*'([^']+)'/.exec(stateSrc)?.[1] ?? null;
const serverSrc = readFileSync(join(ROOT, 'server', 'index.js'), 'utf8');
const serverProto = /PROTOCOL\s*=\s*'([^']+)'/.exec(serverSrc)?.[1] ?? null;
if (!clientProto || !serverProto) {
  problems.push('규약 판번호를 찾지 못했다 (state.js GM.PROTOCOL / server/index.js PROTOCOL).');
} else if (clientProto !== serverProto) {
  problems.push(`규약 판번호가 어긋난다 — 화면 ${clientProto} ≠ 서버 ${serverProto}.`);
} else notes.push(`규약 판번호 ${clientProto} 일치`);

const srcRe = /<script src="js\/([^"]+)"><\/script>/g;
const listed = [];
let sm;
while ((sm = srcRe.exec(html))) listed.push(sm[1]);
for (const f of listed) {
  if (!existsSync(join(jsDir, f))) problems.push(`index.html 이 없는 파일을 싣는다: js/${f}`);
}
for (const f of jsFiles) {
  if (!listed.includes(f)) problems.push(`public/js/${f} 는 index.html 에 실려 있지 않다 (죽은 파일이면 지울 것).`);
}
notes.push(`스크립트 ${listed.length}개 — 파일과 목록 일치`);

/* ── 결과 ──────────────────────────────────────────────── */
if (problems.length) {
  console.error('UI 규칙 검사 실패:');
  for (const p of problems) console.error('  ✗ ' + p);
  process.exit(1);
}
for (const n of notes) console.log('  · ' + n);
console.log('UI 규칙 검사 통과 — 장식 pointer-events · [hidden] 안전장치 · 금지어 · 폐기 명령 · 규약 판번호');
