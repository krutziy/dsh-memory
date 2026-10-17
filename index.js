// ⚠️ 本文件由 build.mjs 从 src/ 生成，请修改 src/ 下的源码后重新构建。
// 生成命令：node build.mjs

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

// ===== src/lib/schemastery.js =====
/**
 * 加载 DSH 自带的 @deepseek-ai/schemastery。
 *
 * 背景：本插件是「本地目录 + pnpm file: 链接」安装的，Node 会按插件真实路径
 * （/home/ubuntu/mem/dsh-memory）解析 import，看不到 profile 或 dsh 安装目录里的
 * @deepseek-ai/schemastery。这里用同步 require + 候选路径解析，按顺序尝试：
 *   1. 常规解析 @deepseek-ai/schemastery（tarball/真实安装时可用）
 *   2. $DSH_PROFILE_DIR/node_modules/@deepseek-ai/schemastery
 *   3. 从 process.argv[1] 逐级向上找 node_modules/@deepseek-ai/schemastery
 *
 * 只依赖 DSH 已随附的包版本，不引入额外第三方依赖。
 */




const require = createRequire(import.meta.url)

/** 收集可能的 schemastery 包目录（绝对路径）。 */
function candidateDirs() {
  const dirs = []
  const profileDir = process.env.DSH_PROFILE_DIR
  if (profileDir) dirs.push(join(profileDir, 'node_modules', '@deepseek-ai', 'schemastery'))

  const entry = process.argv[1]
  if (entry) {
    let dir = dirname(entry)
    for (let level = 0; level < 10; level += 1) {
      dirs.push(join(dir, '@deepseek-ai', 'schemastery'))
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return dirs
}

/** 依次尝试加载 schemastery，返回它的默认导出（z）。 */
function loadSchemastery() {
  const errors = []
  const attempts = [() => require('@deepseek-ai/schemastery')]
  for (const dir of candidateDirs()) {
    if (!existsSync(dir)) continue
    attempts.push(() => require(dir))
  }
  for (const attempt of attempts) {
    try {
      const loaded = attempt()
      const z = loaded?.default ?? loaded
      if (typeof z === 'function' && typeof z.object === 'function') return z
      errors.push(new Error('loaded module is not schemastery'))
    } catch (error) {
      errors.push(error)
    }
  }
  throw new Error(
    `dsh-memory: 无法加载 DSH 自带的 @deepseek-ai/schemastery（${errors
      .map((error) => error?.code ?? error?.message ?? String(error))
      .join('; ')}）`,
  )
}

/** schemastery 的默认导出（z）。 */
const z = loadSchemastery()
// ===== src/lib/util.js =====
/**
 * 通用小工具：配置解包、截断、哈希、UUID、data URI、超时。
 */


/** 配置字段可能是 volatile 包装（Ref），统一解包。 */
function val(value) {
  if (value && typeof value.get === 'function') return value.get()
  return value
}

/** 把 @deepseek-ai/schemastery 的 Config 实例解包成普通对象。 */
function readConfig(config) {
  const out = {}
  if (config === null || typeof config !== 'object') return out
  for (const key of Object.keys(config)) out[key] = val(config[key])
  return out
}

/** 读取配置值，undefined/null 时回退。 */
function cfgValue(config, key, fallback) {
  const v = val(config?.[key])
  return v === undefined || v === null ? fallback : v
}

/** 去掉 URL 末尾斜杠。 */
function normalizeUrl(url) {
  const text = String(url ?? '').trim()
  return text.replace(/\/+$/, '')
}

/** 去掉首尾空白并压缩多余空白，保留换行。 */
function cleanText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 截断到 max 个字符（max<=0 视为不截断）。 */
function truncate(text, max) {
  const value = String(text ?? '')
  if (!max || max <= 0 || value.length <= max) return value
  return value.slice(0, Math.max(0, max - 1)).trimEnd() + '…'
}

/** 计算 sha256 十六进制摘要。 */
function sha256(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex')
}

/** 由种子生成稳定的 UUID（Qdrant point id 需要 UUID 或整数）。 */
function memoryPointId(seed) {
  const h = sha256(seed)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** Uint8Array → data URI（硅基流动图片输入要求 data URI 或可访问 URL）。 */
function toDataUri(bytes, mediaType) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  return `data:${mediaType || 'image/png'};base64,${buffer.toString('base64')}`
}

/** 本地时间字符串，形如 2026-10-17 11:22。 */
function formatTime(ts) {
  const value = typeof ts === 'number' && Number.isFinite(ts) ? ts : Date.now()
  const d = new Date(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 把任意错误转成可读文本。 */
function errorText(error) {
  if (error === null || error === undefined) return ''
  if (error instanceof Error) return error.message || String(error)
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/** 常见密钥/令牌模式；命中后替换为 [已脱敏]。 */
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{10,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}\b/gi,
  /((?:api[_ -]?key|access[_ -]?token|secret|password|passwd|pwd)\s*[:=：]\s*)([^\s,，。;；]{6,})/gi,
]

/** 把文本里明显的密钥/令牌/密码替换为 [已脱敏]，避免记忆库保存敏感凭据。 */
function redactSecrets(text) {
  let out = String(text ?? '')
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, prefix) => (typeof prefix === 'string' && prefix !== '' ? prefix + '[已脱敏]' : '[已脱敏]'))
  }
  return out
}

/** 简单并发安全队列：串行执行，失败只记录不打断后续任务。 */
class SerialQueue {
  #logger
  #tasks = []
  #running = false
  #lastError = null
  #lastErrorAt = 0
  #done = 0
  #failed = 0

  constructor(logger) {
    this.#logger = logger ?? console
  }

  /** 待处理任务数（含正在执行的一个）。 */
  get pending() {
    return this.#tasks.length + (this.#running ? 1 : 0)
  }

  /** 已完成任务数。 */
  get done() {
    return this.#done
  }

  /** 失败任务数。 */
  get failed() {
    return this.#failed
  }

  /** 最近一次失败。 */
  get lastError() {
    return this.#lastError
  }

  get lastErrorAt() {
    return this.#lastErrorAt
  }

  /** 入队一个异步任务。 */
  push(label, task, options = {}) {
    const retries = Number.isFinite(options.retries) ? Math.max(0, options.retries) : 0
    this.#tasks.push({ label, task, retries, attempt: 0 })
    this.#drain()
  }

  async #drain() {
    if (this.#running) return
    this.#running = true
    while (this.#tasks.length > 0) {
      const job = this.#tasks.shift()
      try {
        await job.task()
        this.#done += 1
      } catch (error) {
        if (job.attempt < job.retries) {
          job.attempt += 1
          this.#tasks.push(job)
          await new Promise((resolve) => setTimeout(resolve, 1500))
          continue
        }
        this.#failed += 1
        this.#lastError = `${job.label}: ${errorText(error)}`
        this.#lastErrorAt = Date.now()
        this.#logger?.warn?.(`[dsh-memory] 任务失败 (${job.label}): ${errorText(error)}`)
      }
    }
    this.#running = false
  }
}

/** 把 provider id 规范化成凭据引用名前缀。 */
function providerIdToEnv(id) {
  const text = String(id ?? '')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
  return (text || 'CUSTOM') + '_API_KEY'
}

/** 取整并夹在范围内。 */
function clampInt(value, fallback, min, max) {
  const number = Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback
  return Math.min(max, Math.max(min, number))
}

/** 取浮点数并夹在范围内。 */
function clampNumber(value, fallback, min, max) {
  const number = Number.isFinite(Number(value)) ? Number(value) : fallback
  return Math.min(max, Math.max(min, number))
}

/** 宽松解析布尔。 */
function asBool(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1 || value === '1') return true
  if (value === 'false' || value === 0 || value === '0') return false
  return fallback
}

