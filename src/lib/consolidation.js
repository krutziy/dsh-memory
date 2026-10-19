/**
 * 睡眠整理引擎（v0.4）。
 *
 * 把记忆压缩成“批次”，用任务列表调度多级压缩：
 *   L1：每天把原始记忆（level=0）压缩成一个 5 位编号的批次（保留多少条由模型按重要性决定）
 *   L2：L1 批次创建 7 天后，再压缩为 L2 批次（L1 原文删除）
 *   L3：L2 批次创建 30 天后，再压缩为 L3 批次（最终长期摘要）
 *
 * 任务列表持久化在 $DSH_HOME/storages/dsh-memory/consolidation.json，
 * 批次编号是随机 5 位数；只要求“待处理/处理中”的编号唯一，完成后的编号可回收复用。
 *
 * 实验功能（默认关闭）：
 * - 事件合并：整理时用嵌入向量在全库检索相似记忆，只把相关小簇作为参考交给 LLM，
 *   并生成 kind='event' 的事件摘要（不会被整库塞给 LLM）。
 * - 增强记忆：额外保留一份 L1 产物 enhancementDays 天，不参与后续整理，
 *   仅供事件合并/按需搜索使用，到期自动删除。
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  chunkByChars,
  dayKey,
  dayBoundsFromKey,
  dshHome,
  errorText,
  extractJson,
  formatDuration,
  formatTimeInZone,
  nextBatchId,
  readJsonFile,
  renderMemoryLines,
  writeJsonFileAtomic,
} from './util.js'

/** 整理状态文件版本。 */
const STATE_VERSION = 1

/** 内置整理提示词。 */
const DEFAULT_PROMPT = [
  '你是长期记忆整理助手，模拟人类睡眠中的记忆巩固。',
  '输入：某个时间单元内的若干条记忆（可能来自对话、事实、偏好、图片概览）。',
  '任务：合并、去重、压缩，提炼出最重要的信息；删除寒暄与重复，不编造不存在的内容。',
  '输出必须是严格 JSON（不要输出代码围栏之外的解释）：',
  '{"summary":"一段简短的整体摘要","facts":[{"text":"一条自包含的事实","kind":"fact|preference|project|note","tags":["可选标签"]}],"event":{"summary":"可选：如果这些记忆构成同一事件，写一句事件摘要","tags":["可选"]}}',
  '要求：',
  '- facts 条数由你根据信息的重要性和密度自行决定（不要为了凑数而保留琐碎内容，也不要丢失关键事实）；每条自包含，不要用“他/它/这个”等指代。',
  '- 保留关键事实、偏好、决定、时间、人名、项目名；丢弃噪音。',
  '- summary 与 facts 用中文（除非原文主要是其他语言）。',
].join('\n')

/** 一个批次的简易视图（给状态/历史用）。 */
function batchView(batch) {
  return {
    id: batch.id,
    level: batch.level,
    status: batch.status,
    createdAt: batch.createdAt,
    dueAt: batch.dueAt,
    sourceCount: batch.inputCount ?? 0,
    outputCount: batch.outputCount ?? 0,
    dayKey: batch.dayKey ?? '',
    sourceBatchIds: batch.sourceBatchIds ?? [],
    error: batch.error ?? null,
  }
}

export class ConsolidationEngine {
  /**
   * @param {import('./service.js').MemoryService} service
   */
  constructor(service) {
    this.service = service
    this.ctx = service.ctx
    this.logger = service.logger
    this.statePath = join(dshHome(), 'storages', 'dsh-memory', 'consolidation.json')
    this.state = { version: STATE_VERSION, batches: [], history: [], lastRun: null }
    this.loaded = false
    this.running = null
  }

  /** 配置级别定义（level1 为每日原始记忆压缩，level2/3 为后续批次压缩）。 */
  stages() {
    // 保留条数交由模型按内容重要性决定；这里只保留安全上限（防止模型输出失控）。
    // 7 天 / 30 天的触发间隔是固定的整理节奏，未来要扩展更多级只需在数组里追加。
    return [
      { level: 1, maxItems: 40, afterDays: 0 },
      { level: 2, maxItems: 20, afterDays: 7 },
      { level: 3, maxItems: 10, afterDays: 30 },
    ]
  }

  stage(level) {
    return this.stages().find((item) => item.level === level) ?? null
  }

  nextStage(level) {
    return this.stages().find((item) => item.level === level + 1) ?? null
  }

  // ------------------------------------------------------------------
  // 任务列表持久化
  // ------------------------------------------------------------------

