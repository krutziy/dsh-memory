/**
 * 设置页使用的 Host HTTP 接口（与 DSH Web 同源，仅本机可访问）：
 *
 *   GET  /__dsh_memory__/status              运行状态
 *   GET  /__dsh_memory__/memories?q&limit&offset&kind   记忆列表/检索
 *   GET  /__dsh_memory__/export              导出全部记忆 JSON
 *   POST /__dsh_memory__/test                测试激活 provider（可带 providerId）
 *   POST /__dsh_memory__/memories            手动新增记忆
 *   POST /__dsh_memory__/memories/delete     删除记忆 {ids:[...]}
 *   POST /__dsh_memory__/recreate            重建集合（需要 confirm:"DELETE"）
 *   POST /__dsh_memory__/maintenance         立即执行一次维护
 *   GET  /__dsh_memory__/sleep               睡眠状态 + 整理任务列表摘要
 *   POST /__dsh_memory__/sleep/run           手动触发一次睡眠整理
 *   GET  /__dsh_memory__/consolidation       整理任务列表与历史
 *   GET  /__dsh_memory__/models?providerId=  拉取某个 provider 的模型列表
 *
 * POST 请求要求自定义头 x-dsh-memory: 1，避免跨站请求伪造（跨域预检会拦下）。
 */
import { cleanText, errorText } from './util.js'

/** 读取 JSON 请求体（限制大小）。 */
function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(new Error(`请求体不是合法 JSON：${errorText(error)}`))
      }
    })
    req.on('error', reject)
  })
}

