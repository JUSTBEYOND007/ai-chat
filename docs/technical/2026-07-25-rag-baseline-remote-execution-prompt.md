# RAG Baseline 远程电脑执行 Prompt

将以下 Prompt 交给另一台已经可以正常启动 Flow-Chat 的电脑上的 AI：

```text
请继续完成 Flow-Chat 项目中尚未完成的“纯向量 RAG baseline 真实评测”。

项目已经可以正常启动，不需要重新分析或配置运行环境。

请按以下步骤直接执行：

1. 阅读：

- AI-Chat-Be/evaluation/README.md
- docs/technical/2026-07-25-rag-evaluation-baseline-and-retrieval-protocol.md

2. 执行测试与构建：

cd AI-Chat-Be

pnpm test -- knowledge/evaluation/rag-evaluation.runner.spec.ts knowledge/knowledge.service.spec.ts --runInBand

pnpm run build

如果发现本次 RAG 评测代码的问题，请直接修复，并同步更新技术文档。

3. 创建一个只用于评测的知识库，并上传以下目录中的全部 6 个文件，保持原文件名：

AI-Chat-Be/evaluation/fixtures/flow-chat/

必须确认：

- 共 6 个文档；
- 全部状态为 indexed；
- 不要混入其他文档。

4. 获取当前登录用户的 JWT 和新知识库的 knowledgeBaseId，然后执行：

RAG_EVAL_API_URL='http://127.0.0.1:3000' \
RAG_EVAL_TOKEN='<当前 JWT>' \
RAG_EVAL_KNOWLEDGE_BASE_ID='<知识库 ID>' \
RAG_EVAL_TOP_K='5' \
pnpm eval:rag

注意：项目当前 Authorization 使用原始 JWT，不要添加 Bearer。

5. 检查生成的真实报告，必须满足：

- totalCases = 26
- completedCases = 26
- failedCases = 0
- strategy = vector_baseline
- topK = 5

记录以下指标：

- Hit@5
- MRR
- Citation document hit rate
- Required keyword coverage
- Unanswerable refusal rate
- Average latency
- P50 latency
- P95 latency

不要修改评测集或 fixture 来提高分数，也不要编造指标。

6. 报告成功后更新：

- docs/technical/2026-07-25-rag-evaluation-baseline-and-retrieval-protocol.md
- docs/technical/2026-07-23-agentic-rag-autumn-recruitment-roadmap.md

将“固化纯向量 baseline Markdown/JSON 报告”标记为完成，并记录真实测试、构建和评测结果。

删除或更新：

AI-Chat-Be/evaluation/reports/vector-baseline-not-run.md

保留 Runner 生成的真实 Markdown 和 JSON 报告。

7. 最后执行：

git diff --check
git status --short

不要提交 .env、JWT、密码或 API Key，也不要自行 commit/push。

最终向我汇报：

- 测试与构建结果；
- 6 个文档的入库状态；
- 26 条评测的完成情况；
- 所有真实评测指标；
- 生成的报告路径；
- 更新的技术文档；
- 发现的问题和下一步建议。
```
