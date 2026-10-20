/**
 * dsh-memory v0.2 Host 半集成测试（真实 SiliconFlow + 真实 Qdrant，mock DSH ctx）：
 * provider 解析、写入/检索/范围过滤、记忆列表/导出/删除、保留与维护、HTTP 路由、工具、capture/recall。
 */
import { EventEmitter } from 'node:events'
import { CaptureController } from '../src/lib/entry/capture-controller.js'
import { MemoryService } from '../src/lib/app/memory-service.js'
import { RecallController } from '../src/lib/entry/recall-controller.js'
import { registerHttpRoutes } from '../src/lib/entry/http/routes.js'
import { registerMemoryTools } from '../src/lib/entry/tools.js'
import { ConsolidationEngine } from '../src/lib/app/consolidation-service.js'
import { SleepController } from '../src/lib/entry/sleep-controller.js'
import { registerHttpRoutes as registerHttpRoutesV4 } from '../src/lib/entry/http/routes.js'
import { dayBoundsFromKey, dayKey, shiftDayKey } from '../src/lib/domain/time.js'

const KEY = process.env.SF_KEY
const COLLECTION = 'dsh_memory_test'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PQQkAAAgEsAtjR+NZzQi+hcEKLNXzWgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQELgsTB6E82mqu8QAAAABJRU5ErkJggg==',
  'base64',
)

const handlers = new Map()
const sessions = new Map()

const ctx = {
  logger: { info: (...args) => console.log('[info]', ...args), warn: (...args) => console.warn('[warn]', ...args) },
  credentials: {
    resolve: async (ref) => (ref === 'SILICONFLOW_API_KEY' ? { value: KEY, source: 'file' } : undefined),
    describe: async (ref) => ({ configured: ref === 'SILICONFLOW_API_KEY', writable: true, source: 'file' }),
  },
  attachments: { readImage: async () => ({ data: PNG, ref: {} }) },
  sessions: { get: (id) => sessions.get(id) },
  on: (name, callback) => {
    handlers.set(name, callback)
    return () => handlers.delete(name)
  },
  effect: (callback) => {
    callback()
    return () => {}
  },
  tools: {
    register: (definition) => {
      handlers.set('tool:' + definition.name, definition)
      return () => handlers.delete('tool:' + definition.name)
    },
  },
  systemPrompt: { section: () => () => {} },
  webServer: {
    register: (route) => {
      handlers.set('route:' + route.path, route)
      return () => {}
    },
  },
}

const baseConfig = {
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
    {
      id: 'alt',
      name: '备用嵌入',
      protocol: 'openai',
      baseUrl: 'https://api.siliconflow.cn/v1',
      embedModel: 'Qwen/Qwen3-Embedding-8B',
      dimensions: 1024,
      apiKeyEnv: 'SILICONFLOW_API_KEY',
      sendDimensions: true,
      visionModel: '',
      visionBaseUrl: '',
      visionApiKeyEnv: '',
    },
  ],
  activeProvider: 'siliconflow',
  qdrantUrl: 'http://127.0.0.1:6333',
  collection: COLLECTION,
  qdrantApiKeyEnv: '',
  autoCapture: true,
  captureUserChars: 400,
  captureAssistantChars: 400,
  captureMinChars: 12,
  includeSubagents: false,
  autoRecall: true,
  memoryScope: 'global',
  recallTopK: 3,
  recallMinScore: 0.3,
  recallMaxChars: 600,
  recallIncludeCurrentSession: false,
  recallTimeoutMs: 3000,
  imageMode: 'caption',
  captionPrompt: '',
  captionMaxTokens: 96,
  toolsEnabled: true,
  toolSearchLimit: 5,
  retentionDays: 0,
  maxMemories: 0,
  maintenanceIntervalHours: 6,
  maintenanceDedupe: true,
  dedupeThreshold: 0.9,
  dedupeMaxScan: 50,
  debug: true,
  consolidationEnabled: true,
  sleepAt: '00:00',
  sleepRetryMinutes: 15,
  idleMinutes: 60,
  consolidationProviderId: '',
  consolidationModel: 'Qwen/Qwen2.5-7B-Instruct',
  consolidationInputMaxChars: 6000,
  consolidationSource: 'custom',
  consolidationLimitItems: false,
  captionSource: 'custom',
  consolidationPrompt: '',
  experimentalEventMergeEnabled: false,
  experimentalEventMergeThreshold: 0.8,
  experimentalEventMergeMaxCandidates: 10,
  experimentalEnhancementEnabled: false,
  experimentalEnhancementDays: 7,
}

