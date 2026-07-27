# RRF、阈值、结果多样性与 RAG Token Budget

日期：2026-07-25

## 背景与目标

上一轮已经得到 pgvector 和 PostgreSQL 全文检索的两路原始候选，但两种分数不在同一尺度上，不能直接相加，也没有决定哪些片段真正进入模型上下文。

本轮增加确定性的 RRF 排名融合和候选选择管线，并让每个被过滤候选保留原因。目标是形成可评测、可解释的 `hybrid_rrf` 策略，同时继续避免在真实指标完成前替换正式聊天链路。

## 本轮范围

已实现：

- 使用 Reciprocal Rank Fusion 合并 vector 和 keyword 排名；
- 保留原始通道 rank/score，并新增 fused rank/score；
- 支持按通道配置最低分数阈值；
- 未经真实评测校准时默认不启用分数阈值；
- 过滤内容完全重复的 chunk；
- 过滤同文档相邻 chunk；
- 限制单篇文档进入上下文的 chunk 数量；
- 为最终 RAG 片段设置独立 Token Budget；
- 对超过 TopK 的候选记录原因；
- 保存选择配置、选中数量和 Token 使用量；
- 新增 `hybrid_rrf` 调试策略；
- 评测 CLI 支持 vector baseline 与 hybrid RRF 使用同一数据集对比；
- 新增融合、阈值、去重、多样性和预算测试。

2026-07-25 初始范围不包含（其中部分已在 2026-07-27 后续实现中完成）：

- 在缺少真实 baseline 时写死最低相关阈值；
- `NO_RELIABLE_CONTEXT` Agent 错误码；
- MMR、cross-encoder 或 LLM reranker；
- 将 `hybrid_rrf` 默认接入正式聊天；
- 前端检索 Trace 面板；
- 点击引用定位标题或 PDF 页码。

## RRF 融合

每个候选的融合分数为：

```text
RRF(candidate) = Σ 1 / (k + rank_channel)
```

默认 `k=60`，可通过 `RAG_RRF_K` 配置。RRF 只使用通道排名，不直接混合 cosine similarity 和 `ts_rank_cd`，因此避免两种原始分数尺度不一致的问题。

例如：

```json
{
  "channels": [
    { "channel": "vector", "rank": 3, "score": 0.84 },
    { "channel": "keyword", "rank": 1, "score": 0.72 },
    { "channel": "fused", "rank": 1, "score": 0.0322 }
  ],
  "finalRank": 1,
  "finalScore": 0.0322,
  "selected": true
}
```

`fused` 通道记录所有候选融合后的顺序。`finalRank` 只对真正被选择的候选编号，因此融合排名和最终上下文排名可以区分。

## 阈值策略

配置项：

```text
RAG_MIN_VECTOR_SCORE
RAG_MIN_KEYWORD_SCORE
```

两个阈值默认均为未配置状态，不使用主观魔法数字。规则是：

- 只对已经配置阈值的通道进行最低分判断；
- 未配置阈值的通道不阻止候选通过；
- 多通道候选任一可信通道通过即可保留；
- 低于已配置阈值时记录 `below_score_threshold`。

真实 baseline 和 hybrid 报告完成后，再根据可回答召回率与不可回答拒答率校准阈值。

## 候选选择顺序

候选按照 fused rank 依次执行：

```text
最低分数阈值
  -> 内容 Hash 去重
  -> 同文档相邻 chunk 过滤
  -> 单文档 chunk 配额
  -> RAG Token Budget
  -> TopK
```

过滤原因：

```text
below_score_threshold
duplicate_chunk
adjacent_chunk
document_quota_exceeded
token_budget_exceeded
top_k_limit
```

完全重复优先使用入库 metadata 中的 SHA-256 `contentHash`，旧数据没有 Hash 时在运行时根据规范化内容计算。

相邻过滤只比较已经入选的同文档 chunk。默认距离为 1，可设为 0 关闭。它减少大量连续重复片段，但可能损失跨 chunk 连续上下文，因此需要在真实评测后确认是否保留默认值。

## RAG Token Budget

默认最终片段预算为 4000 个估算 Token：

```text
RAG_CONTEXT_TOKEN_BUDGET=4000
```

候选优先使用入库保存的 `tokenCount`，旧数据缺失时按字符数估算。超过预算的候选不进入最终上下文，并记录 `token_budget_exceeded`。

Selection Trace 示例：

```json
{
  "rrfK": 60,
  "requestedTopK": 5,
  "selectedCount": 4,
  "maxChunksPerDocument": 2,
  "adjacentChunkDistance": 1,
  "tokenBudget": 4000,
  "selectedTokens": 932
}
```

只有配置过的 score threshold 才会出现在 Trace 中。

## API 与策略

调试接口支持：

```json
{
  "query": "AGENT_TIMEOUT 是什么？",
  "topK": 5,
  "strategy": "hybrid_rrf",
  "rewriteMode": "auto",
  "history": []
}
```

策略语义：

- `vector_baseline`：纯向量、直接 selected，用于原始对照；
- `dual_recall`：只保存两路原始候选，不融合、不选择；
- `hybrid_rrf`：Query Rewrite、双路召回、RRF 和选择管线完整执行。

正式聊天与 `knowledge_search` 当前仍使用 `vector_baseline`。只有真实报告证明 hybrid 策略收益且阈值完成校准后，才切换正式链路。

