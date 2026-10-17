/**
 * dsh-memory 插件配置（v0.2）。
 *
 * 所有用户可调项都声明为 `.volatile()`，DSH 的 Settings 服务会把它们投影成
 * 可编辑表单，设置页通过 ctx.configForms 读写，保存后热生效。
 *
 * v0.2 起支持多 provider 档案：providers 是整棵被标记 volatile 的数组，
 * 设置页可以增删改、切换 activeProvider；不再绑定硅基流动。
 */
import { z } from './schemastery.js'

/** 常用嵌入维度档位（不同模型支持范围不同，这里作为提示）。 */
export const DIMENSIONS = [256, 512, 768, 1024, 1536, 2048, 2560, 3072, 4096]

/** 图片记忆方式。 */
export const IMAGE_MODES = ['caption', 'placeholder', 'off']

/** 记忆范围。 */
export const SCOPE_MODES = ['global', 'workspace', 'session']

/** 单个 provider 档案的字段结构（同时用于客户端预设与校验）。 */
export const PROVIDER_FIELDS = [
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

export const Config = z.object({
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

  // -------------------- 图片 --------------------
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

  // -------------------- 其他 --------------------
  debug: z.boolean().default(false).volatile().description('在 DSH 日志中输出插件调试信息'),
})
