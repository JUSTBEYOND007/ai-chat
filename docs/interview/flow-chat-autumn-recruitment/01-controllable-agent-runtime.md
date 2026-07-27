# 亮点一：从零设计可控 Agent Runtime

## 简历表述

> 从零设计可控 Agent Runtime，基于 OpenAI-compatible Tool Calling 实现 Tool Registry，支持模型真实选择 `knowledge_search` 与 `calculator`，并通过 Zod 校验、最大调用轮数、工具超时、知识库权限隔离及 Agent Step 持久化控制执行风险。

## 30 秒回答

> 我没有直接用 LangChain Agent 黑盒，而是自己抽象了 Tool Registry、Tool Executor、模型适配层和受控循环。模型只负责生成原生 tool call，服务端负责决定工具是否可用、用 Zod 校验参数、控制单工具超时和 Agent 总超时，并限制最多三轮工具调用。所有 tool call、结果、耗时和 Agent Step 都会持久化，因此刷新后还能恢复执行过程。

## 为什么要做“可控” Agent

如果只是把工具定义交给模型并执行，会出现以下风险：

- 模型调用不存在的工具；
- 模型生成不符合 Schema 的参数；
- 工具访问不属于当前用户的知识库；
- 模型收到工具结果后无限重复调用；
- 工具长时间不返回，占用请求资源；
- 页面只能看到最终答案，无法解释中间过程；
- 刷新后工具记录和失败原因丢失。

因此项目把“模型决策”和“系统执行权”分开：模型提出调用请求，服务端验证后才执行。

## 核心架构

```text
AgentRunner
  -> ContextBuilder 生成初始 messages
  -> OpenAICompatibleAgentModel.complete()
       -> content 或 tool_calls
  -> ToolRegistry 查找当前上下文可用工具
  -> ToolExecutor
       -> Zod safeParse
       -> 权限/可用性检查
       -> 子 AbortController
       -> 单工具 timeout
       -> 统一 ToolResult
  -> 工具结果以 role=tool 回填模型
  -> 下一轮模型调用
  -> 最终回答或最大轮数/总超时终止
```

## 代码地图

| 责任 | 代码 |
| --- | --- |
| 工具统一接口与上下文 | [`agent-tool.ts`](../../../AI-Chat-Be/src/agent-runtime/contracts/agent-tool.ts)、[`agent-context.ts`](../../../AI-Chat-Be/src/agent-runtime/contracts/agent-context.ts) |
| 工具注册、查找和上下文过滤 | [`tool-registry.service.ts`](../../../AI-Chat-Be/src/agent-runtime/registry/tool-registry.service.ts) |
| 参数校验、超时和错误归一化 | [`tool-executor.service.ts`](../../../AI-Chat-Be/src/agent-runtime/executor/tool-executor.service.ts) |
| OpenAI-compatible Tool Calling 适配 | [`openai-compatible-agent-model.service.ts`](../../../AI-Chat-Be/src/agent-runtime/adapters/openai-compatible-agent-model.service.ts) |
| 多轮受控循环 | [`agent-runner.service.ts`](../../../AI-Chat-Be/src/agent-runtime/runner/agent-runner.service.ts) |
| 安全计算器 | [`calculator.tool.ts`](../../../AI-Chat-Be/src/agent-runtime/tools/calculator.tool.ts) |
| 知识库检索工具 | [`knowledge-search.tool.ts`](../../../AI-Chat-Be/src/agent-runtime/tools/knowledge-search.tool.ts) |
| Tool Call/Agent Step 持久化 | [`message.entity.ts`](../../../AI-Chat-Be/src/chat/entities/message.entity.ts)、[`chat.service.ts`](../../../AI-Chat-Be/src/chat/chat.service.ts) |

## Tool Registry 如何工作

`ToolRegistry` 内部使用 `Map<string, AnyAgentTool>`：

1. 注册时统一将工具名 `trim + lowerCase`；
2. 拒绝空名称和重复注册；
3. `getAll(context)` 根据工具的 `isAvailable` 动态过滤；
4. 只有过滤后的工具定义才会传给模型。

`knowledge_search` 的可用性取决于服务端是否注入 `knowledgeBaseId`，不是由模型在参数里随意指定。这避免模型通过伪造 ID 跨知识库访问。

## 为什么使用 Zod

每个工具都声明自己的 Schema，例如计算器：

```ts
z.object({
  expression: z.string().trim().min(1).max(200),
})
```

模型适配层通过 `zodFunction` 将同一个 Schema 转成 OpenAI Function Definition；执行时 `ToolExecutor` 再调用 `safeParse`。这样“发给模型的参数说明”和“服务端真正执行的校验规则”来自同一份定义，避免二者漂移。

参数错误不会抛出无结构异常，而是转换为：

```json
{
  "status": "failed",
  "error": {
    "code": "INVALID_TOOL_INPUT",
    "message": "expression: ..."
  }
}
```

## Calculator 为什么不用 eval

`CalculatorTool` 自己实现了递归下降解析器，只接受数字、括号和 `+ - * /`：

- `parseExpression` 处理加减；
- `parseTerm` 处理乘除；
- `parseFactor` 处理正负号和括号；
- `parseNumber` 处理数值；
- 显式检查除零、非法字符和非有限结果。

这样避免 `eval` 或 `Function` 带来的任意代码执行风险。真实验证中模型自主选择了 calculator，计算 `(98765 * 4321) + 17`，结果为 `426763582`，工具耗时 1ms。

## 工具超时和取消

`ToolExecutor` 为每次调用创建子 `AbortController`：

