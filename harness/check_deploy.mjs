// check_deploy.mjs — 배포 검증 다섯 단(docs/DEPLOY2.md §4-5)을 **실제로 두드려서** 확인한다.
//
//   실행:  node harness/check_deploy.mjs --server https://xxx.up.railway.app \
//                                        --pages  https://dudejrtjdrp.github.io/tojiGame/
//
//   --pages 를 빼면 서버 쪽 단(2~5)만 본다. 로컬 예행에도 그대로 쓴다:
//          npm start 를 띄워 두고  node harness/check_deploy.mjs --server http://localhost:3000
//
//   ★ 이 검사는 **운영 서버에 대고** 돈다. 그래서 개발 뒷문(/api/debug/*)을 한 번도 부르지 않는다
//     (NODE_ENV=production 에서는 잠겨 있다). 쓰는 것은 규약이 약속한 문 뿐이다.
//   ★ 방 하나를 새로 만들고 그 안에서만 논다(gameId 에 시각이 박힌다). 남의 정착지를 건드리지 않는다.
import { io as ioClient } from 'socket.io-client';

// ────────────────────────────────────────────────────────────────
// 자잘한 것들
// ────────────────────────────────────────────────────────────────
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1]?.startsWith('--') ? true : process.argv[++i]);
}
const SERVER = String(args.get('server') || '').replace(/\/+$/, '');
const PAGES = args.get('pages') ? String(args.get('pages')).replace(/\/+$/, '') + '/' : null;
if (!SERVER) {
  console.error('쓰는 법: node harness/check_deploy.mjs --server <서버주소> [--pages <Pages주소>]');
  process.exit(2);
}

let pass = 0;
const fails = [];
const ok = (what, detail = '') => { pass += 1; console.log(`  ✓ ${what}${detail ? ' — ' + detail : ''}`); };
const bad = (what, detail = '') => { fails.push(what); console.log(`  ✗ ${what}${detail ? ' — ' + detail : ''}`); };
const must = (cond, what, detail = '') => (cond ? ok(what, detail) : bad(what, detail));
const note = (s) => console.log(`    · ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, opt) {
  const t0 = Date.now();
  const r = await fetch(url, { redirect: 'follow', ...opt });
  return { r, ms: Date.now() - t0, text: async () => r.text(), json: async () => r.json() };
}

const send = (socket, event, payload = {}, ms = 12000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`ack 시간 초과: ${event}`)), ms);
  socket.emit(event, payload, (res) => { clearTimeout(timer); resolve(res); });
});
const next = (socket, evt, ms = 15000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${evt} 가 오지 않았다`)), ms);
  socket.once(evt, (p) => { clearTimeout(timer); resolve(p); });
});
function connect(base, origin) {
  return ioClient(base, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    ...(origin ? { extraHeaders: { origin } } : {}),
  });
}

console.log(`\n배포 검증 — 서버 ${SERVER}${PAGES ? ` · 클라 ${PAGES}` : ' (Pages 는 건너뜀)'}\n`);

