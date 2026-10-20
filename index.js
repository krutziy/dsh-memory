// ⚠️ 本文件由 build.mjs 从 src/ 生成（拓扑排序），请修改 src/ 下的源码后重新构建。
// 生成命令：node build.mjs

import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// ===== src/lib/config/schemastery.js =====
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
const z = loadSchemastery()
// ===== src/lib/config/schema.js =====
/**
 * dsh-memory 插件配置（v0.2）。
 *
 * 所有用户可调项都声明为 `.volatile()`，DSH 的 Settings 服务会把它们投影成
 * 可编辑表单，设置页通过 ctx.configForms 读写，保存后热生效。
 *
 * v0.2 起支持多 provider 档案：providers 是整棵被标记 volatile 的数组，
 * 设置页可以增删改、切换 activeProvider；不再绑定硅基流动。
 */


/** 常用嵌入维度档位（不同模型支持范围不同，这里作为提示）。 */
const DIMENSIONS = [256, 512, 768, 1024, 1536, 2048, 2560, 3072, 4096]

/** 图片记忆方式。 */
const IMAGE_MODES = ['caption', 'placeholder', 'off']

/** 记忆范围。 */
const SCOPE_MODES = ['global', 'workspace', 'session']

/** 单个 provider 档案的字段结构（同时用于客户端预设与校验）。 */
const PROVIDER_FIELDS = [
  'id',
  'name',
  'protocol',
  'baseUrl',
  'embedModel',
  'dimensions',
  'apiKeyEnv',
  'sendDimensions',
  'visionModel',
  'visionBaseUrl',
  'visionApiKeyEnv',
]

const Config = z.object({
  // -------------------- 多 provider 档案 --------------------
  providers: z
    .array(
      z.object({
        id: z.string().required().description('唯一标识（英文/数字/下划线），如 siliconflow'),
        name: z.string().default('').description('显示名称，如 硅基流动'),
        protocol: z
          .string()
          .default('openai')
          .description('接口协议；目前支持 OpenAI 兼容的 /embeddings 与 /chat/completions'),
        baseUrl: z.string().required().description('API Base URL，如 https://api.siliconflow.cn/v1'),
        embedModel: z.string().required().description('嵌入模型名称'),
        dimensions: z.number().default(1024).step(1).description('向量维度（需与 Qdrant 集合一致）'),
        apiKeyEnv: z
          .string()
          .default('')
          .description('该 Base URL 对应的 Key 在 DSH 凭据库中的引用名；留空则用 <ID>_API_KEY'),
        sendDimensions: z
          .boolean()
          .default(true)
          .description('请求嵌入接口时是否发送 dimensions 参数（部分服务不支持时关掉）'),
        visionModel: z
          .string()
          .default('')
          .description('图片概览使用的视觉对话模型；留空则图片只记占位'),
        visionBaseUrl: z.string().default('').description('视觉接口 Base URL；留空与 baseUrl 相同'),
        visionApiKeyEnv: z.string().default('').description('视觉接口 Key 引用名；留空与 apiKeyEnv 相同'),
      }),
    )
    .default([])
    .volatile()
    .description('provider 档案列表（可保存多套云端服务商配置）'),
  activeProvider: z
    .string()
    .default('')
    .volatile()
    .description('当前激活的 provider id；留空使用列表中的第一个'),

  // -------------------- 向量库 --------------------
  qdrantUrl: z
    .string()
    .default('http://127.0.0.1:6333')
    .volatile()
    .description('Qdrant HTTP 地址；插件与 Qdrant 同机时保持 127.0.0.1'),
  collection: z.string().default('dsh_memory').volatile().description('Qdrant collection 名称'),
  qdrantApiKeyEnv: z
    .string()
    .default('')
    .volatile()
    .description('Qdrant API Key 的凭据引用名；留空表示无鉴权（本机回环推荐）'),

  // -------------------- 自动记录 --------------------
  autoCapture: z
    .boolean()
    .default(true)
    .volatile()
    .description('每轮对话结束后，自动把“用户要点 + 助手回答要点”存入长期记忆'),
  captureUserChars: z
    .number()
    .default(400)
    .step(1)
    .min(0)
    .volatile()
    .description('自动记录时用户内容的最大保留字符数'),
  captureAssistantChars: z
    .number()
    .default(400)
    .step(1)
    .min(0)
    .volatile()
    .description('自动记录时助手回答的最大保留字符数'),
  captureMinChars: z
    .number()
    .default(12)
    .step(1)
    .min(0)
    .volatile()
    .description('一轮内容少于该字符数时不记录（过滤“好的/谢谢”等噪音）'),
  includeSubagents: z
    .boolean()
    .default(false)
    .volatile()
    .description('是否也记录子代理（subagent）会话的要点'),

  // -------------------- 自动召回 --------------------
  autoRecall: z
    .boolean()
    .default(true)
    .volatile()
    .description('每轮开始时自动检索相关长期记忆并注入上下文'),
  memoryScope: z
    .union([z.const('global'), z.const('workspace'), z.const('session')])
    .default('global')
    .volatile()
    .description('记忆范围：global=全局共享；workspace=按工作目录隔离；session=按会话隔离'),
  recallTopK: z
    .number()
    .default(3)
    .step(1)
    .min(1)
    .max(20)
    .volatile()
    .description('自动召回的条目数（1-20）'),
  recallMinScore: z
    .number()
    .default(0.42)
    .step(0.01)
    .min(0)
    .max(1)
    .volatile()
    .description('自动召回的最低相关度（0-1，越高越严格）'),
  recallMaxChars: z
    .number()
    .default(600)
    .step(1)
    .min(100)
    .max(4000)
    .volatile()
    .description('自动召回内容注入上下文时的最大字符数'),
  recallIncludeCurrentSession: z
    .boolean()
    .default(false)
    .volatile()
    .description('自动召回时是否包含当前会话自身的记忆'),
  recallTimeoutMs: z
    .number()
    .default(3000)
    .step(100)
    .min(500)
    .max(20000)
    .volatile()
    .description('自动召回的超时时间（毫秒）；超时则本轮跳过召回'),

  // -------------------- 动态相关度召回（实验） --------------------
  recallAgeGateEnabled: z
    .boolean()
    .default(true)
    .volatile()
    .description('启用动态相关度门槛（越久越严格）；关闭=旧的固定阈值行为，可一键回滚'),
  recallStrictness: z
    .number()
    .default(0.35)
    .step(0.01)
    .min(0)
    .max(1)
    .volatile()
    .description('自动召回时“越久越严格”的强度（0=旧行为，越大旧记忆越难召回）'),
  recallMaxRequired: z
    .number()
    .default(0.9)
    .step(0.01)
    .min(0.1)
    .max(1)
    .volatile()
    .description('动态门槛的上限，防止老记忆永远召不回'),
  recallWeightImportance: z
    .number()
    .default(0.2)
    .step(0.01)
    .min(0)
    .max(1)
    .volatile()
    .description('importance（重要性）对召回的补偿权重'),
  recallWeightRehearsal: z
    .number()
    .default(0.15)
    .step(0.01)
    .min(0)
    .max(1)
    .volatile()
    .description('有效复述对召回的补偿权重'),
  recallWeightConfidence: z
    .number()
    .default(0.1)
    .step(0.01)
    .min(0)
    .max(1)
    .volatile()
    .description('confidence（置信度）对召回的补偿权重'),
  recallToolBaseMinScore: z
    .number()
    .default(0.3)
    .step(0.01)
    .min(0)
    .max(1)
    .volatile()
    .description('工具检索（memory_search）的基础门槛；比自动召回宽松'),
  recallToolStrictness: z
    .number()
    .default(0.2)
    .step(0.01)
    .min(0)
    .max(1)
    .volatile()
    .description('工具检索的“越久越严格”强度'),
  recallDecayTauL0: z
    .number()
    .default(7)
    .step(1)
    .min(1)
    .max(10000)
    .volatile()
    .description('原始记忆（L0）的遗忘时间常数 τ（天）'),
  recallDecayTauL1: z
    .number()
    .default(30)
    .step(1)
    .min(1)
    .max(10000)
    .volatile()
    .description('日摘要（L1）的遗忘时间常数 τ（天）'),
  recallDecayTauL2: z
    .number()
    .default(180)
    .step(1)
    .min(1)
    .max(10000)
    .volatile()
    .description('周摘要（L2）的遗忘时间常数 τ（天）'),
  recallDecayTauL3: z
    .number()
    .default(365)
    .step(1)
    .min(1)
    .max(10000)
    .volatile()
    .description('长期摘要（L3）的遗忘时间常数 τ（天）'),
  recallRehearsalTauDays: z
    .number()
    .default(90)
    .step(1)
    .min(1)
    .max(10000)
    .volatile()
    .description('有效复述事件的记忆效力衰减时间（天）'),
  recallRehearsalMaxEvents: z
    .number()
    .default(20)
    .step(1)
    .min(1)
    .max(100)
    .volatile()
    .description('每条记忆保留的复述事件上限'),
  recallNaturalRepeatEnabled: z
    .boolean()
    .default(true)
    .volatile()
    .description('写入时检测“用户再次提及相同事实”并计入自然复述（默认开）'),
  recallNaturalRepeatThreshold: z
    .number()
    .default(0.85)
    .step(0.01)
    .min(0.5)
    .max(1)
    .volatile()
    .description('自然复述检测的相似度阈值'),
  recallCandidates: z
    .number()
    .default(20)
    .step(1)
    .min(3)
    .max(100)
    .volatile()
    .description('动态门控前的候选数量（先宽后严）'),

  // -------------------- 时间与时区 --------------------
  timezone: z
    .string()
    .default('')
    .volatile()
    .description('时间显示时区：留空=跟随服务器本地；可选常见 IANA 时区，或 custom 自定义'),
  timezoneCustom: z
    .string()
    .default('')
    .volatile()
    .description('自定义 IANA 时区（当 timezone=custom 时生效），如 America/New_York'),
  injectCurrentTime: z
    .boolean()
    .default(true)
    .volatile()
    .description('自动召回时在上下文里附带“当前时间”（按所选时区），便于模型判断记忆的新旧'),
  relativeTime: z
    .boolean()
    .default(true)
    .volatile()
    .description('召回/列表中显示相对时间（如“3 天前”）'),

  // -------------------- 图片 --------------------
  captionSource: z
    .string()
    .default('dsh')
    .volatile()
    .description('图片概览模型来源：dsh=直接使用 DSH 已配置的模型；custom=使用插件自定义 provider'),
  captionDshProvider: z
    .string()
    .default('')
    .volatile()
    .description('DSH 图片概览使用的 provider；留空使用 DSH 默认模型'),
  captionDshModel: z
    .string()
    .default('')
    .volatile()
    .description('DSH 图片概览使用的模型；留空使用 DSH 默认模型（需支持图片输入）'),
  captionProviderId: z
    .string()
    .default('')
    .volatile()
    .description('图片概览使用的 provider id；留空跟随当前激活 provider'),
  captionModel: z
    .string()
    .default('')
    .volatile()
    .description('图片概览使用的视觉模型；留空使用该 provider 的 visionModel 配置'),
  imageMode: z
    .union([z.const('caption'), z.const('placeholder'), z.const('off')])
    .default('caption')
    .volatile()
    .description('图片记忆方式：caption=生成一句话概览后只存描述；placeholder=只记“发过图”；off=忽略图片'),
  captionPrompt: z
    .string()
    .default('')
    .volatile()
    .description('图片概览的提示词；留空使用内置默认提示词'),
  captionMaxTokens: z
    .number()
    .default(96)
    .step(1)
    .min(16)
    .max(1024)
    .volatile()
    .description('图片概览生成的最大 token 数'),

  // -------------------- 工具 --------------------
  toolsEnabled: z
    .boolean()
    .default(true)
    .volatile()
    .description('是否允许模型使用 memory_search / memory_save / memory_forget 工具'),
  toolSearchLimit: z
    .number()
    .default(5)
    .step(1)
    .min(1)
    .max(20)
    .volatile()
    .description('memory_search 的默认返回条数（1-20）'),

  // -------------------- 定期维护 / 保留策略 --------------------
  retentionDays: z
    .number()
    .default(0)
    .step(1)
    .min(0)
    .volatile()
    .description('记忆保留天数（0=永久保留）；超期记忆在定期维护时删除'),
  maxMemories: z
    .number()
    .default(0)
    .step(1)
    .min(0)
    .volatile()
    .description('记忆条数上限（0=不限）；超限时定期维护淘汰最旧的记录'),
  maintenanceIntervalHours: z
    .number()
    .default(6)
    .step(1)
    .min(1)
    .max(168)
    .volatile()
    .description('自动维护的间隔小时数'),
  maintenanceDedupe: z
    .boolean()
    .default(true)
    .volatile()
    .description('维护时对高度相似的重复记忆做合并（保留较新的一条）'),
  dedupeThreshold: z
    .number()
    .default(0.96)
    .step(0.01)
    .min(0.8)
    .max(1)
    .volatile()
    .description('重复记忆合并的相似度阈值（0.8-1，越高越保守）'),
  dedupeMaxScan: z
    .number()
    .default(100)
    .step(10)
    .min(10)
    .max(1000)
    .volatile()
    .description('每次维护最多检查多少条最近记忆以寻找重复'),

  // -------------------- 睡眠整理 / 记忆巩固 --------------------
  consolidationEnabled: z
    .boolean()
    .default(false)
    .volatile()
    .description('开启“睡眠整理”：按天压缩原始记忆，并按任务列表在 7/30 天后继续压缩（默认关闭）'),
  sleepAt: z
    .string()
    .default('00:00')
    .volatile()
    .description('睡眠开始时间 HH:mm（按所选时区；默认 00:00）'),
  sleepRetryMinutes: z
    .number()
    .default(15)
    .step(1)
    .min(1)
    .max(240)
    .volatile()
    .description('用户忙碌时每隔多少分钟重试入睡'),
  idleMinutes: z
    .number()
    .default(60)
    .step(1)
    .min(1)
    .max(1440)
    .volatile()
    .description('最近多少分钟内没有人类消息、且没有运行中的会话，才算空闲可以睡'),
  consolidationSource: z
    .string()
    .default('dsh')
    .volatile()
    .description('整理模型来源：dsh=直接使用 DSH 已配置的模型；custom=使用插件自定义 provider'),
  consolidationDshProvider: z
    .string()
    .default('')
    .volatile()
    .description('DSH 模型来源时使用的 provider；留空使用 DSH 默认模型'),
  consolidationDshModel: z
    .string()
    .default('')
    .volatile()
    .description('DSH 模型来源时使用的模型；留空使用 DSH 默认模型'),
  consolidationLimitItems: z
    .boolean()
    .default(false)
    .volatile()
    .description('是否限制每级整理输出的条数（默认关闭，由模型决定；开启后使用内部安全上限）'),
  consolidationProviderId: z
    .string()
    .default('')
    .volatile()
    .description('整理模型使用的 provider id；留空表示使用当前激活 provider'),
  consolidationModel: z
    .string()
    .default('Qwen/Qwen2.5-7B-Instruct')
    .volatile()
    .description('整理（摘要/提炼）使用的对话模型；留空或调用失败时回退纯规则整理'),
  consolidationInputMaxChars: z
    .number()
    .default(12000)
    .step(100)
    .min(1000)
    .max(200000)
    .volatile()
    .description('单个批次最多送入模型的字符数（超出会分块映射后再合并）'),
  consolidationPrompt: z
    .string()
    .default('')
    .volatile()
    .description('整理提示词；留空使用内置提示词'),

  // -------------------- 实验性功能 --------------------
  experimentalEventMergeEnabled: z
    .boolean()
    .default(false)
    .volatile()
    .description('实验性：整理时用嵌入向量在库中检索相似/同事件记忆，只把相关簇交给模型合并（默认关闭）'),
  experimentalEventMergeThreshold: z
    .number()
    .default(0.85)
    .step(0.01)
    .min(0.5)
    .max(1)
    .volatile()
    .description('事件合并的相似度阈值'),
  experimentalEventMergeMaxCandidates: z
    .number()
    .default(30)
    .step(1)
    .min(1)
    .max(200)
    .volatile()
    .description('事件合并每次最多带入多少条相关记忆作为参考'),
  experimentalEnhancementEnabled: z
    .boolean()
    .default(false)
    .volatile()
    .description('实验性：额外保留整理后的 1 级记忆若干天，不再继续整理，仅供事件召回/按需搜索使用'),
  experimentalEnhancementDays: z
    .number()
    .default(7)
    .step(1)
    .min(1)
    .max(365)
    .volatile()
    .description('增强记忆的保留天数（到期自动删除）'),

  // -------------------- 其他 --------------------
  debug: z.boolean().default(false).volatile().description('在 DSH 日志中输出插件调试信息'),
})
// ===== src/lib/domain/ids.js =====
/**
 * 纯 ID 领域逻辑：内容哈希记忆 id、5 位批次号。
 */


/** 计算 sha256 十六进制摘要。 */
function sha256(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex')
}

/** 由种子生成稳定的 UUID（Qdrant point id 需要 UUID 或整数）。 */
function memoryPointId(seed) {
  const h = sha256(seed)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** 生成一个尚未在 pending 集合里的随机 5 位批次编号。 */
function nextBatchId(pendingIds) {
  const taken = pendingIds instanceof Set ? pendingIds : new Set(pendingIds ?? [])
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const id = String(10000 + Math.floor(Math.random() * 90000))
    if (!taken.has(id)) return id
  }
  // 极端情况下顺序找空位
  for (let id = 10000; id <= 99999; id += 1) {
    const text = String(id)
    if (!taken.has(text)) return text
  }
  return String(Date.now()).slice(-5)
}
// ===== src/lib/domain/memory-values.js =====
/**
 * 记忆的“编码强度”与“可信度”规则（domain，纯函数）。
 * importance：编码时的重要性（显式保存 > 偏好/事实 > 闲聊）
 * confidence：这条信念的可信度（用户明确 > 抽取事实 > 普通对话）
 */
const IMPORTANCE_BY_KIND = {
  preference: 0.8,
  fact: 0.75,
  project: 0.75,
  note: 0.6,
  event: 0.8,
  summary: 0.65,
  image: 0.5,
  turn: 0.4,
}

const CONFIDENCE_BY_KIND = {
  preference: 0.8,
  fact: 0.8,
  project: 0.75,
  note: 0.7,
  event: 0.7,
  summary: 0.7,
  image: 0.7,
  turn: 0.6,
}

/** 默认重要性（0~1）。 */
function defaultImportance(kind) {
  return IMPORTANCE_BY_KIND[String(kind ?? '')] ?? 0.5
}

/** 默认置信度（0~1）。 */
function defaultConfidence(kind) {
  return CONFIDENCE_BY_KIND[String(kind ?? '')] ?? 0.6
}

/** 把任意值规范到 0~1，非法时回退。 */
function normalizeUnit(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

/** 规范 importance（缺省按 kind 推断）。 */
function normalizeImportance(value, kind) {
  return normalizeUnit(value, defaultImportance(kind))
}

/** 规范 confidence（缺省按 kind 推断）。 */
function normalizeConfidence(value, kind) {
  return normalizeUnit(value, defaultConfidence(kind))
}

/** 显式保存的编码强度。 */
const MANUAL_SAVE = { importance: 1, confidence: 0.9 }
// ===== src/lib/domain/levels.js =====
/**
 * 巩固层级定义（domain 常量）：L1 按天、L2 7 天、L3 30 天。
 * 保留条数上限仅在配置开启时使用；模型默认自行决定条数。
 */
const CONSOLIDATION_LEVELS = [
  { level: 1, afterDays: 0, maxItemsWhenLimited: 40 },
  { level: 2, afterDays: 7, maxItemsWhenLimited: 20 },
  { level: 3, afterDays: 30, maxItemsWhenLimited: 10 },
]

/** 某级别在开启上限时的输出上限；未开启返回 null。 */
function levelMaxItems(level, limitEnabled) {
  if (!limitEnabled) return null
  const stage = CONSOLIDATION_LEVELS.find((item) => item.level === level)
  return stage ? stage.maxItemsWhenLimited : null
}
// ===== src/lib/domain/time.js =====
/**
 * 纯时间/时区领域逻辑：不依赖 IO、DSH、Qdrant；所有 "now" 都可显式传入。
 */

// ---------------------------------------------------------------------------
// 时区与时间格式化
// ---------------------------------------------------------------------------

/** 常见时区（设置页下拉用；值均为 IANA 名称）。 */
const TIMEZONES = [
  '',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Asia/Bangkok',
  'Asia/Kolkata',
  'Asia/Dubai',
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Perth',
  'Australia/Sydney',
  'Pacific/Auckland',
]

/** 校验 IANA 时区是否合法；非法返回 false。 */
function isValidTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== 'string') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date())
    return true
  } catch {
    return false
  }
}

/**
 * 解析配置里的时区：'' 表示跟随服务器本地；'custom' 读取自定义输入；
 * 非法值回退到服务器本地（返回 undefined）。
 * @returns {string|undefined} 合法 IANA 时区，或 undefined（服务器本地）
 */
function resolveTimeZone(raw, custom) {
  const value = String(raw ?? '').trim()
  if (value === 'custom') {
    const customValue = String(custom ?? '').trim()
    return isValidTimeZone(customValue) ? customValue : undefined
  }
  if (value === '') return undefined
  return isValidTimeZone(value) ? value : undefined
}

/** 取某个时间点在指定时区下的日期/时间分量。 */
function timeZoneParts(ts, timeZone) {
  if (!timeZone) {
    const date = new Date(ts)
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
    }
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = {}
  for (const part of formatter.formatToParts(new Date(ts))) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

/** 指定时区相对 UTC 的偏移（毫秒）。 */
function timeZoneOffsetMs(ts, timeZone) {
  if (!timeZone) return -new Date(ts).getTimezoneOffset() * 60000
  const parts = timeZoneParts(ts, timeZone)
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return asUtc - ts
}

/** 指定时区下“某一天 00:00”的 epoch 毫秒（处理 DST 用两次迭代）。 */
function startOfDayMs(ts, timeZone) {
  const parts = timeZoneParts(ts, timeZone)
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day)
  let offset = timeZoneOffsetMs(guess, timeZone)
  offset = timeZoneOffsetMs(guess - offset, timeZone)
  return guess - offset
}

/**
 * 按指定时区格式化时间：`YYYY-MM-DD HH:mm`。
 * @param {number} ts epoch 毫秒
 * @param {string|undefined} timeZone IANA 时区；空表示服务器本地
 */
function formatTimeInZone(ts, timeZone) {
  const value = typeof ts === 'number' && Number.isFinite(ts) ? ts : Date.now()
  const parts = timeZoneParts(value, timeZone)
  const pad = (n) => String(n).padStart(2, '0')
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`
}

/**
 * 相对时间描述（中文）：刚刚 / N 分钟前 / N 小时前 / N 天前。
 * @param {number} ts epoch 毫秒
 * @param {number} [now] 当前时间
 */
function relativeTime(ts, now = Date.now()) {
  const value = typeof ts === 'number' && Number.isFinite(ts) ? ts : now
  const diff = Math.max(0, now - value)
  const minute = 60000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`
  return `${Math.floor(diff / (30 * day))} 个月前`
}

/** 计算“今天 / 近 7 天 / 近 30 天”的时间范围（按指定时区取自然日）。 */
function rangeBounds(range, timeZone, now = Date.now()) {
  const day = 86400000
  if (range === 'today') {
    const from = startOfDayMs(now, timeZone)
    return { from, to: from + day - 1 }
  }
  if (range === '7d' || range === '30d') {
    const days = range === '7d' ? 7 : 30
    const startToday = startOfDayMs(now, timeZone)
    const from = startToday - (days - 1) * day
    return { from, to: startToday + day - 1 }
  }
  return { from: null, to: null }
}

/** 生成数据/管理界面上统一使用的时间元信息。 */
function timeInfo(ts, timeZone, showRelative = true, now = Date.now()) {
  const value = typeof ts === 'number' && Number.isFinite(ts) ? ts : now
  return {
    time: formatTimeInZone(value, timeZone),
    relative: showRelative ? relativeTime(value, now) : '',
  }
}

