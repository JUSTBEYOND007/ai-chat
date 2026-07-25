import { create } from 'zustand'

import { useConversationStore } from './useConversationStore'

import type {
  AgentStreamEvent,
  ChatAgentStep,
  ChatContextUsage,
  ChatToolCall,
  MessageContent
} from '@pc/types/chat'
import type { Role } from '@pc/types/common'
import type { KnowledgeSource } from '@pc/types/rag'
import { interruptAgentSteps, reduceAgentSteps } from '@pc/utils/agentTrace'

export type MessageSendStatus = 'pending' | 'sent' | 'failed'
export type MessageStreamStatus = 'streaming' | 'completed' | 'interrupted'

export type AssistantStreamContext = {
  prompt: string
  fileId?: string
  clientMessageId?: string
  knowledgeBaseId?: string
}

export type MessageProps = {
  id?: string
  clientMessageId?: string
  sendStatus?: MessageSendStatus
  streamStatus?: MessageStreamStatus
  streamContext?: AssistantStreamContext
  generationId?: string
  agentSteps?: ChatAgentStep[]
  contextUsage?: ChatContextUsage
  knowledgeBaseId?: string
  sources?: KnowledgeSource[]
  toolCalls?: ChatToolCall[]
  createdAt?: number
  content: MessageContent[]
  role: Role
}

export type ChatMessageProps = Map<string, MessageProps[]>

