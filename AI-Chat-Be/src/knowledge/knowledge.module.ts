import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeBase } from './entities/knowledge-base.entity';
import { KnowledgeDocument } from './entities/knowledge-document.entity';
import { KnowledgeChunk } from './entities/knowledge-chunk.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeBase, KnowledgeDocument, KnowledgeChunk]),
  ],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}