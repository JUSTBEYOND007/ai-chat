import { AgentToolExecutionResult } from './tool-result';
import { AgentContextUsage } from './agent-context-builder';

interface AgentRuntimeEventBase {
  generationId: string;
  timestamp: number;
}

export type AgentRuntimeEvent =
  | (AgentRuntimeEventBase & {
      type: 'generation_start';
      availableTools: string[];
      contextUsage: AgentContextUsage;
    })
  | (AgentRuntimeEventBase & {
      type: 'planning';
      round: number;
      status: 'running' | 'completed' | 'failed' | 'cancelled';
      startedAt: number;
      durationMs?: number;
      message?: string;
      error?: {
        code: string;
        message: string;
      };
    })
  | (AgentRuntimeEventBase & {
      type: 'tool_start';
      round: number;
      toolCallId: string;
      toolName: string;
      input: unknown;
    })
  | (AgentRuntimeEventBase & {
      type: 'tool_result';
      round: number;
      result: AgentToolExecutionResult;
    })
  | (AgentRuntimeEventBase & {
      type: 'answer_chunk';
      content: string;
    });

export type AgentRuntimeEventHandler = (event: AgentRuntimeEvent) => void;