// ---------------------------------------------------------------------------
// 时区与时间格式化
// ---------------------------------------------------------------------------

/** 常见时区（设置页下拉用；值均为 IANA 名称）。 */
const TIMEZONES = [
  '',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Asia/Bangkok',
  'Asia/Kolkata',
  'Asia/Dubai',
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Perth',
  'Australia/Sydney',
  'Pacific/Auckland',
]

/** 校验 IANA 时区是否合法；非法返回 false。 */
function isValidTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== 'string') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date())
    return true
  } catch {
    return false
  }
}

/**
 * 解析配置里的时区：'' 表示跟随服务器本地；'custom' 读取自定义输入；
 * 非法值回退到服务器本地（返回 undefined）。
 * @returns {string|undefined} 合法 IANA 时区，或 undefined（服务器本地）
 */
function resolveTimeZone(raw, custom) {
  const value = String(raw ?? '').trim()
  if (value === 'custom') {
    const customValue = String(custom ?? '').trim()
    return isValidTimeZone(customValue) ? customValue : undefined
  }
  if (value === '') return undefined
  return isValidTimeZone(value) ? value : undefined
}

/** 取某个时间点在指定时区下的日期/时间分量。 */
function timeZoneParts(ts, timeZone) {
  if (!timeZone) {
    const date = new Date(ts)
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
    }
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = {}
  for (const part of formatter.formatToParts(new Date(ts))) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

/** 指定时区相对 UTC 的偏移（毫秒）。 */
function timeZoneOffsetMs(ts, timeZone) {
  if (!timeZone) return -new Date(ts).getTimezoneOffset() * 60000
  const parts = timeZoneParts(ts, timeZone)
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return asUtc - ts
}

/** 指定时区下“某一天 00:00”的 epoch 毫秒（处理 DST 用两次迭代）。 */
function startOfDayMs(ts, timeZone) {
  const parts = timeZoneParts(ts, timeZone)
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day)
  let offset = timeZoneOffsetMs(guess, timeZone)
  offset = timeZoneOffsetMs(guess - offset, timeZone)
  return guess - offset
}

/**
 * 按指定时区格式化时间：`YYYY-MM-DD HH:mm`。
 * @param {number} ts epoch 毫秒
 * @param {string|undefined} timeZone IANA 时区；空表示服务器本地
 */
function formatTimeInZone(ts, timeZone) {
  const value = typeof ts === 'number' && Number.isFinite(ts) ? ts : Date.now()
  const parts = timeZoneParts(value, timeZone)
  const pad = (n) => String(n).padStart(2, '0')
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`
}

/**
 * 相对时间描述（中文）：刚刚 / N 分钟前 / N 小时前 / N 天前。
 * @param {number} ts epoch 毫秒
 * @param {number} [now] 当前时间
 */
function relativeTime(ts, now = Date.now()) {
  const value = typeof ts === 'number' && Number.isFinite(ts) ? ts : now
  const diff = Math.max(0, now - value)
  const minute = 60000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`
  return `${Math.floor(diff / (30 * day))} 个月前`
}

/** 计算“今天 / 近 7 天 / 近 30 天”的时间范围（按指定时区取自然日）。 */
function rangeBounds(range, timeZone, now = Date.now()) {
  const day = 86400000
  if (range === 'today') {
    const from = startOfDayMs(now, timeZone)
    return { from, to: from + day - 1 }
  }
  if (range === '7d' || range === '30d') {
    const days = range === '7d' ? 7 : 30
    const startToday = startOfDayMs(now, timeZone)
    const from = startToday - (days - 1) * day
    return { from, to: startToday + day - 1 }
  }
  return { from: null, to: null }
}

/** 生成数据/管理界面上统一使用的时间元信息。 */
function timeInfo(ts, timeZone, showRelative = true, now = Date.now()) {
  const value = typeof ts === 'number' && Number.isFinite(ts) ? ts : now
  return {
    time: formatTimeInZone(value, timeZone),
    relative: showRelative ? relativeTime(value, now) : '',
  }
}
// ===== src/lib/config.js =====
/**
 * dsh-memory 插件配置（v0.2）。
 *
 * 所有用户可调项都声明为 `.volatile()`，DSH 的 Settings 服务会把它们投影成
 * 可编辑表单，设置页通过 ctx.configForms 读写，保存后热生效。
 *
 * v0.2 起支持多 provider 档案：providers 是整棵被标记 volatile 的数组，
 * 设置页可以增删改、切换 activeProvider；不再绑定硅基流动。
 */


/** 常用嵌入维度档位（不同模型支持范围不同，这里作为提示）。 */
const DIMENSIONS = [256, 512, 768, 1024, 1536, 2048, 2560, 3072, 4096]

/** 图片记忆方式。 */
const IMAGE_MODES = ['caption', 'placeholder', 'off']

/** 记忆范围。 */
const SCOPE_MODES = ['global', 'workspace', 'session']

/** 单个 provider 档案的字段结构（同时用于客户端预设与校验）。 */
const PROVIDER_FIELDS = [
  'id',
  'name',
  'protocol',
  'baseUrl',
  'embedModel',
  'dimensions',
  'apiKeyEnv',
  'sendDimensions',
  'visionModel',
  'visionBaseUrl',
  'visionApiKeyEnv',
]

