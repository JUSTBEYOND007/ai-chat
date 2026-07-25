import { RetrievalTrace } from '../contracts/retrieval';
import {
  assertRagEvaluationDataset,
  renderRagEvaluationMarkdown,
  runRagEvaluation,
} from './rag-evaluation.runner';
import { RagEvaluationDataset } from './rag-evaluation.types';

const dataset: RagEvaluationDataset = {
  version: '1.0',
  name: 'test-dataset',
  description: 'Focused evaluator test dataset.',
  defaultTopK: 2,
  cases: [
    {
      id: 'answerable-first',
      category: 'answerable',
      question: 'How does replay work?',
      expected: {
        answerable: true,
        documentFileNames: ['stream.md'],
        requiredKeywords: ['sequence'],
      },
    },
    {
      id: 'answerable-second',
      category: 'multi_document',
      question: 'Which documents matter?',
      expected: {
        answerable: true,
        documentFileNames: ['architecture.md', 'agent.md'],
      },
    },
    {
      id: 'unanswerable',
      category: 'unanswerable',
      question: 'What is the production SLA?',
      expected: { answerable: false },
    },
  ],
};

const trace = (
  candidates: RetrievalTrace['candidates'],
  totalMs: number,
): RetrievalTrace => ({
  version: '1.0',
  strategy: 'vector_baseline',
  knowledgeBaseId: 'kb-id',
  originalQuery: 'query',
  effectiveQuery: 'query',
  topK: 2,
  candidates,
  timings: { embeddingMs: 2, vectorSearchMs: 3, totalMs },
  generatedAt: '2026-07-25T00:00:00.000Z',
});

const candidate = (
  fileName: string,
  rank: number,
  content = 'sequence',
): RetrievalTrace['candidates'][number] => ({
  candidateId: `${fileName}-${rank}`,
  documentId: `${fileName}-id`,
  knowledgeBaseId: 'kb-id',
  fileName,
  chunkIndex: 0,
  content,
  channels: [{ channel: 'vector', rank, score: 1 - rank / 10 }],
  finalRank: rank,
  finalScore: 1 - rank / 10,
  selected: true,
  filterReasons: [],
});

describe('RAG evaluation runner', () => {
  it('calculates ranking, document recall, refusal, and latency metrics', async () => {
    const report = await runRagEvaluation(dataset, async (evaluationCase) => {
      if (evaluationCase.id === 'answerable-first') {
        return trace([candidate('stream.md', 1)], 10);
      }
      if (evaluationCase.id === 'answerable-second') {
        return trace(
          [candidate('irrelevant.md', 1), candidate('agent.md', 2)],
          20,
        );
      }
      return trace([], 30);
    });

    expect(report.metrics).toMatchObject({
      totalCases: 3,
      completedCases: 3,
      failedCases: 0,
      answerableCases: 2,
      unanswerableCases: 1,
      hitAtK: 1,
      meanReciprocalRank: 0.75,
      citationDocumentHitRate: 0.75,
      requiredKeywordCoverage: 1,
      unanswerableRefusalRate: 1,
      averageLatencyMs: 20,
      p50LatencyMs: 20,
      p95LatencyMs: 30,
    });
    expect(report.cases[1]).toMatchObject({
      firstRelevantRank: 2,
      reciprocalRank: 0.5,
      citationDocumentRecall: 0.5,
    });
    expect(renderRagEvaluationMarkdown(report)).toContain('| Hit@K | 100.00% |');
  });

  it('records provider failures without aborting the whole dataset', async () => {
    const report = await runRagEvaluation(dataset, async (evaluationCase) => {
      if (evaluationCase.id === 'answerable-second') {
        throw new Error('retrieval unavailable');
      }
      return trace([], 5);
    });

    expect(report.metrics.failedCases).toBe(1);
    expect(report.cases[1]).toMatchObject({
      status: 'failed',
      error: 'retrieval unavailable',
    });
  });

  it('rejects answerable cases without expected documents', () => {
    expect(() =>
      assertRagEvaluationDataset({
        ...dataset,
        cases: [
          {
            id: 'invalid',
            category: 'answerable',
            question: 'question',
            expected: { answerable: true },
          },
        ],
      }),
    ).toThrow('必须声明预期文档文件名或 ID');
  });
});
