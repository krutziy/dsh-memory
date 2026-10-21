/**
 * 记忆片段 / 整理队列的纯领域逻辑（不依赖 IO、DSH、Qdrant）：
 * 层级、批次状态、周/月时间窗、5 位批次编号分配。
 *
 * 设计见 docs/QUEUE.md：事件 = 会话 × 日期；L1 事件片段 → L2 周片段 → L3 长期片段。
 */
import { dayBoundsFromKey, shiftDayKey } from './time.js'

/** 片段层级（0 原始 → 1 事件 → 2 周 → 3 长期）。 */
export const FRAGMENT_LEVELS = [
  { level: 0, key: 'raw', afterDays: 0 },
  { level: 1, key: 'event', afterDays: 7 },
  { level: 2, key: 'week', afterDays: 30 },
  { level: 3, key: 'longterm', afterDays: 0 },
]

/** 批次状态。 */
export const BATCH_STATUS = {
  COLLECTING: 'collecting',
  SEALED: 'sealed',
  RUNNING: 'running',
  WAITING: 'waiting',
  FAILED: 'failed',
  MERGED: 'merged',
  FINAL: 'final',
}

/** 仍然占用编号、出现在“待整理队列”里的状态。 */
export const ACTIVE_BATCH_STATUSES = new Set([
  BATCH_STATUS.COLLECTING,
  BATCH_STATUS.SEALED,
  BATCH_STATUS.RUNNING,
  BATCH_STATUS.WAITING,
  BATCH_STATUS.FAILED,
])

/** 终态：不再压缩，编号已回收。 */
export const TERMINAL_BATCH_STATUSES = new Set([BATCH_STATUS.MERGED, BATCH_STATUS.FINAL])

/** 是否活跃批次（占用编号）。 */
export function isActiveBatch(batch) {
  return Boolean(batch) && ACTIVE_BATCH_STATUSES.has(batch.status)
}

/** 数字补零。 */
function pad(value, width = 2) {
  return String(value).padStart(width, '0')
}

/** 解析 YYYY-MM-DD 为 UTC 日期对象（用于纯日期运算）。 */
function dateFromDayKey(dayKey) {
  const [year, month, day] = String(dayKey).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

/** dayKey 所在周的周一（ISO 周，周一为一周开始）。 */
export function weekKeyOf(dayKey) {
  const date = dateFromDayKey(dayKey)
  const weekday = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - weekday)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** 周所属月份（该周周一的月份，YYYY-MM）。 */
export function monthKeyOfWeek(weekKey) {
  return String(weekKey).slice(0, 7)
}

/** 周起点（周一 00:00，用户时区）。 */
export function weekStartMs(weekKey, timeZone) {
  return dayBoundsFromKey(weekKey, timeZone).from
}

/** 周终点（周日 23:59:59.999，用户时区）。 */
export function weekEndMs(weekKey, timeZone) {
  return dayBoundsFromKey(shiftDayKey(weekKey, 6), timeZone).to
}

/** 月起点（一号 00:00，用户时区）。 */
export function monthStartMs(monthKey, timeZone) {
  return dayBoundsFromKey(`${monthKey}-01`, timeZone).from
}

/** 月终点（月末 23:59:59.999，用户时区）。 */
export function monthEndMs(monthKey, timeZone) {
  const [year, month] = String(monthKey).split('-').map(Number)
  const next = new Date(Date.UTC(year, month, 1))
  const nextKey = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-01`
  return dayBoundsFromKey(nextKey, timeZone).from - 1
}

/** 事件批次稳定键：`2026-10-21#01`；`#misc` 表示手动/无会话片段。 */
export function eventBatchKey(dayKey, seq) {
  if (seq === 'misc') return `${dayKey}#misc`
  return `${dayKey}#${pad(seq)}`
}

/** 5 位编号范围（沿用旧编号空间，便于迁移）。 */
export const BATCH_NO_MIN = 10000
export const BATCH_NO_MAX = 99999

/**
 * 顺序分配一个未占用的 5 位编号（用完回绕，长期运行不会耗尽）。
 * @param {Set<string>|string[]} activeNos 当前占用中的编号
 * @param {number} lastNo 上次分配的数值
 * @returns {{no:string,lastNo:number}} 没有空位时 no 为空字符串
 */
export function allocateBatchNo(activeNos, lastNo) {
  const taken = activeNos instanceof Set ? activeNos : new Set(activeNos ?? [])
  let cursor = Number(lastNo) || 0
  if (!Number.isFinite(cursor) || cursor < BATCH_NO_MIN - 1 || cursor > BATCH_NO_MAX) cursor = BATCH_NO_MIN - 1
  const total = BATCH_NO_MAX - BATCH_NO_MIN + 1
  for (let index = 0; index < total; index += 1) {
    cursor = cursor >= BATCH_NO_MAX ? BATCH_NO_MIN : cursor + 1
    const no = String(cursor)
    if (!taken.has(no)) return { no, lastNo: cursor }
  }
  return { no: '', lastNo: cursor }
}

/** 编号显示（补足 5 位；非法值返回空串）。 */
export function formatBatchNo(no) {
  const text = String(no ?? '').trim()
  return /^\d{1,5}$/.test(text) ? text.padStart(5, '0') : ''
}