  async load() {
    if (this.loaded) return this.state
    const data = readJsonFile(this.statePath, null)
    if (data && typeof data === 'object' && Array.isArray(data.batches)) {
      this.state = {
        version: STATE_VERSION,
        batches: data.batches,
        history: Array.isArray(data.history) ? data.history : [],
        lastRun: data.lastRun ?? null,
      }
    }
    this.loaded = true
    return this.state
  }

  async save() {
    // 只保留最近 600 个批次与 40 条历史，避免状态文件无限膨胀
    if (this.state.batches.length > 600) {
      const finished = this.state.batches.filter((b) => b.status !== 'pending' && b.status !== 'processing')
      const active = this.state.batches.filter((b) => b.status === 'pending' || b.status === 'processing')
      const keepFinished = finished.slice(-Math.max(0, 600 - active.length))
      this.state.batches = [...keepFinished, ...active].sort((a, b) => a.createdAt - b.createdAt)
    }
    if (this.state.history.length > 40) this.state.history = this.state.history.slice(-40)
    writeJsonFileAtomic(this.statePath, this.state)
  }

  /** 待处理/处理中批次占用的编号集合。 */
  pendingIds() {
    return new Set(
      this.state.batches
        .filter((batch) => batch.status === 'pending' || batch.status === 'processing')
        .map((batch) => String(batch.id)),
    )
  }

  batchById(id) {
    return this.state.batches.find((batch) => String(batch.id) === String(id)) ?? null
  }

  /** 状态/历史摘要。 */
  summary() {
    const batches = this.state.batches ?? []
    const pending = batches.filter((batch) => batch.status === 'pending' || batch.status === 'processing')
    const byLevel = {}
    for (const batch of pending) byLevel[batch.level] = (byLevel[batch.level] ?? 0) + 1
    const nextDue = pending
      .filter((batch) => Number.isFinite(batch.dueAt))
      .sort((a, b) => a.dueAt - b.dueAt)[0]
    return {
      enabled: this.service.cfg().consolidationEnabled === true,
      pendingTotal: pending.length,
      pendingByLevel: byLevel,
      nextDueAt: nextDue?.dueAt ?? null,
      nextDueTime: nextDue?.dueAt ? this.service.formatTs(nextDue.dueAt) : '',
      batches: batches.slice(-15).map(batchView),
      history: (this.state.history ?? []).slice(-6).map((entry) => ({
        at: entry.at,
        time: entry.at ? this.service.formatTs(entry.at) : '',
        manual: entry.manual === true,
        durationMs: entry.durationMs ?? 0,
        levels: entry.levels ?? {},
        errors: entry.errors ?? [],
      })),
      lastRun: this.state.lastRun,
      statePath: this.statePath,
    }
  }

  // ------------------------------------------------------------------
  // 运行整理
  // ------------------------------------------------------------------

  /** 是否正在整理。 */
  get busy() {
    return this.running !== null
  }

  /**
   * 执行一轮整理（睡醒前调用）。同一时间只允许一个 run。
   * @param {{manual?:boolean, reason?:string}} options
   */
  async run(options = {}) {
    await this.load()
    if (this.running) return this.running
    this.running = this.#runInner({ manual: options.manual === true, reason: options.reason ?? 'sleep' })
      .finally(() => {
        this.running = null
      })
    return this.running
  }

  async #runInner({ manual, reason }) {
    const startedAt = Date.now()
    const cfg = this.service.cfg()
    const tz = this.service.timeOptions().timeZone
    const today = dayKey(Date.now(), tz)
    const stages = this.stages()
    const result = {
      ok: true,
      manual,
      reason,
      startedAt,
      finishedAt: 0,
      durationMs: 0,
      levels: {},
      batches: [],
      deleted: 0,
      errors: [],
      maintenance: null,
    }

