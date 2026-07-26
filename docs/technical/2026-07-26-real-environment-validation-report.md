# Flow-Chat Real Environment Validation Report

Date: 2026-07-26
Workspace: `/home/strive/workspace/ai-Chat-all`
Branch: `main`
Required commit: `f0b61e5 feat: add end-to-end generation cancellation`

## Sync and environment

- `git pull origin main`: already up to date.
- The required cancellation commit and `82c8653 feat: add hybrid RAG retrieval and evaluation workflow` are present.
- PostgreSQL 17 + pgvector, Redis, and the Nest backend were started in WSL.
- Two isolated test users were created through the real registration/login API. JWTs remain only under `/tmp`.
- Six Flow-Chat evaluation fixtures were indexed into a dedicated evaluation knowledge base.
- No `.env`, JWT, API key, database password, or other secret was added to the repository.

The validation backend used temporary process-only environment overrides when necessary. Project `.env` was not edited.

## Automated verification

| Verification | Result |
|---|---|
| RAG-focused Jest | 4 suites, 27 tests passed |
| Full backend Jest | 25 suites, 90 tests passed |
| Cancellation-focused Jest | 4 suites, 32 tests passed |
| Agent adapter regression test | 1 suite, 1 test passed |
| Backend `pnpm run build` | passed |
| Frontend `pnpm run build` | passed for `@ai-chat/pc` and `@ai-chat/plug` |

The frontend build still emits a non-fatal Vite warning that the PC vendor chunk exceeds 500 kB.

## Compatibility issue found and fixed

The first real Calculator run failed at the second model turn with:

`400 Input error. Field required: input.messages.2.content`

Root cause: an assistant message containing `tool_calls` was mapped to `content: null`. DashScope accepts the tool call but requires assistant `content` to be a string on the following turn.

Fix:

- `OpenAICompatibleAgentModel` now maps nullable assistant content to an empty string.
- The adapter test now asserts `content: ''` for assistant tool-call history.

A second real compatibility issue is configuration-specific:

- `qwen-long` selected the tool correctly but repeatedly called the same tool after receiving its result.
- `qwen-plus` selected the tool and produced a final answer on the next turn.

Real Agent validation therefore used a temporary process-only `DASHSCOPE_AGENT_MODEL=qwen-plus` override. The committed configuration was not changed.

## Calculator Tool Calling

Result: passed with the real configured model provider.

- Model-selected tool: `calculator`
- Input: `(98765 * 4321) + 17`
- Tool result: `426763582`
- Tool duration: 1 ms
- HTTP generation duration: 2479.22 ms
- SSE sequence: 1 through 9, strictly increasing
- Persisted assistant status: `completed`
- Persisted tool calls: 1
- Persisted Agent steps: 4
- Final answer contained `426,763,582`
- Refresh persistence was verified through `GET /chat/messages/:id`

## Knowledge Search Tool Calling

The existing repository evaluation knowledge-base chunks could not be sent through the Agent model because the execution policy blocked disclosure of retrieved project content to an external model service.

A materially safer synthetic knowledge base was therefore created with one intentionally public test chunk containing the marker `BLUE-ORBIT-731`.

Result: passed for the real tool chain.

- Model-selected tool: `knowledge_search`
- Retrieval query: `recovery marker identifiers resume interrupted stream events replayed`
- Returned sources: 1
- Source score: 0.7383902296265226
- Tool duration: 259 ms
- Persisted `knowledgeBaseId`, `toolCalls`, `sources`, and 4 Agent steps
- Final answer correctly stated `generationId`, `afterSeq`, and replay of events with a higher `seq`
- A second test user received 404 for both document listing and retrieval against the first user's knowledge base

This validates the real Knowledge Search tool and ownership boundary, but it is not a model-driven Agent query against the six repository fixtures.

## SSE reliability

Result: passed through real HTTP/SSE requests.

Initial live Calculator events:

- `generation_start`
- planning start/completion
- `tool_start`
- `tool_result`
- second planning start/completion
- `answer_chunk`
- `complete`

