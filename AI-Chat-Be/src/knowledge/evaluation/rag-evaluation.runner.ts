import {
  RagEvaluationCase,
  RagEvaluationCaseResult,
  RagEvaluationDataset,
  RagEvaluationReport,
  RagRetrievalProvider,
} from './rag-evaluation.types';

const clampRatio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

const normalize = (value: string): string => value.trim().toLowerCase();

const round = (value: number, precision = 4): number =>
  Number(value.toFixed(precision));

const percentile = (values: number[], ratio: number): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
};

export function assertRagEvaluationDataset(
  input: unknown,
): asserts input is RagEvaluationDataset {
  if (!input || typeof input !== 'object') {
    throw new Error('评测集必须是 JSON 对象');
  }

  const dataset = input as Partial<RagEvaluationDataset>;
  if (dataset.version !== '1.0') {
    throw new Error('评测集 version 必须为 1.0');
  }
  if (!dataset.name?.trim() || !dataset.description?.trim()) {
    throw new Error('评测集必须包含 name 和 description');
  }
  if (
    !Number.isInteger(Number(dataset.defaultTopK)) ||
    Number(dataset.defaultTopK) < 1 ||
    Number(dataset.defaultTopK) > 20
  ) {
    throw new Error('评测集 defaultTopK 必须是 1 到 20 的整数');
  }
  if (!Array.isArray(dataset.cases) || dataset.cases.length === 0) {
    throw new Error('评测集至少需要一条 case');
  }

  const ids = new Set<string>();
  const supportedCategories = new Set([
    'answerable',
    'unanswerable',
    'exact_term',
    'multi_document',
    'contextual_followup',
  ]);
  dataset.cases.forEach((evaluationCase, index) => {
    if (!evaluationCase?.id?.trim() || !evaluationCase.question?.trim()) {
      throw new Error(`第 ${index + 1} 条 case 缺少 id 或 question`);
    }
    if (ids.has(evaluationCase.id)) {
      throw new Error(`评测 case id 重复: ${evaluationCase.id}`);
    }
    ids.add(evaluationCase.id);
    if (!supportedCategories.has(evaluationCase.category)) {
      throw new Error(
        `评测 case ${evaluationCase.id} category 不受支持: ${evaluationCase.category}`,
      );
    }
    if (typeof evaluationCase.expected?.answerable !== 'boolean') {
      throw new Error(`评测 case ${evaluationCase.id} 缺少 expected.answerable`);
    }
    if (
      evaluationCase.expected.answerable &&
      !evaluationCase.expected.documentFileNames?.length &&
      !evaluationCase.expected.documentIds?.length
    ) {
      throw new Error(
        `可回答 case ${evaluationCase.id} 必须声明预期文档文件名或 ID`,
      );
    }
  });
}

function toExpectedDocumentKeys(evaluationCase: RagEvaluationCase): string[] {
  return [
    ...(evaluationCase.expected.documentFileNames || []),
    ...(evaluationCase.expected.documentIds || []),
  ].map(normalize);
}

function evaluateCompletedCase(
  evaluationCase: RagEvaluationCase,
  trace: Awaited<ReturnType<RagRetrievalProvider>>,
): RagEvaluationCaseResult {
  const expectedFileNames = new Set(
    (evaluationCase.expected.documentFileNames || []).map(normalize),
  );
  const expectedDocumentIds = new Set(
    (evaluationCase.expected.documentIds || []).map(normalize),
  );
  const expectedDocuments = toExpectedDocumentKeys(evaluationCase);
  const selectedCandidates = trace.candidates
    .filter((candidate) => candidate.selected)
    .sort(
      (a, b) =>
        (a.finalRank ?? Number.MAX_SAFE_INTEGER) -
        (b.finalRank ?? Number.MAX_SAFE_INTEGER),
    );
  const retrievedDocuments = Array.from(
    new Set(selectedCandidates.map((candidate) => candidate.fileName)),
  );
  const firstRelevantIndex = selectedCandidates.findIndex(
    (candidate) =>
      expectedFileNames.has(normalize(candidate.fileName)) ||
      expectedDocumentIds.has(normalize(candidate.documentId)),
  );
  const firstRelevantRank =
    firstRelevantIndex >= 0
      ? selectedCandidates[firstRelevantIndex].finalRank ??
        firstRelevantIndex + 1
      : null;
  const hitDocumentKeys = new Set<string>();

  selectedCandidates.forEach((candidate) => {
    const fileName = normalize(candidate.fileName);
    const documentId = normalize(candidate.documentId);
    if (expectedFileNames.has(fileName)) {
      hitDocumentKeys.add(fileName);
    }
    if (expectedDocumentIds.has(documentId)) {
      hitDocumentKeys.add(documentId);
    }
  });

  const searchableContent = selectedCandidates
    .map((candidate) => candidate.content)
    .join('\n')
    .toLowerCase();
  const keywords = evaluationCase.expected.requiredKeywords || [];
  const keywordHits = keywords.filter((keyword) =>
    searchableContent.includes(normalize(keyword)),
  ).length;

  return {
    id: evaluationCase.id,
    category: evaluationCase.category,
    question: evaluationCase.question,
    status: 'completed',
    expectedAnswerable: evaluationCase.expected.answerable,
    expectedDocuments,
    retrievedDocuments,
    firstRelevantRank,
    hitAtK: firstRelevantRank !== null,
    reciprocalRank: firstRelevantRank === null ? 0 : 1 / firstRelevantRank,
    citationDocumentRecall: clampRatio(
      hitDocumentKeys.size,
      expectedDocuments.length,
    ),
    requiredKeywordCoverage:
      keywords.length === 0 ? 1 : clampRatio(keywordHits, keywords.length),
    refused: selectedCandidates.length === 0,
    latencyMs: trace.timings.totalMs,
    trace,
  };
}

