# PostgreSQL + pgvector + RAG Agent 开发 TODO

## 目标

把当前 AI-Chat 后端从 `MySQL + 普通 AI 对话 + 内存 RAG 雏形` 升级为：

```text
NestJS + PostgreSQL + pgvector + LangChain.js + RAG + Agent + SSE 流式输出
```

最终希望形成一个更容易展示和讲清楚的功能亮点：

```text
智能文档问答助手：支持大文件上传、PDF/文本解析、向量入库、相似度检索、引用溯源、工具调用、多轮记忆和流式回答。
```

## 当前基础

后端已有能力：

- `users`：注册、登录、邮箱验证码、JWT。
- `chat`：会话、消息、SSE 流式对话。
- `file`：大文件分片上传、断点续传、合并到本地 `uploads/`。
- `ai`：DashScope/OpenAI 兼容接口，支持文本模型和图片模型。
- `agent`：诗词、小红书文案、MBTI、RAG 雏形。
- `rag.service.ts`：已有 LangChain、文本切分、embedding、MemoryVectorStore、PDF 解析雏形。

当前主要短板：

- 数据库仍是 MySQL，不适合直接做向量检索亮点。
- RAG 使用内存向量库，服务重启后新增知识会丢。
- Agent/RAG 接口还不够产品化，`rag/test` 里有本机绝对路径测试代码。
- `agent.entity.ts` 有大量重复注释，Agent 模型还没有真正落库。
- 文件上传和 RAG 入库还没有形成完整闭环。

## 阶段 1：数据库从 MySQL 切到 PostgreSQL

目标：先保证原有登录、聊天、文件上传功能在 PostgreSQL 下正常运行。

TODO：

- [ ] 安装 PostgreSQL 驱动：`pg`。
- [ ] 保留或移除 `mysql2`：确认是否还需要 MySQL 兼容。
- [ ] 修改 `app.module.ts` 的 TypeORM 类型：`mysql` -> `postgres`。
- [ ] 修改 `.env` 数据库配置：
  - `DB_HOST=localhost`
  - `DB_PORT=5432`
  - `DB_USERNAME=postgres`
  - `DB_PASSWORD=...`
  - `DB_DATABASE=ai_chat`
- [ ] 修改 `docker-compose.yml`：
  - 删除或暂停 `mysql` 服务。
  - 新增 `postgres` 服务。
  - 保留 `redis` 服务。
- [ ] 新增 PostgreSQL 初始化 SQL，比如创建数据库、启用扩展。
- [ ] 检查实体字段兼容性：
  - `User`
  - `Chat`
  - `Message`
  - `FileEntity`
- [ ] 启动后端，验证 TypeORM 能自动建表。

验收标准：

- [ ] 后端能启动，无数据库连接错误。
- [ ] 用户能注册和登录。
- [ ] 能创建会话。
- [ ] 能发送普通 AI 消息。
- [ ] 能上传文件并合并。
- [ ] 能查询历史消息。

风险点：

- PostgreSQL 对字段类型和大小写更严格。
- TypeORM 的 `enum/json` 字段在 PostgreSQL 下可能需要检查。
- 当前 `synchronize: true` 适合开发期，后续更正式时应该切 TypeORM migration。

## 阶段 2：启用 pgvector

目标：让 PostgreSQL 具备向量存储和相似度检索能力。

TODO：

- [ ] Docker 镜像改为支持 pgvector 的 PostgreSQL 镜像，例如 `pgvector/pgvector:pg16`。
- [ ] 初始化 SQL 中启用扩展：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

- [ ] 确认 DashScope embedding 模型输出维度。
- [ ] 设计向量字段维度，例如：

```sql
embedding vector(1536)
```

- [ ] 写一个最小化测试接口或脚本：
  - 插入一条向量。
  - 查询最近向量。
  - 验证 `<->` 相似度排序可用。

验收标准：

- [ ] PostgreSQL 容器启动后自动启用 `vector` 扩展。
- [ ] 后端可以写入 embedding。
- [ ] 后端可以按相似度检索 topK chunks。

风险点：

- 不同 embedding 模型维度不同，表结构必须和实际维度一致。
- pgvector 查询需要索引优化，否则数据量大后会慢。

## 阶段 3：设计知识库表结构

目标：把文档、切片、向量、引用来源持久化。

建议新增实体：

### KnowledgeBase

用于表示一个知识库。

字段建议：

- `id`
- `userId`
- `name`
- `description`
- `isActive`
- `createdAt`
- `updatedAt`

### KnowledgeDocument

用于表示用户上传的一份文档。

字段建议：

