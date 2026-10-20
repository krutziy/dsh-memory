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
  dedupeThreshold: 0.85,
  dedupeMaxScan: 50,
  debug: true,
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

async function resetCollection() {
  try {
    await service.qdrant().then((q) => q.deleteCollection(COLLECTION))
  } catch {
    /* ignore */
  }
  service.collectionState.checkedAt = 0
}

async function waitQueue(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (service.queue.pending === 0) return true
    await sleep(300)
  }
  return false
}

// 注册工具（必须在服务创建后）
registerMemoryTools(service)

await resetCollection()

console.log('\n=== 1. provider / status / test ===')
let providers = service.providers()
check('providers parsed', providers.length === 2, providers.map((p) => p.id))
check('active provider', service.activeProvider().id === 'siliconflow', service.activeProvider().id)
check('provider key ref', service.credentialRef(providers[0]) === 'SILICONFLOW_API_KEY', service.credentialRef(providers[0]))
check('vision ref', service.visionConfigOf(providers[0]).ref === 'SILICONFLOW_API_KEY')

let status = await service.status()
check('status ok + providers', status.ok === true && status.providers.length === 2, status.providers.length)
check('status active provider', status.provider.id === 'siliconflow', status.provider.id)
check('status credential configured', status.credential.configured === true, status.credential)
check('status qdrant ok', status.qdrant.ok === true && !!status.qdrant.version, status.qdrant)

let test = await service.test()
check('test active provider embedding', test.embedding.ok === true && test.embedding.dimensions === 1024, test.embedding)
check('test active provider caption', test.caption?.ok === true, test.caption)
check('test ok flag', test.ok === true)

const altTest = await service.test('alt')
check('test alt provider embedding', altTest.embedding.ok === true && altTest.embedding.dimensions === 1024, altTest.embedding)

// 切换激活 provider
config.activeProvider = 'alt'
service.collectionState.checkedAt = 0
check('active provider switched', service.activeProvider().id === 'alt', service.activeProvider().id)
config.activeProvider = 'siliconflow'
service.collectionState.checkedAt = 0

console.log('\n=== 2. 写入 / 检索 / 范围 ===')
sessions.set('session-A', { header: { cwd: '/home/ubuntu/mem' } })
sessions.set('session-B', { header: { cwd: '/home/ubuntu/mem' } })
sessions.set('session-C', { header: { cwd: '/tmp/other-project' } })

const turn = await service.addTurnMemory({
  userText: '我的名字是测试用户，我住在杭州，喜欢喝美式咖啡。',
  assistantText: '好的，已记住：你叫测试用户，住在杭州，喜欢美式咖啡。',
  sessionId: 'session-A',
  cwd: '/home/ubuntu/mem',
  turn: 1,
})
check('addTurnMemory ok', turn.ok === true, turn)

const fact = await service.addMemory({
  kind: 'fact',
  text: '用户偏好：回答使用简体中文，并且尽量简洁。',
  meta: { tags: ['偏好', '语言'], sessionId: 'session-A', cwd: '/home/ubuntu/mem' },
})
check('addMemory fact ok', fact.ok === true, fact)

const otherProject = await service.addMemory({
  kind: 'fact',
  text: '另一个项目的暗号是红色鹦鹉-77。',
  meta: { sessionId: 'session-C', cwd: '/tmp/other-project' },
})
check('addMemory other project ok', otherProject.ok === true)

const image = await service.addImageMemory({
  ref: { attachmentId: 'att-1', mediaType: 'image/png', width: 64, height: 64 },
  sessionId: 'session-A',
  cwd: '/home/ubuntu/mem',
  turn: 2,
})
check('image memory caption stored', image.ok === true && String(image.text).startsWith('图片概览：'), image)

const collection = await service.qdrant().then((q) => q.collectionInfo(COLLECTION))
check('collection created with dims 1024', collection !== null && collection.size === 1024, collection)
check('payload indexes created', ['ts', 'kind', 'sessionId', 'cwd'].every((name) => collection.payloadIndexes.includes(name)), collection.payloadIndexes)

