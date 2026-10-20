#!/usr/bin/env node
/**
 * dsh-memory Host 半构建脚本（v0.7：按依赖图拓扑排序）。
 *
 * DSH 的 HMR 在 Node 26 下只刷新入口模块，入口 import 的本地模块会命中 ESM 缓存。
 * 因此把从 src/index.js 可达的本地模块按拓扑序拼成一个无本地 import 的单文件 index.js。
 *
 * 不再手写 ORDER：从入口递归发现相对 import，依赖在前、入口最后；
 * 若出现循环依赖直接报错，避免“顺序漂移”这类隐性 bug。
 *
 * 用法：node build.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const srcRoot = join(root, 'src')
const entry = join(srcRoot, 'index.js')

/** 从源码中提取相对 import 说明符（也支持副作用 import）。 */
function relativeSpecifiers(code) {
  const specs = []
  for (const match of code.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) specs.push(match[1])
  for (const match of code.matchAll(/^\s*import\s+['"](\.[^'"]+)['"]\s*;?/gm)) specs.push(match[1])
  return [...new Set(specs)]
}

/** 把相对说明符解析成 src 下的真实文件。 */
function resolveLocal(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec)
  const candidates = [base, `${base}.js`, join(base, 'index.js')]
  for (const candidate of candidates) {
    try {
      readFileSync(candidate)
      return candidate
    } catch {
      /* try next */
    }
  }
  throw new Error(`无法解析 import：${spec}（来自 ${fromFile}）`)
}

/** DFS 拓扑：依赖先入栈，入口最后。 */
function collectOrder(entryFile) {
  const order = []
  const visiting = new Set()
  const done = new Set()
  const visit = (file) => {
    if (done.has(file)) return
    if (visiting.has(file)) {
      throw new Error(`检测到循环依赖：${[...visiting, file].map((item) => item.slice(root.length + 1)).join(' → ')}`)
    }
    visiting.add(file)
    const code = readFileSync(file, 'utf8')
    for (const spec of relativeSpecifiers(code)) {
      visit(resolveLocal(file, spec))
    }
    visiting.delete(file)
    done.add(file)
    order.push(file)
  }
  visit(entryFile)
  return order
}

/** 去掉相对 import、保留 node: 内建 import、去掉 export 关键字。 */
function transform(code) {
  const nodeImports = []
  let out = code
  out = out.replace(
    /^import\s+(?:\{[^}]*\}|[^;\n]*?)\s+from\s+['"](node:[^'"\n]+)['"];?[ \t]*$/gm,
    (line) => {
      nodeImports.push(line.trim())
      return ''
    },
  )
  out = out.replace(/^import\s+(?:\{[^}]*\}|[^;\n]*?)\s+from\s+['"](?:\.\/|\.\.\/)[^'"\n]*['"];?[ \t]*$/gm, '')
  out = out.replace(/^\s*import\s+['"](?:\.\/|\.\.\/)[^'"\n]*['"];?[ \t]*$/gm, '')
  out = out.replace(/^export\s*\{[^}]*\}\s*;?[ \t]*$/gm, '')
  out = out.replace(/^export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm, '')
  return { code: out.trim(), nodeImports }
}

const order = collectOrder(entry)
const nodeImportsByName = new Map()
const chunks = []
for (const file of order) {
  const source = readFileSync(file, 'utf8')
  const { code, nodeImports } = transform(source)
  for (const line of nodeImports) {
    const match = /^import\s+\{([^}]*)\}\s+from\s+['"]((?:node:)[^'"]+)['"];?$/.exec(line)
    if (match) {
      const names = nodeImportsByName.get(match[2]) ?? new Set()
      for (const raw of match[1].split(',')) {
        const name = raw.trim()
        if (name) names.add(name)
      }
      nodeImportsByName.set(match[2], names)
    }
  }
  chunks.push(`// ===== src/${file.slice(srcRoot.length + 1)} =====\n${code}`)
}

const header = `// ⚠️ 本文件由 build.mjs 从 src/ 生成（拓扑排序），请修改 src/ 下的源码后重新构建。
// 生成命令：node build.mjs
`
const mergedNodeImports = [...nodeImportsByName.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([specifier, names]) => `import { ${[...names].sort().join(', ')} } from '${specifier}'`)

const output = [
  header,
  ...mergedNodeImports,
  '',
  ...chunks,
  '',
  'export { name, inject, Config, apply }',
  '',
].join('\n')

writeFileSync(join(root, 'index.js'), output)
console.log(`built index.js (${output.length} bytes) from ${order.length} modules`)
console.log(order.map((file) => '  ' + file.slice(srcRoot.length + 1)).join('\n'))
