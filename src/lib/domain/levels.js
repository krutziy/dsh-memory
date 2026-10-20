/**
 * 巩固层级定义（domain 常量）：L1 按天、L2 7 天、L3 30 天。
 * 保留条数上限仅在配置开启时使用；模型默认自行决定条数。
 */
export const CONSOLIDATION_LEVELS = [
  { level: 1, afterDays: 0, maxItemsWhenLimited: 40 },
  { level: 2, afterDays: 7, maxItemsWhenLimited: 20 },
  { level: 3, afterDays: 30, maxItemsWhenLimited: 10 },
]

/** 某级别在开启上限时的输出上限；未开启返回 null。 */
export function levelMaxItems(level, limitEnabled) {
  if (!limitEnabled) return null
  const stage = CONSOLIDATION_LEVELS.find((item) => item.level === level)
  return stage ? stage.maxItemsWhenLimited : null
}
