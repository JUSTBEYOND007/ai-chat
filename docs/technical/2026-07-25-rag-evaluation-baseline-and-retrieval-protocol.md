# RAG 评测基线与检索数据协议

日期：2026-07-25

## 背景与目标

项目原有知识库检索直接返回 pgvector TopK 片段，能够完成 RAG 问答，但没有可复现评测集，也没有记录每个候选的排名、通道、过滤原因与阶段耗时。后续如果直接加入 Query Rewrite、全文检索和 RRF，只能凭主观感受描述收益。

本轮目标是保存“纯向量检索”对照组所需的工程基础：稳定评测语料、26 条评测问题、离线 Runner、核心指标，以及可被后续混合检索和 Agent Trace 复用的数据协议。

## 本轮范围

已实现：

- 新增 6 份独立评测语料和 26 条 JSON 评测 case；
- 覆盖普通可回答、不可回答、专有错误码、多文档、历史追问和新旧规则冲突；
- 新增用户归属保护的向量检索调试接口；
- 输出候选排名、向量分数、最终排名、过滤原因占位和阶段耗时；
- 新增纯 TypeScript 评测 Runner；
- 计算 Hit@K、MRR、引用文档命中率、关键词覆盖、不可回答拒答率和延迟；
- 生成包含完整 Trace 的 JSON 报告和便于阅读的 Markdown 报告；
- 新增评测 Runner 和检索 Trace 单元测试。

本轮不包含：

- Query Rewrite、PostgreSQL 全文检索和 RRF；
- 相似度阈值、相邻 chunk 去重、单文档配额和 MMR；
- 回答正确性、忠实度或 LLM-as-a-Judge；
- 前端检索调试面板；
- 未启动依赖环境时伪造一份 baseline 指标。

## 目录与评测数据结构

```text
AI-Chat-Be/evaluation/
  datasets/rag-evaluation.schema.json
  datasets/flow-chat-vector-baseline.json
  fixtures/flow-chat/*.md
  reports/
  run-rag-evaluation.ts
```

评测 case 的核心字段：

```ts
interface RagEvaluationCase {
  id: string;
  category:
    | 'answerable'
    | 'unanswerable'
    | 'exact_term'
    | 'multi_document'
    | 'contextual_followup';
  question: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  expected: {
    answerable: boolean;
    documentFileNames?: string[];
    documentIds?: string[];
    requiredKeywords?: string[];
  };
}
```

预期文档优先使用稳定文件名而不是数据库 UUID，因此同一套 fixture 重新上传后仍可评测。可回答问题必须声明文件名或文档 ID，Runner 启动时会拒绝结构不完整或 ID 重复的数据集。

## 检索协议

`RetrievalTrace` 是后续检索链路的统一协议：

```ts
interface RetrievalTrace {
  version: '1.0';
  strategy: 'vector_baseline' | 'hybrid_rrf';
  knowledgeBaseId: string;
  originalQuery: string;
  effectiveQuery: string;
  rewrittenQuery?: string;
  topK: number;
  candidates: RetrievalCandidate[];
  timings: {
    embeddingMs: number;
    vectorSearchMs: number;
    totalMs: number;
  };
  generatedAt: string;
}
```

每个候选同时保留：

- `channels`：来自 vector、keyword 或 fused 通道的原始排名和分数；
- `finalRank` / `finalScore`：融合和策略处理后的最终结果；
- `selected`：是否进入最终上下文；
- `filterReasons`：阈值、重复 chunk、相邻 chunk 或文档配额等过滤原因；
- 文档、chunk、内容、Token 和 metadata 信息。

本轮策略为 `vector_baseline`，所以每个候选只有 vector 通道、全部 `selected=true`、`filterReasons=[]`。预留字段用于下一轮扩展，不代表混合检索已经完成。

## API 变更

新增接口：

```text
POST /knowledge-bases/:id/retrieval/debug
Authorization: <raw JWT used by the existing guard>
Content-Type: application/json
```

请求：

```json
{
  "query": "SSE 断线后如何恢复？",
  "topK": 5
}
```

代表性响应中的 `data`：

```json
{
  "version": "1.0",
  "strategy": "vector_baseline",
  "knowledgeBaseId": "kb-id",
  "originalQuery": "SSE 断线后如何恢复？",
  "effectiveQuery": "SSE 断线后如何恢复？",
  "topK": 5,
  "candidates": [
    {
      "candidateId": "chunk-id",
      "documentId": "document-id",
      "fileName": "stream-reliability.md",
      "chunkIndex": 0,
      "channels": [{ "channel": "vector", "rank": 1, "score": 0.91 }],
      "finalRank": 1,
      "finalScore": 0.91,
      "selected": true,
      "filterReasons": []
    }
  ],
  "timings": {
    "embeddingMs": 120,
    "vectorSearchMs": 8,
    "totalMs": 128
  }
}
```