    try {
      await this.service.ensureReady()

      // ---------- L1：把“今天之前”的原始记忆按天压缩 ----------
      const raw = await this.service.collectMemories({
        filter: { must: [{ key: 'level', match: { value: 0 } }] },
        withVector: cfg.experimentalEventMergeEnabled === true,
        maxItems: 5000,
        orderBy: { key: 'ts', direction: 'asc' },
      })
      const byDay = new Map()
      for (const item of raw) {
        const key = dayKey(Number(item.payload?.ts) || 0, tz)
        if (key >= today) continue
        if (!byDay.has(key)) byDay.set(key, [])
        byDay.get(key).push(item)
      }
      const dayKeys = [...byDay.keys()].sort()
      for (const key of dayKeys) {
        const items = byDay.get(key)
        const stage1 = stages.find((item) => item.level === 1)
        const outcome = await this.#compress({
          level: 1,
          stage: stage1,
          sources: items,
          dayKey: key,
          sourceBatchIds: [],
          meta: { dayRange: dayBoundsFromKey(key, tz) },
        })
        result.batches.push(outcome.view)
        if (outcome.error) result.errors.push(outcome.error)
        this.#mergeLevelStats(result, 1, outcome)
      }

      // ---------- L2/L3：处理到期批次 ----------
      for (const stage of stages.filter((item) => item.level >= 2)) {
        const due = this.state.batches
          .filter(
            (batch) =>
              batch.level === stage.level - 1 &&
              batch.status === 'pending' &&
              Number(batch.dueAt) > 0 &&
              Number(batch.dueAt) <= Date.now(),
          )
          .sort((a, b) => a.dueAt - b.dueAt)
        for (const sourceBatch of due) {
          const sources = await this.service.collectBatchMemories(sourceBatch.id, {
            withVector: cfg.experimentalEventMergeEnabled === true,
            maxItems: 5000,
          })
          if (sources.length === 0) {
            sourceBatch.status = 'done'
            sourceBatch.updatedAt = Date.now()
            sourceBatch.error = 'empty-batch'
            await this.save()
            continue
          }
          const outcome = await this.#compress({
            level: stage.level,
            stage,
            sources,
            dayKey: sourceBatch.dayKey ?? '',
            sourceBatchIds: [sourceBatch.id],
            meta: { dayRange: sourceBatch.dayRange ?? null },
          })
          result.batches.push(outcome.view)
          if (outcome.error) result.errors.push(outcome.error)
          this.#mergeLevelStats(result, stage.level, outcome)
          if (!outcome.error) {
            sourceBatch.status = 'done'
            sourceBatch.updatedAt = Date.now()
            sourceBatch.outputBatchId = outcome.view.id
          } else {
            sourceBatch.attempts = (sourceBatch.attempts ?? 0) + 1
            sourceBatch.error = outcome.error
          }
          await this.save()
        }
      }

      // ---------- 增强记忆到期清理 ----------
      try {
        const expired = await this.service.listExpiredEnhanced(Date.now())
        if (expired.length > 0) {
          await this.service.deleteMemoryIds(expired)
          result.deleted += expired.length
        }
      } catch (error) {
        result.errors.push(`enhanced-expiry: ${errorText(error)}`)
      }

      // ---------- 整理后自动维护（去重/过期/索引） ----------
      try {
        result.maintenance = await this.service.maintenance({ force: false })
      } catch (error) {
        result.errors.push(`maintenance: ${errorText(error)}`)
      }
    } catch (error) {
      result.ok = false
      result.errors.push(errorText(error))
    }

    result.finishedAt = Date.now()
    result.durationMs = result.finishedAt - startedAt
    result.ok = result.ok && result.errors.length === 0
    this.state.lastRun = {
      at: result.finishedAt,
      manual,
      durationMs: result.durationMs,
      ok: result.ok,
      levels: result.levels,
      deleted: result.deleted,
      errors: result.errors,
    }
    this.state.history.push({
      at: result.startedAt,
      manual,
      durationMs: result.durationMs,
      levels: result.levels,
      currentLevels: this.summaryLevels(),
      errors: result.errors,
    })
    await this.save()
    const levelText = Object.entries(result.levels)
      .map(([level, stat]) => `L${level}:${stat.batches}批/${stat.input}→${stat.output}`)
      .join(' ')
    this.service.debugLog(`睡眠整理完成 ${formatDuration(result.durationMs)} ${levelText} 删除原文 ${result.deleted} 条`)
    return result
  }

  summaryLevels() {
    const counts = {}
    for (const batch of this.state.batches) counts[batch.level] = (counts[batch.level] ?? 0) + 1
    return counts
  }

  #mergeLevelStats(result, level, outcome) {
    if (!result.levels[level]) result.levels[level] = { batches: 0, input: 0, output: 0 }
    result.levels[level].batches += 1
    result.levels[level].input += outcome.inputCount ?? 0
    result.levels[level].output += outcome.outputCount ?? 0
    result.deleted += outcome.deleted ?? 0
  }

  /**
   * 压缩一个批次：调 LLM（或规则回退）生成摘要+事实，写入新记忆，删除原文，登记任务。
   */
  async #compress({ level, stage, sources, dayKey: key, sourceBatchIds, meta }) {
    const cfg = this.service.cfg()
    const nextStage = this.nextStage(level)
    const batchId = nextBatchId(this.pendingIds())
    const cleanSources = (sources ?? []).filter((item) => item.payload?.text)
    const inputCount = cleanSources.length
    const emptyView = {
      id: batchId,
      level,
      status: nextStage ? 'pending' : 'final',
      createdAt: Date.now(),
      dueAt: nextStage ? Date.now() + nextStage.afterDays * 86400000 : null,
      sourceCount: inputCount,
      outputCount: 0,
      sourceBatchIds,
      dayKey: key || '',
      error: 'no-source',
    }
    if (inputCount === 0) return { view: emptyView, inputCount: 0, outputCount: 0, deleted: 0, error: null }

    try {
      // ---------- 实验：事件合并（只取相似记忆作为参考） ----------
      let related = []
      if (cfg.experimentalEventMergeEnabled === true) {
        related = await this.#findRelated(cleanSources)
      }

      // ---------- LLM / 规则压缩 ----------
      const rendered = this.#renderSources(cleanSources, level)
      const chunks = chunkByChars(cleanSources, Math.max(1000, Number(cfg.consolidationInputMaxChars) || 12000))
      let combined = null
      let llmCalls = 0
      let latencyMs = 0
      try {
        const llm = await this.service.consolidationClient()
        if (!llm) throw new Error('no-consolidation-model')
        const partials = []
        for (const chunk of chunks) {
          const partial = await this.#callLLM(llm, {
            level,
            stage,
            items: chunk,
            rendered: this.#renderSources(chunk, level),
            related,
            isFirst: partials.length === 0,
          })
          partials.push(partial)
          llmCalls += 1
          latencyMs += partial.latencyMs ?? 0
        }
        combined = partials.length === 1 ? partials[0].data : await this.#mergePartials(llm, partials, stage)
        if (partials.length > 1) {
          llmCalls += 1
          latencyMs += combined?.latencyMs ?? 0
        }
      } catch (error) {
        // 回退：纯规则压缩（保证睡眠不中断；内容可能粗糙）
        this.service.debugLog(`整理 LLM 不可用，回退规则压缩：${errorText(error)}`)
        combined = this.#ruleCompress(chunks, stage)
        combined = combined.data
        combined.fallback = true
        combined.fallbackReason = errorText(error)
      }

      const summary = String(combined?.summary ?? '').trim()
      const facts = Array.isArray(combined?.facts) ? combined.facts : []
      const event = combined?.event && typeof combined.event === 'object' ? combined.event : null

      // 保留条数由模型决定；这里只兜底安全上限，避免模型异常输出过多条目。
      const maxItems = Math.max(1, stage.maxItems ?? 20)
      const factLimit = Math.max(0, maxItems - (summary ? 1 : 0))
      const selectedFacts = facts
        .filter((fact) => fact && typeof fact.text === 'string' && fact.text.trim())
        .slice(0, factLimit)
        .map((fact) => ({
          text: String(fact.text).trim(),
          kind: ['fact', 'preference', 'project', 'note', 'event'].includes(fact.kind) ? fact.kind : 'fact',
          tags: Array.isArray(fact.tags) ? fact.tags.map(String).slice(0, 8) : [],
        }))

      const entries = []
      if (summary) entries.push({ text: summary, kind: 'summary', tags: ['summary'] })
      for (const fact of selectedFacts) entries.push(fact)
      if (entries.length === 0) entries.push({ text: rendered.slice(0, Math.max(80, Math.min(400, rendered.length))), kind: 'note', tags: ['fallback'] })
      if (event?.summary && String(event.summary).trim()) {
        entries.push({
          text: String(event.summary).trim(),
          kind: 'event',
          tags: Array.isArray(event.tags) ? event.tags.map(String).slice(0, 8) : ['event'],
        })
      }

      // 压缩比统计：输入条数 → 输出条数（source 删除，目标比例仅作为提示）
      const now = Date.now()
      const sourceIds = cleanSources.map((item) => item.id)
      const baseMeta = {
        level,
        batch: batchId,
        batchCreatedAt: now,
        sourceCount: inputCount,
        sourceBatchIds,
        dayRange: meta?.dayRange ?? null,
        consolidatedAt: now,
        relatedCount: related.length,
      }

      const written = []
      try {
        for (const entry of entries) {
          const saved = await this.service.addMemory({
            kind: entry.kind === 'summary' ? 'summary' : entry.kind,
            text: entry.text,
            meta: {
              ...baseMeta,
              tags: entry.tags,
            },
          })
          written.push(saved)
        }
        // 实验：增强记忆副本（不进入整理链，仅事件/按需召回使用）
        if (cfg.experimentalEnhancementEnabled === true && level === 1) {
          const days = Math.max(1, Number(cfg.experimentalEnhancementDays) || 7)
          for (const saved of written) {
            await this.service.addMemory({
              kind: saved.kind ?? 'summary',
              text: `（增强记忆）${saved.text}`,
              meta: {
                level: 1,
                enhanced: true,
                expiresAt: now + days * 86400000,
                sourceCount: inputCount,
                sourceBatchIds,
                consolidatedAt: now,
                idSeed: `enhanced-${batchId}`,
              },
            })
          }
        }
      } catch (error) {
        return {
          view: { ...emptyView, error: `write-failed: ${errorText(error)}` },
          inputCount,
          outputCount: 0,
          deleted: 0,
          error: `write-failed: ${errorText(error)}`,
        }
      }

      // 写入成功后删除原文
      let deleted = 0
      try {
        deleted = await this.service.deleteMemoryIds(sourceIds)
      } catch (error) {
        return {
          view: { ...emptyView, error: `delete-failed: ${errorText(error)}` },
          inputCount,
          outputCount: written.length,
          deleted: 0,
          error: `delete-failed: ${errorText(error)}`,
        }
      }

      const batchRow = {
        id: batchId,
        level,
        status: nextStage ? 'pending' : 'final',
        createdAt: now,
        updatedAt: now,
        dueAt: nextStage ? now + nextStage.afterDays * 86400000 : null,
        dayKey: key || '',
        dayRange: meta?.dayRange ?? null,
        sourceBatchIds,
        sourceIdsCount: sourceIds.length,
        inputCount,
        outputCount: written.length,
        maxItems,
        llmCalls,
        latencyMs,
        fallback: combined?.fallback === true,
        fallbackReason: combined?.fallbackReason ?? null,
        error: null,
      }
      this.state.batches.push(batchRow)
      await this.save()
      return {
        view: batchView(batchRow),
        inputCount,
        outputCount: written.length,
        deleted,
        error: null,
      }
    } catch (error) {
      return {
        view: { ...emptyView, error: errorText(error) },
        inputCount,
        outputCount: 0,
        deleted: 0,
        error: errorText(error),
      }
    }
  }

  /** 渲染记忆条目给模型。 */
  #renderSources(items, level) {
    return items
      .map((item) => {
        const payload = item.payload ?? {}
        const time = this.service.formatTs(Number(payload.ts) || 0)
        const kind = payload.kind ?? 'note'
        const batch = payload.batch ? ` #${payload.batch}` : ''
        return `- [${time}·${kind}${batch}] ${String(payload.text ?? '').trim()}`
      })
      .join('\n')
  }

  /** 在全库检索相似记忆（事件合并参考），绝不加载全库到内存。 */
  async #findRelated(sources) {
    const cfg = this.service.cfg()
    const threshold = Math.min(1, Math.max(0.5, Number(cfg.experimentalEventMergeThreshold) || 0.85))
    const maxCandidates = Math.max(1, Math.min(200, Number(cfg.experimentalEventMergeMaxCandidates) || 30))
    const ownIds = new Set(sources.map((item) => item.id))
    const related = new Map()
    // 只探测最多 20 条源记忆，控制查询次数
    for (const source of sources.slice(0, 20)) {
      const vector = source.vector
      if (!Array.isArray(vector)) continue
      try {
        const hits = await this.service.searchSimilar(vector, {
          limit: 5,
          threshold,
          excludeIds: [...ownIds, ...related.keys()],
        })
        for (const hit of hits) {
          if (!related.has(hit.id)) related.set(hit.id, hit)
          if (related.size >= maxCandidates) break
        }
      } catch {
        /* 忽略单条检索失败 */
      }
      if (related.size >= maxCandidates) break
    }
    return [...related.values()].slice(0, maxCandidates)
  }

  /** 调一次整理 LLM。 */
  async #callLLM(llm, { level, stage, items, rendered, related, isFirst }) {
    const cfg = this.service.cfg()
    const maxFacts = Math.max(1, (stage?.maxItems ?? 20) - 1)
    const relatedText = isFirst && related.length > 0
      ? `\n\n【可能相关的其他事件记忆（仅参考，不要删除/编造，可合并同一事件的信息）】\n${renderMemoryLines(related, 6000, (item) => `- [${this.service.formatTs(item.ts)}·${item.kind}${item.batch ? ' #' + item.batch : ''}] ${item.text.slice(0, 500)}`)}`
      : ''
    const customPrompt = String(cfg.consolidationPrompt ?? '').trim()
    const system = customPrompt || DEFAULT_PROMPT
    const user = [
      `这是第 ${level} 级记忆整理。本批共 ${items.length} 条记忆。`,
      `请输出 JSON：summary、facts（条数由你按重要性决定，最多 ${maxFacts} 条）、可选 event。`,
      '精简是默认目标：优先保留关键事实、偏好、决定、时间和人名；重复、寒暄和流水账直接丢弃。',
      '',
      '【本批记忆】',
      rendered,
      relatedText,
    ].join('\n')
    const startedAt = Date.now()
    const response = await llm.client.chat({
      model: llm.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: level >= 3 ? 2048 : level === 2 ? 1536 : 1024,
      temperature: 0.2,
    })
    const parsed = extractJson(response.text)
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`整理模型未返回可解析 JSON：${String(response.text).slice(0, 200)}`)
    }
    return {
      data: {
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        facts: Array.isArray(parsed.facts) ? parsed.facts : [],
        event: parsed.event && typeof parsed.event === 'object' ? parsed.event : null,
      },
      latencyMs: response.latencyMs ?? Date.now() - startedAt,
      raw: response.text,
      usage: response.usage ?? null,
    }
  }

  /** 多块结果合并。 */
  async #mergePartials(llm, partials, stage) {
    const summaries = partials.map((partial, index) => `## 分块 ${index + 1}\n${JSON.stringify(partial.data)}`).join('\n\n')
    const startedAt = Date.now()
    try {
      const response = await llm.client.chat({
        model: llm.model,
        messages: [
          {
            role: 'system',
            content:
              '你在合并多个记忆整理分块的结果。请合并去重，输出同样格式的严格 JSON：{"summary":"...","facts":[...],"event":{...}}；facts 不要超过上限。',
          },
          {
            role: 'user',
            content: `facts 上限 ${Math.max(1, (stage?.maxItems ?? 20) - 1)}。\n\n${summaries}`,
          },
        ],
        maxTokens: 2048,
        temperature: 0.2,
      })
      const parsed = extractJson(response.text)
      if (!parsed || typeof parsed !== 'object') throw new Error('merge-no-json')
      return {
        data: {
          summary: typeof parsed.summary === 'string' ? parsed.summary : '',
          facts: Array.isArray(parsed.facts) ? parsed.facts : [],
          event: parsed.event && typeof parsed.event === 'object' ? parsed.event : null,
        },
        latencyMs: response.latencyMs ?? Date.now() - startedAt,
      }
    } catch {
      // 合并失败：简单拼接（去重）
      const facts = []
      const seen = new Set()
      for (const partial of partials) {
        for (const fact of partial.data.facts ?? []) {
          const text = String(fact?.text ?? '').trim()
          if (!text || seen.has(text)) continue
          seen.add(text)
          facts.push(fact)
        }
      }
      return {
        data: {
          summary: partials.map((partial) => partial.data.summary).filter(Boolean).join('；'),
          facts,
          event: null,
        },
        latencyMs: 0,
      }
    }
  }

  /** 纯规则压缩（LLM 不可用时的回退）。 */
  #ruleCompress(chunks, stage) {
    const maxItems = Math.max(1, stage?.maxItems ?? 12)
    const facts = []
    const seen = new Set()
    for (const chunk of chunks) {
      for (const item of chunk) {
        const text = String(item.payload?.text ?? '').trim()
        if (!text) continue
        const normalized = text.slice(0, 80)
        if (seen.has(normalized)) continue
        seen.add(normalized)
        facts.push({
          text,
          kind: item.payload?.kind === 'summary' || item.payload?.kind === 'event' ? 'note' : (item.payload?.kind ?? 'note'),
        })
        if (facts.length >= Math.max(1, maxItems - 1)) break
      }
      if (facts.length >= Math.max(1, maxItems - 1)) break
    }
    const summary = facts
      .slice(0, 3)
      .map((fact) => fact.text.slice(0, 80))
      .join('；')
    return {
      data: {
        summary: summary ? `规则整理：${summary}` : '',
        facts,
        event: null,
        fallback: true,
        fallbackReason: 'no-llm',
      },
      latencyMs: 0,
    }
  }
}
