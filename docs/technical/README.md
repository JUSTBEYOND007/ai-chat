# 技术变更文档约定

当前功能开发主路线：

- [Flow-Chat Agentic RAG 秋招开发路线 TODO](./2026-07-23-agentic-rag-autumn-recruitment-roadmap.md)
- [轻量 Agent Tool Runtime](./2026-07-23-agent-tool-runtime.md)
- [受控 Agent Loop 与正式聊天接入](./2026-07-23-controlled-agent-loop.md)
- [结构化 Agent SSE 与 Trace UI](./2026-07-23-agent-sse-trace-ui.md)
- [Context Builder 与 Token Budget](./2026-07-23-context-builder-token-budget.md)
- [Summary Memory 长会话记忆](./2026-07-23-summary-memory.md)
- [Agentic RAG 路线重规划](./2026-07-25-agentic-rag-roadmap-replanning.md)
- [RAG 评测基线与检索数据协议](./2026-07-25-rag-evaluation-baseline-and-retrieval-protocol.md)
- [Query Rewrite 与 PostgreSQL 双路召回](./2026-07-25-query-rewrite-and-dual-recall.md)
- [RRF、阈值、结果多样性与 RAG Token Budget](./2026-07-25-rrf-threshold-diversity-selection.md)
- [Hybrid RAG 真实评测远程执行 Prompt](./2026-07-25-hybrid-rag-evaluation-remote-execution-prompt.md)

项目的每次功能、接口、数据结构、配置、安全策略或用户交互修改，都必须同步新增或更新一份 Markdown 技术文档。

## 存放位置与命名

技术变更文档统一放在 `docs/technical/`。

新文档命名格式：

```text
YYYY-MM-DD-功能主题.md
```

例如：

```text
2026-07-23-knowledge-document-management.md
```

跨多次迭代的同一功能可以更新原文档；新行为或独立功能应新建文档。

## 最低内容要求

每份文档至少包含：

1. 背景与目标；
2. 功能范围及明确不包含的内容；
3. API、数据结构、配置或页面行为变更；
4. 关键实现决策与兼容性/安全影响；
5. 验证方式、实际结果和未验证原因；
6. 已知限制与后续建议（如有）。

涉及接口时，应提供请求路径、方法和代表性响应；涉及数据库时，应说明迁移、数据清理或兼容策略。

## 提交前检查

代码与对应技术文档必须在同一个变更集中提交。提交前至少执行：

```bash
git diff --check
```

如果运行测试、构建或端到端验证受环境限制，文档必须记录未执行项和具体原因，不能将其标记为已验证。