- `id`
- `knowledgeBaseId`
- `fileId`
- `fileName`
- `filePath`
- `mimeType`
- `status`: `pending | parsing | indexed | failed`
- `errorMessage`
- `createdAt`
- `updatedAt`

### KnowledgeChunk

用于表示文档切片和向量。

字段建议：

- `id`
- `documentId`
- `knowledgeBaseId`
- `chunkIndex`
- `content`
- `embedding`
- `tokenCount`
- `metadata`
- `createdAt`

TODO：

- [ ] 新增 `knowledge` 或 `rag` 模块。
- [ ] 新增上面三个实体。
- [ ] 注册到 TypeORM entities。
- [ ] 给 `knowledgeBaseId`、`documentId`、`userId` 加普通索引。
- [ ] 给 `embedding` 加 pgvector 索引，后续可选：

```sql
CREATE INDEX ON knowledge_chunk USING ivfflat (embedding vector_cosine_ops);
```

验收标准：

- [ ] 可以创建知识库。
- [ ] 可以保存文档记录。
- [ ] 可以保存 chunk 和 embedding。
- [ ] 可以根据知识库查询文档列表。

## 阶段 4：文档解析入库

目标：打通“文件上传完成 -> 解析文本 -> 切分 chunk -> embedding -> 入库”。

流程：

```text
前端上传文件
-> file 模块合并文件
-> 调用知识库入库接口
-> 后端解析 PDF/TXT/MD
-> RecursiveCharacterTextSplitter 切分
-> DashScope embedding
-> 保存 chunk + vector
```

TODO：

- [ ] 新增接口：`POST /knowledge-bases`
- [ ] 新增接口：`GET /knowledge-bases`
- [ ] 新增接口：`POST /knowledge-bases/:id/documents`
- [ ] 新增接口：`GET /knowledge-bases/:id/documents`
- [ ] 支持 PDF 文本提取。
- [ ] 支持 TXT/MD 直接读取。
- [ ] 文档入库时维护状态：
  - `pending`
  - `parsing`
  - `indexed`
  - `failed`
- [ ] 入库失败时保存 `errorMessage`。
- [ ] 限制文件大小和文件类型。

验收标准：

- [ ] 用户可以上传一份 PDF 并入库。
- [ ] 数据库能看到 document 和 chunks。
- [ ] 文档状态最终变为 `indexed`。
- [ ] 失败时前端能看到失败原因。

风险点：

- PDF 解析效果不稳定，扫描版 PDF 可能提取不到文本。
- 大 PDF embedding 可能很慢，需要后续考虑异步任务。

## 阶段 5：RAG 问答接口

目标：基于知识库进行检索增强回答，并返回引用来源。

建议接口：

```text
POST /rag/query
```

请求：

```json
{
  "knowledgeBaseId": "xxx",
  "query": "这份文档主要讲了什么？",
  "topK": 5
}
```

响应：

```json
{
  "answer": "模型回答内容",
  "sources": [
    {
      "documentId": "doc_xxx",
      "fileName": "example.pdf",
      "chunkIndex": 3,
      "content": "引用片段...",
      "score": 0.82
    }
  ]
}
```

TODO：

- [ ] 用户问题生成 query embedding。
- [ ] 使用 pgvector 查询 topK chunks。
- [ ] 拼接 RAG prompt。
- [ ] 调用大模型生成回答。
- [ ] 返回 `answer + sources`。
- [ ] 当检索不到内容时，明确回答“知识库中没有找到相关信息”。

验收标准：

- [ ] 能问一份 PDF 的内容。
- [ ] 回答里能体现文档上下文。
- [ ] 响应包含引用来源。
- [ ] 不相关问题不会强行编造答案。

## 阶段 6：RAG 流式回答

目标：把普通 RAG 回答升级成和当前 chat 一样的 SSE 流式输出。

建议接口：

```text
GET /rag/stream/:sessionId
POST /rag/sendMessage
```

或复用现有：

```text
GET /chat/getChat/:id
POST /chat/sendMessage
```

TODO：

- [ ] 确认是复用 `chat` SSE，还是新建 `rag` SSE。
- [ ] 给 RAG 消息增加 `knowledgeBaseId`。
- [ ] 流式输出 chunk。
- [ ] complete 时返回完整 answer 和 sources。
- [ ] 保存 RAG 问答消息。

验收标准：

- [ ] 前端能看到打字机效果。
- [ ] 回答结束后能展示引用来源。
- [ ] 刷新后能看到历史问答。

## 阶段 7：Agent 工具调用

目标：让 Agent 不只是 prompt 模板，而是可以主动使用工具。

第一版建议工具：

- `searchKnowledgeBase`：检索知识库。
- `calculator`：做简单数学计算。
- `summarizeDocument`：总结某份文档。
- `getCurrentTime`：获取当前时间。

