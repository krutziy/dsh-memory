/**
 * OpenAI 兼容的云端 API 客户端：
 * - POST {baseUrl}/embeddings        文本嵌入（OpenAI / SiliconFlow / DashScope 兼容模式 / 智谱 / 火山方舟 / Jina … 均兼容）
 * - POST {visionBaseUrl}/chat/completions  视觉对话（用于图片一句话概览），图片以 data URI 发送
 *
 * 不绑定任何特定厂商：Base URL、模型、维度、Key 均由 provider 档案提供。
 */
import { errorText } from '../../util/index.js'

/** 组合外部取消信号与超时。 */
function combineSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(Math.max(1000, timeoutMs))
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout])
}

/** 读取错误响应体并给出可读摘要。 */
async function failure(response, label) {
  let detail = ''
  try {
    const text = await response.text()
    detail = text.slice(0, 600)
  } catch {
    /* ignore */
  }
  return `${label} API 返回 ${response.status}${detail ? `：${detail}` : ''}`
}

/** 从 chat completions 的 content（字符串或分段数组）里取文本。 */
function contentText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && part.type === 'text' && typeof part.text === 'string') return part.text
        return ''
      })
      .join('')
  }
  return ''
}

/** 默认图片概览提示词。 */
export const DEFAULT_CAPTION_PROMPT =
  '用一句中文概括这张图片的关键内容（不超过 30 个字），供未来检索记忆使用。只输出这句话本身，不要解释。'

/** 一个 provider 的 OpenAI 兼容客户端。 */
export class OpenAICompatClient {
  /**
   * @param {object} options
   * @param {string} options.label provider 显示名（用于错误信息）
   * @param {string} options.baseUrl 嵌入接口 Base URL
   * @param {string} options.apiKey 嵌入接口 Key
   * @param {string} options.embedModel 嵌入模型
   * @param {number} options.dimensions 期望向量维度
   * @param {boolean} [options.sendDimensions] 是否发送 dimensions 参数
   * @param {string} [options.visionModel] 视觉模型（空=不可用）
   * @param {string} [options.visionBaseUrl] 视觉接口 Base URL（空=同 baseUrl）
   * @param {string} [options.visionApiKey] 视觉接口 Key（空=同 apiKey）
   * @param {object} [options.logger]
   */
  constructor(options) {
    this.label = String(options.label ?? '云端')
    this.baseUrl = String(options.baseUrl ?? '').replace(/\/+$/, '')
    this.apiKey = String(options.apiKey ?? '')
    this.embedModel = String(options.embedModel ?? '')
    this.dimensions = Number(options.dimensions)
    this.sendDimensions = options.sendDimensions !== false
    this.visionModel = String(options.visionModel ?? '')
    this.visionBaseUrl = String(options.visionBaseUrl ?? '').replace(/\/+$/, '') || this.baseUrl
    this.visionApiKey = String(options.visionApiKey ?? '') || this.apiKey
    this.logger = options.logger ?? console
  }

  /** 嵌入接口是否已配置完整。 */
  get embeddingConfigured() {
    return this.baseUrl !== '' && this.apiKey !== '' && this.embedModel !== ''
  }

  /** 视觉概览是否可用。 */
  get captionConfigured() {
    return this.visionModel !== '' && this.visionBaseUrl !== '' && this.visionApiKey !== ''
  }

