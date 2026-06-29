# Knowledge Base RAG Design

Date: 2026-06-29

## Goal

Build a usable knowledge-base RAG flow in the existing AI Chat project:

```text
Create knowledge base
-> import document
-> split document into chunks
-> generate embeddings
-> write chunks and vectors into PostgreSQL pgvector
-> retrieve relevant chunks for a question
-> ask the LLM to answer from retrieved context
-> return answer + sources
```

The first release should be a complete product loop, not only a backend demo. A user should be able to create a knowledge base, index a PDF/TXT/MD file, ask a question, and see both the generated answer and cited sources in the PC frontend.

## Current Project Context

The repository already contains a strong starting point:

- Backend: `AI-Chat-Be` is a NestJS app using TypeORM.
- Database: the backend has already been moved toward PostgreSQL, with `pgvector/pgvector:pg16` in `docker-compose.yml` and `CREATE EXTENSION IF NOT EXISTS vector` in `init.sql`.
- Existing upload flow: `file` module supports chunked upload and merge into local `uploads/`.
- Existing RAG demo: `agent/rag/*` uses an in-memory vector store and sample documents.
- New knowledge module: `src/knowledge` already contains entities, DTOs, controller, and a first version of `KnowledgeService`.
- Frontend: `RagKnowledge` page currently calls the old `/agent/rag/*` demo APIs instead of the new knowledge-base APIs.

The implementation should build on `src/knowledge` and stop using the old in-memory agent RAG demo for the user-facing knowledge-base page.

## Recommended Approach

Use the existing `knowledge` module as the main implementation path.

This is preferred over keeping the old `/agent/rag/*` demo because the old path is in-memory and loses indexed documents on restart. It is also preferred over creating a brand-new module because the current `knowledge` module already models the right database entities and pgvector flow.

The old agent RAG endpoints can remain as demo endpoints for now, but the frontend knowledge-base page should use `/knowledge-bases/*`.

## Scope

### In Scope

- Create and list knowledge bases for the logged-in user.
- Index PDF, TXT, and Markdown documents.
- Store document records and chunk records in PostgreSQL.
- Store embeddings in a pgvector column.
- Retrieve topK chunks by vector similarity.
- Generate an answer from retrieved chunks with an LLM.
- Return `answer`, `sources`, `query`, and `knowledgeBaseId`.
- Update the frontend RAG page to use the real knowledge-base APIs.
- Show document indexing status and failure reason.
- Show cited sources next to the answer.
- Keep ownership checks so users can only access their own knowledge bases.

### Out of Scope for First Release

- SSE streaming RAG answers.
- Background job queue for long document indexing.
- OCR for scanned PDFs.
- Deleting documents and rebuilding indexes.
- Hybrid keyword + vector search.
- Agent tool-calling integration.
- Persisting RAG answers into the chat message table.

These can be added after the core loop works.

## Backend Design

### Module Boundary

`KnowledgeModule` owns persistent knowledge-base RAG.

It depends on:

- TypeORM repositories for `KnowledgeBase`, `KnowledgeDocument`, and `KnowledgeChunk`.
- `DataSource` for raw pgvector SQL queries and vector column updates.
- `ConfigService` for model, API, and embedding dimension configuration.
- LangChain `OpenAIEmbeddings` and `ChatOpenAI` configured against DashScope's OpenAI-compatible endpoint.

The existing `AgentModule` RAG demo should not be used by the knowledge-base page.

### Entities

`KnowledgeBase`

- `id`: uuid
- `userId`: owner id
- `name`: display name
- `description`: optional text
- `isActive`: soft-active flag
- `createdAt`, `updatedAt`

`KnowledgeDocument`

- `id`: uuid
- `knowledgeBaseId`: parent knowledge base
- `fileId`: optional upload file id
- `fileName`: original file name
- `filePath`: local or uploads URL path
- `mimeType`: optional MIME type
- `status`: `pending | parsing | indexed | failed`
- `errorMessage`: failure detail
- `chunkCount`: indexed chunk count
- `createdAt`, `updatedAt`

