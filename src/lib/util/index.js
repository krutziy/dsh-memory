/**
 * 通用小工具：配置解包、截断、哈希、UUID、data URI、超时。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 配置字段可能是 volatile 包装（Ref），统一解包。 */
export function val(value) {
  if (value && typeof value.get === 'function') return value.get()
  return value
}

/** 把 @deepseek-ai/schemastery 的 Config 实例解包成普通对象。 */
export function readConfig(config) {
  const out = {}
  if (config === null || typeof config !== 'object') return out
  for (const key of Object.keys(config)) out[key] = val(config[key])
  return out
}

/** 读取配置值，undefined/null 时回退。 */
export function cfgValue(config, key, fallback) {
  const v = val(config?.[key])
  return v === undefined || v === null ? fallback : v
}

/** 去掉 URL 末尾斜杠。 */
export function normalizeUrl(url) {
  const text = String(url ?? '').trim()
  return text.replace(/\/+$/, '')
}

/** 去掉首尾空白并压缩多余空白，保留换行。 */
export function cleanText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 截断到 max 个字符（max<=0 视为不截断）。 */
export function truncate(text, max) {
  const value = String(text ?? '')
  if (!max || max <= 0 || value.length <= max) return value
  return value.slice(0, Math.max(0, max - 1)).trimEnd() + '…'
}

/** Uint8Array → data URI（硅基流动图片输入要求 data URI 或可访问 URL）。 */
export function toDataUri(bytes, mediaType) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  return `data:${mediaType || 'image/png'};base64,${buffer.toString('base64')}`
}

/** 本地时间字符串，形如 2026-10-17 11:22。 */
export function formatTime(ts) {
  const value = typeof ts === 'number' && Number.isFinite(ts) ? ts : Date.now()
  const d = new Date(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 把任意错误转成可读文本。 */
export function errorText(error) {
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
export function redactSecrets(text) {
  let out = String(text ?? '')
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, prefix) => (typeof prefix === 'string' && prefix !== '' ? prefix + '[已脱敏]' : '[已脱敏]'))
  }
  return out
}

/** 简单并发安全队列：串行执行，失败只记录不打断后续任务。 */
export class SerialQueue {
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
export function providerIdToEnv(id) {
  const text = String(id ?? '')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
  return (text || 'CUSTOM') + '_API_KEY'
}

/** 取整并夹在范围内。 */
export function clampInt(value, fallback, min, max) {
  const number = Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback
  return Math.min(max, Math.max(min, number))
}

/** 取浮点数并夹在范围内。 */
export function clampNumber(value, fallback, min, max) {
  const number = Number.isFinite(Number(value)) ? Number(value) : fallback
  return Math.min(max, Math.max(min, number))
}

/** 宽松解析布尔。 */
export function asBool(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1 || value === '1') return true
  if (value === 'false' || value === 0 || value === '0') return false
  return fallback
}

// ---------------------------------------------------------------------------
// 文件 / 任务批次 / 日程时间辅助
// ---------------------------------------------------------------------------

/** DSH harness home（默认 ~/.dsh）。 */
export function dshHome() {
  const env = process.env.DSH_HOME
  if (env && env.trim()) return env.trim()
  const home = process.env.HOME || '/root'
  return join(home, '.dsh')
}

/** 读取 JSON 文件；不存在或损坏时返回 fallback。 */
export function readJsonFile(path, fallback) {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

/** 原子写入 JSON 文件（先写临时文件再 rename）。 */
export function writeJsonFileAtomic(path, value) {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, path)
}

/** 把条目列表按字符预算切成若干块。 */
export function chunkByChars(items, maxChars, render) {
  const chunks = []
  let current = []
  let size = 0
  for (const item of items) {
    const text = render ? render(item) : String(item)
    if (size + text.length > maxChars && current.length > 0) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(item)
    size += text.length + 1
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/** 从模型输出中提取 JSON（容忍 ```json 围栏与前后说明文字）。 */
export function extractJson(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)
  const candidate = fenced ? fenced[1].trim() : raw
  try {
    return JSON.parse(candidate)
  } catch {
    /* continue */
  }
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch {
      return null
    }
  }
  return null
}

/** 截断长文本列表的渲染文本到预算。 */
export function renderMemoryLines(items, maxChars, formatter) {
  const lines = []
  let size = 0
  for (const item of items) {
    const line = formatter ? formatter(item) : String(item)
    if (size + line.length > maxChars && lines.length > 0) break
    lines.push(line)
    size += line.length + 1
  }
  return lines.join('\n')
}
