import { isImageByExtension } from './judgeImage'

import type { MessageProps } from '@pc/store/useChatStore'
import type { ChatMessage } from '@pc/types/session'

export const mapChatHistoryToMessages = (messages: ChatMessage[]): MessageProps[] => {
  return messages.flatMap((message) => {
    const createdAt = new Date(message.createdAt).getTime()
    const mappedMessages: MessageProps[] = []

    message.imgUrl?.forEach((url) => {
      mappedMessages.push({
        id: `${message.id}-image-${url}`,
        createdAt,
        content: [
          {
            type: 'image',
            content: url
          }
        ],
        role: 'image'
      })
    })

    message.fileContent?.forEach((file) => {
      mappedMessages.push(
        isImageByExtension(file.fileName)
          ? {
              id: `${message.id}-file-image-${file.fileId}`,
              createdAt,
              content: [
                {
                  type: 'image',
                  content: file.fileName
                }
              ],
              role: 'image'
            }
          : {
              id: `${message.id}-file-${file.fileId}`,
              createdAt,
              content: [
                {
                  type: 'file',
                  content: {
                    uid: file.fileId,
                    name: file.fileName
                  }
                }
              ],
              role: 'file'
            }
      )
    })

    mappedMessages.push({
      id: message.id,
      createdAt,
      knowledgeBaseId: message.knowledgeBaseId || undefined,
      agentSteps: message.agentSteps || undefined,
      contextUsage: message.contextUsage || undefined,
      sources: message.sources || undefined,
      toolCalls: message.toolCalls || undefined,
      streamStatus: message.status === 'failed' ? 'interrupted' : 'completed',
      content: [
        {
          type: 'text',
          content: message.content
        }
      ],
      role: message.role
    })

    return mappedMessages
  })
}
