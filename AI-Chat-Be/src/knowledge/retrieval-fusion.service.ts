import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RetrievalCandidate,
  RetrievalChannelScore,
  RetrievalSelectionTrace,
} from './contracts/retrieval';

export interface RetrievalFusionResult {
  candidates: RetrievalCandidate[];
  selection: RetrievalSelectionTrace;
  durationMs: number;
}

@Injectable()
export class RetrievalFusionService {
  private readonly rrfK: number;
  private readonly vectorScoreThreshold?: number;
  private readonly keywordScoreThreshold?: number;
  private readonly maxChunksPerDocument: number;
  private readonly adjacentChunkDistance: number;
  private readonly tokenBudget: number;

  constructor(configService: ConfigService) {
    this.rrfK = this.readBoundedInteger(
      configService.get<string>('RAG_RRF_K'),
      60,
      1,
      1_000,
    );
    this.vectorScoreThreshold = this.readOptionalNumber(
      configService.get<string>('RAG_MIN_VECTOR_SCORE'),
      -1,
      1,
    );
    this.keywordScoreThreshold = this.readOptionalNumber(
      configService.get<string>('RAG_MIN_KEYWORD_SCORE'),
      0,
      1_000,
    );
    this.maxChunksPerDocument = this.readBoundedInteger(
      configService.get<string>('RAG_MAX_CHUNKS_PER_DOCUMENT'),
      2,
      1,
      10,
    );
    this.adjacentChunkDistance = this.readBoundedInteger(
      configService.get<string>('RAG_ADJACENT_CHUNK_DISTANCE'),
      1,
      0,
      5,
    );
    this.tokenBudget = this.readBoundedInteger(
      configService.get<string>('RAG_CONTEXT_TOKEN_BUDGET'),
      4_000,
      256,
      16_000,
    );
  }

  fuseAndSelect(
    sourceCandidates: RetrievalCandidate[],
    topK: number,
  ): RetrievalFusionResult {
    const startedAt = Date.now();
    const fusedCandidates = sourceCandidates
      .map((candidate) => this.withFusedScore(candidate))
      .sort((left, right) => {
        const scoreDifference =
          this.getFusedScore(right) - this.getFusedScore(left);
        if (scoreDifference !== 0) {
          return scoreDifference;
        }

        const bestRankDifference =
          this.getBestRecallRank(left) - this.getBestRecallRank(right);
        return (
          bestRankDifference ||
          left.candidateId.localeCompare(right.candidateId)
        );
      })
      .map((candidate, index) => ({
        ...candidate,
        channels: [
          ...candidate.channels,
          {
            channel: 'fused' as const,
            rank: index + 1,
            score: this.getFusedScore(candidate),
          },
        ],
      }));
    const selectedCandidates: RetrievalCandidate[] = [];
    const selectedContentHashes = new Set<string>();
    const documentCounts = new Map<string, number>();
    let selectedTokens = 0;

    fusedCandidates.forEach((candidate) => {
      candidate.selected = false;
      candidate.finalRank = undefined;
      candidate.finalScore = undefined;
      candidate.filterReasons = [];

      if (selectedCandidates.length >= topK) {
        candidate.filterReasons.push('top_k_limit');
        return;
      }

      if (!this.passesScoreThreshold(candidate)) {
        candidate.filterReasons.push('below_score_threshold');
        return;
      }

      const contentHash = this.getContentHash(candidate);
      if (selectedContentHashes.has(contentHash)) {
        candidate.filterReasons.push('duplicate_chunk');
        return;
      }

      if (this.isAdjacentToSelected(candidate, selectedCandidates)) {
        candidate.filterReasons.push('adjacent_chunk');
        return;
      }

      const documentCount = documentCounts.get(candidate.documentId) || 0;
      if (documentCount >= this.maxChunksPerDocument) {
        candidate.filterReasons.push('document_quota_exceeded');
        return;
      }

      const tokenCount = this.getTokenCount(candidate);
      if (selectedTokens + tokenCount > this.tokenBudget) {
        candidate.filterReasons.push('token_budget_exceeded');
        return;
      }

      candidate.selected = true;
      candidate.finalRank = selectedCandidates.length + 1;
      candidate.finalScore = this.getFusedScore(candidate);
      selectedCandidates.push(candidate);
      selectedContentHashes.add(contentHash);
      documentCounts.set(candidate.documentId, documentCount + 1);
      selectedTokens += tokenCount;
    });

    return {
      candidates: fusedCandidates,
      selection: {
        rrfK: this.rrfK,
        requestedTopK: topK,
        selectedCount: selectedCandidates.length,
        vectorScoreThreshold: this.vectorScoreThreshold,
        keywordScoreThreshold: this.keywordScoreThreshold,
        maxChunksPerDocument: this.maxChunksPerDocument,
        adjacentChunkDistance: this.adjacentChunkDistance,
        tokenBudget: this.tokenBudget,
        selectedTokens,
      },
      durationMs: Date.now() - startedAt,
    };
  }

