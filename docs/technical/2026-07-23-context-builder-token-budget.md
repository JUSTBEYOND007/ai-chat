# Context Builder 与 Token Budget

日期：2026-07-23

## 背景与目标

在本次修改前，正式聊天进入 Agent Runner 后只会向模型发送系统提示词和当前用户问题。数据库虽然保存了历史消息，但模型无法理解“它还有哪些优点”“继续解释第二点”等依赖上文的追问；如果未来直接把全部历史消息拼接进模型，又会出现上下文无限增长、跨知识库答案污染和大工具结果挤占窗口的问题。

本轮新增统一 `AgentContextBuilder`，目标是：

- 将最近的有效会话历史带入 Agent 模型请求；
- 用可配置 Token 预算限制上下文增长；
- 优先保留最近消息，并对临界的长消息做截断；
- 隔离其他知识库生成的历史助手答案；
- 限制工具结果回填模型时的体积；
- 将上下文使用情况通过 SSE、数据库和 Agent Trace 暴露出来。

## 本轮范围

本轮包含：

- 后端历史消息加载、规范化和 Context Builder；
- 中英文混合文本的启发式 Token 估算；
- 最近消息数量上限和输入 Token 预算；
- 历史消息去重、失败消息过滤、当前消息排除和知识库隔离；
- 超长历史消息和工具结果的有界截断；
- `contextUsage` SSE 传输、消息持久化和前端展示；
- Context Builder、Runner 和 ChatService 聚焦单元测试。

本轮明确不包含：

- 历史摘要的生成、更新和持久化；
- 精确对齐具体模型 tokenizer 的计费 Token 统计；
- RAG 检索片段在 Context Builder 内的二次预算分配；
- 清除记忆、关闭记忆和会话级记忆设置；
- 上传文件多模态链路的上下文迁移。

## 调用链路

```text
ChatService
  -> 查询最近 50 条 completed 消息
  -> 映射为 AgentHistoryMessage
  -> AgentRunner.run(history)
  -> AgentContextBuilder
       -> 排序 / 去重 / 过滤 / 知识库隔离
       -> 最近消息数量限制
       -> Token 估算与预算裁剪
       -> system + history + current user
  -> 模型 Tool Calling 循环
  -> contextUsage 随 generation_start / complete 返回
  -> Message.contextUsage 持久化
  -> Agent Trace 展示预算占用
```

历史查询固定先取最近 50 条已完成消息，真正进入模型的数量由 `AGENT_MAX_HISTORY_MESSAGES` 和 Token Budget 再次约束。查询发生在保存本次新用户消息之前；重新生成场景还会根据 `messageId` 或 `clientMessageId` 排除当前问题，避免同一问题被重复送入模型。

## 数据结构变更

### AgentHistoryMessage

新增内部历史消息协议：

```ts
interface AgentHistoryMessage {
  id: string
  clientMessageId?: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  status: 'completed' | 'failed'
  knowledgeBaseId?: string
  toolCalls?: Array<{
    name: string
    status: 'completed' | 'failed'
    resultCount?: number
  }>
}
```

这里只保留构建上下文所需的最小字段。历史工具调用不会把完整参数和输出再次复制进 prompt，只追加工具名、状态和结果数等紧凑摘要。

### contextUsage

`generation_start`、`complete`、Agent 运行结果和消息实体新增：

```ts
interface AgentContextUsage {
  inputBudgetTokens: number
  responseReserveTokens: number
  estimatedInputTokens: number
  systemTokens: number
  currentMessageTokens: number
  historyTokens: number
  includedHistoryMessages: number
  droppedHistoryMessages: number
  truncatedHistoryMessages: number
  toolResultBudgetTokens: number
  usedSummary: boolean
  overBudget: boolean
}
```

前端在 Agent Trace 顶部展示本次估算输入 Token、预算上限、实际使用历史条数，以及被丢弃或截断的条数。刷新页面后，数据从消息历史的 `contextUsage` 字段恢复。

### 数据库

`Message` 新增可空 JSON 字段：

```text
contextUsage json nullable
```

旧消息没有该字段时前端保持兼容，不展示上下文预算信息。项目当前仍启用 TypeORM `synchronize: true`，开发环境启动时会自动同步字段；正式环境应在后续关闭 synchronize 前补充 migration。本轮没有生成正式 migration。

## 配置

```env
AGENT_CONTEXT_TOKEN_BUDGET=12000
AGENT_RESPONSE_TOKEN_RESERVE=2000
AGENT_MAX_HISTORY_MESSAGES=20
AGENT_TOOL_RESULT_TOKEN_BUDGET=2000
```

配置边界：

| 配置 | 默认值 | 允许范围 | 作用 |
| --- | ---: | ---: | --- |
| `AGENT_CONTEXT_TOKEN_BUDGET` | 12000 | 2000-64000 | 系统提示词、历史消息和当前问题的估算输入预算 |
| `AGENT_RESPONSE_TOKEN_RESERVE` | 2000 | 500-16000 | 为回答预留的记录值，供后续模型窗口策略使用 |
| `AGENT_MAX_HISTORY_MESSAGES` | 20 | 0-50 | 最多进入预算选择的历史消息数 |
| `AGENT_TOOL_RESULT_TOKEN_BUDGET` | 2000 | 256-8000 | 单个工具结果回填模型时的估算 Token 上限 |

