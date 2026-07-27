# 亮点二：构建可评测的 RAG 检索链路

## 简历表述

> 构建 pgvector 语义检索、PostgreSQL 全文检索、按需 Query Rewrite、RRF 融合及多样性过滤链路；建立 26 条离线评测集，取得 Hit@5 100%、MRR 0.8788、引用文档命中率 100%，并根据 P95 延迟数据决定保留纯向量默认策略。

## 30 秒回答

> 我先建立 26 条可复现评测集，再实现 Query Rewrite、pgvector 和 PostgreSQL 全文双路召回、RRF 融合、去重、单文档配额和 Token Budget。真实结果显示 Vector 和 Hybrid 的 Hit@5 都是 100%，MRR 都是 0.8788，但 Hybrid P95 从 244ms 增加到 425ms，所以我没有为了技术栈好看强行切换默认策略，而是保留 Vector 默认、Hybrid 可配置。

## 为什么先做评测再做 Hybrid

没有基线时，“检索效果变好了”往往只是主观感受。这个项目先定义统一 `RetrievalTrace` 和评测协议，再实现不同策略，确保它们在同一数据集、同一 TopK 和同一指标下比较。

需要回答的问题包括：

- 精确错误码是否更容易被关键词召回命中？
- Query Rewrite 是否改善指代追问，还是改变用户意图？
- RRF 是否提高期望文档排名？
- 去重和单文档配额是否损失连续上下文？
- 阈值是否提高拒答率，同时损伤可回答问题？
- 质量收益是否值得额外延迟和模型调用成本？

## 检索总流程

```text
当前问题 + 受限历史 + Summary Memory
  -> Query Rewrite（按需执行，失败回退原问题）
  -> vector channel：query embedding + pgvector cosine search
  -> keyword channel：websearch_to_tsquery + ts_rank_cd
  -> 合并相同 chunk 的两路 rank/score
  -> Reciprocal Rank Fusion
  -> 可选分数阈值
  -> 内容重复过滤
  -> 同文档相邻 chunk 过滤
  -> 单文档 chunk 配额
  -> RAG Token Budget
  -> TopK
  -> 最终 sources + 完整 Retrieval Trace
```

## 代码地图

| 责任 | 代码 |
| --- | --- |
| 检索总编排、vector/keyword SQL | [`knowledge.service.ts`](../../../AI-Chat-Be/src/knowledge/knowledge.service.ts) |
| 按需 Query Rewrite | [`query-rewrite.service.ts`](../../../AI-Chat-Be/src/knowledge/query-rewrite.service.ts) |
| RRF、阈值、去重、多样性与预算 | [`retrieval-fusion.service.ts`](../../../AI-Chat-Be/src/knowledge/retrieval-fusion.service.ts) |
| Retrieval 数据协议 | [`retrieval.ts`](../../../AI-Chat-Be/src/knowledge/contracts/retrieval.ts) |
| 评测类型和指标 | [`rag-evaluation.types.ts`](../../../AI-Chat-Be/src/knowledge/evaluation/rag-evaluation.types.ts) |
| 评测 Runner | [`rag-evaluation.runner.ts`](../../../AI-Chat-Be/src/knowledge/evaluation/rag-evaluation.runner.ts) |
| 26 条评测集 | [`flow-chat-vector-baseline.json`](../../../AI-Chat-Be/evaluation/datasets/flow-chat-vector-baseline.json) |
| Vector 报告 | [`vector_baseline...md`](../../../AI-Chat-Be/evaluation/reports/vector_baseline-top5-2026-07-26T12-33-38-160Z.md) |
| Hybrid 报告 | [`hybrid_rrf...md`](../../../AI-Chat-Be/evaluation/reports/hybrid_rrf-top5-2026-07-26T12-35-31-070Z.md) |

## pgvector 语义召回

Query 先通过 DashScope Embedding 模型生成向量，随后执行：

```sql
1 - (kc.embedding <=> $1::vector) AS score
```

