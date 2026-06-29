import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { KnowledgeBase } from './entities/knowledge-base.entity';
import { KnowledgeChunk } from './entities/knowledge-chunk.entity';
import { KnowledgeDocument } from './entities/knowledge-document.entity';
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

  it('retrieves chunks only from indexed documents', async () => {
    dataSourceMock.query.mockResolvedValue([]);

    await service.searchKnowledgeBase('kb-id', 'question', 5);

    expect(dataSourceMock.query).toHaveBeenCalledWith(
      expect.stringContaining('AND kd.status = $4'),
      ['[0.1,0.2,0.3]', 'kb-id', 5, 'indexed'],
    );
  });
});
