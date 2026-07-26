import { ChatService } from './chat.service';
import { MessageRole, MessageStatus } from './entities/message.entity';
import { AgentRunError } from 'src/agent-runtime/contracts';

const contextUsage = {
  inputBudgetTokens: 12_000,
  responseReserveTokens: 2_000,
  estimatedInputTokens: 320,
  systemTokens: 180,
  currentMessageTokens: 20,
  summaryTokens: 0,
  historyTokens: 120,
  includedHistoryMessages: 2,
  droppedHistoryMessages: 0,
  truncatedHistoryMessages: 0,
  toolResultBudgetTokens: 2_000,
  usedSummary: false,
  overBudget: false,
};

const createService = () => {
  const service = new ChatService();
  const messageRepository = {
    findOne: jest.fn(),
    create: jest.fn((message) => message),
    save: jest.fn(async (message) => ({ id: 'saved-message', ...message })),
    find: jest.fn().mockResolvedValue([]),
  };
  const aiService = {
    getMain: jest.fn(),
  };
  const agentRunner = {
    run: jest.fn(),
  };
  const chatMemoryService = {
    getSummary: jest.fn().mockResolvedValue(undefined),
    refreshSummary: jest.fn().mockResolvedValue({ status: 'unchanged' }),
  };
  const chatRepository = {
    findOne: jest
      .fn()
      .mockResolvedValue({ id: 'chat-1', userId: 1, isActive: true }),
  };
  const fileService = {
    getFile: jest.fn(),
  };

  (
    service as unknown as { messageRepository: typeof messageRepository }
  ).messageRepository = messageRepository;
  (service as unknown as { aiService: typeof aiService }).aiService = aiService;
  (service as unknown as { agentRunner: typeof agentRunner }).agentRunner =
    agentRunner;
  (
    service as unknown as { chatMemoryService: typeof chatMemoryService }
  ).chatMemoryService = chatMemoryService;
  (
    service as unknown as { chatRepository: typeof chatRepository }
  ).chatRepository = chatRepository;
  (service as unknown as { fileService: typeof fileService }).fileService =
    fileService;

  return {
    service,
    chatRepository,
    messageRepository,
    aiService,
    agentRunner,
    chatMemoryService,
    fileService,
  };
};

