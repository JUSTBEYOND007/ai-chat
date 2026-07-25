export type AgentToolErrorCode =
  | 'TOOL_NOT_FOUND'
  | 'INVALID_TOOL_INPUT'
  | 'TOOL_TIMEOUT'
  | 'TOOL_ABORTED'
  | 'TOOL_EXECUTION_FAILED'
  | 'KNOWLEDGE_BASE_REQUIRED';

export class AgentToolError extends Error {
  constructor(
    public readonly code: AgentToolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AgentToolError';
  }
}
