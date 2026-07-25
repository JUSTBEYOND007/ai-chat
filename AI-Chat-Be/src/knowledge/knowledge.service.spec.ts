import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { KnowledgeBase } from './entities/knowledge-base.entity';
import { KnowledgeChunk } from './entities/knowledge-chunk.entity';
import {
  KnowledgeDocument,
  KnowledgeDocumentStatus,
} from './entities/knowledge-document.entity';
import { KNOWLEDGE_MAX_FILE_SIZE } from './knowledge.constants';
import { KnowledgeService } from './knowledge.service';

describe('KnowledgeService focused behavior', () => {
  let module: TestingModule;
  let service: KnowledgeService;

  const repositoryMock = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
  };

  const dataSourceMock = {
    query: jest.fn(),
  };

  const configServiceMock = {
    get: jest.fn((key: string) => {
      if (key === 'DASHSCOPE_EMBEDDING_DIMENSION') {
        return '3';
      }

      return undefined;
    }),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        KnowledgeService,
        {
          provide: getRepositoryToken(KnowledgeBase),
          useValue: repositoryMock,
        },
        {
          provide: getRepositoryToken(KnowledgeDocument),
          useValue: repositoryMock,
        },
        {
          provide: getRepositoryToken(KnowledgeChunk),
          useValue: repositoryMock,
        },
        {
          provide: DataSource,
          useValue: dataSourceMock,
        },
        {
          provide: ConfigService,
          useValue: configServiceMock,
        },
      ],
    }).compile();

    service = module.get(KnowledgeService);
  });

  beforeEach(() => {
    (service as any).embeddings = {
      embedQuery: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    };
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    await module.close();
  });

  it('formats embeddings as pgvector literals', () => {
    expect((service as any).toPgVector([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]');
  });

  it('throws when embedding dimension does not match config', () => {
    expect(() => (service as any).assertEmbeddingDimension([0.1, 0.2])).toThrow(
      'embedding 维度不一致，期望 3，实际 2',
    );
  });

  it('rejects unsupported knowledge document extensions', () => {
    expect(() =>
      (service as any).assertDocumentFileSupported(
        'archive.exe',
        'application/octet-stream',
      ),
    ).toThrow('暂不支持的文档类型: .exe');
  });

  it('rejects knowledge tool searches outside the current user ownership', async () => {
    repositoryMock.findOne.mockResolvedValueOnce(null);

    await expect(
      service.searchForTool('knowledge-base-id', 'private query', 5, 42),
    ).rejects.toThrow('知识库不存在或无权访问');
    expect(dataSourceMock.query).not.toHaveBeenCalled();
  });

  it('rejects uploaded documents that exceed the size limit before writing them', async () => {
    const writeFileSpy = jest.spyOn(fs.promises, 'writeFile');

    await expect(
      service.indexUploadedDocument(
        'kb-id',
        {
          originalname: 'large.md',
          mimetype: 'text/markdown',
          buffer: Buffer.alloc(KNOWLEDGE_MAX_FILE_SIZE + 1),
        },
        42,
      ),
    ).rejects.toThrow(
      `文件大小不能超过 ${KNOWLEDGE_MAX_FILE_SIZE / 1024 / 1024}MB`,
    );
    expect(writeFileSpy).not.toHaveBeenCalled();
  });

  it('retries only a failed document in the owned knowledge base', async () => {
    const document = {
      id: 'document-id',
      knowledgeBaseId: 'kb-id',
      status: KnowledgeDocumentStatus.FAILED,
      chunkCount: 3,
      errorMessage: 'previous failure',
    } as KnowledgeDocument;
    repositoryMock.findOne
      .mockResolvedValueOnce({ id: 'kb-id', userId: 42, isActive: true })
      .mockResolvedValueOnce(document);
    repositoryMock.save.mockResolvedValue(document);
    const reindexSpy = jest
      .spyOn(service as any, 'indexExistingDocument')
      .mockResolvedValue({
        documentId: 'document-id',
        status: KnowledgeDocumentStatus.INDEXED,
        chunkCount: 2,
      });

    await expect(service.retryDocument('kb-id', 'document-id', 42)).resolves.toEqual({
      documentId: 'document-id',
      status: KnowledgeDocumentStatus.INDEXED,
      chunkCount: 2,
    });
    expect(document).toMatchObject({
      status: KnowledgeDocumentStatus.PENDING,
      chunkCount: 0,
      errorMessage: null,
    });
    expect(reindexSpy).toHaveBeenCalledWith(document);
  });

  it('deletes an owned document and its indexed chunks', async () => {
    repositoryMock.findOne
      .mockResolvedValueOnce({ id: 'kb-id', userId: 42, isActive: true })
      .mockResolvedValueOnce({ id: 'document-id', knowledgeBaseId: 'kb-id' });

    await expect(service.deleteDocument('kb-id', 'document-id', 42)).resolves.toEqual({
      documentId: 'document-id',
      deleted: true,
    });
    expect(repositoryMock.delete).toHaveBeenCalledWith({
      id: 'document-id',
      knowledgeBaseId: 'kb-id',
    });
    expect(repositoryMock.delete).toHaveBeenCalledWith({ documentId: 'document-id' });
  });

  it('rejects uploads paths that resolve outside the uploads directory', async () => {
    const outsidePath = path.join(process.cwd(), 'outside.md');
    const uploadsRoot = path.resolve(process.cwd(), 'uploads');

    jest.spyOn(service as any, 'resolveLocalFilePath').mockReturnValue(outsidePath);
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest
      .spyOn(fs.promises, 'realpath')
      .mockImplementation(async (target: fs.PathLike) => {
        const resolvedTarget = path.resolve(String(target));

        if (resolvedTarget === uploadsRoot) {
          return uploadsRoot;
        }

        return outsidePath;
      });
    const readFileSpy = jest.spyOn(fs.promises, 'readFile');

    await expect(
      (service as any).extractTextFromFile('uploads/../outside.md'),
    ).rejects.toThrow('文件路径非法');
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it('rejects non-upload local paths before reading them', async () => {
    const outsidePath = path.join(process.cwd(), 'outside.md');
    const uploadsRoot = path.resolve(process.cwd(), 'uploads');

    jest.spyOn(service as any, 'resolveLocalFilePath').mockReturnValue(outsidePath);
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest
      .spyOn(fs.promises, 'realpath')
      .mockImplementation(async (target: fs.PathLike) => {
        const resolvedTarget = path.resolve(String(target));

        if (resolvedTarget === uploadsRoot) {
          return uploadsRoot;
        }

        return outsidePath;
      });
    const readFileSpy = jest.spyOn(fs.promises, 'readFile');

    await expect(
      (service as any).extractTextFromFile('C:/private/outside.md'),
    ).rejects.toThrow('文件路径非法');
    expect(readFileSpy).not.toHaveBeenCalled();
  });


  it('saves uploaded files under uploads and indexes them with a safe relative path', async () => {
    const mkdirSpy = jest
      .spyOn(fs.promises, 'mkdir')
      .mockResolvedValue(undefined as unknown as string);
    const writeFileSpy = jest
      .spyOn(fs.promises, 'writeFile')
      .mockResolvedValue(undefined);
    const indexSpy = jest.spyOn(service, 'indexDocument').mockResolvedValue({
      documentId: 'doc-id',
      status: KnowledgeDocumentStatus.INDEXED,
      chunkCount: 1,
    });
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    jest.spyOn(Math, 'random').mockReturnValue(0.123456);

    const result = await service.indexUploadedDocument(
      'kb-id',
      {
        originalname: '../demo.md',
        mimetype: 'text/markdown',
        buffer: Buffer.from('# demo'),
      },
      42,
    );

    expect(mkdirSpy).toHaveBeenCalledWith(path.resolve(process.cwd(), 'uploads'), {
      recursive: true,
    });
    expect(writeFileSpy).toHaveBeenCalledWith(
      expect.stringMatching(/uploads[/\\].+-demo\.md$/),
      Buffer.from('# demo'),
    );
    expect(indexSpy).toHaveBeenCalledWith(
      'kb-id',
      {
        fileName: 'demo.md',
        filePath: expect.stringMatching(/^uploads\/.+-demo\.md$/),
        mimeType: 'text/markdown',
      },
      42,
    );
    expect(result).toEqual({
      documentId: 'doc-id',
      status: KnowledgeDocumentStatus.INDEXED,
      chunkCount: 1,
      fileName: 'demo.md',
      filePath: expect.stringMatching(/^uploads\/.+-demo\.md$/),
    });
  });

  it('retrieves chunks only from indexed documents', async () => {
    dataSourceMock.query.mockResolvedValue([]);

    await service.searchKnowledgeBase('kb-id', 'question', 5);

    expect(dataSourceMock.query).toHaveBeenCalledWith(
      expect.stringContaining('AND kd.status = $4'),
      ['[0.1,0.2,0.3]', 'kb-id', 5, 'indexed'],
    );
  });

  it('returns a future-ready vector retrieval trace for evaluation', async () => {
    dataSourceMock.query.mockResolvedValue([
      {
        id: 'chunk-1',
        documentId: 'doc-1',
        knowledgeBaseId: 'kb-id',
        chunkIndex: 2,
        content: 'Generation ID and sequence numbers support SSE replay.',
        tokenCount: 12,
        metadata: { section: 'streaming' },
        fileName: 'stream-reliability.md',
        score: '0.91',
      },
    ]);

    const trace = await service.searchKnowledgeBaseWithTrace(
      'kb-id',
      'How does replay work?',
      3,
    );

    expect(trace).toMatchObject({
      version: '1.0',
      strategy: 'vector_baseline',
      knowledgeBaseId: 'kb-id',
      originalQuery: 'How does replay work?',
      effectiveQuery: 'How does replay work?',
      topK: 3,
      candidates: [
        {
          candidateId: 'chunk-1',
          fileName: 'stream-reliability.md',
          channels: [{ channel: 'vector', rank: 1, score: 0.91 }],
          finalRank: 1,
          finalScore: 0.91,
          selected: true,
          filterReasons: [],
        },
      ],
    });
    expect(trace.timings).toEqual({
      embeddingMs: expect.any(Number),
      vectorSearchMs: expect.any(Number),
      totalMs: expect.any(Number),
    });
  });

  it('protects retrieval debug traces with knowledge-base ownership', async () => {
    repositoryMock.findOne.mockResolvedValueOnce(null);

    await expect(
      service.searchForDebug('kb-id', 'query', 5, 42),
    ).rejects.toThrow('知识库不存在或无权访问');
    expect(dataSourceMock.query).not.toHaveBeenCalled();
  });
});
