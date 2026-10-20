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
          modelCatalog: {},
          dshCatalog: { phase: 'idle', data: null, error: null },
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
        if (tab === 'models') {
          if (this.state.dshCatalog?.phase === 'idle') void this.loadDshCatalog()
          for (const provider of this.state.providers ?? []) {
            const id = String(provider.id ?? '').trim()
            if (id && !this.state.modelCatalog?.[id]) void this.fetchProviderModels(id)
          }
        }
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
        // 以 Host 镜像的最新快照作为“已保存值”基线，避免保存成功后再次修改时
        // 因本地 value 过期而把“未变化的字段”又写一遍 / 产生无谓冲突。
        const latest = this.form?.getSnapshot?.()
        const savedValue = latest?.status === 'ready' && latest.value ? latest.value : this.state.value
        const ops = []
        for (const field of SCALAR_FIELDS) {
          const saved = savedValue?.[field.key]
          const draft = this.state.drafts[field.key]
          if (sameScalar(field, draft, saved)) continue
          ops.push({ op: 'set', path: [field.key], value: valueOf(field, draft, t) })
        }
        const stagedProviders = (this.state.providers ?? []).map(normalizeProviderDraft)
        const savedProviders = Array.isArray(savedValue?.providers)
          ? savedValue.providers.map(normalizeProviderDraft)
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
        const savedActive = String(savedValue?.activeProvider ?? '').trim()
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
            // 不传固定 expectedRevision：ConfigForm 会使用它已知的最新 revision，
            // 避免页面持有旧 revision 时反复“设置版本冲突，需要刷新”。
            let ok = await this.form.mutate(collected.ops)
            if (!ok) {
              // 给一次「恢复读」后的重试机会（例如其他设置页面刚写入了一下）
              await new Promise((resolve) => setTimeout(resolve, 250))
              if (this.form?.getSnapshot?.()?.status === 'ready') {
                ok = await this.form.mutate(collected.ops)
              }
            }
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

      async loadDshCatalog() {
        if (this.state.dshCatalog.phase === 'loading') return
        this.patch({ dshCatalog: { phase: 'loading', data: this.state.dshCatalog.data, error: null } })
        try {
          const response = await fetch(`${API}/dsh-models`, { headers: { Accept: 'application/json' } })
          const data = await response.json().catch(() => null)
          if (!data || data.ok === false) throw new Error(data?.error ?? `HTTP ${response.status}`)
          this.patch({ dshCatalog: { phase: 'ready', data, error: null } })
        } catch (error) {
          this.patch({ dshCatalog: { phase: 'error', data: this.state.dshCatalog.data, error: errorText(error) } })
        }
      }

      async fetchProviderModels(providerId) {
        const id = String(providerId ?? '').trim()
        if (!id) return
        const current = this.state.modelCatalog?.[id]
        if (current?.phase === 'loading') return
        this.patch({
          modelCatalog: {
            ...this.state.modelCatalog,
            [id]: { phase: 'loading', models: current?.models ?? [], error: null },
          },
        })
        try {
          const response = await fetch(`${API}/models?providerId=${encodeURIComponent(id)}`, {
            headers: { Accept: 'application/json' },
          })
          const data = await response.json().catch(() => null)
          if (!data || data.ok === false) throw new Error(data?.error ?? `HTTP ${response.status}`)
          this.patch({
            modelCatalog: {
              ...this.state.modelCatalog,
              [id]: { phase: 'ready', models: data.models ?? [], error: null },
            },
          })
        } catch (error) {
          this.patch({
            modelCatalog: {
              ...this.state.modelCatalog,
              [id]: { phase: 'error', models: current?.models ?? [], error: errorText(error) },
            },
          })
        }
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
          fetchProviderModels: (providerId) => this.fetchProviderModels(providerId),
          loadDshCatalog: () => this.loadDshCatalog(),
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
