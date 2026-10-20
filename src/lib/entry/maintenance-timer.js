/**
 * 定期维护定时器（入口层）：启动后 90 秒检查一次，之后每 5 分钟检查是否到期。
 * @param {object} ctx
 * @param {import('../app/memory-service.js').MemoryService} service
 */
import { errorText } from '../util/index.js'

export const MAINTENANCE_TICK_MS = 5 * 60 * 1000

export function startMaintenanceTimer(ctx, service) {
  const logger = service.logger
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
}
