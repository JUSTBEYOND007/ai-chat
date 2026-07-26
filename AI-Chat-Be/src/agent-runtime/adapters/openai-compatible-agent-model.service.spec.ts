import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { OpenAICompatibleAgentModel } from './openai-compatible-agent-model.service';

describe('OpenAICompatibleAgentModel', () => {
  it('maps Zod tools and internal tool messages to OpenAI-compatible payloads', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              {
                id: 'tool-call-id',
                type: 'function',
                function: {
                  name: 'calculator',
                  arguments: '{"expression":"1 + 1"}',
                },
              },
            ],
          },
        },
      ],
    });
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'DASHSCOPE_API_KEY') {
          return 'test-key';
        }
        if (key === 'DASHSCOPE_AGENT_MODEL') {
          return 'tool-capable-model';
        }
        return undefined;
      }),
    } as unknown as ConfigService;
    const adapter = new OpenAICompatibleAgentModel(configService);
    (adapter as unknown as { client: { chat: { completions: { create: jest.Mock } } } }).client = {
      chat: { completions: { create } },
    };
    const controller = new AbortController();

    const result = await adapter.complete({
      messages: [
        { role: 'user', content: '计算 1 + 1' },
        {
          role: 'assistant',
          content: null,
          toolCalls: [
            {
              id: 'previous-call',
              name: 'calculator',
              arguments: '{"expression":"1 + 1"}',
            },
          ],
        },
        {
          role: 'tool',
          toolCallId: 'previous-call',
          content: '{"status":"completed","output":{"result":2}}',
        },
      ],
      tools: [
        {
          name: 'calculator',
          description: 'calculate expression',
          schema: z.object({ expression: z.string() }),
          execute: jest.fn(),
        },
      ],
      signal: controller.signal,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'tool-capable-model',
        tool_choice: 'auto',
        tools: [
          expect.objectContaining({
            type: 'function',
            function: expect.objectContaining({
              name: 'calculator',
              parameters: expect.any(Object),
            }),
          }),
        ],
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'assistant',
            content: '',
            tool_calls: [
              expect.objectContaining({ id: 'previous-call' }),
            ],
          }),
          {
            role: 'tool',
            tool_call_id: 'previous-call',
            content: '{"status":"completed","output":{"result":2}}',
          },
        ]),
      }),
      { signal: controller.signal },
    );
    const payload = create.mock.calls[0][0];
    expect(payload.tools[0].function.strict).toBeUndefined();
    expect(result).toEqual({
      content: '',
      toolCalls: [
        {
          id: 'tool-call-id',
          name: 'calculator',
          arguments: '{"expression":"1 + 1"}',
        },
      ],
      finishReason: 'tool_calls',
    });
  });
});