const config = JSON.parse(JSON.stringify(baseConfig))
const service = new MemoryService(ctx, config)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let passed = 0
let failed = 0
function check(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`✅ ${name}`)
  } else {
    failed += 1
    console.log(`❌ ${name}${detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 500)}`)
  }
}

process.env.DSH_HOME = '/tmp/memtest-home-consol'

const FAKE_DSH_JSON = JSON.stringify({ summary: 'fake dsh summary', facts: [{ text: 'fake dsh fact', kind: 'fact' }] })
ctx.llm = {
  listProviders: async () => [{ id: 'fake-provider', name: 'Fake Provider' }],
  listConfigurableProviders: async () => [{ provider: 'fake-provider', displayName: 'Fake Provider', settingsNs: 'fake-llm' }],
  listModels: async (provider) => [{ id: 'fake-model', name: 'Fake Model', inputModalities: ['text', 'image'] }],
  stream: async function* () {
    yield { type: 'text-delta', index: 0, text: FAKE_DSH_JSON }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}
ctx.agentDefaultModel = { currentSelection: () => ({ provider: 'fake-provider', model: 'fake-model' }) }

const TZ = undefined // 服务器本地时区
const now = Date.now()
const todayKey = dayKey(now, TZ)
const day1 = shiftDayKey(todayKey, -1)
const day2 = shiftDayKey(todayKey, -2)
const b2 = dayBoundsFromKey(day2, TZ)
const b1 = dayBoundsFromKey(day1, TZ)

async function seedDay(bounds, texts) {
  const ids = []
  for (let index = 0; index < texts.length; index += 1) {
    const saved = await service.addMemory({
      kind: 'turn',
      text: texts[index],
      meta: { ts: bounds.from + 3600000 * 10 + index * 60000, level: 0, batch: '' },
    })
    ids.push(saved.id)
  }
  return ids
}

await (await import('node:fs/promises')).rm('/tmp/memtest-home-consol', { recursive: true, force: true })
const engine = new ConsolidationEngine(service)
service.consolidation = engine
const sleepCtl = new SleepController(service, engine)
service.sleep = sleepCtl

console.log('\n=== v0.4 睡眠整理测试 ===')

// ---------- 1. 种子：两天原始记忆 + 今天 ----------
await service.recreateCollection()
const day2Ids = await seedDay(b2, [
  '用户说周末去了西湖，觉得风景很好，还想再去一次',
  '用户喜欢喝美式咖啡，早上必须来一杯',
  '用户在做一个地理作业，需要在地图上标点，觉得有点难',
])
const day1Ids = await seedDay(b1, [
  '用户的作业快写完了，心情不错',
  '用户喜欢爬山，尤其喜欢看瀑布',
  '用户说下周有一场考试，需要复习',
])
const todaySaved = await service.addMemory({ kind: 'turn', text: '用户今天在调试记忆插件', meta: { level: 0, batch: '' } })
const before = await service.countByLevel()
check('seed raw count', before['0'] === 7, before)

// ---------- 2. L1：按天压缩原始记忆（保留条数由模型决定） ----------
const run1 = await engine.run({ manual: true, reason: 'test' })
const after1 = await service.countByLevel()
check('consolidation run ok', run1.ok === true, run1.errors)
check('L1 batch per past day', (run1.levels[1]?.batches ?? 0) >= 2, run1.levels)
check('L2/L3 not run before 7/30 days', (run1.levels[2]?.batches ?? 0) === 0 && (run1.levels[3]?.batches ?? 0) === 0, run1.levels)
check('past raw deleted, today raw kept', after1['0'] === 1, after1)
check('L1 memories created', after1['1'] >= 1, after1)
const offStages = engine.stages()
check('no per-level item cap by default', offStages.every((stage) => stage.maxItems === null), offStages.map((stage) => stage.maxItems))
config.consolidationLimitItems = true
const onStages = engine.stages()
check('optional item caps when enabled', onStages.map((stage) => stage.maxItems).join(',') === '40,20,10', onStages.map((stage) => stage.maxItems))
config.consolidationLimitItems = false
const stateRaw = JSON.parse(await (await import('node:fs/promises')).readFile('/tmp/memtest-home-consol/storages/dsh-memory/consolidation.json', 'utf8'))
const ids = stateRaw.batches.map((batch) => batch.id)
check('batch ids are 5 digits', ids.every((id) => /^\d{5}$/.test(id)), ids)
const pending1 = stateRaw.batches.filter((batch) => batch.status === 'pending' || batch.status === 'processing').map((batch) => batch.id)
check('pending batch ids unique', new Set(pending1).size === pending1.length, pending1)
check('L1 batches pending with 7-day due', stateRaw.batches.filter((batch) => batch.level === 1).every((batch) => batch.status === 'pending' && Math.abs(batch.dueAt - (batch.createdAt + 7 * 86400000)) < 120000), stateRaw.batches.map((batch) => ({ level: batch.level, dueAt: batch.dueAt, status: batch.status })))
const summary1 = service.consolidation.summary()
check('task list lists pending L1', summary1.pendingTotal >= 2 && summary1.pendingByLevel[1] >= 2, summary1.pendingByLevel)
check('L1 memories carry batch id', (await service.collectMemories({ filter: { must: [{ key: 'level', match: { value: 1 } }] } })).every((memory) => /^\d{5}$/.test(String(memory.payload.batch ?? ''))))

// ---------- 3. 任务列表：到期后继续 L2/L3 压缩 ----------
const nowTs = Date.now()
for (const batch of stateRaw.batches) {
  if (batch.level === 1 && batch.status === 'pending') batch.dueAt = nowTs - 1000
}
await (await import('node:fs/promises')).writeFile('/tmp/memtest-home-consol/storages/dsh-memory/consolidation.json', JSON.stringify(stateRaw, null, 2))
engine.loaded = false
await engine.load()
const run2 = await engine.run({ manual: true, reason: 'test-due-l2' })
check('L2 runs when due', (run2.levels[2]?.batches ?? 0) >= 1, run2.levels)
const after2 = await service.countByLevel()
check('L1 memories replaced by L2', after2['1'] === 0 && after2['2'] >= 1, after2)
const state2 = JSON.parse(await (await import('node:fs/promises')).readFile('/tmp/memtest-home-consol/storages/dsh-memory/consolidation.json', 'utf8'))
check('source L1 batches done', state2.batches.filter((batch) => batch.level === 1).every((batch) => batch.status === 'done'), state2.batches.filter((b) => b.level === 1).map((b) => b.status))
const pendingL2 = state2.batches.filter((batch) => batch.level === 2 && batch.status === 'pending')
check('L2 batches scheduled for L3', pendingL2.length >= 1 && pendingL2.every((batch) => Math.abs(batch.dueAt - (batch.createdAt + 30 * 86400000)) < 120000), pendingL2.map((b) => ({ dueAt: b.dueAt, createdAt: b.createdAt })))
for (const batch of pendingL2) batch.dueAt = nowTs - 1000
await (await import('node:fs/promises')).writeFile('/tmp/memtest-home-consol/storages/dsh-memory/consolidation.json', JSON.stringify(state2, null, 2))
engine.loaded = false
await engine.load()
const run3 = await engine.run({ manual: true, reason: 'test-due-l3' })
check('L3 runs when due', (run3.levels[3]?.batches ?? 0) >= 1, run3.levels)
const after3 = await service.countByLevel()
check('L2 memories replaced by L3', after3['2'] === 0 && after3['3'] >= 1, after3)
const state3 = JSON.parse(await (await import('node:fs/promises')).readFile('/tmp/memtest-home-consol/storages/dsh-memory/consolidation.json', 'utf8'))
check('final batches final, none pending', state3.batches.filter((batch) => batch.level === 3).every((batch) => batch.status === 'final') && service.consolidation.summary().pendingTotal === 0, state3.batches.map((b) => ({ level: b.level, status: b.status })))
check('all batch ids are 5 digits', state3.batches.map((batch) => batch.id).every((id) => /^\d{5}$/.test(id)))
check('L3 memories carry batch id', (await service.collectMemories({ filter: { must: [{ key: 'level', match: { value: 3 } }] } })).every((memory) => /^\d{5}$/.test(String(memory.payload.batch ?? ''))))

// ---------- 4. 事件合并实验 ----------
config.experimentalEventMergeEnabled = true
config.experimentalEventMergeThreshold = 0.5
config.experimentalEventMergeMaxCandidates = 10
await service.recreateCollection()
await seedDay(b2, ['我上周末去西湖划船，看到了很多荷花，很开心', '我最近在学做菜，做了番茄炒蛋'])
await seedDay(b1, ['上周去西湖划船看到荷花，还拍了照片', '番茄炒蛋做成功了，味道不错'])
const run4 = await engine.run({ manual: true, reason: 'test-event' })
const eventItems = await service.collectMemories({ filter: { must: [{ key: 'kind', match: { value: 'event' } }] } })
check('event merge creates event memory', eventItems.length >= 1, eventItems.length)
check('event memory has related count', eventItems.some((item) => Number(item.payload.relatedCount) >= 1), eventItems.map((i) => i.payload.relatedCount))

// ---------- 5. 增强记忆实验 ----------
config.experimentalEventMergeEnabled = false
config.experimentalEnhancementEnabled = true
config.experimentalEnhancementDays = 7
await service.recreateCollection()
await seedDay(b2, ['用户喜欢蓝色', '用户周末喜欢宅在家里', '用户说想学吉他'])
const run5 = await engine.run({ manual: true, reason: 'test-enhance' })
const enhanced = await service.collectMemories({ filter: { must: [{ key: 'enhanced', match: { value: true } }] } })
check('enhanced memories created', enhanced.length >= 1, enhanced.length)
check('enhanced payload has expiry', enhanced.every((item) => Number(item.payload.expiresAt) > Date.now()), enhanced.map((i) => i.payload.expiresAt))
check('enhanced not reused by batch chain', enhanced.every((item) => !item.payload.batch), enhanced.map((i) => i.payload.batch))
await service.updateMemoryPayload(enhanced.map((item) => item.id), { expiresAt: Date.now() - 1000 })
const run6 = await engine.run({ manual: true, reason: 'test-expire' })
const enhancedAfter = await service.collectMemories({ filter: { must: [{ key: 'enhanced', match: { value: true } }] } })
check('enhanced memories expire and delete', enhancedAfter.length === 0, enhancedAfter.length)
check('expiry counted in run', (run6.deleted ?? 0) >= 1, run6.deleted)

// ---------- 5.5 DSH 模型来源 ----------
config.consolidationSource = 'dsh'
config.consolidationDshProvider = ''
config.consolidationDshModel = ''
const dshCatalog = await service.dshCatalog()
check('dsh catalog lists providers/models', dshCatalog.providers.some((provider) => provider.id === 'fake-provider') && dshCatalog.models['fake-provider']?.[0]?.id === 'fake-model', dshCatalog)
check('dsh default model read', dshCatalog.defaultModel?.provider === 'fake-provider' && dshCatalog.defaultModel?.model === 'fake-model', dshCatalog.defaultModel)
const dshResult = await service.consolidationChat({ system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxTokens: 64 })
check('consolidation routes to DSH model', dshResult.source === 'dsh' && dshResult.provider === 'fake-provider' && dshResult.model === 'fake-model', dshResult)
check('dsh chat returns text', dshResult.text.includes('fake dsh summary'), dshResult.text)
config.consolidationSource = 'custom'

// ---------- 6. 睡眠控制器：空闲检测 / zzzZZ / 排队唤醒 ----------
config.experimentalEnhancementEnabled = false
await service.recreateCollection()
let resolveEngine
const fakeEngine = {
  busy: false,
  run: () => new Promise((resolve) => { resolveEngine = resolve }),
}
const sleepCtl2 = new SleepController(service, fakeEngine)
service.sleep = sleepCtl2
config.consolidationEnabled = true
config.idleMinutes = 60
config.sleepAt = '00:00'
sleepCtl2.lastActivityAt = Date.now() - 120 * 60000
const sleepPromise = sleepCtl2.startSleep({ manual: true, reason: 'test-sleep' })
await sleep(30)
check('sleeping flag set', sleepCtl2.isSleeping() === true)
// 睡眠中拦截一条用户消息
const userMessage = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '帮我查一下明天的天气' }] }
const intercepted = sleepCtl2.interceptPreStep(
  { step: 1, agent: { id: 'session-sleep-test' }, messages: [], signal: { aborted: false } },
  { kind: 'enter', messages: [userMessage] },
)
check('sleep intercept returns zzzZZ instruction', Boolean(intercepted?.message) && intercepted.message.content[0].text.includes('zzzZZ'), intercepted?.message?.content?.[0]?.text)
check('sleep queues user message', sleepCtl2.status().pendingCount === 1, sleepCtl2.status().pendingPreview)
// recall 控制器在睡眠时也会拦截
const recallCtl = new RecallController(service)
const recallResult = await recallCtl.augment(
  { step: 1, agent: { id: 'session-sleep-test' }, messages: [], signal: { aborted: false } },
  { kind: 'enter', messages: [userMessage] },
)
check('recall adds sleep instruction instead of memory', recallResult.messages.length === 2 && recallResult.messages[1].source?.kind === 'dsh-memory-sleep', recallResult.messages.map((m) => m.source?.kind))
// 醒后自动继续处理
const followedUp = []
const fakeAgent = { id: 'session-sleep-test', followup: (message) => followedUp.push(message) }
sleepCtl2.pending = [{ agent: fakeAgent, sessionId: 'session-sleep-test', text: '帮我查一下明天的天气', at: Date.now() }]
resolveEngine({ ok: true, durationMs: 5, levels: { 1: { batches: 1, input: 3, output: 1 } }, batches: [], deleted: 0, errors: [] })
await sleepPromise
check('sleeping cleared after run', sleepCtl2.isSleeping() === false)
check('wake followup called with queued text', followedUp.length === 1 && followedUp[0].content[0].text.includes('明天的天气'), followedUp.map((m) => m.content?.[0]?.text?.slice(0, 40)))
check('wake followup source kind', followedUp[0]?.source?.kind === 'dsh-memory-wake', followedUp[0]?.source?.kind)
check('lastSleepDayKey recorded', sleepCtl2.lastSleepDayKey === dayKey(Date.now()), sleepCtl2.lastSleepDayKey)