/** 统一 JSON 响应。 */
function respond(res, status, value) {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

/** 是否是带自定义头的 POST（基础 CSRF 防护）。 */
function trustedPost(req) {
  return req.method === 'POST' && req.headers['x-dsh-memory'] === '1'
}

/** 解析 URL 查询参数。 */
function parseQuery(req) {
  try {
    const url = new URL(String(req.url ?? '/'), 'http://127.0.0.1')
    return url.searchParams
  } catch {
    return new URLSearchParams()
  }
}

/**
 * @param {object} ctx DSH 插件上下文
 * @param {import('./service.js').MemoryService} service
 */
export function registerHttpRoutes(ctx, service) {
  const log = service.logger
  const statusRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/status',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        respond(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      try {
        respond(res, 200, await service.status())
      } catch (error) {
        respond(res, 500, { ok: false, error: errorText(error) })
      }
    },
  }
  const memoriesRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/memories',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          const query = parseQuery(req)
          const result = await service.listMemories({
            query: query.get('q') ?? '',
            limit: Number(query.get('limit') ?? 20),
            offset: query.get('offset') ?? null,
            kind: query.get('kind') ?? '',
            range: query.get('range') ?? '',
            level: query.get('level') ?? '',
            batch: query.get('batch') ?? '',
          })
          respond(res, 200, { ok: true, ...result })
          return
        }
        if (!trustedPost(req)) {
          respond(res, 403, { ok: false, error: 'forbidden' })
          return
        }
        const body = await readJsonBody(req)
        const text = cleanText(body?.text ?? '')
        if (!text) {
          respond(res, 400, { ok: false, error: '缺少要保存的 text' })
          return
        }
        const kind = typeof body?.kind === 'string' && body.kind.trim() ? body.kind.trim() : 'note'
        const tags = Array.isArray(body?.tags)
          ? body.tags.filter((tag) => typeof tag === 'string').slice(0, 12)
          : []
        const saved = await service.addMemory({ kind, text, meta: { tags, source: 'settings' } })
        respond(res, 200, { ok: true, item: saved })
      } catch (error) {
        respond(res, 500, { ok: false, error: errorText(error) })
      }
    },
  }
  const memoriesDeleteRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/memories/delete',
    handler: async (req, res) => {
      if (!trustedPost(req)) {
        respond(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      try {
        const body = await readJsonBody(req)
        const ids = Array.isArray(body?.ids) ? body.ids : body?.id ? [body.id] : []
        const result = await service.forget(ids)
        respond(res, 200, result)
      } catch (error) {
        respond(res, 400, { ok: false, error: errorText(error) })
      }
    },
  }
  const exportRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/export',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        respond(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      try {
        respond(res, 200, await service.exportMemories())
      } catch (error) {
        respond(res, 500, { ok: false, error: errorText(error) })
      }
    },
  }
  const testRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/test',
    handler: async (req, res) => {
      if (!trustedPost(req)) {
        respond(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      try {
        const body = await readJsonBody(req)
        respond(res, 200, await service.test(typeof body?.providerId === 'string' ? body.providerId : undefined))
      } catch (error) {
        log.warn?.(`[dsh-memory] 连接测试失败：${errorText(error)}`)
        respond(res, 500, { ok: false, error: errorText(error) })
      }
    },
  }
  const recreateRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/recreate',
    handler: async (req, res) => {
      if (!trustedPost(req)) {
        respond(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      try {
        const body = await readJsonBody(req)
        if (body?.confirm !== 'DELETE') {
          respond(res, 400, { ok: false, error: '需要 confirm: "DELETE" 才能重建集合' })
          return
        }
        const result = await service.recreateCollection()
        if (!result.ok) {
          respond(res, 500, { ok: false, error: result.error ?? '重建失败' })
          return
        }
        respond(res, 200, { ok: true, collection: result.info })
      } catch (error) {
        log.warn?.(`[dsh-memory] 重建集合失败：${errorText(error)}`)
        respond(res, 500, { ok: false, error: errorText(error) })
      }
    },
  }
  const maintenanceRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/maintenance',
    handler: async (req, res) => {
      if (!trustedPost(req)) {
        respond(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      try {
        await readJsonBody(req)
        respond(res, 200, await service.maintenance({ force: true }))
      } catch (error) {
        respond(res, 500, { ok: false, error: errorText(error) })
      }
    },
  }
  const sleepRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/sleep',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        respond(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      if (!service.sleep || !service.consolidation) {
        respond(res, 503, { ok: false, error: '睡眠整理组件未加载' })
        return
      }
      respond(res, 200, {
        ok: true,
        sleep: service.sleep.status(),
        consolidation: service.consolidation.summary(),
      })
    },
  }
  const sleepRunRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/sleep/run',
    handler: async (req, res) => {
      if (!trustedPost(req)) {
        respond(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      if (!service.sleep) {
        respond(res, 503, { ok: false, error: '睡眠整理组件未加载' })
        return
      }
      try {
        const body = await readJsonBody(req)
        if (body?.confirm === 'run') {
          respond(res, 200, service.sleep.requestManual())
          return
        }
        respond(res, 200, service.sleep.requestManual())
      } catch (error) {
        respond(res, 500, { ok: false, error: errorText(error) })
      }
    },
  }
  const consolidationRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/consolidation',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        respond(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      if (!service.consolidation) {
        respond(res, 503, { ok: false, error: '整理引擎未加载' })
        return
      }
      respond(res, 200, { ok: true, ...service.consolidation.summary() })
    },
  }
  const modelsRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/models',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        respond(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      try {
        const query = parseQuery(req)
        respond(res, 200, await service.listProviderModels(query.get('providerId') ?? ''))
      } catch (error) {
        respond(res, 500, { ok: false, error: errorText(error) })
      }
    },
  }
  const dshModelsRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/dsh-models',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        respond(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      try {
        respond(res, 200, { ok: true, ...(await service.dshCatalog()) })
      } catch (error) {
        respond(res, 500, { ok: false, error: errorText(error) })
      }
    },
  }

  const routes = [
    statusRoute,
    memoriesRoute,
    memoriesDeleteRoute,
    exportRoute,
    testRoute,
    recreateRoute,
    maintenanceRoute,
    sleepRoute,
    sleepRunRoute,
    consolidationRoute,
    modelsRoute,
    dshModelsRoute,
  ]
  return routes.map((route) => ctx.effect(() => ctx.webServer.register(route), `dsh-memory: route ${route.path}`))
}
