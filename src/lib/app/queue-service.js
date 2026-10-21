/**
 * 整理队列（批次台账）服务：记忆片段压缩状态的唯一事实源。
 *
 * 设计见 docs/QUEUE.md：
 * - 事件批次 = 会话 × 日期；同一天不同会话得到不同编号；
 * - 编号 5 位、顺序分配、批次终态后回收；稳定 key 只留在台账历史里；
 * - 状态：collecting → sealed → running → waiting → merged/final（失败 failed 可重试）；
 * - L1 事件片段 → L2 周片段 → L3 长期片段，后两层为 N:1 合并。
 *
 * 持久化：$DSH_HOME/storages/dsh-memory/queue.json
 * 旧版任务列表 consolidation.json 会在启动时一次性迁移（旧文件保留）。
 */
import { join } from 'node:path'
import {
  BATCH_STATUS,
  allocateBatchNo,
  eventBatchKey,
  formatBatchNo,
  isActiveBatch,
  monthKeyOfWeek,
  weekEndMs,
  weekKeyOf,
} from '../domain/fragments.js'
import { dshHome, errorText, readJsonFile, writeJsonFileAtomic } from '../util/index.js'

const STATE_VERSION = 2
const MAX_TERMINAL_BATCHES = 800
const MAX_HISTORY = 60
const MAX_ACTIVE_ROWS = 40

/** 把批次行转成给 UI 的轻量视图。 */
function batchView(batch) {
  const no = batch.status === BATCH_STATUS.MERGED || batch.status === BATCH_STATUS.FINAL ? '' : formatBatchNo(batch.no)
  return {
    key: batch.key,
    no,
    level: batch.level,
    status: batch.status,
    dayKey: batch.dayKey ?? '',
    weekKey: batch.weekKey ?? '',
    monthKey: batch.monthKey ?? '',
    createdAt: batch.createdAt ?? 0,
    sealedAt: batch.sealedAt ?? 0,
    dueAt: batch.dueAt ?? 0,
    finishedAt: batch.finishedAt ?? 0,
    sourceCount: batch.inputCount ?? 0,
    outputCount: batch.outputCount ?? 0,
    attempts: batch.attempts ?? 0,
    lastError: batch.lastError ?? null,
    sourceKeys: batch.sourceKeys ?? [],
  }
}

export class QueueService {
  /** @param {import('./memory-service.js').MemoryService} service */
  constructor(service) {
    this.service = service
    this.logger = service.logger
    this.statePath = join(dshHome(), 'storages', 'dsh-memory', 'queue.json')
    this.legacyPath = join(dshHome(), 'storages', 'dsh-memory', 'consolidation.json')
    this.state = { version: STATE_VERSION, lastNo: 0, batches: [], history: [], lastRun: null }
    this.loaded = false
    this.loading = null
  }

  // ------------------------------------------------------------------
  // 持久化
  // ------------------------------------------------------------------