接口沿用控制器级 JWT Guard，并在检索前校验 `knowledgeBaseId + userId + isActive`，不能调试其他用户的知识库。响应包含完整 chunk 内容，只适合作为已登录用户的开发/可观测接口；生成的 JSON 报告也不应公开私有文档内容。

## Runner 与指标

Runner 通过 HTTP 调用上述接口，避免单独启动一套 Nest Application Context 和重复初始化数据库模块。运行配置：

```bash
RAG_EVAL_TOKEN='<raw-jwt>' \
RAG_EVAL_KNOWLEDGE_BASE_ID='<knowledge-base-id>' \
pnpm eval:rag
```

指标定义：

- Hit@K：可回答 case 的 TopK 是否至少命中一个预期文档；
- MRR：第一个预期文档排名倒数的均值；
- 引用文档命中率：每个 case 的预期文档召回比例均值；
- Required Keyword Coverage：召回内容对指定错误码/专有词的覆盖率，仅用于诊断；
- 不可回答拒答率：不可回答 case 是否返回零个 selected 候选；
- latency：后端 embedding 与向量 SQL 的总耗时，不包含 CLI 网络耗时。

纯向量检索没有阈值，只要知识库非空通常就会返回 TopK。因此不可回答拒答率可能接近 0，这不是 Runner 错误，而是下一轮校准阈值的对照依据。

## 关键实现决策

### 使用独立 fixture，不依赖个人文档

如果评测问题绑定开发者本地上传的文件，其他人无法复现结果。独立 fixture 固定事实和文件名，也专门保留一份废弃的 10 MB 草案，与当前 20 MB 规则形成冲突场景。

### 基线追问故意只使用当前问题

`contextual_followup` case 保存了 history，但纯向量 Provider 只发送 `question`。这会暴露“那它”“这个条件”等省略表达的召回缺陷，下一轮 Query Rewrite 才有可信对照。

### 单 case 失败不终止整批评测

Runner 捕获每个 case 的接口失败并记录 `failed`，继续执行剩余 case。报告区分 total、completed 和 failed，避免一次网络抖动销毁整批结果，也避免将失败 case 默认为检索未命中。

## 兼容性与数据库影响

- 原 `searchKnowledgeBase()` 对外行为保持不变，内部改为消费统一 Trace 并映射回原 chunk 结构；
- SQL 只新增读取已有的 `tokenCount`，没有数据库迁移；
- RAG 问答和 `knowledge_search` 工具继续使用同一纯向量检索结果；
- 新协议不会改变现有前端 SSE 和消息持久化格式。

## 验证结果

已完成的静态验证：

- 数据集 JSON 可解析；
- 共 26 条 case：15 条普通可回答、3 条 exact term、2 条多文档、2 条历史追问、4 条不可回答；
- 使用 TypeScript 5.7 对 Retrieval Contract、评测类型和 Runner 做独立 `noEmit` 编译，检查通过；
- 将纯 Runner 编译到临时目录并执行 2 条 smoke case，Hit@K、拒答率与平均延迟计算符合预期；
- 执行 `git diff --check`（最终变更检查见本轮交付结果）。

未执行：

- Jest、TypeScript build 和真实 baseline 运行。

原因：当前 `AI-Chat-Be/node_modules` 不存在；此前依赖安装受 pnpm store SQLite `unable to open database file` 环境问题限制，且本轮未获得可用的依赖下载环境。真实 baseline 还需要 PostgreSQL/pgvector、embedding API、运行中的后端、已上传 fixture 的专用知识库和有效 JWT。

因此 `evaluation/reports/vector-baseline-not-run.md` 明确标记为未运行，没有编造指标。环境可用后应提交 Runner 自动生成的 Markdown 与 JSON，才可将路线中的“纯向量 baseline 报告”标记完成。

## 已知限制与下一步

1. 下一轮实现按需 Query Rewrite，并让历史追问 case 使用 history；
2. PostgreSQL `tsvector` 与 pgvector 双路召回写入 `channels`；
3. 用 RRF 生成 fused 排名，再根据本评测集校准阈值；
4. 增加相邻 chunk 去重和单文档配额，将原因写入 `filterReasons`；
5. 将 RetrievalTrace 接入现有 Agent Trace 折叠面板；
6. 环境可运行后保存 TopK=3/5/10 的真实基线，选定后续固定对照参数。
