> ⚠️ **状态更新（2026-10-20）**：本文档为技术附录（讨论稿）。
> 总体蓝图见 [`docs/blueprint.md`](blueprint.md)。按最新讨论：
> - 项目采用「用科学方法指导实践」的工作方式（观察→假设→实验→证据→修正），不绑定特定哲学流派；
> - **事件驱动系统暂缓实施**，先写整体蓝图；其动机（微信/IM 入口切换上下文不便）记录在蓝图 §5；
> - **AI 主动分割暂不做**；上下文实验路线保留 **E1 召回限定 → E2 边界 compaction spike**；
> - 「回填最近 N 天会话」方向保留，具体 N 与时机在蓝图阶段确认；
> - 本文档中事件/情景相关设计在对应阶段确认前不进入代码。

# dsh-memory v0.7 架构重构提案

> 状态：讨论稿（未写代码，等待确认）
> 目标：把 v0.6 的「记忆插件」重构为 **事件驱动的、可证伪的、情景化的记忆系统**；
> 并引入可开关的实验功能：**会话上下文按连续时间段（默认 15 分钟）或 AI 主动触发分割**。

---

## 0. 决策摘要（TL;DR）

1. **第一性原理**：长期记忆不是为了“存档”，而是为了在有限 token/算力下，**降低未来决策的不确定性**。
   因此系统的核心产物不是向量，而是「带证据与置信度的信念（belief）」，以及「决定当前该取用哪些信息的策略（policy）」。
2. **本体论**：系统只承认四类实体 —— **事件（Event，观察）**、**信念（Belief，解释）**、**证据（Evidence，关联）**、**策略（Policy，规范）**。
   原始消息是事件，摘要/事实/偏好是信念，召回记录是决策证据，睡眠整理/上下文窗口是策略。
3. **认识论**：一切信念可追溯（provenance）、带置信度、允许被新证据修正（可错论）；冲突显式化，不假装“记住=正确”。
4. **方法论**：事件溯源 + 投影恢复、确定性重放、特性开关（默认关）、对照实验与指标、先观测后优化、小步可回滚、测试即证伪。
5. **事件驱动**：新增追加式事件日志（append-only journal）作为记忆域的事实源；由纯投影得到情景、信念索引、整理任务板、召回决策日志。
6. **情景（Episode）**：会话被切分为连续时间段。边界规则：空闲间隔 ≥ 15 分钟（可配）/ AI 主动调用分割工具 / 用户显式命令 / 会话结束；情景是“工作记忆”的边界。
7. **上下文实验**：目标行为是“启用后同一会话的上下文只用当前连续时间段的信息”。受 DSH 公共 API 限制，**无法在插件层直接裁剪模型请求的完整历史**（详见 §7.3），因此提供三个实现层级：
   - E1（安全，先做）：**召回/情景摘要按当前 Episode 限定**，不碰 DSH 历史；
   - E2（实验）：在边界处调用 DSH compaction 把旧上下文压缩为摘要，再注入边界提示（需 spike 验证）；
   - E3（激进）：每个 Episode = 新 DSH 会话（真正的全新上下文，但改变交互 UX，不建议默认）。
8. **默认关闭**：`experimentalEventsEnabled` 默认开（只记录、不改变行为）；`experimentalEpisodeContextEnabled` 默认关（真正影响上下文）。
9. **兼容**：v0.6 的 provider/模型/整理/睡眠/DSH 模型复用全部保留；旧记忆迁移为 `legacy` 信念；事件日志从升级时刻开始记录（默认不回填历史）。

---

## 1. 第一性原理与边界

**问题**：AI 每次会话失忆；但“记住一切”既昂贵又不可靠。

- 记忆的价值 = 在未来某个决策点上，**减少的不确定性** − 存储/检索/上下文成本。
- 记忆的质量 = 在需要时**能被正确取用**，而不是“写入条数”。
- 记忆的边界 = 有界理性：token 预算、数据库规模、模型能力都是硬约束。

