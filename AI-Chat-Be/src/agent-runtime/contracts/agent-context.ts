export interface AgentContext {
  userId: number;
  chatId: string;
  generationId: string;
  messageId?: string;
  clientMessageId?: string;
  knowledgeBaseId?: string;
  retrievalHistory?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  retrievalSummary?: string;
  signal?: AbortSignal;
}
