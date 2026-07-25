import { RetrievalTrace } from '../contracts/retrieval';

export type RagEvaluationCategory =
  | 'answerable'
  | 'unanswerable'
  | 'exact_term'
  | 'multi_document'
  | 'contextual_followup';

export interface RagEvaluationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RagEvaluationExpected {
  answerable: boolean;
  documentFileNames?: string[];
  documentIds?: string[];
  requiredKeywords?: string[];
}

export interface RagEvaluationCase {
  id: string;
  category: RagEvaluationCategory;
  question: string;
  history?: RagEvaluationMessage[];
  expected: RagEvaluationExpected;
  tags?: string[];
  notes?: string;
  enabled?: boolean;
}

export interface RagEvaluationDataset {
  $schema?: string;
  version: '1.0';
  name: string;
  description: string;
  defaultTopK: number;
  cases: RagEvaluationCase[];
}

export interface RagEvaluationCaseResult {
  id: string;
  category: RagEvaluationCategory;
  question: string;
  status: 'completed' | 'failed';
  expectedAnswerable: boolean;
  expectedDocuments: string[];
  retrievedDocuments: string[];
  firstRelevantRank: number | null;
  hitAtK: boolean;
  reciprocalRank: number;
  citationDocumentRecall: number;
  requiredKeywordCoverage: number;
  refused: boolean;
  latencyMs: number;
  trace?: RetrievalTrace;
  error?: string;
}

export interface RagEvaluationMetrics {
  totalCases: number;
  completedCases: number;
  failedCases: number;
  answerableCases: number;
  unanswerableCases: number;
  hitAtK: number;
  meanReciprocalRank: number;
  citationDocumentHitRate: number;
  requiredKeywordCoverage: number;
  unanswerableRefusalRate: number;
  averageLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}

export interface RagEvaluationReport {
  version: '1.0';
  dataset: {
    name: string;
    version: string;
    description: string;
  };
  strategy: RetrievalTrace['strategy'];
  topK: number;
  generatedAt: string;
  metrics: RagEvaluationMetrics;
  cases: RagEvaluationCaseResult[];
}

export type RagRetrievalProvider = (
  evaluationCase: RagEvaluationCase,
  topK: number,
) => Promise<RetrievalTrace>;
