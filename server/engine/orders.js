// 논리 회로 DSL — 파서 / 직렬화 / 평가 / 클라 AST 어댑터
// Order     := "IF" Condition "THEN" Action
// Condition := Term (("AND"|"OR") Term)*        (좌결합, 괄호 허용)
//
// ★ 전송(=저장) AST 형식은 docs/PROTOCOL.md 가 정본이며 클라 편집기 형식을 따른다:
//     비교  {type:'cmp', metric, op, value}
//     논리  {type:'and'|'or', children:[...]}     (좌결합으로 2개씩 접는다)
//   서버 내부 파서(parseOrder)는 {type:'term'} / {type:'logic', op, left, right} 를 만들지만,
//   normalizeCondition/toWireCondition 이 양방향으로 변환하고 evaluate/stringify 는 둘 다 받는다.
// Term      := Metric Op Value
// Metric    := resource.{grain|wood|stone|ironOre|oil|steel|fuel} | gold
//            | invasion.daysUntil | tick | population | defense.total
// Op        := > >= < <= ==
// TODO(기획): TRANSFER 는 '해당 자원을 시장에 출하(매도)'로 해석했다.
//            원안의 TRANSFER(to=외교관, exchangeFor=철광석) 형태(물물교환 지정)를 살릴지 확정 필요.
// Action    := TRANSFER(resource, amount|surplus) | CONVERT(output) | QUEUE_SWITCH(output)
//            | TRADE(side, resource, amount) | DEFEND(allocPct)

export const METRICS = [
  'resource.grain', 'resource.wood', 'resource.stone', 'resource.ironOre',
  'resource.oil', 'resource.steel', 'resource.fuel',
  'gold', 'invasion.daysUntil', 'tick', 'population', 'defense.total',
];
export const OPS = ['>=', '<=', '==', '>', '<'];
export const ACTIONS = ['TRANSFER', 'CONVERT', 'QUEUE_SWITCH', 'TRADE', 'DEFEND'];
export const CONVERT_OUTPUTS = ['steel', 'fuel', 'weapon'];
export const TRADE_SIDES = ['buy', 'sell'];

export class OrderSyntaxError extends Error {
  constructor(message, pos) { super(message); this.name = 'OrderSyntaxError'; this.pos = pos; }
}

function tokenize(src) {
  const tokens = [];
  const re = /\s*([A-Za-z_][A-Za-z0-9_.]*|>=|<=|==|>|<|\(|\)|,|-?\d+(?:\.\d+)?)/y;
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) {
      if (/^\s+$/.test(src.slice(i))) break;
      throw new OrderSyntaxError(`알 수 없는 문자: "${src[i]}"`, i);
    }
    tokens.push({ value: m[1], pos: m.index });
    i = re.lastIndex;
  }
  return tokens;
}

class Parser {
  constructor(tokens) { this.t = tokens; this.i = 0; }
  peek() { return this.t[this.i]?.value; }
  next() { return this.t[this.i++]?.value; }
  expect(v) {
    const got = this.next();
    if (String(got).toUpperCase() !== v) throw new OrderSyntaxError(`"${v}" 가 필요합니다 (받은 값: ${got ?? 'EOF'})`, this.i);
    return got;
  }
  atEnd() { return this.i >= this.t.length; }
}

function parseTerm(p) {
  if (p.peek() === '(') {
    p.next();
    const inner = parseCondition(p);
    if (p.peek() !== ')') throw new OrderSyntaxError('")" 가 필요합니다', p.i);
    p.next();
    return inner;
  }
  const metric = p.next();
  if (!METRICS.includes(metric)) throw new OrderSyntaxError(`알 수 없는 지표: ${metric}`, p.i);
  const op = p.next();
  if (!OPS.includes(op)) throw new OrderSyntaxError(`알 수 없는 연산자: ${op}`, p.i);
  const raw = p.next();
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new OrderSyntaxError(`숫자가 필요합니다: ${raw}`, p.i);
  return { type: 'term', metric, op, value };
}