2026-07-27 更新：正式 `knowledge_search` 已接入同一 Retrieval Trace 管线，并通过 `RAG_TOOL_RETRIEVAL_STRATEGY` 在 `vector_baseline` 与 `hybrid_rrf` 之间选择。真实评测显示 Hybrid 的整体 Hit@5、MRR 与 vector baseline 相同，但 P95 增加 181ms，因此默认仍为 `vector_baseline`；需要演示双路召回和 RRF 时可显式配置 `hybrid_rrf`。这表示 Hybrid 已进入正式链路，但不会在没有收益证据时强制成为默认策略。

正式工具输出新增：

```json
{
  "code": "OK",
  "query": "它如何重放？",
  "effectiveQuery": "Flow-Chat SSE 如何通过 afterSeq 重放事件？",
  "knowledgeBaseId": "...",
  "sources": [],
  "retrievalTrace": {}
}
```

没有任何候选通过选择管线时，`code` 为 `NO_RELIABLE_CONTEXT`。Agent 系统规则要求此时明确说明缺少可靠依据并请求补充信息，不能继续猜测。由于真实评测没有得到可泛化的最低分阈值，当前结构化拒答只覆盖“零入选候选”，不能把所有弱相关问题可靠识别为不可回答。

## 评测 CLI

纯向量：

```bash
RAG_EVAL_STRATEGY='vector_baseline' pnpm eval:rag
```

完整混合策略：

```bash
RAG_EVAL_STRATEGY='hybrid_rrf' pnpm eval:rag
```

Hybrid 模式会把评测 case 中的受限历史传给 Query Rewrite，并只评估经过融合与过滤后 `selected=true` 的候选。`dual_recall` 没有最终选择语义，因此不允许作为正式评测策略。

## 配置

```text
RAG_RRF_K                       默认 60，范围 1..1000
RAG_MIN_VECTOR_SCORE            默认未配置，允许 -1..1
RAG_MIN_KEYWORD_SCORE           默认未配置，允许 0..1000
RAG_MAX_CHUNKS_PER_DOCUMENT     默认 2，范围 1..10
RAG_ADJACENT_CHUNK_DISTANCE     默认 1，范围 0..5
RAG_CONTEXT_TOKEN_BUDGET        默认 4000，范围 256..16000
RAG_TOOL_RETRIEVAL_STRATEGY     默认 vector_baseline，可选 hybrid_rrf
```

## 兼容性与安全

- 没有新增数据库字段；
- 仍先执行知识库所有权校验；
- 不修改原始 vector/keyword score；
- 双路召回失败降级逻辑保持不变；
- 筛选只作用于当前请求内的候选，不删除数据库 chunk；
- 评测报告可能包含完整 fixture 内容，不应对私有知识库报告公开传播。

## 验证

已完成：

- TypeScript 语法转译检查；
- Retrieval Contract 与评测 Runner 独立类型检查；
- RetrievalFusionService 独立类型检查和 RRF 运行 smoke test；
- 纯 Runner smoke test；
- `git diff --check`；
- 新增测试覆盖双通道 RRF 优先、重复内容、相邻 chunk、文档配额、Token Budget、TopK、可选阈值和 KnowledgeService hybrid 接入。

2026-07-25 初始实现时未执行（后续结果见下方 2026-07-27 更新）：

- 项目 Jest 与 Nest build；
- PostgreSQL + pgvector + GIN 的完整 hybrid 请求；
- vector baseline 与 hybrid RRF 的真实指标对比。

当时原因是该电脑缺少 `AI-Chat-Be/node_modules`。这些测试、构建和真实指标后来已在可运行环境完成，结果保存在 `2026-07-26-real-environment-validation-report.md`。

## 已知限制与下一步（2026-07-27 更新）

原下一步执行结果：

1. [x] 完成真实 vector/hybrid 对比报告。阈值网格已校准，结论是保持两个生产阈值未配置，避免对单个样本过拟合；
2. [x] 无入选候选时返回结构化 `NO_RELIABLE_CONTEXT`；
3. [x] 将 `hybrid_rrf` 以可配置方式接入正式 `knowledge_search` 和回答引用，依据指标继续默认 `vector_baseline`；
4. [x] Context Builder 为最终 RAG 片段使用独立 `RAG_CONTEXT_TOKEN_BUDGET`，送回模型时剥离候选诊断信息，只保留最终选中片段；
5. [x] 前端 Agent Trace 展示 Rewrite、通道状态、候选排名、RRF、Token、过滤原因和最终选择，并通过已有 `agentSteps` JSON 在刷新后恢复；
6. [x] 真实报告中最终过滤原因只有 `top_k_limit`，没有连续上下文失败证据，因此相邻距离继续保持可配置默认值 1，不额外收紧；
7. [x] Hybrid 没有提升整体质量且尾延迟更高，当前不增加 MMR、cross-encoder 或 LLM reranker。

本次实现验证：

- 后端全量 Jest：25 suites、94 tests passed；
- 后端 Nest build：passed；
- 后端 `tsc --noEmit -p tsconfig.build.json`：passed；
- 前端 PC 与 Plug build：passed；
- PC `tsc --noEmit -p packages/ai-chat-pc/tsconfig.app.json`：passed。

仍需真实页面验收：

- 浏览器点击停止生成并观察 Agent Trace 的中断状态；
- 使用 `RAG_TOOL_RETRIEVAL_STRATEGY=hybrid_rrf` 运行一轮真实知识库对话，确认检索解释面板的折叠、候选展示与刷新恢复；
- 如未来扩充不可回答评测集并出现稳定分数分界，再重新评估生产阈值；
- 点击引用定位标题路径、PDF 页码或原始 chunk 预览仍属于后续产品增强。
