/**
 * 纯 ID 领域逻辑：内容哈希记忆 id、5 位批次号。
 */
import { createHash } from 'node:crypto'

/** 计算 sha256 十六进制摘要。 */
export function sha256(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex')
}

/** 由种子生成稳定的 UUID（Qdrant point id 需要 UUID 或整数）。 */
export function memoryPointId(seed) {
  const h = sha256(seed)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
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