/** 指定时区下的日期 key：YYYY-MM-DD。 */
function dayKey(ts, timeZone) {
  const parts = timeZoneParts(typeof ts === 'number' ? ts : Date.now(), timeZone)
  const pad = (n) => String(n).padStart(2, '0')
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

/** 指定时区下某一天的起止 epoch（毫秒）。 */
function dayBoundsFromKey(key, timeZone) {
  const [year, month, day] = String(key).split('-').map(Number)
  const guess = Date.UTC(year, month - 1, day)
  let offset = timeZoneOffsetMs(guess, timeZone)
  offset = timeZoneOffsetMs(guess - offset, timeZone)
  const from = guess - offset
  return { from, to: from + 86400000 - 1 }
}

/** 指定时间点的时区日边界。 */
function dayBoundsOf(ts, timeZone) {
  const key = dayKey(ts, timeZone)
  return { key, ...dayBoundsFromKey(key, timeZone) }
}

/** 前一天/后一天的日期 key。 */
function shiftDayKey(key, deltaDays) {
  const [year, month, day] = String(key).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + deltaDays))
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** 当前本地时间是否已经到达/超过 HH:mm。 */
function isAtOrAfterTime(hhmm, timeZone, now = Date.now()) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim())
  if (!match) return false
  const target = Number(match[1]) * 60 + Number(match[2])
  const parts = timeZoneParts(now, timeZone)
  const current = parts.hour * 60 + parts.minute
  return current >= target
}

/** 解析 HH:mm，返回分钟数（非法返回 null）。 */
function parseHhMm(hhmm) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

/** 给人看的时长：1h 2m / 35s。 */
function formatDuration(ms) {
  const value = Math.max(0, Number(ms) || 0)
  if (value < 1000) return `${Math.round(value)}ms`
  if (value < 60000) return `${Math.round(value / 1000)}s`
  const minutes = Math.floor(value / 60000)
  const seconds = Math.round((value % 60000) / 1000)
  if (minutes < 60) return `${minutes}m ${seconds}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}
// ===== src/lib/util/index.js =====
/**
 * 通用小工具：配置解包、截断、哈希、UUID、data URI、超时。
 */



/** 配置字段可能是 volatile 包装（Ref），统一解包。 */
function val(value) {
  if (value && typeof value.get === 'function') return value.get()
  return value
}

/** 把 @deepseek-ai/schemastery 的 Config 实例解包成普通对象。 */
function readConfig(config) {
  const out = {}
  if (config === null || typeof config !== 'object') return out
  for (const key of Object.keys(config)) out[key] = val(config[key])
  return out
}

/** 读取配置值，undefined/null 时回退。 */
function cfgValue(config, key, fallback) {
  const v = val(config?.[key])
  return v === undefined || v === null ? fallback : v
}

/** 去掉 URL 末尾斜杠。 */
function normalizeUrl(url) {
  const text = String(url ?? '').trim()
  return text.replace(/\/+$/, '')
}

/** 去掉首尾空白并压缩多余空白，保留换行。 */
function cleanText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 截断到 max 个字符（max<=0 视为不截断）。 */
function truncate(text, max) {
  const value = String(text ?? '')
  if (!max || max <= 0 || value.length <= max) return value
  return value.slice(0, Math.max(0, max - 1)).trimEnd() + '…'
}

/** Uint8Array → data URI（硅基流动图片输入要求 data URI 或可访问 URL）。 */
function toDataUri(bytes, mediaType) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  return `data:${mediaType || 'image/png'};base64,${buffer.toString('base64')}`
}

/** 本地时间字符串，形如 2026-10-17 11:22。 */
function formatTime(ts) {
  const value = typeof ts === 'number' && Number.isFinite(ts) ? ts : Date.now()
  const d = new Date(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 把任意错误转成可读文本。 */
function errorText(error) {
  if (error === null || error === undefined) return ''
  if (error instanceof Error) return error.message || String(error)
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/** 常见密钥/令牌模式；命中后替换为 [已脱敏]。 */
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{10,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}\b/gi,
  /((?:api[_ -]?key|access[_ -]?token|secret|password|passwd|pwd)\s*[:=：]\s*)([^\s,，。;；]{6,})/gi,
]

/** 把文本里明显的密钥/令牌/密码替换为 [已脱敏]，避免记忆库保存敏感凭据。 */
function redactSecrets(text) {
  let out = String(text ?? '')
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, prefix) => (typeof prefix === 'string' && prefix !== '' ? prefix + '[已脱敏]' : '[已脱敏]'))
  }
  return out
}

/** 简单并发安全队列：串行执行，失败只记录不打断后续任务。 */
class SerialQueue {
  #logger
  #tasks = []
  #running = false
  #lastError = null
  #lastErrorAt = 0
  #done = 0
  #failed = 0

  constructor(logger) {
    this.#logger = logger ?? console
  }

  /** 待处理任务数（含正在执行的一个）。 */
  get pending() {
    return this.#tasks.length + (this.#running ? 1 : 0)
  }

  /** 已完成任务数。 */
  get done() {
    return this.#done
  }

  /** 失败任务数。 */
  get failed() {
    return this.#failed
  }

  /** 最近一次失败。 */
  get lastError() {
    return this.#lastError
  }

  get lastErrorAt() {
    return this.#lastErrorAt
  }

  /** 入队一个异步任务。 */
  push(label, task, options = {}) {
    const retries = Number.isFinite(options.retries) ? Math.max(0, options.retries) : 0
    this.#tasks.push({ label, task, retries, attempt: 0 })
    this.#drain()
  }

  async #drain() {
    if (this.#running) return
    this.#running = true
    while (this.#tasks.length > 0) {
      const job = this.#tasks.shift()
      try {
        await job.task()
        this.#done += 1
      } catch (error) {
        if (job.attempt < job.retries) {
          job.attempt += 1
          this.#tasks.push(job)
          await new Promise((resolve) => setTimeout(resolve, 1500))
          continue
        }
        this.#failed += 1
        this.#lastError = `${job.label}: ${errorText(error)}`
        this.#lastErrorAt = Date.now()
        this.#logger?.warn?.(`[dsh-memory] 任务失败 (${job.label}): ${errorText(error)}`)
      }
    }
    this.#running = false
  }
}

/** 把 provider id 规范化成凭据引用名前缀。 */
function providerIdToEnv(id) {
  const text = String(id ?? '')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
  return (text || 'CUSTOM') + '_API_KEY'
}

/** 取整并夹在范围内。 */
function clampInt(value, fallback, min, max) {
  const number = Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback
  return Math.min(max, Math.max(min, number))
}

/** 取浮点数并夹在范围内。 */
function clampNumber(value, fallback, min, max) {
  const number = Number.isFinite(Number(value)) ? Number(value) : fallback
  return Math.min(max, Math.max(min, number))
}

/** 宽松解析布尔。 */
function asBool(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1 || value === '1') return true
  if (value === 'false' || value === 0 || value === '0') return false
  return fallback
}

// ---------------------------------------------------------------------------
// 文件 / 任务批次 / 日程时间辅助
// ---------------------------------------------------------------------------

/** DSH harness home（默认 ~/.dsh）。 */
function dshHome() {
  const env = process.env.DSH_HOME
  if (env && env.trim()) return env.trim()
  const home = process.env.HOME || '/root'
  return join(home, '.dsh')
}

/** 读取 JSON 文件；不存在或损坏时返回 fallback。 */
function readJsonFile(path, fallback) {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

/** 原子写入 JSON 文件（先写临时文件再 rename）。 */
function writeJsonFileAtomic(path, value) {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, path)
}

/** 把条目列表按字符预算切成若干块。 */
function chunkByChars(items, maxChars, render) {
  const chunks = []
  let current = []
  let size = 0
  for (const item of items) {
    const text = render ? render(item) : String(item)
    if (size + text.length > maxChars && current.length > 0) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(item)
    size += text.length + 1
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/** 从模型输出中提取 JSON（容忍 ```json 围栏与前后说明文字）。 */
function extractJson(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)
  const candidate = fenced ? fenced[1].trim() : raw
  try {
    return JSON.parse(candidate)
  } catch {
    /* continue */
  }
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch {
      return null
    }
  }
  return null
}

/** 截断长文本列表的渲染文本到预算。 */
function renderMemoryLines(items, maxChars, formatter) {
  const lines = []
  let size = 0
  for (const item of items) {
    const line = formatter ? formatter(item) : String(item)
    if (size + line.length > maxChars && lines.length > 0) break
    lines.push(line)
    size += line.length + 1
  }
  return lines.join('\n')
}
// ===== src/lib/app/consolidation-service.js =====
/**
 * 睡眠整理引擎（v0.4）。
 *
 * 把记忆压缩成“批次”，用任务列表调度多级压缩：
 *   L1：每天把原始记忆（level=0）压缩成一个 5 位编号的批次（保留多少条由模型按重要性决定）
 *   L2：L1 批次创建 7 天后，再压缩为 L2 批次（L1 原文删除）
 *   L3：L2 批次创建 30 天后，再压缩为 L3 批次（最终长期摘要）
 *
 * 任务列表持久化在 $DSH_HOME/storages/dsh-memory/consolidation.json，
 * 批次编号是随机 5 位数；只要求“待处理/处理中”的编号唯一，完成后的编号可回收复用。
 *
 * 实验功能（默认关闭）：
 * - 事件合并：整理时用嵌入向量在全库检索相似记忆，只把相关小簇作为参考交给 LLM，
 *   并生成 kind='event' 的事件摘要（不会被整库塞给 LLM）。
 * - 增强记忆：额外保留一份 L1 产物 enhancementDays 天，不参与后续整理，
 *   仅供事件合并/按需搜索使用，到期自动删除。
 */








/** 整理状态文件版本。 */
const STATE_VERSION = 1

/** 内置整理提示词。 */
const DEFAULT_PROMPT = [
  '你是长期记忆整理助手，模拟人类睡眠中的记忆巩固。',
  '输入：某个时间单元内的若干条记忆（可能来自对话、事实、偏好、图片概览）。',
  '任务：合并、去重、压缩，提炼出最重要的信息；删除寒暄与重复，不编造不存在的内容。',
  '输出必须是严格 JSON（不要输出代码围栏之外的解释）：',
  '{"summary":"一段简短的整体摘要","facts":[{"text":"一条自包含的事实","kind":"fact|preference|project|note","tags":["可选标签"]}],"event":{"summary":"可选：如果这些记忆构成同一事件，写一句事件摘要","tags":["可选"]}}',
  '要求：',
  '- facts 条数由你根据信息的重要性和密度自行决定（不要为了凑数而保留琐碎内容，也不要丢失关键事实）；每条自包含，不要用“他/它/这个”等指代。',
  '- 保留关键事实、偏好、决定、时间、人名、项目名；丢弃噪音。',
  '- summary 与 facts 用中文（除非原文主要是其他语言）。',
].join('\n')

/** 一个批次的简易视图（给状态/历史用）。 */
function batchView(batch) {
  return {
    id: batch.id,
    level: batch.level,
    status: batch.status,
    createdAt: batch.createdAt,
    dueAt: batch.dueAt,
    sourceCount: batch.inputCount ?? 0,
    outputCount: batch.outputCount ?? 0,
    dayKey: batch.dayKey ?? '',
    sourceBatchIds: batch.sourceBatchIds ?? [],
    error: batch.error ?? null,
  }
}

class ConsolidationEngine {
  /**
   * @param {import('./service.js').MemoryService} service
   */
  constructor(service) {
    this.service = service
    this.ctx = service.ctx
    this.logger = service.logger
    this.statePath = join(dshHome(), 'storages', 'dsh-memory', 'consolidation.json')
    this.state = { version: STATE_VERSION, batches: [], history: [], lastRun: null }
    this.loaded = false
    this.running = null
  }

  /** 配置级别定义（level1 为每日原始记忆压缩，level2/3 为后续批次压缩）。 */
  stages() {
    // 默认不限制输出条数，由整理模型按内容重要性自行决定；
    // 只有在设置页显式开启「限制每级整理条数」时才套用内部安全上限。
    // 7 天 / 30 天的触发间隔是固定的整理节奏，未来要扩展更多级只需在数组里追加。
    const limitEnabled = this.service.cfg().consolidationLimitItems === true
    return CONSOLIDATION_LEVELS.map((stage) => ({
      level: stage.level,
      afterDays: stage.afterDays,
      maxItems: levelMaxItems(stage.level, limitEnabled),
    }))
  }

  stage(level) {
    return this.stages().find((item) => item.level === level) ?? null
  }

  nextStage(level) {
    return this.stages().find((item) => item.level === level + 1) ?? null
  }

  // ------------------------------------------------------------------
  // 任务列表持久化
  // ------------------------------------------------------------------

  async load() {
    if (this.loaded) return this.state
    const data = readJsonFile(this.statePath, null)
    if (data && typeof data === 'object' && Array.isArray(data.batches)) {
      this.state = {
        version: STATE_VERSION,
        batches: data.batches,
        history: Array.isArray(data.history) ? data.history : [],
        lastRun: data.lastRun ?? null,
      }
    }
    this.loaded = true
    return this.state
  }

  async save() {
    // 只保留最近 600 个批次与 40 条历史，避免状态文件无限膨胀
    if (this.state.batches.length > 600) {
      const finished = this.state.batches.filter((b) => b.status !== 'pending' && b.status !== 'processing')
      const active = this.state.batches.filter((b) => b.status === 'pending' || b.status === 'processing')
      const keepFinished = finished.slice(-Math.max(0, 600 - active.length))
      this.state.batches = [...keepFinished, ...active].sort((a, b) => a.createdAt - b.createdAt)
    }
    if (this.state.history.length > 40) this.state.history = this.state.history.slice(-40)
    writeJsonFileAtomic(this.statePath, this.state)
  }

  /** 待处理/处理中批次占用的编号集合。 */
  pendingIds() {
    return new Set(
      this.state.batches
        .filter((batch) => batch.status === 'pending' || batch.status === 'processing')
        .map((batch) => String(batch.id)),
    )
  }

  batchById(id) {
    return this.state.batches.find((batch) => String(batch.id) === String(id)) ?? null
  }

  /** 状态/历史摘要。 */
  summary() {
    const batches = this.state.batches ?? []
    const pending = batches.filter((batch) => batch.status === 'pending' || batch.status === 'processing')
    const byLevel = {}
    for (const batch of pending) byLevel[batch.level] = (byLevel[batch.level] ?? 0) + 1
    const nextDue = pending
      .filter((batch) => Number.isFinite(batch.dueAt))
      .sort((a, b) => a.dueAt - b.dueAt)[0]
    return {
      enabled: this.service.cfg().consolidationEnabled === true,
      pendingTotal: pending.length,
      pendingByLevel: byLevel,
      nextDueAt: nextDue?.dueAt ?? null,
      nextDueTime: nextDue?.dueAt ? this.service.formatTs(nextDue.dueAt) : '',
      batches: batches.slice(-15).map(batchView),
      history: (this.state.history ?? []).slice(-6).map((entry) => ({
        at: entry.at,
        time: entry.at ? this.service.formatTs(entry.at) : '',
        manual: entry.manual === true,
        durationMs: entry.durationMs ?? 0,
        levels: entry.levels ?? {},
        errors: entry.errors ?? [],
      })),
      lastRun: this.state.lastRun,
      statePath: this.statePath,
    }
  }

  // ------------------------------------------------------------------
  // 运行整理
  // ------------------------------------------------------------------

  /** 是否正在整理。 */
  get busy() {
    return this.running !== null
  }

  /**
   * 执行一轮整理（睡醒前调用）。同一时间只允许一个 run。
   * @param {{manual?:boolean, reason?:string}} options
   */
  async run(options = {}) {
    await this.load()
    if (this.running) return this.running
    this.running = this.#runInner({ manual: options.manual === true, reason: options.reason ?? 'sleep' })
      .finally(() => {
        this.running = null
      })
    return this.running
  }

  async #runInner({ manual, reason }) {
    const startedAt = Date.now()
    const cfg = this.service.cfg()
    const tz = this.service.timeOptions().timeZone
    const today = dayKey(Date.now(), tz)
    const stages = this.stages()
    const result = {
      ok: true,
      manual,
      reason,
      startedAt,
      finishedAt: 0,
      durationMs: 0,
      levels: {},
      batches: [],
      deleted: 0,
      errors: [],
      maintenance: null,
    }