All events used the requested `generationId`; `seq` was strictly increasing.

Immediate reconnect with `generationId + afterSeq=5` replayed only:

- seq 6: planning
- seq 7: planning
- seq 8: answer_chunk
- seq 9: complete

Every replayed event belonged to the requested generation and had `seq > 5`. No duplicate or cross-generation event was observed.

A reconnect attempted after the in-memory generation had expired or the process had restarted timed out, which is expected for the bounded in-memory replay cache.

## Context Builder and Summary Memory

The summary threshold was lowered only in the temporary backend process:

- `AGENT_SUMMARY_TRIGGER_MESSAGES=6`
- `AGENT_SUMMARY_KEEP_RECENT_MESSAGES=2`
- `AGENT_SUMMARY_MIN_NEW_MESSAGES=1`

Four synthetic conversation turns produced:

| Turn | estimatedInputTokens | includedHistoryMessages | historyTokens | summaryTokens | usedSummary |
|---|---:|---:|---:|---:|---|
| 1 | 219 | 0 | 0 | 0 | false |
| 2 | 260 | 2 | 43 | 0 | false |
| 3 | 297 | 4 | 79 | 0 | false |
| 4 | 367 | 2 | 37 | 106 | true |

Turn 4 reported:

- `summarizedMessageCount=4` in the context snapshot used for generation
- `overBudget=false`
- zero dropped or truncated history messages

PostgreSQL persistence was checked directly. The final memory snapshot had:

- scope: `general`
- version: 2
- `summarizedMessageCount=6`
- a valid `throughMessageId`
- content containing the three synthetic markers

The HTTP chat endpoint returns no snapshot because the entity column is intentionally `select: false`.

Real summary failure tolerance was not induced; that behavior remains covered by automated tests.

## End-to-end generation cancellation

### Agent cancellation

Cancellation occurred after Calculator `tool_result` and while the second model planning request was active.

- Cancel API latency: 9.59 ms
- Stop-to-terminal SSE event: 17.79 ms
- Events: seq 1 through 7, ending in `cancelled`
- Extra `answer_chunk` after cancel returned: 0
- Persisted assistant status: `cancelled`
- Incorrect `completed` messages for the cancelled generation: 0
- Repeated cancel: `cancelled + alreadyTerminal=true`
- Cancel after a completed generation: `completed + alreadyTerminal=true`
- Cross-user cancel: HTTP 404
- SSE replay for the cancelled generation ended in `cancelled`
- Send-message response status: `cancelled`

### Partial text preservation and regeneration

A synthetic txt file was uploaded through the real chunk upload/merge API. The non-Agent streaming path produced three chunks before cancellation.

- Cancel API latency: 12.17 ms
- Chunks before terminal event: 3
- Chunks after cancel returned: 0
- Persisted partial text length: 29 characters
- Partial text began with: `The synthetic document titled`
- Persisted assistant status: `cancelled`
- A request with `regenerate=true` was accepted and started a new generation
- The regenerated request could also be cancelled normally

### Timeout state

With a test-only process override `AGENT_TOTAL_TIMEOUT_MS=1000`:

- Request elapsed: 1046.39 ms
- SSE terminal error code: `AGENT_TIMEOUT`
- Persisted assistant status: `timed_out`
- The message was not saved as `failed` or `cancelled`

The browser button itself was not independently clicked in an automated browser session. The same frontend-facing HTTP and SSE contracts were exercised directly.

## RAG evaluation metrics

### Vector baseline

Generated reports:

- `AI-Chat-Be/evaluation/reports/vector_baseline-top5-2026-07-26T12-33-38-160Z.json`
- `AI-Chat-Be/evaluation/reports/vector_baseline-top5-2026-07-26T12-33-38-160Z.md`

| Metric | Value |
|---|---:|
| totalCases | 26 |
| completedCases | 26 |
| failedCases | 0 |
| answerableCases | 22 |
| unanswerableCases | 4 |
| Hit@5 | 1.0000 |
| MRR | 0.8788 |
| Citation document hit rate | 1.0000 |
| Required keyword coverage | 1.0000 |
| Unanswerable refusal rate | 0.0000 |
| Average latency | 167.15 ms |
| P50 latency | 146 ms |
| P95 latency | 244 ms |

