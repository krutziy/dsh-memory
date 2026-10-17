#!/usr/bin/env node
/**
 * dsh-memory Host 半构建脚本。
 *
 * 背景：DSH 的 HMR 在 Node 26 下只会刷新入口模块，入口 import 的本地模块会命中
 * ESM 缓存。为了让「改源码 → 热重载」生效，这里把 src/lib/*.js 与 src/index.js
 * 按拓扑序拼成一个无本地 import 的单文件 index.js（DSH 的 Loader 入口）。
 *
 * 用法：node build.mjs  （写完 src/ 后执行，DSH HMR 会自动重载 index.js）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const src = join(root, 'src')

/** 拼接顺序：被依赖的模块在前。 */
const ORDER = [
  'lib/schemastery.js',
  'lib/util.js',
  'lib/config.js',
  'lib/api-client.js',
  'lib/qdrant.js',
  'lib/service.js',
  'lib/capture.js',
  'lib/recall.js',
  'lib/tools.js',
  'lib/http.js',
  'index.js',
]

/** 去掉相对 import、保留 node: 内建 import、去掉 export 关键字。 */
function transform(code) {
  const nodeImports = []
  let out = code

  // node: 内建 import：收集去重（先处理，避免被相对 import 规则误吞）
  out = out.replace(
    /^import\s+(?:\{[^}]*\}|[^;\n]*?)\s+from\s+['"](node:[^'"\n]+)['"];?[ \t]*$/gm,
    (line) => {
      nodeImports.push(line.trim())
      return ''
    },
  )
  // 相对 import：整条删除（被依赖模块已在前面拼接）
  out = out.replace(
    /^import\s+(?:\{[^}]*\}|[^;\n]*?)\s+from\s+['"](?:\.\/|\.\.\/)[^'"\n]*['"];?[ \t]*$/gm,
    '',
  )
  // export { ... } 语句：删除（最后统一导出）
  out = out.replace(/^export\s*\{[^}]*\}\s*;?[ \t]*$/gm, '')
  // export function/class/const/let/var：去掉 export 关键字
  out = out.replace(/^export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm, '')
  return { code: out.trim(), nodeImports }
}

const header = `// ⚠️ 本文件由 build.mjs 从 src/ 生成，请修改 src/ 下的源码后重新构建。
// 生成命令：node build.mjs
`
const nodeImports = new Set()
const chunks = []
for (const relative of ORDER) {
  const file = join(src, relative)
  const source = readFileSync(file, 'utf8')
  const { code, nodeImports: imports } = transform(source)
  for (const line of imports) nodeImports.add(line)
  chunks.push(`// ===== src/${relative} =====\n${code}`)
}

const output = [
  header,
  ...[...nodeImports].sort(),
  '',
  ...chunks,
  '',
  'export { name, inject, Config, apply }',
  '',
].join('\n')

writeFileSync(join(root, 'index.js'), output)
console.log(`built index.js (${output.length} bytes) from ${ORDER.length} modules`)
