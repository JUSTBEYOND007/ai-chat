# Knowledge Base RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable knowledge-base RAG loop: create a knowledge base, index PDF/TXT/MD documents into PostgreSQL pgvector, ask questions, and display answer sources in the PC frontend.

**Architecture:** Use the existing NestJS `KnowledgeModule` as the persistent RAG backend and switch the existing React `RagKnowledge` page from the old in-memory `/agent/rag/*` demo APIs to `/knowledge-bases/*`. Keep indexing synchronous for this release, store vectors with raw pgvector SQL, and keep old agent RAG demo endpoints untouched.

**Tech Stack:** NestJS, TypeORM, PostgreSQL, pgvector, LangChain.js, DashScope OpenAI-compatible embeddings/chat, React, Vite, Ant Design, Axios.

---

## File Structure

Backend files:

- Modify: `AI-Chat-Be/src/knowledge/dto/create-knowledge-base.dto.ts`
  - Replace mojibake validation text with valid UTF-8 Chinese.
- Modify: `AI-Chat-Be/src/knowledge/dto/index-document.dto.ts`
  - Replace mojibake validation text and keep DTO contract.
- Modify: `AI-Chat-Be/src/knowledge/dto/rag-query.dto.ts`
  - Replace mojibake validation text and ensure numeric `topK` validation remains usable.
- Modify: `AI-Chat-Be/src/knowledge/knowledge.service.ts`
  - Repair user-facing messages and prompt.
  - Harden file-path resolution.
  - Make document indexing and query response shape reliable.
  - Keep pgvector raw SQL setup and vector writes.
- Modify: `AI-Chat-Be/src/knowledge/knowledge.service.spec.ts`
  - Add focused service tests for pure helper behavior and no-result query response.
- Modify: `AI-Chat-Be/src/knowledge/knowledge.controller.ts` only if service return types require controller signature cleanup.
  - Keep existing route names, but normalize formatting or return types if service contract changes.

Frontend files:

- Create: `AI-Chat/packages/ai-chat-pc/src/apis/knowledge.ts`
  - Real API wrapper for `/knowledge-bases/*`.
- Modify: `AI-Chat/packages/ai-chat-pc/src/types/rag.ts`
  - Replace old demo RAG types or add real knowledge-base types.
- Modify: `AI-Chat/packages/ai-chat-pc/src/pages/RagKnowledge/index.tsx`
  - Use real knowledge-base APIs.
  - Add create/select/index/query UI state.
  - Render document status and source cards.

Verification/doc files:

- Modify: `README.md` only if verification discovers missing setup instructions that block future local runs.
  - Add short note about knowledge-base RAG environment variables only if implementation discovers the root README is the right place.
- No change: `AI-Chat-Be/src/agent/services/rag.service.ts`
  - Leave old in-memory RAG demo in place.

## Response Shape Notes

The backend global `TransformInterceptor` wraps plain controller returns as:

```ts
{
  code: 1,
  msg: '请求成功',
  data: result
}
```

Frontend API wrappers should use the existing `request<T>()` helper and consume `response.data`.

---

### Task 1: Backend DTO And Message Cleanup

**Files:**

- Modify: `AI-Chat-Be/src/knowledge/dto/create-knowledge-base.dto.ts`
- Modify: `AI-Chat-Be/src/knowledge/dto/index-document.dto.ts`
- Modify: `AI-Chat-Be/src/knowledge/dto/rag-query.dto.ts`
- Modify: `AI-Chat-Be/src/knowledge/knowledge.service.ts`

- [ ] **Step 1: Replace DTO validation messages**

Update `AI-Chat-Be/src/knowledge/dto/create-knowledge-base.dto.ts` to:

```ts
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateKnowledgeBaseDto {
  @IsNotEmpty({ message: '知识库名称不能为空' })
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
```

Update `AI-Chat-Be/src/knowledge/dto/index-document.dto.ts` to:

```ts
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class IndexDocumentDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  fileId?: string;

  @IsNotEmpty({ message: '文件名不能为空' })
  @IsString()
  @MaxLength(255)
  fileName: string;

  @IsNotEmpty({ message: '文件路径不能为空' })
  @IsString()
  filePath: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  mimeType?: string;
}
```

Update `AI-Chat-Be/src/knowledge/dto/rag-query.dto.ts` to:

```ts
import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class RagQueryDto {
  @IsNotEmpty({ message: '问题不能为空' })
  @IsString()
  query: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  topK?: number = 5;
}
```

- [ ] **Step 2: Replace service mojibake strings**

In `AI-Chat-Be/src/knowledge/knowledge.service.ts`, replace all mojibake user-facing strings with valid UTF-8 Chinese. Use these exact strings:

```ts
'文档没有解析出可用文本'
`文档入库失败: ${savedDocument.errorMessage}`
'知识库中没有找到相关信息。'
`资料 ${index + 1}:\n文件: ${chunk.fileName}\n片段: ${chunk.content}`
'无法生成回答'
'知识库不存在或无权访问'
`文件不存在: ${localPath}`
`暂不支持的文档类型: ${extension || 'unknown'}`
`embedding 维度不一致，期望 ${this.embeddingDimension}，实际 ${embedding.length}`
```

Use this prompt body in `query()`:

```ts
const prompt = `你是一个严谨的知识库问答助手。请只根据给定资料回答问题。
如果资料中没有答案，请明确说明知识库中没有找到相关信息。

资料：
${context}

问题：
${ragQueryDto.query}

回答要求：
1. 使用中文回答。
2. 不要编造资料中没有的信息。
3. 尽量简洁。`;
```

- [ ] **Step 3: Run backend build to catch syntax problems**

Run:

```bash
cd AI-Chat-Be
pnpm run build
```

Expected: TypeScript build completes. If build fails because of pre-existing unrelated files, record the exact failure and continue only after confirming it is unrelated or fixing the relevant knowledge files.

- [ ] **Step 4: Commit DTO/message cleanup**

Run:

```bash
git add AI-Chat-Be/src/knowledge/dto/create-knowledge-base.dto.ts AI-Chat-Be/src/knowledge/dto/index-document.dto.ts AI-Chat-Be/src/knowledge/dto/rag-query.dto.ts AI-Chat-Be/src/knowledge/knowledge.service.ts
git commit -m "fix: clean up knowledge rag messages"
```

Expected: commit includes only the DTO and service message cleanup.

---

### Task 2: Backend Knowledge Service Hardening

**Files:**

- Modify: `AI-Chat-Be/src/knowledge/knowledge.service.ts`
- Modify if needed: `AI-Chat-Be/src/knowledge/knowledge.controller.ts`

- [ ] **Step 1: Normalize `RetrievedChunk` score and source fields**

In `AI-Chat-Be/src/knowledge/knowledge.service.ts`, keep the `RetrievedChunk` interface and ensure returned sources use:

```ts
sources: chunks.map((chunk) => ({
  documentId: chunk.documentId,
  fileName: chunk.fileName,
  chunkIndex: chunk.chunkIndex,
  content: chunk.content.slice(0, 300),
  score: Number(chunk.score),
})),
```

- [ ] **Step 2: Harden `resolveLocalFilePath`**

Replace `resolveLocalFilePath` with:

```ts
private resolveLocalFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const uploadsIndex = normalized.indexOf('/uploads/');

  if (uploadsIndex >= 0) {
    const relativePath = normalized.slice(uploadsIndex + '/uploads/'.length);
    return path.join(process.cwd(), 'uploads', relativePath);
  }

  if (normalized.startsWith('uploads/')) {
    return path.join(process.cwd(), normalized);
  }

  if (normalized.startsWith('/uploads/')) {
    return path.join(process.cwd(), normalized.slice(1));
  }

  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  return path.join(process.cwd(), filePath);
}
```

Then add a safety check inside `extractTextFromFile` immediately after `const localPath = this.resolveLocalFilePath(filePath);`:

```ts
const uploadsRoot = path.resolve(process.cwd(), 'uploads');
const resolvedPath = path.resolve(localPath);
if (filePath.includes('/uploads/') || filePath.startsWith('uploads') || filePath.startsWith('/uploads/')) {
  const isInsideUploads =
    resolvedPath === uploadsRoot || resolvedPath.startsWith(`${uploadsRoot}${path.sep}`);
  if (!isInsideUploads) {
    throw new Error('文件路径非法');
  }
}
```

- [ ] **Step 3: Make pgvector schema setup explicit**

In `ensureVectorSchema()`, keep:

```ts
await this.dataSource.query('CREATE EXTENSION IF NOT EXISTS vector');
await this.dataSource.query(
  `ALTER TABLE knowledge_chunk ADD COLUMN IF NOT EXISTS embedding vector(${this.embeddingDimension})`,
);
```

Keep the existing indexes. If local PostgreSQL reports ivfflat cannot be created on empty or unavailable vector extension, log the error and allow the app to start, as the current method already does.

- [ ] **Step 4: Run backend build**

Run:

```bash
cd AI-Chat-Be
pnpm run build
```

Expected: build succeeds or any unrelated failure is documented.

- [ ] **Step 5: Commit service hardening**

Run:

```bash
git add AI-Chat-Be/src/knowledge/knowledge.service.ts AI-Chat-Be/src/knowledge/knowledge.controller.ts
git commit -m "fix: harden knowledge document indexing"
```

Expected: commit contains knowledge service/controller changes only.

---

### Task 3: Backend Focused Tests

**Files:**

- Create or modify: `AI-Chat-Be/src/knowledge/knowledge.service.spec.ts`

- [ ] **Step 1: Create service test skeleton**

If `AI-Chat-Be/src/knowledge/knowledge.service.spec.ts` does not exist, create it. Use this structure:

```ts
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { KnowledgeBase } from './entities/knowledge-base.entity';
import { KnowledgeChunk } from './entities/knowledge-chunk.entity';
import { KnowledgeDocument } from './entities/knowledge-document.entity';
import { KnowledgeService } from './knowledge.service';

const repositoryMock = () => ({
  create: jest.fn((value) => value),
  save: jest.fn(async (value) => value),
  find: jest.fn(),
  findOne: jest.fn(),
  delete: jest.fn(),
});

describe('KnowledgeService', () => {
  let service: KnowledgeService;
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeService,
        {
          provide: getRepositoryToken(KnowledgeBase),
          useValue: repositoryMock(),
        },
        {
          provide: getRepositoryToken(KnowledgeDocument),
          useValue: repositoryMock(),
        },
        {
          provide: getRepositoryToken(KnowledgeChunk),
          useValue: repositoryMock(),
        },
        {
          provide: DataSource,
          useValue: dataSource,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const values: Record<string, string> = {
                DASHSCOPE_API_KEY: 'test-key',
                DASHSCOPE_BASE_URL: 'https://example.test/v1',
                DASHSCOPE_EMBEDDING_MODEL: 'text-embedding-v1',
                DASHSCOPE_EMBEDDING_DIMENSION: '3',
                DASHSCOPE_RAG_MODEL: 'qwen-long',
              };
              return values[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get(KnowledgeService);
  });

  it('formats pgvector values', () => {
    const vector = (service as unknown as { toPgVector: (embedding: number[]) => string }).toPgVector([
      0.1,
      0.2,
      0.3,
    ]);

    expect(vector).toBe('[0.1,0.2,0.3]');
  });

  it('throws when embedding dimension does not match config', () => {
    expect(() =>
      (service as unknown as { assertEmbeddingDimension: (embedding: number[]) => void }).assertEmbeddingDimension([
        0.1,
        0.2,
      ]),
    ).toThrow('embedding 维度不一致，期望 3，实际 2');
  });
});
```

- [ ] **Step 2: Run the focused backend test**

Run:

```bash
cd AI-Chat-Be
pnpm test -- knowledge.service.spec.ts
```

Expected: test passes. If TypeScript blocks access to private helper methods despite the `unknown` cast, adjust the cast in the spec, not production code.

- [ ] **Step 3: Run backend build**

Run:

```bash
cd AI-Chat-Be
pnpm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit backend tests**

Run:

```bash
git add AI-Chat-Be/src/knowledge/knowledge.service.spec.ts
git commit -m "test: cover knowledge rag helpers"
```

Expected: commit contains only the focused knowledge service spec.

---

### Task 4: Frontend Knowledge API And Types

**Files:**

- Create: `AI-Chat/packages/ai-chat-pc/src/apis/knowledge.ts`
- Modify: `AI-Chat/packages/ai-chat-pc/src/types/rag.ts`

- [ ] **Step 1: Replace or extend RAG types**

Update `AI-Chat/packages/ai-chat-pc/src/types/rag.ts` to:

```ts
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
```

- [ ] **Step 2: Add knowledge API wrapper**

Create `AI-Chat/packages/ai-chat-pc/src/apis/knowledge.ts`:

```ts
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
```

- [ ] **Step 3: Run frontend type build**

Run:

```bash
cd AI-Chat/packages/ai-chat-pc
pnpm run build
```

Expected: build may still fail because `RagKnowledge` imports old type names. That is acceptable at this step and will be fixed in Task 5. Record the first relevant type error.

- [ ] **Step 4: Commit API and types**

Run:

```bash
git add AI-Chat/packages/ai-chat-pc/src/apis/knowledge.ts AI-Chat/packages/ai-chat-pc/src/types/rag.ts
git commit -m "feat: add knowledge base frontend api"
```

Expected: commit includes only the new API wrapper and RAG type updates.

---

### Task 5: Frontend RAG Page Integration

**Files:**

- Modify: `AI-Chat/packages/ai-chat-pc/src/pages/RagKnowledge/index.tsx`

- [ ] **Step 1: Replace old agent API imports**

In `RagKnowledge/index.tsx`, remove:

```ts
import { agentApi } from '@pc/apis/agent'
import type { RagDocument, RagResponse } from '@pc/types/rag'
```

Add:

```ts
import { knowledgeApi } from '@pc/apis/knowledge'

import type { KnowledgeBase, KnowledgeDocument, KnowledgeQueryResponse } from '@pc/types/rag'
```

- [ ] **Step 2: Replace page state**

Use these state variables:

```ts
const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState<string>()
const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
const [newKnowledgeBaseName, setNewKnowledgeBaseName] = useState('')
const [newKnowledgeBaseDescription, setNewKnowledgeBaseDescription] = useState('')
const [fileName, setFileName] = useState('')
const [filePath, setFilePath] = useState('')
const [mimeType, setMimeType] = useState('')
const [query, setQuery] = useState('')
const [topK, setTopK] = useState(5)
const [result, setResult] = useState<KnowledgeQueryResponse | null>(null)
const [loading, setLoading] = useState(false)
const [initLoading, setInitLoading] = useState(false)
const [indexing, setIndexing] = useState(false)
const [creating, setCreating] = useState(false)
const [error, setError] = useState<string | null>(null)
```

- [ ] **Step 3: Add load helpers**

Add these functions inside the component:

```ts
const loadKnowledgeBases = async () => {
  setInitLoading(true)
  try {
    const resp = await knowledgeApi.getKnowledgeBases()
    const bases = resp.data || []
    setKnowledgeBases(bases)
    setSelectedKnowledgeBaseId((current) => current || bases[0]?.id)
  } catch (err) {
    console.error(err)
    setError('加载知识库失败，请检查后端服务。')
  } finally {
    setInitLoading(false)
  }
}

const loadDocuments = async (knowledgeBaseId: string) => {
  try {
    const resp = await knowledgeApi.getDocuments(knowledgeBaseId)
    setDocuments(resp.data || [])
  } catch (err) {
    console.error(err)
    setError('加载文档列表失败。')
  }
}
```

Use effects:

```ts
useEffect(() => {
  loadKnowledgeBases()
}, [])

