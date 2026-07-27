# 亮点五：端到端取消与 SSE 可靠性

## 简历表述

> 打通模型、工具、Query Rewrite 和检索的端到端取消链路，通过 `generationId + seq + afterSeq` 实现 SSE 去重与断流重放，支持幂等取消、越权保护、部分文本保留及终态持久化，停止到 `cancelled` SSE 延迟约 17.79ms。

## 30 秒回答

> 以前前端关闭 EventSource 只能停止显示，服务端模型和工具仍会继续执行。我为每次生成建立 generationId 和服务端 AbortController 注册表，取消接口校验 chat/user 归属后触发同一 Signal，并把它贯穿 Agent、模型、工具、Query Rewrite 和检索。所有 SSE 事件带递增 seq，重连时通过 afterSeq 只补发缺失事件。取消会保存部分文本和 Agent Step，并区分 cancelled、timed_out 和 failed。真实验证中停止到 cancelled SSE 约 17.79ms。

## 为什么“关闭 SSE”不等于取消生成

只执行 `eventSource.close()` 会发生：

- 浏览器不再接收内容；
- 服务端模型请求继续消耗 Token；
- 工具和检索继续占用资源；
- 服务端可能把消息保存为 completed；
- 用户重新生成后，旧 generation 仍可能写入事件；
- 刷新页面看到的状态与用户认知不一致。

真正的取消必须由服务端拥有最终状态，并将 Signal 传播到所有可取消环节。

## Generation 生命周期

ChatService 使用 `Map<generationId, StreamGenerationCache>` 保存：

```ts
{
  chatId,
  userId,
  generationId,
  events,
  status,
  controller
}
```

状态包括：

```text
running
completed
failed
timed_out
cancelled
```

每个 generation 同时绑定 chatId 和 userId，取消与重放都必须验证归属。

## generationId 为什么由前端预生成

前端在发送消息前生成 UUID，并同时用于：

1. 建立 SSE 连接；
2. 发送消息请求；
3. 调用取消接口；
4. 重连和事件归并。

如果 generationId 只能等发送接口返回，SSE 建连和快速点击停止之间会出现身份空窗。预生成可以让一次用户操作从开始就拥有稳定关联 ID。

对应代码：

- [`AIRichInput/index.tsx`](../../../AI-Chat/packages/ai-chat-pc/src/components/AIRichInput/index.tsx)；
- [`send-message.dto.ts`](../../../AI-Chat-Be/src/chat/dto/send-message.dto.ts)。

## SSE 事件可靠性

每个事件包含：

- `generationId`：属于哪一次生成；
- `seq`：generation 内严格递增序号；
- `timestamp`：事件时间；
- 具体事件数据。

结构化事件包括：

```text
generation_start
planning
tool_start
tool_result
answer_chunk
complete
cancelled
error
```

后端 [`chat.service.ts`](../../../AI-Chat-Be/src/chat/chat.service.ts) 在发事件前统一增加 seq，并将事件放入 generation 的 bounded replay cache。

## afterSeq 如何重放

重连请求携带：

```text
generationId=<id>&afterSeq=<lastSeq>
```

后端只补发：

```ts
event.seq > afterSeq
```

并过滤其他 generation 的事件。前端 [`StreamChatClient`](../../../AI-Chat/packages/ai-chat-pc/src/utils/streamChatClient.ts) 保存 `lastSeq`，网络错误时用同一 generationId 和 afterSeq 重连。

即使服务端或网络重复发送，前端也会丢弃：

```ts
data.seq <= lastSeq
```

## 端到端 AbortSignal 传播

```text
POST cancel
  -> StreamGenerationCache.controller.abort()
  -> AgentRunner parent signal
      -> OpenAI model request signal
      -> ToolExecutor child signal
          -> knowledge_search
              -> Query Rewrite signal
              -> vector/keyword retrieval cancellation checks
      -> Agent cancellation Promise
  -> ChatService 保存 cancelled 终态
```

关键代码：

- Generation 注册与取消：[`chat.service.ts`](../../../AI-Chat-Be/src/chat/chat.service.ts)；
- 取消 API：[`chat.controller.ts`](../../../AI-Chat-Be/src/chat/chat.controller.ts)；
- Agent 总取消：[`agent-runner.service.ts`](../../../AI-Chat-Be/src/agent-runtime/runner/agent-runner.service.ts)；
- 工具子 Signal：[`tool-executor.service.ts`](../../../AI-Chat-Be/src/agent-runtime/executor/tool-executor.service.ts)；
- Query Rewrite：[`query-rewrite.service.ts`](../../../AI-Chat-Be/src/knowledge/query-rewrite.service.ts)；
- 检索检查：[`knowledge.service.ts`](../../../AI-Chat-Be/src/knowledge/knowledge.service.ts)。

模型 HTTP 请求和支持 Signal 的工具可以被实际 abort。TypeORM `DataSource.query` 当前不暴露 PostgreSQL cancel handle，因此 SQL 不能硬中断，但 SQL/embedding 返回后会立即检查 Signal，不再执行融合、回答或 completed 写入。

## 取消接口为什么要幂等

用户可能重复点击停止，或者 cancel 与 complete 同时到达。

接口行为：

- running：设置 cancelled 并 abort，`alreadyTerminal=false`；
- 已 cancelled：返回 cancelled，`alreadyTerminal=true`；
- 已 completed：返回 completed，`alreadyTerminal=true`；
- 已 failed/timed_out：返回对应终态；
- generation 不属于当前用户/chat：404。

幂等让前端不需要猜测第一次取消是否成功，也避免重复取消改变终态。