`KnowledgeChunk`

- `id`: uuid
- `documentId`
- `knowledgeBaseId`
- `chunkIndex`
- `content`
- `tokenCount`
- `metadata`
- `embedding`: pgvector column added by schema initialization
- `createdAt`

The vector column remains managed with raw SQL because TypeORM does not natively model pgvector cleanly.

### Configuration

Use these environment variables:

- `DASHSCOPE_API_KEY`
- `DASHSCOPE_BASE_URL`, default `https://dashscope.aliyuncs.com/compatible-mode/v1`
- `DASHSCOPE_EMBEDDING_MODEL`, default `text-embedding-v1`
- `DASHSCOPE_EMBEDDING_DIMENSION`, default `1536`
- `DASHSCOPE_RAG_MODEL`, default `qwen-long`

The implementation must validate that generated embedding length equals `DASHSCOPE_EMBEDDING_DIMENSION`. A mismatch should fail indexing or querying with a clear message.

### API Contract

Create knowledge base:

```http
POST /knowledge-bases
```

Request:

```json
{
  "name": "Project Docs",
  "description": "Optional description"
}
```

List knowledge bases:

```http
GET /knowledge-bases
```

Index document:

```http
POST /knowledge-bases/:id/documents
```

Request:

```json
{
  "fileId": "optional-file-id",
  "fileName": "example.pdf",
  "filePath": "http://localhost:3000/uploads/example.pdf",
  "mimeType": "application/pdf"
}
```

List documents:

```http
GET /knowledge-bases/:id/documents
```

Query:

```http
POST /knowledge-bases/:id/query
```

Request:

```json
{
  "query": "What does this document say about deployment?",
  "topK": 5
}
```

Response:

```json
{
  "answer": "Generated answer",
  "sources": [
    {
      "documentId": "doc-id",
      "fileName": "example.pdf",
      "chunkIndex": 3,
      "content": "Short source excerpt",
      "score": 0.82
    }
  ],
  "query": "What does this document say about deployment?",
  "knowledgeBaseId": "kb-id"
}
```

The current global transform interceptor may wrap this response. The frontend should follow the actual project response convention.

### Document Indexing Flow

1. Check the user owns the knowledge base.
2. Create a `KnowledgeDocument` with `pending` status.
3. Set status to `parsing`.
4. Resolve `filePath` to a safe local path under `uploads/` when it is an uploads URL.
5. Extract text:
   - `.txt` and `.md`: read as UTF-8.
   - `.pdf`: use `pdf-parse`.
6. If extracted text is empty, mark the document as `failed`.
7. Split text with `RecursiveCharacterTextSplitter`.
   - Initial chunk size: 1000.
   - Initial overlap: 200.
8. For each non-empty chunk:
   - Generate embedding.
   - Validate embedding dimension.
   - Save the chunk without embedding through TypeORM.
   - Update the pgvector column with raw SQL.
9. Set document status to `indexed`, update `chunkCount`, clear `errorMessage`.
10. On any failure, set status to `failed`, save `errorMessage`, and return a clear HTTP error.

This flow is synchronous in the first release. Large documents may take time, but the first implementation stays simple and observable.

### Query Flow

1. Check the user owns the knowledge base.
2. Generate embedding for the question.
3. Query `knowledge_chunk` by cosine distance:

```sql
ORDER BY kc.embedding <=> $1::vector
```

4. Join `knowledge_document` to include `fileName`.
5. If no chunks are found, return a no-answer response with empty `sources`.
6. Build a Chinese RAG prompt instructing the model to answer only from retrieved sources.
7. Invoke the LLM.
8. Return the generated answer and source excerpts.

### Error Handling

Use clear Chinese messages for user-facing errors:

- Knowledge base not found or no permission.
- File does not exist.
- Unsupported document type.
- No text extracted from document.
- Embedding dimension mismatch.
- Document indexing failed.
- Knowledge base has no relevant information.

The current files contain mojibake strings. The implementation should replace them with valid UTF-8 Chinese text.

## Frontend Design

### API Layer

