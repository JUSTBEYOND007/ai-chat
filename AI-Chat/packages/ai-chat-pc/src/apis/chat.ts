import { EventSourcePolyfill } from 'event-source-polyfill'

import { BASE_URL } from '@pc/constant'
import { useUserStore } from '@pc/store'
import { request } from '@pc/utils/index'

import { type Data } from '../utils/request'

import type { checkRespType, mergeChunkType, mergeResType, SendMessageType } from '@pc/types/chat'

/**
 * 检查已上传的文件分片
 */
export const getCheckFileAPI = (fileId: string, fileName: string, chatId?: string) => {
  return request<checkRespType>(
    `/file/check?fileId=${fileId}&fileName=${fileName}&chatId=${chatId}`
  )
}

/**
 * 分片上传
 * @param data 文件对象
 */
export const postFileChunksAPI = (data: FormData, signal?: AbortSignal) => {
  return request<{
    chunkHash: string
  }>('/file/upload', 'POST', data, {
    signal
  })
}

/**
 * 分片合并
 */
export const postMergeFileAPI = (data: mergeChunkType) => {
  return request<mergeResType>('/file/merge', 'POST', data)
}

export const sendChatMessage = (data: SendMessageType): Promise<Data<object>> => {
  return request('chat/sendMessage', 'POST', data)
}

export type CancelGenerationResult = {
  generationId: string
  status: 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled'
  alreadyTerminal: boolean
}

export const cancelChatGeneration = (chatId: string, generationId: string) => {
  return request<CancelGenerationResult>(
    `chat/${chatId}/generations/${generationId}/cancel`,
    'POST'
  )
}

export type CreateSSEOptions = {
  generationId?: string
  afterSeq?: number
}

export const createSSE = (chatId: string, options: CreateSSEOptions = {}) => {
  const { token } = useUserStore.getState()
  const params = new URLSearchParams()

  if (options.generationId) {
    params.set('generationId', options.generationId)
  }

  if (typeof options.afterSeq === 'number' && options.afterSeq > 0) {
    params.set('afterSeq', String(options.afterSeq))
  }

  const query = params.toString()
  const url = `${BASE_URL}/chat/getChat/${chatId}${query ? `?${query}` : ''}`

  return new EventSourcePolyfill(url, {
    headers: {
      Authorization: token || ''
    }
  })
}
