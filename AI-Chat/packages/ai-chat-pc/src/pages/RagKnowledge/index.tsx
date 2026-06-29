import {
  BookOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  SendOutlined
} from '@ant-design/icons'
import { Alert, Button, Card, Empty, Input, InputNumber, Select, Space, Spin, Tag, Typography } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'

import { knowledgeApi } from '@pc/apis/knowledge'

import type { KnowledgeBase, KnowledgeDocument, KnowledgeQueryResponse } from '@pc/types/rag'

const { Paragraph, Text, Title } = Typography

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
  const [creating, setCreating] = useState(false)
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
            <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_1fr_auto]">
              <Input
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
                placeholder="File name"
              />
              <Input
                value={filePath}
                onChange={(event) => setFilePath(event.target.value)}
                placeholder="File path"
              />
              <Input
                value={mimeType}
                onChange={(event) => setMimeType(event.target.value)}
                placeholder="MIME type"
              />
              <Button
                type="primary"
                loading={indexing}
                disabled={!selectedKnowledgeBaseId}
                onClick={handleIndexDocument}>
                Index
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
                          <Tag color={statusColor[doc.status]}>{doc.status}</Tag>
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
