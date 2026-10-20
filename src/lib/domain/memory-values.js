/**
 * 记忆的“编码强度”与“可信度”规则（domain，纯函数）。
 * importance：编码时的重要性（显式保存 > 偏好/事实 > 闲聊）
 * confidence：这条信念的可信度（用户明确 > 抽取事实 > 普通对话）
 */
const IMPORTANCE_BY_KIND = {
  preference: 0.8,
  fact: 0.75,
  project: 0.75,
  note: 0.6,
  event: 0.8,
  summary: 0.65,
  image: 0.5,
  turn: 0.4,
}

const CONFIDENCE_BY_KIND = {
  preference: 0.8,
  fact: 0.8,
  project: 0.75,
  note: 0.7,
  event: 0.7,
  summary: 0.7,
  image: 0.7,
  turn: 0.6,
}

/** 默认重要性（0~1）。 */
export function defaultImportance(kind) {
  return IMPORTANCE_BY_KIND[String(kind ?? '')] ?? 0.5
}

/** 默认置信度（0~1）。 */
export function defaultConfidence(kind) {
  return CONFIDENCE_BY_KIND[String(kind ?? '')] ?? 0.6
}

/** 把任意值规范到 0~1，非法时回退。 */
export function normalizeUnit(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

/** 规范 importance（缺省按 kind 推断）。 */
export function normalizeImportance(value, kind) {
  return normalizeUnit(value, defaultImportance(kind))
}

/** 规范 confidence（缺省按 kind 推断）。 */
export function normalizeConfidence(value, kind) {
  return normalizeUnit(value, defaultConfidence(kind))
}

/** 显式保存的编码强度。 */
export const MANUAL_SAVE = { importance: 1, confidence: 0.9 }
