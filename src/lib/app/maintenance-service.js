/**
 * MaintenanceService：记忆集合的读取/维护/迁移（v0.7 R3）。
 * 负责：按层级统计、收集记忆（含向量）、批量删除/更新、增强记忆到期清理、
 * 相似检索辅助、旧记忆迁移、保留策略与定期维护。
 * 依赖注入 MemoryService 的基础设施方法（ensureReady/qdrant/storage/maintenanceOptions/stats）。
 */
import { defaultConfidence, defaultImportance } from '../domain/memory-values.js'
import { errorText } from '../util/index.js'

export class MaintenanceService {
  /** @param {import('./memory-service.js').MemoryService} service */
  constructor(service) {
    this.service = service
    this.logger = service.logger
  }

  get stats() {
    return this.service.stats
  }

  ensureReady(...args) { return this.service.ensureReady(...args) }
  qdrant() { return this.service.qdrant() }
  storage() { return this.service.storage() }
  maintenanceOptions() { return this.service.maintenanceOptions() }

  async countByLevel() {
    const counts = { 0: 0, 1: 0, 2: 0, 3: 0 }
    try {
      await this.ensureReady()
      const qdrant = await this.qdrant()
      const storage = this.storage()
      for (const level of [0, 1, 2, 3]) {
        try {
          counts[level] = await qdrant.count(storage.collection, {
            filter: { must: [{ key: 'level', match: { value: level } }] },
            exact: true,
          })
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* collection 不可用时保持 0 */
    }
    return counts
  }

  /**
   * 滚动收集符合过滤条件的记忆（含向量，供整理/事件合并使用）。
   * @returns {Promise<Array<{id:string, vector:number[]|null, payload:object}>>}
   */
  async collectMemories({ filter, withVector = false, maxItems = 2000, orderBy } = {}) {
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    const items = []
    let offset
    for (let page = 0; page < 200 && items.length < maxItems; page += 1) {
      const { points, nextOffset } = await qdrant.scroll(storage.collection, {
        limit: Math.min(256, maxItems - items.length),
        offset,
        orderBy,
        filter,
        withPayload: true,
        withVector,
      })
      for (const point of points) {
        items.push({
          id: String(point.id),
          vector: Array.isArray(point.vector) ? point.vector : (point.vector?.default ?? null),
          payload: point.payload ?? {},
        })
      }
      if (!nextOffset || points.length === 0) break
      offset = nextOffset
    }
    return items
  }

  /** 收集某一天（按配置时区）的原始记忆（level=0）。 */
  async collectRawForDay(dayStart, dayEnd, { withVector = false, maxItems = 2000 } = {}) {
    return this.collectMemories({
      filter: {
        must: [
          { key: 'level', match: { value: 0 } },
          { key: 'ts', range: { gte: dayStart, lte: dayEnd } },
        ],
      },
      withVector,
      maxItems,
      orderBy: { key: 'ts', direction: 'asc' },
    })
  }

  /** 收集某个批次产出的记忆。 */
  async collectBatchMemories(batch, { withVector = false, maxItems = 2000 } = {}) {
    return this.collectMemories({
      filter: { must: [{ key: 'batch', match: { value: String(batch) } }] },
      withVector,
      maxItems,
      orderBy: { key: 'ts', direction: 'asc' },
    })
  }

  /** 批量删除记忆（整理后清理原文）。 */
  async deleteMemoryIds(ids) {
    const list = (ids ?? []).map(String).filter(Boolean)
    if (list.length === 0) return 0
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    for (let index = 0; index < list.length; index += 200) {
      await qdrant.deletePoints(storage.collection, list.slice(index, index + 200))
    }
    return list.length
  }

  /** 批量更新记忆 payload（迁移/增强到期等）。 */
  async updateMemoryPayload(ids, payload) {
    const list = (ids ?? []).map(String).filter(Boolean)
    if (list.length === 0) return 0
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    for (let index = 0; index < list.length; index += 200) {
      await qdrant.setPayload(storage.collection, payload, list.slice(index, index + 200))
    }
    return list.length
  }

  /** 列出已到期的增强记忆 id。 */
  async listExpiredEnhanced(now = Date.now()) {
    const items = await this.collectMemories({
      filter: {
        must: [
          { key: 'enhanced', match: { value: true } },
          { key: 'expiresAt', range: { lt: now } },
        ],
      },
      withVector: false,
      maxItems: 5000,
    })
    return items.map((item) => item.id)
  }

  /** 向量相似检索（供事件合并使用）。 */
  async searchSimilar(vector, { limit = 5, threshold = 0.85, excludeIds = [] } = {}) {
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    const exclude = new Set((excludeIds ?? []).map(String))
    const points = await qdrant.search(storage.collection, {
      vector,
      limit: Math.max(limit + exclude.size, limit),
      scoreThreshold: threshold,
      withPayload: true,
    })
    return points
      .filter((point) => !exclude.has(String(point.id)))
      .slice(0, limit)
      .map((point) => ({
        id: String(point.id),
        score: Number(point.score) || 0,
        text: String(point.payload?.text ?? ''),
        kind: String(point.payload?.kind ?? ''),
        ts: Number(point.payload?.ts) || 0,
        level: Number(point.payload?.level) || 0,
        batch: point.payload?.batch ? String(point.payload.batch) : '',
        enhanced: point.payload?.enhanced === true,
      }))
  }

  /** 整理用的 LLM 客户端（provider 可单独配置，模型名覆盖）。 */

  /** 迁移：给旧记忆补 level=0 / batch=''（只对缺失 level 的记录处理一次）。 */
  async migrateLegacyMemories() {
    try {
      await this.ensureReady()
      const qdrant = await this.qdrant()
      const storage = this.storage()
      const legacy = []
      let offset
      for (let page = 0; page < 100; page += 1) {
        const { points, nextOffset } = await qdrant.scroll(storage.collection, {
          limit: 256,
          offset,
          withPayload: true,
          withVector: false,
        })
        for (const point of points) {
          if (point.payload === undefined || point.payload?.level === undefined) legacy.push(String(point.id))
        }
        if (!nextOffset || points.length === 0) break
        offset = nextOffset
      }
      if (legacy.length > 0) {
        await this.updateMemoryPayload(legacy, { level: 0, batch: '' })
        this.logger.info?.(`[dsh-memory] 已为 ${legacy.length} 条旧记忆补齐整理标签`)
      }
      return legacy.length
    } catch (error) {
      this.logger.warn?.(`[dsh-memory] 旧记忆迁移失败：${errorText(error)}`)
      return 0
    }
  }

  /**
   * v0.8 迁移：把 payload.batch 里“不再对应活跃批次”的旧编号清空。
   * 编号只在待整理期间存在；终态批次的记忆不应再带编号。
   */
  async migrateQueueBatchFields(activeNos) {
    try {
      const active = activeNos instanceof Set ? activeNos : new Set(activeNos ?? [])
      await this.ensureReady()
      const qdrant = await this.qdrant()
      const storage = this.storage()
      const stale = []
      const legacyFields = []
      let offset
      for (let page = 0; page < 100; page += 1) {
        const { points, nextOffset } = await qdrant.scroll(storage.collection, {
          limit: 256,
          offset,
          withPayload: true,
          withVector: false,
        })
        for (const point of points) {
          const payload = point.payload ?? {}
          const batch = String(payload.batch ?? '')
          if (batch && !active.has(batch)) stale.push(String(point.id))
          if (payload.sessionId !== undefined || payload.cwd !== undefined) legacyFields.push(String(point.id))
        }
        if (!nextOffset || points.length === 0) break
        offset = nextOffset
      }
      if (stale.length > 0) {
        for (let index = 0; index < stale.length; index += 200) {
          await qdrant.setPayload(storage.collection, { batch: '' }, stale.slice(index, index + 200))
        }
        this.logger.info?.(`[dsh-memory] 已清理 ${stale.length} 条旧记忆的过期批次编号`)
      }
      if (legacyFields.length > 0 && typeof qdrant.deletePayloadKeys === 'function') {
        for (let index = 0; index < legacyFields.length; index += 200) {
          await qdrant.deletePayloadKeys(storage.collection, ['sessionId', 'cwd'], legacyFields.slice(index, index + 200))
        }
        this.logger.info?.(`[dsh-memory] 已从 ${legacyFields.length} 条旧记忆移除 sessionId/cwd`)
      }
      return stale.length + legacyFields.length
    } catch (error) {
      this.logger.warn?.(`[dsh-memory] 批次编号迁移失败：${errorText(error)}`)
      return 0
    }
  }

  /** 给 v0.6 旧记忆补齐动态召回字段（anchorTs/importance/confidence/accessEvents/exposureCount）。 */
  async migrateDynamicFields() {
    try {
      await this.ensureReady()
      const qdrant = await this.qdrant()
      const storage = this.storage()
      const patches = []
      let offset
      for (let page = 0; page < 100; page += 1) {
        const { points, nextOffset } = await qdrant.scroll(storage.collection, {
          limit: 256,
          offset,
          withPayload: true,
          withVector: false,
        })
        for (const point of points) {
          const payload = point.payload ?? {}
          if (payload.anchorTs !== undefined && payload.importance !== undefined && payload.confidence !== undefined) continue
          const kind = payload.kind ?? 'note'
          patches.push({
            id: String(point.id),
            payload: {
              anchorTs: Number(payload.dayRange?.from) || Number(payload.ts) || Date.now(),
              importance: defaultImportance(kind),
              confidence: defaultConfidence(kind),
              accessEvents: Array.isArray(payload.accessEvents) ? payload.accessEvents : [],
              exposureCount: Number(payload.exposureCount) || 0,
              lastAccessAt: Number(payload.lastAccessAt) || 0,
              lastExposedAt: Number(payload.lastExposedAt) || 0,
              needsReview: payload.needsReview === true,
            },
          })
        }
        if (!nextOffset || points.length === 0) break
        offset = nextOffset
      }
      for (const patch of patches) {
        await qdrant.setPayload(storage.collection, patch.payload, [patch.id])
      }
      if (patches.length > 0) this.logger.info?.(`[dsh-memory] 已为 ${patches.length} 条旧记忆补齐动态召回字段`)
      return patches.length
    } catch (error) {
      this.logger.warn?.(`[dsh-memory] 动态召回字段迁移失败：${errorText(error)}`)
      return 0
    }
  }

  // ------------------------------------------------------------------
  // 定期维护
  // ------------------------------------------------------------------

  /**
   * 定期维护：过期清理 → 超限淘汰 → 相似重复合并 → 索引重建。
   * @returns {Promise<object>} 维护结果
   */
  async maintenance({ force = false } = {}) {
    const options = this.maintenanceOptions()
    const info = await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    const result = {
      ok: true,
      startedAt: Date.now(),
      collection: storage.collection,
      pointsBefore: info?.points ?? null,
      expired: 0,
      overflow: 0,
      duplicates: 0,
      errors: [],
    }
    try {
      // 1) 过期清理
      if (options.retentionDays > 0 || force) {
        const cutoff = Date.now() - options.retentionDays * 86400000
        if (options.retentionDays > 0) {
          const before = await qdrant.count(storage.collection, { exact: true })
          await qdrant.deleteByFilter(storage.collection, {
            must: [{ key: 'ts', range: { lt: cutoff } }],
          })
          const after = await qdrant.count(storage.collection, { exact: true })
          result.expired = Math.max(0, before - after)
        }
      }
      // 2) 条数上限淘汰（从最旧开始）
      if (options.maxMemories > 0) {
        let count = await qdrant.count(storage.collection, { exact: true })
        let guard = 0
        while (count > options.maxMemories && guard < 100) {
          guard += 1
          const excess = count - options.maxMemories
          const { points } = await qdrant.scroll(storage.collection, {
            limit: Math.min(256, excess),
            orderBy: { key: 'ts', direction: 'asc' },
          })
          if (points.length === 0) break
          const ids = points.map((point) => String(point.id))
          await qdrant.deletePoints(storage.collection, ids)
          result.overflow += ids.length
          count -= ids.length
        }
      }
      // 3) 相似重复合并（只扫描最近的 N 条）
      if (options.maintenanceDedupe) {
        const { points } = await qdrant.scroll(storage.collection, {
          limit: options.dedupeMaxScan,
          orderBy: { key: 'ts', direction: 'desc' },
          withPayload: true,
          withVector: true,
        })
        const deleted = new Set()
        const byId = new Map(points.map((point) => [String(point.id), point]))
        for (const point of points) {
          const id = String(point.id)
          if (deleted.has(id)) continue
          const vector = Array.isArray(point.vector) ? point.vector : point.vector?.default ?? null
          if (!Array.isArray(vector)) continue
          let similar = []
          try {
            similar = await qdrant.search(storage.collection, {
              vector,
              limit: 5,
              scoreThreshold: options.dedupeThreshold,
            })
          } catch (error) {
            result.errors.push(`dedupe search: ${errorText(error)}`)
            break
          }
          for (const candidate of similar) {
            const candidateId = String(candidate.id)
            if (candidateId === id || deleted.has(candidateId)) continue
            const other = byId.get(candidateId)
            const otherTs = Number(other?.payload?.ts) || Number(candidate?.payload?.ts) || 0
            const selfTs = Number(point?.payload?.ts) || 0
            const olderId = otherTs < selfTs ? candidateId : id
            const keepId = olderId === candidateId ? id : candidateId
            if (olderId === id) {
              // 自己更旧：删自己，跳出（也把 candidate 标记为已处理）
              deleted.add(id)
              try {
                await qdrant.deletePoints(storage.collection, [id])
                result.duplicates += 1
              } catch (error) {
                result.errors.push(`dedupe delete: ${errorText(error)}`)
              }
              break
            }
            deleted.add(candidateId)
            try {
              await qdrant.deletePoints(storage.collection, [candidateId])
              result.duplicates += 1
            } catch (error) {
              result.errors.push(`dedupe delete: ${errorText(error)}`)
            }
            void keepId
          }
        }
      }
      // 4) 索引重建（幂等）
      await qdrant.ensurePayloadIndexes(storage.collection)
    } catch (error) {
      result.ok = false
      result.errors.push(errorText(error))
    }
    result.finishedAt = Date.now()
    result.durationMs = result.finishedAt - result.startedAt
    this.stats.lastMaintenanceAt = result.finishedAt
    this.stats.lastMaintenance = result
    if (options.debug || result.errors.length > 0) {
      this.logger.info?.(
        `[dsh-memory] 维护完成：过期 ${result.expired}，超限 ${result.overflow}，重复 ${result.duplicates}，错误 ${result.errors.length}`,
      )
    }
    return result
  }

  // ------------------------------------------------------------------
  // 状态 / 测试
  // ------------------------------------------------------------------

  /** 设置页状态快照。 */
}
