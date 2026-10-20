/**
 * 插件装配（R4 组合根）：只负责把服务/控制器/路由/定时器接起来。
 * index.js 保持为极薄的 Host 入口（name/inject/Config/apply）。
 */
import { ConsolidationEngine } from '../app/consolidation-service.js'
import { MemoryService } from '../app/memory-service.js'
import { errorText } from '../util/index.js'
import { CaptureController } from './capture-controller.js'
import { registerHttpRoutes } from './http/routes.js'
import { startMaintenanceTimer } from './maintenance-timer.js'
import { registerPromptSection } from './prompt.js'
import { RecallController } from './recall-controller.js'
import { SleepController } from './sleep-controller.js'
import { registerMemoryTools } from './tools.js'

/**
 * @param {object} ctx DSH 插件上下文
 * @param {object} config schemastery Config 实例
 */
export function applyPlugin(ctx, config) {
  const service = new MemoryService(ctx, config)
  const logger = service.logger

  // 睡眠整理引擎 + 控制器
  const consolidation = new ConsolidationEngine(service)
  const sleep = new SleepController(service, consolidation)
  service.consolidation = consolidation
  service.sleep = sleep

  registerPromptSection(ctx)
  registerMemoryTools(service)
  registerHttpRoutes(ctx, service)

  // 自动记录 + 自动召回 + 睡眠控制器
  new CaptureController(service).start()
  new RecallController(service).start()
  consolidation.load().catch((error) => logger.warn?.(`[dsh-memory] 读取整理任务列表失败：${errorText(error)}`))
  sleep.start()

  // 定期维护
  startMaintenanceTimer(ctx, service)

  const provider = service.activeProvider()
  logger.info?.(
    `[dsh-memory] 已加载 v0.6.0：provider=${provider.id}（${provider.embedModel}，${provider.dimensions} 维）→ Qdrant ${service.storage().qdrantUrl} / ${service.storage().collection}`,
  )

  // 启动自检：确保 collection 存在，并补齐旧记忆标签（失败只告警）
  Promise.resolve()
    .then(() => service.ensureReady())
    .then((info) => {
      if (info?.created) logger.info?.(`[dsh-memory] 已创建 Qdrant 集合 ${service.storage().collection}`)
      return service.migrateLegacyMemories()
    })
    .catch((error) => {
      logger.warn?.(`[dsh-memory] 启动自检失败：${errorText(error)}`)
    })
}