  async load() {
    if (this.loaded) return this.state
    if (this.loading) return this.loading
    this.loading = this.#loadInner().finally(() => {
      this.loading = null
    })
    return this.loading
  }

  async #loadInner() {
    const data = readJsonFile(this.statePath, null)
    if (data && typeof data === 'object' && Array.isArray(data.batches)) {
      this.state = {
        version: STATE_VERSION,
        lastNo: Number(data.lastNo) || 0,
        batches: data.batches.filter(Boolean),
        history: Array.isArray(data.history) ? data.history : [],
        lastRun: data.lastRun ?? null,
      }
      this.loaded = true
      return this.state
    }
    await this.#migrateLegacy()
    this.loaded = true
    await this.save()
    return this.state
  }

  /** 从旧 consolidation.json 迁移批次（幂等：只在 queue.json 不存在时调用）。 */
  async #migrateLegacy() {
    const legacy = readJsonFile(this.legacyPath, null)
    if (!legacy || !Array.isArray(legacy.batches) || legacy.batches.length === 0) return
    const tz = this.service.timeOptions().timeZone
    const cfg = this.service.cfg()
    const level2AfterDays = Math.max(1, Number(cfg.level2AfterDays) || 7)
    const now = Date.now()
    const usedNos = new Set()
    const batches = []
    for (const old of legacy.batches) {
      if (!old || old.id === undefined) continue
      const oldNo = String(old.id)
      const level = Number(old.level) || 1
      const inFlight = old.status === 'pending' || old.status === 'processing'
      const isFinal = old.status === 'final'
      const status = inFlight ? BATCH_STATUS.WAITING : isFinal ? BATCH_STATUS.FINAL : BATCH_STATUS.MERGED
      const dayKey = String(old.dayKey ?? '')
      const weekKey = dayKey ? weekKeyOf(dayKey) : ''
      const monthKey = weekKey ? monthKeyOfWeek(weekKey) : ''
      let no = null
      if (inFlight && /^\d{5}$/.test(oldNo) && !usedNos.has(oldNo)) {
        no = oldNo
        usedNos.add(oldNo)
      }
      const dueAt =
        Number(old.dueAt) > 0
          ? Number(old.dueAt)
          : inFlight && weekKey
            ? weekEndMs(weekKey, tz) + level2AfterDays * 86400000
            : 0
      batches.push({
        key: dayKey ? `${dayKey}#legacy-${oldNo}` : `legacy-${oldNo}`,
        no,
        level,
        status,
        dayKey,
        weekKey,
        monthKey,
        sessionId: '',
        createdAt: Number(old.createdAt) || now,
        sealedAt: Number(old.createdAt) || now,
        startedAt: 0,
        finishedAt: status === BATCH_STATUS.WAITING ? 0 : Number(old.updatedAt) || now,
        dueAt: status === BATCH_STATUS.WAITING ? dueAt : 0,
        inputCount: Number(old.inputCount) || Number(old.sourceCount) || 0,
        outputCount: Number(old.outputCount) || 0,
        deleted: 0,
        attempts: Number(old.attempts) || 0,
        lastError: old.error ? String(old.error) : null,
        sourceKeys: Array.isArray(old.sourceBatchIds) ? old.sourceBatchIds.map((id) => `legacy-${id}`) : [],
        legacy: true,
      })
    }
    let lastNo = 0
    for (const batch of batches) {
      if (batch.no) lastNo = Math.max(lastNo, Number(batch.no) || 0)
    }
    const history = Array.isArray(legacy.history)
      ? legacy.history.slice(-MAX_HISTORY).map((entry) => ({
          at: Number(entry.at) || 0,
          manual: entry.manual === true,
          durationMs: Number(entry.durationMs) || 0,
          levels: entry.levels ?? {},
          errors: Array.isArray(entry.errors) ? entry.errors : [],
          legacy: true,
        }))
      : []
    this.state = { version: STATE_VERSION, lastNo, batches, history, lastRun: legacy.lastRun ?? null }
    this.service.debugLog?.(`[dsh-memory] 已从旧任务列表迁移 ${batches.length} 个批次到 queue.json`)
  }

  async save() {
    const terminal = this.state.batches.filter((batch) => !isActiveBatch(batch))
    const active = this.state.batches.filter((batch) => isActiveBatch(batch))
    if (terminal.length > MAX_TERMINAL_BATCHES) {
      terminal.sort((a, b) => (a.finishedAt ?? a.createdAt ?? 0) - (b.finishedAt ?? b.createdAt ?? 0))
      terminal.splice(0, terminal.length - MAX_TERMINAL_BATCHES)
    }
    const batches = [...terminal, ...active].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    if (this.state.history.length > MAX_HISTORY) this.state.history = this.state.history.slice(-MAX_HISTORY)
    const next = { ...this.state, version: STATE_VERSION, batches }
    try {
      writeJsonFileAtomic(this.statePath, next)
    } catch (error) {
      this.logger.warn?.(`[dsh-memory] 保存整理队列失败：${errorText(error)}`)
    }
  }

  // ------------------------------------------------------------------
  // 查询
  // ------------------------------------------------------------------

  /** 活跃批次（占用编号）。 */
  activeBatches() {
    return this.state.batches.filter((batch) => isActiveBatch(batch))
  }

  /** 当前占用中的编号集合。 */
  activeNos() {
    const set = new Set()
    for (const batch of this.state.batches) {
      if (batch.no && isActiveBatch(batch)) set.add(String(batch.no))
    }
    return set
  }

  findByNo(no) {
    const text = String(no ?? '')
    return this.state.batches.find((batch) => String(batch.no ?? '') === text) ?? null
  }

  findByKey(key) {
    return this.state.batches.find((batch) => batch.key === key) ?? null
  }

  /** 分配一个编号（不写盘）。 */
  allocateNo() {
    const { no, lastNo } = allocateBatchNo(this.activeNos(), this.state.lastNo)
    if (no) this.state.lastNo = lastNo
    return no
  }

  /** 释放编号（终态时调用）。 */
  releaseNo(batch) {
    if (!batch) return
    batch.no = null
  }

  // ------------------------------------------------------------------
  // 事件批次（采集时调用）
  // ------------------------------------------------------------------

  /** 当天该会话的收集中的事件批次；不存在则创建。 */
  async ensureEventBatch({ dayKey, sessionId }) {
    const sid = String(sessionId ?? '')
    if (!dayKey || !sid) return null
    await this.load()
    const existing = this.state.batches.find(
      (batch) =>
        batch.status === BATCH_STATUS.COLLECTING &&
        batch.dayKey === dayKey &&
        String(batch.sessionId ?? '') === sid,
    )
    if (existing) return existing
    const now = Date.now()
    const seq = this.#nextEventSeq(dayKey)
    const no = this.allocateNo()
    const weekKey = weekKeyOf(dayKey)
    const batch = {
      key: eventBatchKey(dayKey, seq),
      no: no || null,
      level: 1,
      status: BATCH_STATUS.COLLECTING,
      dayKey,
      weekKey,
      monthKey: monthKeyOfWeek(weekKey),
      sessionId: sid,
      createdAt: now,
      sealedAt: 0,
      startedAt: 0,
      finishedAt: 0,
      dueAt: 0,
      inputCount: 0,
      outputCount: 0,
      deleted: 0,
      attempts: 0,
      lastError: null,
      sourceKeys: [],
    }
    this.state.batches.push(batch)
    await this.save()
    return batch
  }

  /** 当天没有会话归属的原始片段（手动保存/旧数据）用的杂项批次。 */
  async ensureMiscBatch(dayKey) {
    await this.load()
    const key = eventBatchKey(dayKey, 'misc')
    const existing = this.state.batches.find((batch) => batch.key === key && batch.status === BATCH_STATUS.COLLECTING)
    if (existing) return existing
    const now = Date.now()
    const weekKey = weekKeyOf(dayKey)
    const batch = {
      key,
      no: this.allocateNo() || null,
      level: 1,
      status: BATCH_STATUS.COLLECTING,
      dayKey,
      weekKey,
      monthKey: monthKeyOfWeek(weekKey),
      sessionId: '',
      createdAt: now,
      sealedAt: 0,
      startedAt: 0,
      finishedAt: 0,
      dueAt: 0,
      inputCount: 0,
      outputCount: 0,
      deleted: 0,
      attempts: 0,
      lastError: null,
      sourceKeys: [],
    }
    this.state.batches.push(batch)
    return batch
  }

  /** 当天已存在的事件序号最大值 + 1。 */
  #nextEventSeq(dayKey) {
    let max = 0
    for (const batch of this.state.batches) {
      if (!String(batch.key ?? '').startsWith(`${dayKey}#`)) continue
      if (batch.key === `${dayKey}#misc`) continue
      const match = /#(\d+)$/.exec(batch.key)
      if (match) max = Math.max(max, Number(match[1]))
    }
    return max + 1
  }

  // ------------------------------------------------------------------
  // 状态流转
  // ------------------------------------------------------------------

  /** 封存“今天之前”的收集中的批次（睡眠开始时调用）。 */
  sealCollecting(todayKey) {
    const now = Date.now()
    let count = 0
    for (const batch of this.state.batches) {
      if (batch.status !== BATCH_STATUS.COLLECTING) continue
      if (batch.dayKey && batch.dayKey >= todayKey) continue
      batch.status = BATCH_STATUS.SEALED
      batch.sealedAt = now
      count += 1
    }
    return count
  }

  markRunning(batch) {
    if (!batch) return
    batch.status = BATCH_STATUS.RUNNING
    batch.startedAt = Date.now()
  }

  markWaiting(batch, dueAt) {
    if (!batch) return
    batch.status = BATCH_STATUS.WAITING
    batch.dueAt = Number(dueAt) || 0
    batch.finishedAt = Date.now()
    batch.lastError = null
  }

  markFailed(batch, error) {
    if (!batch) return
    batch.attempts = (batch.attempts ?? 0) + 1
    batch.status = BATCH_STATUS.FAILED
    batch.lastError = errorText(error) || String(error ?? 'unknown error')
    batch.finishedAt = Date.now()
  }

  markMerged(batch) {
    if (!batch) return
    batch.status = BATCH_STATUS.MERGED
    batch.finishedAt = Date.now()
    batch.dueAt = 0
    batch.lastError = null
    this.releaseNo(batch)
  }

  markFinal(batch) {
    if (!batch) return
    batch.status = BATCH_STATUS.FINAL
    batch.finishedAt = Date.now()
    batch.dueAt = 0
    batch.lastError = null
    this.releaseNo(batch)
  }

  /** 到期、等待合并的批次按分组键分组（L1 按周、L2 按月）。 */
  dueGroups(level, now = Date.now()) {
    const groups = new Map()
    for (const batch of this.state.batches) {
      if (batch.status !== BATCH_STATUS.WAITING) continue
      if (Number(batch.level) !== Number(level)) continue
      const dueAt = Number(batch.dueAt) || 0
      if (dueAt <= 0 || dueAt > now) continue
      const groupKey = level === 1 ? batch.weekKey : batch.monthKey
      if (!groupKey) continue
      if (!groups.has(groupKey)) groups.set(groupKey, [])
      groups.get(groupKey).push(batch)
    }
    return groups
  }

  /** 创建 L2/L3 合并批次（分配编号、running 状态）。 */
  createMergeBatch({ level, weekKey = '', monthKey = '', sourceKeys = [] }) {
    const now = Date.now()
    const groupKey = weekKey || monthKey
    const prefix = level === 2 ? 'week:' : 'month:'
    let key = `${prefix}${groupKey}`
    let suffix = 1
    while (this.state.batches.some((batch) => batch.key === key)) {
      suffix += 1
      key = `${prefix}${groupKey}#${suffix}`
    }
    const batch = {
      key,
      no: this.allocateNo() || null,
      level,
      status: BATCH_STATUS.RUNNING,
      dayKey: weekKey,
      weekKey,
      monthKey,
      sessionId: '',
      createdAt: now,
      sealedAt: now,
      startedAt: now,
      finishedAt: 0,
      dueAt: 0,
      inputCount: 0,
      outputCount: 0,
      deleted: 0,
      attempts: 0,
      lastError: null,
      sourceKeys: [...sourceKeys],
    }
    this.state.batches.push(batch)
    return batch
  }

  // ------------------------------------------------------------------
  // 摘要（UI）
  // ------------------------------------------------------------------

  /** 给状态接口/设置页的队列摘要。 */
  summary() {
    const batches = this.state.batches
    const active = batches.filter((batch) => isActiveBatch(batch))
    const byStatus = {}
    const byLevel = {}
    for (const batch of active) {
      byStatus[batch.status] = (byStatus[batch.status] ?? 0) + 1
      byLevel[batch.level] = (byLevel[batch.level] ?? 0) + 1
    }
    const waiting = active.filter((batch) => batch.status === BATCH_STATUS.WAITING && Number(batch.dueAt) > 0)
    const nextDue = waiting.sort((a, b) => a.dueAt - b.dueAt)[0]
    const activeRows = active
      .slice()
      .sort((a, b) => {
        const weight = (batch) =>
          batch.status === BATCH_STATUS.RUNNING
            ? 0
            : batch.status === BATCH_STATUS.FAILED
              ? 1
              : batch.status === BATCH_STATUS.SEALED
                ? 2
                : batch.status === BATCH_STATUS.COLLECTING
                  ? 3
                  : 4
        const diff = weight(a) - weight(b)
        if (diff !== 0) return diff
        return (Number(a.dueAt) || Number(a.createdAt) || 0) - (Number(b.dueAt) || Number(b.createdAt) || 0)
      })
      .slice(0, MAX_ACTIVE_ROWS)
      .map((batch) => ({
        ...batchView(batch),
        createdTime: batch.createdAt ? this.service.formatTs(batch.createdAt) : '',
        dueTime: batch.dueAt ? this.service.formatTs(batch.dueAt) : '',
      }))
    const terminal = batches
      .filter((batch) => !isActiveBatch(batch))
      .sort((a, b) => (b.finishedAt ?? b.createdAt ?? 0) - (a.finishedAt ?? a.createdAt ?? 0))
      .slice(0, 10)
      .map((batch) => ({
        ...batchView(batch),
        finishedTime: batch.finishedAt ? this.service.formatTs(batch.finishedAt) : '',
      }))
    return {
      enabled: this.service.cfg().consolidationEnabled === true,
      pendingTotal: active.length,
      pendingByLevel: byLevel,
      byStatus,
      nextDueAt: nextDue?.dueAt ?? null,
      nextDueTime: nextDue?.dueAt ? this.service.formatTs(nextDue.dueAt) : '',
      active: activeRows,
      recent: terminal,
      history: (this.state.history ?? []).slice(-6).map((entry) => ({
        at: entry.at,
        time: entry.at ? this.service.formatTs(entry.at) : '',
        manual: entry.manual === true,
        durationMs: entry.durationMs ?? 0,
        levels: entry.levels ?? {},
        errors: entry.errors ?? [],
        legacy: entry.legacy === true,
      })),
      lastRun: this.state.lastRun,
      statePath: this.statePath,
    }
  }

  /** 记录一次整理运行（供摘要/历史）。 */
  async recordRun(result) {
    const levels = {}
    for (const [level, stat] of Object.entries(result?.levels ?? {})) {
      levels[level] = { batches: stat.batches ?? 0, input: stat.input ?? 0, output: stat.output ?? 0 }
    }
    this.state.lastRun = {
      at: Date.now(),
      manual: result?.manual === true,
      reason: result?.reason ?? '',
      ok: result?.ok !== false,
      durationMs: result?.durationMs ?? 0,
      levels,
      deleted: result?.deleted ?? 0,
      errors: result?.errors ?? [],
    }
    this.state.history.push({
      at: result?.startedAt ?? Date.now(),
      manual: result?.manual === true,
      reason: result?.reason ?? '',
      durationMs: result?.durationMs ?? 0,
      levels,
      errors: result?.errors ?? [],
    })
    await this.save()
  }
}