// ────────────────────────────────────────────────────────────────
// 1단. 정적 사본 — 서버 없이 화면이 서는가 (DEPLOY2 §4-5-1)
// ────────────────────────────────────────────────────────────────
let pagesOrigin = null;
if (PAGES) {
  console.log('1단 · 정적 사본(GitHub Pages)');
  try {
    pagesOrigin = new URL(PAGES).origin;
    const { r, text } = await get(PAGES);
    must(r.status === 200, 'Pages 가 index.html 을 내준다', `${r.status}`);
    const html = await text();
    must(/GM\.SERVER/.test(html), 'index.html 에 서버 주소 한 줄이 있다');
    const m = html.match(/return\s+'(https?:\/\/[^']+)'/);
    if (m) {
      must(m[1].replace(/\/+$/, '') === SERVER, '그 주소가 지금 검사하는 서버와 같다',
        `${m[1]} vs ${SERVER}`);
      if (m[1].replace(/\/+$/, '') !== SERVER) note('index.html 의 GM.SERVER 줄을 고치고 다시 밀어야 한다');
    } else bad('GM.SERVER 의 원격 주소를 못 찾았다', 'index.html 의 그 한 줄을 확인할 것');

    for (const path of ['js/state.js', 'js/net.js', 'js/world.js', 'css/main.css']) {
      const { r: rr } = await get(PAGES + path, { method: 'HEAD' });
      must(rr.status === 200, `정적 파일이 뜬다: ${path}`, `${rr.status}`);
    }
    const { r: rj } = await get(PAGES + '.nojekyll', { method: 'HEAD' });
    must(rj.status === 200, '.nojekyll 이 올라가 있다 (밑줄 파일이 사라지지 않는다)', `${rj.status}`);

    const state = await (await get(PAGES + 'js/state.js')).text();
    const pm = state.match(/GM\.PROTOCOL\s*=\s*'([^']+)'/);
    if (pm) { note(`클라 규약 v${pm[1]}`); global.__CLIENT_PROTOCOL = pm[1]; }
    note(`손으로 한 번 볼 것: ${PAGES}?mock=1 — 서버 없이 화면이 도는가`);
  } catch (e) {
    bad('Pages 를 읽지 못했다', String(e.message || e));
  }
  console.log('');
}

// ────────────────────────────────────────────────────────────────
// 2단. 서버가 살아 있는가 + 규약이 맞는가 (§4-5-2)
// ────────────────────────────────────────────────────────────────
console.log('2단 · 서버와 규약');
let serverProtocol = null;
try {
  const { r, ms, json } = await get(`${SERVER}/api/health`);
  must(r.status === 200, '/api/health 가 200', `${ms}ms`);
  const h = await json();
  must(h.ok === true, '서버가 스스로 살아 있다고 답한다', `v${h.version} · 규약 ${h.protocol} · 방 ${h.games}개`);
  must(/^https:/.test(SERVER) || /localhost|127\.0\.0\.1/.test(SERVER),
    'https 로 서비스된다 (Pages 는 https 라 http 서버로는 못 부른다)', SERVER);
  const { r: rc, json: jc } = await get(`${SERVER}/api/config`);
  must(rc.status === 200, '/api/config 가 200', `${rc.status}`);
  const cfg = await jc();
  serverProtocol = cfg.protocol;
  if (global.__CLIENT_PROTOCOL) {
    must(cfg.protocol === global.__CLIENT_PROTOCOL, '화면과 서버의 규약 판번호가 같다',
      `클라 ${global.__CLIENT_PROTOCOL} · 서버 ${cfg.protocol}`);
  } else note(`서버 규약 v${cfg.protocol}`);
  must(!JSON.stringify(cfg).includes('arrivalTick'), 'config 가 습격일을 흘리지 않는다 (정보 비대칭)');
} catch (e) {
  bad('서버에 닿지 못했다', String(e.message || e));
}
console.log('');

// ────────────────────────────────────────────────────────────────
// 3단. 크로스 오리진 — Pages 사본이 이 서버를 부를 수 있는가 (§4-3)
// ────────────────────────────────────────────────────────────────
console.log('3단 · 크로스 오리진(CORS)');
try {
  const origin = pagesOrigin || 'https://dudejrtjdrp.github.io';
  const { r } = await get(`${SERVER}/api/config`, { headers: { origin } });
  const acao = r.headers.get('access-control-allow-origin');
  must(acao === origin, `허용 출처가 머리글에 실린다 (${origin})`, acao || '(없음)');
  must((r.headers.get('vary') || '').includes('Origin'), 'Vary: Origin 이 붙는다 (캐시가 출처를 섞지 않는다)');
  const pre = await fetch(`${SERVER}/api/config`, { method: 'OPTIONS', headers: { origin } });
  must(pre.status === 204 || pre.status === 200, '예비 비행(OPTIONS)이 통과한다', `${pre.status}`);
  const { r: rEvil } = await get(`${SERVER}/api/config`, { headers: { origin: 'https://not-us.example.com' } });
  must(!rEvil.headers.get('access-control-allow-origin'), '낯선 출처에는 허용 머리글을 안 준다');
} catch (e) {
  bad('CORS 를 확인하지 못했다', String(e.message || e));
}
console.log('');

