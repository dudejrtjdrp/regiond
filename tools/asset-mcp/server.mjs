#!/usr/bin/env node
// 갈래말래(Toji) 에셋 파이프라인용 MCP 서버 (stdio).
// 「왜」 프로젝트 규칙상 npm 의존성 추가가 금지라 SDK 없이 JSON-RPC 2.0을 직접 구현한다.
// 「왜」 MCP stdio 전송은 Content-Length 헤더가 없고 개행으로 끊는 JSON 한 줄이 한 메시지다.
// 「왜」 stdout은 프로토콜 전용 통로다. 사람이 볼 로그는 전부 stderr로 보낸다.

import { readFile, writeFile, rename, readdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import http from 'node:http';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'toji-assets', version: '1.0.0' };

// 「왜」 ComfyUI 후보 생성은 수 분이 걸린다. 넉넉히 10분을 준다.
const GENERATE_TIMEOUT_MS = 10 * 60 * 1000;
const QA_TIMEOUT_MS = 2 * 60 * 1000;
const COMFY_TIMEOUT_MS = 5000;
const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188';

// ---------------------------------------------------------------- 경로 유틸

// 「왜」 node:path조차 안 쓰는 무의존 규칙 — 윈도우도 슬래시 경로를 그대로 받아준다.
function slash(p) {
  return String(p).replace(/\\/g, '/');
}

function joinPath(...parts) {
  const merged = parts.filter(isFilledString).map(slash).join('/');
  return merged.replace(/(?<!^)\/{2,}/g, '/');
}

function isFilledString(v) {
  return typeof v === 'string' && v.length > 0;
}

// 「왜」 이 파일은 <root>/tools/asset-mcp/ 에 있으므로 두 단계 위가 프로젝트 루트다.
function findProjectRoot(dir) {
  const here = slash(dir);
  const trimmed = here.replace(/\/tools\/asset-mcp\/?$/, '');
  if (trimmed !== here) return trimmed;
  return joinPath(here, '..', '..');
}

const PROJECT_ROOT = findProjectRoot(import.meta.dirname);
const MANIFEST_PATH = joinPath(PROJECT_ROOT, 'public/assets/manifest.json');
const CONFIG_PATH = joinPath(PROJECT_ROOT, 'tools/pipeline/config.json');

// ---------------------------------------------------------------- 공통 유틸

function log(message) {
  process.stderr.write(`[toji-assets] ${message}\n`);
}

function humanize(err) {
  if (err instanceof Error) return err.message;
  return String(err);
}

function tail(text, count) {
  const body = String(text ?? '').replace(/\r\n/g, '\n').trimEnd();
  if (body === '') return '';
  const lines = body.split('\n');
  if (lines.length <= count) return lines.join('\n');
  return lines.slice(-count).join('\n');
}

function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: humanize(err) };
  }
}

async function readJsonFile(path, label) {
  const raw = await readFile(path, 'utf8').catch(err => {
    throw new Error(`${label}을(를) 읽지 못했습니다 (${slash(path)}) — ${humanize(err)}`);
  });
  const parsed = parseJson(raw);
  if (!parsed.ok) throw new Error(`${label}의 JSON 형식이 올바르지 않습니다 (${slash(path)}) — ${parsed.error}`);
  return parsed.value;
}

