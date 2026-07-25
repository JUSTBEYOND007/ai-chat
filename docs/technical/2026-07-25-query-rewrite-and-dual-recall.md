# Query Rewrite 与 PostgreSQL 双路召回

日期：2026-07-25

## 背景与目标

纯 pgvector 检索对语义相近问题有效，但对 `AGENT_TIMEOUT`、`MAX_TOOL_ROUNDS_EXCEEDED`、版本号等精确标识符不稳定；“那它具体如何避免重复消息”等追问又缺少可独立检索的主语。

本轮实现两个基础能力：按需 Query Rewrite，以及 pgvector 语义召回与 PostgreSQL `tsvector` 关键词召回。目标是保存可解释的两路原始候选，为下一轮 RRF、阈值和多样性过滤提供输入。

## 本轮范围

已实现：

- 新增独立 Query Rewrite Service；
- 支持 `never`、`auto`、`always` 三种改写模式；
- 自动识别中英文指代、短追问和省略表达；
- Rewrite 输入限制为最近历史、可选 Summary 和当前问题；
- 模型异常、超时、空输出和显式实体丢失时回退原问题；
- KnowledgeChunk 新增 `tsvector` 字段和 GIN 索引；
- 启动时回填已有 chunk，新增 chunk 与 embedding 同步写入全文向量；
- 提取错误码、版本号、英文技术词和数字单位组成参数化全文查询；
- pgvector 和 keyword 两路并行召回；
- 任一路失败时保留另一通道结果；
- 合并重复 chunk 的通道排名和原始分数；
- RetrievalTrace 新增 Rewrite、通道状态和阶段耗时；
- chunk metadata 新增字符数、SHA-256 内容 Hash 和文档版本时间；
- 新增 Query Rewrite 与双路召回单元测试。

本轮明确不包含：

- RRF 或其他融合排序；
- 最低相关阈值与 `NO_RELIABLE_CONTEXT`；
- 相邻 chunk 去重、单文档配额和 MMR；
- 将双路候选直接接入正式聊天回答；
- 前端检索调试面板；
- Markdown 标题层级切片和 PDF 页码定位；
- 模型 reranker。

## Query Rewrite 设计

### 为什么不是每次调用模型

`auto` 模式只有同时满足“存在最近历史或 Summary”和“当前问题具有指代/省略特征”时才调用模型。完整独立问题直接跳过，减少额外延迟和模型费用。

典型触发表达包括：

- `它、这个、那个、上述、前面、该、其`；
- `那它具体如何……`、`这个条件是多少`；
- `it、this、that、they、previous、above`。

### 输入边界

- 最近历史默认最多 6 条，可通过配置调整；
- 单条历史最多使用 1500 字符；
- Summary 最多使用 2000 字符；
- 输出最大保留 500 字符；
- 不向 Rewrite 模型传入全部会话历史。

### 回退与意图保护

Rewrite Trace 状态：

```ts
type QueryRewriteStatus = 'skipped' | 'rewritten' | 'fallback';
```

原因包括：

```text
disabled
missing_context
not_needed
completed
unchanged
empty_result
intent_guard_rejected
timeout
model_error
```

原问题中存在错误码、带数字的版本标识或显式单位时，改写结果必须保留这些词。例如 `AGENT_TIMEOUT` 被模型删除时，系统不会使用改写结果，而是回退原问题。

## PostgreSQL 全文召回

### 数据字段和索引

`knowledge_chunk` 新增：

```text
searchVector tsvector nullable
```

启动时执行：

```sql
UPDATE knowledge_chunk
SET "searchVector" = to_tsvector('simple', COALESCE(content, ''))
WHERE "searchVector" IS NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_search_vector_gin
ON knowledge_chunk USING GIN ("searchVector");
```

文档入库时，embedding 与 `searchVector` 在同一次 UPDATE 中写入。已有文档不需要重新上传即可获得全文索引。

### 关键词构造

第一版关键词通道主要解决精确技术词：

- 大写错误码和下划线标识符；
- 英文库名、协议名和技术术语；
- 版本号；
- `20 MB` 等数字单位。

系统从有效 query 中提取最多 12 个词，过滤常见英文停用词，再构造 `websearch_to_tsquery('simple', $query)`。SQL 全部参数化，并限制在指定知识库和 `indexed` 文档。

PostgreSQL 内置 `simple` 配置不负责中文分词，因此本轮关键词通道不是通用中文 BM25。中文语义仍主要依赖 pgvector；错误码和技术标识符由全文通道补充。后续如果真实评测证明中文关键词召回不足，再评估 `pg_jieba`、应用层分词或专用搜索服务。