// tick：忙时跳过 / 空闲时开睡
sleepCtl2.lastSleepDayKey = ''
sleepCtl2.lastActivityAt = Date.now() - 120 * 60000
let tickRuns = 0
sleepCtl2.engine = { busy: false, run: async () => { tickRuns += 1; return { ok: true, durationMs: 1, levels: {}, batches: [], deleted: 0, errors: [] } } }
sleepCtl2.tick()
await sleep(150)
check('tick starts sleep when idle', tickRuns === 1, tickRuns)
sleepCtl2.lastSleepDayKey = ''
sleepCtl2.lastActivityAt = Date.now()
sleepCtl2.lastSkipReason = ''
const tickRunsBefore = tickRuns
sleepCtl2.tick()
await sleep(80)
check('tick skips when recently active', tickRuns === tickRunsBefore && sleepCtl2.lastSkipReason.includes('等待空闲'), sleepCtl2.lastSkipReason)

// ---------- 7. HTTP 路由注册 ----------
handlers.clear()
registerHttpRoutes(ctx, service)
check('sleep http route registered', handlers.has('route:/__dsh_memory__/sleep'))
check('sleep/run http route registered', handlers.has('route:/__dsh_memory__/sleep/run'))
check('consolidation http route registered', handlers.has('route:/__dsh_memory__/consolidation'))
check('status includes sleep state', (await service.status()).sleep?.sleepAt === '00:00')

// ---------- 清理 ----------
await service.recreateCollection().catch(() => {})
console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
