import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { RequireLogin } from 'src/custom.decorator';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { IndexDocumentDto } from './dto/index-document.dto';
import { RagQueryDto } from './dto/rag-query.dto';
import { RetrievalDebugDto } from './dto/retrieval-debug.dto';
import { KNOWLEDGE_MAX_FILE_SIZE } from './knowledge.constants';
import { KnowledgeService } from './knowledge.service';

type UploadedKnowledgeFile = {
  originalname: string;
  mimetype?: string;
  buffer: Buffer;
};

@Controller('knowledge-bases')
@RequireLogin()
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Post()
  createKnowledgeBase(
    @Body() createKnowledgeBaseDto: CreateKnowledgeBaseDto,
    @Req() request: Request,
  ) {
    return this.knowledgeService.createKnowledgeBase(
      createKnowledgeBaseDto,
      this.getUserId(request),
    );
  }

  @Get()
  getKnowledgeBases(@Req() request: Request) {
    return this.knowledgeService.getKnowledgeBases(this.getUserId(request));
  }

  @Post(':id/documents')
  indexDocument(
    @Param('id') knowledgeBaseId: string,
    @Body() indexDocumentDto: IndexDocumentDto,
    @Req() request: Request,
  ) {
    return this.knowledgeService.indexDocument(
      knowledgeBaseId,
      indexDocumentDto,
      this.getUserId(request),
    );
  }

  @Post(':id/documents/upload')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: KNOWLEDGE_MAX_FILE_SIZE } }),
  )
  indexUploadedDocument(
    @Param('id') knowledgeBaseId: string,
    @UploadedFile() file: UploadedKnowledgeFile,
    @Req() request: Request,
  ) {
    return this.knowledgeService.indexUploadedDocument(
      knowledgeBaseId,
      file,
      this.getUserId(request),
    );
  }

  @Get(':id/documents')
  getDocuments(
    @Param('id') knowledgeBaseId: string,
    @Req() request: Request,
  ) {
    return this.knowledgeService.getDocuments(
      knowledgeBaseId,
      this.getUserId(request),
    );
  }

  @Post(':id/documents/:documentId/retry')
  retryDocument(
    @Param('id') knowledgeBaseId: string,
    @Param('documentId') documentId: string,
    @Req() request: Request,
  ) {
    return this.knowledgeService.retryDocument(
      knowledgeBaseId,
      documentId,
      this.getUserId(request),
    );
  }

  @Delete(':id/documents/:documentId')
  deleteDocument(
    @Param('id') knowledgeBaseId: string,
    @Param('documentId') documentId: string,
    @Req() request: Request,
  ) {
    return this.knowledgeService.deleteDocument(
      knowledgeBaseId,
      documentId,
      this.getUserId(request),
    );
  }

  @Post(':id/query')
  queryKnowledgeBase(
    @Param('id') knowledgeBaseId: string,
    @Body() ragQueryDto: RagQueryDto,
    @Req() request: Request,
  ) {
    return this.knowledgeService.query(
      knowledgeBaseId,
      ragQueryDto,
      this.getUserId(request),
    );
  }

  @Post(':id/retrieval/debug')
  debugRetrieval(
    @Param('id') knowledgeBaseId: string,
    @Body() retrievalDebugDto: RetrievalDebugDto,
    @Req() request: Request,
  ) {
    return this.knowledgeService.searchForDebug(
      knowledgeBaseId,
      retrievalDebugDto.query,
      retrievalDebugDto.topK || 5,
      this.getUserId(request),
    );
  }

  private getUserId(request: Request): number {
    return Number((request as Request & { user?: { userId?: number } }).user?.userId);
  }
}
