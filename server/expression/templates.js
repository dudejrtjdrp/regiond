// 템플릿 표현 계층 — 기본값. LLM 없이도 항상 문장이 나온다.
import { loadGameData } from '../engine/data.js';

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

export function renderTemplate(tpl, snapshot) {
  return tpl.replace(PLACEHOLDER, (_, key) => {
    const v = snapshot?.[key];
    if (v == null) return '';
    if (typeof v === 'number') return String(Math.round(v * 100) / 100);
    return String(v);
  }).replace(/\s{2,}/g, ' ').trim();
}

/** 이벤트 kind 에 맞는 변형 하나를 고른다. rng 없으면 tick 기반 결정론적 선택. */
export function templateText(kind, snapshot = {}, data = loadGameData(), rng = null) {
  const pool = data.templates.templates[kind] || data.templates.fallback;
  if (!pool?.length) return '';
  const idx = rng ? Math.floor(rng.next() * pool.length)
    : Math.abs(hash(`${kind}:${snapshot.tick ?? 0}:${snapshot.nationId ?? ''}`)) % pool.length;
  return renderTemplate(pool[idx], snapshot);
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}

export function hasTemplate(kind, data = loadGameData()) {
  return Boolean(data.templates.templates[kind]);
}
