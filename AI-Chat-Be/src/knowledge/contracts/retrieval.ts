export type RetrievalStrategy = 'vector_baseline' | 'hybrid_rrf';

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
  | 'document_quota_exceeded';

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
  finalRank: number;
  finalScore: number;
  selected: boolean;
  filterReasons: RetrievalFilterReason[];
}

export interface RetrievalTimings {
  embeddingMs: number;
  vectorSearchMs: number;
  totalMs: number;
}

export interface RetrievalTrace {
  version: '1.0';
  strategy: RetrievalStrategy;
  knowledgeBaseId: string;
  originalQuery: string;
  effectiveQuery: string;
  rewrittenQuery?: string;
  topK: number;
  candidates: RetrievalCandidate[];
  timings: RetrievalTimings;
  generatedAt: string;
}
