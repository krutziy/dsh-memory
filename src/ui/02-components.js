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
.dsm-details{border:1px solid var(--dsw-alias-border-subtle,#e5e5e5);border-radius:10px;padding:12px 14px;background:var(--dsw-alias-fill-secondary,rgba(0,0,0,.02))}
.dsm-details>summary{cursor:pointer;font-weight:600;font-size:13px;user-select:none}
.dsm-details[open]>summary{margin-bottom:10px}
.dsm-dshPicker{display:flex;flex-direction:column;gap:4px}
.dsm-functionRow{border-top:1px solid var(--dsw-alias-border-subtle,#e5e5e5);padding-top:14px;margin-top:10px;display:flex;flex-direction:column;gap:6px}
.dsm-functionTitle{font-weight:600;font-size:13px}
.dsm-modelChips{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px}
.dsm-modelChip{font-size:11px;line-height:16px;padding:1px 6px;border-radius:6px;background:var(--dsw-alias-fill-secondary,rgba(0,0,0,.04));border:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,.08));font-family:var(--dsw-alias-font-mono,monospace)}
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
          h('p', { className: 'dsm-hint' }, t('sectionProvidersHintV6')),
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
        ),
        h(
          'div',
          { className: 'dsm-statusList' },
          h(
            'div',
            { className: 'dsm-statusRow', key: 'model-config' },
            h('span', { className: 'dsm-statusLabel' }, t('sleepModelConfig')),
            h(
              'span',
              { className: 'dsm-statusValue' },
              `${state.status?.data?.functions?.consolidation?.source === 'custom' ? t('modelSourceCustom') : t('modelSourceDsh')} · ${state.status?.data?.functions?.consolidation?.providerId || '-'} · ${state.status?.data?.functions?.consolidation?.model || '-'}`,
            ),
          ),
          h('p', { className: 'dsm-hint' }, t('sleepModelHint')),
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

    /** DSH 模型选择行（provider + model，均来自 DSH 模型设置）。 */
    function DshModelPicker({ idPrefix, providerField, modelField, state, actions, t, disabled, imageOnly }) {
      const dsh = state.dshCatalog?.data
      const providers = (dsh?.providers ?? []).filter((provider) => provider.live)
      const modelsByProvider = dsh?.models ?? {}
      const fallback = dsh?.defaultModel
      const draftProvider = String(state.drafts?.[providerField] ?? '')
      const draftModel = String(state.drafts?.[modelField] ?? '')
      const effectiveProvider = draftProvider || fallback?.provider || providers[0]?.id || ''
      let models = modelsByProvider[effectiveProvider] ?? []
      if (imageOnly) models = models.filter((model) => (model.inputModalities ?? []).includes('image'))
      const providerOptions = [
        { value: '', label: t('modelDshDefault') },
        ...providers.map((provider) => ({ value: provider.id, label: provider.name || provider.id })),
      ]
      const modelOptions = [{ value: '', label: t('modelDshDefault') }, ...models.map((model) => ({ value: model.id, label: model.name || model.id }))]
      return h(
        'div',
        { className: 'dsm-dshPicker' },
        h(
          'div',
          { className: 'dsm-grid2' },
          h(
            Field,
            { label: t('modelProviderLabel') },
            h(SelectField, {
              id: `${idPrefix}-provider`,
              value: draftProvider,
              options: providerOptions,
              disabled: disabled || state.dshCatalog?.phase === 'loading',
              onChange: (value) => actions.editField(providerField, value),
            }),
          ),
          h(
            Field,
            { label: t('modelLabel') },
            h(SelectField, {
              id: `${idPrefix}-model`,
              value: draftModel,
              options: modelOptions,
              disabled: disabled || state.dshCatalog?.phase === 'loading',
              onChange: (value) => actions.editField(modelField, value),
            }),
          ),
        ),
        h(
          'p',
          { className: 'dsm-hint' },
          imageOnly && models.length === 0
            ? t('modelDshNoImageModel')
            : t('modelDshEffective', {
                provider: effectiveProvider || '-',
                model: draftModel || fallback?.model || t('modelDshDefault'),
              }),
        ),
      )
    }

    /** 自定义 provider 的模型选择行（插件内 provider 档案）。 */
    function FunctionModelPicker({ idPrefix, label, hint, providerField, modelField, state, actions, t, disabled }) {
      const providers = state.providers ?? []
      const providerDraft = String(state.drafts?.[providerField] ?? '')
      const modelDraft = String(state.drafts?.[modelField] ?? '')
      const effectiveProviderId = providerDraft || state.activeProvider || providers[0]?.id || ''
      const provider = providers.find((item) => String(item.id) === effectiveProviderId) ?? null
      const catalogEntry = state.modelCatalog?.[effectiveProviderId]
      const options = new Set()
      for (const model of catalogEntry?.models ?? []) if (model?.id) options.add(model.id)
      for (const key of ['embedModel', 'visionModel']) {
        if (provider?.[key]) options.add(String(provider[key]))
      }
      if (modelDraft) options.add(modelDraft)
      const modelOptions = [...options]
      const providerOptions = [
        { value: '', label: t('modelProviderAuto') },
        ...providers.map((item) => ({ value: item.id, label: item.name || item.id })),
      ]
      return h(
        'div',
        { className: 'dsm-functionRow' },
        h('div', { className: 'dsm-functionTitle' }, label),
        h('p', { className: 'dsm-hint' }, hint),
        h(
          'div',
          { className: 'dsm-grid2' },
          h(
            Field,
            { label: t('modelProviderLabel') },
            h(SelectField, {
              id: `${idPrefix}-provider`,
              value: providerDraft,
              options: providerOptions,
              disabled,
              onChange: (value) => actions.editField(providerField, value),
            }),
          ),
          modelOptions.length > 0
            ? h(
                Field,
                { label: t('modelLabel'), hint: t('modelSelectHint') },
                h(SelectField, {
                  id: `${idPrefix}-model`,
                  value: modelDraft,
                  options: [{ value: '', label: t('modelInheritDefault') }, ...modelOptions.map((id) => ({ value: id, label: id }))],
                  disabled,
                  onChange: (value) => actions.editField(modelField, value),
                }),
              )
            : h(
                Field,
                { label: t('modelLabel'), hint: t('modelListHint') },
                h(TextField, {
                  id: `${idPrefix}-model`,
                  value: modelDraft,
                  placeholder: t('modelPlaceholder'),
                  disabled,
                  onChange: (value) => actions.editField(modelField, value),
                }),
              ),
        ),
        catalogEntry?.phase === 'loading' ? h('p', { className: 'dsm-hint' }, t('modelFetching')) : null,
        catalogEntry?.phase === 'error' ? h('p', { className: 'dsm-hint dsm-err' }, `${t('modelCatalogError')}：${catalogEntry.error}`) : null,
      )
    }

    /** 功能模型来源选择行。 */
    function ModelSourceRow({ label, hint, sourceField, children, state, actions, t, disabled }) {
      const source = String(state.drafts?.[sourceField] ?? 'dsh')
      return h(
        'div',
        { className: 'dsm-functionRow' },
        h('div', { className: 'dsm-functionTitle' }, label),
        h('p', { className: 'dsm-hint' }, hint),
        h(
          'div',
          { className: 'dsm-grid2' },
          h(
            Field,
            { label: t('modelSourceLabel') },
            h(SelectField, {
              id: `dsm-source-${sourceField}`,
              value: source,
              options: [
                { value: 'dsh', label: t('modelSourceDsh') },
                { value: 'custom', label: t('modelSourceCustom') },
              ],
              disabled,
              onChange: (value) => actions.editField(sourceField, value),
            }),
          ),
        ),
        source === 'dsh' ? children.dsh : children.custom,
      )
    }

    /** 模型列表 Tab：读取 DSH 模型 + 功能模型分配。 */
    function ModelsTab({ state, actions, t, disabled }) {
      const dsh = state.dshCatalog?.data
      const phase = state.dshCatalog?.phase ?? 'idle'
      const providers = dsh?.providers ?? []
      const live = providers.filter((provider) => provider.live)
      const dormant = providers.filter((provider) => !provider.live)
      const modelsByProvider = dsh?.models ?? {}
      const fallback = dsh?.defaultModel
      return h(
        React.Fragment,
        null,
        h(
          'section',
          { className: 'dsm-card' },
          h(
            'div',
            { className: 'dsm-cardHead' },
            h('h3', { className: 'dsm-cardTitle' }, t('sectionDshModels')),
            h(
              'div',
              { className: 'dsm-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsm-btn dsm-btnSmall dsm-btnGhost',
                  disabled: phase === 'loading',
                  onClick: actions.loadDshCatalog,
                },
                phase === 'loading' ? t('loading') : t('modelDshRefresh'),
              ),
            ),
          ),
          h('p', { className: 'dsm-hint' }, t('sectionDshModelsHint')),
          fallback
            ? h(
                'div',
                { className: 'dsm-statusRow', key: 'default-model' },
                h('span', { className: 'dsm-statusLabel' }, t('modelDshDefaultModel')),
                h('span', { className: 'dsm-statusValue' }, `${fallback.provider} · ${fallback.model}`),
              )
            : null,
          phase === 'error' ? h('p', { className: 'dsm-hint dsm-err' }, `${t('modelDshError')}：${state.dshCatalog.error}`) : null,
          live.length === 0
            ? h('p', { className: 'dsm-hint' }, phase === 'loading' ? t('loading') : t('modelDshNoProviders'))
            : live.map((provider) =>
                h(
                  'div',
                  { className: 'dsm-provider', key: provider.id },
                  h(
                    'div',
                    { className: 'dsm-providerHead' },
                    h('div', { className: 'dsm-providerTitle' }, provider.name || provider.id, h(Badge, null, provider.id)),
                    h('span', { className: 'dsm-hint' }, t('modelDshLive')),
                  ),
                  h(
                    'div',
                    { className: 'dsm-modelChips' },
                    (modelsByProvider[provider.id] ?? []).length === 0
                      ? h('span', { className: 'dsm-hint' }, t('modelCatalogEmpty'))
                      : (modelsByProvider[provider.id] ?? []).map((model) =>
                          h(
                            'code',
                            { className: 'dsm-modelChip', key: model.id },
                            `${model.id}${(model.inputModalities ?? []).includes('image') ? ' · 图片' : ''}`,
                          ),
                        ),
                  ),
                ),
              ),
          dormant.length > 0
            ? h(
                'details',
                { className: 'dsm-details' },
                h('summary', null, t('modelDshDormant', { count: dormant.length })),
                h(
                  'div',
                  { className: 'dsm-modelChips' },
                  dormant.slice(0, 40).map((provider) => h('code', { className: 'dsm-modelChip', key: provider.id }, provider.name || provider.id)),
                ),
                h('p', { className: 'dsm-hint' }, t('modelDshDormantHint')),
              )
            : null,
        ),
        h(
          'section',
          { className: 'dsm-card' },
          h('h3', { className: 'dsm-cardTitle' }, t('sectionFunctionModels')),
          h('p', { className: 'dsm-hint' }, t('sectionFunctionModelsHint')),
          h(
            'div',
            { className: 'dsm-statusRow', key: 'embedding-function' },
            h('span', { className: 'dsm-statusLabel' }, t('modelFunctionEmbedding')),
            h(
              'span',
              { className: 'dsm-statusValue' },
              `${state.activeProvider || '-'} · ${(state.providers ?? []).find((p) => p.id === (state.activeProvider || (state.providers ?? [])[0]?.id))?.embedModel || '-'}`,
            ),
          ),
          h('p', { className: 'dsm-hint' }, t('modelFunctionEmbeddingHint')),
          h(ModelSourceRow, {
            label: t('modelFunctionConsolidation'),
            hint: t('modelFunctionConsolidationHint'),
            sourceField: 'consolidationSource',
            state,
            actions,
            t,
            disabled,
            children: {
              dsh: h(DshModelPicker, {
                idPrefix: 'dsm-consolidation-dsh',
                providerField: 'consolidationDshProvider',
                modelField: 'consolidationDshModel',
                state,
                actions,
                t,
                disabled,
              }),
              custom: h(FunctionModelPicker, {
                idPrefix: 'dsm-consolidation-custom',
                label: t('modelCustomProvider'),
                hint: t('modelCustomProviderHint'),
                providerField: 'consolidationProviderId',
                modelField: 'consolidationModel',
                state,
                actions,
                t,
                disabled,
              }),
            },
          }),
          h(ModelSourceRow, {
            label: t('modelFunctionCaption'),
            hint: t('modelFunctionCaptionHint'),
            sourceField: 'captionSource',
            state,
            actions,
            t,
            disabled,
            children: {
              dsh: h(DshModelPicker, {
                idPrefix: 'dsm-caption-dsh',
                providerField: 'captionDshProvider',
                modelField: 'captionDshModel',
                state,
                actions,
                t,
                disabled,
                imageOnly: true,
              }),
              custom: h(FunctionModelPicker, {
                idPrefix: 'dsm-caption-custom',
                label: t('modelCustomProvider'),
                hint: t('modelCustomProviderHint'),
                providerField: 'captionProviderId',
                modelField: 'captionModel',
                state,
                actions,
                t,
                disabled,
              }),
            },
          }),
          h('p', { className: 'dsm-hint' }, t('modelLimitsHint')),
          h(ScalarField, { field: SCALAR_BY_KEY.get('consolidationLimitItems'), state, actions, t, disabled }),
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
          h('h3', { className: 'dsm-cardTitle' }, t('sectionDynamicRecall')),
          h('p', { className: 'dsm-hint' }, t('sectionDynamicRecallHint')),
          h(
            'div',
            { className: 'dsm-grid2' },
            ['recallAgeGateEnabled', 'recallStrictness', 'recallMaxRequired', 'recallWeightImportance', 'recallWeightRehearsal', 'recallWeightConfidence', 'recallNaturalRepeatEnabled'].map((key) =>
              h(ScalarField, { key, field: SCALAR_BY_KEY.get(key), state, actions, t, disabled }),
            ),
          ),
        ),
        h(SleepCard, { state, actions, t, disabled }),
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
        h(
          'details',
          { className: 'dsm-details' },
          h('summary', null, t('sectionExperimental')),
          h('p', { className: 'dsm-hint' }, t('sectionExperimentalHint')),
          h(
            'div',
            { className: 'dsm-grid2' },
            ['experimentalEventMergeEnabled', 'experimentalEventMergeThreshold', 'experimentalEventMergeMaxCandidates', 'experimentalEnhancementEnabled', 'experimentalEnhancementDays'].map((key) =>
              h(ScalarField, { key, field: SCALAR_BY_KEY.get(key), state, actions, t, disabled }),
            ),
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
              Number.isFinite(Number(item.importance)) ? h(Badge, null, 'I' + Math.round(Number(item.importance) * 100)) : null,
              Number.isFinite(Number(item.confidence)) ? h(Badge, null, 'C' + Math.round(Number(item.confidence) * 100)) : null,
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
      const recallKeys = [
        'recallToolBaseMinScore',
        'recallToolStrictness',
        'recallDecayTauL0',
        'recallDecayTauL1',
        'recallDecayTauL2',
        'recallDecayTauL3',
        'recallRehearsalTauDays',
        'recallRehearsalMaxEvents',
        'recallNaturalRepeatThreshold',
        'recallCandidates',
      ]
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
        h(
          'section',
          { className: 'dsm-card' },
          h('h3', { className: 'dsm-cardTitle' }, t('sectionRecallAdvanced')),
          h('p', { className: 'dsm-hint' }, t('sectionRecallAdvancedHint')),
          h(
            'div',
            { className: 'dsm-grid2' },
            recallKeys.map((key) => h(ScalarField, { key, field: SCALAR_BY_KEY.get(key), state, actions, t, disabled })),
          ),
        ),
      )
    }

    /** Tab 栏。 */
    function Tabs({ state, actions, t }) {
      const tabs = [
        { id: 'overview', label: t('tabOverview') },
        { id: 'models', label: t('tabModels') },
        { id: 'behavior', label: t('tabBehavior') },
        { id: 'manage', label: t('tabManage') },
        { id: 'model', label: t('tabModel') },
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
        setMemoriesLevel: props.setMemoriesLevel,
        refreshConsolidation: props.refreshConsolidation,
        runSleepManual: props.runSleepManual,
        fetchProviderModels: props.fetchProviderModels,
        loadDshCatalog: props.loadDshCatalog,
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
        tab === 'models' ? h(ModelsTab, { state, actions, t, disabled }) : null,
        tab === 'behavior' ? h(BehaviorTab, { state, actions, t, disabled }) : null,
        tab === 'manage' ? h(ManageTab, { state, actions, t, disabled }) : null,
        tab === 'advanced' ? h(AdvancedTab, { state, actions, t, disabled }) : null,
        h(SaveBar, { state, actions, t }),
      )
    }
