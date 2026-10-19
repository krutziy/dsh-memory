/**
 * dsh-memory 浏览器半（v0.2）：Settings → 长期记忆 设置页。
 *
 * 数据来源：
 * - 插件配置：ctx.configForms（DSH Settings 服务，写回 profile patch，热生效）
 * - API Key：ctx.remote.credentials（写入 DSH 凭据库，不回传密钥本身）
 * - 运行状态 / 记忆管理 / 测试：同源 HTTP 接口 /__dsh_memory__/*
 *
 * 纯 JS，无构建步骤；只使用 React 基础能力与主题 CSS 变量。
 */
window.__ModuleLoader__.load({
  id: 'dsh-memory',
  factory(require) {
    const React = require('react')
    const h = React.createElement

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
      { key: 'level1Ratio', type: 'number', tab: 'advanced', float: true },
      { key: 'level1MaxItems', type: 'number', tab: 'advanced' },
      { key: 'level2AfterDays', type: 'number', tab: 'advanced' },
      { key: 'level2Ratio', type: 'number', tab: 'advanced', float: true },
      { key: 'level2MaxItems', type: 'number', tab: 'advanced' },
      { key: 'level3AfterDays', type: 'number', tab: 'advanced' },
      { key: 'level3Ratio', type: 'number', tab: 'advanced', float: true },
      { key: 'level3MaxItems', type: 'number', tab: 'advanced' },
      { key: 'consolidationInputMaxChars', type: 'number', tab: 'advanced' },
      { key: 'debug', type: 'switch', tab: 'advanced' },
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

    // ---------------------------------------------------------------------
    // 页面控制器
    // ---------------------------------------------------------------------
    class MemoryPageController {
      constructor(ctx) {
        this.ctx = ctx
        this.ns = null
        this.form = null
        this.formUnsub = null
        this.mirror = ctx.configForms.describe()
        this.state = {
          phase: 'loading',
          writable: false,
          revision: undefined,
          value: {},
          drafts: {},
          dirty: {},
          providers: [],
          activeProvider: '',
          providersDirty: false,
          apiKeyDrafts: {},
          credentials: {},
          providerTests: {},
          status: { phase: 'idle', data: null, error: null },
          activeTest: { phase: 'idle', data: null, error: null },
          consolidation: { phase: 'idle', data: null, error: null },
          sleepRun: { phase: 'idle', error: null },
          memories: {
            phase: 'idle',
            items: [],
            total: null,
            nextOffset: null,
            query: '',
            kind: '',
            range: '',
            level: '',
            error: null,
            loadingMore: false,
          },
          memoryAdd: { text: '', kind: 'note' },
          maintenance: { phase: 'idle', result: null, error: null },
          exportState: { phase: 'idle', error: null },
          tab: 'overview',
          saving: false,
          saveError: null,
          saveOk: false,
          recreating: false,
          recreateError: null,
        }
        this.store = createStore(this.state)
        this.unsubs = []
        this.mirrorSub = this.mirror.subscribe(() => this.resolveNamespace())
        this.mirror.ensure()
        this.resolveNamespace()
        this.loadCredentials()
        this.refreshStatus()
        this.refreshConsolidation()
        this.loadMemories({ reset: true })
        this.sleepPoll = setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          this.refreshStatus()
          this.refreshConsolidation()
        }, 20000)
        const remote = ctx.remote
        if (remote && typeof remote.$on === 'function') {
          this.unsubs.push(
            remote.$on('settings/document-updated', () => {
              this.refreshStatus()
              this.loadCredentials()
            }),
          )
          this.unsubs.push(
            remote.$on('credentials/reference-updated', () => {
              this.loadCredentials()
            }),
          )
          this.unsubs.push(
            remote.$on('connection/reset', () => {
              this.loadCredentials()
              this.refreshStatus()
            }),
          )
        }
      }

      patch(partial) {
        this.state = { ...this.state, ...partial }
        this.store.set(this.state)
      }

      setTab(tab) {
        this.patch({ tab })
        if (tab === 'manage') {
          if (this.state.memories.phase === 'idle') this.loadMemories({ reset: true })
          this.refreshConsolidation()
        }
      }

      /** 在 settings describe 镜像里找到本插件的命名空间。 */
      resolveNamespace() {
        const mirrorSnapshot = this.mirror.getSnapshot()
        const view = mirrorSnapshot?.view
        if (!view) {
          this.patch({
            phase:
              mirrorSnapshot?.status === 'unavailable' || mirrorSnapshot?.status === 'error'
                ? 'unavailable'
                : 'loading',
          })
          return
        }
        const namespaces = Array.isArray(view.namespaces) ? view.namespaces : []
        const schemaText = (ns) => {
          try {
            return JSON.stringify(ns.schema ?? {})
          } catch {
            return ''
          }
        }
        const found =
          namespaces.find(
            (ns) => schemaText(ns).includes('"embedModel"') && schemaText(ns).includes('"qdrantUrl"'),
          ) ??
          namespaces.find(
            (ns) =>
              ns.ns === ENTRY_HINT ||
              String(ns.ns).endsWith(':' + ENTRY_HINT) ||
              String(ns.ns).endsWith('#' + ENTRY_HINT),
          )
        if (!found) {
          this.patch({ phase: 'unavailable' })
          return
        }
        if (this.ns === found.ns && this.form) {
          this.derive()
          return
        }
        this.ns = found.ns
        if (this.formUnsub) {
          this.formUnsub()
          this.formUnsub = null
        }
        this.form = this.ctx.configForms.get(found.ns)
        this.formUnsub = this.form.subscribe(() => this.derive())
        this.form.ensure?.()
        this.derive()
      }

      /** 把表单快照折叠成页面状态。 */
      derive() {
        const snapshot = this.form?.getSnapshot?.()
        if (!snapshot || snapshot.status === 'loading') {
          this.patch({ phase: 'loading', writable: !!snapshot?.writable })
          return
        }
        if (snapshot.status !== 'ready') {
          this.patch({ phase: 'unavailable', writable: !!snapshot?.writable })
          return
        }
        const value = snapshot.value && typeof snapshot.value === 'object' ? snapshot.value : {}
        const drafts = { ...this.state.drafts }
        for (const field of SCALAR_FIELDS) {
          if (this.state.dirty[field.key]) continue
          drafts[field.key] = draftOf(field, value[field.key])
        }
        let providers = this.state.providers
        let activeProvider = this.state.activeProvider
        if (!this.state.providersDirty) {
          providers = Array.isArray(value.providers)
            ? value.providers.map((provider) => providerDraftFromConfig(provider))
            : []
          activeProvider = String(value.activeProvider ?? '') || providers[0]?.id || ''
        }
        this.patch({
          phase: 'ready',
          writable: snapshot.writable !== false,
          revision: snapshot.revision,
          value,
          drafts,
          providers,
          activeProvider,
        })
      }

      // ---------------- 标量字段 / provider 编辑 ----------------
      editField(key, next) {
        const field = SCALAR_BY_KEY.get(key)
        if (!field) return
        this.patch({
          drafts: { ...this.state.drafts, [key]: next },
          dirty: { ...this.state.dirty, [key]: true },
          saveOk: false,
          saveError: null,
        })
      }

      editProvider(index, field, value) {
        const providers = this.state.providers.map((provider, itemIndex) =>
          itemIndex === index ? { ...provider, [field]: value } : provider,
        )
        const activeProvider = this.state.activeProvider
        this.patch({ providers, providersDirty: true, saveOk: false, saveError: null })
        void activeProvider
      }

      addProvider(presetKey) {
        const preset = PROVIDER_PRESETS.find((item) => item.key === presetKey) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1]
        const usedIds = new Set(this.state.providers.map((provider) => String(provider.id ?? '').trim()))
        let id = preset.key
        let suffix = 2
        while (usedIds.has(id)) {
          id = `${preset.key}_${suffix}`
          suffix += 1
        }
        const provider = normalizeProviderDraft({
          id,
          name: preset.name,
          protocol: 'openai',
          baseUrl: preset.baseUrl,
          embedModel: preset.embedModel,
          dimensions: preset.dimensions,
          apiKeyEnv: preset.apiKeyEnv || providerIdToEnv(id),
          sendDimensions: true,
          visionModel: preset.visionModel,
          visionBaseUrl: '',
          visionApiKeyEnv: '',
        })
        this.patch({
          providers: [...this.state.providers, provider],
          providersDirty: true,
          activeProvider: this.state.activeProvider || provider.id,
          saveOk: false,
          saveError: null,
        })
      }

      removeProvider(index) {
        const providers = this.state.providers.filter((_, itemIndex) => itemIndex !== index)
        let activeProvider = this.state.activeProvider
        if (!providers.some((provider) => provider.id === activeProvider)) {
          activeProvider = providers[0]?.id ?? ''
        }
        this.patch({
          providers,
          activeProvider,
          providersDirty: true,
          saveOk: false,
          saveError: null,
        })
      }

      setActiveProviderId(id) {
        this.patch({ activeProvider: String(id ?? ''), saveOk: false, saveError: null })
      }

      setProviderKeyDraft(ref, text) {
        this.patch({ apiKeyDrafts: { ...this.state.apiKeyDrafts, [String(ref)]: text } })
      }

      // ---------------- 凭据 ----------------
      collectCredentialRefs() {
        const refs = new Set()
        for (const provider of this.state.providers) {
          refs.add(providerKeyRef(provider))
          refs.add(providerVisionKeyRef(provider))
        }
        const qdrantRef = String(this.state.drafts.qdrantApiKeyEnv ?? '').trim()
        if (qdrantRef) refs.add(qdrantRef)
        return [...refs].filter(Boolean)
      }

      async loadCredentials() {
        const refs = this.collectCredentialRefs()
        if (refs.length === 0) {
          this.patch({ credentials: {} })
          return
        }
        try {
          const response = await this.ctx.remote.credentials.describe(refs)
          if (response && response.ok) {
            const credentials = {}
            for (const ref of refs) {
              const info = response.value?.[ref]
              credentials[ref] = {
                configured: info?.configured === true,
                writable: info?.writable !== false,
              }
            }
            this.patch({ credentials })
          }
        } catch {
          /* 凭据服务不可用时页面仍可展示配置 */
        }
      }

      async saveProviderKey(ref) {
        const key = String(this.state.apiKeyDrafts[ref] ?? '').trim()
        if (!key) return
        try {
          const response = await this.ctx.remote.credentials.set(ref, key)
          if (response && response.ok === false) {
            throw new Error(response.error?.message ?? '写入凭据失败')
          }
          this.patch({ apiKeyDrafts: { ...this.state.apiKeyDrafts, [ref]: '' } })
          await this.loadCredentials()
          this.refreshStatus()
        } catch (error) {
          this.patch({ saveError: errorText(error) })
        }
      }

      async clearProviderKey(ref) {
        try {
          await this.ctx.remote.credentials.unset(ref)
          await this.loadCredentials()
          this.refreshStatus()
        } catch (error) {
          this.patch({ saveError: errorText(error) })
        }
      }

      // ---------------- 保存配置 ----------------
      collectOps(t) {
        const ops = []
        for (const field of SCALAR_FIELDS) {
          const saved = this.state.value[field.key]
          const draft = this.state.drafts[field.key]
          if (sameScalar(field, draft, saved)) continue
          ops.push({ op: 'set', path: [field.key], value: valueOf(field, draft, t) })
        }
        const stagedProviders = (this.state.providers ?? []).map(normalizeProviderDraft)
        const savedProviders = Array.isArray(this.state.value.providers)
          ? this.state.value.providers.map(normalizeProviderDraft)
          : []
        if (!providersEqual(stagedProviders, savedProviders)) {
          const errors = []
          const ids = new Set()
          stagedProviders.forEach((provider, index) => {
            if (!provider.id) errors.push(t('providerIdRequired', { index: index + 1 }))
            else if (ids.has(provider.id)) errors.push(t('providerIdDuplicate', { id: provider.id }))
            ids.add(provider.id)
            if (!provider.baseUrl) errors.push(t('providerBaseUrlRequired', { id: provider.id || index + 1 }))
            if (!provider.embedModel) errors.push(t('providerModelRequired', { id: provider.id || index + 1 }))
            if (!(provider.dimensions > 0)) errors.push(t('providerDimensionsRequired', { id: provider.id || index + 1 }))
          })
          if (stagedProviders.length === 0) errors.push(t('providersEmpty'))
          if (errors.length > 0) throw new Error(errors.join('；'))
          ops.push({ op: 'set', path: ['providers'], value: stagedProviders })
        }
        const savedActive = String(this.state.value.activeProvider ?? '').trim()
        const stagedActive = String(this.state.activeProvider ?? '').trim()
        if (stagedActive !== savedActive) {
          ops.push({ op: 'set', path: ['activeProvider'], value: stagedActive })
        }
        const keyDrafts = Object.entries(this.state.apiKeyDrafts ?? {})
          .map(([ref, text]) => ({ ref, value: String(text ?? '').trim() }))
          .filter((item) => item.value !== '')
        return { ops, keyDrafts }
      }

      async save(t) {
        if (this.state.saving) return
        const snapshot = this.form?.getSnapshot?.()
        if (!snapshot || snapshot.status !== 'ready') {
          this.patch({ saveError: t('unavailable') })
          return
        }
        if (!this.state.writable) {
          this.patch({ saveError: t('readOnly') })
          return
        }
        let collected
        try {
          collected = this.collectOps(t)
        } catch (error) {
          this.patch({ saveError: errorText(error) })
          return
        }
        this.patch({ saving: true, saveError: null, saveOk: false })
        try {
          for (const key of collected.keyDrafts) {
            const response = await this.ctx.remote.credentials.set(key.ref, key.value)
            if (response && response.ok === false) {
              throw new Error(response.error?.message ?? t('saveError'))
            }
          }
          if (collected.ops.length > 0) {
            const ok = await this.form.mutate(collected.ops, snapshot.revision)
            if (!ok) throw new Error(t('saveConflict'))
          }
          const cleared = { ...this.state.apiKeyDrafts }
          for (const key of collected.keyDrafts) cleared[key.ref] = ''
          this.patch({
            saving: false,
            saveOk: true,
            dirty: {},
            providersDirty: false,
            apiKeyDrafts: cleared,
          })
          await this.loadCredentials()
          this.refreshStatus()
          setTimeout(() => {
            if (this.state.saveOk) this.patch({ saveOk: false })
          }, 4000)
        } catch (error) {
          this.patch({ saving: false, saveError: errorText(error) })
        }
      }

      discard() {
        const drafts = {}
        for (const field of SCALAR_FIELDS) drafts[field.key] = draftOf(field, this.state.value[field.key])
        const providers = Array.isArray(this.state.value.providers)
          ? this.state.value.providers.map((provider) => providerDraftFromConfig(provider))
          : []
        this.patch({
          drafts,
          dirty: {},
          providers,
          activeProvider: String(this.state.value.activeProvider ?? '') || providers[0]?.id || '',
          providersDirty: false,
          apiKeyDrafts: {},
          saveError: null,
          saveOk: false,
        })
      }

      // ---------------- 状态与测试 ----------------
      async refreshStatus() {
        this.patch({ status: { phase: 'loading', data: this.state.status.data, error: null } })
        try {
          const response = await fetch(`${API}/status`, { headers: { Accept: 'application/json' } })
          const data = await response.json()
          if (!response.ok || data?.ok === false) {
            this.patch({ status: { phase: 'error', data, error: data?.error ?? `HTTP ${response.status}` } })
            return
          }
          this.patch({ status: { phase: 'ready', data, error: null } })
        } catch (error) {
          this.patch({ status: { phase: 'error', data: null, error: errorText(error) } })
        }
      }

      async testProvider(providerId, target = 'providerTest') {
        const key = String(providerId ?? '')
        const current = this.state.providerTests[key] ?? { phase: 'idle', data: null, error: null }
        if (current.phase === 'running') return
        this.patch({
          providerTests: { ...this.state.providerTests, [key]: { phase: 'running', data: null, error: null } },
        })
        try {
          const response = await fetch(`${API}/test`, {
            method: 'POST',
            headers: POST_HEADER,
            body: JSON.stringify({ providerId: key }),
          })
          const data = await response.json().catch(() => null)
          if (!data) throw new Error(`HTTP ${response.status}`)
          this.patch({
            providerTests: { ...this.state.providerTests, [key]: { phase: 'done', data, error: null } },
          })
          void target
          this.refreshStatus()
        } catch (error) {
          this.patch({
            providerTests: { ...this.state.providerTests, [key]: { phase: 'error', data: null, error: errorText(error) } },
          })
        }
      }

      async testActive() {
        if (this.state.activeTest.phase === 'running') return
        this.patch({ activeTest: { phase: 'running', data: null, error: null } })
        try {
          const response = await fetch(`${API}/test`, {
            method: 'POST',
            headers: POST_HEADER,
            body: '{}',
          })
          const data = await response.json().catch(() => null)
          if (!data) throw new Error(`HTTP ${response.status}`)
          this.patch({ activeTest: { phase: 'done', data, error: null } })
          this.refreshStatus()
        } catch (error) {
          this.patch({ activeTest: { phase: 'error', data: null, error: errorText(error) } })
        }
      }

      // ---------------- 记忆管理 ----------------
      setMemoriesQuery(query) {
        this.patch({ memories: { ...this.state.memories, query: String(query ?? '') } })
      }

      setMemoriesKind(kind) {
        this.patch({ memories: { ...this.state.memories, kind: String(kind ?? '') } })
      }

      setMemoriesRange(range) {
        this.patch({ memories: { ...this.state.memories, range: String(range ?? '') } })
      }

      setMemoriesLevel(level) {
        this.patch({ memories: { ...this.state.memories, level: String(level ?? '') } })
      }

      async refreshConsolidation() {
        try {
          const response = await fetch(`${API}/sleep`, { headers: { Accept: 'application/json' } })
          const data = await response.json()
          if (!response.ok || data?.ok === false) {
            this.patch({ consolidation: { phase: 'error', data: this.state.consolidation.data, error: data?.error ?? `HTTP ${response.status}` } })
            return
          }
          this.patch({ consolidation: { phase: 'ready', data, error: null } })
        } catch (error) {
          this.patch({ consolidation: { phase: 'error', data: this.state.consolidation.data, error: errorText(error) } })
        }
      }

      async runSleepManual() {
        if (this.state.sleepRun.phase === 'running') return
        this.patch({ sleepRun: { phase: 'running', error: null } })
        try {
          const response = await fetch(`${API}/sleep/run`, {
            method: 'POST',
            headers: POST_HEADER,
            body: JSON.stringify({}),
          })
          const data = await response.json().catch(() => null)
          if (!data || (!response.ok && !data.started)) throw new Error(data?.error ?? `HTTP ${response.status}`)
          this.patch({ sleepRun: { phase: 'idle', error: null } })
          await this.refreshConsolidation()
          this.refreshStatus()
        } catch (error) {
          this.patch({ sleepRun: { phase: 'error', error: errorText(error) } })
        }
      }

      setMemoryAdd(field, value) {
        this.patch({ memoryAdd: { ...this.state.memoryAdd, [field]: value } })
      }

      async loadMemories({ reset = false } = {}) {
        const current = this.state.memories
        if (current.phase === 'loading' || current.loadingMore) return
        const offset = reset ? null : current.nextOffset
        if (!reset && offset === null) return
        this.patch({
          memories: {
            ...current,
            phase: reset ? 'loading' : current.phase,
            loadingMore: !reset,
            error: null,
          },
        })
        try {
          const params = new URLSearchParams()
          if (current.query) params.set('q', current.query)
          if (current.kind) params.set('kind', current.kind)
          if (current.range) params.set('range', current.range)
          if (current.level !== undefined && current.level !== '') params.set('level', current.level)
          params.set('limit', '20')
          if (offset) params.set('offset', offset)
          const response = await fetch(`${API}/memories?${params.toString()}`, {
            headers: { Accept: 'application/json' },
          })
          const data = await response.json()
          if (!response.ok || data?.ok === false) throw new Error(data?.error ?? `HTTP ${response.status}`)
          const items = reset ? data.items ?? [] : [...current.items, ...(data.items ?? [])]
          this.patch({
            memories: {
              ...this.state.memories,
              phase: 'ready',
              loadingMore: false,
              items,
              total: data.total ?? null,
              nextOffset: data.nextOffset ?? null,
              error: null,
            },
          })
        } catch (error) {
          this.patch({
            memories: { ...this.state.memories, phase: 'error', loadingMore: false, error: errorText(error) },
          })
        }
      }

      searchMemories() {
        this.loadMemories({ reset: true })
      }

      async deleteMemory(id) {
        try {
          const response = await fetch(`${API}/memories/delete`, {
            method: 'POST',
            headers: POST_HEADER,
            body: JSON.stringify({ ids: [String(id)] }),
          })
          const data = await response.json().catch(() => null)
          if (!response.ok || data?.ok === false) throw new Error(data?.error ?? `HTTP ${response.status}`)
          await this.loadMemories({ reset: true })
          this.refreshStatus()
        } catch (error) {
          this.patch({ memories: { ...this.state.memories, error: errorText(error) } })
        }
      }

      async addMemory() {
        const text = String(this.state.memoryAdd.text ?? '').trim()
        if (!text) return
        try {
          const response = await fetch(`${API}/memories`, {
            method: 'POST',
            headers: POST_HEADER,
            body: JSON.stringify({ text, kind: this.state.memoryAdd.kind || 'note' }),
          })
          const data = await response.json().catch(() => null)
          if (!response.ok || data?.ok === false) throw new Error(data?.error ?? `HTTP ${response.status}`)
          this.patch({ memoryAdd: { text: '', kind: this.state.memoryAdd.kind } })
          await this.loadMemories({ reset: true })
          this.refreshStatus()
        } catch (error) {
          this.patch({ memories: { ...this.state.memories, error: errorText(error) } })
        }
      }

      async exportMemories() {
        this.patch({ exportState: { phase: 'loading', error: null } })
        try {
          const response = await fetch(`${API}/export`, { headers: { Accept: 'application/json' } })
          const data = await response.json()
          if (!response.ok || data?.ok === false) throw new Error(data?.error ?? `HTTP ${response.status}`)
          if (typeof document !== 'undefined') {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url
            anchor.download = `dsh-memory-${Date.now()}.json`
            anchor.click()
            URL.revokeObjectURL(url)
          }
          this.patch({ exportState: { phase: 'done', error: null } })
        } catch (error) {
          this.patch({ exportState: { phase: 'error', error: errorText(error) } })
        }
      }

      async runMaintenance() {
        if (this.state.maintenance.phase === 'running') return
        this.patch({ maintenance: { phase: 'running', result: null, error: null } })
        try {
          const response = await fetch(`${API}/maintenance`, { method: 'POST', headers: POST_HEADER, body: '{}' })
          const data = await response.json().catch(() => null)
          if (!data || (!response.ok && !data.startedAt)) throw new Error(data?.error ?? `HTTP ${response.status}`)
          this.patch({ maintenance: { phase: 'done', result: data, error: data?.error ?? null } })
          await this.loadMemories({ reset: true })
          this.refreshStatus()
        } catch (error) {
          this.patch({ maintenance: { phase: 'error', result: null, error: errorText(error) } })
        }
      }

      async recreateCollection() {
        if (this.state.recreating) return
        this.patch({ recreating: true, recreateError: null })
        try {
          const response = await fetch(`${API}/recreate`, {
            method: 'POST',
            headers: POST_HEADER,
            body: JSON.stringify({ confirm: 'DELETE' }),
          })
          const data = await response.json().catch(() => null)
          if (!response.ok || data?.ok === false) throw new Error(data?.error ?? `HTTP ${response.status}`)
          this.patch({ recreating: false })
          await this.loadMemories({ reset: true })
          this.refreshStatus()
        } catch (error) {
          this.patch({ recreating: false, recreateError: errorText(error) })
        }
      }

      inject() {
        return {
          hooks: { memoryPage: this.store },
          setTab: (tab) => this.setTab(tab),
          editField: (key, value) => this.editField(key, value),
          editProvider: (index, field, value) => this.editProvider(index, field, value),
          addProvider: (presetKey) => this.addProvider(presetKey),
          removeProvider: (index) => this.removeProvider(index),
          setActiveProviderId: (id) => this.setActiveProviderId(id),
          setProviderKeyDraft: (ref, text) => this.setProviderKeyDraft(ref, text),
          saveProviderKey: (ref) => this.saveProviderKey(ref),
          clearProviderKey: (ref) => this.clearProviderKey(ref),
          save: (t) => this.save(t),
          discard: () => this.discard(),
          refreshStatus: () => this.refreshStatus(),
          testActive: () => this.testActive(),
          testProvider: (id) => this.testProvider(id),
          setMemoriesQuery: (query) => this.setMemoriesQuery(query),
          setMemoriesKind: (kind) => this.setMemoriesKind(kind),
          setMemoriesRange: (range) => this.setMemoriesRange(range),
          setMemoriesLevel: (level) => this.setMemoriesLevel(level),
          refreshConsolidation: () => this.refreshConsolidation(),
          runSleepManual: () => this.runSleepManual(),
          setMemoryAdd: (field, value) => this.setMemoryAdd(field, value),
          loadMoreMemories: () => this.loadMemories({ reset: false }),
          refreshMemories: () => this.loadMemories({ reset: true }),
          deleteMemory: (id) => this.deleteMemory(id),
          addMemory: () => this.addMemory(),
          exportMemories: () => this.exportMemories(),
          runMaintenance: () => this.runMaintenance(),
          recreateCollection: () => this.recreateCollection(),
        }
      }

      dispose() {
        if (this.sleepPoll) {
          clearInterval(this.sleepPoll)
          this.sleepPoll = null
        }
        try {
          this.mirrorSub?.()
        } catch {
          /* ignore */
        }
        try {
          this.formUnsub?.()
        } catch {
          /* ignore */
        }
        for (const off of this.unsubs) {
          try {
            off?.()
          } catch {
            /* ignore */
          }
        }
        this.form?.dispose?.()
      }
    }

    // ---------------------------------------------------------------------
    // 样式（只用主题 token）与基础组件
    // ---------------------------------------------------------------------
    const CSS = `
.dsm-page{display:flex;flex-direction:column;gap:18px;max-width:820px;padding:8px 0 48px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.dsm-title{margin:0;font-size:20px;font-weight:500;line-height:28px}
.dsm-desc{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dsm-empty{border:.5px dashed var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);padding:20px;color:var(--dsw-alias-label-secondary);font-size:13px}
.dsm-tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:.5px solid var(--dsw-alias-border-l2);padding-bottom:2px}
.dsm-tab{height:30px;padding:0 12px;border:0;border-radius:var(--dsw-radius-md) var(--dsw-radius-md) 0 0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}
.dsm-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsm-tab[aria-selected="true"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-weight:500}
.dsm-tabBadge{display:inline-block;min-width:16px;height:16px;margin-left:6px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-state-business-primary);color:#fff;font-size:10px;line-height:16px;text-align:center}
.dsm-card{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.dsm-cardHead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dsm-cardTitle{margin:0;font-size:14px;font-weight:500;line-height:22px}
.dsm-statusGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px 18px}
.dsm-statusRow{display:flex;align-items:baseline;gap:8px;min-width:0}
.dsm-statusLabel{color:var(--dsw-alias-label-tertiary);flex:none;min-width:80px}
.dsm-statusValue{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-ok{color:var(--dsw-alias-state-success-primary)}
.dsm-err{color:var(--dsw-alias-state-error-primary)}
.dsm-warn{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary))}
.dsm-muted{color:var(--dsw-alias-label-tertiary)}
.dsm-section{display:flex;flex-direction:column;gap:14px;padding-top:14px;border-top:.5px solid var(--dsw-alias-border-l2)}
.dsm-section:first-child{border-top:0;padding-top:0}
.dsm-sectionTitle{margin:0;font-size:14px;font-weight:500;line-height:22px}
.dsm-sectionHead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dsm-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.dsm-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px 16px}
.dsm-grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px 16px}
.dsm-label{font-size:13px;font-weight:500;line-height:20px}
.dsm-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsm-input,.dsm-select,.dsm-textarea{box-sizing:border-box;width:100%;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);padding:6px 10px;font:inherit;font-size:13px;outline:none}
.dsm-input,.dsm-select{height:36px;padding:0 10px}
.dsm-textarea{min-height:72px;resize:vertical;line-height:20px}
.dsm-input:focus,.dsm-select:focus,.dsm-textarea:focus{border-color:var(--dsw-alias-state-business-primary);box-shadow:inset 0 0 0 .5px var(--dsw-alias-state-business-primary)}
.dsm-input::placeholder,.dsm-textarea::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsm-row{display:flex;align-items:center;justify-content:space-between;gap:18px}
.dsm-rowText{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsm-switch{position:relative;flex:none;width:40px;height:22px;border-radius:999px;border:0;cursor:pointer;background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-border-l4));transition:background .15s;padding:0}
.dsm-switch[aria-checked="true"]{background:var(--dsw-alias-state-business-primary)}
.dsm-switch:disabled{opacity:.5;cursor:default}
.dsm-switch::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .15s}
.dsm-switch[aria-checked="true"]::after{transform:translateX(18px)}
.dsm-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsm-btn{box-sizing:border-box;height:32px;padding:0 14px;border-radius:var(--dsw-radius-md);border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.dsm-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsm-btn:disabled{opacity:.55;cursor:default}
.dsm-btnPrimary{border-color:transparent;background:var(--dsw-alias-state-business-primary);color:#fff}
.dsm-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-state-business-primary);opacity:.9}
.dsm-btnDanger{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-3)}
.dsm-btnSmall{height:26px;padding:0 10px;font-size:12px}
.dsm-btnGhost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary)}
.dsm-btnGhost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsm-badge{display:inline-flex;align-items:center;height:18px;padding:0 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;white-space:nowrap}
.dsm-badgeOk{background:var(--dsw-alias-state-success-tertiary,var(--dsw-alias-bg-layer-3));color:var(--dsw-alias-state-success-primary)}
.dsm-badgeWarn{background:var(--dsw-alias-state-warn-tertiary,var(--dsw-alias-bg-layer-3));color:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary))}
.dsm-badgeActive{background:var(--dsw-alias-state-business-primary);color:#fff}
.dsm-result{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);padding:8px 10px;font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary)}
.dsm-provider{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);padding:12px 14px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-layer-2)}
.dsm-provider[data-active="true"]{border-color:var(--dsw-alias-state-business-primary);box-shadow:inset 0 0 0 .5px var(--dsw-alias-state-business-primary)}
.dsm-providerHead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dsm-providerName{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;min-width:0}
.dsm-keyRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsm-keyRow .dsm-input{flex:1;min-width:180px}
.dsm-memList{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.dsm-memItem{border-bottom:.5px solid var(--dsw-alias-border-l2);padding:10px 2px;display:flex;gap:12px;align-items:flex-start}
.dsm-memMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.dsm-memMeta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:16px}
.dsm-memText{font-size:13px;line-height:20px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary)}
.dsm-memTools{flex:none;display:flex;align-items:center;gap:6px}
.dsm-saveBar{position:sticky;bottom:0;z-index:2;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 0;background:linear-gradient(to top,var(--dsw-alias-bg-layer-1) 70%,transparent)}
.dsm-success{color:var(--dsw-alias-state-success-primary)}
.dsm-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsm-toolbar .dsm-input{flex:1;min-width:160px}
.dsm-toolbar .dsm-select{flex:none;width:auto;min-width:96px}
.dsm-danger{border-top:.5px solid var(--dsw-alias-border-l2);padding-top:14px;display:flex;flex-direction:column;gap:10px}
.dsm-dangerTitle{margin:0;font-size:13px;font-weight:500;color:var(--dsw-alias-state-error-primary)}
`

    function StyleTag() {
      return h('style', null, CSS)
    }

    function Field({ label, hint, children }) {
      return h(
        'div',
        { className: 'dsm-field' },
        label ? h('span', { className: 'dsm-label' }, label) : null,
        hint ? h('span', { className: 'dsm-hint' }, hint) : null,
        children,
      )
    }

    function TextField({ id, value, placeholder, disabled, onChange, type }) {
      return h('input', {
        id,
        className: 'dsm-input',
        type: type ?? 'text',
        value: value ?? '',
        placeholder: placeholder ?? '',
        disabled,
        spellCheck: false,
        autoComplete: 'off',
        onChange: (event) => onChange(event.target.value),
      })
    }

    function NumberField({ id, value, disabled, onChange }) {
      return h('input', {
        id,
        className: 'dsm-input',
        type: 'number',
        value: value ?? '',
        disabled,
        onChange: (event) => onChange(event.target.value),
      })
    }

    function TextArea({ id, value, placeholder, disabled, onChange }) {
      return h('textarea', {
        id,
        className: 'dsm-textarea',
        value: value ?? '',
        placeholder: placeholder ?? '',
        disabled,
        onChange: (event) => onChange(event.target.value),
      })
    }

    function SelectField({ id, value, options, disabled, onChange }) {
      return h(
        'select',
        { id, className: 'dsm-select', value: value ?? '', disabled, onChange: (event) => onChange(event.target.value) },
        options.map((option) => h('option', { key: String(option.value), value: String(option.value) }, option.label)),
      )
    }

    function SwitchField({ id, checked, disabled, onChange }) {
      return h('button', {
        id,
        type: 'button',
        role: 'switch',
        'aria-checked': checked === true,
        className: 'dsm-switch',
        disabled,
        onClick: () => onChange(!checked),
      })
    }

    function Badge({ tone, children }) {
      const className =
        tone === 'ok'
          ? 'dsm-badge dsm-badgeOk'
          : tone === 'warn'
            ? 'dsm-badge dsm-badgeWarn'
            : tone === 'active'
              ? 'dsm-badge dsm-badgeActive'
              : 'dsm-badge'
      return h('span', { className }, children)
    }

    function SwitchRow({ id, label, hint, checked, disabled, onChange }) {
      return h(
        'div',
        { className: 'dsm-row' },
        h(
          'div',
          { className: 'dsm-rowText' },
          h('span', { className: 'dsm-label' }, label),
          hint ? h('span', { className: 'dsm-hint' }, hint) : null,
        ),
        h(SwitchField, { id, checked, disabled, onChange }),
      )
    }

    /** 普通标量配置字段（按类型渲染）。 */
    function ScalarField({ field, state, actions, t, disabled }) {
      const key = field.key
      const draft = state.drafts[key]
      const label = t('field.' + key)
      const hint = t('field.' + key + 'Hint')
      if (field.type === 'switch') {
        return h(SwitchRow, {
          id: 'dsm-' + key,
          label,
          hint,
          checked: draft === true,
          disabled,
          onChange: (next) => actions.editField(key, next),
        })
      }
      if (field.type === 'select') {
        const options =
          field.optionDefs ??
          field.options.map((option) => ({
            value: option,
            label: t('option.' + key + '.' + option),
          }))
        return h(
          Field,
          { label, hint },
          h(SelectField, {
            id: 'dsm-' + key,
            value: draft,
            options,
            disabled,
            onChange: (next) => actions.editField(key, next),
          }),
        )
      }
      if (field.type === 'textarea') {
        return h(
          Field,
          { label, hint },
          h(TextArea, {
            id: 'dsm-' + key,
            value: draft,
            disabled,
            placeholder: t('field.' + key + 'Placeholder'),
            onChange: (next) => actions.editField(key, next),
          }),
        )
      }
      if (field.type === 'number') {
        return h(
          Field,
          { label, hint },
          h(NumberField, {
            id: 'dsm-' + key,
            value: draft,
            disabled,
            onChange: (next) => actions.editField(key, next),
          }),
        )
      }
      return h(
        Field,
        { label, hint },
        h(TextField, {
          id: 'dsm-' + key,
          value: draft,
          disabled,
          onChange: (next) => actions.editField(key, next),
        }),
      )
    }

    /** 凭据编辑行：状态徽标 + 输入框 + 保存/清除。 */
    function KeyEditor({ refName, label, state, actions, t, disabled }) {
      const credential = state.credentials?.[refName] ?? { configured: false, writable: true }
      const draft = state.apiKeyDrafts?.[refName] ?? ''
      return h(
        'div',
        { className: 'dsm-field' },
        h('span', { className: 'dsm-label' }, label ? t('keyLabelFor', { label }) : t('keyLabel')),
        h(
          'div',
          { className: 'dsm-keyRow' },
          h(TextField, {
            id: 'dsm-key-' + refName,
            value: draft,
            type: 'password',
            placeholder: credential.configured ? t('keyPlaceholderKeep') : t('keyPlaceholder'),
            disabled,
            onChange: (value) => actions.setProviderKeyDraft(refName, value),
          }),
          h(
            'button',
            {
              type: 'button',
              className: 'dsm-btn dsm-btnSmall',
              disabled: disabled || draft.trim() === '' || credential.writable === false,
              onClick: () => actions.saveProviderKey(refName),
            },
            t('keySave'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsm-btn dsm-btnSmall dsm-btnGhost',
              disabled: disabled || credential.configured !== true || credential.writable === false,
              onClick: () => actions.clearProviderKey(refName),
            },
            t('keyClear'),
          ),
          credential.configured ? h(Badge, { tone: 'ok' }, t('keyConfigured')) : h(Badge, { tone: 'warn' }, t('keyUnconfigured')),
        ),
        h('span', { className: 'dsm-hint' }, t('keyRefHint', { ref: refName })),
      )
    }

    /** 连接测试结果。 */
    function TestResultView({ test, t }) {
      if (!test || test.phase === 'idle') return null
      if (test.phase === 'running') return h('div', { className: 'dsm-result' }, t('testRunning'))
      if (test.phase === 'error') return h('div', { className: 'dsm-result dsm-err' }, t('testFailed') + '：' + test.error)
      const data = test.data ?? {}
      const rows = []
      const row = (label, result) => {
        if (!result) return null
        const ok = result.ok !== false
        const detail = ok
          ? [
              result.latencyMs ? t('testLatency', { ms: result.latencyMs }) : '',
              result.dimensions ? t('testDimensions', { n: result.dimensions }) : '',
              result.version ? t('testVersion', { v: result.version }) : '',
              result.points !== undefined ? t('testPoints', { n: result.points }) : '',
              result.text ? t('testText', { text: result.text }) : '',
            ]
              .filter(Boolean)
              .join(' · ')
          : result.error ?? ''
        return h(
          'div',
          { className: 'dsm-statusRow', key: label },
          h('span', { className: 'dsm-statusLabel' }, label),
          h('span', { className: 'dsm-statusValue ' + (ok ? 'dsm-ok' : 'dsm-err'), title: detail }, (ok ? t('testOk') : t('testFailed')) + ' · ' + detail),
        )
      }
      if (data.provider) {
        rows.push(
          h(
            'div',
            { className: 'dsm-statusRow', key: 'provider' },
            h('span', { className: 'dsm-statusLabel' }, t('testProviderLabel')),
            h('span', { className: 'dsm-statusValue' }, `${data.provider.name} · ${data.provider.embeddingModel} · ${data.provider.dimensions}d`),
          ),
        )
      }
      rows.push(row(t('testEmbedding'), data.embedding))
      rows.push(row(t('testQdrant'), data.qdrant))
      rows.push(row(t('testCaption'), data.caption))
      return h('div', { className: 'dsm-statusGrid' }, rows)
    }

    /** 概览状态卡片。 */
    function StatusCard({ state, actions, t }) {
      const data = state.status.data
      const rows = []
      if (!data) {
        const phase = state.status.phase
        rows.push(
          h(
            'div',
            { className: 'dsm-statusRow', key: 'loading' },
            h('span', { className: 'dsm-statusLabel' }, t('statusTitle')),
            h('span', { className: 'dsm-statusValue ' + (phase === 'error' ? 'dsm-err' : 'dsm-muted') }, phase === 'error' ? state.status.error : t('statusChecking')),
          ),
        )
      } else {
        const provider = data.provider ?? {}
        const credential = data.credential ?? {}
        const collection = data.collection ?? {}
        const qdrant = data.qdrant ?? {}
        const behavior = data.behavior ?? {}
        const stats = data.stats ?? {}
        const maintenance = stats.lastMaintenance
        rows.push(
          h(
            'div',
            { className: 'dsm-statusRow', key: 'provider' },
            h('span', { className: 'dsm-statusLabel' }, t('statusProvider')),
            h(
              'span',
              { className: 'dsm-statusValue', title: provider.baseUrl ?? '' },
              `${provider.name ?? '-'} · ${provider.embedModel ?? '-'} · ${provider.dimensions ?? '?'}d`,
            ),
          ),
          h(
            'div',
            { className: 'dsm-statusRow', key: 'key' },
            h('span', { className: 'dsm-statusLabel' }, t('statusApiKey')),
            h('span', { className: 'dsm-statusValue ' + (credential.configured ? 'dsm-ok' : 'dsm-warn') }, credential.configured ? t('statusConfigured') : t('statusUnconfigured')),
          ),
          h(
            'div',
            { className: 'dsm-statusRow', key: 'qdrant' },
            h('span', { className: 'dsm-statusLabel' }, t('statusQdrant')),
            h(
              'span',
              { className: 'dsm-statusValue ' + (qdrant.ok ? 'dsm-ok' : 'dsm-err'), title: qdrant.error ?? '' },
              qdrant.ok ? `${t('statusConnected')}${qdrant.version ? ' v' + qdrant.version : ''}` : `${t('statusDisconnected')}：${qdrant.error ?? ''}`,
            ),
          ),
          h(
            'div',
            { className: 'dsm-statusRow', key: 'collection' },
            h('span', { className: 'dsm-statusLabel' }, t('statusCollection')),
            h(
              'span',
              {
                className:
                  'dsm-statusValue ' +
                  (collection.exists === true && collection.size === provider.dimensions ? 'dsm-ok' : 'dsm-warn'),
              },
              collection.exists === true
                ? `${collection.name} · ${t('statusPoints', { count: collection.points ?? 0 })}${collection.size ? ' · ' + collection.size + 'd' : ''}`
                : t('statusNotCreated'),
            ),
          ),
          h(
            'div',
            { className: 'dsm-statusRow', key: 'scope' },
            h('span', { className: 'dsm-statusLabel' }, t('statusScope')),
            h('span', { className: 'dsm-statusValue' }, t('option.memoryScope.' + (behavior.memoryScope ?? 'global'))),
          ),
          h(
            'div',
            { className: 'dsm-statusRow', key: 'timezone' },
            h('span', { className: 'dsm-statusLabel' }, t('statusTimezone')),
            h(
              'span',
              { className: 'dsm-statusValue' },
              `${data.time?.timezoneLabel ?? '服务器本地'}${data.time?.now ? ' · ' + data.time.now : ''}`,
            ),
          ),
          h(
            'div',
            { className: 'dsm-statusRow', key: 'sleep' },
            h('span', { className: 'dsm-statusLabel' }, t('statusSleep')),
            h(
              'span',
              { className: 'dsm-statusValue ' + (data.sleep?.enabled ? (data.sleep?.sleeping ? 'dsm-warn' : 'dsm-ok') : 'dsm-muted') },
              data.sleep
                ? `${data.sleep.enabled ? (data.sleep.sleeping ? t('sleepStateSleeping') : t('sleepStateWaiting')) : t('sleepStateOff')}${data.consolidation?.pendingTotal ? ' · ' + t('sleepPendingBatches') + ' ' + data.consolidation.pendingTotal : ''}`
                : t('statusNoData'),
            ),
          ),
          h(
            'div',
            { className: 'dsm-statusRow', key: 'levels' },
            h('span', { className: 'dsm-statusLabel' }, t('statusLevels')),
            h(
              'span',
              { className: 'dsm-statusValue' },
              data.levels
                ? `L0 ${data.levels[0] ?? 0} · L1 ${data.levels[1] ?? 0} · L2 ${data.levels[2] ?? 0} · L3 ${data.levels[3] ?? 0}`
                : t('statusNoData'),
            ),
          ),
          h(
            'div',
            { className: 'dsm-statusRow', key: 'tools' },
            h('span', { className: 'dsm-statusLabel' }, t('statusTools')),
            h('span', { className: 'dsm-statusValue ' + (behavior.toolsEnabled ? 'dsm-ok' : 'dsm-muted') }, behavior.toolsEnabled ? t('statusToolsOn') : t('statusToolsOff')),
          ),
          h(
            'div',
            { className: 'dsm-statusRow', key: 'write' },
            h('span', { className: 'dsm-statusLabel' }, t('statusLastWrite')),
            h('span', { className: 'dsm-statusValue' }, stats.lastWriteTime || t('statusNoData')),
          ),
          h(
            'div',
            { className: 'dsm-statusRow', key: 'recall' },
            h('span', { className: 'dsm-statusLabel' }, t('statusLastRecall')),
            h('span', { className: 'dsm-statusValue' }, stats.lastRecallTime ? `${stats.lastRecallTime} · ${stats.lastRecallCount} 条` : t('statusNoData')),
          ),
          h(
            'div',
            { className: 'dsm-statusRow', key: 'maintenance' },
            h('span', { className: 'dsm-statusLabel' }, t('statusMaintenance')),
            h(
              'span',
              { className: 'dsm-statusValue' },
              maintenance
                ? t('statusMaintenanceSummary', {
                    expired: maintenance.expired ?? 0,
                    overflow: maintenance.overflow ?? 0,
                    duplicates: maintenance.duplicates ?? 0,
                  })
                : stats.lastMaintenanceTime || t('statusNoData'),
            ),
          ),
          h(
            'div',
            { className: 'dsm-statusRow', key: 'queue' },
            h('span', { className: 'dsm-statusLabel' }, t('statusQueue')),
            h(
              'span',
              { className: 'dsm-statusValue ' + ((data.queue?.lastError ?? '') !== '' ? 'dsm-err' : ''), title: data.queue?.lastError ?? '' },
              t('statusPending', {
                pending: data.queue?.pending ?? 0,
                done: data.queue?.done ?? 0,
                failed: data.queue?.failed ?? 0,
              }),
            ),
          ),
        )
        if (collection.exists === true && collection.size != null && provider.dimensions != null && collection.size !== provider.dimensions) {
          rows.push(
            h(
              'div',
              { className: 'dsm-statusRow', key: 'mismatch' },
              h('span', { className: 'dsm-statusLabel' }, ''),
              h('span', { className: 'dsm-statusValue dsm-err' }, t('statusDimsMismatch', { size: collection.size, dims: provider.dimensions })),
            ),
          )
        }
      }
      return h(
        'section',
        { className: 'dsm-card' },
        h(
          'div',
          { className: 'dsm-cardHead' },
          h('h3', { className: 'dsm-cardTitle' }, t('statusTitle')),
          h(
            'div',
            { className: 'dsm-actions' },
            h('button', { type: 'button', className: 'dsm-btn', onClick: actions.refreshStatus }, t('refresh')),
          ),
        ),
        h('div', { className: 'dsm-statusGrid' }, rows),
      )
    }

    /** 单个 provider 卡片。 */
    function ProviderCard({ provider, index, state, actions, t, disabled }) {
      const isActive = String(provider.id ?? '') === String(state.activeProvider ?? '')
      const keyRef = providerKeyRef(provider)
      const visionRef = providerVisionKeyRef(provider)
      const test = state.providerTests[provider.id] ?? { phase: 'idle', data: null, error: null }
      const edit = (field) => (value) => actions.editProvider(index, field, value)
      return h(
        'div',
        { className: 'dsm-provider', 'data-active': isActive },
        h(
          'div',
          { className: 'dsm-providerHead' },
          h(
            'div',
            { className: 'dsm-providerName' },
            h('span', null, String(provider.name ?? '').trim() || String(provider.id ?? '') || t('providerNew')),
            isActive ? h(Badge, { tone: 'active' }, t('providerActive')) : null,
            providerKeyRef(provider) && state.credentials?.[keyRef]?.configured === true
              ? h(Badge, { tone: 'ok' }, t('keyConfigured'))
              : h(Badge, { tone: 'warn' }, t('keyUnconfigured')),
          ),
          h(
            'div',
            { className: 'dsm-actions' },
            isActive
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsm-btn dsm-btnSmall',
                    disabled,
                    onClick: () => actions.setActiveProviderId(provider.id),
                  },
                  t('providerActivate'),
                ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsm-btn dsm-btnSmall',
                disabled: disabled || test.phase === 'running',
                onClick: () => actions.testProvider(provider.id),
              },
              test.phase === 'running' ? t('testRunning') : t('providerTest'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsm-btn dsm-btnSmall dsm-btnDanger',
                disabled,
                onClick: () => {
                  if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(t('providerRemoveConfirm'))) return
                  actions.removeProvider(index)
                },
              },
              t('providerRemove'),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dsm-grid2' },
          h(Field, { label: t('providerName') }, h(TextField, { id: `dsm-provider-${index}-name`, value: provider.name, disabled, onChange: edit('name') })),
          h(Field, { label: t('providerId'), hint: t('providerIdHint') }, h(TextField, { id: `dsm-provider-${index}-id`, value: provider.id, disabled, onChange: edit('id') })),
          h(Field, { label: t('providerBaseUrl'), hint: t('providerBaseUrlHint') }, h(TextField, { id: `dsm-provider-${index}-baseUrl`, value: provider.baseUrl, disabled, onChange: edit('baseUrl') })),
          h(Field, { label: t('providerEmbedModel'), hint: t('providerEmbedModelHint') }, h(TextField, { id: `dsm-provider-${index}-embedModel`, value: provider.embedModel, disabled, onChange: edit('embedModel') })),
          h(Field, { label: t('providerDimensions'), hint: t('providerDimensionsHint') }, h(NumberField, { id: `dsm-provider-${index}-dimensions`, value: provider.dimensions, disabled, onChange: edit('dimensions') })),
          h(Field, { label: t('providerApiKeyEnv'), hint: t('providerApiKeyEnvHint') }, h(TextField, { id: `dsm-provider-${index}-apiKeyEnv`, value: provider.apiKeyEnv, disabled, onChange: edit('apiKeyEnv') })),
          h(Field, { label: t('providerVisionModel'), hint: t('providerVisionModelHint') }, h(TextField, { id: `dsm-provider-${index}-visionModel`, value: provider.visionModel, disabled, onChange: edit('visionModel') })),
          h(Field, { label: t('providerVisionBaseUrl'), hint: t('providerVisionBaseUrlHint') }, h(TextField, { id: `dsm-provider-${index}-visionBaseUrl`, value: provider.visionBaseUrl, disabled, onChange: edit('visionBaseUrl') })),
          h(Field, { label: t('providerVisionKeyEnv'), hint: t('providerVisionKeyEnvHint') }, h(TextField, { id: `dsm-provider-${index}-visionKeyEnv`, value: provider.visionApiKeyEnv, disabled, onChange: edit('visionApiKeyEnv') })),
        ),
        h(SwitchRow, {
          id: `dsm-provider-${index}-sendDimensions`,
          label: t('providerSendDimensions'),
          hint: t('providerSendDimensionsHint'),
          checked: provider.sendDimensions !== false,
          disabled,
          onChange: (value) => actions.editProvider(index, 'sendDimensions', value),
        }),
        h(KeyEditor, { refName: keyRef, label: t('providerKey'), state, actions, t, disabled }),
        visionRef !== keyRef ? h(KeyEditor, { refName: visionRef, label: t('providerVisionKey'), state, actions, t, disabled }) : null,
        test.phase !== 'idle' ? h(TestResultView, { test, t }) : null,
      )
    }

    /** 模型与向量库 Tab。 */
    function ModelTab({ state, actions, t, disabled }) {
      const [preset, setPreset] = React.useState(PROVIDER_PRESETS[0].key)
      const providers = state.providers ?? []
      return h(
        React.Fragment,
        null,
        h(
          'section',
          { className: 'dsm-card' },
          h(
            'div',
            { className: 'dsm-cardHead' },
            h('h3', { className: 'dsm-cardTitle' }, t('sectionProviders')),
            h(
              'div',
              { className: 'dsm-actions' },
              h(SelectField, {
                id: 'dsm-provider-preset',
                value: preset,
                options: PROVIDER_PRESETS.map((item) => ({ value: item.key, label: item.name })),
                disabled,
                onChange: setPreset,
              }),
              h('button', { type: 'button', className: 'dsm-btn', disabled, onClick: () => actions.addProvider(preset) }, t('providerAdd')),
            ),
          ),
          h('p', { className: 'dsm-hint' }, t('sectionProvidersHint')),
          providers.length === 0
            ? h('div', { className: 'dsm-empty' }, t('providersEmptyHint'))
            : providers.map((provider, index) =>
                h(ProviderCard, {
                  key: String(provider.id ?? index) + '-' + index,
                  provider,
                  index,
                  state,
                  actions,
                  t,
                  disabled,
                }),
              ),
        ),
        h(
          'section',
          { className: 'dsm-card' },
          h('h3', { className: 'dsm-cardTitle' }, t('sectionStorage')),
          h('p', { className: 'dsm-hint' }, t('sectionStorageHint')),
          h(
            'div',
            { className: 'dsm-grid2' },
            h(ScalarField, { field: SCALAR_BY_KEY.get('qdrantUrl'), state, actions, t, disabled }),
            h(ScalarField, { field: SCALAR_BY_KEY.get('collection'), state, actions, t, disabled }),
            h(ScalarField, { field: SCALAR_BY_KEY.get('qdrantApiKeyEnv'), state, actions, t, disabled }),
          ),
          String(state.drafts.qdrantApiKeyEnv ?? '').trim()
            ? h(KeyEditor, {
                refName: String(state.drafts.qdrantApiKeyEnv ?? '').trim(),
                label: t('qdrantKey'),
                state,
                actions,
                t,
                disabled,
              })
            : null,
        ),
        h(
          'section',
          { className: 'dsm-card' },
          h(
            'div',
            { className: 'dsm-cardHead' },
            h('h3', { className: 'dsm-cardTitle' }, t('sectionTest')),
            h(
              'button',
              {
                type: 'button',
                className: 'dsm-btn',
                disabled: disabled || state.activeTest.phase === 'running',
                onClick: actions.testActive,
              },
              state.activeTest.phase === 'running' ? t('testRunning') : t('testActive'),
            ),
          ),
          h('p', { className: 'dsm-hint' }, t('sectionTestHint')),
          h(TestResultView, { test: state.activeTest, t }),
        ),
      )
    }

    /** 记忆行为 Tab。 */
    /** 睡眠整理设置卡（v0.4）。 */
    function SleepCard({ state, actions, t, disabled }) {
      const data = state.consolidation?.data ?? null
      const sleep = data?.sleep ?? state.status?.data?.sleep ?? null
      const consolidation = data?.consolidation ?? state.status?.data?.consolidation ?? null
      const providers = state.providers ?? []
      const providerOptions = [
        { value: '', label: t('sleepProviderAuto') },
        ...providers.map((provider) => ({ value: provider.id, label: provider.name || provider.id })),
      ]
      const running = state.sleepRun?.phase === 'running'
      const levelsText = (levels) =>
        Object.entries(levels ?? {})
          .map(([level, stat]) => `L${level}:${stat.batches ?? 0} 批/${stat.input ?? 0}→${stat.output ?? 0}`)
          .join(' · ')
      const lastRun = sleep?.lastResult
      const statusRows = [
        h(
          'div',
          { className: 'dsm-statusRow', key: 'state' },
          h('span', { className: 'dsm-statusLabel' }, t('sleepStatus')),
          h(
            'span',
            { className: 'dsm-statusValue ' + (sleep?.sleeping ? 'dsm-warn' : sleep?.enabled ? 'dsm-ok' : 'dsm-muted') },
            sleep ? (sleep.sleeping ? t('sleepStateSleeping') : sleep.enabled ? t('sleepStateWaiting') : t('sleepStateOff')) : t('statusNoData'),
          ),
        ),
        h(
          'div',
          { className: 'dsm-statusRow', key: 'pending' },
          h('span', { className: 'dsm-statusLabel' }, t('sleepPendingBatches')),
          h('span', { className: 'dsm-statusValue' }, `${consolidation?.pendingTotal ?? 0}${consolidation?.nextDueTime ? ' · ' + t('sleepNextDue', { time: consolidation.nextDueTime }) : ''}`),
        ),
        lastRun
          ? h(
              'div',
              { className: 'dsm-statusRow', key: 'last' },
              h('span', { className: 'dsm-statusLabel' }, t('sleepLastRun')),
              h('span', { className: 'dsm-statusValue' }, `${sleep?.sleepingSinceTime ? '' : ''}${levelsText(lastRun.levels) || t('sleepNoLastRun')}${lastRun.errors?.length ? ' · ' + lastRun.errors[0] : ''}`),
            )
          : null,
        sleep?.lastSkipReason ? h('div', { className: 'dsm-statusRow', key: 'skip' }, h('span', { className: 'dsm-statusLabel' }, t('sleepLastSkipReason')), h('span', { className: 'dsm-statusValue dsm-muted' }, sleep.lastSkipReason)) : null,
        sleep?.lastError ? h('div', { className: 'dsm-statusRow', key: 'error' }, h('span', { className: 'dsm-statusLabel' }, t('sleepLastError')), h('span', { className: 'dsm-statusValue dsm-err' }, sleep.lastError)) : null,
      ]
      return h(
        'section',
        { className: 'dsm-card' },
        h(
          'div',
          { className: 'dsm-cardHead' },
          h('h3', { className: 'dsm-cardTitle' }, t('sectionSleep')),
          h(
            'div',
            { className: 'dsm-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsm-btn dsm-btnSmall',
                disabled: disabled || running || sleep?.sleeping,
                onClick: () => {
                  if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(t('sleepRunConfirm'))) return
                  actions.runSleepManual()
                },
              },
              running ? t('sleepRunning') : t('sleepRunNow'),
            ),
          ),
        ),
        h('p', { className: 'dsm-hint' }, t('sectionSleepHint')),
        h(
          'div',
          { className: 'dsm-grid2' },
          h(ScalarField, { field: SCALAR_BY_KEY.get('consolidationEnabled'), state, actions, t, disabled }),
          h(ScalarField, { field: SCALAR_BY_KEY.get('sleepAt'), state, actions, t, disabled }),
          h(ScalarField, { field: SCALAR_BY_KEY.get('sleepRetryMinutes'), state, actions, t, disabled }),
          h(ScalarField, { field: SCALAR_BY_KEY.get('idleMinutes'), state, actions, t, disabled }),
          h(
            Field,
            { label: t('field.consolidationProviderId'), hint: t('field.consolidationProviderIdHint') },
            h(SelectField, {
              id: 'dsm-consolidation-provider',
              value: state.drafts.consolidationProviderId ?? '',
              options: providerOptions,
              disabled,
              onChange: (value) => actions.editField('consolidationProviderId', value),
            }),
          ),
          h(ScalarField, { field: SCALAR_BY_KEY.get('consolidationModel'), state, actions, t, disabled }),
        ),
        h('div', { className: 'dsm-statusList' }, statusRows),
      )
    }

    /** 实验功能卡。 */
    function ExperimentalCard({ state, actions, t, disabled }) {
      const keys = [
        'experimentalEventMergeEnabled',
        'experimentalEventMergeThreshold',
        'experimentalEventMergeMaxCandidates',
        'experimentalEnhancementEnabled',
        'experimentalEnhancementDays',
      ]
      return h(
        'section',
        { className: 'dsm-card' },
        h('h3', { className: 'dsm-cardTitle' }, t('sectionExperimental')),
        h('p', { className: 'dsm-hint' }, t('sectionExperimentalHint')),
        h(
          'div',
          { className: 'dsm-grid2' },
          keys.map((key) => h(ScalarField, { key, field: SCALAR_BY_KEY.get(key), state, actions, t, disabled })),
        ),
      )
    }

    /** 整理级别参数卡（高级）。 */
    function LevelsCard({ state, actions, t, disabled }) {
      const keys = [
        'level1Ratio',
        'level1MaxItems',
        'level2AfterDays',
        'level2Ratio',
        'level2MaxItems',
        'level3AfterDays',
        'level3Ratio',
        'level3MaxItems',
        'consolidationInputMaxChars',
      ]
      return h(
        'section',
        { className: 'dsm-card' },
        h('h3', { className: 'dsm-cardTitle' }, t('sectionLevels')),
        h('p', { className: 'dsm-hint' }, t('sectionLevelsHint')),
        h(
          'div',
          { className: 'dsm-grid2' },
          keys.map((key) => h(ScalarField, { key, field: SCALAR_BY_KEY.get(key), state, actions, t, disabled })),
        ),
      )
    }

    function BehaviorTab({ state, actions, t, disabled }) {
      const behaviorKeys = ['memoryScope', 'autoCapture', 'autoRecall', 'recallIncludeCurrentSession', 'recallTopK', 'recallMinScore', 'recallMaxChars', 'recallTimeoutMs']
      const imageKeys = ['imageMode', 'captionPrompt', 'captionMaxTokens']
      const toolKeys = ['toolsEnabled', 'toolSearchLimit']
      return h(
        React.Fragment,
        null,
        h(
          'section',
          { className: 'dsm-card' },
          h('h3', { className: 'dsm-cardTitle' }, t('sectionBehavior')),
          h('p', { className: 'dsm-hint' }, t('sectionBehaviorHint')),
          h(
            'div',
            { className: 'dsm-grid2' },
            behaviorKeys.map((key) => h(ScalarField, { key, field: SCALAR_BY_KEY.get(key), state, actions, t, disabled })),
          ),
        ),
        h(
          'section',
          { className: 'dsm-card' },
          h('h3', { className: 'dsm-cardTitle' }, t('sectionImage')),
          h('p', { className: 'dsm-hint' }, t('sectionImageHint')),
          h(
            'div',
            { className: 'dsm-grid2' },
            imageKeys.map((key) => h(ScalarField, { key, field: SCALAR_BY_KEY.get(key), state, actions, t, disabled })),
          ),
        ),
        h(
          'section',
          { className: 'dsm-card' },
          h('h3', { className: 'dsm-cardTitle' }, t('sectionTools')),
          h('p', { className: 'dsm-hint' }, t('sectionToolsHint')),
          h(
            'div',
            { className: 'dsm-grid2' },
            toolKeys.map((key) => h(ScalarField, { key, field: SCALAR_BY_KEY.get(key), state, actions, t, disabled })),
          ),
        ),
        h(SleepCard, { state, actions, t, disabled }),
        h(ExperimentalCard, { state, actions, t, disabled }),
        h(
          'section',
          { className: 'dsm-card' },
          h('h3', { className: 'dsm-cardTitle' }, t('sectionTime')),
          h(
            'p',
            { className: 'dsm-hint' },
            t('sectionTimeHint', {
              tz: state.status?.data?.time?.timezoneLabel ?? '服务器本地',
              now: state.status?.data?.time?.now ?? '',
            }),
          ),
          h(
            'div',
            { className: 'dsm-grid2' },
            h(ScalarField, { field: SCALAR_BY_KEY.get('timezone'), state, actions, t, disabled }),
            state.drafts.timezone === 'custom'
              ? h(ScalarField, { field: SCALAR_BY_KEY.get('timezoneCustom'), state, actions, t, disabled })
              : null,
            h(ScalarField, { field: SCALAR_BY_KEY.get('injectCurrentTime'), state, actions, t, disabled }),
            h(ScalarField, { field: SCALAR_BY_KEY.get('relativeTime'), state, actions, t, disabled }),
          ),
        ),
      )
    }

    /** 记忆管理 Tab。 */
    function ManageTab({ state, actions, t, disabled }) {
      const memories = state.memories
      const maintenance = state.maintenance
      const kindOptions = [
        { value: '', label: t('kindAll') },
        { value: 'turn', label: t('kindTurn') },
        { value: 'fact', label: t('kindFact') },
        { value: 'image', label: t('kindImage') },
        { value: 'note', label: t('kindNote') },
        { value: 'preference', label: t('kindPreference') },
        { value: 'project', label: t('kindProject') },
      ]
      const addKindOptions = kindOptions.filter((option) => option.value !== '')
      const levelOptions = [
        { value: '', label: t('levelAll') },
        { value: '0', label: t('levelRaw') },
        { value: '1', label: t('level1') },
        { value: '2', label: t('level2') },
        { value: '3', label: t('level3') },
      ]
      const consolidationData = state.consolidation?.data ?? null
      const sleepStatus = consolidationData?.sleep ?? state.status?.data?.sleep ?? null
      const engineSummary = consolidationData?.consolidation ?? state.status?.data?.consolidation ?? null
      const sleepRunning = state.sleepRun?.phase === 'running'
      const levelsText = (levels) =>
        Object.entries(levels ?? {})
          .map(([level, stat]) => `L${level}:${stat.batches ?? 0} 批/${stat.input ?? 0}→${stat.output ?? 0}`)
          .join(' · ')
      const historyRows = (engineSummary?.history ?? []).slice().reverse().map((entry, index) =>
        h(
          'div',
          { className: 'dsm-statusRow', key: 'sleep-history-' + index },
          h('span', { className: 'dsm-statusLabel' }, entry.time || ''),
          h('span', { className: 'dsm-statusValue' }, levelsText(entry.levels) || t('sleepNoLastRun')),
        ),
      )
      const sleepStatusText = sleepStatus
        ? sleepStatus.sleeping
          ? t('sleepStateSleeping')
          : sleepStatus.enabled
            ? t('sleepStateWaiting')
            : t('sleepStateOff')
        : t('statusNoData')
      const rows = (memories.items ?? []).map((item) =>
        h(
          'li',
          { className: 'dsm-memItem', key: item.id },
          h(
            'div',
            { className: 'dsm-memMain' },
            h(
              'div',
              { className: 'dsm-memMeta' },
              h(Badge, null, t('kind.' + (item.kind || 'note'))),
              h(Badge, null, 'L' + (item.level ?? 0)),
              item.batch ? h('span', { title: t('memoryBatch') }, '#' + item.batch) : null,
              item.enhanced ? h('span', { className: 'dsm-warn' }, t('memoryEnhanced')) : null,
              h('span', null, item.time),
              item.relative ? h('span', null, `(${item.relative})`) : null,
              item.score !== undefined ? h('span', null, t('memoryScore', { score: item.score.toFixed(3) })) : null,
              item.cwd ? h('span', { title: item.cwd }, item.cwd) : null,
            ),
            h('div', { className: 'dsm-memText' }, item.text),
          ),
          h(
            'div',
            { className: 'dsm-memTools' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsm-btn dsm-btnSmall dsm-btnGhost',
                disabled: disabled,
                onClick: () => {
                  if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(t('memoryDeleteConfirm'))) return
                  actions.deleteMemory(item.id)
                },
              },
              t('memoryDelete'),
            ),
          ),
        ),
      )
      return h(
        React.Fragment,
        null,
        h(
          'section',
          { className: 'dsm-card' },
          h(
            'div',
            { className: 'dsm-cardHead' },
            h('h3', { className: 'dsm-cardTitle' }, t('sectionMemories')),
            h('span', { className: 'dsm-hint' }, memories.total !== null ? t('memoryTotal', { total: memories.total }) : ''),
          ),
          h(
            'div',
            { className: 'dsm-toolbar' },
            h(TextField, {
              id: 'dsm-memory-search',
              value: memories.query,
              placeholder: t('memorySearchPlaceholder'),
              disabled,
              onChange: actions.setMemoriesQuery,
            }),
            h(SelectField, {
              id: 'dsm-memory-kind',
              value: memories.kind,
              options: kindOptions,
              disabled,
              onChange: actions.setMemoriesKind,
            }),
            h(SelectField, {
              id: 'dsm-memory-range',
              value: memories.range ?? '',
              options: [
                { value: '', label: t('rangeAll') },
                { value: 'today', label: t('rangeToday') },
                { value: '7d', label: t('range7d') },
                { value: '30d', label: t('range30d') },
              ],
              disabled,
              onChange: actions.setMemoriesRange,
            }),
            h(SelectField, {
              id: 'dsm-memory-level',
              value: memories.level ?? '',
              options: levelOptions,
              disabled,
              onChange: actions.setMemoriesLevel,
            }),
            h('button', { type: 'button', className: 'dsm-btn', disabled: disabled || memories.phase === 'loading', onClick: actions.searchMemories }, t('memorySearch')),
            h('button', { type: 'button', className: 'dsm-btn dsm-btnGhost', disabled, onClick: actions.refreshMemories }, t('refresh')),
            h('button', { type: 'button', className: 'dsm-btn dsm-btnGhost', disabled: disabled || state.exportState.phase === 'loading', onClick: actions.exportMemories }, state.exportState.phase === 'loading' ? t('exporting') : t('memoryExport')),
          ),
          state.exportState.phase === 'error' ? h('div', { className: 'dsm-result dsm-err' }, state.exportState.error) : null,
          memories.error ? h('div', { className: 'dsm-result dsm-err' }, memories.error) : null,
          memories.phase === 'loading'
            ? h('div', { className: 'dsm-empty' }, t('loading'))
            : rows.length === 0
              ? h('div', { className: 'dsm-empty' }, t('memoryEmpty'))
              : h('ul', { className: 'dsm-memList' }, rows),
          memories.nextOffset
            ? h(
                'div',
                { className: 'dsm-actions' },
                h('button', { type: 'button', className: 'dsm-btn dsm-btnGhost', disabled: memories.loadingMore, onClick: actions.loadMoreMemories }, memories.loadingMore ? t('loading') : t('memoryLoadMore')),
              )
            : null,
        ),
        h(
          'section',
          { className: 'dsm-card' },
          h(
            'div',
            { className: 'dsm-cardHead' },
            h('h3', { className: 'dsm-cardTitle' }, t('sectionSleepTasks')),
            h(
              'div',
              { className: 'dsm-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsm-btn dsm-btnSmall',
                  disabled: disabled || sleepRunning || sleepStatus?.sleeping,
                  onClick: () => {
                    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(t('sleepRunConfirm'))) return
                    actions.runSleepManual()
                  },
                },
                sleepRunning ? t('sleepRunning') : t('sleepRunNow'),
              ),
            ),
          ),
          h('p', { className: 'dsm-hint' }, t('sectionSleepTasksHint')),
          h(
            'div',
            { className: 'dsm-statusList' },
            h(
              'div',
              { className: 'dsm-statusRow', key: 'sleep-state' },
              h('span', { className: 'dsm-statusLabel' }, t('sleepStatus')),
              h('span', { className: 'dsm-statusValue' }, `${sleepStatusText} · ${t('sleepPendingBatches')} ${engineSummary?.pendingTotal ?? 0}`),
            ),
            sleepStatus?.lastSkipReason
              ? h('div', { className: 'dsm-statusRow', key: 'sleep-skip' }, h('span', { className: 'dsm-statusLabel' }, t('sleepLastSkipReason')), h('span', { className: 'dsm-statusValue dsm-muted' }, sleepStatus.lastSkipReason))
              : null,
            sleepStatus?.lastError
              ? h('div', { className: 'dsm-statusRow', key: 'sleep-err' }, h('span', { className: 'dsm-statusLabel' }, t('sleepLastError')), h('span', { className: 'dsm-statusValue dsm-err' }, sleepStatus.lastError))
              : null,
            h('div', { className: 'dsm-statusRow', key: 'sleep-history-title' }, h('span', { className: 'dsm-statusLabel' }, t('sleepHistory')), h('span', { className: 'dsm-statusValue dsm-muted' }, historyRows.length === 0 ? t('sleepHistoryEmpty') : '')),
            ...historyRows,
          ),
        ),
        h(
          'section',
          { className: 'dsm-card' },
          h('h3', { className: 'dsm-cardTitle' }, t('sectionMemoryAdd')),
          h('p', { className: 'dsm-hint' }, t('sectionMemoryAddHint')),
          h(
            'div',
            { className: 'dsm-toolbar' },
            h(TextField, {
              id: 'dsm-memory-add-text',
              value: state.memoryAdd.text,
              placeholder: t('memoryAddPlaceholder'),
              disabled,
              onChange: (value) => actions.setMemoryAdd('text', value),
            }),
            h(SelectField, {
              id: 'dsm-memory-add-kind',
              value: state.memoryAdd.kind,
              options: addKindOptions,
              disabled,
              onChange: (value) => actions.setMemoryAdd('kind', value),
            }),
            h('button', { type: 'button', className: 'dsm-btn dsm-btnPrimary', disabled: disabled || String(state.memoryAdd.text ?? '').trim() === '', onClick: actions.addMemory }, t('memoryAdd')),
          ),
        ),
        h(
          'section',
          { className: 'dsm-card' },
          h(
            'div',
            { className: 'dsm-cardHead' },
            h('h3', { className: 'dsm-cardTitle' }, t('sectionRetention')),
            h(
              'div',
              { className: 'dsm-actions' },
              h('button', { type: 'button', className: 'dsm-btn', disabled: disabled || maintenance.phase === 'running', onClick: actions.runMaintenance }, maintenance.phase === 'running' ? t('maintaining') : t('maintainNow')),
            ),
          ),
          h('p', { className: 'dsm-hint' }, t('sectionRetentionHint')),
          h(
            'div',
            { className: 'dsm-grid2' },
            ['retentionDays', 'maxMemories', 'maintenanceIntervalHours', 'dedupeThreshold', 'dedupeMaxScan'].map((key) =>
              h(ScalarField, { key, field: SCALAR_BY_KEY.get(key), state, actions, t, disabled }),
            ),
            h(ScalarField, { field: SCALAR_BY_KEY.get('maintenanceDedupe'), state, actions, t, disabled }),
          ),
          maintenance.phase === 'error'
            ? h('div', { className: 'dsm-result dsm-err' }, maintenance.error)
            : null,
          maintenance.phase === 'done' && maintenance.result
            ? h(
                'div',
                { className: 'dsm-result' },
                t('maintenanceResult', {
                  expired: maintenance.result.expired ?? 0,
                  overflow: maintenance.result.overflow ?? 0,
                  duplicates: maintenance.result.duplicates ?? 0,
                  ms: maintenance.result.durationMs ?? 0,
                }),
              )
            : null,
        ),
        h(
          'section',
          { className: 'dsm-card dsm-danger' },
          h('h3', { className: 'dsm-dangerTitle' }, t('sectionDanger')),
          h('p', { className: 'dsm-hint' }, t('dangerHint')),
          h(
            'div',
            { className: 'dsm-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsm-btn dsm-btnDanger',
                disabled: disabled || state.recreating,
                onClick: () => {
                  if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(t('dangerConfirm'))) return
                  actions.recreateCollection()
                },
              },
              state.recreating ? t('recreating') : t('dangerRecreate'),
            ),
            state.recreateError ? h('span', { className: 'dsm-err' }, state.recreateError) : null,
          ),
        ),
      )
    }

    /** 高级 Tab。 */
    function AdvancedTab({ state, actions, t, disabled }) {
      const keys = ['captureUserChars', 'captureAssistantChars', 'captureMinChars', 'includeSubagents', 'debug']
      return h(
        React.Fragment,
        null,
        h(
          'section',
          { className: 'dsm-card' },
          h('h3', { className: 'dsm-cardTitle' }, t('sectionAdvanced')),
          h('p', { className: 'dsm-hint' }, t('sectionAdvancedHint')),
          h(
            'div',
            { className: 'dsm-grid2' },
            keys.map((key) => h(ScalarField, { key, field: SCALAR_BY_KEY.get(key), state, actions, t, disabled })),
          ),
        ),
        h(LevelsCard, { state, actions, t, disabled }),
      )
    }

    /** Tab 栏。 */
    function Tabs({ state, actions, t }) {
      const tabs = [
        { id: 'overview', label: t('tabOverview') },
        { id: 'model', label: t('tabModel') },
        { id: 'behavior', label: t('tabBehavior') },
        { id: 'manage', label: t('tabManage') },
        { id: 'advanced', label: t('tabAdvanced') },
      ]
      return h(
        'div',
        { className: 'dsm-tabs', role: 'tablist' },
        tabs.map((tab) =>
          h(
            'button',
            {
              key: tab.id,
              type: 'button',
              role: 'tab',
              'aria-selected': state.tab === tab.id,
              className: 'dsm-tab',
              onClick: () => actions.setTab(tab.id),
            },
            tab.label,
            tab.id === 'model' && state.providersDirty ? h('span', { className: 'dsm-tabBadge' }, '•') : null,
            tab.id === 'manage' && state.memories.total !== null ? h('span', { className: 'dsm-tabBadge' }, String(state.memories.total)) : null,
          ),
        ),
      )
    }

    /** 底部保存栏。 */
    function SaveBar({ state, actions, t }) {
      const dirty =
        Object.keys(state.dirty ?? {}).length > 0 ||
        state.providersDirty === true ||
        Object.values(state.apiKeyDrafts ?? {}).some((value) => String(value ?? '').trim() !== '')
      const disabled = !state.writable || state.saving
      return h(
        'div',
        { className: 'dsm-saveBar' },
        h(
          'button',
          { type: 'button', className: 'dsm-btn dsm-btnPrimary', disabled: disabled || !dirty, onClick: () => actions.save(t) },
          state.saving ? t('saving') : t('save'),
        ),
        h('button', { type: 'button', className: 'dsm-btn', disabled: disabled || !dirty, onClick: actions.discard }, t('discard')),
        state.saveOk ? h('span', { className: 'dsm-success' }, t('saved')) : null,
        state.saveError ? h('span', { className: 'dsm-err' }, t('saveError') + '：' + state.saveError) : null,
        !dirty && !state.saveOk && !state.saveError ? h('span', { className: 'dsm-muted' }, t('noChanges')) : null,
      )
    }

    /** 设置页主组件。 */
    function MemorySection(props) {
      const { t } = props
      const state = props.useMemoryPage((snapshot) => snapshot)
      const actions = {
        setTab: props.setTab,
        editField: props.editField,
        editProvider: props.editProvider,
        addProvider: props.addProvider,
        removeProvider: props.removeProvider,
        setActiveProviderId: props.setActiveProviderId,
        setProviderKeyDraft: props.setProviderKeyDraft,
        saveProviderKey: props.saveProviderKey,
        clearProviderKey: props.clearProviderKey,
        save: props.save,
        discard: props.discard,
        refreshStatus: props.refreshStatus,
        testActive: props.testActive,
        testProvider: props.testProvider,
        setMemoriesQuery: props.setMemoriesQuery,
        setMemoriesKind: props.setMemoriesKind,
        setMemoriesRange: props.setMemoriesRange,
        setMemoryAdd: props.setMemoryAdd,
        loadMoreMemories: props.loadMoreMemories,
        refreshMemories: props.refreshMemories,
        deleteMemory: props.deleteMemory,
        addMemory: props.addMemory,
        exportMemories: props.exportMemories,
        runMaintenance: props.runMaintenance,
        recreateCollection: props.recreateCollection,
        searchMemories: () => props.refreshMemories(),
      }
      if (state.phase === 'loading') {
        return h(
          'div',
          { className: 'dsm-page' },
          h(StyleTag),
          h('h2', { className: 'dsm-title' }, t('title')),
          h('div', { className: 'dsm-empty' }, t('loading')),
        )
      }
      if (state.phase === 'unavailable') {
        return h(
          'div',
          { className: 'dsm-page' },
          h(StyleTag),
          h('h2', { className: 'dsm-title' }, t('title')),
          h('div', { className: 'dsm-empty' }, t('unavailable')),
        )
      }
      const disabled = !state.writable || state.saving
      const tab = state.tab
      return h(
        'div',
        { className: 'dsm-page' },
        h(StyleTag),
        h('h2', { className: 'dsm-title' }, t('title')),
        h('p', { className: 'dsm-desc' }, t('desc')),
        !state.writable ? h('div', { className: 'dsm-empty' }, t('readOnly')) : null,
        h(Tabs, { state, actions, t }),
        tab === 'overview' ? h(StatusCard, { state, actions, t }) : null,
        tab === 'model' ? h(ModelTab, { state, actions, t, disabled }) : null,
        tab === 'behavior' ? h(BehaviorTab, { state, actions, t, disabled }) : null,
        tab === 'manage' ? h(ManageTab, { state, actions, t, disabled }) : null,
        tab === 'advanced' ? h(AdvancedTab, { state, actions, t, disabled }) : null,
        h(SaveBar, { state, actions, t }),
      )
    }

    // ---------------------------------------------------------------------
    // 语言包（扁平 key，locale 服务只做扁查找）
    // ---------------------------------------------------------------------
    const zh = {
      statusSleep: '睡眠整理',
      statusLevels: '记忆层级',
      sleepStatus: '状态',
      sleepStateOff: '未开启',
      sleepStateWaiting: '待机中（等待空闲入睡）',
      sleepStateSleeping: '睡觉整理中 💤',
      sleepPendingBatches: '待处理批次',
      sleepNextDue: '最近到期 {time}',
      sleepLastRun: '最近整理',
      sleepNoLastRun: '还没有整理记录',
      sleepLastSkipReason: '上次跳过原因',
      sleepLastError: '最近错误',
      sleepRunNow: '立即整理',
      sleepRunning: '整理中…',
      sleepRunConfirm: '立即执行一次记忆整理？整理会压缩记忆并删除已处理的原始记忆。',
      sleepProviderAuto: '跟随当前激活 provider',
      sectionSleep: '睡眠整理（记忆巩固）',
      sectionSleepHint: '开启后每天在睡眠时间检查：最近 1 小时无人类消息且无运行中会话才入睡；原始记忆按天压缩成批次，之后按 7/30 天逐级压缩（类似 100→约 20→约 5 条）。睡眠中发消息会收到 zzzZZ，醒后自动继续处理。',
      sectionExperimental: '实验功能',
      sectionExperimentalHint: '两个实验功能默认关闭：①跨天相似事件合并（只把相关簇给模型，不塞整库）；②增强记忆（保留 1 级记忆若干天，仅事件/按需召回使用，到期删除）。',
      sectionLevels: '整理级别参数',
      sectionLevelsHint: '第 1 级按天压缩原始记忆；第 2 级在第 1 级批次创建 7 天后压缩；第 3 级在第 2 级 30 天后压缩；内部结构支持将来增加更多级别。ratio 是输出条数占输入条数的比例，maxItems 是输出上限。',
      sectionSleepTasks: '整理任务与睡眠状态',
      sectionSleepTasksHint: '查看睡眠状态、待处理批次与整理历史，也可以立即执行一次整理。整理期间会自动跳过记录与召回。',
      sleepHistory: '整理历史',
      sleepHistoryEmpty: '暂无整理记录',
      levelAll: '全部层级',
      levelRaw: '原始（L0）',
      level1: '1 级',
      level2: '2 级',
      level3: '3 级',
      memoryBatch: '整理批次',
      memoryEnhanced: '增强记忆',
      'field.consolidationEnabled': '开启睡眠整理',
      'field.consolidationEnabledHint': '按天压缩原始记忆，并按任务列表逐级继续压缩',
      'field.sleepAt': '睡眠开始时间',
      'field.sleepAtHint': 'HH:mm，按上面选择的时区；默认 00:00',
      'field.sleepRetryMinutes': '重试间隔（分钟）',
      'field.sleepRetryMinutesHint': '用户忙碌时每隔多少分钟重试入睡',
      'field.idleMinutes': '空闲判定（分钟）',
      'field.idleMinutesHint': '最近多少分钟内没有人类消息、且没有运行中的会话才入睡',
      'field.consolidationProviderId': '整理模型 provider',
      'field.consolidationProviderIdHint': '留空跟随当前激活 provider；也可以指定其他 provider',
      'field.consolidationModel': '整理模型名称',
      'field.consolidationModelHint': '用于摘要/提炼的对话模型，例如 Qwen/Qwen2.5-7B-Instruct；留空或调用失败会回退纯规则整理',
      'field.experimentalEventMergeEnabled': '事件合并（实验）',
      'field.experimentalEventMergeEnabledHint': '整理时用嵌入向量在库中查找相似/同事件记忆，只把相关簇交给模型，不会把整库塞给 LLM',
      'field.experimentalEventMergeThreshold': '事件合并相似度阈值',
      'field.experimentalEventMergeThresholdHint': '0.5~1，越高越严格（默认 0.85）',
      'field.experimentalEventMergeMaxCandidates': '事件合并候选上限',
      'field.experimentalEventMergeMaxCandidatesHint': '每次最多带入多少条相关记忆作为参考',
      'field.experimentalEnhancementEnabled': '增强记忆（实验）',
      'field.experimentalEnhancementEnabledHint': '额外保留整理后的 1 级记忆若干天，仅用于事件/按需召回',
      'field.experimentalEnhancementDays': '增强记忆保留天数',
      'field.experimentalEnhancementDaysHint': '到期后自动删除',
      'field.level1Ratio': '1 级压缩比例',
      'field.level1RatioHint': '输出条数约等于输入条数 × 比例（含摘要），默认 0.2',
      'field.level1MaxItems': '1 级输出上限',
      'field.level1MaxItemsHint': '第 1 级最多保留多少条',
      'field.level2AfterDays': '2 级触发天数',
      'field.level2AfterDaysHint': '第 1 级批次创建后多少天进行第 2 级压缩',
      'field.level2Ratio': '2 级压缩比例',
      'field.level2RatioHint': '第 2 级输出条数比例',
      'field.level2MaxItems': '2 级输出上限',
      'field.level2MaxItemsHint': '第 2 级最多保留多少条',
      'field.level3AfterDays': '3 级触发天数',
      'field.level3AfterDaysHint': '第 2 级批次创建后多少天进行第 3 级压缩',
      'field.level3Ratio': '3 级压缩比例',
      'field.level3RatioHint': '第 3 级输出条数比例',
      'field.level3MaxItems': '3 级输出上限',
      'field.level3MaxItemsHint': '第 3 级最多保留多少条',
      'field.consolidationInputMaxChars': '单批输入字符上限',
      'field.consolidationInputMaxCharsHint': '超出会分块整理后再合并',

      nav: '长期记忆',
      title: '长期记忆',
      desc: '跨会话持久记忆：支持多套 OpenAI 兼容的云端嵌入 provider（硅基流动/OpenAI/百炼/智谱/火山方舟/Jina/Voyage/自定义）+ Qdrant。可自动记录要点与召回，也可在“记忆管理”里浏览、搜索、添加、删除和导出。',
      loading: '加载中…',
      unavailable: '该插件当前未加载或未启用，暂时无法配置。请在 设置 → 插件 中启用 dsh-memory 后刷新页面。',
      readOnly: '当前部署的设置为只读。',
      refresh: '刷新',
      save: '保存',
      saving: '保存中…',
      saved: '已保存，设置已热生效',
      discard: '撤销修改',
      saveError: '保存失败',
      saveConflict: '设置版本冲突，请重试',
      noChanges: '没有未保存的修改',
      invalidNumber: '请填数字',
      required: '该项不能为空',
      tabOverview: '概览',
      tabModel: '模型与向量库',
      tabBehavior: '记忆行为',
      tabManage: '记忆管理',
      tabAdvanced: '高级',
      statusTitle: '运行状态',
      statusChecking: '检测中…',
      statusProvider: '激活 provider',
      statusApiKey: 'API Key',
      statusConfigured: '已配置',
      statusUnconfigured: '未配置',
      statusQdrant: 'Qdrant',
      statusConnected: '已连接',
      statusDisconnected: '连接失败',
      statusCollection: '集合',
      statusPoints: '{count} 条记忆',
      statusNotCreated: '尚未创建',
      statusScope: '记忆范围',
      statusTimezone: '时区',
      statusTools: '模型工具',
      statusToolsOn: '已启用',
      statusToolsOff: '已禁用',
      statusLastWrite: '最近写入',
      statusLastRecall: '最近召回',
      statusNoData: '暂无',
      statusMaintenance: '最近维护',
      statusMaintenanceSummary: '过期 {expired} · 超限 {overflow} · 重复 {duplicates}',
      statusQueue: '后台队列',
      statusPending: '待处理 {pending} · 完成 {done} · 失败 {failed}',
      statusDimsMismatch: '维度不一致：集合 {size} 维，provider {dims} 维，请重建集合或切换 provider',
      keyLabel: 'API Key',
      keyLabelFor: '{label} API Key',
      keyPlaceholder: '输入 API Key',
      keyPlaceholderKeep: '输入新 Key（留空保持不变）',
      keySave: '保存 Key',
      keyClear: '清除 Key',
      keyConfigured: '已配置',
      keyUnconfigured: '未配置',
      keyRefHint: '凭据引用：{ref}（保存在 ~/.dsh/.credentials.yaml）',
      testRunning: '测试中…',
      testFailed: '失败',
      testOk: '正常',
      testLatency: '{ms}ms',
      testDimensions: '{n} 维',
      testVersion: 'v{v}',
      testPoints: '{n} 条记忆',
      testText: '概览：{text}',
      testProviderLabel: 'Provider',
      testEmbedding: '嵌入服务',
      testQdrant: 'Qdrant',
      testCaption: '视觉模型',
      testActive: '测试激活 provider',
      sectionProviders: 'Provider 档案',
      sectionProvidersHint: '可保存多套云端服务商配置（Base URL 需 OpenAI 兼容的 /embeddings 与 /chat/completions）。选择一个作为当前激活 provider；向量维度需与 Qdrant 集合一致。',
      providersEmptyHint: '还没有 provider，请从上方预设列表添加一个。',
      providerNew: '新 provider',
      providerActive: '当前激活',
      providerActivate: '设为激活',
      providerTest: '测试连接',
      providerRemove: '删除',
      providerRemoveConfirm: '确定删除该 provider 配置？（不会删除凭据与已存记忆）',
      providerName: '显示名称',
      providerId: '唯一 ID',
      providerIdHint: '英文/数字/下划线，用于推导默认 Key 引用名',
      providerBaseUrl: 'Base URL',
      providerBaseUrlHint: '例如 https://api.siliconflow.cn/v1',
      providerEmbedModel: '嵌入模型',
      providerEmbedModelHint: '该服务商提供的 embedding 模型名',
      providerDimensions: '向量维度',
      providerDimensionsHint: '需与模型实际输出一致，且与 Qdrant 集合一致',
      providerApiKeyEnv: 'Key 引用名',
      providerApiKeyEnvHint: '留空默认 <ID>_API_KEY',
      providerVisionModel: '视觉模型',
      providerVisionModelHint: '图片概览使用；留空则图片只记占位',
      providerVisionBaseUrl: '视觉接口 Base URL',
      providerVisionBaseUrlHint: '留空与 Base URL 相同',
      providerVisionKeyEnv: '视觉 Key 引用名',
      providerVisionKeyEnvHint: '留空与 Key 引用名相同',
      providerSendDimensions: '发送 dimensions 参数',
      providerSendDimensionsHint: '部分服务不支持 dimensions 参数时可关闭',
      providerKey: 'API Key',
      providerVisionKey: '视觉 API Key',
      providerAdd: '添加',
      sectionStorage: '向量数据库',
      sectionStorageHint: '插件与 Qdrant 同机时保持默认 http://127.0.0.1:6333 即可；Qdrant 开启了鉴权时填写 Key 引用名。',
      qdrantKey: 'Qdrant API Key',
      sectionTest: '连接测试',
      sectionTestHint: '实际调用激活 provider 的嵌入接口、Qdrant 健康检查，以及视觉模型（如有配置）。',
      sectionBehavior: '记忆行为',
      sectionBehaviorHint: '控制自动记录、自动召回与检索范围。',
      sectionImage: '图片记忆',
      sectionImageHint: '图片只生成一句话概览入库，永不保存原图（概览模式下图片会发送给当前 provider）。',
      sectionTools: '模型工具',
      sectionToolsHint: '控制是否允许模型调用 memory_search / memory_save / memory_forget。',
      sectionTime: '时间与时区',
      sectionTimeHint: '当前：{tz} {now}。记忆的显示时间、相对时间、召回上下文中的“当前时间”都按此时区；留空跟随服务器本地，也可选择常见时区或填自定义 IANA 名称。',
      rangeAll: '全部时间',
      rangeToday: '今天',
      range7d: '近 7 天',
      range30d: '近 30 天',
      sectionMemories: '记忆列表',
      memoryTotal: '共 {total} 条',
      memorySearchPlaceholder: '语义搜索记忆，例如：用户喜欢什么咖啡',
      memorySearch: '搜索',
      memoryExport: '导出 JSON',
      exporting: '导出中…',
      memoryEmpty: '暂无记忆。等几轮对话后会自动出现，也可以手动添加。',
      memoryLoadMore: '加载更多',
      memoryScore: '相关度 {score}',
      memoryDelete: '删除',
      memoryDeleteConfirm: '确定删除这条记忆？此操作不可撤销。',
      kindAll: '全部类型',
      kindTurn: '对话',
      kindFact: '事实',
      kindImage: '图片',
      kindNote: '备注',
      kindPreference: '偏好',
      kindProject: '项目',
      'kind.summary': '摘要',
      'kind.event': '事件',
      'kind.turn': '对话',
      'kind.fact': '事实',
      'kind.image': '图片',
      'kind.note': '备注',
      'kind.preference': '偏好',
      'kind.project': '项目',
      sectionMemoryAdd: '手动添加记忆',
      sectionMemoryAddHint: '写入一条你希望助手长期记住的事实（会自动脱敏）。',
      memoryAddPlaceholder: '例如：用户偏好简体中文，回答尽量简洁。',
      memoryAdd: '添加',
      sectionRetention: '定期维护与保留策略',
      sectionRetentionHint: '维护会清理过期记忆、淘汰超出上限的旧记忆、合并高度相似的重复记忆。保存后按间隔自动执行，也可以点“立即维护”。',
      maintainNow: '立即维护',
      maintaining: '维护中…',
      maintenanceResult: '维护完成：过期 {expired} · 超限 {overflow} · 重复 {duplicates} · 耗时 {ms}ms',
      sectionDanger: '危险操作',
      dangerHint: '重建集合会删除全部长期记忆并按当前 provider 的维度重新创建（修改维度后需要）。',
      dangerConfirm: '确定要删除全部长期记忆并重建集合吗？此操作不可撤销。',
      recreating: '正在重建…',
      dangerRecreate: '重建集合',
      sectionAdvanced: '高级选项',
      sectionAdvancedHint: '记录截断长度、是否记录子代理、调试日志等。',
      providerIdRequired: '第 {index} 个 provider 缺少唯一 ID',
      providerIdDuplicate: 'provider ID 重复：{id}',
      providerBaseUrlRequired: 'provider {id} 缺少 Base URL',
      providerModelRequired: 'provider {id} 缺少嵌入模型',
      providerDimensionsRequired: 'provider {id} 的维度必须是正整数',
      providersEmpty: '至少需要保留一个 provider',
      'field.qdrantUrl': 'Qdrant 地址',
      'field.qdrantUrlHint': '例如 http://127.0.0.1:6333',
      'field.collection': '集合名',
      'field.collectionHint': '记忆保存到该 Qdrant collection',
      'field.qdrantApiKeyEnv': 'Qdrant Key 引用名',
      'field.qdrantApiKeyEnvHint': '留空表示无鉴权（本机回环推荐）',
      'field.memoryScope': '记忆范围',
      'field.memoryScopeHint': 'global=全局共享；workspace=按工作目录隔离；session=按会话隔离',
      'field.autoCapture': '自动记录对话要点',
      'field.autoCaptureHint': '每轮结束后把用户要点与助手回答要点写入记忆库',
      'field.autoRecall': '自动召回相关记忆',
      'field.autoRecallHint': '每轮开始时检索相关历史记忆并注入上下文',
      'field.recallTopK': '自动召回条数',
      'field.recallTopKHint': '每次最多注入几条（1-20）',
      'field.recallMinScore': '召回最低相关度',
      'field.recallMinScoreHint': '0-1，越高越严格（0.35-0.55 较合适）',
      'field.recallMaxChars': '召回注入字符上限',
      'field.recallMaxCharsHint': '注入上下文的记忆文本最大字符数',
      'field.recallIncludeCurrentSession': '召回包含当前会话',
      'field.recallIncludeCurrentSessionHint': '默认只召回其他会话，避免重复注入当前对话',
      'field.recallTimeoutMs': '召回超时（毫秒）',
      'field.recallTimeoutMsHint': '超时则本轮跳过召回，避免拖慢回复',
      'field.timezone': '时区',
      'field.timezoneHint': '记忆显示与“当前时间”使用的时区；留空跟随服务器本地',
      'field.timezoneCustom': '自定义 IANA 时区',
      'field.timezoneCustomHint': '仅当上面选择“自定义”时生效，如 America/New_York',
      'field.injectCurrentTime': '召回时附带当前时间',
      'field.injectCurrentTimeHint': '在自动召回上下文里写明当前时间（按所选时区），便于模型判断记忆新旧',
      'field.relativeTime': '显示相对时间',
      'field.relativeTimeHint': '在召回内容与记忆列表中显示“3 小时前 / 2 天前”等相对时间',
      'field.imageMode': '图片记忆方式',
      'field.imageModeHint': '图片只生成一句话概览入库，永不保存原图',
      'field.captionPrompt': '图片概览提示词',
      'field.captionPromptHint': '留空使用内置默认提示词',
      'field.captionPromptPlaceholder': '用一句中文概括这张图片的关键内容（不超过 30 个字）…',
      'field.captionMaxTokens': '概览最大 token 数',
      'field.captionMaxTokensHint': '生成图片概览时的最大输出 token',
      'field.toolsEnabled': '启用记忆工具',
      'field.toolsEnabledHint': '关闭后模型不能调用 memory_search/save/forget',
      'field.toolSearchLimit': 'memory_search 默认条数',
      'field.toolSearchLimitHint': '模型未指定条数时的默认返回数（1-20）',
      'field.retentionDays': '记忆保留天数',
      'field.retentionDaysHint': '0=永久保留；超期记忆在维护时删除',
      'field.maxMemories': '记忆条数上限',
      'field.maxMemoriesHint': '0=不限；超限时维护会淘汰最旧的记录',
      'field.maintenanceIntervalHours': '自动维护间隔（小时）',
      'field.maintenanceIntervalHoursHint': '每隔多少小时自动执行一次维护',
      'field.maintenanceDedupe': '维护时合并重复记忆',
      'field.maintenanceDedupeHint': '删除高度相似的旧重复记忆（保留较新的一条）',
      'field.dedupeThreshold': '重复相似度阈值',
      'field.dedupeThresholdHint': '0.8-1，越高越保守（默认 0.96）',
      'field.dedupeMaxScan': '每次检查条数',
      'field.dedupeMaxScanHint': '每次维护最多扫描多少条最近记忆',
      'field.captureUserChars': '用户内容截断字符',
      'field.captureUserCharsHint': '记录时保留的用户消息字符数',
      'field.captureAssistantChars': '助手内容截断字符',
      'field.captureAssistantCharsHint': '记录时保留的助手回答字符数',
      'field.captureMinChars': '最短记录字符',
      'field.captureMinCharsHint': '一轮内容少于该长度不记录（过滤噪音）',
      'field.includeSubagents': '记录子代理会话',
      'field.includeSubagentsHint': '是否也记录 subagent 会话的要点',
      'field.debug': '调试日志',
      'field.debugHint': '在 DSH 日志中输出插件调试信息',
      'option.memoryScope.global': '全局共享',
      'option.memoryScope.workspace': '按工作区隔离',
      'option.memoryScope.session': '按会话隔离',
      'option.imageMode.caption': '生成一句话概览（推荐）',
      'option.imageMode.placeholder': '只记录发过图片',
      'option.imageMode.off': '忽略图片',
    }

    const en = {
      statusSleep: 'Sleep consolidation',
      statusLevels: 'Memory levels',
      sleepStatus: 'Status',
      sleepStateOff: 'Off',
      sleepStateWaiting: 'Idle (waiting to sleep)',
      sleepStateSleeping: 'Sleeping / consolidating 💤',
      sleepPendingBatches: 'Pending batches',
      sleepNextDue: 'next due {time}',
      sleepLastRun: 'Last consolidation',
      sleepNoLastRun: 'No consolidation yet',
      sleepLastSkipReason: 'Last skip reason',
      sleepLastError: 'Last error',
      sleepRunNow: 'Consolidate now',
      sleepRunning: 'Consolidating…',
      sleepRunConfirm: 'Run one consolidation pass now? Processed source memories will be compressed and deleted.',
      sleepProviderAuto: 'Follow active provider',
      sectionSleep: 'Sleep consolidation (memory consolidation)',
      sectionSleepHint: 'When enabled, each day at the sleep time the plugin checks: no human message and no running session in the last hour, then consolidates raw memories per day into batches and compresses them further after 7/30 days (like 100 → ~20 → ~5). Messages sent while sleeping get zzzZZ and are resumed automatically after waking.',
      sectionExperimental: 'Experimental features',
      sectionExperimentalHint: 'Two experimental features, off by default: (1) cross-day similar-event merging (only related clusters go to the model, never the whole DB); (2) enhanced memories — keep level-1 memories for N days, used only by event/on-demand recall, then deleted.',
      sectionLevels: 'Consolidation level parameters',
      sectionLevelsHint: 'Level 1 compresses raw memories per day; level 2 runs N days after a level-1 batch; level 3 runs N days after a level-2 batch. ratio is the output/input count ratio, maxItems caps the output. The internal structure supports adding more levels later.',
      sectionSleepTasks: 'Consolidation tasks & sleep state',
      sectionSleepTasksHint: 'View sleep state, pending batches and history, or run a consolidation pass now. Capture and recall are skipped while sleeping.',
      sleepHistory: 'History',
      sleepHistoryEmpty: 'No consolidation yet',
      levelAll: 'All levels',
      levelRaw: 'Raw (L0)',
      level1: 'Level 1',
      level2: 'Level 2',
      level3: 'Level 3',
      memoryBatch: 'Consolidation batch',
      memoryEnhanced: 'Enhanced memory',
      'field.consolidationEnabled': 'Enable sleep consolidation',
      'field.consolidationEnabledHint': 'Compress raw memories per day and continue compressing via the task list',
      'field.sleepAt': 'Sleep start time',
      'field.sleepAtHint': 'HH:mm in the timezone above; default 00:00',
      'field.sleepRetryMinutes': 'Retry interval (minutes)',
      'field.sleepRetryMinutesHint': 'Retry sleeping every N minutes while the user is busy',
      'field.idleMinutes': 'Idle check (minutes)',
      'field.idleMinutesHint': 'Only sleep after this many minutes with no human messages and no running sessions',
      'field.consolidationProviderId': 'Consolidation provider',
      'field.consolidationProviderIdHint': 'Leave blank to follow the active provider',
      'field.consolidationModel': 'Consolidation model',
      'field.consolidationModelHint': 'Chat model used for summary/extraction, e.g. Qwen/Qwen2.5-7B-Instruct; blank or failure falls back to rule-based compression',
      'field.experimentalEventMergeEnabled': 'Event merge (experimental)',
      'field.experimentalEventMergeEnabledHint': 'Use embeddings to find similar/same-event memories and only send related clusters to the model',
      'field.experimentalEventMergeThreshold': 'Event merge threshold',
      'field.experimentalEventMergeThresholdHint': '0.5–1, higher is stricter (default 0.85)',
      'field.experimentalEventMergeMaxCandidates': 'Event merge candidate limit',
      'field.experimentalEventMergeMaxCandidatesHint': 'Maximum related memories passed as context per consolidation',
      'field.experimentalEnhancementEnabled': 'Enhanced memories (experimental)',
      'field.experimentalEnhancementEnabledHint': 'Keep level-1 memories for several days for event/on-demand recall only',
      'field.experimentalEnhancementDays': 'Enhanced retention days',
      'field.experimentalEnhancementDaysHint': 'Deleted automatically after this many days',
      'field.level1Ratio': 'Level 1 ratio',
      'field.level1RatioHint': 'Output ≈ input × ratio (including summary); default 0.2',
      'field.level1MaxItems': 'Level 1 max items',
      'field.level1MaxItemsHint': 'Maximum items after level 1',
      'field.level2AfterDays': 'Level 2 after days',
      'field.level2AfterDaysHint': 'Days after a level-1 batch before level 2 compression',
      'field.level2Ratio': 'Level 2 ratio',
      'field.level2RatioHint': 'Level 2 output/input ratio',
      'field.level2MaxItems': 'Level 2 max items',
      'field.level2MaxItemsHint': 'Maximum items after level 2',
      'field.level3AfterDays': 'Level 3 after days',
      'field.level3AfterDaysHint': 'Days after a level-2 batch before level 3 compression',
      'field.level3Ratio': 'Level 3 ratio',
      'field.level3RatioHint': 'Level 3 output/input ratio',
      'field.level3MaxItems': 'Level 3 max items',
      'field.level3MaxItemsHint': 'Maximum items after level 3',
      'field.consolidationInputMaxChars': 'Input characters per batch',
      'field.consolidationInputMaxCharsHint': 'Longer batches are split and merged',

      nav: 'Memory',
      title: 'Long-term Memory',
      desc: 'Cross-session memory with multiple OpenAI-compatible embedding providers (SiliconFlow/OpenAI/DashScope/Zhipu/Ark/Jina/Voyage/custom) and Qdrant. Auto-capture, auto-recall, and a manager to browse, search, add, delete and export memories.',
      loading: 'Loading…',
      unavailable: 'This plugin is not loaded or not enabled, so it cannot be configured. Enable "dsh-memory" in Settings → Plugins and refresh the page.',
      readOnly: 'This deployment stores settings read-only.',
      refresh: 'Refresh',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved. Settings applied live.',
      discard: 'Discard changes',
      saveError: 'Save failed',
      saveConflict: 'Settings revision conflict. Please retry.',
      noChanges: 'No unsaved changes',
      invalidNumber: 'Please enter a number',
      required: 'This field is required',
      tabOverview: 'Overview',
      tabModel: 'Models & storage',
      tabBehavior: 'Behavior',
      tabManage: 'Memory manager',
      tabAdvanced: 'Advanced',
      statusTitle: 'Runtime status',
      statusChecking: 'Checking…',
      statusProvider: 'Active provider',
      statusApiKey: 'API key',
      statusConfigured: 'configured',
      statusUnconfigured: 'not configured',
      statusQdrant: 'Qdrant',
      statusConnected: 'connected',
      statusDisconnected: 'connection failed',
      statusCollection: 'Collection',
      statusPoints: '{count} memories',
      statusNotCreated: 'not created yet',
      statusScope: 'Memory scope',
      statusTimezone: 'Timezone',
      statusTools: 'Model tools',
      statusToolsOn: 'enabled',
      statusToolsOff: 'disabled',
      statusLastWrite: 'Last write',
      statusLastRecall: 'Last recall',
      statusNoData: 'none yet',
      statusMaintenance: 'Last maintenance',
      statusMaintenanceSummary: 'expired {expired} · overflow {overflow} · duplicates {duplicates}',
      statusQueue: 'Background queue',
      statusPending: 'pending {pending} · done {done} · failed {failed}',
      statusDimsMismatch: 'Dimension mismatch: collection {size}, provider {dims}. Rebuild the collection or switch provider.',
      keyLabel: 'API key',
      keyLabelFor: '{label} API key',
      keyPlaceholder: 'Enter API key',
      keyPlaceholderKeep: 'Enter a new key (blank keeps current)',
      keySave: 'Save key',
      keyClear: 'Clear key',
      keyConfigured: 'configured',
      keyUnconfigured: 'not configured',
      keyRefHint: 'Credential ref: {ref} (stored in ~/.dsh/.credentials.yaml)',
      testRunning: 'Testing…',
      testFailed: 'failed',
      testOk: 'ok',
      testLatency: '{ms}ms',
      testDimensions: '{n} dims',
      testVersion: 'v{v}',
      testPoints: '{n} memories',
      testText: 'summary: {text}',
      testProviderLabel: 'Provider',
      testEmbedding: 'Embedding',
      testQdrant: 'Qdrant',
      testCaption: 'Vision model',
      testActive: 'Test active provider',
      sectionProviders: 'Provider profiles',
      sectionProvidersHint: 'Save multiple cloud provider profiles (Base URL must be OpenAI-compatible /embeddings and /chat/completions). Choose one active provider; its dimensions must match the Qdrant collection.',
      providersEmptyHint: 'No provider yet. Add one from the presets above.',
      providerNew: 'New provider',
      providerActive: 'active',
      providerActivate: 'Set active',
      providerTest: 'Test',
      providerRemove: 'Remove',
      providerRemoveConfirm: 'Remove this provider profile? (credentials and stored memories are kept)',
      providerName: 'Display name',
      providerId: 'Unique ID',
      providerIdHint: 'Letters/digits/underscore; used to derive the default key ref',
      providerBaseUrl: 'Base URL',
      providerBaseUrlHint: 'e.g. https://api.siliconflow.cn/v1',
      providerEmbedModel: 'Embedding model',
      providerEmbedModelHint: 'The embedding model name of this provider',
      providerDimensions: 'Vector dimensions',
      providerDimensionsHint: 'Must match the model output and the Qdrant collection',
      providerApiKeyEnv: 'Key ref',
      providerApiKeyEnvHint: 'Blank defaults to <ID>_API_KEY',
      providerVisionModel: 'Vision model',
      providerVisionModelHint: 'Used for image summaries; blank keeps images as placeholders',
      providerVisionBaseUrl: 'Vision base URL',
      providerVisionBaseUrlHint: 'Blank uses the Base URL above',
      providerVisionKeyEnv: 'Vision key ref',
      providerVisionKeyEnvHint: 'Blank uses the key ref above',
      providerSendDimensions: 'Send dimensions parameter',
      providerSendDimensionsHint: 'Disable when the provider does not support the dimensions parameter',
      providerKey: 'API key',
      providerVisionKey: 'Vision API key',
      providerAdd: 'Add',
      sectionStorage: 'Vector database',
      sectionStorageHint: 'Keep http://127.0.0.1:6333 when Qdrant runs on the same host. If Qdrant requires auth, set a credential ref.',
      qdrantKey: 'Qdrant API key',
      sectionTest: 'Connection test',
      sectionTestHint: 'Calls the embedding endpoint, Qdrant health, and the vision model (when configured).',
      sectionBehavior: 'Memory behavior',
      sectionBehaviorHint: 'Controls auto capture, auto recall and retrieval scope.',
      sectionImage: 'Image memory',
      sectionImageHint: 'Images become one-sentence summaries; the original image is never stored (in caption mode the image is sent to the active provider).',
      sectionTools: 'Model tools',
      sectionToolsHint: 'Controls whether the model may call memory_search / memory_save / memory_forget.',
      sectionTime: 'Time & timezone',
      sectionTimeHint: 'Current: {tz} {now}. Memory display times, relative labels and the recall context "current time" all use this timezone. Leave blank to follow the server; pick a common zone or enter a custom IANA name.',
      rangeAll: 'All time',
      rangeToday: 'Today',
      range7d: 'Last 7 days',
      range30d: 'Last 30 days',
      sectionMemories: 'Memories',
      memoryTotal: '{total} total',
      memorySearchPlaceholder: 'Semantic search, e.g. what coffee does the user like',
      memorySearch: 'Search',
      memoryExport: 'Export JSON',
      exporting: 'Exporting…',
      memoryEmpty: 'No memories yet. They appear after a few turns, or add one manually.',
      memoryLoadMore: 'Load more',
      memoryScore: 'score {score}',
      memoryDelete: 'Delete',
      memoryDeleteConfirm: 'Delete this memory? This cannot be undone.',
      kindAll: 'All kinds',
      kindTurn: 'Turn',
      kindFact: 'Fact',
      kindImage: 'Image',
      kindNote: 'Note',
      kindPreference: 'Preference',
      kindProject: 'Project',
      'kind.summary': 'Summary',
      'kind.event': 'Event',
      'kind.turn': 'Turn',
      'kind.fact': 'Fact',
      'kind.image': 'Image',
      'kind.note': 'Note',
      'kind.preference': 'Preference',
      'kind.project': 'Project',
      sectionMemoryAdd: 'Add memory',
      sectionMemoryAddHint: 'Write a fact you want the assistant to remember (secrets are redacted).',
      memoryAddPlaceholder: 'e.g. The user prefers Simplified Chinese and concise answers.',
      memoryAdd: 'Add',
      sectionRetention: 'Maintenance & retention',
      sectionRetentionHint: 'Maintenance removes expired memories, evicts the oldest above the limit, and merges near-duplicates. It runs on schedule after saving, or run it now.',
      maintainNow: 'Run now',
      maintaining: 'Maintaining…',
      maintenanceResult: 'Maintenance done: expired {expired} · overflow {overflow} · duplicates {duplicates} · {ms}ms',
      sectionDanger: 'Danger zone',
      dangerHint: 'Rebuilding deletes all long-term memories and recreates the collection with the active provider dimensions.',
      dangerConfirm: 'Delete ALL long-term memories and rebuild the collection? This cannot be undone.',
      recreating: 'Rebuilding…',
      dangerRecreate: 'Rebuild collection',
      sectionAdvanced: 'Advanced',
      sectionAdvancedHint: 'Capture truncation, subagent recording, debug logging.',
      providerIdRequired: 'Provider #{index} is missing a unique ID',
      providerIdDuplicate: 'Duplicate provider ID: {id}',
      providerBaseUrlRequired: 'Provider {id} is missing a Base URL',
      providerModelRequired: 'Provider {id} is missing an embedding model',
      providerDimensionsRequired: 'Provider {id} must have a positive dimension',
      providersEmpty: 'At least one provider is required',
      'field.qdrantUrl': 'Qdrant URL',
      'field.qdrantUrlHint': 'e.g. http://127.0.0.1:6333',
      'field.collection': 'Collection',
      'field.collectionHint': 'Qdrant collection storing the memories',
      'field.qdrantApiKeyEnv': 'Qdrant key ref',
      'field.qdrantApiKeyEnvHint': 'Blank means no auth (recommended for loopback)',
      'field.memoryScope': 'Memory scope',
      'field.memoryScopeHint': 'global=shared; workspace=isolated by working directory; session=isolated by session',
      'field.autoCapture': 'Auto-record turn highlights',
      'field.autoCaptureHint': 'Store user request and assistant answer highlights after every turn',
      'field.autoRecall': 'Auto-recall relevant memories',
      'field.autoRecallHint': 'Retrieve relevant memories before each turn and inject them',
      'field.recallTopK': 'Auto-recall count',
      'field.recallTopKHint': 'Max injected memories per turn (1-20)',
      'field.recallMinScore': 'Minimum relevance',
      'field.recallMinScoreHint': '0-1, higher is stricter (0.35-0.55 works well)',
      'field.recallMaxChars': 'Recall character limit',
      'field.recallMaxCharsHint': 'Max characters of injected memory text',
      'field.recallIncludeCurrentSession': 'Include current session',
      'field.recallIncludeCurrentSessionHint': 'By default only other sessions are recalled',
      'field.recallTimeoutMs': 'Recall timeout (ms)',
      'field.recallTimeoutMsHint': 'Skip recall for this turn when timed out',
      'field.timezone': 'Timezone',
      'field.timezoneHint': 'Timezone used for memory times and "current time"; blank follows the server',
      'field.timezoneCustom': 'Custom IANA timezone',
      'field.timezoneCustomHint': 'Used when "custom" is selected above, e.g. America/New_York',
      'field.injectCurrentTime': 'Include current time in recall',
      'field.injectCurrentTimeHint': 'Add the current time (in the selected timezone) to the recall context so the model can judge recency',
      'field.relativeTime': 'Show relative times',
      'field.relativeTimeHint': 'Show "3 hours ago / 2 days ago" in recall content and the memory list',
      'field.imageMode': 'Image memory mode',
      'field.imageModeHint': 'Images become one-sentence summaries; originals are never stored',
      'field.captionPrompt': 'Image summary prompt',
      'field.captionPromptHint': 'Blank uses the built-in prompt',
      'field.captionPromptPlaceholder': 'Summarize the key content of this image in one sentence…',
      'field.captionMaxTokens': 'Summary max tokens',
      'field.captionMaxTokensHint': 'Max output tokens for image summaries',
      'field.toolsEnabled': 'Enable memory tools',
      'field.toolsEnabledHint': 'When off, the model cannot call memory_search/save/forget',
      'field.toolSearchLimit': 'Default memory_search count',
      'field.toolSearchLimitHint': 'Default results when the model does not specify (1-20)',
      'field.retentionDays': 'Retention days',
      'field.retentionDaysHint': '0=keep forever; expired memories are removed during maintenance',
      'field.maxMemories': 'Max memories',
      'field.maxMemoriesHint': '0=unlimited; maintenance evicts the oldest above the limit',
      'field.maintenanceIntervalHours': 'Maintenance interval (hours)',
      'field.maintenanceIntervalHoursHint': 'How often maintenance runs automatically',
      'field.maintenanceDedupe': 'Merge duplicates during maintenance',
      'field.maintenanceDedupeHint': 'Delete near-duplicate older memories (keep the newest)',
      'field.dedupeThreshold': 'Duplicate similarity threshold',
      'field.dedupeThresholdHint': '0.8-1, higher is more conservative (default 0.96)',
      'field.dedupeMaxScan': 'Scan limit per run',
      'field.dedupeMaxScanHint': 'Max recent memories scanned per maintenance run',
      'field.captureUserChars': 'User text limit',
      'field.captureUserCharsHint': 'Characters kept from the user message',
      'field.captureAssistantChars': 'Assistant text limit',
      'field.captureAssistantCharsHint': 'Characters kept from the assistant answer',
      'field.captureMinChars': 'Minimum record length',
      'field.captureMinCharsHint': 'Turns shorter than this are not recorded (noise filter)',
      'field.includeSubagents': 'Record subagent sessions',
      'field.includeSubagentsHint': 'Also record highlights from subagent sessions',
      'field.debug': 'Debug logging',
      'field.debugHint': 'Print plugin debug information to the DSH log',
      'option.memoryScope.global': 'Global (shared)',
      'option.memoryScope.workspace': 'Per workspace',
      'option.memoryScope.session': 'Per session',
      'option.imageMode.caption': 'One-sentence summary (recommended)',
      'option.imageMode.placeholder': 'Only record that an image was sent',
      'option.imageMode.off': 'Ignore images',
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.credentials', 'configForms'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-memory: dictionaries')
        const controller = new MemoryPageController(ctx)
        ctx.effect(
          () => () => {
            controller.dispose()
          },
          'dsh-memory: settings controller',
        )
        ctx.effect(
          () =>
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register(
                {
                  name: 'settings.section',
                  id: 'memory',
                  order: 35,
                  label: () => t('nav'),
                  locale: NS,
                  inject: () => controller.inject(),
                },
                MemorySection,
              ),
            ),
          'dsh-memory: settings page',
        )
      },
    }
  },
})
