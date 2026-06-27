import type { EventSourcePolyfill } from 'event-source-polyfill'

export type StreamStatus = 'idle' | 'connecting' | 'streaming' | 'completed' | 'aborted' | 'error'

export type StreamChatClientOptions = {
  createConnection: (chatId: string) => EventSource | EventSourcePolyfill
  flushInterval?: number
  onChunk: (chunk: string) => void
  onComplete?: (content: string) => void
  onError?: (error: unknown) => void
  onStatusChange?: (status: StreamStatus) => void
}

type StreamMessage =
  | {
      type: 'chunk'
      content: string
    }
  | {
      type: 'complete'
      content: string
    }
  | {
      type: 'error'
      error?: string
      content?: string
    }

export class StreamChatClient {
  private eventSource: EventSource | EventSourcePolyfill | null = null
  private renderBuffer = ''
  private fullContent = ''
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private status: StreamStatus = 'idle'
  private readonly flushInterval: number
  private readonly options: StreamChatClientOptions

  constructor(options: StreamChatClientOptions) {
    this.options = options
    this.flushInterval = options.flushInterval ?? 50
  }

  start(chatId: string) {
    this.close()
    this.resetRenderState()
    this.setStatus('connecting')

    this.eventSource = this.options.createConnection(chatId)

    this.eventSource.onopen = () => {
      this.setStatus('streaming')
    }

    this.eventSource.onmessage = (event: MessageEvent) => {
      this.handleRawMessage(event.data)
    }

    this.eventSource.onerror = (error: Event) => {
      this.flushAll()
      this.setStatus('error')
      this.options.onError?.(error)
      this.close()
    }
  }

  abort() {
    if (!this.eventSource) {
      return
    }

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

  private handleRawMessage(rawData: string) {
    let data: StreamMessage
    try {
      data = JSON.parse(rawData) as StreamMessage
    } catch (error) {
      this.setStatus('error')
      this.options.onError?.(error)
      this.close()
      return
    }

    if (data.type === 'chunk') {
      this.addToRenderBuffer(data.content || '')
      return
    }

    if (data.type === 'complete') {
      this.flushAll()
      this.fullContent = data.content || this.fullContent
      this.setStatus('completed')
      this.options.onComplete?.(this.fullContent)
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
  }

  private setStatus(status: StreamStatus) {
    this.status = status
    this.options.onStatusChange?.(status)
  }
}
