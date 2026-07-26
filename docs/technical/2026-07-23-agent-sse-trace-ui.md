# 结构化 Agent SSE 与 Trace UI

日期：2026-07-23  
状态：代码与后端聚焦测试已完成，等待依赖环境恢复后执行构建、测试和浏览器验证

## 背景与目标

受控 Agent Loop 已经可以自主调用 `calculator` 和 `knowledge_search`，但上一轮只在 Agent 完成后发送一个答案 `chunk`。用户无法看到模型正在规划、哪个工具正在运行、工具是否失败，也无法在刷新后恢复完整执行过程。

本轮目标是把 Agent 内部运行状态转换成稳定、可重放、可持久化的事件协议，并在前端实现 Agent Trace 时间线。

## 功能范围

已实现：

- 结构化 Agent SSE 事件联合类型；
- Runner 事件观察回调；
- ChatService 统一序号、缓存和断流重放；
- Agent Step JSON 持久化；
- 前端 Agent 事件解析、去重和状态归并；
- 可折叠的 Agent Trace 时间线；
- 工具参数、输出、错误和耗时展示；
- 知识库命中数量与引用片段展示；
- 用户中断与执行错误状态区分；
- 刷新后从服务端消息历史恢复 Trace。

本轮不包含：

- 模型最终回答逐 Token 原生流式输出；
- Tool Calling 参数的增量流式拼接；
- 工具失败后的前端一键重试；
- 由前端停止按钮真正取消服务端 Agent 计算；
- 多轮历史上下文和 Token Budget。

## SSE 事件协议

所有事件由 ChatService 统一补充：

```ts
{
  generationId: string;
  seq: number;
  timestamp: number;
}
```

事件及用途如下：

| 事件 | 核心字段 | 前端行为 |
| --- | --- | --- |
| `generation_start` | `availableTools` | 记录本次生成批次与可用工具 |
| `planning` | `round`, `status` | 新增“正在分析”步骤 |
| `tool_start` | `round`, `toolCallId`, `toolName`, `input` | 建立运行中的工具步骤 |
| `tool_result` | `round`, `result` | 根据 `toolCallId` 完成或失败对应工具步骤 |
| `answer_chunk` | `content` | 写入回答缓冲区并完成当前规划步骤 |
| `complete` | `content`, `toolCalls`, `agentSteps`, `sources` | 用服务端最终状态覆盖实时临时状态 |
| `error` | `content` | 结束连接并将运行中步骤标记为失败 |

旧的文件/图片多模态链路仍可以发送 `chunk`，前端同时兼容 `chunk` 和 `answer_chunk`。

## 后端职责划分

```text
AgentRunner
  产生领域事件和 timestamp
        |
        v
ChatService
  增加 generationId/seq
  缓存 StreamEventPayload
  推送 SSE
  保存 agentSteps
```

Runner 不维护 SSE 序号，也不知道客户端是否重连。ChatService 是唯一的序号分配者，保证同一 generation 内 `seq` 单调递增。

事件观察回调由 Runner 安全调用。如果观察者自身抛出异常，Runner 会忽略该异常，避免日志或 SSE 推送问题破坏工具执行和最终回答。

## Agent Runner 事件时序

无工具调用：

```text
generation_start -> planning -> answer_chunk -> complete
```

一次工具调用：

```text
generation_start
  -> planning
  -> tool_start
  -> tool_result
  -> planning
  -> answer_chunk
  -> complete
```

同一轮多个工具仍通过 `Promise.all` 并行执行。`tool_start` 按模型请求顺序发出，`tool_result` 按实际完成时间发出，因此前端不能依赖数组位置配对，必须使用 `toolCallId`。

## 断流恢复与幂等

现有恢复参数保持不变：

```text
GET /chat/getChat/:chatId?generationId=...&afterSeq=...
```

处理顺序：

1. StreamChatClient 先记录 `generationId`；
2. 收到 `seq <= lastSeq` 的事件直接忽略；
3. 重连时携带最后成功处理的 `afterSeq`；
4. ChatService 从 generation 内存缓存重放遗漏事件；
5. 前端使用稳定 `stepId` 或 `toolCallId` upsert，而不是盲目追加。

因此即使连接边界发生重复投递，也不会重复创建工具卡片。

当前 generation 缓存仍是单进程内存 Map。服务重启或多实例负载均衡后无法重放，后续如需要生产级恢复，应迁移到 Redis Stream 或持久化事件表。

## 消息持久化变化

Message 实体新增可空 JSON 字段：

```ts
agentSteps?: MessageAgentStep[];
```

每个 Step 保存：

- `stepId/type/status/round`；
- 开始、结束和耗时；
- `toolCallId/toolName`；
- 工具输入、输出或结构化错误；
- 可读状态说明。

