import { ConfigService } from '@nestjs/config';
import { KnowledgeQueryRewriteService } from './query-rewrite.service';

const createService = () => {
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'RAG_QUERY_REWRITE_TIMEOUT_MS') {
        return '1000';
      }
      return undefined;
    }),
  } as unknown as ConfigService;
  const service = new KnowledgeQueryRewriteService(configService);
  const create = jest.fn();
  (service as any).client = {
    chat: { completions: { create } },
  };

  return { service, create };
};

describe('KnowledgeQueryRewriteService', () => {
  it('skips a complete standalone query in auto mode', async () => {
    const { service, create } = createService();

    const result = await service.rewrite({
      query: '知识库文档支持哪些文件扩展名？',
      history: [{ role: 'user', content: '介绍一下知识库。' }],
    });

    expect(result).toMatchObject({
      effectiveQuery: '知识库文档支持哪些文件扩展名？',
      trace: { status: 'skipped', reason: 'not_needed' },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('rewrites an ambiguous follow-up into a standalone retrieval query', async () => {
    const { service, create } = createService();
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Flow-Chat 如何使用 clientMessageId 避免重复消息？',
          },
        },
      ],
    });

    const result = await service.rewrite({
      query: '那它具体如何避免重复消息？',
      history: [
        {
          role: 'user',
          content: '请介绍 Flow-Chat 的 SSE 可靠性设计。',
        },
        {
          role: 'assistant',
          content: '它使用 generationId、seq 和本地待发送队列。',
        },
      ],
    });

    expect(result).toMatchObject({
      originalQuery: '那它具体如何避免重复消息？',
      effectiveQuery: 'Flow-Chat 如何使用 clientMessageId 避免重复消息？',
      rewrittenQuery: 'Flow-Chat 如何使用 clientMessageId 避免重复消息？',
      trace: {
        mode: 'auto',
        status: 'rewritten',
        reason: 'completed',
        historyMessageCount: 2,
      },
    });
  });

  it('falls back when rewriting removes an explicit error code', async () => {
    const { service, create } = createService();
    create.mockResolvedValue({
      choices: [{ message: { content: 'Agent 超时错误是什么意思？' } }],
    });

    const result = await service.rewrite({
      query: 'AGENT_TIMEOUT 这个错误是什么意思？',
      mode: 'always',
      history: [{ role: 'user', content: 'Agent 执行失败了。' }],
    });

    expect(result).toMatchObject({
      effectiveQuery: 'AGENT_TIMEOUT 这个错误是什么意思？',
      trace: {
        status: 'fallback',
        reason: 'intent_guard_rejected',
      },
    });
  });

  it('falls back to the original query when the model call fails', async () => {
    const { service, create } = createService();
    create.mockRejectedValue(new Error('model unavailable'));

    const result = await service.rewrite({
      query: '这个默认条件具体是多少？',
      history: [{ role: 'user', content: '项目什么时候生成摘要记忆？' }],
    });

    expect(result).toMatchObject({
      effectiveQuery: '这个默认条件具体是多少？',
      trace: {
        status: 'fallback',
        reason: 'model_error',
        error: 'model unavailable',
      },
    });
  });

  it('does not turn a parent cancellation into a rewrite fallback', async () => {
    const { service, create } = createService();
    const controller = new AbortController();
    controller.abort(new Error('用户停止生成'));

    await expect(
      service.rewrite({
        query: '这个默认条件具体是多少？',
        mode: 'always',
        history: [{ role: 'user', content: '项目什么时候生成摘要记忆？' }],
        signal: controller.signal,
      }),
    ).rejects.toThrow('用户停止生成');
    expect(create).not.toHaveBeenCalled();
  });
});