Agent 行为：

```text
用户问题
-> LLM 判断是否需要工具
-> 调用 searchKnowledgeBase / calculator / summarizeDocument
-> 汇总工具结果
-> 生成最终回答
```

TODO：

- [ ] 整理 `agent.entity.ts`，删除重复注释，保留干净的 `AgentType` 和实体设计。
- [ ] 在 `AgentService` 中支持 `AgentType.RAG`。
- [ ] 使用 LangChain Tool 封装知识库检索。
- [ ] 加一个 calculator tool。
- [ ] 给 Agent 增加多轮 sessionId。
- [ ] Agent 输出最终回答时携带工具调用记录。

验收标准：

- [ ] 用户问文档内容时，Agent 会调用知识库检索工具。
- [ ] 用户问计算问题时，Agent 会调用 calculator。
- [ ] 返回结果中能看到工具调用 trace。
- [ ] 多轮追问时能记住上下文。

## 阶段 8：多轮记忆与会话融合

目标：把 RAG/Agent 接入现有 chat 会话体系。

TODO：

- [ ] `Message` 表增加可选字段：
  - `agentType`
  - `knowledgeBaseId`
  - `sources`
  - `toolCalls`
  - `status`
- [ ] 支持普通聊天、文档问答、Agent 问答都落到同一套消息表。
- [ ] 最近 N 轮消息作为 short-term memory。
- [ ] 历史消息可选做 summary memory。

验收标准：

- [ ] 同一个会话里可以普通聊天，也可以问知识库。
- [ ] 刷新后消息、引用、工具调用记录还在。
- [ ] 多轮追问能结合上下文。

## 阶段 9：前端功能配合

目标：让后端亮点能被看见。

TODO：

- [ ] 新增知识库页面：
  - 创建知识库
  - 上传文档
  - 查看入库状态
  - 删除文档
- [ ] 对话页支持选择知识库。
- [ ] RAG 回答显示引用来源。
- [ ] Agent 回答显示工具调用过程。
- [ ] 流式输出时保留 Markdown 渲染和代码高亮。
- [ ] 文档入库中显示 loading/progress。

验收标准：

- [ ] 用户能完整体验“上传文档 -> 入库 -> 提问 -> 看引用”。
- [ ] 弱网或刷新后不会丢最终回答。

## 阶段 10：工程质量与安全收口

目标：让项目更像可维护工程，而不是功能堆叠。

TODO：

- [ ] `.env` 中敏感信息不要提交到 Git。
- [ ] JWT secret 改成环境变量。
- [ ] CORS 从 `origin: true` 改成白名单配置。
- [ ] 文件上传增加类型和大小限制。
- [ ] 文件名安全处理，避免路径穿越和重名覆盖。
- [ ] 分片上传幂等处理，避免重复 chunk 导致计数错误。
- [ ] 重要接口加用户权限校验。
- [ ] RAG 入库做错误日志和状态追踪。
- [ ] 补充最小化测试：
  - 登录
  - 创建会话
  - 文件上传
  - 知识库创建
  - RAG 查询

## 推荐开发顺序

建议按这个顺序推进：

```text
1. PostgreSQL 迁移
2. pgvector 启用
3. 知识库表结构
4. 文档解析和 chunk 入库
5. RAG 普通问答
6. RAG SSE 流式问答
7. Agent 工具调用
8. 多轮记忆和引用溯源
9. 前端知识库页面
10. 安全和工程质量收口
```

## 第一阶段最小交付

如果我们希望最快看到成果，第一阶段只做这些：

- [ ] PostgreSQL 替换 MySQL。
- [ ] pgvector 能正常启用。
- [ ] 新建知识库。
- [ ] 上传 TXT/MD 文档入库。
- [ ] 对知识库提问，返回答案和引用。

这个版本完成后，就可以对外讲：

```text
项目已支持基于 PostgreSQL + pgvector 的文档知识库问答，后端使用 LangChain.js 完成文本切分、向量检索和 RAG 回答生成。
```

## 面试表达版本

可以这样讲：

```text
我在原有 AI 聊天系统基础上，升级了一个智能文档问答 Agent。后端从 MySQL 切换到 PostgreSQL，并使用 pgvector 存储文档 embedding。用户上传文档后，系统会解析文本、切分 chunk、调用 embedding 模型生成向量并入库。提问时，后端先进行向量相似度检索，召回相关片段，再通过 LangChain.js 组合上下文调用大模型生成回答，同时返回引用来源。对话结果通过 SSE 流式推送给前端，实现类似 ChatGPT 的打字机效果。
```
