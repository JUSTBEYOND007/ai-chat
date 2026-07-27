# Flow-Chat 秋招项目面试讲解手册

这套文档围绕简历中的五个核心亮点展开，目标不是重复技术文档，而是帮助候选人在项目面试中做到：

- 能在 30 秒内说清亮点；
- 能在 2～5 分钟内讲清架构和关键实现；
- 能定位到真实代码、测试与评测报告；
- 能解释为什么这样设计，以及为什么没有选择其他方案；
- 面对失败指标和已知限制时不回避、不夸大。

## 项目定位

Flow-Chat 是一个面向个人知识库的可解释 Agentic RAG 对话平台。前端使用 React、TypeScript、Zustand 和 Ant Design，后端使用 NestJS、PostgreSQL、pgvector 与 Redis，模型通过 DashScope OpenAI-compatible API 接入。

项目的核心价值不是“接入了大模型”，而是围绕 Agent 执行边界、检索质量评测、上下文控制、过程可解释性以及流式生成可靠性形成了完整工程闭环。

## 五篇专题

1. [可控 Agent Runtime](./01-controllable-agent-runtime.md)
   - Tool Registry、原生 Tool Calling、Zod 参数校验、安全计算器、权限隔离、超时、最大轮数和持久化。

2. [可评测的 RAG 检索链路](./02-evaluable-rag-retrieval.md)
   - pgvector、PostgreSQL 全文检索、Query Rewrite、RRF、多样性过滤、Token Budget 和 26 条离线评测。

3. [可解释 Retrieval Trace](./03-explainable-retrieval-trace.md)
   - 原始/改写 Query、双路候选、融合排名、过滤原因、最终片段、前端折叠展示和刷新恢复。

4. [Context Builder 与 Summary Memory](./04-context-builder-summary-memory.md)
   - 固定 Token Budget、历史筛选、知识库作用域、增量摘要、失败回退和上下文可视化。

5. [端到端取消与 SSE 可靠性](./05-end-to-end-cancellation-sse.md)
   - generationId、seq、afterSeq、事件去重、AbortSignal、幂等取消、竞态控制、部分文本与终态持久化。

## 推荐讲解顺序

### 30 秒项目介绍

> Flow-Chat 是我从零实现的 Agentic RAG 对话平台。我没有只做模型 API 封装，而是重点解决了五类工程问题：可控 Tool Calling、可评测的混合检索、可解释 Retrieval Trace、固定预算的长会话记忆，以及真正能够终止服务端模型和工具的端到端取消。项目建立了 26 条 RAG 评测集，纯向量和 Hybrid 的 Hit@5 都达到 100%，MRR 为 0.8788；我根据 P95 延迟和质量结果决定保留纯向量作为默认策略。

### 3 分钟讲解

建议按以下顺序：

1. 先说明项目解决什么问题，而不是先报技术栈；
2. 用 Agent Runtime 说明执行边界；
3. 用 RAG 评测说明不是凭感觉调参；
4. 用 Context/Memory 说明多轮对话控制；
5. 用取消和 SSE 说明可靠性；
6. 最后主动说明限制和下一步。

### 深挖时的主线

```text
用户发送消息
  -> Context Builder 组装系统提示词、摘要和最近历史
  -> Agent Model 决定直接回答或调用工具
  -> Tool Executor 校验参数、权限、超时与取消
  -> knowledge_search 执行检索、融合和选择
  -> Retrieval Trace 通过 SSE 展示并持久化
  -> 模型基于最终片段回答
  -> 消息、引用、工具记录、Agent Step、Context Usage 落库
  -> completed 后增量刷新 Summary Memory
```

## 真实验证基线

- 后端全量 Jest：25 suites、94 tests passed；
- Vector baseline：26/26 cases completed，Hit@5 1.0000，MRR 0.8788，P95 244ms；
- Hybrid RRF：26/26 cases completed，Hit@5 1.0000，MRR 0.8788，P95 425ms；
- Calculator 真实 Tool Calling 结果：`426763582`；
- Knowledge Search 真实工具链命中 synthetic source，并验证跨用户访问 404；
- 停止请求到 `cancelled` SSE：约 17.79ms；
- 后端 build/typecheck、前端 PC/Plug build/typecheck 均通过。

详细数据见：[真实环境验证报告](../../technical/2026-07-26-real-environment-validation-report.md)。

## 面试表达边界

可以说：

- “实现了 Hybrid RRF，并用指标决定默认保留 vector baseline。”
- “建立了离线检索评测和可解释 Trace。”
- “取消信号贯穿模型、工具、Rewrite 和检索。”
- “Summary Memory 按普通会话/知识库作用域隔离。”

不要说：

- “Hybrid 显著提升了整体准确率”——真实指标没有提升；
- “不可回答问题已经稳定拒答”——当前 refusal rate 仍为 0；
- “系统已经支持生产级多实例事件恢复”——事件缓存仍是单进程内存 Map；
- “使用了 BullMQ、检索缓存、reranker 或模型微调”——这些尚未实现；
- “已经完成正式公网高可用部署”——没有对应证据。

## 面试前准备清单

- 能手画 Agent Tool Calling 两轮时序图；
- 能解释 RRF 为什么不直接相加 vector score 和 keyword score；
- 能手算 Hit@K、MRR 和 P95 的含义；
- 能解释 `throughMessageId` 如何支持增量摘要；
- 能解释 cancel/complete 竞态为什么需要服务端终态；
- 能说清当前最明显的短板：不可回答问题拒答率；
- 准备一个 Calculator 和一个 Knowledge Search 的演示流程；
- 准备一个停止生成、SSE 重连和刷新恢复的演示流程。
