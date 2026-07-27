import { AgentContext, AgentToolError } from '../contracts';
import { KnowledgeService } from 'src/knowledge/knowledge.service';
import { KnowledgeSearchTool } from './knowledge-search.tool';

describe('KnowledgeSearchTool', () => {
  const context: AgentContext = {
    userId: 42,
    chatId: 'chat-id',
    generationId: 'generation-id',
  };

  it('requires a server-injected knowledge base id', async () => {
    const knowledgeService = {
      searchForTool: jest.fn(),
    } as unknown as KnowledgeService;
    const tool = new KnowledgeSearchTool(knowledgeService);

    await expect(
      tool.execute({ query: '如何实现断点续传？', topK: 5 }, context),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentToolError>>({
        code: 'KNOWLEDGE_BASE_REQUIRED',
      }),
    );
    expect(knowledgeService.searchForTool).not.toHaveBeenCalled();
  });

  it('searches only the selected knowledge base owned by the current user', async () => {
    const sources = [
      {
        documentId: 'document-id',
        fileName: 'upload.md',
        chunkIndex: 0,
        content: '断点续传使用 uploadId 与分片序号。',
        score: 0.92,
      },
    ];
    const retrievalTrace = {
      version: '1.0' as const,
      strategy: 'hybrid_rrf' as const,
      knowledgeBaseId: 'knowledge-base-id',
      originalQuery: '如何实现断点续传？',
      effectiveQuery: 'Flow-Chat 如何实现断点续传？',
      rewrittenQuery: 'Flow-Chat 如何实现断点续传？',
      rewrite: {
        mode: 'auto' as const,
        status: 'rewritten' as const,
        reason: 'completed' as const,
        durationMs: 10,
        historyMessageCount: 2,
        usedSummary: false,
      },
      topK: 3,
      candidates: [],
      channels: [],
      timings: {
        rewriteMs: 10,
        embeddingMs: 1,
        vectorSearchMs: 2,
        keywordSearchMs: 3,
        fusionMs: 1,
        totalMs: 17,
      },
      generatedAt: new Date().toISOString(),
    };
    const knowledgeService = {
      searchForTool: jest.fn().mockResolvedValue({
        sources,
        trace: retrievalTrace,
      }),
    } as unknown as KnowledgeService;
    const tool = new KnowledgeSearchTool(knowledgeService);

    await expect(
      tool.execute(
        { query: '如何实现断点续传？', topK: 3 },
        { ...context, knowledgeBaseId: 'knowledge-base-id' },
      ),
    ).resolves.toEqual({
      code: 'OK',
      query: '如何实现断点续传？',
      effectiveQuery: 'Flow-Chat 如何实现断点续传？',
      knowledgeBaseId: 'knowledge-base-id',
      sources,
      retrievalTrace,
    });
    expect(knowledgeService.searchForTool).toHaveBeenCalledWith(
      'knowledge-base-id',
      '如何实现断点续传？',
      3,
      42,
      undefined,
      { history: undefined, summary: undefined },
    );
  });

  it('returns a structured no-context result when no candidate is selected', async () => {
    const trace = {
      version: '1.0' as const,
      strategy: 'hybrid_rrf' as const,
      knowledgeBaseId: 'knowledge-base-id',
      originalQuery: '不存在的信息',
      effectiveQuery: '不存在的信息',
      rewrite: {
        mode: 'auto' as const,
        status: 'skipped' as const,
        reason: 'not_needed' as const,
        durationMs: 0,
        historyMessageCount: 0,
        usedSummary: false,
      },
      topK: 5,
      candidates: [],
      channels: [],
      selection: {
        rrfK: 60,
        requestedTopK: 5,
        selectedCount: 0,
        maxChunksPerDocument: 2,
        adjacentChunkDistance: 1,
        tokenBudget: 4000,
        selectedTokens: 0,
      },
      timings: {
        rewriteMs: 0,
        embeddingMs: 1,
        vectorSearchMs: 1,
        keywordSearchMs: 1,
        fusionMs: 0,
        totalMs: 3,
      },
      generatedAt: new Date().toISOString(),
    };
    const knowledgeService = {
      searchForTool: jest.fn().mockResolvedValue({ sources: [], trace }),
    } as unknown as KnowledgeService;
    const tool = new KnowledgeSearchTool(knowledgeService);

    await expect(
      tool.execute(
        { query: '不存在的信息', topK: 5 },
        { ...context, knowledgeBaseId: 'knowledge-base-id' },
      ),
    ).resolves.toMatchObject({
      code: 'NO_RELIABLE_CONTEXT',
      sources: [],
      retrievalTrace: trace,
    });
  });
});
