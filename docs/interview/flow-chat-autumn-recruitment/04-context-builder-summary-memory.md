# 亮点四：Context Builder 与分作用域 Summary Memory

## 简历表述

> 设计 Context Builder 与分作用域 Summary Memory，在固定 Token Budget 内组合长期摘要、最近消息和工具结果，支持不同知识库记忆隔离、增量摘要、失败回退及上下文用量可视化。

## 30 秒回答

> 我没有把全部历史消息直接发送给模型，而是实现统一 Context Builder：先放系统提示词和当前问题，再按预算选择当前作用域的摘要和最近历史，超出预算时优先保留最近消息并对临界长消息截断。长会话达到阈值后生成 Summary Memory，用 throughMessageId 做增量边界，并按 general 或 knowledgeBaseId 隔离。摘要失败不会影响主回答，前端还能看到本轮用了多少历史、是否使用摘要和估算 Token。

## 要解决的问题

简单拼接历史消息会带来：

- 对话越长，输入 Token 无上限增长；
- 旧消息最终超过模型窗口；
- 大工具结果挤占上下文；
- 切换知识库后引用旧知识库结论；
- 摘要模型失败导致正常聊天失败；
- 无法解释模型本轮到底看到了多少历史。

因此项目将短期上下文和长期记忆拆开管理。

## Context Builder 输入结构

[`AgentContextBuilder`](../../../AI-Chat-Be/src/agent-runtime/context/agent-context-builder.service.ts) 组合：

```text
System Prompt
  + 当前作用域 Summary Memory（可选）
  + 最近历史消息（预算内）
  + 当前用户问题
```

工具执行后，结构化 Tool Result 再作为 `role=tool` 回填模型。`knowledge_search` 使用独立 RAG Token Budget。

## 默认预算

| 配置 | 默认值 | 用途 |
| --- | ---: | --- |
| `AGENT_CONTEXT_TOKEN_BUDGET` | 12000 | 初始输入总预算 |
| `AGENT_RESPONSE_TOKEN_RESERVE` | 2000 | 为回答预留的记录值 |
| `AGENT_MAX_HISTORY_MESSAGES` | 20 | 最近历史条数上限 |
| `AGENT_TOOL_RESULT_TOKEN_BUDGET` | 2000 | 普通工具结果预算 |
| `AGENT_SUMMARY_CONTEXT_TOKEN_BUDGET` | 1200 | 摘要进入上下文的预算 |
| `RAG_CONTEXT_TOKEN_BUDGET` | 4000 | 最终检索片段预算 |

这些配置都有上下界校验，非法配置会使用 fallback，避免异常配置让上下文失控。

## 历史消息选择算法

1. 计算 System Prompt 和当前问题的必要 Token；
2. 校验 Summary scope 是否与当前知识库一致；
3. 如果使用摘要，排除 `throughMessageId` 之前已经被摘要覆盖的消息；
4. 对历史消息进行排序、去重和状态过滤；
5. 删除当前重生成消息；
6. 删除 failed/cancelled 等非 completed 历史；
7. 过滤跨知识库 assistant 答案；
8. 从最近消息向前装入剩余预算；
9. 临界消息可以保留前部并追加“已按 Token 预算截断”；
10. 记录 included/dropped/truncated 数量。

算法优先保留最近消息，因为它们通常与当前问题相关性最高。

## Token 估算

项目没有引入特定模型 tokenizer，而是采用有界估算：

- CJK 字符按约 1 Token；
- 其他字符约每 4 个字符 1 Token；
- 空白单独估算；
- 每条 message 增加固定协议开销。

它不是账单级精确值，但适合做稳定预算和相对比较。面试时应说“估算 Token”，不要说“精确 Token”。

## 为什么 Summary Memory 要分作用域

Chat 实体保存：

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

`scopeKey` 规则：

- 普通聊天：`general`；
- 知识库聊天：具体 `knowledgeBaseId`。

这样同一会话切换知识库时不会把 A 知识库的摘要作为 B 知识库事实。对应实体见 [`chat.entity.ts`](../../../AI-Chat-Be/src/chat/entities/chat.entity.ts)。

## Summary Memory 生成策略

[`ChatMemoryService`](../../../AI-Chat-Be/src/chat/services/chat-memory.service.ts) 默认配置：

| 配置 | 默认值 |
| --- | ---: |
| 触发消息数 | 16 |
| 保留最近原文 | 8 |
| 最小新增消息 | 4 |
| 摘要结果预算 | 1000 Tokens |
| 摘要源预算 | 6000 Tokens |
| 摘要超时 | 15 秒 |

