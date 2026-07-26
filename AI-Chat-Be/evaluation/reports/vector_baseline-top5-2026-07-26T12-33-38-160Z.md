# RAG Retrieval Evaluation Report

- Dataset: flow-chat-vector-baseline-v1 (1.0)
- Strategy: vector_baseline
- TopK: 5
- Generated at: 2026-07-26T12:33:38.160Z

## Metrics

| Metric | Value |
| --- | ---: |
| Total / completed / failed | 26 / 26 / 0 |
| Hit@K | 100.00% |
| MRR | 0.8788 |
| Citation document hit rate | 100.00% |
| Required keyword coverage | 100.00% |
| Unanswerable refusal rate | 0.00% |
| Average latency | 167.15 ms |
| P50 / P95 latency | 146 / 244 ms |

## Cases

| ID | Category | Status | First relevant rank | Hit | Latency (ms) | Error |
| --- | --- | --- | ---: | --- | ---: | --- |
| architecture-frontend-stack | answerable | completed | 1 | yes | 244 |  |
| architecture-backend-storage | answerable | completed | 1 | yes | 166 |  |
| architecture-security-isolation | answerable | completed | 3 | yes | 135 |  |
| stream-replay-protocol | answerable | completed | 1 | yes | 224 |  |
| stream-deduplication | answerable | completed | 1 | yes | 120 |  |
| stream-real-cancel-status | answerable | completed | 1 | yes | 168 |  |
| agent-tools | answerable | completed | 1 | yes | 149 |  |
| agent-loop-limits | answerable | completed | 1 | yes | 584 |  |
| agent-error-max-rounds | exact_term | completed | 1 | yes | 165 |  |
| agent-error-timeout | exact_term | completed | 1 | yes | 151 |  |
| agent-trace-persistence | answerable | completed | 1 | yes | 129 |  |
| context-default-budget | answerable | completed | 1 | yes | 130 |  |
| memory-scope-isolation | answerable | completed | 2 | yes | 149 |  |
| memory-trigger-and-keep | answerable | completed | 1 | yes | 156 |  |
| memory-through-message-id | exact_term | completed | 2 | yes | 143 |  |
| ingestion-file-types | answerable | completed | 1 | yes | 148 |  |
| ingestion-current-limit | multi_document | completed | 2 | yes | 142 |  |
| ingestion-status-retry | answerable | completed | 2 | yes | 139 |  |
| ingestion-chunk-settings | answerable | completed | 1 | yes | 146 |  |
| multi-doc-resilience-chain | multi_document | completed | 1 | yes | 122 |  |
| followup-duplicate-message | contextual_followup | completed | 1 | yes | 128 |  |
| followup-memory-number | contextual_followup | completed | 1 | yes | 125 |  |
| unanswerable-production-sla | unanswerable | completed | - | no | 159 |  |
| unanswerable-active-users | unanswerable | completed | - | no | 132 |  |
| unanswerable-model-price | unanswerable | completed | - | no | 116 |  |
| unanswerable-deployment-domain | unanswerable | completed | - | no | 176 |  |
