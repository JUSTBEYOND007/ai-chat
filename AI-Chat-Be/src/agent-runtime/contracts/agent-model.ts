import { AnyAgentTool } from './agent-tool';

export interface AgentModelToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type AgentModelMessage =
  | {
      role: 'system' | 'user';
      content: string;
    }
  | {
      role: 'assistant';
      content: string | null;
      toolCalls?: AgentModelToolCall[];
    }
  | {
      role: 'tool';
      toolCallId: string;
      content: string;
    };

export interface AgentModelTurnResult {
  content: string;
  toolCalls: AgentModelToolCall[];
  finishReason?: string | null;
}

export interface AgentModelCompletionInput {
  messages: AgentModelMessage[];
  tools: AnyAgentTool[];
  signal: AbortSignal;
}
