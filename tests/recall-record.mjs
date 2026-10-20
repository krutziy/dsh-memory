/**
 * 动态召回字段/复述记录集成测试（真实 SiliconFlow + Qdrant）。
 * 需要 SF_KEY；使用独立集合 dsh_memory_test_dynamic，结束后清理。
 */
import assert from 'node:assert/strict'
import { MemoryService } from '../src/lib/app/memory-service.js'

const KEY = process.env.SF_KEY
const COLLECTION = 'dsh_memory_test_dynamic'
if (!KEY) {
  console.error('需要 SF_KEY')
  process.exit(1)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const ctx = {
  logger: { info: () => {}, warn: () => {}, debug: () => {} },
  credentials: { resolve: async (ref) => (ref === 'SILICONFLOW_API_KEY' ? { value: KEY, source: 'file' } : undefined) },
  sessions: { get: () => undefined },
  on: () => () => {},
  effect: (callback) => {
    callback()
    return () => {}
  },
}
const config = {
  providers: [
    {
      id: 'siliconflow',
      name: '硅基流动 SiliconFlow',
      protocol: 'openai',
      baseUrl: 'https://api.siliconflow.cn/v1',
      embedModel: 'Qwen/Qwen3-VL-Embedding-8B',
      dimensions: 1024,
      apiKeyEnv: 'SILICONFLOW_API_KEY',
      sendDimensions: true,
      visionModel: 'Qwen/Qwen3-VL-8B-Instruct',
      visionBaseUrl: '',
      visionApiKeyEnv: '',
    },
  ],
  activeProvider: 'siliconflow',
  qdrantUrl: 'http://127.0.0.1:6333',
  collection: COLLECTION,
  qdrantApiKeyEnv: '',
  recallAgeGateEnabled: true,
  recallNaturalRepeatEnabled: true,
  debug: false,
}
const service = new MemoryService(ctx, config)

async function fetchByIds(ids) {
  const items = await service.collectMemories({ filter: { must: [{ has_id: ids }] }, withVector: false, maxItems: 10 })
  return new Map(items.map((item) => [item.id, item.payload]))
}

try {
  await service.recreateCollection()
  const first = await service.addMemory({
    kind: 'fact',
    text: '用户喜欢喝美式咖啡，早上必须来一杯',
    meta: { ts: Date.now() - 60 * 86400000, anchorTs: Date.now() - 60 * 86400000 },
  })
  let rows = await fetchByIds([first.id])
  let payload = rows.get(first.id)
  assert.ok(payload.importance > 0, 'importance default')
  assert.ok(payload.confidence > 0, 'confidence default')
  assert.ok(payload.anchorTs > 0, 'anchorTs set')
  assert.equal(payload.exposureCount, 0)
  assert.ok(Array.isArray(payload.accessEvents))

  // A 被动曝光
  await service.recordExposure([first.id])
  await sleep(300)
  payload = (await fetchByIds([first.id])).get(first.id)
  assert.equal(payload.exposureCount, 1)
  assert.ok(payload.lastExposedAt > 0)
  assert.equal((payload.accessEvents ?? []).length, 0, 'exposure 不应写入 accessEvents')

  // B 主动检索复述
  await service.recordRehearsal([first.id], 'search', 1)
  await sleep(300)
  payload = (await fetchByIds([first.id])).get(first.id)
  assert.equal(payload.accessEvents.at(-1).type, 'search')
  assert.equal(payload.accessEvents.at(-1).weight, 1)

  // D 确认：confidence 提升
  const confidenceBefore = payload.confidence
  await service.recordRehearsal([first.id], 'confirm', 2)
  await sleep(300)
  payload = (await fetchByIds([first.id])).get(first.id)
  assert.ok(payload.confidence > confidenceBefore, 'confirm 提升 confidence')
  assert.equal(payload.accessEvents.at(-1).type, 'confirm')

  // E 纠正：confidence 下降 + needsReview
  const confidenceAfterConfirm = payload.confidence
  await service.recordRehearsal([first.id], 'correct', 1)
  await sleep(300)
  payload = (await fetchByIds([first.id])).get(first.id)
  assert.ok(payload.confidence < confidenceAfterConfirm, 'correct 降低 confidence')
  assert.equal(payload.needsReview, true)

  // C 自然复述：再次写入相似事实，旧记忆获得 repeat 事件
  await service.addMemory({ kind: 'fact', text: '用户喜欢喝美式咖啡，早上必须喝一杯' })
  await sleep(1500)
  payload = (await fetchByIds([first.id])).get(first.id)
  assert.ok((payload.accessEvents ?? []).some((event) => event.type === 'repeat'), '自然复述事件')

  // 动态门控：旧原始记忆 rankHits 被丢弃，近期相似记忆通过
  const now = Date.now()
  const ranked = service.rankHits(
    [
      { id: 'recent', score: 0.55, level: 0, importance: 0.7, confidence: 0.7, accessEvents: [], anchorTs: now - 86400000 },
      { id: 'old', score: 0.55, level: 0, importance: 0.3, confidence: 0.6, accessEvents: [], anchorTs: now - 60 * 86400000 },
    ],
    'auto',
  )
  assert.ok(ranked.pass.some((hit) => hit.id === 'recent'))
  assert.ok(ranked.dropped.some((hit) => hit.id === 'old'))
  console.log('✅ recall-record: all assertions passed')
} finally {
  await service.recreateCollection().catch(() => {})
}
