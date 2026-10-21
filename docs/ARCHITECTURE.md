# dsh-memory 架构（v0.8 现状）

> 状态：**已实现（v0.8.0）**。记忆处理流程见 [`MEMORY-FLOW.md`](MEMORY-FLOW.md)，整理队列细节见 [`QUEUE.md`](QUEUE.md)。
> 本文件描述代码结构与依赖规则；v0.7 的分层重构已完成，v0.8 在此基础上加入“记忆片段队列”。

---

## 1. 总体形状（一张文本图）

```
┌──────────────────────────────────────────────────────────────────────┐
│ DSH 宿主                                                              │
│  入口：DSH Session（Web GUI 等）                                     │
│  能力：session/event · agent/pre-step · ctx.llm · credentials         │
│        attachments · timer · agents · sessions                        │
│  设置页：client.js（React，无头可测）──HTTP──┐                        │
└─────────────────────────────────────────────│────────────────────────┘
                                              │ /__dsh_memory__/*
┌─────────────────────────────────────────────▼────────────────────────┐
│ dsh-memory 插件（Host 半）                                            │
│                                                                      │
│  ① entry/      入口适配     capture · recall · sleep · tools · http   │
│         │ 只做协议转换，调用 app                                      │
│  ② app/        用例编排     memory · consolidation · queue ·          │
│         │                   maintenance · model-router · status       │
│  ③ domain/     纯领域       片段/批次/编号 · 层级 · 时间窗 ·          │
│         │                  动态召回策略（零 IO，零 DSH 依赖）          │
│  ④ adapters/   基础设施     Qdrant · OpenAI 兼容 HTTP                 │
│  ⑤ index.js    组合根       读配置 · 实例化 · 注入 · 注册 · 生命周期   │
└──────────────────────────────────────────────────────────────────────┘
                    │                         │
                    ▼                         ▼
        Qdrant 127.0.0.1:6333        DSH 已配置模型 / 自定义 provider
        （向量 + payload）            （记忆合并、图片概览；无 embedding）
```

**一句话**：入口只做适配，用例只编排，领域只算规则，适配器只碰外部，装配点只有一个。

---

## 2. 各层职责

| 层 | 负责 | 不允许 |
|---|---|---|
| entry/ | 把 DSH 事件/HTTP/工具调用翻译成用例调用；睡眠窗口判断；超时/错误兜底 | 写存储、写合并逻辑、直接拼 SQL/HTTP |
| app/ | 编排一次业务动作：捕获、召回、跑一轮整理、维护队列、选择模型 | 直接 import DSH ctx（由 service 转交）、直接拼 Qdrant 请求 |
| domain/ | 纯函数与规则：片段层级、批次状态、5 位编号、周/月时间窗、动态召回公式 | import DSH / Qdrant / fetch；读系统时间/随机数（参数传入） |
| adapters/ | Qdrant REST、OpenAI 兼容 HTTP | 被 domain 直接 import |
| index.js | 唯一装配点：配置 → 实例 → 注入 → 注册 → 生命周期 | 业务逻辑 |

> 注：v0.7 曾计划 `ports/` 接口层，实际实现中 app 直接依赖 adapters（项目规模不需要额外抽象）；
> 依赖方向仍保持单向：entry → app → domain / adapters → 外部。

---

## 3. 依赖规则（单向）

```
client.js ──→ shared/（protocol）
index.js ──→ entry/ ──→ app/ ──→ domain/
                     │
                     └──→ adapters/ ──→ 外部系统

允许：entry→app→domain、app→adapters、index→所有
禁止：domain 依赖任何外层；entry 写业务；adapters 反向依赖 entry
构建：build.mjs 用拓扑排序自动推导拼接顺序（循环依赖会报错）
产物：Host 半 = 单文件 index.js（HMR 只重载入口）；Client 半 = src/ui/*.js → client.js
```

---

## 4. 目录（现状）

