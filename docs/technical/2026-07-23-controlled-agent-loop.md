# 受控 Agent Loop 与正式聊天接入

日期：2026-07-23  
状态：代码与聚焦测试已完成，等待后端依赖环境恢复后执行自动化测试和真实模型验证

## 背景与目标

上一轮已经实现 Tool Registry、统一执行器、`calculator` 和 `knowledge_search`，但正式聊天仍使用业务代码判断：选择知识库时强制进入 RAG，否则进入普通聊天。这种分支不属于模型自主工具调用。

本轮目标是形成真正的单 Agent 闭环：

```text
用户问题
  -> 模型判断是否调用工具
  -> 后端校验并执行工具
  -> 工具结果回填模型上下文
  -> 模型继续调用工具或输出最终回答
  -> SSE 返回并持久化回答、引用和工具记录
```

## 本轮范围

已实现：

- OpenAI-compatible 原生 Tool Calling 模型适配层；
- Zod Schema 到模型工具定义的转换；
- 受控多轮 Agent Loop；
- 同轮多工具并行执行；
- 最大工具轮数和 Agent 总超时；
- 上下文相关的工具可用性过滤；
- 工具错误回填模型并允许模型继续回答；
- 正式纯文本聊天与知识库聊天接入 Agent Runner；
- 完整工具调用结果、耗时、知识库引用和消息状态持久化；
- 后端 Agent、适配器和聊天集成聚焦测试。

明确不包含：

- `planning`、`tool_start`、`tool_result` 等结构化 SSE 事件；
- 前端 Agent Trace 时间线；
- 基于历史消息的多轮 Context Builder；
- 文件和图片的 Agent Tool Calling；
- Agent Step 单独建表持久化。

## 架构

```text
ChatService
  |-- 纯文本/知识库消息 --> AgentRunner
  |                         |-- OpenAICompatibleAgentModel
  |                         |-- ToolRegistry.getAll(context)
  |                         `-- ToolExecutor.execute()
  |
  `-- 上传文件消息 -------> 原 AiService 多模态流式链路
```

新增核心文件：

- `agent-runtime/adapters/openai-compatible-agent-model.service.ts`；
- `agent-runtime/runner/agent-runner.service.ts`；
- 对应模型适配和 Runner 单元测试。

## 模型适配层

模型适配层使用项目已有的 OpenAI SDK，调用 OpenAI-compatible `/chat/completions` 接口。模型通过以下顺序选择：

1. `DASHSCOPE_AGENT_MODEL`；
2. `DASHSCOPE_TEXT_MODEL`；
3. 默认 `qwen-plus`。

部署或真实验证时，所选模型必须支持 OpenAI-compatible Tool Calling。该能力与模型版本和服务端配置有关，因此模型名不写死在业务逻辑中。

工具定义使用 `openai/helpers/zod` 的 `zodFunction()` 从已有 Zod Schema 生成 JSON Schema。为了兼容非 OpenAI 服务端，发送前移除 OpenAI Structured Outputs 使用的 `strict` 字段，只保留标准函数名称、描述和参数 Schema。

内部消息协议与供应商消息格式隔离：

- `assistant.toolCalls` 转换为 `assistant.tool_calls`；
- 工具结果转换为带 `tool_call_id` 的 `tool` 消息；
- 模型返回的调用 ID、函数名和 JSON 参数被映射回内部协议。

这样未来替换其他模型供应商时，只需新增 Adapter，不需要修改 Tool Executor 和具体工具。

## Agent Loop

Agent Runner 每轮执行以下步骤：

1. 根据 `AgentContext` 获取当前可用工具；
2. 携带系统提示词、用户问题和工具定义调用模型；
3. 如果模型没有返回工具调用，则把文本作为最终回答；
4. 如果模型返回工具调用，则解析 JSON 参数并交给 Tool Executor；
5. 同轮多个工具通过 `Promise.all` 并行执行；
6. 按模型原始请求顺序将工具结果追加为 `tool` 消息；
7. 进入下一轮，直到模型回答或触发安全限制。

模型参数解析失败不会直接导致 Agent 进程崩溃，而是转换为无法通过 Zod 校验的输入，由 Tool Executor 返回 `INVALID_TOOL_INPUT`。工具执行失败也不会直接中止循环，错误码和错误信息会作为结构化工具结果回填给模型。

## 安全限制

### 最大工具轮数

默认最多执行 3 轮工具调用，可通过以下配置调整：

```text
AGENT_MAX_TOOL_ROUNDS=3
```

代码将配置限制在 1 到 5 之间。完成第 3 轮工具后允许模型再生成一次最终回答；如果模型仍要求调用工具，则抛出 `MAX_TOOL_ROUNDS_EXCEEDED`。

### Agent 总超时

默认总执行时间为 45 秒：

```text
AGENT_TOTAL_TIMEOUT_MS=45000
```

