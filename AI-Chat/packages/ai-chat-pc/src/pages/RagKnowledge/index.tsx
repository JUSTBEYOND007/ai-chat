import {
  BookOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  InboxOutlined,
  ReloadOutlined,
  SendOutlined
} from '@ant-design/icons'
import { Alert, Button, Card, Empty, Input, InputNumber, Popconfirm, Select, Space, Spin, Tag, Typography, Upload } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'

import { knowledgeApi } from '@pc/apis/knowledge'

import type { KnowledgeBase, KnowledgeDocument, KnowledgeQueryResponse } from '@pc/types/rag'

const { Paragraph, Text, Title } = Typography
const { Dragger } = Upload

const statusColor: Record<string, string> = {
  pending: 'default',
  parsing: 'processing',
  indexed: 'success',
  failed: 'error'
}

const sampleQuestions = [
  'What is the core workflow of a RAG system?',
  'What role does LangChain play in knowledge-base QA?',
  'Why can vector retrieval improve answer accuracy?'
]

export default function RagKnowledge() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState<string>()
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [newKnowledgeBaseName, setNewKnowledgeBaseName] = useState('')
  const [newKnowledgeBaseDescription, setNewKnowledgeBaseDescription] = useState('')
  const [fileName, setFileName] = useState('')
  const [filePath, setFilePath] = useState('')
  const [mimeType, setMimeType] = useState('')
  const [query, setQuery] = useState('')
  const [topK, setTopK] = useState(3)
  const [result, setResult] = useState<KnowledgeQueryResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [initLoading, setInitLoading] = useState(false)
  const [indexing, setIndexing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [documentActionId, setDocumentActionId] = useState<string>()
  const [error, setError] = useState<string | null>(null)
  const selectedKnowledgeBaseIdRef = useRef<string>()

  const loadKnowledgeBases = useCallback(async () => {
    setInitLoading(true)
    setError(null)

    try {
      const resp = await knowledgeApi.getKnowledgeBases()
      const nextKnowledgeBases = resp.data || []
      setKnowledgeBases(nextKnowledgeBases)
      setSelectedKnowledgeBaseId((currentId) => {
        if (currentId && nextKnowledgeBases.some((item) => item.id === currentId)) {
          return currentId
        }

        return nextKnowledgeBases[0]?.id
      })
    } catch (err) {
      console.error(err)
      setError('Failed to load knowledge bases. Please check the backend service.')
    } finally {
      setInitLoading(false)
    }
  }, [])

  const loadDocuments = useCallback(async (knowledgeBaseId?: string) => {
    setDocuments([])

    if (!knowledgeBaseId) {
      return
    }

    setInitLoading(true)
    setError(null)

    try {
      const resp = await knowledgeApi.getDocuments(knowledgeBaseId)
      if (selectedKnowledgeBaseIdRef.current === knowledgeBaseId) {
        setDocuments(resp.data || [])
      }
    } catch (err) {
      console.error(err)
      setError('Failed to load documents for the selected knowledge base.')
    } finally {
      setInitLoading(false)
    }
  }, [])

  useEffect(() => {
    loadKnowledgeBases()
  }, [loadKnowledgeBases])

  useEffect(() => {
    selectedKnowledgeBaseIdRef.current = selectedKnowledgeBaseId
    setResult(null)
    loadDocuments(selectedKnowledgeBaseId)
  }, [loadDocuments, selectedKnowledgeBaseId])

  const handleCreateKnowledgeBase = async () => {
    const name = newKnowledgeBaseName.trim()

    if (!name) {
      setError('Knowledge base name is required.')
      return
    }

    setCreating(true)
    setError(null)

    try {
      const resp = await knowledgeApi.createKnowledgeBase({
        name,
        description: newKnowledgeBaseDescription.trim() || undefined
      })
      const createdKnowledgeBase = resp.data

      setKnowledgeBases((current) => [createdKnowledgeBase, ...current])
      setSelectedKnowledgeBaseId(createdKnowledgeBase.id)
      setNewKnowledgeBaseName('')
      setNewKnowledgeBaseDescription('')
      setDocuments([])
      setResult(null)
    } catch (err) {
      console.error(err)
      setError('Failed to create the knowledge base.')
    } finally {
      setCreating(false)
    }
  }

  const handleIndexDocument = async () => {
    if (!selectedKnowledgeBaseId) {
      setError('Select a knowledge base before indexing a document.')
      return
    }

    const normalizedFileName = fileName.trim()
    const normalizedFilePath = filePath.trim()

    if (!normalizedFileName || !normalizedFilePath) {
      setError('File name and file path are required.')
      return
    }

    setIndexing(true)
    setError(null)

    try {
      await knowledgeApi.indexDocument(selectedKnowledgeBaseId, {
        fileName: normalizedFileName,
        filePath: normalizedFilePath,
        mimeType: mimeType.trim() || undefined
      })
      setFileName('')
      setFilePath('')
      setMimeType('')
      await loadDocuments(selectedKnowledgeBaseId)
    } catch (err) {
      console.error(err)
      setError('Failed to index the document. Please check file access and backend logs.')
    } finally {
      setIndexing(false)
    }
  }


  const handleUploadAndIndexDocument = async (file: File) => {
    if (!selectedKnowledgeBaseId) {
      setError('Select a knowledge base before uploading a document.')
      return false
    }

    const knowledgeBaseId = selectedKnowledgeBaseId
    setUploading(true)
    setError(null)

    try {
      await knowledgeApi.uploadAndIndexDocument(knowledgeBaseId, file)
      if (selectedKnowledgeBaseIdRef.current === knowledgeBaseId) {
        await loadDocuments(knowledgeBaseId)
      }
    } catch (err) {
      console.error(err)
      await loadDocuments(knowledgeBaseId)
      setError('Failed to upload and index the document. Please check file type, model config, or backend logs.')
    } finally {
      setUploading(false)
    }

    return false
  }

  const handleRetryDocument = async (documentId: string) => {
    if (!selectedKnowledgeBaseId) {
      return
    }

    const knowledgeBaseId = selectedKnowledgeBaseId
    setDocumentActionId(documentId)
    setError(null)

    try {
      await knowledgeApi.retryDocument(knowledgeBaseId, documentId)
      await loadDocuments(knowledgeBaseId)
    } catch (err) {
      console.error(err)
      setError('Failed to retry document indexing. Please check file access and model configuration.')
    } finally {
      setDocumentActionId(undefined)
    }
  }

  const handleDeleteDocument = async (documentId: string) => {
    if (!selectedKnowledgeBaseId) {
      return
    }

    const knowledgeBaseId = selectedKnowledgeBaseId
    setDocumentActionId(documentId)
    setError(null)

    try {
      await knowledgeApi.deleteDocument(knowledgeBaseId, documentId)
      setResult(null)
      await loadDocuments(knowledgeBaseId)
    } catch (err) {
      console.error(err)
      setError('Failed to remove the document from this knowledge base.')
    } finally {
      setDocumentActionId(undefined)
    }
  }

  const handleAsk = async (nextQuery = query) => {
    if (!selectedKnowledgeBaseId) {
      setError('Select a knowledge base before querying.')
      return
    }

    const normalizedQuery = nextQuery.trim()
    if (!normalizedQuery) {
      return
    }

    setQuery(normalizedQuery)
    setLoading(true)
    setError(null)
    const knowledgeBaseId = selectedKnowledgeBaseId

    try {
      const resp = await knowledgeApi.queryKnowledgeBase(knowledgeBaseId, {
        query: normalizedQuery,
        topK
      })

      if (selectedKnowledgeBaseIdRef.current === knowledgeBaseId) {
        setResult(resp.data)
      }
    } catch (err) {
      console.error(err)
      setError('Knowledge query failed. Please check model config, embedding service, or backend logs.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen overflow-y-auto bg-gray-50 px-8 py-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <div>
          <Title level={2} className="!mb-2 flex items-center gap-3">
            <DatabaseOutlined className="text-blue-500" />
            Knowledge Base QA
          </Title>
          <Paragraph className="!mb-0 text-gray-500">
            Manage knowledge bases, index documents, and query grounded answers with citations.
          </Paragraph>
        </div>

        {error && <Alert type="warning" showIcon message={error} />}

        <Card title="Knowledge Base">
          <Space direction="vertical" size="middle" className="w-full">
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <Input
                value={newKnowledgeBaseName}
                onChange={(event) => setNewKnowledgeBaseName(event.target.value)}
                placeholder="Knowledge base name"
              />
              <Input
                value={newKnowledgeBaseDescription}
                onChange={(event) => setNewKnowledgeBaseDescription(event.target.value)}
                placeholder="Description"
              />
              <Button type="primary" loading={creating} onClick={handleCreateKnowledgeBase}>
                Create
              </Button>
            </div>

            <Select
              placeholder="Select a knowledge base"
              value={selectedKnowledgeBaseId}
              loading={initLoading}
              className="w-full"
              options={knowledgeBases.map((item) => ({
                label: item.description ? `${item.name} - ${item.description}` : item.name,
                value: item.id
              }))}
              onChange={(value) => {
                setSelectedKnowledgeBaseId(value)
                setResult(null)
              }}
            />
          </Space>
        </Card>

        <Card title="Index Document">
          <Space direction="vertical" size="middle" className="w-full">
            <Dragger
              accept=".txt,.md,.markdown,.pdf"
              maxCount={1}
              showUploadList={false}
              beforeUpload={handleUploadAndIndexDocument}
              disabled={!selectedKnowledgeBaseId || uploading}
              className="bg-white">
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">
                {uploading ? 'Uploading and indexing document...' : 'Click or drag a TXT / Markdown / PDF file to index'}
              </p>
              <p className="ant-upload-hint">
                The backend stores the file under uploads/ and indexes it into pgvector automatically.
              </p>
            </Dragger>

            <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_1fr_auto]">
              <Input
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
                placeholder="File name"
              />
              <Input
                value={filePath}
                onChange={(event) => setFilePath(event.target.value)}
                placeholder="File path, e.g. uploads/demo.md"
              />
              <Input
                value={mimeType}
                onChange={(event) => setMimeType(event.target.value)}
                placeholder="MIME type"
              />
              <Button
                type="primary"
                loading={indexing}
                disabled={!selectedKnowledgeBaseId || uploading}
                onClick={handleIndexDocument}>
                Index Path
              </Button>
            </div>
          </Space>
        </Card>

        <Card>
          <Space direction="vertical" size="middle" className="w-full">
            <Text strong>Query</Text>
            <Input.TextArea
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onPressEnter={(event) => {
                if (!event.shiftKey) {
                  event.preventDefault()
                  handleAsk()
                }
              }}
              autoSize={{ minRows: 3, maxRows: 6 }}
              placeholder="Ask a question against the knowledge base"
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <InputNumber
                min={1}
                max={10}
                value={topK}
                onChange={(value) => setTopK(Math.min(value || 1, 10))}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={loading}
                disabled={!selectedKnowledgeBaseId}
                onClick={() => handleAsk()}>
                Query
              </Button>
            </div>

            <Space wrap>
              {sampleQuestions.map((item) => (
                <Button key={item} size="small" onClick={() => handleAsk(item)}>
                  {item}
                </Button>
              ))}
            </Space>
          </Space>
        </Card>

        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <Card
            title={
              <span className="flex items-center gap-2">
                <FileSearchOutlined />
                Answer
            </span>
          }>
            <Spin spinning={loading}>
              {result ? (
                <Space direction="vertical" size="middle" className="w-full">
                  <Paragraph className="whitespace-pre-wrap text-base leading-7">
                    {result.answer}
                  </Paragraph>
                  <Text type="secondary">Query: {result.query}</Text>
                </Space>
              ) : (
                <Empty description="Submit a question to see the RAG answer." />
              )}
            </Spin>
          </Card>

          <Space direction="vertical" size="middle" className="w-full">
            <Card title="Cited Sources">
              {result?.sources?.length ? (
                <Space direction="vertical" size="middle" className="w-full">
                  {result.sources.map((source, index) => (
                    <Card key={`${source.documentId}-${source.chunkIndex}-${index}`} size="small">
                      <Space direction="vertical" size="small" className="w-full">
                        <div className="flex items-start justify-between gap-2">
                          <Text strong>{source.fileName}</Text>
                          <Tag color="blue">Top {index + 1}</Tag>
                        </div>
                        <Space size={6} wrap>
                          <Tag>chunk {source.chunkIndex}</Tag>
                          <Tag color="green">score {source.score.toFixed(2)}</Tag>
                        </Space>
                        <Paragraph ellipsis={{ rows: 4, expandable: true, symbol: 'more' }}>
                          {source.content}
                        </Paragraph>
                      </Space>
                    </Card>
                  ))}
                </Space>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No cited sources yet." />
              )}
            </Card>

            <Card
              title={
                <span className="flex items-center gap-2">
                  <BookOutlined />
                  Documents
                </span>
            }>
              <Spin spinning={initLoading}>
                {documents.length ? (
                  <Space direction="vertical" size="small" className="w-full">
                    {documents.map((doc) => (
                      <div key={doc.id} className="rounded border border-gray-100 p-3">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <Text strong ellipsis>
                            {doc.fileName}
                          </Text>
                          <Space size={4}>
                            <Tag color={statusColor[doc.status]}>{doc.status}</Tag>
                            {doc.status === 'failed' && (
                              <Button
                                type="text"
                                size="small"
                                icon={<ReloadOutlined />}
                                loading={documentActionId === doc.id}
                                onClick={() => handleRetryDocument(doc.id)}>
                                Retry
                              </Button>
                            )}
                            <Popconfirm
                              title="Remove this document?"
                              description="This removes its chunks and citations from this knowledge base. The uploaded file is kept."
                              okText="Remove"
                              cancelText="Cancel"
                              onConfirm={() => handleDeleteDocument(doc.id)}>
                              <Button
                                danger
                                type="text"
                                size="small"
                                icon={<DeleteOutlined />}
                                loading={documentActionId === doc.id}>
                                Remove
                              </Button>
                            </Popconfirm>
                          </Space>
                        </div>
                        <Space size={6} wrap>
                          <Tag
                            style={{
                              backgroundColor: 'wheat',
                              borderColor: '#d8a84f',
                              color: '#5f3b00'
                              }}
                          >{doc.chunkCount} chunks</Tag>
                          {doc.mimeType && <Tag
                            style={{
                              backgroundColor: 'wheat',
                              borderColor: '#d8a84f',
                              color: '#5f3b00'
                              }}
                          >{doc.mimeType}</Tag>}
                        </Space>
                        {doc.errorMessage && (
                          <Paragraph
                            className="!mb-0 !mt-2 text-red-500"
                            ellipsis={{ rows: 2, expandable: true, symbol: 'more' }}>
                            {doc.errorMessage}
                          </Paragraph>
                        )}
                      </div>
                    ))}
                  </Space>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No documents." />
                )}
              </Spin>
            </Card>
          </Space>
        </div>
      </div>
    </div>
  )
}
