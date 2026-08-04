// 캐릭터 외형 + 채팅 — docs/WORLD.md §12 (멀티플레이 중심).
// ★ 외형은 '에셋 파일 없는 절차 도트 스프라이트'의 레이어 인덱스다. 서버는 범위만 검증해 저장·중계하고,
//   실제 팔레트 스왑 렌더는 클라의 몫이다. 채팅은 릴레이 — 서버 상태(경제·전투)에 영향이 없다.
export const appearanceCfg = (data) => data.world.appearance;
export const chatCfg = (data) => data.world.chat;

/** 외형 필드 목록 (skin·hair·hairColor·outfit·outfitColor) */
export function appearanceFields(data) {
  return Object.keys(appearanceCfg(data).fields);
}

/** 기본 외형 — 아무것도 안 고른 접속자용 */
export function defaultAppearance(data) {
  return { ...appearanceCfg(data).default };
}

/**
 * 외형 검증·정규화.
 * 범위를 벗어나거나 숫자가 아니면 그 칸만 기본값으로 되돌린다(전체 거부 금지 — 접속을 막지 않기 위함).
 * @returns {{appearance, invalid:[field]}}
 */
export function normalizeAppearance(input, data, base = null) {
  const cfg = appearanceCfg(data);
  const out = { ...(base ?? cfg.default) };
  const invalid = [];
  if (input && typeof input === 'object') {
    for (const [field, spec] of Object.entries(cfg.fields)) {
      if (!(field in input)) continue;
      const v = Number(input[field]);
      if (!Number.isInteger(v) || v < 0 || v >= spec.count) { invalid.push(field); continue; }
      out[field] = v;
    }
  }
  return { appearance: out, invalid };
}

/** 엄격 검증 — setAppearance 는 잘못된 값을 조용히 삼키지 않고 알려 준다 */
export function validateAppearance(input, data) {
  const cfg = appearanceCfg(data);
  if (!input || typeof input !== 'object') {
    return { ok: false, error: { code: 'BAD_APPEARANCE', message: '외형 값이 없습니다.' } };
  }
  for (const [field, v] of Object.entries(input)) {
    const spec = cfg.fields[field];
    if (!spec) return { ok: false, error: { code: 'BAD_APPEARANCE_FIELD', message: `알 수 없는 외형 항목: ${field}` } };
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n >= spec.count) {
      return { ok: false, error: { code: 'BAD_APPEARANCE_RANGE', message: `${spec.name ?? field}은(는) 0~${spec.count - 1} 사이여야 합니다.` } };
    }
  }
  return { ok: true };
}

/** 이름표용 요약 — 명부·말풍선·아바타에 함께 실린다 */
export function appearanceSummary(entry, data) {
  const { appearance } = normalizeAppearance(entry?.appearance, data);
  return appearance;
}

// ────────────────────────────────────────────────────────────────
// 접속자 명부 (§12) — 한 국가 1~5인 협동이 기본 시나리오다.
// 문자열 배열로 저장된 옛 스냅샷도 받아준다(하위 호환).
// ────────────────────────────────────────────────────────────────
function memberKey(m) {
  return (typeof m === 'string' ? m : (m.avatarId ?? m.name)) ?? null;
}

export function findMember(nation, key) {
  if (key == null) return null;
  const list = nation?.members || [];
  for (let i = 0; i < list.length; i += 1) {
    if (typeof list[i] === 'string') {
      if (list[i] === key) return { index: i, entry: { name: list[i], avatarId: list[i], role: null, online: false } };
      continue;
    }
    if (memberKey(list[i]) === key || list[i].name === key) return { index: i, entry: list[i] };
  }
  return null;
}

/** 그 접속자의 외형(없으면 기본값) */
export function memberAppearance(nation, key, data) {
  const found = findMember(nation, key);
  const raw = found?.entry?.appearance ?? nation?.avatars?.[key]?.appearance ?? null;
  return normalizeAppearance(raw, data).appearance;
}