    try {
      await this.service.ensureReady()

      // ---------- L1：把“今天之前”的原始记忆按天压缩 ----------
      const raw = await this.service.collectMemories({
        filter: { must: [{ key: 'level', match: { value: 0 } }] },
        withVector: cfg.experimentalEventMergeEnabled === true,
        maxItems: 5000,
        orderBy: { key: 'ts', direction: 'asc' },
      })
      const byDay = new Map()
      for (const item of raw) {
        const key = dayKey(Number(item.payload?.ts) || 0, tz)
        if (key >= today) continue
        if (!byDay.has(key)) byDay.set(key, [])
        byDay.get(key).push(item)
      }
      const dayKeys = [...byDay.keys()].sort()
      for (const key of dayKeys) {
        const items = byDay.get(key)
        const stage1 = stages.find((item) => item.level === 1)
        const outcome = await this.#compress({
          level: 1,
          stage: stage1,
          sources: items,
          dayKey: key,
          sourceBatchIds: [],
          meta: { dayRange: dayBoundsFromKey(key, tz) },
        })
        result.batches.push(outcome.view)
        if (outcome.error) result.errors.push(outcome.error)
        this.#mergeLevelStats(result, 1, outcome)
      }

      // ---------- L2/L3：处理到期批次 ----------
      for (const stage of stages.filter((item) => item.level >= 2)) {
        const due = this.state.batches
          .filter(
            (batch) =>
              batch.level === stage.level - 1 &&
              batch.status === 'pending' &&
              Number(batch.dueAt) > 0 &&
              Number(batch.dueAt) <= Date.now(),
          )
          .sort((a, b) => a.dueAt - b.dueAt)
        for (const sourceBatch of due) {
          const sources = await this.service.collectBatchMemories(sourceBatch.id, {
            withVector: cfg.experimentalEventMergeEnabled === true,
            maxItems: 5000,
          })
          if (sources.length === 0) {
            sourceBatch.status = 'done'
            sourceBatch.updatedAt = Date.now()
            sourceBatch.error = 'empty-batch'
            await this.save()
            continue
          }
          const outcome = await this.#compress({
            level: stage.level,
            stage,
            sources,
            dayKey: sourceBatch.dayKey ?? '',
            sourceBatchIds: [sourceBatch.id],
            meta: { dayRange: sourceBatch.dayRange ?? null },
          })
          result.batches.push(outcome.view)
          if (outcome.error) result.errors.push(outcome.error)
          this.#mergeLevelStats(result, stage.level, outcome)
          if (!outcome.error) {
            sourceBatch.status = 'done'
            sourceBatch.updatedAt = Date.now()
            sourceBatch.outputBatchId = outcome.view.id
          } else {
            sourceBatch.attempts = (sourceBatch.attempts ?? 0) + 1
            sourceBatch.error = outcome.error
          }
          await this.save()
        }
      }

      // ---------- 增强记忆到期清理 ----------
      try {
        const expired = await this.service.listExpiredEnhanced(Date.now())
        if (expired.length > 0) {
          await this.service.deleteMemoryIds(expired)
          result.deleted += expired.length
        }
      } catch (error) {
        result.errors.push(`enhanced-expiry: ${errorText(error)}`)
      }

      // ---------- 整理后自动维护（去重/过期/索引） ----------
      try {
        result.maintenance = await this.service.maintenance({ force: false })
      } catch (error) {
        result.errors.push(`maintenance: ${errorText(error)}`)
      }
    } catch (error) {
      result.ok = false
      result.errors.push(errorText(error))
    }

    result.finishedAt = Date.now()
    result.durationMs = result.finishedAt - startedAt
    result.ok = result.ok && result.errors.length === 0
    this.state.lastRun = {
      at: result.finishedAt,
      manual,
      durationMs: result.durationMs,
      ok: result.ok,
      levels: result.levels,
      deleted: result.deleted,
      errors: result.errors,
    }
    this.state.history.push({
      at: result.startedAt,
      manual,
      durationMs: result.durationMs,
      levels: result.levels,
      currentLevels: this.summaryLevels(),
      errors: result.errors,
    })
    await this.save()
    const levelText = Object.entries(result.levels)
      .map(([level, stat]) => `L${level}:${stat.batches}批/${stat.input}→${stat.output}`)
      .join(' ')
    this.service.debugLog(`睡眠整理完成 ${formatDuration(result.durationMs)} ${levelText} 删除原文 ${result.deleted} 条`)
    return result
  }

  summaryLevels() {
    const counts = {}
    for (const batch of this.state.batches) counts[batch.level] = (counts[batch.level] ?? 0) + 1
    return counts
  }

  #mergeLevelStats(result, level, outcome) {
    if (!result.levels[level]) result.levels[level] = { batches: 0, input: 0, output: 0 }
    result.levels[level].batches += 1
    result.levels[level].input += outcome.inputCount ?? 0
    result.levels[level].output += outcome.outputCount ?? 0
    result.deleted += outcome.deleted ?? 0
  }

  /**
   * 压缩一个批次：调 LLM（或规则回退）生成摘要+事实，写入新记忆，删除原文，登记任务。
   */
  async #compress({ level, stage, sources, dayKey: key, sourceBatchIds, meta }) {
    const cfg = this.service.cfg()
    const nextStage = this.nextStage(level)
    const batchId = nextBatchId(this.pendingIds())
    const cleanSources = (sources ?? []).filter((item) => item.payload?.text)
    const inputCount = cleanSources.length
    const emptyView = {
      id: batchId,
      level,
      status: nextStage ? 'pending' : 'final',
      createdAt: Date.now(),
      dueAt: nextStage ? Date.now() + nextStage.afterDays * 86400000 : null,
      sourceCount: inputCount,
      outputCount: 0,
      sourceBatchIds,
      dayKey: key || '',
      error: 'no-source',
    }
    if (inputCount === 0) return { view: emptyView, inputCount: 0, outputCount: 0, deleted: 0, error: null }

    try {
      // ---------- 实验：事件合并（只取相似记忆作为参考） ----------
      let related = []
      if (cfg.experimentalEventMergeEnabled === true) {
        related = await this.#findRelated(cleanSources)
      }

      // ---------- LLM / 规则压缩 ----------
      const rendered = this.#renderSources(cleanSources, level)
      const chunks = chunkByChars(cleanSources, Math.max(1000, Number(cfg.consolidationInputMaxChars) || 12000))
      let combined = null
      let llmCalls = 0
      let latencyMs = 0
      try {
        const partials = []
        for (const chunk of chunks) {
          const partial = await this.#callLLM({
            level,
            stage,
            items: chunk,
            rendered: this.#renderSources(chunk, level),
            related,
            isFirst: partials.length === 0,
          })
          partials.push(partial)
          llmCalls += 1
          latencyMs += partial.latencyMs ?? 0
        }
        combined = partials.length === 1 ? partials[0].data : await this.#mergePartials(partials, stage)
        if (partials.length > 1) {
          llmCalls += 1
          latencyMs += combined?.latencyMs ?? 0
        }
      } catch (error) {
        // 回退：纯规则压缩（保证睡眠不中断；内容可能粗糙）
        this.service.debugLog(`整理 LLM 不可用，回退规则压缩：${errorText(error)}`)
        combined = this.#ruleCompress(chunks, stage)
        combined = combined.data
        combined.fallback = true
        combined.fallbackReason = errorText(error)
      }

      const summary = String(combined?.summary ?? '').trim()
      const facts = Array.isArray(combined?.facts) ? combined.facts : []
      const event = combined?.event && typeof combined.event === 'object' ? combined.event : null

      // 默认保留条数由模型决定；只有开启「限制每级整理条数」时才截断。
      const limitEnabled = Number.isFinite(stage.maxItems)
      const maxItems = limitEnabled ? Math.max(1, stage.maxItems) : null
      const factLimit = limitEnabled ? Math.max(0, maxItems - (summary ? 1 : 0)) : Infinity
      const selectedFacts = facts
        .filter((fact) => fact && typeof fact.text === 'string' && fact.text.trim())
        .slice(0, factLimit)
        .map((fact) => ({
          text: String(fact.text).trim(),
          kind: ['fact', 'preference', 'project', 'note', 'event'].includes(fact.kind) ? fact.kind : 'fact',
          tags: Array.isArray(fact.tags) ? fact.tags.map(String).slice(0, 8) : [],
        }))

      const entries = []
      if (summary) entries.push({ text: summary, kind: 'summary', tags: ['summary'] })
      for (const fact of selectedFacts) entries.push(fact)
      if (entries.length === 0) entries.push({ text: rendered.slice(0, Math.max(80, Math.min(400, rendered.length))), kind: 'note', tags: ['fallback'] })
      const eventText = event?.summary && String(event.summary).trim()
        ? String(event.summary).trim()
        : related.length > 0
          ? `相关事件：${summary || related[0].text}`.slice(0, 500)
          : ''
      if (eventText) {
        entries.push({
          text: eventText,
          kind: 'event',
          tags: Array.isArray(event?.tags) ? event.tags.map(String).slice(0, 8) : ['event'],
        })
      }

      // 压缩比统计：输入条数 → 输出条数（source 删除，目标比例仅作为提示）
      const now = Date.now()
      const sourceIds = cleanSources.map((item) => item.id)
      const avgValue = (pick) => {
        const values = cleanSources
          .map((item) => Number(pick(item.payload ?? {})))
          .filter((value) => Number.isFinite(value))
        if (values.length === 0) return null
        return values.reduce((sum, value) => sum + value, 0) / values.length
      }
      const importanceAvg = avgValue((payload) => normalizeImportance(payload.importance, payload.kind))
      const confidenceAvg = avgValue((payload) => normalizeConfidence(payload.confidence, payload.kind))
      const sourceTimes = cleanSources
        .map((item) => Number(item.payload?.anchorTs) || Number(item.payload?.ts) || 0)
        .filter((value) => value > 0)
      const anchorTs = Number(meta?.dayRange?.from) || (sourceTimes.length > 0 ? Math.min(...sourceTimes) : now)
      const baseMeta = {
        level,
        batch: batchId,
        batchCreatedAt: now,
        sourceCount: inputCount,
        sourceBatchIds,
        dayRange: meta?.dayRange ?? null,
        consolidatedAt: now,
        relatedCount: related.length,
        anchorTs,
        importance: importanceAvg === null ? undefined : Number(importanceAvg.toFixed(3)),
        confidence: confidenceAvg === null ? undefined : Number(confidenceAvg.toFixed(3)),
      }

      const written = []
      try {
        for (const [index, entry] of entries.entries()) {
          const saved = await this.service.addMemory({
            kind: entry.kind === 'summary' ? 'summary' : entry.kind,
            text: entry.text,
            meta: {
              ...baseMeta,
              tags: entry.tags,
              // 批次内唯一：避免整理产物的内容哈希与原文（或彼此）相同，
              // 导致“先写入、再删除原文”把新产物一起删掉。
              idSeed: `sleep-${batchId}-${index}`,
            },
          })
          written.push(saved)
        }
        // 实验：增强记忆副本（不进入整理链，仅事件/按需召回使用）
        if (cfg.experimentalEnhancementEnabled === true && level === 1) {
          const days = Math.max(1, Number(cfg.experimentalEnhancementDays) || 7)
          for (const saved of written) {
            await this.service.addMemory({
              kind: saved.kind ?? 'summary',
              text: `（增强记忆）${saved.text}`,
              meta: {
                level: 1,
                enhanced: true,
                expiresAt: now + days * 86400000,
                sourceCount: inputCount,
                sourceBatchIds,
                consolidatedAt: now,
                idSeed: `enhanced-${batchId}`,
              },
            })
          }
        }
      } catch (error) {
        return {
          view: { ...emptyView, error: `write-failed: ${errorText(error)}` },
          inputCount,
          outputCount: 0,
          deleted: 0,
          error: `write-failed: ${errorText(error)}`,
        }
      }

      // 写入成功后删除原文
      let deleted = 0
      try {
        deleted = await this.service.deleteMemoryIds(sourceIds)
      } catch (error) {
        return {
          view: { ...emptyView, error: `delete-failed: ${errorText(error)}` },
          inputCount,
          outputCount: written.length,
          deleted: 0,
          error: `delete-failed: ${errorText(error)}`,
        }
      }

      const batchRow = {
        id: batchId,
        level,
        status: nextStage ? 'pending' : 'final',
        createdAt: now,
        updatedAt: now,
        dueAt: nextStage ? now + nextStage.afterDays * 86400000 : null,
        dayKey: key || '',
        dayRange: meta?.dayRange ?? null,
        sourceBatchIds,
        sourceIdsCount: sourceIds.length,
        inputCount,
        outputCount: written.length,
        maxItems,
        llmCalls,
        latencyMs,
        fallback: combined?.fallback === true,
        fallbackReason: combined?.fallbackReason ?? null,
        error: null,
      }
      this.state.batches.push(batchRow)
      await this.save()
      return {
        view: batchView(batchRow),
        inputCount,
        outputCount: written.length,
        deleted,
        error: null,
      }
    } catch (error) {
      return {
        view: { ...emptyView, error: errorText(error) },
        inputCount,
        outputCount: 0,
        deleted: 0,
        error: errorText(error),
      }
    }
  }

  /** 渲染记忆条目给模型。 */
  #renderSources(items, level) {
    return items
      .map((item) => {
        const payload = item.payload ?? {}
        const time = this.service.formatTs(Number(payload.ts) || 0)
        const kind = payload.kind ?? 'note'
        const batch = payload.batch ? ` #${payload.batch}` : ''
        return `- [${time}·${kind}${batch}] ${String(payload.text ?? '').trim()}`
      })
      .join('\n')
  }

  /** 在全库检索相似记忆（事件合并参考），绝不加载全库到内存。 */
  async #findRelated(sources) {
    const cfg = this.service.cfg()
    const threshold = Math.min(1, Math.max(0.5, Number(cfg.experimentalEventMergeThreshold) || 0.85))
    const maxCandidates = Math.max(1, Math.min(200, Number(cfg.experimentalEventMergeMaxCandidates) || 30))
    const ownIds = new Set(sources.map((item) => item.id))
    const related = new Map()
    // 只探测最多 20 条源记忆，控制查询次数
    for (const source of sources.slice(0, 20)) {
      const vector = source.vector
      if (!Array.isArray(vector)) continue
      try {
        const hits = await this.service.searchSimilar(vector, {
          limit: 5,
          threshold,
          excludeIds: [...ownIds, ...related.keys()],
        })
        for (const hit of hits) {
          if (!related.has(hit.id)) related.set(hit.id, hit)
          if (related.size >= maxCandidates) break
        }
      } catch {
        /* 忽略单条检索失败 */
      }
      if (related.size >= maxCandidates) break
    }
    return [...related.values()].slice(0, maxCandidates)
  }

  /** 调一次整理 LLM（DSH 模型或自定义 provider，由 service 路由）。 */
  async #callLLM({ level, stage, items, rendered, related, isFirst }) {
    const cfg = this.service.cfg()
    const limitEnabled = Number.isFinite(stage?.maxItems)
    const maxFacts = limitEnabled ? Math.max(1, stage.maxItems - 1) : null
    const relatedText = isFirst && related.length > 0
      ? `\n\n【可能相关的其他事件记忆（仅参考，不要删除/编造，可合并同一事件的信息）】\n${renderMemoryLines(related, 6000, (item) => `- [${this.service.formatTs(item.ts)}·${item.kind}${item.batch ? ' #' + item.batch : ''}] ${item.text.slice(0, 500)}`)}`
      : ''
    const customPrompt = String(cfg.consolidationPrompt ?? '').trim()
    const system = customPrompt || DEFAULT_PROMPT
    const countRule = limitEnabled
      ? `请输出 JSON：summary、facts（条数由你按重要性决定，最多 ${maxFacts} 条）、可选 event。`
      : '请输出 JSON：summary、facts（条数由你按重要性自行决定）、可选 event。'
    const user = [
      `这是第 ${level} 级记忆整理。本批共 ${items.length} 条记忆。`,
      countRule,
      '精简是默认目标：优先保留关键事实、偏好、决定、时间和人名；重复、寒暄和流水账直接丢弃。',
      '',
      '【本批记忆】',
      rendered,
      relatedText,
    ].join('\n')
    const startedAt = Date.now()
    const response = await this.service.consolidationChat({
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens: level >= 3 ? 4096 : level === 2 ? 3072 : 2048,
      temperature: 0.2,
    })
    const parsed = extractJson(response.text)
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`整理模型未返回可解析 JSON：${String(response.text).slice(0, 200)}`)
    }
    return {
      data: {
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        facts: Array.isArray(parsed.facts) ? parsed.facts : [],
        event: parsed.event && typeof parsed.event === 'object' ? parsed.event : null,
      },
      latencyMs: response.latencyMs ?? Date.now() - startedAt,
      raw: response.text,
      usage: response.usage ?? null,
      modelSource: response.source ?? '',
      model: response.model ?? '',
    }
  }

  /** 多块结果合并。 */
  async #mergePartials(partials, stage) {
    const summaries = partials.map((partial, index) => `## 分块 ${index + 1}\n${JSON.stringify(partial.data)}`).join('\n\n')
    const startedAt = Date.now()
    try {
      const limitEnabled = Number.isFinite(stage?.maxItems)
      const limitRule = limitEnabled ? `facts 上限 ${Math.max(1, stage.maxItems - 1)}。` : 'facts 条数由你按重要性决定。'
      const response = await this.service.consolidationChat({
        system:
          '你在合并多个记忆整理分块的结果。请合并去重，输出同样格式的严格 JSON：{"summary":"...","facts":[...],"event":{...}}。',
        messages: [{ role: 'user', content: `${limitRule}\n\n${summaries}` }],
        maxTokens: 3072,
        temperature: 0.2,
      })
      const parsed = extractJson(response.text)
      if (!parsed || typeof parsed !== 'object') throw new Error('merge-no-json')
      return {
        data: {
          summary: typeof parsed.summary === 'string' ? parsed.summary : '',
          facts: Array.isArray(parsed.facts) ? parsed.facts : [],
          event: parsed.event && typeof parsed.event === 'object' ? parsed.event : null,
        },
        latencyMs: response.latencyMs ?? Date.now() - startedAt,
      }
    } catch {
      // 合并失败：简单拼接（去重）
      const facts = []
      const seen = new Set()
      for (const partial of partials) {
        for (const fact of partial.data.facts ?? []) {
          const text = String(fact?.text ?? '').trim()
          if (!text || seen.has(text)) continue
          seen.add(text)
          facts.push(fact)
        }
      }
      return {
        data: {
          summary: partials.map((partial) => partial.data.summary).filter(Boolean).join('；'),
          facts,
          event: null,
        },
        latencyMs: 0,
      }
    }
  }

  /** 纯规则压缩（LLM 不可用时的回退）。 */
  #ruleCompress(chunks, stage) {
    const maxItems = Number.isFinite(stage?.maxItems) ? Math.max(1, stage.maxItems) : Infinity
    const facts = []
    const seen = new Set()
    for (const chunk of chunks) {
      for (const item of chunk) {
        const text = String(item.payload?.text ?? '').trim()
        if (!text) continue
        const normalized = text.slice(0, 80)
        if (seen.has(normalized)) continue
        seen.add(normalized)
        facts.push({
          text,
          kind: item.payload?.kind === 'summary' || item.payload?.kind === 'event' ? 'note' : (item.payload?.kind ?? 'note'),
        })
        if (facts.length >= Math.max(1, maxItems - 1)) break
      }
      if (facts.length >= Math.max(1, maxItems - 1)) break
    }
    const summary = facts
      .slice(0, 3)
      .map((fact) => fact.text.slice(0, 80))
      .join('；')
    return {
      data: {
        summary: summary ? `规则整理：${summary}` : '',
        facts,
        event: null,
        fallback: true,
        fallbackReason: 'no-llm',
      },
      latencyMs: 0,
    }
  }
}
// ===== src/shared/protocol.js =====
/**
 * Host 与 client 共用的协议常量（单一事实源）。
 * 目前 host 直接 import；client 侧在 R5 模块化构建时复用同一份常量。
 */
const PLUGIN_ID = 'dsh-memory'
const API_PREFIX = '/__dsh_memory__/'
const POST_HEADER = 'x-dsh-memory'
const POST_HEADER_VALUE = '1'
const MEMORY_SOURCE = 'long-term-memory'
const SLEEP_SOURCE = 'dsh-memory-sleep'
const WAKE_SOURCE = 'dsh-memory-wake'
// ===== src/lib/adapters/openai/client.js =====
/**
 * OpenAI 兼容的云端 API 客户端：
 * - POST {baseUrl}/embeddings        文本嵌入（OpenAI / SiliconFlow / DashScope 兼容模式 / 智谱 / 火山方舟 / Jina … 均兼容）
 * - POST {visionBaseUrl}/chat/completions  视觉对话（用于图片一句话概览），图片以 data URI 发送
 *
 * 不绑定任何特定厂商：Base URL、模型、维度、Key 均由 provider 档案提供。
 */


/** 组合外部取消信号与超时。 */
function combineSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(Math.max(1000, timeoutMs))
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout])
}

/** 读取错误响应体并给出可读摘要。 */
async function failure(response, label) {
  let detail = ''
  try {
    const text = await response.text()
    detail = text.slice(0, 600)
  } catch {
    /* ignore */
  }
  return `${label} API 返回 ${response.status}${detail ? `：${detail}` : ''}`
}

/** 从 chat completions 的 content（字符串或分段数组）里取文本。 */
function contentText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && part.type === 'text' && typeof part.text === 'string') return part.text
        return ''
      })
      .join('')
  }
  return ''
}

/** 默认图片概览提示词。 */
const DEFAULT_CAPTION_PROMPT =
  '用一句中文概括这张图片的关键内容（不超过 30 个字），供未来检索记忆使用。只输出这句话本身，不要解释。'

/** 一个 provider 的 OpenAI 兼容客户端。 */
class OpenAICompatClient {
  /**
   * @param {object} options
   * @param {string} options.label provider 显示名（用于错误信息）
   * @param {string} options.baseUrl 嵌入接口 Base URL
   * @param {string} options.apiKey 嵌入接口 Key
   * @param {string} options.embedModel 嵌入模型
   * @param {number} options.dimensions 期望向量维度
   * @param {boolean} [options.sendDimensions] 是否发送 dimensions 参数
   * @param {string} [options.visionModel] 视觉模型（空=不可用）
   * @param {string} [options.visionBaseUrl] 视觉接口 Base URL（空=同 baseUrl）
   * @param {string} [options.visionApiKey] 视觉接口 Key（空=同 apiKey）
   * @param {object} [options.logger]
   */
  constructor(options) {
    this.label = String(options.label ?? '云端')
    this.baseUrl = String(options.baseUrl ?? '').replace(/\/+$/, '')
    this.apiKey = String(options.apiKey ?? '')
    this.embedModel = String(options.embedModel ?? '')
    this.dimensions = Number(options.dimensions)
    this.sendDimensions = options.sendDimensions !== false
    this.visionModel = String(options.visionModel ?? '')
    this.visionBaseUrl = String(options.visionBaseUrl ?? '').replace(/\/+$/, '') || this.baseUrl
    this.visionApiKey = String(options.visionApiKey ?? '') || this.apiKey
    this.logger = options.logger ?? console
  }

  /** 嵌入接口是否已配置完整。 */
  get embeddingConfigured() {
    return this.baseUrl !== '' && this.apiKey !== '' && this.embedModel !== ''
  }

  /** 视觉概览是否可用。 */
  get captionConfigured() {
    return this.visionModel !== '' && this.visionBaseUrl !== '' && this.visionApiKey !== ''
  }

  async #post(url, apiKey, body, { signal, timeoutMs = 20000 } = {}) {
    let response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: combineSignal(signal, timeoutMs),
      })
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new Error(`${this.label} 请求超时（${url}）`)
      }
      throw new Error(`无法连接 ${this.label} API：${errorText(error)}`)
    }
    if (!response.ok) throw new Error(await failure(response, this.label))
    try {
      return await response.json()
    } catch (error) {
      throw new Error(`${this.label} API 返回了非 JSON 响应：${errorText(error)}`)
    }
  }

  /** 校验嵌入响应并返回向量。 */
  #vectorOf(payload) {
    const embedding = payload?.data?.[0]?.embedding
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error(`${this.label} 嵌入响应缺少向量：${JSON.stringify(payload).slice(0, 300)}`)
    }
    if (Number.isFinite(this.dimensions) && this.dimensions > 0 && embedding.length !== this.dimensions) {
      throw new Error(
        `嵌入维度不一致：provider 配置 ${this.dimensions}，服务返回 ${embedding.length}。请修改 provider 的维度配置，或调整 Qdrant 集合维度。`,
      )
    }
    return embedding
  }

  /** 拉取该 provider 的模型列表（GET /models，OpenAI 兼容）。 */
  async listModels({ signal, timeoutMs = 15000 } = {}) {
    if (!this.baseUrl) throw new Error(`${this.label} 未配置 Base URL`)
    const url = `${this.baseUrl}/models`
    let response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' },
        signal: combineSignal(signal, timeoutMs),
      })
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new Error(`${this.label} 请求超时（${url}）`)
      }
      throw new Error(`无法连接 ${this.label} API：${errorText(error)}`)
    }
    if (!response.ok) throw new Error(await failure(response, this.label))
    const payload = await response.json().catch(() => null)
    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : []
    return rows
      .map((row) => ({
        id: String(row?.id ?? row?.name ?? '').trim(),
        ownedBy: row?.owned_by ? String(row.owned_by) : '',
        created: Number(row?.created) || 0,
      }))
      .filter((row) => row.id)
  }

  /** 文本嵌入。 */
  async embedText(text, { signal, timeoutMs = 15000 } = {}) {
    if (!this.embeddingConfigured) {
      throw new Error(`${this.label} 的嵌入配置不完整（Base URL / Key / 模型）`)
    }
    const startedAt = Date.now()
    const body = { model: this.embedModel, input: String(text ?? ''), encoding_format: 'float' }
    if (this.sendDimensions && Number.isFinite(this.dimensions) && this.dimensions > 0) {
      body.dimensions = this.dimensions
    }
    const payload = await this.#post(`${this.baseUrl}/embeddings`, this.apiKey, body, { signal, timeoutMs })
    return {
      vector: this.#vectorOf(payload),
      usage: payload?.usage ?? null,
      latencyMs: Date.now() - startedAt,
    }
  }

  /**
   * 通用对话补全（用于记忆整理/摘要）。
   * @param {object} options
   * @param {Array<{role:string,content:string}>} options.messages
   * @param {string} [options.model] 覆盖默认模型（整理模型）
   * @param {number} [options.maxTokens]
   * @param {number} [options.temperature]
   */
  async chat({ messages, model, maxTokens = 1024, temperature = 0.3, signal, timeoutMs = 120000 }) {
    const chatModel = String(model ?? this.visionModel ?? '').trim()
    if (!chatModel) throw new Error(`${this.label} 未配置整理/对话模型`)
    if (!this.baseUrl || !this.apiKey) throw new Error(`${this.label} 的接口配置不完整`)
    const startedAt = Date.now()
    const body = {
      model: chatModel,
      messages,
      max_tokens: Math.max(16, Math.min(8192, Number(maxTokens) || 1024)),
      temperature,
      stream: false,
    }
    const payload = await this.#post(`${this.baseUrl}/chat/completions`, this.apiKey, body, { signal, timeoutMs })
    return {
      text: contentText(payload?.choices?.[0]?.message?.content).trim(),
      usage: payload?.usage ?? null,
      latencyMs: Date.now() - startedAt,
      model: chatModel,
    }
  }

  /** 用视觉对话模型给图片生成一句话概览。 */
  async captionImage(dataUri, { signal, timeoutMs = 60000, prompt, maxTokens = 96 } = {}) {
    if (!this.captionConfigured) {
      throw new Error(`${this.label} 未配置可用的视觉模型（visionModel）`)
    }
    const startedAt = Date.now()
    const body = {
      model: this.visionModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt || DEFAULT_CAPTION_PROMPT },
            { type: 'image_url', image_url: { url: dataUri } },
          ],
        },
      ],
      max_tokens: Math.max(16, Math.min(1024, Number(maxTokens) || 96)),
      temperature: 0.2,
    }
    const payload = await this.#post(`${this.visionBaseUrl}/chat/completions`, this.visionApiKey, body, {
      signal,
      timeoutMs,
    })
    return {
      text: contentText(payload?.choices?.[0]?.message?.content).trim(),
      usage: payload?.usage ?? null,
      latencyMs: Date.now() - startedAt,
    }
  }
}
// ===== src/lib/app/maintenance-service.js =====
/**
 * MaintenanceService：记忆集合的读取/维护/迁移（v0.7 R3）。
 * 负责：按层级统计、收集记忆（含向量）、批量删除/更新、增强记忆到期清理、
 * 相似检索辅助、旧记忆迁移、保留策略与定期维护。
 * 依赖注入 MemoryService 的基础设施方法（ensureReady/qdrant/storage/maintenanceOptions/stats）。
 */



class MaintenanceService {
  /** @param {import('./memory-service.js').MemoryService} service */
  constructor(service) {
    this.service = service
    this.logger = service.logger
  }

  get stats() {
    return this.service.stats
  }

  ensureReady(...args) { return this.service.ensureReady(...args) }
  qdrant() { return this.service.qdrant() }
  storage() { return this.service.storage() }
  maintenanceOptions() { return this.service.maintenanceOptions() }

