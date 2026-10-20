/**
 * 注入系统提示词的长期记忆使用说明（入口层，只做文本与注册）。
 * @param {object} ctx DSH 插件上下文
 */
export const PROMPT_SECTION = [
  '## 长期记忆',
  '你拥有一个跨会话的持久化长期记忆库（由 dsh-memory 插件提供）。',
  '- 相关历史记忆可能以 source 为 long-term-memory 的上下文消息自动提供给你（通常以【长期记忆·自动召回】开头）。它们只是参考；若与当前对话冲突，以当前对话为准，不要向用户复述“经检索”之类的话。',
  '- 当用户透露值得长期记住的信息（偏好、身份、项目背景、重要决定、常用路径或命令、约定等）时，调用 memory_save 保存。每条记忆应当简洁、自包含（不要用“他/它/这个”等指代），一条一个事实；不要保存密码、密钥等敏感凭据。',
  '- 需要回忆过去的信息时，调用 memory_search 检索。不要凭空编造没有检索到的记忆。',
  '- 用户要求忘记某条记忆时，先用 memory_search 找到 id，再调用 memory_forget 删除。',
  '- 记忆条目会带发生时间（按配置时区显示，可能附相对时间）；自动召回上下文里也可能给出“当前时间”。需要判断信息新旧或做时间推算时，使用这些时间，不要假设当前日期。',
].join('\n')

/** 注册提示词段。 */
export function registerPromptSection(ctx) {
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
