# Hybrid RAG 真实评测远程执行 Prompt

将下面的 Prompt 交给另一台已经可以正常启动 Flow-Chat 的电脑上的 AI：

```text
请继续完成 Flow-Chat 的“纯向量 baseline 与 hybrid RRF 真实对比评测”。项目已经可以正常启动，不需要重新配置环境。

1. 拉取最新 main 分支，然后阅读：

- AI-Chat-Be/evaluation/README.md
- docs/technical/2026-07-25-rag-evaluation-baseline-and-retrieval-protocol.md
- docs/technical/2026-07-25-query-rewrite-and-dual-recall.md
- docs/technical/2026-07-25-rrf-threshold-diversity-selection.md

2. 进入 AI-Chat-Be，执行：

pnpm test -- knowledge/query-rewrite.service.spec.ts knowledge/retrieval-fusion.service.spec.ts knowledge/knowledge.service.spec.ts knowledge/evaluation/rag-evaluation.runner.spec.ts --runInBand

pnpm run build

如果发现本轮代码问题，请直接修复，并同步更新技术文档。

3. 使用同一个专用评测知识库，上传并确认以下目录中的 6 个文件全部为 indexed：

AI-Chat-Be/evaluation/fixtures/flow-chat/

知识库中不要混入其他文档，也不要修改 fixture 或 26 条评测集来提高分数。

4. 使用同一个 JWT、knowledgeBaseId 和 TopK=5，先运行纯向量 baseline：

RAG_EVAL_API_URL='http://127.0.0.1:3000' \
RAG_EVAL_TOKEN='<JWT>' \
RAG_EVAL_KNOWLEDGE_BASE_ID='<知识库 ID>' \
RAG_EVAL_TOP_K='5' \
RAG_EVAL_STRATEGY='vector_baseline' \
pnpm eval:rag

5. 确认没有配置 RAG_MIN_VECTOR_SCORE 和 RAG_MIN_KEYWORD_SCORE，然后运行未设置阈值的完整策略：

RAG_EVAL_API_URL='http://127.0.0.1:3000' \
RAG_EVAL_TOKEN='<JWT>' \
RAG_EVAL_KNOWLEDGE_BASE_ID='<知识库 ID>' \
RAG_EVAL_TOP_K='5' \
RAG_EVAL_STRATEGY='hybrid_rrf' \
pnpm eval:rag

两份报告必须满足：

- totalCases = 26
- completedCases = 26
- failedCases = 0
- topK = 5
- strategy 与命令一致

6. 对比并记录：

- Hit@5
- MRR
- Citation document hit rate
- Required keyword coverage
- Unanswerable refusal rate
- Average latency
- P50 latency
- P95 latency
- exact_term 和 contextual_followup case 的变化
- Query Rewrite 的成功、跳过和回退情况
- vector、keyword、fused 候选数量
- duplicate、adjacent、document quota、token budget、topK 各过滤数量

7. 根据真实报告判断是否需要阈值：

- 不要主观填写阈值；
- 根据可回答与不可回答 case 的 vector/keyword 分数分布提出候选值；
- 目标是在尽量保持 Hit@5 和 MRR 的情况下提高不可回答拒答率；
- 如果分数分布无法可靠分开，可以保持阈值未配置，并在文档中说明原因；
- 如果选择了阈值，将其加入本地 src/.env，重启后端，再运行一次 hybrid_rrf，保存最终校准报告；
- 不要提交 .env、JWT、密码或 API Key。

8. 成功后更新：

- docs/technical/2026-07-25-rag-evaluation-baseline-and-retrieval-protocol.md
- docs/technical/2026-07-25-query-rewrite-and-dual-recall.md
- docs/technical/2026-07-25-rrf-threshold-diversity-selection.md
- docs/technical/2026-07-23-agentic-rag-autumn-recruitment-roadmap.md

写入测试、构建、数据库和真实指标；将真实完成的 TODO 标记为完成。纯向量报告成功后删除或更新：

AI-Chat-Be/evaluation/reports/vector-baseline-not-run.md

保留所有真实 Markdown/JSON 报告。

9. 最后执行：

git diff --check
git status --short

不要自行 commit 或 push。

最终向我汇报：测试与构建结果、6 个文档状态、全部真实指标、vector/hybrid 对比结论、阈值是否启用及依据、报告路径、文档修改和仍存在的问题。不能用 smoke test 或模拟数据代替真实评测结果。
```