const Config = z.object({
  // -------------------- 多 provider 档案 --------------------
  providers: z
    .array(
      z.object({
        id: z.string().required().description('唯一标识（英文/数字/下划线），如 siliconflow'),
        name: z.string().default('').description('显示名称，如 硅基流动'),
        protocol: z
          .string()
          .default('openai')
          .description('接口协议；目前支持 OpenAI 兼容的 /embeddings 与 /chat/completions'),
        baseUrl: z.string().required().description('API Base URL，如 https://api.siliconflow.cn/v1'),
        embedModel: z.string().required().description('嵌入模型名称'),
        dimensions: z.number().default(1024).step(1).description('向量维度（需与 Qdrant 集合一致）'),
        apiKeyEnv: z
          .string()
          .default('')
          .description('该 Base URL 对应的 Key 在 DSH 凭据库中的引用名；留空则用 <ID>_API_KEY'),
        sendDimensions: z
          .boolean()
          .default(true)
          .description('请求嵌入接口时是否发送 dimensions 参数（部分服务不支持时关掉）'),
        visionModel: z
          .string()
          .default('')
          .description('图片概览使用的视觉对话模型；留空则图片只记占位'),
        visionBaseUrl: z.string().default('').description('视觉接口 Base URL；留空与 baseUrl 相同'),
        visionApiKeyEnv: z.string().default('').description('视觉接口 Key 引用名；留空与 apiKeyEnv 相同'),
      }),
    )
    .default([])
    .volatile()
    .description('provider 档案列表（可保存多套云端服务商配置）'),
  activeProvider: z
    .string()
    .default('')
    .volatile()
    .description('当前激活的 provider id；留空使用列表中的第一个'),

  // -------------------- 向量库 --------------------
  qdrantUrl: z
    .string()
    .default('http://127.0.0.1:6333')
    .volatile()
    .description('Qdrant HTTP 地址；插件与 Qdrant 同机时保持 127.0.0.1'),
  collection: z.string().default('dsh_memory').volatile().description('Qdrant collection 名称'),
  qdrantApiKeyEnv: z
    .string()
    .default('')
    .volatile()
    .description('Qdrant API Key 的凭据引用名；留空表示无鉴权（本机回环推荐）'),

  // -------------------- 自动记录 --------------------
  autoCapture: z
    .boolean()
    .default(true)
    .volatile()
    .description('每轮对话结束后，自动把“用户要点 + 助手回答要点”存入长期记忆'),
  captureUserChars: z
    .number()
    .default(400)
    .step(1)
    .min(0)
    .volatile()
    .description('自动记录时用户内容的最大保留字符数'),
  captureAssistantChars: z
    .number()
    .default(400)
    .step(1)
    .min(0)
    .volatile()
    .description('自动记录时助手回答的最大保留字符数'),
  captureMinChars: z
    .number()
    .default(12)
    .step(1)
    .min(0)
    .volatile()
    .description('一轮内容少于该字符数时不记录（过滤“好的/谢谢”等噪音）'),
  includeSubagents: z
    .boolean()
    .default(false)
    .volatile()
    .description('是否也记录子代理（subagent）会话的要点'),

  // -------------------- 自动召回 --------------------
  autoRecall: z
    .boolean()
    .default(true)
    .volatile()
    .description('每轮开始时自动检索相关长期记忆并注入上下文'),
  memoryScope: z
    .union([z.const('global'), z.const('workspace'), z.const('session')])
    .default('global')
    .volatile()
    .description('记忆范围：global=全局共享；workspace=按工作目录隔离；session=按会话隔离'),
  recallTopK: z
    .number()
    .default(3)
    .step(1)
    .min(1)
    .max(20)
    .volatile()
    .description('自动召回的条目数（1-20）'),
  recallMinScore: z
    .number()
    .default(0.42)
    .step(0.01)
    .min(0)
    .max(1)
    .volatile()
    .description('自动召回的最低相关度（0-1，越高越严格）'),
  recallMaxChars: z
    .number()
    .default(600)
    .step(1)
    .min(100)
    .max(4000)
    .volatile()
    .description('自动召回内容注入上下文时的最大字符数'),
  recallIncludeCurrentSession: z
    .boolean()
    .default(false)
    .volatile()
    .description('自动召回时是否包含当前会话自身的记忆'),
  recallTimeoutMs: z
    .number()
    .default(3000)
    .step(100)
    .min(500)
    .max(20000)
    .volatile()
    .description('自动召回的超时时间（毫秒）；超时则本轮跳过召回'),

  // -------------------- 时间与时区 --------------------
  timezone: z
    .string()
    .default('')
    .volatile()
    .description('时间显示时区：留空=跟随服务器本地；可选常见 IANA 时区，或 custom 自定义'),
  timezoneCustom: z
    .string()
    .default('')
    .volatile()
    .description('自定义 IANA 时区（当 timezone=custom 时生效），如 America/New_York'),
  injectCurrentTime: z
    .boolean()
    .default(true)
    .volatile()
    .description('自动召回时在上下文里附带“当前时间”（按所选时区），便于模型判断记忆的新旧'),
  relativeTime: z
    .boolean()
    .default(true)
    .volatile()
    .description('召回/列表中显示相对时间（如“3 天前”）'),

  // -------------------- 图片 --------------------
  imageMode: z
    .union([z.const('caption'), z.const('placeholder'), z.const('off')])
    .default('caption')
    .volatile()
    .description('图片记忆方式：caption=生成一句话概览后只存描述；placeholder=只记“发过图”；off=忽略图片'),
  captionPrompt: z
    .string()
    .default('')
    .volatile()
    .description('图片概览的提示词；留空使用内置默认提示词'),
  captionMaxTokens: z
    .number()
    .default(96)
    .step(1)
    .min(16)
    .max(1024)
    .volatile()
    .description('图片概览生成的最大 token 数'),

  // -------------------- 工具 --------------------
  toolsEnabled: z
    .boolean()
    .default(true)
    .volatile()
    .description('是否允许模型使用 memory_search / memory_save / memory_forget 工具'),
  toolSearchLimit: z
    .number()
    .default(5)
    .step(1)
    .min(1)
    .max(20)
    .volatile()
    .description('memory_search 的默认返回条数（1-20）'),

  // -------------------- 定期维护 / 保留策略 --------------------
  retentionDays: z
    .number()
    .default(0)
    .step(1)
    .min(0)
    .volatile()
    .description('记忆保留天数（0=永久保留）；超期记忆在定期维护时删除'),
  maxMemories: z
    .number()
    .default(0)
    .step(1)
    .min(0)
    .volatile()
    .description('记忆条数上限（0=不限）；超限时定期维护淘汰最旧的记录'),
  maintenanceIntervalHours: z
    .number()
    .default(6)
    .step(1)
    .min(1)
    .max(168)
    .volatile()
    .description('自动维护的间隔小时数'),
  maintenanceDedupe: z
    .boolean()
    .default(true)
    .volatile()
    .description('维护时对高度相似的重复记忆做合并（保留较新的一条）'),
  dedupeThreshold: z
    .number()
    .default(0.96)
    .step(0.01)
    .min(0.8)
    .max(1)
    .volatile()
    .description('重复记忆合并的相似度阈值（0.8-1，越高越保守）'),
  dedupeMaxScan: z
    .number()
    .default(100)
    .step(10)
    .min(10)
    .max(1000)
    .volatile()
    .description('每次维护最多检查多少条最近记忆以寻找重复'),

  // -------------------- 其他 --------------------
  debug: z.boolean().default(false).volatile().description('在 DSH 日志中输出插件调试信息'),
})
// ===== src/lib/api-client.js =====
/**
 * OpenAI 兼容的云端 API 客户端：
 * - POST {baseUrl}/embeddings        文本嵌入（OpenAI / SiliconFlow / DashScope 兼容模式 / 智谱 / 火山方舟 / Jina … 均兼容）
 * - POST {visionBaseUrl}/chat/completions  视觉对话（用于图片一句话概览），图片以 data URI 发送
 *
 * 不绑定任何特定厂商：Base URL、模型、维度、Key 均由 provider 档案提供。
 */


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
const DEFAULT_CAPTION_PROMPT =
  '用一句中文概括这张图片的关键内容（不超过 30 个字），供未来检索记忆使用。只输出这句话本身，不要解释。'

