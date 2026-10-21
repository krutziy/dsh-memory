/**
 * 睡眠整理引擎（v0.8「记忆片段」）：
 *
 * 队列（app/queue-service.js）负责记录批次状态与编号；本引擎负责在睡眠窗口里执行压缩：
 *   L1：事件批次（会话 × 日期）→ 事件片段；
 *   L2：到期（周末后 level2AfterDays 天）的多个事件批次按周合并 → 周片段（N:1）；
 *   L3：到期（月末后 level3AfterDays 天）的多个周批次按月合并 → 长期片段（N:1，final，不再带编号）。
 *
 * 编号只存在于批次等待/执行期间；终态（merged/final）后回收，记忆 payload 的 batch 清空。
 *
 * 实验功能（默认关闭）：
 * - 事件合并：整理时用嵌入向量在全库检索相似记忆，只把相关小簇作为参考交给 LLM，
 *   并生成 kind='event' 的事件摘要（不会被整库塞给 LLM）。
 * - 增强记忆：额外保留一份 L1 产物 enhancementDays 天，不参与后续整理，
 *   仅供事件合并/按需搜索使用，到期自动删除。
 */
import {
  BATCH_STATUS,
  monthEndMs,
  monthKeyOfWeek,
  monthStartMs,
  weekEndMs,
  weekStartMs,
} from '../domain/fragments.js'
import { CONSOLIDATION_LEVELS, levelMaxItems } from '../domain/levels.js'
import { dayBoundsFromKey, dayKey, formatDuration } from '../domain/time.js'
import { chunkByChars, errorText, extractJson, renderMemoryLines } from '../util/index.js'

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

/** 不同层级的整理提示（追加在用户消息里）。 */
const LEVEL_HINTS = {
  1: '本批是**同一次会话在同一天**内留下的片段，请合并成一个事件片段：保留这次经历的来龙去脉、决定和结论，细节可以压缩。',
  2: '本批是**同一周内多个事件**的片段，请合并成更少、更抽象的周片段：优先保留重要事实、偏好、决定、人物和项目；重复与琐碎细节丢弃。',
  3: '本批是**同一月内多个周片段**，请合并成长期记忆要点：只保留长期有用的事实、偏好、身份与重要经历，细节可以大量丢弃。',
}

/** 一个批次的对外视图（运行结果用）。 */
function outcomeView(batch, error, inputCount, outputCount) {
  return {
    key: batch?.key ?? '',
    no: batch?.no ?? '',
    level: batch?.level ?? 0,
    status: batch?.status ?? '',
    dayKey: batch?.dayKey ?? '',
    weekKey: batch?.weekKey ?? '',
    monthKey: batch?.monthKey ?? '',
    sourceCount: inputCount ?? batch?.inputCount ?? 0,
    outputCount: outputCount ?? batch?.outputCount ?? 0,
    error: error ? errorText(error) : null,
  }
}

export class ConsolidationEngine {
  /** @param {import('./memory-service.js').MemoryService} service */
  constructor(service) {
    this.service = service
    this.queue = service.taskBoard
    this.logger = service.logger
    this.running = null
  }

  /** 配置级别定义（只在开启「限制每级整理条数」时套用输出上限）。 */
  stages() {
    const limitEnabled = this.service.cfg().consolidationLimitItems === true
    return CONSOLIDATION_LEVELS.map((stage) => ({
      level: stage.level,
      afterDays: stage.afterDays,
      maxItems: levelMaxItems(stage.level, limitEnabled),
    }))
  }

  /** 兼容旧调用：保证队列已加载。 */
  async load() {
    return this.queue.load()
  }

  /** 是否正在整理。 */
  get busy() {
    return this.running !== null
  }

  /** 队列摘要（旧接口名保留，设置页继续用它）。 */
  summary() {
    return this.queue.summary()
  }

  /** 当前各层级活跃批次数量（旧接口名保留）。 */
  summaryLevels() {
    const counts = {}
    for (const batch of this.queue.activeBatches()) counts[batch.level] = (counts[batch.level] ?? 0) + 1
    return counts
  }

