/**
 * 通用小工具：配置解包、截断、哈希、UUID、data URI、超时。
 */
import { createHash } from 'node:crypto'
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

/** 计算 sha256 十六进制摘要。 */
export function sha256(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex')
}

/** 由种子生成稳定的 UUID（Qdrant point id 需要 UUID 或整数）。 */
export function memoryPointId(seed) {
  const h = sha256(seed)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
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
// 时区与时间格式化
// ---------------------------------------------------------------------------

/** 常见时区（设置页下拉用；值均为 IANA 名称）。 */
export const TIMEZONES = [
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
export function isValidTimeZone(timeZone) {
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
export function resolveTimeZone(raw, custom) {
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
export function timeZoneOffsetMs(ts, timeZone) {
  if (!timeZone) return -new Date(ts).getTimezoneOffset() * 60000
  const parts = timeZoneParts(ts, timeZone)
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return asUtc - ts
}

/** 指定时区下“某一天 00:00”的 epoch 毫秒（处理 DST 用两次迭代）。 */
export function startOfDayMs(ts, timeZone) {
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
export function formatTimeInZone(ts, timeZone) {
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
export function relativeTime(ts, now = Date.now()) {
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
export function rangeBounds(range, timeZone, now = Date.now()) {
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
export function timeInfo(ts, timeZone, showRelative = true, now = Date.now()) {
  const value = typeof ts === 'number' && Number.isFinite(ts) ? ts : now
  return {
    time: formatTimeInZone(value, timeZone),
    relative: showRelative ? relativeTime(value, now) : '',
  }
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

/** 指定时区下的日期 key：YYYY-MM-DD。 */
export function dayKey(ts, timeZone) {
  const parts = timeZoneParts(typeof ts === 'number' ? ts : Date.now(), timeZone)
  const pad = (n) => String(n).padStart(2, '0')
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

/** 指定时区下某一天的起止 epoch（毫秒）。 */
export function dayBoundsFromKey(key, timeZone) {
  const [year, month, day] = String(key).split('-').map(Number)
  const guess = Date.UTC(year, month - 1, day)
  let offset = timeZoneOffsetMs(guess, timeZone)
  offset = timeZoneOffsetMs(guess - offset, timeZone)
  const from = guess - offset
  return { from, to: from + 86400000 - 1 }
}

/** 指定时间点的时区日边界。 */
export function dayBoundsOf(ts, timeZone) {
  const key = dayKey(ts, timeZone)
  return { key, ...dayBoundsFromKey(key, timeZone) }
}

/** 前一天/后一天的日期 key。 */
export function shiftDayKey(key, deltaDays) {
  const [year, month, day] = String(key).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + deltaDays))
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** 当前本地时间是否已经到达/超过 HH:mm。 */
export function isAtOrAfterTime(hhmm, timeZone, now = Date.now()) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim())
  if (!match) return false
  const target = Number(match[1]) * 60 + Number(match[2])
  const parts = timeZoneParts(now, timeZone)
  const current = parts.hour * 60 + parts.minute
  return current >= target
}

/** 解析 HH:mm，返回分钟数（非法返回 null）。 */
export function parseHhMm(hhmm) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

/** 给人看的时长：1h 2m / 35s。 */
export function formatDuration(ms) {
  const value = Math.max(0, Number(ms) || 0)
  if (value < 1000) return `${Math.round(value)}ms`
  if (value < 60000) return `${Math.round(value / 1000)}s`
  const minutes = Math.floor(value / 60000)
  const seconds = Math.round((value % 60000) / 1000)
  if (minutes < 60) return `${minutes}m ${seconds}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/** 生成一个尚未在 pending 集合里的随机 5 位批次编号。 */
export function nextBatchId(pendingIds) {
  const taken = pendingIds instanceof Set ? pendingIds : new Set(pendingIds ?? [])
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const id = String(10000 + Math.floor(Math.random() * 90000))
    if (!taken.has(id)) return id
  }
  // 极端情况下顺序找空位
  for (let id = 10000; id <= 99999; id += 1) {
    const text = String(id)
    if (!taken.has(text)) return text
  }
  return String(Date.now()).slice(-5)
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
