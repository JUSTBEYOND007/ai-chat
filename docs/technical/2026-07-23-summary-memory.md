# Summary Memory 长会话记忆

日期：2026-07-23

## 背景与目标

上一轮 Context Builder 已能将最近历史消息带入模型，并用 Token Budget 限制上下文长度。但当会话继续增长时，较早消息最终会被最近消息窗口淘汰，模型仍会忘记用户长期目标、稳定偏好和未完成事项。

本轮新增 Summary Memory：达到阈值后，将较早消息压缩成可持久化摘要；后续对话同时使用“长期摘要 + 最近消息”，从而在固定预算内维持长会话语义。

目标：

- 较早消息退出最近窗口后，关键事实仍可进入模型；
- 摘要按普通聊天和知识库 ID 隔离，避免跨知识库污染；
- 摘要增量更新，不在每轮重新总结全部历史；
- 摘要生成失败、超时或数据库读取失败时，正常聊天回退到最近消息模式；
- 前端 Agent Trace 能说明本轮是否使用摘要。

## 本轮范围

包含：

- Chat 会话级摘要开关和多作用域摘要快照；
- 达到消息阈值后的自动摘要生成；
- 已有摘要与新增旧消息的增量合并；
- 摘要源文本和摘要结果的 Token 预算；
- 摘要模型调用超时；
- Context Builder 摘要注入和知识库作用域校验；
- `contextUsage` 摘要 Token、摘要消息数和更新时间；
- Agent Trace 摘要使用状态；
- Summary Memory、Context Builder 和 ChatService 测试用例。

不包含：

- 前端清除记忆和关闭记忆入口；
- 摘要内容查看或手工编辑页面；
- 独立异步任务队列；
- 针对供应商 tokenizer 的精确 Token 计算；
- 跨会话或用户画像级长期记忆。

## 数据结构

### Chat 字段

```ts
interface ChatMemorySnapshot {
  scopeKey: string
  content: string
  throughMessageId: string
  summarizedMessageCount: number
  updatedAt: number
  version: number
}
```

`Chat` 新增：

```text
memoryEnabled boolean default true
memorySnapshots json nullable select:false
```

`memorySnapshots` 使用 `select:false`，普通会话列表和详情查询不会默认返回摘要正文。ChatMemoryService 只有在构建模型上下文或更新摘要时才显式读取该字段。

项目当前仍使用 TypeORM `synchronize: true`，开发环境启动时会自动创建字段。本轮未生成正式 migration；关闭 synchronize 前必须补充数据库迁移。

### 摘要作用域

摘要不是单个全局字符串，而是同一会话下的多个快照：

```text
未选择知识库 -> scopeKey = general
选择知识库   -> scopeKey = knowledgeBaseId
```

Context Builder 只接受与当前作用域完全一致的摘要。用户从知识库 A 切换到知识库 B 时，不会把 A 的助手结论作为 B 的长期记忆。

用户消息仍可用于理解持续目标；助手消息只有未绑定知识库或与当前知识库一致时才允许进入该作用域的摘要源。

## 摘要触发与增量更新

成功保存一轮 Agent 回答后，ChatService 调用 ChatMemoryService：

1. 查询最近 50 条 `completed` 消息；
2. 按当前作用域过滤消息并恢复时间正序；
3. 消息数未达到触发阈值时不调用模型；
4. 保留最近若干消息作为原文窗口，只压缩更早消息；
5. 通过 `throughMessageId` 判断摘要覆盖边界；
6. 新增的可压缩消息不足最小批次时延迟更新；
7. 将旧摘要与新增消息交给模型合并；
8. 摘要成功后更新当前作用域快照和版本号。

如果一批可压缩消息超过摘要源 Token Budget，系统只按时间顺序处理当前预算真正容纳的前缀，并将 `throughMessageId` 更新到最后一条实际送入摘要模型的消息，不会跳过未处理消息后错误推进摘要边界。

默认 16 条消息开始摘要，保留最近 8 条原文。摘要首次生成后，至少累计 4 条新的可压缩消息才再次更新，因此通常每两轮对话更新一次，而不是每条消息都额外调用模型。

如果旧摘要边界已经不在最近 50 条查询窗口中，系统仍会把旧摘要作为基础，并合并当前可见的较早消息，不会直接丢弃已有长期记忆。

## Context Builder 策略

模型输入顺序调整为：

```text
主系统提示词
长期摘要系统消息（存在且作用域匹配时）
预算内最近历史消息
当前用户消息
```

优先级：

1. 主系统提示词和当前问题必须保留；
2. 长期摘要优先于普通历史窗口，占用独立上限；
3. 剩余预算分配给最近历史；
4. 最近消息冲突时，以最近消息为准。

摘要通过额外系统消息注入，并明确标注“只用于理解指代和持续偏好”。Context Builder 再次检查 `scopeKey`，即使调用方错误传入其他知识库摘要也不会使用。

当摘要成功进入本轮上下文时，Context Builder 会使用 `throughMessageId` 排除已经被摘要覆盖的旧原文，只保留该边界之后的最近消息，避免重复占用 Token 和重复强化旧表述。如果摘要因作用域或预算原因未被采用，则不会排除原始历史。

## 配置