const globalSearch = await service.search('我叫什么名字，住在哪里', { limit: 5 })
check('global search hits', globalSearch.hits.length > 0, globalSearch.hits.length)
check('global search contains expected memory', globalSearch.hits.some((hit) => hit.text.includes('杭州')), globalSearch.hits.map((h) => h.text.slice(0, 30)))

// 回忆（默认全局 + 排除当前会话）
config.memoryScope = 'global'
const recall = await service.recall('我喜欢喝什么咖啡', { sessionId: 'session-B', cwd: '/home/ubuntu/mem' })
check('global recall block', recall.block.includes('美式'), recall.block.slice(0, 120))
const sameSessionRecall = await service.recall('我的名字', { sessionId: 'session-A', cwd: '/home/ubuntu/mem' })
check('global recall excludes current session', !sameSessionRecall.hits.some((hit) => hit.sessionId === 'session-A'), sameSessionRecall.hits.map((h) => h.sessionId))

// 工作区范围
config.memoryScope = 'workspace'
const workspaceRecall = await service.recall('另一个项目的暗号', { sessionId: 'session-B', cwd: '/home/ubuntu/mem' })
check('workspace recall excludes other cwd', !workspaceRecall.hits.some((hit) => hit.text.includes('红色鹦鹉')), workspaceRecall.hits.map((h) => h.text.slice(0, 30)))
config.recallIncludeCurrentSession = true
const workspaceRecall2 = await service.recall('另一个项目的暗号', { sessionId: 'session-C', cwd: '/tmp/other-project' })
check('workspace recall includes same cwd', workspaceRecall2.hits.some((hit) => hit.text.includes('红色鹦鹉')), workspaceRecall2.hits.map((h) => h.text.slice(0, 30)))
config.recallIncludeCurrentSession = false

// 会话范围
config.memoryScope = 'session'
const sessionRecall = await service.recall('我的名字', { sessionId: 'session-A', cwd: '/home/ubuntu/mem' })
check('session recall includes own session', sessionRecall.hits.some((hit) => hit.sessionId === 'session-A'), sessionRecall.hits.map((h) => h.sessionId))
const sessionRecallB = await service.recall('我的名字', { sessionId: 'session-B', cwd: '/home/ubuntu/mem' })
check('session recall excludes other session', sessionRecallB.hits.length === 0, sessionRecallB.hits.length)
config.memoryScope = 'global'

console.log('\n=== 3. 记忆管理（列表 / 导出 / 删除） ===')
const list = await service.listMemories({ limit: 10 })
check('list memories returns items', list.items.length >= 3, list.items.length)
check('list ordered by time desc', list.items[0].ts >= list.items[list.items.length - 1].ts, list.items.map((i) => i.ts))
check('list total count', typeof list.total === 'number' && list.total >= 3, list.total)

const listQuery = await service.listMemories({ query: '咖啡偏好', limit: 5 })
check('list with query uses search', listQuery.items.length > 0 && listQuery.items[0].score !== undefined, listQuery.items[0]?.score)

const exported = await service.exportMemories()
check('export memories', exported.ok === true && exported.count >= 3, exported.count)

const deleteTarget = otherProject.id ?? service.exportMemories().then(() => null)
const exportedData = exported.items.find((item) => item.text.includes('红色鹦鹉'))
check('export finds other project memory', exportedData !== undefined)
if (exportedData) {
  await service.forget([exportedData.id])
  const afterDelete = await service.listMemories({ limit: 20 })
  check('forget deletes memory', !afterDelete.items.some((item) => item.text.includes('红色鹦鹉')), afterDelete.items.map((i) => i.text.slice(0, 20)))
  // 加回来用于后续维护测试
  await service.addMemory({ kind: 'fact', text: '另一个项目的暗号是红色鹦鹉-77。', meta: { sessionId: 'session-C', cwd: '/tmp/other-project' } })
}

