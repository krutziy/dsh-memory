#!/usr/bin/env node
/**
 * dsh-memory 浏览器半构建：把 src/ui/*.js 按顺序拼进 DSH client factory，
 * 生成单文件 client.js（DSH 只加载 client.js，不支持浏览器侧 import）。
 *
 * 用法：node client-build.mjs
 * 注意：修改 src/ui/ 后需重新构建并刷新设置页（client 不走 host HMR）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const ORDER = ['00-constants.js', '01-controller.js', '02-components.js', '03-locales.js', '04-apply.js']
const body = ORDER.map((file) => {
  const source = readFileSync(join(root, 'src/ui', file), 'utf8').replace(/\s+$/, '')
  return `// ===== src/ui/${file} =====\n${source}`
}).join('\n\n')

const output = `// ⚠️ 本文件由 client-build.mjs 从 src/ui/ 生成，请修改 src/ui/ 下的源码后重新构建。
// 生成命令：node client-build.mjs
window.__ModuleLoader__.load({
  id: 'dsh-memory',
  factory(require) {
    const React = require('react')
    const h = React.createElement

${body}

    return { inject, apply }
  },
})
`
writeFileSync(join(root, 'client.js'), output)
console.log(`built client.js (${output.length} bytes) from ${ORDER.length} modules`)
