/**
 * Qdrant REST 客户端（只用 HTTP API，不需要额外依赖）。
 * 与 Qdrant 同机部署时默认 http://127.0.0.1:6333，无需 API Key；
 * 如需鉴权，可从 DSH 凭据库读取 api-key。
 */
import { errorText } from '../../util/index.js'

function joinUrl(base, path) {
  return `${String(base ?? '').replace(/\/+$/, '')}${path}`
}

export class QdrantClient {
  constructor(options = {}) {
    this.url = String(options.url ?? 'http://127.0.0.1:6333').replace(/\/+$/, '')
    this.apiKey = options.apiKey ? String(options.apiKey) : ''
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 8000
    this.logger = options.logger ?? console
  }

  async request(method, path, body, { timeoutMs = this.timeoutMs, signal } = {}) {
    const timeout = AbortSignal.timeout(Math.max(500, timeoutMs))
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    const headers = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (this.apiKey) headers['api-key'] = this.apiKey
    let response
    try {
      response = await fetch(joinUrl(this.url, path), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: combined,
      })
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new Error(`Qdrant 请求超时（${method} ${path}）`)
      }
      throw new Error(`无法连接 Qdrant（${this.url}）：${errorText(error)}`)
    }
    const text = await response.text()
    let payload
    try {
      payload = text === '' ? undefined : JSON.parse(text)
    } catch {
      payload = text.slice(0, 400)
    }
    if (!response.ok) {
      const detail = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {}).slice(0, 500)
      throw new Error(`Qdrant 返回 ${response.status}（${method} ${path}）：${detail}`)
    }
    return payload
  }

  /** Qdrant 版本与健康状态。 */
  async health() {
    const payload = await this.request('GET', '/', undefined, { timeoutMs: 4000 })
    return { ok: true, title: payload?.title ?? 'qdrant', version: payload?.version ?? null }
  }

  /** 集合信息；不存在返回 null。 */
  async collectionInfo(collection) {
    try {
      const payload = await this.request('GET', `/collections/${encodeURIComponent(collection)}`)
      const result = payload?.result
      if (result === undefined || result === null) return null
      const vectors = result?.config?.params?.vectors
      return {
        name: collection,
        points: result?.points_count ?? 0,
        indexed: result?.indexed_vectors_count ?? 0,
        status: result?.status ?? null,
        size: typeof vectors?.size === 'number' ? vectors.size : null,
        distance: vectors?.distance ?? null,
        payloadIndexes: Object.keys(result?.payload_schema ?? {}),
      }
    } catch (error) {
      const message = errorText(error)
      if (message.includes('404') || message.includes('Not found') || message.includes('not found')) {
        return null
      }
      throw error
    }
  }

  /** 确保集合存在且维度正确。 */
  async ensureCollection(collection, size) {
    const existing = await this.collectionInfo(collection)
    if (existing === null) {
      await this.request('PUT', `/collections/${encodeURIComponent(collection)}`, {
        vectors: { size, distance: 'Cosine' },
        on_disk_payload: true,
      })
      const info = { name: collection, points: 0, size, distance: 'Cosine', payloadIndexes: [] }
      await this.ensurePayloadIndexes(collection)
      return { ok: true, created: true, info: { ...info, payloadIndexes: ['kind', 'level', 'batch', 'ts'] } }
    }
    if (existing.size !== null && existing.size !== size) {
      return {
        ok: false,
        created: false,
        error: `集合 "${collection}" 的向量维度是 ${existing.size}，而当前激活 provider 的维度是 ${size}。请在设置页点“重建集合”，或切换到维度匹配的 provider。`,
        info: existing,
      }
    }
    await this.ensurePayloadIndexes(collection)
    return { ok: true, created: false, info: existing }
  }

  /** 确保列表/排序/过滤需要的 payload 索引存在（幂等、尽力而为）。 */
  async ensurePayloadIndexes(collection) {
    const indexes = [
      { field_name: 'kind', field_schema: 'keyword' },
      { field_name: 'level', field_schema: 'integer' },
      { field_name: 'batch', field_schema: 'keyword' },
      { field_name: 'ts', field_schema: 'integer' },
    ]
    for (const index of indexes) {
      try {
        await this.request('PUT', `/collections/${encodeURIComponent(collection)}/index`, index, {
          timeoutMs: 5000,
        })
      } catch (error) {
        this.logger?.warn?.(`[dsh-memory] 创建 Qdrant 索引 ${index.field_name} 失败：${errorText(error)}`)
      }
    }
  }

  /** 删除若干 point 上的指定 payload 字段（去会话痕迹用）。 */
  async deletePayloadKeys(collection, keys, ids) {
    const list = (ids ?? []).map(String).filter(Boolean)
    const fields = (keys ?? []).map(String).filter(Boolean)
    if (list.length === 0 || fields.length === 0) return 0
    await this.request(
      'POST',
      `/collections/${encodeURIComponent(collection)}/points/payload/delete`,
      { keys: fields, points: list, wait: true },
      { timeoutMs: 30000 },
    )
    return list.length
  }

  /** 写入/覆盖 points。 */
  async upsert(collection, points, { wait = true, signal } = {}) {
    return this.request(
      'PUT',
      `/collections/${encodeURIComponent(collection)}/points?wait=${wait ? 'true' : 'false'}`,
      { points },
      { signal },
    )
  }

  /** 向量检索。 */
  async search(collection, { vector, limit = 5, scoreThreshold, filter, withPayload = true }, { signal } = {}) {
    const body = { vector, limit, with_payload: withPayload, with_vector: false }
    if (Number.isFinite(scoreThreshold)) body.score_threshold = scoreThreshold
    if (filter !== undefined) body.filter = filter
    const payload = await this.request(
      'POST',
      `/collections/${encodeURIComponent(collection)}/points/search`,
      body,
      { signal },
    )
    return Array.isArray(payload?.result) ? payload.result : []
  }

  /** 统计 points 数量（可带过滤条件）。 */
  async count(collection, { filter, exact = false, signal } = {}) {
    const body = { exact }
    if (filter !== undefined) body.filter = filter
    const payload = await this.request(
      'POST',
      `/collections/${encodeURIComponent(collection)}/points/count`,
      body,
      { signal },
    )
    return payload?.result?.count ?? 0
  }

  /** 按时间/过滤条件滚动读取 points（游标分页）。 */
  async scroll(collection, { limit = 20, offset, orderBy, filter, withPayload = true, withVector = false } = {}) {
    const body = { limit, with_payload: withPayload, with_vector: withVector }
    if (offset !== undefined && offset !== null) body.offset = offset
    if (orderBy !== undefined) body.order_by = orderBy
    if (filter !== undefined) body.filter = filter
    const payload = await this.request(
      'POST',
      `/collections/${encodeURIComponent(collection)}/points/scroll`,
      body,
      { timeoutMs: 12000 },
    )
    const points = payload?.result?.points ?? []
    return { points, nextOffset: payload?.result?.next_page_offset ?? null }
  }

  /** 给指定 id 覆盖/合并 payload 字段（用于迁移与增强记忆到期标记）。 */
  async setPayload(collection, payload, ids, { signal } = {}) {
    return this.request(
      'POST',
      `/collections/${encodeURIComponent(collection)}/points/payload?wait=true`,
      { payload, points: ids },
      { signal },
    )
  }

  /** 删除指定 id 的 points。 */
  async deletePoints(collection, ids, { signal } = {}) {
    return this.request(
      'POST',
      `/collections/${encodeURIComponent(collection)}/points/delete?wait=true`,
      { points: ids },
      { signal },
    )
  }

  /** 按过滤条件删除 points（保留策略使用）。 */
  async deleteByFilter(collection, filter, { signal } = {}) {
    return this.request(
      'POST',
      `/collections/${encodeURIComponent(collection)}/points/delete?wait=true`,
      { filter },
      { signal },
    )
  }

  /** 删除集合。 */
  async deleteCollection(collection) {
    return this.request('DELETE', `/collections/${encodeURIComponent(collection)}`)
  }

  /** 删除并重建集合（维度变更 / 清空记忆时使用）。 */
  async recreateCollection(collection, size) {
    try {
      await this.deleteCollection(collection)
    } catch {
      /* 不存在时忽略 */
    }
    return this.ensureCollection(collection, size)
  }
}