- 父 Agent Signal 取消时，子工具同步取消；
- 工具超过自身 `timeoutMs` 时，子 Controller 被 abort；
- `Promise.race` 在工具执行和 timeout 之间竞争；
- 最终统一映射为 `TOOL_TIMEOUT`、`TOOL_ABORTED` 或 `TOOL_EXECUTION_FAILED`。

这比单纯 `Promise.race` 更完整，因为不仅让上层停止等待，也把 Signal 传进支持取消的工具内部。

## 最大轮数与总超时

`AgentRunner` 有两层保护：

- `AGENT_MAX_TOOL_ROUNDS`：默认 3，范围 1～5；
- `AGENT_TOTAL_TIMEOUT_MS`：默认 45 秒，范围 1～120 秒。

循环中每一轮都可能出现两种结果：

1. 模型没有返回 tool call：生成最终回答；
2. 模型返回 tool call：执行工具，将 assistant/tool 消息回填，再进行下一轮。

超过最大轮数返回 `MAX_TOOL_ROUNDS_EXCEEDED`；总时间超过限制返回 `AGENT_TIMEOUT`。真实环境使用 1000ms 测试配置验证了 `timed_out` 状态持久化。

## OpenAI-compatible 适配中的真实问题

DashScope 第二轮曾返回：

```text
400 Input error. Field required: input.messages.2.content
```

原因是带 `tool_calls` 的 assistant 消息被映射为 `content: null`。修复方式是在适配层转换为：

```ts
content: message.content ?? ''
```

这说明“兼容 OpenAI 协议”不代表不同模型服务行为完全一致，适配层必须承担兼容性修正。

另一个真实结论是：`qwen-long` 能选择工具，但收到结果后可能重复调用；`qwen-plus` 能正常完成第二轮最终回答。因此部署时应明确配置可靠的 Tool Calling 模型。

## Agent Step 为什么要持久化

项目分别保存：

- `toolCalls`：面向结果统计，记录工具名、输入、输出、错误和耗时；
- `agentSteps`：面向执行时间线，记录 planning、tool、answer 的状态变化；
- `sources`：面向知识库引用；
- `contextUsage`：面向上下文预算解释。

这些字段随 assistant message 保存到 PostgreSQL。刷新页面后，前端从消息历史重新构建 Agent Trace，而不是依赖当前内存中的 SSE 状态。

## 测试证据

- [`tool-registry.service.spec.ts`](../../../AI-Chat-Be/src/agent-runtime/registry/tool-registry.service.spec.ts)：重复注册、查找和上下文可用性；
- [`tool-executor.service.spec.ts`](../../../AI-Chat-Be/src/agent-runtime/executor/tool-executor.service.spec.ts)：参数错误、超时、取消和结构化错误；
- [`calculator.tool.spec.ts`](../../../AI-Chat-Be/src/agent-runtime/tools/calculator.tool.spec.ts)：安全表达式解析；
- [`knowledge-search.tool.spec.ts`](../../../AI-Chat-Be/src/agent-runtime/tools/knowledge-search.tool.spec.ts)：知识库必选、结构化无可靠上下文；
- [`agent-runner.service.spec.ts`](../../../AI-Chat-Be/src/agent-runtime/runner/agent-runner.service.spec.ts)：直接回答、多轮工具调用、最大轮数、超时和取消；
- [`openai-compatible-agent-model.service.spec.ts`](../../../AI-Chat-Be/src/agent-runtime/adapters/openai-compatible-agent-model.service.spec.ts)：Tool Calling 消息映射兼容性。

## 高频追问

### 为什么不用 LangChain Agent？

建议回答：

> 不是认为 LangChain 不好，而是这个项目的重点是展示 Agent 执行边界。我希望明确控制工具白名单、权限上下文、事件协议、取消 Signal、最大轮数和持久化格式，因此第一版直接使用原生 OpenAI-compatible Tool Calling。以后如果引入框架，也会保留这些领域层接口，不让业务状态机依赖框架内部对象。

### 模型为什么不能直接传 knowledgeBaseId？

> knowledgeBaseId 是权限上下文，必须由服务端根据用户当前选择注入。模型只提供检索 query 和 topK，服务端再校验知识库归属。否则模型幻觉或提示词注入可能构造其他用户的 ID。

### 如果工具失败怎么办？

> ToolExecutor 返回统一结构化错误并回填给模型。模型可以基于错误向用户解释，而不是让整个请求直接崩溃。取消和总超时属于终态控制，会由 Agent/Chat 状态机处理。

### 最大三轮是否太少？

> 这是风险和能力之间的默认值，不是硬编码不可改。当前只有 calculator 和 knowledge_search，三轮足够覆盖检索、计算和最终回答，同时可以阻止兼容性差的模型重复调用。配置允许在 1～5 之间调整。

## 已知限制

- 当前是单 Agent，不支持多 Agent 协作；
- 工具列表较少，`document_summary` 尚未实现；
- 默认模型需要选择可靠的 Tool Calling 型号；
- 工具结果日志以安全为先，没有完整生产可观测平台；
- Agent 总状态仍由单请求内存对象管理，不是分布式工作流引擎。

## 2 分钟回答模板

> 我把 Agent 拆成模型适配层、Tool Registry、Tool Executor 和 Runner 四层。Registry 只把当前上下文可用的工具交给模型，例如没有选择知识库时不会暴露 knowledge_search。工具 Schema 使用 Zod，既生成 Function Calling 参数定义，也在服务端执行前再次 safeParse。Executor 负责工具白名单、单工具超时、AbortSignal 和错误归一化。Runner 负责最多三轮工具调用和 45 秒总超时，并把 assistant tool_calls、tool result 再回填模型。最终 toolCalls 和 agentSteps 都会随消息持久化。这样模型拥有决策权，但没有越过服务端执行边界。