// ────────────────────────────────────────────────────────────────
// 4단. 소켓 왕복 — 나무를 베면 목재가 오르는가 (§4-5-3)
// ────────────────────────────────────────────────────────────────
console.log('4단 · 소켓 왕복 (실제로 나무를 벤다)');
const gameId = `check_${Date.now()}`;
let woodAfter = 0;
let socket = null;
try {
  socket = connect(SERVER, pagesOrigin);
  await new Promise((res, rej) => {
    socket.on('connect', res);
    socket.on('connect_error', (e) => rej(new Error('소켓이 붙지 못했다: ' + e.message)));
    setTimeout(() => rej(new Error('소켓 연결 시간 초과')), 15000);
  });
  ok('Pages 출처로 소켓이 붙는다', pagesOrigin || '(출처 없음)');

  /* 압축이 실제로 협상됐는가 — 웹소켓 확장 목록에 permessage-deflate 가 있어야 한다 (D-1 §1) */
  const ws = socket.io.engine?.transport?.ws;
  const ext = ws?.extensions ?? ws?._extensions;
  const extStr = typeof ext === 'string' ? ext : JSON.stringify(ext ?? '');
  must(/permessage-deflate/.test(extStr), '압축(permessage-deflate)이 협상됐다', extStr || '(확인 불가)');

  const worldP = next(socket, 'world');
  const joined = await send(socket, 'join', { gameId, playerName: '배포검사', seed: 4242, avatarId: 'p1' });
  must(joined?.ok === true, 'join 이 받아들여진다', JSON.stringify(joined?.error || ''));
  if (serverProtocol) must(joined.protocol === serverProtocol, 'joined 의 규약이 config 와 같다', joined.protocol);

  const world = await worldP;
  must(world && world.size > 0, '지도가 내려온다', `${world.size}칸 · 노드 ${world.nodes?.length ?? 0}개`);
  const state0 = await next(socket, 'state');
  must(!!state0, 'state 가 world 뒤에 따라온다 (접속 순서 계약)');
  const wood0 = state0.nation?.resources?.wood ?? 0;

  const town = world.towns.find((t) => t.isPlayer);
  const dTown = (n) => Math.hypot(n.x - town.x, n.y - town.y);
  const forests = (world.nodes || []).filter((n) => n.type === 'forest').sort((a, b) => dTown(a) - dTown(b));
  must(forests.length > 0, '벨 나무가 지도에 있다', `가장 가까운 것 ${forests[0] ? dTown(forests[0]).toFixed(1) : '?'}타일`);

  let now = Date.now();
  let gained = 0;
  let fi = 0;
  for (let i = 0; i < 8 && forests.length; i += 1) {
    const node = forests[fi % forests.length];
    await send(socket, 'lordMove', { x: node.x, y: node.y });
    now += 2500;                                   // 연타 방지 쿨다운을 넘긴다
    const r = await send(socket, 'actionSwing', { nodeId: node.id, now });
    if (r?.ok) gained += r.gained?.wood ?? 0; else fi += 1;
  }
  must(gained > 0, '나무를 베면 목재가 오른다 (서버 왕복이 산다)', `+${gained}`);
  woodAfter = wood0 + gained;
} catch (e) {
  bad('소켓 왕복에 실패했다', String(e.message || e));
} finally {
  try { socket?.close(); } catch { /* 이미 닫힘 */ }
}
console.log('');

