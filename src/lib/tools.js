/**
 * 提供给模型的长期记忆工具：
 * - memory_search：检索长期记忆
 * - memory_save：主动保存一条值得长期记住的事实
 * - memory_forget：删除一条记忆
 *
 * 使用原始 ctx.tools.register（不依赖 DSH 内部工具包），参数 schema 只使用
 * DSH 支持的 JSON Schema 子集：type/oneOf/properties/required/items/enum/const。
 */
import { cleanText, errorText } from './util.js'

/** 统一的文本型工具输出渲染。 */
function renderText(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function assertEnabled(service) {
  const options = service.toolOptions()
  if (!options.toolsEnabled) {
    throw new Error('长期记忆工具已被禁用（可在 Settings → 长期记忆 → 记忆行为 中开启）')
  }
  return options
}

/** 按记忆范围构造检索上下文。 */
function scopeFor(service, agentId) {
  const recall = service.recallOptions()
  const context = service.sessionContext(agentId)
  return {
    mode: recall.memoryScope,
    sessionId: context.sessionId,
    cwd: context.cwd,
    // 工具是模型主动查询，允许包含当前会话
    includeCurrentSession: true,
  }
}

function searchTool(service) {
  return {
    name: 'memory_search',
    description:
      '检索长期记忆库（跨会话保存的历史对话要点、事实、偏好、图片概览）。当需要回忆用户以前说过的事、做过的事、偏好或项目背景时使用。不要在没检索的情况下编造过去的记忆。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: '要检索的内容或问题，使用自然语言；越具体越好。',
        },
        limit: {
          type: 'integer',
          description: '返回条数（1-20）。',
        },
      },
      required: ['query'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer' },
          scope: { type: 'string' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                text: { type: 'string' },
                kind: { type: 'string' },
                time: { type: 'string' },
                score: { type: 'number' },
                sessionId: { type: 'string' },
                cwd: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
              },
              required: ['id', 'text', 'kind', 'time', 'score'],
            },
          },
        },
        required: ['count', 'results'],
      },
      render: renderText,
    },
    async execute(args, exec) {
      const options = assertEnabled(service)
      const query = typeof args?.query === 'string' ? cleanText(args.query) : ''
      if (!query) throw new Error('memory_search: 需要提供非空的 query 参数')
      const limit = Number.isInteger(args?.limit)
        ? Math.min(20, Math.max(1, args.limit))
        : options.searchLimit
      const scope = scopeFor(service, exec?.agent?.id)
      const { hits } = await service.search(query, {
        limit,
        signal: exec?.signal,
        ...scope,
      })
      return {
        count: hits.length,
        scope: `${options.toolsEnabled ? '' : ''}${scope.mode}`,
        results: hits.map((hit) => ({
          id: hit.id,
          text: hit.text,
          kind: hit.kind,
          time: hit.time,
          score: Number(hit.score.toFixed(4)),
          sessionId: hit.sessionId,
          cwd: hit.cwd,
          tags: hit.tags,
        })),
      }
    },
  }
}

function saveTool(service) {
  return {
    name: 'memory_save',
    description:
      '把一条值得长期记住的信息保存进长期记忆库（用户偏好、身份、项目背景、重要决定、常用路径/命令、约定等）。写一条自包含的事实，不要用“他/它/这个”等指代；不要保存密码、密钥等敏感凭据。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        content: {
          type: 'string',
          description: '要记住的内容，一条一个事实，简洁、自包含。',
        },
        kind: {
          type: 'string',
          enum: ['fact', 'preference', 'project', 'note'],
          description: '记忆类型：fact=事实、preference=偏好、project=项目背景、note=其他备注。',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '可选标签，便于以后检索。',
        },
      },
      required: ['content'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          id: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['ok', 'id'],
      },
      render: renderText,
    },
    async execute(args, exec) {
      assertEnabled(service)
      const content = typeof args?.content === 'string' ? cleanText(args.content) : ''
      if (!content) throw new Error('memory_save: 需要提供非空的 content 参数')
      if (content.length > 4000) throw new Error('memory_save: content 过长（最多 4000 字）')
      const kind = typeof args?.kind === 'string' ? args.kind : 'fact'
      const tags = Array.isArray(args?.tags)
        ? args.tags.filter((tag) => typeof tag === 'string').slice(0, 12)
        : []
      const context = service.sessionContext(exec?.agent?.id)
      const saved = await service.addMemory({
        kind,
        text: content,
        meta: {
          tags,
          source: 'memory_save',
          sessionId: context.sessionId,
          cwd: context.cwd,
        },
        signal: exec?.signal,
      })
      return { ok: true, id: saved.id, text: saved.text }
    },
  }
}

function forgetTool(service) {
  return {
    name: 'memory_forget',
    description:
      '从长期记忆库中删除一条记忆。先用 memory_search 找到要删除的记忆 id，再调用本工具；不要猜测 id。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: {
          type: 'string',
          description: '要删除的记忆 id（来自 memory_search 的结果）。',
        },
      },
      required: ['id'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          deleted: { type: 'integer' },
        },
        required: ['ok', 'deleted'],
      },
      render: renderText,
    },
    async execute(args) {
      assertEnabled(service)
      const id = typeof args?.id === 'string' ? args.id.trim() : ''
      if (!id) throw new Error('memory_forget: 需要提供 id 参数（来自 memory_search 结果）')
      try {
        return await service.forget([id])
      } catch (error) {
        throw new Error(`memory_forget 失败：${errorText(error)}`)
      }
    },
  }
}

/** 注册全部记忆工具；返回 dispose 函数数组。 */
export function registerMemoryTools(service) {
  const ctx = service.ctx
  const tools = [searchTool(service), saveTool(service), forgetTool(service)]
  return tools.map((tool) =>
    ctx.effect(() => ctx.tools.register(tool), `dsh-memory: tool ${tool.name}`),
  )
}
