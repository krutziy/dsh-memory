/**
 * 纯时间/时区领域逻辑：不依赖 IO、DSH、Qdrant；所有 "now" 都可显式传入。
 */

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

