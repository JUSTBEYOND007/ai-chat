# AI 对话流断流恢复改造说明与面试回答

## 一、背景问题

AI 对话的流式响应通常通过 SSE 持续向前端推送 chunk。它和普通通知流不一样：

- AI 回复是一次生成过程，不是简单事件广播。
- 网络断开时，前端不知道后端已经生成到哪里。
- 后端也不一定知道前端已经收到哪里。
- 如果直接重新连接或重新请求，可能出现重复生成、重复展示、内容缺失或状态不一致。

所以我们没有采用“断了就无脑重连”的方式，而是按阶段做了可解释、可演进的恢复方案。

## 二、第一阶段：断流后保留内容并允许重新生成

### 改造目标

先解决用户体验问题：流式回复中断后，不丢掉已经显示出来的内容，同时给用户明确的失败状态和重新生成入口。

### 前端改动

在 `AI-Chat/packages/ai-chat-pc/src/store/useChatStore.ts` 中扩展了 AI 回复状态：

```ts
streaming | completed | interrupted
```

同时增加了 assistant 流消息相关能力：

- `startAssistantStream`：开始生成时创建一条 assistant 占位消息。
- `completeLatestAssistantStream`：生成完成后标记为 completed。
- `interruptLatestAssistantStream`：SSE error、手动停止、发送失败时标记为 interrupted。
- `removeMessage`：重新生成前移除上一条失败 assistant 回复。

在 `AIRichInput` 中接入这些状态：

- SSE 开始前创建 assistant 消息。
- 收到 chunk 时追加内容。
- complete 时标记完成。
- error / stop / send failed 时保留已有内容并标记中断。
- 中断后展示“重新生成”按钮。

在 `MessageItem` 中增加中断提示：

```txt
AI 回复中断，已保留当前内容，可在输入框上方重新生成
```

### 这一阶段解决了什么

- 流断了以后不清空已有内容。
- 用户能看到明确的中断状态。
- 用户可以手动重新生成。
- 前端状态不会一直卡在 streaming。

### 这一阶段的边界

这一阶段还不是真正的断点续传。重新生成本质上还是重新发起一次生成，只是 UI 上替换上一条失败回复。

## 三、第二阶段：clientMessageId 幂等保护

### 改造目标

解决“重试导致重复用户消息、重复 AI 生成”的问题。

### 前端改动

前端本来已经有本地 pending 消息和 `clientMessageId`，这次把它真正传给后端：

```ts
{
  id: chatId,
  message,
  fileId,
  clientMessageId,
  regenerate
}
```

自动重试 pending 消息时复用同一个 `clientMessageId`。

人工点击“重新生成”时额外传：

```ts
regenerate: true
```

含义是：用户明确希望重新生成 AI 回复。

### 后端改动

在 `SendMessageDto` 中增加：

```ts
clientMessageId?: string;
regenerate?: boolean;
```

在 `Message` 实体中增加：

```ts
clientMessageId?: string;
```

在 `ChatService.useGeminiToChat` 中加入幂等判断：

- 如果同一个 `chatId + clientMessageId` 的用户消息已经存在，并且不是 `regenerate`，直接返回 duplicate。
- 不再重复保存 user 消息。
- 不再重复调用 AI。
- 如果是 `regenerate: true`，复用已有用户消息，但允许重新生成 assistant 回复。

### 测试覆盖

后端新增单测：

```txt
同一个 clientMessageId 已存在时，不再触发 AI 生成
```

### 这一阶段解决了什么

- 网络抖动导致的自动重试不会重复插入用户消息。
- 自动重试不会重复触发 AI 生成。
- 人工重新生成和自动重试有明确区分。

## 四、第三阶段：generationId + seq/afterSeq 轻量断点恢复

### 改造目标

让 SSE 断开后，前端可以告诉后端“我已经收到第几个 chunk”，后端补发缺失内容。

### 后端协议

后端每次 AI 生成创建一个 `generationId`。

每个 SSE 事件都带上：

```ts
{
  type: 'chunk' | 'complete' | 'error',
  generationId,
  seq,
  content,
  isComplete
}
```

其中：

- `generationId` 标识一次 AI 回复生成。
- `seq` 是本次生成中的递增序号。
- chunk 和 complete 都会被缓存。

SSE 接口支持恢复参数：

```txt
/chat/getChat/:id?generationId=xxx&afterSeq=1
```

后端会补发：

```txt
seq > afterSeq
```

的缓存事件。

### 后端实现

在 `ChatService` 中维护内存缓存：

```ts
Map<generationId, { chatId, generationId, events }>
```

生成过程中：

- 每个 chunk 写入缓存。
- 同时通过 SSE 推给前端。
- complete 事件也写入缓存。

订阅 SSE 时：

- 如果带了 `generationId` 和 `afterSeq`，先补发缺失事件。
- 再继续订阅实时 Subject。

### 前端实现

`StreamChatClient` 增强为可记录恢复状态：

- `generationId`
- `lastSeq`
- `recovering` 状态
- 自动恢复次数限制

收到 chunk / complete 时：

- 记录 `generationId`。
- 记录最新 `seq`。
- 如果收到重复或旧 seq，直接跳过，避免重复展示。

