# dsh-memory 架构草图（重构目标）

> 状态：讨论稿 · 只有结构，不含代码
> 说明：**记忆处理流程见 [`MEMORY-FLOW.md`](MEMORY-FLOW.md)**；本文件只描述重构后的代码结构，
> 待流程图确认后再使用。重构目标是**不改变现有行为**地把 `service.js` / `client.js` 拆成
> 分层清晰、依赖单向、只有一个装配点的结构；未来实验只按预留插槽加，不穿透核心。

---

## 1. 总体形状（一张文本图）

```
┌──────────────────────────────────────────────────────────────────────┐
│ DSH 宿主                                                              │
│  入口：DSH Session（Web GUI 等）                                     │
│  能力：session/event · agent/pre-step · ctx.llm · credentials         │
│        attachments · timer · agents · sessions · compaction(未来E2)   │
│  设置页：client.js（React，无头可测）──HTTP──┐                        │
└─────────────────────────────────────────────│────────────────────────┘
                                              │ /__dsh_memory__/*
┌─────────────────────────────────────────────▼────────────────────────┐
│ dsh-memory 插件（Host 半）                                            │
│                                                                      │
│  ① entry/      入口适配     capture · recall · sleep · tools · http   │
│         │ 只做协议转换，调用 app                                      │
│  ② app/        用例编排     memory · recall · consolidation ·         │
│         │                   model-routing · status                    │
│         │ 只依赖 ports 和 domain                                      │
│  ③ domain/     纯领域       belief · 层级/批次 · 预算/时间/时区 ·      │
│         │                  策略/实验开关（零 IO，零 DSH 依赖）         │
│  ④ ports/      接口         MemoryStore · VectorStore · ChatModel ·   │
│         │                   Credentials · TaskStore · Clock           │
│  ⑤ adapters/   基础设施     DSH 适配 · Qdrant · OpenAI 兼容 · 本地JSON │
│  ⑥ index.js    组合根       读配置 · 实例化 · 注入 · 注册 · 生命周期   │
└──────────────────────────────────────────────────────────────────────┘
                    │                         │
                    ▼                         ▼
        Qdrant 127.0.0.1:6333        DSH 已配置模型 / 自定义 provider
        （向量 + payload）            （记忆整理、图片概览；无 embedding）
```

**一句话**：入口只做适配，用例只编排，领域只算规则，适配器只碰外部，装配点只有一个。

---

## 2. 各层职责

| 层 | 负责 | 不允许 |
|---|---|---|
| entry/ | 把 DSH 事件/HTTP/工具调用翻译成用例调用；超时、错误兜底 | 写存储、写整理逻辑、直接拼 SQL/HTTP |
| app/ | 编排一次业务动作：捕获一条记忆、执行一次召回、跑一轮整理、选择模型 | 直接 new Qdrant 客户端、直接 import DSH ctx |
| domain/ | 纯函数与规则：记忆层级、批次号、预算、时间窗、时区、去重策略 | import DSH / Qdrant / fetch；读系统时间/随机数（由 Clock/IdGen 注入） |
| ports/ | 声明外部能力接口（JSDoc/类型） | 任何实现代码 |
| adapters/ | 实现 ports：DSH 服务、Qdrant、OpenAI 兼容 HTTP、本地 JSON | 被 domain/app 直接 import 具体实现 |
| index.js | 唯一装配点：配置 → 实例 → 注入 → 注册 → 生命周期 | 业务逻辑 |

---

## 3. 依赖规则（单向）

```
client.js ──→ shared/（protocol、config-meta）
index.js ──→ entry/ ──→ app/ ──→ domain/
                     │
                     └──→ ports/ ←── adapters/ ──→ 外部系统

允许：entry→app→domain、app→ports、adapters→ports、index→所有
禁止：domain 依赖任何外层；app 依赖具体 adapters；entry 写业务；adapters 反向依赖 entry
构建：build.mjs 用拓扑排序自动推导拼接顺序，不再手工维护 ORDER 列表
配置：config-meta.js 是配置字段元数据的唯一来源（host 校验 + client 表单共用）
```

---

## 4. 重构后的目录（目标）