并按照 `<=>` 距离升序查询 TopK。SQL 同时限制：

- `knowledgeBaseId`；
- 文档状态必须为 `indexed`；
- embedding 不能为空。

查询前会验证 embedding 维度，避免模型配置变化导致数据库向量运算异常。

语义召回优势是能处理同义表达和自然语言问题，缺点是对错误码、版本号、精确标识符的排序不一定稳定。

## PostgreSQL 全文检索

Chunk 保存 `tsvector` 字段并建立 GIN 索引。关键词通道使用参数化 SQL 和 `websearch_to_tsquery('simple', query)`，通过 `ts_rank_cd` 得到关键词相关度。

选择 PostgreSQL 内置全文检索而不是立即引入 Elasticsearch，原因是：

- 当前数据规模不需要额外搜索集群；
- 与 pgvector 共用数据库，部署和权限边界更简单；
- 适合错误码、英文标识符和技术关键词补充召回；
- 可以先用评测证明收益，再决定是否引入更复杂基础设施。

限制是 `simple` 配置不提供通用中文分词，因此中文语义仍主要依赖向量通道。

## 按需 Query Rewrite

Query Rewrite 不会每次调用模型。`shouldRewrite` 重点识别：

- “它、这个、上述、前面”等中文指代；
- `it/this/that/previous` 等英文指代；
- 短句和明显省略式追问。

Rewrite 输入只包含：

- 当前问题；
- 最近最多 6 条受限历史；
- 当前知识库作用域的 Summary Memory。

输出还需要通过“显式实体保护”：原问题中的错误码、版本、数字和单位必须保留，否则回退原问题。模型超时、异常、空结果或语义保护失败也都会回退，因此 Rewrite 是增强项而不是单点故障。

## 为什么使用 RRF

向量相似度和全文检索分数不在同一尺度，不能直接相加。RRF 只使用排名：

```text
RRF(candidate) = Σ 1 / (k + rank_channel)
```

默认 `k=60`。一个候选同时在 vector 和 keyword 中排名靠前时，会得到更高融合分数。

RRF 的优点：

- 不需要归一化两种异构分数；
- 结果确定、容易测试和解释；
- 不增加模型调用成本；
- 可以保留每个通道的原始 rank/score。

它不是语义 reranker，因此简历中不能说“实现了模型重排序”。

## 候选选择与多样性

融合后按以下顺序筛选：

1. 可选最低分数阈值；
2. 内容 Hash 去重；
3. 同文档相邻 chunk 过滤；
4. 单文档最多进入指定数量片段；
5. RAG Token Budget；
6. TopK。

每个未入选候选都保留明确原因：

```text
below_score_threshold
duplicate_chunk
adjacent_chunk
document_quota_exceeded
token_budget_exceeded
top_k_limit
```

最终 sources 和实际送给模型的片段来自同一批 `selected=true` 候选，避免“页面引用一批、模型实际看到另一批”。

## 26 条评测集如何设计

数据集覆盖：

- 普通可回答问题；
- 4 条不可回答问题；
- 错误码和精确术语；
- 多文档问题；
- 口语化追问和模糊指代；
- 当前规范与过期草案冲突。

每条 Case 记录：

- 问题和可选历史；
- 是否可回答；
- 期望文档名/ID；
- 期望关键词；
- 类别、标签和说明。

## 指标如何计算

### Hit@K

可回答问题中，TopK 是否至少包含一个期望文档。当前 Top5 为 100%。

### MRR

取第一个相关结果排名的倒数，再对所有可回答问题取平均：

```text
rank 1 -> 1.0
rank 2 -> 0.5
rank 3 -> 0.333...
```

当前 MRR 为 0.8788，说明多数期望文档排在第一位，少数排在第二位。

### Citation document hit rate

衡量期望引用文档被召回的比例，当前为 100%。

### Required keyword coverage

检查最终候选文本是否覆盖样本声明的关键术语，当前为 100%。

### Unanswerable refusal rate

