import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { KnowledgeBase } from './knowledge-base.entity';
import { KnowledgeDocument } from './knowledge-document.entity';

@Entity({ name: 'knowledge_chunk' })
@Index(['knowledgeBaseId'])
@Index(['documentId'])
export class KnowledgeChunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  documentId: string;

  @Column({ type: 'uuid' })
  knowledgeBaseId: string;

  @Column()
  chunkIndex: number;

  @Column({ type: 'text' })
  content: string;

  @Column({ nullable: true })
  tokenCount?: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @ManyToOne(() => KnowledgeDocument, (document) => document.chunks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'documentId' })
  document: KnowledgeDocument;

  @ManyToOne(() => KnowledgeBase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'knowledgeBaseId' })
  knowledgeBase: KnowledgeBase;

  @CreateDateColumn()
  createdAt: Date;
}