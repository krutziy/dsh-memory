/**
 * dsh-memory v0.8 睡眠整理 / 记忆片段队列测试（真实 SiliconFlow + 真实 Qdrant，mock DSH ctx）：
 * 事件批次（会话 × 日期）、L1 事件片段、L2 按周 N:1 合并、L3 按月 N:1 合并、
 * 编号生命周期（待整理期间存在、终态回收、记忆固化后不带编号）、旧任务列表迁移、
 * 实验功能（事件合并 / 增强记忆）、DSH 模型来源、睡眠控制器与 HTTP 路由。
 */
import { EventEmitter } from 'node:events'
import { rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { ConsolidationEngine } from '../src/lib/app/consolidation-service.js'
import { MemoryService } from '../src/lib/app/memory-service.js'
import { QueueService } from '../src/lib/app/queue-service.js'
import { SleepController } from '../src/lib/entry/sleep-controller.js'
import { RecallController } from '../src/lib/entry/recall-controller.js'
import { registerHttpRoutes } from '../src/lib/entry/http/routes.js'
import { monthEndMs, monthKeyOfWeek, weekEndMs, weekKeyOf } from '../src/lib/domain/fragments.js'
import { dayBoundsFromKey, dayKey, shiftDayKey } from '../src/lib/domain/time.js'

const KEY = process.env.SF_KEY
const COLLECTION = 'dsh_memory_test'
const STATE_DIR = '/tmp/memtest-home-consol'
const QUEUE_PATH = `${STATE_DIR}/storages/dsh-memory/queue.json`
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PQQkAAAgEsAtjR+NZzQi+hcEKLNXzWgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQELgsTB6E82mqu8QAAAABJRU5ErkJggg==',
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
  recallTopK: 3,
  recallMinScore: 0.3,
  recallMaxChars: 600,
  recallMinAgeMinutes: 0,
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
  level2AfterDays: 7,
  level3AfterDays: 30,
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

process.env.DSH_HOME = STATE_DIR
await rm(STATE_DIR, { recursive: true, force: true })

const service = new MemoryService(ctx, config)
const taskBoard = new QueueService(service)
service.taskBoard = taskBoard
await taskBoard.load()
const engine = new ConsolidationEngine(service)
service.consolidation = engine
const sleepCtl = new SleepController(service, engine)
service.sleep = sleepCtl

const FAKE_DSH_JSON = JSON.stringify({ summary: 'fake dsh summary', facts: [{ text: 'fake dsh fact', kind: 'fact' }] })
ctx.llm = {
  listProviders: async () => [{ id: 'fake-provider', name: 'Fake Provider' }],
  listConfigurableProviders: async () => [{ provider: 'fake-provider', displayName: 'Fake Provider', settingsNs: 'fake-llm' }],
  listModels: async () => [{ id: 'fake-model', name: 'Fake Model', inputModalities: ['text', 'image'] }],
  stream: async function* () {
    yield { type: 'text-delta', index: 0, text: FAKE_DSH_JSON }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}
ctx.agentDefaultModel = { currentSelection: () => ({ provider: 'fake-provider', model: 'fake-model' }) }

const TZ = undefined // 服务器本地时区
const now = Date.now()
const todayKey = dayKey(now, TZ)
const day1Key = shiftDayKey(todayKey, -1)
const day2Key = shiftDayKey(todayKey, -2)
const day3Key = shiftDayKey(todayKey, -26) // 上个月，用于测试按月合并
const b1 = dayBoundsFromKey(day1Key, TZ)
const b2 = dayBoundsFromKey(day2Key, TZ)
const b3 = dayBoundsFromKey(day3Key, TZ)

/** 给某天某个会话建立事件批次，并写入若干原始片段。 */
async function seedEvent(bounds, sessionId, texts) {
  const key = dayKey(bounds.from + 3600000 * 10, TZ)
  const batch = await taskBoard.ensureEventBatch({ dayKey: key, sessionId })
  const ids = []
  for (let index = 0; index < texts.length; index += 1) {
    const saved = await service.addMemory({
      kind: 'turn',
      text: texts[index],
      meta: { ts: bounds.from + 3600000 * 10 + index * 60000, level: 0, batch: batch.no },
    })
    ids.push(saved.id)
  }
  return ids
}

async function readQueue() {
  return JSON.parse(await readFile(QUEUE_PATH, 'utf8'))
}

async function writeQueue(data) {
  await writeFile(QUEUE_PATH, JSON.stringify(data, null, 2))
  taskBoard.loaded = false
  await taskBoard.load()
}

console.log('\n=== v0.8 记忆片段队列测试 ===')

// ---------- 1. 种子：两个事件日的多个会话 + 今天 ----------
await service.recreateCollection()
await seedEvent(b2, 'session-A', ['用户说周末去了西湖，觉得风景很好，还想再去一次', '用户喜欢喝美式咖啡，早上必须来一杯'])
await seedEvent(b2, 'session-B', ['另一个会话：用户在做地理作业，需要在地图上标点，觉得有点难'])
await seedEvent(b1, 'session-A', ['用户的作业快写完了，心情不错', '用户喜欢爬山，尤其喜欢看瀑布'])
await seedEvent(b3, 'session-C', ['上个月的会话：用户说下周有一场考试，需要复习'])
const todaySaved = await service.addMemory({ kind: 'turn', text: '用户今天在调试记忆插件', meta: { level: 0, batch: '' } })
const before = await service.countByLevel()
check('seed raw count', before['0'] === 7, before)

const seededBatches = await readQueue()
check('event batches created per session', seededBatches.batches.length === 4, seededBatches.batches.map((batch) => batch.key))
check(
  'same day different sessions get different numbers',
  new Set(seededBatches.batches.filter((batch) => batch.dayKey === day2Key).map((batch) => batch.no)).size === 2,
  seededBatches.batches.filter((batch) => batch.dayKey === day2Key).map((batch) => batch.no),
)
check(
  'event batch keys are day#seq',
  seededBatches.batches.every((batch) => new RegExp(`^${batch.dayKey}#\\d+$`).test(batch.key)),
  seededBatches.batches.map((batch) => batch.key),
)

// ---------- 2. L1：事件批次 → 事件片段 ----------
const run1 = await engine.run({ manual: true, reason: 'test-l1' })
const after1 = await service.countByLevel()
check('consolidation run ok', run1.ok === true, run1.errors)
check('L1 runs per event batch', (run1.levels[1]?.batches ?? 0) === 4, run1.levels)
// 上个月的事件批次已经到期，同一次睡眠里会继续做 L2（补跑）；但 L3 还不到期
check('old backlog goes to L2 in the same run', (run1.levels[2]?.batches ?? 0) >= 1, run1.levels)
check('L3 not run before monthly due', (run1.levels[3]?.batches ?? 0) === 0, run1.levels)
check('past raw deleted, today raw kept', after1['0'] === 1, after1)
check('L1 memories created', after1['1'] >= 3, after1)

const queue1 = await readQueue()
const waiting1 = queue1.batches.filter((batch) => batch.level === 1 && batch.status === 'waiting')
check('current-week event batches waiting for weekly merge', waiting1.length === 3, queue1.batches.map((batch) => batch.status))
check(
  'waiting due at week end + 7 days',
  waiting1.every((batch) => {
    const due = weekEndMs(weekKeyOf(batch.dayKey), TZ) + config.level2AfterDays * 86400000
    return Math.abs(batch.dueAt - due) < 120000
  }),
  waiting1.map((batch) => ({ dayKey: batch.dayKey, dueAt: batch.dueAt })),
)
check('waiting batches keep their 5-digit numbers', waiting1.every((batch) => /^\d{5}$/.test(String(batch.no ?? ''))), waiting1.map((batch) => batch.no))
const l1Memories = await service.collectMemories({ filter: { must: [{ key: 'level', match: { value: 1 } }] }, maxItems: 100 })
check('L1 memories carry the batch number', l1Memories.every((memory) => /^\d{5}$/.test(String(memory.payload.batch ?? ''))), l1Memories.map((m) => m.payload.batch))
check('L1 memories inherit event anchor', l1Memories.every((memory) => Number(memory.payload.anchorTs) > 0), l1Memories.length)
const summary1 = taskBoard.summary()
check('queue lists waiting fragments', summary1.pendingByLevel[1] === 3 && summary1.pendingTotal >= 3, summary1.byStatus)

// 可选上限开关
const offStages = engine.stages()
check('no per-level item cap by default', offStages.every((stage) => stage.maxItems === null), offStages.map((stage) => stage.maxItems))
config.consolidationLimitItems = true
const onStages = engine.stages()
check('optional item caps when enabled', onStages.map((stage) => stage.maxItems).join(',') === '40,20,10', onStages.map((stage) => stage.maxItems))
config.consolidationLimitItems = false

// ---------- 3. L2：到期事件批次按周 N:1 合并 ----------
const queueForce1 = await readQueue()
for (const batch of queueForce1.batches) {
  if (batch.level === 1 && batch.status === 'waiting') batch.dueAt = Date.now() - 1000
}
await writeQueue(queueForce1)
const run2 = await engine.run({ manual: true, reason: 'test-l2' })
const after2 = await service.countByLevel()
check('L2 runs when due', (run2.levels[2]?.batches ?? 0) === 1, run2.levels)
check('L1 memories replaced by L2', after2['1'] === 0 && after2['2'] >= 2, after2)
const queue2 = await readQueue()
const l1After = queue2.batches.filter((batch) => batch.level === 1)
check('source L1 batches merged', l1After.every((batch) => batch.status === 'merged' && !batch.no), l1After.map((batch) => ({ status: batch.status, no: batch.no })))
const waiting2 = queue2.batches.filter((batch) => batch.level === 2 && batch.status === 'waiting')
check('L2 week batches waiting for monthly merge', waiting2.length === 2, waiting2.map((batch) => batch.key))
check(
  'L2 due at month end + 30 days',
  waiting2.every((batch) => Math.abs(batch.dueAt - (monthEndMs(monthKeyOfWeek(batch.weekKey), TZ) + config.level3AfterDays * 86400000)) < 120000),
  waiting2.map((batch) => ({ weekKey: batch.weekKey, dueAt: batch.dueAt })),
)
const l2Memories = await service.collectMemories({ filter: { must: [{ key: 'level', match: { value: 2 } }] }, maxItems: 100 })
check('L2 memories carry the week batch number', l2Memories.every((memory) => /^\d{5}$/.test(String(memory.payload.batch ?? ''))), l2Memories.map((m) => m.payload.batch))

// ---------- 4. L3：到期周批次按月 N:1 合并（final） ----------
const queueForce2 = await readQueue()
for (const batch of queueForce2.batches) {
  if (batch.level === 2 && batch.status === 'waiting') batch.dueAt = Date.now() - 1000
}
await writeQueue(queueForce2)
const run3 = await engine.run({ manual: true, reason: 'test-l3' })
const after3 = await service.countByLevel()
check('L3 runs when due', (run3.levels[3]?.batches ?? 0) === 2, run3.levels)
check('L2 memories replaced by L3', after3['2'] === 0 && after3['3'] >= 2, after3)
const queue3 = await readQueue()
check('no active batches after final', queue3.batches.every((batch) => batch.status === 'merged' || batch.status === 'final'), queue3.batches.map((batch) => batch.status))
check('all numbers released after final', queue3.batches.every((batch) => !batch.no), queue3.batches.map((batch) => batch.no))
check('queue pending cleared', taskBoard.summary().pendingTotal === 0, taskBoard.summary().byStatus)
const l3Memories = await service.collectMemories({ filter: { must: [{ key: 'level', match: { value: 3 } }] }, maxItems: 100 })
check('final memories no longer carry a batch number', l3Memories.every((memory) => String(memory.payload.batch ?? '') === ''), l3Memories.map((m) => m.payload.batch))
check('final memories keep content anchor', l3Memories.every((memory) => Number(memory.payload.anchorTs) > 0), l3Memories.length)

// ---------- 5. 事件合并实验（L1 内） ----------
config.experimentalEventMergeEnabled = true
config.experimentalEventMergeThreshold = 0.5
config.experimentalEventMergeMaxCandidates = 10
await service.recreateCollection()
await seedEvent(b2, 's1', ['我上周末去西湖划船，看到了很多荷花，很开心', '我最近在学做菜，做了番茄炒蛋'])
await seedEvent(b1, 's2', ['上周去西湖划船看到荷花，还拍了照片', '番茄炒蛋做成功了，味道不错'])
const run4 = await engine.run({ manual: true, reason: 'test-event' })
const eventItems = await service.collectMemories({ filter: { must: [{ key: 'kind', match: { value: 'event' } }] }, maxItems: 100 })
check('event merge creates event memory', eventItems.length >= 1, eventItems.length)
check('event memory has related count', eventItems.some((item) => Number(item.payload.relatedCount) >= 1), eventItems.map((item) => item.payload.relatedCount))
check('event merge run ok', run4.ok === true, run4.errors)

// ---------- 6. 增强记忆实验 ----------
config.experimentalEventMergeEnabled = false
config.experimentalEnhancementEnabled = true
config.experimentalEnhancementDays = 7
await service.recreateCollection()
await seedEvent(b2, 's3', ['用户喜欢蓝色', '用户周末喜欢宅在家里', '用户说想学吉他'])
const run5 = await engine.run({ manual: true, reason: 'test-enhance' })
const enhanced = await service.collectMemories({ filter: { must: [{ key: 'enhanced', match: { value: true } }] }, maxItems: 100 })
check('enhanced memories created', enhanced.length >= 1, enhanced.length)
check('enhanced payload has expiry', enhanced.every((item) => Number(item.payload.expiresAt) > Date.now()), enhanced.map((item) => item.payload.expiresAt))
check('enhanced copies do not occupy a batch number', enhanced.every((item) => !item.payload.batch), enhanced.map((item) => item.payload.batch))
await service.updateMemoryPayload(enhanced.map((item) => item.id), { expiresAt: Date.now() - 1000 })
const run6 = await engine.run({ manual: true, reason: 'test-expire' })
const enhancedAfter = await service.collectMemories({ filter: { must: [{ key: 'enhanced', match: { value: true } }] }, maxItems: 100 })
check('enhanced memories expire and delete', enhancedAfter.length === 0, enhancedAfter.length)
check('expiry counted in run', (run6.deleted ?? 0) >= 1, run6.deleted)
config.experimentalEnhancementEnabled = false

// ---------- 7. DSH 模型来源 ----------
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

// ---------- 8. 旧任务列表迁移 ----------
const MIGRATE_DIR = '/tmp/memtest-home-migrate'
await rm(MIGRATE_DIR, { recursive: true, force: true })
await mkdir(`${MIGRATE_DIR}/storages/dsh-memory`, { recursive: true })
const legacyDueAt = Date.now() + 86400000
await writeFile(
  `${MIGRATE_DIR}/storages/dsh-memory/consolidation.json`,
  JSON.stringify({
    version: 1,
    batches: [
      { id: '12345', level: 1, status: 'pending', createdAt: dayBoundsFromKey(day1Key, TZ).from, dueAt: legacyDueAt, dayKey: day1Key, inputCount: 4, outputCount: 2 },
      { id: '22222', level: 1, status: 'final', createdAt: Date.now() - 30 * 86400000, dayKey: day2Key, inputCount: 3, outputCount: 1 },
    ],
    history: [],
    lastRun: null,
  }),
)
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = MIGRATE_DIR
const migratedQueue = new QueueService(service)
await migratedQueue.load()
const migrated = await readFile(`${MIGRATE_DIR}/storages/dsh-memory/queue.json`, 'utf8').then(JSON.parse)
check('legacy queue migrated to queue.json', migrated.batches.length === 2, migrated.batches.length)
check(
  'legacy pending batch becomes waiting with its number',
  migrated.batches.some((batch) => batch.status === 'waiting' && batch.no === '12345' && batch.weekKey === weekKeyOf(day1Key)),
  migrated.batches,
)
check('legacy final batch releases its number', migrated.batches.some((batch) => batch.status === 'final' && !batch.no), migrated.batches)
process.env.DSH_HOME = previousHome

// ---------- 9. 睡眠控制器：空闲检测 / zzzZZ / 排队唤醒 ----------
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
const userMessage = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '帮我查一下明天的天气' }] }
const intercepted = sleepCtl2.interceptPreStep(
  { step: 1, agent: { id: 'session-sleep-test' }, messages: [], signal: { aborted: false } },
  { kind: 'enter', messages: [userMessage] },
)
check('sleep intercept returns zzzZZ instruction', Boolean(intercepted?.message) && intercepted.message.content[0].text.includes('zzzZZ'), intercepted?.message?.content?.[0]?.text)
check('sleep queues user message', sleepCtl2.status().pendingCount === 1, sleepCtl2.status().pendingPreview)
const recallCtl = new RecallController(service)
const recallResult = await recallCtl.augment(
  { step: 1, agent: { id: 'session-sleep-test' }, messages: [], signal: { aborted: false } },
  { kind: 'enter', messages: [userMessage] },
)
check('recall adds sleep instruction instead of memory', recallResult.messages.length === 2 && recallResult.messages[1].source?.kind === 'dsh-memory-sleep', recallResult.messages.map((m) => m.source?.kind))
const followedUp = []
const fakeAgent = { id: 'session-sleep-test', followup: (message) => followedUp.push(message) }
sleepCtl2.pending = [{ agent: fakeAgent, sessionId: 'session-sleep-test', text: '帮我查一下明天的天气', at: Date.now() }]
resolveEngine({ ok: true, durationMs: 5, levels: { 1: { batches: 1, input: 3, output: 1 } }, batches: [], deleted: 0, errors: [] })
await sleepPromise
check('sleeping cleared after run', sleepCtl2.isSleeping() === false)
check('wake followup called with queued text', followedUp.length === 1 && followedUp[0].content[0].text.includes('明天的天气'), followedUp.map((m) => m.content?.[0]?.text?.slice(0, 40)))
check('wake followup source kind', followedUp[0]?.source?.kind === 'dsh-memory-wake', followedUp[0]?.source?.kind)
check('lastSleepDayKey recorded', sleepCtl2.lastSleepDayKey === dayKey(Date.now()), sleepCtl2.lastSleepDayKey)

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

// ---------- 10. HTTP 路由 ----------
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
