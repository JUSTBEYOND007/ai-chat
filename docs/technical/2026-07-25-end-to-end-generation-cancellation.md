# 端到端生成取消与竞态控制

## 背景与目标

此前前端“停止生成”只关闭 EventSource，浏览器不再接收内容，但 NestJS 仍会继续调用模型、执行工具和检索，最终还可能把消息保存为 `completed`。这既浪费模型资源，也会造成 UI 状态与服务端真实状态不一致。

本轮把停止生成升级为真正的端到端取消：前端、取消 API、generation 生命周期、Agent Runner、模型、工具与知识库检索共享同一次取消语义。

截至本轮，秋招 Agentic RAG 主路线的估算完成度约为 **74%**。迭代 1～5 已完成；迭代 6～8 的代码链路基本完成，但真实评测指标仍需在另一台具备运行环境的电脑生成；迭代 9 的代码实现完成，真实端到端验证待运行环境补齐；异步入库和指标驱动缓存尚未开始。

## 本轮范围

已实现：

- 前端发送消息前生成 UUID v4 `generationId`；
- SSE 从连接建立时就按 `generationId` 隔离事件；
- SSE 建立前校验当前用户拥有目标 chat；
- 服务端保存 generation 的 chat/user 归属、AbortController 和终态；
- 新增带所有权校验的幂等取消 API；
- AbortSignal 传入 Agent Runner、OpenAI-compatible 模型、普通多模态模型、Tool Executor、Query Rewrite 和知识库检索；
- 取消后停止继续发送 chunk，保留已经生成的文本；
- 消息持久化区分 `completed`、`failed`、`cancelled` 和 `timed_out`；
- SSE 新增 `cancelled` 终态事件；
- 前端将运行中的 Agent Step 标为 cancelled，并保留“重新生成”入口；
- generation 终止后立即释放 Controller，SSE 重放缓存五分钟后清理；
- 增加用户取消、重复取消、越权取消、完成后取消和父级 AbortSignal 测试。

本轮不包含：

- 数据库级 SQL 查询硬中断。TypeORM 当前的 `DataSource.query` 不直接暴露 PostgreSQL cancel handle，因此检索会在 embedding/SQL 返回后立即检查 Signal 并阻止后续处理；
- 对已经进入 `completed` 终态的回复进行撤销；
- 跨进程 generation 注册表。当前注册表在单个 NestJS 进程内，水平扩容时需要迁移到 Redis 或使用固定会话路由；
- BullMQ 文档入库任务取消，这属于迭代 10。

## 协议变更

### 发送消息

请求仍为：

```http
POST /chat/sendMessage
```

新增可选字段：

```json
{
  "id": "chat-uuid",
  "message": "请解释这个错误",
  "generationId": "11111111-1111-4111-8111-111111111111"
}
```

前端必须在建立 SSE 和发送消息之前创建同一个 `generationId`。这样即使模型尚未返回首个 chunk，停止按钮也已经知道要取消的服务端任务。

后端仍兼容没有传 `generationId` 的旧客户端，此时由服务端生成 UUID。

### 取消生成

```http
POST /chat/:chatId/generations/:generationId/cancel
Authorization: <JWT>
```

首次取消正在运行的 generation：

```json
{
  "msg": "生成已取消",
  "data": {
    "generationId": "11111111-1111-4111-8111-111111111111",
    "status": "cancelled",
    "alreadyTerminal": false
  }
}
```

重复取消或完成后取消不会再次触发 Abort：

```json
{
  "msg": "生成已处于终态",
  "data": {
    "generationId": "11111111-1111-4111-8111-111111111111",
    "status": "cancelled",
    "alreadyTerminal": true
  }
}
```

取消接口先验证当前用户拥有 chat，再验证 generation 的 `chatId` 和 `userId`，越权或不存在统一返回 404。SSE 订阅也在返回事件流前执行相同的 chat 所有权校验。

### SSE 终态

新增取消事件：

```json
{
  "type": "cancelled",
  "generationId": "11111111-1111-4111-8111-111111111111",
  "seq": 8,
  "timestamp": 1784980000000,
  "content": "已经生成的部分回答",
  "isComplete": true,
  "agentSteps": []
}
```

失败事件新增 `code`，超时使用 `AGENT_TIMEOUT`，普通执行失败使用 `GENERATION_FAILED`。

## Generation 状态机

```text
running
  ├─ 正常完成 ─────> completed
  ├─ 用户取消 ─────> cancelled
  ├─ Agent 总超时 ─> timed_out
  └─ 其他异常 ─────> failed
```

终态行为：

- `completed`：允许发送 complete SSE，并保存 completed 消息；
- `cancelled`：禁止后续 chunk/complete，保存部分文本并发送 cancelled SSE；
- `timed_out`：保存 timed_out 消息并发送带 `AGENT_TIMEOUT` 的 error SSE；
- `failed`：保存 failed 消息并发送普通 error SSE。

Controller 只在 `running` 时存在。进入任一终态后将 Controller 引用清空；事件缓存保留五分钟用于断流重放，然后从内存删除。

## 竞态处理

### cancel 与 complete 同时到达

服务端通过 `transitionGeneration` 只允许 `running` 原子式进入一个终态。JavaScript 单线程事件循环保证同一进程内状态写入有明确先后：