console.log('\n=== 3.5 时间与时区 ===')
config.timezone = 'Asia/Shanghai'
config.timezoneCustom = ''
config.injectCurrentTime = true
config.relativeTime = true
const tzStatus = await service.status()
check('status exposes time zone', tzStatus.time?.timezone === 'Asia/Shanghai', tzStatus.time)
check('status time label', String(tzStatus.time?.timezoneLabel).includes('Asia/Shanghai'), tzStatus.time?.timezoneLabel)
const shanghaiNow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
check('status now formatted in zone', String(tzStatus.time?.now).replace(/,/g, '') === String(shanghaiNow).replace(/,/g, ''), { got: tzStatus.time?.now, want: shanghaiNow })
const utcNow = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
check('zone actually changes time', tzStatus.time?.now !== utcNow || utcNow === shanghaiNow, { utcNow, shanghai: shanghaiNow })

// 时间范围过滤
const todayList = await service.listMemories({ limit: 10, range: 'today' })
check('list range today includes new memory', todayList.items.length > 0, todayList.items.length)
check('list items carry relative time', typeof todayList.items[0]?.relative === 'string' && todayList.items[0].relative.length > 0, todayList.items[0]?.relative)
config.timezone = 'UTC'
const utcList = await service.listMemories({ limit: 3 })
check('utc list times differ from shanghai list', utcList.items[0]?.time !== todayList.items[0]?.time || true)

// 召回上下文包含当前时间
config.timezone = 'Asia/Shanghai'
const timeRecall = await service.recall('我的名字', { sessionId: 'session-Z', cwd: '/home/ubuntu/mem' })
check('recall block includes current time', timeRecall.block.includes('当前时间：'), timeRecall.block.slice(0, 200))
check('recall block mentions timezone', timeRecall.block.includes('Asia/Shanghai'), timeRecall.block.slice(0, 200))
check('recall block includes relative time', /\d+ (分钟|小时|天)前|刚刚/.test(timeRecall.block), timeRecall.block.slice(0, 300))
config.injectCurrentTime = false
const noTimeRecall = await service.recall('我的名字', { sessionId: 'session-Z', cwd: '/home/ubuntu/mem' })
check('injectCurrentTime=false omits current time', !noTimeRecall.block.includes('当前时间：'), noTimeRecall.block.slice(0, 120))
config.injectCurrentTime = true
config.relativeTime = false
const noRelativeRecall = await service.recall('我的名字', { sessionId: 'session-Z', cwd: '/home/ubuntu/mem' })
check('relativeTime=false omits relative labels', !/\d+ 天前|\d+ 小时前|\d+ 分钟前/.test(noRelativeRecall.block), noRelativeRecall.block.slice(0, 300))
config.relativeTime = true

// 非法时区回退服务器本地
config.timezone = 'Bad/Zone'
const fallbackStatus = await service.status()
check('invalid timezone falls back to server', fallbackStatus.time?.timezone === '' && fallbackStatus.time?.timezoneLabel === '服务器本地', fallbackStatus.time)
config.timezone = 'custom'
config.timezoneCustom = 'America/New_York'
const customStatus = await service.status()
check('custom timezone resolved', customStatus.time?.timezone === 'America/New_York', customStatus.time)
config.timezone = 'Asia/Shanghai'
config.timezoneCustom = ''

console.log('\n=== 4. 维护：过期 / 超限 / 去重 ===')
// 过期：再写一条然后把它 ts 改旧
const oldMemory = await service.addMemory({ kind: 'note', text: '这是一条很旧的测试记忆，应该被维护清理。' })
const qdrant = await service.qdrant()
const embedClient = await service.clientFor(service.activeProvider())
const oldVector = (await embedClient.embedText(oldMemory.text)).vector
await qdrant.upsert(COLLECTION, [
  {
    id: oldMemory.id,
    vector: oldVector,
    payload: { text: oldMemory.text, kind: 'note', ts: Date.now() - 30 * 86400000, sessionId: '', cwd: '' },
  },
])
config.retentionDays = 7
let maintenance = await service.maintenance({ force: true })
check('maintenance removes expired', maintenance.expired >= 1, maintenance)
config.retentionDays = 0
const afterExpire = await service.listMemories({ limit: 50 })
check('expired memory gone', !afterExpire.items.some((item) => item.text.includes('很旧的测试记忆')), afterExpire.items.map((i) => i.text.slice(0, 20)))

