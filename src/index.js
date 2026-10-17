/**
 * dsh-memory Host 半（v0.2）：装配长期记忆服务。
 *
 * - 配置：src/lib/config.js（多 provider 档案 + 行为/保留参数，全部 volatile，设置页可改）
 * - 业务：src/lib/service.js（provider 解析 / 嵌入 / Qdrant / 记录 / 召回 / 管理 / 维护）
 * - 自动记录：src/lib/capture.js；自动召回：src/lib/recall.js
 * - 工具：src/lib/tools.js；设置页数据接口：src/lib/http.js
 *
 * 浏览器半在 client.js（设置页 GUI）。
 */
import { Config } from './lib/config.js'
import { CaptureController } from './lib/capture.js'
import { registerHttpRoutes } from './lib/http.js'
import { RecallController } from './lib/recall.js'
import { MemoryService } from './lib/service.js'
import { registerMemoryTools } from './lib/tools.js'
import { errorText } from './lib/util.js'

export const name = 'dsh-memory'

/** 需要的 Host 服务；缺任意一个时插件保持未激活，而不是报错。 */
export const inject = ['tools', 'systemPrompt', 'webServer', 'credentials', 'attachments']

export { Config }

/** 注入系统提示词的长期记忆使用说明。 */
const PROMPT_SECTION = [
  '## 长期记忆',
  '你拥有一个跨会话的持久化长期记忆库（由 dsh-memory 插件提供）。',
  '- 相关历史记忆可能以 source 为 long-term-memory 的上下文消息自动提供给你（通常以【长期记忆·自动召回】开头）。它们只是参考；若与当前对话冲突，以当前对话为准，不要向用户复述“经检索”之类的话。',
  '- 当用户透露值得长期记住的信息（偏好、身份、项目背景、重要决定、常用路径或命令、约定等）时，调用 memory_save 保存。每条记忆应当简洁、自包含（不要用“他/它/这个”等指代），一条一个事实；不要保存密码、密钥等敏感凭据。',
  '- 需要回忆过去的信息时，调用 memory_search 检索。不要凭空编造没有检索到的记忆。',
  '- 用户要求忘记某条记忆时，先用 memory_search 找到 id，再调用 memory_forget 删除。',
].join('\n')

/** 维护检查定时器间隔（毫秒）：每 5 分钟检查一次是否到维护时间。 */
const MAINTENANCE_TICK_MS = 5 * 60 * 1000

/**
 * @param {object} ctx DSH 插件上下文
 * @param {object} config schemastery Config 实例
 */
export function apply(ctx, config) {
  const service = new MemoryService(ctx, config)
  const logger = service.logger

  // 1) 系统提示词说明
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'dsh-memory:instructions',
        order: 2475,
        text: () => PROMPT_SECTION,
      }),
    'dsh-memory: prompt section',
  )

  // 2) 模型工具
  registerMemoryTools(service)

  // 3) 设置页数据接口
  registerHttpRoutes(ctx, service)

  // 4) 自动记录 + 自动召回
  new CaptureController(service).start()
  new RecallController(service).start()

  // 5) 定期维护：启动后延迟执行一次，之后按 maintenanceIntervalHours 触发
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

  const provider = service.activeProvider()
  logger.info?.(
    `[dsh-memory] 已加载 v0.2：provider=${provider.id}（${provider.embedModel}，${provider.dimensions} 维）→ Qdrant ${service.storage().qdrantUrl} / ${service.storage().collection}`,
  )

  // 6) 启动自检：确保 collection 存在（失败只告警，不阻塞 DSH 启动）
  Promise.resolve()
    .then(() => service.ensureReady())
    .then((info) => {
      if (info?.created) logger.info?.(`[dsh-memory] 已创建 Qdrant 集合 ${service.storage().collection}`)
    })
    .catch((error) => {
      logger.warn?.(`[dsh-memory] 启动自检失败：${errorText(error)}`)
    })
}
