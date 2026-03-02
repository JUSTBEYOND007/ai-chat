import { VirtualChatList } from '@pc/components/VirtualChatList'
import { useChatStore, useConversationStore } from '@pc/store'

import './bubble.css'
import 'highlight.js/styles/github.css'

/**
 * 聊天气泡组件
 * 使用虚拟滚动优化长对话场景性能
 */
export const ChatBubble = () => {
  const { messages } = useChatStore()
  const { selectedId } = useConversationStore()

  // 获取当前会话的消息列表
  const chatMessage = selectedId ? messages.get(selectedId) : []

  // 如果没有消息，返回空
  if (!chatMessage || chatMessage.length === 0) {
    return null
  }

  return (
    <VirtualChatList
      messages={chatMessage}
      height={window.innerHeight * 0.75} // 占据 75% 的视口高度
      width="50vw"
      className="chat-bubble-list"
    />
  )
}
