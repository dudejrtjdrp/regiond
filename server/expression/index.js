// 표현 계층 — 비동기 큐. 게임 진행을 절대 막지 않는다 (기획 §10-2 / SPEC §12).
import { loadGameData } from '../engine/data.js';
import { templateText } from './templates.js';
import { expressWithClaude, isEnabled } from './claude_adapter.js';

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
    const decorated = { ...event, text, source: 'template' };
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
      expressWithClaude({ kind: job.event.kind, ...job.snapshot }, { quality: job.quality })
        .then((text) => {
          if (text) this.onText({ ...job.event, text, source: 'llm' }, job.nationId);
        })
        .catch(() => {})
        .finally(() => { this.running -= 1; this.#drain(); });
    }
  }

  get pending() { return this.queue.length + this.running; }
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