/** 명부 upsert — role/online/appearance/bot 중 준 것만 갱신한다 */
export function upsertMember(nation, { avatarId, name, role, online, appearance, bot } = {}, data = null) {
  if (!nation) return null;
  const list = (nation.members ||= []);
  for (let i = 0; i < list.length; i += 1) {
    if (typeof list[i] === 'string') list[i] = { avatarId: list[i], name: list[i], role: null, online: false };
  }
  const key = avatarId ?? name;
  const found = findMember(nation, key);
  const look = appearance != null && data ? normalizeAppearance(appearance, data).appearance : undefined;
  if (found) {
    const e = found.entry;
    e.avatarId = e.avatarId ?? key;
    if (name != null) e.name = name;
    if (role !== undefined) e.role = role ?? e.role ?? null;
    if (online !== undefined) e.online = Boolean(online);
    if (look !== undefined) e.appearance = look;
    // ★ GDD3 §15-C — 이 자리의 주인이 사람인가 동료인가. 명부·이름표가 이 값으로 색을 가른다.
    if (bot !== undefined) e.bot = Boolean(bot);
    return e;
  }
  const entry = {
    avatarId: key ?? '플레이어',
    name: name ?? key ?? '플레이어',
    role: role ?? null,
    online: Boolean(online),
    bot: Boolean(bot),
    appearance: look ?? (data ? defaultAppearance(data) : null),
  };
  list.push(entry);
  return entry;
}

/** NationView.nation.members — 아바타 미니 초상(appearance)까지 함께 간다 */
export function normalizeMembers(nation, data = null) {
  return (nation?.members || []).map((m) => {
    if (typeof m === 'string') {
      return {
        avatarId: m, name: m, role: null, online: Boolean(nation.online), bot: false,
        appearance: data ? defaultAppearance(data) : null,
      };
    }
    return {
      avatarId: m.avatarId ?? m.name ?? null,
      name: m.name ?? '플레이어',
      role: m.role ?? null,
      online: Boolean(m.online),
      bot: Boolean(m.bot),
      appearance: data ? normalizeAppearance(m.appearance, data).appearance : (m.appearance ?? null),
    };
  });
}

// ────────────────────────────────────────────────────────────────
// 채팅 (§12) — 릴레이. 최소 새니타이즈 + 길이 제한.
// ────────────────────────────────────────────────────────────────
/**
 * 채팅 새니타이즈.
 *  - 제어문자 제거(줄바꿈 포함 — 한 줄 말풍선)
 *  - `<`, `>`, `&` 를 실체 참조로 (클라가 innerHTML 로 그려도 안전하게)
 *  - 공백 압축 + 앞뒤 트림 + maxLength 자르기
 */
export function sanitizeChat(text, data) {
  const cfg = chatCfg(data);
  if (typeof text !== 'string') return '';
  let s = text.replace(/[\u0000-\u001f\u007f]/g, ' ');
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > cfg.maxLength) s = s.slice(0, cfg.maxLength);
  return s;
}

/**
 * 채팅 메시지 만들기 + 로그 적재.
 * @returns {{ok:true, message}|{ok:false,error}}
 */
export function pushChat(world, nation, { text, name, avatarId, appearance }, data) {
  const cfg = chatCfg(data);
  const clean = sanitizeChat(text, data);
  if (!clean) return { ok: false, error: { code: 'EMPTY_CHAT', message: '보낼 말이 없습니다.' } };
  const message = {
    id: `c${(world.chatSeq = (world.chatSeq || 0) + 1)}`,
    tick: world.tick,
    nationId: nation?.id ?? world.playerNationId,
    from: {
      avatarId: avatarId ?? name ?? 'lord',
      name: sanitizeChat(name ?? '군주', data) || '군주',
      appearance: appearanceSummary({ appearance }, data),
    },
    text: clean,
    at: Date.now(),
  };
  const log = (world.chat ||= []);
  log.push(message);
  if (log.length > cfg.historyMax) log.splice(0, log.length - cfg.historyMax);
  return { ok: true, message };
}

/** join 직후 보내 줄 최근 대화 */
export function chatHistory(world, data) {
  const cfg = chatCfg(data);
  return (world.chat || []).slice(-cfg.joinHistory);
}

/** /api/config 공개본 — 팔레트·스타일 수. 클라의 캐릭터 생성 화면이 이걸로 그린다. */
export function publicAppearance(data) {
  const cfg = appearanceCfg(data);
  return {
    fields: Object.fromEntries(Object.entries(cfg.fields).map(([k, v]) => [k, {
      name: v.name, count: v.count,
      palette: v.palette ? [...v.palette] : null,
      styles: v.styles ? [...v.styles] : null,
    }])),
    default: { ...cfg.default },
    nameMaxLength: cfg.nameMaxLength,
  };
}

export function publicChat(data) {
  const cfg = chatCfg(data);
  return { maxLength: cfg.maxLength, historyMax: cfg.historyMax, joinHistory: cfg.joinHistory, cooldownMs: cfg.cooldownMs };
}