function parseCondition(p) {
  let left = parseTerm(p);
  for (;;) {
    const nx = p.peek();
    const up = nx ? String(nx).toUpperCase() : null;
    if (up !== 'AND' && up !== 'OR') break;
    p.next();
    const right = parseTerm(p);
    left = { type: 'logic', op: up, left, right };
  }
  return left;
}

function parseAction(p) {
  const name = String(p.next() ?? '').toUpperCase();
  if (!ACTIONS.includes(name)) throw new OrderSyntaxError(`알 수 없는 액션: ${name}`, p.i);
  if (p.peek() !== '(') throw new OrderSyntaxError('"(" 가 필요합니다', p.i);
  p.next();
  const args = [];
  while (p.peek() !== ')') {
    if (p.atEnd()) throw new OrderSyntaxError('")" 가 필요합니다', p.i);
    const v = p.next();
    if (v !== ',') args.push(v);
  }
  p.next();
  return buildAction(name, args, p);
}

function buildAction(name, args, p) {
  const err = (m) => { throw new OrderSyntaxError(m, p?.i ?? 0); };
  switch (name) {
    case 'TRANSFER': {
      const [resource, amount] = args;
      if (!METRICS.includes(`resource.${resource}`)) err(`TRANSFER: 알 수 없는 자원 ${resource}`);
      const amt = amount === 'surplus' ? 'surplus' : Number(amount);
      if (amt !== 'surplus' && !Number.isFinite(amt)) err('TRANSFER: amount 는 숫자 또는 surplus');
      return { type: 'TRANSFER', args: { resource, amount: amt } };
    }
    case 'CONVERT':
    case 'QUEUE_SWITCH': {
      const [output] = args;
      if (!CONVERT_OUTPUTS.includes(output)) err(`${name}: output 은 ${CONVERT_OUTPUTS.join('|')}`);
      return { type: name, args: { output } };
    }
    case 'TRADE': {
      const [side, resource, amount] = args;
      if (!TRADE_SIDES.includes(side)) err('TRADE: side 는 buy|sell');
      if (!METRICS.includes(`resource.${resource}`)) err(`TRADE: 알 수 없는 자원 ${resource}`);
      // 클라 편집기의 '잉여 전부'(surplus) 를 수용한다. buy 에는 잉여 개념이 없으므로 숫자만 받는다.
      if (amount === 'surplus') {
        if (side !== 'sell') err('TRADE: surplus 는 sell 에서만 쓸 수 있습니다');
        return { type: 'TRADE', args: { side, resource, amount: 'surplus' } };
      }
      const amt = Number(amount);
      if (!Number.isFinite(amt)) err('TRADE: amount 는 숫자 또는 surplus');
      return { type: 'TRADE', args: { side, resource, amount: amt } };
    }
    case 'DEFEND': {
      const [pct] = args;
      const raw = Number(pct);
      if (!Number.isFinite(raw)) err('DEFEND: allocPct 는 숫자(0~1 비율, 0~100 이면 %로 간주)');
      if (raw < 0 || raw > 100) err('DEFEND: allocPct 는 0~1(비율) 또는 0~100(%) 범위여야 합니다');
      // 클라 편집기는 40(%) 처럼 퍼센트로 보낸다 → 0~1 비율로 정규화한다.
      const v = raw > 1 ? raw / 100 : raw;
      return { type: 'DEFEND', args: { allocPct: Math.round(v * 1000) / 1000 } };
    }
    default:
      return err(`알 수 없는 액션: ${name}`);
  }
}

/** 텍스트 → AST */
export function parseOrder(src) {
  const p = new Parser(tokenize(src));
  p.expect('IF');
  const condition = parseCondition(p);
  p.expect('THEN');
  const action = parseAction(p);
  if (!p.atEnd()) throw new OrderSyntaxError('구문 뒤에 남은 토큰이 있습니다', p.i);
  return { type: 'order', condition, action };
}

/** AST → 텍스트 (왕복 안정) */
export function stringifyOrder(ast) {
  return `IF ${stringifyCondition(ast.condition)} THEN ${stringifyAction(ast.action)}`;
}

