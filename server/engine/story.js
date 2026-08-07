// story.js — ★ §세계관 W2 스토리 연출 엔진. 정본은 data/story.json + docs/세계관기획.md §7.
//
// 「왜」 별도 엔진인가 — 연출은 게임을 바꾸면 안 된다(세계관기획 §0-1). 그래서 이 모듈은
// 판정을 하나도 갖지 않는다: 이미 일어난 이벤트 묶음(batch)을 곁눈질해, 맞는 beat 를
// 딱 한 번(storySeen) 이야기 이벤트로 바꿔 얹을 뿐이다. 시간 방아쇠는 없다 — §11-1.
import { record as chronicle } from './chronicle.js';

const storyCfg = (data) => data.story;
const beats = (data) => storyCfg(data).beats || [];

/**
 * 본 beat 장부. ★ 옛 세이브(이미 진행 중인 세계)에는 지난 이야기를 몰아서 틀지 않는다 —
 * 장부가 없는데 세계가 이미 굴렀다면, 전부 「본 것」으로 치고 조용히 넘어간다.
 */
function seenMap(world, data) {
  if (!world.storySeen) {
    world.storySeen = {};
    if ((world.tick ?? 0) > 0) beats(data).forEach((b) => { world.storySeen[b.id] = -1; });
  }
  return world.storySeen;
}

/** 성녀 자리를 사람이 쥐고 있는가 — 세라 화자 규칙(세계관기획 §5)의 유일한 분기 */
function saintHeldByHuman(nation) {
  const r = nation?.roles?.saint;
  if (!r || !r.holder) return false;
  return r.holder !== 'npc';
}

function matchesWhen(beat, e) {
  const w = beat.when;
  if (!w) return true;
  if (w.chapterId != null && e.data?.id !== w.chapterId) return false;
  if (w.waveNumber != null && e.data?.number !== w.waveNumber) return false;
  return true;
}

function findTrigger(beat, batch) {
  return (batch || []).find((e) => e && e.kind === beat.on && matchesWhen(beat, e)) ?? null;
}

/** {name}·{lord} 치환 + 세라 화자 전환. 연출 텍스트는 서버가 완성해 내보낸다(클라는 그리기만). */
function renderScenes(beat, nation, data, ctx) {
  const lord = ctx.lord || storyCfg(data).lordFallback || '군주';
  const swap = beat.saintVoice && saintHeldByHuman(nation);
  return beat.scenes.map((s) => ({
    speaker: renderSpeaker(s.speaker, swap, data, lord),
    text: String(s.text).replaceAll('{name}', nation.name).replaceAll('{lord}', lord),
  }));
}

function renderSpeaker(speaker, swap, data, lord) {
  if (swap && speaker === '세라') return storyCfg(data).saintVoiceSpeaker || '성녀의 직감';
  return String(speaker || '').replaceAll('{lord}', lord);
}

function fire(world, nation, beat, data, ctx) {
  const seen = seenMap(world, data);
  seen[beat.id] = world.tick ?? 0;
  // ★ 분기(승/패)는 서로를 지운다 — 첫 결전의 이야기는 한 갈래만 남는다
  (beat.excludes || []).forEach((id) => { seen[id] = seen[id] ?? -1; });
  if (beat.chronicle) recordBeat(world, nation, beat, data);
  return {
    kind: 'story_beat',
    nationId: nation.id,
    data: { id: beat.id, scenes: renderScenes(beat, nation, data, ctx), skippable: beat.skippable !== false },
  };
}

function recordBeat(world, nation, beat, data) {
  const text = String(beat.chronicle).replaceAll('{name}', nation.name);
  chronicle(world, { kind: 'story', title: '이야기', text, data: { beatId: beat.id } }, data);
}

/**
 * 이벤트 묶음을 곁눈질해 이야기 이벤트를 얹는다. 부르는 자리는 셋뿐이다 —
 * 일 틱(advance)·실시간(emitImmediate)·웨이브 결전(resolveWave). 폴링 없음.
 */
export function storyEvents(world, data, batch, ctx = {}) {
  const nation = world.nations?.[world.playerNationId];
  if (!nation) return [];
  const seen = seenMap(world, data);
  const out = [];
  for (const beat of beats(data)) {
    if (seen[beat.id] !== undefined) continue;
    const trigger = findTrigger(beat, batch);
    if (!trigger) continue;
    out.push(fire(world, nation, beat, data, { ...ctx, lord: ctx.lord ?? trigger.data?.by }));
  }
  return out;
}

/** 건국 직후 도입(알현실) — join 마다 불러도 storySeen 이 1회를 보장한다 */
export function gameStartedEvents(world, data) {
  if ((world.tick ?? 0) > 0) { seenMap(world, data); return []; }
  return storyEvents(world, data, [{ kind: 'game_started', nationId: world.playerNationId }]);
}
