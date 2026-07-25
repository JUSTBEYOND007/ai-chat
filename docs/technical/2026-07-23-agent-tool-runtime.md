# 轻量 Agent Tool Runtime

日期：2026-07-23  
状态：第一轮实现完成，等待依赖环境恢复后执行自动化测试

## 背景与目标

项目已经具备普通聊天、RAG 检索和 SSE 流式回答，但当前的知识库检索仍由业务分支直接决定，并不是模型自主选择工具的 Agent 闭环。

本轮先建设模型调用工具之前的基础运行层，目标是统一回答以下问题：

- 系统允许调用哪些工具；
- 模型生成的参数如何在运行时校验；
- 工具以哪个用户和会话的权限执行；
- 工具超时、取消和业务异常如何表达；
- 工具调用如何获得稳定 ID，供后续 SSE、数据库和前端 Trace 关联。

## 本轮范围

已实现：

- Agent 运行上下文与核心数据协议；
- Tool Registry 注册、查询和工具清单；
- Tool Executor 参数校验、稳定调用 ID、超时、取消和统一结果；
- 不使用 `eval` 的安全 `calculator`；
- 复用现有 pgvector 检索能力的 `knowledge_search`；
- Registry、Executor、计算器、知识检索和知识库越权场景的聚焦测试。

本轮明确不包含：

- 模型 Function Calling / Tool Calling 解析；
- 多轮 Agent Loop；
- Agent SSE 事件和前端 Trace UI；
- `document_summary` 工具；
- 数据库中的 Agent Step 持久化。

## 模块结构

```text
AgentModule
  -> AgentRuntimeModule
       -> ToolRegistrationService
            -> ToolRegistry
                 -> calculator
                 -> knowledge_search

未来 Agent Loop
  -> ToolExecutor
       -> ToolRegistry.get(toolName)
       -> Zod.safeParse(input)
       -> timeout / AbortSignal
       -> tool.execute(input, AgentContext)
       -> AgentToolExecutionResult
```

核心代码位于 `AI-Chat-Be/src/agent-runtime/`：

- `contracts/`：上下文、工具、调用、结果、Step 和 Run 类型；
- `registry/`：工具注册表；
- `executor/`：统一执行边界；
- `tools/`：具体工具；
- `tool-registration.service.ts`：NestJS 模块初始化时注册内置工具。

## 核心协议

### AgentContext

`AgentContext` 由服务端创建，不允许直接采用模型生成的数据：

```ts
interface AgentContext {
  userId: number;
  chatId: string;
  generationId: string;
  messageId?: string;
  clientMessageId?: string;
  knowledgeBaseId?: string;
  signal?: AbortSignal;
}
```

其中 `userId` 应来自 JWT 鉴权结果，`knowledgeBaseId` 应来自当前会话请求。模型只能生成工具参数，不能伪造执行身份。

### AgentTool

每个工具必须声明名称、描述、Zod Schema、可选超时时间和执行函数。TypeScript 泛型提供编译期类型约束，Zod 负责校验模型在运行时生成的不可信 JSON。

### Tool Result

执行结果使用可辨识联合类型：

- 成功：`status: completed`，携带标准化输入、输出、开始/完成时间和耗时；
- 失败：`status: failed`，携带稳定错误码和用户可理解的错误信息。

当前错误码包括：

- `TOOL_NOT_FOUND`；
- `INVALID_TOOL_INPUT`；
- `TOOL_TIMEOUT`；
- `TOOL_ABORTED`；
- `TOOL_EXECUTION_FAILED`；
- `KNOWLEDGE_BASE_REQUIRED`。

如果模型没有提供 `toolCallId`，执行器通过 `randomUUID()` 生成。后续该字段将贯穿 SSE 事件、消息持久化和 Trace UI。

## Tool Registry 与执行器决策

Registry 使用内存 `Map` 管理当前进程内的静态工具：

- 工具名查找忽略首尾空格和大小写；
- 重复工具名在应用初始化阶段直接失败；
- 未注册工具不会进入执行函数；
- `list()` 只暴露名称、描述和超时，不暴露服务实例。