/** 一个 provider 的 OpenAI 兼容客户端。 */
class OpenAICompatClient {
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
// ===== src/lib/qdrant.js =====
/**
 * Qdrant REST 客户端（只用 HTTP API，不需要额外依赖）。
 * 与 Qdrant 同机部署时默认 http://127.0.0.1:6333，无需 API Key；
 * 如需鉴权，可从 DSH 凭据库读取 api-key。
 */


function joinUrl(base, path) {
  return `${String(base ?? '').replace(/\/+$/, '')}${path}`
}

class QdrantClient {
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
      return { ok: true, created: true, info: { ...info, payloadIndexes: ['kind', 'sessionId', 'cwd', 'ts'] } }
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
      { field_name: 'sessionId', field_schema: 'keyword' },
      { field_name: 'cwd', field_schema: 'keyword' },
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
// ===== src/lib/service.js =====
/**
 * MemoryService：插件核心业务对象（v0.2）。
 *
 * 职责：
 * - 读取（会热更新的）插件配置；
 * - 多 provider 档案：解析激活的 provider、凭据、视觉模型；
 * - 嵌入文本并写入 Qdrant；
 * - 自动记录一轮对话要点 / 图片概览；
 * - 按记忆范围检索（全局 / 工作区 / 会话）；
 * - 记忆管理：列表、搜索、删除、导出、重建；
 * - 保留策略与定期维护（过期清理、超限淘汰、相似重复合并、索引重建）；
 * - 状态、测试、后台队列。
 */





/** 自动召回注入消息的 source.kind；DSH 会把它渲染成“上下文注入”行而不是用户气泡。 */
const MEMORY_SOURCE = 'long-term-memory'

/** 自动召回上下文消息的标题前缀。 */
const RECALL_HEADER = '【长期记忆·自动召回】'

/** provider 列表为空时的内置兜底配置（与 bundle 默认值一致）。 */
const BUILTIN_PROVIDER = {
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
function normalizeProvider(raw, index) {
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

/** 选择合法的向量维度。 */
function pickDimensions(value) {
  const n = clampInt(value, 1024, 1, 65536)
  return DIMENSIONS.includes(n) ? n : n
}

/** 去掉 meta 里的 undefined / null，保证 payload 是纯 JSON。 */
function sanitizeMeta(meta) {
  const out = {}
  for (const [key, value] of Object.entries(meta ?? {})) {
    if (value === undefined || value === null) continue
    out[key] = value
  }
  return out
}

class MemoryService {
  /**
   * @param {object} ctx DSH 插件上下文
   * @param {object} config schemastery Config 实例（字段可能包着 volatile Ref）
   */
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    this.logger = ctx.logger ?? console
    this.queue = new SerialQueue(this.logger)
    this.stats = {
      startedAt: Date.now(),
      writes: 0,
      lastWriteAt: 0,
      lastWriteKind: null,
      lastRecallAt: 0,
      lastRecallCount: 0,
      recallChecks: 0,
      lastRecallQuery: '',
      lastRecallError: '',
      lastRecallInjectAt: 0,
      captions: 0,
      lastMaintenanceAt: 0,
      lastMaintenance: null,
    }
    this.collectionState = {
      signature: null,
      ok: false,
      error: null,
      checkedAt: 0,
      info: null,
    }
  }

  // ------------------------------------------------------------------
  // 配置与 provider
  // ------------------------------------------------------------------

  /** 当前配置（解包 volatile）。 */
  cfg() {
    return readConfig(this.config)
  }

  /** 全部 provider 档案（空列表时回退内置 SiliconFlow）。 */
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
  storage() {
    const cfg = this.cfg()
    return {
      qdrantUrl: normalizeUrl(cfg.qdrantUrl || 'http://127.0.0.1:6333'),
      collection: String(cfg.collection ?? 'dsh_memory').trim() || 'dsh_memory',
      qdrantApiKeyEnv: String(cfg.qdrantApiKeyEnv ?? '').trim(),
    }
  }

  /** 自动记录配置。 */
  captureOptions() {
    const cfg = this.cfg()
    return {
      autoCapture: cfg.autoCapture !== false,
      captureUserChars: Math.max(0, clampInt(cfg.captureUserChars, 400, 0, 20000)),
      captureAssistantChars: Math.max(0, clampInt(cfg.captureAssistantChars, 400, 0, 20000)),
      captureMinChars: Math.max(0, clampInt(cfg.captureMinChars, 12, 0, 20000)),
      includeSubagents: cfg.includeSubagents === true,
    }
  }

  /** 自动召回配置。 */
  recallOptions() {
    const cfg = this.cfg()
    const scope = cfg.memoryScope === 'workspace' || cfg.memoryScope === 'session' ? cfg.memoryScope : 'global'
    return {
      autoRecall: cfg.autoRecall !== false,
      memoryScope: scope,
      recallTopK: clampInt(cfg.recallTopK, 3, 1, 20),
      recallMinScore: clampNumber(cfg.recallMinScore, 0.42, 0, 1),
      recallMaxChars: clampInt(cfg.recallMaxChars, 600, 100, 4000),
      recallIncludeCurrentSession: cfg.recallIncludeCurrentSession === true,
      recallTimeoutMs: clampInt(cfg.recallTimeoutMs, 3000, 500, 20000),
    }
  }

  /** 工具配置。 */
  toolOptions() {
    const cfg = this.cfg()
    return {
      toolsEnabled: cfg.toolsEnabled !== false,
      searchLimit: clampInt(cfg.toolSearchLimit, 5, 1, 20),
    }
  }

  /** 维护 / 保留配置。 */
  maintenanceOptions() {
    const cfg = this.cfg()
    return {
      retentionDays: Math.max(0, clampInt(cfg.retentionDays, 0, 0, 36500)),
      maxMemories: Math.max(0, clampInt(cfg.maxMemories, 0, 0, 10000000)),
      maintenanceIntervalHours: clampInt(cfg.maintenanceIntervalHours, 6, 1, 168),
      maintenanceDedupe: cfg.maintenanceDedupe !== false,
      dedupeThreshold: clampNumber(cfg.dedupeThreshold, 0.96, 0.8, 1),
      dedupeMaxScan: clampInt(cfg.dedupeMaxScan, 100, 10, 1000),
    }
  }

  /** 图片概览配置。 */
  imageOptions() {
    const cfg = this.cfg()
    return {
      imageMode: cfg.imageMode === 'placeholder' || cfg.imageMode === 'off' ? cfg.imageMode : 'caption',
      captionPrompt: String(cfg.captionPrompt ?? '').trim() || DEFAULT_CAPTION_PROMPT,
      captionMaxTokens: clampInt(cfg.captionMaxTokens, 96, 16, 1024),
    }
  }

  /** 时间与时区配置。 */
  timeOptions() {
    const cfg = this.cfg()
    const timeZone = resolveTimeZone(cfg.timezone, cfg.timezoneCustom)
    return {
      timeZone,
      timeZoneLabel: timeZone ?? '服务器本地',
      injectCurrentTime: cfg.injectCurrentTime !== false,
      relativeTime: cfg.relativeTime !== false,
    }
  }

  /** 按配置时区格式化时间戳。 */
  formatTs(ts) {
    return timeInfo(ts, this.timeOptions().timeZone, false).time
  }

  /** 时间戳 → { time, relative }。 */
  tsInfo(ts) {
    const options = this.timeOptions()
    return timeInfo(ts, options.timeZone, options.relativeTime)
  }

  /** 当前 agent 的会话上下文（用于作用域过滤）。 */
  sessionContext(agentId) {
    const id = String(agentId ?? '')
    let cwd = ''
    try {
      const session = this.ctx.sessions?.get?.(id)
      cwd = String(session?.header?.cwd ?? '')
    } catch {
      /* ignore */
    }
    return { sessionId: id, cwd }
  }

  /**
   * 构造 Qdrant 过滤条件。
   * @param {object} options
   * @param {'global'|'workspace'|'session'} [options.mode]
   * @param {string} [options.sessionId] 当前会话
   * @param {string} [options.cwd] 当前工作目录
   * @param {boolean} [options.includeCurrentSession] 是否包含当前会话
   * @param {string} [options.kind] 只查某类记忆
   */
  buildFilter({ mode = 'global', sessionId = '', cwd = '', includeCurrentSession = false, kind = '' } = {}) {
    const must = []
    const mustNot = []
    if (mode === 'session') {
      if (sessionId) must.push({ key: 'sessionId', match: { value: sessionId } })
    } else if (mode === 'workspace') {
      if (cwd) must.push({ key: 'cwd', match: { value: cwd } })
      if (!includeCurrentSession && sessionId) {
        mustNot.push({ key: 'sessionId', match: { value: sessionId } })
      }
    } else if (!includeCurrentSession && sessionId) {
      mustNot.push({ key: 'sessionId', match: { value: sessionId } })
    }
    if (kind) must.push({ key: 'kind', match: { value: kind } })
    const filter = {}
    if (must.length > 0) filter.must = must
    if (mustNot.length > 0) filter.must_not = mustNot
    return Object.keys(filter).length > 0 ? filter : undefined
  }

  // ------------------------------------------------------------------
  // Qdrant 与集合
  // ------------------------------------------------------------------

  /** 构造 Qdrant 客户端（支持可选 api-key）。 */
  async qdrant() {
    const storage = this.storage()
    let apiKey = ''
    if (storage.qdrantApiKeyEnv) apiKey = await this.resolveKey(storage.qdrantApiKeyEnv)
    return new QdrantClient({ url: storage.qdrantUrl, apiKey, logger: this.logger })
  }

  /** 确保集合存在且与激活 provider 的维度一致。 */
  async ensureReady({ force = false } = {}) {
    const provider = this.activeProvider()
    const storage = this.storage()
    const signature = `${storage.qdrantUrl}|${storage.collection}|${provider.dimensions}`
    const now = Date.now()
    if (
      !force &&
      this.collectionState.signature === signature &&
      now - this.collectionState.checkedAt < 30000
    ) {
      if (this.collectionState.ok) return this.collectionState.info
      throw new Error(this.collectionState.error ?? 'Qdrant 不可用')
    }
    const qdrant = await this.qdrant()
    try {
      const result = await qdrant.ensureCollection(storage.collection, provider.dimensions)
      this.collectionState = {
        signature,
        ok: result.ok,
        error: result.ok ? null : (result.error ?? '集合不可用'),
        checkedAt: now,
        info: result.info ?? null,
      }
      if (!result.ok) throw new Error(this.collectionState.error)
      return result.info
    } catch (error) {
      this.collectionState = {
        signature,
        ok: false,
        error: errorText(error),
        checkedAt: now,
        info: null,
      }
      throw error
    }
  }

  // ------------------------------------------------------------------
  // 写入
  // ------------------------------------------------------------------

  /** 写入一条记忆（内容相同时覆盖同一 point 实现去重）。 */
  async addMemory({ kind, text, meta = {}, signal }) {
    const provider = this.activeProvider()
    const body = redactSecrets(cleanText(text))
    if (!body) throw new Error('记忆内容为空，已跳过')
    const client = await this.clientFor(provider)
    const embedded = await client.embedText(body, { signal })
    if (embedded.vector.length !== provider.dimensions) {
      throw new Error(
        `嵌入维度不一致：provider 配置 ${provider.dimensions}，服务返回 ${embedded.vector.length}；请修正 provider 维度配置或重建集合`,
      )
    }
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    const id = memoryPointId(`${kind}|${body}`)
    const payload = sanitizeMeta({
      text: body,
      kind,
      ts: Date.now(),
      provider: provider.id,
      model: provider.embedModel,
      dimensions: provider.dimensions,
      ...meta,
    })
    await qdrant.upsert(storage.collection, [{ id, vector: embedded.vector, payload }], { signal })
    this.stats.writes += 1
    this.stats.lastWriteAt = payload.ts
    this.stats.lastWriteKind = kind
    this.debugLog(`写入 ${kind} 记忆 ${id}（${body.length} 字，provider=${provider.id}）`)
    return { ok: true, id, text: body }
  }

  /** 记录一轮对话要点。 */
  async addTurnMemory({ userText, assistantText, sessionId, cwd, turn, imageCount = 0 }) {
    const options = this.captureOptions()
    const user = truncate(cleanText(userText), options.captureUserChars)
    const assistant = truncate(cleanText(assistantText), options.captureAssistantChars)
    if (user.length + assistant.length < options.captureMinChars) return { ok: false, skipped: 'too-short' }
    const parts = []
    if (user) parts.push(`用户：${user}`)
    if (assistant) parts.push(`助手：${assistant}`)
    if (imageCount > 0) parts.push(`（本轮附有 ${imageCount} 张图片）`)
    return this.addMemory({
      kind: 'turn',
      text: parts.join('\n'),
      meta: {
        sessionId: String(sessionId ?? ''),
        cwd: String(cwd ?? ''),
        turn: Number(turn) || 0,
        hasImages: imageCount > 0,
      },
    })
  }

  /** 记录一张图片：只存一句话概览，永不存原图。 */
  async addImageMemory({ ref, sessionId, cwd, turn }) {
    const image = this.imageOptions()
    if (image.imageMode === 'off') return { ok: false, skipped: 'image-mode-off' }
    const provider = this.activeProvider()
    const vision = this.visionConfigOf(provider)
    const mediaType = ref?.mediaType || 'image/png'
    const imageMeta = {
      mediaType: String(mediaType),
      width: Number(ref?.width) || null,
      height: Number(ref?.height) || null,
    }
    let text
    let caption = null
    if (image.imageMode === 'caption' && vision.model) {
      try {
        const stored = await this.ctx.attachments.readImage(ref)
        const dataUri = toDataUri(stored?.data ?? stored, mediaType)
        const client = await this.clientFor(provider)
        const result = await client.captionImage(dataUri, {
          prompt: image.captionPrompt,
          maxTokens: image.captionMaxTokens,
        })
        caption = cleanText(result.text)
        text = `图片概览：${caption || '（模型未返回描述）'}`
        this.stats.captions += 1
      } catch (error) {
        this.logger.warn?.(`[dsh-memory] 图片概览失败，降级为占位记录：${errorText(error)}`)
        text = '用户发送了一张图片（概览生成失败，仅记录图片存在）'
      }
    } else {
      text = '用户发送了一张图片（未解析图片内容）'
    }
    return this.addMemory({
      kind: 'image',
      text,
      meta: {
        sessionId: String(sessionId ?? ''),
        cwd: String(cwd ?? ''),
        turn: Number(turn) || 0,
        image: imageMeta,
        caption,
      },
    })
  }

  // ------------------------------------------------------------------
  // 检索 / 召回
  // ------------------------------------------------------------------

  /** 检索记忆。 */
  async search(query, options = {}) {
    const text = cleanText(query)
    if (!text) return { hits: [], query: '' }
    const provider = this.activeProvider()
    const client = await this.clientFor(provider)
    const embedded = await client.embedText(text, { signal: options.signal })
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    const filter =
      options.filter ??
      this.buildFilter({
        mode: options.mode ?? 'global',
        sessionId: options.sessionId ?? '',
        cwd: options.cwd ?? '',
        includeCurrentSession: options.includeCurrentSession === true,
        kind: options.kind ?? '',
      })
    const points = await qdrant.search(
      storage.collection,
      {
        vector: embedded.vector,
        limit: clampInt(options.limit, 3, 1, 100),
        scoreThreshold: Number.isFinite(Number(options.minScore)) ? Number(options.minScore) : undefined,
        filter,
      },
      { signal: options.signal },
    )
    const timeOptions = this.timeOptions()
    const hits = points.map((point) => {
      const payload = point?.payload ?? {}
      const ts = Number(payload.ts) || 0
      const info = timeInfo(ts, timeOptions.timeZone, timeOptions.relativeTime)
      return {
        id: String(point?.id ?? ''),
        score: Number(point?.score) || 0,
        text: String(payload.text ?? ''),
        kind: String(payload.kind ?? ''),
        ts,
        time: info.time,
        relative: info.relative,
        sessionId: payload.sessionId ? String(payload.sessionId) : '',
        cwd: payload.cwd ? String(payload.cwd) : '',
        tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
        provider: payload.provider ? String(payload.provider) : '',
      }
    })
    return { hits, query: text, usage: embedded.usage }
  }

  /** 自动召回：检索并组装成注入上下文块。 */
  async recall(query, { signal, sessionId = '', cwd = '' } = {}) {
    const options = this.recallOptions()
    const { hits } = await this.search(query, {
      limit: options.recallTopK,
      minScore: options.recallMinScore,
      mode: options.memoryScope,
      sessionId,
      cwd,
      includeCurrentSession: options.recallIncludeCurrentSession,
      signal,
    })
    const filtered = hits.filter((hit) => hit.text.length > 0)
    if (filtered.length === 0) return { hits: [], block: '' }
    const timeOptions = this.timeOptions()
    const lines = []
    for (const [index, hit] of filtered.entries()) {
      const kindLabel =
        hit.kind === 'image' ? '图片' : hit.kind === 'fact' ? '事实' : hit.kind === 'turn' ? '对话' : '记忆'
      const relative = hit.relative ? `·${hit.relative}` : ''
      lines.push(`${index + 1}. [${hit.time}${relative}·${kindLabel}] ${truncate(hit.text, 220)}`)
    }
    const timeLine = timeOptions.injectCurrentTime
      ? `当前时间：${this.formatTs(Date.now())}（时区：${timeOptions.timeZoneLabel}；记忆时间均按此时区显示）\n`
      : ''
    let block = `${RECALL_HEADER}\n${timeLine}以下是从过去会话中检索到的相关记忆，仅供参考；若与当前对话冲突，以当前对话为准：\n${lines.join('\n')}`
    block = truncate(block, options.recallMaxChars)
    this.stats.lastRecallAt = Date.now()
    this.stats.lastRecallCount = filtered.length
    return { hits: filtered, block }
  }

  // ------------------------------------------------------------------
  // 记忆管理
  // ------------------------------------------------------------------

  /** 把 Qdrant point 映射成管理界面用的条目。 */
  #pointToItem(point, score) {
    const payload = point?.payload ?? {}
    const ts = Number(payload.ts) || 0
    const info = this.tsInfo(ts)
    return {
      id: String(point?.id ?? ''),
      text: String(payload.text ?? ''),
      kind: String(payload.kind ?? ''),
      ts,
      time: info.time,
      relative: info.relative,
      sessionId: payload.sessionId ? String(payload.sessionId) : '',
      cwd: payload.cwd ? String(payload.cwd) : '',
      tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
      provider: payload.provider ? String(payload.provider) : '',
      ...(Number.isFinite(score) ? { score } : {}),
    }
  }

  /** 记忆列表：带 query 走向量检索，否则按时间倒序滚动。 */
  async listMemories({ query = '', limit = 20, offset = null, kind = '', range = '' } = {}) {
    const cleanQuery = cleanText(query)
    const pageSize = clampInt(limit, 20, 1, 100)
    if (cleanQuery) {
      const { hits } = await this.search(cleanQuery, { limit: pageSize, kind })
      return { items: hits, nextOffset: null, total: hits.length, query: cleanQuery }
    }
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    const must = []
    if (kind) must.push({ key: 'kind', match: { value: kind } })
    if (range === 'today' || range === '7d' || range === '30d') {
      const bounds = rangeBounds(range, this.timeOptions().timeZone)
      if (bounds.from !== null) must.push({ key: 'ts', range: { gte: bounds.from, lte: bounds.to } })
    }
    const filter = must.length > 0 ? { must } : undefined
    const { points, nextOffset } = await qdrant.scroll(storage.collection, {
      limit: pageSize,
      offset: offset ?? undefined,
      orderBy: { key: 'ts', direction: 'desc' },
      filter,
    })
    let total = null
    try {
      total = await qdrant.count(storage.collection, { filter, exact: false })
    } catch {
      /* ignore */
    }
    return {
      items: points.map((point) => this.#pointToItem(point)),
      nextOffset: nextOffset ?? null,
      total,
      query: '',
    }
  }

  /** 导出全部记忆。 */
  async exportMemories({ maxItems = 20000 } = {}) {
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    const items = []
    let offset = undefined
    while (items.length < maxItems) {
      const { points, nextOffset } = await qdrant.scroll(storage.collection, {
        limit: 256,
        offset,
        orderBy: { key: 'ts', direction: 'asc' },
      })
      for (const point of points) items.push(this.#pointToItem(point))
      if (!nextOffset || points.length === 0) break
      offset = nextOffset
    }
    return { ok: true, count: items.length, exportedAt: new Date().toISOString(), items }
  }

  /** 删除记忆。 */
  async forget(ids) {
    const list = (Array.isArray(ids) ? ids : [ids]).map(String).filter(Boolean)
    if (list.length === 0) throw new Error('需要提供要删除的记忆 id（可先用 memory_search 查询）')
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    await qdrant.deletePoints(storage.collection, list)
    return { ok: true, deleted: list.length }
  }

  /** 重建集合（维度变更 / 数据清空时使用，会删除全部记忆）。 */
  async recreateCollection() {
    const provider = this.activeProvider()
    const storage = this.storage()
    const qdrant = await this.qdrant()
    const result = await qdrant.recreateCollection(storage.collection, provider.dimensions)
    this.collectionState = {
      signature: `${storage.qdrantUrl}|${storage.collection}|${provider.dimensions}`,
      ok: result.ok,
      error: result.ok ? null : (result.error ?? '重建失败'),
      checkedAt: Date.now(),
      info: result.info ?? null,
    }
    return result
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
  async status() {
    const provider = this.activeProvider()
    const recall = this.recallOptions()
    const capture = this.captureOptions()
    const storage = this.storage()
    const toolOptions = this.toolOptions()
    const maintenanceOptions = this.maintenanceOptions()
    const info = {
      ok: true,
      app: {
        name: 'dsh-memory',
        version: '0.3.1',
        startedAt: this.stats.startedAt,
      },
      time: (() => {
        const options = this.timeOptions()
        return {
          timezone: options.timeZone ?? '',
          timezoneLabel: options.timeZoneLabel,
          injectCurrentTime: options.injectCurrentTime,
          relativeTime: options.relativeTime,
          now: this.formatTs(Date.now()),
        }
      })(),
      provider: {
        id: provider.id,
        name: provider.name,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        embedModel: provider.embedModel,
        dimensions: provider.dimensions,
        visionModel: provider.visionModel,
        visionBaseUrl: this.visionConfigOf(provider).baseUrl,
        apiKeyEnv: this.credentialRef(provider),
        visionApiKeyEnv: this.visionConfigOf(provider).ref,
      },
      providers: [],
      storage: { ...storage },
      behavior: {
        autoCapture: capture.autoCapture,
        autoRecall: recall.autoRecall,
        memoryScope: recall.memoryScope,
        recallTopK: recall.recallTopK,
        recallMinScore: recall.recallMinScore,
        recallMaxChars: recall.recallMaxChars,
        recallIncludeCurrentSession: recall.recallIncludeCurrentSession,
        recallTimeoutMs: recall.recallTimeoutMs,
        imageMode: this.cfg().imageMode ?? 'caption',
        toolsEnabled: toolOptions.toolsEnabled,
      },
      retention: { ...maintenanceOptions },
      credential: null,
      qdrant: { ok: false, version: null, error: null },
      collection: { name: storage.collection, exists: false, points: 0, size: null, error: null, payloadIndexes: [] },
      queue: {
        pending: this.queue.pending,
        done: this.queue.done,
        failed: this.queue.failed,
        lastError: this.queue.lastError,
        lastErrorTime: this.queue.lastErrorAt ? this.formatTs(this.queue.lastErrorAt) : '',
      },
      stats: {
        writes: this.stats.writes,
        lastWriteTime: this.stats.lastWriteAt ? this.formatTs(this.stats.lastWriteAt) : '',
        lastWriteKind: this.stats.lastWriteKind,
        lastRecallTime: this.stats.lastRecallAt ? this.formatTs(this.stats.lastRecallAt) : '',
        lastRecallCount: this.stats.lastRecallCount,
        recallChecks: this.stats.recallChecks,
        lastRecallQuery: this.stats.lastRecallQuery,
        lastRecallError: this.stats.lastRecallError,
        lastRecallInjectTime: this.stats.lastRecallInjectAt ? this.formatTs(this.stats.lastRecallInjectAt) : '',
        captions: this.stats.captions,
        startedAt: this.stats.startedAt,
        lastMaintenanceTime: this.stats.lastMaintenanceAt ? this.formatTs(this.stats.lastMaintenanceAt) : '',
        lastMaintenance: this.stats.lastMaintenance,
      },
      collectionState: {
        ok: this.collectionState.ok,
        error: this.collectionState.error,
        checkedAt: this.collectionState.checkedAt ? this.formatTs(this.collectionState.checkedAt) : '',
      },
    }
    try {
      info.credential = await this.credentialInfo(this.credentialRef(provider))
    } catch (error) {
      info.credential = { configured: false, writable: false, error: errorText(error) }
    }
    // 每个 provider 的 Key 状态
    const providers = this.providers()
    info.providers = await Promise.all(
      providers.map(async (item) => {
        const ref = this.credentialRef(item)
        let configured = false
        try {
          const described = await this.ctx.credentials.describe(ref)
          configured = described?.configured === true
        } catch {
          /* ignore */
        }
        const vision = this.visionConfigOf(item)
        let visionConfigured = configured
        if (vision.ref && vision.ref !== ref) {
          try {
            const described = await this.ctx.credentials.describe(vision.ref)
            visionConfigured = described?.configured === true
          } catch {
            visionConfigured = false
          }
        }
        return {
          ...item,
          apiKeyEnv: ref,
          visionApiKeyEnv: vision.ref,
          keyConfigured: configured,
          visionKeyConfigured: visionConfigured,
          active: item.id === provider.id,
        }
      }),
    )
    try {
      const qdrant = await this.qdrant()
      const health = await qdrant.health()
      info.qdrant = { ok: true, version: health.version, error: null }
      try {
        const collection = await qdrant.collectionInfo(storage.collection)
        info.collection = {
          name: storage.collection,
          exists: collection !== null,
          points: collection?.points ?? 0,
          size: collection?.size ?? null,
          payloadIndexes: collection?.payloadIndexes ?? [],
          error: null,
        }
      } catch (error) {
        info.collection.error = errorText(error)
      }
    } catch (error) {
      info.qdrant = { ok: false, version: null, error: errorText(error) }
      info.ok = false
    }
    return info
  }

  /**
   * 设置页“测试连接”：默认测试激活 provider；传 providerId 测试指定档案。
   */
  async test(providerId) {
    const provider = providerId ? this.providerById(providerId) : this.activeProvider()
    if (!provider) throw new Error(`未找到 provider：${providerId}`)
    const results = { provider: { id: provider.id, name: provider.name, embeddingModel: provider.embedModel, dimensions: provider.dimensions, visionModel: provider.visionModel } }
    try {
      const client = await this.clientFor(provider)
      const embedded = await client.embedText('长期记忆连接测试 ping', { timeoutMs: 30000 })
      results.embedding = {
        ok: true,
        latencyMs: embedded.latencyMs,
        dimensions: embedded.vector.length,
        usage: embedded.usage,
      }
    } catch (error) {
      results.embedding = { ok: false, error: errorText(error) }
    }
    try {
      const qdrant = await this.qdrant()
      const health = await qdrant.health()
      let collection = null
      try {
        collection = await qdrant.collectionInfo(this.storage().collection)
      } catch {
        /* collection 错误在 status 中体现 */
      }
      results.qdrant = {
        ok: true,
        version: health.version,
        collectionExists: collection !== null,
        points: collection?.points ?? 0,
        size: collection?.size ?? null,
      }
    } catch (error) {
      results.qdrant = { ok: false, error: errorText(error) }
    }
    if (provider.visionModel) {
      try {
        const client = await this.clientFor(provider)
        const image = this.imageOptions()
        const payload = await client.captionImage(
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PQQkAAAgEsAtjR+NZzQi+hcEKLNXzWgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQELgsTB6E82mqu8QAAAABJRU5ErkJggg==',
          { timeoutMs: 60000, prompt: image.captionPrompt, maxTokens: image.captionMaxTokens },
        )
        results.caption = { ok: true, latencyMs: payload.latencyMs, model: provider.visionModel, text: payload.text }
      } catch (error) {
        results.caption = { ok: false, model: provider.visionModel, error: errorText(error) }
      }
    }
    results.ok = Object.values(results)
      .filter((value) => value && typeof value === 'object' && 'ok' in value)
      .every((value) => value.ok !== false)
    return results
  }

  /** 调试日志。 */
  debugLog(...args) {
    if (this.cfg().debug === true) this.logger.info?.('[dsh-memory]', ...args)
  }

}
// ===== src/lib/capture.js =====
/**
 * 自动记录：监听 session/event，在每轮结束时把“用户要点 + 助手回答要点”
 * 以及用户图片的一句话概览写入长期记忆。
 *
 * 只记录 source.kind === 'user' 的真实人类消息；插件自己注入的
 * long-term-memory 上下文、运行时上下文、工具结果等一律不记录。
 */


/** 从 content blocks 里提取纯文本。 */
function textFromContent(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return cleanText(parts.join('\n'))
}

class CaptureController {
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
// ===== src/lib/recall.js =====
/**
 * 自动召回：在每轮第一步之前，用最后一条真实用户消息做向量检索，
 * 把相关记忆作为一条 source.kind = 'long-term-memory' 的上下文消息
 * 追加进本步的 messages。
 *
 * 该消息会进入会话日志（可回放/可 fork），DSH Web 会把它显示成
 * “上下文注入”行，而不是用户气泡。
 */




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
function createMemoryMessage(text) {
  return {
    id: `memory-${randomUUID()}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: MEMORY_SOURCE },
  }
}

class RecallController {
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
// ===== src/lib/tools.js =====
/**
 * 提供给模型的长期记忆工具：
 * - memory_search：检索长期记忆
 * - memory_save：主动保存一条值得长期记住的事实
 * - memory_forget：删除一条记忆
 *
 * 使用原始 ctx.tools.register（不依赖 DSH 内部工具包），参数 schema 只使用
 * DSH 支持的 JSON Schema 子集：type/oneOf/properties/required/items/enum/const。
 */


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
                relative: { type: 'string' },
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
          relative: hit.relative ?? '',
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
function registerMemoryTools(service) {
  const ctx = service.ctx
  const tools = [searchTool(service), saveTool(service), forgetTool(service)]
  return tools.map((tool) =>
    ctx.effect(() => ctx.tools.register(tool), `dsh-memory: tool ${tool.name}`),
  )
}
// ===== src/lib/http.js =====
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
 *
 * POST 请求要求自定义头 x-dsh-memory: 1，避免跨站请求伪造（跨域预检会拦下）。
 */


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
function registerHttpRoutes(ctx, service) {
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
  const routes = [
    statusRoute,
    memoriesRoute,
    memoriesDeleteRoute,
    exportRoute,
    testRoute,
    recreateRoute,
    maintenanceRoute,
  ]
  return routes.map((route) => ctx.effect(() => ctx.webServer.register(route), `dsh-memory: route ${route.path}`))
}
// ===== src/index.js =====
/**
 * dsh-memory Host 半（v0.2）：装配长期记忆服务。
 *
 * - 配置：src/lib/config.js（多 provider 档案 + 行为/保留参数，全部 volatile，设置页可改）
 * - 业务：src/lib/service.js（provider 解析 / 嵌入 / Qdrant / 记录 / 召回 / 管理 / 维护）
 * - 自动记录：src/lib/capture.js；自动召回：src/lib/recall.js
 * - 工具：src/lib/tools.js；设置页数据接口：src/lib/http.js
 *
 * 浏览器半在 client.js（设置页 GUI）。
 */








const name = 'dsh-memory'

/** 需要的 Host 服务；缺任意一个时插件保持未激活，而不是报错。 */
const inject = ['tools', 'systemPrompt', 'webServer', 'credentials', 'attachments', 'sessions']


/** 注入系统提示词的长期记忆使用说明。 */
const PROMPT_SECTION = [
  '## 长期记忆',
  '你拥有一个跨会话的持久化长期记忆库（由 dsh-memory 插件提供）。',
  '- 相关历史记忆可能以 source 为 long-term-memory 的上下文消息自动提供给你（通常以【长期记忆·自动召回】开头）。它们只是参考；若与当前对话冲突，以当前对话为准，不要向用户复述“经检索”之类的话。',
  '- 当用户透露值得长期记住的信息（偏好、身份、项目背景、重要决定、常用路径或命令、约定等）时，调用 memory_save 保存。每条记忆应当简洁、自包含（不要用“他/它/这个”等指代），一条一个事实；不要保存密码、密钥等敏感凭据。',
  '- 需要回忆过去的信息时，调用 memory_search 检索。不要凭空编造没有检索到的记忆。',
  '- 用户要求忘记某条记忆时，先用 memory_search 找到 id，再调用 memory_forget 删除。',
  '- 记忆条目会带发生时间（按配置时区显示，可能附相对时间）；自动召回上下文里也可能给出“当前时间”。需要判断信息新旧或做时间推算时，使用这些时间，不要假设当前日期。',
].join('\n')

/** 维护检查定时器间隔（毫秒）：每 5 分钟检查一次是否到维护时间。 */
const MAINTENANCE_TICK_MS = 5 * 60 * 1000

/**
 * @param {object} ctx DSH 插件上下文
 * @param {object} config schemastery Config 实例
 */
function apply(ctx, config) {
  const service = new MemoryService(ctx, config)
  const logger = service.logger

  // 1) 系统提示词说明
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'dsh-memory:instructions',
        order: 2475,
        text: () => PROMPT_SECTION,
      }),
    'dsh-memory: prompt section',
  )

  // 2) 模型工具
  registerMemoryTools(service)

  // 3) 设置页数据接口
  registerHttpRoutes(ctx, service)

  // 4) 自动记录 + 自动召回
  new CaptureController(service).start()
  new RecallController(service).start()

  // 5) 定期维护：启动后延迟执行一次，之后按 maintenanceIntervalHours 触发
  let maintenanceTimer
  let startupTimer
  ctx.effect(() => {
    const tick = () => {
      try {
        const options = service.maintenanceOptions()
        const due =
          service.stats.lastMaintenanceAt === 0 ||
          Date.now() - service.stats.lastMaintenanceAt >= options.maintenanceIntervalHours * 3600 * 1000
        if (!due) return
        service
          .maintenance()
          .then((result) => {
            if (!result.ok) logger.warn?.(`[dsh-memory] 定期维护出现错误：${result.errors.join('; ')}`)
          })
          .catch((error) => logger.warn?.(`[dsh-memory] 定期维护失败：${errorText(error)}`))
      } catch (error) {
        logger.warn?.(`[dsh-memory] 维护定时器异常：${errorText(error)}`)
      }
    }
    startupTimer = setTimeout(tick, 90 * 1000)
    maintenanceTimer = setInterval(tick, MAINTENANCE_TICK_MS)
    return () => {
      clearTimeout(startupTimer)
      clearInterval(maintenanceTimer)
    }
  }, 'dsh-memory: maintenance timer')

  const provider = service.activeProvider()
  logger.info?.(
    `[dsh-memory] 已加载 v0.3.1：provider=${provider.id}（${provider.embedModel}，${provider.dimensions} 维）→ Qdrant ${service.storage().qdrantUrl} / ${service.storage().collection}`,
  )

  // 6) 启动自检：确保 collection 存在（失败只告警，不阻塞 DSH 启动）
  Promise.resolve()
    .then(() => service.ensureReady())
    .then((info) => {
      if (info?.created) logger.info?.(`[dsh-memory] 已创建 Qdrant 集合 ${service.storage().collection}`)
    })
    .catch((error) => {
      logger.warn?.(`[dsh-memory] 启动自检失败：${errorText(error)}`)
    })
}

export { name, inject, Config, apply }
