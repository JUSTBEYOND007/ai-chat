import { request } from '@pc/utils'

import type { AgentApiResponse, RagDocument, RagQueryParams, RagResponse } from '@pc/types/rag'

export const agentApi = {
  ragQuery: (params: RagQueryParams) => {
    return request<AgentApiResponse<RagResponse>>(
      '/agent/rag/query',
      'POST',
      params
    ) as unknown as Promise<AgentApiResponse<RagResponse>>
  },

  getRagDocuments: () => {
    return request<AgentApiResponse<RagDocument[]>>(
      '/agent/rag/documents',
      'GET'
    ) as unknown as Promise<AgentApiResponse<RagDocument[]>>
  },

  getRagCategories: () => {
    return request<AgentApiResponse<string[]>>(
      '/agent/rag/categories',
      'GET'
    ) as unknown as Promise<AgentApiResponse<string[]>>
  }
}
