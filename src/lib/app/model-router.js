/**
 * ModelRouter：provider / 凭据 / 模型路由（v0.7 R3）。
 *
 * 负责：
 * - 多 provider 档案解析与凭据读取；
 * - 嵌入/视觉客户端构造；
 * - DSH 模型目录读取（ctx.llm）与对话调用；
 * - 功能模型来源路由（整理：DSH / 自定义；图片概览：DSH / 自定义）。
 *
 * 依赖注入：构造时传入 MemoryService（读取 cfg/logger/ctx），不反向依赖 service 的其他业务方法。
 */
import { OpenAICompatClient } from '../adapters/openai/client.js'
import { asBool, clampInt, errorText, normalizeUrl, providerIdToEnv } from '../util/index.js'

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

export class ModelRouter {
  /** @param {import('./memory-service.js').MemoryService} service */
  constructor(service) {
    this.service = service
    this.ctx = service.ctx
    this.logger = service.logger
  }

  /** 当前配置（解包 volatile）。 */
  cfg() {
    return this.service.cfg()
  }

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

  /** DSH 已配置的 LLM provider 列表（合并可配置目录与当前 live 路由）。 */
  async dshProviders() {
    let configurable = []
    let live = []
    try {
      configurable = await this.ctx.llm.listConfigurableProviders()
    } catch { /* ignore */ }
    try {
      live = await this.ctx.llm.listProviders()
    } catch { /* ignore */ }
    const providers = []
    const seen = new Set()
    for (const entry of configurable ?? []) {
      const id = String(entry?.provider ?? '').trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      providers.push({
        id,
        name: String(entry?.displayName ?? id),
        settingsNs: String(entry?.settingsNs ?? ''),
        declared: entry?.declared === true,
        live: (live ?? []).some((item) => item.id === id),
      })
    }
    for (const entry of live ?? []) {
      const id = String(entry?.id ?? '').trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      providers.push({ id, name: String(entry?.name ?? id), settingsNs: '', declared: false, live: true })
    }
    return providers
  }

  /** DSH 模型目录：providers + 每个 live provider 的模型 + 当前默认模型。 */
  async dshCatalog() {
    const providers = await this.dshProviders()
    const models = {}
    for (const provider of providers) {
      if (!provider.live) continue
      try {
        models[provider.id] = (await this.ctx.llm.listModels(provider.id)).map((item) => ({
          id: String(item?.id ?? ''),
          name: String(item?.name ?? item?.id ?? ''),
          inputModalities: Array.isArray(item?.inputModalities) ? item.inputModalities.map(String) : [],
        }))
      } catch (error) {
        models[provider.id] = []
      }
    }
    let defaultModel = null
    try {
      const selection = this.ctx.agentDefaultModel?.currentSelection?.()
      defaultModel = selection ? { provider: selection.provider, model: selection.model } : null
    } catch { /* ignore */ }
    return { providers, models, defaultModel }
  }

  /** 当前 DSH 默认模型选择（provider/model）。 */
  dshDefaultSelection() {
    try {
      const selection = this.ctx.agentDefaultModel?.currentSelection?.()
      if (selection?.provider && selection?.model) return { provider: String(selection.provider), model: String(selection.model) }
    } catch { /* ignore */ }
    return null
  }

  /** 功能模型目标：优先读配置，留空回退 DSH 默认模型。 */
  dshTarget(provider, model, fallbackSelection = this.dshDefaultSelection()) {
    const providerId = String(provider ?? '').trim() || String(fallbackSelection?.provider ?? '')
    const modelId = String(model ?? '').trim() || String(fallbackSelection?.model ?? '')
    return { providerId, modelId }
  }

