import { z } from 'zod';
import {
  AgentContext,
  AgentTool,
  AgentToolError,
} from '../contracts';
import { ToolRegistry } from '../registry/tool-registry.service';
import { ToolExecutor } from './tool-executor.service';

describe('ToolExecutor', () => {
  let registry: ToolRegistry;
  let executor: ToolExecutor;

  const context: AgentContext = {
    userId: 42,
    chatId: 'chat-id',
    generationId: 'generation-id',
  };

  beforeEach(() => {
    registry = new ToolRegistry();
    executor = new ToolExecutor(registry);
  });

  it('validates input and returns a stable successful result', async () => {
    const schema = z.object({ value: z.number().int() });
    const tool: AgentTool<typeof schema, number> = {
      name: 'double',
      description: 'double a number',
      schema,
      execute: jest.fn(async ({ value }) => value * 2),
    };
    registry.register(tool);

    const result = await executor.execute(
      {
        toolCallId: 'tool-call-id',
        toolName: 'double',
        input: { value: 4 },
      },
      context,
    );

    expect(result).toMatchObject({
      toolCallId: 'tool-call-id',
      toolName: 'double',
      status: 'completed',
      input: { value: 4 },
      output: 8,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns INVALID_TOOL_INPUT before executing a tool', async () => {
    const execute = jest.fn();
    registry.register({
      name: 'validated_tool',
      description: 'validated tool',
      schema: z.object({ value: z.number() }),
      execute,
    });

    const result = await executor.execute(
      { toolName: 'validated_tool', input: { value: '4' } },
      context,
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'INVALID_TOOL_INPUT' },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns TOOL_NOT_FOUND for an unregistered tool', async () => {
    const result = await executor.execute(
      { toolName: 'missing_tool', input: {} },
      context,
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'TOOL_NOT_FOUND' },
    });
  });

  it('does not execute a registered tool that is unavailable in the context', async () => {
    const execute = jest.fn();
    registry.register({
      name: 'context_tool',
      description: 'context tool',
      schema: z.object({}),
      isAvailable: () => false,
      execute,
    });

    const result = await executor.execute(
      { toolName: 'context_tool', input: {} },
      context,
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'TOOL_NOT_FOUND' },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('aborts and returns TOOL_TIMEOUT when execution exceeds the limit', async () => {
    const execute = jest.fn(
      async (_input: unknown, toolContext: AgentContext) =>
        new Promise<never>((_, reject) => {
          toolContext.signal?.addEventListener('abort', () => {
            reject(toolContext.signal?.reason);
          });
        }),
    );
    registry.register({
      name: 'slow_tool',
      description: 'slow tool',
      schema: z.object({}),
      timeoutMs: 5,
      execute,
    });

    const result = await executor.execute(
      { toolName: 'slow_tool', input: {} },
      context,
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'TOOL_TIMEOUT' },
    });
  });

  it('preserves business error codes thrown by a tool', async () => {
    registry.register({
      name: 'protected_tool',
      description: 'protected tool',
      schema: z.object({}),
      execute: jest.fn(async () => {
        throw new AgentToolError(
          'KNOWLEDGE_BASE_REQUIRED',
          '必须选择知识库',
        );
      }),
    });

    const result = await executor.execute(
      { toolName: 'protected_tool', input: {} },
      context,
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'KNOWLEDGE_BASE_REQUIRED',
        message: '必须选择知识库',
      },
    });
  });

  it('does not start a tool when the parent request is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const execute = jest.fn();
    registry.register({
      name: 'cancelled_tool',
      description: 'cancelled tool',
      schema: z.object({}),
      execute,
    });

    const result = await executor.execute(
      { toolName: 'cancelled_tool', input: {} },
      { ...context, signal: controller.signal },
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'TOOL_ABORTED' },
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