/** 조건 노드 분해 — 내부 형식({term|logic})과 전송 형식({cmp|and|or}) 을 모두 읽는다. */
export function conditionParts(c) {
  if (!c || typeof c !== 'object') return null;
  const t = String(c.type ?? '').toLowerCase();
  if (t === 'and' || t === 'or' || t === 'logic') {
    const op = String(c.op ?? t).toUpperCase();
    const children = Array.isArray(c.children) ? c.children
      : Array.isArray(c.terms) ? c.terms
      : Array.isArray(c.nodes) ? c.nodes
      : [c.left, c.right].filter((x) => x != null);
    return { kind: 'logic', op: op === 'OR' ? 'OR' : 'AND', children };
  }
  if (t === 'term' || t === 'cmp' || (c.metric && c.op)) {
    return { kind: 'cmp', metric: c.metric, op: c.op, value: c.value };
  }
  return null;
}

export function stringifyCondition(c) {
  const p = conditionParts(c);
  if (!p) throw new OrderSyntaxError('알 수 없는 조건 노드입니다');
  if (p.kind === 'cmp') return `${p.metric} ${p.op} ${p.value}`;
  // 연산자가 다른 하위 논리 노드는 괄호로 묶는다 — 텍스트를 다시 파싱해도 같은 AST 가 나오게(좌결합 DSL)
  return p.children.map((child) => {
    const cp = conditionParts(child);
    const text = stringifyCondition(child);
    return cp && cp.kind === 'logic' && cp.op !== p.op ? `(${text})` : text;
  }).join(` ${p.op} `);
}

/** 어떤 형식이든 → 내부 형식({type:'term'} / {type:'logic',left,right}) 으로 정규화 (좌결합) */
export function normalizeCondition(c) {
  const p = conditionParts(c);
  if (!p) throw new OrderSyntaxError('알 수 없는 조건 노드입니다');
  if (p.kind === 'cmp') {
    if (!METRICS.includes(p.metric)) throw new OrderSyntaxError(`알 수 없는 지표: ${p.metric}`);
    if (!OPS.includes(p.op)) throw new OrderSyntaxError(`알 수 없는 연산자: ${p.op}`);
    const value = Number(p.value);
    if (!Number.isFinite(value)) throw new OrderSyntaxError(`숫자가 필요합니다: ${p.value}`);
    return { type: 'term', metric: p.metric, op: p.op, value };
  }
  if (!p.children.length) throw new OrderSyntaxError('논리 노드에 항이 없습니다');
  return p.children.map(normalizeCondition).reduce((left, right) => ({ type: 'logic', op: p.op, left, right }));
}

/** 내부 형식 → 전송(저장) 형식. docs/PROTOCOL.md 의 ordersSet AST 가 이것이다. */
export function toWireCondition(c) {
  const p = conditionParts(c);
  if (!p) throw new OrderSyntaxError('알 수 없는 조건 노드입니다');
  if (p.kind === 'cmp') return { type: 'cmp', metric: p.metric, op: p.op, value: Number(p.value) };
  return p.children.map(toWireCondition)
    .reduce((a, b) => ({ type: p.op === 'OR' ? 'or' : 'and', children: [a, b] }));
}

export function stringifyAction(a) {
  switch (a.type) {
    case 'TRANSFER': return `TRANSFER(${a.args.resource}, ${a.args.amount})`;
    case 'CONVERT': return `CONVERT(${a.args.output})`;
    case 'QUEUE_SWITCH': return `QUEUE_SWITCH(${a.args.output})`;
    case 'TRADE': return `TRADE(${a.args.side}, ${a.args.resource}, ${a.args.amount})`;
    case 'DEFEND': return `DEFEND(${a.args.allocPct})`;
    default: throw new OrderSyntaxError(`직렬화 불가 액션: ${a.type}`);
  }
}

