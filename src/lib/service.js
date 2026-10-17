/**
 * MemoryService：插件核心业务对象（v0.2）。
 *
 * 职责：
 * - 读取（会热更新的）插件配置；
 * - 多 provider 档案：解析激活的 provider、凭据、视觉模型；
 * - 嵌入文本并写入 Qdrant；
 * - 自动记录一轮对话要点 / 图片概览；
 * - 按记忆范围检索（全局 / 工作区 / 会话）；
 * - 记忆管理：列表、搜索、删除、导出、重建；
 * - 保留策略与定期维护（过期清理、超限淘汰、相似重复合并、索引重建）；
 * - 状态、测试、后台队列。
 */
import { DIMENSIONS } from './config.js'
import { OpenAICompatClient, DEFAULT_CAPTION_PROMPT } from './api-client.js'
import { QdrantClient } from './qdrant.js'
import {
  SerialQueue,
  asBool,
  clampInt,
  clampNumber,
  cleanText,
  errorText,
  formatTime,
  memoryPointId,
  normalizeUrl,
  providerIdToEnv,
  readConfig,
  redactSecrets,
  toDataUri,
  truncate,
} from './util.js'

/** 自动召回注入消息的 source.kind；DSH 会把它渲染成“上下文注入”行而不是用户气泡。 */
export const MEMORY_SOURCE = 'long-term-memory'

/** 自动召回上下文消息的标题前缀。 */
export const RECALL_HEADER = '【长期记忆·自动召回】'

/** provider 列表为空时的内置兜底配置（与 bundle 默认值一致）。 */
export const BUILTIN_PROVIDER = {
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
}

/** 规范化的空 provider 字段。 */
function emptyProvider() {
  return {
    id: '',
    name: '',
    protocol: 'openai',
    baseUrl: '',
    embedModel: '',
    dimensions: 1024,
    apiKeyEnv: '',
    sendDimensions: true,
    visionModel: '',
    visionBaseUrl: '',
    visionApiKeyEnv: '',
  }
}

/** 把任意 provider 记录规范化（字符串修剪、维度取整、缺省补全）。 */
export function normalizeProvider(raw, index) {
  const base = emptyProvider()
  const value = raw && typeof raw === 'object' ? raw : {}
  const id = String(value.id ?? base.id).trim() || `provider_${index + 1}`
  return {
    id,
    name: String(value.name ?? '').trim() || id,
    protocol: String(value.protocol ?? 'openai').trim() || 'openai',
    baseUrl: normalizeUrl(value.baseUrl ?? ''),
    embedModel: String(value.embedModel ?? '').trim(),
    dimensions: clampInt(value.dimensions, base.dimensions, 1, 65536),
    apiKeyEnv: String(value.apiKeyEnv ?? '').trim(),
    sendDimensions: asBool(value.sendDimensions, true),
    visionModel: String(value.visionModel ?? '').trim(),
    visionBaseUrl: normalizeUrl(value.visionBaseUrl ?? ''),
    visionApiKeyEnv: String(value.visionApiKeyEnv ?? '').trim(),
  }
}

/** 选择合法的向量维度。 */
function pickDimensions(value) {
  const n = clampInt(value, 1024, 1, 65536)
  return DIMENSIONS.includes(n) ? n : n
}

/** 去掉 meta 里的 undefined / null，保证 payload 是纯 JSON。 */
function sanitizeMeta(meta) {
  const out = {}
  for (const [key, value] of Object.entries(meta ?? {})) {
    if (value === undefined || value === null) continue
    out[key] = value
  }
  return out
}

