import * as fs from 'fs';
import * as path from 'path';
import * as pdfParse from 'pdf-parse';
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
  RetrievalTrace,
} from './contracts/retrieval';

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

  constructor(
    @InjectRepository(KnowledgeBase)
    private readonly knowledgeBaseRepository: Repository<KnowledgeBase>,
    @InjectRepository(KnowledgeDocument)
    private readonly knowledgeDocumentRepository: Repository<KnowledgeDocument>,
    @InjectRepository(KnowledgeChunk)
    private readonly knowledgeChunkRepository: Repository<KnowledgeChunk>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
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
  }

  async onModuleInit() {
    await this.ensureVectorSchema();
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
            },
          }),
        );

        await this.writeChunkEmbedding(chunk.id, embedding);
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

    return trace.candidates.map((candidate) => ({
      id: candidate.candidateId,
      documentId: candidate.documentId,
      knowledgeBaseId: candidate.knowledgeBaseId,
      chunkIndex: candidate.chunkIndex,
      content: candidate.content,
      metadata: candidate.metadata,
      fileName: candidate.fileName,
      score: candidate.finalScore,
      tokenCount: candidate.tokenCount,
    }));
  }

  async searchKnowledgeBaseWithTrace(
    knowledgeBaseId: string,
    query: string,
    topK = 5,
  ): Promise<RetrievalTrace> {
    const totalStartedAt = Date.now();
    const embeddingStartedAt = Date.now();
    const embedding = await this.embeddings.embedQuery(query);
    const embeddingMs = Date.now() - embeddingStartedAt;
    this.assertEmbeddingDimension(embedding);
    const vector = this.toPgVector(embedding);

    const vectorSearchStartedAt = Date.now();
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
      [vector, knowledgeBaseId, topK, KnowledgeDocumentStatus.INDEXED],
    )) as RetrievedChunk[];
    const vectorSearchMs = Date.now() - vectorSearchStartedAt;

    const candidates: RetrievalCandidate[] = rows.map((row, index) => ({
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
          channel: 'vector',
          rank: index + 1,
          score: Number(row.score),
        },
      ],
      finalRank: index + 1,
      finalScore: Number(row.score),
      selected: true,
      filterReasons: [],
    }));

    return {
      version: '1.0',
      strategy: 'vector_baseline',
      knowledgeBaseId,
      originalQuery: query,
      effectiveQuery: query,
      topK,
      candidates,
      timings: {
        embeddingMs,
        vectorSearchMs,
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
  ): Promise<RetrievalTrace> {
    await this.assertKnowledgeBaseOwner(knowledgeBaseId, userId);
    return this.searchKnowledgeBaseWithTrace(knowledgeBaseId, query, topK);
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

  private async ensureVectorSchema() {
    try {
      await this.dataSource.query('CREATE EXTENSION IF NOT EXISTS vector');
      await this.dataSource.query(
        `ALTER TABLE knowledge_chunk ADD COLUMN IF NOT EXISTS embedding vector(${this.embeddingDimension})`,
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
      this.logger.log('Knowledge pgvector schema is ready');
    } catch (error) {
      this.logger.error('Failed to ensure knowledge pgvector schema', error);
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

  private async writeChunkEmbedding(chunkId: string, embedding: number[]) {
    await this.dataSource.query(
      'UPDATE knowledge_chunk SET embedding = $1::vector WHERE id = $2',
      [this.toPgVector(embedding), chunkId],
    );
  }

  private toPgVector(embedding: number[]) {
    return `[${embedding.join(',')}]`;
  }

  private estimateTokenCount(content: string) {
    return Math.ceil(content.length / 4);
  }
}