`AGENT_RESPONSE_TOKEN_RESERVE` 本轮先进入运行元数据，尚未直接修改模型的 `max_tokens` 参数；下一步接入模型能力配置时，应保证输入预算与回答预留不超过实际模型上下文窗口。

## Token 估算策略

当前采用无外部依赖的启发式估算：

- 汉字、日文假名和韩文字符按约 1 Token 计算；
- 其他非空白字符按约 4 字符 1 Token 计算；
- 空白字符按较低比例计入；
- 每条消息增加固定协议开销。

这不是供应商账单级精确值，优点是无需为每个模型加载 tokenizer，且能稳定用于窗口裁剪和前端解释。`contextUsage` 中统一使用“estimated”语义，不能将其描述为真实计费 Token。

## 选择与过滤策略

Context Builder 执行以下规则：

1. 按 `createdAt` 排序，并以 `clientMessageId` 或消息 ID 去重，保留较新的重复项；
2. 排除失败消息、空消息和本次正在重新生成的用户消息；
3. 用户消息可以保留；助手消息若携带知识库 ID，只允许在当前选择同一知识库时进入上下文；
4. 先应用最大历史消息数，超限时保留最近消息；
5. 再从新到旧分配 Token 预算，最后恢复为时间正序发送给模型；
6. 临界的最近长消息在剩余预算允许时保留前部预览并标注截断；其余无法容纳的消息被丢弃；
7. 系统提示词和当前用户问题属于必选项；若二者本身超过预算，设置 `overBudget=true`，不静默截断用户当前问题。

知识库隔离只过滤“其他知识库生成的助手结论”，不会删除用户自己说过的话。这样既避免跨知识库引用污染，又能保留用户意图的连续性。

## 工具结果预算

Agent 每轮工具执行后仍需把结果作为 `tool` 消息返回模型。现在会先估算序列化结果：

- 未超过预算：返回原结构化 JSON；
- 超过预算：返回合法 JSON 包装，包含状态、`truncated=true`、原始估算 Token 和有界 preview；
- 截断后仍保持 JSON 可解析，模型可以明确知道结果不完整。

数据库和前端 Trace 仍保存完整工具执行结果；预算只作用于再次发送给模型的上下文，避免影响可观测性和引用展示。

## 兼容性与安全影响

- 旧消息的 `contextUsage` 可为空，前端兼容。
- 现有 `generationId + seq` 重放协议不变，只扩展事件字段。
- 上传文件且未选择知识库时继续走旧多模态链路，不改变其行为。
- 只查询当前 ChatService 已完成所有权校验的会话历史。
- 不将历史完整工具输出重复拼入 prompt，降低敏感数据和大对象扩散风险。
- 不允许其他知识库生成的助手答案进入当前知识库上下文。

## 验证方式与结果

新增或扩展的测试覆盖：

- 历史消息按时间正序进入模型；
- 重复、失败和其他知识库助手消息被过滤；
- 超出历史条数时保留最近消息；
- 长历史消息按预算截断，估算输入不超过预算；
- 大工具结果被压缩为有界、合法的结构化 preview；
- ChatService 查询已完成历史并传入 Runner；
- `contextUsage` 随完整事件返回并持久化。

本轮执行环境中前后端依赖目录不完整，且 pnpm 在访问本机 store 时持续出现 `ERR_SQLITE_ERROR: unable to open database file`。尝试通过授权流程访问工作区外依赖存储时，审批服务返回 403，命令未实际启动。因此 Jest、TypeScript build 和前端 build 未能完成运行验证；已执行 `git diff --check` 且结果通过，只有仓库既有的 LF/CRLF 提示。依赖环境恢复后应优先执行：

```bash
cd AI-Chat-Be
pnpm test -- agent-context-builder.service.spec.ts agent-runner.service.spec.ts chat.service.spec.ts --runInBand
pnpm build

cd ../AI-Chat
pnpm --filter @ai-chat/pc build
```

## 已知限制与下一步

- Summary Memory 已在后续迭代接入，具体设计见 `2026-07-23-summary-memory.md`。
- Token 估算不是模型 tokenizer 的精确结果。
- RAG 片段仍由 `knowledge_search` 工具内部决定，本轮只限制整个工具结果回填体积。
- `responseReserveTokens` 尚未约束模型输出参数。
- 前端目前展示上下文总览，还没有可展开查看“具体选中了哪些历史消息”的调试面板。

下一步建议补充会话记忆状态、清除和关闭接口，并将摘要更新迁移为可恢复的异步任务。


## Real Environment Validation Update (2026-07-26)

Real multi-turn context measurements were collected with synthetic prompts.

| Turn | estimatedInputTokens | includedHistoryMessages | historyTokens | summaryTokens | usedSummary |
|---|---:|---:|---:|---:|---|
| 1 | 219 | 0 | 0 | 0 | false |
| 2 | 260 | 2 | 43 | 0 | false |
| 3 | 297 | 4 | 79 | 0 | false |
| 4 | 367 | 2 | 37 | 106 | true |

All turns reported overBudget=false, with no dropped or truncated history. The fourth turn retained recent messages while using the persisted summary. Full backend Jest and build passed.
