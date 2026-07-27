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
  generationId?: string
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
  | 'cancelled'
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
  ragContextTokenBudget?: number
  usedSummary: boolean
  summarizedMessageCount?: number
  summaryUpdatedAt?: number
  overBudget: boolean
}

export type RetrievalChannel = 'vector' | 'keyword' | 'fused'

export type RetrievalFilterReason =
  | 'below_score_threshold'
  | 'duplicate_chunk'
  | 'adjacent_chunk'
  | 'document_quota_exceeded'
  | 'token_budget_exceeded'
  | 'top_k_limit'

export type RetrievalTrace = {
  version: '1.0'
  strategy: 'vector_baseline' | 'dual_recall' | 'hybrid_rrf'
  knowledgeBaseId: string
  originalQuery: string
  effectiveQuery: string
  rewrittenQuery?: string
  rewrite: {
    mode: 'never' | 'auto' | 'always'
    status: 'skipped' | 'rewritten' | 'fallback'
    reason: string
    durationMs: number
    historyMessageCount: number
    usedSummary: boolean
    error?: string
  }
  topK: number
  candidates: Array<{
    candidateId: string
    documentId: string
    knowledgeBaseId: string
    fileName: string
    chunkIndex: number
    content: string
    tokenCount?: number
    channels: Array<{
      channel: RetrievalChannel
      rank: number
      score: number
    }>
    finalRank?: number
    finalScore?: number
    selected: boolean
    filterReasons: RetrievalFilterReason[]
  }>
  channels: Array<{
    channel: RetrievalChannel
    status: 'completed' | 'skipped' | 'failed'
    candidateLimit: number
    candidateCount: number
    durationMs: number
    query?: string
    error?: string
  }>
  selection?: {
    rrfK: number
    requestedTopK: number
    selectedCount: number
    vectorScoreThreshold?: number
    keywordScoreThreshold?: number
    maxChunksPerDocument: number
    adjacentChunkDistance: number
    tokenBudget: number
    selectedTokens: number
  }
  timings: {
    rewriteMs: number
    embeddingMs: number
    vectorSearchMs: number
    keywordSearchMs: number
    fusionMs: number
    totalMs: number
  }
  generatedAt: string
}

export type KnowledgeSearchToolOutput = {
  code: 'OK' | 'NO_RELIABLE_CONTEXT'
  query: string
  effectiveQuery: string
  knowledgeBaseId: string
  sources: Array<{
    documentId: string
    fileName: string
    chunkIndex: number
    content: string
    score: number
  }>
  retrievalTrace: RetrievalTrace
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
      status: 'running' | 'completed' | 'failed' | 'cancelled'
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
