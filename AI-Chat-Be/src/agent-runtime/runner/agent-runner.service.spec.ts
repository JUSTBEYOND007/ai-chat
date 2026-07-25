import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { OpenAICompatibleAgentModel } from '../adapters/openai-compatible-agent-model.service';
import { AgentContext, AgentRunError, AgentRuntimeEvent } from '../contracts';
import { ToolExecutor } from '../executor/tool-executor.service';
import { ToolRegistry } from '../registry/tool-registry.service';
import { CalculatorTool } from '../tools/calculator.tool';
import { AgentContextBuilder } from '../context/agent-context-builder.service';
import { AgentRunner } from './agent-runner.service';

describe('AgentRunner', () => {
  const context: AgentContext = {
    userId: 42,
    chatId: 'chat-id',
    generationId: 'generation-id',
  };

  afterEach(() => {
    jest.useRealTimers();
  });

  const createRunner = (options?: {
    maxToolRounds?: number;
    totalTimeoutMs?: number;
  }) => {
    const model = {
      complete: jest.fn(),
    } as unknown as OpenAICompatibleAgentModel;
    const registry = new ToolRegistry();
    registry.register(new CalculatorTool());
    registry.register({
      name: 'knowledge_search',
      description: 'search knowledge',
      schema: z.object({ query: z.string() }),
      isAvailable: (agentContext) => Boolean(agentContext.knowledgeBaseId),
      execute: jest.fn(async ({ query }) => ({ query, sources: [] })),
    });
    const executor = new ToolExecutor(registry);
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'AGENT_MAX_TOOL_ROUNDS') {
          return String(options?.maxToolRounds ?? 3);
        }
        if (key === 'AGENT_TOTAL_TIMEOUT_MS') {
          return String(options?.totalTimeoutMs ?? 5_000);
        }
        return undefined;
      }),
    } as unknown as ConfigService;

    return {
      runner: new AgentRunner(
        model,
        registry,
        executor,
        new AgentContextBuilder(configService),
        configService,
      ),
      model,
    };
  };

  it('returns a direct answer without invoking tools for an ordinary message', async () => {
    const { runner, model } = createRunner();
    jest.mocked(model.complete).mockResolvedValue({
      content: '你好，有什么可以帮助你？',
      toolCalls: [],
      finishReason: 'stop',
    });

    const events: AgentRuntimeEvent[] = [];

    const result = await runner.run({
      message: '你好',
      context,
      onEvent: (event) => events.push(event),
    });

    expect(result).toMatchObject({
      status: 'completed',
      answer: '你好，有什么可以帮助你？',
      toolResults: [],
      contextUsage: {
        includedHistoryMessages: 0,
        inputBudgetTokens: 12_000,
      },
    });
    expect(
      jest.mocked(model.complete).mock.calls[0][0].tools.map((tool) => tool.name),
    ).toEqual(['calculator']);
    expect(events.map((event) => event.type)).toEqual([
      'generation_start',
      'planning',
      'planning',
      'answer_chunk',
    ]);
  });

  it('sends selected history to the model in chronological order', async () => {
    const { runner, model } = createRunner();
    jest.mocked(model.complete).mockResolvedValue({
      content: '它还支持多轮追问。',
      toolCalls: [],
    });

    await runner.run({
      message: '它还有什么能力？',
      context,
      history: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Flow-Chat 支持知识库问答。',
          createdAt: 2,
          status: 'completed',
        },
        {
          id: 'user-1',
          role: 'user',
          content: '介绍一下 Flow-Chat。',
          createdAt: 1,
          status: 'completed',
        },
      ],
    });

    expect(jest.mocked(model.complete).mock.calls[0][0].messages).toEqual([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: '介绍一下 Flow-Chat。' },
      { role: 'assistant', content: 'Flow-Chat 支持知识库问答。' },
      { role: 'user', content: '它还有什么能力？' },
    ]);
  });

  it('executes a requested tool and sends its result back to the model', async () => {
    const { runner, model } = createRunner();
    jest
      .mocked(model.complete)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'calculator-call',
            name: 'calculator',
            arguments: JSON.stringify({ expression: '2 + 3 * 4' }),
          },
        ],
        finishReason: 'tool_calls',
      })
      .mockResolvedValueOnce({
        content: '计算结果是 14。',
        toolCalls: [],
        finishReason: 'stop',
      });

    const events: AgentRuntimeEvent[] = [];

    const result = await runner.run({
      message: '计算 2 + 3 * 4',
      context,
      onEvent: (event) => events.push(event),
    });

    expect(result.answer).toBe('计算结果是 14。');
    expect(result.toolResults).toEqual([
      expect.objectContaining({
        toolCallId: 'calculator-call',
        toolName: 'calculator',
        status: 'completed',
        output: { expression: '2 + 3 * 4', result: 14 },
      }),
    ]);
    expect(jest.mocked(model.complete).mock.calls[1][0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          toolCallId: 'calculator-call',
          content: expect.stringContaining('"result":14'),
        }),
      ]),
    );
    expect(events.map((event) => event.type)).toEqual([
      'generation_start',
      'planning',
      'planning',
      'tool_start',
      'tool_result',
      'planning',
      'planning',
      'answer_chunk',
    ]);
    expect(
      events.find((event) => event.type === 'tool_start'),
    ).toMatchObject({
      toolCallId: 'calculator-call',
      toolName: 'calculator',
      input: { expression: '2 + 3 * 4' },
    });
  });

  it('returns a structured tool error to the model so it can recover', async () => {
    const { runner, model } = createRunner();
    jest
      .mocked(model.complete)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'invalid-calculator-call',
            name: 'calculator',
            arguments: JSON.stringify({ expression: 'process.exit()' }),
          },
        ],
      })
      .mockResolvedValueOnce({
        content: '这个表达式包含不支持的内容，请只输入四则运算。',
        toolCalls: [],
      });

    const result = await runner.run({ message: '执行 process.exit()', context });

    expect(result.toolResults[0]).toMatchObject({
      status: 'failed',
      error: { code: 'TOOL_EXECUTION_FAILED' },
    });
    expect(jest.mocked(model.complete).mock.calls[1][0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: expect.stringContaining('TOOL_EXECUTION_FAILED'),
        }),
      ]),
    );
    expect(result.answer).toContain('不支持');
  });

  it('keeps completed tool results when a later model turn fails', async () => {
    const { runner, model } = createRunner();
    jest
      .mocked(model.complete)
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'calculator-call-before-error',
            name: 'calculator',
            arguments: JSON.stringify({ expression: '6 * 7' }),
          },
        ],
      })
      .mockRejectedValueOnce(new Error('model unavailable'));

    const runPromise = runner.run({ message: '计算 6 * 7', context });

    await expect(runPromise).rejects.toEqual(
      expect.objectContaining<Partial<AgentRunError>>({
        code: 'AGENT_EXECUTION_FAILED',
        partialResult: expect.objectContaining({
          toolResults: [
            expect.objectContaining({
              toolCallId: 'calculator-call-before-error',
              status: 'completed',
            }),
          ],
        }),
      }),
    );
  });

  it('stops safely when the model keeps requesting tools beyond the limit', async () => {
    const { runner, model } = createRunner({ maxToolRounds: 2 });
    let callIndex = 0;
    jest.mocked(model.complete).mockImplementation(async () => {
      callIndex += 1;
      return {
        content: '',
        toolCalls: [
          {
            id: `calculator-call-${callIndex}`,
            name: 'calculator',
            arguments: JSON.stringify({ expression: '1 + 1' }),
          },
        ],
      };
    });

    await expect(
      runner.run({ message: '一直计算', context }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentRunError>>({
        code: 'MAX_TOOL_ROUNDS_EXCEEDED',
      }),
    );
    expect(jest.mocked(model.complete)).toHaveBeenCalledTimes(3);
  });

  it('aborts the run when the total timeout is exceeded', async () => {
    jest.useFakeTimers();
    const { runner, model } = createRunner({ totalTimeoutMs: 1_000 });
    jest.mocked(model.complete).mockImplementation(
      async ({ signal }) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    );

    const runPromise = runner.run({ message: '等待模型', context });
    const assertion = expect(runPromise).rejects.toEqual(
      expect.objectContaining<Partial<AgentRunError>>({
        code: 'AGENT_TIMEOUT',
      }),
    );
    await jest.advanceTimersByTimeAsync(1_000);
    await assertion;
  });
});
