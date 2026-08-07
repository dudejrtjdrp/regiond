// 표현 계층 — 비동기 큐. 게임 진행을 절대 막지 않는다 (기획 §10-2 / SPEC §12).
import { loadGameData } from '../engine/data.js';
import { statRng } from '../engine/traits.js';
import { templateText, renderTemplate } from './templates.js';
import { expressWithClaude, isEnabled } from './claude_adapter.js';

/* ★ §20-R1.5 유물 발견 서사 — LLM 에게 주는 그 자리만의 지시. 체계 규칙 뒤에 붙는다. */
const NARRATIVE_HINT = '유물을 발견한 순간의 서사를 한두 문장으로 쓴다. '
  + '주어진 이름·등급·효과·발견처만 쓰고, 없는 사연을 지어내지 않는다.';

export class ExpressionQueue {
  constructor({ data = loadGameData(), onText = () => {}, useLlm = isEnabled(), concurrency = 2 } = {}) {
    this.data = data;
    this.onText = onText;
    this.useLlm = useLlm;
    this.concurrency = concurrency;
    this.queue = [];
    this.running = 0;
  }

  /** 동기: 즉시 템플릿 문장을 돌려주고, LLM 개선본은 나중에 onText 로 밀어준다. */
  express(event, { nationId = null, quality = 1 } = {}) {
    const snapshot = buildSnapshot(event, this.data);
    const text = templateText(event.kind, snapshot, this.data);
    const decorated = withNarrative({ ...event, text, source: 'template' }, this.data);
    if (this.useLlm) {
      this.queue.push({ event: decorated, snapshot, nationId, quality });
      queueMicrotask(() => this.#drain());
    }
    return decorated;
  }

  async #drain() {
    while (this.running < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      this.running += 1;
      this.#ask(job).catch(() => {}).finally(() => { this.running -= 1; this.#drain(); });
    }
  }

  /* ★ §20-R1.5 — 유물 발견만 서사 자리(data.narrative)를 채우고, 나머지는 예전처럼 text 를 고쳐 쓴다. */
  async #ask(job) {
    const narrative = job.event.kind === 'artifact_found';
    const hint = narrative ? NARRATIVE_HINT : '';
    const text = await expressWithClaude({ kind: job.event.kind, ...job.snapshot }, { quality: job.quality, hint });
    if (!text) return;
    this.onText(narrative ? withLlmNarrative(job.event, text) : { ...job.event, text, source: 'llm' }, job.nationId);
  }

  get pending() { return this.queue.length + this.running; }
}

/**
 * ★ §20-R1.5 발견 서사(폴백) — 등급 한 줄 + 계열 한 줄을 이어 붙인다.
 * 「왜」 statRng 인가 — 서사는 표시 전용이지만 뽑기는 난수다. 월드 난수를 한 톨이라도 축내면
 * 같은 씨앗이 다른 게임이 된다(§13-C). 씨앗 문자열은 엔진이 발견 사실에 적어 보낸다.
 */
export function artifactNarrative(d, data = loadGameData()) {
  const cfg = data.templates.artifactNarrative;
  if (!cfg || !d?.key) return '';
  const rng = statRng(d.narrativeSeed || `artifact:${d.key}`);
  const snap = { artifact: d.artifact, effect: d.effect,
    grade: data.artifacts.grades[d.grade]?.name ?? d.grade,
    source: cfg.sourceNames?.[d.source] ?? d.source ?? '' };
  const lines = [pickLine(cfg.byGrade?.[d.grade], rng), pickLine(cfg.byCategory?.[d.category], rng)];
  return lines.filter(Boolean).map((t) => renderTemplate(t, snap)).join(' ');
}

const pickLine = (pool, rng) => (pool?.length ? pool[Math.floor(rng.next() * pool.length)] : '');

function withNarrative(event, data) {
  if (event.kind !== 'artifact_found') return event;
  return { ...event, data: { ...event.data, narrative: artifactNarrative(event.data, data), narrativeSource: 'template' } };
}

function withLlmNarrative(event, narrative) {
  return { ...event, data: { ...event.data, narrative, narrativeSource: 'llm' } };
}

export function buildSnapshot(event, data = loadGameData()) {
  const d = event.data || {};
  const snap = { tick: event.tick, nationId: event.nationId, ...d };
  if (snap.winChance != null && snap.winChance <= 1) snap.winChance = Math.round(snap.winChance * 100);
  if (snap.resourceRatio != null) snap.resourceLoss = Math.round(snap.resourceRatio * 100);
  if (d.losses) { snap.populationLoss = d.losses.population; snap.resourceLoss = Math.round(d.losses.resourceRatio * 100); }
  if (snap.resource && data.resources.meta[snap.resource]) snap.resource = data.resources.meta[snap.resource].name;
  return snap;
}

export { templateText };