### Hybrid RRF

Generated reports:

- `AI-Chat-Be/evaluation/reports/hybrid_rrf-top5-2026-07-26T12-35-31-070Z.json`
- `AI-Chat-Be/evaluation/reports/hybrid_rrf-top5-2026-07-26T12-35-31-070Z.md`

| Metric | Value |
|---|---:|
| totalCases | 26 |
| completedCases | 26 |
| failedCases | 0 |
| answerableCases | 22 |
| unanswerableCases | 4 |
| Hit@5 | 1.0000 |
| MRR | 0.8788 |
| Citation document hit rate | 1.0000 |
| Required keyword coverage | 1.0000 |
| Unanswerable refusal rate | 0.0000 |
| Average latency | 196.73 ms |
| P50 latency | 152 ms |
| P95 latency | 425 ms |

Hybrid channel and rewrite facts:

- Vector channel completed: 26/26
- Fused channel completed: 26/26
- Keyword channel completed: 15; skipped: 11
- Query Rewrite completed: 1; skipped: 25
- Rewrite reasons: completed 1, missing_context 24, not_needed 1
- Selected count: always 5
- Average selected tokens: 962.08
- Only observed final filter reason: `top_k_limit`

## Vector versus hybrid conclusion

Both strategies achieved identical aggregate quality:

- Hit@5: 1.0
- MRR: 0.8788
- Citation document hit rate: 1.0
- Required keyword coverage: 1.0
- Refusal rate: 0

Hybrid improved the exact-term `memory-through-message-id` case from rank 2 to rank 1, but moved `followup-duplicate-message` from rank 1 to rank 2.

Hybrid was slower overall:

- Average: +29.58 ms
- P50: +6 ms
- P95: +181 ms

On this 26-case dataset, hybrid adds exact-term robustness but does not improve aggregate retrieval quality and has a higher tail-latency cost.

## Threshold decision

No production threshold was enabled.

Observed top vector scores overlapped materially:

- Answerable range: 0.142139 to 0.777895
- Unanswerable range: 0.132123 to 0.626869

An offline grid showed that a narrow vector threshold from approximately 0.133 to 0.142 preserved Hit@5 and MRR while rejecting only one of four unanswerable cases. Raising it to 0.145 already dropped Hit@5 to 0.9545 and MRR to 0.8333.

That narrow separation depends on one sample and does not reliably distinguish the other unanswerable cases. Enabling it would overfit this dataset. The evidence therefore supports leaving `RAG_MIN_VECTOR_SCORE` and `RAG_MIN_KEYWORD_SCORE` unset.

## Files changed during validation

Code and configuration:

- `AI-Chat-Be/src/agent-runtime/adapters/openai-compatible-agent-model.service.ts`
- `AI-Chat-Be/src/agent-runtime/adapters/openai-compatible-agent-model.service.spec.ts`
- `AI-Chat-Be/src/knowledge/query-rewrite.service.spec.ts`
- `AI-Chat-Be/src/login.guard.ts`
- `AI-Chat/package.json`

Reports and technical documentation:

- this report
- the four generated RAG Markdown/JSON reports
- the six technical documents listed in the execution prompt
- `AI-Chat-Be/evaluation/reports/vector-baseline-not-run.md`

## Remaining items

- Browser-level clicking of the Stop button was not independently automated.
- Real summary-generation failure tolerance was not induced; automated coverage passed.
- Model-driven Knowledge Search against repository fixture chunks was blocked by external-data policy; the real tool chain was validated with a non-sensitive synthetic knowledge base.
- The default `qwen-long` Agent model repeats tool calls after tool results. Set a tool-capable Agent model such as `qwen-plus` in deployment configuration before relying on real tools.
- The validation backend was stopped after the test-only timeout run. PostgreSQL and Redis data were preserved.
- No commit or push was performed.
