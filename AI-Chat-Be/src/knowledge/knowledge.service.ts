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

interface RetrievedChunk {
  id: string;
  documentId: string;
  knowledgeBaseId: string;
  chunkIndex: number;
  content: string;
  metadata?: Record<string, any>;
  fileName: string;
  score: number;
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

    const document = this.knowledgeDocumentRepository.create({
      ...indexDocumentDto,
      knowledgeBaseId,
      status: KnowledgeDocumentStatus.PENDING,
      chunkCount: 0,
    });
    const savedDocument = await this.knowledgeDocumentRepository.save(document);

    try {
      savedDocument.status = KnowledgeDocumentStatus.PARSING;
      await this.knowledgeDocumentRepository.save(savedDocument);

      const text = await this.extractTextFromFile(indexDocumentDto.filePath);
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
            knowledgeBaseId,
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

    const context = chunks
      .map(
        (chunk, index) =>
          `资料 ${index + 1}:\n文件: ${chunk.fileName}\n片段: ${chunk.content}`,
      )
      .join('\n\n');

    const prompt = `你是一个严谨的知识库问答助手。请只根据给定资料回答问题。
如果资料中没有答案，请明确说明知识库中没有找到相关信息。

资料：
${context}

问题：
${ragQueryDto.query}

回答要求：
1. 使用中文回答。
2. 不要编造资料中没有的信息。
3. 尽量简洁。`;

    const response = await this.llm.invoke(prompt);
    const answer = String(response.content || '无法生成回答');

    return {
      answer,
      sources: chunks.map((chunk) => ({
        documentId: chunk.documentId,
        fileName: chunk.fileName,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content.slice(0, 300),
        score: Number(chunk.score),
      })),
      query: ragQueryDto.query,
      knowledgeBaseId,
    };
  }

  async searchKnowledgeBase(
    knowledgeBaseId: string,
    query: string,
    topK = 5,
  ): Promise<RetrievedChunk[]> {
    const embedding = await this.embeddings.embedQuery(query);
    this.assertEmbeddingDimension(embedding);
    const vector = this.toPgVector(embedding);

    const rows = (await this.dataSource.query(
      `
        SELECT
          kc.id,
          kc."documentId",
          kc."knowledgeBaseId",
          kc."chunkIndex",
          kc.content,
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

    return rows;
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

    const extension = path.extname(readPath).toLowerCase();
    if (extension === '.txt' || extension === '.md') {
      return await fs.promises.readFile(readPath, 'utf8');
    }

    if (extension === '.pdf') {
      const buffer = await fs.promises.readFile(readPath);
      const parsed = await pdfParse(buffer);
      return parsed.text;
    }

    throw new Error(`暂不支持的文档类型: ${extension || 'unknown'}`);
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
