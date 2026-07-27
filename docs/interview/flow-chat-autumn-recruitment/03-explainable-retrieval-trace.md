# 亮点三：实现可解释 Retrieval Trace

## 简历表述

> 实现可解释 Retrieval Trace，完整记录原始/改写 Query、双路召回排名、融合分数、过滤原因、Token 成本及最终片段，并在前端 Agent Trace 中折叠展示和刷新恢复。

## 30 秒回答

> 我把检索从一个只返回 sources 的黑盒升级成统一 Retrieval Trace。每次检索都会记录原问题、有效检索问题、Rewrite 状态、vector/keyword/fused 三个通道、每个候选的原始排名和分数、过滤原因、最终排名、Token 成本以及分阶段耗时。完整 Trace 随 knowledge_search 的 Agent Step 通过 SSE 到前端并持久化，刷新后可以恢复；送回模型的内容会剥离诊断数据，只保留最终片段，避免 Trace 挤占上下文。

## 为什么需要可解释检索

普通 RAG 页面通常只展示最终引用，出现错误时很难判断问题发生在哪一层：

- Query Rewrite 是否错误改变了用户意图？
- 期望文档是否根本没有被召回？
- 是 vector 还是 keyword 通道失败？
- 候选是否被阈值、去重、相邻过滤或 Token Budget 排除？
- RRF 是否把精确匹配排到了后面？
- 页面引用是否与模型实际上下文一致？

Retrieval Trace 的目标是把“为什么得到这组引用”变成可观察、可持久化、可测试的数据。

## 数据结构

核心协议位于 [`retrieval.ts`](../../../AI-Chat-Be/src/knowledge/contracts/retrieval.ts)。顶层 `RetrievalTrace` 包含：

```ts
interface RetrievalTrace {
  version: '1.0'
  strategy: 'vector_baseline' | 'dual_recall' | 'hybrid_rrf'
  knowledgeBaseId: string
  originalQuery: string
  effectiveQuery: string
  rewrittenQuery?: string
  rewrite: QueryRewriteTrace
  topK: number
  candidates: RetrievalCandidate[]
  channels: RetrievalChannelTrace[]
  selection?: RetrievalSelectionTrace
  timings: RetrievalTimings
  generatedAt: string
}
```

候选级数据包含：

- 文档、chunk 和内容；
- vector/keyword/fused 各通道 rank/score；
- `selected`；
- `finalRank/finalScore`；
- `filterReasons`；
- `tokenCount`。

## Trace 如何产生

[`KnowledgeService.searchKnowledgeBaseWithTrace`](../../../AI-Chat-Be/src/knowledge/knowledge.service.ts) 是统一入口。

### Vector baseline

- Rewrite 设为 `never`；
- 只有 vector channel；
- 候选直接标记为 selected；
- keyword channel 记录为 skipped；
- 保留 embedding、vector search 和 total timing。

### Dual recall

- vector 和 keyword 并行执行；
- 使用 `Promise.allSettled`，单通道失败时另一通道仍可保留；
- 合并相同 chunk 的两路排名；
- 不做最终选择，主要用于调试两路原始候选。

### Hybrid RRF

- 在 dual recall 基础上执行 RRF；
- 依次应用阈值、去重、相邻过滤、文档配额、Token Budget 和 TopK；
- 追加 fused channel；
- 生成 Selection Trace。

## 过滤原因为什么必须结构化

使用枚举原因而不是自然语言，有三个作用：

1. 前端可以稳定映射为中文标签；
2. 评测报告可以统计每种过滤发生次数；
3. 测试可以确定性断言，不依赖文案。

当前支持：

```text
below_score_threshold
duplicate_chunk
adjacent_chunk
document_quota_exceeded
token_budget_exceeded
top_k_limit
```

对应测试位于 [`retrieval-fusion.service.spec.ts`](../../../AI-Chat-Be/src/knowledge/retrieval-fusion.service.spec.ts)。

## 如何接入 Agent Tool

[`knowledge-search.tool.ts`](../../../AI-Chat-Be/src/agent-runtime/tools/knowledge-search.tool.ts) 的输出包含：

```ts
{
  code: 'OK' | 'NO_RELIABLE_CONTEXT'
  query: string
  effectiveQuery: string
  knowledgeBaseId: string
  sources: KnowledgeSource[]
  retrievalTrace: RetrievalTrace
}
```

工具执行完成时，`AgentRunner` 发出 `tool_result` SSE，并把完整输出写入对应 Agent Step。ChatService 最终又将 `agentSteps` 随 assistant message 保存，因此不需要为 Retrieval Trace 单独增加数据库表或消息字段。

## 为什么完整 Trace 不送回模型

完整候选可能包含 10～20 个 chunk、多个通道分数和过滤信息。如果全部回填模型：

- 增加 Token 成本；
- 挤占真正的 RAG 上下文；
- 模型可能引用本应被过滤的候选；
- 调试元数据会干扰回答。

[`AgentContextBuilder.serializeToolResult`](../../../AI-Chat-Be/src/agent-runtime/context/agent-context-builder.service.ts) 对 `knowledge_search` 做特殊处理：