// 「왜」 중간에 프로세스가 죽어도 manifest가 반쪽으로 남지 않게 임시 파일 후 rename 한다.
async function writeJsonAtomic(path, data) {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

async function pathExists(path) {
  const info = await stat(path).catch(() => null);
  return info !== null;
}

// ---------------------------------------------------------- JSON-RPC 프레이밍

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

let inbox = '';

function onStdinChunk(chunk) {
  inbox += chunk;
  const lines = inbox.split('\n');
  inbox = lines.pop();
  for (const line of lines) handleLine(line);
}

// 「왜」 깨진 입력 한 줄 때문에 서버가 죽으면 세션 전체가 끊긴다. 에러만 돌려주고 계속 읽는다.
function handleLine(line) {
  const text = line.trim();
  if (text === '') return;
  const parsed = parseJson(text);
  if (!parsed.ok) return sendError(null, -32700, `JSON 파싱에 실패했습니다 — 한 줄에 JSON 한 개씩 보내주세요. (${parsed.error})`);
  dispatch(parsed.value);
}

function dispatch(message) {
  if (!isPlainObject(message)) return sendError(null, -32600, '요청 형식이 올바르지 않습니다 — JSON 객체여야 합니다.');
  const hasId = message.id !== undefined && message.id !== null;
  // 「왜」 id 없는 메시지는 알림(notifications/initialized 등)이라 응답을 보내면 안 된다.
  if (!hasId) return log(`알림 무시: ${message.method}`);
  const handler = METHODS[message.method];
  if (!handler) return sendError(message.id, -32601, `지원하지 않는 메서드입니다: ${message.method}`);
  respond(message, handler);
}

// 「왜」 stdin이 닫혀도 처리 중인 요청이 남아 있으면 응답을 흘려버리게 된다. 개수를 세어 둔다.
let pending = 0;
let stdinClosed = false;

async function respond(message, handler) {
  pending += 1;
  try {
    const result = await handler(message.params ?? {});
    send({ jsonrpc: '2.0', id: message.id, result });
  } catch (err) {
    log(`${message.method} 처리 실패 — ${err?.stack ?? err}`);
    sendError(message.id, -32603, `서버 내부 오류: ${humanize(err)}`);
  }
  pending -= 1;
  exitWhenDrained();
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------- MCP 메서드

function pickProtocolVersion(params) {
  // 「왜」 클라이언트가 제시한 버전을 그대로 되돌려주는 편이 호환성이 넓다.
  const asked = params?.protocolVersion;
  if (isFilledString(asked)) return asked;
  return PROTOCOL_VERSION;
}

async function onInitialize(params) {
  log(`initialize — 프로젝트 루트 ${PROJECT_ROOT}`);
  return {
    protocolVersion: pickProtocolVersion(params),
    capabilities: { tools: { listChanged: false } },
    serverInfo: SERVER_INFO,
  };
}

async function onToolsList() {
  return { tools: TOOLS };
}

function textResult(text, isError) {
  return { content: [{ type: 'text', text }], isError };
}

async function onToolsCall(params) {
  const name = params?.name;
  const handler = TOOL_HANDLERS[name];
  if (!handler) return textResult(`알 수 없는 도구입니다: ${name} — tools/list로 사용 가능한 도구를 확인하세요.`, true);
  try {
    const text = await handler(params?.arguments ?? {});
    return textResult(text, false);
  } catch (err) {
    log(`도구 ${name} 실패 — ${err?.stack ?? err}`);
    return textResult(humanize(err), true);
  }
}

const METHODS = {
  initialize: onInitialize,
  ping: async () => ({}),
  'tools/list': onToolsList,
  'tools/call': onToolsCall,
};

// ------------------------------------------------------------- 파이썬 실행기

function spawnOnce(command, args, timeoutMs) {
  return new Promise(resolve => {
    // 「왜」 한글 이름/설명이 cp949로 깨지지 않게 파이썬 입출력을 UTF-8로 못박는다.
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
    const child = spawn(command, args, { cwd: PROJECT_ROOT, env, windowsHide: true });
    const box = { out: [], err: [], timedOut: false };
    const timer = setTimeout(() => {
      box.timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', d => box.out.push(d));
    child.stderr.on('data', d => box.err.push(d));
    child.on('error', error => resolve(finishRun(timer, box, null, error)));
    child.on('close', code => resolve(finishRun(timer, box, code, null)));
  });
}

function finishRun(timer, box, code, launchError) {
  clearTimeout(timer);
  return {
    code,
    launchError,
    timedOut: box.timedOut,
    stdout: Buffer.concat(box.out).toString('utf8'),
    stderr: Buffer.concat(box.err).toString('utf8'),
  };
}

// 「왜」 윈도우에는 `python`이 없고 런처 `py`만 설치된 환경이 흔해서 한 번 더 시도한다.
async function runPython(args, timeoutMs) {
  const first = await spawnOnce('python', args, timeoutMs);
  if (!first.launchError) return { ...first, command: 'python' };
  log(`python 실행 실패(${humanize(first.launchError)}) — py -3로 재시도합니다.`);
  const second = await spawnOnce('py', ['-3', ...args], timeoutMs);
  if (!second.launchError) return { ...second, command: 'py -3' };
  throw new Error('Python을 실행하지 못했습니다 — `python` 또는 `py -3`가 PATH에 있는지, Python 3.10+ 설치 여부를 확인하세요.');
}

function runHeader(title, run, argv) {
  const lines = [`# ${title}`, `실행: ${run.command} ${argv.join(' ')}`, `작업 디렉토리: ${PROJECT_ROOT}`, `종료 코드: ${run.code}`];
  if (run.timedOut) lines.push('경고: 시간 초과로 프로세스를 강제 종료했습니다 — ComfyUI 큐 상태를 확인하세요.');
  return lines;
}

function runBody(run, stdoutLines) {
  const lines = ['', '## 파이프라인 출력', tail(run.stdout, stdoutLines) || '(표준 출력 없음)'];
  const errTail = tail(run.stderr, 20);
  if (errTail !== '') lines.push('', '## stderr (마지막 20줄)', errTail);
  return lines;
}

// -------------------------------------------------------------- manifest 접근

async function readManifest() {
  const manifest = await readJsonFile(MANIFEST_PATH, 'manifest.json');
  if (!isPlainObject(manifest)) throw new Error('manifest.json 최상위가 객체가 아닙니다 — 스키마 v1을 확인하세요.');
  return manifest;
}

function assetsOf(manifest) {
  if (Array.isArray(manifest.assets)) return manifest.assets;
  return [];
}

function qaResultOf(asset) {
  const result = asset?.qa?.result;
  if (isFilledString(result)) return result;
  return '미검사';
}

function assetDirOf(asset, id) {
  // 「왜」 manifest의 path는 public/ 기준 상대경로다. 없으면 명명 규칙으로 되짚는다.
  if (isFilledString(asset?.path)) return joinPath(PROJECT_ROOT, 'public', asset.path);
  return joinPath(PROJECT_ROOT, 'public/assets', id);
}

async function describeAsset(id) {
  const manifest = await readManifest().catch(err => humanize(err));
  if (typeof manifest === 'string') return ['## 등록 결과', manifest].join('\n');
  const asset = assetsOf(manifest).find(a => a?.id === id);
  if (!asset) return ['## 등록 결과', `manifest.json에 ${id}가 없습니다 — --no-register로 실행했거나 등록 단계가 실패했습니다.`].join('\n');
  const files = await listAssetFiles(assetDirOf(asset, id));
  return ['## 등록 결과', ...describeAssetLines(asset), '', '## 생성 파일', ...files].join('\n');
}

function describeAssetLines(asset) {
  const size = formatDims(asset.size);
  const pixel = formatDims(asset.pixelSize);
  const qa = asset.qa ?? {};
  return [
    `- id: ${asset.id} / 이름: ${asset.name} / 카테고리: ${asset.category} / 등급: ${asset.grade ?? '-'}`,
    `- 캔버스: ${size} · 콘텐츠: ${pixel} · 팔레트 사용: ${asset.paletteUsed ?? '?'}색 · 버전: ${asset.version ?? '-'}`,
    `- QA: ${qaResultOf(asset)} ${formatChecks(qa.checks)}${formatNotes(qa.notes)}`,
  ];
}

function formatDims(dims) {
  if (!Array.isArray(dims)) return '?';
  return dims.join('x');
}

function formatChecks(checks) {
  if (!isPlainObject(checks)) return '';
  const parts = Object.entries(checks).map(([k, v]) => `${k}=${v}`);
  return `(${parts.join(', ')})`;
}

function formatNotes(notes) {
  if (!isFilledString(notes)) return '';
  return ` / 비고: ${notes}`;
}

async function listAssetFiles(dir) {
  const names = await readdir(dir).catch(() => null);
  if (names === null) return [`- (폴더를 찾지 못했습니다: ${dir})`];
  if (names.length === 0) return [`- (비어 있음: ${dir})`];
  return names.sort().map(n => `- ${joinPath(dir, n)}`);
}

// ------------------------------------------------------------------ 도구 구현

function requireFields(args, names) {
  return names.filter(n => !isFilledString(args?.[n]));
}

function pushOption(argv, flag, value) {
  if (value === undefined || value === null || value === '') return;
  argv.push(flag, String(value));
}

function buildGenerateArgv(args) {
  const argv = ['tools/pipeline/generate.py', '--id', args.id, '--name', args.name, '--desc', args.desc, '--category', args.category];
  pushOption(argv, '--grade', args.grade);
  pushOption(argv, '--candidates', args.candidates);
  pushOption(argv, '--size', args.size);
  pushOption(argv, '--workflow', args.workflow);
  return argv;
}

async function toolGenerateAsset(args) {
  const missing = requireFields(args, ['id', 'name', 'desc', 'category']);
  if (missing.length > 0) throw new Error(`필수 인자가 빠졌습니다: ${missing.join(', ')} — id/name/desc/category는 모두 필요합니다.`);
  const argv = buildGenerateArgv(args);
  const run = await runPython(argv, GENERATE_TIMEOUT_MS);
  const report = [...runHeader(`generate_asset — ${args.id}`, run, argv), ...runBody(run, 40), '', await describeAsset(args.id)].join('\n');
  if (run.code !== 0) throw new Error(`에셋 생성에 실패했습니다 (종료 코드 ${run.code}).\n\n${report}`);
  return report;
}

async function toolQaAsset(args) {
  const missing = requireFields(args, ['id']);
  if (missing.length > 0) throw new Error('id는 필수입니다 — 예: monster/goblin_warrior');
  const argv = ['tools/pipeline/qa.py', '--id', args.id];
  const run = await runPython(argv, QA_TIMEOUT_MS);
  const report = [...runHeader(`qa_asset — ${args.id}`, run, argv), ...runBody(run, 60)].join('\n');
  if (run.code !== 0) throw new Error(`QA 실행에 실패했습니다 (종료 코드 ${run.code}).\n\n${report}`);
  return report;
}

function summarizeQa(assets) {
  const tally = { PASS: 0, WARNING: 0, FAIL: 0, 미검사: 0 };
  for (const asset of assets) tally[qaResultOf(asset)] = (tally[qaResultOf(asset)] ?? 0) + 1;
  return Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' · ');
}

function assetLine(asset) {
  return `- ${asset?.id ?? '(id 없음)'} | ${asset?.name ?? '(이름 없음)'} | ${asset?.grade ?? '-'} | QA ${qaResultOf(asset)}`;
}

function scopeLabel(category) {
  if (!isFilledString(category)) return '전체';
  return `카테고리 ${category}`;
}

async function toolListAssets(args) {
  const manifest = await readManifest();
  const all = assetsOf(manifest);
  const category = args?.category;
  const picked = filterByCategory(all, category);
  const scope = scopeLabel(category);
  const head = [`# 등록 에셋 — ${scope} ${picked.length}개 (manifest 총 ${all.length}개)`, `기준 캐릭터: ${manifest.reference ?? '(미지정)'} · 팔레트: ${manifest.palette ?? '(미지정)'}`, `QA 집계: ${summarizeQa(picked)}`, ''];
  if (picked.length === 0) return [...head, '해당 조건에 맞는 에셋이 없습니다 — 아직 미등록 카테고리입니다.'].join('\n');
  return [...head, ...picked.map(assetLine)].join('\n');
}

function filterByCategory(assets, category) {
  if (!isFilledString(category)) return assets;
  return assets.filter(a => a?.category === category);
}

function parseOverridePayload(input) {
  if (isPlainObject(input)) return input;
  if (!isFilledString(input)) throw new Error('json 인자가 필요합니다 — size-overrides.json 내용을 문자열 또는 객체로 넘겨주세요.');
  const parsed = parseJson(input);
  if (!parsed.ok) throw new Error(`size-overrides JSON을 해석하지 못했습니다 — ${parsed.error}`);
  if (!isPlainObject(parsed.value)) throw new Error('size-overrides의 최상위는 객체여야 합니다 — {"version":1,"overrides":{...}} 형식입니다.');
  return parsed.value;
}

function overridesOf(payload) {
  const overrides = payload.overrides;
  if (!isPlainObject(overrides)) throw new Error('overrides 필드가 없습니다 — {"version":1,"overrides":{"<id>":{"scale":1.25}}} 형식이어야 합니다.');
  return overrides;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

const OVERRIDE_FIELDS = ['scale', 'offsetX', 'offsetY'];

function applyOverride(asset, patch) {
  const changed = [];
  for (const field of OVERRIDE_FIELDS) applyField(asset, patch, field, changed);
  return changed;
}

function applyField(asset, patch, field, changed) {
  const value = patch?.[field];
  if (value === undefined) return;
  if (!isFiniteNumber(value)) return changed.push(`${field}=무시(숫자가 아님: ${JSON.stringify(value)})`);
  if (asset[field] === value) return changed.push(`${field}=${value}(변화 없음)`);
  asset[field] = value;
  changed.push(`${field}=${value}`);
}

async function toolApplySizeOverrides(args) {
  const payload = parseOverridePayload(args?.json);
  const overrides = overridesOf(payload);
  const manifest = await readManifest();
  const report = applyAllOverrides(manifest, overrides);
  if (report.applied.length > 0) await writeJsonAtomic(MANIFEST_PATH, manifest);
  return formatOverrideReport(report, overrides);
}

function applyAllOverrides(manifest, overrides) {
  const assets = assetsOf(manifest);
  const applied = [];
  const warnings = [];
  for (const [id, patch] of Object.entries(overrides)) collectOverride(assets, id, patch, applied, warnings);
  return { applied, warnings };
}

function collectOverride(assets, id, patch, applied, warnings) {
  const asset = assets.find(a => a?.id === id);
  if (!asset) return warnings.push(`- ${id}: manifest.json에 없는 id라 건너뜁니다.`);
  if (!isPlainObject(patch)) return warnings.push(`- ${id}: 값이 객체가 아니라 건너뜁니다.`);
  const changed = applyOverride(asset, patch);
  if (changed.length === 0) return warnings.push(`- ${id}: 적용할 scale/offsetX/offsetY 값이 없습니다.`);
  applied.push(`- ${id}: ${changed.join(', ')}`);
}

function formatOverrideReport(report, overrides) {
  const total = Object.keys(overrides).length;
  const lines = [`# apply_size_overrides — 요청 ${total}건 / 반영 ${report.applied.length}건`, `대상: ${MANIFEST_PATH}`, ''];
  if (report.applied.length > 0) lines.push('## 반영됨', ...report.applied, '');
  if (report.applied.length === 0) lines.push('반영된 항목이 없어 manifest.json은 그대로 두었습니다.', '');
  if (report.warnings.length > 0) lines.push('## 경고', ...report.warnings);
  return lines.join('\n');
}

// ------------------------------------------------------------ ComfyUI 상태

async function readComfyUrl() {
  const config = await readJsonFile(CONFIG_PATH, 'config.json').catch(err => {
    log(humanize(err));
    return null;
  });
  if (isFilledString(config?.comfyUrl)) return { url: config.comfyUrl, source: CONFIG_PATH };
  return { url: DEFAULT_COMFY_URL, source: '기본값(config.json에서 comfyUrl을 찾지 못함)' };
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: COMFY_TIMEOUT_MS }, res => collectResponse(res, resolve, reject));
    req.on('timeout', () => req.destroy(new Error('응답 시간 초과')));
    req.on('error', err => reject(err));
  });
}

