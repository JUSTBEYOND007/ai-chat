export type RagQueryParams = {
  query: string
  k?: number
  categories?: string[]
  scoreThreshold?: number
}

export type RagSource = {
  id: string
  title: string
  category: string
  score?: number
  content: string
}

export type RagResponse = {
  answer: string
  sources: RagSource[]
  query: string
  timestamp: string
}

export type RagDocument = {
  id: string
  title: string
  content: string
  category: string
  metadata?: Record<string, unknown>
}

export type AgentApiResponse<T> = {
  success: boolean
  data: T
}
