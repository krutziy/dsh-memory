    /** 本页面的 locale 命名空间。 */
    const NS = 'settings.memory'
    /** 插件配置在 Loader 中的行 id（命名空间可能带 include: 前缀，运行时动态解析）。 */
    const ENTRY_HINT = 'memory'
    /** HTTP 接口前缀。 */
    const API = '/__dsh_memory__'
    /** POST 请求防 CSRF 的自定义头。 */
    const POST_HEADER = { 'Content-Type': 'application/json', 'x-dsh-memory': '1' }

    /** 内置 provider 预设：一键添加常用云端服务商。 */
    const PROVIDER_PRESETS = [
      {
        key: 'siliconflow',
        name: '硅基流动 SiliconFlow',
        baseUrl: 'https://api.siliconflow.cn/v1',
        embedModel: 'Qwen/Qwen3-VL-Embedding-8B',
        dimensions: 1024,
        visionModel: 'Qwen/Qwen3-VL-8B-Instruct',
        apiKeyEnv: 'SILICONFLOW_API_KEY',
      },
      {
        key: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        embedModel: 'text-embedding-3-small',
        dimensions: 1536,
        visionModel: 'gpt-4o-mini',
        apiKeyEnv: 'OPENAI_API_KEY',
      },
      {
        key: 'dashscope',
        name: '阿里云百炼 DashScope',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        embedModel: 'text-embedding-v4',
        dimensions: 1024,
        visionModel: 'qwen-vl-max',
        apiKeyEnv: 'DASHSCOPE_API_KEY',
      },
      {
        key: 'zhipu',
        name: '智谱 BigModel',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        embedModel: 'embedding-3',
        dimensions: 2048,
        visionModel: 'glm-4v-flash',
        apiKeyEnv: 'ZHIPU_API_KEY',
      },
      {
        key: 'ark',
        name: '火山方舟 Ark',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        embedModel: 'doubao-embedding-text-240715',
        dimensions: 2560,
        visionModel: 'doubao-vision-pro-32k',
        apiKeyEnv: 'ARK_API_KEY',
      },
      {
        key: 'jina',
        name: 'Jina AI',
        baseUrl: 'https://api.jina.ai/v1',
        embedModel: 'jina-embeddings-v3',
        dimensions: 1024,
        visionModel: '',
        apiKeyEnv: 'JINA_API_KEY',
      },
      {
        key: 'voyage',
        name: 'Voyage AI',
        baseUrl: 'https://api.voyageai.com/v1',
        embedModel: 'voyage-3',
        dimensions: 1024,
        visionModel: '',
        apiKeyEnv: 'VOYAGE_API_KEY',
      },
      {
        key: 'custom',
        name: '自定义 OpenAI 兼容',
        baseUrl: '',
        embedModel: '',
        dimensions: 1024,
        visionModel: '',
        apiKeyEnv: '',
      },
    ]

    /** 设置页时区选项（IANA 名称）。 */
    const TIMEZONE_OPTIONS = [
      { value: '', label: '跟随服务器本地（自动）' },
      { value: 'Asia/Shanghai', label: 'Asia/Shanghai（北京时间 UTC+8）' },
      { value: 'Asia/Hong_Kong', label: 'Asia/Hong_Kong（香港 UTC+8）' },
      { value: 'Asia/Taipei', label: 'Asia/Taipei（台北 UTC+8）' },
      { value: 'Asia/Tokyo', label: 'Asia/Tokyo（东京 UTC+9）' },
      { value: 'Asia/Seoul', label: 'Asia/Seoul（首尔 UTC+9）' },
      { value: 'Asia/Singapore', label: 'Asia/Singapore（新加坡 UTC+8）' },
      { value: 'Asia/Bangkok', label: 'Asia/Bangkok（曼谷 UTC+7）' },
      { value: 'Asia/Kolkata', label: 'Asia/Kolkata（印度 UTC+5:30）' },
      { value: 'Asia/Dubai', label: 'Asia/Dubai（迪拜 UTC+4）' },
      { value: 'UTC', label: 'UTC（协调世界时）' },
      { value: 'Europe/London', label: 'Europe/London（伦敦）' },
      { value: 'Europe/Paris', label: 'Europe/Paris（巴黎）' },
      { value: 'Europe/Berlin', label: 'Europe/Berlin（柏林）' },
      { value: 'Europe/Moscow', label: 'Europe/Moscow（莫斯科）' },
      { value: 'America/New_York', label: 'America/New_York（纽约）' },
      { value: 'America/Chicago', label: 'America/Chicago（芝加哥）' },
      { value: 'America/Denver', label: 'America/Denver（丹佛）' },
      { value: 'America/Los_Angeles', label: 'America/Los_Angeles（洛杉矶）' },
      { value: 'America/Sao_Paulo', label: 'America/Sao_Paulo（圣保罗）' },
      { value: 'Australia/Perth', label: 'Australia/Perth（珀斯）' },
      { value: 'Australia/Sydney', label: 'Australia/Sydney（悉尼）' },
      { value: 'Pacific/Auckland', label: 'Pacific/Auckland（奥克兰）' },
      { value: 'custom', label: '自定义 IANA 时区…' },
    ]

    /** 标量配置字段（providers / activeProvider 由单独编辑器管理）。 */
    const SCALAR_FIELDS = [
      { key: 'qdrantUrl', type: 'text', tab: 'model' },
      { key: 'collection', type: 'text', tab: 'model' },
      { key: 'qdrantApiKeyEnv', type: 'text', tab: 'model' },
      { key: 'memoryScope', type: 'select', tab: 'behavior', options: ['global', 'workspace', 'session'] },
      { key: 'autoCapture', type: 'switch', tab: 'behavior' },
      { key: 'autoRecall', type: 'switch', tab: 'behavior' },
      { key: 'recallTopK', type: 'number', tab: 'behavior' },
      { key: 'recallMinScore', type: 'number', tab: 'behavior', float: true },
      { key: 'recallMaxChars', type: 'number', tab: 'behavior' },
      { key: 'recallIncludeCurrentSession', type: 'switch', tab: 'behavior' },
      { key: 'recallTimeoutMs', type: 'number', tab: 'behavior' },
      { key: 'timezone', type: 'select', tab: 'behavior', optionDefs: TIMEZONE_OPTIONS },
      { key: 'timezoneCustom', type: 'text', tab: 'behavior' },
      { key: 'injectCurrentTime', type: 'switch', tab: 'behavior' },
      { key: 'relativeTime', type: 'switch', tab: 'behavior' },
      { key: 'consolidationEnabled', type: 'switch', tab: 'behavior' },
      { key: 'consolidationLimitItems', type: 'switch', tab: 'behavior' },
      { key: 'consolidationSource', type: 'select', tab: 'models', options: ['dsh', 'custom'] },
      { key: 'consolidationDshProvider', type: 'text', tab: 'models' },
      { key: 'consolidationDshModel', type: 'text', tab: 'models' },
      { key: 'captionSource', type: 'select', tab: 'models', options: ['dsh', 'custom'] },
      { key: 'captionDshProvider', type: 'text', tab: 'models' },
      { key: 'captionDshModel', type: 'text', tab: 'models' },
      { key: 'sleepAt', type: 'text', tab: 'behavior' },
      { key: 'sleepRetryMinutes', type: 'number', tab: 'behavior' },
      { key: 'idleMinutes', type: 'number', tab: 'behavior' },
      { key: 'consolidationProviderId', type: 'text', tab: 'behavior' },
      { key: 'consolidationModel', type: 'text', tab: 'behavior' },
      { key: 'experimentalEventMergeEnabled', type: 'switch', tab: 'behavior' },
      { key: 'experimentalEventMergeThreshold', type: 'number', tab: 'behavior', float: true },
      { key: 'experimentalEventMergeMaxCandidates', type: 'number', tab: 'behavior' },
      { key: 'experimentalEnhancementEnabled', type: 'switch', tab: 'behavior' },
      { key: 'experimentalEnhancementDays', type: 'number', tab: 'behavior' },
      { key: 'imageMode', type: 'select', tab: 'behavior', options: ['caption', 'placeholder', 'off'] },
      { key: 'captionPrompt', type: 'textarea', tab: 'behavior' },
      { key: 'captionMaxTokens', type: 'number', tab: 'behavior' },
      { key: 'toolsEnabled', type: 'switch', tab: 'behavior' },
      { key: 'toolSearchLimit', type: 'number', tab: 'behavior' },
      { key: 'retentionDays', type: 'number', tab: 'manage' },
      { key: 'maxMemories', type: 'number', tab: 'manage' },
      { key: 'maintenanceIntervalHours', type: 'number', tab: 'manage' },
      { key: 'maintenanceDedupe', type: 'switch', tab: 'manage' },
      { key: 'dedupeThreshold', type: 'number', tab: 'manage', float: true },
      { key: 'dedupeMaxScan', type: 'number', tab: 'manage' },
      { key: 'captureUserChars', type: 'number', tab: 'advanced' },
      { key: 'captureAssistantChars', type: 'number', tab: 'advanced' },
      { key: 'captureMinChars', type: 'number', tab: 'advanced' },
      { key: 'includeSubagents', type: 'switch', tab: 'advanced' },
      { key: 'consolidationInputMaxChars', type: 'number', tab: 'advanced' },
      { key: 'debug', type: 'switch', tab: 'advanced' },
      { key: 'captionProviderId', type: 'text', tab: 'models' },
      { key: 'captionModel', type: 'text', tab: 'models' },
    ]
    const SCALAR_BY_KEY = new Map(SCALAR_FIELDS.map((field) => [field.key, field]))

    /** 极小 snapshot store（给 renderer 的 observable hook 用）。 */
    function createStore(initial) {
      let snapshot = initial
      const listeners = new Set()
      return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        set: (next) => {
          if (next === snapshot) return
          snapshot = next
          for (const listener of [...listeners]) listener()
        },
      }
    }

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

    /** 配置值 → 输入框草稿。 */
    function draftOf(field, value) {
      if (field.type === 'switch') return value === true
      if (value === undefined || value === null) return ''
      return String(value)
    }

    /** 草稿 → 保存的值。 */
    function valueOf(field, draft, t) {
      if (field.type === 'switch') return draft === true
      const text = String(draft ?? '').trim()
      if (field.type === 'number') {
        if (text === '') throw new Error(t('required'))
        const number = Number(text)
        if (!Number.isFinite(number)) throw new Error(t('invalidNumber'))
        return field.float ? Math.round(number * 100) / 100 : Math.round(number)
      }
      if (field.type === 'select') {
        // 部分 select 允许空值（例如时区留空=跟随服务器本地）
        return text
      }
      return text
    }

    function sameScalar(field, draft, saved) {
      if (field.type === 'switch') return (draft === true) === (saved === true)
      return String(draft ?? '').trim() === String(saved ?? '').trim()
    }

    /** 规范化 provider 草稿（用于比较与提交）。 */
    function normalizeProviderDraft(provider) {
      return {
        id: String(provider.id ?? '').trim(),
        name: String(provider.name ?? '').trim(),
        protocol: String(provider.protocol ?? 'openai').trim() || 'openai',
        baseUrl: String(provider.baseUrl ?? '').trim(),
        embedModel: String(provider.embedModel ?? '').trim(),
        dimensions: Math.round(Number(provider.dimensions) || 0),
        apiKeyEnv: String(provider.apiKeyEnv ?? '').trim(),
        sendDimensions: provider.sendDimensions !== false,
        visionModel: String(provider.visionModel ?? '').trim(),
        visionBaseUrl: String(provider.visionBaseUrl ?? '').trim(),
        visionApiKeyEnv: String(provider.visionApiKeyEnv ?? '').trim(),
      }
    }

    function providerDraftFromConfig(provider) {
      const normalized = normalizeProviderDraft(provider)
      return { ...normalized }
    }

    function providersEqual(a, b) {
      return JSON.stringify((a ?? []).map(normalizeProviderDraft)) === JSON.stringify((b ?? []).map(normalizeProviderDraft))
    }

    function providerIdToEnv(id) {
      const text = String(id ?? '')
        .trim()
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase()
      return (text || 'CUSTOM') + '_API_KEY'
    }

    function providerKeyRef(provider) {
      return String(provider?.apiKeyEnv ?? '').trim() || providerIdToEnv(provider?.id)
    }

    function providerVisionKeyRef(provider) {
      return String(provider?.visionApiKeyEnv ?? '').trim() || providerKeyRef(provider)
    }

    function formatTimeShort(value) {
      return value && typeof value === 'string' ? value : ''
    }
