/**
 * 记忆片段队列的纯领域测试（无需 API / Qdrant）：
 * 周/月时间窗、事件批次键、5 位编号分配与回收、状态判定。
 */
import assert from 'node:assert/strict'
import {
  BATCH_STATUS,
  allocateBatchNo,
  eventBatchKey,
  formatBatchNo,
  isActiveBatch,
  monthEndMs,
  monthKeyOfWeek,
  monthStartMs,
  weekEndMs,
  weekKeyOf,
  weekStartMs,
} from '../src/lib/domain/fragments.js'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`✅ ${name}`)
}

check('weekKeyOf maps any day to its Monday', () => {
  assert.equal(weekKeyOf('2026-10-21'), '2026-10-19')
  assert.equal(weekKeyOf('2026-10-19'), '2026-10-19')
  assert.equal(weekKeyOf('2026-10-25'), '2026-10-19')
  assert.equal(weekKeyOf('2027-01-01'), '2026-12-28')
})

check('monthKeyOfWeek takes the Monday month', () => {
  assert.equal(monthKeyOfWeek('2026-10-19'), '2026-10')
  assert.equal(monthKeyOfWeek('2026-11-02'), '2026-11')
})

check('event batch keys are day#seq and support misc', () => {
  assert.equal(eventBatchKey('2026-10-21', 1), '2026-10-21#01')
  assert.equal(eventBatchKey('2026-10-21', 12), '2026-10-21#12')
  assert.equal(eventBatchKey('2026-10-21', 'misc'), '2026-10-21#misc')
})

check('allocateBatchNo is sequential and skips active numbers', () => {
  assert.deepEqual(allocateBatchNo(new Set(), 0), { no: '10000', lastNo: 10000 })
  assert.deepEqual(allocateBatchNo(new Set(['10001']), 10000), { no: '10002', lastNo: 10002 })
  assert.deepEqual(allocateBatchNo(new Set(['99999']), 99999), { no: '10000', lastNo: 10000 })
})

check('allocateBatchNo wraps and handles full space', () => {
  const result = allocateBatchNo(new Set(['10000', '10002']), 10000)
  assert.equal(result.no, '10001')
  // 编号空间耗尽时返回空字符串，不应崩溃
  const all = new Set()
  for (let no = 10000; no <= 99999; no += 1) all.add(String(no))
  assert.equal(allocateBatchNo(all, 50000).no, '')
})

check('formatBatchNo pads to five digits and rejects garbage', () => {
  assert.equal(formatBatchNo('342'), '00342')
  assert.equal(formatBatchNo(12345), '12345')
  assert.equal(formatBatchNo(''), '')
  assert.equal(formatBatchNo('abc'), '')
})

check('only active statuses occupy a number', () => {
  assert.equal(isActiveBatch({ status: BATCH_STATUS.COLLECTING }), true)
  assert.equal(isActiveBatch({ status: BATCH_STATUS.WAITING }), true)
  assert.equal(isActiveBatch({ status: BATCH_STATUS.FAILED }), true)
  assert.equal(isActiveBatch({ status: BATCH_STATUS.MERGED }), false)
  assert.equal(isActiveBatch({ status: BATCH_STATUS.FINAL }), false)
  assert.equal(isActiveBatch(null), false)
})

check('week/month windows respect the user time zone', () => {
  const weekStart = weekStartMs('2026-10-19', 'Asia/Shanghai')
  const weekEnd = weekEndMs('2026-10-19', 'Asia/Shanghai')
  assert.equal(new Date(weekStart).toISOString(), '2026-10-18T16:00:00.000Z') // 周一 00:00 +08
  assert.equal(new Date(weekEnd).toISOString(), '2026-10-25T15:59:59.999Z') // 周日 23:59:59.999 +08
  const monthStart = monthStartMs('2026-10', 'Asia/Shanghai')
  const monthEnd = monthEndMs('2026-10', 'Asia/Shanghai')
  assert.equal(new Date(monthStart).toISOString(), '2026-09-30T16:00:00.000Z') // 10-01 00:00 +08
  assert.equal(new Date(monthEnd).toISOString(), '2026-10-31T15:59:59.999Z') // 10-31 23:59:59.999 +08
})

console.log(`\n结果：${passed} passed, 0 failed`)
