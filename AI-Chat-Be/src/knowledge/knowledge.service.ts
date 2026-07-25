import * as fs from 'fs';
import * as path from 'path';
import * as pdfParse from 'pdf-parse';
import { createHash } from 'crypto';
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { DataSource, Repository } from 'typeorm';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { IndexDocumentDto } from './dto/index-document.dto';
import { RagQueryDto } from './dto/rag-query.dto';
import { KnowledgeBase } from './entities/knowledge-base.entity';
import {
  KnowledgeDocument,
  KnowledgeDocumentStatus,
} from './entities/knowledge-document.entity';
import { KnowledgeChunk } from './entities/knowledge-chunk.entity';
import {
  getKnowledgeDocumentExtension,
  isKnowledgeDocumentMimeTypeAllowed,
  KNOWLEDGE_MAX_FILE_SIZE,
  KNOWLEDGE_SUPPORTED_EXTENSIONS,
} from './knowledge.constants';
import {
  RetrievalCandidate,
  RetrievalChannelTrace,
  RetrievalTrace,
} from './contracts/retrieval';
import { KnowledgeRetrievalOptions } from './contracts/retrieval-options';
import { KnowledgeQueryRewriteService } from './query-rewrite.service';
import { RetrievalFusionService } from './retrieval-fusion.service';

interface UploadedKnowledgeFile {
  originalname: string;
  mimetype?: string;
  buffer: Buffer;
}

export interface RetrievedChunk {
  id: string;
  documentId: string;
  knowledgeBaseId: string;
  chunkIndex: number;
  content: string;
  metadata?: Record<string, any>;
  fileName: string;
  score: number;
  tokenCount?: number;
}

export interface KnowledgeSource {
  documentId: string;
  fileName: string;
  chunkIndex: number;
  content: string;
  score: number;
}

export interface KnowledgeToolCall {
  name: 'knowledge_search';
  status: 'completed';
  query: string;
  resultCount: number;
}

export interface KnowledgeStreamResult {
  stream: AsyncIterable<{ content: unknown }>;
  sources: KnowledgeSource[];
  toolCalls: KnowledgeToolCall[];
}

