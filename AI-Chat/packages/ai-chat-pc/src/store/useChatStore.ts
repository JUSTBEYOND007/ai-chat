import { create } from 'zustand'

import { useConversationStore } from './useConversationStore'

import type { MessageContent } from '@pc/types/chat'
import type { Role } from '@pc/types/common'

export type MessageProps = {
  content: MessageContent[] // 兼容旧格式
  role: Role
}

export type ChatMessageProps = Map<string, MessageProps[]>

export interface ChatStoreProps {
  messages: ChatMessageProps
  addMessage: ({ content, role }: MessageProps) => void
  addChunkMessage: (chunk: string) => void
}

export const useChatStore = create<ChatStoreProps>((set) => ({
  messages: new Map(),
  addMessage: ({ content, role }: MessageProps) => {
    const { selectedId } = useConversationStore.getState() // 获取实时的 selectedId
    set((state) => {
      // 创建新的消息数组（不可变更新）
      const currentMessages = [...(state.messages.get(selectedId as string) || [])]
      currentMessages.push({ content, role })

      // 创建新的 Map（不可变更新）
      const newMessages = new Map(state.messages)
      newMessages.set(selectedId as string, currentMessages)

      return {
        messages: newMessages
      }
    })
  },

  addChunkMessage: (chunk: string) => {
    const { selectedId } = useConversationStore.getState() // 获取实时的 selectedId
    set((state) => {
      // 创建新的消息数组（不可变更新）
      const currentMessages = [...(state.messages.get(selectedId as string) || [])]
      const lastMessage = currentMessages[currentMessages.length - 1]

      if (lastMessage && lastMessage.role === 'system') {
        // 如果最后一条消息是系统消息，则更新其内容
        const lastContent = [...lastMessage.content]
        const lastTextContent = lastContent[lastContent.length - 1]

        // 如果最后一个内容项是文本类型，则追加到该文本内容中
        if (lastTextContent && lastTextContent.type === 'text') {
          // 创建新的内容对象（不可变更新）
          lastContent[lastContent.length - 1] = {
            ...lastTextContent,
            content: lastTextContent.content + chunk
          }
        }

        // 创建新的消息对象（不可变更新）
        currentMessages[currentMessages.length - 1] = {
          ...lastMessage,
          content: lastContent
        }
      } else {
        // 否则，添加一个新的系统消息，包含文本内容
        currentMessages.push({
          content: [
            {
              type: 'text',
              content: chunk
            }
          ],
          role: 'system'
        })
      }

      // 创建新的 Map（不可变更新）
      const newMessages = new Map(state.messages)
      newMessages.set(selectedId as string, currentMessages)

      return {
        messages: newMessages
      }
    })
  }
}))
