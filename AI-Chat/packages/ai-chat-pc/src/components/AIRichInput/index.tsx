import {
  CoffeeOutlined,
  LinkOutlined,
  FireOutlined,
  SmileOutlined,
  CloseOutlined,
  StopOutlined
} from '@ant-design/icons'
import { Attachments, Prompts, Sender } from '@ant-design/x'
import { Button, message, Spin, type GetRef } from 'antd'
import React from 'react'
import { useEffect, useRef, useState } from 'react'
import SparkMD5 from 'spark-md5'

import {
  createSSE,
  getCheckFileAPI,
  postFileChunksAPI,
  postMergeFileAPI,
  sendChatMessage
} from '@pc/apis/chat'
import { sessionApi } from '@pc/apis/session'
import { BASE_URL, DEFAULT_MESSAGE } from '@pc/constant'
import { useChatStore, useConversationStore } from '@pc/store'
import { chatLocalDB, type PendingMessageRecord } from '@pc/utils/chatLocalDB'
import { isImageByExtension } from '@pc/utils/judgeImage'
import { StreamChatClient, type StreamStatus } from '@pc/utils/streamChatClient'

import type { PromptsProps } from '@ant-design/x'
import type { UploadFile } from 'antd'
import type { RcFile } from 'antd/es/upload'

// 切片的大小 - 使用2MB分片大小以提高上传效率
const CHUNK_SIZE = 1024 * 1024 * 2
// 并发上传数量
const CONCURRENT_UPLOADS = 3

interface ChunkInfo {
  index: number
  chunk: Blob
}