```
src/
  index.js                     # 组合根（32 行：name/inject/Config/apply）
  shared/
    protocol.js                # HTTP 路径/字段常量（host+client 共用）
  lib/
    domain/
      time.js                  # 时区/日边界/相对时间
      ids.js                   # 记忆 point id、UUID
      levels.js                # 层级与可选输出上限
      memory-values.js         # importance/confidence 默认与归一化
      recall-policy.js         # 动态召回公式（纯函数）
      fragments.js             # 片段队列：状态、周/月窗口、5 位编号（v0.8）
    app/
      memory-service.js        # 写入/召回/列表/导出/删除/状态
      consolidation-service.js # 睡眠合并引擎（L1 事件 → L2 周 → L3 长期）
      queue-service.js         # 批次台账：事件批次/编号/状态机/迁移（v0.8）
      maintenance-service.js   # 维护、集合读取、迁移、payload 修补
      model-router.js          # DSH 模型 / 自定义 provider 路由
    adapters/
      qdrant/client.js         # 向量库 REST
      openai/client.js         # OpenAI 兼容 HTTP（嵌入/对话/视觉）
    entry/
      bootstrap.js             # 装配：service + queue + engine + sleep + 路由 + 定时器
      capture-controller.js    # session/event → 原始片段
      recall-controller.js     # agent/pre-step → 注入召回 + 睡眠拦截
      sleep-controller.js      # 睡眠窗口/zzzZZ/排队唤醒
      maintenance-timer.js     # 定期维护
      prompt.js                # 系统提示段
      tools.js                 # memory_search/save/forget
      http/routes.js           # /status /memories /sleep /consolidation ...
  ui/                          # client 源码模块化（构建成单文件 client.js）
    00-constants.js 01-controller.js 02-components.js 03-locales.js 04-apply.js
tests/
  fragments.mjs                # 片段/编号/时间窗纯领域测试（无 API）
  recall-policy.mjs            # 动态召回公式纯策略
  host-selftest.mjs            # Host 回归（真实 API + Qdrant）
  consolidation.mjs            # 队列/合并/迁移/睡眠控制器
  recall-record.mjs            # 动态召回字段/复述记录
docs/
  MEMORY-FLOW.md  QUEUE.md  ARCHITECTURE.md  archive/  screenshots/
```

---

## 5. 三条关键链路（只跨相邻层）

```
写入：
DSH session/event → CaptureController → MemoryService.eventBatchNo()
                  → QueueService.ensureEventBatch()（会话×日期 → 编号）
                  → EmbedPort(Qdrant) → 原始片段（batch=编号）

取用：
用户新消息 → RecallController(agent/pre-step) → MemoryService.recall()
          → Qdrant topN → 动态门控/排序/预算 → 注入上下文（source=long-term-memory）

整理：
睡眠窗口 → SleepController → ConsolidationEngine.run()
          → QueueService（封批/状态/编号/到期）
          → L1 事件合并 → L2 周合并（N:1）→ L3 长期合并（N:1，final）
          → 写新片段 + 删旧片段 → Maintenance → QueueService.recordRun()
```

实验插槽：
- **E1**：只改「取用」链路里的范围/预算，不碰 DSH 历史；
- **E2**：只在「取用/整理」之间加边界摘要与 compaction 调用（先 spike，失败则放弃）；
- **事件层（暂缓）**：作为三条链路的旁路记录/投影，不穿透 domain。

---

## 6. 当前状态（v0.8）

| 项 | 状态 |
|---|---|
| 分层重构 R1–R5 | ✅ v0.7 完成 |
| 动态相关度召回 | ✅ v0.7 完成（可一键回退） |
| 事件批次队列（会话×日期） | ✅ v0.8 |
| L1 事件 → L2 周 → L3 长期（N:1 合并） | ✅ v0.8 |
| 编号生命周期（待整理期存在、固化回收） | ✅ v0.8 |
| 移除记忆里的 sessionId/cwd/记忆范围 | ✅ v0.8 |
| 时间窗替代“排除当前会话”（默认 10 分钟） | ✅ v0.8 |
| 旧任务列表迁移 + 旧 payload 清理 | ✅ v0.8 |
| 队列 UI（编号/状态/到期/失败重试） | ✅ v0.8 |
| 测试 | 纯领域 8 + 公式 1 套 + Host 84 + 整理 60 + GUI 82 + 浏览器 62 |
| 发布 | v0.8.0 |

---

## 7. 暂缓 / 未来（不进本次重构）

- 上下文实验 E1（召回限定）→ E2（边界 compaction spike）：等队列稳定后单独排期；
- 事件驱动 / Episode / AI 主动情节分割：暂缓；队列模型已预留 `groupKey` 插槽；
- 历史回填：作为未来数据迁移项，需先评估读取全部 DSH session 的成本与隐私；
- 微信/IM 入口上下文连续性：以后再说。