export async function runRagEvaluation(
  dataset: RagEvaluationDataset,
  retrieve: RagRetrievalProvider,
  topK = dataset.defaultTopK,
): Promise<RagEvaluationReport> {
  if (!Number.isInteger(topK) || topK < 1 || topK > 20) {
    throw new Error('评测 topK 必须是 1 到 20 的整数');
  }

  const enabledCases = dataset.cases.filter(
    (evaluationCase) => evaluationCase.enabled !== false,
  );
  const caseResults: RagEvaluationCaseResult[] = [];

  for (const evaluationCase of enabledCases) {
    try {
      const trace = await retrieve(evaluationCase, topK);
      caseResults.push(evaluateCompletedCase(evaluationCase, trace));
    } catch (error) {
      caseResults.push({
        id: evaluationCase.id,
        category: evaluationCase.category,
        question: evaluationCase.question,
        status: 'failed',
        expectedAnswerable: evaluationCase.expected.answerable,
        expectedDocuments: toExpectedDocumentKeys(evaluationCase),
        retrievedDocuments: [],
        firstRelevantRank: null,
        hitAtK: false,
        reciprocalRank: 0,
        citationDocumentRecall: 0,
        requiredKeywordCoverage: 0,
        refused: false,
        latencyMs: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const completedCases = caseResults.filter(
    (result) => result.status === 'completed',
  );
  const answerableCases = completedCases.filter(
    (result) => result.expectedAnswerable,
  );
  const unanswerableCases = completedCases.filter(
    (result) => !result.expectedAnswerable,
  );
  const latencies = completedCases.map((result) => result.latencyMs);
  const strategy =
    completedCases.find((result) => result.trace)?.trace?.strategy ||
    'vector_baseline';

  return {
    version: '1.0',
    dataset: {
      name: dataset.name,
      version: dataset.version,
      description: dataset.description,
    },
    strategy,
    topK,
    generatedAt: new Date().toISOString(),
    metrics: {
      totalCases: caseResults.length,
      completedCases: completedCases.length,
      failedCases: caseResults.length - completedCases.length,
      answerableCases: answerableCases.length,
      unanswerableCases: unanswerableCases.length,
      hitAtK: round(
        clampRatio(
          answerableCases.filter((result) => result.hitAtK).length,
          answerableCases.length,
        ),
      ),
      meanReciprocalRank: round(
        clampRatio(
          answerableCases.reduce(
            (sum, result) => sum + result.reciprocalRank,
            0,
          ),
          answerableCases.length,
        ),
      ),
      citationDocumentHitRate: round(
        clampRatio(
          answerableCases.reduce(
            (sum, result) => sum + result.citationDocumentRecall,
            0,
          ),
          answerableCases.length,
        ),
      ),
      requiredKeywordCoverage: round(
        clampRatio(
          answerableCases.reduce(
            (sum, result) => sum + result.requiredKeywordCoverage,
            0,
          ),
          answerableCases.length,
        ),
      ),
      unanswerableRefusalRate: round(
        clampRatio(
          unanswerableCases.filter((result) => result.refused).length,
          unanswerableCases.length,
        ),
      ),
      averageLatencyMs: round(
        clampRatio(
          latencies.reduce((sum, latency) => sum + latency, 0),
          latencies.length,
        ),
        2,
      ),
      p50LatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95),
    },
    cases: caseResults,
  };
}

export function renderRagEvaluationMarkdown(
  report: RagEvaluationReport,
): string {
  const percentage = (value: number) => `${(value * 100).toFixed(2)}%`;
  const rows = report.cases
    .map(
      (result) =>
        `| ${result.id} | ${result.category} | ${result.status} | ${
          result.firstRelevantRank ?? '-'
        } | ${result.hitAtK ? 'yes' : 'no'} | ${result.latencyMs} | ${
          result.error || ''
        } |`,
    )
    .join('\n');

  return `# RAG Retrieval Evaluation Report

- Dataset: ${report.dataset.name} (${report.dataset.version})
- Strategy: ${report.strategy}
- TopK: ${report.topK}
- Generated at: ${report.generatedAt}

## Metrics

| Metric | Value |
| --- | ---: |
| Total / completed / failed | ${report.metrics.totalCases} / ${report.metrics.completedCases} / ${report.metrics.failedCases} |
| Hit@K | ${percentage(report.metrics.hitAtK)} |
| MRR | ${report.metrics.meanReciprocalRank.toFixed(4)} |
| Citation document hit rate | ${percentage(report.metrics.citationDocumentHitRate)} |
| Required keyword coverage | ${percentage(report.metrics.requiredKeywordCoverage)} |
| Unanswerable refusal rate | ${percentage(report.metrics.unanswerableRefusalRate)} |
| Average latency | ${report.metrics.averageLatencyMs.toFixed(2)} ms |
| P50 / P95 latency | ${report.metrics.p50LatencyMs} / ${report.metrics.p95LatencyMs} ms |

## Cases

| ID | Category | Status | First relevant rank | Hit | Latency (ms) | Error |
| --- | --- | --- | ---: | --- | ---: | --- |
${rows}
`;
}