- SSE/持久化保留完整 `retrievalTrace`；
- 模型侧只得到 `code/query/effectiveQuery/knowledgeBaseId`；
- `ragContext.sources` 只包含最终选中片段；
- 使用独立 `RAG_CONTEXT_TOKEN_BUDGET`。

这形成“诊断数据面”和“模型上下文面”的分离。

## 前端事件归并

前端类型定义位于 [`types/chat.ts`](../../../AI-Chat/packages/ai-chat-pc/src/types/chat.ts)。

数据流：

```text
tool_start SSE
  -> reduceAgentSteps 创建 running tool step
tool_result SSE
  -> 根据 toolCallId 更新同一个 step
  -> output 中保留 retrievalTrace
Zustand store
  -> 更新原会话的 assistant message
AgentTrace
  -> 识别 knowledge_search output
  -> 渲染 RetrievalTracePanel
```

关键文件：

- [`streamChatClient.ts`](../../../AI-Chat/packages/ai-chat-pc/src/utils/streamChatClient.ts)：解析结构化 SSE；
- [`agentTrace.ts`](../../../AI-Chat/packages/ai-chat-pc/src/utils/agentTrace.ts)：按稳定 Step ID 合并事件；
- [`useChatStore.ts`](../../../AI-Chat/packages/ai-chat-pc/src/store/useChatStore.ts)：写入原会话状态；
- [`AgentTrace.tsx`](../../../AI-Chat/packages/ai-chat-pc/src/components/VirtualChatList/AgentTrace.tsx)：Agent 总时间线；
- [`RetrievalTracePanel.tsx`](../../../AI-Chat/packages/ai-chat-pc/src/components/VirtualChatList/RetrievalTracePanel.tsx)：检索解释 UI。

## 前端展示内容

默认摘要区域展示：

- 当前策略；
- 采用片段数/候选总数；
- 总检索耗时；
- 是否 `NO_RELIABLE_CONTEXT`；
- 原问题和有效检索问题；
- Rewrite 状态、原因和耗时；
- vector/keyword/fused 通道状态与候选数量；
- RRF k、Token 使用、文档配额和相邻距离。

详细候选默认折叠，展开后显示：

- 是否采用和最终排名；
- 文件名与 chunk index；
- 各通道 rank/score；
- Token 数；
- 过滤原因；
- 内容预览。

这种设计让普通用户看到简洁过程，调试和面试演示时又能展开完整细节。

## 为什么刷新后还能恢复

完成消息保存时，ChatService 将：

- `toolCalls`；
- `agentSteps`；
- `sources`；
- `contextUsage`

写入 Message。页面刷新后，历史接口返回 `agentSteps`，[`chatMessageMapper.ts`](../../../AI-Chat/packages/ai-chat-pc/src/utils/chatMessageMapper.ts) 恢复前端消息结构，AgentTrace 直接从持久化 Step 的 `output.retrievalTrace` 重新渲染。

因此“刷新恢复”不依赖 SSE 缓存仍然存在。

## 高频追问

### 为什么不把 Trace 单独建表？

> 当前 Trace 与一次 assistant generation 一一对应，已有 agentSteps JSON 可以完整承载，避免提前增加表和关联复杂度。如果未来需要跨请求聚合、检索分析平台或大规模 Trace 查询，再拆独立表或事件存储。

### Trace 会不会太大？

> 会有体积成本，因此正式检索限制候选数量，前端默认折叠，并且模型上下文不包含完整 Trace。未来可以只持久化内容 preview 或将大 Trace 单独存储。

### 如何保证引用一致？

> sources 和模型的 ragContext 都从同一批 `selected=true` 候选生成。完整 candidates 只用于解释，不会送回模型，因此被过滤候选不会被模型引用。

### 单通道失败怎么办？

> 使用 `Promise.allSettled`，Trace 将失败通道记录为 failed，另一通道仍可继续。如果两个通道都不可用才整体失败。

## 2 分钟回答模板

> 我把检索结果抽象成统一 Retrieval Trace，而不是只返回 sources。Trace 从 Query Rewrite 开始，记录 original/effective query、改写状态；召回阶段记录 vector、keyword 和 fused 通道的状态、耗时、rank 和 score；选择阶段记录阈值、去重、相邻 chunk、文档配额、Token Budget 以及每个候选为什么被过滤。完整 Trace 放在 knowledge_search 的 Agent Step 输出中，通过 tool_result SSE 实时到前端，并随消息持久化，所以刷新后还能恢复。为了避免调试信息污染模型，Context Builder 只把 selected sources 作为独立 RAG 区域回填模型。

## 已知限制

- Trace 当前存储在 Message JSON 中，缺少跨会话聚合查询；
- 候选内容会增加消息 JSON 体积；
- 真实浏览器 Hybrid 面板验收仍需要在有模型配置的环境执行；
- 引用尚不能直接定位 PDF 页码或 Markdown 标题路径；
- 当前 Trace 主要用于单次请求解释，不是完整生产 APM 系统。