export function metricValue(metric, ctx) {
  if (metric.startsWith('resource.')) return ctx.resources?.[metric.slice(9)] ?? 0;
  switch (metric) {
    case 'gold': return ctx.gold ?? 0;
    case 'tick': return ctx.tick ?? 0;
    case 'population': return ctx.population ?? 0;
    case 'defense.total': return ctx.defenseTotal ?? 0;
    case 'invasion.daysUntil': return ctx.invasionDaysUntil ?? 999;
    default: return 0;
  }
}

export function evaluateCondition(cond, ctx) {
  const p = conditionParts(cond);
  if (!p) return false;
  if (p.kind === 'logic') {
    return p.op === 'AND'
      ? p.children.every((c) => evaluateCondition(c, ctx))
      : p.children.some((c) => evaluateCondition(c, ctx));
  }
  const v = metricValue(p.metric, ctx);
  switch (p.op) {
    case '>': return v > p.value;
    case '>=': return v >= p.value;
    case '<': return v < cond.value;
    case '<=': return v <= p.value;
    case '==': return v === cond.value;
    default: return false;
  }
}

/** 저장된 오더 목록 → 이번 틱에 발동할 액션 목록. priority 내림차순, 자원 이동 상한 적용. */
export function selectActions(orders, ctx, data) {
  const limit = data.balance.orders.maxResourceMovesPerTick;
  const moves = new Map();
  const fired = [];
  const sorted = [...(orders || [])]
    .filter((o) => o.enabled !== false && o.condition && o.action)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  for (const o of sorted) {
    let ok;
    try { ok = evaluateCondition(o.condition, ctx); } catch { ok = false; }
    if (!ok) continue;
    const res = o.action.args?.resource;
    if (res) {
      const used = moves.get(res) ?? 0;
      if (used >= limit) continue;
      moves.set(res, used + 1);
    }
    fired.push(o);
  }
  return fired;
}

export function validateOrders(orders, data) {
  const max = data.balance.orders.maxOrders;
  if (!Array.isArray(orders)) throw new OrderSyntaxError('orders 는 배열이어야 합니다');
  if (orders.length > max) throw new OrderSyntaxError(`오더는 최대 ${max}개까지입니다`);
  return orders.map((o, idx) => {
    // AST 가 오면 AST 를 정본으로 쓰고, 없으면 클라가 함께 실어 보낸 text DSL 원문을 파싱한다.
    let ast;
    if (o?.condition && o?.action) ast = { type: 'order', condition: o.condition, action: normalizeActionShape(o.action) };
    else if (typeof o?.text === 'string') ast = parseOrder(o.text);
    else throw new OrderSyntaxError(`오더 ${idx + 1}: condition/action 또는 text 가 필요합니다`);
    if (!ast.condition || !ast.action) throw new OrderSyntaxError(`오더 ${idx + 1}: condition/action 누락`);
    // 조건·액션 모두 서버에서 재검증한다 (클라 신뢰 금지)
    const condition = normalizeCondition(ast.condition);
    const action = buildAction(String(ast.action.type ?? '').toUpperCase(), actionArgsToList(ast.action));
    const normalized = { type: 'order', condition, action };
    return {
      id: o.id ?? `order_${idx + 1}`,
      priority: Number(o.priority ?? 0),
      condition: toWireCondition(condition),   // 저장·전송은 PROTOCOL 형식(cmp/and/or)
      action,
      enabled: o.enabled !== false,
      text: stringifyOrder(normalized),
    };
  });
}

/** 클라가 {type:'TRADE', args:{...}} 형태로 보낸다. kind/params 같은 변형도 받아준다. */
function normalizeActionShape(a) {
  if (typeof a === 'string') return { type: a.toUpperCase(), args: {} };
  return { type: String(a.type ?? a.kind ?? '').toUpperCase(), args: a.args ?? a.params ?? {} };
}

function actionArgsToList(action) {
  const a = action.args || action.params || {};
  switch (String(action.type ?? '').toUpperCase()) {
    case 'TRANSFER': return [a.resource, a.amount];
    case 'CONVERT':
    case 'QUEUE_SWITCH': return [a.output];
    case 'TRADE': return [a.side, a.resource, a.amount];
    case 'DEFEND': return [a.allocPct];
    default: return [];
  }
}