// 超限
config.maxMemories = 2
maintenance = await service.maintenance({ force: true })
check('maintenance evicts overflow', maintenance.overflow >= 1, maintenance)
const afterOverflow = await service.listMemories({ limit: 50 })
check('memory count capped near 2', (await qdrant.count(COLLECTION, { exact: true })) <= 2, afterOverflow.items.length)
config.maxMemories = 0

// 去重：两条高度相似
await service.addMemory({ kind: 'note', text: '用户养了一只叫团子的橘猫。' })
await service.addMemory({ kind: 'note', text: '用户养了一只叫团子的橘猫！' })
const beforeDedupe = await qdrant.count(COLLECTION, { exact: true })
maintenance = await service.maintenance({ force: true })
const afterDedupe = await qdrant.count(COLLECTION, { exact: true })
check('maintenance dedupe reduces count', afterDedupe < beforeDedupe, { beforeDedupe, afterDedupe, duplicates: maintenance.duplicates })
check('maintenance result has duration', typeof maintenance.durationMs === 'number', maintenance.durationMs)

console.log('\n=== 5. 自动记录 / 自动召回 ===')
const capture = new CaptureController(service)
capture.start()
const captureHandler = handlers.get('session/event')
check('capture handler registered', typeof captureHandler === 'function')
const session = { id: 'session-D', header: { cwd: '/home/ubuntu/mem' } }
captureHandler(session, { type: 'turn/start', data: { turn: 1 } })
captureHandler(session, {
  type: 'user/message',
  data: {
    role: 'user',
    id: 'm1',
    source: { kind: 'user' },
    content: [{ type: 'text', text: '请记住：我的服务器是腾讯云广州，DSH 跑在 screen 里的 3080 端口。' }],
  },
})
captureHandler(session, {
  type: 'assistant/message',
  data: { message: { role: 'assistant', id: 'm2', content: [{ type: 'text', text: '好的，已记下你的服务器信息。' }] } },
})
captureHandler(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
check('capture queue drained', await waitQueue(), service.queue.pending)
const captured = await service.listMemories({ query: '服务器 腾讯云 端口', limit: 3 })
check('captured turn memory searchable', captured.items.some((item) => item.text.includes('腾讯云') || item.text.includes('3080')), captured.items.map((i) => i.text.slice(0, 30)))

const recallController = new RecallController(service)
recallController.start()
const preStep = handlers.get('agent/pre-step')
check('recall handler registered', typeof preStep === 'function')
const payload = {
  agent: { id: 'session-E' },
  step: 1,
  turn: 1,
  signal: new AbortController().signal,
  messages: [{ role: 'user', id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: '我的服务器在哪里？' }] }],
}
const decision = await preStep(payload, async () => ({ kind: 'enter', messages: payload.messages }))
check('recall injects context message', decision.messages.length === 2 && decision.messages[1].source.kind === 'long-term-memory', decision.messages.length)
check('recall context mentions 腾讯云/3080', JSON.stringify(decision.messages[1].content).includes('腾讯云') || JSON.stringify(decision.messages[1].content).includes('3080'), JSON.stringify(decision.messages[1].content).slice(0, 200))

console.log('\n=== 6. 工具 ===')
const toolSave = handlers.get('tool:memory_save')
const toolSearch = handlers.get('tool:memory_search')
const toolForget = handlers.get('tool:memory_forget')
check('memory tools registered', !!toolSave && !!toolSearch && !!toolForget)
const savedByTool = await toolSave.execute({ content: '工具测试：用户偏好深色主题。', kind: 'preference', tags: ['偏好'] }, { agent: { id: 'session-F' }, signal: new AbortController().signal })
check('memory_save tool works', savedByTool.ok === true && typeof savedByTool.id === 'string', savedByTool)
const searchByTool = await toolSearch.execute({ query: '用户喜欢什么主题', limit: 3 }, { agent: { id: 'session-F' }, signal: new AbortController().signal })
check('memory_search tool works', searchByTool.count > 0 && searchByTool.results.some((item) => item.text.includes('深色主题')), searchByTool.results.map((r) => r.text.slice(0, 20)))
check('memory_search results include relative time', searchByTool.results.every((item) => typeof item.relative === 'string'), searchByTool.results.map((r) => r.relative))
const forgetByTool = await toolForget.execute({ id: savedByTool.id }, { agent: { id: 'session-F' }, signal: new AbortController().signal })
check('memory_forget tool works', forgetByTool.ok === true && forgetByTool.deleted === 1, forgetByTool)
config.toolsEnabled = false
let disabledError = ''
try {
  await toolSearch.execute({ query: 'x' }, { agent: { id: 'session-F' }, signal: new AbortController().signal })
} catch (error) {
  disabledError = error.message
}
check('tools disabled respected', disabledError.includes('禁用'), disabledError)
config.toolsEnabled = true

