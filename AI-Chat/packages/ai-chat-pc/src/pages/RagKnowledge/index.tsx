import {
  BookOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  SendOutlined
} from '@ant-design/icons'
import { Alert, Button, Card, Empty, Input, Select, Space, Spin, Tag, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'

import { agentApi } from '@pc/apis/agent'

import type { RagDocument, RagResponse } from '@pc/types/rag'

const { Paragraph, Text, Title } = Typography

const sampleQuestions = [
  'What is the core workflow of a RAG system?',
  'What role does LangChain play in knowledge-base QA?',
  'Why can vector retrieval improve answer accuracy?'
]

export default function RagKnowledge() {
  const [query, setQuery] = useState('')
  const [topK, setTopK] = useState(3)
  const [category, setCategory] = useState<string>()
  const [categories, setCategories] = useState<string[]>([])
  const [documents, setDocuments] = useState<RagDocument[]>([])
  const [result, setResult] = useState<RagResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [initLoading, setInitLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadMeta = async () => {
      setInitLoading(true)
      try {
        const [categoryResp, documentResp] = await Promise.all([
          agentApi.getRagCategories(),
          agentApi.getRagDocuments()
        ])

        setCategories(categoryResp.data || [])
        setDocuments(documentResp.data || [])
      } catch (err) {
        console.error(err)
        setError('Failed to load RAG metadata. Please check the backend RAG service.')
      } finally {
        setInitLoading(false)
      }
    }

    loadMeta()
  }, [])

  const filteredDocuments = useMemo(() => {
    if (!category) {
      return documents
    }

    return documents.filter((doc) => doc.category === category)
  }, [category, documents])

  const handleAsk = async (nextQuery = query) => {
    const normalizedQuery = nextQuery.trim()
    if (!normalizedQuery) {
      return
    }

    setQuery(normalizedQuery)
    setLoading(true)
    setError(null)

    try {
      const resp = await agentApi.ragQuery({
        query: normalizedQuery,
        k: topK,
        categories: category ? [category] : undefined
      })

      setResult(resp.data)
    } catch (err) {
      console.error(err)
      setError('RAG query failed. Please check model config, embedding service, or backend logs.')
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
            RAG demo based on document chunking, embedding indexing, and similarity retrieval.
          </Paragraph>
        </div>

        {error && <Alert type="warning" showIcon message={error} />}

        <Card>
          <Space direction="vertical" size="middle" className="w-full">
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
              <Space wrap>
                <Select
                  allowClear
                  placeholder="All categories"
                  value={category}
                  loading={initLoading}
                  style={{ width: 180 }}
                  options={categories.map((item) => ({ label: item, value: item }))}
                  onChange={setCategory}
                />
                <Select
                  value={topK}
                  style={{ width: 120 }}
                  options={[3, 5, 8].map((value) => ({ label: `Top ${value}`, value }))}
                  onChange={setTopK}
                />
              </Space>
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={loading}
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
                    <Card key={`${source.id}-${index}`} size="small">
                      <Space direction="vertical" size="small" className="w-full">
                        <div className="flex items-start justify-between gap-2">
                          <Text strong>{source.title}</Text>
                          <Tag color="blue">Top {index + 1}</Tag>
                        </div>
                        <Space size={6} wrap>
                          <Tag>{source.category}</Tag>
                          {typeof source.score === 'number' && (
                            <Tag color="green">score {source.score.toFixed(2)}</Tag>
                          )}
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
                {filteredDocuments.length ? (
                  <Space direction="vertical" size="small" className="w-full">
                    {filteredDocuments.slice(0, 6).map((doc) => (
                      <div key={doc.id} className="rounded border border-gray-100 p-3">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <Text strong ellipsis>
                            {doc.title}
                          </Text>
                          <Tag>{doc.category}</Tag>
                        </div>
                        <Paragraph
                          className="!mb-0 text-gray-500"
                          ellipsis={{ rows: 2, expandable: false }}>
                          {doc.content}
                        </Paragraph>
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