// ────────────────────────────────────────────────────────────────
// 5단. 방이 남는가 — 창을 닫았다 다시 열어도 같은 정착지 (§4-5-4)
//      = 영구 디스크(볼륨)와 재접속 경로를 한 번에 본다
// ────────────────────────────────────────────────────────────────
console.log('5단 · 다시 들어가면 같은 정착지인가 (볼륨·재접속)');
let socket2 = null;
try {
  await sleep(1500);                               // 스냅샷이 디스크에 앉을 틈
  socket2 = connect(SERVER, pagesOrigin);
  await new Promise((res, rej) => {
    socket2.on('connect', res);
    socket2.on('connect_error', (e) => rej(new Error(e.message)));
    setTimeout(() => rej(new Error('소켓 연결 시간 초과')), 15000);
  });
  const rejoined = await send(socket2, 'join', { gameId, playerName: '배포검사', avatarId: 'p1' });
  must(rejoined?.ok === true, '같은 방으로 다시 들어간다');
  const state1 = await next(socket2, 'state');
  const wood1 = state1?.nation?.resources?.wood ?? -1;
  must(wood1 >= woodAfter && woodAfter > 0, '아까 벤 목재가 그대로 있다', `${wood1} (기대 ≥ ${woodAfter})`);
  const { json } = await get(`${SERVER}/api/games`);
  const games = (await json()).games || [];
  must(games.some((g) => g.gameId === gameId || g.id === gameId), '방 목록에도 남아 있다', `방 ${games.length}개`);
  note('★ 볼륨의 진짜 증명은 여기까지가 아니다 — Railway 에서 **재배포(또는 재시작)** 한 뒤');
  note(`  같은 명령을 --server 그대로 한 번 더 돌려, 위 목재가 살아 있으면 디스크가 영구다.`);
  note(`  (재시작 뒤 확인용) node harness/check_deploy.mjs --server ${SERVER} --resume ${gameId}`);
} catch (e) {
  bad('재접속을 확인하지 못했다', String(e.message || e));
} finally {
  try { socket2?.close(); } catch { /* 이미 닫힘 */ }
}
console.log('');

// ────────────────────────────────────────────────────────────────
// 재시작 뒤 확인 모드 — --resume <gameId>
// ────────────────────────────────────────────────────────────────
if (args.get('resume')) {
  console.log('부록 · 재시작 뒤에도 방이 살아 있는가');
  let s3 = null;
  try {
    s3 = connect(SERVER, pagesOrigin);
    await new Promise((res, rej) => { s3.on('connect', res); s3.on('connect_error', (e) => rej(new Error(e.message))); setTimeout(() => rej(new Error('시간 초과')), 15000); });
    const r = await send(s3, 'join', { gameId: String(args.get('resume')), playerName: '배포검사', avatarId: 'p1' });
    must(r?.ok === true, '재시작 전에 만든 방으로 들어가진다');
    const st = await next(s3, 'state');
    must((st?.nation?.resources?.wood ?? 0) > 0, '그때 벤 목재가 디스크에서 살아 돌아왔다',
      `목재 ${st?.nation?.resources?.wood}`);
  } catch (e) {
    bad('재시작 뒤 확인 실패', String(e.message || e));
  } finally { try { s3?.close(); } catch { /* 이미 닫힘 */ } }
  console.log('');
}

// ────────────────────────────────────────────────────────────────
console.log('6단 · 다른 기기에서 증표로 들어가기 — **D-4 미구현**. 사람 손으로 볼 것이 없다(건너뜀).\n');
console.log(`배포 검증 — ${pass}단 통과${fails.length ? ` · ${fails.length}건 실패` : ''}`);
if (fails.length) {
  console.log('\n못 넘은 것:');
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('전부 통과. 제출 진열창을 손으로 한 번만 더 보자 — Pages 주소 + ?mock=1.\n');
process.exit(0);