  async countByLevel() {
    const counts = { 0: 0, 1: 0, 2: 0, 3: 0 }
    try {
      await this.ensureReady()
      const qdrant = await this.qdrant()
      const storage = this.storage()
      for (const level of [0, 1, 2, 3]) {
        try {
          counts[level] = await qdrant.count(storage.collection, {
            filter: { must: [{ key: 'level', match: { value: level } }] },
            exact: true,
          })
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* collection 不可用时保持 0 */
    }
    return counts
  }

  /**
   * 滚动收集符合过滤条件的记忆（含向量，供整理/事件合并使用）。
   * @returns {Promise<Array<{id:string, vector:number[]|null, payload:object}>>}
   */
  async collectMemories({ filter, withVector = false, maxItems = 2000, orderBy } = {}) {
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    const items = []
    let offset
    for (let page = 0; page < 200 && items.length < maxItems; page += 1) {
      const { points, nextOffset } = await qdrant.scroll(storage.collection, {
        limit: Math.min(256, maxItems - items.length),
        offset,
        orderBy,
        filter,
        withPayload: true,
        withVector,
      })
      for (const point of points) {
        items.push({
          id: String(point.id),
          vector: Array.isArray(point.vector) ? point.vector : (point.vector?.default ?? null),
          payload: point.payload ?? {},
        })
      }
      if (!nextOffset || points.length === 0) break
      offset = nextOffset
    }
    return items
  }

  /** 收集某一天（按配置时区）的原始记忆（level=0）。 */
  async collectRawForDay(dayStart, dayEnd, { withVector = false, maxItems = 2000 } = {}) {
    return this.collectMemories({
      filter: {
        must: [
          { key: 'level', match: { value: 0 } },
          { key: 'ts', range: { gte: dayStart, lte: dayEnd } },
        ],
      },
      withVector,
      maxItems,
      orderBy: { key: 'ts', direction: 'asc' },
    })
  }

  /** 收集某个批次产出的记忆。 */
  async collectBatchMemories(batch, { withVector = false, maxItems = 2000 } = {}) {
    return this.collectMemories({
      filter: { must: [{ key: 'batch', match: { value: String(batch) } }] },
      withVector,
      maxItems,
      orderBy: { key: 'ts', direction: 'asc' },
    })
  }

  /** 批量删除记忆（整理后清理原文）。 */
  async deleteMemoryIds(ids) {
    const list = (ids ?? []).map(String).filter(Boolean)
    if (list.length === 0) return 0
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    for (let index = 0; index < list.length; index += 200) {
      await qdrant.deletePoints(storage.collection, list.slice(index, index + 200))
    }
    return list.length
  }

  /** 批量更新记忆 payload（迁移/增强到期等）。 */
  async updateMemoryPayload(ids, payload) {
    const list = (ids ?? []).map(String).filter(Boolean)
    if (list.length === 0) return 0
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    for (let index = 0; index < list.length; index += 200) {
      await qdrant.setPayload(storage.collection, payload, list.slice(index, index + 200))
    }
    return list.length
  }

  /** 列出已到期的增强记忆 id。 */
  async listExpiredEnhanced(now = Date.now()) {
    const items = await this.collectMemories({
      filter: {
        must: [
          { key: 'enhanced', match: { value: true } },
          { key: 'expiresAt', range: { lt: now } },
        ],
      },
      withVector: false,
      maxItems: 5000,
    })
    return items.map((item) => item.id)
  }

  /** 向量相似检索（供事件合并使用）。 */
  async searchSimilar(vector, { limit = 5, threshold = 0.85, excludeIds = [] } = {}) {
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    const exclude = new Set((excludeIds ?? []).map(String))
    const points = await qdrant.search(storage.collection, {
      vector,
      limit: Math.max(limit + exclude.size, limit),
      scoreThreshold: threshold,
      withPayload: true,
    })
    return points
      .filter((point) => !exclude.has(String(point.id)))
      .slice(0, limit)
      .map((point) => ({
        id: String(point.id),
        score: Number(point.score) || 0,
        text: String(point.payload?.text ?? ''),
        kind: String(point.payload?.kind ?? ''),
        ts: Number(point.payload?.ts) || 0,
        level: Number(point.payload?.level) || 0,
        batch: point.payload?.batch ? String(point.payload.batch) : '',
        enhanced: point.payload?.enhanced === true,
      }))
  }

  /** 整理用的 LLM 客户端（provider 可单独配置，模型名覆盖）。 */

  /** 迁移：给旧记忆补 level=0 / batch=''（只对缺失 level 的记录处理一次）。 */
  async migrateLegacyMemories() {
    try {
      await this.ensureReady()
      const qdrant = await this.qdrant()
      const storage = this.storage()
      const legacy = []
      let offset
      for (let page = 0; page < 100; page += 1) {
        const { points, nextOffset } = await qdrant.scroll(storage.collection, {
          limit: 256,
          offset,
          withPayload: true,
          withVector: false,
        })
        for (const point of points) {
          if (point.payload === undefined || point.payload?.level === undefined) legacy.push(String(point.id))
        }
        if (!nextOffset || points.length === 0) break
        offset = nextOffset
      }
      if (legacy.length > 0) {
        await this.updateMemoryPayload(legacy, { level: 0, batch: '' })
        this.logger.info?.(`[dsh-memory] 已为 ${legacy.length} 条旧记忆补齐整理标签`)
      }
      return legacy.length
    } catch (error) {
      this.logger.warn?.(`[dsh-memory] 旧记忆迁移失败：${errorText(error)}`)
      return 0
    }
  }

  /** 给 v0.6 旧记忆补齐动态召回字段（anchorTs/importance/confidence/accessEvents/exposureCount）。 */
  async migrateDynamicFields() {
    try {
      await this.ensureReady()
      const qdrant = await this.qdrant()
      const storage = this.storage()
      const patches = []
      let offset
      for (let page = 0; page < 100; page += 1) {
        const { points, nextOffset } = await qdrant.scroll(storage.collection, {
          limit: 256,
          offset,
          withPayload: true,
          withVector: false,
        })
        for (const point of points) {
          const payload = point.payload ?? {}
          if (payload.anchorTs !== undefined && payload.importance !== undefined && payload.confidence !== undefined) continue
          const kind = payload.kind ?? 'note'
          patches.push({
            id: String(point.id),
            payload: {
              anchorTs: Number(payload.dayRange?.from) || Number(payload.ts) || Date.now(),
              importance: defaultImportance(kind),
              confidence: defaultConfidence(kind),
              accessEvents: Array.isArray(payload.accessEvents) ? payload.accessEvents : [],
              exposureCount: Number(payload.exposureCount) || 0,
              lastAccessAt: Number(payload.lastAccessAt) || 0,
              lastExposedAt: Number(payload.lastExposedAt) || 0,
              needsReview: payload.needsReview === true,
            },
          })
        }
        if (!nextOffset || points.length === 0) break
        offset = nextOffset
      }
      for (const patch of patches) {
        await qdrant.setPayload(storage.collection, patch.payload, [patch.id])
      }
      if (patches.length > 0) this.logger.info?.(`[dsh-memory] 已为 ${patches.length} 条旧记忆补齐动态召回字段`)
      return patches.length
    } catch (error) {
      this.logger.warn?.(`[dsh-memory] 动态召回字段迁移失败：${errorText(error)}`)
      return 0
    }
  }

  // ------------------------------------------------------------------
  // 定期维护
  // ------------------------------------------------------------------

  /**
   * 定期维护：过期清理 → 超限淘汰 → 相似重复合并 → 索引重建。
   * @returns {Promise<object>} 维护结果
   */
  async maintenance({ force = false } = {}) {
    const options = this.maintenanceOptions()
    const info = await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    const result = {
      ok: true,
      startedAt: Date.now(),
      collection: storage.collection,
      pointsBefore: info?.points ?? null,
      expired: 0,
      overflow: 0,
      duplicates: 0,
      errors: [],
    }
    try {
      // 1) 过期清理
      if (options.retentionDays > 0 || force) {
        const cutoff = Date.now() - options.retentionDays * 86400000
        if (options.retentionDays > 0) {
          const before = await qdrant.count(storage.collection, { exact: true })
          await qdrant.deleteByFilter(storage.collection, {
            must: [{ key: 'ts', range: { lt: cutoff } }],
          })
          const after = await qdrant.count(storage.collection, { exact: true })
          result.expired = Math.max(0, before - after)
        }
      }
      // 2) 条数上限淘汰（从最旧开始）
      if (options.maxMemories > 0) {
        let count = await qdrant.count(storage.collection, { exact: true })
        let guard = 0
        while (count > options.maxMemories && guard < 100) {
          guard += 1
          const excess = count - options.maxMemories
          const { points } = await qdrant.scroll(storage.collection, {
            limit: Math.min(256, excess),
            orderBy: { key: 'ts', direction: 'asc' },
          })
          if (points.length === 0) break
          const ids = points.map((point) => String(point.id))
          await qdrant.deletePoints(storage.collection, ids)
          result.overflow += ids.length
          count -= ids.length
        }
      }
      // 3) 相似重复合并（只扫描最近的 N 条）
      if (options.maintenanceDedupe) {
        const { points } = await qdrant.scroll(storage.collection, {
          limit: options.dedupeMaxScan,
          orderBy: { key: 'ts', direction: 'desc' },
          withPayload: true,
          withVector: true,
        })
        const deleted = new Set()
        const byId = new Map(points.map((point) => [String(point.id), point]))
        for (const point of points) {
          const id = String(point.id)
          if (deleted.has(id)) continue
          const vector = Array.isArray(point.vector) ? point.vector : point.vector?.default ?? null
          if (!Array.isArray(vector)) continue
          let similar = []
          try {
            similar = await qdrant.search(storage.collection, {
              vector,
              limit: 5,
              scoreThreshold: options.dedupeThreshold,
            })
          } catch (error) {
            result.errors.push(`dedupe search: ${errorText(error)}`)
            break
          }
          for (const candidate of similar) {
            const candidateId = String(candidate.id)
            if (candidateId === id || deleted.has(candidateId)) continue
            const other = byId.get(candidateId)
            const otherTs = Number(other?.payload?.ts) || Number(candidate?.payload?.ts) || 0
            const selfTs = Number(point?.payload?.ts) || 0
            const olderId = otherTs < selfTs ? candidateId : id
            const keepId = olderId === candidateId ? id : candidateId
            if (olderId === id) {
              // 自己更旧：删自己，跳出（也把 candidate 标记为已处理）
              deleted.add(id)
              try {
                await qdrant.deletePoints(storage.collection, [id])
                result.duplicates += 1
              } catch (error) {
                result.errors.push(`dedupe delete: ${errorText(error)}`)
              }
              break
            }
            deleted.add(candidateId)
            try {
              await qdrant.deletePoints(storage.collection, [candidateId])
              result.duplicates += 1
            } catch (error) {
              result.errors.push(`dedupe delete: ${errorText(error)}`)
            }
            void keepId
          }
        }
      }
      // 4) 索引重建（幂等）
      await qdrant.ensurePayloadIndexes(storage.collection)
    } catch (error) {
      result.ok = false
      result.errors.push(errorText(error))
    }
    result.finishedAt = Date.now()
    result.durationMs = result.finishedAt - result.startedAt
    this.stats.lastMaintenanceAt = result.finishedAt
    this.stats.lastMaintenance = result
    if (options.debug || result.errors.length > 0) {
      this.logger.info?.(
        `[dsh-memory] 维护完成：过期 ${result.expired}，超限 ${result.overflow}，重复 ${result.duplicates}，错误 ${result.errors.length}`,
      )
    }
    return result
  }

  // ------------------------------------------------------------------
  // 状态 / 测试
  // ------------------------------------------------------------------

  /** 设置页状态快照。 */
}
// ===== src/lib/app/model-router.js =====
/**
 * ModelRouter：provider / 凭据 / 模型路由（v0.7 R3）。
 *
 * 负责：
 * - 多 provider 档案解析与凭据读取；
 * - 嵌入/视觉客户端构造；
 * - DSH 模型目录读取（ctx.llm）与对话调用；
 * - 功能模型来源路由（整理：DSH / 自定义；图片概览：DSH / 自定义）。
 *
 * 依赖注入：构造时传入 MemoryService（读取 cfg/logger/ctx），不反向依赖 service 的其他业务方法。
 */



/** provider 列表为空时的内置兜底配置（与 bundle 默认值一致）。 */
const BUILTIN_PROVIDER = {
  id: 'siliconflow',
  name: '硅基流动 SiliconFlow',
  protocol: 'openai',
  baseUrl: 'https://api.siliconflow.cn/v1',
  embedModel: 'Qwen/Qwen3-VL-Embedding-8B',
  dimensions: 1024,
  apiKeyEnv: 'SILICONFLOW_API_KEY',
  sendDimensions: true,
  visionModel: 'Qwen/Qwen3-VL-8B-Instruct',
  visionBaseUrl: '',
  visionApiKeyEnv: '',
}

/** 规范化的空 provider 字段。 */
function emptyProvider() {
  return {
    id: '',
    name: '',
    protocol: 'openai',
    baseUrl: '',
    embedModel: '',
    dimensions: 1024,
    apiKeyEnv: '',
    sendDimensions: true,
    visionModel: '',
    visionBaseUrl: '',
    visionApiKeyEnv: '',
  }
}

/** 把任意 provider 记录规范化（字符串修剪、维度取整、缺省补全）。 */
function normalizeProvider(raw, index) {
  const base = emptyProvider()
  const value = raw && typeof raw === 'object' ? raw : {}
  const id = String(value.id ?? base.id).trim() || `provider_${index + 1}`
  return {
    id,
    name: String(value.name ?? '').trim() || id,
    protocol: String(value.protocol ?? 'openai').trim() || 'openai',
    baseUrl: normalizeUrl(value.baseUrl ?? ''),
    embedModel: String(value.embedModel ?? '').trim(),
    dimensions: clampInt(value.dimensions, base.dimensions, 1, 65536),
    apiKeyEnv: String(value.apiKeyEnv ?? '').trim(),
    sendDimensions: asBool(value.sendDimensions, true),
    visionModel: String(value.visionModel ?? '').trim(),
    visionBaseUrl: normalizeUrl(value.visionBaseUrl ?? ''),
    visionApiKeyEnv: String(value.visionApiKeyEnv ?? '').trim(),
  }
}

class ModelRouter {
  /** @param {import('./memory-service.js').MemoryService} service */
  constructor(service) {
    this.service = service
    this.ctx = service.ctx
    this.logger = service.logger
  }

  /** 当前配置（解包 volatile）。 */
  cfg() {
    return this.service.cfg()
  }

  providers() {
    const raw = this.cfg().providers
    const list = Array.isArray(raw) ? raw : []
    const normalized = list
      .map((item, index) => normalizeProvider(item, index))
      .filter((item) => item.baseUrl !== '' && item.embedModel !== '')
    return normalized.length > 0 ? normalized : [normalizeProvider(BUILTIN_PROVIDER, 0)]
  }

  /** 当前激活的 provider。 */
  activeProvider() {
    const cfg = this.cfg()
    const list = this.providers()
    const wanted = String(cfg.activeProvider ?? '').trim()
    return list.find((item) => item.id === wanted) ?? list[0]
  }

  /** 按 id 查找 provider。 */
  providerById(id) {
    const key = String(id ?? '').trim()
    return this.providers().find((item) => item.id === key) ?? null
  }

  /** provider 的 Key 在凭据库中的引用名。 */
  credentialRef(provider) {
    const explicit = String(provider?.apiKeyEnv ?? '').trim()
    return explicit || providerIdToEnv(provider?.id)
  }

  /** 视觉概览接口配置（visionBaseUrl / visionApiKeyEnv 可覆盖）。 */
  visionConfigOf(provider) {
    const base = provider?.visionBaseUrl || provider?.baseUrl || ''
    const ref = String(provider?.visionApiKeyEnv ?? '').trim() || this.credentialRef(provider)
    return { baseUrl: normalizeUrl(base), model: String(provider?.visionModel ?? '').trim(), ref }
  }

  /** DSH 已配置的 LLM provider 列表（合并可配置目录与当前 live 路由）。 */
  async dshProviders() {
    let configurable = []
    let live = []
    try {
      configurable = await this.ctx.llm.listConfigurableProviders()
    } catch { /* ignore */ }
    try {
      live = await this.ctx.llm.listProviders()
    } catch { /* ignore */ }
    const providers = []
    const seen = new Set()
    for (const entry of configurable ?? []) {
      const id = String(entry?.provider ?? '').trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      providers.push({
        id,
        name: String(entry?.displayName ?? id),
        settingsNs: String(entry?.settingsNs ?? ''),
        declared: entry?.declared === true,
        live: (live ?? []).some((item) => item.id === id),
      })
    }
    for (const entry of live ?? []) {
      const id = String(entry?.id ?? '').trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      providers.push({ id, name: String(entry?.name ?? id), settingsNs: '', declared: false, live: true })
    }
    return providers
  }

  /** DSH 模型目录：providers + 每个 live provider 的模型 + 当前默认模型。 */
  async dshCatalog() {
    const providers = await this.dshProviders()
    const models = {}
    for (const provider of providers) {
      if (!provider.live) continue
      try {
        models[provider.id] = (await this.ctx.llm.listModels(provider.id)).map((item) => ({
          id: String(item?.id ?? ''),
          name: String(item?.name ?? item?.id ?? ''),
          inputModalities: Array.isArray(item?.inputModalities) ? item.inputModalities.map(String) : [],
        }))
      } catch (error) {
        models[provider.id] = []
      }
    }
    let defaultModel = null
    try {
      const selection = this.ctx.agentDefaultModel?.currentSelection?.()
      defaultModel = selection ? { provider: selection.provider, model: selection.model } : null
    } catch { /* ignore */ }
    return { providers, models, defaultModel }
  }

  /** 当前 DSH 默认模型选择（provider/model）。 */
  dshDefaultSelection() {
    try {
      const selection = this.ctx.agentDefaultModel?.currentSelection?.()
      if (selection?.provider && selection?.model) return { provider: String(selection.provider), model: String(selection.model) }
    } catch { /* ignore */ }
    return null
  }

  /** 功能模型目标：优先读配置，留空回退 DSH 默认模型。 */
  dshTarget(provider, model, fallbackSelection = this.dshDefaultSelection()) {
    const providerId = String(provider ?? '').trim() || String(fallbackSelection?.provider ?? '')
    const modelId = String(model ?? '').trim() || String(fallbackSelection?.model ?? '')
    return { providerId, modelId }
  }

  /** 通过 DSH LLM 服务调用一次对话补全（流式聚合为文本）。 */
  async dshChat({ provider, model, system, messages, maxTokens = 1024, temperature = 0.3, reasoningEffort = 'off', signal }) {
    if (!this.ctx.llm || typeof this.ctx.llm.stream !== 'function') {
      throw new Error('DSH LLM 服务不可用')
    }
    const target = this.dshTarget(provider, model)
    if (!target.providerId || !target.modelId) throw new Error('尚未选择 DSH 模型')
    const startedAt = Date.now()
    const parts = []
    let usage = null
    let finish = null
    const requestMessages = (messages ?? []).map((message) => ({
      role: message.role,
      content:
        typeof message.content === 'string'
          ? [{ type: 'text', text: message.content }]
          : (message.content ?? []).map((block) =>
              typeof block === 'string' ? { type: 'text', text: block } : block,
            ),
    }))
    const stream = this.ctx.llm.stream({
      provider: target.providerId,
      model: target.modelId,
      system,
      messages: requestMessages,
      maxTokens,
      temperature,
      reasoningEffort,
      signal,
    })
    for await (const chunk of stream) {
      if (!chunk) continue
      if (chunk.type === 'text-delta') parts.push(chunk.text ?? '')
      else if (chunk.type === 'block-end' && chunk.block?.type === 'text') parts.push(chunk.block.text ?? '')
      else if (chunk.type === 'usage') usage = chunk.usage ?? null
      else if (chunk.type === 'finish') finish = chunk.reason ?? null
    }
    if (finish?.kind === 'error' || finish?.kind === 'aborted') {
      const failure = finish.failure
      throw new Error(`DSH 模型调用失败：${failure?.message ?? failure?.code ?? finish.kind}`)
    }
    const text = parts.join('').trim()
    if (!text) throw new Error('DSH 模型返回为空')
    return {
      text,
      latencyMs: Date.now() - startedAt,
      usage,
      provider: target.providerId,
      model: target.modelId,
      source: 'dsh',
    }
  }

  /** 通过 DSH LLM 服务做图片概览（图片以 attachment block 传入）。 */
  async dshCaption({ provider, model, ref, prompt, maxTokens = 300, signal }) {
    if (!ref) throw new Error('缺少图片附件引用')
    return this.dshChat({
      provider,
      model,
      maxTokens,
      temperature: 0.2,
      reasoningEffort: 'off',
      signal,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image', attachment: ref },
          ],
        },
      ],
    })
  }

  /** 整理/摘要调用：DSH 模型或插件自定义 provider 二选一。 */
  async consolidationChat({ system, messages = [], maxTokens = 1024, temperature = 0.3, signal }) {
    const cfg = this.cfg()
    const source = cfg.consolidationSource === 'custom' ? 'custom' : 'dsh'
    if (source === 'dsh') {
      const target = this.dshTarget(cfg.consolidationDshProvider, cfg.consolidationDshModel)
      if (target.providerId && target.modelId) {
        return this.dshChat({
          provider: target.providerId,
          model: target.modelId,
          system,
          messages,
          maxTokens,
          temperature,
          reasoningEffort: 'off',
          signal,
        })
      }
      throw new Error('DSH 默认模型不可用（请在 DSH 设置 → 模型 中配置）')
    }
    const llm = await this.consolidationClient()
    if (!llm) throw new Error('未配置自定义整理模型')
    const response = await llm.client.chat({ model: llm.model, messages, maxTokens, temperature, signal })
    return {
      text: response.text,
      latencyMs: response.latencyMs,
      usage: response.usage,
      provider: llm.provider.id,
      model: llm.model,
      source: 'custom',
    }
  }

  /** 图片概览的目标 provider / 模型（支持在“模型列表”里单独指定）。 */
  captionTarget() {
    const cfg = this.cfg()
    const provider =
      (cfg.captionProviderId && this.providerById(cfg.captionProviderId)) || this.activeProvider()
    const vision = this.visionConfigOf(provider)
    const model = String(cfg.captionModel ?? '').trim() || vision.model
    return { provider, vision, model }
  }

  /** 拉取 provider 的模型列表（供设置页“模型列表”使用）。 */
  async listProviderModels(providerId) {
    const provider =
      (providerId && this.providerById(providerId)) || this.activeProvider()
    const client = await this.clientFor(provider)
    const models = await client.listModels()
    return {
      ok: true,
      provider: { id: provider.id, name: provider.name, baseUrl: provider.baseUrl },
      models,
    }
  }

  /** 读取凭据值（空字符串代表未配置）。 */
  async resolveKey(ref) {
    const name = String(ref ?? '').trim()
    if (!name) return ''
    try {
      const resolved = await this.ctx.credentials.resolve(name)
      return resolved?.value ?? ''
    } catch (error) {
      this.logger.warn?.(`[dsh-memory] 读取凭据 ${name} 失败：${errorText(error)}`)
      return ''
    }
  }

  /** 凭据状态（不含密钥本身）。 */
  async credentialInfo(ref) {
    const name = String(ref ?? '').trim()
    if (!name) return { configured: false, writable: true, source: '', ref: '' }
    try {
      const info = await this.ctx.credentials.describe(name)
      return { ...info, ref: name }
    } catch (error) {
      return { configured: false, writable: false, source: '', ref: name, error: errorText(error) }
    }
  }

  /** 为指定 provider 构造 OpenAI 兼容客户端。 */
  async clientFor(provider) {
    const embeddingRef = this.credentialRef(provider)
    const embeddingKey = await this.resolveKey(embeddingRef)
    const vision = this.visionConfigOf(provider)
    const visionKey = vision.ref === embeddingRef ? embeddingKey : await this.resolveKey(vision.ref)
    if (!embeddingKey) {
      throw new Error(
        `尚未配置 ${provider.name}（${provider.id}）的 API Key：请在 Settings → 长期记忆 → 模型与向量库 中填写（凭据引用 ${embeddingRef}）`,
      )
    }
    return new OpenAICompatClient({
      label: provider.name || provider.id,
      baseUrl: provider.baseUrl,
      apiKey: embeddingKey,
      embedModel: provider.embedModel,
      dimensions: provider.dimensions,
      sendDimensions: provider.sendDimensions,
      visionModel: vision.model,
      visionBaseUrl: vision.baseUrl,
      visionApiKey: visionKey,
      logger: this.logger,
    })
  }

  // ------------------------------------------------------------------
  // 行为 / 存储 / 范围
  // ------------------------------------------------------------------

  /** 存储配置。 */

  async consolidationClient() {
    const cfg = this.cfg()
    const provider =
      (cfg.consolidationProviderId && this.providerById(cfg.consolidationProviderId)) || this.activeProvider()
    const model = String(cfg.consolidationModel ?? '').trim()
    if (!model) return null
    const client = await this.clientFor(provider)
    return { client, provider, model }
  }
}
// ===== src/lib/adapters/qdrant/client.js =====
/**
 * Qdrant REST 客户端（只用 HTTP API，不需要额外依赖）。
 * 与 Qdrant 同机部署时默认 http://127.0.0.1:6333，无需 API Key；
 * 如需鉴权，可从 DSH 凭据库读取 api-key。
 */


function joinUrl(base, path) {
  return `${String(base ?? '').replace(/\/+$/, '')}${path}`
}

class QdrantClient {
  constructor(options = {}) {
    this.url = String(options.url ?? 'http://127.0.0.1:6333').replace(/\/+$/, '')
    this.apiKey = options.apiKey ? String(options.apiKey) : ''
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 8000
    this.logger = options.logger ?? console
  }

