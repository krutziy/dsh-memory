# 测试

需要：真实 SiliconFlow Key（`SF_KEY`）、本机 Qdrant（127.0.0.1:6333）。
两个 Host 测试会临时创建/清空集合 `dsh_memory_test`，**不要并行运行**（会互相干扰）。

```bash
# 1) Host 回归（provider/写入/召回/列表/工具/HTTP/图片概览）
SF_KEY=sk-... node tests/host-selftest.mjs

# 2) 睡眠整理 / DSH 模型 / 事件合并 / 增强记忆 / zzzZZ
SF_KEY=sk-... node tests/consolidation.mjs
```

GUI 无头与真实浏览器测试需要本机测试依赖（React/Playwright/Chromium），
开发环境路径见脚本头注释，暂时保留在开发机上。
