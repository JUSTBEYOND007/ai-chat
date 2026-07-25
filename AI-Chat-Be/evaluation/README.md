# Flow-Chat RAG Evaluation

This directory contains the reproducible retrieval evaluation baseline for the persistent PostgreSQL/pgvector knowledge module.

## Directory layout

```text
evaluation/
  datasets/   JSON Schema and versioned evaluation cases
  fixtures/   stable documents uploaded to a dedicated evaluation knowledge base
  reports/    generated JSON and Markdown reports
  run-rag-evaluation.ts
```

The current dataset contains 26 enabled cases. The fixture corpus is intentionally separate from personal knowledge-base data so expected documents remain stable across runs.

## Prepare the evaluation knowledge base

1. Start PostgreSQL/pgvector and the backend with a valid embedding API configuration.
2. Sign in and create a dedicated knowledge base, for example `Flow-Chat Retrieval Eval v1`.
3. Upload every file under `evaluation/fixtures/flow-chat` without renaming it.
4. Wait until every document is in the `indexed` state.
5. Copy the knowledge-base ID and the raw JWT used by the existing backend guard.

The deprecated upload-policy fixture must also be uploaded. It deliberately conflicts with the current 20 MB rule and is used to observe whether retrieval returns stale decisions.

## Run the vector baseline

Run from `AI-Chat-Be`:

```bash
RAG_EVAL_TOKEN='<raw-jwt>' \
RAG_EVAL_KNOWLEDGE_BASE_ID='<knowledge-base-id>' \
pnpm eval:rag
```

Optional variables:

```text
RAG_EVAL_API_URL       default http://127.0.0.1:3000
RAG_EVAL_DATASET       default evaluation/datasets/flow-chat-vector-baseline.json
RAG_EVAL_OUTPUT_DIR    default evaluation/reports
RAG_EVAL_TOP_K         default dataset.defaultTopK, allowed 1..20
RAG_EVAL_STRATEGY      vector_baseline (default) or hybrid_rrf
```

The command writes timestamped Markdown and JSON reports. JSON retains the complete retrieval trace for later strategy comparison; do not publish reports generated from private documents.

## Metric semantics

- Hit@K: answerable cases where at least one expected document appears in selected TopK candidates.
- MRR: mean reciprocal rank of the first expected document across answerable cases.
- Citation document hit rate: average fraction of expected documents represented in selected candidates.
- Required keyword coverage: diagnostic content coverage for declared exact terms; it is not an answer-quality score.
- Unanswerable refusal rate: fraction of unanswerable cases returning zero selected candidates. The vector baseline has no threshold, so a low value is expected and is useful evidence for threshold calibration.
- Latency: backend embedding plus vector query time reported by the retrieval trace; it excludes CLI network overhead.

Contextual follow-up cases send only the final user question in the vector baseline. A later Query Rewrite strategy should use the included history and be compared against this result.

After the vector baseline is fixed, run the complete retrieval strategy with:

```bash
RAG_EVAL_TOKEN='<raw-jwt>' \
RAG_EVAL_KNOWLEDGE_BASE_ID='<knowledge-base-id>' \
RAG_EVAL_STRATEGY='hybrid_rrf' \
pnpm eval:rag
```

The hybrid run sends each case's bounded history to Query Rewrite and evaluates only candidates selected after RRF, thresholds, diversity filters and the RAG token budget. `dual_recall` is intentionally excluded because raw candidates have no final rank or selection state.