  async request(method, path, body, { timeoutMs = this.timeoutMs, signal } = {}) {
    const timeout = AbortSignal.timeout(Math.max(500, timeoutMs))
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    const headers = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (this.apiKey) headers['api-key'] = this.apiKey
    let response
    try {
      response = await fetch(joinUrl(this.url, path), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: combined,
      })
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new Error(`Qdrant 请求超时（${method} ${path}）`)
      }
      throw new Error(`无法连接 Qdrant（${this.url}）：${errorText(error)}`)
    }
    const text = await response.text()
    let payload
    try {
      payload = text === '' ? undefined : JSON.parse(text)
    } catch {
      payload = text.slice(0, 400)
    }
    if (!response.ok) {
      const detail = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {}).slice(0, 500)
      throw new Error(`Qdrant 返回 ${response.status}（${method} ${path}）：${detail}`)
    }
    return payload
  }

  /** Qdrant 版本与健康状态。 */
  async health() {
    const payload = await this.request('GET', '/', undefined, { timeoutMs: 4000 })
    return { ok: true, title: payload?.title ?? 'qdrant', version: payload?.version ?? null }
  }

  /** 集合信息；不存在返回 null。 */
  async collectionInfo(collection) {
    try {
      const payload = await this.request('GET', `/collections/${encodeURIComponent(collection)}`)
      const result = payload?.result
      if (result === undefined || result === null) return null
      const vectors = result?.config?.params?.vectors
      return {
        name: collection,
        points: result?.points_count ?? 0,
        indexed: result?.indexed_vectors_count ?? 0,
        status: result?.status ?? null,
        size: typeof vectors?.size === 'number' ? vectors.size : null,
        distance: vectors?.distance ?? null,
        payloadIndexes: Object.keys(result?.payload_schema ?? {}),
      }
    } catch (error) {
      const message = errorText(error)
      if (message.includes('404') || message.includes('Not found') || message.includes('not found')) {
        return null
      }
      throw error
    }
  }

  /** 确保集合存在且维度正确。 */
  async ensureCollection(collection, size) {
    const existing = await this.collectionInfo(collection)
    if (existing === null) {
      await this.request('PUT', `/collections/${encodeURIComponent(collection)}`, {
        vectors: { size, distance: 'Cosine' },
        on_disk_payload: true,
      })
      const info = { name: collection, points: 0, size, distance: 'Cosine', payloadIndexes: [] }
      await this.ensurePayloadIndexes(collection)
      return { ok: true, created: true, info: { ...info, payloadIndexes: ['kind', 'sessionId', 'cwd', 'ts'] } }
    }
    if (existing.size !== null && existing.size !== size) {
      return {
        ok: false,
        created: false,
        error: `集合 "${collection}" 的向量维度是 ${existing.size}，而当前激活 provider 的维度是 ${size}。请在设置页点“重建集合”，或切换到维度匹配的 provider。`,
        info: existing,
      }
    }
    await this.ensurePayloadIndexes(collection)
    return { ok: true, created: false, info: existing }
  }

  /** 确保列表/排序/过滤需要的 payload 索引存在（幂等、尽力而为）。 */
  async ensurePayloadIndexes(collection) {
    const indexes = [
      { field_name: 'kind', field_schema: 'keyword' },
      { field_name: 'sessionId', field_schema: 'keyword' },
      { field_name: 'cwd', field_schema: 'keyword' },
      { field_name: 'ts', field_schema: 'integer' },
    ]
    for (const index of indexes) {
      try {
        await this.request('PUT', `/collections/${encodeURIComponent(collection)}/index`, index, {
          timeoutMs: 5000,
        })
      } catch (error) {
        this.logger?.warn?.(`[dsh-memory] 创建 Qdrant 索引 ${index.field_name} 失败：${errorText(error)}`)
      }
    }
  }

  /** 写入/覆盖 points。 */
  async upsert(collection, points, { wait = true, signal } = {}) {
    return this.request(
      'PUT',
      `/collections/${encodeURIComponent(collection)}/points?wait=${wait ? 'true' : 'false'}`,
      { points },
      { signal },
    )
  }

  /** 向量检索。 */
  async search(collection, { vector, limit = 5, scoreThreshold, filter, withPayload = true }, { signal } = {}) {
    const body = { vector, limit, with_payload: withPayload, with_vector: false }
    if (Number.isFinite(scoreThreshold)) body.score_threshold = scoreThreshold
    if (filter !== undefined) body.filter = filter
    const payload = await this.request(
      'POST',
      `/collections/${encodeURIComponent(collection)}/points/search`,
      body,
      { signal },
    )
    return Array.isArray(payload?.result) ? payload.result : []
  }

  /** 统计 points 数量（可带过滤条件）。 */
  async count(collection, { filter, exact = false, signal } = {}) {
    const body = { exact }
    if (filter !== undefined) body.filter = filter
    const payload = await this.request(
      'POST',
      `/collections/${encodeURIComponent(collection)}/points/count`,
      body,
      { signal },
    )
    return payload?.result?.count ?? 0
  }

  /** 按时间/过滤条件滚动读取 points（游标分页）。 */
  async scroll(collection, { limit = 20, offset, orderBy, filter, withPayload = true, withVector = false } = {}) {
    const body = { limit, with_payload: withPayload, with_vector: withVector }
    if (offset !== undefined && offset !== null) body.offset = offset
    if (orderBy !== undefined) body.order_by = orderBy
    if (filter !== undefined) body.filter = filter
    const payload = await this.request(
      'POST',
      `/collections/${encodeURIComponent(collection)}/points/scroll`,
      body,
      { timeoutMs: 12000 },
    )
    const points = payload?.result?.points ?? []
    return { points, nextOffset: payload?.result?.next_page_offset ?? null }
  }

  /** 给指定 id 覆盖/合并 payload 字段（用于迁移与增强记忆到期标记）。 */
  async setPayload(collection, payload, ids, { signal } = {}) {
    return this.request(
      'POST',
      `/collections/${encodeURIComponent(collection)}/points/payload?wait=true`,
      { payload, points: ids },
      { signal },
    )
  }

  /** 删除指定 id 的 points。 */
  async deletePoints(collection, ids, { signal } = {}) {
    return this.request(
      'POST',
      `/collections/${encodeURIComponent(collection)}/points/delete?wait=true`,
      { points: ids },
      { signal },
    )
  }

  /** 按过滤条件删除 points（保留策略使用）。 */
  async deleteByFilter(collection, filter, { signal } = {}) {
    return this.request(
      'POST',
      `/collections/${encodeURIComponent(collection)}/points/delete?wait=true`,
      { filter },
      { signal },
    )
  }

  /** 删除集合。 */
  async deleteCollection(collection) {
    return this.request('DELETE', `/collections/${encodeURIComponent(collection)}`)
  }

  /** 删除并重建集合（维度变更 / 清空记忆时使用）。 */
  async recreateCollection(collection, size) {
    try {
      await this.deleteCollection(collection)
    } catch {
      /* 不存在时忽略 */
    }
    return this.ensureCollection(collection, size)
  }
}
// ===== src/lib/domain/recall-policy.js =====
/**
 * 动态相关度召回策略（domain，纯函数）：
 * - freshness = exp(-ageDays / τ_level)（分层遗忘速度）
 * - required  = base + strictness × (1 - freshness)（越久越严格）
 * - effective = sim + 重要性/有效复述/置信度补偿
 * - 通过条件：effective >= required
 * - rank = sim×(0.5+0.5×freshness) + 0.15×importance + 0.10×rehearsal + 0.05×confidence
 *
 * 纯函数：now、参数、事件都由调用方传入，便于测试与回放。
 */


/** 默认参数（与 docs/MEMORY-FLOW.md 一致）。 */
const RECALL_POLICY_DEFAULTS = {
  enabled: true,
  baseMinScore: 0.42,
  toolBaseMinScore: 0.3,
  strictness: 0.35,
  toolStrictness: 0.2,
  maxRequired: 0.9,
  weightImportance: 0.2,
  weightRehearsal: 0.15,
  weightConfidence: 0.1,
  decayTauDays: { 0: 7, 1: 30, 2: 180, 3: 365 },
  rehearsalTauDays: 90,
  rehearsalMaxEvents: 20,
  candidates: 20,
}

const DAY_MS = 86400000
const LN_11 = Math.log(11)

/** 记忆年龄（天）：优先内容发生时间 anchorTs，其次 ts。 */
function ageDays(now, hit) {
  const anchor = Number(hit?.anchorTs) || Number(hit?.ts) || now
  return Math.max(0, (now - anchor) / DAY_MS)
}

/** 分层遗忘速度（天）。 */
function decayTauDays(level, taus = RECALL_POLICY_DEFAULTS.decayTauDays) {
  const key = Number(level) || 0
  return Number(taus?.[key]) > 0 ? Number(taus[key]) : RECALL_POLICY_DEFAULTS.decayTauDays[key] ?? 7
}

/** freshness = exp(-age/τ)，越久越接近 0。 */
function freshness(age, tauDays) {
  const tau = Number(tauDays) > 0 ? Number(tauDays) : 1
  return Math.exp(-Math.max(0, age) / tau)
}

/** 动态门槛：required = base + strictness×(1-freshness)，带上限 clamp。 */
function requiredScore({ baseMinScore, strictness, freshness: fresh, maxRequired }) {
  const base = Number.isFinite(Number(baseMinScore)) ? Number(baseMinScore) : RECALL_POLICY_DEFAULTS.baseMinScore
  const strict = Number.isFinite(Number(strictness)) ? Number(strictness) : RECALL_POLICY_DEFAULTS.strictness
  const max = Number.isFinite(Number(maxRequired)) ? Number(maxRequired) : RECALL_POLICY_DEFAULTS.maxRequired
  const value = base + strict * (1 - normalizeUnit(fresh, 0))
  return Math.min(max, Math.max(base, value))
}

/** 有效复述：Σ 分类权重 × exp(-(now-eventAt)/τ_rehearse)；被动曝光不进入。 */
function effectiveHits(events, now, tauDays = RECALL_POLICY_DEFAULTS.rehearsalTauDays) {
  if (!Array.isArray(events) || events.length === 0) return 0
  const tau = Number(tauDays) > 0 ? Number(tauDays) : RECALL_POLICY_DEFAULTS.rehearsalTauDays
  let total = 0
  for (const event of events) {
    const weight = Number(event?.weight)
    const at = Number(event?.at)
    if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(at)) continue
    total += weight * Math.exp(-Math.max(0, now - at) / (tau * DAY_MS))
  }
  return total
}

/** 复述补偿（对数增长，封顶 1）。 */
function rehearsalBoost(hits, weight = RECALL_POLICY_DEFAULTS.weightRehearsal) {
  const value = Math.max(0, Number(hits) || 0)
  return weight * Math.min(1, Math.log1p(value) / LN_11)
}

/**
 * 给一条候选计算动态门控与排序分。
 * @returns {object} 附带 freshness/required/effective/rank/passed 的新 hit
 */
function evaluateHit(hit, options, now) {
  const policy = { ...RECALL_POLICY_DEFAULTS, ...(options ?? {}) }
  const mode = options?.mode === 'tool' ? 'tool' : 'auto'
  const level = Number(hit?.level) || 0
  const age = ageDays(now, hit)
  const tau = decayTauDays(level, policy.decayTauDays)
  const fresh = freshness(age, tau)
  const baseMinScore = mode === 'tool' ? policy.toolBaseMinScore : policy.baseMinScore
  const strictness = mode === 'tool' ? policy.toolStrictness : policy.strictness
  const required = requiredScore({ baseMinScore, strictness, freshness: fresh, maxRequired: policy.maxRequired })
  const importance = normalizeUnit(hit?.importance, 0.5)
  const confidence = normalizeUnit(hit?.confidence, 0.5)
  const hits = effectiveHits(hit?.accessEvents, now, policy.rehearsalTauDays)
  const importanceBoost = policy.weightImportance * (importance - 0.5)
  const confidenceBoost = policy.weightConfidence * (confidence - 0.5)
  const rehBoost = rehearsalBoost(hits, policy.weightRehearsal)
  const sim = Number(hit?.score) || 0
  const effective = sim + importanceBoost + rehBoost + confidenceBoost
  const rank = sim * (0.5 + 0.5 * fresh) + 0.15 * importance + 0.1 * rehBoost + 0.05 * confidence
  return {
    ...hit,
    ageDays: Number(age.toFixed(3)),
    freshness: Number(fresh.toFixed(4)),
    requiredScore: Number(required.toFixed(4)),
    effectiveScore: Number(effective.toFixed(4)),
    rankScore: Number(rank.toFixed(4)),
    relevanceGatePassed: effective >= required,
    importance,
    confidence,
    rehearsalHits: Number(hits.toFixed(4)),
  }
}

/**
 * 对候选排序/门控（纯函数）。
 * @param {Array<object>} hits 来自向量检索的候选（score/level/anchorTs/importance/confidence/accessEvents）
 * @param {object} options enabled/baseMinScore/.../mode
 * @param {number} now
 * @returns {{pass:Array<object>, dropped:Array<object>}}
 */
function rankHits(hits, options = {}, now = Date.now()) {
  const policy = { ...RECALL_POLICY_DEFAULTS, ...(options ?? {}) }
  const evaluated = (hits ?? []).map((hit) => evaluateHit(hit, policy, now))
  const pass = evaluated.filter((hit) => hit.relevanceGatePassed).sort((a, b) => b.rankScore - a.rankScore)
  const dropped = evaluated.filter((hit) => !hit.relevanceGatePassed)
  return { pass, dropped }
}
// ===== src/lib/app/memory-service.js =====
/**
 * MemoryService：插件核心业务对象（v0.2）。
 *
 * 职责：
 * - 读取（会热更新的）插件配置；
 * - 多 provider 档案：解析激活的 provider、凭据、视觉模型；
 * - 嵌入文本并写入 Qdrant；
 * - 自动记录一轮对话要点 / 图片概览；
 * - 按记忆范围检索（全局 / 工作区 / 会话）；
 * - 记忆管理：列表、搜索、删除、导出、重建；
 * - 保留策略与定期维护（过期清理、超限淘汰、相似重复合并、索引重建）；
 * - 状态、测试、后台队列。
 */












/** 自动召回注入消息的 source.kind；DSH 会把它渲染成“上下文注入”行而不是用户气泡。 */
/** 自动召回上下文消息的标题前缀。 */
const RECALL_HEADER = '【长期记忆·自动召回】'

/** 选择合法的向量维度。 */
function pickDimensions(value) {
  const n = clampInt(value, 1024, 1, 65536)
  return DIMENSIONS.includes(n) ? n : n
}

/** 去掉 meta 里的 undefined / null，保证 payload 是纯 JSON。 */
function sanitizeMeta(meta) {
  const out = {}
  for (const [key, value] of Object.entries(meta ?? {})) {
    if (value === undefined || value === null) continue
    out[key] = value
  }
  return out
}

