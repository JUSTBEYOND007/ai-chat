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
    const knowledgeService = {
      searchForTool: jest.fn().mockResolvedValue(sources),
    } as unknown as KnowledgeService;
    const tool = new KnowledgeSearchTool(knowledgeService);

    await expect(
      tool.execute(
        { query: '如何实现断点续传？', topK: 3 },
        { ...context, knowledgeBaseId: 'knowledge-base-id' },
      ),
    ).resolves.toEqual({
      query: '如何实现断点续传？',
      knowledgeBaseId: 'knowledge-base-id',
      sources,
    });
    expect(knowledgeService.searchForTool).toHaveBeenCalledWith(
      'knowledge-base-id',
      '如何实现断点续传？',
      3,
      42,
    );
  });
});