Add a real knowledge API module, for example:

```text
AI-Chat/packages/ai-chat-pc/src/apis/knowledge.ts
```

It should include:

- `createKnowledgeBase`
- `getKnowledgeBases`
- `indexDocument`
- `getDocuments`
- `queryKnowledgeBase`

Update RAG types so they match the new backend response. Avoid reusing old demo-only fields such as `category` and `title` for real sources.

### Page Flow

Update:

```text
AI-Chat/packages/ai-chat-pc/src/pages/RagKnowledge/index.tsx
```

The page should support:

- Creating a knowledge base.
- Selecting a knowledge base.
- Uploading or entering a file from the existing upload result.
- Triggering document indexing.
- Listing indexed documents with status and chunk count.
- Asking a question against the selected knowledge base.
- Showing answer text.
- Showing cited source cards with file name, score, chunk index, and excerpt.

The first release should prefer a direct, practical interface over a polished redesign. The existing Ant Design components are sufficient.

### Upload Integration

The existing file module returns `filePath` and `fileName` after merge. The knowledge page should use those values to call `indexDocument`.

If a reusable frontend upload helper already exists, reuse it. If the current upload flow is tightly coupled to chat, the first release may provide a simple manual indexing form with `fileName`, `filePath`, and `mimeType`, then improve the upload UI in the implementation pass.

## Testing And Verification

### Backend

- Run TypeScript build.
- Run unit tests if existing tests are stable.
- Add focused tests around service helper behavior where practical:
  - file path resolution
  - unsupported extension rejection
  - empty document handling
  - response shaping for no retrieval results

Full embedding and pgvector integration requires valid model credentials and a running PostgreSQL pgvector instance. When those are not available, document the blocked verification explicitly.

### Frontend

- Run TypeScript build or the package's existing verification command.
- Verify the RAG page can render with empty state.
- Verify API type usage compiles.

### Manual Acceptance

With backend, PostgreSQL, Redis, and DashScope config running:

1. Log in.
2. Create a knowledge base.
3. Upload or provide a TXT/MD/PDF file path.
4. Index the document.
5. Confirm document status becomes `indexed`.
6. Ask a question based on the document.
7. Confirm the answer is grounded in the document.
8. Confirm sources include file name, chunk index, excerpt, and score.
9. Ask an unrelated question and confirm the system does not invent an answer.

## Implementation Phases

### Phase 1: Backend RAG Completion

- Repair mojibake strings in `knowledge` DTOs and service.
- Confirm entities and module registration.
- Make schema initialization idempotent.
- Harden document indexing and query errors.
- Normalize response shape.

### Phase 2: Frontend Connection

- Add `knowledgeApi`.
- Update RAG types.
- Replace old `/agent/rag/*` calls in `RagKnowledge`.
- Add create/select/index/query states.
- Render sources from real backend responses.

### Phase 3: Verification

- Run backend build/tests.
- Run frontend build/typecheck.
- Manually verify as much of the flow as local services and credentials allow.

### Phase 4: Cleanup Notes

- Leave old `agent/rag/*` demo endpoints in place unless removal is requested.
- Add comments or docs that the product knowledge-base flow is `/knowledge-bases/*`.
- Record follow-up items for streaming, document deletion, and chat-history integration.

## Risks

- `DASHSCOPE_EMBEDDING_DIMENSION` may not match the configured embedding model.
- PDF parsing can fail for scanned or image-only PDFs.
- Synchronous indexing can be slow for large documents.
- Existing response interceptors may require frontend response unwrapping adjustments.
- The current upload UI may be chat-oriented, so the first usable version may need a small dedicated upload/indexing flow.

## Success Criteria

- A logged-in user can create a knowledge base.
- A logged-in user can index a PDF/TXT/MD document into that knowledge base.
- Chunks and embeddings are persisted in PostgreSQL pgvector.
- A question retrieves relevant chunks from pgvector.
- The LLM answer is based on retrieved context.
- The response includes `answer + sources`.
- The frontend page uses the real knowledge-base APIs and displays sources.
