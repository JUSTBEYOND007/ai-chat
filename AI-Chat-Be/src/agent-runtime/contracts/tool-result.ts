import { AgentToolErrorCode } from './tool-error';

interface AgentToolResultBase {
  toolCallId: string;
  toolName: string;
  input: unknown;
  startedAt: number;
  completedAt: number;
  durationMs: number;
}

export interface AgentToolSuccessResult<TOutput = unknown>
  extends AgentToolResultBase {
  status: 'completed';
  output: TOutput;
}

export interface AgentToolFailedResult extends AgentToolResultBase {
  status: 'failed';
  error: {
    code: AgentToolErrorCode;
    message: string;
  };
}

export type AgentToolExecutionResult<TOutput = unknown> =
  | AgentToolSuccessResult<TOutput>
  | AgentToolFailedResult;