function collectResponse(res, resolve, reject) {
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} 응답 — ${tail(body, 3)}`));
    const parsed = parseJson(body);
    if (!parsed.ok) return reject(new Error(`JSON이 아닌 응답을 받았습니다 — ${parsed.error}`));
    resolve(parsed.value);
  });
}

function statsUrl(base) {
  const parsed = new URL('/system_stats', base);
  // 「왜」 무의존 규칙상 node:http만 쓰므로 https 주소는 지원 범위를 벗어난다.
  if (parsed.protocol !== 'http:') throw new Error(`http:// 주소만 지원합니다 — config.json의 comfyUrl(${base})을 확인하세요.`);
  return parsed.toString();
}

function gib(bytes) {
  if (!isFiniteNumber(bytes)) return '?';
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

function deviceLines(devices) {
  if (!Array.isArray(devices) || devices.length === 0) return ['- (장치 정보 없음)'];
  return devices.map(d => `- ${d?.name ?? '?'} (${d?.type ?? '?'}) · VRAM ${gib(d?.vram_free)} 여유 / ${gib(d?.vram_total)} 전체`);
}

function formatComfyStats(where, stats) {
  const sys = stats?.system ?? {};
  return [
    `# ComfyUI 접속 성공 — ${where.url}`,
    `설정 출처: ${where.source}`,
    `ComfyUI 버전: ${sys.comfyui_version ?? '?'} · Python ${sys.python_version ?? '?'} · PyTorch ${sys.pytorch_version ?? '?'} · OS ${sys.os ?? '?'}`,
    '',
    '## 장치',
    ...deviceLines(stats?.devices),
  ].join('\n');
}

function comfyFailureText(where, err) {
  return [
    `ComfyUI가 응답하지 않습니다 — 실행 여부와 포트 8188을 확인하세요. (${where.url})`,
    `원인: ${humanize(err)}`,
    '',
    '점검 순서:',
    '1. ComfyUI portable의 run_nvidia_gpu.bat 실행 여부',
    '2. 브라우저에서 http://127.0.0.1:8188 접속 확인',
    `3. ${CONFIG_PATH}의 comfyUrl 값이 실제 포트와 같은지 확인`,
    '4. 방화벽/백신이 로컬 포트를 막고 있지 않은지 확인',
  ].join('\n');
}

async function toolComfyStatus() {
  const where = await readComfyUrl();
  const target = statsUrl(where.url);
  const stats = await requestJson(target).catch(err => {
    throw new Error(comfyFailureText(where, err));
  });
  return formatComfyStats(where, stats);
}

// ------------------------------------------------------------------ 도구 목록

const TOOLS = [
  {
    name: 'generate_asset',
    description: '아트바이블 규격으로 에셋을 생성한다(tools/pipeline/generate.py 실행). 후보 생성 → 후처리 → QA 랭킹 → manifest 등록까지 수행하며 최대 10분 걸린다.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '에셋 id. `<category>/<snake_case>` 형식 (예: monster/goblin_warrior)' },
        name: { type: 'string', description: '한국어 표시 이름 (예: 고블린 전사)' },
        desc: { type: 'string', description: '영문 프롬프트 설명 (예: small hunched goblin warrior, rusty sword)' },
        category: { type: 'string', description: 'player npc monster animal weapon armor food consumable material mineral tree plant furniture building tileset ui effect portrait 중 하나' },
        grade: { type: 'string', description: '등급: common|uncommon|rare|epic|legendary' },
        candidates: { type: 'number', description: '생성 후보 장수 (기본은 파이프라인 설정값)' },
        size: { type: 'string', description: '캔버스 크기 (예: 128x128). 생략 시 카테고리 규격' },
        workflow: { type: 'string', description: 'ComfyUI 워크플로우 이름 (예: character)' },
      },
      required: ['id', 'name', 'desc', 'category'],
    },
  },
  {
    name: 'list_assets',
    description: 'public/assets/manifest.json에 등록된 에셋 목록과 QA 집계를 요약한다.',
    inputSchema: {
      type: 'object',
      properties: { category: { type: 'string', description: '특정 카테고리만 보고 싶을 때 지정' } },
      required: [],
    },
  },
  {
    name: 'qa_asset',
    description: '등록된 에셋 하나에 아트바이블 §11 QA(tools/pipeline/qa.py)를 단독 실행한다.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '검사할 에셋 id (예: monster/goblin_warrior)' } },
      required: ['id'],
    },
  },
  {
    name: 'apply_size_overrides',
    description: 'Asset Museum이 내보낸 size-overrides.json을 manifest.json의 scale/offsetX/offsetY에 반영한다(원자적 쓰기).',
    inputSchema: {
      type: 'object',
      properties: { json: { type: 'string', description: 'size-overrides.json 내용. {"version":1,"overrides":{"<id>":{"scale":1.25,"offsetY":-4}}} 형식' } },
      required: ['json'],
    },
  },
  {
    name: 'comfy_status',
    description: 'config.json의 comfyUrl로 ComfyUI 접속을 확인하고 버전·VRAM을 요약한다.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

const TOOL_HANDLERS = {
  generate_asset: toolGenerateAsset,
  list_assets: toolListAssets,
  qa_asset: toolQaAsset,
  apply_size_overrides: toolApplySizeOverrides,
  comfy_status: toolComfyStatus,
};

// ---------------------------------------------------------------------- 기동

// 「왜」 예기치 못한 예외로 서버가 죽으면 Claude Code 세션의 MCP 연결이 끊긴다. 로그만 남기고 버틴다.
process.on('uncaughtException', err => log(`처리되지 않은 예외 — ${err?.stack ?? err}`));
process.on('unhandledRejection', err => log(`처리되지 않은 거부 — ${err?.stack ?? err}`));

function exitWhenDrained() {
  if (!stdinClosed) return;
  if (pending > 0) return;
  process.exit(0);
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', onStdinChunk);
process.stdin.on('end', () => {
  stdinClosed = true;
  exitWhenDrained();
});
log(`시작 — 프로젝트 루트 ${PROJECT_ROOT}`);
