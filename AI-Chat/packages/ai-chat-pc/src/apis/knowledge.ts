import { request } from '@pc/utils'

import type {
  CreateKnowledgeBaseParams,
  IndexKnowledgeDocumentParams,
  KnowledgeBase,
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

  getDocuments: (knowledgeBaseId: string) => {
    return request<KnowledgeDocument[]>(`/knowledge-bases/${knowledgeBaseId}/documents`, 'GET')
  },

  queryKnowledgeBase: (knowledgeBaseId: string, params: KnowledgeQueryParams) => {
    return request<KnowledgeQueryResponse>(`/knowledge-bases/${knowledgeBaseId}/query`, 'POST', params)
  }
}