const AIRichInput = () => {
  const [isLoading, setIsLoading] = useState(false)
  const [inputLoading, setInputLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [hasInput, setHasInput] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [attachmentItems, setAttachmentItems] = useState<UploadFile[]>([])
  const attachmentsRef = useRef<GetRef<typeof Attachments>>(null)
  const senderRef = useRef<GetRef<typeof Sender>>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const idRef = useRef<string | null>(null)
  const streamClientRef = useRef<StreamChatClient | null>(null)
  const uploadedChunksRef = useRef<number[]>([])
  const fileChunksRef = useRef<ChunkInfo[]>([])
  const fileIdRef = useRef<string | null>(null)
  const fileNameRef = useRef<string | null>(null)
  const filePathRef = useRef<string | null>(null)
  const [showPrompts, setShowPrompts] = useState(true)
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('idle')
  const { messages, addMessage, addChunkMessage, mergeMessages, updateMessageStatus } =
    useChatStore()
  const { selectedId, setSelectedId, addConversation } = useConversationStore()

  useEffect(() => {
    return () => {
      streamClientRef.current?.close()
    }
  }, [])

  useEffect(() => {
    if (!selectedId) {
      return
    }

    chatLocalDB.getMessages(selectedId).then((localMessages) => {
      mergeMessages(selectedId, localMessages)
    })
  }, [mergeMessages, selectedId])

  useEffect(() => {
    const retryPendingMessages = async () => {
      const retryMessages = await chatLocalDB.getRetryableMessages()

      for (const item of retryMessages) {
        await retryPendingMessage(item)
      }
    }

    window.addEventListener('online', retryPendingMessages)

    if (navigator.onLine) {
      retryPendingMessages()
    }

    return () => {
      window.removeEventListener('online', retryPendingMessages)
    }
  }, [updateMessageStatus])

  // 监听输入值变化
  const handleInputChange = (value: string) => {
    setInputValue(value)
    setHasInput(!!value.trim())
  }

  const resetAttachmentState = () => {
    setAttachmentItems([])
    setOpen(false)
    fileIdRef.current = null
    fileNameRef.current = null
    filePathRef.current = null
    uploadedChunksRef.current = []
    fileChunksRef.current = []
  }
  // const [selectedImages, setSelectedImages] = useState<string[]>([])

  // const isImageRef = useRef(false)

  // 创建文件分片
  const createFileChunks = (file: File): ChunkInfo[] => {
    const chunks: ChunkInfo[] = []
    const chunksCount = Math.ceil(file.size / CHUNK_SIZE)

    for (let i = 0; i < chunksCount; i++) {
      const start = i * CHUNK_SIZE
      const end = Math.min(file.size, start + CHUNK_SIZE)
      const chunk = file.slice(start, end)
      chunks.push({
        index: i,
        chunk: chunk
      })
    }

    return chunks
  }

  // 计算单个分片的hash
  const calculateChunkHash = async (chunk: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const spark = new SparkMD5.ArrayBuffer()
      const reader = new FileReader()
      reader.readAsArrayBuffer(chunk)
      reader.onload = (e) => {
        if (e.target?.result) {
          spark.append(e.target.result as ArrayBuffer)
          resolve(spark.end())
        } else {
          reject(new Error('Failed to read chunk'))
        }
      }
      reader.onerror = () => reject(new Error('Error reading chunk'))
    })
  }

  // 计算文件hash（用于文件唯一标识）
  const calculateFileHash = async (fileChunks: ChunkInfo[]): Promise<string> => {
    return new Promise((resolve, reject) => {
      const spark = new SparkMD5.ArrayBuffer()
      const chunks: Blob[] = []

      fileChunks.forEach((chunk, index) => {
        if (index === 0 || index === fileChunks.length - 1) {
          // 第一个和最后一个切片的内容全部参与计算
          chunks.push(chunk.chunk)
        } else {
          // 中间剩余的切片分别在前面、后面和中间取2个字节参与计算
          chunks.push(chunk.chunk.slice(0, 2))
          chunks.push(chunk.chunk.slice(CHUNK_SIZE / 2, CHUNK_SIZE / 2 + 2))
          chunks.push(chunk.chunk.slice(CHUNK_SIZE - 2, CHUNK_SIZE))
        }
      })

      const reader = new FileReader()
      reader.readAsArrayBuffer(new Blob(chunks))
      reader.onload = (e) => {
        if (e.target?.result) {
          spark.append(e.target.result as ArrayBuffer)
          resolve(spark.end())
        } else {
          reject(new Error('Failed to read chunk'))
        }
      }
      reader.onerror = () => reject(new Error('Error reading file hash'))
    })
  }

  // 上传单个分片
  const uploadSingleChunk = async (
    chunk: ChunkInfo,
    fileId: string,
    fileName: string,
    controller: AbortController
  ): Promise<boolean> => {
    if (uploadedChunksRef.current.includes(chunk.index)) {
      console.log(`分片 ${chunk.index} 已上传，跳过`)
      return true
    }

    try {
      const chunkHash = await calculateChunkHash(chunk.chunk)
      const formData = new FormData()
      formData.append('fileId', fileId)
      formData.append('fileName', fileName)
      formData.append('index', String(chunk.index))
      formData.append('chunkHash', chunkHash)
      formData.append('chunk', chunk.chunk)

      const response = await postFileChunksAPI(formData, controller.signal)

      if (response) {
        uploadedChunksRef.current.push(chunk.index)
        return true
      } else {
        return false
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return false
      }
      return false
    }
  }

  // 并发上传分片
  const uploadChunksWithConcurrency = async (
    fileChunks: ChunkInfo[],
    fileId: string,
    fileName: string,
    uploaded: number[],
    controller: AbortController
  ): Promise<boolean> => {
    uploadedChunksRef.current = uploaded
    fileChunksRef.current = fileChunks

    const pendingChunks = fileChunks.filter(
      (chunk) => !uploadedChunksRef.current.includes(chunk.index)
    )

    if (pendingChunks.length === 0) {
      return true
    }

    console.log(`开始上传 ${pendingChunks.length} 个分片，并发数: ${CONCURRENT_UPLOADS}`)

    // 使用并发控制上传
    const chunksToUpload = [...pendingChunks]
    const uploadPromises: Promise<void>[] = []

    const uploadNext = async (): Promise<void> => {
      while (chunksToUpload.length > 0) {
        const chunk = chunksToUpload.shift()
        if (!chunk) break

        await uploadSingleChunk(chunk, fileId, fileName, controller)
      }
    }

    // 启动并发上传
    const concurrentUploads = Math.min(CONCURRENT_UPLOADS, chunksToUpload.length)
    for (let i = 0; i < concurrentUploads; i++) {
      uploadPromises.push(uploadNext())
    }

    await Promise.all(uploadPromises)

    // 检查是否所有分片都已上传
    const allUploaded = fileChunks.every((chunk) => uploadedChunksRef.current.includes(chunk.index))
    return allUploaded
  }

  const selectFile = async (file: RcFile) => {
    try {
      setIsLoading(true)

      // 判断是否为图片文件
      // if (file.type.startsWith('image/')) {
      //   isImageRef.current = true
      // } else {
      //   isImageRef.current = false
      // }

      const controller = new AbortController() //用于 取消异步请求
      abortControllerRef.current = controller
      const fileName = file.name
      fileNameRef.current = fileName

      // 创建切片
      const fileChunks = createFileChunks(file)

      // 计算整个文件的hash作为fileId
      const fileId = await calculateFileHash(fileChunks)
      fileIdRef.current = fileId

      // 分片上传前的校验
      const {
        data: { fileStatus, uploaded, filePath }
      } = await getCheckFileAPI(fileId, file.name, selectedId ? selectedId : '')

      if (fileStatus === 1) {
        message.success('文件上传成功')
        filePathRef.current = filePath || ''
        return
      } else {
        // 上传分片
        const success = await uploadChunksWithConcurrency(
          fileChunks,
          fileId,
          fileName,
          uploaded || [],
          controller
        )

        if (success) {
          // 合并文件
          const {
            data: { fileName: mergedFileName, filePath }
          } = await postMergeFileAPI({
            fileId,
            fileName: fileName,
            totalChunks: fileChunks.length
          })

          console.log('文件合并成功:', mergedFileName, filePath)

          filePathRef.current = filePath
          // if (isImageRef.current) {
          //   const imageUrl = `${BASE_URL}${filePath}`
          //   setSelectedImages((prev) => [...prev, imageUrl])
          // }

          message.success('文件上传完成！')
        } else {
          message.error('部分分片上传失败，请重试')
        }
      }
    } catch (error: unknown) {
      console.log('上传过程出错:', error)
      message.error('文件上传失败')
    } finally {
      setIsLoading(false)
      uploadedChunksRef.current = []
      fileChunksRef.current = []
    }
  }

  // 粘贴上传/文件框选择上传都会拦截至此处
  const handleFileUpload = (file: RcFile) => {
    selectFile(file)
    return false
  }

  // 取消文件上传
  const cancleUpload = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort() // 取消所有分片请求
      abortControllerRef.current = null
    }
    setIsLoading(false)
    resetAttachmentState()
    message.info('文件上传已取消')
  }

  const sendMessage = async (
    chatId: string,
    text: string,
    // images?: string[],
    fileId?: string,
    clientMessageId?: string
  ) => {
    try {
      await sendChatMessage({
        id: chatId,
        message: text,
        // imgUrl: images,
        fileId
      })

      if (clientMessageId) {
        updateMessageStatus(chatId, clientMessageId, 'sent')
        await chatLocalDB.markPendingStatus(clientMessageId, 'sent')
        await chatLocalDB.markMessageStatus(clientMessageId, 'sent')
      }
    } catch (error) {
      if (clientMessageId) {
        updateMessageStatus(chatId, clientMessageId, 'failed')
        await chatLocalDB.markPendingStatus(clientMessageId, 'failed')
        await chatLocalDB.markMessageStatus(clientMessageId, 'failed')
      }

      streamClientRef.current?.close()
      setInputLoading(false)
      setStreamStatus('error')
      message.error('消息发送失败，网络恢复后会自动重试')
      throw error
    }
    // .finally(() => {
    //   setSelectedImages([])
    // })
  }

  const retryPendingMessage = async (pendingMessage: PendingMessageRecord) => {
    if (!navigator.onLine) {
      return
    }

    try {
      await sendChatMessage({
        id: pendingMessage.chatId,
        message: pendingMessage.content,
        fileId: pendingMessage.fileId
      })
      updateMessageStatus(pendingMessage.chatId, pendingMessage.clientMessageId, 'sent')
      await chatLocalDB.markPendingStatus(pendingMessage.clientMessageId, 'sent')
      await chatLocalDB.markMessageStatus(pendingMessage.clientMessageId, 'sent')
    } catch {
      updateMessageStatus(pendingMessage.chatId, pendingMessage.clientMessageId, 'failed')
      await chatLocalDB.markPendingStatus(pendingMessage.clientMessageId, 'failed')
      await chatLocalDB.markMessageStatus(pendingMessage.clientMessageId, 'failed')
    }
  }

  const createSSEAndSendMessage = (
    chatId: string,
    message: string,
    // images?: string[],
    fileId?: string,
    clientMessageId?: string
  ) => {
    // console.log('images', fileId, images)
    streamClientRef.current?.close()
    streamClientRef.current = new StreamChatClient({
      createConnection: createSSE,
      flushInterval: 50,
      onChunk: addChunkMessage,
      onComplete: () => {
        setInputLoading(false)
      },
      onError: (error) => {
        console.error('SSE连接错误:', error)
        setInputLoading(false)
      },
      onStatusChange: setStreamStatus
    })

    streamClientRef.current.start(chatId)

    // sendMessage(chatId, message, images, fileId)
    sendMessage(chatId, message, fileId, clientMessageId).catch(() => undefined)
  }

  const stopGeneration = () => {
    streamClientRef.current?.abort()
    setInputLoading(false)
  }

  const submitMessage = async (message: string) => {
    if (inputLoading) {
      return
    }

    setInputLoading(true)
    const hasAttachment = !!fileIdRef.current
    const textMessage = message.trim() || (hasAttachment ? '请分析这个附件' : '')

    if (!textMessage && !hasAttachment) {
      setInputLoading(false)
      return
    }

    let clientMessageId: string | undefined
    // 新建会话，并将id与会话关联
    if (!selectedId) {
      const { data } = await sessionApi.createChat(message || '图片消息')
      const { id, title } = data
      idRef.current = id
      setSelectedId(id)
      addConversation({ id, title })
    }

    // 添加文件内容
    if (fileIdRef.current) {
      const fileIsImage = isImageByExtension(fileNameRef.current!)
      console.log(`${BASE_URL}${fileNameRef.current}`, 'xxxxxxxx')
      if (fileIsImage) {
        addMessage({
          content: [
            {
              type: 'image',
              content: filePathRef.current!
            }
          ],
          role: 'image'
        })
      } else {
        addMessage({
          content: [
            {
              type: 'file',
              content: {
                uid: fileIdRef.current,
                name: fileNameRef.current!
              }
            }
          ],
          role: 'file'
        })
      }
    }

    if (textMessage && (idRef.current || selectedId)) {
      const targetChatId = idRef.current || (selectedId as string)
      clientMessageId = chatLocalDB.createClientMessageId()
      const createdAt = Date.now()
      const userMessage = {
        id: clientMessageId,
        clientMessageId,
        sendStatus: 'pending' as const,
        createdAt,
        content: [
          {
            type: 'text' as const,
            content: textMessage
          }
        ],
        role: 'user' as const
      }

      addMessage(userMessage, targetChatId)
      await chatLocalDB.saveMessage(targetChatId, userMessage)
      await chatLocalDB.savePendingMessage({
        clientMessageId,
        chatId: targetChatId,
        content: textMessage,
        fileId: fileIdRef.current ? fileIdRef.current : undefined,
        createdAt
      })
    }

    // console.log('selectedImages', selectedImages)
    // 添加图片内容
    // selectedImages?.forEach((imageUrl) => {
    //   addMessage({
    //     content: [
    //       {
    //         type: 'image',
    //         content: imageUrl
    //       }
    //     ],
    //     role: 'image'
    //   })
    // })

    // const fileIsImage = validateImageAsync()

    if (idRef.current || selectedId) {
      // 建立sse连接，发送消息请求,并展示模型回复
      createSSEAndSendMessage(
        idRef.current || (selectedId as string),
        textMessage,
        // selectedImages.length > 0 ? selectedImages : undefined,
        fileIdRef.current ? fileIdRef.current : undefined,
        clientMessageId
      )
    }

    // 重置输入状态和清空输入框
    setHasInput(false)
    setInputValue('')
    resetAttachmentState()
  }

  const senderHeader = (
    <Sender.Header
      title="Attachments"
      styles={{
        content: {
          padding: 0
        }
      }}
      open={open}
      onOpenChange={setOpen}
      forceRender>
      <Spin
        spinning={isLoading}
        tip={
          <span
            style={{
              fontSize: '12px',
              color: '#ff4f39',
              cursor: 'pointer'
            }}
            onClick={cancleUpload}>
            点击取消
          </span>
        }>
        <Attachments
          ref={attachmentsRef}
          items={attachmentItems}
          onChange={({ fileList }) => setAttachmentItems(fileList)}
          styles={{
            placeholder: { backgroundColor: 'transparent' }
          }}
          beforeUpload={handleFileUpload}
          placeholder={(type) =>
            type === 'drop'
              ? {
                  title: '请将文件拖拽至此处'
                }
              : {
                  title: '文件上传',
                  description: '点击或拖拽上传文件'
                }
          }
          getDropContainer={() => senderRef.current?.nativeElement}
        />
      </Spin>
    </Sender.Header>
  )

  const showDefaultMessage = () => {
    if (!selectedId) {
      return <div className="text-2xl font-bold mb-10 text-center">{DEFAULT_MESSAGE}</div>
    }

    const chatInfo = messages.get(selectedId)

    if (chatInfo?.length !== 0) {
      return null
    }
  }

  const items: PromptsProps['items'] = [
    {
      key: '1',
      icon: <CoffeeOutlined style={{ color: '#964B00' }} />,
      description: 'How to rest effectively after long hours of work?',
      disabled: false
    },
    {
      key: '2',
      icon: <SmileOutlined style={{ color: '#FAAD14' }} />,
      description: 'What are the secrets to maintaining a positive mindset?',
      disabled: false
    },
    {
      key: '3',
      icon: <FireOutlined style={{ color: '#FF4D4F' }} />,
      description: 'How to stay calm under immense pressure?',
      disabled: false
    }
  ]

  // 处理提示建议点击
  const handlePromptClick: PromptsProps['onItemClick'] = (info) => {
    console.log('点击了提示建议:', info.data)

    const desc = info.data.description
    // Prompts 里 description 是 ReactNode，这里做一次类型保护
    if (typeof desc === 'string') {
      setInputValue(desc)
      setHasInput(true)
    }
  }

  return (
    <React.Fragment>
      <div
        className={`fixed w-1/2 z-50 ${!selectedId ? 'bottom-1/3' : 'bottom-0'} pb-[30px] bg-white`}>
        {showDefaultMessage()}
        {!inputLoading && !hasInput && showPrompts && (
          <div className="flex justify-between">
            <Prompts
              className="mb-4 mt-4"
              title="🤔 You might also want to ask:"
              items={items}
              vertical
              onItemClick={handlePromptClick}
            />

            {/* 关闭Prompts */}
            <div className="mt-2">
              <Button type="text" icon={<CloseOutlined />} onClick={() => setShowPrompts(false)} />
            </div>
          </div>
        )}

        <Sender
          ref={senderRef}
          value={inputValue}
          onChange={handleInputChange}
          header={senderHeader}
          prefix={<Button type="text" icon={<LinkOutlined />} onClick={() => setOpen(!open)} />}
          onPasteFile={(_, files) => {
            for (const file of files) {
              // 生成base64临时图片路径
              attachmentsRef.current?.upload(file)
            }
            setOpen(true)
          }}
          submitType="enter"
          placeholder="请输入您的问题"
          loading={inputLoading}
          onSubmit={(message) => submitMessage(message)}
        />
        {inputLoading && (
          <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
            <span>生成状态：{streamStatus}</span>
            <Button size="small" icon={<StopOutlined />} onClick={stopGeneration}>
              停止生成
            </Button>
          </div>
        )}
      </div>
    </React.Fragment>
  )
}

export default AIRichInput