**因此 v0.7 不做**：
- 不做“全量对话镜像”；
- 不追求“永不遗忘”；
- 不用“像人脑”作为正确性证明（只是设计启发）；
- 不在没有度量之前调参。

---

## 2. 世界观 / 认识论 / 方法论 → 工程约束

| 层 | 原则 | 直接工程约束 |
|---|---|---|
| 本体论 | 观察/解释/规范分离 | Event 不可变；Belief 由事件派生；Policy 不写入事件 |
| 认识论 | 可错论、证据主义 | 每条 Belief 有 `evidence[]`、`confidence`、`status(active/retracted)` |
| 认识论 | 时间是第一公民 | 所有实体带 `validFrom/validTo/ts`；情景与整理都按时间切分 |
| 方法论 | 可证伪 | 每个新行为有开关、有失败判据、有回滚路径 |
| 方法论 | 可复现 | 事件日志 + 确定性投影 + 重放测试；时钟可注入 |
| 方法论 | 奥卡姆剃刀 | 默认策略最少；实验特性默认关；配置项能合并就合并 |
| 系统论 | 稳态/反馈 | TTL、衰减、去重、容量上限、召回决策回写评估 |
| 系统论 | 有界资源 | 输入/输出预算、批次预算、日志轮转 |
| 工程 | 单一职责/可替换 | Journal / Episode / BeliefStore / Consolidation / Policy 分层 |
| 工程 | 幂等与灾备 | 事件去重键；崩溃后可重放；删除可传播（cascade） |
| 伦理 | 用户主权/隐私最小化 | 可导出/可删除；事件日志默认只存引用与摘要，不复制全文 |

---

## 3. 领域模型（六实体）

| 实体 | 定义 | 关键字段 | 存储 |
|---|---|---|---|
| Event | 不可变观察 | `id, ts, type, sessionId, episodeId?, refs, payload, causationId` | 本地 JSONL 日志 |
| Episode | 连续时间段 | `id, sessionId, startedAt, endedAt, boundaryReason, eventSeqs, summaryBeliefId?` | 事件投影 + 摘要 Belief |
| Belief | 对事件的压缩解释（记忆条目） | `id, kind, text, confidence, evidence[], level, batch, status, validFrom/validTo` | Qdrant（向量+payload） |
| Evidence | Belief ↔ Event 关联 | `beliefId, eventId, weight` | 日志/投影（或 Qdrant payload 引用） |
| Batch/Task | 一次整理批次 | `id(5位), level, status, dueAt, sourceBatchIds, stats` | `$DSH_HOME/storages/dsh-memory/consolidation.json` |
| RecallDecision | 一次取用决策 | `query, candidates[], selectedIds, policy, tokens, injectedAt` | 事件日志（审计/评估） |
| Policy | 取用/整理/遗忘规则 | `episodeGapMinutes, recallScope, budgets, featureFlags` | 插件配置（schemastery） |

关系：

```
Event ──(evidence)──> Belief ──(consolidate)──> Belief(level+1)
  │                      │
  └── Episode ──(boundary)──> EpisodeSummary(Belief)
                                  │
RecallDecision ──(policy)──> Belief/Episode 取用
```

---

## 4. 系统分层

```
┌────────────────────────────────────────────────────────────┐
│ UI / 可观测性：概览、模型列表、记忆管理、情景时间线、实验面板   │
├────────────────────────────────────────────────────────────┤
│ Context Policy（实验）：Episode 范围 / 边界摘要 / 预算       │
├────────────────────────────────────────────────────────────┤
│ Recall Engine：查询构造 → 候选 → 排序 → 预算 → 注入/记录     │
├────────────────────────────────────────────────────────────┤
│ Consolidation（睡眠整理，已存在）：L1 日 → L2 周 → L3 月     │
├────────────────────────────────────────────────────────────┤
│ Belief Store（Qdrant）：向量 + 结构化 payload + 置信度       │
├────────────────────────────────────────────────────────────┤
│ Projections：episodeIndex / beliefIndex / batchBoard / recall │
├────────────────────────────────────────────────────────────┤
│ Event Journal（append-only JSONL，事实源）                   │
├────────────────────────────────────────────────────────────┤
│ DSH Adapters：session/event、agent/pre-step、agent/request、  │
│ llm、attachments、compaction、timer、agents                  │
└────────────────────────────────────────────────────────────┘
```

