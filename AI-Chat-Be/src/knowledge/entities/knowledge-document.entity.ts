import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { KnowledgeBase } from './knowledge-base.entity';
import { KnowledgeChunk } from './knowledge-chunk.entity';

export enum KnowledgeDocumentStatus {
  PENDING = 'pending',
  PARSING = 'parsing',
  INDEXED = 'indexed',
  FAILED = 'failed',
}

@Entity({ name: 'knowledge_document' })
@Index(['knowledgeBaseId', 'status'])
export class KnowledgeDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  knowledgeBaseId: string;

  @Column({ length: 256, nullable: true })
  fileId?: string;

  @Column({ length: 255 })
  fileName: string;

  @Column({ type: 'text' })
  filePath: string;

  @Column({ length: 120, nullable: true })
  mimeType?: string;

  @Column({
    type: 'enum',
    enum: KnowledgeDocumentStatus,
    default: KnowledgeDocumentStatus.PENDING,
  })
  status: KnowledgeDocumentStatus;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ default: 0 })
  chunkCount: number;

  @ManyToOne(() => KnowledgeBase, (knowledgeBase) => knowledgeBase.documents, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'knowledgeBaseId' })
  knowledgeBase: KnowledgeBase;

  @OneToMany(() => KnowledgeChunk, (chunk) => chunk.document)
  chunks: KnowledgeChunk[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}