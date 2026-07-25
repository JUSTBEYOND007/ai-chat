export type mergeChunkType = {
  fileId: string
  fileName: string
  totalChunks: number
}

export type chunkItemType = {
  file: Blob
}

/**
 * fileStatus: 当前文件上传的状态，0 -> 未上传切片 1 -> 切片全部上传完成 2 -> 上传了部分切片
 */
export type checkRespType = {
  fileStatus: 0 | 1 | 2
  isCompleted: boolean
  uploaded?: number[]
  uploadedChunks?: number
  filePath?: string
  fileName?: string
}

export type mergeResType = {
  filePath: string
  fileName: string
}

export type SendMessageType = {
  id: string
  message: string
  // imgUrl?: string[]
  fileId?: string
  clientMessageId?: string
  knowledgeBaseId?: string
  regenerate?: boolean
}

export type ChatToolCall = {
  toolCallId?: string
  name: string
  status: 'completed' | 'failed'
  input?: unknown
  output?: unknown
  error?: {
    code: string
    message: string
  }
  startedAt?: number
  completedAt?: number
  durationMs?: number
  query?: string
  resultCount?: number
}

export type AgentStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted'

export type ChatAgentStep = {
  stepId: string
  type: 'planning' | 'tool' | 'answer'
  status: AgentStepStatus
  round?: number
  startedAt: number
  completedAt?: number
  toolCallId?: string
  toolName?: string
  input?: unknown
  output?: unknown
  error?: {
    code: string
    message: string
  }
  durationMs?: number
  message?: string
}

export type ChatContextUsage = {
  inputBudgetTokens: number
  responseReserveTokens: number
  estimatedInputTokens: number
  systemTokens: number
  currentMessageTokens: number
  summaryTokens: number
  historyTokens: number
  includedHistoryMessages: number
  droppedHistoryMessages: number
  truncatedHistoryMessages: number
  toolResultBudgetTokens: number
  usedSummary: boolean
  summarizedMessageCount?: number
  summaryUpdatedAt?: number
  overBudget: boolean
}

export type ChatToolExecutionResult = {
  toolCallId: string
  toolName: string
  status: 'completed' | 'failed'
  input: unknown
  output?: unknown
  error?: {
    code: string
    message: string
  }
  startedAt: number
  completedAt: number
  durationMs: number
}

type AgentStreamEventBase = {
  generationId: string
  seq?: number
  timestamp: number
}

export type AgentStreamEvent =
  | (AgentStreamEventBase & {
      type: 'generation_start'
      availableTools: string[]
      contextUsage: ChatContextUsage
    })
  | (AgentStreamEventBase & {
      type: 'planning'
      round: number
      status: 'running' | 'completed' | 'failed'
      startedAt: number
      durationMs?: number
      message?: string
      error?: {
        code: string
        message: string
      }
    })
  | (AgentStreamEventBase & {
      type: 'tool_start'
      round: number
      toolCallId: string
      toolName: string
      input: unknown
    })
  | (AgentStreamEventBase & {
      type: 'tool_result'
      round: number
      result: ChatToolExecutionResult
    })
  | (AgentStreamEventBase & {
      type: 'answer_chunk'
      content: string
    })

export interface ImageContent {
  type: 'image'
  content: string
}

export interface TextContent {
  type: 'text'
  content: string
}

export interface FileContent {
  type: 'file'
  content: {
    uid: string
    name: string
    size?: number
  }
}

export type MessageContent = ImageContent | TextContent | FileContent

export interface Message {
  id: string
  role: 'user' | 'system'
  content: MessageContent[] // 数组，支持混合内容
  timestamp: number
}
