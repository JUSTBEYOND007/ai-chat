export type RetrievalStrategy =
  | 'vector_baseline'
  | 'dual_recall'
  | 'hybrid_rrf';

export type QueryRewriteMode = 'never' | 'auto' | 'always';

export type QueryRewriteStatus =
  | 'skipped'
  | 'rewritten'
  | 'fallback';

export type QueryRewriteReason =
  | 'disabled'
  | 'missing_context'
  | 'not_needed'
  | 'completed'
  | 'unchanged'
  | 'empty_result'
  | 'intent_guard_rejected'
  | 'timeout'
  | 'model_error';

export interface RetrievalHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface QueryRewriteTrace {
  mode: QueryRewriteMode;
  status: QueryRewriteStatus;
  reason: QueryRewriteReason;
  durationMs: number;
  historyMessageCount: number;
  usedSummary: boolean;
  error?: string;
}

export type RetrievalChannel = 'vector' | 'keyword' | 'fused';

export interface RetrievalChannelScore {
  channel: RetrievalChannel;
  rank: number;
  score: number;
}

export type RetrievalFilterReason =
  | 'below_score_threshold'
  | 'duplicate_chunk'
  | 'adjacent_chunk'
  | 'document_quota_exceeded'
  | 'token_budget_exceeded'
  | 'top_k_limit';

export interface RetrievalCandidate {
  candidateId: string;
  documentId: string;
  knowledgeBaseId: string;
  fileName: string;
  chunkIndex: number;
  content: string;
  tokenCount?: number;
  metadata?: Record<string, unknown>;
  channels: RetrievalChannelScore[];
  finalRank?: number;
  finalScore?: number;
  selected: boolean;
  filterReasons: RetrievalFilterReason[];
}

export type RetrievalChannelStatus = 'completed' | 'skipped' | 'failed';

export interface RetrievalChannelTrace {
  channel: RetrievalChannel;
  status: RetrievalChannelStatus;
  candidateLimit: number;
  candidateCount: number;
  durationMs: number;
  query?: string;
  error?: string;
}

export interface RetrievalTimings {
  rewriteMs: number;
  embeddingMs: number;
  vectorSearchMs: number;
  keywordSearchMs: number;
  fusionMs: number;
  totalMs: number;
}

export interface RetrievalSelectionTrace {
  rrfK: number;
  requestedTopK: number;
  selectedCount: number;
  vectorScoreThreshold?: number;
  keywordScoreThreshold?: number;
  maxChunksPerDocument: number;
  adjacentChunkDistance: number;
  tokenBudget: number;
  selectedTokens: number;
}

export interface RetrievalTrace {
  version: '1.0';
  strategy: RetrievalStrategy;
  knowledgeBaseId: string;
  originalQuery: string;
  effectiveQuery: string;
  rewrittenQuery?: string;
  rewrite: QueryRewriteTrace;
  topK: number;
  candidates: RetrievalCandidate[];
  channels: RetrievalChannelTrace[];
  selection?: RetrievalSelectionTrace;
  timings: RetrievalTimings;
  generatedAt: string;
}