  /** 通过 DSH LLM 服务调用一次对话补全（流式聚合为文本）。 */
  async dshChat({ provider, model, system, messages, maxTokens = 1024, temperature = 0.3, reasoningEffort = 'off', signal }) {
    if (!this.ctx.llm || typeof this.ctx.llm.stream !== 'function') {
      throw new Error('DSH LLM 服务不可用')
    }
    const target = this.dshTarget(provider, model)
    if (!target.providerId || !target.modelId) throw new Error('尚未选择 DSH 模型')
    const startedAt = Date.now()
    const parts = []
    let usage = null
    let finish = null
    const requestMessages = (messages ?? []).map((message) => ({
      role: message.role,
      content:
        typeof message.content === 'string'
          ? [{ type: 'text', text: message.content }]
          : (message.content ?? []).map((block) =>
              typeof block === 'string' ? { type: 'text', text: block } : block,
            ),
    }))
    const stream = this.ctx.llm.stream({
      provider: target.providerId,
      model: target.modelId,
      system,
      messages: requestMessages,
      maxTokens,
      temperature,
      reasoningEffort,
      signal,
    })
    for await (const chunk of stream) {
      if (!chunk) continue
      if (chunk.type === 'text-delta') parts.push(chunk.text ?? '')
      else if (chunk.type === 'block-end' && chunk.block?.type === 'text') parts.push(chunk.block.text ?? '')
      else if (chunk.type === 'usage') usage = chunk.usage ?? null
      else if (chunk.type === 'finish') finish = chunk.reason ?? null
    }
    if (finish?.kind === 'error' || finish?.kind === 'aborted') {
      const failure = finish.failure
      throw new Error(`DSH 模型调用失败：${failure?.message ?? failure?.code ?? finish.kind}`)
    }
    const text = parts.join('').trim()
    if (!text) throw new Error('DSH 模型返回为空')
    return {
      text,
      latencyMs: Date.now() - startedAt,
      usage,
      provider: target.providerId,
      model: target.modelId,
      source: 'dsh',
    }
  }

  /** 通过 DSH LLM 服务做图片概览（图片以 attachment block 传入）。 */
  async dshCaption({ provider, model, ref, prompt, maxTokens = 300, signal }) {
    if (!ref) throw new Error('缺少图片附件引用')
    return this.dshChat({
      provider,
      model,
      maxTokens,
      temperature: 0.2,
      reasoningEffort: 'off',
      signal,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image', attachment: ref },
          ],
        },
      ],
    })
  }

  /** 整理/摘要调用：DSH 模型或插件自定义 provider 二选一。 */
  async consolidationChat({ system, messages = [], maxTokens = 1024, temperature = 0.3, signal }) {
    const cfg = this.cfg()
    const source = cfg.consolidationSource === 'custom' ? 'custom' : 'dsh'
    if (source === 'dsh') {
      const target = this.dshTarget(cfg.consolidationDshProvider, cfg.consolidationDshModel)
      if (target.providerId && target.modelId) {
        return this.dshChat({
          provider: target.providerId,
          model: target.modelId,
          system,
          messages,
          maxTokens,
          temperature,
          reasoningEffort: 'off',
          signal,
        })
      }
      throw new Error('DSH 默认模型不可用（请在 DSH 设置 → 模型 中配置）')
    }
    const llm = await this.consolidationClient()
    if (!llm) throw new Error('未配置自定义整理模型')
    const response = await llm.client.chat({ model: llm.model, messages, maxTokens, temperature, signal })
    return {
      text: response.text,
      latencyMs: response.latencyMs,
      usage: response.usage,
      provider: llm.provider.id,
      model: llm.model,
      source: 'custom',
    }
  }

  /** 图片概览的目标 provider / 模型（支持在“模型列表”里单独指定）。 */
  captionTarget() {
    const cfg = this.cfg()
    const provider =
      (cfg.captionProviderId && this.providerById(cfg.captionProviderId)) || this.activeProvider()
    const vision = this.visionConfigOf(provider)
    const model = String(cfg.captionModel ?? '').trim() || vision.model
    return { provider, vision, model }
  }

  /** 拉取 provider 的模型列表（供设置页“模型列表”使用）。 */
  async listProviderModels(providerId) {
    const provider =
      (providerId && this.providerById(providerId)) || this.activeProvider()
    const client = await this.clientFor(provider)
    const models = await client.listModels()
    return {
      ok: true,
      provider: { id: provider.id, name: provider.name, baseUrl: provider.baseUrl },
      models,
    }
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

  async consolidationClient() {
    const cfg = this.cfg()
    const provider =
      (cfg.consolidationProviderId && this.providerById(cfg.consolidationProviderId)) || this.activeProvider()
    const model = String(cfg.consolidationModel ?? '').trim()
    if (!model) return null
    const client = await this.clientFor(provider)
    return { client, provider, model }
  }
}
