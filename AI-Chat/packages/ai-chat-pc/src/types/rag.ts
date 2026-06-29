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

export type KnowledgeBase = {
  id: string
  userId: number
  name: string
  description?: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type KnowledgeDocumentStatus = 'pending' | 'parsing' | 'indexed' | 'failed'

export type KnowledgeDocument = {
  id: string
  knowledgeBaseId: string
  fileId?: string | null
  fileName: string
  filePath: string
  mimeType?: string | null
  status: KnowledgeDocumentStatus
  errorMessage?: string | null
  chunkCount: number
  createdAt: string
  updatedAt: string
}

export type CreateKnowledgeBaseParams = {
  name: string
  description?: string
}

export type IndexKnowledgeDocumentParams = {
  fileId?: string
  fileName: string
  filePath: string
  mimeType?: string
}

export type KnowledgeQueryParams = {
  query: string
  topK?: number
}

export type KnowledgeSource = {
  documentId: string
  fileName: string
  chunkIndex: number
  content: string
  score: number
}

export type KnowledgeQueryResponse = {
  answer: string
  sources: KnowledgeSource[]
  query: string
  knowledgeBaseId: string
}
