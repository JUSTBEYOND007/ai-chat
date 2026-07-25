import { AgentStep } from './agent-run';
import { AgentToolExecutionResult } from './tool-result';
import { AgentContextUsage } from './agent-context-builder';

export type AgentRunErrorCode =
  | 'AGENT_TIMEOUT'
  | 'MAX_TOOL_ROUNDS_EXCEEDED'
  | 'EMPTY_MODEL_RESPONSE'
  | 'AGENT_EXECUTION_FAILED';

export interface AgentRunSnapshot {
  steps: AgentStep[];
  toolResults: AgentToolExecutionResult[];
  contextUsage?: AgentContextUsage;
}

export class AgentRunError extends Error {
  constructor(
    public readonly code: AgentRunErrorCode,
    message: string,
    public readonly partialResult?: AgentRunSnapshot,
  ) {
    super(message);
    this.name = 'AgentRunError';
  }
}