class MemoryService {
  /**
   * @param {object} ctx DSH 插件上下文
   * @param {object} config schemastery Config 实例（字段可能包着 volatile Ref）
   */
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    this.logger = ctx.logger ?? console
    this.models = new ModelRouter(this)
    this.maintenanceService = new MaintenanceService(this)
    this.queue = new SerialQueue(this.logger)
    this.stats = {
      startedAt: Date.now(),
      writes: 0,
      lastWriteAt: 0,
      lastWriteKind: null,
      lastRecallAt: 0,
      lastRecallCount: 0,
      recallChecks: 0,
      lastRecallQuery: '',
      lastRecallError: '',
      lastRecallInjectAt: 0,
      captions: 0,
      lastMaintenanceAt: 0,
      lastMaintenance: null,
    }
    this.collectionState = {
      signature: null,
      ok: false,
      error: null,
      checkedAt: 0,
      info: null,
    }
    /** 由 index.js 注入的睡眠控制器与整理引擎（避免循环依赖）。 */
    this.sleep = null
    this.consolidation = null
  }

  // ------------------------------------------------------------------
  // 模型 / provider 路由（R3：实现移到 app/model-router.js）
  // ------------------------------------------------------------------

  providers() { return this.models.providers() }
  activeProvider() { return this.models.activeProvider() }
  providerById(id) { return this.models.providerById(id) }
  credentialRef(provider) { return this.models.credentialRef(provider) }
  visionConfigOf(provider) { return this.models.visionConfigOf(provider) }
  async dshProviders() { return this.models.dshProviders() }
  async dshCatalog() { return this.models.dshCatalog() }
  dshDefaultSelection() { return this.models.dshDefaultSelection() }
  dshTarget(...args) { return this.models.dshTarget(...args) }
  async dshChat(options) { return this.models.dshChat(options) }
  async dshCaption(options) { return this.models.dshCaption(options) }
  async consolidationChat(options) { return this.models.consolidationChat(options) }
  captionTarget() { return this.models.captionTarget() }
  async listProviderModels(providerId) { return this.models.listProviderModels(providerId) }
  async resolveKey(ref) { return this.models.resolveKey(ref) }
  async credentialInfo(ref) { return this.models.credentialInfo(ref) }
  async clientFor(provider) { return this.models.clientFor(provider) }
  async consolidationClient() { return this.models.consolidationClient() }

  // ------------------------------------------------------------------
  // 维护 / 集合读取（R3：实现移到 app/maintenance-service.js）
  // ------------------------------------------------------------------

  countByLevel() { return this.maintenanceService.countByLevel() }
  collectMemories(options) { return this.maintenanceService.collectMemories(options) }
  collectRawForDay(...args) { return this.maintenanceService.collectRawForDay(...args) }
  collectBatchMemories(...args) { return this.maintenanceService.collectBatchMemories(...args) }
  deleteMemoryIds(ids) { return this.maintenanceService.deleteMemoryIds(ids) }
  updateMemoryPayload(ids, payload) { return this.maintenanceService.updateMemoryPayload(ids, payload) }
  listExpiredEnhanced(now) { return this.maintenanceService.listExpiredEnhanced(now) }
  searchSimilar(vector, options) { return this.maintenanceService.searchSimilar(vector, options) }
  migrateLegacyMemories() { return this.maintenanceService.migrateLegacyMemories() }
  migrateDynamicFields() { return this.maintenanceService.migrateDynamicFields() }
  maintenance(options) { return this.maintenanceService.maintenance(options) }

  // ------------------------------------------------------------------
  // 配置与 provider
  // ------------------------------------------------------------------

  /** 当前配置（解包 volatile）。 */
  cfg() {
    return readConfig(this.config)
  }

  /** 全部 provider 档案（空列表时回退内置 SiliconFlow）。 */
  storage() {
    const cfg = this.cfg()
    return {
      qdrantUrl: normalizeUrl(cfg.qdrantUrl || 'http://127.0.0.1:6333'),
      collection: String(cfg.collection ?? 'dsh_memory').trim() || 'dsh_memory',
      qdrantApiKeyEnv: String(cfg.qdrantApiKeyEnv ?? '').trim(),
    }
  }

  /** 自动记录配置。 */
  captureOptions() {
    const cfg = this.cfg()
    return {
      autoCapture: cfg.autoCapture !== false,
      captureUserChars: Math.max(0, clampInt(cfg.captureUserChars, 400, 0, 20000)),
      captureAssistantChars: Math.max(0, clampInt(cfg.captureAssistantChars, 400, 0, 20000)),
      captureMinChars: Math.max(0, clampInt(cfg.captureMinChars, 12, 0, 20000)),
      includeSubagents: cfg.includeSubagents === true,
    }
  }

  /** 自动召回配置。 */
  recallOptions() {
    const cfg = this.cfg()
    const scope = cfg.memoryScope === 'workspace' || cfg.memoryScope === 'session' ? cfg.memoryScope : 'global'
    return {
      autoRecall: cfg.autoRecall !== false,
      memoryScope: scope,
      recallTopK: clampInt(cfg.recallTopK, 3, 1, 20),
      recallMinScore: clampNumber(cfg.recallMinScore, 0.42, 0, 1),
      recallMaxChars: clampInt(cfg.recallMaxChars, 600, 100, 4000),
      recallIncludeCurrentSession: cfg.recallIncludeCurrentSession === true,
      recallTimeoutMs: clampInt(cfg.recallTimeoutMs, 3000, 500, 20000),
      // 动态相关度（v0.7）
      ageGateEnabled: cfg.recallAgeGateEnabled !== false,
      strictness: clampNumber(cfg.recallStrictness, 0.35, 0, 1),
      maxRequired: clampNumber(cfg.recallMaxRequired, 0.9, 0.1, 1),
      toolBaseMinScore: clampNumber(cfg.recallToolBaseMinScore, 0.3, 0, 1),
      toolStrictness: clampNumber(cfg.recallToolStrictness, 0.2, 0, 1),
      weightImportance: clampNumber(cfg.recallWeightImportance, 0.2, 0, 1),
      weightRehearsal: clampNumber(cfg.recallWeightRehearsal, 0.15, 0, 1),
      weightConfidence: clampNumber(cfg.recallWeightConfidence, 0.1, 0, 1),
      decayTauDays: {
        0: clampNumber(cfg.recallDecayTauL0, 7, 1, 10000),
        1: clampNumber(cfg.recallDecayTauL1, 30, 1, 10000),
        2: clampNumber(cfg.recallDecayTauL2, 180, 1, 10000),
        3: clampNumber(cfg.recallDecayTauL3, 365, 1, 10000),
      },
      rehearsalTauDays: clampNumber(cfg.recallRehearsalTauDays, 90, 1, 10000),
      rehearsalMaxEvents: clampInt(cfg.recallRehearsalMaxEvents, 20, 1, 100),
      naturalRepeatEnabled: cfg.recallNaturalRepeatEnabled !== false,
      naturalRepeatThreshold: clampNumber(cfg.recallNaturalRepeatThreshold, 0.85, 0.5, 1),
      candidates: clampInt(cfg.recallCandidates, 20, 3, 100),
    }
  }

  /** 工具配置。 */
  toolOptions() {
    const cfg = this.cfg()
    return {
      toolsEnabled: cfg.toolsEnabled !== false,
      searchLimit: clampInt(cfg.toolSearchLimit, 5, 1, 20),
    }
  }

  /** 维护 / 保留配置。 */
  maintenanceOptions() {
    const cfg = this.cfg()
    return {
      retentionDays: Math.max(0, clampInt(cfg.retentionDays, 0, 0, 36500)),
      maxMemories: Math.max(0, clampInt(cfg.maxMemories, 0, 0, 10000000)),
      maintenanceIntervalHours: clampInt(cfg.maintenanceIntervalHours, 6, 1, 168),
      maintenanceDedupe: cfg.maintenanceDedupe !== false,
      dedupeThreshold: clampNumber(cfg.dedupeThreshold, 0.96, 0.8, 1),
      dedupeMaxScan: clampInt(cfg.dedupeMaxScan, 100, 10, 1000),
    }
  }

  /** 图片概览配置。 */
  imageOptions() {
    const cfg = this.cfg()
    return {
      imageMode: cfg.imageMode === 'placeholder' || cfg.imageMode === 'off' ? cfg.imageMode : 'caption',
      captionPrompt: String(cfg.captionPrompt ?? '').trim() || DEFAULT_CAPTION_PROMPT,
      captionMaxTokens: clampInt(cfg.captionMaxTokens, 96, 16, 1024),
    }
  }

  /** 时间与时区配置。 */
  timeOptions() {
    const cfg = this.cfg()
    const timeZone = resolveTimeZone(cfg.timezone, cfg.timezoneCustom)
    return {
      timeZone,
      timeZoneLabel: timeZone ?? '服务器本地',
      injectCurrentTime: cfg.injectCurrentTime !== false,
      relativeTime: cfg.relativeTime !== false,
    }
  }

  /** 按配置时区格式化时间戳。 */
  formatTs(ts) {
    return timeInfo(ts, this.timeOptions().timeZone, false).time
  }

  /** 时间戳 → { time, relative }。 */
  tsInfo(ts) {
    const options = this.timeOptions()
    return timeInfo(ts, options.timeZone, options.relativeTime)
  }

  /** 当前 agent 的会话上下文（用于作用域过滤）。 */
  sessionContext(agentId) {
    const id = String(agentId ?? '')
    let cwd = ''
    try {
      const session = this.ctx.sessions?.get?.(id)
      cwd = String(session?.header?.cwd ?? '')
    } catch {
      /* ignore */
    }
    return { sessionId: id, cwd }
  }

  /**
   * 构造 Qdrant 过滤条件。
   * @param {object} options
   * @param {'global'|'workspace'|'session'} [options.mode]
   * @param {string} [options.sessionId] 当前会话
   * @param {string} [options.cwd] 当前工作目录
   * @param {boolean} [options.includeCurrentSession] 是否包含当前会话
   * @param {string} [options.kind] 只查某类记忆
   */
  buildFilter({ mode = 'global', sessionId = '', cwd = '', includeCurrentSession = false, kind = '' } = {}) {
    const must = []
    const mustNot = []
    if (mode === 'session') {
      if (sessionId) must.push({ key: 'sessionId', match: { value: sessionId } })
    } else if (mode === 'workspace') {
      if (cwd) must.push({ key: 'cwd', match: { value: cwd } })
      if (!includeCurrentSession && sessionId) {
        mustNot.push({ key: 'sessionId', match: { value: sessionId } })
      }
    } else if (!includeCurrentSession && sessionId) {
      mustNot.push({ key: 'sessionId', match: { value: sessionId } })
    }
    if (kind) must.push({ key: 'kind', match: { value: kind } })
    const filter = {}
    if (must.length > 0) filter.must = must
    if (mustNot.length > 0) filter.must_not = mustNot
    return Object.keys(filter).length > 0 ? filter : undefined
  }

  // ------------------------------------------------------------------
  // Qdrant 与集合
  // ------------------------------------------------------------------

  /** 构造 Qdrant 客户端（支持可选 api-key）。 */
  async qdrant() {
    const storage = this.storage()
    let apiKey = ''
    if (storage.qdrantApiKeyEnv) apiKey = await this.resolveKey(storage.qdrantApiKeyEnv)
    return new QdrantClient({ url: storage.qdrantUrl, apiKey, logger: this.logger })
  }

  /** 确保集合存在且与激活 provider 的维度一致。 */
  async ensureReady({ force = false } = {}) {
    const provider = this.activeProvider()
    const storage = this.storage()
    const signature = `${storage.qdrantUrl}|${storage.collection}|${provider.dimensions}`
    const now = Date.now()
    if (
      !force &&
      this.collectionState.signature === signature &&
      now - this.collectionState.checkedAt < 30000
    ) {
      if (this.collectionState.ok) return this.collectionState.info
      throw new Error(this.collectionState.error ?? 'Qdrant 不可用')
    }
    const qdrant = await this.qdrant()
    try {
      const result = await qdrant.ensureCollection(storage.collection, provider.dimensions)
      this.collectionState = {
        signature,
        ok: result.ok,
        error: result.ok ? null : (result.error ?? '集合不可用'),
        checkedAt: now,
        info: result.info ?? null,
      }
      if (!result.ok) throw new Error(this.collectionState.error)
      return result.info
    } catch (error) {
      this.collectionState = {
        signature,
        ok: false,
        error: errorText(error),
        checkedAt: now,
        info: null,
      }
      throw error
    }
  }

  // ------------------------------------------------------------------
  // 写入
  // ------------------------------------------------------------------

  /** 写入一条记忆（内容相同时覆盖同一 point 实现去重）。 */
  async addMemory({ kind, text, meta = {}, signal }) {
    const provider = this.activeProvider()
    const body = redactSecrets(cleanText(text))
    if (!body) throw new Error('记忆内容为空，已跳过')
    const client = await this.clientFor(provider)
    const embedded = await client.embedText(body, { signal })
    if (embedded.vector.length !== provider.dimensions) {
      throw new Error(
        `嵌入维度不一致：provider 配置 ${provider.dimensions}，服务返回 ${embedded.vector.length}；请修正 provider 维度配置或重建集合`,
      )
    }
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    const { idSeed, ...payloadMeta } = meta ?? {}
    const id = memoryPointId(idSeed ? `${kind}|${idSeed}|${body}` : `${kind}|${body}`)
    const baseTs = Number(meta?.ts) > 0 ? Number(meta.ts) : Date.now()
    const payload = sanitizeMeta({
      text: body,
      kind,
      ts: baseTs,
      provider: provider.id,
      model: provider.embedModel,
      dimensions: provider.dimensions,
      level: 0,
      batch: '',
      // v0.7 动态召回字段
      importance: normalizeImportance(meta?.importance, kind),
      confidence: normalizeConfidence(meta?.confidence, kind),
      anchorTs: Number(meta?.anchorTs) > 0 ? Number(meta.anchorTs) : baseTs,
      accessEvents: Array.isArray(meta?.accessEvents) ? meta.accessEvents.slice(-20) : [],
      exposureCount: clampInt(meta?.exposureCount, 0, 0, 1000000),
      lastAccessAt: Number(meta?.lastAccessAt) > 0 ? Number(meta.lastAccessAt) : 0,
      lastExposedAt: Number(meta?.lastExposedAt) > 0 ? Number(meta.lastExposedAt) : 0,
      needsReview: meta?.needsReview === true,
      ...payloadMeta,
    })
    await qdrant.upsert(storage.collection, [{ id, vector: embedded.vector, payload }], { signal })
    this.stats.writes += 1
    this.stats.lastWriteAt = payload.ts
    this.stats.lastWriteKind = kind
    this.debugLog(`写入 ${kind} 记忆 ${id}（${body.length} 字，provider=${provider.id}）`)
    // 自然复述检测（用户再次提及同一事实）：异步，不阻塞写入
    if (this.recallOptions().ageGateEnabled && this.recallOptions().naturalRepeatEnabled) {
      void this.detectNaturalRepeat({ vector: embedded.vector, selfId: id, kind })
    }
    return { ok: true, id, text: body }
  }

  /** C 类复述：新写入内容与已有记忆高度相似时，给旧记忆记一次“自然复述”。 */
  async detectNaturalRepeat({ vector, selfId, kind }) {
    if (!Array.isArray(vector)) return
    const options = this.recallOptions()
    if (!options.ageGateEnabled || !options.naturalRepeatEnabled) return
    if (!['turn', 'fact', 'preference', 'note', 'project'].includes(String(kind ?? ''))) return
    try {
      const qdrant = await this.qdrant()
      const storage = this.storage()
      const points = await qdrant.search(storage.collection, {
        vector,
        limit: 3,
        scoreThreshold: options.naturalRepeatThreshold,
        withPayload: false,
      })
      const ids = points
        .map((point) => String(point.id ?? ''))
        .filter((id) => id && id !== String(selfId))
      if (ids.length > 0) await this.recordRehearsal(ids, 'repeat', 1.5)
    } catch (error) {
      this.debugLog(`自然复述检测失败：${errorText(error)}`)
    }
  }

  /** 记录一轮对话要点。 */
  async addTurnMemory({ userText, assistantText, sessionId, cwd, turn, imageCount = 0 }) {
    const options = this.captureOptions()
    const user = truncate(cleanText(userText), options.captureUserChars)
    const assistant = truncate(cleanText(assistantText), options.captureAssistantChars)
    if (user.length + assistant.length < options.captureMinChars) return { ok: false, skipped: 'too-short' }
    const parts = []
    if (user) parts.push(`用户：${user}`)
    if (assistant) parts.push(`助手：${assistant}`)
    if (imageCount > 0) parts.push(`（本轮附有 ${imageCount} 张图片）`)
    return this.addMemory({
      kind: 'turn',
      text: parts.join('\n'),
      meta: {
        sessionId: String(sessionId ?? ''),
        cwd: String(cwd ?? ''),
        turn: Number(turn) || 0,
        hasImages: imageCount > 0,
      },
    })
  }

  /** 记录一张图片：只存一句话概览，永不存原图。 */
  async addImageMemory({ ref, sessionId, cwd, turn }) {
    const image = this.imageOptions()
    if (image.imageMode === 'off') return { ok: false, skipped: 'image-mode-off' }
    const cfg = this.cfg()
    const source = cfg.captionSource === 'custom' ? 'custom' : 'dsh'
    const mediaType = ref?.mediaType || 'image/png'
    const imageMeta = {
      mediaType: String(mediaType),
      width: Number(ref?.width) || null,
      height: Number(ref?.height) || null,
    }
    let text
    let caption = null
    if (image.imageMode === 'caption') {
      // 优先：DSH 已配置的模型（图片以 attachment block 传入，无需额外 Key）
      if (source === 'dsh') {
        try {
          const target = this.dshTarget(cfg.captionDshProvider, cfg.captionDshModel)
          if (!target.providerId || !target.modelId) throw new Error('DSH 默认模型不可用')
          const result = await this.dshCaption({
            provider: target.providerId,
            model: target.modelId,
            ref,
            prompt: image.captionPrompt,
            maxTokens: Math.max(300, image.captionMaxTokens),
          })
          caption = cleanText(result.text)
          this.stats.captions += 1
        } catch (error) {
          this.logger.warn?.(`[dsh-memory] DSH 图片概览失败，尝试自定义 provider：${errorText(error)}`)
        }
      }
      // 回退：插件自定义 provider 的视觉模型
      if (!caption) {
        const { provider, vision, model: customModel } = this.captionTarget()
        if (customModel) {
          try {
            const stored = await this.ctx.attachments.readImage(ref)
            const dataUri = toDataUri(stored?.data ?? stored, mediaType)
            const client = await this.clientFor(provider)
            client.visionModel = customModel
            void vision
            const result = await client.captionImage(dataUri, {
              prompt: image.captionPrompt,
              maxTokens: image.captionMaxTokens,
            })
            caption = cleanText(result.text)
            this.stats.captions += 1
          } catch (error) {
            this.logger.warn?.(`[dsh-memory] 图片概览失败，降级为占位记录：${errorText(error)}`)
          }
        } else {
          this.logger.warn?.('[dsh-memory] 图片概览没有可用模型（DSH 模型不可用且未配置自定义视觉模型）')
        }
      }
      text = caption
        ? `图片概览：${caption}`
        : '用户发送了一张图片（概览生成失败，仅记录图片存在）'
    } else {
      text = '用户发送了一张图片（未解析图片内容）'
    }
    return this.addMemory({
      kind: 'image',
      text,
      meta: {
        sessionId: String(sessionId ?? ''),
        cwd: String(cwd ?? ''),
        turn: Number(turn) || 0,
        image: imageMeta,
        caption,
      },
    })
  }

  // ------------------------------------------------------------------
  // 检索 / 召回
  // ------------------------------------------------------------------

  /** 检索记忆。 */
  async search(query, options = {}) {
    const text = cleanText(query)
    if (!text) return { hits: [], query: '' }
    const provider = this.activeProvider()
    const client = await this.clientFor(provider)
    const embedded = await client.embedText(text, { signal: options.signal })
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    const filter =
      options.filter ??
      this.buildFilter({
        mode: options.mode ?? 'global',
        sessionId: options.sessionId ?? '',
        cwd: options.cwd ?? '',
        includeCurrentSession: options.includeCurrentSession === true,
        kind: options.kind ?? '',
      })
    const points = await qdrant.search(
      storage.collection,
      {
        vector: embedded.vector,
        limit: clampInt(options.limit, 3, 1, 100),
        scoreThreshold: Number.isFinite(Number(options.minScore)) ? Number(options.minScore) : undefined,
        filter,
      },
      { signal: options.signal },
    )
    const timeOptions = this.timeOptions()
    const hits = points.map((point) => {
      const payload = point?.payload ?? {}
      const ts = Number(payload.ts) || 0
      const info = timeInfo(ts, timeOptions.timeZone, timeOptions.relativeTime)
      return {
        id: String(point?.id ?? ''),
        score: Number(point?.score) || 0,
        text: String(payload.text ?? ''),
        kind: String(payload.kind ?? ''),
        ts,
        time: info.time,
        relative: info.relative,
        sessionId: payload.sessionId ? String(payload.sessionId) : '',
        cwd: payload.cwd ? String(payload.cwd) : '',
        tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
        provider: payload.provider ? String(payload.provider) : '',
        level: Number(payload.level) || 0,
        batch: payload.batch ? String(payload.batch) : '',
        enhanced: payload.enhanced === true,
        ...this.#dynamicPayload(payload),
      }
    })
    return { hits, query: text, usage: embedded.usage }
  }

  /** 自动召回：检索并组装成注入上下文块。 */
  /** 批量更新 payload（按 id 分别写，内部串行避免打爆 Qdrant）。 */
  async patchMemoryPayloads(patches) {
    if (!Array.isArray(patches) || patches.length === 0) return
    const qdrant = await this.qdrant()
    const storage = this.storage()
    for (const patch of patches) {
      await qdrant.setPayload(storage.collection, patch.payload, [patch.id])
    }
  }

  /** A 类：被动曝光（自动召回注入）。只记 exposureCount / lastExposedAt，不进入有效复述。 */
  async recordExposure(ids) {
    const list = (ids ?? []).map(String).filter(Boolean).slice(0, 20)
    if (list.length === 0) return
    try {
      const items = await this.collectMemories({ filter: { must: [{ has_id: list }] }, withVector: false, maxItems: list.length })
      const now = Date.now()
      await this.patchMemoryPayloads(
        items.map((item) => ({
          id: item.id,
          payload: {
            exposureCount: clampInt(item.payload?.exposureCount, 0, 0, 1000000) + 1,
            lastExposedAt: now,
          },
        })),
      )
    } catch (error) {
      this.debugLog(`记录曝光失败：${errorText(error)}`)
    }
  }

  /**
   * B/C/D/E 类：有效复述。
   * @param {string[]} ids 记忆 id
   * @param {'search'|'repeat'|'confirm'|'correct'} type
   * @param {number} weight 分类权重
   */
  async recordRehearsal(ids, type, weight = 1) {
    const list = (ids ?? []).map(String).filter(Boolean).slice(0, 20)
    if (list.length === 0) return
    try {
      const options = this.recallOptions()
      const items = await this.collectMemories({ filter: { must: [{ has_id: list }] }, withVector: false, maxItems: list.length })
      const now = Date.now()
      const maxEvents = options.rehearsalMaxEvents
      const patches = []
      for (const item of items) {
        const payload = item.payload ?? {}
        const events = Array.isArray(payload.accessEvents) ? payload.accessEvents.slice(-(maxEvents - 1)) : []
        const nextEvents = [...events, { type, at: now, weight: Math.max(0, Number(weight) || 0) }]
        let confidence = normalizeConfidence(payload.confidence, payload.kind)
        const patch = { accessEvents: nextEvents, lastAccessAt: now }
        if (type === 'confirm') {
          confidence = Math.min(0.95, confidence + 0.1)
          patch.confidence = confidence
        } else if (type === 'correct') {
          confidence = Math.max(0.05, confidence - 0.2)
          patch.confidence = confidence
          patch.needsReview = true
        }
        patches.push({ id: item.id, payload: patch })
      }
      await this.patchMemoryPayloads(patches)
    } catch (error) {
      this.debugLog(`记录复述失败（${type}）：${errorText(error)}`)
    }
  }

  /** 动态召回排序/门控（auto=自动召回；tool=memory_search）。 */
  rankHits(hits, mode = 'auto') {
    const options = this.recallOptions()
    if (!options.ageGateEnabled) {
      const pass = [...(hits ?? [])].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
      return { pass, dropped: [] }
    }
    const policy = {
      mode,
      baseMinScore: mode === 'tool' ? options.toolBaseMinScore : options.recallMinScore,
      strictness: mode === 'tool' ? options.toolStrictness : options.strictness,
      maxRequired: options.maxRequired,
      weightImportance: options.weightImportance,
      weightRehearsal: options.weightRehearsal,
      weightConfidence: options.weightConfidence,
      decayTauDays: options.decayTauDays,
      rehearsalTauDays: options.rehearsalTauDays,
    }
    return rankRecallHits(hits ?? [], policy, Date.now())
  }

  async recall(query, { signal, sessionId = '', cwd = '' } = {}) {
    const options = this.recallOptions()
    const { hits } = await this.search(query, {
      limit: options.ageGateEnabled ? options.candidates : options.recallTopK,
      minScore: options.ageGateEnabled ? undefined : options.recallMinScore,
      mode: options.memoryScope,
      sessionId,
      cwd,
      includeCurrentSession: options.recallIncludeCurrentSession,
      signal,
    })
    let candidates = hits.filter((hit) => hit.text.length > 0 && hit.enhanced !== true)
    if (options.ageGateEnabled) {
      const ranked = this.rankHits(candidates, 'auto')
      candidates = ranked.pass
    }
    const filtered = candidates.slice(0, options.recallTopK)
    if (filtered.length === 0) return { hits: [], block: '' }
    // A 类：被动曝光只记录，不计入有效复述、不影响排序
    if (options.ageGateEnabled) void this.recordExposure(filtered.map((hit) => hit.id))
    const timeOptions = this.timeOptions()
    const lines = []
    for (const [index, hit] of filtered.entries()) {
      const kindLabel =
        hit.kind === 'image' ? '图片' : hit.kind === 'fact' ? '事实' : hit.kind === 'turn' ? '对话' : '记忆'
      const relative = hit.relative ? `·${hit.relative}` : ''
      const confidence = Number.isFinite(hit.confidence) ? `·可信度${Math.round(hit.confidence * 100)}%` : ''
      lines.push(`${index + 1}. [${hit.time}${relative}·${kindLabel}${confidence}] ${truncate(hit.text, 220)}`)
    }
    const timeLine = timeOptions.injectCurrentTime
      ? `当前时间：${this.formatTs(Date.now())}（时区：${timeOptions.timeZoneLabel}；记忆时间均按此时区显示）\n`
      : ''
    let block = `${RECALL_HEADER}\n${timeLine}以下是从过去会话中检索到的相关记忆，仅供参考；若与当前对话冲突，以当前对话为准：\n${lines.join('\n')}`
    block = truncate(block, options.recallMaxChars)
    this.stats.lastRecallAt = Date.now()
    this.stats.lastRecallCount = filtered.length
    return { hits: filtered, block }
  }

  // ------------------------------------------------------------------
  // 记忆管理
  // ------------------------------------------------------------------

  /** 把 Qdrant point 映射成管理界面用的条目。 */
  /** 动态召回字段（统一读取缺省值，兼容 v0.6 旧记忆）。 */
  #dynamicPayload(payload) {
    const accessEvents = Array.isArray(payload?.accessEvents)
      ? payload.accessEvents
          .map((event) => ({ type: String(event?.type ?? ''), at: Number(event?.at) || 0, weight: Number(event?.weight) || 0 }))
          .filter((event) => event.at > 0 && event.weight > 0)
          .slice(-20)
      : []
    return {
      importance: normalizeImportance(payload?.importance, payload?.kind),
      confidence: normalizeConfidence(payload?.confidence, payload?.kind),
      anchorTs: Number(payload?.anchorTs) || Number(payload?.ts) || 0,
      accessEvents,
      exposureCount: clampInt(payload?.exposureCount, 0, 0, 1000000),
      lastAccessAt: Number(payload?.lastAccessAt) || 0,
      lastExposedAt: Number(payload?.lastExposedAt) || 0,
      needsReview: payload?.needsReview === true,
    }
  }

  #pointToItem(point, score) {
    const payload = point?.payload ?? {}
    const ts = Number(payload.ts) || 0
    const info = this.tsInfo(ts)
    return {
      id: String(point?.id ?? ''),
      text: String(payload.text ?? ''),
      kind: String(payload.kind ?? ''),
      ts,
      time: info.time,
      relative: info.relative,
      sessionId: payload.sessionId ? String(payload.sessionId) : '',
      cwd: payload.cwd ? String(payload.cwd) : '',
      tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
      provider: payload.provider ? String(payload.provider) : '',
      level: Number(payload.level) || 0,
      batch: payload.batch ? String(payload.batch) : '',
      enhanced: payload.enhanced === true,
      ...this.#dynamicPayload(payload),
      ...(Number.isFinite(score) ? { score } : {}),
    }
  }

  /** 记忆列表：带 query 走向量检索，否则按时间倒序滚动。 */
  async listMemories({ query = '', limit = 20, offset = null, kind = '', range = '', level = '', batch = '' } = {}) {
    const cleanQuery = cleanText(query)
    const pageSize = clampInt(limit, 20, 1, 100)
    const levelFilter = String(level ?? '').trim()
    const batchFilter = String(batch ?? '').trim()
    if (cleanQuery) {
      const { hits } = await this.search(cleanQuery, { limit: Math.min(100, pageSize * 3), kind })
      const filtered = hits
        .filter((hit) => !levelFilter || String(hit.level ?? 0) === levelFilter)
        .filter((hit) => !batchFilter || String(hit.batch ?? '') === batchFilter)
        .slice(0, pageSize)
      return { items: filtered, nextOffset: null, total: filtered.length, query: cleanQuery }
    }
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    const must = []
    if (kind) must.push({ key: 'kind', match: { value: kind } })
    if (levelFilter !== '') must.push({ key: 'level', match: { value: Number(levelFilter) } })
    if (batchFilter) must.push({ key: 'batch', match: { value: batchFilter } })
    if (range === 'today' || range === '7d' || range === '30d') {
      const bounds = rangeBounds(range, this.timeOptions().timeZone)
      if (bounds.from !== null) must.push({ key: 'ts', range: { gte: bounds.from, lte: bounds.to } })
    }
    const filter = must.length > 0 ? { must } : undefined
    const { points, nextOffset } = await qdrant.scroll(storage.collection, {
      limit: pageSize,
      offset: offset ?? undefined,
      orderBy: { key: 'ts', direction: 'desc' },
      filter,
    })
    let total = null
    try {
      // 注意：Qdrant 的近似 count 在带过滤条件时会明显偏差，这里必须精确计数
      total = await qdrant.count(storage.collection, { filter, exact: true })
    } catch {
      /* ignore */
    }
    return {
      items: points.map((point) => this.#pointToItem(point)),
      nextOffset: nextOffset ?? null,
      total,
      query: '',
    }
  }

  /** 导出全部记忆。 */
  async exportMemories({ maxItems = 20000 } = {}) {
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    const items = []
    let offset = undefined
    while (items.length < maxItems) {
      const { points, nextOffset } = await qdrant.scroll(storage.collection, {
        limit: 256,
        offset,
        orderBy: { key: 'ts', direction: 'asc' },
      })
      for (const point of points) items.push(this.#pointToItem(point))
      if (!nextOffset || points.length === 0) break
      offset = nextOffset
    }
    return { ok: true, count: items.length, exportedAt: new Date().toISOString(), items }
  }

  /** 删除记忆。 */
  async forget(ids) {
    const list = (Array.isArray(ids) ? ids : [ids]).map(String).filter(Boolean)
    if (list.length === 0) throw new Error('需要提供要删除的记忆 id（可先用 memory_search 查询）')
    await this.ensureReady()
    const qdrant = await this.qdrant()
    const storage = this.storage()
    await qdrant.deletePoints(storage.collection, list)
    return { ok: true, deleted: list.length }
  }

  /** 重建集合（维度变更 / 数据清空时使用，会删除全部记忆）。 */
  async recreateCollection() {
    const provider = this.activeProvider()
    const storage = this.storage()
    const qdrant = await this.qdrant()
    const result = await qdrant.recreateCollection(storage.collection, provider.dimensions)
    this.collectionState = {
      signature: `${storage.qdrantUrl}|${storage.collection}|${provider.dimensions}`,
      ok: result.ok,
      error: result.ok ? null : (result.error ?? '重建失败'),
      checkedAt: Date.now(),
      info: result.info ?? null,
    }
    return result
  }

  // ------------------------------------------------------------------
  // 记忆整理 / 睡眠 支撑
  // ------------------------------------------------------------------

  /** 按 level 统计条数（0=原始，1/2/3=整理级别）。 */
  async status() {
    const provider = this.activeProvider()
    const recall = this.recallOptions()
    const capture = this.captureOptions()
    const storage = this.storage()
    const toolOptions = this.toolOptions()
    const maintenanceOptions = this.maintenanceOptions()
    const info = {
      ok: true,
      app: {
        name: 'dsh-memory',
        version: '0.7.0',
        startedAt: this.stats.startedAt,
      },
      time: (() => {
        const options = this.timeOptions()
        return {
          timezone: options.timeZone ?? '',
          timezoneLabel: options.timeZoneLabel,
          injectCurrentTime: options.injectCurrentTime,
          relativeTime: options.relativeTime,
          now: this.formatTs(Date.now()),
        }
      })(),
      provider: {
        id: provider.id,
        name: provider.name,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        embedModel: provider.embedModel,
        dimensions: provider.dimensions,
        visionModel: provider.visionModel,
        visionBaseUrl: this.visionConfigOf(provider).baseUrl,
        apiKeyEnv: this.credentialRef(provider),
        visionApiKeyEnv: this.visionConfigOf(provider).ref,
      },
      providers: [],
      storage: { ...storage },
      functions: (() => {
        const cfg = this.cfg()
        const captionSource = cfg.captionSource === 'custom' ? 'custom' : 'dsh'
        let caption
        if (captionSource === 'dsh') {
          const target = this.dshTarget(cfg.captionDshProvider, cfg.captionDshModel)
          caption = {
            source: 'dsh',
            providerId: target.providerId,
            providerName: target.providerId,
            model: target.modelId,
            configured: Boolean(target.providerId && target.modelId),
          }
        } else {
          const custom = this.captionTarget()
          caption = {
            source: 'custom',
            providerId: custom.provider?.id ?? '',
            providerName: custom.provider?.name ?? '',
            model: custom.model,
            configured: Boolean(custom.model),
          }
        }
        const consolidationSource = cfg.consolidationSource === 'custom' ? 'custom' : 'dsh'
        let consolidation
        if (consolidationSource === 'dsh') {
          const target = this.dshTarget(cfg.consolidationDshProvider, cfg.consolidationDshModel)
          consolidation = {
            source: 'dsh',
            providerId: target.providerId,
            providerName: target.providerId,
            model: target.modelId,
            configured: Boolean(target.providerId && target.modelId),
          }
        } else {
          let customProvider = null
          try {
            customProvider = cfg.consolidationProviderId
              ? this.providerById(cfg.consolidationProviderId)
              : this.activeProvider()
          } catch {
            customProvider = null
          }
          consolidation = {
            source: 'custom',
            providerId: customProvider?.id ?? '',
            providerName: customProvider?.name ?? '',
            model: String(cfg.consolidationModel ?? '').trim(),
            configured: Boolean(String(cfg.consolidationModel ?? '').trim()),
          }
        }
        return {
          embedding: { providerId: provider.id, model: provider.embedModel, dimensions: provider.dimensions },
          caption,
          consolidation,
          limitItems: cfg.consolidationLimitItems === true,
        }
      })(),
      behavior: {
        dynamicRecall: {
          enabled: recall.ageGateEnabled,
          strictness: recall.strictness,
          maxRequired: recall.maxRequired,
          weights: {
            importance: recall.weightImportance,
            rehearsal: recall.weightRehearsal,
            confidence: recall.weightConfidence,
          },
          decayTauDays: recall.decayTauDays,
        },
        autoCapture: capture.autoCapture,
        autoRecall: recall.autoRecall,
        memoryScope: recall.memoryScope,
        recallTopK: recall.recallTopK,
        recallMinScore: recall.recallMinScore,
        recallMaxChars: recall.recallMaxChars,
        recallIncludeCurrentSession: recall.recallIncludeCurrentSession,
        recallTimeoutMs: recall.recallTimeoutMs,
        imageMode: this.cfg().imageMode ?? 'caption',
        toolsEnabled: toolOptions.toolsEnabled,
      },
      retention: { ...maintenanceOptions },
      credential: null,
      qdrant: { ok: false, version: null, error: null },
      collection: { name: storage.collection, exists: false, points: 0, size: null, error: null, payloadIndexes: [] },
      queue: {
        pending: this.queue.pending,
        done: this.queue.done,
        failed: this.queue.failed,
        lastError: this.queue.lastError,
        lastErrorTime: this.queue.lastErrorAt ? this.formatTs(this.queue.lastErrorAt) : '',
      },
      sleep: this.sleep?.status?.() ?? null,
      consolidation: this.consolidation?.summary?.() ?? null,
      levels: await this.countByLevel(),
      stats: {
        writes: this.stats.writes,
        lastWriteTime: this.stats.lastWriteAt ? this.formatTs(this.stats.lastWriteAt) : '',
        lastWriteKind: this.stats.lastWriteKind,
        lastRecallTime: this.stats.lastRecallAt ? this.formatTs(this.stats.lastRecallAt) : '',
        lastRecallCount: this.stats.lastRecallCount,
        recallChecks: this.stats.recallChecks,
        lastRecallQuery: this.stats.lastRecallQuery,
        lastRecallError: this.stats.lastRecallError,
        lastRecallInjectTime: this.stats.lastRecallInjectAt ? this.formatTs(this.stats.lastRecallInjectAt) : '',
        captions: this.stats.captions,
        startedAt: this.stats.startedAt,
        lastMaintenanceTime: this.stats.lastMaintenanceAt ? this.formatTs(this.stats.lastMaintenanceAt) : '',
        lastMaintenance: this.stats.lastMaintenance,
      },
      collectionState: {
        ok: this.collectionState.ok,
        error: this.collectionState.error,
        checkedAt: this.collectionState.checkedAt ? this.formatTs(this.collectionState.checkedAt) : '',
      },
    }
    try {
      info.credential = await this.credentialInfo(this.credentialRef(provider))
    } catch (error) {
      info.credential = { configured: false, writable: false, error: errorText(error) }
    }
    // 每个 provider 的 Key 状态
    const providers = this.providers()
    info.providers = await Promise.all(
      providers.map(async (item) => {
        const ref = this.credentialRef(item)
        let configured = false
        try {
          const described = await this.ctx.credentials.describe(ref)
          configured = described?.configured === true
        } catch {
          /* ignore */
        }
        const vision = this.visionConfigOf(item)
        let visionConfigured = configured
        if (vision.ref && vision.ref !== ref) {
          try {
            const described = await this.ctx.credentials.describe(vision.ref)
            visionConfigured = described?.configured === true
          } catch {
            visionConfigured = false
          }
        }
        return {
          ...item,
          apiKeyEnv: ref,
          visionApiKeyEnv: vision.ref,
          keyConfigured: configured,
          visionKeyConfigured: visionConfigured,
          active: item.id === provider.id,
        }
      }),
    )
    try {
      const qdrant = await this.qdrant()
      const health = await qdrant.health()
      info.qdrant = { ok: true, version: health.version, error: null }
      try {
        const collection = await qdrant.collectionInfo(storage.collection)
        info.collection = {
          name: storage.collection,
          exists: collection !== null,
          points: collection?.points ?? 0,
          size: collection?.size ?? null,
          payloadIndexes: collection?.payloadIndexes ?? [],
          error: null,
        }
      } catch (error) {
        info.collection.error = errorText(error)
      }
    } catch (error) {
      info.qdrant = { ok: false, version: null, error: errorText(error) }
      info.ok = false
    }
    return info
  }

  /**
   * 设置页“测试连接”：默认测试激活 provider；传 providerId 测试指定档案。
   */
  async test(providerId) {
    const provider = providerId ? this.providerById(providerId) : this.activeProvider()
    if (!provider) throw new Error(`未找到 provider：${providerId}`)
    const results = { provider: { id: provider.id, name: provider.name, embeddingModel: provider.embedModel, dimensions: provider.dimensions, visionModel: provider.visionModel } }
    try {
      const client = await this.clientFor(provider)
      const embedded = await client.embedText('长期记忆连接测试 ping', { timeoutMs: 30000 })
      results.embedding = {
        ok: true,
        latencyMs: embedded.latencyMs,
        dimensions: embedded.vector.length,
        usage: embedded.usage,
      }
    } catch (error) {
      results.embedding = { ok: false, error: errorText(error) }
    }
    try {
      const qdrant = await this.qdrant()
      const health = await qdrant.health()
      let collection = null
      try {
        collection = await qdrant.collectionInfo(this.storage().collection)
      } catch {
        /* collection 错误在 status 中体现 */
      }
      results.qdrant = {
        ok: true,
        version: health.version,
        collectionExists: collection !== null,
        points: collection?.points ?? 0,
        size: collection?.size ?? null,
      }
    } catch (error) {
      results.qdrant = { ok: false, error: errorText(error) }
    }
    if (provider.visionModel) {
      try {
        const client = await this.clientFor(provider)
        const image = this.imageOptions()
        const payload = await client.captionImage(
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PQQkAAAgEsAtjR+NZzQi+hcEKLNXzWgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQELgsTB6E82mqu8QAAAABJRU5ErkJggg==',
          { timeoutMs: 60000, prompt: image.captionPrompt, maxTokens: image.captionMaxTokens },
        )
        results.caption = { ok: true, latencyMs: payload.latencyMs, model: provider.visionModel, text: payload.text }
      } catch (error) {
        results.caption = { ok: false, model: provider.visionModel, error: errorText(error) }
      }
    }
    results.ok = Object.values(results)
      .filter((value) => value && typeof value === 'object' && 'ok' in value)
      .every((value) => value.ok !== false)
    return results
  }

  /** 调试日志。 */
  debugLog(...args) {
    if (this.cfg().debug === true) this.logger.info?.('[dsh-memory]', ...args)
  }

}
// ===== src/lib/entry/capture-controller.js =====
/**
 * 自动记录：监听 session/event，在每轮结束时把“用户要点 + 助手回答要点”
 * 以及用户图片的一句话概览写入长期记忆。
 *
 * 只记录 source.kind === 'user' 的真实人类消息；插件自己注入的
 * long-term-memory 上下文、运行时上下文、工具结果等一律不记录。
 */


/** 从 content blocks 里提取纯文本。 */
function textFromContent(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return cleanText(parts.join('\n'))
}

class CaptureController {
  /**
   * @param {import('./service.js').MemoryService} service
   */
  constructor(service) {
    this.service = service
    this.ctx = service.ctx
    this.logger = service.logger
    /** sessionId -> { turn, users: string[], assistant: string, images: ImageAttachmentRef[], cwd } */
    this.buffers = new Map()
  }

  /** 注册事件监听（由插件 effect 持有）。 */
  start() {
    this.ctx.effect(
      () =>
        this.ctx.on('session/event', (session, event) => {
          try {
            this.observe(session, event)
          } catch (error) {
            this.logger.warn?.(`[dsh-memory] 记录会话事件失败：${error?.message ?? error}`)
          }
        }),
      'dsh-memory: session capture',
    )
    this.ctx.effect(
      () =>
        this.ctx.on('session/disposed', (session) => {
          this.buffers.delete(String(session?.id ?? ''))
        }),
      'dsh-memory: capture cleanup',
    )
  }

  observe(session, event) {
    // 睡眠整理期间不记录（避免把 zzzZZ 对话写进长期记忆）
    if (this.service.sleep?.isSleeping?.()) return
    const options = this.service.captureOptions()
    if (!options.autoCapture) return
    const sessionId = String(session?.id ?? '')
    if (!sessionId) return
    const header = session?.header
    if (!options.includeSubagents && header?.origin === 'subagent') return

    switch (event?.type) {
      case 'turn/start': {
        this.buffers.set(sessionId, {
          turn: Number(event.data?.turn) || 0,
          users: [],
          assistant: '',
          images: [],
          cwd: String(header?.cwd ?? ''),
        })
        break
      }
      case 'user/message': {
        const buffer = this.buffers.get(sessionId)
        if (!buffer) return
        const message = event.data
        if (message?.source?.kind !== 'user') return
        const text = textFromContent(message?.content)
        if (text) buffer.users.push(text)
        if (Array.isArray(message?.content)) {
          for (const block of message.content) {
            if (block?.type === 'image' && block.attachment) buffer.images.push(block.attachment)
          }
        }
        break
      }
      case 'assistant/message': {
        const buffer = this.buffers.get(sessionId)
        if (!buffer) return
        const text = textFromContent(event.data?.message?.content)
        if (text) buffer.assistant = text
        break
      }
      case 'turn/end': {
        const buffer = this.buffers.get(sessionId)
        this.buffers.delete(sessionId)
        if (!buffer) return
        if (buffer.turn !== (Number(event.data?.turn) || 0)) return
        const reason = event.data?.reason?.kind
        if (reason !== 'completed') return
        this.finalize(sessionId, buffer)
        break
      }
      default:
        break
    }
  }

  /** 一轮结束：入队写入任务（不阻塞 agent 回合）。 */
  finalize(sessionId, buffer) {
    const service = this.service
    const options = service.captureOptions()
    const userText = truncate(cleanText(buffer.users.join('\n\n')), options.captureUserChars)
    const assistantText = truncate(cleanText(buffer.assistant), options.captureAssistantChars)
    const summaryLength = (userText + assistantText).length
    const imageCount = buffer.images.length
    if (summaryLength >= options.captureMinChars) {
      service.queue.push(
        'capture-turn',
        () =>
          service.addTurnMemory({
            userText,
            assistantText,
            sessionId,
            cwd: buffer.cwd,
            turn: buffer.turn,
            imageCount,
          }),
        { retries: 1 },
      )
    }
    // 图片：每张单独生成概览并写入（同一轮内按 attachmentId 去重）
    const seen = new Set()
    for (const ref of buffer.images) {
      const attachmentId = String(ref?.attachmentId ?? '')
      if (!attachmentId || seen.has(attachmentId)) continue
      seen.add(attachmentId)
      service.queue.push(
        `capture-image:${attachmentId}`,
        () =>
          service.addImageMemory({
            ref,
            sessionId,
            cwd: buffer.cwd,
            turn: buffer.turn,
          }),
        { retries: 0 },
      )
    }
  }
}
// ===== src/lib/entry/http/routes.js =====
/**
 * 设置页使用的 Host HTTP 接口（与 DSH Web 同源，仅本机可访问）：
 *
 *   GET  /__dsh_memory__/status              运行状态
 *   GET  /__dsh_memory__/memories?q&limit&offset&kind   记忆列表/检索
 *   GET  /__dsh_memory__/export              导出全部记忆 JSON
 *   POST /__dsh_memory__/test                测试激活 provider（可带 providerId）
 *   POST /__dsh_memory__/memories            手动新增记忆
 *   POST /__dsh_memory__/memories/delete     删除记忆 {ids:[...]}
 *   POST /__dsh_memory__/recreate            重建集合（需要 confirm:"DELETE"）
 *   POST /__dsh_memory__/maintenance         立即执行一次维护
 *   GET  /__dsh_memory__/sleep               睡眠状态 + 整理任务列表摘要
 *   POST /__dsh_memory__/sleep/run           手动触发一次睡眠整理
 *   GET  /__dsh_memory__/consolidation       整理任务列表与历史
 *   GET  /__dsh_memory__/models?providerId=  拉取某个 provider 的模型列表
 *
 * POST 请求要求自定义头 x-dsh-memory: 1，避免跨站请求伪造（跨域预检会拦下）。
 */


/** 读取 JSON 请求体（限制大小）。 */
function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(new Error(`请求体不是合法 JSON：${errorText(error)}`))
      }
    })
    req.on('error', reject)
  })
}