不可回答样本中没有选中候选的比例，当前为 0。这是项目必须诚实说明的短板。

### P50/P95 latency

分别表示中位延迟和 95 分位尾延迟。P95 更能反映慢请求体验。

## 真实结果与技术决策

| 指标 | Vector baseline | Hybrid RRF |
| --- | ---: | ---: |
| Completed | 26/26 | 26/26 |
| Hit@5 | 1.0000 | 1.0000 |
| MRR | 0.8788 | 0.8788 |
| Citation hit rate | 1.0000 | 1.0000 |
| Keyword coverage | 1.0000 | 1.0000 |
| Average | 167.15ms | 196.73ms |
| P50 | 146ms | 152ms |
| P95 | 244ms | 425ms |

Hybrid 将一个 exact-term Case 从 rank 2 提升到 rank 1，但把一个 follow-up Case 从 rank 1 降到 rank 2，整体 MRR 没有变化，P95 增加 181ms。

最终决策：

- 正式 `knowledge_search` 支持配置 `hybrid_rrf`；
- 默认继续使用 `vector_baseline`；
- 不启用未经验证的 MMR 或模型 reranker；
- 两个生产最低分阈值保持未配置。

这是本项目最值得讲的工程取舍之一：实现技术能力不等于默认启用技术能力。

## 为什么没有启用阈值

Answerable 和 Unanswerable 的最高 vector score 大量重叠。约 0.133～0.142 的窄区间只能拒绝 1/4 个不可回答样本；提高到 0.145 已经让 Hit@5 降到 0.9545、MRR 降到 0.8333。

因此启用阈值会对单个样本过拟合。当前只在没有任何候选通过选择管线时返回 `NO_RELIABLE_CONTEXT`，不能声称已经解决所有弱相关拒答问题。

## 高频追问

### Hybrid 没提升，做它还有意义吗？

> 有意义。它证明了精确术语双路召回和 RRF 的工程可行性，也建立了统一 Trace 和评测协议。更重要的是，评测告诉我它不适合默认启用。如果没有实现和对比，就无法得到这个结论。

### 为什么不用 BM25/Elasticsearch？

> 当前先使用 PostgreSQL 全文检索降低基础设施复杂度，并用真实指标验证精确词补召回价值。数据量、中文分词需求或搜索分析能力增长后，再评估 Elasticsearch 或 pg_jieba，而不是一开始堆组件。

### 26 条样本是否太少？

> 它足以作为第一版可复现回归集，但不足以证明普遍效果。我会把它描述为工程评测基线，不描述为大规模学术实验。下一步应扩充真实问题分布，尤其是不可回答和连续上下文样本。

### 为什么不可回答拒答率为 0？

> 因为向量最高分区间和可回答问题重叠，简单阈值无法稳定区分。强行设置阈值会损伤 Hit@5 和 MRR，所以我选择保留事实，并将可靠拒答作为后续改进项。

## 2 分钟回答模板

> RAG 部分我没有先做 Hybrid，而是先建立了 26 条评测集和统一 Retrieval Trace。Vector 通道使用 pgvector，Keyword 通道使用 PostgreSQL tsvector/GIN，只有依赖历史的追问才触发 Query Rewrite。两路候选用 RRF 按排名融合，再经过重复内容、相邻 chunk、单文档配额和 Token Budget 选择。真实评测中 Vector 和 Hybrid 的 Hit@5 都是 100%，MRR 都是 0.8788，但 Hybrid P95 从 244ms 增加到 425ms，所以正式工具链虽然支持 Hybrid 配置，默认仍保留 Vector。这个决策体现的是用指标选择方案，而不是为了简历堆技术。

## 已知限制

- 评测集规模只有 26 条；
- 不可回答拒答率仍为 0；
- PostgreSQL `simple` 全文配置不支持通用中文分词；
- 尚未加入 cross-encoder/LLM reranker；
- 没有真实线上流量、成本和缓存命中率数据；
- 点击引用定位 PDF 页码/标题路径仍是后续增强。