  async #post(url, apiKey, body, { signal, timeoutMs = 20000 } = {}) {
    let response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: combineSignal(signal, timeoutMs),
      })
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new Error(`${this.label} 请求超时（${url}）`)
      }
      throw new Error(`无法连接 ${this.label} API：${errorText(error)}`)
    }
    if (!response.ok) throw new Error(await failure(response, this.label))
    try {
      return await response.json()
    } catch (error) {
      throw new Error(`${this.label} API 返回了非 JSON 响应：${errorText(error)}`)
    }
  }

  /** 校验嵌入响应并返回向量。 */
  #vectorOf(payload) {
    const embedding = payload?.data?.[0]?.embedding
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error(`${this.label} 嵌入响应缺少向量：${JSON.stringify(payload).slice(0, 300)}`)
    }
    if (Number.isFinite(this.dimensions) && this.dimensions > 0 && embedding.length !== this.dimensions) {
      throw new Error(
        `嵌入维度不一致：provider 配置 ${this.dimensions}，服务返回 ${embedding.length}。请修改 provider 的维度配置，或调整 Qdrant 集合维度。`,
      )
    }
    return embedding
  }

  /** 拉取该 provider 的模型列表（GET /models，OpenAI 兼容）。 */
  async listModels({ signal, timeoutMs = 15000 } = {}) {
    if (!this.baseUrl) throw new Error(`${this.label} 未配置 Base URL`)
    const url = `${this.baseUrl}/models`
    let response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' },
        signal: combineSignal(signal, timeoutMs),
      })
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new Error(`${this.label} 请求超时（${url}）`)
      }
      throw new Error(`无法连接 ${this.label} API：${errorText(error)}`)
    }
    if (!response.ok) throw new Error(await failure(response, this.label))
    const payload = await response.json().catch(() => null)
    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : []
    return rows
      .map((row) => ({
        id: String(row?.id ?? row?.name ?? '').trim(),
        ownedBy: row?.owned_by ? String(row.owned_by) : '',
        created: Number(row?.created) || 0,
      }))
      .filter((row) => row.id)
  }

  /** 文本嵌入。 */
  async embedText(text, { signal, timeoutMs = 15000 } = {}) {
    if (!this.embeddingConfigured) {
      throw new Error(`${this.label} 的嵌入配置不完整（Base URL / Key / 模型）`)
    }
    const startedAt = Date.now()
    const body = { model: this.embedModel, input: String(text ?? ''), encoding_format: 'float' }
    if (this.sendDimensions && Number.isFinite(this.dimensions) && this.dimensions > 0) {
      body.dimensions = this.dimensions
    }
    const payload = await this.#post(`${this.baseUrl}/embeddings`, this.apiKey, body, { signal, timeoutMs })
    return {
      vector: this.#vectorOf(payload),
      usage: payload?.usage ?? null,
      latencyMs: Date.now() - startedAt,
    }
  }

  /**
   * 通用对话补全（用于记忆整理/摘要）。
   * @param {object} options
   * @param {Array<{role:string,content:string}>} options.messages
   * @param {string} [options.model] 覆盖默认模型（整理模型）
   * @param {number} [options.maxTokens]
   * @param {number} [options.temperature]
   */
  async chat({ messages, model, maxTokens = 1024, temperature = 0.3, signal, timeoutMs = 120000 }) {
    const chatModel = String(model ?? this.visionModel ?? '').trim()
    if (!chatModel) throw new Error(`${this.label} 未配置整理/对话模型`)
    if (!this.baseUrl || !this.apiKey) throw new Error(`${this.label} 的接口配置不完整`)
    const startedAt = Date.now()
    const body = {
      model: chatModel,
      messages,
      max_tokens: Math.max(16, Math.min(8192, Number(maxTokens) || 1024)),
      temperature,
      stream: false,
    }
    const payload = await this.#post(`${this.baseUrl}/chat/completions`, this.apiKey, body, { signal, timeoutMs })
    return {
      text: contentText(payload?.choices?.[0]?.message?.content).trim(),
      usage: payload?.usage ?? null,
      latencyMs: Date.now() - startedAt,
      model: chatModel,
    }
  }

  /** 用视觉对话模型给图片生成一句话概览。 */
  async captionImage(dataUri, { signal, timeoutMs = 60000, prompt, maxTokens = 96 } = {}) {
    if (!this.captionConfigured) {
      throw new Error(`${this.label} 未配置可用的视觉模型（visionModel）`)
    }
    const startedAt = Date.now()
    const body = {
      model: this.visionModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt || DEFAULT_CAPTION_PROMPT },
            { type: 'image_url', image_url: { url: dataUri } },
          ],
        },
      ],
      max_tokens: Math.max(16, Math.min(1024, Number(maxTokens) || 96)),
      temperature: 0.2,
    }
    const payload = await this.#post(`${this.visionBaseUrl}/chat/completions`, this.visionApiKey, body, {
      signal,
      timeoutMs,
    })
    return {
      text: contentText(payload?.choices?.[0]?.message?.content).trim(),
      usage: payload?.usage ?? null,
      latencyMs: Date.now() - startedAt,
    }
  }
}
