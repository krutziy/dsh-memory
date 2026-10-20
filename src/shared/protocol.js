/**
 * Host 与 client 共用的协议常量（单一事实源）。
 * 目前 host 直接 import；client 侧在 R5 模块化构建时复用同一份常量。
 */
export const PLUGIN_ID = 'dsh-memory'
export const API_PREFIX = '/__dsh_memory__/'
export const POST_HEADER = 'x-dsh-memory'
export const POST_HEADER_VALUE = '1'
export const MEMORY_SOURCE = 'long-term-memory'
export const SLEEP_SOURCE = 'dsh-memory-sleep'
export const WAKE_SOURCE = 'dsh-memory-wake'
