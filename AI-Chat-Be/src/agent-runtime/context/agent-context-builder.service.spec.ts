import { ConfigService } from '@nestjs/config';
import { AgentContext, AgentHistoryMessage } from '../contracts';
import { AgentContextBuilder } from './agent-context-builder.service';

describe('AgentContextBuilder', () => {
  const context: AgentContext = {
    userId: 1,
    chatId: 'chat-id',
    generationId: 'generation-id',
    clientMessageId: 'current-message',
    knowledgeBaseId: 'kb-current',
  };

  const createBuilder = (config: Record<string, string> = {}) =>
    new AgentContextBuilder({
      get: jest.fn((key: string) => config[key]),
    } as unknown as ConfigService);

  const historyMessage = (
    input: Partial<AgentHistoryMessage> &
      Pick<AgentHistoryMessage, 'id' | 'role' | 'content' | 'createdAt'>,
  ): AgentHistoryMessage => ({
    status: 'completed',
    ...input,
  });

  it('deduplicates messages and isolates assistant answers from another knowledge base', () => {
    const builder = createBuilder();
    const result = builder.build({
      message: '它还有哪些优点？',
      context,
      history: [
        historyMessage({
          id: 'user-1',
          clientMessageId: 'same-user-message',
          role: 'user',
          content: '介绍当前项目',
          createdAt: 1,
        }),
        historyMessage({
          id: 'user-1-duplicate',
          clientMessageId: 'same-user-message',
          role: 'user',
          content: '重复消息',
          createdAt: 2,
        }),
        historyMessage({
          id: 'assistant-other-kb',
          role: 'assistant',
          content: '其他知识库答案',
          createdAt: 3,
          knowledgeBaseId: 'kb-other',
        }),
        historyMessage({
          id: 'assistant-current-kb',
          role: 'assistant',
          content: '当前知识库答案',
          createdAt: 4,
          knowledgeBaseId: 'kb-current',
        }),
        historyMessage({
          id: 'failed-message',
          role: 'assistant',
          content: '失败回答',
          createdAt: 5,
          status: 'failed',
        }),
      ],
    });

    expect(result.messages).toEqual([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: '重复消息' },
      { role: 'assistant', content: '当前知识库答案' },
      { role: 'user', content: '它还有哪些优点？' },
    ]);
    expect(result.usage).toMatchObject({
      includedHistoryMessages: 2,
      droppedHistoryMessages: 3,
      usedSummary: false,
    });
  });

  it('keeps the newest messages when the history count exceeds its limit', () => {
    const builder = createBuilder({ AGENT_MAX_HISTORY_MESSAGES: '2' });
    const result = builder.build({
      message: '继续',
      context,
      history: [
        historyMessage({
          id: '1',
          role: 'user',
          content: '第一条',
          createdAt: 1,
        }),
        historyMessage({
          id: '2',
          role: 'assistant',
          content: '第二条',
          createdAt: 2,
        }),
        historyMessage({
          id: '3',
          role: 'user',
          content: '第三条',
          createdAt: 3,
        }),
      ],
    });

    expect(result.messages.slice(1, -1)).toEqual([
      { role: 'assistant', content: '第二条' },
      { role: 'user', content: '第三条' },
    ]);
    expect(result.usage).toMatchObject({
      includedHistoryMessages: 2,
      droppedHistoryMessages: 1,
    });
  });

  it('places a compatible memory summary before recent history and records usage', () => {
    const builder = createBuilder();
    const result = builder.build({
      message: '继续上一项工作',
      context,
      summary: {
        scopeKey: 'kb-current',
        content: '- 用户正在开发 Flow-Chat。\n- 下一项是完善长期记忆。',
        throughMessageId: 'message-10',
        summarizedMessageCount: 10,
        updatedAt: 123,
        version: 2,
      },
      history: [
        historyMessage({
          id: 'message-9',
          role: 'assistant',
          content: '已经进入摘要的旧回答。',
          createdAt: 9,
        }),
        historyMessage({
          id: 'message-10',
          role: 'user',
          content: '摘要边界消息。',
          createdAt: 10,
        }),
        historyMessage({
          id: 'recent-user',
          role: 'user',
          content: '先完成 Token Budget。',
          createdAt: 11,
        }),
      ],
    });

    expect(result.messages[1]).toEqual(
      expect.objectContaining({
        role: 'system',
        content: expect.stringContaining('长期记忆'),
      }),
    );
    expect(result.usage).toMatchObject({
      usedSummary: true,
      summarizedMessageCount: 10,
      summaryUpdatedAt: 123,
    });
    expect(result.usage.summaryTokens).toBeGreaterThan(0);
    const selectedContents = result.messages.map((item) => item.content);
    expect(selectedContents).not.toContain('已经进入摘要的旧回答。');
    expect(selectedContents).not.toContain('摘要边界消息。');
    expect(result.usage.includedHistoryMessages).toBe(1);
  });

  it('does not use a memory summary from another knowledge base', () => {
    const builder = createBuilder();
    const result = builder.build({
      message: '继续',
      context,
      summary: {
        scopeKey: 'kb-other',
        content: '其他知识库摘要',
        throughMessageId: 'message-1',
        summarizedMessageCount: 8,
        updatedAt: 123,
        version: 1,
      },
    });

    expect(result.usage.usedSummary).toBe(false);
    expect(result.usage.summaryTokens).toBe(0);
  });

  it('truncates oversized recent history and returns explainable token usage', () => {
    const builder = createBuilder({
      AGENT_CONTEXT_TOKEN_BUDGET: '2000',
      AGENT_MAX_HISTORY_MESSAGES: '5',
    });
    const result = builder.build({
      message: '继续说明',
      context,
      history: [
        historyMessage({
          id: 'long-message',
          role: 'assistant',
          content: '很长的历史内容'.repeat(600),
          createdAt: 1,
        }),
      ],
    });

    expect(result.messages[1].content).toContain('内容已按 Token 预算截断');
    expect(result.usage.truncatedHistoryMessages).toBe(1);
    expect(result.usage.estimatedInputTokens).toBeLessThanOrEqual(2000);
    expect(result.usage.overBudget).toBe(false);
  });

  it('serializes oversized RAG context into its independent token budget', () => {
    const builder = createBuilder({ RAG_CONTEXT_TOKEN_BUDGET: '256' });
    const serialized = builder.serializeToolResult({
      toolCallId: 'tool-call',
      toolName: 'knowledge_search',
      status: 'completed',
      input: { query: 'Flow-Chat' },
      output: {
        code: 'OK',
        query: 'Flow-Chat',
        effectiveQuery: 'Flow-Chat',
        sources: [{ content: '检索内容'.repeat(600) }],
        retrievalTrace: { candidates: ['不会送入模型'] },
      },
      startedAt: 1,
      completedAt: 2,
      durationMs: 1,
    });

    expect(JSON.parse(serialized)).toEqual(
      expect.objectContaining({
        status: 'completed',
        truncated: true,
        originalEstimatedTokens: expect.any(Number),
      }),
    );
    expect(builder.estimateTextTokens(serialized)).toBeLessThanOrEqual(256);
  });

  it('keeps retrieval history and summary scoped to the selected knowledge base', () => {
    const builder = createBuilder();
    const retrievalContext = builder.buildRetrievalContext(
      [
        historyMessage({
          id: 'user-1',
          role: 'user',
          content: '介绍一下知识库。',
          createdAt: 1,
        }),
        historyMessage({
          id: 'other-kb',
          role: 'assistant',
          content: '另一个知识库的回答。',
          knowledgeBaseId: 'other-kb',
          createdAt: 2,
        }),
      ],
      {
        scopeKey: 'kb-id',
        content: '当前知识库摘要',
        throughMessageId: 'user-1',
        summarizedMessageCount: 1,
        updatedAt: 1,
        version: 1,
      },
      { ...context, knowledgeBaseId: 'kb-id' },
    );

    expect(retrievalContext).toEqual({
      history: [{ role: 'user', content: '介绍一下知识库。' }],
      summary: '当前知识库摘要',
    });
  });
});
