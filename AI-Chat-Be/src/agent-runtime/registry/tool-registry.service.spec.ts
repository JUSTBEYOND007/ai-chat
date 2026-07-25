import { z } from 'zod';
import { AnyAgentTool } from '../contracts';
import { ToolRegistry } from './tool-registry.service';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  const createTool = (name: string): AnyAgentTool => ({
    name,
    description: `${name} description`,
    schema: z.object({ value: z.string() }),
    timeoutMs: 500,
    execute: jest.fn().mockResolvedValue({ ok: true }),
  });

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('registers, finds and lists tools with normalized names', () => {
    const tool = createTool('calculator');

    registry.register(tool);

    expect(registry.get(' CALCULATOR ')).toBe(tool);
    expect(registry.has('Calculator')).toBe(true);
    expect(registry.list()).toEqual([
      {
        name: 'calculator',
        description: 'calculator description',
        timeoutMs: 500,
      },
    ]);
  });

  it('rejects duplicate normalized tool names', () => {
    registry.register(createTool('calculator'));

    expect(() => registry.register(createTool(' Calculator '))).toThrow(
      '工具已注册: calculator',
    );
  });

  it('filters context-dependent tools before exposing them to the model', () => {
    const alwaysAvailable = createTool('calculator');
    const knowledgeTool: AnyAgentTool = {
      ...createTool('knowledge_search'),
      isAvailable: (context) => Boolean(context.knowledgeBaseId),
    };
    registry.register(alwaysAvailable);
    registry.register(knowledgeTool);

    expect(
      registry
        .getAll({
          userId: 42,
          chatId: 'chat-id',
          generationId: 'generation-id',
        })
        .map((tool) => tool.name),
    ).toEqual(['calculator']);
    expect(
      registry
        .getAll({
          userId: 42,
          chatId: 'chat-id',
          generationId: 'generation-id',
          knowledgeBaseId: 'knowledge-base-id',
        })
        .map((tool) => tool.name),
    ).toEqual(['calculator', 'knowledge_search']);
  });
});
