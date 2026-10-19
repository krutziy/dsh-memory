/**
 * 睡眠控制器（v0.4）。
 *
 * - 每个配置的睡眠时间（默认 00:00，按用户时区）检查一次；
 * - 最近 idleMinutes 分钟内没有人类消息、且没有运行中的会话，才开始“睡觉”；
 * - 忙则每 sleepRetryMinutes 分钟重试，直到能睡（不设截止时间）；
 * - 睡觉期间用户发消息：自动召回阶段拦截，让对方只回复 zzzZZ，
 *   并把用户原话排队；整理完成后用 agent.followup 继续处理；
 * - 睡觉期间自动记录会跳过 zzzZZ 轮次，避免污染记忆。
 */
import { randomUUID } from 'node:crypto'
import { dayKey, formatDuration, isAtOrAfterTime, parseHhMm } from './util.js'

/** 睡眠/唤醒期间使用的上下文注入消息 source kind。 */
export const SLEEP_SOURCE = 'dsh-memory-sleep'
export const WAKE_SOURCE = 'dsh-memory-wake'

/** 构造一条 source.kind 为指定值的 user 消息。 */
function contextMessage(kind, id, text) {
  return {
    id: `${id}-${randomUUID()}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind },
  }
}

/** 从消息列表取出最后一条真实人类消息文本。 */
export function lastHumanText(messages) {
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'user') continue
    if (message.source?.kind !== 'user') continue
    const parts = []
    for (const block of message.content ?? []) {
      if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
    const text = parts.join('\n').trim()
    if (text) return text
  }
  return ''
}

export class SleepController {
  /**
   * @param {import('./service.js').MemoryService} service
   * @param {import('./consolidation.js').ConsolidationEngine} engine
   */
  constructor(service, engine) {
    this.service = service
    this.engine = engine
    this.ctx = service.ctx
    this.logger = service.logger
    this.disposed = false

    this.sleeping = false
    this.sleepingSince = 0
    this.lastActivityAt = Date.now()
    this.lastSleepDayKey = ''
    this.nextAttemptAt = 0
    this.lastSkipReason = ''
    this.lastError = ''
    this.lastResult = null
    this.pending = []
    this.runningSessions = new Set()
    this.timer = null
    this.startedAt = Date.now()
  }

  /** 注册事件监听与定时器（由插件 effect 持有）。 */
  start() {
    this.ctx.effect(
      () =>
        this.ctx.on('api-session/activity', (sessionId, updatedAt) => {
          try {
            this.touch(updatedAt)
          } catch {
            /* ignore */
          }
        }),
      'dsh-memory: sleep activity',
    )
    this.ctx.effect(
      () =>
        this.ctx.on('api-session/status', (sessionId, running) => {
          if (running) this.runningSessions.add(String(sessionId))
          else this.runningSessions.delete(String(sessionId))
        }),
      'dsh-memory: sleep session status',
    )
    this.ctx.effect(
      () =>
        this.ctx.on('agent/status', (payload) => {
          const id = String(payload?.agent?.id ?? '')
          if (!id) return
          if (payload?.status === 'running') this.runningSessions.add(id)
          else this.runningSessions.delete(id)
        }),
      'dsh-memory: sleep agent status',
    )
    this.ctx.effect(
      () =>
        this.ctx.on('session/event', (session, event) => {
          try {
            if (event?.type === 'user/message' && event.data?.source?.kind === 'user') {
              this.touch(Date.now())
            }
          } catch {
            /* ignore */
          }
        }),
      'dsh-memory: sleep user activity',
    )
    this.ctx.effect(
      () => () => {
        this.disposed = true
        if (this.timer) {
          try {
            this.timer()
          } catch {
            /* ignore */
          }
          this.timer = null
        }
      },
      'dsh-memory: sleep dispose',
    )
    try {
      if (typeof this.ctx.interval === 'function') {
        this.timer = this.ctx.interval(() => this.tick(), 30000)
      } else {
        this.timer = () => {}
        const handle = setInterval(() => this.tick(), 30000)
        handle.unref?.()
        this.timer = () => clearInterval(handle)
      }
    } catch (error) {
      this.logger.warn?.(`[dsh-memory] 睡眠定时器启动失败：${error?.message ?? error}`)
    }
    // 启动后 15 秒做一次补检查（允许错过睡眠点的 DSH 启动后补睡）
    const kickoff = setTimeout(() => this.tick(), 15000)
    kickoff.unref?.()
    this.service.debugLog('[dsh-memory] 睡眠控制器已启动')
  }

  /** 用户活动时间戳。 */
  touch(ts) {
    const value = Number(ts) > 0 ? Number(ts) : Date.now()
    if (value > this.lastActivityAt) this.lastActivityAt = value
    this.lastSkipReason = ''
  }

  /** 睡眠配置。 */
  options() {
    const cfg = this.service.cfg()
    const time = this.service.timeOptions()
    return {
      enabled: cfg.consolidationEnabled === true,
      sleepAt: String(cfg.sleepAt ?? '00:00'),
      sleepMinutes: parseHhMm(cfg.sleepAt) ?? 0,
      retryMs: Math.max(1, Number(cfg.sleepRetryMinutes) || 15) * 60000,
      idleMs: Math.max(1, Number(cfg.idleMinutes) || 60) * 60000,
      timeZone: time.timeZone,
      timeZoneLabel: time.timeZoneLabel,
    }
  }

  /** 当前是否在睡觉（整理中）。 */
  isSleeping() {
    return this.sleeping
  }

  /** 是否空闲：没有运行中的会话，且最近 idle 分钟没有人类消息。 */
  isIdle(now = Date.now()) {
    const options = this.options()
    if (this.runningSessions.size > 0) return false
    return now - this.lastActivityAt >= options.idleMs
  }

  /** 定时检查（每 30 秒）。 */
  tick() {
    if (this.disposed) return
    const options = this.options()
    if (!options.enabled) return
    if (this.sleeping) return
    const now = Date.now()
    const tz = options.timeZone
    const today = dayKey(now, tz)
    if (this.lastSleepDayKey === today) return
    if (!isAtOrAfterTime(options.sleepAt, tz, now)) return
    if (now < this.nextAttemptAt) return
    if (this.runningSessions.size > 0) {
      this.lastSkipReason = '有会话正在运行'
      this.nextAttemptAt = now + options.retryMs
      return
    }
    if (!this.isIdle(now)) {
      const idleMinutes = Math.round((now - this.lastActivityAt) / 60000)
      this.lastSkipReason = `用户最近 ${idleMinutes} 分钟内有会话，等待空闲`
      this.nextAttemptAt = now + options.retryMs
      return
    }
    this.startSleep({ manual: false, reason: 'schedule' })
  }

  /**
   * 开始睡觉并执行整理。手动触发时忽略空闲检测。
   * @param {{manual?:boolean, reason?:string}} options
   */
  async startSleep({ manual = false, reason = 'schedule' } = {}) {
    if (this.disposed) return { ok: false, reason: 'disposed' }
    if (this.sleeping) return { ok: false, reason: 'already-sleeping' }
    if (this.engine.busy) return { ok: false, reason: 'engine-busy' }
    this.sleeping = true
    this.sleepingSince = Date.now()
    this.lastError = ''
    this.lastSkipReason = ''
    this.service.debugLog(`[dsh-memory] 开始睡觉整理（${manual ? '手动' : '定时'}）`)
    try {
      const result = await this.engine.run({ manual, reason })
      this.lastResult = result
      if (!result.ok && result.errors?.length > 0) this.lastError = result.errors[0]
    } catch (error) {
      this.lastError = error?.message ?? String(error)
      this.lastResult = { ok: false, errors: [this.lastError] }
      this.logger.warn?.(`[dsh-memory] 睡眠整理失败：${this.lastError}`)
    } finally {
      const options = this.options()
      this.lastSleepDayKey = dayKey(this.sleepingSince, options.timeZone)
      this.sleeping = false
      this.nextAttemptAt = 0
      this.service.debugLog(
        `[dsh-memory] 睡醒，时长 ${formatDuration(Date.now() - this.sleepingSince)}${this.lastError ? `（有错误：${this.lastError}）` : ''}`,
      )
      await this.flushPending()
    }
    return this.lastResult ?? { ok: true }
  }

  /** 手动请求（HTTP 用：立即返回 accepted，后台执行）。 */
  requestManual() {
    if (this.sleeping) return { ok: false, reason: 'already-sleeping' }
    if (this.engine.busy) return { ok: false, reason: 'engine-busy' }
    this.startSleep({ manual: true, reason: 'manual' })
    return { ok: true, started: true }
  }

  /**
   * 睡觉期间的消息拦截（由 recall 控制器调用）。
   * @returns {null | {queued:boolean, message?:object}}
   */
  interceptPreStep(payload, decision) {
    if (!this.sleeping) return null
    if (payload?.step !== 1) return { queued: false }
    if (decision?.kind !== 'enter') return { queued: false }
    const text = lastHumanText(decision.messages) || lastHumanText(payload.messages)
    if (!text) return { queued: false }
    this.queueMessage({
      agent: payload?.agent,
      sessionId: String(payload?.agent?.id ?? ''),
      text,
    })
    this.service.stats.sleepReplies = (this.service.stats.sleepReplies ?? 0) + 1
    return {
      queued: true,
      message: contextMessage(
        SLEEP_SOURCE,
        'memory-sleep',
        `【记忆整理中】AI 正在睡觉整理长期记忆，稍后醒来会自动继续处理你刚才的消息。\n现在请只回复：zzzZZ（可以带一两个 Zzz 或 💤，不要回复任何其他内容，不要调用工具）。`,
      ),
    }
  }

  /** 排队一条睡眠期间的用户消息。 */
  queueMessage({ agent, sessionId, text }) {
    const clean = String(text ?? '').trim()
    if (!clean) return
    const id = String(agent?.id ?? sessionId ?? '')
    if (!id) return
    this.pending.push({ agent, sessionId: id, text: clean, at: Date.now() })
    if (this.pending.length > 20) this.pending = this.pending.slice(-20)
  }

  /** 醒来后继续处理排队消息。 */
  async flushPending() {
    if (this.pending.length === 0) return
    const bySession = new Map()
    for (const item of this.pending) {
      const id = item.sessionId
      if (!bySession.has(id)) bySession.set(id, { agent: item.agent, texts: [] })
      bySession.get(id).texts.push(item.text)
    }
    this.pending = []
    for (const [sessionId, group] of bySession) {
      const text = group.texts.map((item, index) => `${index + 1}. ${item}`).join('\n')
      const content = `【记忆整理完成】AI 已睡醒。请继续处理用户在睡觉期间发来的消息：\n${text}`
      try {
        const agent = group.agent
        if (agent && typeof agent.followup === 'function') {
          agent.followup(contextMessage(WAKE_SOURCE, 'memory-wake', content))
          this.service.debugLog(`[dsh-memory] 睡醒后继续处理 ${sessionId} 的排队消息`)
          continue
        }
        const live = this.ctx.agents?.get?.(sessionId)
        if (live && typeof live.followup === 'function') {
          live.followup(contextMessage(WAKE_SOURCE, 'memory-wake', content))
          continue
        }
        this.logger.warn?.(`[dsh-memory] 会话 ${sessionId} 已不在运行，跳过排队消息`)
      } catch (error) {
        this.logger.warn?.(`[dsh-memory] 睡醒后继续处理失败：${error?.message ?? error}`)
      }
    }
  }

  /** 状态视图（给 /status 与 GUI）。 */
  status() {
    const options = this.options()
    const now = Date.now()
    return {
      enabled: options.enabled,
      sleeping: this.sleeping,
      sleepingSince: this.sleepingSince,
      sleepingSinceTime: this.sleepingSince ? this.service.formatTs(this.sleepingSince) : '',
      sleepAt: options.sleepAt,
      retryMinutes: Math.round(options.retryMs / 60000),
      idleMinutes: Math.round(options.idleMs / 60000),
      timezone: options.timeZoneLabel,
      lastActivityAt: this.lastActivityAt,
      lastActivityTime: this.service.formatTs(this.lastActivityAt),
      idleForMinutes: Math.max(0, Math.floor((now - this.lastActivityAt) / 60000)),
      nextAttemptAt: this.nextAttemptAt,
      nextAttemptTime: this.nextAttemptAt ? this.service.formatTs(this.nextAttemptAt) : '',
      lastSleepDayKey: this.lastSleepDayKey,
      lastSkipReason: this.lastSkipReason,
      lastError: this.lastError,
      lastResult: this.lastResult
        ? {
            ok: this.lastResult.ok,
            startedAt: this.lastResult.startedAt,
            finishedAt: this.lastResult.finishedAt,
            durationMs: this.lastResult.durationMs,
            levels: this.lastResult.levels ?? {},
            batches: (this.lastResult.batches ?? []).slice(-10),
            deleted: this.lastResult.deleted ?? 0,
            errors: (this.lastResult.errors ?? []).slice(0, 5),
          }
        : null,
      pendingCount: this.pending.length,
      pendingPreview: this.pending.slice(-5).map((item) => ({
        sessionId: item.sessionId,
        text: item.text.slice(0, 120),
        at: item.at,
        time: this.service.formatTs(item.at),
      })),
      runningSessions: this.runningSessions.size,
      engine: this.engine.summary?.() ?? null,
    }
  }
}