@Injectable()
export class KnowledgeService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeService.name);
  private readonly embeddingDimension: number;
  private readonly textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  private readonly embeddings: OpenAIEmbeddings;
  private readonly llm: ChatOpenAI;
  private readonly vectorCandidateLimit: number;
  private readonly keywordCandidateLimit: number;

  constructor(
    @InjectRepository(KnowledgeBase)
    private readonly knowledgeBaseRepository: Repository<KnowledgeBase>,
    @InjectRepository(KnowledgeDocument)
    private readonly knowledgeDocumentRepository: Repository<KnowledgeDocument>,
    @InjectRepository(KnowledgeChunk)
    private readonly knowledgeChunkRepository: Repository<KnowledgeChunk>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly queryRewriteService: KnowledgeQueryRewriteService,
    private readonly retrievalFusionService: RetrievalFusionService,
  ) {
    this.embeddingDimension = Number(
      this.configService.get<string>('DASHSCOPE_EMBEDDING_DIMENSION') || 1536,
    );

    const apiKey = this.configService.get<string>('DASHSCOPE_API_KEY');
    const baseURL =
      this.configService.get<string>('DASHSCOPE_BASE_URL') ||
      'https://dashscope.aliyuncs.com/compatible-mode/v1';

    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: apiKey,
      configuration: { baseURL },
      modelName:
        this.configService.get<string>('DASHSCOPE_EMBEDDING_MODEL') ||
        'text-embedding-v1',
    });

    this.llm = new ChatOpenAI({
      openAIApiKey: apiKey,
      configuration: { baseURL },
      modelName:
        this.configService.get<string>('DASHSCOPE_RAG_MODEL') || 'qwen-long',
      temperature: 0.1,
    });
    this.vectorCandidateLimit = this.readBoundedInteger(
      this.configService.get<string>('RAG_VECTOR_CANDIDATE_LIMIT'),
      10,
      1,
      50,
    );
    this.keywordCandidateLimit = this.readBoundedInteger(
      this.configService.get<string>('RAG_KEYWORD_CANDIDATE_LIMIT'),
      10,
      1,
      50,
    );
  }

  async onModuleInit() {
    await this.ensureRetrievalSchema();
  }

  async createKnowledgeBase(
    createKnowledgeBaseDto: CreateKnowledgeBaseDto,
    userId: number,
  ) {
    const knowledgeBase = this.knowledgeBaseRepository.create({
      ...createKnowledgeBaseDto,
      userId,
      isActive: true,
    });

    return await this.knowledgeBaseRepository.save(knowledgeBase);
  }

  async getKnowledgeBases(userId: number) {
    return await this.knowledgeBaseRepository.find({
      where: { userId, isActive: true },
      order: { updatedAt: 'DESC' },
    });
  }

  async indexDocument(
    knowledgeBaseId: string,
    indexDocumentDto: IndexDocumentDto,
    userId: number,
  ) {
    await this.assertKnowledgeBaseOwner(knowledgeBaseId, userId);
    this.assertDocumentFileSupported(
      indexDocumentDto.fileName || indexDocumentDto.filePath,
      indexDocumentDto.mimeType,
    );

    const document = this.knowledgeDocumentRepository.create({
      ...indexDocumentDto,
      knowledgeBaseId,
      status: KnowledgeDocumentStatus.PENDING,
      chunkCount: 0,
    });
    const savedDocument = await this.knowledgeDocumentRepository.save(document);

    return await this.indexExistingDocument(savedDocument);
  }

  async retryDocument(
    knowledgeBaseId: string,
    documentId: string,
    userId: number,
  ) {
    await this.assertKnowledgeBaseOwner(knowledgeBaseId, userId);

    const document = await this.knowledgeDocumentRepository.findOne({
      where: { id: documentId, knowledgeBaseId },
    });

    if (!document) {
      throw new HttpException('知识库文档不存在', HttpStatus.NOT_FOUND);
    }

    if (document.status !== KnowledgeDocumentStatus.FAILED) {
      throw new HttpException(
        '只有入库失败的文档可以重试',
        HttpStatus.BAD_REQUEST,
      );
    }

    document.status = KnowledgeDocumentStatus.PENDING;
    document.chunkCount = 0;
    document.errorMessage = null;
    const savedDocument = await this.knowledgeDocumentRepository.save(document);

    return await this.indexExistingDocument(savedDocument);
  }

  async deleteDocument(
    knowledgeBaseId: string,
    documentId: string,
    userId: number,
  ) {
    await this.assertKnowledgeBaseOwner(knowledgeBaseId, userId);

    const document = await this.knowledgeDocumentRepository.findOne({
      where: { id: documentId, knowledgeBaseId },
    });

    if (!document) {
      throw new HttpException('知识库文档不存在', HttpStatus.NOT_FOUND);
    }

    await this.knowledgeChunkRepository.delete({ documentId });
    await this.knowledgeDocumentRepository.delete({
      id: documentId,
      knowledgeBaseId,
    });

    return {
      documentId,
      deleted: true,
    };
  }

  private async indexExistingDocument(savedDocument: KnowledgeDocument) {
    try {
      savedDocument.status = KnowledgeDocumentStatus.PARSING;
      await this.knowledgeDocumentRepository.save(savedDocument);

      const text = await this.extractTextFromFile(savedDocument.filePath);
      if (!text.trim()) {
        throw new Error('文档没有解析出可用文本');
      }

      const chunks = await this.textSplitter.splitText(text);
      await this.knowledgeChunkRepository.delete({ documentId: savedDocument.id });

      let indexedChunkCount = 0;
      for (let i = 0; i < chunks.length; i++) {
        const content = chunks[i].trim();
        if (!content) {
          continue;
        }

        const embedding = await this.embeddings.embedQuery(content);
        this.assertEmbeddingDimension(embedding);

        const chunk = await this.knowledgeChunkRepository.save(
          this.knowledgeChunkRepository.create({
            documentId: savedDocument.id,
            knowledgeBaseId: savedDocument.knowledgeBaseId,
            chunkIndex: i,
            content,
            tokenCount: this.estimateTokenCount(content),
            metadata: {
              fileName: savedDocument.fileName,
              mimeType: savedDocument.mimeType,
              charCount: content.length,
              contentHash: createHash('sha256').update(content).digest('hex'),
              documentVersion:
                savedDocument.updatedAt?.toISOString() ||
                savedDocument.createdAt?.toISOString(),
            },
          }),
        );

        await this.writeChunkRetrievalData(chunk.id, embedding);
        indexedChunkCount += 1;
      }

      savedDocument.status = KnowledgeDocumentStatus.INDEXED;
      savedDocument.chunkCount = indexedChunkCount;
      savedDocument.errorMessage = null;
      await this.knowledgeDocumentRepository.save(savedDocument);

      return {
        documentId: savedDocument.id,
        status: savedDocument.status,
        chunkCount: savedDocument.chunkCount,
      };
    } catch (error) {
      try {
        await this.knowledgeChunkRepository.delete({ documentId: savedDocument.id });
      } catch (cleanupError) {
        this.logger.warn(
          `Failed to cleanup chunks for failed document ${savedDocument.id}`,
          cleanupError,
        );
      }

      savedDocument.status = KnowledgeDocumentStatus.FAILED;
      savedDocument.errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.knowledgeDocumentRepository.save(savedDocument);
      throw new HttpException(
        `文档入库失败: ${savedDocument.errorMessage}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async indexUploadedDocument(
    knowledgeBaseId: string,
    file: UploadedKnowledgeFile,
    userId: number,
  ) {
    if (!file?.buffer?.length) {
      throw new HttpException('上传文件不能为空', HttpStatus.BAD_REQUEST);
    }

    const safeFileName = this.getSafeUploadFileName(file.originalname);
    this.assertDocumentFileSupported(safeFileName, file.mimetype);

    if (file.buffer.length > KNOWLEDGE_MAX_FILE_SIZE) {
      throw new HttpException(
        `文件大小不能超过 ${KNOWLEDGE_MAX_FILE_SIZE / 1024 / 1024}MB`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    const storedFileName = `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}-${safeFileName}`;
    const uploadsRoot = path.resolve(process.cwd(), 'uploads');
    const storedPath = path.join(uploadsRoot, storedFileName);
    const relativeFilePath = `uploads/${storedFileName}`;

    await fs.promises.mkdir(uploadsRoot, { recursive: true });
    await fs.promises.writeFile(storedPath, file.buffer);

    const result = await this.indexDocument(
      knowledgeBaseId,
      {
        fileName: safeFileName,
        filePath: relativeFilePath,
        mimeType: file.mimetype,
      },
      userId,
    );

    return {
      ...result,
      fileName: safeFileName,
      filePath: relativeFilePath,
    };
  }

  async getDocuments(knowledgeBaseId: string, userId: number) {
    await this.assertKnowledgeBaseOwner(knowledgeBaseId, userId);

    return await this.knowledgeDocumentRepository.find({
      where: { knowledgeBaseId },
      order: { createdAt: 'DESC' },
    });
  }

  async query(knowledgeBaseId: string, ragQueryDto: RagQueryDto, userId: number) {
    await this.assertKnowledgeBaseOwner(knowledgeBaseId, userId);

    const chunks = await this.searchKnowledgeBase(
      knowledgeBaseId,
      ragQueryDto.query,
      ragQueryDto.topK || 5,
    );

    if (chunks.length === 0) {
      return {
        answer: '知识库中没有找到相关信息。',
        sources: [],
        query: ragQueryDto.query,
        knowledgeBaseId,
      };
    }

    const prompt = this.buildRagPrompt(chunks, ragQueryDto.query);

    const response = await this.llm.invoke(prompt);
    const answer = String(response.content || '无法生成回答');

    return {
      answer,
      sources: this.toSources(chunks),
      query: ragQueryDto.query,
      knowledgeBaseId,
    };
  }

  async streamQuery(
    knowledgeBaseId: string,
    query: string,
    userId: number,
  ): Promise<KnowledgeStreamResult> {
    await this.assertKnowledgeBaseOwner(knowledgeBaseId, userId);

    const chunks = await this.searchKnowledgeBase(knowledgeBaseId, query);
    const sources = this.toSources(chunks);
    const toolCalls: KnowledgeToolCall[] = [
      {
        name: 'knowledge_search',
        status: 'completed',
        query,
        resultCount: sources.length,
      },
    ];

    if (chunks.length === 0) {
      return {
        stream: this.createTextStream('知识库中没有找到相关信息。'),
        sources,
        toolCalls,
      };
    }

    return {
      stream: await this.llm.stream(this.buildRagPrompt(chunks, query)),
      sources,
      toolCalls,
    };
  }

  async searchKnowledgeBase(
    knowledgeBaseId: string,
    query: string,
    topK = 5,
  ): Promise<RetrievedChunk[]> {
    const trace = await this.searchKnowledgeBaseWithTrace(
      knowledgeBaseId,
      query,
      topK,
    );

    return trace.candidates
      .filter((candidate) => candidate.selected)
      .sort((a, b) => (a.finalRank || 0) - (b.finalRank || 0))
      .map((candidate) => ({
        id: candidate.candidateId,
        documentId: candidate.documentId,
        knowledgeBaseId: candidate.knowledgeBaseId,
        chunkIndex: candidate.chunkIndex,
        content: candidate.content,
        metadata: candidate.metadata,
        fileName: candidate.fileName,
        score:
          candidate.finalScore ??
          candidate.channels.find((channel) => channel.channel === 'vector')
            ?.score ??
          0,
        tokenCount: candidate.tokenCount,
      }));
  }

  async searchKnowledgeBaseWithTrace(
    knowledgeBaseId: string,
    query: string,
    topK = 5,
    options: KnowledgeRetrievalOptions = {},
  ): Promise<RetrievalTrace> {
    const totalStartedAt = Date.now();
    const strategy = options.strategy || 'vector_baseline';
    const rewriteResult = await this.queryRewriteService.rewrite({
      query,
      mode:
        options.rewriteMode ||
        (strategy === 'vector_baseline' ? 'never' : 'auto'),
      history: options.history,
      summary: options.summary,
    });
    const effectiveQuery = rewriteResult.effectiveQuery;

    if (strategy === 'vector_baseline') {
      const vectorResult = await this.searchVectorChannel(
        knowledgeBaseId,
        effectiveQuery,
        topK,
      );
      const candidates = vectorResult.rows.map((row, index) =>
        this.toRetrievalCandidate(row, {
          channel: 'vector',
          rank: index + 1,
          selected: true,
          finalRank: index + 1,
          finalScore: Number(row.score),
        }),
      );

      return {
        version: '1.0',
        strategy,
        knowledgeBaseId,
        originalQuery: rewriteResult.originalQuery,
        effectiveQuery,
        rewrittenQuery: rewriteResult.rewrittenQuery,
        rewrite: rewriteResult.trace,
        topK,
        candidates,
        channels: [
          this.completedChannelTrace(
            'vector',
            topK,
            candidates.length,
            vectorResult.totalMs,
            effectiveQuery,
          ),
          this.skippedChannelTrace('keyword', 0),
        ],
        timings: {
          rewriteMs: rewriteResult.trace.durationMs,
          embeddingMs: vectorResult.embeddingMs,
          vectorSearchMs: vectorResult.searchMs,
          keywordSearchMs: 0,
          fusionMs: 0,
          totalMs: Date.now() - totalStartedAt,
        },
        generatedAt: new Date().toISOString(),
      };
    }

    const vectorLimit = Math.max(topK, this.vectorCandidateLimit);
    const keywordLimit = Math.max(topK, this.keywordCandidateLimit);
    const [vectorOutcome, keywordOutcome] = await Promise.allSettled([
      this.searchVectorChannel(knowledgeBaseId, effectiveQuery, vectorLimit),
      this.searchKeywordChannel(
        knowledgeBaseId,
        effectiveQuery,
        keywordLimit,
      ),
    ]);
    const channelTraces: RetrievalChannelTrace[] = [];
    let embeddingMs = 0;
    let vectorSearchMs = 0;
    let keywordSearchMs = 0;
    let vectorRows: RetrievedChunk[] = [];
    let keywordRows: RetrievedChunk[] = [];

    if (vectorOutcome.status === 'fulfilled') {
      vectorRows = vectorOutcome.value.rows;
      embeddingMs = vectorOutcome.value.embeddingMs;
      vectorSearchMs = vectorOutcome.value.searchMs;
      channelTraces.push(
        this.completedChannelTrace(
          'vector',
          vectorLimit,
          vectorRows.length,
          vectorOutcome.value.totalMs,
          effectiveQuery,
        ),
      );
    } else {
      channelTraces.push(
        this.failedChannelTrace(
          'vector',
          vectorLimit,
          vectorOutcome.reason,
          effectiveQuery,
        ),
      );
    }

    if (keywordOutcome.status === 'fulfilled') {
      keywordRows = keywordOutcome.value.rows;
      keywordSearchMs = keywordOutcome.value.searchMs;
      channelTraces.push(
        keywordOutcome.value.searchQuery
          ? this.completedChannelTrace(
              'keyword',
              keywordLimit,
              keywordRows.length,
              keywordOutcome.value.searchMs,
              keywordOutcome.value.searchQuery,
            )
          : this.skippedChannelTrace('keyword', keywordLimit),
      );
    } else {
      channelTraces.push(
        this.failedChannelTrace(
          'keyword',
          keywordLimit,
          keywordOutcome.reason,
          effectiveQuery,
        ),
      );
    }

    const hasCompletedChannel = channelTraces.some(
      (channel) => channel.status === 'completed',
    );
    if (!hasCompletedChannel) {
      throw new Error('向量和关键词召回均不可用');
    }

    const dualCandidates = this.mergeDualRecallCandidates(
      vectorRows,
      keywordRows,
    );
    const fusionResult =
      strategy === 'hybrid_rrf'
        ? this.retrievalFusionService.fuseAndSelect(dualCandidates, topK)
        : undefined;
    if (fusionResult) {
      channelTraces.push({
        channel: 'fused',
        status: 'completed',
        candidateLimit: topK,
        candidateCount: fusionResult.candidates.length,
        durationMs: fusionResult.durationMs,
      });
    }

    return {
      version: '1.0',
      strategy,
      knowledgeBaseId,
      originalQuery: rewriteResult.originalQuery,
      effectiveQuery,
      rewrittenQuery: rewriteResult.rewrittenQuery,
      rewrite: rewriteResult.trace,
      topK,
      candidates: fusionResult?.candidates || dualCandidates,
      channels: channelTraces,
      selection: fusionResult?.selection,
      timings: {
        rewriteMs: rewriteResult.trace.durationMs,
        embeddingMs,
        vectorSearchMs,
        keywordSearchMs,
        fusionMs: fusionResult?.durationMs || 0,
        totalMs: Date.now() - totalStartedAt,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  async searchForTool(
    knowledgeBaseId: string,
    query: string,
    topK: number,
    userId: number,
  ): Promise<KnowledgeSource[]> {
    await this.assertKnowledgeBaseOwner(knowledgeBaseId, userId);
    const chunks = await this.searchKnowledgeBase(knowledgeBaseId, query, topK);
    return this.toSources(chunks);
  }

  async searchForDebug(
    knowledgeBaseId: string,
    query: string,
    topK: number,
    userId: number,
    options: KnowledgeRetrievalOptions = {},
  ): Promise<RetrievalTrace> {
    await this.assertKnowledgeBaseOwner(knowledgeBaseId, userId);
    return this.searchKnowledgeBaseWithTrace(
      knowledgeBaseId,
      query,
      topK,
      options,
    );
  }

  private async searchVectorChannel(
    knowledgeBaseId: string,
    query: string,
    limit: number,
  ) {
    const totalStartedAt = Date.now();
    const embeddingStartedAt = Date.now();
    const embedding = await this.embeddings.embedQuery(query);
    const embeddingMs = Date.now() - embeddingStartedAt;
    this.assertEmbeddingDimension(embedding);
    const vector = this.toPgVector(embedding);
    const searchStartedAt = Date.now();
    const rows = (await this.dataSource.query(
      `
        SELECT
          kc.id,
          kc."documentId",
          kc."knowledgeBaseId",
          kc."chunkIndex",
          kc.content,
          kc."tokenCount",
          kc.metadata,
          kd."fileName",
          1 - (kc.embedding <=> $1::vector) AS score
        FROM knowledge_chunk kc
        JOIN knowledge_document kd ON kd.id = kc."documentId"
        WHERE kc."knowledgeBaseId" = $2
          AND kc.embedding IS NOT NULL
          AND kd.status = $4
        ORDER BY kc.embedding <=> $1::vector
        LIMIT $3
      `,
      [vector, knowledgeBaseId, limit, KnowledgeDocumentStatus.INDEXED],
    )) as RetrievedChunk[];

    return {
      rows,
      embeddingMs,
      searchMs: Date.now() - searchStartedAt,
      totalMs: Date.now() - totalStartedAt,
    };
  }

  private async searchKeywordChannel(
    knowledgeBaseId: string,
    query: string,
    limit: number,
  ) {
    const searchQuery = this.buildKeywordSearchQuery(query);
    if (!searchQuery) {
      return { rows: [] as RetrievedChunk[], searchMs: 0, searchQuery };
    }

    const searchStartedAt = Date.now();
    const rows = (await this.dataSource.query(
      `
        WITH keyword_query AS (
          SELECT websearch_to_tsquery('simple', $4) AS value
        )
        SELECT
          kc.id,
          kc."documentId",
          kc."knowledgeBaseId",
          kc."chunkIndex",
          kc.content,
          kc."tokenCount",
          kc.metadata,
          kd."fileName",
          ts_rank_cd(kc."searchVector", keyword_query.value) AS score
        FROM knowledge_chunk kc
        JOIN knowledge_document kd ON kd.id = kc."documentId"
        CROSS JOIN keyword_query
        WHERE kc."knowledgeBaseId" = $1
          AND kd.status = $3
          AND kc."searchVector" @@ keyword_query.value
        ORDER BY score DESC, kc."chunkIndex" ASC
        LIMIT $2
      `,
      [
        knowledgeBaseId,
        limit,
        KnowledgeDocumentStatus.INDEXED,
        searchQuery,
      ],
    )) as RetrievedChunk[];

    return {
      rows,
      searchMs: Date.now() - searchStartedAt,
      searchQuery,
    };
  }

  private mergeDualRecallCandidates(
    vectorRows: RetrievedChunk[],
    keywordRows: RetrievedChunk[],
  ): RetrievalCandidate[] {
    const candidates = new Map<string, RetrievalCandidate>();

    vectorRows.forEach((row, index) => {
      candidates.set(
        row.id,
        this.toRetrievalCandidate(row, {
          channel: 'vector',
          rank: index + 1,
          selected: false,
        }),
      );
    });

    keywordRows.forEach((row, index) => {
      const existing = candidates.get(row.id);
      if (existing) {
        existing.channels.push({
          channel: 'keyword',
          rank: index + 1,
          score: Number(row.score),
        });
        return;
      }

      candidates.set(
        row.id,
        this.toRetrievalCandidate(row, {
          channel: 'keyword',
          rank: index + 1,
          selected: false,
        }),
      );
    });

    return Array.from(candidates.values()).sort((left, right) => {
      const channelCountDifference =
        right.channels.length - left.channels.length;
      if (channelCountDifference !== 0) {
        return channelCountDifference;
      }

      return (
        Math.min(...left.channels.map((channel) => channel.rank)) -
        Math.min(...right.channels.map((channel) => channel.rank))
      );
    });
  }

  private toRetrievalCandidate(
    row: RetrievedChunk,
    options: {
      channel: 'vector' | 'keyword';
      rank: number;
      selected: boolean;
      finalRank?: number;
      finalScore?: number;
    },
  ): RetrievalCandidate {
    return {
      candidateId: row.id,
      documentId: row.documentId,
      knowledgeBaseId: row.knowledgeBaseId,
      fileName: row.fileName,
      chunkIndex: Number(row.chunkIndex),
      content: row.content,
      tokenCount:
        row.tokenCount === undefined ? undefined : Number(row.tokenCount),
      metadata: row.metadata,
      channels: [
        {
          channel: options.channel,
          rank: options.rank,
          score: Number(row.score),
        },
      ],
      finalRank: options.finalRank,
      finalScore: options.finalScore,
      selected: options.selected,
      filterReasons: [],
    };
  }

  private buildKeywordSearchQuery(query: string): string | undefined {
    const stopWords = new Set([
      'about',
      'after',
      'does',
      'from',
      'have',
      'how',
      'into',
      'that',
      'the',
      'this',
      'what',
      'when',
      'where',
      'which',
      'with',
    ]);
    const terms = query.match(
      /[A-Za-z][A-Za-z0-9_.:-]{2,}|\d+(?:\.\d+)*(?:\s*(?:MB|GB|ms))?/g,
    );
    const normalizedTerms = Array.from(
      new Set(
        (terms || [])
          .map((term) => term.trim())
          .filter((term) => !stopWords.has(term.toLowerCase())),
      ),
    ).slice(0, 12);

    return normalizedTerms.length
      ? normalizedTerms.map((term) => `"${term}"`).join(' OR ')
      : undefined;
  }

  private completedChannelTrace(
    channel: 'vector' | 'keyword' | 'fused',
    candidateLimit: number,
    candidateCount: number,
    durationMs: number,
    query?: string,
  ): RetrievalChannelTrace {
    return {
      channel,
      status: 'completed',
      candidateLimit,
      candidateCount,
      durationMs,
      query,
    };
  }

  private skippedChannelTrace(
    channel: 'vector' | 'keyword' | 'fused',
    candidateLimit: number,
  ): RetrievalChannelTrace {
    return {
      channel,
      status: 'skipped',
      candidateLimit,
      candidateCount: 0,
      durationMs: 0,
    };
  }

  private failedChannelTrace(
    channel: 'vector' | 'keyword' | 'fused',
    candidateLimit: number,
    error: unknown,
    query: string,
  ): RetrievalChannelTrace {
    return {
      channel,
      status: 'failed',
      candidateLimit,
      candidateCount: 0,
      durationMs: 0,
      query,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  private async assertKnowledgeBaseOwner(knowledgeBaseId: string, userId: number) {
    const knowledgeBase = await this.knowledgeBaseRepository.findOne({
      where: { id: knowledgeBaseId, userId, isActive: true },
    });

    if (!knowledgeBase) {
      throw new HttpException('知识库不存在或无权访问', HttpStatus.NOT_FOUND);
    }

    return knowledgeBase;
  }

  private buildRagPrompt(chunks: RetrievedChunk[], query: string) {
    const context = chunks
      .map(
        (chunk, index) =>
          `资料 ${index + 1}:\n文件: ${chunk.fileName}\n片段: ${chunk.content}`,
      )
      .join('\n\n');

    return `你是一个严谨的知识库问答助手。请只根据给定资料回答问题。
如果资料中没有答案，请明确说明知识库中没有找到相关信息。

资料：
${context}

问题：
${query}

回答要求：
1. 使用中文回答。
2. 不要编造资料中没有的信息。
3. 尽量简洁。`;
  }

  private toSources(chunks: RetrievedChunk[]): KnowledgeSource[] {
    return chunks.map((chunk) => ({
      documentId: chunk.documentId,
      fileName: chunk.fileName,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content.slice(0, 300),
      score: Number(chunk.score),
    }));
  }

  private async *createTextStream(content: string) {
    yield { content };
  }

  private async ensureRetrievalSchema() {
    try {
      await this.dataSource.query('CREATE EXTENSION IF NOT EXISTS vector');
      await this.dataSource.query(
        `ALTER TABLE knowledge_chunk ADD COLUMN IF NOT EXISTS embedding vector(${this.embeddingDimension})`,
      );
      await this.dataSource.query(
        'ALTER TABLE knowledge_chunk ADD COLUMN IF NOT EXISTS "searchVector" tsvector',
      );
      await this.dataSource.query(
        `UPDATE knowledge_chunk SET "searchVector" = to_tsvector('simple', COALESCE(content, '')) WHERE "searchVector" IS NULL`,
      );
      await this.dataSource.query(
        'CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_kb_id ON knowledge_chunk ("knowledgeBaseId")',
      );
      await this.dataSource.query(
        'CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_document_id ON knowledge_chunk ("documentId")',
      );
      await this.dataSource.query(
        'CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_embedding_ivfflat ON knowledge_chunk USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)',
      );
      await this.dataSource.query(
        'CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_search_vector_gin ON knowledge_chunk USING GIN ("searchVector")',
      );
      this.logger.log('Knowledge vector and full-text retrieval schema is ready');
    } catch (error) {
      this.logger.error('Failed to ensure knowledge retrieval schema', error);
    }
  }

  private async extractTextFromFile(filePath: string): Promise<string> {
    const localPath = this.resolveLocalFilePath(filePath);
    const uploadsRoot = path.resolve(process.cwd(), 'uploads');
    const resolvedPath = path.resolve(localPath);

    if (!fs.existsSync(localPath)) {
      throw new Error(`文件不存在: ${localPath}`);
    }

    const realUploadsRoot = await fs.promises.realpath(uploadsRoot);
    const readPath = await fs.promises.realpath(resolvedPath);
    const isInsideUploads =
      readPath === realUploadsRoot ||
      readPath.startsWith(`${realUploadsRoot}${path.sep}`);

    if (!isInsideUploads) {
      throw new Error('文件路径非法');
    }

    const stats = await fs.promises.stat(readPath);
    if (!stats.isFile()) {
      throw new Error('文件路径不是普通文件');
    }

    if (stats.size > KNOWLEDGE_MAX_FILE_SIZE) {
      throw new Error(
        `文件大小不能超过 ${KNOWLEDGE_MAX_FILE_SIZE / 1024 / 1024}MB`,
      );
    }

    const extension = getKnowledgeDocumentExtension(readPath);
    if (
      extension === '.txt' ||
      extension === '.md' ||
      extension === '.markdown'
    ) {
      return await fs.promises.readFile(readPath, 'utf8');
    }

    if (extension === '.pdf') {
      const buffer = await fs.promises.readFile(readPath);
      const parsed = await pdfParse(buffer);
      return parsed.text;
    }

    throw new Error(`暂不支持的文档类型: ${extension || 'unknown'}`);
  }

  private getSafeUploadFileName(fileName: string): string {
    const normalizedFileName = (fileName || 'document').replace(/\\/g, '/');
    const baseName = path.posix.basename(normalizedFileName).trim();
    return baseName || 'document';
  }

  private assertDocumentFileSupported(fileName: string, mimeType?: string) {
    const extension = getKnowledgeDocumentExtension(fileName);
    const isSupported = KNOWLEDGE_SUPPORTED_EXTENSIONS.some(
      (supportedExtension) => supportedExtension === extension,
    );
    if (!isSupported) {
      throw new HttpException(
        `暂不支持的文档类型: ${extension || 'unknown'}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!isKnowledgeDocumentMimeTypeAllowed(extension, mimeType)) {
      throw new HttpException(
        `文件类型与扩展名不匹配: ${mimeType}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private resolveLocalFilePath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const uploadsIndex = normalized.indexOf('/uploads/');
    if (uploadsIndex >= 0) {
      const relativePath = normalized.slice(uploadsIndex + '/uploads/'.length);
      return path.join(process.cwd(), 'uploads', relativePath);
    }

    if (normalized.startsWith('uploads/')) {
      return path.join(process.cwd(), normalized);
    }

    if (normalized.startsWith('/uploads/')) {
      return path.join(process.cwd(), normalized.slice(1));
    }

    if (path.isAbsolute(filePath)) {
      return filePath;
    }

    return path.join(process.cwd(), filePath);
  }

  private assertEmbeddingDimension(embedding: number[]) {
    if (embedding.length !== this.embeddingDimension) {
      throw new Error(
        `embedding 维度不一致，期望 ${this.embeddingDimension}，实际 ${embedding.length}`,
      );
    }
  }

  private async writeChunkRetrievalData(
    chunkId: string,
    embedding: number[],
  ) {
    await this.dataSource.query(
      `UPDATE knowledge_chunk SET embedding = $1::vector, "searchVector" = to_tsvector('simple', COALESCE(content, '')) WHERE id = $2`,
      [this.toPgVector(embedding), chunkId],
    );
  }

  private toPgVector(embedding: number[]) {
    return `[${embedding.join(',')}]`;
  }

  private estimateTokenCount(content: string) {
    return Math.ceil(content.length / 4);
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