代码将配置限制在 1000 到 120000 毫秒之间。超时后触发统一 `AbortSignal`，同时取消进行中的模型请求和愿意响应取消信号的工具，最终返回 `AGENT_TIMEOUT`。

### 工具可用性

`AgentTool` 新增可选 `isAvailable(context)`：

- `calculator` 始终可用；
- `knowledge_search` 仅在服务端上下文存在 `knowledgeBaseId` 时对模型可见；
- 即使模型伪造不可用工具名，Tool Executor 仍会进行第二次可用性检查并拒绝执行。

工具可见性和执行权限形成两层防护。`knowledge_search` 内部仍会使用 `userId` 校验知识库归属。

## 正式聊天链路变化

`ChatService.useGeminiToChat()` 的路由策略调整为：

- 无上传文件：进入 Agent Runner；
- 选择知识库：进入 Agent Runner，由模型决定是否调用 `knowledge_search`；
- 有上传文件且未选择知识库：保留原 `AiService` 多模态流式处理；
- 文件加载失败导致没有可用文件路径时，回退为文本 Agent 对话。

本轮没有改变 HTTP API：仍使用 `POST /chat/sendMessage` 和 `GET /chat/getChat/:id`。

## SSE 行为

现有 SSE 协议仍为：

```text
chunk -> complete
       或 error
```

Agent Runner 当前使用非流式模型 Tool Calling，以便稳定处理完整的工具参数。因此最终回答会作为一个 `chunk` 事件发送，而不是逐 Token 输出。`generationId + seq` 缓存、重放和前端幂等逻辑保持有效。

这是本轮的明确取舍：先验证 Agent 决策和工具闭环，再在下一轮引入结构化流式协议，避免同时处理 Tool Call 增量参数拼接和前端状态机。

## 消息持久化

`Message.toolCalls` 仍使用现有 JSON 列，不需要数据库 migration。新写入记录增加以下可选字段：

```ts
interface MessageToolCall {
  toolCallId?: string;
  name: string;
  status: 'completed' | 'failed';
  input?: unknown;
  output?: unknown;
  error?: { code: string; message: string };
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  query?: string;
  resultCount?: number;
}
```

旧消息只包含 `name/status/query/resultCount` 时仍可正常读取。前端类型同步扩展，但本轮 UI 仍只展示工具名和知识库命中数量。

`knowledge_search` 成功结果中的 sources 会被提取、按 `documentId + chunkIndex` 去重，并继续写入 `Message.sources`。Agent 或模型执行失败时也会保存一条 `status: failed` 的助手消息，避免历史记录中只有用户消息而没有失败状态。

`AgentRunError` 会携带已经产生的 `steps/toolResults` 部分快照。因此，如果模型在工具执行后异常、总超时或超过轮数，ChatService 仍会把已经发生的工具调用写入失败消息，而不是丢失排障信息。

## 测试覆盖

新增和更新的聚焦测试覆盖：

- 普通消息直接回答，不调用工具；
- 无知识库时不向模型暴露 `knowledge_search`；
- 模型调用 `calculator`，结果回填后生成最终回答；
- 工具失败后把结构化错误回填模型；
- 模型持续调用工具时触发最大轮数限制；
- 模型长时间无响应时触发 Agent 总超时；
- Zod 工具和内部消息正确映射为 OpenAI-compatible 请求；
- 当前上下文不可用的工具不会被执行；
- ChatService 持久化完整工具记录和知识库引用；
- 上传文件继续走原多模态链路；
- Agent 失败后持久化失败助手消息。

## 验证结果

- `git diff --check`：通过；
- 聚焦测试命令 `pnpm test -- --runInBand agent-runtime chat.service.spec.ts`：未进入 Jest，pnpm 在自动检查/安装依赖时因 `ERR_SQLITE_ERROR: unable to open database file` 失败；
- TypeScript build：当前 `AI-Chat-Be/node_modules` 不存在，待 pnpm store 权限与依赖安装环境恢复后执行；
- 真实 Tool Calling：需要可用的模型 API Key、支持 Tool Calling 的模型和 PostgreSQL/pgvector 服务，当前未验证；
- 前端 Trace UI：不属于本轮范围。

在完成真实模型验证前，简历中可以描述“实现受控 Agent Loop 和工具执行边界”，不应描述为“已在生产环境稳定运行”。

## 后续进展

结构化 SSE 与前端 Agent Trace 已在后续迭代完成，详见：[结构化 Agent SSE 与 Trace UI](./2026-07-23-agent-sse-trace-ui.md)。

该迭代已经实现 Runner 事件回调、`generationId + seq` 重放、`toolCallId` 配对、Trace 时间线和历史恢复。Tool Calling 参数的逐 Token 增量拼接仍未实现，当前 Agent 最终回答通过单个 `answer_chunk` 发送。