Tool Executor 的顺序固定为：

1. 查找已注册工具；
2. 使用工具自己的 Zod Schema 校验参数；
3. 将请求级 `AbortSignal` 派生到工具级控制器；
4. 通过 `Promise.race` 执行工具超时控制；
5. 将输出或异常转换成统一结果。

超时发生时会主动触发工具的 `AbortSignal`。工具实现仍应主动监听信号并停止底层工作；JavaScript 无法强制终止一个完全忽略取消信号的 Promise。

执行器当前不打印工具输入、上下文或输出，避免把知识库片段、用户问题和凭证写入日志。后续增加可观测性时只记录调用 ID、工具名、状态和耗时等脱敏字段。

## calculator 安全策略

计算器没有使用 `eval`、`Function` 或动态代码执行，而是实现递归下降解析器，只支持：

```text
数字、空格、+、-、*、/、(、)
```

运算规则支持括号、乘除优先级、一元正负号和小数，并拒绝：

- 字母、属性访问和函数调用；
- 除数为零；
- 括号不匹配；
- 多个小数点等无法完整解析的表达式。

表达式长度由 Zod 限制为 1 到 200 个字符，工具超时为 1 秒。

## knowledge_search 权限边界

模型参数只包含：

```ts
{
  query: string;
  topK?: number; // 1 到 10，默认 5
}
```

`knowledgeBaseId` 不属于模型参数，而是由 `AgentContext` 注入。工具调用 `KnowledgeService.searchForTool()` 时同时传入 `userId`，服务会先验证知识库满足：

```text
id = knowledgeBaseId
userId = 当前登录用户
isActive = true
```

只有通过归属验证后才执行 embedding 和 pgvector 查询，从而避免模型通过构造工具参数检索其他用户的知识库。

## API、数据库与兼容性

本轮没有新增 HTTP API、数据库表或字段，也不需要 migration。

`AgentRuntimeModule` 已接入现有 `AgentModule`，但尚未替换正式聊天链路，因此普通聊天和已有 RAG 行为保持不变。下一轮 Agent Loop 可以直接注入 `ToolRegistry` 和 `ToolExecutor`。

## 测试覆盖

新增聚焦测试覆盖：

- Registry 注册、名称归一化、查询、列表和重复注册；
- Executor 成功、参数错误、未知工具、超时、业务错误码和请求预取消；
- Calculator 运算优先级、括号、一元负号、小数和非法表达式；
- Knowledge Search 缺少知识库、正确传递用户权限上下文；
- Knowledge Service 在知识库不属于当前用户时阻止工具检索。

## 验证结果

- `git diff --check`：通过；
- 聚焦 Jest 命令 `pnpm test -- --runInBand agent-runtime`：未进入 Jest，pnpm 在自动检查/安装依赖时因 `ERR_SQLITE_ERROR: unable to open database file` 失败；
- TypeScript build：当前 `AI-Chat-Be/node_modules` 不存在，待 pnpm store 权限与依赖安装环境恢复后执行；
- 真实 pgvector 与模型调用：本轮不进入 Agent Loop，未做运行验证。

在完成自动化测试和真实运行验证前，简历中应描述为“已实现 Agent 工具运行层”，不描述为“已完成模型自主工具调用”。

## 后续进展

受控 Agent Loop 和正式聊天链路接入已在后续迭代完成，详见：[受控 Agent Loop 与正式聊天接入](./2026-07-23-controlled-agent-loop.md)。

该迭代完成了以下计划：

1. 将 Registry 中的 Zod 工具定义适配到 OpenAI-compatible 模型；
2. 解析模型 Tool Calling 并交给 Tool Executor；
3. 工具结果追加回模型上下文，最多执行 3 轮；
4. 设置 Agent 总超时，并处理工具失败后的继续回答；
5. 复用现有消息持久化，保存完整工具调用结果。

结构化 Agent SSE 事件仍属于下一轮范围。
