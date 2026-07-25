import * as fs from 'fs';
import * as path from 'path';
import {
  assertRagEvaluationDataset,
  renderRagEvaluationMarkdown,
  runRagEvaluation,
} from '../src/knowledge/evaluation/rag-evaluation.runner';
import { RagEvaluationCase } from '../src/knowledge/evaluation/rag-evaluation.types';
import { RetrievalTrace } from '../src/knowledge/contracts/retrieval';

interface ApiResponse<T> {
  code: number;
  msg: string;
  data: T;
}

const requiredEnvironment = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return value;
};

const resolveFromCurrentDirectory = (filePath: string): string =>
  path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

async function main() {
  const apiUrl = (process.env.RAG_EVAL_API_URL || 'http://127.0.0.1:3000').replace(
    /\/$/,
    '',
  );
  const token = requiredEnvironment('RAG_EVAL_TOKEN').replace(/^Bearer\s+/i, '');
  const knowledgeBaseId = requiredEnvironment('RAG_EVAL_KNOWLEDGE_BASE_ID');
  const strategy = process.env.RAG_EVAL_STRATEGY || 'vector_baseline';
  if (!['vector_baseline', 'hybrid_rrf'].includes(strategy)) {
    throw new Error(
      'RAG_EVAL_STRATEGY 只支持 vector_baseline 或 hybrid_rrf',
    );
  }
  const datasetPath = resolveFromCurrentDirectory(
    process.env.RAG_EVAL_DATASET ||
      'evaluation/datasets/flow-chat-vector-baseline.json',
  );
  const outputDirectory = resolveFromCurrentDirectory(
    process.env.RAG_EVAL_OUTPUT_DIR || 'evaluation/reports',
  );
  const parsedDataset: unknown = JSON.parse(
    await fs.promises.readFile(datasetPath, 'utf8'),
  );
  assertRagEvaluationDataset(parsedDataset);
  const requestedTopK = process.env.RAG_EVAL_TOP_K?.trim();
  const topK = requestedTopK
    ? Number(requestedTopK)
    : parsedDataset.defaultTopK;

  if (!Number.isInteger(topK) || topK < 1 || topK > 20) {
    throw new Error('RAG_EVAL_TOP_K 必须是 1 到 20 的整数');
  }

  const retrieve = async (
    evaluationCase: RagEvaluationCase,
    currentTopK: number,
  ): Promise<RetrievalTrace> => {
    const response = await fetch(
      `${apiUrl}/knowledge-bases/${encodeURIComponent(
        knowledgeBaseId,
      )}/retrieval/debug`,
      {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: evaluationCase.question,
          topK: currentTopK,
          strategy,
          rewriteMode: strategy === 'hybrid_rrf' ? 'auto' : 'never',
          history:
            strategy === 'hybrid_rrf' ? evaluationCase.history : undefined,
        }),
      },
    );

    const payload = (await response.json()) as ApiResponse<RetrievalTrace>;
    if (!response.ok || payload.code !== 1 || !payload.data) {
      throw new Error(
        `检索接口失败 (${response.status}): ${payload.msg || 'unknown error'}`,
      );
    }
    return payload.data;
  };

  const report = await runRagEvaluation(parsedDataset, retrieve, topK);
  if (report.strategy !== strategy) {
    throw new Error(
      `评测策略不一致，期望 ${strategy}，实际 ${report.strategy}`,
    );
  }
  const safeTimestamp = report.generatedAt.replace(/[:.]/g, '-');
  const baseName = `${report.strategy}-top${topK}-${safeTimestamp}`;

  await fs.promises.mkdir(outputDirectory, { recursive: true });
  const jsonPath = path.join(outputDirectory, `${baseName}.json`);
  const markdownPath = path.join(outputDirectory, `${baseName}.md`);
  await Promise.all([
    fs.promises.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    fs.promises.writeFile(
      markdownPath,
      renderRagEvaluationMarkdown(report),
      'utf8',
    ),
  ]);

  process.stdout.write(
    `${JSON.stringify(
      {
        jsonPath,
        markdownPath,
        metrics: report.metrics,
      },
      null,
      2,
    )}\n`,
  );

  if (report.metrics.failedCases > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
