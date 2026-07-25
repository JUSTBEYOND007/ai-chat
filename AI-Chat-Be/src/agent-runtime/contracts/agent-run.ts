import { AgentToolExecutionResult } from './tool-result';
import { AgentContextUsage } from './agent-context-builder';

export type AgentToolExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed';

export type AgentRunStatus =
  | 'planning'
  | 'tool_running'
  | 'answering'
  | 'completed'
  | 'failed';

export interface AgentStep {
  stepId: string;
  type: 'planning' | 'tool' | 'answer';
  status: AgentToolExecutionStatus;
  round?: number;
  startedAt: number;
  completedAt?: number;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  error?: {
    code: string;
    message: string;
  };
  durationMs?: number;
  message?: string;
}

export interface AgentRunResult {
  generationId: string;
  status: Extract<AgentRunStatus, 'completed' | 'failed'>;
  answer?: string;
  steps: AgentStep[];
  toolResults: AgentToolExecutionResult[];
  contextUsage: AgentContextUsage;
  error?: {
    code: string;
    message: string;
  };
}
