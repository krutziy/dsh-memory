/**
 * 自动记录：监听 session/event，在每轮结束时把“用户要点 + 助手回答要点”
 * 以及用户图片的一句话概览写入长期记忆。
 *
 * 只记录 source.kind === 'user' 的真实人类消息；插件自己注入的
 * long-term-memory 上下文、运行时上下文、工具结果等一律不记录。
 */
import { cleanText, truncate } from './util.js'

/** 从 content blocks 里提取纯文本。 */
export function textFromContent(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return cleanText(parts.join('\n'))
}

export class CaptureController {
  /**
   * @param {import('./service.js').MemoryService} service
   */
  constructor(service) {
    this.service = service
    this.ctx = service.ctx
    this.logger = service.logger
    /** sessionId -> { turn, users: string[], assistant: string, images: ImageAttachmentRef[], cwd } */
    this.buffers = new Map()
  }

  /** 注册事件监听（由插件 effect 持有）。 */
  start() {
    this.ctx.effect(
      () =>
        this.ctx.on('session/event', (session, event) => {
          try {
            this.observe(session, event)
          } catch (error) {
            this.logger.warn?.(`[dsh-memory] 记录会话事件失败：${error?.message ?? error}`)
          }
        }),
      'dsh-memory: session capture',
    )
    this.ctx.effect(
      () =>
        this.ctx.on('session/disposed', (session) => {
          this.buffers.delete(String(session?.id ?? ''))
        }),
      'dsh-memory: capture cleanup',
    )
  }

  observe(session, event) {
    const options = this.service.captureOptions()
    if (!options.autoCapture) return
    const sessionId = String(session?.id ?? '')
    if (!sessionId) return
    const header = session?.header
    if (!options.includeSubagents && header?.origin === 'subagent') return

    switch (event?.type) {
      case 'turn/start': {
        this.buffers.set(sessionId, {
          turn: Number(event.data?.turn) || 0,
          users: [],
          assistant: '',
          images: [],
          cwd: String(header?.cwd ?? ''),
        })
        break
      }
      case 'user/message': {
        const buffer = this.buffers.get(sessionId)
        if (!buffer) return
        const message = event.data
        if (message?.source?.kind !== 'user') return
        const text = textFromContent(message?.content)
        if (text) buffer.users.push(text)
        if (Array.isArray(message?.content)) {
          for (const block of message.content) {
            if (block?.type === 'image' && block.attachment) buffer.images.push(block.attachment)
          }
        }
        break
      }
      case 'assistant/message': {
        const buffer = this.buffers.get(sessionId)
        if (!buffer) return
        const text = textFromContent(event.data?.message?.content)
        if (text) buffer.assistant = text
        break
      }
      case 'turn/end': {
        const buffer = this.buffers.get(sessionId)
        this.buffers.delete(sessionId)
        if (!buffer) return
        if (buffer.turn !== (Number(event.data?.turn) || 0)) return
        const reason = event.data?.reason?.kind
        if (reason !== 'completed') return
        this.finalize(sessionId, buffer)
        break
      }
      default:
        break
    }
  }

  /** 一轮结束：入队写入任务（不阻塞 agent 回合）。 */
  finalize(sessionId, buffer) {
    const service = this.service
    const options = service.captureOptions()
    const userText = truncate(cleanText(buffer.users.join('\n\n')), options.captureUserChars)
    const assistantText = truncate(cleanText(buffer.assistant), options.captureAssistantChars)
    const summaryLength = (userText + assistantText).length
    const imageCount = buffer.images.length
    if (summaryLength >= options.captureMinChars) {
      service.queue.push(
        'capture-turn',
        () =>
          service.addTurnMemory({
            userText,
            assistantText,
            sessionId,
            cwd: buffer.cwd,
            turn: buffer.turn,
            imageCount,
          }),
        { retries: 1 },
      )
    }
    // 图片：每张单独生成概览并写入（同一轮内按 attachmentId 去重）
    const seen = new Set()
    for (const ref of buffer.images) {
      const attachmentId = String(ref?.attachmentId ?? '')
      if (!attachmentId || seen.has(attachmentId)) continue
      seen.add(attachmentId)
      service.queue.push(
        `capture-image:${attachmentId}`,
        () =>
          service.addImageMemory({
            ref,
            sessionId,
            cwd: buffer.cwd,
            turn: buffer.turn,
          }),
        { retries: 0 },
      )
    }
  }
}