**数据流方向**：DSH 事件 →（观察/记录）→ Journal → 投影 →（整理）→ Belief →（取用）→ Context → 模型。
**反馈方向**：模型工具调用/用户行为 → RecallDecision/反馈事件 → 指标 → 策略调整。

---

## 5. 事件驱动设计

### 5.1 事件分类

| 域 | 事件类型（v0.7 首批） |
|---|---|
| 会话观察 | `session.started`, `user.message`, `assistant.message`, `image.attached`, `tool.called/result`, `session.idle`, `session.ended` |
| 情景 | `episode.started`, `episode.ended`, `episode.boundary`, `episode.summary.created` |
| 记忆 | `observation.captured`, `belief.created/updated/retracted`, `memory.recalled`, `memory.injected` |
| 整理 | `consolidation.batch.created/completed`, `consolidation.run.started/finished`, `sleep.started/ended` |
| 系统 | `config.changed`, `model.assignment.changed`, `experiment.toggled`, `maintenance.run` |

### 5.2 日志 schema（建议）

```json
{
  "v": 1,
  "id": "evt_01J...",
  "ts": 1792423467362,
  "type": "episode.boundary",
  "sessionId": "session-...",
  "episodeId": "ep-20261020-1209-ab12",
  "causationId": "evt_...",
  "correlationId": "turn-...",
  "refs": { "sessionSeq": 42, "beliefIds": [], "batchId": null },
  "payload": { "reason": "idle_gap", "gapMs": 921000 },
  "hash": "sha256:..."
}
```

- **追加写**，按日/大小轮转；`refs` 只保存定位信息（session 事件序号/附件 id），**不复制完整消息正文**（隐私最小化；如需回放再按需从 DSH session log 取）。
- **重放**：启动时读快照 + 日志尾部，重建投影；投影必须是纯函数（时钟、id 生成器可注入）。
- **删除传播**：删除某条记忆时记录 `belief.retracted`；事件日志按保留期清理（默认 30 天），支持导出。

### 5.3 投影与一致性

- 所有派生状态（当前 episode、整理任务板、记忆索引）都能由日志重建；
- Qdrant 是“物化视图”，允许重建；
- 每类事件有 schema 版本与迁移函数；
- 重放测试：固定日志 fixture → 投影结果哈希一致。

---

## 6. Episode（情景）设计

### 6.1 定义

Episode = **同一会话内连续的一段时间**。它是“工作记忆”的单位，也是上下文实验的边界。

### 6.2 边界规则（按优先级）

1. **空闲间隔**：两条用户消息间隔 ≥ `episodeGapMinutes`（默认 15 分钟）→ 新 Episode；
2. **AI 主动分割**：模型调用工具 `memory_episode_split(reason)` → 当前 Episode 结束，下一条消息进入新 Episode；
3. **用户显式命令**：`/episode split`（或设置页按钮）；
4. **会话结束**：`session/ended`；
5. **安全上限**：Episode 最长（默认 4 小时）或最多事件数（默认 200），防止无限长。

边界事件必须记录 `reason + gapMs + evidenceRefs`，便于审计与评估。

### 6.3 AI 主动分割

- 工具名：`memory_episode_split`；参数：`reason`（可选，一句话）。
- 仅根会话可用；同一步多次调用幂等；返回当前/新 episode id 与“边界摘要已生成/稍后生成”。
- 提示词策略：在系统提示中说明“当话题明显切换、任务完成、或用户表示结束当前话题时可以分割”；**默认不自动侦测**，避免猜测错误。
- 可选实验：用 embedding 相似度检测话题突变（默认关）。

### 6.4 Episode 摘要