useEffect(() => {
  if (selectedKnowledgeBaseId) {
    loadDocuments(selectedKnowledgeBaseId)
  } else {
    setDocuments([])
  }
}, [selectedKnowledgeBaseId])
```

- [ ] **Step 4: Add create/index/query handlers**

Add:

```ts
const handleCreateKnowledgeBase = async () => {
  const name = newKnowledgeBaseName.trim()
  if (!name) return

  setCreating(true)
  setError(null)
  try {
    const resp = await knowledgeApi.createKnowledgeBase({
      name,
      description: newKnowledgeBaseDescription.trim() || undefined
    })
    await loadKnowledgeBases()
    setSelectedKnowledgeBaseId(resp.data.id)
    setNewKnowledgeBaseName('')
    setNewKnowledgeBaseDescription('')
  } catch (err) {
    console.error(err)
    setError('创建知识库失败。')
  } finally {
    setCreating(false)
  }
}

const handleIndexDocument = async () => {
  if (!selectedKnowledgeBaseId || !fileName.trim() || !filePath.trim()) return

  setIndexing(true)
  setError(null)
  try {
    await knowledgeApi.indexDocument(selectedKnowledgeBaseId, {
      fileName: fileName.trim(),
      filePath: filePath.trim(),
      mimeType: mimeType.trim() || undefined
    })
    setFileName('')
    setFilePath('')
    setMimeType('')
    await loadDocuments(selectedKnowledgeBaseId)
  } catch (err) {
    console.error(err)
    setError('文档入库失败，请检查文件路径、模型配置或后端日志。')
  } finally {
    setIndexing(false)
  }
}

