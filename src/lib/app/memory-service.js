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
import { DIMENSIONS } from '../config/schema.js'
import { MEMORY_SOURCE } from '../../shared/protocol.js'
import { DEFAULT_CAPTION_PROMPT } from '../adapters/openai/client.js'
import { MaintenanceService } from './maintenance-service.js'
import { ModelRouter } from './model-router.js'
import { QdrantClient } from '../adapters/qdrant/client.js'
import { memoryPointId } from '../domain/ids.js'
import {
  defaultConfidence,
  defaultImportance,
  normalizeConfidence,
  normalizeImportance,
} from '../domain/memory-values.js'
import { RECALL_POLICY_DEFAULTS, rankHits as rankRecallHits } from '../domain/recall-policy.js'
import { dayKey, rangeBounds, resolveTimeZone, timeInfo } from '../domain/time.js'
import {
  SerialQueue,
  asBool,
  clampInt,
  clampNumber,
  cleanText,
  errorText,
  normalizeUrl,
  readConfig,
  redactSecrets,
  toDataUri,
  truncate,
} from '../util/index.js'

/** 自动召回注入消息的 source.kind；DSH 会把它渲染成“上下文注入”行而不是用户气泡。 */
/** 自动召回上下文消息的标题前缀。 */
export const RECALL_HEADER = '【长期记忆·自动召回】'

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
    this.models = new ModelRouter(this)
    this.maintenanceService = new MaintenanceService(this)
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
    /** 由 index.js 注入的睡眠控制器、整理引擎与整理队列（避免循环依赖）。 */
    this.sleep = null
    this.consolidation = null
    this.taskBoard = null
  }

  // ------------------------------------------------------------------
  // 模型 / provider 路由（R3：实现移到 app/model-router.js）
  // ------------------------------------------------------------------

  providers() { return this.models.providers() }
  activeProvider() { return this.models.activeProvider() }
  providerById(id) { return this.models.providerById(id) }
  credentialRef(provider) { return this.models.credentialRef(provider) }
  visionConfigOf(provider) { return this.models.visionConfigOf(provider) }
  async dshProviders() { return this.models.dshProviders() }
  async dshCatalog() { return this.models.dshCatalog() }
  dshDefaultSelection() { return this.models.dshDefaultSelection() }
  dshTarget(...args) { return this.models.dshTarget(...args) }
  async dshChat(options) { return this.models.dshChat(options) }
  async dshCaption(options) { return this.models.dshCaption(options) }
  async consolidationChat(options) { return this.models.consolidationChat(options) }
  captionTarget() { return this.models.captionTarget() }
  async listProviderModels(providerId) { return this.models.listProviderModels(providerId) }
  async resolveKey(ref) { return this.models.resolveKey(ref) }
  async credentialInfo(ref) { return this.models.credentialInfo(ref) }
  async clientFor(provider) { return this.models.clientFor(provider) }
  async consolidationClient() { return this.models.consolidationClient() }

  // ------------------------------------------------------------------
  // 维护 / 集合读取（R3：实现移到 app/maintenance-service.js）
  // ------------------------------------------------------------------

  countByLevel() { return this.maintenanceService.countByLevel() }
  collectMemories(options) { return this.maintenanceService.collectMemories(options) }
  collectRawForDay(...args) { return this.maintenanceService.collectRawForDay(...args) }
  collectBatchMemories(...args) { return this.maintenanceService.collectBatchMemories(...args) }
  deleteMemoryIds(ids) { return this.maintenanceService.deleteMemoryIds(ids) }
  updateMemoryPayload(ids, payload) { return this.maintenanceService.updateMemoryPayload(ids, payload) }
  listExpiredEnhanced(now) { return this.maintenanceService.listExpiredEnhanced(now) }
  searchSimilar(vector, options) { return this.maintenanceService.searchSimilar(vector, options) }
  migrateLegacyMemories() { return this.maintenanceService.migrateLegacyMemories() }
  migrateDynamicFields() { return this.maintenanceService.migrateDynamicFields() }
  migrateQueueBatchFields(activeNos) { return this.maintenanceService.migrateQueueBatchFields(activeNos) }
  maintenance(options) { return this.maintenanceService.maintenance(options) }

  // ------------------------------------------------------------------
  // 配置与 provider
  // ------------------------------------------------------------------

  /** 当前配置（解包 volatile）。 */
  cfg() {
    return readConfig(this.config)
  }

  /** 全部 provider 档案（空列表时回退内置 SiliconFlow）。 */
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

  /** 采集时确保当天该会话的事件批次存在，返回编号（待整理期间的凭证）。 */
  async eventBatchNo(sessionId, ts = Date.now()) {
    if (!this.taskBoard || !sessionId) return ''
    try {
      const batch = await this.taskBoard.ensureEventBatch({
        dayKey: dayKey(ts, this.timeOptions().timeZone),
        sessionId: String(sessionId),
      })
      return batch?.no ?? ''
    } catch (error) {
      this.debugLog(`分配事件批次失败：${errorText(error)}`)
      return ''
    }
  }

  /** 自动召回配置。 */
  recallOptions() {
    const cfg = this.cfg()
    return {
      autoRecall: cfg.autoRecall !== false,
      recallTopK: clampInt(cfg.recallTopK, 3, 1, 20),
      recallMinScore: clampNumber(cfg.recallMinScore, 0.42, 0, 1),
      recallMaxChars: clampInt(cfg.recallMaxChars, 600, 100, 4000),
      // 自动召回排除最近 N 分钟内自动记录的对话片段，避免把刚说过的话再注入一遍
      recallMinAgeMinutes: Math.max(0, clampInt(cfg.recallMinAgeMinutes, 10, 0, 1440)),
      recallTimeoutMs: clampInt(cfg.recallTimeoutMs, 3000, 500, 20000),
      // 动态相关度（v0.7）
      ageGateEnabled: cfg.recallAgeGateEnabled !== false,
      strictness: clampNumber(cfg.recallStrictness, 0.35, 0, 1),
      maxRequired: clampNumber(cfg.recallMaxRequired, 0.9, 0.1, 1),
      toolBaseMinScore: clampNumber(cfg.recallToolBaseMinScore, 0.3, 0, 1),
      toolStrictness: clampNumber(cfg.recallToolStrictness, 0.2, 0, 1),
      weightImportance: clampNumber(cfg.recallWeightImportance, 0.2, 0, 1),
      weightRehearsal: clampNumber(cfg.recallWeightRehearsal, 0.15, 0, 1),
      weightConfidence: clampNumber(cfg.recallWeightConfidence, 0.1, 0, 1),
      decayTauDays: {
        0: clampNumber(cfg.recallDecayTauL0, 7, 1, 10000),
        1: clampNumber(cfg.recallDecayTauL1, 30, 1, 10000),
        2: clampNumber(cfg.recallDecayTauL2, 180, 1, 10000),
        3: clampNumber(cfg.recallDecayTauL3, 365, 1, 10000),
      },
      rehearsalTauDays: clampNumber(cfg.recallRehearsalTauDays, 90, 1, 10000),
      rehearsalMaxEvents: clampInt(cfg.recallRehearsalMaxEvents, 20, 1, 100),
      naturalRepeatEnabled: cfg.recallNaturalRepeatEnabled !== false,
      naturalRepeatThreshold: clampNumber(cfg.recallNaturalRepeatThreshold, 0.85, 0.5, 1),
      candidates: clampInt(cfg.recallCandidates, 20, 3, 100),
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

  /** 时间与时区配置。 */
  timeOptions() {
    const cfg = this.cfg()
    const timeZone = resolveTimeZone(cfg.timezone, cfg.timezoneCustom)
    return {
      timeZone,
      timeZoneLabel: timeZone ?? '服务器本地',
      injectCurrentTime: cfg.injectCurrentTime !== false,
      relativeTime: cfg.relativeTime !== false,
    }
  }

  /** 按配置时区格式化时间戳。 */
  formatTs(ts) {
    return timeInfo(ts, this.timeOptions().timeZone, false).time
  }

  /** 时间戳 → { time, relative }。 */
  tsInfo(ts) {
    const options = this.timeOptions()
    return timeInfo(ts, options.timeZone, options.relativeTime)
  }

  /**
   * 构造 Qdrant 过滤条件（v0.8：只按类型过滤；记忆不再是“某个会话的容器”）。
   * @param {object} options
   * @param {string} [options.kind] 只查某类记忆
   * @param {number} [options.recentTurnCutoff] 排除该时间点之后自动记录的对话片段
   */
  buildFilter({ kind = '', recentTurnCutoff = 0 } = {}) {
    const must = []
    const mustNot = []
    if (kind) must.push({ key: 'kind', match: { value: kind } })
    if (Number(recentTurnCutoff) > 0) {
      mustNot.push({
        must: [
          { key: 'kind', match: { value: 'turn' } },
          { key: 'ts', range: { gt: Number(recentTurnCutoff) } },
        ],
      })
    }
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
    // v0.8：记忆不属于某个会话；sessionId/cwd 只用于采集阶段，不写入长期记忆
    const { idSeed, sessionId: _sessionId, cwd: _cwd, ...payloadMeta } = meta ?? {}
    const id = memoryPointId(idSeed ? `${kind}|${idSeed}|${body}` : `${kind}|${body}`)
    const baseTs = Number(meta?.ts) > 0 ? Number(meta.ts) : Date.now()
    const payload = sanitizeMeta({
      text: body,
      kind,
      ts: baseTs,
      provider: provider.id,
      model: provider.embedModel,
      dimensions: provider.dimensions,
      level: 0,
      batch: '',
      // v0.7 动态召回字段
      importance: normalizeImportance(meta?.importance, kind),
      confidence: normalizeConfidence(meta?.confidence, kind),
      anchorTs: Number(meta?.anchorTs) > 0 ? Number(meta.anchorTs) : baseTs,
      accessEvents: Array.isArray(meta?.accessEvents) ? meta.accessEvents.slice(-20) : [],
      exposureCount: clampInt(meta?.exposureCount, 0, 0, 1000000),
      lastAccessAt: Number(meta?.lastAccessAt) > 0 ? Number(meta.lastAccessAt) : 0,
      lastExposedAt: Number(meta?.lastExposedAt) > 0 ? Number(meta.lastExposedAt) : 0,
      needsReview: meta?.needsReview === true,
      ...payloadMeta,
    })
    await qdrant.upsert(storage.collection, [{ id, vector: embedded.vector, payload }], { signal })
    this.stats.writes += 1
    this.stats.lastWriteAt = payload.ts
    this.stats.lastWriteKind = kind
    this.debugLog(`写入 ${kind} 记忆 ${id}（${body.length} 字，provider=${provider.id}）`)
    // 自然复述检测（用户再次提及同一事实）：异步，不阻塞写入
    if (this.recallOptions().ageGateEnabled && this.recallOptions().naturalRepeatEnabled) {
      void this.detectNaturalRepeat({ vector: embedded.vector, selfId: id, kind })
    }
    return { ok: true, id, text: body }
  }

  /** C 类复述：新写入内容与已有记忆高度相似时，给旧记忆记一次“自然复述”。 */
  async detectNaturalRepeat({ vector, selfId, kind }) {
    if (!Array.isArray(vector)) return
    const options = this.recallOptions()
    if (!options.ageGateEnabled || !options.naturalRepeatEnabled) return
    if (!['turn', 'fact', 'preference', 'note', 'project'].includes(String(kind ?? ''))) return
    try {
      const qdrant = await this.qdrant()
      const storage = this.storage()
      const points = await qdrant.search(storage.collection, {
        vector,
        limit: 3,
        scoreThreshold: options.naturalRepeatThreshold,
        withPayload: false,
      })
      const ids = points
        .map((point) => String(point.id ?? ''))
        .filter((id) => id && id !== String(selfId))
      if (ids.length > 0) await this.recordRehearsal(ids, 'repeat', 1.5)
    } catch (error) {
      this.debugLog(`自然复述检测失败：${errorText(error)}`)
    }
  }

  /** 记录一轮对话要点。 */
  async addTurnMemory({ userText, assistantText, sessionId, turn, imageCount = 0 }) {
    const options = this.captureOptions()
    const user = truncate(cleanText(userText), options.captureUserChars)
    const assistant = truncate(cleanText(assistantText), options.captureAssistantChars)
    if (user.length + assistant.length < options.captureMinChars) return { ok: false, skipped: 'too-short' }
    const parts = []
    if (user) parts.push(`用户：${user}`)
    if (assistant) parts.push(`助手：${assistant}`)
    if (imageCount > 0) parts.push(`（本轮附有 ${imageCount} 张图片）`)
    const batch = await this.eventBatchNo(sessionId)
    return this.addMemory({
      kind: 'turn',
      text: parts.join('\n'),
      meta: {
        turn: Number(turn) || 0,
        hasImages: imageCount > 0,
        batch,
      },
    })
  }

  /** 记录一张图片：只存一句话概览，永不存原图。 */
  async addImageMemory({ ref, sessionId, turn }) {
    const image = this.imageOptions()
    if (image.imageMode === 'off') return { ok: false, skipped: 'image-mode-off' }
    const cfg = this.cfg()
    const source = cfg.captionSource === 'custom' ? 'custom' : 'dsh'
    const mediaType = ref?.mediaType || 'image/png'
    const imageMeta = {
      mediaType: String(mediaType),
      width: Number(ref?.width) || null,
      height: Number(ref?.height) || null,
    }
    let text
    let caption = null
    if (image.imageMode === 'caption') {
      // 优先：DSH 已配置的模型（图片以 attachment block 传入，无需额外 Key）
      if (source === 'dsh') {
        try {
          const target = this.dshTarget(cfg.captionDshProvider, cfg.captionDshModel)
          if (!target.providerId || !target.modelId) throw new Error('DSH 默认模型不可用')
          const result = await this.dshCaption({
            provider: target.providerId,
            model: target.modelId,
            ref,
            prompt: image.captionPrompt,
            maxTokens: Math.max(300, image.captionMaxTokens),
          })
          caption = cleanText(result.text)
          this.stats.captions += 1
        } catch (error) {
          this.logger.warn?.(`[dsh-memory] DSH 图片概览失败，尝试自定义 provider：${errorText(error)}`)
        }
      }
      // 回退：插件自定义 provider 的视觉模型
      if (!caption) {
        const { provider, vision, model: customModel } = this.captionTarget()
        if (customModel) {
          try {
            const stored = await this.ctx.attachments.readImage(ref)
            const dataUri = toDataUri(stored?.data ?? stored, mediaType)
            const client = await this.clientFor(provider)
            client.visionModel = customModel
            void vision
            const result = await client.captionImage(dataUri, {
              prompt: image.captionPrompt,
              maxTokens: image.captionMaxTokens,
            })
            caption = cleanText(result.text)
            this.stats.captions += 1
          } catch (error) {
            this.logger.warn?.(`[dsh-memory] 图片概览失败，降级为占位记录：${errorText(error)}`)
          }
        } else {
          this.logger.warn?.('[dsh-memory] 图片概览没有可用模型（DSH 模型不可用且未配置自定义视觉模型）')
        }
      }
      text = caption
        ? `图片概览：${caption}`
        : '用户发送了一张图片（概览生成失败，仅记录图片存在）'
    } else {
      text = '用户发送了一张图片（未解析图片内容）'
    }
    const batch = await this.eventBatchNo(sessionId)
    return this.addMemory({
      kind: 'image',
      text,
      meta: {
        turn: Number(turn) || 0,
        image: imageMeta,
        caption,
        batch,
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
        kind: options.kind ?? '',
        recentTurnCutoff: Number(options.recentTurnCutoff) || 0,
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
    const timeOptions = this.timeOptions()
    const hits = points.map((point) => {
      const payload = point?.payload ?? {}
      const ts = Number(payload.ts) || 0
      const info = timeInfo(ts, timeOptions.timeZone, timeOptions.relativeTime)
      return {
        id: String(point?.id ?? ''),
        score: Number(point?.score) || 0,
        text: String(payload.text ?? ''),
        kind: String(payload.kind ?? ''),
        ts,
        time: info.time,
        relative: info.relative,
        tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
        provider: payload.provider ? String(payload.provider) : '',
        level: Number(payload.level) || 0,
        batch: payload.batch ? String(payload.batch) : '',
        enhanced: payload.enhanced === true,
        ...this.#dynamicPayload(payload),
      }
    })
    return { hits, query: text, usage: embedded.usage }
  }

  /** 自动召回：检索并组装成注入上下文块。 */
  /** 批量更新 payload（按 id 分别写，内部串行避免打爆 Qdrant）。 */
  async patchMemoryPayloads(patches) {
    if (!Array.isArray(patches) || patches.length === 0) return
    const qdrant = await this.qdrant()
    const storage = this.storage()
    for (const patch of patches) {
      await qdrant.setPayload(storage.collection, patch.payload, [patch.id])
    }
  }

  /** A 类：被动曝光（自动召回注入）。只记 exposureCount / lastExposedAt，不进入有效复述。 */
  async recordExposure(ids) {
    const list = (ids ?? []).map(String).filter(Boolean).slice(0, 20)
    if (list.length === 0) return
    try {
      const items = await this.collectMemories({ filter: { must: [{ has_id: list }] }, withVector: false, maxItems: list.length })
      const now = Date.now()
      await this.patchMemoryPayloads(
        items.map((item) => ({
          id: item.id,
          payload: {
            exposureCount: clampInt(item.payload?.exposureCount, 0, 0, 1000000) + 1,
            lastExposedAt: now,
          },
        })),
      )
    } catch (error) {
      this.debugLog(`记录曝光失败：${errorText(error)}`)
    }
  }

  /**
   * B/C/D/E 类：有效复述。
   * @param {string[]} ids 记忆 id
   * @param {'search'|'repeat'|'confirm'|'correct'} type
   * @param {number} weight 分类权重
   */
  async recordRehearsal(ids, type, weight = 1) {
    const list = (ids ?? []).map(String).filter(Boolean).slice(0, 20)
    if (list.length === 0) return
    try {
      const options = this.recallOptions()
      const items = await this.collectMemories({ filter: { must: [{ has_id: list }] }, withVector: false, maxItems: list.length })
      const now = Date.now()
      const maxEvents = options.rehearsalMaxEvents
      const patches = []
      for (const item of items) {
        const payload = item.payload ?? {}
        const events = Array.isArray(payload.accessEvents) ? payload.accessEvents.slice(-(maxEvents - 1)) : []
        const nextEvents = [...events, { type, at: now, weight: Math.max(0, Number(weight) || 0) }]
        let confidence = normalizeConfidence(payload.confidence, payload.kind)
        const patch = { accessEvents: nextEvents, lastAccessAt: now }
        if (type === 'confirm') {
          confidence = Math.min(0.95, confidence + 0.1)
          patch.confidence = confidence
        } else if (type === 'correct') {
          confidence = Math.max(0.05, confidence - 0.2)
          patch.confidence = confidence
          patch.needsReview = true
        }
        patches.push({ id: item.id, payload: patch })
      }
      await this.patchMemoryPayloads(patches)
    } catch (error) {
      this.debugLog(`记录复述失败（${type}）：${errorText(error)}`)
    }
  }

  /** 动态召回排序/门控（auto=自动召回；tool=memory_search）。 */
  rankHits(hits, mode = 'auto') {
    const options = this.recallOptions()
    if (!options.ageGateEnabled) {
      const pass = [...(hits ?? [])].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
      return { pass, dropped: [] }
    }
    const policy = {
      mode,
      baseMinScore: mode === 'tool' ? options.toolBaseMinScore : options.recallMinScore,
      strictness: mode === 'tool' ? options.toolStrictness : options.strictness,
      maxRequired: options.maxRequired,
      weightImportance: options.weightImportance,
      weightRehearsal: options.weightRehearsal,
      weightConfidence: options.weightConfidence,
      decayTauDays: options.decayTauDays,
      rehearsalTauDays: options.rehearsalTauDays,
    }
    return rankRecallHits(hits ?? [], policy, Date.now())
  }

  async recall(query, { signal } = {}) {
    const options = this.recallOptions()
    const recentTurnCutoff =
      options.recallMinAgeMinutes > 0 ? Date.now() - options.recallMinAgeMinutes * 60000 : 0
    const { hits } = await this.search(query, {
      limit: options.ageGateEnabled ? options.candidates : options.recallTopK,
      minScore: options.ageGateEnabled ? undefined : options.recallMinScore,
      recentTurnCutoff,
      signal,
    })
    let candidates = hits.filter((hit) => hit.text.length > 0 && hit.enhanced !== true)
    if (options.ageGateEnabled) {
      const ranked = this.rankHits(candidates, 'auto')
      candidates = ranked.pass
    }
    const filtered = candidates.slice(0, options.recallTopK)
    if (filtered.length === 0) return { hits: [], block: '' }
    // A 类：被动曝光只记录，不计入有效复述、不影响排序
    if (options.ageGateEnabled) void this.recordExposure(filtered.map((hit) => hit.id))
    const timeOptions = this.timeOptions()
    const lines = []
    for (const [index, hit] of filtered.entries()) {
      const kindLabel =
        hit.kind === 'image' ? '图片' : hit.kind === 'fact' ? '事实' : hit.kind === 'turn' ? '对话' : '记忆'
      const relative = hit.relative ? `·${hit.relative}` : ''
      const confidence = Number.isFinite(hit.confidence) ? `·可信度${Math.round(hit.confidence * 100)}%` : ''
      lines.push(`${index + 1}. [${hit.time}${relative}·${kindLabel}${confidence}] ${truncate(hit.text, 220)}`)
    }
    const timeLine = timeOptions.injectCurrentTime
      ? `当前时间：${this.formatTs(Date.now())}（时区：${timeOptions.timeZoneLabel}；记忆时间均按此时区显示）\n`
      : ''
    let block = `${RECALL_HEADER}\n${timeLine}以下是从过去会话中检索到的相关记忆，仅供参考；若与当前对话冲突，以当前对话为准：\n${lines.join('\n')}`
    block = truncate(block, options.recallMaxChars)
    this.stats.lastRecallAt = Date.now()
    this.stats.lastRecallCount = filtered.length
    return { hits: filtered, block }
  }

  // ------------------------------------------------------------------
  // 记忆管理
  // ------------------------------------------------------------------

  /** 把 Qdrant point 映射成管理界面用的条目。 */
  /** 动态召回字段（统一读取缺省值，兼容 v0.6 旧记忆）。 */
  #dynamicPayload(payload) {
    const accessEvents = Array.isArray(payload?.accessEvents)
      ? payload.accessEvents
          .map((event) => ({ type: String(event?.type ?? ''), at: Number(event?.at) || 0, weight: Number(event?.weight) || 0 }))
          .filter((event) => event.at > 0 && event.weight > 0)
          .slice(-20)
      : []
    return {
      importance: normalizeImportance(payload?.importance, payload?.kind),
      confidence: normalizeConfidence(payload?.confidence, payload?.kind),
      anchorTs: Number(payload?.anchorTs) || Number(payload?.ts) || 0,
      accessEvents,
      exposureCount: clampInt(payload?.exposureCount, 0, 0, 1000000),
      lastAccessAt: Number(payload?.lastAccessAt) || 0,
      lastExposedAt: Number(payload?.lastExposedAt) || 0,
      needsReview: payload?.needsReview === true,
    }
  }

  #pointToItem(point, score) {
    const payload = point?.payload ?? {}
    const ts = Number(payload.ts) || 0
    const info = this.tsInfo(ts)
    return {
      id: String(point?.id ?? ''),
      text: String(payload.text ?? ''),
      kind: String(payload.kind ?? ''),
      ts,
      time: info.time,
      relative: info.relative,
      tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
      provider: payload.provider ? String(payload.provider) : '',
      level: Number(payload.level) || 0,
      batch: payload.batch ? String(payload.batch) : '',
      enhanced: payload.enhanced === true,
      ...this.#dynamicPayload(payload),
      ...(Number.isFinite(score) ? { score } : {}),
    }
  }

  /** 记忆列表：带 query 走向量检索，否则按时间倒序滚动。 */
  async listMemories({ query = '', limit = 20, offset = null, kind = '', range = '', level = '', batch = '' } = {}) {
    const cleanQuery = cleanText(query)
    const pageSize = clampInt(limit, 20, 1, 100)
    const levelFilter = String(level ?? '').trim()
    const batchFilter = String(batch ?? '').trim()
    if (cleanQuery) {
      const { hits } = await this.search(cleanQuery, { limit: Math.min(100, pageSize * 3), kind })
      const filtered = hits
        .filter((hit) => !levelFilter || String(hit.level ?? 0) === levelFilter)
        .filter((hit) => !batchFilter || String(hit.batch ?? '') === batchFilter)
        .slice(0, pageSize)
      return { items: filtered, nextOffset: null, total: filtered.length, query: cleanQuery }
    }
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    const must = []
    if (kind) must.push({ key: 'kind', match: { value: kind } })
    if (levelFilter !== '') must.push({ key: 'level', match: { value: Number(levelFilter) } })
    if (batchFilter) must.push({ key: 'batch', match: { value: batchFilter } })
    if (range === 'today' || range === '7d' || range === '30d') {
      const bounds = rangeBounds(range, this.timeOptions().timeZone)
      if (bounds.from !== null) must.push({ key: 'ts', range: { gte: bounds.from, lte: bounds.to } })
    }
    const filter = must.length > 0 ? { must } : undefined
    const { points, nextOffset } = await qdrant.scroll(storage.collection, {
      limit: pageSize,
      offset: offset ?? undefined,
      orderBy: { key: 'ts', direction: 'desc' },
      filter,
    })
    let total = null
    try {
      // 注意：Qdrant 的近似 count 在带过滤条件时会明显偏差，这里必须精确计数
      total = await qdrant.count(storage.collection, { filter, exact: true })
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
  // 记忆整理 / 睡眠 支撑
  // ------------------------------------------------------------------

  /** 按 level 统计条数（0=原始，1/2/3=整理级别）。 */
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
        version: '0.8.0',
        startedAt: this.stats.startedAt,
      },
      time: (() => {
        const options = this.timeOptions()
        return {
          timezone: options.timeZone ?? '',
          timezoneLabel: options.timeZoneLabel,
          injectCurrentTime: options.injectCurrentTime,
          relativeTime: options.relativeTime,
          now: this.formatTs(Date.now()),
        }
      })(),
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
      functions: (() => {
        const cfg = this.cfg()
        const captionSource = cfg.captionSource === 'custom' ? 'custom' : 'dsh'
        let caption
        if (captionSource === 'dsh') {
          const target = this.dshTarget(cfg.captionDshProvider, cfg.captionDshModel)
          caption = {
            source: 'dsh',
            providerId: target.providerId,
            providerName: target.providerId,
            model: target.modelId,
            configured: Boolean(target.providerId && target.modelId),
          }
        } else {
          const custom = this.captionTarget()
          caption = {
            source: 'custom',
            providerId: custom.provider?.id ?? '',
            providerName: custom.provider?.name ?? '',
            model: custom.model,
            configured: Boolean(custom.model),
          }
        }
        const consolidationSource = cfg.consolidationSource === 'custom' ? 'custom' : 'dsh'
        let consolidation
        if (consolidationSource === 'dsh') {
          const target = this.dshTarget(cfg.consolidationDshProvider, cfg.consolidationDshModel)
          consolidation = {
            source: 'dsh',
            providerId: target.providerId,
            providerName: target.providerId,
            model: target.modelId,
            configured: Boolean(target.providerId && target.modelId),
          }
        } else {
          let customProvider = null
          try {
            customProvider = cfg.consolidationProviderId
              ? this.providerById(cfg.consolidationProviderId)
              : this.activeProvider()
          } catch {
            customProvider = null
          }
          consolidation = {
            source: 'custom',
            providerId: customProvider?.id ?? '',
            providerName: customProvider?.name ?? '',
            model: String(cfg.consolidationModel ?? '').trim(),
            configured: Boolean(String(cfg.consolidationModel ?? '').trim()),
          }
        }
        return {
          embedding: { providerId: provider.id, model: provider.embedModel, dimensions: provider.dimensions },
          caption,
          consolidation,
          limitItems: cfg.consolidationLimitItems === true,
        }
      })(),
      behavior: {
        dynamicRecall: {
          enabled: recall.ageGateEnabled,
          strictness: recall.strictness,
          maxRequired: recall.maxRequired,
          weights: {
            importance: recall.weightImportance,
            rehearsal: recall.weightRehearsal,
            confidence: recall.weightConfidence,
          },
          decayTauDays: recall.decayTauDays,
        },
        autoCapture: capture.autoCapture,
        autoRecall: recall.autoRecall,
        recallTopK: recall.recallTopK,
        recallMinScore: recall.recallMinScore,
        recallMaxChars: recall.recallMaxChars,
        recallMinAgeMinutes: recall.recallMinAgeMinutes,
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
        lastErrorTime: this.queue.lastErrorAt ? this.formatTs(this.queue.lastErrorAt) : '',
      },
      sleep: this.sleep?.status?.() ?? null,
      consolidation: this.consolidation?.summary?.() ?? null,
      levels: await this.countByLevel(),
      stats: {
        writes: this.stats.writes,
        lastWriteTime: this.stats.lastWriteAt ? this.formatTs(this.stats.lastWriteAt) : '',
        lastWriteKind: this.stats.lastWriteKind,
        lastRecallTime: this.stats.lastRecallAt ? this.formatTs(this.stats.lastRecallAt) : '',
        lastRecallCount: this.stats.lastRecallCount,
        recallChecks: this.stats.recallChecks,
        lastRecallQuery: this.stats.lastRecallQuery,
        lastRecallError: this.stats.lastRecallError,
        lastRecallInjectTime: this.stats.lastRecallInjectAt ? this.formatTs(this.stats.lastRecallInjectAt) : '',
        captions: this.stats.captions,
        startedAt: this.stats.startedAt,
        lastMaintenanceTime: this.stats.lastMaintenanceAt ? this.formatTs(this.stats.lastMaintenanceAt) : '',
        lastMaintenance: this.stats.lastMaintenance,
      },
      collectionState: {
        ok: this.collectionState.ok,
        error: this.collectionState.error,
        checkedAt: this.collectionState.checkedAt ? this.formatTs(this.collectionState.checkedAt) : '',
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
