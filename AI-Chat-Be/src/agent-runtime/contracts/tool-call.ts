export interface AgentToolCall {
  toolCallId?: string;
  toolName: string;
  input: unknown;
}