  /**
   * 执行一轮整理（睡醒前调用）。同一时间只允许一个 run。
   * @param {{manual?:boolean, reason?:string}} options
   */
  async run(options = {}) {
    await this.queue.load()
    if (this.running) return this.running
    this.running = this.#runInner({ manual: options.manual === true, reason: options.reason ?? 'sleep' }).finally(() => {
      this.running = null
    })
    return this.running
  }

  async #runInner({ manual, reason }) {
    const startedAt = Date.now()
    const cfg = this.service.cfg()
    const tz = this.service.timeOptions().timeZone
    const today = dayKey(Date.now(), tz)
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

      // ---------- 0. 把“没有批次”的原始片段按天归入杂项批次 ----------
      try {
        const loose = await this.service.collectMemories({
          filter: { must: [{ key: 'level', match: { value: 0 } }, { key: 'batch', match: { value: '' } }] },
          withVector: false,
          maxItems: 5000,
          orderBy: { key: 'ts', direction: 'asc' },
        })
        const days = new Set()
        for (const item of loose) {
          const key = dayKey(Number(item.payload?.ts) || 0, tz)
          if (key < today) days.add(key)
        }
        for (const key of days) await this.queue.ensureMiscBatch(key)
        if (days.size > 0) {
          await this.queue.save()
          this.service.debugLog(`[dsh-memory] 为 ${days.size} 天的无批次原始片段建立杂项批次`)
        }
      } catch (error) {
        result.errors.push(`misc-batch: ${errorText(error)}`)
      }

      // ---------- 1. 封批：今天之前的收集中的事件批次 ----------
      const sealed = this.queue.sealCollecting(today)
      if (sealed > 0) await this.queue.save()

      // ---------- 2. L1：事件批次 → 事件片段 ----------
      const l1Candidates = this.queue.state.batches
        .filter(
          (batch) =>
            Number(batch.level) === 1 &&
            (batch.status === BATCH_STATUS.SEALED || batch.status === BATCH_STATUS.FAILED),
        )
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      for (const batch of l1Candidates) {
        const outcome = await this.#processL1(batch)
        result.batches.push(outcome.view)
        this.#mergeStats(result, 1, outcome)
        if (outcome.error) result.errors.push(outcome.error)
        await this.queue.save()
      }

      // ---------- 3. L2：到期事件批次按周 N:1 合并 ----------
      await this.#runMergeLevel({ level: 2, tz, cfg, result })

      // ---------- 4. L3：到期周批次按月 N:1 合并（final） ----------
      await this.#runMergeLevel({ level: 3, tz, cfg, result })

      // ---------- 5. 增强记忆到期清理 ----------
      try {
        const expired = await this.service.listExpiredEnhanced(Date.now())
        if (expired.length > 0) {
          await this.service.deleteMemoryIds(expired)
          result.deleted += expired.length
        }
      } catch (error) {
        result.errors.push(`enhanced-expiry: ${errorText(error)}`)
      }

      // ---------- 6. 整理后自动维护（去重/过期/索引） ----------
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
    try {
      await this.queue.recordRun(result)
    } catch (error) {
      this.logger.warn?.(`[dsh-memory] 保存整理历史失败：${errorText(error)}`)
    }
    const levelText = Object.entries(result.levels)
      .map(([level, stat]) => `L${level}:${stat.batches}批/${stat.input}→${stat.output}`)
      .join(' ')
    this.service.debugLog(`睡眠整理完成 ${formatDuration(result.durationMs)} ${levelText} 删除旧片段 ${result.deleted} 条`)
    return result
  }

  /** 执行某一层的 N:1 合并（L2 按周、L3 按月）。 */
  async #runMergeLevel({ level, tz, cfg, result }) {
    const groups = this.queue.dueGroups(level - 1, Date.now())
    if (groups.size === 0) return
    // 合并产物的“下一层等待天数”：L2 等到月末后 level3AfterDays 再合并成长期；
    // L3 是最终层，不再等待。
    const afterDays = level === 2 ? Math.max(1, Number(cfg.level3AfterDays) || 30) : 0
    for (const [groupKey, sourceBatches] of groups) {
      const outcome = await this.#mergeGroup({ level, groupKey, sourceBatches, afterDays, tz })
      result.batches.push(outcome.view)
      this.#mergeStats(result, level, outcome)
      if (outcome.error) result.errors.push(outcome.error)
      await this.queue.save()
    }
  }

  /** 处理一个 L1 事件批次。 */
  async #processL1(batch) {
    try {
      this.queue.markRunning(batch)
      const tz = this.service.timeOptions().timeZone
      const cfg = this.service.cfg()
      const sources = await this.#collectL1Sources(batch, tz)
      const inputCount = sources.length
      if (inputCount === 0) {
        this.queue.markMerged(batch)
        batch.inputCount = 0
        batch.outputCount = 0
        return { view: outcomeView(batch, null, 0, 0), inputCount: 0, outputCount: 0, deleted: 0 }
      }
      const dayRange = batch.dayKey ? dayBoundsFromKey(batch.dayKey, tz) : null
      const anchorTs =
        dayRange?.from ?? (Number(sources[0]?.payload?.anchorTs) || Number(sources[0]?.payload?.ts) || Date.now())
      const compressed = await this.#compressGroup({
        level: 1,
        sources,
        related: cfg.experimentalEventMergeEnabled === true,
      })
      const written = await this.#writeOutputs({
        entries: compressed.entries,
        level: 1,
        batchNo: batch.no,
        batchKey: batch.key,
        anchorTs,
        range: dayRange,
        inputCount,
        relatedCount: compressed.relatedCount,
      })
      const sourceIds = sources.map((item) => item.id)
      const deleted = await this.service.deleteMemoryIds(sourceIds)
      // 实验：增强记忆副本（不进入整理链，不占编号，仅事件/按需召回使用）
      if (cfg.experimentalEnhancementEnabled === true) {
        const days = Math.max(1, Number(cfg.experimentalEnhancementDays) || 7)
        for (const saved of written) {
          try {
            await this.service.addMemory({
              kind: saved.kind ?? 'summary',
              text: `（增强记忆）${saved.text}`,
              meta: {
                level: 1,
                batch: '',
                enhanced: true,
                expiresAt: Date.now() + days * 86400000,
                sourceCount: inputCount,
                consolidatedAt: Date.now(),
                idSeed: `enhanced-${batch.key}`,
              },
            })
          } catch {
            /* 增强记忆失败不影响主链路 */
          }
        }
      }
      batch.inputCount = inputCount
      batch.outputCount = written.length
      batch.deleted = deleted
      batch.llmCalls = compressed.llmCalls
      batch.latencyMs = compressed.latencyMs
      batch.fallback = compressed.fallback
      batch.fallbackReason = compressed.fallbackReason ?? null
      batch.lastError = null
      // 下一层（L2）在该周结束后 afterDays 天到期
      const delay = Math.max(1, Number(cfg.level2AfterDays) || 7)
      const dueAt = batch.weekKey ? weekEndMs(batch.weekKey, tz) + delay * 86400000 : Date.now() + delay * 86400000
      this.queue.markWaiting(batch, dueAt)
      return {
        view: outcomeView(batch, null, inputCount, written.length),
        inputCount,
        outputCount: written.length,
        deleted,
      }
    } catch (error) {
      this.queue.markFailed(batch, error)
      return {
        view: outcomeView(batch, error),
        inputCount: batch.inputCount ?? 0,
        outputCount: batch.outputCount ?? 0,
        deleted: 0,
        error: errorText(error),
      }
    }
  }

  /** 收集 L1 批次的来源原始片段。 */
  async #collectL1Sources(batch, tz) {
    if (batch.dayKey && String(batch.key).endsWith('#misc')) {
      const bounds = dayBoundsFromKey(batch.dayKey, tz)
      return this.service.collectMemories({
        filter: {
          must: [
            { key: 'level', match: { value: 0 } },
            { key: 'batch', match: { value: '' } },
            { key: 'ts', range: { gte: bounds.from, lte: bounds.to } },
          ],
        },
        withVector: true,
        maxItems: 5000,
        orderBy: { key: 'ts', direction: 'asc' },
      })
    }
    const filter = {
      must: [
        { key: 'level', match: { value: 0 } },
        { key: 'batch', match: { value: String(batch.no ?? '') } },
      ],
    }
    return this.service.collectMemories({ filter, withVector: true, maxItems: 5000, orderBy: { key: 'ts', direction: 'asc' } })
  }

  /** 合并一层批次（L2/L3 的 N:1）。 */
  async #mergeGroup({ level, groupKey, sourceBatches, afterDays, tz }) {
    const waitingSources = sourceBatches.filter((batch) => batch.status === BATCH_STATUS.WAITING)
    const sourceNos = waitingSources.map((batch) => String(batch.no ?? '')).filter(Boolean)
    const weekKey = level === 2 ? groupKey : (waitingSources[0]?.weekKey ?? '')
    const monthKey = level === 2 ? monthKeyOfWeek(groupKey) : groupKey
    // 先收集来源；为空则直接关闭来源批次，不创建新批次
    let sources = []
    try {
      if (sourceNos.length > 0) {
        sources = await this.service.collectMemories({
          filter: { must: [{ key: 'level', match: { value: level - 1 } }, { key: 'batch', match: { any: sourceNos } }] },
          withVector: true,
          maxItems: 10000,
          orderBy: { key: 'ts', direction: 'asc' },
        })
      }
    } catch (error) {
      // 收集失败：只记录错误，来源批次保持等待，下次重试
      return { view: outcomeView(null, error), inputCount: 0, outputCount: 0, deleted: 0, error: errorText(error) }
    }
    if (sources.length === 0) {
      for (const batch of waitingSources) this.queue.markMerged(batch)
      return { view: outcomeView(null, null), inputCount: 0, outputCount: 0, deleted: 0 }
    }
    const mergeBatch = this.queue.createMergeBatch({
      level,
      weekKey,
      monthKey,
      sourceKeys: waitingSources.map((batch) => batch.key),
    })
    try {
      const anchorTs = level === 2 ? weekStartMs(weekKey, tz) : monthStartMs(monthKey, tz)
      const compressed = await this.#compressGroup({
        level,
        sources,
        related: this.service.cfg().experimentalEventMergeEnabled === true,
      })
      const written = await this.#writeOutputs({
        entries: compressed.entries,
        level,
        batchNo: level >= 3 ? '' : mergeBatch.no,
        batchKey: mergeBatch.key,
        anchorTs,
        range:
          level === 2
            ? { from: anchorTs, to: weekEndMs(weekKey, tz) }
            : { from: anchorTs, to: monthEndMs(monthKey, tz) },
        inputCount: sources.length,
        relatedCount: compressed.relatedCount,
      })
      const sourceIds = sources.map((item) => item.id)
      const deleted = await this.service.deleteMemoryIds(sourceIds)
      for (const batch of waitingSources) this.queue.markMerged(batch)
      mergeBatch.inputCount = sources.length
      mergeBatch.outputCount = written.length
      mergeBatch.deleted = deleted
      mergeBatch.llmCalls = compressed.llmCalls
      mergeBatch.latencyMs = compressed.latencyMs
      mergeBatch.fallback = compressed.fallback
      mergeBatch.fallbackReason = compressed.fallbackReason ?? null
      if (level >= 3) {
        this.queue.markFinal(mergeBatch)
      } else {
        const dueAt = monthEndMs(monthKey, tz) + afterDays * 86400000
        this.queue.markWaiting(mergeBatch, dueAt)
      }
      return {
        view: outcomeView(mergeBatch, null, sources.length, written.length),
        inputCount: sources.length,
        outputCount: written.length,
        deleted,
      }
    } catch (error) {
      this.queue.markFailed(mergeBatch, error)
      // 合并批次失败后会创建新的批次重试，旧批次不再占用编号
      this.queue.releaseNo(mergeBatch)
      return {
        view: outcomeView(mergeBatch, error),
        inputCount: 0,
        outputCount: 0,
        deleted: 0,
        error: errorText(error),
      }
    }
  }

  /** 调模型（或规则回退）把一组来源片段压缩成输出条目。 */
  async #compressGroup({ level, sources, related = false }) {
    const cfg = this.service.cfg()
    const stage = this.stages().find((item) => item.level === level) ?? { level, maxItems: null }
    const cleanSources = (sources ?? []).filter((item) => item.payload?.text)
    const chunks = chunkByChars(cleanSources, Math.max(1000, Number(cfg.consolidationInputMaxChars) || 12000))
    const relatedItems = related ? await this.#findRelated(cleanSources) : []
    let combined = null
    let llmCalls = 0
    let latencyMs = 0
    try {
      const partials = []
      for (const chunk of chunks) {
        const partial = await this.#callLLM({
          level,
          stage,
          items: chunk,
          rendered: this.#renderSources(chunk),
          related: relatedItems,
          isFirst: partials.length === 0,
        })
        partials.push(partial)
        llmCalls += 1
        latencyMs += partial.latencyMs ?? 0
      }
      combined = partials.length === 1 ? partials[0].data : await this.#mergePartials(partials, stage)
      if (partials.length > 1) llmCalls += 1
    } catch (error) {
      this.service.debugLog(`整理 LLM 不可用，回退规则压缩：${errorText(error)}`)
      const fallback = this.#ruleCompress(chunks, stage)
      combined = { ...fallback.data, fallback: true, fallbackReason: errorText(error) }
    }
    const summary = String(combined?.summary ?? '').trim()
    const facts = Array.isArray(combined?.facts) ? combined.facts : []
    const event = combined?.event && typeof combined.event === 'object' ? combined.event : null
    const limitEnabled = Number.isFinite(stage.maxItems)
    const maxItems = limitEnabled ? Math.max(1, stage.maxItems) : null
    const factLimit = limitEnabled ? Math.max(0, maxItems - (summary ? 1 : 0)) : Infinity
    const selectedFacts = facts
      .filter((fact) => fact && typeof fact.text === 'string' && fact.text.trim())
      .slice(0, factLimit)
      .map((fact) => ({
        text: String(fact.text).trim(),
        kind: ['fact', 'preference', 'project', 'note', 'event'].includes(fact.kind) ? fact.kind : 'fact',
        tags: Array.isArray(fact.tags) ? fact.tags.map(String).slice(0, 8) : [],
      }))
    const rendered = this.#renderSources(cleanSources)
    const entries = []
    if (summary) entries.push({ text: summary, kind: 'summary', tags: ['summary'] })
    for (const fact of selectedFacts) entries.push(fact)
    if (entries.length === 0) {
      entries.push({ text: rendered.slice(0, Math.max(80, Math.min(400, rendered.length))), kind: 'note', tags: ['fallback'] })
    }
    const eventText =
      event?.summary && String(event.summary).trim()
        ? String(event.summary).trim()
        : relatedItems.length > 0
          ? `相关事件：${summary || relatedItems[0].text}`.slice(0, 500)
          : ''
    if (eventText) {
      entries.push({
        text: eventText,
        kind: 'event',
        tags: Array.isArray(event?.tags) ? event.tags.map(String).slice(0, 8) : ['event'],
      })
    }
    return {
      entries,
      relatedCount: relatedItems.length,
      llmCalls,
      latencyMs,
      fallback: combined?.fallback === true,
      fallbackReason: combined?.fallbackReason ?? null,
    }
  }

  /** 把压缩结果写成记忆（分配 level/anchorTs/来源统计，批次内唯一 idSeed）。 */
  async #writeOutputs({ entries, level, batchNo, batchKey, anchorTs, range, inputCount, relatedCount }) {
    const now = Date.now()
    const written = []
    for (const [index, entry] of entries.entries()) {
      const saved = await this.service.addMemory({
        kind: entry.kind === 'summary' ? 'summary' : entry.kind,
        text: entry.text,
        meta: {
          level,
          batch: String(batchNo ?? ''),
          sourceCount: inputCount,
          dayRange: range ?? null,
          consolidatedAt: now,
          relatedCount,
          anchorTs,
          tags: entry.tags,
          // 批次内唯一：避免整理产物的内容哈希与原文（或彼此）相同，
          // 导致“先写入、再删除原文”把新产物一起删掉。
          idSeed: `sleep-${batchKey}-${index}`,
        },
      })
      written.push(saved)
    }
    return written
  }

  /** 渲染记忆条目给模型。 */
  #renderSources(items) {
    return items
      .map((item) => {
        const payload = item.payload ?? {}
        const time = this.service.formatTs(Number(payload.ts) || 0)
        const kind = payload.kind ?? 'note'
        return `- [${time}·${kind}] ${String(payload.text ?? '').trim()}`
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

  /** 调一次整理 LLM（DSH 模型或自定义 provider，由 service 路由）。 */
  async #callLLM({ level, stage, items, rendered, related, isFirst }) {
    const cfg = this.service.cfg()
    const limitEnabled = Number.isFinite(stage?.maxItems)
    const maxFacts = limitEnabled ? Math.max(1, stage.maxItems - 1) : null
    const relatedText =
      isFirst && related.length > 0
        ? `\n\n【可能相关的其他事件记忆（仅参考，不要删除/编造，可合并同一事件的信息）】\n${renderMemoryLines(related, 6000, (item) => `- [${this.service.formatTs(item.ts)}·${item.kind}] ${item.text.slice(0, 500)}`)}`
        : ''
    const customPrompt = String(cfg.consolidationPrompt ?? '').trim()
    const system = customPrompt || DEFAULT_PROMPT
    const countRule = limitEnabled
      ? `请输出 JSON：summary、facts（条数由你按重要性决定，最多 ${maxFacts} 条）、可选 event。`
      : '请输出 JSON：summary、facts（条数由你按重要性自行决定）、可选 event。'
    const levelHint = LEVEL_HINTS[level] ?? ''
    const user = [
      `这是第 ${level} 级记忆整理。本批共 ${items.length} 条记忆。`,
      levelHint,
      countRule,
      '精简是默认目标：优先保留关键事实、偏好、决定、时间和人名；重复、寒暄和流水账直接丢弃。',
      '',
      '【本批记忆】',
      rendered,
      relatedText,
    ].join('\n')
    const startedAt = Date.now()
    const response = await this.service.consolidationChat({
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens: level >= 3 ? 4096 : level === 2 ? 3072 : 2048,
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
      modelSource: response.source ?? '',
      model: response.model ?? '',
    }
  }

  /** 多块结果合并。 */
  async #mergePartials(partials, stage) {
    const summaries = partials.map((partial, index) => `## 分块 ${index + 1}\n${JSON.stringify(partial.data)}`).join('\n\n')
    const startedAt = Date.now()
    try {
      const limitEnabled = Number.isFinite(stage?.maxItems)
      const limitRule = limitEnabled ? `facts 上限 ${Math.max(1, stage.maxItems - 1)}。` : 'facts 条数由你按重要性决定。'
      const response = await this.service.consolidationChat({
        system:
          '你在合并多个记忆整理分块的结果。请合并去重，输出同样格式的严格 JSON：{"summary":"...","facts":[...],"event":{...}}。',
        messages: [{ role: 'user', content: `${limitRule}\n\n${summaries}` }],
        maxTokens: 3072,
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
    const maxItems = Number.isFinite(stage?.maxItems) ? Math.max(1, stage.maxItems) : Infinity
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

  /** 汇总一次运行的分层统计。 */
  #mergeStats(result, level, outcome) {
    if (!result.levels[level]) result.levels[level] = { batches: 0, input: 0, output: 0 }
    result.levels[level].batches += 1
    result.levels[level].input += outcome.inputCount ?? 0
    result.levels[level].output += outcome.outputCount ?? 0
    result.deleted += outcome.deleted ?? 0
  }
}
