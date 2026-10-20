/**
 * 动态召回策略纯函数测试（无外部依赖）：
 * freshness / required / effectiveHits / rehearsalBoost / rankHits 门控与排序。
 */
import assert from 'node:assert/strict'
import {
  RECALL_POLICY_DEFAULTS,
  decayTauDays,
  effectiveHits,
  evaluateHit,
  freshness,
  rankHits,
  requiredScore,
} from '../src/lib/domain/recall-policy.js'

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps
const now = 1792420000000
const day = 86400000

// freshness / τ
assert.equal(decayTauDays(0), 7)
assert.equal(decayTauDays(1), 30)
assert.equal(decayTauDays(2), 180)
assert.equal(decayTauDays(3), 365)
assert.ok(close(freshness(0, 7), 1))
assert.ok(close(freshness(7, 7), Math.exp(-1)))
assert.ok(freshness(60, 7) < 0.001)

// required 随年龄严格上升，且限制在 max
const r0 = requiredScore({ baseMinScore: 0.42, strictness: 0.35, freshness: freshness(0, 7), maxRequired: 0.9 })
const r7 = requiredScore({ baseMinScore: 0.42, strictness: 0.35, freshness: freshness(7, 7), maxRequired: 0.9 })
const r60 = requiredScore({ baseMinScore: 0.42, strictness: 0.35, freshness: freshness(60, 7), maxRequired: 0.9 })
assert.equal(r0, 0.42)
assert.ok(r7 > r0 && r7 > 0.6 && r7 < 0.9)
assert.ok(r60 <= 0.9 && r60 > r7)

// 有效复述：衰减 + 被动曝光不进入
const events = [
  { type: 'search', at: now - 1 * day, weight: 1 },
  { type: 'confirm', at: now - 30 * day, weight: 2 },
]
const hits = effectiveHits(events, now, 90)
assert.ok(hits > 1 && hits < 3)
assert.equal(effectiveHits([], now), 0)
assert.equal(effectiveHits([{ type: 'exposure', at: now, weight: 0 }], now), 0)

// evaluateHit：旧原始记忆需要更强匹配；高 importance/复述可补偿
const base = { id: 'a', score: 0.55, level: 0, importance: 0.4, confidence: 0.6, accessEvents: [], anchorTs: now }
const recent = evaluateHit({ ...base, anchorTs: now - 1 * day }, {}, now)
const old = evaluateHit({ ...base, anchorTs: now - 60 * day }, {}, now)
assert.ok(recent.relevanceGatePassed)
assert.ok(!old.relevanceGatePassed)
assert.ok(old.requiredScore > recent.requiredScore)
assert.ok(old.freshness < recent.freshness)
const oldStrong = evaluateHit(
  { ...base, anchorTs: now - 60 * day, importance: 1, accessEvents: [{ type: 'search', at: now - 1 * day, weight: 1 }] },
  {},
  now,
)
assert.ok(oldStrong.effectiveScore > old.effectiveScore)
assert.ok(oldStrong.rankScore > old.rankScore)

// L3 长记忆衰减更慢
const oldL3 = evaluateHit({ ...base, anchorTs: now - 60 * day, level: 3 }, {}, now)
assert.ok(oldL3.freshness > old.freshness)

// rankHits 排序/门控
const result = rankHits(
  [
    { ...base, id: 'recent', anchorTs: now - day, score: 0.6 },
    { ...base, id: 'old', anchorTs: now - 60 * day, score: 0.6 },
    { ...base, id: 'weak', anchorTs: now - day, score: 0.3 },
  ],
  {},
  now,
)
assert.equal(result.pass[0].id, 'recent')
assert.ok(result.dropped.some((hit) => hit.id === 'old'))
assert.ok(result.dropped.some((hit) => hit.id === 'weak'))

// 工具模式更宽松
const toolMode = rankHits([{ ...base, id: 'old', anchorTs: now - 60 * day, score: 0.5 }], { mode: 'tool' }, now)
const autoMode = rankHits([{ ...base, id: 'old', anchorTs: now - 60 * day, score: 0.5 }], {}, now)
assert.ok(toolMode.pass.length >= autoMode.pass.length)

// 默认参数形状
assert.equal(RECALL_POLICY_DEFAULTS.enabled, true)
assert.equal(RECALL_POLICY_DEFAULTS.decayTauDays[0], 7)
console.log('✅ recall-policy: all assertions passed')