export class MemoryService {
  /**
   * @param {object} ctx DSH 插件上下文
   * @param {object} config schemastery Config 实例（字段可能包着 volatile Ref）
   */
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    this.logger = ctx.logger ?? console
    this.queue = new SerialQueue(this.logger)
    this.stats = {
      startedAt: Date.now(),
      writes: 0,
      lastWriteAt: 0,
      lastWriteKind: null,
      lastRecallAt: 0,
      lastRecallCount: 0,
      recallChecks: 0,
      lastRecallQuery: '',
      lastRecallError: '',
      lastRecallInjectAt: 0,
      captions: 0,
      lastMaintenanceAt: 0,
      lastMaintenance: null,
    }
    this.collectionState = {
      signature: null,
      ok: false,
      error: null,
      checkedAt: 0,
      info: null,
    }
  }

  // ------------------------------------------------------------------
  // 配置与 provider
  // ------------------------------------------------------------------

  /** 当前配置（解包 volatile）。 */
  cfg() {
    return readConfig(this.config)
  }

  /** 全部 provider 档案（空列表时回退内置 SiliconFlow）。 */
  providers() {
    const raw = this.cfg().providers
    const list = Array.isArray(raw) ? raw : []
    const normalized = list
      .map((item, index) => normalizeProvider(item, index))
      .filter((item) => item.baseUrl !== '' && item.embedModel !== '')
    return normalized.length > 0 ? normalized : [normalizeProvider(BUILTIN_PROVIDER, 0)]
  }

  /** 当前激活的 provider。 */
  activeProvider() {
    const cfg = this.cfg()
    const list = this.providers()
    const wanted = String(cfg.activeProvider ?? '').trim()
    return list.find((item) => item.id === wanted) ?? list[0]
  }

  /** 按 id 查找 provider。 */
  providerById(id) {
    const key = String(id ?? '').trim()
    return this.providers().find((item) => item.id === key) ?? null
  }

  /** provider 的 Key 在凭据库中的引用名。 */
  credentialRef(provider) {
    const explicit = String(provider?.apiKeyEnv ?? '').trim()
    return explicit || providerIdToEnv(provider?.id)
  }

  /** 视觉概览接口配置（visionBaseUrl / visionApiKeyEnv 可覆盖）。 */
  visionConfigOf(provider) {
    const base = provider?.visionBaseUrl || provider?.baseUrl || ''
    const ref = String(provider?.visionApiKeyEnv ?? '').trim() || this.credentialRef(provider)
    return { baseUrl: normalizeUrl(base), model: String(provider?.visionModel ?? '').trim(), ref }
  }

  /** 读取凭据值（空字符串代表未配置）。 */
  async resolveKey(ref) {
    const name = String(ref ?? '').trim()
    if (!name) return ''
    try {
      const resolved = await this.ctx.credentials.resolve(name)
      return resolved?.value ?? ''
    } catch (error) {
      this.logger.warn?.(`[dsh-memory] 读取凭据 ${name} 失败：${errorText(error)}`)
      return ''
    }
  }

  /** 凭据状态（不含密钥本身）。 */
  async credentialInfo(ref) {
    const name = String(ref ?? '').trim()
    if (!name) return { configured: false, writable: true, source: '', ref: '' }
    try {
      const info = await this.ctx.credentials.describe(name)
      return { ...info, ref: name }
    } catch (error) {
      return { configured: false, writable: false, source: '', ref: name, error: errorText(error) }
    }
  }

  /** 为指定 provider 构造 OpenAI 兼容客户端。 */
  async clientFor(provider) {
    const embeddingRef = this.credentialRef(provider)
    const embeddingKey = await this.resolveKey(embeddingRef)
    const vision = this.visionConfigOf(provider)
    const visionKey = vision.ref === embeddingRef ? embeddingKey : await this.resolveKey(vision.ref)
    if (!embeddingKey) {
      throw new Error(
        `尚未配置 ${provider.name}（${provider.id}）的 API Key：请在 Settings → 长期记忆 → 模型与向量库 中填写（凭据引用 ${embeddingRef}）`,
      )
    }
    return new OpenAICompatClient({
      label: provider.name || provider.id,
      baseUrl: provider.baseUrl,
      apiKey: embeddingKey,
      embedModel: provider.embedModel,
      dimensions: provider.dimensions,
      sendDimensions: provider.sendDimensions,
      visionModel: vision.model,
      visionBaseUrl: vision.baseUrl,
      visionApiKey: visionKey,
      logger: this.logger,
    })
  }

  // ------------------------------------------------------------------
  // 行为 / 存储 / 范围
  // ------------------------------------------------------------------

  /** 存储配置。 */
  storage() {
    const cfg = this.cfg()
    return {
      qdrantUrl: normalizeUrl(cfg.qdrantUrl || 'http://127.0.0.1:6333'),
      collection: String(cfg.collection ?? 'dsh_memory').trim() || 'dsh_memory',
      qdrantApiKeyEnv: String(cfg.qdrantApiKeyEnv ?? '').trim(),
    }
  }

  /** 自动记录配置。 */
  captureOptions() {
    const cfg = this.cfg()
    return {
      autoCapture: cfg.autoCapture !== false,
      captureUserChars: Math.max(0, clampInt(cfg.captureUserChars, 400, 0, 20000)),
      captureAssistantChars: Math.max(0, clampInt(cfg.captureAssistantChars, 400, 0, 20000)),
      captureMinChars: Math.max(0, clampInt(cfg.captureMinChars, 12, 0, 20000)),
      includeSubagents: cfg.includeSubagents === true,
    }
  }

  /** 自动召回配置。 */
  recallOptions() {
    const cfg = this.cfg()
    const scope = cfg.memoryScope === 'workspace' || cfg.memoryScope === 'session' ? cfg.memoryScope : 'global'
    return {
      autoRecall: cfg.autoRecall !== false,
      memoryScope: scope,
      recallTopK: clampInt(cfg.recallTopK, 3, 1, 20),
      recallMinScore: clampNumber(cfg.recallMinScore, 0.42, 0, 1),
      recallMaxChars: clampInt(cfg.recallMaxChars, 600, 100, 4000),
      recallIncludeCurrentSession: cfg.recallIncludeCurrentSession === true,
      recallTimeoutMs: clampInt(cfg.recallTimeoutMs, 3000, 500, 20000),
    }
  }

  /** 工具配置。 */
  toolOptions() {
    const cfg = this.cfg()
    return {
      toolsEnabled: cfg.toolsEnabled !== false,
      searchLimit: clampInt(cfg.toolSearchLimit, 5, 1, 20),
    }
  }

  /** 维护 / 保留配置。 */
  maintenanceOptions() {
    const cfg = this.cfg()
    return {
      retentionDays: Math.max(0, clampInt(cfg.retentionDays, 0, 0, 36500)),
      maxMemories: Math.max(0, clampInt(cfg.maxMemories, 0, 0, 10000000)),
      maintenanceIntervalHours: clampInt(cfg.maintenanceIntervalHours, 6, 1, 168),
      maintenanceDedupe: cfg.maintenanceDedupe !== false,
      dedupeThreshold: clampNumber(cfg.dedupeThreshold, 0.96, 0.8, 1),
      dedupeMaxScan: clampInt(cfg.dedupeMaxScan, 100, 10, 1000),
    }
  }

  /** 图片概览配置。 */
  imageOptions() {
    const cfg = this.cfg()
    return {
      imageMode: cfg.imageMode === 'placeholder' || cfg.imageMode === 'off' ? cfg.imageMode : 'caption',
      captionPrompt: String(cfg.captionPrompt ?? '').trim() || DEFAULT_CAPTION_PROMPT,
      captionMaxTokens: clampInt(cfg.captionMaxTokens, 96, 16, 1024),
    }
  }

  /** 当前 agent 的会话上下文（用于作用域过滤）。 */
  sessionContext(agentId) {
    const id = String(agentId ?? '')
    let cwd = ''
    try {
      const session = this.ctx.sessions?.get?.(id)
      cwd = String(session?.header?.cwd ?? '')
    } catch {
      /* ignore */
    }
    return { sessionId: id, cwd }
  }

  /**
   * 构造 Qdrant 过滤条件。
   * @param {object} options
   * @param {'global'|'workspace'|'session'} [options.mode]
   * @param {string} [options.sessionId] 当前会话
   * @param {string} [options.cwd] 当前工作目录
   * @param {boolean} [options.includeCurrentSession] 是否包含当前会话
   * @param {string} [options.kind] 只查某类记忆
   */
  buildFilter({ mode = 'global', sessionId = '', cwd = '', includeCurrentSession = false, kind = '' } = {}) {
    const must = []
    const mustNot = []
    if (mode === 'session') {
      if (sessionId) must.push({ key: 'sessionId', match: { value: sessionId } })
    } else if (mode === 'workspace') {
      if (cwd) must.push({ key: 'cwd', match: { value: cwd } })
      if (!includeCurrentSession && sessionId) {
        mustNot.push({ key: 'sessionId', match: { value: sessionId } })
      }
    } else if (!includeCurrentSession && sessionId) {
      mustNot.push({ key: 'sessionId', match: { value: sessionId } })
    }
    if (kind) must.push({ key: 'kind', match: { value: kind } })
    const filter = {}
    if (must.length > 0) filter.must = must
    if (mustNot.length > 0) filter.must_not = mustNot
    return Object.keys(filter).length > 0 ? filter : undefined
  }

  // ------------------------------------------------------------------
  // Qdrant 与集合
  // ------------------------------------------------------------------

  /** 构造 Qdrant 客户端（支持可选 api-key）。 */
  async qdrant() {
    const storage = this.storage()
    let apiKey = ''
    if (storage.qdrantApiKeyEnv) apiKey = await this.resolveKey(storage.qdrantApiKeyEnv)
    return new QdrantClient({ url: storage.qdrantUrl, apiKey, logger: this.logger })
  }

  /** 确保集合存在且与激活 provider 的维度一致。 */
  async ensureReady({ force = false } = {}) {
    const provider = this.activeProvider()
    const storage = this.storage()
    const signature = `${storage.qdrantUrl}|${storage.collection}|${provider.dimensions}`
    const now = Date.now()
    if (
      !force &&
      this.collectionState.signature === signature &&
      now - this.collectionState.checkedAt < 30000
    ) {
      if (this.collectionState.ok) return this.collectionState.info
      throw new Error(this.collectionState.error ?? 'Qdrant 不可用')
    }
    const qdrant = await this.qdrant()
    try {
      const result = await qdrant.ensureCollection(storage.collection, provider.dimensions)
      this.collectionState = {
        signature,
        ok: result.ok,
        error: result.ok ? null : (result.error ?? '集合不可用'),
        checkedAt: now,
        info: result.info ?? null,
      }
      if (!result.ok) throw new Error(this.collectionState.error)
      return result.info
    } catch (error) {
      this.collectionState = {
        signature,
        ok: false,
        error: errorText(error),
        checkedAt: now,
        info: null,
      }
      throw error
    }
  }

  // ------------------------------------------------------------------
  // 写入
  // ------------------------------------------------------------------

  /** 写入一条记忆（内容相同时覆盖同一 point 实现去重）。 */
  async addMemory({ kind, text, meta = {}, signal }) {
    const provider = this.activeProvider()
    const body = redactSecrets(cleanText(text))
    if (!body) throw new Error('记忆内容为空，已跳过')
    const client = await this.clientFor(provider)
    const embedded = await client.embedText(body, { signal })
    if (embedded.vector.length !== provider.dimensions) {
      throw new Error(
        `嵌入维度不一致：provider 配置 ${provider.dimensions}，服务返回 ${embedded.vector.length}；请修正 provider 维度配置或重建集合`,
      )
    }
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    const id = memoryPointId(`${kind}|${body}`)
    const payload = sanitizeMeta({
      text: body,
      kind,
      ts: Date.now(),
      provider: provider.id,
      model: provider.embedModel,
      dimensions: provider.dimensions,
      ...meta,
    })
    await qdrant.upsert(storage.collection, [{ id, vector: embedded.vector, payload }], { signal })
    this.stats.writes += 1
    this.stats.lastWriteAt = payload.ts
    this.stats.lastWriteKind = kind
    this.debugLog(`写入 ${kind} 记忆 ${id}（${body.length} 字，provider=${provider.id}）`)
    return { ok: true, id, text: body }
  }

  /** 记录一轮对话要点。 */
  async addTurnMemory({ userText, assistantText, sessionId, cwd, turn, imageCount = 0 }) {
    const options = this.captureOptions()
    const user = truncate(cleanText(userText), options.captureUserChars)
    const assistant = truncate(cleanText(assistantText), options.captureAssistantChars)
    if (user.length + assistant.length < options.captureMinChars) return { ok: false, skipped: 'too-short' }
    const parts = []
    if (user) parts.push(`用户：${user}`)
    if (assistant) parts.push(`助手：${assistant}`)
    if (imageCount > 0) parts.push(`（本轮附有 ${imageCount} 张图片）`)
    return this.addMemory({
      kind: 'turn',
      text: parts.join('\n'),
      meta: {
        sessionId: String(sessionId ?? ''),
        cwd: String(cwd ?? ''),
        turn: Number(turn) || 0,
        hasImages: imageCount > 0,
      },
    })
  }

  /** 记录一张图片：只存一句话概览，永不存原图。 */
  async addImageMemory({ ref, sessionId, cwd, turn }) {
    const image = this.imageOptions()
    if (image.imageMode === 'off') return { ok: false, skipped: 'image-mode-off' }
    const provider = this.activeProvider()
    const vision = this.visionConfigOf(provider)
    const mediaType = ref?.mediaType || 'image/png'
    const imageMeta = {
      mediaType: String(mediaType),
      width: Number(ref?.width) || null,
      height: Number(ref?.height) || null,
    }
    let text
    let caption = null
    if (image.imageMode === 'caption' && vision.model) {
      try {
        const stored = await this.ctx.attachments.readImage(ref)
        const dataUri = toDataUri(stored?.data ?? stored, mediaType)
        const client = await this.clientFor(provider)
        const result = await client.captionImage(dataUri, {
          prompt: image.captionPrompt,
          maxTokens: image.captionMaxTokens,
        })
        caption = cleanText(result.text)
        text = `图片概览：${caption || '（模型未返回描述）'}`
        this.stats.captions += 1
      } catch (error) {
        this.logger.warn?.(`[dsh-memory] 图片概览失败，降级为占位记录：${errorText(error)}`)
        text = '用户发送了一张图片（概览生成失败，仅记录图片存在）'
      }
    } else {
      text = '用户发送了一张图片（未解析图片内容）'
    }
    return this.addMemory({
      kind: 'image',
      text,
      meta: {
        sessionId: String(sessionId ?? ''),
        cwd: String(cwd ?? ''),
        turn: Number(turn) || 0,
        image: imageMeta,
        caption,
      },
    })
  }

  // ------------------------------------------------------------------
  // 检索 / 召回
  // ------------------------------------------------------------------

  /** 检索记忆。 */
  async search(query, options = {}) {
    const text = cleanText(query)
    if (!text) return { hits: [], query: '' }
    const provider = this.activeProvider()
    const client = await this.clientFor(provider)
    const embedded = await client.embedText(text, { signal: options.signal })
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    const filter =
      options.filter ??
      this.buildFilter({
        mode: options.mode ?? 'global',
        sessionId: options.sessionId ?? '',
        cwd: options.cwd ?? '',
        includeCurrentSession: options.includeCurrentSession === true,
        kind: options.kind ?? '',
      })
    const points = await qdrant.search(
      storage.collection,
      {
        vector: embedded.vector,
        limit: clampInt(options.limit, 3, 1, 100),
        scoreThreshold: Number.isFinite(Number(options.minScore)) ? Number(options.minScore) : undefined,
        filter,
      },
      { signal: options.signal },
    )
    const hits = points.map((point) => {
      const payload = point?.payload ?? {}
      const ts = Number(payload.ts) || 0
      return {
        id: String(point?.id ?? ''),
        score: Number(point?.score) || 0,
        text: String(payload.text ?? ''),
        kind: String(payload.kind ?? ''),
        ts,
        time: formatTime(ts),
        sessionId: payload.sessionId ? String(payload.sessionId) : '',
        cwd: payload.cwd ? String(payload.cwd) : '',
        tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
        provider: payload.provider ? String(payload.provider) : '',
      }
    })
    return { hits, query: text, usage: embedded.usage }
  }

  /** 自动召回：检索并组装成注入上下文块。 */
  async recall(query, { signal, sessionId = '', cwd = '' } = {}) {
    const options = this.recallOptions()
    const { hits } = await this.search(query, {
      limit: options.recallTopK,
      minScore: options.recallMinScore,
      mode: options.memoryScope,
      sessionId,
      cwd,
      includeCurrentSession: options.recallIncludeCurrentSession,
      signal,
    })
    const filtered = hits.filter((hit) => hit.text.length > 0)
    if (filtered.length === 0) return { hits: [], block: '' }
    const lines = []
    for (const [index, hit] of filtered.entries()) {
      const kindLabel =
        hit.kind === 'image' ? '图片' : hit.kind === 'fact' ? '事实' : hit.kind === 'turn' ? '对话' : '记忆'
      lines.push(`${index + 1}. [${hit.time}·${kindLabel}] ${truncate(hit.text, 220)}`)
    }
    let block = `${RECALL_HEADER}\n以下是从过去会话中检索到的相关记忆，仅供参考；若与当前对话冲突，以当前对话为准：\n${lines.join('\n')}`
    block = truncate(block, options.recallMaxChars)
    this.stats.lastRecallAt = Date.now()
    this.stats.lastRecallCount = filtered.length
    return { hits: filtered, block }
  }

  // ------------------------------------------------------------------
  // 记忆管理
  // ------------------------------------------------------------------

  /** 把 Qdrant point 映射成管理界面用的条目。 */
  #pointToItem(point, score) {
    const payload = point?.payload ?? {}
    const ts = Number(payload.ts) || 0
    return {
      id: String(point?.id ?? ''),
      text: String(payload.text ?? ''),
      kind: String(payload.kind ?? ''),
      ts,
      time: formatTime(ts),
      sessionId: payload.sessionId ? String(payload.sessionId) : '',
      cwd: payload.cwd ? String(payload.cwd) : '',
      tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
      provider: payload.provider ? String(payload.provider) : '',
      ...(Number.isFinite(score) ? { score } : {}),
    }
  }

  /** 记忆列表：带 query 走向量检索，否则按时间倒序滚动。 */
  async listMemories({ query = '', limit = 20, offset = null, kind = '' } = {}) {
    const cleanQuery = cleanText(query)
    const pageSize = clampInt(limit, 20, 1, 100)
    if (cleanQuery) {
      const { hits } = await this.search(cleanQuery, { limit: pageSize, kind })
      return { items: hits, nextOffset: null, total: hits.length, query: cleanQuery }
    }
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    const filter = kind ? { must: [{ key: 'kind', match: { value: kind } }] } : undefined
    const { points, nextOffset } = await qdrant.scroll(storage.collection, {
      limit: pageSize,
      offset: offset ?? undefined,
      orderBy: { key: 'ts', direction: 'desc' },
      filter,
    })
    let total = null
    try {
      total = await qdrant.count(storage.collection, { filter, exact: false })
    } catch {
      /* ignore */
    }
    return {
      items: points.map((point) => this.#pointToItem(point)),
      nextOffset: nextOffset ?? null,
      total,
      query: '',
    }
  }

  /** 导出全部记忆。 */
  async exportMemories({ maxItems = 20000 } = {}) {
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    const items = []
    let offset = undefined
    while (items.length < maxItems) {
      const { points, nextOffset } = await qdrant.scroll(storage.collection, {
        limit: 256,
        offset,
        orderBy: { key: 'ts', direction: 'asc' },
      })
      for (const point of points) items.push(this.#pointToItem(point))
      if (!nextOffset || points.length === 0) break
      offset = nextOffset
    }
    return { ok: true, count: items.length, exportedAt: new Date().toISOString(), items }
  }

  /** 删除记忆。 */
  async forget(ids) {
    const list = (Array.isArray(ids) ? ids : [ids]).map(String).filter(Boolean)
    if (list.length === 0) throw new Error('需要提供要删除的记忆 id（可先用 memory_search 查询）')
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    await qdrant.deletePoints(storage.collection, list)
    return { ok: true, deleted: list.length }
  }

  /** 重建集合（维度变更 / 数据清空时使用，会删除全部记忆）。 */
  async recreateCollection() {
    const provider = this.activeProvider()
    const storage = this.storage()
    const qdrant = await this.qdrant()
    const result = await qdrant.recreateCollection(storage.collection, provider.dimensions)
    this.collectionState = {
      signature: `${storage.qdrantUrl}|${storage.collection}|${provider.dimensions}`,
      ok: result.ok,
      error: result.ok ? null : (result.error ?? '重建失败'),
      checkedAt: Date.now(),
      info: result.info ?? null,
    }
    return result
  }

  // ------------------------------------------------------------------
  // 定期维护
  // ------------------------------------------------------------------

  /**
   * 定期维护：过期清理 → 超限淘汰 → 相似重复合并 → 索引重建。
   * @returns {Promise<object>} 维护结果
   */
  async maintenance({ force = false } = {}) {
    const options = this.maintenanceOptions()
    const info = await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    const result = {
      ok: true,
      startedAt: Date.now(),
      collection: storage.collection,
      pointsBefore: info?.points ?? null,
      expired: 0,
      overflow: 0,
      duplicates: 0,
      errors: [],
    }
    try {
      // 1) 过期清理
      if (options.retentionDays > 0 || force) {
        const cutoff = Date.now() - options.retentionDays * 86400000
        if (options.retentionDays > 0) {
          const before = await qdrant.count(storage.collection, { exact: true })
          await qdrant.deleteByFilter(storage.collection, {
            must: [{ key: 'ts', range: { lt: cutoff } }],
          })
          const after = await qdrant.count(storage.collection, { exact: true })
          result.expired = Math.max(0, before - after)
        }
      }
      // 2) 条数上限淘汰（从最旧开始）
      if (options.maxMemories > 0) {
        let count = await qdrant.count(storage.collection, { exact: true })
        let guard = 0
        while (count > options.maxMemories && guard < 100) {
          guard += 1
          const excess = count - options.maxMemories
          const { points } = await qdrant.scroll(storage.collection, {
            limit: Math.min(256, excess),
            orderBy: { key: 'ts', direction: 'asc' },
          })
          if (points.length === 0) break
          const ids = points.map((point) => String(point.id))
          await qdrant.deletePoints(storage.collection, ids)
          result.overflow += ids.length
          count -= ids.length
        }
      }
      // 3) 相似重复合并（只扫描最近的 N 条）
      if (options.maintenanceDedupe) {
        const { points } = await qdrant.scroll(storage.collection, {
          limit: options.dedupeMaxScan,
          orderBy: { key: 'ts', direction: 'desc' },
          withPayload: true,
          withVector: true,
        })
        const deleted = new Set()
        const byId = new Map(points.map((point) => [String(point.id), point]))
        for (const point of points) {
          const id = String(point.id)
          if (deleted.has(id)) continue
          const vector = Array.isArray(point.vector) ? point.vector : point.vector?.default ?? null
          if (!Array.isArray(vector)) continue
          let similar = []
          try {
            similar = await qdrant.search(storage.collection, {
              vector,
              limit: 5,
              scoreThreshold: options.dedupeThreshold,
            })
          } catch (error) {
            result.errors.push(`dedupe search: ${errorText(error)}`)
            break
          }
          for (const candidate of similar) {
            const candidateId = String(candidate.id)
            if (candidateId === id || deleted.has(candidateId)) continue
            const other = byId.get(candidateId)
            const otherTs = Number(other?.payload?.ts) || Number(candidate?.payload?.ts) || 0
            const selfTs = Number(point?.payload?.ts) || 0
            const olderId = otherTs < selfTs ? candidateId : id
            const keepId = olderId === candidateId ? id : candidateId
            if (olderId === id) {
              // 自己更旧：删自己，跳出（也把 candidate 标记为已处理）
              deleted.add(id)
              try {
                await qdrant.deletePoints(storage.collection, [id])
                result.duplicates += 1
              } catch (error) {
                result.errors.push(`dedupe delete: ${errorText(error)}`)
              }
              break
            }
            deleted.add(candidateId)
            try {
              await qdrant.deletePoints(storage.collection, [candidateId])
              result.duplicates += 1
            } catch (error) {
              result.errors.push(`dedupe delete: ${errorText(error)}`)
            }
            void keepId
          }
        }
      }
      // 4) 索引重建（幂等）
      await qdrant.ensurePayloadIndexes(storage.collection)
    } catch (error) {
      result.ok = false
      result.errors.push(errorText(error))
    }
    result.finishedAt = Date.now()
    result.durationMs = result.finishedAt - result.startedAt
    this.stats.lastMaintenanceAt = result.finishedAt
    this.stats.lastMaintenance = result
    if (options.debug || result.errors.length > 0) {
      this.logger.info?.(
        `[dsh-memory] 维护完成：过期 ${result.expired}，超限 ${result.overflow}，重复 ${result.duplicates}，错误 ${result.errors.length}`,
      )
    }
    return result
  }

  // ------------------------------------------------------------------
  // 状态 / 测试
  // ------------------------------------------------------------------

  /** 设置页状态快照。 */
  async status() {
    const provider = this.activeProvider()
    const recall = this.recallOptions()
    const capture = this.captureOptions()
    const storage = this.storage()
    const toolOptions = this.toolOptions()
    const maintenanceOptions = this.maintenanceOptions()
    const info = {
      ok: true,
      app: {
        name: 'dsh-memory',
        version: '0.2.0',
        startedAt: this.stats.startedAt,
      },
      provider: {
        id: provider.id,
        name: provider.name,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        embedModel: provider.embedModel,
        dimensions: provider.dimensions,
        visionModel: provider.visionModel,
        visionBaseUrl: this.visionConfigOf(provider).baseUrl,
        apiKeyEnv: this.credentialRef(provider),
        visionApiKeyEnv: this.visionConfigOf(provider).ref,
      },
      providers: [],
      storage: { ...storage },
      behavior: {
        autoCapture: capture.autoCapture,
        autoRecall: recall.autoRecall,
        memoryScope: recall.memoryScope,
        recallTopK: recall.recallTopK,
        recallMinScore: recall.recallMinScore,
        recallMaxChars: recall.recallMaxChars,
        recallIncludeCurrentSession: recall.recallIncludeCurrentSession,
        recallTimeoutMs: recall.recallTimeoutMs,
        imageMode: this.cfg().imageMode ?? 'caption',
        toolsEnabled: toolOptions.toolsEnabled,
      },
      retention: { ...maintenanceOptions },
      credential: null,
      qdrant: { ok: false, version: null, error: null },
      collection: { name: storage.collection, exists: false, points: 0, size: null, error: null, payloadIndexes: [] },
      queue: {
        pending: this.queue.pending,
        done: this.queue.done,
        failed: this.queue.failed,
        lastError: this.queue.lastError,
        lastErrorTime: this.queue.lastErrorAt ? formatTime(this.queue.lastErrorAt) : '',
      },
      stats: {
        writes: this.stats.writes,
        lastWriteTime: this.stats.lastWriteAt ? formatTime(this.stats.lastWriteAt) : '',
        lastWriteKind: this.stats.lastWriteKind,
        lastRecallTime: this.stats.lastRecallAt ? formatTime(this.stats.lastRecallAt) : '',
        lastRecallCount: this.stats.lastRecallCount,
        recallChecks: this.stats.recallChecks,
        lastRecallQuery: this.stats.lastRecallQuery,
        lastRecallError: this.stats.lastRecallError,
        lastRecallInjectTime: this.stats.lastRecallInjectAt ? formatTime(this.stats.lastRecallInjectAt) : '',
        captions: this.stats.captions,
        startedAt: this.stats.startedAt,
        lastMaintenanceTime: this.stats.lastMaintenanceAt ? formatTime(this.stats.lastMaintenanceAt) : '',
        lastMaintenance: this.stats.lastMaintenance,
      },
      collectionState: {
        ok: this.collectionState.ok,
        error: this.collectionState.error,
        checkedAt: this.collectionState.checkedAt ? formatTime(this.collectionState.checkedAt) : '',
      },
    }
    try {
      info.credential = await this.credentialInfo(this.credentialRef(provider))
    } catch (error) {
      info.credential = { configured: false, writable: false, error: errorText(error) }
    }
    // 每个 provider 的 Key 状态
    const providers = this.providers()
    info.providers = await Promise.all(
      providers.map(async (item) => {
        const ref = this.credentialRef(item)
        let configured = false
        try {
          const described = await this.ctx.credentials.describe(ref)
          configured = described?.configured === true
        } catch {
          /* ignore */
        }
        const vision = this.visionConfigOf(item)
        let visionConfigured = configured
        if (vision.ref && vision.ref !== ref) {
          try {
            const described = await this.ctx.credentials.describe(vision.ref)
            visionConfigured = described?.configured === true
          } catch {
            visionConfigured = false
          }
        }
        return {
          ...item,
          apiKeyEnv: ref,
          visionApiKeyEnv: vision.ref,
          keyConfigured: configured,
          visionKeyConfigured: visionConfigured,
          active: item.id === provider.id,
        }
      }),
    )
    try {
      const qdrant = await this.qdrant()
      const health = await qdrant.health()
      info.qdrant = { ok: true, version: health.version, error: null }
      try {
        const collection = await qdrant.collectionInfo(storage.collection)
        info.collection = {
          name: storage.collection,
          exists: collection !== null,
          points: collection?.points ?? 0,
          size: collection?.size ?? null,
          payloadIndexes: collection?.payloadIndexes ?? [],
          error: null,
        }
      } catch (error) {
        info.collection.error = errorText(error)
      }
    } catch (error) {
      info.qdrant = { ok: false, version: null, error: errorText(error) }
      info.ok = false
    }
    return info
  }

  /**
   * 设置页“测试连接”：默认测试激活 provider；传 providerId 测试指定档案。
   */
  async test(providerId) {
    const provider = providerId ? this.providerById(providerId) : this.activeProvider()
    if (!provider) throw new Error(`未找到 provider：${providerId}`)
    const results = { provider: { id: provider.id, name: provider.name, embeddingModel: provider.embedModel, dimensions: provider.dimensions, visionModel: provider.visionModel } }
    try {
      const client = await this.clientFor(provider)
      const embedded = await client.embedText('长期记忆连接测试 ping', { timeoutMs: 30000 })
      results.embedding = {
        ok: true,
        latencyMs: embedded.latencyMs,
        dimensions: embedded.vector.length,
        usage: embedded.usage,
      }
    } catch (error) {
      results.embedding = { ok: false, error: errorText(error) }
    }
    try {
      const qdrant = await this.qdrant()
      const health = await qdrant.health()
      let collection = null
      try {
        collection = await qdrant.collectionInfo(this.storage().collection)
      } catch {
        /* collection 错误在 status 中体现 */
      }
      results.qdrant = {
        ok: true,
        version: health.version,
        collectionExists: collection !== null,
        points: collection?.points ?? 0,
        size: collection?.size ?? null,
      }
    } catch (error) {
      results.qdrant = { ok: false, error: errorText(error) }
    }
    if (provider.visionModel) {
      try {
        const client = await this.clientFor(provider)
        const image = this.imageOptions()
        const payload = await client.captionImage(
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PQQkAAAgEsAtjR+NZzQi+hcEKLNXzWgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQELgsTB6E82mqu8QAAAABJRU5ErkJggg==',
          { timeoutMs: 60000, prompt: image.captionPrompt, maxTokens: image.captionMaxTokens },
        )
        results.caption = { ok: true, latencyMs: payload.latencyMs, model: provider.visionModel, text: payload.text }
      } catch (error) {
        results.caption = { ok: false, model: provider.visionModel, error: errorText(error) }
      }
    }
    results.ok = Object.values(results)
      .filter((value) => value && typeof value === 'object' && 'ok' in value)
      .every((value) => value.ok !== false)
    return results
  }

  /** 调试日志。 */
  debugLog(...args) {
    if (this.cfg().debug === true) this.logger.info?.('[dsh-memory]', ...args)
  }

}