项目当前仍使用 TypeORM `synchronize: true`，启动时会尝试自动增加字段。本轮没有手写 migration；在正式部署前必须将该字段变更转为 migration，这一点仍保留在工程质量 TODO 中。

服务端 `complete` 事件携带最终 `agentSteps`。前端实时步骤只是临时状态，完成时以服务端结果覆盖，从而修正并行工具完成顺序、精确耗时和最终错误信息。

## 前端状态归并

新增纯函数 `reduceAgentSteps()`，负责把单个事件归并为 Agent Step：

- `planning` 使用 `generationId:planning:round` 作为稳定 ID；
- 工具使用 `generationId:tool:toolCallId` 作为稳定 ID；
- `tool_result` 即使早先的 `tool_start` 没有收到，也可以独立创建完整步骤；
- `answer_chunk` 完成当前运行中的 planning，并建立 answer 步骤；
- `complete` 使用持久化步骤覆盖临时步骤。

Zustand 的 `applyAgentEvent(chatId, event)` 始终使用创建连接时捕获的 chatId，不依赖当前选中会话。用户在生成过程中切换会话时，事件仍会写回原会话。

## 中断与错误状态

前端停止按钮关闭 SSE 后，把运行中的步骤标记为：

```text
status = interrupted
error.code = INTERRUPTED
```

发送失败、模型错误或 SSE error 则标记为：

```text
status = failed
error.code = STREAM_ERROR
```

当前停止按钮只停止客户端接收和渲染，不会取消已经提交到服务端的 Agent 计算。真正的端到端取消需要新增 generation cancel API，并把 AbortController 与 generation 生命周期保存在服务端。

## Agent Trace UI

Trace 位于助手回答上方，支持：

- 实时展示分析、工具执行和回答生成；
- 运行中、完成、失败和中断颜色状态；
- 工具名称、执行耗时和知识库命中数量；
- 工具输入、输出和错误通过 `<details>` 默认折叠；
- 输出 JSON 最多预览 2000 字符，防止大结果撑爆页面；
- Agent 完成后保留整个执行过程；
- 历史消息通过 `agentSteps` 恢复相同 Trace。

VirtualChatList 已有 ResizeObserver 监听消息实际高度。Trace 总体展开和工具详情展开都会触发重新测量，因此不需要手工计算动态高度。

## 兼容性

- HTTP API 路径没有变化；
- 文件多模态的旧 `chunk` 事件继续可用；
- 没有 `agentSteps` 的旧消息继续显示原工具 Tag；
- 新消息存在 `agentSteps` 时显示 Trace，避免与旧 Tag 重复；
- 前端 IndexedDB 的 MessageProps 为结构化克隆存储，无需升级数据库版本即可保存新增可选字段。

## 测试与验证

后端测试新增或扩展：

- 普通回答事件顺序；
- 工具调用事件顺序；
- `tool_start` 的 ID、名称和输入；
- ChatService 按 afterSeq 重放 Agent 事件；
- complete 事件和消息历史保存 agentSteps；
- Agent 失败时保存部分运行快照。

实际执行结果：

- `git diff --check`：通过；
- 后端 `pnpm test -- --runInBand agent-runtime chat.service.spec.ts`：未进入 Jest，pnpm 因 `ERR_SQLITE_ERROR: unable to open database file` 失败；
- 前端 `pnpm build`：未进入 TypeScript/Vite，pnpm 因相同 SQLite store 错误失败；
- 浏览器实时 Trace、展开高度和断网恢复：由于依赖与服务未启动，当前未验证。

## 下一步

建议进入多轮上下文管理：

1. Context Builder 统一组合系统提示词、最近历史、工具结果和 RAG 片段；
2. 建立 Token Budget，避免会话历史无限增长；
3. 保存历史摘要并支持长会话追问；
4. 增加上下文调试面板，展示实际进入模型的消息和 Token 估算。

在进入该阶段前，也可以先补 generation cancel API，实现真正的服务端 Agent 取消。


## Real Environment Validation Update (2026-07-26)

Real structured SSE validation passed.

- Calculator generation events used seq 1 through 9 with no gap or duplicate.
- tool_start and tool_result were paired by toolCallId.
- The complete event and persisted message contained toolCalls, agentSteps, and contextUsage.
- Immediate reconnect with generationId and afterSeq=5 replayed only seq 6, 7, 8, and 9.
- Every replayed event belonged to the requested generation.
- Cancelled generation replay ended in cancelled and did not return to streaming or completed.
- A streaming file cancellation produced seq 1 through 4 and preserved partial text.

The browser Trace panel was not independently inspected in an automated browser session. API/SSE history persistence was verified through the real backend.
