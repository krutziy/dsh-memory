# dsh-memory — DSH 长期记忆插件

[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 的持久化长期记忆插件：
**多套 OpenAI 兼容云端嵌入 provider + Qdrant 向量库**，自动记录对话要点、自动召回相关记忆，
并提供 `memory_search` / `memory_save` / `memory_forget` 工具与完整的设置页 GUI。

纯 JavaScript，无构建依赖（Host 半用 `build.mjs` 拼成单文件），唯一运行时依赖是 DSH 自带的
`@deepseek-ai/schemastery`。

![概览](docs/screenshots/overview.png)

## 功能

- **多 provider 档案**：可保存多套云端服务商配置并随时切换激活项，不再绑定硅基流动。
  内置预设：硅基流动、OpenAI、阿里云百炼（DashScope 兼容模式）、智谱 BigModel、火山方舟 Ark、
  Jina AI、Voyage AI、自定义 OpenAI 兼容服务。
  每个 provider 独立配置：Base URL、嵌入模型、向量维度、Key 引用名、是否发送 `dimensions`、
  视觉模型（用于图片概览）、视觉接口 Base URL / Key 引用名。
- **设置页直接填 API Key**：Key 写入 DSH 凭据库（`~/.dsh/.credentials.yaml`），
  不写进插件配置文件，也不会回传到浏览器；支持按 provider 设置/清除、状态徽标。
- **自动记录**：每轮对话结束后，把「用户要点 + 助手回答要点」写入 Qdrant（不额外调用大模型）；
  可按 `captureMinChars` 过滤“好的/谢谢”之类噪音。
- **图片记忆**：用户发图时调用 provider 的视觉模型生成**一句话概览**，只存这句话 + 向量，
  **永不保存原图**；也支持只记占位或完全忽略图片。
- **自动召回**：每轮第一步检索相关历史记忆，以 `source=long-term-memory` 的上下文行注入
  （DSH 会渲染为“上下文注入”，不是用户气泡）；可配置条数、最低相关度、字符上限、超时、是否包含当前会话。
- **记忆范围**：`global` 全局共享 / `workspace` 按工作目录隔离 / `session` 按会话隔离。
- **记忆管理**：设置页里语义搜索、按时间浏览、手动添加、删除、导出 JSON、重建集合。
- **定期维护**：按间隔自动执行（也可点「立即维护」）：
  清理超过保留天数的记忆、淘汰超出条数上限的最旧记忆、合并高度相似的重复记忆、重建 payload 索引。
- **时间与时区（v0.3）**：时间戳按 epoch 存储，显示时使用你选择的时区（默认跟随服务器本地）。
  自动召回上下文会附带「当前时间（含时区）」与每条记忆的相对时间（如“3 天前”），方便模型判断新旧；
  记忆管理页支持按「今天 / 近 7 天 / 近 30 天」筛选。
- **模型工具**：`memory_search` / `memory_save` / `memory_forget`，可在设置页一键禁用；
  写入前自动脱敏（`sk-…`、`Bearer …`、`api_key: …`、`password: …` 等）。

| Provider 档案 | 记忆管理 |
|---|---|
| ![Provider](docs/screenshots/providers.png) | ![记忆管理](docs/screenshots/memory-manager.png) |

## 安装

### 方式一：从 GitHub 安装（推荐）

```sh
dsh plugin --profile web add github:krutziy/dsh-memory
```

装好后刷新浏览器页面，进入 **设置 → 长期记忆** 配置 provider 与 API Key。

### 方式二：本地目录安装（开发）

```sh
dsh plugin --profile web add /absolute/path/to/dsh-memory
```

新装插件通常由 DSH 的 HMR 直接激活；浏览器端设置页需要刷新一次页面。

## 配置说明

设置页分为五个 Tab：

### 概览
显示当前激活 provider、API Key 状态、Qdrant 连接与版本、集合条数/维度、记忆范围、工具开关、
最近写入/召回、最近维护结果、后台队列。

### 模型与向量库

| 配置 | 说明 |
|---|---|
| Provider 档案 | 多套服务商配置，选择一个「当前激活」。切换后新写入/检索立即使用新 provider |
| Base URL | 需支持 OpenAI 兼容的 `POST /embeddings`（以及视觉概览用的 `/chat/completions`） |
| 嵌入模型 | 该服务商的 embedding 模型名 |
| 向量维度 | 必须与模型实际输出一致，并与 Qdrant 集合一致；改维度后需「重建集合」 |
| Key 引用名 | 凭据在 DSH 凭据库中的引用名，留空默认 `<ID>_API_KEY`；设置页下方直接填 Key |
| 视觉模型 | 图片概览使用的多模态模型；留空则图片只记占位 |
| 发送 dimensions | 部分服务不支持 `dimensions` 参数时关闭 |
| Qdrant 地址/集合 | 默认 `http://127.0.0.1:6333` / `dsh_memory`；Qdrant 有鉴权时填 Key 引用名 |

### 记忆行为
记忆范围、自动记录/召回开关、召回条数/相关度/字符上限/超时、图片记忆方式与提示词、工具开关与默认条数。

### 时间与时区
| 配置 | 默认 | 说明 |
|---|---|---|
| 时区 | 跟随服务器本地 | 记忆显示时间、相对时间、召回上下文里的“当前时间”都按该时区；提供常见 IANA 时区下拉，也支持填自定义 IANA 名称 |
| 召回时附带当前时间 | 开 | 自动召回时在上下文里写明当前时间（含时区），便于模型判断记忆新旧 |
| 显示相对时间 | 开 | 在召回内容与记忆列表中显示“3 小时前 / 2 天前” |

![时间与时区](docs/screenshots/time-timezone.png)

### 记忆管理
记忆列表（语义搜索/时间筛选/分页/删除）、手动添加、导出 JSON、定期维护与保留策略、重建集合。

### 高级
记录时的用户/助手内容截断字符、最短记录字符、是否记录子代理会话、调试日志。

## 数据与安全

- Qdrant 中每条记忆只包含：脱敏后的文本要点、类型、时间、会话 id、工作目录、provider、向量。
  图片只保留概览与宽高/格式，**不保存图片字节**。
- API Key 保存在 `~/.dsh/.credentials.yaml`（`refs` 映射），不进入插件配置/profile patch。
- DSH 自己的会话日志本来就会保存聊天图片附件，这与本插件无关。
- 建议 Qdrant 只监听 `127.0.0.1`；如需远程访问请配置 API Key 与安全组，不要直接暴露公网。
- 插件不会回填历史会话；从安装后开始记录。

## 开发与热重载

- 源码：`src/index.js`（Host 入口）、`src/lib/*.js`（各模块）；`client.js` 是浏览器设置页（单文件，无构建）。
- DSH 的 HMR 在 Node 26 下只刷新入口模块，因此 Host 半用构建脚本拼成无本地 import 的单文件 `index.js`：

  ```sh
  node build.mjs
  ```

  写回 `index.js` 后，若 profile 里开启了 HMR 模块监听，会自动重载插件，无需重启 dsh：
  在 `~/.dsh/profiles/web/cordis.patch.yml` 里加入：

  ```yaml
  - id: hmr
    name: "@deepseek-ai/dsh-hmr"
    config:
      base: "/"
      root:
        - home/ubuntu/mem/dsh-memory
  ```

  修改 `client.js` 后刷新浏览器一次即可。

## 本地 HTTP 接口（设置页同源，仅供排查/扩展）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/__dsh_memory__/status` | 运行状态 |
| GET | `/__dsh_memory__/memories?q=&limit=&offset=&kind=` | 记忆列表/语义搜索 |
| GET | `/__dsh_memory__/export` | 导出全部记忆 JSON |
| POST | `/__dsh_memory__/test` | 测试激活 provider（可带 `{providerId}`） |
| POST | `/__dsh_memory__/memories` | 手动添加 `{text,kind,tags}` |
| POST | `/__dsh_memory__/memories/delete` | 删除 `{ids:[...]}` |
| POST | `/__dsh_memory__/recreate` | 重建集合 `{confirm:"DELETE"}` |
| POST | `/__dsh_memory__/maintenance` | 立即维护 |

POST 需要请求头 `x-dsh-memory: 1`。

## 测试连接
![测试连接](docs/screenshots/test-connection.png)

## 已知限制

- 嵌入维度与 Qdrant 集合绑定：切换维度不同的 provider 前需要「重建集合」（会清空记忆）。
- 自动召回会给每轮增加一次嵌入请求（约 100–300ms；可配置超时，超时自动跳过）。
- 召回内容会作为 `source=long-term-memory` 的上下文消息进入会话日志（DSH 要求模型可见内容可回放）。
- 图片概览依赖 provider 的视觉模型；未配置时自动降级为占位记录。
- 因 DSH HMR 限制，Host 代码改动需通过 `node build.mjs` 重新生成 `index.js` 后才生效。
- 时间显示基于记录的 epoch 时间戳，切换时区只影响显示与“今天/近 7 天”等自然日边界，不改变已存数据。

## 更新记录

- **v0.3.1**：修复自动召回失效 —— 插件 `inject` 名单缺少 `sessions` 服务，
  导致召回阶段读取会话上下文报错（`cannot get property "sessions" without inject`）而被静默跳过；
  已补上并热重载验证：新会话可正常召回、`lastRecallError` 为空、召回内容带当前时间与相对时间。
- **v0.3.0**：时区与时间感知（时区选择 / 相对时间 / 召回附带当前时间 / 时间范围筛选）。
- **v0.2.0**：多 provider 档案管理、记忆管理界面、记忆范围、定期维护。
- **v0.1.0**：首个可用版本（硅基流动 + Qdrant，自动记录/召回与记忆工具）。