## 双路候选协议

新增策略：

```ts
type RetrievalStrategy =
  | 'vector_baseline'
  | 'dual_recall'
  | 'hybrid_rrf';
```

`dual_recall` 的候选可能只属于 vector、只属于 keyword，或同时属于两个通道：

```json
{
  "candidateId": "chunk-id",
  "channels": [
    { "channel": "vector", "rank": 2, "score": 0.86 },
    { "channel": "keyword", "rank": 1, "score": 0.72 }
  ],
  "selected": false,
  "filterReasons": []
}
```

本轮不计算 `finalRank` 和 `finalScore`，所有双路原始候选均为 `selected=false`。数组展示顺序只用于调试：双通道同时命中的候选优先，其次按各通道最小 rank 排列。它不是 RRF，也不能作为最终上下文顺序。

纯向量策略保持原行为：候选具有 `finalRank`、`finalScore` 且 `selected=true`，因此现有 RAG 和 `knowledge_search` 不受影响。

## API 变更

接口保持：

```text
POST /knowledge-bases/:id/retrieval/debug
```

新增可选参数：

```json
{
  "query": "那它具体如何避免重复消息？",
  "topK": 5,
  "strategy": "dual_recall",
  "rewriteMode": "auto",
  "history": [
    {
      "role": "user",
      "content": "请介绍 Flow-Chat 的 SSE 可靠性设计。"
    },
    {
      "role": "assistant",
      "content": "它使用 generationId、seq 和本地待发送队列。"
    }
  ],
  "summary": "可选的当前作用域会话摘要"
}
```

响应会记录：

- `originalQuery`、`effectiveQuery`、`rewrittenQuery`；
- Rewrite 是否跳过、成功或回退，以及原因和耗时；
- vector/keyword 通道状态、候选上限、实际数量、查询和耗时；
- 每个 chunk 的原始通道排名与分数；
- embedding、向量 SQL、关键词 SQL 和总耗时。

接口继续使用 JWT 与知识库所有权校验。历史和 Summary 只参与当前请求，不写入知识库。

## 配置

```text
DASHSCOPE_QUERY_REWRITE_MODEL          默认回退 DASHSCOPE_AGENT_MODEL / DASHSCOPE_TEXT_MODEL / qwen-plus
RAG_QUERY_REWRITE_TIMEOUT_MS           默认 5000，范围 500..30000
RAG_QUERY_REWRITE_MAX_HISTORY_MESSAGES 默认 6，范围 1..12
RAG_VECTOR_CANDIDATE_LIMIT             默认 10，范围 1..50
RAG_KEYWORD_CANDIDATE_LIMIT            默认 10，范围 1..50
```

双路模式下，每路候选数至少为请求的 `topK`，同时受独立配置控制。

## 兼容性与安全

- 正式聊天、RAG 页面和 Agent `knowledge_search` 仍走 `vector_baseline`；
- 本轮不会因为两路分数尺度不同而直接相加排序；
- Debug 接口先校验用户对知识库的所有权；
- SQL 使用参数绑定，用户 query 不拼接为 SQL；
- Rewrite 输出不能绕过原问题中的显式错误码和版本实体；
- 数据库新增可空列和 GIN 索引，不删除原 embedding 数据。

## 验证

已完成：

- Retrieval Contract 与评测 Runner 使用 TypeScript 5.7 独立 `noEmit` 检查通过；
- `git diff --check` 在最终交付前执行；
- 新增单元测试覆盖：完整问题跳过、指代问题改写、实体丢失回退、模型失败回退、双通道候选合并和单通道失败降级。

未执行：

- 项目 Jest 与 Nest build；
- PostgreSQL GIN 索引和真实 DashScope Rewrite 的运行验证；
- 双路召回对 baseline 的真实指标对比。

原因：当前电脑的 `AI-Chat-Be/node_modules` 不存在。上述验证应在另一台可正常启动项目的电脑完成，并将真实结果补回本文档。

## 已知限制与下一步

1. 实现 RRF，产生确定性的 fused rank 和 score；
2. 扩展评测 Runner，分别报告 vector、keyword、候选并集和 RRF 指标；
3. 根据真实评测校准相似度阈值，不预设魔法数字；
4. 增加相邻 chunk 去重和单文档数量限制；
5. 将选中片段纳入独立 RAG Token Budget；
6. 将 Rewrite 和双路候选接入 Agent Trace 折叠面板；
7. 后续单独完善 Markdown 标题路径和 PDF 页码元数据。
