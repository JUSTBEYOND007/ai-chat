import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { KnowledgeDocument } from './knowledge-document.entity';

@Entity({ name: 'knowledge_base' })
@Index(['userId', 'isActive'])
export class KnowledgeBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: number;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ default: true })
  isActive: boolean;

  @OneToMany(() => KnowledgeDocument, (document) => document.knowledgeBase)
  documents: KnowledgeDocument[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}