- 边界确定后，用**整理模型（DSH 模型或自定义）**生成 `episode.summary`（Belief，kind=`episode`，level=0/独立），证据指向该 Episode 事件；
- 新 Episode 的上下文策略可以注入上一条摘要（可开关：不注入 / 仅摘要 / 摘要+关键事实）；
- 摘要进入正常记忆整理链（可被 L1 压缩），但保留 `episodeId` 反查。

---

## 7. 上下文窗口实验（核心难点）

### 7.1 目标行为（用户描述）

> 启用后，同一会话的上下文只使用连续时间内的信息（例如 15 分钟为分界线，或 AI 主动触发分割）。

### 7.2 DSH 能力边界（重要）

| 机制 | 能否裁剪“模型请求的完整历史” | 结论 |
|---|---|---|
| `agent/pre-step` | 只能替换**本步进入的消息**（`messages`），不是完整历史 | ❌ 不能 |
| `agent/request` | 只能替换 `LlmCallConfig`（provider/model/controls），不含 messages | ❌ 不能 |
| `sessions.registerMessageProjection` | 只投影“插件自有事件类型”的消息内容 | ❌ 不能过滤 DSH 历史 |
| `compaction` 服务 | 可压缩指定 region 为摘要（`compactRegion`），但语义是“摘要”不是“丢弃”；行为与副作用需 spike | ⚠️ 可能 |
| 新建 DSH session | 真正全新上下文；但改变用户会话 UI/历史连续性 | ⚠️ UX 侵入 |
| 系统提示/上下文指令 | 只是“软约束”，模型可能不遵循 | ⚠️ 不可保证 |

**结论**：在现有 DSH 公共插件 API 下，**无法严格保证“请求历史只含当前连续段”**。必须诚实地选择实验层级或推动 DSH 核心增加 API。

### 7.3 三个实现层级（建议按 E1 → E2 → E3 递进）

#### E1（安全，建议 v0.7 先做）Episode-scoped Recall

- 自动召回 / 工具检索的**候选范围**限制在当前 Episode（或最近 N 分钟）内；
- 旧 Episode 的信息只能通过：①边界摘要注入；②显式 `memory_search`（按需）；
- 不修改 DSH 历史 → 零风险；
- 实验开关：`experimentalEpisodeContextEnabled` 默认关。

#### E2（实验，需 spike）边界压缩 + 边界提示

- 边界发生时，调用 `ctx.compaction.compactRegion(start, end, agent)` 把**旧 Episode 的上下文**压缩成 DSH compaction 摘要；
- 同时在当前步注入一条“情景边界”上下文消息（含旧摘要 + 新 Episode 起点）；
- 仍需验证：compaction 是否允许任意 region、是否影响会话日志/可回放、是否造成重复摘要、失败回退；
- 若不可行，退回 E1。

#### E3（激进，不建议默认）Episode = Session

- 每个 Episode 创建新的 DSH 会话，旧会话归档；上下文天然从零开始；
- 需要用户接受“会话列表被切分”；迁移/搜索/引用复杂；
- 仅在用户明确要求“绝对隔离”时作为可选项。

#### E4（上游）建议 DSH 增加 Context Policy Hook

- 在 agent-loop 组装请求前允许插件替换/过滤 `messages`（带 manifest/审计）；
- 本仓库可先提设计，不在 v0.7 阻塞。

### 7.4 实验默认行为

实验关闭时，完全保持 v0.6 行为。
实验开启（E1）时：

- 上下文注入的长期记忆 = 当前 Episode 内 + 上一 Episode 摘要（可配）；
- 召回决策记录 `policy=episode`，UI 可看到“当前 Episode / 上次边界 / 注入理由”；
- 用户仍可通过 `memory_search` 主动跨 Episode 检索。

---

## 8. 记忆生命周期（与现有睡眠整理衔接）

```
观察 Event → Episode → Belief(level0)
                         │ 睡眠 L1（按天）
                         ▼
                    Belief(level1) ──7d──> L2 ──30d──> L3
                         │
                         └── 合并/删除原文（保留证据引用）
RecallDecision ← Policy(scope/budget) ← Belief 检索
```

