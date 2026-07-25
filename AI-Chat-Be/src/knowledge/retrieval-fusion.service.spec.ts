import { ConfigService } from '@nestjs/config';
import { RetrievalCandidate } from './contracts/retrieval';
import { RetrievalFusionService } from './retrieval-fusion.service';

const createService = (config: Record<string, string> = {}) =>
  new RetrievalFusionService({
    get: jest.fn((key: string) => config[key]),
  } as unknown as ConfigService);

const candidate = (
  id: string,
  documentId: string,
  chunkIndex: number,
  channels: RetrievalCandidate['channels'],
  content = id,
  tokenCount = 10,
): RetrievalCandidate => ({
  candidateId: id,
  documentId,
  knowledgeBaseId: 'kb-id',
  fileName: `${documentId}.md`,
  chunkIndex,
  content,
  tokenCount,
  channels,
  selected: false,
  filterReasons: [],
});

describe('RetrievalFusionService', () => {
  it('uses RRF to rank multi-channel candidates without mixing raw scores', () => {
    const service = createService({
      RAG_ADJACENT_CHUNK_DISTANCE: '0',
      RAG_MAX_CHUNKS_PER_DOCUMENT: '5',
    });

    const result = service.fuseAndSelect(
      [
        candidate('vector-first', 'doc-1', 0, [
          { channel: 'vector', rank: 1, score: 0.99 },
        ]),
        candidate('both-channels', 'doc-2', 0, [
          { channel: 'vector', rank: 3, score: 0.7 },
          { channel: 'keyword', rank: 3, score: 0.2 },
        ]),
      ],
      2,
    );

    expect(result.candidates[0]).toMatchObject({
      candidateId: 'both-channels',
      selected: true,
      finalRank: 1,
      channels: expect.arrayContaining([
        expect.objectContaining({ channel: 'fused', rank: 1 }),
      ]),
    });
    expect(result.selection).toMatchObject({
      rrfK: 60,
      requestedTopK: 2,
      selectedCount: 2,
      selectedTokens: 20,
    });
  });

  it('records duplicate, adjacent, document quota, token budget and topK filters', () => {
    const service = createService({
      RAG_RRF_K: '10',
      RAG_MAX_CHUNKS_PER_DOCUMENT: '2',
      RAG_ADJACENT_CHUNK_DISTANCE: '1',
      RAG_CONTEXT_TOKEN_BUDGET: '256',
    });
    const ranked = (rank: number) => [
      { channel: 'vector' as const, rank, score: 0.9 - rank / 100 },
    ];

    const result = service.fuseAndSelect(
      [
        candidate('a', 'doc-1', 0, ranked(1), 'same content', 20),
        candidate('b', 'doc-1', 1, ranked(2), 'adjacent content', 20),
        candidate('c', 'doc-2', 0, ranked(3), 'same content', 20),
        candidate('d', 'doc-1', 3, ranked(4), 'second allowed', 20),
        candidate('e', 'doc-1', 5, ranked(5), 'quota exceeded', 20),
        candidate('f', 'doc-3', 0, ranked(6), 'too large', 300),
        candidate('g', 'doc-4', 0, ranked(7), 'third selected', 20),
        candidate('h', 'doc-5', 0, ranked(8), 'top k', 20),
      ],
      3,
    );

    const byId = new Map(
      result.candidates.map((item) => [item.candidateId, item]),
    );
    expect(byId.get('b')?.filterReasons).toContain('adjacent_chunk');
    expect(byId.get('c')?.filterReasons).toContain('duplicate_chunk');
    expect(byId.get('e')?.filterReasons).toContain(
      'document_quota_exceeded',
    );
    expect(byId.get('f')?.filterReasons).toContain('token_budget_exceeded');
    expect(byId.get('h')?.filterReasons).toContain('top_k_limit');
    expect(result.selection.selectedCount).toBe(3);
  });

  it('applies only calibrated channel thresholds', () => {
    const service = createService({
      RAG_MIN_VECTOR_SCORE: '0.8',
      RAG_ADJACENT_CHUNK_DISTANCE: '0',
    });

    const result = service.fuseAndSelect(
      [
        candidate('weak-vector', 'doc-1', 0, [
          { channel: 'vector', rank: 1, score: 0.7 },
        ]),
        candidate('keyword-without-threshold', 'doc-2', 0, [
          { channel: 'keyword', rank: 1, score: 0.01 },
        ]),
      ],
      2,
    );

    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: 'weak-vector',
          selected: false,
          filterReasons: ['below_score_threshold'],
        }),
        expect.objectContaining({
          candidateId: 'keyword-without-threshold',
          selected: true,
        }),
      ]),
    );
  });
});
