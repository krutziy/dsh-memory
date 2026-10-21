/**
 * 纯 ID 领域逻辑：内容哈希记忆 point id。
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