- **置信度**：规则型（整理模型给出/默认 0.7；用户显式 `memory_save` 0.9；冲突时降低）；后续可按“被采纳/被纠正”更新。
- **衰减/遗忘**：按 TTL、条数上限、整理删除；retraction 传播到证据。
- **冲突**：同一主题出现矛盾时，保留双方并标注 `conflictOf`，由整理模型裁决或询问用户。
- **实验：事件合并/增强记忆** 保留现有开关，归属 `Belief` 层，不改变事件层。

---

## 9. 模型与 DSH 集成（v0.6 已建立，继续保留）

- 功能模型：记忆整理、图片概览、Episode 摘要全部走**功能模型策略**；
- 来源：`DSH 模型`（`ctx.llm`，默认）或 `自定义 provider`（回退）；
- 嵌入模型无法来自 DSH（无 embedding 接口），仍由插件 provider 决定；
- 所有模型调用记录到事件（provider/model/usage/latency/成功失败），用于评估。

---

## 10. 目标代码结构（重构方向）

```
src/
  index.js                     # 装配 / prompt section / 生命周期
  lib/
    util.js                    # 时区/JSON/ID/文本
    config.js                  # schemastery 配置（含实验开关）
    schemastery.js
    dsh/
      adapters.js              # ctx 事件 → 领域事件 的适配
      llm.js                   # DSH 模型 / 自定义 provider 路由
    events/
      journal.js               # append-only 日志 + 轮转 + 快照
      schema.js                # 事件 schema/版本/校验
      projections.js           # episodeIndex / beliefIndex / batchBoard / recallLog
      replay.js                # 重建 + 一致性校验
    episodes/
      manager.js               # 边界规则、AI 分割工具、空闲计时
      summary.js               # Episode 摘要（模型调用）
    memory/
      service.js               # 现有 MemoryService（写入/检索/状态）
      beliefs.js               # 置信度/证据/冲突/撤回
      qdrant.js
      api-client.js
    context/
      policy.js                # 上下文窗口/召回范围/预算（实验）
      recall.js                # 注入与决策记录
    consolidation/
      engine.js                # 现有睡眠整理引擎
    scheduler/
      sleep.js                 # 睡眠/活动检测
    http/
      routes.js                # status/memories/sleep/models/events/episodes
  client.js                    # 设置页（无头测试）
  docs/
    architecture-v0.7.md       # 本文档
```

说明：`events/` 与 `episodes/` 是新增层；现有 `service/recall/consolidation/sleep` 逐步迁移，不一次性重写。

---

## 11. 配置草案（新增/变更）

| 配置 | 默认 | 说明 |
|---|---|---|
| `experimentalEventsEnabled` | **true** | 事件日志（只记录，不改行为） |
| `experimentalEpisodeGapMinutes` | 15 | Episode 空闲边界（分钟） |
| `experimentalEpisodeMaxHours` | 4 | Episode 最长 |
| `experimentalEpisodeMaxEvents` | 200 | Episode 最多事件 |
| `experimentalEpisodeContextEnabled` | **false** | 上下文实验总开关 |
| `experimentalEpisodeContextMode` | `episode` | `episode`=仅当前情景；`recent`=最近 N 分钟 |
| `experimentalEpisodeContextRecentMinutes` | 15 | recent 模式窗口 |
| `experimentalEpisodeSummaryInject` | `summary` | `none/summary/summary+facts` |
| `experimentalEpisodeAutoSplit` | false | 自动话题检测（不做默认） |
| 事件日志保留 | 30 天 | 轮转/清理 |
| 既有配置 | 不变 | provider/模型/睡眠/整理/时间 |

---

## 12. 可观测性与科学度量

**指标**（先记录，后优化）：
- 上下文效率：注入 token / 总 token；召回条数与命中率；
- 记忆质量：整理前后条数、去重率、冲突数、retraction 数；
- 情景质量：Episode 边界原因分布、平均时长、跨边界召回比例；
- 性能：写入/召回/整理延迟、失败率、成本（usage）；
- 实验对照：开关 A/B（同一数据回放 + 真实使用），记录 `RecallDecision` 与用户行为。

