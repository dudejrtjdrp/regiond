#!/usr/bin/env node
/* shrink-assets.mjs — 배포용 에셋 축소.
 *
 * 「왜」 필요한가 — 수작업/AI 생성 PNG가 1254×1254 급인데, 화면에서는
 * 건물이 타일 1.7~2.6칸(줌 최대 32px 기준 41~83px), 노드가 16~64px 로만 그려진다.
 * 원본을 그대로 배포하면 537MB 를 받아서 60px 로 줄여 쓰는 셈이다.
 * (런타임 축소 비용은 atlas.js 의 scaled() 캐시가 이미 없앴다. 이건 전송량 쪽이다.)
 *
 * 「왜」 정수 배수로만 줄이나 — 스프라이트시트는 코드가 naturalWidth 를
 * 4·5·6·8·16 으로 나눠 프레임을 집는다(atlas.js:1794·1888, action-sprites.js:66).
 * 원본이 그 수로 나누어떨어지지 않는 것도 있어 이미 소수점 자리를 쓰고 있는데,
 * 정확히 1/k 로 줄이면 그 비율이 그대로 보존되므로 프레임 경계가 어긋나지 않는다.
 * 임의 크기(예: 무조건 256px)로 줄이면 시트가 미세하게 밀린다.
 *
 * 원본은 지우지 않고 _to_delete/original-size/ 로 옮긴다 — 되돌릴 수 있다.
 *
 * 사용법:
 *   node tools/shrink-assets.mjs --dry        # 계산만
 *   node tools/shrink-assets.mjs              # 실제 적용
 *   node tools/shrink-assets.mjs --max 320    # 목표 최대 변 (기본 320)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'public/assets');
const BACKUP = path.join(ROOT, '_to_delete/original-size');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const MAX = Number((args[args.indexOf('--max') + 1]) || 320) || 320;

/** PNG 머리글에서 크기만 읽는다 — 전체 디코드가 필요 없다 */
function dim(file) {
  const fd = fs.openSync(file, 'r');
  const b = Buffer.alloc(24);
  fs.readSync(fd, b, 0, 24, 0);
  fs.closeSync(fd);
  if (b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/* 프레임을 잘라 쓰는 시트만 정수 배수로 보호한다. 나머지 단일 그림은
   목표 크기로 바로 줄여도 경계가 어긋날 데가 없다.
   근거 — atlas.js:1794(/4·/6) · 1888(/4·/5) · 359-360(/16) · world.js:1779(/4)
        · action-sprites.js:66-67(/8) */
const SHEET = [
  /sheet\.png$/i,          // creature · enemy · characters · char_spritesheet
  /guardian-sheet\.png$/i, // temple
  /\/idle\.png$/i,         // 모닥불 4프레임
  /^autotile\//i,          // 47blob — 16칸 격자
  /^tileset\//i,           // base-v4 — 16칸 격자
  /^player\/(action-8dir|npc-walk|role-walk)\//i
];
const isSheet = (rel) => SHEET.some((re) => re.test(rel.split(path.sep).join('/')));

/* 아예 손대지 않는 것 — 도트가 아니라 「그려진 그림」이고, 화면에서도 원본만큼 크게 뜬다.
   대화창 판은 .dlg-cinematic{width:min(1000px,96vw)} 라 1000px 까지 늘어나는데,
   320px 로 줄여 두면 3.1배 확대가 걸려 얼굴 윤곽이 계단으로 보인다(A4).
   축소로 아낄 전송량보다 화질 손해가 크다. */
const EXCLUDE = [
  /^dialogue\//i   // 대화창 초상 — 긴 변 1000px 유지
];
const isExcluded = (rel) => EXCLUDE.some((re) => re.test(rel.split(path.sep).join('/')));

/* 「왜」 시트마다 상한이 다른가 — 목표는 「화면에 그려지는 크기」이지 시트 크기가 아니다.
   action-8dir 은 8행×8열 격자라 시트를 320px 로 줄이면 한 칸이 17×23px 이 되는데,
   화면에서는 32~64px 로 그린다. 같은 캐릭터의 걷기 프레임은 244~252px 원본을 그대로 쓰므로,
   도끼만 들면 화질이 대여섯 배 떨어져 보였다(A19). 한 칸이 64px 아래로 내려가지 않도록
   이 시트만 상한을 800px 로 둔다 — 1/2 축소가 걸려 칸이 67~90px 로 남는다. */
const SHEET_MAX = [
  [/^player\/action-8dir\//i, 800]
];
function maxFor(rel) {
  const hit = SHEET_MAX.find(([re]) => re.test(rel.split(path.sep).join('/')));
  /* --max 를 더 크게 준 사람의 뜻이 우선이다 */
  return hit ? Math.max(MAX, hit[1]) : MAX;
}

/** 두 변 모두 정확히 나누어떨어지면서 목표 크기 이하로 만드는 가장 작은 배수 */
function factorFor(w, h, max = MAX) {
  for (let k = 2; k <= 16; k++) {
    if (w % k || h % k) continue;
    if (Math.max(w / k, h / k) <= max) return k;
  }
  return 0;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.toLowerCase().endsWith('.png')) out.push(p);
  }
  return out;
}

const files = walk(SRC);
let before = 0, after = 0, done = 0, skipped = 0;
const skips = [];
const jobs = [];

for (const f of files) {
  const size = fs.statSync(f).size;
  before += size;
  const d = dim(f);
  if (!d) { after += size; continue; }
  const rel = path.relative(SRC, f);
  if (isExcluded(rel)) { after += size; continue; }
  const max = maxFor(rel);
  if (Math.max(d.w, d.h) <= max) { after += size; continue; }
  const sheet = isSheet(rel);
  const k = sheet ? factorFor(d.w, d.h, max) : 0;
  let nw, nh;
  if (sheet) {
    if (!k) { after += size; skipped++; skips.push(`${d.w}x${d.h} ${rel}`); continue; }
    nw = d.w / k; nh = d.h / k;
  } else {
    const s = max / Math.max(d.w, d.h);
    nw = Math.max(1, Math.round(d.w * s)); nh = Math.max(1, Math.round(d.h * s));
  }

  if (DRY) {
    /* 실제 인코딩 없이 대략치 — 면적비에 약간의 보정 */
    after += Math.round(size * (nw * nh) / (d.w * d.h) * 1.6);
    done++;
    continue;
  }

  /* 「왜」 모아서 한 번에 — 장당 python 을 띄우면 550장에 3분이 넘는다 */
  jobs.push({ src: f, bak: path.join(BACKUP, rel), w: nw, h: nh });
  done++;
}

if (!DRY && jobs.length) {
  for (const j of jobs) fs.mkdirSync(path.dirname(j.bak), { recursive: true });
  const spec = path.join('/tmp', 'shrink-jobs-' + process.pid + '.json');
  fs.writeFileSync(spec, JSON.stringify(jobs));
  execFileSync('python3', ['-c', `
import json, sys, io
from PIL import Image
jobs = json.load(open(sys.argv[1]))
for i, j in enumerate(jobs):
    # 「왜」 통째로 읽어 메모리에서 여나 — Image.open 은 게을러서 파일 핸들을 쥐고 있고,
    # 이 마운트에서는 열려 있는 파일을 덮어쓰면 Errno 22 가 난다.
    data = open(j['src'], 'rb').read()
    im = Image.open(io.BytesIO(data))
    if im.mode not in ('RGBA', 'RGB', 'P'):
        im = im.convert('RGBA')
    buf = io.BytesIO()
    im.resize((j['w'], j['h']), Image.LANCZOS).save(buf, format='PNG', optimize=True)
    im.close()
    # 원본을 먼저 옮겨 두고 덮어쓴다 — 되돌릴 수 있게
    open(j['bak'], 'wb').write(data)
    open(j['src'], 'wb').write(buf.getvalue())
    if (i + 1) % 100 == 0:
        print(f"  {i+1}/{len(jobs)}장", file=sys.stderr)
`, spec], { stdio: ['ignore', 'inherit', 'inherit'] });
  fs.unlinkSync(spec);
  for (const j of jobs) after += fs.statSync(j.src).size;
}

const MB = (n) => (n / 1048576).toFixed(0) + 'MB';
console.log(`${DRY ? '[계산만] ' : ''}대상 ${files.length}장 중 ${done}장 축소, ${skipped}장 건너뜀`);
console.log(`${MB(before)} → ${MB(after)}  (목표 최대 변 ${MAX}px)`);
if (skips.length) {
  console.log(`\n건너뛴 것 — 두 변을 함께 나눌 배수가 없다(시트 격자 보호):`);
  skips.slice(0, 12).forEach((s) => console.log('  ' + s));
  if (skips.length > 12) console.log(`  … 외 ${skips.length - 12}장`);
}
if (!DRY) console.log(`\n원본은 _to_delete/original-size/ 에 있다.`);