  private withFusedScore(
    candidate: RetrievalCandidate,
  ): RetrievalCandidate & { rrfScore: number } {
    const recallChannels = candidate.channels.filter(
      (channel) => channel.channel === 'vector' || channel.channel === 'keyword',
    );
    const rrfScore = recallChannels.reduce(
      (score, channel) => score + 1 / (this.rrfK + channel.rank),
      0,
    );

    return {
      ...candidate,
      metadata: candidate.metadata ? { ...candidate.metadata } : undefined,
      channels: recallChannels.map((channel) => ({ ...channel })),
      filterReasons: [],
      selected: false,
      finalRank: undefined,
      finalScore: undefined,
      rrfScore,
    };
  }

  private getFusedScore(candidate: RetrievalCandidate & { rrfScore?: number }) {
    return (
      candidate.rrfScore ??
      candidate.channels.find((channel) => channel.channel === 'fused')?.score ??
      0
    );
  }

  private getBestRecallRank(candidate: RetrievalCandidate) {
    const ranks = candidate.channels
      .filter((channel) => channel.channel !== 'fused')
      .map((channel) => channel.rank);
    return ranks.length ? Math.min(...ranks) : Number.MAX_SAFE_INTEGER;
  }

  private passesScoreThreshold(candidate: RetrievalCandidate) {
    return candidate.channels
      .filter((channel) => channel.channel !== 'fused')
      .some((channel) => {
        const threshold = this.getChannelThreshold(channel);
        return threshold === undefined || channel.score >= threshold;
      });
  }

  private getChannelThreshold(channel: RetrievalChannelScore) {
    if (channel.channel === 'vector') {
      return this.vectorScoreThreshold;
    }
    if (channel.channel === 'keyword') {
      return this.keywordScoreThreshold;
    }
    return undefined;
  }

  private isAdjacentToSelected(
    candidate: RetrievalCandidate,
    selectedCandidates: RetrievalCandidate[],
  ) {
    if (this.adjacentChunkDistance === 0) {
      return false;
    }

    return selectedCandidates.some(
      (selected) =>
        selected.documentId === candidate.documentId &&
        Math.abs(selected.chunkIndex - candidate.chunkIndex) <=
          this.adjacentChunkDistance,
    );
  }

  private getContentHash(candidate: RetrievalCandidate) {
    const storedHash = candidate.metadata?.contentHash;
    if (typeof storedHash === 'string' && storedHash) {
      return storedHash;
    }

    return createHash('sha256')
      .update(candidate.content.toLowerCase().replace(/\s+/g, ' ').trim())
      .digest('hex');
  }

  private getTokenCount(candidate: RetrievalCandidate) {
    return (
      candidate.tokenCount ||
      Math.max(1, Math.ceil(candidate.content.length / 4))
    );
  }

  private readOptionalNumber(
    value: string | undefined,
    minimum: number,
    maximum: number,
  ) {
    if (value === undefined || value.trim() === '') {
      return undefined;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
      return undefined;
    }
    return parsed;
  }

  private readBoundedInteger(
    value: string | undefined,
    fallback: number,
    minimum: number,
    maximum: number,
  ) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      return fallback;
    }
    return Math.min(maximum, Math.max(minimum, parsed));
  }
}