const handleAsk = async (nextQuery = query) => {
  const normalizedQuery = nextQuery.trim()
  if (!selectedKnowledgeBaseId || !normalizedQuery) return

  setQuery(normalizedQuery)
  setLoading(true)
  setError(null)
  try {
    const resp = await knowledgeApi.queryKnowledgeBase(selectedKnowledgeBaseId, {
      query: normalizedQuery,
      topK
    })
    setResult(resp.data)
  } catch (err) {
    console.error(err)
    setError('知识库问答失败，请检查模型配置、embedding 服务或后端日志。')
  } finally {
    setLoading(false)
  }
}
```

- [ ] **Step 5: Replace rendered UI with real knowledge-base controls**

Use this structure for the returned JSX. Keep imports aligned with the components used by the final file.

```tsx
return (
  <div className="h-screen overflow-y-auto bg-gray-50 px-8 py-6">
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div>
        <Title level={2} className="!mb-2 flex items-center gap-3">
          <DatabaseOutlined className="text-blue-500" />
          Knowledge Base QA
        </Title>
        <Paragraph className="!mb-0 text-gray-500">
          Create a knowledge base, index documents, ask questions, and inspect cited sources.
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
            <Button
              type="primary"
              icon={<DatabaseOutlined />}
              loading={creating}
              onClick={handleCreateKnowledgeBase}>
              Create
            </Button>
          </div>

          <Select
            allowClear
            showSearch
            loading={initLoading}
            value={selectedKnowledgeBaseId}
            placeholder="Select knowledge base"
            options={knowledgeBases.map((item) => ({ label: item.name, value: item.id }))}
            onChange={(value) => {
              setSelectedKnowledgeBaseId(value)
              setResult(null)
            }}
          />
        </Space>
      </Card>

      <Card title="Index Document">
        <Space direction="vertical" size="middle" className="w-full">
          <div className="grid gap-3 md:grid-cols-[1fr_2fr_1fr_auto]">
            <Input
              value={fileName}
              onChange={(event) => setFileName(event.target.value)}
              placeholder="example.pdf"
            />
            <Input
              value={filePath}
              onChange={(event) => setFilePath(event.target.value)}
              placeholder="uploads/example.pdf or http://localhost:3000/uploads/example.pdf"
            />
            <Input
              value={mimeType}
              onChange={(event) => setMimeType(event.target.value)}
              placeholder="application/pdf"
            />
            <Button
              icon={<BookOutlined />}
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
            placeholder="Ask a question against the selected knowledge base"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Select
              value={topK}
              style={{ width: 120 }}
              options={[3, 5, 8, 10].map((value) => ({ label: `Top ${value}`, value }))}
              onChange={setTopK}
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
            <Spin spinning={initLoading || indexing}>
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
                      <Text type="secondary">chunks: {doc.chunkCount}</Text>
                      {doc.errorMessage && (
                        <Paragraph className="!mb-0 !mt-2 text-red-500">
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
```

Use this status color helper:

```ts
const statusColor: Record<string, string> = {
  pending: 'default',
  parsing: 'processing',
  indexed: 'success',
  failed: 'error'
}
```

- [ ] **Step 6: Run frontend build**

Run:

```bash
cd AI-Chat/packages/ai-chat-pc
pnpm run build
```

Expected: TypeScript and Vite build succeed.

- [ ] **Step 7: Commit page integration**

Run:

```bash
git add AI-Chat/packages/ai-chat-pc/src/pages/RagKnowledge/index.tsx
git commit -m "feat: connect rag page to knowledge bases"
```

Expected: commit contains only the page integration.

---

### Task 6: End-To-End Verification Notes

**Files:**

- Modify if useful: `README.md` or `AI-Chat-Be/README.md`

- [ ] **Step 1: Run backend build**

Run:

```bash
cd AI-Chat-Be
pnpm run build
```

Expected: build succeeds.

- [ ] **Step 2: Run backend focused tests**

Run:

```bash
cd AI-Chat-Be
pnpm test -- knowledge.service.spec.ts
```

Expected: focused knowledge tests pass.

- [ ] **Step 3: Run frontend build**

Run:

```bash
cd AI-Chat/packages/ai-chat-pc
pnpm run build
```

Expected: build succeeds.

- [ ] **Step 4: Manual local verification when services are available**

Start PostgreSQL/Redis:

```bash
cd AI-Chat-Be
docker compose up -d
```

Start backend:

```bash
cd AI-Chat-Be
pnpm run start:dev
```

Start frontend:

```bash
cd AI-Chat/packages/ai-chat-pc
pnpm run dev
```

Manual checks:

1. Log in.
2. Open the RAG knowledge page.
3. Create a knowledge base named `测试知识库`.
4. Provide an existing local uploads file such as `uploads/example.md` or an uploads URL returned by the file merge API.
5. Index the document.
6. Confirm the document status becomes `indexed`.
7. Ask a question whose answer exists in the document.
8. Confirm answer and sources render.
9. Ask an unrelated question.
10. Confirm the answer states no relevant information was found.

If Docker, DashScope credentials, or network access are unavailable, record the exact blocker in the final implementation summary instead of claiming full manual success.

- [ ] **Step 5: Commit docs only if changed**

If environment instructions are added, run:

```bash
git add README.md AI-Chat-Be/README.md
git commit -m "docs: document knowledge rag setup"
```

Expected: commit only includes docs touched during verification.

---

## Final Acceptance Checklist

- [ ] Backend DTOs and service no longer contain mojibake user-facing RAG messages.
- [ ] `/knowledge-bases` can create and list user knowledge bases.
- [ ] `/knowledge-bases/:id/documents` can index TXT/MD/PDF files.
- [ ] `knowledge_chunk.embedding` is initialized as pgvector.
- [ ] Query endpoint returns `answer`, `sources`, `query`, and `knowledgeBaseId`.
- [ ] Frontend page no longer depends on `/agent/rag/*`.
- [ ] Frontend can create/select a knowledge base, index a document, query it, and show sources.
- [ ] Backend build has been run.
- [ ] Frontend build has been run.
- [ ] Any blocked integration verification is clearly documented.
