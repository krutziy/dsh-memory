/**
 * 加载 DSH 自带的 @deepseek-ai/schemastery。
 *
 * 背景：本插件是「本地目录 + pnpm file: 链接」安装的，Node 会按插件真实路径
 * （/home/ubuntu/mem/dsh-memory）解析 import，看不到 profile 或 dsh 安装目录里的
 * @deepseek-ai/schemastery。这里用同步 require + 候选路径解析，按顺序尝试：
 *   1. 常规解析 @deepseek-ai/schemastery（tarball/真实安装时可用）
 *   2. $DSH_PROFILE_DIR/node_modules/@deepseek-ai/schemastery
 *   3. 从 process.argv[1] 逐级向上找 node_modules/@deepseek-ai/schemastery
 *
 * 只依赖 DSH 已随附的包版本，不引入额外第三方依赖。
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

/** 收集可能的 schemastery 包目录（绝对路径）。 */
function candidateDirs() {
  const dirs = []
  const profileDir = process.env.DSH_PROFILE_DIR
  if (profileDir) dirs.push(join(profileDir, 'node_modules', '@deepseek-ai', 'schemastery'))

  const entry = process.argv[1]
  if (entry) {
    let dir = dirname(entry)
    for (let level = 0; level < 10; level += 1) {
      dirs.push(join(dir, '@deepseek-ai', 'schemastery'))
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return dirs
}

/** 依次尝试加载 schemastery，返回它的默认导出（z）。 */
function loadSchemastery() {
  const errors = []
  const attempts = [() => require('@deepseek-ai/schemastery')]
  for (const dir of candidateDirs()) {
    if (!existsSync(dir)) continue
    attempts.push(() => require(dir))
  }
  for (const attempt of attempts) {
    try {
      const loaded = attempt()
      const z = loaded?.default ?? loaded
      if (typeof z === 'function' && typeof z.object === 'function') return z
      errors.push(new Error('loaded module is not schemastery'))
    } catch (error) {
      errors.push(error)
    }
  }
  throw new Error(
    `dsh-memory: 无法加载 DSH 自带的 @deepseek-ai/schemastery（${errors
      .map((error) => error?.code ?? error?.message ?? String(error))
      .join('; ')}）`,
  )
}

/** schemastery 的默认导出（z）。 */
export const z = loadSchemastery()
