import { AgentModelMessage } from './agent-model';

export interface AgentHistoryToolCall {
  name: string;
  status: 'completed' | 'failed';
  resultCount?: number;
}

export interface AgentHistoryMessage {
  id: string;
  clientMessageId?: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  status: 'completed' | 'failed';
  knowledgeBaseId?: string;
  toolCalls?: AgentHistoryToolCall[];
}

export interface AgentMemorySummary {
  scopeKey: string;
  content: string;
  throughMessageId: string;
  summarizedMessageCount: number;
  updatedAt: number;
  version: number;
}

export interface AgentContextUsage {
  inputBudgetTokens: number;
  responseReserveTokens: number;
  estimatedInputTokens: number;
  systemTokens: number;
  currentMessageTokens: number;
  summaryTokens: number;
  historyTokens: number;
  includedHistoryMessages: number;
  droppedHistoryMessages: number;
  truncatedHistoryMessages: number;
  toolResultBudgetTokens: number;
  ragContextTokenBudget: number;
  usedSummary: boolean;
  summarizedMessageCount?: number;
  summaryUpdatedAt?: number;
  overBudget: boolean;
}

export interface AgentContextBuildResult {
  messages: AgentModelMessage[];
  usage: AgentContextUsage;
}
