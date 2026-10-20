/**
 * dsh-memory Host 入口（组合根）：只声明标识/依赖/配置并交给 entry/bootstrap 装配。
 * 具体分层与依赖规则见 docs/ARCHITECTURE.md。
 */
import { Config } from './lib/config/schema.js'
import { applyPlugin } from './lib/entry/bootstrap.js'

export const name = 'dsh-memory'

/** 需要的 Host 服务；缺任意一个时插件保持未激活，而不是报错。 */
export const inject = [
  'tools',
  'systemPrompt',
  'webServer',
  'credentials',
  'attachments',
  'sessions',
  'timer',
  'agents',
  'llm',
  'agentDefaultModel',
]

export { Config }

/**
 * @param {object} ctx DSH 插件上下文
 * @param {object} config schemastery Config 实例
 */
export function apply(ctx, config) {
  applyPlugin(ctx, config)
}
