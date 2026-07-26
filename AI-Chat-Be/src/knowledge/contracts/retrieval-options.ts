import {
  QueryRewriteMode,
  RetrievalHistoryMessage,
  RetrievalStrategy,
} from './retrieval';

export interface KnowledgeRetrievalOptions {
  strategy?: Extract<
    RetrievalStrategy,
    'vector_baseline' | 'dual_recall' | 'hybrid_rrf'
  >;
  rewriteMode?: QueryRewriteMode;
  history?: RetrievalHistoryMessage[];
  summary?: string;
  signal?: AbortSignal;
}