- cancel 先写入 `cancelled`：完成路径无法再转为 completed；
- complete 先写入 `completed`：后到的取消返回 `alreadyTerminal: true`，不撤销完成结果。

前端以取消 API 返回的服务端终态为准。如果服务端已经 completed，前端不会把消息强制改成 interrupted。

### 取消请求早于 generation 注册

SSE 和发送请求并行发起时，极端情况下取消请求可能先到达后端。前端会以 120ms 间隔最多重试三次取消接口，覆盖这一短暂注册窗口。

### SSE 连接隔离

旧实现按 chat 订阅 Subject，重连时虽然能按 generation 重放，但实时事件仍可能混入同一 chat 的其他 generation。本轮实时订阅也按 `generationId` 过滤，为重新生成和并发请求提供明确边界。

## AbortSignal 传播

```text
Chat generation AbortController
  -> AgentRunner child controller
     -> OpenAI-compatible Agent model
     -> ToolExecutor child controller
        -> knowledge_search
           -> Query Rewrite
           -> embedding / vector search / keyword search 边界检查
  -> 普通文件/视觉模型流式请求
```

Agent Runner 将父级取消映射为 `AGENT_CANCELLED`，不再当成 `AGENT_EXECUTION_FAILED`。Tool Executor 继续使用 `TOOL_ABORTED` 表达工具级取消。

会话摘要刷新只在 generation 已经 completed 后触发，所以用户取消 running generation 时不会启动新的摘要模型调用。取消发生在历史/摘要数据库读取期间时，读取结束后会立即通过 generation 状态检查退出。

## 前端行为

- 创建 assistant 占位消息前生成 generationId；
- 用同一个 generationId 建立 SSE、发送消息和调用取消接口；
- 停止时先请求服务端取消，再关闭本地 SSE；
- 收到 cancelled 或取消 API 成功后保留已渲染文本；
- 将 running planning/tool/answer Step 标为 cancelled；
- complete 已经胜出时不覆盖为 interrupted；
- 切换会话只关闭当前页面连接，不主动取消原会话后端任务。

## 数据兼容性

`message.status` 的 TypeORM enum 新增：

```text
cancelled
timed_out
```

当前项目启用 `synchronize: true`，开发数据库启动时由 TypeORM 同步 enum。正式部署前应关闭 synchronize，并补一份显式 PostgreSQL migration，避免生产环境自动改表。

历史前端映射把所有非 completed 助手消息展示为 interrupted，因此旧的 failed 数据和新的 cancelled/timed_out 数据都可兼容显示。

## 验证情况

已执行：

- `git diff --check`，通过；
- 使用 TypeScript `transpileModule` 对 25 个修改后的 TS/TSX 文件做语法检查，通过。

新增但本机未执行的测试：

- ChatService：运行中取消与 cancelled 持久化；
- ChatService：cancelled SSE 可重放；
- ChatService：重复取消幂等；
- ChatService：越权取消返回 404；
- ChatService：完成后取消返回 completed 终态；
- ChatService：Agent 超时持久化为 timed_out；
- AgentRunner：父级 AbortSignal 映射为 `AGENT_CANCELLED`；
- Query Rewrite：父级取消不会被降级为普通 fallback。

未执行 Jest、Nest build 和前端完整 build。后端 `node_modules` 不存在；前端 pnpm 依赖目录不完整，`pnpm run build` 仍被 pnpm store SQLite `unable to open database file` 阻断，并尝试访问当前不可用的 npm 镜像。不能据此声称类型构建和真实模型取消已经通过。

## 后续验证建议

在可运行电脑上至少验证：

1. Agent 正在等待模型时点击停止，模型 HTTP 请求被 Abort；
2. knowledge_search 执行时点击停止，Tool Executor 返回 TOOL_ABORTED；
3. 停止后不再出现 answer_chunk，也不会保存 completed 助手消息；
4. 连续点击停止只产生一次真实 Abort；
5. 回复刚完成时点击停止，页面最终保持 completed；
6. 使用其他用户 JWT 取消 generation 返回 404；
7. 用 cancelled generationId 重连 SSE，只重放到 cancelled 终态。

如果未来部署多个后端实例，应把 generation 所有权与终态放入 Redis，并通过实例路由或消息总线把取消指令送到持有 AbortController 的进程。


## Real Environment Validation Update (2026-07-26)

The automated verification and real HTTP/SSE checks are complete.

- Full backend Jest: 25 suites, 90 tests passed.
- Cancellation-focused Jest: 4 suites, 32 tests passed.
- Backend and frontend builds passed.
- Agent cancel API latency: 9.59 ms.
- Stop-to-terminal SSE event: 17.79 ms.
- Additional answer chunks after cancel: 0.
- Persisted status: cancelled; no incorrect completed message.
- Repeated cancel returned cancelled with alreadyTerminal=true.
- Cancel after completion returned completed with alreadyTerminal=true.
- Cross-user cancel returned 404.
- Cancelled generation replay ended in cancelled.
- A three-chunk file stream preserved 29 characters of partial text.
- regenerate=true started a new generation and remained cancellable.
- A test-only 1000 ms timeout persisted timed_out and emitted AGENT_TIMEOUT.

The browser button itself was not independently clicked in an automated browser. The frontend-facing cancellation API and SSE contracts were exercised directly. Detailed evidence is in `2026-07-26-real-environment-validation-report.md`.
