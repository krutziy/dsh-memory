/**
 * 自动召回：在每轮第一步之前，用最后一条真实用户消息做向量检索，
 * 把相关记忆作为一条 source.kind = 'long-term-memory' 的上下文消息
 * 追加进本步的 messages。
 *
 * 该消息会进入会话日志（可回放/可 fork），DSH Web 会把它显示成
 * “上下文注入”行，而不是用户气泡。
 */
import { randomUUID } from 'node:crypto'
import { MEMORY_SOURCE } from '../../shared/protocol.js'
import { errorText } from '../util/index.js'

/** 从消息列表里取出最后一条真实人类消息的文本。 */
function lastUserText(messages) {
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

/** 构造注入用的上下文消息。 */
export function createMemoryMessage(text) {
  return {
    id: `memory-${randomUUID()}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: MEMORY_SOURCE },
  }
}

export class RecallController {
  /**
   * @param {import('./service.js').MemoryService} service
   */
  constructor(service) {
    this.service = service
    this.ctx = service.ctx
    this.logger = service.logger
    /** sessionId → { ids, at }：上一轮注入的记忆（用于 D/E 确认/纠正检测）。 */
    this.lastInjected = new Map()
  }

  /** 识别用户确认/纠正的简单规则（D/E 类复述）。 */
  static detectFeedback(text) {
    const value = String(text ?? '').trim()
    if (!value) return ''
    // 只对短句/明确措辞生效，避免长句误判
    const confirm = /^(对|对呀|对的|没错|是的|嗯对|记住了|记一下|记住这个|yes|correct|right)[。！!,.，\s]*$/i
    const correct = /(不对|不是这样|不是的|错了|应该是|改成|纠正|说错了|actually,? no|not correct)/i
    if (correct.test(value)) return 'correct'
    if (confirm.test(value) || /^(没错|对的|记住了)/.test(value)) return 'confirm'
    return ''
  }

  start() {
    this.ctx.effect(
      () =>
        this.ctx.on('agent/pre-step', async (payload, next) => {
          const decision = await next()
          try {
            return await this.augment(payload, decision)
          } catch (error) {
            this.service.stats.lastRecallError = errorText(error)
            this.service.debugLog(`自动召回失败：${errorText(error)}`)
            return decision
          }
        }),
      'dsh-memory: auto recall',
    )
  }

  async augment(payload, decision) {
    // 睡眠整理期间：不召回，改为让模型只回复 zzzZZ，并把用户原话排队到睡醒后继续处理
    const sleep = this.service.sleep
    if (sleep?.isSleeping?.()) {
      if (payload?.step !== 1) return decision
      if (payload?.signal?.aborted) return decision
      if (decision?.kind !== 'enter') return decision
      const intercepted = sleep.interceptPreStep(payload, decision)
      if (intercepted?.message) {
        return { ...decision, messages: [...decision.messages, intercepted.message] }
      }
      return decision
    }
    const options = this.service.recallOptions()
    if (!options.autoRecall) return decision
    const agentId = String(payload?.agent?.id ?? '')

    // D/E：检查上一轮注入后用户的确认/纠正（仅当门控开启时记录复述）
    if (options.ageGateEnabled && payload?.step === 1) {
      const text = lastUserText(decision.messages) || lastUserText(payload.messages)
      const prior = this.lastInjected.get(agentId)
      const feedback = text ? RecallController.detectFeedback(text) : ''
      if (prior && feedback && Date.now() - prior.at < 10 * 60 * 1000) {
        const weight = feedback === 'confirm' ? 2.0 : 1.0
        void this.service.recordRehearsal(prior.ids, feedback, weight)
        this.lastInjected.delete(agentId)
      }
    }
    if (!this.service.captureOptions().includeSubagents && agentId) {
      const session = this.service.ctx.sessions?.get?.(agentId)
      if (session?.header?.origin === 'subagent') return decision
    }
    if (payload?.step !== 1) return decision
    if (payload?.signal?.aborted) return decision
    if (decision?.kind !== 'enter') return decision
    const query = lastUserText(decision.messages) || lastUserText(payload.messages)
    this.service.stats.recallChecks += 1
    this.service.stats.lastRecallQuery = query.slice(0, 120)
    this.service.stats.lastRecallError = ''
    if (!query || query.length < 2) return decision
    const timeout = AbortSignal.timeout(options.recallTimeoutMs)
    const signal = payload?.signal === undefined ? timeout : AbortSignal.any([payload.signal, timeout])
    const { block, hits } = await this.service.recall(query, { signal })
    if (!block || hits.length === 0) return decision
    this.service.stats.lastRecallInjectAt = Date.now()
    this.service.debugLog(`自动召回 ${hits.length} 条记忆（score ${Number(hits[0].score).toFixed(3)}）`)
    if (options.ageGateEnabled) {
      this.lastInjected.set(agentId, { ids: hits.map((hit) => hit.id), at: Date.now() })
    }
    return {
      ...decision,
      messages: [...decision.messages, createMemoryMessage(block)],
    }
  }
}