**科学方法**：
- 每项优化先写**假设 + 指标 + 失败判据**（证伪优先）；
- 用事件日志回放做离线评估，避免“感觉变好了”；
- 小流量/开关灰度；不达预期就回滚。

---

## 13. 迁移与兼容（v0.6 → v0.7）

1. 新增事件日志从升级时刻开始；旧会话不回填（可选：从 DSH `sessionQuery` 回填最近 N 天，需用户同意）。
2. 现有 Qdrant 记忆保留为 `Belief(provenance=legacy)`；批号/层级不变。
3. 所有新功能特性开关控制，关闭时行为=v0.6。
4. 版本号建议 `v0.7.0`；实验功能标注“实验性”，文档写清局限。

---

## 14. 测试方法论（测试即证伪）

- **单元**：事件 schema、边界规则、投影纯函数、预算/截断；
- **属性测试**：任意事件序列重放 = 增量投影；幂等性（重复事件不重复计数）；
- **重放测试**：固定日志 fixture → 投影快照哈希；
- **集成**：mock DSH ctx + 真实 Qdrant；睡眠/整理/边界/召回链路；
- **浏览器**：设置页新 Tab/时间线/开关；无控制台错误；
- **实验验收**：E1 开关前后召回范围断言；E2 仅在 spike 通过后加入，并写回滚测试。

---

## 15. 里程碑（提议）

| 阶段 | 内容 | 验收 |
|---|---|---|
| M0 | 本文档确认 | 你确认原则/边界/路线 |
| M1 | 事件日志 + 投影 + 只读时间线 UI（实验日志默认开启） | 事件可重放；不影响现有行为；测试通过 |
| M2 | Episode 边界 + AI 分割工具 + Episode 摘要（E1 的召回限定，开关默认关） | 开关关=旧行为；开关开=召回限定当前 Episode；有决策日志 |
| M3 | E2 spike：边界 compaction（可选，先验证 DSH 能力，不承诺） | 记录结论；不行则明确放弃并保留 E1 |
| M4 | UI：情景时间线、事件日志、实验面板；文档/截图 | 浏览器全绿；发布 v0.7.0 |
| M5 | 评估与调参：指标面板 + 回顾报告（是否继续/回滚） | 有一页结论 |

---

## 16. 风险登记册

| 风险 | 影响 | 缓解 |
|---|---|---|
| DSH 无上下文裁剪 API | 实验目标无法严格达成 | 明确 E1/E2/E3 边界；推动上游；默认关闭 |
| compaction 副作用/不可回滚 | 会话历史被压缩 | 仅 E2 可选；spike 先验证；失败回退 E1 |
| 事件日志增长/隐私 | 磁盘与泄漏 | 只存引用+摘要；保留期/轮转/导出；默认不存全文 |
| Episode 边界误判 | 上下文割裂 | 默认只空闲/显式；AI 分割需工具调用；可合并/撤销（后续） |
| 重构回归 | 现有功能破坏 | 分层迁移；v0.6 行为作为基线测试；特性开关 |
| 过度设计 | 开发成本 | 奥卡姆剃刀：先 M1/M2，E2 只 spike |

---

## 17. 需要你拍板的开放问题

1. 哲学框架：是否接受“四实体 + 可错论 + 可证伪 + 系统论”的第一性原理？还是你更想以某个具体流派为主（波普尔/实用主义/现象学/控制论）？
2. 事件日志数据：只存“引用+摘要”（隐私、去重，推荐），还是存完整消息（可回放但重复且隐私风险高）？
3. 上下文实验路线：先 E1（安全，召回限定）→ 再 E2 spike（compaction 压缩）？还是直接做 E3（Episode=新会话）？或等 DSH 上游 API？
4. 历史回填：旧记忆/旧会话是否纳入事件体系（回填最近 N 天），还是从升级时刻开始？
5. AI 分割触发：只提供工具（模型自行决定），还是同时提供显式命令/按钮，或再加自动话题检测（默认关）？
6. 里程碑是否按 M1→M2→M3(spike)→M4 推进？是否有优先想先看到的部分（如时间线 UI）？
