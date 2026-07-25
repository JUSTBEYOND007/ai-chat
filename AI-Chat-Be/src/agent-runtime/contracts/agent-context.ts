export interface AgentContext {
  userId: number;
  chatId: string;
  generationId: string;
  messageId?: string;
  clientMessageId?: string;
  knowledgeBaseId?: string;
  signal?: AbortSignal;
}