```env
AGENT_SUMMARY_CONTEXT_TOKEN_BUDGET=1200
AGENT_SUMMARY_TRIGGER_MESSAGES=16
AGENT_SUMMARY_KEEP_RECENT_MESSAGES=8
AGENT_SUMMARY_MIN_NEW_MESSAGES=4
AGENT_SUMMARY_TOKEN_BUDGET=1000
AGENT_SUMMARY_SOURCE_TOKEN_BUDGET=6000
AGENT_SUMMARY_TIMEOUT_MS=15000
```

| 配置 | 默认值 | 范围 | 作用 |
| --- | ---: | ---: | --- |
| `AGENT_SUMMARY_CONTEXT_TOKEN_BUDGET` | 1200 | 128-4000 | 摘要进入正式 Agent 上下文时的上限 |
| `AGENT_SUMMARY_TRIGGER_MESSAGES` | 16 | 6-50 | 开始生成摘要的有效消息数 |
| `AGENT_SUMMARY_KEEP_RECENT_MESSAGES` | 8 | 2-20 | 始终保留为原文的最近消息数 |
| `AGENT_SUMMARY_MIN_NEW_MESSAGES` | 4 | 1-20 | 两次摘要之间最少新增可压缩消息数 |
| `AGENT_SUMMARY_TOKEN_BUDGET` | 1000 | 128-4000 | 持久化摘要结果上限 |
| `AGENT_SUMMARY_SOURCE_TOKEN_BUDGET` | 6000 | 1000-20000 | 单次摘要模型输入文本上限 |
| `AGENT_SUMMARY_TIMEOUT_MS` | 15000 | 1000-60000 | 摘要模型调用超时 |

代码会确保保留的最近消息数至少比触发阈值少 2，避免配置组合导致没有可压缩消息。

## 失败回退

Summary Memory 属于增强能力，不能影响主聊天链路：

- 读取摘要失败：记录 warning，Agent 继续使用最近消息；
- 生成摘要失败或返回空内容：保留旧快照，不写数据库；
- 摘要超时：AbortSignal 取消模型调用并保留旧快照；
- 摘要刷新数据库操作抛错：ChatService 捕获，不把已成功回答改成失败消息；
- 当前没有摘要：`usedSummary=false`，Context Builder 行为与上一轮兼容。

摘要提示词还明确声明：历史对话内的指令只作为待总结数据，不能改变摘要任务，以降低 Prompt Injection 对记忆内容的影响。

## SSE、持久化与前端

`contextUsage` 新增：

```ts
summaryTokens: number
summarizedMessageCount?: number
summaryUpdatedAt?: number
```

并继续使用：

```ts
usedSummary: boolean
```

这些字段随 `generation_start` 和 `complete` 事件传输，并保存到助手消息。Agent Trace 会显示：

```text
历史 8 条 · 已使用 12 条消息的长期摘要
```

刷新页面后，Trace 从消息 `contextUsage` 恢复。本轮不把摘要正文发送到浏览器。

## 验证

新增测试覆盖：

- 达到阈值后生成指定知识库作用域的摘要；
- 只压缩较早消息并保留最近原文窗口；
- 摘要模型失败时不更新数据库；
- 摘要源超出预算时不会把边界推进到未处理消息之后；
- 读取摘要时只返回当前作用域快照；
- Context Builder 将匹配摘要放在最近历史之前；
- Context Builder 排除 `throughMessageId` 之前已被摘要覆盖的旧原文；
- 其他知识库摘要不会进入模型；
- ChatService 将摘要传给 Runner，并在成功回答后触发刷新。

`git diff --check` 已执行。Jest、后端 build 和前端 build 仍受当前环境 pnpm store 的 `ERR_SQLITE_ERROR: unable to open database file` 阻塞；此前授权访问工作区外 store 时审批服务返回 403，因此本轮不能声明运行测试通过。

依赖环境恢复后执行：

```bash
cd AI-Chat-Be
pnpm test -- chat-memory.service.spec.ts agent-context-builder.service.spec.ts agent-runner.service.spec.ts chat.service.spec.ts --runInBand
pnpm build

cd ../AI-Chat
pnpm --filter @ai-chat/pc build
```

## 已知限制与下一步

- 摘要更新目前在成功回答保存后同步触发，SSE complete 已发送，但发送消息 HTTP 请求可能等待摘要模型完成；后续可迁移到 BullMQ 异步任务。
- 每个作用域保存在 Chat JSON 数组中，适合当前项目规模；大量知识库作用域时可拆成独立表。
- 当前无法在 UI 中清除、关闭或查看摘要。
- 当前摘要质量没有离线评测指标。

下一步建议实现“会话记忆控制”：提供查询状态、清除当前作用域摘要和开关记忆 API，并在前端上下文调试面板加入对应入口。


## Real Environment Validation Update (2026-07-26)

Summary Memory was validated with process-only thresholds of 6 trigger messages, 2 recent messages, and 1 minimum new message.

- Turn 4 reported usedSummary=true.
- Context usage reported summaryTokens=106 and summarizedMessageCount=4.
- PostgreSQL contained a general-scope snapshot with version 2.
- The persisted snapshot had summarizedMessageCount=6 and a valid throughMessageId.
- The summary contained the three synthetic conversation markers.
- The public chat query omits memorySnapshots because the column is select:false.

Real summary-generation failure was not induced. Failure tolerance remains covered by automated tests.