/** 统一 JSON 响应。 */
function respond(res, status, value) {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

/** 是否是带自定义头的 POST（基础 CSRF 防护）。 */
function trustedPost(req) {
  return req.method === 'POST' && req.headers['x-dsh-memory'] === '1'
}

/** 解析 URL 查询参数。 */
function parseQuery(req) {
  try {
    const url = new URL(String(req.url ?? '/'), 'http://127.0.0.1')
    return url.searchParams
  } catch {
    return new URLSearchParams()
  }
}

/**
 * @param {object} ctx DSH 插件上下文
 * @param {import('./service.js').MemoryService} service
 */
function registerHttpRoutes(ctx, service) {
  const log = service.logger
  const statusRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/status',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        respond(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      try {
        respond(res, 200, await service.status())
      } catch (error) {
        respond(res, 500, { ok: false, error: errorText(error) })
      }
    },
  }
  const memoriesRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/memories',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          const query = parseQuery(req)
          const result = await service.listMemories({
            query: query.get('q') ?? '',
            limit: Number(query.get('limit') ?? 20),
            offset: query.get('offset') ?? null,
            kind: query.get('kind') ?? '',
            range: query.get('range') ?? '',
            level: query.get('level') ?? '',
            batch: query.get('batch') ?? '',
          })
          respond(res, 200, { ok: true, ...result })
          return
        }
        if (!trustedPost(req)) {
          respond(res, 403, { ok: false, error: 'forbidden' })
          return
        }
        const body = await readJsonBody(req)
        const text = cleanText(body?.text ?? '')
        if (!text) {
          respond(res, 400, { ok: false, error: '缺少要保存的 text' })
          return
        }
        const kind = typeof body?.kind === 'string' && body.kind.trim() ? body.kind.trim() : 'note'
        const tags = Array.isArray(body?.tags)
          ? body.tags.filter((tag) => typeof tag === 'string').slice(0, 12)
          : []
        const saved = await service.addMemory({ kind, text, meta: { tags, source: 'settings' } })
        respond(res, 200, { ok: true, item: saved })
      } catch (error) {
        respond(res, 500, { ok: false, error: errorText(error) })
      }
    },
  }
  const memoriesDeleteRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/memories/delete',
    handler: async (req, res) => {
      if (!trustedPost(req)) {
        respond(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      try {
        const body = await readJsonBody(req)
        const ids = Array.isArray(body?.ids) ? body.ids : body?.id ? [body.id] : []
        const result = await service.forget(ids)
        respond(res, 200, result)
      } catch (error) {
        respond(res, 400, { ok: false, error: errorText(error) })
      }
    },
  }
  const exportRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/export',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        respond(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      try {
        respond(res, 200, await service.exportMemories())
      } catch (error) {
        respond(res, 500, { ok: false, error: errorText(error) })
      }
    },
  }
  const testRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/test',
    handler: async (req, res) => {
      if (!trustedPost(req)) {
        respond(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      try {
        const body = await readJsonBody(req)
        respond(res, 200, await service.test(typeof body?.providerId === 'string' ? body.providerId : undefined))
      } catch (error) {
        log.warn?.(`[dsh-memory] 连接测试失败：${errorText(error)}`)
        respond(res, 500, { ok: false, error: errorText(error) })
      }
    },
  }
  const recreateRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/recreate',
    handler: async (req, res) => {
      if (!trustedPost(req)) {
        respond(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      try {
        const body = await readJsonBody(req)
        if (body?.confirm !== 'DELETE') {
          respond(res, 400, { ok: false, error: '需要 confirm: "DELETE" 才能重建集合' })
          return
        }
        const result = await service.recreateCollection()
        if (!result.ok) {
          respond(res, 500, { ok: false, error: result.error ?? '重建失败' })
          return
        }
        respond(res, 200, { ok: true, collection: result.info })
      } catch (error) {
        log.warn?.(`[dsh-memory] 重建集合失败：${errorText(error)}`)
        respond(res, 500, { ok: false, error: errorText(error) })
      }
    },
  }
  const maintenanceRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/maintenance',
    handler: async (req, res) => {
      if (!trustedPost(req)) {
        respond(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      try {
        await readJsonBody(req)
        respond(res, 200, await service.maintenance({ force: true }))
      } catch (error) {
        respond(res, 500, { ok: false, error: errorText(error) })
      }
    },
  }
  const sleepRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/sleep',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        respond(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      if (!service.sleep || !service.consolidation) {
        respond(res, 503, { ok: false, error: '睡眠整理组件未加载' })
        return
      }
      respond(res, 200, {
        ok: true,
        sleep: service.sleep.status(),
        consolidation: service.consolidation.summary(),
      })
    },
  }
  const sleepRunRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/sleep/run',
    handler: async (req, res) => {
      if (!trustedPost(req)) {
        respond(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      if (!service.sleep) {
        respond(res, 503, { ok: false, error: '睡眠整理组件未加载' })
        return
      }
      try {
        const body = await readJsonBody(req)
        if (body?.confirm === 'run') {
          respond(res, 200, service.sleep.requestManual())
          return
        }
        respond(res, 200, service.sleep.requestManual())
      } catch (error) {
        respond(res, 500, { ok: false, error: errorText(error) })
      }
    },
  }
  const consolidationRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/consolidation',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        respond(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      if (!service.consolidation) {
        respond(res, 503, { ok: false, error: '整理引擎未加载' })
        return
      }
      respond(res, 200, { ok: true, ...service.consolidation.summary() })
    },
  }
  const modelsRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/models',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        respond(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      try {
        const query = parseQuery(req)
        respond(res, 200, await service.listProviderModels(query.get('providerId') ?? ''))
      } catch (error) {
        respond(res, 500, { ok: false, error: errorText(error) })
      }
    },
  }
  const dshModelsRoute = {
    kind: 'exact',
    path: '/__dsh_memory__/dsh-models',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        respond(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      try {
        respond(res, 200, { ok: true, ...(await service.dshCatalog()) })
      } catch (error) {
        respond(res, 500, { ok: false, error: errorText(error) })
      }
    },
  }

  const routes = [
    statusRoute,
    memoriesRoute,
    memoriesDeleteRoute,
    exportRoute,
    testRoute,
    recreateRoute,
    maintenanceRoute,
    sleepRoute,
    sleepRunRoute,
    consolidationRoute,
    modelsRoute,
    dshModelsRoute,
  ]
  return routes.map((route) => ctx.effect(() => ctx.webServer.register(route), `dsh-memory: route ${route.path}`))
}
// ===== src/lib/entry/maintenance-timer.js =====
/**
 * 定期维护定时器（入口层）：启动后 90 秒检查一次，之后每 5 分钟检查是否到期。
 * @param {object} ctx
 * @param {import('../app/memory-service.js').MemoryService} service
 */


const MAINTENANCE_TICK_MS = 5 * 60 * 1000

function startMaintenanceTimer(ctx, service) {
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
// ===== src/lib/entry/prompt.js =====
/**
 * 注入系统提示词的长期记忆使用说明（入口层，只做文本与注册）。
 * @param {object} ctx DSH 插件上下文
 */
const PROMPT_SECTION = [
  '## 长期记忆',
  '你拥有一个跨会话的持久化长期记忆库（由 dsh-memory 插件提供）。',
  '- 相关历史记忆可能以 source 为 long-term-memory 的上下文消息自动提供给你（通常以【长期记忆·自动召回】开头）。它们只是参考；若与当前对话冲突，以当前对话为准，不要向用户复述“经检索”之类的话。',
  '- 当用户透露值得长期记住的信息（偏好、身份、项目背景、重要决定、常用路径或命令、约定等）时，调用 memory_save 保存。每条记忆应当简洁、自包含（不要用“他/它/这个”等指代），一条一个事实；不要保存密码、密钥等敏感凭据。',
  '- 需要回忆过去的信息时，调用 memory_search 检索。不要凭空编造没有检索到的记忆。',
  '- 用户要求忘记某条记忆时，先用 memory_search 找到 id，再调用 memory_forget 删除。',
  '- 记忆条目会带发生时间（按配置时区显示，可能附相对时间）；自动召回上下文里也可能给出“当前时间”。需要判断信息新旧或做时间推算时，使用这些时间，不要假设当前日期。',
].join('\n')

/** 注册提示词段。 */
function registerPromptSection(ctx) {
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'dsh-memory:instructions',
        order: 2475,
        text: () => PROMPT_SECTION,
      }),
    'dsh-memory: prompt section',
  )
}
// ===== src/lib/entry/recall-controller.js =====
/**
 * 自动召回：在每轮第一步之前，用最后一条真实用户消息做向量检索，
 * 把相关记忆作为一条 source.kind = 'long-term-memory' 的上下文消息
 * 追加进本步的 messages。
 *
 * 该消息会进入会话日志（可回放/可 fork），DSH Web 会把它显示成
 * “上下文注入”行，而不是用户气泡。
 */




/** 从消息列表里取出最后一条真实人类消息的文本。 */
function lastUserText(messages) {
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'user') continue
    if (message.source?.kind !== 'user') continue
    const parts = []
    for (const block of message.content ?? []) {
      if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
    const text = parts.join('\n').trim()
    if (text) return text
  }
  return ''
}