const createMessageId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  return `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

const createTextContent = (content: string): MessageContent => ({
  type: 'text',
  content
})

const findLatestAssistantIndex = (messages: MessageProps[]) => {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === 'system') {
      return index
    }
  }

  return -1
}

export interface ChatStoreProps {
  messages: ChatMessageProps
  addMessage: (message: MessageProps, chatId?: string) => void
  addChunkMessage: (chunk: string, chatId?: string) => void
  applyAgentEvent: (chatId: string, event: AgentStreamEvent) => void
  startAssistantStream: (chatId: string, streamContext: AssistantStreamContext) => string | undefined
  completeLatestAssistantStream: (
    chatId: string,
    content?: string,
    metadata?: Pick<
      MessageProps,
      | 'generationId'
      | 'knowledgeBaseId'
      | 'sources'
      | 'toolCalls'
      | 'agentSteps'
      | 'contextUsage'
    >
  ) => void
  interruptLatestAssistantStream: (chatId: string, reason?: string) => void
  removeMessage: (chatId: string, messageId: string) => void
  setMessages: (chatId: string, messages: MessageProps[]) => void
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

  addChunkMessage: (chunk, chatId) => {
    const { selectedId } = useConversationStore.getState()
    const targetChatId = chatId || selectedId

    if (!targetChatId) {
      return
    }

    set((state) => {
      const currentMessages = [...(state.messages.get(targetChatId) || [])]
      const lastMessage = currentMessages[currentMessages.length - 1]

      if (lastMessage && lastMessage.role === 'system') {
        const lastContent = [...lastMessage.content]
        const lastTextContent = lastContent[lastContent.length - 1]

        if (lastTextContent && lastTextContent.type === 'text') {
          lastContent[lastContent.length - 1] = {
            ...lastTextContent,
            content: lastTextContent.content + chunk
          }
        } else {
          lastContent.push(createTextContent(chunk))
        }

        currentMessages[currentMessages.length - 1] = {
          ...lastMessage,
          content: lastContent,
          streamStatus: 'streaming'
        }
      } else {
        currentMessages.push({
          id: createMessageId(),
          createdAt: Date.now(),
          streamStatus: 'streaming',
          content: [createTextContent(chunk)],
          role: 'system'
        })
      }

      const newMessages = new Map(state.messages)
      newMessages.set(targetChatId, currentMessages)

      return {
        messages: newMessages
      }
    })
  },

  applyAgentEvent: (chatId, event) => {
    set((state) => {
      const currentMessages = [...(state.messages.get(chatId) || [])]
      const latestAssistantIndex = findLatestAssistantIndex(currentMessages)

      if (latestAssistantIndex < 0) {
        return state
      }

      const assistantMessage = currentMessages[latestAssistantIndex]
      currentMessages[latestAssistantIndex] = {
        ...assistantMessage,
        generationId: event.generationId,
        streamStatus: 'streaming',
        contextUsage:
          event.type === 'generation_start'
            ? event.contextUsage
            : assistantMessage.contextUsage,
        agentSteps: reduceAgentSteps(assistantMessage.agentSteps, event)
      }

      const newMessages = new Map(state.messages)
      newMessages.set(chatId, currentMessages)
      return { messages: newMessages }
    })
  },

  startAssistantStream: (chatId, streamContext) => {
    if (!chatId) {
      return undefined
    }

    const messageId = createMessageId()

    set((state) => {
      const currentMessages = [...(state.messages.get(chatId) || [])]
      currentMessages.push({
        id: messageId,
        createdAt: Date.now(),
        streamStatus: 'streaming',
        streamContext,
        knowledgeBaseId: streamContext.knowledgeBaseId,
        agentSteps: [],
        content: [createTextContent('')],
        role: 'system'
      })

      const newMessages = new Map(state.messages)
      newMessages.set(chatId, currentMessages)

      return {
        messages: newMessages
      }
    })

    return messageId
  },

  completeLatestAssistantStream: (chatId, content, metadata) => {
    set((state) => {
      const currentMessages = [...(state.messages.get(chatId) || [])]
      const latestAssistantIndex = findLatestAssistantIndex(currentMessages)

      if (latestAssistantIndex < 0) {
        return state
      }

      const assistantMessage = currentMessages[latestAssistantIndex]
      const nextContent = [...assistantMessage.content]
      const lastContentIndex = nextContent.length - 1
      const lastContent = nextContent[lastContentIndex]

      if (typeof content === 'string') {
        if (lastContent && lastContent.type === 'text') {
          nextContent[lastContentIndex] = {
            ...lastContent,
            content
          }
        } else {
          nextContent.push(createTextContent(content))
        }
      }

      currentMessages[latestAssistantIndex] = {
        ...assistantMessage,
        content: nextContent,
        streamStatus: 'completed',
        generationId: metadata?.generationId ?? assistantMessage.generationId,
        knowledgeBaseId: metadata?.knowledgeBaseId ?? assistantMessage.knowledgeBaseId,
        sources: metadata?.sources ?? assistantMessage.sources,
        toolCalls: metadata?.toolCalls ?? assistantMessage.toolCalls,
        agentSteps: metadata?.agentSteps ?? assistantMessage.agentSteps,
        contextUsage: metadata?.contextUsage ?? assistantMessage.contextUsage
      }

      const newMessages = new Map(state.messages)
      newMessages.set(chatId, currentMessages)

      return {
        messages: newMessages
      }
    })
  },

  interruptLatestAssistantStream: (chatId, reason) => {
    set((state) => {
      const currentMessages = [...(state.messages.get(chatId) || [])]
      const latestAssistantIndex = findLatestAssistantIndex(currentMessages)

      if (latestAssistantIndex < 0) {
        return state
      }

      const assistantMessage = currentMessages[latestAssistantIndex]
      const nextContent = [...assistantMessage.content]
      const hasTextContent = nextContent.some(
        (item) => item.type === 'text' && item.content.trim()
      )

      if (!hasTextContent) {
        nextContent.push(
          createTextContent(reason ? '回复失败，请稍后重试。' : '回复中断，未收到完整内容。')
        )
      }

      currentMessages[latestAssistantIndex] = {
        ...assistantMessage,
        content: nextContent,
        streamStatus: 'interrupted',
        agentSteps: interruptAgentSteps(
          assistantMessage.agentSteps,
          reason
            ? { code: 'STREAM_ERROR', message: reason }
            : { code: 'INTERRUPTED', message: '用户中断了本次生成' }
        )
      }

      const newMessages = new Map(state.messages)
      newMessages.set(chatId, currentMessages)

      return {
        messages: newMessages
      }
    })
  },

  removeMessage: (chatId, messageId) => {
    set((state) => {
      const currentMessages = state.messages.get(chatId)

      if (!currentMessages) {
        return state
      }

      const nextMessages = currentMessages.filter((item) => item.id !== messageId)
      const newMessages = new Map(state.messages)
      newMessages.set(chatId, nextMessages)

      return {
        messages: newMessages
      }
    })
  },

  setMessages: (chatId, messages) => {
    set((state) => {
      const newMessages = new Map(state.messages)
      newMessages.set(chatId, messages)

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