回答完成并持久化后才刷新摘要。取消、失败或超时消息不会被当作可靠事实进入摘要。

## throughMessageId 如何实现增量更新

`throughMessageId` 表示当前摘要已经覆盖到哪一条消息。

下一次刷新时：

1. 找到旧 snapshot；
2. 在可压缩消息中定位旧 `throughMessageId`；
3. 只取边界后的新增消息；
4. 如果新增消息少于 `minNewMessages`，不调用模型；
5. 将“已有摘要 + 新增消息”合并为新摘要；
6. version 加一，更新新的 throughMessageId。

这避免每次都重新总结完整历史，降低模型调用和上下文成本。

## 摘要失败为什么不影响回答

摘要是主回答完成后的附加流程：

- 读取摘要失败：Context Builder 回退最近消息；
- 摘要模型超时/异常/空结果：返回 `{status: 'failed'}`；
- 数据库更新失败：记录 warning；
- 保留旧 snapshot，不覆盖为坏摘要；
- 主回答已经完成，不改写 completed 状态。

这是典型的“增强能力失败降级”，而不是让非关键链路拖垮核心功能。

## Knowledge Search Rewrite 如何复用上下文

`buildRetrievalContext` 会从同一套历史过滤逻辑生成：

- 受限最近历史；
- 当前知识库作用域摘要。

随后交给 Query Rewrite。这样检索改写和最终回答不会使用两套互相矛盾的上下文隔离规则。

## Context Usage 可视化

每次 generation_start 和最终消息都会记录：

- input budget；
- estimated input tokens；
- system/current/summary/history tokens；
- included/dropped/truncated history；
- tool result 和 RAG budget；
- 是否使用摘要；
- 摘要覆盖消息数；
- 是否超预算。

前端 [`AgentTrace.tsx`](../../../AI-Chat/packages/ai-chat-pc/src/components/VirtualChatList/AgentTrace.tsx) 展示当前预算、历史条数和摘要使用状态。

## 真实验证结果

测试环境临时将摘要阈值降低为 6 条消息，四轮对话结果：

| Turn | estimatedInputTokens | history messages | summaryTokens | usedSummary |
| --- | ---: | ---: | ---: | --- |
| 1 | 219 | 0 | 0 | false |
| 2 | 260 | 2 | 0 | false |
| 3 | 297 | 4 | 0 | false |
| 4 | 367 | 2 | 106 | true |

PostgreSQL 中最终 snapshot：

- version：2；
- summarizedMessageCount：6；
- throughMessageId 有效；
- 摘要包含测试对话中的三个 marker。

## 高频追问

### 为什么不直接用最近 N 条？

> 最近 N 条简单，但无法控制长消息和工具结果的 Token，也会丢失更早的长期目标。项目用“长期摘要 + 最近原文”，并在统一 Token Budget 中选择。

### 摘要会不会产生幻觉？

> 会有风险，所以摘要 Prompt 要求只保留明确事实，不把失败回答当事实；摘要按知识库作用域隔离；失败时保留旧快照；最近原文与摘要冲突时以最近消息为准。

### 为什么 memorySnapshots 用 JSON，而不是单独表？

> 当前每个 Chat 的作用域数量有限，JSON 读取简单且与 Chat 一致更新。未来如果需要大量作用域、历史版本查询或异步任务审计，可以拆成独立表。

### 为什么摘要更新还是同步流程？

> SSE complete 已经发送，但当前发送消息 HTTP 可能等待摘要刷新。它不影响用户先看到回答，但会增加请求结束时间。生产化下一步是迁移到 BullMQ 异步任务。

## 2 分钟回答模板

> Context Builder 的目标是让上下文长度可控并保持作用域安全。它先计算系统提示词和当前问题的必要 Token，再选择当前 knowledgeBaseId 对应的 Summary Memory，之后从最近历史向前装入预算，过滤失败消息、重复消息、当前重生成消息和跨知识库 assistant 答案。长会话达到阈值后，ChatMemoryService 只压缩较早消息，保留最近八条原文，并用 throughMessageId 标记摘要边界，实现增量更新。摘要失败不会影响主回答，旧快照仍然保留。前端还会展示本轮用了多少历史和摘要 Token。

## 已知限制

- Token 是估算值，不是模型 tokenizer 精确值；
- 摘要更新当前没有 BullMQ 异步化；
- 尚未提供用户清除/关闭记忆的完整前端入口；
- 摘要模型仍可能遗漏细节；
- 多实例并发更新 snapshot 还没有专门的乐观锁设计。