SSE error 时：

- 如果已经拿到 `generationId`，并且没有超过恢复次数，则自动重新建立 SSE。
- 新连接带上：

```ts
{
  generationId,
  afterSeq: lastSeq
}
```

后端补发缺失 chunk，前端继续追加。

### 测试覆盖

后端新增单测：

```txt
已经缓存 seq=1、seq=2、complete 后，afterSeq=1 只补发 seq > 1 的事件
```

### 这一阶段解决了什么

- SSE 断开后，前端可以按 seq 补收缺失 chunk。
- 避免重复追加已经收到的内容。
- 比“整次重新生成”更接近真正断点恢复。

### 当前边界

目前 chunk 缓存是后端进程内存缓存，适合单实例开发和演示。

如果要做到生产级，需要继续升级为：

- Redis 缓存 generation/chunk。
- 数据库存储生成状态。
- 服务重启后仍可恢复。
- 多实例部署下任意实例都能补发 chunk。
- 页面刷新后也能恢复生成状态。

## 五、面试回答参考

### 简洁版回答

我们项目里没有简单粗暴地对 AI 流做无脑重连。因为 AI 生成流不是普通通知流，断线时无法天然确认后端生成到哪里、前端收到哪里。如果直接重连，可能导致重复生成、重复展示或内容缺失。

我们的处理是分层做的：先在前端保留已生成内容并标记中断，用户可以重新生成；然后用 `clientMessageId` 做请求幂等，避免网络重试造成重复用户消息或重复 AI 生成；最后引入 `generationId + seq`，后端缓存 chunk，前端断线后带 `afterSeq` 恢复，后端只补发缺失的 chunk。

### 详细版回答

AI 对话流的断流恢复要解决两个问题：一是请求幂等，二是流式内容恢复。

我们先给每次用户发送生成一个 `clientMessageId`。前端发送消息和自动重试都会携带这个 ID。后端在保存用户消息前，会检查同一个 `chatId + clientMessageId` 是否已经存在。如果存在并且不是用户主动重新生成，就直接返回 duplicate，不再重复保存消息，也不再重复调用大模型。

然后针对 AI 流本身，我们给每次 AI 回复生成一个 `generationId`。后端推送每个 chunk 时附带递增的 `seq`，并把 chunk 缓存在服务端。前端收到 chunk 后记录最新的 `seq`。如果 SSE 断开，前端会用 `generationId + afterSeq` 重新建立连接，后端只补发 `seq > afterSeq` 的 chunk。前端再通过 seq 去重，避免重复追加内容。

当前版本缓存放在后端内存里，适合单实例和演示。如果是生产环境，我会把 generation 状态和 chunk 缓存放到 Redis 或数据库里，这样服务重启、多实例部署、页面刷新后也能继续恢复。

### 面试官追问：为什么不直接 EventSource 自动重连？

可以这样回答：

EventSource 自带重连更适合普通事件通知，但 AI 生成流有业务状态。断线时，前端可能只收到了一半内容，后端可能已经继续生成甚至生成完成。如果直接依赖 EventSource 自动重连，服务端如果没有保存生成进度，就无法知道应该从哪里补发，容易重复或丢内容。

所以我们没有只依赖连接层重连，而是在业务层加了 `generationId` 和 `seq`，让恢复有明确的业务位置。

### 面试官追问：如果后端已经生成完了，前端断了怎么办？

可以这样回答：

如果后端已经生成完成，complete 事件和完整内容也会进入 generation 缓存。前端重连时带 `afterSeq`，后端会把缺失 chunk 和 complete 补发给前端。更完整的生产方案里，还会把最终 assistant 消息落库，前端也可以通过刷新历史消息拿到最终结果。

### 面试官追问：怎么避免重复展示？

可以这样回答：

每个流事件都有递增 `seq`。前端维护 `lastSeq`，收到事件时如果 `seq <= lastSeq` 就直接丢弃。这样断线重连后，即使服务端补发时包含了部分已收到内容，前端也不会重复追加。

### 面试官追问：怎么避免重复请求大模型？

可以这样回答：

我们用 `clientMessageId` 做请求幂等。自动重试时复用同一个 `clientMessageId`，后端发现这个用户消息已经存在，就返回 duplicate，不再调用大模型。只有用户明确点击“重新生成”时，前端才会带 `regenerate: true`，后端才允许重新触发生成。

## 六、简历写法参考

可以写成：

```txt
针对 AI 对话 SSE 流式响应易受网络波动影响的问题，设计并实现分层断流恢复机制：前端基于消息状态机保留已生成内容并支持中断重试；通过 clientMessageId 实现用户请求幂等，避免自动重试造成重复入库和重复生成；引入 generationId + seq/afterSeq 协议，后端缓存流式 chunk 并支持按序补发，前端记录 lastSeq 并去重恢复，实现轻量级流式断点续传能力。
```

更短一点：

```txt
实现 AI 流式对话断流恢复能力：基于 clientMessageId 保证请求幂等，结合 generationId、seq 和 afterSeq 实现 SSE chunk 缓存补发与前端去重恢复，提升网络异常场景下的对话连续性和一致性。
```