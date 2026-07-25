# RAG 接入正式聊天 SSE 与历史消息持久化

日期：2026-07-23  
范围：`AI-Chat-Be/src/chat`、`AI-Chat-Be/src/knowledge`、`AI-Chat/packages/ai-chat-pc/src`

## 背景与目标

项目原有的知识库问答页可以返回 RAG 回答和引用来源，但它与正式聊天会话相互独立：回答不是 SSE 流式输出，用户也无法在正常对话中选择知识库，刷新后无法在聊天历史中看到引用和检索过程。

本次修改将 RAG 作为现有聊天发送链路的一个可选模式。普通对话保持原行为；发送时选择知识库后，后端检索对应知识库并通过既有 SSE 通道输出回答，最终将引用和工具记录持久化到消息表。

## 功能范围

- 聊天发送接口支持可选 `knowledgeBaseId`。
- 选择知识库后，复用 `/chat/getChat/:id` 的 SSE 流式通道。
- SSE `complete` 事件携带引用来源和 `knowledge_search` 工具记录。
- 用户消息和助手消息持久化 `knowledgeBaseId`；助手消息持久化 `sources`、`toolCalls`、`status`。
- 历史消息加载后恢复引用卡片和工具调用标签。
- 对话输入区支持选择或清除知识库。
- 聊天流式期间切换会话时，chunk 仍写入原会话，避免写错会话。

本次不包含长期/摘要记忆，也不会把历史轮次拼接进 RAG prompt；每次 RAG 查询仍以当前问题和召回片段生成回答。

## 数据模型

`Message` 实体新增字段：

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `knowledgeBaseId` | nullable UUID | 标识该消息使用的知识库 |
| `sources` | nullable JSON | 助手回答的引用数组 |
| `toolCalls` | nullable JSON | 轻量工具调用记录 |
| `status` | enum | `completed` 或 `failed` |

`sources` 单项结构：

```json
{
  "documentId": "uuid",
  "fileName": "project.md",
  "chunkIndex": 2,
  "content": "引用片段",
  "score": 0.92
}
```

当前开发环境启用 TypeORM `synchronize: true`，启动后会自动补齐字段。生产环境应将该结构变更改为显式 TypeORM migration 后再部署。

## 后端链路

### 发送消息

```http
POST /chat/sendMessage
```

新增请求字段：

```json
{
  "id": "chat-uuid",
  "message": "项目的部署流程是什么？",
  "knowledgeBaseId": "knowledge-base-uuid",
  "clientMessageId": "optional-client-id"
}
```

`knowledgeBaseId` 为空时，继续调用普通 `AiService`。存在时：

1. 验证当前用户拥有聊天会话；
2. 验证当前用户拥有指定知识库；
3. 生成问题 embedding，执行 pgvector 检索；
4. 以检索片段生成 RAG prompt；
5. 通过 LangChain 模型流式输出；
6. 保存助手回答、引用和工具记录。

当知识库没有相关片段时，仍返回流式文本“知识库中没有找到相关信息。”，并保存一个结果数为 0 的 `knowledge_search` 记录。

### SSE 协议

继续使用：

```http
GET /chat/getChat/:chatId?generationId=:generationId&afterSeq=:seq
```

`chunk` 事件格式不变，仍使用 `generationId + seq` 支持断流续传。

RAG 的 `complete` 事件新增可选字段：

```json
{
  "type": "complete",
  "generationId": "uuid",
  "seq": 8,
  "content": "流式回答完整内容",
  "isComplete": true,
  "knowledgeBaseId": "uuid",
  "sources": [],
  "toolCalls": [
    {
      "name": "knowledge_search",
      "status": "completed",
      "query": "用户问题",
      "resultCount": 3
    }
  ]
}
```

普通聊天的 complete 事件不附带这些元数据，因此现有客户端保持兼容。

## 前端交互

输入框上方会加载当前用户的知识库，并提供“知识库模式”下拉选择：

- 不选择：普通模型对话；
- 选择知识库：发送请求携带 `knowledgeBaseId`；
- 清除选择：恢复普通模型对话。

流式客户端读取 complete 元数据，并将其更新到当前助手消息。虚拟消息列表展示：

- `knowledge_search · N sources` 工具标签；
- 文件名、chunk 序号、相似度分数和引用片段；
- 刷新后由消息历史接口恢复相同内容。

离线待发送消息也会保存 `knowledgeBaseId`，网络恢复后的重试仍使用原来的模式。

## 安全与兼容性

- 后端发送聊天前新增会话归属校验，避免跨用户向任意 chatId 写入消息。
- RAG 查询继续使用知识库归属校验。
- 文档与向量检索的文件安全规则沿用知识库模块现有实现。
- 原有普通聊天、文件聊天、SSE 续传参数和客户端重连逻辑不变。

## 验证

已完成静态检查：

```bash
git diff --check
```

结果：通过。

已补充/更新后端聚焦测试覆盖：

- 旧的 clientMessageId 重复发送不会再次调用模型；
- SSE 缓存可按 seq 续传；
- RAG 流式回答不调用普通模型，且助手消息保存 `knowledgeBaseId`、`sources`、`toolCalls` 和 `completed` 状态。

以下验证尚未能实际运行：

```bash
cd AI-Chat-Be
pnpm test -- chat.service.spec.ts knowledge.service.spec.ts --runInBand
pnpm run build

cd ../AI-Chat
pnpm run build
```

原因：当前环境的 pnpm 默认全局缓存目录不可写，依赖下载又受到平台外部访问限制，命令会在 Jest/构建启动前中断。

## 后续建议

1. 在 RAG prompt 中加入受控的最近 N 轮历史消息，形成短期多轮追问能力。
2. 将同步的 embedding/生成操作拆为可观测任务，提供更细的状态与耗时数据。
3. 为消息历史、跨用户权限、SSE complete 元数据和前端流式客户端补充可运行的单元/集成测试。
4. 将轻量 `knowledge_search` 记录扩展为正式 Agent Tool trace，再逐步增加 calculator 等工具。