/** 构造注入用的上下文消息。 */
function createMemoryMessage(text) {
  return {
    id: `memory-${randomUUID()}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: MEMORY_SOURCE },
  }
}

class RecallController {
  /**
   * @param {import('./service.js').MemoryService} service
   */
  constructor(service) {
    this.service = service
    this.ctx = service.ctx
    this.logger = service.logger
    /** sessionId → { ids, at }：上一轮注入的记忆（用于 D/E 确认/纠正检测）。 */
    this.lastInjected = new Map()
  }

  /** 识别用户确认/纠正的简单规则（D/E 类复述）。 */
  static detectFeedback(text) {
    const value = String(text ?? '').trim()
    if (!value) return ''
    // 只对短句/明确措辞生效，避免长句误判
    const confirm = /^(对|对呀|对的|没错|是的|嗯对|记住了|记一下|记住这个|yes|correct|right)[。！!,.，\s]*$/i
    const correct = /(不对|不是这样|不是的|错了|应该是|改成|纠正|说错了|actually,? no|not correct)/i
    if (correct.test(value)) return 'correct'
    if (confirm.test(value) || /^(没错|对的|记住了)/.test(value)) return 'confirm'
    return ''
  }

  start() {
    this.ctx.effect(
      () =>
        this.ctx.on('agent/pre-step', async (payload, next) => {
          const decision = await next()
          try {
            return await this.augment(payload, decision)
          } catch (error) {
            this.service.stats.lastRecallError = errorText(error)
            this.service.debugLog(`自动召回失败：${errorText(error)}`)
            return decision
          }
        }),
      'dsh-memory: auto recall',
    )
  }

  async augment(payload, decision) {
    // 睡眠整理期间：不召回，改为让模型只回复 zzzZZ，并把用户原话排队到睡醒后继续处理
    const sleep = this.service.sleep
    if (sleep?.isSleeping?.()) {
      if (payload?.step !== 1) return decision
      if (payload?.signal?.aborted) return decision
      if (decision?.kind !== 'enter') return decision
      const intercepted = sleep.interceptPreStep(payload, decision)
      if (intercepted?.message) {
        return { ...decision, messages: [...decision.messages, intercepted.message] }
      }
      return decision
    }
    const options = this.service.recallOptions()
    if (!options.autoRecall) return decision
    const agentId = String(payload?.agent?.id ?? '')

    // D/E：检查上一轮注入后用户的确认/纠正（仅当门控开启时记录复述）
    if (options.ageGateEnabled && payload?.step === 1) {
      const text = lastUserText(decision.messages) || lastUserText(payload.messages)
      const prior = this.lastInjected.get(agentId)
      const feedback = text ? RecallController.detectFeedback(text) : ''
      if (prior && feedback && Date.now() - prior.at < 10 * 60 * 1000) {
        const weight = feedback === 'confirm' ? 2.0 : 1.0
        void this.service.recordRehearsal(prior.ids, feedback, weight)
        this.lastInjected.delete(agentId)
      }
    }
    if (!this.service.captureOptions().includeSubagents && agentId) {
      const session = this.service.ctx.sessions?.get?.(agentId)
      if (session?.header?.origin === 'subagent') return decision
    }
    if (payload?.step !== 1) return decision
    if (payload?.signal?.aborted) return decision
    if (decision?.kind !== 'enter') return decision
    const query = lastUserText(decision.messages) || lastUserText(payload.messages)
    this.service.stats.recallChecks += 1
    this.service.stats.lastRecallQuery = query.slice(0, 120)
    this.service.stats.lastRecallError = ''
    if (!query || query.length < 2) return decision
    const context = this.service.sessionContext(agentId)
    const timeout = AbortSignal.timeout(options.recallTimeoutMs)
    const signal = payload?.signal === undefined ? timeout : AbortSignal.any([payload.signal, timeout])
    const { block, hits } = await this.service.recall(query, {
      signal,
      sessionId: context.sessionId,
      cwd: context.cwd,
    })
    if (!block || hits.length === 0) return decision
    this.service.stats.lastRecallInjectAt = Date.now()
    this.service.debugLog(`自动召回 ${hits.length} 条记忆（score ${Number(hits[0].score).toFixed(3)}）`)
    if (options.ageGateEnabled) {
      this.lastInjected.set(agentId, { ids: hits.map((hit) => hit.id), at: Date.now() })
    }
    return {
      ...decision,
      messages: [...decision.messages, createMemoryMessage(block)],
    }
  }
}
// ===== src/lib/entry/sleep-controller.js =====
/**
 * 睡眠控制器（v0.4）。
 *
 * - 每个配置的睡眠时间（默认 00:00，按用户时区）检查一次；
 * - 最近 idleMinutes 分钟内没有人类消息、且没有运行中的会话，才开始“睡觉”；
 * - 忙则每 sleepRetryMinutes 分钟重试，直到能睡（不设截止时间）；
 * - 睡觉期间用户发消息：自动召回阶段拦截，让对方只回复 zzzZZ，
 *   并把用户原话排队；整理完成后用 agent.followup 继续处理；
 * - 睡觉期间自动记录会跳过 zzzZZ 轮次，避免污染记忆。
 */




/** 构造一条 source.kind 为指定值的 user 消息。 */
function contextMessage(kind, id, text) {
  return {
    id: `${id}-${randomUUID()}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind },
  }
}

/** 从消息列表取出最后一条真实人类消息文本。 */
function lastHumanText(messages) {
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'user') continue
    if (message.source?.kind !== 'user') continue
    const parts = []
    for (const block of message.content ?? []) {
      if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
    const text = parts.join('\n').trim()
    if (text) return text
  }
  return ''
}

class SleepController {
  /**
   * @param {import('./service.js').MemoryService} service
   * @param {import('./consolidation.js').ConsolidationEngine} engine
   */
  constructor(service, engine) {
    this.service = service
    this.engine = engine
    this.ctx = service.ctx
    this.logger = service.logger
    this.disposed = false

    this.sleeping = false
    this.sleepingSince = 0
    this.lastActivityAt = Date.now()
    this.lastSleepDayKey = ''
    this.nextAttemptAt = 0
    this.lastSkipReason = ''
    this.lastError = ''
    this.lastResult = null
    this.pending = []
    this.runningSessions = new Set()
    this.timer = null
    this.startedAt = Date.now()
  }

  /** 注册事件监听与定时器（由插件 effect 持有）。 */
  start() {
    this.ctx.effect(
      () =>
        this.ctx.on('api-session/activity', (sessionId, updatedAt) => {
          try {
            this.touch(updatedAt)
          } catch {
            /* ignore */
          }
        }),
      'dsh-memory: sleep activity',
    )
    this.ctx.effect(
      () =>
        this.ctx.on('api-session/status', (sessionId, running) => {
          if (running) this.runningSessions.add(String(sessionId))
          else this.runningSessions.delete(String(sessionId))
        }),
      'dsh-memory: sleep session status',
    )
    this.ctx.effect(
      () =>
        this.ctx.on('agent/status', (payload) => {
          const id = String(payload?.agent?.id ?? '')
          if (!id) return
          if (payload?.status === 'running') this.runningSessions.add(id)
          else this.runningSessions.delete(id)
        }),
      'dsh-memory: sleep agent status',
    )
    this.ctx.effect(
      () =>
        this.ctx.on('session/event', (session, event) => {
          try {
            if (event?.type === 'user/message' && event.data?.source?.kind === 'user') {
              this.touch(Date.now())
            }
          } catch {
            /* ignore */
          }
        }),
      'dsh-memory: sleep user activity',
    )
    this.ctx.effect(
      () => () => {
        this.disposed = true
        if (this.timer) {
          try {
            this.timer()
          } catch {
            /* ignore */
          }
          this.timer = null
        }
      },
      'dsh-memory: sleep dispose',
    )
    try {
      if (typeof this.ctx.interval === 'function') {
        this.timer = this.ctx.interval(() => this.tick(), 30000)
      } else {
        this.timer = () => {}
        const handle = setInterval(() => this.tick(), 30000)
        handle.unref?.()
        this.timer = () => clearInterval(handle)
      }
    } catch (error) {
      this.logger.warn?.(`[dsh-memory] 睡眠定时器启动失败：${error?.message ?? error}`)
    }
    // 启动后 15 秒做一次补检查（允许错过睡眠点的 DSH 启动后补睡）
    const kickoff = setTimeout(() => this.tick(), 15000)
    kickoff.unref?.()
    this.service.debugLog('[dsh-memory] 睡眠控制器已启动')
  }

  /** 用户活动时间戳。 */
  touch(ts) {
    const value = Number(ts) > 0 ? Number(ts) : Date.now()
    if (value > this.lastActivityAt) this.lastActivityAt = value
    this.lastSkipReason = ''
  }

  /** 睡眠配置。 */
  options() {
    const cfg = this.service.cfg()
    const time = this.service.timeOptions()
    return {
      enabled: cfg.consolidationEnabled === true,
      sleepAt: String(cfg.sleepAt ?? '00:00'),
      sleepMinutes: parseHhMm(cfg.sleepAt) ?? 0,
      retryMs: Math.max(1, Number(cfg.sleepRetryMinutes) || 15) * 60000,
      idleMs: Math.max(1, Number(cfg.idleMinutes) || 60) * 60000,
      timeZone: time.timeZone,
      timeZoneLabel: time.timeZoneLabel,
    }
  }

  /** 当前是否在睡觉（整理中）。 */
  isSleeping() {
    return this.sleeping
  }

  /** 是否空闲：没有运行中的会话，且最近 idle 分钟没有人类消息。 */
  isIdle(now = Date.now()) {
    const options = this.options()
    if (this.runningSessions.size > 0) return false
    return now - this.lastActivityAt >= options.idleMs
  }

  /** 定时检查（每 30 秒）。 */
  tick() {
    if (this.disposed) return
    const options = this.options()
    if (!options.enabled) return
    if (this.sleeping) return
    const now = Date.now()
    const tz = options.timeZone
    const today = dayKey(now, tz)
    if (this.lastSleepDayKey === today) return
    if (!isAtOrAfterTime(options.sleepAt, tz, now)) return
    if (now < this.nextAttemptAt) return
    if (this.runningSessions.size > 0) {
      this.lastSkipReason = '有会话正在运行'
      this.nextAttemptAt = now + options.retryMs
      return
    }
    if (!this.isIdle(now)) {
      const idleMinutes = Math.round((now - this.lastActivityAt) / 60000)
      this.lastSkipReason = `用户最近 ${idleMinutes} 分钟内有会话，等待空闲`
      this.nextAttemptAt = now + options.retryMs
      return
    }
    this.startSleep({ manual: false, reason: 'schedule' })
  }

  /**
   * 开始睡觉并执行整理。手动触发时忽略空闲检测。
   * @param {{manual?:boolean, reason?:string}} options
   */
  async startSleep({ manual = false, reason = 'schedule' } = {}) {
    if (this.disposed) return { ok: false, reason: 'disposed' }
    if (this.sleeping) return { ok: false, reason: 'already-sleeping' }
    if (this.engine.busy) return { ok: false, reason: 'engine-busy' }
    this.sleeping = true
    this.sleepingSince = Date.now()
    this.lastError = ''
    this.lastSkipReason = ''
    this.service.debugLog(`[dsh-memory] 开始睡觉整理（${manual ? '手动' : '定时'}）`)
    try {
      const result = await this.engine.run({ manual, reason })
      this.lastResult = result
      if (!result.ok && result.errors?.length > 0) this.lastError = result.errors[0]
    } catch (error) {
      this.lastError = error?.message ?? String(error)
      this.lastResult = { ok: false, errors: [this.lastError] }
      this.logger.warn?.(`[dsh-memory] 睡眠整理失败：${this.lastError}`)
    } finally {
      const options = this.options()
      this.lastSleepDayKey = dayKey(this.sleepingSince, options.timeZone)
      this.sleeping = false
      this.nextAttemptAt = 0
      this.service.debugLog(
        `[dsh-memory] 睡醒，时长 ${formatDuration(Date.now() - this.sleepingSince)}${this.lastError ? `（有错误：${this.lastError}）` : ''}`,
      )
      await this.flushPending()
    }
    return this.lastResult ?? { ok: true }
  }

  /** 手动请求（HTTP 用：立即返回 accepted，后台执行）。 */
  requestManual() {
    if (this.sleeping) return { ok: false, reason: 'already-sleeping' }
    if (this.engine.busy) return { ok: false, reason: 'engine-busy' }
    this.startSleep({ manual: true, reason: 'manual' })
    return { ok: true, started: true }
  }

  /**
   * 睡觉期间的消息拦截（由 recall 控制器调用）。
   * @returns {null | {queued:boolean, message?:object}}
   */
  interceptPreStep(payload, decision) {
    if (!this.sleeping) return null
    if (payload?.step !== 1) return { queued: false }
    if (decision?.kind !== 'enter') return { queued: false }
    const text = lastHumanText(decision.messages) || lastHumanText(payload.messages)
    if (!text) return { queued: false }
    this.queueMessage({
      agent: payload?.agent,
      sessionId: String(payload?.agent?.id ?? ''),
      text,
    })
    this.service.stats.sleepReplies = (this.service.stats.sleepReplies ?? 0) + 1
    return {
      queued: true,
      message: contextMessage(
        SLEEP_SOURCE,
        'memory-sleep',
        `【记忆整理中】AI 正在睡觉整理长期记忆，稍后醒来会自动继续处理你刚才的消息。\n现在请只回复：zzzZZ（可以带一两个 Zzz 或 💤，不要回复任何其他内容，不要调用工具）。`,
      ),
    }
  }

  /** 排队一条睡眠期间的用户消息。 */
  queueMessage({ agent, sessionId, text }) {
    const clean = String(text ?? '').trim()
    if (!clean) return
    const id = String(agent?.id ?? sessionId ?? '')
    if (!id) return
    this.pending.push({ agent, sessionId: id, text: clean, at: Date.now() })
    if (this.pending.length > 20) this.pending = this.pending.slice(-20)
  }

  /** 醒来后继续处理排队消息。 */
  async flushPending() {
    if (this.pending.length === 0) return
    const bySession = new Map()
    for (const item of this.pending) {
      const id = item.sessionId
      if (!bySession.has(id)) bySession.set(id, { agent: item.agent, texts: [] })
      bySession.get(id).texts.push(item.text)
    }
    this.pending = []
    for (const [sessionId, group] of bySession) {
      const text = group.texts.map((item, index) => `${index + 1}. ${item}`).join('\n')
      const content = `【记忆整理完成】AI 已睡醒。请继续处理用户在睡觉期间发来的消息：\n${text}`
      try {
        const agent = group.agent
        if (agent && typeof agent.followup === 'function') {
          agent.followup(contextMessage(WAKE_SOURCE, 'memory-wake', content))
          this.service.debugLog(`[dsh-memory] 睡醒后继续处理 ${sessionId} 的排队消息`)
          continue
        }
        const live = this.ctx.agents?.get?.(sessionId)
        if (live && typeof live.followup === 'function') {
          live.followup(contextMessage(WAKE_SOURCE, 'memory-wake', content))
          continue
        }
        this.logger.warn?.(`[dsh-memory] 会话 ${sessionId} 已不在运行，跳过排队消息`)
      } catch (error) {
        this.logger.warn?.(`[dsh-memory] 睡醒后继续处理失败：${error?.message ?? error}`)
      }
    }
  }

  /** 状态视图（给 /status 与 GUI）。 */
  status() {
    const options = this.options()
    const now = Date.now()
    return {
      enabled: options.enabled,
      sleeping: this.sleeping,
      sleepingSince: this.sleepingSince,
      sleepingSinceTime: this.sleepingSince ? this.service.formatTs(this.sleepingSince) : '',
      sleepAt: options.sleepAt,
      retryMinutes: Math.round(options.retryMs / 60000),
      idleMinutes: Math.round(options.idleMs / 60000),
      timezone: options.timeZoneLabel,
      lastActivityAt: this.lastActivityAt,
      lastActivityTime: this.service.formatTs(this.lastActivityAt),
      idleForMinutes: Math.max(0, Math.floor((now - this.lastActivityAt) / 60000)),
      nextAttemptAt: this.nextAttemptAt,
      nextAttemptTime: this.nextAttemptAt ? this.service.formatTs(this.nextAttemptAt) : '',
      lastSleepDayKey: this.lastSleepDayKey,
      lastSkipReason: this.lastSkipReason,
      lastError: this.lastError,
      lastResult: this.lastResult
        ? {
            ok: this.lastResult.ok,
            startedAt: this.lastResult.startedAt,
            finishedAt: this.lastResult.finishedAt,
            durationMs: this.lastResult.durationMs,
            levels: this.lastResult.levels ?? {},
            batches: (this.lastResult.batches ?? []).slice(-10),
            deleted: this.lastResult.deleted ?? 0,
            errors: (this.lastResult.errors ?? []).slice(0, 5),
          }
        : null,
      pendingCount: this.pending.length,
      pendingPreview: this.pending.slice(-5).map((item) => ({
        sessionId: item.sessionId,
        text: item.text.slice(0, 120),
        at: item.at,
        time: this.service.formatTs(item.at),
      })),
      runningSessions: this.runningSessions.size,
      engine: this.engine.summary?.() ?? null,
    }
  }
}
// ===== src/lib/entry/tools.js =====
/**
 * 提供给模型的长期记忆工具：
 * - memory_search：检索长期记忆
 * - memory_save：主动保存一条值得长期记住的事实
 * - memory_forget：删除一条记忆
 *
 * 使用原始 ctx.tools.register（不依赖 DSH 内部工具包），参数 schema 只使用
 * DSH 支持的 JSON Schema 子集：type/oneOf/properties/required/items/enum/const。
 */



/** 统一的文本型工具输出渲染。 */
function renderText(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function assertEnabled(service) {
  const options = service.toolOptions()
  if (!options.toolsEnabled) {
    throw new Error('长期记忆工具已被禁用（可在 Settings → 长期记忆 → 记忆行为 中开启）')
  }
  return options
}

/** 按记忆范围构造检索上下文。 */
function scopeFor(service, agentId) {
  const recall = service.recallOptions()
  const context = service.sessionContext(agentId)
  return {
    mode: recall.memoryScope,
    sessionId: context.sessionId,
    cwd: context.cwd,
    // 工具是模型主动查询，允许包含当前会话
    includeCurrentSession: true,
  }
}

function searchTool(service) {
  return {
    name: 'memory_search',
    description:
      '检索长期记忆库（跨会话保存的历史对话要点、事实、偏好、图片概览）。当需要回忆用户以前说过的事、做过的事、偏好或项目背景时使用。不要在没检索的情况下编造过去的记忆。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: '要检索的内容或问题，使用自然语言；越具体越好。',
        },
        limit: {
          type: 'integer',
          description: '返回条数（1-20）。',
        },
      },
      required: ['query'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer' },
          scope: { type: 'string' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                text: { type: 'string' },
                kind: { type: 'string' },
                time: { type: 'string' },
                relative: { type: 'string' },
                score: { type: 'number' },
                sessionId: { type: 'string' },
                cwd: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                importance: { type: 'number' },
                confidence: { type: 'number' },
                ageDays: { type: 'number' },
                requiredScore: { type: 'number' },
                effectiveScore: { type: 'number' },
              },
              required: ['id', 'text', 'kind', 'time', 'score'],
            },
          },
        },
        required: ['count', 'results'],
      },
      render: renderText,
    },
    async execute(args, exec) {
      const options = assertEnabled(service)
      const query = typeof args?.query === 'string' ? cleanText(args.query) : ''
      if (!query) throw new Error('memory_search: 需要提供非空的 query 参数')
      const limit = Number.isInteger(args?.limit)
        ? Math.min(20, Math.max(1, args.limit))
        : options.searchLimit
      const scope = scopeFor(service, exec?.agent?.id)
      const { hits } = await service.search(query, {
        limit,
        signal: exec?.signal,
        ...scope,
      })
      const recallOptions = service.recallOptions()
      const ranked = recallOptions.ageGateEnabled ? service.rankHits(hits, 'tool').pass : hits
      const selected = ranked.slice(0, limit)
      // B 类：模型主动线索检索命中 = 有效复述（强化，而不是被动曝光）
      if (recallOptions.ageGateEnabled && selected.length > 0) {
        void service.recordRehearsal(selected.map((hit) => hit.id), 'search', 1.0)
      }
      return {
        count: selected.length,
        scope: scope.mode,
        results: selected.map((hit) => ({
          id: hit.id,
          text: hit.text,
          kind: hit.kind,
          time: hit.time,
          relative: hit.relative ?? '',
          score: Number(hit.score.toFixed(4)),
          sessionId: hit.sessionId,
          cwd: hit.cwd,
          tags: hit.tags,
          importance: Number.isFinite(hit.importance) ? Number(hit.importance.toFixed(3)) : undefined,
          confidence: Number.isFinite(hit.confidence) ? Number(hit.confidence.toFixed(3)) : undefined,
          ageDays: Number.isFinite(hit.ageDays) ? hit.ageDays : undefined,
          requiredScore: Number.isFinite(hit.requiredScore) ? hit.requiredScore : undefined,
          effectiveScore: Number.isFinite(hit.effectiveScore) ? hit.effectiveScore : undefined,
        })),
      }
    },
  }
}

function saveTool(service) {
  return {
    name: 'memory_save',
    description:
      '把一条值得长期记住的信息保存进长期记忆库（用户偏好、身份、项目背景、重要决定、常用路径/命令、约定等）。写一条自包含的事实，不要用“他/它/这个”等指代；不要保存密码、密钥等敏感凭据。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        content: {
          type: 'string',
          description: '要记住的内容，一条一个事实，简洁、自包含。',
        },
        kind: {
          type: 'string',
          enum: ['fact', 'preference', 'project', 'note'],
          description: '记忆类型：fact=事实、preference=偏好、project=项目背景、note=其他备注。',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '可选标签，便于以后检索。',
        },
      },
      required: ['content'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          id: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['ok', 'id'],
      },
      render: renderText,
    },
    async execute(args, exec) {
      assertEnabled(service)
      const content = typeof args?.content === 'string' ? cleanText(args.content) : ''
      if (!content) throw new Error('memory_save: 需要提供非空的 content 参数')
      if (content.length > 4000) throw new Error('memory_save: content 过长（最多 4000 字）')
      const kind = typeof args?.kind === 'string' ? args.kind : 'fact'
      const tags = Array.isArray(args?.tags)
        ? args.tags.filter((tag) => typeof tag === 'string').slice(0, 12)
        : []
      const context = service.sessionContext(exec?.agent?.id)
      const saved = await service.addMemory({
        kind,
        text: content,
        meta: {
          tags,
          source: 'memory_save',
          sessionId: context.sessionId,
          cwd: context.cwd,
          importance: MANUAL_SAVE.importance,
          confidence: MANUAL_SAVE.confidence,
        },
        signal: exec?.signal,
      })
      return { ok: true, id: saved.id, text: saved.text }
    },
  }
}

function forgetTool(service) {
  return {
    name: 'memory_forget',
    description:
      '从长期记忆库中删除一条记忆。先用 memory_search 找到要删除的记忆 id，再调用本工具；不要猜测 id。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: {
          type: 'string',
          description: '要删除的记忆 id（来自 memory_search 的结果）。',
        },
      },
      required: ['id'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          deleted: { type: 'integer' },
        },
        required: ['ok', 'deleted'],
      },
      render: renderText,
    },
    async execute(args) {
      assertEnabled(service)
      const id = typeof args?.id === 'string' ? args.id.trim() : ''
      if (!id) throw new Error('memory_forget: 需要提供 id 参数（来自 memory_search 结果）')
      try {
        return await service.forget([id])
      } catch (error) {
        throw new Error(`memory_forget 失败：${errorText(error)}`)
      }
    },
  }
}

/** 注册全部记忆工具；返回 dispose 函数数组。 */
function registerMemoryTools(service) {
  const ctx = service.ctx
  const tools = [searchTool(service), saveTool(service), forgetTool(service)]
  return tools.map((tool) =>
    ctx.effect(() => ctx.tools.register(tool), `dsh-memory: tool ${tool.name}`),
  )
}
// ===== src/lib/entry/bootstrap.js =====
/**
 * 插件装配（R4 组合根）：只负责把服务/控制器/路由/定时器接起来。
 * index.js 保持为极薄的 Host 入口（name/inject/Config/apply）。
 */











/**
 * @param {object} ctx DSH 插件上下文
 * @param {object} config schemastery Config 实例
 */
function applyPlugin(ctx, config) {
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
    `[dsh-memory] 已加载 v0.7.0：provider=${provider.id}（${provider.embedModel}，${provider.dimensions} 维）→ Qdrant ${service.storage().qdrantUrl} / ${service.storage().collection}`,
  )

  // 启动自检：确保 collection 存在，并补齐旧记忆标签（失败只告警）
  Promise.resolve()
    .then(() => service.ensureReady())
    .then((info) => {
      if (info?.created) logger.info?.(`[dsh-memory] 已创建 Qdrant 集合 ${service.storage().collection}`)
      return service.migrateLegacyMemories().then(() => service.migrateDynamicFields())
    })
    .catch((error) => {
      logger.warn?.(`[dsh-memory] 启动自检失败：${errorText(error)}`)
    })
}
// ===== src/index.js =====
/**
 * dsh-memory Host 入口（组合根）：只声明标识/依赖/配置并交给 entry/bootstrap 装配。
 * 具体分层与依赖规则见 docs/ARCHITECTURE.md。
 */



const name = 'dsh-memory'

/** 需要的 Host 服务；缺任意一个时插件保持未激活，而不是报错。 */
const inject = [
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


/**
 * @param {object} ctx DSH 插件上下文
 * @param {object} config schemastery Config 实例
 */
function apply(ctx, config) {
  applyPlugin(ctx, config)
}

export { name, inject, Config, apply }
