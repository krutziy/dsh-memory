/**
 * 自动召回：在每轮第一步之前，用最后一条真实用户消息做向量检索，
 * 把相关记忆作为一条 source.kind = 'long-term-memory' 的上下文消息
 * 追加进本步的 messages。
 *
 * 该消息会进入会话日志（可回放/可 fork），DSH Web 会把它显示成
 * “上下文注入”行，而不是用户气泡。
 */
import { randomUUID } from 'node:crypto'
import { MEMORY_SOURCE } from './service.js'
import { errorText } from './util.js'

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
    const options = this.service.recallOptions()
    if (!options.autoRecall) return decision
    const agentId = String(payload?.agent?.id ?? '')
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
    const context = this.service.sessionContext(agentId)
    const timeout = AbortSignal.timeout(options.recallTimeoutMs)
    const signal = payload?.signal === undefined ? timeout : AbortSignal.any([payload.signal, timeout])
    const { block, hits } = await this.service.recall(query, {
      signal,
      sessionId: context.sessionId,
      cwd: context.cwd,
    })
    if (!block || hits.length === 0) return decision
    this.service.stats.lastRecallInjectAt = Date.now()
    this.service.debugLog(`自动召回 ${hits.length} 条记忆（score ${hits[0].score.toFixed(3)}）`)
    return {
      ...decision,
      messages: [...decision.messages, createMemoryMessage(block)],
    }
  }
}