describe('ChatService', () => {
  it('skips Agent generation when the same clientMessageId was already saved', async () => {
    const { service, messageRepository, aiService, agentRunner } =
      createService();
    const existingUserMessage = {
      id: 'message-1',
      chatId: 'chat-1',
      clientMessageId: 'cm-1',
      role: MessageRole.USER,
      content: 'hello',
    };

    messageRepository.findOne.mockResolvedValue(existingUserMessage);

    const result = await service.useGeminiToChat(
      {
        id: 'chat-1',
        message: 'hello',
        clientMessageId: 'cm-1',
      },
      1,
    );

    expect(result).toEqual({ status: 'duplicate', messageId: 'message-1' });
    expect(aiService.getMain).not.toHaveBeenCalled();
    expect(agentRunner.run).not.toHaveBeenCalled();
    expect(messageRepository.save).not.toHaveBeenCalled();
  });

  it('replays cached Agent answer events after the requested sequence', async () => {
    const { service, messageRepository, agentRunner } = createService();
    messageRepository.findOne.mockResolvedValue(null);
    agentRunner.run.mockImplementation(async ({ context, onEvent }) => {
      const startedAt = 100;
      onEvent?.({
        type: 'generation_start',
        generationId: context.generationId,
        timestamp: startedAt,
        availableTools: ['calculator'],
        contextUsage,
      });
      onEvent?.({
        type: 'planning',
        generationId: context.generationId,
        timestamp: startedAt + 1,
        round: 1,
        status: 'running',
        startedAt: startedAt + 1,
      });
      onEvent?.({
        type: 'planning',
        generationId: context.generationId,
        timestamp: startedAt + 2,
        round: 1,
        status: 'completed',
        startedAt: startedAt + 1,
        durationMs: 1,
        message: '模型开始生成最终回答',
      });
      onEvent?.({
        type: 'answer_chunk',
        generationId: context.generationId,
        timestamp: startedAt + 3,
        content: 'hello',
      });
      return {
        generationId: context.generationId,
        status: 'completed',
        answer: 'hello',
        steps: [
          {
            stepId: `${context.generationId}:planning:1`,
            type: 'planning',
            status: 'completed',
            round: 1,
            startedAt,
            completedAt: startedAt + 2,
          },
        ],
        toolResults: [],
        contextUsage,
      };
    });

    const result = await service.useGeminiToChat(
      {
        id: 'chat-1',
        message: 'hello',
        clientMessageId: 'cm-2',
      },
      1,
    );

    expect(result.status).toBe('created');
    if (result.status !== 'created') {
      throw new Error('Expected created result');
    }

    const replayed: unknown[] = [];
    const subscription = service
      .getStreamEvents('chat-1', result.generationId, 1)
      .subscribe((event) => replayed.push(event.data));

    await new Promise((resolve) => setTimeout(resolve, 0));
    subscription.unsubscribe();

    expect(replayed).toEqual([
      expect.objectContaining({
        type: 'planning',
        generationId: result.generationId,
        seq: 2,
        round: 1,
      }),
      expect.objectContaining({
        type: 'planning',
        generationId: result.generationId,
        seq: 3,
        round: 1,
        status: 'completed',
      }),
      expect.objectContaining({
        type: 'answer_chunk',
        generationId: result.generationId,
        seq: 4,
        content: 'hello',
      }),
      expect.objectContaining({
        type: 'complete',
        generationId: result.generationId,
        seq: 5,
        content: 'hello',
        isComplete: true,
        agentSteps: [expect.objectContaining({ type: 'planning' })],
        contextUsage,
      }),
    ]);
  });

  it('persists Agent knowledge sources and complete tool metadata', async () => {
    const { service, messageRepository, agentRunner, aiService } =
      createService();
    messageRepository.findOne.mockResolvedValue(null);
    agentRunner.run.mockResolvedValue({
      generationId: 'generation-id',
      status: 'completed',
      answer: 'RAG uses retrieved context.',
      steps: [
        {
          stepId: 'generation-id:tool:knowledge-call-1',
          type: 'tool',
          status: 'completed',
          round: 1,
          toolCallId: 'knowledge-call-1',
          toolName: 'knowledge_search',
          startedAt: 100,
          completedAt: 120,
          durationMs: 20,
        },
      ],
      toolResults: [
        {
          toolCallId: 'knowledge-call-1',
          toolName: 'knowledge_search',
          status: 'completed',
          input: { query: 'What is RAG?', topK: 5 },
          output: {
            query: 'What is RAG?',
            knowledgeBaseId: '11111111-1111-4111-8111-111111111111',
            sources: [
              {
                documentId: 'document-1',
                fileName: 'project.md',
                chunkIndex: 2,
                content: 'RAG references the retrieved chunks.',
                score: 0.92,
              },
            ],
          },
          startedAt: 100,
          completedAt: 120,
          durationMs: 20,
        },
      ],
      contextUsage,
    });

    await service.useGeminiToChat(
      {
        id: 'chat-1',
        message: 'What is RAG?',
        knowledgeBaseId: '11111111-1111-4111-8111-111111111111',
      },
      1,
    );

    expect(aiService.getMain).not.toHaveBeenCalled();
    expect(messageRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        role: MessageRole.SYSTEM,
        knowledgeBaseId: '11111111-1111-4111-8111-111111111111',
        sources: [
          expect.objectContaining({ documentId: 'document-1', score: 0.92 }),
        ],
        toolCalls: [
          expect.objectContaining({
            toolCallId: 'knowledge-call-1',
            name: 'knowledge_search',
            query: 'What is RAG?',
            resultCount: 1,
            durationMs: 20,
          }),
        ],
        agentSteps: [
          expect.objectContaining({
            toolCallId: 'knowledge-call-1',
            toolName: 'knowledge_search',
          }),
        ],
        contextUsage,
        status: MessageStatus.COMPLETED,
      }),
    );
  });

  it('loads completed chat history and passes it to the Agent runner', async () => {
    const { service, messageRepository, agentRunner, chatMemoryService } =
      createService();
    messageRepository.findOne.mockResolvedValue(null);
    messageRepository.find.mockResolvedValue([
      {
        id: 'assistant-1',
        role: MessageRole.SYSTEM,
        content: 'Flow-Chat 支持知识库问答。',
        createdAt: new Date('2026-07-23T02:00:00.000Z'),
        status: MessageStatus.COMPLETED,
        knowledgeBaseId: 'kb-1',
        toolCalls: [
          {
            name: 'knowledge_search',
            status: 'completed',
            resultCount: 3,
          },
        ],
      },
      {
        id: 'user-1',
        clientMessageId: 'client-1',
        role: MessageRole.USER,
        content: '介绍一下 Flow-Chat。',
        createdAt: new Date('2026-07-23T01:00:00.000Z'),
        status: MessageStatus.COMPLETED,
      },
    ]);
    agentRunner.run.mockResolvedValue({
      generationId: 'generation-id',
      status: 'completed',
      answer: '它还支持多轮上下文。',
      steps: [],
      toolResults: [],
      contextUsage,
    });
    chatMemoryService.getSummary.mockResolvedValue({
      scopeKey: 'kb-1',
      content: '- 用户正在开发 Flow-Chat。',
      throughMessageId: 'assistant-0',
      summarizedMessageCount: 12,
      updatedAt: 100,
      version: 1,
    });

    await service.useGeminiToChat(
      {
        id: 'chat-1',
        message: '它还有哪些能力？',
        knowledgeBaseId: 'kb-1',
      },
      1,
    );

    expect(messageRepository.find).toHaveBeenCalledWith({
      where: { chatId: 'chat-1', status: MessageStatus.COMPLETED },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    expect(agentRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        history: [
          expect.objectContaining({
            id: 'assistant-1',
            role: 'assistant',
            knowledgeBaseId: 'kb-1',
            toolCalls: [
              {
                name: 'knowledge_search',
                status: 'completed',
                resultCount: 3,
              },
            ],
          }),
          expect.objectContaining({ id: 'user-1', role: 'user' }),
        ],
        summary: expect.objectContaining({
          scopeKey: 'kb-1',
          summarizedMessageCount: 12,
        }),
      }),
    );
    expect(chatMemoryService.refreshSummary).toHaveBeenCalledWith(
      'chat-1',
      'kb-1',
    );
  });

  it('keeps uploaded file messages on the existing multimodal stream path', async () => {
    const { service, messageRepository, agentRunner, aiService, fileService } =
      createService();
    messageRepository.findOne.mockResolvedValue(null);
    fileService.getFile.mockResolvedValue({
      data: { filePath: 'uploads/image.png' },
    });
    aiService.getMain.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: 'image answer' } }] };
      })(),
    );

    await service.useGeminiToChat(
      {
        id: 'chat-1',
        message: 'describe it',
        fileId: 'file-id',
      },
      1,
    );

    expect(agentRunner.run).not.toHaveBeenCalled();
    expect(aiService.getMain).toHaveBeenCalledWith(
      'describe it',
      'uploads/image.png',
      undefined,
      expect.any(AbortSignal),
    );
  });

  it('keeps a successful answer when memory refresh fails', async () => {
    const { service, messageRepository, agentRunner, chatMemoryService } =
      createService();
    messageRepository.findOne.mockResolvedValue(null);
    agentRunner.run.mockResolvedValue({
      generationId: 'generation-id',
      status: 'completed',
      answer: '正常回答',
      steps: [],
      toolResults: [],
      contextUsage,
    });
    chatMemoryService.refreshSummary.mockRejectedValue(
      new Error('memory database unavailable'),
    );

    await expect(
      service.useGeminiToChat(
        {
          id: 'chat-1',
          message: '继续',
        },
        1,
      ),
    ).resolves.toEqual(
      expect.objectContaining({ status: 'created' }),
    );
    expect(messageRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        role: MessageRole.SYSTEM,
        content: '正常回答',
        status: MessageStatus.COMPLETED,
      }),
    );
  });

  it('persists a failed assistant message when Agent execution fails', async () => {
    const { service, messageRepository, agentRunner } = createService();
    messageRepository.findOne.mockResolvedValue(null);
    agentRunner.run.mockRejectedValue(
      new AgentRunError('AGENT_EXECUTION_FAILED', 'model unavailable', {
        steps: [],
        contextUsage,
        toolResults: [
          {
            toolCallId: 'calculator-call',
            toolName: 'calculator',
            status: 'completed',
            input: { expression: '1 + 1' },
            output: { expression: '1 + 1', result: 2 },
            startedAt: 100,
            completedAt: 105,
            durationMs: 5,
          },
        ],
      }),
    );

    await expect(
      service.useGeminiToChat(
        {
          id: 'chat-1',
          message: 'hello',
        },
        1,
      ),
    ).rejects.toThrow('Chat failed');

    expect(messageRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        role: MessageRole.SYSTEM,
        content: '回复失败，请稍后重试。',
        toolCalls: [
          expect.objectContaining({
            toolCallId: 'calculator-call',
            name: 'calculator',
            status: 'completed',
          }),
        ],
        status: MessageStatus.FAILED,
      }),
    );
  });

  it('persists Agent timeout separately from an ordinary failure', async () => {
    const { service, messageRepository, agentRunner } = createService();
    messageRepository.findOne.mockResolvedValue(null);
    agentRunner.run.mockRejectedValue(
      new AgentRunError('AGENT_TIMEOUT', 'Agent execution timed out', {
        steps: [],
        toolResults: [],
        contextUsage,
      }),
    );

    await expect(
      service.useGeminiToChat(
        {
          id: 'chat-1',
          message: 'hello',
          generationId: '55555555-5555-4555-8555-555555555555',
        },
        1,
      ),
    ).rejects.toThrow('Chat failed');
    expect(messageRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: MessageStatus.TIMED_OUT }),
    );
  });

  it('cancels an owned running generation and persists an interrupted answer', async () => {
    const { service, messageRepository, agentRunner } = createService();
    messageRepository.findOne.mockResolvedValue(null);
    agentRunner.run.mockImplementation(
      async ({ context }: { context: { signal: AbortSignal } }) =>
        new Promise((_, reject) => {
          context.signal.addEventListener('abort', () => {
            reject(
              new AgentRunError('AGENT_CANCELLED', '用户取消了本次生成', {
                steps: [],
                toolResults: [],
                contextUsage,
              }),
            );
          });
        }),
    );

    const generationId = '11111111-1111-4111-8111-111111111111';
    const runPromise = service.useGeminiToChat(
      {
        id: 'chat-1',
        message: '请生成一个很长的回答',
        generationId,
      },
      1,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(
      service.cancelGeneration('chat-1', generationId, 1),
    ).resolves.toEqual({
      generationId,
      status: 'cancelled',
      alreadyTerminal: false,
    });
    await expect(runPromise).resolves.toEqual({
      status: 'cancelled',
      generationId,
    });
    expect(messageRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        role: MessageRole.SYSTEM,
        content: '生成已停止。',
        status: MessageStatus.CANCELLED,
      }),
    );

    const replayed: unknown[] = [];
    const subscription = service
      .getStreamEvents('chat-1', generationId, 0)
      .subscribe((event) => replayed.push(event.data));
    await new Promise((resolve) => setTimeout(resolve, 0));
    subscription.unsubscribe();
    expect(replayed).toContainEqual(
      expect.objectContaining({
        type: 'cancelled',
        generationId,
        isComplete: true,
      }),
    );
  });

  it('keeps repeated cancellation idempotent', async () => {
    const { service, messageRepository, agentRunner } = createService();
    messageRepository.findOne.mockResolvedValue(null);
    agentRunner.run.mockImplementation(
      async ({ context }: { context: { signal: AbortSignal } }) =>
        new Promise((_, reject) => {
          context.signal.addEventListener('abort', () => {
            reject(new AgentRunError('AGENT_CANCELLED', 'cancelled'));
          });
        }),
    );
    const generationId = '22222222-2222-4222-8222-222222222222';
    const runPromise = service.useGeminiToChat(
      { id: 'chat-1', message: 'hello', generationId },
      1,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    await service.cancelGeneration('chat-1', generationId, 1);
    await expect(
      service.cancelGeneration('chat-1', generationId, 1),
    ).resolves.toEqual({
      generationId,
      status: 'cancelled',
      alreadyTerminal: true,
    });
    await runPromise;
  });

  it('does not expose a generation to another user', async () => {
    const { service, chatRepository } = createService();
    chatRepository.findOne.mockResolvedValue(null);

    await expect(
      service.cancelGeneration(
        'chat-1',
        '33333333-3333-4333-8333-333333333333',
        2,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns the completed terminal state when cancellation arrives late', async () => {
    const { service, messageRepository, agentRunner } = createService();
    messageRepository.findOne.mockResolvedValue(null);
    agentRunner.run.mockResolvedValue({
      generationId: '44444444-4444-4444-8444-444444444444',
      status: 'completed',
      answer: 'done',
      steps: [],
      toolResults: [],
      contextUsage,
    });
    const generationId = '44444444-4444-4444-8444-444444444444';

    await service.useGeminiToChat(
      { id: 'chat-1', message: 'hello', generationId },
      1,
    );

    await expect(
      service.cancelGeneration('chat-1', generationId, 1),
    ).resolves.toEqual({
      generationId,
      status: 'completed',
      alreadyTerminal: true,
    });
  });
});
