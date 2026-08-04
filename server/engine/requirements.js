// 조건 한 줄의 **단일 정본** — docs/GDD3.md §13-A-1.
//
// 왜 이 파일이 생겼나.
//   "곡물 46을 들고 있는데 정착지 패널은 곡물 12/20 이라고 한다."
//   실측해 보니 서버 계산은 늘 옳았다. 어긋난 것은 **언제 쟀느냐**다.
//   스윙(actionSwing)은 실시간 명령이라 뷰를 다시 만들지 않는다. 창고 숫자는 ack 로 즉시
//   갱신되지만 tier.next.reqs 는 하루 전 뷰에 박힌 채 남는다 — 최대 한 게임일(10분) 동안.
//
// 그래서 두 가지를 못박는다.
//   ① have 는 어디서든 **이 파일의 읽기 함수 하나로만** 잰다. 티어 조건·유입 조건·장 목표가
//      각자 nation.resources 를 더듬던 것을 끝낸다.
//   ② 행은 **스스로를 설명한다**(kind + resource/building). 화면이 key 문자열을 뜯어보지 않고
//      지금 장부로 have 를 다시 잴 수 있다 — 클라 쪽 단일 정본(state.js reqLive)의 재료다.
//
// 규칙 하나 더: ok 와 have 는 **같은 값에서 나온다**. 예전에는 ok 가 소수 원본(19.6 >= 20),
// have 는 버림값(19)이라 "20/20 인데 단추가 꺼져 있다"가 날 수 있었다. 이제 둘 다 버림값을 본다.

/** 자릿수 버림 — 조건 행이 올림으로 부풀어 "다 찼는데 안 된다"를 만들지 않게 한다 */
const floorTo = (v, dec) => {
  const p = 10 ** (dec || 0);
  return Math.floor(v * p) / p;
};

// ────────────────────────────────────────────────────────────────
// 읽기 — 국고·건물·인구의 **유일한** 계측 지점
// ────────────────────────────────────────────────────────────────
/** 국고 실측. 조건 행의 have 는 예외 없이 여기서 나온다. */
export function haveResource(nation, resource) {
  const v = Number(nation?.resources?.[resource]);
  return Number.isFinite(v) ? v : 0;
}

/** 완공된 건물 수 */
export function haveStructures(nation, key) {
  return (nation?.structures || []).filter((s) => s.key === key).length;
}

/** 실인원 */
export function havePopulation(nation) {
  return Math.floor(nation?.population || 0);
}

// ────────────────────────────────────────────────────────────────
// 조립 — 행 한 줄
// ────────────────────────────────────────────────────────────────
/**
 * 조건 행 하나.
 * @returns {{key,kind,ok,have,need,text,dec,unit?,detail?,resource?,building?}}
 */
function row({ key, kind, raw, need, text, dec = 0, unit, detail, resource, building }) {
  const have = floorTo(raw, dec);
  const out = { key, kind, ok: have >= need, need, have, text, dec };
  if (unit != null) out.unit = unit;
  if (detail != null) out.detail = detail;
  if (resource != null) out.resource = resource;
  if (building != null) out.building = building;
  return out;
}

/** 자원 조건 — 「곡물 20」 */
export function resourceReq(nation, resource, amount, data, opts = {}) {
  return row({
    key: opts.key ?? `resource:${resource}`,
    kind: 'resource',
    resource,
    raw: haveResource(nation, resource),
    need: amount,
    dec: opts.dec ?? 0,
    text: opts.text ?? `${data?.resources?.meta?.[resource]?.name ?? resource} ${amount}`,
    unit: opts.unit,
    detail: opts.detail,
  });
}

/** 건물 조건 — 「오두막 1채」 */
export function structureReq(nation, building, count, data, opts = {}) {
  return row({
    key: opts.key ?? `structure:${building}`,
    kind: 'structure',
    building,
    raw: haveStructures(nation, building),
    need: count,
    text: opts.text ?? `${data?.buildings?.[building]?.name ?? building} ${count}채`,
    unit: opts.unit,
    detail: opts.detail,
  });
}

/** 인구 조건 — 「주민 5명」 */
export function populationReq(nation, count, opts = {}) {
  return row({
    key: opts.key ?? 'population',
    kind: 'population',
    raw: havePopulation(nation),
    need: count,
    text: opts.text ?? `주민 ${count}명`,
    unit: opts.unit,
    detail: opts.detail,
  });
}

/**
 * 셈으로 재지만 국고와 무관한 행(빈 잠자리·소문 따위).
 * 화면은 이 종류를 다시 재지 않고 서버 값을 그대로 믿는다.
 */
export function countReq({ key, have, need, text, unit, detail, dec = 0 }) {
  return row({ key, kind: 'count', raw: have, need, text, unit, detail, dec });
}
