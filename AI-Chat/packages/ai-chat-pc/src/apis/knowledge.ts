import { request } from '@pc/utils'

import type {
  CreateKnowledgeBaseParams,
  IndexKnowledgeDocumentParams,
  KnowledgeBase,
  KnowledgeDocumentActionResponse,
  KnowledgeDocument,
  KnowledgeQueryParams,
  KnowledgeQueryResponse
} from '@pc/types/rag'

export const knowledgeApi = {
  createKnowledgeBase: (params: CreateKnowledgeBaseParams) => {
    return request<KnowledgeBase>('/knowledge-bases', 'POST', params)
  },

  getKnowledgeBases: () => {
    return request<KnowledgeBase[]>('/knowledge-bases', 'GET')
  },

  indexDocument: (knowledgeBaseId: string, params: IndexKnowledgeDocumentParams) => {
    return request<{
      documentId: string
      status: string
      chunkCount: number
    }>(`/knowledge-bases/${knowledgeBaseId}/documents`, 'POST', params)
  },

  uploadAndIndexDocument: (knowledgeBaseId: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)

    return request<{
      documentId: string
      status: string
      chunkCount: number
      fileName: string
      filePath: string
    }>(`/knowledge-bases/${knowledgeBaseId}/documents/upload`, 'POST', formData)
  },

  getDocuments: (knowledgeBaseId: string) => {
    return request<KnowledgeDocument[]>(`/knowledge-bases/${knowledgeBaseId}/documents`, 'GET')
  },

  retryDocument: (knowledgeBaseId: string, documentId: string) => {
    return request<KnowledgeDocumentActionResponse>(
      `/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/retry`,
      'POST'
    )
  },

  deleteDocument: (knowledgeBaseId: string, documentId: string) => {
    return request<KnowledgeDocumentActionResponse>(
      `/knowledge-bases/${knowledgeBaseId}/documents/${documentId}`,
      'DELETE'
    )
  },

  queryKnowledgeBase: (knowledgeBaseId: string, params: KnowledgeQueryParams) => {
    return request<KnowledgeQueryResponse>(`/knowledge-bases/${knowledgeBaseId}/query`, 'POST', params)
  }
}