## complete/cancel 竞态

`transitionGeneration` 只有在状态仍为 running 时才能切换到 completed：

```text
if status !== running -> transition failed
```

取消接口先把状态改为 cancelled，再 abort Controller。即使模型结果几乎同时返回，ChatService 在写 complete 前再次检查状态；如果已取消，就不会发送 complete 或保存 completed 消息。

服务端终态是最终事实，前端根据 cancel API 返回的 completed/cancelled/failed/timed_out 分别处理。

## 部分文本为什么要保留

用户停止生成不意味着之前内容无价值。ChatService 累积 `fullContent`：

- 取消前已经收到的 chunk 保留；
- 取消后禁止继续追加；
- assistant message 以 cancelled 状态落库；
- 页面提示“已保留当前内容，可重新生成”。

真实文件流式取消保留了 29 个字符，并验证取消后额外 answer_chunk 为 0。

## 前端停止流程

[`AIRichInput.stopGeneration`](../../../AI-Chat/packages/ai-chat-pc/src/components/AIRichInput/index.tsx) 的主要逻辑：

1. 获取 active chatId 和 generationId；
2. 最多尝试三次取消 API，每次间隔 120ms；
3. 根据服务端返回终态处理；
4. completed 不错误标记为取消；
5. timed_out/failed 显示对应错误；
6. cancelled 中断未完成 Agent Step；
7. 取消 API 失败时才退化为本地停止接收，并明确警告。

这比“先关 SSE 再请求取消”可靠，因为先关闭连接可能丢失服务端终态。

## timed_out 与 failed 为什么要区分

- `failed`：模型/工具或系统发生普通异常；
- `timed_out`：Agent 超过总执行时间；
- `cancelled`：用户主动停止。

三者对用户提示、监控、重试策略和数据分析含义不同，不能都保存成 failed。

真实验证使用 `AGENT_TOTAL_TIMEOUT_MS=1000`，约 1046ms 后返回 `AGENT_TIMEOUT`，数据库状态为 timed_out。

## 真实验证结果

- Cancel API 延迟：9.59ms；
- 点击停止到 cancelled SSE：17.79ms；
- 取消后额外 answer_chunk：0；
- 重复取消：cancelled + alreadyTerminal=true；
- 完成后取消：completed + alreadyTerminal=true；
- 越权取消：404；
- cancelled generation 重连仍以 cancelled 结束；
- 部分文本长度：29 字符；
- regenerate=true 可以启动新 generation；
- 1000ms 测试超时正确保存为 timed_out。

Calculator generation 的 seq 为 1～9，`afterSeq=5` 重连只补发 6、7、8、9，没有重复或其他 generation 事件。

## 测试证据

- [`chat.service.spec.ts`](../../../AI-Chat-Be/src/chat/chat.service.spec.ts)：generation 生命周期、重放、取消、幂等、越权、完成后取消、部分结果与状态持久化；
- [`agent-runner.service.spec.ts`](../../../AI-Chat-Be/src/agent-runtime/runner/agent-runner.service.spec.ts)：Agent cancel/timeout；
- [`tool-executor.service.spec.ts`](../../../AI-Chat-Be/src/agent-runtime/executor/tool-executor.service.spec.ts)：工具取消；
- [`query-rewrite.service.spec.ts`](../../../AI-Chat-Be/src/knowledge/query-rewrite.service.spec.ts)：父 Signal 不会被错误降级为 Rewrite fallback；
- [端到端取消技术文档](../../technical/2026-07-25-end-to-end-generation-cancellation.md)。

## 高频追问

### 为什么不直接关闭 EventSource？

> EventSource 只是下行连接，关闭它不会终止服务端模型和工具。真正取消必须由服务端 Controller 传播 Signal，并控制最终持久化状态。

### SSE 断线后为什么不使用 Last-Event-ID？

> 当前协议使用业务层 `generationId + seq + afterSeq`，便于同时隔离 generation、做 JSON 事件去重并与持久化 Step ID 对齐。也可以扩展标准 Last-Event-ID，但业务序号仍然需要。

### 多实例部署怎么办？

> 当前 replay cache 是单进程 Map，重启或负载均衡到其他实例后无法恢复。生产化应迁移到 Redis Stream 或持久化事件表，并让 generation ownership 在多实例间可发现。

### SQL 为什么不能马上中断？

> 当前 TypeORM query 没有暴露 PostgreSQL cancel handle，所以只能在 embedding/SQL 返回后检查 Signal 并阻止后续处理。如果需要数据库级硬取消，应使用可访问底层连接 PID/cancel API 的实现。

## 2 分钟回答模板

> 项目早期停止按钮只关闭前端 SSE，服务端仍会继续生成。后来我让前端预生成 generationId，服务端为每个 generation 保存 chat/user 归属、AbortController、事件缓存和终态。取消接口先校验用户权限，再把状态切成 cancelled 并 abort。这个 Signal 会经过 AgentRunner 传到 OpenAI 请求、ToolExecutor、Query Rewrite 和检索。所有 SSE 事件还带递增 seq，前端断线后用 afterSeq 只补发缺失事件，并过滤重复 seq。取消时保存已经生成的部分文本，但不会继续写 answer_chunk 或 completed。真实测试中停止到 cancelled SSE 约 17.79ms。

## 已知限制

- SSE replay cache 是单进程内存 Map，保留约 5 分钟；
- 服务重启或多实例切换后不能继续重放；
- PostgreSQL 查询没有数据库级硬取消；
- 浏览器按钮尚需在最终演示环境做一次完整人工验收；
- 没有生产级分布式 generation registry 和监控告警。
