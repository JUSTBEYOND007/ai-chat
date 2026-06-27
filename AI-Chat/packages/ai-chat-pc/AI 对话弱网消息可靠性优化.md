# AI 对话弱网消息可靠性优化

## 简历写法

基于 IndexedDB 设计本地消息缓存与待发送队列，结合乐观更新、消息状态标记和 `online` 事件重试机制，保障刷新与断网场景下消息不丢失，并通过 `clientMessageId` 降低重复发送风险。

## 代码锚点

- `src/utils/chatLocalDB.ts`
- `src/store/useChatStore.ts`
- `src/components/AIRichInput/index.tsx`
- `src/components/VirtualChatList/MessageItem.tsx`
- `src/components/Conversation/ConversationSidebar.tsx`

## 实现思路

用户提交文本消息后，前端先生成 `clientMessageId`，立即写入 Zustand 展示到 UI，同时写入 IndexedDB 的 `messages` 和 `pendingMessages`。这属于乐观更新，用户不会因为网络请求等待而感觉卡顿。

消息发送成功后，将 UI 状态和本地 IndexedDB 状态同步更新为 `sent`。如果请求失败，则更新为 `failed`，消息仍保留在本地，页面上显示失败提示。

浏览器恢复网络时，通过 `window.online` 读取 IndexedDB 中 `pending / failed` 的消息并重新发送，成功后更新状态。

## 为什么不说“离线 AI 对话”

模型生成和 SSE 回复仍然依赖后端和模型服务，所以这里不包装成完整离线对话。更准确的定位是弱网场景下的本地消息可靠性：保证用户输入不丢失，并在网络恢复后补偿发送。

## 面试讲法

原始版本里用户消息只存在 Zustand 内存中，请求失败或页面刷新后消息容易丢失。我增加了 IndexedDB 本地缓存和待发送队列：发送时先乐观更新 UI，再异步请求后端；失败时保留消息并标记状态；网络恢复后自动扫描 pending 队列重试。为了避免重复消息，我给每条用户消息生成 `clientMessageId`，用于前端去重和状态同步。

## 追问：为什么不把 AI 回复也离线缓存重试？

AI 回复是由后端 SSE 推送产生的，自动后台重试会涉及会话选中状态、重复生成和服务端幂等等问题。当前实现只重试用户消息发送，把生成链路仍交给在线状态下的 SSE，这样边界更清晰，也避免错误会话写入。
