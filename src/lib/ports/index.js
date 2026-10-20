/**
 * 端口（Ports）：domain/app 依赖的抽象能力，由 adapters 实现。
 * 该文件只放 JSDoc 契约（无运行时代码），R2 之后逐步补全。
 *
 * @typedef {Object} MemoryStore
 * @property {(collection:string, points:Array<object>, options?:object)=>Promise<void>} upsert
 * @property {(collection:string, query:object, options?:object)=>Promise<Array<object>>} search
 * @property {(collection:string, options?:object)=>Promise<object>} scroll
 * @property {(collection:string, ids:string[])=>Promise<void>} deletePoints
 *
 * @typedef {Object} ChatModel
 * @property {(options:object)=>Promise<{text:string, usage?:object, latencyMs:number}>} chat
 *
 * @typedef {Object} Clock
 * @property {()=>number} now
 */
export {}
