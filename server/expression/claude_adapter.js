// Claude API 어댑터 — ANTHROPIC_API_KEY 가 있을 때만 동작. 5초 타임아웃 후 템플릿 폴백.
// LLM 은 수치·상태를 만들지 않는다. 사실 스냅샷(JSON)을 받아 표시용 텍스트만 돌려준다 (기획 §10-2).

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const TIMEOUT_MS = Number(process.env.EXPRESSION_TIMEOUT_MS || 5000);

export function isEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM = [
  '너는 국가 경영·디펜스 게임 「Regiond」의 궁정 서기다.',
  '주어진 JSON 사실만으로 한국어 한두 문장을 쓴다.',
  '수치를 새로 만들지 말고, 주어진 값만 인용한다. 과장하지 않는다.',
  '결과 텍스트만 출력한다. 따옴표·머리말·설명을 붙이지 않는다.',
].join(' ');

/**
 * @param {object} opts.hint ★ §20-R1.5 — 그 자리에만 얹는 한 줄 지시(유물 발견 서사 등).
 *   체계 문장은 그대로 두고 뒤에 붙인다 — 규칙(사실만·수치 창작 금지)은 어떤 부름에도 살아 있어야 한다.
 */
export async function expressWithClaude(eventSnapshot, { quality = 1, hint = '' } = {}) {
  if (!isEnabled()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: quality > 1 ? 200 : 120,
        system: hint ? `${SYSTEM} ${hint}` : SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(eventSnapshot) }],
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text = (json.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ').trim();
    return text || null;
  } catch {
    return null; // 타임아웃·네트워크 실패 → 템플릿 폴백
  } finally {
    clearTimeout(timer);
  }
}