```
src/
  index.js                   # 组合根（< 80 行）
  shared/
    protocol.js              # HTTP 路径/字段常量（host+client 共用）
    config-meta.js           # 配置字段元数据（label/hint/tab/order）
  lib/
    util/                    # 纯工具：时区/JSON/ID/文本/错误
    domain/                  # 纯领域：belief、levels、batch-id、budget、time-scope
    ports/                   # 接口声明
    app/
      memory-service.js      # 写入/列表/导出/删除/状态
      recall-service.js      # 检索/召回/预算/渲染
      consolidation-service.js
      model-routing.js       # DSH 模型 / 自定义 provider
      status-service.js
    adapters/
      dsh/                   # ctx.llm、session 事件、credentials、attachments
      qdrant/                # 向量存储
      openai/                # 自定义 provider HTTP
      local/                 # 任务板 JSON、状态文件
    entry/
      capture-controller.js
      recall-controller.js
      sleep-controller.js
      tools.js
      http/
        routes.js + routes/*.js
  ui/                        # client 源码模块化（构建成单文件 client.js）
    sections/                # overview/models/behavior/manage/advanced
    components/              # 通用组件（Field/Badge/KeyEditor…）
    locales/                 # zh/en
    index.jsx
tests/                       # 目前散落在 /tmp 的 host/gui/browser 测试收进仓库
docs/
  ARCHITECTURE.md            # 本文件
  archive/                   # 旧讨论稿（blueprint、v0.7 事件附录）
```

---

## 5. 三条关键链路（只跨相邻层）

```
写入：
DSH session/event → CaptureController → MemoryUseCases → EmbedPort/ChatModelPort
                  → MemoryStore(Qdrant) → Belief

取用：
用户新消息 → RecallController(agent/pre-step) → RecallService → VectorStorePort
          → 排序/预算/渲染 → 注入上下文（source=long-term-memory）
          → [未来] 召回决策日志

整理：
timer/空闲 → SleepScheduler → ConsolidationService → TaskBoard(JSON) + ChatModelPort
          → 写新 Belief + 删原文 → Maintenance（去重/过期/容量）
```

实验插槽：
- **E1**：只改「取用」链路里的范围/预算（当前 Episode/时间窗），不碰 DSH 历史；
- **E2**：只在「取用/整理」之间加边界摘要与 compaction 调用（先 spike，失败则放弃）；
- **事件层（暂缓）**：作为三条链路的旁路记录/投影，不穿透 domain。

---

## 6. 现状 → 目标映射

| 现状 | 目标 | 说明 |
|---|---|---|
| `src/lib/service.js`（~1300 行） | app/memory + app/recall + adapters/qdrant + adapters/openai + domain | 按职责拆分，行为不变 |
| `src/lib/recall.js` | entry/recall-controller + app/recall-service | 注入逻辑保留 |
| `src/lib/capture.js` | entry/capture-controller | 保留 |
| `src/lib/consolidation.js` + `sleep.js` | app/consolidation-service + entry/sleep-controller + domain/levels | 保留算法 |
| `src/lib/tools.js` / `http.js` | entry/tools + entry/http/routes | 拆成路由文件 |
| `client.js`（~3000 行单文件） | ui/ 模块 + 构建成单文件 client.js | DSH 仍只认单文件产物 |
| `build.mjs` 手工 ORDER | shared 构建配置 + 拓扑构建 | 防止依赖顺序漂移 |
| 测试在 `/tmp` | `tests/` 入库 | 可复现是重构的验收前提 |

---

## 7. 重构步骤（每步行为不变、测试全绿才进入下一步）

| 步骤 | 内容 | 验收 |
|---|---|---|
| R0 | 本架构确认 + 旧讨论稿归档到 docs/archive | 你点头 |
| R1 | 建立目录骨架、shared/protocol、config-meta、拓扑构建；测试入库 | host 81 + GUI 76 + 浏览器 57 全绿 |
| R2 | 从 service.js 抽 domain/util（纯函数），不动调用方 | 同上 + 单测新增 |
| R3 | 拆 app 用例 + adapters（qdrant/openai），service 变薄 | 同上 + 行为对照（同输入同结果） |
| R4 | 拆 entry（controllers/tools/http 路由），index 变组合根 | 同上 |
| R5 | client.js 拆 ui/ 模块 + 构建产物；清理死代码 | 同上 + 浏览器截图对比 |

版本建议：重构完成发 `v0.6.x`（内部结构变化，无行为变化），再做实验特性发 `v0.7`。

---

## 8. 暂缓 / 未来（不进本次重构）

- 上下文实验 E1（召回限定）→ E2（边界 compaction spike）：蓝图保留，等重构完成后单独排期；
- 事件驱动 / Episode / AI 主动分割：暂缓，以后再说；
- 历史回填：你倾向“全部”，作为未来数据迁移项，需先评估读取全部 DSH session 的成本与隐私；
- 微信/IM 入口上下文连续性：以后再说。

---

## 9. 需要你确认

1. 这个「六层 + 单装配点 + 方向单向」的形状是否 OK？
2. 重构范围：只做 host 半，还是 host + client（UI 模块化）一起做？
3. 版本节奏：先“无行为变化重构”，再实验特性，可以吗？
4. 目录命名是否用 `src/lib/{domain,ports,app,adapters,entry}` + `ui/`，还是你想换一套命名？
