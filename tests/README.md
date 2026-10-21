# 测试

需要：真实 SiliconFlow Key（`SF_KEY`）、本机 Qdrant（127.0.0.1:6333）。
两个 Host 测试会临时创建/清空集合 `dsh_memory_test`，**不要并行运行**（会互相干扰）。

```bash
# 0) 纯领域测试（无需 API / Qdrant）
node tests/fragments.mjs        # 事件批次键 / 周月窗口 / 5 位编号分配与回收
node tests/recall-policy.mjs    # 动态召回公式

# 1) Host 回归（provider/写入/召回/列表/工具/HTTP/图片概览/事件批次/时间窗）
SF_KEY=sk-... node tests/host-selftest.mjs

# 2) 睡眠整理 / 队列（事件批次、L1→L2→L3 合并、编号生命周期、旧队列迁移、zzzZZ）
SF_KEY=sk-... node tests/consolidation.mjs

# 3) 动态召回字段/复述记录集成（需要 SF_KEY；独立集合 dsh_memory_test_dynamic）
SF_KEY=sk-... node tests/recall-record.mjs
```

GUI 无头与真实浏览器测试需要本机测试依赖（React/Playwright/Chromium），
开发环境路径见脚本头注释，暂时保留在开发机上。