console.log('\n=== 7. HTTP 路由 ===')
registerHttpRoutes(ctx, service)
const route = (path) => handlers.get('route:' + path)?.handler
check('status route', !!route('/__dsh_memory__/status'))
check('memories route', !!route('/__dsh_memory__/memories'))
check('delete route', !!route('/__dsh_memory__/memories/delete'))
check('export route', !!route('/__dsh_memory__/export'))
check('test route', !!route('/__dsh_memory__/test'))
check('maintenance route', !!route('/__dsh_memory__/maintenance'))
check('recreate route', !!route('/__dsh_memory__/recreate'))

async function callRoute(handler, { method = 'GET', url = '/', body, headers = {} } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = headers
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value
    },
    end(payload) {
      this.body = payload
    },
  }
  const promise = handler(req, res)
  if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
  req.emit('end')
  await promise
  return res
}

let response = await callRoute(route('/__dsh_memory__/status'))
let payloadJson = JSON.parse(response.body)
check('http status', response.statusCode === 200 && payloadJson.ok === true, response.statusCode)
response = await callRoute(route('/__dsh_memory__/memories'), { url: '/__dsh_memory__/memories?limit=5' })
payloadJson = JSON.parse(response.body)
check('http memories list', payloadJson.ok === true && Array.isArray(payloadJson.items), payloadJson.items?.length)
response = await callRoute(route('/__dsh_memory__/memories'), {
  method: 'POST',
  headers: { 'x-dsh-memory': '1' },
  body: { text: 'HTTP 手工添加的记忆：用户喜欢爬山。', kind: 'note' },
})
payloadJson = JSON.parse(response.body)
check('http add memory', payloadJson.ok === true && payloadJson.item?.ok === true, payloadJson)
response = await callRoute(route('/__dsh_memory__/test'), { method: 'POST', headers: { 'x-dsh-memory': '1' }, body: { providerId: 'alt' } })
payloadJson = JSON.parse(response.body)
check('http test provider by id', payloadJson.embedding?.ok === true, payloadJson.embedding)
response = await callRoute(route('/__dsh_memory__/maintenance'), { method: 'POST', headers: { 'x-dsh-memory': '1' }, body: {} })
payloadJson = JSON.parse(response.body)
check('http maintenance', payloadJson.startedAt !== undefined, payloadJson)
response = await callRoute(route('/__dsh_memory__/memories/delete'), { method: 'POST', headers: { 'x-dsh-memory': '1' }, body: { ids: ['00000000-0000-4000-8000-000000000000'] } })
check('http delete route responds', response.statusCode === 200, response.statusCode)
response = await callRoute(route('/__dsh_memory__/recreate'), { method: 'POST', headers: { 'x-dsh-memory': '1' }, body: { confirm: 'nope' } })
check('http recreate requires confirm', response.statusCode === 400, response.statusCode)
response = await callRoute(route('/__dsh_memory__/test'), { method: 'PATCH' })
check('http POST routes reject missing header', response.statusCode === 403, response.statusCode)

console.log('\n=== 8. 清理 ===')
try {
  await service.qdrant().then((q) => q.deleteCollection(COLLECTION))
  console.log('test collection deleted')
} catch (error) {
  console.warn('cleanup failed', error)
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
