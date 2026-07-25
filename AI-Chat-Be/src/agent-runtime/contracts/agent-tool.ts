import { z } from 'zod';
import { AgentContext } from './agent-context';

export interface AgentTool<TSchema extends z.ZodTypeAny, TOutput> {
  readonly name: string;
  readonly description: string;
  readonly schema: TSchema;
  readonly timeoutMs?: number;

  isAvailable?(context: AgentContext): boolean;

  execute(
    input: z.infer<TSchema>,
    context: AgentContext,
  ): Promise<TOutput>;
}

export type AnyAgentTool = AgentTool<z.ZodTypeAny, unknown>;

export interface AgentToolDefinition {
  name: string;
  description: string;
  timeoutMs: number;
}
