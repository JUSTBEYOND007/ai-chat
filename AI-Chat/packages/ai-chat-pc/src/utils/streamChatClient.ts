import type { EventSourcePolyfill } from 'event-source-polyfill'
import type {
  AgentStreamEvent,
  ChatAgentStep,
  ChatContextUsage,
  ChatToolCall
} from '@pc/types/chat'
import type { KnowledgeSource } from '@pc/types/rag'

export type StreamStatus = 'idle' | 'connecting' | 'streaming' | 'recovering' | 'completed' | 'aborted' | 'error'

export type StreamConnectionOptions = {
  generationId?: string
  afterSeq?: number
}

export type StreamChatClientOptions = {
  createConnection: (
    chatId: string,
    options?: StreamConnectionOptions
  ) => EventSource | EventSourcePolyfill
  flushInterval?: number
  maxReconnectAttempts?: number
  onChunk: (chunk: string) => void
  onAgentEvent?: (event: AgentStreamEvent) => void
  onComplete?: (content: string, metadata?: StreamCompleteMetadata) => void
  onError?: (error: unknown) => void
  onStatusChange?: (status: StreamStatus) => void
}

export type StreamCompleteMetadata = {
  generationId?: string
  knowledgeBaseId?: string
  sources?: KnowledgeSource[]
  toolCalls?: ChatToolCall[]
  agentSteps?: ChatAgentStep[]
  contextUsage?: ChatContextUsage
}

type StreamMessage =
  | {
      type: 'chunk'
      content: string
      generationId?: string
      seq?: number
      timestamp?: number
    }
  | {
      type: 'complete'
      content: string
      generationId?: string
      seq?: number
      timestamp?: number
      knowledgeBaseId?: string
      sources?: KnowledgeSource[]
      toolCalls?: ChatToolCall[]
      agentSteps?: ChatAgentStep[]
      contextUsage?: ChatContextUsage
    }
  | {
      type: 'error'
      error?: string
      content?: string
      generationId?: string
      seq?: number
      timestamp?: number
    }
  | AgentStreamEvent

export class StreamChatClient {
  private eventSource: EventSource | EventSourcePolyfill | null = null
  private renderBuffer = ''
  private fullContent = ''
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private status: StreamStatus = 'idle'
  private chatId: string | null = null
  private generationId: string | undefined
  private lastSeq = 0
  private reconnectAttempts = 0
  private closedByClient = false
  private readonly flushInterval: number
  private readonly maxReconnectAttempts: number
  private readonly options: StreamChatClientOptions

  constructor(options: StreamChatClientOptions) {
    this.options = options
    this.flushInterval = options.flushInterval ?? 50
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 1
  }

  start(chatId: string) {
    this.close()
    this.resetRenderState()
    this.chatId = chatId
    this.closedByClient = false
    this.reconnectAttempts = 0
    this.setStatus('connecting')
    this.connect()
  }

  abort() {
    if (!this.eventSource) {
      return
    }

    this.closedByClient = true
    this.flushAll()
    this.setStatus('aborted')
    this.close()
  }

  close() {
    this.stopFlush()

    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
  }

  getStatus() {
    return this.status
  }

  getRecoveryState() {
    return {
      generationId: this.generationId,
      lastSeq: this.lastSeq
    }
  }

  private connect(options: StreamConnectionOptions = {}) {
    if (!this.chatId) {
      return
    }

    this.eventSource = this.options.createConnection(this.chatId, {
      generationId: options.generationId ?? this.generationId,
      afterSeq: options.afterSeq ?? 0
    })

    this.eventSource.onopen = () => {
      this.setStatus('streaming')
    }

    this.eventSource.onmessage = (event: MessageEvent) => {
      this.handleRawMessage(event.data)
    }

    this.eventSource.onerror = (error: Event) => {
      this.flushAll()

      if (this.canRecover()) {
        this.recover()
        return
      }

      this.setStatus('error')
      this.options.onError?.(error)
      this.close()
    }
  }

  private canRecover() {
    return (
      !this.closedByClient &&
      !!this.chatId &&
      !!this.generationId &&
      this.reconnectAttempts < this.maxReconnectAttempts
    )
  }

  private recover() {
    this.reconnectAttempts += 1
    const afterSeq = this.lastSeq
    this.close()
    this.setStatus('recovering')
    this.connect({
      generationId: this.generationId,
      afterSeq
    })
  }

  private handleRawMessage(rawData: string) {
    let data: StreamMessage
    try {
      data = typeof rawData === 'string' ? (JSON.parse(rawData) as StreamMessage) : rawData
    } catch (error) {
      this.setStatus('error')
      this.options.onError?.(error)
      this.close()
      return
    }

    this.captureStreamPosition(data)

    if (this.shouldSkipMessage(data)) {
      return
    }

    if (data.type === 'chunk') {
      this.addToRenderBuffer(data.content || '')
      return
    }

    if (
      data.type === 'generation_start' ||
      data.type === 'planning' ||
      data.type === 'tool_start' ||
      data.type === 'tool_result'
    ) {
      this.options.onAgentEvent?.(data)
      return
    }

    if (data.type === 'answer_chunk') {
      this.options.onAgentEvent?.(data)
      this.addToRenderBuffer(data.content || '')
      return
    }

    if (data.type === 'complete') {
      this.flushAll()
      this.fullContent = data.content || this.fullContent
      this.setStatus('completed')
      this.options.onComplete?.(this.fullContent, {
        generationId: data.generationId,
        knowledgeBaseId: data.knowledgeBaseId,
        sources: data.sources,
        toolCalls: data.toolCalls,
        agentSteps: data.agentSteps,
        contextUsage: data.contextUsage
      })
      this.close()
      return
    }

    if (data.type === 'error') {
      this.flushAll()
      this.setStatus('error')
      this.options.onError?.(data.error || data.content || 'Stream error')
      this.close()
    }
  }

  private captureStreamPosition(data: StreamMessage) {
    if (data.generationId) {
      this.generationId = data.generationId
    }
  }

  private shouldSkipMessage(data: StreamMessage) {
    if (typeof data.seq !== 'number') {
      return false
    }

    if (data.seq <= this.lastSeq) {
      return true
    }

    this.lastSeq = data.seq
    return false
  }

  private addToRenderBuffer(chunk: string) {
    if (!chunk) {
      return
    }

    this.renderBuffer += chunk
    this.fullContent += chunk
    this.startFlush()
  }

  private startFlush() {
    if (this.flushTimer) {
      return
    }

    this.flushTimer = setInterval(() => {
      this.flushChunk()
    }, this.flushInterval)
  }

  private stopFlush() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }

  private flushChunk() {
    if (!this.renderBuffer) {
      this.stopFlush()
      return
    }

    const chunkSize = Math.min(16, this.renderBuffer.length)
    const chunk = this.renderBuffer.slice(0, chunkSize)
    this.renderBuffer = this.renderBuffer.slice(chunkSize)
    this.options.onChunk(chunk)
  }

  private flushAll() {
    while (this.renderBuffer) {
      this.flushChunk()
    }
  }

  private resetRenderState() {
    this.renderBuffer = ''
    this.fullContent = ''
    this.generationId = undefined
    this.lastSeq = 0
  }

  private setStatus(status: StreamStatus) {
    this.status = status
    this.options.onStatusChange?.(status)
  }
}
