/**
 * 动态相关度召回策略（domain，纯函数）：
 * - freshness = exp(-ageDays / τ_level)（分层遗忘速度）
 * - required  = base + strictness × (1 - freshness)（越久越严格）
 * - effective = sim + 重要性/有效复述/置信度补偿
 * - 通过条件：effective >= required
 * - rank = sim×(0.5+0.5×freshness) + 0.15×importance + 0.10×rehearsal + 0.05×confidence
 *
 * 纯函数：now、参数、事件都由调用方传入，便于测试与回放。
 */
import { normalizeUnit } from './memory-values.js'

/** 默认参数（与 docs/MEMORY-FLOW.md 一致）。 */
export const RECALL_POLICY_DEFAULTS = {
  enabled: true,
  baseMinScore: 0.42,
  toolBaseMinScore: 0.3,
  strictness: 0.35,
  toolStrictness: 0.2,
  maxRequired: 0.9,
  weightImportance: 0.2,
  weightRehearsal: 0.15,
  weightConfidence: 0.1,
  decayTauDays: { 0: 7, 1: 30, 2: 180, 3: 365 },
  rehearsalTauDays: 90,
  rehearsalMaxEvents: 20,
  candidates: 20,
}

const DAY_MS = 86400000
const LN_11 = Math.log(11)

/** 记忆年龄（天）：优先内容发生时间 anchorTs，其次 ts。 */
export function ageDays(now, hit) {
  const anchor = Number(hit?.anchorTs) || Number(hit?.ts) || now
  return Math.max(0, (now - anchor) / DAY_MS)
}

/** 分层遗忘速度（天）。 */
export function decayTauDays(level, taus = RECALL_POLICY_DEFAULTS.decayTauDays) {
  const key = Number(level) || 0
  return Number(taus?.[key]) > 0 ? Number(taus[key]) : RECALL_POLICY_DEFAULTS.decayTauDays[key] ?? 7
}

/** freshness = exp(-age/τ)，越久越接近 0。 */
export function freshness(age, tauDays) {
  const tau = Number(tauDays) > 0 ? Number(tauDays) : 1
  return Math.exp(-Math.max(0, age) / tau)
}

/** 动态门槛：required = base + strictness×(1-freshness)，带上限 clamp。 */
export function requiredScore({ baseMinScore, strictness, freshness: fresh, maxRequired }) {
  const base = Number.isFinite(Number(baseMinScore)) ? Number(baseMinScore) : RECALL_POLICY_DEFAULTS.baseMinScore
  const strict = Number.isFinite(Number(strictness)) ? Number(strictness) : RECALL_POLICY_DEFAULTS.strictness
  const max = Number.isFinite(Number(maxRequired)) ? Number(maxRequired) : RECALL_POLICY_DEFAULTS.maxRequired
  const value = base + strict * (1 - normalizeUnit(fresh, 0))
  return Math.min(max, Math.max(base, value))
}

/** 有效复述：Σ 分类权重 × exp(-(now-eventAt)/τ_rehearse)；被动曝光不进入。 */
export function effectiveHits(events, now, tauDays = RECALL_POLICY_DEFAULTS.rehearsalTauDays) {
  if (!Array.isArray(events) || events.length === 0) return 0
  const tau = Number(tauDays) > 0 ? Number(tauDays) : RECALL_POLICY_DEFAULTS.rehearsalTauDays
  let total = 0
  for (const event of events) {
    const weight = Number(event?.weight)
    const at = Number(event?.at)
    if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(at)) continue
    total += weight * Math.exp(-Math.max(0, now - at) / (tau * DAY_MS))
  }
  return total
}

/** 复述补偿（对数增长，封顶 1）。 */
export function rehearsalBoost(hits, weight = RECALL_POLICY_DEFAULTS.weightRehearsal) {
  const value = Math.max(0, Number(hits) || 0)
  return weight * Math.min(1, Math.log1p(value) / LN_11)
}

/**
 * 给一条候选计算动态门控与排序分。
 * @returns {object} 附带 freshness/required/effective/rank/passed 的新 hit
 */
export function evaluateHit(hit, options, now) {
  const policy = { ...RECALL_POLICY_DEFAULTS, ...(options ?? {}) }
  const mode = options?.mode === 'tool' ? 'tool' : 'auto'
  const level = Number(hit?.level) || 0
  const age = ageDays(now, hit)
  const tau = decayTauDays(level, policy.decayTauDays)
  const fresh = freshness(age, tau)
  const baseMinScore = mode === 'tool' ? policy.toolBaseMinScore : policy.baseMinScore
  const strictness = mode === 'tool' ? policy.toolStrictness : policy.strictness
  const required = requiredScore({ baseMinScore, strictness, freshness: fresh, maxRequired: policy.maxRequired })
  const importance = normalizeUnit(hit?.importance, 0.5)
  const confidence = normalizeUnit(hit?.confidence, 0.5)
  const hits = effectiveHits(hit?.accessEvents, now, policy.rehearsalTauDays)
  const importanceBoost = policy.weightImportance * (importance - 0.5)
  const confidenceBoost = policy.weightConfidence * (confidence - 0.5)
  const rehBoost = rehearsalBoost(hits, policy.weightRehearsal)
  const sim = Number(hit?.score) || 0
  const effective = sim + importanceBoost + rehBoost + confidenceBoost
  const rank = sim * (0.5 + 0.5 * fresh) + 0.15 * importance + 0.1 * rehBoost + 0.05 * confidence
  return {
    ...hit,
    ageDays: Number(age.toFixed(3)),
    freshness: Number(fresh.toFixed(4)),
    requiredScore: Number(required.toFixed(4)),
    effectiveScore: Number(effective.toFixed(4)),
    rankScore: Number(rank.toFixed(4)),
    relevanceGatePassed: effective >= required,
    importance,
    confidence,
    rehearsalHits: Number(hits.toFixed(4)),
  }
}

/**
 * 对候选排序/门控（纯函数）。
 * @param {Array<object>} hits 来自向量检索的候选（score/level/anchorTs/importance/confidence/accessEvents）
 * @param {object} options enabled/baseMinScore/.../mode
 * @param {number} now
 * @returns {{pass:Array<object>, dropped:Array<object>}}
 */
export function rankHits(hits, options = {}, now = Date.now()) {
  const policy = { ...RECALL_POLICY_DEFAULTS, ...(options ?? {}) }
  const evaluated = (hits ?? []).map((hit) => evaluateHit(hit, policy, now))
  const pass = evaluated.filter((hit) => hit.relevanceGatePassed).sort((a, b) => b.rankScore - a.rankScore)
  const dropped = evaluated.filter((hit) => !hit.relevanceGatePassed)
  return { pass, dropped }
}
