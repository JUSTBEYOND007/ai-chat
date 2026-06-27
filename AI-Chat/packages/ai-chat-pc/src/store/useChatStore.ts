import { create } from 'zustand'

import { useConversationStore } from './useConversationStore'

import type { MessageContent } from '@pc/types/chat'
import type { Role } from '@pc/types/common'

export type MessageSendStatus = 'pending' | 'sent' | 'failed'

export type MessageProps = {
  id?: string
  clientMessageId?: string
  sendStatus?: MessageSendStatus
  createdAt?: number
  content: MessageContent[]
  role: Role
}

export type ChatMessageProps = Map<string, MessageProps[]>

export interface ChatStoreProps {
  messages: ChatMessageProps
  addMessage: (message: MessageProps, chatId?: string) => void
  addChunkMessage: (chunk: string) => void
  mergeMessages: (chatId: string, messages: MessageProps[]) => void
  updateMessageStatus: (
    chatId: string,
    clientMessageId: string,
    sendStatus: MessageSendStatus
  ) => void
}

export const useChatStore = create<ChatStoreProps>((set) => ({
  messages: new Map(),

  addMessage: (message, chatId) => {
    const { selectedId } = useConversationStore.getState()
    const targetChatId = chatId || selectedId

    if (!targetChatId) {
      return
    }

    set((state) => {
      const currentMessages = [...(state.messages.get(targetChatId) || [])]
      currentMessages.push(message)

      const newMessages = new Map(state.messages)
      newMessages.set(targetChatId, currentMessages)

      return {
        messages: newMessages
      }
    })
  },

  addChunkMessage: (chunk) => {
    const { selectedId } = useConversationStore.getState()

    if (!selectedId) {
      return
    }

    set((state) => {
      const currentMessages = [...(state.messages.get(selectedId) || [])]
      const lastMessage = currentMessages[currentMessages.length - 1]

      if (lastMessage && lastMessage.role === 'system') {
        const lastContent = [...lastMessage.content]
        const lastTextContent = lastContent[lastContent.length - 1]

        if (lastTextContent && lastTextContent.type === 'text') {
          lastContent[lastContent.length - 1] = {
            ...lastTextContent,
            content: lastTextContent.content + chunk
          }
        }

        currentMessages[currentMessages.length - 1] = {
          ...lastMessage,
          content: lastContent
        }
      } else {
        currentMessages.push({
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          content: [
            {
              type: 'text',
              content: chunk
            }
          ],
          role: 'system'
        })
      }

      const newMessages = new Map(state.messages)
      newMessages.set(selectedId, currentMessages)

      return {
        messages: newMessages
      }
    })
  },

  mergeMessages: (chatId, localMessages) => {
    if (localMessages.length === 0) {
      return
    }

    set((state) => {
      const currentMessages = [...(state.messages.get(chatId) || [])]
      const messageKeys = new Set(
        currentMessages.map((item) => item.clientMessageId || item.id).filter(Boolean)
      )

      localMessages.forEach((item) => {
        const messageKey = item.clientMessageId || item.id

        if (!messageKey || !messageKeys.has(messageKey)) {
          currentMessages.push(item)

          if (messageKey) {
            messageKeys.add(messageKey)
          }
        }
      })

      currentMessages.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))

      const newMessages = new Map(state.messages)
      newMessages.set(chatId, currentMessages)

      return {
        messages: newMessages
      }
    })
  },

  updateMessageStatus: (chatId, clientMessageId, sendStatus) => {
    set((state) => {
      const currentMessages = state.messages.get(chatId)

      if (!currentMessages) {
        return state
      }

      const nextMessages = currentMessages.map((item) =>
        item.clientMessageId === clientMessageId ? { ...item, sendStatus } : item
      )

      const newMessages = new Map(state.messages)
      newMessages.set(chatId, nextMessages)

      return {
        messages: newMessages
      }
    })
  }
}))
